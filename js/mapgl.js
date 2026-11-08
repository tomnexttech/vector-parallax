/* mapgl — the map drawn by MapLibre GL JS (js/vendor, BSD-3-Clause): a detailed ground with names, and a globe.
 *
 *   loadLib() -> Promise<maplibregl>          reads js/vendor/maplibre-gl-csp.js and its worker and style once (same-origin files, the page's CSP is enough)
 *   createMapGL(canvas, opts, ml) -> api      the same calls as js/map.js's canvas map, so js/app.js, js/floor.js and js/mapui.js do not know which one they have:
 *     show(scene, animate), resize(), reset(), zoom(k), pin(on), view(), xy(lat, lon), geoAt(x, y), pick(x, y), jump(lat, lon, s),
 *     setTheme(T), setPicked(p), setNames(list: ignored, the ground has its own names), cursor
 *     and for this engine alone: setMode('case' | 'map' | 'flat'), globe(on), isGlobe(), ready (a Promise), destroy()
 *   canvas   the page's canvas of the old map; it stays in the page (hidden) and the map is put beside it
 *   opts     { onPick(hit), onPress(hit | null, { x, y, lat, lon }) -> true when taken, onPaint({ view, w, h, marks, moving }) }
 *
 * scene = as js/map.js: { focus, points: [{ lat, lon, n, pri, country, name, ref, field }], quakes, typhoons, disasters, layers, fresh, span }.
 * The marks of the news are one bubble a place with the number of news in it, coloured by the field of the heaviest, folded in Japan by the same
 * rule as the canvas map (marksAt in js/map.js). The hazards are drawn as that map draws them. Everything that is the page's own is a GeoJSON
 * source (js/mapstyle.js); a press asks the map what is under it and says the same hit as the canvas map did. */
import { buildStyle, OVERLAY } from './mapstyle.js';
import { marksAt, quakeR, SPAN } from './map.js';

const TILE = 512;
const BUBBLE = 1.7;                // marksAt folds by the size of the canvas map's marks; ours are this much larger
const ENVELOPE_KM = 900;
const FIELD_VAR = { 国内政治: '--g-pol', 国際: '--g-intl', 経済: '--g-eco', 安全保障: '--g-sec', 技術: '--g-tech', 市場: '--g-mkt', 災害: '--g-dis', その他: '--g-oth' };
const LOCAL_FONT = '"IBM Plex Sans JP", "Noto Sans JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, sans-serif';
const HELP = { 'CooperativeGesturesHandler.WindowsHelpText': 'Ctrl キーを押しながらスクロールすると拡大・縮小します', 'CooperativeGesturesHandler.MacHelpText': '⌘ キーを押しながらスクロールすると拡大・縮小します', 'CooperativeGesturesHandler.MobileHelpText': '2 本の指で地図を動かします' };
const ppd = (z) => (TILE * Math.pow(2, z)) / 360;
const wrapLon = (l) => ((((l + 540) % 360) + 360) % 360) - 180;
const finite = (...a) => a.every((x) => Number.isFinite(x));
const JSTF = typeof Intl === 'object' ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', day: 'numeric', hour: 'numeric', hourCycle: 'h23' }) : null;
const dayHour = (ts) => { if (!JSTF || !Number.isFinite(ts)) return ''; const o = {}; for (const p of JSTF.formatToParts(new Date(ts * 1000))) o[p.type] = p.value; return `${o.day}日 ${o.hour}時`; };
const hotQuake = (q) => q.mag >= 5 || ['4', '5-', '5+', '6-', '6+', '7'].includes(q.shindo);
const fc = (features) => ({ type: 'FeatureCollection', features });
const pt = (lon, lat, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [lon, lat] } });
const line = (coords, props) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });
const poly = (ring, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });
const leaves = (m) => (m.kids && m.kids.length ? m.kids.flatMap(leaves) : [m]);

/** a circle of km round (lat, lon) as a ring of [lon, lat] */
export function circleRing(lat, lon, km, n = 72) {
  const dLat = km / 111.32, dLon = dLat / Math.max(0.15, Math.cos((lat * Math.PI) / 180)), out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]); }
  out.push(out[0]);
  return out;
}
/** the point at a bearing (degrees from north) and a distance, [lon, lat] */
function bearingPoint(c, km, deg) {
  const r = Math.PI / 180, d = km / 111.32;
  return [c[1] + (d * Math.sin(deg * r)) / Math.max(0.15, Math.cos(c[0] * r)), c[0] + d * Math.cos(deg * r)];
}
const closed = (pts) => (pts.length && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) ? [...pts, pts[0]] : pts);
const ringsOf = (rings) => (rings || []).map((r) => { const a = []; for (let i = 0; i < r.length; i += 2) a.push([r[i], r[i + 1]]); return closed(a); });
/** the radius of a bubble: it grows with the news in it, and holds its number */
export const bubbleR = (n, cl) => Math.min(cl ? 24 : 21, 8.5 + 2.6 * Math.sqrt(Math.max(1, n)));

