import {onCall, HttpsError} from "firebase-functions/v2/https";
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
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
  modeDefault?: string;
  prompt?: string;
}

const KLING_BASE = "https://api.klingapi.com";
const POLL_INTERVAL_MS = 15_000;
const POLL_TIMEOUT_MS = 8 * 60 * 1000; // 8 min

/**
 * Submits image-to-video job to Kling API and polls until done or timeout.
 * @param {string} apiKey - Kling API key (Bearer).
 * @param {string} imageUrl - Public URL of the input image.
 * @param {Object} opts - Duration, mode, and prompt for generation.
 * @param {number} opts.durationSec - Duration in seconds.
 * @param {string} opts.mode - "standard" or "professional".
 * @param {string} opts.prompt - Text prompt for the video.
 * @return {Promise} Resolves with object containing videoUrl or error.
 */
async function runKlingImage2Video(
  apiKey: string,
  imageUrl: string,
  opts: {durationSec: number; mode: string; prompt: string}
): Promise<{videoUrl?: string; error?: string}> {
  const duration = opts.durationSec >= 10 ? 10 : 5;
  const res = await fetch(`${KLING_BASE}/v1/videos/image2video`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "kling-v2.6-pro",
      image_url: imageUrl,
      prompt: opts.prompt,
      duration,
      aspect_ratio: "9:16",
      mode: opts.mode === "professional" ? "professional" : "standard",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    return {error: `Kling API error ${res.status}: ${text}`};
  }
  type KlingCreate = {task_id?: string; code?: number; message?: string};
  const data = (await res.json()) as KlingCreate;
  if (data.code && data.code !== 0) {
    return {error: data.message ?? `Kling error ${data.code}`};
  }
  const taskId = data.task_id;
  if (!taskId) {
    return {error: "Kling API did not return task_id"};
  }
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusRes = await fetch(`${KLING_BASE}/v1/videos/${taskId}`, {
      headers: {"Authorization": `Bearer ${apiKey}`},
    });
    if (!statusRes.ok) {
      return {error: `Kling status check failed: ${statusRes.status}`};
    }
    type KlingStatus = {
      data?: {
        task_status?: string;
        task_result?: {video_url?: string};
        task_status_msg?: string;
      };
    };
    const statusData = (await statusRes.json()) as KlingStatus;
    const taskStatus = statusData.data?.task_status;
    if (taskStatus === "succeed") {
      const videoUrl = statusData.data?.task_result?.video_url;
      return videoUrl ? {videoUrl} : {error: "No video_url in result"};
    }
    if (taskStatus === "failed") {
      return {error: statusData.data?.task_status_msg ?? "Kling task failed"};
    }
  }
  return {error: "Kling generation timed out"};
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

/** 20 кредитов при регистрации (1 кредит = 1 сек генерации). */
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
    const after = afterSnap?.data();
    if (!before || !after || !afterSnap) return;

    const inputAdded = !before.inputImageUrl && !!after.inputImageUrl;
    if (!inputAdded) return;
    if (after.status !== "queued") return;

    const ref = afterSnap.ref;
    const templateId = after.templateId as string | undefined;
    const inputImageUrl = after.inputImageUrl as string | undefined;
    if (!templateId || !inputImageUrl) return;

    await ref.update({
      status: "processing",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const apiKey = (await klingAccessKey.value()).trim();
    if (!apiKey) {
      await ref.update({
        status: "failed",
        errorMessage:
          "Kling API key not set. Add KLING_ACCESS_KEY in Firebase secrets.",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    const tplSnap = await db.doc(`templates/${templateId}`).get();
    const tplData = (tplSnap.data() as TemplateDoc | undefined) ?? {};
    const durationSec =
      typeof tplData.durationSec === "number" && tplData.durationSec > 0 ?
        tplData.durationSec :
        10;
    const mode =
      tplData.modeDefault === "professional" ?
        "professional" :
        "standard";
    const prompt =
      typeof tplData.prompt === "string" && tplData.prompt ?
        tplData.prompt :
        "Person in gentle motion, natural movement.";

    const result = await runKlingImage2Video(apiKey, inputImageUrl, {
      durationSec,
      mode,
      prompt,
    });

    if (result.videoUrl) {
      await ref.update({
        status: "done",
        outputVideoUrl: result.videoUrl,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      await ref.update({
        status: "failed",
        errorMessage: result.error ?? "Video generation failed.",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
);
