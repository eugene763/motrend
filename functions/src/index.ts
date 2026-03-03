import {onCall, HttpsError} from "firebase-functions/v2/https";
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import {defineSecret} from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import jwt from "jsonwebtoken";

const klingAccessKey = defineSecret("KLING_ACCESS_KEY");
const klingSecretKey = defineSecret("KLING_SECRET_KEY");

admin.initializeApp();
const db = admin.firestore();

const KLING_BASE_URL = "https://api-singapore.klingai.com";

/**
 * Builds a JWT for Kling API auth (HS256, 30 min expiry).
 * @param {string} accessKey - Kling access key (iss).
 * @param {string} secretKey - Kling secret for signing.
 * @return {string} Signed JWT.
 */
function makeKlingJwt(accessKey: string, secretKey: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: accessKey,
    iat: now - 5,
    nbf: now - 5,
    exp: now + 30 * 60, // 30 минут
  };
  return jwt.sign(payload, secretKey, {algorithm: "HS256"});
}

interface UserDoc {
  creditsBalance?: number;
}

interface TemplateDoc {
  isActive?: boolean;
  durationSec?: number;
  costCredits?: number;
  kling?: {
    referenceVideoUrl?: string;
  };
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

/** При создании юзера начисляем 20 кредитов (1 кредит = 1 сек генерации). */
const INITIAL_CREDITS = 20;

export const onUserDocCreated = onDocumentCreated(
  "users/{userId}",
  async (event) => {
    const ref = event.data?.ref;
    if (!ref) return;
    await ref.update({
      creditsBalance: INITIAL_CREDITS,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
);

export const processJobTrigger001 = onDocumentUpdated(
  {
    document: "jobs/{jobId}",
    secrets: [klingAccessKey, klingSecretKey],
  },
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

    const templateId = after.templateId;
    if (!templateId) {
      await ref.update({
        status: "failed" as JobStatus,
        kling: {state: "failed", error: "Missing templateId"},
        updatedAt: ts,
      });
      return;
    }

    const tplSnap = await db.doc(`templates/${templateId}`).get();
    const tplData = (tplSnap.data() as TemplateDoc | undefined) ?? {};
    const referenceVideoUrl = tplData.kling?.referenceVideoUrl;

    if (!referenceVideoUrl) {
      await ref.update({
        status: "failed" as JobStatus,
        kling: {state: "failed", error: "Template has no referenceVideoUrl"},
        updatedAt: ts,
      });
      return;
    }

    const imageUrl = after.inputImageUrl ?? "";
    if (!imageUrl) {
      await ref.update({
        status: "failed" as JobStatus,
        kling: {state: "failed", error: "Missing inputImageUrl"},
        updatedAt: ts,
      });
      return;
    }
    const accessKey = klingAccessKey.value();
    const secretKey = klingSecretKey.value();

    if (!accessKey || !secretKey) {
      await ref.update({
        status: "failed" as JobStatus,
        kling: {state: "failed", error: "Missing Kling secrets"},
        updatedAt: ts,
      });
      return;
    }

    const token = makeKlingJwt(accessKey, secretKey);

    const endpointUrl = `${KLING_BASE_URL}/v1/videos/motion-control`;

    const payload = {
      video_url: referenceVideoUrl,
      image_url: imageUrl,
      mode: "std",
      keep_original_sound: "yes",
      character_orientation: "video",
      external_task_id: afterSnap.id,
    };

    logger.info("Kling endpointUrl", {endpointUrl, jobId: afterSnap.id});
    logger.info("CALL Kling motion-control", {jobId: afterSnap.id});

    let res;
    try {
      res = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (e: unknown) {
      logger.error("Kling fetch failed", {jobId: afterSnap.id, err: String(e)});
      await ref.update({
        status: "failed" as JobStatus,
        kling: {state: "failed", error: `fetch failed: ${String(e)}`},
        updatedAt: ts,
      });
      return;
    }

    const bodyText = await res.text();
    logger.info("Kling response", {
      jobId: afterSnap.id,
      status: res.status,
      body: bodyText.slice(0, 500),
    });

    if (!res.ok) {
      await ref.update({
        status: "failed" as JobStatus,
        kling: {state: "failed", error: `Kling ${res.status}: ${bodyText}`},
        updatedAt: ts,
      });
      return;
    }

    const json = JSON.parse(bodyText);
    const taskId = json?.data?.task_id;

    if (!taskId) {
      await ref.update({
        status: "failed" as JobStatus,
        kling: {state: "failed", error: `No task_id in response: ${bodyText}`},
        updatedAt: ts,
      });
      return;
    }

    await ref.update({
      kling: {state: "submitted", taskId},
      updatedAt: ts,
    });
  }
);
