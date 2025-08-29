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

// ---- global waste caches (safe defaults) ----
window.alohaWasteTotals   = window.alohaWasteTotals   || {};
window.ohanaWasteTotals   = window.ohanaWasteTotals   || {};
window.gatewayWasteTotals = window.gatewayWasteTotals || {};
window.mainWasteTotals    = window.mainWasteTotals    || {};


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
// === Saved Guest Counts (for pars) ===
window.guestCountsSaved = window.guestCountsSaved || { Aloha: null, Ohana: null, Gateway: null };

function setGuestCountSaved(name, val) {
  const n = Number(val);
  window.guestCountsSaved[name] = Number.isFinite(n) ? n : null;
}

function getGuestCountFor(venue) {
  // venue is "Aloha" | "Ohana" | "Gateway"
  const saved = window.guestCountsSaved?.[venue];
  if (Number.isFinite(saved)) return saved;

  // fallback to the select value if user just changed it and hasn't saved yet
  const sel = document.getElementById(`count-${venue}`);
  if (sel) {
    const v = Number(sel.value);
    if (Number.isFinite(v)) return v;
  }
  return 0;
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
  const screens    = document.querySelectorAll(".screen");
  const chatBox    = document.getElementById("chatBox");

  function showScreen(id) {
    screens.forEach(screen => {
      screen.style.display = (screen.id === id) ? "block" : "none";
    });
    if (chatBox) chatBox.style.display = "block";
  }

  // --- tiny local helpers for notes (safe if your global versions exist too)
  function setGuestNotes(name, val) {
  const txt = (val == null || Number.isNaN(Number(val)))
    ? "—"
    : String(Number(val));

  const sum = document.getElementById(`current-${name}`);
  if (sum) sum.textContent = txt;

  const inline = document.getElementById(`note-${name}`);
  if (inline) inline.textContent = txt;
}

  function setSelectIfPresent(id, v) {
    const el = document.getElementById(id);
    if (!el) return;
    // ensure option exists so .value will stick even if not in preset list
    if (![...el.options].some(o => Number(o.value) === Number(v))) {
      const opt = document.createElement("option");
      opt.value = String(v);
      opt.textContent = String(v);
      el.appendChild(opt);
    }
    el.value = String(v);
  }

// --- Mirror cached Showware totals onto the Guest Count screen (labels only)
function paintGuestCountsScreenFromCache() {
  const g = window.showwareGuests || {};
  const write = (name, vals) => {
    if (!vals) return;
    const total = Number(vals.total || 0);
    if (!Number.isFinite(total)) return;

    // ✅ labels only (top "Current Guest Counts")
    const curEl = document.getElementById(`current-${name}`);
    if (curEl) curEl.textContent = String(total);

    // ❌ do NOT set the dropdown from Showware
    // setSelectIfPresent(`count-${name}`, total);  <-- remove
  };
  write("Aloha",   g.Aloha);
  write("Ohana",   g.Ohana);
  write("Gateway", g.Gateway);
}

  // ---- Initial screen (guarded)
  if (viewSelect && viewSelect.value) showScreen(viewSelect.value);

  // ---- On view change: swap screens, update venue, repaint counts from cache
  viewSelect?.addEventListener("change", () => {
    const id = viewSelect.value;
    showScreen(id);
    updateCurrentVenueFromSelect?.();

    try {
      // Venue tiles
      if (document.getElementById("gatewayTotalGuests")) {
        typeof paintGatewayCountsFromCache === "function" && paintGatewayCountsFromCache();
      }
      if (document.getElementById("ohanaTotalGuests")) {
        typeof paintOhanaCountsFromCache === "function" && paintOhanaCountsFromCache();
      }
      if (document.getElementById("alohaTotalGuests")) {
        typeof paintAlohaCountsFromCache === "function" && paintAlohaCountsFromCache();
      }

      // If the Guest Count screen is in view, mirror cached totals there too.
      // ✅ includes your actual id "guest-count"
      const guestCountsScreen =
        document.getElementById("guestCounts") ||
        document.getElementById("guestCount") ||
        document.getElementById("guest-counts") ||
        document.getElementById("guest-count");

      if (guestCountsScreen && guestCountsScreen.style.display !== "none") {
        paintGuestCountsScreenFromCache();
      }
    } catch (e) {
      console.debug("paint-from-cache on view change skipped:", e);
    }
  });

  console.log("✅ PCC KDS App Loaded");

  // 🔁 Firestore listeners (orders, etc.)
  listenToAlohaOrders?.();
  listenToGatewayOrders?.();
  listenToOhanaOrders?.();
  listenToConcessionOrders?.(); // ✅ Concession listener
  listenToAddonOrders?.();

  // 🔁 Live Showware guest totals → updates cache, tiles, and Guest Count screen
  listenToShowwareGuests?.();

  // ✅ Seed guest counts so UI shows numbers before first snapshots tick
  forceGatewayCountsOnce?.();
  forceOhanaCountsOnce?.();
  forceAlohaCountsOnce?.();

  // 🔽 Apply category filter on load for all venues
  ["aloha", "gateway", "ohana", "concession"].forEach(area => {
    applyCategoryFilter?.(area);
  });

  // 🚀 Start per-station listeners
  ["Wok", "Fryer", "Grill", "Oven", "Pantry", "Pastry"].forEach(station => {
    listenToStationOrders?.(station);
  });

  // 💰 Hook cost summaries to order changes (these should call updateCostSummaryForVenue)
  ["Aloha", "Gateway", "Ohana"].forEach(venue => {
    listenToVenueOrdersAndUpdateCost?.(venue);
  });

  // 🖌️ First paint from cache if available (avoids blank labels on initial load)
  try {
    typeof paintGatewayCountsFromCache === "function" && paintGatewayCountsFromCache();
    typeof paintOhanaCountsFromCache   === "function" && paintOhanaCountsFromCache();
    typeof paintAlohaCountsFromCache   === "function" && paintAlohaCountsFromCache();

    // Also mirror onto Guest Count inputs/labels immediately on load
    paintGuestCountsScreenFromCache();
  } catch {}

  // 🔄 Hydrate guest count selects/notes from Firestore and keep them live
  // (uses the loadGuestCounts() and listenToGuestCountsLive() you added earlier)
  try {
    typeof loadGuestCounts === "function" && loadGuestCounts();
    typeof listenToGuestCountsLive === "function" && listenToGuestCountsLive();
  } catch (e) {
    console.debug("guestCounts hydrate/listen skipped:", e);
  }
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

      // ✅ Update notes and summaries immediately
      ["Aloha", "Ohana", "Gateway"].forEach(name => {
        const val = counts[name];
         const txt = String(val);  // just the number

        const summary = document.getElementById(`current-${name}`);
        if (summary) summary.textContent = txt;

        const inline = document.getElementById(`note-${name}`);
        if (inline) inline.textContent = txt;
      });

      statusDiv.textContent = "✅ Guest counts saved!";
      statusDiv.style.color = "lightgreen";
    } catch (error) {
      console.error("❌ Error saving guest counts:", error);
      statusDiv.textContent = "⚠️ Failed to save counts.";
      statusDiv.style.color = "tomato";
    }
  });
}


// 🔁 Live Showware listener → updates cache, venue tiles, and Guest Count screen
function listenToShowwareGuests() {
  const q = query(
    collection(db, window.SHOWWARE_COLL || "showwareEvents"),
    orderBy("receivedAt", "desc"),
    limit(1)
  );

  onSnapshot(q, (snap) => {
    if (snap.empty) return;
    const d = snap.docs[0].data() || {};

    // 1) Extract all three from the SAME doc
    const gw = extractGatewayCounts?.(d);
    const oh = extractOhanaCounts?.(d);
    const al = extractAlohaCounts?.(d);

    // 2) Cache
    window.showwareGuests = window.showwareGuests || {};
    if (gw) window.showwareGuests.Gateway = gw;
    if (oh) window.showwareGuests.Ohana   = oh;
    if (al) window.showwareGuests.Aloha   = al;

    // 3) Paint venue tiles (if those elements exist on current view)
    try { gw && paintGatewayCounts?.(gw); } catch {}
    try { oh && paintOhanaCounts?.(oh);   } catch {}
    try { al && paintAlohaCounts?.(al);   } catch {}

    // 4) Mirror TOTALS onto Guest Count screen inputs/labels
// 4) Mirror TOTALS onto Guest Count screen (labels only; selects come from guestCounts)
const mirror = (name, vals) => {
  if (!vals) return;
  const total = Number(vals.total || 0);
  if (!Number.isFinite(total)) return;

  // ✅ labels
  const curEl = document.getElementById(`current-${name}`);
  if (curEl) curEl.textContent = String(total);

  // ❌ don't touch selects here
  // const inEl = document.getElementById(`count-${name}`);
  // if (inEl) inEl.value = String(total);
};
mirror("Aloha",   al);
mirror("Ohana",   oh);
mirror("Gateway", gw);


    // 5) Update cost/guest cards now that totals are fresh
    ["Aloha","Gateway","Ohana"].forEach(v => {
      try { updateCostSummaryForVenue?.(v); } catch {}
    });
  });
}


// ===== Ensure Showware-first guest note helpers exist (define BEFORE use) =====
(function ensureGuestNoteHelpers(){
  // live total from showwareEvents cache (window.showwareGuests)
  if (typeof window.swHasTotal !== "function") {
    window.swHasTotal = function(name){
      const t = Number(window?.showwareGuests?.[name]?.total);
      return Number.isFinite(t) ? t : null;
    };
  }

// write guest count to both summary and inline note, preferring Showware
if (typeof window.setGuestNotesPreferShowware !== "function") {
  window.setGuestNotesPreferShowware = function(name, fallbackVal){
    const live = window.swHasTotal(name);
    const val  = live ?? (Number.isFinite(Number(fallbackVal)) ? Number(fallbackVal) : null);
    const txt  = val == null ? "—" : String(val);

    const summary = document.getElementById(`current-${name}`);
    if (summary) summary.textContent = txt;

    const inline = document.getElementById(`note-${name}`);
    if (inline) inline.textContent = txt;
  };
}
})();


// ===== Load today's guest counts and hydrate UI =====
async function loadGuestCounts() {
  const todayId = getTodayDate();
  const ref = doc(db, "guestCounts", todayId);

  try {
    const snap = await getDoc(ref);
    const data = snap.exists() ? (snap.data() || {}) : {};

    ["Aloha", "Ohana", "Gateway"].forEach((name) => {
      const saved = Number(data?.[name]);
      // cache for pars
      setGuestCountSaved(name, saved);

      // Pre-select the dropdowns from guestCounts (saved values)
      const sel = document.getElementById(`count-${name}`);
      if (sel && Number.isFinite(saved)) {
        if (![...sel.options].some(o => Number(o.value) === saved)) {
          const opt = document.createElement("option");
          opt.value = String(saved);
          opt.textContent = String(saved);
          sel.appendChild(opt);
        }
        sel.value = String(saved);
      }

      // Notes: prefer Showware live totals; fall back to saved if Showware absent
      setGuestNotesPreferShowware(name, saved);
    });
  } catch (err) {
    console.error("loadGuestCounts() failed:", err);
    ["Aloha","Ohana","Gateway"].forEach(name => setGuestCountSaved(name, null));
  }
}



// ---- helpers ----
function toInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function ensureOption(selectId, value) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const exists = Array.from(sel.options).some((o) => Number(o.value) === Number(value));
  if (!exists) {
    const opt = document.createElement("option");
    opt.value = String(value);
    opt.textContent = String(value);
    sel.appendChild(opt);
  }
}

function setSelectValue(selectId, value) {
  const el = document.getElementById(selectId);
  if (el) el.value = String(value);
}

(function ensureGuestNoteHelpers(){
  if (typeof window.swHasTotal !== "function") {
    window.swHasTotal = function(name){
      const t = Number(window?.showwareGuests?.[name]?.total);
      return Number.isFinite(t) ? t : null;
    };
  }

  if (typeof window.setGuestNotesPreferShowware !== "function") {
    window.setGuestNotesPreferShowware = function(name, fallbackVal){
      const live = window.swHasTotal(name);
      const val  = live ?? (Number.isFinite(Number(fallbackVal)) ? Number(fallbackVal) : null);

      // 👇 just show the number (or — if null)
      const txt  = val == null ? "—" : String(val);

      const summary = document.getElementById(`current-${name}`);
      if (summary) summary.textContent = txt;
    };
  }
})();


function listenToGuestCountsLive() {
  const ref = doc(db, "guestCounts", getTodayDate());
  onSnapshot(ref, (snap) => {
    const data = snap.exists() ? (snap.data() || {}) : {};
    ["Aloha","Ohana","Gateway"].forEach((name) => {
      const saved = Number(data?.[name]);

      // keep cache up to date for pars
      setGuestCountSaved(name, saved);

      // keep selects aligned with saved doc (user can still change before saving)
      const sel = document.getElementById(`count-${name}`);
      if (sel && Number.isFinite(saved)) {
        if (![...sel.options].some(o => Number(o.value) === saved)) {
          const opt = document.createElement("option");
          opt.value = String(saved);
          opt.textContent = String(saved);
          sel.appendChild(opt);
        }
        sel.value = String(saved);
      }

      // notes remain Showware-first
      setGuestNotesPreferShowware(name, saved);
    });
  });
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

  // 🔒 Hide ALL Wok & Grill items from the Main Kitchen table (any venue)
  orders = orders.filter(
    o => !["Wok", "Grill"].includes((o.station || "").trim())
  );

  // ✅ Cache the filtered list so search won't re‑show Wok/Grill items
  if (!skipCache) {
    window.kitchenFullOrderList = [...orders];
  }
  window.kitchenOrderCache = orders;

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
      const v = evaluateMathExpression(input.value);
      const isValid = Number.isFinite(v) && v > 0;
      if (sendBtn) sendBtn.disabled = !isValid;
    };

    input.addEventListener("input", setEnabledFromValue);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const v = normalizeQtyInputValue(input);
        kitchenSendQtyCache[id] = Number.isFinite(v) ? v : "";
        setEnabledFromValue();
        input.select?.();
      }
    });

    input.addEventListener("blur", () => {
      const v = normalizeQtyInputValue(input);
      kitchenSendQtyCache[id] = Number.isFinite(v) ? v : "";
      setEnabledFromValue();
    });

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

