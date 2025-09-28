import {
  db,
  auth,
  functions, 
  storage,
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
  deleteDoc,
  arrayUnion,
  arrayRemove,
  increment,
  runTransaction,   // ⬅️ add this line
} from "./firebaseConfig.js";



window.startingCache = {};

const VENUE_CLASS_MAP = {
  aloha: "venue-aloha",
  ohana: "venue-ohana",
  gateway: "venue-gateway",
  concessions: "venue-concessions",
  concession: "venue-concessions",
  "main kitchen": "venue-main",
  main: "venue-main"
};

// Canonical display names so data saved as "Aloha" still matches rows rendered as "Aloha"
const VENUE_CANONICAL_MAP = {
  aloha: "Aloha",
  "aloha buffet": "Aloha",
  ohana: "Ohana",
  "ohana buffet": "Ohana",
  gateway: "Gateway",
  "gateway kitchen": "Gateway",
  concessions: "Concessions",
  concession: "Concessions",
  "concession stand": "Concessions",
  "main kitchen": "Main Kitchen",
  main: "Main Kitchen"
};

function canonicalizeVenueName(rawVenue) {
  const key = typeof rawVenue === "string" ? rawVenue.trim().toLowerCase() : "";
  if (!key) return "";
  return VENUE_CANONICAL_MAP[key] || rawVenue.toString().trim();
}

function getVenueClassName(venue) {
  const key = typeof venue === "string" ? venue.trim().toLowerCase() : "";
  return VENUE_CLASS_MAP[key] || "venue-default";
}

function decorateVenueRow(row, venue) {
  if (!row) return;
  row.classList.add("venue-row");
  row.classList.add(getVenueClassName(venue));
  row.dataset.venue = venue || "";
}

window.applyCategoryFilter = applyCategoryFilter; // ✅ expose it to window

// Set currentVenue on load
const viewSelect = document.getElementById("viewSelect");

// === Collection config ===
const RECIPES_COLL = "cookingrecipes";   // new home
const LEGACY_RECIPES_COLL = "recipes";   // old (read-only fallback)

// Live version control (auto-refresh)
const APP_VERSION_COLLECTION = "appMeta";
const APP_VERSION_DOC_ID = "version";

const CURRENT_BUILD_ID = (() => {
  const globalHint = typeof window !== "undefined" ? (window.__APP_BUILD_ID || window.APP_BUILD_ID) : "";
  if (globalHint && typeof globalHint === "string") return globalHint;
  const meta = typeof document !== "undefined"
    ? document.querySelector('meta[name="app-build-id"], meta[name="build-id"]')
    : null;
  if (meta?.content) return meta.content;
  return "dev-local"; // fallback when running locally with no build marker
})();
window.APP_CURRENT_BUILD = CURRENT_BUILD_ID;

// Small helpers so we don't sprinkle string literals everywhere
const recipesCollection = () => collection(db, RECIPES_COLL);
const legacyRecipesCollection = () => collection(db, LEGACY_RECIPES_COLL);
const recipeDoc = (id) => doc(db, RECIPES_COLL, id);
const legacyRecipeDoc = (id) => doc(db, LEGACY_RECIPES_COLL, id);
const appVersionDoc = () => doc(db, APP_VERSION_COLLECTION, APP_VERSION_DOC_ID);

window._appVersionUnsub = null;

function startAppVersionWatcher() {
  if (typeof onSnapshot !== "function") return;
  if (startAppVersionWatcher._started) return;
  startAppVersionWatcher._started = true;

  try { window._appVersionUnsub?.(); } catch {}

  const ref = appVersionDoc();
  let current = window.APP_CURRENT_BUILD || CURRENT_BUILD_ID;
  let hasRealBuild = current && current !== "dev-local";

  window._appVersionUnsub = onSnapshot(ref, (snap) => {
    if (!snap?.exists?.()) return;
    const data = snap.data() || {};
    const remote = [data.buildId, data.version, data.tag, data.commit, data.hash]
      .find((val) => typeof val === "string" && val.trim().length > 0) || "";
    if (!remote) return;

    if (!hasRealBuild && (!current || current === "dev-local")) {
      current = remote; // adopt first value during local dev so we don't thrash reloads
      window.APP_CURRENT_BUILD = current;
      hasRealBuild = true;
      return;
    }

    if (remote === current) return;
    if (window.__APP_VERSION_RELOAD_PENDING) return;

    window.__APP_VERSION_RELOAD_PENDING = true;
    const previous = current;
    window.APP_NEXT_BUILD = remote;
    window.APP_CURRENT_BUILD = remote;
    current = remote;

    const delayValue = Number(data.autoReloadDelayMs);
    const delay = Number.isFinite(delayValue) ? delayValue : 2000;
    console.info(`New app build detected (${remote} ← ${previous}). Reloading…`);
    setTimeout(() => {
      try {
        window.location.reload(true);
      } catch (err) {
        console.debug("Hard reload failed, falling back to soft reload", err);
        window.location.reload();
      }
    }, Math.max(0, delay));
  }, (err) => {
    console.warn("App version watcher error", err);
  });
}
window.startAppVersionWatcher = startAppVersionWatcher;
try {
  startAppVersionWatcher();
} catch (err) {
  console.debug("App version watcher init skipped", err);
}


function updateCurrentVenueFromSelect() {
  const val = viewSelect.value;

  // Hide ALL venue screens
  document.querySelectorAll(".screen").forEach(s => s.style.display = "none");

  // Hide ALL tabbed sections inside each venue
  document.querySelectorAll(".aloha-section, .ohana-section, .gateway-section, .concession-section, .main-kitchen-section")
    .forEach(s => s.style.display = "none");

  // If a recipes dialog is open, close it when changing screens
  try { document.getElementById("addRecipeDialog")?.close?.(); } catch {}

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

  // 🔧 Station overrides by recipe and venue
  window.STATION_OVERRIDES = {
    R0016: { Gateway: "Grill", Aloha: "Oven", Ohana: "Oven" }, // Huli Chicken example
    // R0XXX: { Gateway: "...", Aloha: "...", Ohana: "..." },
  };

  // Decide the station for an order, honoring overrides first, then recipe default
  window.stationForOrder = function stationForOrder(recipeLike, venueName) {
    const recipeNo = String(recipeLike?.recipeNo || recipeLike?.recipeId || "").toUpperCase().trim();
    const byRecipe = window.STATION_OVERRIDES?.[recipeNo];
    if (byRecipe && byRecipe[venueName]) return byRecipe[venueName];
    return recipeLike?.station || "Unknown";
  };

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

    // ✅ Recipes init hooks (all safe no-ops if the helpers aren't defined yet)
    try {
      // Preload ingredients & recipes so the Recipes tab is instant and the dropdown is filled
      window._ensureIngredientsLoaded?.();
      window.startRecipesListener?.();
      window._ensureRecipesPrimed?.();     // one-time prime fetch if listener hasn't populated yet
      window._paintRecipeSelect?.();       // refresh the dropdown if dialog is opened
      // If user had the Recipes tab open previously, ensure list is rendered
      window.renderRecipesList?.();
    } catch (e) {
      console.debug("Recipes init skipped:", e);
    }
  }
}
async function ensureRecipeInNewCollection(id) {
  // If it already exists in cookingrecipes → done
  const targetRef = recipeDoc(id);
  const targetSnap = await getDoc(targetRef);
  if (targetSnap.exists()) return targetRef;

  // Try to migrate from legacy 'recipes'
  const legacySnap = await getDoc(legacyRecipeDoc(id));
  if (legacySnap.exists()) {
    const v = legacySnap.data() || {};
    // Map only fields you want to carry over
    const data = {
      description: v.description ?? v.name ?? v.recipeName ?? "(no name)",
      recipeNo: v.recipeNo || "",
      portions: v.portions || 0,
      methodology: v.methodology || "",
      ingredients: Array.isArray(v.ingredients) ? v.ingredients : [],
      category: (v.category || v.Category || "UNCATEGORIZED"),
      createdAt: v.createdAt || serverTimestamp(),
      migratedAt: serverTimestamp(),
      legacyCollection: LEGACY_RECIPES_COLL,
    };
    await setDoc(targetRef, data);
    return targetRef;
  }

  // Not in legacy either → create a minimal stub so updateDoc won't fail
  await setDoc(targetRef, {
    description: id,
    recipeNo: "",
    portions: 0,
    methodology: "",
    ingredients: [],
    category: "UNCATEGORIZED",
    createdAt: serverTimestamp(),
    createdBy: "auto-stub",
  });
  return targetRef;
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


// ===== Make helpers globally available =====
window.evaluateMathExpression  = window.evaluateMathExpression  || evaluateMathExpression;
window.normalizeQtyInputValue  = window.normalizeQtyInputValue  || normalizeQtyInputValue;

// ===== Track the currently focused qty input (works for new rows too) =====
(function initActiveQtyFocusTracking(){
  // All selectors we want the scale to target
  const QTY_SELECTORS = [
    '.send-qty-input',
    '.prep-input',
    '#alohaQty', '#gatewayQty', '#ohanaQty', '#concessionQty'
  ];

  // When ANYTHING gets focus, if it matches our selectors, remember it
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (QTY_SELECTORS.some(sel => el.matches(sel))) {
      window._activeQtyInput = el;
      // console.log('🎯 active qty input =', el);
    }
  }, { capture: true });

  // If you dynamically add new inputs and don’t change focus, clicking them will still set active
  document.addEventListener('click', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    const input = el.closest(QTY_SELECTORS.join(', '));
    if (input) window._activeQtyInput = input;
  }, { capture: true });

  // (Optional) if you want to also tag inputs when you call your math initializer:
  const _origEnable = window.enableMathOnInputs; // might be undefined right now
  window.enableMathOnInputs = function(selector, scope = document){
    try { _origEnable?.(selector, scope); } catch {}
    scope.querySelectorAll(selector).forEach(inp => {
      inp.addEventListener('focus', () => { window._activeQtyInput = inp; }, { passive: true });
      inp.addEventListener('click',  () => { window._activeQtyInput = inp; }, { passive: true });
    });
  };

  // First pass in case inputs already exist
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll(QTY_SELECTORS.join(', ')).forEach(inp => {
      inp.addEventListener('focus', () => { window._activeQtyInput = inp; }, { passive: true });
      inp.addEventListener('click',  () => { window._activeQtyInput = inp; }, { passive: true });
    });
  });
})();


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



//**Prep Pars main kitchen  */

// ===================== MAIN KITCHEN — PREP PARS (from `prepPars` collection) =====================

// Venue codes → names (same mapping style you use elsewhere)
const VENUE_CODE_TO_NAME = {
  b001: "Aloha",
  b002: "Ohana",
  b003: "Gateway",
  c002: "Concessions",
  c003: "Concessions",
  c004: "Concessions",
};

// Display order requested
const PREP_VENUE_ORDER = ["Gateway", "Aloha", "Ohana", "Concessions"];

// Public entry points
window.loadMainKitchenPrepPars   = loadMainKitchenPrepPars;
window.reloadMainKitchenPrepPars = loadMainKitchenPrepPars;
window.savePrepPans              = savePrepPans;

async function loadMainKitchenPrepPars() {
  const tbody = document.getElementById("prepParsTbody");
  if (!tbody) return;

  showTableLoading(tbody, "Loading Prep Pars…");

  const today = getTodayDate();

  // 1) Today's guest counts (saved)
  let guestCounts = {};
  try {
    const gSnap = await getDoc(doc(db, "guestCounts", today));
    guestCounts = gSnap.exists() ? (gSnap.data() || {}) : {};
  } catch {}

  // 2) Pull prep par definitions
  //    These docs look like:
  //    { category, description, recipeNo, station, venueCodes:[], pars:{ Aloha:{300:..}, Gateway:{350:..}, Ohana:{..} } }
  const snap = await getDocs(query(
    collection(db, "prepPars"),
    where("venueCodes", "array-contains-any", ["b001","b002","b003","c002","c003","c004"])
  ));

  const rows = [];
  snap.forEach(d => {
    const data = d.data() || {};
    const category = String(data.category || "").toUpperCase();
    const desc     = data.description || "";
    const recipeNo = data.recipeNo || "";
    const venueCodes = Array.isArray(data.venueCodes) ? data.venueCodes : [];
    const parsObj    = data.pars || {};

    // For each venue this prep item belongs to, compute the par using today's guestCounts
    for (const code of venueCodes) {
      const venue = VENUE_CODE_TO_NAME[String(code).toLowerCase()];
      if (!venue) continue;

      const savedGuest = Number(guestCounts?.[venue] || 0);
      const parForVenue = selectParForGuestCount(parsObj?.[venue], savedGuest);

      rows.push({
        prepId: d.id,
        venue,
        category,           // HOTFOODS | PANTRY | BAKERY | ...
        description: desc,
        recipeNo,
        prepPar: parForVenue,
      });
    }
  });

  // 3) Apply filters (Venue + Area)
  const venueFilter = (document.getElementById("prepVenueFilter")?.value || "ALL").toUpperCase();
  const areaFilter  = (document.getElementById("prepAreaFilter")?.value  || "ALL").toUpperCase();

  const filtered = rows.filter(r => {
    if (venueFilter !== "ALL" && r.venue.toUpperCase() !== venueFilter) return false;
    if (areaFilter  !== "ALL" && r.category !== areaFilter) return false;
    return true;
  });

  // 4) Load today's prepped totals
  const preppedTodayByItem = await fetchTodayPreppedTotals(today);

  // 5) Merge “prepped today”
  const items = filtered.map(r => ({
    ...r,
    preppedToday: Number(preppedTodayByItem.get(r.prepId)?.[r.venue] || 0),
  }));

  // 6) Sort: Gateway → Aloha → Ohana → Concessions, then by category, then recipeNo
  items.sort((a, b) => {
    const vi = PREP_VENUE_ORDER.indexOf(a.venue);
    const vj = PREP_VENUE_ORDER.indexOf(b.venue);
    if (vi !== vj) return vi - vj;
    const ca = a.category.localeCompare(b.category);
    if (ca !== 0) return ca;
    return String(a.recipeNo).localeCompare(String(b.recipeNo));
  });

  // 7) Render
  renderPrepParsTable(items, tbody);
}

// Pick a par from a map like { "250": 110, "300": 130, ... } based on today's guest count.
// Strategy:
//  - exact match → use it
//  - else floor to the largest key <= guestCount
//  - if none, return 0
function selectParForGuestCount(venueMap, guestCount) {
  if (!venueMap || typeof venueMap !== "object") return 0;

  const keys = Object.keys(venueMap)
    .map(k => Number(k))
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (keys.length === 0) return 0;

  if (Object.prototype.hasOwnProperty.call(venueMap, String(guestCount))) {
    return Number(venueMap[String(guestCount)]) || 0;
  }

  // find floor
  let chosen = 0;
  for (const k of keys) {
    if (k <= guestCount) chosen = k; else break;
  }
  return Number(venueMap[String(chosen)] || 0);
}

// Read one upserted doc per day+prepId+venue: `${date}|${prepId}|${venue}`
async function fetchTodayPreppedTotals(todayStr) {
  const totals = new Map(); // prepId -> { [venue]: pans }

  const qSnap = await getDocs(query(
    collection(db, "prepLogs"),
    where("date", "==", todayStr)
  ));

  qSnap.forEach(s => {
    const d = s.data() || {};
    const pid = d.prepId;
    const v   = d.venue;
    const n   = Number(d.pans || 0);
    if (!pid || !v) return;

    if (!totals.has(pid)) totals.set(pid, {});
    totals.get(pid)[v] = n;
  });

  return totals;
}

