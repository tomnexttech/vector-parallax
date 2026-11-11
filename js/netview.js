/* netview — the news that are tied to each other, as points and lines, and as a list. The drawing takes a 2D context; the rest has no DOM.
 *
 *   graphOf(relations, { cap }) -> { nodes, edges, by, method } | null    data/relations.json (parallax-relations/1), checked
 *   graphFromPairs(nodes, pairs) -> { nodes, edges, by, method }          the same shape from the page's own measure (shared words
 *                                         and places of this fetch) while relations.json is not there; method.sim says which
 *   layout(g, { w, h, iters, seed }) -> [{ x, y }]   a force layout that runs a fixed number of steps and stops (never keeps moving)
 *   tiesOf(g, sid) -> [{ sid, w, why }]    the news tied to one, heaviest first
 *   listOf(g, { cap }) -> [{ a, b, w, why }]   every tie, heaviest first (the phone's default)
 *   whyText(why) -> string                 the words a tie rests on, as written: words, places, other names, hours apart
 *   radius(n) -> px                        the size of a point by the number of outlets
 *   hit(pos, g, x, y) -> index | -1
 *   draw(ctx, g, pos, { w, h, sel, colors, label })   the chosen news is named; its ties carry the numbers of the list's rows */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const SID = /^s[0-9A-Za-z_-]{4,40}$/;   // the same check as js/relations.js (the build's sids are s + 12 hex)
export const CAP = 400;

const cleanWhy = (w) => {
  const x = isObj(w) ? w : {};
  return {
    words: arr(x.words).filter((s) => typeof s === 'string' && s).slice(0, 6),
    places: arr(x.places).filter((s) => typeof s === 'string' && s).slice(0, 4),
    aliases: arr(x.aliases).filter((p) => Array.isArray(p) && p.length === 2 && p.every((s) => typeof s === 'string')).slice(0, 3),
    dt_h: isNum(x.dt_h) ? x.dt_h : null,
    lineage: x.lineage === true,
  };
};

function index(nodes, edges, method) {
  const by = new Map(nodes.map((n, i) => [n.sid, i]));
  const es = edges.filter((e) => by.has(e.a) && by.has(e.b) && e.a !== e.b);
  return { nodes, edges: es, by, method };
}

export function graphOf(rel, { cap = CAP } = {}) {
  if (!isObj(rel) || rel.schema !== 'parallax-relations/1') return null;
  const nodes = [], seen = new Set();
  for (const n of arr(rel.nodes)) {
    if (!isObj(n) || !SID.test(str(n.sid)) || seen.has(n.sid)) continue;
    seen.add(n.sid);
    const s = isObj(n.sides) ? n.sides : {};
    nodes.push({ sid: n.sid, cat: str(n.cat), n: isNum(n.n_outlets) ? n.n_outlets : 0, sides: { jp: +s.jp || 0, intl: +s.intl || 0, gov: +s.gov || 0 }, terms: arr(n.terms).filter((t) => typeof t === 'string').slice(0, 4) });
    if (nodes.length >= cap) break;
  }
  const edges = [], pair = new Set();
  for (const e of arr(rel.edges)) {
    if (!isObj(e) || !SID.test(str(e.a)) || !SID.test(str(e.b)) || !isNum(e.w) || e.w <= 0 || e.w > 1) continue;
    const k = e.a < e.b ? e.a + e.b : e.b + e.a;
    if (pair.has(k)) continue;
    pair.add(k);
    edges.push({ a: e.a, b: e.b, w: e.w, why: cleanWhy(e.why) });
  }
  const m = isObj(rel.method) ? rel.method : {};
  return index(nodes, edges, { sim: str(m.sim), min_w: isNum(m.min_w) ? m.min_w : null, ai: m.ai === true, from: 'relations' });
}

/** pairs: [{ a, b, words, places }] measured on the page. The weight is the share of the words the two have in common, at most 1 */
export function graphFromPairs(nodes, pairs, { cap = CAP } = {}) {
  const seen = new Set();
  const ns = arr(nodes).filter((n) => isObj(n) && str(n.sid) && !seen.has(n.sid) && seen.add(n.sid)).slice(0, cap);
  const have = new Set(ns.map((n) => n.sid));
  const edges = [], pair = new Set();
  for (const p of arr(pairs)) {
    if (!isObj(p) || !have.has(p.a) || !have.has(p.b) || p.a === p.b) continue;
    const k = p.a < p.b ? p.a + '|' + p.b : p.b + '|' + p.a;
    if (pair.has(k)) continue;
    pair.add(k);
    const words = arr(p.words), places = arr(p.places);
    edges.push({ a: p.a < p.b ? p.a : p.b, b: p.a < p.b ? p.b : p.a, w: Math.min(1, (words.length + (places.length ? 1 : 0)) / 5), why: cleanWhy({ words, places }) });
  }
  return index(ns, edges, { sim: 'shared-words+places', min_w: null, ai: false, from: 'page' });
}

