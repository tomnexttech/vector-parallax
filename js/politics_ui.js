/* politics_ui — the politics pane and its sheet (data/politics.json, data/critical.json).
 *
 *   electionsView(p) -> { missing, ok, recent, upcoming, days, covers, note, name, pages }   the ministry's lists, newest first
 *   pollsView(p)     -> { missing, ok, series, latest, t0, t1, src }                         cabinet approval, one point per poll (its last day)
 *   scrutinyView(c)  -> { missing, ok, featured, groups, n, credit, note, failed }           one of each kind first, then all by kind
 *   createPolitics(d) -> { pane(p, c, scene), sheet(p, c, scene) }                           DOM, drawn with the helpers app.js hands over
 *
 * Neutral by rule: no label of true or false, left or right, good or bad; a rise or a fall carries no word and no colour of its own.
 * Nothing is drawn that the data does not hold: the chart joins one pollster's own points and draws no average. In the election
 * scene the elections and the approval series come first; the rest keeps its order. */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const dayTs = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(d + 'T00:00:00+09:00') / 1000 : null);
export const md = (d) => { const m = /^\d{4}-(\d{2})-(\d{2})/.exec(str(d)); return m ? `${Number(m[1])}/${Number(m[2])}` : '—'; };
const pct = (v) => (isNum(v) ? `${v}%` : '—');

export const KIND_JA = { governor: '都道府県知事選挙', mayor_designated: '指定都市市長選挙' };
const KIND_SHORT = { governor: '知事', mayor_designated: '指定都市市長' };
const SCR_TITLE = '調査報道・国会・学術・NGO';
const SLOTS = [['investigative', '調査報道'], ['diet_question', '国会 質問'], ['diet_answer', '国会 答弁'], ['academic', '学術'], ['ngo', 'NGO']];

export function electionsView(p) {
  const e = isObj(p) && isObj(p.elections) ? p.elections : null;
  if (!e) return { missing: true, ok: false, recent: [], upcoming: [], pages: [] };
  const src = isObj(e.source) ? e.source : {};
  const row = (r) => isObj(r) && dayTs(str(r.date)) != null && !!str(r.name);
  const newest = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name, 'ja'));
  return {
    missing: false, ok: e.status === 'ok', days: isNum(e.window_days) ? e.window_days : null,
    recent: arr(e.recent).filter(row).sort(newest), upcoming: arr(e.upcoming).filter(row).sort((a, b) => newest(b, a)),
    covers: str(src.covers_ja), note: str(src.note_ja), name: str(src.name) || '総務省',
    pages: arr(src.pages).filter((x) => isObj(x) && str(x.url)).map((x) => ({ label: str(x.label_ja) || KIND_JA[x.kind] || str(x.kind), url: x.url, ok: x.ok !== false })),
  };
}

export function pollsView(p) {
  const q = isObj(p) && isObj(p.polls) ? p.polls : null;
  if (!q) return { missing: true, ok: false, series: [], latest: [] };
  const series = arr(q.series).filter(isObj).map((x) => ({
    name: str(x.pollster_ja) || str(x.pollster),
    pts: arr(x.points).filter(isObj).map((o) => ({ start: str(o.start), end: str(o.end), t: dayTs(str(o.end)), approve: isNum(o.approve) ? o.approve : null,
      disapprove: isNum(o.disapprove) ? o.disapprove : null, sample: isNum(o.sample) ? o.sample : null, url: str(o.cite_url) }))
      .filter((o) => o.t != null && (o.approve != null || o.disapprove != null)).sort((a, b) => a.t - b.t),
  })).filter((x) => x.name && x.pts.length);
  const latest = series.map((x) => ({ name: x.name, ...x.pts[x.pts.length - 1] })).sort((a, b) => b.t - a.t || a.name.localeCompare(b.name, 'ja'));
  const ts = series.flatMap((x) => x.pts.map((o) => o.t));
  const s = isObj(q.source) ? q.source : {};
  return {
    missing: false, ok: series.length > 0, series, latest, t0: ts.length ? Math.min(...ts) : null, t1: ts.length ? Math.max(...ts) : null,
    src: { name: str(s.name), title: str(s.title), revid: isNum(s.revid) || str(s.revid) ? String(s.revid) : '', url: str(s.url), license: str(s.license), licenseUrl: str(s.license_url), note: str(s.note_ja) },
  };
}

