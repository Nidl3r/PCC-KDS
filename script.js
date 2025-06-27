// ✅ Import Firestore
import { db } from './firebaseConfig.js';
import {
  collection,
  onSnapshot
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
import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

// 🗓️ Utility: format date to YYYY-MM-DD
function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

const guestForm = document.getElementById("guest-count-form");
const statusDiv = document.getElementById("guest-count-status");

if (guestForm) {
  guestForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(guestForm).entries());
    const today = getTodayDate();

    try {
      await setDoc(doc(db, "guestCounts", today), {
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, parseInt(v)])
        ),
        timestamp: serverTimestamp()
      });

      statusDiv.textContent = "✅ Guest count saved!";
      statusDiv.style.color = "lightgreen";
    } catch (err) {
      console.error("Error saving guest count", err);
      statusDiv.textContent = "❌ Error saving guest count";
      statusDiv.style.color = "red";
    }
  });
}
import {
  setDoc,
  doc
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

// 🔄 Save guest counts to Firestore
document.getElementById("guest-count-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const counts = {
    Aloha: parseInt(document.getElementById("count-Aloha").value),
    Ohana: parseInt(document.getElementById("count-Ohana").value),
    Gateway: parseInt(document.getElementById("count-Gateway").value),
    timestamp: new Date().toISOString()
  };

  try {
    await setDoc(doc(db, "guestCounts", new Date().toISOString().split("T")[0]), counts);
    document.getElementById("guest-count-status").textContent = "✅ Guest counts saved!";
  } catch (error) {
    console.error("❌ Error saving guest counts:", error);
    document.getElementById("guest-count-status").textContent = "⚠️ Failed to save counts.";
  }
});