function renderPrepParsTable(items, tbody) {
  if (!Array.isArray(items) || items.length === 0) {
    showTableEmpty(tbody, "No prep items to show.");
    return;
  }

  tbody.innerHTML = "";
  for (const it of items) {
    const tr = document.createElement("tr");
    const remaining = Math.max(0, Number(it.prepPar) - Number(it.preppedToday));

    tr.innerHTML = `
      <td data-label="Venue">${it.venue}</td>
      <td data-label="Area">${titleCase(it.category)}</td>
      <td data-label="Item">${it.recipeNo || ""} — ${escapeHtml(it.description || "")}</td>
      <td data-label="Prep Par" style="text-align:right;">${it.prepPar}</td>
      <td data-label="Prepped Today" style="text-align:right;">${it.preppedToday}</td>
      <td data-label="Enter Pans Made">
        <input
          type="text"
          inputmode="decimal"
          class="prep-input"
          style="width:90px;text-align:right;"
          placeholder="${remaining}"
          value=""
          data-prep-id="${it.prepId}"
          data-venue="${it.venue}"
          data-recipe-no="${it.recipeNo || ""}"
          data-category="${it.category || ""}"
        />
      </td>
      <td data-label="Save">
        <button class="save-btn" onclick="savePrepPans(this)">Save</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  // math inputs like 2*3, 10/4, etc., same as other screens
  enableMathOnInputs(".prep-input", tbody);
}



async function savePrepPans(btn) {
  const row  = btn.closest("tr");
  const input = row?.querySelector(".prep-input");
  if (!input) return;

  const v = normalizeQtyInputValue(input);
  if (!Number.isFinite(v) || v < 0) {
    alert("Enter a valid pans number (0 or more).");
    return;
  }

  const prepId   = input.dataset.prepId;
  const recipeNo = input.dataset.recipeNo || "";
  const venue    = input.dataset.venue;
  const category = (input.dataset.category || "").toUpperCase();
  const today    = getTodayDate();

  const docId = `${today}|${prepId}|${venue}`;
  const ref   = doc(db, "prepLogs", docId);

  try {
    await setDoc(ref, {
      date: today,
      prepId,
      recipeNo,
      venue,
      category,
      pans: Number(v),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    row.style.backgroundColor = "rgba(28, 150, 80, 0.12)";
    setTimeout(() => (row.style.backgroundColor = ""), 450);

    loadMainKitchenPrepPars();
  } catch (e) {
    console.error("savePrepPans failed:", e);
    alert("Failed to save prep value.");
  }
}

// tiny helpers
function titleCase(s="") { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }
function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


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


// ========================= SCALE INTEGRATION (Web Serial + Keyboard Wedge) =========================
// Usage:
//  - Add a button with id="connectScaleBtn" (optional). Clicking it will open the browser's port picker.
//  - Focus any qty input (e.g., .send-qty-input, .prep-input, #alohaQty, etc.). The scale will write there.
//  - Switch write mode with window.setScaleWriteMode('replace' | 'add').
//
// Notes:
//  - Many "PS-USB" scales enumerate as USB-Serial (CDC ACM). Web Serial works in Chromium-based browsers (https).
//  - If your scale is a "keyboard wedge", you may not need Web Serial at all: it will type directly into the focused input.
//    This module still helps by normalizing after Enter and capturing active input for consistency.

// ===== DEBUG: connect + log raw serial data and parsed lines =====
window.connectScaleSerialDebug = async function(baud = 9600) {
  if (!('serial' in navigator)) return alert('Web Serial not supported here.');
  try {
    // Close existing if open
    if (window._scale?.port) { try { await window.disconnectScaleSerial?.(); } catch {} }

    const port = await navigator.serial.requestPort({});
    await port.open({ baudRate: baud });
    console.log('🐛 DEBUG: opened serial at', baud);

    // Some scales need control lines asserted
    try { await port.setSignals?.({ dataTerminalReady: true, requestToSend: true }); } catch {}

    const decoder = new TextDecoderStream();
    const closed = port.readable.pipeTo(decoder.writable).catch(()=>{});
    const reader = decoder.readable.getReader();

    window._scale = window._scale || {};
    window._scale.port = port;
    window._scale.reader = reader;
    window._scale.connected = true;

    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      console.log('🐛 RAW:', JSON.stringify(value));
      buf += value;

      let idx;
      while ((idx = buf.search(/[\r\n]+/)) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        handleLine(line);
      }

      if (buf.length > 32) {
        handleLine(buf);
        buf = '';
      }
    }

    async function handleLine(line) {
      const txt = String(line).trim();
      if (!txt) return;
      console.log('🐛 LINE:', txt);

      const m = txt.match(/([-+]?\d+(?:\.\d+)?)(?:\s*([a-zA-Z]+))?/);
      if (!m) return;
      const val = Number(m[1]);
      if (!Number.isFinite(val)) return;

      const input = window._activeQtyInput;
      if (!input) { console.warn('No focused input for weight'); return; }

      const mode = window._scale?.writeMode || 'replace';
      const existingText = typeof input.value === 'string' ? input.value : '';
      const trimmed = existingText.trim();
      const hasDigits = /\d/.test(trimmed);
      const selectionCoversAll =
        typeof input.selectionStart === 'number' &&
        typeof input.selectionEnd === 'number' &&
        input.selectionStart === 0 &&
        input.selectionEnd === existingText.length;
      const autoAdd = (window._scale?.autoAddWhenFilled === undefined)
        ? true
        : Boolean(window._scale.autoAddWhenFilled);
      const shouldAppend = hasDigits && !selectionCoversAll && (mode === 'add' || autoAdd);

      if (shouldAppend) {
        const endsWithOp = /[+\-*/]\s*$/.test(trimmed);
        input.value = endsWithOp ? `${trimmed} ${val}` : `${trimmed} + ${val}`;
      } else {
        input.value = String(val);
      }
      if (typeof window.normalizeQtyInputValue === 'function') window.normalizeQtyInputValue(input);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      console.log('✅ wrote weight to focused input:', input.value);
    }
  } catch (e) {
    console.error('DEBUG connect failed:', e);
    alert('Debug connect failed: ' + e);
  }
};


// ========================= SCALE (WebHID fallback) =========================
(function scaleHID(){
  async function requestHID() {
    if (!('hid' in navigator)) {
      alert('This browser does not support WebHID. Use Chrome/Edge.');
      return null;
    }
    const devices = await navigator.hid.requestDevice({ filters: [] });
    return devices && devices[0] ? devices[0] : null;
  }

  function bytesToText(dataView) {
    const bytes = new Uint8Array(dataView.buffer);
    const printable = bytes.filter(b => b >= 32 && b <= 126);
    try { return new TextDecoder().decode(Uint8Array.from(printable)); } catch { return ''; }
  }

  function parseLineAndWrite(txt) {
    const m = String(txt).trim().match(/([-+]?\d+(?:\.\d+)?)(?:\s*([a-zA-Z]+))?/);
    if (!m) return;
    const val = Number(m[1]);
    if (!Number.isFinite(val)) return;

    const input = window._activeQtyInput;
    if (!input) return;

    const mode = window._scale?.writeMode || 'replace';
    const existingText = typeof input.value === 'string' ? input.value : '';
    const trimmed = existingText.trim();
    const hasDigits = /\d/.test(trimmed);
    const selectionCoversAll =
      typeof input.selectionStart === 'number' &&
      typeof input.selectionEnd === 'number' &&
      input.selectionStart === 0 &&
      input.selectionEnd === existingText.length;
    const autoAdd = (window._scale?.autoAddWhenFilled === undefined)
      ? true
      : Boolean(window._scale.autoAddWhenFilled);
    const shouldAppend = hasDigits && !selectionCoversAll && (mode === 'add' || autoAdd);

    if (shouldAppend) {
      const endsWithOp = /[+\-*/]\s*$/.test(trimmed);
      input.value = endsWithOp ? `${trimmed} ${val}` : `${trimmed} + ${val}`;
    } else {
      input.value = String(val);
    }
    if (typeof window.normalizeQtyInputValue === 'function') window.normalizeQtyInputValue(input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    console.log('✅ HID wrote weight to focused input:', input.value);
  }

  async function connectHID() {
    const device = await requestHID();
    if (!device) return;

    await device.open();
    console.log('⚖️ HID device opened:', device.productName || '(unknown)');

    device.addEventListener('inputreport', e => {
      const txt = bytesToText(e.data);
      if (txt) {
        console.log('🐛 HID RAW:', txt);
        parseLineAndWrite(txt);
      }
    });
  }

  // expose globally
  window.connectScaleHID = connectHID;
})();


(function scaleIntegration(){
  // --- Global state ---
  window._scale = {
    port: null,
    reader: null,
    connected: false,
    writeMode: 'replace', // 'replace' | 'add'
    autoAddWhenFilled: true,
    unitConversion: null, // e.g., { from:'kg', to:'lb', factor: 2.20462 } if you ever want auto-convert
    lineBuf: ''
  };

  // Track the active qty input so the scale knows where to write.
  // Extend your existing enableMathOnInputs to mark focus.
  function markActiveOnFocus(input) {
    input.addEventListener('focus', () => { window._activeQtyInput = input; }, { passive: true });
    input.addEventListener('click',  () => { window._activeQtyInput = input; }, { passive: true });
  }

  // Call on any container after you render inputs
  function registerQtyFocusTargets(scope = document) {
    const selectors = [
      '.send-qty-input',
      '.prep-input',
      '#alohaQty', '#gatewayQty', '#ohanaQty', '#concessionQty'
    ];
    selectors.forEach(sel => {
      scope.querySelectorAll(sel).forEach(markActiveOnFocus);
    });
  }

  // Patch into your existing math initializer so it also tracks focus:
  const _origEnableMathOnInputs = window.enableMathOnInputs;
  window.enableMathOnInputs = function(selector, scope = document){
    _origEnableMathOnInputs?.(selector, scope);
    scope.querySelectorAll(selector).forEach(markActiveOnFocus);
  };

  // Initial pass on load
  document.addEventListener('DOMContentLoaded', () => {
    registerQtyFocusTargets(document);
  });

  // Public: change write mode at runtime
  window.setScaleWriteMode = function(mode) {
    window._scale.writeMode = (mode === 'add') ? 'add' : 'replace';
    console.log(`⚖️ Scale write mode: ${window._scale.writeMode}`);
  };

  window.setScaleAutoAddWhenFilled = function(enabled = true) {
    window._scale.autoAddWhenFilled = Boolean(enabled);
    console.log(`⚖️ Scale auto-add when filled: ${window._scale.autoAddWhenFilled}`);
  };

  // Parse one line from the scale, return {value, unit} or null
  function parseScaleLine(line) {
    // Common formats seen: "  1.250 kg", "W: 0.55 lb", "ST,GS,  0.120 kg", "1.234"
    // Grab first decimal number and optional unit
    const m = String(line).trim().match(/([-+]?\d+(?:\.\d+)?)(?:\s*([a-zA-Z]+))?/);
    if (!m) return null;
    const val = Number(m[1]);
    if (!Number.isFinite(val)) return null;
    const unit = m[2]?.toLowerCase?.() || null;
    return { value: val, unit };
  }

  // Apply optional unit conversion (if configured)
  function maybeConvert({ value, unit }) {
    const conv = window._scale.unitConversion;
    if (conv && unit && conv.from && conv.to && conv.factor && unit.toLowerCase() === conv.from.toLowerCase()) {
      return { value: value * conv.factor, unit: conv.to };
    }
    return { value, unit };
  }

  // Write a received weight into the currently active input
  function writeWeightToActiveInput(weight) {
    const input = window._activeQtyInput;
    if (!input) { console.warn('⚖️ No active input focused; ignoring weight'); return; }

    const { writeMode, autoAddWhenFilled } = window._scale;
    const safeVal = Number(weight);
    if (!Number.isFinite(safeVal)) return;

    const existingText = typeof input.value === 'string' ? input.value : '';
    const trimmed = existingText.trim();
    const hasDigits = /\d/.test(trimmed);
    const selectionCoversAll =
      typeof input.selectionStart === 'number' &&
      typeof input.selectionEnd === 'number' &&
      input.selectionStart === 0 &&
      input.selectionEnd === existingText.length;

    const autoAdd = (autoAddWhenFilled === undefined) ? true : Boolean(autoAddWhenFilled);
    const shouldAppend = hasDigits && !selectionCoversAll && (writeMode === 'add' || autoAdd);

    if (shouldAppend) {
      // Append as math: "existing + weight"
      // If existing already ends with an operator, just append the number.
      const endsWithOp = /[+\-*/]\s*$/.test(trimmed);
      input.value = endsWithOp ? `${trimmed} ${safeVal}` : `${trimmed} + ${safeVal}`;
    } else {
      // Replace current value or overwrite selected text
      input.value = String(safeVal);
    }

    // Normalize (your helper rounds to step/2dp etc.)
    if (typeof window.normalizeQtyInputValue === 'function') {
      window.normalizeQtyInputValue(input);
    }

    // Fire an input event so any listeners (like enabling buttons) react
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Continuously read lines from the serial scale
  async function startReading(port) {
    window._scale.lineBuf = '';
    const decoder = new TextDecoderStream();
    const readableStreamClosed = port.readable.pipeTo(decoder.writable).catch(() => {});
    window._scale.reader = decoder.readable.getReader();

    try {
      while (true) {
        const { value, done } = await window._scale.reader.read();
        if (done) break;
        if (value) {
          // Accumulate into lines
          window._scale.lineBuf += value;
          let idx;
          while ((idx = window._scale.lineBuf.search(/[\r\n]+/)) >= 0) {
            const line = window._scale.lineBuf.slice(0, idx);
            window._scale.lineBuf = window._scale.lineBuf.slice(idx + 1);
            const parsed = parseScaleLine(line);
            if (parsed) {
              const conv = maybeConvert(parsed);
              writeWeightToActiveInput(conv.value);
            }
          }
        }
      }
    } catch (e) {
      console.warn('⚖️ Scale read stopped:', e);
    } finally {
      try { await window._scale.reader.releaseLock(); } catch {}
      try { await readableStreamClosed; } catch {}
    }
  }

  // Public: connect via Web Serial
  window.connectScaleSerial = async function() {
    if (!('serial' in navigator)) {
      alert('This browser does not support Web Serial. Use Chrome/Edge on HTTPS.');
      return;
    }
    try {
      const port = await navigator.serial.requestPort({
        // Filters are optional. If you know VID/PID you can add them here to narrow devices.
        // filters: [{ usbVendorId: 0x????, usbProductId: 0x???? }]
      });
      await port.open({ baudRate: 9600 }); // Many scales default to 9600; adjust if needed.
      window._scale.port = port;
      window._scale.connected = true;
      console.log('⚖️ Scale connected (Serial).');
      startReading(port);
    } catch (e) {
      console.error('⚠️ Failed to connect to scale:', e);
      alert('Failed to connect to scale.');
    }
  };

  // Optional: wire a connect button if present
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('connectScaleBtn');
    if (btn) btn.addEventListener('click', () => window.connectScaleSerial());
  });

  // Quality-of-life: if the scale is a "keyboard wedge", it just types into the focused input.
  // We don't need to intercept those keystrokes. Your existing Enter/blur normalization already
  // cleans the value. As a convenience, normalize if the scale sends Enter rapidly:
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && window._activeQtyInput && typeof window.normalizeQtyInputValue === 'function') {
      // Normalize but do NOT prevent default: preserves your existing behavior
      window.normalizeQtyInputValue(window._activeQtyInput);
    }
  }, { capture: true });

})();

// ===== SERIAL PROBE: cycle common settings, read raw bytes, log hex+ascii, try to write values =====
window.serialProbe = async function(options = {}) {
  if (!('serial' in navigator)) return alert('Web Serial not supported here.');
  const bauds    = options.bauds    || [9600, 2400, 4800, 19200, 38400, 115200];
  const parities = options.parities || ['none', 'even'];
  const stops    = options.stopBits || [1, 2];
  const datas    = options.dataBits || [8, 7];

  async function readFor(port, ms = 4000) {
    const reader = port.readable.getReader(); // raw bytes
    const startedAt = Date.now();
    let chunkCount = 0;
    try {
      while (Date.now() - startedAt < ms) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        chunkCount++;
        const hex   = Array.from(value).map(b => b.toString(16).padStart(2,'0')).join(' ');
        const ascii = Array.from(value).map(b => (b>=32 && b<=126) ? String.fromCharCode(b) : '.').join('');
        console.log(`🔹 BYTES[${value.length}] HEX: ${hex}`);
        console.log(`🔹 ASCII: ${ascii}`);

        const m = ascii.match(/([-+]?\d+(?:\.\d+)?)/);
        if (m && window._activeQtyInput) {
          const val = Number(m[1]);
          if (Number.isFinite(val)) {
            const input = window._activeQtyInput;
            const mode = window._scale?.writeMode || 'replace';
            const existingText = typeof input.value === 'string' ? input.value : '';
            const trimmed = existingText.trim();
            const hasDigits = /\d/.test(trimmed);
            const selectionCoversAll =
              typeof input.selectionStart === 'number' &&
              typeof input.selectionEnd === 'number' &&
              input.selectionStart === 0 &&
              input.selectionEnd === existingText.length;
            const autoAdd = (window._scale?.autoAddWhenFilled === undefined)
              ? true
              : Boolean(window._scale.autoAddWhenFilled);
            const shouldAppend = hasDigits && !selectionCoversAll && (mode === 'add' || autoAdd);

            if (shouldAppend) {
              const endsWithOp = /[+\-*/]\s*$/.test(trimmed);
              input.value = endsWithOp ? `${trimmed} ${val}` : `${trimmed} + ${val}`;
            } else {
              input.value = String(val);
            }
            if (typeof window.normalizeQtyInputValue === 'function') window.normalizeQtyInputValue(input);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('✅ wrote weight to focused input:', input.value);
          }
        }
      }
    } finally { try { reader.releaseLock(); } catch {} }
    return chunkCount;
  }

  try { await window.disconnectScaleSerial?.(); } catch {}

  const port = await navigator.serial.requestPort({});
  for (const baudRate of bauds) {
    for (const parity of parities) {
      for (const stopBits of stops) {
        for (const dataBits of datas) {
          try {
            console.log(`\n⚙️ Trying ${baudRate} baud, ${dataBits} data bits, parity=${parity}, stopBits=${stopBits}`);
            await port.open({ baudRate, dataBits, parity, stopBits });
            try { await port.setSignals?.({ dataTerminalReady: true, requestToSend: true }); } catch {}

            console.log('📥 Reading… click a qty box, then press PRINT on the scale.');
            const got = await readFor(port, 4000);
            await port.close();

            if (got > 0) {
              console.log('🎯 Data seen with this config. Use these permanently.');
              return { baudRate, dataBits, parity, stopBits };
            } else {
              console.log('🙅 No bytes seen. Trying next combo…');
            }
          } catch (e) {
            console.log('⚠️ Open/read failed for this combo:', e?.message || e);
            try { await port.close(); } catch {}
          }
        }
      }
    }
  }
  console.log('❌ No data on common serial settings. Either the scale needs a command, or this isn’t the serial device.');
  return null;
};



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
  const qLatest = query(
    collection(db, window.SHOWWARE_COLL || "showwareEvents"),
    orderBy("receivedAt", "desc"),
    limit(1)
  );

  // last-seen totals so we only refresh when something actually changes
  window._swLastTotals = window._swLastTotals || { Aloha: null, Ohana: null, Gateway: null };
  let refreshTimer = null;

  // small helpers
  const liveTotal = (name, obj) => {
    const v = Number(obj?.total || 0);
    return Number.isFinite(v) ? v : null;
  };
  const sectionVisible = (rootId) => {
    const root = document.getElementById(rootId);
    if (!root) return false;
    const sec = root.querySelector(".starting-section");
    return !!(sec && root.style.display !== "none" && sec.style.display !== "none");
  };
  const setGuestInfoIfVisible = (id, val) => {
    const el = document.getElementById(id);
    if (el && sectionVisible(id.includes("aloha") ? "aloha" : "ohana")) {
      el.textContent = `👥 Guest Count: ${val}`;
    }
  };

  onSnapshot(qLatest, (snap) => {
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

    // 4) Mirror TOTALS onto Guest Count screen (labels only; selects come from guestCounts)
    const mirror = (name, vals) => {
      if (!vals) return;
      const total = Number(vals.total || 0);
      if (!Number.isFinite(total)) return;
      const curEl = document.getElementById(`current-${name}`);
      if (curEl) curEl.textContent = String(total);
    };
    mirror("Aloha",   al);
    mirror("Ohana",   oh);
    mirror("Gateway", gw);

    // 5) Update cost/guest cards now that totals are fresh (safe no-ops if the UI isn’t present)
    ["Aloha","Gateway","Ohana"].forEach(v => {
      try { updateCostSummaryForVenue?.(v); } catch {}
    });

    // 6) If totals changed, refresh Starting Pars so R0425 matches LIVE totals instantly
    const changed = {
      Aloha:   liveTotal("Aloha",   al),
      Ohana:   liveTotal("Ohana",   oh),
      Gateway: liveTotal("Gateway", gw),
    };
    let anyChanged = false;
    Object.keys(changed).forEach(name => {
      const val = changed[name];
      if (val != null && val !== window._swLastTotals[name]) {
        window._swLastTotals[name] = val;
        anyChanged = true;
      }
    });
    if (!anyChanged) return;

    // Debounce in case multiple venues update in a single doc
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      try {
        // Update the little guest labels on Aloha/Ohana starting screens (if visible)
        if (changed.Aloha != null) setGuestInfoIfVisible("alohaGuestInfo", changed.Aloha);
        if (changed.Ohana != null) setGuestInfoIfVisible("ohanaGuestInfo", changed.Ohana);

        // Refresh venue starting pars that are visible (R0425 uses live total in render)
        if (sectionVisible("aloha") && typeof loadAlohaStartingPar === "function") {
          loadAlohaStartingPar();
        }
        if (sectionVisible("ohana") && typeof loadOhanaStartingPar === "function") {
          loadOhanaStartingPar();
        }
        if (sectionVisible("main-kitchen") && typeof loadMainKitchenStartingPars === "function") {
          loadMainKitchenStartingPars();
        }
      } catch (e) {
        console.debug("showware live refresh skipped:", e);
      }
    }, 120);
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

  // Keep last-seen values so we only refresh when something actually changes
  window._lastGuestCounts = window._lastGuestCounts || { Aloha: null, Ohana: null, Gateway: null };
  let refreshTimer = null;

  // Quick helpers (scoped here so we don't pollute globals)
  const ensureOption = (selectId, value) => {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const exists = Array.from(sel.options).some(o => Number(o.value) === Number(value));
    if (!exists) {
      const opt = document.createElement("option");
      opt.value = String(value);
      opt.textContent = String(value);
      sel.appendChild(opt);
    }
  };
  const isStartingVisible = (rootId) => {
    const root = document.getElementById(rootId);
    const sec  = root?.querySelector(".starting-section");
    return !!(root && sec && root.style.display !== "none" && sec.style.display !== "none");
  };
  const scheduleRefreshesIfNeeded = (changed) => {
    // Debounce a tiny bit in case all three change at once
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      try {
        // Refresh venue Starting Pars that are currently on-screen
        if (changed.Aloha && isStartingVisible("aloha") && typeof loadAlohaStartingPar === "function") {
          loadAlohaStartingPar();
        }
        if (changed.Ohana && isStartingVisible("ohana") && typeof loadOhanaStartingPar === "function") {
          loadOhanaStartingPar();
        }
        if ((changed.Aloha || changed.Ohana || changed.Gateway) &&
            isStartingVisible("main-kitchen") &&
            typeof loadMainKitchenStartingPars === "function") {
          loadMainKitchenStartingPars();
        }

        // Update cost/guest cards (safe to call; they no-op if elements missing)
        ["Aloha","Gateway","Ohana"].forEach(v => {
          if (changed[v] && typeof updateCostSummaryForVenue === "function") {
            updateCostSummaryForVenue(v);
          }
        });
      } catch (e) {
        console.debug("guestCount live refresh skipped:", e);
      }
    }, 120);
  };

  onSnapshot(ref, (snap) => {
    const data = snap.exists() ? (snap.data() || {}) : {};
    const changed = { Aloha: false, Ohana: false, Gateway: false };

    ["Aloha","Ohana","Gateway"].forEach((name) => {
      const saved = Number(data?.[name]);

      // keep cache up to date for pars
      setGuestCountSaved(name, saved);

      // keep selects aligned with saved doc (user can still change before saving)
      const selId = `count-${name}`;
      const sel = document.getElementById(selId);
      if (sel && Number.isFinite(saved)) {
        ensureOption(selId, saved);
        sel.value = String(saved);
      }

      // notes remain Showware-first
      setGuestNotesPreferShowware(name, saved);

      // detect changes vs last snapshot
      const last = window._lastGuestCounts[name];
      if (Number.isFinite(saved) && saved !== last) {
        changed[name] = true;
        window._lastGuestCounts[name] = saved;
      }
    });

    // If any venue changed, refresh visible Starting Pars + cost cards
    if (changed.Aloha || changed.Ohana || changed.Gateway) {
      scheduleRefreshesIfNeeded(changed);
    }
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
  if (!mainKitchen) { console.warn("#main-kitchen not found"); return; }

  // Hide all sections (now includes 'prep-section')
  const allSections = mainKitchen.querySelectorAll(
    ".order-section, .starting-section, .waste-section, .returns-section, .lunch-section, .prep-section"
  );
  allSections.forEach(sec => { sec.style.display = "none"; });

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
  if (controls) controls.style.display = sectionId === "starting" ? "flex" : "none";

  // Load section-specific data (added 'prep')
  const loaders = {
    starting: window.loadMainKitchenStartingPars,
    waste:    window.loadMainKitchenWaste,
    returns:  window.loadMainKitchenReturns,
    lunch:    window.loadMainKitchenLunch,
    prep:     window.loadMainKitchenPrepPars,   // ✅ NEW
    order:    window.loadMainKitchenOrders      // if you have one
  };

  const fn = loaders[sectionId];
  if (typeof fn === "function") fn();
};


//Kitchen add ons
// Kitchen add ons
const kitchenSendQtyCache = {};

const kitchenNoteModal = document.getElementById("noteModal");
const kitchenNoteModalBody = document.getElementById("noteModalBody");
const NOTE_MODAL_VISIBLE_CLASS = "note-modal--visible";

function openKitchenNoteModal(text = "") {
  if (!kitchenNoteModal || !kitchenNoteModalBody) return;
  kitchenNoteModalBody.textContent = text;
  kitchenNoteModal.classList.add(NOTE_MODAL_VISIBLE_CLASS);
  kitchenNoteModal.setAttribute("aria-hidden", "false");
}

function closeKitchenNoteModal() {
  if (!kitchenNoteModal || !kitchenNoteModalBody) return;
  kitchenNoteModal.classList.remove(NOTE_MODAL_VISIBLE_CLASS);
  kitchenNoteModal.setAttribute("aria-hidden", "true");
  kitchenNoteModalBody.textContent = "";
}

if (kitchenNoteModal) {
  kitchenNoteModal.addEventListener("click", (event) => {
    const target = event.target;
    if (!target) return;
    if (target.dataset.dismiss === "note-modal") {
      closeKitchenNoteModal();
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && kitchenNoteModal?.classList.contains(NOTE_MODAL_VISIBLE_CLASS)) {
    closeKitchenNoteModal();
  }
});

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
    decorateVenueRow(row, order.venue);

    const createdAt = order.timestamp?.toDate?.() || new Date();
    const cookTime = order.cookTime || 0;
    const dueTime = new Date(createdAt.getTime() + cookTime * 60000);
    const now = new Date();

    const dueFormatted = dueTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (dueTime < now) {
      row.classList.add("order-late");
    }

    const cachedQty = kitchenSendQtyCache[order.id] ?? "";
    const venueLabel = order.venue || "";
    const safeVenue = escapeHtml(venueLabel);
    const safeItem = escapeHtml(order.item || "");
    const safeStatus = escapeHtml(order.status || "");
    const safeUom = escapeHtml(order.uom || "ea");
    const qtyDisplay = order.qty ?? "";
    const rawNote = typeof order.notes === "string" ? order.notes : "";
    const noteText = rawNote.trim();
    const hasNote = noteText.length > 0;
    const encodedNote = encodeURIComponent(noteText);
    const noteButtonHtml = hasNote
      ? `<button type="button" class="note-btn note-btn--inline" data-note="${encodedNote}" aria-label="View note for ${safeItem}">View Note</button>`
      : "";

    row.dataset.status = order.status || "";

    row.innerHTML = `
      <td data-label="Due">${dueFormatted}</td>
      <td data-label="Area"><span class="venue-pill">${safeVenue}</span></td>
      <td data-label="Item">
        <div class="item-cell">
          <span class="item-title">${safeItem}</span>
          ${noteButtonHtml}
        </div>
      </td>
      <td data-label="Qty">${qtyDisplay}</td>
      <td data-label="Status">${safeStatus}</td>
      <td data-label="Send Qty">
        <input
          type="text"
          inputmode="decimal"
          value="${cachedQty}"
          class="send-qty-input"
          data-order-id="${order.id}"
          placeholder="0"
          aria-label="Send quantity for ${safeItem}"
        />
      </td>
      <td data-label="UOM">${safeUom}</td>
      <td data-label="Send">
        <button onclick="sendKitchenOrder('${order.id}', this)" disabled>Send</button>
      </td>
    `;

    container.appendChild(row);

    if (hasNote) {
      const noteBtn = row.querySelector(".note-btn");
      if (noteBtn) {
        noteBtn.addEventListener("click", () => {
          const noteValue = noteBtn.dataset.note ? decodeURIComponent(noteBtn.dataset.note) : "";
          openKitchenNoteModal(noteValue);
        });
      }
    }
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
  const classMap = {
    success: "notif--success",
    error: "notif--error",
    info: "notif--info"
  };

  notif.classList.remove("notif--success", "notif--error", "notif--info");
  const nextClass = classMap[type] || classMap.info;
  if (nextClass) notif.classList.add(nextClass);

  notif.style.display = "block";

  if (notif.hideTimer) clearTimeout(notif.hideTimer);
  notif.hideTimer = setTimeout(() => {
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
    where("status", "in", ["open", "fired", "Ready to Send"])
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


 const station = window.stationForOrder({ ...recipeData, recipeNo }, "Aloha");

const order = {
  item: recipeData.description || recipeNo,
  qty,
  status: "open",
  venue: "Aloha",
  station, // ✅ now routed per venue override
  recipeNo,
  cookTime: recipeData.cookTime || 0,
  notes,
  uom: recipeData.uom || "ea",
  totalCost,
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
  where("status", "in", ["open", "fired", "Ready to Send", "sent", "received"]),
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
      fired: 2,
      open: 3,
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
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(orderRef);
      if (!snap.exists()) {
        throw new Error("Order no longer exists.");
      }
      const status = snap.data().status;
      if (status && status !== "open") {
        throw new Error("Order can no longer be edited.");
      }

      transaction.update(orderRef, {
        qty: parseFloat(newQty),
        notes: newNotes.trim(),
        updatedAt: serverTimestamp()
      });
    });

    alert("✅ Order updated.");
  } catch (err) {
    console.error("❌ Failed to update order:", err);
    alert(err?.message === "Order can no longer be edited." ? "⚠️ Order has already been fired and cannot be edited." : "❌ Failed to update order.");
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
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(orderRef);
      if (!snap.exists()) {
        throw new Error("Order no longer exists.");
      }
      const status = snap.data().status;
      if (status && status !== "open") {
        throw new Error("Order can no longer be edited.");
      }

      transaction.update(orderRef, {
        qty: newQty,
        notes: newNotes,
        updatedAt: serverTimestamp()
      });
    });

    if (orderToEdit.venue === "Main Kitchen") {
      showMainKitchenNotif("✅ Order updated.", 3000, "success");
    }
  } catch (err) {
    console.error("❌ Failed to update order:", err);
    const locked = err?.message === "Order can no longer be edited.";
    const message = locked
      ? "⚠️ Order has already been fired and cannot be edited."
      : "❌ Failed to update order.";

    if (orderToEdit.venue === "Main Kitchen") {
      showMainKitchenNotif(message, 3000, locked ? "info" : "error");
    } else {
      alert(message);
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
      const data = orderSnap.data();
      const status = data?.status;
      if (status && status !== "open") {
        const message = "⚠️ Order has already been fired and cannot be deleted.";
        if (data?.venue === "Main Kitchen") {
          showMainKitchenNotif(message, 3000, "info");
        } else {
          alert(message);
        }
        closeDeleteModal();
        return;
      }

      deletedOrderData = data;
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
// === Add once near your helpers ===
function isPineappleShells(rec) {
  const no  = String(rec?.recipeNo || "").toUpperCase().trim();
  const desc = String(rec?.description || "").toLowerCase();
  return no === "R0425" || /pineapple\s*shell/.test(desc);
}

//**aloha starting screen */
//**aloha starting screen */
window.loadAlohaStartingPar = async function () {
  console.log("🚀 Starting Aloha par load...");

  const today = getTodayDate();
  const guestRef = doc(db, "guestCounts", today);
  const guestSnap = await getDoc(guestRef);

  if (!guestSnap.exists()) {
    console.warn("❌ No guestCounts document found for today:", today);
    const info = document.getElementById("alohaGuestInfo");
    if (info) info.textContent = "⚠️ No guest count for today.";
    return;
  }

  const guestData = guestSnap.data();
  console.log("🌺 Full guest data:", guestData);

  // Saved (Firestore) guest count
  const savedGuestCount = Number(guestData?.Aloha || 0);
  // Live Showware total if available
  const liveShowware = (typeof window.swHasTotal === "function") ? window.swHasTotal("Aloha") : null;

  // Display: prefer live Showware on the label
  // ✅ Group to avoid '??' + '||' mixing error
  const displayCount = ((liveShowware ?? savedGuestCount) || 0);
  const infoEl = document.getElementById("alohaGuestInfo");
  if (infoEl) infoEl.textContent = `👥 Guest Count: ${displayCount}`;

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

  // 🧮 parQty:
  //   • Normal items: use r.pars.Aloha[savedGuestCount]
  //   • R0425 (Pineapple Shells): force to *live* Showware total if available, else saved
  const computedRecipes = recipes.map(r => {
    const targetFromPars = Number(r.pars?.Aloha?.[String(savedGuestCount)] || 0);
    const sentQty        = Number(sentQtyByRecipe[r.id] || 0);

    const recipeNo = String(r.recipeNo || "").toUpperCase().trim();
    const isR0425  = recipeNo === "R0425" || /pineapple\s*shell/i.test(String(r.description || ""));

    const overridePar = isR0425
      // ✅ Group to avoid '??' + '||' mixing error
      ? Number(((liveShowware ?? savedGuestCount) || 0))
      : targetFromPars;

    return {
      ...r,
      targetPar: overridePar,
      parQty: overridePar,
      sentQty
    };
  });

  // 🗂️ Cache & render
  window.startingCache = window.startingCache || {};
  window.startingCache["Aloha"] = {
    recipes: computedRecipes,
    guestCount: savedGuestCount, // keep saved in cache
    sentPars: sentQtyByRecipe,
    receivedPars
  };

  renderStartingStatus("Aloha", window.startingCache["Aloha"]);
};

window.renderStartingStatus = async function (venue, data) {
  const tbody = document.getElementById(`${venue.toLowerCase()}ParTableBody`);
  if (!tbody) return;

  const categoryFilter = document.getElementById(`${venue.toLowerCase()}-starting-category`)?.value || "";

  // Base guestCount comes from cache (saved Firestore number)
  const guestCount = Number(data?.guestCount || 0);
  // For R0425 on Aloha/Ohana, prefer Showware live total if present
  const liveShowware = (typeof window.swHasTotal === "function") ? window.swHasTotal(venue) : null;

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

    const recipeNo = String(recipe.recipeNo || "").toUpperCase().trim();
    const isR0425  = recipeNo === "R0425" || /pineapple\s*shell/i.test(String(recipe.description || ""));

    // Target PAR (pans) for this venue
    let targetPans = 0;
    if (venue === "Concessions") {
      targetPans = Number(recipe.pars?.Concession?.default || 0);
    } else {
      // For Pineapple Shells on Aloha/Ohana, use LIVE Showware total if present
      if ((venue === "Aloha" || venue === "Ohana") && isR0425 && Number.isFinite(liveShowware)) {
        targetPans = Number(liveShowware || 0);
      } else {
        // Everyone else keeps the saved-count keyed PAR table
        targetPans = Number(recipe.pars?.[venue]?.[String(guestCount)] || 0);
      }
    }
    if (targetPans <= 0) return;

    // Sent & Pending
    const sentPans    = Number(totalPansByRecipe.get(recipeId) || 0);
    const sentQty     = Number(totalQtyByRecipe.get(recipeId)  || data?.sentPars?.[recipeId] || 0);
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
  const today = getTodayDate();

  const stationQuery = query(
    stationRef,
    where("station", "==", stationName),
    where("status", "in", ["open", "fired"]),
    where("date", "==", today)   // ✅ only today’s orders
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

    // Other stations: Fired → Ready workflow
    else {
      const actionCell = document.createElement("td");
      actionCell.classList.add("station-actions");

      const readyButton = document.createElement("button");
      readyButton.textContent = "✅ Ready";
      readyButton.classList.add("ready-btn");

      readyButton.onclick = async () => {
        if (readyButton.disabled) return;
        readyButton.disabled = true;
        try {
          await runTransaction(db, async (transaction) => {
            const orderRef = doc(db, "orders", order.id);
            const snap = await transaction.get(orderRef);
            if (!snap.exists()) {
              throw new Error("Order not found");
            }
            const currentStatus = snap.data().status;
            if (currentStatus !== "fired") {
              throw new Error("Order must be fired before ready.");
            }
            transaction.update(orderRef, {
              status: "Ready to Send",
              readyAt: serverTimestamp(),
            });
          });
        } catch (err) {
          console.error("Error updating order:", err);
          alert("Failed to mark as ready.");
          readyButton.disabled = false;
        }
      };

      const fireButton = document.createElement("button");
      fireButton.textContent = "Fired";
      fireButton.classList.add("fire-btn");

      fireButton.onclick = async () => {
        if (fireButton.disabled) return;
        fireButton.disabled = true;
        try {
          await runTransaction(db, async (transaction) => {
            const orderRef = doc(db, "orders", order.id);
            const snap = await transaction.get(orderRef);
            if (!snap.exists()) {
              throw new Error("Order not found");
            }
            const currentStatus = snap.data().status;
            if (currentStatus === "fired") {
              return;
            }
            if (currentStatus !== "open") {
              throw new Error("Order can no longer be fired.");
            }
            transaction.update(orderRef, {
              status: "fired",
              firedAt: serverTimestamp(),
            });
          });

          actionCell.innerHTML = "";
          readyButton.disabled = false;
          actionCell.appendChild(readyButton);
        } catch (err) {
          console.error("Error firing order:", err);
          alert("Failed to mark order as fired.");
          fireButton.disabled = false;
        }
      };

      if (order.status === "fired") {
        readyButton.disabled = false;
        actionCell.appendChild(readyButton);
      } else {
        actionCell.appendChild(fireButton);
      }

      row.append(
        timeCell,
        dueCell,
        venueCell,
        itemCell,
        qtyCell,
        notesCell,
        actionCell
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
  // ⬇️ change const→let so we can sort
  let recipes = recipesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // 🔤 Sort by description (case-insensitive), then by recipeNo as a tiebreaker
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  recipes.sort((a, b) => {
    const da = (a.description || "").trim();
    const db = (b.description || "").trim();
    const byDesc = collator.compare(da, db);
    if (byDesc !== 0) return byDesc;
    const ra = (a.recipeNo || "").toString().trim();
    const rb = (b.recipeNo || "").toString().trim();
    return collator.compare(ra, rb);
  });

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
  const wasSentToday  = {};
const sentQtyTotals = {}; 

  ordersSnap.forEach(s => {
    const o = s.data() || {};
    const venue    = canonicalizeVenueName(o.venue);
    const recipeId = o.recipeId;
    if (!venue || !recipeId) return;

    const status = String(o.status || "sent").toLowerCase();
    const statusCounts = (status === "sent" || status === "received");
    const isConcessions = venue === "Concessions";

    const sentValue = isConcessions
      ? Number(o.netWeight ?? o.sendQty ?? o.qty ?? 0)   // lbs for baseline math
      : Number(o.pans ?? o.sendQty ?? o.qty ?? 0);       // pans fallback for buffet venues

    const qtyForDisplay = isConcessions
      ? Number(o.netWeight ?? o.sendQty ?? o.qty ?? 0)
      : Number(o.sendQty ?? o.pans ?? o.qty ?? 0);

    if (!sentPars[venue])      sentPars[venue] = {};
    if (!receivedPars[venue])  receivedPars[venue] = {};
    if (!sentParStatus[venue]) sentParStatus[venue] = {};
    if (!wasSentToday[venue])  wasSentToday[venue] = {};
    if (!sentQtyTotals[venue]) sentQtyTotals[venue] = {};

    if (statusCounts) {
      wasSentToday[venue][recipeId] = true;

      if (qtyForDisplay > 0) {
        sentQtyTotals[venue][recipeId] = (sentQtyTotals[venue][recipeId] || 0) + qtyForDisplay;
      }

      if (sentValue > 0) {
        sentPars[venue][recipeId] = (sentPars[venue][recipeId] || 0) + sentValue;
      }
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
    wasSentToday,      // ✅ buffet baseline driver
      sentQtyTotals 
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

  window.mainStartingQtyCache = window.mainStartingQtyCache || {};

  // --- Concessions baseline (unchanged)
  const currentConGuests = Number(data.guestCounts?.Concession || data.guestCounts?.Concessions || 0);
  const { guestBase, sentBase } = readConcessionBaseline();
  if (currentConGuests > guestBase) {
    writeConcessionBaseline(currentConGuests, (data.sentPars?.Concessions || {}));
  }
  const { sentBase: finalSentBase } = readConcessionBaseline();

  const fmt = n => (Number(n) % 1 ? Number(n).toFixed(2) : Number(n));
  const perVenueTotals = data.sentQtyTotals || {};
  let totalRows = 0;

  (data.recipes || []).forEach(recipe => {
    const station = recipe.category || "";
    if (stationFilter && station.toLowerCase() !== stationFilter.toLowerCase()) return;

    const recipeVenues = Array.from(new Set(
      (recipe.venueCodes || [])
        .map(code => canonicalizeVenueName(venueCodeMap[code] || code || ""))
        .filter(Boolean)
    ));

    if (recipeVenues.length === 0) return;

    for (const venue of recipeVenues) {
      if (venueFilter && venue !== venueFilter) continue;

      // 1) Compute target PAR (pans) — this is what we'll ALWAYS show in "Par Qty"
      let parPans = 0;

      if (venue === "Concessions") {
        parPans = Number(recipe.pars?.Concession?.default || 0);
      } else {
        const recipeNo = String(recipe.recipeNo || "").toUpperCase().trim();
        const isPineappleShells = (recipeNo === "R0425") || /pineapple\s*shell/i.test(String(recipe.description || ""));
        const live = (typeof window.swHasTotal === "function") ? window.swHasTotal(venue) : null;

        if ((venue === "Aloha" || venue === "Ohana") && isPineappleShells && Number.isFinite(live)) {
          parPans = Number(live);
        } else {
          const gc = Number(data.guestCounts?.[venue] || 0);
          parPans = Number(recipe.pars?.[venue]?.[String(gc)] || 0);
        }
      }
      const statusMap = data.sentParStatus?.[venue] || {};
      const status = String(statusMap[recipe.id] || "").toLowerCase();

      const sentForVenue = Number(
        perVenueTotals?.[venue]?.[recipe.id] ??
        data.sentPars?.[venue]?.[recipe.id] ??
        0
      );

      if (parPans <= 0 && !(sentForVenue > 0 || status === "na" || status === "received")) {
        continue;
      }

      // 2) Compute REMAINING (for completion styling/ordering only)
      let remaining = 0;

      if (venue === "Concessions") {
        // lbs-based baseline logic (unchanged)
        const sentAtBaseline = Number(finalSentBase?.[recipe.id] || 0);
        const sentNow = Number(data.sentPars?.Concessions?.[recipe.id] || 0); // lbs
        const effectiveSentSinceIncrease = Math.max(0, sentNow - sentAtBaseline);
        remaining = Math.max(0, parPans - effectiveSentSinceIncrease);
      } else {
        // ✅ Buffet venues: use exact quantity sent today from per-venue totals
        remaining = Math.max(0, parPans - sentForVenue);
      }

      // 👉 Always render, even if remaining <= 0
      const sentSoFar = sentForVenue;

      const cacheKey  = `${getTodayDate()}|${venue}|${recipe.id}`;
      const cachedVal = window.mainStartingQtyCache[cacheKey] ?? "";

      const row = document.createElement("tr");
      row.dataset.recipeId = recipe.id;
      row.dataset.venue    = venue;
      decorateVenueRow(row, venue);

      const uom = recipe.uom || "ea";
      const safeVenue = escapeHtml(venue);
      const safeUom = escapeHtml(uom);
      const description = recipe.description || recipe.recipeNo || recipe.id;
      const safeDescription = escapeHtml(description);
      const showBreakdown = !venueFilter && recipeVenues.length > 1;
      const breakdownParts = showBreakdown
        ? recipeVenues.map(name => {
            const qty = Number(
              perVenueTotals?.[name]?.[recipe.id] ??
              data.sentPars?.[name]?.[recipe.id] ??
              0
            );
            const qtyDisplay = fmt(qty);
            const safeName = escapeHtml(name);
            return name === venue
              ? `${safeName}: <strong>${qtyDisplay}</strong>`
              : `${safeName}: ${qtyDisplay}`;
          })
        : null;

      const sentBadge = showBreakdown && breakdownParts?.length
        ? `<div class="sent-meta">Sent today — ${breakdownParts.join(" • ")} ${safeUom}</div>`
        : `<div class="sent-meta">Sent to ${safeVenue} today: <strong>${fmt(sentSoFar)}</strong> ${safeUom}</div>`;
      const parDisplay = fmt(parPans);

      const isCompleted = (remaining <= 0) || (status === "na") || (status === "received") || (sentSoFar > 0);
      if (isCompleted) {
        row.classList.add("row-completed");
      }

      const controls = (status === "na")
        ? `<span class="status-pill status-pill--na">Marked NA</span>`
        : `
            <div class="starting-actions">
              <input class="send-qty-input" type="text" inputmode="decimal"
                     value="${cachedVal}"
                     placeholder="0"
                     data-cache-key="${cacheKey}" />
              <button class="starting-send" onclick="sendSingleStartingPar('${recipe.id}', '${venue}', this)">Send</button>
              <button class="starting-na" onclick="markStartingParNA && markStartingParNA('${recipe.id}', '${venue}', this)">NA</button>
            </div>
          `;

      // ✅ SHOW TARGET in Par Qty cell (parPans), not remaining
      row.innerHTML = `
        <td data-label="Area"><span class="venue-pill">${safeVenue}</span></td>
        <td data-label="Item"><div class="item-cell"><span class="item-title">${safeDescription}</span>${sentBadge}</div></td>
        <td data-label="Par Qty">${parDisplay}</td>
        <td data-label="UOM">${safeUom}</td>
        <td data-label="Send / NA">${controls}</td>
      `;
      tbody.appendChild(row);
      totalRows++;

      const input = row.querySelector('.send-qty-input');
      if (input) {
        input.setAttribute("aria-label", `Quantity to send for ${description}`);
        input.addEventListener('input', () => {
          window.mainStartingQtyCache[cacheKey] = input.value;
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const v = typeof normalizeQtyInputValue === 'function'
              ? normalizeQtyInputValue(input)
              : Number(input.value);
            if (Number.isFinite(v)) {
              input.value = String(v);
              window.mainStartingQtyCache[cacheKey] = input.value;
              input.select?.();
            }
          }
        });
        input.addEventListener('blur', () => {
          const v = typeof normalizeQtyInputValue === 'function'
            ? normalizeQtyInputValue(input)
            : Number(input.value);
          if (Number.isFinite(v)) {
            input.value = String(v);
            window.mainStartingQtyCache[cacheKey] = input.value;
          }
        });
      }
    }
  });

  // Keep completed/NA rows at the bottom
  const allRows = Array.from(tbody.querySelectorAll("tr"));
  const active = [];
  const completed = [];
  allRows.forEach(r => (r.classList.contains("row-completed") ? completed : active).push(r));
  tbody.innerHTML = "";
  active.forEach(r => tbody.appendChild(r));
  completed.forEach(r => tbody.appendChild(r));

  enableMathOnInputs(".send-qty-input", table);
  console.log(`✅ Rendered ${totalRows} rows (Par Qty = target; completion uses remaining; sent-so-far badge intact).`);
};





document.getElementById("starting-filter-venue").addEventListener("change", () => {
  renderMainKitchenPars();
});
document.getElementById("starting-filter-station").addEventListener("change", () => {
  renderMainKitchenPars();
});


// 🌋 Send-all for Main Kitchen Starting Par (repaint instead of removing rows)
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

    await window.sendStartingPar(recipeId, venue, qty);
    const cacheKey = input?.getAttribute("data-cache-key");
    if (cacheKey && window.mainStartingQtyCache) delete window.mainStartingQtyCache[cacheKey];
    sent++;
  }

  // Repaint so all just-sent rows turn green and drop to the bottom
  try { typeof loadMainKitchenStartingPars === "function" && loadMainKitchenStartingPars(); } catch {}
};


// 🚫 Do not remove the row; repaint table so the item drops to the bottom and shows totals
window.sendSingleStartingPar = async function (recipeId, venue, button) {
  const row = button.closest("tr");
  const input = row.querySelector(".send-qty-input");
  const cacheKey = input?.getAttribute("data-cache-key");

  // Evaluate/normalize (supports math expressions)
  const v = normalizeQtyInputValue?.(input);
  const qtyFromInput = Number.isFinite(v) ? v : NaN;
  const qtyFromCache = cacheKey != null ? Number(window.mainStartingQtyCache?.[cacheKey]) : NaN;
  const sendQty = Number.isFinite(qtyFromInput) ? qtyFromInput : qtyFromCache;

  if (!Number.isFinite(sendQty) || sendQty <= 0) {
    alert("Please enter a valid quantity > 0.");
    return;
  }

  await window.sendStartingPar(recipeId, venue, sendQty); // cumulative writer already in your file

  // Clear any cached value but DO NOT remove the row; re-render so it turns green & moves down
  if (cacheKey && window.mainStartingQtyCache) delete window.mainStartingQtyCache[cacheKey];
  if (window.mainStartingInputCache) delete window.mainStartingInputCache[cacheKey];

  // Reload the Main Kitchen Starting Pars to reflect updated totals/status
  try { typeof loadMainKitchenStartingPars === "function" && loadMainKitchenStartingPars(); } catch {}
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


// 📌 Mark Starting Par item as NA for today (drops to bottom, turns green)
window.markStartingParNA = async function (recipeId, venue, button) {
  const today = getTodayDate();
  const venueName = canonicalizeVenueName(venue) || String(venue || "").trim();
  const orderId  = `startingPar_${today}_${venueName}_${recipeId}`;
  const orderRef = doc(db, "orders", orderId);

  try {
    // Ensure doc exists with minimum shape so renderer can find it
    await setDoc(orderRef, {
      type: "starting-par",
      date: today,
      venue: venueName,
      recipeId,
      status: "na",
      updatedAt: serverTimestamp(),
    }, { merge: true });

    // Repaint the table so it moves to bottom and turns green
    try { typeof loadMainKitchenStartingPars === "function" && loadMainKitchenStartingPars(); } catch {}
  } catch (e) {
    console.error("markStartingParNA failed:", e);
    alert("Failed to mark item as NA.");
  }
};


// ✅ Global so Send + Send All can call it
// Prevent rapid double-clicks while a send is in progress
// one-time guard set
window._startingParInFlight = window._startingParInFlight || new Set();

function round2(n){ return Number((Math.round((Number(n)||0)*100)/100).toFixed(2)); }

window.sendStartingPar = async function (recipeId, venue, sendQtyInput) {
  // local, in-window lock (helps UX; the transaction is the real guard)
  window._startingParInFlight ||= new Set();

  const venueName = canonicalizeVenueName(venue) || String(venue || "").trim();
  if (!venueName) {
    console.warn("❌ sendStartingPar called without a valid venue", { recipeId, venue });
    return;
  }

  function getTodayISO() {
    try { return (typeof getTodayDate === "function") ? getTodayDate() : new Date().toISOString().slice(0,10); }
    catch { return new Date().toISOString().slice(0,10); }
  }
  function newActionId() {
    try { return (crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`; }
    catch { return `${Date.now()}_${Math.random().toString(36).slice(2)}`; }
  }
  function r2(n){ return Math.round((Number(n)||0)*100)/100; } // safe round2 if you don't already have one

  const today = getTodayISO();
  const key = `${today}|${venueName}|${recipeId}`;
  if (window._startingParInFlight.has(key)) return;
  window._startingParInFlight.add(key);

  try {
    // 1) Load guest count for today's PAR lookup
    const gcSnap = await getDoc(doc(db, "guestCounts", today));
    const guestCounts = gcSnap.exists() ? (gcSnap.data() || {}) : {};
    const guestCount = Number(guestCounts?.[venueName] || 0);

    // 2) Load recipe
    const rSnap = await getDoc(doc(db, "recipes", recipeId));
    if (!rSnap.exists()) { console.warn(`❌ Recipe ${recipeId} not found`); return; }
    const r = rSnap.data() || {};
    const recipeNo  = (r.recipeNo || recipeId).toString().toUpperCase();
    const costPerLb = Number(r.cost ?? r.costPerLb ?? 0);
    const panWeight = Number(r.panWeight ?? 0);

    // 3) Determine today's needed pans (PAR snapshot)
    const currentPar = Number(r?.pars?.[venueName]?.[String(guestCount)] || 0);
    const pans       = Math.max(0, currentPar);

    // 4) User input: gross pounds typed on screen
    const sendQtyGross = Number(sendQtyInput);
    if (!Number.isFinite(sendQtyGross) || sendQtyGross <= 0) {
      alert("❌ Please enter a valid gross weight (lbs).");
      return;
    }

    // 5) Compute net (subtract pan weight × pans), and total cost
    const netWeightAdd = r2(Math.max(0, sendQtyGross - (panWeight * pans)));
    const totalCostAdd = r2(netWeightAdd * costPerLb);

    // 6) Deterministic per-day doc (cumulative across multiple sends that day)
    const orderId  = `startingPar_${today}_${venueName}_${recipeId}`;
    const orderRef = doc(db, "orders", orderId);
    const actionId = newActionId();

    // 7) Transaction w/ idempotency + atomic increments
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(orderRef);
      const now = serverTimestamp();

      if (snap.exists()) {
        const data = snap.data() || {};
        // if this exact action was already applied, do nothing
        if (data.applied && data.applied[actionId]) return;

        tx.update(orderRef, {
          // keep your shape up to date each send
          type: "starting-par",
          venue: venueName,
          recipeId,
          recipeNo,
          date: today,
          costPerLb: Number(costPerLb),
          panWeight: Number(panWeight),
          pans: Number(pans), // snapshot of today's needed pans

          // atomic increments prevent double-add from races
          sendQty: increment(r2(sendQtyGross)),
          netWeight: increment(r2(netWeightAdd)),
          totalCost: increment(r2(totalCostAdd)),

          // lifecycle
          status: (data.status === "received") ? "received" : "sent",
          received: Boolean(data.received || false),
          receivedAt: data.receivedAt || null,

          // timestamps
          sentAt: data.sentAt || now,
          timestamp: data.timestamp || now,
          updatedAt: now,

          // idempotency token recorded
          [`applied.${actionId}`]: true,
        });
      } else {
        tx.set(orderRef, {
          type: "starting-par",
          venue: venueName,
          recipeId,
          recipeNo,
          date: today,
          costPerLb: Number(costPerLb),
          panWeight: Number(panWeight),
          pans: Number(pans),
          sendQty: r2(sendQtyGross),
          netWeight: r2(netWeightAdd),
          totalCost: r2(totalCostAdd),

          status: "sent",
          received: false,
          receivedAt: null,

          sentAt: now,
          timestamp: now,
          updatedAt: now,

          applied: { [actionId]: true },
        });
      }
    });

    console.log("✅ Starting-par recorded (idempotent)", { recipeNo, venue: venueName, sendQtyGross, pans, panWeight, netWeightAdd, totalCostAdd });
  } catch (err) {
    console.error("❌ Failed to send starting-par:", err);
    throw err;
  } finally {
    window._startingParInFlight.delete(key);
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
const station = window.stationForOrder({ ...recipeData, recipeNo }, "Gateway");

    const order = {
      item: recipeData.description || recipeNo,
      qty: qty,
      status: "open",
      venue: "Gateway",
      station,
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
  where("status", "in", ["open", "fired", "Ready to Send", "sent", "received"]),
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
    const orderMap = { sent: 0, "Ready to Send": 1, fired: 2, open: 3 };
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


  const station = window.stationForOrder({ ...recipeData, recipeNo }, "Ohana");

const order = {
  item: recipeData.description || recipeNo,
  qty,
  status: "open",
  venue: "Ohana",
  station, // ✅ override-aware
  recipeNo,
  cookTime: recipeData.cookTime || 0,
  notes,
  uom: recipeData.uom || "ea",
  timestamp: serverTimestamp(),
  date: getTodayDate(),
  type: "addon",
  totalCost
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
  where("status", "in", ["open", "fired", "Ready to Send", "sent", "received"]),
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
    const statusOrder = { sent: 0, "Ready to Send": 1, fired: 2, open: 3 };
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
    where("status", "in", ["open", "fired", "Ready to Send", "sent"]),
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
    const statusOrder = { sent: 0, "Ready to Send": 1, fired: 2, open: 3 };
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
    const info = document.getElementById("ohanaGuestInfo");
    if (info) info.textContent = "⚠️ No guest count for today.";
    return;
  }

  const guestData = guestSnap.data();
  console.log("🌺 Full Ohana guest data:", guestData);

  // Saved (Firestore) guest count
  const savedGuestCount = Number(guestData?.Ohana || 0);
  // Live Showware total if available
  const liveShowware = (typeof window.swHasTotal === "function") ? window.swHasTotal("Ohana") : null;

  // Display: prefer live Showware on the label
  const displayCount = ((liveShowware ?? savedGuestCount) || 0); // grouped to avoid TS error
  const infoEl = document.getElementById("ohanaGuestInfo");
  if (infoEl) infoEl.textContent = `👥 Guest Count: ${displayCount}`;

  // 🔍 Load recipes for Ohana (venueCode b002)
  const recipesRef = collection(db, "recipes");
  const q = query(recipesRef, where("venueCodes", "array-contains", "b002"));
  const snapshot = await getDocs(q);
  const recipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // 🔁 Today's starting-par orders for Ohana
  const ordersQuery = query(
    collection(db, "orders"),
    where("type", "==", "starting-par"),
    where("venue", "==", "Ohana"),
    where("date", "==", today)
  );
  const ordersSnap = await getDocs(ordersQuery);

  // 👉 Aggregate Firestore sendQty per recipeId (mirror Aloha)
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

  // 🧮 parQty:
  //   • Normal items: use r.pars.Ohana[savedGuestCount]
  //   • R0425 (Pineapple Shells): force to *live* Showware total if available, else saved
  const computedRecipes = recipes.map(r => {
    const targetFromPars = Number(r.pars?.Ohana?.[String(savedGuestCount)] || 0);
    const sentQty        = Number(sentQtyByRecipe[r.id] || 0);

    const recipeNo = String(r.recipeNo || "").toUpperCase().trim();
    const isR0425  = recipeNo === "R0425" || /pineapple\s*shell/i.test(String(r.description || ""));

    const overridePar = isR0425
      ? Number(((liveShowware ?? savedGuestCount) || 0)) // grouped to avoid TS error
      : targetFromPars;

    return {
      ...r,
      targetPar: overridePar,
      parQty: overridePar, // exact target, not remaining
      sentQty
    };
  });

  // 🗂️ Cache & render
  window.startingCache = window.startingCache || {};
  window.startingCache["Ohana"] = {
    recipes: computedRecipes,
    // Keep saved guest count in cache; renderer will prefer live for R0425
    guestCount: savedGuestCount,
    sentPars: sentQtyByRecipe,
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
const chatUnreadBadge = document.getElementById("chatUnreadBadge");
let isChatMinimized = false;
let chatUnsubscribe = null;
let latestMessageTimestampMs = null;
let lastReadTimestampMs = null;
let chatUnreadCount = 0;

const CHAT_VENUE_CLASS_MAP = {
  aloha: "chat-message-aloha",
  ohana: "chat-message-ohana",
  gateway: "chat-message-gateway",
  "main kitchen": "chat-message-main-kitchen",
  "main-kitchen": "chat-message-main-kitchen",
};

function getChatClassForSender(sender = "") {
  const key = String(sender).trim().toLowerCase();
  return CHAT_VENUE_CLASS_MAP[key] || "chat-message-other";
}

function formatChatTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function buildChatMessageElement({ sender, message, timestamp }) {
  const messageEl = document.createElement("div");
  messageEl.className = `chat-message ${getChatClassForSender(sender)}`;

  const meta = document.createElement("div");
  meta.className = "chat-message-meta";

  const senderEl = document.createElement("span");
  senderEl.className = "chat-sender";
  senderEl.textContent = sender || "Unknown";

  const timeEl = document.createElement("span");
  timeEl.className = "chat-time";
  timeEl.textContent = formatChatTime(timestamp);

  meta.append(senderEl, timeEl);

  const textEl = document.createElement("div");
  textEl.className = "chat-text";
  textEl.textContent = message || "";

  messageEl.append(meta, textEl);
  return messageEl;
}

function updateUnreadBadge() {
  if (!chatUnreadBadge) return;
  if (chatUnreadCount > 0) {
    const displayValue = chatUnreadCount > 9 ? "9+" : String(chatUnreadCount);
    chatUnreadBadge.textContent = displayValue;
    chatUnreadBadge.style.display = "inline-flex";
  } else {
    chatUnreadBadge.textContent = "";
    chatUnreadBadge.style.display = "none";
  }
}

function markChatAsRead() {
  if (latestMessageTimestampMs) {
    lastReadTimestampMs = latestMessageTimestampMs;
  } else if (lastReadTimestampMs === null) {
    lastReadTimestampMs = 0;
  }
  chatUnreadCount = 0;
  updateUnreadBadge();
  chatBox?.classList.remove("highlight");
}

function extractMessageDate(docSnap) {
  const ts = docSnap.data()?.timestamp;
  if (ts?.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  if (typeof ts === "number") return new Date(ts);
  if (docSnap.metadata?.hasPendingWrites) return new Date();
  return null;
}

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
    if (!chatMessages) return;

    chatMessages.innerHTML = "";

    let newestTimestampMs = latestMessageTimestampMs;
    let unreadDetected = 0;

    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const messageDate = extractMessageDate(docSnap);
      const messageMs = messageDate ? messageDate.getTime() : 0;

      if (!newestTimestampMs || (messageMs && messageMs > newestTimestampMs)) {
        newestTimestampMs = messageMs;
      }

      if (lastReadTimestampMs !== null && messageMs > lastReadTimestampMs) {
        unreadDetected += 1;
      }

      const messageEl = buildChatMessageElement({
        sender: data.sender,
        message: data.message,
        timestamp: messageDate,
      });
      chatMessages.appendChild(messageEl);
    });

    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (newestTimestampMs) {
      latestMessageTimestampMs = newestTimestampMs;
    }

    if (!isChatMinimized) {
      markChatAsRead();
    } else {
      if (lastReadTimestampMs === null) {
        lastReadTimestampMs = latestMessageTimestampMs;
        chatUnreadCount = 0;
      } else {
        chatUnreadCount = unreadDetected;
        if (chatUnreadCount > 0) {
          chatBox?.classList.add("highlight");
        } else {
          chatBox?.classList.remove("highlight");
        }
      }
      updateUnreadBadge();
    }
  });
}

