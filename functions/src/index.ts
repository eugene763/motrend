import {onCall, HttpsError} from "firebase-functions/v2/https";
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {defineSecret} from "firebase-functions/params";
import * as admin from "firebase-admin";
import jwt from "jsonwebtoken";

const KLING_ACCESS_KEY = defineSecret("KLING_ACCESS_KEY");
const KLING_SECRET_KEY = defineSecret("KLING_SECRET_KEY");

/**
 * Builds a JWT for Kling API auth (HS256, 30 min expiry).
 * @param accessKey - Kling access key (iss).
 * @param secretKey - Kling secret key (signing).
 * @returns Signed JWT string.
 */
function makeKlingJwt(accessKey: string, secretKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: accessKey,
    iat: now - 5,
    nbf: now - 5,
    exp: now + 30 * 60, // 30 минут
  };
  return jwt.sign(payload, secretKey, {algorithm: "HS256"});
}

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
  kling?: { referenceVideoUrl?: string };
}

const KLING_BASE_URL = "https://api-singapore.klingai.com";

type SubmitKlingResult = {
  providerJobId?: string;
  providerRequestId?: string;
  providerType?: "image2video" | "motion-control";
  error?: string;
};

/**
 * Only submits job to Kling; does not poll.
 * @param {string} jobId - Firestore job id (for logs).
 * @param {string} apiKey - Kling API key.
 * @param {string} imageUrl - Public image URL.
 * @param {Object} opts - Duration, mode, prompt.
 */
async function submitKlingImage2Video(
  jobId: string,
  apiKey: string,
  imageUrl: string,
  opts: {durationSec: number; mode: string; prompt: string}
): Promise<SubmitKlingResult> {
  const duration = opts.durationSec >= 10 ? 10 : 5;
  const payload = {
    model: "kling-v2.6-pro",
    image_url: imageUrl,
    prompt: opts.prompt,
    duration,
    aspect_ratio: "9:16",
    mode: opts.mode === "professional" ? "professional" : "standard",
  };
  console.log(
    "CALL Kling payload=" + JSON.stringify(payload) + " jobId=" + jobId
  );
  const endpointUrl = `${KLING_BASE_URL}/v1/videos/image2video`;
  console.log("Kling endpointUrl=" + endpointUrl + " jobId=" + jobId);
  let res: Response;
  try {
    res = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const e = err as Error & { cause?: unknown };
    console.error(
      "Kling fetch failed jobId=" + jobId,
      "name=" + (e?.name ?? "?"),
      "message=" + (e?.message ?? "?"),
      "cause=" + (e?.cause != null ? String(e.cause) : "undefined"),
      "stack=" + (e?.stack ?? "?")
    );
    return {
      error: "Processing error: " + (e?.message ?? "fetch failed"),
    };
  }
  const bodyText = await res.text();
  const providerRequestId =
    res.headers.get("x-request-id") ??
    res.headers.get("request-id") ??
    undefined;
  console.log(
    "Kling response status=" + res.status +
    " body=" + bodyText.slice(0, 500) + " jobId=" + jobId
  );
  if (!res.ok) {
    return {
      error: `Kling API error ${res.status}: ${bodyText}`,
      providerRequestId,
    };
  }
  type KlingCreate = {task_id?: string; code?: number; message?: string};
  const data = JSON.parse(bodyText) as KlingCreate;
  if (data.code && data.code !== 0) {
    return {
      error: data.message ?? `Kling error ${data.code}`,
      providerRequestId,
    };
  }
  const taskId = data.task_id;
  if (!taskId) {
    return {
      error: "Kling API did not return task_id",
      providerRequestId,
    };
  }
  return {providerJobId: taskId, providerRequestId, providerType: "image2video"};
}

/**
 * Submit Kling motion-control (reference video + image).
 * POST /v1/videos/motion-control
 */
