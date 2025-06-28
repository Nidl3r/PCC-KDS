// ✅ Import Firestore
import { db } from './firebaseConfig.js';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

// ✅ Handle screen switching
document.addEventListener("DOMContentLoaded", () => {
  const viewSelect = document.getElementById("viewSelect");
  const screens = document.querySelectorAll(".screen");

  function showScreen(id) {
    screens.forEach(screen => {
      screen.style.display = screen.id === id ? "block" : "none";
    });
  }

  // Initial view
  showScreen(viewSelect.value);

  // Change screen on dropdown change
  viewSelect.addEventListener("change", () => {
    showScreen(viewSelect.value);
  });

  console.log("✅ PCC KDS App Loaded");

  // ✅ Start listening for kitchen orders (if orders div exists)
  listenToOrders();
  loadGuestCounts();
});

// ✅ Render kitchen orders (optional Firestore integration)
function renderKitchen(orders) {
  const container = document.getElementById("orders");
  if (!container) return;

  container.innerHTML = "";
  orders.forEach(order => {
    const div = document.createElement("div");
    div.className = "order";
    div.textContent = `${order.item} ×${order.qty} (${order.station}) [${order.status}]`;
    container.appendChild(div);
  });
}

function listenToOrders() {
  const ordersRef = collection(db, "orders");

  onSnapshot(ordersRef, (snapshot) => {
    const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderKitchen(orders);
  });
}

// 🗓️ Utility: format date to YYYY-MM-DD
function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

// 🔄 Save guest counts to Firestore
const guestForm = document.getElementById("guest-count-form");
const statusDiv = document.getElementById("guest-count-status");

if (guestForm) {
  guestForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const counts = {
      Aloha: parseInt(document.getElementById("count-Aloha").value),
      Ohana: parseInt(document.getElementById("count-Ohana").value),
      Gateway: parseInt(document.getElementById("count-Gateway").value),
      timestamp: serverTimestamp()
    };

    try {
      await setDoc(doc(db, "guestCounts", getTodayDate()), counts);
      statusDiv.textContent = "✅ Guest counts saved!";
      statusDiv.style.color = "lightgreen";
    } catch (error) {
      console.error("❌ Error saving guest counts:", error);
      statusDiv.textContent = "⚠️ Failed to save counts.";
      statusDiv.style.color = "tomato";
    }
  });
}

// 🔽 Load saved guest counts on screen load
async function loadGuestCounts() {
  const docRef = doc(db, "guestCounts", getTodayDate());
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    const data = docSnap.data();
    if (data.Aloha) document.getElementById("count-Aloha").value = data.Aloha;
    if (data.Ohana) document.getElementById("count-Ohana").value = data.Ohana;
    if (data.Gateway) document.getElementById("count-Gateway").value = data.Gateway;
  }
}
// In your script.js file

import { db } from './firebaseConfig.js';
import { collection, addDoc, query, where, getDocs, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const placeholderUser = "testUser";

// Utility to get current area name from visible screen
function getCurrentArea() {
  const select = document.getElementById("viewSelect");
  return select.value.charAt(0).toUpperCase() + select.value.slice(1); // e.g., "aloha" -> "Aloha"
}

// === ALOHA: Add-ons ===
const addonsForm = document.getElementById("aloha-addons-form");
addonsForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const item = document.getElementById("aloha-addon-item").value;
  const quantity = Number(document.getElementById("aloha-addon-quantity").value);
  const station = document.getElementById("aloha-addon-station").value;

  await addDoc(collection(db, "orders"), {
    area: "Aloha",
    item,
    quantity,
    station,
    status: "sent",
    timestamp: Timestamp.now(),
    sentBy: placeholderUser
  });

  alert("Add-on sent to kitchen!");
  addonsForm.reset();
});

// === ALOHA: Starting Pars ===
const parForm = document.getElementById("aloha-par-form");
parForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const item = document.getElementById("aloha-par-item").value;
  const quantity = Number(document.getElementById("aloha-par-quantity").value);
  const unit = document.getElementById("aloha-par-unit").value;

  await addDoc(collection(db, "startingPars"), {
    area: "Aloha",
    item,
    quantity,
    unit,
    timestamp: Timestamp.now(),
    recordedBy: placeholderUser
  });

  alert("Starting par saved!");
  parForm.reset();
});

// === ALOHA: Waste ===
const wasteForm = document.getElementById("aloha-waste-form");
wasteForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const item = document.getElementById("aloha-waste-item").value;
  const quantity = Number(document.getElementById("aloha-waste-quantity").value);
  const reason = document.getElementById("aloha-waste-reason").value;

  await addDoc(collection(db, "waste"), {
    area: "Aloha",
    item,
    quantity,
    reason,
    timestamp: Timestamp.now(),
    recordedBy: placeholderUser
  });

  alert("Waste recorded.");
  wasteForm.reset();
});

// === ALOHA: Returns ===
const returnForm = document.getElementById("aloha-return-form");
returnForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const item = document.getElementById("aloha-return-item").value;
  const quantity = Number(document.getElementById("aloha-return-quantity").value);

  await addDoc(collection(db, "returns"), {
    area: "Aloha",
    item,
    quantity,
    status: "pending",
    timestamp: Timestamp.now(),
    returnedBy: placeholderUser
  });

  alert("Return submitted.");
  returnForm.reset();
});
