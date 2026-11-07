/* tour — the first visit's short tour. Six cards, one at a time: a heading of one line, a line or two of text, and the part of the
 * page it speaks of outlined while the rest is dimmed. 次へ / 戻る / とばす, the last card ends with はじめる; Esc or a press outside the
 * card closes it. Once finished or skipped it does not come again (localStorage, this browser only; a storage that cannot be read only
 * means it may come again). 使い方 in the bar opens it at any time.
 *
 *   STEPS                                          [{ id, at: [selector], title, text }]; at: the first one shown on the page is outlined
 *   tourSeen(storage) -> boolean
 *   markTour(storage) -> boolean                   false when it could not be kept
 *   wantTour(storage, search) -> boolean           ?tour=0 never, ?tour=1 always, else when not seen yet
 *   holeOf(rect, view, maxBottom) -> box | null    the outline: the target and a small margin, cut to the screen and above maxBottom
 *   place(rect, card, view) -> { hole, left, top } the card under, over, right or left of the outline, else at the bottom with the
 *                                                  outline cut above it; no target: the card in the middle
 *   createTour({ doc, win, storage, onEnd }) -> { open(i), close(), isOpen() }
 *                                                  narrow screens (under 600 px) keep the card at the bottom, the outline above it
 *
 * Neutral by rule, as the rest of the page: no word of right or wrong, and an outlet without a headline is only "not found". */

export const TOUR_KEY = 'parallax.tour.v1';
export const NARROW = 600;
const GAP = 12, EDGE = 16, PAD = 6;

export const STEPS = [
  { id: 'hello', at: [], title: 'はじめまして',
    text: 'Parallax は、同じニュースを国内外のメディアや官公庁がどう伝えているかを、並べて比べられるサイトです。' },
  { id: 'sects', at: ['#sects'], title: '画面を切り替える',
    text: 'ニュース・地図・市場・政治・災害・映像・保存を、この列で切り替えます。ホームは全部を一度に見る画面です。' },
  { id: 'simple', at: ['#entry .en-card[aria-pressed="true"]', '#entry .en-card', '#entry-btn'], title: 'かんたん表示',
    text: 'ニュースを一つ選ぶと、国内メディア・海外メディア・官公庁の発表が三列に並びます。' },
  { id: 'absent', at: ['#entry .cb-absent', '#entry .en-cols'], title: '見つからなかった媒体',
    text: '集めた記事の中で、このニュースが見つからなかったメディアです。あくまで集めた範囲での結果です。' },
  { id: 'ai', at: ['#entry .en-sel .en-ai', '#v-ai'], title: 'AI のまとめ',
    text: '言語が違っても、同じニュースの見出しを AI がひとまとめにします。AI が書いた文には「AI」マークが付きます。内容の真偽は判定しません。' },
  { id: 'settings', at: ['#cmd-btn', '#sects-more'], title: '探す・設定',
    text: 'ニュースも操作も、この欄から探せます（Ctrl+K）。字の大きさやダーク・ライトは設定で替えられます。' },
];

export function tourSeen(storage) {
  try { return !!storage && storage.getItem(TOUR_KEY) === '1'; } catch { return false; }
}

export function markTour(storage) {
  try { if (!storage) return false; storage.setItem(TOUR_KEY, '1'); return true; } catch { return false; }
}

