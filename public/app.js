import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAnalytics, logEvent, setUserId, setUserProperties } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js";
import {
  getAuth, GoogleAuthProvider,
  signInWithPopup, onAuthStateChanged, signOut,
  signInWithEmailAndPassword, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, doc, setDoc, updateDoc, serverTimestamp,
  collection, query, where, getDocs, orderBy, limit, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyBro7c7o8kiRdAuZZpu73KdKyApX7JuflE",
  authDomain: "gen-lang-client-0651837818.firebaseapp.com",
  projectId: "gen-lang-client-0651837818",
  storageBucket: "gen-lang-client-0651837818.firebasestorage.app",
  messagingSenderId: "399776789069",
  appId: "1:399776789069:web:1567626bd149e1d5116204",
  measurementId: "G-KJC19LBS34"
};

const app = initializeApp(firebaseConfig);
const fns = getFunctions(app, "us-central1");
const createJob = httpsCallable(fns, "createJob");
const getDownloadTicket = httpsCallable(fns, "getDownloadTicket");

// analytics (может не стартовать в некоторых окружениях — это ок)
let analytics = null;
try { analytics = getAnalytics(app); } catch {}

function track(name, params = {}) {
  if (!analytics) return;
  try { logEvent(analytics, name, params); } catch {}
}

const auth = getAuth(app);
const db = getFirestore(app);
const st = getStorage(app);

const $ = (id) => document.getElementById(id);

function showAuthError(msg) {
  const el = $("authError");
  if (!el) return;
  el.style.display = "block";
  el.textContent = msg;
}
function clearAuthError() {
  const el = $("authError");
  if (!el) return;
  el.style.display = "none";
  el.textContent = "";
}
function showFormError(msg) {
  const el = $("formError");
  if (!el) return;
  el.style.display = "block";
  el.textContent = msg;
}
function clearFormError() {
  const el = $("formError");
  if (!el) return;
  el.style.display = "none";
  el.textContent = "";
}

let currentResultJobId = null;
let currentResultUrl = "";

function showResult(url, jobId) {
  currentResultJobId = jobId || null;
  currentResultUrl = url || "";
  $("result").style.display = "block";

  const a = $("downloadResult");
  a.href = "#";
  a.style.display = "inline-flex";

  const copyBtn = $("copyResultLink");
  copyBtn.style.display = "inline-flex";
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(currentResultUrl);
      $("status").textContent = "Link copied ✅";
    } catch {
      $("status").textContent = "Failed to copy link";
    }
  };

  $("resultHint").style.display = "block";
}

function openAuth(msg = "") {
  const authBox = $("auth");
  if (authBox) authBox.style.display = "block";
  if (msg) showAuthError(msg); else clearAuthError();
  authBox?.scrollIntoView({ behavior: "smooth", block: "start" });
  $("authEmail")?.focus();
}
function closeAuth() {
  const authBox = $("auth");
  if (authBox) authBox.style.display = "none";
  clearAuthError();
}

let currentUser = null;
let selectedTemplate = null;
let unsubscribeUserDoc = null;
let unsubscribeLatestJobs = null;

$("btnEmailSignIn").onclick = async () => {
  clearAuthError();
  const email = $("authEmail").value.trim();
  const pass = $("authPass").value;
  try {
    track("login_click", { method: "email" });
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    showAuthError(e?.message || "Sign-in failed");
  }
};

$("btnEmailSignUp").onclick = async () => {
  clearAuthError();
  const email = $("authEmail").value.trim();
  const pass = $("authPass").value;
  try {
    track("signup_click", { method: "email" });
    await createUserWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    showAuthError(e?.message || "Sign-up failed");
  }
};

