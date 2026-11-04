/* basemap_worker — the detailed ground of the map, built off the main thread (a classic Worker; js/basemap.js asks).
 *
 * Carried over from the board this app grew out of (its basemap_worker.js): the same way of drawing, layer by layer, in grey.
 *   relief      hillshade from elevation tiles, light from the north-west at 45 degrees, the vertical exaggerated more the further
 *               out the scale (mountain ranges stay readable at the scale of the world), one step lighter where a contour is crossed,
 *               the sea left alone. Computed on the Mercator mosaic of the tiles (across their seams), then laid onto the
 *               equirectangular sheet one row at a time (x is linear in longitude, so one drawImage per row).
 *   water       sea, lakes and large rivers as polygons, in the colour of the sea; the coast as one fine band on the land side.
 *   lines       rivers (thin, the colour of water), railways (dashed), roads in five classes shown by scale, state borders
 *               (dashed), national borders (a fine core on a dark casing), disputed borders (dashed). No names: the marks of
 *               the board speak on this map, not the ground.
 * The sheet is opaque where it has data. Where a vector tile could not be read the sheet is cleared, so the ground underneath
 * (the bundled one) shows through; a sheet with more than a quarter of its vector tiles missing is not made at all.
 *
 * Sources, both without a key, fetched here directly (the static site has no relay):
 *   vector  OpenFreeMap (OpenMapTiles schema, OpenStreetMap data). The tile URL carries a version, so it is read from the
 *           TileJSON each time the worker starts. Attribution: © OpenStreetMap contributors · OpenMapTiles · OpenFreeMap.
 *   relief  AWS Terrain Tiles (Terrarium): elevation = R * 256 + G + B / 256 - 32768 m.
 *
 * Messages:
 *   in  { type: 'build', id, pl, pri }   pl = js/basemap.js plan() (lonA lonB latS latN res px zD zV key world col)
 *   in  { type: 'cancel', id }
 *   out { type: 'hello', oc } | { type: 'start', id } | { type: 'done', id, sheet, bmp } | { type: 'none', id, why }
 *       | { type: 'drop', id } | { type: 'error', id, msg }        bmp is an ImageBitmap, transferred (no copy). */
'use strict';

