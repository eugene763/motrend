/* eslint-disable require-jsdoc */
import {defineSecret} from "firebase-functions/params";
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

const klingAccessKey = defineSecret("KLING_ACCESS_KEY");
const klingSecretKey = defineSecret("KLING_SECRET_KEY");

const INITIAL_CREDITS = 20;
const INPUT_TTL_MS = 6 * 60 * 60 * 1000;
const POLL_BATCH_LIMIT = 25;
const KLING_TIMEOUT_MS = 20_000;
const KLING_BASE_URL =
  process.env.KLING_BASE_URL || "https://api.klingai.com";
const KLING_CREATE_PATH =
  process.env.KLING_CREATE_PATH || "/v1/videos/motion-control";
const KLING_STATUS_PATH =
  process.env.KLING_STATUS_PATH || "/v1/videos/motion-control";

const corsAllowedOrigins = [
  /^https:\/\/gen-lang-client-0651837818\.(web\.app|firebaseapp\.com)$/,
  /^https?:\/\/localhost(:\d+)?$/,
];

type JobStatus =
  | "queued"
  | "processing"
  | "done"
  | "failed";

interface UserDoc {
  creditsBalance?: number;
}

interface TemplateDoc {
  isActive?: boolean;
  durationSec?: number;
  costCredits?: number;
  referenceVideoUrl?: string;
}

interface KlingState {
  taskId?: string;
  state?: string;
  outputUrl?: string;
  watermarkUrl?: string;
  error?: string;
}

interface JobDoc {
  uid?: string;
  templateId?: string;
  status?: JobStatus;
  inputImagePath?: string;
  inputImageUrl?: string;
  kling?: KlingState;
}

interface KlingSubmitInput {
  templateId: string;
  inputImageUrl: string;
  referenceVideoUrl?: string;
}

interface KlingPollResult {
  state: string;
  outputUrl: string | null;
  watermarkUrl: string | null;
  error: string | null;
  progress: number | null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const normalized = value.trim();
      if (normalized) return normalized;
    }
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpsError) return error.message;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function trailingSlashless(url: string): string {
  return url.replace(/\/+$/, "");
}

function isSuccessState(state: string): boolean {
  return new Set(["succeed", "succeeded", "done", "success", "completed"])
    .has(state);
}

function isFailedState(state: string): boolean {
  return new Set(["failed", "fail", "error", "canceled", "cancelled"])
    .has(state);
}

function extractTaskId(payload: unknown): string | null {
  const root = asObject(payload);
  if (!root) return null;
  const data = asObject(root["data"]);

  return pickString(
    root["task_id"],
    root["taskId"],
    root["id"],
    data?.["task_id"],
    data?.["taskId"],
    data?.["id"]
  );
}

function firstUrlFromArray(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = asObject(value[0]);
  if (!first) return null;
  return pickString(first["url"], first["output_url"], first["outputUrl"]);
}

function extractKlingStatus(payload: unknown): KlingPollResult {
  const root = asObject(payload) || {};
  const data = asObject(root["data"]) || {};
  const output = asObject(data["output"]) || asObject(root["output"]) || {};

  const stateRaw = pickString(
    data["state"],
    data["status"],
    data["task_status"],
    root["state"],
    root["status"]
  );
  const state = (stateRaw || "processing").toLowerCase();

  const outputUrl = pickString(
    output["url"],
    output["output_url"],
    output["outputUrl"],
    data["output_url"],
    data["outputUrl"],
    root["output_url"],
    root["outputUrl"],
    firstUrlFromArray(data["outputs"]),
    firstUrlFromArray(root["outputs"])
  );

  const watermarkUrl = pickString(
    output["watermark_url"],
    output["watermarkUrl"],
    data["watermark_url"],
    data["watermarkUrl"],
    root["watermark_url"],
    root["watermarkUrl"]
  );

  const error = pickString(
    data["error"],
    data["error_message"],
    data["errorMessage"],
    root["error"],
    root["error_message"],
    root["errorMessage"]
  );

  const progress = pickNumber(data["progress"], root["progress"]);

  return {state, outputUrl, watermarkUrl, error, progress};
}

function parseTimeMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

