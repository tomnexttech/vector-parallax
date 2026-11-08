/* mapstyle — the look of the map as one style document for MapLibre GL JS (js/vendor/maplibre-gl-csp.js). No DOM, nothing fetched here.
 *
 *   buildStyle(mode, data) -> style     mode 'dark' | 'light'; data: { sourceId: GeoJSON } for the overlay sources (empty ones when left out)
 *   PAL                                 the colours of both appearances (the page's glass: deep blue sea and slate land in the dark, pale sea and
 *                                       warm paper land in the light)
 *   OVERLAY                             the ids of the overlay sources the engine (js/mapgl.js) feeds
 *
 * The ground is OpenMapTiles' schema served by OpenFreeMap (vector tiles of OpenStreetMap data; no key, free; docs/map-data.md) with the
 * relief from AWS Terrain Tiles. The names are Japanese where OpenStreetMap has them (name:ja), else English, else the place's own. Japanese
 * letters are drawn by the visitor's own font (localIdeographFontFamily in js/mapgl.js), so no glyph files of the kanji are fetched.
 * Under it all the page's own data (the news, the hazards, the theme's colouring) is one set of GeoJSON sources, kept apart from the ground so
 * that a change of appearance changes colours only. */

export const TILEJSON = 'https://tiles.openfreemap.org/planet';
export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const OVERLAY = ['px-theme', 'px-picked', 'px-area', 'px-line', 'px-ring', 'px-pt', 'px-marks', 'px-focus'];
const EMPTY = { type: 'FeatureCollection', features: [] };

export const PAL = {
  dark: {
    space: '#0a1322', land: '#3c5470', sea: '#0b1829', coastLine: 'rgba(176,210,246,.6)',
    wood: 'rgba(52,86,74,.55)', grass: 'rgba(48,74,60,.38)', sand: 'rgba(110,100,76,.28)', ice: 'rgba(214,230,248,.30)', wet: 'rgba(52,92,104,.40)',
    park: 'rgba(56,96,78,.42)', urban: 'rgba(120,136,160,.30)', building: 'rgba(150,170,200,.22)',
    water: '#0b1829', river: '#4a7db8',
    border: 'rgba(236,243,252,.85)', border2: 'rgba(205,220,242,.5)', disputed: 'rgba(255,172,150,.7)',
    road: '#5d728d', roadMinor: '#455a74', rail: 'rgba(168,184,208,.45)',
    label: '#f2f6fc', label2: '#dbe5f3', label3: '#c6d4e8', halo: 'rgba(10,18,32,.92)', waterLabel: '#8fb4e8', roadLabel: '#b9c7dc',
    shadow: 'rgba(4,10,20,.5)', highlight: 'rgba(255,255,255,.12)', accent: 'rgba(4,10,20,.25)',
    cyan: '#64d2ff', red: '#ff6961', ink: '#f5f5f7', ink2: '#c3c3c8', markEdge: 'rgba(8,14,26,.8)', markRing: '#ffffff', markText: '#0b1220',
  },
  light: {
    space: '#e9eef5', land: '#f5f2ea', sea: '#c4dcf0', coastLine: 'rgba(92,134,176,.55)',
    wood: 'rgba(176,206,160,.55)', grass: 'rgba(200,222,178,.42)', sand: 'rgba(232,218,176,.5)', ice: 'rgba(255,255,255,.7)', wet: 'rgba(170,208,206,.5)',
    park: 'rgba(184,214,164,.6)', urban: 'rgba(226,220,206,.6)', building: 'rgba(196,188,170,.5)',
    water: '#c4dcf0', river: '#8db8dc',
    border: 'rgba(96,108,128,.68)', border2: 'rgba(110,122,142,.42)', disputed: 'rgba(196,60,40,.65)',
    road: '#ffffff', roadMinor: '#fbfaf6', rail: 'rgba(120,128,142,.5)',
    label: '#1b2430', label2: '#38455a', label3: '#56647a', halo: 'rgba(255,255,255,.92)', waterLabel: '#235b91', roadLabel: '#4a5568',
    shadow: 'rgba(86,72,46,.5)', highlight: 'rgba(255,255,255,.75)', accent: 'rgba(86,72,46,.28)',
    cyan: '#00739e', red: '#d70015', ink: '#1d1d1f', ink2: '#424245', markEdge: 'rgba(255,255,255,.9)', markRing: '#1d1d1f', markText: '#ffffff',
  },
};

