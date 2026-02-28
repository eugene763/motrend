import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAnalytics, logEvent, setUserId, setUserProperties } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js";
import {
  getAuth, GoogleAuthProvider,
  signInWithPopup, onAuthStateChanged, signOut,
  signInWithEmailAndPassword, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, query, where, getDocs, addDoc, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional

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
let analytics = null;
try {
  analytics = getAnalytics(app);   // работает на https и в браузере
} catch (e) {
  // на некоторых окружениях (например локально) analytics может не стартовать — это ок
}

function track(name, params = {}) {
  if (!analytics) return;
  logEvent(analytics, name, params);
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

const ua = navigator.userAgent || "";
const isInApp = /Instagram|FBAN|FBAV|Facebook|TikTok|Telegram|Line|Twitter|LinkedIn|wv/i.test(ua);

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

// UI

// 2) Email/Password: Sign in
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

// 3) Email/Password: Sign up
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

// 4) Google OAuth: только для нормальных браузеров (не in-app)
$("btnLogin").onclick = async () => {
  clearAuthError();
  try {
    track("login_click", { method: "google" });
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (e) {
    const msg = String(e?.message || "");
    if (msg.toLowerCase().includes("missing initial state") || msg.toLowerCase().includes("sessionstorage")) {
      showAuthError("Google sign-in may fail in Telegram/Instagram browsers. Open this page in Safari/Chrome, or use Email/Password.");
      return;
    }
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

$("btnWallet").onclick = () => {
  // MVP: просто открываем страницу с пакетом ссылок/инструкций (сделаем позже красивее)
  alert("Wallet: set your Verifone buy links in code (see README). After payment, credits update via IPN.");
};

$("btnGenerate").onclick = async () => {
  if (!currentUser) {
    openAuth("Sign in to upload a photo and generate.");
    return;
  }
  if (!selectedTemplate) return alert("Pick a template first.");
  const file = $("filePhoto").files?.[0];
  if (!file) return alert("Upload a photo.");

  $("status").textContent = "Uploading photo…";
  $("result").style.display = "none";
  $("downloadLink").href = "#";

  const jobRef = await addDoc(collection(db, "jobs"), {
    uid: currentUser.uid,
    templateId: selectedTemplate.id,
    status: "queued",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const path = `user_uploads/${currentUser.uid}/${jobRef.id}/photo.jpg`;
  const r = ref(st, path);
  await uploadBytes(r, file, { contentType: file.type || "image/jpeg" });
  const photoUrl = await getDownloadURL(r);

  await updateDoc(doc(db, "jobs", jobRef.id), {
    inputImageUrl: photoUrl,
    inputImagePath: path,
    updatedAt: serverTimestamp(),
  });

  $("status").textContent = "Queued. Generating…";
};

const fp = $("filePhoto");
["pointerdown","touchstart","mousedown","click"].forEach(evt => {
  fp?.addEventListener(evt, (e) => {
    if (!currentUser) {
      e.preventDefault();
      e.stopPropagation();
      openAuth("Sign in to upload a photo.");
    }
  }, { capture: true });
});

function stopAllTemplateVideos(exceptEl = null) {
  document.querySelectorAll(".tplVideo").forEach(v => {
    if (v === exceptEl) return;
    try {
      v.pause();
      v.currentTime = 0;
      v.muted = true;
    } catch {}
  });
}

function clearTemplateStates() {
  document.querySelectorAll(".tplCard").forEach(c => {
    c.classList.remove("isHot");
    c.classList.remove("isSelected");
  });
}

function renderTemplateCard(t) {
  const div = document.createElement("div");
  div.className = "card tplCard";
  div.style.margin = "0";
  div.dataset.tid = t.id;

  const thumbUrl = t.preview?.thumbnailUrl || "";
  const videoUrl = t.preview?.previewVideoUrl || ""; // твой mp4-превью (3-4 сек)
  const mode = t.modeDefault || "std";

  div.innerHTML = `
    <div class="tplMedia">
      ${
        videoUrl
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

  // Попробуем автоплей везде, где можно (на мобилке часто сработает только muted+playsinline)
  if (vid) {
    // на iOS иногда нужно чуть позже дернуть play
    setTimeout(() => { vid.play().catch(() => {}); }, 50);
  }

  // 1) ТАП по превью: подсветить зелёным + включить звук (если возможно) + проигрывать этот ролик
  media.onclick = async () => {
    // подсветка "сейчас смотрю этот темплейт"
    document.querySelectorAll(".tplCard").forEach(c => c.classList.remove("isHot"));
    div.classList.add("isHot");

    if (!vid) return;

    stopAllTemplateVideos(vid);

    try {
      vid.muted = false;   // включаем звук
      vid.volume = 1;
      await vid.play();    // должно стартовать от user gesture
    } catch (e) {
      // если встроенный браузер блокирует звук — ок, просто без звука
      // (можно позже показать текст-подсказку, но ты просил без баннеров)
    }
  };

  // 2) "Use" подтверждает выбор темплейта
  useBtn.onclick = () => {
    selectedTemplate = t;
    $("selTemplate").value = `${t.title} (${t.durationSec}s ${mode})`;

    // визуально отмечаем выбранный темплейт
    document.querySelectorAll(".tplCard").forEach(c => c.classList.remove("isSelected"));
    div.classList.add("isSelected");

    track("template_selected", { templateId: t.id, title: t.title || "" });
  };

  return div;
}

async function loadTemplates() {
  const qy = query(collection(db, "templates"), where("isActive", "==", true), orderBy("order", "asc"), limit(30));
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

    if (needs) {
      $("inpLang").value = "en";
      if (!$("inpCountry").value) $("inpCountry").value = "US";
    }
  });
}

function watchLatestJobs(uid) {
  const qy = query(collection(db, "jobs"), where("uid", "==", uid), orderBy("createdAt", "desc"), limit(5));
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

onAuthStateChanged(auth, async (u) => {
  currentUser = u;

  // app всегда виден (даже гостю)
  $("app").style.display = "block";

  if (!u) {
    // гость
    $("userLine").textContent = "Guest";
    $("credits").textContent = "0";
    $("country").textContent = "—";
    $("lang").textContent = "—";
    $("userCard").style.display = "none";
    $("jobsCard").style.display = "none";

    $("btnWallet").style.display = "none";
    $("btnLogout").style.display = "none";

    // авторизация скрыта до действия (upload/generate)
    closeAuth();

    // шаблоны показываем гостю
    try { await loadTemplates(); } catch (e) { console.warn(e); }

    $("jobs").textContent = "Sign in to see your jobs.";
    return;
  }

  // залогинен
  closeAuth();

  $("btnWallet").style.display = "inline-block";
  $("btnLogout").style.display = "inline-block";
  $("userLine").textContent = u.email || "Signed in";

  if (analytics) {
    try { setUserId(analytics, u.uid); } catch {}
    try { setUserProperties(analytics, { user_email: u.email || "" }); } catch {}
  }
  track("login_success", { method: u.providerData?.[0]?.providerId || "unknown" });

  // ensure user doc exists
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
