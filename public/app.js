import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAnalytics,
  logEvent,
  setUserId,
  setUserProperties,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js";
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  getRedirectResult,
  getAuth,
  indexedDBLocalPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithRedirect,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getStorage,
  ref,
  uploadBytesResumable,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

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
const storage = getStorage(app);
const AUTH_PERSISTENCE_CANDIDATES = [
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
];

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
const PLATFORM_API_ORIGIN_OVERRIDE_KEY = "motrend_platform_api_origin_v1";
const MOTREND_TEST_GIFT_CREDITS = 20;
const PLATFORM_REQUEST_TIMEOUT_MS = 30_000;
const PLATFORM_LOGOUT_TIMEOUT_MS = 5_000;
const PLATFORM_POLL_AUTH_RETRY_MS = 2_500;
const PLATFORM_POLL_ERROR_RETRY_MS = 5_000;
const PLATFORM_POLL_MAX_BACKOFF_MS = 60_000;
const PLATFORM_API_ALLOWED_ORIGINS = new Set([
  "https://api.moads.agency",
  "https://api-dev.moads.agency",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);
const GIFT_CREDITS_PENDING_KEY = "motrend_gift_credits_pending_v1";
const GIFT_CREDITS_AMOUNT_KEY = "motrend_gift_credits_amount_v1";

function normalizeOriginCandidate(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
}

function clearStoredPlatformApiOriginOverride() {
  try {
    localStorage.removeItem(PLATFORM_API_ORIGIN_OVERRIDE_KEY);
  } catch {
    // no-op
  }
}

function stripPlatformApiQueryParam() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("platformApi")) return;
    url.searchParams.delete("platformApi");
    window.history.replaceState(null, "", url.toString());
  } catch {
    // no-op
  }
}

function isAllowedPlatformApiOrigin(origin) {
  return PLATFORM_API_ALLOWED_ORIGINS.has(origin);
}

function resolvePlatformApiOrigin() {
  const url = new URL(window.location.href);
  const queryOverride = normalizeOriginCandidate(
    url.searchParams.get("platformApi") || ""
  );
  if (queryOverride) {
    stripPlatformApiQueryParam();
    if (isAllowedPlatformApiOrigin(queryOverride)) {
      try {
        localStorage.setItem(PLATFORM_API_ORIGIN_OVERRIDE_KEY, queryOverride);
      } catch {
        // no-op
      }
      return queryOverride;
    }
  }

  try {
    const storedOverride = normalizeOriginCandidate(
      localStorage.getItem(PLATFORM_API_ORIGIN_OVERRIDE_KEY) || ""
    );
    if (storedOverride && isAllowedPlatformApiOrigin(storedOverride)) {
      return storedOverride;
    }
    clearStoredPlatformApiOriginOverride();
  } catch {
    // no-op
  }

  if (runtimeHost === "localhost" || runtimeHost === "127.0.0.1") {
    return "http://localhost:8080";
  }

  if (
    runtimeHost.endsWith(".moads.agency") ||
    runtimeHost.endsWith(".web.app") ||
    runtimeHost.endsWith(".firebaseapp.com")
  ) {
    return "https://api.moads.agency";
  }

  return "";
}

const platformApiOrigin = resolvePlatformApiOrigin();
const platformApiBaseUrl = platformApiOrigin.replace(/\/+$/, "");
const platformApiEnabled = Boolean(platformApiBaseUrl);

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

