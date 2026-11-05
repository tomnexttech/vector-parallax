import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detect, vocabBurst, bannerText } from '../../js/scenes.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../../data/scenes.json', import.meta.url), 'utf8'));
const prompt = JSON.parse(fs.readFileSync(new URL('../../data/prompt.json', import.meta.url), 'utf8'));
const G = 1_800_000_000;
const clock = (t) => new Date(t * 1000).toISOString().slice(11, 16);
const ev = (o) => ({ n: 2, new6h: 0, sinceH: 30, intl: 0, lat: 35.7, lon: 139.7, flags: [], place: '東京', ...o });

test('nothing holds: calm, no banner', () => {
  const r = detect({ gen: G, now: G, events: [ev()], items: [], hz: {} }, cfg);
  assert.equal(r.id, 'calm');
  assert.equal(bannerText(cfg, r, 'auto', clock), '');
});

test('live: the first event of the list, new and fresh and wide', () => {
  const r = detect({ gen: G, now: G, events: [ev({ n: 11, new6h: 6, sinceH: 11.5 })], items: [], hz: {} }, cfg);
  assert.equal(r.id, 'live');
  assert.match(bannerText(cfg, r, 'auto', clock), /^場面 ライブ（自動） 速報 新着6件/);
});

test('world beats live: the widest event abroad, fresh, on security', () => {
  const r = detect({ gen: G, now: G, events: [ev({ n: 6, new6h: 6, sinceH: 2 }), ev({ n: 11, intl: 5, sinceH: 3, lat: 39.8, lon: -98.6, flags: ['security'], place: '米国' })], items: [], hz: {} }, cfg);
  assert.equal(r.id, 'world');
  assert.match(bannerText(cfg, r, 'auto', clock), /^場面 国際（自動） 米国・11媒体$/);
});

test('an event in Japan is never the world scene', () => {
  assert.equal(detect({ gen: G, now: G, events: [ev({ n: 11, intl: 5, sinceH: 3, flags: ['security'] })], items: [], hz: {} }, cfg).id, 'calm');
});

test('disaster beats every other scene; a quake older than 6 hours or below 5- does not switch', () => {
  const hot = { quakes_jp: [{ t: G - 600, maxint: '5+', maxint_jp: '震度5強', place: '熊本県熊本地方' }] };
  const r = detect({ gen: G, now: G, events: [ev({ n: 11, new6h: 6, sinceH: 2 })], items: [], hz: hot }, cfg);
  assert.equal(r.id, 'disaster');
  assert.match(bannerText(cfg, r, 'auto', clock), /^場面 災害（自動） 震度5強 熊本県熊本地方 /);
  assert.equal(detect({ gen: G, now: G, events: [], items: [], hz: { quakes_jp: [{ t: G - 7 * 3600, maxint: '6-' }, { t: G, maxint: '4' }] } }, cfg).id, 'calm');
});

test('the election words are counted, not judged; the excluded words do not count', () => {
  const items = Array.from({ length: 24 }, (_, i) => ({ title: i % 2 ? '衆院選の投開票' : 'US midterm election results', ts: G - 3600, outlet: `o${i % 10}` }));
  assert.deepEqual(vocabBurst(items, cfg.vocab.election, G, 6), { n: 24, outlets: 10 });
  assert.equal(vocabBurst([{ title: '内閣支持率の世論調査', ts: G, outlet: 'a' }, { title: '選挙', ts: G - 7 * 3600, outlet: 'b' }], cfg.vocab.election, G, 6).n, 0);
  const r = detect({ gen: G, now: G, events: [], items, hz: {} }, cfg);
  assert.equal(r.id, 'election');
  const b = bannerText(cfg, r, 'auto', clock);
  assert.match(b, /^場面 選挙（自動） 見出し24本・10媒体/);
  for (const w of [...prompt.silence_words.ja, ...prompt.silence_words.en]) assert.ok(!b.includes(w), w);
});
