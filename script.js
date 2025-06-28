import {
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
} from './firebaseConfig.js';

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
      const ref = doc(db, "guestCounts", getTodayDate());
      const existingDoc = await getDoc(ref);
      if (existingDoc.exists()) {
        await setDoc(ref, { ...existingDoc.data(), ...counts }, { merge: true });
      } else {
        await setDoc(ref, counts);
      }
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

const placeholderUser = "testUser";

// 🌐 New tab switcher for area pages like Aloha
window.showAreaSection = function(area, sectionId) {
  area = area.toLowerCase(); // ensure consistency
  const allSections = document.querySelectorAll(`.${area}-section`);

  allSections.forEach(sec => {
    sec.style.display = sec.dataset.sec === sectionId ? "block" : "none";
  });
};
const alohaCategorySelect = document.getElementById("alohaCategory");
const alohaItemSelect = document.getElementById("alohaItem");

alohaCategorySelect?.addEventListener("change", () => {
  applyCategoryFilter("aloha");
});
async function applyCategoryFilter(area) {
  const venueCode = "b001"; // Aloha
  const section = document.getElementById(`${area}Category`).value;

  const recipesRef = collection(db, "recipes");
  let q = query(recipesRef, where("venue", "==", venueCode));
  if (section) {
    q = query(recipesRef, where("venue", "==", venueCode), where("section", "==", section));
  }

  const snapshot = await getDocs(q);
  const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const itemSelect = document.getElementById(`${area}Item`);
  itemSelect.innerHTML = `<option value="">-- Select Item --</option>`;
  items.forEach(item => {
    itemSelect.innerHTML += `<option value="${item.recipeNo}">${item.description}</option>`;
  });
}
window.applyCategoryFilter = applyCategoryFilter;
