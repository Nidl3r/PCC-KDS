// ✅ firebaseConfig.js — prod by default, emulators on localhost/flags (Codespaces-safe)

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-analytics.js";

import {
  initializeFirestore,
  // Optional durable cache (toggle via localStorage key FIRESTORE_CACHE=1)
  persistentLocalCache,
  persistentMultipleTabManager,

  // Firestore APIs re-exported for convenience
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
  arrayUnion,
  arrayRemove,
  increment,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

import {
  getAuth,
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

// NEW: Functions + Storage (optional)
import {
  getFunctions,
  connectFunctionsEmulator,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js";

import {
  getStorage,
  connectStorageEmulator,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-storage.js";

// 🔐 Production Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCkDeNR98GOSi3D0Co5kGcrdruGaBw31vc",
  authDomain: "pcc-kds-5bee6.firebaseapp.com",
  projectId: "pcc-kds-5bee6",
  storageBucket: "pcc-kds-5bee6.appspot.com",
  messagingSenderId: "672801653224",
  appId: "1:672801653224:web:08b0536720e188298d645d",
  measurementId: "G-E49YCBZZEQ",
};

// 🧭 Environment flags
const hasWindow = typeof window !== "undefined";
const hostname = hasWindow ? location.hostname : "";
const isLocalhost =
  hasWindow && (hostname === "localhost" || hostname === "127.0.0.1");
const onCodespaces = hasWindow && /\.github\.dev$/i.test(hostname);

// Treat these as "definitely prod" (ignore ?emu=1 on these)
const isProdHost =
  hasWindow &&
  /(web\.app|firebaseapp\.com)$/i.test(hostname); // add your custom domain if needed

// URL flag or sticky flag
const urlForcesEmu = hasWindow && /[?&]emu=1\b/.test(location.search);
const stickyForcesEmu =
  hasWindow && localStorage.getItem("USE_EMULATORS") === "1";

// Use emulators when on localhost OR forced via flag (works on Codespaces via ?emu=1 or sticky)
// Never allow emulators on known prod hosts
const useEmulators =
  !isProdHost && (isLocalhost || urlForcesEmu || stickyForcesEmu);

// Decide which host to use for emulators:
// - Local dev: 127.0.0.1 (loopback allowed under HTTPS)
// - Codespaces: the forwarded hostname (e.g. port-8080-xxxx.github.dev)
// - You can override via localStorage: EMU_HOST
const EMU_HOST =
  (hasWindow && localStorage.getItem("EMU_HOST")) ||
  (isLocalhost ? "127.0.0.1" : hostname);

// Allow port overrides via localStorage for convenience
const PORTS = {
  firestore: Number(localStorage.getItem("FIRESTORE_PORT")) || 8080,
  auth: Number(localStorage.getItem("AUTH_PORT")) || 9099,
  functions: Number(localStorage.getItem("FUNCTIONS_PORT")) || 5001,
  storage: Number(localStorage.getItem("STORAGE_PORT")) || 9199,
};

// Per-service host overrides (useful for Codespaces forwarded subdomains)
const HOSTS = {
  firestore: (hasWindow && localStorage.getItem("FIRESTORE_HOST")) || EMU_HOST,
  auth:      (hasWindow && localStorage.getItem("AUTH_HOST"))      || EMU_HOST,
  functions: (hasWindow && localStorage.getItem("FUNCTIONS_HOST")) || EMU_HOST,
  storage:   (hasWindow && localStorage.getItem("STORAGE_HOST"))   || EMU_HOST,
};

// If running behind *.github.dev, we should hit port 443 on that subdomain.
const isGithubDev = (h) => /\.github\.dev$/i.test(String(h || ""));
const portOr443 = (host, fallbackPort) => (isGithubDev(host) ? 443 : fallbackPort);


// 🧰 Optional: durable multi-tab cache (IndexedDB) toggle
// Turn on with: localStorage.setItem("FIRESTORE_CACHE","1")  (reload to apply)
// Turn off with: localStorage.removeItem("FIRESTORE_CACHE")
const useDurableCache =
  hasWindow && localStorage.getItem("FIRESTORE_CACHE") === "1";

// ✅ Initialize Firebase
const app = initializeApp(firebaseConfig);

// 🚫 Keep analytics off in local / emulator / codespaces (optional)
const disableAnalytics = isLocalhost || urlForcesEmu || stickyForcesEmu || onCodespaces;
const analytics = !hasWindow || disableAnalytics ? null : getAnalytics(app);

// ✅ Initialize Firestore
// - Long-polling helps on odd networks / Codespaces.
// - Durable cache is opt-in via FIRESTORE_CACHE so you can choose per device.
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false,
  ...(useDurableCache
    ? { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }
    : {}),
});

// ✅ Auth (ready for emulator)
const auth = getAuth(app);

// NEW: Functions/Storage (optional in your app)
const functions = getFunctions(app);
const storage = getStorage(app);

// 🔌 Hook up emulators (Firestore + Auth + (optional) Functions/Storage)
if (useEmulators) {
  try {
    connectFirestoreEmulator(db, HOSTS.firestore, portOr443(HOSTS.firestore, PORTS.firestore));
  } catch (e) { console.warn("Firestore emulator connect failed:", e); }

  try {
    // Use https:// when on *.github.dev, otherwise http://
    const authProto = isGithubDev(HOSTS.auth) ? "https" : "http";
    connectAuthEmulator(auth, `${authProto}://${HOSTS.auth}:${portOr443(HOSTS.auth, PORTS.auth)}`, { disableWarnings: true });
  } catch (e) { console.warn("Auth emulator connect failed:", e); }

  try {
    connectFunctionsEmulator(functions, HOSTS.functions, portOr443(HOSTS.functions, PORTS.functions));
  } catch (e) { console.info("Functions emulator not connected:", e?.message); }

  try {
    connectStorageEmulator(storage, HOSTS.storage, portOr443(HOSTS.storage, PORTS.storage));
  } catch (e) { console.info("Storage emulator not connected:", e?.message); }

  // 🎛️ Visible badge so you always know you're on the emulator
  try {
    const div = document.createElement("div");
    div.textContent =
      `Emulators: ` +
      `FS ${EMU_HOST}:${PORTS.firestore} | ` +
      `Auth ${EMU_HOST}:${PORTS.auth}` +
      (functions ? ` | Fn ${EMU_HOST}:${PORTS.functions}` : "") +
      (storage ? ` | Stg ${EMU_HOST}:${PORTS.storage}` : "");
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
      zIndex: 999999,
      pointerEvents: "none",
    });
    document.addEventListener("DOMContentLoaded", () =>
      document.body.appendChild(div)
    );
    // Also expose a tiny runtime flag & details
    window.__USING_FIREBASE_EMULATORS__ = true;
  } catch {}
} else {
  if (hasWindow) window.__USING_FIREBASE_EMULATORS__ = false;
}

