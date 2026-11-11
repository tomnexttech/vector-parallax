import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { readHero, pickHeroes, localFindings, pointsOf, splitOf, gapText, createHero, sameFromBasis, rowName, HERO_SCHEMA, MAX_PICKS, FIRST_GAP_MIN_S } from '../../js/hero.js';
import { sides, leadPool, titleOf } from '../../js/entry.js';
import { oneSideOf } from '../../js/sections.js';
import { SILENCE_JA } from '../../js/guide.js';

const outletOf = (it) => it.media || it.outlet;
const T0 = 1794370000;
const it = (id, outlet, home, ts, title, type = home === 'intl' ? '海外主流' : '全国紙') => ({ id, outlet, home, ts, title, type, link: `https://example.org/${id}` });
const cov = {
  v: 1,
  outlets: [{ name: 'A', side: 'jp' }, { name: 'B', side: 'jp' }, { name: 'X', side: 'intl' }, { name: 'Y', side: 'intl' }],
  rows: [
    { k: 'num', t: '人数', c: [{ p: '…300人が抗議', k: '300人' }, { p: '300人', k: '300人' }, '', ''] },
    { k: 'who', t: '国防長官', c: [{ p: '国防長官', k: '国防長官' }, '', { p: 'Defense Secretary', k: '国防長官' }, ''] },
    { k: 'when', t: 'いつ', c: ['', '', { p: 'on Monday', k: 'Monday' }, ''] },
  ],
  words: [{ t: '職を離れる', v: [{ w: '罷免', o: [0, 2] }, { w: '辞任', o: [1] }] }],
};
function ev(key, members, extra = {}) {
  return { key, kind: 'story', obj: { sid: key.replace('st-', '') }, members, titled: members, ids: members.map((m) => m.id), n: new Set(members.map(outletOf)).size,
    last: Math.max(...members.map((m) => m.ts)), first: Math.min(...members.map((m) => m.ts)), heading: { text: members[0].title, outlet: members[0].outlet }, field: '国際', ...extra };
}
const split = ev('st-s1', [it('a', 'A', 'jp', T0, '国防長官に弾劾案 300人が抗議'), it('b', 'B', 'jp', T0 + 60, '弾劾案 300人'), it('x', 'X', 'intl', T0 + 7200, 'Impeachment of Defense Secretary'), it('y', 'Y', 'intl', T0 + 7300, 'House vote')],
  { case: { sid: 's1', coverage: cov }, basis: { by: 'ai', words: ['弾劾', '国防長官'], places: ['US'], time_span: 7300 } });
const both = ev('st-s2', [it('c', 'A', 'jp', T0, '国内の見出し'), it('z', 'X', 'intl', T0 + 30, 'Abroad headline')]);
const jpOnly = ev('st-s3', [it('d', 'A', 'jp', T0, '国内だけの話'), it('e', 'B', 'jp', T0 + 10, '国内だけの話 二社目')]);
const opt = { sidesOf: sides, outletOf, oneSideOf, leadPool, titleOf };

test('the choice: split first (both sides twice, a table, a finding), then both, then one side only; never more than five', () => {
  const p = pickHeroes([jpOnly, both, split], opt);
  assert.deepEqual(p.map((x) => [x.sid, x.tier]), [['s1', 'split'], ['s2', 'both'], ['s3', 'one_side']]);
  assert.equal(p[0].sides.jp.outlets, 2); assert.equal(p[0].sides.intl.outlets, 2);
  assert.deepEqual(p[0].points, { jp: ['人数'], intl: ['時期'], both: ['国防長官'] });
  assert.ok(p[0].heads.length === 4 && p[0].heads.every((h) => h.link && h.outlet));
  const many = Array.from({ length: 9 }, (_, i) => ev(`st-m${i}`, [it(`j${i}`, 'A', 'jp', T0 + i, `j${i}`), it(`i${i}`, 'X', 'intl', T0 + i, `i${i}`)]));
  assert.equal(pickHeroes(many, opt).length, MAX_PICKS);
});

test('a day with no candidate gives no card, and the card is not drawn (the home stays as it is)', () => {
  const lone = ev('st-s9', [it('q', 'A', 'jp', T0, 'one outlet only')]);
  assert.deepEqual(pickHeroes([], opt), []);
  assert.deepEqual(pickHeroes([lone, { ...jpOnly, hid: 'x' }, { ...both, foldedInto: 'st-s1' }], opt), []);
  const root = { hidden: true, kids: null, replaceChildren(...k) { this.kids = k; } };
  const changes = [];
  const hero = createHero({ h: () => ({}), root, on: { change: (p) => changes.push(p) } });
  hero.render([]);
  assert.equal(root.hidden, true);
  assert.deepEqual(root.kids, []);
  assert.deepEqual(changes, [null]);
});

