/* slim — cuts the material before it goes to a viewer's own AI, so the same answer costs fewer tokens.
 * No DOM, no network, no key. Every step only removes or regroups what the page already shows; nothing is added, nothing is rewritten.
 *
 *   estimateTokens(text) -> number           a rough count (see below); the exact count is the provider's
 *   norm(title) -> string                    a headline folded for comparing: width, case, brackets, a trailing "- outlet", punctuation
 *   dice(a, b) -> 0..1                       overlap of two folded headlines (character bigrams)
 *   bundleReports(items, { near }) -> [{ outlets, title, desc }]     the same headline from several outlets is sent once, with all the outlets
 *   trimDesc(desc, title, ctx, { chars }) -> string                  the sentences of a description that say something the headline does not
 *   textRank(sentences) -> [score]            sentence scores by PageRank over word overlap (for a description of three sentences or more)
 *   slimEvent(ev, { maxItems, descChars }) -> { heading, reports, total, shown, stats }
 *   diffReports(prevKeys, reports) -> { added, kept }                what is new since the last ask of the same event
 *   compactDoc(docText) -> string / expandDoc(text) -> doc           the bundling request with the outlet facts written once (lossless)
 *   askCache(storage, opts) -> { get, put, prev, setPrev, clear }    a answer already given is not asked for twice (this browser only)
 *
 * Tokens: a character of Japanese is counted as 1, a letter or digit of ASCII as 0.25 and other marks as 0.5. That is a rule of thumb
 * (within about 25% for Gemini, Claude and GPT tokenizers), good for comparing a request before and after; it is not a bill. */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function estimateTokens(text) {
  if (typeof text !== 'string') return 0;
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c < 0x80) n += /[A-Za-z0-9]/.test(ch) ? 0.25 : /\s/.test(ch) ? 0.1 : 0.5;
    else n += 1;
  }
  return Math.ceil(n);
}

// ---------------------------------------------------------------- folding and overlap
const BRACKET_HEAD = /^\s*(?:[【\[［(（〈《][^】\]］)）〉》]{1,12}[】\]］)）〉》]\s*)+/u;
const OUTLET_TAIL = /\s+[-–—|]\s+[^-–—|]{1,24}$|\s*[｜|]\s*[^｜|]{1,24}$/u;

/** a headline folded for comparing; two reports whose folded headlines are equal say the same thing in the same words */
export function norm(title) {
  let s = typeof title === 'string' ? title.normalize('NFKC') : '';
  s = s.replace(BRACKET_HEAD, '').replace(OUTLET_TAIL, '').toLowerCase();
  return s.replace(/[^\p{L}\p{N}]+/gu, '');
}

const HIRA = /^[ぁ-ゟ]$/u;
/** the units a text is compared by: Latin words and numbers whole, Japanese as pairs of characters (a pair of hiragana is a particle, left out) */
export function units(text) {
  const s = (typeof text === 'string' ? text : '').normalize('NFKC').toLowerCase();
  const out = [];
  for (const m of s.matchAll(/[a-z0-9][a-z0-9.'’-]*|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu)) {
    const w = m[0];
    if (/^[a-z0-9]/.test(w)) { if (w.length > 1 || /\d/.test(w)) out.push(w); continue; }
    const cs = [...w];
    if (cs.length === 1) { if (!HIRA.test(cs[0])) out.push(cs[0]); continue; }
    for (let i = 0; i + 1 < cs.length; i++) if (!(HIRA.test(cs[i]) && HIRA.test(cs[i + 1]))) out.push(cs[i] + cs[i + 1]);
  }
  return out;
}

const bigramSet = (s) => {
  const cs = [...s], out = new Set();
  if (cs.length < 2) { if (cs.length) out.add(cs[0]); return out; }
  for (let i = 0; i + 1 < cs.length; i++) out.add(cs[i] + cs[i + 1]);
  return out;
};
/** 2|A∩B| / (|A|+|B|) of the character pairs of two folded strings */
export function dice(a, b) {
  if (a === b) return a ? 1 : 0;
  const x = bigramSet(a), y = bigramSet(b);
  if (!x.size || !y.size) return 0;
  let hit = 0;
  for (const g of x) if (y.has(g)) hit++;
  return (2 * hit) / (x.size + y.size);
}

// ---------------------------------------------------------------- the same headline from several outlets
/** items: [{ outlet, title, desc }] in the order the page shows them. Headlines that fold to the same string, or overlap by `near` or more,
 *  become one report with every outlet's name, in the order of the first one. A description is kept from the first report that has one. */
export function bundleReports(items, opts) {
  const near = opts && Number.isFinite(opts.near) ? opts.near : 0.86;
  const groups = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!isObj(it)) continue;
    const outlet = typeof it.outlet === 'string' ? it.outlet.trim() : '';
    const title = typeof it.title === 'string' ? it.title.trim() : '';
    const desc = typeof it.desc === 'string' ? it.desc.trim() : '';
    if (!outlet && !title && !desc) continue;
    const k = norm(title);
    const g = k.length >= 6 ? groups.find((x) => x.k === k || dice(x.k, k) >= near) : null;
    if (g) { if (outlet && !g.outlets.includes(outlet)) g.outlets.push(outlet); if (!g.desc && desc) g.desc = desc; continue; }
    groups.push({ k, outlets: outlet ? [outlet] : [], title, desc });
  }
  return groups.map(({ outlets, title, desc }) => ({ outlets, title, desc }));
}

