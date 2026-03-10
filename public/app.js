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

const runtimeHost = window.location.hostname;
const runtimeAuthDomain = runtimeHost === "trend.moads.agency"
  ? "trend.moads.agency"
  : "gen-lang-client-0651837818.firebaseapp.com";

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
const functions = getFunctions(app, "us-central1");
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

  if (code.includes("resource-exhausted")) {
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

let currentUser = null;
let selectedTemplate = null;
let unsubscribeUserDoc = null;
let unsubscribeJobs = null;
let latestJobs = [];
const refreshingJobIds = new Set();
let activeDoneJobId = "";
let preparedDownloadJobId = "";
let preparedDownloadUrl = "";
let isPreparingDownload = false;
const PREPARE_DOWNLOAD_MAX_ATTEMPTS = 8;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function triggerDownload(url) {
  const safe = safeUrl(url);
  if (!safe) return;
  window.open(safe, "_blank", "noopener,noreferrer");
}

async function prepareDownloadLink(jobId) {
  for (let attempt = 0; attempt < PREPARE_DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
    const response = await createJob({prepareDownloadJobId: jobId});
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

  const selectTemplate = async () => {
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
        videoEl.muted = false;
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
    selectTemplate();
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

    if (snap.empty) {
      container.innerHTML = "<div class=\"templatesLoading muted\">No templates available.</div>";
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
          const response = await createJob({refreshJobId: item.id});
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

  updateLatestJobUI(latestJobs[0].id, latestJobs[0].data);
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

  const file = $("filePhoto").files?.[0];
  if (!file) {
    showFormError("Upload a photo.");
    return;
  }

  const btn = $("btnGenerate");
  btn.disabled = true;
  hideSuccessPanel();
  setStatus("Creating job…");

  try {
    const response = await createJob({templateId: selectedTemplate.id});
    const jobId = response.data?.jobId;
    const uploadPath = response.data?.uploadPath;

    if (!jobId || !uploadPath) {
      throw new Error("createJob returned empty payload");
    }

    setStatus("Uploading photo…");
    const photoRef = ref(storage, uploadPath);
    await uploadBytes(photoRef, file, {
      contentType: file.type || "image/jpeg",
    });

    const inputImageUrl = await getDownloadURL(photoRef);

    await updateDoc(doc(db, "jobs", jobId), {
      inputImageUrl,
      inputImagePath: uploadPath,
      updatedAt: serverTimestamp(),
    });

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
  fileInput.addEventListener("click", (event) => {
    if (currentUser) return;
    event.preventDefault();
    openAuth("Sign in to upload a photo.");
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
    $("userCard").style.display = "none";
    $("jobsCard").style.display = "none";
    $("btnWallet").style.display = "none";
    $("btnLogout").style.display = "none";
    $("supportBtn").style.display = "none";
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

  await loadTemplates();
  unsubscribeUserDoc = watchUserDoc(user.uid);
  unsubscribeJobs = watchLatestJobs(user.uid);
});
