/* settings — how a visitor set up the board. Kept only in that visitor's browser (localStorage); never sent anywhere.
 * No DOM here. js/settings_panel.js draws the window, js/app.js applies the result.
 *
 *   loadSettings(storage) -> settings        storage may be missing, throw (private window) or hold broken JSON: the defaults, field by field
 *   saveSettings(storage, s) -> boolean      false when it could not be kept (the settings still work for this visit)
 *   cleanSettings(x) -> settings             every field checked; an unknown key, a wrong type or a value out of range falls back to its default
 *   exportSettings(s, watch) -> string       one JSON file: the settings and the watched words
 *   importSettings(text) -> { ok, settings, watch, error }     error: 'big' | 'json' | 'shape'
 *   addTerm(list, term, max, len) / removeTerm(list, term)     the muted words and outlets, folded like the watched words (NFKC, case)
 *   hiddenBy(s, ev) -> null | { k, v }       why an event is hidden: k = word | outlet | type | field | scope
 *   loadOwnAI(storage) / saveOwnAI(storage, c) / cleanOwnAI(x) / activeOwnAI(c, fallbackModel)     the viewer's own AI: a provider, a key and a model
 *                                            for each provider. Kept under its own storage key, apart from the settings: the key is never in the file that
 *                                            exportSettings writes, and never leaves this browser except to the provider the viewer chose
 *
 * Hiding is the visitor's choice and is never silent: the page counts what the settings hide, shows it on one press, and keeps a
 * priority row as a folded tag instead of removing it. An event is hidden by outlet or by type only when every report of it is
 * from a muted outlet or a type turned off, so that one outlet turned off never takes away what others reported. */

import { STATIONS } from './tv.js';
import { fold, terms } from './prefs.js';
import { KINDS, PROVIDERS, MODEL_RE } from './provider.js';

export const SETTINGS_KEY = 'parallax.settings.v1';
export const SETTINGS_SCHEMA = 'parallax-settings/1';
export const MUTE_WORDS = 20;     // as many as the watched words, each at most 40 characters
export const MUTE_OUTLETS = 60;
export const WORD_LEN = 40;
export const NAME_LEN = 60;
const LIST_MAX = 60;              // types and fields turned off
const IMPORT_MAX = 200000;        // characters of a settings file

/** the panes a visitor may turn off; the event and the priority list always stay */
export const PANES = [
  ['src', '源'], ['hours', '時間ごとの見出し'], ['fields', '分野'], ['anom', '非対称'], ['map', '地図'],
  ['count', '集めた見出し'], ['tv', '映像'], ['haz', '災害'], ['mkt', '市場'], ['pol', '政治'],
];
const PANE_IDS = PANES.map(([id]) => id);
const STATION_IDS = STATIONS.map((x) => x.id);

export const SCOPES = ['all', 'jp', 'intl'];
export const VIEWS = ['auto', 'ai', 'rules'];
export const LANGS = ['ja', 'en', 'orig'];
export const CALM = ['system', 'on'];
export const THEMES = ['dark', 'light'];   // the appearance, dark unless chosen; js/theme_boot.js reads look.theme before the first paint