async function klingRequest(
  method: "GET" | "POST",
  path: string,
  accessKey: string,
  secretKey: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const url = `${trailingSlashless(KLING_BASE_URL)}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, KLING_TIMEOUT_MS);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Access-Key": accessKey,
    "X-Secret-Key": secretKey,
    // Some Kling gateways accept Bearer token in this format.
    "Authorization": `Bearer ${accessKey}:${secretKey}`,
  };

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: unknown = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = {message: text};
      }
    }

    if (!response.ok) {
      const payloadObject = asObject(payload) || {};
      const message = pickString(
        payloadObject["message"],
        payloadObject["error"],
        payloadObject["error_message"],
        text
      ) || "Kling request failed";
      throw new Error(`Kling ${response.status}: ${message}`);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function submitKlingTask(
  input: KlingSubmitInput
): Promise<{taskId: string}> {
  const accessKey = klingAccessKey.value();
  const secretKey = klingSecretKey.value();
  if (!accessKey || !secretKey) {
    throw new Error("Kling secrets are missing");
  }

  const payload: Record<string, unknown> = {
    template_id: input.templateId,
    input_image_url: input.inputImageUrl,
  };
  if (input.referenceVideoUrl) {
    payload["reference_video_url"] = input.referenceVideoUrl;
  }

  const response = await klingRequest(
    "POST",
    KLING_CREATE_PATH,
    accessKey,
    secretKey,
    payload
  );
  const taskId = extractTaskId(response);
  if (!taskId) {
    throw new Error("Kling create response does not contain task id");
  }
  return {taskId};
}

async function pollKlingTask(taskId: string): Promise<KlingPollResult> {
  const accessKey = klingAccessKey.value();
  const secretKey = klingSecretKey.value();
  if (!accessKey || !secretKey) {
    throw new Error("Kling secrets are missing");
  }

  const response = await klingRequest(
    "GET",
    `${KLING_STATUS_PATH}/${encodeURIComponent(taskId)}`,
    accessKey,
    secretKey
  );
  return extractKlingStatus(response);
}

export const createJob = onCall(
  {cors: corsAllowedOrigins},
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in first");
    }

    const uid = req.auth.uid;
    const templateId = req.data?.templateId;
    if (!templateId || typeof templateId !== "string") {
      throw new HttpsError("invalid-argument", "templateId is required");
    }
    if (!/^[\w-]+$/.test(templateId)) {
      throw new HttpsError("invalid-argument", "Invalid templateId");
    }

    const templateSnap = await db.doc(`templates/${templateId}`).get();
    const template = (templateSnap.data() as TemplateDoc | undefined) || {};
    if (!templateSnap.exists || template.isActive !== true) {
      throw new HttpsError("failed-precondition", "Template is not active");
    }

    const durationSec = (
      typeof template.durationSec === "number" && template.durationSec > 0
    ) ? template.durationSec : 10;
    const costCredits = (
      typeof template.costCredits === "number" && template.costCredits > 0
    ) ? Math.floor(template.costCredits) : Math.max(1, Math.ceil(durationSec));

    const result = await db.runTransaction(async (tx) => {
      const userRef = db.collection("users").doc(uid);
      const userSnap = await tx.get(userRef);
      const userData = (userSnap.data() as UserDoc | undefined) || {};
      const hasCreditsBalance = (
        typeof userData.creditsBalance === "number" &&
        Number.isFinite(userData.creditsBalance)
      );
      const currentCredits = hasCreditsBalance ?
        userData.creditsBalance as number :
        INITIAL_CREDITS;

      if (currentCredits < costCredits) {
        throw new HttpsError(
          "resource-exhausted",
          "Not enough credits for this generation."
        );
      }

      tx.set(userRef, {
        creditsBalance: currentCredits - costCredits,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      const jobRef = db.collection("jobs").doc();
      const uploadPath = `user_uploads/${uid}/${jobRef.id}/photo.jpg`;

      tx.set(jobRef, {
        uid,
        templateId,
        status: "queued" as JobStatus,
        inputImagePath: uploadPath,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {jobId: jobRef.id, uploadPath};
    });

    return result;
  }
);

export const onUserDocCreated = onDocumentCreated(
  "users/{uid}",
  async (event) => {
    const userRef = event.data?.ref;
    if (!userRef) return;

    await userRef.set({
      creditsBalance: INITIAL_CREDITS,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  }
);

export const processJobTrigger001 = onDocumentUpdated(
  {document: "jobs/{jobId}", secrets: [klingAccessKey, klingSecretKey]},
  async (event) => {
    const before = (event.data?.before.data() as JobDoc | undefined) || {};
    const afterSnap = event.data?.after;
    const after = (afterSnap?.data() as JobDoc | undefined) || {};
    if (!afterSnap?.exists) return;

    const inputAdded = !before.inputImageUrl && !!after.inputImageUrl;
    if (!inputAdded || after.status !== "queued") return;

    const jobRef = afterSnap.ref;
    const lockedJob = await db.runTransaction(async (tx) => {
      const snap = await tx.get(jobRef);
      const current = (snap.data() as JobDoc | undefined) || {};
      if (current.status !== "queued" || !current.inputImageUrl) return null;
      if (pickString(current.kling?.taskId)) return null;

      tx.update(jobRef, {
        "status": "processing" as JobStatus,
        "kling.state": "submitting",
        "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        templateId: current.templateId || "",
        inputImageUrl: current.inputImageUrl,
      };
    });

    if (!lockedJob || !lockedJob.templateId || !lockedJob.inputImageUrl) {
      return;
    }

    try {
      const templateSnap = await db.doc(
        `templates/${lockedJob.templateId}`
      ).get();
      const template = (templateSnap.data() as TemplateDoc | undefined) || {};

      const submit = await submitKlingTask({
        templateId: lockedJob.templateId,
        inputImageUrl: lockedJob.inputImageUrl,
        referenceVideoUrl: template.referenceVideoUrl,
      });

      await jobRef.update({
        "status": "processing" as JobStatus,
        "kling.taskId": submit.taskId,
        "kling.state": "processing",
        "kling.error": admin.firestore.FieldValue.delete(),
        "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      const msg = errorMessage(error);
      logger.error("Kling submit failed", {
        jobId: afterSnap.id,
        message: msg,
      });

      await jobRef.update({
        "status": "failed" as JobStatus,
        "kling.state": "failed",
        "kling.error": msg,
        "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
);

export const pollKlingScheduled = onSchedule(
  {schedule: "every 2 minutes", secrets: [klingAccessKey, klingSecretKey]},
  async () => {
    const jobsSnap = await db.collection("jobs")
      .where("status", "==", "processing")
      .limit(POLL_BATCH_LIMIT)
      .get();

    if (jobsSnap.empty) return;

    for (const jobDoc of jobsSnap.docs) {
      const job = (jobDoc.data() as JobDoc | undefined) || {};
      const taskId = pickString(job.kling?.taskId);
      if (!taskId) continue;

      try {
        const result = await pollKlingTask(taskId);
        const updates: Record<string, unknown> = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (isSuccessState(result.state)) {
          if (result.outputUrl) {
            updates["status"] = "done";
            updates["kling.state"] = "succeed";
            updates["kling.outputUrl"] = result.outputUrl;
            updates["kling.error"] = admin.firestore.FieldValue.delete();
            if (result.watermarkUrl) {
              updates["kling.watermarkUrl"] = result.watermarkUrl;
            }
          } else {
            updates["status"] = "failed";
            updates["kling.state"] = "failed";
            updates["kling.error"] =
              "Kling task finished without output url.";
          }
        } else if (isFailedState(result.state)) {
          updates["status"] = "failed";
          updates["kling.state"] = "failed";
          updates["kling.error"] = (
            result.error || "Kling task failed."
          );
        } else {
          updates["kling.state"] = result.state || "processing";
          if (result.progress !== null) {
            updates["kling.progress"] = result.progress;
          }
        }

        await jobDoc.ref.update(updates);
      } catch (error) {
        logger.error("Kling poll failed", {
          jobId: jobDoc.id,
          message: errorMessage(error),
        });
      }
    }
  }
);

export const cleanupInputsHourly = onSchedule(
  {schedule: "every 60 minutes"},
  async () => {
    const cutoffMs = Date.now() - INPUT_TTL_MS;
    const bucket = admin.storage().bucket();

    const [files] = await bucket.getFiles({prefix: "user_uploads/"});
    let deletedCount = 0;

    for (const file of files) {
      let createdAtMs = parseTimeMs(file.metadata?.timeCreated);
      if (createdAtMs === null) {
        const [metadata] = await file.getMetadata();
        createdAtMs = parseTimeMs(metadata?.timeCreated);
      }
      if (createdAtMs === null || createdAtMs > cutoffMs) continue;

      try {
        await file.delete({ignoreNotFound: true});
        deletedCount += 1;
      } catch (error) {
        logger.warn("Failed to delete old upload", {
          file: file.name,
          message: errorMessage(error),
        });
      }
    }

    logger.info("cleanupInputsHourly finished", {
      scanned: files.length,
      deleted: deletedCount,
    });
  }
);
