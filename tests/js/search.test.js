import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, aliasGroups, expand, matcherOf, narrow, archiveHits, archiveDays, toHash, fromHash, F0, reactionScore, sidOf } from '../../js/search.js';

// the alias table in the shape data/aliases.json is read in (docs/app.md); a few rows only
const ALIASES = { schema: 'parallax-aliases/1', groups: [['米国', 'アメリカ', '米', 'US'], ['エヌビディア', 'Nvidia', 'NVIDIA'], ['国防長官', '国防相']] };
const G = aliasGroups(ALIASES);
const ev = (key, hay, places = [], more = {}) => ({ key, hay, places, n: 3, last: 1000, members: [], ...more });
const EVENTS = [
  ev('us', 'トランプ氏 上下両院で多数派奪還ならず', ['US']),
  ev('nv', 'Nvidia shares fall after export rule'),
  ev('nvj', 'エヌビディア株が下落'),
  ev('biz', 'Business outlook for the focus group'),
  ev('jp', '日本の物価が上昇', ['JP']),
];
const hitKeys = (q, off = []) => { const x = expand(q, { groups: G, off }); const m = matcherOf(x, off); return EVENTS.filter(m).map((e) => e.key).sort(); };

test('fold: width, case, hiragana, the long-vowel mark and the middle dot do not matter', () => {
  assert.equal(fold('えぬびでぃあ'), fold('エヌビディア'));
  assert.equal(fold('ＮＶＩＤＩＡ'), 'nvidia');
  assert.equal(fold('コンピューター'), fold('コンピュータ'));
  assert.equal(fold('ドナルド・トランプ'), fold('ドナルドトランプ'));
  assert.equal(fold('ｶﾀｶﾅ'), fold('カタカナ'));
});

test('「アメリカ」「米国」「US」find the same news', () => {
  const a = hitKeys('アメリカ'), b = hitKeys('米国'), c = hitKeys('US');
  assert.deepEqual(a, ['us']);
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
});

test('「えぬびでぃあ」finds the news written エヌビディア and Nvidia', () => {
  assert.deepEqual(hitKeys('えぬびでぃあ'), ['nv', 'nvj']);
  assert.deepEqual(hitKeys('nvidia'), ['nv', 'nvj']);
});

test('a short Latin word matches as a word only: "US" is not inside "business" or "focus"', () => {
  assert.ok(!hitKeys('US').includes('biz'));
});

test('the added ways are chips; a chip taken away is not searched', () => {
  const x = expand('エヌビディア', { groups: G });
  assert.deepEqual(x.chips.map((c) => c.text), ['Nvidia'], 'NVIDIA is the same word folded: one chip');
  assert.ok(x.chips.every((c) => c.on));
  assert.deepEqual(hitKeys('エヌビディア', ['Nvidia']), ['nvj']);
  const off = expand('エヌビディア', { groups: G, off: ['Nvidia'] });
  assert.equal(off.chips.find((c) => c.text === 'Nvidia').on, false);
});

test('every word of the query must match', () => {
  assert.deepEqual(hitKeys('トランプ 米国'), ['us']);
  assert.deepEqual(hitKeys('トランプ エヌビディア'), []);
});

test('the alias table: three shapes are read, a damaged entry is left out', () => {
  assert.deepEqual(aliasGroups([['a', 'b'], ['x'], 'bad', [1, 2]]), [['a', 'b']]);
  assert.deepEqual(aliasGroups({ 米国: ['アメリカ'], schema: 'x' }), [['米国', 'アメリカ']]);
  assert.deepEqual(aliasGroups(null), []);
});

const SIDE = { a: { jp: 2, intl: 0 }, b: { jp: 1, intl: 3 }, c: { jp: 0, intl: 2 } };
const LIST = [
  { key: 'a', case: { sid: 'saaaaaaaaaaaa' }, n: 5, last: 990, field: '経済', members: [] },
  { key: 'b', case: { sid: 'sbbbbbbbbbbbb' }, n: 9, last: 900, field: '国際', members: [] },
  { key: 'c', case: { sid: 'scccccccccccc' }, n: 2, last: 100, field: '国際', members: [] },
];
const ctx = (more = {}) => ({ now: 1000, sideN: (e, k) => (SIDE[e.key][k] || 0), ...more });

