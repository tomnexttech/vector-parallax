import test from 'node:test';
import assert from 'node:assert/strict';
import { focusOf, prefOf, scopeOf, scopeLabel, mentions, scopeMatch, trendOf, busiestPlaces, dailyOf, socialOf, TREND_SOURCES } from '../../js/trend.js';
import { placesIn } from '../../js/places.js';

const G = 1_000_000;
const it = (id, outlet, ts, o = {}) => ({ id, outlet, ts, type: '全国紙', home: 'jp', title: o.title || 't' + id, ...o });
const ev = (key, field, members, o = {}) => ({ key, field, n: new Set(members.map((m) => m.outlet)).size, last: Math.max(...members.map((m) => m.ts)), first: Math.min(...members.map((m) => m.ts)),
  heading: { text: o.title || key }, titled: members, members, geo: o.geo || null, ...o });

test('東京都 is Tokyo, not Kyoto, and a prefecture is told with or without its suffix', () => {
  assert.equal(prefOf('東京都'), '東京'); assert.equal(prefOf('京都府'), '京都'); assert.equal(prefOf('北海道'), '北海道'); assert.equal(prefOf('渋谷区'), null);
  assert.equal(mentions('東京都内で火災', '京都'), false); assert.equal(mentions('京都市で祭り', '京都'), true);
  assert.deepEqual(placesIn('東京都内で火災'), ['東京']);   // places.js too (11-22)
  assert.equal(scopeLabel(scopeOf('東京')), '東京都'); assert.equal(scopeLabel(scopeOf('大阪')), '大阪府'); assert.equal(scopeLabel(scopeOf('渋谷区')), '渋谷区');
});

test('a scope finds events by their place, or by a headline that names it', () => {
  const a = ev('a', '経済', [it('1', 'A', G)], { title: '渋谷区で再開発', geo: { key: '東京', name: '東京', lat: 35.7, lon: 139.7 } });
  const b = ev('b', '国際', [it('2', 'B', G)], { title: '米国の動き', geo: { key: 'US', name: 'アメリカ', country: true, lat: 39, lon: -98 } });
  assert.equal(scopeMatch(scopeOf('渋谷区'))(a), true); assert.equal(scopeMatch(scopeOf('渋谷区'))(b), false);
  assert.equal(scopeMatch(scopeOf('東京'))(a), true);
  const box = { kind: 'box', west: 139, east: 140, south: 35, north: 36 };
  assert.equal(scopeMatch(box)(a), true);
  assert.equal(scopeMatch(box)(b), false);
});

test('trendOf: the recent third against the rest, rising needs 3 headlines, shares beside the whole, outlets by share of their own output', () => {
  const R = 12 * 3600;
  const hot = ev('hot', '経済', [it('h1', 'A', G - 100), it('h2', 'B', G - 200), it('h3', 'C', G - 300), it('h4', 'A', G - R - 5000)], { title: '再開発の話', geo: { key: '東京', name: '東京' } });
  const calm = ev('calm', '国内政治', [it('c1', 'A', G - R - 100), it('c2', 'B', G - R - 200), it('c3', 'C', G - R - 300)], { title: '東京の予算', geo: { key: '東京', name: '東京' } });
  const far = ev('far', '国際', [it('f1', 'A', G - 50), it('f2', 'D', G - 60)], { title: '海外の話' });
  const m = trendOf([hot, calm, far], scopeOf('東京'), { now: G, windowH: 36 });
  assert.equal(m.events, 2); assert.equal(m.heads, 7); assert.equal(m.wholeEvents, 3);
  assert.deepEqual(m.rising.map((x) => x.e.key), ['hot']);
  assert.equal(m.rising[0].recent, 3); assert.equal(m.rising[0].prior, 1);
  assert.equal(m.top[0].e.key, 'hot');
  assert.equal(m.pace.recent, 3); assert.equal(m.pace.prior, 4);
  const f = m.fields.find((x) => x.field === '経済'); assert.equal(f.share, 0.5); assert.ok(Math.abs(f.whole - 1 / 3) < 1e-9);
  const a = m.outletRows.find((x) => x.name === 'A'); assert.equal(a.n, 3); assert.equal(a.own, 4); assert.equal(a.share, 0.75);
  assert.deepEqual(m.sources, TREND_SOURCES);
});

