(function() {
  function safeUrl(value) {
    if (typeof value !== 'string') return '';
    var trimmed = value.trim();
    if (!trimmed) return '';
    try {
      var url = new URL(trimmed, window.location.origin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      var isFirebaseDownloadHost = url.hostname === 'firebasestorage.googleapis.com';
      var bucketMatch = /^\/v0\/b\/gen-lang-client-0651837818\.firebasestorage\.app\/o\//.test(url.pathname);
      var hasToken = !!(url.searchParams.get('token') || '').trim();
      if (!isFirebaseDownloadHost || !bucketMatch || !hasToken) return '';
      return url.toString();
    } catch (e) {
      return '';
    }
  }

  var params = new URLSearchParams(window.location.search);
  var rawVideoParam = (params.get('videoUrl') || '').trim();
  var rawDownloadParam = (params.get('downloadUrl') || '').trim();

  var videoUrl = safeUrl(rawVideoParam);
  var downloadUrl = safeUrl(rawDownloadParam);

  var errorEl = document.getElementById('error');
  var videoWrap = document.getElementById('videoWrap');
  var videoEl = document.getElementById('video');
  var actions = document.getElementById('actions');
  var btnSaveFile = document.getElementById('btnSaveFile');
  var btnShare = document.getElementById('btnShare');
  var btnCopy = document.getElementById('btnCopy');

  var copyTargetUrl = downloadUrl || videoUrl || rawVideoParam || rawDownloadParam || window.location.href;

  function showTemporaryButtonState(button, label, resetLabel, delay) {
    button.textContent = label;
    button.disabled = true;
    setTimeout(function() {
      button.textContent = resetLabel;
      button.disabled = false;
    }, delay);
  }

  // Ensure Copy URL is always wired up and visible
  if (btnCopy) {
    btnCopy.style.display = 'block';
    btnCopy.addEventListener('click', async function() {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(copyTargetUrl);
        } else {
          var ta = document.createElement('textarea');
          ta.value = copyTargetUrl;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        showTemporaryButtonState(btnCopy, 'URL copied', 'Copy URL', 600);
      } catch (err) {
        showTemporaryButtonState(btnCopy, 'Copy failed', 'Copy URL', 800);
      }
    });
  }

  if (!videoUrl && !downloadUrl) {
    if (errorEl) {
      errorEl.textContent = 'Video URL is missing or invalid.';
      errorEl.style.display = 'block';
    }
    if (actions) {
      actions.style.display = 'flex';
    }
    if (btnSaveFile) {
      btnSaveFile.style.display = 'none';
    }
    if (btnShare) {
      btnShare.style.display = 'none';
    }
    return;
  }

  var activeUrl = videoUrl || downloadUrl;
  if (videoEl) {
    videoEl.src = activeUrl;
  }
  if (btnSaveFile) {
    btnSaveFile.href = downloadUrl || videoUrl;
    btnSaveFile.style.display = 'flex';
  }

  if (videoWrap) {
    videoWrap.style.display = 'block';
  }
  if (actions) {
    actions.style.display = 'flex';
  }

  if (navigator.share && btnShare) {
    btnShare.style.display = 'block';
    btnShare.addEventListener('click', async function() {
      try {
        await navigator.share({
          title: 'MoTrend© video',
          url: copyTargetUrl,
        });
      } catch (error) {
        if (!error || error.name === 'AbortError') {
          return;
        }
        showTemporaryButtonState(btnShare, 'Share failed', 'Share', 900);
      }
    });
  } else if (btnShare) {
    btnShare.style.display = 'none';
  }

  try {
    if (!localStorage.getItem('motrend-save-video-tip-shown')) {
      localStorage.setItem('motrend-save-video-tip-shown', '1');
      setTimeout(function() {
        window.alert(
          'If download does not start, tap Copy URL and open it in another browser.'
        );
      }, 180);
    }
  } catch (e) {
    // no-op
  }
})();
