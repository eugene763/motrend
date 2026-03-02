import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import {defineSecret} from "firebase-functions/params";
import * as admin from "firebase-admin";

const klingAccessKey = defineSecret("KLING_ACCESS_KEY");
const klingSecretKey = defineSecret("KLING_SECRET_KEY");

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

type JobStatus =
  | "queued"
  | "uploading"
  | "processing"
  | "done"
  | "failed";

interface KlingState {
  taskId?: string;
  state?: string;
  progress?: number;
  outputUrl?: string;
  error?: string;
}

interface JobDoc {
  uid: string;
  status: JobStatus;
  inputImagePath?: string;
  inputImageUrl?: string;
  referenceVideoPath?: string;
  referenceVideoUrl?: string;
  templateId?: string;
  kling?: KlingState;
  createdAt: FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.FieldValue;
}

const corsAllowedOrigins = [
  /gen-lang-client-0651837818\.(web\.app|firebaseapp\.com)$/,
  /^https?:\/\/localhost(:\d+)?$/,
];

export const createJob = onCall(
  {cors: corsAllowedOrigins, secrets: [klingAccessKey, klingSecretKey]},
  async (req) => {
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
    const durationSec: number =
      hasDuration ? tplData.durationSec as number : 10;

    const hasCostOverride = typeof tplData.costCredits === "number" &&
      tplData.costCredits > 0;
    const costCredits = hasCostOverride ?
      Math.floor(tplData.costCredits as number) :
      Math.max(1, Math.ceil(durationSec));

    const {jobId, uploadPath} = await db.runTransaction(async (tx) => {
      const userRef = db.collection("users").doc(uid);
      const userSnap = await tx.get(userRef);
      const userData = (userSnap.data() as UserDoc | undefined) ?? {};
      const rawCredits = userData.creditsBalance;
      const currentCredits =
        typeof rawCredits === "number" && Number.isFinite(rawCredits) ?
          rawCredits :
          0;

      if (currentCredits < costCredits) {
        throw new HttpsError(
          "resource-exhausted",
          "Not enough credits for this generation."
        );
      }

      tx.set(
        userRef,
        {
          creditsBalance: currentCredits - costCredits,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        {merge: true}
      );

      const jobRef = db.collection("jobs").doc();
      const now = admin.firestore.FieldValue.serverTimestamp();
      const uploadPathForJob =
        `user_uploads/${uid}/${jobRef.id}/photo.jpg`;
      const initialJob: Partial<JobDoc> = {
        uid,
        status: "queued",
        inputImagePath: uploadPathForJob,
        templateId,
        kling: {},
        createdAt: now,
        updatedAt: now,
      };
      tx.set(jobRef, initialJob);
      return {jobId: jobRef.id, uploadPath: uploadPathForJob};
    });

    return {jobId, uploadPath};
  });

export const processJobTrigger001 = onDocumentUpdated(
  {document: "jobs/{jobId}", secrets: [klingAccessKey, klingSecretKey]},
  async (event) => {
    const before = event.data?.before.data();
    const afterSnap = event.data?.after;
    const after = afterSnap?.data() as Partial<JobDoc> | undefined;
    if (!before || !after || !afterSnap) return;

    const inputAdded = !before.inputImageUrl && !!after.inputImageUrl;
    if (!inputAdded) return;
    if (after.status !== "queued") return;

    const ref = afterSnap.ref;
    const ts = admin.firestore.FieldValue.serverTimestamp();

    await ref.update({
      status: "processing" as JobStatus,
      kling: {state: "processing"},
      updatedAt: ts,
    });

    // Stub: real Kling will set done + kling.outputUrl or failed + kling.error
    const stubError = "Kling not configured yet (stub).";
    await ref.update({
      status: "failed" as JobStatus,
      kling: {state: "failed", error: stubError},
      updatedAt: ts,
    });
  }
);
