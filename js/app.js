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
import { summaryOf, summaryIndex, memberKey } from './summary.js';
import { PLACES, placeJa, placesOf, placesIn } from './places.js';
import { loadWatch, saveWatch, addWatch, removeWatch, hitsOf } from './prefs.js';
import { TOPICS, FIELDS, topicsOf, fieldOf, topicJa } from './topics.js';
import { createMap } from './map.js';
import { createFloor } from './floor.js';
import { startAutoScroll } from './autoscroll.js';
import { loadHazards, nearby, dir8, shindoJa, disasterJa } from './hazards.js';
import { createActions } from './actions.js';
import { loadTasks, saveTasks, addTask, toggleTask, removeTask, hasTask } from './tasks.js';
import { speechSupported, listen, route as voiceRoute } from './voice.js';
import { STATIONS, stationFor, embedSrc } from './tv.js';

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
  overseas_only: { ja: '海外の源だけ', tip_ja: '取得した源のうち、海外の媒体だけに出ていて、日本に関わる出来事' },
  jp_main_not_found: { ja: '取得した国内の主要 {n} 配信に見当たらない', tip_ja: '取得した国内の主要配信には見当たらない' },
  primary_only: { ja: '官公庁の資料だけ', tip_ja: '政府・中央銀行などの一次の資料だけに出ている' },
};
const VETO_WHY = { has_jp_outlet: '日本の源が含まれる', has_jp_mainstream: '日本の主要な源が含まれる', single_outlet: '源が一つだけ', has_non_primary: '官公庁でない源が含まれる' };
const ERR_TEXT = {
  quota: 'Gemini の利用上限（429）に当たりました。少し時間を空けてやり直してください。', auth: '鍵が通りませんでした（401/403）。鍵を確かめてください。',
  blocked: 'Gemini が応答を止めました。', truncated: '応答が長さの上限で切れました。', http: 'Gemini が誤りを返しました。', timeout: '時間内に応答がありませんでした。',
  network: 'Google へ届きませんでした（通信）。', json: '応答が JSON として読めませんでした。', shape: '応答の形が崩れていました。', nokey: '鍵がありません。',
  missing: '記録済みの答えがありません。', budget: '1 回の取得での AI の呼び数の上限に達しました。',
};
const TERMS_TEXT = { ok: '再表示可', nc: '非商用のみ', no: '再配布不可', unknown: '未確認' };
const LAYERS = [['events', '出来事'], ['pri', '注目'], ['radius', '半径'], ['quakes', '地震'], ['typhoons', '台風'], ['disasters', '災害']];

