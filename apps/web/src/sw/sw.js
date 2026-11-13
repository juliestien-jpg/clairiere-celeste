// Service worker de « Clairière céleste » : jouer hors ligne, sans jamais toucher à la sauvegarde
// (IndexedDB n'est pas concerné). Fichier JavaScript simple, sans import : le build (vite.config.ts) remplace
// les marqueurs de version et de précache ci-dessous (liste des fichiers du build, chemins relatifs à ce fichier) et l'écrit
// dans dist/sw.js. Les chemins sont toujours relatifs à `registration.scope` : ça marche sous « / » comme
// sous « /clairiere-celeste/ ».
//
// Stratégie :
//  - précache de tous les fichiers du build à l'installation (les noms contiennent un hachage) ;
//  - fichiers : cache d'abord, réseau sinon ;
//  - pages : réseau d'abord (on voit tout de suite une nouvelle version en ligne), cache hors ligne ;
//  - mise à jour : la nouvelle version attend ; la page propose « Mettre à jour » et envoie SKIP_WAITING.
/* eslint-disable no-restricted-globals */
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE_PREFIX = "clairiere-celeste-";
const CACHE = CACHE_PREFIX + VERSION;
const SCOPE = self.registration.scope;
const INDEX = new URL("index.html", SCOPE).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new Request(new URL(p, SCOPE).href, { cache: "reload" })))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(INDEX).then((r) => r || Response.error())));
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});

// Toucher une notification ramène au jeu (onglet existant, sinon nouvelle fenêtre).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const mine = list.find((c) => c.url.startsWith(SCOPE));
      if (mine && "focus" in mine) return mine.focus();
      return self.clients.openWindow(SCOPE);
    }),
  );
});
