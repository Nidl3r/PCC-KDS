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
  "guest-count": "Guest Count",
  aloha: "Aloha",
  ohana: "Ohana",
  gateway: "Gateway",
  concession: "Concessions",
  "main-kitchen": "Main Kitchen",
  stations: "Stations",
  accounting: "Accounting"
};

// 🔄 Table loading helpers
function showTableLoading(tbody, message = "Loading…") {
  if (!tbody) return;
  tbody.innerHTML = `
    <tr class="loading-row">
      <td colspan="4" style="padding:12px;text-align:center;opacity:.8;">
        <div class="mini-spinner" style="display:inline-block;vertical-align:middle;margin-right:8px;"></div>
        <span>${message}</span>
      </td>
    </tr>`;
}
function showTableEmpty(tbody, message = "No items to show.") {
  if (!tbody) return;
  tbody.innerHTML = `
    <tr>
      <td colspan="4" style="padding:12px;text-align:center;opacity:.7;">${message}</td>
    </tr>`;
}

// put this near your startup code, before loadAccountingWaste runs
window.venueCodes = {
  Aloha: "B001",
  Ohana: "B002",
  Gateway: "B003",
  Concessions: "C002",
  "Main Kitchen": "W002"
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


// 🔄 Table loading helpers
function showTableLoading(tbody, message = "Loading…") {
  if (!tbody) return;
  tbody.innerHTML = `
    <tr class="loading-row">
      <td colspan="4" style="padding:12px;text-align:center;opacity:.8;">
        <div class="mini-spinner" style="display:inline-block;vertical-align:middle;margin-right:8px;"></div>
        <span>${message}</span>
      </td>
    </tr>`;
}

function showTableEmpty(tbody, message = "No items to show.") {
  if (!tbody) return;
  tbody.innerHTML = `
    <tr>
      <td colspan="4" style="padding:12px;text-align:center;opacity:.7;">${message}</td>
    </tr>`;
}


// --- Math helpers for qty inputs ---
function evaluateMathExpression(raw) {
  if (typeof raw !== "string") raw = String(raw ?? "");
  const expr = raw
    .replace(/,/g, "")        // remove commas
    .replace(/×|x/gi, "*")    // support x / ×
    .replace(/÷/g, "/")       // support ÷
    .trim();

  // allow only digits, operators, parentheses, dot, spaces
  if (!/^[\d+\-*/().\s]+$/.test(expr)) return NaN;

  try {
    const val = Function(`"use strict"; return (${expr})`)();
    // only finite numbers
    return Number.isFinite(val) ? val : NaN;
  } catch {
    return NaN;
  }
}

/**
 * Evaluates the value already in an <input>, then writes the numeric result back.
 * Returns the numeric result (or NaN if invalid).
 */
function normalizeQtyInputValue(input) {
  if (!input) return NaN;
  const result = evaluateMathExpression(input.value);
  if (Number.isFinite(result)) {
    // respect step if present (e.g., "0.01" => 2 decimals)
    const step = input.getAttribute("step");
    if (step && step.includes(".")) {
      const decimals = step.split(".")[1].length;
      input.value = result.toFixed(decimals);
    } else {
      // no explicit step => keep a reasonable precision
      const rounded = Math.round(result * 100) / 100;
      input.value = String(rounded);
    }
    return parseFloat(input.value);
  }
  return NaN;
}

/**
 * Attach Enter/blur handlers that evaluate math expressions for matching inputs.
 * Call this after you render rows that include those inputs.
 */
function enableMathOnInputs(selector, scope = document) {
  const inputs = scope.querySelectorAll(selector);
  inputs.forEach((input) => {
    if (input.dataset.mathEnabled === "1") return;

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const v = normalizeQtyInputValue(input);
        // prevent form submits / accidental reloads
        e.preventDefault();
        // keep focus to mirror "enter" behavior users expect
        input.select?.();
      }
    });

    input.addEventListener("blur", () => {
      normalizeQtyInputValue(input);
    });

    input.dataset.mathEnabled = "1";
  });
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


//Kitchen add ons
// Kitchen add ons
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
  orders = orders.filter(order => !(order.venue === "Gateway" && order.station === "Grill"));

  orders.forEach(order => {
    const row = document.createElement("tr");

    const createdAt = order.timestamp?.toDate?.() || new Date();
    const cookTime = order.cookTime || 0;
    const dueTime = new Date(createdAt.getTime() + cookTime * 60000);
    const now = new Date();

    const timeFormatted = createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dueFormatted = dueTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (dueTime < now) row.style.backgroundColor = "rgba(255, 0, 0, 0.15)";

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
          type="text"
          inputmode="decimal"
          value="${cachedQty}"
          class="send-qty-input"
          data-order-id="${order.id}"
          style="width: 80px; text-align: right;"
          placeholder="0"
        />
      </td>
      <td>${order.uom || "ea"}</td>
      <td>
        <button onclick="sendKitchenOrder('${order.id}', this)" disabled>Send</button>
      </td>
    `;

    container.appendChild(row);
  });

  // 🔄 Add input listeners to enable/disable send buttons (live as you type)
  container.querySelectorAll(".send-qty-input").forEach(input => {
    const sendBtn = input.closest("tr")?.querySelector("button");
    const id = input.getAttribute("data-order-id");

    const setEnabledFromValue = () => {
      // Evaluate math safely (requires evaluateMathExpression helper)
      const v = evaluateMathExpression(input.value);
      const isValid = Number.isFinite(v) && v > 0;
      if (sendBtn) sendBtn.disabled = !isValid;
    };

    // Live enable/disable while typing
    input.addEventListener("input", () => {
      setEnabledFromValue();
    });

    // Normalize + cache on Enter
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const v = normalizeQtyInputValue(input); // writes normalized number back to input
        kitchenSendQtyCache[id] = Number.isFinite(v) ? v : "";
        setEnabledFromValue();
        input.select?.();
      }
    });

    // Normalize + cache on blur
    input.addEventListener("blur", () => {
      const v = normalizeQtyInputValue(input);
      kitchenSendQtyCache[id] = Number.isFinite(v) ? v : "";
      setEnabledFromValue();
    });

    // Set initial enabled state based on cached value
    setEnabledFromValue();
  });

  // 🔌 math features (1+1, 2*3, 10/4, etc.)
  enableMathOnInputs(".send-qty-input", container);
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

  // listen to all add-on orders that are actionable in the kitchen
  const addonQuery = query(
    ordersRef,
    where("type", "==", "addon"),
    where("status", "in", ["open", "Ready to Send"])
  );

  onSnapshot(addonQuery, (snapshot) => {
    // raw docs
    const all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // 🔒 keep to the four venues we care about
    const allowedVenues = new Set(["Aloha", "Gateway", "Ohana", "Concessions"]);

    // 🗓️ only show today's orders (works even if a doc has no 'date' field)
    const todayStr = getTodayDate();                // "YYYY-MM-DD" in Hawaii time
    const { start, end } = getHawaiiTimestampRange(); // Timestamp range (HST)

    const todays = all.filter(o => {
      if (!allowedVenues.has(o.venue)) return false;

      const matchByDateField = o.date === todayStr;

      let matchByTimestamp = false;
      try {
        const ts = o.timestamp?.toDate?.();
        if (ts) {
          const startJS = start.toDate();
          const endJS   = end.toDate();
          matchByTimestamp = ts >= startJS && ts < endJS;
        }
      } catch { /* ignore */ }

      return matchByDateField || matchByTimestamp;
    });

    console.log("📦 Kitchen add-ons (today):", todays.length);

    // ✅ Render today's kitchen add-ons
    renderKitchen(todays);

    // 🔔 Deletion + update notifications use the filtered list
    const currentIds = todays.map(o => o.id);
    const deletedOrders = previousAddonOrders.filter(o => !currentIds.includes(o.id));

    if (deletedOrders.length > 0) {
      console.log("🗑️ Deleted orders detected:", deletedOrders.map(o => o.item));
    }

    deletedOrders.forEach(deleted => {
      showMainKitchenNotif(`🗑️ Order deleted: ${deleted.item}`, 4000, "info");
    });

    snapshot.docChanges().forEach(change => {
      if (change.type === "modified") {
        const data = change.doc.data();
        console.log("✏️ Order updated:", data.item);
        showMainKitchenNotif(`✏️ Order updated: ${data.item}`, 4000, "info");
      }
    });

    // ✅ Update cache after everything
    previousAddonOrders = todays;
  });
}


window.sendKitchenOrder = async function(orderId, button) {
  let rowRemoved = false;

  try {
    // Prevent double clicks
    if (button) button.disabled = true;

    const orderRef = doc(db, "orders", orderId);
    const orderSnap = await getDoc(orderRef);

    if (!orderSnap.exists()) {
      alert("❌ Order not found.");
      return;
    }

    const order = orderSnap.data();
    const row = button?.closest("tr");
    const sendQtyInput = row?.querySelector(".send-qty-input");

    if (!sendQtyInput) {
      alert("⚠️ Please input a quantity before sending.");
      return;
    }

    // ✅ Normalize/evaluate math (e.g., "1+1") and write back to the input
    const normalized = (typeof normalizeQtyInputValue === "function")
      ? normalizeQtyInputValue(sendQtyInput)
      : parseFloat(sendQtyInput.value);

    let sendQty = Number.isFinite(normalized) ? normalized : NaN;

    if (!Number.isFinite(sendQty) || sendQty <= 0) {
      alert("⚠️ Please enter a valid quantity greater than 0.");
      return;
    }

    // 🔧 Adjust for pan weight if addon with lb UOM
    let adjustedQty = sendQty;

    if (order.type === "addon" && order.recipeNo) {
      const recipeQuery = query(
        collection(db, "recipes"),
        where("recipeNo", "==", order.recipeNo)
      );
      const recipeSnap = await getDocs(recipeQuery);

      if (!recipeSnap.empty) {
        const recipeData = recipeSnap.docs[0].data();
        const panWeight = Number(recipeData.panWeight || 0);
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

    // 🧹 Clear cache + remove row
    if (typeof kitchenSendQtyCache !== "undefined") {
      delete kitchenSendQtyCache[orderId];
    }
    if (row) {
      row.remove();
      rowRemoved = true;
    }

  } catch (error) {
    console.error("❌ Failed to send order:", error);
    alert("❌ Failed to send order.");
  } finally {
    // Re-enable button only if we didn't remove the row (i.e., on failure)
    if (button && !rowRemoved) button.disabled = false;
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

  const guestCount = Number(guestData?.Aloha || 0);
  document.getElementById("alohaGuestInfo").textContent = `👥 Guest Count: ${guestCount}`;

  // 🔍 Load recipes for Aloha (venueCode b001)
  const recipesRef = collection(db, "recipes");
  const q = query(recipesRef, where("venueCodes", "array-contains", "b001"));
  const snapshot = await getDocs(q);
  const recipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // 🔁 Today's starting-par orders for Aloha
  const ordersQuery = query(
    collection(db, "orders"),
    where("type", "==", "starting-par"),
    where("venue", "==", "Aloha"),
    where("date", "==", today)
  );
  const ordersSnap = await getDocs(ordersQuery);

  // 👉 Aggregate Firestore sendQty per recipeId
  const sentQtyByRecipe = {};
  const receivedPars = {};

  ordersSnap.forEach(docSnap => {
    const o = docSnap.data();
    const recipeId = o.recipeId;
    if (!recipeId) return;

    const sentQty = Number(o.sendQty ?? 0);
    sentQtyByRecipe[recipeId] = (sentQtyByRecipe[recipeId] || 0) + sentQty;

    if (o.received || o.status === "received") {
      receivedPars[recipeId] = true;
    }
  });

  // 🧮 parQty = target based on guest count; sentQty = sum(sendQty)
  const computedRecipes = recipes.map(r => {
    const targetPar = Number(r.pars?.Aloha?.[String(guestCount)] || 0);
    const sentQty   = Number(sentQtyByRecipe[r.id] || 0);
    return {
      ...r,
      targetPar,
      parQty: targetPar, // exact target, not remaining
      sentQty
    };
  });

  // 🗂️ Cache & render
  window.startingCache = window.startingCache || {};
  window.startingCache["Aloha"] = {
    recipes: computedRecipes,
    guestCount,
    sentPars: sentQtyByRecipe, // kept for compatibility
    receivedPars
  };

  renderStartingStatus("Aloha", window.startingCache["Aloha"]);
};


window.renderStartingStatus = async function (venue, data) {
  const tbody = document.getElementById(`${venue.toLowerCase()}ParTableBody`);
  if (!tbody) return;

  const categoryFilter = document.getElementById(`${venue.toLowerCase()}-starting-category`)?.value || "";
  const guestCount = Number(data?.guestCount || 0);
  tbody.innerHTML = "";
  let matchedCount = 0;

  const today = getTodayDate();
  const firestoreVenue = venue === "Concession" ? "Concessions" : venue;

  // Load today's starting-par orders for this venue/day
  const ordersSnapshot = await getDocs(query(
    collection(db, "orders"),
    where("type", "==", "starting-par"),
    where("venue", "==", firestoreVenue),
    where("date", "==", today)
  ));

  // Totals (all sent) + pending (not received), compatible with old fields
  const totalSentByRecipe = new Map();
  const pendingByRecipe   = new Map();

  ordersSnapshot.forEach(docSnap => {
    const o = docSnap.data();
    const recipeId = o.recipeId;
    if (!recipeId) return;

    // 👇 compatible with old docs that used sendQty/qty
    const sentVal = Number(o.pans ?? o.sendQty ?? o.qty ?? 0);
    if (sentVal > 0) {
      totalSentByRecipe.set(recipeId, (totalSentByRecipe.get(recipeId) || 0) + sentVal);
      if (!(o.received || o.status === "received")) {
        pendingByRecipe.set(recipeId, (pendingByRecipe.get(recipeId) || 0) + sentVal);
      }
    }
  });

  (data?.recipes || []).forEach(recipe => {
    const recipeId = recipe.id;

    if (categoryFilter && (recipe.category || "").toLowerCase() !== categoryFilter.toLowerCase()) return;

    // Target PAR (pans) for this venue
    let targetPans = 0;
    if (venue === "Concessions") {
      targetPans = Number(recipe.pars?.Concession?.default || 0);
    } else {
      targetPans = Number(recipe.pars?.[venue]?.[String(guestCount)] || 0);
    }
    if (targetPans <= 0) return;

    // Sent = ALL sent today (received + pending); Pending = not yet received
    const sentPans    = Number(totalSentByRecipe.get(recipeId) || data?.sentPars?.[recipeId] || 0);
    const pendingPans = Number(pendingByRecipe.get(recipeId) || 0);

    // Hide if fully satisfied and nothing pending
    if (sentPans >= targetPans && pendingPans <= 0) return;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${recipe.description || recipe.recipeNo || recipeId}</td>
      <td>${targetPans % 1 ? targetPans.toFixed(2) : targetPans}</td>
      <td>${sentPans % 1 ? sentPans.toFixed(2) : sentPans}</td>
      <td>
        ${pendingPans > 0 ? `<button class="receive-btn" data-recipe-id="${recipeId}">Receive</button>` : ``}
      </td>
    `;

    if (pendingPans > 0) {
      row.querySelector(".receive-btn")?.addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        await receiveStartingPar(venue, recipeId, btn);
      });
    }

    tbody.appendChild(row);
    matchedCount++;
  });

  console.log(`✅ Rendered ${matchedCount} ${venue} rows (Par=pans, Sent=sum of pans incl. legacy, Receive shown when pending>0)`);
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
// --- Concessions "wave" control (per day) ---
function getConcessionKeysForToday() {
  const k = getTodayDate();
  return {
    guestKey: `concession_guest_baseline_${k}`,
    sentKey:  `concession_sent_baseline_${k}`
  };
}

