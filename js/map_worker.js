/* map_worker — the ground of the map, off the main thread.
 *
 *   { base, cols, rows, tile }                   -> { world: ImageBitmap }   the whole world at the bundled size (drawn while the hand moves)
 *   { view: { lon0, lat0, s, w, h, dpr, key } }  -> { bitmap, key }          the visible region at screen resolution (drawn once it settles)
 *
 * Source: Natural Earth II (public domain), the bundled tiles. Three fields are kept per texel:
 *   land   0..255  land or water (water = blue clearly above red), sampled bilinearly so the coast is drawn at screen resolution
 *   relief 0..255  the shading of the relief: luminance over its local mean (the land-cover colour is the slow part and is mostly removed)
 *   dist   0..40   texels from the coast, on the water side only (a quiet water lining, as on printed maps; it is not depth)
 * Grey only: land is lighter than water, the coast is one fine light line. */

let F = null;   // { W, H, land, relief, dist }

self.onmessage = async (ev) => {
  const d = ev.data || {};
  try {
    if (d.view) {
      if (!F) { self.postMessage({ key: d.view.key, error: 'not ready' }); return; }
      const bitmap = renderView(d.view);
      self.postMessage({ bitmap, key: d.view.key }, [bitmap]);
      return;
    }
    const { base, cols, rows, tile } = d;
    const W = cols * tile, H = rows * tile;
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
    F = fields(g.getImageData(0, 0, W, H).data, W, H);
    const world = new OffscreenCanvas(W, H);
    const wg = world.getContext('2d');
    const img = wg.createImageData(W, H);
    for (let i = 0, n = W * H; i < n; i++) {
      const [r, gg, b] = shade(F.land[i] / 255, F.relief[i], F.dist[i], 0.5);
      img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
    wg.putImageData(img, 0, 0);
    const bm = world.transferToImageBitmap();
    self.postMessage({ world: bm }, [bm]);
  } catch (e) {
    self.postMessage({ error: String((e && e.message) || e), key: d.view && d.view.key });
  }
};

function fields(p, W, H) {
  const n = W * H;
  const land = new Uint8Array(n), lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = p[i * 4], g = p[i * 4 + 1], b = p[i * 4 + 2];
    land[i] = b - r > 18 && b >= g - 4 ? 0 : 255;
    lum[i] = 0.3 * r + 0.59 * g + 0.11 * b;
  }
  // the local mean of luminance (box blur, radius 4, twice) — the relief is what departs from it. The texel itself is first
  // softened (radius 1) so that the noise of the JPEG does not read as relief.
  const soft = boxBlur(lum, W, H, 1);
  const blur = boxBlur(boxBlur(lum, W, H, 4), W, H, 4);
  const relief = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!land[i]) { relief[i] = 128; continue; }
    const k = soft[i] / (blur[i] + 6) - 1;                // about -0.3 .. 0.3
    const base = (blur[i] - 120) * 0.05;                  // a little of the slow part: snow and desert stay slightly lighter
    relief[i] = clamp(128 + k * 330 + base, 0, 255);
  }
  // the coast: the land field is smoothed (radius 1, twice ~ a Gaussian of one texel) so that its 0.5 line is a curve, not stairs
  const lf = new Float32Array(n);
  for (let i = 0; i < n; i++) lf[i] = land[i];
  const ls = boxBlur(boxBlur(lf, W, H, 1), W, H, 1);
  // distance from the coast on the water side (chamfer 3-4, capped)
  const INF = 255, dist = new Uint8Array(n).fill(INF);
  for (let i = 0; i < n; i++) if (land[i]) dist[i] = 0;
  const at = (x, y) => y * W + ((x + W) % W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!dist[i]) continue;
    let m = dist[i];
    m = Math.min(m, dist[at(x - 1, y)] + 3);
    if (y > 0) m = Math.min(m, dist[at(x - 1, y - 1)] + 4, dist[at(x, y - 1)] + 3, dist[at(x + 1, y - 1)] + 4);
    dist[i] = Math.min(INF, m);
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; if (!dist[i]) continue;
    let m = dist[i];
    m = Math.min(m, dist[at(x + 1, y)] + 3);
    if (y < H - 1) m = Math.min(m, dist[at(x + 1, y + 1)] + 4, dist[at(x, y + 1)] + 3, dist[at(x - 1, y + 1)] + 4);
    dist[i] = Math.min(INF, m);
  }
  for (let i = 0; i < n; i++) dist[i] = Math.min(40, Math.round(dist[i] / 3));
  for (let i = 0; i < n; i++) land[i] = clamp(Math.round(ls[i]), 0, 255);
  return { W, H, land, relief, dist };
}

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

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/** one pixel: m = land 0..1 (interpolated), rl = relief 0..255, dw = texels from the coast, e = half the width of the coast in m units */
function shade(m, rl, dw, e) {
  const water = 15 + 9 * Math.exp(-dw / 2.2) + 4 * Math.exp(-dw / 9);
  const land = 46 + (rl - 128) * 0.26;
  const a = smooth(0.5 - e, 0.5 + e, m);
  let v = water + (land - water) * a;
  const coast = 1 - smooth(0, e * 1.15, Math.abs(m - 0.5));
  v += (108 - v) * coast * 0.62;
  const wt = 1 - a;
  return [clamp(v, 0, 255) | 0, clamp(v + wt * 1.5, 0, 255) | 0, clamp(v + wt * 4 + 1, 0, 255) | 0];
}

function renderView({ lon0, lat0, s, w, h, dpr }) {
  const { W, H, land, relief, dist } = F;
  const ow = Math.max(1, Math.round(w * dpr)), oh = Math.max(1, Math.round(h * dpr));
  const c = new OffscreenCanvas(ow, oh);
  const g = c.getContext('2d');
  const img = g.createImageData(ow, oh), out = img.data;
  const tpd = W / 360;                         // texels per degree
  const ppt = (s * dpr) / tpd;                 // output pixels per texel
  const e = clamp(0.42 / ppt, 0.03, 0.5);
  const sd = s * dpr;
  for (let y = 0; y < oh; y++) {
    const lat = lat0 - (y + 0.5) / sd;
    let v = (90 - lat) * tpd - 0.5;
    if (v < 0) v = 0; if (v > H - 1.001) v = H - 1.001;
    const y0 = v | 0, fy = v - y0, r0 = y0 * W, r1 = (y0 + 1) * W;
    for (let x = 0; x < ow; x++) {
      const lon = lon0 + (x + 0.5) / sd;
      let u = (lon + 180) * tpd - 0.5;
      u -= W * Math.floor(u / W);
      const x0 = u | 0, fx = u - x0, x1 = (x0 + 1) % W;
      const a = r0 + x0, b = r0 + x1, cc = r1 + x0, d = r1 + x1;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const m = (land[a] * w00 + land[b] * w10 + land[cc] * w01 + land[d] * w11) / 255;
      const rl = relief[a] * w00 + relief[b] * w10 + relief[cc] * w01 + relief[d] * w11;
      const dw = dist[a] * w00 + dist[b] * w10 + dist[cc] * w01 + dist[d] * w11;
      const [R, G, B] = shade(m, rl, dw, e);
      const o = (y * ow + x) * 4;
      out[o] = R; out[o + 1] = G; out[o + 2] = B; out[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c.transferToImageBitmap();
}

self.shadeForTest = shade;
