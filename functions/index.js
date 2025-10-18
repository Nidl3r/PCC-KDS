// --- Imports (v2) ---
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// --- Init ---
const app = initializeApp();
const db = getFirestore(app);

let ingestKitchenInventory;
try {
  ({ ingestKitchenInventory } = require("./lib/index"));
} catch (err) {
  console.warn("ingestKitchenInventory not yet built; run `npm run build` before deploying.", err);
  ingestKitchenInventory = undefined;
}

// --- Secrets ---
const SHOWWARE_WEBHOOK_SECRET = defineSecret("SHOWWARE_WEBHOOK_SECRET");
const INGEST_KEY = defineSecret("INGEST_KEY");

// ===========================
// 1) Scheduled cleanup (yours)
// ===========================
exports.deleteOldChatMessages = onSchedule(
  {
    schedule: "every day 00:00",
    timeZone: "Pacific/Honolulu",
  },
  async () => {
    await deleteCollectionContents("chats", "chat messages");
  }
);

exports.clearPowerbiDaily = onSchedule(
  {
    schedule: "59 23 * * *",
    timeZone: "Pacific/Honolulu",
  },
  async () => {
    await archivePowerbiDaily();
  }
);

// ===================================
// 2) Showware → Firestore webhook (v2)
// ===================================
exports.showwareWebhook = onRequest(
  {
    region: "us-central1",
    secrets: [SHOWWARE_WEBHOOK_SECRET],
    cors: true, // allow server-to-server POSTs; adjust if you want stricter CORS
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
      }

      // 🔐 Verify shared secret header
      const provided = (req.get("x-showware-secret") || "").trim();
      const expected = (SHOWWARE_WEBHOOK_SECRET.value() || "").trim();
      if (!provided || !expected || provided !== expected) {
        res.status(401).send({ ok: false, error: "Invalid or missing secret." });
        return;
      }

      // 🧾 Idempotency (prevents duplicate processing)
      const idempotencyKey =
        req.get("idempotency-key") || (req.body && req.body.id) || "";

      if (idempotencyKey) {
        const receiptRef = db.collection("_webhookReceipts").doc(idempotencyKey);
        const receiptSnap = await receiptRef.get();
        if (receiptSnap.exists) {
          // Already processed; respond OK so sender doesn't retry
          res.status(200).send({ ok: true, duplicate: true });
          return;
        }
        await receiptRef.set({ processedAt: FieldValue.serverTimestamp() });
      }

      // 📦 Payload (store raw for flexibility; you can normalize later)
      const payload = typeof req.body === "object" ? req.body : {};
      const eventType = String(payload.eventType || "unknown");

      // 📝 Write to Firestore
      const docRef = idempotencyKey
        ? db.collection("showwareEvents").doc(idempotencyKey)
        : db.collection("showwareEvents").doc();

      await docRef.set(
        {
          eventType,
          raw: payload,
          receivedAt: FieldValue.serverTimestamp(),
          idempotencyKey: idempotencyKey || null,
          source: "showware",
        },
        { merge: true }
      );

      res.status(200).send({ ok: true });
    } catch (err) {
      console.error("showwareWebhook error:", err);
      res.status(500).send({ ok: false, error: err?.message || "Unknown error" });
    }
  }
);

// ------------------------------
// Helper to chunk an array
// ------------------------------
const chunk = (items, size) => {
  if (!Array.isArray(items) || size <= 0) {
    return [];
  }

  const result = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

async function deleteCollectionContents(collectionName, logLabel) {
  const snapshot = await db.collection(collectionName).get();

  if (snapshot.empty) {
    console.log(`No ${logLabel} to delete.`);
    return;
  }

  const docs = snapshot.docs;
  const batchSize = 500;
  let deleted = 0;

  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = db.batch();
    const slice = docs.slice(i, i + batchSize);

    slice.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += slice.length;
  }

  console.log(`✅ Deleted ${deleted} ${logLabel}.`);
}

async function archivePowerbiDaily() {
  const sourceSnap = await db.collection("powerbiDaily").get();
  const archiveDate = formatHawaiiArchiveDate();

  if (sourceSnap.empty) {
    console.log("No powerbiDaily documents to archive.");
    await archiveKitchenInventory(archiveDate);
    return;
  }

  const usedIds = new Set();
  const docs = sourceSnap.docs;
  const batchSize = 200; // 200 docs × (set+delete) = 400 ops ≤ 500
  let processed = 0;

  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = db.batch();
    const slice = docs.slice(i, i + batchSize);

    slice.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const parentRaw =
        data.Parent_Item_No ??
        data.parentItemNo ??
        data.parent_item_no ??
        docSnap.id;
      const parentStr = String(parentRaw ?? "").trim() || "powerbi";
      const safeParent = parentStr.replace(/[^A-Za-z0-9_-]+/g, "_") || "powerbi";

      let targetIdBase = `${safeParent}_${archiveDate}`;
      let targetId = targetIdBase;
      let dedupe = 2;
      while (usedIds.has(targetId)) {
        targetId = `${targetIdBase}_${dedupe}`;
        dedupe += 1;
      }
      usedIds.add(targetId);

      const destRef = db.collection("Pastrecipebom").doc(targetId);
      batch.set(destRef, {
        ...data,
        archivedAt: FieldValue.serverTimestamp(),
        archivedFromId: docSnap.id
      });
      batch.delete(docSnap.ref);
      processed += 1;
    });

    await batch.commit();
  }

  console.log(`✅ Archived and cleared ${processed} powerbiDaily documents for ${archiveDate}.`);
  await archiveKitchenInventory(archiveDate);
}

