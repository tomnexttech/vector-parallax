/* map_worker — the ground of the map, off the main thread.
 *
 *   { base, cols, rows, tile, hi? } -> { world: ImageBitmap, coast: { fine, coarse } | null }
 *        world   the land tone (the relief) at the bundled size, as if every texel were land; the main thread clips it to the coast.
 *                Without a coast (tracing failed) it is the old picture, land and water both.
 *        coast   the coastline as vectors, traced once from the bundled tiles, at two levels of detail:
 *                { xy: Float32Array [lon, lat, lon, lat, ...], start: Uint32Array (n + 1 offsets, in points), kind: Uint8Array (n) }
 *                kind 1 = a closed ring; 2 = a ring that goes once round the world eastward (land on the south-pole side: Antarctica);
 *                3 = the same on the north-pole side; 0 = open. All rings filled together with the even-odd rule (lakes are holes).
 *   { view: { lon0, lat0, s, w, h, dpr, key } } -> { bitmap, water, key }
 *        bitmap  the land tone at screen resolution (clipped to the coast by the main thread)
 *        water   null, or the depth of the sea as a black veil (alpha follows depth), where a bathymetry image covers the view
 *   -> { hi: n }  once the optional higher-resolution images are read (n images); the main thread asks for the view again
 *
 * Source: Natural Earth II (public domain), the bundled tiles. Land = blue not clearly above red. The coast is the 0.5 line of the
 * land field softened by a 3 x 3 mean, traced by marching squares, joined into rings, smoothed by Chaikin and thinned by
 * Douglas-Peucker. The relief is luminance over its local mean, both taken over land only, wide and weak (no JPEG speckle).
 * Grey only.
 *
 * Higher-resolution ground (optional, nothing is bundled or fetched from elsewhere): when the main thread passes `hi`, the URL of
 * a manifest (createMap(canvas, { hi }) or <meta name="parallax-map-hi" content="...">), it is read once:
 *   { "relief": [{ "url": "relief/japan.png", "bbox": [lonW, latS, lonE, latN], "w": 4096, "h": 2048 }],
 *     "bathy":  [{ "url": "bathy/japan.png",  "bbox": [lonW, latS, lonE, latN], "w": 4096, "h": 2048, "deep": "dark" }] }
 *   url      relative to the manifest, same origin only (anything else is skipped)
 *   bbox     degrees, the image is equirectangular over it (lonW < lonE; lonE may pass 180)
 *   w, h     informative; the real size of the image is used
 *   relief   shaded relief, grey; taken relative to the image's own mean, so any brightness works. Replaces the bundled relief inside bbox.
 *   bathy    depth, grey; darker = deeper ("deep": "light" turns that round). Darkens the sea inside bbox.
 *   The edge of each image is feathered. A missing or broken manifest leaves the bundled ground as it is. */

let F = null;                       // { W, H, relief: Uint8Array, ls: Float32Array | null (only without a coast) }
let HI = { relief: [], bathy: [] };
const LAND = 42;                    // the land tone; the main thread fills the same grey before the relief arrives

self.onmessage = async (ev) => {
  const d = ev.data || {};
  try {
    if (d.view) {
      if (!F) { self.postMessage({ key: d.view.key, error: 'not ready' }); return; }
      const out = renderView(d.view);
      self.postMessage({ bitmap: out.land, water: out.water, key: d.view.key }, out.water ? [out.land, out.water] : [out.land]);
      return;
    }
    const { base, cols, rows, tile } = d;
    const W = cols * tile, H = rows * tile, n = W * H;
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d', { willReadFrequently: true });
    const jobs = [];
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const url = new URL(`${base}/${col}/${rows - 1 - row}.jpg`, self.location.href).href;
        jobs.push(fetch(url).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? createImageBitmap(b) : null))
          .then((bm) => { if (bm) { g.drawImage(bm, col * tile, row * tile, tile, tile); bm.close(); } }).catch(() => {}));
      }
    }
    await Promise.all(jobs);
    const px = g.getImageData(0, 0, W, H).data;
    const land = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2]; land[i] = b - r > 18 && b >= gg - 4 ? 0 : 1; }
    const relief = reliefField(px, land, W, H);
    const lf = new Float32Array(n);
    for (let i = 0; i < n; i++) lf[i] = land[i];
    const ls = boxBlur(lf, W, H, 1);
    let coast = null;
    try {
      const rings = contour(ls, W, H);
      coast = { fine: pack(rings, 0.016, 2, 0), coarse: pack(rings, 0.09, 1, 0.45) };
    } catch { coast = null; }
    F = { W, H, relief, ls: coast ? null : ls };
    const world = new OffscreenCanvas(W, H);
    const wg = world.getContext('2d');
    const img = wg.createImageData(W, H);
    for (let i = 0; i < n; i++) {
      const v = coast ? landTone(relief[i]) : mixed(ls[i], relief[i]);
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v + 1; img.data[i * 4 + 3] = 255;
    }
    wg.putImageData(img, 0, 0);
    const bm = world.transferToImageBitmap();
    const tr = [bm];
    if (coast) for (const lod of [coast.fine, coast.coarse]) tr.push(lod.xy.buffer, lod.start.buffer, lod.kind.buffer);
    self.postMessage({ world: bm, coast }, tr);
    if (typeof d.hi === 'string' && d.hi) loadHi(d.hi);
  } catch (e) {
    self.postMessage({ error: String((e && e.message) || e), key: d.view && d.view.key });
  }
};

