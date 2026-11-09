/* touchmode — who may take a finger on the map.
 *
 *   isCoarse(win)            true on a screen made for fingers (a phone, a tablet)
 *   touchLive({ doc, win })  true where one finger moves the map: the 地図 screen, the map pane of a phone held sideways, and the map opened to the
 *                            whole screen. false where the map lies in a page that a finger scrolls (the board of a phone or a tablet): there it is a
 *                            preview, the finger scrolls the page, and a tap opens the whole map. No DOM is made or changed here.
 *   fingerGesture(a, b)      what a second touch means after a first: 'double' (a quick tap at the same place) or 'drag' (a quick tap and then the
 *                            finger stays down); used by the canvas map, which MapLibre's own handlers do not serve.
 */
import { SIDEWAYS } from './landscape.js';

export function isCoarse(win = window) {
  try { return !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches); } catch { return false; }
}

export function touchLive({ doc = document, win = window } = {}) {
  const root = doc.documentElement, d = root.dataset || {};
  if (d.mapfull === '1') return true;
  if (d.sect === 'map') return true;
  const app = doc.getElementById('app');
  try { if (win.matchMedia && win.matchMedia(SIDEWAYS).matches && app && app.dataset.lp === 'p-map') return true; } catch { /* the query is not known */ }
  const board = doc.getElementById('board');
  return !!board && board.dataset.floor === 'map';
}

/** a = the first touch's { t, x, y } (when and where it lifted), b = the next touch down: 'double' | 'drag' | null; the two must be close in time and place */
export function nearTap(a, b, { ms = 320, px = 36 } = {}) {
  return !!a && !!b && b.t - a.t <= ms && Math.hypot(b.x - a.x, b.y - a.y) <= px;
}
