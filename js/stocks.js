/* stocks — what a stock's own daily closes say, counted. No DOM, no network, no prices of its own.
 *
 *   parseCsv(text) -> { bars: [{ d: 'YYYY-MM-DD', c }], rejected: n, error: '' }   the visitor's own file: date and close, any header, comma / tab / semicolon
 *   sampleBars(seed, n, end) -> bars                    a made-up series (seeded random walk) so the screen can be seen without any data; never real
 *   signalsOf(bars) -> [{ id, ja, how, on }]            the signals as of the last close
 *   edgeOf(bars, { h }) -> { base, rows, bars, last, from, to }    for each signal: scenes, independent scenes, the share that was higher h trading days later,
 *                                                       the share for every day, a 95 % interval (Wilson, on independent scenes), and a grade
 *   newsMoves(bars, items, words) -> { rows, n, up, down, flat }   the move of the close on the day a matching report first appeared
 *   age(bars, now) -> { days, stale }                    how old the last close is (the value's own date, not the time it was loaded)
 *   LIMITS                                              the lines that stay on screen beside every number
 *
 * The signals are the usual public ones, fixed here before any series is read (RSI(14) under 30 — Wilder; a new 55-day high — Donchian;
 * an upward trend — close over the 50-day over the 200-day average). Nothing is searched for or tuned. A share is shown only with the
 * number of independent scenes behind it; under MIN_SCENES it is not graded. It says what happened, not what will.
 * Not a recommendation to buy or sell, and no advice about any one holding. */