function isIOS() {
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/i.test(ua);
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

function getStoredNumber(key, storage = localStorage) {
  try {
    const value = storage.getItem(key);
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function setStoredNumber(key, value, storage = localStorage) {
  try {
    if (Number.isFinite(value)) {
      storage.setItem(key, String(value));
    } else {
      storage.removeItem(key);
    }
  } catch {
    // no-op
  }
}

function getReferenceVideoUploadNoticeKey(uid = "") {
  const cleanUid = typeof uid === "string" ? uid.trim() : "";
  return cleanUid ?
    `motrend_reference_video_upload_notice_seen_${cleanUid}` :
    "motrend_reference_video_upload_notice_seen_v1";
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

function setStatusHintText(text) {
  const hint = $("statusHint");
  if (!hint) return;
  hint.textContent = text || PROGRESS_HINT_TEXT;
}

function setUploadSafetyHint(message = "", visible = false) {
  const hint = $("uploadSafetyHint");
  if (!hint) return;
  hint.textContent = message;
  hint.style.display = visible && message ? "block" : "none";
}

const ATTRIBUTION_STORAGE_KEY = "motrend_attribution_v1";
const ATTRIBUTION_SYNC_PREFIX = "motrend_attribution_sync_v1_";
const AUTH_GIFT_PROMO_SEEN_KEY = "motrend_auth_gift_prompt_seen_v1";
const AUTH_ATTEMPT_COOKIE_KEY = "motrend_auth_attempted_v1";
const AUTH_SUCCESS_COOKIE_KEY = "motrend_auth_success_v1";
const AUTH_STATE_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
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

function writeCookie(name, value, {
  maxAgeSeconds = AUTH_STATE_COOKIE_MAX_AGE_SECONDS,
  path = "/",
} = {}) {
  if (!name) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${encodeURIComponent(name)}=${encodeURIComponent(value || "")}; Path=${path}; Max-Age=${Math.max(0, Number(maxAgeSeconds) || 0)}; SameSite=Lax${secure}`;
}

function clearCookie(name) {
  if (!name) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

function hasAuthAttemptCookie() {
  return readCookie(AUTH_ATTEMPT_COOKIE_KEY) === "1";
}

function hasAuthSuccessCookie() {
  return readCookie(AUTH_SUCCESS_COOKIE_KEY) === "1";
}

function markAuthAttemptCookie() {
  writeCookie(AUTH_ATTEMPT_COOKIE_KEY, "1");
}

function clearAuthAttemptCookie() {
  clearCookie(AUTH_ATTEMPT_COOKIE_KEY);
}

function markAuthSuccessCookie() {
  writeCookie(AUTH_SUCCESS_COOKIE_KEY, "1");
}

function clearAuthSuccessCookie() {
  clearCookie(AUTH_SUCCESS_COOKIE_KEY);
}

function shouldKeepAuthOpenAfterAttempt() {
  return hasAuthAttemptCookie() && !hasAuthSuccessCookie();
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
  if (!payload || !platformApiEnabled || !uid) return;
  const signature = attributionSignature(payload);
  if (!signature) return;

  const storageKey = lastAttributionSyncKey(uid);
  try {
    const existingSignature = localStorage.getItem(storageKey);
    if (existingSignature === signature) return;
  } catch {
    // no-op
  }

  await platformAnalyticsRequest("/analytics/attribution", {
    method: "POST",
    body: payload,
  });

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

function wasJobNoticeShown(jobId) {
  if (!jobId) return false;
  try {
    return localStorage.getItem(`${JOB_NOTICE_SEEN_PREFIX}${jobId}`) === "1";
  } catch {
    return false;
  }
}

function markJobNoticeShown(jobId) {
  if (!jobId) return;
  try {
    localStorage.setItem(`${JOB_NOTICE_SEEN_PREFIX}${jobId}`, "1");
  } catch {
    // no-op
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
    `Hi, I need help with MoTrend. Support ID: ${cleanCode}.` :
    "Hi, I need help with MoTrend.";

  btn.href = `${baseUrl}?text=${encodeURIComponent(text)}`;
}

function openAuth(message = "", {skipPromo = false} = {}) {
  if (!skipPromo && !currentUser && !getStoredFlag(AUTH_GIFT_PROMO_SEEN_KEY)) {
    setStoredFlag(AUTH_GIFT_PROMO_SEEN_KEY, true);
    void showNoticeModal({
      message: `🎁 Sign up and get ${MOTREND_TEST_GIFT_CREDITS} free credits!`,
      buttonText: "OK",
      onConfirm: () => openAuth(message, {skipPromo}),
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

function buildPlatformUrl(path) {
  if (!platformApiBaseUrl) return "";
  if (typeof path !== "string" || !path) return platformApiBaseUrl;
  return `${platformApiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function createPlatformRequestError(message, payload = null, status = 0, code = "") {
  const error = new Error(message || "Platform request failed.");
  error.platformPayload = payload;
  error.platformStatus = status;
  error.code = code;
  error.details = payload?.error?.details || payload?.details || null;
  return error;
}

async function platformRequest(path, options = {}) {
  if (!platformApiEnabled) {
    throw createPlatformRequestError("Platform API is not configured.");
  }

  const headers = {
    Accept: "application/json",
    ...(options.headers || {}),
  };
  let body = options.body;
  if (body !== undefined && body !== null && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PLATFORM_REQUEST_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(buildPlatformUrl(path), {
      method: options.method || "GET",
      credentials: "include",
      headers,
      body,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createPlatformRequestError(
        "Platform request timed out.",
        null,
        0,
        "platform_timeout"
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 204) {
    return null;
  }

  const rawText = await response.text();
  let payload = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = rawText;
    }
  }

  if (!response.ok) {
    const message = payload?.error?.message ||
      payload?.message ||
      `Platform request failed (${response.status}).`;
    const code = payload?.error?.code || payload?.code || "";
    throw createPlatformRequestError(message, payload, response.status, code);
  }

  return payload;
}

function clearPlatformSessionState() {
  currentPlatformBootstrap = null;
  currentPlatformSession = null;
  currentPlatformMotrendProfile = null;
  platformBootstrapPromise = null;
  platformBootstrapPromiseUid = "";
  platformReauthPromise = null;
  publicShareByJobId.clear();
  publicSharePromiseByJobId.clear();
}

async function restorePlatformSessionFromCookie(user = currentUser) {
  if (!platformApiEnabled) {
    return null;
  }

  try {
    const [session, motrendProfile] = await Promise.all([
      platformRequest("/auth/me"),
      platformRequest("/motrend/me"),
    ]);

    const sessionFirebaseUid = typeof session?.user?.firebaseUid === "string" ?
      session.user.firebaseUid :
      "";
    if (user?.uid && sessionFirebaseUid && sessionFirebaseUid !== user.uid) {
      try {
        await platformRequest("/auth/session-logout", {
          method: "POST",
        });
      } catch {
        // no-op
      }
      clearPlatformSessionState();
      return null;
    }

    currentPlatformSession = session;
    currentPlatformMotrendProfile = motrendProfile;
    return {
      bootstrap: null,
      session,
      motrendProfile,
      restoredFromCookie: true,
    };
  } catch (error) {
    if (!isPlatformAuthError(error) && Number(error?.platformStatus || 0) !== 401) {
      console.warn("platform cookie restore failed", error);
    }
    return null;
  }
}

function buildBootstrapMotrendProfile(bootstrap = currentPlatformBootstrap) {
  if (!bootstrap || typeof bootstrap !== "object") {
    return null;
  }

  const supportCode = typeof bootstrap?.supportCode === "string" ?
    bootstrap.supportCode.trim() :
    "";
  const creditsBalance = Number(bootstrap?.wallet?.balance);
  const walletId = typeof bootstrap?.wallet?.walletId === "string" ?
    bootstrap.wallet.walletId :
    "";

  if (!supportCode && !Number.isFinite(creditsBalance) && !walletId) {
    return null;
  }

  return {
    supportCode,
    creditsBalance: Number.isFinite(creditsBalance) ? creditsBalance : 0,
    walletId,
    country: null,
    language: null,
    isAdmin: false,
  };
}

function resolveKnownSupportCode(profile = null) {
  const candidates = [
    profile?.supportCode,
    currentPlatformMotrendProfile?.supportCode,
    currentPlatformBootstrap?.supportCode,
    currentSupportCode,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim().toUpperCase();
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

async function bootstrapPlatformSession(user) {
  if (!user || !platformApiEnabled) {
    clearPlatformSessionState();
    return null;
  }

  const bootstrapUid = typeof user.uid === "string" ? user.uid : "";
  if (!bootstrapUid || !currentUser || currentUser.uid !== bootstrapUid) {
    return null;
  }

  const restored = await restorePlatformSessionFromCookie(user);
  if (restored) {
    return restored;
  }

  const idToken = await user.getIdToken();

  const bootstrap = await platformRequest("/auth/session-login", {
    method: "POST",
    body: {idToken},
  });
  if (!currentUser || currentUser.uid !== bootstrapUid) {
    return null;
  }

  currentPlatformBootstrap = bootstrap;

  const [sessionResult, motrendProfileResult] = await Promise.allSettled([
    platformRequest("/auth/me"),
    platformRequest("/motrend/me"),
  ]);
  if (!currentUser || currentUser.uid !== bootstrapUid) {
    return null;
  }

  currentPlatformSession = sessionResult.status === "fulfilled" ?
    sessionResult.value :
    null;
  currentPlatformMotrendProfile = motrendProfileResult.status === "fulfilled" ?
    motrendProfileResult.value :
    buildBootstrapMotrendProfile(bootstrap);

  if (sessionResult.status === "rejected") {
    console.warn("platform auth/me failed", sessionResult.reason);
  }
  if (motrendProfileResult.status === "rejected") {
    console.warn("platform motrend/me failed", motrendProfileResult.reason);
  }

  return {
    bootstrap,
    session: currentPlatformSession,
    motrendProfile: currentPlatformMotrendProfile,
  };
}

async function logoutPlatformSession() {
  if (!platformApiEnabled) {
    clearPlatformSessionState();
    return;
  }

  try {
    await platformRequest("/auth/session-logout", {
      method: "POST",
    });
  } catch (error) {
    console.warn("platform session logout failed", error);
  } finally {
    clearPlatformSessionState();
  }
}

function getErrorDetails(error) {
  const directDetails = error?.details;
  if (directDetails && typeof directDetails === "object") {
    return directDetails;
  }

  const payloadDetails = error?.platformPayload?.error?.details ||
    error?.platformPayload?.details;
  if (payloadDetails && typeof payloadDetails === "object") {
    return payloadDetails;
  }

  return null;
}

function isPlatformAuthError(error) {
  const code = typeof error?.code === "string" ? error.code.toLowerCase() : "";
  const status = Number(error?.platformStatus);
  return (
    status === 401 ||
    code === "unauthenticated" ||
    code === "identity_not_bootstrapped"
  );
}

function hasPlatformCabinetSession() {
  return Boolean(currentPlatformSession && currentPlatformMotrendProfile);
}

async function ensurePlatformMotrendSession({force = false} = {}) {
  if (!platformApiEnabled) return false;
  if (
    !force &&
    (
      currentPlatformBootstrap ||
      hasPlatformCabinetSession()
    )
  ) {
    return true;
  }
  if (!currentUser) {
    throw createPlatformRequestError("Please sign in first.", null, 401, "unauthenticated");
  }

  if (
    platformBootstrapPromise &&
    currentUser.uid === platformBootstrapPromiseUid
  ) {
    const bootstrap = await platformBootstrapPromise;
    return !!bootstrap?.bootstrap;
  }

  const bootstrapPromise = bootstrapPlatformSession(currentUser)
    .finally(() => {
      if (platformBootstrapPromise === bootstrapPromise) {
        platformBootstrapPromise = null;
        platformBootstrapPromiseUid = "";
      }
    });

  platformBootstrapPromise = bootstrapPromise;
  platformBootstrapPromiseUid = currentUser.uid;
  const bootstrap = await bootstrapPromise;
  return !!bootstrap?.bootstrap;
}

async function platformAuthenticatedRequest(path, options = {}, {allowReauth = true} = {}) {
  await ensurePlatformMotrendSession();

  try {
    return await platformRequest(path, options);
  } catch (error) {
    if (!allowReauth || !isPlatformAuthError(error)) {
      throw error;
    }

    if (!platformReauthPromise) {
      platformReauthPromise = ensurePlatformMotrendSession({force: true})
        .finally(() => {
          platformReauthPromise = null;
        });
    }
    await platformReauthPromise;
    return await platformRequest(path, options);
  }
}

const platformMotrendRequest = platformAuthenticatedRequest;
const platformAdminRequest = platformAuthenticatedRequest;
const platformAnalyticsRequest = platformAuthenticatedRequest;
const platformBillingRequest = platformAuthenticatedRequest;

async function listPlatformTemplatesRequest() {
  return await platformRequest("/motrend/templates");
}

async function listBillingCreditPacksRequest() {
  return await platformBillingRequest("/billing/credit-packs");
}

async function listBillingOrdersRequest() {
  return await platformBillingRequest("/billing/orders");
}

async function createBillingCheckoutOrderRequest(payload) {
  return await platformBillingRequest("/billing/orders/checkout", {
    method: "POST",
    body: payload,
  });
}

async function lookupAdminSupportCodeRequest(supportCode) {
  return await platformAdminRequest(
    `/admin/support/${encodeURIComponent(supportCode)}`
  );
}

async function grantAdminWalletCreditsRequest(payload) {
  return await platformAdminRequest("/admin/wallet-grants", {
    method: "POST",
    body: payload,
  });
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

const BILLING_ALLOWED_HOST_SUFFIXES = [
  "fastspring.com",
  "onfastspring.com",
];

function safeCheckoutUrl(value) {
  const url = safeUrl(value);
  if (!url) return "";

  try {
    const {hostname} = new URL(url);
    const normalizedHost = hostname.trim().toLowerCase();
    const isAllowed = BILLING_ALLOWED_HOST_SUFFIXES.some((suffix) => {
      return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
    });
    return isAllowed ? url : "";
  } catch {
    return "";
  }
}

function buildSaveVideoPageUrl(videoUrl, downloadUrl = "") {
  const safeVideoUrl = safeUrl(videoUrl);
  const safeDownloadUrl = safeUrl(downloadUrl);
  if (!safeVideoUrl && !safeDownloadUrl) return "";
  const url = new URL("/save-video.html", window.location.origin);
  if (safeVideoUrl) {
    url.searchParams.set("videoUrl", safeVideoUrl);
  }
  if (safeDownloadUrl) {
    url.searchParams.set("downloadUrl", safeDownloadUrl);
  }
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
      return "Server busy. Try again in a few seconds.";
    }
    return message || "Not enough credits for this generation.";
  }
  if (code.includes("insufficient_credits")) {
    return message || "Not enough credits for this generation.";
  }
  if (code.includes("unauthenticated")) {
    return "Please sign in first.";
  }
  if (code.includes("platform_timeout")) {
    return "Connection timed out. Please try again.";
  }
  if (code.includes("upload_stalled")) {
    return "Video upload stalled. Try again.";
  }
  if (code.includes("failed-precondition")) {
    return message || "Template is unavailable. Pick another one.";
  }
  if (code.includes("active_job_exists")) {
    return message || "Finish your current upload or generation first.";
  }
  if (code.includes("template_inactive")) {
    return message || "Template is unavailable. Pick another one.";
  }
  if (code.includes("input_image_missing")) {
    return message || "Photo missing. Upload it again.";
  }
  if (code.includes("reference_video_missing")) {
    return message || "Video missing. Upload it again.";
  }
  if (code.includes("invalid_input_image_path")) {
    return message || "Photo expired. Upload it again.";
  }
  if (code.includes("job_not_ready")) {
    return message || "Trend is not ready yet.";
  }
  if (code.includes("download_source_missing")) {
    return message || "Video is not ready yet.";
  }
  if (code.includes("job_not_shareable")) {
    return message || "Video is not ready to share yet.";
  }
  if (code.includes("permission-denied")) {
    return message || "You have no access to this trend.";
  }
  if (code.includes("product_membership_required")) {
    return message || "MoTrend access required.";
  }
  return message || "Something went wrong. Try again.";
}

function extractShortfallCredits(error) {
  const details = getErrorDetails(error);
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

function extractActiveJobConflict(error) {
  const code = typeof error?.code === "string" ? error.code.toLowerCase() : "";
  if (!code.includes("failed-precondition") && code !== "active_job_exists") {
    return null;
  }

  const details = getErrorDetails(error);
  if (!details || typeof details !== "object") return null;

  const activeJobId = typeof details.activeJobId === "string" ?
    details.activeJobId :
    "";
  const activeStatus = typeof details.activeStatus === "string" ?
    details.activeStatus.toLowerCase() :
    "";

  if (!activeJobId || !activeStatus) return null;
  return {
    activeJobId,
    activeStatus,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCurrencyMinor(amountMinor, currencyCode = "USD") {
  const amount = Number(amountMinor);
  if (!Number.isFinite(amount)) {
    return "—";
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currencyCode}`;
  }
}

function formatWalletOrderTimestamp(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function closeWalletModal() {
  const modal = $("walletModal");
  if (modal) {
    modal.style.display = "none";
  }
}

function renderWalletModal() {
  const stateEl = $("walletState");
  const packsEl = $("walletPacks");
  const ordersEl = $("walletOrders");

  if (!stateEl || !packsEl || !ordersEl) {
    return;
  }

  if (walletLoading) {
    stateEl.textContent = "Loading credit packs…";
    packsEl.innerHTML = "";
    ordersEl.innerHTML = "";
    return;
  }

  if (walletLoadError) {
    stateEl.textContent = walletLoadError;
  } else if (walletOffers.length === 0) {
    stateEl.textContent = "Credit packs are not ready yet.";
  } else {
    stateEl.textContent = "Choose a pack.";
  }

  if (walletOffers.length === 0) {
    packsEl.innerHTML = '<div class="muted">No credit packs yet.</div>';
  } else {
    const walletCheckoutInFlight = !!walletCheckoutInFlightPriceId;
    packsEl.innerHTML = walletOffers.map((pack) => {
      const disabled = !pack.checkoutConfigured || walletCheckoutInFlight;
      const buttonLabel = walletCheckoutInFlightPriceId === pack.priceId ?
        "Opening…" :
        pack.checkoutConfigured ?
          "Continue" :
          "Unavailable";

      return `
        <div class="walletPack">
          <div class="walletPackName">${escapeHtml(pack.name)}</div>
          <div class="walletPackMeta">${escapeHtml(`${pack.creditsAmount} credits`)}</div>
          <div class="walletPackPrice">${escapeHtml(formatCurrencyMinor(pack.amountMinor, pack.currencyCode))}</div>
          <button
            class="btn walletPackAction"
            data-wallet-price-id="${escapeHtml(pack.priceId)}"
            ${disabled ? "disabled" : ""}
          >${escapeHtml(buttonLabel)}</button>
        </div>
      `;
    }).join("");

    packsEl.querySelectorAll("[data-wallet-price-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const priceId = button.getAttribute("data-wallet-price-id") || "";
        if (!priceId) return;
        void beginWalletCheckout(priceId);
      });
    });
  }

  if (walletOrders.length === 0) {
    ordersEl.innerHTML = '<div class="muted">No recent orders.</div>';
    return;
  }

  ordersEl.innerHTML = walletOrders.map((order) => {
    const createdAt = formatWalletOrderTimestamp(order.createdAt);
    return `
      <div class="walletOrderItem">
        <div>
          <div class="walletOrderName">${escapeHtml(order.billingProductName)}</div>
          <div class="walletOrderMeta">
            ${escapeHtml(`${order.creditsAmount} credits`)}
            ${createdAt ? ` • ${escapeHtml(createdAt)}` : ""}
          </div>
        </div>
        <div class="walletOrderRight">
          <div class="walletOrderPrice">${escapeHtml(formatCurrencyMinor(order.amountMinor, order.currencyCode))}</div>
          <div class="walletOrderStatus">${escapeHtml(order.status)}</div>
        </div>
      </div>
    `;
  }).join("");
}

async function loadWalletModalData() {
  const loadToken = ++walletLoadToken;
  walletLoading = true;
  walletLoadError = "";
  renderWalletModal();

  try {
    const [packsResponse, ordersResponse] = await Promise.all([
      listBillingCreditPacksRequest(),
      listBillingOrdersRequest(),
    ]);

    if (loadToken !== walletLoadToken) {
      return;
    }

    walletOffers = Array.isArray(packsResponse?.packs) ? packsResponse.packs : [];
    walletOrders = Array.isArray(ordersResponse?.orders) ? ordersResponse.orders : [];
  } catch (error) {
    if (loadToken !== walletLoadToken) {
      return;
    }

    console.warn("wallet data load failed", error);
    walletOffers = [];
    walletOrders = [];
    walletLoadError = "Wallet is unavailable right now.";
  } finally {
    if (loadToken === walletLoadToken) {
      walletLoading = false;
      renderWalletModal();
    }
  }
}

async function beginWalletCheckout(priceId) {
  if (!priceId || walletCheckoutInFlightPriceId) return;

  walletCheckoutInFlightPriceId = priceId;
  renderWalletModal();

  try {
    const checkout = await createBillingCheckoutOrderRequest({priceId});
    const redirectUrl = safeCheckoutUrl(checkout?.redirectUrl);

    if (!redirectUrl) {
      throw createPlatformRequestError(
        "Checkout is not ready for this pack yet.",
        {error: {code: "billing_checkout_unavailable"}},
        409,
        "billing_checkout_unavailable",
      );
    }

    setStatus("Opening checkout…");
    window.location.assign(redirectUrl);
  } catch (error) {
    if (error?.code === "billing_checkout_unavailable") {
      await showNoticeModal({
        message: "Checkout is not ready for this pack yet.",
      });
    } else {
      await showNoticeModal({
        message: callableErrorMessage(error) || "Failed to open checkout.",
      });
    }
  } finally {
    walletCheckoutInFlightPriceId = "";
    renderWalletModal();
  }
}

async function openWallet() {
  if (!currentUser && !hasPlatformCabinetSession()) {
    if (!(await ensureSignedInForAction("Sign in to buy credits."))) {
      return;
    }
  }

  if (!platformApiEnabled) {
    await showNoticeModal({
      message: "Wallet is unavailable right now.",
    });
    return;
  }

  const modal = $("walletModal");
  if (modal) {
    modal.style.display = "flex";
  }
  void Promise.all([
    loadWalletModalData(),
    refreshPlatformMotrendProfile({silent: true}),
  ]);
}

function renderCreditsBadge(balance) {
  const creditsEl = $("credits");
  if (!creditsEl) return;

  const numericBalance = Number.isFinite(Number(balance)) ? Number(balance) : 0;
  const normalizedBalance = numericBalance > 0 ? numericBalance : 0;
  currentCreditsBalance = normalizedBalance;
  creditsEl.textContent = `${normalizedBalance} credits`;
  creditsEl.classList.toggle("isPositive", normalizedBalance > 0);
  creditsEl.classList.toggle("isZero", normalizedBalance <= 0);
}

function renderLocaleFields(country = "", language = "") {
  $("country").textContent = (
    typeof country === "string" && country.trim()
  ) ? country.trim() : "—";
  $("lang").textContent = (
    typeof language === "string" && language.trim()
  ) ? language.trim() : "—";
}

function applyPlatformProfileToUi(profile = currentPlatformMotrendProfile) {
  if (!profile || typeof profile !== "object") return;

  const creditsBalance = Number(profile.creditsBalance);
  if (Number.isFinite(creditsBalance)) {
    renderCreditsBadge(creditsBalance);
  }

  const supportCode = resolveKnownSupportCode(profile);
  if (supportCode) {
    setSupportCodeUi(supportCode);
  }

  renderLocaleFields(profile.country, profile.language);
  isAdminUser = profile?.isAdmin === true;
  setAdminCardVisible(isAdminUser);
}

async function refreshPlatformMotrendProfile({silent = true} = {}) {
  if (!platformApiEnabled || (!currentUser && !hasPlatformCabinetSession())) {
    return null;
  }

  try {
    const profile = await platformMotrendRequest("/motrend/me");
    currentPlatformMotrendProfile = profile;
    applyPlatformProfileToUi(profile);
    return profile;
  } catch (error) {
    if (!silent) {
      console.warn("platform motrend/me refresh failed", error);
    }
    return null;
  }
}

async function restoreGuestCabinetFromCookie() {
  if (!platformApiEnabled || currentUser) {
    return false;
  }

  const restored = await restorePlatformSessionFromCookie(null);
  if (!restored?.session || !restored?.motrendProfile) {
    return false;
  }

  markAuthSuccessCookie();
  clearAuthAttemptCookie();
  $("userCard").style.display = "block";
  $("jobsCard").style.display = "block";
  $("btnWallet").style.display = "inline-block";
  $("btnLogout").style.display = "inline-block";
  $("supportBtn").style.display = "inline-flex";
  $("userLine").textContent =
    restored.session?.user?.email ||
    restored.session?.user?.displayName ||
    "Signed in";
  applyPlatformProfileToUi(restored.motrendProfile);
  renderLocaleFields(
    restored.motrendProfile?.country,
    restored.motrendProfile?.language,
  );
  return true;
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
      const templateId = typeof job?.templateId === "string" ?
        job.templateId :
        "—";
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
    grantWrap.style.display = adminSelectedSupportCode ? "block" : "none";
  }
}

function removeAdminCard() {
  const existing = $("adminCard");
  if (existing) {
    existing.remove();
  }
  setAdminLookupError("");
  clearAdminLookupResult();
}

function ensureAdminCard() {
  let card = $("adminCard");
  if (card) return card;

  const userCard = $("userCard");
  const appWrap = $("app");
  if (!userCard || !appWrap) return null;

  card = document.createElement("div");
  card.id = "adminCard";
  card.className = "card";
  card.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px">Admin</div>
    <div class="row" style="margin-bottom:10px">
      <input id="adminSupportCode" placeholder="Support ID (U-...)" style="flex:1;min-width:220px" />
      <button id="btnAdminLookup" class="btn2">Find user</button>
    </div>
    <div id="adminLookupError" class="formError muted" style="display:none"></div>
    <pre id="adminLookupResult" class="muted" style="display:none;white-space:pre-wrap;background:#0f0f0f;border:1px solid var(--border);border-radius:12px;padding:12px;margin:10px 0"></pre>
    <div id="adminGrantWrap" style="display:none">
      <div class="grid">
        <div>
          <div class="muted">Credits to add</div>
          <input id="adminGrantAmount" type="number" min="1" step="1" value="10" />
        </div>
        <div>
          <div class="muted">Reason</div>
          <input id="adminGrantReason" type="text" placeholder="Support refund" />
        </div>
      </div>
      <div class="row" style="margin-top:10px">
        <button id="btnAdminGrant" class="btn">Grant credits</button>
      </div>
    </div>
  `;

  userCard.insertAdjacentElement("afterend", card);

  const lookupBtn = $("btnAdminLookup");
  if (lookupBtn) {
    lookupBtn.onclick = async () => {
      setAdminLookupError("");
      clearAdminLookupResult();
      const supportCode = $("adminSupportCode")?.value?.trim() || "";
      if (!supportCode) {
        setAdminLookupError("Enter a Support ID first.");
        return;
      }

      lookupBtn.disabled = true;
      lookupBtn.textContent = "Finding…";
      try {
        const response = await lookupAdminSupportCodeRequest(supportCode);
        renderAdminLookupResult(response || {});
      } catch (error) {
        setAdminLookupError(callableErrorMessage(error));
      } finally {
        lookupBtn.disabled = false;
        lookupBtn.textContent = "Find user";
      }
    };
  }

  const grantBtn = $("btnAdminGrant");
  if (grantBtn) {
    grantBtn.onclick = async () => {
      setAdminLookupError("");
      if (!adminSelectedSupportCode) {
        setAdminLookupError("Find a user first.");
        return;
      }
      const amountValue = Number($("adminGrantAmount")?.value || 0);
      const reasonValue = $("adminGrantReason")?.value?.trim() || "Support refund";
      if (!Number.isFinite(amountValue) || amountValue <= 0) {
        setAdminLookupError("Enter a valid credit amount.");
        return;
      }

      grantBtn.disabled = true;
      grantBtn.textContent = "Granting…";
      try {
        const response = await grantAdminWalletCreditsRequest({
          supportCode: adminSelectedSupportCode,
          amount: Math.ceil(amountValue),
          reason: reasonValue,
        });
        const balanceAfter = Number(response?.balanceAfter || 0);
        const lookupResponse = await lookupAdminSupportCodeRequest(adminSelectedSupportCode);
        renderAdminLookupResult(lookupResponse || {});
        void refreshPlatformMotrendProfile({silent: true});
        await showNoticeModal({
          message: `Credits granted. New balance: ${balanceAfter}.`,
          buttonText: "OK",
        });
      } catch (error) {
        setAdminLookupError(callableErrorMessage(error));
      } finally {
        grantBtn.disabled = false;
        grantBtn.textContent = "Grant credits";
      }
    };
  }

  return card;
}

function setAdminCardVisible(visible) {
  if (!visible) {
    removeAdminCard();
    return;
  }
  ensureAdminCard();
}

let currentUser = null;
let currentPlatformBootstrap = null;
let currentPlatformSession = null;
let currentPlatformMotrendProfile = null;
let platformBootstrapPromise = null;
let platformBootstrapPromiseUid = "";
let platformReauthPromise = null;
let authPersistenceReadyPromise = null;
let authRestoreReady = false;
let authRestoreReadyResolver = null;
let selectedTemplate = null;
let selectedReferenceVideoFile = null;
let selectedReferenceVideoName = "";
let selectedReferenceVideoUploadState = "idle";
let selectedReferenceVideoUploadProgress = 0;
let selectedReferenceVideoUploadTransferredBytes = 0;
let selectedReferenceVideoUploadTotalBytes = 0;
let selectedReferenceVideoPreviewUrl = "";
let selectedReferenceVideoPreviewLoaded = false;
let selectedReferenceVideoPreviewToken = 0;
let selectedReferenceVideoDurationSec = null;
let selectedReferenceVideoMetadataToken = 0;
let selectedReferenceVideoFileToken = 0;
let selectedReferenceVideoUploadPromise = null;
let selectedReferenceVideoUploadedJobId = "";
let selectedReferenceVideoUploadedInputPath = "";
let selectedReferenceVideoUploadedReferencePath = "";
let pendingResumeUpload = null;
let referenceVideoScrollAfterPick = false;
let referenceUploadStallTimer = null;
const TREND_SELECTION_TEMPLATE = "template";
const TREND_SELECTION_REFERENCE = "reference";
let selectedTrendKind = TREND_SELECTION_TEMPLATE;
let currentCreditsBalance = Number.NaN;
let currentCreditsBalanceRefreshPromise = null;
let isAdminUser = false;
let adminSelectedUid = "";
let adminSelectedSupportCode = "";
let availableTemplates = [];
let unsubscribeJobs = null;
let latestJobs = [];
const refreshingJobIds = new Set();
const preparingDownloadJobIds = new Set();
const preparedDownloadByJobId = new Map();
const publicShareByJobId = new Map();
const publicSharePromiseByJobId = new Map();
let showOlderJobs = false;
let generateSubmissionInFlight = false;
let estimatedProgressActive = false;
let estimatedProgressPercent = 0;
let estimatedProgressTimer = null;
let estimatedProgressJobId = "";
let estimatedProgressStartedAtMs = 0;
let estimatedProgressLabel = "Generating your trend…";
let currentSupportCode = "";
let activeUploadHintResolver = null;
let activeUploadHintOkHandler = null;
let activeNoticeResolver = null;
let activeNoticeOkHandler = null;
let activeNoticeConfirmAction = null;
let walletOffers = [];
let walletOrders = [];
let walletLoading = false;
let walletLoadError = "";
let walletLoadToken = 0;
let walletCheckoutInFlightPriceId = "";
const JOB_NOTICE_SEEN_PREFIX = "motrend_job_notice_";
const REFERENCE_UPLOAD_RESUME_PREFIX = "motrend_reference_upload_resume_v1_";
const PREPARE_DOWNLOAD_MAX_ATTEMPTS = 8;
const MAX_UPLOAD_IMAGE_BYTES = 40 * 1024 * 1024;
const TARGET_UPLOAD_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_UPLOAD_IMAGE_DIMENSION = 1080;
const MIN_UPLOAD_IMAGE_DIMENSION = 960;
const UPLOAD_IMAGE_QUALITY_STEPS = [0.9, 0.85, 0.8, 0.75, 0.7, 0.65];
const MAX_REFERENCE_VIDEO_BYTES = 101 * 1024 * 1024;
const PHOTO_HINT_KEY = "motrend_photo_hint_v1";
const VIDEO_HINT_KEY = "motrend_video_hint_v1";
const PHOTO_HINT_MESSAGE =
  "For best results, choose a high-quality photo with clear facial features, visible hands, and a body position that matches the selected reference. Formats: .jpg / .jpeg / .png\n" +
  "File size: ≤40MB.\n" +
  "Dimensions: 300px ~ 65536px";
const VIDEO_HINT_MESSAGE =
  "Supported formats: .mp4 / .mov, file size: ≤100MB, dimensions: 340px ~ 3850px.";
const DEFAULT_VISIBLE_JOBS = 5;
const MAX_WATCH_JOBS = 20;
const PROGRESS_HINT_TEXT = "Usually takes 10–20 minutes";
const LARGE_UPLOAD_HINT_TEXT =
  "Large video uploads can take 5–10 minutes in Telegram/iPhone.";
const PROGRESS_STAGE_A_MS = 120000; // 0-50
const PROGRESS_STAGE_B_MS = 150000; // 50-70
const PROGRESS_STAGE_C_MS = 420000; // 70-90
const PROGRESS_STAGE_D_MS = 120000; // 90-97
const PROGRESS_STAGE_E_MS = 240000; // 97-99
const RESUME_UPLOAD_DELAY_MS = 5 * 60 * 1000;
const LARGE_REFERENCE_VIDEO_HINT_BYTES = 20 * 1024 * 1024;
const REFERENCE_UPLOAD_STALL_TIMEOUT_MS = 60_000;
const authRestoreReadyPromise = new Promise((resolve) => {
  authRestoreReadyResolver = resolve;
});

function markAuthRestoreReady() {
  if (authRestoreReady) return;
  authRestoreReady = true;
  if (typeof authRestoreReadyResolver === "function") {
    authRestoreReadyResolver();
  }
}

async function waitForInitialAuthRestore() {
  if (authRestoreReady) return;
  await authRestoreReadyPromise;
}

async function ensurePreferredAuthPersistence() {
  if (!authPersistenceReadyPromise) {
    authPersistenceReadyPromise = (async () => {
      for (const candidate of AUTH_PERSISTENCE_CANDIDATES) {
        try {
          await setPersistence(auth, candidate);
          return true;
        } catch (error) {
          console.warn("firebase auth persistence unavailable", error);
        }
      }
      return false;
    })();
  }

  return await authPersistenceReadyPromise;
}

async function ensureSignedInForAction(message) {
  await waitForInitialAuthRestore();
  if (currentUser) {
    return true;
  }

  openAuth(message);
  return false;
}

function getReferenceUploadResumeKey(uid = "") {
  const cleanUid = typeof uid === "string" ? uid.trim() : "";
  return cleanUid ?
    `${REFERENCE_UPLOAD_RESUME_PREFIX}${cleanUid}` :
    `${REFERENCE_UPLOAD_RESUME_PREFIX}guest`;
}

function clearReferenceUploadResumeState(uid = currentUser?.uid || "") {
  try {
    sessionStorage.removeItem(getReferenceUploadResumeKey(uid));
  } catch {
    // no-op
  }
}

function persistReferenceUploadResumeState(uid = currentUser?.uid || "") {
  const cleanUid = typeof uid === "string" ? uid.trim() : "";
  if (!cleanUid) return;

  const hasPendingReferenceUpload = !!pendingResumeUpload &&
    pendingResumeUpload.selectionKind === TREND_SELECTION_REFERENCE;
  const hasUploadedReference = Boolean(
    selectedReferenceVideoUploadedJobId &&
    selectedReferenceVideoUploadedInputPath &&
    selectedReferenceVideoUploadedReferencePath
  );

  if (!hasPendingReferenceUpload && !hasUploadedReference) {
    clearReferenceUploadResumeState(cleanUid);
    return;
  }

  const payload = {
    pendingResumeUpload: hasPendingReferenceUpload ? pendingResumeUpload : null,
    uploadedJobId: selectedReferenceVideoUploadedJobId || "",
    uploadedInputPath: selectedReferenceVideoUploadedInputPath || "",
    uploadedReferencePath: selectedReferenceVideoUploadedReferencePath || "",
    referenceVideoName: selectedReferenceVideoName || "",
    updatedAtMs: Date.now(),
  };

  try {
    sessionStorage.setItem(
      getReferenceUploadResumeKey(cleanUid),
      JSON.stringify(payload),
    );
  } catch {
    // no-op
  }
}

function readReferenceUploadResumeState(uid = currentUser?.uid || "") {
  const cleanUid = typeof uid === "string" ? uid.trim() : "";
  if (!cleanUid) return null;

  try {
    const raw = sessionStorage.getItem(getReferenceUploadResumeKey(cleanUid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const pending = parsed.pendingResumeUpload;
    const pendingResume = pending && typeof pending === "object" ? {
      jobId: typeof pending.jobId === "string" ? pending.jobId.trim() : "",
      uploadPath: typeof pending.uploadPath === "string" ? pending.uploadPath.trim() : "",
      templateId: typeof pending.templateId === "string" ? pending.templateId.trim() : "",
      selectionKind: pending.selectionKind === TREND_SELECTION_REFERENCE ?
        TREND_SELECTION_REFERENCE :
        pending.selectionKind === TREND_SELECTION_TEMPLATE ?
          TREND_SELECTION_TEMPLATE :
          "unknown",
    } : null;

    return {
      pendingResumeUpload:
        pendingResume?.jobId && pendingResume?.uploadPath && pendingResume?.templateId ?
          pendingResume :
          null,
      uploadedJobId: typeof parsed.uploadedJobId === "string" ? parsed.uploadedJobId.trim() : "",
      uploadedInputPath: typeof parsed.uploadedInputPath === "string" ? parsed.uploadedInputPath.trim() : "",
      uploadedReferencePath: typeof parsed.uploadedReferencePath === "string" ? parsed.uploadedReferencePath.trim() : "",
      referenceVideoName: typeof parsed.referenceVideoName === "string" ? parsed.referenceVideoName.trim() : "",
    };
  } catch {
    return null;
  }
}

function clearReferenceUploadStallTimer() {
  if (!referenceUploadStallTimer) return;
  clearTimeout(referenceUploadStallTimer);
  referenceUploadStallTimer = null;
}

function scheduleReferenceUploadStallTimer(expectedFileToken) {
  clearReferenceUploadStallTimer();
  referenceUploadStallTimer = setTimeout(() => {
    if (
      expectedFileToken !== selectedReferenceVideoFileToken ||
      selectedReferenceVideoUploadState !== "uploading"
    ) {
      return;
    }

    selectedReferenceVideoUploadState = "error";
    refreshReferenceVideoCardUi();
    setStatus("");
    showFormError("Video upload stalled. Try uploading it again.");
  }, REFERENCE_UPLOAD_STALL_TIMEOUT_MS);
}

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

function formatUploadMegabytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0.0 MB";
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function buildReferenceVideoUploadStatus() {
  const percent = Math.max(
    0,
    Math.min(100, Math.round(Number(selectedReferenceVideoUploadProgress) || 0))
  );
  const transferredLabel = formatUploadMegabytes(
    selectedReferenceVideoUploadTransferredBytes
  );
  const totalLabel = formatUploadMegabytes(
    selectedReferenceVideoUploadTotalBytes ||
    selectedReferenceVideoFile?.size ||
    0
  );
  return `Uploading video… ${percent}% (${transferredLabel} / ${totalLabel})`;
}

function refreshReferenceVideoUploadStatusSurface() {
  if (selectedReferenceVideoUploadState !== "uploading") return;
  setStatus(buildReferenceVideoUploadStatus());
  if (
    (selectedReferenceVideoFile?.size || 0) >= LARGE_REFERENCE_VIDEO_HINT_BYTES ||
    shouldUseRedirectLogin()
  ) {
    setStatusHintText(LARGE_UPLOAD_HINT_TEXT);
    setStatusHintVisible(true);
  }
  refreshReferenceVideoCardUi();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshReferenceVideoUploadStatusSurface();
  }
});

window.addEventListener("focus", () => {
  refreshReferenceVideoUploadStatusSurface();
});

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
  setStatusHintText(PROGRESS_HINT_TEXT);
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
  setStatusHintText(PROGRESS_HINT_TEXT);
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
  setStatusHintText(PROGRESS_HINT_TEXT);
  setStatusHintVisible(false);
  setUploadSafetyHint("", false);
}

function completeEstimatedProgress() {
  clearEstimatedProgressTimer();
  estimatedProgressActive = false;
  estimatedProgressPercent = 100;
  estimatedProgressStartedAtMs = 0;
  estimatedProgressLabel = "Generating your trend…";
  setStatusHintText(PROGRESS_HINT_TEXT);
  setStatus("Done. Download ready. 100%");
  setStatusHintVisible(false);
  setUploadSafetyHint("", false);
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
  const costLabel = buildTemplateCostLabel(template);
  return `${title} (${costLabel})`;
}

function buildTemplateCostLabel(template) {
  const costCredits = getTemplateCostCredits(template);
  return `${costCredits ?? "—"} credits`;
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
    (selectedReferenceVideoFile || selectedReferenceVideoUploadedReferencePath)
  ) {
    const referenceCard = document.querySelector(
      ".tplCard[data-trend-role='reference']"
    );
    if (referenceCard) {
      selectTrendCard(referenceCard);
      updateSelectedTrendField();
      refreshGenerateButtonState();
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
      refreshGenerateButtonState();
      return;
    }
  }

  clearTrendSelectionUi();
  updateSelectedTrendField();
  refreshGenerateButtonState();
}

function hasUploadedReferenceVideo() {
  return Boolean(
    selectedReferenceVideoUploadState === "uploaded" &&
    selectedReferenceVideoUploadedJobId &&
    selectedReferenceVideoUploadedInputPath &&
    selectedReferenceVideoUploadedReferencePath
  );
}

function refreshGenerateButtonState() {
  const btn = $("btnGenerate");
  if (!btn) return;

  const referencePending = (
    selectedTrendKind === TREND_SELECTION_REFERENCE &&
    !hasUploadedReferenceVideo()
  );

  btn.disabled = generateSubmissionInFlight || referencePending;
  btn.title = referencePending ?
    "Wait for the reference video upload to finish." :
    "";
}

function getReferenceVideoMetaPresentation() {
  if (selectedReferenceVideoUploadState === "uploading") {
    return {
      text: `Uploading video… ${selectedReferenceVideoUploadProgress}%`,
      title: selectedReferenceVideoName || "Uploading video",
      state: "uploading",
    };
  }

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

  if (selectedReferenceVideoUploadState === "selected") {
    return {
      text: "Video selected",
      title: selectedReferenceVideoName || "Video selected",
      state: "selected",
    };
  }

  return {
    text: selectedReferenceVideoName || "No video selected",
    title: selectedReferenceVideoName || "",
    state: "idle",
  };
}

function getReferenceVideoCostEstimatePresentation() {
  if (!selectedReferenceVideoFile) {
    return {
      text: "",
      title: "",
      visible: false,
    };
  }

  if (
    Number.isFinite(selectedReferenceVideoDurationSec) &&
    selectedReferenceVideoDurationSec > 0
  ) {
    const estimatedCredits = Math.max(1, Math.ceil(selectedReferenceVideoDurationSec));
    return {
      text: `Will cost ~${estimatedCredits} credits`,
      title: `Will cost about ${estimatedCredits} credits`,
      visible: true,
    };
  }

  return {
    text: "Calculating cost…",
    title: "Calculating cost",
    visible: true,
  };
}

function refreshReferenceVideoCardMediaUi() {
  const card = document.querySelector(".tplCard[data-trend-role='reference']");
  if (!card) return;

  const placeholder = card.querySelector(".refPlaceholder");
  const placeholderTitle = card.querySelector(".refPlaceholderTitle");
  const placeholderSub = card.querySelector(".refPlaceholderSub");
  const previewImg = card.querySelector(".refPreviewImage");
  const hasPreview =
    !!selectedReferenceVideoPreviewUrl && selectedReferenceVideoPreviewLoaded;
  const forceOverlay =
    selectedReferenceVideoUploadState === "selected" ||
    selectedReferenceVideoUploadState === "uploading" ||
    selectedReferenceVideoUploadState === "error";

  let placeholderState = "idle";
  let placeholderPrimary = "Your video reference";
  let placeholderSecondary = "Choose mp4 or mov";

  if (selectedReferenceVideoUploadState === "uploading") {
    placeholderState = "busy";
    placeholderPrimary = "Uploading video…";
    placeholderSecondary = `${selectedReferenceVideoUploadProgress}% uploaded`;
  } else if (selectedReferenceVideoUploadState === "uploaded") {
    placeholderState = "success";
    placeholderPrimary = "Your video is uploaded";
    placeholderSecondary = hasPreview ? "" : "Preview may not appear in this browser";
  } else if (selectedReferenceVideoUploadState === "error") {
    placeholderState = "error";
    placeholderPrimary = "Upload failed";
    placeholderSecondary = "Please try again";
  } else if (selectedReferenceVideoFile) {
    placeholderState = "busy";
    placeholderPrimary = "Preparing preview…";
    placeholderSecondary = selectedReferenceVideoName || "Video selected";
  }

  if (previewImg) {
    const nextPreviewSrc = selectedReferenceVideoPreviewUrl || "";
    if ((previewImg.dataset.currentSrc || "") !== nextPreviewSrc) {
      previewImg.dataset.currentSrc = nextPreviewSrc;
      if (nextPreviewSrc) {
        selectedReferenceVideoPreviewLoaded = false;
        previewImg.src = nextPreviewSrc;
      } else {
        previewImg.removeAttribute("src");
      }
    }
    previewImg.style.display = hasPreview ? "block" : "none";
  }

  if (placeholder) {
    const showPlaceholder = !hasPreview || forceOverlay;
    placeholder.style.display = showPlaceholder ? "flex" : "none";
    placeholder.classList.toggle("hasPreview", hasPreview && forceOverlay);
    placeholder.classList.toggle("isBusy", showPlaceholder && placeholderState === "busy");
    placeholder.classList.toggle("isSuccess", showPlaceholder && placeholderState === "success");
    placeholder.classList.toggle("isError", showPlaceholder && placeholderState === "error");
  }

  if (placeholderTitle) {
    placeholderTitle.textContent = placeholderPrimary;
  }

  if (placeholderSub) {
    placeholderSub.textContent = placeholderSecondary;
  }
}

function refreshReferenceVideoCardUi() {
  const meta = document.querySelector(
    ".tplCard[data-trend-role='reference'] .refMetaName"
  );
  const estimate = document.querySelector(
    ".tplCard[data-trend-role='reference'] .refCostEstimate"
  );
  const actionBtn = document.querySelector(
    ".tplCard[data-trend-role='reference'] .tplUse"
  );
  refreshReferenceVideoCardMediaUi();
  if (meta) {
    const presentation = getReferenceVideoMetaPresentation();
    meta.textContent = presentation.text;
    meta.title = presentation.title;
    meta.classList.toggle("isSuccess", presentation.state === "uploaded");
    meta.classList.toggle("isError", presentation.state === "error");
  }

  if (estimate) {
    const estimatePresentation = getReferenceVideoCostEstimatePresentation();
    estimate.textContent = estimatePresentation.text;
    estimate.title = estimatePresentation.title;
    estimate.classList.toggle("isVisible", estimatePresentation.visible);
  }

  if (actionBtn) {
    if (selectedReferenceVideoUploadState === "uploading") {
      actionBtn.textContent = "Uploading…";
    } else if (selectedReferenceVideoUploadState === "uploaded") {
      actionBtn.textContent = "Change video";
    } else if (selectedReferenceVideoUploadState === "error") {
      actionBtn.textContent = "Retry upload";
    } else {
      actionBtn.textContent = "Upload";
    }
  }

  refreshGenerateButtonState();
}

async function openReferenceVideoPicker({enableScrollAfterPick = false} = {}) {
  if (!(await ensureSignedInForAction("Sign in to upload your reference video."))) {
    return;
  }

  const picker = $("fileReferenceVideo");
  if (!picker) return;
  clearFormError();
  referenceVideoScrollAfterPick = enableScrollAfterPick;
  await maybeShowUploadHint(VIDEO_HINT_KEY, VIDEO_HINT_MESSAGE);
  picker.click();
}

async function openPhotoPicker() {
  if (!(await ensureSignedInForAction("Sign in to upload a photo."))) {
    return;
  }

  const fileInput = $("filePhoto");
  if (!fileInput) return;
  clearFormError();

  if (!shouldUseRedirectLogin() && !hasSeenHint(PHOTO_HINT_KEY)) {
    await maybeShowUploadHint(PHOTO_HINT_KEY, PHOTO_HINT_MESSAGE);
  }
  fileInput.click();
}

function resetReferenceVideoPreview() {
  selectedReferenceVideoPreviewToken += 1;
  selectedReferenceVideoPreviewUrl = "";
  selectedReferenceVideoPreviewLoaded = false;
  refreshReferenceVideoCardMediaUi();
}

function resetReferenceVideoUploadTracking() {
  clearReferenceUploadStallTimer();
  selectedReferenceVideoUploadProgress = 0;
  selectedReferenceVideoUploadTransferredBytes = 0;
  selectedReferenceVideoUploadTotalBytes = 0;
  selectedReferenceVideoUploadPromise = null;
  selectedReferenceVideoUploadedJobId = "";
  selectedReferenceVideoUploadedInputPath = "";
  selectedReferenceVideoUploadedReferencePath = "";
  persistReferenceUploadResumeState();
}

function readVideoFileDurationSeconds(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {
        // no-op
      }
    };

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.addEventListener("error", () => {
      finish(() => reject(new Error("Unable to read video duration.")));
    }, {once: true});
    video.addEventListener("loadedmetadata", () => {
      const duration = Number(video.duration);
      if (!Number.isFinite(duration) || duration <= 0) {
        finish(() => reject(new Error("Unable to read video duration.")));
        return;
      }
      finish(() => resolve(duration));
    }, {once: true});
    video.src = objectUrl;
  });
}

async function updateSelectedReferenceVideoDuration(file) {
  const token = ++selectedReferenceVideoMetadataToken;
  selectedReferenceVideoDurationSec = null;
  refreshReferenceVideoCardUi();
  if (!file) return;

  try {
    const duration = await readVideoFileDurationSeconds(file);
    if (token !== selectedReferenceVideoMetadataToken) return;
    selectedReferenceVideoDurationSec = duration;
  } catch {
    if (token !== selectedReferenceVideoMetadataToken) return;
    selectedReferenceVideoDurationSec = null;
  }
  refreshReferenceVideoCardUi();
}

function getReusableReferenceUploadContext() {
  if (
    pendingResumeUpload &&
    pendingResumeUpload.templateId === selectedTemplate?.id &&
    pendingResumeUpload.selectionKind === TREND_SELECTION_REFERENCE
  ) {
    return pendingResumeUpload;
  }

  const existingAwaiting = latestJobs.find((entry) => (
    entry?.data?.status === "awaiting_upload" &&
    entry?.data?.templateId === selectedTemplate?.id &&
    entry?.data?.selectionKind === TREND_SELECTION_REFERENCE
  ));

  if (!existingAwaiting) return null;

  setPendingResumeUpload(existingAwaiting.id, existingAwaiting.data || {});
  return pendingResumeUpload;
}

async function ensureReferenceVideoUploadContext() {
  if (!selectedTemplate?.id) {
    throw new Error("Pick a trend first.");
  }

  const reusable = getReusableReferenceUploadContext();
  if (reusable?.jobId && reusable?.uploadPath) {
    return reusable;
  }

  const clientRequestId = createClientRequestId("gen");
  const response = await prepareMotrendJobRequest({
    templateId: selectedTemplate.id,
    selectionKind: TREND_SELECTION_REFERENCE,
    clientRequestId,
  });
  const jobId = response?.jobId || "";
  const uploadPath = response?.uploadPath || "";
  if (!jobId || !uploadPath) {
    throw new Error("Unable to prepare reference upload.");
  }

  const prepared = {
    templateId: selectedTemplate.id,
    inputImagePath: uploadPath,
    selectionKind: TREND_SELECTION_REFERENCE,
  };
  setPendingResumeUpload(jobId, prepared);
  return pendingResumeUpload;
}

async function ensureReferenceVideoUploaded({surfaceStatus = false, fileToken = selectedReferenceVideoFileToken} = {}) {
  if (hasUploadedReferenceVideo()) {
    return {
      jobId: selectedReferenceVideoUploadedJobId,
      uploadPath: selectedReferenceVideoUploadedInputPath,
      referenceVideoPath: selectedReferenceVideoUploadedReferencePath,
    };
  }

  if (!selectedReferenceVideoFile) {
    throw new Error("Upload your reference video first.");
  }

  if (selectedReferenceVideoUploadPromise) {
    return selectedReferenceVideoUploadPromise;
  }

  const localFile = selectedReferenceVideoFile;
  const localToken = fileToken;
  const localTemplateId = selectedTemplate?.id || "";

  const uploadPromise = (async () => {
    const preparedVideo = prepareReferenceVideoInput(localFile);
    const preparedContext = await ensureReferenceVideoUploadContext();
    const jobId = preparedContext?.jobId || "";
    const uploadPath = preparedContext?.uploadPath || "";
    if (!jobId || !uploadPath) {
      throw new Error("Unable to prepare reference upload.");
    }

    const uploadDir = uploadPath.replace(/\/[^/]+$/, "");
    const referenceVideoPath =
      `${uploadDir}/reference_${localToken}${preparedVideo.extension}`;
    const referenceRef = ref(storage, referenceVideoPath);

    if (
      localToken === selectedReferenceVideoFileToken &&
      localFile === selectedReferenceVideoFile &&
      localTemplateId === (selectedTemplate?.id || "")
    ) {
      selectedReferenceVideoUploadState = "uploading";
      selectedReferenceVideoUploadProgress = 0;
      selectedReferenceVideoUploadTransferredBytes = 0;
      selectedReferenceVideoUploadTotalBytes = preparedVideo.blob.size || localFile.size || 0;
      refreshReferenceVideoCardUi();
      persistReferenceUploadResumeState();
      if (
        localFile.size >= LARGE_REFERENCE_VIDEO_HINT_BYTES ||
        shouldUseRedirectLogin()
      ) {
        setStatusHintText(LARGE_UPLOAD_HINT_TEXT);
        setStatusHintVisible(true);
      }
    }

    await uploadFileWithProgress(
      referenceRef,
      preparedVideo.blob,
      {contentType: preparedVideo.contentType},
      (percent, snapshot) => {
        if (
          localToken !== selectedReferenceVideoFileToken ||
          localFile !== selectedReferenceVideoFile
        ) {
          return;
        }
        selectedReferenceVideoUploadProgress = percent;
        selectedReferenceVideoUploadTransferredBytes = Number(snapshot?.bytesTransferred || 0);
        selectedReferenceVideoUploadTotalBytes = Number(snapshot?.totalBytes || 0);
        scheduleReferenceUploadStallTimer(localToken);
        refreshReferenceVideoCardUi();
        if (!surfaceStatus && !generateSubmissionInFlight) {
          setStatusHintVisible(true);
        }
        setStatus(buildReferenceVideoUploadStatus());
      },
      {
        activityTimeoutMs: REFERENCE_UPLOAD_STALL_TIMEOUT_MS,
        stallMessage: "Video upload stalled. Try uploading it again.",
      }
    );

    if (
      localToken === selectedReferenceVideoFileToken &&
      localFile === selectedReferenceVideoFile
    ) {
      clearReferenceUploadStallTimer();
      selectedReferenceVideoUploadState = "uploaded";
      selectedReferenceVideoUploadProgress = 100;
      selectedReferenceVideoUploadTransferredBytes = selectedReferenceVideoUploadTotalBytes;
      selectedReferenceVideoUploadedJobId = jobId;
      selectedReferenceVideoUploadedInputPath = uploadPath;
      selectedReferenceVideoUploadedReferencePath = referenceVideoPath;
      refreshReferenceVideoCardUi();
      persistReferenceUploadResumeState();
      if (!generateSubmissionInFlight) {
        setStatus("");
        setStatusHintVisible(false);
      }
    }

    return {jobId, uploadPath, referenceVideoPath};
  })().catch((error) => {
    if (
      localToken === selectedReferenceVideoFileToken &&
      localFile === selectedReferenceVideoFile
    ) {
      clearReferenceUploadStallTimer();
      selectedReferenceVideoUploadState = "error";
      selectedReferenceVideoUploadTransferredBytes = 0;
      selectedReferenceVideoUploadTotalBytes = 0;
      refreshReferenceVideoCardUi();
      persistReferenceUploadResumeState();
      if (!generateSubmissionInFlight) {
        setStatus("");
      }
    }
    throw error;
  }).finally(() => {
    if (selectedReferenceVideoUploadPromise === uploadPromise) {
      selectedReferenceVideoUploadPromise = null;
    }
  });

  selectedReferenceVideoUploadPromise = uploadPromise;
  return uploadPromise;
}

async function maybeStartReferenceVideoAutoUpload(fileToken) {
  if (!currentUser || !selectedReferenceVideoFile) return;

  try {
    const creditsReady = await ensureSelectedTrendCreditsReady({
      notifyUnknownCost: false,
      notifyUnknownBalance: false,
    });
    if (!creditsReady) {
      return;
    }

    if (
      fileToken !== selectedReferenceVideoFileToken ||
      !selectedReferenceVideoFile
    ) {
      return;
    }

    await ensureReferenceVideoUploaded({fileToken});
  } catch (error) {
    if (
      fileToken !== selectedReferenceVideoFileToken ||
      !selectedReferenceVideoFile
    ) {
      return;
    }
    const activeJobConflict = extractActiveJobConflict(error);
    if (activeJobConflict) {
      showFormError("Finish your current upload or generation before starting a new one.");
      return;
    }
    showFormError(callableErrorMessage(error));
  }
}

function createReferenceVideoPreviewDataUrl(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    let cleaned = false;
    let settled = false;
    let drawFallbackTimer = null;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (drawFallbackTimer) {
        clearTimeout(drawFallbackTimer);
        drawFallbackTimer = null;
      }
      URL.revokeObjectURL(objectUrl);
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {
        // no-op
      }
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Unable to create video preview."));
    };

    const drawFrame = () => {
      if (settled) return;
      const width = video.videoWidth || 0;
      const height = video.videoHeight || 0;
      if (!width || !height) {
        fail();
        return;
      }

      const maxHeight = 1280;
      const scale = Math.min(1, maxHeight / height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        fail();
        return;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      settled = true;
      cleanup();
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };

    const drawSoon = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(drawFrame);
      });
    };

    const tryPlaybackFallback = () => {
      if (settled) return;
      Promise.resolve(video.play())
        .then(() => {
          setTimeout(() => {
            try {
              video.pause();
            } catch {
              // no-op
            }
            drawSoon();
          }, 140);
        })
        .catch(() => {
          drawSoon();
        });
    };

    const seekToPreviewFrame = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      let targetTime = 0;
      if (duration > 4) {
        targetTime = Math.min(duration - 0.35, 2.2);
      } else if (duration > 1.8) {
        targetTime = Math.min(duration - 0.25, 1.6);
      } else if (duration > 0.5) {
        targetTime = Math.max(0.2, duration * 0.35);
      }
      if (targetTime <= 0) {
        drawSoon();
        return;
      }

      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        drawSoon();
      };
      video.addEventListener("seeked", onSeeked, {once: true});
      try {
        video.currentTime = targetTime;
      } catch {
        video.removeEventListener("seeked", onSeeked);
        drawSoon();
      }
    };

    video.preload = "auto";
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.addEventListener("error", fail, {once: true});
    video.addEventListener("loadedmetadata", () => {
      if (settled) return;
      drawFallbackTimer = setTimeout(tryPlaybackFallback, 900);
      seekToPreviewFrame();
    }, {once: true});
    video.addEventListener("loadeddata", () => {
      if (settled) return;
      drawSoon();
    }, {once: true});
    video.addEventListener("canplay", () => {
      if (settled) return;
      drawSoon();
    }, {once: true});
    video.src = objectUrl;
  });
}

