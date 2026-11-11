/* swipe — the news one event to a screen, moved through with a finger: up and down from event to event, sideways through the
 * headlines of Japan, abroad and the ministries. Every move has a key (↑ ↓ between events, ← → between sides) and a button,
 * so nothing needs a finger. Each event is an <article> with its own heading. The order is the one chosen in 並び順 (js/bubble.js).
 *
 *   flowItems(es, { sidesOf, outletOf, titleOf, max }) -> [{ key, title, ai, sides: [{ k, ja, n, heads: [{ outlet, title, ts, link }] }] }]
 *   clampStep(i, d, n) -> i                     the next index, held inside 0 .. n-1
 *   createSwipe({ h, root, fmt, on }) -> { open(items, at), close(), isOpen(), index(), go(i), side(d) } */

export const MAX_ITEMS = 40;
export const PER_SIDE = 4;
const SIDE_JA = [['jp', '国内'], ['intl', '海外'], ['gov', '官公庁']];
const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const safeUrl = (u) => { if (typeof u !== 'string' || !u) return null; try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; } };

export function flowItems(es, { sidesOf, outletOf = (it) => str(it.media) || str(it.outlet), titleOf, max = MAX_ITEMS } = {}) {
  const out = [];
  for (const e of arr(es)) {
    if (!e || e.hid || e.foldedInto || typeof sidesOf !== 'function') continue;
    const s = sidesOf(e);
    const sides = SIDE_JA.map(([k, ja]) => ({ k, ja, n: arr(s[k]).length, heads: arr(s[k]).filter((it) => it && str(it.title).trim()).slice(0, PER_SIDE)
      .map((it) => ({ outlet: outletOf(it), title: it.title.trim(), ts: isNum(it.ts) ? it.ts : null, link: safeUrl(it.link) })) })).filter((x) => x.heads.length);
    if (!sides.length) continue;
    const t = typeof titleOf === 'function' ? titleOf(e) : { text: sides[0].heads[0].title, ai: false };
    out.push({ key: e.key, title: str(t.text) || sides[0].heads[0].title, ai: !!t.ai, sides });
    if (out.length >= max) break;
  }
  return out;
}

export function clampStep(i, d, n) { return n ? Math.max(0, Math.min(n - 1, i + d)) : 0; }

