"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestKitchenInventory = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
// Ensure the Admin SDK is initialized exactly once.
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
const collectionName = "kitchen inventory";
const MAX_BATCH_SIZE = 500;
const ensureString = (value) => {
    if (typeof value === "string") {
        return value;
    }
    return null;
};
const coerceQuantity = (value) => {
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
const sanitizeDocId = (raw) => {
    const trimmed = raw.trim();
    const withoutWhitespace = trimmed.replace(/\s+/g, "");
    const withoutSeparators = withoutWhitespace.replace(/\//g, "");
    return withoutSeparators;
};
exports.ingestKitchenInventory = (0, https_1.onRequest)({
    region: "us-central1",
    secrets: ["INGEST_KEY"],
    timeoutSeconds: 60,
}, async (req, res) => {
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
    let payload = req.body;
    if (typeof payload === "string") {
        try {
            payload = JSON.parse(payload);
        }
        catch {
            res.status(400).json({ error: "Request body must be valid JSON" });
            return;
        }
    }
    if (!Array.isArray(payload)) {
        res.status(400).json({ error: "Request body must be a JSON array" });
        return;
    }
    const collectionRef = db.collection(collectionName);
    const writes = [];
    let skipped = 0;
    for (const entry of payload) {
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
        const doc = {
            No: rawNo,
            Description: description,
            BaseUOM: baseUOM,
            Quantity: quantity,
            _ingestedAt: firestore_1.FieldValue.serverTimestamp(),
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error while writing to Firestore";
        res.status(500).json({ error: message });
        return;
    }
    res.status(200).json({
        ok: true,
        written: writes.length,
        skipped,
    });
});
