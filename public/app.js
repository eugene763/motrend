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

function setStatusHintVisible(visible) {
  const hint = $("statusHint");
  if (!hint) return;
  hint.style.display = visible ? "block" : "none";
}

const ATTRIBUTION_STORAGE_KEY = "motrend_attribution_v1";
const ATTRIBUTION_SYNC_PREFIX = "motrend_attribution_sync_v1_";
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
    if (onboardingIsOpen) {
      resolve(false);
      return;
    }
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
  if (onboardingIsOpen) return;
  if (shouldUseRedirectLogin()) return;
  if (hasSeenHint(key)) return;
  const confirmed = await showUploadHint(message);
  if (confirmed) {
    markHintSeen(key);
  }
}

function onboardingSeenKey(uid) {
  return `${ONBOARDING_SEEN_PREFIX}${uid}`;
}

function hasSeenOnboarding(uid) {
  if (!uid) return true;
  try {
    return localStorage.getItem(onboardingSeenKey(uid)) === "1";
  } catch {
    return false;
  }
}

function markOnboardingSeen(uid) {
  if (!uid) return;
  try {
    localStorage.setItem(onboardingSeenKey(uid), "1");
  } catch {
    // no-op
  }
}

function markPendingOnboarding(uid = "") {
  try {
    const payload = {ts: Date.now(), uid: uid || ""};
    sessionStorage.setItem(ONBOARDING_PENDING_KEY, JSON.stringify(payload));
  } catch {
    // no-op
  }
}

function consumePendingOnboarding(expectedUid = "") {
  try {
    const raw = sessionStorage.getItem(ONBOARDING_PENDING_KEY);
    if (!raw) return false;
    sessionStorage.removeItem(ONBOARDING_PENDING_KEY);
    let ts = Number(raw);
    let pendingUid = "";
    if (!Number.isFinite(ts)) {
      const parsed = JSON.parse(raw);
      ts = Number(parsed?.ts);
      pendingUid = typeof parsed?.uid === "string" ? parsed.uid : "";
    }
    if (!Number.isFinite(ts)) return false;
    if (expectedUid && pendingUid && pendingUid !== expectedUid) return false;
    return Date.now() - ts <= ONBOARDING_PENDING_TTL_MS;
  } catch {
    return false;
  }
}

function isLikelyNewUser(user) {
  const createdAt = Date.parse(user?.metadata?.creationTime || "");
  const lastSignInAt = Date.parse(user?.metadata?.lastSignInTime || "");
  if (!Number.isFinite(createdAt) || !Number.isFinite(lastSignInAt)) {
    return false;
  }
  return Math.abs(lastSignInAt - createdAt) <= 2 * 60 * 1000;
}

function clearOnboardingHighlight() {
  if (onboardingHighlightRafId) {
    cancelAnimationFrame(onboardingHighlightRafId);
    onboardingHighlightRafId = 0;
  }
  const highlight = $("onboardingHighlight");
  if (highlight) {
    highlight.style.display = "none";
  }
  onboardingTargetEl = null;
}

function refreshOnboardingHighlight() {
  if (!onboardingIsOpen || !(onboardingTargetEl instanceof HTMLElement)) {
    clearOnboardingHighlight();
    return;
  }
  const highlight = $("onboardingHighlight");
  if (!highlight) return;

  const rect = onboardingTargetEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    highlight.style.display = "none";
    return;
  }

  const pad = 6;
  const left = Math.max(8, rect.left - pad);
  const top = Math.max(8, rect.top - pad);
  const maxWidth = window.innerWidth - left - 8;
  const maxHeight = window.innerHeight - top - 8;
  const width = Math.max(24, Math.min(rect.width + pad * 2, maxWidth));
  const height = Math.max(24, Math.min(rect.height + pad * 2, maxHeight));

  highlight.style.left = `${left}px`;
  highlight.style.top = `${top}px`;
  highlight.style.width = `${width}px`;
  highlight.style.height = `${height}px`;
  highlight.style.display = "block";
}

function scheduleOnboardingHighlightRefresh() {
  if (onboardingHighlightRafId) {
    cancelAnimationFrame(onboardingHighlightRafId);
  }
  onboardingHighlightRafId = requestAnimationFrame(() => {
    onboardingHighlightRafId = 0;
    refreshOnboardingHighlight();
  });
}

