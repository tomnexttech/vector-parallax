/* Parallax — one board. Follows docs/CONTRACT-public.md (sections 2, 6, 7, 12, 13, 14, 16).
 * - Everything is visible without a click: inputs on the left, the judgement lists next, one event taken apart in the middle with
 *   the map under it, the world's numbers on the right; state on top, the source and the next event at the bottom.
 * - Text from feeds and from the AI goes in with textContent only.
 * - Old values never look current: the data time and the AI's own time turn red after 6 hours; failed or old feeds are red.
 * - Motion only when the data changes, once, in proportion to the change. Idle: the next priority event every 12 s; moving the pointer, a press,
 *   a key or the wheel stops it for 25 s.
 * - The six flags and the asymmetry labels come from the published rules only; the AI mark is put only on text the AI wrote.
 * - What a visitor watches stays in that browser (js/prefs.js). A visitor's own key stays in memory (BYOK).
 * - Every operation is an id in js/actions.js (keys, pane heads and the voice). A pane head opens its sheet toward the viewer.
 * - The visitor's tasks stay in that browser (js/tasks.js). The voice key, if given, stays in memory for this visit. */

import { SIX_H, keptView, noticeParts, isOld, defaultView } from './snapshot.js';
import { summaryOf, summaryIndex, memberKey, briefOf, briefIndex } from './summary.js';
import { PLACES, placeJa, placesOf, placesIn } from './places.js';
import { loadWatch, saveWatch, addWatch, removeWatch, hitsOf, loadView, saveView, countsFor, countIn, nextOf, COUNTS, LAYOUTS, COUNT_JA, LAYOUT_JA } from './prefs.js';
import { TOPICS, FIELDS, topicsOf, fieldOf, topicJa } from './topics.js';
import { createMap } from './map.js';
import { createFloor } from './floor.js';
import { createMapUi } from './mapui.js';
import { GENRE_ALL, genreBar, genreCounts, genreShort, genreIcon } from './genres.js';
import { createFeel } from './feel.js';
import { startAutoScroll } from './autoscroll.js';
import { loadHazards, nearby, dir8, shindoJa, disasterJa } from './hazards.js';
import { createActions } from './actions.js';
import { loadTasks, saveTasks, addTask, toggleTask, removeTask, hasTask, loadReads, saveReads, clearReads, noteRead, readMix } from './tasks.js';
import { speechSupported, listen, route as voiceRoute } from './voice.js';
import { absentOutlets, absentBlock, outletProfile } from './absent.js';
import { entryEvents, renderEntry, pickFirst, leadPool, lineIcon, sides as sidesOf, SIDES, original, firstLine } from './entry.js';
import { STORY, TL_CAP, timeline, sourcesOf } from './story.js';
import { readLines, createReader } from './speak.js';
import { uiLang, watch as watchWords } from './i18n.js';
import { tidyGovTitles } from './tidy.js';
import { detect, bannerText, sceneOf } from './scenes.js';
import { createPolitics } from './politics_ui.js';
import { STATIONS, videosOf, playFor, playOfStation, playOfVideo, describe, embedSrc } from './tv.js';
import { loadSettings, saveSettings, cleanSettings, hiddenBy, reasonJa, KIND_JA, loadOwnAI, saveOwnAI, cleanOwnAI, activeOwnAI } from './settings.js';
import { makeProvider } from './provider.js';
import { askOwnAI, testOwnAI, errJa, ASK_NOTE, MODE_JA, QUESTION_MAX } from './ownai.js';
import { askCache } from './slim.js';
import { beginLogin, readReturn, finishLogin, cleanedUrl, clearPending } from './login.js';
import { createConnect } from './connect.js';
import { createSettingsPanel } from './settings_panel.js';
import { initLandscape } from './landscape.js';
import { initDial } from './dial.js';
import { createTour, wantTour } from './tour.js';
import { createDossier, measure, paperPick, drawShareCard, CARD_W, CARD_H } from './dossier.js';
import { createCoverage, coverageOf } from './coverage.js';
import { biasOf as biasIndex, sourceBase } from './bias.js';
import { newsView, createMapNews } from './mapnews.js';
import { createWall, wallOn, pageOf, pageHolding, perOf } from './wall.js';
import { breakingOf, breakingText, keepOff, rankBy, localOf, placeName, searchOf, outletsOf, SPANS, SEARCH_SIDES, SORTS, QF0 } from './newsdesk.js';
import { SECTIONS, NEWS_TABS, parseHash, hashOf, paperOf, nextSeen, shareUrl, ruleJa, oneSideOf, ONE_SIDE_TITLE, ONE_SIDE_NOTE } from './sections.js';
import { createPalette } from './palette.js';

const DEFAULT_DATA = 'data/latest.json';
const POLL_MS = 5 * 60 * 1000;
const HAZ_MS = 10 * 60 * 1000;
const AUTO_MS = 12000;
const PAUSE_MS = 25000;
const TICK_MS = 8000;
const RADIUS_KM = 500;
const PRI_CAP = 80;
const FIELD_HOLD_MS = 5 * 60 * 1000;
const MAINSTREAM = new Set(['公共放送', '通信社', '全国紙', '民放']);
const GOV = '政府一次';
const TYPE_ORDER = ['政府一次', '通信社', '公共放送', '全国紙', '民放', '経済紙', '地方紙', '専門', '海外公共', '海外主流', '国家メディア'];
const OTHER_FIELD = 'その他';
const SEEN_KEY = 'parallax.seen.v1';
const LAYER_KEY = 'parallax.layers.v1';
const MODEL_RE = /^[A-Za-z0-9._-]{1,80}$/;
let defaultModel = '';

const FLAG_FALLBACK = {
  overseas_only: { ja: '海外だけ', tip_ja: '海外のメディアだけが載せている、日本に関わる出来事' },
  jp_main_not_found: { ja: '集めた国内の主要 {n} 社に見当たらない', tip_ja: '集めた国内の主要メディアには見当たらない' },
  primary_only: { ja: '官公庁だけ', tip_ja: '政府や中央銀行の発表だけに出ている' },
};
const VETO_WHY = { has_jp_outlet: '日本のメディアが含まれる', has_jp_mainstream: '日本の主要メディアが含まれる', single_outlet: '1 社だけ', has_non_primary: '官公庁以外のメディアが含まれる' };
const ERR_TEXT = {
  quota: '提供元の利用上限か残高の不足です（429/402）。少し時間を空けるか、残高を確かめてください。', auth: '鍵が通りませんでした（401/403）。鍵を確かめてください。',
  blocked: '提供元が応答を止めました。', truncated: '応答が長さの上限で切れました。', http: '提供元が誤りを返しました。', timeout: '時間内に応答がありませんでした。',
  network: '提供元へ届きませんでした（通信）。', json: '応答が JSON として読めませんでした。', shape: '応答の形が崩れていました。', nokey: '鍵がありません。',
  missing: '記録済みの答えがありません。', budget: '1 回の更新での AI の呼び数の上限に達しました。',
};
const TERMS_TEXT = { ok: '再表示可', nc: '非商用のみ', no: '再配布不可', unknown: '未確認' };
const LAYERS = [['events', '出来事'], ['pri', '注目'], ['radius', '半径'], ['quakes', '地震'], ['typhoons', '台風'], ['disasters', '災害']];

const state = {
  qf: { ...QF0 },   // the search narrowed: span, side, outlet, order (js/newsdesk.js searchOf)
  base: null, data: null, live: false, view: 'ai', q: '', watch: [], sel: null, about: false, ix: null, snap: null, busy: false, sumBy: null,
  pending: null, evalData: null, dataPath: DEFAULT_DATA, labels: null, es: [], byKey: new Map(), pri: [], topic: 'all', genre: GENRE_ALL, genreKey: '', field: null, fieldAt: 0,
  newKeys: new Set(), flashed: new Set(), prevSeen: null, autoNext: 0, pausedUntil: 0, stopped: false, haz: null, mkt: undefined, pol: undefined, crit: undefined,
  layers: null, tickQ: [], tickI: 0, tickAt: 0, map: null, board: null, hist: null, fieldTabs: [], hazFresh: new Set(), hazSeen: null, leadOf: new Map(), anomKind: null, sheet: null, tasks: [],
  set: cleanSettings(null), setSaved: true, showHid: false, unfold: new Set(), panel: null,
};

// ---------------------------------------------------------------- small tools
const $ = (id) => document.getElementById(id);
const arr = (v) => (Array.isArray(v) ? v : []);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const nowS = () => Math.floor(Date.now() / 1000);
const uniq = (xs) => [...new Set(xs)];
const store = (() => { try { return window.localStorage; } catch { return null; } })();
const explain = (codes) => uniq(arr(codes).filter((c) => typeof c === 'string')).map((c) => ERR_TEXT[c] || c).join(' ');
const ERR_SHORT = { quota: '上限（429）', auth: '鍵が通らない', blocked: '応答停止', truncated: '応答切れ', http: '誤りの応答', timeout: '時間切れ', network: '通信不可', json: '応答不正', shape: '応答不正', nokey: '鍵なし', missing: '記録なし', budget: '呼び数の上限' };
const explainShort = (codes) => uniq(arr(codes).filter((c) => typeof c === 'string')).map((c) => ERR_SHORT[c] || c).join('・');
const reduced = () => state.set.motion.calm === 'on' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrow = () => window.matchMedia('(max-width: 760px)').matches;
const dataDir = () => state.dataPath.replace(/[^/]*$/, '');

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'data') for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = String(dv);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(4)) { if (kid == null || kid === false) continue; el.append(kid instanceof Node ? kid : document.createTextNode(String(kid))); }
  return el;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, String(v));
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}
function safeUrl(u) { if (typeof u !== 'string' || !u) return null; try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; } }
function safeImg(u) { const x = safeUrl(u); return x && x.startsWith('https:') ? x : null; }
const extLink = (href, attrs, ...kids) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', ...attrs }, ...kids);
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
function openUrl(u) { const x = safeUrl(u); if (x) window.open(x, '_blank', 'noopener,noreferrer'); }

const JST = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function tparts(ts) { const o = {}; for (const p of JST.formatToParts(new Date(ts * 1000))) o[p.type] = p.value; return o; }
function fmtFull(ts) { if (!isNum(ts)) return '—'; const p = tparts(ts); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} JST`; }
function fmtShort(ts) { if (!isNum(ts)) return '—'; const p = tparts(ts); return `${Number(p.month)}/${Number(p.day)} ${p.hour}:${p.minute}`; }
function fmtClock(ts) { if (!isNum(ts)) return '—'; const p = tparts(ts); return `${p.hour}:${p.minute}`; }
function fmtAge(ts) {
  if (!isNum(ts)) return '';
  const d = nowS() - ts;
  if (d < -120) return 'これから';
  if (d < 60) return 'たった今';
  const m = Math.floor(d / 60);
  if (m < 60) return `${m}分前`;
  const hh = Math.floor(m / 60);
  return hh < 48 ? `${hh}時間前` : `${Math.floor(hh / 24)}日前`;
}
function fmtSpan(sec) {
  if (!isNum(sec) || sec < 0) return '—';
  if (sec < 60) return '1分未満';
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}分`;
  const hh = Math.floor(m / 60);
  if (hh < 24) return m % 60 ? `${hh}時間${m % 60}分` : `${hh}時間`;
  return `${Math.floor(hh / 24)}日${hh % 24 ? `${hh % 24}時間` : ''}`;
}
const plusH = (sec) => (!isNum(sec) ? '' : sec < 60 ? '+0分' : sec < 3600 ? `+${Math.floor(sec / 60)}分` : `+${(sec / 3600).toFixed(sec < 36000 ? 1 : 0)}時間`);
/** an age that turns itself (and its [data-host]) red once older than max seconds; tick() keeps it moving */
function ageEl(ts, max) {
  const el = h('time', { class: 'age', data: { ts: isNum(ts) ? ts : '', max: max || '' } });
  if (isNum(ts)) el.setAttribute('datetime', new Date(ts * 1000).toISOString());
  return el;
}
function tick() {
  for (const el of document.querySelectorAll('time[data-ts]')) {
    const ts = Number(el.dataset.ts);
    if (!el.dataset.ts || !Number.isFinite(ts)) { el.textContent = ''; continue; }
    el.textContent = fmtAge(ts);
    const max = Number(el.dataset.max);
    if (max > 0) {
      const old = nowS() - ts > max;
      el.classList.toggle('stale', old);
      const host = el.closest('[data-host]');
      if (host) host.classList.toggle('stale', old || host.dataset.bad === '1');
    }
  }
}
/** a number that rolls from the last value it showed; the length follows the size of the change; never back through 0 */
function roll(el, to) {
  if (!el) return;
  const txt = (v) => (isNum(v) ? v.toLocaleString('ja-JP') : '—');
  const from = Number(el.dataset.v);
  el.dataset.v = isNum(to) ? String(to) : '';
  if (!isNum(to) || !Number.isFinite(from) || el.dataset.v === '' || from === to || reduced()) { el.textContent = txt(to); return; }
  const ms = Math.min(1200, 250 + 80 * Math.abs(to - from)), t0 = performance.now();
  const step = (now) => { const k = Math.min(1, (now - t0) / ms); el.textContent = txt(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)))); if (k < 1 && el.dataset.v === String(to)) requestAnimationFrame(step); };
  requestAnimationFrame(step);
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}
const kids = (...xs) => xs.flat(3).filter((x) => x != null && x !== false && x !== '');
// a list of children may hold null for 'nothing here': drop it before the DOM turns it into the text null
if (typeof Element !== 'undefined') for (const P of [Element.prototype, DocumentFragment.prototype]) { const rc = P.replaceChildren, ap = P.append; P.replaceChildren = function (...a) { return rc.apply(this, kids(...a)); }; P.append = function (...a) { return ap.apply(this, kids(...a)); }; }
/** a word or a number that goes somewhere when pressed; the row under it does not take the press */
const lk = (text, fn, title, cls, data) => h('button', { type: 'button', class: 'lk' + (cls ? ' ' + cls : ''), title: title || null, data: data || null, on: { click: (ev) => { ev.stopPropagation(); fn(); } } }, text);
const num = (v, cls) => { const el = h('b', { class: 'num' + (cls ? ' ' + cls : '') }); roll(el, v); return el; };

// ---------------------------------------------------------------- data
function dataPath() {
  const q = new URLSearchParams(location.search).get('data');
  if (q == null || q === '') return { path: DEFAULT_DATA };
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_./-]*\.json$/.test(q) || q.includes('..') || q.includes('//')) return { bad: q };
  try { if (new URL(q, location.href).origin !== location.origin) return { bad: q }; } catch { return { bad: q }; }
  return { path: q, custom: true };
}
function index(d) {
  const items = isObj(d.items) ? d.items : {};
  const rcs = arr(d.rule_clusters).filter((c) => c && typeof c.cid === 'string');
  const stories = arr(d.stories).filter((x) => x && typeof x.sid === 'string');
  const rcOf = new Map(), storyOf = new Map();
  for (const c of rcs) for (const id of arr(c.member_ids)) rcOf.set(id, c.cid);
  for (const st of stories) for (const id of arr(st.member_ids)) storyOf.set(id, st.sid);
  const storyRcs = new Map(), rcStories = new Map(), twinBasis = new Map(), sById = new Map(stories.map((x) => [x.sid, x]));
  for (const st of stories) storyRcs.set(st.sid, uniq(arr(st.member_ids).map((id) => rcOf.get(id)).filter(Boolean)));
  for (const c of rcs) rcStories.set(c.cid, uniq(arr(c.member_ids).map((id) => storyOf.get(id)).filter(Boolean)));
  for (const st of stories) if (isObj(st.basis)) twinBasis.set(memberKey(st.member_ids), st.basis);
  return { items, rcs, stories, storyRcs, rcStories, twinBasis, storyOf, sById };
}
const coverOf = (homes) => { const hs = arr(homes); const jp = hs.includes('jp'), intl = hs.includes('intl'); return jp && intl ? 'both' : jp ? 'jp' : intl ? 'intl' : null; };
function denoms() {
  const src = arr(state.data && state.data.sources).filter((r) => r && r.ok === true);
  return { mainstream: src.filter((r) => r.home === 'jp' && MAINSTREAM.has(r.type)).length };
}
function flagDefs() { return state.labels && isObj(state.labels.flags) ? state.labels.flags : FLAG_FALLBACK; }
const plainWord = (x) => str(x).replace(/配信/g, 'メディア').replace(/取得した/g, '集めた');
function flagText(id) {
  const def = flagDefs()[id];
  if (!isObj(def)) return null;
  const sc = state.view === 'ai' && state.snap && isObj(state.data.ai_snapshot) && isObj(state.data.ai_snapshot.scope) ? state.data.ai_snapshot.scope : state.data.scope;
  const n = isObj(sc) && isObj(sc.jp_main) && isNum(sc.jp_main.fetched) ? sc.jp_main.fetched : denoms().mainstream;
  const fill = (x) => str(x).replace(/\{n\}/g, String(n));
  return { ja: plainWord(fill(def.ja)), tip: plainWord(fill(def.tip_ja)) };
}
const noteJa = () => (state.labels && str(state.labels.note_ja)) || '真偽は判定しない';
const pj = (k) => (state.labels && isObj(state.labels.places_ja) && str(state.labels.places_ja[k])) || placeJa(k);
function imageOf(it) {
  if (!isObj(it)) return null;
  const im = it.image;
  const url = typeof im === 'string' ? safeImg(im) : isObj(im) ? safeImg(im.url) : null;
  return url ? { url, outlet: str(it.outlet), link: safeUrl(it.link), id: it.id, ts: it.ts, title: str(it.title) } : null;
}
function ctx() { return state.view === 'ai' && state.snap ? state.snap : { data: state.data, ix: state.ix }; }
/** where an event is: the first named place that the bundled table knows, with how precise that point is */
/** where an event is. The board's place (data/places.json rules, with `via`) wins; otherwise the bundled table, marked as guessed from words */
function geoOf(places, c) {
  if (c && isObj(c.place) && isNum(c.place.lat) && isNum(c.place.lon)) {
    const country = c.place.prec === 'country';
    const nm = str(c.place.name), k0 = /^[\x20-\x7e]+$/.test(nm) ? placesIn(nm)[0] : null;
    return { key: nm, lat: c.place.lat, lon: c.place.lon, name: k0 ? pj(k0) : nm, via: str(c.place.via) || str(c.place.name), prec: country ? '国の代表点' : '地点', country };
  }
  for (const k of places) {
    const p = PLACES[k];
    if (!p || !isNum(p.lat)) continue;
    const country = !!p.ja;
    return { key: k, lat: p.lat, lon: p.lon, name: pj(k), via: pj(k), prec: country ? '国の代表点' : '都道府県の代表点', country, guessed: true };
  }
  return null;
}
/** one entry per event of the view on screen: RULES = rule_clusters, AI = stories. Each entry finds its board case (CONTRACT 18.5)
 * through the items it shares with this build's stories, so the board works in every view, the kept AI view included. */
function buildEntries() {
  const { ix } = ctx();
  const items = ix.items;
  const cases = state.board && isObj(state.board.cases) ? state.board.cases : null;
  if (!state.sumBy) state.sumBy = summaryIndex(arr(state.base && state.base.stories));
  if (!state.briefBy) state.briefBy = briefIndex(arr(state.base && state.base.stories));
  const mk = (kind, obj, ids) => {
    const members = ids.map((id) => items[id]).filter(isObj);
    return {
      kind, obj, ids, members, key: kind === 'rule' ? 'rc-' + obj.cid : 'st-' + obj.sid, mk: memberKey(ids), cover: coverOf(obj.homes),
      ai: null, summary: null, flags: [], ruleFlags: [], titled: members.filter((it) => typeof it.title === 'string' && it.title.trim()),
      imgs: members.map(imageOf).filter(Boolean), n: isNum(obj.n_outlets) ? obj.n_outlets : uniq(members.map((it) => it.outlet)).length,
      first: obj.first_ts, last: obj.last_ts, allGov: members.length > 0 && members.every((it) => it.type === GOV),
    };
  };
  let out;
  if (state.view === 'rules') {
    out = ix.rcs.map((c) => { const ids = arr(c.member_ids); const e = mk('rule', c, ids); const tb = ids.length >= 2 ? ix.twinBasis.get(e.mk) : null; e.basis = tb ? { ...tb, by: 'rule' } : null; return e; });
  } else {
    out = ix.stories.map((st) => {
      const ids = arr(st.member_ids);
      const e = mk('story', st, ids);
      const rcsOf = ix.storyRcs.get(st.sid) || [];
      e.ai = st.origin === 'ai' && isObj(st.ai) ? st.ai : null;
      e.merged = e.ai && rcsOf.length >= 2 ? rcsOf.length : 0;
      e.flags = e.ai ? arr(e.ai.flags).filter((f) => isObj(flagDefs()[f])) : [];
      e.summary = e.ai ? null : (summaryOf(st) || (state.live ? state.sumBy.get(e.mk) || null : null));
      e.brief = briefOf(st) || (state.live ? state.briefBy.get(e.mk) || null : null);
      e.basis = isObj(st.basis) ? st.basis : null;
      return e;
    });
  }
  for (const e of out) {
    // the board case: by sid first, then by the story most of its items belong to in this build
    const own = !(state.view === 'ai' && state.snap);
    let c = cases && e.kind === 'story' && own ? cases[e.obj.sid] || null : null;
    // the event layer (CONTRACT 18.11): a story folded into an event leads to the event's lead story
    if (!c && cases && e.kind === 'story' && own && state.leadOf.has(e.obj.sid)) { c = cases[state.leadOf.get(e.obj.sid)] || null; if (c) e.foldedInto = 'st-' + c.sid; }
    if (!c && cases) {
      const votes = new Map();
      for (const id of e.ids) { const sid = state.ix.storyOf.get(id); if (sid && cases[sid]) votes.set(sid, (votes.get(sid) || 0) + 1); }
      const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
      c = best ? cases[best[0]] : null;
    }
    e.case = c;
    e.exact = !!c && ((e.kind === 'story' && c.sid === e.obj.sid) || (isNum(c.n_items) && c.n_items === e.ids.length && (state.ix.sById.get(c.sid) ? memberKey(state.ix.sById.get(c.sid).member_ids) === e.mk : false)));
    if (e.exact && isObj(c.event) && own) {
      // the lead of an event shows every report of the stories it folded
      const more = uniq(arr(c.event.sids).filter((x) => x !== e.obj.sid).flatMap((x) => arr((ix.sById.get(x) || {}).member_ids)).filter((id) => !e.ids.includes(id)));
      const add = more.map((id) => items[id]).filter(isObj);
      if (add.length) {
        e.members = e.members.concat(add); e.ids = e.ids.concat(more);
        e.titled = e.members.filter((it) => typeof it.title === 'string' && it.title.trim()); e.imgs = e.members.map(imageOf).filter(Boolean);
        e.n = uniq(e.members.map((it) => it.outlet)).length;
        const ts = [e.first, e.last, ...add.map((it) => it.ts)].filter(isNum);
        if (ts.length) { e.first = Math.min(...ts); e.last = Math.max(...ts); }
      }
      e.event = { key: str(c.event.key), n: arr(c.event.sids).length };
    }
    e.places = placesOf(e.kind === 'rule' ? { ...e.obj, basis: e.basis } : e.obj, items);
    e.geo = geoOf(e.places, c);
    const ja = e.ai ? str(e.ai.headline_ja).trim() : '', en = e.ai ? str(e.ai.headline_en).trim() : '';
    const rep = c && items[c.rep_id] && str(items[c.rep_id].title).trim() ? items[c.rep_id] : null;
    const lang = state.set.news.lang;
    if (lang === 'en' && en) e.heading = { text: en, ai: true, lang: 'en' };
    else if (lang !== 'orig' && ja) e.heading = { text: ja, ai: true, en };
    else if (lang !== 'orig' && en) e.heading = { text: en, ai: true, lang: 'en' };
    else if (rep) e.heading = { text: rep.title, lang: rep.lang === 'en' ? 'en' : null, outlet: outletOf(rep), type: str(rep.type) };
    else if (e.titled.length) e.heading = { text: e.titled[0].title, lang: e.titled[0].lang === 'en' ? 'en' : null, outlet: outletOf(e.titled[0]), type: str(e.titled[0].type) };
    else e.heading = { text: uniq(e.members.map((it) => it.outlet)).join('・') || '—', none: true };
    const text = [e.heading.text, en, ...e.titled.map((it) => it.title)].join(' \n ');
    e.topics = c ? arr(c.flags).filter((f) => typeof f === 'string') : topicsOf(text);
    e.field = c && str(c.cat) ? c.cat : fieldOf(text, e.obj.homes) || OTHER_FIELD;
    if (!c && e.allGov) e.ruleFlags.push('primary_only');
    e.hay = [text, e.summary && e.summary.text_ja, e.ai && e.ai.contrast_ja, ...e.members.map((it) => it.outlet), ...e.places.map(pj), c && c.place && c.place.name].filter(Boolean).join(' \n ');
    e.hits = hitsOf(state.watch, e.hay);
    // the visitor's settings: why this event is hidden (null = shown). Every headline counts, whatever language is shown
    e.hid = hiddenBy(state.set, { titles: [ja, en, ...e.titled.map((it) => it.title)], members: e.members.map((it) => ({ names: [str(it.outlet), str(it.media)], type: str(it.type) })), field: e.field, cover: e.cover });
  }
  return out;
}
/** the priority list. With the board file: its order (flags x freshness, CONTRACT 18.3), mapped to the entries on screen; watched
 * events first. Without it: events on a watched issue reported by two or more outlets. */
function priorityOf(es) {
  const watched = es.filter((e) => e.hits.length);
  const b = state.board;
  if (b && Array.isArray(b.priority)) {
    const byCase = new Map();
    for (const e of es) if (e.case && !e.foldedInto && !byCase.has(e.case.sid)) byCase.set(e.case.sid, e);
    const mapped = b.priority.map((sid) => byCase.get(sid)).filter(Boolean);
    if (mapped.length) return uniq([...watched, ...mapped]).slice(0, PRI_CAP);
  }
  return uniq([...watched, ...es.filter((e) => e.topics.length && e.n >= 2).sort((a, b2) => b2.n - a.n || (b2.last || 0) - (a.last || 0))]).slice(0, PRI_CAP);
}
const matchesQ = (e) => !state.q || e.hay.toLowerCase().includes(state.q.toLowerCase());
/** hidden by the settings: off every list and the map, except a priority row, which stays as a folded tag. One press shows all for this visit */
const vis = (e) => !e.hid || state.showHid;
const folded = (e) => !!e.hid && !state.showHid && !state.unfold.has(e.key);
/** the field chosen with the icons (js/genres.js): every list of events shows that field only */
const inGenre = (e) => state.genre === GENRE_ALL || e.field === state.genre;
function shownPri() { return shownPriAll().filter(inGenre); }
function shownPriAll() {
  if (state.q) return searchOf(state.es.filter((e) => !e.foldedInto && matchesQ(e)), { ...state.qf, now: nowS(), sideN: (e, k) => measureOf(e)[k].length, outletOf }).slice(0, 200);
  const t = state.topic;
  if (t === 'cross') return state.es.filter((e) => !e.foldedInto && e.cover === 'both').sort((a, b) => b.n - a.n || (b.last || 0) - (a.last || 0)).slice(0, 200);
  return t === 'all' ? state.pri : t === 'watch' ? state.pri.filter((e) => e.hits.length) : state.pri.filter((e) => e.topics.includes(t));
}
const cur = () => state.byKey.get(state.sel) || null;
const FLAG_PLAIN = { 公金: 'お金・税金', '法・人事': '法律・人事', 安保: '安全保障', AI統治: 'AI のルール', 政治と人事: '政治・人事' };   // everyday words on the screen; the data keeps its own
const flagJa = (id) => { const x = (state.board && isObj(state.board.flag_labels) && isObj(state.board.flag_labels[id]) && str(state.board.flag_labels[id].ja)) || topicJa(id) || id; return FLAG_PLAIN[x] || x; };
const typeLead = (type) => { const t = state.labels && isObj(state.labels.types) ? state.labels.types[type] : null; return isObj(t) && t.lead && str(t.short) ? str(t.short) : ''; };
const outletOf = (it) => (isObj(it) ? str(it.media) || str(it.outlet) : '');
const viaGN = (it) => isObj(it) && it.via === 'gnews';
const counts = () => (state.board && isObj(state.board.counts) ? state.board.counts : null);
const AI_NOTE = 'AI の文は間違うことがあります。元の記事で確かめてください';
// the AI's brief of one event (CONTRACT 13.1): what happened, the course, how the sides differ, what is next; empty rows are left out
function briefBox(e, tag) {
  const b = e.brief; if (!b) return null;
  return h('div', { class: 'ch-brief' },
    h('dl', null, b.rows.map((r) => [h('dt', { text: r.label }), h('dd', { text: r.text })])),
    h('p', { class: 'ch-ai' }, tag([b.provider, b.model], b.madeAt), h('span', { text: AI_NOTE })));
}
const ISSUES = 'https://github.com/tomnexttech/vector-parallax/issues';
const STOP_NOTE = '掲載の停止は GitHub の Issues で受け付けます。本人とご遺族は記事の URL だけで足ります。第三者の複製やキャッシュには及びません';
const FLAG_LEGEND = '話題の分類です。重要度や責任の有無は示しません';
/** the title of an event: a line the AI wrote carries the AI mark; an outlet's headline is quoted, with the outlet after it */
function headNode(e, cls) {
  const hd = e.heading;
  if (hd.ai) return h('span', { class: cls, lang: hd.lang || null }, h('span', { class: 'aimk', title: 'AI が書いた題', text: 'AI' }), hd.text);
  if (hd.none) return h('span', { class: cls, text: hd.text });
  const lead = typeLead(hd.type);
  return h('span', { class: cls, lang: hd.lang || null }, lead ? h('span', { class: 'tlead', text: lead }) : null, `「${hd.text}」`, hd.outlet ? h('span', { class: 'hout', text: `（${hd.outlet}）` }) : null);
}

// ---------------------------------------------------------------- toolbar
function renderBar() {
  const d = state.data;
  $('v-ai').setAttribute('aria-pressed', String(state.view === 'ai'));
  $('v-rules').setAttribute('aria-pressed', String(state.view === 'rules'));
  // sources: live / total, red under 80 %
  const rows = arr(d.sources).filter(isObj);
  const live = rows.filter((r) => r.ok === true).length;
  const ms = $('m-src');
  ms.dataset.bad = rows.length && live / rows.length < 0.8 ? '1' : '0';
  ms.classList.toggle('stale', ms.dataset.bad === '1');
  ms.dataset.tone = rows.length ? (ms.dataset.bad === '1' ? 'bad' : 'ok') : '';
  roll($('src-live'), live); $('src-total').textContent = String(rows.length);
  // data time
  $('gen-at').textContent = fmtShort(d.generated_at);
  $('gen-age').replaceWith(Object.assign(ageEl(d.generated_at, SIX_H), { id: 'gen-age' }));
  $('m-gen').dataset.bad = d.schema === 'parallax/1' && isNum(d.generated_at) ? '0' : '1';
  $('m-gen').title = `データを組んだ時刻 ${fmtFull(d.generated_at)}`;
  $('m-gen').dataset.tone = $('m-gen').dataset.bad === '1' ? 'bad' : isOld(d.generated_at, nowS()) ? 'warn' : 'ok';
  // the AI: who wrote it and when, red after 6 h
  const run = isObj(d.ai_run) ? d.ai_run : {};
  const kept = state.snap ? state.snap.kept : null;
  const st = str(run.status) || 'off';
  const src = kept ? kept.snapRun : run;
  const who = $('ai-who');
  const recorded = st === 'recorded' || str(src.provider) === 'claude-recorded';
  $('v-ai').disabled = state.hasAI === false;
  $('v-ai').title = state.hasAI === false ? 'AI 停止中' : '';
  // the bar says only what is the same for everyone: when the AI's grouping was written, or the last one when it stopped.
  // The visitor's own key is told only in the settings (自分の AI); the provider and the model stay in the tooltip.
  const tm = (ts) => (nowS() - ts < 86400 ? fmtClock(ts) : fmtShort(ts));
  const prevAt = kept && isNum(kept.aiAt) ? kept.aiAt : null;
  const runAt = isNum(run.at) && (state.live || recorded || st === 'ok' || st === 'partial') ? run.at : null;
  who.textContent = !kept && runAt != null ? `まとめ ${tm(runAt)}` : prevAt != null ? `前回 ${tm(prevAt)}` : '停止中';
  who.title = [state.live ? '閲覧者の鍵' : '', state.live || st === 'ok' || st === 'partial' ? str(run.model) : kept ? str(src.model) : '',
    recorded ? `${str(src.model || run.model)} ${str(run.note_ja)}`.trim() : ''].filter(Boolean).join('・');
  const ma = $('m-ai');
  ma.dataset.bad = '0';
  const age = ageEl(null, SIX_H);
  age.id = 'ai-age';
  $('ai-age').replaceWith(age);
  ma.classList.toggle('stale', false);
  ma.dataset.tone = !kept && runAt != null && !isOld(runAt, nowS()) && st !== 'partial' ? 'ok' : 'warn';   // amber when old or stopped, never red
  // since the last visit
  $('m-new').hidden = !state.prevSeen;
  roll($('new-n'), state.newKeys.size);
  renderSectNav();
  renderSnapNote();
  renderAiLine();
}
function renderSnapNote() {
  const el = $('snap-note');
  const run = isObj(state.data.ai_run) ? state.data.ai_run : {};
  el.replaceChildren();
  state.stSnap = null;
  // the state is one dot and a word in the line above (renderStat); the bar below opens only when that is pressed
  const done = (st) => { state.stSnap = st; el.hidden = !st || state.statOpen !== 'snap'; renderStat(); };
  if (state.hasAI === false && !state.live) { el.className = 'note-bar'; el.append('AI 停止中・自動のまとめを表示'); return done({ tone: 'warn', text: 'AI 停止中' }); }
  const unreadable = !state.live && str(run.status) === 'kept_previous' && !state.snap;
  if (state.view !== 'ai' || (!state.snap && !unreadable)) return done(null);
  el.className = 'note-bar';
  if (unreadable) { el.classList.add('err'); el.append('AI の前回分を読めない・自動のまとめを表示'); return done({ tone: 'bad', text: 'AI 読めない' }); }
  const kept = state.snap.kept;
  const p = noticeParts(kept, fmtShort, explainShort, run.errors);
  const tag = (k, v, extra, bad) => h('span', { class: 'tg' + (bad ? ' bad' : '') }, h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v }), extra || '');
  el.classList.add('tags');
  el.append(tag(p.lead[0], p.lead[1]), tag(p.ai, fmtShort(kept.aiAt), ageEl(kept.aiAt, SIX_H)), ...(p.why ? [tag(p.why[0], p.why[1], null, true)] : []), tag(p.rules[0], p.rules[1]));
  const old = isOld(kept.aiAt, nowS());
  done({ tone: kept.reason === 'error' ? 'bad' : old ? 'warn' : 'ok', text: old ? `AI ${fmtAge(kept.aiAt)}のまとめ` : 'AI 前回の結果', old });
}
/** the state of what is on screen as small dots and a word each, at the end of the line above the board; a press opens the bar below */
function statEl() { return state.statEl || (state.statEl = h('span', { class: 'stat', id: 'stat' })); }
function renderStat() {
  const items = [['snap', state.stSnap, 'snap-note'], ['scene', state.stScene, 'scene-bar']].filter(([, v]) => v);
  const key = JSON.stringify([items, state.statOpen]);
  if (key === state.statKey) return;
  state.statKey = key;
  statEl().replaceChildren(...items.map(([k, v, id]) => h('button', {
    type: 'button', class: 'stb' + (v.old ? ' old' : ''), 'aria-expanded': String(state.statOpen === k), 'aria-controls': id, title: v.tip || '押すと詳しく',
    on: { click: () => toggleStat(k) } }, h('i', { class: 'dot ' + (v.tone || ''), data: v.genre ? { genre: v.genre } : null, 'aria-hidden': 'true' }), v.text)));
}
function toggleStat(k) {
  state.statOpen = state.statOpen === k ? null : k;
  $('snap-note').hidden = !(state.statOpen === 'snap' && state.stSnap);
  $('scene-bar').hidden = !(state.statOpen === 'scene' && state.stScene);
  renderStat();
  return true;
}

