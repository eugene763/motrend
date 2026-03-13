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
import {createHash, randomUUID} from "crypto";
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
const JOB_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AWAITING_UPLOAD_TTL_MS = 30 * 60 * 1000;
const LEGACY_QUEUED_WITHOUT_UPLOAD_TTL_MS = 30 * 60 * 1000;
const LEGACY_QUEUED_AUTO_REFUND_FROM_MS =
  Date.parse("2026-03-14T00:00:00+04:00");
const KLING_HTTP_TIMEOUT_MS = 20_000;
const DOWNLOAD_FETCH_TIMEOUT_MS = 60_000;
const REFRESH_COOLDOWN_MS = 7_000;
const DOWNLOAD_LOCK_MS = 2 * 60 * 1000;
const MAX_DOWNLOAD_BYTES = 120 * 1024 * 1024;
const SUPPORT_CODES_COLLECTION = "support_codes";
const CREDIT_ADJUSTMENTS_COLLECTION = "credit_adjustments";
const JOB_REQUESTS_COLLECTION = "job_requests";
const USER_PRIVATE_COLLECTION = "private";
const USER_ATTRIBUTION_DOC_ID = "attribution";
const LEGACY_QUEUE_COLLECTION = "job_queue";
const QUEUE_COLLECTIONS: Record<QueueTaskType, string> = {
  kling_submit: "job_queue_kling_submit",
  kling_poll: "job_queue_kling_poll",
  download_prepare: "job_queue_download_prepare",
};
const QUEUE_LEASE_MS = 2 * 60 * 1000;
const KLING_BASE_URL =
  process.env.KLING_BASE_URL || "https://api-singapore.klingai.com";

const corsAllowedOrigins = [
  /^https:\/\/gen-lang-client-0651837818\.(web\.app|firebaseapp\.com)$/,
  /^https:\/\/trend\.moads\.agency$/,
  /^https:\/\/www\.trend\.moads\.agency$/,
  /^https?:\/\/localhost(:\d+)?$/,
];

type JobStatus =
  | "awaiting_upload"
  | "queued"
  | "processing"
  | "done"
  | "failed";

type QueueTaskType =
  | "kling_submit"
  | "kling_poll"
  | "download_prepare";

function isQueueTaskType(value: string | null): value is QueueTaskType {
  return value === "kling_submit" ||
    value === "kling_poll" ||
    value === "download_prepare";
}

interface UserDoc {
  creditsBalance?: number;
  supportCode?: string;
  email?: string;
  country?: string;
  language?: string;
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
  submitQueuedAt?: admin.firestore.Timestamp;
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

interface RefundState {
  applied?: boolean;
  amount?: number;
  reason?: string;
  refundedAt?: admin.firestore.Timestamp;
}

interface SupportCodeDoc {
  uid?: string;
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
}

interface JobDoc {
  uid?: string;
  templateId?: string;
  status?: JobStatus;
  debitedCredits?: number;
  inputImagePath?: string;
  inputImageUrl?: string;
  referenceVideoPath?: string;
  referenceVideoUrl?: string;
  kling?: KlingState;
  download?: DownloadState;
  refund?: RefundState;
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
}

interface QueueTaskDoc {
  type?: QueueTaskType;
  jobId?: string;
  uid?: string;
  status?: "queued" | "processing" | "done" | "failed";
  leaseUntil?: admin.firestore.Timestamp;
  attempts?: number;
  lastError?: string;
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
}

interface JobRequestDoc {
  uid?: string;
  templateId?: string;
  jobId?: string;
  uploadPath?: string;
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
}

interface AttributionPayloadInput {
  capturedAtMs?: unknown;
  landingUrl?: unknown;
  referrer?: unknown;
  utm?: unknown;
  ids?: unknown;
}

interface SanitizedAttributionPayload {
  capturedAtMs: number;
  landingUrl?: string;
  referrer?: string;
  utm: Record<string, string>;
  ids: Record<string, string>;
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

function isKling500Code1200Error(message: string): boolean {
  if (!message.toLowerCase().includes("kling 500")) return false;
  return /"code"\s*:\s*1200/.test(message);
}

function templateCostCredits(template?: TemplateDoc): number {
  const durationSec = (
    typeof template?.durationSec === "number" && template.durationSec > 0
  ) ? template.durationSec : 10;
  return (
    typeof template?.costCredits === "number" && template.costCredits > 0
  ) ? Math.floor(template.costCredits) : Math.max(1, Math.ceil(durationSec));
}

function positiveFiniteInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

function baseSupportCode(uid: string): string {
  const digest = createHash("sha256")
    .update(uid)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();
  return `U-${digest}`;
}

function normalizeSupportCode(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "supportCode is required");
  }
  const code = value.trim().toUpperCase();
  if (!/^U-[A-Z0-9]{10}(?:-[A-Z0-9]{2})?$/.test(code)) {
    throw new HttpsError("invalid-argument", "Invalid supportCode format");
  }
  return code;
}

function normalizeClientRequestId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new HttpsError(
      "invalid-argument",
      "clientRequestId must be a string"
    );
  }
  const requestId = value.trim();
  if (!requestId) {
    throw new HttpsError("invalid-argument", "clientRequestId is empty");
  }
  if (requestId.length > 120) {
    throw new HttpsError("invalid-argument", "clientRequestId is too long");
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(requestId)) {
    throw new HttpsError("invalid-argument", "Invalid clientRequestId");
  }
  return requestId;
}

const ATTRIBUTION_MAX_VALUE_LENGTH = 500;
const ATTRIBUTION_MAX_URL_LENGTH = 1500;
const ATTRIBUTION_UTM_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
]);
const ATTRIBUTION_ID_KEYS = new Set([
  "fbclid",
  "fbc",
  "fbp",
  "gclid",
  "gbraid",
  "wbraid",
  "ga_client_id",
  "gcl_au",
  "yclid",
  "ysclid",
  "ym_uid",
  "ttclid",
]);