const MLAT = 85.0511287798, R2D = 180 / Math.PI;
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const VEC_HOST = /^https:\/\/tiles\.openfreemap\.org\/[^?#]*\{z\}\/\{x\}\/\{y\}\.pbf$/;
const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/';
const mod = (a, n) => ((a % n) + n) % n;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const now = () => (self.performance ? self.performance.now() : Date.now());
// Mercator v (0 = north edge, 1 = south edge) and latitude
const mercY = (lat) => { const p = clamp(lat, -MLAT, MLAT) / R2D; return (1 - Math.log(Math.tan(p) + 1 / Math.cos(p)) / Math.PI) / 2; };
const latOf = (v) => Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * R2D;
const canvas = (w, h) => new OffscreenCanvas(w, h);
const free = (c) => { try { c.width = 0; c.height = 0; } catch { /* left to GC */ } };

/* ---------------------------------------------------------------- a clock: let go now and then, and hear a cancel */
const CANCEL = { cancel: true };
const pause = () => new Promise((r) => setTimeout(r, 0));
function clock(alive, budget) {
  let t0 = now();
  return {
    due: () => now() - t0 > budget,
    async rest() { await pause(); t0 = now(); if (!alive()) throw CANCEL; },
    check() { if (!alive()) throw CANCEL; },
  };
}

/* ---------------------------------------------------------------- tiles (kept few: the machine is short of memory) */
let tpl = null, tplFail = 0;
function template() {
  if (tpl) return tpl;
  if (Date.now() - tplFail < 30000) return Promise.reject(new Error('tilejson'));
  tpl = fetch(TILEJSON).then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))).then((j) => {
    const t = j && Array.isArray(j.tiles) ? j.tiles[0] : null;
    if (typeof t !== 'string' || !VEC_HOST.test(t)) throw new Error('tilejson: no tile URL');
    return t;
  });
  tpl.catch(() => { tpl = null; tplFail = Date.now(); });
  return tpl;
}
const memo = new Map();                 // key -> { kind, p, v }   in the order last used
const CAP = { dem: 40, vec: 20e6 };     // elevation: tiles (256 KB each decoded); vector: bytes of the tiles kept
const held = new Set();                 // keys used by the sheet being built (not let go while it is)
let fetched = 0;
function get(kind, z, x, y) {
  const k = kind + '/' + z + '/' + x + '/' + y;
  let e = memo.get(k);
  held.add(k);
  if (e) { memo.delete(k); memo.set(k, e); return e.p; }
  e = { kind, p: null, v: null };
  const load = kind === 'dem'
    ? fetch(DEM_URL + z + '/' + x + '/' + y + '.png').then((r) => (r.ok ? r.blob() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((b) => createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
    : template().then((t) => fetch(t.replace('{z}', z).replace('{x}', x).replace('{y}', y)))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status)))).then((b) => mvt(new Uint8Array(b)));
  e.p = load.then((v) => { e.v = v; e.n = kind === 'dem' ? 1 : v.bytes; fetched++; trim(kind); return v; })
    .catch(() => { if (memo.get(k) === e) memo.delete(k); return null; });     // a failure is not kept: asked again next time
  memo.set(k, e);
  return e.p;
}
function trim(kind) {
  let n = 0;
  for (const e of memo.values()) if (e.kind === kind && e.v) n += e.n;
  for (const [k, e] of memo) {
    if (n <= CAP[kind]) break;
    if (e.kind !== kind || !e.v || held.has(k)) continue;
    memo.delete(k); n -= e.n;
    if (kind === 'dem') { try { e.v.close(); } catch { /* */ } }
  }
}

/* ---------------------------------------------------------------- vector tiles (Mapbox Vector Tile 2.1), only what is drawn.
   The geometry stays in the tile's bytes (an offset and an end); it is read when it is drawn. */
