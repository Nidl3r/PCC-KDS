// --- Imports (v2) ---
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// --- Init ---
initializeApp();
const db = getFirestore();

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
    const snapshot = await db.collection("chats").get();

    if (snapshot.empty) {
      console.log("No chat messages to delete.");
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

    console.log(`✅ Deleted ${deleted} chat messages.`);
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