function stopChatListener() {
  if (chatUnsubscribe) {
    chatUnsubscribe();
    chatUnsubscribe = null;
  }
}

// 🔁 Toggle chat visibility and listener
if (chatToggleBtn) {
  chatToggleBtn.addEventListener("click", () => {
    isChatMinimized = !isChatMinimized;
    chatBox?.classList.toggle("minimized", isChatMinimized);

    if (!isChatMinimized) {
      markChatAsRead();
    }
  });
}

// ✅ Start listening if chat is visible at page load
if (!isChatMinimized) {
  startChatListener();
}

// ✉️ Show temporary new message if chat is minimized
function handleNewChatMessage(messageText, sender = "Other") {
  const chatMessages = document.getElementById("chatMessages");
  if (!chatMessages) return;
  const now = new Date();
  const messageEl = buildChatMessageElement({ sender, message: messageText, timestamp: now });
  chatMessages.appendChild(messageEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  if (isChatMinimized) {
    if (latestMessageTimestampMs === null) {
      latestMessageTimestampMs = now.getTime();
    }
    chatUnreadCount += 1;
    updateUnreadBadge();
    chatBox?.classList.add("highlight");
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

  // Keep your existing override behavior
  const onInput = (e) => {
    const el = e.target;
    if (!el.classList.contains("acct-qty-input")) return;
    setAcctQty(el.dataset.tab, el.dataset.key, el.value);
  };
  tbody.removeEventListener("input", onInput);
  tbody.addEventListener("input", onInput);

  // NEW: delegated click handler for expanding description → details
  if (!tbody._onProdToggle) {
    tbody._onProdToggle = async (e) => {
      const btn = e.target.closest(".prod-desc-toggle");
      if (!btn) return;
      const row = btn.closest("tr");
      const recipeNo = btn.dataset.recipeNo;
      await toggleProductionDetailRow(row, recipeNo);
    };
    tbody.addEventListener("click", tbody._onProdToggle);
  }

  // Build rows
  for (const recipeNo of recipeKeyList) {
    const item = summaryMap.get(recipeNo);
    const tr = document.createElement("tr");
    tr.dataset.recipeNo = item.recipeNo; // stable key for the detail row

    const prodKey = item.recipeNo; // key for storing edits
    const prodQty = getAcctQty("production", prodKey, Number(item.total) || 0);

   tr.innerHTML = `
  <td>${item.submenuCode || ""}</td>
  <td>${item.dishCode}</td>
  <td>${item.recipeNo}</td>
  <td>
    <button class="prod-desc-toggle" data-recipe-no="${item.recipeNo}" style="all:unset; color:#3b82f6; cursor:pointer; text-decoration:underline;">
      ${item.description}
    </button>
  </td>
  <td>
    <input
      type="number"
      step="0.01"
      min="0"
      class="acct-qty-input"
      data-tab="production"
      data-key="${prodKey}"
      value="${prodQty}"
      readonly
      aria-readonly="true"
      tabindex="-1"
      title="View details to edit individual orders"
      style="width: 90px; text-align: right; background: rgba(255,255,255,0.04); cursor: not-allowed;"
    />
  </td>
`;

    tbody.appendChild(tr);
  }
};


async function toggleProductionDetailRow(anchorTr, recipeNo) {
  const tbody = anchorTr.parentElement;
  // If an expanded row for this anchor already exists, remove it (collapse)
  const next = anchorTr.nextElementSibling;
  if (next && next.classList.contains("prod-detail-row")) {
    next.remove();
    return;
  }

  // Collapse any other open detail row to keep things tidy
  Array.from(tbody.querySelectorAll(".prod-detail-row")).forEach(r => r.remove());

  // Build the detail row shell
  const detailTr = document.createElement("tr");
  detailTr.className = "prod-detail-row";
  const detailTd = document.createElement("td");
  detailTd.colSpan = 5;
  detailTd.innerHTML = `
    <div style="padding:10px; background: hsl(0 0% 100% / 0.03); border:1px solid hsl(0 0% 100% / 0.08); border-radius:8px;">
      <div style="font-weight:600; margin-bottom:8px;">Orders for ${recipeNo}</div>
      <div style="margin-bottom:10px; font-size:12px; opacity:.7">Edit a quantity and press <strong>Enter</strong> to save to Firestore.</div>
      <table style="width:100%; border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left; padding:6px 4px;">Type</th>
            <th style="text-align:left; padding:6px 4px;">Venue</th>
            <th style="text-align:left; padding:6px 4px;">Station</th>
            <th style="text-align:left; padding:6px 4px;">Order ID</th>
            <th style="text-align:right; padding:6px 4px;">Qty</th>
          </tr>
        </thead>
        <tbody class="prod-detail-body">
          <tr><td colspan="5" style="padding:8px; font-style:italic; color:gray;">Loading…</td></tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="4" style="text-align:right; padding:8px; font-weight:600;">Sum</td>
            <td style="text-align:right; padding:8px;"><span class="prod-detail-sum">0</span></td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
  detailTr.appendChild(detailTd);
  anchorTr.after(detailTr);

  const bodyEl = detailTd.querySelector(".prod-detail-body");
  const sumEl  = detailTd.querySelector(".prod-detail-sum");

  // Pull today's orders for this recipe
  const todayStr = (typeof getTodayDate === "function") ? getTodayDate() : new Date().toISOString().slice(0,10);
  const q = query(
    collection(db, "orders"),
    where("date", "==", todayStr),
    where("recipeNo", "==", recipeNo)
  );
  const snap = await getDocs(q);

  bodyEl.innerHTML = ""; // clear loading row

  // Build rows
  let running = 0;
  snap.forEach(docSnap => {
    const d = docSnap.data() || {};
    const id = docSnap.id;
    const type = String(d.type || "").toLowerCase();
    const venue = d.venue || "";
    const station = d.station || "";
    // Same quantity rules as your Production Summary
    const qtySP = Number(d.netWeight ?? d.sendQty ?? d.qty ?? 0);
    const qtyAO = Number(d.sendQty ?? d.qty ?? d.netWeight ?? 0);
    const qty   = (type === "starting-par") ? qtySP : qtyAO;

    if (!Number.isFinite(qty) || qty <= 0) return;

    running += qty;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="padding:6px 4px;">${type || ""}</td>
      <td style="padding:6px 4px;">${venue || ""}</td>
      <td style="padding:6px 4px;">${station || ""}</td>
      <td style="padding:6px 4px; font-family:monospace;">${id}</td>
      <td style="padding:6px 4px; text-align:right;">
        <input
          type="number"
          step="0.01"
          min="0"
          value="${qty}"
          class="prod-order-edit"
          data-order-id="${id}"
          data-order-type="${type}"
          style="width:90px; text-align:right;"
          title="Press Enter to save"
        />
      </td>
    `;
    bodyEl.appendChild(tr);
  });

  if (!bodyEl.children.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" style="padding:8px; font-style:italic; color:gray;">No orders found for this recipe today.</td>`;
    bodyEl.appendChild(tr);
  }
  sumEl.textContent = running.toFixed(2);

  // Handle inline saves: Enter to persist, then refresh sum + parent total
  const onKeydown = async (e) => {
    const el = e.target;
    if (!el.classList?.contains?.("prod-order-edit")) return;
    if (e.key !== "Enter") return;
    e.preventDefault();

    const orderId = el.dataset.orderId;
    const orderType = el.dataset.orderType; // 'starting-par' or 'add-ons'
    const newQty = Number(el.value);
    if (!Number.isFinite(newQty) || newQty < 0) return;

    // Map which field to update, following the same precedence used in your totals:
    // starting-par → write netWeight; add-ons → write sendQty (and mirror qty for consistency)
    // Update fields per order type:
const update =
  (orderType === "starting-par")
    ? { netWeight: newQty, sendQty: newQty }
    : { qty: newQty, sendQty: newQty };


    try {
      await updateDoc(doc(db, "orders", orderId), update);
      // Recompute the detail sum
      let sum = 0;
      bodyEl.querySelectorAll(".prod-order-edit").forEach(input => {
        const v = Number(input.value);
        if (Number.isFinite(v)) sum += v;
      });
      sumEl.textContent = sum.toFixed(2);

      // Update the parent row's Production Summary qty input (to keep UI consistent)
      const parentQtyInput = anchorTr.querySelector('input.acct-qty-input[data-tab="production"]');
      if (parentQtyInput) {
        parentQtyInput.value = sum.toFixed(2);
        // also keep overrides map in sync if you use it elsewhere
        setAcctQty("production", recipeNo, sum);
      }

      // Optional: subtle flash to confirm save
      el.style.outline = "2px solid #22c55e";
      setTimeout(() => (el.style.outline = ""), 400);
    } catch (err) {
      console.error("Failed to update order:", err);
      el.style.outline = "2px solid #ef4444";
      setTimeout(() => (el.style.outline = ""), 800);
      alert("Save failed. Check console.");
    }
  };

  // Avoid stacking listeners
  if (detailTd._onOrderEdit) detailTd.removeEventListener("keydown", detailTd._onOrderEdit, true);
  detailTd._onOrderEdit = onKeydown;
  detailTd.addEventListener("keydown", detailTd._onOrderEdit, true);
}


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
// === Sync Production Shipment override → today's orders doc(s) ===
async function syncProdOverrideIntoOrders(venueCode, recipeNo, newQty) {
  try {
    const today = getTodayDate();
    const sendQtyGross = Number(newQty);
    if (!Number.isFinite(sendQtyGross) || sendQtyGross <= 0) return;

    // 1) Map code → venue name (b001→Aloha, etc.)
    function codeToVenueName(code) {
      const map = window.venueCodes || { Aloha: "B001", Ohana: "B002", Gateway: "B003", Concessions: "C002" };
      const found = Object.entries(map).find(([, v]) => String(v).toLowerCase() === String(code).toLowerCase());
      return found ? found[0] : code;
    }
    const venueName = codeToVenueName(venueCode);

    // 2) Load today’s guest counts (for PAR lookup)
    const gcSnap = await getDoc(doc(db, "guestCounts", today));
    const guestCounts = gcSnap.exists() ? (gcSnap.data() || {}) : {};
    const guestCount  = Number(guestCounts?.[venueName] || 0);

    // 3) Lookup recipe by recipeNo (we need recipeId, pars, costPerLb, panWeight)
    const qR = query(
      collection(db, "recipes"),
      where("recipeNo", "==", String(recipeNo).toUpperCase())
    );
    const sR = await getDocs(qR);
    if (sR.empty) {
      console.warn("❌ Recipe not found for override:", recipeNo);
      return;
    }
    const rDoc       = sR.docs[0];
    const recipeId   = rDoc.id;
    const r          = rDoc.data() || {};
    const rNo        = (r.recipeNo || recipeNo).toString().toUpperCase();
    const costPerLb  = Number(r.cost ?? r.costPerLb ?? 0);
    const panWeight  = Number(r.panWeight ?? 0);
    const currentPar = Number(r?.pars?.[venueName]?.[String(guestCount)] || 0);
    const pans       = Math.max(0, currentPar);

    // 4) Compute net + total to match sendStartingPar
    const round2         = (n) => Number((Math.round((Number(n)||0)*100)/100).toFixed(2));
    const netWeightAdd   = round2(Math.max(0, sendQtyGross - (panWeight * pans)));
    const totalCostAdd   = round2(netWeightAdd * costPerLb);

    // 5) Upsert deterministic per-day doc (same ID as sender)
    const orderId  = `startingPar_${today}_${venueName}_${recipeId}`;
    const orderRef = doc(db, "orders", orderId);
    const existing = await getDoc(orderRef);
    const nowTs    = Timestamp.now();

    if (existing.exists()) {
      const prev = existing.data() || {};
      await updateDoc(orderRef, {
        // required shape (keep exactly in sync with sendStartingPar)
        type: "starting-par",
        venue: venueName,
        recipeId,
        recipeNo: rNo,
        date: today,
        costPerLb: Number(costPerLb),
        panWeight: Number(panWeight),
        pans: Number(pans), // snapshot of today’s needed pans

        // cumulative adds
        sendQty:     round2((Number(prev.sendQty   || 0)) + sendQtyGross),
        netWeight:   round2((Number(prev.netWeight || 0)) + netWeightAdd),
        totalCost:   round2((Number(prev.totalCost || 0)) + totalCostAdd),

        // lifecycle (don’t clobber a received doc)
        status:   prev.status === "received" ? "received" : "sent",
        received: Boolean(prev.received || false),
        receivedAt: prev.receivedAt || null,

        // timestamps (preserve first sentAt/timestamp)
        sentAt:     prev.sentAt     || nowTs,
        timestamp:  prev.timestamp  || nowTs,
        updatedAt:  nowTs,
      });
    } else {
      await setDoc(orderRef, {
        // required shape
        type: "starting-par",
        venue: venueName,
        recipeId,
        recipeNo: rNo,
        date: today,
        costPerLb: Number(costPerLb),
        panWeight: Number(panWeight),
        pans: Number(pans),

        // first write = exact values for this override push
        sendQty:   round2(sendQtyGross),
        netWeight: netWeightAdd,
        totalCost: totalCostAdd,

        // lifecycle at SEND time
        status: "sent",
        received: false,
        receivedAt: null,

        // timestamps
        sentAt: nowTs,
        timestamp: nowTs,
        updatedAt: nowTs,
      });
    }

    console.log("✅ Override synced as starting-par:", {
      orderId, venueName, recipeNo: rNo, recipeId, sendQtyGross, pans, panWeight, netWeightAdd, totalCostAdd
    });
  } catch (err) {
    console.error("❌ syncProdOverrideIntoOrders failed:", err);
    alert("❌ Failed to sync override to orders.");
  }
}



