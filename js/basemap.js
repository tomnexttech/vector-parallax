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
 * the view under, the finest that overlaps above; a third scaled every frame fills the GPU's memory and the frames stall). A request
 * that the view has left is cancelled, even mid-build.
 * Also from that board: a middle sheet round a close view (2 to 4 times the width, coarser, on a grid so that a small move finds it
 * again), which is what the next move is laid on instead of a blur; a repaint is asked for only when the sheet that arrived changes
 * what the view shows, and sheets that arrive together are one repaint.
 * New here: a sheet that arrives comes up over the picture it replaces (FADE_MS, the old one stays under it), and the rim of a regional
 * sheet is faded out by the worker (s.fd degrees, inside the margin), so no square edge shows while the hand moves.
 * Kept small for a phone and for a machine short of memory: one world sheet (2048 px wide, ~2 M px), regional sheets of at most
 * 4.2 M px, 11 M px together; the oldest used is let go first. The middle sheet only on a map 600 px wide or more. */

const MLAT = 85.0511287798;
const WORLD_W = 2048, WORLD_RES = WORLD_W / 360;
const MAXSIDE = 3600, MAXPX = 4.2e6;
const MID_SPAN = 60, MID_MINW = 600, MIDPX = 3e6;   // the middle sheet: views narrower than 60 degrees, on a map at least 600 px wide
const KEEP_N = 3, KEEP_PX = 11e6;
const FADE_MS = 300;
const WAIT_MS = 60;                    // the map already waits 160 ms after the hand stops; this only folds rapid zoom presses
const RETRY_MS = 30000;
const mod = (a, n) => ((a % n) + n) % n;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function covers(s, lonL, lonR, latB, latT) {
  const a = Math.max(-MLAT, latB), b = Math.min(MLAT, latT), f = s.fd || 0;   // the faded rim does not count as covering
  if (s.latS + f > a + 0.01 || s.latN - f < b - 0.01) return false;
  if (s.lonB - s.lonA >= 359.99) return true;
  const L = s.lonA + f + mod(lonL - s.lonA - f, 360);
  return L + (lonR - lonL) <= s.lonB - f + 0.01;
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

  // the middle sheet: round a close view, 2 to 4 times its width (a power of two), half to a quarter as fine. Its centre goes to a grid of
  // an eighth of its width and its fineness to steps of root 2, so a small move or a small zoom finds the same sheet
  function midPlan(box) {
    const K = clamp(box.K || 1, 1, 2), span = box.w / box.ppd;
    if (span >= MID_SPAN || box.w < MID_MINW) return null;
    const S = 2 ** Math.ceil(Math.log2(span * 2));
    const Hs = Math.min(2 * MLAT, S * Math.max(0.5, box.h / box.w));
    const G = S / 8;
    const cx = box.lonL + span / 2, cy = box.latT - box.h / box.ppd / 2;
    const lonC = Math.round(cx / G) * G;
    let latN = Math.min(MLAT, Math.round(cy / G) * G + Hs / 2);
    const latS = Math.max(-MLAT, latN - Hs);
    latN = Math.min(MLAT, latS + Hs);
    const lonA = lonC - S / 2, lonB = lonC + S / 2;
    let res = Math.min((box.w * K) / S, MAXSIDE / S, MAXSIDE / (latN - latS), Math.sqrt(MIDPX / (S * (latN - latS))));
    res = 2 ** (Math.floor(Math.log2(res) * 2) / 2);
    if (res < 1.6 * WORLD_RES) return null;                       // hardly finer than the world sheet
    const z = clamp(Math.round(Math.log2((res * 360) / 256)) - 1, 0, 12);
    return { world: false, tier: 'mid', lonA, lonB, latS, latN, res, px: res / box.ppd, zD: z, zV: z,
      key: 'mid:' + [lonA, lonB, latS, latN].map((x) => x.toFixed(2)).join(',') + '@' + res.toFixed(1) };
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
    const job = { id: ++seq, key: pl.key, lane, pl: { ...pl, col }, pri: pl.world ? 1 : pl.tier === 'mid' ? 2 : 0, timer: 0 };
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
  // a repaint only when the sheet that arrived changes what the view shows (a moving view takes it in its next frame); several at once are one
  let seen = null, pingT = 0;
  const matters = (s) => s.world || !seen || (!seen.had && !seen.moving && overlaps(s, seen.lonA, seen.lonB, seen.latS, seen.latN));
  const soon = () => { if (!pingT) pingT = setTimeout(() => { pingT = 0; ping(); }, 0); };
  const retry = () => setTimeout(ping, RETRY_MS + 500);
  let dead = false;
  const oldTone = new Set();
  wk.onmessage = (ev) => {
    const m = ev.data || {};
    if (m.type === 'hello') { if (!m.oc) { dead = true; try { wk.terminate(); } catch { /* */ } } return; }
    if (m.type === 'done') {
      settle(m.id);
      if (oldTone.delete(m.id)) { try { m.bmp && m.bmp.close && m.bmp.close(); } catch { /* */ } return; }
      const s = m.sheet; s.cv = m.bmp; s.used = Date.now();
      s.born = typeof performance === 'object' ? performance.now() : 0;
      keep(s);
      failedAt.delete(s.key);
      tally.built++; tally.last = s.ms || null;
      if (!s.ok) retry();
      if (matters(s)) soon();
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
    seen = { ...view, had: !!best, moving: !!box.moving };
    if (box.moving) {
      for (const lane of ['reg', 'mid']) {
        const j = lanes.get(lane);
        if (j && !covers(j.pl, view.lonA, view.lonB, view.latS, view.latN)) drop(j);   // the view has left it
      }
    } else if (pl) {
      if (!best) want(pl, pl.world ? 'world' : 'reg', { res: pl.res, ...view });
      // after the view's own sheet, the one round it (what the next move is laid on), unless a sheet already reaches a quarter beyond the view
      const mp = midPlan(box);
      if (mp) {
        const q = (lonR - box.lonL) * 0.25;
        const around = { lonA: box.lonL - q, lonB: lonR + q, latS: Math.max(-MLAT, latB - q), latN: Math.min(MLAT, box.latT + q), res: mp.res };
        if (!sheets.some((s) => !s.world && enough(s, around))) want(mp, 'mid', around);
      }
    }
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

  let fadingNow = false;
  return {
    paint(g, box, under) {
      let pick = { list: [], whole: false };
      if (!dead && box && box.w > 0 && box.h > 0 && box.ppd > 0) {
        try { pick = choose(box); } catch (e) { console.warn('[basemap]', e); }
      }
      // how far a sheet has come up (1 = there); a sheet that came up long ago, or a calm page, is simply there
      const nowP = typeof performance === 'object' ? performance.now() : 0, calm = !!(opts.calm && opts.calm());
      const up = (s) => {
        if (!s.born) return 1;
        const k = calm ? 1 : (nowP - s.born) / FADE_MS;
        if (k >= 1) { s.born = 0; return 1; }
        return k * k * (3 - 2 * k);
      };
      const first = pick.list[0], a0 = first ? up(first) : 1;
      fadingNow = pick.list.some((s) => up(s) < 1);
      // while a sheet comes up, the picture it replaces stays under it: the finest other sheet that reaches the view (never more than two
      // sheets for long: this lasts FADE_MS)
      let prior = null;
      if (a0 < 1 && pick.list.length === 1) {
        const lonR = box.lonL + box.w / box.ppd, latB = box.latT - box.h / box.ppd;
        for (const s of sheets) if (s !== first && s.cv && overlaps(s, box.lonL, lonR, latB, box.latT) && (!prior || s.res > prior.res)) prior = s;
      }
      const lonR2 = box.lonL + box.w / box.ppd, latB2 = box.latT - box.h / box.ppd;
      if ((!pick.whole || (a0 < 1 && !(prior && covers(prior, box.lonL, lonR2, latB2, box.latT)))) && under) under();
      if (!pick.list.length) return false;
      g.save();
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = box.moving ? 'low' : 'medium';
      const t = Date.now();
      if (prior) { put(g, prior, box); prior.used = t; }
      for (const s of pick.list) { g.globalAlpha = up(s); put(g, s, box); s.used = t; }
      g.restore();
      return true;
    },
    /** a sheet is still coming up: the map paints again next frame */
    fading: () => fadingNow,
    /** the colours of the ground, from the page (set before the first request) */
    colours(c) {
      if (col && !!col.light !== !!(c && c.light)) {   // the appearance changed: draw again, and what is still being built comes back in the old colours
        for (const s of sheets) release(s); sheets.length = 0;
        for (const j of [...jobs.values()]) { oldTone.add(j.id); drop(j); }
      }
      col = c;
    },
    stats: () => ({ dead, jobs: [...jobs.values()].map((j) => j.key), ...tally,
      sheets: sheets.map((s) => ({ key: s.key, ok: s.ok, holes: s.holes, res: +s.res.toFixed(2), w: s.cv && s.cv.width, h: s.cv && s.cv.height, ms: s.ms })) }),
  };
}
