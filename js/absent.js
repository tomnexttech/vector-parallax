/* absent — the outlets whose headlines in this fetch do not show an event. No DOM in absentOutlets (tests/js/absent.test.js).
 *
 *   absentOutlets(event, sources, generated_at) -> { total, reach, first, absent: [{ outlet, type, home }], unknown: [{ outlet, type, why }] }
 *     event   = { members: [{ outlet, media, type, ts }], first }     sources = latest.json sources[]
 *   absentBlock(res, { h, when, windowH, major }) -> one node: the counts, the names of the major types, the rest by type, the caveat
 *
 * A feed reaches the event (the same floor as CONTRACT 20.3): it was fetched (ok), its oldest headline is not later than the event's
 * first report, and it was fetched within 6 hours of the build. An outlet is "not seen" only when none of the event's reports is
 * from it and every ok feed of it reaches; any other outlet cannot be judged (its feed starts after the first report, failed, or is
 * old) and is only counted. The page never says an outlet did not carry the event: a different wording can escape the grouping rules. */

export const MAJOR_TYPES = ['公共放送', '通信社', '全国紙', '民放', '海外主流', '海外公共'];
export const TYPE_ORDER = ['政府一次', '通信社', '公共放送', '全国紙', '民放', '経済紙', '地方紙', '専門', '海外公共', '海外主流', '国家メディア'];
export const FRESH_S = 6 * 3600;
export const CAVEAT = 'ここに無いことは、その媒体が扱わなかったことを意味しません。別の言い方の見出しはまとめの規則で拾えないことがあります。';
const WHY_JA = { late: '最初の報道より後から', failed: '読めず', stale: '6 時間より前の更新' };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (typeof v === 'string' ? v : '');
const typeRank = (t) => { const i = TYPE_ORDER.indexOf(t); return i < 0 ? TYPE_ORDER.length : i; };
const byTypeName = (a, b) => typeRank(a.type) - typeRank(b.type) || a.type.localeCompare(b.type, 'ja') || a.outlet.localeCompare(b.outlet, 'ja');

export function absentOutlets(event, sources, generatedAt) {
  const ms = event && Array.isArray(event.members) ? event.members.filter((m) => m && typeof m === 'object') : [];
  const ts = ms.map((m) => m.ts).filter(isNum);
  const first = isNum(event && event.first) ? Math.min(event.first, ...ts) : ts.length ? Math.min(...ts) : null;
  const found = new Set(ms.flatMap((m) => [str(m.outlet), str(m.media)]).filter(Boolean));
  const feeds = (Array.isArray(sources) ? sources : []).filter((s) => s && typeof s === 'object' && str(s.outlet));
  const floor = isNum(generatedAt) ? generatedAt - FRESH_S : -Infinity;
  const why = (s) => (!s.ok ? 'failed' : !isNum(s.fetched_at) || s.fetched_at < floor ? 'stale' : first == null || !isNum(s.oldest_ts) || s.oldest_ts > first ? 'late' : '');
  const reach = feeds.filter((s) => !why(s)).length;
  const byOutlet = new Map();
  for (const s of feeds) { const o = byOutlet.get(s.outlet) || []; o.push(s); byOutlet.set(s.outlet, o); }
  const absent = [], unknown = [];
  for (const [outlet, fs] of byOutlet) {
    if (found.has(outlet)) continue;
    const ok = fs.filter((s) => s.ok);
    const type = str(fs[0].type), home = str(fs[0].home);
    const w = ok.length ? ok.map(why).find(Boolean) || '' : 'failed';
    if (w) unknown.push({ outlet, type, home, why: w, feeds: fs.length });
    else absent.push({ outlet, type, home });
  }
  absent.sort(byTypeName); unknown.sort(byTypeName);
  return { total: feeds.length, reach, first, absent, unknown };
}

