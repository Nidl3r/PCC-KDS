import {
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
} from './firebaseConfig.js';


window.startingCache = {};

window.applyCategoryFilter = applyCategoryFilter; // ✅ expose it to window

// Set currentVenue on load
const viewSelect = document.getElementById("viewSelect");

function updateCurrentVenueFromSelect() {
  const val = viewSelect.value;

  // Hide ALL venue screens
  document.querySelectorAll(".screen").forEach(s => s.style.display = "none");

  // Hide ALL tabbed sections inside each venue
  document.querySelectorAll(".aloha-section, .ohana-section, .gateway-section, .concession-section, .main-kitchen-section")
    .forEach(s => s.style.display = "none");

  // Show the selected screen
  const selectedScreen = document.getElementById(val);
  if (selectedScreen) selectedScreen.style.display = "block";

  // Set current venue display name
  const map = {
    aloha: "Aloha",
    ohana: "Ohana",
    gateway: "Gateway",
    concession: "Concessions",
    "main-kitchen": "Main Kitchen"
  };
  window.currentVenue = map[val] || "Main Kitchen";
  document.getElementById("currentVenueLabel").innerText = window.currentVenue;

  // Reset the tab content inside that venue
  if (val === "aloha") {
    showAreaSection("aloha", "order");
  } else if (val === "ohana") {
    showAreaSection("ohana", "order");
  } else if (val === "gateway") {
    showAreaSection("gateway", "order");
  } else if (val === "concession") {
    showAreaSection("concession", "order");
  } else if (val === "main-kitchen") {
    showKitchenSection("order");
  }
}



// Update on change
viewSelect.addEventListener("change", updateCurrentVenueFromSelect);

document.addEventListener("DOMContentLoaded", () => {
  const viewSelect = document.getElementById("viewSelect");
  const screens = document.querySelectorAll(".screen");
  const chatBox = document.getElementById("chatBox");

  function showScreen(id) {
    screens.forEach(screen => {
      screen.style.display = screen.id === id ? "block" : "none";
    });

    // 🔧 Optional: make sure chat stays visible
    if (chatBox) chatBox.style.display = "block";
  }

  // Set initial screen
  showScreen(viewSelect.value);

  // Change screen on selection
  viewSelect.addEventListener("change", () => {
    showScreen(viewSelect.value);
    updateCurrentVenueFromSelect(); // ✅ Ensure currentVenue updates on change
  });

  console.log("✅ PCC KDS App Loaded");

  // 🔁 Listen to Firestore collections
  listenToAlohaOrders?.();      
  listenToGatewayOrders?.();    
  listenToOhanaOrders?.();      
  listenToConcessionOrders?.(); // ✅ Concession listener added
  listenToAddonOrders?.();
  loadGuestCounts?.();            

  // 🔽 Apply category filter on load for all venues
  ["aloha", "gateway", "ohana", "concession"].forEach(area => {
    applyCategoryFilter?.(area);
  });

  // 🚀 Start listeners for each station
  ["Wok", "Fryer", "Grill", "Oven", "Pantry", "Pastry"].forEach(station => {
    listenToStationOrders?.(station);
  });

  // 💰 Delay for cost summary input listeners (includes Concessions)
 setTimeout(() => {
  ["Aloha", "Gateway", "Ohana"].forEach(venue => { // ❌ Removed "Concessions"
    listenToVenueOrdersAndUpdateCost?.(venue);

    const inputId = `guestInput${venue === "Aloha" ? "" : venue}`;
    const guestInput = document.getElementById(inputId);

    if (guestInput) {
      guestInput.addEventListener("input", () => {
        updateCostSummaryForVenue?.(venue);
      });
    }
  });
}, 250);

});



// 🔁 Live Firestore snapshot listener
function listenToVenueOrdersAndUpdateCost(venueName) {
  const today = getTodayDate(); // e.g., "2025-07-17"

  const q = query(
    collection(db, "orders"),
    where("venue", "==", venueName),
    where("date", "==", today)
  );

  onSnapshot(q, () => {
    console.log(`📡 Firestore update received for ${venueName}`);
    updateCostSummaryForVenue(venueName);
  });
}



//offline banner
function updateOfflineBanner() {
  const banner = document.getElementById("offlineBanner");
  if (navigator.onLine) {
    banner.style.display = "none";
  } else {
    banner.style.display = "block";
  }
}

window.addEventListener("online", updateOfflineBanner);
window.addEventListener("offline", updateOfflineBanner);
window.addEventListener("load", updateOfflineBanner); // show correct state on first load


//**accounting */
window.unlockAccounting = function () {
  const input = document.getElementById("accountingPass").value;

  if (input === "206841") {
    document.getElementById("accounting-lock").style.display = "none";
    document.getElementById("accounting-content").style.display = "block";
    console.log("✅ Accounting Unlocked");

    // Show default tab (Production)
    showAccountingTab("production");

    // Preload empty Production Shipments (update with real data later)
    loadProductionShipments([]);
  } else {
    alert("❌ Incorrect code.");
  }
};

// 🧭 Switch between tabs
function showAccountingTab(tabName) {
  document.querySelectorAll(".accounting-section").forEach(sec => {
    sec.style.display = sec.dataset.sec === tabName ? "block" : "none";
  });

  if (tabName === "production") {
    loadProductionSummary();
  }

  if (tabName === "waste") {
    loadAccountingWaste();
  }

  if (tabName === "lunch") {
    loadLunchAccountingTable();
  }
}

window.showAccountingTab = showAccountingTab;


// ✅ Render kitchen add ons
const kitchenSendQtyCache = {};

function renderKitchen(orders, { skipCache = false } = {}) {
  // ✅ Only cache the full list if not skipping
  if (!skipCache) {
    window.kitchenFullOrderList = [...orders]; // preserve original
  }

  window.kitchenOrderCache = orders;

  const container = document.getElementById("kitchenTable").querySelector("tbody");
  if (!container) return;

  container.innerHTML = "";


  // Sort by priority and time
  orders.sort((a, b) => {
    const priority = { "Ready to Send": 0, "open": 1 };
    const aPriority = priority[a.status] ?? 2;
    const bPriority = priority[b.status] ?? 2;

    if (aPriority !== bPriority) return aPriority - bPriority;

    const timeA = a.timestamp?.toDate?.() || new Date(0);
    const timeB = b.timestamp?.toDate?.() || new Date(0);
    return timeA - timeB;
  });

  // ❌ Filter out grill items from Gateway only
  orders = orders.filter(order => {
    const isGatewayGrill = order.venue === "Gateway" && order.station === "Grill";
    return !isGatewayGrill;
  });


  orders.forEach(order => {
    const row = document.createElement("tr");

    const createdAt = order.timestamp?.toDate?.() || new Date();
    const cookTime = order.cookTime || 0;
    const dueTime = new Date(createdAt.getTime() + cookTime * 60000);
    const now = new Date();

    const timeFormatted = createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dueFormatted = dueTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const isLate = dueTime < now;
    if (isLate) row.style.backgroundColor = "rgba(255, 0, 0, 0.15)";

    const cachedQty = kitchenSendQtyCache[order.id] ?? "";

    row.innerHTML = `
      <td>${timeFormatted}</td>
      <td>${dueFormatted}</td>
      <td>${order.venue || ""}</td>
      <td>${order.item}</td>
      <td>${order.notes || ""}</td>
      <td>${order.qty}</td>
      <td>${order.status}</td>
      <td>
        <input
          type="number"
          min="0.01"
          step="0.01"
          value="${cachedQty}"
          class="send-qty-input"
          data-order-id="${order.id}"
        />
      </td>
      <td>${order.uom || "ea"}</td>
      <td>
        <button onclick="sendKitchenOrder('${order.id}', this)" disabled>Send</button>
      </td>
    `;

    container.appendChild(row);
  });

  // 🔄 Add input listeners to enable/disable send buttons
  container.querySelectorAll(".send-qty-input").forEach(input => {
    input.addEventListener("input", () => {
      const id = input.getAttribute("data-order-id");
      const sendBtn = input.closest("tr")?.querySelector("button");

      const val = parseFloat(input.value);
      const isValid = !isNaN(val) && val > 0;

      kitchenSendQtyCache[id] = isValid ? val : 0;

      if (sendBtn) {
        sendBtn.disabled = !isValid;
      }
    });
  });

}

window.filterKitchenOrders = function () {
  const searchValue = document.getElementById("kitchenSearchInput").value.trim().toLowerCase();

  // ✅ If search is empty, restore full list
  if (!searchValue) {
    renderKitchen(window.kitchenFullOrderList, { skipCache: true });
    return;
  }

  const filtered = window.kitchenFullOrderList.filter(order =>
    order.item?.toLowerCase().includes(searchValue)
  );

  renderKitchen(filtered, { skipCache: true });
};

function showMainKitchenNotif(message, duration = 3000, type = "info") {
  const notif = document.getElementById("mainKitchenNotif");
  if (!notif) {
    console.warn("❌ Tried to notify Main Kitchen but notif element doesn't exist.");
    return;
  }

  notif.textContent = message;

  const styles = {
    success: { background: "#2e7d32", border: "#1b5e20" },
    error: { background: "#c62828", border: "#b71c1c" },
    info: { background: "#1565c0", border: "#0d47a1" }
  };

  const { background, border } = styles[type] || styles.info;
  notif.style.background = background;
  notif.style.border = `1px solid ${border}`;
  notif.style.display = "block";

  setTimeout(() => {
    notif.style.display = "none";
  }, duration);
}

let previousAddonOrders = [];

function listenToAddonOrders() {
  const ordersRef = collection(db, "orders");

  const addonQuery = query(
    ordersRef,
    where("type", "==", "addon"),
    where("status", "in", ["open", "Ready to Send"])
  );

  onSnapshot(addonQuery, (snapshot) => {
    const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log("📦 Snapshot received:", orders.length, "orders");

    // ✅ Render all orders for the kitchen
    renderKitchen(orders);

    const currentIds = orders.map(o => o.id);
    const deletedOrders = previousAddonOrders.filter(o => !currentIds.includes(o.id));

    if (deletedOrders.length > 0) {
      console.log("🗑️ Deleted orders detected:", deletedOrders.map(o => o.item));
    }

    deletedOrders.forEach(deleted => {
      console.log("🔔 Notifying deletion of:", deleted.item);
      showMainKitchenNotif(`🗑️ Order deleted: ${deleted.item}`, 4000, "info");
    });

    snapshot.docChanges().forEach(change => {
      const data = change.doc.data();
      if (change.type === "modified") {
        console.log("✏️ Order updated:", data.item);
        showMainKitchenNotif(`✏️ Order updated: ${data.item}`, 4000, "info");
      }
    });

    // ✅ Update cache after everything
    previousAddonOrders = orders;
  });
}




