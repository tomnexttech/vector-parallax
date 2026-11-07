import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeBorders, whereIs, tally, stepsFor, levelOf, levelAlpha, stepLabel, inEntry } from '../../js/mapthemes.js';
import { cameraOf, toScreen, toGround } from '../../js/map3d.js';
import { markKey, nameKey } from '../../js/map.js';

const B = decodeBorders(JSON.parse(readFileSync(new URL('../../assets/map/borders.json', import.meta.url), 'utf8')));

test('the borders carry the countries by their short names and every prefecture', () => {
  assert.equal(B.prefs.length, 47);
  for (const n of ['日本', '米国', '英国', '中国', '韓国', '北朝鮮', '台湾', 'ロシア', 'フランス', 'ウクライナ', 'イラン']) assert.ok(B.byName.has(n), n);
  for (const n of ['東京', '大阪', '京都', '北海道', '沖縄']) assert.ok(B.prefByName.has(n), n);
});

test('a point is in its country and its prefecture, whatever it is called', () => {
  assert.ok(inEntry(B.byName.get('フランス'), 47, 2));
  assert.equal(inEntry(B.byName.get('フランス'), 40, 2), false);
  assert.equal(whereIs(B, { lat: 48.85, lon: 2.35, name: 'Paris' }).country.name, 'フランス');
  assert.equal(whereIs(B, { lat: 39, lon: -77, name: 'アメリカ' }).country.name, '米国');
  const yokohama = whereIs(B, { lat: 35.45, lon: 139.63, name: '横浜' });
  assert.equal(yokohama.country.name, '日本');
  assert.equal(yokohama.pref.name, '神奈川');
  const tokyo = whereIs(B, { lat: 0, lon: 0, name: '東京都' });
  assert.equal(tokyo.pref.name, '東京');
  // Japan as a whole is counted for the country and for no prefecture
  const jp = whereIs(B, { lat: 36.2, lon: 138.3, name: '日本', country: true });
  assert.equal(jp.country.name, '日本');
  assert.equal(jp.pref, null);
  assert.equal(whereIs(B, { lat: 0, lon: -150, name: '太平洋の真ん中' }).country, null);
});

test('the tally counts the articles, heaviest first, and what could not be placed is left out of placed', () => {
  const t = tally(B, [
    { lat: 48.85, lon: 2.35, name: 'パリ', weight: 3 }, { lat: 43.3, lon: 5.37, name: 'マルセイユ', weight: 2 },
    { lat: 35.68, lon: 139.7, name: '東京', weight: 4 }, { lat: 0, lon: -150, name: '海', weight: 7 },
  ]);
  assert.equal(t.total, 16);
  assert.equal(t.placed, 9);
  assert.deepEqual(t.countries.map((r) => [r.e.name, r.n]), [['フランス', 5], ['日本', 4]]);
  assert.deepEqual(t.prefs.map((r) => [r.e.name, r.n]), [['東京', 4]]);
});

test('the legend has at most five round steps that reach the largest number', () => {
  assert.deepEqual(stepsFor(0), []);
  assert.deepEqual(stepsFor(1), [{ from: 1, to: 1 }]);
  for (const max of [2, 7, 40, 225, 900, 4000]) {
    const s = stepsFor(max);
    assert.ok(s.length >= 1 && s.length <= 5, String(max));
    assert.equal(s[0].from, 1);
    assert.equal(s.at(-1).to, max);
    for (let n = 1; n <= max; n += Math.ceil(max / 50)) { const k = levelOf(s, n); assert.ok(n >= s[k].from && n <= s[k].to); }
  }
  assert.equal(stepLabel({ from: 3, to: 3 }), '3');
  assert.equal(stepLabel({ from: 5, to: 9 }), '5〜9');
  assert.ok(levelAlpha(4, 5) > levelAlpha(0, 5));
  assert.equal(levelAlpha(-1, 5), 0);
});

test('a place is counted under the same name as its mark', () => {
  assert.equal(nameKey('アメリカ'), '米国');
  assert.equal(markKey('東京都', 35.7, 139.7), '東京');
  assert.equal(markKey('横浜', 35.45, 139.63), '神奈川');
  assert.equal(markKey('パリ', 48.85, 2.35), 'パリ');
  assert.equal(markKey('日本', 36.2, 138.3, true), '日本');
});

test('the 3D camera: straight down the floor is the flat map, and a point goes to the screen and back', () => {
  const W = 800, H = 600, flat = cameraOf({ span: 100, yaw: 0, pitch: 0.0001 }, W, H);
  const c = toScreen(flat, 0, 0, 0, W, H), e = toScreen(flat, 50, 0, 0, W, H), n = toScreen(flat, 0, 0, -30, W, H);
  assert.ok(Math.abs(c[0] - 400) < 0.5 && Math.abs(c[1] - 300) < 0.5);
  assert.ok(Math.abs(e[0] - 800) < 1, 'half the span reaches the edge');
  assert.ok(n[1] < 300 && Math.abs(300 - n[1] - 240) < 2, 'north is up, at the same scale');
  const C = cameraOf({ span: 60, yaw: 0.7, pitch: 1.02 }, W, H);
  for (const [dl, z] of [[0, 0], [10, 5], [-20, 8], [15, -12]]) {
    const s = toScreen(C, dl, 0, z, W, H), g = toGround(C, s[0], s[1], W, H);
    assert.ok(Math.abs(g[0] - dl) < 1e-3 && Math.abs(g[1] - z) < 1e-3);
  }
  assert.equal(toGround(C, 400, -4000, W, H), null, 'above the horizon there is no floor');
});
