import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from './helpers.js';
import { relationsOf, relatedOf, groupOf, sameOf, whyParts, sameSummary, ageOf, SCHEMA } from '../../js/relations.js';

const raw = readJson('tests', 'fixtures', 'relations.sample.json');

test('the sample reads, and a broken or other file gives null', () => {
  const r = relationsOf(raw);
  assert.ok(r);
  assert.equal(r.method.ai, false);
  assert.ok(r.nodes.length >= 5 && r.edges.length >= 3);
  for (const bad of [null, 3, 'x', [], {}, { ...raw, schema: 'parallax-relations/2' }]) assert.equal(relationsOf(bad), null);
  assert.equal(SCHEMA, 'parallax-relations/1');
});

test('relatedOf gives the heaviest first, and edges to unknown nodes are dropped', () => {
  const broken = { ...raw, edges: [...raw.edges, { a: raw.nodes[0].sid, b: 'snot-a-node', w: 0.9, why: {} }, { a: 'x', b: 'y', w: 'z' }] };
  const r = relationsOf(broken);
  const rel = relatedOf(r, 's1000000000a1');
  assert.ok(rel.length >= 2);
  assert.ok(rel.every((x, i) => i === 0 || rel[i - 1].w >= x.w));
  assert.ok(!rel.some((x) => x.sid === 'snot-a-node'));
  assert.ok(rel[0].why.words.includes('国防長官'));
  assert.deepEqual(relatedOf(r, 'sunknown00'), []);
  assert.deepEqual(relatedOf(null, 's1000000000a1'), []);
});

test('groups are three or more and are found by a member', () => {
  const r = relationsOf(raw);
  const g = groupOf(r, 's8000000000h8');
  assert.ok(g && g.sids.length >= 3);
  assert.equal(groupOf(r, 's2000000000b2'), null);
});

test('sameOf by sid, and by the rule clusters for a page regrouped with the visitor key', () => {
  const r = relationsOf(raw);
  assert.equal(sameOf(r, 's5600000000e5').by, 'ai');
  const cids = raw.same.s5600000000e5.rule_cids;
  assert.equal(sameOf(r, 'sbyok0000001', [...cids, 'cother']).by, 'ai');
  assert.equal(sameOf(r, 'sbyok0000001', ['cnothing']), null);
  assert.equal(sameOf(r, 'sbyok0000001'), null);
});

test('sameSummary says rule or AI with the model, and keeps an empty match empty', () => {
  const r = relationsOf(raw);
  const s = sameSummary(sameOf(r, 's5600000000e5'));
  assert.equal(s.byJa, 'AI');
  assert.equal(s.model, 'fake-model-1');
  assert.ok(s.links.length <= 2);
  assert.equal(s.noRuleMatch, false);
  const none = { a: 'x1', b: 'x2', sim: 0.1, words: [], places: [], aliases: [], nums: [] };
  const empty = relationsOf({ ...raw, same: { s5600000000e5: { ...raw.same.s5600000000e5, ai_joined: [{ cids: ['ca', 'cb'], best: none }] } } });
  assert.equal(sameSummary(sameOf(empty, 's5600000000e5')).noRuleMatch, true);
  assert.equal(sameSummary(sameOf(r, 's1000000000a1')).byJa, '規則');
  assert.equal(sameSummary(null), null);
});

test('whyParts lists only what is there, in a fixed order', () => {
  assert.deepEqual(whyParts({ words: ['弾劾'], places: ['US'], aliases: [['ヘグセス', 'Hegseth']], nums: [], lineage: true }).map((p) => p.k), ['words', 'aliases', 'places', 'lineage']);
  assert.deepEqual(whyParts({ aliases: [['a', 'b']] })[0].v, ['a＝b']);
  assert.deepEqual(whyParts(null), []);
});

test('ageOf is red after six hours, and with no time', () => {
  assert.equal(ageOf(1000, 1000 + 5 * 3600).stale, false);
  assert.equal(ageOf(1000, 1000 + 7 * 3600).stale, true);
  assert.equal(ageOf(null, 1).stale, true);
});
