#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const admin = require("../functions/node_modules/firebase-admin");

function readDefaultProjectId() {
  const firebasercPath = path.join(__dirname, "..", ".firebaserc");
  try {
    const parsed = JSON.parse(fs.readFileSync(firebasercPath, "utf8"));
    return parsed?.projects?.default || null;
  } catch (_) {
    return null;
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    email: "",
    projectId: readDefaultProjectId(),
    dryRun: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      return options;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--project" || arg === "-p") {
      options.projectId = args[i + 1] || "";
      i += 1;
      continue;
    }
    if (!options.email) {
      options.email = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(
    [
      "Usage:",
      "  node scripts/delete-user-by-email.js <email> [--dry-run] [--project <projectId>]",
      "",
      "Examples:",
      "  node scripts/delete-user-by-email.js user@example.com --dry-run",
      "  node scripts/delete-user-by-email.js user@example.com",
    ].join("\n")
  );
}

async function deleteDocRefsInBatches(docRefs, dryRun) {
  if (dryRun || !docRefs.length) return docRefs.length;
  const db = admin.firestore();
  let deleted = 0;
  for (let i = 0; i < docRefs.length; i += 400) {
    const batch = db.batch();
    const chunk = docRefs.slice(i, i + 400);
    for (const ref of chunk) batch.delete(ref);
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

async function deleteFilesByPrefix(bucket, prefix, dryRun) {
  const [files] = await bucket.getFiles({prefix});
  if (!files.length) return 0;
  if (!dryRun) {
    await Promise.all(
      files.map((file) => file.delete({ignoreNotFound: true}).catch(() => null))
    );
  }
  return files.length;
}

async function deleteExplicitFiles(bucket, filePaths, dryRun) {
  let deleted = 0;
  for (const filePath of filePaths) {
    if (!dryRun) {
      try {
        await bucket.file(filePath).delete({ignoreNotFound: true});
      } catch (_) {
        // ignore missing file / transient cleanup issues
      }
    }
    deleted += 1;
  }
  return deleted;
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.email) {
    printHelp();
    process.exitCode = 1;
    return;
  }
  if (!options.projectId) {
    throw new Error("Missing Firebase projectId. Pass --project <projectId>.");
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: options.projectId,
    storageBucket: `${options.projectId}.firebasestorage.app`,
  });

  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  const userRecord = await admin.auth().getUserByEmail(options.email);
  const uid = userRecord.uid;
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  const userData = userSnap.exists ? (userSnap.data() || {}) : {};
  const supportCode = typeof userData.supportCode === "string" ?
    userData.supportCode.trim().toUpperCase() :
    "";

  const privateSnap = await userRef.collection("private").get();
  const jobsSnap = await db.collection("jobs").where("uid", "==", uid).get();
  const supportCodesByUidSnap = await db.collection("support_codes")
    .where("uid", "==", uid)
    .get();
  const creditAdjSnap = await db.collection("credit_adjustments")
    .where("uid", "==", uid)
    .get();
  const jobRequestsSnap = await db.collection("job_requests")
    .where("uid", "==", uid)
    .get();

  const storagePrefixes = new Set([`user_uploads/${uid}/`]);
  const storageFilePaths = new Set();
  for (const doc of jobsSnap.docs) {
    const data = doc.data() || {};
    if (typeof data.inputImagePath === "string" && data.inputImagePath) {
      storageFilePaths.add(data.inputImagePath);
    }
    if (typeof data.referenceVideoPath === "string" && data.referenceVideoPath) {
      storageFilePaths.add(data.referenceVideoPath);
    }
    const downloadPath = data.download &&
      typeof data.download.storagePath === "string" ?
      data.download.storagePath :
      "";
    if (downloadPath) {
      storageFilePaths.add(downloadPath);
    }
  }

  const summary = {
    email: options.email,
    uid,
    dryRun: options.dryRun,
    authDeleted: false,
    userDocDeleted: false,
    privateDocsDeleted: privateSnap.size,
    jobsDeleted: jobsSnap.size,
    supportCodeDocsDeleted: 0,
    creditAdjustmentsDeleted: creditAdjSnap.size,
    jobRequestsDeleted: jobRequestsSnap.size,
    storageFilesDeleted: 0,
    storagePrefixes: [],
    supportCode: supportCode || null,
  };

  if (supportCode) {
    const codeRef = db.collection("support_codes").doc(supportCode);
    const codeSnap = await codeRef.get();
    if (codeSnap.exists) summary.supportCodeDocsDeleted += 1;
  }
  summary.supportCodeDocsDeleted += supportCodesByUidSnap.docs
    .filter((doc) => doc.id !== supportCode)
    .length;

  summary.storageFilesDeleted += await deleteExplicitFiles(
    bucket,
    Array.from(storageFilePaths),
    options.dryRun
  );
  for (const prefix of storagePrefixes) {
    const deleted = await deleteFilesByPrefix(bucket, prefix, options.dryRun);
    summary.storageFilesDeleted += deleted;
    summary.storagePrefixes.push({prefix, deleted});
  }

  if (!options.dryRun) {
    await deleteDocRefsInBatches(privateSnap.docs.map((doc) => doc.ref), false);
    await deleteDocRefsInBatches(jobsSnap.docs.map((doc) => doc.ref), false);

    const supportCodeRefs = [];
    if (supportCode) {
      const codeRef = db.collection("support_codes").doc(supportCode);
      const codeSnap = await codeRef.get();
      if (codeSnap.exists) supportCodeRefs.push(codeRef);
    }
    for (const doc of supportCodesByUidSnap.docs) {
      if (!supportCode || doc.id !== supportCode) supportCodeRefs.push(doc.ref);
    }
    await deleteDocRefsInBatches(supportCodeRefs, false);
    await deleteDocRefsInBatches(
      creditAdjSnap.docs.map((doc) => doc.ref),
      false
    );
    await deleteDocRefsInBatches(
      jobRequestsSnap.docs.map((doc) => doc.ref),
      false
    );

    if (userSnap.exists) {
      await userRef.delete();
      summary.userDocDeleted = true;
    }
    await admin.auth().deleteUser(uid);
    summary.authDeleted = true;
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("delete-user-by-email failed");
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
