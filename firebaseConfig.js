// ✅ firebaseconfig.js (with FirestoreSettings.cache + long-polling fallback)

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
  deleteDoc // ⬅️ already added
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// ✅ Firebase configuration
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
const analytics = getAnalytics(app);

// ✅ Initialize Firestore with persistent cache + long-polling fallback
const db = initializeFirestore(app, {
  localCache: "persistent", // offline persistence
  experimentalAutoDetectLongPolling: true, // automatically switch if streaming is blocked
  useFetchStreams: false // helps avoid QUIC/stream errors on some networks
});

// ✅ Export everything needed
export {
  db,
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