function scrollOnboardingTargetIntoView(target, behavior = "smooth") {
  if (!(target instanceof HTMLElement)) return;
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const overlayCard = document.querySelector("#onboardingOverlay .onboardingCard");
  const bottomReserved = (overlayCard?.offsetHeight || 0) + 24;
  const topSafe = 20;
  const viewportHeight = Math.max(window.innerHeight || 0, 1);
  const visibleTop = topSafe;
  const visibleBottom = Math.max(topSafe + 60, viewportHeight - bottomReserved);
  const isVisible = rect.top >= visibleTop && rect.bottom <= visibleBottom;
  if (isVisible) return;

  const scrollY = window.scrollY || window.pageYOffset || 0;
  const targetCenterY = scrollY + rect.top + rect.height / 2;
  const visibleCenterY = (visibleTop + visibleBottom) / 2;
  const desiredTop = Math.max(0, targetCenterY - visibleCenterY);
  window.scrollTo({top: desiredTop, behavior});
}

function buildOnboardingDots(activeIndex) {
  const dotsEl = $("onboardingDots");
  if (!dotsEl) return;
  dotsEl.innerHTML = "";
  ONBOARDING_STEPS.forEach((_, idx) => {
    const dot = document.createElement("span");
    dot.className = idx === activeIndex ? "onboardingDot isActive" : "onboardingDot";
    dotsEl.appendChild(dot);
  });
}

function renderOnboardingStep() {
  const titleEl = $("onboardingStepTitle");
  const textEl = $("onboardingStepText");
  const prevBtn = $("onboardingPrevBtn");
  const nextBtn = $("onboardingNextBtn");
  const closeStepBtn = $("onboardingStepCloseBtn");
  if (!titleEl || !textEl || !prevBtn || !nextBtn || !closeStepBtn) return;

  const step = ONBOARDING_STEPS[onboardingStepIndex];
  if (!step) return;

  titleEl.textContent = step.title;
  textEl.textContent = step.text;
  buildOnboardingDots(onboardingStepIndex);

  const isFirst = onboardingStepIndex === 0;
  const isLast = onboardingStepIndex === ONBOARDING_STEPS.length - 1;
  prevBtn.style.visibility = isFirst ? "hidden" : "visible";
  prevBtn.disabled = isFirst;
  nextBtn.style.display = isLast ? "none" : "inline-flex";
  nextBtn.disabled = isLast;
  closeStepBtn.style.display = isLast ? "inline-flex" : "none";

  clearOnboardingHighlight();
  const target = step.getTarget();
  if (!(target instanceof HTMLElement)) return;
  scrollOnboardingTargetIntoView(target, "smooth");
  onboardingTargetEl = target;
  scheduleOnboardingHighlightRefresh();
  setTimeout(() => {
    if (!onboardingIsOpen || onboardingTargetEl !== target) return;
    scrollOnboardingTargetIntoView(target, "auto");
    refreshOnboardingHighlight();
  }, 260);
  requestAnimationFrame(() => {
    if (!onboardingIsOpen || onboardingTargetEl !== target) return;
    refreshOnboardingHighlight();
  });
}

function closeOnboarding(markSeen = true) {
  const overlay = $("onboardingOverlay");
  if (!overlay) return;
  overlay.classList.remove("isOpen");
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("onboardingActive");
  clearOnboardingHighlight();
  onboardingIsOpen = false;
  onboardingStepIndex = 0;
  const uid = overlay.dataset.uid || "";
  if (markSeen && uid) {
    markOnboardingSeen(uid);
  }
  if (markSeen) {
    window.scrollTo({top: 0, behavior: "smooth"});
  }
  overlay.dataset.uid = "";
}

function openOnboarding(uid) {
  if (!uid || onboardingIsOpen) return;
  const overlay = $("onboardingOverlay");
  if (!overlay) return;

  closeUploadHintIfOpen();
  overlay.dataset.uid = uid;
  overlay.classList.add("isOpen");
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("onboardingActive");
  onboardingIsOpen = true;
  onboardingStepIndex = 0;
  renderOnboardingStep();
}

