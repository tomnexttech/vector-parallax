# 地図のデータと部品（2026-11-09）

地図（`js/map.js` が選び、`js/mapgl.js` が描く）が使う物の出所・版・権利と、外のサーバーを使う条件。新しい物を足したら、ここに書く。

## 1. 部品とデータ

| 物 | 版・取り方 | 権利 | 置き場・使い方 |
|---|---|---|---|
| MapLibre GL JS | 5.24.0（2026-04-23）。npm の `maplibre-gl@5.24.0` の `dist/` から取った 3 つ（`maplibre-gl-csp.js`・`maplibre-gl-csp-worker.js`・`maplibre-gl.css`）と `LICENSE.txt` | BSD-3-Clause | `js/vendor/`。頁の CSP（`script-src 'self'`・`worker-src 'self'`）に合わせて、CDN でなくこのリポジトリのファイルとして置く。`js/mapgl.js` が最初に地図が要る時に読む。sha384（`js/vendor/`）：`maplibre-gl-csp.js` `+lDFpEYaS5ofD0qW/5dA+duOMWMSGs+utCY+wx9H/lS1i0WZ0bQH31giSmqYsxqR`、`maplibre-gl-csp-worker.js` `wBzwLUk46fiEnNOOlHXeylfQrL/SzyNqSD0gYdQJskF9cbBaNcRDYn6ZmSBW4l0z`、`maplibre-gl.css` `uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK` |
| 地図のタイル（国境・海岸・川・湖・道路・地名・日本語の名前） | OpenFreeMap の公開タイル `https://tiles.openfreemap.org/planet`（OpenMapTiles の構成そのまま。日付入りの版は TileJSON が教える） | データは OpenStreetMap（ODbL）。OpenMapTiles の構成。OpenFreeMap の公開サーバーは無料・キー無し・Cookie 無し・閲覧数と要求数の上限なし・商用可（公式ページ https://openfreemap.org/ と利用規約、2026-11-09 に確認）。**表示の義務：「OpenFreeMap © OpenMapTiles Data from OpenStreetMap」**。保証（SLA）は無い | 外のサーバー（2 節）。名前は `name:ja`、無ければ `name_en`、`name:latin`、その場所の名前の順（`js/mapstyle.js`） |
| 文字の形（ラテン文字） | `https://tiles.openfreemap.org/fonts/Noto Sans {Regular,Bold,Italic}/` の glyph | Noto Sans：SIL OFL 1.1 | 外のサーバー。**日本語の文字は取らない**：`localIdeographFontFamily` で、頁の書体（IBM Plex Sans JP）か手元の日本語の書体が描く |
| 起伏（陰影） | AWS Terrain Tiles（terrarium）`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`、最大 12 段 | AWS Open Data の公開データセット（鍵無し）。元は SRTM・ASTER などで、出典は https://github.com/tilezen/joerd/blob/master/docs/attribution.md | 外のサーバー。頁の下の出典の行に「標高 AWS Terrain Tiles」と出す |
| 国と都道府県の外形（分野で塗る時の色塗りと、地面を押した時の外形） | Natural Earth（50m の国・10m の都道府県）v5.1.2 を `tools/build_borders.py` で軽くした `assets/map/borders.json`（99 KB） | パブリック・ドメイン（https://www.naturalearthdata.com/about/terms-of-use/） | 頁と一緒に配る静的ファイル。外のサーバーに頼らない |
| 台風・地震・災害 | 気象庁・USGS・GDACS（`js/hazards.js`、`data/hazards.json`） | 各機関の利用条件 | 変更なし |
| 地図が使えない時の地面 | Natural Earth II（`assets/map/ne2/`）と、同じタイルから描く旧来の canvas の地図（`createCanvasMap`） | パブリック・ドメイン | WebGL が無い、または 15 秒以内に地面の索引が届かない時に自動で替わる |

## 2. 外のサーバーを使う理由と条件

選び方：**GitHub Pages で大勢が同時に開いても止まらない**ことと、**スマホでも動く軽さ**。

- 頁を配る GitHub Pages は静的ファイルだけ。地図のタイルを自分で持つと、世界全体の詳しい地図（国境・道路・日本語の地名を拡大の段ごとに）は数十 GB になり、置けない。Natural Earth だけを同梱する案は、止まらず軽い（`borders.json` は 99 KB）が、国と都道府県の線と大きな都市までで、拡大した所（市区町村・道路）は出ない。
- OpenFreeMap は、上に書いた通り要求数に上限が無く、キーも要らず、無料のまま商用でも使える（CDN の後ろの静的なタイル）。保証が無いので、**止まった時に備える**：①地面の索引（TileJSON）が 15 秒以内に来なければ、同梱の旧来の canvas の地図に自動で替わる（出来事の印・地震・台風・色塗りは同じ）。②色塗りに使う国と都道府県の外形は同梱で、サーバーが止まっても出る。③既にあるタイルはブラウザが持つ。
- 1 回の表示で取る量：MapLibre 本体は gzip で約 400 KB（初回だけ、以降はキャッシュ）。世界の表示はタイル約 20〜40 枚と起伏 約 10〜20 枚。スマホでも動かすため、画素の密度は 2 で止め、`maxPitch` は 0、ぼかしの重いガラスは操作の層（上の帯・カード）だけに掛ける。
- 利用規約の守るべき点：自動で全体を集めない（この頁は閲覧のための要求だけ）。オフラインの保存はしない。
- 変えた時：`js/mapstyle.js` の `TILEJSON`・`GLYPHS`・`DEM_TILES` が外の宛先の全て。`index.html` の CSP の `connect-src` は `tiles.openfreemap.org` と `s3.amazonaws.com` を持つ（変更なし）。

## 3. 作り（要点）

- `js/mapstyle.js`：地図の見た目を MapLibre の style（JSON）として組み立てる（ダーク・ライトの二つの色の表）。地面、国境（国・都道府県）、海岸、川と湖、道路、鉄道、建物、地名（国・都道府県・都市・町・村）、水の名前。上に、この頁の物（分野の色塗り・押した場所・台風と地震と災害・出来事の印・注目の出来事）を GeoJSON の出所として重ねる。
- `js/mapgl.js`：MapLibre を起こし、頁の出来事と災害を GeoJSON に直し、押された物を旧来の地図と同じ `hit`（event / cluster / quake / typhoon / disaster）で返す。平面と地球儀の切り替えは `setProjection`（mercator ↔ globe）。
- `js/map.js`：`createMap()` が、MapLibre（WebGL がある時）か canvas の地図（無い時・失敗時）を選ぶ。ウィンドウのイベント `parallax:map-engine` が選ばれた方を知らせる。
