import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJson, clone } from './helpers.js';
import { reactionOf, eventReaction, itemBookmarks, sourceLines, SCHEMA } from '../../js/reaction.js';

const raw = readJson('tests', 'fixtures', 'reaction.sample.json');
const NOW = raw.generated_at;

test('the sample reads with every source and its time', () => {
  const r = reactionOf(raw);
  assert.ok(r);
  assert.equal(SCHEMA, 'parallax-reaction/1');
  assert.deepEqual(sourceLines(r).map((s) => s.id), ['hatena', 'youtube', 'wikipedia']);
  assert.equal(r.sources.hatena.ok, true);
  assert.equal(r.sources.hatena.at, NOW);
  assert.equal(r.notUsed.length, 3);
  for (const bad of [null, [], {}, { ...raw, schema: 'x' }]) assert.equal(reactionOf(bad), null);
});

test('an event gives bookmarks by side with time, and old values are marked', () => {
  const r = reactionOf(raw);
  const e = eventReaction(r, 's1000000000a1', NOW);
  assert.equal(e.hb.sum, e.hb.bySide.jp + e.hb.bySide.intl + e.hb.bySide.gov);
  assert.equal(e.hb.stale, false);
  assert.equal(eventReaction(r, 's1000000000a1', NOW + 7 * 3600).hb.stale, true);
  assert.equal(e.wiki[0].views.length, 7);
  assert.equal(eventReaction(r, 'snone', NOW), null);
  const id = Object.keys(raw.items)[0];
  assert.equal(itemBookmarks(r, id), raw.items[id].hb);
  assert.equal(itemBookmarks(r, 'nope'), null);
});

test('a source that could not be read stays not ok with its reason, and broken values are not filled', () => {
  const x = clone(raw);
  x.sources.hatena = { ok: false, err: 'URLError: down', n: 0, fetched_at: null };
  x.events.s1000000000a1.hb.sum = -3;
  x.events.s1000000000a1.wiki = [{ title: 't', views: [1, 2] }];
  delete x.sources.wikipedia;
  const r = reactionOf(x);
  assert.equal(r.sources.hatena.ok, false);
  assert.match(r.sources.hatena.err, /down/);
  assert.equal(r.sources.wikipedia.ok, false);
  const e = eventReaction(r, 's1000000000a1', NOW);
  assert.ok(!e || (!e.hb && !e.wiki));
});

test('missing days stay missing in the total', () => {
  const x = clone(raw);
  x.events.s1000000000a1.wiki = [{ title: 't', lang: 'ja', views: [null, 5, null, 5, 0, null, 1], from: '2026-11-04', to: '2026-11-10' }];
  const e = eventReaction(reactionOf(x), 's1000000000a1', NOW);
  assert.deepEqual(e.wiki[0].views, [null, 5, null, 5, 0, null, 1]);
  assert.equal(e.wiki[0].total, 11);
});
