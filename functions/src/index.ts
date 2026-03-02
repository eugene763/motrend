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

type KlingResult = {
  videoUrl?: string;
  error?: string;
  providerJobId: string;
  providerRequestId?: string;
};

/**
 * Submits image-to-video job to Kling API and polls until done or timeout.
 * Calls onQueued with providerJobId and providerRequestId (if present) right after create.
 * @return {Promise} Resolves with videoUrl/error and integration ids.
 */
async function runKlingImage2Video(
  jobId: string,
  apiKey: string,
  imageUrl: string,
  opts: {
    durationSec: number;
    mode: string;
    prompt: string;
    onQueued?: (providerJobId: string, providerRequestId?: string) => Promise<void>;
  }
): Promise<KlingResult> {
  const duration = opts.durationSec >= 10 ? 10 : 5;
  const payload = {
    model: "kling-v2.6-pro",
    image_url: imageUrl,
    prompt: opts.prompt,
    duration,
    aspect_ratio: "9:16",
    mode: opts.mode === "professional" ? "professional" : "standard",
  };
  console.log("CALL Kling payload=" + JSON.stringify(payload) + " jobId=" + jobId);
  const res = await fetch(`${KLING_BASE}/v1/videos/image2video`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const bodyText = await res.text();
  const providerRequestId =
    res.headers.get("x-request-id") ?? res.headers.get("request-id") ?? undefined;
  console.log(
    "Kling response status=" + res.status + " body=" + bodyText.slice(0, 500) + " jobId=" + jobId
  );
  if (!res.ok) {
    return {
      error: `Kling API error ${res.status}: ${bodyText}`,
      providerJobId: "",
      providerRequestId,
    };
  }
  type KlingCreate = {task_id?: string; code?: number; message?: string};
  const data = JSON.parse(bodyText) as KlingCreate;
  if (data.code && data.code !== 0) {
    return {
      error: data.message ?? `Kling error ${data.code}`,
      providerJobId: "",
      providerRequestId,
    };
  }
  const taskId = data.task_id;
  if (!taskId) {
    return {
      error: "Kling API did not return task_id",
      providerJobId: "",
      providerRequestId,
    };
  }
  if (opts.onQueued) {
    await opts.onQueued(taskId, providerRequestId);
  }
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusRes = await fetch(`${KLING_BASE}/v1/videos/${taskId}`, {
      headers: {"Authorization": `Bearer ${apiKey}`},
    });
    if (!statusRes.ok) {
      return {
        error: `Kling status check failed: ${statusRes.status}`,
        providerJobId: taskId,
        providerRequestId,
      };
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
    console.log("POLL Kling status=" + (taskStatus ?? "unknown") + " jobId=" + jobId);
    if (taskStatus === "succeed") {
      const videoUrl = statusData.data?.task_result?.video_url;
      return videoUrl
        ? {videoUrl, providerJobId: taskId, providerRequestId}
        : {
            error: "No video_url in result",
            providerJobId: taskId,
            providerRequestId,
          };
    }
    if (taskStatus === "failed") {
      return {
        error: statusData.data?.task_status_msg ?? "Kling task failed",
        providerJobId: taskId,
        providerRequestId,
      };
    }
  }
  return {
    error: "Kling generation timed out",
    providerJobId: taskId,
    providerRequestId,
  };
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
    timeoutSeconds: 540,
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
    const jobId = ref.id;
    const uid = (after.uid as string | undefined) ?? "";
    const templateId = after.templateId as string | undefined;
    const inputImageUrl = after.inputImageUrl as string | undefined;
    if (!templateId || !inputImageUrl) return;

    console.log("START jobId=" + jobId + " template=" + templateId + " uid=" + uid);

    const startedAt = admin.firestore.FieldValue.serverTimestamp();
    await ref.update({
      status: "processing",
      updatedAt: startedAt,
    });

    const updateIntegration = (fields: Record<string, unknown>) =>
      ref.update({
        ...fields,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    try {
      const apiKey = (await klingAccessKey.value()).trim();
      if (!apiKey) {
        await updateIntegration({
          status: "failed",
          errorMessage:
            "Kling API key not set. Add KLING_ACCESS_KEY in Firebase secrets.",
          integration: {
            provider: "kling",
            providerStatus: "failed",
            providerError: "Kling API key not set",
            startedAt,
            finishedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
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

      console.log("FETCH template OK jobId=" + jobId);

      const result = await runKlingImage2Video(jobId, apiKey, inputImageUrl, {
        durationSec,
        mode,
        prompt,
        onQueued: async (providerJobId, providerRequestId) => {
          const integration: Record<string, unknown> = {
            provider: "kling",
            providerJobId,
            providerStatus: "queued",
            startedAt,
          };
          if (providerRequestId) integration.providerRequestId = providerRequestId;
          await ref.update({
            integration,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        },
      });

      const finishedAt = admin.firestore.FieldValue.serverTimestamp();
      if (result.videoUrl) {
        console.log("DONE outputUrl=" + result.videoUrl + " jobId=" + jobId);
        await ref.update({
          status: "done",
          outputVideoUrl: result.videoUrl,
          "integration.providerStatus": "succeeded",
          "integration.finishedAt": finishedAt,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        const integrationUpdate = result.providerJobId
          ? {
              "integration.providerStatus": "failed",
              "integration.providerError": result.error ?? "Video generation failed.",
              "integration.finishedAt": finishedAt,
            }
          : {
              integration: {
                provider: "kling",
                providerRequestId: result.providerRequestId ?? null,
                providerJobId: null,
                providerStatus: "failed",
                providerError: result.error ?? "Video generation failed.",
                startedAt,
                finishedAt,
              },
            };
        await ref.update({
          status: "failed",
          errorMessage: result.error ?? "Video generation failed.",
          ...integrationUpdate,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateIntegration({
        status: "failed",
        errorMessage: `Processing error: ${msg}`,
        integration: {
          provider: "kling",
          providerStatus: "failed",
          providerError: msg,
          startedAt,
          finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      });
    }
  }
);
