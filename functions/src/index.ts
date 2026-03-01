import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

interface UserDoc {
  creditsBalance?: number;
}

interface TemplateDoc {
  isActive?: boolean;
  durationSec?: number;
  costCredits?: number;
}

const corsAllowedOrigins = [
  /gen-lang-client-0651837818\.(web|firebaseapp)\.com$/,
  /^https?:\/\/localhost(:\d+)?$/,
];

export const createJob = onCall({cors: corsAllowedOrigins}, async (req) => {
  if (!req.auth) {
    throw new HttpsError("unauthenticated", "Sign in first");
  }

  const uid = req.auth.uid;

  const templateId = req.data?.templateId;
  if (!templateId || typeof templateId !== "string") {
    throw new HttpsError("invalid-argument", "templateId is required");
  }
  // Firestore doc ID: letters, digits, underscore, hyphen only
  if (!/^[\w-]+$/.test(templateId)) {
    throw new HttpsError("invalid-argument", "Invalid templateId");
  }

  const tplSnap = await db.doc(`templates/${templateId}`).get();
  const tplData = (tplSnap.data() as TemplateDoc | undefined) ?? {};
  if (!tplSnap.exists || tplData.isActive !== true) {
    throw new HttpsError("failed-precondition", "Template is not active");
  }

  const hasDuration = typeof tplData.durationSec === "number" &&
    tplData.durationSec > 0;
  const durationSec: number = hasDuration ? tplData.durationSec as number : 10;

  const hasCostOverride = typeof tplData.costCredits === "number" &&
    tplData.costCredits > 0;
  const costCredits = hasCostOverride ?
    Math.floor(tplData.costCredits as number) :
    Math.max(1, Math.ceil(durationSec));

  const {jobId, uploadPath} = await db.runTransaction(async (tx) => {
    const userRef = db.collection("users").doc(uid);
    const userSnap = await tx.get(userRef);
    const userData = (userSnap.data() as UserDoc | undefined) ?? {};
    const currentCredits = userData.creditsBalance;

    if (typeof currentCredits === "number" && currentCredits < costCredits) {
      throw new HttpsError(
        "resource-exhausted",
        "Not enough credits for this generation."
      );
    }

    if (typeof currentCredits === "number") {
      tx.set(
        userRef,
        {
          creditsBalance: currentCredits - costCredits,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        {merge: true}
      );
    }

    const jobRef = db.collection("jobs").doc();
    tx.set(jobRef, {
      uid,
      templateId,
      status: "queued",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const uploadPathForJob = `user_uploads/${uid}/${jobRef.id}/photo.jpg`;
    return {jobId: jobRef.id, uploadPath: uploadPathForJob};
  });

  return {jobId, uploadPath};
});

export const processJobTrigger001 = onDocumentUpdated(
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
