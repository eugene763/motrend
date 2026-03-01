const admin = require("firebase-admin");

const PROJECT_ID = "gen-lang-client-0651837818"; // PROD projectId

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: PROJECT_ID,
});

const db = admin.firestore();

async function main() {
  const docId = "bella";

  const data = {
    title: "bella_trend",
    order: 3,
    isActive: true,
    durationSec: 15,
    modeDefault: "std",
    preview: {
      previewVideoUrl: "https://firebasestorage.googleapis.com/v0/b/gen-lang-client-0651837818.firebasestorage.app/o/template%2Fpreview%2Fbella_trend_preview.mp4?alt=media&token=8e992639-4516-4c19-bf28-3b3363ab0e46",
      thumbnailUrl: "https://firebasestorage.googleapis.com/v0/b/gen-lang-client-0651837818.firebasestorage.app/o/template%2Fthumb%2Fbella_trend_thumble%20(2).png?alt=media&token=3dfc25cd-5a02-4287-8732-c6a92573bbc1",
    },
    kling: {
      referenceVideoUrl: "https://firebasestorage.googleapis.com/v0/b/gen-lang-client-0651837818.firebasestorage.app/o/template%2Freference%2Fbella_kling.mp4?alt=media&token=062edfda-93e0-4938-a376-e5338df0db3f",
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection("templates").doc(docId).set(data, { merge: true });
  console.log(`✅ Template '${docId}' upserted in ${PROJECT_ID}/templates/${docId}`);
}

main().catch((e) => {
  console.error("❌ Failed:", e);
  process.exit(1);
});
