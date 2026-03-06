import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
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
  watermarkUrl?: string;
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

const TICKET_TTL_MS = 3 * 60 * 1000; // 3 minutes

interface DownloadTicketDoc {
  jobId: string;
  uid: string;
  expiresAt: FirebaseFirestore.Timestamp;
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

// TEMPORARILY DISABLED
// export const getDownloadTicket = onCall(
//   {cors: corsAllowedOrigins},
//   async (req) => {
void onCall(
  {cors: corsAllowedOrigins},
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in first");
    }
    const uid = req.auth.uid;
    const jobId = req.data?.jobId;
    if (!jobId || typeof jobId !== "string") {
      throw new HttpsError("invalid-argument", "jobId is required");
    }
    if (!/^[\w-]+$/.test(jobId)) {
      throw new HttpsError("invalid-argument", "Invalid jobId");
    }

    const jobSnap = await db.doc(`jobs/${jobId}`).get();
    const jobData = jobSnap.data() as JobDoc | undefined;
    if (!jobSnap.exists || !jobData) {
      throw new HttpsError("not-found", "Job not found");
    }
    if (jobData.uid !== uid) {
      throw new HttpsError("permission-denied", "Not your job");
    }
    if (jobData.status !== "done") {
      throw new HttpsError("failed-precondition", "Job is not done yet");
    }
    const outputUrl = jobData.kling?.outputUrl;
    if (!outputUrl || typeof outputUrl !== "string") {
      throw new HttpsError("failed-precondition", "No output URL for this job");
    }

    const expiresAt = admin.firestore.Timestamp.fromMillis(
      Date.now() + TICKET_TTL_MS
    );
    const ticketRef = db.collection("downloadTickets").doc();
    await ticketRef.set({
      jobId,
      uid,
      expiresAt,
    } as DownloadTicketDoc);

    return {ticketId: ticketRef.id};
  }
);

