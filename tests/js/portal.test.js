import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VIEWS, viewOfSect, pageOf, cardsOf, landing, rememberView, lastView } from '../../js/portal.js';
import { parseCsv, sampleBars, edgeOf, signalsOf, newsMoves, age, wilson, rsi, MIN_SCENES, LIMITS } from '../../js/stocks.js';
import { SECTIONS } from '../../js/sections.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test('three views; every page is a screen the site has, and no screen is lost', () => {
  assert.deepEqual(VIEWS.map((v) => v.ja), ['ニュース比較', '地域', '市場']);
  const sects = new Set(SECTIONS.map((x) => x.id));
  const held = new Set(VIEWS.flatMap((v) => v.pages.map((p) => p.sect)));
  for (const s of held) assert.ok(sects.has(s), s);
  for (const s of ['home', 'news', 'map', 'market', 'politics', 'disaster', 'video', 'stocks']) assert.ok(held.has(s), `${s} is in a view`);
  assert.equal(viewOfSect('stocks'), 'market'); assert.equal(viewOfSect('disaster'), 'place'); assert.equal(viewOfSect('portal'), 'portal'); assert.equal(viewOfSect('saved'), null);
  assert.equal(pageOf('home', 'board'), 'board'); assert.equal(pageOf('home', 'simple'), 'simple'); assert.equal(pageOf('map', 'home'), 'map');
});

test('the entrance counts what the site holds and says nothing else', () => {
  const c = cardsOf({ events: 120, quakes: 7, series: 9 });
  assert.deepEqual(c.map((x) => x.figure && x.figure.n), [120, 7, 9]);
  assert.equal(cardsOf({}).every((x) => x.figure === null), true);
  assert.equal(cardsOf({ events: NaN })[0].figure, null);
});

test('a new visitor starts at the entrance; one who has chosen a view goes there; the booth and an asked event do not', () => {
  const st = mem();
  assert.equal(landing({ hash: '', search: '', storage: st }), 'portal');
  assert.equal(landing({ hash: '#market', search: '', storage: st }), null);
  assert.equal(landing({ hash: '', search: '?sid=sabc', storage: st }), null);
  assert.equal(landing({ hash: '', search: '', storage: st, demo: true }), null);
  assert.equal(rememberView(st, 'market'), true); assert.equal(lastView(st), 'market');
  assert.equal(landing({ hash: '', search: '', storage: st }), null);
  assert.equal(landing({ hash: '', search: '?portal=1', storage: st }), 'portal');
  assert.equal(landing({ hash: '', search: '?portal=0', storage: mem() }), null);
  assert.equal(rememberView(st, 'nonsense'), false);
  assert.equal(landing({ hash: '', search: '', storage: { getItem() { throw new Error('blocked'); } } }), 'portal');
});

test('csv: a header, a two-column file, an OHLC file, a duplicate and a bad row', () => {
  const rows = Array.from({ length: 40 }, (_, i) => `2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, '0')},${100 + i}`);
  const r = parseCsv(['date,close', ...rows, rows[3], 'x,y'].join('\n'));
  assert.equal(r.bars.length, 40); assert.equal(r.rejected, 2); assert.equal(r.error, '');
  const o = parseCsv(rows.map((x, i) => `${x.split(',')[0]},1,2,3,${50 + i},999`).join('\n'));
  assert.equal(o.bars[0].c, 50);
  assert.ok(parseCsv('a,b\n1,2').error);
});

test('the signals are counted on the closes before the day only; the base and the scenes are independent counts', () => {
  const b = sampleBars(7, 2500), e = edgeOf(b);
  assert.equal(e.rows.length, 3); assert.ok(e.base.days > 2000);
  for (const r of e.rows) { assert.ok(r.scenes <= r.days); if (r.scenes >= MIN_SCENES) { assert.ok(r.ci[0] <= r.up && r.up <= r.ci[1]); assert.ok(['above', 'below', 'same'].includes(r.grade)); } else assert.equal(r.grade, 'few'); }
  // no peeking: the same signals computed on the series cut at day i give the flag of day i
  const cut = b.slice(0, 1500), full = signalsOf(b.slice(0, 1500));
  assert.deepEqual(signalsOf(cut).map((x) => x.on), full.map((x) => x.on));
  assert.deepEqual(edgeOf(b.slice(0, 50)).rows, []);
});

