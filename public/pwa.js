(function initMotrendPwa() {
  const INSTALL_BUTTON_SELECTOR = "[data-pwa-install]";
  const INSTALL_WRAP_SELECTOR = "[data-pwa-install-wrap]";
  const MODAL_ID = "motrendPwaModal";
  const MODAL_STYLE_ID = "motrendPwaStyles";
  const GENERATION_PROMO_SEEN_KEY = "motrend_pwa_generation_offer_seen_v2";
  const IOS_SHARE_ICON = (
    '<span class="motrendPwaShareIcon" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" focusable="false">' +
    '<path d="M12 3v10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.9"/>' +
    '<path d="M8.5 6.5L12 3l3.5 3.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.9"/>' +
    '<path d="M6 11.5v6.2c0 .72.58 1.3 1.3 1.3h9.4c.72 0 1.3-.58 1.3-1.3v-6.2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.9"/>' +
    "</svg>" +
    "</span>"
  );

  let deferredInstallPrompt = null;
  let activePrimaryAction = null;
  let activeSecondaryAction = null;
  let activeDismissAction = null;

  function trimString(value, maxLength = 180) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, maxLength);
  }

  function getButtons() {
    return Array.from(document.querySelectorAll(INSTALL_BUTTON_SELECTOR));
  }

  function isStandalone() {
    return Boolean(
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone === true
    );
  }

  function isIOS() {
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function isSafariOnIOS() {
    if (!isIOS()) return false;
    const ua = navigator.userAgent || "";
    return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo|GSA/i.test(ua);
  }

  function getIOSVersion() {
    if (!isIOS()) return null;
    const ua = navigator.userAgent || "";
    const match = ua.match(/OS (\d+)[._](\d+)(?:[._](\d+))?/i);
    if (!match) return null;

    return {
      major: Number(match[1]) || 0,
      minor: Number(match[2]) || 0,
      patch: Number(match[3]) || 0,
    };
  }

  function isIOSVersionAtLeast(major, minor) {
    const version = getIOSVersion();
    if (!version) return false;
    if (version.major !== major) {
      return version.major > major;
    }
    return version.minor >= minor;
  }

  function isIOSInAppBrowser() {
    if (!isIOS()) return false;
    const ua = navigator.userAgent || "";
    return /Telegram|Instagram|FBAN|FBAV|FB_IAB|Line\/|WebView|; wv\)|\bwv\b|GSA/i.test(ua);
  }

  function supportsCurrentIOSBrowserA2HS() {
    if (!isIOS()) return false;
    if (isSafariOnIOS()) return true;
    if (isIOSInAppBrowser()) return false;
    return isIOSVersionAtLeast(16, 4);
  }

  function pushPwaEvent(name, params = {}) {
    try {
      window.__MOTREND_GTM__?.pushEvent?.(name, params);
    } catch {
      // no-op
    }
  }

  function readContext(input) {
    if (!input || typeof input !== "object") {
      return {};
    }

    return {
      job_id: trimString(input.jobId, 120),
      template_id: trimString(input.templateId, 120),
      selection_kind: trimString(input.selectionKind, 60),
    };
  }

  function readInstallMode() {
    if (isStandalone()) return "installed";
    if (isIOS()) {
      if (supportsCurrentIOSBrowserA2HS()) {
        return "ios-share";
      }
      return isIOSInAppBrowser() ? "ios-in-app" : "ios-safari-required";
    }
    if (deferredInstallPrompt) return "prompt";
    return "hidden";
  }

  function resolveInstallButtonLabel(mode = readInstallMode()) {
    return mode === "prompt" ? "Install app" : "Add to Home Screen";
  }

  function canOfferInstall(mode = readInstallMode()) {
    return mode !== "installed" && mode !== "hidden";
  }

  function hasSeenGenerationOffer() {
    try {
      return localStorage.getItem(GENERATION_PROMO_SEEN_KEY) === "1";
    } catch {
      return false;
    }
  }

  function markGenerationOfferSeen() {
    try {
      localStorage.setItem(GENERATION_PROMO_SEEN_KEY, "1");
    } catch {
      // no-op
    }
  }

  function ensureModalStyles() {
    if (document.getElementById(MODAL_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = MODAL_STYLE_ID;
    style.textContent = `
      .motrendPwaModalOverlay{
        position:fixed;
        inset:0;
        z-index:2200;
        display:none;
        align-items:center;
        justify-content:center;
        padding:16px;
        background:rgba(0,0,0,.72);
      }
      .motrendPwaModalOverlay.isVisible{display:flex;}
      .motrendPwaModal{
        width:min(100%, 560px);
        background:var(--card, #151515);
        color:var(--text, #fff);
        border:1px solid var(--border, #2a2a2a);
        border-radius:18px;
        padding:18px;
        box-shadow:0 18px 48px rgba(0,0,0,.38);
      }
      .motrendPwaModalHeader{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:12px;
      }
      .motrendPwaModalTitle{
        margin:0;
        font-size:30px;
        line-height:1;
      }
      .motrendPwaClose{
        min-width:44px;
        min-height:44px;
        padding:0;
        border-radius:12px;
        border:1px solid var(--border, #2a2a2a);
        background:#0f0f0f;
        color:var(--muted, rgba(255,255,255,.7));
        cursor:pointer;
        font-size:22px;
      }
      .motrendPwaLead{
        margin:12px 0 0;
        color:var(--muted, rgba(255,255,255,.7));
        line-height:1.35;
        white-space:pre-line;
      }
      .motrendPwaSteps{
        margin:16px 0 0;
        padding:0;
        list-style:none;
        display:grid;
        gap:10px;
      }
      .motrendPwaSteps[hidden]{display:none !important;}
      .motrendPwaStep{
        display:flex;
        gap:12px;
        align-items:flex-start;
        padding:12px 14px;
        border-radius:14px;
        border:1px solid rgba(167,118,255,.18);
        background:rgba(167,118,255,.08);
      }
      .motrendPwaStepNumber{
        flex:0 0 auto;
        width:28px;
        height:28px;
        border-radius:999px;
        display:flex;
        align-items:center;
        justify-content:center;
        background:#b987ff;
        color:#160620;
        font-size:16px;
        font-weight:700;
      }
      .motrendPwaStepText{
        flex:1 1 auto;
        min-width:0;
        line-height:1.35;
      }
      .motrendPwaShareIcon{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        width:18px;
        height:18px;
        margin:0 2px;
        vertical-align:-3px;
        color:#d9b6ff;
      }
      .motrendPwaShareIcon svg{
        width:100%;
        height:100%;
        display:block;
      }
      .motrendPwaFooter{
        margin-top:16px;
        color:var(--muted, rgba(255,255,255,.7));
        line-height:1.35;
        white-space:pre-line;
      }
      .motrendPwaFooter:empty{display:none;}
      .motrendPwaActions{
        margin-top:18px;
        display:flex;
        gap:10px;
        flex-wrap:wrap;
      }
      .motrendPwaPrimary,
      .motrendPwaSecondary{
        flex:1 1 220px;
        min-height:52px;
        border-radius:14px;
        font-size:21px;
        font-weight:700;
        cursor:pointer;
      }
      .motrendPwaPrimary{
        border:1px solid #9d65f3;
        background:linear-gradient(180deg, #c68eff, #9e63ff);
        color:#180022;
      }
      .motrendPwaSecondary{
        border:1px solid var(--border, #2a2a2a);
        background:#0f0f0f;
        color:var(--text, #fff);
      }
      .motrendPwaSecondary[hidden]{display:none !important;}
      @media (max-width: 640px){
        .motrendPwaModalTitle{font-size:26px;}
      }
    `;
    document.head.appendChild(style);
  }

  function ensureModal() {
    let overlay = document.getElementById(MODAL_ID);
    if (overlay) return overlay;

    ensureModalStyles();

    overlay = document.createElement("div");
    overlay.id = MODAL_ID;
    overlay.className = "motrendPwaModalOverlay";
    overlay.innerHTML = `
      <div class="motrendPwaModal" role="dialog" aria-modal="true" aria-labelledby="motrendPwaModalTitle">
        <div class="motrendPwaModalHeader">
          <h2 id="motrendPwaModalTitle" class="motrendPwaModalTitle">Add MoTrend</h2>
          <button type="button" class="motrendPwaClose" aria-label="Close">×</button>
        </div>
        <p class="motrendPwaLead" data-pwa-lead></p>
        <ol class="motrendPwaSteps" data-pwa-steps hidden></ol>
        <p class="motrendPwaFooter" data-pwa-footer></p>
        <div class="motrendPwaActions">
          <button type="button" class="motrendPwaSecondary" data-pwa-secondary hidden>Later</button>
          <button type="button" class="motrendPwaPrimary" data-pwa-primary>Got it</button>
        </div>
      </div>
    `;

    const closeBtn = overlay.querySelector(".motrendPwaClose");
    const primaryBtn = overlay.querySelector("[data-pwa-primary]");
    const secondaryBtn = overlay.querySelector("[data-pwa-secondary]");

    function runAndClear(action) {
      activePrimaryAction = null;
      activeSecondaryAction = null;
      activeDismissAction = null;
      if (typeof action === "function") {
        action();
      }
    }

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        runAndClear(activeDismissAction);
      }
    });

    closeBtn?.addEventListener("click", () => {
      runAndClear(activeDismissAction);
    });

    primaryBtn?.addEventListener("click", () => {
      runAndClear(activePrimaryAction);
    });

    secondaryBtn?.addEventListener("click", () => {
      runAndClear(activeSecondaryAction);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && overlay.classList.contains("isVisible")) {
        runAndClear(activeDismissAction);
      }
    });

    document.body.appendChild(overlay);
    return overlay;
  }

  function closeModal() {
    const overlay = document.getElementById(MODAL_ID);
    if (!overlay) return;
    overlay.classList.remove("isVisible");
  }

  function openModal({
    title,
    lead = "",
    steps = [],
    footer = "",
    primaryLabel = "Got it",
    secondaryLabel = "",
    onPrimary = null,
    onSecondary = null,
    onDismiss = null,
  }) {
    const overlay = ensureModal();
    const titleEl = overlay.querySelector("#motrendPwaModalTitle");
    const leadEl = overlay.querySelector("[data-pwa-lead]");
    const stepsEl = overlay.querySelector("[data-pwa-steps]");
    const footerEl = overlay.querySelector("[data-pwa-footer]");
    const primaryBtn = overlay.querySelector("[data-pwa-primary]");
    const secondaryBtn = overlay.querySelector("[data-pwa-secondary]");

    if (!titleEl || !leadEl || !stepsEl || !footerEl || !primaryBtn || !secondaryBtn) {
      return;
    }

    titleEl.textContent = title || "Add MoTrend";
    leadEl.textContent = lead;
    footerEl.textContent = footer;
    primaryBtn.textContent = primaryLabel || "Got it";
    secondaryBtn.hidden = !secondaryLabel;
    secondaryBtn.textContent = secondaryLabel || "";

    if (steps.length > 0) {
      stepsEl.hidden = false;
      stepsEl.innerHTML = steps.map((step, index) => (
        `<li class="motrendPwaStep"><span class="motrendPwaStepNumber">${index + 1}</span><span class="motrendPwaStepText">${step}</span></li>`
      )).join("");
    } else {
      stepsEl.hidden = true;
      stepsEl.innerHTML = "";
    }

    activePrimaryAction = onPrimary;
    activeSecondaryAction = secondaryLabel ? onSecondary : null;
    activeDismissAction = onDismiss || onSecondary || onPrimary;
    overlay.classList.add("isVisible");
  }

  function updateButtons() {
    const mode = readInstallMode();
    const buttons = getButtons();

    buttons.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;

      const wrap = button.closest(INSTALL_WRAP_SELECTOR);
      const shouldHide = !canOfferInstall(mode);

      button.hidden = shouldHide;
      button.disabled = mode === "installed";
      if (!shouldHide) {
        button.textContent = resolveInstallButtonLabel(mode);
        button.setAttribute("aria-label", button.textContent);
      }

      if (wrap instanceof HTMLElement) {
        wrap.hidden = shouldHide;
      }
    });
  }

  function openInstructionsModal(mode, source, context = {}) {
    const copy = mode === "ios-in-app" ? {
      title: "Open In Safari",
      lead: "To save MoTrend on your home screen, first open this page in Safari.",
      steps: [
        "Open this page in Safari.",
        `Then tap ${IOS_SHARE_ICON} Share and choose Add to Home Screen.`,
      ],
      footer: "",
    } : mode === "ios-safari-required" ? {
      title: "Open In Safari",
      lead: "On this iPhone version, Add to Home Screen is available in Safari.",
      steps: [
        "Open this page in Safari.",
        `Then tap ${IOS_SHARE_ICON} Share and choose Add to Home Screen.`,
      ],
      footer: "",
    } : {
      title: "Add MoTrend",
      lead: "Save MoTrend to your home screen in a few seconds.",
      steps: [
        `Tap ${IOS_SHARE_ICON} Share.`,
        "Tap Add to Home Screen, then Add.",
      ],
      footer: "",
    };

    pushPwaEvent("motrend_pwa_install_instructions_opened", {
      cta_source: source,
      install_mode: mode,
      ...context,
    });

    openModal({
      title: copy.title,
      lead: copy.lead,
      steps: copy.steps,
      footer: copy.footer,
      primaryLabel: "Got it",
      onPrimary: () => {
        closeModal();
      },
      onDismiss: () => {
        closeModal();
      },
    });
    return true;
  }

  async function promptInstall(source, context = {}) {
    if (!deferredInstallPrompt) return false;

    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    closeModal();
    updateButtons();

    pushPwaEvent("motrend_pwa_install_prompt_opened", {
      cta_source: source,
      install_mode: "prompt",
      ...context,
    });

    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      pushPwaEvent("motrend_pwa_install_prompt_result", {
        cta_source: source,
        install_mode: "prompt",
        prompt_result: choice?.outcome === "accepted" ? "accepted" : "dismissed",
        ...context,
      });
    } catch {
      pushPwaEvent("motrend_pwa_install_prompt_result", {
        cta_source: source,
        install_mode: "prompt",
        prompt_result: "error",
        ...context,
      });
    } finally {
      updateButtons();
    }

    return true;
  }

  function openInstallSurface({
    source = "unknown",
    context = {},
  } = {}) {
    const mode = readInstallMode();
    if (!canOfferInstall(mode)) {
      return Promise.resolve(false);
    }

    if (mode === "prompt") {
      return promptInstall(source, context);
    }

    closeModal();
    return Promise.resolve(openInstructionsModal(mode, source, context));
  }

  function handleInstallClick(event) {
    event.preventDefault();
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement)) return;

    const mode = readInstallMode();
    if (!canOfferInstall(mode)) return;

    const source = trimString(button.getAttribute("data-pwa-install-source") || "", 80) || "footer";
    pushPwaEvent("motrend_pwa_install_cta_clicked", {
      cta_source: source,
      install_mode: mode,
    });
    void openInstallSurface({source});
  }

  function registerButtons() {
    getButtons().forEach((button) => {
      button.addEventListener("click", handleInstallClick);
    });
    updateButtons();
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (
      window.location.protocol !== "https:" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("service worker registration failed", error);
    });
  }

  function showGenerationInstallOffer(rawContext = {}) {
    const mode = readInstallMode();
    if (!canOfferInstall(mode) || hasSeenGenerationOffer()) {
      return false;
    }

    const context = readContext(rawContext);
    markGenerationOfferSeen();

    pushPwaEvent("motrend_pwa_install_offer_shown", {
      cta_source: "generation_started_popup",
      install_mode: mode,
      ...context,
    });

    openModal({
      title: "Don't Lose Your Generation",
      lead: "Install MoTrend so you can reopen your active render in one tap while it keeps generating in the background.",
      footer: "Your trend keeps rendering even if you leave this page. Installing the app makes it easier to jump back into your jobs list.",
      primaryLabel: resolveInstallButtonLabel(mode),
      secondaryLabel: "Later",
      onPrimary: () => {
        pushPwaEvent("motrend_pwa_install_cta_clicked", {
          cta_source: "generation_started_popup",
          install_mode: readInstallMode(),
          ...context,
        });
        void openInstallSurface({
          source: "generation_started_popup",
          context,
        });
      },
      onSecondary: () => {
        closeModal();
      },
      onDismiss: () => {
        closeModal();
      },
    });

    return true;
  }

  window.__MOTREND_PWA__ = {
    getInstallMode: readInstallMode,
    canOfferInstall: () => canOfferInstall(readInstallMode()),
    openInstallSurface,
    showGenerationInstallOffer,
  };

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateButtons();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    closeModal();
    pushPwaEvent("motrend_pwa_installed", {
      cta_source: "browser",
      install_mode: "installed",
    });
    updateButtons();
  });

  window.addEventListener("focus", updateButtons);

  const standaloneMedia = window.matchMedia?.("(display-mode: standalone)");
  standaloneMedia?.addEventListener?.("change", updateButtons);

  registerServiceWorker();
  registerButtons();
})();
