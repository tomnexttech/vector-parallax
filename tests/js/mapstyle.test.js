import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStyle, PAL, OVERLAY, TILEJSON, GLYPHS } from '../../js/mapstyle.js';
import { circleRing, bubbleR } from '../../js/mapgl.js';

for (const mode of ['dark', 'light']) {
  test(`the ${mode} style is one consistent document`, () => {
    const st = buildStyle(mode), ids = st.layers.map((l) => l.id);
    assert.equal(st.version, 8);
    assert.equal(new Set(ids).size, ids.length, 'a layer id is used twice');
    for (const l of st.layers) {
      if (l.type !== 'background') assert.ok(st.sources[l.source], `${l.id}: no source ${l.source}`);
      if (l['source-layer']) assert.equal(l.source, 'ofm', `${l.id}: a source layer needs the vector source`);
    }
    for (const id of OVERLAY) assert.equal(st.sources[id].type, 'geojson', id);
    assert.equal(st.sources.ofm.url, TILEJSON);
    assert.ok(GLYPHS.startsWith('https://tiles.openfreemap.org/'));
    assert.ok(!/undefined|NaN/.test(JSON.stringify(st)), 'a colour or a number is missing');
  });
}

test('every colour of the palette is there in both appearances, and the names are Japanese first', () => {
  assert.deepEqual(Object.keys(PAL.dark).sort(), Object.keys(PAL.light).sort());
  const st = buildStyle('dark'), city = st.layers.find((l) => l.id === 'lab-city-1');
  assert.deepEqual(city.layout['text-field'].slice(0, 3), ['coalesce', ['get', 'name:ja'], ['get', 'name_en']]);
  const fonts = new Set(st.layers.flatMap((l) => (l.layout && l.layout['text-font'] ? [l.layout['text-font'][0]] : [])));
  assert.deepEqual([...fonts].sort(), ['Noto Sans Bold', 'Noto Sans Italic', 'Noto Sans Regular']);
});

test('zoom expressions stand at the top of a property (MapLibre refuses them inside another expression)', () => {
  const st = buildStyle('light'), Z = '["zoom"]';
  for (const l of st.layers) for (const k of ['paint', 'layout']) for (const [name, v] of Object.entries(l[k] || {})) {
    if (!Array.isArray(v) || v[0] === 'literal') continue;
    const at = v[0] === 'interpolate' ? 2 : v[0] === 'step' ? 1 : -1;
    const rest = at < 0 ? v : v.filter((_, i) => i !== at);
    assert.ok(!JSON.stringify(rest).includes(Z), `${l.id}.${name}: a zoom inside ${v[0]}`);
  }
});

test('a circle of km is closed and as wide as asked', () => {
  const r = circleRing(0, 100, 111.32, 72);
  assert.deepEqual(r[0], r[r.length - 1]);
  assert.ok(Math.abs(Math.max(...r.map((p) => p[0])) - 101) < 1e-6);
  const hi = circleRing(60, 10, 100);
  assert.ok(Math.max(...hi.map((p) => p[0])) - 10 > Math.max(...hi.map((p) => p[1])) - 60, 'a degree of longitude is shorter in the north');
});

test('a bubble grows with its news and stops growing', () => {
  assert.ok(bubbleR(1) >= 9 && bubbleR(1) < bubbleR(9));
  assert.ok(bubbleR(9) < bubbleR(100));
  assert.equal(bubbleR(5000), 21);
  assert.equal(bubbleR(5000, true), 24);
});
