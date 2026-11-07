import { test } from 'node:test';
import assert from 'node:assert/strict';
import { biasOf, sourceBase, TOO_FEW, WORD_FULL } from '../../js/bias.js';
import { measure, runOf, divergeRows, wordMatrix } from '../../js/dossier.js';
import { kindOf, numberIn } from '../../js/wall.js';

const T = 1_790_000_000;
const it = (id, title, home, type, ts, outlet, lang = 'ja') => ({ id, title, home, type, ts, outlet, lang });
const ev = (...members) => ({ members });
const base = sourceBase([{ outlet: 'A', home: 'jp', type: '全国紙', n: 10 }, { outlet: 'B', home: 'jp', type: '民放', n: 10 }, { outlet: 'C', home: 'jp', type: '通信社', n: 10 }, { outlet: 'X', home: 'intl', type: '海外主流', n: 10 }]);

test('sourceBase counts each outlet once, by its home and kind, and adds up the headlines', () => {
  const b = sourceBase([{ outlet: 'A', home: 'jp', type: '全国紙', n: 3 }, { outlet: 'A', home: 'jp', type: '全国紙', n: 2 }, { name: 'X', home: 'intl', type: '海外主流', n: 5 }, null]);
  assert.equal(b.jp, 1); assert.equal(b.intl, 1); assert.deepEqual(b.items, { jp: 5, intl: 5 });
  assert.deepEqual(b.shares, { 全国紙: .5, 海外主流: .5 });
  assert.equal(base.jp, 3); assert.equal(base.intl, 1);
});

test('too few reports give no number at all', () => {
  assert.deepEqual(biasOf(measure(ev(it('a', '関税', 'jp', '全国紙', T, 'A'), it('b', '株価', 'jp', '全国紙', T, 'B'))), { base }), { ok: false, reason: TOO_FEW });
  assert.equal(TOO_FEW, '記事が少なく測れません');
  // three reports of one outlet are one voice
  assert.equal(biasOf(measure(ev(it('a', '関税', 'jp', '全国紙', T, 'A'), it('b', '株価', 'jp', '全国紙', T, 'A'), it('c', '原油', 'jp', '全国紙', T, 'A'))), { base }).ok, false);
});

test('each term by hand, and the score is their plain mean', () => {
  const m = measure(ev(it('a', '関税と原油', 'jp', '全国紙', T + 3600 * 12, 'A'), it('b', '関税と株価', 'jp', '民放', T + 3600 * 13, 'B'), it('c', 'Oil prices fall', 'intl', '海外主流', T, 'X', 'en')));
  const b = biasOf(m, { base });
  assert.equal(b.ok, true);
  const v = Object.fromEntries(b.terms.map((t) => [t.id, t.value]));
  // region: abroad 1 of 3 against 1 of 4 collected; chance with 3 is sqrt(.25 x .75 / 3) = .25; |.333 - .25| / .25 / 3 = 11
  assert.equal(v.region, 11);
  // kinds: three kinds once each, sum of squares .333; chance with 3 reports 1/3 + 2/3 x .25 = .5: below chance counts 0
  assert.equal(v.kinds, 0);
  // volume: 1 of 3 abroad against 10 of 40 headlines: the same 11
  assert.equal(v.volume, 11);
  // lag: 12 hours of 24 = 50
  assert.equal(v.lag, 50);
  // words: the Japanese pair shares 関税 of three words, 1/3; 1 - (1/3) / WORD_FULL
  const w = Math.round((1 - (1 / 3) / WORD_FULL) * 100);
  assert.equal(v.words, w);
  assert.equal(b.score, Math.round((11 + 0 + 11 + 50 + w) / 5));
  assert.ok(b.formula.endsWith(`= ${b.score}`));
  for (const t of b.terms) { assert.ok(t.value >= 0 && t.value <= 100, t.id); assert.ok(t.formula.length > 0, t.id); }
});

test('without the AI its term is left out and the rest are averaged; with it, it carries the AI mark', () => {
  const m = measure(ev(it('a', '関税と原油', 'jp', '全国紙', T, 'A'), it('b', '関税と株価', 'jp', '民放', T, 'B'), it('c', 'Oil prices fall', 'intl', '海外主流', T, 'X', 'en')));
  const off = biasOf(m, { base });
  assert.ok(!off.terms.some((t) => t.id === 'ai'));
  assert.ok(off.skipped.some((t) => t.id === 'ai'));
  const on = biasOf(m, { base, angles: new Map([['a', '関税の影響'], ['c', '原油の価格']]) });
  const ai = on.terms.find((t) => t.id === 'ai');
  assert.equal(ai.ai, true);
  assert.equal(ai.value, 100);   // no word in common between the two sides' focus lines
  assert.equal(on.terms.length, off.terms.length + 1);
  assert.ok(on.terms.filter((t) => t.id !== 'ai').every((t) => !t.ai));
});

