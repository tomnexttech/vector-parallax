/* tv — broadcasters' own YouTube channels, embedded from youtube-nocookie.
 * No search and no reading of YouTube's pages here: a fixed list of official news channels (each id checked against the channel's public
 * feed on 2026-11-05; the build reads the same table, parallax/video.py, and writes the videos that fit each event into stories[].videos,
 * CONTRACT 18.14). What plays, in this order:
 *   1. a video of the selected event (a title of the channel's own feed that fits the event's headlines);
 *   2. the latest uploads of a channel that reported the event (the list of that channel's uploads);
 *   3. the 24-hour stream of a channel that really is a news stream (mode 'live': ANN, Al Jazeera English, DW, France 24, Sky News).
 * A channel may stream anything, so the live stream is never asked of a channel that is not a news stream (a nature camera came up once).
 * By default it plays by itself without sound (a browser stops a player that starts with sound); the settings may turn the playing
 * by itself off, start with sound, and choose and order the channels.
 *
 *   videosOf(videos, list) -> videos           the videos of the event that can be shown: a well-formed id, a channel of the list, newest first, at most 3
 *   playFor(videos, outlets, cover, list) -> play   { kind: 'video' | 'uploads' | 'live', st, video? }
 *   playOfStation(st) / playOfVideo(v, list)   what a press on a channel / on a video of the event plays
 *   describe(play) -> { name, title, url, ts }  the first line of the pane: the channel and what is playing (a quotation: channel, time, link)
 *   embedSrc(play | station, { auto, sound }) -> url     */

export const STATIONS = [
  { id: 'ann', short: 'ANN', name: 'ANNnewsCH', ch: 'UCGCZAYq5Xxojl_tSXcVJhiQ', mode: 'live', home: 'jp', match: /テレビ朝日|テレ朝|ANN/ },
  { id: 'tbs', short: 'TBS', name: 'TBS NEWS DIG', ch: 'UC6AG81pAkf6Lbi_1VC5NmPA', mode: 'uploads', home: 'jp', match: /TBS|JNN/ },
  { id: 'ntv', short: '日テレ', name: '日テレNEWS', ch: 'UCuTAXTexrhetbOe3zgskJBQ', mode: 'uploads', home: 'jp', match: /日テレ|日本テレビ|NNN/ },
  { id: 'fnn', short: 'FNN', name: 'FNNプライムオンライン', ch: 'UCoQBJMzcwmXrRSHBFAlTsIw', mode: 'uploads', home: 'jp', match: /フジテレビ|FNN/ },
  { id: 'tx', short: 'テレ東', name: 'テレ東BIZ', ch: 'UCkKVQ_GNjd8FbAuT6xDcWgg', mode: 'uploads', home: 'jp', match: /テレ東|テレビ東京/ },
  { id: 'aje', short: 'Al Jazeera', name: 'Al Jazeera English', ch: 'UCNye-wNBqNL5ZzHSJj3l8Bg', mode: 'live', home: 'intl', match: /Al Jazeera|アルジャジーラ/i },
  { id: 'bbg', short: 'Bloomberg', name: 'Bloomberg Television', ch: 'UCIALMKvObZNtJ6AmdCLP7Lg', mode: 'uploads', home: 'intl', match: /Bloomberg|ブルームバーグ/i },
  { id: 'dw', short: 'DW', name: 'DW News', ch: 'UCknLrEdhRCp1aegoMqRaCZg', mode: 'live', home: 'intl', match: /\bDW\b|Deutsche Welle/i },
  { id: 'f24', short: 'France 24', name: 'FRANCE 24 English', ch: 'UCQfwfsi5VrQ8yKZ-UWmAEFg', mode: 'live', home: 'intl', match: /France ?24/i },
  { id: 'sky', short: 'Sky', name: 'Sky News', ch: 'UCoMdktPbSTixAyNGwb-UYkQ', mode: 'live', home: 'intl', match: /Sky News/i },
  { id: 'cna', short: 'CNA', name: 'CNA', ch: 'UC83jt4dlz1Gjl58fzQrrKZg', mode: 'uploads', home: 'intl', match: /\bCNA\b|Channel NewsAsia/i },
];