// ---------------------------------------------------------------- fields

function boxBlur(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H), k = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let s = 0; const row = y * W;
    for (let x = -r; x <= r; x++) s += src[row + ((x + W) % W)];
    for (let x = 0; x < W; x++) { tmp[row + x] = s / k; s += src[row + ((x + r + 1) % W)] - src[row + ((x - r + W) % W)]; }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[clamp(y, 0, H - 1) * W + x];
    for (let y = 0; y < H; y++) { out[y * W + x] = s / k; s += tmp[clamp(y + r + 1, 0, H - 1) * W + x] - tmp[clamp(y - r, 0, H - 1) * W + x]; }
  }
  return out;
}

/** relief 0..255 (128 = flat): the softened luminance over its wide mean, both averaged over land texels only (so the coast
 * does not light up), with a little of the slow part (snow and desert slightly lighter). Water near land gets the land's value,
 * so the clip by the vector coast never shows an edge of the raster. */
function reliefField(px, land, W, H) {
  const n = W * H, L = new Float32Array(n), M = new Float32Array(n);
  for (let i = 0; i < n; i++) if (land[i]) { L[i] = 0.3 * px[i * 4] + 0.59 * px[i * 4 + 1] + 0.11 * px[i * 4 + 2]; M[i] = 1; }
  const blur2 = (a, r) => boxBlur(boxBlur(a, W, H, r), W, H, r);
  const sL = blur2(L, 2), sM = blur2(M, 2);
  const mL = blur2(L, 9), mM = blur2(M, 9);
  const out = new Uint8Array(n).fill(128);
  for (let i = 0; i < n; i++) {
    if (sM[i] < 0.03 || mM[i] < 0.03) continue;
    const soft = sL[i] / sM[i], mean = mL[i] / mM[i];
    out[i] = clamp(Math.round(128 + (soft / (mean + 8) - 1) * 280 + (mean - 110) * 0.08), 0, 255);
  }
  return out;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const landTone = (rl) => clamp(Math.round(LAND + (rl - 128) * 0.3), 0, 254);
/** only when there is no vector coast: water and land in one picture */
const mixed = (m, rl) => Math.round(18 + (landTone(rl) - 18) * smooth(0.42, 0.58, m));

// ---------------------------------------------------------------- the coast as vectors

/** marching squares on the 0.5 line of f (W x H, wrapping east-west), joined into rings: [{ p: [lon, lat, ...], kind }] */
function contour(f, W, H) {
  const T = 0.5, WH = W * H, tpd = W / 360;
  const id = new Map();
  const lon = [], lat = [], A = [], B = [];
  const node = (e) => {
    let k = id.get(e);
    if (k !== undefined) return k;
    k = lon.length;
    if (e < WH) {                                   // horizontal edge (x, y) - (x + 1, y)
      const y = (e / W) | 0, x = e - y * W, x1 = x + 1 === W ? 0 : x + 1;
      const a = f[e], b = f[y * W + x1], t = (T - a) / (b - a);
      lon.push((x + 0.5 + t) / tpd - 180); lat.push(90 - (y + 0.5) / tpd);
    } else {                                        // vertical edge (x, y) - (x, y + 1)
      const e2 = e - WH, y = (e2 / W) | 0, x = e2 - y * W;
      const a = f[e2], b = f[e2 + W], t = (T - a) / (b - a);
      lon.push((x + 0.5) / tpd - 180); lat.push(90 - (y + 0.5 + t) / tpd);
    }
    A.push(-1); B.push(-1); id.set(e, k);
    return k;
  };
  const link = (e1, e2) => {
    const a = node(e1), b = node(e2);
    if (A[a] < 0) A[a] = b; else B[a] = b;
    if (A[b] < 0) A[b] = a; else B[b] = a;
  };
  for (let y = 0; y < H - 1; y++) {
    const r0 = y * W, r1 = r0 + W;
    for (let x = 0; x < W; x++) {
      const x1 = x + 1 === W ? 0 : x + 1;
      const tl = f[r0 + x] >= T, tr = f[r0 + x1] >= T, br = f[r1 + x1] >= T, bl = f[r1 + x] >= T;
      const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const top = r0 + x, bottom = r1 + x, left = WH + r0 + x, right = WH + r0 + x1;
      switch (c) {
        case 1: case 14: link(left, bottom); break;
        case 2: case 13: link(bottom, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(top, right); break;
        case 6: case 9: link(top, bottom); break;
        case 7: case 8: link(left, top); break;
        case 5: case 10: {                              // a saddle: the mean of the four corners decides which pair joins
          const mid = (f[r0 + x] + f[r0 + x1] + f[r1 + x1] + f[r1 + x]) / 4 >= T;
          if ((c === 5) === mid) { link(left, top); link(bottom, right); } else { link(top, right); link(left, bottom); }
          break;
        }
        default: break;
      }
    }
  }
  const n = lon.length, seen = new Uint8Array(n), rings = [];
  const walk = (s) => {
    const p = []; let prev = -1, cur = s, last = lon[s];
    while (cur >= 0 && !seen[cur]) {
      seen[cur] = 1;
      let lo = lon[cur]; lo += 360 * Math.round((last - lo) / 360); last = lo;
      p.push(lo, lat[cur]);
      const nx = A[cur] !== prev ? A[cur] : B[cur];
      prev = cur; cur = nx;
    }
    if (p.length < 6) return;
    let kind = 0;
    if (cur === s) {
      let lo = lon[s]; lo += 360 * Math.round((last - lo) / 360);
      const total = lo - p[0];
      if (Math.abs(total) > 180) {
        if (total < 0) reversePairs(p);
        let sl = 0; for (let i = 1; i < p.length; i += 2) sl += p[i];
        kind = sl / (p.length / 2) < 0 ? 2 : 3;
        const sh = -360 * Math.floor((p[0] + 180) / 360);
        for (let i = 0; i < p.length; i += 2) p[i] += sh;
        rings.push({ p, kind });
        return;
      }
      kind = 1;
    }
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < p.length; i += 2) { if (p[i] < mn) mn = p[i]; if (p[i] > mx) mx = p[i]; }
    const sh = -360 * Math.round((mn + mx) / 2 / 360);
    if (sh) for (let i = 0; i < p.length; i += 2) p[i] += sh;
    rings.push({ p, kind });
  };
  for (let i = 0; i < n; i++) if (!seen[i] && B[i] < 0) walk(i);   // open lines first, from an end
  for (let i = 0; i < n; i++) if (!seen[i]) walk(i);
  return rings;
}

function reversePairs(p) {
  for (let i = 0, j = p.length - 2; i < j; i += 2, j -= 2) {
    const a = p[i], b = p[i + 1]; p[i] = p[j]; p[i + 1] = p[j + 1]; p[j] = a; p[j + 1] = b;
  }
}

function chaikin(p, closed) {
  const n = p.length / 2;
  if (n < 3) return p;
  const out = [];
  if (!closed) out.push(p[0], p[1]);
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const ax = p[2 * i], ay = p[2 * i + 1], bx = p[2 * j], by = p[2 * j + 1];
    out.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by, 0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
  }
  if (!closed) out.push(p[2 * (n - 1)], p[2 * (n - 1) + 1]);
  return out;
}

