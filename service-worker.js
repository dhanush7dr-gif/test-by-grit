const CACHE_NAME = "gritcore-v7";
const APP_FILES = [
  "./",
  "./index.html",
  "./base.css",
  "./dashboard.css",
  "./camera.css",
  "./mobile.css",
  "./analytics.css",
  "./achievements.css",
  "./theme.css",
  "./app.js",
  "./storage.js",
  "./dashboard.js",
  "./profile.js",
  "./camera.js",
  "./activity.js",
  "./analytics.js",
  "./achievements.js",
  "./records.js",
  "./quotes.js",
  "./quotes.json",
  "./theme.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith("/quotes.json")) {
      event.respondWith(
        fetch(request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) =>
              cache.put(request, response.clone()).catch((error) =>
                console.warn("Could not cache the updated quote collection.", error)
              )
            );
          }
          return response;
        }).catch(async (error) => {
          const cached = await caches.match(request);
          if (cached) return cached;
          throw error;
        })
      );
      return;
    }
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
      )
    );
    return;
  }

  const visionAsset = (url.hostname === "cdn.jsdelivr.net" &&
    url.pathname.includes("@mediapipe/tasks-vision")) ||
    (url.hostname === "storage.googleapis.com" &&
      url.pathname.includes("pose_landmarker"));
  if (!visionAsset) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type !== "opaque") {
        await cache.put(request, response.clone()).catch((error) => {
          console.warn("Could not cache a pose-tracking asset for offline use.", error);
        });
      }
      return response;
    })
  );
});