// Read the baseline guest count (and per-recipe sent snapshot) for today's wave
function readConcessionBaseline() {
  const { guestKey, sentKey } = getConcessionKeysForToday();
  const guestBase = Number(localStorage.getItem(guestKey) || "0");

  let sentBase = {};
  try {
    sentBase = JSON.parse(localStorage.getItem(sentKey) || "{}");
  } catch { sentBase = {}; }

  return { guestBase, sentBase };
}

// Reset the baseline to "now": guest baseline := current guests; sent snapshot := current sent per recipe
function writeConcessionBaseline(currentGuests, currentSentMap /* object: recipeId -> pans */) {
  const { guestKey, sentKey } = getConcessionKeysForToday();
  localStorage.setItem(guestKey, String(currentGuests));
  localStorage.setItem(sentKey, JSON.stringify(currentSentMap || {}));
}


//** Kitchen functions */



window.mainStartingQtyCache = {};      // already exists
window.mainStartingInputCache = {};    // NEW — stores current input

// --- helpers for buffet baselines (PAR at last send, per-venue) ---
function readBuffetBaseline(venue) {
  try { return JSON.parse(localStorage.getItem("buffetBaseline:"+venue) || "{}"); }
  catch { return {}; }
}
function writeBuffetBaseline(venue, obj) {
  try { localStorage.setItem("buffetBaseline:"+venue, JSON.stringify(obj || {})); } catch {}
}

window.loadMainKitchenStartingPars = async function () {
  console.log("🚀 Loading Main Kitchen Starting Pars...");
  const today = getTodayDate();

  // Guest counts
  const guestSnap = await getDoc(doc(db, "guestCounts", today));
  if (!guestSnap.exists()) { console.warn("⚠️ No guest counts found."); return; }
  const guestCounts = guestSnap.data();

  // Recipes (buffet + concessions)
  const recipesSnap = await getDocs(query(
    collection(db, "recipes"),
    where("venueCodes", "array-contains-any", ["b001", "b002", "b003", "c002", "c003", "c004"])
  ));
  const recipes = recipesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Today’s starting-par orders
  const ordersSnap = await getDocs(query(
    collection(db, "orders"),
    where("type", "==", "starting-par"),
    where("date", "==", today)
  ));

  // Aggregates
  const sentPars      = {};   // only *needed* for Concessions math (lbs)
  const receivedPars  = {};
  const sentParStatus = {};
  const wasSentToday  = {};   // ✅ buffet logic: boolean any doc exists today for (venue, recipeId)

  ordersSnap.forEach(s => {
    const o = s.data();
    const venue    = o.venue;
    const recipeId = o.recipeId;
    if (!venue || !recipeId) return;

    const status = String(o.status || "sent").toLowerCase();
    const isConcessions = /concessions?/i.test(venue);

    // Robust value; only used for Concessions remainder
    const sentValue = isConcessions
      ? Number(o.netWeight ?? o.sendQty ?? o.qty ?? 0)   // lbs
      : Number(o.pans ?? o.sendQty ?? o.qty ?? 0);       // pans (ignored for buffet logic below)

    if (!sentPars[venue])      sentPars[venue] = {};
    if (!receivedPars[venue])  receivedPars[venue] = {};
    if (!sentParStatus[venue]) sentParStatus[venue] = {};
    if (!wasSentToday[venue])  wasSentToday[venue] = {};

    // Mark "was sent" for buffet logic
    if (status === "sent" || status === "received") {
      wasSentToday[venue][recipeId] = true;
    }

    // Maintain other flags/tallies for completeness and Concessions
    if (sentValue > 0 && (status === "sent" || status === "received")) {
      sentPars[venue][recipeId] = (sentPars[venue][recipeId] || 0) + sentValue;
    }
    if (status === "received" || o.received) {
      receivedPars[venue][recipeId] = true;
    }
    sentParStatus[venue][recipeId] = status;
  });

  // Cache for renderer
  window.startingCache = window.startingCache || {};
  window.startingCache["MainKitchenAll"] = {
    recipes,
    guestCounts,
    sentPars,         // Concessions in lbs; buffet value unused by renderer
    receivedPars,
    sentParStatus,
    wasSentToday      // ✅ buffet baseline driver
  };

  renderMainKitchenPars();
};

window.renderMainKitchenPars = function () {
  const data = window.startingCache?.MainKitchenAll;
  if (!data) { console.warn("⚠️ No cached data found for Main Kitchen Starting Pars."); return; }

  const venueCodeMap = {
    b001: "Aloha",
    b002: "Ohana",
    b003: "Gateway",
    c002: "Concessions",
    c003: "Concessions",
    c004: "Concessions"
  };

  const venueFilter   = document.getElementById("starting-filter-venue").value;
  const stationFilter = document.getElementById("starting-filter-station").value;
  const table = document.querySelector("#startingParsTable");
  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";

  // Concessions wave/baseline (unchanged behavior)
  const currentConGuests = Number(data.guestCounts?.Concession || data.guestCounts?.Concessions || 0);
  const { guestBase, sentBase } = readConcessionBaseline();
  if (currentConGuests > guestBase) {
    writeConcessionBaseline(currentConGuests, (data.sentPars?.Concessions || {}));
  }
  const { sentBase: finalSentBase } = readConcessionBaseline();

  const fmt = n => (Number(n) % 1 ? Number(n).toFixed(2) : Number(n));
  let totalRows = 0;

  (data.recipes || []).forEach(recipe => {
    const station = recipe.category || "";
    if (stationFilter && station.toLowerCase() !== stationFilter.toLowerCase()) return;

    for (const code of (recipe.venueCodes || [])) {
      const venue = venueCodeMap[code] || "Unknown";
      if (venueFilter && venue !== venueFilter) continue;

      // 1) Today’s PAR (pans)
      let parPans = 0;
      if (venue === "Concessions") {
        parPans = Number(recipe.pars?.Concession?.default || 0);
      } else {
        const gc = Number(data.guestCounts?.[venue] || 0);
        parPans = Number(recipe.pars?.[venue]?.[String(gc)] || 0);
      }
      if (parPans <= 0) continue;

      // 2) Decide visibility (no "Sent" column shown)
      let showRow = false;
      if (venue === "Concessions") {
        // remaining = par - (sentNow - sentAtBaseline)
        const sentAtBaseline = Number(finalSentBase?.[recipe.id] || 0);
        const sentNow = Number(data.sentPars?.Concessions?.[recipe.id] || 0);
        const effectiveSentSinceIncrease = Math.max(0, sentNow - sentAtBaseline);
        const remaining = Math.max(0, parPans - effectiveSentSinceIncrease);
        showRow = (remaining > 0);
      } else {
        // Buffet baseline logic: ignore lbs, treat "sent once" as satisfied at baseline PAR
        const baseline = readBuffetBaseline(venue);
        const wasSent  = !!data.wasSentToday?.[venue]?.[recipe.id];

        // first send today → capture baseline as current PAR
        if (wasSent && baseline[recipe.id] == null) {
          baseline[recipe.id] = parPans;
          writeBuffetBaseline(venue, baseline);
        }

        // Not sent yet → show; if sent → only show when par grew past baseline
        if (!wasSent) {
          showRow = true;
        } else {
          const satisfiedAt = Number(baseline[recipe.id] || 0);
          showRow = parPans > satisfiedAt;
        }
      }
      if (!showRow) continue;

      // 3) Build row with columns: Area | Item | Par Qty | UOM | Send Qty | Action
      const row = document.createElement("tr");
      row.dataset.recipeId = recipe.id;
      row.dataset.venue    = venue;

      row.innerHTML = `
        <td>${venue}</td>
        <td>${recipe.description || recipe.recipeNo || recipe.id}</td>
        <td>${fmt(parPans)}</td>
        <td>${recipe.uom || "ea"}</td>
        <td>
          <input class="send-qty-input" type="text" inputmode="decimal"
                 value="" style="width:80px; margin-left:6px; text-align:right;" placeholder="0" />
        </td>
        <td>
          <button onclick="sendSingleStartingPar('${recipe.id}', '${venue}', this)">Send</button>
        </td>
      `;

      tbody.appendChild(row);
      totalRows++;
    }
  });

  enableMathOnInputs(".send-qty-input", table);
  console.log(`✅ Rendered ${totalRows} rows based on filters`);
};



document.getElementById("starting-filter-venue").addEventListener("change", () => {
  renderMainKitchenPars();
});
document.getElementById("starting-filter-station").addEventListener("change", () => {
  renderMainKitchenPars();
});


// 🌋 Send-all for Main Kitchen Starting Par
// 🌋 Send-all for Main Kitchen Starting Par
window.sendAllMainKitchenStartingPar = async function () {
  const tbody = document.querySelector("#startingParsTable tbody");
  if (!tbody) return;

  const rows = Array.from(tbody.querySelectorAll("tr"));
  if (rows.length === 0) {
    alert("⚠️ Nothing to send.");
    return;
  }

  let sent = 0;

  for (const row of rows) {
    const recipeId = row.dataset.recipeId;
    const venue    = row.dataset.venue;
    const input    = row.querySelector(".send-qty-input");

    const v = normalizeQtyInputValue?.(input);
    const qty = Number.isFinite(v) ? v : NaN;

    if (!recipeId || !venue || !Number.isFinite(qty) || qty <= 0) continue;

    await window.sendStartingPar(recipeId, venue, qty); // 👈

    const cacheKey = input?.getAttribute("data-cache-key");
    if (cacheKey && window.mainStartingQtyCache) delete window.mainStartingQtyCache[cacheKey];

    row.remove();
    sent++;
  }

 
};

window.sendSingleStartingPar = async function (recipeId, venue, button) {
  const row = button.closest("tr");
  const input = row.querySelector(".send-qty-input");
  const cacheKey = input?.getAttribute("data-cache-key");

  const v = normalizeQtyInputValue(input);
  const qtyFromInput = Number.isFinite(v) ? v : NaN;
  const qtyFromCache = cacheKey != null ? Number(window.mainStartingQtyCache?.[cacheKey]) : NaN;
  const sendQty = Number.isFinite(qtyFromInput) ? qtyFromInput : qtyFromCache;

  if (!Number.isFinite(sendQty) || sendQty <= 0) {
    alert("Please enter a valid quantity > 0.");
    return;
  }

  await window.sendStartingPar(recipeId, venue, sendQty); // 👈

  if (cacheKey && window.mainStartingQtyCache) delete window.mainStartingQtyCache[cacheKey];
  if (window.mainStartingInputCache) delete window.mainStartingInputCache[cacheKey];
  row.remove();
};



window.sendSingleStartingPar = async function (recipeId, venue, button) {
  const row = button.closest("tr");
  const input = row.querySelector(".send-qty-input");
  const cacheKey = input?.getAttribute("data-cache-key");

  // Force a last normalization so "1+1" becomes "2" even if user didn't blur
  let qtyFromInput = NaN;
  if (input) {
    const v = normalizeQtyInputValue(input); // evaluates math & rewrites input.value
    qtyFromInput = Number.isFinite(v) ? v : NaN;
  }

  const qtyFromCache = cacheKey != null ? Number(window.mainStartingQtyCache?.[cacheKey]) : NaN;
  const sendQty = Number.isFinite(qtyFromInput) ? qtyFromInput : qtyFromCache;

  if (!Number.isFinite(sendQty) || sendQty <= 0) {
    alert("Please enter a valid quantity > 0.");
    return;
  }

  await sendStartingPar(recipeId, venue, sendQty);

  // ✅ Clear from cache and UI
  if (cacheKey && window.mainStartingQtyCache) delete window.mainStartingQtyCache[cacheKey];
  if (window.mainStartingInputCache) delete window.mainStartingInputCache[cacheKey]; // legacy cleanup
  row.remove();
};


// ✅ Global so Send + Send All can call it
// Prevent rapid double-clicks while a send is in progress
window._startingParInFlight = window._startingParInFlight || new Set();

window.sendStartingPar = async function (recipeId, venue, sendQty) {
  const today = getTodayDate();
  const inFlightKey = `${today}|${venue}|${recipeId}`;
  if (window._startingParInFlight.has(inFlightKey)) return;
  window._startingParInFlight.add(inFlightKey);

  try {
    // guest count for today's PAR lookups
    const guestCountDoc = await getDoc(doc(db, "guestCounts", today));
    const guestCounts = guestCountDoc.exists() ? guestCountDoc.data() : {};
    const guestCount = Number(guestCounts?.[venue] || 0);

    // recipe
    const recipeSnap = await getDoc(doc(db, "recipes", recipeId));
    if (!recipeSnap.exists()) {
      console.warn(`❌ Recipe ${recipeId} not found`);
      return;
    }
    const recipeData  = recipeSnap.data();
    const recipeNo    = (recipeData.recipeNo || recipeId).toUpperCase();
    const costPerUnit = Number(recipeData.cost || 0);
    const panWeight   = Number(recipeData.panWeight || 0);

    const isConcessions = /concessions?/i.test(venue);

    // deterministic per-day doc
    const orderId  = `startingPar_${today}_${venue}_${recipeId}`;
    const orderRef = doc(db, "orders", orderId);
    const existing = await getDoc(orderRef);
    const nowTs = Timestamp.now();

    if (isConcessions) {
      // 📦 Concessions: input is lbs (gross), record cumulative netWeight
      const grossLbs = Number(sendQty);
      if (!Number.isFinite(grossLbs) || grossLbs <= 0) {
        alert("❌ Please enter a valid weight.");
        return;
      }
      const netWeightAdd = parseFloat(Math.max(0, grossLbs - panWeight).toFixed(2));
      const costAdd      = parseFloat((netWeightAdd * costPerUnit).toFixed(2));

      if (existing.exists()) {
        const prev = existing.data();
        await updateDoc(orderRef, {
          type: "starting-par",
          venue,
          recipeId,
          recipeNo,
          // cumulative tallies
          sendQty:  parseFloat(((Number(prev.sendQty || 0)) + grossLbs).toFixed(2)),
          netWeight: parseFloat(((Number(prev.netWeight || 0)) + netWeightAdd).toFixed(2)),
          totalCost: parseFloat(((Number(prev.totalCost || 0)) + costAdd).toFixed(2)),
          status: "sent",
          updatedAt: nowTs,
        });
      } else {
        await setDoc(orderRef, {
          type: "starting-par",
          venue,
          recipeId,
          recipeNo,
          sendQty: parseFloat(grossLbs.toFixed(2)),
          netWeight: netWeightAdd,
          totalCost: costAdd,
          date: today,
          status: "sent",
          sentAt: nowTs,
          timestamp: nowTs
        });
      }
    } else {
      // 🍽️ Buffet venues: input is # of pans to send now
      const pansTyped = Number(sendQty);
      if (!Number.isFinite(pansTyped) || pansTyped <= 0) {
        alert("❌ Please enter a valid number of pans.");
        return;
      }

      // PAR (in pans) for current guest count
      const currentPar =
        Number(recipeData?.pars?.[venue]?.[String(guestCount)] || 0);

      // cost for what you are sending now (not the entire PAR)
      const costAdd = parseFloat((pansTyped * costPerUnit).toFixed(2));

      if (existing.exists()) {
        const prev = existing.data();
        const prevPar = Number(prev.pans || 0); // previously satisfied PAR
        const newPar  = Math.max(prevPar, currentPar); // grow to latest PAR if increased

        await updateDoc(orderRef, {
          type: "starting-par",
          venue,
          recipeId,
          recipeNo,
          // "pans" tracks satisfied PAR; "qty" accumulates actual pans sent
          pans: newPar,
          qty: (Number(prev.qty || 0) + pansTyped),
          totalCost: parseFloat(((Number(prev.totalCost || 0)) + costAdd).toFixed(2)),
          date: today,
          status: "sent",
          updatedAt: nowTs,
        });
      } else {
        await setDoc(orderRef, {
          type: "starting-par",
          venue,
          recipeId,
          recipeNo,
          pans: currentPar,   // ✅ satisfied PAR at time of first send
          qty: pansTyped,     // actual pans sent now
          totalCost: costAdd,
          date: today,
          status: "sent",
          sentAt: nowTs,
          timestamp: nowTs
        });
      }

      // After a successful buffet send, advance the UI baseline so row hides again
      try {
        const base = readBuffetBaseline(venue);
        base[recipeId] = currentPar;
        writeBuffetBaseline(venue, base);
      } catch {}
    }

    console.log("✅ Starting-par recorded:", recipeNo, venue, sendQty);
  } catch (err) {
    console.error("❌ Failed to send starting-par:", err);
    throw err;
  } finally {
    window._startingParInFlight.delete(inFlightKey);
  }
};





