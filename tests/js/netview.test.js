import test from 'node:test';
import assert from 'node:assert/strict';
import { graphOf, graphFromPairs, layout, tiesOf, listOf, whyText, hit, draw, radius, CAP } from '../../js/netview.js';

const sid = (i) => 's' + i.toString(16).padStart(12, '0');
function rel(n, k = 3) {
  const nodes = [], edges = [];
  for (let i = 0; i < n; i++) nodes.push({ sid: sid(i), cat: '国際', n_outlets: 1 + (i % 9), sides: { jp: i % 3, intl: i % 2, gov: 0 }, terms: [] });
  for (let i = 0; i < n; i++) for (let j = 1; j <= k; j++) { const b = (i * 7 + j * 13) % n; if (b !== i) edges.push({ a: sid(Math.min(i, b)), b: sid(Math.max(i, b)), w: 0.2 + ((i + j) % 8) / 10, why: { words: ['国防長官'], places: ['US'], dt_h: 5.2 } }); }
  return { schema: 'parallax-relations/1', generated_at: 0, method: { sim: 'tfidf-bigram+terms+places', k: 5, min_w: 0.18, ai: false }, nodes, edges };
}

test('relations.json is checked: wrong schema, bad sid, weight outside 0..1 and repeated ties are left out', () => {
  assert.equal(graphOf({ schema: 'x' }), null);
  const g = graphOf({ schema: 'parallax-relations/1', nodes: [{ sid: sid(1), n_outlets: 3 }, { sid: sid(2) }, { sid: 'bad' }, { sid: sid(1) }],
    edges: [{ a: sid(1), b: sid(2), w: 0.4, why: { words: ['弾劾'] } }, { a: sid(2), b: sid(1), w: 0.5 }, { a: sid(1), b: sid(9), w: 0.3 }, { a: sid(1), b: sid(2), w: 1.4 }] });
  assert.equal(g.nodes.length, 2);
  assert.equal(g.edges.length, 1);
  assert.equal(g.method.from, 'relations');
  assert.equal(g.method.ai, false);
});

test('400 points lay out and stop within a second, inside the canvas', () => {
  const g = graphOf(rel(CAP));
  assert.equal(g.nodes.length, CAP);
  const t0 = performance.now();
  const pos = layout(g, { w: 900, h: 600 });
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `layout took ${ms.toFixed(0)} ms`);
  assert.equal(pos.length, CAP);
  assert.ok(pos.every((p) => Number.isFinite(p.x) && p.x >= 0 && p.x <= 900 && p.y >= 0 && p.y <= 600));
  // the same data, the same picture
  assert.deepEqual(layout(g, { w: 900, h: 600 }), pos);
});

test('more than 400 are cut at 400', () => { assert.equal(graphOf(rel(450)).nodes.length, CAP); });

test('the ties of one news, heaviest first, with the words they rest on', () => {
  const g = graphOf({ schema: 'parallax-relations/1', nodes: [{ sid: sid(1) }, { sid: sid(2) }, { sid: sid(3) }],
    edges: [{ a: sid(1), b: sid(2), w: 0.3, why: { words: ['弾劾'], lineage: true } }, { a: sid(1), b: sid(3), w: 0.6, why: { places: ['US'], aliases: [['エヌビディア', 'Nvidia']], dt_h: 0.4 } }] });
  assert.deepEqual(tiesOf(g, sid(1)).map((t) => t.sid), [sid(3), sid(2)]);
  assert.deepEqual(listOf(g).map((e) => e.w), [0.6, 0.3]);
  assert.equal(whyText(tiesOf(g, sid(1))[0].why), 'US・エヌビディア＝Nvidia・1 時間未満の差');
  assert.equal(whyText(tiesOf(g, sid(1))[1].why), '弾劾・続報');
  assert.deepEqual(tiesOf(g, 'nothing'), []);
});

test('without relations.json the page measure gives the same shape, marked as such', () => {
  const g = graphFromPairs([{ sid: 'a', n: 3, sides: { jp: 1, intl: 1, gov: 0 } }, { sid: 'b', n: 2, sides: { jp: 2, intl: 0, gov: 0 } }],
    [{ a: 'b', b: 'a', words: ['弾劾', '決議案'], places: [] }, { a: 'a', b: 'b', words: ['x'] }, { a: 'a', b: 'zz', words: ['y'] }]);
  assert.equal(g.edges.length, 1);
  assert.equal(g.edges[0].w, 0.4);
  assert.equal(g.method.from, 'page');
  assert.equal(g.method.ai, false);
});

test('a press finds the point under it; a point grows with the outlets', () => {
  const g = graphOf(rel(10));
  const pos = layout(g, { w: 400, h: 300 });
  assert.equal(hit(pos, g, pos[4].x + 1, pos[4].y), 4);
  assert.equal(hit(pos, g, -100, -100), -1);
  assert.ok(radius(9) > radius(1));
});

test('draw: lines and points on any 2D context, the chosen one with its labels', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 40 }) : typeof k === 'string' ? (...a) => calls.push([k, ...a]) : undefined), set: () => true });
  const g = graphOf(rel(10));
  const pos = layout(g, { w: 400, h: 300 });
  draw(ctx, g, pos, { w: 400, h: 300, label: () => '見出し' });
  assert.ok(calls.some((c) => c[0] === 'arc'));
  assert.ok(!calls.some((c) => c[0] === 'fillText'), 'no labels before a choice');
  calls.length = 0;
  draw(ctx, g, pos, { w: 400, h: 300, sel: g.nodes[0].sid, label: () => '見出し' });
  assert.ok(calls.some((c) => c[0] === 'fillText' && c[1] === '見出し'));
  assert.ok(calls.some((c) => c[0] === 'fillText' && c[1] === '1'), 'the first tie carries the number of its row');
});