const REG = ['Noto Sans Regular'], BOLD = ['Noto Sans Bold'], ITAL = ['Noto Sans Italic'];
const NAME = ['coalesce', ['get', 'name:ja'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];
const Z = (...s) => ['interpolate', ['linear'], ['zoom'], ...s];
const cls = (...a) => ['in', ['get', 'class'], ['literal', a]];
const eq = (k, v) => ['==', ['get', k], v];
const rank = (lo, hi) => ['all', ['>=', ['coalesce', ['get', 'rank'], 99], lo], ['<=', ['coalesce', ['get', 'rank'], 99], hi]];

export function buildStyle(mode, data = {}) {
  const P = PAL[mode === 'light' ? 'light' : 'dark'];
  const V = (id, layer, extra) => ({ id, source: 'ofm', 'source-layer': layer, ...extra });
  const text = (field, font, size, color, extra = {}) => ({
    layout: { 'text-field': field, 'text-font': font, 'text-size': size, 'text-max-width': 7, ...(extra.layout || {}) },
    paint: { 'text-color': color, 'text-halo-color': P.halo, 'text-halo-width': 1.5, 'text-halo-blur': 0.4, ...(extra.paint || {}) },
  });
  const layers = [
    { id: 'bg', type: 'background', paint: { 'background-color': P.land } },
    V('landcover', 'landcover', { type: 'fill', paint: { 'fill-color': ['match', ['get', 'class'], 'wood', P.wood, 'grass', P.grass, 'farmland', P.grass, 'ice', P.ice, 'sand', P.sand, 'wetland', P.wet, P.grass], 'fill-opacity': Z(0, 0.55, 8, 0.8) } }),
    V('landuse-urban', 'landuse', { type: 'fill', minzoom: 7, filter: cls('residential', 'suburb', 'neighbourhood'), paint: { 'fill-color': P.urban } }),
    V('park', 'park', { type: 'fill', minzoom: 5, paint: { 'fill-color': P.park } }),
    { id: 'hill', type: 'hillshade', source: 'dem', maxzoom: 14, paint: { 'hillshade-exaggeration': Z(0, 0.55, 7, 0.45, 12, 0.3), 'hillshade-shadow-color': P.shadow, 'hillshade-highlight-color': P.highlight, 'hillshade-accent-color': P.accent, 'hillshade-illumination-direction': 335 } },
    V('water', 'water', { type: 'fill', paint: { 'fill-color': P.sea, 'fill-outline-color': P.coastLine } }),
    V('waterway', 'waterway', { type: 'line', minzoom: 4, filter: cls('river'), paint: { 'line-color': P.river, 'line-width': Z(4, 0.5, 8, 1, 12, 2.6, 16, 6) } }),
    V('waterway-small', 'waterway', { type: 'line', minzoom: 10, filter: cls('stream', 'canal', 'ditch'), paint: { 'line-color': P.river, 'line-width': Z(10, 0.4, 16, 2) } }),
    V('boundary-state', 'boundary', { type: 'line', minzoom: 3.2, filter: ['all', ['in', ['get', 'admin_level'], ['literal', [3, 4]]], ['!=', ['get', 'maritime'], 1]], layout: { 'line-join': 'round' }, paint: { 'line-color': P.border2, 'line-width': Z(3.2, 0.5, 8, 1, 12, 1.6), 'line-dasharray': [3, 2] } }),
    V('boundary-country', 'boundary', { type: 'line', filter: ['all', eq('admin_level', 2), ['!=', ['get', 'maritime'], 1], ['!=', ['get', 'disputed'], 1]], layout: { 'line-join': 'round' }, paint: { 'line-color': P.border, 'line-width': Z(0, 0.5, 4, 1, 8, 1.6, 12, 2.2) } }),
    V('boundary-disputed', 'boundary', { type: 'line', filter: ['all', eq('admin_level', 2), eq('disputed', 1)], paint: { 'line-color': P.disputed, 'line-width': Z(0, 0.5, 6, 1.3), 'line-dasharray': [2, 2] } }),
    V('rail', 'transportation', { type: 'line', minzoom: 9, filter: cls('rail'), paint: { 'line-color': P.rail, 'line-width': Z(9, 0.5, 16, 1.4) } }),
    V('road-minor', 'transportation', { type: 'line', minzoom: 12.5, filter: cls('minor', 'service', 'track'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': P.roadMinor, 'line-width': Z(12.5, 0.5, 16, 3.5, 19, 9) } }),
    V('road-secondary', 'transportation', { type: 'line', minzoom: 9, filter: cls('secondary', 'tertiary'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': P.road, 'line-width': Z(9, 0.5, 13, 1.4, 16, 5, 19, 12) } }),
    V('road-primary', 'transportation', { type: 'line', minzoom: 6, filter: cls('primary', 'trunk'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': P.road, 'line-width': Z(6, 0.5, 10, 1.3, 14, 3, 18, 12) } }),
    V('road-motorway', 'transportation', { type: 'line', minzoom: 5, filter: cls('motorway'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': P.road, 'line-width': Z(5, 0.6, 10, 1.8, 14, 4, 18, 14) } }),
    V('building', 'building', { type: 'fill', minzoom: 14, paint: { 'fill-color': P.building, 'fill-outline-color': 'rgba(0,0,0,0)' } }),
    V('lab-water', 'water_name', { type: 'symbol', minzoom: 1, ...text(NAME, ITAL, Z(1, 10, 8, 13), P.waterLabel, { layout: { 'text-letter-spacing': 0.12, 'text-max-width': 5 } }) }),
    V('lab-road', 'transportation_name', { type: 'symbol', minzoom: 13, ...text(NAME, REG, Z(13, 10, 17, 12), P.roadLabel, { layout: { 'symbol-placement': 'line', 'text-pitch-alignment': 'viewport' } }) }),
    V('lab-island', 'place', { type: 'symbol', minzoom: 6, filter: cls('island'), ...text(NAME, REG, Z(6, 10, 10, 13), P.label3, {}) }),
    V('lab-suburb', 'place', { type: 'symbol', minzoom: 12, filter: cls('suburb', 'quarter', 'neighbourhood'), ...text(NAME, REG, Z(12, 10, 16, 13), P.label3, {}) }),
    V('lab-village', 'place', { type: 'symbol', minzoom: 9.5, filter: cls('village', 'hamlet'), ...text(NAME, REG, Z(9.5, 10, 14, 12), P.label3, { layout: { 'symbol-sort-key': ['coalesce', ['get', 'rank'], 99], 'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.3 } }) }),
    V('lab-town', 'place', { type: 'symbol', minzoom: 7.5, filter: cls('town'), ...text(NAME, REG, Z(7.5, 11, 14, 14), P.label2, { layout: { 'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.3 } }) }),
    V('dot-city', 'place', { type: 'circle', minzoom: 4, maxzoom: 11, filter: cls('city'), paint: { 'circle-radius': Z(4, 1.8, 10, 3.4), 'circle-color': P.label2, 'circle-stroke-color': P.halo, 'circle-stroke-width': 1 } }),
    V('lab-city-3', 'place', { type: 'symbol', minzoom: 6, filter: ['all', eq('class', 'city'), ['>', ['coalesce', ['get', 'rank'], 99], 7]], ...text(NAME, REG, Z(6, 11, 12, 15), P.label2, { layout: { 'symbol-sort-key': ['coalesce', ['get', 'rank'], 99], 'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.4 } }) }),
    V('lab-city-2', 'place', { type: 'symbol', minzoom: 4.4, filter: ['all', eq('class', 'city'), rank(4, 7)], ...text(NAME, REG, Z(4.4, 11, 10, 15), P.label, { layout: { 'symbol-sort-key': ['coalesce', ['get', 'rank'], 99], 'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.4 } }) }),
    V('lab-city-1', 'place', { type: 'symbol', minzoom: 3, filter: ['all', eq('class', 'city'), ['<=', ['coalesce', ['get', 'rank'], 99], 3]], ...text(NAME, BOLD, Z(3, 11.5, 10, 16), P.label, { layout: { 'symbol-sort-key': ['coalesce', ['get', 'rank'], 99], 'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.4 } }) }),
    V('lab-state', 'place', { type: 'symbol', minzoom: 4.2, maxzoom: 9, filter: cls('state', 'province'), ...text(NAME, REG, Z(4.2, 10.5, 8, 14), P.label3, { layout: { 'symbol-sort-key': ['coalesce', ['get', 'rank'], 99], 'text-letter-spacing': 0.1 } }) }),
    V('lab-country-3', 'place', { type: 'symbol', minzoom: 3.2, maxzoom: 9, filter: ['all', eq('class', 'country'), ['>=', ['coalesce', ['get', 'rank'], 99], 4]], ...text(NAME, BOLD, Z(3.2, 11, 6, 15), P.label2, { layout: { 'text-max-width': 6 } }) }),
    V('lab-country-2', 'place', { type: 'symbol', minzoom: 2.2, maxzoom: 9, filter: ['all', eq('class', 'country'), eq('rank', 3)], ...text(NAME, BOLD, Z(2.2, 11.5, 6, 17), P.label, { layout: { 'text-max-width': 6 } }) }),
    V('lab-country-1', 'place', { type: 'symbol', minzoom: 0.6, maxzoom: 9, filter: ['all', eq('class', 'country'), ['<=', ['coalesce', ['get', 'rank'], 99], 2]], ...text(NAME, BOLD, Z(0.6, 11, 4, 17, 7, 22), P.label, { layout: { 'text-max-width': 6, 'symbol-sort-key': ['coalesce', ['get', 'rank'], 99] } }) }),
  ];

  // ---- over the ground: the theme's colouring, the pressed place, the hazards, the marks of the news, the event in focus
  const S = (id, type, extra) => ({ id, type, source: extra.source, ...extra });
  const hot = ['==', ['get', 'hot'], 1];
  layers.push(
    S('px-theme-cj', 'fill', { source: 'px-theme', filter: ['all', eq('lvl', 'c'), eq('jp', 1)], paint: { 'fill-color': P.cyan, 'fill-opacity': Z(3.1, ['get', 'a'], 3.7, 0) } }),
    S('px-theme-c', 'fill', { source: 'px-theme', filter: ['all', eq('lvl', 'c'), eq('jp', 0)], paint: { 'fill-color': P.cyan, 'fill-opacity': Z(5, ['get', 'a'], 8, ['*', 0.3, ['get', 'a']]) } }),
    S('px-theme-p', 'fill', { source: 'px-theme', filter: eq('lvl', 'p'), paint: { 'fill-color': P.cyan, 'fill-opacity': Z(3.1, 0, 3.7, ['get', 'a'], 8, ['get', 'a'], 11, ['*', 0.35, ['get', 'a']]) } }),
    S('px-picked', 'line', { source: 'px-picked', filter: ['!=', ['geometry-type'], 'Point'], layout: { 'line-join': 'round' }, paint: { 'line-color': P.ink, 'line-width': 2.2 } }),
    S('px-picked-pt', 'circle', { source: 'px-picked', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 15, 'circle-color': P.ink, 'circle-opacity': 0, 'circle-stroke-color': P.ink, 'circle-stroke-width': 2 } }),
    S('px-area-fill', 'fill', { source: 'px-area', paint: { 'fill-color': P.red, 'fill-opacity': ['match', ['get', 'k'], 'storm', 0.2, 'gale', 0.08, 'cone', 0.06, 0] } }),
    S('px-area-line', 'line', { source: 'px-area', filter: ['in', ['get', 'k'], ['literal', ['storm', 'gale']]], paint: { 'line-color': P.red, 'line-opacity': ['match', ['get', 'k'], 'storm', 0.9, 0.45], 'line-width': 1.2 } }),
    S('px-line-track', 'line', { source: 'px-line', filter: eq('k', 'track'), paint: { 'line-color': P.ink2, 'line-opacity': 0.8, 'line-width': 1.4 } }),
    S('px-line-env', 'line', { source: 'px-line', filter: eq('k', 'env'), paint: { 'line-color': P.red, 'line-opacity': 0.35, 'line-width': 1 } }),
    S('px-line-fc', 'line', { source: 'px-line', filter: eq('k', 'fc'), paint: { 'line-color': P.red, 'line-opacity': 0.9, 'line-width': 1.6, 'line-dasharray': [3, 2] } }),
    S('px-ring', 'line', { source: 'px-ring', paint: { 'line-color': P.cyan, 'line-opacity': 0.85, 'line-width': 1.4, 'line-dasharray': [3, 2] } }),
    S('px-quake', 'circle', { source: 'px-pt', filter: eq('k', 'q'), paint: { 'circle-radius': ['get', 'r'], 'circle-color': P.red, 'circle-opacity': ['case', hot, 0.16, 0], 'circle-stroke-color': ['case', hot, P.red, P.ink2], 'circle-stroke-opacity': ['case', hot, 1, 0.65], 'circle-stroke-width': ['case', hot, 1.8, 1.2] } }),
    S('px-fc', 'circle', { source: 'px-pt', filter: eq('k', 'f'), paint: { 'circle-radius': 3, 'circle-color': P.space, 'circle-stroke-color': P.red, 'circle-stroke-width': 1.5 } }),
    S('px-disaster', 'symbol', { source: 'px-pt', filter: eq('k', 'd'), layout: { 'icon-image': ['case', hot, 'px-dia-hot', 'px-dia'], 'icon-allow-overlap': true, 'icon-size': 1 } }),
    S('px-ty-ring', 'circle', { source: 'px-pt', filter: eq('k', 't'), paint: { 'circle-radius': 9, 'circle-color': P.red, 'circle-opacity': 0, 'circle-stroke-color': P.red, 'circle-stroke-width': 1.8 } }),
    S('px-ty', 'circle', { source: 'px-pt', filter: eq('k', 't'), paint: { 'circle-radius': 4, 'circle-color': P.red } }),
    S('px-marks', 'circle', { source: 'px-marks', layout: { 'circle-sort-key': ['get', 'sk'] }, paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'fc'], 'circle-opacity': ['case', eq('ctry', 1), 0.22, 0.96], 'circle-stroke-width': ['case', eq('ctry', 1), 2.4, eq('pri', 1), 2.6, 1.4], 'circle-stroke-color': ['case', eq('ctry', 1), ['get', 'fc'], eq('pri', 1), P.markRing, P.markEdge] } }),
    S('px-marks-n', 'symbol', { source: 'px-marks', layout: { 'text-field': ['to-string', ['get', 'n']], 'text-font': BOLD, 'text-size': ['case', ['>=', ['get', 'r'], 14], 13, 11.5], 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': ['case', eq('ctry', 1), P.ink, P.markText], 'text-halo-color': ['case', eq('ctry', 1), P.halo, 'rgba(0,0,0,0)'], 'text-halo-width': 1.2 } }),
    S('px-marks-label', 'symbol', { source: 'px-marks', filter: ['!=', ['get', 'lab'], ''], layout: { 'text-field': ['get', 'lab'], 'text-font': BOLD, 'text-size': 12.5, 'text-max-width': 8, 'symbol-sort-key': ['get', 'lk'], 'text-anchor': 'left', 'text-justify': 'left', 'text-offset': ['step', ['get', 'r'], ['literal', [1, 0]], 12, ['literal', [1.2, 0]], 15, ['literal', [1.5, 0]], 18, ['literal', [1.8, 0]], 21, ['literal', [2, 0]]] }, paint: { 'text-color': P.ink, 'text-halo-color': P.halo, 'text-halo-width': 1.6, 'text-halo-blur': 0.4 } }),
    S('px-hz-label', 'symbol', { source: 'px-pt', filter: ['!=', ['get', 't'], ''], layout: { 'text-field': ['get', 't'], 'text-font': BOLD, 'text-size': 12, 'text-max-width': 9, 'symbol-sort-key': ['get', 'lk'], 'text-anchor': 'left', 'text-justify': 'left', 'text-offset': ['step', ['coalesce', ['get', 'r'], 8], ['literal', [0.9, 0]], 10, ['literal', [1.2, 0]], 14, ['literal', [1.6, 0]]] }, paint: { 'text-color': ['case', hot, P.red, P.ink2], 'text-halo-color': P.halo, 'text-halo-width': 1.5, 'text-halo-blur': 0.4 } }),
    S('px-focus-ring', 'circle', { source: 'px-focus', paint: { 'circle-radius': 11, 'circle-color': P.cyan, 'circle-opacity': 0, 'circle-stroke-color': P.cyan, 'circle-stroke-width': 2 } }),
    S('px-focus', 'circle', { source: 'px-focus', paint: { 'circle-radius': 4, 'circle-color': P.cyan, 'circle-stroke-color': P.halo, 'circle-stroke-width': 1 } }),
    S('px-focus-label', 'symbol', { source: 'px-focus', filter: ['!=', ['get', 't'], ''], layout: { 'text-field': ['get', 't'], 'text-font': BOLD, 'text-size': 13, 'text-max-width': 9, 'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 1.1, 'text-optional': true }, paint: { 'text-color': P.cyan, 'text-halo-color': P.halo, 'text-halo-width': 1.8, 'text-halo-blur': 0.4 } }),
  );

  const sources = {
    ofm: { type: 'vector', url: TILEJSON, attribution: '© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap' },
    dem: { type: 'raster-dem', tiles: [DEM_TILES], tileSize: 256, maxzoom: 12, encoding: 'terrarium', attribution: 'AWS Terrain Tiles' },
  };
  for (const id of OVERLAY) sources[id] = { type: 'geojson', data: data[id] || EMPTY };
  return { version: 8, name: `parallax-${mode === 'light' ? 'light' : 'dark'}`, glyphs: GLYPHS, sources, layers, projection: { type: 'mercator' } };
}