async function archiveKitchenInventory(archiveDate) {
  const sourceSnap = await db.collection("kitchen inventory").get();

  if (sourceSnap.empty) {
    console.log("No kitchen inventory documents to archive.");
    return;
  }

  const usedIds = new Set();
  const docs = sourceSnap.docs;
  const batchSize = 200;
  let processed = 0;

  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = db.batch();
    const slice = docs.slice(i, i + batchSize);

    slice.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const baseId = String(docSnap.id || "kitchen").replace(/[^A-Za-z0-9_-]+/g, "_") || "kitchen";

      let targetIdBase = `${baseId}_${archiveDate}`;
      let targetId = targetIdBase;
      let dedupe = 2;
      while (usedIds.has(targetId)) {
        targetId = `${targetIdBase}_${dedupe}`;
        dedupe += 1;
      }
      usedIds.add(targetId);

      const destRef = db.collection("pastkitcheninventory").doc(targetId);
      batch.set(destRef, {
        ...data,
        archivedAt: FieldValue.serverTimestamp(),
        archivedFromId: docSnap.id
      });
      batch.delete(docSnap.ref);
      processed += 1;
    });

    await batch.commit();
  }

  console.log(`✅ Archived and cleared ${processed} kitchen inventory documents for ${archiveDate}.`);
}

function formatHawaiiArchiveDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    month: "2-digit",
    day: "2-digit",
    year: "numeric"
  });

  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  const month = parts.month || "01";
  const day = parts.day || "01";
  const year = parts.year || "1970";
  return `${month}-${day}-${year}`;
}

// ======================================
// 3) PowerBI ingestion → Firestore (v2)
// ======================================
exports.ingestPowerBI = onRequest(
  {
    region: "us-central1",
    secrets: [INGEST_KEY],
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).send({ ok: false, error: "Method Not Allowed" });
        return;
      }

      const providedKey = (req.get("x-api-key") || "").trim();
      const expectedKey = (INGEST_KEY.value() || "").trim();
      if (!providedKey || !expectedKey || providedKey !== expectedKey) {
        res.status(401).send({ ok: false, error: "Unauthorized" });
        return;
      }

      const payload =
        typeof req.body === "object" && req.body !== null ? req.body : null;

      if (!payload) {
        res.status(400).send({ ok: false, error: "Invalid JSON body." });
        return;
      }

      const { collection, pkField, runId, rows } = payload;

      if (
        typeof collection !== "string" ||
        !collection ||
        typeof pkField !== "string" ||
        !pkField ||
        typeof runId !== "string" ||
        !runId ||
        !Array.isArray(rows)
      ) {
        res.status(400).send({ ok: false, error: "Missing or invalid fields." });
        return;
      }

      const batchId = Date.now();
      let totalWritten = 0;
      const rowChunks = chunk(rows, 450);

      for (const chunkRows of rowChunks) {
        const batch = db.batch();

        chunkRows.forEach((row, index) => {
          if (typeof row !== "object" || row === null) {
            throw new Error(`Row at index ${totalWritten + index} is invalid.`);
          }

          const docIdValue = row[pkField];
          if (docIdValue === undefined || docIdValue === null) {
            throw new Error(
              `Row at index ${totalWritten + index} missing pkField "${pkField}".`
            );
          }

          const docRef = db.collection(collection).doc(String(docIdValue));
          batch.set(docRef, {
            ...row,
            runId,
            _batchId: batchId,
            _ingestedAt: FieldValue.serverTimestamp(),
          });
        });

        await batch.commit();
        totalWritten += chunkRows.length;
      }

      res.status(200).send({
        ok: true,
        written: totalWritten,
        collection,
        pkField,
      });
    } catch (err) {
      console.error("ingestPowerBI error:", err);
      res.status(500).send({ ok: false, error: err?.message || "Unknown error" });
    }
  }
);

if (ingestKitchenInventory) {
  exports.ingestKitchenInventory = ingestKitchenInventory;
}
