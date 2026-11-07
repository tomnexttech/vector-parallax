import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { absentOutlets, groupByType, CAVEAT, MAJOR_TYPES, outletProfile } from '../../js/absent.js';

const G = 1_000_000;
const feed = (outlet, type, o = {}) => ({ id: outlet, outlet, type, home: 'jp', ok: true, oldest_ts: G - 50_000, fetched_at: G - 100, ...o });
const ev = { first: G - 10_000, members: [{ outlet: 'NHK', type: '公共放送', ts: G - 10_000 }, { outlet: 'Google ニュース', media: '読売新聞', type: '全国紙', ts: G - 9_000 }] };

test('an outlet is not seen only when every ok feed reaches back to the first report and none of the reports is from it', () => {
  const r = absentOutlets(ev, [feed('NHK', '公共放送'), feed('読売新聞', '全国紙'), feed('朝日新聞', '全国紙'), feed('共同通信', '通信社')], G);
  assert.deepEqual(r.absent.map((x) => x.outlet), ['共同通信', '朝日新聞']);   // the type order, then the name
  assert.equal(r.total, 4); assert.equal(r.reach, 4); assert.equal(r.unknown.length, 0);
});

test('a feed that starts after the first report, failed, or is older than 6 hours cannot be judged', () => {
  const r = absentOutlets(ev, [feed('A紙', '全国紙', { oldest_ts: G - 5_000 }), feed('B紙', '全国紙', { ok: false }), feed('C紙', '全国紙', { fetched_at: G - 7 * 3600 }),
    feed('D紙', '全国紙'), feed('D紙', '全国紙', { oldest_ts: G - 1_000 })], G);
  assert.deepEqual(r.absent, []);
  assert.deepEqual(r.unknown.map((u) => [u.outlet, u.why]), [['A紙', 'late'], ['B紙', 'failed'], ['C紙', 'stale'], ['D紙', 'late']]);
  assert.equal(r.reach, 1);
});

test('one failed feed beside an ok feed that reaches: the outlet is judged by its ok feeds', () => {
  const r = absentOutlets(ev, [feed('E紙', '地方紙'), feed('E紙', '地方紙', { ok: false })], G);
  assert.deepEqual(r.absent.map((x) => x.outlet), ['E紙']);
});

test('groups keep the type order; the major types are the ones named', () => {
  const r = absentOutlets(ev, [feed('X', '専門'), feed('Y', '政府一次'), feed('Z', '海外主流')], G);
  assert.deepEqual(groupByType(r.absent).map((g) => g.type), ['政府一次', '専門', '海外主流']);
  assert.ok(MAJOR_TYPES.includes('海外主流') && !MAJOR_TYPES.includes('専門'));
});

test('no event, no sources: zeros, never a throw', () => {
  assert.deepEqual(absentOutlets(null, null, null), { total: 0, reach: 0, first: null, absent: [], unknown: [] });
});

test('the caveat avoids every silence word of the prompt', () => {
  const p = JSON.parse(fs.readFileSync(new URL('../../data/prompt.json', import.meta.url), 'utf8'));
  for (const w of [...p.silence_words.ja, ...p.silence_words.en]) assert.ok(!CAVEAT.includes(w), w);
  assert.ok(!/報じ|報道し/.test(CAVEAT));
});

test('one outlet, measured: the news it carried, how often its headline came first among two outlets or more, the median lag, the fields', () => {
  const m = (outlet, ts) => ({ outlet, ts });
  const es = [
    { key: 'a', field: '経済', members: [m('A', 100), m('B', 160)] },
    { key: 'b', field: '経済', members: [m('B', 50), m('A', 350), m('A', 90)] },
    { key: 'c', field: '国際', members: [m('A', 10)] },
    { key: 'd', field: '', members: [m('C', 5), m('A', 905)] },
    { key: 'e', field: '国際', members: [m('B', 1)] },
  ];
  const p = outletProfile(es, 'A', { outletOf: (it) => it.outlet });
  assert.equal(p.n, 4); assert.equal(p.multi, 3); assert.equal(p.first, 1);
  assert.equal(p.lagMed, 40);   // lags 0, 40, 900
  assert.deepEqual(p.fields, [['経済', 2], ['その他', 1], ['国際', 1]]);
  assert.deepEqual(p.rows.map((r) => r.e.key), ['d', 'a', 'b', 'c']);
  assert.deepEqual(outletProfile(es, 'Z'), { n: 0, multi: 0, first: 0, lagMed: null, fields: [], rows: [] });
  assert.equal(outletProfile(null, 'A').n, 0);
});
