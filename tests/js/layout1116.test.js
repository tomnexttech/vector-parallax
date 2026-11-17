// node --test tests/js/layout1116.test.js
// The layout pass of 2026-11-16 (v64), from what was said that day about the public page:
//   the media table keeps to its width and its row names are no see-through plates; 言い回し is the size of the text beside it;
//   the home's card carries the news and its photo is a thumbnail; 映像・関連・出典 of 詳しく見る are in view; one scale of sizes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { coverageOf, createCoverage, FIT, fitOf } from '../../js/coverage.js';
import { createHero, readHero } from '../../js/hero.js';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const h = (tag, attrs, ...kids) => {
  const n = { tag, attrs: attrs || {}, kids: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false) };
  n.replaceChildren = (...k) => { n.kids = k.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false); };
  n.setAttribute = (k, v) => { n.attrs[k] = v; };
  return n;
};
const text = (n) => (typeof n === 'string' || typeof n === 'number' ? String(n) : n && n.kids ? (n.attrs.text != null ? String(n.attrs.text) : '') + n.kids.map(text).join('') : '');
const all = (n, f, out = []) => { if (n && typeof n === 'object') { if (f(n)) out.push(n); n.kids.forEach((k) => all(k, f, out)); } return out; };
const cls = (c) => (n) => typeof n.attrs.class === 'string' && n.attrs.class.split(' ').includes(c);

const css = read('css/app.css');
const A = css.indexOf('/* ==== v64:begin ===='), B = css.indexOf('/* ==== v64:end ==== */');
const v64 = css.slice(A, B);
const SCALE = [10, 11, 12, 13, 14, 16, 19, 22, 28, 34, 44, 60];

