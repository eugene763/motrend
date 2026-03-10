import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAnalytics,
  logEvent,
  setUserId,
  setUserProperties,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js";
import {
  GoogleAuthProvider,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  getRedirectResult,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithRedirect,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const runtimeHost = window.location.hostname.toLowerCase();
const sameSiteAuthDomains = new Set([
  "trend.moads.agency",
  "www.trend.moads.agency",
]);
const runtimeAuthDomain = sameSiteAuthDomains.has(runtimeHost) ?
  runtimeHost :
  "gen-lang-client-0651837818.firebaseapp.com";

const firebaseConfig = {
  apiKey: "AIzaSyBro7c7o8kiRdAuZZpu73KdKyApX7JuflE",
  authDomain: runtimeAuthDomain,
  projectId: "gen-lang-client-0651837818",
  storageBucket: "gen-lang-client-0651837818.firebasestorage.app",
  messagingSenderId: "399776789069",
  appId: "1:399776789069:web:1567626bd149e1d5116204",
  measurementId: "G-KJC19LBS34",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functionsTarget = (
  runtimeHost === "localhost" || runtimeHost === "127.0.0.1"
) ? "us-central1" : window.location.origin;
const functions = getFunctions(app, functionsTarget);
const createJob = httpsCallable(functions, "createJob");

let analytics = null;
try {
  analytics = getAnalytics(app);
} catch {
  analytics = null;
}

function track(name, params = {}) {
  if (!analytics) return;
  try {
    logEvent(analytics, name, params);
  } catch {
    // no-op
  }
}

const $ = (id) => document.getElementById(id);

function shouldUseRedirectLogin() {
  const ua = navigator.userAgent || "";
  return /Telegram|Instagram|FBAN|FBAV|FB_IAB|Line\/|WebView|; wv\)|\bwv\b/i.test(ua);
}

function isTelegramInAppBrowser() {
  const ua = navigator.userAgent || "";
  return /Telegram/i.test(ua);
}

function isAndroid() {
  const ua = navigator.userAgent || "";
  return /Android/i.test(ua);
}

function buildExternalBrowserUrl() {
  const currentUrl = window.location.href;
  if (!isAndroid()) return currentUrl;

  const host = window.location.host;
  const pathAndQuery = `${window.location.pathname}${window.location.search}`;
  const fallback = encodeURIComponent(currentUrl);
  return `intent://${host}${pathAndQuery}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
}

function updateAuthInAppActions() {
  const openBtn = $("btnOpenExternalAuth");
  if (!openBtn) return;

  const inApp = shouldUseRedirectLogin();
  if (!inApp) {
    openBtn.style.display = "none";
    openBtn.href = "#";
    return;
  }

  openBtn.href = buildExternalBrowserUrl();
  openBtn.style.display = "inline-flex";
}

function showAuthError(message) {
  const el = $("authError");
  if (!el) return;
  el.textContent = message;
  el.style.display = "block";
}

function clearAuthError() {
  const el = $("authError");
  if (!el) return;
  el.textContent = "";
  el.style.display = "none";
}

function showFormError(message) {
  const el = $("formError");
  if (!el) return;
  el.textContent = message;
  el.style.display = "block";
}

function clearFormError() {
  const el = $("formError");
  if (!el) return;
  el.textContent = "";
  el.style.display = "none";
}

function setStatus(message) {
  const el = $("status");
  if (!el) return;
  el.textContent = message;
}

function hasSeenHint(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markHintSeen(key) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // no-op
  }
}

function showUploadHint(message) {
  return new Promise((resolve) => {
    const modal = $("uploadHintModal");
    const text = $("uploadHintText");
    const okBtn = $("btnUploadHintOk");

    if (!modal || !text || !okBtn) {
      resolve();
      return;
    }

    const onOk = () => {
      okBtn.removeEventListener("click", onOk);
      modal.style.display = "none";
      resolve();
    };

    text.textContent = message;
    modal.style.display = "flex";
    okBtn.addEventListener("click", onOk, {once: true});
  });
}

async function maybeShowUploadHint(key, message) {
  if (shouldUseRedirectLogin()) return;
  if (hasSeenHint(key)) return;
  await showUploadHint(message);
  markHintSeen(key);
}

function setSupportButtonMessage(supportCode = "") {
  const btn = $("supportBtn");
  if (!btn) return;

  const baseUrl = "https://wa.me/995574413278";
  const cleanCode = typeof supportCode === "string" ?
    supportCode.trim().toUpperCase() :
    "";
  const text = cleanCode ?
    `Hello, I am having an issue with the MoTrend© app. Support ID: ${cleanCode}.` :
    "Hello, I am having an issue with the MoTrend© app.";

  btn.href = `${baseUrl}?text=${encodeURIComponent(text)}`;
}

function openAuth(message = "") {
  const authBox = $("auth");
  if (authBox) authBox.style.display = "block";
  updateAuthInAppActions();
  if (message) {
    showAuthError(message);
  } else {
    clearAuthError();
  }
  authBox?.scrollIntoView({behavior: "smooth", block: "start"});
  $("authEmail")?.focus();
}

function closeAuth() {
  const authBox = $("auth");
  if (authBox) authBox.style.display = "none";
  clearAuthError();
}

function showSuccessPanel(jobId) {
  const panel = $("jobSuccessPanel");
  const prepareBtn = $("prepareDownloadBtn");
  const downloadBtn = $("downloadTrendBtn");
  const downloadOr = $("downloadOr");
  const openExternalBtn = $("openExternalBtn");
  const copyDownloadBtn = $("copyDownloadBtn");
  const fallbackHint = $("downloadFallbackHint");
  if (
    !panel ||
    !prepareBtn ||
    !downloadBtn ||
    !downloadOr ||
    !openExternalBtn ||
    !copyDownloadBtn ||
    !fallbackHint
  ) {
    return;
  }

  if (activeDoneJobId !== jobId) {
    preparedDownloadJobId = "";
    preparedDownloadUrl = "";
  }
  activeDoneJobId = jobId || "";

  prepareBtn.disabled = isPreparingDownload || !activeDoneJobId;
  if (isPreparingDownload) {
    prepareBtn.innerHTML =
      '<span class="spinner" style="width:12px;height:12px;margin-right:5px;border-width:2px"></span>Preparing...';
  } else {
    prepareBtn.textContent = "Prepare download";
  }

  const safePreparedUrl = safeUrl(
    preparedDownloadJobId === activeDoneJobId ? preparedDownloadUrl : ""
  );
  if (safePreparedUrl) {
    prepareBtn.style.display = "none";
    downloadBtn.href = safePreparedUrl;
    openExternalBtn.href = safePreparedUrl;
    downloadBtn.style.display = "flex";
    downloadOr.style.display = "block";
    openExternalBtn.style.display = "flex";
    copyDownloadBtn.style.display = "flex";
    fallbackHint.style.display = "block";
  } else {
    prepareBtn.style.display = "flex";
    downloadBtn.href = "#";
    openExternalBtn.href = "#";
    downloadBtn.style.display = "none";
    downloadOr.style.display = "none";
    openExternalBtn.style.display = "none";
    copyDownloadBtn.style.display = "none";
    fallbackHint.style.display = "none";
  }

  panel.style.display = "block";
}

function hideSuccessPanel() {
  const panel = $("jobSuccessPanel");
  const prepareBtn = $("prepareDownloadBtn");
  const downloadBtn = $("downloadTrendBtn");
  const downloadOr = $("downloadOr");
  const openExternalBtn = $("openExternalBtn");
  const copyDownloadBtn = $("copyDownloadBtn");
  const fallbackHint = $("downloadFallbackHint");
  if (
    !panel ||
    !prepareBtn ||
    !downloadBtn ||
    !downloadOr ||
    !openExternalBtn ||
    !copyDownloadBtn ||
    !fallbackHint
  ) {
    return;
  }

  activeDoneJobId = "";
  preparedDownloadJobId = "";
  preparedDownloadUrl = "";
  isPreparingDownload = false;

  prepareBtn.disabled = false;
  prepareBtn.textContent = "Prepare download";
  prepareBtn.style.display = "flex";
  panel.style.display = "none";
  downloadBtn.href = "#";
  downloadBtn.style.display = "none";
  downloadOr.style.display = "none";
  openExternalBtn.href = "#";
  openExternalBtn.style.display = "none";
  copyDownloadBtn.style.display = "none";
  fallbackHint.style.display = "none";
}

function safeUrl(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed, window.location.origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function callableErrorMessage(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = typeof error?.message === "string" ? error.message : "";
  const normalized = message.toLowerCase();

  if (
    normalized.includes("image size is to large") ||
    normalized.includes("image size is too large")
  ) {
    return "Image is too large. Please upload a smaller photo.";
  }

  if (
    code.includes("storage/unauthorized") ||
    code.includes("unauthorized")
  ) {
    if (normalized.includes("user does not have permission")) {
      return "Upload blocked. Please use an image up to 40 MB and try again.";
    }
  }

  if (code.includes("resource-exhausted")) {
    if (
      normalized.includes("no available instance") ||
      normalized.includes("temporarily unavailable") ||
      normalized.includes("too many requests")
    ) {
      return "Server is temporarily busy. Please try again in a few seconds.";
    }
    return message || "Not enough credits for this generation.";
  }
  if (code.includes("unauthenticated")) {
    return "Please sign in first.";
  }
  if (code.includes("failed-precondition")) {
    return message || "Template is unavailable. Pick another one.";
  }
  if (code.includes("permission-denied")) {
    return message || "You have no access to this trend.";
  }
  return message || "Something went wrong. Try again.";
}

function setSupportCodeUi(supportCode = "") {
  const normalized = typeof supportCode === "string" ?
    supportCode.trim().toUpperCase() :
    "";
  currentSupportCode = normalized;
  const el = $("supportCode");
  if (el) {
    el.textContent = normalized || "—";
  }
  setSupportButtonMessage(normalized);
}

function setAdminLookupError(message = "") {
  const errorEl = $("adminLookupError");
  if (!errorEl) return;
  if (!message) {
    errorEl.textContent = "";
    errorEl.style.display = "none";
    return;
  }
  errorEl.textContent = message;
  errorEl.style.display = "block";
}

function clearAdminLookupResult() {
  const resultEl = $("adminLookupResult");
  if (resultEl) {
    resultEl.textContent = "";
    resultEl.style.display = "none";
  }
  adminSelectedUid = "";
  adminSelectedSupportCode = "";
  const grantWrap = $("adminGrantWrap");
  if (grantWrap) {
    grantWrap.style.display = "none";
  }
  const amountInput = $("adminGrantAmount");
  if (amountInput && !amountInput.value) {
    amountInput.value = "10";
  }
  const reasonInput = $("adminGrantReason");
  if (reasonInput) {
    reasonInput.value = "";
  }
}

function renderAdminLookupResult(payload) {
  const resultEl = $("adminLookupResult");
  if (!resultEl) return;

  const credits = Number.isFinite(payload?.user?.creditsBalance) ?
    payload.user.creditsBalance :
    0;
  const lines = [
    `UID: ${payload?.uid || "—"}`,
    `Support ID: ${payload?.supportCode || "—"}`,
    `Email: ${payload?.user?.email || "—"}`,
    `Credits: ${credits}`,
    `Country: ${payload?.user?.country || "—"}`,
    `Language: ${payload?.user?.language || "—"}`,
  ];

  const jobs = Array.isArray(payload?.recentJobs) ? payload.recentJobs : [];
  if (jobs.length) {
    lines.push("Recent trends:");
    jobs.forEach((job) => {
      const shortId = typeof job?.id === "string" ? job.id.slice(0, 8) : "—";
      const status = typeof job?.status === "string" ? job.status : "—";
      const templateId = typeof job?.templateId === "string" ? job.templateId : "—";
      lines.push(`- ${shortId} • ${status} • ${templateId}`);
    });
  } else {
    lines.push("Recent trends: none");
  }

  resultEl.textContent = lines.join("\n");
  resultEl.style.display = "block";

  adminSelectedUid = typeof payload?.uid === "string" ? payload.uid : "";
  adminSelectedSupportCode = typeof payload?.supportCode === "string" ?
    payload.supportCode :
    "";
  const grantWrap = $("adminGrantWrap");
  if (grantWrap) {
    grantWrap.style.display = adminSelectedUid ? "block" : "none";
  }
}

function setAdminCardVisible(visible) {
  const adminCard = $("adminCard");
  if (!adminCard) return;
  adminCard.style.display = visible ? "block" : "none";
  if (!visible) {
    setAdminLookupError("");
    clearAdminLookupResult();
    const supportCodeInput = $("adminSupportCode");
    if (supportCodeInput) {
      supportCodeInput.value = "";
    }
  }
}

let currentUser = null;
let selectedTemplate = null;
let selectedReferenceVideoFile = null;
let selectedReferenceVideoName = "";
let unsubscribeUserDoc = null;
let unsubscribeJobs = null;
let latestJobs = [];
const refreshingJobIds = new Set();
let activeDoneJobId = "";
let preparedDownloadJobId = "";
let preparedDownloadUrl = "";
let isPreparingDownload = false;
let currentSupportCode = "";
let isAdminUser = false;
let adminSelectedUid = "";
let adminSelectedSupportCode = "";
const PREPARE_DOWNLOAD_MAX_ATTEMPTS = 8;
const MAX_UPLOAD_IMAGE_BYTES = 40 * 1024 * 1024;
const TARGET_UPLOAD_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_UPLOAD_IMAGE_DIMENSION = 1080;
const MIN_UPLOAD_IMAGE_DIMENSION = 960;
const UPLOAD_IMAGE_QUALITY_STEPS = [0.9, 0.85, 0.8, 0.75, 0.7, 0.65];
const MAX_REFERENCE_VIDEO_BYTES = 200 * 1024 * 1024;
const PHOTO_HINT_KEY = "motrend_photo_hint_v1";
const VIDEO_HINT_KEY = "motrend_video_hint_v1";
const PHOTO_HINT_MESSAGE =
  "Supported image formats: .jpg / .jpeg / .png\n" +
  "File size: ≤10MB, dimensions: 300px ~ 65536px, aspect ratio: 1:2.5 ~ 2.5:1";
const VIDEO_HINT_MESSAGE = "выбор файла на устройстве";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("Unable to process image."));
    }, type, quality);
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to read this image file."));
    };
    image.src = objectUrl;
  });
}

async function prepareUploadImage(file) {
  if (!file || !file.type?.startsWith("image/")) {
    throw new Error("Please upload an image file.");
  }

  if (file.size > MAX_UPLOAD_IMAGE_BYTES) {
    throw new Error("Image is too large. Max file size is 40 MB.");
  }

  const image = await loadImageFromFile(file);
  const width = image.naturalWidth || image.width || 0;
  const height = image.naturalHeight || image.height || 0;
  if (!width || !height) {
    throw new Error("Unable to process this image. Please choose another file.");
  }

  const longestSide = Math.max(width, height);
  const baseScale = Math.min(1, MAX_UPLOAD_IMAGE_DIMENSION / longestSide);
  const scaleSteps = [1, 0.85, 0.7, 0.55];
  let bestBlob = null;

  for (const step of scaleSteps) {
    const scale = Math.min(1, baseScale * step);
    const targetW = Math.max(
      1,
      Math.round(width * scale)
    );
    const targetH = Math.max(
      1,
      Math.round(height * scale)
    );

    if (
      Math.max(targetW, targetH) < MIN_UPLOAD_IMAGE_DIMENSION &&
      longestSide > MIN_UPLOAD_IMAGE_DIMENSION
    ) {
      continue;
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Unable to process this image. Please choose another file.");
    }
    ctx.drawImage(image, 0, 0, targetW, targetH);

    for (const quality of UPLOAD_IMAGE_QUALITY_STEPS) {
      const compressed = await canvasToBlob(canvas, "image/jpeg", quality);
      bestBlob = !bestBlob || compressed.size < bestBlob.size ?
        compressed :
        bestBlob;
      if (compressed.size <= TARGET_UPLOAD_IMAGE_BYTES) {
        return {
          blob: compressed,
          contentType: "image/jpeg",
        };
      }
    }
  }

  if (!bestBlob) {
    throw new Error("Unable to process this image. Please choose another file.");
  }

  if (bestBlob.size > TARGET_UPLOAD_IMAGE_BYTES) {
    throw new Error("Image is too large after compression. Please choose another photo.");
  }

  return {
    blob: bestBlob,
    contentType: "image/jpeg",
  };
}

function guessVideoExtension(file) {
  const name = typeof file?.name === "string" ? file.name.toLowerCase() : "";
  if (name.endsWith(".mov")) return ".mov";
  if (name.endsWith(".webm")) return ".webm";
  if (name.endsWith(".mkv")) return ".mkv";
  return ".mp4";
}

function prepareReferenceVideoInput(file) {
  if (!file || !file.type?.startsWith("video/")) {
    throw new Error("Please choose a video file.");
  }
  if (file.size > MAX_REFERENCE_VIDEO_BYTES) {
    throw new Error("Reference video is too large. Max file size is 200 MB.");
  }
  return {
    blob: file,
    contentType: file.type || "video/mp4",
    extension: guessVideoExtension(file),
  };
}

function shouldRetryCreateJob(error) {
  const code = typeof error?.code === "string" ?
    error.code.toLowerCase() :
    "";
  const message = typeof error?.message === "string" ?
    error.message.toLowerCase() :
    "";

  if (
    code.includes("unauthenticated") ||
    code.includes("permission-denied") ||
    code.includes("invalid-argument")
  ) {
    return false;
  }
  if (code.includes("failed-precondition")) {
    return false;
  }

  if (code.includes("resource-exhausted")) {
    if (message.includes("not enough credits")) {
      return false;
    }
    return true;
  }

  if (
    code.includes("unavailable") ||
    code.includes("internal") ||
    code.includes("aborted") ||
    code.includes("deadline-exceeded")
  ) {
    return true;
  }

  return (
    message.includes("no available instance") ||
    message.includes("temporarily unavailable")
  );
}

async function callCreateJob(payload, maxAttempts = 4) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await createJob(payload);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetryCreateJob(error)) {
        throw error;
      }

      const waitMs = Math.min(4000, 400 * (2 ** (attempt - 1)));
      await sleep(waitMs);
    }
  }

  throw lastError || new Error("createJob failed");
}

function triggerDownload(url) {
  const safe = safeUrl(url);
  if (!safe) return;
  window.open(safe, "_blank", "noopener,noreferrer");
}

async function prepareDownloadLink(jobId) {
  for (let attempt = 0; attempt < PREPARE_DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
    const response = await callCreateJob({prepareDownloadJobId: jobId});
    const payload = response?.data || {};
    const downloadUrl = safeUrl(
      typeof payload.downloadUrl === "string" ? payload.downloadUrl : ""
    );
    if (downloadUrl) {
      return downloadUrl;
    }

    const isPending = payload?.pending === true;
    if (!isPending) {
      break;
    }

    const retryAfterMs = (
      typeof payload.retryAfterMs === "number" && payload.retryAfterMs > 0
    ) ? Math.min(payload.retryAfterMs, 10_000) : 2_000;
    await sleep(retryAfterMs);
  }

  throw new Error("Download is still preparing. Please tap again.");
}

const prepareDownloadBtn = $("prepareDownloadBtn");
if (prepareDownloadBtn) {
  prepareDownloadBtn.onclick = async () => {
    if (!currentUser || !activeDoneJobId || isPreparingDownload) return;

    clearFormError();
    isPreparingDownload = true;
    showSuccessPanel(activeDoneJobId);

    try {
      const downloadUrl = await prepareDownloadLink(activeDoneJobId);

      preparedDownloadJobId = activeDoneJobId;
      preparedDownloadUrl = downloadUrl;
      showSuccessPanel(activeDoneJobId);
    } catch (error) {
      showFormError(callableErrorMessage(error));
    } finally {
      isPreparingDownload = false;
      if (activeDoneJobId) {
        showSuccessPanel(activeDoneJobId);
      }
    }
  };
}

async function syncSupportProfile() {
  if (!currentUser) {
    isAdminUser = false;
    setSupportCodeUi("");
    setAdminCardVisible(false);
    return;
  }

  try {
    const response = await callCreateJob({supportProfile: true});
    const payload = response?.data || {};
    const supportCode = typeof payload?.supportCode === "string" ?
      payload.supportCode :
      "";
    setSupportCodeUi(supportCode);
    isAdminUser = payload?.isAdmin === true;
    setAdminCardVisible(isAdminUser);
  } catch (error) {
    console.warn("getSupportProfile failed", error);
    isAdminUser = false;
    setAdminCardVisible(false);
  }
}

const openExternalAuthBtn = $("btnOpenExternalAuth");
if (openExternalAuthBtn) {
  openExternalAuthBtn.onclick = () => {
    updateAuthInAppActions();
  };
}

const copyDownloadBtn = $("copyDownloadBtn");
if (copyDownloadBtn) {
  copyDownloadBtn.onclick = async () => {
    const safe = safeUrl(preparedDownloadUrl);
    if (!safe) return;
    try {
      await navigator.clipboard.writeText(safe);
      setStatus("Download link copied.");
    } catch {
      showFormError("Unable to copy link. Please copy it manually.");
    }
  };
}

$("btnEmailSignIn").onclick = async () => {
  clearAuthError();
  const email = $("authEmail").value.trim();
  const pass = $("authPass").value;

  try {
    track("login_click", {method: "email"});
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (error) {
    showAuthError(callableErrorMessage(error));
  }
};

$("btnEmailSignUp").onclick = async () => {
  clearAuthError();
  const email = $("authEmail").value.trim();
  const pass = $("authPass").value;

  try {
    track("signup_click", {method: "email"});
    await createUserWithEmailAndPassword(auth, email, pass);
  } catch (error) {
    showAuthError(callableErrorMessage(error));
  }
};

$("btnLogin").onclick = async () => {
  clearAuthError();
  const provider = new GoogleAuthProvider();
  const forceRedirect = shouldUseRedirectLogin();
  if (isTelegramInAppBrowser()) {
    showAuthError(
      "Google sign-in is blocked inside Telegram. Open this page in Chrome/Safari, or use email sign-in."
    );
    return;
  }

  try {
    track("login_click", {method: "google"});
    if (forceRedirect) {
      await setPersistence(auth, browserSessionPersistence);
      setStatus("Redirecting to Google sign-in…");
      await signInWithRedirect(auth, provider);
      return;
    }
    await signInWithPopup(auth, provider);
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "";
    const popupFailed = [
      "auth/popup-blocked",
      "auth/popup-closed-by-user",
      "auth/cancelled-popup-request",
      "auth/operation-not-supported-in-this-environment",
    ].includes(code);

    if (!forceRedirect && popupFailed) {
      try {
        await setPersistence(auth, browserSessionPersistence);
        setStatus("Popup blocked. Redirecting to Google sign-in…");
        await signInWithRedirect(auth, provider);
        return;
      } catch (redirectError) {
        showAuthError(callableErrorMessage(redirectError));
        return;
      }
    }
    showAuthError(callableErrorMessage(error));
  }
};

$("btnLogout").onclick = async () => {
  await signOut(auth);
};

$("btnForgotPassword").onclick = async () => {
  clearAuthError();
  const email = $("authEmail").value.trim();
  if (!email) {
    showAuthError("Enter your email first.");
    $("authEmail")?.focus();
    return;
  }

  try {
    track("password_reset_requested", {method: "email"});
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "";
    console.warn("Password reset request failed", error);

    if (code.includes("auth/invalid-email")) {
      showAuthError("Enter a valid email.");
      return;
    }
    if (code.includes("auth/too-many-requests")) {
      showAuthError("Too many attempts. Try again in a few minutes.");
      return;
    }
    if (code.includes("auth/network-request-failed")) {
      showAuthError("Network error. Check connection and try again.");
      return;
    }
    if (code.includes("auth/operation-not-allowed")) {
      showAuthError("Password reset is not enabled in Firebase Auth.");
      return;
    }
    // Keep response generic for account-related outcomes.
  }

  showAuthError(
    "If an account exists, we sent a reset link to this email."
  );
};

$("btnSaveProfile").onclick = async () => {
  if (!currentUser) return;
  await setDoc(doc(db, "users", currentUser.uid), {
    email: currentUser.email,
    country: $("inpCountry").value,
    language: $("inpLang").value,
    updatedAt: serverTimestamp(),
  }, {merge: true});
};

$("btnWallet").onclick = () => {
  alert("Wallet: позже подключим оплату/кредиты.");
};

const btnFindSupportUser = $("btnFindSupportUser");
if (btnFindSupportUser) {
  btnFindSupportUser.onclick = async () => {
    if (!currentUser || !isAdminUser) return;
    const input = $("adminSupportCode");
    const code = typeof input?.value === "string" ?
      input.value.trim().toUpperCase() :
      "";
    if (!code) {
      setAdminLookupError("Enter Support ID.");
      clearAdminLookupResult();
      return;
    }

    setAdminLookupError("");
    clearAdminLookupResult();
    btnFindSupportUser.disabled = true;
    btnFindSupportUser.innerHTML =
      '<span class="spinner" style="width:12px;height:12px;margin-right:5px;border-width:2px"></span>Searching...';

    try {
      const response = await callCreateJob({findSupportCode: code});
      const payload = response?.data || {};
      renderAdminLookupResult(payload);
      if (input) input.value = code;
    } catch (error) {
      setAdminLookupError(callableErrorMessage(error));
      clearAdminLookupResult();
    } finally {
      btnFindSupportUser.disabled = false;
      btnFindSupportUser.textContent = "Find user";
    }
  };
}

const btnGrantCredits = $("btnGrantCredits");
if (btnGrantCredits) {
  btnGrantCredits.onclick = async () => {
    if (!currentUser || !isAdminUser || !adminSelectedUid) return;
    const amountInput = $("adminGrantAmount");
    const reasonInput = $("adminGrantReason");
    const amount = Number(amountInput?.value || 0);
    const reason = typeof reasonInput?.value === "string" ?
      reasonInput.value.trim() :
      "";

    if (!Number.isFinite(amount) || amount < 1 || amount > 500) {
      setAdminLookupError("Amount must be between 1 and 500.");
      return;
    }
    if (reason.length < 3) {
      setAdminLookupError("Reason must be at least 3 characters.");
      return;
    }

    setAdminLookupError("");
    btnGrantCredits.disabled = true;
    btnGrantCredits.innerHTML =
      '<span class="spinner" style="width:12px;height:12px;margin-right:5px;border-width:2px"></span>Granting...';

    try {
      const response = await callCreateJob({
        grantCredits: true,
        uid: adminSelectedUid,
        amount,
        reason,
      });
      const payload = response?.data || {};
      const supportCode = adminSelectedSupportCode || payload?.supportCode || "";
      setAdminLookupError("");
      setStatus("Credits granted.");

      if (supportCode) {
        const lookup = await callCreateJob({findSupportCode: supportCode});
        renderAdminLookupResult(lookup?.data || {});
      }
    } catch (error) {
      setAdminLookupError(callableErrorMessage(error));
    } finally {
      btnGrantCredits.disabled = false;
      btnGrantCredits.textContent = "Grant credits";
    }
  };
}

function stopAllTemplateVideos(exceptEl = null) {
  document.querySelectorAll(".tplVideo").forEach((video) => {
    if (video === exceptEl) return;
    try {
      video.pause();
      video.currentTime = 0;
      video.muted = true;
    } catch {
      // no-op
    }
  });
}

function renderReferenceVideoCard() {
  const card = document.createElement("div");
  card.className = "card tplCard";
  card.style.margin = "0";
  card.style.cursor = "pointer";

  const media = document.createElement("div");
  media.className = "tplMedia";

  const placeholder = document.createElement("div");
  placeholder.className = "refPlaceholder";
  placeholder.textContent = "Your video reference";
  media.appendChild(placeholder);

  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.style.marginTop = "8px";
  title.textContent = "Your video reference";

  const meta = document.createElement("div");
  meta.className = "muted";
  meta.textContent = selectedReferenceVideoName || "No video selected";

  const actionBtn = document.createElement("button");
  actionBtn.className = "btn tplUse";
  actionBtn.style.marginTop = "10px";
  actionBtn.style.width = "100%";
  actionBtn.textContent = "Download";

  const picker = $("fileReferenceVideo");

  const updateSelectedUi = () => {
    const selected = !!selectedReferenceVideoFile;
    card.classList.toggle("isSelected", selected);
    card.classList.toggle("isHot", selected);
    meta.textContent = selectedReferenceVideoName || "No video selected";
  };

  const openPicker = async () => {
    if (!picker) return;
    clearFormError();
    await maybeShowUploadHint(VIDEO_HINT_KEY, VIDEO_HINT_MESSAGE);
    picker.click();
  };

  card.onclick = () => {
    openPicker();
  };
  actionBtn.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    openPicker();
  };

  if (picker) {
    picker.onchange = () => {
      const file = picker.files?.[0] || null;
      selectedReferenceVideoFile = file;
      selectedReferenceVideoName = file ? file.name : "";
      updateSelectedUi();
    };
  }

  card.appendChild(media);
  card.appendChild(title);
  card.appendChild(meta);
  card.appendChild(actionBtn);
  updateSelectedUi();

  return card;
}

function renderTemplateCard(template) {
  const card = document.createElement("div");
  card.className = "card tplCard";
  card.style.margin = "0";
  card.style.cursor = "pointer";

  const thumbUrl = safeUrl(template.preview?.thumbnailUrl || "");
  const videoUrl = safeUrl(template.preview?.previewVideoUrl || "");
  const mode = template.modeDefault || "std";
  const titleText = template.title || "Template";

  const media = document.createElement("div");
  media.className = "tplMedia";

  let videoEl = null;
  if (videoUrl) {
    videoEl = document.createElement("video");
    videoEl.className = "tplVideo";
    videoEl.src = videoUrl;
    if (thumbUrl) videoEl.poster = thumbUrl;
    videoEl.playsInline = true;
    videoEl.muted = true;
    videoEl.loop = true;
    videoEl.autoplay = true;
    videoEl.preload = "metadata";
    media.appendChild(videoEl);
  } else if (thumbUrl) {
    const img = document.createElement("img");
    img.src = thumbUrl;
    img.alt = "";
    media.appendChild(img);
  }

  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.style.marginTop = "8px";
  title.textContent = titleText;

  const meta = document.createElement("div");
  meta.className = "muted";
  meta.textContent = `${template.durationSec ?? "—"}s • ${mode}`;

  const useBtn = document.createElement("button");
  useBtn.className = "btn tplUse";
  useBtn.style.marginTop = "10px";
  useBtn.style.width = "100%";
  useBtn.textContent = "Use";

  card.appendChild(media);
  card.appendChild(title);
  card.appendChild(meta);
  card.appendChild(useBtn);

  if (videoEl) {
    setTimeout(() => {
      videoEl.play().catch(() => {});
    }, 50);
  }

  const selectTemplate = async ({toggleAudioOnSameSelection = false} = {}) => {
    const isSameSelection = selectedTemplate?.id === template.id;

    selectedTemplate = template;
    $("selTemplate").value = `${template.title} (${template.durationSec}s ${mode})`;
    document.querySelectorAll(".tplCard").forEach((el) => {
      el.classList.remove("isSelected");
      el.classList.remove("isHot");
    });
    card.classList.add("isSelected");
    card.classList.add("isHot");

    stopAllTemplateVideos(videoEl);
    if (videoEl) {
      try {
        if (isSameSelection && toggleAudioOnSameSelection) {
          videoEl.muted = !videoEl.muted;
        } else {
          videoEl.muted = false;
        }
        videoEl.volume = 1;
        await videoEl.play();
      } catch {
        // no-op
      }
    }

    track("template_selected", {
      templateId: template.id,
      title: template.title || "",
    });
  };

  card.onclick = () => {
    selectTemplate({toggleAudioOnSameSelection: true});
  };

  useBtn.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectTemplate();
  };

  return card;
}

async function loadTemplates() {
  const container = $("templates");
  container.innerHTML =
    '<div class="templatesLoading"><span class="spinner"></span>Loading templates…</div>';

  try {
    const qy = query(
      collection(db, "templates"),
      where("isActive", "==", true),
      orderBy("order", "asc"),
      limit(30)
    );

    const snap = await getDocs(qy);
    container.innerHTML = "";

    container.appendChild(renderReferenceVideoCard());

    if (snap.empty) {
      const empty = document.createElement("div");
      empty.className = "templatesLoading muted";
      empty.textContent = "No templates available.";
      container.appendChild(empty);
      return;
    }

    snap.forEach((docSnap) => {
      const template = {id: docSnap.id, ...docSnap.data()};
      container.appendChild(renderTemplateCard(template));
    });
  } catch (error) {
    container.innerHTML =
      '<div class="templatesLoading muted">Failed to load templates.</div>';
    console.warn(error);
  }
}

function watchUserDoc(uid) {
  return onSnapshot(doc(db, "users", uid), (snap) => {
    const data = snap.data() || {};
    $("credits").textContent = data.creditsBalance ?? 0;
    $("country").textContent = data.country ?? "—";
    $("lang").textContent = data.language ?? "—";
    if (typeof data.supportCode === "string" && data.supportCode.trim()) {
      setSupportCodeUi(data.supportCode);
    }
    const needsOnboarding = !data.country || !data.language;
    $("onboarding").style.display = needsOnboarding ? "block" : "none";
  });
}

function statusLabel(status) {
  if (status === "queued") return "queued";
  if (status === "processing") return "processing";
  if (status === "done") return "done";
  if (status === "failed") return "failed";
  return "pending";
}

function updateLatestJobUI(jobId, job) {
  const status = job?.status || "";
  const outputUrl = safeUrl(job?.kling?.outputUrl || "");
  const error = job?.kling?.error || "";

  if (status === "done" && outputUrl && jobId) {
    setStatus("Done. Download is ready.");
    showSuccessPanel(jobId);
    return;
  }

  hideSuccessPanel();

  if (status === "queued") {
    setStatus("Queued. Waiting for processing…");
  } else if (status === "processing") {
    setStatus("Processing…");
  } else if (status === "failed") {
    setStatus(`Failed: ${error || "try another photo/template"}`);
  }
}

function canRefreshJob(job) {
  return job?.status === "queued" || job?.status === "processing";
}

function renderJobsList() {
  const jobsEl = $("jobs");
  if (!jobsEl) return;

  if (!latestJobs.length) {
    jobsEl.textContent = "No trends yet.";
    hideSuccessPanel();
    return;
  }

  jobsEl.innerHTML = "";

  latestJobs.forEach((item) => {
    const job = item.data || {};
    const row = document.createElement("div");
    row.className = "row";
    row.style.justifyContent = "space-between";
    row.style.marginBottom = "8px";

    const meta = document.createElement("div");
    const outputUrl = safeUrl(job?.kling?.outputUrl || "");
    meta.textContent = `${item.id.slice(0, 6)}… • ${statusLabel(job.status)} ${outputUrl ? "• ✅" : ""}`;
    row.appendChild(meta);

    if (canRefreshJob(job)) {
      const refreshBtn = document.createElement("button");
      refreshBtn.className = "btnRefresh";
      refreshBtn.style.padding = "6px 10px";

      const isRefreshing = refreshingJobIds.has(item.id);
      refreshBtn.disabled = isRefreshing;
      if (isRefreshing) {
        refreshBtn.innerHTML =
          '<span class="spinner" style="width:12px;height:12px;margin-right:5px;border-width:2px"></span>Refreshing...';
      } else {
        refreshBtn.textContent = "Refresh status";
      }

      refreshBtn.onclick = async () => {
        if (!currentUser || refreshingJobIds.has(item.id)) return;
        clearFormError();
        refreshingJobIds.add(item.id);
        renderJobsList();

        try {
          const response = await callCreateJob({refreshJobId: item.id});
          const payload = response?.data || {};
          const idx = latestJobs.findIndex((entry) => entry.id === item.id);
          if (idx >= 0 && payload && typeof payload === "object") {
            const status = typeof payload.status === "string" ?
              payload.status :
              latestJobs[idx].data?.status;
            const kling = payload.kling && typeof payload.kling === "object" ?
              payload.kling :
              latestJobs[idx].data?.kling;

            latestJobs[idx] = {
              ...latestJobs[idx],
              data: {
                ...latestJobs[idx].data,
                status,
                kling,
              },
            };

            const refreshedOutputUrl = safeUrl(kling?.outputUrl || "");
            if (status === "done" && refreshedOutputUrl) {
              // Prefer the freshly completed trend in the download panel.
              if (activeDoneJobId !== item.id) {
                activeDoneJobId = item.id;
                preparedDownloadJobId = "";
                preparedDownloadUrl = "";
              }
            }
          }
        } catch (error) {
          showFormError(callableErrorMessage(error));
        } finally {
          refreshingJobIds.delete(item.id);
          renderJobsList();
        }
      };

      row.appendChild(refreshBtn);
    }

    jobsEl.appendChild(row);
  });

  const latest = latestJobs[0];
  const isDoneWithOutput = (item) => (
    item?.data?.status === "done" &&
    !!safeUrl(item?.data?.kling?.outputUrl || "")
  );

  const activeDone = latestJobs.find((item) =>
    item.id === activeDoneJobId && isDoneWithOutput(item)
  );
  const fallbackDone = latestJobs.find((item) => isDoneWithOutput(item));
  const doneForPanel = activeDone || fallbackDone || null;

  if (doneForPanel) {
    showSuccessPanel(doneForPanel.id);
    if (latest.id === doneForPanel.id) {
      setStatus("Done. Download is ready.");
    } else if (latest?.data?.status === "processing") {
      setStatus("Processing… Previous trend download is ready.");
    } else if (latest?.data?.status === "queued") {
      setStatus("Queued. Previous trend download is ready.");
    } else if (latest?.data?.status === "failed") {
      const error = latest?.data?.kling?.error || "try another photo/template";
      setStatus(
        `Latest trend failed: ${error}. Previous trend download is ready.`
      );
    } else {
      setStatus("Download is ready.");
    }
    return;
  }

  updateLatestJobUI(latest.id, latest.data);
}

function watchLatestJobs(uid) {
  const qy = query(
    collection(db, "jobs"),
    where("uid", "==", uid),
    orderBy("createdAt", "desc"),
    limit(5)
  );

  return onSnapshot(qy, (snap) => {
    if (snap.empty) {
      latestJobs = [];
      renderJobsList();
      return;
    }

    latestJobs = snap.docs.map((docSnap) => ({
      id: docSnap.id,
      data: docSnap.data() || {},
    }));
    renderJobsList();
  });
}

$("btnGenerate").onclick = async () => {
  clearFormError();

  if (!currentUser) {
    openAuth("Sign in to upload a photo and generate.");
    return;
  }

  if (!selectedTemplate) {
    showFormError("Pick a template first.");
    return;
  }

  const rawFile = $("filePhoto").files?.[0];
  if (!rawFile) {
    showFormError("Upload a photo.");
    return;
  }

  const btn = $("btnGenerate");
  btn.disabled = true;
  hideSuccessPanel();
  setStatus("Creating job…");

  try {
    const response = await callCreateJob({templateId: selectedTemplate.id});
    const jobId = response.data?.jobId;
    const uploadPath = response.data?.uploadPath;

    if (!jobId || !uploadPath) {
      throw new Error("createJob returned empty payload");
    }

    let referenceVideoPath = "";
    let referenceVideoUrl = "";
    if (selectedReferenceVideoFile) {
      const preparedVideo = prepareReferenceVideoInput(selectedReferenceVideoFile);
      const uploadDir = uploadPath.replace(/\/[^/]+$/, "");
      referenceVideoPath = `${uploadDir}/reference${preparedVideo.extension}`;

      setStatus("Uploading reference video…");
      const referenceRef = ref(storage, referenceVideoPath);
      await uploadBytes(referenceRef, preparedVideo.blob, {
        contentType: preparedVideo.contentType,
      });
      referenceVideoUrl = await getDownloadURL(referenceRef);
    }

    setStatus("Preparing photo…");
    const uploadInput = await prepareUploadImage(rawFile);

    setStatus("Uploading photo…");
    const photoRef = ref(storage, uploadPath);
    await uploadBytes(photoRef, uploadInput.blob, {
      contentType: uploadInput.contentType || "image/jpeg",
    });

    const inputImageUrl = await getDownloadURL(photoRef);

    const updates = {
      inputImageUrl,
      inputImagePath: uploadPath,
      updatedAt: serverTimestamp(),
    };
    if (referenceVideoPath && referenceVideoUrl) {
      updates.referenceVideoPath = referenceVideoPath;
      updates.referenceVideoUrl = referenceVideoUrl;
    }

    await updateDoc(doc(db, "jobs", jobId), updates);

    setStatus("Queued. Generating…");
  } catch (error) {
    setStatus("");
    showFormError(callableErrorMessage(error));
  } finally {
    btn.disabled = false;
  }
};

const fileInput = $("filePhoto");
if (fileInput) {
  fileInput.addEventListener("click", async (event) => {
    if (!currentUser) {
      event.preventDefault();
      openAuth("Sign in to upload a photo.");
      return;
    }

    if (shouldUseRedirectLogin() || hasSeenHint(PHOTO_HINT_KEY)) return;

    event.preventDefault();
    await maybeShowUploadHint(PHOTO_HINT_KEY, PHOTO_HINT_MESSAGE);
    fileInput.click();
  });
}

try {
  await getRedirectResult(auth);
} catch (error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (isTelegramInAppBrowser() && code.includes("invalid-action-code")) {
    openAuth(
      "Google sign-in is blocked inside Telegram. Open this page in Chrome/Safari, or use email sign-in."
    );
  } else {
    openAuth(callableErrorMessage(error));
  }
}

onAuthStateChanged(auth, async (user) => {
  if (typeof unsubscribeUserDoc === "function") {
    unsubscribeUserDoc();
    unsubscribeUserDoc = null;
  }
  if (typeof unsubscribeJobs === "function") {
    unsubscribeJobs();
    unsubscribeJobs = null;
  }

  currentUser = user;
  $("app").style.display = "block";

  if (!user) {
    $("userLine").textContent = "Guest";
    $("credits").textContent = "0";
    $("country").textContent = "—";
    $("lang").textContent = "—";
    selectedReferenceVideoFile = null;
    selectedReferenceVideoName = "";
    const referencePicker = $("fileReferenceVideo");
    if (referencePicker) {
      referencePicker.value = "";
    }
    setSupportCodeUi("");
    $("userCard").style.display = "none";
    $("jobsCard").style.display = "none";
    $("btnWallet").style.display = "none";
    $("btnLogout").style.display = "none";
    $("supportBtn").style.display = "none";
    setAdminCardVisible(false);
    isAdminUser = false;
    closeAuth();
    updateAuthInAppActions();
    hideSuccessPanel();
    setStatus("");
    latestJobs = [];
    refreshingJobIds.clear();
    renderJobsList();

    await loadTemplates();
    $("jobs").textContent = "Sign in to see your trends.";
    return;
  }

  closeAuth();
  $("userCard").style.display = "block";
  $("jobsCard").style.display = "block";
  $("btnWallet").style.display = "inline-block";
  $("btnLogout").style.display = "inline-block";
  $("supportBtn").style.display = "inline-flex";
  $("userLine").textContent = user.email || "Signed in";

  if (analytics) {
    try {
      setUserId(analytics, user.uid);
      setUserProperties(analytics, {user_email: user.email || ""});
    } catch {
      // no-op
    }
  }

  await setDoc(doc(db, "users", user.uid), {
    email: user.email,
    updatedAt: serverTimestamp(),
  }, {merge: true});

  await syncSupportProfile();

  await loadTemplates();
  unsubscribeUserDoc = watchUserDoc(user.uid);
  unsubscribeJobs = watchLatestJobs(user.uid);
});