function sanitizeAttributionString(
  value: unknown,
  maxLength = ATTRIBUTION_MAX_VALUE_LENGTH
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .split("")
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function sanitizeAttributionMap(
  value: unknown,
  allowedKeys: Set<string>
): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of Object.keys(source)) {
    if (!allowedKeys.has(key)) continue;
    const sanitized = sanitizeAttributionString(source[key]);
    if (!sanitized) continue;
    out[key] = sanitized;
  }
  return out;
}

function sanitizeCapturedAtMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Date.now();
  }
  const normalized = Math.floor(value);
  const now = Date.now();
  if (normalized < 0) return now;
  if (normalized > now + 24 * 60 * 60 * 1000) return now;
  return normalized;
}

function hasKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0;
}

function sanitizeAttributionPayload(
  input: AttributionPayloadInput
): SanitizedAttributionPayload | null {
  const utm = sanitizeAttributionMap(input.utm, ATTRIBUTION_UTM_KEYS);
  const ids = sanitizeAttributionMap(input.ids, ATTRIBUTION_ID_KEYS);
  const landingUrl = sanitizeAttributionString(
    input.landingUrl,
    ATTRIBUTION_MAX_URL_LENGTH
  ) || undefined;
  const referrer = sanitizeAttributionString(
    input.referrer,
    ATTRIBUTION_MAX_URL_LENGTH
  ) || undefined;

  if (!hasKeys(utm) && !hasKeys(ids) && !landingUrl && !referrer) {
    return null;
  }

  return {
    capturedAtMs: sanitizeCapturedAtMs(input.capturedAtMs),
    landingUrl,
    referrer,
    utm,
    ids,
  };
}

function hashForLog(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function maskSupportCodeForLog(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 6) return "***";
  return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

function maskPathForLog(value: string): string {
  return `sha:${hashForLog(value)}`;
}

function parseGrantAmount(value: unknown): number {
  const asNumber = typeof value === "number" ?
    value :
    (typeof value === "string" ? Number(value.trim()) : Number.NaN);
  if (!Number.isFinite(asNumber)) {
    throw new HttpsError("invalid-argument", "amount must be a number");
  }
  const amount = Math.floor(asNumber);
  if (amount < 1 || amount > 500) {
    throw new HttpsError(
      "invalid-argument",
      "amount must be between 1 and 500"
    );
  }
  return amount;
}

function parseGrantReason(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "reason is required");
  }
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 200) {
    throw new HttpsError(
      "invalid-argument",
      "reason length must be between 3 and 200 chars"
    );
  }
  return reason;
}

function requireAuthUid(req: {auth?: {uid?: string}}): string {
  const uid = req.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in first");
  }
  return uid;
}

function requireAdminUid(req: {
  auth?: {uid?: string; token?: {[key: string]: unknown}};
}): string {
  const uid = requireAuthUid(req);
  if (req.auth?.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin access required");
  }
  return uid;
}