test('narrow: span, field, one side only, wrapping searchOf', () => {
  assert.deepEqual(narrow(LIST, F0, ctx()).map((e) => e.key), ['b', 'a', 'c']);
  assert.deepEqual(narrow(LIST, { ...F0, span: '6h' }, ctx({ now: 1000 + 6 * 3600 - 500 })).map((e) => e.key), ['b', 'a']);
  assert.deepEqual(narrow(LIST, { ...F0, field: '国際' }, ctx()).map((e) => e.key), ['b', 'c']);
  assert.deepEqual(narrow(LIST, { ...F0, only: true }, ctx()).map((e) => e.key), ['a', 'c']);
  assert.deepEqual(narrow(LIST, { ...F0, side: 'intl', only: true }, ctx()).map((e) => e.key), ['c']);
});

test('narrow: the life label and the reaction order only work with their files', () => {
  const impact = { schema: 'parallax-impact/1', events: { scccccccccccc: { areas: ['tax'], hits: ['社会保険料'] } } };
  const reaction = { schema: 'parallax-reaction/1', events: { saaaaaaaaaaaa: { hb: { sum: 40 } }, scccccccccccc: { hb: { sum: 90 }, yt: { views: 10 } } } };
  assert.deepEqual(narrow(LIST, { ...F0, life: true }, ctx({ impact })).map((e) => e.key), ['c']);
  assert.deepEqual(narrow(LIST, { ...F0, life: true }, ctx()).map((e) => e.key), ['b', 'a', 'c'], 'no impact.json: the label narrows nothing');
  assert.deepEqual(narrow(LIST, { ...F0, sort: 'react' }, ctx({ reaction })).map((e) => e.key), ['c', 'a', 'b']);
  assert.deepEqual(narrow(LIST, { ...F0, sort: 'react' }, ctx()).map((e) => e.key), ['b', 'a', 'c'], 'no reaction.json: the order stays');
  assert.deepEqual(reactionScore(reaction, 'sbbbbbbbbbbbb'), null);
  assert.equal(sidOf({ obj: { sid: 'sx' } }), 'sx');
});

// the seven days of data/archive (CONTRACT 21.3)
const DAY = (date, events) => ({ schema: 'parallax-archive-day/1', date, updated_at: 0, top: [], events, alias: {} });
const EN = (sid, title, last, heads = []) => ({ sid, title, outlet: 'NHK', n_outlets: 3, side_outlets: { jp: 2, intl: 1, gov: 0 }, last_ts: last, heads });

test('seven days: the past days that match, the newest copy of each, links by sid', () => {
  const days = [
    DAY('2026-11-10', [EN('s111111111111', 'エヌビディア決算', 500), EN('s222222222222', '物価', 400)]),
    DAY('2026-11-09', [EN('s111111111111', 'エヌビディア決算 速報', 300), EN('s333333333333', 'Chips', 200, [{ title: 'Nvidia chips to China' }]), { sid: 'bad', title: 'エヌビディア' }]),
    { schema: 'other', events: [EN('s444444444444', 'エヌビディア', 9)] },
  ];
  const x = expand('えぬびでぃあ', { groups: G });
  const hits = archiveHits(days, x);
  assert.deepEqual(hits.map((h) => [h.sid, h.date]), [['s111111111111', '2026-11-10'], ['s333333333333', '2026-11-09']]);
  assert.deepEqual(archiveHits(days, x, [], { skip: new Set(['s111111111111']) }).map((h) => h.sid), ['s333333333333']);
  assert.deepEqual(archiveHits(days, expand('アメリカ', { groups: G })), []);
  assert.deepEqual(archiveDays({ schema: 'parallax-archive/1', days: [{ date: '2026-11-10' }, { date: 'x' }, { date: '2026-11-09' }] }), ['2026-11-10', '2026-11-09']);
  assert.deepEqual(archiveDays(null), []);
});

test('the address of a search: words and choices only, read back the same; anything else is dropped', () => {
  const f = { ...F0, side: 'intl', span: '7d', only: true, field: '国際' };
  const h = toHash('エヌビディア 決算', f, ['NVIDIA']);
  assert.match(h, /^#q=/);
  assert.ok(!/@/.test(h));
  assert.deepEqual(fromHash(h), { q: 'エヌビディア 決算', f: { ...f, outlet: '' }, off: ['NVIDIA'] });
  assert.deepEqual(fromHash('#q=x&side=evil&sort=drop&span=99y').f, { ...F0 });
  assert.equal(fromHash('#news'), null);
  assert.equal(fromHash('#q='), null);
  assert.equal(fromHash('#q=' + 'あ'.repeat(200)).q.length, 80);
});
