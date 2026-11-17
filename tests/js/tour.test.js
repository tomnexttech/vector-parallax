// node --test tests/js/tour.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

// 2026-11-16 改定: Sir「最初のチュートリアルは合わせて作り直した？」。六枚（はじめに・画面の切り替え・比べる・見当たらないメディア・AI のまとめ・検索と設定）を、
// 今のホームに沿う四枚（4 枚の札・注目ニュース・画面・検索と設定）へ作り直した。指す先は今の部品、名は「独自」の後の物
// 2026-11-17 改定（v80）: 五枚（四つの入口・ニュースの一覧・注目ニュース・画面・検索と設定）。ホームが三列になり、左に一覧が出来たため。語は使う人の言葉（タイル・カード・面を出さない。Sir 2026-11-17）
test('five short cards over the home as it is: the ways in, the list, the lead news, the screens, search and settings; the words neutral and the visitor words', () => {
  assert.equal(STEPS.length, 5);
  assert.deepEqual(STEPS.map((s) => s.id), ['ways', 'list', 'lead', 'screens', 'find']);
  assert.deepEqual(STEPS.map((s) => s.at[0]), ['#front .fr-tabs', '#hlist', '#hero .hr-card', '#screens', '#cmd-btn']);
  for (const s of STEPS) {
    assert.ok(s.at.length >= 1, `${s.id} points at a part of the page`);
    assert.ok(s.title.length <= 12, s.title);
    assert.ok(s.text.length <= 90, `${s.id} ${s.text.length}`);
    assert.ok(/です。|ます。|ません。/.test(s.text), s.id);
    for (const w of ['タイル', 'カード', 'ペイン', '独占', '報じなかった', '報じていない', '報道していない', '無視', '黙殺', '正しい', '誤報', '偏向', '右派', '左派', 'フェイク']) assert.ok(!s.text.includes(w) && !s.title.includes(w), `${s.id}: ${w}`);
  }
  assert.match(STEPS[0].text, /0〜100/, 'the ways in carry their unit');
  assert.match(STEPS[0].text, /片側だけの話は順位に入りません/, 'a story of one side is outside the order');
  assert.match(STEPS.find((s) => s.id === 'screens').text, /真偽は判定しません/);
});

// the parts the tour points at are in the page (index.html) or drawn by the home (js/front.js, js/hero.js)
test('the tour points at parts that exist', () => {
  const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  for (const id of ['screens', 'cmd-btn', 'view-btn', 'sects-more', 'front', 'hlist', 'hero', 'tour-btn']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(fs.readFileSync(new URL('../../js/front.js', import.meta.url), 'utf8'), /class: 'fr-tabs'/);
  assert.match(fs.readFileSync(new URL('../../js/hero.js', import.meta.url), 'utf8'), /class: 'hr-card'/);
});

// 2026-11-16 改定: 初回は案内が自動で出る（v56〜v63 は初回に出さず、ボタンを順に光らせるだけだった）。閉じた時に見た印が付き、二度は出ない
test('the first visit opens the tour over the home; a closed tour is kept as seen', () => {
  const app = fs.readFileSync(new URL('../../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /wantTour\(store, location\.search\) && !HX\.demo && !document\.documentElement\.hasAttribute\('data-show'\)\)\)\) openTour\(\);/);
  assert.match(app, /function openTour\(\) \{\s+if \(state\.ui === 'simple'\) setUi\('full'\);\s+setHome\('home'\); setSect\('home'\);/);
  assert.match(app, /\$\('tour-btn'\)\.addEventListener\('click', \(\) => openTour\(\)\);/);
  const tour = fs.readFileSync(new URL('../../js/tour.js', import.meta.url), 'utf8');
  assert.match(tour, /function close\(\) \{[\s\S]*?markTour\(storage\);/);
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