//**WASTE aloha */
// 🧠 Store waste totals between filter switches
// Keep this cache
window.alohaWasteTotals = window.alohaWasteTotals || {};

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

    const cached = window.alohaWasteTotals?.[recipe.id];
    const val = (cached ?? "").toString();

    row.innerHTML = `
      <td>${recipe.description}</td>
      <td>${recipe.uom || "ea"}</td>
      <td>
        <input
          class="waste-input"
          type="text"
          inputmode="decimal"
          value="${val}"
          data-recipe-id="${recipe.id}"
          style="width: 80px; margin-left: 6px; text-align: right;"
          placeholder="0"
        />
      </td>
      <td><button onclick="sendSingleWaste(this, '${recipe.id}')">Send</button></td>
    `;

    // Save to cache on Enter/blur (handles "1+1", "2*3", etc.)
    const input = row.querySelector(".waste-input");
    const updateCacheFromInput = () => {
      const v = normalizeQtyInputValue(input); // math eval + normalization
      window.alohaWasteTotals[recipe.id] = Number.isFinite(v) ? v : "";
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        updateCacheFromInput();
        input.select?.();
      }
    });
    input.addEventListener("blur", updateCacheFromInput);

    tableBody.appendChild(row);
  });

  // 🔌 Enable math on these inputs
  enableMathOnInputs(".aloha-section[data-sec='waste'] .waste-input", document);
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

// ❌ Remove the old addToWasteQty (no longer needed)
// window.addToWasteQty = ...  ← delete this function

window.sendAllWaste = async function () {
  // Scope to Aloha section only
  const rows = document.querySelectorAll(".aloha-section[data-sec='waste'] .waste-table tbody tr");
  console.log("🧪 Found Aloha rows:", rows.length);
  const today = getTodayDate();
  let sentCount = 0;

  for (const row of rows) {
    const recipeId = row.dataset.recipeId;
    const input = row.querySelector(".waste-input");

    // Normalize latest input value (handles unblurred math)
    const v = normalizeQtyInputValue(input);
    const qty = Number.isFinite(v) ? v : Number(window.alohaWasteTotals?.[recipeId] || 0);

    if (!Number.isFinite(qty) || qty <= 0) continue;

    const recipe = window.alohaWasteRecipeList.find(r => r.id === recipeId);
    if (!recipe) {
      console.warn(`⚠️ Recipe not found for ID: ${recipeId}`);
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
    console.log(`✅ Sent Aloha waste: ${qty} of ${recipe.description}`);
    sentCount++;

    // Clear UI + cache
    input.value = "";
    window.alohaWasteTotals[recipeId] = "";
  }

  if (sentCount > 0) {
    alert(`✅ ${sentCount} waste entr${sentCount === 1 ? "y" : "ies"} sent.`);
  } else {
    alert("⚠️ No valid waste entries sent.");
  }
};

window.sendSingleWaste = async function (button, recipeId) {
  const row = button.closest("tr");
  const input = row.querySelector(".waste-input");

  // Normalize last-second (handles unblurred "1+1")
  const v = normalizeQtyInputValue(input);
  const qty = Number.isFinite(v) ? v : Number(window.alohaWasteTotals?.[recipeId] || 0);

  if (!Number.isFinite(qty) || qty <= 0) {
    alert("Please enter a valid quantity first.");
    return;
  }

  const recipe = window.alohaWasteRecipeList.find(r => r.id === recipeId);
  if (!recipe) {
    alert("❌ Recipe not found.");
    return;
  }

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

  // Clear UI + cache
  input.value = "";
  window.alohaWasteTotals[recipeId] = "";

  const confirm = document.createElement("span");
  confirm.textContent = "Sent";
  confirm.style.color = "green";
  confirm.style.marginLeft = "8px";
  button.parentNode.appendChild(confirm);
  setTimeout(() => confirm.remove(), 2000);
};


// ✅ Waste check that works with add-ons (item/recipeNo) and starting-par (id/no/desc)
async function checkIfEnoughReceived(recipeId, wasteQty, venue) {
  const today = getTodayDate();
  const epsilon = 1e-6;

  // --- Resolve recipeNo + description from the given recipeId (waste UI passes id) ---
  let recipeNo = "";
  let description = "";

  const listsToCheck = [
    venue === "Aloha"   ? window.alohaWasteRecipeList   : null,
    venue === "Gateway" ? window.gatewayWasteRecipeList : null,
    venue === "Ohana"   ? window.ohanaWasteRecipeList   : null,
    window.cachedAlohaWasteRecipes,
    window.cachedGatewayWasteRecipes,
    window.cachedOhanaWasteRecipes
  ].filter(Boolean);

  for (const list of listsToCheck) {
    const hit = list.find(r => r.id === recipeId);
    if (hit) {
      recipeNo    = (hit.recipeNo || hit.recipe_no || "").toString();
      description = (hit.description || "").toString();
      break;
    }
  }
  if (!description || !recipeNo) {
    const snap = await getDoc(doc(db, "recipes", recipeId));
    if (snap.exists()) {
      const d = snap.data();
      recipeNo    = (d.recipeNo || d.recipe_no || "").toString();
      description = (d.description || "").toString();
    }
  }

  const norm = v => (v == null ? "" : String(v).trim().toLowerCase());
  const recId   = norm(recipeId);
  const recNo   = norm(recipeNo);
  const recDesc = norm(description);

  // --- Get all today's orders for this venue (we'll filter by recipe in code) ---
  const ordersSnap = await getDocs(query(
    collection(db, "orders"),
    where("date", "==", today),
    where("venue", "==", venue)  // e.g., "Gateway"
  ));

  let totalReceived = 0;
  let matchedOrders = 0;

  ordersSnap.forEach(docSnap => {
    const d = docSnap.data();

    // Skip cancellations/voids
    const status = norm(d.status || "sent");
    if (status === "cancelled" || status === "void") return;

    // Only count relevant types (addon & starting-par). If you want to include others, add here.
    const typ = norm(d.type || "");
    if (typ && !(typ === "starting-par" || typ === "addon")) return;

    // Match by any identifier you store in orders
    const dId   = norm(d.recipeId);
    const dNo   = norm(d.recipeNo);
    const dDesc = norm(d.recipeDescription || d.item || d.description);

    const isSameRecipe =
      (dId && dId === recId) ||
      (dNo && dNo === recNo) ||
      (dDesc && dDesc === recDesc);

    if (!isSameRecipe) return;

    // Use the largest available quantity field to avoid undercounting
    const recNet  = parseFloat(d.netWeight ?? 0);
    const recSend = parseFloat(d.sendQty   ?? 0);
    const recQty  = parseFloat(d.qty       ?? 0);
    const used = Math.max(
      Number.isFinite(recNet)  ? recNet  : 0,
      Number.isFinite(recSend) ? recSend : 0,
      Number.isFinite(recQty)  ? recQty  : 0
    );

    console.log(`📦 Counted order: status=${status}, type=${typ || "(n/a)"} · recipeId=${d.recipeId} · recipeNo=${d.recipeNo} · item=${d.item} · netWeight=${recNet} · sendQty=${recSend} · qty=${recQty} → used=${used}`);

    if (used > 0) {
      totalReceived += used;
      matchedOrders++;
    }
  });

  if (matchedOrders === 0) {
    console.warn(`[checkIfEnoughReceived] No matching orders for ${venue} ${today} recipeId=${recipeId}. Keys used → id:${recId}, no:${recNo}, desc:${recDesc}`);
  }

  // --- Sum today's already-wasted (waste stores .item as the description) ---
  let alreadyWasted = 0;
  if (description) {
    const wasteSnap = await getDocs(query(
      collection(db, "waste"),
      where("venue", "==", venue),
      where("item", "==", description),
      where("date", "==", today)
    ));
    wasteSnap.forEach(docSnap => {
      const w = parseFloat(docSnap.data()?.qty ?? 0);
      if (Number.isFinite(w)) alreadyWasted += w;
    });
  }

  const available = totalReceived - alreadyWasted;

  console.log(`[checkIfEnoughReceived] ${venue} • ${description || recipeNo || recipeId} (${recipeId})
  totalReceived: ${totalReceived} | alreadyWasted: ${alreadyWasted} | requestedWaste: ${wasteQty} | available: ${available}`);

  return parseFloat(wasteQty) <= available + epsilon;
}


window.loadMainKitchenWaste = async function () {
  const tableBody = document.querySelector(".main-waste-table tbody");
  tableBody.innerHTML = "";

  // ✅ Use cache if available
  if (!window.cachedMainWasteItems) {
    // 1) Recipes
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

    // 2) Ingredients
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

    const savedQty = window.mainWasteTotals?.[item.id];
    const val = (savedQty ?? "").toString();

    row.innerHTML = `
      <td>${item.name}</td>
      <td>${item.uom}</td>
      <td>
        <input
          class="waste-input"
          type="text"
          inputmode="decimal"
          value="${val}"
          data-item-id="${item.id}"
          style="width: 80px; margin-left: 6px; text-align: right;"
          placeholder="0"
        />
      </td>
      <td><button onclick="sendSingleMainWaste(this)">Send</button></td>
    `;

    // Normalize on Enter/blur and save to cache
    const input = row.querySelector(".waste-input");
    const updateCacheFromInput = () => {
      const v = normalizeQtyInputValue(input); // math eval + normalization
      window.mainWasteTotals[item.id] = Number.isFinite(v) ? v : "";
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        updateCacheFromInput();
        input.select?.();
      }
    });
    input.addEventListener("blur", updateCacheFromInput);

    tableBody.appendChild(row);
  });

  // 🔌 Enable math (1+1, 2*3, 10/4, etc.)
  enableMathOnInputs(".main-waste-table .waste-input", document);
};

// ❌ Remove the old addToMainWasteQty — no longer needed
// window.addToMainWasteQty = ...  ← delete this function

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
  const input = row.querySelector(".waste-input");
  const itemId = row.dataset.itemId;

  // Ensure last-minute normalization (handles unblurred "1+1")
  const v = normalizeQtyInputValue(input);
  const qty = Number.isFinite(v) ? v : Number(window.mainWasteTotals?.[itemId] || 0);

  if (!Number.isFinite(qty) || qty <= 0) {
    alert("Please enter a valid quantity first.");
    return;
  }

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
  console.log(`✅ Sent waste: ${qty} of ${item.name}`);

  // Clear UI + cache
  input.value = "";
  window.mainWasteTotals[itemId] = "";
  const confirm = document.createElement("span");
  confirm.textContent = "Sent";
  confirm.style.color = "green";
  confirm.style.marginLeft = "8px";
  button.parentNode.appendChild(confirm);
  setTimeout(() => confirm.remove(), 2000);
};

window.sendAllMainWaste = async function () {
  const rows = document.querySelectorAll(".main-waste-table tbody tr");
  const today = getTodayDate();
  let sentCount = 0;

  for (const row of rows) {
    const input = row.querySelector(".waste-input");
    const itemId = row.dataset.itemId;
    const v = normalizeQtyInputValue(input);
    const qty = Number.isFinite(v) ? v : Number(window.mainWasteTotals?.[itemId] || 0);

    if (Number.isFinite(qty) && qty > 0) {
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
      sentCount++;

      // clear UI + cache
      input.value = "";
      window.mainWasteTotals[itemId] = "";
    }
  }

  if (sentCount > 0) {
    alert(`✅ ${sentCount} waste entr${sentCount === 1 ? "y" : "ies"} recorded for Main Kitchen.`);
  } else {
    alert("⚠️ No valid waste quantities found.");
  }
};










//**Aloha Returns */

// ALOHA RETURNS — with loading/empty states
window.loadAlohaReturns = async function () {
  const tableBody = document.querySelector(".aloha-returns-table tbody");
  if (!tableBody) return;

  showTableLoading(tableBody, "Loading Aloha returns…");

  try {
    const todayStr = getTodayDate(); // YYYY-MM-DD (HST)

    // 1) Today's RECEIVED orders for Aloha
    const ordersSnap = await getDocs(query(
      collection(db, "orders"),
      where("venue", "==", "Aloha"),
      where("status", "==", "received"),
      where("date", "==", todayStr)
    ));

    if (ordersSnap.empty) {
      showTableEmpty(tableBody, "No orders received today for Aloha.");
      return;
    }

    // Totals by recipe key
    const qtyByKey = new Map();
    ordersSnap.forEach(d => {
      const o = d.data();
      const key = String(o.recipeNo || o.recipeId || "").toUpperCase();
      if (!key) return;
      const q = Number(o.qty ?? o.sendQty ?? 0) || 0;
      if (!q) return;
      qtyByKey.set(key, (qtyByKey.get(key) || 0) + q);
    });

    if (qtyByKey.size === 0) {
      showTableEmpty(tableBody, "No valid items to return.");
      return;
    }

    // 2) Exclude items already returned today
    const returnsSnap = await getDocs(query(
      collection(db, "returns"),
      where("venue", "==", "Aloha"),
      where("status", "==", "returned"),
      where("date", "==", todayStr)
    ));
    const excluded = new Set();
    returnsSnap.forEach(d => {
      const r = d.data();
      const k = String(r.recipeNo || r.recipeId || "").toUpperCase();
      if (k) excluded.add(k);
    });

    // 3) Resolve recipe metadata (batched by recipeNo, then fall back to id)
    const keys = Array.from(qtyByKey.keys());
    const byNo = [];
    const byId = [];
    keys.forEach(k => (/^[A-Za-z0-9\-_.]+$/.test(k) ? byNo : byId).push(k));

    const metaByKey = new Map();
    const idFromNo = new Map();

    for (let i = 0; i < byNo.length; i += 10) {
      const batch = byNo.slice(i, i + 10);
      const snap = await getDocs(query(
        collection(db, "recipes"),
        where("recipeNo", "in", batch)
      ));
      snap.forEach(docSnap => {
        const data = docSnap.data();
        const key = String(data.recipeNo || "").toUpperCase();
        if (!key) return;
        idFromNo.set(key, docSnap.id);
        metaByKey.set(key, {
          id: docSnap.id,
          description: data.description || key,
          uom: data.uom || "ea",
          returnable: String(data.returns || "").toLowerCase() === "yes"
        });
      });
    }

    const missing = new Set(keys.filter(k => !metaByKey.has(k)));
    for (const k of missing) {
      const ds = await getDoc(doc(db, "recipes", k));
      if (ds.exists()) {
        const data = ds.data();
        metaByKey.set(k, {
          id: ds.id,
          description: data.description || k,
          uom: data.uom || "ea",
          returnable: String(data.returns || "").toLowerCase() === "yes"
        });
      } else {
        const via = idFromNo.get(k);
        if (via) {
          const ds2 = await getDoc(doc(db, "recipes", via));
          if (ds2.exists()) {
            const data = ds2.data();
            metaByKey.set(k, {
              id: ds2.id,
              description: data.description || k,
              uom: data.uom || "ea",
              returnable: String(data.returns || "").toLowerCase() === "yes"
            });
          }
        }
      }
    }

    // 4) Render rows
    const rows = [];
    qtyByKey.forEach((qty, key) => {
      const m = metaByKey.get(key);
      if (!m || !m.returnable || excluded.has(key)) return;
      rows.push({ id: m.id, name: m.description, uom: m.uom, qty });
    });

    if (rows.length === 0) {
      showTableEmpty(tableBody, "No returnable Aloha items remaining for today.");
      return;
    }

    tableBody.innerHTML = "";
    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.dataset.recipeId = r.id;
      tr.innerHTML = `
        <td>${r.name}</td>
        <td>${r.qty} ${r.uom}</td>
        <td><input class="return-input" type="number" min="0" value="0" style="width:60px;" /></td>
        <td><button onclick="sendSingleReturn(this, '${r.id}')">Return</button></td>
      `;
      tableBody.appendChild(tr);
    }
  } catch (err) {
    console.error("❌ Failed to load Aloha returns:", err);
    showTableEmpty(tableBody, "Failed to load. Please retry.");
  }
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
// 🔁 Main Kitchen Returns — only today's (HST) without composite index
window.loadMainKitchenReturns = async function () {
  console.log("🔄 Loading Main Kitchen Returns (today only, HST)...");
  const tableBody = document.querySelector(".main-returns-table tbody");
  if (!tableBody) return;
  tableBody.innerHTML = "";

  try {
    const { start, end } = getHawaiiTimestampRange(); // returns Firestore Timestamps for HST day

    // ✅ No 'status' filter here → no composite index needed
    const q = query(
      collection(db, "returns"),
      where("returnedAt", ">=", start),
      where("returnedAt", "<", end),
      orderBy("returnedAt", "desc")
    );

    const snapshot = await getDocs(q);

    // cache for recipe names
    const recipeNameCache = new Map();
    let rows = 0;

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();

      // filter 'returned' client-side
      if (data.status !== "returned") continue;

      const returnId = docSnap.id;
      const recipeId = data.recipeId;
      let recipeName = recipeNameCache.get(recipeId);
      if (!recipeName) {
        const recipeDoc = await getDoc(doc(db, "recipes", recipeId));
        recipeName = recipeDoc.exists() ? (recipeDoc.data().description || "Unknown Item") : "Unknown Item";
        recipeNameCache.set(recipeId, recipeName);
      }

      const returnedAt = data.returnedAt?.toDate?.() || new Date();

      const row = document.createElement("tr");
      row.setAttribute("data-return-id", returnId);
      row.setAttribute("data-venue", data.venue || "");
      row.setAttribute("data-returned-at", returnedAt.toISOString());

      row.innerHTML = `
        <td>${recipeName}</td>
        <td>${data.venue || ""}</td>
        <td>${data.qty}</td>
        <td><button onclick="receiveMainReturn('${returnId}', this)">Receive</button></td>
      `;
      tableBody.appendChild(row);
      rows++;
    }

    // toggle Receive All
    const btnAll = document.getElementById("receiveAllMainReturns");
    if (btnAll) btnAll.disabled = rows === 0;

    console.log(`✅ Rendered ${rows} return rows (today only).`);
  } catch (error) {
    console.error("❌ Failed to load returns:", error);
  }
};