/** only the news that are tied to another: a point with no line says nothing about ties */
export function connected(g) {
  if (!g) return null;
  const used = new Set(g.edges.flatMap((e) => [e.a, e.b]));
  return index(g.nodes.filter((n) => used.has(n.sid)), g.edges, g.method);
}

/** a small fixed random, so the same data lays out the same way every time */
function rand(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function layout(g, { w = 800, h = 600, iters = 80, seed = 7 } = {}) {
  const n = g ? g.nodes.length : 0;
  if (!n) return [];
  const r = rand(seed);
  const pos = g.nodes.map((_, i) => {
    const a = (i / n) * Math.PI * 2 * 7.1, rr = 0.08 + 0.3 * r();
    return { x: w / 2 + Math.cos(a) * rr * w, y: h / 2 + Math.sin(a) * rr * h, vx: 0, vy: 0 };
  });
  const k = Math.sqrt((w * h) / n) * 0.62;
  const E = g.edges.map((e) => [g.by.get(e.a), g.by.get(e.b), e.w]);
  // the repulsion is counted on a grid: only the points in the cells around a point push it (400 points stay well under a second)
  const cell = k * 2;
  for (let t = 0; t < iters; t++) {
    const temp = (w / 10) * (1 - t / iters) + 0.5;
    const grid = new Map();
    for (let i = 0; i < n; i++) {
      const p = pos[i], key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      p.vx = 0; p.vy = 0;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
    for (let i = 0; i < n; i++) {
      const p = pos[i], cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of grid.get(`${gx},${gy}`) || []) {
          if (j === i) continue;
          let dx = p.x - pos[j].x, dy = p.y - pos[j].y, d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = r() - 0.5; dy = r() - 0.5; d2 = 0.5; }
          const f = (k * k * 0.08) / d2;   // weak: with the pull below, parts that tie to nothing stay off the edges (11-11: 20 of 30 were on the walls)
          p.vx += dx * f; p.vy += dy * f;
        }
      }
    }
    for (const [i, j, wt] of E) {
      const a = pos[i], b = pos[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d / k) * (0.15 + 0.35 * wt);
      a.vx -= dx * f; a.vy -= dy * f;
      b.vx += dx * f; b.vy += dy * f;
    }
    for (const p of pos) {
      // a weak pull to the middle keeps the parts that tie to nothing on the canvas
      p.vx += (w / 2 - p.x) * 0.1; p.vy += (h / 2 - p.y) * 0.1;
      const v = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1, s = Math.min(v, temp) / v;
      p.x = Math.min(w - 14, Math.max(14, p.x + p.vx * s));
      p.y = Math.min(h - 14, Math.max(14, p.y + p.vy * s));
    }
  }
  // then the whole is stretched to the canvas (a margin of 24, at most 3 times), so the figure uses its room
  const m = 24, xs = pos.map((p) => p.x), ys = pos.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = x1 - x0 > 1 ? Math.min(3, (w - 2 * m) / (x1 - x0)) : 1, sy = y1 - y0 > 1 ? Math.min(3, (h - 2 * m) / (y1 - y0)) : 1;
  const ox = (w - (x1 - x0) * sx) / 2, oy = (h - (y1 - y0) * sy) / 2;
  return pos.map((p) => ({ x: Math.min(w - 14, Math.max(14, ox + (p.x - x0) * sx)), y: Math.min(h - 14, Math.max(14, oy + (p.y - y0) * sy)) }));
}

export function tiesOf(g, sid) {
  if (!g || !g.by.has(sid)) return [];
  return g.edges.filter((e) => e.a === sid || e.b === sid).map((e) => ({ sid: e.a === sid ? e.b : e.a, w: e.w, why: e.why })).sort((x, y) => y.w - x.w);
}
export const listOf = (g, { cap = 60 } = {}) => (g ? [...g.edges].sort((x, y) => y.w - x.w).slice(0, cap) : []);