/** one line on top: what the AI joined across home and abroad, next to what the rules found; only the number of the view on screen is lit */
function renderAiLine() {
  const el = $('ai-line');
  if (!el) return;
  const cn = counts();
  const ch = isObj(state.data.cross_home) ? state.data.cross_home : null;
  const both = cn && isObj(cn.home) && isNum(cn.home.both) ? cn.home.both : ch && isNum(ch.rules) ? ch.rules : null;
  const ai = ch && ch.of && isNum(ch.ai) ? ch.ai : null;
  const flash = state.alView != null && state.alView !== state.view;
  state.alView = state.view;
  const n = (v, on) => h('b', { class: 'num' + (on ? ' on' : '') + (on && flash && !reduced() ? ' flash' : ''), text: fmtN(v) });
  const parts = [h('span', { class: 'al-h', text: '国内と海外の両方' })];
  if (state.hasAI && ai != null) { parts.push(h('span', { class: 'al-k', text: 'AI' }), n(ai, state.view === 'ai')); if (ch.of === 'snapshot') parts.push(h('span', { class: 'al-u', text: '前回のまとめ' })); }
  else if (!state.stSnap) parts.push(h('span', { class: 'al-k off', text: 'AI 停止中' }));   // with a dot at the end of the line, the word is said once
  if (both != null) parts.push(h('i', { class: 'al-sep', 'aria-hidden': 'true' }), h('span', { class: 'al-k', text: '自動' }), n(both, state.view === 'rules'));
  parts.push(h('button', { type: 'button', class: 'al-go', on: { click: () => { if (state.hasAI && ai != null && state.view !== 'ai') setView('ai'); setTopic('cross'); if (narrow()) $('p-pri').scrollIntoView({ block: 'start' }); } } }, '一覧'));
  el.replaceChildren(...parts, viewEl());
  (phoneBar.matches ? $('tb').querySelector('.meters') : el).append(statEl());
}

// ---------------------------------------------------------------- left column: the inputs
function renderSources() {
  const d = state.data, g = d.generated_at, b = state.board;
  const brows = b && Array.isArray(b.sources) ? b.sources.filter(isObj) : null;
  const stale = new Set(b && b.health && Array.isArray(b.health.stale_72h) ? b.health.stale_72h : []);
  const rows = brows || arr(d.sources).filter(isObj).map((r) => ({ ...r, h48: r.n }));
  const bad = (r) => r.ok !== true || stale.has(r.id) || (!brows && (!isNum(r.fetched_at) || (isNum(g) && r.fetched_at < g - SIX_H)));
  const e = cur();
  const inCase = new Set(e ? e.members.map((it) => it.source_id) : []);
  const types = uniq([...TYPE_ORDER.filter((t) => rows.some((r) => r.type === t)), ...rows.map((r) => r.type)]);
  const max = Math.max(1, ...rows.map((r) => (isNum(r.h48) ? r.h48 : 0)));
  const live = rows.filter((r) => r.ok === true).length;
  $('src-c').textContent = `${live} / ${rows.length}`;
  // one tick per feed: height = headlines of the last 48 h, faint = nothing in the last hour, red = failed or silent 72 h, cyan = reported the event on screen
  const W = 210, H = 46, gap = 3;
  const per = (W - gap * (types.length - 1)) / Math.max(1, rows.length);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H + 4}`, class: 'ticks', role: 'img', 'aria-label': 'メディア別 48 時間の件数' });
  let x = 0;
  for (const t of types) {
    for (const r of rows.filter((q) => q.type === t)) {
      const n = isNum(r.h48) ? r.h48 : 0;
      const hh = bad(r) ? H : Math.max(1.5, Math.sqrt(n / max) * H);
      const cls = bad(r) ? 'bad' : inCase.has(r.id) ? 'hit' : isNum(r.h1) && r.h1 === 0 ? 'quiet' : '';
      svg.append(s('rect', { x: x.toFixed(1), y: (H - hh).toFixed(1), width: Math.max(1, per - 1).toFixed(1), height: hh.toFixed(1), class: cls },
        s('title', {}, document.createTextNode(`${str(r.name)}・${t}・${bad(r) ? str(r.err) || '更新なし' : `48時間 ${n}・1時間 ${isNum(r.h1) ? r.h1 : '—'}`}`))));
      x += per;
    }
    x += gap;
  }
  const staleJa = (b && isObj(b.health) && str(b.health.stale_label_ja)) || '更新なし';
  const btypes = b && Array.isArray(b.types) ? new Map(b.types.filter(isObj).map((t) => [t.type, t])) : new Map();
  const list = h('ul', { class: 'src-types' }, types.map((t) => {
    const rs = rows.filter((r) => r.type === t);
    const down = rs.filter(bad).length;
    const bt = btypes.get(t);
    const h48 = bt && isNum(bt.h48) ? bt.h48 : rs.reduce((a, r) => a + (isNum(r.h48) ? r.h48 : 0), 0);
    const hit = rs.filter((r) => inCase.has(r.id)).length;
    return h('li', { class: down ? 'bad' : null, title: bt && isNum(bt.age_h) ? `最新 ${bt.age_h} 時間前` : null, on: { click: () => openSheet('src', $('p-src')) } },
      h('span', { class: 'tn', text: t }), h('span', { class: 'tc', text: down ? `${rs.length - down}/${rs.length}` : String(rs.length) }),
      h('span', { class: 'ti', text: String(h48) }), h('span', { class: 'th', text: hit ? String(hit) : '' }));
  }));
  const down = rows.filter(bad);
  $('src-b').replaceChildren(svg, h('p', { class: 'src-k' }, h('span', { text: '種類' }), h('span', { text: '社数' }), h('span', { text: '48時間' }), h('span', { text: '表示' })), list,
    h('p', { class: 'pfoot' + (down.length ? ' bad' : '') }, down.length ? `届かない・${staleJa} ${down.length}` : '届かない媒体 0'));
}
function renderHours() {
  const b = state.board;
  const e = cur();
  let bins, to, hours, priAgo = new Set(), label;
  if (b && isObj(b.volume) && Array.isArray(b.volume.total)) {
    hours = b.volume.total.length; bins = [...b.volume.total].reverse(); to = b.generated_at; label = '見出しの件数';
    const pri = new Set(arr(b.priority));
    for (const p of arr(b.slab && b.slab.pillars)) if (isObj(p) && pri.has(p.sid) && isNum(p.h)) priAgo.add(p.h);
  } else {
    const d = ctx().data, items = ctx().ix.items;
    to = isNum(d.generated_at) ? d.generated_at : nowS(); hours = isNum(d.window_h) ? d.window_h : 36; label = '束の見出し';
    const from = to - hours * 3600;
    bins = new Array(hours).fill(0);
    for (const it of Object.values(items)) { if (!isObj(it) || !isNum(it.ts) || it.ts < from || it.ts > to) continue; bins[Math.min(hours - 1, Math.floor((it.ts - from) / 3600))]++; }
    for (const x of state.pri) if (isNum(x.first)) priAgo.add(Math.floor((to - x.first) / 3600));
  }
  const from = to - hours * 3600;
  const max = Math.max(1, ...bins);
  const W = 210, H = 54, bw = W / hours;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H + 18}`, class: 'hours', role: 'img', 'aria-label': '時間別の件数' });
  bins.forEach((n, i) => {
    const hh = (n / max) * H, ago = hours - 1 - i;
    svg.append(s('rect', { x: (i * bw + 0.5).toFixed(1), y: (H - hh).toFixed(1), width: Math.max(1, bw - 1.2).toFixed(1), height: Math.max(0.5, hh).toFixed(1), class: priAgo.has(ago) ? 'pri' : '' },
      s('title', {}, document.createTextNode(`${fmtClock(from + i * 3600)}〜 ${n} 件`))));
  });
  if (e) for (const it of e.members) if (isNum(it.ts) && it.ts >= from && it.ts <= to) svg.append(s('circle', { cx: (((it.ts - from) / 3600) * bw).toFixed(1), cy: H + 6, r: 2, class: 'case' }));
  svg.append(s('text', { x: 0, y: H + 17, class: 'ax' }, document.createTextNode(`-${hours}時間`)), s('text', { x: W, y: H + 17, class: 'ax end' }, document.createTextNode(fmtClock(to))));
  $('hours-c').textContent = `${hours}時間`;
  $('hours-b').replaceChildren(svg, h('p', { class: 'pfoot', title: label }, ...[['直近 1 時間', bins[hours - 1]], ['最多', `${max}/時`], ['注目の初報', priAgo.size]].map(([k, v]) => h('span', { class: 'pf' }, `${k} `, h('b', { text: String(v) })))));
}
function renderFields() {
  const es = state.es.filter((e) => !e.foldedInto && matchesQ(e) && vis(e));
  const fOff = new Set(state.showHid ? [] : state.set.news.fields_off);
  const b = state.board;
  const byCase = new Map();
  for (const e of es) if (e.case && !e.foldedInto && !byCase.has(e.case.sid)) byCase.set(e.case.sid, e);
  let tabs;
  if (b && isObj(b.outline)) {
    tabs = Object.keys(b.outline).filter((f) => !fOff.has(f)).map((f) => [f, uniq(arr(b.outline[f]).map((sid) => byCase.get(sid)).filter(Boolean))]);
    tabs.push(['分野の外', uniq(arr(b.outside).map((sid) => byCase.get(sid)).filter(Boolean))]);
    if (!tabs.some(([, l]) => l.length)) tabs = null;
  }
  if (!tabs) tabs = [...FIELDS, OTHER_FIELD].filter((f) => !fOff.has(f)).map((f) => [f, es.filter((e) => e.field === f).sort((a, b2) => b2.n - a.n || (b2.last || 0) - (a.last || 0)).slice(0, 60)]);
  state.fieldTabs = tabs.map(([f]) => f);
  if (!tabs.length) tabs = [['分野の外', []]];
  if (!state.field || !state.fieldTabs.includes(state.field)) state.field = tabs[0][0];
  $('fields-c').textContent = b ? `各 ${isObj(b.rules) && isNum(b.rules.outline_per_cat) ? b.rules.outline_per_cat : 6} 件まで` : String(es.length);
  $('field-tabs').replaceChildren(...tabs.map(([f, l]) => h('button', {
    type: 'button', class: 'tab', data: { genre: f }, 'aria-pressed': String(state.field === f), on: { click: () => setField(f, true) } }, f, h('span', { class: 'n', text: l.length }))));
  const list = (tabs.find(([f]) => f === state.field) || [null, []])[1];
  $('fields-b').replaceChildren(list.length ? h('ul', { class: 'rows' }, list.map((e) => row(e, { compact: true }))) : h('p', { class: 'empty', text: '0 件' }));
}
// ---------------------------------------------------------------- second column: the judgement lists
function row(e, opt = {}) {
  if (folded(e)) {
    return h('li', { class: 'r folded', data: { key: e.key }, tabindex: '-1', title: '押すとこの行だけ開く',
      on: { click: () => { state.unfold.add(e.key); renderPri(); select(e.key, true); } } },
      h('span', { class: 'flag fold', text: '隠した' }), h('span', { class: 'rt', text: `${reasonJa(e.hid)}に当たる` }),
      h('span', { class: 'rm' }, h('span', { class: 'rn', text: `${e.n}社` }), h('span', { text: fmtAge(e.last) })));
  }
  const fresh = state.newKeys.has(e.mk) && !state.flashed.has(e.key + (opt.compact ? 'c' : ''));
  if (fresh) state.flashed.add(e.key + (opt.compact ? 'c' : ''));
  const first = e.members[0];
  const li = h('li', {
    class: ['r', state.sel === e.key ? 'sel' : '', fresh ? 'fresh' : '', e.hits.length ? 'watched' : '', state.openRow === e.key ? 'open' : ''].filter(Boolean).join(' '),
    data: { key: e.key }, tabindex: '-1',
    on: { click: () => (opt.press ? opt.press(e.key) : pressRow(e.key)) },
  });
  const tag = opt.flag ? h('span', { class: 'flag', title: opt.flag.tip, text: opt.flag.ja }) : null;
  li.append(...kids(
    opt.thumb ? rowThumb(e) : null,
    tag,
    headNode(e, 'rt'),
    h('span', { class: 'rm' },
      !opt.compact && e.field ? lk(genreShort(e.field), () => setGenre(e.field), `${e.field} の出来事だけ見る`, 'gtag', { genre: e.field }) : null,
      state.newKeys.has(e.mk) ? h('span', { class: 'newdot', title: '前回から新しい' }) : null,
      dossier.ratioBar(measureOf(e)),
      lk(`${e.n}社`, () => { select(e.key, true); goMembers(); }, 'この出来事の全報道を見る', 'rn'),
      biasOf(e).ok ? lk(dossier.biasMini(biasOf(e)), () => { state.biasOpen = true; select(e.key, true); renderCase(); if (narrow() || $('board').dataset.wall === '1') openSheet('case'); }, 'バイアス度の内訳を見る', 'bi-chip') : null,
      h('span', { text: fmtAge(e.last) }),
      !opt.compact && e.topics.length ? h('span', { class: 'rk' }, e.topics.map((id, i) => [i ? '・' : '', lk(flagJa(id), () => setTopic(id), `${flagJa(id)} の出来事だけ見る`)])) : null,
      e.hits.length ? h('span', { class: 'rw', text: e.hits.join('・') }) : null),
    state.openRow === e.key ? rowMore(e) : null,
  ));
  return li;
}
/** the small picture of a news in the home's list: the outlet's own photo shown whole, else the field's line symbol on the field's colour (CSS shows it only on the home) */
function rowThumb(e) {
  const f = e.field || '', p = entryPhoto(e);
  const box = h('span', { class: `rth${p ? '' : ' none'}`, data: { genre: f }, 'aria-hidden': 'true' });
  if (p) box.append(h('img', { src: p.url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', on: { error: (ev) => { box.classList.add('none'); ev.target.replaceWith(genreIcon(f)); } } }));
  else box.append(genreIcon(f));
  return box;
}
// "new in the last six hours" is counted when the data was built: an old build must not say it as if it were now
const newsFresh = () => !isOld(state.data.generated_at, nowS());
const measureOf = (e) => e.fig || (e.fig = measure(e, { order: TYPE_ORDER }));
const dossier = createDossier({ h, s, extLink, safeUrl, fmtClock, fmtSpan, lineIcon });
const coverage = createCoverage({ h });
/** 媒体の比べ（CONTRACT §21）: the card of an event, or null when the case has none (an old file, a failed read) — then the screen is as it was */
const coverageCard = (e) => { const c = e && e.case ? coverageOf(e.case.coverage) : null; return c ? coverage.node(c) : null; };
/** バイアス度 of an event (js/bias.js): held against the outlets this build collected; the AI's term only when the AI wrote its focus lines */
const biasOf = (e) => { if (e.bias) return e.bias; const a = new Map(e.ai ? arr(e.ai.angles).filter(isObj).map((x) => [x.item_id, str(x.focus_ja)]) : []); e.bias = biasIndex(measureOf(e), { base: sourceBase(arr(state.data && state.data.sources)), angles: a.size ? a : null }); return e.bias; };
/** a pressed row opens in place: the whole headline, the description the outlet published (quoted), and the way to the article */
function rowMore(e) {
  const sorted = [...e.members].sort((a, b) => (isNum(a.ts) ? a.ts : Infinity) - (isNum(b.ts) ? b.ts : Infinity));
  const withDesc = sorted.find((it) => typeof it.desc === 'string' && it.desc.trim()) || null;
  const first = withDesc || sorted[0];
  const link = first ? safeUrl(first.link) : null;
  const stop = (ev) => ev.stopPropagation();
  const others = e.members.length - 1;
  return h('div', { class: 'r-more', on: { click: stop } },
    e.heading.ai && first && str(first.title) ? h('p', { class: 'r-orig', lang: first.lang === 'en' ? 'en' : null, text: `「${first.title}」（${outletOf(first)}）` }) : null,
    withDesc ? descOf(withDesc, safeUrl(withDesc.link)) : null,
    h('div', { class: 'r-go' },
      link ? extLink(link, { class: 'r-a', on: { click: stop } }, `${outletOf(first) || hostOf(link)} の記事を開く`) : null,
      others > 0 ? lk(`他の ${others} 件を見る`, () => { goMembers(); }, 'この出来事の全報道を見る', 'r-a') : null));
}
function pressRow(key) {
  const was = state.openRow === key;
  select(key, true);
  key = state.sel;
  state.openRow = was ? null : key;
  for (const el of document.querySelectorAll('.rows .r.open')) { el.classList.remove('open'); const m = el.querySelector('.r-more'); if (m) m.remove(); }
  if (!state.openRow) return;
  const e = state.byKey.get(key);
  for (const el of document.querySelectorAll(`.rows .r[data-key="${CSS.escape(key)}"]`)) { el.classList.add('open'); el.append(rowMore(e)); }
}
/** to the list of every report of the event in focus */
function goMembers() {
  if (!state.sheet && (state.sect !== 'home' || $('board').dataset.wall === '1')) openSheet('case');
  const el = document.querySelector(state.sheet ? '.dsheet .cb-members' : '#case .cb-members');
  if (el) el.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
}
/** the search box takes a word from anywhere on the board; the lists narrow to it */
function searchFor(w) {
  const t = String(w || '').trim();
  if (!t) return;
  if (state.sheet) closeSheet();
  $('q').value = t;
  if (t !== state.q) state.qf = { ...state.qf, outlet: '' };
  state.q = t;
  pause();
  if (state.floor && state.floor.mode() === 'map' && !state.mapPick) state.mapScope = 'pri';
  renderPri(); renderAnom(); renderFields();
  const p = $('p-pri');
  if (p && (narrow() || !p.offsetParent)) p.scrollIntoView({ block: 'start' });
  else if ($('pri-b')) $('pri-b').scrollTop = 0;
}
/** the search narrowed: when, which side, which outlet, and the order (js/newsdesk.js) */
function qBar() {
  const f = state.qf, set = (k, v) => { state.qf = { ...state.qf, [k]: v }; renderPri(); renderAnom(); };
  const seg = (k, label, opts) => h('div', { class: 'qf-g', role: 'group', 'aria-label': label }, h('span', { class: 'qf-l', text: label }),
    opts.map(([v, ja]) => h('button', { type: 'button', class: 'qf-b', 'aria-pressed': String(f[k] === v), on: { click: (ev) => { ev.stopPropagation(); set(k, v); } } }, ja)));
  const outs = outletsOf(state.es.filter((e) => !e.foldedInto && matchesQ(e)), outletOf).slice(0, 120);
  const sel = h('select', { class: 'qf-s', 'aria-label': 'メディア', on: { change: (ev) => set('outlet', ev.target.value) } },
    h('option', { value: '' }, 'すべてのメディア'), outs.map((o) => h('option', { value: o.name, selected: f.outlet === o.name ? true : null, data: { raw: '1' } }, `${o.name}（${o.n}）`)));
  return h('div', { class: 'qf' }, seg('span', '期間', SPANS), seg('side', '側', SEARCH_SIDES), h('div', { class: 'qf-g' }, h('span', { class: 'qf-l', text: 'メディア' }), sel), seg('sort', '並べ替え', SORTS));
}
function clearSearch() { $('q').value = ''; state.q = ''; state.qf = { ...QF0 }; renderPri(); renderAnom(); renderFields(); paintCmdBtn(); }
/** the field icons: at the head of the priority list (PC), as a strip above the board (phones), and in the simple view */
function genreEl() {
  return genreBar({ fields: [...FIELDS, OTHER_FIELD], counts: genreCounts(state.pri), total: state.pri.length, active: state.genre, onPick: setGenre });
}
function renderGenres() {
  const c = genreCounts(state.pri), key = `${state.genre}|${state.pri.length}|${[...c].join()}`;
  if (key === state.genreKey) return;
  state.genreKey = key;
  $('pri-genres').replaceChildren(genreEl());
  $('genre-strip').replaceChildren(genreEl());
}
function setGenre(g) {
  state.genre = g;
  if (g !== GENRE_ALL && state.fieldTabs.includes(g)) { state.field = g; state.fieldAt = Date.now(); }
  renderPri(); renderAnom(); renderFields(); renderEntryView();
  const c = cur(), f = shownPri().find((e) => !e.hid);
  const hold = state.map && state.floor && state.floor.mode() !== 'case';     // the whole map is being read: a theme colours it, the view stays
  if (hold) state.map.pin(true);
  if (f && (!c || !inGenre(c))) select(f.key, false);
  if (hold) state.map.pin(false);
  if (state.mapUi) state.mapUi.update();
  return true;
}
function priChips() {
  const pri = state.pri;
  const n = new Map(TOPICS.map((t) => [t.id, pri.filter((e) => e.topics.includes(t.id)).length]));
  const chips = [['all', '全て', pri.length], ...TOPICS.map((t) => [t.id, flagJa(t.id), n.get(t.id)])];
  if (state.watch.length) chips.push(['watch', 'フォロー', pri.filter((e) => e.hits.length).length]);
  chips.push(['cross', '国内と海外', state.es.filter((e) => !e.foldedInto && e.cover === 'both').length]);
  return chips.map(([id, ja, c]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(!state.q && state.topic === id), disabled: state.q ? true : null, on: { click: () => setTopic(id) } }, ja, h('span', { class: 'n', text: c })));
}
function renderPri() {
  renderGenres();
  $('pri-chips').replaceChildren(...priChips());
  const list = shownPri();
  $('pri-h').textContent = state.q ? '検索' : state.topic === 'cross' ? '国内と海外' : narrow() ? '今日の注目ニュース' : '注目ニュース';
  roll($('pri-c'), list.length);
  paintHomeSub(list.length);
  const qOut = state.q ? [h('p', { class: 'q-out' }, h('span', { text: `「${state.q}」で探している` }), lk('解除', clearSearch, '検索をやめて全部に戻す', 'r-a')), qBar()] : null;
  const fold = narrow() && !state.priAll && !state.q && list.length > 5;
  const showN = fold ? list.slice(0, 5) : list;
  $('pri-b').replaceChildren(qOut, showN.length ? h('ul', { class: 'rows' }, showN.map((e) => row(e, { thumb: true }))) : h('p', { class: 'empty', text: state.q ? '一致 0 件' : '0 件' }),
    fold ? h('button', { type: 'button', class: 'more', on: { click: () => { state.priAll = true; renderPri(); } } }, `残り ${list.length - 5} 件`) : null,
    h('p', { class: 'pfoot legend', text: `ラベルは${FLAG_LEGEND}` }));
  syncAutoLine();
  renderMapNews();
  if (state.vwNow) { renderWall(); renderViewBar(); }
  if (state.sect === 'news') renderSect();
}
function anomRows() {
  const es = state.es.filter((e) => !e.foldedInto && matchesQ(e) && vis(e));
  const b = state.board;
  const rows = [];
  const labels = b && isObj(b.asym_labels) ? b.asym_labels : {};
  if (b && Array.isArray(b.asymmetry)) {
    const byCase = new Map();
    for (const e of es) if (e.case && !e.foldedInto && !byCase.has(e.case.sid)) byCase.set(e.case.sid, e);
    for (const a of b.asymmetry) {
      const e = isObj(a) && byCase.get(a.sid);
      const L = isObj(a) && labels[a.kind];
      const ja = isObj(a) ? str(a.label_ja) || (isObj(L) ? str(L.ja) : '') : '';
      if (e && ja) rows.push({ e, k: a.kind, ja: plainWord(ja), tip: ruleJa(a.kind, isObj(L) ? plainWord(L.rule) : '') });
    }
  }
  if (!(b && Array.isArray(b.asymmetry))) for (const e of es) for (const f of e.ruleFlags) { const t = flagText(f); if (t) rows.push({ e, k: 'rule-' + f, ja: t.ja, tip: t.tip }); }
  return rows;
}
/** the news of one side only (js/sections.js), on what the visitor's settings and search show */
function sideGroups(byGenre) { return oneSideOf(state.es.filter((e) => !e.foldedInto && vis(e) && matchesQ(e) && (!byGenre || inGenre(e))), { sidesOf, outletOf }); }
function renderAnom() {
  const rows = anomRows().filter((r) => !r || !r.e || inGenre(r.e));
  const by = new Map();
  for (const r of rows) by.set(r.ja, (by.get(r.ja) || 0) + 1);
  const ca = counts() && isObj(counts().asymmetric) ? counts().asymmetric : null;
  if (!state.q && ca && isNum(ca.shown)) $('anom-c').textContent = isNum(ca.total) && ca.total !== ca.shown ? `${fmtN(ca.shown)} / ${fmtN(ca.total)}` : fmtN(ca.shown);
  else roll($('anom-c'), rows.length);
  const ast = state.board && isObj(state.board.asym_status) ? state.board.asym_status : null;
  const groups = sideGroups(true), sk = (g) => 'side-' + g.side;
  if (state.anomKind && !by.has(state.anomKind) && !groups.some((g) => sk(g) === state.anomKind)) state.anomKind = null;
  const kindBtn = (k, n, label, side) => h('button', { type: 'button', class: side ? 'ak side' : 'ak', data: side ? { side } : null, 'aria-pressed': String(state.anomKind === k),
    on: { click: () => { state.anomKind = state.anomKind === k ? null : k; renderAnom(); } } }, h('span', { class: 'akn num', text: n }), h('span', { class: 'akl' }, side ? lineIcon(side) : null, label));
  $('anom-sum').replaceChildren(...groups.map((g) => kindBtn(sk(g), g.events.length, g.short, g.side)), ...[...by.entries()].map(([k, n]) => kindBtn(k, n, k)));
  const g = groups.find((x) => sk(x) === state.anomKind);
  if (g) {
    $('anom-b').replaceChildren(h('p', { class: 'anom-rule', title: ONE_SIDE_NOTE, text: `${g.rule}。` }), h('ul', { class: 'rows' }, g.events.slice(0, 80).map((e) => row(e, { flag: { ja: g.short, tip: g.rule } }))));
    return;
  }
  const shown = state.anomKind ? rows.filter((r) => r.ja === state.anomKind) : rows;
  const ruleNow = state.anomKind && shown[0] ? shown[0].tip : '';
  $('anom-b').replaceChildren(...(ruleNow ? [h('p', { class: 'anom-rule', text: `${ruleNow}。` })] : []), shown.length
    ? h('ul', { class: 'rows' }, shown.slice(0, 80).map((r) => row(r.e, { flag: { ja: r.ja, tip: `自動・${r.tip}${r.tip ? '。' : ''}${noteJa()}` } })))
    : h('p', { class: 'empty', text: ast && ast.complete === false ? '主な媒体の一部が取れず、今回はラベルを付けない' : '0 件' }), h('p', { class: 'pfoot', text: `自動のラベル・${noteJa()}` }));
}
// ---------------------------------------------------------------- the event taken apart
function lanes(e) {
  const ms = e.members.filter((it) => isNum(it.ts));
  const types = TYPE_ORDER.filter((t) => ms.some((it) => it.type === t));
  for (const it of ms) if (!types.includes(it.type)) types.push(it.type);
  if (!ms.length) return h('p', { class: 'tl-none', text: '時刻の無い報道だけ' });
  const t0 = Math.min(...ms.map((it) => it.ts)), t1 = Math.max(...ms.map((it) => it.ts));
  const span = Math.max(3600, t1 - t0);
  const W = 260, LH = 13, L = 62, H = types.length * LH + 13, STEP = 6;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lanes', role: 'img', 'aria-label': '種類ごとの報道の時刻' });
  types.forEach((t, i) => {
    const y = i * LH + LH / 2;
    svg.append(s('text', { x: 0, y: y + 3, class: 'lt' }, document.createTextNode(t)));
    for (let x = L; x <= W - 4; x += STEP) svg.append(s('circle', { cx: x, cy: y, r: .7, class: 'hd' }));
  });
  // the fingerprint: for each type, the span from its first to its last report (who followed, and how late)
  const fp = e.exact && Array.isArray(e.case.fingerprint) ? e.case.fingerprint.filter(isObj) : [];
  for (const f of fp) {
    const i = types.indexOf(f.type);
    if (i < 0 || !isNum(f.first_off_min) || !isNum(f.last_off_min)) continue;
    const x0 = L + ((f.first_off_min * 60) / span) * (W - L - 6), x1 = L + ((f.last_off_min * 60) / span) * (W - L - 6);
    svg.append(s('rect', { x: x0.toFixed(1), y: i * LH + LH / 2 - 1, width: Math.max(1, x1 - x0).toFixed(1), height: 2, class: 'fp' }));
  }
  const used = new Map();
  [...ms].sort((a, b) => a.ts - b.ts).forEach((it, i) => {
    const li = types.indexOf(it.type);
    const x0 = L + ((it.ts - t0) / span) * (W - L - 6);
    const k = `${li}:${Math.round(x0 / 3)}`; const off = (used.get(k) || 0); used.set(k, off + 1);
    const side = it.type === GOV ? 'gov' : it.home === 'intl' ? 'intl' : 'jp';
    const dot = s('circle', { cx: (x0 + off * 3).toFixed(1), cy: li * LH + LH / 2, r: i === 0 ? 3.6 : 2.6, class: i === 0 ? 'first' : 'lit', 'data-side': side },
      s('title', {}, document.createTextNode(`${fmtClock(it.ts)} ${outletOf(it)}`)));
    const link = safeUrl(it.link);
    svg.append(link ? s('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, dot) : dot);
  });
  svg.append(s('text', { x: L, y: H - 2, class: 'ax' }, document.createTextNode(fmtClock(t0))), s('text', { x: W, y: H - 2, class: 'ax end' }, document.createTextNode(t1 > t0 ? `+${fmtSpan(t1 - t0)}` : '')));
  const noTs = e.members.length - ms.length;
  return h('div', { class: 'lanes-w' }, svg, noTs ? h('p', { class: 'pfoot', text: `時刻不明 ${noTs}（初報に置かない）` }) : null);
}
/** who reported in each type and how late (the board's by_type when it has the event): the tooltip of the card of kinds of media */
function typeWho(e) {
  const offTxt = (m) => (m < 1 ? '+0分' : m < 60 ? `+${Math.round(m)}分` : `+${(m / 60).toFixed(m < 600 ? 1 : 0)}時間`);
  const out = new Map();
  if (e.exact && Array.isArray(e.case.by_type) && e.case.by_type.length) {
    for (const r of e.case.by_type.filter(isObj)) out.set(str(r.type), arr(r.outlets).filter(isObj).map((o) => `${o.outlet} ${isNum(o.off_min) ? offTxt(o.off_min) : '時刻不明'}`));
    return out;
  }
  const t0 = Math.min(...e.members.map((it) => it.ts).filter(isNum));
  for (const it of [...e.members].sort((a, b) => (a.ts || 0) - (b.ts || 0))) {
    const l = out.get(it.type) || [];
    l.push(isNum(it.ts) && Number.isFinite(t0) ? `${outletOf(it)} ${offTxt((it.ts - t0) / 60)}` : `${outletOf(it)} 時刻不明`);
    out.set(it.type, l);
  }
  return out;
}
/** the related headlines of this fetch: other events that share two of this one's words (the words it was bundled by, the
 *  board's key terms, the words it was found by), or stand at the same named place (a country's representative point is not one) */
function related(e) {
  const words = uniq([...(e.basis ? arr(e.basis.words) : []), ...(e.case ? arr(e.case.key_terms) : []), ...(e.case ? arr(e.case.hits) : [])])
    .filter((w) => typeof w === 'string' && w.length >= 2);
  const out = [];
  for (const o of state.es) {
    if (o === e || o.hid || o.foldedInto) continue;
    const shared = words.filter((w) => o.hay.includes(w));
    const place = !!(e.geo && o.geo && !e.geo.country && o.geo.key === e.geo.key);
    if (shared.length >= 2 || place) out.push({ o, shared, place });
  }
  return out.sort((x, y) => y.shared.length - x.shared.length || y.o.n - x.o.n || (y.o.last || 0) - (x.o.last || 0)).slice(0, 6);
}
/** under the event: the related headlines of this fetch, and the source of every report, the government's own documents first */
function renderUnder(e, sorted) {
  const rel = related(e);
  $('rel-c').textContent = `${rel.length} 件`;
  $('rel-b').replaceChildren(rel.length ? h('ul', { class: 'rows mini' }, rel.map((x) => h('li', { class: 'r', on: { click: () => select(x.o.key, true) } },
    h('span', { class: 'rt', lang: x.o.heading.lang || null, text: x.o.heading.text }),
    h('span', { class: 'rm', text: [`${x.o.n}社`, isNum(x.o.last) ? fmtClock(x.o.last) : '', x.shared.slice(0, 3).join('・'), x.place ? `同じ地点 ${x.o.geo.name}` : ''].filter(Boolean).join(' · ') }))))
    : h('p', { class: 'empty', text: '0 件（今回集めた中）' }));
  const gov = sorted.filter((it) => str(it.type) === GOV);
  const src = (it) => {
    const link = safeUrl(it.link);
    return h('li', null, h('b', { text: outletOf(it) || '—' }), h('span', { class: 'sk', text: `${str(it.type)}${it.home === 'intl' ? '・海外' : ''}` }),
      link ? extLink(link, { class: 'sh' }, hostOf(link)) : h('span', { class: 'sh', text: '—' }));
  };
  $('basis-c').textContent = `${new Set(sorted.map(outletOf).filter(Boolean)).size}社`;
  $('basis-b').replaceChildren(
    h('h4', null, '官公庁の一次資料', h('span', { class: 'n', text: ` ${gov.length}` })),
    gov.length ? h('ul', { class: 'srcs' }, gov.map(src)) : h('p', { class: 'empty', text: '0 件（この出来事の中）' }),
    h('h4', null, '全報道の出典', h('span', { class: 'n', text: ` ${sorted.length}` })),
    h('ul', { class: 'srcs' }, sorted.map(src)));
}
/** the feed's own description of a report (CONTRACT 14.1), quoted: never the article's body, never rewritten */
function descOf(it, link) {
  const d = typeof it.desc === 'string' ? it.desc.trim() : '';
  if (!d) return null;
  return h('blockquote', { class: 'mq', cite: link || null, lang: it.lang === 'en' ? 'en' : null },
    h('p', { text: `「${d}」` }),
    h('footer', null, outletOf(it), isNum(it.ts) ? ` · ${fmtClock(it.ts)}` : '', link ? [' · ', extLink(link, { class: 'mq-o' }, '原文を開く')] : null));
}
function histNote() {
  const hs = state.hist;
  if (!isObj(hs)) return '記録を読めない';
  return `記録 ${isNum(hs.n) ? hs.n : arr(hs.entries).length} 件・${isNum(hs.days) ? hs.days : 30} 日分まで・${fmtShort(hs.updated_at)} 更新`;
}
// ---------------------------------------------------------------- the viewer's own AI (js/ownai.js): a button to connect until one is connected, then the three asks
const ownActive = () => activeOwnAI(state.own, defaultModel);
const ownSig = () => { const a = ownActive(); return a ? `${a.kind}|${a.model}` : ''; };
const askStore = () => (state.askCache || (state.askCache = askCache(store)));
/** what the AI is given: the heading and, for each outlet once and by the clock, the headline and description the page itself shows */
function ownEvent(e) {
  const seen = new Set();
  const items = [...e.members].sort((a, b) => (isNum(a.ts) ? a.ts : Infinity) - (isNum(b.ts) ? b.ts : Infinity))
    .filter((it) => { const o = outletOf(it); if (seen.has(o)) return false; seen.add(o); return true; })
    .map((it) => ({ outlet: outletOf(it), title: str(it.title), desc: str(it.desc) }));
  return { heading: e.heading.text, items };
}
function paintOwn(box, e) {
  const a = ownActive(), st = state.ownAsk.get(e.key) || null;
  box.hidden = false;
  if (!a) {
    box.replaceChildren(h('div', { class: 'ch-own' }, h('button', { type: 'button', class: 'tbb', data: { f: 'own-connect' }, on: { click: () => openConnect() } }, '自分の AI につなぐ')));
    return;
  }
  const busy = !!(st && st.busy);
  const qIn = h('input', { type: 'text', class: 'set-in own-q', maxlength: String(QUESTION_MAX), placeholder: '質問', 'aria-label': 'このニュースへの質問', autocomplete: 'off', data: { f: 'own-q' } });
  if (st && st.mode === 'question' && st.question) qIn.value = st.question;
  const go = (mode) => askOwn(e, mode, mode === 'question' ? qIn.value : '');
  qIn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); go('question'); } });
  const btn = (mode, label) => h('button', { type: 'button', class: 'tbb', data: { f: `own-${mode}` }, disabled: busy ? true : null, on: { click: () => go(mode) } }, label);
  const out = [h('div', { class: 'ch-own' }, btn('brief', '要約'), btn('compare', '違いを見る'), h('span', { class: 'own-qf' }, qIn, btn('question', '聞く')),
    busy ? h('span', { class: 'ch-own-s', role: 'status', text: '聞いています…' }) : null,
    st && st.err ? h('span', { class: 'ch-own-m', role: 'status', text: errJa(st.err) }) : null)];
  if (st && st.lines && st.lines.length) {
    out.push(h('ol', { class: 'ch-own-l' }, st.lines.map((l) => h('li', { text: l }))),
      h('p', { class: 'ainote' }, h('span', { class: 'aimk', text: 'AI' }), `${MODE_JA[st.mode] || ''}・${st.by}${isNum(st.at) ? `・${fmtShort(st.at)}` : ''}${st.cached ? '・控えの答え' : ''}・${ASK_NOTE}`));
  }
  box.replaceChildren(...out);
}
const ownBox = (e) => { const box = h('div', { class: 'ch-ownbox', data: { k: e.key } }); paintOwn(box, e); return box; };
function repaintOwn(e) { for (const box of document.querySelectorAll('.ch-ownbox')) if (box.dataset.k === String(e.key)) paintOwn(box, e); }
async function askOwn(e, mode, question) {
  const a = ownActive(), prev = state.ownAsk.get(e.key);
  if (!a || (prev && prev.busy)) return;
  if (mode === 'question' && !String(question).trim()) { state.ownAsk.set(e.key, { busy: false, mode, question: '', lines: [], err: 'noquestion' }); repaintOwn(e); return; }
  state.ownAsk.set(e.key, { busy: true, mode, question });
  repaintOwn(e);
  let res;
  try { res = await askOwnAI(makeProvider(a.kind, a.key, a.model, { retries: 1, timeoutMs: 45000 }), ownEvent(e), { mode, question, cache: askStore(), eventKey: String(e.key) }); } catch (err) { res = { lines: [], err: (err && err.code) || 'network' }; }
  state.ownAsk.set(e.key, { busy: false, mode, question, lines: res.lines, err: res.err, cached: !!res.cached, by: `${a.ja} · ${a.model}`, at: nowS() });
  repaintOwn(e);
}
/** the choice is kept apart from the settings; the board is drawn again only when what is asked of changes */
function setOwnAI(c) {
  const before = ownSig();
  state.own = cleanOwnAI(c);
  const ok = saveOwnAI(store, state.own);
  if (ownSig() !== before && state.data) renderAll();
  paintOwnBtn();
  if (state.connect && state.connect.isOpen()) state.connect.render();
  if (!ownActive()) askStore().clear();
  return ok;
}
function paintOwnBtn() {
  const b = $('own-btn'), a = ownActive();
  if (!b) return;
  b.classList.toggle('on', !!a);
  const t = a ? `自分の AI（${a.ja}・つながっています）` : '自分の AI につなぐ';
  b.title = t; b.setAttribute('aria-label', t);
}
function openConnect() {
  if (!state.connect) return false;
  if (state.sheet) closeSheet();
  if (state.about) closeAbout();
  pause();
  state.connect.open();
  return true;
}
async function ownTest() {
  const a = ownActive();
  if (!a) return { ok: false, err: 'nokey' };
  try { return await testOwnAI(makeProvider(a.kind, a.key, a.model, { retries: 0, timeoutMs: 20000 })); } catch (err) { return { ok: false, err: (err && err.code) || 'network' }; }
}
/** log in with OpenRouter: the page leaves for openrouter.ai and comes back with ?code=… (js/login.js) */
async function startOwnLogin() {
  const say = (t, err) => { if (state.connect) state.connect.say(t, err); };
  let ss = null;
  try { ss = window.sessionStorage; } catch { ss = null; }
  if (!ss) { say('ログインを始められません。このブラウザは一時保存を許していません', true); return; }
  try {
    const { url } = await beginLogin({ session: ss, location: window.location, crypto: window.crypto });
    window.location.assign(url);
  } catch { say('ログインを始められませんでした', true); }
}
/** a page opened with ?code=… is the way back from OpenRouter: trade the code for the viewer's key, then clean the address */
async function resumeLogin() {
  if (!/[?&]code=/.test(location.search)) return;
  let ss = null;
  try { ss = window.sessionStorage; } catch { ss = null; }
  const ret = ss ? readReturn(location.search, ss) : { err: 'none' };
  try { history.replaceState(history.state, '', cleanedUrl(location.href)); } catch { /* the address stays as it is */ }
  if (ss) clearPending(ss);
  if (!ret) return;
  if (ret.err) { toast(errJa(ret.err)); return; }
  toast('OpenRouter に接続しています');
  const r = await finishLogin(ret);
  if (r.err) { toast(errJa(r.err)); return; }
  const c = cleanOwnAI(state.own);
  c.kind = 'openrouter'; c.keys.openrouter = r.key;
  const ok = setOwnAI(c);
  openConnect();
  if (state.connect) state.connect.say(ok ? 'OpenRouter につながりました' : 'つながりましたが、このブラウザには保存できません。このタブを閉じるまでは使えます', !ok);
}

