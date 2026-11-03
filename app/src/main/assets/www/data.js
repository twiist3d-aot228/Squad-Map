"use strict";

/*
 * SQUAD MAP — DATA ADAPTER
 * ========================
 * Every read and write the UI makes goes through SquadData below. The UI
 * never touches storage directly.
 *
 * The store is laid out exactly like the Firestore database it will use
 * when live:
 *
 *   squads/{code}                     squad doc { name, createdAt }
 *   squads/{code}/members/{memberId}  { name, online, x, z, place, lastSeenAt, joinedAt }
 *   squads/{code}/tags/{tagId}        { memberId, memberName, category, title, note, x, z, place, createdAt }
 *   squads/{code}/posts/{postId}      { memberId, memberName, tab, text, createdAt }
 *   squads/{code}/feed/{eventId}      { kind, memberName, text, x, z, createdAt }
 *
 * Two adapters implement that shape:
 *
 *   DemoAdapter      — runs today. Persists the same document tree to
 *                      localStorage, so the whole app works offline on one
 *                      device. Cross-tab changes propagate via the
 *                      `storage` event, mirroring snapshot listeners.
 *
 *   FirestoreAdapter — selected automatically when firebase-config.js
 *                      carries a real apiKey. Its methods mirror the web
 *                      SDK calls one-for-one (initializeApp, getFirestore,
 *                      doc/collection, setDoc/updateDoc, onSnapshot); the
 *                      only extra step to go live is loading the Firebase
 *                      web SDK modules and pasting the config — the calls
 *                      themselves already match the document layout above.
 */