const VID = /^[A-Za-z0-9_-]{11}$/;
const listOf = (list) => (Array.isArray(list) && list.length ? list : STATIONS);

/** the channel of an outlet that reported the event, or null */
export function stationOf(outlets, list = STATIONS) {
  for (const o of outlets || []) for (const st of listOf(list)) if (st.match.test(String(o || ''))) return st;
  return null;
}

/** the channel of an outlet that reported the event; otherwise a domestic or an international default by where it was reported */
export function stationFor(outlets, cover, list = STATIONS) {
  const ls = listOf(list);
  const own = stationOf(outlets, ls);
  if (own) return own;
  const home = cover === 'intl' ? 'intl' : 'jp';
  return ls.find((x) => x.id === (home === 'intl' ? 'aje' : 'ann')) || ls.find((x) => x.home === home) || ls[0];
}

/** the videos of an event that can be shown: a well-formed id and a title, a channel of the list, once each, newest first, at most `max` */
export function videosOf(videos, list = STATIONS, max = 3) {
  const ids = new Set(listOf(list).map((x) => x.id));
  const seen = new Set();
  return (Array.isArray(videos) ? videos : [])
    .filter((v) => v && typeof v === 'object' && VID.test(String(v.id)) && ids.has(v.station) && typeof v.title === 'string' && v.title.trim() && !seen.has(v.id) && seen.add(v.id))
    .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0))
    .slice(0, max);
}

export function playOfStation(st) { return { kind: st.mode === 'live' ? 'live' : 'uploads', st }; }
export function playOfVideo(v, list = STATIONS) { return { kind: 'video', st: listOf(list).find((x) => x.id === v.station) || listOf(list)[0], video: v }; }

/** what plays for an event: its video, else the latest uploads of a channel that reported it, else the 24-hour stream of a news channel */
export function playFor(videos, outlets, cover, list = STATIONS) {
  const ls = listOf(list);
  const vs = videosOf(videos, ls);
  if (vs.length) return { ...playOfVideo(vs[0], ls), videos: vs };
  const own = stationOf(outlets, ls);
  if (own) return { kind: 'uploads', st: own };
  const home = cover === 'intl' ? 'intl' : 'jp';
  const live = ls.find((x) => x.mode === 'live' && x.id === (home === 'intl' ? 'aje' : 'ann')) || ls.find((x) => x.mode === 'live' && x.home === home) || ls.find((x) => x.mode === 'live');
  if (live) return { kind: 'live', st: live };
  return { kind: 'uploads', st: ls.find((x) => x.home === home) || ls[0] };
}

export function describe(p) {
  if (p.kind === 'video' && p.video) return { name: p.st.name, title: p.video.title, url: `https://www.youtube.com/watch?v=${p.video.id}`, ts: Number(p.video.ts) || null };
  return { name: p.st.name, title: p.kind === 'live' ? 'ライブ配信（ニュースの常時配信）' : '最新の投稿', url: null, ts: null };
}

export function embedSrc(p, { auto = true, sound = false } = {}) {
  const q = `autoplay=${auto ? 1 : 0}&mute=${sound ? 0 : 1}&playsinline=1&rel=0&loop=1`;
  const st = p.st || p;
  const kind = p.kind || (st.mode === 'live' ? 'live' : 'uploads');
  if (kind === 'video' && p.video && VID.test(String(p.video.id))) return `https://www.youtube-nocookie.com/embed/${p.video.id}?${q}&playlist=${p.video.id}`;
  return kind === 'live'
    ? `https://www.youtube-nocookie.com/embed/live_stream?channel=${st.ch}&${q}`
    : `https://www.youtube-nocookie.com/embed/videoseries?list=UU${st.ch.slice(2)}&${q}`;
}