$("btnLogin").onclick = async () => {
  clearAuthError();
  try {
    track("login_click", { method: "google" });
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (e) {
    showAuthError(e?.message || "Google sign-in failed");
  }
};

$("btnLogout").onclick = () => signOut(auth);

$("btnSaveProfile").onclick = async () => {
  const u = currentUser;
  if (!u) return;
  await setDoc(doc(db, "users", u.uid), {
    email: u.email,
    language: $("inpLang").value,
    country: $("inpCountry").value,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

$("btnWallet").onclick = () => {
  alert("Wallet: позже подключим оплату/кредиты.");
};

function stopAllTemplateVideos(exceptEl = null) {
  document.querySelectorAll(".tplVideo").forEach(v => {
    if (v === exceptEl) return;
    try { v.pause(); v.currentTime = 0; v.muted = true; } catch {}
  });
}

function escapeHtml(s) {
  const el = document.createElement("span");
  el.textContent = s;
  return el.innerHTML;
}
function safeUrl(u) {
  if (typeof u !== "string") return "";
  const trimmed = u.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed, window.location.origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}
function renderTemplateCard(t) {
  const div = document.createElement("div");
  div.className = "card tplCard";
  div.style.margin = "0";

  const thumbUrl = safeUrl(t.preview?.thumbnailUrl || "");
  const videoUrl = safeUrl(t.preview?.previewVideoUrl || "");
  const mode = t.modeDefault || "std";
  const titleText = t.title || "Template";

  const media = document.createElement("div");
  media.className = "tplMedia";

  let vid = null;
  if (videoUrl) {
    vid = document.createElement("video");
    vid.className = "tplVideo";
    vid.playsInline = true;
    vid.muted = true;
    vid.loop = true;
    vid.autoplay = true;
    vid.preload = "metadata";
    vid.src = videoUrl;
    if (thumbUrl) vid.poster = thumbUrl;
    media.appendChild(vid);
  } else if (thumbUrl) {
    const img = document.createElement("img");
    img.src = thumbUrl;
    img.alt = "";
    media.appendChild(img);
  }

  const titleEl = document.createElement("div");
  titleEl.style.fontWeight = "700";
  titleEl.style.marginTop = "8px";
  titleEl.textContent = titleText;

  const meta = document.createElement("div");
  meta.className = "muted";
  meta.textContent = `${t.durationSec ?? "—"}s • ${mode}`;

  const useBtn = document.createElement("button");
  useBtn.className = "btn tplUse";
  useBtn.style.marginTop = "10px";
  useBtn.style.width = "100%";
  useBtn.textContent = "Use";

  div.appendChild(media);
  div.appendChild(titleEl);
  div.appendChild(meta);
  div.appendChild(useBtn);

  if (vid) setTimeout(() => { vid.play().catch(() => {}); }, 50);

  media.onclick = async () => {
    document.querySelectorAll(".tplCard").forEach(c => c.classList.remove("isHot"));
    div.classList.add("isHot");
    if (!vid) return;
    stopAllTemplateVideos(vid);
    try { vid.muted = false; vid.volume = 1; await vid.play(); } catch {}
  };

  useBtn.onclick = () => {
    selectedTemplate = t;
    $("selTemplate").value = `${t.title} (${t.durationSec}s ${mode})`;
    document.querySelectorAll(".tplCard").forEach(c => c.classList.remove("isSelected"));
    div.classList.add("isSelected");
    track("template_selected", { templateId: t.id, title: t.title || "" });
  };

  return div;
}

async function loadTemplates() {
  const container = $("templates");
  container.innerHTML = '<div class="templatesLoading"><span class="spinner"></span> Loading templates…</div>';
  try {
    const qy = query(
      collection(db, "templates"),
      where("isActive", "==", true),
      orderBy("order", "asc"),
      limit(30)
    );
    const snap = await getDocs(qy);
    container.innerHTML = "";
    snap.forEach(d => {
      const t = { id: d.id, ...d.data() };
      container.appendChild(renderTemplateCard(t));
    });
  } catch (e) {
    container.innerHTML = '<div class="templatesLoading muted">Failed to load templates. Try again later.</div>';
    console.warn(e);
  }
}

function watchUserDoc(uid) {
  return onSnapshot(doc(db, "users", uid), (snap) => {
    const data = snap.data() || {};
    $("credits").textContent = data.creditsBalance ?? 0;
    $("country").textContent = data.country ?? "—";
    $("lang").textContent = data.language ?? "—";
    const needs = !data.country || !data.language;
    $("onboarding").style.display = needs ? "block" : "none";
  });
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
      $("jobs").textContent = "No jobs yet.";
      return;
    }
    const jobsEl = $("jobs");
    jobsEl.innerHTML = "";
    snap.forEach(d => {
      const j = d.data() || {};
      const status = typeof j.status === "string" ? j.status : "";

      const outputUrl = (j.kling && j.kling.outputUrl) ? j.kling.outputUrl : null;
      const row = document.createElement("div");
      row.textContent = `${d.id.slice(0,6)}… • ${status} • ${outputUrl ? "✅" : ""}`;
      jobsEl.appendChild(row);

      if (status === "done" && j.kling?.outputUrl) {
        const url = safeUrl(j.kling.outputUrl);
        if (url) {
          $("status").textContent = "Done ✅";
          showResult(url, d.id);
        }
      }
      if (status === "failed") {
        $("status").textContent = `Error: ${j.kling?.error || j.errorMessage || "unknown"}`;
      }
    });
  });
}

$("btnGenerate").onclick = async () => {
  clearFormError();
  if (!currentUser) { openAuth("Sign in to upload a photo and generate."); return; }
  if (!selectedTemplate) { showFormError("Pick a template first."); return; }
  const file = $("filePhoto").files?.[0];
  if (!file) { showFormError("Upload a photo."); return; }

  const btn = $("btnGenerate");
  btn.disabled = true;
  $("status").textContent = "Uploading photo…";
  $("result").style.display = "none";
  $("downloadResult").href = "#";
  $("downloadResult").style.display = "none";
  $("copyResultLink").style.display = "none";
  $("resultHint").style.display = "none";

  try {
    console.log("STEP 1 createJob start");
    const resp = await createJob({ templateId: selectedTemplate.id });
    console.log("STEP 1 createJob ok", resp.data);
    const jobId = resp.data.jobId;
    const path = resp.data.uploadPath;

    const r = ref(st, path);
    console.log("STEP 2 uploadBytes start", path);
    await uploadBytes(r, file, { contentType: file.type || "image/jpeg" });
    console.log("STEP 2 uploadBytes ok");

    console.log("STEP 3 getDownloadURL start");
    const photoUrl = await getDownloadURL(r);
    console.log("STEP 3 getDownloadURL ok", photoUrl);

    console.log("STEP 4 updateDoc start");
    await updateDoc(doc(db, "jobs", jobId), {
      inputImageUrl: photoUrl,
      inputImagePath: path,
      updatedAt: serverTimestamp(),
    });
    console.log("STEP 4 updateDoc ok");
    $("status").textContent = "Queued. Generating…";
  } catch (e) {
    console.error("GENERATE FAILED", e);
    throw e;
  } finally {
    btn.disabled = false;
  }
};

$("downloadResult").onclick = async (e) => {
  e.preventDefault();
  const jobId = currentResultJobId;
  if (!jobId) return;
  const btn = $("downloadResult");
  const origText = btn.textContent;
  btn.textContent = "…";
  btn.disabled = true;
  try {
    const { data } = await getDownloadTicket({ jobId });
    if (data?.ticketId) {
      window.location.href = "/download?ticket=" + encodeURIComponent(data.ticketId);
      return;
    }
  } catch (err) {
    $("status").textContent = err?.message || "Download failed";
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
  }
};

$("copyResultLink").onclick = async () => {
  if (!currentResultUrl) return;
  try {
    await navigator.clipboard.writeText(currentResultUrl);
    $("copyResultLink").textContent = "Copied!";
    setTimeout(() => { $("copyResultLink").textContent = "Copy link"; }, 2000);
  } catch (e) {
    console.warn("Copy failed", e);
  }
};

// Require auth before interacting with file upload
const fileInput = $("filePhoto");
if (fileInput) {
  fileInput.addEventListener("click", (e) => {
    if (!currentUser) {
      e.preventDefault();
      openAuth("Sign in to upload a photo.");
    }
  });
}

onAuthStateChanged(auth, async (u) => {
  if (typeof unsubscribeUserDoc === "function") {
    unsubscribeUserDoc();
    unsubscribeUserDoc = null;
  }
  if (typeof unsubscribeLatestJobs === "function") {
    unsubscribeLatestJobs();
    unsubscribeLatestJobs = null;
  }

  currentUser = u;

  $("app").style.display = "block";

  if (!u) {
    $("userLine").textContent = "Guest";
    $("credits").textContent = "0";
    $("country").textContent = "—";
    $("lang").textContent = "—";
    $("userCard").style.display = "none";
    $("jobsCard").style.display = "none";
    $("btnWallet").style.display = "none";
    $("btnLogout").style.display = "none";
    closeAuth();
    try { await loadTemplates(); } catch (e) { console.warn(e); }
    $("jobs").textContent = "Sign in to see your jobs.";
    return;
  }

  closeAuth();
  $("userCard").style.display = "block";
  $("jobsCard").style.display = "block";
  $("btnWallet").style.display = "inline-block";
  $("btnLogout").style.display = "inline-block";
  $("userLine").textContent = u.email || "Signed in";

  if (analytics) {
    try { setUserId(analytics, u.uid); } catch {}
    try { setUserProperties(analytics, { user_email: u.email || "" }); } catch {}
  }

  await setDoc(doc(db, "users", u.uid), {
    email: u.email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    creditsBalance: 0
  }, { merge: true });

  try { await loadTemplates(); } catch (e) { console.warn(e); }
  unsubscribeUserDoc = watchUserDoc(u.uid);
  unsubscribeLatestJobs = watchLatestJobs(u.uid);
});