// 🗓️ Utility: format date to YYYY-MM-DD
function getTodayDate() {
  // Get current UTC time
  const now = new Date();

  // Convert to Hawaii time (UTC-10)
  const hawaiiOffsetMs = -10 * 60 * 60 * 1000;
  const hawaiiNow = new Date(now.getTime() + hawaiiOffsetMs);

  // Format as YYYY-MM-DD
  const year = hawaiiNow.getUTCFullYear();
  const month = String(hawaiiNow.getUTCMonth() + 1).padStart(2, '0');
  const day = String(hawaiiNow.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
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

async function loadGuestCounts() {
  const docRef = doc(db, "guestCounts", getTodayDate());
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    const data = docSnap.data();

    if (data.Aloha) {
      document.getElementById("count-Aloha").value = data.Aloha;
      document.getElementById("current-Aloha").textContent = data.Aloha;
    }

    if (data.Ohana) {
      document.getElementById("count-Ohana").value = data.Ohana;
      document.getElementById("current-Ohana").textContent = data.Ohana;
    }

    if (data.Gateway) {
      document.getElementById("count-Gateway").value = data.Gateway;
      document.getElementById("current-Gateway").textContent = data.Gateway;
    }
  }
}


const placeholderUser = "testUser";

window.showAreaSection = function (area, sectionId) {
  area = area.toLowerCase();
  const allSections = document.querySelectorAll(`.${area}-section`);
  
  allSections.forEach(sec => {
    sec.style.display = sec.dataset.sec === sectionId ? "block" : "none";
  });

  const allTabs = document.querySelectorAll(`.area-tab[data-area="${area}"]`);
  allTabs.forEach(tab => {
    tab.classList.toggle("active", tab.dataset.sec === sectionId);
  });

  // Order tab logic
  if (sectionId === "order") {
    applyCategoryFilter(area);
  }

  // Starting Par
  if (sectionId === "starting") {
    if (area === "aloha") loadAlohaStartingPar();
    else if (area === "gateway") loadGatewayStartingPar();
    else if (area === "ohana") loadOhanaStartingPar();
    else if (area === "concession") loadConcessionStartingPar();
  }

  // Waste
  if (sectionId === "waste") {
    if (area === "aloha") loadAlohaWaste();
    else if (area === "gateway") loadGatewayWaste();
    else if (area === "ohana") loadOhanaWaste();
  }

  // Returns
  if (sectionId === "returns") {
    if (area === "aloha") loadAlohaReturns();
    else if (area === "gateway") loadGatewayReturns();
    else if (area === "ohana") loadOhanaReturns();
  }
};


//*load kitchen 
// window.showKitchenSection
window.showKitchenSection = function (sectionId) {
  const mainKitchen = document.getElementById("main-kitchen");

  // Hide all sections (now includes 'lunch-section')
  const allSections = mainKitchen.querySelectorAll(
    ".order-section, .starting-section, .waste-section, .returns-section, .lunch-section"
  );
  allSections.forEach(sec => {
    sec.style.display = "none";
  });

  // Show selected section
  const sectionToShow = mainKitchen.querySelector(`.${sectionId}-section`);
  if (sectionToShow) {
    sectionToShow.style.display = "block";
  } else {
    console.warn(`⚠️ Section .${sectionId}-section not found in #main-kitchen`);
  }

  // Highlight active tab
  const allTabs = document.querySelectorAll('.area-tab[data-area="mainkitchen"]');
  allTabs.forEach(tab => {
    tab.classList.toggle("active", tab.dataset.sec === sectionId);
  });

  // Show send controls only for 'starting' if element exists
  const controls = document.getElementById("mainKitchenControls");
  if (controls) {
    controls.style.display = sectionId === "starting" ? "flex" : "none";
  }

  // Load section-specific data
  if (sectionId === "starting") {
    loadMainKitchenStartingPars();
  } else if (sectionId === "waste") {
    loadMainKitchenWaste();
  } else if (sectionId === "returns") {
    loadMainKitchenReturns();
  } else if (sectionId === "lunch") {
    loadMainKitchenLunch();
  }
};



//**ALOHA*/


const alohaCategorySelect = document.getElementById("alohaCategory");
const alohaItemSelect = document.getElementById("alohaItem");

alohaCategorySelect?.addEventListener("change", () => {
  applyCategoryFilter("aloha");
});

async function applyCategoryFilter(area) {
  const category = document.getElementById(`${area.toLowerCase()}Category`)?.value;
  const select = document.getElementById(`${area.toLowerCase()}Item`);
  if (!select) return;

  select.innerHTML = "<option value=''>-- Select Item --</option>";

  // Set venueCodes based on area
  const venueCodes = area.toLowerCase() === "aloha" ? ["b001"]
                    : area.toLowerCase() === "ohana" ? ["b002"]
                    : area.toLowerCase() === "gateway" ? ["b003"]
                    : area.toLowerCase() === "concession" ? ["c002", "c003", "c004"]
                    : [];

  if (venueCodes.length === 0) return;

  try {
    // ✅ Use cached recipes if available
    if (!window.cachedRecipeList) {
      const recipesRef = collection(db, "recipes");
      const snapshot = await getDocs(recipesRef);
      window.cachedRecipeList = snapshot.docs.map(doc => doc.data());
      console.log("📦 Cached all recipes:", window.cachedRecipeList.length);
    }

    // 🔍 Filter by venue + category
    const filteredDocs = window.cachedRecipeList.filter(data => {
      const matchesVenue = data.venueCodes?.some(code => venueCodes.includes(code));
      const matchesCategory = category
        ? data.category?.toUpperCase() === category.toUpperCase()
        : true;
      return matchesVenue && matchesCategory;
    });

    console.log(`📦 Filtered ${filteredDocs.length} recipes for ${area}`);

    filteredDocs.forEach(recipe => {
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

// Sends Aloha add-on orders
let recentAlohaOrders = new Map();

window.sendAlohaOrder = async function(button) {
  const itemSelect = document.getElementById("alohaItem");
  const qtyInput = document.getElementById("alohaQty");
  const notesInput = document.getElementById("alohaNotes");

  const recipeNo = itemSelect.value;
  const notes = notesInput?.value?.trim() || "";
  const qty = parseFloat(parseFloat(qtyInput.value || 0).toFixed(2));

  if (!recipeNo || isNaN(qty) || qty <= 0) {
    alert("Please select an item and enter a valid quantity.");
    return;
  }

  // ⏳ Prevent duplicate sends
  const cacheKey = `${recipeNo}-${qty}`;
  const now = Date.now();
  if (recentAlohaOrders.has(cacheKey) && now - recentAlohaOrders.get(cacheKey) < 5000) {
    alert("⏳ You've already sent this item recently. Please wait.");
    return;
  }
  recentAlohaOrders.set(cacheKey, now);

  button.disabled = true;

  try {
    const recipeSnapshot = await getDocs(
      query(collection(db, "recipes"), where("recipeNo", "==", recipeNo))
    );

    if (recipeSnapshot.empty) {
      alert("❌ Recipe not found.");
      return;
    }

    const recipeData = recipeSnapshot.docs[0].data();

    if (qty > 1 && recipeData.category?.toUpperCase() === "HOTFOODS") {
      alert("⚠️ HOTFOODS items must be ordered one at a time.");
      return;
    }

    const unitCost = Number(recipeData.cost || 0);
    const totalCost = parseFloat((unitCost * qty).toFixed(2));


    const order = {
      item: recipeData.description || recipeNo,
      qty: qty,
      status: "open",
      venue: "Aloha",
      station: recipeData.station || "Unknown",
      recipeNo: recipeNo,
      cookTime: recipeData.cookTime || 0,
      notes: notes,
      uom: recipeData.uom || "ea",
      totalCost: totalCost,
      type: "addon",
      date: getTodayDate(),
      timestamp: serverTimestamp()
    };

    await addDoc(collection(db, "orders"), order);

    console.log("✅ Order sent:", order);
    qtyInput.value = 1;
    itemSelect.selectedIndex = 0;
    if (notesInput) notesInput.value = "";

    await updateCostSummaryForVenue("Aloha");

  } catch (error) {
    console.error("❌ Failed to send order:", error);
    alert("❌ Failed to send order.");
  } finally {
    setTimeout(() => {
      button.disabled = false;
    }, 1000);
  }
};


async function updateCostSummaryForVenue(venueName) {
  const today = getTodayDate();
  const ordersRef = collection(db, "orders");

  const q = query(
    ordersRef,
    where("venue", "==", venueName),
    where("date", "==", today)
  );
  const snapshot = await getDocs(q);

  let totalSpent = 0;

  snapshot.forEach(doc => {
    const data = doc.data();

    // ✅ Sum totalCost for both addon and starting-par orders
    if (["addon", "starting-par"].includes(data.type)) {
      totalSpent += Number(data.totalCost || 0);
    }
  });

  // 👥 Determine which HTML elements to update
  let guestInputId = "";
  let spentDisplayId = "";
  let costDisplayId = "";

  switch (venueName) {
    case "Aloha":
      guestInputId = "guestInput";
      spentDisplayId = "totalSpent";
      costDisplayId = "costPerGuest";
      break;
    case "Gateway":
      guestInputId = "guestInputGateway";
      spentDisplayId = "totalSpentGateway";
      costDisplayId = "costPerGuestGateway";
      break;
    case "Ohana":
      guestInputId = "guestInputOhana";
      spentDisplayId = "totalSpentOhana";
      costDisplayId = "costPerGuestOhana";
      break;
  }

  // 📥 Get guest count from input or fallback
  let guestCount = 0;
  const guestInput = document.getElementById(guestInputId);

  if (guestInput) {
    const rawValue = guestInput.value.trim();
    if (rawValue === "") {
      const guestSnap = await getDoc(doc(db, "guestCounts", venueName));
      guestCount = guestSnap.exists() ? guestSnap.data().count : 0;
    } else {
      const parsed = Number(rawValue);
      guestCount = parsed > 0 ? parsed : 1;
    }
  }

  const costPerGuest = guestCount > 0 ? totalSpent / guestCount : 0;

  document.getElementById(spentDisplayId).textContent = totalSpent.toFixed(2);
  document.getElementById(costDisplayId).textContent = costPerGuest.toFixed(2);
}


// next function
function listenToAlohaOrders() {
  const ordersRef = collection(db, "orders");
const alohaQuery = query(
  ordersRef,
  where("venue", "==", "Aloha"),
  where("status", "in", ["open", "Ready to Send", "sent", "received"]),
  where("date", "==", getTodayDate())
);


  onSnapshot(alohaQuery, (snapshot) => {
    // ❌ Filter out starting-par orders so they don't show in Aloha open orders
    const orders = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(order => order.type !== "starting-par");

    renderAlohaTable(orders);
  });
}



// ✅ Render Aloha open order table with proper timestamp + cookTime
function renderAlohaTable(orders) {
  const tbody = document.querySelector("#alohaTable tbody");
  if (!tbody) return;

  // 🧼 Remove received items
  orders = orders.filter(order => order.status !== "received");

  tbody.innerHTML = ""; // Clear existing rows

  // 🧠 Sort by status, then by timestamp ascending
  orders.sort((a, b) => {
    const statusOrder = {
      sent: 0,
      "Ready to Send": 1,
      open: 2
    };

    const aPriority = statusOrder[a.status] ?? 3;
    const bPriority = statusOrder[b.status] ?? 3;

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    const timeA = a.timestamp?.toDate?.()?.getTime?.() || 0;
    const timeB = b.timestamp?.toDate?.()?.getTime?.() || 0;
    return timeA - timeB;
  });

  const now = new Date();

  orders.forEach(order => {
    const row = document.createElement("tr");

    let createdAt = new Date();
    if (order.timestamp?.toDate) {
      createdAt = order.timestamp.toDate();
    }

    const cookTime = order.cookTime || 0;
    const dueTime = new Date(createdAt.getTime() + cookTime * 60000);

    const createdFormatted = createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dueFormatted = dueTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const isLate = dueTime < now;
    if (isLate) {
      row.style.backgroundColor = "rgba(255, 0, 0, 0.15)";
    }

    let actionsHTML = "";
    if (order.status === "open" && order.type === "addon") {
      actionsHTML = `
        <button onclick='showEditModal(${JSON.stringify(order).replace(/"/g, "&quot;")})'>✏️</button>
        <button onclick="showDeleteModal('${order.id}')">🗑️</button>
      `;
    } else if (order.status === "sent") {
      actionsHTML = `<button onclick="markOrderReceived('${order.id}', this)">✓ Receive</button>`;
    }

 row.innerHTML = `
  <td data-label="Created">${createdFormatted}</td>
  <td data-label="Due">${dueFormatted}</td>
  <td data-label="Item">${order.item}</td>
  <td data-label="Qty">${order.qty}</td>
  <td data-label="Status">${order.status}</td>
  <td data-label="Actions">${actionsHTML}</td>
`;

    tbody.appendChild(row);
  });
}


window.editAddonOrder = async function(order) {
  const newQty = prompt("Enter new quantity:", order.qty);
  if (!newQty || isNaN(newQty) || parseFloat(newQty) <= 0) return alert("Invalid quantity.");

  const newNotes = prompt("Enter new notes (optional):", order.notes || "");

  try {
    const orderRef = doc(db, "orders", order.id);
    await updateDoc(orderRef, {
      qty: parseFloat(newQty),
      notes: newNotes.trim(),
      updatedAt: serverTimestamp()
    });
    alert("✅ Order updated.");
  } catch (err) {
    console.error("❌ Failed to update order:", err);
    alert("❌ Failed to update order.");
  }
};

let orderToEdit = null;

window.showEditModal = function(order) {
  orderToEdit = order;
  document.getElementById("editQty").value = order.qty || "";
  document.getElementById("editNotes").value = order.notes || "";
  document.getElementById("editModal").style.display = "flex";
};

window.closeEditModal = function () {
  orderToEdit = null;
  document.getElementById("editModal").style.display = "none";
};

document.getElementById("confirmEditBtn").addEventListener("click", async () => {
  if (!orderToEdit) return;

  const newQty = parseFloat(document.getElementById("editQty").value || "0");
  const newNotes = document.getElementById("editNotes").value.trim();

  if (isNaN(newQty) || newQty <= 0) {
    return alert("⚠️ Enter a valid quantity.");
  }

  try {
    const orderRef = doc(db, "orders", orderToEdit.id);
    await updateDoc(orderRef, {
      qty: newQty,
      notes: newNotes,
      updatedAt: serverTimestamp()
    });

    // ✅ Only notify Main Kitchen screen to avoid errors
    if (orderToEdit.venue === "Main Kitchen") {
      showMainKitchenNotif("✅ Order updated.", 3000, "success");
    }
  } catch (err) {
    console.error("❌ Failed to update order:", err);
    if (orderToEdit.venue === "Main Kitchen") {
      showMainKitchenNotif("❌ Failed to update order.", 3000, "error");
    }
  }

  closeEditModal();
});

let orderIdToDelete = null;
let deletedOrderData = null; // Save order info for notification

window.showDeleteModal = function(orderId) {
  orderIdToDelete = orderId;
  document.getElementById("deleteModal").style.display = "flex";
};

window.closeDeleteModal = function () {
  orderIdToDelete = null;
  deletedOrderData = null;
  document.getElementById("deleteModal").style.display = "none";
};

document.getElementById("confirmDeleteBtn").addEventListener("click", async () => {
  if (!orderIdToDelete) return;

  try {
    const orderRef = doc(db, "orders", orderIdToDelete);
    const orderSnap = await getDoc(orderRef);

    if (orderSnap.exists()) {
      deletedOrderData = orderSnap.data();
    }

    await deleteDoc(orderRef);

    if (deletedOrderData?.venue === "Main Kitchen") {
      showMainKitchenNotif("🗑️ Order deleted.", 3000, "info");
    }
  } catch (err) {
    console.error("❌ Failed to delete order:", err);
    if (deletedOrderData?.venue === "Main Kitchen") {
      showMainKitchenNotif("❌ Failed to delete order.", 3000, "error");
    }
  }

  closeDeleteModal();
});

//**aloha starting screen */
window.loadAlohaStartingPar = async function () {
  console.log("🚀 Starting Aloha par load...");

  const today = getTodayDate();
  const guestRef = doc(db, "guestCounts", today);
  const guestSnap = await getDoc(guestRef);

  if (!guestSnap.exists()) {
    console.warn("❌ No guestCounts document found for today:", today);
    document.getElementById("alohaGuestInfo").textContent = "⚠️ No guest count for today.";
    return;
  }

  const guestData = guestSnap.data();
  console.log("🌺 Full guest data:", guestData);

  const guestCount = guestData?.Aloha || 0;
  document.getElementById("alohaGuestInfo").textContent = `👥 Guest Count: ${guestCount}`;

  // Load recipes
  const recipesRef = collection(db, "recipes");
  const q = query(recipesRef, where("venueCodes", "array-contains", "b001")); // Aloha
  const snapshot = await getDocs(q);
  const recipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // Load today's sent orders
  const ordersQuery = query(
    collection(db, "orders"),
    where("type", "==", "starting-par"),
    where("venue", "==", "Aloha"),
    where("date", "==", today)
  );
  const ordersSnap = await getDocs(ordersQuery);

  const sentPars = {};
  const receivedPars = {};

  ordersSnap.forEach(doc => {
    const order = doc.data();
    if (!sentPars[order.recipeId]) sentPars[order.recipeId] = 0;
    sentPars[order.recipeId] += order.qty;

    if (order.received) {
      receivedPars[order.recipeId] = true;
    }
  });

  // ✅ Cache
  if (!window.startingCache) window.startingCache = {};
  window.startingCache["Aloha"] = { recipes, guestCount, sentPars, receivedPars };

  renderStartingStatus("Aloha", window.startingCache["Aloha"]);
};



window.renderStartingStatus = async function (venue, data) {
  const tbody = document.getElementById(`${venue.toLowerCase()}ParTableBody`);
  const categoryFilter = document.getElementById(`${venue.toLowerCase()}-starting-category`).value;
  const guestCount = data.guestCount;
  tbody.innerHTML = "";
  let matchedCount = 0;

  const today = getTodayDate();
  const firestoreVenue = venue === "Concession" ? "Concessions" : venue;

  // 🔄 Load all starting-par orders for this venue & day
  const ordersSnapshot = await getDocs(query(
    collection(db, "orders"),
    where("type", "==", "starting-par"),
    where("venue", "==", firestoreVenue),
    where("date", "==", today)
  ));

  // 🧠 Track which recipes are sent and/or received
// 🧠 Track sent and received status and quantities
const sentButNotReceived = new Map(); // recipeId -> sendQty
const fullyReceived = new Set();

ordersSnapshot.docs.forEach(doc => {
  const order = doc.data();
  const recipeId = order.recipeId;
  if (!recipeId) return;

  if (order.received) {
    fullyReceived.add(recipeId);
  } else {
    sentButNotReceived.set(recipeId, order.sendQty || 0);
  }
});


  data.recipes.forEach(recipe => {
    const recipeId = recipe.id;

    // ❌ Always hide if fully received
    if (fullyReceived.has(recipeId)) return;

    // ❌ On Main Kitchen screen: hide if already sent
    if (venue.replace(/\s/g, '') === "MainKitchen" && sentButNotReceived.has(recipeId)) return;


    // ❌ Skip category if filtered out
    if (categoryFilter && recipe.category?.toLowerCase() !== categoryFilter.toLowerCase()) return;

    // 🧮 Calculate par quantity
    let parQty = 0;
    if (venue === "Concession") {
      parQty = recipe.pars?.Concession?.default || 0;
    } else {
      parQty = recipe.pars?.[venue]?.[guestCount.toString()] || 0;
    }

    if (parQty <= 0) return;

    // 📦 Determine sent quantity
   const sentQty = sentButNotReceived.get(recipeId) || 0;

    const showReceiveBtn = sentButNotReceived.has(recipeId);

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${recipe.description}</td>
      <td>${parQty.toFixed(2)}</td>
<td>${sentQty.toFixed(2)}</td>

      <td>
        ${showReceiveBtn ? `<button class="receive-btn" data-recipe-id="${recipeId}">Receive</button>` : ''}
      </td>
    `;

    // 📌 Add receive listener
    const receiveBtn = row.querySelector(".receive-btn");
    if (receiveBtn) {
      receiveBtn.addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  await receiveStartingPar(venue, recipeId, btn);
});

    }

    tbody.appendChild(row);
    matchedCount++;
  });

  console.log(`✅ Rendered ${matchedCount} recipes for ${venue} with guest count ${guestCount}`);
};



// ✅ Receive starting-par order
window.receiveStartingPar = async function (venue, recipeId, button) {
  const today = getTodayDate();
  const firestoreVenue = venue === "Concession" ? "Concessions" : venue;

  const ordersQuery = query(
    collection(db, "orders"),
    where("type", "==", "starting-par"),
    where("venue", "==", firestoreVenue),
    where("date", "==", today),
    where("recipeId", "==", recipeId)
  );

  const ordersSnap = await getDocs(ordersQuery);

  if (ordersSnap.empty) {
    console.warn("❌ No matching order found to mark as received.");
    return;
  }

  let updated = 0;
  for (const docSnap of ordersSnap.docs) {
    const data = docSnap.data();
    if (!data.received) {
      await updateDoc(docSnap.ref, {
        received: true,
        receivedAt: new Date(),
        status: "received" // ✅ <-- Add this line
      });
      updated++;
    }
  }

  if (updated > 0) {
    const row = button?.closest("tr");
    if (row) row.remove();
    console.log(`✅ Marked ${updated} order(s) as received for ${recipeId}`);
  } else {
    console.log(`ℹ️ All orders already marked as received for ${recipeId}`);
  }
};

// ✅ Mark order as completed by the station
window.markStationOrderComplete = async function (orderId) {
  try {
    const orderRef = doc(db, "orders", orderId);
    await setDoc(orderRef, {
  status: "Ready to Send",
  readyToSendAt: serverTimestamp()
}, { merge: true });

    console.log(`✅ Order ${orderId} marked as Ready to Send`);
  } catch (error) {
    console.error("❌ Failed to update order status:", error);
  }
};

window.markOrderReceived = async function(orderId, button) {
  try {
    const orderRef = doc(db, "orders", orderId);

    await setDoc(orderRef, {
      status: "received",
      receivedAt: serverTimestamp()
    }, { merge: true });

    console.log(`✅ Order ${orderId} marked as received.`);

    if (button?.closest("tr")) {
      button.closest("tr").remove();
    }

  } catch (error) {
    console.error("❌ Failed to mark order as received:", error);
    alert("❌ Could not mark order as received.");
  }
};



//*STATIONS */

// show stations tabs navigations
window.showStationTab = function(stationName) {
  const allSections = document.querySelectorAll(".station-section");
  allSections.forEach(section => {
    section.style.display = "none";
  });

  const target = document.getElementById(`${stationName}Section`);
  if (target) target.style.display = "block";
};



function listenToStationOrders(stationName) {
  const stationRef = collection(db, "orders");
  const stationQuery = query(
    stationRef,
    where("station", "==", stationName),
    where("status", "==", "open")
  );

  onSnapshot(stationQuery, (snapshot) => {
    const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderStationTable(stationName, orders);
  });
}
function renderStationTable(stationName, orders) {
  const tableBody = document.querySelector(`#${stationName}Table tbody`);
  if (!tableBody) return;

  tableBody.innerHTML = "";

  // Sort by timestamp
  orders.sort((a, b) => a.timestamp?.toMillis?.() - b.timestamp?.toMillis?.());

  orders.forEach(order => {
    if (["Ready to Send", "completed", "sent"].includes(order.status)) return;

    const row = document.createElement("tr");

    const createdAt = order.timestamp?.toDate?.() || new Date();
    const cookTime = order.cookTime || 0;
    const dueTime = new Date(createdAt.getTime() + cookTime * 60000);
    const now = new Date();
    if (dueTime < now) {
      row.style.backgroundColor = "rgba(255, 0, 0, 0.15)";
    }

    // Shared cells
    const timeCell = document.createElement("td");
    timeCell.textContent = createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const dueCell = document.createElement("td");
    dueCell.textContent = dueTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const venueCell = document.createElement("td");
    venueCell.textContent = order.venue || "";

    const itemCell = document.createElement("td");
    itemCell.textContent = order.item;

    const qtyCell = document.createElement("td");
    qtyCell.textContent = order.qty || 1;

    const notesCell = document.createElement("td");
    notesCell.textContent = order.notes || "";

    // Grill/Wok stations: full send interface
    if (["Grill", "Wok"].includes(stationName)) {
      const sendQtyInput = document.createElement("input");
      sendQtyInput.type = "number";
      sendQtyInput.min = 0;
      sendQtyInput.placeholder = "0";
      sendQtyInput.style.width = "60px";

      const sendQtyCell = document.createElement("td");
      sendQtyCell.appendChild(sendQtyInput);

      const uomCell = document.createElement("td");
      uomCell.textContent = order.uom || "ea";

      const sendButton = document.createElement("button");
      sendButton.textContent = "Send";
      sendButton.onclick = () => {
        const sendQty = parseFloat(sendQtyInput.value);
        if (!sendQty || sendQty <= 0) return alert("Enter valid send quantity");

        sendStationAddonOrder(stationName, {
          ...order,
          sendQty
        });
      };

      const sendCell = document.createElement("td");
      sendCell.appendChild(sendButton);

      row.append(
        timeCell,
        dueCell,
        venueCell,
        itemCell,
        notesCell,
        qtyCell,
        sendQtyCell,
        uomCell,
        sendCell
      );
    }

    // Other stations: Ready button only
    else {
      const readyCell = document.createElement("td");
    const readyButton = document.createElement("button");
readyButton.textContent = "✅ Ready";
readyButton.classList.add("ready-btn");


      readyButton.onclick = async () => {
        try {
          await updateDoc(doc(db, "orders", order.id), {
            status: "Ready to Send",
            readyAt: serverTimestamp()
          });
        } catch (err) {
          console.error("Error updating order:", err);
          alert("Failed to mark as ready.");
        }
      };

      readyCell.appendChild(readyButton);

      row.append(
        timeCell,
        dueCell,
        venueCell,
        itemCell,
        qtyCell,
        notesCell,
        readyCell
      );
    }

    tableBody.appendChild(row);
  });
}

async function sendStationAddonOrder(stationName, order) {
  try {
    const { id, recipeNo, sendQty, venue } = order;

    // 🔍 Query recipe by recipeNo field
    const recipeQuery = query(
      collection(db, "recipes"),
      where("recipeNo", "==", recipeNo)
    );
    const recipeSnap = await getDocs(recipeQuery);

    if (recipeSnap.empty) {
      return alert("Recipe not found.");
    }

    const recipeData = recipeSnap.docs[0].data();
    const costPerUOM = recipeData.cost || 0;
    const panWeight = recipeData.panWeight || 0;

    // 🔁 Subtract pan weight
    const netQty = parseFloat((sendQty - panWeight).toFixed(2));
const totalCost = parseFloat((netQty * costPerUOM).toFixed(2));


    // 📦 Update Firestore
    const updateData = {
      sendQty: netQty,
      status: "sent",
      sentAt: serverTimestamp(),
      totalCost,
      type: "addon",
    };

    const orderRef = doc(db, "orders", id);
    await updateDoc(orderRef, updateData);

    // ✅ No success alert here
  } catch (error) {
    console.error("Failed to send order:", error);
    alert("Error sending order.");
  }
}


//** Kitchen functions */

window.sendKitchenOrder = async function(orderId, button) {
  try {
    const orderRef = doc(db, "orders", orderId);
    const orderSnap = await getDoc(orderRef);

    if (!orderSnap.exists()) {
      alert("❌ Order not found.");
      return;
    }

    const order = orderSnap.data();
    const row = button.closest("tr");
    const sendQtyInput = row.querySelector(".send-qty-input");

    if (!sendQtyInput || sendQtyInput.value.trim() === "") {
      alert("⚠️ Please input a quantity before sending.");
      return;
    }

    const sendQty = parseFloat(sendQtyInput.value);

    if (isNaN(sendQty) || sendQty <= 0) {
      alert("⚠️ Please enter a valid quantity greater than 0.");
      return;
    }

    let adjustedQty = sendQty;

    if (order.type === "addon" && order.recipeNo) {
      const recipeQuery = query(
        collection(db, "recipes"),
        where("recipeNo", "==", order.recipeNo)
      );
      const recipeSnap = await getDocs(recipeQuery);

      if (!recipeSnap.empty) {
        const recipeData = recipeSnap.docs[0].data();
        const panWeight = recipeData.panWeight || 0;
        const uom = (recipeData.uom || "").toLowerCase();

        if (uom === "lb") {
          adjustedQty = parseFloat((sendQty - panWeight).toFixed(2));

          if (adjustedQty < 0) {
            alert(`❌ Cannot send this quantity. Adjusted weight (${adjustedQty}) is less than 0 after subtracting pan weight (${panWeight}).`);
            return;
          }

          console.log(`💡 Adjusted Qty for ${order.recipeNo}: ${adjustedQty} (panWeight: ${panWeight})`);
        } else {
          console.log(`ℹ️ UOM is '${uom}', skipping pan weight adjustment.`);
        }
      } else {
        console.warn("⚠️ Recipe not found for", order.recipeNo);
      }
    }

    await setDoc(orderRef, {
      status: "sent",
      sentAt: serverTimestamp(),
      sendQty: adjustedQty,
      qty: adjustedQty
    }, { merge: true });

    console.log(`✅ Sent order ${orderId} with sendQty: ${adjustedQty}`);

    if (row) row.remove();

  } catch (error) {
    console.error("❌ Failed to send order:", error);
    alert("❌ Failed to send order.");
  }
};


window.mainStartingQtyCache = {};      // already exists
window.mainStartingInputCache = {};    // NEW — stores current input



window.loadMainKitchenStartingPars = async function () {
  console.log("🚀 Loading Main Kitchen Starting Pars...");

  const today = getTodayDate();
  const guestRef = doc(db, "guestCounts", today);
  const guestSnap = await getDoc(guestRef);

  if (!guestSnap.exists()) {
    console.warn("⚠️ No guest counts found.");
    return;
  }

  const guestCounts = guestSnap.data();
  console.log("🌺 Guest Counts:", guestCounts);

  // 🔁 Fetch all venue recipes
  const recipesRef = collection(db, "recipes");
  const qRecipes = query(
    recipesRef,
    where("venueCodes", "array-contains-any", ["b001", "b002", "b003", "c002", "c003", "c004"])
  );
  const snapshot = await getDocs(qRecipes);
  const recipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // 🔁 Fetch all today's orders from Firestore
  const ordersRef = collection(db, "orders");
  const q = query(
    ordersRef,
    where("type", "==", "starting-par"),
    where("date", "==", today)
  );
  const querySnap = await getDocs(q);

   const sentParMap = {};     // sentParMap[venue][recipeId] = totalQty
  const receivedParMap = {}; // receivedParMap[venue][recipeId] = true
  const sentParStatus = {};  // sentParStatus[venue][recipeId] = status

  querySnap.forEach(doc => {
    const { venue, recipeId, qty, status } = doc.data();
    if (!venue || !recipeId) return;

    // Track quantity
    if (!sentParMap[venue]) sentParMap[venue] = {};
    if (!sentParMap[venue][recipeId]) sentParMap[venue][recipeId] = 0;
    sentParMap[venue][recipeId] += qty;

    // Track received
    if (status === "received") {
      if (!receivedParMap[venue]) receivedParMap[venue] = {};
      receivedParMap[venue][recipeId] = true;
    }

    // Track sent/received status
    if (!sentParStatus[venue]) sentParStatus[venue] = {};
    sentParStatus[venue][recipeId] = status;
  });


  // ✅ Cache everything
  window.startingCache["MainKitchenAll"] = {
    recipes,
    guestCounts,
    sentPars: sentParMap,
    receivedPars: receivedParMap,
    sentParStatus: sentParStatus  // ✅ include this!
  };


  renderMainKitchenPars();
};


window.renderMainKitchenPars = function () {
  const data = window.startingCache?.MainKitchenAll;
  if (!data) {
    console.warn("⚠️ No cached data found for Main Kitchen Starting Pars.");
    return;
  }

  // Make sure caches exist
  window.mainStartingQtyCache = window.mainStartingQtyCache || {};
  window.mainStartingInputCache = window.mainStartingInputCache || {};

  const venueCodeMap = {
    b001: "Aloha",
    b002: "Ohana",
    b003: "Gateway",
    c002: "Concessions",
    c003: "Concessions",
    c004: "Concessions"
  };

  const venueFilter = document.getElementById("starting-filter-venue").value;
  const stationFilter = document.getElementById("starting-filter-station").value;
  const tbody = document.querySelector("#startingParsTable tbody");
  tbody.innerHTML = "";

  let totalRows = 0;

  data.recipes.forEach(recipe => {
    const station = recipe.category || "";
    if (stationFilter && station.toLowerCase() !== stationFilter.toLowerCase()) return;

    const venues = recipe.venueCodes || [];

    venues.forEach(code => {
      const venue = venueCodeMap[code] || "Unknown";
      if (venueFilter && venue !== venueFilter) return;

      // 🛑 Skip if already sent or received today
      const sentToday = data.sentParStatus?.[venue]?.[recipe.id];
      if (sentToday === "sent" || sentToday === "received") return;

      // 🛑 Skip if marked received
      if (data.receivedPars?.[venue]?.[recipe.id]) return;

      let parQty = 0;
      if (venue === "Concessions") {
        parQty = recipe.pars?.Concession?.default || 0;
      } else {
        const guestCount = data.guestCounts?.[venue] || 0;
        parQty = recipe.pars?.[venue]?.[guestCount.toString()] || 0;
      }

      if (parQty <= 0) return;

      const sentQty = data.sentPars?.[venue]?.[recipe.id] || 0;

      // 🛑 Skip if fully sent
      if (sentQty >= parQty) return;

      // 🧠 Load from caches
      const cacheKey = `${venue}|${recipe.id}`;
      const cachedTotal = window.mainStartingQtyCache[cacheKey] ?? 0;
      const cachedInput = window.mainStartingInputCache[cacheKey] ?? 0;

      // ✅ Build row with correct values
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${venue}</td>
        <td>${recipe.description}</td>
        <td>${parQty}</td>
        <td>${recipe.uom || "ea"}</td>
        <td>
          <span class="total-send-qty">${cachedTotal}</span>
          <input class="add-send-qty" type="number" min="0" value="${cachedInput}" data-cache-key="${cacheKey}" style="width: 60px; margin-left: 6px;" />
          <button class="add-send-btn" onclick="addToSendQty(this)">Add</button>
        </td>
        <td><button onclick="sendSingleStartingPar('${recipe.id}', '${venue}', this)">Send</button></td>
      `;

      const input = row.querySelector(".add-send-qty");
      if (input) {
        input.addEventListener("input", () => {
          const inputQty = Number(input.value);
          if (!isNaN(inputQty) && inputQty >= 0) {
            window.mainStartingInputCache[cacheKey] = inputQty;
          }
        });
      }

      tbody.appendChild(row);
      totalRows++;
    });
  });

  console.log(`✅ Rendered ${totalRows} rows based on filters`);
};



window.addToSendQty = function (button) {
  const row = button.closest("tr");
  const input = row.querySelector(".add-send-qty");
  const totalSpan = row.querySelector(".total-send-qty");

  if (!input || !totalSpan) return;

  const addQty = Number(input.value);
  const currentQty = Number(totalSpan.textContent);
  const cacheKey = input.getAttribute("data-cache-key");

  if (!isNaN(addQty) && addQty > 0) {
    const newTotal = currentQty + addQty;
    totalSpan.textContent = newTotal;
    input.value = "0";
    input.focus();

    // ✅ Update both caches
    window.mainStartingQtyCache[cacheKey] = newTotal;
    window.mainStartingInputCache[cacheKey] = 0;

    console.log(`📦 Added ${addQty} → Total now ${newTotal}`);
  } else {
    console.warn("⚠️ Enter a valid number greater than 0");
  }
};



document.getElementById("starting-filter-venue").addEventListener("change", () => {
  renderMainKitchenPars();
});
document.getElementById("starting-filter-station").addEventListener("change", () => {
  renderMainKitchenPars();
});


// 🔁 Shared function to send a starting par order
async function sendStartingPar(recipeId, venue, sendQty) {
  const today = getTodayDate();

  const guestCountDoc = await getDoc(doc(db, "guestCounts", today));
  const guestCount = guestCountDoc.exists() ? guestCountDoc.data()[venue] : 0;

  const recipeSnap = await getDoc(doc(db, "recipes", recipeId));
  if (!recipeSnap.exists()) {
    console.warn(`❌ Recipe ${recipeId} not found`);
    return;
  }

const recipeData = recipeSnap.data();
const panWeight = Number(recipeData.panWeight || 0);
const costPerLb = Number(recipeData.cost || 0);
const pans = recipeData.pars?.[venue]?.[guestCount] || 0;

// ✅ Calculate net weight
const netWeightRaw = sendQty - (pans * panWeight);
if (netWeightRaw <= 0) {
  alert(`❌ Cannot send: Net weight would be ${netWeightRaw.toFixed(2)} lbs.`);
  return;
}
const netWeight = parseFloat(netWeightRaw.toFixed(2));
const totalCost = parseFloat((netWeight * costPerLb).toFixed(2));

// ✅ Ensure recipeNo is saved for accounting queries
const recipeNo = (recipeData.recipeNo || recipeId).toUpperCase();

const orderData = {
  type: "starting-par",
  venue,
  recipeId,
  recipeNo, // ✅ now added
  sendQty: parseFloat(sendQty.toFixed(2)),
  pans,
  panWeight,
  netWeight,
  costPerLb,
  totalCost,
  date: today,
  status: "sent",
  sentAt: Timestamp.now(),
  timestamp: Timestamp.now()
};



  await addDoc(collection(db, "orders"), orderData);

  console.log(`✅ Sent ${sendQty} lbs for ${recipeId} to ${venue} → Net: ${netWeight} lbs, Cost: $${totalCost.toFixed(2)}`);
}
window.sendSingleStartingPar = async function (recipeId, venue, button) {
  const row = button.closest("tr");
  const totalSpan = row.querySelector(".total-send-qty");

  if (!totalSpan) {
    console.error("❌ Could not find .total-send-qty in row");
    return;
  }

  const sendQty = Number(totalSpan.textContent);
  if (isNaN(sendQty) || sendQty <= 0) {
    alert("Please add a quantity greater than 0.");
    return;
  }

  await sendStartingPar(recipeId, venue, sendQty);

  // ✅ Clear from cache
  const cacheKey = `${venue}|${recipeId}`;
  if (window.mainStartingQtyCache) {
    delete window.mainStartingQtyCache[cacheKey];
delete window.mainStartingInputCache[cacheKey];
  }

  // 🧹 Remove the row from UI
  row.remove();
};



//**WASTE aloha */
// 🧠 Store waste totals between filter switches
window.alohaWasteTotals = {}; 

window.loadAlohaWaste = async function (filteredList = null) {
  const tableBody = document.querySelector(".aloha-section[data-sec='waste'] .waste-table tbody");
  tableBody.innerHTML = "";

  // 🔁 Use cache if available, else load from Firestore
  if (!window.cachedAlohaWasteRecipes) {
    const recipesRef = collection(db, "recipes");
    const q = query(recipesRef, where("venueCodes", "array-contains", "b001"));
    const snapshot = await getDocs(q);
    window.cachedAlohaWasteRecipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log("📦 Loaded and cached Aloha recipes:", window.cachedAlohaWasteRecipes.length);
  }

  const recipes = filteredList || window.cachedAlohaWasteRecipes;
  window.alohaWasteRecipeList = recipes; // Keep for send/waste function access

  recipes.forEach(recipe => {
    const row = document.createElement("tr");
    row.dataset.recipeId = recipe.id;

    const savedQty = window.alohaWasteTotals?.[recipe.id] || 0;

    row.innerHTML = `
      <td>${recipe.description}</td>
      <td>${recipe.uom || "ea"}</td>
      <td>
        <span class="waste-total">${savedQty}</span>
        <input class="waste-input" type="number" min="0" value="0" style="width: 60px; margin-left: 6px;" />
        <button onclick="addToWasteQty(this)" style="margin-left: 6px;">Add</button>
      </td>
      <td><button onclick="sendSingleWaste(this, '${recipe.id}')">Send</button></td>
    `;

    tableBody.appendChild(row);
  });
};

window.filterAlohaWaste = function () {
  const searchValue = document.getElementById("alohaWasteSearch")?.value?.trim().toLowerCase() || "";
  const selectedCategory = document.getElementById("aloha-waste-category")?.value?.toLowerCase() || "";

  const filtered = window.cachedAlohaWasteRecipes.filter(recipe => {
    const name = recipe.description?.toLowerCase() || "";
    const category = recipe.category?.toLowerCase() || "";

    const matchesSearch = !searchValue || name.includes(searchValue);
    const matchesCategory = !selectedCategory || category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  window.loadAlohaWaste(filtered);
};


window.addToWasteQty = function (button) {
  const row = button.closest("tr");
  const input = row.querySelector(".waste-input");
  const span = row.querySelector(".waste-total");

  const addQty = Number(input.value);
  const currentQty = Number(span.textContent);
  const newQty = currentQty + addQty;

  if (!isNaN(addQty) && addQty > 0) {
    span.textContent = newQty;
    input.value = "0";

    const recipeId = row.dataset.recipeId;
    window.alohaWasteTotals[recipeId] = newQty;
  }
};



window.sendSingleWaste = async function (button, recipeId) {
  const row = button.closest("tr");
  const span = row.querySelector(".waste-total");
  const input = row.querySelector(".waste-input");
  const qty = Number(span.textContent);

  const recipe = window.alohaWasteRecipeList.find(r => r.id === recipeId);
  if (!recipe) {
    alert("❌ Recipe not found.");
    return;
  }

  // Check HOTFOODS rule
  if (qty > 1 && recipe.category?.toUpperCase() === "HOTFOODS") {
    alert("⚠️ HOTFOODS items must be wasted one at a time.");
    return;
  }

  // Check if waste exceeds received
  const hasEnough = await checkIfEnoughReceived(recipeId, qty, "Aloha");
  if (!hasEnough) {
    alert(`🚫 Cannot waste ${qty} of "${recipe.description}" — more than received.`);
    return;
  }

  const today = getTodayDate();
  const wasteData = {
    item: recipe.description,
    venue: "Aloha",
    qty,
    uom: recipe.uom || "ea",
    date: today,
    timestamp: serverTimestamp()
  };

  await addDoc(collection(db, "waste"), wasteData);

  console.log(`✅ Sent waste to 'waste': ${qty} of ${recipe.description}`);

  // Reset
  span.textContent = "0";
  input.value = "0";

  const confirm = document.createElement("span");
  confirm.textContent = "Sent";
  confirm.style.color = "green";
  confirm.style.marginLeft = "8px";
  button.parentNode.appendChild(confirm);
  setTimeout(() => confirm.remove(), 2000);
};

window.sendAllWaste = async function () {
  const rows = document.querySelectorAll(".waste-table tbody tr");
  console.log("🧪 Found rows:", rows.length);
  const today = getTodayDate();
  let sentCount = 0;

  for (const row of rows) {
    const recipeId = row.dataset.recipeId;
    const span = row.querySelector(".waste-total");
    const qty = Number(span?.textContent || 0);
    const input = row.querySelector(".waste-input");

    if (qty > 0) {
      const recipe = window.alohaWasteRecipeList.find(r => r.id === recipeId);
      if (!recipe) {
        console.warn(`⚠️ Recipe not found for ID: ${recipeId}`);
        continue;
      }

      if (qty > 1 && recipe.category?.toUpperCase() === "HOTFOODS") {
        alert(`⚠️ Cannot waste more than 1 of HOTFOODS item: "${recipe.description}"`);
        continue;
      }

      const hasEnough = await checkIfEnoughReceived(recipeId, qty, "Aloha");
      if (!hasEnough) {
        alert(`🚫 Cannot waste ${qty} of "${recipe.description}" — more than received.`);
        continue;
      }

      const wasteData = {
        item: recipe.description,
        venue: "Aloha",
        qty,
        uom: recipe.uom || "ea",
        date: today,
        timestamp: serverTimestamp()
      };

      await addDoc(collection(db, "waste"), wasteData);
      console.log(`✅ Sent waste to 'waste': ${qty} of ${recipe.description}`);
      sentCount++;

      // Reset input and UI if needed
      if (span) span.textContent = "0";
      if (input) input.value = "0";

      const confirm = document.createElement("span");
      confirm.textContent = "Sent";
      confirm.style.color = "green";
      confirm.style.marginLeft = "8px";
      row.querySelector("td:last-child").appendChild(confirm);
      setTimeout(() => confirm.remove(), 2000);
    }
  }

  if (sentCount > 0) {
    alert(`✅ ${sentCount} waste entr${sentCount === 1 ? "y" : "ies"} sent.`);
  } else {
    alert("⚠️ No valid waste entries sent.");
  }
};


//**Main kitchen waste */
window.mainWasteTotals = {}; // 🧠 Key: itemId, value: qty

window.loadMainKitchenWaste = async function () {
  const tableBody = document.querySelector(".main-waste-table tbody");
  tableBody.innerHTML = "";

  // ✅ Use cache if available
  if (!window.cachedMainWasteItems) {
    // 1. Load all recipes
    const recipesSnap = await getDocs(collection(db, "recipes"));
    const allRecipes = recipesSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        type: "recipe",
        name: data.description || "Unnamed",
        uom: data.uom || "ea",
        category: (data.category || "uncategorized").toLowerCase()
      };
    });

    // 2. Load all ingredients
    const ingredientsSnap = await getDocs(collection(db, "ingredients"));
    const allIngredients = ingredientsSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        type: "ingredient",
        name: data.itemName || "Unnamed",
        uom: data.baseUOM || "ea",
        category: (data.category || "ingredients").toLowerCase()
      };
    });

    // 🔁 Combine and cache
    window.cachedMainWasteItems = [...allRecipes, ...allIngredients];
    console.log("📦 Cached main waste items:", window.cachedMainWasteItems.length);
  }

  window.mainWasteItemList = window.cachedMainWasteItems;
  renderMainWasteRows(window.mainWasteItemList);
};




window.renderMainWasteRows = function (items) {
  const tableBody = document.querySelector(".main-waste-table tbody");
  tableBody.innerHTML = "";

  items.forEach(item => {
    const row = document.createElement("tr");
    row.dataset.itemId = item.id;
    row.dataset.itemType = item.type;
    row.dataset.category = item.category?.toLowerCase() || "";

  const savedQty = window.mainWasteTotals?.[item.id] || 0;

row.innerHTML = `
  <td>${item.name}</td>
  <td>${item.uom}</td>
  <td>
    <span class="waste-total">${savedQty}</span>
    <input class="waste-input" type="number" min="0" value="0" style="width: 60px; margin-left: 6px;" />
    <button onclick="addToMainWasteQty(this)" style="margin-left: 6px;">Add</button>
  </td>
  <td><button onclick="sendSingleMainWaste(this)">Send</button></td>
`;

    tableBody.appendChild(row);
  });
};

window.addToMainWasteQty = function (button) {
  const row = button.closest("tr");
  const input = row.querySelector(".waste-input");
  const span = row.querySelector(".waste-total");

  const addQty = Number(input.value);
  const currentQty = Number(span.textContent);
  const newQty = currentQty + addQty;

  if (!isNaN(addQty) && addQty > 0) {
    span.textContent = newQty;
    input.value = "0";

    const itemId = row.dataset.itemId;
    window.mainWasteTotals[itemId] = newQty;
  }
};


window.filterMainWaste = function () {
  const searchInput = document.getElementById("mainWasteSearch").value.trim().toLowerCase();
  const selectedCategory = document.getElementById("mainWasteCategory").value.toLowerCase();

  const filtered = window.mainWasteItemList.filter(item => {
    const itemName = item.name?.toLowerCase() || "";
    const itemCategory = item.category?.toLowerCase() || "";

    const matchesSearch = !searchInput || itemName.includes(searchInput);
    const matchesCategory = !selectedCategory || itemCategory === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  renderMainWasteRows(filtered);
};

window.sendSingleMainWaste = async function (button) {
  const row = button.closest("tr");
  const span = row.querySelector(".waste-total");
  const input = row.querySelector(".waste-input");
  const qty = Number(span.textContent);

  if (qty <= 0) {
    alert("Please add a quantity first.");
    return;
  }

  const itemId = row.dataset.itemId;
  const item = window.mainWasteItemList.find(i => i.id === itemId);
  const today = getTodayDate();

  const wasteData = {
    item: item.name,
    venue: "Main Kitchen",
    qty,
    uom: item.uom || "ea",
    date: today,
    timestamp: serverTimestamp()
  };

  await addDoc(collection(db, "waste"), wasteData);
  console.log(`✅ Sent waste to 'waste': ${qty} of ${item.name}`);

  // Reset quantity values
  span.textContent = "0";
  input.value = "0";

  // Show "Sent" confirmation text
  const confirm = document.createElement("span");
  confirm.textContent = "Sent";
  confirm.style.color = "green";
  confirm.style.marginLeft = "8px";
  button.parentNode.appendChild(confirm);

  // Remove confirmation after 2 seconds
  setTimeout(() => confirm.remove(), 2000);
};

window.sendAllMainWaste = async function () {
  const rows = document.querySelectorAll(".main-waste-table tbody tr");
  const today = getTodayDate();
  let sentCount = 0;

  for (const row of rows) {
    const span = row.querySelector(".waste-total");
    const qty = Number(span.textContent);

    if (qty > 0) {
      const itemId = row.dataset.itemId;
      const item = window.mainWasteItemList.find(i => i.id === itemId);

      const wasteData = {
        item: item.name,
        venue: "Main Kitchen",
        qty,
        uom: item.uom || "ea",
        date: today,
        timestamp: serverTimestamp()
      };

      await addDoc(collection(db, "waste"), wasteData);
      console.log(`📦 Sent ${qty} of ${item.name}`);
      sentCount++;
    }
  }
if (sentCount > 0) {
    alert(`✅ ${sentCount} waste entries recorded for Main Kitchen.`);
  } else {
    alert("⚠️ No waste entries with quantity > 0 found.");
  }
};


//**Aloha Returns */

window.loadAlohaReturns = async function () {
  const tableBody = document.querySelector(".aloha-returns-table tbody");
  tableBody.innerHTML = "";

  console.log("🔁 Loading Aloha Returns...");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const ordersRef = collection(db, "orders");
  const q = query(
    ordersRef,
    where("venue", "==", "Aloha"),
    where("status", "==", "received")
  );
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    console.log("📭 No orders received today for Aloha");
    return;
  }

  const todayOrders = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(order => {
      const receivedAt = order.receivedAt?.toDate?.();
      return receivedAt && receivedAt.toDateString() === today.toDateString();
    });

  const returnsSnapshot = await getDocs(
    query(collection(db, "returns"), where("venue", "==", "Aloha"))
  );

  const excludedRecipeIds = new Set();
  returnsSnapshot.forEach(doc => {
    const { status, recipeId } = doc.data();
    if ((status === "returned" || status === "received") && recipeId) {
      excludedRecipeIds.add(recipeId);
    }
  });

  console.log(`📦 Found ${todayOrders.length} Aloha orders received today`);
  if (todayOrders.length === 0) return;

  const recipeQtyMap = {};
  todayOrders.forEach(order => {
    const recipeKey = order.recipeNo || order.recipeId;
    const qty = Number(order.qty ?? order.sendQty ?? 0);


    if (!recipeKey) return;

    recipeQtyMap[recipeKey] = (recipeQtyMap[recipeKey] || 0) + qty;
  });

  const validRecipes = [];

  for (const recipeKey in recipeQtyMap) {
    let recipeDoc = null;

    // Try to find by recipeNo
    const recipeQuery = query(
      collection(db, "recipes"),
      where("recipeNo", "==", recipeKey)
    );
    const recipeSnapshot = await getDocs(recipeQuery);

    if (!recipeSnapshot.empty) {
      recipeDoc = recipeSnapshot.docs[0];
    } else {
      // Try to get by ID
      const fallbackDoc = await getDoc(doc(db, "recipes", recipeKey));
      if (fallbackDoc.exists()) {
        recipeDoc = fallbackDoc;
      }
    }

    if (!recipeDoc) {
      console.warn("❌ Could not find recipe for", recipeKey);
      continue;
    }

    if (excludedRecipeIds.has(recipeDoc.id)) {
      continue;
    }

    const recipe = recipeDoc.data();

    if (String(recipe.returns || "").toLowerCase() === "yes") {
      validRecipes.push({
        id: recipeDoc.id,
        name: recipe.description,
        uom: recipe.uom || "ea",
        qty: recipeQtyMap[recipeKey]
      });
    }
  }

  if (validRecipes.length === 0) {
    console.log("📭 No valid returnable items for Aloha today.");
    return;
  }

  validRecipes.forEach(recipe => {
    const row = document.createElement("tr");
    row.dataset.recipeId = recipe.id;

    row.innerHTML = `
      <td>${recipe.name}</td>
      <td>${recipe.qty} ${recipe.uom}</td>
      <td>
        <input class="return-input" type="number" min="0" value="0" style="width: 60px;" />
      </td>
      <td>
        <button onclick="sendSingleReturn(this, '${recipe.id}')">Return</button>
      </td>
    `;

    tableBody.appendChild(row);
  });

  console.log(`✅ Loaded ${validRecipes.length} returnable recipes`);
};



window.sendSingleReturn = async function (btn, recipeId) {
  const row = btn.closest("tr");
  const qtyInput = row.querySelector(".return-input");
  const qty = Number(qtyInput.value);

  if (isNaN(qty) || qty <= 0) {
    alert("Please enter a valid quantity to return.");
    return;
  }

  try {
    await addDoc(collection(db, "returns"), {
      recipeId: recipeId,
      qty: qty,
      venue: "Aloha",
      status: "returned",
      returnedAt: serverTimestamp()
    });

    // ✅ Show confirmation
    const cell = btn.parentElement;
    cell.innerHTML = `<span style="color: green;">Returned</span>`;

    // 🧼 Optional: hide the row after short delay
    setTimeout(() => {
      row.remove();
    }, 800); // give users a moment to see the confirmation

    console.log(`🔁 Returned ${qty} of recipe ${recipeId}`);
  } catch (error) {
    console.error("Error returning item:", error);
    alert("Error submitting return. Please try again.");
  }
};

//** main kitchen return */
async function loadMainKitchenReturns() {
  console.log("🔄 Loading Main Kitchen Returns...");

  const tableBody = document.querySelector(".main-returns-table tbody");
  tableBody.innerHTML = "";

  try {
    const snapshot = await getDocs(collection(db, "returns"));
    const recipeMap = new Map();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    for (const docSnap of snapshot.docs) {
      const returnData = docSnap.data();

      // Only process if status is "returned"
      if (returnData.status !== "returned") continue;

      // Only include if returnedAt is today
      const returnedAt = returnData.returnedAt?.toDate();
      if (!returnedAt || returnedAt < today || returnedAt >= tomorrow) continue;

      const returnId = docSnap.id;
      const recipeId = returnData.recipeId;
      const qty = returnData.qty;

      // Get recipe name from cache or fetch from Firestore
      let recipeName = recipeMap.get(recipeId);
      if (!recipeName) {
        const recipeDoc = await getDoc(doc(db, "recipes", recipeId));
        recipeName = recipeDoc.exists() ? recipeDoc.data().description : "Unknown Item";
        recipeMap.set(recipeId, recipeName);
      }

      const row = document.createElement("tr");
      row.setAttribute("data-return-id", returnId);
      row.setAttribute("data-venue", returnData.venue);
      row.setAttribute("data-returned-at", returnedAt.toISOString());

      row.innerHTML = `
        <td>${recipeName}</td>
        <td>${returnData.venue}</td>
        <td>${qty}</td>
        <td><button onclick="receiveMainReturn('${returnId}', this)">Receive</button></td>
      `;

      tableBody.appendChild(row);
    }

    console.log(`✅ Rendered ${tableBody.children.length} return rows`);
  } catch (error) {
    console.error("❌ Failed to load returns:", error);
  }
}




window.receiveReturn = async function (btn, returnId) {
  const row = btn.closest("tr");

  try {
    const returnRef = doc(db, "returns", returnId);
    await updateDoc(returnRef, {
      status: "received",
      receivedAt: serverTimestamp()
    });

    // Replace button with confirmation
    btn.parentElement.innerHTML = `<span style="color: green;">Received</span>`;
    setTimeout(() => {
      row.remove();
    }, 800);

    console.log(`📦 Marked return ${returnId} as received.`);
  } catch (error) {
    console.error("❌ Error receiving return:", error);
    alert("Failed to receive item. Try again.");
  }
};
window.receiveMainReturn = async function (returnId, button) {
  const row = button.closest("tr");

  try {
    const returnRef = doc(db, "returns", returnId);
    await updateDoc(returnRef, {
      status: "received",
      receivedAt: serverTimestamp()
    });

    // Replace button with confirmation
    button.parentElement.innerHTML = `<span style="color: green;">Received</span>`;

    // Remove row after short delay
    setTimeout(() => {
      row.remove();
    }, 800);

    console.log(`📦 Marked main kitchen return ${returnId} as received.`);
  } catch (error) {
    console.error("❌ Error receiving return:", error);
    alert("Failed to receive item. Try again.");
  }
};
window.filterMainKitchenReturns = function () {
  const selectedVenue = document.getElementById("mainReturnsVenueFilter").value;
  const rows = document.querySelectorAll(".main-returns-table tbody tr");

  const today = new Date();
  today.setHours(0, 0, 0, 0); // Start of today

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1); // Start of tomorrow

  rows.forEach(row => {
    const venue = row.getAttribute("data-venue");
    const returnedAtAttr = row.getAttribute("data-returned-at");
    const returnedAt = new Date(returnedAtAttr);

    const isToday = returnedAt >= today && returnedAt < tomorrow;
    const matchesVenue = !selectedVenue || venue === selectedVenue;

    row.style.display = (isToday && matchesVenue) ? "" : "none";
  });
};


//**GATEWAY */


// GATEWAY ITEM SELECT LISTENER
const gatewayCategorySelect = document.getElementById("gatewayCategory");
const gatewayItemSelect = document.getElementById("gatewayItem");

gatewayCategorySelect?.addEventListener("change", () => {
  applyCategoryFilter("gateway");
});

// ✅ Send Gateway Add-on Orders
let recentGatewayOrders = new Map();

window.sendGatewayOrder = async function (button) {
  const itemSelect = document.getElementById("gatewayItem");
  const qtyInput = document.getElementById("gatewayQty");
  const notesInput = document.getElementById("gatewayNotes");

  const recipeNo = itemSelect.value;
  const notes = notesInput?.value?.trim() || "";
  const qty = parseFloat(parseFloat(qtyInput.value || 0).toFixed(2));


  if (!recipeNo || isNaN(qty) || qty <= 0) {
    alert("Please select an item and enter a valid quantity.");
    return;
  }

  // ✅ Prevent duplicate rapid sends
  const cacheKey = `${recipeNo}-${qty}`;
  const now = Date.now();
  if (recentGatewayOrders.has(cacheKey) && now - recentGatewayOrders.get(cacheKey) < 5000) {
    alert("⏳ You've already sent this item recently. Please wait.");
    return;
  }
  recentGatewayOrders.set(cacheKey, now);

  // 🔒 Disable button to prevent double-clicks
  button.disabled = true;

  try {
    const recipeSnapshot = await getDocs(
      query(collection(db, "recipes"), where("recipeNo", "==", recipeNo))
    );

    if (recipeSnapshot.empty) {
      alert("❌ Recipe not found.");
      return;
    }

    const recipeData = recipeSnapshot.docs[0].data();

    if (qty > 1 && recipeData.category?.toUpperCase() === "HOTFOODS") {
      alert("⚠️ HOTFOODS items must be ordered one at a time.");
      return;
    }

    const unitCost = Number(recipeData.cost || 0);
    const totalCost = parseFloat((unitCost * qty).toFixed(2));


    const order = {
      item: recipeData.description || recipeNo,
      qty: qty,
      status: "open",
      venue: "Gateway",
      station: recipeData.station || "Unknown",
      recipeNo: recipeNo,
      cookTime: recipeData.cookTime || 0,
      notes: notes,
      uom: recipeData.uom || "ea",
      timestamp: serverTimestamp(),
      date: getTodayDate(),
      type: "addon",
      totalCost: totalCost
    };

    await addDoc(collection(db, "orders"), order);

    console.log("✅ Gateway order sent:", order);
    qtyInput.value = 1;
    itemSelect.selectedIndex = 0;
    if (notesInput) notesInput.value = "";

  } catch (error) {
    console.error("❌ Failed to send gateway order:", error);
    alert("❌ Failed to send order.");
  } finally {
    setTimeout(() => {
      button.disabled = false;
    }, 1000);
  }
};



// ✅ Listen to Gateway Orders
function listenToGatewayOrders() {
  const ordersRef = collection(db, "orders");
  const gatewayQuery = query(
  ordersRef,
  where("venue", "==", "Gateway"),
  where("status", "in", ["open", "Ready to Send", "sent", "received"]),
  where("date", "==", getTodayDate())
);


  onSnapshot(gatewayQuery, (snapshot) => {
    const orders = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(order => order.type !== "starting-par");

    renderGatewayTable(orders);
  });
}

function renderGatewayTable(orders) {
  const tbody = document.querySelector("#gatewayTable tbody");
  if (!tbody) return;

  // 🧼 Filter out received orders
  orders = orders.filter(order => order.status !== "received");

  tbody.innerHTML = "";

  orders.sort((a, b) => {
    const statusOrder = { sent: 0, "Ready to Send": 1, open: 2 };
    const aPriority = statusOrder[a.status] ?? 3;
    const bPriority = statusOrder[b.status] ?? 3;
    if (aPriority !== bPriority) return aPriority - bPriority;

    const timeA = a.timestamp?.toDate?.()?.getTime?.() || 0;
    const timeB = b.timestamp?.toDate?.()?.getTime?.() || 0;
    return timeA - timeB;
  });

  const now = new Date();

  orders.forEach(order => {
    const row = document.createElement("tr");

    let createdAt = new Date();
    if (order.timestamp?.toDate) {
      createdAt = order.timestamp.toDate();
    }

    const cookTime = order.cookTime || 0;
    const dueTime = new Date(createdAt.getTime() + cookTime * 60000);

    const createdFormatted = createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dueFormatted = dueTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (dueTime < now) {
      row.style.backgroundColor = "rgba(255, 0, 0, 0.15)";
    }

    let actionsHTML = "";
    if (order.status === "open" && order.type === "addon") {
      actionsHTML = `
        <button onclick='showEditModal(${JSON.stringify(order).replace(/"/g, "&quot;")})'>✏️</button>
        <button onclick="showDeleteModal('${order.id}')">🗑️</button>
      `;
    } else if (["sent"].includes(order.status)) {
      actionsHTML = `<button onclick="markOrderReceived('${order.id}', this)">✓ Receive</button>`;
    }

   row.innerHTML = `
  <td data-label="Created">${createdFormatted}</td>
  <td data-label="Due">${dueFormatted}</td>
  <td data-label="Item">${order.item}</td>
  <td data-label="Qty">${order.qty}</td>
  <td data-label="Status">${order.status}</td>
  <td data-label="Actions">${actionsHTML}</td>
`;
    tbody.appendChild(row);
  });

  const totalGuests = window.guestCounts?.Gateway || 0;
  const guestEl = document.getElementById("gatewayTotalGuests");
  if (guestEl) guestEl.textContent = totalGuests;
}



window.markOrderReceived = async function (orderId, button) {
  const timing = await new Promise((resolve) => {
    const confirmBox = document.createElement("div");
    confirmBox.style.position = "fixed";
    confirmBox.style.top = "50%";
    confirmBox.style.left = "50%";
    confirmBox.style.transform = "translate(-50%, -50%)";
    confirmBox.style.background = "#222";
    confirmBox.style.color = "#fff";
    confirmBox.style.padding = "20px";
    confirmBox.style.border = "2px solid #aaa";
    confirmBox.style.borderRadius = "8px";
    confirmBox.style.zIndex = "9999";
    confirmBox.innerHTML = `
      <p style="margin-bottom: 12px;">When did the item arrive?</p>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="beforeBtn">Arrived BEFORE food ran out</button>
        <button id="afterBtn">Arrived AFTER food ran out</button>
      </div>
    `;

    document.body.appendChild(confirmBox);

    confirmBox.querySelector("#beforeBtn").onclick = () => {
      resolve("before");
      document.body.removeChild(confirmBox);
    };
    confirmBox.querySelector("#afterBtn").onclick = () => {
      resolve("after");
      document.body.removeChild(confirmBox);
    };
  });

  try {
    const orderRef = doc(db, "orders", orderId);
    await updateDoc(orderRef, {
      status: "received",
      receivedAt: serverTimestamp(),
      arrivalTiming: timing === "before" ? "Before Food Ran Out" : "After Food Ran Out"
    });
  } catch (err) {
    console.error("❌ Failed to mark received:", err);
    alert("❌ Failed to update order.");
  }
};

//GATEWAY WASTE


// 🔁 Load Gateway Waste Items
window.gatewayWasteTotals = window.gatewayWasteTotals || {};

window.loadGatewayWaste = async function (filteredList = null) {
  const tableBody = document.querySelector(".gateway-section[data-sec='waste'] .waste-table tbody");
  if (!tableBody) return;

  tableBody.innerHTML = "";

  if (!window.cachedGatewayWasteRecipes) {
    const recipesRef = collection(db, "recipes");
    const q = query(recipesRef, where("venueCodes", "array-contains", "b003"));
    const snapshot = await getDocs(q);
    window.cachedGatewayWasteRecipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log("📦 Loaded and cached Gateway recipes:", snapshot.size);
  }

  const recipes = filteredList || window.cachedGatewayWasteRecipes;
  window.gatewayWasteRecipeList = recipes;

  recipes.forEach(recipe => {
    const row = document.createElement("tr");
    row.dataset.recipeId = recipe.id;

    const savedQty = window.gatewayWasteTotals?.[recipe.id] || 0;

    row.innerHTML = `
      <td>${recipe.description}</td>
      <td>${recipe.uom || "ea"}</td>
      <td>
        <span class="waste-total">${savedQty}</span>
        <input class="waste-input" type="number" min="0" value="0" style="width: 60px; margin-left: 6px;" />
        <button onclick="addToGatewayWasteQty(this)" style="margin-left: 6px;">Add</button>
      </td>
      <td><button onclick="sendSingleGatewayWaste(this, '${recipe.id}')">Send</button></td>
    `;

    tableBody.appendChild(row);
  });
};
window.filterGatewayWaste = function () {
  const searchValue = document.getElementById("gatewayWasteSearch")?.value?.trim().toLowerCase() || "";
  const selectedCategory = document.getElementById("gateway-waste-category")?.value?.toLowerCase() || "";

  const filtered = window.cachedGatewayWasteRecipes.filter(recipe => {
    const name = recipe.description?.toLowerCase() || "";
    const category = recipe.category?.toLowerCase() || "";

    const matchesSearch = !searchValue || name.includes(searchValue);
    const matchesCategory = !selectedCategory || category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  window.loadGatewayWaste(filtered);
};




window.addToGatewayWasteQty = function (button) {
  const row = button.closest("tr");
  const input = row.querySelector(".waste-input");
  const span = row.querySelector(".waste-total");

  const addQty = Number(input.value);
  const currentQty = Number(span.textContent);
  const newQty = currentQty + addQty;

  if (!isNaN(addQty) && addQty > 0) {
    span.textContent = newQty;
    input.value = "0";

    const recipeId = row.dataset.recipeId;
    window.gatewayWasteTotals[recipeId] = newQty;
  }
};


// 🔘 Single waste sender for Gateway
window.sendSingleGatewayWaste = async function (button, recipeId) {
  const row = button.closest("tr");
  const span = row.querySelector(".waste-total");
  const input = row.querySelector(".waste-input");
  const qty = Number(span.textContent);

  if (qty <= 0) {
    alert("Please add a quantity first.");
    return;
  }

  const recipe = window.gatewayWasteRecipeList.find(r => r.id === recipeId);
  if (!recipe) {
    alert("❌ Recipe not found.");
    return;
  }

  // ✅ Check if wasting more than received
  const hasEnough = await checkIfEnoughReceived(recipeId, qty, "Gateway");
  if (!hasEnough) {
    alert(`🚫 Cannot waste ${qty} of "${recipe.description}" — more than received.`);
    return;
  }

  const today = getTodayDate();
  const wasteData = {
    item: recipe.description,
    venue: "Gateway",
    qty,
    uom: recipe.uom || "ea",
    date: today,
    timestamp: serverTimestamp()
  };

  await addDoc(collection(db, "waste"), wasteData);

  console.log(`✅ Sent Gateway waste: ${qty} of ${recipe.description}`);
  span.textContent = "0";
  input.value = "0";

  const confirm = document.createElement("span");
  confirm.textContent = "Sent";
  confirm.style.color = "green";
  confirm.style.marginLeft = "8px";
  button.parentNode.appendChild(confirm);
  setTimeout(() => confirm.remove(), 2000);
};

window.sendAllGatewayWaste = async function () {
  const rows = document.querySelectorAll("#gateway .waste-table tbody tr");
  console.log("🧪 Found Gateway rows:", rows.length);

  const today = getTodayDate();
  let sentCount = 0;

  for (const row of rows) {
    const recipeId = row.dataset.recipeId;
    const span = row.querySelector(".waste-total");
    const input = row.querySelector(".waste-input");
    const qty = Number(span?.textContent || 0);

    if (qty > 0) {
      const recipe = window.gatewayWasteRecipeList.find(r => r.id === recipeId);
      if (!recipe) {
        console.warn(`⚠️ Gateway recipe not found for ID: ${recipeId}`);
        continue;
      }

      // ✅ Check waste vs. total ordered
      const hasEnough = await checkIfEnoughReceived(recipeId, qty, "Gateway");
      if (!hasEnough) {
        alert(`🚫 Cannot waste ${qty} of "${recipe.description}" — more than received.`);
        continue;
      }

      const wasteData = {
        item: recipe.description,
        venue: "Gateway",
        qty,
        uom: recipe.uom || "ea",
        date: today,
        timestamp: serverTimestamp()
      };

      await addDoc(collection(db, "waste"), wasteData);
      console.log(`✅ Sent Gateway waste: ${qty} of ${recipe.description}`);
      sentCount++;

      // Reset
      span.textContent = "0";
      if (input) input.value = "0";

      const confirm = document.createElement("span");
      confirm.textContent = "Sent";
      confirm.style.color = "green";
      confirm.style.marginLeft = "8px";
      row.querySelector("td:last-child").appendChild(confirm);
      setTimeout(() => confirm.remove(), 2000);
    }
  }

  if (sentCount > 0) {
    alert(`✅ ${sentCount} Gateway waste entr${sentCount === 1 ? "y" : "ies"} sent.`);
  } else {
    alert("⚠️ No Gateway waste entries with quantity greater than 0.");
  }
};


//GATEWAY RETURNS
window.loadGatewayReturns = async function () {
  const tableBody = document.querySelector(".gateway-returns-table tbody");
  tableBody.innerHTML = "";

  console.log("🔁 Loading Gateway Returns...");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const ordersRef = collection(db, "orders");
  const q = query(
    ordersRef,
    where("venue", "==", "Gateway"),
    where("status", "==", "received")
  );
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    console.log("📭 No orders received today for Gateway");
    return;
  }

  const todayOrders = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(order => {
      const receivedAt = order.receivedAt?.toDate?.();
      return receivedAt && receivedAt.toDateString() === today.toDateString();
    });

  const returnsSnapshot = await getDocs(
    query(
      collection(db, "returns"),
      where("venue", "==", "Gateway")
    )
  );

  const excludedRecipeIds = new Set();
  returnsSnapshot.forEach(doc => {
    const status = doc.data().status;
    const recipeId = doc.data().recipeId;
    if (status === "returned" || status === "received") {
      excludedRecipeIds.add(recipeId);
    }
  });

  console.log(`📦 Found ${todayOrders.length} Gateway orders received today`);

  if (todayOrders.length === 0) return;

const recipeQtyMap = {};
todayOrders.forEach(order => {
  const recipeNo = order.recipeNo || order.recipeId;
  const qty = Number(order.qty) || 0;

  if (!recipeNo) return;

  recipeQtyMap[recipeNo] = (recipeQtyMap[recipeNo] || 0) + qty;
});


  const validRecipes = [];

  for (const recipeNo in recipeQtyMap) {
    const recipeQuery = query(
  collection(db, "recipes"),
  where("recipeNo", "==", recipeNo)
);
const recipeSnapshot = await getDocs(recipeQuery);

if (!recipeSnapshot.empty) {
  const recipeDoc = recipeSnapshot.docs[0];
  const recipe = recipeDoc.data();

  if (
    recipe.returns?.toLowerCase() === "yes" &&
    !excludedRecipeIds.has(recipeDoc.id)
  ) {
    validRecipes.push({
      id: recipeDoc.id,
      name: recipe.description,
      uom: recipe.uom || "ea",
      qty: recipeQtyMap[recipeNo]
    });
  }
}
  }

  if (validRecipes.length === 0) {
    console.log("📭 No valid returnable items for Gateway today.");
    return;
  }

  validRecipes.forEach(recipe => {
    const row = document.createElement("tr");
    row.dataset.recipeId = recipe.id;

    row.innerHTML = `
      <td>${recipe.name}</td>
      <td>${recipe.qty} ${recipe.uom}</td>
      <td>
        <input class="return-input" type="number" min="0" value="0" style="width: 60px;" />
      </td>
      <td>
        <button onclick="sendSingleGatewayReturn(this, '${recipe.id}')">Return</button>
      </td>
    `;

    tableBody.appendChild(row);
  });

  console.log(`✅ Loaded ${validRecipes.length} returnable recipes`);
};

window.sendSingleGatewayReturn = async function (btn, recipeId) {
  const row = btn.closest("tr");
  const qtyInput = row.querySelector(".return-input");
  const qty = Number(qtyInput.value);

  if (isNaN(qty) || qty <= 0) {
    alert("Please enter a valid quantity to return.");
    return;
  }

  try {
    await addDoc(collection(db, "returns"), {
      recipeId: recipeId,
      qty: qty,
      venue: "Gateway",
      status: "returned",
      returnedAt: serverTimestamp()
    });

    const cell = btn.parentElement;
    cell.innerHTML = `<span style="color: green;">Returned</span>`;

    setTimeout(() => {
      row.remove();
    }, 800);

    console.log(`🔁 Returned ${qty} of recipe ${recipeId}`);
  } catch (error) {
    console.error("Error returning item:", error);
    alert("Error submitting return. Please try again.");
  }
};

//GATEWAY STARTING PARS
window.loadGatewayStartingPar = async function () {
  console.log("🚀 Starting Gateway par load...");

  const today = getTodayDate();
  const guestRef = doc(db, "guestCounts", today);
  const guestSnap = await getDoc(guestRef);

  if (!guestSnap.exists()) {
    console.warn("❌ No guestCounts document found for today:", today);
    document.getElementById("gatewayGuestInfo").textContent = "⚠️ No guest count for today.";
    return;
  }

  const guestData = guestSnap.data();
  console.log("📦 Full guest data:", guestData);

  const guestCount = guestData?.Gateway || 0;
  document.getElementById("gatewayGuestInfo").textContent = `👥 Guest Count: ${guestCount}`;

  // Load Gateway recipes
  const recipesRef = collection(db, "recipes");
  const q = query(recipesRef, where("venueCodes", "array-contains", "b003")); // Gateway
  const snapshot = await getDocs(q);
  const recipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // Load today's sent orders
  const ordersQuery = query(
    collection(db, "orders"),
    where("type", "==", "starting-par"),
    where("venue", "==", "Gateway"),
    where("date", "==", today)
  );
  const ordersSnap = await getDocs(ordersQuery);

  const sentPars = {};
  const receivedPars = {};

  ordersSnap.forEach(doc => {
    const order = doc.data();
    if (!sentPars[order.recipeId]) sentPars[order.recipeId] = 0;
    sentPars[order.recipeId] += order.qty;

    if (order.received) {
      receivedPars[order.recipeId] = true;
    }
  });

  // ✅ Cache
  if (!window.startingCache) window.startingCache = {};
  window.startingCache["Gateway"] = { recipes, guestCount, sentPars, receivedPars };

  renderStartingStatus("Gateway", window.startingCache["Gateway"]);
};


//**OHANA */
// Dropdown listener for Ohana
const ohanaCategorySelect = document.getElementById("ohanaCategory");
const ohanaItemSelect = document.getElementById("ohanaItem");

ohanaCategorySelect?.addEventListener("change", () => {
  applyCategoryFilter("ohana");
});

// Send order for Ohana
let recentOhanaOrders = new Map();

window.sendOhanaOrder = async function (button) {
  const itemSelect = document.getElementById("ohanaItem");
  const qtyInput = document.getElementById("ohanaQty");
  const notesInput = document.getElementById("ohanaNotes");

  const recipeNo = itemSelect.value;
  const notes = notesInput?.value?.trim() || "";
  const qty = parseFloat(parseFloat(qtyInput.value || 0).toFixed(2));


  if (!recipeNo || isNaN(qty) || qty <= 0) {
    alert("Please select an item and enter a valid quantity.");
    return;
  }

  // 🛑 Prevent recent duplicate submission
  const cacheKey = `${recipeNo}-${qty}`;
  const now = Date.now();
  if (recentOhanaOrders.has(cacheKey) && now - recentOhanaOrders.get(cacheKey) < 5000) {
    alert("⏳ You've already sent this item recently. Please wait.");
    return;
  }
  recentOhanaOrders.set(cacheKey, now);

  button.disabled = true;

  try {
    const recipeSnapshot = await getDocs(
      query(collection(db, "recipes"), where("recipeNo", "==", recipeNo))
    );

    if (recipeSnapshot.empty) {
      alert("❌ Recipe not found.");
      return;
    }

    const recipeData = recipeSnapshot.docs[0].data();

    if (qty > 1 && recipeData.category?.toUpperCase() === "HOTFOODS") {
      alert("⚠️ HOTFOODS items must be ordered one at a time.");
      return;
    }

    const unitCost = Number(recipeData.cost || 0);
    const totalCost = parseFloat((unitCost * qty).toFixed(2));


    const order = {
      item: recipeData.description || recipeNo,
      qty: qty,
      status: "open",
      venue: "Ohana",
      station: recipeData.station || "Unknown",
      recipeNo: recipeNo,
      cookTime: recipeData.cookTime || 0,
      notes: notes,
      uom: recipeData.uom || "ea",
      timestamp: serverTimestamp(),
      date: getTodayDate(),
      type: "addon",
      totalCost: totalCost
    };

    await addDoc(collection(db, "orders"), order);

    console.log("✅ Ohana order sent:", order);
    qtyInput.value = 1;
    itemSelect.selectedIndex = 0;
    if (notesInput) notesInput.value = "";

  } catch (error) {
    console.error("❌ Failed to send order:", error);
    alert("❌ Failed to send order.");
  } finally {
    setTimeout(() => {
      button.disabled = false;
    }, 1000);
  }
};



// Realtime listener for Ohana
function listenToOhanaOrders() {
  const ordersRef = collection(db, "orders");
 const ohanaQuery = query(
  ordersRef,
  where("venue", "==", "Ohana"),
  where("status", "in", ["open", "Ready to Send", "sent", "received"]),
  where("date", "==", getTodayDate())
);


  onSnapshot(ohanaQuery, (snapshot) => {
    const orders = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(order => order.type !== "starting-par");

    renderOhanaTable(orders);
  });
}

// Render table for Ohana orders
function renderOhanaTable(orders) {
  const tbody = document.querySelector("#ohanaTable tbody");
  if (!tbody) return;

  // 🧼 Filter out received orders
  orders = orders.filter(order => order.status !== "received");

  tbody.innerHTML = "";

  orders.sort((a, b) => {
    const statusOrder = { sent: 0, "Ready to Send": 1, open: 2 };
    const aPriority = statusOrder[a.status] ?? 3;
    const bPriority = statusOrder[b.status] ?? 3;

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    const timeA = a.timestamp?.toDate?.()?.getTime?.() || 0;
    const timeB = b.timestamp?.toDate?.()?.getTime?.() || 0;
    return timeA - timeB;
  });

  const now = new Date();

  orders.forEach(order => {
    const row = document.createElement("tr");

    let createdAt = new Date();
    if (order.timestamp?.toDate) {
      createdAt = order.timestamp.toDate();
    }

    const cookTime = order.cookTime || 0;
    const dueTime = new Date(createdAt.getTime() + cookTime * 60000);

    const createdFormatted = createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dueFormatted = dueTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const isLate = dueTime < now;
    if (isLate) {
      row.style.backgroundColor = "rgba(255, 0, 0, 0.15)";
    }

    let actionsHTML = "";
    if (order.status === "open" && order.type === "addon") {
      actionsHTML = `
        <button onclick='showEditModal(${JSON.stringify(order).replace(/"/g, "&quot;")})'>✏️</button>
        <button onclick="showDeleteModal('${order.id}')">🗑️</button>
      `;
    } else if (["sent"].includes(order.status)) {
      actionsHTML = `<button onclick="markOrderReceived('${order.id}', this)">✓ Receive</button>`;
    }

   row.innerHTML = `
  <td data-label="Created">${createdFormatted}</td>
  <td data-label="Due">${dueFormatted}</td>
  <td data-label="Item">${order.item}</td>
  <td data-label="Qty">${order.qty}</td>
  <td data-label="Status">${order.status}</td>
  <td data-label="Actions">${actionsHTML}</td>
`;
    tbody.appendChild(row);
  });
}


// Expose listener globally
window.listenToOhanaOrders = listenToOhanaOrders;






//**CONCESSIONS */
// ✅ Concession category and item dropdown
const concessionCategorySelect = document.getElementById("concessionCategory");
const concessionItemSelect = document.getElementById("concessionItem");

concessionCategorySelect?.addEventListener("change", () => {
  applyCategoryFilter("concession");
});

// ✅ Send concession add-on order
window.sendConcessionOrder = async function (button) {
  const itemSelect = document.getElementById("concessionItem");
  const qtyInput = document.getElementById("concessionQty");
  const notesInput = document.getElementById("concessionNotes");

  const recipeNo = itemSelect.value;
  const notes = notesInput?.value?.trim() || "";
const qty = parseFloat(qtyInput.value || 0);

  if (!recipeNo || isNaN(qty) || qty <= 0) {
  alert("Please select an item and enter a valid quantity.");
  return;
}

  try {
    const recipeSnapshot = await getDocs(
      query(collection(db, "recipes"), where("recipeNo", "==", recipeNo))
    );

    if (recipeSnapshot.empty) {
      alert("❌ Recipe not found.");
      return;
    }

    const recipeData = recipeSnapshot.docs[0].data();

    // 🔒 Only restrict quantity if it's HOTFOODS
    if (qty > 1 && recipeData.category?.toUpperCase() === "HOTFOODS") {
      alert("⚠️ HOTFOODS items must be ordered one at a time.");
      return;
    }

    const order = {
      item: recipeData.description || recipeNo,
      qty: qty,
      status: "open",
      venue: "Concessions",
      station: recipeData.station || "Unknown",
      recipeNo: recipeNo,
      cookTime: recipeData.cookTime || 0,
      notes: notes,
      uom: recipeData.uom || "ea",
      timestamp: serverTimestamp(),
    };

    await addDoc(collection(db, "orders"), order);

    console.log("✅ Concession order sent:", order);
    qtyInput.value = 1;
    itemSelect.selectedIndex = 0;
    if (notesInput) notesInput.value = "";
  } catch (error) {
    console.error("❌ Failed to send concession order:", error);
    alert("❌ Failed to send order.");
  }
};


// ✅ Listen to concession open orders
function listenToConcessionOrders() {
  const ordersRef = collection(db, "orders");
  const queryRef = query(
    ordersRef,
    where("venue", "==", "Concessions"), // ✅ Matches Firestore
    where("status", "in", ["open", "Ready to Send", "sent"]),
    where("date", "==", getTodayDate()) // ✅ CRITICAL
  );

  onSnapshot(queryRef, (snapshot) => {
    const orders = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((order) => order.type !== "starting-par");

    console.log("📡 Concession open orders found:", orders.length); // ✅ Debug
    renderConcessionTable(orders);
  });
}


// ✅ Render open orders table for concession
function renderConcessionTable(orders) {
  const tbody = document.querySelector("#concessionTable tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  orders.sort((a, b) => {
    const statusOrder = { sent: 0, "Ready to Send": 1, open: 2 };
    const aPriority = statusOrder[a.status] ?? 3;
    const bPriority = statusOrder[b.status] ?? 3;
    if (aPriority !== bPriority) return aPriority - bPriority;
    const timeA = a.timestamp?.toDate?.()?.getTime?.() || 0;
    const timeB = b.timestamp?.toDate?.()?.getTime?.() || 0;
    return timeA - timeB;
  });

  const now = new Date();

  orders.forEach((order) => {
    const row = document.createElement("tr");

    let createdAt = new Date();
    if (order.timestamp?.toDate) {
      createdAt = order.timestamp.toDate();
    }

    const cookTime = order.cookTime || 0;
    const dueTime = new Date(createdAt.getTime() + cookTime * 60000);

    const createdFormatted = createdAt.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const dueFormatted = dueTime.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const isLate = dueTime < now;
    if (isLate) {
      row.style.backgroundColor = "rgba(255, 0, 0, 0.15)";
    }

    row.innerHTML = `
      <td>${createdFormatted}</td>
      <td>${dueFormatted}</td>
      <td>${order.item}</td>
      <td>${order.qty}</td>
      <td>${order.status}</td>
      <td>
        ${order.status === "sent"
          ? `<button onclick="markOrderReceived('${order.id}', this)">✓ Receive</button>`
          : ""}
      </td>
    `;

    tbody.appendChild(row);
  });
}

// 🔄 Expose listener
window.listenToConcessionOrders = listenToConcessionOrders;


//CONCESSIONS STARTING PAR
window.loadConcessionStartingPar = async function () {
  console.log("🚀 Starting Concession par load...");

  const today = getTodayDate();
  const guestRef = doc(db, "guestCounts", today);
  const guestSnap = await getDoc(guestRef);

  if (!guestSnap.exists()) {
    console.warn("❌ No guestCounts document found for today:", today);
    document.getElementById("concessionGuestInfo").textContent = "⚠️ No guest count for today.";
    return;
  }

  const guestData = guestSnap.data();
  const guestCount = guestData?.Concession || 0;
  document.getElementById("concessionGuestInfo").textContent = `👥 Guest Count: ${guestCount}`;

  // 🔍 Load recipes with Concession venueCodes
  const recipesRef = collection(db, "recipes");
  const q = query(recipesRef, where("venueCodes", "array-contains-any", ["c002", "c003", "c004"]));
  const snapshot = await getDocs(q);
  const recipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // 🔍 Load today's starting-par orders sent to Concessions
  const ordersQuery = query(
    collection(db, "orders"),
    where("type", "==", "starting-par"),
    where("venue", "==", "Concessions"), // 👈 must match your Firestore exactly
    where("date", "==", today)
  );
  const ordersSnap = await getDocs(ordersQuery);

  const sentPars = {};       // recipeId → qty
  const receivedPars = {};   // recipeId → true

  ordersSnap.forEach(doc => {
    const order = doc.data();
    const recipeId = order.recipeId;

    if (!sentPars[recipeId]) sentPars[recipeId] = 0;
    sentPars[recipeId] += order.qty;

    if (order.status === "received") {
      receivedPars[recipeId] = true;
    }
  });

  // ✅ Cache for use in renderStartingStatus()
  window.startingCache = window.startingCache || {};
  window.startingCache["Concession"] = {
    recipes,
    guestCount,
    sentPars,
    receivedPars
  };

  renderStartingStatus("Concession", window.startingCache["Concession"]);
};
window.receiveConcessionItem = async function (recipeId, qty, button) {
  const today = getTodayDate();
  const orderRef = collection(db, "orders");

  const q = query(
    orderRef,
    where("type", "==", "starting-par"),
    where("date", "==", today),
    where("venue", "==", "Concessions"),
    where("recipeId", "==", recipeId),
    where("status", "==", "sent")
  );
  const snap = await getDocs(q);

  for (const docSnap of snap.docs) {
    await updateDoc(docSnap.ref, {
      status: "received"
    });
  }

  button.disabled = true;
  button.textContent = "✅ Received";

  console.log(`✅ Marked ${qty} of ${recipeId} as received`);
};


//OHANA WASTE
// Initialize memory for totals if not already set
window.ohanaWasteTotals = window.ohanaWasteTotals || {};

window.loadOhanaWaste = async function (filteredList = null) {
  const tableBody = document.querySelector(".ohana-section[data-sec='waste'] .waste-table tbody");
  tableBody.innerHTML = "";

  // 🔁 Load from Firestore if not cached
  if (!window.cachedOhanaWasteRecipes) {
    const recipesRef = collection(db, "recipes");
    const q = query(recipesRef, where("venueCodes", "array-contains", "b002"));
    const snapshot = await getDocs(q);
    window.cachedOhanaWasteRecipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log("📦 Loaded and cached Ohana recipes:", snapshot.size);
  }

  const recipes = filteredList || window.cachedOhanaWasteRecipes;
  window.ohanaWasteRecipeList = recipes;

  recipes.forEach(recipe => {
    const row = document.createElement("tr");
    row.dataset.recipeId = recipe.id;

    const savedQty = window.ohanaWasteTotals?.[recipe.id] || 0;

    row.innerHTML = `
      <td>${recipe.description}</td>
      <td>${recipe.uom || "ea"}</td>
      <td>
        <span class="waste-total">${savedQty}</span>
        <input class="waste-input" type="number" min="0" value="0" style="width: 60px; margin-left: 6px;" />
        <button onclick="addToOhanaWasteQty(this)" style="margin-left: 6px;">Add</button>
      </td>
      <td><button onclick="sendSingleOhanaWaste(this, '${recipe.id}')">Send</button></td>
    `;

    tableBody.appendChild(row);
  });
};

window.filterOhanaWaste = function () {
  const searchValue = document.getElementById("ohanaWasteSearch")?.value?.trim().toLowerCase() || "";
  const selectedCategory = document.getElementById("ohana-waste-category")?.value?.toLowerCase() || "";

  const filtered = window.cachedOhanaWasteRecipes.filter(recipe => {
    const name = recipe.description?.toLowerCase() || "";
    const category = recipe.category?.toLowerCase() || "";

    const matchesSearch = !searchValue || name.includes(searchValue);
    const matchesCategory = !selectedCategory || category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  window.loadOhanaWaste(filtered);
};


window.addToOhanaWasteQty = function (button) {
  const row = button.closest("tr");
  const input = row.querySelector(".waste-input");
  const span = row.querySelector(".waste-total");

  const addQty = Number(input.value);
  const currentQty = Number(span.textContent);
  const newQty = currentQty + addQty;

  if (!isNaN(addQty) && addQty > 0) {
    span.textContent = newQty;
    input.value = "0";

    const recipeId = row.dataset.recipeId;
    window.ohanaWasteTotals[recipeId] = newQty;
  }
};



window.sendAllOhanaWaste = async function () {
  const rows = document.querySelectorAll("#ohana .waste-table tbody tr");
  console.log("🧪 Found Ohana rows:", rows.length);

  const today = getTodayDate();
  let sentCount = 0;

  for (const row of rows) {
    const recipeId = row.dataset.recipeId;
    const span = row.querySelector(".waste-total");
    const input = row.querySelector(".waste-input");
    const qty = Number(span?.textContent || 0);

    if (qty > 0) {
      const recipe = window.ohanaWasteRecipeList.find(r => r.id === recipeId);
      if (!recipe) {
        console.warn(`⚠️ Ohana recipe not found for ID: ${recipeId}`);
        continue;
      }

      const hasEnough = await checkIfEnoughReceived(recipeId, qty, "Ohana");
      if (!hasEnough) {
        alert(`🚫 Cannot waste ${qty} of "${recipe.description}" — more than received.`);
        continue;
      }

      const wasteData = {
        item: recipe.description,
        venue: "Ohana",
        qty,
        uom: recipe.uom || "ea",
        date: today,
        timestamp: serverTimestamp()
      };

      await addDoc(collection(db, "waste"), wasteData);
      console.log(`✅ Sent Ohana waste: ${qty} of ${recipe.description}`);
      sentCount++;

      // Reset waste qty after sending
      span.textContent = "0";
      if (input) input.value = "0";

      const confirm = document.createElement("span");
      confirm.textContent = "Sent";
      confirm.style.color = "green";
      confirm.style.marginLeft = "8px";
      row.querySelector("td:last-child").appendChild(confirm);
      setTimeout(() => confirm.remove(), 2000);
    }
  }

  if (sentCount > 0) {
    alert(`✅ ${sentCount} Ohana waste entr${sentCount === 1 ? "y" : "ies"} sent.`);
  } else {
    alert("⚠️ No Ohana waste entries with quantity greater than 0.");
  }
};

window.sendSingleOhanaWaste = async function (button, recipeId) {
  const row = button.closest("tr");
  const span = row.querySelector(".waste-total");
  const input = row.querySelector(".waste-input");
  const qty = Number(span.textContent);

  if (qty <= 0) {
    alert("Please add a quantity first.");
    return;
  }

  const recipe = window.ohanaWasteRecipeList.find(r => r.id === recipeId);
  const today = getTodayDate();

  const hasEnough = await checkIfEnoughReceived(recipeId, qty, "Ohana");
  if (!hasEnough) {
    alert(`🚫 Cannot waste ${qty} of "${recipe.description}" — more than received.`);
    return;
  }

  const wasteData = {
    item: recipe.description,
    venue: "Ohana",
    qty,
    uom: recipe.uom || "ea",
    date: today,
    timestamp: serverTimestamp()
  };

  await addDoc(collection(db, "waste"), wasteData);
  console.log(`✅ Sent Ohana waste: ${qty} of ${recipe.description}`);

  span.textContent = "0";
  input.value = "0";

  const confirm = document.createElement("span");
  confirm.textContent = "Sent";
  confirm.style.color = "green";
  confirm.style.marginLeft = "8px";
  row.querySelector("td:last-child").appendChild(confirm);
  setTimeout(() => confirm.remove(), 2000);
};
async function checkIfEnoughReceived(recipeId, wasteQty, venue) {
  const today = getTodayDate(); // e.g., "2025-07-28"

  // 🔎 Fetch all received orders for today
  const ordersRef = collection(db, "orders");
  const ordersQuery = query(
    ordersRef,
    where("recipeId", "==", recipeId),
    where("venue", "==", venue),
    where("status", "==", "received"),
    where("date", "==", today)
  );
  const ordersSnap = await getDocs(ordersQuery);

  let totalReceived = 0;
  ordersSnap.forEach(doc => {
    const data = doc.data();
    totalReceived += Number(data.sendQty || 0);
  });

  // 🗑️ Fetch all waste already recorded for this recipe today
  const recipes = window.alohaWasteRecipeList || [];
  const matchedRecipe = recipes.find(r => r.id === recipeId);
  const recipeDescription = matchedRecipe?.description || "";

  const wasteRef = collection(db, "waste");
  const wasteQuery = query(
    wasteRef,
    where("venue", "==", venue),
    where("item", "==", recipeDescription),
    where("date", "==", today)
  );
  const wasteSnap = await getDocs(wasteQuery);

  let alreadyWasted = 0;
  wasteSnap.forEach(doc => {
    alreadyWasted += Number(doc.data().qty || 0);
  });

  // ✅ Check if waste would exceed what was received
  return wasteQty <= (totalReceived - alreadyWasted);
}

//OHANA RETURNS
window.loadOhanaReturns = async function () {
  const tableBody = document.querySelector(".ohana-returns-table tbody");
  tableBody.innerHTML = "";

  console.log("🔁 Loading Ohana Returns...");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const ordersRef = collection(db, "orders");
  const q = query(
    ordersRef,
    where("venue", "==", "Ohana"),
    where("status", "==", "received")
  );
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    console.log("📭 No orders received today for Ohana");
    return;
  }

  const todayOrders = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(order => {
      const receivedAt = order.receivedAt?.toDate?.();
      return receivedAt && receivedAt.toDateString() === today.toDateString();
    });

  const returnsSnapshot = await getDocs(
    query(collection(db, "returns"), where("venue", "==", "Ohana"))
  );

  const excludedRecipeIds = new Set();
  returnsSnapshot.forEach(doc => {
    const { status, recipeId } = doc.data();
    if ((status === "returned" || status === "received") && recipeId) {
      excludedRecipeIds.add(recipeId);
    }
  });

  console.log(`📦 Found ${todayOrders.length} Ohana orders received today`);
  if (todayOrders.length === 0) return;

  const recipeQtyMap = {};
  todayOrders.forEach(order => {
    const recipeKey = order.recipeNo || order.recipeId;
    const qty = Number(order.qty ?? order.sendQty ?? 0);


    if (!recipeKey) return;

    recipeQtyMap[recipeKey] = (recipeQtyMap[recipeKey] || 0) + qty;
  });

  const validRecipes = [];

  for (const recipeKey in recipeQtyMap) {
    let recipeDoc = null;

    const recipeQuery = query(
      collection(db, "recipes"),
      where("recipeNo", "==", recipeKey)
    );
    const recipeSnapshot = await getDocs(recipeQuery);

    if (!recipeSnapshot.empty) {
      recipeDoc = recipeSnapshot.docs[0];
    } else {
      const fallbackDoc = await getDoc(doc(db, "recipes", recipeKey));
      if (fallbackDoc.exists()) {
        recipeDoc = fallbackDoc;
      }
    }

    if (!recipeDoc) {
      console.warn("❌ Could not find recipe for", recipeKey);
      continue;
    }

    if (excludedRecipeIds.has(recipeDoc.id)) {
      continue;
    }

    const recipe = recipeDoc.data();

    if (String(recipe.returns || "").toLowerCase() === "yes") {
      validRecipes.push({
        id: recipeDoc.id,
        name: recipe.description,
        uom: recipe.uom || "ea",
        qty: recipeQtyMap[recipeKey]
      });
    }
  }

  if (validRecipes.length === 0) {
    console.log("📭 No valid returnable items for Ohana today.");
    return;
  }

  validRecipes.forEach(recipe => {
    const row = document.createElement("tr");
    row.dataset.recipeId = recipe.id;

    row.innerHTML = `
      <td>${recipe.name}</td>
      <td>${recipe.qty} ${recipe.uom}</td>
      <td>
        <input class="return-input" type="number" min="0" value="0" style="width: 60px;" />
      </td>
      <td>
        <button onclick="sendOhanaReturn(this, '${recipe.id}')">Return</button>
      </td>
    `;

    tableBody.appendChild(row);
  });

  console.log(`✅ Loaded ${validRecipes.length} returnable recipes`);
};

window.sendOhanaReturn = async function (btn, recipeId) {
  const row = btn.closest("tr");
  const qtyInput = row.querySelector(".return-input");
  const qty = Number(qtyInput.value);

  if (isNaN(qty) || qty <= 0) {
    alert("Please enter a valid quantity to return.");
    return;
  }

  try {
    await addDoc(collection(db, "returns"), {
      recipeId,
      qty,
      venue: "Ohana",
      status: "returned",
      returnedAt: serverTimestamp()
    });

    btn.parentElement.innerHTML = `<span style="color: green;">Returned</span>`;
    setTimeout(() => row.remove(), 800);
    console.log(`🔁 Returned ${qty} of recipe ${recipeId}`);
  } catch (error) {
    console.error("Error returning item:", error);
    alert("Error submitting return. Please try again.");
  }
};
//OHANA STARTING PAR

window.loadOhanaStartingPar = async function () {
  console.log("🚀 Starting Ohana par load...");

  const today = getTodayDate();
  const guestRef = doc(db, "guestCounts", today);
  const guestSnap = await getDoc(guestRef);

  if (!guestSnap.exists()) {
    console.warn("❌ No guestCounts document found for today:", today);
    document.getElementById("ohanaGuestInfo").textContent = "⚠️ No guest count for today.";
    return;
  }

  const guestData = guestSnap.data();
  console.log("🌺 Full guest data:", guestData);

  const guestCount = guestData?.Ohana || 0;
  document.getElementById("ohanaGuestInfo").textContent = `👥 Guest Count: ${guestCount}`;

  // 🔍 Load recipes for Ohana (venueCode b002)
  const recipesRef = collection(db, "recipes");
  const q = query(recipesRef, where("venueCodes", "array-contains", "b002"));
  const snapshot = await getDocs(q);
  const recipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // 🔁 Load today's sent orders for Ohana
  const ordersQuery = query(
    collection(db, "orders"),
    where("type", "==", "starting-par"),
    where("venue", "==", "Ohana"),
    where("date", "==", today)
  );
  const ordersSnap = await getDocs(ordersQuery);

  const sentPars = {};
  const receivedPars = {};

  ordersSnap.forEach(doc => {
    const order = doc.data();
    if (!sentPars[order.recipeId]) sentPars[order.recipeId] = 0;
    sentPars[order.recipeId] += order.qty;

    if (order.received) {
      receivedPars[order.recipeId] = true;
    }
  });

  // ✅ Cache
  if (!window.startingCache) window.startingCache = {};
  window.startingCache["Ohana"] = { recipes, guestCount, sentPars, receivedPars };

  renderStartingStatus("Ohana", window.startingCache["Ohana"]);
};
//**CHAT */
function getHawaiiTimestampRange() {
  const now = new Date();
  const hawaiiOffsetMs = -10 * 60 * 60 * 1000;
  const hawaiiNow = new Date(now.getTime() + hawaiiOffsetMs);

  const start = new Date(hawaiiNow.getUTCFullYear(), hawaiiNow.getUTCMonth(), hawaiiNow.getUTCDate());
  const end = new Date(hawaiiNow.getUTCFullYear(), hawaiiNow.getUTCMonth(), hawaiiNow.getUTCDate() + 1);

  return {
    start: Timestamp.fromDate(start),
    end: Timestamp.fromDate(end)
  };
}

const chatBox = document.getElementById("chatBox");
const chatToggleBtn = document.getElementById("chatToggleBtn");
let isChatMinimized = false;
let chatUnsubscribe = null;

function startChatListener() {
  if (chatUnsubscribe) return; // Avoid duplicate listeners

  const chatMessages = document.getElementById("chatMessages");
  const { start, end } = getHawaiiTimestampRange();
  const chatRef = collection(db, "chats");

  const todayChatsQuery = query(
    chatRef,
    where("timestamp", ">=", start),
    where("timestamp", "<", end),
    orderBy("timestamp", "asc"),
    limit(50) // ✅ Limit to most recent 50 messages
  );

  chatUnsubscribe = onSnapshot(todayChatsQuery, snapshot => {
    chatMessages.innerHTML = "";

    snapshot.forEach(doc => {
      const data = doc.data();
      const time = new Date(data.timestamp?.toDate()).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
      const msg = `<div><strong>${data.sender}</strong> (${time}): ${data.message}</div>`;
      chatMessages.innerHTML += msg;
    });

    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

function stopChatListener() {
  if (chatUnsubscribe) {
    chatUnsubscribe();
    chatUnsubscribe = null;
  }
}

// 🔁 Toggle chat visibility and listener
chatToggleBtn.addEventListener("click", () => {
  isChatMinimized = !isChatMinimized;
  chatBox.classList.toggle("minimized", isChatMinimized);
  chatBox.classList.remove("highlight");

  if (isChatMinimized) {
    stopChatListener(); // 🛑 Save reads
  } else {
    startChatListener(); // ▶️ Live feed
  }
});

// ✅ Start listening if chat is visible at page load
if (!isChatMinimized) {
  startChatListener();
}

// ✉️ Show temporary new message if chat is minimized
function handleNewChatMessage(messageText, sender = "Other") {
  const chatMessages = document.getElementById("chatMessages");
  const message = document.createElement("div");
  message.textContent = `${sender}: ${messageText}`;
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  if (isChatMinimized) {
    chatBox.classList.add("highlight");
  }
}

// ✅ Global send function
window.sendChatMessage = async function () {
  const input = document.getElementById("chatInput");
  const message = input.value.trim();
  if (!message) return;

  const senderVenue = window.currentVenue || "Main Kitchen";

  await addDoc(collection(db, "chats"), {
    sender: senderVenue,
    message,
    timestamp: serverTimestamp()
  });

  input.value = "";
};




//**accounting */
window.loadProductionSummary = async function () {
  const tbody = document.querySelector("#productionTable tbody");

  // 🌀 Show loading immediately
  tbody.innerHTML = `
    <tr>
      <td colspan="5" style="text-align:center; padding: 10px;">
        <div class="spinner"></div>
        <div style="font-style: italic; color: gray; margin-top: 5px;">Loading...</div>
      </td>
    </tr>
  `;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const snapshot = await getDocs(query(
    collection(db, "orders"),
    where("date", "==", todayStr)
  ));

  const summaryMap = new Map();
  const recipeKeyList = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const type = data.type || "";

    let recipeNo = (data.recipeNo || data.recipeId || "").toUpperCase();
    if (!recipeNo) continue;

    const submenuCode = data.submenuCode || "";

    let qty = 0;
    if (type === "starting-par") {
      qty = Number(data.netWeight ?? 0);
    } else {
      qty = Number(data.sendQty ?? data.qty ?? 0);
    }

    if (qty <= 0) {
      console.warn(`🚫 Skipping ${recipeNo} due to zero quantity`, data);
      continue;
    }

    if (!summaryMap.has(recipeNo)) {
      summaryMap.set(recipeNo, {
        submenuCode,
        dishCode: "",
        recipeNo,
        description: "No Description",
        total: 0,
      });
      recipeKeyList.push(recipeNo);
    }

    summaryMap.get(recipeNo).total += qty;
  }

  // ✅ Load recipe descriptions
  const recipeDescMap = new Map();
  for (let i = 0; i < recipeKeyList.length; i += 10) {
    const batch = recipeKeyList.slice(i, i + 10);
    const snap = await getDocs(
      query(collection(db, "recipes"), where("recipeNo", "in", batch))
    );
    snap.forEach(doc => {
      const data = doc.data();
      const key = (data.recipeNo || doc.id).toUpperCase();
      recipeDescMap.set(key, data.description || "No Description");
    });
  }

  // ✅ Apply descriptions
  for (const [recipeNo, item] of summaryMap.entries()) {
    item.description = recipeDescMap.get(recipeNo) || "No Description";
  }

  // 🏷️ Assign dish codes
  recipeKeyList.forEach((recipeNo, index) => {
    const dishCode = `PCC${String(index + 1).padStart(3, "0")}`;
    if (summaryMap.has(recipeNo)) {
      summaryMap.get(recipeNo).dishCode = dishCode;
    }
  });

  // ✅ Render table
  tbody.innerHTML = "";

  if (summaryMap.size === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" style="text-align:center; font-style:italic; color:gray;">No data for today</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const recipeNo of recipeKeyList) {
    const item = summaryMap.get(recipeNo);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.submenuCode}</td>
      <td>${item.dishCode}</td>
      <td>${item.recipeNo}</td>
      <td>${item.description}</td>
      <td>${item.total}</td>
    `;
    tbody.appendChild(tr);
  }
};




let currentVenueCode = "b001"; // 🧭 Default venue

window.copyProductionSummaryToClipboard = function () {
  const table = document.getElementById("productionTable");
  if (!table) {
    alert("Production Summary Table not found.");
    return;
  }

  let tsv = "";
  const rows = table.querySelectorAll("tbody tr"); // ✅ Only target <tbody> rows (skip headers)

  rows.forEach(row => {
    const cells = row.querySelectorAll("td");
    const rowData = Array.from(cells).map(cell => cell.innerText.trim());
    tsv += rowData.join("\t") + "\n";
  });

  navigator.clipboard.writeText(tsv)
    .then(() => alert("Copied to clipboard! You can now paste it into Excel."))
    .catch(err => {
      console.error("Failed to copy:", err);
      alert("Copy failed. Try again.");
    });
};

// 🔁 Venue map
const venueNames = {
  b001: "ALOHA",
  b002: "OHANA",
  b003: "GATEWAY",
  c002: "SAMOA CONCESSIONS",
  c003: "MAORI CONCESSIONS",
};

// Reverse map: name → code
const venueCodesByName = {};
Object.entries(venueNames).forEach(([code, name]) => {
  venueCodesByName[name.toLowerCase()] = code;
});

let allShipmentData = []; // ⏺ Global store

// 📥 Fetch + normalize Firestore orders
window.loadProductionShipments = async function () {
  const container = document.getElementById("singleVenueShipmentContainer");

  // 🌀 Show loading spinner immediately
  container.innerHTML = `
    <div style="text-align:center; padding: 20px;">
      <div class="spinner"></div>
      <div style="margin-top: 8px; font-style: italic; color: gray;">Loading shipments...</div>
    </div>
  `;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  // ✅ Fetch only today's orders
  const snapshot = await getDocs(
    query(collection(db, "orders"), where("date", "==", todayStr))
  );

  const recipeMap = new Map(); // recipe key → summary object
  const recipeNos = new Set();

  snapshot.forEach(doc => {
    const data = doc.data();

    const type = data.type || "";
    const rawRecipeNo = data.recipeNo || data.recipeId || "";
    const recipeNo = rawRecipeNo.toUpperCase();
    if (!recipeNo) return;

    const venue = (data.venue || "").toLowerCase();
    const venueCode = venueCodesByName[venue];
    if (!venueCode) return;

    let quantity = 0;
    if (type === "starting-par") {
      quantity = Number(data.netWeight ?? 0);
    } else {
      quantity = Number(data.sendQty ?? data.qty ?? 0);
    }

    if (quantity <= 0) return;

    const key = `${venueCode}__${recipeNo}`;
    recipeNos.add(recipeNo);

    if (!recipeMap.has(key)) {
      recipeMap.set(key, {
        venueCode,
        recipeNo,
        quantity: 0,
        description: "No Description",
        type,
      });
    }

    recipeMap.get(key).quantity += quantity;
  });

  // ✅ Batch fetch recipe descriptions
  const recipeDescMap = new Map();
  const recipeList = Array.from(recipeNos);
  for (let i = 0; i < recipeList.length; i += 10) {
    const batch = recipeList.slice(i, i + 10);
    const snap = await getDocs(
      query(collection(db, "recipes"), where("recipeNo", "in", batch))
    );
    snap.forEach(doc => {
      const data = doc.data();
      recipeDescMap.set(data.recipeNo.toUpperCase(), data.description || "No Description");
    });
  }

  // ✅ Assign descriptions
  for (const shipment of recipeMap.values()) {
    shipment.description = recipeDescMap.get(shipment.recipeNo) || "No Description";
  }

  allShipmentData = Array.from(recipeMap.values());

  // ✅ This clears the spinner and renders Aloha by default
  loadVenueShipment("b001");
};


// 📤 Show one venue shipment
window.loadVenueShipment = function (venueCode) {
  currentVenueCode = venueCode;

  const container = document.getElementById("singleVenueShipmentContainer");
  container.innerHTML = "";

  const venueLabel = venueNames[venueCode] || venueCode;
  const shipments = allShipmentData.filter(
    s => (s.venueCode || "").toLowerCase() === venueCode
  );

  const rows = {};
  shipments.forEach(item => {
    const recipeNo = item.recipeNo || "UNKNOWN";
    const description = item.description || "No Description";
    const type = item.type || "";

    // ✅ Ensure correct quantity based on type
    const qty = Number(item.quantity || 0);
    const key = `${recipeNo}__${description}`;
    if (!rows[key]) rows[key] = { recipeNo, description, quantity: 0 };
    rows[key].quantity += qty;
  });

  const section = document.createElement("div");
  section.classList.add("shipment-table");

  const heading = document.createElement("h4");
  heading.textContent = `${venueLabel} PRODUCTION SHIPMENT`;
  section.appendChild(heading);

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copy to Excel";
  copyBtn.onclick = window.copyCurrentVenueShipmentToClipboard;
  section.appendChild(copyBtn);

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Recipe No.</th>
        <th>Description</th>
        <th>Quantity</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const body = table.querySelector("tbody");
  const keys = Object.keys(rows);

  if (keys.length === 0) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = `
      <td colspan="3" style="text-align:center; font-style:italic; color:gray;">No items</td>
    `;
    body.appendChild(emptyRow);
  } else {
    keys.forEach(key => {
      const { recipeNo, description, quantity } = rows[key];
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${recipeNo}</td>
        <td>${description}</td>
        <td>${quantity}</td>
      `;
      body.appendChild(tr);
    });
  }

  section.appendChild(table);
  container.appendChild(section);
};

// 📋 Copy current venue shipment table
window.copyCurrentVenueShipmentToClipboard = function () {
  const table = document.querySelector("#singleVenueShipmentContainer table");
  if (!table) {
    alert("No table to copy.");
    return;
  }

  let tsv = "";
  const rows = table.querySelectorAll("tbody tr"); // ✅ Only body rows (skip headers)

  rows.forEach(row => {
    const cells = row.querySelectorAll("td");
    const rowData = Array.from(cells).map(cell => cell.innerText.trim());
    if (rowData.length > 0) {
      tsv += rowData.join("\t") + "\n";
    }
  });

  if (!tsv.trim()) {
    alert("Nothing to copy — table is empty.");
    return;
  }

  navigator.clipboard.writeText(tsv)
    .then(() => alert(`Copied ${venueNames[currentVenueCode] || "Current Venue"} data to clipboard!`))
    .catch(err => {
      console.error("Failed to copy:", err);
      alert("Copy failed. Try again.");
    });
};

const venueCodes = {
  "Main Kitchen": "w002",
  "Aloha": "b001",
  "Ohana": "b002",
  "Gateway": "b003",
  "Samoa Concessions": "c002",
  "Maori Concessions": "c003",
};

window.loadAccountingWaste = async function () {
  const tableBody = document.querySelector("#wasteTable tbody");
  tableBody.innerHTML = "";

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const localToday = `${yyyy}-${mm}-${dd}`;

  const wasteSnapshot = await getDocs(query(collection(db, "waste"), orderBy("timestamp", "desc")));

  for (const doc of wasteSnapshot.docs) {
    const data = doc.data();
    const rawDate = data.date || "";
    if (rawDate !== localToday) continue;

    const formattedDate = formatDateLocal(rawDate);
    const venue = data.venue || "";
    const locationCode = venueCodes[venue] || venue;
    const description = data.item || "";
    const quantity = data.qty || 0;

    let recipeNo = "";
    try {
      const recipeQuery = query(
        collection(db, "recipes"),
        where("description", "==", description)
      );
      const recipeSnapshot = await getDocs(recipeQuery);
      if (!recipeSnapshot.empty) {
        recipeNo = recipeSnapshot.docs[0].data().recipeNo || "";
      }
    } catch (err) {
      console.error("Error finding recipe for:", description, err);
    }

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formattedDate}</td>
      <td>${locationCode}</td>
      <td>${recipeNo}</td>
      <td>${description}</td>
      <td>${quantity}</td>
    `;
    tableBody.appendChild(row);
  }
};



window.copyWasteTableToClipboard = function () {
  const table = document.getElementById("wasteTable");
  if (!table) {
    alert("Waste table not found.");
    return;
  }

  let tsv = "";
  const rows = table.querySelectorAll("tbody tr");

  rows.forEach(row => {
    const cells = row.querySelectorAll("td");
    const rowData = Array.from(cells).map(cell => cell.innerText.trim());
    tsv += rowData.join("\t") + "\n";
  });

  navigator.clipboard.writeText(tsv)
    .then(() => alert("Waste table copied! Paste it into Excel."))
    .catch(err => {
      console.error("Copy failed:", err);
      alert("Copy failed. Try again.");
    });
};


async function loadLunchAccountingTable() {
  const tbody = document.querySelector("#lunchTable tbody");
  tbody.innerHTML = "";

  const snapshot = await getDocs(collection(db, "lunch"));
  const entries = snapshot.docs.map(doc => doc.data());

  entries.forEach(entry => {
    let formattedDate = "";
    if (typeof entry.date === "string") {
      formattedDate = formatDateLocal(entry.date); // ✅ use custom function
    } else if (entry.date instanceof Timestamp || (entry.date?.seconds && entry.date?.nanoseconds)) {
      const jsDate = entry.date.toDate ? entry.date.toDate() : new Date(entry.date.seconds * 1000);
      formattedDate = `${jsDate.getMonth() + 1}/${jsDate.getDate()}/${jsDate.getFullYear()}`;
    }

    let venueCode = entry.venue === "Main Kitchen" ? "w002" : entry.venue;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formattedDate}</td>
      <td>${entry.item || ""}</td>
      <td>${entry.qty || 0}</td>
      <td>${entry.uom || "ea"}</td>
    `;
    tbody.appendChild(row);
  });
}
function formatDateLocal(dateStr) {
  // Split the YYYY-MM-DD string manually
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // JS months are 0-based
  const day = parseInt(parts[2], 10);

  const localDate = new Date(year, month, day); // 👈 Local time
  return `${localDate.getMonth() + 1}/${localDate.getDate()}/${localDate.getFullYear()}`;
}


window.copyLunchTableToClipboard = function () {
  const table = document.getElementById("lunchTable");
  const rows = Array.from(table.querySelectorAll("tbody tr"));

  if (rows.length === 0) {
    alert("⚠️ No data to copy.");
    return;
  }

  // Build tab-delimited string
  const text = rows
    .map(row =>
      Array.from(row.cells)
        .map(cell => cell.textContent.trim())
        .join("\t")
    )
    .join("\n");

  // Copy to clipboard
  navigator.clipboard.writeText(text).then(() => {
    alert("✅ Lunch table (without headers) copied to clipboard.");
  }).catch(err => {
    console.error("Clipboard error:", err);
    alert("❌ Failed to copy.");
  });
};


//loading helper
function showLoading(targetSelector, message = "Loading...") {
  const target = document.querySelector(targetSelector);
  if (!target) return;

  target.innerHTML = `
    <tr><td colspan="10" style="text-align:center; font-style:italic; color:gray;">${message}</td></tr>
  `;
}


//**LUNCH */

window.loadMainKitchenLunch = async function () {
  const tableBody = document.querySelector(".main-lunch-table tbody");
  tableBody.innerHTML = "";

  // ✅ Use cache if available
  if (!window.cachedMainLunchItems) {
    // Load all recipes
    const recipesSnap = await getDocs(collection(db, "recipes"));
    const allRecipes = recipesSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        type: "recipe",
        name: data.description || "Unnamed",
        uom: data.uom || "ea",
        category: (data.category || "uncategorized").toLowerCase()
      };
    });

    // Load all ingredients
    const ingredientsSnap = await getDocs(collection(db, "ingredients"));
    const allIngredients = ingredientsSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        type: "ingredient",
        name: data.itemName || "Unnamed",
        uom: data.baseUOM || "ea",
        category: (data.category || "ingredients").toLowerCase()
      };
    });

    // Cache combined items
    window.cachedMainLunchItems = [...allRecipes, ...allIngredients];
    console.log("📦 Cached Main Kitchen lunch items:", window.cachedMainLunchItems.length);
  }

  window.mainLunchItemList = window.cachedMainLunchItems;
  renderMainLunchRows(window.mainLunchItemList);
};


window.renderMainLunchRows = function (items) {
  const tableBody = document.querySelector(".main-lunch-table tbody");
  tableBody.innerHTML = "";

  items.forEach(item => {
    const row = document.createElement("tr");
    row.dataset.itemId = item.id;
    row.dataset.itemType = item.type;
    row.dataset.category = item.category?.toLowerCase() || "";

    row.innerHTML = `
      <td>${item.name}</td>
      <td>${item.uom}</td>
      <td>
        <span class="lunch-total">0</span>
        <input class="lunch-input" type="number" min="0" value="0" style="width: 60px; margin-left: 6px;" />
        <button onclick="addToLunchQty(this)" style="margin-left: 6px;">Add</button>
      </td>
      <td><button onclick="sendSingleMainLunch(this)">Send</button></td>
    `;

    tableBody.appendChild(row);
  });
};

window.filterMainLunch = function () {
  const searchInput = document.getElementById("mainLunchSearch").value.trim().toLowerCase();
  const selectedCategory = document.getElementById("mainLunchCategory").value.toLowerCase();

  const filtered = window.mainLunchItemList.filter(item => {
    const itemName = item.name?.toLowerCase() || "";
    const itemCategory = item.category?.toLowerCase() || "";

    const matchesSearch = !searchInput || itemName.includes(searchInput);
    const matchesCategory = !selectedCategory || itemCategory === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  renderMainLunchRows(filtered);
};

window.addToLunchQty = function (button) {
  const row = button.closest("tr");
  const input = row.querySelector(".lunch-input");
  const span = row.querySelector(".lunch-total");
  const addedQty = Number(input.value);
  const currentQty = Number(span.textContent);

  if (!isNaN(addedQty) && addedQty > 0) {
    span.textContent = currentQty + addedQty;
    input.value = "0";
  }
};

window.sendSingleMainLunch = async function (button) {
  const row = button.closest("tr");
  const span = row.querySelector(".lunch-total");
  const input = row.querySelector(".lunch-input");
  const qty = Number(span.textContent);

  if (qty <= 0) {
    alert("Please add a quantity first.");
    return;
  }

  const itemId = row.dataset.itemId;
  const item = window.mainLunchItemList.find(i => i.id === itemId);
  const today = getTodayDate();

  const lunchData = {
    item: item.name,
    venue: "Main Kitchen",
    qty,
    uom: item.uom || "ea",
    date: today,
    timestamp: serverTimestamp()
  };

  await addDoc(collection(db, "lunch"), lunchData);
  console.log(`✅ Sent lunch to 'lunch': ${qty} of ${item.name}`);

  span.textContent = "0";
  input.value = "0";

  const confirm = document.createElement("span");
  confirm.textContent = "Sent";
  confirm.style.color = "green";
  confirm.style.marginLeft = "8px";
  button.parentNode.appendChild(confirm);
  setTimeout(() => confirm.remove(), 2000);
};

window.sendAllMainLunch = async function () {
  const rows = document.querySelectorAll(".main-lunch-table tbody tr");
  const today = getTodayDate();
  let sentCount = 0;

  for (const row of rows) {
    const span = row.querySelector(".lunch-total");
    const qty = Number(span.textContent);

    if (qty > 0) {
      const itemId = row.dataset.itemId;
      const item = window.mainLunchItemList.find(i => i.id === itemId);

      const lunchData = {
        item: item.name,
        venue: "Main Kitchen",
        qty,
        uom: item.uom || "ea",
        date: today,
        timestamp: serverTimestamp()
      };

      await addDoc(collection(db, "lunch"), lunchData);
      console.log(`📦 Sent ${qty} of ${item.name}`);
      sentCount++;
    }
  }

  if (sentCount > 0) {
    alert(`✅ ${sentCount} lunch entries recorded for Main Kitchen.`);
  } else {
    alert("⚠️ No lunch entries with quantity > 0 found.");
  }
};
