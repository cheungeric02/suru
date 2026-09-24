/* する service worker — STALE-WHILE-REVALIDATE for every same-origin GET.
   Serve the cached copy immediately on every launch (no network wait → opens fully offline
   and never hangs on weak/"lie-fi" signal), then fetch a fresh copy in the background and
   update the cache for next time. Cross-origin (Firebase / gstatic / CDNs) is left to the
   network, and non-GET requests are never touched. */
const CACHE = "suru-v10";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  // Cache each shell file individually so one bad entry can't reject the whole install
  // (a single 404 in addAll() would leave nothing cached). All ASSETS are verified to exist.
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(
    ASSETS.map(u => c.add(new Request(u, {cache:"reload"})).catch(err => console.warn("[suru sw] skip", u, err)))
  )).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                 // never touch writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // leave Firebase / gstatic / CDNs to the network

  const isPage = req.mode === "navigate" ||
                 url.pathname.endsWith("/") || url.pathname.endsWith("index.html");

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // For a navigation, any cached copy of the app shell resolves the launch (ignore ?query).
    let cached = await cache.match(req, {ignoreSearch:true});
    if (!cached && isPage) cached = await cache.match("./index.html");

    // Background revalidate: fetch fresh and update the cache for next launch. Never awaited
    // when we already have a cached copy, so a slow/fake connection can't delay the response.
    const fresh = fetch(req).then(r => {
      if (r && r.ok && r.type === "basic") cache.put(req, r.clone());
      return r;
    }).catch(() => null);

    if (cached) return cached;                        // instant — works offline & on lie-fi
    const net = await fresh;                          // first visit / uncached asset → use network
    if (net) return net;
    return (isPage ? (await cache.match("./index.html")) || Response.error() : Response.error());
  })());
});

/* tap a streak reminder → focus an open tab or open the app */
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if ("focus" in c) { c.focus(); return; } }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
