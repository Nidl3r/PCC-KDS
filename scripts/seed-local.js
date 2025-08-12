// Tell Admin SDK to talk to the emulators
process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";

const admin = require("firebase-admin");

// No creds needed for emulator
admin.initializeApp({ projectId: "demo-pcc-kds" });

const db = admin.firestore();
const auth = admin.auth();

function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function seed() {
  const date = todayStr();
  const nowIso = new Date().toISOString();

  // ---- Firestore data
  const batch = db.batch();

  // ingredients
  [
    { itemNo: "I1001", itemName: "Ahi", baseUOM: "lb" },
    { itemNo: "I1002", itemName: "Broccolini", baseUOM: "lb" }
  ].forEach((ing) => batch.set(db.collection("ingredients").doc(ing.itemNo), ing));

  // recipes (match fields you use)
  const recipes = [
    {
      id: "r0003", recipeNo: "R0003",
      description: "Taro Rolls", category: "Bakery",
      cost: 1.95, panWeight: 0, venueCodes: ["b001", "b002"],
      pars: { Aloha: { 200: 12 }, Ohana: { 200: 8 }, Gateway: { 200: 10 } }
    },
    {
      id: "r0457", recipeNo: "R0457",
      description: "Roast Chicken", category: "Hotfoods",
      cost: 7.266, panWeight: 3.1, venueCodes: ["b001", "b003"],
      pars: { Aloha: { 200: 2 }, Gateway: { 200: 3 } }
    }
  ];
  recipes.forEach((r) => batch.set(db.collection("recipes").doc(r.id), r));

  // guestCounts (doc id = YYYY-MM-DD)
  batch.set(db.collection("guestCounts").doc(date), {
    date,
    Aloha: 200, Ohana: 180, Gateway: 220, Concession: 150
  });

  // orders
  [
    {
      id: "ord-start-aloha-r0457",
      venue: "Aloha", date, type: "starting-par",
      recipeId: "r0457", recipeNo: "R0457",
      pans: 2, panWeight: 3.1, netWeight: 25.4,
      qty: 31.6, costPerLb: 7.266, totalCost: 184.56,
      received: true, status: "received",
      receivedAt: nowIso, timestamp: nowIso
    },
    {
      id: "ord-addon-gateway-r0003",
      venue: "Gateway", date, type: "addon",
      recipeId: "r0003", recipeNo: "R0003",
      qty: 40, costPerLb: 1.95, totalCost: 78,
      received: true, status: "received",
      receivedAt: nowIso, timestamp: nowIso
    }
  ].forEach((o) => batch.set(db.collection("orders").doc(o.id), o));

  // waste
  [
    { id: "w1", venue: "Main Kitchen", date, item: "Mochi Chocolate Chip Cookie", uom: "ea", qty: 1, timestamp: nowIso },
    { id: "w2", venue: "Aloha", date, item: "Taro Rolls", uom: "ea", qty: 1, timestamp: nowIso }
  ].forEach((w) => batch.set(db.collection("waste").doc(w.id), w));

  await batch.commit();

  // ---- (Optional) seed Auth users in emulator
  try {
    await auth.createUser({ uid: "owner1", email: "owner@demo.local", emailVerified: true, password: "Demo1234!" });
    await auth.createUser({ uid: "manager1", email: "manager@demo.local", emailVerified: true, password: "Demo1234!" });
    await auth.createUser({ uid: "employee1", email: "employee@demo.local", emailVerified: true, password: "Demo1234!" });

    // attach roles via custom claims
    await auth.setCustomUserClaims("owner1",   { role: "owner" });
    await auth.setCustomUserClaims("manager1", { role: "manager" });
    await auth.setCustomUserClaims("employee1",{ role: "employee" });
  } catch (e) {
    // ignore "already exists" errors on repeat runs
    if (!String(e).includes("already exists")) throw e;
  }

  console.log("✅ Seed complete (Firestore + Auth).");
}

seed().catch((e) => {
  console.error("❌ Seed failed:", e);
  process.exit(1);
});
