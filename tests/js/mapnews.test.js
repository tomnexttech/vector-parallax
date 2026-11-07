import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newsAt, newsView, headOf } from '../../js/mapnews.js';
import { nearby } from '../../js/hazards.js';

const ev = (key, name, lat, lon, n, extra = {}) => ({ key, n, last: n, hay: extra.hay || '', geo: name ? { key: name, name, lat, lon, country: !!extra.country } : null, ...extra });

test('a country: the events of that name, and those with no place whose headline names it; an event at another place stays out, and so does an outlet called 中国新聞', () => {
  const es = [ev('a', 'イラン', 32, 53, 2, { country: true }), ev('b', 'イラン', 32, 53, 9, { country: true }), ev('c', null, 0, 0, 30, { heading: { text: 'イランの原油' } }),
    ev('d', '中国', 35, 103, 40, { country: true }), ev('e', 'イスラエル', 31, 34, 50, { country: true, heading: { text: 'イスラエルとイランの協議' } }), ev('f', null, 0, 0, 60, { hay: '中国新聞 イラン', heading: { text: '大雨の被害' } })];
  assert.deepEqual(newsAt(es, { place: 'イラン', lat: 32, lon: 53, country: true }, { nearby }).map((x) => x.key), ['b', 'a', 'c']);
  assert.deepEqual(newsAt(es, { place: '中国', lat: 35, lon: 103, country: true }, { nearby }).map((x) => x.key), ['d']);
});

test('a point: the same place first, then what stands within the radius; a country mark is not near anything', () => {
  const es = [ev('near', '横浜', 35.44, 139.64, 5), ev('same', '東京', 35.68, 139.76, 1), ev('far', '札幌', 43.06, 141.35, 9), ev('cty', '日本', 36.2, 138.3, 50, { country: true })];
  const r = newsAt(es, { place: '東京', lat: 35.68, lon: 139.76 }, { nearby, km: 500 });
  assert.deepEqual(r.map((x) => x.key), ['same', 'near']);
});

test('nothing pressed, nothing to show; hidden and folded events stay out', () => {
  assert.deepEqual(newsAt([ev('a', '東京', 35, 139, 1)], null), []);
  const es = [ev('a', '東京', 35, 139, 1, { hid: 'x' }), ev('b', '東京', 35, 139, 1, { foldedInto: 'c' }), ev('c', '東京', 35, 139, 1)];
  assert.deepEqual(newsAt(es, { place: '東京' }).map((x) => x.key), ['c']);
});

const fixture = () => [ev('cn1', '中国', 35, 103, 9, { country: true, heading: { text: '中国の貿易' } }), ev('cn2', '中国', 35, 103, 4, { country: true, heading: { text: '中国の株価' } }),
  ev('il', 'イスラエル', 31, 34, 20, { country: true, heading: { text: 'イスラエルの話' } }), ev('jp', null, 0, 0, 3, { heading: { text: '立憲民主党の政調審議会' } })];

test('a place pressed: the heading, every event of the list and the event at the side all speak of that place, even while another event is in focus', () => {
  const es = fixture(), other = es[3];
  const v = newsView({ events: es, pri: es, cur: other, picked: { place: '中国', lat: 35, lon: 103, country: true }, scope: 'near', leadKey: null, nearby });
  assert.equal(headOf(v), '中国 のニュース');
  assert.deepEqual(v.list.map((x) => x.key), ['cn1', 'cn2']);
  for (const e of v.list) assert.equal(e.geo.name, '中国');
  assert.equal(v.lead.key, 'cn1');
  assert.ok(v.list.includes(v.lead));
});

test('a card of the list pressed comes to the side; a key from an earlier place is not used', () => {
  const es = fixture();
  const picked = { place: '中国', lat: 35, lon: 103, country: true };
  assert.equal(newsView({ events: es, pri: es, cur: es[3], picked, scope: 'near', leadKey: 'cn2', nearby }).lead.key, 'cn2');
  assert.equal(newsView({ events: es, pri: es, cur: es[3], picked, scope: 'near', leadKey: 'il', nearby }).lead.key, 'cn1');
});

test('the card closed (parallax:map-clear): no place in the heading, the priority list and the event in focus', () => {
  const es = fixture();
  const v = newsView({ events: es, pri: es, cur: es[3], picked: null, scope: 'pri', leadKey: null, nearby });
  assert.equal(headOf(v), '注目のニュース');
  assert.equal(v.scope, 'pri');
  assert.equal(v.list.length, 4);
  assert.equal(v.lead.key, 'jp');
});

test('a place with no news falls back to the priority list and says so in the heading', () => {
  const es = fixture();
  const v = newsView({ events: es, pri: es, cur: es[3], picked: { place: 'ブラジル', lat: -10, lon: -55, country: true }, scope: 'near', leadKey: null, nearby });
  assert.equal(headOf(v), '注目のニュース');
  assert.equal(v.scope, 'pri');
});