export function scrutinyView(c) {
  if (!isObj(c) || c.schema !== 'parallax-critical/1') return { missing: !isObj(c), ok: false, featured: [], groups: [], n: 0, credit: [], failed: [] };
  const items = arr(c.items).filter((x) => isObj(x) && str(x.title));
  const byId = new Map(items.map((x) => [x.id, x]));
  const f = isObj(c.featured) ? c.featured : {};
  const kinds = isObj(c.kinds) ? c.kinds : {};
  const newest = (a, b) => (str(a.date) < str(b.date) ? 1 : str(a.date) > str(b.date) ? -1 : (b.ts || 0) - (a.ts || 0));
  return {
    missing: false, ok: c.status === 'ok' || items.length > 0, n: items.length, note: str(c.note_ja),
    featured: SLOTS.map(([k, ja]) => ({ k, ja, it: byId.get(f[k]) })).filter((x) => x.it),
    groups: Object.keys(kinds).map((k) => ({ k, ja: str(kinds[k] && kinds[k].ja) || k, items: items.filter((x) => x.kind === k).sort(newest) })).filter((g) => g.items.length),
    credit: Object.values(isObj(c.credit) ? c.credit : {}).filter((x) => typeof x === 'string' && x),
    failed: arr(c.sources).filter((x) => isObj(x) && x.ok === false).map((x) => str(x.name)).filter(Boolean),
  };
}

