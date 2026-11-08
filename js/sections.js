/* sections — the app's whole screens and what they need that is not drawing. No DOM.
 *
 *   SECTIONS                                the eight screens, in the order of the bar
 *   NEWS_TABS                               the ways of reading the news inside ニュース
 *   parseHash(hash) -> { sect, tab } | null null: the hash is not a screen (#ai, #rules, #p-case keep their own meaning)
 *   hashOf(sect, tab) -> '#news/paper'
 *   paperOf(events, { outletOf, order, cap }) -> [{ type, label, n, rows: [{ e, it }] }]
 *                                           the paper: official documents, national papers, wire services, business papers, public broadcasting.
 *                                           One headline of an event to a column, in the order of the list; a column with nothing is left out
 *   nextSeen(prev, gen, keys, now) -> { prev, since, fresh: [key], save }
 *                                           what is new since the visitor last looked; a reload of the same data keeps the same answer
 *   shareUrl(loc, { sid, title }) -> url    one event's address: its story id, else its headline; ?data= stays for a local copy
 *   ruleJa(kind, en) -> text                the rule of an automatic label in Japanese, the published English where a kind is not known
 *   oneSideOf(events, { sidesOf }) -> [{ side, ja, short, rule, events }]
 *                                           the news whose reports come from one side only (Japan, abroad, the ministries), two outlets or more
 *
 * Neutral by rule: nothing here ranks an outlet or says what an outlet did not do. */

export const SECTIONS = [
  { id: 'home', ja: 'ホーム' }, { id: 'news', ja: 'ニュース' }, { id: 'map', ja: '地図' }, { id: 'market', ja: '市場' },
  { id: 'politics', ja: '政治' }, { id: 'disaster', ja: '災害' }, { id: 'video', ja: '映像' }, { id: 'saved', ja: '保存' },
];
export const NEWS_TABS = [['now', '今の順'], ['rank', 'ランキング'], ['paper', '紙面'], ['diff', '前回から'], ['anom', '一部の媒体だけ'], ['hours', '時間ごと'], ['src', '媒体']];
const SECT_IDS = new Set(SECTIONS.map((x) => x.id));
const TAB_IDS = new Set(NEWS_TABS.map(([id]) => id));