async function generateReferenceVideoPreview(file) {
  const token = ++selectedReferenceVideoPreviewToken;
  selectedReferenceVideoPreviewUrl = "";
  selectedReferenceVideoPreviewLoaded = false;
  refreshReferenceVideoCardMediaUi();

  if (!file) return;

  try {
    const dataUrl = await createReferenceVideoPreviewDataUrl(file);
    if (token !== selectedReferenceVideoPreviewToken) return;
    selectedReferenceVideoPreviewUrl = dataUrl || "";
    selectedReferenceVideoPreviewLoaded = false;
  } catch {
    if (token !== selectedReferenceVideoPreviewToken) return;
    selectedReferenceVideoPreviewUrl = "";
    selectedReferenceVideoPreviewLoaded = false;
  }

  if (token === selectedReferenceVideoPreviewToken) {
    refreshReferenceVideoCardMediaUi();
  }
}

function scrollToPhotoUploadField() {

  const fileInput = $("filePhoto");
  const fieldWrap = fileInput?.closest("div");
  const target = fieldWrap || fileInput || $("generateCard") || $("btnGenerate");
  if (!target) return false;

  target.scrollIntoView({behavior: "smooth", block: "center"});
  return true;
}

function getTemplateCostCredits(template) {
  if (!template) return null;
  const configuredCost = Number(template.costCredits);
  if (Number.isFinite(configuredCost) && configuredCost > 0) {
    return Math.ceil(configuredCost);
  }
  const duration = Number(template.durationSec);
  if (Number.isFinite(duration) && duration > 0) {
    return Math.max(1, Math.ceil(duration));
  }
  return null;
}

