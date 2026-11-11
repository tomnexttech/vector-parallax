import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJson, clone } from './helpers.js';
import { impactOf, impactFor, quietList, quietText, docsOf, LABEL, SCHEMA } from '../../js/impact.js';

const raw = readJson('tests', 'fixtures', 'impact.sample.json');

test('the sample reads, with the areas named and the hit words as the reason', () => {
  const imp = impactOf(raw);
  assert.ok(imp);
  assert.equal(SCHEMA, 'parallax-impact/1');
  assert.equal(LABEL, '暮らし');
  const e = impactFor(imp, 's4000000000d4');
  assert.deepEqual(e.areas, [{ id: 'care', ja: '医療・介護' }]);
  assert.ok(e.hits.includes('介護報酬'));
  assert.equal(e.stage, '意見募集');
  for (const bad of [null, {}, { ...raw, schema: 'x' }]) assert.equal(impactOf(bad), null);
});

test('quiet only with a primary document and at most one mainstream headline, and the words say only the count', () => {
  const x = clone(raw);
  x.events.s3000000000c3.quiet = true;                     // a quiet mark without a primary document does not pass
  const imp = impactOf(x);
  assert.deepEqual(quietList(imp), ['s4000000000d4']);
  assert.equal(quietText(impactFor(imp, 's4000000000d4')), '主要な媒体の見出し 0 社');
  assert.doesNotMatch(quietText(impactFor(imp, 's4000000000d4')), /隠|報じ/);
});

test('a label without its reason words or with an unknown area is dropped', () => {
  const x = clone(raw);
  x.events.s3000000000c3.hits = [];
  x.events.s4000000000d4.areas = ['nope'];
  const imp = impactOf(x);
  assert.equal(impactFor(imp, 's3000000000c3'), null);
  assert.equal(impactFor(imp, 's4000000000d4'), null);
});

test('documents are https only and can be narrowed by area', () => {
  const x = clone(raw);
  x.docs.push({ kind: 'bill', title: 't', url: 'http://plain.test/', areas: ['tax'], hits: ['x'] });
  const imp = impactOf(x);
  assert.ok(imp.docs.every((d) => d.url.startsWith('https://')));
  assert.deepEqual(docsOf(imp, { area: 'care' }).map((d) => d.kind), ['pubcomment']);
  assert.equal(docsOf(imp).length, raw.docs.length);
});
