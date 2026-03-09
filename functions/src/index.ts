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
import {randomUUID} from "crypto";
import {Readable, Transform} from "stream";
import {pipeline} from "stream/promises";
import {ReadableStream as WebReadableStream} from "stream/web";
import jwt from "jsonwebtoken";

admin.initializeApp();
const db = admin.firestore();

const klingAccessKey = defineSecret("KLING_ACCESS_KEY");
const klingSecretKey = defineSecret("KLING_SECRET_KEY");

const INITIAL_CREDITS = 20;
const INPUT_TTL_MS = 6 * 60 * 60 * 1000;
const OUTPUT_TTL_MS = 60 * 60 * 1000;
const KLING_HTTP_TIMEOUT_MS = 20_000;
const DOWNLOAD_FETCH_TIMEOUT_MS = 60_000;
const REFRESH_COOLDOWN_MS = 7_000;
const DOWNLOAD_LOCK_MS = 2 * 60 * 1000;
const MAX_DOWNLOAD_BYTES = 120 * 1024 * 1024;
const KLING_BASE_URL =
  process.env.KLING_BASE_URL || "https://api-singapore.klingai.com";

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
  kling?: {
    referenceVideoUrl?: string;
  };
}

interface KlingState {
  taskId?: string;
  requestId?: string;
  state?: string;
  outputUrl?: string;
  watermarkUrl?: string;
  error?: string;
  lastPollError?: string;
  lastStatusCheckAt?: admin.firestore.Timestamp;
}

interface DownloadState {
  storagePath?: string;
  fileName?: string;
  downloadToken?: string;
  contentType?: string;
  sizeBytes?: number;
  expiresAt?: admin.firestore.Timestamp;
  lockUntil?: admin.firestore.Timestamp;
  lastError?: string;
}

interface JobDoc {
  uid?: string;
  templateId?: string;
  status?: JobStatus;
  inputImagePath?: string;
  inputImageUrl?: string;
  kling?: KlingState;
  download?: DownloadState;
}

interface KlingSubmitInput {
  jobId: string;
  inputImageUrl: string;
  referenceVideoUrl: string;
}

interface KlingPollResult {
  state: "succeed" | "failed" | "pending";
  outputUrl?: string;
  watermarkUrl?: string;
  error?: string;
  requestId?: string;
  transientError?: boolean;
}

interface KlingCreateResponse {
  code?: number;
  message?: string;
  request_id?: string;
  data?: {
    task_id?: string;
  };
}

interface KlingStatusResponse {
  code?: number;
  message?: string;
  request_id?: string;
  data?: {
    task_status?: string;
    task_status_msg?: string;
    task_result?: {
      videos?: Array<{
        url?: string;
        watermark_url?: string;
      }>;
    };
  };
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

function errorMessage(error: unknown): string {
  if (error instanceof HttpsError) return error.message;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function trailingSlashless(url: string): string {
  return url.replace(/\/+$/, "");
}

function makeKlingJwt(accessKey: string, secretKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    iss: accessKey,
    iat: now - 5,
    nbf: now - 5,
    exp: now + 30 * 60,
  }, secretKey, {algorithm: "HS256"});
}

function parseTimeMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function timestampMs(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  if (!("toMillis" in value)) return null;
  const toMillis = (value as {toMillis: unknown}).toMillis;
  if (typeof toMillis !== "function") return null;

  const ms = toMillis.call(value);
  return Number.isFinite(ms) ? ms as number : null;
}

function isTransientStatus(statusCode: number): boolean {
  return [408, 425, 429, 500, 502, 503, 504].includes(statusCode);
}

function isTransientKlingCode(code: number): boolean {
  return code === 1200;
}

async function submitKlingTask(
  input: KlingSubmitInput
): Promise<{taskId: string; requestId?: string}> {
  const accessKey = klingAccessKey.value();
  const secretKey = klingSecretKey.value();
  if (!accessKey || !secretKey) {
    throw new Error("Kling secrets are missing");
  }

  const token = makeKlingJwt(accessKey, secretKey);
  const endpointUrl =
    `${trailingSlashless(KLING_BASE_URL)}/v1/videos/motion-control`;
  const payload = {
    video_url: input.referenceVideoUrl,
    image_url: input.inputImageUrl,
    mode: "std",
    keep_original_sound: "yes",
    character_orientation: "video",
    external_task_id: input.jobId,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, KLING_HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    let json: KlingCreateResponse = {};
    if (bodyText) {
      try {
        json = JSON.parse(bodyText) as KlingCreateResponse;
      } catch {
        json = {};
      }
    }

    const requestId = pickString(
      response.headers.get("x-request-id"),
      response.headers.get("request-id"),
      json.request_id
    ) || undefined;

    if (!response.ok) {
      throw new Error(`Kling ${response.status}: ${bodyText}`);
    }
    if (json.code && json.code !== 0) {
      throw new Error(`Kling ${json.code}: ${bodyText}`);
    }

    const taskId = pickString(json.data?.task_id);
    if (!taskId) {
      throw new Error(`No task_id in response: ${bodyText}`);
    }

    return {taskId, requestId};
  } finally {
    clearTimeout(timeout);
  }
}

