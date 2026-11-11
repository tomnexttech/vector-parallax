// The home's first card read without a word of explanation (the review of 11-11, ten points): what the card and its sheets draw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { phrasesOf, dotsOf, leadOf, createHero } from '../../js/hero.js';
import { ORDER_JA } from '../../js/bubble.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

const cov = {
  outlets: [{ name: 'A', side: 'jp' }, { name: 'B', side: 'jp' }, { name: 'C', side: 'jp' }, { name: 'X', side: 'intl' }, { name: 'Y', side: 'intl' }],
  rows: [
    { t: '人数', k: 'num', c: [{ p: '死者12人に', k: '12人' }, null, null, null, null] },
    { t: 'いつ', k: 'when', c: [null, null, null, { p: 'on Monday', k: 'Monday' }, null] },
    { t: '協議', k: 'w1', c: [{ p: '3カ国協議', k: '協議' }, null, null, { p: 'three-way talks', k: 'talks' }, null] },
  ],
  words: [{ t: '話し合いの言い方', v: [{ w: '協議', o: [0, 1, 3] }, { w: '交渉', o: [4] }] }],
};

test('2: a column quotes a headline of that side, the name of the point kept small before it', () => {
  assert.deepEqual(phrasesOf(cov, 'jp', ['人数']), [{ name: '人数', phrase: '死者12人に', outlet: 'A' }]);
  assert.deepEqual(phrasesOf(cov, 'intl', ['時期']), [{ name: '時期', phrase: 'on Monday', outlet: 'X' }]);
  assert.equal(phrasesOf(cov, 'both', ['協議'])[0].phrase, '3カ国協議');
  // no table on the page (the small file came first): the name alone, nothing made up
  assert.deepEqual(phrasesOf(null, 'jp', ['人数']), [{ name: '人数', phrase: '', outlet: '' }]);
  assert.deepEqual(phrasesOf(cov, 'jp', ['無い行']), [{ name: '無い行', phrase: '', outlet: '' }]);
});

test('3: a finding is one dot an outlet, from the sentence the build wrote when the table is not there', () => {
  const f = { kind: 'only_side', row: null, side: null, outlets: [], others: [], text: '理由は国内 1 社・海外 1 社が載せ、国内 4 社・海外 2 社の見出しと要旨には出ていない' };
  assert.deepEqual(dotsOf(f, null), { label: '理由', sets: [{ word: '', groups: [{ side: 'jp', on: 1, off: 4 }, { side: 'intl', on: 1, off: 2 }] }] });
  const g = { kind: 'only_side', row: null, side: 'intl', outlets: [], others: [], text: '「いつ」は海外 3 社が載せ、国内 5 社の見出しと要旨には出ていない' };
  assert.deepEqual(dotsOf(g, null), { label: '時期', sets: [{ word: '', groups: [{ side: 'jp', on: 0, off: 5 }, { side: 'intl', on: 3, off: 0 }] }] });
  // with the table: the outlets the finding names, by their side
  const t = { kind: 'only_side', row: 'when', side: 'intl', outlets: [3], others: [0, 1, 2], text: '時期は海外 1 社が載せ、国内 3 社の見出しと要旨には出ていない' };
  assert.deepEqual(dotsOf(t, cov).sets[0].groups, [{ side: 'jp', on: 0, off: 3 }, { side: 'intl', on: 1, off: 0 }]);
  assert.equal(dotsOf(t, cov).label, '時期');
  const w = { kind: 'word_choice', outlets: [], others: [], text: '話し合いの言い方：「協議」3 社・「交渉」1 社' };
  assert.deepEqual(dotsOf(w, cov), { label: '話し合いの言い方', sets: [{ word: '協議', groups: [{ side: 'jp', on: 2, off: 0 }, { side: 'intl', on: 1, off: 0 }] }, { word: '交渉', groups: [{ side: 'intl', on: 1, off: 0 }] }] });
  assert.equal(dotsOf({ kind: 'first_gap', text: '国内が海外より 1 時間早く報じた', outlets: [], others: [] }, null), null);
});

test('10: an AI title gives way to an outlet\'s own headline; the AI sentence is kept for below', () => {
  const p = { title: { text: 'AI の一文', outlet: 'B', lang: 'ja', ai: true }, heads: [{ side: 'jp', outlet: 'A', title: '見出しA' }, { side: 'intl', outlet: 'B', title: 'Headline B' }] };
  assert.deepEqual(leadOf(p), { text: 'Headline B', lang: 'en', outlet: 'B', ai: 'AI の一文' });
  assert.deepEqual(leadOf({ title: { text: '元の見出し', outlet: 'A', lang: 'ja', ai: false }, heads: [] }), { text: '元の見出し', lang: 'ja', outlet: 'A', ai: '' });
});