// 📤 Show one venue shipment (aggregated by recipe for the venue code)
// 🔄 UPDATED: friendlier typing + reliable Firestore saves
window.loadVenueShipment = async function (venueCode) {
  window.currentVenueCode = venueCode;

  // ---- helpers (unchanged)
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

  // ---- mount
  const container = document.getElementById("singleVenueShipmentContainer");
  container.innerHTML = "";

  // preload overrides
  try { await window.preloadProdShipmentOverridesForVenue(venueCode); } catch (e) { console.debug(e); }

  const venueLabel = (window.venueNames && window.venueNames[venueCode]) || venueCode.toUpperCase();
  const shipments = (window.allShipmentData || []).filter(
    s => String(s.venueCode || "").toLowerCase() === String(venueCode).toLowerCase()
  );

  // aggregate
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
    // 🧯 de-dupe old listeners
    if (body._onProdInput)   body.removeEventListener("input", body._onProdInput);
    if (body._onProdBlur)    body.removeEventListener("blur", body._onProdBlur, true);
    if (body._onProdKeydown) body.removeEventListener("keydown", body._onProdKeydown, true);

    // Keep the same listener variables, but hard-guard them so readonly inputs are ignored
    body._onProdInput = (e) => {
      const el = e.target;
      if (!el.classList?.contains("acct-qty-input")) return;
      if (el.hasAttribute("readonly")) return; // 🔒 ignore
      if (!window.accountingQtyOverrides) window.accountingQtyOverrides = {};
      if (!window.accountingQtyOverrides.productionShipments) window.accountingQtyOverrides.productionShipments = new Map();
      window.accountingQtyOverrides.productionShipments.set(el.dataset.key, el.value);
    };
    body.addEventListener("input", body._onProdInput);

    body._onProdKeydown = (e) => {
      const el = e.target;
      if (!(el?.classList?.contains("acct-qty-input"))) return;
      if (el.hasAttribute("readonly")) return; // 🔒 ignore
      if (e.key !== "Enter") return;

      e.preventDefault();
      const v = (typeof normalizeQtyInputValue === "function")
        ? normalizeQtyInputValue(el)
        : Number(el.value);
      if (!Number.isFinite(v)) return;

      const [vCode, recipeNo] = String(el.dataset.key || "").split("__");
      if (!vCode || !recipeNo) return;

      window._prodSaveTimers = window._prodSaveTimers || {};
      const tKey = `prod__${el.dataset.key}`;
      clearTimeout(window._prodSaveTimers[tKey]);
      window._prodSaveTimers[tKey] = setTimeout(async () => {
        try {
          await window.saveProdShipmentOverride(vCode, recipeNo, v);
          if (typeof syncProdOverrideIntoOrders === "function") {
            await syncProdOverrideIntoOrders(vCode, recipeNo, v);
          }
        } catch (err) {
          console.error("persist override + sync orders failed:", err);
        }
      }, 200);

      el.select?.();
    };
    body.addEventListener("keydown", body._onProdKeydown, true);

    body._onProdBlur = (e) => {
      const el = e.target;
      if (!el.classList?.contains("acct-qty-input")) return;
      if (el.hasAttribute("readonly")) return; // 🔒 ignore

      const v = (typeof normalizeQtyInputValue === "function")
        ? normalizeQtyInputValue(el)
        : Number(el.value);
      if (!Number.isFinite(v)) return;

      const [vCode, recipeNo] = String(el.dataset.key || "").split("__");
      if (!vCode || !recipeNo) return;

      window._prodSaveTimers = window._prodSaveTimers || {};
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

      const overrideKey = `${venueCode}__${recipeNo}`;
      const persisted   = window.accountingQtyOverrides?.productionShipments?.get(overrideKey);
      const fallbackVal = Number(quantity) || 0;
      const initial =
        (persisted != null && persisted !== "")
          ? persisted
          : (typeof getAcctQty === "function"
              ? getAcctQty("productionShipments", overrideKey, fallbackVal)
              : fallbackVal);

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
            readonly
            aria-readonly="true"
            tabindex="-1"
            title="Shipments are view-only."
            style="width:90px; text-align:right; background:rgba(255,255,255,0.04); cursor:not-allowed; pointer-events:none;"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
          />
        </td>
      `;
      body.appendChild(tr);
    });

    // You can keep this; inputs are readonly so helpers won't change values anyway
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
// ===== Analytics Dashboard (Tabs: COGS / Timing / Qty per Guest) =====
(() => {
  'use strict';

  // -------------------- State --------------------
  const S = (window.analyticsState = window.analyticsState || {
    start: null, end: null, venue: "All", section: "All",
    charts: { categoryLine: null },
    timingOutlierMode: 'all',
    // COGS-only filters:
    allCategories: new Set(),
    allItems: new Set(),
    selectedCategories: new Set(),
    selectedItems: new Set(),
    // collections
    SHOWWARE_COLL: window.SHOWWARE_COLL || "showwareEvents",
  });

  // -------------------- Public entry --------------------
  window.initAnalyticsDashboard = async function initAnalyticsDashboard() {
    // default last 7 days
    const today = new Date();
    const endStr = toYMD(today);
    const start = new Date(today); start.setDate(start.getDate() - 6);
    const startStr = toYMD(start);

    const startEl = document.getElementById("fStart");
    const endEl   = document.getElementById("fEnd");
    if (startEl && !startEl.value) startEl.value = startStr;
    if (endEl && !endEl.value)     endEl.value   = endStr;

    // populate Sections (from recipes)
    await ensureSectionsPopulated();

    // filters area (checkbox handlers)
    // Timing outlier controls
    const timingControls = document.getElementById("timingOutlierControls");
    if (timingControls && !timingControls.dataset.ready){
      timingControls.dataset.ready = '1';
      timingControls.querySelectorAll('button[data-mode]').forEach(btn => {
        btn.addEventListener('click', () => setTimingOutlierMode(btn.dataset.mode));
      });
    }
    updateTimingOutlierButtons();

    const copyTimingBtn = document.getElementById("copyTimingTableBtn");
    if (copyTimingBtn && !copyTimingBtn.dataset.ready){
      copyTimingBtn.dataset.ready = '1';
      copyTimingBtn.addEventListener('click', () => copyFoodTimingTable());
    }

    hydrateFilterUI();

    // Apply button: run active tab
    const applyBtn = document.getElementById("applyAnalyticsFilters");
    applyBtn?.addEventListener("click", runActiveTab);

    // Item search typing
    document.getElementById("filterItemSearch")?.addEventListener("input", filterItemCheckboxList);

    // First paint (COGS default)
    await runActiveTab();
  };

  // Keep your “showAccountingDashboard” hook working
  window.showAccountingDashboard = function showAccountingDashboard(){
    document.getElementById("analyticsDashboard")?.style && (document.getElementById("analyticsDashboard").style.display="block");
    window.initAnalyticsDashboard();
  };

  // -------------------- DOM helpers --------------------
  function $$(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
  function toYMD(d){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`;}
  function fmtMoney(n){ return `$${Number(n||0).toFixed(2)}`; }
  function escapeHtml(s){ return String(s ?? "").replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m])); }

  // Hawaii-local date helpers
  function isoDateHST(d){
    const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const hst = new Date(utc.getTime() - 10*60*60*1000);
    const y = hst.getUTCFullYear();
    const m = String(hst.getUTCMonth()+1).padStart(2,'0');
    const dd= String(hst.getUTCDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }
  function getHawaiiRangeFromInputs(startId="fStart", endId="fEnd"){
    const s = document.getElementById(startId)?.value;
    const e = document.getElementById(endId)?.value;
    if (!s || !e) return {};
    const startTs = Timestamp.fromDate(new Date(`${s}T10:00:00.000Z`));
    const endNext = new Date(`${e}T10:00:00.000Z`); endNext.setUTCDate(endNext.getUTCDate()+1);
    const endTs   = Timestamp.fromDate(endNext);
    return { startTs, endTs, startStr: s, endStr: e };
  }
  function toFixedOrEmpty(n, d=2){ const x=Number(n); return Number.isFinite(x)?x.toFixed(d):""; }
  function fillTable(tid, rows){
    const tb = document.querySelector(`#${tid} tbody`);
    if (!tb) return;
    if (!rows?.length){
      tb.innerHTML = `<tr><td colspan="999" style="text-align:center;opacity:.7;">No data</td></tr>`;
      return;
    }
    tb.innerHTML = rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(String(c ?? ""))}</td>`).join("")}</tr>`).join("");
  }
  function enumerateDates(startStr, endStr){ const out=[]; const d=new Date(startStr+"T00:00:00"); const e=new Date(endStr+"T00:00:00"); while(d<=e){ out.push(toYMD(d)); d.setDate(d.getDate()+1);} return out;}
  const monthName = (i)=> (["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i]||"");

  // -------------------- Sections dropdown --------------------
  async function ensureSectionsPopulated() {
    const sel = document.getElementById("fSection");
    if (!sel || sel.dataset.ready) return;
    const recipesSnap = await getDocs(collection(db,"recipes"));
    const sections = new Set();
    recipesSnap.forEach(s=>{
      const d = s.data() || {};
      const sec = d.section || d.station || d.category;
      if (sec) sections.add(String(sec));
    });
    [...sections].sort().forEach(s=>{
      const opt=document.createElement("option"); opt.value=s; opt.textContent=s; sel.appendChild(opt);
    });
    sel.dataset.ready = "1";
  }

  // -------------------- COGS Filters UI (checkboxes) --------------------
  function hydrateFilterUI(){
    const catWrap = document.getElementById("filterCatWrap");
    if (catWrap && !catWrap.dataset.ready){
      catWrap.dataset.ready="1";
      catWrap.addEventListener("change", (e)=>{
        const t=e.target;
        if (t?.name==="catChk"){
          if(t.checked) S.selectedCategories.add(t.value);
          else S.selectedCategories.delete(t.value);
          // live re-run only for COGS tab
          if (getActiveTab()==="cogs") runActiveTab();
        }
      });
    }
    const itemWrap = document.getElementById("filterItemWrap");
    if (itemWrap && !itemWrap.dataset.ready){
      itemWrap.dataset.ready="1";
      itemWrap.addEventListener("change",(e)=>{
        const t=e.target;
        if (t?.name==="itemChk"){
          if(t.checked) S.selectedItems.add(t.value);
          else S.selectedItems.delete(t.value);
          if (getActiveTab()==="cogs") runActiveTab();
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
  function rebuildFilterLists(categories, items){
    // categories
    const catWrap = document.getElementById("filterCatWrap");
    if (catWrap){
      const prevSel = new Set(S.selectedCategories);
      catWrap.innerHTML = categories.map(c=>{
        const checked = prevSel.has(c) ? "checked" : "";
        return `<label style="display:flex;gap:8px;align-items:center;margin-right:14px;">
                  <input type="checkbox" name="catChk" value="${escapeHtml(c)}" ${checked}>
                  <span>${escapeHtml(c)}</span>
                </label>`;
      }).join("");
      S.allCategories = new Set(categories);
      // prune old selections
      S.selectedCategories.forEach(c=>{ if(!S.allCategories.has(c)) S.selectedCategories.delete(c); });
    }
    // items
    const itemWrap = document.getElementById("filterItemWrap");
    if (itemWrap){
      const prevSel = new Set(S.selectedItems);
      itemWrap.innerHTML = items.map(key=>{
        const [no, desc] = key.split("__");
        const txt = `${no} ${desc}`.toLowerCase();
        const checked = prevSel.has(key) ? "checked" : "";
        return `<label data-text="${escapeHtml(txt)}" style="display:block; margin:2px 0;">
                  <input type="checkbox" name="itemChk" value="${escapeHtml(key)}" ${checked}>
                  <span>${escapeHtml(no)} — ${escapeHtml(desc)}</span>
                </label>`;
      }).join("");
      S.allItems = new Set(items);
      S.selectedItems.forEach(k=>{ if(!S.allItems.has(k)) S.selectedItems.delete(k); });
      filterItemCheckboxList();
    }
  }

  // -------------------- Active tab runner --------------------
  function getActiveTab(){
    const btn = $$('#analytics-nav .an-tab').find(b => b.classList.contains('active'));
    return btn?.dataset.analytics || "cogs";
  }
  async function runActiveTab(){
    const loading = document.getElementById("analyticsLoading");
    loading && (loading.style.display="inline");

    const { startTs, endTs, startStr, endStr } = getHawaiiRangeFromInputs("fStart","fEnd");
    if (!startTs || !endTs) { alert("Select a valid start/end date."); loading&&(loading.style.display="none"); return; }

    // mirror date range in the COGS side card
    document.getElementById("drFrom") && (document.getElementById("drFrom").textContent = startStr);
    document.getElementById("drTo")   && (document.getElementById("drTo").textContent   = endStr);

    const venue   = document.getElementById("fVenue")?.value || "All";
    const section = document.getElementById("fSection")?.value || "All";
    Object.assign(S, { start:startStr, end:endStr, venue, section });

    try {
      const tab = getActiveTab();
      if (tab === "cogs") {
        await runCOGS(startStr, endStr, startTs, endTs, venue, section);
      } else if (tab === "timing") {
        await runTiming(startStr, endStr, startTs, endTs, venue, section);
      } else if (tab === "qty-per-guest") {
        await runQtyPerGuest(startStr, endStr, startTs, endTs, venue, section);
      }
    } finally {
      loading && (loading.style.display="none");
    }
  }

  window.refreshAnalyticsTab = function refreshAnalyticsTab(){
    return runActiveTab();
  };

  function updateTimingOutlierButtons(){
    const wrap = document.getElementById("timingOutlierControls");
    if (!wrap) return;
    const mode = S.timingOutlierMode || 'all';
    wrap.querySelectorAll('button[data-mode]').forEach(btn => {
      const isActive = (btn.dataset.mode === mode);
      btn.classList.toggle('active', isActive);
      if (isActive){
        btn.style.backgroundColor = '#3a3d4a';
        btn.style.color = '#fff';
      } else {
        btn.style.backgroundColor = '';
        btn.style.color = '';
      }
    });
  }

  function setTimingOutlierMode(mode){
    const valid = new Set(['all','std1','std2']);
    const desired = valid.has(mode) ? mode : 'all';
    if (S.timingOutlierMode === desired){
      updateTimingOutlierButtons();
      return;
    }
    S.timingOutlierMode = desired;
    updateTimingOutlierButtons();
    if (getActiveTab() === 'timing'){
      runActiveTab();
    }
  }

  window.copyFoodTimingTable = copyFoodTimingTable;

  async function copyFoodTimingTable(){
    const btn = document.getElementById("copyTimingTableBtn");
    const ok = await copyTableToClipboard('foodTimingTable');
    if (btn){
      const original = btn.textContent;
      if (ok){
        btn.textContent = 'Copied!';
        btn.disabled = true;
        setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1500);
      } else {
        btn.textContent = original;
      }
    }
  }

  async function copyTableToClipboard(tableId){
    const table = document.getElementById(tableId);
    if (!table) { alert('Table not found.'); return false; }
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) { alert('No rows to copy.'); return false; }
    const lines = rows.map(row => Array.from(row.querySelectorAll('th,td')).map(cell => (cell.innerText || cell.textContent || '').replace(/\s+/g,' ').trim()).join('	'));
    const text = lines.join('\n');
    try {
      if (navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      return true;
    } catch (err){
      console.error('copy failed', err);
      alert('Copy failed. Try manually selecting the table.');
      return false;
    }
  }

  window.setTimingOutlierMode = setTimingOutlierMode;

  function resolveAnalyticsRange(startStr, endStr, startTs, endTs){
    if (startTs && endTs && startStr && endStr){
      return { startStr, endStr, startTs, endTs };
    }
    const fallback = getHawaiiRangeFromInputs("fStart","fEnd") || {};
    if (!fallback.startTs || !fallback.endTs){
      return null;
    }
    return fallback;
  }

  function coalesceAnalyticsValue(primary, fallback, defaultValue){
    const first = primary ?? fallback;
    if (first === undefined || first === null || first === "") return defaultValue;
    return first;
  }

  function resolveAnalyticsFilters(venue, section){
    const domVenue = document.getElementById("fVenue")?.value;
    const domSection = document.getElementById("fSection")?.value;
    return {
      venue: coalesceAnalyticsValue(venue, domVenue, "All"),
      section: coalesceAnalyticsValue(section, domSection, "All"),
    };
  }

  async function runLoaderWithState(loader, range, filters){
    if (!range?.startTs || !range?.endTs){
      console.warn("Analytics loader skipped: missing date range");
      return;
    }
    const { startStr, endStr, startTs, endTs } = range;
    const { venue, section } = filters;
    Object.assign(S, { start: startStr, end: endStr, venue, section });
    await loader(startStr, endStr, startTs, endTs, venue, section);
  }

  window.loadFoodItemCOGS = async function loadFoodItemCOGS(startStr, endStr, startTs, endTs, venue, section){
    const range = resolveAnalyticsRange(startStr, endStr, startTs, endTs);
    if (!range) return;
    const filters = resolveAnalyticsFilters(venue, section);
    return runLoaderWithState(runCOGS, range, filters);
  };

  window.loadFoodTiming = async function loadFoodTiming(startStr, endStr, startTs, endTs, venue, section){
    const range = resolveAnalyticsRange(startStr, endStr, startTs, endTs);
    if (!range) return;
    const filters = resolveAnalyticsFilters(venue, section);
    return runLoaderWithState(runTiming, range, filters);
  };

  window.loadQtyPerGuest = async function loadQtyPerGuest(startStr, endStr, startTs, endTs, venue, section){
    const range = resolveAnalyticsRange(startStr, endStr, startTs, endTs);
    if (!range) return;
    const filters = resolveAnalyticsFilters(venue, section);
    return runLoaderWithState(runQtyPerGuest, range, filters);
  };

function itemKeyFrom(recipeNo, description){
  return `${(recipeNo || "").toUpperCase()}__${(description || "").trim()}`;
}
function passesSidebarFilters(row){
  const passCat  = (window.analyticsState?.selectedCategories?.size ?? 0) ? window.analyticsState.selectedCategories.has(row.category) : true;
  const passItem = (window.analyticsState?.selectedItems?.size ?? 0)       ? window.analyticsState.selectedItems.has(row.itemKey)       : true;
  return passCat && passItem;
}


  // -------------------- Data fetch + enrich (shared for COGS) --------------------
  async function fetchOrdersAndRecipesByDateRange({ startStr, endStr, venue, section }){
    // Pull by "date" field (string). (If you need a timestamp fallback later, we can add it.)
    const qBase = query(
      collection(db,"orders"),
      where("date", ">=", startStr),
      where("date", "<=", endStr)
    );
    const [snap, recipesSnap] = await Promise.all([
      getDocs(qBase),
      getDocs(collection(db,"recipes")),
    ]);

    // recipe indexes
    const byId=new Map(), byNo=new Map(), byDesc=new Map();
    recipesSnap.forEach(r=>{
      const d=r.data()||{};
      const rec = {
        id: r.id,
        recipeNo: d.recipeNo || "",
        description: d.description || d.itemName || "",
        category: (d.category || d.station || d.section || ""),
        uom: d.uom || d.baseUOM || d.purchaseUOM || "",
      };
      byId.set(r.id, rec);
      if (rec.recipeNo) byNo.set(String(rec.recipeNo).toUpperCase(), rec);
      if (rec.description) byDesc.set(String(rec.description).trim().toLowerCase(), rec);
    });

    const normalizeCategory = (cat, station) => {
      if (cat) return String(cat).toUpperCase();
      const map = { "FRYER":"HOTFOODS","OVENS":"HOTFOODS","WOK":"HOTFOODS","GRILL":"HOTFOODS","PANTRY":"PANTRY","BAKERY":"BAKERY" };
      const s = (station || "").toUpperCase();
      return map[s] || "UNCATEGORIZED";
    };
    const chooseRecipeForOrder = (order) => {
      if (order.recipeId && byId.has(order.recipeId)) return byId.get(order.recipeId);
      const no = (order.recipeNo || "").toUpperCase();
      if (no && byNo.has(no)) return byNo.get(no);
      const desc = (order.description || order.item || "").trim().toLowerCase();
      if (desc && byDesc.has(desc)) return byDesc.get(desc);
      return null;
    };

    const out = [], cats=new Set(), items=new Set();
    snap.forEach(s=>{
      const d = s.data() || {};
      // client-side venue/section filters
      if (venue !== "All" && (d.venue || "") !== venue) return;
      const recSection = d.section || d.station || d.category || "";
      if (section !== "All" && String(recSection) !== section) return;

      const r = chooseRecipeForOrder(d) || {};
      const recipeNo    = r.recipeNo || d.recipeNo || "";
      const description = r.description || d.description || d.item || "";
      const category    = normalizeCategory(r.category || d.category, d.station);
      const uom         = d.uom || r.uom || "ea";
      const qty         = Number(d.netWeight ?? d.qty ?? d.sentQty ?? d.requestQty ?? 0);
      // prefer order.totalCost; else unit * qty (unit can be on order or recipe)
      const storedTotal = Number(d.totalCost || 0);
      let cost = 0;
      if (storedTotal > 0) cost = storedTotal;
      else {
        const unit = Number(d.cost ?? d.unitCost ?? r.cost ?? 0);
        cost = unit > 0 ? unit * qty : 0;
      }
      const date = d.date || (d.timestamp?.toDate?.() ? isoDateHST(d.timestamp.toDate()) : "");

      const row = {
        id: s.id, date,
        year: Number((date||"").slice(0,4)),
        month: Number((date||"").slice(5,7))-1,
        day: Number((date||"").slice(8,10)),
        venue: d.venue || "",
        recipeNo, description, category, qty, uom, cost,
        type: d.type || "",
        status: d.status || "",
        itemKey: `${(recipeNo || "").toUpperCase()}__${(description||"").trim()}`
      };
      out.push(row);
      cats.add(row.category);
      items.add(row.itemKey);
    });

    return {
      rows: out,
      categories: [...cats].sort(),
      items: [...items].sort((a,b)=>a.localeCompare(b)),
    };
  }

  // -------------------- Tab 1: Food Item COGS --------------------
  async function runCOGS(startStr, endStr, startTs, endTs, venue, section){
    // fetch + enrich
    const { rows, categories, items } = await fetchOrdersAndRecipesByDateRange({ startStr, endStr, venue, section });

    // filter to sent + (addons/starting-par)
   // was: r.status === "sent"
let data = rows.filter(r =>
  (r.status === "sent" || r.status === "received") &&
  (r.type==="addon" || r.type==="starting-par")
);


    // apply COGS sidebar filters
    data = data.filter(r=>{
      const passCat  = S.selectedCategories.size ? S.selectedCategories.has(r.category) : true;
      const passItem = S.selectedItems.size ? S.selectedItems.has(r.itemKey) : true;
      return passCat && passItem;
    });

    // rebuild filter lists from available data (so user can refine)
    rebuildFilterLists(categories, items);

    // render table
    // render table
const tableRows = data
  .sort((a,b)=> a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue) || a.description.localeCompare(b.description))
  .map(r => [
    r.date,
    r.venue,
    r.description,
    r.recipeNo,
    toFixedOrEmpty(r.qty,2),
    r.uom,
    `$${toFixedOrEmpty(r.cost,2)}`
  ]);

fillTable("foodCogsTable", tableRows);

// footer total (with $)
const total = data.reduce((sum,r)=> sum + Number(r.cost||0), 0);
const tEl = document.getElementById("analyticsTableTotal");
if (tEl) tEl.textContent = `$${total.toFixed(2)}`;


    // right-side "Item Category Breakdown"
    renderCategoryBreakdown(data);

    // chart: cost per category per day
    renderCategoryLineChart(buildCategorySeries(data));
  }

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
  function buildCategorySeries(rows){
    const labels = enumerateDates(S.start, S.end);
    const idx = new Map(labels.map((d,i)=>[d,i]));
    const cats = [...new Set(rows.map(r=>r.category))].sort();
    const series = new Map(); cats.forEach(c=> series.set(c, labels.map(()=>0)));
    rows.forEach(r=>{
      const i = idx.get(r.date); if (i==null) return;
      series.get(r.category)[i] += Number(r.cost||0);
    });
    return { labels, series };
  }
  function renderCategoryLineChart({labels, series}){
    const canvas = document.getElementById("categoryLineChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (S.charts.categoryLine){ S.charts.categoryLine.destroy(); }
    if (typeof Chart === "undefined"){ console.warn("Chart.js not found"); return; }
    const datasets = [...series.entries()].map(([cat,arr])=>({
      type:"line", label:cat, data:arr, tension:.25, pointRadius:2
    }));
    S.charts.categoryLine = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode:"index", intersect:false },
        plugins: {
          legend: { position:"top" },
          tooltip: { callbacks: { label: (it)=> `${it.dataset.label}: ${fmtMoney(it.parsed.y)}` } }
        },
        scales: { y: { beginAtZero:true, ticks:{ callback: v=> `$${Number(v).toLocaleString()}` } } }
      }
    });
  }

  function filterDurationsByStd(values, mode){
    if (!Array.isArray(values) || values.length === 0) return [];
    if (mode === 'std1' || mode === 'std2'){
      const multiplier = mode === 'std1' ? 1 : 2;
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
      const std = Math.sqrt(variance);
      if (!Number.isFinite(std) || std === 0) return values.slice();
      const limit = multiplier * std;
      return values.filter(v => Math.abs(v - mean) <= limit);
    }
    return values.slice();
  }

  function computeSegmentStats(values, mode){
    if (!Array.isArray(values) || values.length === 0){
      return { average: 0, count: 0, originalCount: 0 };
    }
    const filtered = filterDurationsByStd(values, mode);
    if (!filtered.length){
      return { average: NaN, count: 0, originalCount: values.length };
    }
    const avg = filtered.reduce((sum, v) => sum + v, 0) / filtered.length;
    return { average: avg, count: filtered.length, originalCount: values.length };
  }

// -------------------- Tab 2: Food Timing (Add-ons) --------------------
async function runTiming(startStr, endStr, startTs, endTs, venue, section){
  // Pull add-ons in time window
  const q = query(
    collection(db,"orders"),
    where("type","==","addon"),
    where("timestamp",">=", startTs),
    where("timestamp","<",  endTs),
    where("status","in",["open","Ready to Send","sent","received"])
  );
  const [snap, recipesSnap] = await Promise.all([
    getDocs(q),
    getDocs(collection(db,"recipes")),
  ]);

  // recipe indexes for category/description/uom
  const byNo=new Map(), byId=new Map(), byDesc=new Map();
  recipesSnap.forEach(r=>{
    const d=r.data()||{};
    const rec = {
      id:r.id,
      recipeNo: d.recipeNo||"",
      description: d.description||d.itemName||"",
      category: (d.category||d.station||d.section||""),
      uom: d.uom||d.baseUOM||d.purchaseUOM||""
    };
    if (rec.recipeNo) byNo.set(String(rec.recipeNo).toUpperCase(), rec);
    byId.set(r.id, rec);
    if (rec.description) byDesc.set(String(rec.description).trim().toLowerCase(), rec);
  });
  const normalizeCategory = (cat, station) => {
    if (cat) return String(cat).toUpperCase();
    const map = { FRYER:"HOTFOODS", OVENS:"HOTFOODS", WOK:"HOTFOODS", GRILL:"HOTFOODS", PANTRY:"PANTRY", BAKERY:"BAKERY" };
    const s = (station||"").toUpperCase();
    return map[s] || "UNCATEGORIZED";
  };
  const chooseRec = (d)=>{
    if (d.recipeId && byId.has(d.recipeId)) return byId.get(d.recipeId);
    const no = (d.recipeNo||"").toUpperCase(); if (no && byNo.has(no)) return byNo.get(no);
    const desc = (d.item||d.description||"").trim().toLowerCase(); if (desc && byDesc.has(desc)) return byDesc.get(desc);
    return null;
  };

  // First pass: build enriched rows and collect categories/items for the sidebar
  const cats = new Set(), items = new Set();
  const enriched = [];
  snap.forEach(s=>{
    const d = s.data()||{};
    if (venue!=="All" && (d.venue||"")!==venue) return;
    const recSection = d.section || d.station || d.category || "";
    if (section!=="All" && String(recSection)!==section) return;

    const r = chooseRec(d) || {};
    const category = normalizeCategory(r.category || d.category, d.station);
    const description = r.description || d.item || d.description || "";
    const recipeNo = r.recipeNo || d.recipeNo || "";
    const itemKey  = itemKeyFrom(recipeNo, description);

    const row = { category, itemKey, item: description, recipe: recipeNo, venue: d.venue || "", raw: d };
    if (!passesSidebarFilters(row)) return;

    cats.add(category);
    items.add(itemKey);
    enriched.push(row);
  });

  // Rebuild the side lists (so the checkboxes reflect this tab’s data too)
  rebuildFilterLists([...cats].sort(), [...items].sort((a,b)=>a.localeCompare(b)));

  // Bucket timing segments
  const buckets = new Map();
  const mins = (a,b)=> (a && b) ? (b - a)/60000 : NaN;
  const addSeg = (segments, seg, v)=>{
    if (Number.isFinite(v) && v >= 0){
      segments[seg].push(v);
    }
  };

  enriched.forEach(({item, recipe, venue, raw})=>{
    const key = `${item}||${recipe}||${venue}`;
    if (!buckets.has(key)) buckets.set(key, {
      item, recipe, venue,
      segments: { o2r: [], r2s: [], s2v: [], tot: [] }
    });

    const tOrder = raw.timestamp?.toDate?.();
    const tReady = raw.readyAt?.toDate?.();
    const tSent  = raw.sentAt?.toDate?.();
    const tRecv  = raw.receivedAt?.toDate?.();

    const { segments } = buckets.get(key);
    if (tOrder && tReady) addSeg(segments, "o2r", mins(tOrder,tReady));
    if (tReady && tSent)  addSeg(segments, "r2s", mins(tReady,tSent));
    if (tSent  && tRecv)  addSeg(segments, "s2v", mins(tSent,tRecv));
    if (tOrder && tRecv)  addSeg(segments, "tot", mins(tOrder,tRecv));
  });

  const mode = S.timingOutlierMode || 'all';
  const rows = [];
  for (const bucket of buckets.values()){
    const segs = bucket.segments;
    const statsO2R = computeSegmentStats(segs.o2r, mode);
    const statsR2S = computeSegmentStats(segs.r2s, mode);
    const statsS2V = computeSegmentStats(segs.s2v, mode);
    const statsTot = computeSegmentStats(segs.tot, mode);

    const filteredMax = Math.max(statsO2R.count, statsR2S.count, statsS2V.count, statsTot.count);
    const originalMax = Math.max(statsO2R.originalCount, statsR2S.originalCount, statsS2V.originalCount, statsTot.originalCount);
    const samplesLabel = (originalMax > 0 && originalMax !== filteredMax)
      ? `${filteredMax} / ${originalMax}`
      : String(filteredMax);

    rows.push([
      bucket.item, bucket.recipe, bucket.venue,
      toFixedOrEmpty(statsO2R.average,1),
      toFixedOrEmpty(statsR2S.average,1),
      toFixedOrEmpty(statsS2V.average,1),
      toFixedOrEmpty(statsTot.average,1),
      samplesLabel
    ]);
  }
  rows.sort((a,b)=> Number(b[6]) - Number(a[6]));
  fillTable("foodTimingTable", rows);
}


  // -------------------- Tab 3: Qty per Guest --------------------
 async function runQtyPerGuest(startStr, endStr, startTs, endTs, venue, section){
  // 1) Showware: latest per day
  const swByDay = await fetchDailyShowwareTotals(startStr, endStr);

  // 2) Orders + recipes (so we can get categories/descriptions)
  const { rows } = await fetchOrdersAndRecipesByDateRange({ startStr, endStr, venue, section });

  // 3) Keep both SENT and RECEIVED (see #3 fix), add itemKey for filtering
  const sentRows = rows
    .filter(r => (r.status==="sent" || r.status==="received") && (r.type==="addon" || r.type==="starting-par"))
    .map(r => ({ ...r, itemKey: itemKeyFrom(r.recipeNo, r.description) }))
    .filter(passesSidebarFilters);

  // Rebuild side lists from this tab’s data
  const cats = [...new Set(sentRows.map(r=>r.category))].sort();
  const items = [...new Set(sentRows.map(r=>r.itemKey))].sort((a,b)=>a.localeCompare(b));
  rebuildFilterLists(cats, items);

  const guestsFor = (day, venue)=> Number(swByDay.get(day)?.[venue] || 0);

  const out = [], seen = new Set(), agg = new Map(); // item||recipe -> {sum,count}
  for (const d of sentRows){
    const g = guestsFor(d.date, d.venue);
    const qpg = g > 0 ? (Number(d.qty||0) / g) : 0;
    const key = [d.date, d.venue, d.recipeNo, d.description, d.qty, g].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([d.date, d.venue, d.description, d.recipeNo, toFixedOrEmpty(d.qty,2), String(g), toFixedOrEmpty(qpg,4)]);

    const k2 = `${d.description}||${d.recipeNo}`;
    const cur = agg.get(k2) || { item:d.description, recipe:d.recipeNo, sum:0, count:0 };
    if (g>0){ cur.sum += qpg; cur.count += 1; }
    agg.set(k2, cur);
  }

  out.sort((a,b)=> a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]));
  fillTable("qtyPerGuestTable", out);

  const avgRows=[];
  for (const a of agg.values()){
    const avg = a.count ? a.sum/a.count : 0;
    avgRows.push([a.item, a.recipe, toFixedOrEmpty(avg,4), String(a.count)]);
  }
  avgRows.sort((a,b)=> Number(b[2]) - Number(a[2]));
  fillTable("qtyPerGuestAverages", avgRows);
}


  // === Showware helpers: pull latest per day (receivedAt desc) ===
  async function fetchDailyShowwareTotals(startStr, endStr){
    const out = new Map(); // day -> { Aloha, Gateway, Ohana }
    const startTs = Timestamp.fromDate(new Date(`${startStr}T10:00:00.000Z`));
    const endNext = new Date(`${endStr}T10:00:00.000Z`); endNext.setUTCDate(endNext.getUTCDate()+1);
    const endTs   = Timestamp.fromDate(endNext);

    const snap = await getDocs(query(
      collection(db, S.SHOWWARE_COLL),
      where("receivedAt", ">=", startTs),
      where("receivedAt", "<",  endTs),
      orderBy("receivedAt","desc")
    ));

    const readNum = (obj, keys) => {
      const pools = [obj, obj?.raw, obj?.raw?.data, obj?.raw?.payload, obj?.payload, obj?.data, obj?.raw?.showware];
      for (const p of pools){
        if (!p) continue;
        for (const k of keys){
          const v = p[k];
          if (v != null && Number.isFinite(Number(v))) return Number(v);
        }
      }
      return 0;
    };
    const KEYS = {
      Aloha:   ["alohaTotal","alohaCount","aloha","AlohaTotal","AlohaCount","aloha_total","aloha_count"],
      Gateway: ["gatewayTotal","gatewayCount","gateway","GatewayTotal","GatewayCount","gateway_total","gateway_count"],
      Ohana:   ["ohanaTotal","ohanaCount","ohana","OhanaTotal","OhanaCount","ohana_total","ohana_count"],
    };

    snap.forEach(d=>{
      const data = d.data() || {};
      const rAt  = data.receivedAt?.toDate?.();
      if (!rAt) return;
      const day = isoDateHST(rAt);
      if (out.has(day)) return; // first encountered = latest
      out.set(day, {
        Aloha:   readNum(data, KEYS.Aloha),
        Gateway: readNum(data, KEYS.Gateway),
        Ohana:   readNum(data, KEYS.Ohana),
      });
    });

    return out;
  }



})();



