/* scenes — which arrangement the board takes: calm, live, world, election, disaster (data/scenes.json, parallax-scenes/1). No DOM.
 *
 *   detect(ctx, cfg) -> { id, tier, reasons: [{ id, vars }] }      the scene with the highest tier whose automatic rule holds
 *     ctx = { gen, now, events: [{ n, new6h, sinceH, intl, lat, lon, flags }], items: [{ title, ts, outlet }], hz: { quakes_jp, quakes_world, tsunami } }
 *   vocabBurst(items, vocab, gen, windowH) -> { n, outlets }       headlines in the window that carry a word of the list (a net to count with)
 *   bannerText(cfg, res, mode, clock) -> string                     the line under the bar; '' for calm
 *
 * A scene changes the arrangement only (what is large, what is folded); never the order, the filters or the headlines. The rules
 * read only what the data has; the thresholds are provisional and live in data/scenes.json. Not here yet: the typhoon gale circle
 * over a prefecture, the polling day from the election calendar. */

export const ORDER = ['disaster', 'election', 'world', 'live', 'calm'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const inJapan = (lat, lon) => isNum(lat) && isNum(lon) && lat >= 20 && lat <= 46.5 && lon >= 122 && lon <= 154;

export const sceneOf = (cfg, id) => arr(cfg && cfg.scenes).find((s) => s && s.id === id) || null;

export function vocabBurst(items, vocab, gen, windowH) {
  const v = vocab || {};
  const words = [...arr(v.ja), ...arr(v.en).map((w) => w.toLowerCase())], ex = [...arr(v.exclude)].map((w) => w.toLowerCase());
  const from = isNum(gen) && isNum(windowH) ? gen - windowH * 3600 : -Infinity;
  const outlets = new Set();
  let n = 0;
  for (const it of arr(items)) {
    if (!it || !isNum(it.ts) || it.ts < from || (isNum(gen) && it.ts > gen + 600)) continue;
    let t = str(it.title).toLowerCase();
    if (!t) continue;
    for (const x of ex) t = t.split(x).join(' ');
    if (words.some((w) => w && t.includes(w))) { n++; outlets.add(str(it.media) || str(it.outlet)); }
  }
  return { n, outlets: outlets.size };
}

function disaster(ctx, cfg) {
  const s = sceneOf(cfg, 'disaster'), rank = (cfg && cfg.quake_scale && cfg.quake_scale.rank) || {};
  const hz = ctx.hz || {}, now = isNum(ctx.now) ? ctx.now : 0;
  for (const r of arr(s && s.auto && s.auto.switch)) {
    if (r.id === 'quake_jp') {
      const min = rank[r.min] || 99, within = (r.within_h || 6) * 3600;
      const q = arr(hz.quakes_jp).filter((x) => x && (rank[x.maxint] || 0) >= min && isNum(x.t) && now - x.t <= within).sort((a, b) => b.t - a.t)[0];
      if (q) return { id: r.id, vars: { what: str(q.maxint_jp) || `震度${q.maxint}`, place: str(q.place), t: q.t } };
    } else if (r.id === 'tsunami') {
      const t = arr(hz.tsunami).find((x) => x && arr(r.in).includes(x.level));
      if (t) return { id: r.id, vars: { what: '津波', place: str(t.place || t.area), t: isNum(t.t) ? t.t : null } };
    } else if (r.id === 'quake_world') {
      const q = arr(hz.quakes_world).filter((x) => x && isNum(x.mag) && x.mag >= r.min && isNum(x.t) && now - x.t <= 6 * 3600).sort((a, b) => b.mag - a.mag)[0];
      if (q) return { id: r.id, vars: { what: `M${q.mag.toFixed(1)}`, place: str(q.place), t: q.t } };
    }
  }
  return null;
}

function election(ctx, cfg) {
  const s = sceneOf(cfg, 'election');
  for (const r of arr(s && s.auto && s.auto.any)) {
    if (r.id !== 'vocab_burst') continue;
    const b = vocabBurst(ctx.items, cfg.vocab && cfg.vocab[r.vocab], ctx.gen, r.window_h);
    if (b.n >= r.min_headlines && b.outlets >= r.min_outlets) return { id: r.id, vars: { n: b.n, m: b.outlets } };
  }
  return null;
}

const minOf = (rules, id, d) => { const r = arr(rules).find((x) => x && x.id === id); return r && isNum(r.min) ? r.min : r && isNum(r.max) ? r.max : d; };

function world(ctx, cfg) {
  const s = sceneOf(cfg, 'world'), all = s && s.auto ? s.auto.all : [];
  const top = [...arr(ctx.events)].sort((a, b) => (b.n || 0) - (a.n || 0))[0];
  if (!top) return null;
  const ok = top.n >= minOf(all, 'outlets', 8) && top.intl >= minOf(all, 'home_intl_outlets', 3) && isNum(top.lat) && !inJapan(top.lat, top.lon)
    && isNum(top.sinceH) && top.sinceH <= minOf(all, 'fresh', 24) && arr(top.flags).includes((s.auto && s.auto.or_flag) || 'security');
  return ok ? { id: 'top_event', vars: { place: str(top.place), m: top.n } } : null;
}

function live(ctx, cfg) {
  const s = sceneOf(cfg, 'live'), all = s && s.auto ? s.auto.all : [];
  const e = arr(ctx.events)[0];
  if (!e) return null;
  const ok = isNum(e.new6h) && e.new6h >= minOf(all, 'new6h', 5) && isNum(e.sinceH) && e.sinceH <= minOf(all, 'fresh', 12) && e.n >= minOf(all, 'outlets', 5);
  return ok ? { id: 'first_event', vars: { n: e.new6h, t: ctx.gen } } : null;
}

const RULES = { disaster, election, world, live };

export function detect(ctx, cfg) {
  const c = ctx || {};
  for (const id of ORDER) {
    if (id === 'calm') break;
    const r = sceneOf(cfg, id) ? RULES[id](c, cfg) : null;
    if (r) return { id, tier: sceneOf(cfg, id).tier || 0, reasons: [r] };
  }
  return { id: 'calm', tier: 0, reasons: [] };
}

export function bannerText(cfg, res, mode, clock) {
  const s = sceneOf(cfg, res && res.id);
  if (!s || res.id === 'calm') return '';
  const v = (res.reasons[0] && res.reasons[0].vars) || {};
  const fill = { what: v.what || '', place: v.place || '', time: isNum(v.t) ? clock(v.t) : '', n: isNum(v.n) ? v.n : '', m: isNum(v.m) ? v.m : '', 'hh:mm': isNum(v.t) ? clock(v.t) : '', name: '' };
  const body = str(s.banner_ja).replace(/\{([^}]+)\}/g, (_, k) => String(fill[k] ?? '')).replace(/^(\S+) ・/, '$1 ').replace(/\s+/g, ' ').trim();
  const lead = str(s.label_ja), rest = body.startsWith(lead + ' ') ? body.slice(lead.length + 1) : body;   // the label is said once
  const modeJa = (cfg.rules && cfg.rules.banner && cfg.rules.banner.mode_ja && cfg.rules.banner.mode_ja[mode]) || '';
  return `場面 ${lead}${modeJa ? `（${modeJa}）` : ''} ${rest}`.trim();
}