/** the photos of an event: the one the board chose (CONTRACT 20.5) first, then each report that carries one, by the clock */
function picsOf(e) {
  const sorted = [...e.members].sort((a, b) => (isNum(a.ts) ? a.ts : Infinity) - (isNum(b.ts) ? b.ts : Infinity));
  const ph = e.case && isObj(e.case.photo) ? e.case.photo : null;
  const phUrl = ph ? safeImg(ph.url) : null;
  const phIt = ph ? ctx().ix.items[ph.id] || state.ix.items[ph.id] || {} : {};
  const pics = phUrl ? [{ url: phUrl, outlet: str(ph.outlet), link: safeUrl(phIt.link), ts: phIt.ts, via: viaGN(phIt) }] : [];
  for (const it of sorted) { const im = imageOf(it); if (im && !pics.some((p) => p.url === im.url)) pics.push({ ...im, via: viaGN(it) }); }
  return pics;
}
function renderCase() {
  const box = $('case');
  const e = cur();
  if (!e) { box.replaceChildren(h('p', { class: 'empty big', text: state.es.length ? '出来事を選ぶ' : '出来事 0 件' })); renderStatus(); return; }
  const node = caseNode(e);
  box.replaceChildren(node);
  box.scrollTop = 0;
  renderUnder(e, [...e.members].sort((a, b) => (isNum(a.ts) ? a.ts : Infinity) - (isNum(b.ts) ? b.ts : Infinity)));
  if (!reduced()) { node.classList.add('enter'); }
  renderStatus();
  renderTasks();
}
function caseNode(e) {
  const ms = e.members;
  const m = measureOf(e);
  const first = [...ms].filter((it) => isNum(it.ts)).sort((a, b) => a.ts - b.ts)[0] || ms[0];
  const run = isObj(state.data.ai_run) ? state.data.ai_run : {};
  const kept = state.snap ? state.snap.kept : null;
  const aiBy = kept ? [str(kept.snapRun.provider), str(kept.snapRun.model)] : [str(run.provider), str(run.model)];
  const aiAt = kept ? kept.aiAt : run.at;
  const aiTag = (by, at) => { const b = by.filter(Boolean); return h('span', { class: 'by', title: b.join(' ') || null }, h('span', { class: 'aimk', text: 'AI' }), b[b.length - 1] || '—', isNum(at) ? `・${fmtShort(at)}` : ''); };
  // what a number or a word on these cards goes to: the list of reports narrowed, the search, or the outlets not seen
  let paintMem = () => {};
  const act = { home: (id) => paintMem({ home: id }), type: (ty) => paintMem({ type: ty }), all: () => paintMem({}), word: searchFor,
    absent: () => { const a = members.querySelector('.cb-absent'); if (a) a.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); } };

  // the place card: where (the flag: the place, else the field), from which word the place was read, what, one big number
  const coord = e.geo ? `${Math.abs(e.geo.lat).toFixed(1)}°${e.geo.lat >= 0 ? 'N' : 'S'} ${Math.abs(e.geo.lon).toFixed(1)}°${e.geo.lon >= 0 ? 'E' : 'W'}` : '';
  const place = h('div', { class: 'ch-place' },
    e.geo ? lk(e.geo.name, () => searchFor(e.geo.name), `${e.geo.name} の出来事を探す`, 'banner') : h('span', { class: 'banner soft', text: e.field || '分野の外' }),
    e.geo ? h('span', { class: 'prec', text: `${e.geo.prec} · 「${e.geo.via}」から${e.geo.guessed ? '推定' : ''}` }) : h('span', { class: 'prec', text: '地名なし' }),
    coord && state.floor && state.floor.mode() !== 'flat' ? lk(coord, () => state.floor.setMode('map'), '地図で見る', 'coord') : null);
  // the tools of the card: their own row under the headline (the home hides them)
  const tools = h('div', { class: 'ch-tools' },
      e.topics.length ? h('span', { class: 'tp' }, e.topics.map((id, i) => [i ? '・' : '', lk(flagJa(id), () => setTopic(id), `${flagJa(id)} の出来事だけ見る`)])) : null,
      e.field ? lk(e.field, () => setGenre(e.field), `${e.field} の出来事だけ見る`, 'fd', { genre: e.field }) : null,
      h('button', { type: 'button', class: 'addtask', 'aria-pressed': String(hasTask(state.tasks, saveId(e))), on: { click: () => toggleSave(e) } }, hasTask(state.tasks, saveId(e)) ? '保存済み' : '保存'),
      h('button', { type: 'button', class: 'addtask share', on: { click: () => shareEvent(e) } }, '共有'),
      h('button', { type: 'button', class: 'addtask share img', on: { click: () => shareImage(e) } }, '画像で共有'),
      speakBtn(e, 'tool'),
      extLink(`${ISSUES}/new?title=${encodeURIComponent('掲載の停止の依頼')}`, { class: 'stopreq', title: STOP_NOTE }, '掲載の停止'));
  const head = h('div', { class: 'ch-main' },
    h('div', { class: 'ch-title' },
      h('h1', { lang: e.heading.lang || null, class: e.heading.none ? 'none' : null }, headNode(e, 'h1t')),
      e.heading.en ? h('p', { class: 'en', lang: 'en', text: e.heading.en }) : null,
      h('div', { class: 'ch-ratio' }, dossier.ratioBar(measureOf(e)), h('p', { class: 'ch-rn' }, SIDES.map(([k, , short]) => h('span', { class: 'rn-i', data: { side: k } }, h('i'), short, h('b', { class: 'num', text: arr(measureOf(e)[k]).length }))))),
      h('button', { type: 'button', class: 'home-open', on: { click: () => { setHome('board'); act.all(); } } }, '詳しく見る')),
    h('button', { type: 'button', class: 'ch-big', title: 'すべての報道を見る', on: { click: () => { setHome('board'); act.all(); } } }, num(e.n), h('span', { class: 'u', text: '社が報道' })));
  const aiLines = [];
  if (e.brief) aiLines.push(briefBox(e, aiTag));
  if (e.summary && !e.brief && str(e.summary.text_ja).trim()) aiLines.push(h('p', { class: 'ch-ai' }, h('span', { text: str(e.summary.text_ja) }), aiTag([str(e.summary.provider), str(e.summary.model)], e.summary.made_at)));
  // with a detailed summary the one-line contrast is not shown again (its row, 伝え方の違い, is in the summary)
  if (e.ai && str(e.ai.contrast_ja) && !e.brief) aiLines.push(h('p', { class: 'ch-ai' }, h('span', { text: e.ai.contrast_ja }), aiTag(aiBy, aiAt)));
  if (aiLines.length - (e.brief ? 1 : 0) > 0 || (e.heading.ai && !e.brief)) aiLines.push(h('p', { class: 'ainote', text: AI_NOTE }));

  const sorted = [...ms].sort((a, b) => (isNum(a.ts) ? a.ts : Infinity) - (isNum(b.ts) ? b.ts : Infinity));
  const last = m.last;
  const linkTo = (it, text) => { const u = it ? safeUrl(it.link) : null; return u ? extLink(u, { class: 'lk', title: `${outletOf(it)} の記事を開く` }, text) : h('span', { text }); };
  // the band under the place card: how long since the first report (the bar is the share of the window it has run), and the first and the latest report
  const gen = state.data.generated_at, windowS = (isNum(state.data.window_h) ? state.data.window_h : 36) * 3600;
  const since = isNum(gen) && isNum(e.first) ? Math.max(0, gen - e.first) : null;
  const status = h('div', { class: 't-status' },
    h('b', { class: 'st-k', text: '最初の報道から' }), h('i', { class: 'st-l' }, since != null ? h('i', { style: `width:${Math.min(100, (since / windowS) * 100).toFixed(1)}%` }) : null),
    h('small', { class: 'st-v', text: `${since != null ? fmtSpan(since) : '—'}・${e.n}社` }),
    h('dl', { class: 'facts' },
      h('dt', { text: '最初に報じた' }), h('dd', null, `${fmtClock(first && first.ts)} `, linkTo(first, str(first && outletOf(first)))),
      h('dt', { text: '最新' }), h('dd', null, last ? linkTo(last, fmtClock(last.ts)) : '—'),
      e.event ? [h('dt', { text: '事件' }), h('dd', null, e.event.key, h('span', { class: 'o', text: ` · 束 ${e.event.n}` }))] : null,
      e.case && arr(e.case.hits).length ? [h('dt', { text: '共通する言葉' }), h('dd', { class: 'hits' }, arr(e.case.hits).map((w, i) => [i ? '・' : '', lk(w, () => searchFor(w), `「${w}」で探す`)]))] : null));

  // the sheaf of photos: never cropped; the outlet, the time and the link stay with each; the small arrow brings the next one up
  const pics = picsOf(e);
  const fig = (p) => h('figure', { class: 'pfig' },
    extLink(p.link || '#', { class: 'pimg', title: `${p.outlet} の記事を開く` }, h('img', { src: p.url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer',
      on: { load: (ev) => { const i = ev.target; if (i.naturalWidth && i.naturalWidth < 240) { const d = i.closest('.dos'); if (d) d.classList.add('ph-small'); } }, error: (ev) => { ev.target.closest('figure').classList.add('noimg'); ev.target.replaceWith(h('span', { class: 'pcard', text: p.outlet })); } } })),
    h('figcaption', null, h('b', { text: p.outlet }), p.via ? ' · Google ニュース経由' : '', isNum(p.ts) ? ` ${fmtClock(p.ts)}` : ''));
  let photo = null;
  if (pics.length) {
    let at = 0;
    const count = h('small', { class: 'num' });
    const frame = h('div', { class: 'pstack' });
    const paint = () => {
      const backs = [2, 1].filter((k) => k < pics.length).map((k) => h('span', { class: `pback b${k}` }, h('img', { src: pics[(at + k) % pics.length].url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', on: { error: (ev) => ev.target.remove() } })));
      frame.replaceChildren(...backs, fig(pics[at]));
      count.textContent = `${at + 1} / ${pics.length}`;
    };
    paint();
    photo = h('section', { class: 'dcard t-photo' }, frame, pics.length > 1 ? h('div', { class: 'pnav' }, count, dossier.go('次の写真', () => { at = (at + 1) % pics.length; paint(); })) : null);
  }

  // the small figures, and the two short versions
  const angles = new Map(e.ai ? arr(e.ai.angles).filter(isObj).map((a) => [a.item_id, str(a.focus_ja)]) : []);
  const new6h = newsFresh() && e.exact && isNum(e.case.n_new6h) ? e.case.n_new6h : null;
  const figs = h('div', { class: 'figs' }, dossier.biasTile(biasOf(e), { open: !!state.biasOpen, onToggle: (o) => { state.biasOpen = o; } }), dossier.homeTile(m, act), dossier.typeTile(m, act, typeWho(e)), dossier.timeTile(m, lanes(e), new6h),
    dossier.divergeTile(m, act), dossier.overlapTile(m, act));

  // every report: time, delay from the first, outlet, type, the headline as published, the AI's focus line; narrowed by a press on a card
  const t0 = first && isNum(first.ts) ? first.ts : null;
  const memHead = h('h3'), memList = h('ol', { class: 'mem' });
  const memRow = (it) => {
    const link = safeUrl(it.link);
    const title = typeof it.title === 'string' && it.title.trim() ? it.title : null;
    const name = outletOf(it);
    return h('li', { class: it === first && isNum(it.ts) ? 'first' : null, data: { side: it.type === GOV ? 'gov' : it.home === 'intl' ? 'intl' : 'jp' } },
      h('span', { class: 'mt' }, isNum(it.ts) ? fmtClock(it.ts) : '—', h('small', { text: isNum(it.ts) && t0 != null ? plusH(it.ts - t0) : '時刻不明' })),
      h('span', { class: 'mb' },
        h('span', { class: 'mo' }, name ? lk(h('b', { text: name }), () => openOutlet(name), 'このメディアのページ') : null,
          ' ', str(it.type) ? lk(str(it.type), () => paintMem({ type: it.type }), `${it.type} の報道だけ見る`, 'mty') : null, it.home === 'intl' ? h('span', { text: '・海外' }) : null, viaGN(it) ? h('span', { class: 'via', text: ' · Google ニュース経由' }) : null),
        link ? extLink(link, { class: 'mh', lang: it.lang === 'en' ? 'en' : null }, title ? `「${title}」` : name || hostOf(link)) : h('span', { class: 'mh', text: title ? `「${title}」` : '—' }),
        descOf(it, link),
        angles.get(it.id) ? h('span', { class: 'mf' }, h('span', { class: 'aimk', text: 'AI' }), angles.get(it.id)) : null));
  };
  const members = h('section', { class: 'cb cb-members' }, memHead, memList);
  const sd = sidesOf(e);
  paintMem = (f, quiet) => {
    const list = f && f.home ? sd[f.home] : f && f.type ? sorted.filter((it) => it.type === f.type) : sorted;
    const label = f && f.home ? (SIDES.find(([k]) => k === f.home) || [])[2] : f && f.type ? f.type : '';
    memHead.replaceChildren('全報道', h('span', { class: 'n', text: label ? `${list.length} / ${ms.length}` : ms.length }),
      label ? h('span', { class: 'mem-f' }, h('b', { text: label }), ' だけ ', lk('全部に戻す', () => paintMem({}), '全部の報道に戻す')) : null);
    memList.replaceChildren(...list.map(memRow));
    if (!quiet) members.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
  };
  paintMem({}, true);

  // the outlets whose feeds reach back to the first report and do not show it (js/absent.js); never "did not carry".
  // The related headlines and the sources stand under the event (renderUnder)
  members.append(absentOf(e));

  // the side: the one white paper, labels, why grouped, radius, same words
  const pick = paperPick(ms, e.heading.text);
  const paperCard = pick ? dossier.paper(pick, descOf(pick, safeUrl(pick.link))) : null;
  const flags = e.ruleFlags.map((f) => { const t = flagText(f); return t ? h('li', { class: 'flag-row', title: t.tip }, h('span', { class: 'flag', text: t.ja }), h('span', { class: 'rl', text: '自動' })) : null; });
  const ae = e.case && state.board ? arr(state.board.asymmetry).find((a) => isObj(a) && a.sid === e.case.sid) : null;
  const al = ae && str(ae.label_ja) ? { ja: plainWord(ae.label_ja), rule: str(((state.board.asym_labels || {})[ae.kind] || {}).rule) } : null;
  if (isObj(al)) flags.unshift(h('li', { class: 'flag-row', title: str(al.rule) }, h('span', { class: 'flag', text: str(al.ja) }), h('span', { class: 'rl', text: '自動' })));
  if (e.topics.length) flags.unshift(h('li', { class: 'flag-row' }, h('span', { class: 'tpf', text: e.topics.map(flagJa).join('・') }), h('span', { class: 'rl', text: '自動' })));
  const vetoed = [];   // the AI does not label (A4): what the rules removed from an AI's labels is not shown
  const b = e.basis;
  const wordLinks = (words) => words.map((w, i) => [i ? '、' : '', lk(w, () => searchFor(w), `「${w}」で探す`)]);
  const basis = b ? h('dl', { class: 'kv' },
    h('dt', { text: 'まとめた手' }), h('dd', { text: b.by === 'ai' ? 'AI' : '規則（語の重なり）' }),
    h('dt', { text: '共通の語' }), h('dd', null, arr(b.words).length ? wordLinks(arr(b.words)) : '—'),
    h('dt', { text: '地名' }), h('dd', null, arr(b.places).length ? wordLinks(arr(b.places).map(pj)) : '—'),
    h('dt', { text: '時刻の幅' }), h('dd', { text: fmtSpan(b.time_span) })) : h('p', { class: 'empty', text: ms.length < 2 ? '一つの報道' : '—' });
  const hz = state.haz;
  let radius;
  if (!e.geo) radius = h('p', { class: 'empty', text: '地点なし' });
  else if (e.geo.country) radius = h('p', { class: 'empty', text: '国の代表点では照会しない' });
  else {
    const qs = hz ? nearby(e.geo, hz.quakes, RADIUS_KM) : null;
    const ts = hz ? nearby(e.geo, hz.typhoons.map((t) => ({ ...t, lat: t.center[0], lon: t.center[1] })), RADIUS_KM) : null;
    const ev = nearby(e.geo, state.es.filter((o) => o !== e && o.geo && !o.geo.country).map((o) => ({ o, lat: o.geo.lat, lon: o.geo.lon })), RADIUS_KM);
    radius = h('div', null,
      h('dl', { class: 'kv' },
        h('dt', { text: '地震' }), h('dd', { text: qs ? `${qs.length} / ${hz.quakes.length}` : '—' }),
        h('dt', { text: '台風' }), h('dd', { text: ts ? `${ts.length} / ${hz.typhoons.length}` : '—' }),
        h('dt', { text: '他の出来事' }), h('dd', { text: `${ev.length}` })),
      h('ul', { class: 'near' }, [...(qs || []).slice(0, 3).map((x) => h('li', null, `M${x.x.mag.toFixed(1)} ${x.x.shindo ? `震度${shindoJa(x.x.shindo)} ` : ''}${x.x.place} · ${Math.round(x.d)} km ${dir8(x.b)}`)),
        ...(ts || []).map((x) => h('li', { class: 'hot' }, `台風 ${x.x.name} · ${Math.round(x.d)} km ${dir8(x.b)}`))]));
  }
  const lin = e.exact && Array.isArray(e.case.lineage) ? e.case.lineage.filter(isObj) : null;
  const terms = e.case ? arr(e.case.key_terms).filter((x) => typeof x === 'string') : [];
  const side = h('section', { class: 'cb cb-side' },
    paperCard,
    flags.filter(Boolean).length || vetoed.filter(Boolean).length ? h('h3', null, 'ラベル', h('span', { class: 'n', text: noteJa() })) : null,
    flags.filter(Boolean).length || vetoed.filter(Boolean).length ? h('ul', { class: 'flags' }, flags, vetoed) : null,
    h('h3', null, 'まとめた理由'), basis,
    terms.length ? h('p', { class: 'terms' }, h('span', { class: 'k', text: '鍵語' }), wordLinks(terms)) : null,
    h('h3', null, `半径 ${RADIUS_KM} km`), radius,
    lin ? h('h3', null, '系譜', h('span', { class: 'n', text: lin.length })) : null,
    lin ? (lin.length ? h('ul', { class: 'near' }, lin.map((x) => h('li', null, `${fmtShort(x.first_ts)}〜${fmtShort(x.last_ts)} · ${x.n_outlets}社 · ${arr(x.shared).join('・')}`)))
      : h('p', { class: 'empty', text: `0 件（${histNote()}）` })) : null);

  // the story (js/story.js): the point, how it went, each side's headlines, the sources; the same reports in the order of a story
  const SHORT = Object.fromEntries(SIDES.map(([k, , short]) => [k, short]));
  const toOutlet = (name) => h('button', { type: 'button', class: 'en-mo', title: 'このメディアのページ', on: { click: () => openOutlet(name) } }, name);
  const stH = (id, ja, n) => h('h3', { class: 'st-h', data: { st: id } }, ja, n != null ? h('span', { class: 'n', text: n }) : null);
  const jump = (id) => { const t = node.querySelector(`.st-h[data-st="${id}"]`); if (t) t.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); };
  const covNode = coverageCard(e);
  const nav = h('nav', { class: 'st-nav', 'aria-label': 'このニュースの詳しい節' }, STORY.filter(([id]) => id !== 'pt' && (id !== 'cv' || covNode)).map(([id, ja]) => h('button', { type: 'button', on: { click: () => jump(id) } }, ja)));
  const fl = firstLine(sd, fmtClock);
  // the first report of each side, on the first screen: who said it, when, and the headline as published
  const repSides = SIDES.filter(([k]) => sd[k].length);
  const reps = repSides.length >= 2 ? h('section', { class: 'dcard t-reps', 'aria-label': '各側の最初の見出し' }, repSides.map(([k, , short]) => {
    const it = sd[k].find((x) => str(x.title).trim()) || sd[k][0], t = str(it.title).trim();
    return h('div', { class: 'rp', data: { side: k } },
      h('span', { class: 'rp-k' }, h('i', { 'aria-hidden': 'true' }), short, h('b', { class: 'num', text: sd[k].length })),
      h('span', { class: 'rp-m' }, outletOf(it) || short, isNum(it.ts) ? h('time', { class: 'num', text: fmtClock(it.ts) }) : null),
      h('span', { class: 'rp-h', lang: it.lang === 'en' ? 'en' : null }, linkTo(it, t ? `「${t}」` : outletOf(it) || '—')));
  })) : null;
  // the point: the AI's lines (the detailed summary, or the short ones), else the first line of the reports; the viewer's own AI (connect, or the asks) is the last row of the card
  const point = h('div', { class: 't-ai' }, aiLines.length ? aiLines : fl ? h('p', { class: 'st-fl', text: fl }) : null, ownBox(e));
  const tl = timeline(ms);
  const t1 = tl.length && isNum(tl[0].it.ts) ? tl[0].it.ts : null;
  const days = t1 != null && tl.some((r) => isNum(r.it.ts) && r.it.ts - t1 > 18 * 3600);
  const tlRow = (r) => {
    const it = r.it, link = safeUrl(it.link), t = str(it.title).trim(), name = outletOf(it);
    return h('li', { class: r.gap ? 'gap' : null, data: { side: r.side } },
      h('span', { class: 'tl-t num' }, isNum(it.ts) ? (days ? fmtShort(it.ts) : fmtClock(it.ts)) : '—', r.off ? h('small', { text: plusH(r.off) }) : null),
      h('span', { class: 'tl-ax', 'aria-hidden': 'true' }),
      h('span', { class: 'tl-b' },
        h('span', { class: 'tl-m' }, name ? toOutlet(name) : null, h('span', { text: SHORT[r.side] }), str(it.type) && it.type !== GOV ? h('span', { text: it.type }) : null),
        link ? extLink(link, { class: 'tl-hl', lang: it.lang === 'en' ? 'en' : null }, t ? `「${t}」` : hostOf(link)) : h('span', { class: 'tl-hl', text: t ? `「${t}」` : '—' })));
  };
  const tlList = h('ol', { class: 'tl' });
  const paintTl = (all) => {
    const rows = (all ? tl : tl.slice(0, TL_CAP)).map(tlRow);
    if (rows.length) rows[rows.length - 1].classList.add('last');
    tlList.replaceChildren(...rows);
    if (!all && tl.length > TL_CAP) tlList.append(h('li', { class: 'tl-more' }, h('button', { type: 'button', class: 'en-rest', on: { click: () => paintTl(true) } }, `残り ${tl.length - TL_CAP} 件を見る`)));
  };
  paintTl(false);
  const tlCard = h('section', { class: 'dcard t-tl' },
    h('p', { class: 'tl-lg' }, SIDES.map(([k, , short]) => (sd[k].length ? h('span', { data: { side: k } }, h('i', { 'aria-hidden': 'true' }), short, h('b', { class: 'num', text: sd[k].length })) : null))), tlList);
  const src = sourcesOf(ms, { outletOf });
  const srcCard = h('section', { class: 'dcard t-src' }, h('ul', { class: 'st-src' }, src.map((x) => {
    const link = safeUrl(x.first.link);
    return h('li', { data: { side: x.side } }, h('i', { class: 'dot', 'aria-hidden': 'true' }), toOutlet(x.name),
      h('span', { class: 'ty', text: [SHORT[x.side], x.type !== GOV ? x.type : ''].filter(Boolean).join('・') }),
      h('span', { class: 'sn num', text: `${x.n} 件` }),
      link ? extLink(link, { class: 'lk sl', title: `${x.name} の最初の記事を開く` }, '記事を開く') : null);
  })));

  // the home's lead without a picture is filled from the event itself, in the picture's column: a line the outlet published (the AI's own line, marked AI, when it wrote one),
  // then the first headlines in time order with their side. CSS shows it on the home only; nothing here is drawn or written by a model.
  let fill = null;
  if (!photo) {
    const rows = tl.filter((r) => str(r.it.title).trim()).slice(0, 3);
    const aiText = e.summary && str(e.summary.text_ja).trim() ? str(e.summary.text_ja).trim() : e.ai && str(e.ai.contrast_ja).trim() ? str(e.ai.contrast_ja).trim() : '';
    const withDesc = sorted.find((it) => typeof it.desc === 'string' && it.desc.trim());
    const lead = aiText ? h('p', { class: 'lf-q' }, h('span', { class: 'aimk', text: 'AI' }), aiText) : withDesc ? descOf(withDesc, safeUrl(withDesc.link)) : null;
    if (lead || rows.length) {
      fill = h('section', { class: 't-fill' }, lead, aiText ? h('small', { class: 'lf-n', text: AI_NOTE }) : null,
        rows.length ? h('ol', { class: 'lf-l' }, rows.map((r) => h('li', { data: { side: r.side } },
          h('span', { class: 'lf-m' }, h('i', { 'aria-hidden': 'true' }), outletOf(r.it) || SHORT[r.side], isNum(r.it.ts) ? h('time', { class: 'num', text: fmtClock(r.it.ts) }) : null),
          h('span', { class: 'lf-h', lang: r.it.lang === 'en' ? 'en' : null, text: `「${str(r.it.title).trim()}」` })))) : null);
    }
  }

  const node = h('div', { class: 'case-in' },
    h('div', { class: 'dos' + (photo ? ' has-photo' : '') },
      h('header', { class: 'ch dcard t-place' }, place, head, tools), photo,
      stH('pt', '要点'), point, reps, covNode, status, nav, fill, figs,
      stH('tl', '経過', tl.length), tlCard,
      stH('sd', '各側の見出し'), dossier.sides(m, angles, act),
      stH('src', '出典の一覧', src.length), srcCard),
    h('div', { class: 'cbody nophoto' }, members, side));
  return node;
}

// ---------------------------------------------------------------- how many at a time, and how they are laid out (js/wall.js)
let wall = null;
const wallList = () => shownPri().filter((x) => !x.hid);
const anglesOf = (e) => new Map(e.ai ? arr(e.ai.angles).filter(isObj).map((a) => [a.item_id, str(a.focus_ja)]) : []);
const describeOf = (e) => { const it = [...e.members].sort((a, b) => (isNum(a.ts) ? a.ts : Infinity) - (isNum(b.ts) ? b.ts : Infinity)).find((x) => typeof x.desc === 'string' && x.desc.trim()); return it ? descOf(it, safeUrl(it.link)) : null; };
const relatedOf = (e) => related(e).slice(0, 6).map((x) => ({ key: x.o.key, text: x.o.heading.text, lang: x.o.heading.lang || null, n: x.o.n, near: x.place }));
/** the events the pages run over: every event, or in the main-subject layout those round the main subject */
function pageList(v, main) { const l = wallList(); return v.layout === 'bundle' ? l.filter((x) => x !== main) : l; }
const othersCount = (c) => (c === 'many' ? 'many' : String(Math.max(0, Number(c) - 1)));
function pageState(v, main) {
  const l = pageList(v, main);
  if (v.layout === 'bundle' && othersCount(v.count) === '0') return { items: [], page: 0, pages: 1, from: 0, to: 0, total: l.length };
  return pageOf(l, v.layout === 'bundle' ? othersCount(v.count) : v.count, state.wallPage);
}
function pressWall(key) {
  if (narrow() || state.sel === key) { select(key, true); openSheet('case'); return; }
  select(key, true);
}
function renderWall() {
  const box = $('wall');
  if (!box || $('board').dataset.wall !== '1' || !state.data) return;
  wall = wall || createWall({ h, lk, dossier, lineIcon, headNode, measureOf, photoOf: entryPhoto, picsOf, fmtAge, fmtClock, genreShort, describe: describeOf, relatedOf, lanes, typeWho,
    new6hOf: (e) => (newsFresh() && e.exact && isNum(e.case.n_new6h) ? e.case.n_new6h : null), outletOf, safeUrl, extLink, biasOf, genreIcon,
    flashOf: (e) => (newsFresh() && e.exact && isNum(e.case.n_new6h) && isNum(e.case.since_first_h) ? { new6h: e.case.n_new6h, sinceH: e.case.since_first_h } : null),
    onPress: pressWall, onOpen: (k) => { select(k, true); openSheet('case'); }, onGenre: setGenre, onWord: searchFor, onPage: turnPage });
  const v = state.vwNow, c = cur(), all = wallList();
  const main = v.layout === 'bundle' ? (c && all.includes(c) ? c : all[0] || c) : null;
  const pg = pageState(v, main);
  state.wallPage = pg.page;
  const keep = box.scrollTop;
  wall.render(box, { layout: v.layout, count: v.count, page: pg, cur: c, main, total: all.length, strip: all.slice(0, 24), angles: anglesOf, othersLevel: v.count === 'many' || Number(v.count) > 4 ? 'xs' : 's' });
  box.scrollTop = state.wallKeep ? keep : 0;
  state.wallKeep = false;
  renderViewBar();
}
/** the page holds the event in focus */
function followWall() {
  if ($('board').dataset.wall !== '1' || !state.vwNow) return;
  const v = state.vwNow;
  if (v.layout !== 'bundle') { const p = pageHolding(wallList(), state.sel, v.count); if (p != null) state.wallPage = p; } else state.wallPage = 0;
  const on = document.querySelector(`#wall .wg .wt[data-key="${CSS.escape(String(state.sel))}"]`);
  if (on) {   // the same page: only the mark moves, the scroll stays
    for (const el of document.querySelectorAll('#wall .wt.sel')) el.classList.remove('sel');
    on.classList.add('sel');
    return;
  }
  renderWall();
}
function turnPage(d) {
  if ($('board').dataset.wall !== '1') return false;
  const c = cur(), all = wallList(), v = state.vwNow, main = v.layout === 'bundle' ? (c && all.includes(c) ? c : all[0] || c) : null;
  const pg = pageState(v, main), n = pg.page + (Number(d) < 0 ? -1 : 1);
  if (n < 0 || n >= pg.pages) return false;
  state.wallPage = n;
  renderWall();
  return true;
}
function viewEl() {
  if (state.viewEl) return state.viewEl;
  state.viewEl = h('span', { class: 'vwb' });
  return state.viewEl;
}
const phoneBar = window.matchMedia('(max-width: 760px)');
/** a phone held sideways: the sections are a rail down the left edge, so the three screens stay with the buttons */
const railBar = window.matchMedia('(orientation: landscape) and (max-height: 500px) and (max-width: 1100px)');
/** a tablet held upright (761-1100px wide, not the short landscape of a phone): the same fold as a phone, but the tabs stay in the bar */
const foldBar = window.matchMedia('(max-width: 760px), (min-width: 761px) and (max-width: 1100px) and (min-height: 501px)');
/** folded (phone or tablet): the search, the buttons, the range and the choice of count and layout move behind one button (表示); the bar keeps the name, the switch and one line of state.
 *  A phone also moves the AI line behind the button; a tablet leaves it under the bar. */
function placeBar() {
  const tb = $('tb'), menu = $('tb-menu'), al = $('ai-line'), r = document.querySelector('.tb-r'), scr = $('screens');
  if (foldBar.matches) { if (phoneBar.matches) menu.append(scr, al, r); else { menu.append(r); tb.after(al); $('sects').prepend(scr); } }
  else { tb.insertBefore(r, menu); tb.after(al); menu.hidden = true; $('view-btn').setAttribute('aria-expanded', 'false'); if (railBar.matches) r.prepend(scr); else $('sects').prepend(scr); }
  if (state.data) renderAiLine();
}
function renderViewBar() {
  const v = state.vwNow, el = viewEl();
  if (!v) return;
  const seg = (label, list, ja, cur2, fn) => h('span', { class: 'vw' }, h('span', { class: 'k', text: label }), h('span', { class: 'seg', role: 'group', 'aria-label': label },
    list.map((x) => h('button', { type: 'button', 'aria-pressed': String(x === cur2), data: { v: x }, on: { click: () => fn(x) } }, ja[x]))));
  const on = $('board').dataset.wall === '1';
  const c = cur(), all = wallList(), main = v.layout === 'bundle' ? (c && all.includes(c) ? c : all[0] || c) : null;
  const pg = on ? pageState(v, main) : null;
  el.replaceChildren(seg('件数', countsFor(window.innerWidth, window.innerHeight), COUNT_JA, v.count, setCount), seg('並べ方', LAYOUTS, LAYOUT_JA, v.layout, setLayout),
    pg && pg.pages > 1 ? h('span', { class: 'vw vw-p' }, h('button', { type: 'button', 'aria-label': '前へ', disabled: pg.page <= 0 ? true : null, on: { click: () => turnPage(-1) } }, '‹'),
      h('span', { text: `${pg.from}–${pg.to} / ${pg.total}` }), h('button', { type: 'button', 'aria-label': '次へ', disabled: pg.page >= pg.pages - 1 ? true : null, on: { click: () => turnPage(1) } }, '›')) : null);
}
/** what the choice means on this screen, now: a phone offers fewer counts; the whole map keeps the middle */
function applyView() {
  const allowed = countsFor(window.innerWidth, window.innerHeight);
  state.vwNow = { layout: state.vw.layout, count: countIn(state.vw.count, allowed) };
  const mode = state.floor ? state.floor.mode() : 'case';
  const on = wallOn(state.vwNow, mode), b = $('board');
  b.dataset.wall = on ? '1' : '0';
  b.dataset.layout = state.vwNow.layout;
  $('app').dataset.layout = state.vwNow.layout;
  renderViewBar();
  if (on) renderWall();
  if (state.panel && setOpen()) state.panel.render();
}
function setCount(c) {
  const list = countsFor(window.innerWidth, window.innerHeight);
  const asked = String(c) === '多い' ? 'many' : String(c);
  const want = COUNTS.includes(asked) ? asked : nextOf(list, state.vwNow ? state.vwNow.count : state.vw.count);
  state.vw = { ...state.vw, count: want };
  saveView(store, state.vw);
  state.wallPage = 0;
  applyView();
  followWall();
  return true;
}
function setLayout(l) {
  const byJa = LAYOUTS.find((k) => LAYOUT_JA[k] === l);
  const want = LAYOUTS.includes(l) ? l : byJa || nextOf(LAYOUTS, state.vw.layout);
  state.vw = { ...state.vw, layout: want };
  saveView(store, state.vw);
  state.wallPage = 0;
  applyView();
  followWall();
  return true;
}

// ---------------------------------------------------------------- the news under the map (js/mapnews.js)
let mapNews = null;
function renderMapNews() {
  const box = $('p-mapnews');
  if (!box || !state.floor) return;
  const on = state.floor.mode() === 'map' || state.sect === 'map' || window.matchMedia('(max-width: 1100px)').matches;
  box.dataset.on = on ? '1' : '0';
  if (!on) return;
  mapNews = mapNews || createMapNews({ h, lk, headNode, fmtAge, fmtClock, genreShort,
    ratioOf: (e) => dossier.ratioBar(measureOf(e)), photoOf: entryPhoto,
    onSelect: (k) => { state.mapLead = k; select(k, true); renderMapNews(); }, onGenre: setGenre, onScope: (x) => { state.mapScope = x; renderMapNews(); },
    onDetails: (k) => { select(k, true); if (state.sect === 'map') openSheet('case'); else $('p-case').scrollIntoView({ block: 'start' }); },
    describe: (e) => { const it = [...e.members].sort((a, b) => (isNum(a.ts) ? a.ts : Infinity) - (isNum(b.ts) ? b.ts : Infinity)).find((x) => typeof x.desc === 'string' && x.desc.trim()); return it ? descOf(it, safeUrl(it.link)) : null; },
    relatedOf: (e) => related(e).slice(0, 4).map((x) => ({ key: x.o.key, text: x.o.heading.text, lang: x.o.heading.lang || null, n: x.o.n, near: x.place })),
    videoOf: (e) => { const v = videosOf(videosOfEvent(e), STATIONS, 1)[0]; if (!v) return null; const st = STATIONS.find((x) => x.id === v.station); return { v, name: st ? st.name : '', src: embedSrc(playOfVideo(v), { auto: true, sound: false }) }; },
  });
  const view = newsView({ events: state.es.filter(matchesQ), pri: shownPri().filter((x) => !x.hid), cur: cur(), picked: state.mapPick, scope: state.mapScope, leadKey: state.mapLead, km: RADIUS_KM, nearby });
  mapNews.render(box, view);
}

// ---------------------------------------------------------------- the simple view (js/entry.js): six cards, three columns
const tagAI = (by, at) => { const b = by.filter(Boolean); return h('span', { class: 'by', title: b.join(' ') || null }, h('span', { class: 'aimk', text: 'AI' }), b[b.length - 1] || '—', isNum(at) ? `・${fmtShort(at)}` : ''); };
function absentOf(e) {
  const first = e.members.filter((it) => isNum(it.ts)).sort((a, b) => a.ts - b.ts)[0], gen = state.data.generated_at;
  return absentBlock(absentOutlets({ members: e.members, first: first && first.ts }, arr(state.data.sources), gen), { h, when: { at: fmtShort(gen), first: fmtShort(first && first.ts) }, windowH: state.data.window_h });
}
// reading aloud (js/speak.js): the point and each side's headlines, with the device's own voice; the same button stops it.
// No Japanese voice on the device: the buttons stay hidden (they appear when the voices arrive late)
const reader = createReader(window);
const pointOf = (e) => (e.summary && str(e.summary.text_ja).trim() ? { text: str(e.summary.text_ja).trim(), ai: true, outlet: '' } : { ...original(e), ai: false });
const SPEAK_I = { on: '<path d="M3.5 7.8h3l4-3.3v11l-4-3.3h-3z"/><path d="M13.6 7.4a3.8 3.8 0 0 1 0 5.2M15.7 5.3a6.8 6.8 0 0 1 0 9.4"/>', off: '<rect x="5.5" y="5.5" width="9" height="9" rx="1.5"/>' };
function paintSpeak(b) {
  const on = reader.key() != null && String(reader.key()) === b.dataset.k;
  b.hidden = !reader.can();
  b.setAttribute('aria-pressed', String(on));
  const ic = document.createElementNS(SVGNS, 'svg'); ic.setAttribute('viewBox', '0 0 20 20'); ic.setAttribute('aria-hidden', 'true'); ic.innerHTML = on ? SPEAK_I.off : SPEAK_I.on;
  b.replaceChildren(ic, h('span', { text: on ? '止める' : '読み上げる' }));
}
function speakBtn(e, cls) {
  const b = h('button', { type: 'button', class: 'speak' + (cls ? ' ' + cls : ''), data: { k: e.key }, on: { click: () => reader.toggle(e.key, readLines(e, { sides: sidesOf, point: pointOf, outletOf })) } });
  paintSpeak(b);
  return b;
}
reader.onChange(() => { for (const b of document.querySelectorAll('button.speak')) paintSpeak(b); });
function renderEntryView() {
  if (state.ui !== 'simple' || !state.data) return;
  const run = isObj(state.data.ai_run) ? state.data.ai_run : {};
  renderEntry($('entry'), { h, events: entryEvents(state.pri.filter(inGenre)), sel: state.entrySel, pick: pickEntry, gen: state.data.generated_at,
    fmt: { clock: fmtClock, short: fmtShort, span: fmtSpan }, aiTag: tagAI, aiBy: [str(run.provider), str(run.model)], aiAt: run.at, safeUrl, absent: absentOf, full: () => { setHome('board'); setUi('full'); },
    detail: entryDetail, ownBox, coverage: coverageCard, briefBox: (e) => briefBox(e, tagAI), measure: measureOf, bias: biasOf, dossier, photo: entryPhoto, videos: videosOfEvent, outlet: openOutlet, shareImage: (k) => shareImage(state.byKey.get(k)), speak: (e) => speakBtn(e),
    oneSide: sideGroups(true), oneSideTitle: ONE_SIDE_TITLE, oneSideNote: ONE_SIDE_NOTE, more: entryMore,
    local: state.set.local.place ? { name: placeName(state.set.local.place), events: localList().slice(0, 5) } : null });
  const hd = $('entry').querySelector('.en-head');
  if (hd) hd.after(genreEl()); else $('entry').prepend(genreEl());
}
// the rest of the news of one side: the list on the detailed screen
function entryMore(side) { state.anomKind = 'side-' + side; setHome('board'); setSect('news', 'anom'); }
// a press on a card: the news under the strip changes, and the page brings its title up unless it is already near the top
function pickEntry(k) {
  state.entrySel = k; renderEntryView(); recordRead(state.byKey.get(k));
  const s = $('entry').querySelector('.en-sel'), c = $('entry').querySelector('.en-card[aria-pressed="true"]'), how = reduced() ? 'auto' : 'smooth';
  if (c) { const st = c.parentElement, r = c.getBoundingClientRect(), b = st.getBoundingClientRect(); if (r.left < b.left || r.right > b.right) st.scrollBy({ left: r.left - b.left - 16, behavior: how }); }
  const top = s ? s.getBoundingClientRect().top : 0;
  if (s && (top < 0 || top > window.innerHeight * 0.4)) s.scrollIntoView({ block: 'start', behavior: how });
}
// the same news on the detailed screen: the board with this news chosen (and the parts of バイアス度 open when asked)
function entryDetail(k, opt = {}) {
  if (opt.bias) state.biasOpen = true;
  setHome('board'); select(k, true); renderCase();
  if (narrow() || $('board').dataset.wall === '1') openSheet('case');
}
// the photo of an event in the simple view: the one the board chose (CONTRACT 20.5), else the earliest report that carries one
function entryPhoto(e) {
  const ph = e.case && isObj(e.case.photo) ? e.case.photo : null, u = ph ? safeImg(ph.url) : null;
  if (u) { const it = ctx().ix.items[ph.id] || state.ix.items[ph.id] || {}; return { url: u, outlet: str(ph.outlet) || str(it.outlet), ts: it.ts, link: safeUrl(it.link) }; }
  const im = [...arr(e.imgs)].sort((a, b) => (isNum(a.ts) ? a.ts : Infinity) - (isNum(b.ts) ? b.ts : Infinity))[0];
  if (im) return im;
  // else a still of the event's own video (the broadcaster's image); in the chosen event it plays in its place
  const v = videosOf(videosOfEvent(e), STATIONS, 1)[0], st = v && STATIONS.find((x) => x.id === v.station);
  return v ? { url: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`, outlet: st ? st.name : '', ts: Number(v.ts) || null, link: `https://www.youtube.com/watch?v=${v.id}`, kind: 'video', id: v.id } : null;
}
// ---------------------------------------------------------------- the home: the lead story and the cards, or the board as the detailed screen
const HOME_KEY = 'parallax.home.v1';
const homeMode = () => (document.documentElement.dataset.home === 'board' ? 'board' : 'home');
function paintHomeSub(n) {
  const el = $('home-sub'), g = state.data && state.data.generated_at;
  if (el) el.textContent = isNum(g) ? `${fmtShort(g)} 時点・${n} 件` : `${n} 件`;
}
// The three screens, one rule: ホーム (the front page), 詳しく見る (the board), 比べる (the simple compare view). The top bar shows which one is open;
// every move between them is one history entry, so the browser's back button goes back to the screen before. The name and the ホーム tab always go home.
const SCREENS = ['home', 'board', 'simple'];
const screenNow = () => (state.ui === 'simple' ? 'simple' : homeMode() === 'board' ? 'board' : 'home');
let screenReady = false, screenPop = false;
// The bar has one row: the three screens first, then the sections. Only one thing in it is chosen: a screen while the home is open, a section when another is.
// <html data-screen> names what is on screen for the stylesheet: home | board | compare | sect
function paintScreen() {
  const now = screenNow(), onHome = state.sect === 'home';
  for (const id of SCREENS) { const b = $('sc-' + id); if (b) b.setAttribute('aria-pressed', String(onHome && id === now)); }
  document.documentElement.dataset.screen = !onHome ? 'sect' : now === 'simple' ? 'compare' : now;
}
function noteScreen() {
  paintScreen();
  if (!screenReady || screenPop) return;
  const now = screenNow(), cur = history.state && history.state.ps;
  if (cur === now) return;
  try { history.pushState({ ...(isObj(history.state) ? history.state : {}), ps: now }, '', location.href); } catch { /* */ }
}
// a move that goes through another screen on its way (the compare view to the board) is one history entry, not two
function quietUi(m) { const was = screenPop; screenPop = true; try { return setUi(m); } finally { screenPop = was; } }
function goScreen(name) {
  if (!SCREENS.includes(name)) return false;
  if (name === 'simple') { if (screenNow() !== 'simple') { setSect('home'); setUi('simple'); } }
  else setHome(name);
  return true;
}
const paintHomeBtn = paintScreen;
function setHome(m) {
  const v = m === 'board' ? 'board' : 'home';
  if (state.ui === 'simple') quietUi('full');
  document.documentElement.dataset.home = v;
  try { window.localStorage.setItem(HOME_KEY, v); } catch { /* private window: the choice lasts until the page is closed */ }
  paintHomeBtn();
  if (state.sect !== 'home') setSect('home');
  if (state.data) requestAnimationFrame(() => renderMap(false));
  noteScreen();
  return true;
}
function setUi(m) {
  state.ui = m === 'simple' ? 'simple' : 'full';
  $('app').dataset.ui = state.ui; $('entry').hidden = state.ui !== 'simple';
  if (state.ui === 'simple') renderEntryView(); else if (state.data) renderMap(false);
  noteScreen();
  return true;
}

// ---------------------------------------------------------------- scenes (js/scenes.js, data/scenes.json): the arrangement only, never silent
const SCENE_PANE = { pri: 'p-pri', case: 'p-case', src: 'p-src', hours: 'p-hours', fields: 'p-fields', map: 'p-map', count: 'p-count', tv: 'p-tv', haz: 'p-haz', mkt: 'p-mkt', pol: 'p-pol' };
function applyScene(id) {
  $('app').dataset.scene = id;
  for (const el of document.querySelectorAll('[data-sfold]')) { el.classList.remove('fold'); delete el.dataset.sfold; }
  for (const k of arr((sceneOf(state.scenes, id) || {}).fold)) { const el = $(SCENE_PANE[k]); if (el && !el.classList.contains('fold')) { el.classList.add('fold'); el.dataset.sfold = '1'; } }
  // "big": the pane takes a larger share of its column (the politics pane in the election scene puts the elections and the approval first)
  for (const el of document.querySelectorAll('[data-sbig]')) delete el.dataset.sbig;
  for (const k of arr((sceneOf(state.scenes, id) || {}).big)) { const el = $(SCENE_PANE[k]); if (el) el.dataset.sbig = '1'; }
  applyPanes();
  renderPol();
  if (state.sheet === 'pol') renderSheet();
  if (state.sect === 'politics') renderSect();
}
function sceneTick() {
  if (!state.scenes || !state.data || !state.ix) return;
  if (state.sceneMode === 'auto') {
    const evs = state.pri.slice(0, 40).map((e) => ({ n: e.n, new6h: e.case && e.case.n_new6h, sinceH: e.case && e.case.since_first_h, intl: uniq(e.members.filter((it) => it.home === 'intl').map(outletOf)).length,
      lat: e.geo && e.geo.lat, lon: e.geo && e.geo.lon, flags: e.topics, place: e.geo && e.geo.name }));
    state.sceneRes = detect({ gen: state.data.generated_at, now: Date.now() / 1000, events: evs, items: Object.values(state.ix.items), hz: state.haz || {} }, state.scenes);
  }
  const r = state.sceneRes || { id: 'calm', reasons: [] }, manual = state.sceneMode === 'manual';
  if ($('app').dataset.scene !== r.id) applyScene(r.id);
  const text = manual ? '表示 平時（手動）' : bannerText(state.scenes, r, state.sceneMode, fmtClock);
  const go = (mode, res) => () => { state.sceneMode = mode; if (res) state.sceneRes = res; sceneTick(); };
  const bar = $('scene-bar'), sc = sceneOf(state.scenes, r.id) || {};
  const SCENE_TONE = { disaster: ['bad', '災害'], election: ['', '国内政治'], world: ['', '国際'], live: ['warn', ''] };
  const [tone, genre] = manual ? ['ok', ''] : SCENE_TONE[r.id] || ['warn', ''];
  state.stScene = text ? { tone, genre, text: manual ? '平時（手動）' : str(sc.label_ja) || '表示', tip: text } : null;
  bar.hidden = !text || state.statOpen !== 'scene';
  renderStat();
  if (text) bar.replaceChildren(h('span', { class: 'sc-t', text }), manual ? h('button', { type: 'button', class: 'sc-b', on: { click: go('auto') } }, '自動へ')
    : [h('button', { type: 'button', class: 'sc-b', on: { click: go('manual', { id: 'calm', reasons: [] }) } }, '平時へ戻す'),
      h('button', { type: 'button', class: 'sc-b', 'aria-pressed': String(state.sceneMode === 'pinned'), on: { click: go(state.sceneMode === 'pinned' ? 'auto' : 'pinned') } }, '固定')]);
}

// ---------------------------------------------------------------- the map
function scene() {
  const e = cur();
  const pri = new Set(state.pri.map((x) => x.key));
  const at = new Map();
  for (const x of state.es) {
    if (!x.geo || !vis(x) || (state.mapUi && !state.mapUi.inTheme(x))) continue;
    const k = `${x.geo.lat.toFixed(1)},${x.geo.lon.toFixed(1)}`;
    const a = at.get(k) || { lat: x.geo.lat, lon: x.geo.lon, n: 0, pri: false, name: x.geo.name, ref: x.key, best: 0, country: !!x.geo.country };
    a.n++; if (pri.has(x.key)) a.pri = true;
    if (x.n > a.best || !a.field) { if (x.n > a.best) { a.best = x.n; a.ref = x.key; } a.field = x.field; }
    if (/[^\x00-\x7f]/.test(x.geo.name) && !/[^\x00-\x7f]/.test(a.name)) a.name = x.geo.name;
    at.set(k, a);
  }
  const points = [...at.values()].map((a) => ({ lat: a.lat, lon: a.lon, n: a.n, pri: a.pri ? 1 : 0, country: a.country, name: a.name, ref: a.ref, field: a.field }));
  const hz = state.haz || { quakes: [], typhoons: [], disasters: [] };
  return {
    focus: e && e.geo ? { lat: e.geo.lat, lon: e.geo.lon, radiusKm: e.geo.country ? null : RADIUS_KM, label: e.geo.name } : null,
    points, quakes: hz.quakes, typhoons: hz.typhoons, disasters: hz.disasters, layers: state.layers, fresh: state.hazFresh,
    span: state.floor ? state.floor.span() : null, pillars: state.floor ? state.floor.pillars() : false,
  };
}
// the layer bar: one shape for each layer, in the three colours of the map (red = hazards and the priority list)
const GLYPH = {
  events: '<circle cx="7" cy="7" r="2.6" fill="#eef7fc"/>',
  pri: '<rect x="5.5" y="1" width="3" height="12" fill="#f0685c"/>',
  radius: '<circle cx="7" cy="7" r="4.8" fill="none" stroke="#8fd8f2" stroke-width="1.2" stroke-dasharray="2 1.6"/>',
  quakes: '<circle cx="7" cy="7" r="4.5" fill="none" stroke="#f0685c" stroke-width="1.3"/>',
  typhoons: '<path d="M7 7 m0 -1.5 a1.5 1.5 0 1 1 -1.5 1.5 M7 7 m-4.5 0 a4.5 4.5 0 0 1 4.5 -4.5 M7 7 m4.5 0 a4.5 4.5 0 0 1 -4.5 4.5" fill="none" stroke="#f0685c" stroke-width="1.3"/>',
  disasters: '<path d="M7 1.5 L12.5 7 L7 12.5 L1.5 7 Z" fill="none" stroke="#f0685c" stroke-width="1.3"/>',
};
const glyph = (id) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 14 14'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = GLYPH[id] || GLYPH.events; return s; };
const r2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-');
/** what the layers hold, as keys (kind, place, value); the scan line runs when these are replaced, not when a layer is turned off */
function layerKeys(sc) {
  const K = new Set(), seen = new Map();
  const add = (k) => { const n = (seen.get(k) || 0) + 1; seen.set(k, n); K.add(`${k}#${n}`); };
  for (const p of sc.points) add(`n|${r2(p.lat)},${r2(p.lon)}|${p.n}|${p.pri}`);
  for (const q of sc.quakes || []) add(`q|${r2(q.lat)},${r2(q.lon)}|${q.mag}`);
  for (const t of sc.typhoons || []) add(`t|${t.id}|${Array.isArray(t.center) ? t.center.map(r2).join(',') : ''}|${t.pressure || ''}`);
  for (const d of sc.disasters || []) add(`d|${r2(d.lat)},${r2(d.lon)}|${d.alert || ''}`);
  return K;
}
/** the things TRACKING may hold: storms, quakes of M5 and more, red and orange alerts, the head of the priority list */
function trackList() {
  const hz = state.haz || {}, L = [];
  for (const t of hz.typhoons || []) if (Array.isArray(t.center) && isNum(t.center[0])) L.push({ lat: t.center[0], lon: t.center[1], label: [t.name || t.nameEn, t.pressure ? `${t.pressure} hPa` : ''].filter(Boolean).join('・') });
  for (const q of hz.quakes || []) if (isNum(q.mag) && q.mag >= 5 && isNum(q.lat)) L.push({ lat: q.lat, lon: q.lon, label: `M${q.mag.toFixed(1)}・${q.place || ''}` });
  for (const d of hz.disasters || []) if (/red|orange/i.test(d.alert || '') && isNum(d.lat)) L.push({ lat: d.lat, lon: d.lon, label: d.name || d.type || '' });
  for (const e of state.pri.filter(vis).slice(0, 12)) if (e.geo) L.push({ lat: e.geo.lat, lon: e.geo.lon, label: `${e.geo.name}・${String(e.heading ? e.heading.text : '').slice(0, 28)}` });
  return L;
}
function renderMap(animate) {
  if (!state.map) return;
  const sc = scene();
  const hz = state.haz;
  const on = (id) => state.layers[id] !== false;
  const n = { events: state.es.filter((x) => x.geo).length, pri: state.pri.filter((x) => x.geo).length, quakes: hz ? hz.quakes.length : null, typhoons: hz ? hz.typhoons.length : null, disasters: hz ? hz.disasters.length : null };
  if (state.floor) {
    state.floor.data({
      focus: sc.focus ? { lat: sc.focus.lat, lon: sc.focus.lon, label: sc.focus.label } : null,
      counts: Object.fromEntries(Object.entries(n).filter(([k]) => on(k) && k !== 'pri')), track: trackList(), keys: layerKeys(sc),
    });
  }
  state.map.show(sc, animate);
  const cnt = {
    events: `${state.es.filter((x) => x.geo).length}`, pri: `${state.pri.filter((x) => x.geo).length}`, radius: sc.focus && sc.focus.radiusKm ? `${RADIUS_KM} km` : '—',
    quakes: hz ? String(hz.quakes.length) : '—', typhoons: hz ? String(hz.typhoons.length) : '—', disasters: hz ? String(hz.disasters.length) : '—',
  };
  $('layers').replaceChildren(...LAYERS.map(([id, ja]) => h('button', { type: 'button', class: `lyr l-${id}`, 'aria-pressed': String(on(id)), on: { click: () => toggleLayer(id) } },
    glyph(id), ja, h('span', { class: 'n', text: cnt[id] }))));
  const lit = LAYERS.filter(([id]) => on(id));
  $('layer-sum').textContent = `${lit.length} 層・印 ${lit.reduce((a, [id]) => a + (isNum(n[id]) && id !== 'pri' ? n[id] : 0), 0).toLocaleString('en-US')}`;
  const e = cur();
  $('map-read').textContent = e && e.geo ? `${e.geo.name} ${Math.abs(e.geo.lat).toFixed(1)}°${e.geo.lat >= 0 ? 'N' : 'S'} ${Math.abs(e.geo.lon).toFixed(1)}°${e.geo.lon >= 0 ? 'E' : 'W'} · ${e.geo.prec}` : '';
  if (state.mapUi) state.mapUi.update();
}
function toggleLayer(arg) {
  const [id, want] = String(arg || '').split(':');
  if (!LAYERS.some(([x]) => x === id)) return false;
  state.layers[id] = want === 'on' ? true : want === 'off' ? false : state.layers[id] === false;
  try { store && store.setItem(LAYER_KEY, JSON.stringify(state.layers)); } catch { /* this visit only */ }
  renderMap(false);
  return true;
}
function onMapPick(hit) {
  if (hit.kind === 'event' && hit.p) window.dispatchEvent(new CustomEvent('parallax:map-select', { detail: { place: hit.p.name, lat: hit.p.lat, lon: hit.p.lon, country: !!hit.p.country } }));
  if (hit.kind === 'event' && hit.p.ref) select(hit.p.ref, true);
  else if (hit.kind === 'quake') openUrl(hit.q.url);
  else if (hit.kind === 'typhoon') openUrl(hit.t.url);
  else if (hit.kind === 'disaster') openUrl(hit.d.url);
}

// ---------------------------------------------------------------- right column: the world
function renderCount() {
  const x = state.board && isObj(state.board.examined) ? state.board.examined : null;
  const items = Object.values(ctx().ix.items).filter(isObj);
  const es = state.es;
  const cn = counts();
  if (cn && isObj(cn.headlines)) {
    $('count-h').textContent = '見出しの件数';
    roll($('count-n'), cn.headlines.fetched);
    const go = { 期間内の見出し: () => openSheet('hours', $('p-count')), '2 社以上': () => openSheet('pri', $('p-count')), 国内と海外: () => setTopic('cross') };
    const f = [['期間内の見出し', cn.headlines.in_window], ['2 社以上', cn.multi_outlet], ['国内と海外', isObj(cn.home) ? cn.home.both : null]];
    $('count-f').replaceChildren(...f.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', null, lk(num(isNum(v) ? v : null), go[k], `${k} を開く`, 'cnt'))]));
    return;
  }
  if (x) {
    $('count-h').textContent = '見出しの件数';
    roll($('count-n'), x.fetched_items);
    const f = [['期間内の見出し', x.in_window], ['2 社以上', x.multi_outlet], ['一次資料', x.primary_items]];
    $('count-f').replaceChildren(...f.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', null, num(isNum(v) ? v : null))]));
    return;
  }
  $('count-h').textContent = 'まとめた見出し';
  roll($('count-n'), items.length);
  $('count-f').replaceChildren(
    h('dt', { text: '出来事' }), h('dd', null, num(es.length)), h('dt', { text: '2 社以上' }), h('dd', null, num(es.filter((e) => e.n >= 2).length)),
    h('dt', { text: '国内と海外' }), h('dd', null, num(es.filter((e) => e.cover === 'both').length)), h('dt', { text: '写真あり' }), h('dd', null, num(items.filter((it) => imageOf(it)).length)));
}
function renderHaz() {
  const hz = state.haz;
  const b = $('haz-b');
  if (!hz) { $('haz-c').textContent = '—'; b.replaceChildren(h('p', { class: 'empty', text: '読込中' })); return; }
  $('haz-c').replaceChildren(`地震 ${hz.quakes.length} · 台風 ${hz.typhoons.length} · 災害 ${hz.disasters.length}`);
  const tsu = arr(hz.tsunami).filter(isObj).map((t) => h('li', { class: 'tsu' }, h('b', { text: str(t.title) || '津波の情報' }), ` ${fmtShort(t.issued)} `,
    arr(t.areas).filter(isObj).slice(0, 4).map((a) => `${str(a.name)} ${str(a.level)} ${str(a.max_height)}`).join('、')));
  const ty = hz.typhoons.map((t) => {
    const vals = [isNum(t.pressure) ? `${t.pressure} hPa` : '', isNum(t.windMs) ? `最大 ${t.windMs} m/s` : '', t.location, [t.course, isNum(t.speedKmh) ? `${t.speedKmh} km/h` : ''].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
    const more = [t.stormKm ? `暴風域 ${t.stormKm} km` : '', t.galeKm ? `強風域 ${t.galeKm} km` : '', t.forecast.length ? `予報 ${t.forecast.length}` : '', t.cone && t.cone.length ? '予報の範囲' : '', fmtShort(t.ts)].filter(Boolean).join(' · ');
    return h('li', { class: 'ty', title: more || null, on: { click: () => openUrl(t.url) } },
      h('span', { class: 'tyn' }, h('b', { text: t.name || '台風' }), h('span', { text: ` ${t.intensity || ''}${t.scale ? '・' + t.scale : ''} ${t.src && t.src !== 'JMA' ? t.src : ''}` })),
      h('span', { class: 'tyv', text: vals || more || '値の発表なし' }));
  });
  const hot = (q) => q.mag >= 5 || ['4', '5-', '5+', '6-', '6+', '7'].includes(q.shindo);
  const qs = [...hz.quakes].sort((a, b2) => (b2.src === 'jma' ? 1 : 0) - (a.src === 'jma' ? 1 : 0) || b2.ts - a.ts);
  const pick = [...qs.filter(hot), ...qs.filter((q) => !hot(q))].slice(0, 14).sort((a, b2) => b2.ts - a.ts);
  const quakes = pick.map((q) => h('li', { class: hot(q) ? 'hot' : null, on: { click: () => openUrl(q.url) } },
    h('span', { class: 'qt', text: fmtClock(q.ts) }), h('span', { class: 'qm', text: `M${q.mag.toFixed(1)}` }),
    h('span', { class: 'qp' }, q.shindo ? h('span', { class: 'qs', text: `震度${shindoJa(q.shindo)} ` }) : null, q.place || '—'), h('span', { class: 'qd', text: isNum(q.depthKm) ? `${Math.round(q.depthKm)}km` : '' })));
  const dis = hz.disasters.filter((x) => x.alert === 'Red' || x.alert === 'Orange').slice(0, 6).map((x) => h('li', { class: 'hot', on: { click: () => openUrl(x.url) } },
    h('span', { class: 'qm wide', text: x.typeJa || disasterJa(x.type) }), h('span', { class: 'qp', text: `${x.name} ${x.alert === 'Red' ? '赤' : '橙'}` })));
  const stv = (k, ja) => { const v = hz.status && hz.status[k]; return isObj(v) ? h('span', { class: v.ok ? null : 'bad', title: str(v.err), text: `${ja} ${v.ok ? (isNum(v.n) ? v.n : '—') : '読めず'}` }) : null; };
  const bigQ = [...hz.quakes].filter((q) => isNum(q.mag)).sort((a, c) => c.mag - a.mag)[0];
  const lowT = hz.typhoons.filter((t) => isNum(t.pressure)).sort((a, c) => a.pressure - c.pressure)[0];
  const meter = (title, node, name, url) => h('button', { type: 'button', class: 'hz-g', title: name, on: { click: () => openUrl(url) } }, node, h('span', { class: 'hz-k', text: title }), h('span', { class: 'hz-n', text: name }));
  const meters = bigQ || lowT ? h('div', { class: 'hz-ms' },
    bigQ ? meter('最大の地震', dossier.halfGauge(bigQ.mag, { min: 0, max: 9, label: 'マグニチュード', text: `M${bigQ.mag.toFixed(1)}` }), bigQ.place || '—', bigQ.url) : null,
    // lower pressure is the stronger storm: the scale runs from 1010 hPa down to 900 hPa
    lowT ? meter('台風の中心気圧', dossier.halfGauge(1010 - lowT.pressure, { min: 0, max: 110, label: '中心気圧', text: `${lowT.pressure}` }), `${lowT.name || lowT.nameEn || '台風'} hPa`, lowT.url) : null) : null;
  b.replaceChildren(
    meters,
    tsu.length ? h('ul', { class: 'haz' }, tsu) : null,
    ty.length ? h('ul', { class: 'haz ty-l' }, ty) : null,
    h('ul', { class: 'haz' }, quakes.length ? quakes : h('li', { class: 'empty', text: '地震 0 件' })),
    dis.length ? h('ul', { class: 'haz' }, dis) : null,
    h('p', { class: 'pfoot src', 'data-host': '' }, hz.from === 'live' ? '閲覧時に更新 ' : '', isNum(hz.at) ? `${fmtShort(hz.at)} ` : '', isNum(hz.at) ? ageEl(hz.at, SIX_H) : null, ' ',
      stv('jma_quake', '気象庁 地震'), stv('jma_typhoon', '台風'), stv('jma_tsunami', '津波'), stv('usgs', 'USGS'), stv('gdacs_events', 'GDACS'), stv('gdacs', 'GDACS')));
}
function pickRows(x) {
  if (Array.isArray(x)) return x;
  if (isObj(x)) for (const k of ['rows', 'items', 'quotes', 'list', 'data']) if (Array.isArray(x[k])) return x[k];
  return [];
}
function spark(pts, W = 48, H = 14) {
  const v = arr(pts).filter((p) => Array.isArray(p) && isNum(p[1]));
  if (v.length < 2) return h('span', { class: 'spk' });
  const ys = v.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys);
  const d = v.map((p, i) => `${i ? 'L' : 'M'}${((i / (v.length - 1)) * W).toFixed(1)} ${(H - ((p[1] - lo) / (hi - lo || 1)) * H).toFixed(1)}`).join('');
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spk ' + (W > 60 ? 'l ' : '') + (ys[ys.length - 1] < ys[0] ? 'dn' : 'up'), 'aria-hidden': 'true' }, s('path', { d }));
  return svg;
}
function renderMkt() {
  const m = state.mkt;
  const b = $('mkt-b');
  if (m === undefined) { b.replaceChildren(h('p', { class: 'empty', text: '読込中' })); return; }
  if (!m || !Array.isArray(m.series)) { $('mkt-c').textContent = '—'; b.replaceChildren(h('p', { class: 'empty', text: '市場のデータを読めない' })); return; }
  const GROUP = { rates: '金利', fx: '為替', commodity: '商品' };
  const groups = uniq(m.series.filter(isObj).map((x) => x.group));
  $('mkt-c').textContent = `${m.series.filter((x) => isObj(x) && x.ok).length} / ${m.series.length}`;
  const parts = [];
  for (const g of groups) {
    parts.push(h('h4', { text: GROUP[g] || g }));
    parts.push(h('ul', { class: 'mk' }, m.series.filter((x) => isObj(x) && x.group === g).map((x) => {
      if (!x.ok) return h('li', { class: 'old' }, h('span', { class: 'mn', text: str(x.name_ja) }), h('span', { class: 'mv', text: '—' }), h('span', { class: 'mp', text: '' }), h('span', { class: 'mt', title: str(x.err), text: '読めず' }));
      const rate = x.unit === '%';
      const ch = rate ? x.chg_bp : x.chg_pct;
      const ta = isObj(x.ta) && x.ta.ok ? x.ta : null;
      const old = isNum(x.age_days) && x.age_days >= 5;
      return h('li', { class: old ? 'old' : null, title: [str(x.source && x.source.name), ta ? `${str(ta.trend) || '—'} · 1か月 ${isNum(ta.chg && ta.chg.m1) ? ta.chg.m1 + (rate ? 'bp' : '%') : '—'} · RSI ${isNum(ta.rsi) ? ta.rsi : '—'}` : '', ...arr(ta && ta.signals)].filter(Boolean).join('\n') },
        h('span', { class: 'mn', text: str(x.name_ja) }), spark(x.spark),
        h('span', { class: 'mv', text: isNum(x.last) ? `${x.last.toLocaleString('ja-JP', { maximumFractionDigits: rate ? 3 : 2 })}${rate ? '%' : ''}` : '—' }),
        h('span', { class: 'mp ' + (isNum(ch) ? (ch < 0 ? 'dn' : 'up') : ''), text: isNum(ch) ? `${ch > 0 ? '+' : ''}${rate ? ch.toFixed(1) + 'bp' : ch.toFixed(2) + '%'}` : '—' }),
        h('span', { class: 'mta', text: [ta && ta.trend, ta && isNum(ta.rsi) ? `RSI ${Math.round(ta.rsi)}` : '', `${str(x.as_of).slice(5).replace('-', '/')} の値`].filter(Boolean).join(' · ') }));
    })));
  }
  b.replaceChildren(...parts, h('p', { class: 'pfoot', 'data-host': '' }, `${fmtShort(m.generated_at)} `, ageEl(m.generated_at, SIX_H), ` · 日々の値 · ${str(m.note_ja) || '売買の推奨ではありません'}`));
}
// the politics pane and its sheet live in js/politics_ui.js; here only the wiring
let polUi = null;
const politics = () => (polUi = polUi || createPolitics({ h, s, extLink, safeUrl, fmtAge, fmtShort, sec, tbl, td, fmtN }));
const sceneNow = () => $('app').dataset.scene || 'calm';
function renderPol() {
  const p = state.pol, b = $('pol-b');
  if (p === undefined) { b.replaceChildren(h('p', { class: 'empty', text: '読込中' })); return; }
  if (!p) { $('pol-c').textContent = '—'; b.replaceChildren(h('p', { class: 'empty', text: '政治のデータを読めない' })); return; }
  $('pol-c').replaceChildren(ageEl(p.generated_at, SIX_H));
  $('pol-c').dataset.host = '';
  b.replaceChildren(...politics().pane(p, state.crit, sceneNow()));
}
// ---------------------------------------------------------------- broadcast: the broadcasters' own channels (js/tv.js)
function tvList() { const off = new Set(state.set.tv.off); return state.set.tv.order.map((id) => STATIONS.find((x) => x.id === id)).filter((x) => x && !off.has(x.id)); }
// the videos of the selected event (stories[].videos, CONTRACT 18.14): of the built stories whose reports it holds (a rule cluster, an AI regrouping and the stories folded into a lead all find theirs)
function videoIndex() {
  const src = state.base || state.data;
  if (state.vidIx && state.vidIxSrc === src) return state.vidIx;
  const ix = new Map();
  for (const st of arr(src && src.stories)) if (isObj(st) && arr(st.videos).length) for (const id of arr(st.member_ids)) ix.set(id, st);
  state.vidIx = ix; state.vidIxSrc = src;
  return ix;
}
function videosOfEvent(e) {
  if (!e) return [];
  const ix = videoIndex();
  const votes = new Map();
  for (const id of arr(e.ids)) { const st = ix.get(id); if (st) votes.set(st, (votes.get(st) || 0) + 1); }
  return [...votes].filter(([st, n]) => n * 2 >= Math.min(arr(e.ids).length, arr(st.member_ids).length)).flatMap(([st]) => arr(st.videos));
}
// what plays: a video the visitor pressed, a channel the visitor pressed, else what follows the selected event (tv.js playFor)
function tvPlay(ls) {
  const v = state.tvV && arr(state.tvVids).find((x) => x.id === state.tvV);
  if (v) return playOfVideo(v, ls);
  const m = state.tv && ls.find((x) => x.id === state.tv);
  if (m) return playOfStation(m);
  if (state.tvAuto && ls.includes(state.tvAuto.st)) return state.tvAuto;
  return playFor([], [], 'jp', tvWilling(ls));
}
function renderTv() {
  const box = $('tv-b');
  if (!box) return;
  const ls = tvList();
  // the pane turned off, or no channel left: no player at all (nothing loads, nothing plays)
  if (state.set.panes.off.includes('tv') || !ls.length) { box.replaceChildren(h('p', { class: 'empty', text: ls.length ? '' : '表示する局がありません（設定の映像）' })); $('tv-c').textContent = ''; return; }
  const p = tvPlay(ls);
  const st = p.st;
  const d = describe(p);
  $('tv-c').textContent = st.name;
  let f = box.querySelector('.tv-f');
  if (!f) { f = h('div', { class: 'tv-f' }); box.replaceChildren(h('p', { class: 'tv-t' }), f, h('div', { class: 'tv-v', role: 'group', 'aria-label': 'この出来事の映像' }), h('div', { class: 'tv-ch', role: 'group', 'aria-label': '局' }), h('p', { class: 'pfoot tv-n' })); }
  const src = embedSrc(p, { auto: state.set.tv.auto, sound: state.set.tv.sound });
  const fr = f.querySelector('iframe');
  if (!fr || fr.dataset.src !== src) f.replaceChildren(h('iframe', { src, on: { load: (ev) => { try { ev.target.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), new URL(src).origin); } catch { /* the player only stays silent */ } } }, title: `${st.name}（YouTube）${p.kind === 'video' ? ' ' + d.title : ''}`, loading: 'lazy', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin', data: { src } }));
  // the first line: which channel and what is playing (the title is a quotation: channel, time, link)
  const url = d.url && safeUrl(d.url);
  box.querySelector('.tv-t').replaceChildren(h('b', { class: 'tv-tn', text: st.name }), url ? extLink(url, { class: 'tv-tl', title: d.title }, d.title) : h('span', { class: 'tv-tl', text: d.title }), d.ts ? h('span', { class: 'tv-ts', text: fmtShort(d.ts) }) : '');
  const vids = arr(state.tvVids);
  const vb = box.querySelector('.tv-v');
  vb.hidden = !vids.length;
  vb.replaceChildren(...vids.map((v, i) => {
    const same = vids.filter((x) => x.station === v.station);
    const sx = ls.find((x) => x.id === v.station);
    return h('button', { type: 'button', class: 'chip', title: v.title, 'aria-pressed': String(p.kind === 'video' && p.video.id === v.id), on: { click: () => { state.tvV = v.id; state.tv = null; renderTv(); } } },
      `${sx ? sx.short : v.station}${same.length > 1 ? ' ' + (same.indexOf(v) + 1) : ''}`);
  }));
  box.querySelector('.tv-ch').replaceChildren(...ls.map((x) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(p.kind !== 'video' && x.id === st.id), on: { click: () => { state.tv = x.id; state.tvV = null; renderTv(); } } }, x.short)));
  const what = p.kind === 'video' ? '出来事の映像' : p.kind === 'live' ? 'ニュースのライブ' : '最新の投稿';
  box.querySelector('.tv-n').textContent = `${what}・公式・${state.set.tv.sound ? '音あり' : '消音'}${state.set.tv.auto ? '' : '・押して再生'}`;
}
// a new event selected by hand: its video, else the latest of a channel that reported it, else the news stream; a channel or video pressed before is let go
// a video or a channel that will not play inside a page (the stream has ended, or it allows no embedding) gives way to the next, unless it was pressed by hand
const tvRefused = new Set();
const tvWilling = (ls) => { const ok = ls.filter((x) => !tvRefused.has(x.id)); return ok.length ? ok : ls; };
window.addEventListener('message', (ev) => {
  const fr = document.querySelector('#tv-b iframe');
  if (!fr || ev.source !== fr.contentWindow || state.tv || state.tvV) return;
  let d = null;
  try { d = JSON.parse(ev.data); } catch { return; }
  if (!d || d.event !== 'onError') return;
  const ls = tvList(), p = tvPlay(ls), e = cur();
  tvRefused.add(p.kind === 'video' && p.video ? p.video.id : p.st.id);
  if (e) followTv(e); else { state.tvAuto = playFor([], [], 'jp', tvWilling(ls)); renderTv(); }
});
function followTv(e) {
  if (!e) return;
  const ls = tvList();
  if (!ls.length) return;
  state.tv = null; state.tvV = null;
  state.tvAuto = playFor(videosOfEvent(e).filter((v) => !tvRefused.has(v.id)), e.members.map(outletOf), e.cover, tvWilling(ls));
  state.tvVids = arr(state.tvAuto.videos);
  renderTv();
}

// ---------------------------------------------------------------- bottom: the source on screen and the next event
function renderStatus() {
  const e = cur();
  const first = e ? [...e.members].sort((a, b) => (a.ts || Infinity) - (b.ts || Infinity))[0] : null;
  const link = first && safeUrl(first.link);
  const a = $('sb-src');
  a.replaceChildren(h('span', { class: 'k', text: '出典' }), first ? h('b', { text: outletOf(first) }) : '—', first && viaGN(first) ? ' · Google ニュース経由' : link ? ` ${hostOf(link)}` : '');
  if (link) { a.href = link; a.removeAttribute('aria-disabled'); } else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); }
}
function renderTicker(force) {
  const box = $('sb-tick');
  const tq = state.tickQ.filter(vis);
  const q = tq.length ? tq : state.pri.filter(vis).slice(0, 1);
  if (!q.length) { box.replaceChildren(h('span', { class: 'k', text: '注目ニュース' }), '0 件'); return; }
  const i = state.tickI % q.length;
  const e = q[i];
  const line = h('span', { class: 'tk' + (force && !reduced() ? ' in' : '') },
    h('span', { class: 'k', text: tq.length ? `新着 ${i + 1}/${q.length}` : `注目ニュース 1/${state.pri.length}` }),
    headNode(e, 'tt'),
    h('span', { class: 'tm', text: ` ${e.n}社${e.topics.length ? ' · ' + e.topics.map(flagJa).join('・') : ''}` }));
  line.addEventListener('click', () => select(e.key, true));
  box.replaceChildren(line);
}

// ---------------------------------------------------------------- about: data, AI run, checks, sources, BYOK
let aboutNode = null;
function aboutEl() {
  if (aboutNode) return aboutNode;
  const det = (id, title, open) => h('details', { id, open: open || null }, h('summary', null, h('span', { text: title }), h('span', { class: 's2', id: id + '-s' })), h('div', { class: 'inner', id: id + '-i' }));
  aboutNode = h('div', { class: 'about' },
    h('div', { class: 'sheet-h' }, h('h2', { text: 'データと AI' }), h('button', { type: 'button', class: 'tbb', text: '閉じる', on: { click: closeAbout } })),
    h('ul', { class: 'floor' }, h('li', { text: '見出しとリンクは各メディアのものです。画像は元の記事の場所から表示しています' }), h('li', { text: 'メディアに左右のラベルは付けません' }),
      h('li', { text: '見出しの真偽は判定しません' }), h('li', { text: '「見当たらない」は、集めたニュースの中での話です' }), h('li', { text: AI_NOTE }), h('li', null, extLink(ISSUES, null, '掲載の停止の依頼'), `・${STOP_NOTE}`)),
    det('ab-scope', '集めた範囲', true), det('ab-ai', 'AI の実行'), det('ab-eval', '検査'), det('ab-src', '媒体の一覧'), det('ab-byok', '自分の AI で実行（任意）'));
  aboutNode.querySelector('#ab-byok-i').append(
    h('p', { class: 'lead', text: '鍵はこのタブの中だけに置き、Google にだけ送ります' }),
    h('p', { class: 'msg', id: 'byok-req' }),
    h('label', { class: 'fld' }, 'モデル', h('input', { id: 'byok-model', type: 'text', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' })),
    h('label', { class: 'fld' }, '鍵', h('input', { id: 'byok-key', type: 'password', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' })),
    h('div', { class: 'btns' },
      h('button', { type: 'button', class: 'btn pri', id: 'byok-run', text: '実行', on: { click: onRun } }),
      h('button', { type: 'button', class: 'btn', id: 'byok-restore', text: '記録済みに戻す', hidden: true, on: { click: onRestore } }),
      h('button', { type: 'button', class: 'btn', id: 'byok-connect', text: '自分の AI につなぐ', on: { click: () => { closeAbout(); openConnect(); } } }),
      extLink('https://aistudio.google.com/apikey', { class: 'btn', id: 'byok-mk' }, 'Gemini の鍵を作る')),
    h('p', { class: 'msg', id: 'byok-msg', role: 'status', 'aria-live': 'polite' }));
  aboutNode.querySelector('#byok-key').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); onRun(); } });
  return aboutNode;
}
const q1 = (sel) => aboutNode && aboutNode.querySelector(sel);
function renderAbout() {
  if (!aboutNode) return;
  const d = state.data;
  const kv = (rows) => h('dl', { class: 'kv' }, rows.flatMap(([k, v, cls]) => [h('dt', { text: k }), v instanceof Node ? h('dd', { class: cls || null }, v) : h('dd', { class: cls || null, text: v })]));
  const rows = arr(d.sources).filter(isObj);
  const fails = rows.filter((r) => r.ok !== true).length;
  q1('#ab-scope-s').textContent = `${rows.length}社`;
  q1('#ab-scope-i').replaceChildren(kv([['組んだ時刻', h('span', { 'data-host': '' }, fmtFull(d.generated_at), ' ', ageEl(d.generated_at, SIX_H))],
    ['時間の幅', `${isNum(d.window_h) ? d.window_h : 36} 時間`], ['メディア', `${rows.length}（取れた ${rows.length - fails}・届かなかった ${fails}）`, fails ? 'err' : null],
    ['引用の扱い', str(d.rights_mode) === 'strict' ? '利用条件を確かめた媒体だけ見出しを表示' : '全ての媒体の見出しを引用（媒体名・時刻・リンク付き）']]));
  const run = isObj(d.ai_run) ? d.ai_run : {};
  const kept = state.snap ? state.snap.kept : null;
  const src = kept ? kept.snapRun : run;
  const st = str(run.status) || '—';
  const n = (v) => (isNum(v) ? String(v) : '—');
  q1('#ab-ai-s').textContent = state.live ? '閲覧者の鍵' : st === 'recorded' ? '記録済み（Claude が書いた・Gemini ではない）' : st;
  const at = kept ? kept.aiAt : run.at;
  const aiRows = [['状態', (state.live ? '閲覧者の鍵 · ' : '') + (kept ? `前回を保持 · ${kept.reason || '—'}` : st), st === 'error' || st === 'partial' ? 'err' : null],
    ['書いた AI', [str(src.provider), str(src.model)].filter(Boolean).join(' · ') || '—'],
    ['時刻', isNum(at) ? h('span', { 'data-host': '' }, fmtFull(at), ' ', ageEl(at, SIX_H)) : '—']];
  if (kept) aiRows.push(['まとめた時刻', fmtFull(kept.fetchedAt)]);
  aiRows.push(['指示の版', str(src.prompt_version) || '—'], ['呼び', `${n(src.calls)}（失敗 ${n(src.calls_failed)}）`, src.calls_failed > 0 ? 'err' : null],
    ['塊', `${n(src.blocks_ok)} / ${n(src.blocks_sent)}`], ['併合・分割', `${n(src.merges)} · ${n(src.splits)}`], ['外した文', `見出しの写し ${n(src.quoted_fields)}`]);
  const errs = arr(run.errors).filter((x) => typeof x === 'string');
  if (errs.length) aiRows.push(['誤り', explain(errs) || errs.join(' '), 'err']);
  q1('#ab-ai-i').replaceChildren(kv(aiRows), str(src.note_ja) ? h('p', { class: 'note', text: str(src.note_ja) }) : null);
  renderEval();
  const ol = h('ol', { class: 'src-list' });
  const g = isNum(d.generated_at) ? d.generated_at : null;
  for (const r of rows) {
    const failed = r.ok !== true;
    const old = !failed && (!isNum(r.fetched_at) || (g != null && r.fetched_at < g - SIX_H));
    const terms = safeUrl(r.terms);
    const ts = TERMS_TEXT[r.terms_status] ? r.terms_status : 'unknown';
    ol.append(h('li', { class: failed || old ? 'bad' : null, 'data-host': '', data: { bad: failed || old ? '1' : '0' } },
      h('span', { class: 'sn', text: str(r.name) || str(r.id) }), h('span', { class: 'st', text: [str(r.type), r.home === 'jp' ? '国内' : '海外'].join('・') }),
      h('span', { class: 'si', text: isNum(r.n) ? `${r.n}` : '—' }), isNum(r.fetched_at) ? ageEl(r.fetched_at, SIX_H) : h('span', { class: 'err-t', text: '未着' }),
      terms ? extLink(terms, { class: 'stm' }, TERMS_TEXT[ts]) : h('span', { class: 'stm', text: TERMS_TEXT[ts] }),
      failed ? h('span', { class: 'err-t', text: str(r.err) || '届かなかった' }) : null));
  }
  q1('#ab-src-s').textContent = fails ? `${rows.length}（届かなかった ${fails}）` : `${rows.length}`;
  q1('#ab-src-i').replaceChildren(ol);
  renderByok();
}
const EVAL_JA = {
  fabricated_ids: '答えに出た、塊に無い id', dup_ids: '二度使った id', unassigned_ids: '取りこぼした id', json_broken: 'JSON として読めない答え', shape_broken: '形の崩れた答え',
  answers_missing: '答えの無い呼び', flags_proposed: 'AI が付けたラベル', flags_vetoed: '規則が外したラベル', quoted_fields: '見出しを写した文', suspect_merges_veto: '疑わしい併合（規則の拒否）',
  suspect_merges_no_shared: '疑わしい併合（共通点なし）', place_misread_known: '地名の読み違い（既知の種類）', calls: '呼び', calls_failed: '失敗した呼び', blocks_sent: '送った塊',
  blocks_answered: '答えのあった塊', ai_stories: 'AI の出来事', merged_stories: '併合した出来事',
};
function renderEval() {
  const box = q1('#ab-eval-i');
  if (!box) return;
  const ev = state.evalData;
  q1('#ab-eval-s').textContent = '形式の検査のみ';
  if (!isObj(ev)) { box.replaceChildren(h('p', { class: 'note', text: '未計測' })); return; }
  const src = isObj(ev.counts) ? ev.counts : ev;
  const rows = [];
  for (const [k, v] of Object.entries(src)) {
    if (rows.length >= 24 || ['version', 'schema', 'made_at', 'at'].includes(k)) continue;
    if (isNum(v)) rows.push([EVAL_JA[k] || k, String(v)]); else if (v === null) rows.push([EVAL_JA[k] || k, '未判定']);
  }
  const human = isObj(ev.human) ? ev.human : null;
  if (human) rows.push(['人の目での確認', isNum(human.reviewed) ? String(human.reviewed) : '未記入']);
  const at = [ev.made_at, ev.at].find(isNum);
  if (at) rows.unshift(['数えた時刻', fmtFull(at)]);
  box.replaceChildren(h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])));
}
async function getJson(path) { try { const res = await fetch(path, { cache: 'no-store', credentials: 'same-origin' }); return res.ok ? await res.json() : null; } catch { return null; } }
// eval.json is never published (tools/assemble_site.py): only a page served from this machine asks for it
const LOCAL = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);
async function loadEval() { if (!LOCAL) return; state.evalData = await getJson(dataDir() + 'eval.json'); if (state.about) renderEval(); }
async function loadDefaultModel() {
  const p = await getJson(dataDir() + 'prompt.json');
  if (p && typeof p.merge_model === 'string' && MODEL_RE.test(p.merge_model)) defaultModel = p.merge_model;
  if (state.about) renderByok();
}
function renderByok() {
  if (!aboutNode) return;
  const reqs = arr(state.base && state.base.ai_requests);
  q1('#byok-req').textContent = `送る要求 ${reqs.length} 回・塊 ${uniq(reqs.flatMap((r) => arr(r && r.bids))).length}`;
  const run = state.base && state.base.ai_run;
  const model = q1('#byok-model');
  if (!model.value) model.value = run && run.provider === 'gemini' && MODEL_RE.test(str(run.model)) ? run.model : defaultModel;
  q1('#byok-run').disabled = state.busy || reqs.length === 0;
  q1('#byok-restore').hidden = !state.live;
  const a = ownActive();   // a connected AI runs it; the key and model fields are for a Gemini key typed for this tab only
  for (const id of ['#byok-model', '#byok-key']) q1(id).closest('label').hidden = !!a;
  q1('#byok-connect').hidden = !!a; q1('#byok-mk').hidden = !!a;
  q1('#ab-byok-i .lead').textContent = a ? `${a.ja} · ${a.model} で実行します。料金はそのアカウントに掛かります` : '鍵はこのタブの中だけに置き、Google にだけ送ります';
}
function byokMsg(text, err) { const m = q1('#byok-msg'); if (!m) return; m.textContent = text; m.classList.toggle('err', !!err); }
function looksLikeData(x) { return isObj(x) && Array.isArray(x.stories) && Array.isArray(x.rule_clusters) && isObj(x.items); }
/** Runs a visitor's key through provider.js and rerun.js (onRun passes the modules it imported). */
export async function byokWith(providerMod, rerunMod, key, model) {
  if (!providerMod || typeof providerMod.geminiProvider !== 'function') throw new Error('provider.js に geminiProvider が無い');
  if (!rerunMod || typeof rerunMod.rerunAI !== 'function') throw new Error('rerun.js に rerunAI が無い');
  let provider = await providerMod.geminiProvider(key, model);
  key = null;
  return byokRun(rerunMod, provider);
}
/** the AI run itself, for any provider (a Gemini key typed here, or the AI the viewer connected) */
async function byokRun(rerunMod, provider) {
  const onProgress = (p) => {
    if (isObj(p)) byokMsg(`実行中 ${[p.rid, isNum(p.done) && isNum(p.total) ? `${p.done}/${p.total}` : '', p.err].filter(Boolean).join(' · ')}`);
    else if (p != null) byokMsg(`実行中 ${String(p)}`);
  };
  let out;
  try { out = await rerunMod.rerunAI(state.base, provider, { onProgress }); } finally { provider = null; }
  if (!looksLikeData(out)) throw new Error('rerunAI の返り値が parallax/1 の形ではない');
  const run = isObj(out.ai_run) ? out.ai_run : {};
  const st = str(run.status) || '—';
  if (st === 'error' || st === 'nokey' || st === 'off') { byokMsg(`${explain(run.errors) || '通りませんでした。'} 記録済みの表示のままです。`, true); return out; }
  state.data = out; state.live = true; state.view = 'ai';
  renderAll();
  if (st === 'partial') byokMsg(`一部だけ通りました。${explain(run.errors)} 通らなかった塊は自動のまとめで出しています。`, true);
  else byokMsg(`完了（呼び ${isNum(run.calls) ? run.calls : '—'}）`);
  return out;
}
function errText(err) {
  const code = err && (err.code || err.padCode || err.message);
  if (typeof code === 'string' && ERR_TEXT[code]) return ERR_TEXT[code];
  const m = err && err.message ? String(err.message) : String(err);
  return m.length > 140 ? m.slice(0, 139) + '…' : m;
}
async function runWithOwn(a) {
  if (!state.base || !arr(state.base.ai_requests).length) { byokMsg('送れる要求がありません', true); return; }
  state.busy = true; renderByok(); byokMsg('読み込み中'); setState('AI を実行中', true);
  try {
    let mods;
    try { mods = await Promise.all([import('./provider.js'), import('./rerun.js')]); } catch { byokMsg('読み込めませんでした。記録済みの表示のままです。', true); return; }
    await byokRun(mods[1], mods[0].makeProvider(a.kind, a.key, a.model));
  } catch (err) { byokMsg(`${errText(err)} 記録済みの表示のままです。`, true); } finally { state.busy = false; renderByok(); setState(''); }
}
async function onRun() {
  if (state.busy) return;
  const own = ownActive();
  if (own) { await runWithOwn(own); return; }
  const keyEl = q1('#byok-key');
  let key = keyEl.value.trim();
  keyEl.value = '';
  const model = q1('#byok-model').value.trim() || defaultModel;
  if (!key) { byokMsg('鍵が空です', true); return; }
  if (!MODEL_RE.test(model)) { key = null; byokMsg('モデルの名が正しくありません', true); return; }
  if (!state.base || !arr(state.base.ai_requests).length) { key = null; byokMsg('送れる要求がありません', true); return; }
  state.busy = true; renderByok(); byokMsg('読み込み中'); setState('AI を実行中', true);
  try {
    let mods;
    try { mods = await Promise.all([import('./provider.js'), import('./rerun.js')]); } catch { byokMsg('読み込めませんでした。記録済みの表示のままです。', true); return; }
    const k = key; key = null;
    await byokWith(mods[0], mods[1], k, model);
  } catch (err) { byokMsg(`${errText(err)} 記録済みの表示のままです。`, true); } finally { key = null; state.busy = false; renderByok(); setState(''); }
}
function onRestore() {
  if (!state.base) return;
  state.data = state.pending || state.base;
  if (state.pending) { state.base = state.pending; state.pending = null; }
  state.live = false;
  renderAll();
  byokMsg('');
}
function openAbout() {
  state.about = true; pause();
  const wrap = $('about-wrap');
  if (!wrap.firstChild || wrap.firstChild !== aboutNode) wrap.replaceChildren(aboutEl());
  wrap.hidden = false;
  renderAbout(); tick();
  return true;
}
function closeAbout() { state.about = false; $('about-wrap').hidden = true; return true; }