// ---------------------------------------------------------------- a description: only what the headline does not already say
const SENT = /[^。！？!?\n]+[。！？!?]?/gu;
export const sentences = (text) => ((typeof text === 'string' ? text : '').match(SENT) || []).map((x) => x.trim()).filter(Boolean);

/** PageRank over the overlap of the words of each sentence. A sentence that shares words with many others scores high. */
export function textRank(sents, opts) {
  const n = sents.length;
  if (n < 2) return sents.map(() => 1);
  const damping = opts && Number.isFinite(opts.damping) ? opts.damping : 0.85;
  const sets = sents.map((s) => new Set(units(s)));
  const w = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = sets[i], b = sets[j];
    if (!a.size || !b.size) continue;
    let hit = 0;
    for (const t of a) if (b.has(t)) hit++;
    const sim = hit / (Math.log(a.size + 1) + Math.log(b.size + 1) || 1);
    w[i][j] = w[j][i] = sim;
  }
  const out = w.map((row) => row.reduce((s, v) => s + v, 0));
  let r = new Array(n).fill(1 / n);
  for (let it = 0; it < 40; it++) {
    const next = r.map((_, i) => (1 - damping) / n + damping * w.reduce((s, row, j) => s + (out[j] ? (row[i] / out[j]) * r[j] : 0), 0));
    const d = next.reduce((s, v, i) => s + Math.abs(v - r[i]), 0);
    r = next;
    if (d < 1e-6) break;
  }
  return r;
}

/** a length in "Japanese characters": one for a character of Japanese, 0.4 for any other (English runs about 2.5 characters to a Japanese one) */
export const weighted = (s) => { let n = 0; for (const ch of s) n += ch.codePointAt(0) < 0x2000 ? 0.4 : 1; return n; };

