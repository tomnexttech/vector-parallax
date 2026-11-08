/* mapui — what stands on the map: pressing it, the related news on a card, the theme's colouring and its legend, the globe.
 * The drawing stays in js/map.js (which map) and js/mapgl.js; this file says what to draw and what a press means.
 *
 *   createMapUi({ map, floor, theater, events, theme, genres, genre, setGenre, describe, open, focus }) -> { press(hit, at), paint(info), update(), inTheme(e) }
 *     events()   the events on the board (not hidden, not folded)
 *     theme()    null, or { label, match(e) }: the field chosen, or the words searched for
 *     describe(e) -> { title, age }   what a line of the card says; open(key) opens the event
 *
 *   A press on the small map opens the big one. On the big one, a mark (or the ground of a country or a prefecture) brings a card of its news and says
 *   so on the window: `parallax:map-select` { place, lat, lon, country }; closing the card says `parallax:map-clear`. The globe button turns the flat map
 *   into a globe with the same ground (only where js/mapgl.js is the map). The count of a theme is the number of articles with a known place, nothing
 *   about what they say. */
import { markKey, nameKey } from './map.js';
import { placeJa } from './places.js';
import { GENRE_ALL, genreShort } from './genres.js';
import { loadBorders, whereIs, tally, stepsFor, levelOf, levelAlpha, stepLabel, pathOf, nameList, inEntry } from './mapthemes.js';

const JP_FROM = 12, JP_TO = 18;      // px per degree: the prefectures take over from the country
const GLOBE_KEY = 'parallax.map.globe';
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const weightOf = (e) => (Array.isArray(e.members) && e.members.length ? e.members.length : e.n > 0 ? e.n : 1);
const rowOf = (e) => ({ lat: e.geo.lat, lon: e.geo.lon, name: e.geo.name, country: !!e.geo.country, weight: weightOf(e) });
const leaves = (m) => (m.kids && m.kids.length ? m.kids.flatMap(leaves) : [m]);
const readGlobe = () => { try { return localStorage.getItem(GLOBE_KEY) === '1'; } catch { return false; } };
const saveGlobe = (on) => { try { localStorage.setItem(GLOBE_KEY, on ? '1' : '0'); } catch { /* this visit only */ } };

