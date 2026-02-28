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

function renderTemplateCard(t) {
  const div = document.createElement("div");
  div.className = "card tplCard";
  div.style.margin = "0";

  const thumbUrl = t.preview?.thumbnailUrl || "";
  const videoUrl = t.preview?.previewVideoUrl || "";
  const mode = t.modeDefault || "std";

  div.innerHTML = `
    <div class="tplMedia">
      ${videoUrl
        ? `<video class="tplVideo" src="${videoUrl}" poster="${thumbUrl}" playsinline muted loop autoplay preload="metadata"></video>`
        : `<img src="${thumbUrl}" alt="">`
      }
    </div>
    <div style="font-weight:700;margin-top:8px">${t.title || "Template"}</div>
    <div class="muted">${t.durationSec || "—"}s • ${mode}</div>
    <button class="btn tplUse" style="margin-top:10px;width:100%">Use</button>
  `;

  const media = div.querySelector(".tplMedia");
  const vid = div.querySelector(".tplVideo");
  const useBtn = div.querySelector(".tplUse");

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
  const qy = query(
    collection(db, "templates"),
    where("isActive", "==", true),
    orderBy("order", "asc"),
    limit(30)
  );
  const snap = await getDocs(qy);
  $("templates").innerHTML = "";
  snap.forEach(d => {
    const t = { id: d.id, ...d.data() };
    $("templates").appendChild(renderTemplateCard(t));
  });
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
    const rows = [];
    snap.forEach(d => {
      const j = d.data();
      rows.push(`${d.id.slice(0,6)}… • ${j.status} • ${j.outputVideoUrl ? "✅" : ""}`);
      if (j.outputVideoUrl && j.status === "done") {
        $("status").textContent = "Done.";
        $("result").style.display = "block";
        $("downloadLink").href = j.outputVideoUrl;
      }
      if (j.status === "failed") {
        $("status").textContent = `Failed: ${j.errorMessage || "try another photo/template"}`;
      }
    });
    $("jobs").innerHTML = rows.map(r => `<div>${r}</div>`).join("");
  });
}

$("btnGenerate").onclick = async () => {
  if (!currentUser) { openAuth("Sign in to upload a photo and generate."); return; }
  if (!selectedTemplate) return alert("Pick a template first.");
  const file = $("filePhoto").files?.[0];
  if (!file) return alert("Upload a photo.");

  $("status").textContent = "Uploading photo…";
  $("result").style.display = "none";
  $("downloadLink").href = "#";

  // 1) create job on server
  const resp = await createJob({ templateId: selectedTemplate.id });
  const jobId = resp.data.jobId;
  const path = resp.data.uploadPath;

  // 2) upload photo
  const r = ref(st, path);
  await uploadBytes(r, file, { contentType: file.type || "image/jpeg" });
  const photoUrl = await getDownloadURL(r);

  // 3) write input to job doc (триггер увидит inputImageUrl)
  await updateDoc(doc(db, "jobs", jobId), {
    inputImageUrl: photoUrl,
    inputImagePath: path,
    updatedAt: serverTimestamp(),
  });

  $("status").textContent = "Queued. Generating…";
};

onAuthStateChanged(auth, async (u) => {
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
  watchUserDoc(u.uid);
  watchLatestJobs(u.uid);
});
