// node --test tests/js/settings.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings, cleanSettings, defaults, exportSettings, importSettings, addTerm, removeTerm, hiddenBy, reasonJa,
  SETTINGS_KEY, SETTINGS_SCHEMA, MUTE_WORDS, WORD_LEN, PANES } from '../../js/settings.js';
import { STATIONS, stationFor, embedSrc } from '../../js/tv.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const ev = (o = {}) => ({ titles: ['日銀が金利を据え置き'], members: [{ names: ['NHK'], type: '公共放送' }], field: '経済', cover: 'jp', ...o });

test('defaults: everything shown, video muted and playing by itself, the system decides motion', () => {
  const d = defaults();
  assert.deepEqual(d.tv.order, STATIONS.map((x) => x.id));
  assert.equal(d.tv.auto, true); assert.equal(d.tv.sound, false);
  assert.equal(d.motion.calm, 'system');
  assert.deepEqual(d.mute, { words: [], outlets: [] });
  assert.deepEqual(d.panes.off, []);
  assert.deepEqual(cleanSettings(null), d);
});

test('saved only in the given storage and read back; broken or missing storage gives the defaults and does not throw', () => {
  const s = mem();
  const x = defaults(); x.mute.words = ['北朝鮮']; x.tv.sound = true; x.panes.off = ['mkt'];
  assert.equal(saveSettings(s, x), true);
  assert.deepEqual(loadSettings(s), x);
  s.setItem(SETTINGS_KEY, '{not json');
  assert.deepEqual(loadSettings(s), defaults());
  const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadSettings(bad), defaults());
  assert.equal(saveSettings(bad, x), false);
  assert.deepEqual(loadSettings(null), defaults());
  assert.equal(saveSettings(null, x), false);
});

test('a damaged file falls back field by field', () => {
  const c = cleanSettings({
    tv: { auto: 'yes', sound: 1, order: ['dw', 'nope', 'dw', 'ann'], off: ['sky', 'zzz'] },
    news: { scope: 'mars', view: 'rules', lang: 'en', types_off: ['週刊誌・タブロイド', 3, '週刊誌・タブロイド'], fields_off: 'x' },
    mute: { words: ['  台湾 ', '台湾', 'ＢＯＪ', 'boj', 5, 'x'.repeat(99)], outlets: null },
    motion: { cases: false, scroll: 'no', calm: 'loud' },
    panes: { off: ['map', 'case', 'pri', 'mkt'] },
    extra: { anything: 1 },
  });
  assert.equal(c.tv.auto, true); assert.equal(c.tv.sound, false);
  assert.deepEqual(c.tv.order.slice(0, 2), ['dw', 'ann']);
  assert.equal(c.tv.order.length, STATIONS.length);
  assert.deepEqual(c.tv.off, ['sky']);
  assert.equal(c.news.scope, 'all'); assert.equal(c.news.view, 'rules'); assert.equal(c.news.lang, 'en');
  assert.deepEqual(c.news.types_off, ['週刊誌・タブロイド']); assert.deepEqual(c.news.fields_off, []);
  assert.deepEqual(c.mute.words.slice(0, 2), ['台湾', 'ＢＯＪ']);
  assert.equal(c.mute.words[2].length, WORD_LEN);
  assert.deepEqual(c.mute.outlets, []);
  assert.deepEqual(c.motion, { cases: false, scroll: true, calm: 'system' });
  assert.deepEqual(c.panes.off, ['map', 'mkt'], 'the event and the priority list cannot be turned off');
  assert.ok(!('extra' in c));
  assert.ok(PANES.every(([id]) => id !== 'case' && id !== 'pri'));
});

test('muted words: trimmed, folded (width and case), no duplicates, capped', () => {
  let l = addTerm([], '  北朝鮮 ');
  l = addTerm(l, '北朝鮮'); l = addTerm(l, 'ＢＯＪ'); l = addTerm(l, 'boj');
  assert.deepEqual(l, ['北朝鮮', 'ＢＯＪ']);
  let many = [];
  for (let i = 0; i < 40; i++) many = addTerm(many, 'w' + i);
  assert.equal(many.length, MUTE_WORDS);
  assert.deepEqual(removeTerm(['ＢＯＪ', 'x'], 'boj'), ['x']);
});

test('export and import keep the settings and the watched words; a foreign or broken file is refused', () => {
  const x = defaults(); x.mute.outlets = ['夕刊フジ']; x.news.scope = 'intl';
  const text = exportSettings(x, ['台湾', '台湾']);
  const j = JSON.parse(text);
  assert.equal(j.schema, SETTINGS_SCHEMA);
  assert.deepEqual(j.watch, ['台湾']);
  const r = importSettings(text);
  assert.equal(r.ok, true); assert.deepEqual(r.settings, x); assert.deepEqual(r.watch, ['台湾']);
  assert.deepEqual(importSettings('{nope'), { ok: false, error: 'json' });
  assert.deepEqual(importSettings('[1,2]'), { ok: false, error: 'shape' });
  assert.deepEqual(importSettings('{"name":"other app"}'), { ok: false, error: 'shape' });
  assert.equal(importSettings('x'.repeat(300000)).error, 'big');
  assert.equal(importSettings(null).ok, false);
  const bare = importSettings('{"mute":{"words":["円安"]}}');
  assert.equal(bare.ok, true); assert.deepEqual(bare.settings.mute.words, ['円安']); assert.equal(bare.watch, null);
});