// ✅ Receive one
window.receiveMainReturn = async function (returnId, button) {
  const row = button.closest("tr");
  try {
    const returnRef = doc(db, "returns", returnId);
    await updateDoc(returnRef, {
      status: "received",
      receivedAt: serverTimestamp()
    });
    button.parentElement.innerHTML = `<span style="color: green;">Received</span>`;
    setTimeout(() => row.remove(), 800);
    console.log(`📦 Marked main kitchen return ${returnId} as received.`);
    // toggle Receive All if table empties
    const btnAll = document.getElementById("receiveAllMainReturns");
    if (btnAll) btnAll.disabled = document.querySelectorAll(".main-returns-table tbody tr").length === 0;
  } catch (error) {
    console.error("❌ Error receiving return:", error);
    alert("Failed to receive item. Try again.");
  }
};

// ✅ Receive all visible (today's) rows
window.receiveAllMainReturns = async function () {
  const rows = Array.from(document.querySelectorAll(".main-returns-table tbody tr"));
  if (rows.length === 0) return;

  try {
    // Update all in parallel (safe enough here)
    await Promise.all(rows.map(async (row) => {
      const id = row.getAttribute("data-return-id");
      const ref = doc(db, "returns", id);
      await updateDoc(ref, { status: "received", receivedAt: serverTimestamp() });
    }));

    // Quick UI sweep
    rows.forEach(row => row.remove());
    const btnAll = document.getElementById("receiveAllMainReturns");
    if (btnAll) btnAll.disabled = true;

    console.log(`📦 Received all (${rows.length}) returns for today.`);
  } catch (err) {
    console.error("❌ Error receiving all returns:", err);
    alert("Failed to receive all. Some items may still be pending.");
  }
};


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

// Ensure memory exists
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

    const savedQty = window.gatewayWasteTotals?.[recipe.id];
    const val = (savedQty ?? "").toString();

    row.innerHTML = `
      <td>${recipe.description}</td>
      <td>${recipe.uom || "ea"}</td>
      <td>
        <input
          class="waste-input"
          type="text"
          inputmode="decimal"
          value="${val}"
          data-recipe-id="${recipe.id}"
          style="width: 80px; margin-left: 6px; text-align: right;"
          placeholder="0"
        />
      </td>
      <td><button onclick="sendSingleGatewayWaste(this, '${recipe.id}')">Send</button></td>
    `;

    // Normalize on Enter/blur and save to cache
    const input = row.querySelector(".waste-input");
    const updateCacheFromInput = () => {
      const v = normalizeQtyInputValue(input); // math eval + normalization
      window.gatewayWasteTotals[recipe.id] = Number.isFinite(v) ? v : "";
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        updateCacheFromInput();
        input.select?.();
      }
    });
    input.addEventListener("blur", updateCacheFromInput);

    tableBody.appendChild(row);
  });

  // 🔌 Enable math (1+1, 2*3, 10/4, etc.)
  enableMathOnInputs(".gateway-section[data-sec='waste'] .waste-input", document);
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

// ❌ Remove the old addToGatewayWasteQty — no longer needed
// window.addToGatewayWasteQty = ...  ← delete this function

// 🔘 Single waste sender for Gateway (math-enabled)
window.sendSingleGatewayWaste = async function (button, recipeId) {
  const row = button.closest("tr");
  const input = row.querySelector(".waste-input");

  // Normalize last-second (handles unblurred "1+1")
  const v = normalizeQtyInputValue(input);
  const qty = Number.isFinite(v) ? v : Number(window.gatewayWasteTotals?.[recipeId] || 0);

  if (!Number.isFinite(qty) || qty <= 0) {
    alert("⚠️ Please enter a valid quantity first.");
    return;
  }

  const recipe = window.gatewayWasteRecipeList.find(r => r.id === recipeId);
  if (!recipe) {
    alert("❌ Recipe not found.");
    return;
  }

  // ✅ Validate against received total
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

  try {
    await addDoc(collection(db, "waste"), wasteData);
    console.log(`✅ Sent Gateway waste: ${qty} of ${recipe.description}`);

    // Clear UI + cache
    input.value = "";
    window.gatewayWasteTotals[recipeId] = "";

    const confirm = document.createElement("span");
    confirm.textContent = "Sent";
    confirm.style.color = "green";
    confirm.style.marginLeft = "8px";
    button.parentNode.appendChild(confirm);
    setTimeout(() => confirm.remove(), 2000);
  } catch (err) {
    console.error("❌ Failed to record waste:", err);
    alert("❌ Failed to record waste. Please try again.");
  }
};

window.sendAllGatewayWaste = async function () {
  const rows = document.querySelectorAll("#gateway .waste-table tbody tr");
  console.log("🧪 Found Gateway rows:", rows.length);

  const today = getTodayDate();
  let sentCount = 0;

  for (const row of rows) {
    const recipeId = row.dataset.recipeId;
    const input = row.querySelector(".waste-input");

    const v = normalizeQtyInputValue(input);
    const qty = Number.isFinite(v) ? v : Number(window.gatewayWasteTotals?.[recipeId] || 0);

    if (!Number.isFinite(qty) || qty <= 0) continue;

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

    // Clear UI + cache for this row
    input.value = "";
    window.gatewayWasteTotals[recipeId] = "";
  }

  if (sentCount > 0) {
    alert(`✅ ${sentCount} Gateway waste entr${sentCount === 1 ? "y" : "ies"} sent.`);
  } else {
    alert("⚠️ No Gateway waste entries with valid quantities.");
  }
};


//GATEWAY RETURNS
// GATEWAY RETURNS — fast + with loading animation
window.loadGatewayReturns = async function () {
  const tableBody = document.querySelector(".gateway-returns-table tbody");
  if (!tableBody) return;
  showTableLoading(tableBody, "Loading Gateway returns…");

  try {
    const todayStr = getTodayDate(); // "YYYY-MM-DD" in HST

    // 1) Get today's received Gateway orders
    const ordersSnap = await getDocs(query(
      collection(db, "orders"),
      where("venue", "==", "Gateway"),
      where("status", "==", "received"),
      where("date", "==", todayStr)
    ));

    if (ordersSnap.empty) {
      showTableEmpty(tableBody, "No orders received today for Gateway.");
      return;
    }

    // Build qty totals by recipe key (recipeNo or recipeId)
    const recipeQtyMap = new Map(); // KEY -> total qty
    ordersSnap.forEach(d => {
      const o = d.data();
      const key = String(o.recipeNo || o.recipeId || "").toUpperCase();
      if (!key) return;
      const qty = Number(o.qty ?? o.sendQty ?? 0) || 0;
      if (!qty) return;
      recipeQtyMap.set(key, (recipeQtyMap.get(key) || 0) + qty);
    });

    if (recipeQtyMap.size === 0) {
      showTableEmpty(tableBody, "No valid items to return.");
      return;
    }

    // 2) Exclude items already returned today (status=returned, date=today)
    const returnsSnap = await getDocs(query(
      collection(db, "returns"),
      where("venue", "==", "Gateway"),
      where("status", "==", "returned"),
      where("date", "==", todayStr)
    ));
    const excluded = new Set();
    returnsSnap.forEach(d => {
      const r = d.data();
      const k = String(r.recipeNo || r.recipeId || "").toUpperCase();
      if (k) excluded.add(k);
    });

    // 3) Batch-fetch recipe docs by recipeNo (in chunks of 10), fall back to by-ID when needed
    const allKeys = Array.from(recipeQtyMap.keys());
    const byNoKeys = [];
    const fallbackIds = [];
    // Heuristic: assume alphanumeric codes are recipeNo; still fall back if not found.
    allKeys.forEach(k => /^[A-Za-z0-9\-_.]+$/.test(k) ? byNoKeys.push(k) : fallbackIds.push(k));

    const recipeDesc = new Map();   // KEY -> {id, description, uom, returnsFlag}
    const idFromNo   = new Map();   // RECIPE NO -> doc.id

    // batch by recipeNo via "in" (≤10 per query)
    for (let i = 0; i < byNoKeys.length; i += 10) {
      const batch = byNoKeys.slice(i, i + 10);
      const snap = await getDocs(query(
        collection(db, "recipes"),
        where("recipeNo", "in", batch)
      ));
      snap.forEach(docSnap => {
        const data = docSnap.data();
        const key = String(data.recipeNo || "").toUpperCase();
        if (!key) return;
        idFromNo.set(key, docSnap.id);
        recipeDesc.set(key, {
          id: docSnap.id,
          description: data.description || key,
          uom: data.uom || "ea",
          returnsFlag: String(data.returns || "").toLowerCase() === "yes"
        });
      });
    }

    // Try fallbacks (direct doc by id) and any recipeNos not found above
    const stillMissing = new Set(allKeys.filter(k => !recipeDesc.has(k)));
    for (const key of stillMissing) {
      // try doc(id==key)
      const docSnap = await getDoc(doc(db, "recipes", key));
      if (docSnap.exists()) {
        const data = docSnap.data();
        recipeDesc.set(key, {
          id: docSnap.id,
          description: data.description || key,
          uom: data.uom || "ea",
          returnsFlag: String(data.returns || "").toLowerCase() === "yes"
        });
        continue;
      }
      // try mapping from a found id via recipeNo record (when we have idFromNo)
      const idViaNo = idFromNo.get(key);
      if (idViaNo) {
        const ds = await getDoc(doc(db, "recipes", idViaNo));
        if (ds.exists()) {
          const data = ds.data();
          recipeDesc.set(key, {
            id: ds.id,
            description: data.description || key,
            uom: data.uom || "ea",
            returnsFlag: String(data.returns || "").toLowerCase() === "yes"
          });
        }
      }
    }

    // 4) Build final list
    const rows = [];
    recipeQtyMap.forEach((qty, key) => {
      if (excluded.has(key)) return; // already returned today
      const meta = recipeDesc.get(key);
      if (!meta) return;             // no recipe info
      if (!meta.returnsFlag) return; // not returnable
      rows.push({
        id: meta.id,
        name: meta.description,
        uom: meta.uom,
        qty
      });
    });

    if (rows.length === 0) {
      showTableEmpty(tableBody, "No returnable Gateway items remaining for today.");
      return;
    }

    // 5) Render
    tableBody.innerHTML = "";
    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.dataset.recipeId = r.id;
      tr.innerHTML = `
        <td>${r.name}</td>
        <td>${r.qty} ${r.uom}</td>
        <td><input class="return-input" type="number" min="0" value="0" style="width: 60px;" /></td>
        <td><button onclick="sendSingleGatewayReturn(this, '${r.id}')">Return</button></td>
      `;
      tableBody.appendChild(tr);
    }

    console.log(`✅ Loaded ${rows.length} returnable recipes`);
  } catch (err) {
    console.error("❌ Failed to load Gateway returns:", err);
    showTableEmpty(tableBody, "Failed to load. Please retry.");
  }
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
  const guestCount = Number(guestData?.Gateway || 0);
  document.getElementById("gatewayGuestInfo").textContent = `👥 Guest Count: ${guestCount}`;

  // 🔎 Load Gateway recipes (b003)
  const recipesRef = collection(db, "recipes");
  const q = query(recipesRef, where("venueCodes", "array-contains", "b003"));
  const snapshot = await getDocs(q);
  const recipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // 📦 Today's starting-par orders for Gateway
  const ordersQuery = query(
    collection(db, "orders"),
    where("type", "==", "starting-par"),
    where("venue", "==", "Gateway"),
    where("date", "==", today)
  );
  const ordersSnap = await getDocs(ordersQuery);

  // 👉 Aggregate by recipeId
  const sentQtyByRecipe = {};   // Sum of sendQty per recipeId
  const receivedPars    = {};   // Whether any order is received

  ordersSnap.forEach(snap => {
    const o = snap.data();
    const id = o.recipeId;
    if (!id) return;

    const sentQty = Number(o.sendQty ?? 0);
    sentQtyByRecipe[id] = (sentQtyByRecipe[id] || 0) + sentQty;

    if (o.received || o.status === "received") {
      receivedPars[id] = true;
    }
  });

  // 🧮 For each recipe: parQty = target based on guest count; sentQty = sum(sendQty)
  const computedRecipes = recipes.map(r => {
    const targetPar = Number(r.pars?.Gateway?.[String(guestCount)] || 0);
    const sentQty   = Number(sentQtyByRecipe[r.id] || 0);

    return {
      ...r,
      targetPar,        // keep for reference if your renderer uses it
      parQty: targetPar, // 👈 exactly equal to target based on guest count
      sentQty            // 👈 equals Firestore sendQty sum for today
    };
  });

  // 🗂️ Cache and render
  window.startingCache = window.startingCache || {};
  window.startingCache["Gateway"] = {
    recipes: computedRecipes,
    guestCount,
    sentPars: sentQtyByRecipe, // kept if something else still reads this
    receivedPars
  };

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


// ✅ Editable qty overrides (persisted in memory per tab + row key) for accounting
window.accountingQtyOverrides = {
  production: new Map(),
  productionShipments: new Map(),
  waste: new Map(),
  lunch: new Map()
};

function getAcctQty(tab, key, fallback) {
  const v = window.accountingQtyOverrides[tab]?.get(key);
  return (typeof v === "number" && !Number.isNaN(v)) ? v : fallback;
}