//**Recipes */

// ===================== RECIPES SCREEN =====================
// Global caches
window._recipesCache = [];
window._ingredientsCache = [];
window._legacyRecipesCache = [];
window._recipesUnsub = null;

let _recipesPrimePromise = null;
let _legacyRecipesPrimed = false;

function _normalizeRecipeRecord(id, data = {}) {
  if (!id) return null;
  const v = data || {};
  return {
    id,
    recipeNo: v.recipeNo || "",
    description: v.description ?? v.name ?? v.recipeName ?? "(no name)",
    portions: v.portions || 0,
    methodology: v.methodology || "",
    ingredients: Array.isArray(v.ingredients) ? v.ingredients : [],
    category: (v.category || v.Category || "UNCATEGORIZED"),
  };
}

function _mergeRecipeLists(primary = [], secondary = []) {
  const merged = [];
  const seen = new Set();
  const push = (row) => {
    if (!row || !row.id) return;
    if (seen.has(row.id)) return;
    merged.push(row);
    seen.add(row.id);
  };
  primary.forEach(push);
  secondary.forEach(push);
  return merged;
}

// Public entries so HTML can call these
window.openAddRecipeDialog = openAddRecipeDialog;
window.closeAddRecipeDialog = closeAddRecipeDialog;
window.addRecipeLine = addRecipeLine;
window.saveRecipeConfig = saveRecipeConfig;
window.renderRecipesList = renderRecipesList;

