/* speak — the point of a news and each side's headlines, read aloud with the device's own voice (Web Speech API).
 * Only when the visitor presses; the same button stops it. A device without a Japanese voice gets no button (some browsers hand
 * their voices over late, on 'voiceschanged', and the button then appears). Nothing leaves the browser.
 *
 *   hasJa(voices) -> bool
 *   voiceFor(voices, lang) -> voice | null      the device's voice for 'ja' or 'en', one on the device first
 *   readLines(e, { sides, point, outletOf, per }) -> [{ text, lang }]
 *                                               the point (the AI's summary said as the AI's, else the headline as published with its
 *                                               outlet), then each side that has reports: its name and count, and its first headlines
 *   createReader(win) -> { can(), key(), onChange(fn), toggle(key, lines) -> bool, stop() }
 *                                               one reading at a time; toggle on the key being read stops it */

export const PER = 5;
const JA = /[぀-ヿ一-鿿]/;
const SIDE_JA = [['jp', '国内の報道'], ['intl', '海外の報道'], ['gov', '官公庁の資料']];
const str = (v) => (typeof v === 'string' ? v : '');
const langOf = (t) => (JA.test(t) ? 'ja' : 'en');
const tag = (v) => String((v && v.lang) || '').toLowerCase().replace('_', '-');

export function hasJa(voices) { return (Array.isArray(voices) ? voices : []).some((v) => tag(v) === 'ja' || tag(v).startsWith('ja-')); }

export function voiceFor(voices, lang) {
  const vs = (Array.isArray(voices) ? voices : []).filter((v) => tag(v) === lang || tag(v).startsWith(lang + '-'));
  return vs.find((v) => v.localService) || vs[0] || null;
}

export function readLines(e, { sides, point, outletOf = (it) => str(it.media) || str(it.outlet), per = PER } = {}) {
  if (!e || typeof sides !== 'function') return [];
  const out = [];
  const p = typeof point === 'function' ? point(e) : null;
  if (p && str(p.text).trim()) {
    if (p.ai) out.push({ text: 'AI のまとめ', lang: 'ja' });
    else if (str(p.outlet)) out.push({ text: `${p.outlet}の見出し`, lang: 'ja' });
    out.push({ text: p.text.trim(), lang: langOf(p.text) });
  }
  const s = sides(e) || {};
  for (const [k, ja] of SIDE_JA) {
    const list = Array.isArray(s[k]) ? s[k] : [];
    if (!list.length) continue;
    out.push({ text: `${ja}、${list.length}件`, lang: 'ja' });
    for (const it of list.slice(0, per)) {
      const t = str(it && it.title).trim(), o = str(it && outletOf(it)).trim();
      if (!t) continue;
      if (o) out.push({ text: o, lang: langOf(o) });
      out.push({ text: t, lang: langOf(t) });
    }
  }
  return out;
}

export function createReader(win) {
  const ss = win && win.speechSynthesis, U = win && win.SpeechSynthesisUtterance;
  const fns = new Set();
  let voices = [], cur = null;
  const emit = () => { for (const f of fns) { try { f(); } catch { /* one listener does not stop the rest */ } } };
  const load = () => { try { voices = ss.getVoices() || []; } catch { voices = []; } };
  if (ss && U) {
    load();
    try { ss.addEventListener('voiceschanged', () => { load(); emit(); }); } catch { /* old browser: the voices of the first look */ }
  }
  const can = () => !!(ss && U) && hasJa(voices);
  function stop() {
    if (!ss) return;
    cur = null;
    try { ss.cancel(); } catch { /* nothing was being read */ }
    emit();
  }
  function play(key, lines) {
    if (!can()) return false;
    const ls = (Array.isArray(lines) ? lines : []).filter((l) => l && str(l.text).trim());
    if (!ls.length) return false;
    try { ss.cancel(); } catch { /* */ }
    const token = {};
    cur = { key, token };
    ls.forEach((l, i) => {
      const u = new U(l.text), v = voiceFor(voices, l.lang) || voiceFor(voices, 'ja');
      u.lang = v ? v.lang : l.lang === 'en' ? 'en-US' : 'ja-JP';
      if (v) u.voice = v;
      if (i === ls.length - 1) u.onend = u.onerror = () => { if (cur && cur.token === token) { cur = null; emit(); } };
      ss.speak(u);
    });
    emit();
    return true;
  }
  return { can, key: () => (cur ? cur.key : null), onChange: (f) => { fns.add(f); }, toggle: (key, lines) => (cur && cur.key === key ? (stop(), false) : play(key, lines)), stop };
}