// ---------------------------------------------------------------- watch popover
function renderWatch() {
  const es = state.es;
  $('watch-list').replaceChildren(...state.watch.map((t) => h('li', null, h('span', { class: 'wv', text: t }), h('span', { class: 'wn', text: es.filter((e) => e.hits.includes(t)).length }),
    h('button', { type: 'button', class: 'wx', 'aria-label': `${t} を外す`, text: '外す', on: { click: () => setWatch(removeWatch(state.watch, t)) } }))));
  const counts = new Map();
  for (const e of es) for (const p of e.places) counts.set(p, (counts.get(p) || 0) + 1);
  const names = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => pj(k)).filter((n) => !state.watch.includes(n)).slice(0, 8);
  $('watch-suggest').replaceChildren(...names.map((n) => h('button', { type: 'button', class: 'chip', text: n, 'aria-label': `${n} をフォロー`, on: { click: () => setWatch(addWatch(state.watch, n)) } })));
}
function setWatch(list) { state.watch = list; saveWatch(store, list); renderAll(); return true; }

// ---------------------------------------------------------------- state line
function setState(text, busy) {
  const el = $('state');
  const t = text || (state.live ? '閲覧者の鍵の結果' : state.view === 'ai' ? 'AI のまとめ' : '自動のまとめ');
  if (el.textContent !== t) { el.textContent = t; if (!reduced()) { el.classList.remove('beat'); void el.offsetWidth; el.classList.add('beat'); } }
  el.classList.toggle('busy', !!busy);
}

