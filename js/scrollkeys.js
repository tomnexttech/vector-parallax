/* scrollkeys — the keys move the same box the wheel moves (2026-11-16, "インタラクションは統一").
 * The screens scroll inside one box (#board on the home and 詳しく見る, #entry on 比べる), not the page, so with the focus on the page
 * PageDown, Space, Home and End moved nothing. Here, when no field, button or list has the key, they move the screen's own scroll:
 * the scroll box of an open sheet first (nothing behind a sheet moves), else the largest box on screen that can scroll up and down.
 * The arrows stay with the app (they step through the news list).
 *   scrollerOf(doc) -> the element the keys move, or null
 *   stepOf(key, shift, box) -> { top } | { by } | null
 *   installScrollKeys(doc, win)
 */
const KEYS = ['PageDown', 'PageUp', ' ', 'Home', 'End'];

function canScrollY(el, win) {
  if (!el || el.nodeType !== 1) return false;
  const s = win.getComputedStyle(el);
  return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight - el.clientHeight > 1;
}
function shown(el) {
  const r = el.getBoundingClientRect();
  return r.width > 40 && r.height > 40;
}

export function scrollerOf(doc) {
  const win = doc.defaultView;
  const sheets = [...doc.querySelectorAll('[role="dialog"]')].filter((d) => !d.hidden && shown(d) && win.getComputedStyle(d).display !== 'none' && win.getComputedStyle(d).visibility !== 'hidden');
  const scope = sheets.length ? sheets[sheets.length - 1] : doc.body;
  let best = null, area = 0;
  for (const el of [scope, ...scope.querySelectorAll('*')]) {
    if (!canScrollY(el, win) || !shown(el)) continue;
    const r = el.getBoundingClientRect(), a = r.width * r.height;
    if (a > area) { best = el; area = a; }
  }
  if (best) return best;
  const se = doc.scrollingElement;
  return !sheets.length && se && se.scrollHeight - se.clientHeight > 1 ? se : null;
}

export function stepOf(key, shift, box) {
  const page = Math.max(40, Math.round(box.clientHeight * 0.85));
  if (key === 'Home') return { top: 0 };
  if (key === 'End') return { top: box.scrollHeight };
  if (key === 'PageDown' || (key === ' ' && !shift)) return { by: page };
  if (key === 'PageUp' || (key === ' ' && shift)) return { by: -page };
  return null;
}

export function installScrollKeys(doc, win) {
  doc.addEventListener('keydown', (ev) => {
    if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey || !KEYS.includes(ev.key)) return;
    const t = ev.target;
    if (t && t.nodeType === 1) {
      if (t.isContentEditable || /^(input|textarea|select|button|summary|a|video|audio|iframe)$/i.test(t.tagName)) return;
      if (t.closest && t.closest('[role="listbox"], [role="menu"], [role="slider"], [role="tablist"], .maplibregl-map')) return;
      for (let a = t; a && a !== doc.body; a = a.parentElement) if (canScrollY(a, win)) return;   // a box with the focus scrolls by itself
    }
    const box = scrollerOf(doc), st = box && stepOf(ev.key, ev.shiftKey, box);
    if (!st) return;
    ev.preventDefault();
    const calm = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if ('top' in st) box.scrollTo({ top: st.top, behavior: calm ? 'auto' : 'smooth' });
    else box.scrollBy({ top: st.by, behavior: calm ? 'auto' : 'smooth' });
  });
}