function setAcctQty(tab, key, value) {
  if (!window.accountingQtyOverrides[tab]) window.accountingQtyOverrides[tab] = new Map();
  const v = Number(value);
  if (!Number.isNaN(v)) window.accountingQtyOverrides[tab].set(key, v);
}




//**CONCESSIONS */
// ✅ Concession category and item dropdown
const concessionCategorySelect = document.getElementById("concessionCategory");
const concessionItemSelect = document.getElementById("concessionItem");

concessionCategorySelect?.addEventListener("change", () => {
  applyCategoryFilter("concession");
});

// ✅ Send concession add-on order
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

    if (qty > 1 && recipeData.category?.toUpperCase() === "HOTFOODS") {
      alert("⚠️ HOTFOODS items must be ordered one at a time.");
      return;
    }

    // ✅ align with other venues
    const unitCost = Number(recipeData.cost || 0);
    const totalCost = parseFloat((unitCost * qty).toFixed(2));

    const order = {
      item: recipeData.description || recipeNo,
      qty,
      status: "open",
      venue: "Concessions",
      station: recipeData.station || "Unknown",
      recipeNo,
      cookTime: recipeData.cookTime || 0,
      notes,
      uom: recipeData.uom || "ea",
      type: "addon",                // 👈 REQUIRED for kitchen listener
      date: getTodayDate(),         // 👈 so today filters work
      totalCost,                    // 👈 shows up in accounting
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
// Keep/ensure this exists
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

    const savedQty = window.ohanaWasteTotals?.[recipe.id];
    const val = (savedQty ?? "").toString();

    row.innerHTML = `
      <td>${recipe.description}</td>
      <td>${recipe.uom || "ea"}</td>
      <td>
        <input
          class="waste-input"
          type="text"
          inputmode="decimal"
          value="${val}"
          data-recipe-id="${recipe.id}"
          style="width: 80px; margin-left: 6px; text-align: right;"
          placeholder="0"
        />
      </td>
      <td><button onclick="sendSingleOhanaWaste(this, '${recipe.id}')">Send</button></td>
    `;

    // Normalize on Enter/blur and save to cache
    const input = row.querySelector(".waste-input");
    const updateCacheFromInput = () => {
      const v = normalizeQtyInputValue(input); // math eval + normalization
      window.ohanaWasteTotals[recipe.id] = Number.isFinite(v) ? v : "";
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        updateCacheFromInput();
        input.select?.();
      }
    });
    input.addEventListener("blur", updateCacheFromInput);

    tableBody.appendChild(row);
  });

  // 🔌 Enable math (1+1, 2*3, 10/4, etc.)
  enableMathOnInputs(".ohana-section[data-sec='waste'] .waste-input", document);
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

// ❌ Remove the old addToOhanaWasteQty — it’s not used anymore
// window.addToOhanaWasteQty = ...  ← delete this function

window.sendSingleOhanaWaste = async function (button, recipeId) {
  const row = button.closest("tr");
  const input = row.querySelector(".waste-input");

  // Normalize last-second (handles unblurred "1+1")
  const v = normalizeQtyInputValue(input);
  const qty = Number.isFinite(v) ? v : Number(window.ohanaWasteTotals?.[recipeId] || 0);

  if (!Number.isFinite(qty) || qty <= 0) {
    alert("Please enter a valid quantity first.");
    return;
  }

  const recipe = window.ohanaWasteRecipeList.find(r => r.id === recipeId);
  if (!recipe) {
    alert("❌ Recipe not found.");
    return;
  }

  const hasEnough = await checkIfEnoughReceived(recipeId, qty, "Ohana");
  if (!hasEnough) {
    alert(`🚫 Cannot waste ${qty} of "${recipe.description}" — more than received.`);
    return;
  }

  const today = getTodayDate();
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

  // Clear UI + cache
  input.value = "";
  window.ohanaWasteTotals[recipeId] = "";

  const confirm = document.createElement("span");
  confirm.textContent = "Sent";
  confirm.style.color = "green";
  confirm.style.marginLeft = "8px";
  button.parentNode.appendChild(confirm);
  setTimeout(() => confirm.remove(), 2000);
};

window.sendAllOhanaWaste = async function () {
  const rows = document.querySelectorAll("#ohana .waste-table tbody tr");
  console.log("🧪 Found Ohana rows:", rows.length);

  const today = getTodayDate();
  let sentCount = 0;

  for (const row of rows) {
    const recipeId = row.dataset.recipeId;
    const input = row.querySelector(".waste-input");

    const v = normalizeQtyInputValue(input);
    const qty = Number.isFinite(v) ? v : Number(window.ohanaWasteTotals?.[recipeId] || 0);

    if (!Number.isFinite(qty) || qty <= 0) continue;

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

    // Clear UI + cache for this row
    input.value = "";
    window.ohanaWasteTotals[recipeId] = "";
  }

  if (sentCount > 0) {
    alert(`✅ ${sentCount} Ohana waste entr${sentCount === 1 ? "y" : "ies"} sent.`);
  } else {
    alert("⚠️ No Ohana waste entries with valid quantities.");
  }
};


//OHANA RETURNS
// 🔁 Ohana Returns — only items RECEIVED TODAY (HST)
// OHANA RETURNS — with loading/empty states
window.loadOhanaReturns = async function () {
  const tableBody = document.querySelector(".ohana-returns-table tbody");
  if (!tableBody) return;

  showTableLoading(tableBody, "Loading Ohana returns…");

  try {
    const todayStr = getTodayDate();

    // 1) Today's RECEIVED orders for Ohana
    const ordersSnap = await getDocs(query(
      collection(db, "orders"),
      where("venue", "==", "Ohana"),
      where("status", "==", "received"),
      where("date", "==", todayStr)
    ));

    if (ordersSnap.empty) {
      showTableEmpty(tableBody, "No orders received today for Ohana.");
      return;
    }

    const qtyByKey = new Map();
    ordersSnap.forEach(d => {
      const o = d.data();
      const key = String(o.recipeNo || o.recipeId || "").toUpperCase();
      if (!key) return;
      const q = Number(o.qty ?? o.sendQty ?? 0) || 0;
      if (!q) return;
      qtyByKey.set(key, (qtyByKey.get(key) || 0) + q);
    });

    if (qtyByKey.size === 0) {
      showTableEmpty(tableBody, "No valid items to return.");
      return;
    }

    // 2) Exclude items already returned today
    const returnsSnap = await getDocs(query(
      collection(db, "returns"),
      where("venue", "==", "Ohana"),
      where("status", "==", "returned"),
      where("date", "==", todayStr)
    ));
    const excluded = new Set();
    returnsSnap.forEach(d => {
      const r = d.data();
      const k = String(r.recipeNo || r.recipeId || "").toUpperCase();
      if (k) excluded.add(k);
    });

    // 3) Resolve recipe metadata (same pattern as Gateway/Aloha)
    const keys = Array.from(qtyByKey.keys());
    const byNo = [];
    const byId = [];
    keys.forEach(k => (/^[A-Za-z0-9\-_.]+$/.test(k) ? byNo : byId).push(k));

    const metaByKey = new Map();
    const idFromNo = new Map();

    for (let i = 0; i < byNo.length; i += 10) {
      const batch = byNo.slice(i, i + 10);
      const snap = await getDocs(query(
        collection(db, "recipes"),
        where("recipeNo", "in", batch)
      ));
      snap.forEach(docSnap => {
        const data = docSnap.data();
        const key = String(data.recipeNo || "").toUpperCase();
        if (!key) return;
        idFromNo.set(key, docSnap.id);
        metaByKey.set(key, {
          id: docSnap.id,
          description: data.description || key,
          uom: data.uom || "ea",
          returnable: String(data.returns || "").toLowerCase() === "yes"
        });
      });
    }

    const missing = new Set(keys.filter(k => !metaByKey.has(k)));
    for (const k of missing) {
      const ds = await getDoc(doc(db, "recipes", k));
      if (ds.exists()) {
        const data = ds.data();
        metaByKey.set(k, {
          id: ds.id,
          description: data.description || k,
          uom: data.uom || "ea",
          returnable: String(data.returns || "").toLowerCase() === "yes"
        });
      } else {
        const via = idFromNo.get(k);
        if (via) {
          const ds2 = await getDoc(doc(db, "recipes", via));
          if (ds2.exists()) {
            const data = ds2.data();
            metaByKey.set(k, {
              id: ds2.id,
              description: data.description || k,
              uom: data.uom || "ea",
              returnable: String(data.returns || "").toLowerCase() === "yes"
            });
          }
        }
      }
    }

    // 4) Render rows
    const rows = [];
    qtyByKey.forEach((qty, key) => {
      const m = metaByKey.get(key);
      if (!m || !m.returnable || excluded.has(key)) return;
      rows.push({ id: m.id, name: m.description, uom: m.uom, qty });
    });

    if (rows.length === 0) {
      showTableEmpty(tableBody, "No returnable Ohana items remaining for today.");
      return;
    }

    tableBody.innerHTML = "";
    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.dataset.recipeId = r.id;
      tr.innerHTML = `
        <td>${r.name}</td>
        <td>${r.qty} ${r.uom}</td>
        <td><input class="return-input" type="number" min="0" value="0" style="width:60px;" /></td>
        <td><button onclick="sendSingleOhanaReturn(this, '${r.id}')">Return</button></td>
      `;
      tableBody.appendChild(tr);
    }
  } catch (err) {
    console.error("❌ Failed to load Ohana returns:", err);
    showTableEmpty(tableBody, "Failed to load. Please retry.");
  }
};

// Submit a single OHANA return (adds 'date' for same-day exclusion)
window.sendSingleOhanaReturn = async function (btn, recipeId) {
  const row = btn.closest("tr");
  const qtyInput = row.querySelector(".return-input");
  const qty = Number(qtyInput.value);

  if (!Number.isFinite(qty) || qty <= 0) {
    alert("Please enter a valid quantity to return.");
    return;
  }

  try {
    await addDoc(collection(db, "returns"), {
      recipeId,
      qty,
      venue: "Ohana",
      status: "returned",
      date: getTodayDate(),              // 👈 important for exclusion
      returnedAt: serverTimestamp()
    });

    btn.parentElement.innerHTML = `<span style="color: green;">Returned</span>`;
    setTimeout(() => row.remove(), 800);
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
  const guestCount = Number(guestData?.Ohana || 0);
  document.getElementById("ohanaGuestInfo").textContent = `👥 Guest Count: ${guestCount}`;

  // recipes for Ohana (b002)
  const recipesRef = collection(db, "recipes");
  const q = query(recipesRef, where("venueCodes", "array-contains", "b002"));
  const snapshot = await getDocs(q);
  const recipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // today's starting-par orders for Ohana
  const ordersQuery = query(
    collection(db, "orders"),
    where("type", "==", "starting-par"),
    where("venue", "==", "Ohana"),
    where("date", "==", today)
  );
  const ordersSnap = await getDocs(ordersQuery);

  // Sum ALL sent per recipeId (compat: pans OR sendQty OR qty); track any received
  const sentQtyByRecipe = {};
  const receivedPars = {};

  ordersSnap.forEach(docSnap => {
    const o = docSnap.data();
    const recipeId = o.recipeId;
    if (!recipeId) return;

    const sentVal = Number(o.pans ?? o.sendQty ?? o.qty ?? 0);
    if (sentVal > 0) {
      sentQtyByRecipe[recipeId] = (sentQtyByRecipe[recipeId] || 0) + sentVal;
    }

    if (o.received || o.status === "received") {
      receivedPars[recipeId] = true;
    }
  });

  // Build display model:
  //  - parQty = target pans for today's guest count
  //  - sentQty = total sent today (received + pending), using compat fields
  const computedRecipes = recipes.map(r => {
    const targetPar = Number(r.pars?.Ohana?.[String(guestCount)] || 0);
    const sentQty   = Number(sentQtyByRecipe[r.id] || 0);
    return { ...r, targetPar, parQty: targetPar, sentQty };
  });

  // cache & render
  window.startingCache = window.startingCache || {};
  window.startingCache["Ohana"] = {
    recipes: computedRecipes,
    guestCount,
    sentPars: sentQtyByRecipe, // used by renderer
    receivedPars
  };

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

  // 🌀 Loading UI
  tbody.innerHTML = `
    <tr>
      <td colspan="5" style="text-align:center; padding: 10px;">
        <div class="spinner"></div>
        <div style="font-style: italic; color: gray; margin-top: 5px;">Loading...</div>
      </td>
    </tr>
  `;

  // Today (YYYY-MM-DD)
  const today = new Date(); today.setHours(0,0,0,0);
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  // --- 1) Pull ALL orders for today (any venue). We'll merge starting-par + add-ons. ---
  const orderSnapshot = await getDocs(query(
    collection(db, "orders"),
    where("date", "==", todayStr)
  ));

  // temp accumulator keyed by either recipeNo (e.g., "R0054") or placeholder "id:<recipeId>"
  const tempMap = new Map(); // key -> { total, submenuCode }
  const recipeIdsToResolve = new Set(); // ids we must map to recipeNo
  const seenSubmenuCode = new Map(); // finalRecipeNo -> submenuCode (first seen)

  const addToTemp = (key, qty, submenuCode) => {
    if (!Number.isFinite(qty) || qty <= 0) return;
    const obj = tempMap.get(key) || { total: 0, submenuCode: "" };
    obj.total += qty;
    if (submenuCode && !obj.submenuCode) obj.submenuCode = submenuCode;
    tempMap.set(key, obj);
  };

  // Sum orders (and collect ids needing resolution)
  orderSnapshot.forEach(docSnap => {
    const d = docSnap.data();
    const type = (d.type || "").toLowerCase();

    // Quantity logic: starting-par prefers netWeight; add-ons prefer sendQty/qty
    const qtySP  = parseFloat(d.netWeight ?? d.sendQty ?? d.qty ?? 0);
    const qtyAO  = parseFloat(d.sendQty ?? d.qty ?? d.netWeight ?? 0);
    const qty    = type === "starting-par" ? qtySP : qtyAO;

    if (!Number.isFinite(qty) || qty <= 0) return;

    let key = (d.recipeNo || "").toString().toUpperCase().trim();
    const submenuCode = d.submenuCode || "";

    if (!key) {
      const rid = (d.recipeId || "").toString().trim();
      if (!rid) return; // no recipe identifier at all; skip
      key = `id:${rid}`;
      recipeIdsToResolve.add(rid);
    }

    addToTemp(key, qty, submenuCode);
  });

  // --- 2) Resolve any recipeId -> recipeNo and merge into final map keyed by recipeNo ---
  const summaryMap = new Map(); // recipeNo -> { submenuCode, dishCode, recipeNo, description, total }
  const recipeNosSet = new Set();

  // Helper to add to final map
  const addFinal = (recipeNo, qty, submenuCode) => {
    if (!recipeNo) return;
    const key = recipeNo.toUpperCase();
    const obj = summaryMap.get(key) || {
      submenuCode: "",
      dishCode: "",
      recipeNo: key,
      description: "No Description",
      total: 0
    };
    obj.total += qty;
    if (submenuCode && !obj.submenuCode) obj.submenuCode = submenuCode;
    summaryMap.set(key, obj);
    recipeNosSet.add(key);
  };

  // Resolve ids in parallel
  if (recipeIdsToResolve.size > 0) {
    const idArr = Array.from(recipeIdsToResolve);
    const idDocs = await Promise.all(idArr.map(id => getDoc(doc(db, "recipes", id))));
    const idToNo = new Map();
    idDocs.forEach((snap, idx) => {
      const id = idArr[idx];
      if (snap.exists()) {
        const data = snap.data();
        const rno = (data.recipeNo || "").toString().toUpperCase().trim();
        if (rno) idToNo.set(id, rno);
      }
    });

    // Merge temp "id:<id>" entries into their recipeNo bucket
    for (const [key, val] of tempMap.entries()) {
      if (!key.startsWith("id:")) continue;
      const id = key.slice(3);
      const rno = idToNo.get(id);
      if (rno) {
        addFinal(rno, val.total, val.submenuCode);
        tempMap.delete(key);
      }
    }
  }

  // Now handle entries that were already recipeNo-based
  for (const [key, val] of tempMap.entries()) {
    if (key.startsWith("id:")) continue; // unresolved id without recipeNo—skip silently
    addFinal(key, val.total, val.submenuCode);
  }

  // --- 3) Add Main Kitchen waste to totals (still keyed by recipeNo; look up by description when needed) ---
  const wasteSnapshot = await getDocs(query(
    collection(db, "waste"),
    where("venue", "==", "Main Kitchen"),
    where("date", "==", todayStr)
  ));

  for (const wdoc of wasteSnapshot.docs) {
    const w = wdoc.data();
    const itemName = (w.item || "").trim();
    const qty = Number(w.qty || 0);
    if (!itemName || qty <= 0) continue;

    // If any existing summary item already has this description, add directly
    let matchedRno = null;
    for (const [rno, obj] of summaryMap.entries()) {
      if ((obj.description || "").trim() === itemName) { matchedRno = rno; break; }
    }

    // Else, try to find recipeNo by description
    if (!matchedRno) {
      const recipesQuery = query(collection(db, "recipes"), where("description", "==", itemName));
      const recipesSnap = await getDocs(recipesQuery);
      if (!recipesSnap.empty) {
        const r = recipesSnap.docs[0].data();
        matchedRno = (r.recipeNo || recipesSnap.docs[0].id).toString().toUpperCase();
        if (!summaryMap.has(matchedRno)) {
          summaryMap.set(matchedRno, {
            submenuCode: "",
            dishCode: "",
            recipeNo: matchedRno,
            description: itemName,
            total: 0
          });
          recipeNosSet.add(matchedRno);
        }
      }
    }

    if (matchedRno) {
      const obj = summaryMap.get(matchedRno);
      obj.total += qty;
      summaryMap.set(matchedRno, obj);
    }
  }

  // --- 4) Fetch descriptions for all recipeNos in batches of 10 ---
  const recipeKeyList = Array.from(recipeNosSet);
  const recipeDescMap = new Map();
  for (let i = 0; i < recipeKeyList.length; i += 10) {
    const batch = recipeKeyList.slice(i, i + 10);
    const snap = await getDocs(query(collection(db, "recipes"), where("recipeNo", "in", batch)));
    snap.forEach(docSnap => {
      const data = docSnap.data();
      const key = (data.recipeNo || docSnap.id).toString().toUpperCase();
      recipeDescMap.set(key, data.description || "No Description");
    });
  }

  // Apply descriptions
  for (const [rno, obj] of summaryMap.entries()) {
    obj.description = recipeDescMap.get(rno) || obj.description || "No Description";
    summaryMap.set(rno, obj);
  }

  // --- 5) Assign Dish Codes (stable order) ---
  recipeKeyList.sort(); // ensure stable ordering
  recipeKeyList.forEach((recipeNo, idx) => {
    const dishCode = `PCC${String(idx + 1).padStart(3, "0")}`;
    const obj = summaryMap.get(recipeNo);
    if (obj) {
      obj.dishCode = dishCode;
      summaryMap.set(recipeNo, obj);
    }
  });

  // --- 6) Render table ---
  tbody.innerHTML = "";

  if (summaryMap.size === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" style="text-align:center; font-style:italic; color:gray;">No data for today</td>`;
    tbody.appendChild(tr);
    return;
  }

  // Attach once (outside the loop)
  const onInput = (e) => {
    const el = e.target;
    if (!el.classList.contains("acct-qty-input")) return;
    setAcctQty(el.dataset.tab, el.dataset.key, el.value);
  };
  tbody.removeEventListener("input", onInput);
  tbody.addEventListener("input", onInput);

  for (const recipeNo of recipeKeyList) {
    const item = summaryMap.get(recipeNo);
    const tr = document.createElement("tr");

    const prodKey = item.recipeNo; // key for storing edits
    const prodQty = getAcctQty("production", prodKey, Number(item.total) || 0);

    tr.innerHTML = `
      <td>${item.submenuCode || ""}</td>
      <td>${item.dishCode}</td>
      <td>${item.recipeNo}</td>
      <td>${item.description}</td>
      <td>
        <input
          type="number"
          step="0.01"
          min="0"
          class="acct-qty-input"
          data-tab="production"
          data-key="${prodKey}"
          value="${prodQty}"
          style="width: 90px; text-align: right;"
        />
      </td>
    `;
    tbody.appendChild(tr);
  }
};


function formatDateLocal(dateString) {
  // Expecting YYYY-MM-DD, split manually to avoid UTC offset issues
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day); // Local time
  return `${month}/${day}/${year}`;
}




