// What the own-AI requests cost before and after js/slim.js, on a data file the build wrote (parallax/1).
//   node tools/measure_tokens.mjs <path to pub_latest.json or latest.json> [--json]
// No network, no key, no AI. Tokens are js/slim.js estimateTokens (a rule of thumb); characters are exact.
// The cut keeps at most 10 reports (the same ceiling as before) but picks the 10 that add the most, instead of the first 10 by time.
// "facts kept" = of the numbers, Latin words and katakana runs of 3+ characters in the full material of an event (every headline and description),
// how many are still in what is sent. This is the check that the cut leaves what a summary needs; it is not a judgement of the AI's answer.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateTokens, compactDoc, expandDoc, COMPACT_NOTE, outputCap, slimEvent, norm } from '../js/slim.js';
import { askInput, ASK_SYSTEM, systemFor, slimInput, MODE_LIMITS } from '../js/ownai.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
if (!file) { console.error('usage: node tools/measure_tokens.mjs <data.json> [--json]'); process.exit(2); }
const data = JSON.parse(readFileSync(file, 'utf8'));
const prompt = JSON.parse(readFileSync(path.join(ROOT, 'data', 'prompt.json'), 'utf8'));
const items = data.items;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

const facts = (text) => {
  const s = text.normalize('NFKC');
  const out = new Set();
  for (const m of s.matchAll(/\d[\d,.]*/g)) out.add(m[0].replace(/[,.]+$/, ''));
  for (const m of s.matchAll(/[A-Za-z][A-Za-z'’-]{2,}/g)) out.add(m[0].toLowerCase());
  for (const m of s.matchAll(/[ァ-ヺー]{3,}/gu)) out.add(m[0]);
  return out;
};

// ---- (A) one event asked of the viewer's own AI: the 40 events with the most outlets
const events = data.stories.filter((s) => s.n_outlets >= 2).slice(0, 40).map((s) => {
  const ms = s.member_ids.map((i) => items[i]).filter(Boolean).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const seen = new Set();
  const list = ms.filter((it) => { const o = it.media || it.outlet; if (seen.has(o)) return false; seen.add(o); return true; })
    .map((it) => ({ outlet: it.media || it.outlet, title: it.title || '', desc: it.desc || '' }));
  return { heading: (s.ai && s.ai.headline_ja) || list[0].title, items: list };
});
const rowsA = events.map((ev) => {
  const before = ASK_SYSTEM + askInput(ev);
  const sl = slimEvent(ev, { maxItems: 10 });
  const after = systemFor('compare', false) + slimInput(sl.heading, sl.reports, sl.total, {});
  const full = facts(ev.items.map((r) => `${r.title}\n${r.desc}`).join('\n'));
  const kept = facts(after);
  const lost = [...full].filter((f) => !kept.has(f));
  const old = facts(askInput(ev));                                  // what the request before the cut already carried
  const lostOld = [...old].filter((f) => !kept.has(f));
  const outletsAfter = new Set(sl.reports.flatMap((r) => r.outlets));
  return { n: ev.items.length, sent: sl.stats.sent, tb: estimateTokens(before), ta: estimateTokens(after), cb: [...before].length, ca: [...after].length,
    factsKept: full.size ? (full.size - lost.length) / full.size : 1, lost, lostOld, oldSize: old.size, outletsKept: ev.items.filter((r) => outletsAfter.has(r.outlet)).length / ev.items.length,
    descBefore: sl.stats.descCharsBefore, descAfter: sl.stats.descCharsAfter };
});
const A = {
  events: rowsA.length, reportsIn: sum(rowsA.map((r) => r.n)), reportsSent: sum(rowsA.map((r) => r.sent)),
  tokensBefore: sum(rowsA.map((r) => r.tb)), tokensAfter: sum(rowsA.map((r) => r.ta)), charsBefore: sum(rowsA.map((r) => r.cb)), charsAfter: sum(rowsA.map((r) => r.ca)),
  medianBefore: med(rowsA.map((r) => r.tb)), medianAfter: med(rowsA.map((r) => r.ta)),
  descCharsBefore: sum(rowsA.map((r) => r.descBefore)), descCharsAfter: sum(rowsA.map((r) => r.descAfter)),
  factsKeptMean: sum(rowsA.map((r) => r.factsKept)) / rowsA.length, factsKeptMin: Math.min(...rowsA.map((r) => r.factsKept)),
  eventsWithLostFacts: rowsA.filter((r) => r.lost.length).length, eventsLosingFromOld: rowsA.filter((r) => r.lostOld.length).length, factsOldTotal: sum(rowsA.map((r) => r.oldSize)), factsLostFromOld: sum(rowsA.map((r) => r.lostOld.length)),
  oldLostExamples: rowsA.filter((r) => r.lostOld.length).slice(0, 5).map((r) => r.lostOld.slice(0, 6)), outletsKeptMin: Math.min(...rowsA.map((r) => r.outletsKept)),
  lostExamples: rowsA.filter((r) => r.lost.length).slice(0, 5).map((r) => r.lost.slice(0, 6)),
  outputCeiling: { before: 600, after: MODE_LIMITS.compare.tokens },
};

// ---- (B) the bundling request a viewer's key re-runs (data.ai_requests)
const rowsB = (data.ai_requests || []).map((rq) => {
  const doc = JSON.parse(rq.doc);
  const nItems = sum(doc.blocks.map((b) => b.items.length));
  const before = prompt.system + prompt.user_template.split('{DOC}').join(rq.doc);
  const cdoc = compactDoc(rq.doc);
  const after = prompt.system + '\n' + COMPACT_NOTE + prompt.user_template.split('{DOC}').join(cdoc);
  const exact = JSON.stringify(expandDoc(cdoc)) === JSON.stringify(doc);
  // identical headlines inside a block (after folding): what a twin merge could remove
  const twins = sum(doc.blocks.map((b) => b.items.length - new Set(b.items.map((i) => norm(i.title))).size));
  return { rid: rq.rid, nItems, tb: estimateTokens(before), ta: estimateTokens(after), cb: [...before].length, ca: [...after].length, docB: [...rq.doc].length, docA: [...cdoc].length, exact, twins,
    capBefore: prompt.max_output_tokens, capAfter: outputCap(nItems, prompt.max_output_tokens) };
});
const B = { requests: rowsB, tokensBefore: sum(rowsB.map((r) => r.tb)), tokensAfter: sum(rowsB.map((r) => r.ta)), allExact: rowsB.every((r) => r.exact) };

const out = { file: path.basename(file), A, B };
if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
const pct = (a, b) => `${((1 - b / a) * 100).toFixed(1)}%`;
console.log(`file ${out.file}`);
console.log(`(A) one event asked, ${A.events} events, ${A.reportsIn} reports in, ${A.reportsSent} sent`);
console.log(`    tokens ${A.tokensBefore} -> ${A.tokensAfter} (-${pct(A.tokensBefore, A.tokensAfter)}), chars ${A.charsBefore} -> ${A.charsAfter}; median per ask ${A.medianBefore} -> ${A.medianAfter}`);
console.log(`    description chars ${A.descCharsBefore} -> ${A.descCharsAfter}; answer ceiling ${A.outputCeiling.before} -> ${A.outputCeiling.after}`);
console.log(`    facts kept: mean ${(A.factsKeptMean * 100).toFixed(1)}%, min ${(A.factsKeptMin * 100).toFixed(1)}%, events losing any ${A.eventsWithLostFacts}; outlets kept (min) ${(A.outletsKeptMin * 100).toFixed(0)}%`);
console.log(`    against the request before the cut: ${A.factsOldTotal} facts in it, ${A.factsLostFromOld} not in the new one (${A.eventsLosingFromOld} events); examples ${JSON.stringify(A.oldLostExamples)}`);
console.log(`(B) bundling requests`);
for (const r of rowsB) console.log(`    ${r.rid}: ${r.nItems} items, doc chars ${r.docB} -> ${r.docA}, tokens ${r.tb} -> ${r.ta} (-${pct(r.tb, r.ta)}), round trip exact ${r.exact}, identical headlines ${r.twins}, answer ceiling ${r.capBefore} -> ${r.capAfter}`);
console.log(`    total tokens ${B.tokensBefore} -> ${B.tokensAfter} (-${pct(B.tokensBefore, B.tokensAfter)})`);
