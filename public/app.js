import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAnalytics, logEvent, setUserId, setUserProperties } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
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

let currentUser = null;
let selectedTemplate = null;

// UI
$("btnLogin").onclick = async () => {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
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
  if (!currentUser) return;
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

function renderTemplateCard(t) {
  const div = document.createElement("div");
  div.className = "card";
  div.style.margin = "0";
  div.innerHTML = `
    <img src="${t.preview?.thumbnailUrl || ""}" alt="">
    <div style="font-weight:700;margin-top:8px">${t.title || "Template"}</div>
    <div class="muted">${t.durationSec}s • ${t.modeDefault || "std"}</div>
    <button class="btn" style="margin-top:10px;width:100%">Use</button>
  `;
  div.querySelector("button").onclick = () => {
    selectedTemplate = t;
    $("selTemplate").value = `${t.title} (${t.durationSec}s ${t.modeDefault})`;
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

  if (!u) {
    $("auth").style.display = "block";
    $("app").style.display = "none";
    return;
  }

  $("auth").style.display = "none";
  $("app").style.display = "block";
  $("userLine").textContent = u.email || "Signed in";

  if (analytics) {
    try { setUserId(analytics, u.uid); } catch {}
    try { setUserProperties(analytics, { user_email: u.email || "" }); } catch {}
  }
  track("login_success", { method: "google" });

  // ensure user doc exists
  await setDoc(doc(db, "users", u.uid), {
    email: u.email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    creditsBalance: 0
  }, { merge: true });

  await loadTemplates();
  watchUserDoc(u.uid);
  watchLatestJobs(u.uid);
});