let currentVenueCode = "b001"; // 🧭 Default venue

window.copyProductionSummaryToClipboard = function () {
  const table = document.getElementById("productionTable");
  if (!table) return alert("Production Summary Table not found.");

  let tsv = "";
  const rows = table.querySelectorAll("tbody tr");

  rows.forEach(row => {
    const cells = row.querySelectorAll("td");

    // columns: submenu, dish, recipeNo, description, qty(input)
    const submenu = cells[0]?.innerText.trim() ?? "";
    const dish = cells[1]?.innerText.trim() ?? "";
    const recipeNo = cells[2]?.innerText.trim() ?? "";
    const desc = cells[3]?.innerText.trim() ?? "";
    const qtyInput = cells[4]?.querySelector("input");
    const qty = qtyInput ? qtyInput.value : (cells[4]?.innerText.trim() ?? "");

    tsv += [submenu, dish, recipeNo, desc, qty].join("\t") + "\n";
  });

  navigator.clipboard.writeText(tsv)
    .then(() => alert("Copied to clipboard!"))
    .catch(() => alert("Copy failed. Try again."));
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
// 📥 Fetch + normalize Firestore orders (supports Concessions split to C002/C003)
// 🔄 Build + show Production Shipments (TODAY only)
window.loadProductionShipments = async function () {
  const container = document.getElementById("singleVenueShipmentContainer");

  // spinner
  container.innerHTML = `
    <div style="text-align:center; padding: 20px;">
      <div class="spinner"></div>
      <div style="margin-top: 8px; font-style: italic; color: gray;">Loading shipments...</div>
    </div>
  `;

  // --- Today (YYYY-MM-DD) ---
  const today = new Date(); today.setHours(0,0,0,0);
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  // 🧭 helpers/guards
  const venueCodesByName = (window.venueCodesByName || {
    aloha: "b001",
    ohana: "b002",
    gateway: "b003",
    concessions: "concessions",  // special handling
    concession: "concessions"
  });

  const qtyFromOrder = (d) => {
    const type = String(d.type || "").toLowerCase();
    const net   = parseFloat(d.netWeight ?? 0);
    const send  = parseFloat(d.sendQty   ?? 0);
    const qty   = parseFloat(d.qty       ?? 0);
    if (type === "starting-par") {
      // prefer netWeight for SP, fallback to others
      if (Number.isFinite(net) && net > 0) return net;
      return Math.max(0, Number.isFinite(send) ? send : 0, Number.isFinite(qty) ? qty : 0);
    }
    // add-ons (and anything else) → take the largest available
    return Math.max(
      0,
      Number.isFinite(send) ? send : 0,
      Number.isFinite(qty)  ? qty  : 0,
      Number.isFinite(net)  ? net  : 0
    );
  };

  const isCancelled = (d) => {
    const s = String(d.status || "").toLowerCase();
    return (s === "cancelled" || s === "void");
  };

  // Accumulators
  const pending = [];         // rows we still must place into a concessions code
  const recipeNos = new Set();
  const recipeIdsToResolve = new Set();
  const recipeMap = new Map();  // key: `${venueCode}__${recipeNo}` -> { venueCode, recipeNo, description, quantity }

  const addQty = (venueCode, recipeNo, quantity) => {
    if (!venueCode || !recipeNo) return;
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    const key = `${venueCode.toLowerCase()}__${recipeNo}`;
    if (!recipeMap.has(key)) {
      recipeMap.set(key, { venueCode: venueCode.toLowerCase(), recipeNo, description: "No Description", quantity: 0 });
    }
    recipeMap.get(key).quantity += quantity;
  };

  // 1) Pull today's orders
  const snap = await getDocs(query(collection(db, "orders"), where("date", "==", todayStr)));

  snap.forEach(docSnap => {
    const d = docSnap.data();
    if (isCancelled(d)) return;

    // Normalize identifiers
    let recipeNo = String(d.recipeNo || "").toUpperCase().trim();
    const recipeId = String(d.recipeId || "").trim();
    if (!recipeNo && !recipeId) return;

    const q = qtyFromOrder(d);
    if (!Number.isFinite(q) || q <= 0) return;

    // Venue normalization: accept either code (b001/c002/...) or names (Aloha/.../Concessions)
    const venueRaw = String(d.venue || "").trim();
    let venueCode = null;
    if (/^[bc]\d{3}$/i.test(venueRaw)) {
      venueCode = venueRaw.toLowerCase();
    } else {
      venueCode = venueCodesByName[venueRaw.toLowerCase()] || null;
    }

    // Known non-concession venue code? add immediately.
    if (venueCode && /^b\d{3}$/i.test(venueCode)) {
      if (!recipeNo && recipeId) recipeIdsToResolve.add(recipeId);
      addQty(venueCode, recipeNo || `id:${recipeId}`, q);
    } else {
      // Concessions or unknown → handle later
      pending.push({ venueRaw, venueCode, recipeNo: (recipeNo || ""), recipeId, qty: q });
    }

    if (recipeNo) recipeNos.add(recipeNo);
    if (!recipeNo && recipeId) recipeIdsToResolve.add(recipeId);
  });

  // 2) Resolve recipeId -> recipeNo (batch by individual getDoc)
  if (recipeIdsToResolve.size > 0) {
    const ids = Array.from(recipeIdsToResolve);
    const idDocs = await Promise.all(ids.map(id => getDoc(doc(db, "recipes", id))));
    idDocs.forEach((snap, idx) => {
      const id = ids[idx];
      if (snap.exists()) {
        const data = snap.data();
        const rno = String(data.recipeNo || "").toUpperCase().trim();
        if (rno) recipeNos.add(rno);
        // merge any existing "id:<id>" lines later after we know recipeNos
      }
    });
  }

  // 3) Batch fetch recipe meta (descriptions + venueCodes)
  const recipeMeta = new Map(); // recipeNo -> { description, venueCodes[] }
  const list = Array.from(recipeNos);
  for (let i = 0; i < list.length; i += 10) {
    const batch = list.slice(i, i + 10);
    const rsnap = await getDocs(query(collection(db, "recipes"), where("recipeNo", "in", batch)));
    rsnap.forEach(rdoc => {
      const r = rdoc.data();
      recipeMeta.set(
        String(r.recipeNo || "").toUpperCase(),
        {
          description: r.description || "No Description",
          venueCodes: Array.isArray(r.venueCodes) ? r.venueCodes.map(v => String(v).toLowerCase()) : []
        }
      );
    });
  }

  // 4) Merge pending rows
  pending.forEach(({ venueRaw, venueCode, recipeNo, recipeId, qty }) => {
    // If we have only id, try to resolve to recipeNo via cached meta (from step 2)
    if (!recipeNo && recipeId) {
      // We don't have a reverse map here; best-effort try: fetch directly
      // (light extra fetch only when needed)
      // NOTE: In practice most IDs were resolved above when they came from non-pending rows too.
    }

    const rno = recipeNo || ""; // if still empty, skip
    const meta = recipeMeta.get(rno) || { venueCodes: [] };

    // If explicit concessions code present (c002/c003), use it directly
    if (venueCode && /^c\d{3}$/i.test(venueCode)) {
      addQty(venueCode, rno, qty);
      return;
    }

    // Generic "Concessions" → split to c002/c003 based on recipe.venueCodes
    const isConcessions = venueCodesByName[venueRaw.toLowerCase()] === "concessions";
    if (isConcessions) {
      const targets = (meta.venueCodes || []).filter(c => c === "c002" || c === "c003");
      // If a recipe belongs to both, we add to both (so each venue sees the full qty).
      // If you prefer to split evenly, replace the loop with a divider (qty / targets.length).
      if (targets.length > 0) {
        targets.forEach(c => addQty(c, rno, qty));
      }
      return;
    }

    // Unknown venue name; ignore
  });

  // 5) Resolve any "id:<id>" keys that slipped through (fallback)
  for (const [key, val] of Array.from(recipeMap.entries())) {
    if (!key.includes("__id:")) continue;
    const [vc, idKey] = key.split("__");
    const rid = idKey.slice(3);
    const snap = await getDoc(doc(db, "recipes", rid));
    if (snap.exists()) {
      const data = snap.data();
      const rno = String(data.recipeNo || "").toUpperCase();
      recipeMap.delete(key);
      addQty(vc, rno, val.quantity);
      recipeNos.add(rno);
    }
  }

  // 6) Apply descriptions
  for (const rec of recipeMap.values()) {
    const meta = recipeMeta.get(rec.recipeNo);
    if (meta && meta.description) rec.description = meta.description;
  }

  // 7) Publish + default to Aloha
  window.allShipmentData = Array.from(recipeMap.values());
  window.loadVenueShipment("b001");
};

// 📤 Show one venue shipment (aggregated by recipe for the venue code)
window.loadVenueShipment = function (venueCode) {
  window.currentVenueCode = venueCode;

  const container = document.getElementById("singleVenueShipmentContainer");
  container.innerHTML = "";

  const venueLabel = (window.venueNames && window.venueNames[venueCode]) || venueCode.toUpperCase();

  const shipments = (window.allShipmentData || []).filter(
    s => String(s.venueCode || "").toLowerCase() === String(venueCode).toLowerCase()
  );

  // Aggregate by recipe (recipeNo + description)
  const rows = {};
  shipments.forEach(item => {
    const recipeNo = item.recipeNo || "UNKNOWN";
    const description = item.description || "No Description";
    const qty = Number(item.quantity || 0);

    const displayKey = `${recipeNo}__${description}`;
    if (!rows[displayKey]) rows[displayKey] = { recipeNo, description, quantity: 0 };
    rows[displayKey].quantity += qty;
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
    emptyRow.innerHTML = `<td colspan="3" style="text-align:center; font-style:italic; color:gray;">No items</td>`;
    body.appendChild(emptyRow);
  } else {
    // ensure we don't stack multiple listeners
    const onInput = (e) => {
      const el = e.target;
      if (!el.classList.contains("acct-qty-input")) return;
      setAcctQty(el.dataset.tab, el.dataset.key, el.value);
    };
    body.removeEventListener("input", onInput);
    body.addEventListener("input", onInput);

    keys.forEach(displayKey => {
      const { recipeNo, description, quantity } = rows[displayKey];

      // stable override key per venue+recipe
      const overrideKey = `${venueCode}__${recipeNo}`;
      const value = getAcctQty("productionShipments", overrideKey, Number(quantity) || 0);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${recipeNo}</td>
        <td>${description}</td>
        <td>
          <input
            type="number"
            step="0.01"
            min="0"
            class="acct-qty-input"
            data-tab="productionShipments"
            data-key="${overrideKey}"
            value="${value}"
            style="width: 90px; text-align:right;"
          />
        </td>
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
    alert("No table found.");
    return;
  }

  let tsv = "";
  const rows = table.querySelectorAll("tbody tr");

  rows.forEach(row => {
    const tds = row.querySelectorAll("td");
    if (tds.length < 3) return; // skip "No items" row

    const recipeNo = tds[0]?.innerText.trim() ?? "";
    const desc = tds[1]?.innerText.trim() ?? "";
    const qtyInput = tds[2]?.querySelector("input");
    const qty = qtyInput ? qtyInput.value : (tds[2]?.innerText.trim() ?? "");

    tsv += [recipeNo, desc, qty].join("\t") + "\n";
  });

  navigator.clipboard.writeText(tsv)
    .then(() => alert("Copied to clipboard!"))
    .catch(() => alert("Copy failed. Try again."));
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

  // Use the app's Hawaii-aware helpers
  const todayStr = getTodayDate();                  // "YYYY-MM-DD" in HST
  const { start, end } = getHawaiiTimestampRange(); // Firestore Timestamps (HST day range)

  // 1) Load all recipes -> map: description(lower) -> recipeNo
  const recipesSnapshot = await getDocs(collection(db, "recipes"));
  const recipeMap = new Map();
  recipesSnapshot.forEach(docSnap => {
    const d = docSnap.data();
    if (d.description) recipeMap.set(d.description.toLowerCase(), d.recipeNo);
  });

  // 2) Load all ingredients -> map: itemName(lower) -> itemNo
  const ingredientsSnapshot = await getDocs(collection(db, "ingredients"));
  const ingredientMap = new Map();
  ingredientsSnapshot.forEach(docSnap => {
    const d = docSnap.data();
    if (d.itemName) ingredientMap.set(d.itemName.toLowerCase(), d.itemNo);
  });

  // 3) Load waste entries (we'll filter to "today" and dedupe in code)
  const wasteSnapshot = await getDocs(
    query(collection(db, "waste"), orderBy("timestamp", "desc"))
  );

  // Dedup key memory
  const seen = new Set();
  let rendered = 0;

  for (const docSnap of wasteSnapshot.docs) {
    const data = docSnap.data();

    // --- Keep only today's entries (supports both 'date' string and 'timestamp')
    const hasDateStr = typeof data.date === "string" && data.date.length === 10;
    const inDateStr = hasDateStr && data.date === todayStr;

    let inTsRange = false;
    try {
      if (data.timestamp?.toDate) {
        const t = data.timestamp.toDate();
        const s = start.toDate();
        const e = end.toDate();
        inTsRange = t >= s && t < e;
      }
    } catch { /* ignore */ }

    if (!inDateStr && !inTsRange) continue;

    const rawDate = hasDateStr ? data.date : todayStr;  // fall back if missing
    const formattedDate = formatDateLocal(rawDate);     // e.g., 8/11/2025

const venue = data.venue || "";
const locationCode = (window.venueCodes && window.venueCodes[venue]) ? window.venueCodes[venue] : venue;



    const description = data.item || "";
    const descKey = description.toLowerCase();

    const quantity = Number(data.qty || 0);
    const recipeNoOrItemNo = recipeMap.get(descKey) || ingredientMap.get(descKey) || "";

    // ---- Exact duplicate filter (date + venue + itemKey + qty)
    const itemKey = (recipeNoOrItemNo || descKey).toString().toUpperCase();
    const dupeKey = [
      rawDate,
      locationCode,
      itemKey,
      quantity.toFixed(2)
    ].join("|");

    if (seen.has(dupeKey)) continue;
    seen.add(dupeKey);

    // Persist editable overrides by a stable key
    const overrideKey = `${rawDate}__${locationCode}__${itemKey}`;
    const value = getAcctQty("waste", overrideKey, quantity);

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formattedDate}</td>
      <td>${locationCode}</td>
      <td>${recipeNoOrItemNo}</td>
      <td>${description}</td>
      <td>
        <input
          type="number"
          step="0.01"
          min="0"
          class="acct-qty-input"
          data-tab="waste"
          data-key="${overrideKey}"
          value="${value}"
          style="width: 90px; text-align:right;"
        />
      </td>
    `;
    tableBody.appendChild(row);
    rendered++;
  }

  // Save overrides on edit
  tableBody.addEventListener("input", (e) => {
    const el = e.target;
    if (!el.classList.contains("acct-qty-input")) return;
    setAcctQty(el.dataset.tab, el.dataset.key, el.value);
  }, { once: true }); // attach once per render

  if (rendered === 0) {
    const empty = document.createElement("tr");
    empty.innerHTML = `<td colspan="5" style="text-align:center; font-style:italic; color:gray;">No waste entries for today</td>`;
    tableBody.appendChild(empty);
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
    if (cells.length < 5) return; // skip "No entries" row

    const date = cells[0]?.innerText.trim() ?? "";
    const location = cells[1]?.innerText.trim() ?? "";
    const code = cells[2]?.innerText.trim() ?? "";
    const description = cells[3]?.innerText.trim() ?? "";

    // ⬇️ Get the value from the input if present
    const qtyInput = cells[4]?.querySelector("input");
    const qty = qtyInput ? qtyInput.value : (cells[4]?.innerText.trim() ?? "");

    tsv += [date, location, code, description, qty].join("\t") + "\n";
  });

  navigator.clipboard.writeText(tsv)
    .then(() => alert("Waste table copied! Paste it into Excel."))
    .catch(err => {
      console.error("Copy failed:", err);
      alert("Copy failed. Try again.");
    });
};


// 🧾 Accounting: show ONLY today's lunch records (HST day)
// 🧾 Accounting: show ONLY today's lunch records (HST day) with ItemNo, Qty, UOM
async function loadLunchAccountingTable() {
  const tbody = document.querySelector("#lunchTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  // ---------- HST "today" window ----------
  const todayStr = typeof getTodayDate === "function" ? getTodayDate() : (() => {
    const now = new Date();
    const hNow = new Date(now.getTime() + (-10 * 60 * 60 * 1000));
    const y = hNow.getUTCFullYear();
    const m = String(hNow.getUTCMonth() + 1).padStart(2, "0");
    const d = String(hNow.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  })();
  const [yStr, mStr, dStr] = todayStr.split("-");
  const y = +yStr, m = +mStr, d = +dStr;
  const hStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const hEnd   = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));

  // ---------- Helpers ----------
  const fmtDate = (val) => {
    if (typeof val === "string") {
      return (typeof formatDateLocal === "function") ? formatDateLocal(val) : val;
    }
    let dt = null;
    if (val && typeof val.toDate === "function") dt = val.toDate();
    else if (val instanceof Date) dt = val;
    if (!dt) return "";
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    const ymd = `${yyyy}-${mm}-${dd}`;
    return (typeof formatDateLocal === "function") ? formatDateLocal(ymd) : `${mm}/${dd}/${yyyy}`;
  };
  const inHstWindow = (t) => {
    if (!t) return false;
    const ms = (t instanceof Date) ? t.getTime() : (typeof t.toDate === "function" ? t.toDate().getTime() : NaN);
    return Number.isFinite(ms) && ms >= hStart.getTime() && ms < hEnd.getTime();
  };
  const numStr = (n) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return "";
    return (Math.abs(x % 1) < 1e-9) ? String(x) : x.toFixed(2);
  };

  // ---------- Preload catalogs for lookups ----------
  // (You likely already have these cached elsewhere; safe to recalc here)
  const recipesSnap = await getDocs(collection(db, "recipes"));
  const recipesById = new Map();      // id -> recipe doc
  const recipeNoById = new Map();     // id -> recipeNo
  recipesSnap.forEach(docSnap => {
    const r = { id: docSnap.id, ...docSnap.data() };
    recipesById.set(r.id, r);
    if (r.recipeNo) recipeNoById.set(r.id, r.recipeNo);
  });

  const ingredientsSnap = await getDocs(collection(db, "ingredients"));
  const ingredientsById = new Map();  // id -> ingredient doc
  const itemNoById = new Map();       // id -> itemNo
  ingredientsSnap.forEach(docSnap => {
    const ing = { id: docSnap.id, ...docSnap.data() };
    ingredientsById.set(ing.id, ing);
    if (ing.itemNo) itemNoById.set(ing.id, ing.itemNo);
  });

  // ---------- Query lunch for today (string and timestamp fields) ----------
  const lunchRef = collection(db, "lunch");
  const snapStr   = await getDocs(query(lunchRef, where("date", "==", todayStr)));
  const snapDate  = await getDocs(query(lunchRef, where("date", ">=", hStart), where("date", "<", hEnd)));
  const snapTs    = await getDocs(query(lunchRef, where("timestamp", ">=", hStart), where("timestamp", "<", hEnd)));
  const snapSent  = await getDocs(query(lunchRef, where("sentAt", ">=", hStart), where("sentAt", "<", hEnd)));

  // ---------- Build rows (dedupe by doc id) ----------
  const rows = [];
  const seen = new Set();

  [snapStr, snapDate, snapTs, snapSent].forEach(s => {
    s.forEach(docSnap => {
      if (seen.has(docSnap.id)) return;
      seen.add(docSnap.id);

      const dta = docSnap.data();

      // Enforce today's HST
      const t =
        dta.date?.toDate?.() ||
        dta.timestamp?.toDate?.() ||
        dta.sentAt?.toDate?.() ||
        null;

      if (t) {
        if (!inHstWindow(t)) return;
      } else if (typeof dta.date === "string" && dta.date !== todayStr) {
        return;
      }

      // Resolve item fields
      const recipeId = dta.recipeId || null;
      const ingredientId = dta.ingredientId || null;

      // Item No.
      // Item No.
let itemNo =
  dta.itemNo || dta.recipeNo || dta.ingredientNo ||
  // match recipe description to lunch.item
  (() => {
    const match = Array.from(recipesById.values())
      .find(r => r.description?.toLowerCase().trim() === (dta.item || "").toLowerCase().trim());
    return match?.recipeNo || "";
  })() ||
  // fallback to ingredient match if needed
  (() => {
    const match = Array.from(ingredientsById.values())
      .find(i => i.itemName?.toLowerCase().trim() === (dta.item || "").toLowerCase().trim());
    return match?.itemNo || "";
  })() ||
  "";


      // Item Name
      let itemName =
        dta.item || dta.description || dta.itemName || dta.name ||
        (recipeId ? (recipesById.get(recipeId)?.description || "") : "") ||
        (ingredientId ? (ingredientsById.get(ingredientId)?.itemName || "") : "") ||
        "";

      // UOM
      let uom =
        dta.uom ||
        (recipeId ? (recipesById.get(recipeId)?.uom || "") : "") ||
        (ingredientId ? (ingredientsById.get(ingredientId)?.baseUOM || ingredientsById.get(ingredientId)?.uom || "") : "") ||
        "";

      // Qty
      const qty = dta.qty ?? dta.quantity ?? dta.amount ?? dta.sendQty ?? null;

      const displayDate = fmtDate(t || dta.date || todayStr);

      rows.push({
        displayDate,
        itemNo: String(itemNo || ""),
        itemName: String(itemName || ""),
        qty: numStr(qty),
        uom: String(uom || "")
      });
    });
  });

  // Optional sort (today already)
  rows.sort((a, b) => (a.itemName || "").localeCompare(b.itemName || "") || (a.itemNo || "").localeCompare(b.itemNo || ""));

  // ---------- Render ----------
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.displayDate}</td>
      <td>${r.itemNo}</td>
      <td>${r.itemName}</td>
      <td>${r.qty}</td>
      <td>${r.uom}</td>
    `;
    tbody.appendChild(tr);
  }
}



window.copyLunchTableToClipboard = function () {
  const table = document.getElementById("lunchTable");
  const rows = Array.from(table.querySelectorAll("tbody tr"));

  if (rows.length === 0) {
    alert("⚠️ No data to copy.");
    return;
  }

  // Build tab-delimited string (Date, ItemNo, Description, Qty, UOM)
  const text = rows.map(row => {
    const cells = row.querySelectorAll("td");
    const date = cells[0]?.innerText.trim() ?? "";
    const itemNo = cells[1]?.innerText.trim() ?? "";
    const desc = cells[2]?.innerText.trim() ?? "";

    // 👇 Qty from input if present
    const qtyInput = cells[3]?.querySelector("input");
    const qty = qtyInput ? qtyInput.value : (cells[3]?.innerText.trim() ?? "");

    const uom = cells[4]?.innerText.trim() ?? "ea";
    return [date, itemNo, desc, qty, uom].join("\t");
  }).join("\n");

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
// 🧠 Persist totals by itemId for lunch
window.mainLunchTotals = window.mainLunchTotals || {};

window.loadMainKitchenLunch = async function () {
  const tableBody = document.querySelector(".main-lunch-table tbody");
  tableBody.innerHTML = "";

  // 🗓 HST "today"
  const todayStrValue = typeof getTodayDate === "function" ? getTodayDate() : (() => {
    const now = new Date();
    const hawaiiOffsetMs = -10 * 60 * 60 * 1000;
    const hNow = new Date(now.getTime() + hawaiiOffsetMs);
    const y = hNow.getUTCFullYear();
    const m = String(hNow.getUTCMonth() + 1).padStart(2, "0");
    const d = String(hNow.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  })();

  const [yStr, mStr, dStr] = todayStrValue.split("-");
  const y = Number(yStr), m = Number(mStr), d = Number(dStr);
  const hStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));      // 00:00 HST
  const hEnd   = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));  // next 00:00 HST

  // ✅ Cache items (recipes + ingredients)
  if (!window.cachedMainLunchItems) {
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

    window.cachedMainLunchItems = [...allRecipes, ...allIngredients];
    console.log("📦 Cached Main Kitchen lunch items:", window.cachedMainLunchItems.length);
  }

  // 📥 Load ONLY today's lunch entries (works for string + Timestamp dates)
  window.mainLunchTotals = {}; // reset before summing
  try {
    const lunchRef = collection(db, "lunch");

    // A) String date exactly "YYYY-MM-DD"
    const snapStr = await getDocs(query(lunchRef, where("date", "==", todayStrValue)));

    // B) Timestamp in field "date"
    const snapTsDate = await getDocs(query(
      lunchRef,
      where("date", ">=", hStart),
      where("date", "<",  hEnd)
    ));

    // C) Timestamp in "timestamp"
    const snapTsMain = await getDocs(query(
      lunchRef,
      where("timestamp", ">=", hStart),
      where("timestamp", "<",  hEnd)
    ));

    // D) Timestamp in "sentAt"
    const snapSentAt = await getDocs(query(
      lunchRef,
      where("sentAt", ">=", hStart),
      where("sentAt", "<",  hEnd)
    ));

    // De-dupe across queries
    const byId = new Map();
    [snapStr, snapTsDate, snapTsMain, snapSentAt].forEach(snap => {
      snap.forEach(docSnap => byId.set(docSnap.id, docSnap.data()));
    });

    // Sum today's only
    for (const rec of byId.values()) {
      const id = rec.itemId || rec.recipeId || rec.ingredientId || rec.id || null;
      const qty = Number(rec.qty ?? rec.quantity ?? rec.amount ?? 0);
      if (!id || !Number.isFinite(qty) || qty === 0) continue;

      // Guard for string date
      if (typeof rec.date === "string" && rec.date !== todayStrValue) continue;

      // Guard for Timestamp windows (any of the common fields)
      const t =
        rec.date?.toDate?.() ||
        rec.timestamp?.toDate?.() ||
        rec.sentAt?.toDate?.() ||
        null;

      if (t) {
        const ms = t.getTime();
        if (ms < hStart.getTime() || ms >= hEnd.getTime()) continue;
      }

      window.mainLunchTotals[id] = (window.mainLunchTotals[id] || 0) + qty;
    }
  } catch (err) {
    console.error("⚠️ Failed loading today's lunch entries:", err);
  }

  // 🖨 Render
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

    // ✅ Pre-fill from today's totals only
    const savedQty = window.mainLunchTotals?.[item.id];
    const val = (savedQty ?? "").toString();

    row.innerHTML = `
      <td>${item.name}</td>
      <td>${item.uom}</td>
      <td>
        <input
          class="lunch-input"
          type="text"
          inputmode="decimal"
          value="${val}"
          data-item-id="${item.id}"
          style="width: 80px; margin-left: 6px; text-align: right;"
          placeholder="0"
        />
      </td>
      <td><button onclick="sendSingleMainLunch(this)">Send</button></td>
    `;

    // Normalize on Enter/blur and save to cache
    const input = row.querySelector(".lunch-input");
    const updateCacheFromInput = () => {
      const v = normalizeQtyInputValue(input); // math eval + normalization
      window.mainLunchTotals[item.id] = Number.isFinite(v) ? v : "";
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        updateCacheFromInput();
        input.select?.();
      }
    });
    input.addEventListener("blur", updateCacheFromInput);

    tableBody.appendChild(row);
  });

  // 🔌 Enable math (1+1, 2*3, 10/4, etc.)
  enableMathOnInputs(".main-lunch-table .lunch-input", document);
};