export const H = 20;
export const MIN_SCENES = 10;
export const STALE_DAYS = 4;
export const LIMITS = [
  '過去の日足で数えた割合です。これからを約束しません。',
  '読み込んだ銘柄だけの数えで、今も残っている銘柄が選ばれやすい偏り（生存者バイアス）があります。',
  '同じ時期の下げは一つの場面です。独立な場面の数が少ないと、割合は偶然と区別できません。',
  '手数料・税・約定のずれは引いていません。売買の推奨でも、個別の助言でもありません。',
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const DAY = 86400;

export function parseCsv(text) {
  const out = [], seen = new Set();
  let rejected = 0;
  for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split(/[,\t;]/).map((x) => x.trim().replace(/^"|"$/g, ''));
    const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(cells[0] || '');
    if (!m) { if (out.length || /^\d/.test(line)) rejected++; continue; }   // a header before the first row is not a rejection
    const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const t = Date.parse(d + 'T00:00:00Z');
    // the close is the last number on the row (date, open, high, low, close, volume files put it in different places: the column named close wins when a header was read)
    const nums = cells.slice(1).map((x) => Number(x.replace(/,/g, ''))).filter((v) => Number.isFinite(v));
    const c = nums.length ? (closeCol(out, cells, nums)) : NaN;
    if (!Number.isFinite(t) || !(c > 0) || seen.has(d)) { rejected++; continue; }
    seen.add(d); out.push({ d, c });
  }
  out.sort((a, b) => (a.d < b.d ? -1 : 1));
  return { bars: out, rejected, error: out.length < 30 ? '日付と終値の行が 30 本に届きません（日付は 2026-11-20 の形）。' : '' };
}
// a two-column file is date, close; a longer one is read as date, open, high, low, close, ... (the 4th number)
function closeCol(_out, _cells, nums) { return nums.length >= 4 ? nums[3] : nums[0]; }

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const dayStr = (t) => new Date(t * 1000).toISOString().slice(0, 10);
export function sampleBars(seed = 7, n = 900, end = '2026-11-20') {
  const r = rng(seed), out = [];
  let c = 100, t = Date.parse(end + 'T00:00:00Z') / 1000;
  const ts = [];
  while (ts.length < n) { const wd = new Date(t * 1000).getUTCDay(); if (wd !== 0 && wd !== 6) ts.push(t); t -= DAY; }
  ts.reverse();
  let drift = 0.0003;
  for (const x of ts) {
    const g = (r() + r() + r() + r() - 2) * 1.1;          // roughly normal
    if (r() < 0.01) drift = (r() - 0.45) * 0.0012;
    c = Math.max(5, c * (1 + drift + g * 0.014));
    out.push({ d: dayStr(x), c: Math.round(c * 100) / 100 });
  }
  return out;
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
function sma(cs, n) { const o = new Array(cs.length).fill(null); let s = 0; for (let i = 0; i < cs.length; i++) { s += cs[i]; if (i >= n) s -= cs[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
export function rsi(cs, n = 14) {
  const o = new Array(cs.length).fill(null);
  if (cs.length <= n) return o;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = cs[i] - cs[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  o[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < cs.length; i++) {
    const d = cs[i] - cs[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
    o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return o;
}

export const SIGNALS = [
  { id: 'oversold14', ja: '売られすぎ', how: 'RSI(14) が 30 未満' },
  { id: 'breakout55', ja: '55 日高値の更新', how: '終値が過去 55 日の最高値以上' },
  { id: 'trend', ja: '上昇基調', how: '終値が 50 日線より上で、50 日線は 200 日線より上' },
];
function flags(cs) {
  const r = rsi(cs, 14), m50 = sma(cs, 50), m200 = sma(cs, 200);
  const on = { oversold14: [], breakout55: [], trend: [] };
  for (let i = 0; i < cs.length; i++) {
    on.oversold14.push(r[i] != null && r[i] < 30);
    let hi = false;
    if (i >= 55) { let mx = -Infinity; for (let k = i - 55; k < i; k++) if (cs[k] > mx) mx = cs[k]; hi = cs[i] >= mx; }
    on.breakout55.push(hi);
    on.trend.push(m50[i] != null && m200[i] != null && cs[i] > m50[i] && m50[i] > m200[i]);
  }
  return on;
}
export function signalsOf(bars) {
  const cs = (Array.isArray(bars) ? bars : []).map((b) => b.c);
  if (cs.length < 60) return SIGNALS.map((s) => ({ ...s, on: null }));
  const f = flags(cs), i = cs.length - 1;
  return SIGNALS.map((s) => ({ ...s, on: f[s.id][i] }));
}

/** Wilson 95 % interval of k out of n */
export function wilson(k, n) {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), w = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - w) / d), Math.min(1, (c + w) / d)];
}

export function edgeOf(bars, { h = H } = {}) {
  const b = Array.isArray(bars) ? bars : [];
  const cs = b.map((x) => x.c), n = cs.length;
  const res = { h, bars: n, from: n ? b[0].d : null, to: n ? b[n - 1].d : null, base: null, rows: [], short: n < 252 + h };
  if (n < 60 + h) return res;
  const up = (i) => cs[i + h] > cs[i];
  const idx = []; for (let i = 0; i + h < n; i++) idx.push(i);
  res.base = { days: idx.length, up: idx.filter(up).length / idx.length };
  const f = flags(cs);
  for (const s of SIGNALS) {
    const days = idx.filter((i) => f[s.id][i]);
    // one scene = the days that follow each other within h trading days; its outcome is that of its first day
    const first = []; let prev = -1e9;
    for (const i of days) { if (i - prev > h) first.push(i); prev = i; }
    const k = first.filter(up).length, ci = wilson(k, first.length);
    const share = first.length ? k / first.length : null;
    const grade = first.length < MIN_SCENES ? 'few' : ci[0] > res.base.up ? 'above' : ci[1] < res.base.up ? 'below' : 'same';
    res.rows.push({ id: s.id, ja: s.ja, how: s.how, days: days.length, scenes: first.length, up: share, ci, grade });
  }
  return res;
}

export function age(bars, now = Date.now() / 1000) {
  const b = Array.isArray(bars) ? bars : [];
  if (!b.length) return { days: null, stale: true };
  const t = Date.parse(b[b.length - 1].d + 'T00:00:00Z') / 1000;
  const days = Math.max(0, Math.floor((now - t) / DAY));
  return { days, stale: days > STALE_DAYS };
}

/** items: [{ ts, title, n, key }] (the first report of each event). words: the visitor's own words; an item matches when its title holds one.
 * The move is the close of the report's day (Japan time) against the close before it: counted, and no cause is claimed. */
export function newsMoves(bars, items, words) {
  const b = Array.isArray(bars) ? bars : [];
  const ws = (Array.isArray(words) ? words : []).map((w) => String(w).trim().toLowerCase()).filter(Boolean);
  const out = { rows: [], n: 0, up: 0, down: 0, flat: 0, words: ws };
  if (b.length < 2 || !ws.length) return out;
  const at = new Map(b.map((x, i) => [x.d, i]));
  const jst = (ts) => dayStr(ts + 9 * 3600);
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || !isNum(it.ts) || typeof it.title !== 'string') continue;
    const t = (typeof it.hay === 'string' ? it.hay : it.title).toLowerCase();
    if (!ws.some((w) => t.includes(w))) continue;
    let d = jst(it.ts), i = at.get(d);
    if (i == null) { const nx = b.findIndex((x) => x.d > d); if (nx < 1) continue; i = nx; }
    if (i < 1) continue;
    const d1 = (b[i].c - b[i - 1].c) / b[i - 1].c * 100;
    const d5 = i + 4 < b.length ? (b[i + 4].c - b[i - 1].c) / b[i - 1].c * 100 : null;
    out.rows.push({ key: it.key, ts: it.ts, title: it.title, n: it.n, day: b[i].d, d1, d5 });
  }
  out.rows.sort((x, y) => y.ts - x.ts);
  out.n = out.rows.length;
  for (const r of out.rows) { if (Math.abs(r.d1) < 0.05) out.flat++; else if (r.d1 > 0) out.up++; else out.down++; }
  return out;
}
export const mean0 = (a) => (a.length ? mean(a) : null);