const SquadData = (() => {
  const STORE_KEY = "squadmap.demo-store.v1";
  const LIVE_CACHE_KEY = "squadmap.live-cache.v1";
  const SESSION_KEY = "squadmap.session.v1";
  const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I / O — codes get read aloud under fire

  const CATEGORIES = ["Stash", "Loot", "Base", "Danger", "Vehicle", "For Sale", "Needed"];
  const BOARD_TABS = ["Chat", "Finds", "For Sale", "Needs"];

  function uid(prefix) {
    return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function newCode(store) {
    let code = "";
    do {
      code = "";
      for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    } while (store.squads[code]);
    return code;
  }

  /* ------------------------------------------------------------------ */
  /* Demo adapter — localStorage document tree                           */
  /* ------------------------------------------------------------------ */

  class DemoAdapter {
    constructor() {
      this.listeners = new Set();
      this.store = this._load();
      window.addEventListener("storage", (e) => {
        if (e.key === STORE_KEY) {
          this.store = this._load();
          this._emit();
        }
      });
    }

    mode() { return "demo"; }

    _load() {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) return JSON.parse(raw);
      } catch (err) { /* corrupted store falls through to a fresh seed */ }
      const store = { squads: {} };
      this._seedDemoSquad(store);
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      return store;
    }

    _save() {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.store));
      this._emit();
    }

    _emit() {
      const snapshot = this.store;
      this.listeners.forEach((cb) => { try { cb(snapshot); } catch (err) { /* listener errors stay local */ } });
    }

    subscribe(cb) {
      this.listeners.add(cb);
      return () => this.listeners.delete(cb);
    }

    /* A standing demo squad so the Join flow works on a single device, and
       so a fresh squad still shows what last-seen pins look like. */
    _seedDemoSquad(store) {
      const now = Date.now();
      const code = "HAVOC6";
      const ahab = {
        id: "demo-ahab", name: "Ahab", online: true,
        x: 6205, z: 7810, place: "Stary Sobor", lastSeenAt: now - 4 * 60000, joinedAt: now - 86400000
      };
      const joker = {
        id: "demo-joker", name: "Joker", online: false,
        x: 10466, z: 2259, place: "Elektrozavodsk", lastSeenAt: now - 3 * 3600000, joinedAt: now - 86400000
      };
      store.squads[code] = {
        name: "Havoc Platoon",
        createdAt: now - 86400000,
        members: { [ahab.id]: ahab, [joker.id]: joker },
        tags: {
          demo_tag1: {
            id: "demo_tag1", memberId: ahab.id, memberName: "Ahab", category: "Stash",
            title: "Buried barrel", note: "North treeline, blue gate side. Food + .308.",
            x: 6310, z: 7990, place: "Stary Sobor", createdAt: now - 2 * 3600000
          },
          demo_tag2: {
            id: "demo_tag2", memberId: joker.id, memberName: "Joker", category: "Loot",
            title: "M4 in fire station", note: "Elektro fire station, top floor. Gone when I log back if nobody grabs it.",
            x: 10380, z: 2310, place: "Elektrozavodsk", createdAt: now - 3 * 3600000
          }
        },
        posts: {
          demo_post1: {
            id: "demo_post1", memberId: ahab.id, memberName: "Ahab", tab: "Chat",
            text: "Squad map is live. Check in when you spawn, mark your stashes.",
            createdAt: now - 5 * 3600000
          }
        },
        feed: {
          demo_feed1: {
            id: "demo_feed1", kind: "tag", memberName: "Ahab",
            text: "Ahab marked a Stash: Buried barrel", x: 6310, z: 7990, createdAt: now - 2 * 3600000
          },
          demo_feed2: {
            id: "demo_feed2", kind: "offline", memberName: "Joker",
            text: "Joker went offline — last seen Elektrozavodsk", x: 10466, z: 2259, createdAt: now - 3 * 3600000
          }
        }
      };
    }

    _squad(code) {
      const squad = this.store.squads[code];
      if (!squad) throw new Error("No squad with code " + code + " on this device. Demo mode keeps squads on-device — go live with Firebase to join across phones.");
      return squad;
    }

    _feed(squad, entry) {
      const id = uid("ev_");
      this.store.seq = (this.store.seq || 0) + 1;
      squad.feed[id] = Object.assign({ id, createdAt: Date.now(), seq: this.store.seq }, entry);
    }

    createSquad(squadName, memberName) {
      const code = newCode(this.store);
      const now = Date.now();
      const member = {
        id: uid("m_"), name: memberName, online: false,
        x: null, z: null, place: null, lastSeenAt: null, joinedAt: now
      };
      this.store.squads[code] = {
        name: squadName, createdAt: now,
        members: { [member.id]: member }, tags: {}, posts: {}, feed: {}
      };
      this._feed(this.store.squads[code], {
        kind: "join", memberName,
        text: memberName + " created the squad", x: null, z: null
      });
      this._save();
      return { code, squad: this.store.squads[code], member };
    }

    joinSquad(code, memberName) {
      const squad = this._squad(code.toUpperCase());
      const member = {
        id: uid("m_"), name: memberName, online: false,
        x: null, z: null, place: null, lastSeenAt: null, joinedAt: Date.now()
      };
      squad.members[member.id] = member;
      this._feed(squad, { kind: "join", memberName, text: memberName + " joined the squad", x: null, z: null });
      this._save();
      return { code: code.toUpperCase(), squad, member };
    }

    leaveSquad(code, memberId) {
      const squad = this.store.squads[code];
      if (squad && squad.members[memberId]) {
        const name = squad.members[memberId].name;
        delete squad.members[memberId];
        this._feed(squad, { kind: "leave", memberName: name, text: name + " left the squad", x: null, z: null });
        this._save();
      }
    }

    getSquad(code) { return this.store.squads[code] || null; }

    checkIn(code, memberId, pos) {
      const squad = this._squad(code);
      const m = squad.members[memberId];
      m.online = true;
      m.x = pos.x; m.z = pos.z; m.place = pos.place;
      m.lastSeenAt = Date.now();
      this._feed(squad, {
        kind: "checkin", memberName: m.name,
        text: m.name + " checked in — " + pos.place, x: pos.x, z: pos.z
      });
      this._save();
      return m;
    }

    goOffline(code, memberId) {
      const squad = this._squad(code);
      const m = squad.members[memberId];
      m.online = false;
      m.lastSeenAt = Date.now();
      this._feed(squad, {
        kind: "offline", memberName: m.name,
        text: m.name + " went offline — last seen " + (m.place || "unknown"), x: m.x, z: m.z
      });
      this._save();
      return m;
    }

    goOnline(code, memberId) {
      const squad = this._squad(code);
      const m = squad.members[memberId];
      m.online = true;
      m.lastSeenAt = Date.now();
      this._feed(squad, {
        kind: "online", memberName: m.name,
        text: m.name + " is back online", x: m.x, z: m.z
      });
      this._save();
      return m;
    }

    addTag(code, memberId, tag) {
      const squad = this._squad(code);
      const m = squad.members[memberId];
      const id = uid("t_");
      const full = Object.assign({ id, memberId, memberName: m.name, createdAt: Date.now() }, tag);
      squad.tags[id] = full;
      this._feed(squad, {
        kind: "tag", memberName: m.name,
        text: m.name + " marked a " + tag.category + ": " + tag.title, x: tag.x, z: tag.z
      });
      this._save();
      return full;
    }

    removeTag(code, memberId, tagId) {
      const squad = this._squad(code);
      const tag = squad.tags[tagId];
      if (tag && tag.memberId === memberId) {
        delete squad.tags[tagId];
        this._save();
      }
    }

    addPost(code, memberId, tab, text) {
      const squad = this._squad(code);
      const m = squad.members[memberId];
      const id = uid("p_");
      this.store.seq = (this.store.seq || 0) + 1;
      const post = { id, memberId, memberName: m.name, tab, text, createdAt: Date.now(), seq: this.store.seq };
      squad.posts[id] = post;
      this._save();
      return post;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Firestore adapter — live mode                                       */
  /*                                                                     */
  /* Selected only when firebase-config.js has a real apiKey. When the   */
  /* Firebase web SDK scripts are added to index.html, this adapter      */
  /* swaps to the namespaced calls sketched in each method:              */
  /*   this.db = getFirestore(initializeApp(window.SQUADMAP_FIREBASE_CONFIG)) */
  /*   squadDoc     = doc(db, "squads", code)                            */
  /*   membersCol   = collection(squadDoc, "members")  ... and so on.    */
  /* Until the SDK is loaded it defers to the demo adapter so the app    */
  /* never hard-fails on a phone with a config but no network modules.   */
  /* ------------------------------------------------------------------ */

  class FirestoreAdapter {
    constructor(fallback) {
      this.fallback = fallback;
      this.listeners = new Set();
      this.parts = {};          // code -> { base, members, tags, posts, feed }
      this.unsubs = {};         // code -> [unsubscribe, ...]
      this.pending = {};        // code -> member awaiting squad-doc confirmation
      this.memberWritten = {};  // "code/memberId" -> true
      this.db = null;
      this._live = false;
      try {
        if (typeof window.firebase !== "undefined" && typeof window.firebase.firestore === "function") {
          if (!window.firebase.apps.length) window.firebase.initializeApp(window.SQUADMAP_FIREBASE_CONFIG);
          this.db = window.firebase.firestore();
          this._live = true;
          this._loadCache();
        }
      } catch (err) {
        console.warn("[SquadMap] Firebase init failed - demo mode.", err);
        this._live = false;
      }
      if (!this._live) console.warn("[SquadMap] Firebase SDK not loaded - running demo data.");
    }

    mode() { return this._live ? "live" : "demo"; }

    /* ---- local mirror cache (cold-start restore + offline reads) ---- */

    _loadCache() {
      try {
        const raw = localStorage.getItem(LIVE_CACHE_KEY);
        if (!raw) return;
        const cache = JSON.parse(raw);
        Object.keys(cache).forEach((code) => {
          const s = cache[code];
          this.parts[code] = {
            base: { name: s.name, createdAt: s.createdAt },
            members: s.members || {}, tags: s.tags || {},
            posts: s.posts || {}, feed: s.feed || {}
          };
        });
      } catch (err) { /* the cache is a convenience; a bad one is ignored */ }
    }

    _saveCache() {
      try {
        const cache = {};
        Object.keys(this.parts).forEach((code) => { cache[code] = this._assemble(code); });
        localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify(cache));
      } catch (err) { /* storage blocked - live sync still works */ }
    }

    _assemble(code) {
      const p = this.parts[code];
      if (!p) return null;
      return {
        name: p.base.name || "", createdAt: p.base.createdAt || 0,
        members: p.members, tags: p.tags, posts: p.posts, feed: p.feed
      };
    }

    _emit() {
      this._saveCache();
      this.listeners.forEach((cb) => { try { cb(); } catch (err) { /* listener errors stay local */ } });
    }

    subscribe(cb) {
      if (!this._live) return this.fallback.subscribe(cb);
      this.listeners.add(cb);
      return () => this.listeners.delete(cb);
    }

    /* ---- Firestore wiring: squads/{code} + members/tags/posts/feed ---- */

    _doc(code) { return this.db.collection("squads").doc(code); }

    _ensureWatch(code) {
      if (!this._live || this.unsubs[code]) return;
      this.unsubs[code] = [];
      if (!this.parts[code]) {
        this.parts[code] = { base: {}, members: {}, tags: {}, posts: {}, feed: {} };
      }
      const ref = this._doc(code);
      const onErr = (err) => console.warn("[SquadMap] Firestore listener error:", err);
      this.unsubs[code].push(ref.onSnapshot((snap) => {
        if (snap.exists) {
          const d = snap.data();
          this.parts[code].base = { name: d.name, createdAt: d.createdAt };
          this._flushPending(code);
        }
        this._emit();
      }, onErr));
      ["members", "tags", "posts", "feed"].forEach((col) => {
        this.unsubs[code].push(ref.collection(col).onSnapshot((qs) => {
          const map = {};
          qs.forEach((docSnap) => { map[docSnap.id] = docSnap.data(); });
          this.parts[code][col] = map;
          this._emit();
        }, onErr));
      });
    }

    _flushPending(code) {
      const member = this.pending[code];
      if (!member) return;
      const key = code + "/" + member.id;
      if (this.memberWritten[key]) { delete this.pending[code]; return; }
      this.memberWritten[key] = true;
      delete this.pending[code];
      const entry = this._feedEntry({ kind: "join", memberName: member.name, text: member.name + " joined the squad", x: null, z: null });
      const ref = this._doc(code);
      ref.collection("members").doc(member.id).set(member).catch((e) => console.warn("[SquadMap] member write failed", e));
      ref.collection("feed").doc(entry.id).set(entry).catch((e) => console.warn("[SquadMap] feed write failed", e));
      if (!this.parts[code].feed[entry.id]) this.parts[code].feed[entry.id] = entry;
    }

    _feedEntry(entry) {
      const now = Date.now();
      return Object.assign({ id: uid("ev_"), createdAt: now, seq: now }, entry);
    }

    _writeFeed(code, entry) {
      if (!this.parts[code].feed[entry.id]) this.parts[code].feed[entry.id] = entry;
      this._doc(code).collection("feed").doc(entry.id).set(entry)
        .catch((e) => console.warn("[SquadMap] feed write failed", e));
    }

    _writeMember(code, member) {
      this.parts[code].members[member.id] = member;
      this.memberWritten[code + "/" + member.id] = true;
      this._doc(code).collection("members").doc(member.id).set(member)
        .catch((e) => console.warn("[SquadMap] member write failed", e));
    }

    _squadParts(code) {
      this._ensureWatch(code);
      return this.parts[code];
    }

    /* ---- adapter API (mirrors DemoAdapter semantics one-for-one) ---- */

    createSquad(squadName, memberName) {
      if (!this._live) return this.fallback.createSquad(squadName, memberName);
      let code = "";
      do {
        code = "";
        for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      } while (this.parts[code] && this.parts[code].base && this.parts[code].base.createdAt);
      const now = Date.now();
      const member = { id: uid("m_"), name: memberName, online: false, x: null, z: null, place: null, lastSeenAt: null, joinedAt: now };
      this.parts[code] = { base: { name: squadName, createdAt: now }, members: { [member.id]: member }, tags: {}, posts: {}, feed: {} };
      const entry = this._feedEntry({ kind: "join", memberName, text: memberName + " created the squad", x: null, z: null });
      this.parts[code].feed[entry.id] = entry;
      this._ensureWatch(code);
      const ref = this._doc(code);
      ref.set({ name: squadName, createdAt: now }).catch((e) => console.warn("[SquadMap] squad write failed", e));
      this.memberWritten[code + "/" + member.id] = true;
      ref.collection("members").doc(member.id).set(member).catch((e) => console.warn("[SquadMap] member write failed", e));
      ref.collection("feed").doc(entry.id).set(entry).catch((e) => console.warn("[SquadMap] feed write failed", e));
      this._emit();
      return { code, squad: this._assemble(code), member };
    }

    joinSquad(code, memberName) {
      if (!this._live) return this.fallback.joinSquad(code, memberName);
      const up = code.toUpperCase();
      const member = { id: uid("m_"), name: memberName, online: false, x: null, z: null, place: null, lastSeenAt: null, joinedAt: Date.now() };
      const p = this._squadParts(up);
      p.members[member.id] = member;
      this.pending[up] = member;
      // If the squad doc is already mirrored, the join writes immediately;
      // otherwise _flushPending fires when the doc snapshot lands. A code
      // whose doc never appears stays a local phantom - the host reads the
      // real code aloud, so a wrong code is obvious and self-corrects.
      if (p.base && p.base.createdAt) this._flushPending(up);
      this._emit();
      return { code: up, squad: this._assemble(up), member };
    }

    leaveSquad(code, memberId) {
      if (!this._live) return this.fallback.leaveSquad(code, memberId);
      const p = this.parts[code];
      if (p && p.members[memberId]) {
        const name = p.members[memberId].name;
        delete p.members[memberId];
        const entry = this._feedEntry({ kind: "leave", memberName: name, text: name + " left the squad", x: null, z: null });
        this._writeFeed(code, entry);
        this._doc(code).collection("members").doc(memberId).delete().catch((e) => console.warn("[SquadMap] member delete failed", e));
        this._emit();
      }
    }

    getSquad(code) {
      if (!this._live) return this.fallback.getSquad(code);
      this._ensureWatch(code);
      const p = this.parts[code];
      if (!p) return null;
      const known = p.base.createdAt || Object.keys(p.members).length || this.pending[code];
      if (!known) return null; // listener still loading, or no such squad
      return this._assemble(code);
    }

    checkIn(code, memberId, pos) {
      if (!this._live) return this.fallback.checkIn(code, memberId, pos);
      const p = this._squadParts(code);
      const m = p.members[memberId];
      if (!m) return null;
      m.online = true;
      m.x = pos.x; m.z = pos.z; m.place = pos.place;
      m.lastSeenAt = Date.now();
      const entry = this._feedEntry({ kind: "checkin", memberName: m.name, text: m.name + " checked in — " + pos.place, x: pos.x, z: pos.z });
      this._writeMember(code, m);
      this._writeFeed(code, entry);
      this._emit();
      return m;
    }

    goOffline(code, memberId) {
      if (!this._live) return this.fallback.goOffline(code, memberId);
      const p = this._squadParts(code);
      const m = p.members[memberId];
      if (!m) return null;
      m.online = false;
      m.lastSeenAt = Date.now();
      const entry = this._feedEntry({ kind: "offline", memberName: m.name, text: m.name + " went offline — last seen " + (m.place || "unknown"), x: m.x, z: m.z });
      this._writeMember(code, m);
      this._writeFeed(code, entry);
      this._emit();
      return m;
    }

    goOnline(code, memberId) {
      if (!this._live) return this.fallback.goOnline(code, memberId);
      const p = this._squadParts(code);
      const m = p.members[memberId];
      if (!m) return null;
      m.online = true;
      m.lastSeenAt = Date.now();
      const entry = this._feedEntry({ kind: "online", memberName: m.name, text: m.name + " is back online", x: m.x, z: m.z });
      this._writeMember(code, m);
      this._writeFeed(code, entry);
      this._emit();
      return m;
    }

    addTag(code, memberId, tag) {
      if (!this._live) return this.fallback.addTag(code, memberId, tag);
      const p = this._squadParts(code);
      const m = p.members[memberId];
      if (!m) return null;
      const id = uid("t_");
      const full = Object.assign({ id, memberId, memberName: m.name, createdAt: Date.now() }, tag);
      p.tags[id] = full;
      this._doc(code).collection("tags").doc(id).set(full).catch((e) => console.warn("[SquadMap] tag write failed", e));
      const entry = this._feedEntry({ kind: "tag", memberName: m.name, text: m.name + " marked a " + tag.category + ": " + tag.title, x: tag.x, z: tag.z });
      this._writeFeed(code, entry);
      this._emit();
      return full;
    }

    removeTag(code, memberId, tagId) {
      if (!this._live) return this.fallback.removeTag(code, memberId, tagId);
      const p = this.parts[code];
      if (!p) return;
      const tag = p.tags[tagId];
      if (tag && tag.memberId === memberId) {
        delete p.tags[tagId];
        this._doc(code).collection("tags").doc(tagId).delete().catch((e) => console.warn("[SquadMap] tag delete failed", e));
        this._emit();
      }
    }

    addPost(code, memberId, tab, text) {
      if (!this._live) return this.fallback.addPost(code, memberId, tab, text);
      const p = this._squadParts(code);
      const m = p.members[memberId];
      if (!m) return null;
      const now = Date.now();
      const post = { id: uid("p_"), memberId, memberName: m.name, tab, text, createdAt: now, seq: now };
      p.posts[post.id] = post;
      this._doc(code).collection("posts").doc(post.id).set(post).catch((e) => console.warn("[SquadMap] post write failed", e));
      this._emit();
      return post;
    }
  }

  /* ------------------------------------------------------------------ */

  const demo = new DemoAdapter();
  const cfg = window.SQUADMAP_FIREBASE_CONFIG || {};
  const hasLiveConfig = typeof cfg.apiKey === "string" && cfg.apiKey.length > 0;
  const adapter = hasLiveConfig ? new FirestoreAdapter(demo) : demo;

  function snapshot(code) {
    const squad = adapter.getSquad(code);
    if (!squad) return null;
    const byTimeAsc = (a, b) => (a.createdAt - b.createdAt) || ((a.seq || 0) - (b.seq || 0));
    const byTimeDesc = (a, b) => (b.createdAt - a.createdAt) || ((b.seq || 0) - (a.seq || 0));
    return {
      code,
      name: squad.name,
      createdAt: squad.createdAt,
      members: Object.values(squad.members).sort((a, b) => a.joinedAt - b.joinedAt),
      tags: Object.values(squad.tags).sort(byTimeDesc),
      posts: Object.values(squad.posts).sort(byTimeAsc),
      feed: Object.values(squad.feed).sort(byTimeDesc)
    };
  }

  return {
    CATEGORIES,
    BOARD_TABS,
    mode: () => adapter.mode(),

    restoreSession() {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const session = JSON.parse(raw);
        const squad = adapter.getSquad(session.code);
        if (!squad || !squad.members[session.memberId]) return null;
        return session;
      } catch (err) { return null; }
    },

    saveSession(session) {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    },

    createSquad(squadName, memberName) {
      const { code, member } = adapter.createSquad(squadName.trim(), memberName.trim());
      const session = { code, memberId: member.id, name: member.name };
      this.saveSession(session);
      return { session, state: snapshot(code) };
    },

    joinSquad(code, memberName) {
      const res = adapter.joinSquad(code.trim().toUpperCase(), memberName.trim());
      const session = { code: res.code, memberId: res.member.id, name: res.member.name };
      this.saveSession(session);
      return { session, state: snapshot(res.code) };
    },

    leaveSquad(session) {
      adapter.leaveSquad(session.code, session.memberId);
      this.saveSession(null);
    },

    getState(code) { return snapshot(code); },

    subscribe(code, cb) {
      return adapter.subscribe(() => {
        const state = snapshot(code);
        if (state) cb(state);
      });
    },

    checkIn(session, pos) { adapter.checkIn(session.code, session.memberId, pos); },
    goOffline(session) { adapter.goOffline(session.code, session.memberId); },
    goOnline(session) { adapter.goOnline(session.code, session.memberId); },
    addTag(session, tag) { return adapter.addTag(session.code, session.memberId, tag); },
    removeTag(session, tagId) { adapter.removeTag(session.code, session.memberId, tagId); },
    addPost(session, tab, text) { return adapter.addPost(session.code, session.memberId, tab, text.trim()); }
  };
})();
