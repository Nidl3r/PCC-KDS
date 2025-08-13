// ✅ firebaseConfig.js — prod by default, emulators on localhost/flags (Codespaces-safe)

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-analytics.js";
import {
  initializeFirestore,
  // (optional) if you want stronger control over cache across tabs, switch to:
  // persistentLocalCache, persistentMultipleTabManager,
  collection,
  doc,
  setDoc,
  getDoc,
  addDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  query,
  where,
  getDocs,
  Timestamp,
  orderBy,
  limit,
  deleteDoc,
  connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import {
  getAuth,
  connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

// 🔐 Production Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCkDeNR98GOSi3D0Co5kGcrdruGaBw31vc",
  authDomain: "pcc-kds-5bee6.firebaseapp.com",
  projectId: "pcc-kds-5bee6",
  storageBucket: "pcc-kds-5bee6.appspot.com",
  messagingSenderId: "672801653224",
  appId: "1:672801653224:web:08b0536720e188298d645d",
  measurementId: "G-E49YCBZZEQ"
};

// 🧭 Environment flags
const hasWindow = typeof window !== "undefined";
const hostname = hasWindow ? location.hostname : "";
const isLocalhost = hasWindow && (hostname === "localhost" || hostname === "127.0.0.1");
const onCodespaces = hasWindow && /\.github\.dev$/i.test(hostname);

// URL flag or sticky flag
const urlForcesEmu = hasWindow && /[?&]emu=1\b/.test(location.search);
const stickyForcesEmu = hasWindow && localStorage.getItem("USE_EMULATORS") === "1";

// Use emulators when on localhost OR forced via flag (works on Codespaces)
const useEmulators = isLocalhost || urlForcesEmu || stickyForcesEmu;

// Decide which host to use for emulators:
// - Local dev: 127.0.0.1 (loopback allowed under HTTPS)
// - Codespaces: the forwarded hostname (e.g. port-8080-xxxx.github.dev)
const EMU_HOST = isLocalhost ? "127.0.0.1" : hostname;

// ✅ Initialize Firebase
const app = initializeApp(firebaseConfig);

// 🚫 Keep analytics off in local / emulator / codespaces (optional)
const disableAnalytics = isLocalhost || urlForcesEmu || stickyForcesEmu || onCodespaces;
const analytics = (!hasWindow || disableAnalytics) ? null : getAnalytics(app);

// ✅ Initialize Firestore (with auto long‑polling fallback for odd networks)
const db = initializeFirestore(app, {
  // If you want multi‑tab durable cache, switch to:
  // localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  // (requires importing those two from firestore)
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false
});

// ✅ Auth (ready for emulator)
const auth = getAuth(app);

// 🔌 Hook up emulators (Firestore + Auth)
if (useEmulators) {
  try {
    connectFirestoreEmulator(db, EMU_HOST, 8080);
    // Note: on Codespaces you must forward 8080 and 9099
  } catch (e) {
    console.warn("Firestore emulator connect failed:", e);
  }
  try {
    connectAuthEmulator(auth, `http://${EMU_HOST}:9099`, { disableWarnings: true });
  } catch (e) {
    console.warn("Auth emulator connect failed:", e);
  }

  // 🎛️ Small visible badge so you always know you're on the emulator
  try {
    const div = document.createElement("div");
    div.textContent = `Firestore: Emulator (${EMU_HOST}:8080)`;
    Object.assign(div.style, {
      position: "fixed",
      bottom: "10px",
      right: "10px",
      font: "12px system-ui, sans-serif",
      background: "rgba(20,160,20,.10)",
      color: "#0a7a0a",
      border: "1px solid rgba(20,160,20,.35)",
      borderRadius: "8px",
      padding: "6px 10px",
      zIndex: 999999
    });
    document.addEventListener("DOMContentLoaded", () => document.body.appendChild(div));
    // Also expose a tiny runtime flag
    window.__USING_FIREBASE_EMULATORS__ = true;
  } catch {}
} else {
  // Explicit flag
  if (hasWindow) window.__USING_FIREBASE_EMULATORS__ = false;
}

// ✅ Export everything needed by your app
export {
  db,
  auth,
  collection,
  doc,
  setDoc,
  getDoc,
  addDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  query,
  where,
  getDocs,
  Timestamp,
  orderBy,
  limit,
  deleteDoc
};