// TEMPORARILY DISABLED
// export const downloadResult = onRequest(
//   {cors: false},
//   async (req, res) => {
void onRequest(
  {cors: false},
  async (req, res) => {
    if (req.method !== "GET") {
      res.status(405).setHeader("Allow", "GET").end();
      return;
    }
    const ticketId = req.query?.ticket;
    if (!ticketId || typeof ticketId !== "string") {
      res.status(400).send("Missing ticket");
      return;
    }
    if (!/^[\w-]+$/.test(ticketId)) {
      res.status(400).send("Invalid ticket");
      return;
    }

    const ticketRef = db.collection("downloadTickets").doc(ticketId);
    const ticketSnap = await ticketRef.get();
    const ticketData = ticketSnap.data() as DownloadTicketDoc | undefined;
    if (!ticketSnap.exists || !ticketData) {
      res.status(404).send("Ticket not found");
      return;
    }
    const now = admin.firestore.Timestamp.now();
    if (ticketData.expiresAt.toMillis() < now.toMillis()) {
      await ticketRef.delete();
      res.status(410).send("Ticket expired");
      return;
    }

    const jobSnap = await db.doc(`jobs/${ticketData.jobId}`).get();
    const jobData = jobSnap.data() as JobDoc | undefined;
    if (!jobSnap.exists || !jobData || jobData.uid !== ticketData.uid) {
      await ticketRef.delete();
      res.status(404).send("Job not found");
      return;
    }
    const outputUrl = jobData.kling?.outputUrl;
    if (!outputUrl || typeof outputUrl !== "string") {
      await ticketRef.delete();
      res.status(404).send("No output URL");
      return;
    }

    await ticketRef.delete();

    try {
      const klingRes = await fetch(outputUrl, {redirect: "follow"});
      if (!klingRes.ok) {
        res.status(502).send("Upstream error");
        return;
      }
      const contentType =
        klingRes.headers.get("content-type") || "video/mp4";
      const contentDisposition =
        klingRes.headers.get("content-disposition") ||
        "attachment; filename=\"result.mp4\"";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", contentDisposition);

      const reader = klingRes.body?.getReader();
      if (!reader) {
        res.status(502).send("No body");
        return;
      }
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (err: unknown) {
      logger.error("downloadResult stream failed", {
        ticketId,
        err: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.status(502).send("Download failed");
      }
    }
  }
);

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

const POLL_BATCH_SIZE = 15;

export const pollKlingScheduled = onSchedule(
  {
    schedule: "every 2 minutes",
    region: "us-central1",
    secrets: [klingAccessKey, klingSecretKey],
    timeoutSeconds: 120,
    memory: "256MiB",
  },
  async () => {
    const accessKey = klingAccessKey.value();
    const secretKey = klingSecretKey.value();
    if (!accessKey || !secretKey) {
      logger.error("POLL_ERROR", {err: "Missing Kling secrets"});
      return;
    }
    const token = makeKlingJwt(accessKey, secretKey);
    const ts = admin.firestore.FieldValue.serverTimestamp();

    const snap = await db
      .collection("jobs")
      .where("status", "==", "processing")
      .limit(POLL_BATCH_SIZE)
      .get();

    let updated = 0;
    const checked = snap.size;

    for (const doc of snap.docs) {
      const jobId = doc.id;
      const data = doc.data() as Partial<JobDoc>;
      const kling = data.kling ?? {};
      const taskId = kling.taskId;

      if (!taskId) {
        await doc.ref.update({
          status: "failed" as JobStatus,
          kling: {...kling, state: "failed", error: "Missing kling.taskId"},
          updatedAt: ts,
        });
        updated++;
        continue;
      }

      try {
        const res = await fetch(
          `${KLING_BASE_URL}/v1/videos/motion-control/${taskId}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        const bodyText = await res.text();
        const json = res.ok ? JSON.parse(bodyText) : null;
        const taskStatus = json?.data?.task_status ?? "";
        const taskStatusMsg =
          (json?.data?.task_status_msg as string | undefined) ?? bodyText;
        if (taskStatus === "succeed") {
          const video = json?.data?.task_result?.videos?.[0];
          const updateKling: Record<string, unknown> = {
            ...kling,
            state: "succeed",
            taskId,
            outputUrl: video?.url,
          };
          if (video?.watermark_url) {
            updateKling.watermarkUrl = video.watermark_url;
          }
          await doc.ref.update({
            status: "done" as JobStatus,
            kling: updateKling,
            updatedAt: ts,
          });
          updated++;
        } else if (taskStatus === "failed") {
          await doc.ref.update({
            status: "failed" as JobStatus,
            kling: {...kling, state: "failed", error: taskStatusMsg},
            updatedAt: ts,
          });
          updated++;
        }
        // processing / submitted: optional — only refresh updatedAt if desired
      } catch (err: unknown) {
        logger.error("POLL_ERROR", {
          jobId,
          taskId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info("POLL", {checked, updated});
  }
);

const INPUT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

type StorageBucket = ReturnType<ReturnType<typeof admin.storage>["bucket"]>;

/**
 * Deletes a file from the default Storage bucket. Ignores "not found" errors.
 * @param {StorageBucket} bucket - Default Storage bucket.
 * @param {string} path - Object path in the bucket.
 */
async function deleteStorageFileIfExists(
  bucket: StorageBucket,
  path: string
): Promise<void> {
  try {
    await bucket.file(path).delete();
  } catch (err: unknown) {
    const code = (err as {code?: number}).code;
    const message = (err as {message?: string}).message ?? "";
    if (code === 404 || /not found|object-not-found/i.test(message)) {
      return;
    }
    throw err;
  }
}

export const cleanupInputsHourly = onSchedule(
  {
    schedule: "every 60 minutes",
    region: "us-central1",
    timeoutSeconds: 300,
    memory: "256MiB",
  },
  async () => {
    const bucket = admin.storage().bucket();
    const cutoff = admin.firestore.Timestamp.fromMillis(
      Date.now() - INPUT_TTL_MS
    );

    const snap = await db
      .collection("jobs")
      .where("createdAt", "<", cutoff)
      .get();

    let jobsUpdated = 0;
    const batch = db.batch();

    for (const doc of snap.docs) {
      const data = doc.data() as Partial<JobDoc>;
      const updates: Partial<JobDoc> = {};
      let didDelete = false;

      if (data.inputImagePath) {
        await deleteStorageFileIfExists(bucket, data.inputImagePath);
        didDelete = true;
        updates.inputImagePath = undefined;
        updates.inputImageUrl = undefined;
      }
      if (data.referenceVideoPath) {
        await deleteStorageFileIfExists(bucket, data.referenceVideoPath);
        didDelete = true;
        updates.referenceVideoPath = undefined;
        updates.referenceVideoUrl = undefined;
      }

      if (didDelete) {
        jobsUpdated++;
        batch.update(doc.ref, {
          ...updates,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    if (jobsUpdated > 0) {
      await batch.commit();
    }

    logger.info("cleanupInputsHourly", {
      jobsScanned: snap.size,
      jobsUpdated,
    });
  }
);