test('hiddenBy: a word in any headline, folded', () => {
  const s = defaults(); s.mute.words = ['ｂｏｊ'];
  assert.deepEqual(hiddenBy(s, ev({ titles: ['BOJ holds rates', '日銀'] })), { k: 'word', v: 'ｂｏｊ' });
  assert.equal(hiddenBy(s, ev()), null);
  assert.equal(hiddenBy(defaults(), ev()), null, 'nothing is hidden by default');
});

test('hiddenBy: an outlet or a type hides an event only when every report is from it', () => {
  const s = defaults(); s.mute.outlets = ['夕刊フジ'];
  const one = ev({ members: [{ names: ['夕刊フジ'], type: '週刊誌・タブロイド' }] });
  const two = ev({ members: [{ names: ['夕刊フジ'], type: '週刊誌・タブロイド' }, { names: ['共同通信'], type: '通信社' }] });
  assert.deepEqual(hiddenBy(s, one), { k: 'outlet', v: '夕刊フジ' });
  assert.equal(hiddenBy(s, two), null, 'another outlet reported it: it stays');
  const viaMedia = ev({ members: [{ names: ['Google News', '夕刊フジ'], type: '集約' }] });
  assert.deepEqual(hiddenBy(s, viaMedia), { k: 'outlet', v: '夕刊フジ' });
  const t = defaults(); t.news.types_off = ['週刊誌・タブロイド'];
  assert.deepEqual(hiddenBy(t, one), { k: 'type', v: '週刊誌・タブロイド' });
  assert.equal(hiddenBy(t, two), null);
  const both = defaults(); both.news.types_off = ['通信社']; both.mute.outlets = ['夕刊フジ'];
  assert.deepEqual(hiddenBy(both, two), { k: 'type', v: '通信社' });
  assert.equal(hiddenBy(t, ev({ members: [] })), null);
});

test('hiddenBy: field and scope; an event reported at home and abroad always stays', () => {
  const s = defaults(); s.news.fields_off = ['経済'];
  assert.deepEqual(hiddenBy(s, ev()), { k: 'field', v: '経済' });
  const jp = defaults(); jp.news.scope = 'jp';
  assert.deepEqual(hiddenBy(jp, ev({ cover: 'intl' })), { k: 'scope', v: 'intl' });
  assert.equal(hiddenBy(jp, ev({ cover: 'both' })), null);
  const intl = defaults(); intl.news.scope = 'intl';
  assert.deepEqual(hiddenBy(intl, ev()), { k: 'scope', v: 'jp' });
  assert.equal(hiddenBy(intl, ev({ cover: 'both' })), null);
  assert.equal(reasonJa({ k: 'word', v: '円安' }), '語「円安」');
  assert.equal(reasonJa({ k: 'scope', v: 'intl' }), '海外の出来事');
});

test('the counts of what is hidden add up', () => {
  const s = defaults(); s.mute.words = ['円安']; s.news.fields_off = ['国際'];
  const es = [ev({ titles: ['円安が進む'] }), ev(), ev({ field: '国際' }), ev({ titles: ['円安'], field: '国際' })];
  const by = {};
  for (const e of es) { const r = hiddenBy(s, e); if (r) by[r.k] = (by[r.k] || 0) + 1; }
  assert.deepEqual(by, { word: 2, field: 1 });
});

test('video: the settings decide autoplay and sound; the channel is chosen among those shown', () => {
  const st = STATIONS[0];
  assert.match(embedSrc(st), /autoplay=1&mute=1/);
  assert.match(embedSrc(st, { auto: false, sound: true }), /autoplay=0&mute=0/);
  const intl = STATIONS.filter((x) => x.home === 'intl');
  assert.equal(stationFor(['TBS'], 'jp').id, 'tbs');
  assert.equal(stationFor(['TBS'], 'jp', intl).home, 'intl', 'a channel turned off is not chosen');
  assert.equal(stationFor([], 'intl', intl.filter((x) => x.id !== 'aje')).home, 'intl');
  assert.equal(stationFor([], 'jp', []).id, 'ann', 'an empty list falls back to the full one');
});

test('the appearance is dark or light, dark unless chosen; anything else (the old system too) is dark', () => {
  assert.equal(defaults().look.theme, 'dark');
  assert.equal(cleanSettings({ look: { theme: 'system' } }).look.theme, 'dark');
  assert.equal(cleanSettings({ look: { theme: 'light' } }).look.theme, 'light');
  assert.equal(cleanSettings({ look: { theme: 'dark' } }).look.theme, 'dark');
  assert.equal(cleanSettings({ look: { theme: 'neon' } }).look.theme, 'dark');
  assert.equal(cleanSettings({ look: 'light' }).look.theme, 'dark');
  assert.equal(loadSettings(null).look.theme, 'dark');
});