async function submitKlingMotionControl(
  jobId: string,
  apiKey: string,
  videoUrl: string,
  imageUrl: string,
  opts: {durationSec: number; mode: string; prompt: string}
): Promise<SubmitKlingResult> {
  const duration = opts.durationSec >= 10 ? 10 : 5;
  const payload = {
    model: "kling-v2.6-pro",
    video_url: videoUrl,
    image_url: imageUrl,
    prompt: opts.prompt,
    duration,
    aspect_ratio: "9:16",
    mode: opts.mode === "professional" ? "professional" : "standard",
  };
  console.log(
    "CALL Kling motion-control payload=" + JSON.stringify(payload) + " jobId=" + jobId
  );
  const endpointUrl = `${KLING_BASE_URL}/v1/videos/motion-control`;
  console.log("Kling endpointUrl=" + endpointUrl + " jobId=" + jobId);
  let res: Response;
  try {
    res = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const e = err as Error & { cause?: unknown };
    console.error(
      "Kling motion-control fetch failed jobId=" + jobId,
      "name=" + (e?.name ?? "?"),
      "message=" + (e?.message ?? "?"),
      "cause=" + (e?.cause != null ? String(e.cause) : "undefined"),
      "stack=" + (e?.stack ?? "?")
    );
    return {
      error: "Processing error: " + (e?.message ?? "fetch failed"),
    };
  }
  const bodyText = await res.text();
  const providerRequestId =
    res.headers.get("x-request-id") ??
    res.headers.get("request-id") ??
    undefined;
  console.log(
    "Kling motion-control response status=" + res.status +
    " body=" + bodyText.slice(0, 500) + " jobId=" + jobId
  );
  if (!res.ok) {
    return {
      error: `Kling API error ${res.status}: ${bodyText}`,
      providerRequestId,
    };
  }
  type KlingCreate = {task_id?: string; code?: number; message?: string};
  const data = JSON.parse(bodyText) as KlingCreate;
  if (data.code && data.code !== 0) {
    return {
      error: data.message ?? `Kling error ${data.code}`,
      providerRequestId,
    };
  }
  const taskId = data.task_id;
  if (!taskId) {
    return {
      error: "Kling API did not return task_id",
      providerRequestId,
    };
  }
  return {providerJobId: taskId, providerRequestId, providerType: "motion-control"};
}

type PollKlingResult = {
  status: "succeed" | "failed" | "pending";
  videoUrl?: string;
  error?: string;
};

/**
 * Polls Kling once for task status.
 * GET /v1/videos/{task_id} for image2video, GET /v1/videos/motion-control/{task_id} for motion-control.
 */
async function pollKlingJob(
  apiKey: string,
  providerJobId: string,
  jobId: string,
  providerType?: "image2video" | "motion-control"
): Promise<PollKlingResult> {
  const endpointUrl = providerType === "motion-control"
    ? `${KLING_BASE_URL}/v1/videos/motion-control/${providerJobId}`
    : `${KLING_BASE_URL}/v1/videos/${providerJobId}`;
  console.log("Kling poll endpointUrl=" + endpointUrl + " jobId=" + jobId);
  let statusRes: Response;
  try {
    statusRes = await fetch(endpointUrl, {
      headers: {"Authorization": `Bearer ${apiKey}`},
    });
  } catch (err) {
    const e = err as Error & { cause?: unknown };
    console.error(
      "Kling poll fetch failed jobId=" + jobId,
      "name=" + (e?.name ?? "?"),
      "message=" + (e?.message ?? "?"),
      "cause=" + (e?.cause != null ? String(e.cause) : "undefined"),
      "stack=" + (e?.stack ?? "?")
    );
    return {
      status: "failed",
      error: "Poll error: " + (e?.message ?? "fetch failed"),
    };
  }
  const statusBodyText = await statusRes.text();
  console.log(
    "Kling poll response status=" + statusRes.status +
    " body=" + statusBodyText.slice(0, 500) + " jobId=" + jobId
  );
  if (!statusRes.ok) {
    return {
      status: "failed",
      error: `Kling status check failed: ${statusRes.status}`,
    };
  }
  type KlingStatus = {
    data?: {
      task_status?: string;
      task_result?: {video_url?: string};
      task_status_msg?: string;
    };
  };
  const statusData = JSON.parse(statusBodyText) as KlingStatus;
  const taskStatus = statusData.data?.task_status;
  console.log(
    "POLL Kling status=" + (taskStatus ?? "unknown") + " jobId=" + jobId
  );
  if (taskStatus === "succeed") {
    const videoUrl = statusData.data?.task_result?.video_url;
    return videoUrl ?
      {status: "succeed", videoUrl} :
      {status: "failed", error: "No video_url in result"};
  }
  if (taskStatus === "failed") {
    return {
      status: "failed",
      error: statusData.data?.task_status_msg ?? "Kling task failed",
    };
  }
  return {status: "pending"};
}

