// The three branches read each other's files: the data branch's samples go through the readers of the first card (hero.js),
// the orders (bubble.js), the search (search.js) and the ties (netview.js). A change of shape on one side fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from './helpers.js';
import { readHero } from '../../js/hero.js';
import { hbOf, available } from '../../js/bubble.js';
import { hasReaction, hasLife, reactionScore, lifeOf, aliasGroups, expand } from '../../js/search.js';
import { graphOf, tiesOf } from '../../js/netview.js';
import { relationsOf, relatedOf } from '../../js/relations.js';

const rel = readJson('tests', 'fixtures', 'relations.sample.json');
const rea = readJson('tests', 'fixtures', 'reaction.sample.json');
const imp = readJson('tests', 'fixtures', 'impact.sample.json');
const hero = readJson('tests', 'fixtures', 'hero.sample.json');
const aliases = readJson('data', 'aliases.json');

test('the first card reads the hero file the build writes', () => {
  const h = readHero(hero);
  assert.ok(h && h.picks.length >= 1);
  assert.ok(h.picks.every((p) => p.sid && ['split', 'both', 'one_side'].includes(p.tier)));
});

test('the ties of the figure are the ties of relations.json, the same as its own reader finds', () => {
  const g = graphOf(rel);
  const r = relationsOf(rel);
  assert.ok(g && r);
  assert.equal(g.edges.length, r.edges.length);
  const sid = rel.edges[0].a;
  assert.equal(tiesOf(g, sid).length, relatedOf(r, sid, 99).length);
});

test('reaction and daily life are offered when the build has them', () => {
  assert.ok(hasReaction(rea));
  assert.ok(hasLife(imp));
  const sid = Object.keys(rea.events)[0];
  assert.ok(reactionScore(rea, sid));
  assert.ok(hbOf({ sid, case: { sid }, members: [] }, rea) > 0);
  assert.ok(available({ reaction: rea, reads: null }).includes('popular'));
  const life = Object.keys(imp.events).find((k) => imp.events[k].areas.length);
  assert.ok(lifeOf(imp, life));
});

test('the alias table of the data widens the search', () => {
  const groups = aliasGroups(aliases);
  assert.ok(groups.length >= 50);
  const x = expand('米国', { groups });
  assert.ok(JSON.stringify(x).includes('アメリカ'));
});

test('the figure of ties keeps its points off the edges and uses its room', async () => {
  const { connected, layout } = await import('../../js/netview.js');
  const g = connected(graphOf(rel));
  const pos = layout(g, { w: 900, h: 580 });
  assert.ok(pos.every((p) => p.x > 15 && p.x < 885 && p.y > 15 && p.y < 565));
});

test('a difference under its label does not repeat the label', async () => {
  const { unlabel } = await import('../../js/coverage.js');
  assert.equal(unlabel({ kind: 'lead_differs', text: '見出しの最初の語：国内は「米国」・海外は「下院」' }), '国内は「米国」・海外は「下院」');
  assert.equal(unlabel({ kind: 'only_side', text: '時期は海外 2 社が載せ、国内 3 社の見出しと要旨には出ていない' }), '時期は海外 2 社が載せ、国内 3 社の見出しと要旨には出ていない');
});