async function getSelectedTrendCostCredits() {
  if (
    selectedTrendKind === TREND_SELECTION_REFERENCE &&
    selectedReferenceVideoFile
  ) {
    let duration = selectedReferenceVideoDurationSec;
    if (!Number.isFinite(duration) || duration <= 0) {
      duration = await readVideoFileDurationSeconds(selectedReferenceVideoFile);
      selectedReferenceVideoDurationSec = duration;
    }
    return Math.max(1, Math.ceil(duration));
  }

  return getTemplateCostCredits(selectedTemplate);
}

async function resolveAvailableCreditsBalance() {
  if (Number.isFinite(currentCreditsBalance)) {
    return currentCreditsBalance;
  }

  if (!currentCreditsBalanceRefreshPromise) {
    currentCreditsBalanceRefreshPromise = refreshPlatformMotrendProfile({silent: true})
      .finally(() => {
        currentCreditsBalanceRefreshPromise = null;
      });
  }

  const profile = await currentCreditsBalanceRefreshPromise;
  const refreshedBalance = Number(profile?.creditsBalance);
  return Number.isFinite(refreshedBalance) ? refreshedBalance : Number.NaN;
}

async function ensureSelectedTrendCreditsReady({
  notifyUnknownCost = true,
  notifyUnknownBalance = true,
} = {}) {
  let expectedCostCredits = null;
  try {
    expectedCostCredits = await getSelectedTrendCostCredits();
  } catch {
    if (notifyUnknownCost) {
      await showNoticeModal({
        message: selectedTrendKind === TREND_SELECTION_REFERENCE ?
          "We couldn't read your video length. Re-upload it and try again." :
          "We couldn't verify the credit cost right now. Please try again.",
      });
    }
    return false;
  }

  if (!Number.isFinite(expectedCostCredits) || expectedCostCredits <= 0) {
    return true;
  }

  const availableCredits = await resolveAvailableCreditsBalance();
  if (!Number.isFinite(availableCredits)) {
    if (notifyUnknownBalance) {
      await showNoticeModal({
        message: "We couldn't load your balance yet. Please try again in a moment.",
      });
    }
    return false;
  }

  if (availableCredits < expectedCostCredits) {
    const shortfallCredits = Math.ceil(expectedCostCredits - availableCredits);
    await showNoticeModal({
      message: `You are short ${shortfallCredits} credits`,
      buttonText: "OK",
      onConfirm: () => {
        openWallet();
      },
    });
    return false;
  }

  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uploadFileWithProgress(storageRef, blob, metadata, onProgress, options = {}) {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, blob, metadata);
    const activityTimeoutMs = Number(options?.activityTimeoutMs || 0);
    const stallMessage = typeof options?.stallMessage === "string" && options.stallMessage.trim() ?
      options.stallMessage.trim() :
      "Upload stalled. Please try again.";
    let settled = false;
    let stallTimer = null;

    const clearStallTimer = () => {
      if (!stallTimer) return;
      clearTimeout(stallTimer);
      stallTimer = null;
    };

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearStallTimer();
      callback();
    };

    const refreshActivity = () => {
      if (!activityTimeoutMs || activityTimeoutMs <= 0) {
        return;
      }
      clearStallTimer();
      stallTimer = setTimeout(() => {
        finish(() => {
          try {
            task.cancel();
          } catch {
            // no-op
          }
          const error = new Error(stallMessage);
          error.code = "upload_stalled";
          reject(error);
        });
      }, activityTimeoutMs);
    };

    refreshActivity();

    task.on(
      "state_changed",
      (snapshot) => {
        refreshActivity();
        if (typeof onProgress !== "function") return;
        const total = Number(snapshot?.totalBytes || 0);
        const transferred = Number(snapshot?.bytesTransferred || 0);
        const percent = total > 0 ?
          Math.max(0, Math.min(100, Math.round((transferred / total) * 100))) :
          0;
        onProgress(percent, snapshot);
      },
      (error) => finish(() => reject(error)),
      () => finish(() => resolve(task.snapshot))
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
  const type = typeof file?.type === "string" ? file.type.toLowerCase() : "";
  const name = typeof file?.name === "string" ? file.name.toLowerCase() : "";
  if (name.endsWith(".mov") || type === "video/quicktime") return ".mov";
  return ".mp4";
}