function drawn(picks) {
  const made = [];
  const h = (tag, attrs, ...kids) => { const el = { tag, attrs: attrs || {}, kids: kids.flat(4).filter((k) => k != null && k !== false) }; made.push(el); return el; };
  const hero = createHero({ h, root: { hidden: true, replaceChildren() {} }, fmt: { short: () => '11/11 19:22' } });
  hero.render(picks, { gen: 1, now: 2 });
  return { made, hero };
}
const side = (n) => ({ n, outlets: n, first_ts: null });
const pick = (sid) => ({ sid, tier: 'split', title: { text: 'T', outlet: 'A', lang: 'ja', ai: false }, sides: { jp: side(3), intl: side(2), gov: side(0) },
  points: { jp: ['人数'], intl: [], both: ['協議'] }, cov,
  findings: [{ kind: 'only_side', row: null, side: null, outlets: [], others: [], text: '理由は国内 1 社・海外 1 社が載せ、国内 2 社・海外 1 社の見出しと要旨には出ていない' }], heads: [], same: null, reaction: null, key: sid });

test('3, 10: the card folds each finding under its dots, and steps through the five beside its headline', () => {
  const { made } = drawn([pick('a'), pick('b'), pick('c')]);
  const sum = made.find((e) => e.tag === 'summary');
  assert.ok(sum, 'a finding opens on a press');
  const dots = made.filter((e) => e.tag === 'i' && /^(on|off)$/.test(e.attrs.class));
  assert.equal(dots.filter((d) => d.attrs.class === 'on').length, 2);
  assert.equal(dots.filter((d) => d.attrs.class === 'off').length, 3);
  const head = made.find((e) => /hr-head-nav/.test(e.attrs.class || ''));
  assert.deepEqual(head.kids.map((k) => k.tag), ['button', 'h2', 'button'], '‹ headline ›');
  assert.ok(!made.some((e) => e.tag === 'nav'), 'no row of steps under the buttons');
  assert.ok(made.some((e) => e.attrs.class === 'hr-pos num' && e.attrs.text === '1 / 3'));
  const card = made.find((e) => e.attrs.class === 'hr-card');
  assert.equal(typeof card.attrs.on.pointerup, 'function', 'the card is swiped sideways');
  const p = made.filter((e) => e.attrs.class === 'p').map((e) => e.attrs.text);
  assert.deepEqual(p, ['死者12人に', '3カ国協議']);
});

test('4: the bar has no grey track; the white line stays the centre', () => {
  const css = read('css/app.css');
  const rule = /\.hr-half \{([^}]*)\}/.exec(css)[1];
  assert.match(rule, /background: none/);
  assert.match(css, /\.hr-bar \{ display: grid; grid-template-columns: 1fr 2px 1fr;/);
});

test('1, 7, 8, 9, 6: the first visit stays on the card; 規則; the orb is a button; the next side peeks; the order of PARALLAX', () => {
  const app = read('js/app.js');
  assert.doesNotMatch(app, /wantTour\(store, location\.search\)\) \{ setUi\('simple'\); state\.tour\.open\(\); \}/, 'the first visit does not open the tour over 比べる');
  assert.match(app, /wantTour\(store, location\.search\)\) \{ markTour\(store\); HX\.cueWanted = true;/);
  assert.match(app, /onEnd: \(\) => \{ if \(state\.ui === 'simple'\) setUi\('full'\); setHome\('home'\);/, 'the tour ends on the home');
  assert.match(read('index.html'), /id="v-rules" aria-pressed="false">規則</);
  assert.match(app, /const stage = h\('button', \{ type: 'button', class: 'hr-stage'/);
  assert.match(read('css/app.css'), /\.fl-side \{ flex: 0 0 min\(calc\(100% - 28px\), 560px\);/);
  assert.equal(ORDER_JA.all, 'PARALLAX');
  assert.match(app, /pop && hbOf\(e, HX\.reaction\)/, 'the bookmarks beside a row of 人気順');
  assert.doesNotMatch(app, /規則では一致が見つからない|規則の束 /, '5: the sheet speaks no inside words');
  assert.match(app, /AI が足したつながり/);
});