export function parseHash(hash) {
  const x = String(hash || '').replace(/^#/, '');
  if (!x) return { sect: 'home', tab: '' };
  const [sect, tab] = x.split('/');
  if (!SECT_IDS.has(sect)) return null;
  return { sect, tab: sect === 'news' && TAB_IDS.has(tab) ? tab : '' };
}
export const hashOf = (sect, tab) => `#${SECT_IDS.has(sect) ? sect : 'home'}${sect === 'news' && tab && tab !== 'now' && TAB_IDS.has(tab) ? '/' + tab : ''}`;

export const PAPER_ORDER = ['政府一次', '全国紙', '通信社', '経済紙', '公共放送'];
const PAPER_JA = { 政府一次: '官公庁の資料' };

export function paperOf(events, { outletOf = (it) => it.outlet, order = PAPER_ORDER, cap = 8 } = {}) {
  const out = [];
  const list = Array.isArray(events) ? events : [];
  for (const type of order) {
    const rows = [];
    let n = 0;
    for (const e of list) {
      const ms = (e && Array.isArray(e.members) ? e.members : []).filter((it) => it && it.type === type && typeof it.title === 'string' && it.title.trim());
      if (!ms.length) continue;
      n++;
      if (rows.length < cap) { const it = [...ms].sort((a, b) => (Number.isFinite(a.ts) ? a.ts : Infinity) - (Number.isFinite(b.ts) ? b.ts : Infinity))[0]; rows.push({ e, it, outlet: outletOf(it) }); }
    }
    if (rows.length) out.push({ type, label: PAPER_JA[type] || type, n, rows });
  }
  return out;
}

const KEEP_KEYS = 3000;
export function nextSeen(prev, gen, keys, now) {
  const all = Array.isArray(keys) ? keys : [];
  const p = prev && typeof prev === 'object' && Array.isArray(prev.keys) ? prev : null;
  if (!p) return { prev: null, since: null, fresh: [], save: { gen, keys: all.slice(0, KEEP_KEYS), at: now, since: null, fresh: [] } };
  if (p.gen === gen) {
    const fresh = Array.isArray(p.fresh) ? p.fresh.filter((k) => typeof k === 'string') : [];
    const since = Number.isFinite(p.since) ? p.since : null;
    return { prev: p, since, fresh, save: { gen, keys: all.slice(0, KEEP_KEYS), at: now, since, fresh } };
  }
  const before = new Set(p.keys);
  const fresh = [...new Set(all)].filter((k) => !before.has(k));
  const since = Number.isFinite(p.at) ? p.at : null;
  return { prev: p, since, fresh, save: { gen, keys: all.slice(0, KEEP_KEYS), at: now, since, fresh } };
}

export function shareUrl(loc, { sid = '', title = '' } = {}) {
  const u = new URL(loc.href);
  const data = u.searchParams.get('data');
  u.search = ''; u.hash = '';
  if (data) u.searchParams.set('data', data);
  if (/^s[0-9a-f]{8,}$/.test(sid)) u.searchParams.set('sid', sid);
  else if (title) u.searchParams.set('t', String(title).slice(0, 60));
  return u.href;
}

/* the news of one side only: the reports of an event come from one of Japan, abroad and the ministries, and from two outlets or more
 * (one outlet alone says nothing about a side). Counted on the collected headlines only; the other sides may carry it in other words. */
export const ONE_SIDE = [
  { side: 'jp', ja: '国内の報道だけ', short: '国内だけ', rule: '集めたニュースのうち、国内のメディアの見出しだけにあるニュース（2 媒体以上）' },
  { side: 'intl', ja: '海外の報道だけ', short: '海外だけ', rule: '集めたニュースのうち、海外のメディアの見出しだけにあるニュース（2 媒体以上）' },
  { side: 'gov', ja: '官公庁の資料だけ', short: '官公庁だけ', rule: '集めたニュースのうち、官公庁の資料だけにあるニュース（2 か所以上）' },
];
export const ONE_SIDE_TITLE = '片方の側だけのニュース';
export const ONE_SIDE_NOTE = 'ほかの側の見出しに無いことは、その側が扱わなかったことを意味しません。別の言い方の見出しはまとめの規則で拾えないことがあります。';

/** oneSideOf(events, { sidesOf, outletOf, min }) -> [{ side, ja, short, rule, events }] the sides that have such news, most outlets first */
export function oneSideOf(events, { sidesOf, outletOf = (it) => it.media || it.outlet, min = 2 } = {}) {
  const got = new Map(ONE_SIDE.map((g) => [g.side, []]));
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof sidesOf !== 'function') continue;
    const s = sidesOf(e);
    const on = ONE_SIDE.filter((g) => Array.isArray(s[g.side]) && s[g.side].length);
    if (on.length !== 1) continue;
    const n = new Set(s[on[0].side].map(outletOf).filter(Boolean)).size;
    if (n >= min) got.get(on[0].side).push({ e, n, last: Number.isFinite(e.last) ? e.last : 0 });
  }
  return ONE_SIDE.map((g) => ({ ...g, events: got.get(g.side).sort((a, b) => b.n - a.n || b.last - a.last).map((x) => x.e) })).filter((g) => g.events.length);
}

const RULE_JA = {
  primary_only: 'この話題を伝えているのがすべて政府や中央銀行で、お金か法律のラベルが付いている時に付きます',
  periphery_only: '政党の機関紙・週刊誌・地方紙だけ（官公庁・海外・専門の媒体を含むことがあります）が伝えていて、お金・法律・安全保障のラベルが付いている時に付きます',
  overseas_only: '海外の媒体だけが伝えていて、見出しに日本のことが出てくる時に付きます',
  mainstream_only: '国内の主要な媒体と官公庁だけ（4 媒体以上）が伝えていて、お金・法律・安全保障のラベルが付いている時に付きます',
};
export const ruleJa = (kind, en) => RULE_JA[kind] || (typeof en === 'string' ? en : '');
