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
  applyCategoryFilter("aloha");
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

  // Re-apply item filtering when a tab is opened (optional)
  if (sectionId === "order") {
    applyCategoryFilter(area);
  }
};

const alohaCategorySelect = document.getElementById("alohaCategory");
const alohaItemSelect = document.getElementById("alohaItem");

alohaCategorySelect?.addEventListener("change", () => {
  applyCategoryFilter("aloha");
});

async function applyCategoryFilter(area) {
  const category = document.getElementById(`${area.toLowerCase()}Category`).value;
  const select = document.getElementById(`${area.toLowerCase()}Item`);
  select.innerHTML = "<option value=''>-- Select Item --</option>";

  try {
    const snapshot = await getDocs(collection(db, "recipes"));
    console.log(`📦 Loaded ${snapshot.size} recipes`);

    snapshot.forEach(doc => {
      const recipe = doc.data();
      const recipeNo = recipe.recipeNo || "(no recipeNo)";
      const station = recipe.station || "(no station)";

      console.log(`🔍 Checking: ${recipeNo} | station: ${station}`);
if (!category || recipe.station?.toLowerCase() === category.toLowerCase())

      // Only include recipes that have Aloha field (venue-specific filter)
      if (!recipe.Aloha) {
        console.log(`❌ Skipped ${recipeNo} - missing Aloha field`);
        return;
      }

      // Category filter based on station
      if (category && station.toLowerCase() !== category.toLowerCase()) {
        console.log(`❌ Skipped ${recipeNo} - station mismatch (${station} !== ${category})`);
        return;
      }

      // ✅ Add recipe to dropdown
      console.log(`✅ Included: ${recipeNo}`);
      const option = document.createElement("option");
      option.value = recipe.recipeNo;
      option.textContent = `${recipe.recipeNo} - ${recipe.description}`;
      select.appendChild(option);
    });

    if (select.children.length === 1) {
      console.warn("⚠️ No recipes matched the filters.");
    }
  } catch (err) {
    console.error("❌ Failed to load recipes:", err);
  }
}



window.applyCategoryFilter = applyCategoryFilter;

