// --- Imports (v2) ---
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");

// --- Init ---
initializeApp();
const db = getFirestore();

// --- Secret for Showware webhook ---
const SHOWWARE_WEBHOOK_SECRET = defineSecret("SHOWWARE_WEBHOOK_SECRET");

// ===========================
// 1) Scheduled cleanup (yours)
// ===========================
exports.deleteOldChatMessages = onSchedule("every day 00:00", async (event) => {
  const now = new Date();
  const hawaiiNow = new Date(now.getTime() - 10 * 60 * 60 * 1000); // Midnight HST
  hawaiiNow.setUTCHours(0, 0, 0, 0);

  const start = new Date(hawaiiNow);
  const end = new Date(hawaiiNow);
  end.setUTCDate(end.getUTCDate() + 1);

  const snapshot = await db
    .collection("chats")
    .where("timestamp", ">=", Timestamp.fromDate(start))
    .where("timestamp", "<", Timestamp.fromDate(end))
    .get();

  const deletions = snapshot.docs.map((doc) => doc.ref.delete());
  await Promise.all(deletions);

  console.log(`✅ Deleted ${deletions.length} chat messages.`);
});

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