const td = new TextDecoder();
const LAYERS = new Set(['water', 'waterway', 'transportation', 'boundary']);
const ROAD = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'rail']);
const PROPS = ['class', 'intermittent', 'brunnel', 'admin_level', 'maritime', 'disputed'];
const KEEP = {
  water: (p) => true,
  waterway: (p) => p.class === 'river',
  transportation: (p) => ROAD.has(p.class),
  boundary: (p) => p.admin_level >= 2 && p.admin_level <= 4,
};
function vi(rd) { const b = rd.b; let r = 0, m = 1, c; do { c = b[rd.p++]; r += (c & 127) * m; m *= 128; } while (c >= 128); return r; }
function skip(rd, wt) {
  if (wt === 0) vi(rd); else if (wt === 1) rd.p += 8; else if (wt === 2) { const n = vi(rd); rd.p += n; } else if (wt === 5) rd.p += 4;
  else throw new Error('tile: wire type ' + wt);
}
function mvt(b) {
  const rd = { b, p: 0 }, out = { bytes: b.length };
  while (rd.p < b.length) {
    const t = vi(rd);
    if (t === 26) { const n = vi(rd), e = rd.p + n; const L = layer(rd, e); if (L) out[L.name] = L; rd.p = e; }
    else skip(rd, t & 7);
  }
  return out;
}
function layer(rd, end) {
  const L = { name: '', ext: 4096, keys: [], vals: [], feats: [], b: rd.b };
  while (rd.p < end) {
    const t = vi(rd), f = Math.floor(t / 8), wt = t & 7;
    if (f === 1 && wt === 2) {
      const n = vi(rd); L.name = td.decode(rd.b.subarray(rd.p, rd.p + n)); rd.p += n;
      if (!LAYERS.has(L.name)) { rd.p = end; return null; }
    }
    else if (f === 5 && wt === 0) L.ext = vi(rd);
    else if (f === 3 && wt === 2) { const n = vi(rd); L.keys.push(td.decode(rd.b.subarray(rd.p, rd.p + n))); rd.p += n; }
    else if (f === 4 && wt === 2) { const n = vi(rd); L.vals.push(value(rd, rd.p + n)); }
    else if (f === 2 && wt === 2) { const n = vi(rd); L.feats.push(feature(rd, rd.p + n)); }
    else skip(rd, wt);
  }
  if (!LAYERS.has(L.name)) return null;
  const keep = KEEP[L.name], want = PROPS.map((k) => L.keys.indexOf(k));
  const feats = [];
  for (const ft of L.feats) {
    const p = {};
    for (let i = 0; i + 1 < ft.tags.length; i += 2) {
      const at = want.indexOf(ft.tags[i]);
      if (at >= 0) p[PROPS[at]] = L.vals[ft.tags[i + 1]];
    }
    if (ft.gs >= ft.ge || !keep(p)) continue;
    feats.push({ type: ft.type, gs: ft.gs, ge: ft.ge, p });
  }
  L.feats = feats; L.keys = null; L.vals = null;
  return L;
}
function value(rd, end) {
  let v = null;
  while (rd.p < end) {
    const t = vi(rd), f = Math.floor(t / 8), wt = t & 7;
    if (f === 1 && wt === 2) { const n = vi(rd); v = td.decode(rd.b.subarray(rd.p, rd.p + n)); rd.p += n; }
    else if (f === 2 && wt === 5) { v = new DataView(rd.b.buffer, rd.b.byteOffset + rd.p, 4).getFloat32(0, true); rd.p += 4; }
    else if (f === 3 && wt === 1) { v = new DataView(rd.b.buffer, rd.b.byteOffset + rd.p, 8).getFloat64(0, true); rd.p += 8; }
    else if ((f === 4 || f === 5) && wt === 0) v = vi(rd);
    else if (f === 6 && wt === 0) { const z = vi(rd); v = z % 2 ? -(z + 1) / 2 : z / 2; }
    else if (f === 7 && wt === 0) v = !!vi(rd);
    else skip(rd, wt);
  }
  rd.p = end;
  return v;
}
function feature(rd, end) {
  const ft = { type: 0, tags: [], gs: 0, ge: 0 };
  while (rd.p < end) {
    const t = vi(rd), f = Math.floor(t / 8), wt = t & 7;
    if (f === 2 && wt === 2) { const n = vi(rd), e = rd.p + n; while (rd.p < e) ft.tags.push(vi(rd)); }
    else if (f === 3 && wt === 0) ft.type = vi(rd);
    else if (f === 4 && wt === 2) { const n = vi(rd); ft.gs = rd.p; ft.ge = rd.p + n; rd.p += n; }
    else skip(rd, wt);
  }
  rd.p = end;
  return ft;
}
/** the feature's path onto g; P(x, y) = tile coordinates -> sheet px */
function trace(g, L, ft, P) {
  const rd = { b: L.b, p: ft.gs }, end = ft.ge;
  let x = 0, y = 0;
  while (rd.p < end) {
    const c = vi(rd), id = c & 7, cnt = c >>> 3;
    if (id === 1 || id === 2) {
      for (let k = 0; k < cnt && rd.p < end; k++) {
        const dx = vi(rd), dy = vi(rd);
        x += (dx >>> 1) ^ -(dx & 1); y += (dy >>> 1) ^ -(dy & 1);
        const q = P(x, y);
        if (id === 1) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]);
      }
    } else if (id === 7) g.closePath();
  }
}

/* ---------------------------------------------------------------- the sheet */
const tileRect = (tx, ty, n, s) => {
  const x = ((tx / n) * 360 - 180 - s.lonA) * s.rx, yT = (s.latN - latOf(ty / n)) * s.ry, yB = (s.latN - latOf((ty + 1) / n)) * s.ry;
  return { x, y: yT, w: (360 / n) * s.rx, h: yB - yT };
};
const projector = (tx, ty, n, ext, s) => {
  const ax = (360 / n / ext) * s.rx, bx = ((tx / n) * 360 - 180 - s.lonA) * s.rx, v0 = ty / n, dv = 1 / n / ext;
  return (px, py) => [bx + px * ax, (s.latN - latOf(v0 + py * dv)) * s.ry];
};