// ---------------------------------------------------------------- selection, views, filters
function select(key, byHand) {
  const fe = state.byKey.get(key);
  if (fe && fe.foldedInto && state.byKey.has(fe.foldedInto)) key = fe.foldedInto;
  if (!state.byKey.has(key)) return false;
  const changed = state.sel !== key;
  state.sel = key;
  if (byHand) pause();
  for (const el of document.querySelectorAll('.rows .r.sel')) el.classList.remove('sel');
  for (const el of document.querySelectorAll(`.rows .r[data-key="${CSS.escape(key)}"]`)) el.classList.add('sel');
  const inPri = document.querySelector(`#pri-b .r[data-key="${CSS.escape(key)}"]`);
  if (inPri && !byHand) inPri.scrollIntoView({ block: 'nearest' });
  if (changed) { renderCase(); renderSources(); renderHours(); renderMap(true); renderMapNews(); followWall(); paintNewsCase(); if (byHand) { followTv(state.byKey.get(key)); recordRead(state.byKey.get(key)); } }
  syncAutoLine();
  return true;
}
function setView(v) {
  if (v !== 'ai' && v !== 'rules') return false;
  if (v === 'ai' && state.hasAI === false) return false;
  state.view = v;
  try { history.replaceState(history.state, '', location.pathname + location.search + '#' + v); } catch { /* */ }
  const keep = state.sel;
  renderAll();
  if (!state.byKey.has(keep)) { state.sel = null; const f = firstShown(); if (f) select(f.key, false); }
  return true;
}
function setTopic(id) {
  if (id !== 'all' && id !== 'watch' && !TOPICS.some((t) => t.id === id)) { const t = TOPICS.find((x) => x.ja === id || x.ja.includes(id) || flagJa(x.id) === id); if (!t) return false; id = t.id; }
  state.topic = id; renderPri(); return true;
}
function setField(f, byHand) {
  if (!state.fieldTabs.includes(f)) return false;
  state.field = f; if (byHand) state.fieldAt = Date.now();
  renderFields(); return true;
}
/** the field that took the most new events moves forward by itself, unless the visitor chose one in the last 5 minutes */
function followField() {
  if (Date.now() - state.fieldAt < FIELD_HOLD_MS || !state.newKeys.size) return;
  const c = new Map();
  for (const e of state.es) if (state.newKeys.has(e.mk)) c.set(e.field, (c.get(e.field) || 0) + 1);
  const best = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best && (!state.fieldTabs.length || state.fieldTabs.includes(best[0]))) state.field = best[0];
}
function step(dir, pool) {
  let list = shownPri().filter((e) => !folded(e));
  if (pool) list = pool(list);
  if (!list.length) return false;
  const i = list.findIndex((e) => e.key === state.sel);
  const n = list[(i + dir + list.length) % list.length];
  select(n.key, false);
  return true;
}
function find(q) {
  const sid = String(q).trim();
  if (/^s[0-9a-f]{8,}$/.test(sid)) {
    const want = state.leadOf.get(sid) || sid;
    const se = state.es.find((x) => x.kind === 'story' && x.obj.sid === want);
    if (se) { select(se.key, true); return se.heading.text; }
  }
  const e = state.es.filter((x) => !x.foldedInto && x.hay.toLowerCase().includes(String(q).toLowerCase())).sort((a, b) => b.n - a.n)[0];
  if (!e) return false;
  select(e.key, true);
  return e.heading.text;
}