test('the card steps through its candidates and comes back to the first', () => {
  const root = { hidden: true, replaceChildren() {} };
  const hero = createHero({ h: () => ({}), root });
  hero.render(pickHeroes([split, both, jpOnly], opt));
  assert.equal(root.hidden, false);
  assert.equal(hero.current().sid, 's1');
  hero.step(1); assert.equal(hero.current().sid, 's2');
  hero.step(-2); assert.equal(hero.current().sid, 's3');
  hero.go(0); assert.equal(hero.index(), 0);
});

test('findings made on the page: fixed sentences, counted values only, the row names as written', () => {
  const f = localFindings(cov, { jp: T0, intl: T0 + 7200 });
  assert.deepEqual(f.map((x) => x.kind), ['only_side', 'only_side', 'word_choice']);
  assert.equal(f[0].text, '人数は国内 2 社が載せ、海外 2 社の見出しと要旨には出ていない');
  assert.equal(f[1].text, '時期は海外 1 社が載せ、国内 2 社の見出しと要旨には出ていない');
  assert.equal(f[2].text, '職を離れる：「罷免」2 社・「辞任」1 社');
  assert.deepEqual(f[0].evidence[0], { o: 0, p: '…300人が抗議', k: '300人' });
  const gap = localFindings({ outlets: cov.outlets, rows: [] }, { jp: T0, intl: T0 + 5220 });
  assert.equal(gap[0].text, '国内が海外より 1 時間 27 分早く報じた');
  assert.deepEqual(localFindings({ outlets: cov.outlets, rows: [] }, { jp: T0, intl: T0 + FIRST_GAP_MIN_S - 1 }), []);
  // the board's own findings win, and an empty list there means none (nothing is made up in its place)
  assert.deepEqual(localFindings({ ...cov, findings: [] }, { jp: T0, intl: T0 + 9999 }), []);
  const own = localFindings({ ...cov, findings: [{ kind: 'num_diff', text: '人数が違う：300人（A）・200人（X）', outlets: [0], others: [2] }] }, null);
  assert.equal(own[0].kind, 'num_diff');
  for (const x of [...f, ...gap]) for (const w of SILENCE_JA) assert.ok(!x.text.includes(w), `${w} in ${x.text}`);
  for (const x of f) assert.doesNotMatch(x.text, /隠|意図/);
});

test('the rows and the bar', () => {
  assert.deepEqual(pointsOf(null), { jp: [], intl: [], both: [] });
  assert.deepEqual(pointsOf({ outlets: [{ side: 'jp' }], rows: cov.rows }), { jp: [], intl: [], both: [] }, 'one side only: nothing to set against');
  assert.equal(rowName({ t: 'いつ' }), '時期');
  assert.deepEqual(splitOf({ sides: { jp: { outlets: 5 }, intl: { outlets: 3 }, gov: { outlets: 0 } } }), { jp: 5, intl: 3, gov: 0, max: 5, wJp: 1, wIntl: 0.6 });
  assert.equal(gapText(48 * 60), '48 分');
  assert.equal(gapText(2 * 3600), '2 時間');
});

test('hero.json: its schema, each pick checked, a broken one dropped, a split card needs both sides', () => {
  assert.equal(readHero(null), null);
  assert.equal(readHero({ schema: 'parallax-hero/0', picks: [] }), null);
  const good = { sid: 's1', tier: 'split', title: { text: '見出し', outlet: 'A', lang: 'ja', ai: false }, sides: { jp: { n: 3, outlets: 2, first_ts: T0 }, intl: { n: 2, outlets: 2, first_ts: T0 + 60 }, gov: { n: 0, outlets: 0, first_ts: null } },
    points: { jp: ['人数'], intl: [], both: ['国防長官'] }, findings: [{ kind: 'only_side', text: '人数は国内 2 社が載せ、海外 2 社の見出しと要旨には出ていない', outlets: [0, 1], others: [2, 3] }, { kind: 'bogus', text: 'x' }],
    heads: [{ id: 'a', side: 'jp', outlet: 'A', ts: T0, title: 't', link: 'javascript:alert(1)' }], same: { by: 'rule', links: [{ a: 'a', b: 'x', sim: 0.5, words: ['弾劾'], dt_min: 48 }] }, reaction: null };
  const r = readHero({ schema: HERO_SCHEMA, generated_at: T0, latest_generated_at: T0 - 5, picks: [good, { ...good, sid: 's2', sides: { jp: { outlets: 2 }, intl: { outlets: 0 } } }, { tier: 'split' }] });
  assert.equal(r.picks.length, 1);
  assert.equal(r.latest_generated_at, T0 - 5);
  assert.deepEqual(r.picks[0].findings.map((f) => f.kind), ['only_side']);
  assert.equal(r.picks[0].heads[0].link, null, 'a link that is not http(s) is not kept');
  assert.equal(r.picks[0].same.links[0].dt_min, 48);
});