/** ctx: { idf(unit) -> weight, seen: Set of units already sent }. Returns the kept sentences joined, at most `chars` characters, in their original order. */
export function trimDesc(desc, title, ctx, opts) {
  const chars = opts && Number.isFinite(opts.chars) ? opts.chars : 90;
  const sents = sentences(desc);
  if (!sents.length) return '';
  const inTitle = new Set(units(title));
  const idf = ctx && typeof ctx.idf === 'function' ? ctx.idf : () => 1;
  const seen = ctx && ctx.seen instanceof Set ? ctx.seen : new Set();
  const rank = sents.length >= 3 ? textRank(sents) : sents.map(() => 1);
  const scored = sents.map((s, i) => {
    const us = [...new Set(units(s))];
    if (!us.length) return { i, s, score: 0 };
    const fresh = us.filter((u) => !inTitle.has(u));
    const novel = fresh.filter((u) => !seen.has(u));
    // a sentence the headline already covers (4/5 or more of its words), or one whose words an earlier report already carried (fewer than two new, or under a tenth), adds nothing
    if (fresh.length / us.length < 0.2 || novel.length < 2 || novel.length / us.length < 0.1) return { i, s, score: 0 };
    const gain = novel.reduce((a, u) => a + idf(u), 0);
    return { i, s, score: (gain / Math.sqrt(us.length)) * (rank[i] * sents.length) };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i);
  const keep = [];
  let used = 0;
  for (const x of scored) {
    const add = weighted(x.s);
    if (used + add > chars) { if (!keep.length) { let t = '', w = 0; for (const ch of x.s) { w += ch.codePointAt(0) < 0x2000 ? 0.4 : 1; if (w > chars - 1) break; t += ch; } keep.push({ i: x.i, s: t + '…' }); used = chars; } continue; }
    keep.push(x); used += add;
  }
  keep.sort((a, b) => a.i - b.i);
  for (const x of keep) for (const u of units(x.s)) seen.add(u);
  return keep.map((x) => x.s).join('');
}

// ---------------------------------------------------------------- one event
/** ev: { heading, items: [{ outlet, title, desc }] }. -> the reports to send, at most maxItems, each with the sentences that matter */
export function slimEvent(ev, opts) {
  const o = isObj(opts) ? opts : {};
  const maxItems = Number.isInteger(o.maxItems) && o.maxItems > 0 ? o.maxItems : 8;
  const descChars = Number.isInteger(o.descChars) && o.descChars >= 0 ? o.descChars : 90;
  const e = isObj(ev) ? ev : {};
  const raw = (Array.isArray(e.items) ? e.items : []).filter(isObj);
  const bundled = bundleReports(raw);
  // document frequency over the whole event: a unit in every report is a given, a unit in one is news
  const docs = bundled.map((r) => new Set(units(`${r.title} ${r.desc}`)));
  const df = new Map();
  for (const d of docs) for (const u of d) df.set(u, (df.get(u) || 0) + 1);
  const N = Math.max(1, docs.length);
  const idf = (u) => Math.log(1 + N / (df.get(u) || 1));
  // every headline is sent whole, so its units count as seen before any description is judged: a sentence that only repeats a headline is dropped
  const seen = new Set(bundled.flatMap((r) => units(r.title)));
  const ctx = { idf, seen };
  let descDropped = 0, descCharsBefore = 0, descCharsAfter = 0;
  const trimmed = bundled.map((r) => {
    const d = r.desc ? trimDesc(r.desc, r.title, ctx, { chars: descChars }) : '';
    if (r.desc) { descCharsBefore += [...r.desc].length; descCharsAfter += [...d].length; if (!d) descDropped++; }
    return { ...r, desc: d };
  });
  let reports = trimmed;
  if (reports.length > maxItems) {
    // greedy cover: the first report, then each time the one that brings the most units not yet covered
    const us = reports.map((r) => [...new Set(units(`${r.title} ${r.desc}`))]);
    const chosen = [0], covered = new Set(us[0]);
    while (chosen.length < maxItems) {
      let best = -1, bestGain = -1;
      for (let i = 0; i < reports.length; i++) {
        if (chosen.includes(i)) continue;
        const g = us[i].reduce((a, u) => a + (covered.has(u) ? 0 : idf(u)), 0);
        if (g > bestGain) { bestGain = g; best = i; }
      }
      if (best < 0) break;
      chosen.push(best); for (const u of us[best]) covered.add(u);
    }
    reports = chosen.sort((a, b) => a - b).map((i) => reports[i]);
  }
  return {
    heading: typeof e.heading === 'string' ? e.heading : '',
    reports,
    total: raw.length,
    shown: reports.reduce((a, r) => a + Math.max(1, r.outlets.length), 0),
    stats: { in: raw.length, bundled: bundled.length, sent: reports.length, descDropped, descCharsBefore, descCharsAfter },
  };
}

/** what is new since the last ask of the same event. prevKeys: norm() of the reports of that ask. */
export function diffReports(prevKeys, reports) {
  const prev = new Set(Array.isArray(prevKeys) ? prevKeys : []);
  const added = [], kept = [];
  for (const r of Array.isArray(reports) ? reports : []) (prev.has(norm(r.title)) ? kept : added).push(r);
  return { added, kept };
}

// ---------------------------------------------------------------- the bundling request: the facts of an outlet written once
/** docOrText: the `doc` of one ai_requests entry (its text, or already parsed). blocks[].items[] = { id, outlet, home, lang, type, title } become [id, outletIndex, lang, title]
 *  and "outlets" lists [outlet, home, type] once. expandDoc gives the original back exactly (the tests hold it to that). */
export function compactDoc(docOrText) {
  const doc = typeof docOrText === 'string' ? JSON.parse(docOrText) : docOrText;
  const table = [], index = new Map();
  const blocks = doc.blocks.map((b) => ({
    ...b,
    items: b.items.map((it) => {
      const k = JSON.stringify([it.outlet, it.home, it.type]);
      if (!index.has(k)) { index.set(k, table.length); table.push([it.outlet, it.home, it.type]); }
      return [it.id, index.get(k), it.lang, it.title];
    }),
  }));
  return JSON.stringify({ outlets: table, blocks });
}
export function expandDoc(text) {
  const c = JSON.parse(text);
  return { blocks: c.blocks.map((b) => ({ ...b, items: b.items.map(([id, oi, lang, title]) => ({ id, outlet: c.outlets[oi][0], home: c.outlets[oi][1], lang, type: c.outlets[oi][2], title })) })) };
}
/** said once, after the instruction, when the compact form is sent */
export const COMPACT_NOTE = 'The document is written compactly: "outlets" lists [outlet, home, type] once, and each item of a block is [id, index into outlets, lang, title]. Read an item as having that outlet, home and type.';

/** the most an answer can need, so a runaway answer stops early: about 420 tokens for each item, never above the model's own ceiling */
export function outputCap(nItems, ceiling) {
  const top = Number.isInteger(ceiling) && ceiling > 0 ? ceiling : 65536;
  return Math.min(top, Math.max(8192, Math.ceil(nItems * 420)));
}

// ---------------------------------------------------------------- an answer already given
/** cyrb53: a small non-secure hash, for a key in a table (never for a secret) */
export function hash(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const CACHE_KEY = 'parallax.ownai.cache.v1';
/** Kept in the viewer's browser only. Answers: at most `max`, each for `ttlMs`. prev: the last answer of each event and mode, for a diff.
 *  No key is ever in it. storage may be missing or throw: then it is a table in memory for this visit. */
export function askCache(storage, opts) {
  const o = isObj(opts) ? opts : {};
  const max = Number.isInteger(o.max) && o.max > 0 ? o.max : 40;
  const ttl = Number.isFinite(o.ttlMs) && o.ttlMs > 0 ? o.ttlMs : 6 * 3600 * 1000;
  const now = typeof o.now === 'function' ? o.now : () => Date.now();
  let mem = { a: {}, p: {} };
  const read = () => {
    try {
      const raw = storage ? storage.getItem(CACHE_KEY) : null;
      const j = raw ? JSON.parse(raw) : null;
      if (isObj(j) && isObj(j.a) && isObj(j.p)) return j;
    } catch { /* fall through */ }
    return mem;
  };
  const write = (j) => {
    mem = j;
    try { if (storage) storage.setItem(CACHE_KEY, JSON.stringify(j)); } catch { /* memory only */ }
  };
  const fresh = (j) => {
    const t = now();
    for (const m of ['a', 'p']) for (const [k, v] of Object.entries(j[m])) if (!isObj(v) || !Number.isFinite(v.at) || t - v.at > ttl) delete j[m][k];
    for (const m of ['a', 'p']) {
      const ks = Object.keys(j[m]);
      if (ks.length > max) for (const k of ks.sort((x, y) => j[m][x].at - j[m][y].at).slice(0, ks.length - max)) delete j[m][k];
    }
    return j;
  };
  const okLines = (v) => isObj(v) && Array.isArray(v.lines) && v.lines.every((x) => typeof x === 'string');
  return {
    get(key) { const j = fresh(read()); const v = j.a[key]; return okLines(v) ? v.lines : null; },
    put(key, lines) { const j = fresh(read()); j.a[key] = { lines, at: now() }; write(fresh(j)); },
    prev(key) { const j = fresh(read()); const v = j.p[key]; return okLines(v) && Array.isArray(v.keys) ? v : null; },
    setPrev(key, keys, lines) { const j = fresh(read()); j.p[key] = { keys, lines, at: now() }; write(fresh(j)); },
    clear() { mem = { a: {}, p: {} }; try { if (storage) storage.removeItem(CACHE_KEY); } catch { /* nothing to clear */ } },
  };
}