function renderAll() {
  try {
    state.ix = index(state.data);
    state.leadOf = new Map();
    for (const ev of arr(state.board && state.board.events)) if (isObj(ev) && str(ev.lead)) for (const sid of arr(ev.sids)) if (sid !== ev.lead) state.leadOf.set(sid, ev.lead);
    const kept = state.live ? null : keptView(state.data);
    state.snap = kept ? { kept, data: kept.view, ix: index(kept.view) } : null;
    state.hasAI = state.live || !!state.snap || arr(state.data.stories).some((x) => isObj(x) && x.origin === 'ai');
    if (!state.hasAI && state.view === 'ai') state.view = 'rules';
    state.sumBy = null;
    state.es = buildEntries();
    state.byKey = new Map(state.es.map((e) => [e.key, e]));
    state.pri = priorityOf(state.es);
    if (state.sel && !state.byKey.has(state.sel)) state.sel = null;
    $('fatal').hidden = true;
    followField();
    renderBar(); setState('');
    renderSources(); renderHours(); renderFields();
    renderPri(); renderAnom();
    renderCase(); renderMap(false);
    renderCount(); renderHaz(); renderMkt(); renderPol(); renderTv();
    renderTicker(false); renderWatch(); renderHid(); renderEntryView(); sceneTick();
    renderFlash(); renderRankHome(); renderLocal();
    if (state.panel) state.panel.render();
    if (state.about) renderAbout();
    if (state.sheet) renderSheet();
    renderSect();
    tick();
  } catch (err) {
    showFatal(`表示できませんでした: ${err && err.message ? err.message : String(err)}`);
  }
}
/** the loading face (a skeleton in the home, js/theme_boot.js sets the flag before the first paint) ends when the data is in or cannot come */
function endLoad() { delete document.documentElement.dataset.load; }
function showFatal(text) { const el = $('fatal'); el.textContent = text; el.hidden = false; endLoad(); }

// ---------------------------------------------------------------- idle: send the priority events
function pause() {
  state.pausedUntil = Date.now() + PAUSE_MS;
  state.autoNext = state.pausedUntil + AUTO_MS;
  syncAutoLine();
}
function syncAutoLine() {
  const line = document.querySelector('#pri-b .r.sel .autoline');
  if (!line) return;
  const now = Date.now();
  const held = state.stopped || !state.set.motion.cases || now < state.pausedUntil || state.about || !!state.sheet || setOpen();
  line.classList.toggle('held', held);
  line.classList.remove('run');
  if (!held) { line.style.setProperty('--auto-ms', `${Math.max(0, state.autoNext - now)}ms`); void line.offsetWidth; line.classList.add('run'); }
}
function autoStep() {
  if (narrow() || state.about || state.sheet || state.stopped || (state.tour && state.tour.isOpen()) || !state.set.motion.cases || setOpen() || document.hidden) return;
  if (state.sect !== 'home') return;                           // another screen is being read: the event in focus stays
  if ($('board').dataset.wall === '1') return;                 // several events are being read: nothing moves by itself
  const now = Date.now();
  if (now < state.pausedUntil) return;
  const line = document.querySelector('#pri-b .r.sel .autoline');
  if (line && line.classList.contains('held')) syncAutoLine();
  if (now < state.autoNext) return;
  state.autoNext = now + AUTO_MS;
  step(1, homeMode() === 'home' ? leadPool : null);   // the home's lead walks the fields of the news; the bin of "other" is for a hand that asks for it
}
function tickerStep() {
  if (document.hidden) return;
  if (state.tickQ.length > 1 || Date.now() - state.tickAt > 60000) { state.tickI++; renderTicker(true); }
}

// ---------------------------------------------------------------- since the last visit, and live updates
function keysOf(d) { return arr(d && d.stories).map((x) => memberKey(x.member_ids)); }
function loadSeen() { try { const j = store ? JSON.parse(store.getItem(SEEN_KEY) || 'null') : null; return isObj(j) && Array.isArray(j.keys) ? j : null; } catch { return null; } }
function seeData(d) {
  const sn = nextSeen(loadSeen(), d.generated_at, keysOf(d), Date.now());
  state.prevSeen = sn.prev; state.seenSince = sn.since; state.newKeys = new Set(sn.fresh);
  state.tickQ = []; state.tickI = 0; state.tickAt = Date.now();
  try { store && store.setItem(SEEN_KEY, JSON.stringify(sn.save)); } catch { /* this visit only */ }
}
async function poll() {
  if (document.hidden) return;
  const d = await getJson(state.dataPath);
  if (!looksLikeData(d) || !state.base || d.generated_at === state.base.generated_at) return;
  if (state.live) { state.pending = d; setState(`新しいデータ ${fmtShort(d.generated_at)}・記録済みに戻すと読込`); return; }
  const board = await getJson(dataDir() + 'board.json');
  if (isObj(board) && board.schema === 'parallax-board/1') state.board = board;
  tidyGovTitles(d);
  state.base = d; state.data = d;
  seeData(d);
  state.flashed.clear();
  renderAll();
  state.tickQ = state.pri.filter((e) => state.newKeys.has(e.mk));
  renderTicker(true);
  setState(`更新 ${fmtShort(d.generated_at)}・新しい出来事 ${state.newKeys.size}`);
  loadEval();
  loadSide();
}
async function loadHaz() {
  const hz = await loadHazards(dataDir(), nowS());
  // quakes that are new in the data: on the first look, those of the last 3 hours; later, those not seen before
  const ids = (hz && Array.isArray(hz.quakes) ? hz.quakes : []).filter((q) => q && q.id != null);
  const t = isNum(hz && hz.at) ? hz.at : nowS();
  state.hazFresh = new Set(ids.filter((q) => (state.hazSeen ? !state.hazSeen.has(q.id) : isNum(q.ts) && t - q.ts < 3 * 3600)).map((q) => q.id));
  state.hazSeen = new Set(ids.map((q) => q.id));
  state.haz = hz;
  sceneTick();
  renderHaz(); renderMap(false); renderFlash();
  if (cur()) renderCase();
  if (state.sheet === 'haz') renderSheet();
  if (state.sect === 'disaster') renderSect();
}
async function loadSide() {
  const [m, p, hs, cr] = await Promise.all([getJson(dataDir() + 'markets.json'), getJson(dataDir() + 'politics.json'), getJson(dataDir() + 'history.json'), getJson(dataDir() + 'critical.json')]);
  state.mkt = isObj(m) ? m : null;
  state.pol = isObj(p) ? p : null;
  state.crit = isObj(cr) ? cr : null;
  state.hist = isObj(hs) ? hs : null;
  renderMkt(); renderPol();
  if (cur()) renderCase();
  if (state.sheet === 'mkt' || state.sheet === 'pol') renderSheet();
  if (state.sect === 'market' || state.sect === 'politics') renderSect();
}

// ---------------------------------------------------------------- sheets: a pane opened toward the viewer — one big number, the facts, then everything
const SHEETS = { keys: 'キーの一覧', outlet: 'メディア', case: 'ニュース詳細', src: 'メディア', hours: '時間別の件数', pri: '注目ニュース', anom: '片側だけのニュース', mkt: '市場', pol: '政治', haz: '災害' };
const SHEET_PANE = { src: 'p-src', hours: 'p-hours', pri: 'p-pri', anom: 'p-anom', mkt: 'p-mkt', pol: 'p-pol', haz: 'p-haz' };
const SHEET_ALIAS = { 源: 'src', ソース: 'src', 情報源: 'src', 媒体: 'src', 時間ごと: 'hours', 時間: 'hours', 注目: 'pri', 非対称: 'anom', 一部の媒体だけ: 'anom', 市場: 'mkt', 政治: 'pol', 災害: 'haz' };
const sheetKind = (k) => { const x = String(k || '').trim(); return SHEETS[x] ? x : SHEET_ALIAS[x] || null; };
const fmtN = (v) => (isNum(v) ? v.toLocaleString('ja-JP') : '—');
const td = (v, c) => h('td', { class: c || null }, v == null ? '—' : v);
const tbl = (cols, rows, cls) => h('table', { class: 'dt' + (cls ? ' ' + cls : '') },
  h('thead', null, h('tr', null, cols.map(([t, c]) => h('th', { class: c || null, text: t })))), h('tbody', null, rows));
const sec = (title, n) => h('h3', { class: 'ds-sec' }, title, n != null ? h('span', { class: 'n', text: n }) : null);
const chev = () => s('svg', { viewBox: '0 0 12 12', 'aria-hidden': 'true' }, s('path', { d: 'M7 1.5h3.5V5M10.5 1.5L7 5M5 10.5H1.5V7M1.5 10.5L5 7' }));
/** a pane head that opens its pane at full size: the whole head is the control, with the expand mark at its end for the keyboard */
function canOpen(ph, name, open) {
  ph.classList.add('can-open');
  ph.title = `${name}を拡大`;
  ph.append(h('button', { type: 'button', class: 'ph-open', 'aria-label': `${name}を拡大`, on: { click: (ev) => { ev.stopPropagation(); open(); } } }, chev()));
  ph.addEventListener('click', (ev) => { if (ev.target.closest && ev.target.closest('a, input, button:not(.ph-open)')) return; open(); });
}


function heatSvg(rows, n, label) {
  const max = Math.max(1, ...rows.flatMap(([, v]) => v.filter(isNum)));
  const L = 96, W = 980, cw = (W - L) / n, rh = 16;
  const svg = s('svg', { viewBox: `0 0 ${W} ${rows.length * rh + 4}`, class: 'ds-heat', role: 'img', 'aria-label': label });
  rows.forEach(([name, v], r) => {
    svg.append(s('text', { x: 0, y: r * rh + 12, class: 'lt' }, document.createTextNode(name)));
    v.forEach((x, i) => { if (!isNum(x) || !x) return; svg.append(s('rect', { x: (L + i * cw + 0.5).toFixed(1), y: r * rh + 2, width: Math.max(1, cw - 1.5).toFixed(1), height: rh - 4, class: 'hc', 'fill-opacity': (0.1 + 0.85 * Math.sqrt(x / max)).toFixed(2) }, s('title', {}, document.createTextNode(`${name} ${x}`)))); });
  });
  return svg;
}
/** the market as small figures, each on its own scale, for the whole screen: the last 90 days, one line, with the value of a day under the pointer */
function mktGrid(ok) {
  const card = (x) => {
    const pts = arr(x.spark).filter((p) => Array.isArray(p) && isNum(p[1]));
    if (pts.length < 2) return null;
    const rate = x.unit === '%', val = (v) => `${v.toLocaleString('ja-JP', { maximumFractionDigits: rate ? 3 : 2 })}${rate ? '%' : ''}`;
    const vs = pts.map((p) => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), W = 280, H = 64, step = W / (pts.length - 1);
    const Y = (v) => (hi === lo ? H / 2 : 3 + (1 - (v - lo) / (hi - lo)) * (H - 6));
    const day = (t) => { const p = tparts(t); return `${Number(p.month)}/${Number(p.day)}`; };
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'mk-s', role: 'img', preserveAspectRatio: 'none', 'aria-label': `${str(x.name_ja)} 90 日` },
      s('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(''), 'vector-effect': 'non-scaling-stroke' }));
    pts.forEach((p, i) => svg.append(s('rect', { class: 'h', x: (i * step - step / 2).toFixed(1), y: 0, width: step.toFixed(1), height: H }, s('title', {}, document.createTextNode(`${day(p[0])} ${val(p[1])}`)))));
    const c = rate ? x.chg_bp : x.chg_pct;
    return h('figure', { class: 'mk-c' },
      h('figcaption', null, h('span', { class: 'mk-n', text: str(x.name_ja) }), h('b', { class: 'num', text: isNum(x.last) ? val(x.last) : '—' }), h('span', { class: 'mk-d num', text: isNum(c) ? `${c > 0 ? '+' : ''}${rate ? c.toFixed(1) + 'bp' : c.toFixed(2) + '%'}` : '—' })),
      svg, h('div', { class: 'mk-a num' }, h('span', { text: day(pts[0][0]) }), h('span', { text: `${val(lo)} 〜 ${val(hi)}` }), h('span', { text: day(pts[pts.length - 1][0]) })));
  };
  return h('div', { class: 'mk-g' }, ok.map(card));
}
const KEYS = [['Ctrl K・/', '検索と操作'], ['Alt 1〜8', '画面の切り替え'], ['j k ↑ ↓', '次の・前のニュース'], ['n', '一度に見る数'], ['l', '並べ方'], ['[ ]', '前の・次のページ'], ['m', '地図を開く・戻る'], ['w', '世界の地図'], ['+ -', '地図の拡大・縮小'],
  ['o', '最初の記事を開く'], ['t', '保存'], ['c', '共有'], ['a r', 'AI・自動のまとめ'], ['1〜7', 'ラベルで絞る'], ['v', '声で操作'], ['i', 'データと AI'], [',', '設定'], ['?', 'この一覧'], ['Esc', '閉じる']];
const SHEET_BODY = {
  case() { const e = cur(); return { bare: true, body: e ? [caseNode(e)] : [h('p', { class: 'empty big', text: '出来事 0 件' })] }; },
  src() {
    const b = state.board, d = state.data;
    const rows = b && Array.isArray(b.sources) ? b.sources.filter(isObj) : arr(d.sources).filter(isObj).map((r) => ({ ...r, h48: r.n }));
    const stale = new Set(arr(b && b.health && b.health.stale_72h));
    const bad = (r) => r.ok !== true || stale.has(r.id);
    const live = rows.filter((r) => r.ok === true).length;
    const types = uniq([...TYPE_ORDER.filter((t) => rows.some((r) => r.type === t)), ...rows.map((r) => r.type)]);
    const x = b && isObj(b.examined) ? b.examined : {};
    const lsrc = new Map(arr(d.sources).filter(isObj).map((r) => [r.id, r]));
    const dropOf = (r) => { const l = lsrc.get(r.id) || r; const v = l.dropped; return isNum(v) ? v : isObj(v) ? Object.values(v).filter(isNum).reduce((a, n) => a + n, 0) : null; };
    const anyDrop = rows.some((r) => dropOf(r) != null);
    const anyQ = rows.some((r) => r.via === 'gnews' || str(r.query));
    const staleJa = (b && isObj(b.health) && str(b.health.stale_label_ja)) || '更新なし';
    const cn = counts();
    const body = [];
    for (const t of types) {
      const rs = rows.filter((r) => r.type === t).sort((p, q) => (q.h48 || 0) - (p.h48 || 0));
      body.push(sec(t, `${rs.filter((r) => !bad(r)).length} / ${rs.length}`));
      body.push(tbl([['メディア'], ['', 'opt'], ['状態'], ...(anyQ ? [['経由・検索の語', 'opt']] : []), ['1時間', 'r'], ['6時間', 'r'], ['48時間', 'r'], ['最新', 'r opt'], ...(anyDrop ? [['外した', 'r opt']] : [])], rs.map((r) => h('tr', { class: bad(r) ? 'bad' : null },
        td(lk(str(r.name), () => openOutlet(str((lsrc.get(r.id) || r).outlet) || str(r.name)), 'このメディアが扱ったニュース', 'op-lk')), td(r.home === 'intl' ? '海外' : '国内', 'dim opt'), td(bad(r) ? (str(r.err) || staleJa) : '届いた', bad(r) ? 'err' : 'dim'), ...(anyQ ? [td(r.via === 'gnews' ? `Google ニュース${str(r.query) ? '「' + str(r.query) + '」' : ''}` : '', 'dim opt')] : []),
        td(fmtN(r.h1), 'r'), td(fmtN(r.h6), 'r'), td(fmtN(r.h48), 'r'), td(isNum(r.age_h) ? `${r.age_h}時間前` : '—', 'r dim opt'), ...(anyDrop ? [td(fmtN(dropOf(r)), 'r dim opt')] : [])))));
    }
    return { big: fmtN(live), unit: `/ ${rows.length} 届いた媒体`, bad: live < rows.length * 0.8,
      facts: cn && isObj(cn.headlines) ? [['見出しの件数', fmtN(cn.headlines.fetched)], ['期間内の見出し', fmtN(cn.headlines.in_window)], ['出来事', fmtN(cn.bundles && cn.bundles.events)], ['2 社以上', fmtN(cn.multi_outlet)],
        [staleJa, fmtN(stale.size), stale.size ? 'err' : ''], ['事件の層', fmtN(cn.incidents)]] : [['見出しの件数', fmtN(x.fetched_items)], ['期間内の見出し', fmtN(x.in_window)], ['出来事', fmtN(x.stories)], ['2 社以上', fmtN(x.multi_outlet)], ['一次資料', fmtN(x.primary_items)],
        [staleJa, fmtN(stale.size), stale.size ? 'err' : ''], ['事件の層', isNum(x.events) ? `${x.events}・畳んだ束 ${fmtN(x.stories_folded)}` : '—']], body };
  },
  hours() {
    const b = state.board, vol = b && isObj(b.volume) ? b.volume : null;
    if (!vol || !Array.isArray(vol.total)) return { big: '—', unit: '', facts: [], body: [h('p', { class: 'empty', text: '時間ごとの数が無い' })] };
    const to = b.generated_at, n = vol.total.length, bins = [...vol.total].reverse(), from = to - n * 3600;
    const max = Math.max(1, ...bins), peak = bins.indexOf(max);
    const pri = new Set(arr(b.priority)), priAgo = new Map();
    for (const p of arr(b.slab && b.slab.pillars)) if (isObj(p) && pri.has(p.sid) && isNum(p.h)) priAgo.set(p.h, (priAgo.get(p.h) || 0) + 1);
    const W = 980, H = 150, bw = W / n;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H + 22}`, class: 'ds-bars', role: 'img', 'aria-label': '48 時間の件数' });
    for (const f of [0.5, 1]) svg.append(s('line', { x1: 0, x2: W, y1: (H - f * H + 0.5).toFixed(1), y2: (H - f * H + 0.5).toFixed(1), class: 'gl' }), s('text', { x: W, y: H - f * H - 3, class: 'ax end' }, document.createTextNode(String(Math.round(max * f)))));
    bins.forEach((v, i) => {
      const ago = n - 1 - i, hh = (v / max) * H;
      svg.append(s('rect', { x: (i * bw + 1).toFixed(1), y: (H - hh).toFixed(1), width: (bw - 2).toFixed(1), height: Math.max(0.5, hh).toFixed(1), class: priAgo.has(ago) ? 'pri' : '' },
        s('title', {}, document.createTextNode(`${fmtShort(from + i * 3600)}〜 ${v} 件${priAgo.has(ago) ? `・注目の最初の報道 ${priAgo.get(ago)}` : ''}`))));
      if (i % 6 === 0) svg.append(s('text', { x: i * bw + 1, y: H + 16, class: 'ax' }, document.createTextNode(fmtShort(from + i * 3600))));
    });
    const bt = isObj(vol.by_type) ? vol.by_type : {};
    const types = uniq([...TYPE_ORDER.filter((t) => Array.isArray(bt[t])), ...Object.keys(bt).filter((t) => Array.isArray(bt[t]))]);
    const body = [sec('時間ごと', `${n} 時間`), svg, sec('種類 × 時間', types.length), heatSvg(types.map((t) => [t, [...bt[t]].reverse()]), n, '種類ごとの時間ごとの数')];
    if (b.slab && Array.isArray(b.slab.cats) && Array.isArray(b.slab.grid)) body.push(sec('分野 × 時間', b.slab.cats.length), heatSvg(b.slab.cats.map((c, i) => [c, [...arr(b.slab.grid[i])].reverse()]), n, '分野ごとの時間ごとの数'));
    return { big: fmtN(bins[n - 1]), unit: '直近 1 時間の件数',
      facts: [[`${n}時間`, fmtN(bins.reduce((a, v) => a + v, 0))], ['最多', `${fmtN(max)}・${fmtShort(from + peak * 3600)}`], ['注目ニュースの最初の報道', `${priAgo.size} 時間帯`], ['種類', fmtN(types.length)]], body };
  },
  pri() {
    const list = shownPri();
    const rows = list.map((e, i) => h('tr', { class: 'go' + (e.key === state.sel ? ' sel' : ''), on: { click: () => { closeSheet(); select(e.key, true); } } },
      td(String(i + 1), 'r dim'), td(e.topics.map(flagJa).join('・') || '—', 'flagc'), folded(e) ? td(`隠した・${reasonJa(e.hid)}に当たる`, 'dim') : td(e.heading.text, 'tt'), td(`${e.n}`, 'r'), td(e.field, 'dim opt'),
      td(e.case ? arr(e.case.hits).slice(0, 4).join('・') : '', 'dim opt'), td(fmtAge(e.last), 'r dim')));
    return { big: fmtN(list.length), unit: state.q ? `「${state.q}」の一致` : state.topic === 'all' ? '注目ニュース' : `注目・${state.topic === 'watch' ? 'フォロー' : state.topic === 'cross' ? '国内と海外' : flagJa(state.topic)}`,
      facts: TOPICS.map((t) => [flagJa(t.id), fmtN(state.pri.filter((e) => e.topics.includes(t.id)).length)]),
      body: [tbl([['', 'r'], ['旗'], ['見出し'], ['メディア', 'r'], ['分野', 'opt'], ['共通する言葉', 'opt'], ['最新', 'r']], rows)], foot: '旗は公開した自動のラベル' };
  },
  outlet() {
    const o = str(state.outlet);
    const p = outletProfile(state.es.filter((e) => !e.foldedInto && vis(e)), o, { outletOf });
    const src = arr(state.data.sources).find((r) => isObj(r) && (str(r.outlet) === o || str(r.name) === o)) || {};
    const kind = [str(src.type) === GOV ? '官公庁の発表' : str(src.type), src.home === 'intl' ? '海外' : src.home ? '国内' : ''].filter(Boolean).join('・');
    const top = p.fields.length ? p.fields[0][1] : 1;
    const body = [];
    if (p.fields.length) body.push(sec('分野', p.fields.length), h('ul', { class: 'me-bars op-bars' }, p.fields.slice(0, 8).map(([f, n]) => h('li', null,
      h('span', { class: 'k', text: f }), h('span', { class: 'b' }, h('i', { style: `width:${Math.max(2, (n / top) * 100).toFixed(1)}%` })), h('b', { class: 'num', text: n }), h('span', { class: 'pc num', text: `${Math.round((n / p.n) * 100)}%` })))));
    body.push(sec('扱ったニュース', p.n), p.n ? h('ul', { class: 'rows' }, p.rows.slice(0, 40).map((x) => row(x.e, { press: openCase }))) : h('p', { class: 'empty', text: '集めたニュースには、このメディアの見出しが見当たりません。' }),
      h('p', { class: 'op-go' }, h('button', { type: 'button', class: 'tbb', on: { click: () => { closeSheet(); searchFor(o); setSect('news', 'now'); } } }, 'このメディアの見出しを探す')));
    const lag = isNum(p.lagMed) ? (p.lagMed < 60 ? '1分未満' : fmtSpan(p.lagMed)) : '—';
    return { big: fmtN(p.n), unit: `${o}${kind ? `（${kind}）` : ''} が扱ったニュース`, facts: p.multi ? [['2 社以上のニュース', fmtN(p.multi)], ['最初に報じた', fmtN(p.first)], ['最初の報道からの遅れ（中央値）', lag]] : [],
      body, foot: '集めたニュースの中での数です。最初の報道の回数と遅れは、2 社以上が載せたニュースだけで数えています。' };
  },
  anom() {
    const rows = anomRows();
    const kinds = uniq(rows.map((r) => r.ja));
    const groups = sideGroups(false), CAP = 12;
    const sideRows = (es) => h('ul', { class: 'rows' }, es.map((e) => row(e, { press: openCase, compact: true })));
    const body = groups.length ? [sec(ONE_SIDE_TITLE, groups.reduce((a, g) => a + g.events.length, 0)), h('p', { class: 'anom-rule', text: ONE_SIDE_NOTE }),
      h('div', { class: 'os-cols', style: `--n:${groups.length}` }, groups.map((g) => h('section', { class: 'os-col', data: { side: g.side } },
        h('h4', null, lineIcon(g.side), h('span', { text: g.ja }), h('span', { class: 'n num', text: g.events.length })),
        h('p', { class: 'os-rule', text: g.rule }), sideRows(g.events.slice(0, CAP)),
        g.events.length > CAP ? h('details', { class: 'os-more' }, h('summary', { text: `残り ${g.events.length - CAP} 件` }), sideRows(g.events.slice(CAP))) : null)))] : [];
    for (const k of kinds) {
      const rs = rows.filter((r) => r.ja === k);
      body.push(sec(k, rs.length), rs[0].tip ? h('p', { class: 'anom-rule', text: `${rs[0].tip}。` }) : null, tbl([['見出し'], ['メディア', 'r'], ['種類', 'opt'], ['最新', 'r']], rs.map((r) => h('tr', { class: 'go', on: { click: () => { closeSheet(); select(r.e.key, true); } } },
        td(r.e.heading.text, 'tt'), td(`${r.e.n}`, 'r'), td(uniq(r.e.members.map((it) => it.type)).join('・'), 'dim opt'), td(fmtAge(r.e.last), 'r dim')))));
    }
    return { big: fmtN(new Set([...rows.map((r) => r.e), ...groups.flatMap((g) => g.events)]).size), unit: '片側だけのニュース',
      facts: [...groups.map((g) => [g.short, fmtN(g.events.length)]), ...kinds.map((k) => [k, fmtN(rows.filter((r) => r.ja === k).length)])], body: body.length ? body : [h('p', { class: 'empty', text: '0 件' })], foot: `自動のラベル・${noteJa()}` };
  },
  mkt() {
    const m = state.mkt;
    if (!m || !Array.isArray(m.series)) return { big: '—', unit: '市場のデータを読めない', facts: [], body: [] };
    const ok = m.series.filter((x) => isObj(x) && x.ok);
    const mv = (x) => (x.unit === '%' ? Math.abs(x.chg_bp || 0) / 5 : Math.abs(x.chg_pct || 0));
    const chg = (x) => { const rate = x.unit === '%', c = rate ? x.chg_bp : x.chg_pct; return isNum(c) ? `${c > 0 ? '+' : ''}${rate ? c.toFixed(1) + 'bp' : c.toFixed(2) + '%'}` : '—'; };
    const top = [...ok].sort((a, b2) => mv(b2) - mv(a))[0];
    const GROUP = { rates: '金利', fx: '為替', commodity: '商品' };
    const body = state.sect === 'market' && !state.sheet ? [mktGrid(ok)] : [];
    for (const g of uniq(m.series.filter(isObj).map((x) => x.group))) {
      const rs = m.series.filter((x) => isObj(x) && x.group === g);
      body.push(sec(GROUP[g] || g, rs.length), tbl([['名'], ['90 日', 'opt'], ['値', 'r'], ['前日比', 'r'], ['1か月', 'r opt'], ['RSI', 'r opt'], ['基調', 'opt'], ['値の日付', 'r'], ['出典', 'opt']], rs.map((x) => {
        const ta = isObj(x.ta) && x.ta.ok ? x.ta : null, rate = x.unit === '%';
        const c = rate ? x.chg_bp : x.chg_pct;
        return h('tr', { class: (isNum(x.age_days) && x.age_days >= 5) || !x.ok ? 'bad' : null },
          td(str(x.name_ja)), td(spark(x.spark, 120, 26), 'opt'), td(isNum(x.last) ? `${x.last.toLocaleString('ja-JP', { maximumFractionDigits: rate ? 3 : 2 })}${rate ? '%' : ''}` : '—', 'r'),
          td(chg(x), 'r' + (isNum(c) && c < 0 ? ' hot' : '')), td(ta && isNum(ta.chg && ta.chg.m1) ? `${ta.chg.m1}${rate ? 'bp' : '%'}` : '—', 'r dim opt'),
          td(ta && isNum(ta.rsi) ? String(Math.round(ta.rsi)) : '—', 'r dim opt'), td(ta ? str(ta.trend) || '—' : '—', 'dim opt'), td(str(x.as_of).slice(5).replace('-', '/') || '—', 'r dim'),
          td(x.source && safeUrl(x.source.url) ? extLink(safeUrl(x.source.url), {}, str(x.source.name) || '出典') : str(x.source && x.source.name), 'dim opt'));
      })));
    }
    return { big: top ? chg(top) : '—', unit: top ? `${str(top.name_ja)}・最大の動き` : '', bad: false,
      facts: [['系列', `${ok.length} / ${m.series.length}`], ['更新', fmtShort(m.generated_at)], ['国債の日付', str(m.jgb && m.jgb.date) || '—']], body, foot: str(m.note_ja) || '売買の推奨ではありません' };
  },
  keys() {
    return { bare: true, body: [tbl([['キー'], ['すること']], KEYS.map(([k, ja]) => h('tr', null, td(h('kbd', { text: k })), td(ja)))),
      h('p', { class: 'keys-go' }, h('button', { type: 'button', class: 'tbb', on: { click: () => { closeSheet(); $('tour-btn').click(); } } }, '使い方をもう一度見る'))] };
  },
  pol() { return politics().sheet(state.pol, state.crit, sceneNow()); },
  haz() {
    const hz = state.haz;
    if (!hz) return { big: '—', unit: '読込中', facts: [], body: [] };
    const SH = ['1', '2', '3', '4', '5-', '5+', '6-', '6+', '7'];
    const qs = [...hz.quakes].sort((a, b2) => b2.ts - a.ts);
    const big = [...qs].sort((a, b2) => b2.mag - a.mag)[0];
    const shMax = qs.filter((q) => q.shindo).sort((a, b2) => SH.indexOf(b2.shindo) - SH.indexOf(a.shindo))[0];
    const hot = (q) => q.mag >= 5 || ['4', '5-', '5+', '6-', '6+', '7'].includes(q.shindo);
    const dis = [...hz.disasters].sort((a, b2) => ['Red', 'Orange', 'Green'].indexOf(a.alert) - ['Red', 'Orange', 'Green'].indexOf(b2.alert));
    const quakes = [sec('地震', qs.length), tbl([['時刻'], ['規模', 'r'], ['震度'], ['場所'], ['深さ', 'r opt'], ['メディア', 'opt']], qs.map((q) => h('tr', { class: 'go' + (hot(q) ? ' hotr' : ''), on: { click: () => openUrl(q.url) } },
      td(fmtShort(q.ts), 'dim'), td(`M${q.mag.toFixed(1)}`, 'r' + (hot(q) ? ' hot' : '')), td(q.shindo ? `震度${shindoJa(q.shindo)}` : '—', hot(q) ? 'hot' : 'dim'), td(q.place || '—'), td(isNum(q.depthKm) ? `${Math.round(q.depthKm)} km` : '—', 'r dim opt'), td(q.src === 'jma' ? '気象庁' : 'USGS', 'dim opt'))))];
    const ty = hz.typhoons.map((t) => [sec(t.name || '台風', t.src && t.src !== 'JMA' ? t.src : '気象庁'),
      h('dl', { class: 'kv' }, ...[['気圧', isNum(t.pressure) ? `${t.pressure} hPa` : '—'], ['最大風速', isNum(t.windMs) ? `${t.windMs} m/s` : '—'], ['位置', t.location || '—'], ['進路', [t.course, isNum(t.speedKmh) ? `${t.speedKmh} km/h` : ''].filter(Boolean).join(' ') || '—'],
        ['暴風域', t.stormKm ? `${t.stormKm} km` : '—'], ['強風域', t.galeKm ? `${t.galeKm} km` : '—'], ['発表', fmtShort(t.ts)]].flatMap(([a, v]) => [h('dt', { text: a }), h('dd', { text: v })])),
      t.forecast.length ? tbl([['予報'], ['中心'], ['予報円', 'r']], t.forecast.map((f) => h('tr', null, td(fmtShort(f.ts), 'dim'), td(`${f.center[0].toFixed(1)}°N ${f.center[1].toFixed(1)}°E`), td(f.radiusKm ? `${Math.round(f.radiusKm)} km` : '—', 'r')))) : null]);
    const right = [...ty.flat(), sec('災害', dis.length), dis.length ? tbl([['警報'], ['種類'], ['名']], dis.map((x) => h('tr', { class: 'go', on: { click: () => openUrl(x.url) } },
      td(x.alert === 'Red' ? '赤' : x.alert === 'Orange' ? '橙' : x.alert === 'Green' ? '緑' : str(x.alert), x.alert === 'Red' || x.alert === 'Orange' ? 'hot' : 'dim'), td(x.typeJa || disasterJa(x.type), 'dim'), td(str(x.name), 'tt')))) : h('p', { class: 'empty sm', text: '0 件' })];
    return { big: fmtN(qs.length), unit: '24 時間の地震',
      facts: [['最大', big ? `M${big.mag.toFixed(1)}・${big.place || '—'}` : '—', big && hot(big) ? 'err' : ''], ['最大の震度', shMax ? `${shindoJa(shMax.shindo)}・${shMax.place || '—'}` : '—'], ['台風', fmtN(hz.typhoons.length)],
        ['災害（橙・赤）', fmtN(dis.filter((x) => x.alert === 'Red' || x.alert === 'Orange').length)], ['津波', fmtN(arr(hz.tsunami).length)], ['更新', isNum(hz.at) ? fmtShort(hz.at) : '—']],
      body: [h('div', { class: 'ds-cols' }, h('div', null, quakes), h('div', null, right))], foot: '気象庁・USGS・GDACS' };
  },
};
const headBits = (r) => h('div', { class: 'ds-head' },
  h('div', { class: 'ds-big' + (r.bad ? ' stale' : '') }, h('b', { class: 'num', text: r.big }), h('span', { class: 'u', text: r.unit })),
  h('dl', { class: 'ds-facts' }, (r.facts || []).filter(Boolean).flatMap(([dt, dd, cls]) => [h('dt', { text: dt }), h('dd', { class: cls || null, text: dd })])));
function renderSheet() {
  const k = state.sheet;
  if (!k) return;
  let r;
  try { r = SHEET_BODY[k](); } catch (err) { r = { big: '—', unit: '', facts: [], body: [h('p', { class: 'empty', text: `表示できませんでした: ${err && err.message ? err.message : String(err)}` })] }; }
  const box = $('sheet').querySelector('.dsheet');
  const keep = box.querySelector('.ds-b') ? box.querySelector('.ds-b').scrollTop : 0;
  box.replaceChildren(
    h('header', { class: 'ds-h' },
      h('div', { class: 'ds-t' }, h('h2', { id: 'ds-title', text: SHEETS[k] }), h('button', { type: 'button', class: 'ds-x', on: { click: closeSheet } }, '閉じる', h('kbd', { text: 'esc' }))),
      r.bare ? null : headBits(r)),
    h('div', { class: 'ds-b' }, ...(r.body || [])),
    r.foot ? h('p', { class: 'ds-f', text: r.foot }) : null);
  if (keep) box.querySelector('.ds-b').scrollTop = keep;
  // live: a row that changed since the sheet was last drawn lights once; the scroll stays where the viewer left it
  const prev = state.sheetRows && state.sheetRows.k === k ? state.sheetRows.m : null;
  const m = new Map();
  for (const tr of box.querySelectorAll('.ds-b tbody tr, .ds-b li')) {
    const key = (tr.firstElementChild || tr).textContent, sig = tr.textContent;
    if (prev && (!prev.has(key) || prev.get(key) !== sig) && !reduced()) tr.classList.add('flash');
    m.set(key, sig);
  }
  state.sheetRows = { k, m };
}
function openSheet(kind, from) {
  const k = sheetKind(kind);
  if (!k) return false;
  if (state.about) closeAbout();
  state.sheet = k;
  const layer = $('sheet');
  layer.hidden = false;
  document.body.classList.add('sheet-open');
  renderSheet();
  const box = layer.querySelector('.dsheet');
  const src = from || $(SHEET_PANE[k]);
  if (src && !reduced() && typeof box.animate === 'function') {
    const a = src.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (a.width > 0 && a.height > 0 && b.width > 0) {
      box.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`, opacity: 0.25 }, { transform: 'none', opacity: 1 }],
        { duration: 260, easing: 'cubic-bezier(.16,.84,.28,1)' });
    }
  }
  const x = box.querySelector('.ds-x');
  if (x) x.focus({ preventScroll: true });
  syncAutoLine();
  return true;
}
function closeSheet() {
  if (!state.sheet) return false;
  const k = state.sheet;
  state.sheet = null;
  $('sheet').hidden = true;
  document.body.classList.remove('sheet-open');
  const back = $(SHEET_PANE[k]) && $(SHEET_PANE[k]).querySelector('.ph-open');
  if (back) back.focus({ preventScroll: true });
  syncAutoLine();
  return true;
}