/** the relief as grey over the land tone: white where the slope faces the light, black where it turns away; nothing on the flat
 * and nothing at sea. Light from the north-west, altitude 45 degrees. */
async function hillshade(dem, dx0, dy0, nx, ny, z, ck) {
  const Wm = nx * 256, Hm = ny * 256, c = canvas(Wm, Hm);
  const cg = c.getContext('2d', { willReadFrequently: true });
  const have = new Uint8Array(nx * ny);
  for (const d of dem) if (d.im) { cg.drawImage(d.im, (d.tx - dx0) * 256, (d.ty - dy0) * 256); have[(d.ty - dy0) * nx + (d.tx - dx0)] = 1; }
  const src = cg.getImageData(0, 0, Wm, Hm).data, E = new Float32Array(Wm * Hm);
  for (let y = 0; y < Hm; y++) {
    if ((y & 63) === 0 && ck.due()) await ck.rest();
    for (let x = 0; x < Wm; x++) {
      const i = y * Wm + x, k = i * 4;
      E[i] = have[(y >> 8) * nx + (x >> 8)] ? src[k] * 256 + src[k + 1] + src[k + 2] / 256 - 32768 : NaN;   // a missing tile is not drawn
    }
  }
  const out = cg.createImageData(Wm, Hm), o = out.data, n = 2 ** z;
  const ex = 1.5 * 2 ** ((9 - z) * 0.55);                    // vertical exaggeration, stronger further out
  const cA = Math.cos(Math.PI / 4) / Math.SQRT2, sA = Math.sin(Math.PI / 4);
  const ci = z <= 4 ? 1000 : z <= 6 ? 500 : 250;             // contour step (m)
  for (let y = 0; y < Hm; y++) {
    if ((y & 31) === 0 && ck.due()) await ck.rest();
    const lat = latOf((dy0 * 256 + y + 0.5) / (n * 256)) / R2D;
    const inv = ex / (2 * ((40075016.686 * Math.cos(lat)) / (n * 256)));
    const up = (y > 0 ? y - 1 : y) * Wm, dn = (y < Hm - 1 ? y + 1 : y) * Wm;
    for (let x = 0; x < Wm; x++) {
      const i = y * Wm + x, e = E[i];
      if (!(e > -40)) continue;                               // the sea (and what cannot be read) stays clear
      const xl = x > 0 ? i - 1 : i, xr = x < Wm - 1 ? i + 1 : i;
      const fe = (E[xr] - E[xl]) * inv, fs = (E[dn + x] - E[up + x]) * inv;
      if (!Number.isFinite(fe) || !Number.isFinite(fs)) continue;
      const s = (cA * (fe + fs) + sA) / Math.sqrt(1 + fe * fe + fs * fs);
      // light only, in the grey of the page: the land is a faint lit field over the dark ground, the slopes that face the light
      // turn toward white, contour steps add a trace. No dark shading (the ground under it is already dark)
      let a = 0.085 + 0.5 * (s - sA) + 0.05 * Math.min(1, Math.max(0, e) / 3000);
      if (e > 0) { const b = Math.floor(e / ci); if (Math.floor(E[xr] / ci) !== b || Math.floor(E[dn + x] / ci) !== b) a += 0.06; }
      a = a < 0 ? 0 : a > 0.46 ? 0.46 : a;
      const hi = s > sA + 0.1 ? Math.min(1, (s - sA - 0.1) * 4) : 0, k = i * 4;
      o[k] = 206 + 40 * hi; o[k + 1] = 208 + 39 * hi; o[k + 2] = 213 + 37 * hi; o[k + 3] = a * 255;
    }
  }
  cg.putImageData(out, 0, 0);
  return c;
}