export function defaults() {
  return {
    tv: { auto: true, sound: false, order: [...STATION_IDS], off: [] },
    news: { types_off: [], fields_off: [], scope: 'all', view: 'auto', lang: 'ja' },
    mute: { words: [], outlets: [] },
    motion: { cases: true, scroll: true, calm: 'system', sound: true, hoverSound: false },
    panes: { off: [] },
    look: { theme: 'dark' },
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const pick = (v, list, d) => (list.includes(v) ? v : d);
const subset = (v, ids) => { const s = new Set(Array.isArray(v) ? v : []); return ids.filter((id) => s.has(id)); };

export function cleanSettings(x) {
  const d = defaults();
  const o = isObj(x) ? x : {};
  const tv = isObj(o.tv) ? o.tv : {}, news = isObj(o.news) ? o.news : {}, mute = isObj(o.mute) ? o.mute : {};
  const motion = isObj(o.motion) ? o.motion : {}, panes = isObj(o.panes) ? o.panes : {}, look = isObj(o.look) ? o.look : {};
  const order = [...new Set((Array.isArray(tv.order) ? tv.order : []).filter((id) => STATION_IDS.includes(id)))];
  for (const id of STATION_IDS) if (!order.includes(id)) order.push(id);
  return {
    tv: { auto: bool(tv.auto, d.tv.auto), sound: bool(tv.sound, d.tv.sound), order, off: subset(tv.off, STATION_IDS) },
    news: {
      types_off: terms(news.types_off, LIST_MAX, NAME_LEN), fields_off: terms(news.fields_off, LIST_MAX, NAME_LEN),
      scope: pick(news.scope, SCOPES, d.news.scope), view: pick(news.view, VIEWS, d.news.view), lang: pick(news.lang, LANGS, d.news.lang),
    },
    mute: { words: terms(mute.words, MUTE_WORDS, WORD_LEN), outlets: terms(mute.outlets, MUTE_OUTLETS, NAME_LEN) },
    motion: { cases: bool(motion.cases, d.motion.cases), scroll: bool(motion.scroll, d.motion.scroll), calm: pick(motion.calm, CALM, d.motion.calm),
      sound: bool(motion.sound, d.motion.sound), hoverSound: bool(motion.hoverSound, d.motion.hoverSound) },
    panes: { off: subset(panes.off, PANE_IDS) },
    look: { theme: pick(look.theme, THEMES, d.look.theme) },
  };
}

export function loadSettings(storage) {
  try {
    const raw = storage ? storage.getItem(SETTINGS_KEY) : null;
    return cleanSettings(raw ? JSON.parse(raw) : null);
  } catch { return defaults(); }
}

export function saveSettings(storage, s) {
  try {
    if (!storage) return false;
    storage.setItem(SETTINGS_KEY, JSON.stringify(cleanSettings(s)));
    return true;
  } catch { return false; }
}

export const addTerm = (list, term, max = MUTE_WORDS, len = WORD_LEN) => terms([...(Array.isArray(list) ? list : []), term], max, len);
export function removeTerm(list, term) { const k = fold(term); return (Array.isArray(list) ? list : []).filter((x) => fold(x) !== k); }

export function exportSettings(s, watch) {
  return JSON.stringify({ schema: SETTINGS_SCHEMA, settings: cleanSettings(s), watch: terms(watch) }, null, 2) + '\n';
}

export function importSettings(text) {
  if (typeof text !== 'string' || text.length > IMPORT_MAX) return { ok: false, error: 'big' };
  let j;
  try { j = JSON.parse(text); } catch { return { ok: false, error: 'json' }; }
  if (!isObj(j)) return { ok: false, error: 'shape' };
  const body = j.schema === SETTINGS_SCHEMA && isObj(j.settings) ? j.settings : j;
  if (!['tv', 'news', 'mute', 'motion', 'panes'].some((k) => isObj(body[k]))) return { ok: false, error: 'shape' };
  return { ok: true, settings: cleanSettings(body), watch: Array.isArray(j.watch) ? terms(j.watch) : null };
}

/** ev = { titles: [text], members: [{ names: [outlet, media], type }], field, cover } */
export function hiddenBy(s, ev) {
  if (!isObj(s) || !isObj(ev)) return null;
  const titles = (Array.isArray(ev.titles) ? ev.titles : []).map(fold).filter(Boolean);
  for (const w of s.mute.words) { const k = fold(w); if (k && titles.some((t) => t.includes(k))) return { k: 'word', v: w }; }
  const ms = Array.isArray(ev.members) ? ev.members.filter(isObj) : [];
  if (ms.length) {
    const muted = new Map(s.mute.outlets.map((o) => [fold(o), o]));
    const typesOff = new Set(s.news.types_off);
    const outOf = (m) => (Array.isArray(m.names) ? m.names : []).map((n) => muted.get(fold(n))).find(Boolean) || null;
    const byOutlet = ms.map(outOf);
    if (byOutlet.every(Boolean)) return { k: 'outlet', v: byOutlet[0] };
    if (ms.every((m, i) => byOutlet[i] || typesOff.has(m.type))) return { k: 'type', v: ms.map((m) => m.type).find((t) => typesOff.has(t)) || '' };
  }
  if (typeof ev.field === 'string' && s.news.fields_off.includes(ev.field)) return { k: 'field', v: ev.field };
  if (s.news.scope === 'jp' && ev.cover === 'intl') return { k: 'scope', v: 'intl' };
  if (s.news.scope === 'intl' && ev.cover === 'jp') return { k: 'scope', v: 'jp' };
  return null;
}

/** the words of a reason, for a folded row and the count */
export function reasonJa(r) {
  if (!r) return '';
  return r.k === 'word' ? `語「${r.v}」` : r.k === 'outlet' ? `媒体「${r.v}」` : r.k === 'type' ? `源の型「${r.v}」`
    : r.k === 'field' ? `分野「${r.v}」` : r.v === 'intl' ? '海外の出来事' : '国内の出来事';
}
export const KIND_JA = { word: '語', outlet: '媒体', type: '源の型', field: '分野', scope: '国内と海外' };

// ------------------------------------------------------------ the viewer's own AI (a key of their own, optional)
export const OWN_AI_KEY = 'parallax.ownai.v1';
export const OWN_KINDS = ['none', ...KINDS];
const KEY_RE = /^[\x21-\x7e]{8,400}$/;    // printable ASCII, no spaces: what a header can carry and a provider's key looks like

/** is this text usable as a key (the panel says so before it keeps it) */
export const keyOk = (v) => typeof v === 'string' && KEY_RE.test(v.trim());
export const modelOk = (v) => typeof v === 'string' && MODEL_RE.test(v.trim());
export function emptyOwnAI() {
  return { kind: 'none', keys: Object.fromEntries(KINDS.map((k) => [k, ''])), models: Object.fromEntries(KINDS.map((k) => [k, ''])) };
}
/** one key and one model for each provider, so a key typed for one provider can never be sent to another */
export function cleanOwnAI(x) {
  const o = isObj(x) ? x : {}, ks = isObj(o.keys) ? o.keys : {}, ms = isObj(o.models) ? o.models : {};
  const out = emptyOwnAI();
  out.kind = pick(o.kind, OWN_KINDS, 'none');
  for (const k of KINDS) {
    out.keys[k] = keyOk(ks[k]) ? ks[k].trim() : '';
    out.models[k] = modelOk(ms[k]) ? ms[k].trim() : '';
  }
  return out;
}
export function loadOwnAI(storage) {
  try {
    const raw = storage ? storage.getItem(OWN_AI_KEY) : null;
    return cleanOwnAI(raw ? JSON.parse(raw) : null);
  } catch { return emptyOwnAI(); }
}
export function saveOwnAI(storage, c) {
  try {
    if (!storage) return false;
    const v = cleanOwnAI(c);
    if (v.kind === 'none' && KINDS.every((k) => !v.keys[k] && !v.models[k])) storage.removeItem(OWN_AI_KEY);
    else storage.setItem(OWN_AI_KEY, JSON.stringify(v));
    return true;
  } catch { return false; }
}
/** the AI in use: { kind, ja, key, model } when a provider is chosen and has a key, else null. fallbackModel: the model the data names for Gemini. */
export function activeOwnAI(c, fallbackModel) {
  const v = cleanOwnAI(c);
  if (!KINDS.includes(v.kind) || !v.keys[v.kind]) return null;
  const k = v.kind;
  return { kind: k, ja: PROVIDERS[k].ja, key: v.keys[k], model: v.models[k] || (k === 'gemini' && modelOk(fallbackModel) ? fallbackModel : PROVIDERS[k].model) };
}