// ---------------------------------------------------------------- the visitor's own tasks (this browser only)
function saveId(e) { return e.case ? e.case.sid : e.key; }
function renderTasks() {
  renderSectNav();
  const e = cur();
  if (e) for (const btn of document.querySelectorAll('.addtask:not(.share)')) { const on = hasTask(state.tasks, saveId(e)); btn.setAttribute('aria-pressed', String(on)); btn.textContent = on ? '保存済み' : '保存'; }
  if (state.sect !== 'saved') return;
  $('sv-n').textContent = String(state.tasks.length);
  const reopen = (t) => { if ((t.sid && find(t.sid)) || find(t.title)) openSheet('case'); else openUrl(t.link); };
  $('task-list').replaceChildren(...(state.tasks.length ? state.tasks.map((t) => h('li', { class: t.done ? 'done' : null },
    h('input', { type: 'checkbox', checked: t.done ? true : null, 'aria-label': '読んだ', title: '読んだ', on: { change: () => setTasks(toggleTask(state.tasks, t.id)) } }),
    h('span', null, h('button', { type: 'button', class: 'tt', text: t.title, on: { click: () => reopen(t) } }),
      h('span', { class: 'ta', text: `${fmtShort(Math.floor(t.at / 1000))} に保存` })),
    h('span', { class: 'sv-b' }, h('button', { type: 'button', class: 'wx', text: '共有', on: { click: () => shareLink(t.title, shareUrl(location, { sid: t.sid, title: t.title })) } }),
      h('button', { type: 'button', class: 'wx', 'aria-label': `${t.title} を外す`, text: '外す', on: { click: () => setTasks(removeTask(state.tasks, t.id)) } }))))
    : [h('li', { class: 'empty', text: 'ニュースの「保存」を押すと、ここに並びます。' })]));
}
function setTasks(list) { state.tasks = list; saveTasks(store, list); renderTasks(); return true; }
// one outlet's page (js/absent.js outletProfile): what it carried in the collected news, measured
function openOutlet(name) { if (!name) return false; state.outlet = name; return openSheet('outlet'); }
// 自分の読み方 (js/tasks.js): a news opened by hand is noted in this browser only, never sent; 記録を消す removes all of it
function recordRead(e) {
  if (!e || !Array.isArray(state.reads)) return;
  const x = sidesOf(e), types = {};
  for (const it of e.members) if (it && typeof it.type === 'string' && it.type) types[it.type] = (types[it.type] || 0) + 1;
  state.reads = noteRead(state.reads, { k: saveId(e), f: e.field || '', jp: x.jp.length, intl: x.intl.length, gov: x.gov.length, types }, Date.now());
  saveReads(store, state.reads);
}
function renderReads() {
  const box = $('sv-me');
  if (!box) return;
  const m = readMix(state.reads), tot = m.sides.jp + m.sides.intl + m.sides.gov;
  const pc = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '');
  const nameOf = (t) => (t === GOV ? '官公庁の発表' : t);
  const bars = (title, list, of) => (list.length ? h('section', { class: 'me-g' }, h('h3', { text: title }), h('ul', { class: 'me-bars' }, list.slice(0, 6).map(([k, n]) => h('li', null,
    h('span', { class: 'k', text: nameOf(k) }), h('span', { class: 'b' }, h('i', { style: `width:${Math.max(2, (n / list[0][1]) * 100).toFixed(1)}%` })), h('b', { class: 'num', text: n }), h('span', { class: 'pc num', text: pc(n, of) }))))) : null);
  const clear = () => { clearReads(store); state.reads = []; renderReads(); };
  box.replaceChildren(
    h('h2', null, '自分の読み方', m.n ? h('span', { class: 'n num', text: `${m.n} 件` }) : null),
    m.n ? h('p', { class: 'me-sum', text: `${fmtShort(Math.floor(m.since / 1000))} から開いたニュース ${m.n} 件の見出しの内訳です。` }) : h('p', { class: 'empty', text: 'ニュースを開くと、読み方がここに出ます。' }),
    tot ? h('section', { class: 'me-share' }, h('h3', { text: '国内・海外・官公庁の見出しの割合' }), h('span', { class: 'me-bar' }, dossier.ratioBar({ jp: Array(m.sides.jp), intl: Array(m.sides.intl), gov: Array(m.sides.gov) })),
      h('ul', { class: 'me-lg' }, SIDES.map(([k, , short]) => h('li', { class: m.sides[k] ? null : 'zero', data: { side: k } }, lineIcon(k), h('span', { class: 'kl', text: short }), h('b', { class: 'num', text: m.sides[k] }), h('span', { class: 'pc num', text: pc(m.sides[k], tot) }))))) : null,
    m.n ? h('div', { class: 'me-cols' }, bars('分野', m.fields, m.n), bars('メディアの種類', m.types, tot)) : null,
    h('p', { class: 'me-f' }, h('span', { text: 'この記録はこのブラウザにだけ保存し、外へは送りません。' }), m.n ? h('button', { type: 'button', class: 'tbb', on: { click: clear } }, '記録を消す') : null));
}
function taskAdd() {
  const e = cur();
  if (!e) return false;
  const link = e.members.map((it) => safeUrl(it.link)).find(Boolean) || '';
  return setTasks(addTask(state.tasks, { title: e.heading.text, sid: e.case ? e.case.sid : e.key, link }, Date.now()));
}
function openTasks() { return setSect('saved'); }
function toggleSave(e) {
  if (!e) return false;
  const t = state.tasks.find((x) => x.sid === saveId(e));
  if (t) return setTasks(removeTask(state.tasks, t.id));
  return setTasks(addTask(state.tasks, { title: e.heading.text, sid: saveId(e), link: e.members.map((it) => safeUrl(it.link)).find(Boolean) || '' }, Date.now()));
}
let toastT = 0;
function toast(text) { const el = $('toast'); el.textContent = text; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }
async function shareLink(title, url) {
  if (navigator.share) { try { await navigator.share({ title, url }); return true; } catch (err) { if (err && err.name === 'AbortError') return true; } }
  try { await navigator.clipboard.writeText(url); toast('リンクをコピーしました'); } catch { toast(url); }
  return true;
}
// one news as an image (js/dossier.js drawShareCard): the device's share with the file, else the file is saved
async function shareImage(e) {
  if (!e) return false;
  const m = measureOf(e), t = original(e), css = getComputedStyle(document.documentElement), v = (n) => css.getPropertyValue(n).trim();
  const nOut = new Set(e.members.map(outletOf).filter(Boolean)).size;
  const pc = (n) => (m.n ? `${Math.round((n / m.n) * 100)}%` : '');
  const sides = SIDES.map(([k, , short]) => ({ k, label: short, n: m[k].length, pc: pc(m[k].length), first: m.firstOf && m.firstOf[k] ? { clock: fmtShort(m.firstOf[k].ts), outlet: outletOf(m.firstOf[k]) } : null }));
  const lag = isNum(m.lag) && m.firstOf.jp && m.firstOf.intl ? `国内と海外の差 ${Math.abs(m.lag) < 60 ? '1分未満' : fmtSpan(Math.abs(m.lag))}・${m.lag > 0 ? '海外が先' : m.lag < 0 ? '国内が先' : '同じ時刻'}` : '';
  const words = m.intl.length && m.jp.length + m.gov.length ? arr(m.words && m.words.jp).filter((x) => x.both).slice(0, 6).map((x) => x.w) : [];
  const cv = document.createElement('canvas'); cv.width = CARD_W; cv.height = CARD_H;
  try { await document.fonts.ready; } catch { /* */ }
  drawShareCard(cv.getContext('2d'), { title: `「${t.text}」`, outlet: t.outlet, when: `${fmtShort(state.data.generated_at)} 時点・${nOut}社・${m.n} 件`, sides, lag, words },
    { bg: v('--pane'), ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'), line: v('--line-2'), lit: v('--cyan'), jp: v('--sd-jp'), intl: v('--sd-intl'), gov: v('--sd-gov'), font: v('--f-text'), num: v('--f-num') });
  const blob = await new Promise((r) => { try { cv.toBlob(r, 'image/png'); } catch { r(null); } });
  if (!blob) return false;
  const name = `parallax-${saveId(e)}.png`.replace(/[^\w.-]+/g, '-');
  try {
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: t.text }); return true; }
  } catch (err) { if (err && err.name === 'AbortError') return true; }
  const url = URL.createObjectURL(blob), a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}
function shareEvent(e) {
  if (!e) return false;
  const sid = e.case ? str(e.case.sid) : e.kind === 'story' && isObj(e.obj) ? str(e.obj.sid) : '';
  shareLink(e.heading.text, shareUrl(location, { sid, title: e.heading.text }));
  return true;
}

// ---------------------------------------------------------------- a news site's own parts: the breaking line, the rankings, the local news (js/newsdesk.js)
const FLASH_KEY = 'parallax.flash.off.v1';
function loadOff() { try { const j = store ? JSON.parse(store.getItem(FLASH_KEY) || '[]') : []; return Array.isArray(j) ? j.filter((x) => typeof x === 'string').slice(-200) : []; } catch { return []; } }
function saveOff(list) { try { if (store) store.setItem(FLASH_KEY, JSON.stringify(list.slice(-200))); } catch { /* this visit only */ } }
function flashList() {
  const hz = state.haz || {};
  const evs = newsFresh() ? state.pri.filter((e) => e.exact && !e.hid).map((e) => ({ key: e.key, id: str(e.case.sid), title: e.heading.text, new6h: e.case.n_new6h, sinceH: e.case.since_first_h, n: e.n })) : [];
  return breakingOf({ quakes: hz.quakes, tsunami: hz.tsunami, events: evs, now: nowS() });
}
function renderFlash() {
  const bar = $('flash');
  if (!bar || !state.data) return;
  const all = flashList();
  let off = loadOff();
  if (state.haz) { const k = keepOff(off, all); if (k.length !== off.length) { off = k; saveOff(off); } }   // what has ended is forgotten
  const b = all.find((x) => !off.includes(x.id));
  bar.hidden = !b;
  if (!b) { bar.replaceChildren(); delete bar.dataset.kind; return; }
  const t = breakingText(b, fmtClock);
  const go = () => { if (b.kind === 'surge') { setSect('news'); select(b.key, true); if (stacked()) openSheet('case'); } else setSect('disaster'); };
  bar.dataset.kind = b.kind;
  bar.replaceChildren(
    h('button', { type: 'button', class: 'fl-go', title: b.kind === 'surge' ? 'このニュースを開く' : '災害の画面を開く', on: { click: go } },
      h('span', { class: 'fl-tag' }, h('b', { text: '速報' }), h('span', { text: t.tag })), h('span', { class: 'fl-t', text: t.text })),
    h('button', { type: 'button', class: 'fl-x', 'aria-label': '速報を閉じる', title: '閉じる', on: { click: () => { saveOff([...loadOff(), b.id]); renderFlash(); } } },
      s('svg', { viewBox: '0 0 12 12', 'aria-hidden': 'true' }, s('path', { d: 'M2.5 2.5l7 7M9.5 2.5l-7 7' }))));
}
const rankPool = () => state.es.filter((e) => !e.foldedInto && vis(e) && !e.hid);
const upOf = (e) => (e.exact && isNum(e.case.n_new6h) ? e.case.n_new6h : 0);
function rankList(list, kind, press) {
  return h('ol', { class: 'rk-l' + (kind === 'up' ? ' up' : '') }, list.map(({ e, rank, v }) => {
    const m = measureOf(e);
    return h('li', { class: 'rk-r' + (rank <= 3 ? ' top' : '') + (e.key === state.sel ? ' sel' : ''), tabindex: '0', data: { key: e.key }, title: 'このニュースを開く',
      on: { click: () => press(e.key), keydown: (ev) => { if (ev.key === 'Enter') press(e.key); } } },
      h('span', { class: 'rk-n num', text: rank }), headNode(e, 'rk-t'),
      h('span', { class: 'rk-v' }, h('b', { class: 'num', text: kind === 'up' ? `+${v}` : String(e.n) }), h('small', { text: kind === 'up' ? '6 時間' : '社' })),
      h('span', { class: 'rk-m', title: SIDES.map(([k, , sh]) => `${sh} ${m[k].length}`).join('・') }, dossier.ratioBar(m), h('small', { class: 'num', text: `${m.n} 件` })));
  }));
}
function newsRank() {
  const pool = rankPool(), fresh = newsFresh();
  const top = rankBy(pool, (e) => e.n, { cap: 20 }), up = fresh ? rankBy(pool, upOf, { cap: 20 }) : [];
  return { bare: true, foot: '報道の多い順です。', body: [h('div', { class: 'rk' },
    h('section', { class: 'rk-c' }, h('h3', null, '注目度'), top.length ? rankList(top, 'n', openCase) : h('p', { class: 'empty', text: '0 件' })),
    h('section', { class: 'rk-c' }, h('h3', null, '急上昇', h('small', { text: '新着' })),
      up.length ? rankList(up, 'up', openCase) : h('p', { class: 'empty', text: fresh ? '6 時間の新着はありません。' : '6 時間より前のニュースなので、急上昇は出せません。' })))] };
}
function renderRankHome() {
  const b = $('rank-b');
  if (b) b.replaceChildren(rankList(rankBy(rankPool(), (e) => e.n, { cap: 5 }), 'n', pressRow));
}
function localList() { const k = state.set.local.place; return k ? localOf(rankPool(), k) : []; }
function renderLocal() {
  const k = state.set.local.place, p = $('p-local');
  if (!p) return;
  p.hidden = !k;
  if (!k) { $('local-b').replaceChildren(); return; }
  const list = localList(), name = placeName(k);
  $('local-h').textContent = `地元のニュース（${name}）`;
  $('local-c').textContent = list.length ? String(list.length) : '';
  $('local-b').replaceChildren(list.length ? h('ul', { class: 'rows' }, list.slice(0, 6).map((e) => row(e, { compact: true })))
    : h('p', { class: 'empty', text: `${name}のニュースは今はありません。` }));
}

// ---------------------------------------------------------------- the screens: the board's panes opened whole; the address says which (js/sections.js)
const PAGE_SHEET = { market: 'mkt', politics: 'pol', disaster: 'haz' };
const SECOND = new Set(['market', 'politics', 'disaster', 'video']);
const isPage = (id) => id === 'news' || id === 'saved' || !!PAGE_SHEET[id] || (id === 'map' && state.set.panes.off.includes('map')) || (id === 'video' && state.set.panes.off.includes('tv'));
const stacked = () => window.matchMedia('(max-width: 1100px)').matches;
function renderSectNav() {
  paintScreen();
  for (const a of document.querySelectorAll('#sects a[data-s]')) { if (a.dataset.s === state.sect) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  const sec = SECOND.has(state.sect);
  $('sects-more').classList.toggle('on', sec);
  $('sects-more-t').textContent = sec ? SECTIONS.find((x) => x.id === state.sect).ja : 'その他';
  $('sect-new').textContent = state.newKeys.size ? String(state.newKeys.size) : '';
  $('task-n').textContent = state.tasks.filter((t) => !t.done).length || '';
}
function moreOpen(on) { const n = $('sects'); if (on) n.dataset.more = '1'; else delete n.dataset.more; $('sects-more').setAttribute('aria-expanded', String(!!on)); }
function setSect(id, tab, fromHash) {
  const sc = SECTIONS.some((x) => x.id === id) ? id : 'home', prev = state.sect;
  state.sect = sc;
  if (sc === 'news' && tab) state.newsTab = tab;
  if (!fromHash) { const want = hashOf(sc, state.newsTab); if (location.hash !== want && !(sc === 'home' && !location.hash)) location.hash = want; }
  applySect(prev);
  return true;
}
function applySect(prev) {
  const sc = state.sect, root = document.documentElement;
  root.dataset.sect = sc;
  root.dataset.page = isPage(sc) ? '1' : '0';
  moreOpen(false);
  if (state.sheet) closeSheet();
  if (state.palette) state.palette.close();
  // the whole map and the video need the board itself; home comes back the way it was left
  if ((sc === 'map' || sc === 'video') && state.ui === 'simple') { state.uiBack = 'simple'; quietUi('full'); } else if (sc === 'home' && state.uiBack) { const b = state.uiBack; state.uiBack = null; quietUi(b); }
  if (state.floor && prev !== sc) { if (sc === 'map') state.floor.setMode('map'); else if (prev === 'map') state.floor.setMode('case'); }
  $('sect').hidden = !isPage(sc) || sc === 'saved';
  $('sect-saved').hidden = sc !== 'saved';
  renderSectNav();
  renderSect();
  window.scrollTo(0, 0);
  if (state.map && state.data && !isPage(sc)) requestAnimationFrame(() => { state.map.resize(); renderMap(false); renderMapNews(); applyView(); window.scrollTo(0, 0); });
}
function paintNewsCase() {
  const b = $('nw-case');
  if (!b || state.sect !== 'news') return;
  const e = cur();
  b.replaceChildren(e ? caseNode(e) : h('p', { class: 'empty big', text: '0 件' }));
  b.scrollTop = 0;
}
const openCase = (key) => { select(key, true); openSheet('case'); };
function pressNews(key) {
  if (stacked()) { openCase(key); return; }
  select(key, true);
}
function newsNow() {
  const list = shownPri().filter((e) => !e.hid);
  const c = cur();
  if (list.length && !stacked() && !(c && list.includes(c))) state.sel = list[0].key;
  return { bare: !state.q, big: fmtN(list.length), unit: state.q ? `「${state.q}」の一致` : '', facts: [], fill: true, body: [h('div', { class: 'nw' },
    h('div', { class: 'nw-l' }, genreEl(), h('div', { class: 'chips' }, priChips()),
      state.q ? h('p', { class: 'q-out' }, h('span', { text: `「${state.q}」で探している` }), lk('解除', clearSearch, '検索をやめて全部に戻す', 'r-a')) : null,
      state.q ? qBar() : null,
      list.length ? h('ul', { class: 'rows' }, list.map((e) => row(e, { press: pressNews }))) : h('p', { class: 'empty', text: state.q ? '一致 0 件' : '0 件' })),
    stacked() ? null : h('div', { class: 'nw-r', id: 'nw-case' }, cur() ? caseNode(cur()) : null))] };
}
function newsPaper() {
  const groups = paperOf(shownPri().filter((e) => !e.hid), { outletOf });
  const body = groups.length ? [h('div', { class: 'ppr' }, groups.map((g) => h('section', { class: 'ppr-c' },
    h('h3', null, g.label, h('span', { class: 'n num', text: g.n })),
    h('ol', null, g.rows.map(({ e, it, outlet }) => { const l = safeUrl(it.link); return h('li', null,
      h('button', { type: 'button', class: 'lk ppr-t', lang: it.lang === 'en' ? 'en' : null, text: it.title, title: 'このニュースを開く', on: { click: () => openCase(e.key) } }),
      h('span', { class: 'ppr-m' }, l ? extLink(l, {}, outlet || hostOf(l)) : outlet, h('span', { text: fmtAge(it.ts) }), h('span', { text: `${e.n}社` }))); })))))] : [h('p', { class: 'empty big', text: '0 件' })];
  return { big: fmtN(groups.reduce((a, g) => a + g.rows.length, 0)), unit: '見出し', facts: groups.map((g) => [g.label, fmtN(g.n)]), body, foot: '官公庁、全国紙、通信社、経済紙、公共放送の順です。それぞれの中は注目度の順です。' };
}
function newsDiff() {
  const list = state.es.filter((e) => !e.foldedInto && vis(e) && state.newKeys.has(e.mk)).sort((a, b) => b.n - a.n || b.last - a.last);
  const since = isNum(state.seenSince) ? Math.floor(state.seenSince / 1000) : null;
  return { big: fmtN(list.length), unit: since ? `${fmtShort(since)} に見た時から増えたニュース` : '前回から増えたニュース', facts: [],
    body: [list.length ? h('ul', { class: 'rows' }, list.map((e) => row(e, { press: openCase }))) : h('p', { class: 'empty big', text: state.prevSeen ? '前回から増えたニュースはありません。' : '次に開いた時から、増えたニュースがここに並びます。' })] };
}
function pageOff(k) {
  const ja = SECTIONS.find((x) => x.id === k).ja;
  return { bare: true, body: [h('p', { class: 'empty big' }, `設定で「${ja}」を隠しています。`, h('button', { type: 'button', class: 'tbb', on: { click: () => openSettings('panes') } }, '設定を開く'))] };
}
function renderSect() {
  const k = state.sect;
  if (k === 'saved') { renderTasks(); renderWatch(); renderSavedHits(); renderReads(); return; }
  if (k === 'video') renderTvEvents();
  if (!isPage(k)) return;
  const box = $('sect');
  if (!state.data) { box.replaceChildren(h('p', { class: 'empty big', text: '読込中' })); return; }
  const keep = box.scrollTop;
  let r;
  try {
    if (k === 'news') { const t = state.newsTab; r = t === 'rank' ? newsRank() : t === 'paper' ? newsPaper() : t === 'diff' ? newsDiff() : t === 'now' ? newsNow() : SHEET_BODY[t](); } else if (PAGE_SHEET[k]) r = SHEET_BODY[PAGE_SHEET[k]](); else r = pageOff(k);
  } catch (err) { r = { bare: true, body: [h('p', { class: 'empty', text: `表示できませんでした: ${err && err.message ? err.message : String(err)}` })] }; }
  const title = SECTIONS.find((x) => x.id === k).ja;
  const tabs = k === 'news' ? h('div', { class: 'sc-tabs', role: 'group', 'aria-label': 'ニュースの並べ方' }, NEWS_TABS.map(([id, ja]) => h('a', { href: hashOf('news', id), class: 'sc-tab', 'aria-current': id === state.newsTab ? 'page' : null }, ja,
    id === 'diff' && state.newKeys.size ? h('span', { class: 'n num', text: state.newKeys.size }) : null))) : null;
  box.replaceChildren(h('div', { class: 'sc-in' + (r.fill ? ' fill' : '') },
    h('header', { class: 'sc-h' }, h('h1', { text: title }), r.bare ? null : headBits(r)),
    tabs,
    h('div', { class: 'sc-b ds-b' + (r.fill ? ' fill' : '') }, ...(r.body || [])),
    r.foot ? h('p', { class: 'ds-f', text: r.foot }) : null));
  box.scrollTop = keep;
  renderTasks();
}
function renderSavedHits() {
  const list = state.es.filter((e) => e.hits.length && !e.foldedInto && vis(e)).sort((a, b) => b.n - a.n).slice(0, 40);
  $('sv-hits').replaceChildren(...(list.length ? list.map((e) => row(e, { press: openCase })) : [h('li', { class: 'empty', text: state.watch.length ? '当たったニュースはありません。' : '言葉を足すと、当たったニュースがここに並びます。' })]));
}
function renderTvEvents() {
  const box = $('tv-b');
  if (!box || !box.querySelector('.tv-f')) return;
  let b = box.querySelector('.tv-ev');
  if (!b) { b = h('div', { class: 'tv-ev' }); box.append(b); }
  const list = state.pri.filter((e) => !e.hid).map((e) => [e, videosOfEvent(e)]).filter(([, v]) => v.length).slice(0, 14);
  b.hidden = !list.length;
  b.replaceChildren(h('h3', { class: 'ds-sec' }, '映像のあるニュース', h('span', { class: 'n', text: list.length })), h('ul', null, list.map(([e, v]) => h('li', null,
    h('button', { type: 'button', class: 'lk tv-e' + (e.key === state.sel ? ' sel' : ''), on: { click: () => { select(e.key, true); renderTvEvents(); } } }, headNode(e, 'tv-et'), h('span', { class: 'tv-en num', text: `${v.length} 本・${e.n}社` }))))));
}
/** everything the one field can reach */
function paletteItems() {
  const go = (id, tab) => () => setSect(id, tab);
  const items = SECTIONS.map((x) => ({ kind: '画面', label: x.ja, first: true, run: go(x.id) }));
  for (const [id, ja] of NEWS_TABS) if (id !== 'now') items.push({ kind: 'ニュース', label: ja, first: id === 'paper' || id === 'diff', run: go('news', id) });
  const c = genreCounts(state.pri);
  for (const f of [...FIELDS, OTHER_FIELD]) items.push({ kind: '分野', label: f, hint: isNum(c.get(f)) ? `${c.get(f)} 件` : '', run: () => { setGenre(f); setSect('news', 'now'); } });
  for (const o of uniq(arr(state.data && state.data.sources).filter(isObj).map((r) => str(r.outlet) || str(r.name)).filter(Boolean))) items.push({ kind: 'メディア', label: o, run: () => openOutlet(o) });
  const toTheme = () => { applySettings({ ...state.set, look: { ...state.set.look, theme: state.set.look.theme === 'light' ? 'dark' : 'light' } }); };
  const ops = [['比べる', () => { setSect('home'); setUi('simple'); }], ['ダークとライトを切り替える', toTheme], ['字の大きさを切り替える', () => applySettings({ ...state.set, look: { ...state.set.look, size: state.set.look.size === 'l' ? 'm' : 'l' } })],
    ['使い方を見る', () => $('tour-btn').click()], ['キーの一覧', () => openSheet('keys')], ['設定', () => openSettings()], ['データと AI', () => openAbout()], ['表示中のニュースを保存', () => toggleSave(cur())], ['表示中のニュースを共有', () => shareEvent(cur())], ['表示中のニュースを画像で共有', () => shareImage(cur())], ['世界の地図', () => { setSect('map'); actions.run('map_world'); }]];
  for (const [ja, run] of ops) items.push({ kind: '操作', label: ja, first: ja === 'キーの一覧' || ja === '設定', run });
  for (const e of state.es) if (!e.foldedInto && vis(e)) items.push({ kind: 'ニュース', label: e.heading.text, hint: `${e.n}社`, hay: e.hay, run: () => openCase(e.key) });
  return items;
}
function paintCmdBtn() { $('cmd-t').textContent = state.q ? `「${state.q}」` : '検索'; }

// ---------------------------------------------------------------- voice: the browser's recogniser -> the closed list (js/voice.js)
let voiceKey = '';     // the visitor's own key for the AI step; memory only, this visit only
let voiceStop = null;
function voiceSay(parts) { const p = $('voice-pop'); p.hidden = false; p.replaceChildren(...parts.filter(Boolean)); }
async function voiceRun(alts) {
  const ja = (id) => (actions.list.find((c) => c.id === id) || {}).ja || id;
  let provider = null;
  const own = ownActive();   // the provider and key chosen in the settings; else the Gemini key typed here, for this visit only
  if (own) { try { provider = makeProvider(own.kind, own.key, own.model, { retries: 0, timeoutMs: 8000 }); } catch { provider = null; } }
  else if (voiceKey && MODEL_RE.test(defaultModel)) { try { provider = makeProvider('gemini', voiceKey, defaultModel, { retries: 0, timeoutMs: 8000 }); } catch { provider = null; } }
  const r = await voiceRoute(alts, { provider, catalog: actions.list });
  if (r.id !== 'none') {
    const out = actions.run(r.id, r.arg);
    voiceSay([h('p', { class: 'vh', text: `「${r.heard}」` }), h('p', { class: 'vr' + (out.ok ? '' : ' bad'), text: `${ja(r.id)}${r.arg ? `：${r.arg}` : ''}${out.ok ? '' : '（できず）'}${r.by === 'ai' ? '・AI が一覧から選んだ' : ''}` }), out.say ? h('p', { class: 'vr', text: out.say }) : null]);
    setTimeout(() => { if (!voiceStop) $('voice-pop').hidden = true; }, 4000);
    return;
  }
  const cands = r.cands.map((c) => h('button', { type: 'button', class: 'chip', text: c.ja, on: { click: () => { actions.run(c.id); $('voice-pop').hidden = true; } } }));
  if (r.heard) cands.push(h('button', { type: 'button', class: 'chip', text: `「${r.heard.slice(0, 16)}」で探す`, on: { click: () => { actions.run('case_find', r.heard); $('voice-pop').hidden = true; } } }));
  const keyIn = h('input', { type: 'password', class: 'vk', placeholder: 'Gemini の鍵（任意・このタブを閉じるまで）', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Gemini の鍵' });
  keyIn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); voiceKey = keyIn.value.trim(); keyIn.value = ''; voiceRun(alts); } });
  voiceSay([h('p', { class: 'vh', text: r.heard ? `「${r.heard}」` : '聞き取れず' }), h('p', { class: 'vr', text: r.by === 'ai' ? '一覧に当たらない' : '規則に当たらない' }), h('div', { class: 'vc' }, cands), voiceKey || own ? null : keyIn]);
}
function startVoice() {
  if (voiceStop) { voiceStop(); voiceStop = null; return true; }
  pause();
  $('voice-btn').classList.add('on');
  voiceSay([h('p', { class: 'vh', text: '聞いています' })]);
  try {
    voiceStop = listen({
      onInterim: (t) => voiceSay([h('p', { class: 'vh', text: `「${t}」` })]),
      onText: (alts) => { voiceRun(alts); },
      onError: (e) => voiceSay([h('p', { class: 'vr bad', text: e === 'not-allowed' ? 'マイクを使えない' : '聞き取れず' })]),
      onEnd: () => { voiceStop = null; $('voice-btn').classList.remove('on'); },
    });
  } catch { voiceStop = null; $('voice-btn').classList.remove('on'); voiceSay([h('p', { class: 'vr bad', text: '声の聞き取りを始められない' })]); }
  return true;
}

