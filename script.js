// ✅ Import your Firestore (keep this)
import { db } from './firebaseConfig.js';
import {
  collection,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

// ✅ Show screen based on dropdown
document.addEventListener("DOMContentLoaded", () => {
  const viewSelect = document.getElementById("viewSelect");
  const screens = document.querySelectorAll(".screen");

  function showScreen(id) {
    screens.forEach(screen => {
      screen.style.display = screen.id === id ? "block" : "none";
    });
  }

  showScreen(viewSelect.value); // show default screen

  viewSelect.addEventListener("change", () => {
    showScreen(viewSelect.value);
  });

  console.log("✅ KDS App Loaded");
});

// 🔁 Optional Firebase logic (will activate later)
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

listenToOrders(); // this is safe even if "orders" screen isn't built yet
// --- Show screen based on dropdown selection ---
document.getElementById("viewSelect").addEventListener("change", function () {
  const selectedId = this.value;
  const screens = document.querySelectorAll(".screen");

  screens.forEach(screen => {
    screen.style.display = screen.id === selectedId ? "block" : "none";
  });
});

// --- Show default screen on load ---
window.addEventListener("DOMContentLoaded", () => {
  const defaultView = document.getElementById("viewSelect").value;
  document.querySelectorAll(".screen").forEach(screen => {
    screen.style.display = screen.id === defaultView ? "block" : "none";
  });

  console.log("✅ PCC KDS App Loaded");
});
