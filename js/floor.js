/* floor — where the map stands on the board.
 *
 *   createFloor({ map, board, onMode }) -> { mode(), setMode(m), full(on), isFull(), toggle(), paint(info), data(d), local(x, y), pillars(), span() }
 *
 * Three ways to show one map (js/map.js gives the page its map, js/mapgl.js draws it):
 *   case  the map is a small pane at the right foot of the board (the middle column keeps the event, and under it the video, the related headlines
 *         and the sources); the event in focus is the cyan mark, and a press opens the map;
 *   map   the event pane folds away and the map takes the middle column;
 *   flat  1280 px and narrower: the map lies in the page. On a screen made for fingers it is a preview (the page scrolls under the finger; a tap
 *         opens the whole map, full(true)); where the map is the screen (the 地図 screen, a phone held sideways) one finger moves it. A mouse
 *         moves it with the drag and zooms with Ctrl and the wheel. js/touchmode.js says which.
 * The map is told which of the three it is in (setMode), because a small map must not take the wheel. Nothing here draws: no pillars, no frame
 * marks, no scanning; what the map holds is in the map's own marks. quadMatrix, unquad and turnover are the plain arithmetic of the earlier
 * turned floor, kept for their tests.
 */

/** the projective map of the unit square onto the quad q = [tl, tr, br, bl] (screen points) -> [a, b, c, d, e, f, g, h, 1] */
export function quadMatrix(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if ((sx || sy) && den) { g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den; }
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}
/** a screen point -> [u, v] on the unit square (the inverse of quadMatrix); null when it cannot be carried back */
export function unquad(M, X, Y) {
  const [a, b, c, d, e, f, g, h, i] = M;
  const A = e * i - f * h, B = c * h - b * i, C = b * f - c * e;
  const D = f * g - d * i, E = a * i - c * g, F = c * d - a * f;
  const G = d * h - e * g, H = b * g - a * h, I = a * e - b * d;
  const w = G * X + H * Y + I;
  if (!w || !Number.isFinite(w)) return null;
  return [(A * X + B * Y + C) / w, (D * X + E * Y + F) / w];
}
/** how much of a set of keys was replaced (0..1 of the earlier set); 0 when there was no earlier set */
export function turnover(was, now) {
  if (!was) return 0;
  let n = 0;
  for (const k of now) if (!was.has(k)) n++;
  for (const k of was) if (!now.has(k)) n++;
  return n / Math.max(1, was.size);
}

export const SPANS = { case: 100, map: 150 };   // degrees of longitude across the floor (flat uses the map's own)

export function createFloor({ map, board, onMode }) {
  const $ = (id) => document.getElementById(id);
  const theater = $('theater'), pane = $('p-map'), pillars = $('pillars');
  const flatQ = window.matchMedia('(max-width: 1280px)');
  let want = 'case';

  const mode = () => (flatQ.matches ? 'flat' : want);
  function apply() {
    const m = mode();
    board.dataset.floor = m;
    // CASE (and flat): the map sits at the right foot of the board; MAP: it takes the middle column
    const home = board.querySelector(m === 'map' ? '.c3' : '.c4');
    if (home && pane && pane.parentElement !== home) home.append(pane);
    for (const b of document.querySelectorAll('#modebar [data-m]')) b.setAttribute('aria-pressed', String(b.dataset.m === m));
    $('mtag').textContent = m === 'map' ? 'MAP' : 'CASE';
    if (pillars) pillars.hidden = true;
    if (typeof map.setMode === 'function') map.setMode(m);
  }
  function setMode(m) {
    if (m !== 'case' && m !== 'map') return false;
    if (flatQ.matches) return false;
    if (m === want) return true;
    want = m;
    apply();
    if (onMode) onMode(m);
    return true;
  }
  flatQ.addEventListener('change', () => { apply(); if (onMode) onMode(mode()); });
  for (const b of document.querySelectorAll('#modebar [data-m]')) b.addEventListener('click', () => setMode(b.dataset.m));

  // the map opened to the whole screen (a phone or a tablet, where the small map lies in a page that a finger scrolls): <html data-mapfull>
  const root = document.documentElement;
  const isFull = () => root.dataset.mapfull === '1';
  function full(on) {
    on = !!on;
    if (on === isFull()) return on;
    if (on) root.dataset.mapfull = '1'; else delete root.dataset.mapfull;
    if (pane) {   // opened, the map is a dialog over the page: the reader of the screen is told, and the way back takes the focus
      if (on) { pane.setAttribute('role', 'dialog'); pane.setAttribute('aria-modal', 'true'); } else { pane.removeAttribute('role'); pane.removeAttribute('aria-modal'); }
      const back = pane.querySelector('.mclose');
      if (on && back) { try { back.focus({ preventScroll: true }); } catch { /* */ } }
    }
    if (typeof map.resize === 'function') { map.resize(); setTimeout(() => map.resize(), 60); }
    if (onMode) onMode(mode());
    return on;
  }

  window.addEventListener('hashchange', () => full(false));   // going to another screen closes the opened map
  apply();
  return {
    mode, setMode, full, isFull,
    toggle: () => setMode(want === 'map' ? 'case' : 'map'),
    local: () => null,
    pillars: () => false,
    // the map fills the column with a window of latitude (a column is taller than wide: the whole of the longitudes would
    // leave the poles empty); the event view keeps its own width of the world
    span: () => {
      const m = mode();
      if (m !== 'map') return SPANS[m] || null;
      const w = theater.clientWidth, h = theater.clientHeight;
      return w && h ? Math.round(Math.max(60, Math.min(SPANS.map, (w * 120) / h))) : SPANS.map;
    },
    paint() {},
    data() {},
  };
}