export function createSwipe({ h, root, fmt = {}, on = {} }) {
  const clock = typeof fmt.clock === 'function' ? fmt.clock : (ts) => String(ts);
  let items = [], i = 0, list = null, back = null;
  const arts = () => (list ? [...list.querySelectorAll(':scope > article')] : []);
  function article(it, k) {
    const strip = h('div', { class: 'fl-strip', role: 'group', 'aria-label': '国内・海外・官公庁の見出し' },
      it.sides.map((sd) => h('section', { class: 'fl-side', data: { side: sd.k }, 'aria-label': `${sd.ja} ${sd.n} 件` },
        h('h3', null, h('span', { class: 'fl-dot' }), h('span', { text: sd.ja }), h('b', { class: 'num', text: sd.n })),
        h('ul', null, sd.heads.map((x) => h('li', null, h('span', { class: 'o' }, x.outlet, x.ts ? h('time', { class: 'num', text: ` ${clock(x.ts)}` }) : null),
          x.link ? h('a', { href: x.link, target: '_blank', rel: 'noopener noreferrer', class: 't', text: x.title }) : h('span', { class: 't', text: x.title })))))));
    return h('article', { class: 'fl-item', 'aria-labelledby': `fl-t${k}`, 'aria-posinset': k + 1, 'aria-setsize': items.length, tabindex: '-1' },
      h('p', { class: 'fl-n num', text: `${k + 1} / ${items.length}` }),
      h('h2', { id: `fl-t${k}`, class: 'fl-t' }, it.ai ? h('span', { class: 'aimk', text: 'AI' }) : null, it.title),
      strip,
      h('div', { class: 'fl-sides' }, it.sides.length > 1 ? it.sides.map((sd, j) =>
        h('button', { type: 'button', class: 'fl-b fl-tab', data: { side: sd.k }, 'aria-label': `${sd.ja}の見出しへ`, on: { click: () => toSide(k, j) } }, h('span', { class: 'fl-dot' }), `${sd.ja} ${sd.n}`)) : null,
      typeof on.open === 'function' ? h('button', { type: 'button', class: 'fl-b fl-cmp', on: { click: () => on.open(it.key) } }, '比べる') : null));
  }
  function toSide(k, j) {
    const a = arts()[k], st = a && a.querySelector('.fl-strip'), c = st && st.children[j];
    if (!c) return false;
    st.scrollTo({ left: c.offsetLeft, behavior: reduced() ? 'auto' : 'smooth' });
    return true;
  }
  function go(k, smooth = true) {
    const as = arts();
    if (!as.length) return false;
    i = clampStep(0, k, as.length);
    as[i].scrollIntoView({ behavior: smooth && !reduced() ? 'smooth' : 'auto', block: 'start' });
    try { as[i].focus({ preventScroll: true }); } catch { /* */ }
    return true;
  }
  function side(d, k = i) {
    const a = arts()[k];
    const st = a && a.querySelector('.fl-strip');
    if (!st) return false;
    const w = st.clientWidth || 1;
    st.scrollBy({ left: d * w, behavior: reduced() ? 'auto' : 'smooth' });
    return true;
  }
  const reduced = () => !!(root.ownerDocument.defaultView.matchMedia && root.ownerDocument.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function onKey(ev) {
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (ev.key === 'Tab') { trap(ev); return; }
    const act = { Escape: () => close(), ArrowDown: () => go(i + 1), ArrowUp: () => go(i - 1), ArrowRight: () => side(1), ArrowLeft: () => side(-1) }[ev.key];
    if (!act) return;
    ev.preventDefault(); ev.stopPropagation();   // the page's own keys (the next event, the views) stay out of this layer
    act();
  }
  // a modal layer: Tab goes round inside it
  function trap(ev) {
    const fs = [...root.querySelectorAll('button, a[href]')].filter((x) => x.offsetParent !== null || x.getClientRects().length);
    if (!fs.length) return;
    const a = root.ownerDocument.activeElement, first = fs[0], last = fs[fs.length - 1];
    if (ev.shiftKey && (a === first || !root.contains(a))) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && (a === last || !root.contains(a))) { ev.preventDefault(); first.focus(); }
  }
  function onScroll() {
    const as = arts(); if (!as.length) return;
    const top = list.scrollTop, hgt = list.clientHeight || 1;
    i = clampStep(0, Math.round(top / hgt), as.length);
  }
  function open(list0, at = 0) {
    items = arr(list0);
    back = root.ownerDocument.activeElement;
    list = h('div', { class: 'fl-list' }, items.length ? items.map(article) : h('p', { class: 'empty big', text: 'ニュースがありません' }));
    list.addEventListener('scroll', onScroll, { passive: true });
    root.replaceChildren(
      h('header', { class: 'fl-h' }, h('h2', { id: 'fl-title', text: on.title || '流す' }), h('span', { class: 'fl-ord', text: on.orderJa || '' }),
        h('span', { class: 'fl-nav' },
          h('button', { type: 'button', class: 'fl-b', on: { click: () => go(i - 1) } }, '前へ'),
          h('button', { type: 'button', class: 'fl-b', on: { click: () => go(i + 1) } }, '次へ'),
          h('button', { type: 'button', class: 'fl-b fl-x', on: { click: close } }, '閉じる'))),
      list);
    root.hidden = false;
    root.addEventListener('keydown', onKey);
    i = 0;
    requestAnimationFrame(() => go(at, false));
    if (typeof on.change === 'function') on.change(true);
  }
  function close() {
    if (root.hidden) return false;
    root.hidden = true; root.replaceChildren(); list = null;
    root.removeEventListener('keydown', onKey);
    if (back && back.focus) { try { back.focus(); } catch { /* */ } }
    if (typeof on.change === 'function') on.change(false);
    return true;
  }
  return { open, close, isOpen: () => !root.hidden, index: () => i, go, side };
}
