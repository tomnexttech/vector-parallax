/* tv — broadcasters' own YouTube channels, embedded from youtube-nocookie.
 * No search and no reading of YouTube's pages: a fixed list of official news channels (each id checked against the channel's public
 * feed on 2026-11-05). A channel that runs a 24-hour stream is shown live; the others show their latest uploads.
 * Never autoplays; muted until the viewer turns the sound on in the player. */

export const STATIONS = [
  { id: 'ann', short: 'ANN', name: 'ANNnewsCH', ch: 'UCGCZAYq5Xxojl_tSXcVJhiQ', mode: 'uploads', home: 'jp', match: /テレビ朝日|テレ朝|ANN/ },
  { id: 'tbs', short: 'TBS', name: 'TBS NEWS DIG', ch: 'UC6AG81pAkf6Lbi_1VC5NmPA', mode: 'uploads', home: 'jp', match: /TBS|JNN/ },
  { id: 'ntv', short: '日テレ', name: '日テレNEWS', ch: 'UCuTAXTexrhetbOe3zgskJBQ', mode: 'uploads', home: 'jp', match: /日テレ|日本テレビ|NNN/ },
  { id: 'fnn', short: 'FNN', name: 'FNNプライムオンライン', ch: 'UCoQBJMzcwmXrRSHBFAlTsIw', mode: 'uploads', home: 'jp', match: /フジテレビ|FNN/ },
  { id: 'tx', short: 'テレ東', name: 'テレ東BIZ', ch: 'UCkKVQ_GNjd8FbAuT6xDcWgg', mode: 'uploads', home: 'jp', match: /テレ東|テレビ東京/ },
  { id: 'aje', short: 'Al Jazeera', name: 'Al Jazeera English', ch: 'UCNye-wNBqNL5ZzHSJj3l8Bg', mode: 'live', home: 'intl', match: /Al Jazeera|アルジャジーラ/i },
  { id: 'bbg', short: 'Bloomberg', name: 'Bloomberg Television', ch: 'UCIALMKvObZNtJ6AmdCLP7Lg', mode: 'live', home: 'intl', match: /Bloomberg|ブルームバーグ/i },
  { id: 'dw', short: 'DW', name: 'DW News', ch: 'UCknLrEdhRCp1aegoMqRaCZg', mode: 'live', home: 'intl', match: /\bDW\b|Deutsche Welle/i },
  { id: 'f24', short: 'France 24', name: 'FRANCE 24 English', ch: 'UCQfwfsi5VrQ8yKZ-UWmAEFg', mode: 'live', home: 'intl', match: /France ?24/i },
  { id: 'sky', short: 'Sky', name: 'Sky News', ch: 'UCoMdktPbSTixAyNGwb-UYkQ', mode: 'live', home: 'intl', match: /Sky News/i },
  { id: 'cna', short: 'CNA', name: 'CNA', ch: 'UC83jt4dlz1Gjl58fzQrrKZg', mode: 'uploads', home: 'intl', match: /\bCNA\b|Channel NewsAsia/i },
];

/** the channel of an outlet that reported the event; otherwise a domestic or an international default by where it was reported */
export function stationFor(outlets, cover) {
  for (const o of outlets || []) for (const st of STATIONS) if (st.match.test(String(o || ''))) return st;
  return STATIONS.find((x) => x.id === (cover === 'intl' ? 'aje' : 'ann'));
}

export function embedSrc(st) {
  const q = 'autoplay=0&mute=1&playsinline=1&rel=0';
  return st.mode === 'live'
    ? `https://www.youtube-nocookie.com/embed/live_stream?channel=${st.ch}&${q}`
    : `https://www.youtube-nocookie.com/embed/videoseries?list=UU${st.ch.slice(2)}&${q}`;
}
