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

  function waitForVideoMetadata(video) {
    return new Promise(function(resolve, reject) {
      if (video.readyState >= 1 && Number(video.videoWidth || 0) > 0 && Number(video.videoHeight || 0) > 0) {
        resolve();
        return;
      }

      var settled = false;

      function cleanup() {
        video.removeEventListener("loadedmetadata", onLoadedMetadata);
        video.removeEventListener("canplay", onCanPlay);
        video.removeEventListener("error", onError);
      }

      function finish() {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      }

      function onLoadedMetadata() {
        if (video.readyState >= 1) {
          finish();
        }
      }

      function onCanPlay() {
        finish();
      }

      function onError() {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Unable to load video preview."));
      }

      video.addEventListener("loadedmetadata", onLoadedMetadata);
      video.addEventListener("canplay", onCanPlay);
      video.addEventListener("error", onError);
    });
  }

  function seekVideo(video, timeSec) {
    return new Promise(function(resolve, reject) {
      var settled = false;

      function cleanup() {
        video.onseeked = null;
        video.onerror = null;
      }

      function fail(error) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error("Unable to seek video preview."));
      }

      video.onseeked = function() {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      video.onerror = function() {
        fail(new Error("Unable to seek video preview."));
      };

      try {
        video.currentTime = Math.max(0, timeSec || 0);
      } catch (error) {
        fail(error);
      }
    });
  }

  function capturePosterDataUrl(video) {
    return waitForVideoMetadata(video)
      .then(function() {
        var width = Number(video.videoWidth || 0);
        var height = Number(video.videoHeight || 0);
        if (width <= 0 || height <= 0) {
          return "";
        }

        var originalTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
        var duration = Number(video.duration || 0);
        var targetTime = Number.isFinite(duration) && duration > 0.2 ?
          Math.min(Math.max(duration * 0.18, 0.15), Math.max(duration - 0.05, 0.15)) :
          0;

        return Promise.resolve()
          .then(function() {
            if (targetTime > 0) {
              return seekVideo(video, targetTime);
            }
          })
          .then(function() {
            var canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            var ctx = canvas.getContext("2d");
            if (!ctx) {
              return "";
            }
            ctx.drawImage(video, 0, 0, width, height);
            return canvas.toDataURL("image/jpeg", 0.84);
          })
          .finally(function() {
            if (targetTime > 0 && Number.isFinite(originalTime)) {
              try {
                video.currentTime = originalTime;
              } catch {
                // no-op
              }
            }
          });
      })
      .catch(function() {
        return "";
      });
  }

  var params = new URLSearchParams(window.location.search);
  var videoUrl = safeUrl(params.get("videoUrl") || "");
  var downloadUrl = safeUrl(params.get("downloadUrl") || "");
  var previewUrl = safeUrl(params.get("previewUrl") || "");
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
  videoEl.preload = "metadata";
  videoEl.playsInline = true;
  if (previewUrl) {
    videoEl.poster = previewUrl;
  }
  if (downloadUrl) {
    btnSaveFile.href = downloadUrl;
  } else if (videoUrl) {
    btnSaveFile.href = videoUrl;
  }

  videoWrap.style.display = "block";
  actions.style.display = "flex";

  capturePosterDataUrl(videoEl).then(function(capturedPosterUrl) {
    if (!capturedPosterUrl) {
      return;
    }
    videoEl.poster = capturedPosterUrl;
  });

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