test('nothing chosen or nothing found gives an empty model, not a made-up one', () => {
  assert.equal(trendOf([], null, { now: G }).events, 0);
  assert.equal(trendOf([ev('x', '経済', [it('1', 'A', G)])], scopeOf('存在しない町'), { now: G }).events, 0);
});

test('busiestPlaces counts events once per prefecture', () => {
  const es = [ev('1', '経済', [it('1', 'A', G)], { geo: { key: '沖縄', name: '沖縄' } }), ev('2', '経済', [it('2', 'A', G)], { title: '沖縄の話' }), ev('3', '経済', [it('3', 'A', G)], { title: '東京都の話' })];
  assert.deepEqual(busiestPlaces(es, 2).map((x) => [x.name, x.n]), [['沖縄', 2], ['東京', 1]]);
});

test('dailyOf counts the archive days that name the place', () => {
  const day = (date, titles) => ({ schema: 'parallax-archive-day/1', date, events: titles.map((t, i) => ({ sid: 's' + i, title: t, n_outlets: 2 })) });
  assert.deepEqual(dailyOf([day('2026-11-02', ['沖縄で雨', '東京で']), day('2026-11-01', ['沖縄の祭り'])], scopeOf('沖縄')).map((d) => [d.date, d.events]), [['2026-11-01', 1], ['2026-11-02', 1]]);
});

test('socialOf says why there is no row, and never invents numbers', () => {
  const doc = { schema: 'parallax-social/1', generated_at: G, recent_h: 12, prior_h: 24, bias_ja: 'b', tone_ja: 't', places: {
    沖縄: { ok: true, recent: { n: 240, capped: false, sample: 236, authors: 149 }, prior: { n: 480, capped: false }, terms: [{ term: '首里城', recent: 40, prior: 5, authors: 17 }], tone: { n: 236, pos: 34, neg: 41, none: 161 }, precision: 1 },
    東京: { ok: false, err: 'HTTPError' } } };
  assert.equal(socialOf(null, scopeOf('沖縄')).state, 'none');
  assert.equal(socialOf(doc, scopeOf('渋谷区')).state, 'off');
  assert.equal(socialOf(doc, { kind: 'box' }).state, 'off');
  assert.equal(socialOf(doc, scopeOf('東京')).state, 'failed');
  const r = socialOf(doc, scopeOf('沖縄'));
  assert.equal(r.state, 'row'); assert.equal(r.recent, 240); assert.equal(r.pace, 1);   // 20 an hour against 20 an hour
  assert.equal(socialOf({ ...doc, places: { 沖縄: { ...doc.places.沖縄, prior: { n: 0 } } } }, scopeOf('沖縄')).pace, null);
});

test('focusOf: a prefecture and a country by their point, a town by the events that stand there, a press where it was, the shown range nowhere', () => {
  const a = ev('a', '経済', [it('1', 'A', G)], { title: '渋谷区で再開発', geo: { key: '渋谷', name: '渋谷', lat: 35.66, lon: 139.7 } });
  const b = ev('b', '経済', [it('2', 'A', G)], { title: '渋谷区の話', geo: { key: '東京', name: '東京', lat: 35.69, lon: 139.69 } });
  const c = ev('c', '経済', [it('3', 'A', G)], { title: '渋谷区の祭り', geo: { key: '渋谷', name: '渋谷', lat: 35.66, lon: 139.7 } });
  assert.deepEqual(focusOf([], scopeOf('沖縄')), { lat: 26.21, lon: 127.68, z: 7.2 });
  assert.equal(focusOf([], scopeOf('北海道')).z, 5.8);
  assert.deepEqual(focusOf([], scopeOf('ロシア')), { lat: 55.8, lon: 37.6, z: 3.8 });
  assert.deepEqual(focusOf([a, b, c], scopeOf('渋谷区')), { lat: 35.66, lon: 139.7, z: 8 });   // the town of most events; its name is not exactly the typed word
  assert.equal(focusOf([a, b, c], scopeOf('渋谷')).z, 9.5);
  assert.deepEqual(focusOf([], { kind: 'point', lat: 1, lon: 2 }), { lat: 1, lon: 2, z: 9.5 });
  assert.equal(focusOf([a], { kind: 'box', west: 0, east: 1, south: 0, north: 1 }), null);
  assert.equal(focusOf([a], scopeOf('存在しない町')), null);
});
