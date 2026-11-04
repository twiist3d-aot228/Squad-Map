"use strict";

/*
 * SQUAD MAP — APP CONTROLLER
 * ==========================
 * Wires the UI (index.html) to the data adapter (data.js) and the map
 * (map.js). All state flows: SquadData -> state -> render*. User actions
 * call SquadData and re-render from the subscription callback, the same
 * shape the live Firestore snapshots will use.
 */

(() => {
  const $ = (id) => document.getElementById(id);

  let session = null;          // { code, memberId, name }
  let state = null;            // SquadData snapshot
  let mapView = null;
  let unsubscribe = null;
  let activeTab = "map";
  let boardTab = "Chat";
  let placement = null;        // null | { kind: "checkin" } | { kind: "tag", draft: {...} }
  let lastTapPos = null;

  /* ---------------- helpers ---------------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function ago(ts) {
    if (!ts) return "never";
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 45) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    return Math.floor(h / 24) + "d ago";
  }

  function me() {
    if (!state || !session) return null;
    return state.members.find((m) => m.id === session.memberId) || null;
  }

  /* ---------------- bottom sheet ---------------- */

  function openSheet(html) {
    $("sheet").innerHTML = html;
    $("sheet-backdrop").classList.remove("hidden");
  }
  function closeSheet() {
    $("sheet-backdrop").classList.add("hidden");
    $("sheet").innerHTML = "";
  }
  $("sheet-backdrop").addEventListener("click", (e) => {
    if (e.target === $("sheet-backdrop")) closeSheet();
  });

  /* ---------------- onboarding ---------------- */

  function showOnboard(errorText) {
    $("view-main").classList.add("hidden");
    $("view-onboard").classList.remove("hidden");
    $("ob-error").textContent = errorText || "";
    $("ob-mode-note").textContent = SquadData.mode() === "demo"
      ? "DEMO MODE — this build keeps squads on this device only, so you can run the whole app offline. Demo squad HAVOC6 is standing by if you want to see a join. Add Firebase (see README) and squads sync across phones."
      : "LIVE MODE — squads sync through Firebase.";
  }

  function enterApp() {
    state = SquadData.getState(session.code);
    if (!state) { showOnboard("Your squad could not be loaded."); return; }
    $("view-onboard").classList.add("hidden");
    $("view-main").classList.remove("hidden");

    if (!mapView) {
      mapView = new SquadMapView($("map-viewport"), $("map-world"), {
        onTap: onMapTap,
        onPinTap: onPinTap
      });
      window.addEventListener("resize", () => mapView.fit());
    }
    if (unsubscribe) unsubscribe();
    unsubscribe = SquadData.subscribe(session.code, (next) => {
      state = next;
      renderAll();
    });
    renderAll();
    switchTab("map");
  }

  $("ob-create").addEventListener("click", () => {
    const name = $("ob-name").value.trim();
    const squadName = $("ob-squad-name").value.trim();
    if (!name) { $("ob-error").textContent = "Pick a callsign first."; return; }
    if (!squadName) { $("ob-error").textContent = "Give the squad a name."; return; }
    try {
      session = SquadData.createSquad(squadName, name).session;
      enterApp();
    } catch (err) { $("ob-error").textContent = err.message; }
  });

  $("ob-join").addEventListener("click", () => {
    const name = $("ob-name").value.trim();
    const code = $("ob-code").value.trim().toUpperCase();
    if (!name) { $("ob-error").textContent = "Pick a callsign first."; return; }
    if (code.length !== 6) { $("ob-error").textContent = "Invite codes are 6 letters."; return; }
    try {
      session = SquadData.joinSquad(code, name).session;
      enterApp();
    } catch (err) { $("ob-error").textContent = err.message; }
  });

  /* ---------------- tabs ---------------- */

  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll("#tabbar button").forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === tab));
    ["map", "feed", "board", "squad"].forEach((t) =>
      $("page-" + t).classList.toggle("hidden", t !== tab));
    if (tab === "map" && mapView) requestAnimationFrame(() => mapView.fit());
  }
  document.querySelectorAll("#tabbar button").forEach((b) =>
    b.addEventListener("click", () => switchTab(b.dataset.tab)));

  /* ---------------- rendering ---------------- */

  function renderAll() {
    if (!state || !session) return;
    const my = me();
    $("tb-squad").textContent = state.name;
    $("tb-code").textContent = state.code;
    const statusBtn = $("tb-status");
    if (my && my.online) {
      statusBtn.textContent = "● ONLINE";
      statusBtn.classList.add("online");
    } else {
      statusBtn.textContent = "OFFLINE";
      statusBtn.classList.remove("online");
    }
    if (mapView) mapView.render(state.members, state.tags, session.memberId);
    renderFeed();
    renderBoard();
    renderSquad();
  }

  function renderFeed() {
    const list = $("feed-list");
    if (!state.feed.length) {
      list.innerHTML = `<li class="empty-note">No squad activity yet. Check in or drop a tag and it lands here.</li>`;
      return;
    }
    list.innerHTML = state.feed.map((ev) => `
      <li data-x="${ev.x == null ? "" : ev.x}" data-z="${ev.z == null ? "" : ev.z}">
        ${esc(ev.text)}
        <span class="when">${ago(ev.createdAt).toUpperCase()}</span>
      </li>`).join("");
    list.querySelectorAll("li[data-x]").forEach((li) => {
      if (li.dataset.x === "") return;
      li.addEventListener("click", () => {
        const x = Number(li.dataset.x);
        const z = Number(li.dataset.z);
        switchTab("map");
        requestAnimationFrame(() => { mapView.focus(x, z); mapView.flashAt(x, z); });
      });
    });
  }

  function renderBoard() {
    const tabs = $("board-tabs");
    tabs.innerHTML = SquadData.BOARD_TABS.map((t) =>
      `<button type="button" data-btab="${esc(t)}" class="${t === boardTab ? "active" : ""}">${esc(t)}</button>`).join("");
    tabs.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => { boardTab = b.dataset.btab; renderBoard(); }));

    const posts = state.posts.filter((p) => p.tab === boardTab);
    const list = $("post-list");
    list.innerHTML = posts.length ? posts.map((p) => `
      <li><span class="who">${esc(p.memberName).toUpperCase()}</span>${esc(p.text)}
      <span class="when">${ago(p.createdAt).toUpperCase()}</span></li>`).join("")
      : `<li class="empty-note">Nothing in ${esc(boardTab)} yet. Start it.</li>`;
    list.scrollTop = list.scrollHeight;
  }

  function renderSquad() {
    const mine = me();
    $("squad-info").innerHTML =
      `<b>${esc(state.name)}</b> — ${state.members.length} member${state.members.length === 1 ? "" : "s"}` +
      `<span class="big-code">${esc(state.code)}</span>` +
      `<span class="muted">Share the code. Anyone with it joins this squad picture.` +
      (SquadData.mode() === "demo" ? ` Demo mode: this squad lives on this device.` : ``) + `</span>`;

    $("member-list").innerHTML = state.members.map((m) => {
      const status = m.online
        ? `Online${m.place ? " — " + esc(m.place) : ""} · ${ago(m.lastSeenAt)}`
        : (m.place ? `Last seen ${esc(m.place)} · ${ago(m.lastSeenAt)}` : "Never checked in");
      const badges =
        (m.id === session.memberId ? `<span class="badge">YOU</span>` : "") +
        (m.id.startsWith("demo-") ? `<span class="badge demo">DEMO</span>` : "");
      return `<li><span class="status-dot ${m.online ? "online" : ""}"></span>
        <span><b>${esc(m.name)}</b>${badges}<span class="member-meta">${status}</span></span></li>`;
    }).join("");

    const tagList = $("tag-list");
    tagList.innerHTML = state.tags.length ? state.tags.map((t) => `
      <li data-tagid="${t.id}">
        <span class="tag-swatch cat-${t.category.replace(/\s+/g, "-").toLowerCase()}"></span>
        <span><b>${esc(t.category)}:</b> ${esc(t.title)}
        <span class="tag-meta">${esc(t.place)} · Grid ${SquadMapGeo.gridRef(t.x, t.z)} · by ${esc(t.memberName)} · ${ago(t.createdAt)}</span></span>
      </li>`).join("")
      : `<li class="empty-note">No tags yet. Drop one from the map.</li>`;
    tagList.querySelectorAll("li[data-tagid]").forEach((li) =>
      li.addEventListener("click", () => {
        const tag = state.tags.find((t) => t.id === li.dataset.tagid);
        if (tag) onPinTap("tag", tag);
      }));

    // Keep the status button label honest even on the squad page.
    if (mine) { /* renderAll already handled the topbar */ }
  }

  /* ---------------- map interactions ---------------- */

  function setPlacement(next, bannerText) {
    placement = next;
    const banner = $("place-banner");
    if (next) {
      banner.textContent = bannerText;
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }
  }

  function onMapTap(pos) {
    lastTapPos = pos;
    const near = SquadMapGeo.nearest(pos.x, pos.z);
    const place = near.name;
    $("map-readout").innerHTML =
      `GRID <b>${SquadMapGeo.gridRef(pos.x, pos.z)}</b> — ${esc(place.toUpperCase())}` +
      (near.dist != null && !place.startsWith("Grid") ? ` · ${near.dist}M` : "");

    if (placement && placement.kind === "checkin") {
      setPlacement(null);
      confirmCheckIn(pos, place);
    } else if (placement && placement.kind === "tag") {
      const draft = placement.draft;
      setPlacement(null);
      confirmTag(pos, place, draft);
    } else {
      openSpotSheet(pos, place);
    }
  }

  function openSpotSheet(pos, place) {
    openSheet(`
      <h3>GRID ${SquadMapGeo.gridRef(pos.x, pos.z)}</h3>
      <div class="sheet-body">Near <b>${esc(place)}</b> — ${pos.x}E / ${pos.z}N.
        <div class="sheet-actions">
          <button class="btn primary" id="sh-checkin" type="button">CHECK IN HERE</button>
          <button class="btn" id="sh-tag" type="button">TAG HERE</button>
        </div>
      </div>`);
    $("sh-checkin").addEventListener("click", () => { closeSheet(); confirmCheckIn(pos, place); });
    $("sh-tag").addEventListener("click", () => { closeSheet(); openTagForm(pos, place); });
  }

  function confirmCheckIn(pos, place) {
    openSheet(`
      <h3>CHECK IN</h3>
      <div class="sheet-body">
        <span class="gridline">${esc(place.toUpperCase())} · GRID ${SquadMapGeo.gridRef(pos.x, pos.z)}</span><br>
        Your pin drops here and the squad sees you online. When you log off,
        it freezes right here as your last seen.
        <div class="sheet-actions">
          <button class="btn primary" id="sh-do-checkin" type="button">CONFIRM CHECK-IN</button>
          <button class="btn" id="sh-cancel" type="button">CANCEL</button>
        </div>
      </div>`);
    $("sh-do-checkin").addEventListener("click", () => {
      SquadData.checkIn(session, { x: pos.x, z: pos.z, place });
      closeSheet();
      renderAll();
    });
    $("sh-cancel").addEventListener("click", closeSheet);
  }

  function openTagForm(pos, place) {
    const options = SquadData.CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    openSheet(`
      <h3>DROP A TAG</h3>
      <div class="sheet-body">
        <span class="gridline">${esc(place.toUpperCase())} · GRID ${SquadMapGeo.gridRef(pos.x, pos.z)}</span>
        <label class="field" style="margin-top:12px;">CATEGORY
          <select id="tag-category">${options}</select>
        </label>
        <label class="field">TITLE
          <input id="tag-title" type="text" maxlength="60" placeholder="e.g. Buried barrel">
        </label>
        <label class="field">NOTE
          <textarea id="tag-note" maxlength="240" placeholder="What is there, what to watch for..."></textarea>
        </label>
        <div class="sheet-actions">
          <button class="btn primary" id="sh-do-tag" type="button">DROP TAG</button>
          <button class="btn" id="sh-cancel" type="button">CANCEL</button>
        </div>
      </div>`);
    $("sh-do-tag").addEventListener("click", () => {
      const title = $("tag-title").value.trim();
      if (!title) { $("tag-title").focus(); return; }
      SquadData.addTag(session, {
        category: $("tag-category").value,
        title,
        note: $("tag-note").value.trim(),
        x: pos.x, z: pos.z, place
      });
      closeSheet();
      renderAll();
    });
    $("sh-cancel").addEventListener("click", closeSheet);
  }

  function confirmTag(pos, place, draft) {
    SquadData.addTag(session, {
      category: draft.category, title: draft.title, note: draft.note,
      x: pos.x, z: pos.z, place
    });
    renderAll();
  }

  function onPinTap(kind, item) {
    if (kind === "member") {
      const m = item;
      const status = m.online
        ? `ONLINE — ${esc(m.place || "unknown")} · checked in ${ago(m.lastSeenAt)}`
        : `LAST SEEN — ${esc(m.place || "never checked in")} · ${ago(m.lastSeenAt)}`;
      openSheet(`
        <h3>${esc(m.name).toUpperCase()}${m.id === session.memberId ? " (YOU)" : ""}</h3>
        <div class="sheet-body">
          <span class="gridline">${status}</span><br>
          Grid ${SquadMapGeo.gridRef(m.x, m.z)} · ${m.x}E / ${m.z}N
          <div class="sheet-actions">
            <button class="btn primary" id="sh-center" type="button">CENTER MAP</button>
            <button class="btn" id="sh-close" type="button">CLOSE</button>
          </div>
        </div>`);
      $("sh-center").addEventListener("click", () => {
        closeSheet(); switchTab("map");
        requestAnimationFrame(() => { mapView.focus(m.x, m.z); mapView.flashAt(m.x, m.z); });
      });
      $("sh-close").addEventListener("click", closeSheet);
    } else {
      const t = item;
      const mine = t.memberId === session.memberId;
      openSheet(`
        <h3>${esc(t.category).toUpperCase()} — ${esc(t.title).toUpperCase()}</h3>
        <div class="sheet-body">
          ${t.note ? esc(t.note) + "<br>" : ""}
          <span class="gridline">${esc(t.place)} · GRID ${SquadMapGeo.gridRef(t.x, t.z)}</span><br>
          Marked by ${esc(t.memberName)} · ${ago(t.createdAt)}
          <div class="sheet-actions">
            <button class="btn primary" id="sh-center" type="button">CENTER MAP</button>
            ${mine ? `<button class="btn danger" id="sh-remove" type="button">REMOVE</button>` : ""}
            <button class="btn" id="sh-close" type="button">CLOSE</button>
          </div>
        </div>`);
      $("sh-center").addEventListener("click", () => {
        closeSheet(); switchTab("map");
        requestAnimationFrame(() => { mapView.focus(t.x, t.z); mapView.flashAt(t.x, t.z); });
      });
      $("sh-close").addEventListener("click", closeSheet);
      const removeBtn = $("sh-remove");
      if (removeBtn) removeBtn.addEventListener("click", () => {
        SquadData.removeTag(session, t.id);
        closeSheet();
        renderAll();
      });
    }
  }

  /* ---------------- action buttons ---------------- */

  $("btn-checkin").addEventListener("click", () => {
    setPlacement({ kind: "checkin" }, "TAP YOUR POSITION ON THE MAP");
  });

  $("btn-tagmode").addEventListener("click", () => {
    const options = SquadData.CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    openSheet(`
      <h3>DROP A TAG</h3>
      <div class="sheet-body">
        <label class="field">CATEGORY
          <select id="tag-category">${options}</select>
        </label>
        <label class="field">TITLE
          <input id="tag-title" type="text" maxlength="60" placeholder="e.g. Buried barrel">
        </label>
        <label class="field">NOTE
          <textarea id="tag-note" maxlength="240" placeholder="What is there, what to watch for..."></textarea>
        </label>
        <div class="sheet-actions">
          <button class="btn primary" id="sh-place-tag" type="button">PLACE ON MAP</button>
          <button class="btn" id="sh-cancel" type="button">CANCEL</button>
        </div>
      </div>`);
    $("sh-place-tag").addEventListener("click", () => {
      const title = $("tag-title").value.trim();
      if (!title) { $("tag-title").focus(); return; }
      const draft = {
        category: $("tag-category").value,
        title,
        note: $("tag-note").value.trim()
      };
      closeSheet();
      setPlacement({ kind: "tag", draft }, "TAP THE SPOT FOR: " + title.toUpperCase());
    });
    $("sh-cancel").addEventListener("click", closeSheet);
  });

  $("tb-status").addEventListener("click", () => {
    const my = me();
    if (!my) return;
    if (my.online) {
      SquadData.goOffline(session);
    } else if (my.x != null) {
      SquadData.goOnline(session);
    } else {
      switchTab("map");
      setPlacement({ kind: "checkin" }, "TAP YOUR POSITION TO GO ONLINE");
      return;
    }
    renderAll();
  });

  $("zoom-in").addEventListener("click", () => mapView && mapView.zoomStep(1.3));
  $("zoom-out").addEventListener("click", () => mapView && mapView.zoomStep(0.77));
  $("zoom-fit").addEventListener("click", () => mapView && mapView.fit());
  $("toggle-tiers").addEventListener("click", (e) => { if (mapView) e.currentTarget.classList.toggle("on", mapView.toggleTiers()); });

  /* ---------------- board ---------------- */

  $("post-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("post-input").value.trim();
    if (!text) return;
    SquadData.addPost(session, boardTab, text);
    $("post-input").value = "";
    renderAll();
  });

  /* ---------------- squad admin ---------------- */

  $("btn-leave").addEventListener("click", () => {
    openSheet(`
      <h3>LEAVE SQUAD</h3>
      <div class="sheet-body">You leave the shared picture. Your pins and tags stay for the squad.
        <div class="sheet-actions">
          <button class="btn danger" id="sh-do-leave" type="button">LEAVE</button>
          <button class="btn" id="sh-cancel" type="button">STAY</button>
        </div>
      </div>`);
    $("sh-do-leave").addEventListener("click", () => {
      if (unsubscribe) unsubscribe();
      SquadData.leaveSquad(session);
      session = null; state = null;
      closeSheet();
      showOnboard();
    });
    $("sh-cancel").addEventListener("click", closeSheet);
  });

  /* ---------------- boot ---------------- */

  const restored = SquadData.restoreSession();
  if (restored) {
    session = restored;
    enterApp();
  } else {
    showOnboard();
  }

  // Keep "x ago" labels honest while the app sits open.
  setInterval(() => { if (session && state) renderAll(); }, 60000);
})();