/** Douglas-Peucker, iterative; a closed ring is cut at its first point and the point farthest from it */
function simplify(p, tol, closed) {
  const n = p.length / 2;
  if (n <= 4) return p;
  const keep = new Uint8Array(n), t2 = tol * tol, stack = [];
  keep[0] = 1; keep[n - 1] = 1;
  if (closed) {
    let far = 1, fd = -1;
    for (let i = 1; i < n; i++) { const dx = p[2 * i] - p[0], dy = p[2 * i + 1] - p[1], dd = dx * dx + dy * dy; if (dd > fd) { fd = dd; far = i; } }
    keep[far] = 1; stack.push(0, far, far, n - 1);
  } else stack.push(0, n - 1);
  while (stack.length) {
    const b = stack.pop(), a = stack.pop();
    if (b - a < 2) continue;
    const ax = p[2 * a], ay = p[2 * a + 1], dx = p[2 * b] - ax, dy = p[2 * b + 1] - ay, ll = dx * dx + dy * dy;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = p[2 * i] - ax, py = p[2 * i + 1] - ay;
      let dd;
      if (ll === 0) dd = px * px + py * py;
      else { const t = clamp((px * dx + py * dy) / ll, 0, 1), qx = px - t * dx, qy = py - t * dy; dd = qx * qx + qy * qy; }
      if (dd > md) { md = dd; mi = i; }
    }
    if (md > t2) { keep[mi] = 1; stack.push(a, mi, mi, b); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1]);
  return out;
}

