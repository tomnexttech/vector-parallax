import test from 'node:test';
import assert from 'node:assert/strict';
import { STORY, sideOf, timeline, sourcesOf, GAP_S } from '../../js/story.js';

const G = 1_000_000;
const ms = [
  { outlet: 'Reuters', home: 'intl', type: '海外通信', ts: G + 600, title: 'b' },
  { outlet: 'NHK', type: '公共放送', ts: G, title: 'a' },
  { outlet: '外務省', type: '政府一次', ts: G + 900 + GAP_S, title: 'c' },
  { outlet: 'Google ニュース', media: '読売新聞', type: '全国紙', title: 'untimed' },
  { outlet: 'NHK', type: '公共放送', ts: G + 900, title: 'd' },
  null,
];

test('the sections come in the order of a story', () => {
  assert.deepEqual(STORY.map((x) => x[1]), ['要点', '経過', '各側の見出し', '出典の一覧']);
});

test('the side of a report: the ministries by type, abroad by home, else Japan', () => {
  assert.equal(sideOf(ms[0]), 'intl');
  assert.equal(sideOf(ms[1]), 'jp');
  assert.equal(sideOf(ms[2]), 'gov');
  assert.equal(sideOf(null), 'jp');
});

test('the timeline: in time order, the untimed last; the offset from the first; a long pause marked', () => {
  const t = timeline(ms);
  assert.deepEqual(t.map((r) => r.it.title), ['a', 'b', 'd', 'c', 'untimed']);
  assert.deepEqual(t.map((r) => r.off), [0, 600, 900, 900 + GAP_S, null]);
  assert.deepEqual(t.map((r) => r.gap), [false, false, false, true, false]);
  assert.deepEqual(t.map((r) => r.side), ['jp', 'intl', 'jp', 'gov', 'jp']);
  assert.deepEqual(timeline(null), []);
});

test('the sources: each outlet once, in the order of its first report, with its count', () => {
  const s = sourcesOf(ms);
  assert.deepEqual(s.map((x) => [x.name, x.n]), [['NHK', 2], ['Reuters', 1], ['外務省', 1], ['読売新聞', 1]]);
  assert.equal(s[0].first.title, 'a');
  assert.equal(s[2].side, 'gov');
});