function prepareReferenceVideoInput(file) {
  const type = typeof file?.type === "string" ? file.type.toLowerCase() : "";
  const name = typeof file?.name === "string" ? file.name.toLowerCase() : "";
  const isMp4 = type === "video/mp4" || name.endsWith(".mp4");
  const isMov = type === "video/quicktime" || name.endsWith(".mov");

  if (!file || (!isMp4 && !isMov)) {
    throw new Error("Please upload an MP4 or MOV video.");
  }
  if (file.size > MAX_REFERENCE_VIDEO_BYTES) {
    throw new Error("Reference video is too large. Max file size is 101 MB.");
  }
  const normalizedContentType = isMov ? "video/quicktime" : "video/mp4";
  return {
    blob: file,
    contentType: normalizedContentType,
    extension: guessVideoExtension(file),
  };
}

function normalizePlatformJobRecord(job) {
  const refundCredits = Number(job?.refundCredits);
  const outputUrl = safeUrl(
    typeof job?.providerOutputUrl === "string" ? job.providerOutputUrl : ""
  );
  const errorText = typeof job?.reconciliationError === "string" ?
    job.reconciliationError :
    "";

  return {
    id: typeof job?.id === "string" ? job.id : "",
    data: {
      status: typeof job?.status === "string" ? job.status : "pending",
      selectionKind: job?.selectionKind === TREND_SELECTION_REFERENCE ?
        TREND_SELECTION_REFERENCE :
        TREND_SELECTION_TEMPLATE,
      templateId: typeof job?.templateId === "string" ? job.templateId : "",
      inputImagePath: typeof job?.inputImagePath === "string" ? job.inputImagePath : "",
      referenceVideoPath: typeof job?.referenceVideoPath === "string" ? job.referenceVideoPath : "",
      debitedCredits: Number.isFinite(Number(job?.debitedCredits)) ?
        Number(job.debitedCredits) :
        null,
      finalCostCredits: Number.isFinite(Number(job?.finalCostCredits)) ?
        Number(job.finalCostCredits) :
        null,
      refundCredits: Number.isFinite(refundCredits) ? refundCredits : null,
      providerState: typeof job?.providerState === "string" ? job.providerState : "",
      kling: {
        outputUrl,
        error: errorText,
      },
      refund: Number.isFinite(refundCredits) && refundCredits > 0 ?
        {
          applied: true,
          amount: refundCredits,
        } :
        {
          applied: false,
          amount: 0,
        },
      createdAt: job?.createdAt || null,
      updatedAt: job?.updatedAt || null,
    },
  };
}