test('the v64 block is followed only by the v70 block, which ends the stylesheet, and names the scale', () => {
  assert.ok(A > 0 && B > A);
  // v70 (11-17) comes after it: the tiles' ground (docs: the --ui-* tokens), and it is the last thing in the stylesheet now
  assert.ok(css.slice(B).trim().startsWith('/* ==== v64:end ==== */') && css.trim().endsWith('/* ==== v70:end ==== */'));
  assert.match(css, /--fs-0: 10px; --fs-1: 11px; --fs-2: 12px; --fs-3: 13px; --fs-4: 14px; --fs-5: 16px; --fs-6: 19px; --fs-7: 22px; --fs-8: 34px; --fs-9: 44px; --fs-10: 60px;/);
  assert.match(v64, /:root \{ --fs-7h: 28px;/);
});

test('every size the v64 block sets is a step of the scale (a token, or a px that is one)', () => {
  const px = [...v64.matchAll(/font(?:-size)?:[^;{}]*?(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  for (const v of px) assert.ok(SCALE.includes(v), `${v}px is not a step`);
  assert.doesNotMatch(v64, /font-size: (?:calc|clamp|max|min)\(/, 'no size that slides between the steps');
  const tokens = [...v64.matchAll(/font(?:-size)?:[^;{}]*?var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
  for (const t of tokens) assert.match(t, /^--(fs-(\d+|7h)|h-(note|body|sub|title|num)|f-(text|num|display))$/, t);
});

test('媒体比較: the columns share the box (full, tight, slim) and only run on when a column would be under 46 px', () => {
  assert.deepEqual([fitOf(140), fitOf(90), fitOf(89), fitOf(58), fitOf(57), fitOf(46), fitOf(45)], ['full', 'full', 'tight', 'tight', 'slim', 'slim', 'run']);
  assert.ok(FIT.label > 80 && FIT.thin < FIT.tight);
  assert.match(v64, /\.cv-wrap:is\(\[data-fit="full"\], \[data-fit="tight"\], \[data-fit="slim"\]\) \.cv-t \{ table-layout: fixed; width: 100%;/);
  assert.match(v64, /\.cv-wrap:is\(\[data-fit="full"\], \[data-fit="tight"\], \[data-fit="slim"\]\) > \.cv-sc \{ overflow-x: clip;/);
  const src = read('js/coverage.js');
  assert.match(src, /wrap\.setAttribute\('data-fit', fit\)/);
});

test('媒体比較 that runs on: the row names and the corner are plates nothing shows through, with the tiles\' corners', () => {
  const run = /\.cv-wrap\[data-fit="run"\] \.cv-t tbody th, [^{]*\{([^}]*)\}/.exec(v64);
  assert.ok(run, 'the rule of the row names');
  assert.match(run[1], /position: sticky; left: 0;/);
  assert.match(run[1], /background: var\(--v-plate\);/);
  assert.match(run[1], /backdrop-filter: none;/);
  assert.match(run[1], /border-radius: 8px;/);
  for (const m of css.matchAll(/--v-plate: (#[0-9a-f]{6});/g)) assert.equal(m[1].length, 7, 'a colour without alpha');
  assert.equal([...css.matchAll(/--v-plate: #[0-9a-f]{6};/g)].length, 2, 'dark and light');
  assert.match(v64, /\.cv-wrap\[data-fit="run"\] \.cv-t thead th\.cv-c \{ position: sticky; left: 0; z-index: 3; background: var\(--v-plate\);/);
});

test('媒体比較: a column no row fills is marked narrow; every cell carries its outlet for the phone\'s list', () => {
  const { table } = createCoverage({ h });
  const c = coverageOf({ v: 1,
    outlets: [{ name: '朝日新聞', side: 'jp', lang: 'ja', desc: true }, { name: 'AFP', side: 'intl', lang: 'ja', desc: true }, { name: 'The Times', side: 'intl', lang: 'en', desc: true }],
    rows: [{ k: 'who', t: 'ペニャ', c: [{ p: 'ペニャ大統領を罷免', k: 'ペニャ' }, '', null] }, { k: 'why', t: '理由', c: ['', { p: '経営破綻めぐり', k: 'めぐり' }, null] }], words: [] });
  const el = table(c);
  const ths = all(el, (n) => n.tag === 'th' && n.attrs.scope === 'col' && n.attrs.data);
  assert.deepEqual(ths.map((t) => t.attrs.class || ''), ['', '', 'cv-thin']);
  const tds = all(el, (n) => n.tag === 'td');
  assert.equal(tds.length, 6);
  assert.deepEqual(tds.slice(0, 3).map((t) => t.attrs.data.o), ['朝日新聞', 'AFP', 'The Times']);
  assert.match(v64, /@media screen and \(max-width: 760px\) \{[\s\S]*?\.cv-wrap \.cv-t td::before \{ content: attr\(data-o\); \}/);
  assert.match(v64, /\.cv-wrap \.cv-t thead \{ position: absolute; width: 1px; height: 1px;/, 'no head on a phone: a row is a card');
});

test('言い回し is the size of the text beside it; the count beside 初報差 is no longer the scrolling box\'s class', () => {
  assert.match(v64, /\.cov \.cv-wd \{ font: 700 var\(--fs-4\)\/1\.4 var\(--f-text\); \}/);
  assert.match(v64, /\.cov \.cv-w li \{ gap: 4px; font-size: var\(--fs-4\);/);
  assert.match(v64, /\.cov \.cv-x small \{ flex-basis: auto; font-size: var\(--fs-2\);/);
  const src = read('js/coverage.js');
  assert.match(src, /class: 'cv-cn num'/);
  assert.doesNotMatch(src, /class: 'cv-sc num'/);
});

const pick = () => ({ sid: 's1', tier: 'split', title: { text: '見出し甲', outlet: '甲新聞', lang: 'ja', ai: false },
  sides: { jp: { n: 2, outlets: 2, first_ts: 100 }, intl: { n: 1, outlets: 1, first_ts: 50 }, gov: { n: 0, outlets: 0, first_ts: null } },
  points: { jp: [], intl: [], both: [] },
  findings: [{ kind: 'word_choice', text: '用語選択：「会談」2 社・「talks」1 社', side: null }, { kind: 'first_gap', text: '海外が国内より 50 分 早く報じた', side: 'intl' }],
  heads: [{ id: 'a', side: 'jp', outlet: '甲新聞', ts: 100, title: '見出し甲', link: 'https://example.com/a' }, { id: 'b', side: 'jp', outlet: '乙新聞', ts: 120, title: '見出し乙', link: null },
    { id: 'c', side: 'intl', outlet: 'Wire', ts: 50, title: 'Headline C', link: null }] });

test('the home\'s card carries the news: each side\'s headlines as published, the findings, the brief, the bias index — values of the data only', () => {
  const made = [];
  const hh = (tag, attrs, ...kids) => { const el = h(tag, attrs, ...kids); made.push(el); return el; };
  const root = { hidden: true, replaceChildren() {} };
  const picks = readHero({ schema: 'parallax-hero/1', picks: [pick()] }).picks;
  const hero = createHero({ h: hh, root, fmt: { short: (t) => `t${t}`, clock: (t) => `t${t}` }, on: {
    photo: () => ({ url: 'https://example.com/p.jpg', outlet: '甲新聞' }),
    brief: () => ({ rows: [{ key: 'what_ja', label: '何が起きたか', text: '要旨の文。' }], at: 200 }), bias: () => 44 } });
  hero.render(picks, { gen: 300, now: 360 });
  const card = made.find(cls('hr-card'));
  assert.ok(card && /has-ph/.test(card.attrs.class));
  // the photo is inside the row of the headline, not a block over the card
  const led = all(card, cls('hr-led'))[0];
  assert.ok(led && all(led, cls('hr-ph')).length === 1 && all(led, cls('hr-t')).length === 1);
  assert.ok(!card.kids.some(cls('hr-ph')), 'the photo is not a child of the card itself');
  const sds = all(card, cls('hr-sd'));
  assert.deepEqual(sds.map((s) => s.attrs.data.side), ['jp', 'intl']);
  const heads = all(card, (n) => n.tag === 'span' && n.attrs.class === 't').map(text);
  assert.deepEqual(heads, ['見出し甲', '見出し乙', 'Headline C']);
  const said = text(all(card, cls('hr-body'))[0]);
  // nothing in the body that the data does not hold
  const allowed = ['国内', '海外', '2 社', '1 社', '甲新聞', '乙新聞', 'Wire', 't100', 't120', 't50', '見出し甲', '見出し乙', 'Headline C', '違い', '用語選択', '「会談」2 社・「talks」1 社', '初報差', '海外が 50分 先', '何が起きたか', '要旨の文。', 'AI', 'の要約', '・t200'];
  let rest = said; for (const a of allowed.sort((x, y) => y.length - x.length)) rest = rest.split(a).join('');
  assert.equal(rest, '', `text not from the data: ${rest}`);
  assert.equal(text(all(card, cls('hr-bias'))[0]), '偏り度44');
  assert.ok(all(card, cls('aimk')).length === 1, 'the brief is the AI\'s and says so');
});

test('the home\'s card without a brief, a photo or a bias index only leaves those out', () => {
  const made = [];
  const hh = (tag, attrs, ...kids) => { const el = h(tag, attrs, ...kids); made.push(el); return el; };
  const hero = createHero({ h: hh, root: { hidden: true, replaceChildren() {} }, on: {} });
  hero.render(readHero({ schema: 'parallax-hero/1', picks: [pick()] }).picks, {});
  const card = made.find(cls('hr-card'));
  assert.equal(all(card, cls('hr-ph')).length, 0);
  assert.equal(all(card, cls('hr-brief')).length, 0);
  assert.equal(all(card, cls('hr-bias')).length, 0);
  assert.equal(all(card, cls('hr-sd')).length, 2);
  assert.equal(all(card, cls('hr-fnd')).length, 1);
});

test('the photo of the home\'s card is a thumbnail: a quarter of the row at most, never a block of the card', () => {
  assert.match(v64, /#board \.hr-card\.has-ph \.hr-led \{ grid-template-columns: clamp\(132px, 24%, 300px\) minmax\(0, 1fr\); \}/);
  assert.match(v64, /#board \.hr-ph \{ position: relative; grid-area: auto; min-height: 0; margin: 0; aspect-ratio: 4 \/ 3;/);
  assert.match(v64, /@media \(min-width: 1101px\) and \(max-height: 960px\)/, 'a low window says less instead of cutting');
});

test('詳しく見る: the middle column is as tall as the window; the news scrolls in its pane and 映像・関連・出典 stay in view', () => {
  const m = /@media \(min-width: 1101px\) \{\s*:root\[data-screen="board"\][^{]*> \.c3 \{([^}]*)\}/.exec(v64);
  assert.ok(m, 'the rule of the middle column');
  assert.match(m[1], /position: sticky; top: 0; align-self: start; height: calc\(100dvh - 96px\);/);
  assert.match(v64, /> \.c3 > #p-case > #case \{ flex: 1 1 0; min-height: 0; overflow-x: clip; overflow-y: auto;/);
  assert.match(v64, /> \.c3 > \.under \{ display: grid; flex: none; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  const app = read('js/app.js');
  assert.match(app, /const UNDER_PANES = \[\['p-tv', '映像'\], \['p-rel', '関連'\], \['p-basis', '出典・手法'\]\];/);
  assert.match(app, /h\('header', \{ class: 'ch dcard t-place' \}, place, head, tools\), photo, nav,/, 'the sections\' names stand under the headline');
  assert.match(app, /UNDER_PANES\.map\(\(\[id, ja\]\) => h\('button', \{ type: 'button', class: 'st-x'/);
  const html = read('index.html');
  for (const id of ['p-tv', 'p-rel', 'p-basis']) assert.ok(html.includes(`id="${id}"`), id);
});

// 2026-11-16, after a second look at the five remarks: the home at 1366 by 768 ran under the edge, a folded card counted its bias index on half
// the story and 詳細 opened another news, and the sections' names floated over the text as the table's row names had.
test('the home keeps to one window: the row is what the window leaves, and the card says less a step at a time', async () => {
  assert.match(v64, /#board\.board \{ grid-template-rows: auto minmax\(360px, 1fr\); \}/);
  assert.match(v64, /#board \.hr-card, [^{]*#board \.hr-card\.has-ph \{ height: 100%; min-height: 0; overflow: hidden; \}/);
  assert.match(v64, /#board > \.gap \.fr-gap \{ min-height: 0; grid-auto-rows: minmax\(30px, 1fr\); \}/);
  const { FIT_MAX } = await import('../../js/hero.js');
  for (let k = 1; k <= FIT_MAX; k++) assert.ok(v64.includes(`[data-fit="${k}"]`), `a rule for step ${k}`);
  assert.ok(!/@media \(min-width: 1101px\) and \(max-height: 830px\)/.test(v64), 'the fixed height that hid the brief is gone: the card is measured');
  // the fit itself, on a card that is 40 px too tall until three parts are left out
  const card = { dataset: {}, clientHeight: 500, get scrollHeight() { return 620 - 40 * Number(this.dataset.fit || 0); } };
  const root = { hidden: true, replaceChildren() {}, querySelector: (q) => (q === '.hr-card' ? card : null), querySelectorAll: () => [] };
  const hh = (tag, at, ...kids) => ({ tag, at, kids });
  const { createHero } = await import('../../js/hero.js');
  const hero = createHero({ h: hh, root, on: {} });
  assert.equal(hero.fit(), 3);
  assert.equal(card.dataset.fit, '3');
});

test('a card whose bundle was folded into another counts and opens the whole story; the sections\' names are an opaque band', () => {
  const app = read('js/app.js');
  assert.match(app, /function heroWhole\(p\) \{\s*const e = heroEntry\(p\);\s*return e && e\.foldedInto \? state\.byKey\.get\(e\.foldedInto\) \|\| e : e;/);
  assert.match(app, /function hxCompare\(p\) \{\s*const e = heroWhole\(p\);/);
  assert.match(app, /bias: \(p\) => \{ const e = state\.es \? heroWhole\(p\) : null;/);
  assert.ok(!app.includes('読み上げる'), '読み上げ is one name');
  assert.match(v64, /\.st-nav \{ top: 0; align-self: stretch; width: auto; max-width: none; margin: 0 -24px; padding: 8px 24px; border-radius: 0; background: var\(--v-plate\);/);
  assert.match(v64, /#case \.st-h\[data-st\] \{ scroll-margin-top: 64px; \}/);
  assert.match(v64, /\.jump \{ background: var\(--v-plate\); -webkit-backdrop-filter: none; backdrop-filter: none; \}/);
});
