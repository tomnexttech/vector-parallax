import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, headlineWords, compareWords, sideLines, paperPick } from '../../js/dossier.js';

const T = 1_790_000_000;
const it = (title, home, type, ts, outlet = 'A', id = title) => ({ id, title, home, type, ts, outlet });
const ev = (...members) => ({ members });

test('measure: Japan, abroad and the ministries are the three sides of the simple view, kinds of media most first', () => {
  const m = measure(ev(it('原油高と関税', 'jp', '全国紙', T + 3600), it('株価と関税', 'jp', '全国紙', T + 7200), it('Oil prices fall', 'intl', '海外主流', T), it('関税の資料', 'jp', '政府一次', T + 60)));
  assert.equal(m.n, 4); assert.equal(m.jp.length, 2); assert.equal(m.intl.length, 1); assert.equal(m.gov.length, 1);
  assert.deepEqual(m.types.map((t) => [t.type, t.n]), [['全国紙', 2], ['海外主流', 1], ['政府一次', 1]]);
  assert.equal(m.first.title, 'Oil prices fall');
  assert.equal(m.lag, 3600);   // Japan's first came an hour after abroad's
});

test('measure: a side with no report has no lag and no first, and a report without a time is counted but is never a first report', () => {
  const m = measure(ev(it('関税', 'jp', '全国紙', null), it('株価', 'jp', '全国紙', T)));
  assert.equal(m.n, 2); assert.equal(m.lag, null); assert.equal(m.firstOf.intl, null);
  assert.equal(m.firstOf.jp.title, '株価');
  const none = measure(ev(it('関税', 'jp', '全国紙', null)));
  assert.equal(none.firstOf.jp, null); assert.equal(none.first, null);
});

test('measure: no outlet is given a side of left or right', () => {
  const m = measure(ev(it('関税', 'jp', '全国紙', T)));
  for (const k of Object.keys(m)) assert.ok(!/left|right|stance|lean/i.test(k), k);
});

test('headlineWords: runs of kanji and katakana cut before okurigana, once per headline, most used first', () => {
  const w = headlineWords([{ title: '【まとめてわかる】原油高、株価、関税 中間選挙受け日本への影響は' }, { title: 'トランプ氏 関税で中間選挙に圧力' }], { limit: 10 });
  const names = w.map((x) => x.w);
  assert.ok(names.includes('中間選挙'));
  assert.ok(!names.includes('中間選挙受'));   // the verb's stem is not part of the word
  assert.equal(w.find((x) => x.w === '関税').n, 2);
  assert.ok(['関税', '中間選挙'].includes(names[0]));
});

test('headlineWords: the boilerplate of parallax/keyterms.py and the small words of English are left out, the trailing outlet too', () => {
  const names = headlineWords([{ title: 'Oil prices fall as Vance blames the election - Reuters' }, { title: '速報 関税の解説【Nスタ解説】' }], { limit: 20 }).map((x) => x.w);
  for (const x of ['the', 'as', '速報', '解説', 'Reuters', 'Nスタ解説']) assert.ok(!names.includes(x), x);
  assert.ok(names.includes('Vance'));
});

test('headlineWords: an English place takes its Japanese name so the two sides meet on it, an outlet is not a word', () => {
  const x = headlineWords([{ title: 'Iran war: Reuters says oil up' }], { exclude: ['Reuters'], limit: 10 }).map((a) => a.w);
  assert.ok(x.includes('イラン'));
  assert.ok(!x.includes('Reuters'));
  const c = compareWords(headlineWords([{ title: 'イラン情勢' }]), headlineWords([{ title: 'Iran talks' }]));
  assert.equal(c.jp.find((a) => a.w === 'イラン').both, true);
  assert.equal(c.intl.find((a) => a.w === 'イラン').both, true);
});

test('sideLines: the AI focus of the earliest report that has one, otherwise the words', () => {
  const l = [it('a', 'jp', 'x', T, 'A', 'a'), it('b', 'jp', 'x', T + 10, 'B', 'b')];
  const words = [{ w: '関税', n: 2 }, { w: '株価', n: 1 }];
  const ai = sideLines(l, words, (x) => (x.id === 'b' ? '関税に着目' : ''));
  assert.equal(ai.ai, '関税に着目'); assert.equal(ai.first.id, 'a');
  const rule = sideLines(l, words, () => '');
  assert.equal(rule.ai, ''); assert.equal(rule.words.length, 2);
});

test('paperPick: another headline than the title, a ministry first, one with a description before one without', () => {
  const a = { ...it('題と同じ', 'jp', '政府一次', T), desc: '説明文' };
  const b = it('別の見出し', 'jp', '全国紙', T);
  const c = { ...it('説明のある見出し', 'jp', '民放', T), desc: '説明文' };
  assert.equal(paperPick([a, b, c], '題と同じ').title, '説明のある見出し');
  assert.equal(paperPick([a, b], '「題と同じ」').title, '別の見出し');
  assert.equal(paperPick([a], '題と同じ'), null);
});