function normalizePlatformTemplateRecord(template) {
  const preview = template?.preview && typeof template.preview === "object" ?
    template.preview :
    {};

  return {
    id: typeof template?.id === "string" && template.id.trim() ?
      template.id.trim() :
      (typeof template?.code === "string" ? template.code.trim() : ""),
    code: typeof template?.code === "string" ? template.code.trim() : "",
    title: typeof template?.title === "string" && template.title.trim() ?
      template.title.trim() :
      (typeof template?.name === "string" && template.name.trim() ?
        template.name.trim() :
        "Template"),
    name: typeof template?.name === "string" ? template.name.trim() : "",
    durationSec: Number.isFinite(Number(template?.durationSec)) ?
      Number(template.durationSec) :
      null,
    modeDefault: typeof template?.modeDefault === "string" &&
      template.modeDefault.trim() ?
      template.modeDefault.trim() :
      "std",
    costCredits: Number.isFinite(Number(template?.costCredits)) ?
      Number(template.costCredits) :
      null,
    referenceVideoUrl: typeof template?.referenceVideoUrl === "string" ?
      template.referenceVideoUrl :
      "",
    preview: {
      thumbnailUrl: typeof preview?.thumbnailUrl === "string" ?
        preview.thumbnailUrl :
        "",
      previewVideoUrl: typeof preview?.previewVideoUrl === "string" ?
        preview.previewVideoUrl :
        "",
    },
  };
}

async function prepareMotrendJobRequest(payload) {
  return await platformMotrendRequest("/motrend/jobs/prepare", {
    method: "POST",
    body: payload,
  });
}

async function finalizeMotrendJobRequest(payload) {
  const response = await platformMotrendRequest("/motrend/jobs/finalize", {
    method: "POST",
    body: payload,
  });
  await refreshPlatformMotrendProfile();
  return response;
}

async function createMotrendJobShareRequest(jobId) {
  return await platformMotrendRequest(`/motrend/jobs/${encodeURIComponent(jobId)}/share`, {
    method: "POST",
  });
}

async function refreshMotrendJobRequest(jobId) {
  const response = await platformMotrendRequest(`/motrend/jobs/${encodeURIComponent(jobId)}/refresh`, {
    method: "POST",
  });
  await refreshPlatformMotrendProfile();
  return response;
}

async function prepareMotrendDownloadRequest(jobId) {
  const response = await platformMotrendRequest(`/motrend/jobs/${encodeURIComponent(jobId)}/prepare-download`, {
    method: "POST",
  });
  await refreshPlatformMotrendProfile();
  return response;
}

async function listMotrendJobsRequest() {
  const response = await platformMotrendRequest("/motrend/jobs");
  const jobs = Array.isArray(response?.jobs) ? response.jobs : [];
  return {
    jobs: jobs.map((job) => normalizePlatformJobRecord(job)),
  };
}

async function getOrCreatePublicShare(jobId) {
  const normalizedJobId = typeof jobId === "string" ? jobId.trim() : "";
  if (!normalizedJobId) {
    throw new Error("Share link is unavailable.");
  }

  const cached = publicShareByJobId.get(normalizedJobId);
  if (cached?.shareUrl) {
    return cached;
  }

  if (!publicSharePromiseByJobId.has(normalizedJobId)) {
    const requestPromise = createMotrendJobShareRequest(normalizedJobId)
      .then((payload) => {
        if (payload && typeof payload === "object") {
          publicShareByJobId.set(normalizedJobId, payload);
        }
        return payload;
      })
      .finally(() => {
        publicSharePromiseByJobId.delete(normalizedJobId);
      });
    publicSharePromiseByJobId.set(normalizedJobId, requestPromise);
  }

  return await publicSharePromiseByJobId.get(normalizedJobId);
}

