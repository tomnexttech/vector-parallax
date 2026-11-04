/* Parallax service worker. Network first for everything of this site, so data and code are never shown old
 * while the network works; the cache is only a fallback when offline (the app then shows the data's own time in red
 * once it is older than 6 hours). Images from other sites are not touched. */
const CACHE = 'parallax-v4';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/tv.js', 'js/basemap.js', 'js/basemap_worker.js', 'js/snapshot.js', 'js/summary.js', 'js/places.js', 'js/prefs.js',
  'js/topics.js', 'js/map.js', 'js/map_worker.js', 'js/hazards.js', 'js/actions.js', 'js/voice.js', 'js/floor.js', 'js/autoscroll.js', 'js/tasks.js', 'manifest.webmanifest', 'assets/icons/icon-192.png'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  ev.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: url.pathname.endsWith('.json') ? false : true })
      .then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