test('a one-sided event: the lag cannot be measured and is left out, never counted as zero', () => {
  const b = biasOf(measure(ev(it('a', '関税と原油', 'jp', '全国紙', T, 'A'), it('b', '関税と株価', 'jp', '民放', T, 'B'), it('c', '原油高', 'jp', '通信社', T, 'C'))), { base });
  assert.ok(b.skipped.some((t) => t.id === 'lag'));
  // nothing abroad out of 3, against a quarter abroad overall: chance alone gives this often, so it counts little
  assert.equal(b.terms.find((t) => t.id === 'volume').value, 33);
});

test('the same one-sidedness counts for more the more outlets show it: a small story does not come out high for being small', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ outlet: `O${i}`, home: i % 2 ? 'jp' : 'intl', type: i % 3 ? '全国紙' : '海外主流', n: 10 }));
  const b0 = sourceBase(many);
  const reports = (k) => Array.from({ length: k }, (_, i) => it(`r${i}`, `別の話題${i}`, 'jp', i % 2 ? '全国紙' : '民放', T + i, `O${i}`));
  const small = biasOf(measure(ev(...reports(3))), { base: b0 }), big = biasOf(measure(ev(...reports(20))), { base: b0 });
  const of = (b, id) => b.terms.find((t) => t.id === id).value;
  assert.ok(of(small, 'region') < of(big, 'region'));
  assert.ok(of(small, 'volume') < of(big, 'volume'));
});

test('nothing in the result names a side, a truth or an outlet stance', () => {
  const b = biasOf(measure(ev(it('a', '関税', 'jp', '全国紙', T, 'A'), it('b', '関税', 'jp', '民放', T, 'B'), it('c', 'Oil', 'intl', '海外主流', T, 'X', 'en'))), { base });
  const text = JSON.stringify(b);
  for (const w of ['左派', '右派', 'リベラル', '保守', '誤報', 'フェイク', '正しい', '真偽']) assert.ok(!text.includes(w), w);
});

test('runOf: the reports add up along the time, one side at a time', () => {
  const m = measure(ev(it('a', 'x', 'jp', '全国紙', T + 60, 'A'), it('b', 'y', 'intl', '海外主流', T, 'X', 'en'), it('c', 'z', 'jp', '政府一次', T + 120, 'G'), it('d', 'w', 'jp', '全国紙', null, 'N')));
  assert.deepEqual(runOf(m).map((r) => [r.ts, r.jp, r.intl, r.gov]), [[T, 0, 1, 0], [T + 60, 1, 1, 0], [T + 120, 1, 1, 1]]);
});

test('divergeRows: words with a count on each side, the most used first', () => {
  const m = measure(ev(it('a', '関税と原油', 'jp', '全国紙', T, 'A'), it('b', '関税と株価', 'jp', '民放', T, 'B'), it('c', 'Iran and oil', 'intl', '海外主流', T, 'X', 'en'), it('d', 'イラン情勢', 'jp', '民放', T, 'B')));
  const r = divergeRows(m);
  const iran = r.find((x) => x.w === 'イラン');
  assert.equal(iran.jp, 1); assert.equal(iran.intl, 1);
  assert.equal(r.find((x) => x.w === '関税').jp, 2);
  assert.equal(r.find((x) => x.w === '関税').intl, 0);
  assert.equal(divergeRows(measure(ev(it('a', '関税', 'jp', '全国紙', T, 'A')))).length, 0);   // one side alone has nothing to compare
});

test('wordMatrix: which outlet used which word; nothing to draw with one outlet', () => {
  const x = wordMatrix(measure(ev(it('a', '関税と原油', 'jp', '全国紙', T, 'A'), it('b', '関税と株価', 'jp', '民放', T, 'B'))));
  assert.deepEqual(x.outlets.map((o) => o.name), ['A', 'B']);
  assert.equal(x.words[0], '関税');
  assert.equal(x.has('A', '関税'), true); assert.equal(x.has('A', '株価'), false);
  assert.equal(wordMatrix(measure(ev(it('a', '関税と原油', 'jp', '全国紙', T, 'A')))), null);
});

test('a card takes its shape from what it holds', () => {
  const m = (...x) => measure(ev(...x));
  const gov = it('g', '資料', 'jp', '政府一次', T, 'G'), np = it('a', '関税', 'jp', '全国紙', T, 'A');
  assert.equal(kindOf({ heading: { text: '' } }, m(gov), null, null), 'doc');
  assert.equal(kindOf({ heading: { text: '' } }, m(np), { kind: 'video' }, null), 'video');
  assert.equal(kindOf({ heading: { text: '' } }, m(np), null, { new6h: 4, sinceH: 3 }), 'flash');
  assert.equal(kindOf({ heading: { text: '防衛予算 8兆円に' } }, m(np), null, null), 'number');
  assert.equal(kindOf({ heading: { text: '関税の話' } }, m(np), null, null), 'plain');
});

test('numberIn takes the number as printed in the headline, never a date', () => {
  assert.equal(numberIn('防衛予算 8兆円に'), '8兆円');
  assert.equal(numberIn('支持率は 62% に'), '62%');
  assert.equal(numberIn('死者 1,200 人'), '1,200 人');
  assert.equal(numberIn('11月5日に発表'), null);
  assert.equal(numberIn('2026年の見通し'), null);
  assert.equal(numberIn('関税の話'), null);
});
