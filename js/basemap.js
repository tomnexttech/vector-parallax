/* basemap — the detailed ground under the map: sheets built in js/basemap_worker.js, laid down here.
 *
 *   createBasemap({ onReady }) -> null | { paint(g, box, under) -> boolean, stats() }
 *     box    { w, h, K, lonL, latT, ppd, moving }   css px; K = device px per css px; ppd = css px per degree; equirectangular
 *     under  draws the bundled ground; called when no sheet covers the whole view (before the sheets are laid on it)
 *     onReady  called when a sheet arrives (or a failure should be retried): the map paints again if it is still
 *   null when the browser has no Worker or OffscreenCanvas: the map keeps its bundled ground.
 *
 * Carried over from the board this app grew out of (its basemap.js): sheets in equirectangular degrees, so a sheet is placed by
 * scaling alone. While the view moves the sheets in hand are scaled and laid (nothing is built); when it stops, a sheet fine
 * enough for the view is asked for, with 15 % margin round it. At most two sheets are laid in one frame (the coarsest that covers
 * the view under, the finest that overlaps above). A request that the view has left is cancelled, even mid-build.
 * Kept small for a phone and for a machine short of memory: one world sheet (2048 px wide, ~2 M px) and two regional sheets of
 * at most 4.2 M px each, 8.4 M px together; the oldest used is let go first. */

const MLAT = 85.0511287798;
const WORLD_W = 2048, WORLD_RES = WORLD_W / 360;
const MAXSIDE = 3600, MAXPX = 4.2e6;
const KEEP_N = 2, KEEP_PX = 8.4e6;
const WAIT_MS = 60;                    // the map already waits 160 ms after the hand stops; this only folds rapid zoom presses
const RETRY_MS = 30000;
const mod = (a, n) => ((a % n) + n) % n;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function covers(s, lonL, lonR, latB, latT) {
  const a = Math.max(-MLAT, latB), b = Math.min(MLAT, latT);
  if (s.latS > a + 0.01 || s.latN < b - 0.01) return false;
  if (s.lonB - s.lonA >= 359.99) return true;
  const L = s.lonA + mod(lonL - s.lonA, 360);
  return L + (lonR - lonL) <= s.lonB + 0.01;
}
function overlaps(s, lonL, lonR, latB, latT) {
  if (s.latS >= latT || s.latN <= latB) return false;
  for (let k = -2; k <= 2; k++) if (s.lonA + 360 * k < lonR && s.lonB + 360 * k > lonL) return true;
  return false;
}

