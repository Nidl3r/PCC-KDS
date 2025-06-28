// firebaseConfig.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import {
  getFirestore,
  collection,
  onSnapshot,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  addDoc,
  query,
  where,
  getDocs,
  Timestamp
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCkDeNR98GOSi3D0Co5kGcrdruGaBw31vc",
  authDomain: "pcc-kds-5bee6.firebaseapp.com",
  projectId: "pcc-kds-5bee6",
  storageBucket: "pcc-kds-5bee6.appspot.com",
  messagingSenderId: "672801653224",
  appId: "1:672801653224:web:08b0536720e188298d645d",
  measurementId: "G-E49YCBZZEQ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Export all Firestore tools you need in script.js
export {
  db,
  collection,
  onSnapshot,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  addDoc,
  query,
  where,
  getDocs,
  Timestamp
};
