/* places — place labels in Japanese and their position, for the map. No DOM.
 *
 *   placeJa(key)            -> Japanese name for a place key ("NK" -> "北朝鮮"; a prefecture name stays as it is)
 *   placesIn(text)          -> place keys named in a piece of public text (AI headline, a published title)
 *   placesOf(story, items)  -> keys for a story: basis.places first, then names found in its public text
 *   worldPx(lat, lon)       -> {x, y} on the 2048 x 1024 world of the bundled map tiles (level 2)
 *   mapView(keys, span)     -> {x, y, w, h, pins:[{x,y}], tiles:[{x, y, src, px, py}]} or null
 *
 * The map tiles are Natural Earth II (public domain, naturalearthdata.com), 256 px, geodetic TMS:
 * level 2 has 8 x 4 tiles, column 0 starts at 180 W, row 0 starts at 90 S (TMS counts from the bottom). */

export const PLACES = {
  US: { ja: 'アメリカ', lat: 39.5, lon: -98.5, wide: true },
  CN: { ja: '中国', lat: 35.0, lon: 104.0, wide: true },
  JP: { ja: '日本', lat: 36.2, lon: 138.3, wide: true },
  KR: { ja: '韓国', lat: 36.5, lon: 127.8 },
  NK: { ja: '北朝鮮', lat: 40.0, lon: 127.0 },
  RU: { ja: 'ロシア', lat: 55.8, lon: 37.6, wide: true },
  UA: { ja: 'ウクライナ', lat: 49.0, lon: 31.4 },
  IR: { ja: 'イラン', lat: 32.4, lon: 53.7 },
  IL: { ja: 'イスラエル', lat: 31.5, lon: 34.9 },
  GAZA: { ja: 'ガザ', lat: 31.4, lon: 34.4 },
  TW: { ja: '台湾', lat: 23.7, lon: 121.0 },
  FR: { ja: 'フランス', lat: 46.6, lon: 2.2 },
  UK: { ja: '英国', lat: 54.0, lon: -2.5 },
  DE: { ja: 'ドイツ', lat: 51.2, lon: 10.4 },
  IN: { ja: 'インド', lat: 22.0, lon: 79.0, wide: true },
  EU: { ja: '欧州連合', lat: 50.85, lon: 4.35, wide: true },
  OKINAWA: { ja: '沖縄', lat: 26.2, lon: 127.7 },
  北海道: { lat: 43.06, lon: 141.35 }, 青森: { lat: 40.82, lon: 140.74 }, 岩手: { lat: 39.70, lon: 141.15 },
  宮城: { lat: 38.27, lon: 140.87 }, 秋田: { lat: 39.72, lon: 140.10 }, 山形: { lat: 38.24, lon: 140.36 },
  福島: { lat: 37.75, lon: 140.47 }, 茨城: { lat: 36.34, lon: 140.45 }, 栃木: { lat: 36.57, lon: 139.88 },
  群馬: { lat: 36.39, lon: 139.06 }, 埼玉: { lat: 35.86, lon: 139.65 }, 千葉: { lat: 35.60, lon: 140.12 },
  東京: { lat: 35.69, lon: 139.69 }, 神奈川: { lat: 35.45, lon: 139.64 }, 新潟: { lat: 37.90, lon: 139.02 },
  富山: { lat: 36.70, lon: 137.21 }, 石川: { lat: 36.59, lon: 136.63 }, 福井: { lat: 36.07, lon: 136.22 },
  山梨: { lat: 35.66, lon: 138.57 }, 長野: { lat: 36.65, lon: 138.18 }, 岐阜: { lat: 35.39, lon: 136.72 },
  静岡: { lat: 34.98, lon: 138.38 }, 愛知: { lat: 35.18, lon: 136.91 }, 三重: { lat: 34.73, lon: 136.51 },
  滋賀: { lat: 35.00, lon: 135.87 }, 京都: { lat: 35.02, lon: 135.76 }, 大阪: { lat: 34.69, lon: 135.52 },
  兵庫: { lat: 34.69, lon: 135.18 }, 奈良: { lat: 34.69, lon: 135.83 }, 和歌山: { lat: 34.23, lon: 135.17 },
  鳥取: { lat: 35.50, lon: 134.24 }, 島根: { lat: 35.47, lon: 133.05 }, 岡山: { lat: 34.66, lon: 133.93 },
  広島: { lat: 34.40, lon: 132.46 }, 山口: { lat: 34.19, lon: 131.47 }, 徳島: { lat: 34.07, lon: 134.56 },
  香川: { lat: 34.34, lon: 134.04 }, 愛媛: { lat: 33.84, lon: 132.77 }, 高知: { lat: 33.56, lon: 133.53 },
  福岡: { lat: 33.61, lon: 130.42 }, 佐賀: { lat: 33.25, lon: 130.30 }, 長崎: { lat: 32.74, lon: 129.87 },
  熊本: { lat: 32.79, lon: 130.74 }, 大分: { lat: 33.24, lon: 131.61 }, 宮崎: { lat: 31.91, lon: 131.42 },
  鹿児島: { lat: 31.56, lon: 130.56 }, 沖縄: { lat: 26.21, lon: 127.68 },
};