/** one level of detail: rings smaller than minSize degrees are left out (the world-scale view) */
function pack(rings, tol, iters, minSize) {
  const parts = [];
  let total = 0;
  for (const r of rings) {
    const wraps = r.kind === 2 || r.kind === 3;
    if (!wraps && minSize > 0) {
      let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
      for (let i = 0; i < r.p.length; i += 2) { const x = r.p[i], y = r.p[i + 1]; if (x < a) a = x; if (x > b) b = x; if (y < c) c = y; if (y > d) d = y; }
      if (Math.max(b - a, d - c) < minSize) continue;
    }
    let p = r.p;
    for (let i = 0; i < iters; i++) p = chaikin(p, r.kind === 1);
    p = simplify(p, tol, r.kind === 1);
    if (p.length < (r.kind === 1 ? 6 : 4)) continue;
    parts.push([p, r.kind]); total += p.length;
  }
  const xy = new Float32Array(total), start = new Uint32Array(parts.length + 1), kind = new Uint8Array(parts.length);
  let o = 0;
  parts.forEach(([p, k], i) => { start[i] = o / 2; xy.set(p, o); o += p.length; kind[i] = k; });
  start[parts.length] = o / 2;
  return { xy, start, kind };
}

// ---------------------------------------------------------------- the higher-resolution ground (optional)

async function loadHi(url) {
  try {
    const origin = new URL(url).origin;
    const r = await fetch(url);
    if (!r.ok) return;
    const m = await r.json();
    const out = { relief: [], bathy: [] };
    for (const kind of ['relief', 'bathy']) {
      for (const e of Array.isArray(m && m[kind]) ? m[kind] : []) {
        if (!e || typeof e.url !== 'string' || !Array.isArray(e.bbox) || e.bbox.length !== 4 || !e.bbox.every(Number.isFinite)) continue;
        const [lonW, latS, lonE, latN] = e.bbox;
        if (!(lonE > lonW && latN > latS)) continue;
        const src = new URL(e.url, url);
        if (src.origin !== origin) continue;
        try {
          const res = await fetch(src.href);
          if (!res.ok) continue;
          const bm = await createImageBitmap(await res.blob());
          const w = bm.width, h = bm.height;
          const c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(bm, 0, 0); bm.close();
          const p = g.getImageData(0, 0, w, h).data, lum = new Uint8Array(w * h);
          let sum = 0;
          for (let i = 0; i < w * h; i++) { const v = (0.3 * p[i * 4] + 0.59 * p[i * 4 + 1] + 0.11 * p[i * 4 + 2]) | 0; lum[i] = v; sum += v; }
          out[kind].push({ lonW, latS, lonE, latN, w, h, lum, mean: Math.max(1, sum / (w * h)), dark: e.deep !== 'light' });
        } catch { /* this image is left out */ }
      }
    }
    if (!out.relief.length && !out.bathy.length) return;
    HI = out;
    self.postMessage({ hi: out.relief.length + out.bathy.length });
  } catch { /* the bundled ground stays */ }
}

const sampleHi = (e, u, v) => {
  if (u < -0.5 || v < -0.5 || u > e.w - 0.5 || v > e.h - 0.5) return -1;
  u = clamp(u, 0, e.w - 1.001); v = clamp(v, 0, e.h - 1.001);
  const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, i = y0 * e.w + x0, L = e.lum;
  return (L[i] * (1 - fx) + L[i + 1] * fx) * (1 - fy) + (L[i + e.w] * (1 - fx) + L[i + e.w + 1] * fx) * fy;
};
const featherHi = (e, u, v) => clamp(Math.min(u + 0.5, e.w - 0.5 - u, v + 0.5, e.h - 0.5 - v) / Math.max(2, 0.04 * Math.min(e.w, e.h)), 0, 1);

