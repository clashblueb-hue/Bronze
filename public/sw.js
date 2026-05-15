<<<<<<< HEAD
const CACHE_NAME = "bronze-banner-v1";

const urlsToCache = [
  "/",
  "/index.html",
  "/styles.css",
  "/game.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
=======
const CACHE_NAME = "bronze-banner-v1";

const urlsToCache = [
  "/",
  "/index.html",
  "/styles.css",
  "/game.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
>>>>>>> e898f9c94c8fc417a466fdbe9c316750a2414953
