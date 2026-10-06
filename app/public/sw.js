const BUILD_ID = "dev";
const PRECACHE_URLS = [];

const SHELL_CACHE = `chad-shell-${BUILD_ID}`;
const RUNTIME_CACHE = "chad-runtime";
const RUNTIME_HOSTS = ["cdn.jsdelivr.net", "storage.googleapis.com"];
const NAV_TIMEOUT_MS = 3000;
const SHELL_URL = new URL("./", self.registration.scope).href;

self.addEventListener("install", (event) => {
  const urls = PRECACHE_URLS.map((u) => new URL(u, self.registration.scope).href);
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(urls)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (err) => (clearTimeout(timer), reject(err)),
    );
  });
}

async function navigate(request) {
  try {
    return await withTimeout(fetch(request), NAV_TIMEOUT_MS);
  } catch (err) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(SHELL_URL);
    if (cached) return cached;
    throw err;
  }
}

async function assetRequest(request, isRuntimeHost) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isRuntimeHost && (response.ok || response.type === "opaque")) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);

  if (RUNTIME_HOSTS.includes(url.hostname)) event.respondWith(assetRequest(request, true));
  else if (url.origin === self.location.origin) {
    event.respondWith(request.mode === "navigate" ? navigate(request) : assetRequest(request, false));
  }
});
