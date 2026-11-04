// node --test tests/js/places.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeJa, placesIn, placesOf, worldPx, mapView } from '../../js/places.js';

test('place keys read in Japanese', () => {
  assert.equal(placeJa('NK'), '北朝鮮');
  assert.equal(placeJa('群馬'), '群馬');
  assert.equal(placeJa('ZZ'), 'ZZ');
});

test('names in public text: longer names first, traps avoided', () => {
  assert.deepEqual(placesIn('北朝鮮がミサイル発射'), ['NK']);
  assert.deepEqual(placesIn('米中間選挙で民主党が優勢'), ['US']);
  assert.deepEqual(placesIn('中国電力が値上げを申請'), []);
  assert.deepEqual(placesIn('North Korea fires missiles'), ['NK']);
  assert.ok(placesIn('群馬県で火災').includes('群馬'));
  assert.deepEqual(placesIn(''), []);
});

test('basis.places first; 日本 alone is dropped when something else is named', () => {
  const st = { basis: { places: ['US'] }, ai: { headline_ja: '日本と北朝鮮', headline_en: '' }, member_ids: [] };
  assert.deepEqual(placesOf(st, {}), ['US', 'NK']);
  assert.deepEqual(placesOf({ ai: { headline_ja: '日本の金利' } }, {}), ['JP']);
  assert.deepEqual(placesOf(null, null), []);
});

test('map view: tiles exist in the 8 x 4 level, TMS rows counted from the bottom', () => {
  const p = worldPx(0, 0);
  assert.equal(p.x, 1024); assert.equal(p.y, 512);
  const v = mapView(['東京']);
  assert.ok(v && v.w > 0 && v.h > 0);
  for (const t of v.tiles) {
    const m = t.src.match(/\/2\/(\d)\/(\d)\.jpg$/);
    assert.ok(m, t.src);
    assert.ok(+m[1] >= 0 && +m[1] <= 7 && +m[2] >= 0 && +m[2] <= 3);
  }
  // Tokyo (35.7N, 139.7E): column 7, row from top 1 -> TMS y 2
  assert.ok(v.tiles.some((t) => t.src.endsWith('/7/2.jpg')));
  assert.equal(mapView([]), null);
});