export function wantTour(storage, search) {
  let q = null;
  try { q = new URLSearchParams(typeof search === 'string' ? search : '').get('tour'); } catch { q = null; }
  if (q === '0') return false;
  if (q === '1') return true;
  return !tourSeen(storage);
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function holeOf(r, v, maxBottom) {
  if (!r || !(r.width > 0) || !(r.height > 0) || !v) return null;
  const lim = Math.min(v.height - 4, typeof maxBottom === 'number' ? maxBottom : Infinity);
  const left = Math.max(4, r.left - PAD), top = Math.max(4, r.top - PAD);
  const right = Math.min(v.width - 4, r.left + r.width + PAD), bottom = Math.min(lim, r.top + r.height + PAD);
  if (right - left < 12 || bottom - top < 12) return null;
  return { left, top, width: right - left, height: bottom - top, right, bottom };
}

export function place(r, c, v) {
  const mid = { left: Math.round(Math.max(EDGE, (v.width - c.width) / 2)), top: Math.round(Math.max(EDGE, (v.height - c.height) / 2)) };
  const hole = holeOf(r, v);
  if (!hole) return { hole: null, ...mid };
  const xl = clamp(hole.left, EDGE, Math.max(EDGE, v.width - c.width - EDGE));
  const yt = clamp(hole.top, EDGE, Math.max(EDGE, v.height - c.height - EDGE));
  if (hole.bottom + GAP + c.height <= v.height - EDGE) return { hole, left: xl, top: hole.bottom + GAP };
  if (hole.top - GAP - c.height >= EDGE) return { hole, left: xl, top: hole.top - GAP - c.height };
  if (hole.right + GAP + c.width <= v.width - EDGE) return { hole, left: hole.right + GAP, top: yt };
  if (hole.left - GAP - c.width >= EDGE) return { hole, left: hole.left - GAP - c.width, top: yt };
  const top = Math.max(EDGE, v.height - c.height - EDGE);
  return { hole: holeOf(r, v, top - GAP), left: mid.left, top };
}

export function createTour({ doc, win, storage, onEnd } = {}) {
  let root = null, card, hole, nEl, tEl, xEl, prev, next, skip, timer = 0, i = 0, shown = false, back = null;
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  const btn = (cls, text, fn) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };
  const view = () => ({ width: doc.documentElement.clientWidth || win.innerWidth, height: win.innerHeight });
  const target = (s) => {
    for (const q of s.at) for (const e of doc.querySelectorAll(q)) { const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0) return e; }
    return null;
  };

  function build() {
    root = el('div', 'tour'); root.hidden = true;
    hole = el('div', 'tour-hole'); hole.setAttribute('aria-hidden', 'true');
    card = el('section', 'tour-card');
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'tour-t'); card.setAttribute('aria-describedby', 'tour-x');
    nEl = el('p', 'tour-n'); tEl = el('h2', 'tour-t'); tEl.id = 'tour-t'; xEl = el('p', 'tour-x'); xEl.id = 'tour-x';
    skip = btn('tour-skip', 'とばす', () => close());
    prev = btn('tour-prev', '戻る', () => show(i - 1));
    next = btn('tour-next', '次へ', () => (i >= STEPS.length - 1 ? close() : show(i + 1)));
    const foot = el('div', 'tour-f');
    foot.append(skip, el('span', 'tour-sp'), prev, next);
    card.append(nEl, tEl, xEl, foot);
    root.append(hole, card);
    root.addEventListener('click', (ev) => { if (!card.contains(ev.target)) close(); });
    win.addEventListener('keydown', onKey, true);
    doc.body.append(root);
  }

  function layout() {
    if (!shown) return;
    const t = target(STEPS[i]), v = view(), dock = !!t && v.width < NARROW;
    card.classList.toggle('dock', dock);
    card.style.left = ''; card.style.top = '';
    const cr = card.getBoundingClientRect();
    let p;
    // the target at the foot of the screen (the phone's tabs): the card goes to the top instead of covering it
    const up = dock && t.getBoundingClientRect().top > v.height * 0.6;
    card.classList.toggle('dock-top', up);
    if (dock) p = { hole: up ? holeOf(t.getBoundingClientRect(), v) : holeOf(t.getBoundingClientRect(), v, card.getBoundingClientRect().top - GAP) };
    else {
      p = place(t ? t.getBoundingClientRect() : null, { width: cr.width, height: cr.height }, v);
      card.style.left = `${p.left}px`; card.style.top = `${p.top}px`;
    }
    root.classList.toggle('bare', !p.hole);
    hole.hidden = !p.hole;
    if (p.hole) { const s = hole.style; s.left = `${p.hole.left}px`; s.top = `${p.hole.top}px`; s.width = `${p.hole.width}px`; s.height = `${p.hole.height}px`; }
  }

  function show(k) {
    i = clamp(k, 0, STEPS.length - 1);
    const s = STEPS[i], last = i === STEPS.length - 1;
    nEl.textContent = `${i + 1} / ${STEPS.length}`; tEl.textContent = s.title; xEl.textContent = s.text;
    prev.hidden = i === 0; skip.hidden = last; next.textContent = last ? 'はじめる' : '次へ';
    const t = target(s);
    if (t) {
      // bring it into view only when it is not: the bar's buttons stay where they are; on a narrow screen the card holds the lower part
      const r = t.getBoundingClientRect(), v = view(), low = v.width < NARROW ? v.height * 0.5 : v.height - 8;
      const tall = r.height > v.height * (v.width < NARROW ? 0.3 : 0.45);
      if (r.top < 0 || r.bottom > low) t.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest' });
    }
    layout();
    win.requestAnimationFrame(layout);
    try { next.focus({ preventScroll: true }); } catch { next.focus(); }
  }

  function onKey(ev) {
    if (!shown) return;
    ev.stopPropagation();   // the page's own keys wait while the tour is open
    const k = ev.key;
    if (k === 'Escape') { ev.preventDefault(); close(); }
    else if (k === 'ArrowRight' && i < STEPS.length - 1) { ev.preventDefault(); show(i + 1); }
    else if (k === 'ArrowLeft' && i > 0) { ev.preventDefault(); show(i - 1); }
    else if (k === 'Tab') {
      ev.preventDefault();
      const fs = [skip, prev, next].filter((b) => !b.hidden), at = fs.indexOf(doc.activeElement);
      fs[(at + (ev.shiftKey ? -1 : 1) + fs.length) % fs.length].focus();
    }
  }

  function open(k = 0) {
    if (!root) build();
    if (!shown) {
      back = doc.activeElement;
      shown = true; root.hidden = false;
      win.addEventListener('resize', layout); win.addEventListener('scroll', layout, true);
      timer = win.setInterval(layout, 300);   // the page below may draw again (photos arrive, the list moves)
    }
    show(k);
  }

  function close() {
    if (!shown) return;
    shown = false; root.hidden = true;
    win.removeEventListener('resize', layout); win.removeEventListener('scroll', layout, true); win.clearInterval(timer);
    markTour(storage);
    if (onEnd) onEnd(i);
    if (back && back.focus && back !== doc.body) { try { back.focus({ preventScroll: true }); } catch { /* gone */ } }
  }

  return { open, close, isOpen: () => shown };
}