// [class, width (css px), colour, from zoom] — cyan, brighter and whiter for the larger road
const ROADS = [
  ['tertiary', 0.4, 'rgba(143,216,242,.17)', 10],
  ['secondary', 0.5, 'rgba(143,216,242,.24)', 9],
  ['primary', 0.6, 'rgba(143,216,242,.34)', 8],
  ['trunk', 0.75, 'rgba(200,236,252,.42)', 7],        // in Japan every national route is a trunk: dense, so not before z7
  ['motorway', 0.9, 'rgba(226,244,252,.52)', 5],
];
function lines(g, t, P, z, px, col) {
  const stroke = (L, test, w, colour, dash) => {
    if (!L) return;
    const Pl = P(L.ext);
    g.beginPath();
    let any = false;
    for (const ft of L.feats) if (ft.type === 2 && test(ft.p)) { trace(g, L, ft, Pl); any = true; }
    if (!any) return;
    g.lineWidth = w * px; g.strokeStyle = colour; g.setLineDash(dash ? dash.map((d) => d * px) : []);
    g.stroke();
  };
  if (z >= 5) stroke(t.waterway, (p) => !p.intermittent && p.brunnel !== 'tunnel', 0.6, col.sea);
  if (z >= 6) stroke(t.transportation, (p) => p.class === 'rail' && p.brunnel !== 'tunnel', 0.45, 'rgba(143,216,242,.22)', [3, 2.5]);
  // roads are quieter while they are many and far (a whole country's motorways at once)
  const quiet = z <= 6 ? 0.5 : z <= 8 ? 0.65 : 0.85;
  g.globalAlpha = quiet;
  for (const [cls, w, colour, zmin] of ROADS) if (z >= zmin) stroke(t.transportation, (p) => p.class === cls, w, colour);
  g.globalAlpha = 1;
  if (z >= 4) stroke(t.boundary, (p) => p.admin_level >= 3 && p.admin_level <= 4 && !p.maritime, 0.6, 'rgba(143,216,242,.34)', [4, 3]);
  const nat = (p) => p.admin_level === 2 && !p.maritime;
  stroke(t.boundary, nat, 2.8, 'rgba(96,170,206,.16)');
  stroke(t.boundary, (p) => nat(p) && !p.disputed, 1.0, 'rgba(238,247,252,.88)');
  stroke(t.boundary, (p) => nat(p) && p.disputed, 1.0, 'rgba(238,247,252,.7)', [4, 3]);
}
const WATER_SKIP = new Set(['swimming_pool', 'pond']);
const COAST = new Set(['ocean', 'lake']);