const state = {
  base: null, data: null, live: false, view: 'ai', q: '', watch: [], sel: null, about: false, ix: null, snap: null, busy: false, sumBy: null,
  pending: null, evalData: null, dataPath: DEFAULT_DATA, labels: null, es: [], byKey: new Map(), pri: [], topic: 'all', field: null, fieldAt: 0,
  newKeys: new Set(), flashed: new Set(), prevSeen: null, autoNext: 0, pausedUntil: 0, stopped: false, haz: null, mkt: undefined, pol: undefined,
  layers: null, tickQ: [], tickI: 0, tickAt: 0, map: null, board: null, hist: null, fieldTabs: [], hazFresh: new Set(), hazSeen: null, leadOf: new Map(), anomKind: null, sheet: null, tasks: [],
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
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  for (const kid of kids.flat()) { if (kid == null || kid === false) continue; el.append(kid instanceof Node ? kid : document.createTextNode(String(kid))); }
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
function flagText(id) {
  const def = flagDefs()[id];
  if (!isObj(def)) return null;
  const sc = state.view === 'ai' && state.snap && isObj(state.data.ai_snapshot) && isObj(state.data.ai_snapshot.scope) ? state.data.ai_snapshot.scope : state.data.scope;
  const n = isObj(sc) && isObj(sc.jp_main) && isNum(sc.jp_main.fetched) ? sc.jp_main.fetched : denoms().mainstream;
  const fill = (x) => str(x).replace(/\{n\}/g, String(n));
  return { ja: fill(def.ja), tip: fill(def.tip_ja) };
}
const noteJa = () => (state.labels && str(state.labels.note_ja)) || '真偽は判定していない';
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
    if (ja) e.heading = { text: ja, ai: true, en };
    else if (en) e.heading = { text: en, ai: true, lang: 'en' };
    else if (rep) e.heading = { text: rep.title, lang: rep.lang === 'en' ? 'en' : null, outlet: outletOf(rep), type: str(rep.type) };
    else if (e.titled.length) e.heading = { text: e.titled[0].title, lang: e.titled[0].lang === 'en' ? 'en' : null, outlet: outletOf(e.titled[0]), type: str(e.titled[0].type) };
    else e.heading = { text: uniq(e.members.map((it) => it.outlet)).join('・') || '—', none: true };
    const text = [e.heading.text, en, ...e.titled.map((it) => it.title)].join(' \n ');
    e.topics = c ? arr(c.flags).filter((f) => typeof f === 'string') : topicsOf(text);
    e.field = c && str(c.cat) ? c.cat : fieldOf(text, e.obj.homes) || OTHER_FIELD;
    if (!c && e.allGov) e.ruleFlags.push('primary_only');
    e.hay = [text, e.summary && e.summary.text_ja, e.ai && e.ai.contrast_ja, ...e.members.map((it) => it.outlet), ...e.places.map(pj), c && c.place && c.place.name].filter(Boolean).join(' \n ');
    e.hits = hitsOf(state.watch, e.hay);
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
function shownPri() {
  if (state.q) return state.es.filter((e) => !e.foldedInto && matchesQ(e)).sort((a, b) => b.n - a.n || (b.last || 0) - (a.last || 0)).slice(0, 200);
  const t = state.topic;
  if (t === 'cross') return state.es.filter((e) => !e.foldedInto && e.cover === 'both').sort((a, b) => b.n - a.n || (b.last || 0) - (a.last || 0)).slice(0, 200);
  return t === 'all' ? state.pri : t === 'watch' ? state.pri.filter((e) => e.hits.length) : state.pri.filter((e) => e.topics.includes(t));
}
const cur = () => state.byKey.get(state.sel) || null;
const flagJa = (id) => (state.board && isObj(state.board.flag_labels) && isObj(state.board.flag_labels[id]) && str(state.board.flag_labels[id].ja)) || topicJa(id) || id;
const typeLead = (type) => { const t = state.labels && isObj(state.labels.types) ? state.labels.types[type] : null; return isObj(t) && t.lead && str(t.short) ? str(t.short) : ''; };
const outletOf = (it) => (isObj(it) ? str(it.media) || str(it.outlet) : '');
const viaGN = (it) => isObj(it) && it.via === 'gnews';
const counts = () => (state.board && isObj(state.board.counts) ? state.board.counts : null);
const AI_NOTE = 'AI の文は誤りうる。元の記事で確かめてください';
const ISSUES = 'https://github.com/tomnexttech/vector-parallax/issues';
const STOP_NOTE = '掲載の停止の依頼は GitHub の Issues へ。本人・遺族の依頼は記事の URL だけで足りる。第三者の複製・キャッシュには及ばない';
const FLAG_LEGEND = '話題の分類で、重要度・不正の有無・責任を示さない';
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
  roll($('src-live'), live); $('src-total').textContent = String(rows.length);
  // data time
  $('gen-at').textContent = fmtShort(d.generated_at);
  $('gen-age').replaceWith(Object.assign(ageEl(d.generated_at, SIX_H), { id: 'gen-age' }));
  $('m-gen').dataset.bad = d.schema === 'parallax/1' && isNum(d.generated_at) ? '0' : '1';
  $('m-gen').title = `データを組んだ時刻 ${fmtFull(d.generated_at)}`;
  // the AI: who wrote it and when, red after 6 h
  const run = isObj(d.ai_run) ? d.ai_run : {};
  const kept = state.snap ? state.snap.kept : null;
  const st = str(run.status) || 'off';
  const src = kept ? kept.snapRun : run;
  const at = state.live ? run.at : kept ? kept.aiAt : run.at;
  const who = $('ai-who');
  const recorded = st === 'recorded' || str(src.provider) === 'claude-recorded';
  $('v-ai').disabled = state.hasAI === false;
  $('v-ai').title = state.hasAI === false ? 'AI の束ね直しは今は止まっている' : '';
  who.textContent = state.live ? `閲覧者の鍵 ${str(run.model)}` : recorded ? 'AI は記録版・Gemini 未実行' : kept ? `前回を保持 ${str(src.model)}`
    : st === 'recorded' ? `Claude 記録済み・Gemini ではない` : st === 'ok' || st === 'partial' ? [str(run.provider), str(run.model)].filter(Boolean).join(' ')
    : st === 'error' ? '失敗・規則のみ' : '止まっている・規則のみ';
  who.title = st === 'recorded' ? `${str(run.model)} ${str(run.note_ja)}` : '';
  const ma = $('m-ai');
  ma.dataset.bad = st === 'error' ? '1' : '0';
  const age = ageEl(isNum(at) && st !== 'nokey' && st !== 'off' ? at : null, SIX_H);
  age.id = 'ai-age';
  $('ai-age').replaceWith(age);
  ma.classList.toggle('stale', st === 'error');
  // since the last visit
  $('m-new').hidden = !state.prevSeen;
  roll($('new-n'), state.newKeys.size);
  $('watch-n').textContent = state.watch.length ? String(state.watch.length) : '';
  renderSnapNote();
  renderAiLine();
}
function renderSnapNote() {
  const el = $('snap-note');
  const run = isObj(state.data.ai_run) ? state.data.ai_run : {};
  el.replaceChildren();
  if (state.hasAI === false && !state.live) { el.hidden = false; el.className = 'note-bar'; el.append('AI の束ね直しは今は止まっている・規則の束を表示'); return; }
  const unreadable = !state.live && str(run.status) === 'kept_previous' && !state.snap;
  if (state.view !== 'ai' || (!state.snap && !unreadable)) { el.hidden = true; return; }
  el.hidden = false;
  el.className = 'note-bar';
  if (unreadable) { el.classList.add('err'); el.append('前回の AI の結果を読めなかったため、規則の束だけを表示'); return; }
  const kept = state.snap.kept;
  const p = noticeParts(kept, fmtFull, explain, run.errors);
  el.append(h('b', { text: p.lead }), ' ', p.ai, h('span', { text: fmtFull(kept.aiAt) }), ' ', ageEl(kept.aiAt, SIX_H), ' ', p.why);
  el.classList.toggle('err', isOld(kept.aiAt, nowS()));
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
  const parts = [];
  if (state.hasAI && ai != null) parts.push(h('span', { class: 'al-k', text: 'AI が国内外を一つにした出来事' }), n(ai, state.view === 'ai'), h('span', { class: 'al-u', text: ch.of === 'snapshot' ? '件・前回の取得' : '件' }));
  else parts.push(h('span', { class: 'al-k off', text: 'AI の束ね直しは今は止まっている' }));
  if (both != null) parts.push(h('i', { class: 'al-sep', 'aria-hidden': 'true' }), h('span', { class: 'al-k', text: '規則で国内と海外の両方' }), n(both, state.view === 'rules'), h('span', { class: 'al-u', text: '件' }));
  parts.push(h('button', { type: 'button', class: 'al-go', on: { click: () => { if (state.hasAI && ai != null && state.view !== 'ai') setView('ai'); setTopic('cross'); if (narrow()) $('p-pri').scrollIntoView({ block: 'start' }); } } }, '一覧'));
  el.replaceChildren(...parts);
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
  const svg = s('svg', { viewBox: `0 0 ${W} ${H + 4}`, class: 'ticks', role: 'img', 'aria-label': '源ごとの 48 時間の見出しの数' });
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
    return h('li', { class: down ? 'bad' : null, title: bt && isNum(bt.age_h) ? `最新 ${bt.age_h} 時間前` : null },
      h('span', { class: 'tn', text: t }), h('span', { class: 'tc', text: down ? `${rs.length - down}/${rs.length}` : String(rs.length) }),
      h('span', { class: 'ti', text: String(h48) }), h('span', { class: 'th', text: hit ? `表示中 ${hit}` : '' }));
  }));
  const down = rows.filter(bad);
  $('src-b').replaceChildren(svg, h('p', { class: 'src-k' }, h('span', { text: '型' }), h('span', { text: '源' }), h('span', { text: '48時間' }), h('span')), list,
    h('p', { class: 'pfoot' + (down.length ? ' bad' : '') }, down.length ? `届かない・${staleJa} ${down.length}` : '届かない源 0'));
}
function renderHours() {
  const b = state.board;
  const e = cur();
  let bins, to, hours, priAgo = new Set(), label;
  if (b && isObj(b.volume) && Array.isArray(b.volume.total)) {
    hours = b.volume.total.length; bins = [...b.volume.total].reverse(); to = b.generated_at; label = '取得した見出し';
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
  const svg = s('svg', { viewBox: `0 0 ${W} ${H + 18}`, class: 'hours', role: 'img', 'aria-label': '時間ごとの見出しの数' });
  bins.forEach((n, i) => {
    const hh = (n / max) * H, ago = hours - 1 - i;
    svg.append(s('rect', { x: (i * bw + 0.5).toFixed(1), y: (H - hh).toFixed(1), width: Math.max(1, bw - 1.2).toFixed(1), height: Math.max(0.5, hh).toFixed(1), class: priAgo.has(ago) ? 'pri' : '' },
      s('title', {}, document.createTextNode(`${fmtClock(from + i * 3600)}〜 ${n} 件`))));
  });
  if (e) for (const it of e.members) if (isNum(it.ts) && it.ts >= from && it.ts <= to) svg.append(s('circle', { cx: (((it.ts - from) / 3600) * bw).toFixed(1), cy: H + 6, r: 2, class: 'case' }));
  svg.append(s('text', { x: 0, y: H + 17, class: 'ax' }, document.createTextNode(`-${hours}時間`)), s('text', { x: W, y: H + 17, class: 'ax end' }, document.createTextNode(fmtClock(to))));
  $('hours-c').textContent = `${hours}時間`;
  $('hours-b').replaceChildren(svg, h('p', { class: 'pfoot' }, `${label} · 直近 1 時間 ${bins[hours - 1]} · 最多 ${max}/時 · 注目の初報 ${priAgo.size} 時間帯`));
}
function renderFields() {
  const es = state.es.filter((e) => !e.foldedInto && matchesQ(e));
  const b = state.board;
  const byCase = new Map();
  for (const e of es) if (e.case && !e.foldedInto && !byCase.has(e.case.sid)) byCase.set(e.case.sid, e);
  let tabs;
  if (b && isObj(b.outline)) {
    tabs = Object.keys(b.outline).map((f) => [f, uniq(arr(b.outline[f]).map((sid) => byCase.get(sid)).filter(Boolean))]);
    tabs.push(['分野の外', uniq(arr(b.outside).map((sid) => byCase.get(sid)).filter(Boolean))]);
    if (!tabs.some(([, l]) => l.length)) tabs = null;
  }
  if (!tabs) tabs = [...FIELDS, OTHER_FIELD].map((f) => [f, es.filter((e) => e.field === f).sort((a, b2) => b2.n - a.n || (b2.last || 0) - (a.last || 0)).slice(0, 60)]);
  state.fieldTabs = tabs.map(([f]) => f);
  if (!state.field || !state.fieldTabs.includes(state.field)) state.field = tabs[0][0];
  $('fields-c').textContent = b ? `各 ${isObj(b.rules) && isNum(b.rules.outline_per_cat) ? b.rules.outline_per_cat : 6} 件まで` : String(es.length);
  $('field-tabs').replaceChildren(...tabs.map(([f, l]) => h('button', {
    type: 'button', class: 'tab', 'aria-pressed': String(state.field === f), on: { click: () => setField(f, true) } }, f, h('span', { class: 'n', text: l.length }))));
  const list = (tabs.find(([f]) => f === state.field) || [null, []])[1];
  $('fields-b').replaceChildren(list.length ? h('ul', { class: 'rows' }, list.map((e) => row(e, { compact: true }))) : h('p', { class: 'empty', text: '0 件' }));
}
// ---------------------------------------------------------------- second column: the judgement lists
function row(e, opt = {}) {
  const fresh = state.newKeys.has(e.mk) && !state.flashed.has(e.key + (opt.compact ? 'c' : ''));
  if (fresh) state.flashed.add(e.key + (opt.compact ? 'c' : ''));
  const first = e.members[0];
  const li = h('li', {
    class: ['r', state.sel === e.key ? 'sel' : '', fresh ? 'fresh' : '', e.hits.length ? 'watched' : ''].filter(Boolean).join(' '),
    data: { key: e.key }, tabindex: '-1',
    on: { click: () => select(e.key, true) },
  });
  const tag = opt.flag ? h('span', { class: 'flag', title: opt.flag.tip, text: opt.flag.ja }) : null;
  li.append(...kids(
    tag,
    headNode(e, 'rt'),
    h('span', { class: 'rm' },
      state.newKeys.has(e.mk) ? h('span', { class: 'newdot', title: '前回から新しい' }) : null,
      h('span', { class: 'rn', text: `${e.n}媒体` }),
      h('span', { text: fmtAge(e.last) }),
      !opt.compact && e.topics.length ? h('span', { class: 'rk', text: e.topics.map(flagJa).join('・') }) : null,
      e.hits.length ? h('span', { class: 'rw', text: e.hits.join('・') }) : null),
  ));
  if (state.sel === e.key && !opt.compact) li.append(h('i', { class: 'autoline', 'aria-hidden': 'true' }));
  return li;
}
function renderPri() {
  const pri = state.pri;
  const counts = new Map(TOPICS.map((t) => [t.id, pri.filter((e) => e.topics.includes(t.id)).length]));
  const chips = [['all', '全て', pri.length], ...TOPICS.map((t) => [t.id, flagJa(t.id), counts.get(t.id)])];
  if (state.watch.length) chips.push(['watch', '追う', pri.filter((e) => e.hits.length).length]);
  chips.push(['cross', '国内と海外', state.es.filter((e) => !e.foldedInto && e.cover === 'both').length]);
  $('pri-chips').replaceChildren(...chips.map(([id, ja, n]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(!state.q && state.topic === id), disabled: state.q ? true : null,
    on: { click: () => setTopic(id) } }, ja, h('span', { class: 'n', text: n }))));
  const list = shownPri();
  $('pri-h').textContent = state.q ? '検索' : state.topic === 'cross' ? '国内と海外' : narrow() ? '今日の注目' : '注目';
  roll($('pri-c'), list.length);
  const fold = narrow() && !state.priAll && !state.q && list.length > 5;
  const showN = fold ? list.slice(0, 5) : list;
  $('pri-b').replaceChildren(showN.length ? h('ul', { class: 'rows' }, showN.map((e) => row(e))) : h('p', { class: 'empty', text: state.q ? '一致 0 件' : '0 件' }),
    fold ? h('button', { type: 'button', class: 'more', on: { click: () => { state.priAll = true; renderPri(); } } }, `残り ${list.length - 5} 件`) : null,
    h('p', { class: 'pfoot legend', text: `札は${FLAG_LEGEND}` }));
  syncAutoLine();
}
function anomRows() {
  const es = state.es.filter((e) => !e.foldedInto && matchesQ(e));
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
      if (e && ja) rows.push({ e, k: a.kind, ja, tip: isObj(L) ? str(L.rule) : '' });
    }
  }
  if (!(b && Array.isArray(b.asymmetry))) for (const e of es) for (const f of e.ruleFlags) { const t = flagText(f); if (t) rows.push({ e, k: 'rule-' + f, ja: t.ja, tip: t.tip }); }
  return rows;
}
function renderAnom() {
  const rows = anomRows();
  const by = new Map();
  for (const r of rows) by.set(r.ja, (by.get(r.ja) || 0) + 1);
  const ca = counts() && isObj(counts().asymmetric) ? counts().asymmetric : null;
  if (!state.q && ca && isNum(ca.shown)) $('anom-c').textContent = isNum(ca.total) && ca.total !== ca.shown ? `${fmtN(ca.shown)} / ${fmtN(ca.total)}` : fmtN(ca.shown);
  else roll($('anom-c'), rows.length);
  const ast = state.board && isObj(state.board.asym_status) ? state.board.asym_status : null;
  if (state.anomKind && !by.has(state.anomKind)) state.anomKind = null;
  $('anom-sum').replaceChildren(...[...by.entries()].map(([k, n]) => h('button', { type: 'button', class: 'ak', 'aria-pressed': String(state.anomKind === k),
    on: { click: () => { state.anomKind = state.anomKind === k ? null : k; renderAnom(); } } }, h('span', { class: 'akn num', text: n }), h('span', { class: 'akl', text: k }))));
  const shown = state.anomKind ? rows.filter((r) => r.ja === state.anomKind) : rows;
  $('anom-b').replaceChildren(shown.length
    ? h('ul', { class: 'rows' }, shown.slice(0, 80).map((r) => row(r.e, { flag: { ja: r.ja, tip: `規則・${r.tip}${r.tip ? '。' : ''}${noteJa()}` } })))
    : h('p', { class: 'empty', text: ast && ast.complete === false ? '主流の配信に欠けがあり、この取得では札を付けない' : '0 件' }), h('p', { class: 'pfoot', text: `規則で付けた札・${noteJa()}` }));
}
// ---------------------------------------------------------------- the event taken apart
function lanes(e) {
  const ms = e.members.filter((it) => isNum(it.ts));
  const types = TYPE_ORDER.filter((t) => ms.some((it) => it.type === t));
  for (const it of ms) if (!types.includes(it.type)) types.push(it.type);
  if (!ms.length) return h('p', { class: 'empty', text: '時刻の無い報道だけ' });
  const t0 = Math.min(...ms.map((it) => it.ts)), t1 = Math.max(...ms.map((it) => it.ts));
  const span = Math.max(3600, t1 - t0);
  const W = 230, LH = 18, L = 58, H = types.length * LH + 18;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lanes', role: 'img', 'aria-label': '型ごとの報道の時刻' });
  types.forEach((t, i) => {
    const y = i * LH + LH / 2;
    svg.append(s('text', { x: 0, y: y + 3.5, class: 'lt' }, document.createTextNode(t)), s('line', { x1: L, x2: W, y1: y, y2: y, class: 'll' }));
  });
  // the fingerprint: for each type, the span from its first to its last report (who followed, and how late)
  const fp = e.exact && Array.isArray(e.case.fingerprint) ? e.case.fingerprint.filter(isObj) : [];
  for (const f of fp) {
    const i = types.indexOf(f.type);
    if (i < 0 || !isNum(f.first_off_min) || !isNum(f.last_off_min)) continue;
    const x0 = L + ((f.first_off_min * 60) / span) * (W - L - 6), x1 = L + ((f.last_off_min * 60) / span) * (W - L - 6);
    svg.append(s('rect', { x: x0.toFixed(1), y: i * LH + LH / 2 - 3, width: Math.max(1, x1 - x0).toFixed(1), height: 6, class: 'fp' }));
  }
  const used = new Map();
  ms.sort((a, b) => a.ts - b.ts).forEach((it, i) => {
    const li = types.indexOf(it.type);
    const x0 = L + ((it.ts - t0) / span) * (W - L - 6);
    const k = `${li}:${Math.round(x0 / 3)}`; const off = (used.get(k) || 0); used.set(k, off + 1);
    svg.append(s('circle', { cx: (x0 + off * 3).toFixed(1), cy: li * LH + LH / 2, r: i === 0 ? 3.6 : 2.6, class: i === 0 ? 'first' : '' },
      s('title', {}, document.createTextNode(`${fmtClock(it.ts)} ${it.outlet}`))));
  });
  svg.append(s('text', { x: L, y: H - 2, class: 'ax' }, document.createTextNode(fmtClock(t0))), s('text', { x: W, y: H - 2, class: 'ax end' }, document.createTextNode(`+${fmtSpan(t1 - t0)}`)));
  const noTs = e.members.length - ms.length;
  return h('div', null, svg, noTs ? h('p', { class: 'pfoot', text: `時刻不明 ${noTs}（初報に置かない）` }) : null);
}
function byType(e) {
  const offTxt = (m) => (m < 1 ? '+0分' : m < 60 ? `+${Math.round(m)}分` : `+${(m / 60).toFixed(m < 600 ? 1 : 0)}時間`);
  let rows;
  if (e.exact && Array.isArray(e.case.by_type) && e.case.by_type.length) {
    rows = e.case.by_type.filter(isObj).map((t) => ({ type: str(t.type), n: isNum(t.n) ? t.n : 0, who: arr(t.outlets).filter(isObj).map((o) => `${o.outlet} ${isNum(o.off_min) ? offTxt(o.off_min) : '時刻不明'}`) }));
  } else {
    const t0 = Math.min(...e.members.map((it) => it.ts).filter(isNum));
    const types = uniq([...TYPE_ORDER, ...e.members.map((it) => it.type)]).filter((t) => e.members.some((it) => it.type === t));
    rows = types.map((t) => { const ms = e.members.filter((it) => it.type === t).sort((a, b) => (a.ts || 0) - (b.ts || 0)); return { type: t, n: ms.length, who: ms.map((it) => (isNum(it.ts) && Number.isFinite(t0) ? `${it.outlet} ${offTxt((it.ts - t0) / 60)}` : `${it.outlet} 時刻不明`)) }; });
  }
  const max = Math.max(1, ...rows.map((r) => r.n));
  return h('ul', { class: 'bars' }, rows.map((r) => h('li', null, h('span', { class: 'bl', text: r.type }), h('span', { class: 'bb' }, h('i', { style: `width:${(r.n / max) * 100}%` })),
    h('span', { class: 'bn', text: r.n }), h('span', { class: 'bd', text: r.who.join('、') }))));
}
/** the lineage: the board's 30-day record (CONTRACT 18.10) when it has one; otherwise events of this fetch that share words */
function sameWords(e) {
  if (e.exact && Array.isArray(e.case.lineage)) return { from: 'history', rows: e.case.lineage.filter(isObj) };
  const words = e.basis && arr(e.basis.words).length ? arr(e.basis.words) : [];
  const out = [];
  for (const o of state.es) {
    if (o === e) continue;
    const shared = words.filter((w) => o.hay.includes(w));
    const place = e.geo && o.geo && o.geo.key === e.geo.key && o.topics.some((t) => e.topics.includes(t));
    if (shared.length >= 2 || (shared.length && place)) out.push({ o, shared });
  }
  return { from: 'fetch', rows: out.sort((a, b) => b.shared.length - a.shared.length || b.o.n - a.o.n).slice(0, 5) };
}
function histNote() {
  const hs = state.hist;
  if (!isObj(hs)) return '記録を読めない';
  return `記録 ${arr(hs.entries).length} 件・${isNum(hs.days) ? hs.days : 30} 日分まで・${fmtShort(hs.updated_at)} 更新`;
}
function renderCase() {
  const box = $('case');
  const e = cur();
  if (!e) { box.replaceChildren(h('p', { class: 'empty big', text: state.es.length ? '出来事を選ぶ' : '出来事 0 件' })); renderStatus(); return; }
  const ms = e.members;
  const first = [...ms].filter((it) => isNum(it.ts)).sort((a, b) => a.ts - b.ts)[0] || ms[0];
  const jp = ms.filter((it) => it.home === 'jp').length, intl = ms.length - jp;
  const types = uniq(ms.map((it) => it.type));
  const run = isObj(state.data.ai_run) ? state.data.ai_run : {};
  const kept = state.snap ? state.snap.kept : null;
  const aiBy = kept ? [str(kept.snapRun.provider), str(kept.snapRun.model)] : [str(run.provider), str(run.model)];
  const aiAt = kept ? kept.aiAt : run.at;
  const aiTag = (by, at) => h('span', { class: 'by' }, h('span', { class: 'aimk', text: 'AI' }), by.filter(Boolean).join(' · ') || '—', isNum(at) ? ` · ${fmtShort(at)}` : '');

  // head: where, what, one big number and the facts
  const place = h('div', { class: 'ch-place' },
    e.geo ? h('span', { class: 'pl', text: e.geo.name }) : h('span', { class: 'pl none', text: '地名なし' }),
    e.geo ? h('span', { class: 'prec', text: `${e.geo.prec} · 「${e.geo.via}」から${e.geo.guessed ? '推定' : ''}` }) : null,
    e.topics.length ? h('span', { class: 'tp', text: e.topics.map(flagJa).join('・') }) : null,
    h('span', { class: 'fd', text: e.field }),
    h('button', { type: 'button', class: 'addtask', 'aria-pressed': 'false', on: { click: () => actions.run('task_add') } }, 'タスクに足す'),
    extLink(`${ISSUES}/new?title=${encodeURIComponent('掲載の停止の依頼')}`, { class: 'stopreq', title: STOP_NOTE }, '掲載の停止'));
  const head = h('div', { class: 'ch-main' },
    h('div', { class: 'ch-title' },
      h('h1', { lang: e.heading.lang || null, class: e.heading.none ? 'none' : null }, headNode(e, 'h1t')),
      e.heading.en ? h('p', { class: 'en', lang: 'en', text: e.heading.en }) : null),
    h('div', { class: 'ch-big' }, num(e.n), h('span', { class: 'u', text: '媒体' })));
  const facts = h('dl', { class: 'facts' },
    h('dt', { text: '初報' }), h('dd', null, `${fmtClock(first && first.ts)} `, h('span', { class: 'o', text: str(first && first.outlet) })),
    h('dt', { text: '最新' }), h('dd', { text: fmtClock(e.last) }),
    h('dt', { text: '経過' }), h('dd', { text: fmtSpan(isNum(e.last) && isNum(e.first) ? e.last - e.first : null) }),
    h('dt', { text: '国内・海外' }), h('dd', { text: `${jp} · ${intl}` }),
    h('dt', { text: '型' }), h('dd', { text: types.length }),
    e.event ? [h('dt', { text: '事件' }), h('dd', null, e.event.key, h('span', { class: 'o', text: ` · 束 ${e.event.n}` }))] : null,
    e.exact && isNum(e.case.n_new6h) ? [h('dt', { text: '6 時間の新着' }), h('dd', { text: e.case.n_new6h })] : null,
    e.case && arr(e.case.hits).length ? [h('dt', { text: '当たった語' }), h('dd', { class: 'hits', text: arr(e.case.hits).join('・') })] : null);
  const aiLines = [];
  if (e.summary) aiLines.push(h('p', { class: 'ch-ai' }, h('span', { text: str(e.summary.text_ja) }), aiTag([str(e.summary.provider), str(e.summary.model)], e.summary.made_at)));
  if (e.ai && str(e.ai.contrast_ja)) aiLines.push(h('p', { class: 'ch-ai' }, h('span', { text: e.ai.contrast_ja }), aiTag(aiBy, aiAt)));
  if (aiLines.length || e.heading.ai) aiLines.push(h('p', { class: 'ainote', text: AI_NOTE }));

  // the photo: the one the board chose (CONTRACT 20.5) for an event of two or more outlets; never cropped; the outlet and the link stay
  const ph = e.case && isObj(e.case.photo) ? e.case.photo : null;
  const phUrl = ph ? safeImg(ph.url) : null;
  const phIt = ph ? ctx().ix.items[ph.id] || state.ix.items[ph.id] || {} : {};
  const photo = phUrl ? h('section', { class: 'cb cb-photo' },
    h('figure', { class: 'pfig' },
      extLink(safeUrl(phIt.link) || '#', { class: 'pimg', title: `${str(ph.outlet)} の記事を開く` }, h('img', { src: phUrl, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer',
        on: { error: (ev) => { ev.target.closest('figure').classList.add('noimg'); ev.target.replaceWith(h('span', { class: 'pcard', text: str(ph.outlet) })); } } })),
      h('figcaption', null, h('b', { text: str(ph.outlet) }), viaGN(phIt) ? ' · Google ニュース経由' : '', isNum(phIt.ts) ? ` ${fmtClock(phIt.ts)}` : ''))) : null;

  // every report: time, delay from the first, outlet, type, the headline as published, the AI's focus line
  const angles = new Map(e.ai ? arr(e.ai.angles).filter(isObj).map((a) => [a.item_id, str(a.focus_ja)]) : []);
  const t0 = first && isNum(first.ts) ? first.ts : null;
  const sorted = [...ms].sort((a, b) => (isNum(a.ts) ? a.ts : Infinity) - (isNum(b.ts) ? b.ts : Infinity));
  const members = h('section', { class: 'cb cb-members' },
    h('h3', null, '全報道', h('span', { class: 'n', text: ms.length })),
    h('ol', { class: 'mem' }, sorted.map((it, i) => {
      const link = safeUrl(it.link);
      const title = typeof it.title === 'string' && it.title.trim() ? it.title : null;
      return h('li', { class: i === 0 && isNum(it.ts) ? 'first' : null },
        h('span', { class: 'mt' }, isNum(it.ts) ? fmtClock(it.ts) : '—', h('small', { text: isNum(it.ts) && t0 != null ? plusH(it.ts - t0) : '時刻不明' })),
        h('span', { class: 'mb' },
          h('span', { class: 'mo' }, h('b', { text: outletOf(it) }), h('span', { text: ` ${str(it.type)}${it.home === 'intl' ? '・海外' : ''}` }), viaGN(it) ? h('span', { class: 'via', text: ' · Google ニュース経由' }) : null),
          link ? extLink(link, { class: 'mh', lang: it.lang === 'en' ? 'en' : null }, title ? `「${title}」` : outletOf(it) || hostOf(link)) : h('span', { class: 'mh', text: title ? `「${title}」` : '—' }),
          angles.get(it.id) ? h('span', { class: 'mf' }, h('span', { class: 'aimk', text: 'AI' }), angles.get(it.id)) : null));
    })));

  // the side: timing by type, counts by type, labels, why grouped, radius, same words
  const flags = e.ruleFlags.map((f) => { const t = flagText(f); return t ? h('li', { class: 'flag-row', title: t.tip }, h('span', { class: 'flag', text: t.ja }), h('span', { class: 'rl', text: '規則' })) : null; });
  const ae = e.case && state.board ? arr(state.board.asymmetry).find((a) => isObj(a) && a.sid === e.case.sid) : null;
  const al = ae && str(ae.label_ja) ? { ja: ae.label_ja, rule: str(((state.board.asym_labels || {})[ae.kind] || {}).rule) } : null;
  if (isObj(al)) flags.unshift(h('li', { class: 'flag-row', title: str(al.rule) }, h('span', { class: 'flag', text: str(al.ja) }), h('span', { class: 'rl', text: '規則' })));
  if (e.topics.length) flags.unshift(h('li', { class: 'flag-row' }, h('span', { class: 'tpf', text: e.topics.map(flagJa).join('・') }), h('span', { class: 'rl', text: '規則' })));
  const vetoed = [];   // the AI does not label (A4): what the rules removed from an AI's labels is not shown
  const b = e.basis;
  const basis = b ? h('dl', { class: 'kv' },
    h('dt', { text: '束ねた手' }), h('dd', { text: b.by === 'ai' ? 'AI' : '規則（語の重なり）' }),
    h('dt', { text: '共通の語' }), h('dd', { text: arr(b.words).length ? arr(b.words).join('、') : '—' }),
    h('dt', { text: '地名' }), h('dd', { text: arr(b.places).length ? arr(b.places).map(pj).join('、') : '—' }),
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
  const same = sameWords(e);
  const terms = e.case ? arr(e.case.key_terms).filter((x) => typeof x === 'string') : [];
  const side = h('section', { class: 'cb cb-side' },
    h('h3', null, '経過'), lanes(e),
    h('h3', null, '型ごとの本数', h('span', { class: 'n', text: types.length })), byType(e),
    flags.filter(Boolean).length || vetoed.filter(Boolean).length ? h('h3', null, '札', h('span', { class: 'n', text: noteJa() })) : null,
    flags.filter(Boolean).length || vetoed.filter(Boolean).length ? h('ul', { class: 'flags' }, flags, vetoed) : null,
    h('h3', null, '束ねた理由'), basis,
    terms.length ? h('p', { class: 'terms' }, h('span', { class: 'k', text: '鍵語' }), terms.join('、')) : null,
    h('h3', null, `半径 ${RADIUS_KM} km`), radius,
    h('h3', null, same.from === 'history' ? '系譜' : '同じ語の出来事', h('span', { class: 'n', text: same.rows.length })),
    same.from === 'history'
      ? (same.rows.length ? h('ul', { class: 'near' }, same.rows.map((x) => h('li', null, `${fmtShort(x.first_ts)}〜${fmtShort(x.last_ts)} · ${x.n_outlets}媒体 · ${arr(x.shared).join('・')}`)))
        : h('p', { class: 'empty', text: `0 件（${histNote()}）` }))
      : same.rows.length ? h('ul', { class: 'rows mini' }, same.rows.map((x) => h('li', { class: 'r', on: { click: () => select(x.o.key, true) } }, h('span', { class: 'rt', text: x.o.heading.text }), h('span', { class: 'rm', text: `${x.o.n}媒体 · ${x.shared.join('・') || (x.o.geo ? x.o.geo.name : '')}` })))) : h('p', { class: 'empty', text: '0 件（この取得の中）' }));

  const node = h('div', { class: 'case-in' }, h('header', { class: 'ch' }, place, head, facts, aiLines), h('div', { class: 'cbody' + (photo ? '' : ' nophoto') }, photo, members, side));
  box.replaceChildren(node);
  if (!reduced()) { node.classList.add('enter'); }
  renderStatus();
  renderTasks();
}

// ---------------------------------------------------------------- the map
function scene() {
  const e = cur();
  const pri = new Set(state.pri.map((x) => x.key));
  const at = new Map();
  for (const x of state.es) {
    if (!x.geo) continue;
    const k = `${x.geo.lat.toFixed(1)},${x.geo.lon.toFixed(1)}`;
    const a = at.get(k) || { lat: x.geo.lat, lon: x.geo.lon, n: 0, pri: false, name: x.geo.name, ref: x.key, best: 0, country: !!x.geo.country };
    a.n++; if (pri.has(x.key)) a.pri = true;
    if (x.n > a.best) { a.best = x.n; a.ref = x.key; }
    if (/[^\x00-\x7f]/.test(x.geo.name) && !/[^\x00-\x7f]/.test(a.name)) a.name = x.geo.name;
    at.set(k, a);
  }
  const points = [...at.values()].map((a) => ({ lat: a.lat, lon: a.lon, n: a.n, pri: a.pri ? 1 : 0, country: a.country, name: a.name, ref: a.ref }));
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
  for (const e of state.pri.slice(0, 12)) if (e.geo) L.push({ lat: e.geo.lat, lon: e.geo.lon, label: `${e.geo.name}・${String(e.heading ? e.heading.text : '').slice(0, 28)}` });
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
  $('map-read').textContent = e && e.geo ? `${e.geo.name} ${Math.abs(e.geo.lat).toFixed(1)}°${e.geo.lat >= 0 ? 'N' : 'S'} ${Math.abs(e.geo.lon).toFixed(1)}°${e.geo.lon >= 0 ? 'E' : 'W'} · ${e.geo.prec}` : e ? '地名なし' : '';
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
    $('count-h').textContent = '取得した見出し';
    roll($('count-n'), cn.headlines.fetched);
    const f = [['窓の見出し', cn.headlines.in_window], ['2 媒体以上', cn.multi_outlet], ['国内と海外', isObj(cn.home) ? cn.home.both : null]];
    $('count-f').replaceChildren(...f.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', null, num(isNum(v) ? v : null))]));
    return;
  }
  if (x) {
    $('count-h').textContent = '取得した見出し';
    roll($('count-n'), x.fetched_items);
    const f = [['窓の見出し', x.in_window], ['2 媒体以上', x.multi_outlet], ['一次資料', x.primary_items]];
    $('count-f').replaceChildren(...f.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', null, num(isNum(v) ? v : null))]));
    return;
  }
  $('count-h').textContent = '束ねた見出し';
  roll($('count-n'), items.length);
  $('count-f').replaceChildren(
    h('dt', { text: '出来事' }), h('dd', null, num(es.length)), h('dt', { text: '2 媒体以上' }), h('dd', null, num(es.filter((e) => e.n >= 2).length)),
    h('dt', { text: '国内と海外' }), h('dd', null, num(es.filter((e) => e.cover === 'both').length)), h('dt', { text: '写真あり' }), h('dd', null, num(items.filter((it) => imageOf(it)).length)));
}
function renderHaz() {
  const hz = state.haz;
  const b = $('haz-b');
  if (!hz) { $('haz-c').textContent = '—'; b.replaceChildren(h('p', { class: 'empty', text: '読込中' })); return; }
  $('haz-c').replaceChildren(`地震 ${hz.quakes.length} · 台風 ${hz.typhoons.length} · 災害 ${hz.disasters.length}`);
  const tsu = arr(hz.tsunami).filter(isObj).map((t) => h('li', { class: 'tsu' }, h('b', { text: str(t.title) || '津波の情報' }), ` ${fmtShort(t.issued)} `,
    arr(t.areas).filter(isObj).slice(0, 4).map((a) => `${str(a.name)} ${str(a.level)} ${str(a.max_height)}`).join('、')));
  const ty = hz.typhoons.map((t) => h('li', { class: 'ty', on: { click: () => openUrl(t.url) } },
    h('span', { class: 'tyn' }, h('b', { text: t.name || '台風' }), h('span', { text: ` ${t.intensity || ''}${t.scale ? '・' + t.scale : ''} ${t.src && t.src !== 'JMA' ? t.src : ''}` })),
    h('span', { class: 'tyv', text: [isNum(t.pressure) ? `${t.pressure} hPa` : '', isNum(t.windMs) ? `最大 ${t.windMs} m/s` : '', t.location, [t.course, isNum(t.speedKmh) ? `${t.speedKmh} km/h` : ''].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || '値の発表なし' }),
    h('span', { class: 'tyv', text: [t.stormKm ? `暴風域 ${t.stormKm} km` : '', t.galeKm ? `強風域 ${t.galeKm} km` : '', t.forecast.length ? `予報 ${t.forecast.length}` : '', t.cone && t.cone.length ? '予報の範囲' : '', fmtShort(t.ts)].filter(Boolean).join(' · ') })));
  const hot = (q) => q.mag >= 5 || ['4', '5-', '5+', '6-', '6+', '7'].includes(q.shindo);
  const qs = [...hz.quakes].sort((a, b2) => (b2.src === 'jma' ? 1 : 0) - (a.src === 'jma' ? 1 : 0) || b2.ts - a.ts);
  const pick = [...qs.filter(hot), ...qs.filter((q) => !hot(q))].slice(0, 14).sort((a, b2) => b2.ts - a.ts);
  const quakes = pick.map((q) => h('li', { class: hot(q) ? 'hot' : null, on: { click: () => openUrl(q.url) } },
    h('span', { class: 'qt', text: fmtClock(q.ts) }), h('span', { class: 'qm', text: `M${q.mag.toFixed(1)}` }), h('span', { class: 'qs', text: q.shindo ? `震度${shindoJa(q.shindo)}` : '' }),
    h('span', { class: 'qp', text: q.place || '—' }), h('span', { class: 'qd', text: isNum(q.depthKm) ? `${Math.round(q.depthKm)}km` : '' })));
  const dis = hz.disasters.filter((x) => x.alert === 'Red' || x.alert === 'Orange').slice(0, 6).map((x) => h('li', { class: 'hot', on: { click: () => openUrl(x.url) } },
    h('span', { class: 'qm wide', text: x.typeJa || disasterJa(x.type) }), h('span', { class: 'qp', text: `${x.name} ${x.alert === 'Red' ? '赤' : '橙'}` })));
  const stv = (k, ja) => { const v = hz.status && hz.status[k]; return isObj(v) ? h('span', { class: v.ok ? null : 'bad', title: str(v.err), text: `${ja} ${v.ok ? (isNum(v.n) ? v.n : '—') : '取得できず'}` }) : null; };
  b.replaceChildren(
    tsu.length ? h('ul', { class: 'haz' }, tsu) : null,
    ty.length ? h('ul', { class: 'haz ty-l' }, ty) : null,
    h('ul', { class: 'haz' }, quakes.length ? quakes : h('li', { class: 'empty', text: '地震 0 件' })),
    dis.length ? h('ul', { class: 'haz' }, dis) : null,
    h('p', { class: 'pfoot src', 'data-host': '' }, hz.from === 'live' ? '閲覧時に取得 ' : '', isNum(hz.at) ? `${fmtShort(hz.at)} ` : '', isNum(hz.at) ? ageEl(hz.at, SIX_H) : null, ' ',
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
      if (!x.ok) return h('li', { class: 'old' }, h('span', { class: 'mn', text: str(x.name_ja) }), h('span', { class: 'mv', text: '—' }), h('span', { class: 'mp', text: '' }), h('span', { class: 'mt', title: str(x.err), text: '取得できず' }));
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
function renderPol() {
  const p = state.pol;
  const b = $('pol-b');
  if (p === undefined) { b.replaceChildren(h('p', { class: 'empty', text: '読込中' })); return; }
  if (!p) { $('pol-c').textContent = '—'; b.replaceChildren(h('p', { class: 'empty', text: '政治のデータを読めない' })); return; }
  const link = (r) => (safeUrl(r.link) ? extLink(safeUrl(r.link), { class: 'pt' }, str(r.title) || '—') : h('span', { class: 'pt', text: str(r.title) || '—' }));
  const sec = [];
  const rows = (title, list, fmt, n) => { const r = arr(list).filter(isObj); sec.push(h('h4', null, title, h('span', { class: 'n', text: ` ${r.length}` }))); sec.push(r.length ? h('ul', { class: 'pol' }, r.slice(0, n || 4).map(fmt)) : h('p', { class: 'empty sm', text: p.failed && p.failed[title] ? '取得できず' : '0 件' })); };
  const counts = isObj(p.bills) && isObj(p.bills.counts) ? p.bills.counts : {};
  const top = (o) => Object.entries(isObj(o) ? o : {}).sort((a, b2) => b2[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(' · ');
  sec.push(h('h4', { text: '議案' }), h('p', { class: 'polc' }, h('b', { text: '衆 ' }), top(counts.shugiin) || '—'), h('p', { class: 'polc' }, h('b', { text: '参 ' }), top(counts.sangiin) || '—'));
  const recent = [...arr(p.bills && p.bills.recent && p.bills.recent.shugiin), ...arr(p.bills && p.bills.recent && p.bills.recent.sangiin)].filter(isObj).sort((a, b2) => (b2.ts || 0) - (a.ts || 0));
  if (recent.length) sec.push(h('ul', { class: 'pol' }, recent.slice(0, 3).map((r) => h('li', null, h('span', { class: 'po', text: str(r.status) }), link(r), h('span', { class: 'pa', text: fmtAge(r.ts) })))));
  rows('官邸', p.office, (r) => h('li', null, h('span', { class: 'po', text: str(r.outlet) }), link(r), h('span', { class: 'pa', text: fmtAge(r.ts) })), 3);
  rows('官報', p.gazette, (r) => h('li', null, h('span', { class: 'po', text: fmtShort(r.ts) }), link(r), h('span', { class: 'pa' })), 3);
  rows('会計検査院', p.audit, (r) => h('li', null, h('span', { class: 'po', text: fmtShort(r.ts) }), link(r), h('span', { class: 'pa' })), 3);
  const parties = arr(p.parties).filter(isObj);
  sec.push(h('h4', null, '各党の発信', h('span', { class: 'n', text: ` ${parties.length}` })), h('ul', { class: 'pol' }, parties.map((x) => { const r = arr(x.items).filter(isObj).sort((a, b2) => (b2.ts || 0) - (a.ts || 0))[0] || {}; return h('li', null, h('span', { class: 'po', text: str(x.outlet) }), link(r), h('span', { class: 'pa', text: fmtAge(r.ts) })); })));
  const k = isObj(p.kokkai) ? arr(p.kokkai.meetings).filter(isObj) : null;
  sec.push(h('h4', null, '会議録', h('span', { class: 'n', text: k ? ` ${k.length}` : ' —' })), k && k.length ? h('ul', { class: 'pol' }, k.slice(0, 4).map((m2) => h('li', null, h('span', { class: 'po', text: str(m2.date).slice(5) }), safeUrl(m2.url) ? extLink(safeUrl(m2.url), { class: 'pt' }, `${str(m2.house)} ${str(m2.meeting)}`) : h('span', { class: 'pt', text: `${str(m2.house)} ${str(m2.meeting)}` }), h('span', { class: 'pa', text: str(m2.issue) })))) : h('p', { class: 'empty sm', text: k ? '0 件' : '取得できず' }));
  $('pol-c').replaceChildren(ageEl(p.generated_at, SIX_H));
  $('pol-c').dataset.host = '';
  b.replaceChildren(...sec, h('p', { class: 'pfoot', text: str(p.order_rule) ? '並びは官邸が先、各党は名前の順。色・順位なし' : '' }));
}
// ---------------------------------------------------------------- broadcast: the broadcasters' own channels (js/tv.js)
function renderTv() {
  const box = $('tv-b');
  if (!box) return;
  const st = STATIONS.find((x) => x.id === state.tv) || state.tvAuto || STATIONS[0];
  $('tv-c').textContent = st.name;
  let f = box.querySelector('.tv-f');
  if (!f) { f = h('div', { class: 'tv-f' }); box.replaceChildren(f, h('div', { class: 'tv-ch', role: 'group', 'aria-label': '局' }), h('p', { class: 'pfoot tv-n' })); }
  const src = embedSrc(st);
  const fr = f.querySelector('iframe');
  if (!fr || fr.dataset.src !== src) f.replaceChildren(h('iframe', { src, title: `${st.name}（YouTube）`, loading: 'lazy', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin', data: { src } }));
  box.querySelector('.tv-ch').replaceChildren(...STATIONS.map((x) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(x.id === st.id), on: { click: () => { state.tv = x.id; renderTv(); } } }, x.short)));
  box.querySelector('.tv-n').textContent = `${st.mode === 'live' ? 'ライブ' : '最新の動画'} · 公式チャンネル · 音は押すまで出ない`;
}
function followTv(e) { if (!e) return; state.tvAuto = stationFor(e.members.map(outletOf), e.cover); if (!state.tv) renderTv(); }

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
  const q = state.tickQ.length ? state.tickQ : state.pri.slice(0, 1);
  if (!q.length) { box.replaceChildren(h('span', { class: 'k', text: '注目' }), '0 件'); return; }
  const i = state.tickI % q.length;
  const e = q[i];
  const line = h('span', { class: 'tk' + (force && !reduced() ? ' in' : '') },
    h('span', { class: 'k', text: state.tickQ.length ? `新着 ${i + 1}/${q.length}` : `注目 1/${state.pri.length}` }),
    headNode(e, 'tt'),
    h('span', { class: 'tm', text: ` ${e.n}媒体${e.topics.length ? ' · ' + e.topics.map(flagJa).join('・') : ''}` }));
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
    h('ul', { class: 'floor' }, h('li', { text: '見出しとリンクは各媒体に帰属。画像は各記事の元の場所から表示' }), h('li', { text: '媒体に左右の札を付けない' }),
      h('li', { text: '見出しの真偽は判定しない' }), h('li', { text: '「見当たらない」は取得した配信の中での話' }), h('li', { text: AI_NOTE }), h('li', null, extLink(ISSUES, null, '掲載の停止の依頼'), `・${STOP_NOTE}`)),
    det('ab-scope', '取得の範囲', true), det('ab-ai', 'AI の実行'), det('ab-eval', '検査'), det('ab-src', '源の一覧'), det('ab-byok', '自分の鍵で AI を回す（任意）'));
  aboutNode.querySelector('#ab-byok-i').append(
    h('p', { class: 'lead', text: '鍵はこのタブのメモリだけに置き、送り先は Google だけ' }),
    h('p', { class: 'msg', id: 'byok-req' }),
    h('label', { class: 'fld' }, 'モデル', h('input', { id: 'byok-model', type: 'text', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' })),
    h('label', { class: 'fld' }, '鍵', h('input', { id: 'byok-key', type: 'password', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' })),
    h('div', { class: 'btns' },
      h('button', { type: 'button', class: 'btn pri', id: 'byok-run', text: '実行', on: { click: onRun } }),
      h('button', { type: 'button', class: 'btn', id: 'byok-restore', text: '記録済みに戻す', hidden: true, on: { click: onRestore } }),
      extLink('https://aistudio.google.com/apikey', { class: 'btn' }, '鍵を作る')),
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
  q1('#ab-scope-s').textContent = `${rows.length} 配信`;
  q1('#ab-scope-i').replaceChildren(kv([['組んだ時刻', h('span', { 'data-host': '' }, fmtFull(d.generated_at), ' ', ageEl(d.generated_at, SIX_H))],
    ['時間の幅', `${isNum(d.window_h) ? d.window_h : 36} 時間`], ['配信', `${rows.length}（取れた ${rows.length - fails}・届かなかった ${fails}）`, fails ? 'err' : null],
    ['引用の扱い', str(d.rights_mode) === 'strict' ? '利用条件を確かめた源だけ見出しを表示' : '全ての源の見出しを引用（媒体名・時刻・リンク付き）']]));
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
  if (kept) aiRows.push(['束ねた取得', fmtFull(kept.fetchedAt)]);
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
      h('span', { class: 'si', text: isNum(r.n) ? `${r.n}` : '—' }), isNum(r.fetched_at) ? ageEl(r.fetched_at, SIX_H) : h('span', { class: 'err-t', text: '未取得' }),
      terms ? extLink(terms, { class: 'stm' }, TERMS_TEXT[ts]) : h('span', { class: 'stm', text: TERMS_TEXT[ts] }),
      failed ? h('span', { class: 'err-t', text: str(r.err) || '届かなかった' }) : null));
  }
  q1('#ab-src-s').textContent = fails ? `${rows.length}（届かなかった ${fails}）` : `${rows.length}`;
  q1('#ab-src-i').replaceChildren(ol);
  renderByok();
}
const EVAL_JA = {
  fabricated_ids: '答えに出た、塊に無い id', dup_ids: '二度使った id', unassigned_ids: '取りこぼした id', json_broken: 'JSON として読めない答え', shape_broken: '形の崩れた答え',
  answers_missing: '答えの無い呼び', flags_proposed: 'AI が付けた札', flags_vetoed: '規則が外した札', quoted_fields: '見出しを写した文', suspect_merges_veto: '疑わしい併合（規則の拒否）',
  suspect_merges_no_shared: '疑わしい併合（共通点なし）', place_misread_known: '地名の読み違い（既知の型）', calls: '呼び', calls_failed: '失敗した呼び', blocks_sent: '送った塊',
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
async function loadEval() { state.evalData = await getJson(dataDir() + 'eval.json'); if (state.about) renderEval(); }
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
}
function byokMsg(text, err) { const m = q1('#byok-msg'); if (!m) return; m.textContent = text; m.classList.toggle('err', !!err); }
function looksLikeData(x) { return isObj(x) && Array.isArray(x.stories) && Array.isArray(x.rule_clusters) && isObj(x.items); }
/** Runs a visitor's key through provider.js and rerun.js (onRun passes the modules it imported). */
export async function byokWith(providerMod, rerunMod, key, model) {
  if (!providerMod || typeof providerMod.geminiProvider !== 'function') throw new Error('provider.js に geminiProvider が無い');
  if (!rerunMod || typeof rerunMod.rerunAI !== 'function') throw new Error('rerun.js に rerunAI が無い');
  let provider = await providerMod.geminiProvider(key, model);
  key = null;
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
  if (st === 'partial') byokMsg(`一部だけ通りました。${explain(run.errors)} 通らなかった塊は規則の束で出しています。`, true);
  else byokMsg(`完了（呼び ${isNum(run.calls) ? run.calls : '—'}）`);
  return out;
}
function errText(err) {
  const code = err && (err.code || err.padCode || err.message);
  if (typeof code === 'string' && ERR_TEXT[code]) return ERR_TEXT[code];
  const m = err && err.message ? String(err.message) : String(err);
  return m.length > 140 ? m.slice(0, 139) + '…' : m;
}
async function onRun() {
  if (state.busy) return;
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
    try { mods = await Promise.all([import('./provider.js'), import('./rerun.js')]); } catch { byokMsg('部品を読めませんでした。記録済みの表示のままです。', true); return; }
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
  $('watch-suggest').replaceChildren(...names.map((n) => h('button', { type: 'button', class: 'chip', text: n, 'aria-label': `${n} を追う`, on: { click: () => setWatch(addWatch(state.watch, n)) } })));
}
function setWatch(list) { state.watch = list; saveWatch(store, list); renderAll(); return true; }

// ---------------------------------------------------------------- state line
function setState(text, busy) {
  const el = $('state');
  const t = text || (state.live ? '閲覧者の鍵の結果' : state.view === 'ai' ? 'AI の束' : '規則の束');
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
  for (const el of document.querySelectorAll('.rows .r.sel')) { el.classList.remove('sel'); const l = el.querySelector('.autoline'); if (l) l.remove(); }
  for (const el of document.querySelectorAll(`.rows .r[data-key="${CSS.escape(key)}"]`)) {
    el.classList.add('sel');
    if (el.closest('#pri-b') && !el.querySelector('.autoline')) el.append(h('i', { class: 'autoline', 'aria-hidden': 'true' }));
  }
  const inPri = document.querySelector(`#pri-b .r[data-key="${CSS.escape(key)}"]`);
  if (inPri && !byHand) inPri.scrollIntoView({ block: 'nearest' });
  if (changed) { renderCase(); renderSources(); renderHours(); renderMap(true); if (byHand) followTv(state.byKey.get(key)); }
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
  if (!state.byKey.has(keep)) { state.sel = null; const f = shownPri()[0] || state.es[0]; if (f) select(f.key, false); }
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
function step(dir) {
  const list = shownPri();
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
    renderTicker(false); renderWatch();
    if (state.about) renderAbout();
    if (state.sheet) renderSheet();
    tick();
  } catch (err) {
    showFatal(`表示に失敗しました: ${err && err.message ? err.message : String(err)}`);
  }
}
function showFatal(text) { const el = $('fatal'); el.textContent = text; el.hidden = false; }

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
  const held = state.stopped || now < state.pausedUntil || state.about || !!state.sheet;
  line.classList.toggle('held', held);
  line.classList.remove('run');
  if (!held) { line.style.setProperty('--auto-ms', `${Math.max(0, state.autoNext - now)}ms`); void line.offsetWidth; line.classList.add('run'); }
}
function autoStep() {
  if (narrow() || state.about || state.sheet || state.stopped || document.hidden) return;
  if (state.floor && state.floor.mode() === 'map') return;     // the whole map is being read: the event in focus stays
  const now = Date.now();
  if (now < state.pausedUntil) return;
  const line = document.querySelector('#pri-b .r.sel .autoline');
  if (line && line.classList.contains('held')) syncAutoLine();
  if (now < state.autoNext) return;
  state.autoNext = now + AUTO_MS;
  step(1);
}
function tickerStep() {
  if (document.hidden) return;
  if (state.tickQ.length > 1 || Date.now() - state.tickAt > 60000) { state.tickI++; renderTicker(true); }
}

// ---------------------------------------------------------------- since the last visit, and live updates
function keysOf(d) { return arr(d && d.stories).map((x) => memberKey(x.member_ids)); }
function loadSeen() { try { const j = store ? JSON.parse(store.getItem(SEEN_KEY) || 'null') : null; return isObj(j) && Array.isArray(j.keys) ? j : null; } catch { return null; } }
function saveSeen(d) { try { store && store.setItem(SEEN_KEY, JSON.stringify({ gen: d.generated_at, keys: keysOf(d).slice(0, 3000) })); } catch { /* this visit only */ } }
function markNew(prevKeys) {
  const before = new Set(prevKeys);
  state.newKeys = new Set(keysOf(state.base).filter((k) => !before.has(k)));
  state.tickQ = []; state.tickI = 0; state.tickAt = Date.now();
}
async function poll() {
  if (document.hidden) return;
  const d = await getJson(state.dataPath);
  if (!looksLikeData(d) || !state.base || d.generated_at === state.base.generated_at) return;
  if (state.live) { state.pending = d; setState(`新しい取得 ${fmtShort(d.generated_at)}・記録済みに戻すと読込`); return; }
  const prev = keysOf(state.base);
  const board = await getJson(dataDir() + 'board.json');
  if (isObj(board) && board.schema === 'parallax-board/1') state.board = board;
  state.base = d; state.data = d;
  markNew(prev);
  state.flashed.clear();
  saveSeen(d);
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
  renderHaz(); renderMap(false);
  if (cur()) renderCase();
  if (state.sheet === 'haz') renderSheet();
}
async function loadSide() {
  const [m, p, hs] = await Promise.all([getJson(dataDir() + 'markets.json'), getJson(dataDir() + 'politics.json'), getJson(dataDir() + 'history.json')]);
  state.mkt = isObj(m) ? m : null;
  state.pol = isObj(p) ? p : null;
  state.hist = isObj(hs) ? hs : null;
  renderMkt(); renderPol();
  if (cur()) renderCase();
  if (state.sheet === 'mkt' || state.sheet === 'pol') renderSheet();
}

// ---------------------------------------------------------------- sheets: a pane opened toward the viewer — one big number, the facts, then everything
const SHEETS = { src: '源', hours: '時間ごとの見出し', pri: '注目', anom: '非対称', mkt: '市場', pol: '政治', haz: '災害' };
const SHEET_PANE = { src: 'p-src', hours: 'p-hours', pri: 'p-pri', anom: 'p-anom', mkt: 'p-mkt', pol: 'p-pol', haz: 'p-haz' };
const SHEET_ALIAS = { 源: 'src', ソース: 'src', 情報源: 'src', 時間ごと: 'hours', 時間: 'hours', 注目: 'pri', 非対称: 'anom', 市場: 'mkt', 政治: 'pol', 災害: 'haz' };
const sheetKind = (k) => { const x = String(k || '').trim(); return SHEETS[x] ? x : SHEET_ALIAS[x] || null; };
const fmtN = (v) => (isNum(v) ? v.toLocaleString('ja-JP') : '—');
const td = (v, c) => h('td', { class: c || null }, v == null ? '—' : v);
const tbl = (cols, rows, cls) => h('table', { class: 'dt' + (cls ? ' ' + cls : '') },
  h('thead', null, h('tr', null, cols.map(([t, c]) => h('th', { class: c || null, text: t })))), h('tbody', null, rows));
const sec = (title, n) => h('h3', { class: 'ds-sec' }, title, n != null ? h('span', { class: 'n', text: n }) : null);
const chev = () => s('svg', { viewBox: '0 0 12 12', 'aria-hidden': 'true' }, s('path', { d: 'M3.5 8.5l5-5M4.5 3.5h4v4' }));

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
const SHEET_BODY = {
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
      body.push(tbl([['源'], ['', 'opt'], ['状態'], ...(anyQ ? [['経由・検索の語', 'opt']] : []), ['1時間', 'r'], ['6時間', 'r'], ['48時間', 'r'], ['最新', 'r opt'], ...(anyDrop ? [['外した', 'r opt']] : [])], rs.map((r) => h('tr', { class: bad(r) ? 'bad' : null },
        td(str(r.name)), td(r.home === 'intl' ? '海外' : '国内', 'dim opt'), td(bad(r) ? (str(r.err) || staleJa) : '届いた', bad(r) ? 'err' : 'dim'), ...(anyQ ? [td(r.via === 'gnews' ? `Google ニュース${str(r.query) ? '「' + str(r.query) + '」' : ''}` : '', 'dim opt')] : []),
        td(fmtN(r.h1), 'r'), td(fmtN(r.h6), 'r'), td(fmtN(r.h48), 'r'), td(isNum(r.age_h) ? `${r.age_h}時間前` : '—', 'r dim opt'), ...(anyDrop ? [td(fmtN(dropOf(r)), 'r dim opt')] : [])))));
    }
    return { big: fmtN(live), unit: `/ ${rows.length} 届いた源`, bad: live < rows.length * 0.8,
      facts: cn && isObj(cn.headlines) ? [['取得した見出し', fmtN(cn.headlines.fetched)], ['窓の見出し', fmtN(cn.headlines.in_window)], ['出来事', fmtN(cn.bundles && cn.bundles.events)], ['2 媒体以上', fmtN(cn.multi_outlet)],
        [staleJa, fmtN(stale.size), stale.size ? 'err' : ''], ['事件の層', fmtN(cn.incidents)]] : [['取得した見出し', fmtN(x.fetched_items)], ['窓の見出し', fmtN(x.in_window)], ['出来事', fmtN(x.stories)], ['2 媒体以上', fmtN(x.multi_outlet)], ['一次資料', fmtN(x.primary_items)],
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
    const svg = s('svg', { viewBox: `0 0 ${W} ${H + 22}`, class: 'ds-bars', role: 'img', 'aria-label': '48 時間の見出しの数' });
    for (const f of [0.5, 1]) svg.append(s('line', { x1: 0, x2: W, y1: (H - f * H + 0.5).toFixed(1), y2: (H - f * H + 0.5).toFixed(1), class: 'gl' }), s('text', { x: W, y: H - f * H - 3, class: 'ax end' }, document.createTextNode(String(Math.round(max * f)))));
    bins.forEach((v, i) => {
      const ago = n - 1 - i, hh = (v / max) * H;
      svg.append(s('rect', { x: (i * bw + 1).toFixed(1), y: (H - hh).toFixed(1), width: (bw - 2).toFixed(1), height: Math.max(0.5, hh).toFixed(1), class: priAgo.has(ago) ? 'pri' : '' },
        s('title', {}, document.createTextNode(`${fmtShort(from + i * 3600)}〜 ${v} 件${priAgo.has(ago) ? `・注目の初報 ${priAgo.get(ago)}` : ''}`))));
      if (i % 6 === 0) svg.append(s('text', { x: i * bw + 1, y: H + 16, class: 'ax' }, document.createTextNode(fmtShort(from + i * 3600))));
    });
    const bt = isObj(vol.by_type) ? vol.by_type : {};
    const types = uniq([...TYPE_ORDER.filter((t) => Array.isArray(bt[t])), ...Object.keys(bt).filter((t) => Array.isArray(bt[t]))]);
    const body = [sec('時間ごと', `${n} 時間`), svg, sec('型 × 時間', types.length), heatSvg(types.map((t) => [t, [...bt[t]].reverse()]), n, '型ごとの時間ごとの数')];
    if (b.slab && Array.isArray(b.slab.cats) && Array.isArray(b.slab.grid)) body.push(sec('分野 × 時間', b.slab.cats.length), heatSvg(b.slab.cats.map((c, i) => [c, [...arr(b.slab.grid[i])].reverse()]), n, '分野ごとの時間ごとの数'));
    return { big: fmtN(bins[n - 1]), unit: '直近 1 時間の見出し',
      facts: [[`${n}時間`, fmtN(bins.reduce((a, v) => a + v, 0))], ['最多', `${fmtN(max)}・${fmtShort(from + peak * 3600)}`], ['注目の初報', `${priAgo.size} 時間帯`], ['型', fmtN(types.length)]], body };
  },
  pri() {
    const list = shownPri();
    const rows = list.map((e, i) => h('tr', { class: 'go' + (e.key === state.sel ? ' sel' : ''), on: { click: () => { closeSheet(); select(e.key, true); } } },
      td(String(i + 1), 'r dim'), td(e.topics.map(flagJa).join('・') || '—', 'flagc'), td(e.heading.text, 'tt'), td(`${e.n}`, 'r'), td(e.field, 'dim opt'),
      td(e.case ? arr(e.case.hits).slice(0, 4).join('・') : '', 'dim opt'), td(fmtAge(e.last), 'r dim')));
    return { big: fmtN(list.length), unit: state.q ? `「${state.q}」の一致` : state.topic === 'all' ? '注目の出来事' : `注目・${state.topic === 'watch' ? '追う' : state.topic === 'cross' ? '国内と海外' : flagJa(state.topic)}`,
      facts: TOPICS.map((t) => [flagJa(t.id), fmtN(state.pri.filter((e) => e.topics.includes(t.id)).length)]),
      body: [tbl([['', 'r'], ['旗'], ['見出し'], ['媒体', 'r'], ['分野', 'opt'], ['当たった語', 'opt'], ['最新', 'r']], rows)], foot: '旗は公開した規則で付けた札' };
  },
  anom() {
    const rows = anomRows();
    const kinds = uniq(rows.map((r) => r.ja));
    const body = [];
    for (const k of kinds) {
      const rs = rows.filter((r) => r.ja === k);
      body.push(sec(k, rs.length), tbl([['見出し'], ['媒体', 'r'], ['型', 'opt'], ['最新', 'r']], rs.map((r) => h('tr', { class: 'go', on: { click: () => { closeSheet(); select(r.e.key, true); } } },
        td(r.e.heading.text, 'tt'), td(`${r.e.n}`, 'r'), td(uniq(r.e.members.map((it) => it.type)).join('・'), 'dim opt'), td(fmtAge(r.e.last), 'r dim')))));
    }
    return { big: fmtN(rows.length), unit: '非対称の出来事', facts: kinds.map((k) => [k, fmtN(rows.filter((r) => r.ja === k).length)]), body: body.length ? body : [h('p', { class: 'empty', text: '0 件' })], foot: `規則で付けた札・${noteJa()}` };
  },
  mkt() {
    const m = state.mkt;
    if (!m || !Array.isArray(m.series)) return { big: '—', unit: '市場のデータを読めない', facts: [], body: [] };
    const ok = m.series.filter((x) => isObj(x) && x.ok);
    const mv = (x) => (x.unit === '%' ? Math.abs(x.chg_bp || 0) / 5 : Math.abs(x.chg_pct || 0));
    const chg = (x) => { const rate = x.unit === '%', c = rate ? x.chg_bp : x.chg_pct; return isNum(c) ? `${c > 0 ? '+' : ''}${rate ? c.toFixed(1) + 'bp' : c.toFixed(2) + '%'}` : '—'; };
    const top = [...ok].sort((a, b2) => mv(b2) - mv(a))[0];
    const GROUP = { rates: '金利', fx: '為替', commodity: '商品' };
    const body = [];
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
      facts: [['系列', `${ok.length} / ${m.series.length}`], ['取得', fmtShort(m.generated_at)], ['国債の日付', str(m.jgb && m.jgb.date) || '—']], body, foot: str(m.note_ja) || '売買の推奨ではありません' };
  },
  pol() {
    const p = state.pol;
    if (!p) return { big: '—', unit: '政治のデータを読めない', facts: [], body: [] };
    const link = (r) => (safeUrl(r.link) ? extLink(safeUrl(r.link), {}, str(r.title) || '—') : str(r.title) || '—');
    const list = (title, rs, who) => [sec(title, rs.length), rs.length ? tbl([['', 'opt'], ['件名'], ['', 'r']], rs.map((r) => h('tr', null, td(who(r), 'dim opt'), td(link(r), 'tt'), td(fmtAge(r.ts), 'r dim')))) : h('p', { class: 'empty sm', text: '0 件' })];
    const counts = isObj(p.bills) && isObj(p.bills.counts) ? p.bills.counts : {};
    const pending = ['shugiin', 'sangiin'].reduce((a, k) => a + Object.entries(isObj(counts[k]) ? counts[k] : {}).filter(([n]) => /審議中|審査中/.test(n)).reduce((x, [, v]) => x + (isNum(v) ? v : 0), 0), 0);
    const recent = [...arr(p.bills && p.bills.recent && p.bills.recent.shugiin), ...arr(p.bills && p.bills.recent && p.bills.recent.sangiin)].filter(isObj).sort((a, b2) => (b2.ts || 0) - (a.ts || 0));
    const parties = arr(p.parties).filter(isObj);
    const k = isObj(p.kokkai) ? arr(p.kokkai.meetings).filter(isObj) : [];
    const st = p.session && isObj(p.session.state) ? p.session.state : null;
    const left = [...list('議案', recent, (r) => str(r.status)), ...list('官邸', arr(p.office).filter(isObj), (r) => str(r.outlet)), ...list('官報', arr(p.gazette).filter(isObj), (r) => fmtShort(r.ts)), ...list('会計検査院', arr(p.audit).filter(isObj), (r) => fmtShort(r.ts))];
    const right = [sec('各党の発信', parties.length), tbl([['党'], ['件名'], ['', 'r']], parties.flatMap((x) => arr(x.items).filter(isObj).sort((a, b2) => (b2.ts || 0) - (a.ts || 0)).slice(0, 3).map((r, i) => h('tr', null, td(i ? '' : str(x.outlet), 'dim'), td(link(r), 'tt'), td(fmtAge(r.ts), 'r dim'))))),
      sec('会議録', k.length), k.length ? tbl([['日付'], ['会議'], ['号', 'r']], k.map((m2) => h('tr', null, td(str(m2.date), 'dim'), td(safeUrl(m2.url) ? extLink(safeUrl(m2.url), {}, `${str(m2.house)} ${str(m2.meeting)}`) : `${str(m2.house)} ${str(m2.meeting)}`, 'tt'), td(str(m2.issue), 'r dim')))) : h('p', { class: 'empty sm', text: '0 件' })];
    return { big: fmtN(pending), unit: '審議中の議案（衆・参）',
      facts: [['会期', st ? str(st.text) || '—' : '—'], ['官邸', fmtN(arr(p.office).length)], ['官報', fmtN(arr(p.gazette).length)], ['検査院', fmtN(arr(p.audit).length)], ['各党', fmtN(parties.length)], ['会議', fmtN(k.length)], ['取得', fmtShort(p.generated_at)]],
      body: [h('div', { class: 'ds-cols' }, h('div', null, left), h('div', null, right))], foot: '並びは官邸が先、各党は名前の順。色・順位なし' };
  },
  haz() {
    const hz = state.haz;
    if (!hz) return { big: '—', unit: '読込中', facts: [], body: [] };
    const SH = ['1', '2', '3', '4', '5-', '5+', '6-', '6+', '7'];
    const qs = [...hz.quakes].sort((a, b2) => b2.ts - a.ts);
    const big = [...qs].sort((a, b2) => b2.mag - a.mag)[0];
    const shMax = qs.filter((q) => q.shindo).sort((a, b2) => SH.indexOf(b2.shindo) - SH.indexOf(a.shindo))[0];
    const hot = (q) => q.mag >= 5 || ['4', '5-', '5+', '6-', '6+', '7'].includes(q.shindo);
    const dis = [...hz.disasters].sort((a, b2) => ['Red', 'Orange', 'Green'].indexOf(a.alert) - ['Red', 'Orange', 'Green'].indexOf(b2.alert));
    const quakes = [sec('地震', qs.length), tbl([['時刻'], ['規模', 'r'], ['震度'], ['場所'], ['深さ', 'r opt'], ['源', 'opt']], qs.map((q) => h('tr', { class: 'go' + (hot(q) ? ' hotr' : ''), on: { click: () => openUrl(q.url) } },
      td(fmtShort(q.ts), 'dim'), td(`M${q.mag.toFixed(1)}`, 'r' + (hot(q) ? ' hot' : '')), td(q.shindo ? `震度${shindoJa(q.shindo)}` : '—', hot(q) ? 'hot' : 'dim'), td(q.place || '—'), td(isNum(q.depthKm) ? `${Math.round(q.depthKm)} km` : '—', 'r dim opt'), td(q.src === 'jma' ? '気象庁' : 'USGS', 'dim opt'))))];
    const ty = hz.typhoons.map((t) => [sec(t.name || '台風', t.src && t.src !== 'JMA' ? t.src : '気象庁'),
      h('dl', { class: 'kv' }, ...[['気圧', isNum(t.pressure) ? `${t.pressure} hPa` : '—'], ['最大風速', isNum(t.windMs) ? `${t.windMs} m/s` : '—'], ['位置', t.location || '—'], ['進路', [t.course, isNum(t.speedKmh) ? `${t.speedKmh} km/h` : ''].filter(Boolean).join(' ') || '—'],
        ['暴風域', t.stormKm ? `${t.stormKm} km` : '—'], ['強風域', t.galeKm ? `${t.galeKm} km` : '—'], ['発表', fmtShort(t.ts)]].flatMap(([a, v]) => [h('dt', { text: a }), h('dd', { text: v })])),
      t.forecast.length ? tbl([['予報'], ['中心'], ['予報円', 'r']], t.forecast.map((f) => h('tr', null, td(fmtShort(f.ts), 'dim'), td(`${f.center[0].toFixed(1)}°N ${f.center[1].toFixed(1)}°E`), td(f.radiusKm ? `${Math.round(f.radiusKm)} km` : '—', 'r')))) : null]);
    const right = [...ty.flat(), sec('災害', dis.length), dis.length ? tbl([['警報'], ['種類'], ['名']], dis.map((x) => h('tr', { class: 'go', on: { click: () => openUrl(x.url) } },
      td(x.alert === 'Red' ? '赤' : x.alert === 'Orange' ? '橙' : x.alert === 'Green' ? '緑' : str(x.alert), x.alert === 'Red' || x.alert === 'Orange' ? 'hot' : 'dim'), td(x.typeJa || disasterJa(x.type), 'dim'), td(str(x.name), 'tt')))) : h('p', { class: 'empty sm', text: '0 件' })];
    return { big: fmtN(qs.length), unit: '24 時間の地震',
      facts: [['最大', big ? `M${big.mag.toFixed(1)}・${big.place || '—'}` : '—', big && hot(big) ? 'err' : ''], ['最大の震度', shMax ? `${shindoJa(shMax.shindo)}・${shMax.place || '—'}` : '—'], ['台風', fmtN(hz.typhoons.length)],
        ['災害（橙・赤）', fmtN(dis.filter((x) => x.alert === 'Red' || x.alert === 'Orange').length)], ['津波', fmtN(arr(hz.tsunami).length)], ['取得', isNum(hz.at) ? fmtShort(hz.at) : '—']],
      body: [h('div', { class: 'ds-cols' }, h('div', null, quakes), h('div', null, right))], foot: '気象庁・USGS・GDACS' };
  },
};
function renderSheet() {
  const k = state.sheet;
  if (!k) return;
  let r;
  try { r = SHEET_BODY[k](); } catch (err) { r = { big: '—', unit: '', facts: [], body: [h('p', { class: 'empty', text: `表示に失敗しました: ${err && err.message ? err.message : String(err)}` })] }; }
  const box = $('sheet').querySelector('.dsheet');
  const keep = box.querySelector('.ds-b') ? box.querySelector('.ds-b').scrollTop : 0;
  box.replaceChildren(
    h('header', { class: 'ds-h' },
      h('div', { class: 'ds-t' }, h('h2', { id: 'ds-title', text: SHEETS[k] }), h('button', { type: 'button', class: 'ds-x', on: { click: closeSheet } }, '閉じる')),
      h('div', { class: 'ds-head' },
        h('div', { class: 'ds-big' + (r.bad ? ' stale' : '') }, h('b', { class: 'num', text: r.big }), h('span', { class: 'u', text: r.unit })),
        h('dl', { class: 'ds-facts' }, (r.facts || []).filter(Boolean).flatMap(([dt, dd, cls]) => [h('dt', { text: dt }), h('dd', { class: cls || null, text: dd })])))),
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
function renderTasks() {
  $('task-n').textContent = state.tasks.filter((t) => !t.done).length || '';
  const e = cur();
  const btn = document.querySelector('#case .addtask');
  if (btn && e) { const on = hasTask(state.tasks, e.case ? e.case.sid : e.key); btn.setAttribute('aria-pressed', String(on)); btn.textContent = on ? 'タスクにある' : 'タスクに足す'; }
  if ($('task-pop').hidden) return;
  $('task-list').replaceChildren(...(state.tasks.length ? state.tasks.map((t) => h('li', { class: t.done ? 'done' : null },
    h('input', { type: 'checkbox', checked: t.done ? true : null, 'aria-label': '済み', on: { change: () => setTasks(toggleTask(state.tasks, t.id)) } }),
    h('span', null, h('button', { type: 'button', class: 'tt', text: t.title, on: { click: () => { if (!(t.sid && find(t.sid)) && !find(t.title)) openUrl(t.link); } } }),
      h('span', { class: 'ta', text: `${fmtShort(Math.floor(t.at / 1000))} に足した` })),
    h('button', { type: 'button', class: 'wx', 'aria-label': '外す', text: '外す', on: { click: () => setTasks(removeTask(state.tasks, t.id)) } })))
    : [h('li', { class: 'empty', text: '0 件' })]));
}
function setTasks(list) { state.tasks = list; saveTasks(store, list); renderTasks(); return true; }
function taskAdd() {
  const e = cur();
  if (!e) return false;
  const link = e.members.map((it) => safeUrl(it.link)).find(Boolean) || '';
  return setTasks(addTask(state.tasks, { title: e.heading.text, sid: e.case ? e.case.sid : e.key, link }, Date.now()));
}
function openTasks() {
  const p = $('task-pop');
  p.hidden = false; $('task-btn').setAttribute('aria-expanded', 'true');
  renderTasks();
  return true;
}

// ---------------------------------------------------------------- voice: the browser's recogniser -> the closed list (js/voice.js)
let voiceKey = '';     // the visitor's own key for the AI step; memory only, this visit only
let voiceStop = null;
function voiceSay(parts) { const p = $('voice-pop'); p.hidden = false; p.replaceChildren(...parts.filter(Boolean)); }
async function voiceRun(alts) {
  const ja = (id) => (actions.list.find((c) => c.id === id) || {}).ja || id;
  let provider = null;
  if (voiceKey && MODEL_RE.test(defaultModel)) { try { provider = (await import('./provider.js')).geminiProvider(voiceKey, defaultModel, { retries: 0, timeoutMs: 8000 }); } catch { provider = null; } }
  const r = await voiceRoute(alts, { provider, catalog: actions.list });
  if (r.id !== 'none') {
    const out = actions.run(r.id, r.arg);
    voiceSay([h('p', { class: 'vh', text: `「${r.heard}」` }), h('p', { class: 'vr' + (out.ok ? '' : ' bad'), text: `${ja(r.id)}${r.arg ? `：${r.arg}` : ''}${out.ok ? '' : '（できず）'}${r.by === 'ai' ? '・AI が一覧から選んだ' : ''}` }), out.say ? h('p', { class: 'vr', text: out.say }) : null]);
    setTimeout(() => { if (!voiceStop) $('voice-pop').hidden = true; }, 4000);
    return;
  }
  const cands = r.cands.map((c) => h('button', { type: 'button', class: 'chip', text: c.ja, on: { click: () => { actions.run(c.id); $('voice-pop').hidden = true; } } }));
  if (r.heard) cands.push(h('button', { type: 'button', class: 'chip', text: `「${r.heard.slice(0, 16)}」で探す`, on: { click: () => { actions.run('case_find', r.heard); $('voice-pop').hidden = true; } } }));
  const keyIn = h('input', { type: 'password', class: 'vk', placeholder: 'Gemini の鍵（任意・この窓の間だけ）', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Gemini の鍵' });
  keyIn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); voiceKey = keyIn.value.trim(); keyIn.value = ''; voiceRun(alts); } });
  voiceSay([h('p', { class: 'vh', text: r.heard ? `「${r.heard}」` : '聞き取れず' }), h('p', { class: 'vr', text: r.by === 'ai' ? '一覧に当たらない' : '規則に当たらない' }), h('div', { class: 'vc' }, cands), voiceKey ? null : keyIn]);
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
  } catch { voiceStop = null; $('voice-btn').classList.remove('on'); voiceSay([h('p', { class: 'vr bad', text: '声の取得を始められない' })]); }
  return true;
}

// ---------------------------------------------------------------- start
const api = {
  step, find, setView, setTopic, setField: (f) => setField(f, true), toggleLayer,
  mapCase: () => { if (state.map) state.map.reset(); return true; },
  mapMode: () => (state.floor ? state.floor.toggle() : false),
  mapWorld: () => { if (!state.map) return false; state.map.show({ ...scene(), focus: null }, true); return true; },
  mapZoom: (k) => !!(state.map && state.map.zoom(k)),
  sayQuakes: () => { const q = state.haz && state.haz.quakes; if (!q) return '地震のデータは読込中'; const top = [...q].sort((a, b) => b.mag - a.mag)[0]; return top ? `24 時間で ${q.length} 件。最大は ${top.place} の M${top.mag.toFixed(1)}` : '24 時間で 0 件'; },
  sayTyphoons: () => { const t = state.haz && state.haz.typhoons; if (!t) return '台風のデータは読込中'; return t.length ? t.map((x) => `台風 ${x.name} ${x.location} ${x.pressure} hPa 最大 ${x.windMs} m/s`).join('。') : '台風 0 件'; },
  watchAdd: (t) => setWatch(addWatch(state.watch, t)), watchRemove: (t) => setWatch(removeWatch(state.watch, t)),
  openArticle: () => { const e = cur(); const l = e && e.members.map((it) => safeUrl(it.link)).find(Boolean); if (!l) return false; openUrl(l); return true; },
  openSheet: (k) => openSheet(k), taskAdd, openTasks,
  openAbout, close: () => { if (state.sheet) return closeSheet(); if (!$('task-pop').hidden) { $('task-pop').hidden = true; $('task-btn').setAttribute('aria-expanded', 'false'); return true; } if (!$('voice-pop').hidden) { $('voice-pop').hidden = true; return true; } if (state.about) return closeAbout(); if (!$('watch-pop').hidden) { $('watch-pop').hidden = true; $('watch-btn').setAttribute('aria-expanded', 'false'); return true; } return false; },
  autoStop: () => { state.stopped = true; syncAutoLine(); return true; }, autoStart: () => { state.stopped = false; state.autoNext = Date.now() + AUTO_MS; syncAutoLine(); return true; },
};
export const actions = createActions(api);

async function main() {
  const hv = location.hash.replace('#', '');
  const hashView = hv === 'rules' || hv === 'ai' ? hv : '';
  if (hashView) state.view = hashView;
  state.watch = loadWatch(store);
  state.tasks = loadTasks(store);
  try { const l = store ? JSON.parse(store.getItem(LAYER_KEY) || 'null') : null; state.layers = isObj(l) ? l : {}; } catch { state.layers = {}; }
  window.parallaxActions = actions;   // the voice layer (later) reads the same list

  $('v-rules').addEventListener('click', () => actions.run('view_rules'));
  $('v-ai').addEventListener('click', () => actions.run('view_ai'));
  let qt = 0;
  $('q').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { state.q = $('q').value.trim(); renderPri(); renderAnom(); renderFields(); }, 120); });
  $('watch-btn').addEventListener('click', () => { const p = $('watch-pop'); p.hidden = !p.hidden; $('watch-btn').setAttribute('aria-expanded', String(!p.hidden)); if (!p.hidden) { renderWatch(); $('watch-in').focus(); } });
  $('watch-form').addEventListener('submit', (ev) => { ev.preventDefault(); const v = $('watch-in').value; $('watch-in').value = ''; if (v.trim()) setWatch(addWatch(state.watch, v)); });
  $('about-btn').addEventListener('click', () => actions.run('about'));
  $('task-btn').addEventListener('click', () => { const p = $('task-pop'); if (p.hidden) openTasks(); else { p.hidden = true; $('task-btn').setAttribute('aria-expanded', 'false'); } });
  if (speechSupported()) { $('voice-btn').hidden = false; $('voice-btn').addEventListener('click', startVoice); }
  $('sheet').addEventListener('click', (ev) => { if (ev.target === $('sheet')) closeSheet(); });
  // every pane head opens its sheet toward the viewer
  for (const [k, id] of Object.entries(SHEET_PANE)) {
    const ph = $(id) && $(id).querySelector('.ph');
    if (!ph) continue;
    ph.classList.add('can-open');
    ph.append(h('button', { type: 'button', class: 'ph-open', 'aria-label': `${SHEETS[k]}の詳細を開く`, title: '詳細', on: { click: () => openSheet(k, $(id)) } }, chev()));
    ph.querySelector('h2').addEventListener('click', () => openSheet(k, $(id)));
  }
  $('p-count').querySelector('.ph').addEventListener('click', () => openSheet('src', $('p-count')));
  $('p-count').querySelector('.ph').classList.add('can-open');
  $('about-wrap').addEventListener('click', (ev) => { if (ev.target === $('about-wrap')) closeAbout(); });
  window.addEventListener('hashchange', () => { const x = location.hash.replace('#', ''); if (state.ix && (x === 'ai' || x === 'rules') && x !== state.view) setView(x); });
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, pause, { capture: true, passive: true });
  let pmAt = 0;   // moving the pointer alone also holds the sending (at most one hold per 400 ms)
  window.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'touch') return; const n = Date.now(); if (n - pmAt > 400) { pmAt = n; pause(); } }, { capture: true, passive: true });
  document.addEventListener('keydown', (ev) => {
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) { if (ev.key === 'Escape') t.blur(); return; }
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const k = ev.key;
    const map = { ArrowDown: ['case_next'], ArrowUp: ['case_prev'], j: ['case_next'], k: ['case_prev'], Escape: ['close'], a: ['view_ai'], r: ['view_rules'], m: ['map_mode'], w: ['map_world'], o: ['open_article'], i: ['about'], t: ['task_add'], '+': ['map_in'], '-': ['map_out'], v: ['__voice'] };
    if (map[k] && map[k][0] === '__voice') { if (!$('voice-btn').hidden) startVoice(); return; }
    if (k === '/') { ev.preventDefault(); $('q').focus(); return; }
    const gi = Number(k);
    if (gi >= 1 && gi <= TOPICS.length + 1) { actions.run('topic', gi === 1 ? 'all' : TOPICS[gi - 2].id); return; }
    if (map[k]) { ev.preventDefault(); actions.run(...map[k]); }
  });
  state.map = createMap($('map'), {
    onPick: onMapPick, wheel: false,
    local: (x, y) => (state.floor ? state.floor.local(x, y) : null),
    onPaint: (info) => { if (state.floor) state.floor.paint(info); },
  });
  state.floor = createFloor({ map: state.map, board: $('board'), onMode: () => { state.map.resize(); renderMap(true); } });
  // a list that does not fit scrolls itself (the event list follows the event in focus, so its own move takes over there)
  startAutoScroll('#src-b, #fields-b, #pri-b, #anom-b, #haz-b, #mkt-b, #pol-b', { held: () => !!(state.about || state.sheet) || !$('task-pop').hidden || !$('watch-pop').hidden });
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => state.map && state.map.resize(), 160); });

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
  state.base = data; state.data = data;
  const [labels, board] = await Promise.all([getJson(dataDir() + 'labels.json'), getJson(dataDir() + 'board.json')]);
  state.labels = labels;
  state.board = isObj(board) && board.schema === 'parallax-board/1' ? board : null;
  if (!(isObj(state.labels) && isObj(state.labels.flags))) state.labels = null;
  if (!hashView) state.view = defaultView(data);
  state.prevSeen = loadSeen();
  if (state.prevSeen && state.prevSeen.gen !== data.generated_at) markNew(state.prevSeen.keys);
  saveSeen(data);
  renderAll();
  state.tickQ = state.pri.filter((e) => state.newKeys.has(e.mk));
  renderTicker(false);
  const first = state.pri[0] || state.es[0];
  if (first) { select(first.key, false); followTv(first); }
  const askSid = new URLSearchParams(location.search).get('sid');   // a link to a story; a folded one opens its event
  if (askSid) find(askSid);
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