export function createPolitics(d) {
  const { h, s, extLink, safeUrl, fmtAge, fmtShort, sec, tbl, td, fmtN } = d;
  const link = (url, text, cls) => (safeUrl(url) ? extLink(safeUrl(url), cls ? { class: cls } : {}, text || '—') : cls ? h('span', { class: cls, text: text || '—' }) : (text || '—'));
  const head = (title, n) => h('h4', null, title, h('span', { class: 'n', text: ` ${n}` }));
  const empty = (text) => h('p', { class: 'empty sm', text });
  const note = (...kids) => h('p', { class: 'pnote' }, ...kids);

  // the cabinet approval chart: 0–100 % always (no zoom that makes a move look larger), one thin line per pollster, a dot per poll
  function chart(v, W, H, big) {
    const L = 20, R = 6, T = 5, B = 13, span = v.t1 - v.t0 || 1;
    const X = (t) => (L + ((t - v.t0) / span) * (W - L - R)).toFixed(1), Y = (val) => (T + (1 - val / 100) * (H - T - B)).toFixed(1);
    const kids = [];
    for (const g of [0, 25, 50, 75, 100]) kids.push(s('line', { class: 'gl', x1: L, x2: W - R, y1: Y(g), y2: Y(g) }), s('text', { class: 'ax', x: L - 3, y: Number(Y(g)) + 3, 'text-anchor': 'end' }, String(g)));
    const d0 = new Date((v.t0 + 9 * 3600) * 1000), step = big || span < 200 * 86400 ? 1 : 2;
    for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1, i = 0; i < 40; i++, m++) {
      if (m > 11) { m = 0; y++; }
      const t = Date.UTC(y, m, 1) / 1000 - 9 * 3600;
      if (t > v.t1) break;
      if (m % step) continue;
      kids.push(s('line', { class: 'gl v', x1: X(t), x2: X(t), y1: T, y2: H - B }), s('text', { class: 'ax', x: X(t), y: H - 2, 'text-anchor': 'middle' }, `${m + 1}月`));
    }
    for (const [key, cls] of [['disapprove', 'd'], ['approve', 'a']]) {
      const g = [];
      for (const x of v.series) {
        const pts = x.pts.filter((o) => o[key] != null);
        if (pts.length > 1) g.push(s('path', { d: pts.map((o, i) => `${i ? 'L' : 'M'}${X(o.t)} ${Y(o[key])}`).join('') }));
        for (const o of pts) g.push(s('circle', { cx: X(o.t), cy: Y(o[key]), r: big ? 2.2 : 1.6 }, s('title', null, `${x.name} ${md(o.end)} ${key === 'approve' ? '支持' : '不支持'} ${o[key]}%`)));
      }
      kids.push(s('g', { class: cls }, ...g));
    }
    const n = v.series.reduce((a, x) => a + x.pts.length, 0);
    return s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pchart' + (big ? ' l' : ''), role: 'img', 'aria-label': `内閣の支持と不支持の推移（${v.series.length}社・${n}回の調査）` }, ...kids);
  }
  const legend = () => h('p', { class: 'plg' }, h('i', { class: 'ap' }), '支持', h('i', { class: 'dp' }), '不支持', h('span', { text: '点＝各社の調査（最終日）・線＝同じ社の点を結ぶ' }));
  const pollSrc = (v) => note('出典 ', link(v.src.url, `${v.src.name || 'Wikipedia'}${v.src.revid ? ` 版 ${v.src.revid}` : ''}`), v.src.license ? [' · ', link(v.src.licenseUrl, v.src.license)] : null, '・各社の原典は社名のリンク');
  const kindOf = (r) => KIND_SHORT[r.kind] || str(r.kind);
  const elecSrc = (v) => note(`出典 ${v.name} `, ...v.pages.flatMap((x, i) => [i ? ' · ' : '', link(x.url, x.label)]));
  const nothingJa = (v) => `国内の知事・指定都市市長の選挙は直近${v.days || 60}日に無い（${v.name}の一覧）`;

  // ---- the pane
  function paneDiet(p) {
    const out = [];
    const lk = (r) => link(r.link, str(r.title), 'pt');
    const rows = (title, list, fmt, n) => { const r = arr(list).filter(isObj); out.push(head(title, r.length)); out.push(r.length ? h('ul', { class: 'pol' }, r.slice(0, n || 4).map(fmt)) : empty(p.failed && p.failed[title] ? '取得できず' : '0 件')); };
    const counts = isObj(p.bills) && isObj(p.bills.counts) ? p.bills.counts : {};
    const top = (o) => Object.entries(isObj(o) ? o : {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(' · ');
    out.push(h('h4', { text: '議案' }), h('p', { class: 'polc' }, h('b', { text: '衆 ' }), top(counts.shugiin) || '—'), h('p', { class: 'polc' }, h('b', { text: '参 ' }), top(counts.sangiin) || '—'));
    const recent = [...arr(p.bills && p.bills.recent && p.bills.recent.shugiin), ...arr(p.bills && p.bills.recent && p.bills.recent.sangiin)].filter(isObj).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if (recent.length) out.push(h('ul', { class: 'pol' }, recent.slice(0, 3).map((r) => h('li', null, h('span', { class: 'po', text: str(r.status) }), lk(r), h('span', { class: 'pa', text: fmtAge(r.ts) })))));
    rows('官邸', p.office, (r) => h('li', null, h('span', { class: 'po', text: str(r.outlet) }), lk(r), h('span', { class: 'pa', text: fmtAge(r.ts) })), 3);
    rows('官報', p.gazette, (r) => h('li', null, h('span', { class: 'po', text: fmtShort(r.ts) }), lk(r), h('span', { class: 'pa' })), 3);
    rows('会計検査院', p.audit, (r) => h('li', null, h('span', { class: 'po', text: fmtShort(r.ts) }), lk(r), h('span', { class: 'pa' })), 3);
    const parties = arr(p.parties).filter(isObj);
    out.push(head('各党の発信', parties.length), h('ul', { class: 'pol' }, parties.map((x) => { const r = arr(x.items).filter(isObj).sort((a, b) => (b.ts || 0) - (a.ts || 0))[0] || {}; return h('li', null, h('span', { class: 'po', text: str(x.outlet) }), lk(r), h('span', { class: 'pa', text: fmtAge(r.ts) })); })));
    const k = isObj(p.kokkai) ? arr(p.kokkai.meetings).filter(isObj) : null;
    out.push(h('h4', null, '会議録', h('span', { class: 'n', text: k ? ` ${k.length}` : ' —' })), k && k.length ? h('ul', { class: 'pol' }, k.slice(0, 4).map((m) => h('li', null, h('span', { class: 'po', text: str(m.date).slice(5) }), link(m.url, `${str(m.house)} ${str(m.meeting)}`, 'pt'), h('span', { class: 'pa', text: str(m.issue) })))) : empty(k ? '0 件' : '取得できず'));
    return out;
  }
  /** the elections as a row of events on a time axis: one mark for each, the name in its tooltip; only when two or more have a date */
  function eventRail(list) {
    const pts = list.map((r) => ({ r, t: dayTs(str(r.date)) })).filter((x) => x.t != null).sort((a, b) => a.t - b.t);
    if (pts.length < 2) return null;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t, W = 240, H = 26, X = (t) => 6 + ((t - t0) / Math.max(1, t1 - t0)) * (W - 12);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'rail', role: 'img', 'aria-label': `選挙 ${pts.length} 件の投票日の並び` });
    svg.append(s('line', { x1: 6, x2: W - 6, y1: 9, y2: 9, class: 'rl' }));
    for (const { r, t } of pts) svg.append(s('circle', { cx: X(t).toFixed(1), cy: 9, r: 3.5, class: 'rd' }, s('title', {}, document.createTextNode(`${md(r.date)} ${r.name}`))));
    svg.append(s('text', { x: 6, y: H - 2, class: 'ax' }, document.createTextNode(md(pts[0].r.date))), s('text', { x: W - 6, y: H - 2, class: 'ax end' }, document.createTextNode(md(pts[pts.length - 1].r.date))));
    return svg;
  }
  function paneElections(p, scene) {
    const v = electionsView(p);
    const out = [head('選挙', v.missing ? '—' : v.recent.length + v.upcoming.length)];
    if (v.missing) return [...out, empty('選挙のデータが無い')];
    if (!v.ok && !v.recent.length && !v.upcoming.length) return [...out, empty('取得できず'), elecSrc(v)];
    const li = (r) => h('li', { title: [KIND_JA[r.kind], str(r.winner_ja) || str(r.winner)].filter(Boolean).join('・') }, h('span', { class: 'po', text: md(r.date) }), link(r.url, r.name, 'pt'), h('span', { class: 'pa', text: kindOf(r) }));
    const rail = eventRail([...v.recent, ...v.upcoming]);
    if (rail) out.push(rail);
    if (v.upcoming.length) out.push(h('p', { class: 'pk', text: '今後の投票日' }), h('ul', { class: 'pol' }, v.upcoming.slice(0, 4).map(li)));
    if (v.recent.length) out.push(h('p', { class: 'pk', text: '直近の結果（投票日）' }), h('ul', { class: 'pol' }, v.recent.slice(0, scene === 'election' ? 6 : 3).map(li)));
    else out.push(empty(nothingJa(v) + (scene === 'election' ? '。場面は見出しの語で判定（海外の選挙を含む）' : '')));
    out.push(note(v.covers || '都道府県知事選挙と指定都市市長選挙のみ。国政選挙は含まない'), elecSrc(v));
    return out;
  }
  function panePolls(p) {
    const v = pollsView(p);
    const out = [head('内閣支持', v.missing ? '—' : `${v.series.length}社`)];
    if (v.missing) return [...out, empty('支持率のデータが無い')];
    if (!v.ok) return [...out, empty('取得できず')];
    const li = (x) => h('li', null, link(x.url, x.name, 'pn'), h('span', { class: 'pd', text: md(x.end) }), h('b', { class: 'pvv', text: pct(x.approve) }), h('b', { class: 'pvv', text: pct(x.disapprove) }));
    const top = h('li', { class: 'pvh', 'aria-hidden': 'true' }, h('span', { text: '各社の最新' }), h('span', { class: 'pd', text: '最終日' }), h('span', { class: 'pvv', text: '支持' }), h('span', { class: 'pvv', text: '不支持' }));
    return [...out, h('div', { class: 'pch' }, chart(v, 300, 96, false)), legend(), h('ul', { class: 'pv' }, top, v.latest.slice(0, 4).map(li)), pollSrc(v)];
  }
  function paneScrutiny(c) {
    const v = scrutinyView(c);
    const out = [head(SCR_TITLE, v.missing ? '—' : v.n)];
    if (v.missing) return [...out, empty('データが無い')];
    if (!v.featured.length) return [...out, empty(v.n ? '—' : '0 件')];
    const li = ({ ja, it }) => h('li', { title: [str(it.source), str(it.who), it.theme ? `検索語 ${it.theme}` : ''].filter(Boolean).join('\n') },
      h('span', { class: 'po', text: ja }), link(it.url, [str(it.title), str(it.who)].filter(Boolean).join('　'), 'pt'), h('span', { class: 'pa', text: md(it.date) }));
    return [...out, h('ul', { class: 'pol' }, v.featured.map(li)), note('種類ごとに1件。種類は源の性質の札で、内容の評価ではない')];
  }
  function pane(p, c, scene) {
    if (!p) return [empty('政治のデータを読めない')];
    const front = [...paneElections(p, scene), ...panePolls(p)], diet = paneDiet(p);
    const parts = scene === 'election' ? [...front, ...diet] : [...diet, ...front];
    return [...parts, ...paneScrutiny(c), h('p', { class: 'pfoot', text: str(p.order_rule) ? '並びは官邸が先、各党は名前の順。色・順位なし' : '' })];
  }

  // ---- the sheet
  function sheetElections(p, scene) {
    const v = electionsView(p);
    if (v.missing) return [sec('選挙', '—'), empty('選挙のデータが無い')];
    const extra = [['winner', '当選者'], ['votes', '得票']].filter(([k]) => v.recent.some((r) => r[k] != null || r[k + '_ja'] != null));
    const table = (rs) => tbl([['投票日'], ['選挙'], ['種類', 'opt'], ...extra.map(([, ja]) => [ja, ja === '得票' ? 'r' : ''])],
      rs.map((r) => h('tr', null, td(str(r.date), 'dim'), td(link(r.url, r.name), 'tt'), td(KIND_JA[r.kind] || str(r.kind), 'dim opt'),
        ...extra.map(([k]) => (k === 'votes' ? td(isNum(r.votes) ? fmtN(r.votes) : '—', 'r') : td(str(r.winner_ja) || str(r.winner) || '—'))))));
    const out = [sec('選挙', v.recent.length + v.upcoming.length), note(v.covers || '都道府県知事選挙と指定都市市長選挙のみ。国政選挙は含まない')];
    out.push(h('p', { class: 'pk', text: '今後の投票日' }), v.upcoming.length ? table(v.upcoming) : note(`${v.name}の頁に今後の投票日の予定表は無い。一覧に今日以降の日付がある時だけここに出る`));
    out.push(h('p', { class: 'pk', text: `直近の結果（${v.days || 60}日）` }), v.recent.length ? table(v.recent) : empty(nothingJa(v) + (scene === 'election' ? '。場面は見出しの語で判定（海外の選挙を含む）' : '')));
    if (!v.ok) out.push(empty('一覧の一部を取得できず'));
    return [...out, elecSrc(v)];
  }
  function sheetPolls(p) {
    const v = pollsView(p);
    if (v.missing) return [sec('内閣支持', '—'), empty('支持率のデータが無い')];
    if (!v.ok) return [sec('内閣支持', '—'), empty('取得できず')];
    return [sec('内閣支持', `${v.series.length}社`), chart(v, 560, 210, true), legend(),
      tbl([['会社'], ['調査日', 'opt'], ['支持', 'r'], ['不支持', 'r'], ['回答', 'r opt']], v.latest.map((x) => h('tr', null, td(link(x.url, x.name), 'tt'),
        td(x.start && x.start !== x.end ? `${md(x.start)}–${md(x.end)}` : md(x.end), 'dim opt'), td(pct(x.approve), 'r'), td(pct(x.disapprove), 'r'), td(isNum(x.sample) ? fmtN(x.sample) : '—', 'r dim opt')))),
      pollSrc(v), v.src.title ? note('頁 ', link(v.src.url, v.src.title)) : null, note('英語版 Wikipedia の表から各社の支持・不支持の数を抜き出した（版を固定した頁）。各社の原典は社名のリンク。見出しの数との照合はしていない')];
  }
  function sheetScrutiny(c) {
    const v = scrutinyView(c);
    if (v.missing || !v.n) return [sec(SCR_TITLE, v.missing ? '—' : 0), empty(v.missing ? 'データが無い' : '0 件')];
    const who = (it) => [str(it.who), it.theme ? `検索語 ${it.theme}` : ''].filter(Boolean).join('・');
    const out = [sec(SCR_TITLE, v.n), tbl([['種類'], ['出どころ', 'opt'], ['件名'], ['日付', 'r']], v.featured.map(({ ja, it }) => h('tr', null, td(ja, 'dim'), td(str(it.source), 'dim opt'),
      td([link(it.url, str(it.title)), who(it) ? h('span', { class: 'psub2', text: who(it) }) : null], 'tt'), td(md(it.date), 'r dim'))))];
    const cols = v.groups.map((g) => h('div', null, sec(g.ja, g.items.length), tbl([['出どころ'], ['件名'], ['日付', 'r']], g.items.slice(0, 10).map((it) => h('tr', null, td(str(it.source), 'dim'),
      td([link(it.url, str(it.title)), who(it) ? h('span', { class: 'psub2', text: who(it) }) : null], 'tt'), td(md(it.date), 'r dim'))))));
    return [h('div', null, ...out), h('div', { class: 'ds-cols' }, ...cols), note(v.note), v.credit.length ? note(`検索 ${v.credit.join(' · ')}`) : null, v.failed.length ? note(`取得できず ${v.failed.join(' · ')}`) : null];
  }
  function sheet(p, c, scene) {
    if (!p) return { big: '—', unit: '政治のデータを読めない', facts: [], body: [] };
    const lk = (r) => link(r.link, str(r.title));
    const list = (title, rs, who) => [sec(title, rs.length), rs.length ? tbl([['', 'opt'], ['件名'], ['', 'r']], rs.map((r) => h('tr', null, td(who(r), 'dim opt'), td(lk(r), 'tt'), td(fmtAge(r.ts), 'r dim')))) : empty('0 件')];
    const counts = isObj(p.bills) && isObj(p.bills.counts) ? p.bills.counts : {};
    const pending = ['shugiin', 'sangiin'].reduce((a, k) => a + Object.entries(isObj(counts[k]) ? counts[k] : {}).filter(([n]) => /審議中|審査中/.test(n)).reduce((x, [, val]) => x + (isNum(val) ? val : 0), 0), 0);
    const recent = [...arr(p.bills && p.bills.recent && p.bills.recent.shugiin), ...arr(p.bills && p.bills.recent && p.bills.recent.sangiin)].filter(isObj).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const parties = arr(p.parties).filter(isObj);
    const k = isObj(p.kokkai) ? arr(p.kokkai.meetings).filter(isObj) : [];
    const st = p.session && isObj(p.session.state) ? p.session.state : null;
    const left = [...list('議案', recent, (r) => str(r.status)), ...list('官邸', arr(p.office).filter(isObj), (r) => str(r.outlet)), ...list('官報', arr(p.gazette).filter(isObj), (r) => fmtShort(r.ts)), ...list('会計検査院', arr(p.audit).filter(isObj), (r) => fmtShort(r.ts))];
    const right = [sec('各党の発信', parties.length), tbl([['党'], ['件名'], ['', 'r']], parties.flatMap((x) => arr(x.items).filter(isObj).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 3).map((r, i) => h('tr', null, td(i ? '' : str(x.outlet), 'dim'), td(lk(r), 'tt'), td(fmtAge(r.ts), 'r dim'))))),
      sec('会議録', k.length), k.length ? tbl([['日付'], ['会議'], ['号', 'r']], k.map((m) => h('tr', null, td(str(m.date), 'dim'), td(link(m.url, `${str(m.house)} ${str(m.meeting)}`), 'tt'), td(str(m.issue), 'r dim')))) : empty('0 件')];
    const ev = electionsView(p), pv = pollsView(p), el = scene === 'election';
    const diet = h('div', { class: 'ds-cols' }, h('div', null, left), h('div', null, right));
    const front = h('div', { class: 'ds-cols' }, h('div', null, sheetElections(p, scene)), h('div', null, sheetPolls(p)));
    const facts = [['会期', st ? str(st.text) || '—' : '—'], ['選挙', ev.missing ? '—' : fmtN(ev.recent.length + ev.upcoming.length)], ['内閣支持', pv.ok ? `${pv.series.length}社` : '—'],
      ['官邸', fmtN(arr(p.office).length)], ['各党', fmtN(parties.length)], ['会議', fmtN(k.length)], ['取得', fmtShort(p.generated_at)]];
    return {
      big: el && !ev.missing ? fmtN(ev.recent.length + ev.upcoming.length) : fmtN(pending),
      unit: el && !ev.missing ? `知事・指定都市市長の選挙（直近${ev.days || 60}日・${ev.name}）` : '審議中の議案（衆・参）',
      facts, body: [...(el ? [front, diet] : [diet, front]), ...sheetScrutiny(c)], foot: '並びは官邸が先、各党は名前の順。色・順位なし',
    };
  }
  return { pane, sheet };
}
