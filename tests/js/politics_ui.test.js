import test from 'node:test';
import assert from 'node:assert/strict';
import { electionsView, pollsView, scrutinyView, md } from '../../js/politics_ui.js';

const pol = {
  elections: {
    status: 'ok', window_days: 60,
    source: { name: '総務省', covers_ja: '都道府県知事選挙と指定都市市長選挙の結果の一覧。国政選挙は含まない', pages: [{ kind: 'governor', label_ja: '都道府県知事選挙', url: 'https://www.soumu.go.jp/a.html', ok: true }, { kind: 'x', url: '' }] },
    upcoming: [],
    recent: [{ date: '2026-10-18', name: '横浜市市長選挙', kind: 'mayor_designated', url: 'https://www.soumu.go.jp/b.pdf' }, { date: '2026-10-25', name: '福島県知事選挙', kind: 'governor', url: 'https://www.soumu.go.jp/c.pdf' }, { date: 'bad', name: '?' }, { date: '2026-10-25' }],
  },
  polls: {
    status: 'ok',
    source: { name: 'Wikipedia (English)', revid: 123, url: 'https://en.wikipedia.org/w/index.php?oldid=123', license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    series: [
      { pollster: 'A', pollster_ja: '甲', points: [{ end: '2026-10-01', approve: 50, disapprove: 30 }, { end: '2026-09-01', approve: 55, disapprove: 28 }, { end: 'x', approve: 1 }, { end: '2026-08-01' }] },
      { pollster: 'B', points: [{ end: '2026-10-12', approve: 40.5, disapprove: 35.2, sample: 1000, cite_url: 'https://b.example/1' }] },
      { pollster: 'C', points: [] },
    ],
  },
};

test('elections: well-formed rows only, newest first, the source pages with a URL', () => {
  const v = electionsView(pol);
  assert.equal(v.missing, false);
  assert.equal(v.ok, true);
  assert.deepEqual(v.recent.map((r) => r.name), ['福島県知事選挙', '横浜市市長選挙']);
  assert.equal(v.days, 60);
  assert.equal(v.pages.length, 1);
  assert.equal(v.name, '総務省');
});

test('elections absent: said, not invented', () => {
  const v = electionsView({});
  assert.equal(v.missing, true);
  assert.deepEqual(v.recent, []);
});

test('polls: one point per poll on its last day, series in time order, the latest of each pollster newest first; no average is made', () => {
  const v = pollsView(pol);
  assert.equal(v.series.length, 2);
  assert.deepEqual(v.series[0].pts.map((o) => o.end), ['2026-09-01', '2026-10-01']);
  assert.deepEqual(v.latest.map((x) => [x.name, x.approve, x.disapprove]), [['B', 40.5, 35.2], ['甲', 50, 30]]);
  assert.equal(v.src.revid, '123');
  assert.equal(v.src.license, 'CC BY-SA 4.0');
  for (const x of v.latest) assert.ok(!('mean' in x) && !('trend' in x));
});

test('polls absent', () => assert.equal(pollsView({}).missing, true));

test('scrutiny: one of each kind from featured, then all by kind', () => {
  const c = { schema: 'parallax-critical/1', status: 'ok', kinds: { investigative: { ja: '調査報道' }, primary: { ja: '一次資料' } },
    featured: { investigative: 'a', diet_question: 'q', diet_answer: 'zz' },
    items: [{ id: 'a', kind: 'investigative', title: 'T1', date: '2026-11-01' }, { id: 'b', kind: 'investigative', title: 'T2', date: '2026-11-03' }, { id: 'q', kind: 'primary', title: '衆議院 予算委員会', date: '2026-07-27', who: 'X' }],
    sources: [{ name: 'S1', ok: true }, { name: 'S2', ok: false }], credit: { k: '国会会議録検索システム' } };
  const v = scrutinyView(c);
  assert.deepEqual(v.featured.map((x) => x.ja), ['調査報道', '国会 質問']);
  assert.deepEqual(v.groups.map((g) => [g.ja, g.items.map((x) => x.id)]), [['調査報道', ['b', 'a']], ['一次資料', ['q']]]);
  assert.deepEqual(v.failed, ['S2']);
  assert.equal(scrutinyView(null).missing, true);
  assert.equal(scrutinyView({ schema: 'other' }).ok, false);
});

test('md: month/day without zeros', () => {
  assert.equal(md('2026-10-05'), '10/5');
  assert.equal(md(''), '—');
});