if (hasWindow) {
  window.__emuSetHosts = (hosts = {}, ports = {}) => {
    if (hosts.firestore) localStorage.setItem("FIRESTORE_HOST", hosts.firestore);
    if (hosts.auth)      localStorage.setItem("AUTH_HOST", hosts.auth);
    if (hosts.functions) localStorage.setItem("FUNCTIONS_HOST", hosts.functions);
    if (hosts.storage)   localStorage.setItem("STORAGE_HOST", hosts.storage);

    if (ports.firestore) localStorage.setItem("FIRESTORE_PORT", String(ports.firestore));
    if (ports.auth)      localStorage.setItem("AUTH_PORT", String(ports.auth));
    if (ports.functions) localStorage.setItem("FUNCTIONS_PORT", String(ports.functions));
    if (ports.storage)   localStorage.setItem("STORAGE_PORT", String(ports.storage));

    localStorage.setItem("USE_EMULATORS", "1");
    location.reload();
  };
}


// 🧷 Handy runtime toggles (optional, unchanged + a couple extras)
if (hasWindow) {
  window.__toggleEmulators = (on = true) => {
    if (on) localStorage.setItem("USE_EMULATORS", "1");
    else localStorage.removeItem("USE_EMULATORS");
    location.reload();
  };
  window.__toggleCache = (on = true) => {
    if (on) localStorage.setItem("FIRESTORE_CACHE", "1");
    else localStorage.removeItem("FIRESTORE_CACHE");
    location.reload();
  };
  // Optional helpers to tweak host/ports at runtime without code changes
  window.__emuSet = (host = EMU_HOST, p = {}) => {
    if (host) localStorage.setItem("EMU_HOST", host);
    if (p.firestore) localStorage.setItem("FIRESTORE_PORT", String(p.firestore));
    if (p.auth) localStorage.setItem("AUTH_PORT", String(p.auth));
    if (p.functions) localStorage.setItem("FUNCTIONS_PORT", String(p.functions));
    if (p.storage) localStorage.setItem("STORAGE_PORT", String(p.storage));
    localStorage.setItem("USE_EMULATORS", "1");
    location.reload();
  };
  window.__emuClear = () => {
    ["EMU_HOST", "FIRESTORE_PORT", "AUTH_PORT", "FUNCTIONS_PORT", "STORAGE_PORT", "USE_EMULATORS"].forEach(
      (k) => localStorage.removeItem(k)
    );
    location.reload();
  };
  // Small debug snapshot
  window.firebaseEnv = {
    host: hostname,
    isLocalhost,
    onCodespaces,
    isProdHost,
    useEmulators,
    EMU_HOST,
    PORTS,
    useDurableCache,
  };
}

// ✅ Export everything needed by your app (unchanged + new optional services)
export {
  db,
  auth,
  functions,
  storage,
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
  arrayUnion,
  arrayRemove,
  increment,
};
