/* genres — the fields as round icons, as on a phone's home screen: one press shows the events of that field only, and
 * すべて shows every field again. The drawings are plain line symbols written here (no image files, nothing generated).
 *
 *   GENRE_ALL                                                   -> the id of "every field"
 *   genreShort(field)                                           -> the name under the icon (国内政治 -> 政治, 安全保障 -> 安保)
 *   genreCounts(events)                                         -> Map(field -> number of events)
 *   genreBar({ fields, counts, total, active, onPick, label })  -> <div class="genres"> of <button class="gn" aria-pressed>
 *   genreIcon(field)                                            -> the field's line symbol, an <svg> (the simple view's cards use it)
 */
export const GENRE_ALL = 'all';
const SHORT = { 国内政治: '政治', 安全保障: '安保' };
// 20 x 20, strokes only (the page sets stroke and width)
const ICON = {
  [GENRE_ALL]: '<rect x="3.5" y="3.5" width="5" height="5" rx="1.2"/><rect x="11.5" y="3.5" width="5" height="5" rx="1.2"/><rect x="3.5" y="11.5" width="5" height="5" rx="1.2"/><rect x="11.5" y="11.5" width="5" height="5" rx="1.2"/>',
  国内政治: '<path d="M3 16.5h14M4.5 14.5h11M5.5 9v5.5M8.5 9v5.5M11.5 9v5.5M14.5 9v5.5M3.5 7.5L10 3.5l6.5 4z"/>',
  国際: '<circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h13M10 3.5c1.9 1.9 2.8 4.1 2.8 6.5s-.9 4.6-2.8 6.5M10 3.5C8.1 5.4 7.2 7.6 7.2 10s.9 4.6 2.8 6.5"/>',
  経済: '<path d="M3.5 16.5h13M6 16.5v-5M10 16.5v-9M14 16.5v-7"/>',
  安全保障: '<path d="M10 3.5l5.5 2v4.2c0 3.4-2.3 5.9-5.5 6.8-3.2-.9-5.5-3.4-5.5-6.8V5.5z"/>',
  技術: '<rect x="6" y="6" width="8" height="8" rx="1.2"/><path d="M8 3.5V6M12 3.5V6M8 14v2.5M12 14v2.5M3.5 8H6M3.5 12H6M14 8h2.5M14 12h2.5"/>',
  市場: '<path d="M3.5 14l4-4.5 3 2.5 5.5-6M12.5 6h3.5v3.5"/>',
  災害: '<path d="M10 3.5l7 12.5H3z"/><path d="M10 8.3v3.6M10 14.1v.2"/>',
  その他: '<circle cx="5.5" cy="10" r=".9"/><circle cx="10" cy="10" r=".9"/><circle cx="14.5" cy="10" r=".9"/>',
};
const SVG_NS = 'http://www.w3.org/2000/svg';

export function genreIcon(f) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICON[f] || ICON.その他;
  return svg;
}

export const genreShort = (f) => (f === GENRE_ALL ? 'すべて' : SHORT[f] || f);

export function genreCounts(events) {
  const c = new Map();
  for (const e of events || []) if (e && e.field) c.set(e.field, (c.get(e.field) || 0) + 1);
  return c;
}

export function genreBar({ fields, counts, total, active, onPick, label = '分野' }) {
  const bar = document.createElement('div');
  bar.className = 'genres';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', label);
  for (const f of [GENRE_ALL, ...fields]) {
    const n = f === GENRE_ALL ? total : counts.get(f) || 0;
    const name = f === GENRE_ALL ? 'すべての分野' : f;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = n || f === active ? 'gn' : 'gn none';
    b.dataset.genre = f;
    b.setAttribute('aria-pressed', String(active === f));
    b.setAttribute('aria-label', `${name} ${n} 件`);
    b.title = `${name}・${n} 件`;
    const ic = document.createElement('span');
    ic.className = 'gi';
    ic.append(genreIcon(f));
    const t = document.createElement('span');
    t.className = 'gl';
    t.textContent = genreShort(f);
    b.append(ic, t);
    b.addEventListener('click', () => onPick(f));
    bar.append(b);
  }
  return bar;
}