export function createMapUi({ map, floor, theater, events, theme, genres, genre, setGenre, describe, open, focus }) {
  const calm = () => document.documentElement.hasAttribute('data-calm') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let borders = null, bordersP = null;

  // ---------------------------------------------------------------- what stands on the theater
  const openBtn = el('button', 'mopen', '押すと拡大');
  openBtn.type = 'button'; openBtn.title = '地図を大きく表示（M）';
  openBtn.addEventListener('click', () => floor.setMode('map'));

  const chips = el('div', 'mtheme'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', '分野で地図を色分けする');
  const legend = el('aside', 'mlegend'); legend.hidden = true;
  const tools = el('div', 'mtools');
  const btnG = el('button', 'm3btn', '地球儀'); btnG.type = 'button'; btnG.hidden = true; btnG.title = '地球儀にする';
  const mkCtl = (text, label, fn) => { const b = el('button', 'm3ctl', text); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.addEventListener('click', fn); return b; };
  const ctl = el('span', 'm3ctls'); ctl.hidden = true;
  ctl.append(mkCtl('+', '拡大', () => map.zoom(1.6)), mkCtl('−', '縮小', () => map.zoom(1 / 1.6)));
  tools.append(btnG, ctl);
  const note = el('p', 'mnote'); note.hidden = true;
  const leader = el('i', 'mleader'); leader.hidden = true;
  const card = el('aside', 'mcard'); card.hidden = true; card.setAttribute('aria-live', 'polite');
  theater.append(openBtn, chips, legend, tools, note, leader, card);
  const credit = theater.querySelector('.map-credit');
  if (credit && !/MapLibre/.test(credit.textContent)) credit.textContent += ' · MapLibre GL JS';
  let globeOn = readGlobe();

  // ---------------------------------------------------------------- the borders, read when first wanted
  function ensureBorders() {
    if (borders) return Promise.resolve(borders);
    if (!bordersP) bordersP = loadBorders().then((b) => { borders = b; map.setNames(nameList(b)); update(); return b; }).catch(() => { bordersP = null; return null; });
    return bordersP;
  }

  // ---------------------------------------------------------------- the related news
  let pick = null;   // { name, lat, lon, keys, names, entry, pref, country, path, top }
  function related(p) {
    const T = theme();
    const out = [];
    for (const e of events()) {
      if (T && !T.match(e)) continue;
      let rank = 0;
      if (e.geo) {
        if (p.keys && p.keys.has(markKey(e.geo.name, e.geo.lat, e.geo.lon, !!e.geo.country))) rank = 2;
        else if (p.entry && borders) { const w = whereIs(borders, rowOf(e)); if ((p.pref ? w.pref : w.country) === p.entry) rank = 2; }
      }
      if (!rank && (e.places || []).some((k) => p.names.has(nameKey(placeJa(k))))) rank = 1;
      if (rank) out.push({ e, rank });
    }
    return out.sort((a, b) => b.rank - a.rank || (b.e.n || 0) - (a.e.n || 0) || (b.e.last || 0) - (a.e.last || 0)).map((x) => x.e);
  }
  function renderCard() {
    if (!pick) return;
    const list = related(pick), n = list.reduce((a, e) => a + weightOf(e), 0);
    const close = el('button', 'mc-x', '×'); close.type = 'button'; close.setAttribute('aria-label', '閉じる'); close.addEventListener('click', closeCard);
    const head = el('header', 'mc-h');
    const count = el('span', 'mc-n'); count.append(el('b', null, String(list.length)), el('small', null, '件'));
    head.append(el('h3', null, pick.name), count, close);
    card.setAttribute('aria-label', `${pick.name}の関連ニュース`);
    const parts = [head];
    const T = theme();
    const strip = el('p', 'mc-s', T ? `${T.label}の関連ニュース・記事 ${n} 本` : `関連ニュース・記事 ${n} 本`);
    parts.push(strip);
    if (list.length) {
      // the fields of what is here, as bars
      const byField = new Map();
      for (const e of list) if (e.field) byField.set(e.field, (byField.get(e.field) || 0) + 1);
      if (byField.size > 1) {
        const top = Math.max(...byField.values());
        const bars = el('ul', 'mc-b');
        for (const [f, c] of [...byField.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
          const li = el('li'), bar = el('i'); bar.style.width = `${Math.round((c / top) * 100)}%`;
          li.append(el('span', null, genreShort(f)), bar, el('b', null, String(c)));
          bars.append(li);
        }
        parts.push(bars);
      }
      const ul = el('ul', 'mc-l');
      for (const e of list.slice(0, 24)) {
        const d = describe(e), b = el('button'), li = el('li');
        b.type = 'button';
        b.append(el('span', 'mc-t', d.title), el('span', 'mc-m', [`${e.n || 0}社`, d.age].filter(Boolean).join(' · ')));
        b.addEventListener('click', () => { closeCard(); open(e.key); });
        li.append(b); ul.append(li);
      }
      parts.push(ul);
      if (list.length > 24) parts.push(el('p', 'mc-more', `他 ${list.length - 24} 件`));
    } else parts.push(el('p', 'mc-none', '今の一覧に、この場所のニュースはありません'));
    for (const c of ['tl', 'tr', 'bl', 'br']) parts.push(el('i', `mc-c ${c}`));
    card.replaceChildren(...parts);
    card.hidden = false; leader.hidden = false;
    placeCard();
  }
  function showPlace(p) {
    pick = p;
    map.setPicked({ lat: p.lat, lon: p.lon, path: p.path || null, rings: p.entry ? p.entry.rings : null });
    renderCard();
    window.dispatchEvent(new CustomEvent('parallax:map-select', { detail: { place: p.name, lat: p.lat, lon: p.lon, country: !!p.country } }));
  }
  function closeCard() {
    if (!pick) return;
    pick = null; card.hidden = true; leader.hidden = true;
    map.setPicked(null);
    window.dispatchEvent(new CustomEvent('parallax:map-clear'));
  }
  function showMark(m) {
    const ls = leaves(m);
    showPlace({ name: m.name, lat: m.lat, lon: m.lon, country: !!m.country || m.level === 'country', top: m.key,
      keys: new Set(ls.map((x) => markKey(x.name, x.lat, x.lon, !!x.country))), names: new Set(ls.map((x) => nameKey(x.name))) });
  }
  function showEntry(e, isPref) {
    showPlace({ name: e.name, lat: e.cy, lon: e.cx, entry: e, pref: !!isPref, country: !isPref, path: pathOf(e), names: new Set([nameKey(e.name)]) });
  }
  function pressGround(lat, lon, s) {
    if (!borders) { ensureBorders().then((b) => { if (b) pressGround(lat, lon, s); }); return; }
    const c = borders.countries.find((e) => inEntry(e, lat, lon));
    if (!c) { closeCard(); return; }
    if (c === borders.japan && s >= (JP_FROM + JP_TO) / 2) {
      const p = borders.prefs.find((e) => inEntry(e, lat, lon));
      if (p) { showEntry(p, true); return; }
    }
    showEntry(c, false);
  }
  /** the card beside the place, inside the theater; a line from the place to the card */
  function placeCard() {
    if (!pick || card.hidden) return;
    const W = theater.clientWidth, H = theater.clientHeight, cw = card.offsetWidth, ch = card.offsetHeight;
    const a = map.xy(pick.lat, pick.lon);
    const inView = a && a[0] >= 0 && a[0] <= W && a[1] >= 0 && a[1] <= H;
    if (W < 560) { leader.hidden = true; card.style.transform = `translate(${Math.round((W - cw) / 2)}px, ${Math.max(4, H - ch - 6)}px)`; return; }
    const px = a ? a[0] : W / 2, py = a ? a[1] : H / 2;
    const right = px + 22 + cw <= W - 8 && (px < W * 0.62 || px - 22 - cw < 8);
    const top = chips.offsetHeight && getComputedStyle(chips).display !== 'none' ? chips.offsetTop + chips.offsetHeight + 6 : 40;
    card.style.maxHeight = `${Math.max(120, H - top - 30)}px`;
    const x = right ? px + 22 : Math.max(8, px - 22 - cw), y = Math.max(top, Math.min(H - ch - 28, py - 40));
    card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    leader.hidden = !inView;
    if (inView) {
      const ex = right ? x : x + cw, ey = Math.max(y + 12, Math.min(y + ch - 12, py)), L = Math.hypot(ex - px, ey - py);
      leader.style.width = `${Math.round(L)}px`;
      leader.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) rotate(${Math.atan2(ey - py, ex - px).toFixed(3)}rad)`;
    }
  }

  // ---------------------------------------------------------------- the press
  function press(hit, at) {
    if (floor.mode() === 'case') {
      floor.setMode('map');
      if (hit && hit.m) showMark(hit.m);
      return true;
    }
    if (!hit) { const v = map.view(); pressGround(at.lat, at.lon, v ? v.s : 0); return true; }
    if (hit.kind === 'event' && hit.m) { showMark(hit.m); return true; }
    if (hit.kind === 'cluster') { showMark(hit.m); return false; }   // it also opens, as it always has
    return false;
  }

  // ---------------------------------------------------------------- the theme
  let themeKey = null, themeLast = null, jpNow = null, chipsKey = null;
  function renderChips() {
    const es = events(), now = genre();
    const counts = new Map();
    for (const e of es) if (e.geo && e.field) counts.set(e.field, (counts.get(e.field) || 0) + weightOf(e));
    const key = [now, ...genres.map((f) => counts.get(f) || 0)].join('|');
    if (key === chipsKey) return;
    chipsKey = key;
    const mk = (f, label, n) => {
      const b = el('button', 'mt');
      b.type = 'button'; b.dataset.genre = f; b.setAttribute('aria-pressed', String(now === f));
      b.append(el('span', null, label));
      if (n != null) b.append(el('small', null, String(n)));
      b.addEventListener('click', () => { setGenre(now === f ? GENRE_ALL : f); });
      return b;
    };
    chips.replaceChildren(el('b', 'mt-h', '分野'), mk(GENRE_ALL, 'すべて', null), ...genres.filter((f) => counts.get(f)).map((f) => mk(f, genreShort(f), counts.get(f))));
  }
  /** the map is close to Japan: the legend counts prefectures */
  function jpInView(t) {
    const v = map.view(), b = borders && borders.japan && borders.japan.box;
    if (!v || !b || !t.tally.prefs.length || v.s < (JP_FROM + JP_TO) / 2) return false;
    if (v.west != null) { for (const k of [-1, 0, 1]) if (v.east > b[0] + 360 * k && v.west < b[2] + 360 * k && v.north > b[1] && v.south < b[3]) return true; return false; }
    const lonC = ((v.lon0 + v.w / 2 / v.s + 540) % 360) - 180, latC = v.lat0 - v.h / 2 / v.s, hw = v.w / 2 / v.s, hh = v.h / 2 / v.s;
    return lonC + hw > b[0] && lonC - hw < b[2] && latC + hh > b[1] && latC - hh < b[3];
  }
  function renderLegend() {
    const t = themeLast;
    if (!t) { legend.hidden = true; return; }
    jpNow = jpInView(t);
    const rows = (jpNow ? t.tally.prefs : t.tally.countries).slice(0, 6), top = Math.max(1, ...rows.map((r) => r.n));
    const head = el('header', 'ml-h');
    head.append(el('b', null, t.label), el('span', null, `${t.tally.placed} 本・${jpNow ? `${t.tally.prefs.length} 都道府県` : `${t.tally.countries.length} か国`}`));
    const scale = el('ul', 'ml-s');
    t.steps.forEach((s, i) => { const li = el('li'), sw = el('i'); sw.style.opacity = String(levelAlpha(i, t.steps.length) + 0.1); li.append(sw, el('span', null, stepLabel(s))); scale.append(li); });
    const list = el('ol', 'ml-l');
    for (const r of rows) {
      const li = el('li'), b = el('button'), bar = el('i');
      b.type = 'button'; bar.style.width = `${Math.round((r.n / top) * 100)}%`;
      b.append(el('span', null, r.e.name), bar, el('b', null, String(r.n)));
      b.addEventListener('click', () => showEntry(r.e, jpNow));
      li.append(b); list.append(li);
    }
    const foot = el('p', 'ml-f', '地名の分かる記事の数。国境は目安です');
    legend.replaceChildren(head, scale, list, foot);
    legend.hidden = false;
  }
  function applyTheme() {
    const T = theme();
    if (!T) {
      if (themeKey !== '') { themeKey = ''; themeLast = null; delete theater.dataset.themed; map.setTheme(null); renderLegend(); if (pick) renderCard(); }
      return;
    }
    const rows = events().filter((e) => e.geo && T.match(e)).map(rowOf);
    const key = `${T.label}|${rows.length}|${rows.reduce((a, r) => a + r.weight, 0)}|${borders ? 1 : 0}`;
    if (key === themeKey) return;
    if (!borders) { ensureBorders(); return; }
    themeKey = key;
    const t = tally(borders, rows);
    const steps = stepsFor(t.countries.length ? t.countries[0].n : 0), L = steps.length;
    const item = (r) => ({ path: pathOf(r.e), rings: r.e.rings, a: levelAlpha(levelOf(steps, r.n), L), name: r.e.name, n: r.n, cx: r.e.cx, cy: r.e.cy, w: r.e.w, jp: r.e === borders.japan });
    map.setTheme({ countries: t.countries.map(item), prefs: t.prefs.map(item), jpFrom: JP_FROM, jpTo: JP_TO });
    themeLast = { label: T.label, tally: t, steps };
    theater.dataset.themed = '1';
    renderLegend();
    if (pick) renderCard();
  }

  // ---------------------------------------------------------------- the globe
  const say = (text) => { note.textContent = text; note.hidden = false; setTimeout(() => { note.hidden = true; }, 4200); };
  function syncTools() {
    const m = floor.mode(), gl = map.kind === 'gl';
    btnG.hidden = !gl || m === 'case';
    btnG.dataset.on = globeOn ? '1' : '0';
    btnG.textContent = globeOn ? '平面' : '地球儀';
    btnG.title = globeOn ? '平らな地図へ戻す' : '地球儀にする';
    ctl.hidden = m === 'case';
    if (gl) map.globe(globeOn && m !== 'case');
  }
  btnG.addEventListener('click', () => { globeOn = !globeOn; saveGlobe(globeOn); syncTools(); });
  window.addEventListener('parallax:map-engine', (ev) => { if (ev.detail === 'canvas' && globeOn) say('この端末では平らな地図だけを出します'); syncTools(); update(); });

  // ---------------------------------------------------------------- with the board
  function update() {
    const m = floor.mode();
    map.cursor = m === 'case' ? 'zoom-in' : 'grab';
    if (m === 'case') closeCard(); else ensureBorders();
    renderChips();
    applyTheme();
    syncTools();
  }
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && pick) closeCard(); });
  const q = document.getElementById('q');
  if (q) { let t = 0; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(update, 220); }); }

  return {
    press, update,
    /** the marks follow the theme */
    inTheme: (e) => { const T = theme(); return !T || T.match(e); },
    paint() {
      if (pick) placeCard();
      if (themeLast && jpInView(themeLast) !== jpNow) renderLegend();
    },
  };
}