export function createBasemap(opts = {}) {
  if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') return null;
  let wk;
  try { wk = new Worker(new URL('./basemap_worker.js', import.meta.url)); } catch { return null; }
  let col = null;
  const WORLD = { world: true, lonA: -180, lonB: 180, latS: -MLAT, latN: MLAT, res: WORLD_RES, px: 1, zD: 2, zV: 2, key: 'world' };

  function plan(box) {
    const K = clamp(box.K || 1, 1, 2), span = box.w / box.ppd;
    if (span >= 150) return WORLD;
    const lonR = box.lonL + span, latB = box.latT - box.h / box.ppd, m = span * 0.15;
    const lonA = box.lonL - m, lonB = lonR + m;
    const latN = Math.min(MLAT, box.latT + m), latS = Math.max(-MLAT, latB - m);
    if (latN - latS < 0.5) return null;
    const res = Math.min(box.ppd * K, MAXSIDE / (lonB - lonA), MAXSIDE / (latN - latS), Math.sqrt(MAXPX / ((lonB - lonA) * (latN - latS))));
    if (res < WORLD_RES * 1.3) return WORLD;                      // hardly finer than the world sheet
    // the detail of the tiles follows the scale on the screen, as if at two device px per css px (as the board did), not the
    // sheet's own px: a desktop at one device px still gets the roads and borders of its scale
    const z = clamp(Math.round(Math.log2((Math.max(res, box.ppd * 2) * 360) / 256)) - 1, 0, 12);
    return { world: false, lonA, lonB, latS, latN, res, px: res / box.ppd, zD: z, zV: z,
      key: [lonA, lonB, latS, latN].map((x) => x.toFixed(2)).join(',') + '@' + res.toFixed(1) };
  }

  /* ---- sheets in hand */
  const sheets = [];
  const pxOf = (s) => (s.cv ? s.cv.width * s.cv.height : 0);
  const release = (s) => { try { if (s.cv && s.cv.close) s.cv.close(); } catch { /* left to GC */ } s.cv = null; };
  function keep(s) {
    const i = sheets.findIndex((x) => x.key === s.key);
    if (i >= 0) { release(sheets[i]); sheets.splice(i, 1); }
    sheets.push(s);
    const reg = sheets.filter((x) => !x.world).sort((a, b) => a.used - b.used);
    let px = reg.reduce((a, x) => a + pxOf(x), 0);
    while (reg.length > KEEP_N || (px > KEEP_PX && reg.length > 1)) {
      const o = reg.shift();
      px -= pxOf(o);
      release(o); sheets.splice(sheets.indexOf(o), 1);
    }
  }

  /* ---- requests: one per lane (world / region); a newer one cancels the older */
  let seq = 0;
  const jobs = new Map(), lanes = new Map(), failedAt = new Map();
  const tally = { built: 0, dropped: 0, none: 0, error: 0, last: null, why: '' };
  const enough = (s, n) => s.res >= 0.75 * n.res - 1e-6 && covers(s, n.lonA, n.lonB, n.latS, n.latN);
  function want(pl, lane, need) {
    if (typeof navigator === 'object' && navigator.onLine === false) return;
    for (const j of jobs.values()) if (j.key === pl.key) return;
    const f = failedAt.get(pl.key);
    if (f && Date.now() - f < RETRY_MS) return;
    const old = sheets.find((x) => x.key === pl.key);
    if (old && (old.ok || Date.now() - old.at < RETRY_MS)) return;
    const cur = lanes.get(lane);
    if (cur) {
      if (need && enough(cur.pl, need)) return;
      drop(cur);
    }
    const job = { id: ++seq, key: pl.key, lane, pl: { ...pl, col }, pri: pl.world ? 1 : 0, timer: 0 };
    jobs.set(job.id, job); lanes.set(lane, job);
    if (pl.world) send(job); else job.timer = setTimeout(() => send(job), WAIT_MS);
  }
  function send(job) { job.timer = 0; if (jobs.has(job.id)) wk.postMessage({ type: 'build', id: job.id, pl: job.pl, pri: job.pri }); }
  function drop(job) {
    jobs.delete(job.id);
    if (lanes.get(job.lane) === job) lanes.delete(job.lane);
    if (job.timer) { clearTimeout(job.timer); job.timer = 0; return; }
    tally.dropped++;
    wk.postMessage({ type: 'cancel', id: job.id });
  }
  function settle(id) {
    const job = jobs.get(id);
    if (job) { jobs.delete(id); if (lanes.get(job.lane) === job) lanes.delete(job.lane); }
    return job;
  }
  const ping = () => { try { if (opts.onReady) opts.onReady(); } catch (e) { console.warn('[basemap]', e); } };
  const retry = () => setTimeout(ping, RETRY_MS + 500);
  let dead = false;
  wk.onmessage = (ev) => {
    const m = ev.data || {};
    if (m.type === 'hello') { if (!m.oc) { dead = true; try { wk.terminate(); } catch { /* */ } } return; }
    if (m.type === 'done') {
      settle(m.id);
      const s = m.sheet; s.cv = m.bmp; s.used = Date.now();
      keep(s);
      failedAt.delete(s.key);
      tally.built++; tally.last = s.ms || null;
      if (!s.ok) retry();
      ping();
    } else if (m.type === 'none' || m.type === 'error') {
      const j = settle(m.id);
      if (m.type === 'none') tally.none++; else { tally.error++; console.warn('[basemap]', m.msg); }
      tally.why = m.why || m.msg || '';
      if (j) failedAt.set(j.key, Date.now());
      retry();
    } else if (m.type === 'drop') settle(m.id);
  };
  wk.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); dead = true; };

  /* ---- laying the sheets */
  function put(g, s, box) {
    const x0 = (s.lonA - box.lonL) * box.ppd, y = (box.latT - s.latN) * box.ppd;
    const sw = (s.lonB - s.lonA) * box.ppd, sh = (s.latN - s.latS) * box.ppd, per = 360 * box.ppd;
    for (let k = -3; k <= 3; k++) {
      const x = x0 + k * per;
      if (x >= box.w || x + sw <= 0 || y >= box.h || y + sh <= 0) continue;
      g.drawImage(s.cv, x, y, sw, sh);
    }
  }
  /** choose the sheets for this view (and ask for a finer one when the view is still): [base, top?], base covering or null */
  function choose(box) {
    const lonR = box.lonL + box.w / box.ppd, latB = box.latT - box.h / box.ppd;
    const view = { lonA: box.lonL, lonB: lonR, latS: latB, latN: box.latT };
    const pl = plan(box);
    let best = null;
    if (pl) for (const s of sheets) if (s.ok && s.res >= 0.75 * pl.res - 1e-6 && covers(s, box.lonL, lonR, latB, box.latT) && (!best || s.res < best.res)) best = s;
    // the world sheet (the ground when zooming out): at once for a world view, otherwise after the view's own sheet is in hand
    if (!sheets.some((x) => x.world) && (pl === WORLD || (!lanes.has('reg') && (best || (pl && failedAt.has(pl.key)))))) want(WORLD, 'world');
    if (box.moving) {
      const j = lanes.get('reg');
      if (j && !covers(j.pl, view.lonA, view.lonB, view.latS, view.latN)) drop(j);   // the view has left it
    } else if (pl && !best) want(pl, pl.world ? 'world' : 'reg', { res: pl.res, ...view });
    if (best) return { list: [best], whole: true };
    // not yet: under = the finest sheet that covers the view, above = the finest that overlaps it. The world sheet only when it is
    // at least half as fine as the view wants (scaled further it is a blur; the bundled ground is sharper)
    const need = pl ? pl.res : 0;
    let base = null, top = null;
    for (const s of sheets) if (covers(s, box.lonL, lonR, latB, box.latT) && (!s.world || s.res >= 0.5 * need) && (!base || s.res > base.res)) base = s;
    for (const s of sheets) if (!s.world && s !== base && s.res > (base ? base.res : 0) && overlaps(s, box.lonL, lonR, latB, box.latT) && (!top || s.res > top.res)) top = s;
    const list = [];
    if (base) list.push(base);
    if (top) list.push(top);
    return { list, whole: !!base && !base.holes };
  }

  return {
    paint(g, box, under) {
      let pick = { list: [], whole: false };
      if (!dead && box && box.w > 0 && box.h > 0 && box.ppd > 0) {
        try { pick = choose(box); } catch (e) { console.warn('[basemap]', e); }
      }
      if (!pick.whole && under) under();
      if (!pick.list.length) return false;
      g.save();
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = box.moving ? 'low' : 'medium';
      const t = Date.now();
      for (const s of pick.list) { put(g, s, box); s.used = t; }
      g.restore();
      return true;
    },
    /** the colours of the ground, from the page (set before the first request) */
    colours(c) {
      if (col && !!col.light !== !!(c && c.light)) { for (const s of sheets) release(s); sheets.length = 0; }   // the appearance changed: draw again
      col = c;
    },
    stats: () => ({ dead, jobs: [...jobs.values()].map((j) => j.key), ...tally,
      sheets: sheets.map((s) => ({ key: s.key, ok: s.ok, holes: s.holes, res: +s.res.toFixed(2), w: s.cv && s.cv.width, h: s.cv && s.cv.height, ms: s.ms })) }),
  };
}