const corsAllowedOrigins = [
  /gen-lang-client-0651837818\.(web\.app|firebaseapp\.com)$/,
  /^https?:\/\/localhost(:\d+)?$/,
];

export const createJob = onCall(
  {cors: corsAllowedOrigins, secrets: [KLING_ACCESS_KEY, KLING_SECRET_KEY]},
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

/** Stage 1: on inputImageUrl set — create Kling task, set status=processing. */
export const processJobTrigger001 = onDocumentUpdated(
  {
    document: "jobs/{jobId}",
    secrets: [KLING_ACCESS_KEY, KLING_SECRET_KEY],
    timeoutSeconds: 60,
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

    console.log(
      "START jobId=" + jobId + " template=" + templateId + " uid=" + uid
    );

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
      const accessKey = await KLING_ACCESS_KEY.value();
      const secretKey = await KLING_SECRET_KEY.value();
      if (!accessKey || !secretKey) {
        throw new Error("Kling secrets missing (KLING_ACCESS_KEY / KLING_SECRET_KEY)");
      }
      const token = makeKlingJwt(accessKey, secretKey);
      // безопасная отладка (не печатай токен!)
      console.log("Kling auth debug", {
        tokenLen: token.length,
        tokenParts: token.split(".").length,
      });

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
      const defaultPrompt = "Person in gentle motion, natural movement.";
      const prompt =
        typeof tplData.prompt === "string" && tplData.prompt ?
          tplData.prompt :
          defaultPrompt;

      console.log("FETCH template OK jobId=" + jobId);

      const referenceVideoUrl = tplData.kling?.referenceVideoUrl;
      const result = typeof referenceVideoUrl === "string" && referenceVideoUrl
        ? await submitKlingMotionControl(
            jobId, token, referenceVideoUrl, inputImageUrl,
            {durationSec, mode, prompt}
          )
        : await submitKlingImage2Video(
            jobId, token, inputImageUrl,
            {durationSec, mode, prompt}
          );

      if (result.error) {
        const integration: Record<string, unknown> = {
          provider: "kling",
          providerRequestId: result.providerRequestId ?? null,
          providerJobId: result.providerJobId ?? null,
          providerStatus: "failed",
          providerError: result.error,
          startedAt,
          finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await updateIntegration({
          status: "failed",
          errorMessage: result.error,
          integration,
        });
        return;
      }

      const integration: Record<string, unknown> = {
        provider: "kling",
        providerJobId: result.providerJobId,
        providerStatus: "queued",
        providerType: result.providerType ?? "image2video",
        startedAt,
      };
      if (result.providerRequestId) {
        integration.providerRequestId = result.providerRequestId;
      }
      await ref.update({
        integration,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(
        "Kling task created providerJobId=" + result.providerJobId +
        " jobId=" + jobId
      );
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

/** Stage 2: scheduler every 2 min — poll processing jobs, update when done. */
export const pollKlingScheduled = onSchedule(
  {
    schedule: "every 2 minutes",
    secrets: [KLING_ACCESS_KEY, KLING_SECRET_KEY],
    timeoutSeconds: 540,
  },
  async () => {
    const accessKey = await KLING_ACCESS_KEY.value();
    const secretKey = await KLING_SECRET_KEY.value();
    if (!accessKey || !secretKey) return;
    const token = makeKlingJwt(accessKey, secretKey);

    const snap = await db
      .collection("jobs")
      .where("status", "==", "processing")
      .limit(50)
      .get();
    if (snap.empty) return;

    for (const d of snap.docs) {
      const jobId = d.id;
      const data = d.data();
      const integration =
        (data.integration as {providerJobId?: string; providerType?: "image2video" | "motion-control"} | undefined) ?? {};
      const providerJobId = integration.providerJobId;
      if (!providerJobId || typeof providerJobId !== "string") continue;

      const pollResult = await pollKlingJob(token, providerJobId, jobId, integration.providerType);
      const ref = d.ref;
      const finishedAt = admin.firestore.FieldValue.serverTimestamp();

      if (pollResult.status === "succeed" && pollResult.videoUrl) {
        console.log(
          "DONE outputUrl=" + pollResult.videoUrl + " jobId=" + jobId
        );
        await ref.update({
          "status": "done",
          "outputVideoUrl": pollResult.videoUrl,
          "integration.providerStatus": "succeeded",
          "integration.finishedAt": finishedAt,
          "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
        });
      } else if (pollResult.status === "failed") {
        const errMsg = pollResult.error ?? "Video generation failed.";
        await ref.update({
          "status": "failed",
          "errorMessage": errMsg,
          "integration.providerStatus": "failed",
          "integration.providerError": errMsg,
          "integration.finishedAt": finishedAt,
          "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
  }
);

/** Callable: poll Kling once for one job (owner only). */
export const refreshJobStatus = onCall(
  {cors: corsAllowedOrigins, secrets: [KLING_ACCESS_KEY, KLING_SECRET_KEY]},
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first");
    const jobId = req.data?.jobId;
    if (!jobId || typeof jobId !== "string") {
      throw new HttpsError("invalid-argument", "jobId is required");
    }
    if (!/^[\w-]+$/.test(jobId)) {
      throw new HttpsError("invalid-argument", "Invalid jobId");
    }

    const ref = db.collection("jobs").doc(jobId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Job not found");
    const data = snap.data() ?? {};
    if (data.uid !== req.auth.uid) {
      throw new HttpsError("permission-denied", "Not your job");
    }
    if (data.status !== "processing") {
      return {status: data.status, message: "Job is not processing"};
    }
    const integration =
      (data.integration as {providerJobId?: string; providerType?: "image2video" | "motion-control"} | undefined) ?? {};
    const providerJobId = integration.providerJobId;
    if (!providerJobId || typeof providerJobId !== "string") {
      return {status: "processing", message: "No provider job id yet"};
    }

    const accessKey = await KLING_ACCESS_KEY.value();
    const secretKey = await KLING_SECRET_KEY.value();
    if (!accessKey || !secretKey) throw new HttpsError("internal", "Kling not configured");
    const token = makeKlingJwt(accessKey, secretKey);

    const pollResult = await pollKlingJob(token, providerJobId, jobId, integration.providerType);
    const finishedAt = admin.firestore.FieldValue.serverTimestamp();

    if (pollResult.status === "succeed" && pollResult.videoUrl) {
      console.log(
        "DONE outputUrl=" + pollResult.videoUrl + " jobId=" + jobId
      );
      await ref.update({
        "status": "done",
        "outputVideoUrl": pollResult.videoUrl,
        "integration.providerStatus": "succeeded",
        "integration.finishedAt": finishedAt,
        "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      });
      return {status: "done", outputVideoUrl: pollResult.videoUrl};
    }
    if (pollResult.status === "failed") {
      const errMsg = pollResult.error ?? "Video generation failed.";
      await ref.update({
        "status": "failed",
        "errorMessage": errMsg,
        "integration.providerStatus": "failed",
        "integration.providerError": errMsg,
        "integration.finishedAt": finishedAt,
        "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      });
      return {status: "failed", error: pollResult.error};
    }
    return {status: "processing", message: "Still generating"};
  }
);
