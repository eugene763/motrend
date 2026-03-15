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
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytesResumable,
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

function buildExternalBrowserUrlFor(rawUrl) {
  const targetUrl = safeUrl(rawUrl) || window.location.href;
  if (!isAndroid()) return targetUrl;

  try {
    const parsed = new URL(targetUrl);
    const scheme = parsed.protocol.replace(":", "") || "https";
    const host = parsed.host;
    const pathQueryHash = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    const fallback = encodeURIComponent(parsed.toString());
    return `intent://${host}${pathQueryHash}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
  } catch {
    return targetUrl;
  }
}

function buildExternalBrowserUrl() {
  return buildExternalBrowserUrlFor(window.location.href);
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

function getStoredFlag(key, storage = localStorage) {
  try {
    return storage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function setStoredFlag(key, value = true, storage = localStorage) {
  try {
    if (value) {
      storage.setItem(key, "1");
    } else {
      storage.removeItem(key);
    }
  } catch {
    // no-op
  }
}

function setStatus(message) {
  const el = $("status");
  if (!el) return;
  el.textContent = message;
}

function setStatusHintVisible(visible) {
  const hint = $("statusHint");
  if (!hint) return;
  hint.style.display = visible ? "block" : "none";
}

const ATTRIBUTION_STORAGE_KEY = "motrend_attribution_v1";
const ATTRIBUTION_SYNC_PREFIX = "motrend_attribution_sync_v1_";
const AUTH_GIFT_PROMO_SEEN_KEY = "motrend_auth_gift_prompt_seen_v1";
const AUTH_GIFT_SUCCESS_PENDING_KEY = "motrend_auth_gift_success_pending_v1";
const ATTRIBUTION_UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
];
const ATTRIBUTION_CLICK_ID_KEYS = [
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "yclid",
  "ysclid",
  "ttclid",
];

function sanitizeAttributionValue(value, maxLength = 1500) {
  if (typeof value !== "string") return "";
  const normalized = value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
  if (!normalized) return "";
  return normalized.slice(0, maxLength);
}

function readCookie(name) {
  const source = document.cookie || "";
  if (!source) return "";
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]*)`));
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function parseGaClientId(cookieValue) {
  const normalized = sanitizeAttributionValue(cookieValue, 200);
  if (!normalized) return "";
  const parts = normalized.split(".");
  if (parts.length < 4) return "";
  const first = parts[parts.length - 2];
  const second = parts[parts.length - 1];
  if (!/^\d+$/.test(first) || !/^\d+$/.test(second)) return "";
  return `${first}.${second}`;
}

