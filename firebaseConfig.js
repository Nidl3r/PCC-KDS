// ✅ firebaseconfig.js (with FirestoreSettings.cache)

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
  orderBy
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

// ✅ Initialize Firestore with cache enabled
const db = initializeFirestore(app, {
  localCache: "persistent" // ✅ NEW recommended way to enable offline persistence
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
  orderBy
};
