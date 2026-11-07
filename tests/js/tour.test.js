// node --test tests/js/tour.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, TOUR_KEY, tourSeen, markTour, wantTour, holeOf, place } from '../../js/tour.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('kept only in the given storage; a storage that throws or is missing does not break', () => {
  const s = mem();
  assert.equal(tourSeen(s), false);
  assert.equal(markTour(s), true);
  assert.equal(s.m.get(TOUR_KEY), '1');
  assert.equal(tourSeen(s), true);
  assert.equal(tourSeen(bad), false);
  assert.equal(markTour(bad), false);
  assert.equal(tourSeen(null), false);
  assert.equal(markTour(null), false);
});

test('?tour=0 never, ?tour=1 always, else only before it was seen', () => {
  const s = mem();
  assert.equal(wantTour(s, ''), true);
  assert.equal(wantTour(s, '?tour=0'), false);
  markTour(s);
  assert.equal(wantTour(s, '?data=x.json'), false);
  assert.equal(wantTour(s, '?tour=1'), true);
  assert.equal(wantTour(bad, undefined), true);
});

test('five short cards: hello first, the settings last, the words neutral', () => {
  assert.ok(STEPS.length >= 4 && STEPS.length <= 6);
  assert.match(STEPS[0].title, /^はじめまして/);
  assert.deepEqual(STEPS[0].at, []);
  assert.deepEqual(STEPS.map((s) => s.id), ['hello', 'sects', 'simple', 'absent', 'ai', 'settings']);
  for (const s of STEPS) {
    assert.ok(s.title.length <= 12, s.title);
    assert.ok(s.text.length <= 80, `${s.id} ${s.text.length}`);
    assert.ok(/です。|ます。|ません。/.test(s.text), s.id);
    for (const w of ['報じなかった', '報じていない', '報道していない', '無視', '黙殺', '正しい', '誤報', '偏向', '右派', '左派', 'フェイク']) assert.ok(!s.text.includes(w), `${s.id}: ${w}`);
  }
  assert.match(STEPS.find((s) => s.id === 'ai').text, /真偽は判定しません/);
});

const V = { width: 1440, height: 900 };
const C = { width: 380, height: 200 };

test('the outline is the target with a margin, cut to the screen and above a line', () => {
  assert.equal(holeOf(null, V), null);
  assert.equal(holeOf({ left: 0, top: 0, width: 0, height: 10 }, V), null);
  const h = holeOf({ left: 100, top: 100, width: 200, height: 50 }, V);
  assert.deepEqual([h.left, h.top, h.right, h.bottom], [94, 94, 306, 156]);
  const cut = holeOf({ left: 100, top: 100, width: 200, height: 2000 }, V, 600);
  assert.equal(cut.bottom, 600);
  assert.equal(holeOf({ left: 100, top: 700, width: 200, height: 50 }, V, 600), null);
});

test('the card goes under the outline, else over it, else beside it, else at the bottom', () => {
  assert.deepEqual(place(null, C, V), { hole: null, left: 530, top: 350 });
  const under = place({ left: 100, top: 100, width: 200, height: 50 }, C, V);
  assert.equal(under.top, 156 + 12);
  assert.equal(under.left, 94);
  const over = place({ left: 1300, top: 700, width: 100, height: 50 }, C, V);
  assert.equal(over.top, 694 - 12 - 200);
  assert.ok(over.left + C.width <= V.width - 16);
  const beside = place({ left: 100, top: 150, width: 300, height: 500 }, C, { width: 1440, height: 760 });
  assert.equal(beside.left, 406 + 12);
  const tall = place({ left: 0, top: 0, width: 1440, height: 2000 }, C, V);
  assert.equal(tall.top, 900 - 200 - 16);
  assert.ok(tall.hole.bottom <= tall.top - 12);
});
