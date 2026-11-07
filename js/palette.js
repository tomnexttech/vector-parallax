/* palette — one field for finding anything: events, fields, outlets, screens and operations (Ctrl/⌘+K, or /).
 *
 *   norm(text) -> text                    width, case and katakana/hiragana folded, spaces dropped
 *   scoreOf(item, q) -> number            0 no match; the start of the label over a word in it over the words behind it
 *   rank(items, q, limit) -> items        best first, the list's own order among equals; with no words, the items marked `first`
 *   createPalette({ doc, root, input, list, items, free, onClose }) -> { open(), close(), toggle(), isOpen() }
 *        items(): [{ kind, label, hint, hay, first, run }]; free(q): the row that is always there for words that match nothing
 *
 * Headlines go in with textContent only. */

export const norm = (s) => String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, '');

export function scoreOf(item, q) {
  const w = norm(q);
  if (!w) return 0;
  const label = norm(item.label);
  if (label === w) return 100;
  if (label.startsWith(w)) return 80;
  if (label.includes(w)) return 60;
  if (item.hay && norm(item.hay).includes(w)) return 30;
  return 0;
}

export function rank(items, q, limit = 12) {
  const list = Array.isArray(items) ? items : [];
  if (!norm(q)) return list.filter((x) => x.first).slice(0, limit);
  return list.map((x, i) => ({ x, i, sc: scoreOf(x, q) })).filter((r) => r.sc > 0).sort((a, b) => b.sc - a.sc || a.i - b.i).slice(0, limit).map((r) => r.x);
}

export function createPalette({ doc = document, root, input, list, items, free, onClose } = {}) {
  let shown = [], at = 0, cache = null;
  const isOpen = () => !root.hidden;
  function paint() {
    const q = input.value.trim();
    cache = cache || items();
    shown = rank(cache, q);
    const f = q && free ? free(q) : null;
    if (f) shown = [...shown, f];
    at = Math.min(at, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map((x, i) => {
      const li = doc.createElement('li');
      li.setAttribute('role', 'option');
      li.id = `cmd-o${i}`;
      li.className = 'cmd-o';
      li.setAttribute('aria-selected', String(i === at));
      const k = doc.createElement('span'); k.className = 'cmd-kind'; k.textContent = x.kind;
      const t = doc.createElement('span'); t.className = 'cmd-t'; t.textContent = x.label;
      li.append(k, t);
      if (x.hint) { const n = doc.createElement('span'); n.className = 'cmd-h'; n.textContent = x.hint; li.append(n); }
      li.addEventListener('pointermove', () => { if (at !== i) { at = i; mark(); } });
      li.addEventListener('click', () => pick(i));
      return li;
    }));
    input.setAttribute('aria-activedescendant', shown.length ? `cmd-o${at}` : '');
  }
  function mark() {
    [...list.children].forEach((el, i) => el.setAttribute('aria-selected', String(i === at)));
    const el = list.children[at];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', shown.length ? `cmd-o${at}` : '');
  }
  function pick(i) {
    const x = shown[i];
    if (!x) return;
    close();
    x.run();
  }
  function open() { cache = null; at = 0; root.hidden = false; paint(); input.focus(); input.select(); return true; }
  function close() { if (!isOpen()) return false; root.hidden = true; if (onClose) onClose(); return true; }
  input.addEventListener('input', () => { at = 0; paint(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); if (shown.length) { at = (at + (ev.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length; mark(); } } else if (ev.key === 'Enter') { ev.preventDefault(); if (!ev.isComposing) pick(at); } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
  });
  root.addEventListener('click', (ev) => { if (ev.target === root) close(); });
  return { open, close, isOpen, toggle: () => (isOpen() ? close() : open()) };
}
