"use strict";

/*
 * SQUAD MAP — FIREBASE CONFIG PLACEHOLDER
 * =======================================
 * This is where the real Firebase web config goes when the app goes live.
 *
 * Steps:
 *   1. Go to https://console.firebase.google.com and create a project.
 *   2. Add a Web app to the project (the </> icon) — no hosting needed.
 *   3. Enable Firestore Database (production mode is fine).
 *   4. Copy the firebaseConfig object Firebase shows you into the object
 *      below, replacing every empty string.
 *
 * While every value here is empty, data.js runs in DEMO MODE: all squads,
 * members, tags and posts live in this device's localStorage only, so the
 * full app works offline with nobody else connected. The moment a real
 * apiKey is present, data.js switches to its Firestore adapter instead —
 * no UI code changes needed.
 */
window.SQUADMAP_FIREBASE_CONFIG = {
  apiKey: "AIzaSyACAQO97XmPCJJ4QjVdB22TeLtXtgLXMrY",
  authDomain: "squad-map-f097c.firebaseapp.com",
  projectId: "squad-map-f097c",
  storageBucket: "squad-map-f097c.firebasestorage.app",
  messagingSenderId: "685643817207",
  appId: "1:685643817207:web:d632d7103fc615532cb3f2"
};
