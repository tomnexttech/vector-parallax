/* rerun — 閲覧者の鍵（BYOK）で AI をやり直し、stories を組み直す。parallax/build.py の assemble_stories と同じ組み方。
 *
 *   rerunAI(data, provider, { onProgress, prompt, now }) -> Promise<parallax/1 のデータ>
 *
 * - data は読み込んだ parallax/1。data.ai_requests を順に provider.call へ送る（公開版では、見出しを全部載せてよい塊だけの要求）。
 * - 通った塊は validate.js の結果で、落ちた塊（呼びの失敗・JSON 崩れ・形の崩れ・答えに無い塊）は規則の束へ戻して FALLBACK にする。
 *   今回の呼びで送らなかった塊は規則の束のまま（bid は null = NOT SENT）。記録済みの AI の文は混ぜない（鍵の持ち主の結果だけを YOUR KEY と呼ぶため）。
 * - ai_run の provider・model・at・counts を更新する。status: 全部失敗 error / 一部失敗 partial / それ以外 ok。
 * - basis（束ねた理由）は、同じ顔ぶれの story が元のデータにあればそれを写し（by だけ今の origin に）、無ければ null（docs/CONTRACT-public.md §2）。
 * - onProgress({ rid, done, total, err, phase }): 各要求の前（phase 'start'・done は終えた数）と後（phase 'end'・err は符号か ''）に呼ぶ。
 * - data が前回の AI の見方を保っている（ai_run.status が kept_previous で ai_snapshot がある）時も、元は今の取得の items・rule_clusters だけを使い、
 *   出力に ai_snapshot は残さない（古い AI の束を、鍵の持ち主の結果に混ぜない。CONTRACT §12）。
 * - 元の data は書き換えない。
 * - 送る前に js/slim.js で材料を削る（options.compact を false にすると削らない）：各見出しに付く媒体の facts（媒体名・国内か海外か・種類）を
 *   表に一度だけ書き、見出しは [id, 表の番号, lang, 見出し] の一行にする。元の doc に戻せる形（試験で一字違わず戻ることを確かめる）。
 *   答えの上限も、見出しの数から要る分（1 件 420 トークン、下限 8192）に絞る。検査（validate）は元の要求で行うので、答えの読み方は変わらない。 */

import { validate } from './validate.js';
import { compactDoc, COMPACT_NOTE, outputCap } from './slim.js';