// 1) Load ingredients (one-time)
async function _ensureIngredientsLoaded() {
  if (window._ingredientsCache?.length) return;
  const snap = await getDocs(query(collection(db, "ingredients"), orderBy("itemName")));
  const rows = [];
  snap.forEach(d => {
    const v = d.data() || {};
    rows.push({ id: d.id, itemNo: v.itemNo, itemName: v.itemName ?? v.name ?? "(ingredient)", baseUOM: v.baseUOM || "" });
  });
  window._ingredientsCache = rows;
}

// 2) Start recipes live listener
function startRecipesListener() {
  if (typeof onSnapshot !== "function") return;
  if (window._recipesUnsub) return;

  const q = query(recipesCollection(), orderBy("description"));
  window._recipesUnsub = onSnapshot(q, (snap) => {
    const rows = [];
    snap.forEach((d) => {
      const normalized = _normalizeRecipeRecord(d.id, d.data());
      if (normalized) rows.push(normalized);
    });
    window._recipesCache = _mergeRecipeLists(rows, window._legacyRecipesCache);
    renderRecipesList();
    _paintRecipeSelect();
  });
}


async function _ensureRecipesPrimed() {
  if (_recipesPrimePromise) return _recipesPrimePromise;

  const hasRecipes = Array.isArray(window._recipesCache) && window._recipesCache.length > 0;
  if (hasRecipes && _legacyRecipesPrimed) return;

  _recipesPrimePromise = (async () => {
    let newRows = [];
    if (!hasRecipes) {
      try {
        const snap = await getDocs(recipesCollection());
        snap.forEach((d) => {
          const row = _normalizeRecipeRecord(d.id, d.data());
          if (row) newRows.push(row);
        });
      } catch (e) {
        console.debug("Prime fetch failed for cookingrecipes:", e);
      }
    }

    if (!_legacyRecipesPrimed) {
      try {
        const legacySnap = await getDocs(legacyRecipesCollection());
        const legacyRows = [];
        legacySnap.forEach((d) => {
          const row = _normalizeRecipeRecord(d.id, d.data());
          if (row) legacyRows.push(row);
        });
        window._legacyRecipesCache = legacyRows;
        _legacyRecipesPrimed = true;
      } catch (e) {
        console.debug("Prime fetch failed for legacy recipes:", e);
      }
    }

    const baseline = newRows.length ? newRows : (Array.isArray(window._recipesCache) ? window._recipesCache : []);
    const merged = _mergeRecipeLists(baseline, window._legacyRecipesCache);
    if (merged.length) {
      window._recipesCache = merged;
    }

    window._paintRecipeSelect?.();
  })();

  try {
    await _recipesPrimePromise;
  } finally {
    _recipesPrimePromise = null;
  }
}
window._ensureRecipesPrimed = _ensureRecipesPrimed;



