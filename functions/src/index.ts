import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

export const createJob = onCall({cors: true}, async (req) => {
  if (!req.auth) {
    throw new HttpsError("unauthenticated", "Sign in first");
  }

  const templateId = req.data?.templateId;
  if (!templateId || typeof templateId !== "string") {
    throw new HttpsError("invalid-argument", "templateId is required");
  }

  const tpl = await db.doc(`templates/${templateId}`).get();
  if (!tpl.exists || tpl.data()?.isActive !== true) {
    throw new HttpsError("failed-precondition", "Template is not active");
  }

  const jobRef = db.collection("jobs").doc();
  await jobRef.set({
    uid: req.auth.uid,
    templateId,
    status: "queued",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const uploadPath = `user_uploads/${req.auth.uid}/${jobRef.id}/photo.jpg`;
  return {jobId: jobRef.id, uploadPath};
});

export const processJobStubV3 = onDocumentUpdated(
  "jobs/{jobId}",
  async (event) => {
    const before = event.data?.before.data();
    const afterSnap = event.data?.after;
    const after = afterSnap?.data();
    if (!before || !after || !afterSnap) return;

    const inputAdded = !before.inputImageUrl && !!after.inputImageUrl;
    if (!inputAdded) return;
    if (after.status !== "queued") return;

    const ref = afterSnap.ref;

    await ref.update({
      status: "processing",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await ref.update({
      status: "failed",
      errorMessage: "Kling not configured yet (stub).",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
);
