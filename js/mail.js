/* mail — the news of the day as a draft in the visitor's own mail app. No DOM, no network.
 *
 * The address stays on this device: one key in localStorage (parallax.mail.v1), never in the address bar, never in a file of the
 * site, never sent anywhere. The page only opens a mailto: draft; the visitor presses send in the mail app, or not.
 *
 *   KEY, MAX (1800 characters: a mailto: link longer than this is cut by some devices)
 *   cleanAddr(v) -> string | ''            one address of a plain shape, or nothing
 *   loadAddr(store) / saveAddr(store, v) -> bool / clearAddr(store)
 *   bodyOf({ when, built, items, more, max }) -> string       items: [{ title, jp, intl, finding, life, url }]; cut at a whole item,
 *                                         then one line with the link to the rest
 *   subjectOf(when) -> string
 *   mailtoOf(addr, subject, body) -> 'mailto:…'
 *   itemsOf(events, { board, impact, sidOf, sides, pageOf, cap }) -> items   the important news of the board, as said in the body */

export const KEY = 'parallax.mail.v1';
export const MAX = 1800;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);

export function cleanAddr(v) {
  const s = str(v).trim();
  // nothing that could add a header or a second address to the mailto: link (? & = # % / and the like)
  return s.length <= 254 && /^[^\s@<>()",;:?&=#%/\\[\]]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(s) ? s : '';
}
export function loadAddr(store) {
  try { const x = JSON.parse((store && store.getItem(KEY)) || 'null'); return isObj(x) ? cleanAddr(x.to) : ''; } catch { return ''; }
}
export function saveAddr(store, v) {
  const to = cleanAddr(v);
  if (!to) return false;
  try { store.setItem(KEY, JSON.stringify({ to })); return true; } catch { return false; }
}
export function clearAddr(store) { try { if (store) store.removeItem(KEY); } catch { /* nothing kept */ } }

export const subjectOf = (when) => `Parallax ${str(when)} のニュース`.replace(/\s+/g, ' ').trim();

function itemText(it, i) {
  const lines = [`${i + 1}. ${str(it.title)}`];
  const sides = [it.jp != null ? `国内 ${it.jp}社` : '', it.intl != null ? `海外 ${it.intl}社` : ''].filter(Boolean).join('・');
  if (sides) lines.push(`   ${sides}`);
  if (str(it.finding)) lines.push(`   ${str(it.finding)}`);
  if (str(it.life)) lines.push(`   暮らし：${str(it.life)}`);
  if (str(it.url)) lines.push(`   ${str(it.url)}`);
  return lines.join('\n');
}

export function bodyOf({ when = '', built = '', items = [], more = '', max = MAX } = {}) {
  const head = [`${str(when)} のニュース（${str(built)} の構築）`, ''].join('\n');
  const tail = more ? `\n続きは頁で：${more}` : '';
  let body = head;
  for (const [i, it] of arr(items).entries()) {
    const add = itemText(it, i) + '\n\n';
    if ((body + add + tail).length > max) break;
    body += add;
  }
  body = body.trimEnd() + '\n' + tail;
  return body.length > max ? body.slice(0, max) : body;
}

export function mailtoOf(addr, subject, body) {
  const to = cleanAddr(addr);
  return `mailto:${to ? encodeURIComponent(to).replace(/%40/g, '@') : ''}?subject=${encodeURIComponent(str(subject))}&body=${encodeURIComponent(str(body))}`;
}

export function itemsOf(events, { board = null, impact = null, sidOf, sides, pageOf, cap = 5, areaJa = {} } = {}) {
  const by = new Map();
  for (const e of arr(events)) { const s = sidOf(e); if (s && !by.has(s)) by.set(s, e); }
  const order = isObj(board) && Array.isArray(board.priority) ? board.priority.filter((s) => by.has(s)) : [...by.keys()];
  return order.slice(0, cap).map((sid) => {
    const e = by.get(sid), sd = sides(e);
    const c = isObj(board) && isObj(board.cases) ? board.cases[sid] : null;
    const f = isObj(c) && isObj(c.coverage) ? arr(c.coverage.findings).find((x) => isObj(x) && str(x.text)) : null;
    const im = isObj(impact) && isObj(impact.events) && isObj(impact.events[sid]) ? impact.events[sid] : null;
    return { title: str(e.heading && e.heading.text) || str(e.title), jp: sd.jp, intl: sd.intl, finding: f ? f.text : '',
      life: im ? arr(im.areas).map((a) => areaJa[a] || a).join('・') : '', url: pageOf(sid) };
  });
}
