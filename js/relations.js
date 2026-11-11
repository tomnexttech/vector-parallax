/* relations — data/relations.json（parallax-relations/1、CONTRACT §24）の読み口。形の検査だけで DOM は持たない。
 * ニュース同士の結び付き（規則だけ・AI なし）と、一つの出来事として束ねた根拠。無い・壊れている時は null を返し、呼ぶ側は今までの表示のまま。
 *
 *   relationsOf(raw)              -> { generatedAt, latestAt, method, nodes, edges, groups, same, byNode } | null
 *   relatedOf(rel, sid, n)        -> [{ sid, w, why }]   重い順（その node から出る辺）
 *   groupOf(rel, sid)             -> { gid, sids, n, terms } | null
 *   sameOf(rel, sid, ruleCids)    -> same の一件 | null   BYOK で束ね直した頁は rule_cids で引く（同じ規則の束を全部含む物）
 *   whyParts(why)                 -> [{ k, ja, v }]      結んだ理由の語・場所・別名・数（画面の「理由」の行）
 *   sameSummary(same)             -> { by, byJa, model, at, links, places, spanMin, noRuleMatch }   「束ねた理由」の欄の元
 *   ageOf(ts, now)                -> { h, stale }        6 時間で古い（赤）
 */
export const SCHEMA = 'parallax-relations/1';
export const STALE_H = 6;
const SIDES = ['jp', 'intl', 'gov'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v, n = 80) => (typeof v === 'string' ? Array.from(v.trim()).slice(0, n).join('') : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strs = (v, k, n = 40) => arr(v).map((x) => str(x, n)).filter(Boolean).slice(0, k);
const SID = /^s[0-9A-Za-z_-]{4,40}$/;

const whyOf = (w) => {
  const o = isObj(w) ? w : {};
  return {
    words: strs(o.words, 4), places: strs(o.places, 3),
    aliases: arr(o.aliases).filter((p) => Array.isArray(p) && p.length === 2).map((p) => [str(p[0], 40), str(p[1], 40)]).filter((p) => p[0] && p[1]).slice(0, 3),
    nums: strs(o.nums, 3, 20), dt_h: num(o.dt_h), lineage: o.lineage === true,
  };
};

const linkOf = (l) => (isObj(l) && str(l.a) && str(l.b) ? {
  a: str(l.a), b: str(l.b), sim: num(l.sim) ?? 0, words: strs(l.words, 4), places: strs(l.places, 3),
  aliases: whyOf({ aliases: l.aliases }).aliases, nums: strs(l.nums, 3, 20), dt_min: num(l.dt_min),
} : null);

const sameEntry = (v) => {
  if (!isObj(v) || (v.by !== 'rule' && v.by !== 'ai')) return null;
  const out = { by: v.by, ruleCids: strs(v.rule_cids, 40), ruleGroups: num(v.rule_groups) ?? 1, links: arr(v.links).map(linkOf).filter(Boolean).slice(0, 6) };
  if (v.by === 'ai') {
    out.ai = { model: isObj(v.ai) ? str(v.ai.model, 60) || null : null, at: isObj(v.ai) ? num(v.ai.at) : null };
    out.aiJoined = arr(v.ai_joined).filter(isObj).map((j) => ({ cids: strs(j.cids, 2), best: linkOf(j.best) })).filter((j) => j.cids.length === 2 && j.best).slice(0, 6);
  }
  return out;
};

export function relationsOf(raw) {
  try {
    if (!isObj(raw) || raw.schema !== SCHEMA) return null;
    const nodes = arr(raw.nodes).filter((n) => isObj(n) && SID.test(String(n.sid))).map((n) => ({
      sid: n.sid, cat: str(n.cat, 20) || null, n: num(n.n_outlets) ?? 0,
      sides: Object.fromEntries(SIDES.map((k) => [k, isObj(n.sides) ? (num(n.sides[k]) ?? 0) : 0])), terms: strs(n.terms, 4),
      first: num(n.first_ts), last: num(n.last_ts),
    }));
    const known = new Set(nodes.map((n) => n.sid));
    const edges = arr(raw.edges).filter((e) => isObj(e) && known.has(e.a) && known.has(e.b) && e.a !== e.b && num(e.w) !== null)
      .map((e) => ({ a: e.a, b: e.b, w: Math.max(0, Math.min(1, e.w)), why: whyOf(e.why) }));
    const groups = arr(raw.groups).filter(isObj).map((g) => ({ gid: str(g.gid, 8), sids: arr(g.sids).filter((s) => known.has(s)), n: num(g.n) ?? 0, terms: strs(g.terms, 3) }))
      .filter((g) => g.gid && g.sids.length >= 3).slice(0, 12);
    const same = {};
    if (isObj(raw.same)) for (const [k, v] of Object.entries(raw.same)) { const e = SID.test(k) ? sameEntry(v) : null; if (e) same[k] = e; }
    const byNode = new Map(nodes.map((n) => [n.sid, []]));
    for (const e of edges) { byNode.get(e.a).push({ sid: e.b, w: e.w, why: e.why }); byNode.get(e.b).push({ sid: e.a, w: e.w, why: e.why }); }
    for (const l of byNode.values()) l.sort((x, y) => y.w - x.w || (x.sid < y.sid ? -1 : 1));
    const m = isObj(raw.method) ? raw.method : {};
    return {
      generatedAt: num(raw.generated_at), latestAt: num(raw.latest_generated_at),
      method: { sim: str(m.sim, 60), k: num(m.k), minW: num(m.min_w), ai: m.ai === true },
      nodes, edges, groups, same, byNode,
    };
  } catch { return null; }
}

export function relatedOf(rel, sid, n = 6) {
  if (!rel || !rel.byNode || !rel.byNode.has(sid)) return [];
  return rel.byNode.get(sid).slice(0, n);
}

export function groupOf(rel, sid) {
  return rel ? rel.groups.find((g) => g.sids.includes(sid)) || null : null;
}

export function sameOf(rel, sid, ruleCids) {
  if (!rel) return null;
  if (rel.same[sid]) return rel.same[sid];
  const want = arr(ruleCids).filter((c) => typeof c === 'string');
  if (!want.length) return null;
  const set = new Set(want);
  for (const e of Object.values(rel.same)) if (e.ruleCids.length && e.ruleCids.every((c) => set.has(c))) return e;   // 束ね直しの元になった規則の束
  return null;
}

export function whyParts(why) {
  const w = whyOf(why);
  const out = [];
  if (w.words.length) out.push({ k: 'words', ja: '語', v: w.words });
  if (w.aliases.length) out.push({ k: 'aliases', ja: '別名', v: w.aliases.map((p) => `${p[0]}＝${p[1]}`) });
  if (w.places.length) out.push({ k: 'places', ja: '場所', v: w.places });
  if (w.nums.length) out.push({ k: 'nums', ja: '数', v: w.nums });
  if (w.lineage) out.push({ k: 'lineage', ja: '続報', v: ['前の出来事の続き'] });
  return out;
}

export function sameSummary(same) {
  if (!same) return null;
  const links = same.links.slice(0, 2);
  const places = [...new Set(same.links.flatMap((l) => l.places))].slice(0, 3);
  const spans = same.links.map((l) => l.dt_min).filter((x) => x !== null);
  const joined = same.by === 'ai' ? same.aiJoined : [];
  return {
    by: same.by, byJa: same.by === 'ai' ? 'AI' : '規則', model: same.ai ? same.ai.model : null, at: same.ai ? same.ai.at : null,
    links, places, spanMin: spans.length ? Math.max(...spans) : null,
    joined: joined.map((j) => ({ cids: j.cids, best: j.best, match: j.best.words.length + j.best.aliases.length + j.best.places.length > 0 })),
    noRuleMatch: same.by === 'ai' && joined.length > 0 && joined.every((j) => j.best.words.length + j.best.aliases.length + j.best.places.length === 0),
  };
}

export function ageOf(ts, now = Date.now() / 1000) {
  if (!Number.isFinite(ts)) return { h: null, stale: true };
  const h = Math.max(0, (now - ts) / 3600);
  return { h, stale: h > STALE_H };
}