// cluster.type_rank と同じ表（parallax/cluster.py の TYPE_RANK・_OTHER_RANK）。試験で Python の結果と突き合わせる
const TYPE_RANK = { '政府一次': 0, '通信社': 1, '公共放送': 2, '海外公共': 2, '全国紙': 3, '経済紙': 4, '地方紙': 5, '集約': 8 };
const OTHER_RANK = 6;
const typeRank = (ty) => (Object.prototype.hasOwnProperty.call(TYPE_RANK, ty) ? TYPE_RANK[ty] : OTHER_RANK);

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------- SHA-1（sid 用・secure context に頼らない純 JS）
export function sha1hex(text) {
  const bytes = new TextEncoder().encode(text);
  const n = bytes.length;
  const padded = new Uint8Array(((n + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[n] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor((n * 8) / 0x100000000));
  dv.setUint32(padded.length - 4, (n * 8) >>> 0);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  const rol = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (rol(a, 5) + (f >>> 0) + e + k + w[i]) >>> 0;
      e = d; d = c; c = rol(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('');
}

// ---------------------------------------------------------------- stories の組み立て（build.story_from / assemble_stories）
const memberCmp = (items) => (a, b) => {
  const x = items[a], y = items[b];
  return typeRank(x.type) - typeRank(y.type) || x.ts - y.ts || cmp(a, b);
};

function storyFrom(memberIds, origin, bid, ai, items, cidOf, baseBasis) {
  const ids = [...memberIds].sort(memberCmp(items));
  const its = ids.map((i) => items[i]);
  const outlets = [];
  for (const it of its) if (!outlets.includes(it.outlet)) outlets.push(it.outlet);
  const ruleCids = [];
  for (const i of ids) if (!ruleCids.includes(cidOf.get(i))) ruleCids.push(cidOf.get(i));
  const tss = its.map((it) => it.ts);
  const first = Math.min(...tss), last = Math.max(...tss);
  const sid = 's' + sha1hex([...ids].sort().join('|')).slice(0, 12);
  let basis = null;
  const twin = baseBasis.get(sid);
  if (ids.length >= 2 && twin) basis = { ...twin, by: origin, words: [...twin.words], places: [...twin.places] };
  return {
    sid, origin, bid, rule_cids: ruleCids, member_ids: ids, outlets, n_outlets: outlets.length,
    homes: [...new Set(its.map((it) => it.home))].sort(), langs: [...new Set(its.map((it) => it.lang))].sort(),
    first_ts: first, last_ts: last, ai, basis,
  };
}

export function assembleStories(ruleClusters, blocks, blockResults, items, baseBasis) {
  const bb = baseBasis || new Map();
  const cidOf = new Map();
  for (const r of ruleClusters) for (const i of r.member_ids) cidOf.set(i, r.cid);
  const rc = new Map(ruleClusters.map((r) => [r.cid, r]));
  const inBlock = new Set(blocks.flatMap((b) => b.cids));
  const stories = [];
  for (const b of blocks) {
    const res = Object.prototype.hasOwnProperty.call(blockResults, b.bid) ? blockResults[b.bid] : null;
    if (res === null) {
      for (const cid of b.cids) stories.push(storyFrom(rc.get(cid).member_ids, 'rule', b.bid, null, items, cidOf, bb));
    } else {
      for (const r of res) stories.push(storyFrom(r.member_ids, r.origin, b.bid, r.ai, items, cidOf, bb));
    }
  }
  for (const r of ruleClusters) if (!inBlock.has(r.cid)) stories.push(storyFrom(r.member_ids, 'rule', null, null, items, cidOf, bb));
  stories.sort((a, b) => (b.n_outlets - a.n_outlets) || (b.last_ts - a.last_ts) || cmp(a.sid, b.sid));
  const merges = stories.filter((s) => s.origin === 'ai' && s.rule_cids.length >= 2).length;
  const where = new Map();
  for (const s of stories) {
    if (s.origin !== 'ai') continue;
    for (const c of s.rule_cids) { if (!where.has(c)) where.set(c, new Set()); where.get(c).add(s.sid); }
  }
  const splits = [...where.values()].filter((v) => v.size >= 2).length;
  return { stories, merges, splits };
}

// ---------------------------------------------------------------- prompt
async function loadPrompt() {
  const res = await fetch(new URL('../data/prompt.json', import.meta.url), { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) throw new Error('prompt.json HTTP ' + res.status);
  return res.json();
}

const userTextOf = (prompt, doc) => String(prompt.user_template).split('{DOC}').join(doc);

// ---------------------------------------------------------------- 本体
export async function rerunAI(data, provider, options) {
  const opt = isObj(options) ? options : {};
  if (!isObj(data) || !isObj(data.items) || !Array.isArray(data.rule_clusters)) throw new Error('data is not parallax/1');
  if (!provider || typeof provider.call !== 'function') throw new Error('provider has no call');
  const progress = typeof opt.onProgress === 'function' ? opt.onProgress : () => {};
  const prompt = isObj(opt.prompt) ? opt.prompt : await loadPrompt();
  const now = Number.isFinite(opt.now) ? Math.floor(opt.now) : Math.floor(Date.now() / 1000);
  const requests = (Array.isArray(data.ai_requests) ? data.ai_requests : [])
    .filter((r) => isObj(r) && typeof r.doc === 'string' && isObj(r.alias) && Array.isArray(r.bids));

  const run = { calls: 0, calls_failed: 0, errors: [], blocks_sent: 0, blocks_ok: 0,
    dropped_ids: 0, dup_ids: 0, unassigned_ids: 0, flags_vetoed: 0, quoted_fields: 0, report_words: 0, silence_words: 0 };
  const results = {};
  const sent = new Set();
  const maxTokens = Number.isInteger(prompt.max_output_tokens) ? prompt.max_output_tokens : undefined;

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];
    const total = requests.length;
    progress({ rid: req.rid, done: i, total, err: '', phase: 'start' });
    run.calls += 1;
    run.blocks_sent += req.bids.length;
    for (const b of req.bids) sent.add(b);
    let reply;
    let system = prompt.system, doc = req.doc, cap = maxTokens;
    if (opt.compact !== false) {
      try {
        const parsed = JSON.parse(req.doc);
        doc = compactDoc(parsed); system = `${prompt.system}
${COMPACT_NOTE}`;
        cap = outputCap(parsed.blocks.reduce((a, b) => a + b.items.length, 0), maxTokens);
      } catch { doc = req.doc; system = prompt.system; cap = maxTokens; }   // a request that is not in the usual shape goes as it is
    }
    try {
      reply = await provider.call(system, userTextOf(prompt, doc), prompt.schema, { maxOutputTokens: cap });
    } catch {
      reply = { raw: null, err: 'network' };
    }
    let err = '';
    const raw = isObj(reply) ? reply.raw : null;
    const perr = isObj(reply) && reply.err ? String(reply.err) : '';
    if (perr || typeof raw !== 'string') {
      err = perr || 'shape';
      run.calls_failed += 1;
      run.errors.push(err);
    } else {
      const res = validate(req, raw, prompt, data.items);
      if (res.errors.length) {
        err = res.errors[0];
        run.calls_failed += 1;
        run.errors.push(...res.errors);
      } else {
        for (const [k, v] of Object.entries(res.counts)) run[k] += v;
        run.blocks_ok += Object.keys(res.blocks).length;
        Object.assign(results, res.blocks);
      }
    }
    progress({ rid: req.rid, done: i + 1, total, err, phase: 'end' });
  }

  // 今回の呼びで送った塊だけを blocks に残す（送らなかった束は規則のまま = NOT SENT）
  const blocks = (Array.isArray(data.blocks) ? data.blocks : [])
    .filter((b) => isObj(b) && sent.has(b.bid))
    .map((b) => ({ bid: b.bid, cids: [...b.cids], why: b.why, ai: Object.prototype.hasOwnProperty.call(results, b.bid) ? 'answered' : 'fallback' }));
  const baseBasis = new Map();
  for (const s of Array.isArray(data.stories) ? data.stories : []) if (s && s.basis && typeof s.sid === 'string') baseBasis.set(s.sid, s.basis);
  const st = assembleStories(data.rule_clusters, blocks, results, data.items, baseBasis);

  let status = 'ok';
  if (!run.calls) status = 'off';
  else if (run.calls_failed === run.calls) status = 'error';
  else if (run.calls_failed) status = 'partial';

  const out = JSON.parse(JSON.stringify(data));
  delete out.ai_snapshot;               // 前回の AI の見方（CONTRACT §12）は、鍵の持ち主の結果と混ぜない。出力は今の取得と、この呼びの答えだけ
  out.blocks = blocks;
  out.stories = st.stories;
  out.ai_run = {
    status, provider: provider.name || null, model: provider.model || null, at: now,
    prompt_version: prompt.version || null,
    calls: run.calls, calls_failed: run.calls_failed, errors: run.errors,
    blocks_sent: run.blocks_sent, blocks_ok: run.blocks_ok,
    dropped_ids: run.dropped_ids, dup_ids: run.dup_ids, unassigned_ids: run.unassigned_ids,
    merges: st.merges, splits: st.splits, flags_vetoed: run.flags_vetoed, quoted_fields: run.quoted_fields, report_words: run.report_words, silence_words: run.silence_words,
    note_ja: '',
  };
  return out;
}