/** what one outlet carried in the collected news, measured, never scored:
 *  outletProfile(events, outlet, { outletOf }) -> { n, multi, first, lagMed, fields: [[field, n]], rows: [{ e, ts, lag, first }] }
 *  n = the news with a headline of it; multi = of those, the news two outlets or more carried; first = in multi, its earliest
 *  headline is the news's earliest (ties count); lagMed = in multi, the median of its earliest headline minus the news's earliest, in seconds */
export function outletProfile(events, outlet, { outletOf = (it) => str(it.media) || str(it.outlet) } = {}) {
  const rows = [];
  for (const e of Array.isArray(events) ? events : []) {
    const ms = e && Array.isArray(e.members) ? e.members.filter((m) => m && typeof m === 'object') : [];
    const mine = ms.filter((m) => outletOf(m) === outlet);
    if (!outlet || !mine.length) continue;
    const outs = new Set(ms.map(outletOf).filter(Boolean)).size;
    const all = ms.map((m) => m.ts).filter(isNum), own = mine.map((m) => m.ts).filter(isNum);
    const t0 = all.length ? Math.min(...all) : null, t = own.length ? Math.min(...own) : null;
    rows.push({ e, ts: t, multi: outs >= 2, lag: t != null && t0 != null ? t - t0 : null, first: t != null && t === t0 });
  }
  const multi = rows.filter((r) => r.multi);
  const lags = multi.map((r) => r.lag).filter(isNum).sort((a, b) => a - b);
  const mid = lags.length ? (lags.length % 2 ? lags[(lags.length - 1) / 2] : (lags[lags.length / 2 - 1] + lags[lags.length / 2]) / 2) : null;
  const f = new Map();
  for (const r of rows) { const k = str(r.e.field) || 'その他'; f.set(k, (f.get(k) || 0) + 1); }
  rows.sort((a, b) => (isNum(b.ts) ? b.ts : -Infinity) - (isNum(a.ts) ? a.ts : -Infinity));
  return { n: rows.length, multi: multi.length, first: multi.filter((r) => r.first).length, lagMed: mid, fields: [...f.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')), rows };
}

/** groups of { type, names[] } in the type order */
export function groupByType(list) {
  const m = new Map();
  for (const x of list) { const g = m.get(x.type) || { type: x.type, names: [] }; g.names.push(x.outlet); m.set(x.type, g); }
  return [...m.values()];
}

/** the block under an event: h is the page's element helper, when = { at, first } already formatted */
export function absentBlock(res, { h, when, windowH, major = MAJOR_TYPES }) {
  const groups = groupByType(res.absent);
  const named = groups.filter((g) => major.includes(g.type)), rest = groups.filter((g) => !major.includes(g.type));
  const nUnknown = res.total - res.reach;
  const list = (gs, withN) => h('dl', { class: 'ab-list' }, gs.flatMap((g) => [h('dt', null, g.type, withN ? h('span', { class: 'n', text: g.names.length }) : null), h('dd', { text: g.names.join('・') })]));
  return h('div', { class: 'cb-absent' },
    h('h3', null, 'この話題が見つからなかった媒体', h('span', { class: 'n', text: res.absent.length })),
    h('p', { class: 'ab-sum', text: `集めた ${res.total} 媒体（${isNum(windowH) ? windowH : '—'} 時間分・${when.at} 時点）のうち、最初の報道（${when.first}）まで遡れる媒体は ${res.reach}。` }),
    named.length ? list(named, true) : h('p', { class: 'empty', text: '主要な種類では 0' }),
    rest.length ? h('details', { class: 'ab-more' }, h('summary', { text: rest.map((g) => `${g.type} ${g.names.length}`).join('・') }), list(rest, false)) : null,
    nUnknown > 0 ? h('details', { class: 'ab-more' }, h('summary', { text: `判定できない ${nUnknown} 媒体` }),
      h('dl', { class: 'ab-list' }, Object.keys(WHY_JA).flatMap((k) => { const xs = res.unknown.filter((u) => u.why === k); return xs.length ? [h('dt', { text: WHY_JA[k] }), h('dd', { text: xs.map((u) => u.outlet).join('・') })] : []; }))) : null,
    h('p', { class: 'ab-note', text: CAVEAT }));
}
