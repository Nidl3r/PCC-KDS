const {onSchedule} = require("firebase-functions/v2/scheduler");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, Timestamp} = require("firebase-admin/firestore");

initializeApp();

exports.deleteOldChatMessages = onSchedule("every day 00:00", async (event) => {
  const db = getFirestore();

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

  const deletions = snapshot.docs.map(doc => doc.ref.delete());
  await Promise.all(deletions);

  console.log(`✅ Deleted ${deletions.length} chat messages.`);
});
