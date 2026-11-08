import test from 'node:test';
import assert from 'node:assert/strict';
import { breakingOf, breakingText, keepOff, SURGE, rankBy, PLACE_CHOICES, cleanPlace, placeName, localOf, searchOf, outletsOf, QF0 } from '../../js/newsdesk.js';

const NOW = 1_800_000_000;
const quake = (id, shindo, agoH, extra = {}) => ({ id, shindo, mag: 5.4, place: '千葉県北東部', ts: NOW - agoH * 3600, src: 'jma', ...extra });

test('the line: quakes of 5- or more in six hours, tsunami first, then sharp rises', () => {
  const quakes = [quake('a', '4', 1), quake('b', '5-', 1), quake('c', '6+', 3), quake('d', '7', 7)];
  const tsunami = [{ title: '津波注意報', area: '伊豆諸島', issued: NOW - 600 }];
  const events = [
    { key: 'st-1', id: 's1', title: '大きなニュース', new6h: SURGE.new6h, sinceH: 2, n: SURGE.outlets },
    { key: 'st-2', id: 's2', title: 'いつもの', new6h: 8, sinceH: 4.3, n: 8 },
    { key: 'st-3', id: 's3', title: '古い', new6h: 20, sinceH: 30, n: 20 },
  ];
  const list = breakingOf({ quakes, tsunami, events, now: NOW });
  assert.deepEqual(list.map((b) => b.kind), ['tsunami', 'quake', 'quake', 'surge']);
  assert.deepEqual(list.filter((b) => b.kind === 'quake').map((b) => b.id), ['q-c', 'q-b']);
  assert.equal(list[3].key, 'st-1');
});

test('an ordinary day puts nothing on the line', () => {
  const events = [{ key: 'k', id: 's', title: 't', new6h: 8, sinceH: 4.3, n: 8 }, { key: 'k2', id: 's2', title: 't', new6h: 7, sinceH: 3.3, n: 7 }];
  assert.deepEqual(breakingOf({ quakes: [quake('x', '3', 1)], tsunami: [], events, now: NOW }), []);
});

test('a closed item stays away while it lasts, and is forgotten after', () => {
  const quakes = [quake('b', '5+', 1)];
  assert.equal(breakingOf({ quakes, now: NOW, off: ['q-b'] }).length, 0);
  const on = breakingOf({ quakes, now: NOW });
  assert.deepEqual(keepOff(['q-b', 'q-old'], on), ['q-b']);
});

test('the words of the line', () => {
  const clock = () => '10:07';
  assert.deepEqual(breakingText({ kind: 'quake', shindo: '5-', mag: 5.24, place: '千葉県北東部', at: NOW }, clock), { tag: '地震', text: '震度5弱 千葉県北東部 M5.2・10:07' });
  assert.equal(breakingText({ kind: 'tsunami', title: '津波注意報', place: '伊豆諸島', at: NOW }, clock).text, '津波注意報 伊豆諸島・10:07');
  assert.equal(breakingText({ kind: 'surge', title: '見出し', new6h: 14, n: 11 }).text, '見出し・6 時間で 14 件・11媒体');
});

test('ranks: highest first, equal values share a rank, nothing for zero', () => {
  const es = [{ k: 'a', v: 3, n: 1 }, { k: 'b', v: 5, n: 1 }, { k: 'c', v: 3, n: 2 }, { k: 'd', v: 0 }];
  const r = rankBy(es, (e) => e.v);
  assert.deepEqual(r.map((x) => [x.e.k, x.rank]), [['b', 1], ['c', 2], ['a', 2]]);
  assert.equal(rankBy(es, (e) => e.v, { cap: 1 }).length, 1);
});

test('home: the 47 prefectures and the countries; anything else is no choice', () => {
  assert.equal(PLACE_CHOICES.filter((x) => x.group === '都道府県').length, 47);
  assert.ok(PLACE_CHOICES.some((x) => x.key === 'US' && x.ja === 'アメリカ'));
  assert.equal(cleanPlace('東京'), '東京');
  assert.equal(cleanPlace('GAZA'), '');
  assert.equal(cleanPlace(3), '');
  assert.equal(placeName('UK'), '英国');
});

test('local news: the places of the news, Japan takes every prefecture', () => {
  const es = [{ key: 1, places: ['東京'], n: 2 }, { key: 2, places: ['US'], n: 5 }, { key: 3, places: ['OKINAWA'], n: 3 }, { key: 4, places: [], n: 9 }];
  assert.deepEqual(localOf(es, '東京').map((e) => e.key), [1]);
  assert.deepEqual(localOf(es, '沖縄').map((e) => e.key), [3]);
  assert.deepEqual(localOf(es, 'JP').map((e) => e.key), [3, 1]);
  assert.deepEqual(localOf(es, ''), []);
});

test('search: span, side, outlet and the two orders', () => {
  const m = (o) => ({ outlet: o });
  const es = [
    { key: 'a', n: 5, last: NOW - 2 * 3600, members: [m('NHK'), m('BBC')], s: { jp: 1, intl: 1, gov: 0 } },
    { key: 'b', n: 2, last: NOW - 600, members: [m('BBC')], s: { jp: 0, intl: 1, gov: 0 } },
    { key: 'c', n: 9, last: NOW - 30 * 3600, members: [m('首相官邸')], s: { jp: 0, intl: 0, gov: 1 } },
  ];
  const o = { now: NOW, sideN: (e, k) => e.s[k], outletOf: (it) => it.outlet };
  assert.deepEqual(searchOf(es, { ...QF0, ...o }).map((e) => e.key), ['c', 'a', 'b']);
  assert.deepEqual(searchOf(es, { ...QF0, ...o, sort: 'new' }).map((e) => e.key), ['b', 'a', 'c']);
  assert.deepEqual(searchOf(es, { ...QF0, ...o, span: '6h' }).map((e) => e.key), ['a', 'b']);
  assert.deepEqual(searchOf(es, { ...QF0, ...o, span: '24h', side: 'intl' }).map((e) => e.key), ['a', 'b']);
  assert.deepEqual(searchOf(es, { ...QF0, ...o, outlet: 'NHK' }).map((e) => e.key), ['a']);
  assert.deepEqual(outletsOf(es, (it) => it.outlet).map((x) => [x.name, x.n]), [['BBC', 2], ['NHK', 1], ['首相官邸', 1]]);
});