/** -> { sheet, cv } | { none: why }; throws CANCEL when it is no longer wanted */
async function build(pl, alive, opt) {
  const ck = clock(alive, opt.budget || 40);
  const T = { t0: now() };
  const col = pl.col || {};
  col.sea = col.sea || '#121315'; col.land = col.land || '#2a2a2b'; col.coast = col.coast || 'rgba(226,228,232,.34)';
  const Wd = Math.max(2, Math.round((pl.lonB - pl.lonA) * pl.res)), Hd = Math.max(2, Math.round((pl.latN - pl.latS) * pl.res));
  const s = { world: pl.world, tier: pl.world ? 'world' : 'reg', key: pl.key, lonA: pl.lonA, lonB: pl.lonB, latS: pl.latS, latN: pl.latN,
    rx: Wd / (pl.lonB - pl.lonA), ry: Hd / (pl.latN - pl.latS), ok: false, holes: false, at: Date.now() };
  s.res = s.rx;
  const nD = 2 ** pl.zD, nV = 2 ** pl.zV;
  const cols = (n) => [Math.floor(((pl.lonA + 180) / 360) * n), Math.ceil(((pl.lonB + 180) / 360) * n) - 1];
  const rows = (n) => [Math.max(0, Math.floor(mercY(pl.latN) * n)), Math.min(n - 1, Math.ceil(mercY(pl.latS) * n) - 1)];
  const [dx0, dx1] = cols(nD), [dy0, dy1] = rows(nD), [vx0, vx1] = cols(nV), [vy0, vy1] = rows(nV);
  const dem = [], vec = [], jobs = [];
  held.clear();
  for (let tx = dx0; tx <= dx1; tx++) for (let ty = dy0; ty <= dy1; ty++) jobs.push(get('dem', pl.zD, mod(tx, nD), ty).then((im) => dem.push({ tx, ty, im })));
  for (let tx = vx0; tx <= vx1; tx++) for (let ty = vy0; ty <= vy1; ty++) jobs.push(get('vec', pl.zV, mod(tx, nV), ty).then((t) => vec.push({ tx, ty, t })));
  await Promise.race([Promise.all(jobs), opt.abort]);           // a cancel is heard while the tiles are on their way
  ck.check();
  T.fetch = now() - T.t0;
  const missD = dem.filter((d) => !d.im).length, missV = vec.filter((v) => !v.t).length;
  if (!vec.length || missV > vec.length * 0.25) return { none: 'tiles ' + missD + '/' + dem.length + ' ' + missV + '/' + vec.length };
  s.ok = !missD && !missV; s.holes = missV > 0;
  await ck.rest();

  const cv = canvas(Wd, Hd), g = cv.getContext('2d');
  let t = now();
  // 1) the land tone, and the relief on it (Mercator -> equirectangular, one drawImage per row)
  g.fillStyle = col.land; g.fillRect(0, 0, Wd, Hd);
  if (dem.length && missD < dem.length) {
    const shade = await hillshade(dem, dx0, dy0, dx1 - dx0 + 1, dy1 - dy0 + 1, pl.zD, ck);
    const sx0 = (((pl.lonA + 180) / 360) * nD - dx0) * 256, sw = ((pl.lonB - pl.lonA) / 360) * nD * 256, TT = nD * 256, my0 = dy0 * 256;
    g.imageSmoothingEnabled = true;
    for (let j = 0; j < Hd; j++) {
      if ((j & 63) === 0 && ck.due()) await ck.rest();
      const sy = mercY(pl.latN - (j + 0.5) / s.ry) * TT - my0;
      g.drawImage(shade, sx0, clamp(sy - 0.5, 0, shade.height - 1), sw, 1, 0, j, Wd, 1);
    }
    free(shade);
  }
  T.shade = now() - t; t = now();
  await ck.rest();
  // 2) water (sea, lakes, large rivers) in the colour of the sea; the coast as one band on the land side
  // the coast is drawn round the sea and the lakes only (not round every river and reservoir: that turns the land into a mesh)
  const wm = canvas(Wd, Hd), wg = wm.getContext('2d'), cm = canvas(Wd, Hd), cg = cm.getContext('2d');
  wg.fillStyle = '#fff'; cg.fillStyle = '#fff';
  const miss = [];
  for (const v of vec) {
    if (ck.due()) await ck.rest();
    if (!v.t) { miss.push(tileRect(v.tx, v.ty, nV, s)); continue; }
    const L = v.t.water;
    if (!L) continue;
    const P = projector(v.tx, v.ty, nV, L.ext, s);
    wg.beginPath(); cg.beginPath();
    let any = false, coast = false;
    for (const ft of L.feats) {
      if (ft.type !== 3 || ft.p.intermittent || WATER_SKIP.has(ft.p.class) || ft.p.brunnel === 'tunnel') continue;
      trace(wg, L, ft, P); any = true;
      if (COAST.has(ft.p.class)) { trace(cg, L, ft, P); coast = true; }
    }
    if (any) wg.fill('nonzero');
    if (coast) cg.fill('nonzero');
  }
  const k = pl.world ? Math.max(1, Math.round(1.1 * pl.px) / 2) : Math.max(1, Math.round(0.55 * pl.px));
  const ed = canvas(Wd, Hd), eg = ed.getContext('2d');
  for (const [ox, oy] of [[k, 0], [-k, 0], [0, k], [0, -k]]) eg.drawImage(cm, ox, oy);
  free(cm);
  eg.globalCompositeOperation = 'destination-out';
  eg.drawImage(wm, 0, 0);
  for (const r of miss) eg.clearRect(r.x - k, r.y - k, r.w + 2 * k, r.h + 2 * k);   // the edge of a missing tile is not a coast
  eg.globalCompositeOperation = 'source-in';
  eg.fillStyle = col.coast; eg.fillRect(0, 0, Wd, Hd);
  wg.globalCompositeOperation = 'source-in';
  wg.fillStyle = col.sea; wg.fillRect(0, 0, Wd, Hd);
  g.drawImage(wm, 0, 0);
  g.drawImage(ed, 0, 0);
  free(wm); free(ed);
  T.water = now() - t; t = now();
  // 3) lines, each tile clipped to its own frame (the tiles' buffers are not drawn twice)
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const v of vec) {
    if (!v.t) continue;
    if (ck.due()) await ck.rest();
    const r = tileRect(v.tx, v.ty, nV, s);
    if (r.x > Wd || r.x + r.w < 0 || r.y > Hd || r.y + r.h < 0) continue;
    g.save();
    g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
    lines(g, v.t, (ext) => projector(v.tx, v.ty, nV, ext, s), pl.zV, pl.px, col);
    g.restore();
  }
  // 4) where a vector tile is missing, nothing (the bundled ground shows through)
  for (const r of miss) g.clearRect(Math.floor(r.x), Math.floor(r.y), Math.ceil(r.w) + 1, Math.ceil(r.h) + 1);
  ck.check();
  T.lines = now() - t;
  T.total = now() - T.t0;
  s.ms = { fetch: Math.round(T.fetch), shade: Math.round(T.shade), water: Math.round(T.water), lines: Math.round(T.lines), total: Math.round(T.total), tiles: dem.length + vec.length };
  return { sheet: s, cv };
}

