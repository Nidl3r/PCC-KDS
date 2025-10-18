import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { DocumentData, DocumentReference } from "firebase-admin/firestore";

// Ensure the Admin SDK is initialized exactly once.
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const collectionName = "kitchen inventory";
const MAX_BATCH_SIZE = 500;

type IncomingRow = {
  "[No]": unknown;
  "[Description]": unknown;
  "[BaseUOM]": unknown;
  "[Quantity]": unknown;
  [key: string]: unknown;
};

interface InventoryDocument {
  No: string;
  Description: string;
  BaseUOM: string;
  Quantity: number;
  _ingestedAt: FieldValue;
}

const ensureString = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value;
  }
  return null;
};

const coerceQuantity = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const sanitizeDocId = (raw: string): string => {
  const trimmed = raw.trim();
  const withoutWhitespace = trimmed.replace(/\s+/g, "");
  const withoutSeparators = withoutWhitespace.replace(/\//g, "");
  return withoutSeparators;
};

export const ingestKitchenInventory = onRequest(
  {
    region: "us-central1",
    secrets: ["INGEST_KEY"],
    timeoutSeconds: 60,
  },
  async (req, res): Promise<void> => {
  if (req.method !== "POST") {
    res.set("Allow", "POST");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const expectedKey = process.env.INGEST_KEY;
  if (!expectedKey) {
    res.status(500).json({ error: "INGEST_KEY is not configured on the server" });
    return;
  }

  const providedKey = req.get("X-INGEST-KEY");
  if (providedKey !== expectedKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let payload: unknown = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      res.status(400).json({ error: "Request body must be valid JSON" });
      return;
    }
  }

  if (!Array.isArray(payload)) {
    res.status(400).json({ error: "Request body must be a JSON array" });
    return;
  }

  const collectionRef = db.collection(collectionName);
  const writes: Array<{
    ref: DocumentReference<DocumentData>;
    data: InventoryDocument;
  }> = [];

  let skipped = 0;

  for (const entry of payload as IncomingRow[]) {
    if (entry === null || typeof entry !== "object") {
      skipped += 1;
      continue;
    }

    const rawNo = ensureString(entry["[No]"]);
    const description = ensureString(entry["[Description]"]);
    const baseUOM = ensureString(entry["[BaseUOM]"]);
    const quantity = coerceQuantity(entry["[Quantity]"]);

    if (!rawNo || !description || !baseUOM || quantity === null) {
      skipped += 1;
      continue;
    }

    const sanitizedId = sanitizeDocId(rawNo);
    const docRef = sanitizedId.length > 0 ? collectionRef.doc(sanitizedId) : collectionRef.doc();

    const doc: InventoryDocument = {
      No: rawNo,
      Description: description,
      BaseUOM: baseUOM,
      Quantity: quantity,
      _ingestedAt: FieldValue.serverTimestamp(),
    };

    writes.push({ ref: docRef, data: doc });
  }

  try {
    for (let i = 0; i < writes.length; i += MAX_BATCH_SIZE) {
      const batch = db.batch();
      const chunk = writes.slice(i, i + MAX_BATCH_SIZE);
      for (const { ref, data } of chunk) {
        batch.set(ref, data, { merge: true });
      }
      await batch.commit();
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error while writing to Firestore";
    res.status(500).json({ error: message });
    return;
  }

  res.status(200).json({
    ok: true,
    written: writes.length,
    skipped,
  });
});