test('without AI: a build whose AI did not run still gives a card, its findings and the reason the headlines were put together', () => {
  const noAi = { ...split, ai: null, summary: null, basis: { by: 'rule', words: ['弾劾'], places: ['US'], time_span: 3600 } };
  const p = pickHeroes([noAi], { ...opt, sameOf: (e) => sameFromBasis(e.basis) });
  assert.equal(p[0].tier, 'split');
  assert.equal(p[0].title.ai, false);
  assert.ok(p[0].findings.length >= 1);
  assert.deepEqual([p[0].same.by, p[0].same.words, p[0].same.span_s], ['rule', ['弾劾'], 3600]);
});

test('the page: the card has its place in the home, its files are in the shell, the wiring runs before the data is fetched', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /<!-- hero:begin --><section class="hero" id="hero"[^>]* hidden><\/section><!-- hero:end -->/);
  assert.match(html, /<!-- hero:begin:tail -->[\s\S]*id="hr-layer"[\s\S]*id="hr-flow"[\s\S]*id="hr-demo"[\s\S]*id="hr-warn"[\s\S]*<!-- hero:end:tail -->/);
  const sw = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const shell = /const SHELL_HERO = (\[[^\]]*\]);/.exec(sw);
  assert.ok(shell, 'SHELL_HERO');
  const files = JSON.parse(shell[1].replace(/'/g, '"'));
  for (const f of ['js/hero.js', 'js/orb.js', 'js/guide.js', 'js/demo.js', 'js/bubble.js', 'js/swipe.js']) { assert.ok(files.includes(f), f); assert.ok(existsSync(path.join(ROOT, f)), f); }
  assert.match(sw, /const SHELL = \[\.\.\.SHELL_BASE, \.\.\.SHELL_HERO/);
  const app = readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const a = app.indexOf('// ==== hero:begin ===='), b = app.indexOf('// ==== hero:end ====');
  assert.ok(a > 0 && b > a, 'the marked region');
  for (const f of ['./hero.js', './orb.js', './guide.js', './demo.js', './bubble.js', './swipe.js']) assert.ok(app.slice(a, b).includes(f), f);
  const main = app.slice(app.indexOf('async function main()'));
  assert.ok(main.indexOf('heroWire();') > 0 && main.indexOf('heroWire();') < main.indexOf('await fetch(dp.path'), 'the wiring (and the kept edition) is in place before latest.json is fetched');
  const css = readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
  assert.ok(css.indexOf('/* ==== hero:begin ==== */') > 0 && css.indexOf('/* ==== hero:end ==== */') > css.indexOf('/* ==== hero:begin ==== */'));
  // the hero code says nothing of an outlet not reporting and asks no AI
  for (const f of ['hero.js', 'guide.js', 'bubble.js', 'swipe.js', 'demo.js', 'orb.js']) {
    const src = readFileSync(path.join(ROOT, 'js', f), 'utf8').replace(/export const SILENCE_JA = \[[^\]]*\];/, '');
    for (const w of SILENCE_JA) assert.ok(!src.includes(w), `${w} in ${f}`);
    assert.doesNotMatch(src, /generativelanguage|api\.anthropic|api\.openai|openrouter/, `${f} calls no AI`);
  }
});

test('the card on screen: one bar split at its centre, three columns, three buttons, the sides named in words', () => {
  const made = [];
  const h = (tag, attrs, ...kids) => { const el = { tag, attrs: attrs || {}, kids: kids.flat(4).filter((k) => k != null && k !== false) }; made.push(el); return el; };
  const root = { hidden: true, replaceChildren() {} };
  const seen = [];
  const hero = createHero({ h, root, fmt: { short: () => '11/11 15:13' }, on: { open: (p) => seen.push(['open', p.sid]), why: (p) => seen.push(['why', p.sid]), compare: (p) => seen.push(['compare', p.sid]) } });
  hero.render(pickHeroes([split, both], opt), { gen: T0, now: T0 + 60 });
  const text = (el) => (el && typeof el === 'object' ? (el.attrs.text != null ? String(el.attrs.text) : '') + el.kids.map(text).join('') : String(el));
  const buttons = made.filter((e) => e.tag === 'button');
  assert.deepEqual(buttons.filter((b) => /hr-b/.test(b.attrs.class)).map(text), ['元の記事', '束ねた理由', '比べる']);
  for (const b of buttons.filter((x) => /hr-b/.test(x.attrs.class))) b.attrs.on.click();
  assert.deepEqual(seen, [['open', 's1'], ['why', 's1'], ['compare', 's1']]);
  assert.deepEqual(made.filter((e) => e.tag === 'h3').map(text), ['国内だけ', '両方', '海外だけ']);
  const halves = made.filter((e) => e.attrs.class === 'hr-half');
  assert.deepEqual(halves.map((x) => x.attrs.data.side), ['jp', 'intl']);
  const sp = made.find((e) => e.attrs.class === 'hr-split');
  assert.equal(sp.attrs['aria-label'], '国内 2 社、海外 2 社');
  assert.ok(made.some((e) => e.tag === 'time' && /時点/.test(e.attrs.text)), 'the time of the data is on the card');
});