function maybeStartOnboarding(user) {
  if (!user?.uid || onboardingIsOpen || hasSeenOnboarding(user.uid)) return;
  const pendingFromRegistration = consumePendingOnboarding(user.uid);
  if (!pendingFromRegistration && !isLikelyNewUser(user)) return;
  openOnboarding(user.uid);
}

function refreshOnboardingStepTarget() {
  if (!onboardingIsOpen) return;
  renderOnboardingStep();
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
let onboardingIsOpen = false;
let onboardingStepIndex = 0;
let onboardingTargetEl = null;
let onboardingHighlightRafId = 0;
const PREPARE_DOWNLOAD_MAX_ATTEMPTS = 8;
const MAX_UPLOAD_IMAGE_BYTES = 40 * 1024 * 1024;
const TARGET_UPLOAD_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_UPLOAD_IMAGE_DIMENSION = 1080;
const MIN_UPLOAD_IMAGE_DIMENSION = 960;
const UPLOAD_IMAGE_QUALITY_STEPS = [0.9, 0.85, 0.8, 0.75, 0.7, 0.65];
const MAX_REFERENCE_VIDEO_BYTES = 200 * 1024 * 1024;
const PHOTO_HINT_KEY = "motrend_photo_hint_v1";
const VIDEO_HINT_KEY = "motrend_video_hint_v1";
const ONBOARDING_SEEN_PREFIX = "motrend_onboarding_seen_v1_";
const ONBOARDING_PENDING_KEY = "motrend_onboarding_pending_v1";
const ONBOARDING_PENDING_TTL_MS = 20 * 60 * 1000;
const PHOTO_HINT_MESSAGE =
  "For best results, choose a high-quality photo with clear facial features, visible hands, and a body position that matches the selected reference. Formats: .jpg / .jpeg / .png\n" +
  "File size: ≤10MB.\n" +
  "Dimensions: 300px ~ 65536px";
const VIDEO_HINT_MESSAGE =
  "Supported formats: .mp4 / .mov, file size: ≤100MB, dimensions: 340px ~ 3850px.";
const DEFAULT_VISIBLE_JOBS = 5;
const MAX_WATCH_JOBS = 20;
const PROGRESS_HINT_TEXT = "Usually takes 5–15 minutes";
const PROGRESS_STAGE_A_MS = 32000; // 0-50 quickly
const PROGRESS_STAGE_B_MS = 40000; // 50-70 medium
const PROGRESS_STAGE_C_MS = 160000; // 70-90 slowly
const PROGRESS_STAGE_D_MS = 21000; // 90-97 faster

const ONBOARDING_STEPS = [
  {
    title: "1. Choose trend",
    text: "Tap Use or Upload to select your reference.",
    getTarget: () =>
      document.querySelector("#templates .tplCard.isSelected .tplUse") ||
      document.querySelector("#templates .tplCard .tplUse") ||
      $("templates"),
  },
  {
    title: "2. Choose your photo",
    text: "Upload your photo from the device gallery.",
    getTarget: () => {
      const fileInput = $("filePhoto");
      if (!fileInput) return null;
      return fileInput.closest("div") || fileInput;
    },
  },
  {
    title: "3. Generate your trend",
    text: "Tap Generate and wait for completion.",
    getTarget: () => $("btnGenerate"),
  },
];

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

  return 97;
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
    if (estimatedProgressPercent >= 97) return;
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
  if (estimatedProgressPercent < 97) {
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

function scrollToGenerateOnMobile() {
  if (!window.matchMedia("(max-width: 640px)").matches) return false;
  const generateCard = $("generateCard") || $("btnGenerate")?.closest(".card");
  generateCard?.scrollIntoView({behavior: "smooth", block: "start"});
  return true;
}

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

const onboardingPrevBtn = $("onboardingPrevBtn");
if (onboardingPrevBtn) {
  onboardingPrevBtn.onclick = () => {
    if (!onboardingIsOpen || onboardingStepIndex <= 0) return;
    onboardingStepIndex -= 1;
    renderOnboardingStep();
  };
}

const onboardingNextBtn = $("onboardingNextBtn");
if (onboardingNextBtn) {
  onboardingNextBtn.onclick = () => {
    if (!onboardingIsOpen) return;
    if (onboardingStepIndex >= ONBOARDING_STEPS.length - 1) return;
    onboardingStepIndex += 1;
    renderOnboardingStep();
  };
}

const onboardingStepCloseBtn = $("onboardingStepCloseBtn");
if (onboardingStepCloseBtn) {
  onboardingStepCloseBtn.onclick = () => {
    closeOnboarding(true);
  };
}

const onboardingCloseBtn = $("onboardingCloseBtn");
if (onboardingCloseBtn) {
  onboardingCloseBtn.onclick = () => {
    closeOnboarding(true);
  };
}

window.addEventListener("resize", () => {
  if (!onboardingIsOpen) return;
  if (onboardingTargetEl instanceof HTMLElement) {
    scrollOnboardingTargetIntoView(onboardingTargetEl, "auto");
  }
  scheduleOnboardingHighlightRefresh();
});
window.addEventListener("scroll", () => {
  if (!onboardingIsOpen) return;
  scheduleOnboardingHighlightRefresh();
}, true);

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
    markPendingOnboarding(credential?.user?.uid || "");
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
    if (isLikelyNewUser(result?.user)) {
      markPendingOnboarding(result?.user?.uid || "");
    }
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
  setStatus("Wallet is coming soon.");
  setStatusHintVisible(false);
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
  meta.textContent = selectedReferenceVideoName || "No video selected";

  const actionBtn = document.createElement("button");
  actionBtn.className = "btn tplUse";
  actionBtn.style.marginTop = "10px";
  actionBtn.style.width = "100%";
  actionBtn.textContent = "Upload";

  const picker = $("fileReferenceVideo");
  let scrollAfterPickerSelection = false;

  const updateReferenceMetaUi = () => {
    meta.textContent = selectedReferenceVideoName || "No video selected";
    meta.title = selectedReferenceVideoName || "";
  };

  const openPicker = async ({enableScrollAfterPick = false} = {}) => {
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
    if (onboardingStepIndex === 0) {
      refreshOnboardingStepTarget();
    }
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
      if (onboardingStepIndex === 0) {
        refreshOnboardingStepTarget();
      }
      if (file && scrollAfterPickerSelection) {
        scrollToGenerateOnMobile();
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
    const didScrollToGenerate = scrollOnSelect ? scrollToGenerateOnMobile() : false;
    if (didScrollToGenerate && videoEl) {
      try {
        videoEl.muted = true;
      } catch {
        // no-op
      }
    }
    if (onboardingStepIndex === 0) {
      refreshOnboardingStepTarget();
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

  if (status === "queued") {
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
  openExternalBtn.href = saveVideoPageUrl || preparedUrl;
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
  fallbackHint.textContent =
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
  btn.disabled = true;
  startEstimatedProgress("Generating your trend…");

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

      setEstimatedProgressLabel("Video download");
      const referenceRef = ref(storage, referenceVideoPath);
      await uploadBytes(referenceRef, preparedVideo.blob, {
        contentType: preparedVideo.contentType,
      });
      referenceVideoUrl = await getDownloadURL(referenceRef);
    }

    setEstimatedProgressLabel("Preparing photo…");
    const uploadInput = await prepareUploadImage(rawFile);

    setEstimatedProgressLabel("Uploading photo…");
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

    setEstimatedProgressLabel("Generating your trend…");
  } catch (error) {
    stopEstimatedProgress();
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
  const redirectResult = await getRedirectResult(auth);
  if (isLikelyNewUser(redirectResult?.user)) {
    markPendingOnboarding(redirectResult?.user?.uid || "");
  }
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
    selectedTemplate = null;
    selectedTrendKind = TREND_SELECTION_TEMPLATE;
    availableTemplates = [];
    stopEstimatedProgress();
    updateSelectedTrendField();
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
    setStatus("");
    latestJobs = [];
    refreshingJobIds.clear();
    preparingDownloadJobIds.clear();
    preparedDownloadByJobId.clear();
    showOlderJobs = false;
    closeOnboarding(false);
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
  requestAnimationFrame(() => {
    maybeStartOnboarding(user);
  });
  unsubscribeUserDoc = watchUserDoc(user.uid);
  unsubscribeJobs = watchLatestJobs(user.uid);
});
