const SHELL_CACHE = "motrend-shell-v2";
const STATIC_CACHE = "motrend-static-v2";
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/app.js",
  "/save-video.html",
  "/save-video.js",
  "/gtm-bootstrap.js",
  "/pwa.js",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/assets/moads-logo.png",
  "/fonts/CoolveticaRg-Regular.woff",
  "/fonts/CoolveticaRg-Bold.woff",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];
const NETWORK_FIRST_PATHS = new Set([
  "/",
  "/index.html",
  "/app.js",
  "/save-video.html",
  "/save-video.js",
  "/gtm-bootstrap.js",
  "/pwa.js",
  "/manifest.webmanifest",
]);

function shouldIgnoreSearch(url) {
  return url.pathname === "/" || url.pathname === "/index.html";
}

function isLocalStaticAsset(url) {
  return (
    url.pathname === "/favicon.ico" ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/assets/")
  );
}

async function cacheResponse(cacheName, request, response) {
  if (!response || !response.ok) return response;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetch(request);
    await cacheResponse(SHELL_CACHE, request, response);
    return response;
  } catch (error) {
    const cached = await cache.match(request, {
      ignoreSearch: shouldIgnoreSearch(new URL(request.url)),
    });
    if (cached) {
      return cached;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  await cacheResponse(STATIC_CACHE, request, response);
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, {cache: "reload"})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => {
      if (key !== SHELL_CACHE && key !== STATIC_CACHE) {
        return caches.delete(key);
      }
      return Promise.resolve(false);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const {request} = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isShellDocument =
    request.mode === "navigate" &&
    (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/save-video.html");

  if (isShellDocument || NETWORK_FIRST_PATHS.has(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isLocalStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});
