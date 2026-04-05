(function initSaveVideoPage() {
  function safeUrl(value) {
    if (typeof value !== "string") return "";
    var trimmed = value.trim();
    if (!trimmed) return "";
    try {
      var url = new URL(trimmed, window.location.origin);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      var isFirebaseDownloadHost = url.hostname === "firebasestorage.googleapis.com";
      var bucketMatch = /^\/v0\/b\/gen-lang-client-0651837818\.firebasestorage\.app\/o\//.test(url.pathname);
      var hasToken = !!(url.searchParams.get("token") || "").trim();
      if (!isFirebaseDownloadHost || !bucketMatch || !hasToken) return "";
      return url.toString();
    } catch {
      return "";
    }
  }

  function showTemporaryButtonState(button, label, resetLabel, delay) {
    button.textContent = label;
    button.disabled = true;
    setTimeout(function() {
      button.textContent = resetLabel;
      button.disabled = false;
    }, delay);
  }

  var params = new URLSearchParams(window.location.search);
  var videoUrl = safeUrl(params.get("videoUrl") || "");
  var downloadUrl = safeUrl(params.get("downloadUrl") || "");
  var errorEl = document.getElementById("error");
  var videoWrap = document.getElementById("videoWrap");
  var videoEl = document.getElementById("video");
  var actions = document.getElementById("actions");
  var btnSaveFile = document.getElementById("btnSaveFile");
  var btnShare = document.getElementById("btnShare");
  var btnCopy = document.getElementById("btnCopy");
  var pageUrl = window.location.href;
  var copyTargetUrl = downloadUrl || videoUrl;

  if (!videoUrl && !downloadUrl) {
    errorEl.textContent = "Video URL is missing or invalid.";
    errorEl.style.display = "block";
    actions.style.display = "flex";
    btnSaveFile.style.display = "none";
    btnShare.style.display = "none";
    btnCopy.style.display = "none";
    return;
  }

  videoEl.src = videoUrl || downloadUrl;
  if (downloadUrl) {
    btnSaveFile.href = downloadUrl;
  } else if (videoUrl) {
    btnSaveFile.href = videoUrl;
  }

  videoWrap.style.display = "block";
  actions.style.display = "flex";

  if (navigator.share) {
    btnShare.addEventListener("click", async function() {
      try {
        await navigator.share({
          title: "MoTrend© video",
          url: pageUrl,
        });
      } catch (error) {
        if (!error || error.name === "AbortError") {
          return;
        }
        showTemporaryButtonState(btnShare, "Share failed", "Share", 900);
      }
    });
  } else {
    btnShare.style.display = "none";
  }

  if (copyTargetUrl) {
    btnCopy.addEventListener("click", async function() {
      try {
        await navigator.clipboard.writeText(copyTargetUrl);
        showTemporaryButtonState(btnCopy, "URL copied", "Copy URL", 500);
      } catch {
        btnCopy.textContent = "Copy failed";
        setTimeout(function() {
          btnCopy.textContent = "Copy URL";
        }, 800);
      }
    });
  } else {
    btnCopy.style.display = "none";
  }

  try {
    if (!localStorage.getItem("motrend-save-video-tip-shown")) {
      localStorage.setItem("motrend-save-video-tip-shown", "1");
      setTimeout(function() {
        window.alert(
          "If download does not start, tap Copy URL and open it in another browser."
        );
      }, 180);
    }
  } catch {
    // no-op
  }
})();