test('rsi is 100 on a straight rise and under 30 after a long fall; wilson holds the share', () => {
  assert.equal(rsi(Array.from({ length: 30 }, (_, i) => i + 1)).at(-1), 100);
  assert.ok(rsi(Array.from({ length: 30 }, (_, i) => 100 - i)).at(-1) < 30);
  const [lo, hi] = wilson(7, 10); assert.ok(lo < 0.7 && hi > 0.7); assert.equal(wilson(0, 0), null);
});

test('news moves: the close of the report day against the close before; no word, no row; a weekend report takes the next trading day', () => {
  const bars = [{ d: '2026-11-16', c: 100 }, { d: '2026-11-17', c: 102 }, { d: '2026-11-18', c: 99 }, { d: '2026-11-19', c: 99 }, { d: '2026-11-20', c: 100 }, { d: '2026-11-23', c: 101 }];
  const t = (d) => Date.parse(d + 'T03:00:00Z') / 1000;
  const r = newsMoves(bars, [{ ts: t('2026-11-18'), title: '日銀が会合', n: 4, key: 'a' }, { ts: t('2026-11-21'), title: '日銀の発言', n: 2, key: 'b' }, { ts: t('2026-11-18'), title: '別の話', n: 1, key: 'c' }], ['日銀']);
  assert.equal(r.n, 2);
  const a = r.rows.find((x) => x.key === 'a'), w = r.rows.find((x) => x.key === 'b');
  assert.ok(Math.abs(a.d1 - (99 - 102) / 102 * 100) < 1e-9); assert.equal(w.day, '2026-11-23');
  assert.equal(newsMoves(bars, [{ ts: t('2026-11-18'), title: 'x' }], []).n, 0);
});

test('a last close that is old is marked old; the limits are always written', () => {
  const b = [{ d: '2026-11-10', c: 1 }];
  assert.equal(age(b, Date.parse('2026-11-22T00:00:00Z') / 1000).stale, true);
  assert.equal(age([{ d: '2026-11-20', c: 1 }], Date.parse('2026-11-22T00:00:00Z') / 1000).stale, false);
  assert.ok(LIMITS.some((x) => x.includes('生存者バイアス')) && LIMITS.some((x) => x.includes('推奨でも')));
});

test('the page: the band and the entrance are wired, the stock page holds no price of its own, no advice, up green and down red with a sign', () => {
  const app = readFileSync('js/app.js', 'utf8'), css = readFileSync('css/app.css', 'utf8'), ui = readFileSync('js/stocks_ui.js', 'utf8'), sw = readFileSync('sw.js', 'utf8');
  assert.match(app, /mountViews\(\);/); assert.match(app, /setSect\('portal'\)/); assert.match(app, /createStocks\(/);
  for (const f of ['portal.js', 'portal_ui.js', 'stocks.js', 'stocks_ui.js']) assert.ok(sw.includes(`'js/${f}'`), f);
  assert.match(sw, /parallax-v90/);
  assert.match(css, /--up: #30d158/); assert.match(css, /\.sk-mv\.dn \{ color: var\(--dn\)/); assert.match(ui, /'▲'/); assert.match(ui, /'▼'/);
  assert.doesNotMatch(ui, /fetch\(|XMLHttpRequest|localStorage|sendBeacon/, 'the visitor\'s file stays in the page');
  assert.doesNotMatch(ui + readFileSync('js/stocks.js', 'utf8'), /買い時|買うべき|売るべき|おすすめ/);
});

test('the sample never ties a made-up price to a real headline: its own made-up rows, each tagged 架空; a loaded file ties to the real ones', () => {
  const ui = readFileSync('js/stocks_ui.js', 'utf8');
  assert.match(ui, /newsMoves\(bars, st\.sample \? SAMPLE_ITEMS : items\(\)/);
  assert.match(ui, /st\.sample \? h\('span', \{ class: 'sk-tag', text: '架空' \}\)/);
  const m = /const SAMPLE_ITEMS = ([\s\S]*?)\.map\(/.exec(ui)[1];
  assert.ok(/見本の出来事/.test(m) && !/トランプ|プーチン|日銀/.test(m));
  const b = sampleBars(7, 2500), items = [...m.matchAll(/'(\d{4}-\d\d-\d\d)', '([^']+)'/g)].map((x, i) => ({ ts: Date.parse(x[1] + 'T03:00:00Z') / 1000, title: x[2], n: 0, key: `s${i}` }));
  assert.equal(newsMoves(b, items, ['見本']).n, 4, 'the made-up rows land on the sample bars');
});
