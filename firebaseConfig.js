// ✅ firebaseConfig.js — prod by default, emulators on localhost/flag

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-analytics.js";
import {
  initializeFirestore,
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

// ✅ Production Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCkDeNR98GOSi3D0Co5kGcrdruGaBw31vc",
  authDomain: "pcc-kds-5bee6.firebaseapp.com",
  projectId: "pcc-kds-5bee6",
  storageBucket: "pcc-kds-5bee6.appspot.com",
  messagingSenderId: "672801653224",
  appId: "1:672801653224:web:08b0536720e188298d645d",
  measurementId: "G-E49YCBZZEQ"
};

// ✅ Initialize Firebase
const app = initializeApp(firebaseConfig);

// Disable analytics on localhost to keep noise out of GA
const isLocalhost = typeof window !== "undefined" && location.hostname === "localhost";
const analytics = !isLocalhost ? getAnalytics(app) : null;

// ✅ Initialize Firestore with cache + long‑polling fallback
const db = initializeFirestore(app, {
  localCache: "persistent",                 // offline persistence (kept as-is)
  experimentalAutoDetectLongPolling: true,  // fallback if streams blocked
  useFetchStreams: false
});

// ✅ Auth (optional but ready for emulator)
const auth = getAuth(app);

// 🔌 Emulator toggle: localhost OR ?emu=1 OR localStorage.USE_EMULATORS='1'
const forceEmu = (typeof window !== "undefined") &&
  (/[?&]emu=1\b/.test(location.search) || localStorage.getItem("USE_EMULATORS") === "1");

if (isLocalhost || forceEmu) {
  try {
    connectFirestoreEmulator(db, "localhost", 8080);
  } catch (e) {
    console.warn("Firestore emulator connect failed:", e);
  }
  try {
    connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
  } catch (e) {
    console.warn("Auth emulator connect failed:", e);
  }
}

// ✅ Export everything needed
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