async function prepareDownloadLink(jobId) {
  for (let attempt = 0; attempt < PREPARE_DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
    const payload = await prepareMotrendDownloadRequest(jobId);
    const inlineUrl = safeUrl(
      typeof payload.inlineUrl === "string" ? payload.inlineUrl : ""
    );
    const downloadUrl = safeUrl(
      typeof payload.downloadUrl === "string" ? payload.downloadUrl : ""
    );
    if (inlineUrl || downloadUrl) {
      return {
        inlineUrl: inlineUrl || downloadUrl,
        downloadUrl: downloadUrl || inlineUrl,
      };
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
    setSupportCodeUi("");
    isAdminUser = false;
    setAdminCardVisible(false);
    return;
  }

  try {
    const payload = currentPlatformMotrendProfile ||
      await refreshPlatformMotrendProfile({silent: false});
    const supportCode = resolveKnownSupportCode(payload);
    isAdminUser = payload?.isAdmin === true;
    setSupportCodeUi(supportCode);
    setAdminCardVisible(isAdminUser);
  } catch (error) {
    isAdminUser = false;
    setAdminCardVisible(false);
    console.warn("getSupportProfile failed", error);
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
    markAuthAttemptCookie();
    track("login_click", {method: "email"});
    await ensurePreferredAuthPersistence();
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
    markAuthAttemptCookie();
    track("signup_click", {method: "email"});
    await ensurePreferredAuthPersistence();
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
    markAuthAttemptCookie();
    track("login_click", {method: "google"});
    await ensurePreferredAuthPersistence();
    if (forceRedirect) {
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
        await ensurePreferredAuthPersistence();
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
  clearAuthAttemptCookie();
  clearAuthSuccessCookie();
  await Promise.race([
    logoutPlatformSession(),
    new Promise((resolve) => {
      setTimeout(resolve, PLATFORM_LOGOUT_TIMEOUT_MS);
    }),
  ]);
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

if ($("btnWalletClose")) {
  $("btnWalletClose").onclick = () => {
    closeWalletModal();
  };
}

const walletModalEl = $("walletModal");
if (walletModalEl) {
  walletModalEl.addEventListener("click", (event) => {
    if (event.target === walletModalEl) {
      closeWalletModal();
    }
  });
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
  card.style.display = "flex";
  card.style.flexDirection = "column";
  card.dataset.trendRole = "reference";

  const media = document.createElement("div");
  media.className = "tplMedia";

  const placeholder = document.createElement("div");
  placeholder.className = "refPlaceholder";
  const placeholderContent = document.createElement("div");
  placeholderContent.className = "refPlaceholderContent";
  const placeholderTitle = document.createElement("div");
  placeholderTitle.className = "refPlaceholderTitle";
  placeholderTitle.textContent = "Your video reference";
  const placeholderSub = document.createElement("div");
  placeholderSub.className = "refPlaceholderSub";
  placeholderSub.textContent = "Choose mp4 or mov";
  placeholderContent.appendChild(placeholderTitle);
  placeholderContent.appendChild(placeholderSub);
  placeholder.appendChild(placeholderContent);
  media.appendChild(placeholder);

  const previewImg = document.createElement("img");
  previewImg.className = "refPreviewImage";
  previewImg.alt = "Your video reference preview";
  previewImg.style.display = "none";
  previewImg.onload = () => {
    selectedReferenceVideoPreviewLoaded = true;
    refreshReferenceVideoCardMediaUi();
  };
  previewImg.onerror = () => {
    selectedReferenceVideoPreviewLoaded = false;
    refreshReferenceVideoCardMediaUi();
  };
  media.appendChild(previewImg);

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

  const estimate = document.createElement("div");
  estimate.className = "refCostEstimate";
  const initialEstimate = getReferenceVideoCostEstimatePresentation();
  estimate.textContent = initialEstimate.text;
  estimate.title = initialEstimate.title;
  estimate.classList.toggle("isVisible", initialEstimate.visible);

  const actionBtn = document.createElement("button");
  actionBtn.className = "btn tplUse";
  actionBtn.style.marginTop = "auto";
  actionBtn.style.width = "100%";
  actionBtn.textContent = "Upload";

  const picker = $("fileReferenceVideo");

  const activateReferenceSelection = () => {
    if (!selectedReferenceVideoFile && !hasUploadedReferenceVideo()) {
      return false;
    }
    selectedTrendKind = TREND_SELECTION_REFERENCE;
    if (!selectedTemplate && availableTemplates.length > 0) {
      selectedTemplate = availableTemplates[0];
    }
    syncTrendSelectionUi();
    return true;
  };

  card.onclick = () => {
    if (activateReferenceSelection()) {
      return;
    }
    openReferenceVideoPicker({enableScrollAfterPick: false});
  };
  actionBtn.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    activateReferenceSelection();
    openReferenceVideoPicker({enableScrollAfterPick: true});
  };

  if (picker) {
    picker.onchange = () => {
      const file = picker.files?.[0] || null;
      const fileToken = ++selectedReferenceVideoFileToken;
      selectedReferenceVideoFile = file;
      selectedReferenceVideoName = file ? file.name : "";
      selectedReferenceVideoUploadState = file ? "selected" : "idle";
      selectedReferenceVideoDurationSec = null;
      resetReferenceVideoUploadTracking();
      selectedReferenceVideoUploadTransferredBytes = 0;
      selectedReferenceVideoUploadTotalBytes = file?.size || 0;
      resetReferenceVideoPreview();

      if (file) {
        selectedTrendKind = TREND_SELECTION_REFERENCE;
        if (!selectedTemplate && availableTemplates.length > 0) {
          selectedTemplate = availableTemplates[0];
        }
        void updateSelectedReferenceVideoDuration(file);
        generateReferenceVideoPreview(file);
        void maybeStartReferenceVideoAutoUpload(fileToken);
      } else if (selectedTrendKind === TREND_SELECTION_REFERENCE) {
        selectedTrendKind = TREND_SELECTION_TEMPLATE;
      }

      refreshReferenceVideoCardUi();
      syncTrendSelectionUi();
      if (file && referenceVideoScrollAfterPick) {
        scrollToPhotoUploadField();
      }
      referenceVideoScrollAfterPick = false;
    };
  }

  card.appendChild(media);
  card.appendChild(title);
  card.appendChild(meta);
  card.appendChild(estimate);
  card.appendChild(actionBtn);
  refreshReferenceVideoCardUi();

  return card;
}

function renderTemplateCard(template) {
  const card = document.createElement("div");
  card.className = "card tplCard";
  card.style.margin = "0";
  card.style.cursor = "pointer";
  card.style.display = "flex";
  card.style.flexDirection = "column";
  card.dataset.templateId = template.id;

  const thumbUrl = safeUrl(template.preview?.thumbnailUrl || "");
  const videoUrl = safeUrl(template.preview?.previewVideoUrl || "");
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
  meta.textContent = buildTemplateCostLabel(template);

  const useBtn = document.createElement("button");
  useBtn.className = "btn tplUse";
  useBtn.style.marginTop = "auto";
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
    '<div class="templatesLoading"><span class="spinner"></span>Loading...</div>';

  try {
    const response = await listPlatformTemplatesRequest();
    availableTemplates = Array.isArray(response?.templates) ?
      response.templates.map((template) => normalizePlatformTemplateRecord(template)) :
      [];

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
      (selectedReferenceVideoFile || selectedReferenceVideoUploadedReferencePath) &&
      !selectedTemplate &&
      availableTemplates.length > 0
    ) {
      selectedTemplate = availableTemplates[0];
    }

    container.innerHTML = "";

    if (!availableTemplates.length) {
      availableTemplates = [];
      const empty = document.createElement("div");
      empty.className = "templatesLoading muted";
      empty.textContent = "No templates yet.";
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

function statusLabel(status) {
  if (status === "awaiting_upload") return "awaiting upload";
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

function getResumeUploadDelayMs(job) {
  const elapsed = Math.max(0, Date.now() - getJobStartedAtMs(job));
  return Math.max(0, RESUME_UPLOAD_DELAY_MS - elapsed);
}

function formatRemainingMinutes(ms) {
  const minutes = Math.max(1, Math.ceil(Math.max(0, Number(ms) || 0) / 60000));
  return `${minutes} min`;
}

function resumeEstimatedProgressFromJob(jobId, job) {
  if (!jobId) return;
  const startedAtMs = getJobStartedAtMs(job);
  resumeEstimatedProgress(jobId, startedAtMs, "Generating your trend…");
}

function setPendingResumeUpload(jobId, job) {
  const uploadPath = typeof job?.inputImagePath === "string" ?
    job.inputImagePath :
    "";
  const templateId = typeof job?.templateId === "string" ? job.templateId : "";
  if (!jobId || !uploadPath || !templateId) {
    pendingResumeUpload = null;
    return;
  }

  const selectionKind = job?.selectionKind === TREND_SELECTION_REFERENCE ?
    TREND_SELECTION_REFERENCE :
    job?.selectionKind === TREND_SELECTION_TEMPLATE ?
      TREND_SELECTION_TEMPLATE :
      "unknown";

  pendingResumeUpload = {
    jobId,
    uploadPath,
    templateId,
    selectionKind,
  };
  persistReferenceUploadResumeState();
}

function clearPendingResumeUpload(jobId = "") {
  if (!pendingResumeUpload) return;
  if (!jobId || pendingResumeUpload.jobId === jobId) {
    pendingResumeUpload = null;
    persistReferenceUploadResumeState();
  }
}

function applyReferenceUploadResumeState(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }

  pendingResumeUpload = snapshot.pendingResumeUpload || null;
  selectedReferenceVideoUploadedJobId = snapshot.uploadedJobId || "";
  selectedReferenceVideoUploadedInputPath = snapshot.uploadedInputPath || "";
  selectedReferenceVideoUploadedReferencePath = snapshot.uploadedReferencePath || "";
  selectedReferenceVideoName = snapshot.referenceVideoName || "";

  if (hasUploadedReferenceVideo()) {
    selectedReferenceVideoUploadState = "uploaded";
    selectedReferenceVideoUploadProgress = 100;
    selectedTrendKind = TREND_SELECTION_REFERENCE;
  }
}

function syncReferenceResumeStateWithLatestJobs() {
  if (!pendingResumeUpload?.jobId) {
    return;
  }

  const matchingJob = latestJobs.find((entry) => entry.id === pendingResumeUpload.jobId);
  const stillAwaitingUpload = matchingJob?.data?.status === "awaiting_upload";
  if (stillAwaitingUpload) {
    return;
  }

  pendingResumeUpload = null;
  selectedReferenceVideoUploadedJobId = "";
  selectedReferenceVideoUploadedInputPath = "";
  selectedReferenceVideoUploadedReferencePath = "";
  selectedReferenceVideoName = "";
  selectedReferenceVideoUploadState = "idle";
  persistReferenceUploadResumeState();
  refreshReferenceVideoCardUi();
  refreshGenerateButtonState();
}

async function maybeShowJobFailureNotice(jobId, job) {
  if (!jobId || !job || job.status !== "failed" || wasJobNoticeShown(jobId)) {
    return;
  }

  const errorText = String(job?.kling?.error || "");
  const refundAmount = Number(job?.refund?.amount || 0);
  const refunded = job?.refund?.applied === true && refundAmount > 0;
  const uploadTimedOut = errorText.includes("Upload timed out before finalize.");

  let message = "";
  if (refunded) {
    message = `Failed. ${refundAmount} credits returned.`;
  } else if (uploadTimedOut && !(Number(job?.debitedCredits || 0) > 0)) {
    message = "Upload failed. No credits charged.";
  }

  if (!message) return;

  markJobNoticeShown(jobId);
  await showNoticeModal({
    message,
    buttonText: "OK",
  });
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
  const activeReferenceUploadForJob = (
    selectedReferenceVideoUploadState === "uploading" &&
    !!pendingResumeUpload?.jobId &&
    pendingResumeUpload.jobId === jobId
  );

  if (activeReferenceUploadForJob) {
    setStatus(buildReferenceVideoUploadStatus());
    setStatusHintText(LARGE_UPLOAD_HINT_TEXT);
    setStatusHintVisible(true);
    return;
  }

  if (status === "done" && outputUrl && jobId) {
    if (trackedCurrentJob) {
      completeEstimatedProgress();
    } else {
      setStatus("Done. Download ready.");
      setStatusHintVisible(false);
    }
    return;
  }

  if (status === "awaiting_upload") {
    if (trackedCurrentJob) {
      setEstimatedProgressLabel("Uploading files…");
    } else {
      const resumeDelayMs = getResumeUploadDelayMs(job);
      if (resumeDelayMs > 0) {
        setStatus(
          `Upload not completed yet. Resume will be available in ~${formatRemainingMinutes(resumeDelayMs)}.`
        );
      } else {
        setStatus("Upload paused. Tap Resume upload to continue.");
      }
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

async function handleResumeUpload(jobId) {
  if (!currentUser || !jobId) return;

  const item = latestJobs.find((entry) => entry.id === jobId);
  const job = item?.data || null;
  if (!job || job.status !== "awaiting_upload") return;

  const templateId = typeof job.templateId === "string" ? job.templateId : "";
  const template = availableTemplates.find((entry) => entry.id === templateId) || null;
  if (!template) {
    showFormError("This upload can no longer be resumed. Please start a new one.");
    return;
  }

  const resumeSelectionKind = job.selectionKind === TREND_SELECTION_REFERENCE ?
    TREND_SELECTION_REFERENCE :
    job.selectionKind === TREND_SELECTION_TEMPLATE ?
      TREND_SELECTION_TEMPLATE :
      "unknown";

  selectedTemplate = template;
  if (resumeSelectionKind !== "unknown") {
    selectedTrendKind = resumeSelectionKind;
  }
  setPendingResumeUpload(jobId, job);
  syncTrendSelectionUi();
  scrollToPhotoUploadField();

  const message = resumeSelectionKind === TREND_SELECTION_REFERENCE ?
    "Upload your video and photo again, then tap Generate. No credits charged." :
    resumeSelectionKind === TREND_SELECTION_TEMPLATE ?
      "Upload your photo again, then tap Generate. No credits charged." :
      "Upload your files again, then tap Generate. No credits charged.";

  await showNoticeModal({
    message,
    buttonText: "OK",
  });

  if (resumeSelectionKind === TREND_SELECTION_REFERENCE) {
    await openReferenceVideoPicker({enableScrollAfterPick: true});
  } else if (resumeSelectionKind === TREND_SELECTION_TEMPLATE) {
    await openPhotoPicker();
  }
}

function renderAwaitingUploadActions(jobId) {
  const wrapper = document.createElement("div");
  wrapper.style.marginTop = "8px";
  const item = latestJobs.find((entry) => entry.id === jobId);
  const job = item?.data || null;
  const resumeDelayMs = getResumeUploadDelayMs(job);

  if (resumeDelayMs <= 0) {
    const resumeBtn = document.createElement("button");
    resumeBtn.className = "btn2";
    resumeBtn.textContent = "Resume upload";
    resumeBtn.style.width = "100%";
    resumeBtn.style.fontSize = "18px";
    resumeBtn.style.opacity = "0.84";
    resumeBtn.onclick = () => {
      handleResumeUpload(jobId);
    };
    wrapper.appendChild(resumeBtn);
  }

  const hint = document.createElement("div");
  hint.className = "muted jobsHint";
  hint.textContent = resumeDelayMs > 0 ?
    `Resume appears in ~${formatRemainingMinutes(resumeDelayMs)} if needed.` :
    "Upload interrupted. Resume with no extra charge.";
  wrapper.appendChild(hint);

  return wrapper;
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
  if ((!currentUser && !hasPlatformCabinetSession()) || !jobId || preparingDownloadJobIds.has(jobId)) return;

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
  const storedPreparedState = preparedDownloadByJobId.get(jobId);
  const preparedState = typeof storedPreparedState === "string" ?
    {downloadUrl: storedPreparedState} :
    (storedPreparedState || {});
  const inlineUrl = safeUrl(
    preparedState.inlineUrl || preparedState.downloadUrl || ""
  );
  const preparedUrl = safeUrl(
    preparedState.downloadUrl || preparedState.inlineUrl || ""
  );
  const saveVideoPageUrl = buildSaveVideoPageUrl(inlineUrl, preparedUrl);
  const saveVideoTargetUrl = preparedUrl || inlineUrl || saveVideoPageUrl;
  const watchTargetUrl = saveVideoPageUrl || inlineUrl || preparedUrl;
  const hasPreparedVideo = Boolean(preparedUrl || inlineUrl);

  const shareBtn = document.createElement("button");
  shareBtn.className = "btn2";
  shareBtn.textContent = "Share";
  shareBtn.onclick = async () => {
    let copiedToClipboard = false;
    let sharedNatively = false;
    try {
      shareBtn.disabled = true;
      shareBtn.textContent = "Preparing…";
      const sharePayload = await getOrCreatePublicShare(jobId);
      const shareTargetUrl = safeUrl(
        typeof sharePayload?.shareUrl === "string" ? sharePayload.shareUrl : ""
      );
      if (!shareTargetUrl) {
        throw new Error("Share link is not ready yet.");
      }

      shareBtn.textContent = "Share";
      if (navigator.share) {
        try {
          await navigator.share({
            title: sharePayload?.title || "MoTrend© video",
            text: sharePayload?.description || "",
            url: shareTargetUrl,
          });
          sharedNatively = true;
        } catch (error) {
          if (error && error.name === "AbortError") {
            sharedNatively = true;
          } else {
            throw error;
          }
        }
      }

      if (!sharedNatively) {
        await navigator.clipboard.writeText(shareTargetUrl);
        copiedToClipboard = true;
        shareBtn.textContent = "URL copied";
        setTimeout(() => {
          shareBtn.textContent = "Share";
          shareBtn.disabled = false;
        }, 700);
      }
    } catch (error) {
      shareBtn.textContent = "Share";
      shareBtn.disabled = false;
      showFormError(callableErrorMessage(error) || "Unable to share link. Please try again.");
      return;
    }

    if (!copiedToClipboard) {
      shareBtn.textContent = "Share";
      shareBtn.disabled = false;
    }
  };

  if (!hasPreparedVideo) {
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
    actions.appendChild(shareBtn);
    return wrapper;
  }

  const saveVideoBtn = document.createElement("a");
  saveVideoBtn.className = "btnDownloadPrimary";
  saveVideoBtn.textContent = "Save video";
  saveVideoBtn.href = saveVideoTargetUrl;
  actions.appendChild(saveVideoBtn);

  const watchBtn = document.createElement("a");
  watchBtn.className = "btn";
  watchBtn.textContent = "Watch video";
  watchBtn.href = shouldUseRedirectLogin() ?
    buildExternalBrowserUrlFor(watchTargetUrl) :
    watchTargetUrl;
  watchBtn.target = "_blank";
  watchBtn.rel = "noopener noreferrer";
  actions.appendChild(watchBtn);

  actions.appendChild(shareBtn);

  const fallbackHint = document.createElement("div");
  fallbackHint.className = "muted jobsHint";
  fallbackHint.textContent =
    "If Save video does not start, tap Watch video.";
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
        if ((!currentUser && !hasPlatformCabinetSession()) || refreshingJobIds.has(item.id)) return;
        clearFormError();
        refreshingJobIds.add(item.id);
        renderJobsList();

        try {
          const payload = await refreshMotrendJobRequest(item.id);
          const queuedForRefresh = payload?.queuedForRefresh === true;
          if (queuedForRefresh) {
            const retryAfterMs = (
              typeof payload?.retryAfterMs === "number" &&
              payload.retryAfterMs > 0
            ) ? payload.retryAfterMs : 2000;
            const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
            setStatus(
              payload?.dispatchDeferred === true ?
                `Refresh queued, but background dispatch is delayed. Check again in ~${retryAfterSec}s.` :
                `Refresh queued. Check again in ~${retryAfterSec}s.`
            );
          }
          const idx = latestJobs.findIndex((entry) => entry.id === item.id);
          if (idx >= 0 && payload && typeof payload === "object") {
            const status = typeof payload.status === "string" ?
              payload.status :
              latestJobs[idx].data?.status;
            const outputUrl = safeUrl(
              typeof payload?.providerOutputUrl === "string" ?
                payload.providerOutputUrl :
                latestJobs[idx].data?.kling?.outputUrl || ""
            );
            const kling = {
              ...(latestJobs[idx].data?.kling || {}),
              outputUrl,
            };

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

    if (job?.status === "awaiting_upload") {
      itemWrap.appendChild(renderAwaitingUploadActions(item.id));
    } else if (isDoneWithOutput(item)) {
      itemWrap.appendChild(renderDoneJobActions(item.id));
      const retentionHint = document.createElement("div");
      retentionHint.className = "muted jobsHint";
      retentionHint.textContent =
        "Prepared links are temporary. If they expire, prepare them again.";
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

function watchLatestJobsPlatform() {
  let cancelled = false;
  let pollTimer = null;
  let pollInFlight = false;
  let pollErrorCount = 0;

  const scheduleNextPoll = (delayMs) => {
    if (cancelled) return;
    pollTimer = setTimeout(() => {
      void poll();
    }, delayMs);
  };

  const poll = async () => {
    if (cancelled || (!currentUser && !hasPlatformCabinetSession()) || pollInFlight) return;
    pollInFlight = true;

    try {
      const response = await listMotrendJobsRequest();
      if (cancelled) return;
      pollErrorCount = 0;

      latestJobs = response?.jobs || [];
      if (!latestJobs.length) {
        preparedDownloadByJobId.clear();
        preparingDownloadJobIds.clear();
        clearPendingResumeUpload();
        renderJobsList();
        scheduleNextPoll(10_000);
        return;
      }

      if (pendingResumeUpload) {
        const pendingJob = latestJobs.find((entry) => entry.id === pendingResumeUpload.jobId);
        if (!pendingJob || pendingJob.data?.status !== "awaiting_upload") {
          clearPendingResumeUpload();
        }
      }

      prunePreparedDownloadState();
      syncReferenceResumeStateWithLatestJobs();
      renderJobsList();

      const latestFailed = latestJobs.find((item) => item.data?.status === "failed");
      if (latestFailed) {
        void maybeShowJobFailureNotice(latestFailed.id, latestFailed.data);
      }

      const hasActiveJob = latestJobs.some((item) => {
        const status = item?.data?.status || "";
        return (
          status === "awaiting_upload" ||
          status === "queued" ||
          status === "processing"
        );
      });
      scheduleNextPoll(hasActiveJob ? 2500 : 10_000);
    } catch (error) {
      if (cancelled) return;
      console.warn("platform jobs poll failed", error);
      pollErrorCount += 1;
      const baseDelayMs = isPlatformAuthError(error) ?
        PLATFORM_POLL_AUTH_RETRY_MS :
        PLATFORM_POLL_ERROR_RETRY_MS;
      const backoffMs = Math.min(
        Math.round(baseDelayMs * Math.pow(1.5, pollErrorCount - 1)),
        PLATFORM_POLL_MAX_BACKOFF_MS
      );
      scheduleNextPoll(backoffMs);
    } finally {
      pollInFlight = false;
    }
  };

  void poll();

  return () => {
    cancelled = true;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };
}

function watchLatestJobs() {
  return watchLatestJobsPlatform();
}

$("btnGenerate").onclick = async () => {
  clearFormError();

  if (generateSubmissionInFlight) {
    setStatus("Upload already in progress…");
    setStatusHintVisible(false);
    return;
  }

  if (!(await ensureSignedInForAction("Sign in to upload a photo and generate."))) {
    return;
  }

  if (!selectedTemplate) {
    showFormError("Pick a template first.");
    return;
  }

  if (
    selectedTrendKind === TREND_SELECTION_REFERENCE &&
    !hasUploadedReferenceVideo()
  ) {
    showFormError("Wait for your reference video upload to finish.");
    return;
  }

  const rawFile = $("filePhoto").files?.[0];
  if (!rawFile) {
    showFormError("Upload a photo.");
    return;
  }

  const creditsReady = await ensureSelectedTrendCreditsReady();
  if (!creditsReady) {
    return;
  }

  const btn = $("btnGenerate");
  generateSubmissionInFlight = true;
  btn.disabled = true;
  stopEstimatedProgress();
  setStatus("Preparing upload…");
  setStatusHintVisible(false);
  setUploadSafetyHint("", false);

  try {
    let jobId = "";
    let uploadPath = "";
    const shouldReusePendingUpload = !!pendingResumeUpload &&
      pendingResumeUpload.templateId === selectedTemplate.id &&
      (
        pendingResumeUpload.selectionKind === "unknown" ||
        pendingResumeUpload.selectionKind === selectedTrendKind
      );

    if (shouldReusePendingUpload) {
      jobId = pendingResumeUpload.jobId;
      uploadPath = pendingResumeUpload.uploadPath;
    } else if (selectedTrendKind !== TREND_SELECTION_REFERENCE) {
      const clientRequestId = createClientRequestId("gen");
      const response = await prepareMotrendJobRequest({
        templateId: selectedTemplate.id,
        selectionKind: selectedTrendKind,
        clientRequestId,
      });
      jobId = response?.jobId || "";
      uploadPath = response?.uploadPath || "";
      setPendingResumeUpload(jobId, {
        templateId: selectedTemplate.id,
        inputImagePath: uploadPath,
        selectionKind: selectedTrendKind,
      });
    }

    if (!jobId || !uploadPath) {
      throw new Error("prepare job returned empty payload");
    }
    attachEstimatedProgressJob(jobId);
    setStatus("Uploading files… 0%");

    let referenceVideoPath = "";
    const useReferenceVideo = (
      selectedTrendKind === TREND_SELECTION_REFERENCE &&
      (hasUploadedReferenceVideo() || !!selectedReferenceVideoFile)
    );
    const referenceVideoWasPendingAtGenerate = (
      useReferenceVideo &&
      !!selectedReferenceVideoFile &&
      selectedReferenceVideoUploadState !== "uploaded"
    );
    if (useReferenceVideo) {
      if (hasUploadedReferenceVideo()) {
        setStatus("Reference video is ready.");
        jobId = selectedReferenceVideoUploadedJobId || jobId;
        uploadPath = selectedReferenceVideoUploadedInputPath || uploadPath;
        referenceVideoPath = selectedReferenceVideoUploadedReferencePath || "";
      } else if (selectedReferenceVideoFile) {
        setStatus("Waiting for reference video upload…");
        const uploadedReference = await ensureReferenceVideoUploaded({surfaceStatus: true});
        jobId = uploadedReference?.jobId || jobId;
        uploadPath = uploadedReference?.uploadPath || uploadPath;
        referenceVideoPath = uploadedReference?.referenceVideoPath || "";
      }
    }

    setStatus("Preparing photo…");
    setStatusHintVisible(false);
    setStatusHintText(PROGRESS_HINT_TEXT);
    const uploadInput = await prepareUploadImage(rawFile);

    setStatus("Uploading photo… 0%");
    const photoRef = ref(storage, uploadPath);
    await uploadFileWithProgress(
      photoRef,
      uploadInput.blob,
      {contentType: uploadInput.contentType || "image/jpeg"},
      (percent, snapshot) => {
        const transferredLabel = formatUploadMegabytes(snapshot?.bytesTransferred);
        const totalLabel = formatUploadMegabytes(snapshot?.totalBytes);
        setStatus(
          `Uploading photo… ${percent}% (${transferredLabel} / ${totalLabel})`
        );
      }
    );

    setStatus("Finalizing upload…");
    const finalizePayload = await finalizeMotrendJobRequest({
      jobId,
      inputImagePath: uploadPath,
      referenceVideoPath: referenceVideoPath || undefined,
    });
    clearPendingResumeUpload(jobId);
    setUploadSafetyHint(
      "You can close this page now. Your trend will keep generating in the background.",
      true
    );

    startEstimatedProgress("Generating your trend…");
    attachEstimatedProgressJob(jobId);
    if (finalizePayload?.dispatchDeferred === true) {
      setStatus("Upload finished. Background queue is retrying — generation may start a bit later.");
    }
    if (
      useReferenceVideo &&
      referenceVideoWasPendingAtGenerate &&
      !getStoredFlag(getReferenceVideoUploadNoticeKey(currentUser?.uid || ""))
    ) {
      setStoredFlag(getReferenceVideoUploadNoticeKey(currentUser?.uid || ""), true);
      await showNoticeModal({
        message:
          "Video upload is complete. You can now close this window — your trend will keep generating in the background.",
        buttonText: "OK",
      });
    }
  } catch (error) {
    stopEstimatedProgress();
    setStatus("");
    setUploadSafetyHint("", false);
    if (
      selectedTrendKind === TREND_SELECTION_REFERENCE &&
      selectedReferenceVideoFile
    ) {
      selectedReferenceVideoUploadState = "error";
      refreshReferenceVideoCardUi();
    }
    const activeJobConflict = extractActiveJobConflict(error);
    if (activeJobConflict) {
      const statusLabel = activeJobConflict.activeStatus === "awaiting_upload" ?
        "upload" :
        "generation";
      await showNoticeModal({
        message: `Please finish your current ${statusLabel} before starting a new trend.`,
        buttonText: activeJobConflict.activeStatus === "awaiting_upload" ?
          "Resume upload" :
          "OK",
        onConfirm: () => {
          const awaitingJob = latestJobs.find(
            (entry) => entry.id === activeJobConflict.activeJobId
          );
          if (awaitingJob?.data?.status === "awaiting_upload") {
            setPendingResumeUpload(activeJobConflict.activeJobId, {
              templateId: awaitingJob.data?.templateId || "",
              inputImagePath: awaitingJob.data?.inputImagePath || "",
              selectionKind: awaitingJob.data?.selectionKind || "unknown",
            });
            renderJobsList();
          }
        },
      });
      return;
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

    if (!(await ensureSignedInForAction("Sign in to upload a photo."))) {
      event.preventDefault();
      return;
    }

    if (shouldUseRedirectLogin() || hasSeenHint(PHOTO_HINT_KEY)) return;

    event.preventDefault();
    await maybeShowUploadHint(PHOTO_HINT_KEY, PHOTO_HINT_MESSAGE);
    fileInput.click();
  });
}

await ensurePreferredAuthPersistence();

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
  if (typeof unsubscribeJobs === "function") {
    unsubscribeJobs();
    unsubscribeJobs = null;
  }

  const previousUserUid = currentUser?.uid || "";
  currentUser = user;
  markAuthRestoreReady();
  $("app").style.display = "block";

  if (!user) {
    clearPlatformSessionState();
    clearReferenceUploadResumeState(previousUserUid);
    setStoredFlag(GIFT_CREDITS_PENDING_KEY, false, sessionStorage);
    setStoredNumber(GIFT_CREDITS_AMOUNT_KEY, Number.NaN, sessionStorage);
    $("userLine").textContent = "Guest";
    renderCreditsBadge(0);
    renderLocaleFields();
    selectedTemplate = null;
    selectedTrendKind = TREND_SELECTION_TEMPLATE;
    availableTemplates = [];
    stopEstimatedProgress();
    updateSelectedTrendField();
    selectedReferenceVideoFile = null;
    selectedReferenceVideoName = "";
    selectedReferenceVideoUploadState = "idle";
    selectedReferenceVideoUploadProgress = 0;
    selectedReferenceVideoUploadTransferredBytes = 0;
    selectedReferenceVideoUploadTotalBytes = 0;
    selectedReferenceVideoDurationSec = null;
    selectedReferenceVideoFileToken += 1;
    resetReferenceVideoUploadTracking();
    resetReferenceVideoPreview();
    clearPendingResumeUpload();
    const referencePicker = $("fileReferenceVideo");
    if (referencePicker) {
      referencePicker.value = "";
    }
    setSupportCodeUi("");
    isAdminUser = false;
    setAdminCardVisible(false);
    $("userCard").style.display = "none";
    $("jobsCard").style.display = "none";
    $("btnWallet").style.display = "none";
    $("btnLogout").style.display = "none";
    $("supportBtn").style.display = "none";
    const restoredGuestCabinet = await restoreGuestCabinetFromCookie();
    if (restoredGuestCabinet) {
      closeAuth();
      updateAuthInAppActions();
      setStatus("");
      await loadTemplates();
      $("jobs").textContent = "Loading trends…";
      unsubscribeJobs = watchLatestJobs();
      return;
    }

    if (shouldKeepAuthOpenAfterAttempt()) {
      openAuth("", {skipPromo: true});
    } else {
      closeAuth();
    }
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
  markAuthSuccessCookie();
  clearAuthAttemptCookie();
  stopEstimatedProgress();
  clearPlatformSessionState();
  selectedReferenceVideoFile = null;
  selectedReferenceVideoName = "";
  selectedReferenceVideoUploadState = "idle";
  selectedReferenceVideoUploadProgress = 0;
  selectedReferenceVideoUploadTransferredBytes = 0;
  selectedReferenceVideoUploadTotalBytes = 0;
  selectedReferenceVideoDurationSec = null;
  selectedReferenceVideoFileToken += 1;
  resetReferenceVideoUploadTracking();
  resetReferenceVideoPreview();
  applyReferenceUploadResumeState(readReferenceUploadResumeState(user.uid));
  refreshReferenceVideoCardUi();
  refreshGenerateButtonState();
  currentCreditsBalance = Number.NaN;
  $("userCard").style.display = "block";
  $("jobsCard").style.display = "block";
  $("btnWallet").style.display = "inline-block";
  $("btnLogout").style.display = "inline-block";
  $("supportBtn").style.display = "inline-flex";
  $("userLine").textContent = user.email || "Signed in";
  renderLocaleFields();

  const bootstrapPromise = bootstrapPlatformSession(user)
    .catch((error) => {
      console.warn("platform session bootstrap failed", error);
      clearPlatformSessionState();
      return null;
    })
    .finally(() => {
      if (platformBootstrapPromise === bootstrapPromise) {
        platformBootstrapPromise = null;
        platformBootstrapPromiseUid = "";
      }
    });
  platformBootstrapPromise = bootstrapPromise;
  platformBootstrapPromiseUid = user.uid;

  if (analytics) {
    try {
      setUserId(analytics, user.uid);
      setUserProperties(analytics, {user_email: user.email || ""});
    } catch {
      // no-op
    }
  }

  const platformBootstrap = await bootstrapPromise;
  await loadTemplates();
  if (
    currentUser &&
    currentUser.uid === user.uid &&
    platformBootstrap?.motrendProfile
  ) {
    applyPlatformProfileToUi(platformBootstrap.motrendProfile);
  }

  const hasPlatformSession = Boolean(
    platformBootstrap?.bootstrap ||
    platformBootstrap?.restoredFromCookie ||
    platformBootstrap?.motrendProfile ||
    platformBootstrap?.session
  );

  if (!hasPlatformSession) {
    console.warn("platform session bootstrap missing");
    setStatus("Connection error. Refresh.");
    setStatusHintVisible(false);
    unsubscribeJobs = watchLatestJobs();
    return;
  }

  if (platformBootstrap?.bootstrap?.grantedTestCredits === true) {
    const grantedCreditsAmount = Number(
      platformBootstrap.bootstrap.grantedTestCreditsAmount
    );
    setStoredFlag(GIFT_CREDITS_PENDING_KEY, true, sessionStorage);
    setStoredNumber(
      GIFT_CREDITS_AMOUNT_KEY,
      Number.isFinite(grantedCreditsAmount) && grantedCreditsAmount > 0 ?
        grantedCreditsAmount :
        MOTREND_TEST_GIFT_CREDITS,
      sessionStorage
    );
  }

  await syncSupportProfile();

  void syncAttributionForUser(user.uid).catch((error) => {
    console.warn("attribution sync failed", error);
  });

  unsubscribeJobs = watchLatestJobs();
  if (
    currentUser &&
    currentUser.uid === user.uid &&
    getStoredFlag(GIFT_CREDITS_PENDING_KEY, sessionStorage)
  ) {
    const grantedCreditsAmount =
      getStoredNumber(GIFT_CREDITS_AMOUNT_KEY, sessionStorage) ??
      Number(platformBootstrap?.bootstrap?.grantedTestCreditsAmount);
    setStoredFlag(GIFT_CREDITS_PENDING_KEY, false, sessionStorage);
    setStoredNumber(GIFT_CREDITS_AMOUNT_KEY, Number.NaN, sessionStorage);
    void showNoticeModal({
      message: `🎁 You got ${
        Number.isFinite(grantedCreditsAmount) && grantedCreditsAmount > 0 ?
          grantedCreditsAmount :
          MOTREND_TEST_GIFT_CREDITS
      } free credits!`,
      buttonText: "OK",
    });
  }
});