export function whyText(why) {
  const x = cleanWhy(why);
  const parts = [...x.words, ...x.places.map((p) => p), ...x.aliases.map(([a, b]) => `${a}＝${b}`)];
  if (x.lineage) parts.push('続報');
  if (isNum(x.dt_h)) parts.push(`${x.dt_h < 1 ? '1 時間未満' : Math.round(x.dt_h) + ' 時間'}の差`);
  return parts.join('・');
}

export const radius = (n) => 3 + Math.min(9, Math.sqrt(Math.max(0, n || 0)) * 2.2);

export function hit(pos, g, x, y, rs = 1) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < pos.length; i++) {
    const dx = pos[i].x - x, dy = pos[i].y - y, d = dx * dx + dy * dy, r = radius(g.nodes[i].n) * rs + 8;
    if (d <= r * r && d < bd) { bd = d; best = i; }
  }
  return best;
}

/** colors: { ink, ink3, line, sel, jp, intl, gov, plate }. label(sid) -> the headline to write at a point (only the chosen and its ties) */
// big (a stage): the ties are drawn in the colour of the chosen and named by their headline after the number of their row
export function draw(ctx, g, pos, { w, h, sel = null, colors = {}, label = () => '', fs = 13, rs = 1, big = false } = {}) {
  if (!ctx || !g) return;
  const c = { ink: '#ddd', ink3: '#888', line: 'rgba(128,128,128,.35)', sel: '#5ac8f0', jp: '#bbb', intl: '#888', gov: '#666', plate: 'rgba(0,0,0,.6)', ...colors };
  ctx.clearRect(0, 0, w, h);
  const on = sel && g.by.has(sel) ? new Set([sel, ...tiesOf(g, sel).map((t) => t.sid)]) : null;
  ctx.lineCap = 'round';
  for (const e of g.edges) {
    const i = g.by.get(e.a), j = g.by.get(e.b);
    const lit = on && (e.a === sel || e.b === sel);
    if (on && !lit) continue;
    ctx.strokeStyle = lit ? c.sel : c.line;
    ctx.lineWidth = (0.6 + e.w * (lit ? 4 : 2.4)) * rs;
    ctx.beginPath(); ctx.moveTo(pos[i].x, pos[i].y); ctx.lineTo(pos[j].x, pos[j].y); ctx.stroke();
  }
  for (let i = 0; i < g.nodes.length; i++) {
    const nd = g.nodes[i], p = pos[i], r = radius(nd.n) * rs;
    if (on && !on.has(nd.sid)) { ctx.globalAlpha = 0.18; }
    ctx.fillStyle = nd.sid === sel ? c.sel : big && on && on.has(nd.sid) ? c.ink : big ? c.ink2 || c.ink3 : c.ink3;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    // the share of each side: a short bar under the point, never a fill of the point
    const tot = nd.sides.jp + nd.sides.intl + nd.sides.gov;
    if (tot > 0 && r >= 5) {
      let x0 = p.x - r;
      for (const k of ['jp', 'intl', 'gov']) { const bw = (nd.sides[k] / tot) * r * 2; if (bw > 0) { ctx.fillStyle = c[k]; ctx.fillRect(x0, p.y + r + 2 * rs, bw, 2 * rs); x0 += bw; } }
    }
    ctx.globalAlpha = 1;
  }
  if (!on) return;
  ctx.font = `${fs}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const tag = (text, x, y, color) => {
    if (!text) return;
    const t = text.length > 28 ? text.slice(0, 27) + '…' : text, tw = ctx.measureText(t).width;
    y = Math.min(h - fs, Math.max(fs, y));
    const px = Math.min(w - tw - 6, Math.max(4, x - tw / 2));
    ctx.fillStyle = c.plate; ctx.fillRect(px - 4, y - (fs + 7) / 2, tw + 8, fs + 7);
    ctx.fillStyle = color; ctx.fillText(t, px, y);
  };
  // the tied news carry the number of their row in the list under the figure; the words of each tie are in that list
  const si = g.by.get(sel);
  tiesOf(g, sel).forEach((t, n) => {
    const j = g.by.get(t.sid);
    const tx = big ? `${n + 1}  ${label(t.sid) || ''}`.trim() : String(n + 1);
    tag(tx, pos[j].x, pos[j].y + (big && pos[j].y > pos[si].y ? 1 : -1) * (radius(g.nodes[j].n) * rs + Math.round(fs * 12 / 13)), big ? c.ink : c.sel);
  });
  tag(label(sel), pos[si].x, pos[si].y + (big ? 1 : -1) * (radius(g.nodes[si].n) * rs + Math.round(fs * 12 / 13)), c.ink);
}