// 3) Render list with filter + expandable details + scaled portions
// Make it async so it can self-prime when cache is empty
async function renderRecipesList() {
  const wrap = document.getElementById("recipesList");
  if (!wrap) return;

  try { window.startRecipesListener?.(); } catch {}

  if (!Array.isArray(window._recipesCache) || window._recipesCache.length === 0 || !_legacyRecipesPrimed) {
    await _ensureRecipesPrimed();
  }

  // Normalize category even if listener didn't include it yet
  const allRaw = Array.isArray(window._recipesCache) ? window._recipesCache : [];
  const all = allRaw.map(r => ({
    ...r,
    category: (r.category || r.Category || "UNCATEGORIZED")
  }));

  const search = (document.getElementById("recipeSearch")?.value || "")
    .trim()
    .toLowerCase();

  // NEW: read selected category from the filter ('' means All)
  const selectedCat = (document.getElementById("recipeCategoryFilter")?.value || "").toUpperCase();

  const filtered = (search || selectedCat)
    ? all.filter((r) => {
        const name = (r.description || "").toLowerCase();
        const num  = (r.recipeNo || "").toLowerCase();
        const cat  = (r.category || "").toString().toUpperCase();

        const matchesSearch = !search || name.includes(search) || num.includes(search);
        const matchesCat    = !selectedCat || cat === selectedCat;
        return matchesSearch && matchesCat;
      })
    : all;

  // Build markup
  if (!filtered.length) {
    wrap.innerHTML = `<p style="opacity:.7;">${
      all.length > 0 ? "No recipes match your search." : "No recipes found in Firestore (checked 'recipes' and 'Recipes')."
    }</p>`;
    return;
  }

const html = filtered
  .map((r) => {
    const base = Number(r.portions || 0);
    const ingredients = Array.isArray(r.ingredients) ? r.ingredients : [];
    const catChip = r.category && r.category !== "UNCATEGORIZED"
      ? `<span class="badge" style="font-size:12px; background:#3a3d4a; color:#e8eaed; border-radius:8px; padding:2px 8px;">${escapeHtml(r.category)}</span>`
      : "";

    return `
      <div id="card-${r.id}" class="recipe-card" data-recipe-id="${r.id}" style="border:1px solid #3333; border-radius:12px; padding:12px; margin-bottom:10px;">
        <!-- Header -->
        <div class="recipe-head" style="display:flex;justify-content:space-between;align-items:center;gap:12px;cursor:pointer"
             onclick="toggleRecipeDetails('${r.id}')">
          <div style="display:flex;align-items:center;gap:8px;">
            ${r.recipeNo ? `<span class="badge" style="font-size:12px; background:#eee; color:#333; border-radius:8px; padding:2px 8px;">${escapeHtml(r.recipeNo)}</span>` : ""}
            <strong>${escapeHtml(r.description || "(no name)")}</strong>
            ${catChip}
          </div>
          <div style="font-size:12px;opacity:.7;">${base ? `${base} base portions` : `no base portions set`}</div>
        </div>

        <!-- Body -->
        <div class="recipe-details" id="recipe-details-${r.id}" style="display:none; margin-top:10px;">
          <!-- Desired portions -->
          <div style="display:grid; gap:10px; align-items:end; grid-template-columns: 220px 1fr;">
            <label>Desired portions
              <input type="number" min="0" step="1" value="${base || 0}" data-desired-input="${r.id}" />
            </label>
            <div id="recipe-scale-${r.id}" style="font-size:13px; opacity:.7;">
              ${base ? `Base yield: ${base}. Scale factor: 1` : `Set base portions to enable scaling.`}
            </div>
          </div>

          <!-- Ingredients + Methodology table -->
          <div class="recipe-table-wrap">
            <table class="recipe-table">
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>UOM</th>
                  <th class="num">Amount</th>
                </tr>
              </thead>
              <tbody id="ingredient-list-${r.id}">
                ${
                  !ingredients.length
                    ? `<tr><td colspan="3" style="opacity:.7;">No ingredients yet.</td></tr>`
                    : ingredients.map((l, i) => `
                      <tr data-i="${i}">
                        <td><strong>${escapeHtml(l?.name || "")}</strong></td>
                        <td>${escapeHtml(l?.uom || "ea")}</td>
                        <td class="num amount" data-base-qty="${Number(l?.qty) || 0}">${Number(l?.qty) || 0}</td>
                      </tr>
                    `).join("")
                }
                <tr class="method-row">
                  <td colspan="3">
                    <div class="methodology-block">
                      <h4 style="margin:0 0 6px 0;">Methodology</h4>
                      ${
                        r.methodology
                          ? `<ol style="padding-left:18px; margin: 0; display:flex; flex-direction:column; gap:4px;">${
                              escapeHtml(r.methodology).split("\\n").map(s => `<li>${s}</li>`).join("")
                            }</ol>`
                          : `<p style="opacity:.7;">No steps added yet.</p>`
                      }
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div id="qty-note-${r.id}" class="qty-note">
              ${base ? `Qty shown for ${base} portions` : `(enter portions to scale)`}
            </div>
          </div>

          ${ base
            ? `<div style="margin-top:10px;">
                 <button onclick="saveBasePortions('${r.id}')">Save base portions</button>
               </div>`
            : "" }
        </div>
      </div>
    `;
  })
  .join("");


  wrap.innerHTML = html;

  // Hook up scaling inputs
// Hook up scaling inputs
filtered.forEach((r) => {
  const input = document.querySelector(`[data-desired-input="${r.id}"]`);
  if (!input) return;

  const base = Number(r.portions || 0);
  const container = document.getElementById(`card-${r.id}`);
  const list = document.getElementById(`ingredient-list-${r.id}`);
  const note = document.getElementById(`qty-note-${r.id}`);
  const scale = document.getElementById(`recipe-scale-${r.id}`);

  const recalc = () => {
    const desired = Math.max(0, Number(input.value || 0));
    if (!base || !desired) {
      note && (note.textContent = base ? `Qty shown for ${base} portions` : `(enter portions to scale)`);
      scale && (scale.textContent = base ? `Base yield: ${base}` : `Set base portions to enable scaling.`);
      container?.querySelectorAll(".amount[data-base-qty]").forEach((td) => {
        const b = Number(td.getAttribute("data-base-qty") || 0);
        td.textContent = String(round2(b));
      });
      return;
    }
    const factor = desired / base;
    note && (note.textContent = `Qty shown for ${desired} portions`);
    scale && (scale.textContent = `Base yield: ${base}. Scale factor: ${round2(factor)}`);
    container?.querySelectorAll(".amount[data-base-qty]").forEach((td) => {
      const b = Number(td.getAttribute("data-base-qty") || 0);
      td.textContent = String(round2(b * factor));
    });
  };

  input.addEventListener("input", recalc);
  input.addEventListener("blur", recalc);
  recalc(); // run once initially
});

}



