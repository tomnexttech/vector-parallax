import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, NEWS_TABS, parseHash, hashOf, paperOf, nextSeen, shareUrl, ruleJa, PAPER_ORDER } from '../../js/sections.js';
import { norm, scoreOf, rank } from '../../js/palette.js';

test('the eight screens, home first', () => {
  assert.deepEqual(SECTIONS.map((x) => x.ja), ['ホーム', 'ニュース', '地図', '市場', '政治', '災害', '映像', '保存']);
});

test('a hash opens a screen; the older hashes keep their own meaning', () => {
  assert.deepEqual(parseHash(''), { sect: 'home', tab: '' });
  assert.deepEqual(parseHash('#market'), { sect: 'market', tab: '' });
  assert.deepEqual(parseHash('#news/paper'), { sect: 'news', tab: 'paper' });
  assert.deepEqual(parseHash('#news/nothing'), { sect: 'news', tab: '' });
  assert.equal(parseHash('#ai'), null);
  assert.equal(parseHash('#rules'), null);
  assert.equal(parseHash('#p-case'), null);
  for (const [id] of NEWS_TABS) assert.equal(parseHash(hashOf('news', id)).tab, id === 'now' ? '' : id);
  assert.equal(hashOf('map', 'paper'), '#map');
  assert.equal(hashOf('nothing'), '#home');
});

test('the paper: the order of the columns, one headline of an event to a column, an empty column left out', () => {
  const m = (type, title, ts) => ({ type, title, ts, outlet: type });
  const es = [{ key: 'a', members: [m('全国紙', 'A 遅い', 20), m('全国紙', 'A 早い', 10), m('通信社', 'A 通信', 12)] }, { key: 'b', members: [m('政府一次', 'B 資料', 5), m('全国紙', 'B 紙', 6)] }, { key: 'c', members: [m('専門', 'C 専門', 1)] }];
  const p = paperOf(es);
  assert.deepEqual(p.map((x) => x.type), ['政府一次', '全国紙', '通信社']);
  assert.deepEqual(PAPER_ORDER.slice(0, 2), ['政府一次', '全国紙']);
  assert.equal(p[0].label, '官公庁の資料');
  assert.deepEqual(p[1].rows.map((r) => r.it.title), ['A 早い', 'B 紙']);
  assert.equal(paperOf(es, { cap: 1 })[1].rows.length, 1);
  assert.equal(paperOf(es, { cap: 1 })[1].n, 2);
  assert.deepEqual(paperOf(null), []);
});

test('what is new since the last look; a reload of the same data keeps the answer', () => {
  const first = nextSeen(null, 100, ['a', 'b'], 1000);
  assert.deepEqual([first.prev, first.since, first.fresh], [null, null, []]);
  const later = nextSeen(first.save, 200, ['a', 'b', 'c', 'c'], 2000);
  assert.deepEqual(later.fresh, ['c']);
  assert.equal(later.since, 1000);
  const reload = nextSeen(later.save, 200, ['a', 'b', 'c'], 3000);
  assert.deepEqual(reload.fresh, ['c']);
  assert.equal(reload.since, 1000);
  const old = nextSeen({ gen: 1, keys: ['a'] }, 2, ['a', 'b'], 9);   // the earlier form of the record has no time
  assert.deepEqual([old.fresh, old.since], [['b'], null]);
});

test('one event has an address; a local copy keeps its data', () => {
  assert.equal(shareUrl({ href: 'https://x.test/p/index.html?tour=0#news' }, { sid: 's0123456789' }), 'https://x.test/p/index.html?sid=s0123456789');
  assert.equal(shareUrl({ href: 'http://127.0.0.1/index.html?data=work/l.json' }, { sid: 's0123456789' }), 'http://127.0.0.1/index.html?data=work%2Fl.json&sid=s0123456789');
  assert.match(shareUrl({ href: 'https://x.test/' }, { sid: 'ai-1', title: '見出し' }), /\?t=/);
});

test('the rule of a label is said in Japanese, and never that an outlet left something out', () => {
  for (const k of ['primary_only', 'periphery_only', 'overseas_only', 'mainstream_only']) {
    assert.match(ruleJa(k, 'x'), /付きます/);
    assert.doesNotMatch(ruleJa(k, 'x'), /報じなかった|無視|黙殺/);
  }
  assert.equal(ruleJa('other', 'published'), 'published');
});

test('the one field: folded forms, the label over the words behind it, the first items with no words', () => {
  assert.equal(norm('ニュース Ｎｅｗｓ'), 'にゅーすnews');
  assert.ok(scoreOf({ label: '地図' }, '地図') > scoreOf({ label: '地図を広げる' }, '地図'));
  assert.ok(scoreOf({ label: 'x 地図' }, '地図') > scoreOf({ label: 'x', hay: '地図' }, '地図'));
  assert.equal(scoreOf({ label: 'x' }, '地図'), 0);
  const items = [{ label: 'あとの地図', first: false }, { label: '地図', first: true }, { label: '市場', first: true }];
  assert.deepEqual(rank(items, '地図').map((x) => x.label), ['地図', 'あとの地図']);
  assert.deepEqual(rank(items, '').map((x) => x.label), ['地図', '市場']);
  assert.deepEqual(rank(items, 'ちず'), []);
});