// Names looked for in public text. Longer names first, so "北朝鮮" wins over "朝鮮" and "米中間選挙" is the US, not China.
const NAMES = [
  ['米中間選挙', 'US'], ['北朝鮮', 'NK'], ['North Korea', 'NK'], ['South Korea', 'KR'], ['アメリカ', 'US'], ['米国', 'US'],
  ['米大統領', 'US'], ['米政府', 'US'], ['United States', 'US'], ['U.S.', 'US'], ['Washington', 'US'],
  ['ホワイトハウス', 'US'], ['White House', 'US'], ['中国', 'CN'], ['China', 'CN'], ['Chinese', 'CN'], ['北京', 'CN'],
  ['韓国', 'KR'], ['ソウル', 'KR'], ['ロシア', 'RU'], ['Russia', 'RU'], ['Moscow', 'RU'], ['ウクライナ', 'UA'], ['Ukrain', 'UA'],
  ['イラン', 'IR'], ['Iran', 'IR'], ['イスラエル', 'IL'], ['Israel', 'IL'], ['ガザ', 'GAZA'], ['Gaza', 'GAZA'],
  ['台湾', 'TW'], ['Taiwan', 'TW'], ['フランス', 'FR'], ['France', 'FR'], ['英国', 'UK'], ['イギリス', 'UK'], ['Britain', 'UK'],
  ['ドイツ', 'DE'], ['Germany', 'DE'], ['インド', 'IN'], ['India', 'IN'], ['欧州連合', 'EU'], ['欧州', 'EU'], ['Europe', 'EU'],
  ['日本', 'JP'], ['Japan', 'JP'], ['Tokyo', '東京'], ['Okinawa', '沖縄'],
];
const PREFS = Object.keys(PLACES).filter((k) => !PLACES[k].ja);

export function placeJa(key) {
  if (typeof key !== 'string') return '';
  const p = PLACES[key] || PLACES[key.toUpperCase()];
  return p ? (p.ja || key) : key;
}

const norm = (s) => (typeof s === 'string' ? s.normalize('NFKC') : '');

export function placesIn(text) {
  let t = norm(text);
  if (!t) return [];
  const out = [];
  // 中国 is also the Chugoku region of Japan (中国地方, 中国電力, ...): those uses are not China
  t = t.replace(/中国(?=地方|電力|銀行|新聞|放送|地区|四国|自動車道|山地|運輸局|経済産業局)/g, ' ');
  for (const [name, key] of NAMES) {
    const n = norm(name);
    const ascii = /^[\x20-\x7e]+$/.test(n);
    const re = ascii ? new RegExp(`(^|[^A-Za-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) : null;
    const hit = re ? re.test(t) : t.includes(n);
    if (hit) {
      if (!out.includes(key)) out.push(key);
      t = re ? t.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ' ') : t.split(n).join(' ');
    }
  }
  for (const p of PREFS) {
    // a prefecture name counts with its suffix or on its own (東京 / 東京都 / 群馬県)
    if (t.includes(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** basis.places first (they rest on two or more headlines), then names in the story's public text. */
export function placesOf(story, items) {
  const out = [];
  const add = (k) => { if (typeof k === 'string' && k && !out.includes(k) && (PLACES[k] || PLACES[k.toUpperCase()])) out.push(PLACES[k] ? k : k.toUpperCase()); };
  if (isObj(story) && isObj(story.basis) && Array.isArray(story.basis.places)) story.basis.places.forEach(add);
  const texts = [];
  if (isObj(story) && isObj(story.ai)) texts.push(story.ai.headline_ja, story.ai.headline_en);
  if (isObj(story) && Array.isArray(story.member_ids) && isObj(items)) {
    for (const id of story.member_ids) { const it = items[id]; if (isObj(it) && typeof it.title === 'string') texts.push(it.title); }
  }
  for (const t of texts) placesIn(t).forEach(add);
  // "日本" alone says little on a Japanese news page; keep it only when nothing else is named
  return out.length > 1 ? out.filter((k) => k !== 'JP') : out;
}

export const WORLD_W = 2048;
export const WORLD_H = 1024;
const TILE = 256;

export function worldPx(lat, lon) {
  return { x: ((lon + 180) / 360) * WORLD_W, y: ((90 - lat) / 180) * WORLD_H };
}

/** The part of the world to show for some places, with the tiles it needs. span = width in world px (2048 = whole world). */
export function mapView(keys, base = 'assets/map/ne2/2') {
  const pts = (Array.isArray(keys) ? keys : []).map((k) => PLACES[k]).filter(Boolean);
  if (!pts.length) return null;
  const px = pts.map((p) => worldPx(p.lat, p.lon));
  const xs = px.map((p) => p.x), ys = px.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const spread = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * 16 / 9);
  const first = pts[0];
  let w = first.ja ? (first.wide ? 560 : 300) : 200;     // a prefecture is shown closer than a country
  w = Math.min(WORLD_W, Math.max(w, spread * 1.6));
  const h = w * 9 / 16;
  const x = Math.max(0, Math.min(WORLD_W - w, cx - w / 2));
  const y = Math.max(0, Math.min(WORLD_H - h, cy - h / 2));
  const tiles = [];
  for (let col = Math.floor(x / TILE); col <= Math.floor((x + w - 0.001) / TILE); col++) {
    for (let row = Math.floor(y / TILE); row <= Math.floor((y + h - 0.001) / TILE); row++) {
      if (col < 0 || col > 7 || row < 0 || row > 3) continue;
      tiles.push({ px: col * TILE, py: row * TILE, src: `${base}/${col}/${3 - row}.jpg` });
    }
  }
  return { x, y, w, h, pins: px, tiles };
}
