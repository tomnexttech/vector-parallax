import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATIONS, stationOf, videosOf, playFor, playOfStation, playOfVideo, describe, embedSrc } from '../../js/tv.js';

const V = (id, station, ts, title = 'タイトル') => ({ id, station, ts, title });
const ID1 = 'aaaaaaaaaaa', ID2 = 'bbbbbbbbbbb', ID3 = 'ccccccccccc', ID4 = 'ddddddddddd';
const without = (...ids) => STATIONS.filter((x) => !ids.includes(x.id));

test('only the channels that really stream the news all day are live; the others never ask for the live stream', () => {
  assert.deepEqual(STATIONS.filter((x) => x.mode === 'live').map((x) => x.id).sort(), ['aje', 'ann', 'dw', 'f24', 'sky']);
  for (const st of STATIONS.filter((x) => x.mode !== 'live')) {
    assert.match(embedSrc(playOfStation(st)), /videoseries\?list=UU/);
    assert.doesNotMatch(embedSrc(st), /live_stream/);
  }
});

test('a video of the event plays first: newest first, a channel of the list, at most three', () => {
  const vs = [V(ID1, 'tbs', 100), V(ID2, 'aje', 300), V(ID3, 'ntv', 200), V(ID4, 'ann', 50)];
  const p = playFor(vs, ['TBS'], 'jp');
  assert.equal(p.kind, 'video');
  assert.equal(p.video.id, ID2);
  assert.equal(p.st.id, 'aje');
  assert.deepEqual(p.videos.map((v) => v.id), [ID2, ID3, ID1]);
  assert.match(embedSrc(p), new RegExp(`embed/${ID2}\\?autoplay=1&mute=1&playsinline=1&rel=0&loop=1&playlist=${ID2}$`));
});

test('a video of a channel the visitor turned off is not shown; the next one is', () => {
  const vs = [V(ID1, 'tbs', 300), V(ID2, 'ann', 200)];
  assert.equal(playFor(vs, [], 'jp', without('tbs')).video.id, ID2);
  assert.deepEqual(videosOf(vs, without('tbs', 'ann')), []);
});

test('bad rows are dropped: an id that is not an id (it must not reach a URL), no title, an unknown channel, a repeat', () => {
  const vs = [V('x"><script>', 'tbs', 9), V('short', 'tbs', 9), V(ID1, 'tbs', 5, '  '), V(ID2, 'zzz', 5), V(ID3, 'tbs', 5), V(ID3, 'tbs', 6), null, 'x', { id: ID4 }];
  assert.deepEqual(videosOf(vs).map((v) => v.id), [ID3]);
  assert.deepEqual(videosOf(null), []);
  assert.deepEqual(videosOf(undefined), []);
  assert.doesNotMatch(embedSrc({ kind: 'video', st: STATIONS[0], video: { id: 'x"><script>' } }), /script/);
  assert.match(embedSrc({ kind: 'video', st: STATIONS[0], video: { id: 'x"><script>' } }), /videoseries/, 'a bad id falls back to the latest uploads');
});

test('no video: the latest uploads of a channel that reported the event, also when that channel is a news stream', () => {
  const p = playFor([], ['朝日新聞', 'Al Jazeera English'], 'intl');
  assert.equal(p.kind, 'uploads');
  assert.equal(p.st.id, 'aje');
  assert.match(embedSrc(p), /videoseries\?list=UUNye-wNBqNL5ZzHSJj3l8Bg/);
  assert.equal(playFor(undefined, ['TBS NEWS'], 'jp').st.id, 'tbs');
  assert.equal(stationOf(['NHK'], STATIONS), null);
});

test('nothing fits: the 24-hour stream of a news channel, by where the event was reported', () => {
  const jp = playFor([], ['NHK'], 'jp');
  assert.equal(jp.kind, 'live'); assert.equal(jp.st.id, 'ann');
  assert.match(embedSrc(jp), /live_stream\?channel=UCGCZAYq5Xxojl_tSXcVJhiQ/);
  const intl = playFor([], [], 'intl');
  assert.equal(intl.kind, 'live'); assert.equal(intl.st.id, 'aje');
  assert.equal(playFor([], [], 'both').st.id, 'ann');
  // the default is gone: another news stream of the same home, else any news stream
  assert.equal(playFor([], [], 'jp', without('ann')).st.id, 'aje');
  assert.equal(playFor([], [], 'intl', without('aje')).st.id, 'dw');
  // no news stream in the list at all: never a live stream, the uploads of a channel of that home
  const none = playFor([], [], 'jp', STATIONS.filter((x) => x.mode !== 'live'));
  assert.equal(none.kind, 'uploads'); assert.equal(none.st.home, 'jp');
  assert.equal(playFor([], [], 'jp', []).kind, 'live', 'an empty list means the full list');
});

test('a press on a channel plays its news stream or its uploads; a press on a video plays that video', () => {
  assert.equal(playOfStation(STATIONS.find((x) => x.id === 'sky')).kind, 'live');
  assert.equal(playOfStation(STATIONS.find((x) => x.id === 'tbs')).kind, 'uploads');
  const p = playOfVideo(V(ID1, 'dw', 1), STATIONS);
  assert.equal(p.kind, 'video'); assert.equal(p.st.id, 'dw');
});

test('the first line of the pane says the channel and what plays; a video carries its title, link and time', () => {
  const v = V(ID1, 'ann', 1762300000, '【速報】会談');
  assert.deepEqual(describe(playOfVideo(v, STATIONS)), { name: 'ANNnewsCH', title: '【速報】会談', url: `https://www.youtube.com/watch?v=${ID1}`, ts: 1762300000 });
  assert.match(describe({ kind: 'live', st: STATIONS[0] }).title, /ライブ/);
  assert.match(describe({ kind: 'uploads', st: STATIONS[1] }).title, /最新/);
  assert.equal(describe({ kind: 'uploads', st: STATIONS[1] }).url, null);
});

test('the options: sound, no autoplay', () => {
  assert.match(embedSrc(playOfVideo(V(ID1, 'ann', 1), STATIONS), { auto: false, sound: true }), /autoplay=0&mute=0/);
  assert.match(embedSrc(STATIONS[0]), /autoplay=1&mute=1/, 'a station alone still works');
});