function readStoredAttribution() {
  try {
    const raw = localStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredAttribution(payload) {
  try {
    localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // no-op
  }
}

function buildAttributionFromRuntime() {
  const url = new URL(window.location.href);
  const query = url.searchParams;

  const utm = {};
  ATTRIBUTION_UTM_KEYS.forEach((key) => {
    const value = sanitizeAttributionValue(query.get(key) || "", 300);
    if (value) {
      utm[key] = value;
    }
  });

  const ids = {};
  ATTRIBUTION_CLICK_ID_KEYS.forEach((key) => {
    const value = sanitizeAttributionValue(query.get(key) || "", 500);
    if (value) {
      ids[key] = value;
    }
  });

  const fbp = sanitizeAttributionValue(readCookie("_fbp"), 300);
  if (fbp) ids.fbp = fbp;

  let fbc = sanitizeAttributionValue(readCookie("_fbc"), 500);
  if (!fbc && ids.fbclid) {
    fbc = `fb.1.${Date.now()}.${ids.fbclid}`;
  }
  if (fbc) ids.fbc = fbc;

  const gaClientId = parseGaClientId(readCookie("_ga"));
  if (gaClientId) ids.ga_client_id = gaClientId;

  const gclAu = sanitizeAttributionValue(readCookie("_gcl_au"), 300);
  if (gclAu) ids.gcl_au = gclAu;

  const ymUid = sanitizeAttributionValue(readCookie("_ym_uid"), 300);
  if (ymUid) ids.ym_uid = ymUid;

  const landingUrl = sanitizeAttributionValue(
    `${url.origin}${url.pathname}${url.search}`,
    1500
  );
  const referrer = sanitizeAttributionValue(document.referrer || "", 1500);
  const capturedAtMs = Date.now();

  return {capturedAtMs, landingUrl, referrer, utm, ids};
}

function mergeAttributionState(prev, next) {
  const prevUtm = prev?.utm && typeof prev.utm === "object" ? prev.utm : {};
  const prevIds = prev?.ids && typeof prev.ids === "object" ? prev.ids : {};
  const nextUtm = next?.utm && typeof next.utm === "object" ? next.utm : {};
  const nextIds = next?.ids && typeof next.ids === "object" ? next.ids : {};

  const merged = {
    capturedAtMs: Number.isFinite(next?.capturedAtMs) ?
      Math.floor(next.capturedAtMs) :
      Date.now(),
    firstCapturedAtMs: Number.isFinite(prev?.firstCapturedAtMs) ?
      Math.floor(prev.firstCapturedAtMs) :
      (Number.isFinite(next?.capturedAtMs) ? Math.floor(next.capturedAtMs) : Date.now()),
    landingUrl: sanitizeAttributionValue(next?.landingUrl || prev?.landingUrl || "", 1500),
    referrer: sanitizeAttributionValue(next?.referrer || prev?.referrer || "", 1500),
    firstLandingUrl: sanitizeAttributionValue(
      prev?.firstLandingUrl || next?.landingUrl || "",
      1500
    ),
    firstReferrer: sanitizeAttributionValue(
      prev?.firstReferrer || next?.referrer || "",
      1500
    ),
    utm: {...prevUtm, ...nextUtm},
    ids: {...prevIds, ...nextIds},
  };

  return merged;
}

function buildAttributionSyncPayload() {
  const currentSnapshot = buildAttributionFromRuntime();
  const previousSnapshot = readStoredAttribution();
  const merged = mergeAttributionState(previousSnapshot, currentSnapshot);
  writeStoredAttribution(merged);

  const hasUtm = Object.keys(merged.utm || {}).length > 0;
  const hasIds = Object.keys(merged.ids || {}).length > 0;
  if (!hasUtm && !hasIds && !merged.landingUrl && !merged.referrer) {
    return null;
  }

  const payload = {
    capturedAtMs: merged.capturedAtMs,
  };
  if (merged.landingUrl) payload.landingUrl = merged.landingUrl;
  if (merged.referrer) payload.referrer = merged.referrer;
  if (hasUtm) payload.utm = merged.utm;
  if (hasIds) payload.ids = merged.ids;

  return payload;
}

function attributionSignature(payload) {
  if (!payload || typeof payload !== "object") return "";
  const utm = payload.utm && typeof payload.utm === "object" ? payload.utm : {};
  const ids = payload.ids && typeof payload.ids === "object" ? payload.ids : {};
  const parts = [];
  for (const key of Object.keys(utm).sort()) {
    parts.push(`u:${key}:${utm[key]}`);
  }
  for (const key of Object.keys(ids).sort()) {
    parts.push(`i:${key}:${ids[key]}`);
  }
  if (payload.landingUrl) parts.push(`l:${payload.landingUrl}`);
  if (payload.referrer) parts.push(`r:${payload.referrer}`);
  return parts.join("|");
}

function lastAttributionSyncKey(uid) {
  return `${ATTRIBUTION_SYNC_PREFIX}${uid}`;
}

async function syncAttributionForUser(uid) {
  const payload = buildAttributionSyncPayload();
  if (!payload) return;
  const signature = attributionSignature(payload);
  if (!signature) return;

  const storageKey = lastAttributionSyncKey(uid);
  try {
    const existingSignature = localStorage.getItem(storageKey);
    if (existingSignature === signature) return;
  } catch {
    // no-op
  }

  await callCreateJob(
    {upsertAttribution: payload},
    {retryable: false, maxAttempts: 1}
  );

  try {
    localStorage.setItem(storageKey, signature);
  } catch {
    // no-op
  }
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

function closeUploadHintIfOpen() {
  const modal = $("uploadHintModal");
  const okBtn = $("btnUploadHintOk");

  if (okBtn && activeUploadHintOkHandler) {
    okBtn.removeEventListener("click", activeUploadHintOkHandler);
  }
  activeUploadHintOkHandler = null;

  if (modal) {
    modal.style.display = "none";
  }

  if (activeUploadHintResolver) {
    const resolve = activeUploadHintResolver;
    activeUploadHintResolver = null;
    resolve(false);
  }
}

function showUploadHint(message) {
  return new Promise((resolve) => {
    const modal = $("uploadHintModal");
    const text = $("uploadHintText");
    const okBtn = $("btnUploadHintOk");

    if (!modal || !text || !okBtn) {
      resolve(false);
      return;
    }

    if (activeUploadHintResolver) {
      closeUploadHintIfOpen();
    }

    const onOk = () => {
      modal.style.display = "none";
      activeUploadHintOkHandler = null;
      const done = activeUploadHintResolver;
      activeUploadHintResolver = null;
      if (done) {
        done(true);
      }
    };

    activeUploadHintResolver = resolve;
    activeUploadHintOkHandler = onOk;
    text.textContent = message;
    modal.style.display = "flex";
    okBtn.addEventListener("click", onOk, {once: true});
  });
}

async function maybeShowUploadHint(key, message) {
  if (shouldUseRedirectLogin()) return;
  if (hasSeenHint(key)) return;
  const confirmed = await showUploadHint(message);
  if (confirmed) {
    markHintSeen(key);
  }
}

function closeNoticeIfOpen(runConfirmAction = false) {
  const modal = $("noticeModal");
  const okBtn = $("btnNoticeOk");

  if (okBtn && activeNoticeOkHandler) {
    okBtn.removeEventListener("click", activeNoticeOkHandler);
  }
  activeNoticeOkHandler = null;

  if (modal) {
    modal.style.display = "none";
  }

  if (runConfirmAction && typeof activeNoticeConfirmAction === "function") {
    const action = activeNoticeConfirmAction;
    activeNoticeConfirmAction = null;
    action();
  } else {
    activeNoticeConfirmAction = null;
  }

  if (activeNoticeResolver) {
    const resolve = activeNoticeResolver;
    activeNoticeResolver = null;
    resolve(false);
  }
}

function showNoticeModal({
  message,
  buttonText = "OK",
  onConfirm = null,
}) {
  return new Promise((resolve) => {
    const modal = $("noticeModal");
    const text = $("noticeText");
    const okBtn = $("btnNoticeOk");

    if (!modal || !text || !okBtn) {
      if (typeof onConfirm === "function") onConfirm();
      resolve(true);
      return;
    }

    if (activeNoticeResolver) {
      closeNoticeIfOpen(false);
    }

    const onOk = () => {
      modal.style.display = "none";
      if (okBtn && activeNoticeOkHandler) {
        okBtn.removeEventListener("click", activeNoticeOkHandler);
      }
      activeNoticeOkHandler = null;
      const confirmAction = activeNoticeConfirmAction;
      activeNoticeConfirmAction = null;
      const done = activeNoticeResolver;
      activeNoticeResolver = null;
      if (typeof confirmAction === "function") {
        confirmAction();
      }
      if (done) {
        done(true);
      }
    };

    activeNoticeResolver = resolve;
    activeNoticeConfirmAction = onConfirm;
    activeNoticeOkHandler = onOk;
    text.textContent = message;
    okBtn.textContent = buttonText;
    modal.style.display = "flex";
    okBtn.addEventListener("click", onOk, {once: true});
  });
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
  if (!currentUser && !getStoredFlag(AUTH_GIFT_PROMO_SEEN_KEY)) {
    setStoredFlag(AUTH_GIFT_PROMO_SEEN_KEY, true);
    setStoredFlag(AUTH_GIFT_SUCCESS_PENDING_KEY, true, sessionStorage);
    void showNoticeModal({
      message: "🎁 Sign in now and get 5 free credits!",
      buttonText: "OK",
      onConfirm: () => openAuth(message),
    });
    return;
  }

  const authBox = $("auth");
  if (authBox) authBox.style.display = "block";
  updateAuthInAppActions();
  if (message) {
    showAuthError(message);
  } else {
    clearAuthError();
  }

  if (authBox) {
    requestAnimationFrame(() => {
      authBox.scrollIntoView({behavior: "smooth", block: "start"});
      setTimeout(() => {
        authBox.scrollIntoView({behavior: "smooth", block: "start"});
      }, 180);
    });
  }

  const emailInput = $("authEmail");
  try {
    emailInput?.focus({preventScroll: true});
  } catch {
    emailInput?.focus();
  }
}

function closeAuth() {
  const authBox = $("auth");
  if (authBox) authBox.style.display = "none";
  clearAuthError();
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

function buildSaveVideoPageUrl(videoUrl) {
  const safeVideoUrl = safeUrl(videoUrl);
  if (!safeVideoUrl) return "";
  const url = new URL("/save-video.html", window.location.origin);
  url.searchParams.set("videoUrl", safeVideoUrl);
  return url.toString();
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

function extractShortfallCredits(error) {
  const details = error?.details;
  if (!details || typeof details !== "object") return null;

  const shortfall = Number(details.shortfallCredits);
  if (Number.isFinite(shortfall) && shortfall > 0) {
    return Math.ceil(shortfall);
  }

  const required = Number(details.requiredCredits);
  const current = Number(details.currentCredits);
  if (
    Number.isFinite(required) &&
    Number.isFinite(current) &&
    required > current
  ) {
    return Math.ceil(required - current);
  }

  return null;
}

function openWallet() {
  setStatus("Wallet is coming soon.");
  setStatusHintVisible(false);
}

function renderCreditsBadge(balance) {
  const creditsEl = $("credits");
  if (!creditsEl) return;

  const numericBalance = Number.isFinite(Number(balance)) ? Number(balance) : 0;
  const normalizedBalance = numericBalance > 0 ? numericBalance : 0;
  creditsEl.textContent = `${normalizedBalance} credits`;
  creditsEl.classList.toggle("isPositive", normalizedBalance > 0);
  creditsEl.classList.toggle("isZero", normalizedBalance <= 0);
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

function createAdminCardElement() {
  const card = document.createElement("div");
  card.className = "card";
  card.id = "adminCard";
  card.style.display = "none";
  card.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px">Admin support</div>
    <div class="grid">
      <div>
        <div class="muted">Support ID</div>
        <input id="adminSupportCode" placeholder="U-XXXXXXXXXX" />
      </div>
      <div style="display:flex;align-items:flex-end">
        <button id="btnFindSupportUser" class="btn">Find user</button>
      </div>
    </div>
    <div id="adminLookupError" class="formError muted" style="display:none" role="alert"></div>
    <div id="adminLookupResult" class="muted adminResult" style="display:none"></div>

    <div id="adminGrantWrap" class="adminGrantWrap" style="display:none">
      <div class="grid">
        <div>
          <div class="muted">Grant credits</div>
          <input id="adminGrantAmount" type="number" min="1" max="500" step="1" value="10" />
        </div>
        <div>
          <div class="muted">Reason</div>
          <input id="adminGrantReason" maxlength="200" placeholder="Support compensation" />
        </div>
      </div>
      <div class="row" style="margin-top:10px">
        <button id="btnGrantCredits" class="btn">Grant credits</button>
      </div>
    </div>
  `;
  const btnFindSupportUser = card.querySelector("#btnFindSupportUser");
  if (btnFindSupportUser) {
    btnFindSupportUser.onclick = handleFindSupportUser;
  }
  const btnGrantCredits = card.querySelector("#btnGrantCredits");
  if (btnGrantCredits) {
    btnGrantCredits.onclick = handleGrantCredits;
  }
  return card;
}

function ensureAdminCard() {
  const existing = $("adminCard");
  if (existing) return existing;

  const userCard = $("userCard");
  if (!userCard?.parentNode) return null;

  const adminCard = createAdminCardElement();
  userCard.insertAdjacentElement("afterend", adminCard);
  return adminCard;
}

function removeAdminCard() {
  const adminCard = $("adminCard");
  if (adminCard) {
    adminCard.remove();
  }
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
  if (!visible) {
    const supportCodeInput = $("adminSupportCode");
    if (supportCodeInput) {
      supportCodeInput.value = "";
    }
    setAdminLookupError("");
    clearAdminLookupResult();
    removeAdminCard();
    return;
  }
  const adminCard = ensureAdminCard();
  if (!adminCard) return;
  adminCard.style.display = "block";
}

let currentUser = null;
let selectedTemplate = null;
let selectedReferenceVideoFile = null;
let selectedReferenceVideoName = "";
let selectedReferenceVideoUploadState = "idle";
const TREND_SELECTION_TEMPLATE = "template";
const TREND_SELECTION_REFERENCE = "reference";
let selectedTrendKind = TREND_SELECTION_TEMPLATE;
let availableTemplates = [];
let unsubscribeUserDoc = null;
let unsubscribeJobs = null;
let latestJobs = [];
const refreshingJobIds = new Set();
const preparingDownloadJobIds = new Set();
const preparedDownloadByJobId = new Map();
let showOlderJobs = false;
let generateSubmissionInFlight = false;
let estimatedProgressActive = false;
let estimatedProgressPercent = 0;
let estimatedProgressTimer = null;
let estimatedProgressJobId = "";
let estimatedProgressStartedAtMs = 0;
let estimatedProgressLabel = "Generating your trend…";
let currentSupportCode = "";
let isAdminUser = false;
let adminSelectedUid = "";
let adminSelectedSupportCode = "";
let activeUploadHintResolver = null;
let activeUploadHintOkHandler = null;
let activeNoticeResolver = null;
let activeNoticeOkHandler = null;
let activeNoticeConfirmAction = null;
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
  "For best results, choose a high-quality photo with clear facial features, visible hands, and a body position that matches the selected reference. Formats: .jpg / .jpeg / .png\n" +
  "File size: ≤10MB.\n" +
  "Dimensions: 300px ~ 65536px";
const VIDEO_HINT_MESSAGE =
  "Supported formats: .mp4 / .mov, file size: ≤100MB, dimensions: 340px ~ 3850px.";
const DEFAULT_VISIBLE_JOBS = 5;
const MAX_WATCH_JOBS = 20;
const PROGRESS_HINT_TEXT = "Usually takes 5–15 minutes";
const PROGRESS_STAGE_A_MS = 64000; // 0-50 slower
const PROGRESS_STAGE_B_MS = 80000; // 50-70 slower
const PROGRESS_STAGE_C_MS = 320000; // 70-90 slower
const PROGRESS_STAGE_D_MS = 42000; // 90-97 slower
const PROGRESS_STAGE_E_MS = 80000; // 97-99: ~1% every 40s

function createClientRequestId(prefix = "req") {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function timestampToMillis(value) {
  if (!value) return NaN;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value);
  if (typeof value?.seconds === "number") {
    const nanos = typeof value?.nanoseconds === "number" ? value.nanoseconds : 0;
    return value.seconds * 1000 + Math.floor(nanos / 1e6);
  }
  return NaN;
}

function computeEstimatedProgressPercent(nowMs, startedAtMs) {
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) return 0;
  const elapsed = Math.max(0, nowMs - startedAtMs);

  if (elapsed <= PROGRESS_STAGE_A_MS) {
    return (elapsed / PROGRESS_STAGE_A_MS) * 50;
  }

  const afterA = elapsed - PROGRESS_STAGE_A_MS;
  if (afterA <= PROGRESS_STAGE_B_MS) {
    return 50 + (afterA / PROGRESS_STAGE_B_MS) * 20;
  }

  const afterB = afterA - PROGRESS_STAGE_B_MS;
  if (afterB <= PROGRESS_STAGE_C_MS) {
    return 70 + (afterB / PROGRESS_STAGE_C_MS) * 20;
  }

  const afterC = afterB - PROGRESS_STAGE_C_MS;
  if (afterC <= PROGRESS_STAGE_D_MS) {
    return 90 + (afterC / PROGRESS_STAGE_D_MS) * 7;
  }
  const afterD = afterC - PROGRESS_STAGE_D_MS;
  if (afterD <= PROGRESS_STAGE_E_MS) {
    return 97 + (afterD / PROGRESS_STAGE_E_MS) * 2;
  }

  return 99;
}

function renderEstimatedProgressStatus() {
  if (!estimatedProgressActive) return;
  if (estimatedProgressStartedAtMs > 0) {
    estimatedProgressPercent = computeEstimatedProgressPercent(
      Date.now(),
      estimatedProgressStartedAtMs
    );
  }
  setStatus(`${estimatedProgressLabel} ${Math.floor(estimatedProgressPercent)}%`);
  setStatusHintVisible(true);
}

function clearEstimatedProgressTimer() {
  if (estimatedProgressTimer) {
    clearTimeout(estimatedProgressTimer);
    estimatedProgressTimer = null;
  }
}

function scheduleEstimatedProgressTick() {
  if (!estimatedProgressActive) return;

  estimatedProgressTimer = setTimeout(() => {
    if (!estimatedProgressActive) return;
    renderEstimatedProgressStatus();
    if (estimatedProgressPercent >= 99) return;
    scheduleEstimatedProgressTick();
  }, 1000);
}

function startEstimatedProgress(label = "Generating your trend…") {
  clearEstimatedProgressTimer();
  estimatedProgressActive = true;
  estimatedProgressPercent = 0;
  estimatedProgressJobId = "";
  estimatedProgressStartedAtMs = Date.now();
  estimatedProgressLabel = label;
  const hint = $("statusHint");
  if (hint) hint.textContent = PROGRESS_HINT_TEXT;
  renderEstimatedProgressStatus();
  scheduleEstimatedProgressTick();
}

function attachEstimatedProgressJob(jobId) {
  estimatedProgressJobId = jobId || "";
}

function resumeEstimatedProgress(jobId, startedAtMs, label = "Generating your trend…") {
  clearEstimatedProgressTimer();
  estimatedProgressActive = true;
  estimatedProgressJobId = jobId || "";
  estimatedProgressStartedAtMs = Number.isFinite(startedAtMs) && startedAtMs > 0 ?
    startedAtMs :
    Date.now();
  estimatedProgressLabel = label;
  const hint = $("statusHint");
  if (hint) hint.textContent = PROGRESS_HINT_TEXT;
  renderEstimatedProgressStatus();
  if (estimatedProgressPercent < 99) {
    scheduleEstimatedProgressTick();
  }
}

function setEstimatedProgressLabel(label) {
  estimatedProgressLabel = label;
  renderEstimatedProgressStatus();
}

function stopEstimatedProgress() {
  clearEstimatedProgressTimer();
  estimatedProgressActive = false;
  estimatedProgressPercent = 0;
  estimatedProgressJobId = "";
  estimatedProgressStartedAtMs = 0;
  estimatedProgressLabel = "Generating your trend…";
  const hint = $("statusHint");
  if (hint) hint.textContent = PROGRESS_HINT_TEXT;
  setStatusHintVisible(false);
}

function completeEstimatedProgress() {
  clearEstimatedProgressTimer();
  estimatedProgressActive = false;
  estimatedProgressPercent = 100;
  estimatedProgressStartedAtMs = 0;
  estimatedProgressLabel = "Generating your trend…";
  const hint = $("statusHint");
  if (hint) hint.textContent = PROGRESS_HINT_TEXT;
  setStatus("Done. Download is ready. 100%");
  setStatusHintVisible(false);
}

function clearTrendSelectionUi() {
  document.querySelectorAll(".tplCard").forEach((el) => {
    el.classList.remove("isSelected");
    el.classList.remove("isHot");
  });
}

function selectTrendCard(cardEl) {
  clearTrendSelectionUi();
  if (!cardEl) return;
  cardEl.classList.add("isSelected");
  cardEl.classList.add("isHot");
}

function buildTemplateSelectionLabel(template) {
  if (!template) return "";
  const title = template.title || "Template";
  const durationSec = template.durationSec ?? "—";
  const mode = template.modeDefault || "std";
  return `${title} (${durationSec}s ${mode})`;
}

function updateSelectedTrendField() {
  const selectedTrendInput = $("selTemplate");
  if (!selectedTrendInput) return;

  if (
    selectedTrendKind === TREND_SELECTION_REFERENCE &&
    selectedReferenceVideoName
  ) {
    selectedTrendInput.value = `Your video reference (${selectedReferenceVideoName})`;
    return;
  }

  selectedTrendInput.value = buildTemplateSelectionLabel(selectedTemplate);
}

function syncTrendSelectionUi() {
  if (
    selectedTrendKind === TREND_SELECTION_REFERENCE &&
    selectedReferenceVideoFile
  ) {
    const referenceCard = document.querySelector(
      ".tplCard[data-trend-role='reference']"
    );
    if (referenceCard) {
      selectTrendCard(referenceCard);
      updateSelectedTrendField();
      return;
    }
  }

  if (selectedTemplate?.id) {
    const templateCards = Array.from(
      document.querySelectorAll(".tplCard[data-template-id]")
    );
    const selectedCard = templateCards.find(
      (el) => el.dataset.templateId === selectedTemplate.id
    );
    if (selectedCard) {
      selectTrendCard(selectedCard);
      updateSelectedTrendField();
      return;
    }
  }

  clearTrendSelectionUi();
  updateSelectedTrendField();
}

function getReferenceVideoMetaPresentation() {
  if (selectedReferenceVideoUploadState === "uploaded") {
    return {
      text: "Your video is uploaded",
      title: selectedReferenceVideoName || "Your video is uploaded",
      state: "uploaded",
    };
  }

  if (selectedReferenceVideoUploadState === "error") {
    return {
      text: "Error",
      title: "Error",
      state: "error",
    };
  }

  return {
    text: selectedReferenceVideoName || "No video selected",
    title: selectedReferenceVideoName || "",
    state: "idle",
  };
}

function refreshReferenceVideoCardUi() {
  const meta = document.querySelector(
    ".tplCard[data-trend-role='reference'] .refMetaName"
  );
  if (!meta) return;

  const presentation = getReferenceVideoMetaPresentation();
  meta.textContent = presentation.text;
  meta.title = presentation.title;
  meta.classList.toggle("isSuccess", presentation.state === "uploaded");
  meta.classList.toggle("isError", presentation.state === "error");
}

function scrollToPhotoUploadField() {

  const fileInput = $("filePhoto");
  const fieldWrap = fileInput?.closest("div");
  const target = fieldWrap || fileInput || $("generateCard") || $("btnGenerate");
  if (!target) return false;

  target.scrollIntoView({behavior: "smooth", block: "center"});
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uploadFileWithProgress(storageRef, blob, metadata, onProgress) {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, blob, metadata);
    task.on(
      "state_changed",
      (snapshot) => {
        if (typeof onProgress !== "function") return;
        const total = Number(snapshot?.totalBytes || 0);
        const transferred = Number(snapshot?.bytesTransferred || 0);
        const percent = total > 0 ?
          Math.max(0, Math.min(100, Math.round((transferred / total) * 100))) :
          0;
        onProgress(percent, snapshot);
      },
      reject,
      () => resolve(task.snapshot)
    );
  });
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
    return (
      message.includes("no available instance") ||
      message.includes("temporarily unavailable")
    );
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

async function callCreateJob(payload, options = {}) {
  const retryable = options.retryable !== false;
  const maxAttempts = retryable ?
    Math.max(1, options.maxAttempts || 4) :
    1;
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

// Capture attribution from URL/cookies on every visit, even before auth.
buildAttributionSyncPayload();

const openExternalAuthBtn = $("btnOpenExternalAuth");
if (openExternalAuthBtn) {
  openExternalAuthBtn.onclick = () => {
    updateAuthInAppActions();
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
    const credential = await createUserWithEmailAndPassword(auth, email, pass);
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
    const result = await signInWithPopup(auth, provider);
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


$("btnWallet").onclick = () => {
  openWallet();
};

async function handleFindSupportUser() {
  if (!currentUser || !isAdminUser) return;
  const input = $("adminSupportCode");
  const btnFindSupportUser = $("btnFindSupportUser");
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
  if (btnFindSupportUser) {
    btnFindSupportUser.disabled = true;
    btnFindSupportUser.innerHTML =
      '<span class="spinner" style="width:12px;height:12px;margin-right:5px;border-width:2px"></span>Searching...';
  }

  try {
    const response = await callCreateJob({findSupportCode: code});
    const payload = response?.data || {};
    renderAdminLookupResult(payload);
    if (input) input.value = code;
  } catch (error) {
    setAdminLookupError(callableErrorMessage(error));
    clearAdminLookupResult();
  } finally {
    if (btnFindSupportUser) {
      btnFindSupportUser.disabled = false;
      btnFindSupportUser.textContent = "Find user";
    }
  }
}

async function handleGrantCredits() {
  if (!currentUser || !isAdminUser || !adminSelectedUid) return;
  const amountInput = $("adminGrantAmount");
  const reasonInput = $("adminGrantReason");
  const btnGrantCredits = $("btnGrantCredits");
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
  if (btnGrantCredits) {
    btnGrantCredits.disabled = true;
    btnGrantCredits.innerHTML =
      '<span class="spinner" style="width:12px;height:12px;margin-right:5px;border-width:2px"></span>Granting...';
  }

  try {
    const response = await callCreateJob({
      grantCredits: true,
      uid: adminSelectedUid,
      amount,
      reason,
    }, {retryable: false});
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
    if (btnGrantCredits) {
      btnGrantCredits.disabled = false;
      btnGrantCredits.textContent = "Grant credits";
    }
  }
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
  card.dataset.trendRole = "reference";

  const media = document.createElement("div");
  media.className = "tplMedia";

  const placeholder = document.createElement("div");
  placeholder.className = "refPlaceholder";
  placeholder.textContent = "Your video reference";
  media.appendChild(placeholder);

  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.style.marginTop = "8px";
  title.textContent = "mp4 / mov,  ≤100MB";

  const meta = document.createElement("div");
  meta.className = "muted refMetaName";
  const initialMeta = getReferenceVideoMetaPresentation();
  meta.textContent = initialMeta.text;
  meta.title = initialMeta.title;
  meta.classList.toggle("isSuccess", initialMeta.state === "uploaded");
  meta.classList.toggle("isError", initialMeta.state === "error");

  const actionBtn = document.createElement("button");
  actionBtn.className = "btn tplUse";
  actionBtn.style.marginTop = "10px";
  actionBtn.style.width = "100%";
  actionBtn.textContent = "Upload";

  const picker = $("fileReferenceVideo");
  let scrollAfterPickerSelection = false;

  const updateReferenceMetaUi = () => {
    const presentation = getReferenceVideoMetaPresentation();
    meta.textContent = presentation.text;
    meta.title = presentation.title;
    meta.classList.toggle("isSuccess", presentation.state === "uploaded");
    meta.classList.toggle("isError", presentation.state === "error");
  };

  const openPicker = async ({enableScrollAfterPick = false} = {}) => {
    if (!currentUser) {
      openAuth("Sign in to upload your reference video.");
      return;
    }
    if (!picker) return;
    clearFormError();
    scrollAfterPickerSelection = enableScrollAfterPick;
    await maybeShowUploadHint(VIDEO_HINT_KEY, VIDEO_HINT_MESSAGE);
    picker.click();
  };

  const activateReferenceSelection = () => {
    if (!selectedReferenceVideoFile) return;
    selectedTrendKind = TREND_SELECTION_REFERENCE;
    if (!selectedTemplate && availableTemplates.length > 0) {
      selectedTemplate = availableTemplates[0];
    }
    syncTrendSelectionUi();
  };

  card.onclick = () => {
    activateReferenceSelection();
    openPicker({enableScrollAfterPick: false});
  };
  actionBtn.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    activateReferenceSelection();
    openPicker({enableScrollAfterPick: true});
  };

  if (picker) {
    picker.onchange = () => {
      const file = picker.files?.[0] || null;
      selectedReferenceVideoFile = file;
      selectedReferenceVideoName = file ? file.name : "";
      selectedReferenceVideoUploadState = "idle";

      if (file) {
        selectedTrendKind = TREND_SELECTION_REFERENCE;
        if (!selectedTemplate && availableTemplates.length > 0) {
          selectedTemplate = availableTemplates[0];
        }
      } else if (selectedTrendKind === TREND_SELECTION_REFERENCE) {
        selectedTrendKind = TREND_SELECTION_TEMPLATE;
      }

      updateReferenceMetaUi();
      syncTrendSelectionUi();
      if (file && scrollAfterPickerSelection) {
        scrollToPhotoUploadField();
      }
      scrollAfterPickerSelection = false;
    };
  }

  card.appendChild(media);
  card.appendChild(title);
  card.appendChild(meta);
  card.appendChild(actionBtn);
  updateReferenceMetaUi();

  return card;
}

function renderTemplateCard(template) {
  const card = document.createElement("div");
  card.className = "card tplCard";
  card.style.margin = "0";
  card.style.cursor = "pointer";
  card.dataset.templateId = template.id;

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

  const selectTemplate = async ({
    toggleAudioOnSameSelection = false,
    scrollOnSelect = false,
  } = {}) => {
    const isSameSelection = selectedTemplate?.id === template.id;

    selectedTemplate = template;
    selectedTrendKind = TREND_SELECTION_TEMPLATE;
    updateSelectedTrendField();
    selectTrendCard(card);

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
    const didScrollToGenerate = scrollOnSelect ?
      scrollToPhotoUploadField() :
      false;
    if (didScrollToGenerate && videoEl) {
      try {
        videoEl.muted = true;
      } catch {
        // no-op
      }
    }
  };

  card.onclick = () => {
    selectTemplate({
      toggleAudioOnSameSelection: true,
      scrollOnSelect: false,
    });
  };

  useBtn.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectTemplate({scrollOnSelect: true});
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
    availableTemplates = snap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));

    if (
      selectedTemplate &&
      !availableTemplates.some((item) => item.id === selectedTemplate.id)
    ) {
      selectedTemplate = null;
      if (selectedTrendKind === TREND_SELECTION_TEMPLATE) {
        updateSelectedTrendField();
      }
    }

    if (
      selectedTrendKind === TREND_SELECTION_REFERENCE &&
      selectedReferenceVideoFile &&
      !selectedTemplate &&
      availableTemplates.length > 0
    ) {
      selectedTemplate = availableTemplates[0];
    }

    container.innerHTML = "";

    if (snap.empty) {
      availableTemplates = [];
      const empty = document.createElement("div");
      empty.className = "templatesLoading muted";
      empty.textContent = "No templates available.";
      container.appendChild(empty);
      container.appendChild(renderReferenceVideoCard());
      syncTrendSelectionUi();
      return;
    }

    availableTemplates.forEach((template) => {
      container.appendChild(renderTemplateCard(template));
    });
    container.appendChild(renderReferenceVideoCard());
    syncTrendSelectionUi();
  } catch (error) {
    container.innerHTML =
      '<div class="templatesLoading muted">Failed to load templates.</div>';
    console.warn(error);
  }
}

function watchUserDoc(uid) {
  return onSnapshot(doc(db, "users", uid), (snap) => {
    const data = snap.data() || {};
    renderCreditsBadge(data.creditsBalance ?? 0);
    $("country").textContent = data.country ?? "—";
    $("lang").textContent = data.language ?? "—";
    if (typeof data.supportCode === "string" && data.supportCode.trim()) {
      setSupportCodeUi(data.supportCode);
    }
  });
}

function statusLabel(status) {
  if (status === "awaiting_upload") return "uploading";
  if (status === "queued") return "queued";
  if (status === "processing") return "processing";
  if (status === "done") return "done";
  if (status === "failed") return "failed";
  return "pending";
}

function getJobStartedAtMs(job) {
  const createdAtMs = timestampToMillis(job?.createdAt);
  if (Number.isFinite(createdAtMs) && createdAtMs > 0) return createdAtMs;
  const updatedAtMs = timestampToMillis(job?.updatedAt);
  if (Number.isFinite(updatedAtMs) && updatedAtMs > 0) return updatedAtMs;
  return Date.now();
}

function resumeEstimatedProgressFromJob(jobId, job) {
  if (!jobId) return;
  const startedAtMs = getJobStartedAtMs(job);
  resumeEstimatedProgress(jobId, startedAtMs, "Generating your trend…");
}

function updateLatestJobUI(jobId, job) {
  const status = job?.status || "";
  const outputUrl = safeUrl(job?.kling?.outputUrl || "");
  const error = job?.kling?.error || "";
  const trackedCurrentJob = (
    estimatedProgressActive &&
    !!estimatedProgressJobId &&
    estimatedProgressJobId === jobId
  );

  if (status === "done" && outputUrl && jobId) {
    if (trackedCurrentJob) {
      completeEstimatedProgress();
    } else {
      setStatus("Done. Download is ready.");
      setStatusHintVisible(false);
    }
    return;
  }

  if (status === "awaiting_upload") {
    if (trackedCurrentJob) {
      setEstimatedProgressLabel("Uploading files…");
    } else {
      setStatus("Uploading files…");
      setStatusHintVisible(false);
    }
  } else if (status === "queued") {
    if (trackedCurrentJob) {
      setEstimatedProgressLabel("Generating your trend…");
    } else {
      resumeEstimatedProgressFromJob(jobId, job);
      setEstimatedProgressLabel("Generating your trend…");
    }
  } else if (status === "processing") {
    if (trackedCurrentJob) {
      setEstimatedProgressLabel("Generating your trend…");
    } else {
      resumeEstimatedProgressFromJob(jobId, job);
      setEstimatedProgressLabel("Generating your trend…");
    }
  } else if (status === "failed") {
    if (trackedCurrentJob) {
      stopEstimatedProgress();
    }
    setStatus(`Failed: ${error || "try another photo/template"}`);
    setStatusHintVisible(false);
  } else {
    if (trackedCurrentJob) {
      stopEstimatedProgress();
    }
    setStatus("");
    setStatusHintVisible(false);
  }
}

function canRefreshJob(job) {
  return job?.status === "queued" || job?.status === "processing";
}

function isDoneWithOutput(item) {
  return (
    item?.data?.status === "done" &&
    !!safeUrl(item?.data?.kling?.outputUrl || "")
  );
}

function prunePreparedDownloadState() {
  const currentIds = new Set(latestJobs.map((item) => item.id));

  for (const jobId of preparedDownloadByJobId.keys()) {
    if (!currentIds.has(jobId)) {
      preparedDownloadByJobId.delete(jobId);
    }
  }

  for (const jobId of [...preparingDownloadJobIds]) {
    if (!currentIds.has(jobId)) {
      preparingDownloadJobIds.delete(jobId);
    }
  }
}

async function handlePrepareDownload(jobId) {
  if (!currentUser || !jobId || preparingDownloadJobIds.has(jobId)) return;

  clearFormError();
  preparingDownloadJobIds.add(jobId);
  renderJobsList();

  try {
    const downloadUrl = await prepareDownloadLink(jobId);
    preparedDownloadByJobId.set(jobId, downloadUrl);
  } catch (error) {
    showFormError(callableErrorMessage(error));
  } finally {
    preparingDownloadJobIds.delete(jobId);
    renderJobsList();
  }
}

function renderDoneJobActions(jobId) {
  const wrapper = document.createElement("div");
  wrapper.style.marginTop = "8px";

  const actions = document.createElement("div");
  actions.className = "jobActions";
  wrapper.appendChild(actions);

  const isPreparing = preparingDownloadJobIds.has(jobId);
  const preparedUrl = safeUrl(preparedDownloadByJobId.get(jobId) || "");
  const saveVideoPageUrl = buildSaveVideoPageUrl(preparedUrl);

  if (!preparedUrl) {
    const prepareBtn = document.createElement("button");
    prepareBtn.className = "btn";
    prepareBtn.disabled = isPreparing;
    if (isPreparing) {
      prepareBtn.innerHTML =
        '<span class="spinner" style="width:12px;height:12px;margin-right:5px;border-width:2px"></span>Preparing...';
    } else {
      prepareBtn.textContent = "Prepare download";
    }
    prepareBtn.onclick = () => {
      handlePrepareDownload(jobId);
    };
    actions.appendChild(prepareBtn);
    return wrapper;
  }

  const downloadBtn = document.createElement("a");
  downloadBtn.className = "btnDownloadPrimary";
  downloadBtn.textContent = "Download";
  downloadBtn.href = preparedUrl;
  downloadBtn.target = "_blank";
  downloadBtn.rel = "noopener noreferrer";
  downloadBtn.download = "";
  actions.appendChild(downloadBtn);

  const orEl = document.createElement("div");
  orEl.className = "jobOr";
  orEl.style.display = "block";
  orEl.textContent = "or";
  actions.appendChild(orEl);

  const openExternalBtn = document.createElement("a");
  openExternalBtn.className = "btn";
  openExternalBtn.textContent = "Open in browser";
  const openTargetUrl = saveVideoPageUrl || preparedUrl;
  openExternalBtn.href = shouldUseRedirectLogin() ?
    buildExternalBrowserUrlFor(openTargetUrl) :
    openTargetUrl;
  openExternalBtn.target = "_blank";
  openExternalBtn.rel = "noopener noreferrer";
  actions.appendChild(openExternalBtn);

  const copyBtn = document.createElement("button");
  copyBtn.className = "btn2";
  copyBtn.textContent = "Copy URL";
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(preparedUrl);
      const originalText = "Copy URL";
      copyBtn.textContent = "URL copied";
      copyBtn.disabled = true;
      setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.disabled = false;
      }, 500);
    } catch {
      showFormError("Unable to copy link. Please copy it manually.");
    }
  };
  actions.appendChild(copyBtn);

  const fallbackHint = document.createElement("div");
  fallbackHint.className = "muted jobsHint";
  fallbackHint.textContent = (
    shouldUseRedirectLogin() && !isAndroid()
  ) ?
    "On iPhone: if download fails, tap Copy URL, paste it into Safari/Chrome, and download there." :
    "If download does not start, tap “Open in browser”.";
  wrapper.appendChild(fallbackHint);

  return wrapper;
}

function renderJobsList() {
  const jobsEl = $("jobs");
  if (!jobsEl) return;

  if (!latestJobs.length) {
    jobsEl.className = "muted";
    jobsEl.textContent = "No trends yet.";
    showOlderJobs = false;
    return;
  }

  jobsEl.className = "";
  prunePreparedDownloadState();
  jobsEl.innerHTML = "";
  const visibleJobs = showOlderJobs ?
    latestJobs :
    latestJobs.slice(0, DEFAULT_VISIBLE_JOBS);

  visibleJobs.forEach((item, index) => {
    const job = item.data || {};
    const itemWrap = document.createElement("div");
    itemWrap.className = "jobItem";

    const row = document.createElement("div");
    row.className = "jobMeta";
    const meta = document.createElement("div");
    const outputUrl = safeUrl(job?.kling?.outputUrl || "");
    const latestMark = index === 0 ? " • Latest" : "";
    meta.textContent =
      `${item.id.slice(0, 6)}… • ${statusLabel(job.status)} ${outputUrl ? "• ✅" : ""}${latestMark}`;
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
          const queuedForRefresh = payload?.queuedForRefresh === true;
          if (queuedForRefresh) {
            const retryAfterMs = (
              typeof payload?.retryAfterMs === "number" &&
              payload.retryAfterMs > 0
            ) ? payload.retryAfterMs : 2000;
            const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
            setStatus(`Refresh queued. Check again in ~${retryAfterSec}s.`);
          }
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

    itemWrap.appendChild(row);

    if (isDoneWithOutput(item)) {
      itemWrap.appendChild(renderDoneJobActions(item.id));
      const retentionHint = document.createElement("div");
      retentionHint.className = "muted jobsHint";
      retentionHint.textContent = "The link to the video is stored for ~30 days.";
      itemWrap.appendChild(retentionHint);
    }

    jobsEl.appendChild(itemWrap);
  });

  if (latestJobs.length > DEFAULT_VISIBLE_JOBS) {
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "btn2 jobsToggle";
    toggleBtn.textContent = showOlderJobs ?
      "Show fewer trends" :
      `Show older trends (${latestJobs.length - DEFAULT_VISIBLE_JOBS})`;
    toggleBtn.onclick = () => {
      showOlderJobs = !showOlderJobs;
      renderJobsList();
    };
    jobsEl.appendChild(toggleBtn);
  }

  const latest = latestJobs[0];
  updateLatestJobUI(latest.id, latest.data);
}

function watchLatestJobs(uid) {
  const qy = query(
    collection(db, "jobs"),
    where("uid", "==", uid),
    orderBy("createdAt", "desc"),
    limit(MAX_WATCH_JOBS)
  );

  return onSnapshot(qy, (snap) => {
    if (snap.empty) {
      latestJobs = [];
      preparedDownloadByJobId.clear();
      preparingDownloadJobIds.clear();
      renderJobsList();
      return;
    }

    latestJobs = snap.docs.map((docSnap) => ({
      id: docSnap.id,
      data: docSnap.data() || {},
    }));
    prunePreparedDownloadState();
    renderJobsList();
  });
}

$("btnGenerate").onclick = async () => {
  clearFormError();

  if (generateSubmissionInFlight) {
    setStatus("Upload already in progress…");
    setStatusHintVisible(false);
    return;
  }

  if (!currentUser) {
    openAuth("Sign in to upload a photo and generate.");
    return;
  }

  if (!selectedTemplate) {
    showFormError("Pick a template first.");
    return;
  }

  if (
    selectedTrendKind === TREND_SELECTION_REFERENCE &&
    !selectedReferenceVideoFile
  ) {
    showFormError("Upload your reference video first.");
    return;
  }

  const rawFile = $("filePhoto").files?.[0];
  if (!rawFile) {
    showFormError("Upload a photo.");
    return;
  }

  const btn = $("btnGenerate");
  generateSubmissionInFlight = true;
  btn.disabled = true;
  stopEstimatedProgress();
  setStatus("Preparing upload…");
  setStatusHintVisible(false);

  try {
    const clientRequestId = createClientRequestId("gen");
    const response = await callCreateJob({
      templateId: selectedTemplate.id,
      clientRequestId,
    });
    const jobId = response.data?.jobId;
    const uploadPath = response.data?.uploadPath;

    if (!jobId || !uploadPath) {
      throw new Error("createJob returned empty payload");
    }
    attachEstimatedProgressJob(jobId);
    setStatus("Uploading files… 0%");

    let referenceVideoPath = "";
    let referenceVideoUrl = "";
    const useReferenceVideo = (
      selectedTrendKind === TREND_SELECTION_REFERENCE &&
      !!selectedReferenceVideoFile
    );
    if (useReferenceVideo && selectedReferenceVideoFile) {
      const preparedVideo = prepareReferenceVideoInput(selectedReferenceVideoFile);
      const uploadDir = uploadPath.replace(/\/[^/]+$/, "");
      referenceVideoPath = `${uploadDir}/reference${preparedVideo.extension}`;

      setStatus("Uploading video… 0%");
      const referenceRef = ref(storage, referenceVideoPath);
      try {
        await uploadFileWithProgress(
          referenceRef,
          preparedVideo.blob,
          {contentType: preparedVideo.contentType},
          (percent) => {
            setStatus(`Uploading video… ${percent}%`);
          }
        );
        referenceVideoUrl = await getDownloadURL(referenceRef);
        selectedReferenceVideoUploadState = "uploaded";
        refreshReferenceVideoCardUi();
      } catch (error) {
        selectedReferenceVideoUploadState = "error";
        refreshReferenceVideoCardUi();
        throw error;
      }
    }

    setStatus("Preparing photo…");
    const uploadInput = await prepareUploadImage(rawFile);

    setStatus("Uploading photo… 0%");
    const photoRef = ref(storage, uploadPath);
    await uploadFileWithProgress(
      photoRef,
      uploadInput.blob,
      {contentType: uploadInput.contentType || "image/jpeg"},
      (percent) => {
        setStatus(`Uploading photo… ${percent}%`);
      }
    );

    const inputImageUrl = await getDownloadURL(photoRef);

    setStatus("Finalizing upload…");
    await callCreateJob({
      finalizeJobId: jobId,
      inputImagePath: uploadPath,
      inputImageUrl,
      referenceVideoPath: referenceVideoPath || undefined,
      referenceVideoUrl: referenceVideoUrl || undefined,
    });

    startEstimatedProgress("Generating your trend…");
    attachEstimatedProgressJob(jobId);
  } catch (error) {
    stopEstimatedProgress();
    setStatus("");
    if (
      selectedTrendKind === TREND_SELECTION_REFERENCE &&
      selectedReferenceVideoFile
    ) {
      selectedReferenceVideoUploadState = "error";
      refreshReferenceVideoCardUi();
    }
    const shortfallCredits = extractShortfallCredits(error);
    if (shortfallCredits !== null) {
      await showNoticeModal({
        message: `You are short ${shortfallCredits} credits`,
        buttonText: "OK",
        onConfirm: () => {
          openWallet();
        },
      });
      return;
    }
    showFormError(callableErrorMessage(error));
  } finally {
    generateSubmissionInFlight = false;
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
    renderCreditsBadge(0);
    $("country").textContent = "—";
    $("lang").textContent = "—";
    selectedTemplate = null;
    selectedTrendKind = TREND_SELECTION_TEMPLATE;
    availableTemplates = [];
    stopEstimatedProgress();
    updateSelectedTrendField();
    selectedReferenceVideoFile = null;
    selectedReferenceVideoName = "";
    selectedReferenceVideoUploadState = "idle";
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
    setStatus("");
    latestJobs = [];
    refreshingJobIds.clear();
    preparingDownloadJobIds.clear();
    preparedDownloadByJobId.clear();
    showOlderJobs = false;
    renderJobsList();

    await loadTemplates();
    $("jobs").textContent = "Sign in to see your trends.";
    return;
  }

  closeAuth();
  stopEstimatedProgress();
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

  void syncAttributionForUser(user.uid).catch((error) => {
    console.warn("attribution sync failed", error);
  });

  await syncSupportProfile();

  await loadTemplates();
  unsubscribeUserDoc = watchUserDoc(user.uid);
  unsubscribeJobs = watchLatestJobs(user.uid);

  if (getStoredFlag(AUTH_GIFT_SUCCESS_PENDING_KEY, sessionStorage)) {
    setStoredFlag(AUTH_GIFT_SUCCESS_PENDING_KEY, false, sessionStorage);
    void showNoticeModal({
      message: "🎁 You've received 5 free credits!",
      buttonText: "OK",
    });
  }
});
