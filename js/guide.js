/* guide — the card read aloud with the device's own voice (Web Speech API: no cost, nothing leaves the browser), with the sentence
 * being read shown as a caption. The script is made by rule from the card's own values; no AI is called and no number is said that
 * the data does not hold. An AI point written by the build is read after the rule's lines, said first to be the AI's.
 * It never starts by itself: only a press starts it (browsers ask for that too).
 *
 *   SILENCE_JA                                     words that say an outlet "did not report"; a line holding one is not read (CONTRACT 18)
 *   scriptOf(pick, { point }) -> [{ text, lang }]  the title, the outlets of each side, the first two findings, then the AI point
 *   cleanScript(lines, silence) -> lines           the lines without a silence word
 *   numbersIn(text) -> ['4', '3', ...]             the figures of a text (for the tests: every one must come from the data)
 *   createGuide({ win, voiceFor, onState, onCaption, onBoundary }) -> { can(), play(key, lines) -> bool, stop(), key() } */

export const SILENCE_JA = ['報じなかった', '報じていない', '報じず', '報じられなかった', '報道しなかった', '報道していない', '報道せず', '伝えなかった', '伝えていない', '黙殺'];
const str = (v) => (typeof v === 'string' ? v : '');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const JA = /[぀-ヿ一-鿿]/;
const langOf = (t) => (JA.test(t) ? 'ja' : 'en');
const end = (t) => (/[。．.!?！？]$/.test(t) ? t : `${t}。`);

export function numbersIn(text) { return (str(text).normalize('NFKC').match(/\d+(?:[.,]\d+)*/g) || []); }

export function cleanScript(lines, silence = SILENCE_JA) {
  const ws = (Array.isArray(silence) ? silence : SILENCE_JA).filter((w) => typeof w === 'string' && w);
  return (Array.isArray(lines) ? lines : []).filter((l) => l && str(l.text).trim() && !ws.some((w) => l.text.includes(w)));
}

export function scriptOf(p, { point = null, silence = SILENCE_JA } = {}) {
  if (!isObj(p) || !isObj(p.title) || !str(p.title.text).trim()) return [];
  const out = [];
  const t = p.title.text.trim();
  if (p.title.ai) out.push({ text: 'AI が付けた見出しです。', lang: 'ja' });
  out.push({ text: langOf(t) === 'ja' ? end(t) : t, lang: langOf(t) });
  const s = isObj(p.sides) ? p.sides : {};
  const n = (k) => (isObj(s[k]) && Number.isInteger(s[k].outlets) ? s[k].outlets : 0);
  const parts = [['jp', '国内'], ['intl', '海外'], ['gov', '官公庁']].filter(([k]) => n(k) > 0).map(([k, ja]) => `${ja} ${n(k)} ${k === 'gov' ? 'か所' : '社'}`);
  if (parts.length) out.push({ text: `${parts.join('、')}。`, lang: 'ja' });
  for (const f of (Array.isArray(p.findings) ? p.findings : []).slice(0, 2)) if (isObj(f) && str(f.text).trim()) out.push({ text: end(f.text.trim()), lang: 'ja' });
  if (isObj(point) && str(point.text).trim()) {
    out.push({ text: point.ai ? 'AI の要点です。' : '要点です。', lang: 'ja' });
    out.push({ text: end(point.text.trim()), lang: langOf(point.text) });
  }
  return cleanScript(out, silence);
}

export function createGuide({ win, voiceFor, onState, onCaption, onBoundary } = {}) {
  const ss = win && win.speechSynthesis, U = win && win.SpeechSynthesisUtterance;
  let voices = [], cur = null;
  const call = (f, ...a) => { if (typeof f === 'function') { try { f(...a); } catch { /* a listener does not stop the reading */ } } };
  const load = () => { try { voices = ss.getVoices() || []; } catch { voices = []; } };
  if (ss && U) { load(); try { ss.addEventListener('voiceschanged', () => { load(); call(onState, cur ? 'speaking' : 'idle'); }); } catch { /* the voices of the first look */ } }
  const pick = (lang) => (typeof voiceFor === 'function' ? voiceFor(voices, lang) || voiceFor(voices, 'ja') : null);
  const can = () => !!(ss && U);
  function finish(token) { if (cur && cur.token === token) { cur = null; call(onCaption, ''); call(onState, 'idle'); } }
  function stop() {
    if (!ss) return;
    const was = cur; cur = null;
    try { ss.cancel(); } catch { /* nothing was being read */ }
    if (was) { call(onCaption, ''); call(onState, 'idle'); }
  }
  function play(key, lines) {
    if (!can()) return false;
    const ls = cleanScript(lines);
    if (!ls.length) return false;
    try { ss.cancel(); } catch { /* */ }
    const token = {};
    cur = { key, token };
    call(onState, 'speaking');
    ls.forEach((l, i) => {
      const u = new U(l.text), v = pick(l.lang);
      u.lang = v ? v.lang : l.lang === 'en' ? 'en-US' : 'ja-JP';
      if (v) u.voice = v;
      u.onstart = () => { if (cur && cur.token === token) call(onCaption, l.text); };
      u.onboundary = () => { if (cur && cur.token === token) call(onBoundary); };
      if (i === ls.length - 1) u.onend = u.onerror = () => finish(token);
      ss.speak(u);
    });
    return true;
  }
  return { can, play, stop, key: () => (cur ? cur.key : null), toggle: (key, lines) => (cur && cur.key === key ? (stop(), false) : play(key, lines)) };
}
