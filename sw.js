/* Parallax service worker. Network first for everything of this site, so data and code are never shown old
 * while the network works; the cache is only a fallback when offline (the app then shows the data's own time in red
 * once it is older than 6 hours). Images from other sites are not touched. */
const CACHE = 'parallax-v51';
const SHELL_BASE = ['./', 'index.html', 'css/app.css', 'js/theme_boot.js', 'js/app.js', 'js/tv.js', 'js/basemap.js', 'js/basemap_worker.js', 'js/snapshot.js', 'js/summary.js', 'js/places.js', 'js/prefs.js', 'js/settings.js', 'js/settings_panel.js', 'js/provider.js', 'js/ownai.js', 'js/slim.js', 'js/login.js', 'js/connect.js', 'js/genres.js', 'js/feel.js', 'js/topics.js', 'js/map.js', 'js/map_worker.js', 'js/hazards.js', 'js/actions.js', 'js/voice.js', 'js/floor.js', 'js/autoscroll.js', 'js/tasks.js', 'js/sections.js', 'js/newsdesk.js', 'js/palette.js', 'js/absent.js', 'js/dossier.js', 'js/mapnews.js', 'js/wall.js', 'js/bias.js', 'js/entry.js', 'js/speak.js', 'js/story.js', 'js/i18n.js', 'js/scenes.js', 'js/politics_ui.js', 'js/landscape.js', 'js/touchmode.js', 'js/dial.js', 'js/tour.js', 'js/tidy.js', 'js/mapthemes.js', 'js/mapgl.js', 'js/mapstyle.js', 'js/vendor/maplibre-gl-csp.js', 'js/vendor/maplibre-gl-csp-worker.js', 'js/vendor/maplibre-gl.css', 'js/mapui.js', 'assets/map/borders.json', 'manifest.webmanifest', 'assets/icons/icon-192.png', 'js/coverage.js'];
// hero:begin
const SHELL_HERO = ['js/hero.js', 'js/orb.js', 'js/guide.js', 'js/demo.js', 'js/bubble.js', 'js/swipe.js'];
// hero:end
// app:begin
const SHELL_APP = ['js/search.js', 'js/netview.js', 'js/install.js', 'js/mail.js', 'assets/icons/icon-512.png', 'assets/icons/icon-maskable-512.png', 'assets/icons/icon-180.png'];
// app:end
const SHELL = [...SHELL_BASE, ...SHELL_HERO, ...SHELL_APP];

self.addEventListener('install', (ev) => {
  // fetch the shell past the HTTP cache: a new worker that reads a stale stylesheet from it would keep the old page for good
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // the event pages and the feeds are read straight from the site: not kept here, and never answered with the app's own page
  if (/\/s\/[^/]+\.html$/.test(url.pathname) || /\/feed[^/]*\.xml$/.test(url.pathname)) return;
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