async function pollKlingTask(taskId: string): Promise<KlingPollResult> {
  const accessKey = klingAccessKey.value();
  const secretKey = klingSecretKey.value();
  if (!accessKey || !secretKey) {
    throw new Error("Kling secrets are missing");
  }

  const token = makeKlingJwt(accessKey, secretKey);
  const endpointUrl =
    `${trailingSlashless(KLING_BASE_URL)}/v1/videos/motion-control/` +
    `${encodeURIComponent(taskId)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, KLING_HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(endpointUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    const bodyText = await response.text();

    let json: KlingStatusResponse = {};
    if (bodyText) {
      try {
        json = JSON.parse(bodyText) as KlingStatusResponse;
      } catch {
        json = {};
      }
    }

    const requestId = pickString(
      response.headers.get("x-request-id"),
      response.headers.get("request-id"),
      json.request_id
    ) || undefined;

    if (!response.ok) {
      const msg = `Kling status ${response.status}: ${
        bodyText || "empty body"
      }`;
      if (isTransientStatus(response.status)) {
        return {
          state: "pending",
          transientError: true,
          error: msg,
          requestId,
        };
      }
      return {
        state: "failed",
        error: msg,
        requestId,
      };
    }

    if (json.code && json.code !== 0) {
      const msg = `Kling status code ${json.code}: ${bodyText || "empty body"}`;
      if (isTransientKlingCode(json.code)) {
        return {
          state: "pending",
          transientError: true,
          error: msg,
          requestId,
        };
      }
      return {
        state: "failed",
        error: pickString(json.message, msg) || msg,
        requestId,
      };
    }

    const taskStatus = pickString(json.data?.task_status)?.toLowerCase() || "";
    if (taskStatus === "succeed") {
      const video = json.data?.task_result?.videos?.[0];
      const outputUrl = pickString(video?.url);
      if (!outputUrl) {
        return {
          state: "failed",
          error: "Kling task succeeded without output url",
          requestId,
        };
      }
      return {
        state: "succeed",
        outputUrl,
        watermarkUrl: pickString(video?.watermark_url) || undefined,
        requestId,
      };
    }

    if (taskStatus === "failed") {
      return {
        state: "failed",
        error: pickString(json.data?.task_status_msg, json.message) ||
          "Kling task failed",
        requestId,
      };
    }

    return {
      state: "pending",
      requestId,
    };
  } catch (error) {
    return {
      state: "pending",
      transientError: true,
      error: `Kling status request failed: ${errorMessage(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function klingResponsePayload(kling?: KlingState): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const taskId = pickString(kling?.taskId);
  const requestId = pickString(kling?.requestId);
  const state = pickString(kling?.state);
  const outputUrl = pickString(kling?.outputUrl);
  const watermarkUrl = pickString(kling?.watermarkUrl);
  const error = pickString(kling?.error);
  const lastPollError = pickString(kling?.lastPollError);
  const lastStatusCheckAtMs = timestampMs(kling?.lastStatusCheckAt);

  if (taskId) payload.taskId = taskId;
  if (requestId) payload.requestId = requestId;
  if (state) payload.state = state;
  if (outputUrl) payload.outputUrl = outputUrl;
  if (watermarkUrl) payload.watermarkUrl = watermarkUrl;
  if (error) payload.error = error;
  if (lastPollError) payload.lastPollError = lastPollError;
  if (lastStatusCheckAtMs !== null) {
    payload.lastStatusCheckAtMs = lastStatusCheckAtMs;
  }

  return payload;
}

function buildKlingPollUpdates(
  result: KlingPollResult
): Record<string, unknown> {
  const updates: Record<string, unknown> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (result.requestId) {
    updates["kling.requestId"] = result.requestId;
  }

  if (result.state === "succeed") {
    if (result.outputUrl) {
      updates["status"] = "done" as JobStatus;
      updates["kling.state"] = "succeed";
      updates["kling.outputUrl"] = result.outputUrl;
      updates["kling.error"] = admin.firestore.FieldValue.delete();
      updates["kling.lastPollError"] = admin.firestore.FieldValue.delete();
      if (result.watermarkUrl) {
        updates["kling.watermarkUrl"] = result.watermarkUrl;
      }
    } else {
      updates["status"] = "failed" as JobStatus;
      updates["kling.state"] = "failed";
      updates["kling.error"] = "Kling task finished without output url.";
      updates["kling.lastPollError"] = admin.firestore.FieldValue.delete();
    }
    return updates;
  }

  if (result.state === "failed") {
    updates["status"] = "failed" as JobStatus;
    updates["kling.state"] = "failed";
    updates["kling.error"] = result.error || "Kling task failed.";
    updates["kling.lastPollError"] = admin.firestore.FieldValue.delete();
    return updates;
  }

  updates["status"] = "processing" as JobStatus;
  updates["kling.state"] = "processing";
  if (result.transientError && result.error) {
    updates["kling.lastPollError"] = result.error;
  } else {
    updates["kling.lastPollError"] = admin.firestore.FieldValue.delete();
  }
  return updates;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^\w.-]/g, "_");
}