// Filter unchanged
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


window.sendSingleMainLunch = async function (button) {
  const row = button.closest("tr");
  const input = row.querySelector(".lunch-input");
  const itemId = row.dataset.itemId;

  // Ensure last-minute normalization (handles unblurred "1+1")
  const v = normalizeQtyInputValue(input);
  const qty = Number.isFinite(v) ? v : Number(window.mainLunchTotals?.[itemId] || 0);

  if (!Number.isFinite(qty) || qty <= 0) {
    alert("Please enter a valid quantity first.");
    return;
  }

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
  console.log(`✅ Sent lunch: ${qty} of ${item.name}`);

  // Clear UI + cache
  input.value = "";
  window.mainLunchTotals[itemId] = "";
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
    const input = row.querySelector(".lunch-input");
    const itemId = row.dataset.itemId;
    const v = normalizeQtyInputValue(input);
    const qty = Number.isFinite(v) ? v : Number(window.mainLunchTotals?.[itemId] || 0);

    if (Number.isFinite(qty) && qty > 0) {
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
      sentCount++;

      // clear UI + cache
      input.value = "";
      window.mainLunchTotals[itemId] = "";
    }
  }

  if (sentCount > 0) {
    alert(`✅ ${sentCount} lunch entr${sentCount === 1 ? "y" : "ies"} recorded for Main Kitchen.`);
  } else {
    alert("⚠️ No valid lunch quantities found.");
  }
};