/** calls fn(pixel index, value, weight) for every output pixel inside the image's bbox (each copy of the world) */
function eachHi(e, lon0, lat0, sd, ow, oh, fn) {
  for (let k = -1; k <= 2; k++) {
    const a = e.lonW + 360 * k, b = e.lonE + 360 * k;
    const x0 = Math.max(0, Math.floor((a - lon0) * sd)), x1 = Math.min(ow, Math.ceil((b - lon0) * sd));
    const y0 = Math.max(0, Math.floor((lat0 - e.latN) * sd)), y1 = Math.min(oh, Math.ceil((lat0 - e.latS) * sd));
    if (x0 >= x1 || y0 >= y1) continue;
    for (let y = y0; y < y1; y++) {
      const v = ((e.latN - (lat0 - (y + 0.5) / sd)) / (e.latN - e.latS)) * e.h - 0.5;
      for (let x = x0; x < x1; x++) {
        const u = ((lon0 + (x + 0.5) / sd - 360 * k - e.lonW) / (e.lonE - e.lonW)) * e.w - 0.5;
        const val = sampleHi(e, u, v);
        if (val < 0) continue;
        fn(y * ow + x, val, featherHi(e, u, v));
      }
    }
  }
}

// ---------------------------------------------------------------- the view at screen resolution

function renderView({ lon0, lat0, s, w, h, dpr }) {
  const { W, H, relief, ls } = F;
  const ow = Math.max(1, Math.round(w * dpr)), oh = Math.max(1, Math.round(h * dpr));
  const c = new OffscreenCanvas(ow, oh);
  const g = c.getContext('2d');
  const img = g.createImageData(ow, oh), out = img.data;
  const tpd = W / 360, sd = s * dpr;
  // the bundled relief is coarse (a texel is 0.18 degrees): close in, it would read as blots, so it fades with the zoom
  const amp = 1 / (1 + Math.max(0, s / tpd - 6) / 12);
  for (let y = 0; y < oh; y++) {
    const lat = lat0 - (y + 0.5) / sd;
    let v = (90 - lat) * tpd - 0.5;
    if (v < 0) v = 0; if (v > H - 1.001) v = H - 1.001;
    const y0 = v | 0, fy = v - y0, r0 = y0 * W, r1 = (y0 + 1) * W;
    for (let x = 0; x < ow; x++) {
      let u = (lon0 + (x + 0.5) / sd + 180) * tpd - 0.5;
      u -= W * Math.floor(u / W);
      const x0 = u | 0, fx = u - x0, x1 = (x0 + 1) % W;
      const a = r0 + x0, b = r0 + x1, cc = r1 + x0, d = r1 + x1;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const rl = 128 + (relief[a] * w00 + relief[b] * w10 + relief[cc] * w01 + relief[d] * w11 - 128) * amp;
      const t = ls ? mixed(ls[a] * w00 + ls[b] * w10 + ls[cc] * w01 + ls[d] * w11, rl) : landTone(rl);
      const o = (y * ow + x) * 4;
      out[o] = t; out[o + 1] = t; out[o + 2] = t + 1; out[o + 3] = 255;
    }
  }
  for (const e of HI.relief) {
    eachHi(e, lon0, lat0, sd, ow, oh, (i, val, wt) => {
      const o = i * 4, cur = out[o];
      const hv = LAND + clamp(val / e.mean - 1, -0.6, 0.6) * 42;
      const nv = Math.round(cur + (hv - cur) * wt);
      out[o] = nv; out[o + 1] = nv; out[o + 2] = nv + 1;
    });
  }
  g.putImageData(img, 0, 0);
  const land = c.transferToImageBitmap();
  let water = null;
  if (HI.bathy.length) {
    const wc = new OffscreenCanvas(ow, oh), wg = wc.getContext('2d');
    const wimg = wg.createImageData(ow, oh), wd = wimg.data;
    let any = false;
    for (const e of HI.bathy) {
      eachHi(e, lon0, lat0, sd, ow, oh, (i, val, wt) => {
        const depth = e.dark ? 1 - val / 255 : val / 255;
        const a = Math.round(clamp(depth, 0, 1) * 0.55 * wt * 255);
        if (a > wd[i * 4 + 3]) { wd[i * 4 + 3] = a; any = true; }
      });
    }
    if (any) { wg.putImageData(wimg, 0, 0); water = wc.transferToImageBitmap(); }
  }
  return { land, water };
}

self.landToneForTest = landTone;