// Toggle expand
window.toggleRecipeDetails = function(id) {
  const el = document.getElementById(`recipe-details-${id}`);
  if (!el) return;
  const now = el.style.display !== "none";
  el.style.display = now ? "none" : "block";
};

// Save base portions quickly from the card
window.saveBasePortions = async function(id) {
  try {
    const input = document.querySelector(`[data-desired-input="${id}"]`);
    const val = Number(input?.value || 0);
    if (!Number.isFinite(val) || val < 1) return alert("Enter a valid base portion count (>=1).");
   const ref = await ensureRecipeInNewCollection(id);
await updateDoc(ref, { portions: val, updatedAt: serverTimestamp() });

    alert("Base portions saved.");
  } catch (e) {
    console.error(e);
    alert("Failed to save base portions.");
  }
};


/** -------------- Add Recipe Dialog logic -------------- */
function openAddRecipeDialog() {
  _ensureIngredientsLoaded().then(_installIngredientLookupsIfAny);
  _paintRecipeSelect();                 // keeps hidden select up to date (harmless)
  _upgradeRecipeSelectToCombobox();     // <-- NEW

  const sel = document.getElementById("recipeSelect");
  if (sel && !sel.__hasLoadHandler) {
    sel.addEventListener("change", (e) => _loadRecipeIntoDialog(e.target.value));
    sel.__hasLoadHandler = true;
  }

  if (sel?.value) _loadRecipeIntoDialog(sel.value);

  const dlg = document.getElementById("addRecipeDialog");
  if (dlg) dlg.showModal();
}

function closeAddRecipeDialog() {
  const dlg = document.getElementById("addRecipeDialog");
  if (dlg) dlg.close();
  // reset fields
  document.getElementById("recipeSelect").value = "";
  document.getElementById("recipeLines").innerHTML = "";
  document.getElementById("recipePortions").value = "";
  document.getElementById("recipeMethodology").value = "";
}

// add a blank line row
function addRecipeLine() {
  const box = document.getElementById("recipeLines");
  if (!box) return;

  const row = document.createElement("div");
  row.className = "ing-row";
  row.style.display = "grid";
  row.style.gridTemplateColumns = "1fr 120px 100px 32px";
  row.style.gap = "6px";

  row.innerHTML = `
    <div class="ing-lookup">
      <input class="ing-search" type="text" placeholder="Type to search ingredients…" autocomplete="off" />
      <div class="ing-menu" style="display:none;"></div>
      <input type="hidden" class="ing-id" />
    </div>
    <input class="ing-qty" type="number" min="0" step="0.01" placeholder="Qty" />
    <input class="ing-uom" type="text" placeholder="UOM" />
    <button type="button" class="ing-remove" aria-label="Remove ingredient line">✕</button>
  `;

  box.appendChild(row);
  _installIngredientLookup(row); // <— IMPORTANT
  row.querySelector(".ing-remove").addEventListener("click", () => row.remove());
}



function _installIngredientLookupsIfAny() {
  document.querySelectorAll("#addRecipeDialog .ing-row").forEach(_installIngredientLookup);
}

function _installIngredientLookup(row) {
  const input = row.querySelector(".ing-search");
  const menu  = row.querySelector(".ing-menu");
  const hid   = row.querySelector(".ing-id");
  const uomEl = row.querySelector(".ing-uom");

  if (!input || !menu || !hid) return;

  const allIng = Array.isArray(window._ingredientsCache) ? window._ingredientsCache : [];
  const allRec = Array.isArray(window._recipesCache) ? window._recipesCache : [];

  let idx = -1; // keyboard highlight index

  const closeMenu = () => { menu.style.display = "none"; idx = -1; };
  const openMenu  = () => { menu.style.display = "block"; };

  const renderList = (q = "") => {
    const s = q.trim().toLowerCase();
    const maxIng = 8;
    const maxRec = 4;

    const ingFiltered = !s
      ? allIng.slice(0, maxIng)
      : allIng.filter(i => {
          const name = (i.itemName || "").toLowerCase();
          const num  = (i.itemNo || "").toString().toLowerCase();
          return name.includes(s) || num.includes(s);
        }).slice(0, maxIng);

    const recFiltered = s
      ? (allRec.filter(r => ((r.description || r.name || "").toLowerCase()).includes(s)).slice(0, maxRec))
      : [];

    const hasCustom = s.length > 0;

    const ingHtml = ingFiltered.map((i, n) => `
      <div class="ing-item" data-type="ingredient" data-id="${i.id}" data-uom="${i.baseUOM || ""}" data-index="${n}">
        <div class="ing-item-name">${escapeHtml(i.itemName || "")}</div>
        <div class="ing-item-meta">${escapeHtml(i.itemNo || "")}${i.baseUOM ? ` • ${escapeHtml(i.baseUOM)}` : ""}</div>
      </div>
    `).join("");

    const recHtml = recFiltered.map((r, k) => `
      <div class="ing-item" data-type="recipe" data-id="${r.id}" data-uom="" data-index="${ingFiltered.length + k}">
        <div class="ing-item-name">${escapeHtml(r.description || r.name || "(recipe)")}</div>
        <div class="ing-item-meta">Recipe</div>
      </div>
    `).join("");

    const otherIdx = ingFiltered.length + recFiltered.length;
    const otherHtml = hasCustom
      ? `<div class="ing-item ing-other" data-type="other" data-index="${otherIdx}">
           + Use “${escapeHtml(input.value)}”
         </div>`
      : `<div class="ing-item ing-other" data-type="other" data-index="${otherIdx}">
           + Other (type a name)
         </div>`;

    const any = ingHtml || recHtml;
    menu.innerHTML = any
      ? `${ingHtml}${recHtml}${otherHtml}`
      : `<div class="ing-item ing-empty" aria-disabled="true">No matches</div>${otherHtml}`;

    // mouse interactions
    menu.querySelectorAll(".ing-item").forEach(el => {
      const i = Number(el.dataset.index || -1);
      el.addEventListener("mouseenter", () => _highlightItem(menu, i));
      el.addEventListener("mouseleave", () => _highlightItem(menu, -1));
      el.addEventListener("mousedown", (e) => { // mousedown to beat input blur
        e.preventDefault();
        _choose(el);
      });
    });
  };

  const _highlightItem = (menuEl, newIdx) => {
    idx = newIdx;
    menuEl.querySelectorAll(".ing-item").forEach((el, i) => {
      el.classList.toggle("active", i === idx);
    });
  };

  const _choose = (el) => {
    if (!el || el.classList.contains("ing-empty")) return;
    const type = el.getAttribute("data-type") || "ingredient";

    if (type === "ingredient" || type === "recipe") {
      const id   = el.getAttribute("data-id") || "";
      const name = el.querySelector(".ing-item-name")?.textContent || "";
      const uom  = el.getAttribute("data-uom") || "";

      hid.value = (type === "recipe") ? `recipe:${id}` : id;  // mark recipe refs
      input.value = name;
      if (uom && !uomEl.value) uomEl.value = uom;             // auto-fill if empty
      closeMenu();
    } else if (type === "other") {
      // custom / non-inventory: keep typed name, clear id
      hid.value = "";
      input.value = (input.value || "").trim();
      closeMenu();
    }
  };

  input.addEventListener("focus", () => {
    renderList(input.value);
    openMenu();
  });

  input.addEventListener("input", () => {
    renderList(input.value);
    openMenu();
  });

  input.addEventListener("keydown", (e) => {
    const items = Array.from(menu.querySelectorAll(".ing-item"));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!items.length) return;
      _highlightItem(menu, Math.min(idx + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      _highlightItem(menu, Math.max(idx - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (idx >= 0 && items[idx]) {
        _choose(items[idx]);
      } else {
        // No item highlighted → treat as custom
        hid.value = "";
        input.value = (input.value || "").trim();
        closeMenu();
      }
    } else if (e.key === "Escape") {
      closeMenu();
    }
  });

  // click outside to close
  document.addEventListener("click", (e) => {
    if (!row.contains(e.target)) closeMenu();
  }, { capture: true });
}



// --- Hook Recipes init into your tab switcher (safe + scoped) ---
(function hookRecipesIntoShowKitchenSection() {
  if (window.__recipesHooked) return;
  const original = window.showKitchenSection;

  window.showKitchenSection = function (sec, ...rest) {
    // Hide all sections inside #main-kitchen
    document.querySelectorAll('#main-kitchen .main-kitchen-section').forEach(el => {
      if (el.dataset.sec === sec) {
        el.removeAttribute('hidden');
        el.style.display = ''; // let CSS handle
      } else {
        el.setAttribute('hidden', '');
        el.style.display = 'none';
      }
    });

    // Highlight the active tab (optional polish)
    document.querySelectorAll('#main-kitchen .area-tab').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-sec') === sec);
    });

    // Call the original showKitchenSection if it exists
    const result = typeof original === "function" ? original(sec, ...rest) : undefined;

    // Recipes-specific init
    if (sec === "recipes") {
      try {
        window.startRecipesListener?.();       // start live listener
        window._ensureIngredientsLoaded?.();   // prime ingredients cache
        Promise.resolve(window._ensureRecipesPrimed?.())
          .catch(() => {}) // ignore errors
          .finally(() => {
            window._paintRecipeSelect?.();     // fill recipe select
            window.renderRecipesList?.();      // render list
          });
      } catch (e) {
        console.debug("Recipes init error:", e);
      }
    }

    return result;
  };

  window.__recipesHooked = true;
})();

// Turn #recipeSelect into a searchable combobox with "Create new…" support (no cap)
async function _upgradeRecipeSelectToCombobox() {
  const sel = document.getElementById("recipeSelect");
  if (!sel || sel.dataset.cbUpgraded) return;

  try { window.startRecipesListener?.(); } catch {}
  sel.style.display = "none";
  sel.dataset.cbUpgraded = "1";

  // UI scaffold (reuse .ing-* dark styles)
  const box  = document.createElement("div");
  box.className = "ing-lookup";
  const input = document.createElement("input");
  input.className = "ing-search";
  input.type = "text";
  input.placeholder = "Select or create recipe…";
  input.autocomplete = "off";
  const menu = document.createElement("div");
  menu.className = "ing-menu";
  menu.style.display = "none";
  box.appendChild(input);
  box.appendChild(menu);
  sel.parentNode.insertBefore(box, sel);

  const openMenu  = () => (menu.style.display = "block");
  const closeMenu = () => (menu.style.display = "none");
  let idx = -1;

  const _highlight = (newIdx) => {
    idx = newIdx;
    menu.querySelectorAll(".ing-item").forEach((el, i) => {
      el.classList.toggle("active", i === idx);
    });
  };

  const _setRecipeSelectValue = (id, name) => {
    sel.value = id || "";
    input.value = name || "";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  };

async function _createRecipeByName(name) {
  const n = name.trim();
  if (!n) return null;

  const existing = (window._recipesCache || []).find(
    r => (r.description || r.name || "").trim().toLowerCase() === n.toLowerCase()
  );
  if (existing) return existing.id;

  const payload = {
    description: n,
    portions: 0,
    methodology: "",
    ingredients: [],
    createdAt: serverTimestamp?.(),
    updatedAt: serverTimestamp?.(),
  };
  const ref = await addDoc(recipesCollection(), payload);

  const row = { id: ref.id, recipeNo: "", description: n, portions: 0, methodology: "", ingredients: [], category: "UNCATEGORIZED" };
  window._recipesCache = Array.isArray(window._recipesCache) ? [...window._recipesCache, row] : [row];
  window._paintRecipeSelect?.();
  return ref.id;
}


  // ✅ No max cap; show all recipes (scrollable via CSS max-height on .ing-menu)
  const renderList = (q = "") => {
    const s = q.trim().toLowerCase();
    const all = Array.isArray(window._recipesCache) ? window._recipesCache : [];

    // Stable alphabetical sort
    const sorted = [...all].sort((a, b) => {
      const an = (a.description || a.name || "").toLowerCase();
      const bn = (b.description || b.name || "").toLowerCase();
      return an.localeCompare(bn);
    });

    const filtered = s
      ? sorted.filter(r => ((r.description || r.name || "").toLowerCase().includes(s)))
      : sorted;

    const rows = filtered.map((r, n) => `
      <div class="ing-item" data-type="recipe" data-id="${r.id}" data-index="${n}">
        <div class="ing-item-name">${escapeHtml(r.description || r.name || "(no name)")}</div>
        <div class="ing-item-meta">${escapeHtml(r.recipeNo || "")}</div>
      </div>
    `).join("");

    const createIdx = filtered.length;
    const createHtml = s
      ? `<div class="ing-item ing-other" data-type="new" data-index="${createIdx}">
           + Create new recipe “${escapeHtml(q)}”
         </div>`
      : `<div class="ing-item ing-other" data-type="new" data-index="${createIdx}">
           + Create new recipe (type a name)
         </div>`;

    menu.innerHTML = (rows || `<div class="ing-item ing-empty" aria-disabled="true">No recipes yet</div>`) + createHtml;

    // mouse binding
    menu.querySelectorAll(".ing-item").forEach(el => {
      const i = Number(el.dataset.index || -1);
      el.addEventListener("mouseenter", () => _highlight(i));
      el.addEventListener("mouseleave", () => _highlight(-1));
      el.addEventListener("mousedown", async (e) => {
        e.preventDefault();
        const type = el.getAttribute("data-type");
        if (type === "recipe") {
          const id   = el.getAttribute("data-id") || "";
          const name = el.querySelector(".ing-item-name")?.textContent || "";
          _setRecipeSelectValue(id, name);
          closeMenu();
        } else if (type === "new") {
          const name = input.value.trim();
          if (!name) return; // ignore empty
          const id = await _createRecipeByName(name);
          if (id) _setRecipeSelectValue(id, name);
          closeMenu();
        }
      });
    });
  };

  // seed with current selection if any
  const currentId = sel.value;
  if (currentId) {
    const r = (window._recipesCache || []).find(x => x.id === currentId);
    if (r) input.value = r.description || r.name || "";
  }

  input.addEventListener("focus", () => { renderList(input.value); openMenu(); });
  input.addEventListener("input", () => { renderList(input.value); openMenu(); });
  input.addEventListener("keydown", async (e) => {
    const items = Array.from(menu.querySelectorAll(".ing-item"));
    if (e.key === "ArrowDown") {
      e.preventDefault(); if (!items.length) return;
      _highlight(Math.min(idx + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault(); if (!items.length) return;
      _highlight(Math.max(idx - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (idx >= 0 && items[idx]) {
        items[idx].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      } else {
        const name = input.value.trim();
        if (name) {
          const id = await _createRecipeByName(name);
          if (id) _setRecipeSelectValue(id, name);
        }
        closeMenu();
      }
    } else if (e.key === "Escape") {
      closeMenu();
    }
  });

  document.addEventListener("click", (ev) => {
    if (!box.contains(ev.target)) closeMenu();
  }, { capture: true });
}




// paint recipe select dropdown from cache
function _paintRecipeSelect() {
  const sel = document.getElementById("recipeSelect");
  if (!sel) return;
  const cache = window._recipesCache || [];
  const current = sel.value;
  sel.innerHTML = `<option value="">-- Select recipe from Firestore --</option>` +
    cache.map(r => `<option value="${r.id}">${escapeHtml(r.description || "")}</option>`).join("");
  if (current) sel.value = current;
}


// paint all existing ingredient selects in the dialog
function _paintIngredientSelectsIfAny() {
  document.querySelectorAll("#addRecipeDialog .ing-id").forEach(el => _paintIngredientSelect(el));
}
function _paintIngredientSelect(selectEl) {
  if (!selectEl) return;
  const cache = window._ingredientsCache || [];
  const curr = selectEl.value;
  selectEl.innerHTML = `<option value="">-- ingredient --</option>` +
    cache.map(i => `<option value="${i.id}">${escapeHtml(i.itemName || "")}</option>`).join("");
  if (curr) selectEl.value = curr;
}

// Save configuration into the chosen recipe document
async function saveRecipeConfig() {
  const recipeId = document.getElementById("recipeSelect").value;
  const portions = Number(document.getElementById("recipePortions").value || 0);
  const methodology = document.getElementById("recipeMethodology").value || "";

  if (!recipeId) return alert("Choose a base recipe first.");
  if (!Number.isFinite(portions) || portions < 1) return alert("Enter a valid base portions (>=1).");

  const linesBox = document.getElementById("recipeLines");
  const rows = Array.from(linesBox.children || []);
  if (!rows.length) return alert("Add at least one ingredient line.");

  const cooked = rows.map(row => {
    const ingId   = row.querySelector(".ing-id")?.value || "";
    const ingName = row.querySelector(".ing-search")?.value?.trim() || "";
    const qty     = Number(row.querySelector(".ing-qty")?.value || 0);
    const uom     = (row.querySelector(".ing-uom")?.value || "").trim();
    if ((!ingId && !ingName) || !Number.isFinite(qty) || qty <= 0 || !uom) {
      throw new Error("Each ingredient row needs a name (pick from list or type), a positive qty, and a UOM.");
    }
    return { ingredientId: ingId, name: ingName, qty, uom };
  });

try {
  const ref = await ensureRecipeInNewCollection(recipeId);
  await updateDoc(ref, {
    ingredients: cooked,
    portions,
    methodology,
    updatedAt: serverTimestamp(),
  });
  closeAddRecipeDialog();
  alert("Recipe saved.");
} catch (e) {
  console.error(e);
  alert("Failed to save recipe.");
}

}


// Fill the Add/Configure dialog with an existing recipe
async function _loadRecipeIntoDialog(recipeId) {
  const sel  = document.getElementById("recipeSelect");
  const box  = document.getElementById("recipeLines");
  const qty  = document.getElementById("recipePortions");
  const meth = document.getElementById("recipeMethodology");

  if (!sel || !box || !qty || !meth) return;
  if (!recipeId) {
    box.innerHTML = "";
    qty.value = "";
    meth.value = "";
    return;
  }

  // make sure ingredient data exists for name/UOM lookups
  await _ensureIngredientsLoaded();

  // find from cache (listener keeps this fresh)
  const rec = (window._recipesCache || []).find(r => r.id === recipeId);
  if (!rec) return;

  // set top fields
  qty.value  = Number(rec.portions || 0) || "";
  meth.value = rec.methodology || "";

  // rebuild ingredient lines
  box.innerHTML = "";
  const lines = Array.isArray(rec.ingredients) ? rec.ingredients : [];
  for (const line of lines) {
    // create an empty row (installs the combobox)
    addRecipeLine();
    const row = box.lastElementChild;
    if (!row) continue;

    const ingIdInput = row.querySelector(".ing-id");
    const ingNameInp = row.querySelector(".ing-search");
    const uomInp     = row.querySelector(".ing-uom");
    const qtyInp     = row.querySelector(".ing-qty");

    // find matching ingredient in cache for canonical name/UOM
    const ing = (window._ingredientsCache || []).find(i => i.id === (line.ingredientId || line.id));

    // set fields
    ingIdInput.value = line.ingredientId || line.id || ing?.id || "";
    ingNameInp.value = ing?.itemName || line.name || "";
    uomInp.value     = line.uom || ing?.baseUOM || "";
    qtyInp.value     = Number(line.qty || 0) || "";
  }
}