/* ---------------------------------------------------------------- the queue: the view's sheet first, then the world's; one at a time */
let oc = false;
try { oc = typeof OffscreenCanvas === 'function' && !!new OffscreenCanvas(1, 1).getContext('2d') && typeof OffscreenCanvas.prototype.transferToImageBitmap === 'function'; } catch { oc = false; }
const queue = [];
let cur = null, nseq = 0;
self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === 'build') {
    let kill;
    const abort = new Promise((r) => { kill = r; });
    const job = { id: m.id, pl: m.pl, pri: m.pri || 0, dead: false, abort, kill, seq: nseq++ };
    queue.push(job);
    if (cur && cur.pri > job.pri) { cur.dead = true; cur.kill(); }   // the view's own sheet goes before the world's (asked again later)
    pump();
  } else if (m.type === 'cancel') {
    if (cur && cur.id === m.id) { cur.dead = true; cur.kill(); }
    const i = queue.findIndex((j) => j.id === m.id);
    if (i >= 0) { queue.splice(i, 1); self.postMessage({ type: 'drop', id: m.id }); }
  }
};
async function pump() {
  if (cur) return;
  while (queue.length) {
    queue.sort((a, b) => a.pri - b.pri || a.seq - b.seq);
    const job = (cur = queue.shift());
    self.postMessage({ type: 'start', id: job.id });
    try {
      const r = await build(job.pl, () => !job.dead, { budget: 40, abort: job.abort });
      if (job.dead) self.postMessage({ type: 'drop', id: job.id });
      else if (r.none) self.postMessage({ type: 'none', id: job.id, why: r.none });
      else {
        const bmp = r.cv.transferToImageBitmap();
        free(r.cv);
        self.postMessage({ type: 'done', id: job.id, sheet: r.sheet, bmp, tiles: memo.size, fetched }, [bmp]);
      }
    } catch (e) {
      if (e === CANCEL || job.dead) self.postMessage({ type: 'drop', id: job.id });
      else self.postMessage({ type: 'error', id: job.id, msg: String((e && e.stack) || e).slice(0, 400) });
    }
    held.clear();
    cur = null;
  }
}
self.postMessage({ type: 'hello', oc });