let libP = null;
export function loadLib() {
  if (typeof window === 'object' && window.maplibregl) return Promise.resolve(window.maplibregl);
  if (libP) return libP;
  libP = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = new URL('./vendor/maplibre-gl.css', import.meta.url).href;
    document.head.append(css);
    const s = document.createElement('script');
    s.src = new URL('./vendor/maplibre-gl-csp.js', import.meta.url).href; s.async = true;
    s.onload = () => { if (window.maplibregl) { try { window.maplibregl.setWorkerUrl(new URL('./vendor/maplibre-gl-csp-worker.js', import.meta.url).href); } catch { /* the library names its own */ } resolve(window.maplibregl); } else reject(new Error('maplibre-gl did not start')); };
    s.onerror = () => { libP = null; reject(new Error('maplibre-gl was not read')); };
    document.head.append(s);
  });
  return libP;
}

export function createMapGL(canvas, opts, ml) {
  const root = document.documentElement;
  const host = document.createElement('div');
  host.className = 'mgl';
  canvas.parentElement.insertBefore(host, canvas);
  canvas.style.display = 'none';
  const reduce = () => root.hasAttribute('data-calm') || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const modeOf = () => (root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

  let scene = null, themeNow = null, pickedNow = null, pinned = false, held = false, loaded = false, dead = false, globeOn = false, mode = 'case';
  let lastFocus = null, lastSpan = null, marksZ = null, paintQ = 0, markIndex = new Map(), hazIndex = { q: [], t: [], d: [] };
  let fields = null, palMode = modeOf();
  const api = { kind: 'gl', cursor: 'grab' };

  const colours = () => {
    const cs = getComputedStyle(host), v = (n, fb) => cs.getPropertyValue(n).trim() || fb;
    const f = {};
    for (const [k, n] of Object.entries(FIELD_VAR)) f[k] = v(n, '#9a9da3');
    f.other = v('--g-oth', '#9a9da3');
    return f;
  };
  const fieldColour = (field) => (fields && (fields[field] || fields.other)) || '#9a9da3';

  const style = () => ({ ...buildStyle(palMode, sources), projection: { type: globeOn ? 'globe' : 'mercator' } });
  const sources = {};
  const initial = targetFor(null, host.clientWidth || 800, host.clientHeight || 500);
  let map;
  try {
    map = new ml.Map({
      container: host, style: style(), center: initial.center, zoom: initial.zoom, minZoom: 0.3, maxZoom: 17, maxPitch: 0, pitchWithRotate: false, dragRotate: false,
      attributionControl: false, localIdeographFontFamily: LOCAL_FONT, cooperativeGestures: true, locale: HELP, fadeDuration: 120, pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      renderWorldCopies: true, hash: false, canvasContextAttributes: { antialias: true },
    });
  } catch (e) { host.remove(); canvas.style.display = ''; throw e; }
  try { map.touchZoomRotate.disableRotation(); } catch { /* */ }
  fields = colours();

  // ---------------------------------------------------------------- the camera
  function clampZ(z) { return Math.max(0.5, Math.min(14, Number.isFinite(z) ? z : 1.5)); }
  function padTop() { return mode === 'map' ? (host.clientWidth < 760 ? 112 : 104) : 0; }
  function targetFor(sc, W, H) {
    H = Math.max(120, H - padTop());
    if (sc && sc.focus) {
      const span = sc.span || SPAN;
      return { center: [sc.focus.lon, sc.focus.lat], zoom: clampZ(Math.log2((W * 360) / (span * TILE))) };
    }
    // the world: the whole of it across, or the globe whole in the height of the box
    return { center: [140, 28], zoom: clampZ(Math.max(Math.log2(W / TILE) + 0.35, Math.min(Math.log2((H * Math.PI * 0.88) / TILE), 2.6))) };
  }
  const size = () => { const c = map.getContainer(); return [Math.max(1, c.clientWidth), Math.max(1, c.clientHeight)]; };
  function goto(to, animate) {
    if (!to) return;
    const o = { center: to.center, zoom: to.zoom };
    if (animate && !reduce()) map.easeTo({ ...o, duration: 850, essential: false }); else map.jumpTo(o);
  }

  // ---------------------------------------------------------------- what is drawn
  const src = (id) => map.getSource(id);
  const put = (id, data) => { sources[id] = data; const s = loaded && src(id); if (s) s.setData(data); };
  const layerOn = (id) => !scene || !scene.layers || scene.layers[id] !== false;
  const themedCount = () => {
    const m = new Map();
    if (!themeNow) return m;
    const z = map.getZoom(), jp = ppd(z) >= (themeNow.jpFrom + themeNow.jpTo) / 2;
    for (const it of jp ? [...themeNow.countries, ...themeNow.prefs] : themeNow.countries) m.set(it.name, it.n);
    return m;
  };
  function refreshMarks() {
    marksZ = map.getZoom();
    markIndex = new Map();
    const feats = [];
    if (scene && layerOn('events')) {
      const ms = marksAt(scene.points || [], ppd(marksZ) / BUBBLE), themed = themedCount(), all = marksZ >= 5.2;
      ms.forEach((m, i) => {
        const cl = m.kind === 'cluster', n = themed.get(m.name) ?? m.n, pri = m.pri && layerOn('pri') ? 1 : 0, id = `${m.kind}|${m.name}|${i}`;
        markIndex.set(id, m);
        const say = m.name && (cl || m.pri || m.n >= 2 || all);
        feats.push(pt(m.lon, m.lat, { id, n, r: bubbleR(n, cl), fc: fieldColour(m.best && m.best.field), pri, cl: cl ? 1 : 0, ctry: m.country && !cl ? 1 : 0,
          lab: say ? m.name : '', sk: pri * 1e6 - n, lk: -(pri * 1e6 + n) }));
      });
    }
    put('px-marks', fc(feats));
  }
  function refreshHazards() {
    const sc = scene || {}, pts = [], areas = [], lines = [];
    hazIndex = { q: [], t: [], d: [] };
    if (layerOn('disasters')) (sc.disasters || []).forEach((d, i) => {
      if (!finite(d.lat, d.lon)) return;
      hazIndex.d.push(d);
      const hot = d.alert === 'Red' || d.alert === 'Orange';
      pts.push(pt(d.lon, d.lat, { k: 'd', i: hazIndex.d.length - 1, hot: hot ? 1 : 0, r: 7, t: hot ? String(d.name || '') : '', lk: hot ? -4.2 : 9 }));
    });
    if (layerOn('typhoons')) for (const t of sc.typhoons || []) {
      if (!Array.isArray(t.center) || !finite(t.center[0], t.center[1])) continue;
      hazIndex.t.push(t);
      const ti = hazIndex.t.length - 1, [la, lo] = t.center;
      const gale = t.galeC || { center: t.center, km: Math.max(0, ...(t.gale || []).map((r) => r.km || 0)) };
      const storm = t.stormC || { center: t.center, km: Math.max(0, ...(t.storm || []).map((r) => r.km || 0)) };
      for (const c of t.cone || []) if (Array.isArray(c) && c.length >= 3) areas.push(poly(closed(c.map(([a, b]) => [b, a])), { k: 'cone' }));
      if (gale.km) areas.push(poly(circleRing(gale.center[0], gale.center[1], gale.km), { k: 'gale' }));
      if (storm.km) areas.push(poly(circleRing(storm.center[0], storm.center[1], storm.km), { k: 'storm' }));
      const arcs = (area) => {
        for (const a of (area && area.arcs) || []) {
          if (!Array.isArray(a) || a.length < 3 || !Array.isArray(a[2]) || !Array.isArray(a[0])) continue;
          const c = []; const [a0, a1] = a[2];
          for (let d = a0; d < a1; d += 4) c.push(bearingPoint(a[0], a[1] / 1000, d));
          c.push(bearingPoint(a[0], a[1] / 1000, a1));
          if (c.length > 1) lines.push(line(c, { k: 'env' }));
        }
        for (const sg of (area && area.lines) || []) if (Array.isArray(sg) && sg.length === 2) lines.push(line(sg.map(([a, b]) => [b, a]), { k: 'env' }));
      };
      arcs(t.envelope); for (const f of t.forecast || []) arcs(f.area);
      if ((t.track || []).length > 1) lines.push(line([...t.track, t.center].map(([a, b]) => [b, a]), { k: 'track' }));
      const path = [t.center, ...(t.forecast || []).map((f) => f.center)];
      if (path.length > 1) lines.push(line(path.map(([a, b]) => [b, a]), { k: 'fc' }));
      for (const f of t.forecast || []) pts.push(pt(f.center[1], f.center[0], { k: 'f', t: dayHour(f.ts), lk: 8, r: 3 }));
      const no = Number(String(t.number || '').slice(-2));
      const nm = /台風|サイクロン|ハリケーン|熱帯/.test(t.name) ? t.name : `台風${no ? no + '号' : ''} ${t.name}`;
      pts.push(pt(lo, la, { k: 't', i: ti, t: `${String(nm).trim()}${t.pressure ? ` ${t.pressure} hPa` : ''}`, hot: 1, lk: -5, r: 9 }));
    }
    if (layerOn('quakes')) {
      const qs = [...(sc.quakes || [])].sort((a, b) => a.mag - b.mag);
      for (const q of qs) {
        if (!finite(q.lat, q.lon, q.mag)) continue;
        hazIndex.q.push(q);
        const hot = hotQuake(q), zq = map.getZoom(), say = hot ? (q.mag >= 6 || zq >= 4.2) : q.mag >= 4.5 && zq >= 5.6;
        pts.push(pt(q.lon, q.lat, { k: 'q', i: hazIndex.q.length - 1, hot: hot ? 1 : 0, r: quakeR(q.mag) * 1.25 + 2,
          t: say ? `M${q.mag.toFixed(1)}${q.shindo ? ` 震度${String(q.shindo).replace('-', '弱').replace('+', '強')}` : ''}` : '', lk: say ? -(hot ? 4 + q.mag / 100 : 1.4 + q.mag / 100) : 9 }));
      }
    }
    put('px-pt', fc(pts)); put('px-area', fc(areas)); put('px-line', fc(lines));
  }
  function refreshFocus() {
    const f = scene && scene.focus, on = f && finite(f.lat, f.lon);
    put('px-focus', fc(on ? [pt(f.lon, f.lat, { t: f.label || '' })] : []));
    put('px-ring', fc(on && f.radiusKm && layerOn('radius') ? [line(circleRing(f.lat, f.lon, f.radiusKm), {})] : []));
  }
  function refreshTheme() {
    const feats = [];
    if (themeNow && (!scene || !scene.layers || scene.layers.theme !== false)) {
      const add = (it, lvl) => { for (const ring of ringsOf(it.rings)) if (ring.length >= 4) feats.push(poly(ring, { a: it.a, lvl, jp: it.jp ? 1 : 0, name: it.name })); };
      for (const it of themeNow.countries) add(it, 'c');
      for (const it of themeNow.prefs) add(it, 'p');
    }
    put('px-theme', fc(feats));
  }
  function refreshPicked() {
    const feats = [];
    if (pickedNow) {
      if (pickedNow.rings) for (const ring of ringsOf(pickedNow.rings)) feats.push(line(ring, {}));
      if (finite(pickedNow.lat, pickedNow.lon)) feats.push(pt(wrapLon(pickedNow.lon), pickedNow.lat, {}));
    }
    put('px-picked', fc(feats));
  }
  function refreshAll() { refreshTheme(); refreshPicked(); refreshHazards(); refreshFocus(); refreshMarks(); }

  // ---------------------------------------------------------------- the diamonds (a disaster's mark) are drawn here, on demand
  map.on('styleimagemissing', (e) => {
    const hot = e.id === 'px-dia-hot';
    if (e.id !== 'px-dia' && !hot) return;
    const S = 18, c = document.createElement('canvas'); c.width = S * 2; c.height = S * 2;
    const g = c.getContext('2d'), P = hot ? (palMode === 'light' ? '#d70015' : '#ff6961') : (palMode === 'light' ? '#424245' : '#c3c3c8');
    g.scale(2, 2); g.beginPath(); g.moveTo(S / 2, 2.5); g.lineTo(S - 2.5, S / 2); g.lineTo(S / 2, S - 2.5); g.lineTo(2.5, S / 2); g.closePath();
    g.fillStyle = hot ? P + '33' : 'rgba(0,0,0,0)'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = P; g.globalAlpha = hot ? 1 : 0.7; g.stroke();
    try { map.addImage(e.id, g.getImageData(0, 0, S * 2, S * 2), { pixelRatio: 2 }); } catch { /* */ }
  });

  // ---------------------------------------------------------------- what is under a press
  const HITS = ['px-marks', 'px-ty', 'px-ty-ring', 'px-disaster', 'px-quake'];
  function pickAt(x, y) {
    if (!loaded) return null;
    const pad = 5, fs = map.queryRenderedFeatures([[x - pad, y - pad], [x + pad, y + pad]], { layers: HITS.filter((l) => map.getLayer(l)) });
    for (const layer of HITS) {
      const f = fs.find((q) => q.layer.id === layer);
      if (!f) continue;
      const p = f.properties, at = f.geometry.coordinates, s = map.project(at);
      if (layer === 'px-marks') { const m = markIndex.get(p.id); if (m) return m.kind === 'cluster' ? { x: s.x, y: s.y, r: p.r, kind: 'cluster', m } : { x: s.x, y: s.y, r: p.r, kind: 'event', p: m.best, m }; }
      else if (layer.startsWith('px-ty')) { const t = hazIndex.t[p.i]; if (t) return { x: s.x, y: s.y, r: 12, kind: 'typhoon', t }; }
      else if (layer === 'px-disaster') { const d = hazIndex.d[p.i]; if (d) return { x: s.x, y: s.y, r: 9, kind: 'disaster', d }; }
      else { const q = hazIndex.q[p.i]; if (q) return { x: s.x, y: s.y, r: p.r, kind: 'quake', q, hot: !!p.hot }; }
    }
    return null;
  }
  function zoomInto(m) {
    const ls = leaves(m);
    if (ls.length < 2) { map.easeTo({ center: [m.lon, m.lat], zoom: Math.min(14, map.getZoom() + 2.2), duration: reduce() ? 0 : 500 }); return; }
    const b = new ml.LngLatBounds([ls[0].lon, ls[0].lat], [ls[0].lon, ls[0].lat]);
    for (const k of ls) b.extend([k.lon, k.lat]);
    held = true;
    map.fitBounds(b, { padding: 70, maxZoom: 9, duration: reduce() ? 0 : 600 });
  }
  map.on('click', (e) => {
    const hit = pickAt(e.point.x, e.point.y), at = { x: e.point.x, y: e.point.y, lat: e.lngLat.lat, lon: wrapLon(e.lngLat.lng) };
    if (opts.onPress && opts.onPress(hit, at)) return;
    if (!hit) return;
    if (hit.kind === 'cluster') zoomInto(hit.m);
    else if (opts.onPick) opts.onPick(hit);
  });
  map.on('mousemove', (e) => { map.getCanvas().style.cursor = pickAt(e.point.x, e.point.y) ? 'pointer' : api.cursor; });
  map.on('dragstart', () => { held = true; });
  map.on('zoomstart', (e) => { if (e.originalEvent) held = true; });
  map.on('dblclick', () => { held = true; });

  // ---------------------------------------------------------------- the frame's reading, for the card that stands beside a place
  const info = (moving) => ({ view: api.view(), w: size()[0], h: size()[1], marks: [], moving });
  const painted = (moving) => { if (!opts.onPaint || paintQ) return; paintQ = requestAnimationFrame(() => { paintQ = 0; if (!dead) opts.onPaint(info(moving)); }); };
  const again = () => { refreshMarks(); refreshHazards(); };
  map.on('move', () => { painted(true); if (marksZ != null && Math.abs(map.getZoom() - marksZ) > 0.15) again(); });
  map.on('moveend', () => { if (marksZ == null || Math.abs(map.getZoom() - marksZ) > 0.02) again(); painted(false); });

  // ---------------------------------------------------------------- the lifecycle
  let readyOk, readyNo, settled = false;
  api.ready = new Promise((res, rej) => { readyOk = res; readyNo = rej; });
  const timer = setTimeout(() => { if (!settled) { settled = true; readyNo(new Error('the map did not load in time')); } }, 15000);
  // ready = the style is in and the ground's tile index (its TileJSON) has been read; the tiles themselves come in while the map shows
  let styleOk = false;
  const check = () => {
    const o = map.getSource('ofm');
    if (settled || !styleOk || !o || !o.loaded()) return;
    loaded = true; settled = true; clearTimeout(timer);
    try { map.setPadding({ top: padTop(), left: 0, right: 0, bottom: 0 }); } catch { /* */ }
    refreshAll();
    if (scene) goto(targetFor(scene, ...size()), false);
    readyOk(api);
  };
  map.on('style.load', () => { styleOk = true; check(); });
  map.on('sourcedata', (e) => { if (e.sourceId === 'ofm') check(); });
  let said = 0;
  map.on('error', (e) => {
    if (said++ < 6) console.warn('[mapgl]', e && e.error && e.error.message, e && e.sourceId || '');
    const bad = e && e.sourceId === 'ofm' && !e.tile;
    if (bad && !settled) { settled = true; clearTimeout(timer); readyNo(e.error || new Error('the ground did not load')); }
  });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { map.resize(); if (loaded && scene && !held) goto(targetFor(scene, ...size()), false); painted(false); }) : null;
  if (ro) ro.observe(host);
  const onTheme = () => { palMode = modeOf(); fields = colours(); if (!loaded) return; map.setStyle(style(), { diff: true }); map.once('styledata', () => { if (!dead) refreshAll(); }); };
  window.addEventListener('parallax-theme', onTheme);

  try { map.getCanvas().setAttribute('aria-label', '出来事・地震・台風・災害の地図。ドラッグで動かし、ボタンか 2 本の指で拡大します'); } catch { /* */ }
  Object.defineProperty(canvas, 'mapGl', { value: map, configurable: true });
  Object.assign(api, {
    show(sc, animate) {
      const moved = !pinned && (!scene || JSON.stringify(sc.focus) !== JSON.stringify(lastFocus) || sc.span !== lastSpan);
      scene = sc; lastFocus = sc.focus ? { ...sc.focus } : null; lastSpan = sc.span;
      if (!loaded) return;
      refreshHazards(); refreshFocus(); refreshMarks(); refreshTheme();
      if (moved) { held = false; goto(targetFor(sc, ...size()), animate); }
    },
    resize() { map.resize(); if (loaded && scene && !held) goto(targetFor(scene, ...size()), false); },
    reset() { held = false; if (scene) goto(targetFor(scene, ...size()), true); },
    zoom(k) { if (!loaded) return false; held = true; map.zoomTo(map.getZoom() + Math.log2(k), { duration: reduce() ? 0 : 260 }); return true; },
    pin(on) { pinned = !!on; },
    jump(lat, lon, s) { held = true; map.jumpTo({ center: [lon, lat], zoom: clampZ(Math.log2((s * 360) / TILE)) }); },
    view() {
      if (!loaded) return null;
      const b = map.getBounds(), c = map.getCenter(), z = map.getZoom(), [w, h] = size();
      return { lon0: b.getWest(), lat0: b.getNorth(), s: ppd(z), w, h, zoom: z, lonC: wrapLon(c.lng), latC: c.lat, west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth(), globe: globeOn };
    },
    xy(lat, lon) {
      if (!loaded || !finite(lat, lon)) return null;
      try { if (globeOn && map.transform && map.transform.isLocationOccluded && map.transform.isLocationOccluded(new ml.LngLat(lon, lat))) return null; } catch { /* */ }
      const p = map.project([lon, lat]);
      return [p.x, p.y];
    },
    geoAt(x, y) { if (!loaded) return null; const p = map.unproject([x, y]); return { lat: p.lat, lon: wrapLon(p.lng) }; },
    pick: (x, y) => pickAt(x, y),
    wheel() { /* the library takes the wheel itself (setMode decides when) */ },
    setTheme(T) { themeNow = T; if (loaded) { refreshTheme(); refreshMarks(); } },
    setPicked(p) { pickedNow = p; if (loaded) refreshPicked(); },
    setNames() { /* the ground has its own names */ },
    setMode(m) {
      mode = m;
      if (loaded) { try { map.setPadding({ top: padTop(), left: 0, right: 0, bottom: 0 }); } catch { /* */ } }
      try { if (m === 'map') map.cooperativeGestures.disable(); else map.cooperativeGestures.enable(); } catch { /* */ }
      try { map.dragPan.enable(); map.touchZoomRotate.enable(); map.touchZoomRotate.disableRotation(); } catch { /* */ }
    },
    globe(on) {
      on = !!on; if (on === globeOn) return;
      globeOn = on;
      if (loaded) { try { map.setProjection({ type: on ? 'globe' : 'mercator' }); } catch { /* */ } if (on) held = true; painted(false); }
    },
    isGlobe: () => globeOn,
    destroy() { dead = true; clearTimeout(timer); window.removeEventListener('parallax-theme', onTheme); if (ro) ro.disconnect(); try { map.remove(); } catch { /* */ } host.remove(); canvas.style.display = ''; },
  });
  api.setMode(mode);
  api.OVERLAY = OVERLAY;
  return api;
}