//**ANALYTICS */
// ===== Analytics Dashboard (PowerBI-style) =====
(() => {
  'use strict';

  // global state (persist across tab switches)
  window.analyticsState = window.analyticsState || {
    start: null, end: null, venue: "All", section: "All",
    sectionsLoaded: false,
    charts: { categoryLine: null },
    // filters
    allCategories: new Set(),
    allItems: new Set(),
    selectedCategories: new Set(),
    selectedItems: new Set(),
  };
  // local alias to avoid scope issues
  const analyticsState = window.analyticsState;

  // ---------- INIT ----------
  window.initAnalyticsDashboard = async function initAnalyticsDashboard() {
    const startEl = document.getElementById("fStart");
    const endEl   = document.getElementById("fEnd");
    const venueEl = document.getElementById("fVenue");
    const sectEl  = document.getElementById("fSection");
    if (!startEl || !endEl || !venueEl || !sectEl) return;

    // default last 7 days
    const today = new Date();
    const endStr = toYMD(today);
    const start = new Date(today); start.setDate(start.getDate() - 6);
    const startStr = toYMD(start);
    startEl.value = startStr; endEl.value = endStr;

    if (!analyticsState.sectionsLoaded) {
      await populateSectionsDropdown(sectEl);
      analyticsState.sectionsLoaded = true;
    }

    // Build static filter shells (emptied/refreshed each run with live data)
    hydrateFilterUI();

    // events
    const applyBtn = document.getElementById("applyAnalyticsFilters");
    if (applyBtn) applyBtn.onclick = runAnalytics;

    const itemSearch = document.getElementById("filterItemSearch");
    if (itemSearch) itemSearch.oninput = filterItemCheckboxList;

    await runAnalytics();
  };

  // ---------- UTIL ----------
  function toYMD(d){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`;}
  function enumerateDates(startStr, endStr){ const out=[]; const d=new Date(startStr+"T00:00:00"); const e=new Date(endStr+"T00:00:00"); while(d<=e){ out.push(toYMD(d)); d.setDate(d.getDate()+1);} return out;}
  function fmtMoney(n){ return `$${Number(n||0).toFixed(2)}`; }
  function monthName(i){ return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i] || ""; }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  async function populateSectionsDropdown(selectEl){
    const recipesSnap = await getDocs(collection(db,"recipes"));
    const sections = new Set();
    recipesSnap.forEach(s=>{
      const d = s.data();
      const sec = d.section || d.station || d.category;
      if (sec) sections.add(String(sec));
    });
    [...sections].sort().forEach(s=>{
      const opt=document.createElement("option"); opt.value=s; opt.textContent=s; selectEl.appendChild(opt);
    });
  }

  function hydrateFilterUI(){
    const catWrap = document.getElementById("filterCatWrap");
    if (catWrap && !catWrap.dataset.ready){
      catWrap.dataset.ready="1";
      catWrap.addEventListener("change", (e)=>{
        const t=e.target;
        if (t && t.name==="catChk"){
          if(t.checked) analyticsState.selectedCategories.add(t.value);
          else analyticsState.selectedCategories.delete(t.value);
          runAnalytics();
        }
      });
    }
    const itemWrap = document.getElementById("filterItemWrap");
    if (itemWrap && !itemWrap.dataset.ready){
      itemWrap.dataset.ready="1";
      itemWrap.addEventListener("change",(e)=>{
        const t=e.target;
        if (t && t.name==="itemChk"){
          if(t.checked) analyticsState.selectedItems.add(t.value);
          else analyticsState.selectedItems.delete(t.value);
          runAnalytics();
        }
      });
    }
  }

  function filterItemCheckboxList(){
    const q = (document.getElementById("filterItemSearch")?.value || "").toLowerCase();
    const wrap = document.getElementById("filterItemWrap");
    if (!wrap) return;
    [...wrap.querySelectorAll("label")].forEach(l=>{
      const txt = l.dataset.text || "";
      l.style.display = txt.includes(q) ? "" : "none";
    });
  }

  // ---------- FILTER LISTS (now in-scope) ----------
  function rebuildFilterLists(categories, items){
    // categories
    const catWrap = document.getElementById("filterCatWrap");
    if (catWrap){
      const prevSel = new Set(analyticsState.selectedCategories);
      catWrap.innerHTML = categories.map(c=>{
        const checked = prevSel.has(c) ? "checked" : "";
        return `<label style="display:flex;gap:8px;align-items:center;margin-right:14px;">
                  <input type="checkbox" name="catChk" value="${escapeHtml(c)}" ${checked}>
                  <span>${escapeHtml(c)}</span>
                </label>`;
      }).join("");
      analyticsState.allCategories = new Set(categories);
      // prune selections no longer present
      analyticsState.selectedCategories.forEach(c=>{
        if(!analyticsState.allCategories.has(c)) analyticsState.selectedCategories.delete(c);
      });
    }

    // items (searchable)
    const itemWrap = document.getElementById("filterItemWrap");
    if (itemWrap){
      const prevSel = new Set(analyticsState.selectedItems);
      itemWrap.innerHTML = items.map(key=>{
        const [no, desc] = key.split("__");
        const txt = `${no} ${desc}`.toLowerCase();
        const checked = prevSel.has(key) ? "checked" : "";
        return `<label data-text="${escapeHtml(txt)}" style="display:block; margin:2px 0;">
                  <input type="checkbox" name="itemChk" value="${escapeHtml(key)}" ${checked}>
                  <span>${escapeHtml(no)} — ${escapeHtml(desc)}</span>
                </label>`;
      }).join("");
      analyticsState.allItems = new Set(items);
      analyticsState.selectedItems.forEach(k=>{
        if(!analyticsState.allItems.has(k)) analyticsState.selectedItems.delete(k);
      });
      filterItemCheckboxList();
    }
  }

  // ---------- CORE RUN ----------
  async function runAnalytics(){
    const loading = document.getElementById("analyticsLoading");
    if (loading) loading.style.display="inline";

    const startStr = document.getElementById("fStart")?.value || "";
    const endStr   = document.getElementById("fEnd")?.value || "";
    const venue    = document.getElementById("fVenue")?.value || "All";
    const section  = document.getElementById("fSection")?.value || "All";
    Object.assign(analyticsState,{ start:startStr,end:endStr,venue,section });

    // Pull orders & recipes to enrich (category, uom, description)
    const { ordersEnriched, categories, items } =
      await fetchAndEnrichOrders({startStr,endStr,venue,section});

    // Rebuild filter lists based on available data
    rebuildFilterLists(categories, items);

    // Apply filter selections
    const filtered = ordersEnriched.filter(o=>{
      const passCat  = analyticsState.selectedCategories.size ? analyticsState.selectedCategories.has(o.category) : true;
      const passItem = analyticsState.selectedItems.size ? analyticsState.selectedItems.has(o.itemKey) : true;
      return passCat && passItem;
    });

    // Render table
    renderOrderTable(filtered);

    // Category breakdown (totals)
    renderCategoryBreakdown(filtered);

    // Line chart: cost per category per day
    renderCategoryLineChart(buildCategorySeries(filtered));

    if (loading) loading.style.display="none";
  }

  // ---------- DATA FETCH/ENRICH ----------
  async function fetchAndEnrichOrders({ startStr, endStr, venue, section }) {
    // helpers (scoped here)
    function normalizeCategory(cat, station) {
      if (cat) return String(cat).toUpperCase();
      const map = { "FRYER":"HOTFOODS","OVENS":"HOTFOODS","WOK":"HOTFOODS","GRILL":"HOTFOODS","PANTRY":"PANTRY","BAKERY":"BAKERY" };
      const s = (station || "").toUpperCase();
      return map[s] || "UNCATEGORIZED";
    }
    function chooseRecipeForOrder(order, maps) {
      if (order.recipeId && maps.byId.has(order.recipeId)) return maps.byId.get(order.recipeId);
      const no = (order.recipeNo || "").toUpperCase();
      if (no && maps.byNo.has(no)) return maps.byNo.get(no);
      const desc = (order.description || order.item || "").trim().toLowerCase();
      if (desc && maps.byDesc.has(desc)) return maps.byDesc.get(desc);
      return null;
    }

    const ordersRef = collection(db, "orders");
    const qBase = query(ordersRef, where("date", ">=", startStr), where("date", "<=", endStr));
    const [snap, recipesSnap] = await Promise.all([
      getDocs(qBase),
      getDocs(collection(db, "recipes")),
    ]);

    // recipe indexes
    const maps = { byId: new Map(), byNo: new Map(), byDesc: new Map() };
    recipesSnap.forEach((r) => {
      const d = r.data();
      const rec = {
        id: r.id,
        recipeNo: d.recipeNo || "",
        description: d.description || d.itemName || "",
        category: (d.category || d.station || d.section || ""),
        uom: d.uom || d.baseUOM || d.purchaseUOM || "",
      };
      maps.byId.set(r.id, rec);
      if (rec.recipeNo) maps.byNo.set(String(rec.recipeNo).toUpperCase(), rec);
      if (rec.description) maps.byDesc.set(String(rec.description).trim().toLowerCase(), rec);
    });

    const out = [], cats = new Set(), items = new Set();

    snap.forEach((s) => {
      const d = s.data();

      // client-side venue/section filter
      const recSection = d.section || d.station || d.category || "";
      if (venue !== "All" && (d.venue || "") !== venue) return;
      if (section !== "All" && String(recSection) !== section) return;

      // find recipe (works even for add-ons without recipeId)
      const r = chooseRecipeForOrder(
        { recipeId: d.recipeId || "", recipeNo: d.recipeNo || "", description: d.description || d.item || "" },
        maps
      ) || {};

      const recipeNo    = r.recipeNo || d.recipeNo || "";
      const description = r.description || d.description || d.item || "";
      const category    = normalizeCategory(r.category || d.category, d.station);
      const uom         = d.uom || r.uom || "";
      const qty         = Number(d.sendQty ?? d.qty ?? d.netWeight ?? 0);
      const cost        = Number(d.totalCost ?? 0);

      const date = d.date; // "YYYY-MM-DD"
      const record = {
        id: s.id,
        date,
        year: Number((date || "").slice(0, 4)),
        month: Number((date || "").slice(5, 7)) - 1,
        day: Number((date || "").slice(8, 10)),
        recipeNo,
        description,
        category,
        qty,
        uom,
        cost,
        itemKey: `${(recipeNo || "").toUpperCase()}__${description.trim()}`,
      };

      out.push(record);
      cats.add(record.category);
      items.add(record.itemKey);
    });

    return {
      ordersEnriched: out,
      categories: [...cats].sort(),
      items: [...items].sort((a, b) => a.localeCompare(b)),
    };
  }

  // ---------- TABLE ----------
  function renderOrderTable(rows){
    const tbody = document.querySelector("#analyticsTable tbody");
    const totalEl = document.getElementById("analyticsTableTotal");
    if (!tbody) return;

    tbody.innerHTML = rows
      .sort((a,b)=> a.date.localeCompare(b.date) || a.recipeNo.localeCompare(b.recipeNo))
      .map(r=>{
        const yr=r.year, mn=monthName(r.month), dy=r.day;
        return `<tr>
          <td>${yr}</td><td>${mn}</td><td>${dy}</td>
          <td>${escapeHtml(r.recipeNo)}</td>
          <td>${escapeHtml(r.description)}</td>
          <td>${escapeHtml(r.category)}</td>
          <td style="text-align:right;">${Number(r.qty||0).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
          <td>${escapeHtml(r.uom||"")}</td>
          <td style="text-align:right;">${fmtMoney(r.cost)}</td>
        </tr>`;
      }).join("");

    const total = rows.reduce((a,r)=>a + Number(r.cost||0), 0);
    if (totalEl) totalEl.textContent = fmtMoney(total);
  }

  // ---------- CATEGORY BREAKDOWN (TOTALS) ----------
  function renderCategoryBreakdown(rows){
    const box = document.querySelector("#categoryBreakdown tbody");
    if (!box) return;
    const map = new Map();
    rows.forEach(r=> map.set(r.category, (map.get(r.category)||0) + Number(r.cost||0)));
    const total = [...map.values()].reduce((a,b)=>a+b,0);
    const html = [...map.entries()]
      .sort((a,b)=> b[1]-a[1])
      .map(([cat,sum])=> `<tr><td>${escapeHtml(cat)}</td><td style="text-align:right;">${fmtMoney(sum)}</td></tr>`)
      .join("") + `<tr><td><strong>Total</strong></td><td style="text-align:right;"><strong>${fmtMoney(total)}</strong></td></tr>`;
    box.innerHTML = html || `<tr><td colspan="2"><em>No data</em></td></tr>`;
  }

  // ---------- CATEGORY LINE CHART ----------
  function buildCategorySeries(rows){
    const labels = enumerateDates(analyticsState.start, analyticsState.end);
    const idx = new Map(labels.map((d,i)=>[d,i]));
    const cats = [...new Set(rows.map(r=>r.category))].sort();
    const series = new Map(); // cat -> array
    cats.forEach(c=> series.set(c, labels.map(()=>0)));
    rows.forEach(r=>{
      const i = idx.get(r.date);
      if (i==null) return;
      const arr = series.get(r.category);
      if (arr) arr[i] += Number(r.cost||0);
    });
    return { labels, series };
  }

  function renderCategoryLineChart({labels, series}){
    const canvas = document.getElementById("categoryLineChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (analyticsState.charts.categoryLine){
      analyticsState.charts.categoryLine.destroy();
    }
    if (typeof Chart === "undefined"){ console.warn("Chart.js not found"); return; }

    const datasets = [...series.entries()].map(([cat,arr])=>({
      type: "line",
      label: cat,
      data: arr,
      tension: 0.25,
      pointRadius: 2
    }));

    analyticsState.charts.categoryLine = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top" },
          tooltip: { callbacks: { label: (it)=> `${it.dataset.label}: ${fmtMoney(it.parsed.y)}` } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: (v)=> `$${Number(v).toLocaleString()}` } }
        }
      }
    });
  }

  // ---------- PUBLIC HOOK ----------
  window.showAccountingDashboard = function showAccountingDashboard(){
    const sec = document.getElementById("analyticsDashboard");
    if (sec && sec.style) sec.style.display="block";
    window.initAnalyticsDashboard();
  };

})();