function defaultDownloadPath(uid: string, jobId: string): string {
  return `outputs/${uid}/${jobId}/result.mp4`;
}

function defaultDownloadFileName(jobId: string): string {
  return sanitizeFileName(`motrend-${jobId}.mp4`);
}

function buildFirebaseDownloadUrl(params: {
  storagePath: string;
  downloadToken: string;
}): string {
  const bucketName = admin.storage().bucket().name;
  return "https://firebasestorage.googleapis.com/v0/b/" +
    `${bucketName}/o/${encodeURIComponent(params.storagePath)}` +
    `?alt=media&token=${encodeURIComponent(params.downloadToken)}`;
}

function createDownloadToken(): string {
  return randomUUID();
}

async function fetchVideoToStorage(params: {
  sourceUrl: string;
  storagePath: string;
  fileName: string;
  downloadToken: string;
}): Promise<{
  contentType: string;
  sizeBytes: number;
  downloadToken: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, DOWNLOAD_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(params.sourceUrl, {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 404 || response.status === 410) {
        throw new HttpsError(
          "failed-precondition",
          "Source video is no longer available on Kling."
        );
      }
      throw new Error(`Source download failed: ${response.status}`);
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_DOWNLOAD_BYTES
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Video file is too large to prepare for download."
      );
    }

    const contentType = pickString(
      response.headers.get("content-type")
    ) || "video/mp4";

    const file = admin.storage().bucket().file(params.storagePath);
    const body = response.body;
    if (!body) {
      throw new Error("Source download returned empty stream.");
    }

    const writeStream = file.createWriteStream({
      resumable: false,
      metadata: {
        contentType,
        contentDisposition: `attachment; filename="${params.fileName}"`,
        metadata: {
          firebaseStorageDownloadTokens: params.downloadToken,
        },
      },
    });

    let totalBytes = 0;
    const limiter = new Transform({
      transform: (chunk, _encoding, callback) => {
        const size = Buffer.isBuffer(chunk) ? chunk.length :
          Buffer.byteLength(String(chunk));
        totalBytes += size;
        if (totalBytes > MAX_DOWNLOAD_BYTES) {
          callback(new HttpsError(
            "failed-precondition",
            "Video file is too large to prepare for download."
          ));
          return;
        }
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        Readable.fromWeb(body as unknown as WebReadableStream),
        limiter,
        writeStream
      );
    } catch (error) {
      await file.delete({ignoreNotFound: true});
      throw error;
    }

    return {
      contentType,
      sizeBytes: totalBytes,
      downloadToken: params.downloadToken,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function prepareOwnedJobDownload(params: {
  uid: string;
  jobId: string;
}): Promise<{
  downloadUrl?: string;
  expiresAtMs?: number;
  cached?: boolean;
  pending?: boolean;
  retryAfterMs?: number;
}> {
  const {uid, jobId} = params;
  const jobRef = db.collection("jobs").doc(jobId);

  const decision = await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Trend not found.");
    }
    const job = (snap.data() as JobDoc | undefined) || {};
    if (job.uid !== uid) {
      throw new HttpsError("permission-denied", "No access to this trend.");
    }

    if (job.status !== "done") {
      throw new HttpsError(
        "failed-precondition",
        "Trend is not ready yet."
      );
    }

    const outputUrl = pickString(job.kling?.outputUrl);
    if (!outputUrl) {
      throw new HttpsError(
        "failed-precondition",
        "Download source is unavailable."
      );
    }

    const nowMs = Date.now();
    const storagePath = pickString(job.download?.storagePath) ||
      defaultDownloadPath(uid, jobId);
    const fileName = pickString(job.download?.fileName) ||
      defaultDownloadFileName(jobId);
    const downloadToken = pickString(job.download?.downloadToken);
    const contentType = pickString(job.download?.contentType) || "video/mp4";
    const expiresAtMs = timestampMs(job.download?.expiresAt);

    if (
      expiresAtMs !== null &&
      expiresAtMs > nowMs &&
      job.download?.storagePath &&
      downloadToken
    ) {
      return {
        mode: "cached" as const,
        storagePath,
        fileName,
        downloadToken,
        contentType,
        expiresAtMs,
      };
    }

    const lockUntilMs = timestampMs(job.download?.lockUntil);
    if (lockUntilMs !== null && lockUntilMs > nowMs) {
      return {
        mode: "pending" as const,
        retryAfterMs: Math.max(1_000, lockUntilMs - nowMs),
      };
    }

    tx.update(jobRef, {
      "download.lockUntil": admin.firestore.Timestamp.fromMillis(
        nowMs + DOWNLOAD_LOCK_MS
      ),
      "download.lastError": admin.firestore.FieldValue.delete(),
      "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      mode: "fetch" as const,
      outputUrl,
      storagePath,
      fileName,
      downloadToken: downloadToken || createDownloadToken(),
    };
  });

  if (decision.mode === "pending") {
    return {
      pending: true,
      retryAfterMs: decision.retryAfterMs,
    };
  }

  if (decision.mode === "cached") {
    const downloadUrl = buildFirebaseDownloadUrl({
      storagePath: decision.storagePath,
      downloadToken: decision.downloadToken,
    });
    return {
      downloadUrl,
      expiresAtMs: decision.expiresAtMs,
      cached: true,
    };
  }

  try {
    const downloaded = await fetchVideoToStorage({
      sourceUrl: decision.outputUrl,
      storagePath: decision.storagePath,
      fileName: decision.fileName,
      downloadToken: decision.downloadToken,
    });

    const expiresAtMs = Date.now() + OUTPUT_TTL_MS;
    await jobRef.update({
      "download.storagePath": decision.storagePath,
      "download.fileName": decision.fileName,
      "download.downloadToken": downloaded.downloadToken,
      "download.contentType": downloaded.contentType,
      "download.sizeBytes": downloaded.sizeBytes,
      "download.expiresAt": admin.firestore.Timestamp.fromMillis(expiresAtMs),
      "download.lockUntil": admin.firestore.FieldValue.delete(),
      "download.lastError": admin.firestore.FieldValue.delete(),
      "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    });

    const downloadUrl = buildFirebaseDownloadUrl({
      storagePath: decision.storagePath,
      downloadToken: downloaded.downloadToken,
    });

    return {
      downloadUrl,
      expiresAtMs,
      cached: false,
    };
  } catch (error) {
    const msg = errorMessage(error);
    await jobRef.update({
      "download.lockUntil": admin.firestore.FieldValue.delete(),
      "download.lastError": msg,
      "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    });
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Failed to prepare download.");
  }
}

async function refreshOwnedJobStatus(
  uid: string,
  jobId: string
): Promise<{status: JobStatus; kling: Record<string, unknown>}> {
  const jobRef = db.collection("jobs").doc(jobId);

  const lockResult = await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Trend not found.");
    }
    const job = (snap.data() as JobDoc | undefined) || {};

    if (job.uid !== uid) {
      throw new HttpsError("permission-denied", "No access to this trend.");
    }

    const status = job.status || "queued";
    const taskId = pickString(job.kling?.taskId);
    const refreshable = status === "queued" || status === "processing";

    if (!refreshable || !taskId) {
      return {shouldPoll: false};
    }

    const lastStatusCheckAtMs = timestampMs(job.kling?.lastStatusCheckAt);
    if (
      lastStatusCheckAtMs !== null &&
      Date.now() - lastStatusCheckAtMs < REFRESH_COOLDOWN_MS
    ) {
      throw new HttpsError(
        "resource-exhausted",
        "Please wait a few seconds before refreshing again."
      );
    }

    tx.update(jobRef, {
      "kling.lastStatusCheckAt": admin.firestore.Timestamp.now(),
      "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    });
    return {shouldPoll: true, taskId};
  });

  if (lockResult.shouldPoll && lockResult.taskId) {
    const result = await pollKlingTask(lockResult.taskId);
    const updates = buildKlingPollUpdates(result);
    await jobRef.update(updates);
  }

  const latestSnap = await jobRef.get();
  const latestJob = (latestSnap.data() as JobDoc | undefined) || {};

  return {
    status: (latestJob.status || "queued") as JobStatus,
    kling: klingResponsePayload(latestJob.kling),
  };
}

export const createJob = onCall(
  {
    cors: corsAllowedOrigins,
    secrets: [klingAccessKey, klingSecretKey],
    memory: "512MiB",
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in first");
    }

    const uid = req.auth.uid;
    const prepareDownloadJobIdRaw = req.data?.prepareDownloadJobId;
    if (typeof prepareDownloadJobIdRaw === "string") {
      const prepareDownloadJobId = prepareDownloadJobIdRaw.trim();
      if (!prepareDownloadJobId || !/^[\w-]+$/.test(prepareDownloadJobId)) {
        throw new HttpsError("invalid-argument", "Invalid jobId");
      }
      return await prepareOwnedJobDownload({
        uid,
        jobId: prepareDownloadJobId,
      });
    }

    const refreshJobIdRaw = req.data?.refreshJobId;
    if (typeof refreshJobIdRaw === "string") {
      const refreshJobId = refreshJobIdRaw.trim();
      if (!refreshJobId || !/^[\w-]+$/.test(refreshJobId)) {
        throw new HttpsError("invalid-argument", "Invalid jobId");
      }
      return await refreshOwnedJobStatus(uid, refreshJobId);
    }

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
      const referenceVideoUrl = pickString(
        template.referenceVideoUrl,
        template.kling?.referenceVideoUrl
      );
      if (!referenceVideoUrl) {
        throw new Error("Template has no referenceVideoUrl");
      }

      const submit = await submitKlingTask({
        jobId: afterSnap.id,
        inputImageUrl: lockedJob.inputImageUrl,
        referenceVideoUrl,
      });

      const updates: Record<string, unknown> = {
        "status": "processing" as JobStatus,
        "kling.taskId": submit.taskId,
        "kling.state": "processing",
        "kling.error": admin.firestore.FieldValue.delete(),
        "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      };
      if (submit.requestId) {
        updates["kling.requestId"] = submit.requestId;
      }
      await jobRef.update({
        ...updates,
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

export const cleanupDownloadsQuarterHourly = onSchedule(
  {schedule: "every 15 minutes"},
  async () => {
    const nowTs = admin.firestore.Timestamp.now();
    const jobsSnap = await db.collection("jobs")
      .where("download.expiresAt", "<=", nowTs)
      .limit(200)
      .get();

    if (jobsSnap.empty) {
      return;
    }

    let deletedFiles = 0;
    let cleanedDocs = 0;

    for (const jobDoc of jobsSnap.docs) {
      const job = (jobDoc.data() as JobDoc | undefined) || {};
      const storagePath = pickString(job.download?.storagePath);

      if (storagePath) {
        try {
          await admin.storage().bucket().file(storagePath)
            .delete({ignoreNotFound: true});
          deletedFiles += 1;
        } catch (error) {
          logger.warn("Failed to delete cached download", {
            file: storagePath,
            message: errorMessage(error),
          });
        }
      }

      await jobDoc.ref.update({
        "download.storagePath": admin.firestore.FieldValue.delete(),
        "download.fileName": admin.firestore.FieldValue.delete(),
        "download.downloadToken": admin.firestore.FieldValue.delete(),
        "download.contentType": admin.firestore.FieldValue.delete(),
        "download.sizeBytes": admin.firestore.FieldValue.delete(),
        "download.expiresAt": admin.firestore.FieldValue.delete(),
        "download.lockUntil": admin.firestore.FieldValue.delete(),
        "download.lastError": admin.firestore.FieldValue.delete(),
        "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      });
      cleanedDocs += 1;
    }

    logger.info("cleanupDownloadsQuarterHourly finished", {
      scanned: jobsSnap.size,
      cleanedDocs,
      deletedFiles,
    });
  }
);
