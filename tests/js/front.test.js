// The home's three ways in and its one panel, the compare screen's rows, and the fixes of the return to the home (docs/design-1115.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { keepInList, gapByField, gapByEvent, jpShare, numbersOf, numValue, toneOf, paperOf, renderFront, renderGap, renderPaper, cleanTitle, tabKey, wordBars, setWordGroups,
  FRONT_TABS,TONE_NEG, TONE_POS, TONE_NEG_EN, TONE_POS_EN, TONE_MIN, PAPER_HEADS } from '../../js/front.js';

const read = (f) => readFileSync(path.join(ROOT, f), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const sidesOf = (e) => ({ jp: e.members.filter((m) => m.home !== 'intl' && m.type !== '政府一次'), intl: e.members.filter((m) => m.home === 'intl'), gov: e.members.filter((m) => m.type === '政府一次') });
const ev = (key, field, jp, intl) => ({ key, field, members: [...Array.from({ length: jp }, () => ({ home: 'jp' })), ...Array.from({ length: intl }, () => ({ home: 'intl' }))] });
const mkH = () => { const made = []; const h = (tag, attrs, ...kids) => { const el = { tag, attrs: attrs || {}, kids: kids.flat(4).filter((k) => k != null && k !== false) }; made.push(el); return el; }; return { made, h }; };
const text = (el) => (el && typeof el === 'object' ? (el.attrs.text != null ? String(el.attrs.text) : '') + el.kids.map(text).join('') : String(el));

test('the reports of Japan and abroad per field: counted, leaning left for Japan and right for abroad, a field without reports left out', () => {
  const es = [ev('a', '国内政治', 8, 2), ev('b', '国内政治', 2, 0), ev('c', '国際', 1, 9), ev('d', 'その他', 5, 5)];
  const g = gapByField(es, { sidesOf, fields: ['国内政治', '国際', '経済'] });
  assert.deepEqual(g.rows.map((r) => [r.field, r.jp, r.intl]), [['国内政治', 10, 2], ['国際', 1, 9]]);
  assert.ok(g.rows[0].d < 0 && g.rows[1].d > 0);
  assert.equal(g.jp + g.intl, 22, 'the field of "other" is not in the denominator');
  assert.equal(jpShare(g), 50);
  assert.equal(jpShare({ jp: 0, intl: 0 }), null, 'nothing counted: no number');
  const one = gapByEvent(es, { sidesOf, titleOf: (e) => e.key, max: 2 });
  assert.deepEqual(one.rows.map((r) => r.key), ['a', 'c']);
});

test('the figures of the headlines: an amount, people and a span; a year is the date, not a figure; one value meets across languages', () => {
  const n = numbersOf(['円安、2,000億円の介入 3年ぶり', '死者12人に 2026年', '2000億円規模']);
  assert.deepEqual(n.map((x) => x.text).sort(), ['12人', '2,000億円', '2000億円', '3年'].sort());
  assert.equal(numValue('2,000億円'), 2000);
  assert.equal(numValue('$4.2 trillion'), 4.2);
  assert.ok(numbersOf(['Fed holds rates for 3 years', '12 dead in blast']).some((x) => x.text === '3 years'));
});

test('the reaction words are counted, never judged: the same two lists as data/coverage.json react_tone, and only words of react', () => {
  const cov = JSON.parse(read('data/coverage.json'));
  const rt = cov.react_tone;
  assert.deepEqual(TONE_NEG, rt.neg.split(' '));
  assert.deepEqual(TONE_POS, rt.pos.split(' '));
  assert.deepEqual(TONE_NEG_EN, rt.en_neg.split(','));
  assert.deepEqual(TONE_POS_EN, rt.en_pos.split(','));
  const react = cov.react.split(' '), reactEn = cov.en.react.split(',');
  for (const w of [...TONE_NEG, ...TONE_POS]) assert.ok(react.includes(w), w);
  for (const w of [...TONE_NEG_EN, ...TONE_POS_EN]) assert.ok(reactEn.includes(w), w);
  const t = toneOf(['野党が批判、与党は歓迎', '各国が懸念と批判', 'EU welcomed the deal']);
  assert.equal(t.nNeg, 3);
  assert.equal(t.nPos, 2);
  assert.deepEqual(t.neg[0], { w: '批判', n: 2 });
});

test('the compare rows: one column a side with reports, the same rows in each; a figure only one side carries is marked; the side first by the clock leads', () => {
  const T = 1793800000;
  const m = {
    jp: [{ title: '首相が辞任 3年で', ts: T + 3600, outlet: 'A' }, { title: '首相辞任に批判', ts: T + 7200, outlet: 'B' }],
    intl: [{ title: 'PM resigns after 3 years', ts: T, outlet: 'X', lang: 'en' }, { title: 'PM quits; 40 people protest', ts: T + 60, outlet: 'Y', lang: 'en' }],
    gov: [],
    words: { jp: [{ w: '辞任', n: 2, both: true }], intl: [{ w: 'resign', n: 1 }] },
  };
  const p = paperOf(m);
  assert.deepEqual(p.cols.map((c) => c.side), ['jp', 'intl'], 'no column for a side without a report');
  assert.equal(p.lead, 'intl');
  const intl = p.cols[1];
  assert.equal(intl.ahead, 3600);
  assert.ok(intl.nums.find((x) => x.text === '40 people').only, '40 is not in the Japanese headlines');
  assert.ok(!intl.nums.find((x) => x.text === '3 years').only, '3 meets 3年');
  assert.ok(p.cols[0].heads.length <= PAPER_HEADS);
  const few = paperOf({ jp: [{ title: 'x', ts: 1 }], intl: [], gov: [], words: { jp: [], intl: [] } });
  assert.equal(few.cols[0].few, true, 'one report: the rows that count say they are not shown');
});

test('the rows drawn: five rows in the same order for each side; a bar of reaction words only with three words or more', () => {
  const { made, h } = mkH();
  const m = { jp: [{ title: '批判 反発 懸念', ts: 1 }, { title: '批判', ts: 2 }], intl: [{ title: 'a', ts: 3 }, { title: 'b', ts: 4 }], gov: [], words: { jp: [], intl: [] } };
  renderPaper({ h, paper: paperOf(m), clock: () => '9:40', span: () => '1 分', outlet: (it) => it.outlet || '', safeUrl: () => null });
  const rows = made.filter((e) => e.attrs.role === 'row' && e.attrs.data).map((e) => e.attrs.data.row);
  assert.deepEqual(rows, ['words', 'nums', 'tone', 'first', 'heads']);
  assert.equal(made.filter((e) => e.attrs.class === 'pp-tone2').length, 1, 'Japan has 4 words: a bar; abroad has none: no bar');
  assert.ok(made.some((e) => e.attrs.text === '反応語なし'), 'abroad: no word, said in one line');
  assert.ok(made.some((e) => e.attrs.text === '見出しの語の数'), 'the bar says what it counts');
  assert.equal(TONE_MIN, 3);
});

test('the three ways in are tabs named by what can be seen; each carries one number from the data, none when there is none', () => {
  const { made, h } = mkH();
  const root = { replaceChildren() {} };
  const seen = [];
  renderFront(root, { h, tab: 'jp', field: null, fields: ['国際'], counts: { gap: '国内 62%', jp: '', intl: '12 件', bias: '最大 71' }, onTab: (id) => seen.push(id), onField: (f) => seen.push(f) });
  const tabs = made.filter((e) => e.attrs.role === 'tab');
  assert.deepEqual(tabs.map((t) => t.kids[0].kids[0].attrs.text), FRONT_TABS.map(([, ja]) => ja));
  assert.deepEqual(FRONT_TABS.map(([, ja]) => ja), ['国内外比較', '日本独自', '海外独自', '偏り度'], 'short nouns, Sir\'s words of 11-15');
  assert.deepEqual(tabs.map((t) => t.attrs['aria-selected']), ['false', 'true', 'false', 'false']);
  assert.deepEqual(tabs.map((t) => t.attrs.tabindex), ['-1', '0', '-1', '-1'], 'one tab in the order of the Tab key: the arrows move between them');
  assert.deepEqual([tabKey('ArrowRight', 3, 4), tabKey('ArrowLeft', 0, 4), tabKey('Home', 1, 4), tabKey('End', 0, 4), tabKey('a', 0, 4)], [0, 3, 0, 3, null]);
  assert.equal(tabs[1].kids.length, 1, 'an empty count draws no number');
  tabs[3].attrs.on.click();
  made.find((e) => e.tag === 'button' && text(e) === '国際').attrs.on.click();
  assert.deepEqual(seen, ['bias', '国際']);
  // each way in names its unit under its name (11-16: the denominator and the scale are read off the card, not explained beside it)
  made.length = 0;
  renderFront(root, { h, tab: 'gap', field: null, fields: [], counts: {}, subs: { gap: '記事 546 件の比率', bias: '0〜100・8 話を測定' }, onTab() {}, onField() {} });
  assert.deepEqual(made.filter((e) => e.attrs.class === 'fr-sub').map((e) => e.attrs.text), ['記事 546 件の比率', '0〜100・8 話を測定']);
});

test('the panel: the denominator and the value\'s own time, red when old, 未取得 without one; an empty list says what to do next', () => {
  const { made, h } = mkH();
  const root = { replaceChildren() {}, setAttribute() {} };
  const g = { rows: [{ field: '国際', jp: 1, intl: 9, d: 0.8 }], jp: 1, intl: 9 };
  renderGap(root, { h, tab: 'gap', gap: g, gen: 1000, now: 1000 + 13 * 3600, clock: () => '9:40' });
  const t = made.find((e) => e.tag === 'time');
  assert.equal(t.attrs.text, '9:40 の値');
  assert.match(t.attrs.class, /stale/);
  assert.ok(made.some((e) => e.attrs.text === '分野が付いた話の記事 10 件'), 'the denominator in a word anyone reads, with what it counts (11-15g: 4,075 headlines, 572 articles and 88 stories read as one number)');
  // the counts stand in two columns (国内・海外) under a head row, the larger side's number dark (docs/design-1115b.md §3)
  assert.deepEqual(made.filter((e) => /fr-gn/.test(e.attrs.class || '')).map((e) => [e.attrs.text, /\bhi\b/.test(e.attrs.class)]), [['1', false], ['9', true]]);
  assert.deepEqual(made.filter((e) => e.attrs.class === 'fr-nh').map((e) => e.attrs.text), ['国内', '海外'], 'the columns are named once, in the head row');
  assert.ok(made.some((e) => e.tag === 'h2' && e.attrs.text === '分野別'), 'the panel is named by what it holds, not by the tab again');
  assert.ok(made.some((e) => e.attrs.class === 'fr-tot'), 'the share over all the fields under the table');
  const bar = made.find((e) => e.tag === 'i' && e.attrs.data && e.attrs.data.side === 'intl');
  assert.equal(bar.attrs.style, '--w:40.0%');
  const b = mkH();
  renderGap(root, { h: b.h, tab: 'intl', field: '技術', one: [{ side: 'jp', ja: '国内だけ', events: [] }, { side: 'intl', ja: '海外だけ', events: [] }], gen: null, now: 0, clock: () => '' });
  assert.ok(b.made.some((e) => e.tag === 'h2' && e.attrs.text === '海外独自'), 'one side\'s own news under its own name');
  assert.ok(b.made.some((e) => /「すべて」に戻すと出ることがあります/.test(e.attrs.text || '')), 'an empty list says what to do next');
  assert.ok(b.made.some((e) => e.attrs.text === '未取得'));
});

test('one count of outlets on every screen: the compare columns count 社 as the card does, not the reports', () => {
  const { made, h } = mkH();
  const m = { jp: [{ title: 'a', ts: 1, outlet: 'A' }, { title: 'b', ts: 2, outlet: 'A' }, { title: 'c', ts: 3, outlet: 'B' }], intl: [{ title: 'x', ts: 4, outlet: 'X' }, { title: 'y', ts: 5, outlet: 'X' }], gov: [], words: { jp: [], intl: [] } };
  const p = paperOf(m);
  assert.deepEqual(p.cols.map((c) => [c.n, c.outlets]), [[3, 2], [2, 1]]);
  renderPaper({ h, paper: p, clock: () => '', span: () => '', outlet: (it) => it.outlet, safeUrl: () => null });
  const head = made.filter((e) => e.attrs.role === 'columnheader' && e.attrs.data).map(text);
  assert.deepEqual(head, ['国内報道2社', '海外報道1社']);
});

test('the figure of words: a word of both sides first, each side counted in all its headlines, only with both sides', () => {
  const m = { jp: [{ title: '民主党が勝利 下院を奪還', ts: 1 }, { title: '民主党 下院', ts: 2 }], intl: [{ title: 'Democrats win; 下院', ts: 3 }, { title: 'House flips', ts: 4 }], gov: [],
    words: { jp: [{ w: '民主党', n: 2 }, { w: '下院', n: 2 }], intl: [{ w: 'Democrats', n: 1 }] } };
  const rows = wordBars(paperOf(m));
  assert.deepEqual(rows.map((r) => [r.w, r.jp, r.intl]), [['下院', 2, 1], ['民主党', 2, 0], ['Democrats', 0, 1]], '下院 is in an English headline too: counted there');
  assert.equal(rows.max, 2);
  assert.deepEqual(wordBars(paperOf({ ...m, intl: [] })), [], 'one side only: no figure');
});

test('the figure of words: the same word in two languages is one row, counted over every form (スターシップ / Starship)', () => {
  const m = { jp: [{ title: 'スターシップ 回収に成功', ts: 1 }, { title: 'スターシップ 試験', ts: 2 }], intl: [{ title: 'Starship caught by tower', ts: 3 }, { title: 'Starship launch', ts: 4 }, { title: 'Starship flight', ts: 5 }], gov: [],
    words: { jp: [{ w: 'スターシップ', n: 2 }], intl: [{ w: 'Starship', n: 3 }] } };
  assert.deepEqual(wordBars(paperOf(m), []).map((r) => [r.w, r.jp, r.intl]), [['スターシップ', 2, 0], ['Starship', 0, 3]], 'without the table: two rows');
  const one = wordBars(paperOf(m), [['スターシップ', 'Starship']]);
  assert.deepEqual(one.map((r) => [r.w, r.jp, r.intl]), [['スターシップ', 2, 3]], 'with it: one row, the Japanese form, both sides counted');
  const poss = { ...m, intl: [{ title: "Starship's flight", ts: 3 }, { title: 'Starship landing', ts: 4 }, { title: 'Starship tower', ts: 5 }], words: { jp: [{ w: 'スターシップ', n: 2 }], intl: [{ w: "Starship's", n: 1 }] } };
  assert.equal(wordBars(paperOf(poss), [['スターシップ', 'Starship']]).length, 1, "a possessive (Starship's) is the word");
  setWordGroups([['スターシップ', 'Starship']]);
  assert.equal(wordBars(paperOf(m)).length, 1, 'the table set once is the default');
  const sx = { jp: [{ title: 'スペースX 回収', ts: 1 }, { title: 'スペースX 試験', ts: 2 }], intl: [{ title: 'SpaceX catch', ts: 3 }, { title: 'SpaceX flight', ts: 4 }, { title: 'SpaceX tower', ts: 5 }], gov: [], words: { jp: [{ w: 'スペース', n: 1 }], intl: [{ w: 'SpaceX', n: 1 }] } };
  assert.deepEqual(wordBars(paperOf(sx), [['スペースX', 'スペース', 'SpaceX']]).map((r) => r.w), ['スペースX'], 'the row is named as the table names it, not by the shorter form a headline used');
  setWordGroups([]);
});

test('a list shows the headline itself: the wire\'s photo caption before it and 「- 写真・画像(1/1)」 after it are dropped', () => {
  assert.equal(cleanTitle('記者団の取材に応じる武部農相＝4日午後、農水省 - 武部氏、米価で発言'), '武部氏、米価で発言');
  assert.equal(cleanTitle('米中間選挙、民主党が勝利 - 写真・画像(1/1)'), '米中間選挙、民主党が勝利');
  assert.equal(cleanTitle('A - B の見出し'), 'A - B の見出し', 'a dash without a caption stays');
});

test('no line on the screen explains the screen: the rules of the counts are not written under them', () => {
  const src = read('js/front.js') + read('js/entry.js');
  for (const s of ['語未満は棒にしません', '記事が 3 件以上ある話だけを測ります', '記事が少ないため出しません', "h('p', { class: 'en-hint' }"]) assert.ok(!src.includes(s), s);
});

test('keepInList moves the list only, never the page around it', () => {
  const box = { scrollTop: 100, getBoundingClientRect: () => ({ top: 0, bottom: 300 }) };
  assert.equal(keepInList(box, { getBoundingClientRect: () => ({ top: 320, bottom: 380 }) }), true);
  assert.equal(box.scrollTop, 180);
  keepInList(box, { getBoundingClientRect: () => ({ top: -50, bottom: 10 }) });
  assert.equal(box.scrollTop, 130);
  assert.equal(keepInList(null, null), false);
});

test('the return to the home: the board keeps its place, the home opens at its top, nothing walks the home, the window of ties closes', () => {
  const app = read('js/app.js');
  assert.doesNotMatch(app, /inPri\.scrollIntoView/, 'the walk of the list does not carry #board (docs/design-1115.md §8 b)');
  assert.match(app, /if \(inPri && !byHand\) keepInList\(\$\('pri-b'\), inPri\);/);
  const sh = app.slice(app.indexOf('function setHome(m)'), app.indexOf('function setUi(m)'));
  assert.match(sh, /state\.boardScroll = b\.scrollTop/);
  assert.match(sh, /if \(v === 'home'\) \{ b\.scrollTop = 0;/);
  assert.match(app, /if \(homeMode\(\) !== 'board' \|\| isShow\(\)\) return;/, 'the home\'s card changes by hand only');
  assert.match(app, /window\.addEventListener\('hashchange', \(\) => \{\n    netClose\(\);/);
  // the four ways home go through setHome: the name, the tab, the browser's back, the end of the tour
  assert.match(app, /nameHome\.addEventListener\('click', \(\) => toScreen\('home', \(\) => \{ setSect\('home'\);/);   // 11-17: the screens move together (js/motion.js viewSwap); toScreen calls goScreen
  assert.match(app, /onEnd: \(\) => \{ if \(state\.ui === 'simple'\) setUi\('full'\); setHome\('home'\);/);
  assert.match(app, /else setHome\(name\);/);
});

test('the page: one gothic and Inter for figures (no Mincho, no Plex, no Barlow), the worker keeps js/front.js, the home holds its three parts', () => {
  const html = read('index.html');
  assert.match(html, /family=Noto\+Sans\+JP:wght@400;500;700&amp;family=Inter:wght@500;600;700&amp;display=swap/);
  assert.doesNotMatch(html, /Shippori|IBM\+Plex|Barlow/);
  assert.doesNotMatch(html, /Zen\+Kaku/);
  assert.match(html, /<section class="front" id="front"[^>]*><\/section>\s*<!-- hero:begin -->/);
  assert.match(html, /<!-- hero:end -->\s*<section class="gap" id="gap"/);
  assert.match(read('sw.js'), /'js\/front\.js'/);
  const css = read('css/app.css');
  const block = css.slice(css.indexOf('/* ==== meeting-1115:begin ==== */'), css.indexOf('/* ==== meeting-1115:end ==== */'));
  assert.ok(block.length > 100, 'the block of 11-15 is in the stylesheet');
  assert.ok(css.indexOf('/* ==== meeting-1115:end ==== */') < css.indexOf('/* ==== stage:begin ==== */'), 'before the stage, which comes last');
  assert.match(block, /:root\[data-theme="light"\] \{[^}]*--win: #ffffff; --pane: #f3f4f6;/);
  assert.doesNotMatch(block, /!important/);
});

test('the value\'s time: green to 8 hours, amber after 8 (a collection is late: the schedule of GitHub runs 4 to 13 hours apart) with a title, red after 12 and then with its date', () => {
  const stampAt = (age) => { const { made, h } = mkH(); renderGap({ replaceChildren() {}, setAttribute() {} }, { h, tab: 'gap', gap: { rows: [{ field: '国際', jp: 1, intl: 9, d: 0.8 }], jp: 1, intl: 9 }, gen: 1000, now: 1000 + age, clock: () => '9:40', short: () => '11/15 9:40' }); return made.find((e) => e.tag === 'time'); };
  const ok = stampAt(7.9 * 3600), warn = stampAt(8.1 * 3600), bad = stampAt(12.1 * 3600);
  assert.doesNotMatch(ok.attrs.class, /stale|aging/);
  assert.match(warn.attrs.class, /aging/); assert.doesNotMatch(warn.attrs.class, /stale/);
  assert.match(warn.attrs.title, /遅れています.*4〜13 時間おき/);
  assert.match(bad.attrs.class, /stale/); assert.doesNotMatch(bad.attrs.class, /aging/);
  assert.equal(bad.attrs.text, '11/15 9:40 の値');
});

test('初報 on 比べる says what it counted (全 N 社, every outlet of the story) and who came first as 媒体比較 says it (海外が 1時間19分 先)', async () => {
  const { leadLine, firstGapLine } = await import('../../js/coverage.js');
  const { made, h } = mkH();
  // 11-15: 比べる showed France 24 05:51 before 日本経済新聞 07:10, while 媒体比較 (6 of 10 outlets compared) said Japan came first
  const m = { jp: [{ title: 'a', ts: 7 * 3600 + 600, outlet: '日本経済新聞' }, { title: 'b', ts: 9 * 3600, outlet: 'NHK' }], intl: [{ title: 'x', ts: 5 * 3600 + 3060, outlet: 'France 24' }], gov: [{ title: 'g', ts: 10 * 3600, outlet: '外務省' }], words: { jp: [], intl: [] } };
  renderPaper({ h, paper: paperOf(m), clock: () => '', span: (s) => `${Math.floor(s / 3600)}時間${Math.floor((s % 3600) / 60)}分`, outlet: (it) => it.outlet, safeUrl: () => null });
  const head = made.find((e) => e.attrs.role === 'rowheader' && text(e).startsWith('初報'));
  assert.equal(text(head), '初報全 4 社', 'the row names its count: every outlet of the three sides');
  assert.ok(made.some((e) => e.attrs.class === 'pp-ahead' && e.attrs.text === '海外が 1時間19分 先'));
  assert.equal(leadLine('海外', '1時間19分'), firstGapLine('海外が国内より 1 時間 19 分 早く報じた'), 'the two screens say it in one form');
  assert.equal(firstGapLine('国内が海外より 22 時間 早く報じた'), '国内が 22時間 先');
  assert.equal(firstGapLine('ほかの文'), null);
});

test('偏り度: the scale is a key under the list, the stories one side carried alone are named outside the order and lead to their own list', () => {
  const { made, h } = mkH();
  const root = { replaceChildren() {}, setAttribute() {} };
  const seen = [];
  renderGap(root, { h, tab: 'bias', bias: [{ key: 'a', title: 'ミャンマー', score: 52 }], scored: 8, apart: { jp: 58, intl: 19 }, gen: 1000, now: 1000, clock: () => '9:40', onTab: (id) => seen.push(id), detail() {} });
  const keys = made.filter((e) => e.attrs.class === 'fr-key');
  assert.equal(keys.length, 1);
  assert.deepEqual(made.filter((e) => e.tag === 'button' && /fr-ab/.test(e.attrs.class || '')).map((e) => text(e)), ['日本独自58件', '海外独自19件']);
  made.find((e) => /fr-ab/.test(e.attrs.class || '')).attrs.on.click();
  assert.deepEqual(seen, ['jp']);
  assert.ok(made.some((e) => /8 話を測定/.test(e.attrs.text || '')), 'the denominator of the order');
  made.length = 0;
  renderGap(root, { h, tab: 'bias', bias: [], apart: { jp: 0, intl: 0 }, gen: 1000, now: 1000, clock: () => '9:40' });
  assert.ok(!made.some((e) => /fr-apart/.test(e.attrs.class || '')), 'nothing left out, nothing said');
});
