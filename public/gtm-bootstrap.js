(function initMotrendGtmBootstrap() {
  if (window.__MOTREND_GTM_INITIALIZED__) {
    return;
  }
  window.__MOTREND_GTM_INITIALIZED__ = true;

  const GTM_CONTAINER_ID = "GTM-N2W4DK23";
  const ATTRIBUTION_STORAGE_KEY = "motrend_attribution_v1";
  const ATTRIBUTION_FIRST_COOKIE_KEY = "motrend_attr_first_v1";
  const ATTRIBUTION_LAST_COOKIE_KEY = "motrend_attr_last_v1";
  const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
  const UTM_KEYS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
  ];
  const CLICK_ID_KEYS = [
    "fbclid",
    "gclid",
    "gbraid",
    "wbraid",
    "gcl_au",
    "fbp",
    "fbc",
    "yclid",
    "ysclid",
    "ym_uid",
    "ga_client_id",
  ];

  function sanitizeValue(value, maxLength) {
    if (typeof value !== "string") {
      return "";
    }
    return value
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .trim()
      .slice(0, maxLength || 500);
  }

  function readCookie(name) {
    const source = document.cookie || "";
    if (!source) {
      return "";
    }
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(new RegExp("(?:^|;\\s*)" + escapedName + "=([^;]*)"));
    if (!match) {
      return "";
    }
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  function getSharedCookieDomain() {
    const hostname = (window.location.hostname || "").trim().toLowerCase();
    if (hostname.endsWith(".moads.agency")) {
      return ".moads.agency";
    }
    return "";
  }

  function writeCookie(name, value, maxAgeSeconds) {
    if (!name) {
      return;
    }
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    const domain = getSharedCookieDomain();
    const domainPart = domain ? "; Domain=" + domain : "";
    document.cookie =
      encodeURIComponent(name) +
      "=" +
      encodeURIComponent(value || "") +
      "; Path=/; Max-Age=" +
      Math.max(0, Number(maxAgeSeconds) || 0) +
      "; SameSite=Lax" +
      secure +
      domainPart;
  }

  function readJsonCookie(name) {
    const raw = readCookie(name);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function writeJsonCookie(name, value) {
    try {
      writeCookie(name, JSON.stringify(value || {}), COOKIE_MAX_AGE_SECONDS);
    } catch {
      // no-op
    }
  }

  function parseGaClientId(cookieValue) {
    const normalized = sanitizeValue(cookieValue, 200);
    if (!normalized) {
      return "";
    }
    const parts = normalized.split(".");
    if (parts.length < 4) {
      return "";
    }
    const first = parts[parts.length - 2];
    const second = parts[parts.length - 1];
    if (!/^\d+$/.test(first) || !/^\d+$/.test(second)) {
      return "";
    }
    return first + "." + second;
  }

  function normalizeTouch(value) {
    if (!value || typeof value !== "object") {
      return {
        capturedAtMs: 0,
        utm: {},
        ids: {},
      };
    }

    const source = value;
    const utm = {};
    const ids = {};

    UTM_KEYS.forEach((key) => {
      const normalized = sanitizeValue(source.utm && source.utm[key], 300);
      if (normalized) {
        utm[key] = normalized;
      }
    });

    CLICK_ID_KEYS.forEach((key) => {
      const normalized = sanitizeValue(source.ids && source.ids[key], 500);
      if (normalized) {
        ids[key] = normalized;
      }
    });

    const capturedAtMs = Number(source.capturedAtMs);
    return {
      capturedAtMs: Number.isFinite(capturedAtMs) && capturedAtMs > 0 ? Math.floor(capturedAtMs) : 0,
      utm,
      ids,
    };
  }

  function readStoredAttribution() {
    try {
      const raw = localStorage.getItem(ATTRIBUTION_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function readLegacyTouchFromStorage(role) {
    const stored = readStoredAttribution();
    if (!stored) {
      return null;
    }
    if (role === "first") {
      return normalizeTouch({
        capturedAtMs: stored.firstCapturedAtMs || stored.capturedAtMs || 0,
        utm: stored.utm || {},
        ids: stored.ids || {},
      });
    }
    return normalizeTouch({
      capturedAtMs: stored.capturedAtMs || 0,
      utm: stored.utm || {},
      ids: stored.ids || {},
    });
  }

  function mergeTouch(previousTouch, runtimeTouch, preserveExisting) {
    const prev = normalizeTouch(previousTouch);
    const next = normalizeTouch(runtimeTouch);
    const mergedUtm = preserveExisting ? {...next.utm, ...prev.utm} : {...prev.utm, ...next.utm};
    const mergedIds = preserveExisting ? {...next.ids, ...prev.ids} : {...prev.ids, ...next.ids};

    return {
      capturedAtMs: prev.capturedAtMs || next.capturedAtMs || Date.now(),
      utm: mergedUtm,
      ids: mergedIds,
    };
  }

  function readRuntimeTouch() {
    const query = new URL(window.location.href).searchParams;
    const utm = {};
    const ids = {};

    UTM_KEYS.forEach((key) => {
      const normalized = sanitizeValue(query.get(key) || "", 300);
      if (normalized) {
        utm[key] = normalized;
      }
    });

    [
      "fbclid",
      "gclid",
      "gbraid",
      "wbraid",
      "yclid",
      "ysclid",
    ].forEach((key) => {
      const normalized = sanitizeValue(query.get(key) || "", 500);
      if (normalized) {
        ids[key] = normalized;
      }
    });

    const fbp = sanitizeValue(readCookie("_fbp"), 300);
    if (fbp) {
      ids.fbp = fbp;
    }

    let fbc = sanitizeValue(readCookie("_fbc"), 500);
    if (!fbc && ids.fbclid) {
      fbc = "fb.1." + Date.now() + "." + ids.fbclid;
    }
    if (fbc) {
      ids.fbc = fbc;
    }

    const gclAu = sanitizeValue(readCookie("_gcl_au"), 300);
    if (gclAu) {
      ids.gcl_au = gclAu;
    }

    const ymUid = sanitizeValue(readCookie("_ym_uid"), 300);
    if (ymUid) {
      ids.ym_uid = ymUid;
    }

    const gaClientId = parseGaClientId(readCookie("_ga"));
    if (gaClientId) {
      ids.ga_client_id = gaClientId;
    }

    return {
      capturedAtMs: Date.now(),
      utm,
      ids,
    };
  }

  function detectPageType() {
    const pathname = window.location.pathname || "/";
    if (pathname === "/save-video.html") {
      return "save_video";
    }
    if (/^\/v\//.test(pathname) || /^\/public\/motrend\/v\//.test(pathname)) {
      return "public_share";
    }
    return "app";
  }

  function flattenTouch(touch) {
    const normalized = normalizeTouch(touch);
    return {
      ...normalized.utm,
      ...normalized.ids,
      attribution_captured_at_ms: normalized.capturedAtMs || null,
    };
  }

  function buildState() {
    const runtimeTouch = readRuntimeTouch();
    const firstTouch = mergeTouch(
      readJsonCookie(ATTRIBUTION_FIRST_COOKIE_KEY) || readLegacyTouchFromStorage("first"),
      runtimeTouch,
      true
    );
    const lastTouch = mergeTouch(
      readJsonCookie(ATTRIBUTION_LAST_COOKIE_KEY) || readLegacyTouchFromStorage("last"),
      runtimeTouch,
      false
    );
    return {
      firstTouch,
      lastTouch,
    };
  }

  function persistState() {
    const state = buildState();
    writeJsonCookie(ATTRIBUTION_FIRST_COOKIE_KEY, state.firstTouch);
    writeJsonCookie(ATTRIBUTION_LAST_COOKIE_KEY, state.lastTouch);
    window.__MOTREND_ATTRIBUTION__ = state;
    return state;
  }

  window.dataLayer = window.dataLayer || [];

  const bridge = {
    containerId: GTM_CONTAINER_ID,
    getAttributionState: function() {
      return window.__MOTREND_ATTRIBUTION__ || persistState();
    },
    refreshAttributionState: function() {
      return persistState();
    },
    pushEvent: function(eventName, params) {
      const state = this.getAttributionState();
      const payload = {
        event: eventName,
        page_type: detectPageType(),
        page_path: window.location.pathname || "/",
        page_location: window.location.href,
        ...flattenTouch(state.lastTouch),
      };
      if (params && typeof params === "object") {
        Object.assign(payload, params);
      }
      window.dataLayer.push(payload);
      return payload;
    },
  };

  window.__MOTREND_GTM__ = bridge;
  window.dataLayer.push({
    "gtm.start": Date.now(),
    event: "gtm.js",
  });
  const initialState = persistState();
  window.dataLayer.push({
    event: "motrend_context",
    page_type: detectPageType(),
    page_path: window.location.pathname || "/",
    page_location: window.location.href,
    ...flattenTouch(initialState.lastTouch),
  });

  const existingScript = document.querySelector("script[data-motrend-gtm='1']");
  if (!existingScript) {
    const script = document.createElement("script");
    script.async = true;
    script.dataset.motrendGtm = "1";
    script.src = "https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(GTM_CONTAINER_ID);
    const firstScript = document.getElementsByTagName("script")[0];
    if (firstScript && firstScript.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
    } else {
      (document.head || document.documentElement).appendChild(script);
    }
  }

  setTimeout(function() {
    persistState();
  }, 1500);
})();
