# Squad Map

A DayZ squad companion for ChernarusPlus. Your squad shares **one live map
picture** even though nobody plays at the same time:

- **Squads by invite code** — create a squad, get a 6-letter code, friends
  join with it.
- **Check-in pins** — tap the map where you are; your pin drops and the
  squad sees you online.
- **Last-seen pins** — go offline and your pin freezes in place, greyed,
  with where and when you were last seen.
- **Shared tags** — Stash, Loot, Base, Danger, Vehicle, For Sale, Needed,
  with titles and notes, placed anywhere on the map.
- **Activity feed** — every check-in, tag, and offline event lands as a
  feed entry; tap one and the map jumps to that spot.
- **Squad board** — Chat / Finds / For Sale / Needs tabs for what the squad
  found, is selling, and still needs.

The Android app is a thin native shell (Kotlin, WebView) around a bundled
web app in `app/src/main/assets/www/`, styled in the HOD Pulse palette —
near-black charcoal, olive drab, amber. The map is a labeled schematic of
ChernarusPlus with the major towns at their real relative positions and a
DayZ grid; `www/map.js` is the single swap point for real map tiles later.

## Demo mode (what ships today)

The data layer (`www/data.js`) is written against the Firebase/Firestore
document layout — `squads/{code}` with `members`, `tags`, `posts`, and
`feed` subcollections — but runs on a **demo adapter** that keeps that same
document tree in the device's localStorage. Consequences:

- The full app works **offline, on one phone**, with nobody else connected.
- A standing demo squad, **HAVOC6**, is seeded so the join flow works, and
  new squads show two demo squadmates (Ahab, Joker) so last-seen pins are
  visible immediately.
- Squads do **not** sync between phones yet. That is the Firebase step
  below, and it needs no UI changes.

## Go live — remaining steps, in order

1. **Create the Firebase project** (Art, in a browser):
   - <https://console.firebase.google.com> → Add project (any name).
   - Inside it: Build → Firestore Database → Create database.
   - Project Overview → add a **Web app** (`</>` icon) → copy the
     `firebaseConfig` object it shows.
2. **Paste the config**: open `app/src/main/assets/www/firebase-config.js`
   and replace the empty strings with the values from step 1. That file is
   the only place the keys live. (The data adapter detects a real `apiKey`
   and switches off demo mode automatically; shipping the Firebase web SDK
   script tags in `index.html` beside it is the one code touch that goes
   with it.)
3. **Put this project on GitHub** as its own repo (e.g. `Squad-Map`), the
   same way HOD-Pulse was pushed.
4. **Flip the GitHub app permission**: GitHub → Settings → Installations →
   Meta Muse AI → set **Contents: Read and write** for the repo, so the
   agent can push workflow fixes later. (This is the same switch that
   HOD Pulse was waiting on.)
5. **Push to `main`.** The workflow in `.github/workflows/build-apk.yml`
   builds on JDK 17 / Gradle 9.3.1 / Android SDK 36, signs with a cached
   debug keystore (generated on first run), and publishes the APK.
6. **Share the link**: the finished APK lands on the repo's rolling release:
   `https://github.com/<owner>/<repo>/releases/tag/apk-latest` — that URL
   is the one friends open to download and install `app-debug.apk`
   (they allow "install unknown apps" once).

## Building locally (optional)

With JDK 17 and the Android SDK installed:

```
gradle :app:assembleDebug
```

The debug build signs with `${rootDir}/debug.keystore` (alias
`androiddebugkey`, password `android`) — generate one with `keytool` if it
doesn't exist; CI generates and caches its own.
