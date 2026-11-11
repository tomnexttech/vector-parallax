// The stage: a wide screen (a projector, a laptop at 16:9) shows each screen as one composed frame.
// The same string is the @media of the stage block at the end of css/app.css (tests/js/stage.test.js checks it).
// A screen of a mouse only: a touch tablet held sideways (1280 by 800, a 3:2 tablet) keeps its own screens.
export const STAGE = '(min-width: 1280px) and (min-height: 680px) and (min-aspect-ratio: 3/2) and (hover: hover) and (pointer: fine)';

/** true when the window is a stage */
export function isStage(win = globalThis.window) {
  try { return !!(win && win.matchMedia && win.matchMedia(STAGE).matches); } catch { return false; }
}

/** the unit of the stage: 1 on a 1920 by 1080 screen, the same frame scaled on any other */
export function u(win = globalThis.window) {
  const w = (win && win.innerWidth) || 1920, h = (win && win.innerHeight) || 1080;
  return Math.min(w / 1920, h / 1080);
}

// ---- the show: ?show on a stage hides the bar above and the strip below and keeps each screen to what reads from the back of a hall
/** true when ?show is in the address (the search or the hash) */
export function wantsShow(loc = globalThis.location) {
  try { return !!loc && (new URLSearchParams(loc.search || '').has('show') || /[?&]show\b/.test(loc.hash || '')); } catch { return false; }
}
/** marks the page for the show (css: :root[data-show] in the stage block); a window that is not a stage draws as it always does */
export function markShow(doc = globalThis.document, loc = globalThis.location) {
  try { if (doc && doc.documentElement && wantsShow(loc)) doc.documentElement.setAttribute('data-show', ''); } catch { /* no page */ }
}
export function isShow(win = globalThis.window) {
  try { return isStage(win) && !!win.document && win.document.documentElement.hasAttribute('data-show'); } catch { return false; }
}
markShow();

/** the figure of ties seen from the chosen news: it moves to the middle and its ties are drawn out around it, up to 3 times nearer.
 *  pos: [{x,y}], si: the index of the chosen, ti: the indexes of its ties. Returns new points; the same points when nothing is chosen. */
export function focusView(pos, si, ti, w, h) {
  if (!Array.isArray(pos) || !pos[si]) return pos;
  const c = pos[si], far = Math.max(1, ...(ti || []).map((j) => (pos[j] ? Math.hypot(pos[j].x - c.x, pos[j].y - c.y) : 0)));
  const s = Math.max(1, Math.min(3, (Math.min(w, h) * 0.34) / far));
  return pos.map((p) => ({ x: w / 2 + (p.x - c.x) * s, y: h / 2 + (p.y - c.y) * s }));
}

/** the media table for the show: per side the outlets with the most cells carried, then the rows where the two sides differ most.
 *  on: rows of cells (true = carried), side: the side of each column. Returns { cols, rows } as indexes, in the table's own order. */
export function coverPick(on, side, { per = 3, rows = 4 } = {}) {
  const R = Array.isArray(on) ? on : [], S = Array.isArray(side) ? side : [];
  const count = (j) => R.reduce((a, r) => a + (r && r[j] ? 1 : 0), 0);
  const cols = [];
  for (const k of ['jp', 'intl', 'gov']) {
    cols.push(...S.map((x, j) => (x === k ? j : -1)).filter((j) => j >= 0).sort((a, b) => count(b) - count(a) || a - b).slice(0, per));
  }
  cols.sort((a, b) => a - b);
  const share = (r, k) => { const js = cols.filter((j) => S[j] === k); return js.length ? js.filter((j) => r[j]).length / js.length : 0; };
  const picked = R.map((r, i) => ({ i, d: Math.abs(share(r || [], 'jp') - share(r || [], 'intl')), n: cols.filter((j) => r && r[j]).length }))
    .filter((x) => x.n > 0).sort((a, b) => b.d - a.d || b.n - a.n || a.i - b.i).slice(0, rows).map((x) => x.i).sort((a, b) => a - b);
  return { cols, rows: picked };
}

/** marks the cells of the media table the show leaves out (class st-cut) */
export function trimCover(table, o) {
  if (!table || !table.tBodies || !table.tBodies[0] || !table.tHead || !table.tHead.rows[0]) return;
  const hc = [...table.tHead.rows[0].cells].slice(1), side = hc.map((c) => (c.dataset && c.dataset.side) || '');
  const body = [...table.tBodies[0].rows], tds = (r) => [...r.cells].filter((c) => c.tagName === 'TD');
  const pick = coverPick(body.map((r) => tds(r).map((c) => c.classList.contains('on'))), side, o);
  const keepC = new Set(pick.cols), keepR = new Set(pick.rows);
  hc.forEach((c, j) => c.classList.toggle('st-cut', !keepC.has(j)));
  body.forEach((r, i) => { r.classList.toggle('st-cut', !keepR.has(i)); tds(r).forEach((c, j) => c.classList.toggle('st-cut', !keepC.has(j))); });
}