// ✅ Cost summary uses what the kitchen actually sent (netWeight) instead of 1 lb requests
// ✅ Cost summary: only SENT orders; prefer totalCost; otherwise compute from netWeight × unit cost
async function updateCostSummaryForVenue(venueName) {
  const today = getTodayDate();

  // Pull only today's SENT add-ons & starting-par for this venue
  const q = query(
    collection(db, "orders"),
    where("venue", "==", venueName),
    where("date", "==", today),
    where("status", "==", "sent"),
    where("type", "in", ["addon", "starting-par"])
  );
  const snapshot = await getDocs(q);

  // Cache recipe costs to reduce reads
  const recipeCostCache = new Map(); // recipeId -> cost (number)

  async function getUnitCostFor(orderDoc) {
    // Prefer cost on the order (some flows save this)
    const orderCost = Number(orderDoc.cost ?? orderDoc.unitCost ?? 0);
    if (orderCost > 0) return orderCost;

    // Fallback: lookup recipe cost by recipeId (e.g., "r0278")
    const recipeId = (orderDoc.recipeId || "").toString().trim();
    if (!recipeId) return 0;

    if (recipeCostCache.has(recipeId)) return recipeCostCache.get(recipeId) || 0;

    try {
      const rs = await getDoc(doc(db, "recipes", recipeId));
      const c = rs.exists() ? Number(rs.data()?.cost || 0) : 0;
      recipeCostCache.set(recipeId, c);
      return c;
    } catch (e) {
      console.warn("⚠️ Recipe cost lookup failed:", recipeId, e);
      recipeCostCache.set(recipeId, 0);
      return 0;
    }
  }

  // Sum total spent
  let totalSpent = 0;

  // Build per-doc computations; await together to keep UI responsive
  const tasks = [];
  snapshot.forEach((s) => {
    const d = s.data();
    if (!d) return;

    // 1) If totalCost is present, trust it (kitchen already calculated from the true send)
    const storedTotal = Number(d.totalCost || 0);
    if (storedTotal > 0) {
      totalSpent += storedTotal;
      return;
    }

    // 2) Otherwise compute: use best available quantity signal
    const qtyForCost =
      Number(d.netWeight) ||     // ✅ kitchen-recorded total weight (best)
      Number(d.qty) ||           // fallback: generic qty
      Number(d.sentQty) ||       // fallback: pans sent / send quantity
      Number(d.requestQty) ||    // fallback: pre-send request
      0;

    if (qtyForCost <= 0) return;

    tasks.push((async () => {
      const unitCost = await getUnitCostFor(d);
      if (unitCost > 0) totalSpent += qtyForCost * unitCost;
    })());
  });

  await Promise.all(tasks);

  // ---- UI ids
  const idMap = {
    Aloha:   { spent: "totalSpent",        cost: "costPerGuest" },
    Gateway: { spent: "totalSpentGateway", cost: "costPerGuestGateway" },
    Ohana:   { spent: "totalSpentOhana",   cost: "costPerGuestOhana" },
    // Add Concessions if you have elements for it:
    // Concessions: { spent: "totalSpentConcessions", cost: "costPerGuestConcessions" },
  };
  const ids = idMap[venueName] || {};
  const lower = venueName.toLowerCase();

  // Always show money total
  if (ids.spent) {
    const el = document.getElementById(ids.spent);
    if (el) el.textContent = totalSpent.toFixed(2);
  }

  // Prefer live Showware totals; skip writes if not available yet
  const sw = window.showwareGuests?.[venueName];
  if (!sw) return;

  const guestTotal = Number(sw.total || 0);
  const scanned    = Number(sw.scanned || 0);
  const remainingGuests = Math.max(0, guestTotal - scanned);

  const costPerGuest = guestTotal > 0 ? totalSpent / guestTotal : 0;

  if (ids.cost) {
    const el = document.getElementById(ids.cost);
    if (el) el.textContent = costPerGuest.toFixed(2);
  }

  const totalEl = document.getElementById(`${lower}TotalGuests`);
  if (totalEl) totalEl.textContent = String(guestTotal);

  const remEl = document.getElementById(`${lower}RemainingGuests`);
  if (remEl) remEl.textContent = String(remainingGuests);
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

// ======================= Showware Core Helpers (hoisted) =======================
// Only declare once, before Gateway/Ohana/Aloha code
window.SHOWWARE_COLL = window.SHOWWARE_COLL || "showwareEvents";

// number coercion
function sw_toNum(v) {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// safe read of dotted paths ("a.b.c"); undefined if missing
function sw_read(obj, path) {
  if (!obj) return undefined;
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
      cur = cur[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

// search candidate keys across likely containers
function sw_findNum(d, candidates) {
  const pools = [
    d,
    d?.raw,
    d?.raw?.data,
    d?.raw?.payload,
    d?.payload,
    d?.data,
    d?.raw?.showware,
  ];
  for (const pool of pools) {
    if (!pool) continue;
    for (const key of candidates) {
      const v = sw_read(pool, key);
      if (v != null) return sw_toNum(v);
    }
  }
  return 0;
}





function extractAlohaCounts(d = {}) {
  const TOTAL_KEYS   = ["alohaTotal","alohaCount","aloha","aloha_total","aloha_count","AlohaTotal","AlohaCount"];
  const SCANNED_KEYS = ["alohaScanned","alohaScan","aloha_scanned","aloha_scan","AlohaScanned","AlohaScan"];
  const total   = sw_findNum(d, TOTAL_KEYS);
  const scanned = sw_findNum(d, SCANNED_KEYS);
  return { total, scanned, remaining: Math.max(0, total - scanned) };
}
function paintAlohaCounts(al) {
  if (!al) return false;
  const totalEl   = document.getElementById("alohaTotalGuests");
  const remainEl  = document.getElementById("alohaRemainingGuests");
  const scannedEl = document.getElementById("alohaScannedGuests");
  if (totalEl)   totalEl.textContent   = String(sw_toNum(al.total));
  if (remainEl)  remainEl.textContent  = String(Math.max(0, sw_toNum(al.remaining)));
  if (scannedEl) scannedEl.textContent = String(Math.max(0, sw_toNum(al.scanned)));
  return !!(totalEl || remainEl || scannedEl);
}
async function forceAlohaCountsOnce() {
  try {
    const qLatest = query(collection(db, window.SHOWWARE_COLL), orderBy("receivedAt","desc"), limit(1));
    const snap = await getDocs(qLatest);
    if (snap.empty) { console.warn(`${window.SHOWWARE_COLL} is empty for Aloha.`); return {ok:false, reason:"empty"}; }
    const d = snap.docs[0].data() || {};
    try {
      const log = (l,o)=>console.log(`🔎 (Aloha) ${l}:`, o?Object.keys(o):"(none)");
      log("doc keys", d); log("raw keys", d?.raw); log("raw.data keys", d?.raw?.data); log("raw.payload keys", d?.raw?.payload);
    } catch {}
    const al = extractAlohaCounts(d);
    console.log("📡 forceAlohaCountsOnce() latest doc:", d, "→", al);
    window.showwareGuests = window.showwareGuests || {};
    window.showwareGuests.Aloha = al;
    paintAlohaCounts(al);
    try { typeof updateCostSummaryForVenue === "function" && updateCostSummaryForVenue("Aloha"); } catch {}
    return { ok:true, data:al };
  } catch (err) {
    console.error("forceAlohaCountsOnce() failed:", err);
    return { ok:false, reason:"error", err };
  }
}
function paintAlohaCountsFromCache() {
  const al = window.showwareGuests?.Aloha;
  return al ? paintAlohaCounts(al) : false;
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

  // Build separate totals:
  //   • totalPansByRecipe = sum of "pans"
  //   • totalQtyByRecipe  = sum of "sendQty" (fallback "qty")
  //   • pendingPansByRecipe = pans that are not yet received (for Receive button)
  const totalPansByRecipe   = new Map();
  const totalQtyByRecipe    = new Map();
  const pendingPansByRecipe = new Map();

  ordersSnapshot.forEach((docSnap) => {
    const o = docSnap.data();
    const recipeId = o.recipeId;
    if (!recipeId) return;

    const pans = Number(o.pans || 0);
    const qty  = Number((o.sendQty ?? o.qty) || 0);
    const isReceived = (o.received === true) || (o.status === "received");

    if (pans > 0) {
      totalPansByRecipe.set(recipeId, (totalPansByRecipe.get(recipeId) || 0) + pans);
      if (!isReceived) {
        pendingPansByRecipe.set(recipeId, (pendingPansByRecipe.get(recipeId) || 0) + pans);
      }
    }
    if (qty > 0) {
      totalQtyByRecipe.set(recipeId, (totalQtyByRecipe.get(recipeId) || 0) + qty);
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

    // Sent & Pending (pans + qty shown; pending = pans not yet received)
    const sentPans    = Number(totalPansByRecipe.get(recipeId) || 0);
    const sentQty     = Number(totalQtyByRecipe.get(recipeId)  || data?.sentPars?.[recipeId] || 0); // keep legacy fallback
    const pendingPans = Number(pendingPansByRecipe.get(recipeId) || 0);

    // Hide if fully satisfied and nothing pending
    if (sentPans >= targetPans && pendingPans <= 0) return;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${recipe.description || recipe.recipeNo || recipeId}</td>
      <td>${targetPans % 1 ? targetPans.toFixed(2) : targetPans}</td>
      <td>
        ${(sentPans % 1 ? sentPans.toFixed(2) : sentPans)} pans
        /
        ${(sentQty  % 1 ? sentQty.toFixed(2)  : sentQty)} qty
      </td>
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

  console.log(`✅ Rendered ${matchedCount} ${venue} rows (Par=pans, Sent=“pans / qty”, Receive shown when pending>0)`);
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

// --- utilities to keep notes synced ---
function setGuestNote(name, val) {
  const el = document.getElementById(`current-${name}`);
  if (!el) return;
  const num = Number(val);
  el.textContent = Number.isFinite(num) ? String(num) : "—";
}

function mirrorGuestCountsToUI(data = {}) {
  ["Aloha","Gateway","Ohana"].forEach(name => {
    const sel = document.getElementById(`count-${name}`);
    const v = Number(data?.[name] ?? NaN);
    if (sel && Number.isFinite(v)) {
      // ensure the option exists so the value can be selected
      if (![...sel.options].some(o => Number(o.value) === v)) {
        const opt = document.createElement("option");
        opt.value = String(v);
        opt.text = String(v);
        sel.appendChild(opt);
      }
      sel.value = String(v);
    }
    setGuestNote(name, v);
  });
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

  // --- Concessions baseline (unchanged), but we will DISPLAY the remaining
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

      // 1) Today's target PAR (pans)
      let parPans = 0;
      if (venue === "Concessions") {
        parPans = Number(recipe.pars?.Concession?.default || 0);
      } else {
        const gc = Number(data.guestCounts?.[venue] || 0);
        parPans = Number(recipe.pars?.[venue]?.[String(gc)] || 0);
      }
      if (parPans <= 0) continue;

      // 2) Compute REMAINING to send
      let remaining = 0;

      if (venue === "Concessions") {
        // Wave/baseline in lbs, but we still display the remaining PAN count here
        const sentAtBaseline = Number(finalSentBase?.[recipe.id] || 0);
        const sentNow = Number(data.sentPars?.Concessions?.[recipe.id] || 0); // lbs tallied by loader
        const effectiveSentSinceIncrease = Math.max(0, sentNow - sentAtBaseline);
        remaining = Math.max(0, parPans - effectiveSentSinceIncrease);
      } else {
        // Buffet venues: “target − total sent today (pans)”
        const sentPansToday = Number(data.sentPars?.[venue]?.[recipe.id] || 0);
        remaining = Math.max(0, parPans - sentPansToday);
      }

      // Only show if something is still needed
      if (remaining <= 0) continue;

      // 3) Build row: Area | Item | Par Qty (REMAINING) | UOM | Send Qty (blank) | Action
      const row = document.createElement("tr");
      row.dataset.recipeId = recipe.id;
      row.dataset.venue    = venue;

      row.innerHTML = `
        <td>${venue}</td>
        <td>${recipe.description || recipe.recipeNo || recipe.id}</td>
        <td>${fmt(remaining)}</td>
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
  console.log(`✅ Rendered ${totalRows} rows (Par Qty now shows remaining = target − sent; Send Qty left blank).`);
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
          date: today
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
      const currentPar = Number(recipeData?.pars?.[venue]?.[String(guestCount)] || 0);

      if (existing.exists()) {
        const prev = existing.data();
        const prevPar = Number(prev.pans || 0);           // previously satisfied PAR snapshot
        const prevQty = Number(prev.qty || 0);            // cumulative pans sent
        const newPar  = Math.max(prevPar, currentPar);    // grow to latest PAR if it increased

        // ✅ Guard against double sends: only add what's still remaining
        const remaining = Math.max(0, newPar - prevQty);
        const addQty    = Math.min(pansTyped, remaining);

        if (addQty <= 0) {
          // nothing left to add — likely a duplicate click/second trigger
          return;
        }

        const addCost = parseFloat((addQty * costPerUnit).toFixed(2));
        await updateDoc(orderRef, {
          type: "starting-par",
          venue,
          recipeId,
          recipeNo,
          // "pans" tracks satisfied PAR; "qty" accumulates actual pans sent
          pans: newPar,
          qty: parseFloat((prevQty + addQty).toFixed(2)),
          // keep a mirror field used by some UIs (status tables sum sendQty first)
          sendQty: parseFloat((Number(prev.sendQty || prevQty) + addQty).toFixed(2)),
          totalCost: parseFloat(((Number(prev.totalCost || 0)) + addCost).toFixed(2)),
          date: today,
          status: "sent",
          updatedAt: nowTs
        });
      } else {
        // first send of the day — cap to today's PAR
        const firstQty  = Math.min(pansTyped, currentPar);
        const firstCost = parseFloat((firstQty * costPerUnit).toFixed(2));

        await setDoc(orderRef, {
          type: "starting-par",
          venue,
          recipeId,
          recipeNo,
          pans: currentPar,                 // snapshot of target PAR
          qty: firstQty,                    // cumulative pans sent (starts here)
          sendQty: firstQty,                // mirror for status tables
          totalCost: firstCost,
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

// 🔧 Helper: compute net waste after pan
function computeNetWaste(grossQty, panWeight) {
  const pw = Number(panWeight || 0);
  const g  = Number(grossQty || 0);
  const net = g - (pw > 0 ? pw : 0);
  return Math.max(0, Number.isFinite(net) ? net : 0);
}

// 🔎 Get unit cost for a recipe (prefer cached, else look up by description)
async function getUnitCostForRecipe(recipe) {
  // fast path: cost already on the recipe object
  const cached = Number(recipe?.cost ?? 0);
  if (Number.isFinite(cached) && cached > 0) return cached;

  try {
    // fallback: find recipe by description
    const snap = await getDocs(
      query(collection(db, "recipes"), where("description", "==", recipe.description), limit(1))
    );
    if (!snap.empty) {
      const data = snap.docs[0].data();
      const cost = Number(data?.cost ?? 0);
      if (Number.isFinite(cost) && cost >= 0) return cost;
    }
  } catch (e) {
    console.warn("getUnitCostForRecipe lookup failed:", e);
  }
  return 0;
}


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
    const grossQty = Number.isFinite(v) ? v : Number(window.alohaWasteTotals?.[recipeId] || 0);
    if (!Number.isFinite(grossQty) || grossQty <= 0) continue;

    const recipe = window.alohaWasteRecipeList.find(r => r.id === recipeId);
    if (!recipe) {
      console.warn(`⚠️ Recipe not found for ID: ${recipeId}`);
      continue;
    }

    // 🥘 Subtract pan weight if defined
    const netQty = computeNetWaste(grossQty, recipe.panWeight);
    if (netQty <= 0) {
      console.warn(`⚠️ Net waste is 0 after pan-weight subtraction for ${recipe.description}. Skipping.`);
      continue;
    }

    // ✅ Validate after subtraction
    const hasEnough = await checkIfEnoughReceived(recipeId, netQty, "Aloha");
    if (!hasEnough) {
      alert(`🚫 Cannot waste ${netQty} of "${recipe.description}" — more than received today after pan subtraction.`);
      continue;
    }

    // 💰 cost
    const unitCost = await getUnitCostForRecipe(recipe);
    const totalCost = parseFloat((unitCost * netQty).toFixed(2));

    const wasteData = {
      item: recipe.description,
      venue: "Aloha",
      qty: netQty,                     // store NET
      uom: recipe.uom || "ea",
      date: today,
      timestamp: serverTimestamp(),
      // audit fields
      grossQty,                        // what was typed/entered
      panWeightUsed: Number(recipe.panWeight || 0),
      // reporting
      unitCost,
      totalCost
    };

    await addDoc(collection(db, "waste"), wasteData);
    console.log(`✅ Sent Aloha waste: gross=${grossQty}, net=${netQty} of ${recipe.description} | $${totalCost}`);
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
  const grossQty = Number.isFinite(v) ? v : Number(window.alohaWasteTotals?.[recipeId] || 0);

  if (!Number.isFinite(grossQty) || grossQty <= 0) {
    alert("Please enter a valid quantity first.");
    return;
  }

  const recipe = window.alohaWasteRecipeList.find(r => r.id === recipeId);
  if (!recipe) {
    alert("❌ Recipe not found.");
    return;
  }

  // 🥘 Subtract pan weight if defined
  const netQty = computeNetWaste(grossQty, recipe.panWeight);
  if (netQty <= 0) {
    alert(`⚠️ Net waste is 0 after subtracting pan weight (${recipe.panWeight || 0}).`);
    return;
  }

  // ✅ Validate after subtraction
  const hasEnough = await checkIfEnoughReceived(recipeId, netQty, "Aloha");
  if (!hasEnough) {
    alert(`🚫 Cannot waste ${netQty} of "${recipe.description}" — more than received today after pan subtraction.`);
    return;
  }

  // 💰 cost
  const unitCost = await getUnitCostForRecipe(recipe);
  const totalCost = parseFloat((unitCost * netQty).toFixed(2));

  const today = getTodayDate();
  const wasteData = {
    item: recipe.description,
    venue: "Aloha",
    qty: netQty,                    // store NET
    uom: recipe.uom || "ea",
    date: today,
    timestamp: serverTimestamp(),
    // audit fields
    grossQty,
    panWeightUsed: Number(recipe.panWeight || 0),
    // reporting
    unitCost,
    totalCost
  };

  await addDoc(collection(db, "waste"), wasteData);
  console.log(`✅ Sent waste to 'waste': gross=${grossQty}, net=${netQty} of ${recipe.description} | $${totalCost}`);

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
// ✅ Availability = received starting/addon − received returns (net) − already wasted
async function checkIfEnoughReceived(recipeId, wasteQty, venue) {
  const today = getTodayDate();
  const epsilon = 1e-6;

  // ---------- Resolve description/recipeNo/panWeight/uom ----------
  let recipeNo = "", description = "", panWeight = 0, uom = "";
  const norm = v => (v == null ? "" : String(v).trim().toLowerCase());

  // Try in‑memory lists first (fast)
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
      panWeight   = Number(hit.panWeight || 0);
      uom         = (hit.uom || "").toString().toLowerCase();
      break;
    }
  }
  if (!description || !recipeNo) {
    const snap = await getDoc(doc(db, "recipes", recipeId));
    if (snap.exists()) {
      const d = snap.data();
      recipeNo    = (d.recipeNo || d.recipe_no || "").toString();
      description = (d.description || "").toString();
      panWeight   = Number(d.panWeight || 0);
      uom         = (d.uom || "").toString().toLowerCase();
    }
  }

  const recId   = norm(recipeId);
  const recNo   = norm(recipeNo);
  const recDesc = norm(description);

  // ---------- Sum today's RECEIVED starting-par & addons for this recipe ----------
  const ordersSnap = await getDocs(query(
    collection(db, "orders"),
    where("date", "==", today),
    where("venue", "==", venue)
  ));

  let totalReceived = 0;
  let matchedOrders = 0;

  ordersSnap.forEach(docSnap => {
    const d = docSnap.data();
    const status = norm(d.status || "sent");
    if (status === "cancelled" || status === "void") return;

    const typ = norm(d.type || "");
    if (!(typ === "starting-par" || typ === "addon")) return;

    // Only count starting-par when actually RECEIVED
    if (typ === "starting-par") {
      const recvd = (d.received === true) || status === "received";
      if (!recvd) return;
    }

    // Match by any identifier you store
    const dId   = norm(d.recipeId);
    const dNo   = norm(d.recipeNo);
    const dDesc = norm(d.recipeDescription || d.item || d.description);

    const isSameRecipe =
      (dId && dId === recId) ||
      (dNo && dNo === recNo) ||
      (dDesc && dDesc === recDesc);

    if (!isSameRecipe) return;

    // Prefer net figures if present
    const recNet  = parseFloat(d.netWeight ?? 0);
    const recSend = parseFloat(d.sendQty   ?? 0);
    const recQty  = parseFloat(d.qty       ?? 0);
    const used = Math.max(
      Number.isFinite(recNet)  ? recNet  : 0,
      Number.isFinite(recSend) ? recSend : 0,
      Number.isFinite(recQty)  ? recQty  : 0
    );

    if (used > 0) {
      totalReceived += used;
      matchedOrders++;
    }

    console.log(`📦 Counted order → type=${typ} status=${status} id=${d.recipeId} no=${d.recipeNo} item=${d.item} net=${recNet} send=${recSend} qty=${recQty} → +${used}`);
  });

  if (matchedOrders === 0) {
    console.warn(`[checkIfEnoughReceived] No matching orders for ${venue} ${today} recipeId=${recipeId}. Keys → id:${recId}, no:${recNo}, desc:${recDesc}`);
  }

  // ---------- Sum today's RECEIVED returns (NET), subtracting pan weight when needed ----------
  let returnedNet = 0;

  const returnsSnap = await getDocs(query(
    collection(db, "returns"),
    where("venue", "==", venue),
    where("date", "==", today),
    where("status", "==", "received")
  ));

  returnsSnap.forEach(docSnap => {
    const r = docSnap.data();

    // Match the same recipe
    const rId   = norm(r.recipeId);
    const rNo   = norm(r.recipeNo);
    const rDesc = norm(r.item || r.recipeDescription || r.description);
    const same =
      (rId && rId === recId) ||
      (rNo && rNo === recNo) ||
      (rDesc && rDesc === recDesc);
    if (!same) return;

    // Try to interpret r as NET first; otherwise compute net from gross - panWeight
    let net = 0;

    // 1) If your return writer stored NET in qty (recommended)
    const qty = Number(r.qty ?? 0);
    const grossQty = Number(r.grossQty ?? 0);
    const pwUsed = Number(r.panWeightUsed ?? NaN);

    if (grossQty > 0 && Number.isFinite(pwUsed)) {
      net = Math.max(0, grossQty - pwUsed);
    } else if (qty > 0 && r.isNet === true) {
      net = qty;
    } else if (qty > 0 && (r.netQty != null)) {
      net = Number(r.netQty) || 0;
    } else if (qty > 0) {
      // Fallback: if lbs, subtract panWeight from qty; else assume qty is net
      net = (uom === "lb" && panWeight > 0) ? Math.max(0, qty - panWeight) : qty;
    }

    if (net > 0) returnedNet += net;

    console.log(`↩️ Counted return → id=${r.recipeId} no=${r.recipeNo} item=${r.item} qty=${qty} gross=${grossQty} pwUsed=${pwUsed} uom=${uom} panWeight=${panWeight} → net=${net}`);
  });

  // ---------- Sum today's already-wasted (waste stores .item as description) ----------
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

  // ---------- Final availability ----------
  const available = totalReceived - returnedNet - alreadyWasted;

  console.log(`[checkIfEnoughReceived] ${venue} • ${description || recipeNo || recipeId} (${recipeId})
  starting+addons(received): ${totalReceived.toFixed(3)} | returns(received, net): ${returnedNet.toFixed(3)} | wasted: ${alreadyWasted.toFixed(3)}
  requested waste: ${Number(wasteQty).toFixed(3)} | available: ${available.toFixed(3)}`);

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

  // 💰 pricing (recipes only; ingredients default to 0 unless you want otherwise)
  const isRecipe  = (item?.type === "recipe" || item?.kind === "recipe");
  const unitCost  = isRecipe ? await getUnitCostForRecipe({ description: item.name, cost: item.cost }) : 0;
  const totalCost = parseFloat((unitCost * qty).toFixed(2));

  const wasteData = {
    item: item.name,
    venue: "Main Kitchen",
    qty,
    uom: item.uom || "ea",
    date: today,
    timestamp: serverTimestamp(),
    // reporting
    unitCost,
    totalCost
  };

  await addDoc(collection(db, "waste"), wasteData);
  console.log(`✅ Sent waste: ${qty} of ${item.name} | $${totalCost}`);

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

      // 💰 pricing
      const isRecipe  = (item?.type === "recipe" || item?.kind === "recipe");
      const unitCost  = isRecipe ? await getUnitCostForRecipe({ description: item.name, cost: item.cost }) : 0;
      const totalCost = parseFloat((unitCost * qty).toFixed(2));

      const wasteData = {
        item: item.name,
        venue: "Main Kitchen",
        qty,
        uom: item.uom || "ea",
        date: today,
        timestamp: serverTimestamp(),
        // reporting
        unitCost,
        totalCost
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
// 🔁 Aloha Returns — only items RECEIVED TODAY (HST), minus returns already sent/received today
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

    // Totals by recipe key (prefer net figures if present)
    const qtyByKey = new Map(); // KEY = recipeNo or recipeId (upper)
    const idFromNo = new Map(); // recipeNo -> recipeId
    ordersSnap.forEach(d => {
      const o = d.data();
      const key = String(o.recipeNo || o.recipeId || "").toUpperCase();
      if (!key) return;

      const recNet  = Number(o.netWeight ?? 0);
      const recSend = Number(o.sendQty   ?? 0);
      const recQty  = Number(o.qty       ?? 0);
      const used = Math.max(
        Number.isFinite(recNet)  ? recNet  : 0,
        Number.isFinite(recSend) ? recSend : 0,
        Number.isFinite(recQty)  ? recQty  : 0
      );
      if (!used) return;

      qtyByKey.set(key, (qtyByKey.get(key) || 0) + used);
      if (o.recipeNo && o.recipeId) idFromNo.set(String(o.recipeNo).toUpperCase(), String(o.recipeId));
    });

    if (qtyByKey.size === 0) {
      showTableEmpty(tableBody, "No valid items to return.");
      return;
    }

    // 2) Returns already made today (subtract; supports partial returns)
    const returnsSnap = await getDocs(query(
      collection(db, "returns"),
      where("venue", "==", "Aloha"),
      where("date", "==", todayStr),
      where("status", "in", ["sent", "received"])
    ));
    const returnedByKey = new Map();
    returnsSnap.forEach(d => {
      const r = d.data();
      const k = String(r.recipeNo || r.recipeId || "").toUpperCase();
      if (!k) return;
      const q = Number(r.qty ?? r.netQty ?? 0) || 0; // qty is NET in our writer
      returnedByKey.set(k, (returnedByKey.get(k) || 0) + q);
    });

    // 3) Resolve recipe metadata (batched by recipeNo, then fall back to id)
    const keys = Array.from(qtyByKey.keys());
    const byNo = [], byId = [];
    keys.forEach(k => (/^[A-Za-z0-9\-_.]+$/.test(k) ? byNo : byId).push(k));

    const metaByKey = new Map();

    // Lookup by recipeNo (in chunks of 10)
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
        metaByKey.set(key, {
          id: docSnap.id,
          recipeNo: data.recipeNo || "",
          description: data.description || key,
          uom: (data.uom || "ea").toLowerCase(),
          panWeight: Number(data.panWeight || 0),
          returnable: String(data.returns || "").toLowerCase() === "yes"
        });
      });
    }

    // Lookup by recipeId (direct)
    for (const k of byId) {
      const ds = await getDoc(doc(db, "recipes", k));
      if (ds.exists()) {
        const data = ds.data();
        metaByKey.set(k, {
          id: ds.id,
          recipeNo: data.recipeNo || "",
          description: data.description || k,
          uom: (data.uom || "ea").toLowerCase(),
          panWeight: Number(data.panWeight || 0),
          returnable: String(data.returns || "").toLowerCase() === "yes"
        });
      } else {
        // Try via idFromNo mapping (if any)
        const via = idFromNo.get(k);
        if (via) {
          const ds2 = await getDoc(doc(db, "recipes", via));
          if (ds2.exists()) {
            const data = ds2.data();
            metaByKey.set(k, {
              id: ds2.id,
              recipeNo: data.recipeNo || "",
              description: data.description || k,
              uom: (data.uom || "ea").toLowerCase(),
              panWeight: Number(data.panWeight || 0),
              returnable: String(data.returns || "").toLowerCase() === "yes"
            });
          }
        }
      }
    }

    // 4) Build rows: remaining = received - returnedToday
    const rows = [];
    qtyByKey.forEach((receivedQty, key) => {
      const m = metaByKey.get(key);
      if (!m || !m.returnable) return;

      const already = returnedByKey.get(key) || 0;
      const remaining = Math.max(0, receivedQty - already);
      if (remaining <= 0) return;

      rows.push({
        id: m.id,
        recipeNo: m.recipeNo,
        name: m.description,
        uom: m.uom,
        panWeight: m.panWeight,
        qty: remaining
      });
    });

    if (rows.length === 0) {
      showTableEmpty(tableBody, "No returnable Aloha items remaining for today.");
      return;
    }

    // 5) Render table
    tableBody.innerHTML = "";
    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.dataset.recipeId   = r.id;
      tr.dataset.uom        = r.uom;
      tr.dataset.panWeight  = String(r.panWeight || 0);
     tr.innerHTML = `
  <td>${r.name}</td>
  <td>${r.qty} ${r.uom}</td>
  <td>
    <input class="return-input" type="number" min="0" step="0.01" 
           placeholder="0" value="" style="width:80px;" />
    ${r.uom === "lb" && r.panWeight > 0 
      ? `<div style="font-size:11px;color:#777;">Pan wt: ${r.panWeight}</div>` 
      : ""}
  </td>
  <td><button onclick="sendSingleAlohaReturn(this, '${r.id}')">Return</button></td>
`;

      tableBody.appendChild(tr);
    }
  } catch (err) {
    console.error("❌ Failed to load Aloha returns:", err);
    showTableEmpty(tableBody, "Failed to load. Please retry.");
  }
};


// ➤ Submit a single ALOHA return (stores NET qty; keeps gross & panWeightUsed for audit)
window.sendSingleAlohaReturn = async function (btn, recipeId) {
  const row = btn.closest("tr");
  const qtyInput = row.querySelector(".return-input");
  const raw = qtyInput?.value ?? "0";

  // Support math inputs if normalizeQtyInputValue exists
  let gross = 0;
  try {
    gross = typeof normalizeQtyInputValue === "function"
      ? Number(normalizeQtyInputValue(qtyInput))
      : Number(raw);
  } catch {
    gross = Number(raw);
  }

  if (!Number.isFinite(gross) || gross <= 0) {
    alert("Please enter a valid quantity to return.");
    return;
  }

  const uom = (row.dataset.uom || "ea").toLowerCase();
  const panWeight = Number(row.dataset.panWeight || 0);
  const net = (uom === "lb" && panWeight > 0) ? Math.max(0, gross - panWeight) : gross;

  if (net <= 0) {
    alert(`Net return is 0 after subtracting pan weight (${panWeight}).`);
    return;
  }

  try {
    // Pull a little metadata for nicer records
    const recipeSnap = await getDoc(doc(db, "recipes", recipeId));
    const rd = recipeSnap.exists() ? recipeSnap.data() : {};
    const recipeNo = rd.recipeNo || "";
    const description = rd.description || row.cells?.[0]?.textContent || recipeNo || recipeId;

// inside sendSingleAlohaReturn addDoc(...)
await addDoc(collection(db, "returns"), {
  item: description,
  recipeId,
  recipeNo,
  venue: "Aloha",
  date: getTodayDate(),
  uom,
  qty: net,
  grossQty: gross,
  panWeightUsed: (uom === "lb" ? panWeight : 0),
  isNet: true,
  status: "returned",            // 👈 was "sent" — change to "returned"
  timestamp: serverTimestamp(),
  returnedAt: serverTimestamp()
});


    // UI confirmation
    btn.parentElement.innerHTML = `<span style="color: green;">Returned</span>`;
    setTimeout(() => row.remove(), 800);

    console.log(`↩️ Aloha return: gross=${gross}, net=${net} for ${description} (${recipeId})`);
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


// ================== Main Kitchen Returns ==================

// In-flight guard to prevent double clicks
window.__receivingReturns = window.__receivingReturns || new Set();

/**
 * Receive a single return row:
 * 1) Flip return -> status: "received", receivedAt
 * 2) Apply allocation across today's orders (FIFO)
 * 3) Update UI
 */
window.receiveMainReturn = async function (returnId, button) {
  const row = button.closest("tr");
  const tableBody = document.querySelector(".main-returns-table tbody");
  if (!returnId || !row) return;

  if (window.__receivingReturns.has(returnId)) return;
  window.__receivingReturns.add(returnId);
  button.disabled = true;

  try {
    const returnRef = doc(db, "returns", returnId);

    // 1) Flip to received
    await updateDoc(returnRef, {
      status: "received",
      receivedAt: serverTimestamp()
    });

    // 2) Fetch the fresh doc and apply its effect to orders
    const freshSnap = await getDoc(returnRef);
    if (freshSnap.exists() && typeof applyReceivedReturnToOrders === "function") {
      await applyReceivedReturnToOrders(freshSnap);
    } else {
      console.warn("applyReceivedReturnToOrders helper missing or return not found.");
    }

    // 3) UI feedback
    button.parentElement.innerHTML = `<span style="color: green;">Received</span>`;
    setTimeout(() => row.remove(), 800);

    // Disable "Receive All" if table is empty
    const btnAll = document.getElementById("receiveAllMainReturns");
    if (btnAll && tableBody) {
      // slight delay so row removal has occurred
      setTimeout(() => {
        btnAll.disabled = tableBody.querySelectorAll("tr").length === 0;
      }, 300);
    }

    console.log(`✅ Received return ${returnId} and applied to orders.`);
  } catch (error) {
    console.error("❌ Error receiving return:", error);
    alert("Failed to receive item. Try again.");
    button.disabled = false;
  } finally {
    window.__receivingReturns.delete(returnId);
  }
};


/**
 * Receive all visible rows:
 * - Iterates rows and calls the same logic as single receive
 * - Processes sequentially to keep logs tidy and avoid quota spikes
 */
window.receiveAllMainReturns = async function () {
  const tableBody = document.querySelector(".main-returns-table tbody");
  const rows = Array.from(tableBody?.querySelectorAll("tr") || []);
  if (!rows.length) return;

  const btnAll = document.getElementById("receiveAllMainReturns");
  if (btnAll) btnAll.disabled = true;

  let okCount = 0, errCount = 0;

  for (const row of rows) {
    const id = row.getAttribute("data-return-id");
    const btn = row.querySelector("button, .receive-btn");
    try {
      await window.receiveMainReturn(id, btn || { closest: () => row, parentElement: { innerHTML: "" }, disabled: false });
      okCount++;
      // small delay to allow UI to breathe
      await new Promise(r => setTimeout(r, 50));
    } catch (e) {
      console.error("❌ Error receiving one of the returns:", e);
      errCount++;
    }
  }

  // Final UI state
  if (tableBody) {
    const left = tableBody.querySelectorAll("tr").length;
    if (btnAll) btnAll.disabled = left === 0;
  }

  console.log(`📦 Receive All complete. Success: ${okCount}, Failed: ${errCount}`);
};


/**
 * (Optional) Legacy alias if other code calls `receiveReturn(btn, returnId)`
 * Keeps compatibility and routes to the main handler.
 */
window.receiveReturn = async function (btn, returnId) {
  return window.receiveMainReturn(returnId, btn);
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
// ======================= Showware (Gateway) — Drop-in =======================
// Canonical collection name (guarded so it won't double‑declare)
window.SHOWWARE_COLL = window.SHOWWARE_COLL || "showwareEvents";

/* ------------------- Local helpers (namespaced; no collisions) ------------------- */
const gw_toNum = (v) => {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// safe read of dotted paths ("a.b.c"); returns undefined if path is missing
const gw_read = (obj, path) => {
  if (!obj) return undefined;
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
      cur = cur[p];
    } else {
      return undefined;
    }
  }
  return cur;
};

// look for any candidate key in a list of likely containers
function gw_findNum(d, candidates) {
  const pools = [
    d,
    d?.raw,
    d?.raw?.data,
    d?.raw?.payload,
    d?.payload,
    d?.data,
    d?.raw?.showware,
  ];
  for (const pool of pools) {
    if (!pool) continue;
    for (const key of candidates) {
      const v = gw_read(pool, key);
      if (v != null) return gw_toNum(v);
    }
  }
  return 0;
}

/**
 * Extract tolerant gateway counts from a Showware doc.
 * Supports:
 *   - top-level fields (e.g., gatewayCount)
 *   - raw.* containers (raw.gatewayCount)
 *   - an extra nesting layer (raw.payload.gatewayCount)
 *   - multiple key name variants (camelCase / snake_case / legacy)
 */
function extractGatewayCounts(d = {}) {
  // total guests variants
  const TOTAL_KEYS = [
    "gatewayTotal", "gatewayCount", "gateway",
    "gateway_total", "gateway_count",
    "GatewayTotal", "GatewayCount"
  ];

  // scanned variants
  const SCANNED_KEYS = [
    "gatewayScanned", "gatewayScan",
    "gateway_scanned", "gateway_scan",
    "GatewayScanned", "GatewayScan"
  ];

  const total   = gw_findNum(d, TOTAL_KEYS);
  const scanned = gw_findNum(d, SCANNED_KEYS);

  return {
    total,
    scanned,
    remaining: Math.max(0, total - scanned),
  };
}

/**
 * Write Gateway numbers into the DOM if the elements exist.
 * Never writes NaN; avoids negative values.
 */
function paintGatewayCounts(gw) {
  if (!gw) return false;

  const totalEl   = document.getElementById("gatewayTotalGuests");
  const remainEl  = document.getElementById("gatewayRemainingGuests");
  const scannedEl = document.getElementById("gatewayScannedGuests"); // optional

  if (totalEl)   totalEl.textContent   = String(gw_toNum(gw.total));
  if (remainEl)  remainEl.textContent  = String(Math.max(0, gw_toNum(gw.remaining)));
  if (scannedEl) scannedEl.textContent = String(Math.max(0, gw_toNum(gw.scanned)));

  return !!(totalEl || remainEl || scannedEl);
}

/* ------------------- SHOWWARE GATEWAY COUNTS: one‑shot fetch + DOM update ------------------- */
async function forceGatewayCountsOnce() {
  try {
    const qLatest = query(
      collection(db, window.SHOWWARE_COLL),
      orderBy("receivedAt", "desc"),
      limit(1)
    );
    const snap = await getDocs(qLatest);
    if (snap.empty) {
      console.warn(`${window.SHOWWARE_COLL} is empty.`);
      return { ok: false, reason: "empty" };
    }

    const d  = snap.docs[0].data() || {};

    // 🔎 Quick introspection so you can see where Showware put fields this time.
    try {
      const logKeys = (label, obj) => console.log(`🔎 ${label}:`, obj ? Object.keys(obj) : "(none)");
      logKeys("doc keys", d);
      logKeys("raw keys", d?.raw);
      logKeys("raw.data keys", d?.raw?.data);
      logKeys("raw.payload keys", d?.raw?.payload);
      logKeys("payload keys", d?.payload);
      logKeys("data keys", d?.data);
    } catch {}

    const gw = extractGatewayCounts(d);
    console.log("📡 forceGatewayCountsOnce() latest doc:", d, "→", gw);

    // cache for everyone else (aligns with your global used elsewhere)
    window.showwareGuests = window.showwareGuests || {};
    window.showwareGuests.Gateway = gw;

    // paint if elements exist (don’t force-create)
    paintGatewayCounts(gw);

    // if your cost/guest summary depends on this, nudge it (guarded)
    try {
      typeof updateCostSummaryForVenue === "function" &&
        updateCostSummaryForVenue("Gateway");
    } catch {}

    return { ok: true, data: gw };
  } catch (err) {
    console.error("forceGatewayCountsOnce() failed:", err);
    return { ok: false, reason: "error", err };
  }
}

/* ------------------- tiny helper to write from cache (no fetch) ------------------- */
function paintGatewayCountsFromCache() {
  const sw = window.showwareGuests?.Gateway;
  if (!sw) return false;
  return paintGatewayCounts(sw);
}

// expose to window (guard double-assign)
if (!window.forceGatewayCountsOnce)      window.forceGatewayCountsOnce = forceGatewayCountsOnce;
if (!window.paintGatewayCountsFromCache) window.paintGatewayCountsFromCache = paintGatewayCountsFromCache;
// ✅ Safe numeric parser for Showware fields
function sw_num(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}



// ---- Gateway table renderer (with Showware counts seed) ----
function renderGatewayTable(orders) {
  const tbody = document.querySelector("#gatewayTable tbody");
  if (!tbody) return;

  // Normalize + filter
  orders = Array.isArray(orders) ? orders : [];
  orders = orders.filter(o => o && o.status !== "received");

  // Clear and sort
  tbody.innerHTML = "";
  orders.sort((a, b) => {
    const orderMap = { sent: 0, "Ready to Send": 1, open: 2 };
    const ap = orderMap[a?.status] ?? 3;
    const bp = orderMap[b?.status] ?? 3;
    if (ap !== bp) return ap - bp;
    const ta = a?.timestamp?.toDate?.()?.getTime?.() || 0;
    const tb = b?.timestamp?.toDate?.()?.getTime?.() || 0;
    return ta - tb;
  });

  const now = new Date();

  for (const order of orders) {
    const row = document.createElement("tr");

    let createdAt = new Date();
    if (order?.timestamp?.toDate) createdAt = order.timestamp.toDate();

    const cookTime = Number(order?.cookTime || 0);
    const dueTime  = new Date(createdAt.getTime() + cookTime * 60000);

    const createdFormatted = createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const dueFormatted     = dueTime.toLocaleTimeString([],   { hour: "2-digit", minute: "2-digit" });

    if (dueTime < now) row.style.backgroundColor = "rgba(255, 0, 0, 0.15)";

    let actionsHTML = "";
    if (order?.status === "open" && order?.type === "addon") {
      actionsHTML = `
        <button onclick='showEditModal(${JSON.stringify(order).replace(/"/g, "&quot;")})'>✏️</button>
        <button onclick="showDeleteModal('${order.id}')">🗑️</button>
      `;
    } else if (order?.status === "sent") {
      actionsHTML = `<button onclick="markOrderReceived('${order.id}', this)">✓ Receive</button>`;
    }

    row.innerHTML = `
      <td data-label="Created">${createdFormatted}</td>
      <td data-label="Due">${dueFormatted}</td>
      <td data-label="Item">${order?.item ?? ""}</td>
      <td data-label="Qty">${order?.qty ?? ""}</td>
      <td data-label="Status">${order?.status ?? ""}</td>
      <td data-label="Actions">${actionsHTML}</td>
    `;
    tbody.appendChild(row);
  }

  // ===== Showware counts (ONLY) =====
  const totalEl  = document.getElementById("gatewayTotalGuests");
  const remainEl = document.getElementById("gatewayRemainingGuests");

  // 1) Try cache first (populated by listener/force call)
  const sw = window.showwareGuests?.Gateway;
  if (sw && Number.isFinite(sw_num(sw.total))) {
    const remaining = Math.max(0, sw_num(sw.total) - sw_num(sw.scanned));
    if (totalEl)  totalEl.textContent  = String(sw_num(sw.total));
    if (remainEl) remainEl.textContent = String(remaining);
    return;
  }

  // 2) If cache not ready, seed once from Firestore and paint — do NOT write zeros
  if (!window._seedShowwareGatewayOnce) {
    window._seedShowwareGatewayOnce = true;
    (async () => {
      try {
        const qLatest = query(
          collection(db, window.SHOWWARE_COLL),
          orderBy("receivedAt", "desc"),
          limit(1)
        );
        const seed = await getDocs(qLatest);
        if (seed.empty) {
          console.warn(`[Gateway] ${window.SHOWWARE_COLL} empty; skipping paint.`);
          return;
        }
        const d  = seed.docs[0].data() || {};
        const gw = extractGatewayCounts(d);

        // cache for rest of app
        window.showwareGuests = window.showwareGuests || {};
        window.showwareGuests.Gateway = gw;

        if (totalEl)  totalEl.textContent  = String(gw.total);
        if (remainEl) remainEl.textContent = String(gw.remaining);
        console.log("[Gateway] Seeded from showwareEvents:", gw);
      } catch (e) {
        console.warn("[Gateway] Failed to seed Showware counts:", e);
      }
    })();
  }
  // If still not ready, leave existing UI values as-is (avoid 0/0 overwrite)
}
// ===================== /Showware (Gateway) — Drop-in =====================


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
// Ensure helper exists once in your bundle
if (typeof computeNetWaste !== "function") {
  window.computeNetWaste = function computeNetWaste(grossQty, panWeight) {
    const pw = Number(panWeight || 0);
    const g  = Number(grossQty || 0);
    const net = g - (pw > 0 ? pw : 0);
    return Math.max(0, Number.isFinite(net) ? net : 0);
  };
}

window.sendSingleGatewayWaste = async function (button, recipeId) {
  const row = button.closest("tr");
  const input = row.querySelector(".waste-input");

  // Normalize math input (handles unblurred "1+1")
  const v = normalizeQtyInputValue(input);
  const grossQty = Number.isFinite(v) ? v : Number(window.gatewayWasteTotals?.[recipeId] || 0);

  if (!Number.isFinite(grossQty) || grossQty <= 0) {
    alert("⚠️ Please enter a valid quantity first.");
    return;
  }

  const recipe = window.gatewayWasteRecipeList.find(r => r.id === recipeId);
  if (!recipe) {
    alert("❌ Recipe not found.");
    return;
  }

  // 🥘 Subtract pan weight; clamp at 0
  const netQty = computeNetWaste(grossQty, recipe.panWeight);
  if (netQty <= 0) {
    alert(`⚠️ Net waste is 0 after subtracting pan weight (${recipe.panWeight || 0}).`);
    return;
  }

  // ✅ Validate AFTER subtraction
  const hasEnough = await checkIfEnoughReceived(recipeId, netQty, "Gateway");
  if (!hasEnough) {
    alert(`🚫 Cannot waste ${netQty} of "${recipe.description}" — more than received today after pan subtraction.`);
    return;
  }

  // 💰 pricing
  const unitCost = await getUnitCostForRecipe(recipe);
  const totalCost = parseFloat((unitCost * netQty).toFixed(2));

  const today = getTodayDate();
  const wasteData = {
    item: recipe.description,
    venue: "Gateway",
    qty: netQty,                    // store NET
    uom: recipe.uom || "ea",
    date: today,
    timestamp: serverTimestamp(),
    // audit
    grossQty,
    panWeightUsed: Number(recipe.panWeight || 0),
    // reporting
    unitCost,
    totalCost,
  };

  try {
    await addDoc(collection(db, "waste"), wasteData);
    console.log(`✅ Sent Gateway waste: gross=${grossQty}, net=${netQty} of ${recipe.description} | $${totalCost}`);

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
    const grossQty = Number.isFinite(v) ? v : Number(window.gatewayWasteTotals?.[recipeId] || 0);
    if (!Number.isFinite(grossQty) || grossQty <= 0) continue;

    const recipe = window.gatewayWasteRecipeList.find(r => r.id === recipeId);
    if (!recipe) {
      console.warn(`⚠️ Gateway recipe not found for ID: ${recipeId}`);
      continue;
    }

    // 🥘 Subtract pan weight; clamp at 0
    const netQty = computeNetWaste(grossQty, recipe.panWeight);
    if (netQty <= 0) {
      console.warn(`⚠️ Net waste is 0 after pan-weight subtraction for ${recipe.description}. Skipping.`);
      continue;
    }

    // ✅ Validate AFTER subtraction
    const hasEnough = await checkIfEnoughReceived(recipeId, netQty, "Gateway");
    if (!hasEnough) {
      alert(`🚫 Cannot waste ${netQty} of "${recipe.description}" — more than received today after pan subtraction.`);
      continue;
    }

    // 💰 pricing
    const unitCost = await getUnitCostForRecipe(recipe);
    const totalCost = parseFloat((unitCost * netQty).toFixed(2));

    const wasteData = {
      item: recipe.description,
      venue: "Gateway",
      qty: netQty,                   // store NET
      uom: recipe.uom || "ea",
      date: today,
      timestamp: serverTimestamp(),
      // audit
      grossQty,
      panWeightUsed: Number(recipe.panWeight || 0),
      // reporting
      unitCost,
      totalCost,
    };

    await addDoc(collection(db, "waste"), wasteData);
    console.log(`✅ Sent Gateway waste: gross=${grossQty}, net=${netQty} of ${recipe.description} | $${totalCost}`);
    sentCount++;

    // Clear UI + cache
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
// 🔁 Gateway Returns — only items RECEIVED TODAY (HST), minus returns already sent/received today
window.loadGatewayReturns = async function () {
  const tableBody = document.querySelector(".gateway-returns-table tbody");
  if (!tableBody) return;
  showTableLoading(tableBody, "Loading Gateway returns…");

  try {
    const todayStr = getTodayDate(); // "YYYY-MM-DD" in HST

    // 1) Get today's RECEIVED Gateway orders
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

    // Build qty totals by recipe key (prefer net figures if present)
    const recipeQtyMap = new Map(); // KEY -> total qty
    const idFromNo     = new Map(); // recipeNo -> doc.id
    ordersSnap.forEach(d => {
      const o = d.data();
      const key = String(o.recipeNo || o.recipeId || "").toUpperCase();
      if (!key) return;

      const recNet  = Number(o.netWeight ?? 0);
      const recSend = Number(o.sendQty   ?? 0);
      const recQty  = Number(o.qty       ?? 0);
      const used = Math.max(
        Number.isFinite(recNet)  ? recNet  : 0,
        Number.isFinite(recSend) ? recSend : 0,
        Number.isFinite(recQty)  ? recQty  : 0
      );
      if (!used) return;

      recipeQtyMap.set(key, (recipeQtyMap.get(key) || 0) + used);
      if (o.recipeNo && o.recipeId) {
        idFromNo.set(String(o.recipeNo).toUpperCase(), String(o.recipeId));
      }
    });

    if (recipeQtyMap.size === 0) {
      showTableEmpty(tableBody, "No valid items to return.");
      return;
    }

    // 2) Returns already made today (subtract; supports partial returns)
    const returnsSnap = await getDocs(query(
      collection(db, "returns"),
      where("venue", "==", "Gateway"),
      where("date", "==", todayStr),
      where("status", "in", ["sent", "returned", "received"])
    ));
    const returnedByKey = new Map();
    returnsSnap.forEach(d => {
      const r = d.data();
      const k = String(r.recipeNo || r.recipeId || "").toUpperCase();
      if (!k) return;
      const q = Number(r.qty ?? r.netQty ?? 0) || 0; // qty is NET in our writer
      returnedByKey.set(k, (returnedByKey.get(k) || 0) + q);
    });

    // 3) Batch-fetch recipe docs by recipeNo (in chunks of 10), fall back to by-ID
    const allKeys   = Array.from(recipeQtyMap.keys());
    const byNoKeys  = [];
    const byIdKeys  = [];
    allKeys.forEach(k => (/^[A-Za-z0-9\-_.]+$/.test(k) ? byNoKeys : byIdKeys).push(k));

    const recipeMeta = new Map(); // KEY -> {id, recipeNo, description, uom, panWeight, returnable}

    // by recipeNo
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
        recipeMeta.set(key, {
          id: docSnap.id,
          recipeNo: data.recipeNo || "",
          description: data.description || key,
          uom: (data.uom || "ea").toLowerCase(),
          panWeight: Number(data.panWeight || 0),
          returnable: String(data.returns || "").toLowerCase() === "yes"
        });
      });
    }

    // by recipeId (direct)
    for (const k of byIdKeys) {
      const ds = await getDoc(doc(db, "recipes", k));
      if (ds.exists()) {
        const data = ds.data();
        recipeMeta.set(k, {
          id: ds.id,
          recipeNo: data.recipeNo || "",
          description: data.description || k,
          uom: (data.uom || "ea").toLowerCase(),
          panWeight: Number(data.panWeight || 0),
          returnable: String(data.returns || "").toLowerCase() === "yes"
        });
      } else {
        // try idFromNo mapping
        const via = idFromNo.get(k);
        if (via) {
          const ds2 = await getDoc(doc(db, "recipes", via));
          if (ds2.exists()) {
            const data = ds2.data();
            recipeMeta.set(k, {
              id: ds2.id,
              recipeNo: data.recipeNo || "",
              description: data.description || k,
              uom: (data.uom || "ea").toLowerCase(),
              panWeight: Number(data.panWeight || 0),
              returnable: String(data.returns || "").toLowerCase() === "yes"
            });
          }
        }
      }
    }

    // 4) Build final list: remaining = received - returnedToday
    const rows = [];
    recipeQtyMap.forEach((qty, key) => {
      const meta = recipeMeta.get(key);
      if (!meta || !meta.returnable) return;

      const already = returnedByKey.get(key) || 0;
      const remaining = Math.max(0, qty - already);
      if (remaining <= 0) return;

      rows.push({
        id: meta.id,
        recipeNo: meta.recipeNo,
        name: meta.description,
        uom: meta.uom,
        panWeight: meta.panWeight,
        qty: remaining
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
      tr.dataset.recipeId  = r.id;
      tr.dataset.uom       = r.uom;
      tr.dataset.panWeight = String(r.panWeight || 0);
      // Example for Gateway row render
tr.innerHTML = `
  <td>${r.name}</td>
  <td>${r.qty} ${r.uom}</td>
  <td>
    <input class="return-input" type="number" min="0" step="0.01"
           placeholder="0" value="" style="width:80px;" />
    ${r.uom === "lb" && r.panWeight > 0
      ? `<div style="font-size:11px;color:#777;">Pan wt: ${r.panWeight}</div>` 
      : ""}
  </td>
  <td><button onclick="sendSingleGatewayReturn(this, '${r.id}')">Return</button></td>
`;

      tableBody.appendChild(tr);
    }

    console.log(`✅ Loaded ${rows.length} Gateway returnable recipes`);
  } catch (err) {
    console.error("❌ Failed to load Gateway returns:", err);
    showTableEmpty(tableBody, "Failed to load. Please retry.");
  }
};


// ➤ Submit a single GATEWAY return (stores NET qty; keeps gross & panWeightUsed for audit)
window.sendSingleGatewayReturn = async function (btn, recipeId) {
  const row = btn.closest("tr");
  const qtyInput = row.querySelector(".return-input");
  const raw = qtyInput?.value ?? "0";

  // Support mini math inputs if you use normalizeQtyInputValue
  let gross = 0;
  try {
    gross = typeof normalizeQtyInputValue === "function"
      ? Number(normalizeQtyInputValue(qtyInput))
      : Number(raw);
  } catch {
    gross = Number(raw);
  }

  if (!Number.isFinite(gross) || gross <= 0) {
    alert("Please enter a valid quantity to return.");
    return;
  }

  const uom = (row.dataset.uom || "ea").toLowerCase();
  const panWeight = Number(row.dataset.panWeight || 0);
  const net = (uom === "lb" && panWeight > 0) ? Math.max(0, gross - panWeight) : gross;

  if (net <= 0) {
    alert(`Net return is 0 after subtracting pan weight (${panWeight}).`);
    return;
  }

  try {
    // Grab a bit of metadata for a nicer record
    const recipeSnap = await getDoc(doc(db, "recipes", recipeId));
    const rd = recipeSnap.exists() ? recipeSnap.data() : {};
    const recipeNo = rd.recipeNo || "";
    const description = rd.description || row.cells?.[0]?.textContent || recipeNo || recipeId;

    await addDoc(collection(db, "returns"), {
      item: description,
      recipeId,
      recipeNo,
      venue: "Gateway",
      date: getTodayDate(),
      uom,
      qty: net,                        // ✅ NET
      grossQty: gross,                 // audit
      panWeightUsed: (uom === "lb" ? panWeight : 0),
      isNet: true,
      status: "returned",              // 👈 Main Kitchen sees it immediately
      timestamp: serverTimestamp(),
      returnedAt: serverTimestamp()
    });

    const cell = btn.parentElement;
    cell.innerHTML = `<span style="color: green;">Returned</span>`;
    setTimeout(() => { row.remove(); }, 800);

    console.log(`↩️ Gateway return: gross=${gross}, net=${net} for ${description} (${recipeId})`);
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

// ======================= Showware (Ohana) — Drop-in =======================
// Uses same collection name as Gateway block
window.SHOWWARE_COLL = window.SHOWWARE_COLL || "showwareEvents";

/* ---- reuse tolerant helpers if present; otherwise define local fallbacks ---- */
const oh_toNum  = (typeof gw_toNum  === "function") ? gw_toNum  : (v => Number.isFinite(Number(v)) ? Number(v) : 0);
const oh_read   = (typeof gw_read   === "function") ? gw_read   : ((obj, path) => {
  if (!obj) return undefined; let cur = obj;
  for (const p of String(path).split(".")) {
    if (cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p];
    else return undefined;
  }
  return cur;
});
const oh_findNum = (typeof gw_findNum === "function") ? gw_findNum : (d, candidates) => {
  const pools = [d, d?.raw, d?.raw?.data, d?.raw?.payload, d?.payload, d?.data, d?.raw?.showware];
  for (const pool of pools) {
    if (!pool) continue;
    for (const key of candidates) {
      const v = oh_read(pool, key);
      if (v != null) return oh_toNum(v);
    }
  }
  return 0;
};

/**
 * Extract tolerant Ohana counts from a Showware doc.
 * Supports multiple containers (top-level, raw.*, raw.payload.*) and key variants.
 */
function extractOhanaCounts(d = {}) {
  const TOTAL_KEYS = [
    "ohanaTotal", "ohanaCount", "ohana",
    "ohana_total", "ohana_count",
    "OhanaTotal", "OhanaCount"
  ];
  const SCANNED_KEYS = [
    "ohanaScanned", "ohanaScan",
    "ohana_scanned", "ohana_scan",
    "OhanaScanned", "OhanaScan"
  ];

  const total   = oh_findNum(d, TOTAL_KEYS);
  const scanned = oh_findNum(d, SCANNED_KEYS);

  return { total, scanned, remaining: Math.max(0, total - scanned) };
}

/** Write Ohana numbers into the DOM (IDs must exist to paint). */
function paintOhanaCounts(oh) {
  if (!oh) return false;

  const totalEl   = document.getElementById("ohanaTotalGuests");
  const remainEl  = document.getElementById("ohanaRemainingGuests");
  const scannedEl = document.getElementById("ohanaScannedGuests"); // optional

  if (totalEl)   totalEl.textContent   = String(oh_toNum(oh.total));
  if (remainEl)  remainEl.textContent  = String(Math.max(0, oh_toNum(oh.remaining)));
  if (scannedEl) scannedEl.textContent = String(Math.max(0, oh_toNum(oh.scanned)));

  return !!(totalEl || remainEl || scannedEl);
}

/* ---- one‑shot fetch of latest Showware doc + cache + DOM paint ---- */
async function forceOhanaCountsOnce() {
  try {
    const qLatest = query(
      collection(db, window.SHOWWARE_COLL),
      orderBy("receivedAt", "desc"),
      limit(1)
    );
    const snap = await getDocs(qLatest);
    if (snap.empty) {
      console.warn(`${window.SHOWWARE_COLL} is empty for Ohana.`);
      return { ok: false, reason: "empty" };
    }

    const d = snap.docs[0].data() || {};

    // optional structural debug (comment out if noisy)
    try {
      const logKeys = (label, obj) => console.log(`🔎 (Ohana) ${label}:`, obj ? Object.keys(obj) : "(none)");
      logKeys("doc keys", d);
      logKeys("raw keys", d?.raw);
      logKeys("raw.data keys", d?.raw?.data);
      logKeys("raw.payload keys", d?.raw?.payload);
    } catch {}

    const oh = extractOhanaCounts(d);
    console.log("📡 forceOhanaCountsOnce() latest doc:", d, "→", oh);

    // cache alongside Gateway cache
    window.showwareGuests = window.showwareGuests || {};
    window.showwareGuests.Ohana = oh;

    // paint if elements exist
    paintOhanaCounts(oh);

    // nudge cost summary if wired
    try {
      typeof updateCostSummaryForVenue === "function" &&
        updateCostSummaryForVenue("Ohana");
    } catch {}

    return { ok: true, data: oh };
  } catch (err) {
    console.error("forceOhanaCountsOnce() failed:", err);
    return { ok: false, reason: "error", err };
  }
}

/** Paint from cache without fetching (e.g., on tab switch). */
function paintOhanaCountsFromCache() {
  const oh = window.showwareGuests?.Ohana;
  if (!oh) return false;
  return paintOhanaCounts(oh);
}

// expose (guard double-assign)
if (!window.forceOhanaCountsOnce)      window.forceOhanaCountsOnce = forceOhanaCountsOnce;
if (!window.paintOhanaCountsFromCache) window.paintOhanaCountsFromCache = paintOhanaCountsFromCache;


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

// If you didn't already add this earlier, keep this helper in your file:
if (typeof computeNetWaste !== "function") {
  window.computeNetWaste = function computeNetWaste(grossQty, panWeight) {
    const pw = Number(panWeight || 0);
    const g  = Number(grossQty || 0);
    const net = g - (pw > 0 ? pw : 0);
    return Math.max(0, Number.isFinite(net) ? net : 0);
  };
}

window.sendSingleOhanaWaste = async function (button, recipeId) {
  const row = button.closest("tr");
  const input = row.querySelector(".waste-input");

  // Normalize last-second (handles unblurred "1+1")
  const v = normalizeQtyInputValue(input);
  const grossQty = Number.isFinite(v) ? v : Number(window.ohanaWasteTotals?.[recipeId] || 0);

  if (!Number.isFinite(grossQty) || grossQty <= 0) {
    alert("Please enter a valid quantity first.");
    return;
  }

  const recipe = window.ohanaWasteRecipeList.find(r => r.id === recipeId);
  if (!recipe) {
    alert("❌ Recipe not found.");
    return;
  }

  // 🥘 Subtract pan weight, clamp at 0
  const netQty = computeNetWaste(grossQty, recipe.panWeight);
  if (netQty <= 0) {
    alert(`⚠️ Net waste is 0 after subtracting pan weight (${recipe.panWeight || 0}).`);
    return;
  }

  // ✅ Validate AFTER subtraction against today's received
  const hasEnough = await checkIfEnoughReceived(recipeId, netQty, "Ohana");
  if (!hasEnough) {
    alert(`🚫 Cannot waste ${netQty} of "${recipe.description}" — more than received today after pan subtraction.`);
    return;
  }

  // 💰 pricing
  const unitCost = await getUnitCostForRecipe(recipe);
  const totalCost = parseFloat((unitCost * netQty).toFixed(2));

  const today = getTodayDate();
  const wasteData = {
    item: recipe.description,
    venue: "Ohana",
    qty: netQty,                     // store NET amount
    uom: recipe.uom || "ea",
    date: today,
    timestamp: serverTimestamp(),
    // audit
    grossQty,
    panWeightUsed: Number(recipe.panWeight || 0),
    // reporting
    unitCost,
    totalCost
  };

  await addDoc(collection(db, "waste"), wasteData);
  console.log(`✅ Sent Ohana waste: gross=${grossQty}, net=${netQty} of ${recipe.description} | $${totalCost}`);

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
    const grossQty = Number.isFinite(v) ? v : Number(window.ohanaWasteTotals?.[recipeId] || 0);
    if (!Number.isFinite(grossQty) || grossQty <= 0) continue;

    const recipe = window.ohanaWasteRecipeList.find(r => r.id === recipeId);
    if (!recipe) {
      console.warn(`⚠️ Ohana recipe not found for ID: ${recipeId}`);
      continue;
    }

    // 🥘 Subtract pan weight, clamp at 0
    const netQty = computeNetWaste(grossQty, recipe.panWeight);
    if (netQty <= 0) {
      console.warn(`⚠️ Net waste is 0 after pan-weight subtraction for ${recipe.description}. Skipping.`);
      continue;
    }

    // ✅ Validate AFTER subtraction
    const hasEnough = await checkIfEnoughReceived(recipeId, netQty, "Ohana");
    if (!hasEnough) {
      alert(`🚫 Cannot waste ${netQty} of "${recipe.description}" — more than received today after pan subtraction.`);
      continue;
    }

    // 💰 pricing
    const unitCost = await getUnitCostForRecipe(recipe);
    const totalCost = parseFloat((unitCost * netQty).toFixed(2));

    const wasteData = {
      item: recipe.description,
      venue: "Ohana",
      qty: netQty,                    // store NET amount
      uom: recipe.uom || "ea",
      date: today,
      timestamp: serverTimestamp(),
      // audit
      grossQty,
      panWeightUsed: Number(recipe.panWeight || 0),
      // reporting
      unitCost,
      totalCost
    };

    await addDoc(collection(db, "waste"), wasteData);
    console.log(`✅ Sent Ohana waste: gross=${grossQty}, net=${netQty} of ${recipe.description} | $${totalCost}`);
    sentCount++;

    // Clear UI + cache
    input.value = "";
    window.ohanaWasteTotals[recipeId] = "";
  }

  if (sentCount > 0) {
    alert(`✅ ${sentCount} Ohana waste entr${sentCount === 1 ? "y" : "ies"} sent.`);
  } else {
    alert("⚠️ No Ohana waste entries with valid quantities.");
  }
};

// 🔎 Robust recipe resolver with memoization & multi-key lookup
// Accepts either a Firestore doc id (e.g., "r0180") or a recipeNo (e.g., "R0180")
window.__recipeCoreCache = window.__recipeCoreCache || new Map();

async function _getRecipeCore(recipeKey) {
  try {
    const keyStr = String(recipeKey || "").trim();
    if (!keyStr) return _mkFallback("", "empty-key");

    // ---- Memoized? ----
    if (window.__recipeCoreCache.has(keyStr)) return window.__recipeCoreCache.get(keyStr);

    const normId = keyStr.toLowerCase();
    const normNo = keyStr.toUpperCase();

    // Heuristic: looks like a recipeNo if it starts with a letter and digits (e.g., R0331)
    const looksLikeRecipeNo = /^[A-Za-z]\d{3,5}$/.test(normNo);

    // ---- 1) In-memory lists (fast path) by id or recipeNo ----
    const lists = [
      window.alohaWasteRecipeList,
      window.gatewayWasteRecipeList,
      window.ohanaWasteRecipeList,
      window.cachedAlohaWasteRecipes,
      window.cachedGatewayWasteRecipes,
      window.cachedOhanaWasteRecipes
    ].filter(Boolean);

    for (const list of lists) {
      const hit = list.find(r => {
        const rid = String(r.id || "").toLowerCase();
        const rno = String(r.recipeNo || r.recipe_no || "").toUpperCase();
        return rid === normId || (looksLikeRecipeNo && rno === normNo);
      });
      if (hit) {
        const out = _mkFromData(hit, hit.id || normId, "cache");
        window.__recipeCoreCache.set(keyStr, out);
        return out;
      }
    }

    // ---- 2) Firestore by doc id ----
    if (typeof getDoc === "function" && typeof doc === "function") {
      const byIdSnap = await getDoc(doc(db, "recipes", normId));
      if (byIdSnap.exists()) {
        const out = _mkFromData(byIdSnap.data(), byIdSnap.id, "docId");
        window.__recipeCoreCache.set(keyStr, out);
        return out;
      }
    }

    // ---- 3) Firestore by recipeNo (and legacy recipe_no) ----
    if (looksLikeRecipeNo && typeof getDocs === "function" && typeof query === "function" && typeof where === "function" && typeof collection === "function") {
      // Try recipeNo == normNo
      let got = null;

      // Primary field
      const q1 = query(collection(db, "recipes"), where("recipeNo", "==", normNo));
      const s1 = await getDocs(q1);
      if (!s1.empty) {
        const d = s1.docs[0];
        got = _mkFromData(d.data(), d.id, "recipeNo");
      } else {
        // Legacy field name
        const q2 = query(collection(db, "recipes"), where("recipe_no", "==", normNo));
        const s2 = await getDocs(q2);
        if (!s2.empty) {
          const d = s2.docs[0];
          got = _mkFromData(d.data(), d.id, "recipe_no");
        }
      }

      if (got) {
        window.__recipeCoreCache.set(keyStr, got);
        return got;
      }
    }

    // ---- Fallback ----
    const fb = _mkFallback(normId, "not-found");
    window.__recipeCoreCache.set(keyStr, fb);
    return fb;
  } catch (err) {
    console.warn("_getRecipeCore error:", err);
    return _mkFallback(String(recipeKey || ""), "error");
  }

  // ------- helpers -------
  function _mkFromData(d, docId, source) {
    // normalize fields
    const recipeNo = String(d?.recipeNo || d?.recipe_no || "").toUpperCase();
    const description = String(d?.description || d?.item || recipeNo || docId || "");
    const panWeight = Number(d?.panWeight || 0);
    const uom = String(d?.uom || "ea").toLowerCase();
    const cost = Number(d?.cost || 0);
    const returns = String(d?.returns || "").toLowerCase() === "yes";
    const station = String(d?.station || "");
    const category = String(d?.category || "");
    const venueCodes = Array.isArray(d?.venueCodes) ? d.venueCodes.slice() : [];

    return {
      id: docId,            // Firestore doc id
      recipeId: docId,      // alias (handy in some callers)
      recipeNo,             // e.g., "R0331"
      description,          // human name
      panWeight,            // lbs to subtract if uom === "lb"
      uom,                  // "lb", "ea", etc.
      cost,                 // unit cost if present
      returns,              // true if "Yes"
      station,
      category,
      venueCodes,           // e.g., ["b001", "b002"]
      source                // "cache" | "docId" | "recipeNo" | "recipe_no" | "not-found" | "error"
    };
  }

  function _mkFallback(docId, source) {
    return {
      id: docId,
      recipeId: docId,
      recipeNo: "",
      description: "",
      panWeight: 0,
      uom: "",
      cost: 0,
      returns: false,
      station: "",
      category: "",
      venueCodes: [],
      source
    };
  }
}


// ---- Config: set to true if you want to overwrite orders.qty (and totalCost) on return
const OVERWRITE_QTY_ON_RETURN = true;

// Apply a RECEIVED return to today's matching orders (FIFO by sentAt)
// - Increments per-order returnedNet
// - Always writes qtyNet = originalQty - returnedNet
// - If OVERWRITE_QTY_ON_RETURN === true, also overwrites qty (and totalCost if cost present)
async function applyReceivedReturnToOrders(returnDoc) {
  const r = returnDoc.data();
  const todayStr = r.date;
  const venue    = r.venue;
  const recipeId = r.recipeId;
  let remaining  = Number(r.qty || 0);

  if (!todayStr || !venue || !recipeId || !(remaining > 0)) {
    console.warn("applyReceivedReturnToOrders: missing fields or zero qty", r);
    return;
  }

  // Pull today's RECEIVED orders for this recipe/venue
  const qSnap = await getDocs(query(
    collection(db, "orders"),
    where("date", "==", todayStr),
    where("venue", "==", venue),
    where("recipeId", "==", recipeId),
    where("status", "==", "received")
  ));
  if (qSnap.empty) {
    console.warn("applyReceivedReturnToOrders: no matching received orders found", r);
    return;
  }

  // FIFO by sentAt (fallback to timestamp)
  const orders = qSnap.docs
    .map(d => ({ ref: d.ref, data: d.data() }))
    .sort((a, b) => {
      const ta = (a.data.sentAt?.toMillis?.() || a.data.timestamp?.toMillis?.() || 0);
      const tb = (b.data.sentAt?.toMillis?.() || b.data.timestamp?.toMillis?.() || 0);
      return ta - tb;
    });

  for (const { ref, data: o } of orders) {
    if (remaining <= 0) break;

    // pick the original "sent qty" baseline once; prefer your existing fields
    const originalQty = Number(
      Number.isFinite(o.qtyNet) && o._baselineLocked   // if you've locked a baseline before
        ? o._originalQty
        : (o.qty ?? o.netWeight ?? o.sendQty ?? 0)
    ) || 0;

    const alreadyReturned = Number(o.returnedNet || 0);
    const available = Math.max(0, originalQty - alreadyReturned);
    if (available <= 0) continue;

    const take = Math.min(available, remaining);
    const newReturned = alreadyReturned + take;
    const qtyNet = Math.max(0, originalQty - newReturned);

    const unitCost = Number(o.cost || 0);
    const updates = {
      // track cumulative return and a stable “net” field
      returnedNet: newReturned,
      qtyNet: qtyNet,
      // remember the original baseline so we don't double-shrink on subsequent passes
      _originalQty: originalQty,
      _baselineLocked: true
    };

    if (OVERWRITE_QTY_ON_RETURN) {
      updates.qty = qtyNet; // ✅ overwrite the visible qty
      if (unitCost > 0) updates.totalCost = +(qtyNet * unitCost).toFixed(2);
    } else {
      if (unitCost > 0) updates.totalCostNet = +(qtyNet * unitCost).toFixed(2);
    }

    await updateDoc(ref, updates);
    remaining -= take;
  }

  if (remaining > 1e-6) {
    console.warn(`applyReceivedReturnToOrders: ${remaining} unallocated (all orders consumed).`);
  }
}



//OHANA RETURNS
// 🔁 Ohana Returns — only items RECEIVED TODAY (HST), minus returns already sent/received today
// Keeps your loading/empty states helpers.
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

    // Sum qty by recipe key (prefer netWeight/qty/sendQty)
    const qtyByKey = new Map(); // KEY = recipeNo or recipeId (upper)
    const idFromNo = new Map(); // recipeNo -> recipeId
    ordersSnap.forEach(d => {
      const o = d.data();
      const key = String(o.recipeNo || o.recipeId || "").toUpperCase();
      if (!key) return;
      const recNet  = Number(o.netWeight ?? 0);
      const recSend = Number(o.sendQty   ?? 0);
      const recQty  = Number(o.qty       ?? 0);
      const used = Math.max(
        Number.isFinite(recNet)  ? recNet  : 0,
        Number.isFinite(recSend) ? recSend : 0,
        Number.isFinite(recQty)  ? recQty  : 0
      );
      if (!used) return;
      qtyByKey.set(key, (qtyByKey.get(key) || 0) + used);
      if (o.recipeNo && o.recipeId) idFromNo.set(String(o.recipeNo).toUpperCase(), String(o.recipeId));
    });

    if (qtyByKey.size === 0) {
      showTableEmpty(tableBody, "No valid items to return.");
      return;
    }

    // 2) Returns already made today (exclude or subtract)
    // We subtract qty so multiple partial returns are supported.
    const returnsSnap = await getDocs(query(
      collection(db, "returns"),
      where("venue", "==", "Ohana"),
      where("date", "==", todayStr),
      where("status", "in", ["sent", "received"])
    ));
    const returnedByKey = new Map(); // KEY = recipeNo or recipeId (upper)
    returnsSnap.forEach(d => {
      const r = d.data();
      const k = String(r.recipeNo || r.recipeId || "").toUpperCase();
      if (!k) return;
      const q = Number(r.qty ?? r.netQty ?? 0) || 0; // qty is NET in our writer
      returnedByKey.set(k, (returnedByKey.get(k) || 0) + q);
    });

    // 3) Resolve recipe metadata (uom, description, panWeight, returnable)
    const keys = Array.from(qtyByKey.keys());
    const byNo = [], byId = [];
    keys.forEach(k => (/^[A-Za-z0-9\-_.]+$/.test(k) ? byNo : byId).push(k));

    const metaByKey = new Map();

    // Lookup by recipeNo (batch in chunks of 10 for 'in' operator)
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
        metaByKey.set(key, {
          id: docSnap.id,
          recipeNo: data.recipeNo || "",
          description: data.description || key,
          uom: (data.uom || "ea").toLowerCase(),
          panWeight: Number(data.panWeight || 0),
          returnable: String(data.returns || "").toLowerCase() === "yes"
        });
      });
    }

    // Lookup by recipeId (direct)
    for (const k of byId) {
      const ds = await getDoc(doc(db, "recipes", k));
      if (ds.exists()) {
        const data = ds.data();
        metaByKey.set(k, {
          id: ds.id,
          recipeNo: data.recipeNo || "",
          description: data.description || k,
          uom: (data.uom || "ea").toLowerCase(),
          panWeight: Number(data.panWeight || 0),
          returnable: String(data.returns || "").toLowerCase() === "yes"
        });
      } else {
        // Try mapping via recipeNo -> recipeId if present
        const via = idFromNo.get(k);
        if (via) {
          const ds2 = await getDoc(doc(db, "recipes", via));
          if (ds2.exists()) {
            const data = ds2.data();
            metaByKey.set(k, {
              id: ds2.id,
              recipeNo: data.recipeNo || "",
              description: data.description || k,
              uom: (data.uom || "ea").toLowerCase(),
              panWeight: Number(data.panWeight || 0),
              returnable: String(data.returns || "").toLowerCase() === "yes"
            });
          }
        }
      }
    }

    // 4) Build rows: remaining = received - returnedToday
    const rows = [];
    qtyByKey.forEach((receivedQty, key) => {
      const m = metaByKey.get(key);
      if (!m || !m.returnable) return;

      const already = returnedByKey.get(key) || 0;
      const remaining = Math.max(0, receivedQty - already);
      if (remaining <= 0) return;

      rows.push({ id: m.id, recipeNo: m.recipeNo, name: m.description, uom: m.uom, panWeight: m.panWeight, qty: remaining });
    });

    if (rows.length === 0) {
      showTableEmpty(tableBody, "No returnable Ohana items remaining for today.");
      return;
    }

    // 5) Render table
    tableBody.innerHTML = "";
    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.dataset.recipeId = r.id;
      tr.dataset.uom = r.uom;
      tr.dataset.panWeight = String(r.panWeight || 0);
     tr.innerHTML = `
  <td>${r.name}</td>
  <td>${r.qty} ${r.uom}</td>
  <td>
    <input class="return-input" type="number" min="0" step="0.01" 
           placeholder="0" value="" style="width:80px;" />
    ${r.uom === "lb" && r.panWeight > 0 
      ? `<div style="font-size:11px;color:#777;">Pan wt: ${r.panWeight}</div>` 
      : ""}
  </td>
  <td><button onclick="sendSingleOhanaReturn(this, '${r.id}')">Return</button></td>
`;

      tableBody.appendChild(tr);
    }
  } catch (err) {
    console.error("❌ Failed to load Ohana returns:", err);
    showTableEmpty(tableBody, "Failed to load. Please retry.");
  }
};

// ➤ Submit a single OHANA return (stores NET qty, keeps gross & panWeightUsed for audit)
//    Status starts as "sent". Accounting only deducts once Main marks it "received".
// ➤ Submit a single OHANA return (writes minimal schema Main Kitchen expects)
window.sendSingleOhanaReturn = async function (btn, recipeId) {
  const row = btn.closest("tr");
  const qtyInput = row.querySelector(".return-input");
  const raw = qtyInput?.value ?? "0";

  // If you have normalizeQtyInputValue, use it; else Number(raw)
  let gross = 0;
  try {
    gross = typeof normalizeQtyInputValue === "function"
      ? Number(normalizeQtyInputValue(qtyInput))
      : Number(raw);
  } catch {
    gross = Number(raw);
  }

  if (!Number.isFinite(gross) || gross <= 0) {
    alert("Please enter a valid quantity to return.");
    return;
  }

  // subtract pan weight if UOM is lb
  const uom = (row.dataset.uom || "ea").toLowerCase();
  const panWeight = Number(row.dataset.panWeight || 0);
  const net = (uom === "lb" && panWeight > 0) ? Math.max(0, gross - panWeight) : gross;

  if (net <= 0) {
    alert(`Net return is 0 after subtracting pan weight (${panWeight}).`);
    return;
  }

  try {
    await addDoc(collection(db, "returns"), {
      // 🔑 minimal fields you showed in your collection
      date: getTodayDate(),            // "YYYY-MM-DD"
      qty: net,                        // store NET so accounting is correct
      recipeId: recipeId,
      venue: "Ohana",
      status: "returned",              // 👈 Main Kitchen listener expects this
      returnedAt: serverTimestamp(),   // when Ohana sent the return

      // (Optional audit fields — safe to keep; ignore if you prefer minimal)
      grossQty: gross,
      panWeightUsed: (uom === "lb" ? panWeight : 0),
    });

    // UI feedback
    btn.parentElement.innerHTML = `<span style="color: green;">Returned</span>`;
    setTimeout(() => row.remove(), 800);
  } catch (err) {
    console.error("Error submitting return:", err);
    alert("Error submitting return. Please try again.");
  }
};



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



// === Sync Production Shipment override → today's orders doc(s) ===
async function syncProdOverrideIntoOrders(venueCode, recipeNo, newQty) {
  try {
    const today = getTodayDate(); // already defined in your file
    const qty   = Number(newQty);
    if (!Number.isFinite(qty)) return;

    // Map "b001/b002/b003/..." → "Aloha/Ohana/Gateway/..."
    function codeToVenueName(code) {
      const map = window.venueCodes || { Aloha: "B001", Ohana: "B002", Gateway: "B003" };
      const found = Object.entries(map).find(([, v]) => String(v).toLowerCase() === String(code).toLowerCase());
      return found ? found[0] : code; // fallback to the code if unknown
    }
    const venueName = codeToVenueName(venueCode); // e.g., "Gateway"

    // 1) Find today's starting-par orders for this venue+recipe
    const q1 = query(
      collection(db, "orders"),
      where("date", "==", today),
      where("venue", "==", venueName),
      where("type", "==", "starting-par"),
      where("recipeNo", "==", String(recipeNo).toUpperCase())
    );
    const snap = await getDocs(q1);

    // (Optional) pull unit cost for totalCost recompute
    async function getUnitCostByOrderDoc(o) {
      // Try `recipeId` first (your docs have r0002/r0331 etc)
      const rid = (o.recipeId || "").toString().trim();
      if (rid) {
        const rs = await getDoc(doc(db, "recipes", rid));
        if (rs.exists()) return Number(rs.data()?.cost || 0);
      }
      // Fallback: lookup by recipeNo
      const qR = query(collection(db, "recipes"), where("recipeNo", "==", String(recipeNo).toUpperCase()));
      const sR = await getDocs(qR);
      if (!sR.empty) return Number(sR.docs[0].data()?.cost || 0);
      return 0;
    }

    if (!snap.empty) {
      // If multiple docs exist (e.g., multiple sends), update them all,
      // so the *sum* reflects your override. If you'd rather only update the latest,
      // sort by timestamp and only update the last one.
      const writes = [];
      for (const docSnap of snap.docs) {
        const o = docSnap.data();

        // Decide which numeric field to override:
        // - Your example shows `qty` (weight) and `pans` (containers).
        // - Here we override `qty` and `sendQty` to the typed amount.
        //   (If you want to override `pans` instead, switch the fields.)
        const unitCost = await getUnitCostByOrderDoc(o);
        const totalCost = unitCost > 0 ? Number((unitCost * qty).toFixed(2)) : undefined;

        writes.push(updateDoc(docSnap.ref, {
          qty: qty,
          sendQty: qty,
          ...(totalCost != null ? { totalCost } : {}),
          updatedAt: serverTimestamp()
        }));
      }
      await Promise.all(writes);
    } else {
      // No existing doc for that recipe today → upsert one so reporting stays consistent.
      // (If you don't want this behavior, remove this block.)
      const qR = query(collection(db, "recipes"), where("recipeNo", "==", String(recipeNo).toUpperCase()));
      const sR = await getDocs(qR);
      const recipeData = sR.empty ? {} : sR.docs[0].data();

      const unitCost  = Number(recipeData.cost || 0);
      const totalCost = unitCost > 0 ? Number((unitCost * qty).toFixed(2)) : 0;

      await addDoc(collection(db, "orders"), {
        date: today,
        venue: venueName,
        type: "starting-par",
        status: "sent",                    // treat as already sent so it rolls into cost
        timestamp: serverTimestamp(),
        sentAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        recipeNo: String(recipeNo).toUpperCase(),
        recipeId: recipeData?.id || (recipeData?.recipeId || null),
        item: recipeData?.description || recipeNo,
        // Quantities we’re choosing to override:
        qty: qty,
        sendQty: qty,
        // If you prefer to override pans instead, add:  pans: qty,
        totalCost
      });
    }
  } catch (err) {
    console.error("syncProdOverrideIntoOrders failed:", err);
  }
}


// 📤 Show one venue shipment (aggregated by recipe for the venue code)
// 🔄 UPDATED: friendlier typing + reliable Firestore saves
window.loadVenueShipment = async function (venueCode) {
  window.currentVenueCode = venueCode;

  // ---- ensure helpers exist (safe no-ops if you already defined them elsewhere)
  window.saveProdShipmentOverride = window.saveProdShipmentOverride || (async function(venueCode, recipeNo, qty){
    try {
      const today = (typeof getTodayDate === "function") ? getTodayDate() : new Date().toISOString().slice(0,10);
      const id = `${today}__${String(venueCode).toLowerCase()}__${String(recipeNo).toUpperCase()}`;
      const ref = doc(db, "productionShipmentOverrides", id);
      await setDoc(ref, {
        date: today,
        venueCode: String(venueCode).toLowerCase(),
        recipeNo: String(recipeNo).toUpperCase(),
        qty: Number(qty) || 0,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      // console.log("💾 saved override", id, qty);
    } catch (err) {
      console.error("saveProdShipmentOverride failed:", err);
    }
  });

  window.preloadProdShipmentOverridesForVenue = window.preloadProdShipmentOverridesForVenue || (async function(vCode){
    window.accountingQtyOverrides = window.accountingQtyOverrides || {};
    window.accountingQtyOverrides.productionShipments = window.accountingQtyOverrides.productionShipments || new Map();

    const today = (typeof getTodayDate === "function") ? getTodayDate() : new Date().toISOString().slice(0,10);
    const snap = await getDocs(query(
      collection(db, "productionShipmentOverrides"),
      where("date", "==", today),
      where("venueCode", "==", String(vCode).toLowerCase())
    ));

    snap.forEach(d => {
      const data = d.data() || {};
      const recipeNo = String(data.recipeNo || "").toUpperCase();
      const key = `${String(vCode)}__${recipeNo}`;
      const v = Number(data.qty);
      if (Number.isFinite(v)) {
        window.accountingQtyOverrides.productionShipments.set(key, v);
      }
    });
  });

  // ---- mount point
  const container = document.getElementById("singleVenueShipmentContainer");
  container.innerHTML = "";

  // ⏬ bring in any saved overrides for today for this venue (so inputs show persisted values)
  try { await window.preloadProdShipmentOverridesForVenue(venueCode); } catch (e) { console.debug(e); }

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
    // 🧯 de-dupe handlers so we don’t stack them
    if (body._onProdInput)   body.removeEventListener("input", body._onProdInput);
    if (body._onProdBlur)    body.removeEventListener("blur", body._onProdBlur, true);
    if (body._onProdKeydown) body.removeEventListener("keydown", body._onProdKeydown, true);

    // Debounce bucket for Firestore writes
    window._prodSaveTimers = window._prodSaveTimers || {};

    // 1) as you type: keep it light (no normalization), just update in-memory cache so UI elsewhere can read it
    body._onProdInput = (e) => {
      const el = e.target;
      if (!el.classList?.contains("acct-qty-input")) return;
      // do NOT coerce mid-typing; just stash string → better UX
      if (!window.accountingQtyOverrides) window.accountingQtyOverrides = {};
      if (!window.accountingQtyOverrides.productionShipments) window.accountingQtyOverrides.productionShipments = new Map();
      window.accountingQtyOverrides.productionShipments.set(el.dataset.key, el.value);
    };
    body.addEventListener("input", body._onProdInput);

    // 2) on Enter: normalize and persist
    body._onProdKeydown = (e) => {
      const el = e.target;
      if (!(el?.classList?.contains("acct-qty-input"))) return;
      if (e.key !== "Enter") return;

      e.preventDefault();
      // normalize (supports "1+1", "2*3", etc. if your helpers exist)
      const v = (typeof normalizeQtyInputValue === "function")
        ? normalizeQtyInputValue(el)
        : Number(el.value);

      if (!Number.isFinite(v)) return;

      const [vCode, recipeNo] = String(el.dataset.key || "").split("__");
      if (!vCode || !recipeNo) return;
// inside body._onProdKeydown (on Enter) AND body._onProdBlur (on blur)
// ...after you computed `v` (the numeric value) and parsed:  const [vCode, recipeNo] = el.dataset.key.split("__");

const tKey = `prod__${el.dataset.key}`;
clearTimeout(window._prodSaveTimers[tKey]);
window._prodSaveTimers[tKey] = setTimeout(async () => {
  try {
    await window.saveProdShipmentOverride(vCode, recipeNo, v);   // keep your small overrides collection
    await syncProdOverrideIntoOrders(vCode, recipeNo, v);        // ← NEW: push into orders
  } catch (e) {
    console.error("persist override + sync orders failed:", e);
  }
}, 200);


      // keep focus & selection for quick repeated edits
      el.select?.();
    };
    body.addEventListener("keydown", body._onProdKeydown, true);

    // 3) on blur: also normalize and persist (covers mouse/tap away)
    body._onProdBlur = (e) => {
      const el = e.target;
      if (!el.classList?.contains("acct-qty-input")) return;

      const v = (typeof normalizeQtyInputValue === "function")
        ? normalizeQtyInputValue(el)
        : Number(el.value);

      if (!Number.isFinite(v)) return;

      const [vCode, recipeNo] = String(el.dataset.key || "").split("__");
      if (!vCode || !recipeNo) return;

      const tKey = `prod__${el.dataset.key}`;
      clearTimeout(window._prodSaveTimers[tKey]);
      window._prodSaveTimers[tKey] = setTimeout(() => {
        window.saveProdShipmentOverride(vCode, recipeNo, v);
      }, 200);
    };
    body.addEventListener("blur", body._onProdBlur, true);

    // ---- rows
    keys.forEach(displayKey => {
      const { recipeNo, description, quantity } = rows[displayKey];

      // stable override key per venue+recipe
      const overrideKey = `${venueCode}__${recipeNo}`;

      // Show persisted override if available; else live typed value; else fallback quantity
      const persisted = window.accountingQtyOverrides?.productionShipments?.get(overrideKey);
      const fallbackVal = Number(quantity) || 0;
      const initial =
        persisted != null && persisted !== "" ? persisted :
        (typeof getAcctQty === "function" ? getAcctQty("productionShipments", overrideKey, fallbackVal) : fallbackVal);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${recipeNo}</td>
        <td>${description}</td>
        <td>
          <input
            type="text"
            inputmode="decimal"
            class="acct-qty-input"
            data-tab="productionShipments"
            data-key="${overrideKey}"
            value="${initial}"
            style="width: 90px; text-align:right;"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
          />
        </td>
      `;
      body.appendChild(tr);
    });

    // Optional: enable math helpers globally for these inputs (no harm if fn missing)
    try { typeof enableMathOnInputs === "function" && enableMathOnInputs(".acct-qty-input", body); } catch {}
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
    empty.innerHTML = `<td colspan="4" style="text-align:center; font-style:italic; color:gray;">No waste entries for today</td>`;
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

    // Skip non-data rows (e.g., "No waste entries" which has a single colspan cell)
    if (cells.length < 4) return;

    const date = cells[0]?.innerText.trim() ?? "";
    const code = cells[1]?.innerText.trim() ?? "";
    const description = cells[2]?.innerText.trim() ?? "";

    // Read the input value if present, otherwise the cell text
    const qtyInput = cells[3]?.querySelector("input");
    const qty = qtyInput ? qtyInput.value : (cells[3]?.innerText.trim() ?? "");

    tsv += [date, code, description, qty].join("\t") + "\n";
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

  // 💰 pricing (assumes recipes; ingredients default to 0 unless you want otherwise)
  const isRecipe  = (item?.type === "recipe" || item?.kind === "recipe");
  const unitCost  = isRecipe ? await getUnitCostForRecipe({ description: item.name, cost: item.cost }) : 0;
  const totalCost = parseFloat((unitCost * qty).toFixed(2));

  const lunchData = {
    item: item.name,
    venue: "Main Kitchen",
    qty,
    uom: item.uom || "ea",
    date: today,
    timestamp: serverTimestamp(),
    // reporting
    unitCost,
    totalCost
  };

  await addDoc(collection(db, "lunch"), lunchData);
  console.log(`✅ Sent lunch: ${qty} of ${item.name} | $${totalCost}`);

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

      // 💰 pricing
      const isRecipe  = (item?.type === "recipe" || item?.kind === "recipe");
      const unitCost  = isRecipe ? await getUnitCostForRecipe({ description: item.name, cost: item.cost }) : 0;
      const totalCost = parseFloat((unitCost * qty).toFixed(2));

      const lunchData = {
        item: item.name,
        venue: "Main Kitchen",
        qty,
        uom: item.uom || "ea",
        date: today,
        timestamp: serverTimestamp(),
        // reporting
        unitCost,
        totalCost
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