// ---------------------------------------------------------------- the visitor's settings (this browser only; js/settings.js)
const setOpen = () => !!(state.panel && state.panel.isOpen());
/** the first event to show: the first priority event the settings do not hide */
function firstShown() { return pickFirst(state.pri.filter((e) => !e.hid && !e.foldedInto)) || state.pri.find((e) => !e.hid) || state.es.find((e) => !e.hid && !e.foldedInto) || state.pri[0] || state.es[0] || null; }
function hidCount() {
  const hid = state.es.filter((e) => !e.foldedInto && e.hid);
  const by = {};
  for (const e of hid) by[e.hid.k] = (by[e.hid.k] || 0) + 1;
  return { n: hid.length, by };
}
/** what the settings hide, always in sight: the count, the reasons, and one press to see everything for this visit */
function renderHid() {
  const bar = $('hid-bar');
  const { n, by } = hidCount();
  if (!n) { bar.hidden = true; bar.replaceChildren(); return; }
  const parts = Object.entries(by).map(([k, c]) => `${KIND_JA[k] || k} ${c}`).join(' · ');
  bar.hidden = false;
  bar.replaceChildren(
    h('span', { class: 'hb-t' }, '設定で隠した ', h('b', { class: 'num', text: fmtN(n) }), state.showHid ? ' 件を一時的に表示中' : ' 件'),
    h('span', { class: 'hb-k', text: parts }),
    h('button', { type: 'button', class: 'hb-b', id: 'hid-toggle', 'aria-pressed': String(state.showHid), on: { click: () => { state.showHid = !state.showHid; renderAll(); } } }, state.showHid ? '隠す' : '全部見る'),
    h('button', { type: 'button', class: 'hb-s', on: { click: () => openSettings('mute') } }, '設定'));
}
const PANE_EL = { src: 'p-src', hours: 'p-hours', fields: 'p-fields', anom: 'p-anom', map: 'p-map', count: 'p-count', tv: 'p-tv', haz: 'p-haz', mkt: 'p-mkt', pol: 'p-pol' };
const PANE_ROWS = { 'p-src': 'auto', 'p-hours': 'auto', 'p-fields': 'minmax(0, 1fr)', 'p-pri': 'minmax(0, 60fr)', 'p-anom': 'minmax(0, 40fr)', 'p-case': 'minmax(0, 1fr)',
  'p-map': 'minmax(210px, 1.15fr)', 'p-count': 'auto', 'p-tv': 'auto', 'p-haz': 'minmax(0, 1fr)', 'p-mkt': 'auto', 'p-pol': 'minmax(0, .8fr)' };
/** panes turned off leave the board; a column with one off is laid out again from the panes left (the stylesheet keeps the rest) */
function applyPanes() {
  const off = new Set(state.set.panes.off);
  for (const [k, id] of Object.entries(PANE_EL)) { const el = $(id); if (el) el.hidden = off.has(k); }
  for (const a of document.querySelectorAll('.jump a')) { const el = $(a.getAttribute('href').slice(1)); a.hidden = !!(el && el.hidden); }
  for (const col of document.querySelectorAll('.board > .col')) {
    const ps = [...col.children].filter((x) => x.classList.contains('pane'));
    const shown = ps.filter((x) => !x.hidden);
    if (shown.length === ps.length && !shown.some((x) => x.dataset.sfold || x.dataset.sbig)) { col.style.gridTemplateRows = ''; continue; }
    const rows = shown.map((x) => (x.classList.contains('fold') ? 'auto' : x.dataset.sbig ? (PANE_ROWS[x.id] || 'auto').replace(/([\d.]+)fr/, (_, n) => `${+n * 2.5}fr`) : PANE_ROWS[x.id] || 'auto'));
    if (rows.length && !rows.some((r) => r.includes('fr'))) rows[rows.length - 1] = 'minmax(0, 1fr)';
    if (col.querySelector(':scope > .under')) rows.push('minmax(0, 1fr)');   // the row under the event keeps its share, or more related headlines would push the event out
    col.style.gridTemplateRows = rows.join(' ') || 'minmax(0, 1fr)';
  }
  $('board').classList.toggle('nomap', off.has('map'));
  if (off.has('map') && state.floor && state.floor.mode() === 'map') state.floor.setMode('case');
}
/** a change from the settings window: kept in this browser, then applied to the board at once (no reload) */
// the page's own words in English (js/i18n.js): headlines, descriptions and the AI's lines stay as published. Back to Japanese: the page
// is drawn again from the start, so that not one character of the Japanese page comes from a translation
let wordsOff = null;
function applyUiLang() {
  const l = uiLang(state.set.look.ui, navigator.languages && navigator.languages.length ? [...navigator.languages] : [navigator.language]);
  if (l === 'en' && !wordsOff) { document.documentElement.lang = 'en'; wordsOff = watchWords(document.body); }
  else if (l === 'ja' && wordsOff) { wordsOff(); wordsOff = null; document.documentElement.lang = 'ja'; location.reload(); return; }
  else if (l === 'ja') document.documentElement.lang = 'ja';
  const b = $('lang-btn');
  if (b) { b.textContent = l === 'en' ? '日本語' : 'English'; b.lang = l === 'en' ? 'ja' : 'en'; b.dataset.to = l === 'en' ? 'ja' : 'en'; }
}
function applySettings(next) {
  const prev = state.set;
  state.set = cleanSettings(next);
  state.setSaved = saveSettings(store, state.set);
  if (!prev || prev.look.ui !== state.set.look.ui) applyUiLang();
  document.documentElement.toggleAttribute('data-calm', state.set.motion.calm === 'on');
  if (window.parallaxTheme) window.parallaxTheme.apply(state.set.look.theme);
  document.documentElement.dataset.size = state.set.look.size;
  if (state.set.motion.cases && !prev.motion.cases) state.autoNext = Date.now() + AUTO_MS;
  const panesChanged = prev.panes.off.join() !== state.set.panes.off.join();
  if (panesChanged) applyPanes();
  if (!state.data) return state.setSaved;
  const v = state.set.news.view;
  if (!(v !== prev.news.view && (v === 'ai' || v === 'rules') && v !== state.view && setView(v))) renderAll();
  const c = cur();
  if (c && c.hid && !state.showHid) { const f = firstShown(); if (f && f.key !== c.key) select(f.key, false); }
  if (panesChanged && state.map) { state.map.resize(); renderMap(false); }
  return state.setSaved;
}
function openSettings(section) {
  if (!state.panel) return false;
  if (state.sheet) closeSheet();
  if (state.about) closeAbout();
  pause();
  state.panel.open(section);
  syncAutoLine();
  return true;
}
function settingsInfo() {
  const d = state.data;
  const srcs = d ? arr(d.sources).filter(isObj) : [];
  const tn = new Map();
  for (const r of srcs) { const t = str(r.type); if (t) tn.set(t, (tn.get(t) || 0) + 1); }
  const types = uniq([...TYPE_ORDER.filter((t) => tn.has(t)), ...tn.keys(), ...state.set.news.types_off]).map((t) => [t, tn.get(t) || 0]);
  const outlets = uniq(srcs.map((r) => str(r.outlet) || str(r.name)).filter(Boolean)).sort((a, b) => a.localeCompare(b, 'ja'));
  return { types, fields: uniq([...FIELDS, OTHER_FIELD, ...state.set.news.fields_off]), outlets, hidden: hidCount(), saved: state.setSaved,
    calmSystem: window.matchMedia('(prefers-reduced-motion: reduce)').matches };
}

// ---------------------------------------------------------------- start
const api = {
  setCount, setLayout, turnPage, step, find, setView, setTopic, setField: (f) => setField(f, true), toggleLayer,
  mapCase: () => { if (state.map) state.map.reset(); return true; },
  mapMode: () => setSect(state.sect === 'map' ? 'home' : 'map'),
  mapWorld: () => { if (!state.map) return false; state.map.show({ ...scene(), focus: null }, true); return true; },
  mapZoom: (k) => !!(state.map && state.map.zoom(k)),
  sayQuakes: () => { const q = state.haz && state.haz.quakes; if (!q) return '地震のデータは読込中'; const top = [...q].sort((a, b) => b.mag - a.mag)[0]; return top ? `24 時間で ${q.length} 件。最大は ${top.place} の M${top.mag.toFixed(1)}` : '24 時間で 0 件'; },
  sayTyphoons: () => { const t = state.haz && state.haz.typhoons; if (!t) return '台風のデータは読込中'; return t.length ? t.map((x) => `台風 ${x.name} ${x.location} ${x.pressure} hPa 最大 ${x.windMs} m/s`).join('。') : '台風 0 件'; },
  watchAdd: (t) => setWatch(addWatch(state.watch, t)), watchRemove: (t) => setWatch(removeWatch(state.watch, t)),
  openArticle: () => { const e = cur(); const l = e && e.members.map((it) => safeUrl(it.link)).find(Boolean); if (!l) return false; openUrl(l); return true; },
  openSheet: (k) => openSheet(k), taskAdd, openTasks, share: () => shareEvent(cur()), openPalette: () => state.palette.open(),
  openSect: (x) => { const t = SECTIONS.find((o) => o.id === x || o.ja === x); return t ? setSect(t.id) : false; },
  openAbout, openSettings: (k) => openSettings(k),
  close: () => { if (state.palette && state.palette.close()) return true; if (setOpen()) return state.panel.close(); if (state.sheet) return closeSheet(); if (!$('voice-pop').hidden) { $('voice-pop').hidden = true; return true; } if (state.about) return closeAbout(); return false; },
  autoStop: () => { state.stopped = true; syncAutoLine(); return true; }, autoStart: () => { state.stopped = false; state.autoNext = Date.now() + AUTO_MS; syncAutoLine(); return true; },
};
export const actions = createActions(api);

async function main() {
  const hv = location.hash.replace('#', '');
  const hashView = hv === 'rules' || hv === 'ai' ? hv : '';
  if (hashView) state.view = hashView;
  state.watch = loadWatch(store);
  state.tasks = loadTasks(store);
  state.reads = loadReads(store);
  state.set = loadSettings(store);
  applyUiLang();
  $('lang-btn').addEventListener('click', () => applySettings({ ...state.set, look: { ...state.set.look, ui: $('lang-btn').dataset.to || 'en' } }));
  state.own = loadOwnAI(store); state.ownAsk = new Map();
  document.documentElement.toggleAttribute('data-calm', state.set.motion.calm === 'on');
  if (window.parallaxTheme) window.parallaxTheme.apply(state.set.look.theme);
  document.documentElement.dataset.size = state.set.look.size;
  if (!hashView && state.set.news.view !== 'auto') state.view = state.set.news.view;
  state.panel = createSettingsPanel({ root: $('set-layer'), get: () => state.set, set: (n) => applySettings(n), info: settingsInfo,
    watch: { get: () => state.watch, set: (l) => setWatch(l) },
    view: { get: () => ({ count: (state.vwNow || state.vw).count, layout: state.vw.layout, counts: countsFor(window.innerWidth, window.innerHeight).map((c) => [c, COUNT_JA[c]]), layouts: LAYOUTS.map((l) => [l, LAYOUT_JA[l]]) }), setCount, setLayout },
    ai: {
      get: () => state.own,
      set: (c) => setOwnAI(c),
      login: () => startOwnLogin(),
      active: () => { const a = ownActive(); return a ? { kind: a.kind, ja: a.ja, model: a.model } : null; },
      fallback: () => defaultModel,
      test: ownTest,
    } });
  state.connect = createConnect({ root: $('own-layer'), get: () => state.own, test: ownTest, login: startOwnLogin, settings: () => openSettings('ai'),
    active: () => { const a = ownActive(); return a ? { kind: a.kind, ja: a.ja, model: a.model } : null; },
    model: (kind, v) => { const c = cleanOwnAI(state.own); c.models[kind] = v; setOwnAI(c); },
    forget: (kind) => { const c = cleanOwnAI(state.own); c.keys[kind] = ''; setOwnAI(c); } });
  $('own-btn').addEventListener('click', () => openConnect());
  paintOwnBtn();
  resumeLogin();
  applyPanes();
  try { const l = store ? JSON.parse(store.getItem(LAYER_KEY) || 'null') : null; state.layers = isObj(l) ? l : {}; } catch { state.layers = {}; }
  window.parallaxActions = actions;   // the voice layer (later) reads the same list

  $('v-rules').addEventListener('click', () => actions.run('view_rules'));
  $('v-ai').addEventListener('click', () => actions.run('view_ai'));
  state.palette = createPalette({ root: $('cmd'), input: $('q'), list: $('cmd-l'), items: paletteItems, onClose: () => { $('q').value = state.q; },
    free: (q) => ({ kind: '検索', label: `「${q}」でニュースを絞る`, run: () => { searchFor(q); setSect('news', 'now'); paintCmdBtn(); } }) });
  $('cmd-btn').addEventListener('click', () => { if (state.q) { clearSearch(); paintCmdBtn(); } state.palette.open(); });
  if (/Mac|iPhone|iPad/.test(navigator.platform || '')) $('cmd-kbd').textContent = '⌘K';
  state.sect = 'home'; state.newsTab = 'now';
  const h0 = parseHash(location.hash);
  if (h0) { state.sect = h0.sect; if (h0.tab) state.newsTab = h0.tab; }
  document.documentElement.dataset.sect = state.sect;
  document.documentElement.dataset.page = isPage(state.sect) ? '1' : '0';
  $('sect').hidden = !isPage(state.sect) || state.sect === 'saved';
  $('sect-saved').hidden = state.sect !== 'saved';
  $('sects').addEventListener('click', (ev) => { if (ev.target.closest('a[data-s]')) moreOpen(false); });
  $('sects-more').addEventListener('click', () => moreOpen(!$('sects').dataset.more));
  $('more-q').addEventListener('click', () => { moreOpen(false); state.palette.open(); });
  $('more-set').addEventListener('click', () => { moreOpen(false); actions.run('settings'); });
  document.addEventListener('click', (ev) => { if ($('sects').dataset.more && !ev.target.closest('#sects')) moreOpen(false); });
  $('watch-form').addEventListener('submit', (ev) => { ev.preventDefault(); const v = $('watch-in').value; $('watch-in').value = ''; if (v.trim()) setWatch(addWatch(state.watch, v)); });
  $('about-btn').addEventListener('click', () => actions.run('about'));
  $('set-btn').addEventListener('click', () => actions.run('settings'));
  // the appearance in the bar: the same value as 外観 in the settings
  const themeLabel = () => $('theme-btn').setAttribute('aria-label', `外観 ${state.set.look.theme === 'light' ? 'ライト' : 'ダーク'}`);
  $('theme-btn').addEventListener('click', () => { applySettings({ ...state.set, look: { ...state.set.look, theme: state.set.look.theme === 'light' ? 'dark' : 'light' } }); themeLabel(); });
  themeLabel();
  paintHomeBtn();
  for (const id of SCREENS) $('sc-' + id).addEventListener('click', () => goScreen(id));
  $('home-detail').addEventListener('click', () => goScreen('board'));
  const nameHome = $('app-home');
  nameHome.addEventListener('click', () => { goScreen('home'); setSect('home'); window.scrollTo(0, 0); });
  nameHome.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); nameHome.click(); } });
  for (const a of document.querySelectorAll('#sects a[data-s="home"]')) a.addEventListener('click', () => { if (screenNow() !== 'home') goScreen('home'); });
  window.addEventListener('popstate', (ev) => {
    const ps = isObj(ev.state) ? ev.state.ps : null;
    if (!SCREENS.includes(ps) || ps === screenNow()) return;
    screenPop = true;
    try { goScreen(ps); } finally { screenPop = false; }
  });
  if (new URLSearchParams(location.search).get('m') === 'simple') setUi('simple');
  try { history.replaceState({ ...(isObj(history.state) ? history.state : {}), ps: screenNow() }, '', location.href); } catch { /* */ }
  screenReady = true; paintScreen();
  // the first visit: a short tour over the simple view, which stays open after it (js/tour.js); 使い方 in the bar shows it again
  state.tour = createTour({ doc: document, win: window, storage: store, onEnd: () => { setUi('simple'); $('entry').scrollTop = 0; window.scrollTo(0, 0); } });
  $('tour-btn').addEventListener('click', () => { setSect('home'); setUi('simple'); state.tour.open(); });
  state.sceneMode = 'auto';
  getJson(dataDir() + 'scenes.json').then((c) => { state.scenes = isObj(c) && c.schema === 'parallax-scenes/1' ? c : null; sceneTick(); });
  if (speechSupported()) { $('voice-btn').hidden = false; $('voice-btn').addEventListener('click', startVoice); }
  $('sheet').addEventListener('click', (ev) => { if (ev.target === $('sheet')) closeSheet(); });
  // every pane head opens its sheet toward the viewer
  for (const [k, id] of Object.entries(SHEET_PANE)) {
    const ph = $(id) && $(id).querySelector('.ph');
    if (!ph) continue;
    canOpen(ph, SHEETS[k], () => openSheet(k, $(id)));
  }
  canOpen($('p-count').querySelector('.ph'), SHEETS.src, () => openSheet('src', $('p-count')));
  const goes = (id, fn, tip) => { const el = $(id); el.classList.add('lkm'); if (!el.title) el.title = tip; el.tabIndex = 0; el.setAttribute('role', 'button'); el.addEventListener('click', fn); el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); fn(); } }); };
  goes('m-src', () => openSheet('src', $('p-src')), '媒体の一覧を開く');
  goes('m-gen', () => openAbout(), 'データについて');
  goes('m-ai', () => openAbout(), 'AI について');
  goes('count-n', () => openSheet('src', $('p-count')), '媒体の一覧を開く');
  goes('hours-b', () => openSheet('hours', $('p-hours')), '時間ごとの見出しを開く');
  $('about-wrap').addEventListener('click', (ev) => { if (ev.target === $('about-wrap')) closeAbout(); });
  window.addEventListener('hashchange', () => {
    const x = location.hash.replace('#', '');
    if (state.ix && (x === 'ai' || x === 'rules') && x !== state.view) { setView(x); return; }
    const p = parseHash(location.hash);
    if (p && (p.sect !== state.sect || (p.sect === 'news' && (p.tab || 'now') !== state.newsTab))) setSect(p.sect, p.tab || 'now', true);
  });
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, pause, { capture: true, passive: true });
  let pmAt = 0;   // moving the pointer alone also holds the sending (at most one hold per 400 ms)
  window.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'touch') return; const n = Date.now(); if (n - pmAt > 400) { pmAt = n; pause(); } }, { capture: true, passive: true });
  document.addEventListener('keydown', (ev) => {
    const t = ev.target;
    // the settings window is modal: it takes every key, and Esc closes it even from a field
    if (setOpen()) { if (ev.key === 'Escape') { ev.preventDefault(); state.panel.close(); } return; }
    if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && (ev.key === 'k' || ev.key === 'K')) { ev.preventDefault(); state.palette.toggle(); return; }
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) { if (ev.key === 'Escape') t.blur(); return; }
    if (ev.altKey && !ev.metaKey && !ev.ctrlKey && /^Digit[1-8]$/.test(ev.code)) { ev.preventDefault(); setSect(SECTIONS[Number(ev.code.slice(5)) - 1].id); return; }
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const k = ev.key;
    if (k === '?') { ev.preventDefault(); openSheet('keys'); return; }
    if (k === 'c') { ev.preventDefault(); actions.run('share'); return; }
    if (k === ',') { ev.preventDefault(); actions.run('settings'); return; }
    const map = { ArrowDown: ['case_next'], ArrowUp: ['case_prev'], j: ['case_next'], k: ['case_prev'], Escape: ['close'], a: ['view_ai'], r: ['view_rules'], m: ['map_mode'], w: ['map_world'], o: ['open_article'], i: ['about'], t: ['task_add'], '+': ['map_in'], '-': ['map_out'], v: ['__voice'], n: ['view_count', '次'], l: ['view_layout', '次'], '[': ['view_page', '-1'], ']': ['view_page', '1'] };
    if (map[k] && map[k][0] === '__voice') { if (!$('voice-btn').hidden) startVoice(); return; }
    if (k === '/') { ev.preventDefault(); state.palette.open(); return; }
    const gi = Number(k);
    if (gi >= 1 && gi <= TOPICS.length + 1) { actions.run('topic', gi === 1 ? 'all' : TOPICS[gi - 2].id); return; }
    if (map[k]) { ev.preventDefault(); actions.run(...map[k]); }
  });
  state.map = createMap($('map'), {
    onPick: onMapPick, wheel: false,
    onPress: (hit, at) => (state.mapUi ? state.mapUi.press(hit, at) : false),
    local: (x, y) => (state.floor ? state.floor.local(x, y) : null),
    onPaint: (info) => { if (state.floor) state.floor.paint(info); if (state.mapUi) state.mapUi.paint(info); },
  });
  state.floor = createFloor({ map: state.map, board: $('board'), onMode: (m) => { applyPanes(); state.map.resize(); renderMap(true); renderMapNews(); applyView(); if (m === 'map' && state.sect !== 'map') setSect('map'); } });
  $('modebar').addEventListener('click', (ev) => { const b = ev.target.closest('[data-m]'); if (b && b.dataset.m === 'case' && state.sect === 'map') setSect('home'); });
  state.vw = loadView(store);
  state.wallPage = 0;
  placeBar();
  phoneBar.addEventListener('change', placeBar);
  foldBar.addEventListener('change', placeBar);
  railBar.addEventListener('change', placeBar);
  $('view-btn').addEventListener('click', () => { const m = $('tb-menu'); m.hidden = !m.hidden; $('view-btn').setAttribute('aria-expanded', String(!m.hidden)); });
  document.addEventListener('click', (ev) => { const m = $('tb-menu'); if (!m.hidden && !ev.target.closest('#tb-menu, #view-btn, .pop')) { m.hidden = true; $('view-btn').setAttribute('aria-expanded', 'false'); } });
  applyView();
  window.addEventListener('parallax:map-select', (ev) => {
    const d = isObj(ev.detail) ? ev.detail : {};
    state.mapPick = str(d.place) || isNum(d.lat) ? { place: str(d.place), lat: d.lat, lon: d.lon, country: !!d.country } : null;
    state.mapScope = 'near';
    state.mapLead = null;
    renderMapNews();
  });
  // the card on the map was closed: no place any more, the section goes back to the priority list
  window.addEventListener('parallax:map-clear', () => { state.mapPick = null; state.mapLead = null; state.mapScope = 'pri'; renderMapNews(); });
  // what stands on the map: the card of a place, the theme's colouring, the 3D floor (js/mapui.js)
  state.mapUi = createMapUi({ map: state.map, floor: state.floor, theater: $('theater'), genres: [...FIELDS, OTHER_FIELD], genre: () => state.genre, setGenre,
    events: () => state.es.filter((e) => vis(e) && !e.foldedInto),
    theme: () => (state.q ? { label: `「${state.q}」`, match: matchesQ } : state.genre !== GENRE_ALL ? { label: state.genre, match: inGenre } : null),
    describe: (e) => ({ title: str(e.heading && e.heading.text), age: fmtAge(e.last) }),
    focus: () => { const e = cur(); return e && e.geo ? { lat: e.geo.lat, lon: e.geo.lon } : null; },
    open: (key) => { state.map.pin(true); select(key, true); state.map.pin(false); if (state.floor.mode() === 'map' && typeof renderMapNews !== 'function') state.floor.setMode('case'); },
  });
  // the board answers a touch: a press and a switch make a quiet sound by default, a hover only when chosen (js/feel.js)
  state.feel = createFeel({ press: () => state.set.motion.sound !== false, hover: () => state.set.motion.hoverSound === true });
  // a list that does not fit scrolls itself (the event list follows the event in focus, so its own move takes over there)
  startAutoScroll('#src-b, #fields-b, #pri-b, #anom-b, #haz-b, #mkt-b, #pol-b', { held: () => !!(state.about || state.sheet) || setOpen() || !state.set.motion.scroll || state.sect !== 'home' });
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (state.sect === 'map' && state.floor && state.floor.mode() === 'case') state.floor.setMode('map'); if (state.map) state.map.resize(); applyView(); if (state.sect === 'news') renderSect(); }, 160); });
  window.addEventListener('parallax-theme', () => { if (state.map) state.map.resize(); });   // the map's ground is drawn in the page's tones
  initLandscape();   // phones held sideways: the list on the left, one pane on the right
  initDial();        // phones: two rings under the thumb to step through the topics and the events

  const dp = dataPath();
  if (dp.bad != null) { showFatal('data= は同じ場所の相対パス（.json）だけ指定できます。'); return; }
  state.dataPath = dp.path;
  setState('読込中', true);
  let data;
  try {
    const res = await fetch(dp.path, { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) { showFatal(`${dp.path} を読めませんでした（${err && err.message ? err.message : String(err)}）。`); setState('データなし'); return; }
  if (!isObj(data)) { showFatal(`${dp.path} の中身が JSON の物ではありません。`); return; }
  tidyGovTitles(data);   // the gaps a ministry page's line breaks leave in a title (js/tidy.js)
  state.base = data; state.data = data;
  const [labels, board] = await Promise.all([getJson(dataDir() + 'labels.json'), getJson(dataDir() + 'board.json')]);
  state.labels = labels;
  state.board = isObj(board) && board.schema === 'parallax-board/1' ? board : null;
  if (!(isObj(state.labels) && isObj(state.labels.flags))) state.labels = null;
  if (!hashView) state.view = state.set.news.view === 'auto' ? defaultView(data) : state.set.news.view;
  seeData(data);
  renderAll();
  applySect(null);
  state.tickQ = state.pri.filter((e) => state.newKeys.has(e.mk));
  renderTicker(false);
  const first = firstShown();
  if (first) { select(first.key, false); followTv(first); }
  endLoad();
  // a link to one event: it opens over the home screen, whichever view holds it
  const qs = new URLSearchParams(location.search), askSid = qs.get('sid'), askT = qs.get('t');
  if (askSid || askT) {
    let hit = (askSid && find(askSid)) || (askT && find(askT));
    if (!hit && askSid && state.view === 'ai') { setView('rules'); hit = find(askSid); }
    if (hit) openSheet('case');
  } else if (state.sect === 'home' && wantTour(store, location.search)) { setUi('simple'); state.tour.open(); }
  state.autoNext = Date.now() + AUTO_MS;
  loadHaz(); loadSide(); loadEval(); loadDefaultModel();
  setInterval(tick, 30000);
  setInterval(autoStep, 500);
  setInterval(tickerStep, TICK_MS);
  setInterval(poll, POLL_MS);
  setInterval(loadHaz, HAZ_MS);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

if (typeof document !== 'undefined') main();