async function ensureSupportCodeForUid(uid: string): Promise<string> {
  const userRef = db.collection("users").doc(uid);
  return await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const userData = (userSnap.data() as UserDoc | undefined) || {};
    const existingCodeRaw = pickString(userData.supportCode);

    if (existingCodeRaw) {
      const existingCode = existingCodeRaw.toUpperCase();
      const codeRef = db.collection(SUPPORT_CODES_COLLECTION).doc(existingCode);
      const codeSnap = await tx.get(codeRef);
      const ownerUid = pickString(
        (codeSnap.data() as SupportCodeDoc | undefined)?.uid
      );

      if (!codeSnap.exists || ownerUid === uid) {
        tx.set(codeRef, {
          uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        if (existingCode !== existingCodeRaw) {
          tx.set(userRef, {
            supportCode: existingCode,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, {merge: true});
        }
        return existingCode;
      }
    }

    const baseCode = baseSupportCode(uid);
    const maxAttempts = 10;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const suffix = attempt === 0 ?
        "" :
        `-${Math.floor(Math.random() * (36 ** 2))
          .toString(36)
          .toUpperCase()
          .padStart(2, "0")}`;
      const candidate = `${baseCode}${suffix}`;
      const codeRef = db.collection(SUPPORT_CODES_COLLECTION).doc(candidate);
      const codeSnap = await tx.get(codeRef);
      const ownerUid = pickString(
        (codeSnap.data() as SupportCodeDoc | undefined)?.uid
      );
      if (!codeSnap.exists || ownerUid === uid) {
        tx.set(codeRef, {
          uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        tx.set(userRef, {
          supportCode: candidate,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        return candidate;
      }
    }

    throw new HttpsError("internal", "Failed to allocate supportCode");
  });
}

async function refundCreditsForJobKling1200(
  jobRef: admin.firestore.DocumentReference
): Promise<boolean> {
  return await db.runTransaction(async (tx) => {
    const jobSnap = await tx.get(jobRef);
    if (!jobSnap.exists) return false;

    const job = (jobSnap.data() as JobDoc | undefined) || {};
    if (job.refund?.applied === true) return false;

    const uid = pickString(job.uid);
    if (!uid) return false;

    const refundAmount = await resolveRefundAmountForJobInTransaction(tx, job);
    if (refundAmount === null) return false;

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

    tx.set(userRef, {
      creditsBalance: currentCredits + refundAmount,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});

    tx.update(jobRef, {
      "refund.applied": true,
      "refund.amount": refundAmount,
      "refund.reason": "kling_500_code_1200",
      "refund.refundedAt": admin.firestore.FieldValue.serverTimestamp(),
      "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    });

    return true;
  });
}

async function resolveRefundAmountForJobInTransaction(
  tx: admin.firestore.Transaction,
  job: JobDoc
): Promise<number | null> {
  let refundAmount = positiveFiniteInt(job.debitedCredits);
  if (refundAmount !== null) return refundAmount;

  const templateId = pickString(job.templateId);
  if (!templateId) return null;

  const templateRef = db.doc(`templates/${templateId}`);
  const templateSnap = await tx.get(templateRef);
  if (!templateSnap.exists) return null;
  const template = (templateSnap.data() as TemplateDoc | undefined) || {};
  refundAmount = templateCostCredits(template);
  return refundAmount;
}

async function storageObjectExists(storagePath: string): Promise<boolean> {
  const [exists] = await admin.storage().bucket().file(storagePath).exists();
  return exists === true;
}

function isExpectedReferenceVideoPath(
  expectedInputPath: string,
  referenceVideoPath: string
): boolean {
  const uploadDir = expectedInputPath.replace(/\/[^/]+$/, "");
  return referenceVideoPath.startsWith(`${uploadDir}/`);
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

function enqueueQueueTaskInTransaction(
  tx: admin.firestore.Transaction,
  params: {type: QueueTaskType; uid: string; jobId: string}
): string {
  const queueCollection = QUEUE_COLLECTIONS[params.type];
  const taskRef = db.collection(queueCollection).doc();
  tx.set(taskRef, {
    type: params.type,
    uid: params.uid,
    jobId: params.jobId,
    status: "queued",
    attempts: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return taskRef.id;
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
    const downloadToken = pickString(job.download?.downloadToken);
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
        downloadToken,
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
    enqueueQueueTaskInTransaction(tx, {
      type: "download_prepare",
      uid,
      jobId,
    });

    return {
      mode: "queued" as const,
      retryAfterMs: 2_000,
    };
  });

  if (decision.mode === "pending" || decision.mode === "queued") {
    return {
      pending: true,
      retryAfterMs: decision.retryAfterMs || 2_000,
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

  return {
    pending: true,
    retryAfterMs: 2_000,
  };
}

async function refreshOwnedJobStatus(
  uid: string,
  jobId: string
): Promise<{
  status: JobStatus;
  kling: Record<string, unknown>;
  queuedForRefresh: boolean;
  retryAfterMs?: number;
}> {
  const jobRef = db.collection("jobs").doc(jobId);

  const refreshDecision = await db.runTransaction(async (tx) => {
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
      return {
        queuedForRefresh: false,
      };
    }

    const nowMs = Date.now();
    const lastStatusCheckAtMs = timestampMs(job.kling?.lastStatusCheckAt);
    if (
      lastStatusCheckAtMs !== null &&
      nowMs - lastStatusCheckAtMs < REFRESH_COOLDOWN_MS
    ) {
      return {
        queuedForRefresh: true,
        retryAfterMs: Math.max(
          1_000,
          REFRESH_COOLDOWN_MS - (nowMs - lastStatusCheckAtMs)
        ),
      };
    }

    tx.update(jobRef, {
      "kling.lastStatusCheckAt": admin.firestore.Timestamp.now(),
      "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    });
    enqueueQueueTaskInTransaction(tx, {
      type: "kling_poll",
      uid,
      jobId,
    });

    return {
      queuedForRefresh: true,
      retryAfterMs: 2_000,
    };
  });

  const latestSnap = await jobRef.get();
  const latestJob = (latestSnap.data() as JobDoc | undefined) || {};

  return {
    status: (latestJob.status || "queued") as JobStatus,
    kling: klingResponsePayload(latestJob.kling),
    queuedForRefresh: refreshDecision.queuedForRefresh === true,
    retryAfterMs: typeof refreshDecision.retryAfterMs === "number" ?
      refreshDecision.retryAfterMs :
      undefined,
  };
}

async function finalizePreparedJob(params: {
  uid: string;
  jobId: string;
  inputImagePath: string;
  inputImageUrl: string;
  referenceVideoPath: string | null;
  referenceVideoUrl: string | null;
}): Promise<Record<string, unknown>> {
  const {
    uid,
    jobId,
    inputImagePath,
    inputImageUrl,
    referenceVideoPath,
    referenceVideoUrl,
  } = params;
  const jobRef = db.collection("jobs").doc(jobId);

  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    throw new HttpsError("not-found", "Trend not found.");
  }
  const job = (jobSnap.data() as JobDoc | undefined) || {};
  if (pickString(job.uid) !== uid) {
    throw new HttpsError("permission-denied", "No access to this trend.");
  }

  const expectedInputPath = pickString(job.inputImagePath);
  if (!expectedInputPath || expectedInputPath !== inputImagePath) {
    throw new HttpsError("invalid-argument", "Invalid inputImagePath.");
  }
  if (
    referenceVideoPath &&
    !isExpectedReferenceVideoPath(expectedInputPath, referenceVideoPath)
  ) {
    throw new HttpsError("invalid-argument", "Invalid referenceVideoPath.");
  }

  if (!(await storageObjectExists(inputImagePath))) {
    throw new HttpsError(
      "failed-precondition",
      "Uploaded photo was not found."
    );
  }
  if (referenceVideoPath && !(await storageObjectExists(referenceVideoPath))) {
    throw new HttpsError(
      "failed-precondition",
      "Uploaded reference video was not found."
    );
  }

  return await db.runTransaction(async (tx) => {
    const currentSnap = await tx.get(jobRef);
    if (!currentSnap.exists) {
      throw new HttpsError("not-found", "Trend not found.");
    }
    const current = (currentSnap.data() as JobDoc | undefined) || {};
    if (pickString(current.uid) !== uid) {
      throw new HttpsError("permission-denied", "No access to this trend.");
    }

    if (current.status && current.status !== "awaiting_upload") {
      if (
        pickString(current.inputImageUrl) &&
        positiveFiniteInt(current.debitedCredits) !== null
      ) {
        return {
          jobId,
          "status": current.status,
          "finalized": true,
        };
      }
      throw new HttpsError(
        "failed-precondition",
        "Trend cannot be finalized in its current state."
      );
    }

    const templateId = pickString(current.templateId);
    if (!templateId) {
      throw new HttpsError("failed-precondition", "Trend template is missing.");
    }
    const templateRef = db.doc(`templates/${templateId}`);
    const templateSnap = await tx.get(templateRef);
    const template = (templateSnap.data() as TemplateDoc | undefined) || {};
    if (!templateSnap.exists || template.isActive !== true) {
      throw new HttpsError("failed-precondition", "Template is not active");
    }

    const effectiveReferenceVideoUrl = pickString(
      referenceVideoUrl,
      template.referenceVideoUrl,
      template.kling?.referenceVideoUrl
    );
    if (!effectiveReferenceVideoUrl) {
      throw new HttpsError(
        "failed-precondition",
        "Reference video is not available for this trend."
      );
    }

    const costCredits = templateCostCredits(template);
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

    const updates: Record<string, unknown> = {
      "status": "queued" as JobStatus,
      "debitedCredits": costCredits,
      inputImagePath,
      inputImageUrl,
      "kling.state": "queued",
      "kling.submitQueuedAt": admin.firestore.FieldValue.serverTimestamp(),
      "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    };
    if (referenceVideoPath && referenceVideoUrl) {
      updates.referenceVideoPath = referenceVideoPath;
      updates.referenceVideoUrl = referenceVideoUrl;
    }
    tx.update(jobRef, updates);
    enqueueQueueTaskInTransaction(tx, {
      type: "kling_submit",
      uid,
      jobId,
    });

    return {
      jobId,
      status: "queued" as JobStatus,
      finalized: true,
    };
  });
}

async function findUserBySupportCodeForAdmin(
  adminUid: string,
  supportCodeInput: unknown
): Promise<Record<string, unknown>> {
  const supportCode = normalizeSupportCode(supportCodeInput);

  const codeSnap = await db.collection(SUPPORT_CODES_COLLECTION)
    .doc(supportCode)
    .get();
  const targetUid = pickString(
    (codeSnap.data() as SupportCodeDoc | undefined)?.uid
  );
  if (!targetUid) {
    throw new HttpsError("not-found", "Support ID not found.");
  }

  const userRef = db.collection("users").doc(targetUid);
  const userSnap = await userRef.get();
  const userData = (userSnap.data() as UserDoc | undefined) || {};
  const creditsBalance = (
    typeof userData.creditsBalance === "number" &&
    Number.isFinite(userData.creditsBalance)
  ) ? userData.creditsBalance : 0;

  const jobsSnap = await db.collection("jobs")
    .where("uid", "==", targetUid)
    .orderBy("createdAt", "desc")
    .limit(5)
    .get();

  logger.info("Admin support lookup", {
    adminHash: hashForLog(adminUid),
    targetUserHash: hashForLog(targetUid),
    supportCodeMasked: maskSupportCodeForLog(supportCode),
    jobsFound: jobsSnap.size,
  });

  return {
    uid: targetUid,
    supportCode,
    user: {
      email: pickString(userData.email) || null,
      country: pickString(userData.country) || null,
      language: pickString(userData.language) || null,
      creditsBalance,
    },
    recentJobs: jobsSnap.docs.map((jobSnap) => {
      const job = (jobSnap.data() as JobDoc | undefined) || {};
      return {
        id: jobSnap.id,
        status: pickString(job.status) || "queued",
        templateId: pickString(job.templateId) || null,
        createdAtMs: timestampMs(job.createdAt),
        updatedAtMs: timestampMs(job.updatedAt),
        klingState: pickString(job.kling?.state) || null,
        klingError: pickString(job.kling?.error) || null,
      };
    }),
  };
}

async function grantCreditsForAdmin(params: {
  adminUid: string;
  targetUidInput: unknown;
  amountInput: unknown;
  reasonInput: unknown;
}): Promise<Record<string, unknown>> {
  const targetUidRaw = params.targetUidInput;
  if (typeof targetUidRaw !== "string" || !targetUidRaw.trim()) {
    throw new HttpsError("invalid-argument", "uid is required");
  }
  const targetUid = targetUidRaw.trim();
  const amount = parseGrantAmount(params.amountInput);
  const reason = parseGrantReason(params.reasonInput);

  const supportCode = await ensureSupportCodeForUid(targetUid);
  const adjustmentRef = db.collection(CREDIT_ADJUSTMENTS_COLLECTION).doc();
  const userRef = db.collection("users").doc(targetUid);

  let newBalance = 0;
  let previousBalance = 0;

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "User not found.");
    }
    const userData = (userSnap.data() as UserDoc | undefined) || {};
    const hasCreditsBalance = (
      typeof userData.creditsBalance === "number" &&
      Number.isFinite(userData.creditsBalance)
    );
    previousBalance = hasCreditsBalance ?
      userData.creditsBalance as number :
      INITIAL_CREDITS;
    newBalance = previousBalance + amount;

    tx.set(userRef, {
      creditsBalance: newBalance,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});

    tx.set(adjustmentRef, {
      uid: targetUid,
      supportCode,
      amount,
      reason,
      type: "manual_grant",
      adminUid: params.adminUid,
      balanceBefore: previousBalance,
      balanceAfter: newBalance,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  logger.warn("Credits granted by admin", {
    adminHash: hashForLog(params.adminUid),
    targetUserHash: hashForLog(targetUid),
    supportCodeMasked: maskSupportCodeForLog(supportCode),
    amount,
    previousBalance,
    newBalance,
    adjustmentId: adjustmentRef.id,
  });

  return {
    uid: targetUid,
    supportCode,
    amount,
    newBalance,
    adjustmentId: adjustmentRef.id,
  };
}

function readStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(source)) {
    const normalized = sanitizeAttributionString(raw);
    if (!normalized) continue;
    out[key] = normalized;
  }
  return out;
}

function buildAttributionTouchPayload(
  payload: SanitizedAttributionPayload
): Record<string, unknown> {
  const touch: Record<string, unknown> = {
    capturedAtMs: payload.capturedAtMs,
  };
  if (payload.landingUrl) touch.landingUrl = payload.landingUrl;
  if (payload.referrer) touch.referrer = payload.referrer;
  if (hasKeys(payload.utm)) touch.utm = payload.utm;
  if (hasKeys(payload.ids)) touch.ids = payload.ids;
  return touch;
}

async function upsertAttributionForUser(
  uid: string,
  input: AttributionPayloadInput
): Promise<Record<string, unknown>> {
  const sanitized = sanitizeAttributionPayload(input);
  if (!sanitized) {
    return {
      stored: false,
      reason: "empty",
    };
  }

  const attributionRef = db.collection("users")
    .doc(uid)
    .collection(USER_PRIVATE_COLLECTION)
    .doc(USER_ATTRIBUTION_DOC_ID);
  const touch = buildAttributionTouchPayload(sanitized);
  let firstTouchSet = false;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(attributionRef);
    const existing = snap.exists ?
      (snap.data() as Record<string, unknown> | undefined) || {} :
      {};
    const existingUtm = readStringMap(existing.utm);
    const existingIds = readStringMap(existing.ids);
    const mergedUtm = {...existingUtm, ...sanitized.utm};
    const mergedIds = {...existingIds, ...sanitized.ids};
    const existingFirstTouch = (
      existing.firstTouch &&
      typeof existing.firstTouch === "object"
    ) ? existing.firstTouch : null;

    const updates: Record<string, unknown> = {
      schemaVersion: 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAtMs: sanitized.capturedAtMs,
      lastTouch: touch,
    };
    if (hasKeys(mergedUtm)) {
      updates.utm = mergedUtm;
    }
    if (hasKeys(mergedIds)) {
      updates.ids = mergedIds;
    }
    if (!snap.exists) {
      updates.createdAt = admin.firestore.FieldValue.serverTimestamp();
    }
    if (!existingFirstTouch) {
      updates.firstTouch = touch;
      updates.firstSeenAtMs = sanitized.capturedAtMs;
      firstTouchSet = true;
    }

    tx.set(attributionRef, updates, {merge: true});
  });

  logger.info("Attribution upserted", {
    userHash: hashForLog(uid),
    utmKeys: Object.keys(sanitized.utm),
    idKeys: Object.keys(sanitized.ids),
    hasLandingUrl: !!sanitized.landingUrl,
    hasReferrer: !!sanitized.referrer,
  });

  return {
    stored: true,
    firstTouchSet,
  };
}

export const createJob = onCall(
  {
    cors: corsAllowedOrigins,
    secrets: [klingAccessKey, klingSecretKey],
    memory: "512MiB",
    minInstances: 0,
    maxInstances: 120,
    concurrency: 80,
  },
  async (req) => {
    const uid = requireAuthUid(req);

    if (req.data?.supportProfile === true) {
      const supportCode = await ensureSupportCodeForUid(uid);
      const isAdmin = req.auth?.token?.admin === true;
      return {
        uid,
        supportCode,
        isAdmin,
      };
    }

    if (typeof req.data?.findSupportCode === "string") {
      const adminUid = requireAdminUid(req);
      return await findUserBySupportCodeForAdmin(
        adminUid,
        req.data?.findSupportCode
      );
    }

    if (req.data?.grantCredits === true) {
      const adminUid = requireAdminUid(req);
      return await grantCreditsForAdmin({
        adminUid,
        targetUidInput: req.data?.uid,
        amountInput: req.data?.amount,
        reasonInput: req.data?.reason,
      });
    }

    const upsertAttributionInput = req.data?.upsertAttribution;
    if (upsertAttributionInput && typeof upsertAttributionInput === "object") {
      return await upsertAttributionForUser(
        uid,
        upsertAttributionInput as AttributionPayloadInput
      );
    }

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

    const finalizeJobIdRaw = req.data?.finalizeJobId;
    if (typeof finalizeJobIdRaw === "string") {
      const finalizeJobId = finalizeJobIdRaw.trim();
      if (!finalizeJobId || !/^[\w-]+$/.test(finalizeJobId)) {
        throw new HttpsError("invalid-argument", "Invalid jobId");
      }

      const inputImagePath = pickString(req.data?.inputImagePath);
      const inputImageUrl = pickString(req.data?.inputImageUrl);
      if (!inputImagePath || !inputImageUrl) {
        throw new HttpsError(
          "invalid-argument",
          "inputImagePath and inputImageUrl are required"
        );
      }

      return await finalizePreparedJob({
        uid,
        jobId: finalizeJobId,
        inputImagePath,
        inputImageUrl,
        referenceVideoPath: pickString(req.data?.referenceVideoPath),
        referenceVideoUrl: pickString(req.data?.referenceVideoUrl),
      });
    }

    const templateId = req.data?.templateId;
    if (!templateId || typeof templateId !== "string") {
      throw new HttpsError("invalid-argument", "templateId is required");
    }
    if (!/^[\w-]+$/.test(templateId)) {
      throw new HttpsError("invalid-argument", "Invalid templateId");
    }
    const clientRequestId = normalizeClientRequestId(req.data?.clientRequestId);

    const templateSnap = await db.doc(`templates/${templateId}`).get();
    const template = (templateSnap.data() as TemplateDoc | undefined) || {};
    if (!templateSnap.exists || template.isActive !== true) {
      throw new HttpsError("failed-precondition", "Template is not active");
    }

    const requestRef = clientRequestId ?
      db.collection(JOB_REQUESTS_COLLECTION)
        .doc(`${uid}_${clientRequestId}`) :
      null;

    const result = await db.runTransaction(async (tx) => {
      if (requestRef) {
        const requestSnap = await tx.get(requestRef);
        if (requestSnap.exists) {
          const requestData =
            (requestSnap.data() as JobRequestDoc | undefined) || {};
          const existingTemplateId = pickString(requestData.templateId);
          const existingJobId = pickString(requestData.jobId);
          const existingUploadPath = pickString(requestData.uploadPath);

          if (existingTemplateId && existingTemplateId !== templateId) {
            throw new HttpsError(
              "failed-precondition",
              "clientRequestId already used for a different template."
            );
          }
          if (existingJobId && existingUploadPath) {
            return {
              jobId: existingJobId,
              uploadPath: existingUploadPath,
              reused: true,
            };
          }
        }
      }

      const jobRef = db.collection("jobs").doc();
      const uploadPath = `user_uploads/${uid}/${jobRef.id}/photo.jpg`;

      tx.set(jobRef, {
        uid,
        templateId,
        status: "awaiting_upload" as JobStatus,
        inputImagePath: uploadPath,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (requestRef) {
        tx.set(requestRef, {
          uid,
          templateId,
          jobId: jobRef.id,
          uploadPath,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
      }

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
    const uid = event.params.uid || userRef.id;

    await ensureSupportCodeForUid(uid);

    const existingData = (event.data?.data() as UserDoc | undefined) || {};
    const existingCredits = existingData.creditsBalance;
    const hasCredits = typeof existingCredits === "number" &&
      Number.isFinite(existingCredits);
    if (hasCredits) {
      return;
    }

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
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(jobRef);
      const current = (snap.data() as JobDoc | undefined) || {};
      if (current.status !== "queued" || !current.inputImageUrl) return;
      if (pickString(current.kling?.taskId)) return;
      if (timestampMs(current.kling?.submitQueuedAt) !== null) return;

      tx.update(jobRef, {
        "status": "processing" as JobStatus,
        "kling.state": "submitting",
        "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      });
      enqueueQueueTaskInTransaction(tx, {
        type: "kling_submit",
        uid: pickString(current.uid) || "",
        jobId: afterSnap.id,
      });
    });
  }
);

async function processKlingSubmitTask(jobId: string): Promise<void> {
  const jobRef = db.collection("jobs").doc(jobId);
  const snap = await jobRef.get();
  if (!snap.exists) return;

  const job = (snap.data() as JobDoc | undefined) || {};
  const templateId = pickString(job.templateId);
  const inputImageUrl = pickString(job.inputImageUrl);
  if (!templateId || !inputImageUrl) return;
  if (pickString(job.kling?.taskId)) return;
  if (job.status !== "processing" && job.status !== "queued") return;

  try {
    const templateSnap = await db.doc(`templates/${templateId}`).get();
    const template = (templateSnap.data() as TemplateDoc | undefined) || {};
    const templateReferenceVideoUrl = pickString(
      template.referenceVideoUrl,
      template.kling?.referenceVideoUrl
    );
    const referenceVideoUrl = pickString(
      job.referenceVideoUrl,
      templateReferenceVideoUrl
    );
    if (!referenceVideoUrl) {
      throw new Error("No referenceVideoUrl provided.");
    }

    const submit = await submitKlingTask({
      jobId,
      inputImageUrl,
      referenceVideoUrl,
    });

    const updates: Record<string, unknown> = {
      "status": "processing" as JobStatus,
      "kling.taskId": submit.taskId,
      "kling.state": "processing",
      "kling.submitQueuedAt": admin.firestore.FieldValue.delete(),
      "kling.error": admin.firestore.FieldValue.delete(),
      "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    };
    if (submit.requestId) {
      updates["kling.requestId"] = submit.requestId;
    }
    await jobRef.update(updates);
  } catch (error) {
    const msg = errorMessage(error);
    logger.error("Kling submit failed", {jobId, message: msg});

    if (isKling500Code1200Error(msg)) {
      try {
        const refunded = await refundCreditsForJobKling1200(jobRef);
        logger.warn("Credits refunded after Kling 500 code 1200", {
          jobId,
          refunded,
        });
      } catch (refundError) {
        logger.error("Credit refund failed", {
          jobId,
          message: errorMessage(refundError),
        });
      }
    }

    await jobRef.update({
      "status": "failed" as JobStatus,
      "kling.state": "failed",
      "kling.submitQueuedAt": admin.firestore.FieldValue.delete(),
      "kling.error": msg,
      "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    });
    throw error;
  }
}

async function processKlingPollTask(jobId: string): Promise<void> {
  const jobRef = db.collection("jobs").doc(jobId);
  const snap = await jobRef.get();
  if (!snap.exists) return;

  const job = (snap.data() as JobDoc | undefined) || {};
  const status = job.status || "queued";
  const taskId = pickString(job.kling?.taskId);
  const refreshable = status === "queued" || status === "processing";
  if (!refreshable || !taskId) return;

  const result = await pollKlingTask(taskId);
  const updates = buildKlingPollUpdates(result);
  await jobRef.update(updates);
}

async function processDownloadPrepareTask(jobId: string): Promise<void> {
  const jobRef = db.collection("jobs").doc(jobId);
  const snap = await jobRef.get();
  if (!snap.exists) return;

  const job = (snap.data() as JobDoc | undefined) || {};
  const uid = pickString(job.uid);
  if (!uid) return;
  if (job.status !== "done") return;

  const outputUrl = pickString(job.kling?.outputUrl);
  if (!outputUrl) {
    await jobRef.update({
      "download.lockUntil": admin.firestore.FieldValue.delete(),
      "download.lastError": "Download source is unavailable.",
      "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    });
    return;
  }

  const nowMs = Date.now();
  const expiresAtMs = timestampMs(job.download?.expiresAt);
  if (expiresAtMs !== null && expiresAtMs > nowMs) {
    await jobRef.update({
      "download.lockUntil": admin.firestore.FieldValue.delete(),
      "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    });
    return;
  }

  const storagePath = pickString(job.download?.storagePath) ||
    defaultDownloadPath(uid, jobId);
  const fileName = pickString(job.download?.fileName) ||
    defaultDownloadFileName(jobId);
  const downloadToken = pickString(job.download?.downloadToken) ||
    createDownloadToken();

  try {
    const downloaded = await fetchVideoToStorage({
      sourceUrl: outputUrl,
      storagePath,
      fileName,
      downloadToken,
    });

    const nextExpiresAtMs = Date.now() + OUTPUT_TTL_MS;
    await jobRef.update({
      "download.storagePath": storagePath,
      "download.fileName": fileName,
      "download.downloadToken": downloaded.downloadToken,
      "download.contentType": downloaded.contentType,
      "download.sizeBytes": downloaded.sizeBytes,
      "download.expiresAt": admin.firestore.Timestamp.fromMillis(
        nextExpiresAtMs
      ),
      "download.lockUntil": admin.firestore.FieldValue.delete(),
      "download.lastError": admin.firestore.FieldValue.delete(),
      "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    const msg = errorMessage(error);
    await jobRef.update({
      "download.lockUntil": admin.firestore.FieldValue.delete(),
      "download.lastError": msg,
      "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    });
    throw error;
  }
}

async function runQueueTaskByType(
  type: QueueTaskType,
  jobId: string
): Promise<void> {
  if (type === "kling_submit") {
    await processKlingSubmitTask(jobId);
    return;
  }
  if (type === "kling_poll") {
    await processKlingPollTask(jobId);
    return;
  }
  await processDownloadPrepareTask(jobId);
}

async function processQueueTaskRef(
  taskRef: admin.firestore.DocumentReference,
  expectedType: QueueTaskType | null
): Promise<void> {
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) return null;
    const task = (snap.data() as QueueTaskDoc | undefined) || {};
    if (task.status !== "queued") return null;

    const rawTypeValue = pickString(task.type);
    const rawType = isQueueTaskType(rawTypeValue) ? rawTypeValue : null;
    const type = expectedType || rawType;
    const jobId = pickString(task.jobId);
    if ((rawTypeValue && !rawType) || !type || !jobId) {
      tx.update(taskRef, {
        status: "failed",
        lastError: "Invalid queue task payload.",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return null;
    }

    if (rawType && expectedType && rawType !== expectedType) {
      tx.update(taskRef, {
        status: "failed",
        lastError: "Queue task type mismatch.",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return null;
    }

    tx.update(taskRef, {
      status: "processing",
      leaseUntil: admin.firestore.Timestamp.fromMillis(
        Date.now() + QUEUE_LEASE_MS
      ),
      attempts: admin.firestore.FieldValue.increment(1),
      lastError: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {type, jobId};
  });

  if (!claimed) return;

  try {
    await runQueueTaskByType(claimed.type, claimed.jobId);
    await taskRef.update({
      status: "done",
      leaseUntil: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    await taskRef.update({
      status: "failed",
      leaseUntil: admin.firestore.FieldValue.delete(),
      lastError: errorMessage(error),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

export const processKlingSubmitQueueTask = onDocumentCreated(
  {
    document: `${QUEUE_COLLECTIONS.kling_submit}/{taskId}`,
    secrets: [klingAccessKey, klingSecretKey],
    memory: "512MiB",
    maxInstances: 6,
    concurrency: 4,
  },
  async (event) => {
    const taskRef = event.data?.ref;
    if (!taskRef) return;
    await processQueueTaskRef(taskRef, "kling_submit");
  }
);

export const processKlingPollQueueTask = onDocumentCreated(
  {
    document: `${QUEUE_COLLECTIONS.kling_poll}/{taskId}`,
    secrets: [klingAccessKey, klingSecretKey],
    memory: "512MiB",
    maxInstances: 20,
    concurrency: 10,
  },
  async (event) => {
    const taskRef = event.data?.ref;
    if (!taskRef) return;
    await processQueueTaskRef(taskRef, "kling_poll");
  }
);

export const processDownloadPrepareQueueTask = onDocumentCreated(
  {
    document: `${QUEUE_COLLECTIONS.download_prepare}/{taskId}`,
    secrets: [klingAccessKey, klingSecretKey],
    memory: "512MiB",
    maxInstances: 4,
    concurrency: 2,
  },
  async (event) => {
    const taskRef = event.data?.ref;
    if (!taskRef) return;
    await processQueueTaskRef(taskRef, "download_prepare");
  }
);

export const processQueueTaskLegacy = onDocumentCreated(
  {
    document: `${LEGACY_QUEUE_COLLECTION}/{taskId}`,
    secrets: [klingAccessKey, klingSecretKey],
    memory: "512MiB",
    maxInstances: 1,
    concurrency: 1,
  },
  async (event) => {
    const taskRef = event.data?.ref;
    if (!taskRef) return;
    await processQueueTaskRef(taskRef, null);
  }
);

export const cleanupInputsHourly = onSchedule(
  {schedule: "every 24 hours"},
  async () => {
    logger.info(
      "cleanupInputsHourly skipped: managed by bucket lifecycle policy",
      {
        targetPrefix: "user_uploads/",
        previousTtlMs: INPUT_TTL_MS,
      }
    );
  }
);

export const cleanupStaleJobsQuarterHourly = onSchedule(
  {schedule: "every 15 minutes"},
  async () => {
    const nowMs = Date.now();
    const awaitingUploadCutoffMs = nowMs - AWAITING_UPLOAD_TTL_MS;
    const legacyQueuedCutoffMs = nowMs - LEGACY_QUEUED_WITHOUT_UPLOAD_TTL_MS;
    const scanCutoffTs = admin.firestore.Timestamp.fromMillis(
      Math.min(awaitingUploadCutoffMs, legacyQueuedCutoffMs)
    );

    let scanned = 0;
    let awaitingUploadFailed = 0;
    let legacyQueuedFailed = 0;
    let legacyQueuedRefunded = 0;
    let lastDoc:
      | admin.firestore.QueryDocumentSnapshot
      | null = null;

    let hasMore = true;
    while (hasMore) {
      let jobsQuery = db.collection("jobs")
        .where("createdAt", "<=", scanCutoffTs)
        .orderBy("createdAt", "asc")
        .limit(200);
      if (lastDoc) {
        jobsQuery = jobsQuery.startAfter(lastDoc);
      }

      const jobsSnap = await jobsQuery.get();
      if (jobsSnap.empty) {
        hasMore = false;
        continue;
      }

      scanned += jobsSnap.size;

      for (const jobDoc of jobsSnap.docs) {
        const job = (jobDoc.data() as JobDoc | undefined) || {};
        const createdAtMs = timestampMs(job.createdAt);
        if (createdAtMs === null) continue;

        const hasInputImage = !!pickString(job.inputImageUrl);
        const status = pickString(job.status) || "";

        if (
          status === "awaiting_upload" &&
          !hasInputImage &&
          createdAtMs <= awaitingUploadCutoffMs
        ) {
          const markedFailed = await db.runTransaction(async (tx) => {
            const snap = await tx.get(jobDoc.ref);
            if (!snap.exists) return false;
            const current = (snap.data() as JobDoc | undefined) || {};
            if (current.status !== "awaiting_upload") return false;
            if (pickString(current.inputImageUrl)) return false;

            tx.update(jobDoc.ref, {
              "status": "failed" as JobStatus,
              "kling.state": "failed",
              "kling.error": "Upload timed out before finalize.",
              "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
            });
            return true;
          });
          if (markedFailed) awaitingUploadFailed += 1;
          continue;
        }

        if (
          status === "queued" &&
          !hasInputImage &&
          createdAtMs <= legacyQueuedCutoffMs
        ) {
          const canAutoRefund =
            createdAtMs >= LEGACY_QUEUED_AUTO_REFUND_FROM_MS;
          const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(jobDoc.ref);
            if (!snap.exists) {
              return {failed: false, refunded: false};
            }
            const current = (snap.data() as JobDoc | undefined) || {};
            if (
              current.status !== "queued" ||
              pickString(current.inputImageUrl)
            ) {
              return {failed: false, refunded: false};
            }

            let refunded = false;
            if (canAutoRefund && current.refund?.applied !== true) {
              const uid = pickString(current.uid);
              const refundAmount = await resolveRefundAmountForJobInTransaction(
                tx,
                current
              );
              if (uid && refundAmount !== null) {
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

                tx.set(userRef, {
                  creditsBalance: currentCredits + refundAmount,
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, {merge: true});

                tx.update(jobDoc.ref, {
                  "refund.applied": true,
                  "refund.amount": refundAmount,
                  "refund.reason": "legacy_upload_timeout",
                  "refund.refundedAt":
                    admin.firestore.FieldValue.serverTimestamp(),
                });
                refunded = true;
              }
            }

            tx.update(jobDoc.ref, {
              "status": "failed" as JobStatus,
              "kling.state": "failed",
              "kling.error": "Upload timed out before finalize.",
              "updatedAt": admin.firestore.FieldValue.serverTimestamp(),
            });
            return {failed: true, refunded};
          });

          if (result.failed) {
            legacyQueuedFailed += 1;
            if (result.refunded) {
              legacyQueuedRefunded += 1;
            }
          }
        }
      }

      lastDoc = jobsSnap.docs[jobsSnap.docs.length - 1];
      if (jobsSnap.size < 200) {
        hasMore = false;
      }
    }

    logger.info("cleanupStaleJobsQuarterHourly finished", {
      scanned,
      awaitingUploadFailed,
      legacyQueuedFailed,
      legacyQueuedRefunded,
    });
  }
);

export const cleanupDownloadsQuarterHourly = onSchedule(
  {schedule: "every 15 minutes"},
  async () => {
    const nowTs = admin.firestore.Timestamp.now();

    let deletedFiles = 0;
    let cleanedDocs = 0;
    let scannedDocs = 0;
    let lastDoc:
      | admin.firestore.QueryDocumentSnapshot
      | null = null;

    let hasMore = true;
    while (hasMore) {
      let jobsQuery = db.collection("jobs")
        .where("download.expiresAt", "<=", nowTs)
        .orderBy("download.expiresAt", "asc")
        .limit(200);
      if (lastDoc) {
        jobsQuery = jobsQuery.startAfter(lastDoc);
      }

      const jobsSnap = await jobsQuery.get();
      if (jobsSnap.empty) {
        hasMore = false;
        continue;
      }

      scannedDocs += jobsSnap.size;
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
              fileHash: maskPathForLog(storagePath),
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

      lastDoc = jobsSnap.docs[jobsSnap.docs.length - 1];
      if (jobsSnap.size < 200) {
        hasMore = false;
      }
    }

    logger.info("cleanupDownloadsQuarterHourly finished", {
      scanned: scannedDocs,
      cleanedDocs,
      deletedFiles,
    });
  }
);

export const cleanupJobRequestsDaily = onSchedule(
  {schedule: "every 24 hours"},
  async () => {
    const cutoffTs = admin.firestore.Timestamp.fromMillis(
      Date.now() - JOB_REQUEST_TTL_MS
    );
    let deleted = 0;
    let scanned = 0;
    let lastDoc:
      | admin.firestore.QueryDocumentSnapshot
      | null = null;

    let hasMore = true;
    while (hasMore) {
      let queryRef = db.collection(JOB_REQUESTS_COLLECTION)
        .where("createdAt", "<=", cutoffTs)
        .orderBy("createdAt", "asc")
        .limit(300);
      if (lastDoc) {
        queryRef = queryRef.startAfter(lastDoc);
      }

      const snap = await queryRef.get();
      if (snap.empty) {
        hasMore = false;
        continue;
      }
      scanned += snap.size;

      const batch = db.batch();
      for (const docSnap of snap.docs) {
        batch.delete(docSnap.ref);
        deleted += 1;
      }
      await batch.commit();

      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.size < 300) {
        hasMore = false;
      }
    }

    logger.info("cleanupJobRequestsDaily finished", {
      scanned,
      deleted,
    });
  }
);
