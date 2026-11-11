# 本選への作り足し（2026-11-11 設計・コードは含まない）

本選は 11/22（発表 7 分・質疑 12 分・ブース巡回 30 分）、二次の提出は 11/20。採点は 課題・技術の役割・社会的インパクト・持続性・実装、これに来場者の投票が加わる。
本書は作り足しを三つの枝 **hero（画面と体験）・data（集める・測る・結ぶ）・app（検索・アプリ化・メール）** に分け、枝どうしの受け渡し（JSON の欄）を先に決める。
契約の正本は `docs/CONTRACT-public.md`。本書の §3 は data 枝が §24〜§26 として契約へ写す。

## 0. 勝ち筋（採点の軸ごとに、何を見せるか）

| 軸 | 見せる物 | 置き場 |
|---|---|---|
| 課題 | 「自分で調べているつもりが、並べ方に操作されている」を、実データの並べ替えで数として見せる（並び順の比べ） | hero §5.5 |
| 技術の役割 | AI なしで束ね・結び・測る。AI は中枢の一か所（束ね直しと要点）だけで、なぜ同じ出来事と判じたかの根拠を出す | data §4.1・§4.2 |
| 社会的インパクト | 国内と海外で載せた点・載せなかった点・言葉の選び方を、媒体ごとに具体的に。暮らしへの影響が大きく、見出しの少ない政策にラベル | data §4.3・§4.4 |
| 持続性 | 費用 0 円で毎日動く（静的な頁・3 時間ごとの構築・無料の公開の値だけ）。来場者の AI の費用はその人の鍵 | §4.6・§9 |
| 実装 | 公開中の頁に入れて動かす。試験 287＋367 を減らさず増やす。iPhone・iPad で横にずれない | §8 |
| 来場者の投票 | 最初の 60 秒：同じ出来事の左右の割れ、オーブが声で読む、指で流せる。迷ったら「最初から」で戻る | hero §5.1〜§5.4 |

## 1. 今あるもの（作り直さない）

二つ目を作らないため、足す前にここを使う。

| 要望 | 既にある物 | 足りない所 |
|---|---|---|
| 1 検索 | `#q`（コマンドの検索）・`js/newsdesk.js` `searchOf`（期間・側・媒体・並び） | 言葉の揺れ（表記・別名・日英）・分野・片側だけ・7 日分・暮らしのラベル |
| 2 世論の反応 | 無し（`stories[].videos` は放送局の動画の題だけ） | 公開の値の取得そのもの |
| 3 バイアスの箇所 | `board.cases[sid].coverage`（§23：媒体×点の表・言葉の選び方）・`js/bias.js`（バイアス度）・`js/absent.js` | 表を「どこが違うか」の数行に畳んだ物（findings）。今の公開データで表があるのは 86 件、言葉の選び方があるのは 6 件 |
| 4 関連とネットワーク | `app.js` `related()`（語 2 つの一致か同じ場所・6 件）・`cases[].lineage`（30 日の続報） | 重みのある結び付きの全体図・理由の表示 |
| 5 立体感 | `js/dossier.js`・`js/story.js`・地図・タイムライン | ホームの最初に「割れ」を一つ大きく |
| 6 アプリ化 | `manifest.webmanifest`・`sw.js`（ネットワーク優先・v48）・apple-touch-icon | 縦に指で流す画面・ホーム画面への追加の案内・ショートカット・正しいマスカブルのアイコン |
| 7 メール | 無し（RSS は `feed*.xml` §21.2 にある） | 端末の中だけの宛先と下書き |
| 8 オーブと音声 | `js/speak.js`（Web Speech API・押した時だけ）・`js/voice.js`（話した頼み→決まった操作） | オーブの描画・案内の台本・字幕 |
| 9 水面下の政策 | `data/politics.json`（法案・官報・会計検査院）・六つのラベル（§18.2） | 暮らしの分野のラベルと「見出しの少なさ」の数 |
| 10 AI への依存 | AI は構築の 3 時間ごとに一度・来場者は自分の鍵（§22） | 根拠の出力と「AI なしでも全部動く」の試験 |
| 11 代表の体験 | `js/entry.js`（比べる画面）・`js/tour.js`（初回の案内） | ホームの最初の一枚・デモの構え |
| 12 フィルターバブル | 自分の読み方（この端末だけ）・`js/sections.js` `oneSideOf`（片側だけ） | 並べ方で何が消えるかを見せる画面 |

今の公開データ（2026-11-11 15:13 の構築）：出来事 1569・見出し 1773・源 121・国内と海外の両方に見出しがある出来事 12・`coverage` 86。hero の候補は日によって 0 件になり得るので、§5.1 の順で必ず何かを出す（作らない）。

## 2. 枝の分け方と共有ファイルの印

### 2.1 持ち分

| 枝 | 新しいファイル（主） | 触ってよい共有ファイル |
|---|---|---|
| data | `parallax/relations.py` `parallax/reaction.py` `parallax/impact.py` `parallax/hero.py`、`data/aliases.json` `data/lifewords.json`（手で書く）、`js/relations.js` `js/reaction.js` `js/impact.js`（読み口：形の検査だけ・DOM なし）、`tests/test_relations.py` `test_reaction.py` `test_impact.py` `test_hero_pick.py`、`tests/js/relations.test.js` `reaction.test.js` `impact.test.js`、`tests/fixtures/relations.sample.json` `reaction.sample.json` `impact.sample.json` `hero.sample.json` | `parallax/coverage.py`（findings を足す）・`parallax/video.py`（views を足す）・`parallax/build.py` と `parallax/extras.py`（呼ぶ一行ずつ）・`tools/assemble_site.py` `DATA_FILES`・`.github/workflows/update.yml`・`docs/CONTRACT-public.md`（§24〜§26 を足す）・`js/coverage.js`（findings の検査） |
| hero | `js/hero.js` `js/demo.js` `js/orb.js` `js/guide.js` `js/bubble.js` `js/swipe.js`、`tests/js/hero.test.js` `demo.test.js` `orb.test.js` `guide.test.js` `bubble.test.js` `swipe.test.js`、`docs/hero.md` | `index.html`・`js/app.js`・`css/app.css`・`js/i18n.js`・`sw.js` の **hero の印の区間だけ** |
| app | `js/search.js` `js/netview.js` `js/install.js` `js/mail.js`、`assets/icons/icon-maskable-512.png`、`tests/js/search.test.js` `netview.test.js` `install.test.js` `mail.test.js` `manifest.test.js`、`docs/app.md` | `manifest.webmanifest`（app だけが持つ）・`index.html`・`js/app.js`・`css/app.css`・`js/i18n.js`・`sw.js` の **app の印の区間だけ** |

- 同じファイルを二つの枝が印の外で触らない。印の外を変えたくなったら、その枝の `docs/hero.md`・`docs/app.md` に書いて J が合わせる。
- 契約（`docs/CONTRACT-public.md`）は data だけが書く。hero と app の決めた事は各自の `docs/*.md` に書き、合わせる時に J が §27（頁）として写す。
- `sw.js` の `CACHE` の版（今 v48）は合わせる時に J が一度だけ v49 へ上げる。枝では上げない。

### 2.2 印（step 0：枝を切る前に J が main へ一つのコミットで入れる）

中身は空。各枝はこの間だけを書く。

```
js/app.js      // ==== hero:begin ====   … // ==== hero:end ====      （start の直前：import と結線）
               // ==== app:begin ====    … // ==== app:end ====
               import の行も各区間の中に置く（ES module の import は最上位ならどこに書いても先に読まれる。
               区間は最上位に置き、関数の中に入れない。結線は区間の中の関数 heroWire() / appWire() を start から一度呼ぶ。
               step 0 は空の heroWire() / appWire() を区間に置き、start の中に二つの呼び出しを一行ずつ入れる）
css/app.css    末尾に /* ==== hero:begin ==== */ … /* ==== hero:end ==== */ と /* ==== app:begin ==== */ … /* ==== app:end ==== */
index.html     ホームの先頭に <!-- hero:begin --><section id="hero" hidden></section><!-- hero:end -->
               上の帯の検索の隣に <!-- app:begin --><div id="app-slot"></div><!-- app:end -->
               body の末尾に <!-- hero:begin:tail --><!-- hero:end:tail --> と <!-- app:begin:tail --><!-- app:end:tail -->
js/i18n.js     辞書の末尾に // hero:begin … // hero:end と // app:begin … // app:end
sw.js          SHELL を SHELL_BASE と、// hero:begin const SHELL_HERO = []; // hero:end、// app:begin const SHELL_APP = []; // app:end に分け、
               const SHELL = [...SHELL_BASE, ...SHELL_HERO, ...SHELL_APP]
```

### 2.3 順序

| 日 | 何 |
|---|---|
| 11/12 午前 | step 0（J）。data が §3 の fixtures 四つと読み口 `js/relations.js` `js/reaction.js` `js/impact.js` を最初のコミットで出す（半日以内） |
| 11/12〜11/15 | 三つの枝を並行（worktree・同じファイルを二体に触らせない）。hero と app は fixtures で作り、本物のデータが出たら差し替える |
| 11/16 | J が data → hero → app の順で main へ合わせ、v49、試験・leakcheck・overflow_check、撮影 |
| 11/17〜11/19 | 通しの稽古（§7）と直し。11/20 提出 |

## 3. 受け渡しの JSON（先に決める・data が出し、hero と app が読む）

共通：`schema`・`generated_at`（その構築の時刻）・`latest_generated_at`（元にした `latest.json` の時刻）・`sources`（取得した先ごとの `{ ok, err, n, fetched_at }`）。`null` と `[]` は「取れない」か「無い」で、`sources` がどちらかを言う。値を埋めない。古い物は古いと出す（§18 と同じく 6 時間で赤）。`sid` は `latest.stories[].sid`。BYOK で束ね直した頁は `rule_cids` で引く。

### 3.1 `data/relations.json`（`parallax-relations/1`）— 結び付き・関連・同じ出来事の根拠

```jsonc
{ "schema": "parallax-relations/1", "generated_at": 0, "latest_generated_at": 0,
  "method": { "sim": "tfidf-bigram+terms+places", "k": 5, "min_w": 0.18, "ai": false },   // 計算の名前と閾値。画面の「計り方」に出す
  "nodes": [ { "sid": "s…", "cat": "国際", "n_outlets": 8, "sides": { "jp": 5, "intl": 3, "gov": 0 }, "terms": ["弾劾", "国防長官"] } ],   // 2 社以上の出来事と cases の全部（400 まで）
  "edges": [ { "a": "s…", "b": "s…", "w": 0.41,                      // 0..1、a < b、各 node から重い順に k 本まで（重複は一本）
               "why": { "words": ["国防長官", "弾劾"], "places": ["US"], "aliases": [["エヌビディア", "Nvidia"]], "dt_h": 5.2, "lineage": false } } ],
  "groups": [ { "gid": "g1", "sids": ["s…"], "terms": ["国防長官", "弾劾"] } ],   // 結び付きの連結成分（3 件以上・12 まで）。名前は付けない（語を並べるだけ）
  "same": { "<sid>": {                                              // なぜ一つの出来事として束ねたか（全 story ではなく、2 社以上の物）
      "by": "rule" | "ai",
      "rule_groups": 2,                                             // 元にした規則の束の数（AI が 2 つ以上を一つにした時は 2 以上）
      "links": [ { "a": "<item id>", "b": "<item id>", "sim": 0.52, "words": ["弾劾", "決議案"], "places": ["US"], "nums": ["30"], "dt_min": 48 } ],   // 見出しの対ごとの一致（6 まで・似ている順）
      "ai_joined": [ { "cids": ["c…", "c…"], "best": { "a": "<item id>", "b": "<item id>", "sim": 0.21, "words": [] } } ]   // AI だけが結んだ束の間。規則で見ると何が一致したか（一致が無ければ words は []）
  } } }
```

- 計算は規則だけ：見出しと要旨（§14.1）の文字の 2 文字組の TF-IDF の余弦、§18.11 の大きな語、§18.6 の場所、`data/aliases.json` の別名（日英・略称）。日英をまたぐ一致は場所・数・別名だけで拾う。**拾えない物は結ばない**（AI に頼らない）。
- `same.ai_joined` が AI の判じの根拠の表示の元。AI の答えに理由の欄は足さない（`data/prompt.json` と記録済みの鍵は変えない）。AI が結んだ束の間を規則の目で測り直し、一致した語・場所・時間の差を出す。一致が無い時は「規則では一致が見つからない」と出す（AI の判じを補って作らない）。

### 3.2 `board.cases[sid].coverage.findings`（§23 に足す）— バイアスの箇所を具体的に

```jsonc
"findings": [ {                                                     // 5 まで。重い順（only_side > word_choice > num_diff > lead_differs > first_gap）
    "kind": "only_side" | "word_choice" | "num_diff" | "lead_differs" | "first_gap",
    "row": "num",                                                   // 表の行（coverage.rows[].k）。word_choice は null
    "outlets": [0, 2, 3], "others": [1, 4],                         // coverage.outlets の番号：載せた側 / 見出しと要旨に出ていない側
    "side": "jp" | "intl" | "gov" | null,                           // only_side の時、点を載せたのが一つの側だけならその側
    "text": "人数は国内 3 社が載せ、海外 2 社の見出しと要旨には出ていない",   // 決まった型の文（下の表）。数は数えた値だけ
    "evidence": [ { "o": 0, "p": "…300人が抗議", "k": "300人" } ] } ]   // セルそのもの（§23 の {p, k}）
```

| kind | 型の文（変えてよいのは〔〕だけ） |
|---|---|
| only_side | 〔行の名〕は〔側〕〔n〕社が載せ、〔側〕〔m〕社の見出しと要旨には出ていない |
| word_choice | 〔set の名〕：「〔語〕」〔n〕社・「〔語〕」〔m〕社 |
| num_diff | 〔何の数〕が違う：〔値〕（〔媒体〕）・〔値〕（〔媒体〕） |
| lead_differs | 見出しの最初の語：〔側〕は「〔語〕」・〔側〕は「〔語〕」 |
| first_gap | 〔側〕が〔側〕より〔時間〕早く報じた |

守る線は §23 のまま：報じなかった・隠した・意図を書かない。§4.7 の沈黙の語の検査を findings の text にも掛ける。

### 3.3 `data/reaction.json`（`parallax-reaction/1`）— 世論の反応（公開の値だけ）

```jsonc
{ "schema": "parallax-reaction/1", "generated_at": 0, "latest_generated_at": 0,
  "sources": { "hatena": { "ok": true, "err": "", "n": 412, "fetched_at": 0 }, "youtube": { "ok": true, "n": 38, "fetched_at": 0 }, "wikipedia": { "ok": true, "n": 20, "fetched_at": 0 } },
  "items":  { "<item id>": { "hb": 12 } },                            // はてなブックマークの件数（その記事の URL）。取れない物は載せない
  "events": { "<sid>": { "hb": { "sum": 140, "max": 96, "n": 6, "by_side": { "jp": 130, "intl": 10, "gov": 0 } },
                          "yt": { "views": 52000, "n": 2, "at": 0 },           // 放送局の動画の視聴回数の和（その動画の公開フィードの値と時刻）
                          "wiki": [ { "title": "…", "views": [0, 0, 0, 0, 0, 0, 0] } ] } },   // 大きな語のうち記事の題と一致した物の 7 日の閲覧数（3 まで）
  "not_used": [ { "name": "Yahoo!ニュースのコメント", "why": "…" }, { "name": "X", "why": "…" }, { "name": "Bluesky", "why": "…" } ] }   // §9 の文を写す
```

- はてな：`https://bookmark.hatenaapis.com/count/entries?url=…`（50 件まで・鍵なし）。一度に 50 件、間に 3 秒。対象は `nodes` の出来事の見出しの URL だけ（毎回 数百件・数分）。ユーザーの名前・コメントは取らない。
- YouTube：`parallax/video.py` が既に読む公開フィード（鍵なし）の `media:statistics views` を `stories[].videos[].views` と `views_at` に足し、ここで出来事ごとに和をとる。
- Wikipedia：Wikimedia の閲覧数の API（鍵なし・User-Agent に連絡先を書く）。語と記事の題が完全に一致した物だけ。一致しない語は出さない。
- 反応は「関心の量」で、賛否ではない。画面も「賛成・反対」「炎上」を言わない。値はその値の時刻と一緒に出す。

### 3.4 `data/impact.json`（`parallax-impact/1`）— 暮らしへの影響が大きい政策

```jsonc
{ "schema": "parallax-impact/1", "generated_at": 0, "vocab": "lifewords/1",
  "areas": [ { "id": "tax", "ja": "税・社会保険" }, { "id": "price", "ja": "物価・家計" }, { "id": "work", "ja": "雇用・賃金" }, { "id": "care", "ja": "医療・介護" },
             { "id": "pension", "ja": "年金" }, { "id": "kids", "ja": "子育て・教育" }, { "id": "home", "ja": "住まい" }, { "id": "energy", "ja": "電気・ガス" },
             { "id": "data", "ja": "個人情報・通信" }, { "id": "move", "ja": "交通" } ],
  "events": { "<sid>": { "areas": ["tax"], "hits": ["社会保険料", "引き上げ"], "stage": "検討" | "法案" | "閣議決定" | "成立" | "施行" | "意見募集" | null,
                          "primary": true, "mainstream_n": 1, "quiet": true } },
  "docs": [ { "kind": "bill" | "gazette" | "pubcomment", "title": "…", "url": "https://…", "date": "2026-11-10", "areas": ["care"], "hits": ["介護報酬"],
              "sid": null | "<sid>", "mainstream_n": 0 } ] }            // ニュースに結ばれない一次資料も載せる（30 まで）
```

- 規則：`data/lifewords.json`（手で書き公開する語の表。§18.2 と同じ「強い語 2・弱い語 1・閾値 2」）。`hits` が根拠の語で、画面はそれをそのまま出す。
- `quiet` は測れる事だけ：一次資料（官公庁・官報・法案・意見募集）があり、かつ主要な型（§18.4 MAINSTREAM）の見出しが 1 社以下。画面の言葉は「主要な媒体の見出し 1 社」で、「隠されている」「報じない」は言わない。
- 意見募集：e-Gov パブリックコメントの RSS（`https://public-comment.e-gov.go.jp/rss/pcm_list.xml`、2026-11-11 に 200 を確認）を `parallax/politics.py` の源に足す。利用条件は実装の時に e-Gov の利用規約で確かめ、`sources.TERMS` に書く。

### 3.5 `data/hero.json`（`parallax-hero/1`）— ホームの最初の一枚（小さく・先に読む）

`latest.json` は 2.8MB ある。会場の回線と電話で最初の一枚を待たせないため、data が候補を選び、表示に要る物だけを 30KB 以内で出す。

```jsonc
{ "schema": "parallax-hero/1", "generated_at": 0, "latest_generated_at": 0,
  "picks": [ {                                                       // 5 まで。最初が既定。並びは下の規則
      "sid": "s…", "tier": "split" | "both" | "one_side",              // §5.1 の段
      "title": { "text": "…", "outlet": "…", "lang": "ja", "ai": false },   // 見出し（AI の見出しなら ai: true と時刻）
      "sides": { "jp": { "n": 5, "outlets": 4, "first_ts": 0 }, "intl": { "n": 3, "outlets": 3, "first_ts": 0 }, "gov": { "n": 0, "outlets": 0, "first_ts": null } },
      "points": { "jp": ["人数"], "intl": ["罷免の語"], "both": ["国防長官", "決議案"] },   // coverage の行の名。片側だけ / 両方
      "findings": [ /* 3.2 の 3 まで */ ],
      "heads": [ { "id": "<item id>", "side": "jp", "outlet": "…", "ts": 0, "title": "…", "link": "https://…" } ],   // 各側 2 まで
      "same": { /* 3.1 same[sid] の写し */ },
      "reaction": null | { "hb": 140, "yt": 52000, "at": 0 },
      "photo": null | { "url": "https://…", "outlet": "…" } } ] }
```

選び方（`parallax/hero.py`・試験で固定）：`split` = 国内と海外の両方に 2 社以上・`coverage` がある・findings が 1 つ以上、を findings の数→媒体の数→新しさ。無ければ `both` = 両方に見出しがある物。無ければ `one_side` = `oneSideOf` の最上位（「国内だけ」「海外だけ」）。どれも無ければ `picks: []` で、頁は今のホームのまま（作らない）。

## 4. 枝 data（集める・測る・結ぶ）

### 4.1 ニュースのネットワークと関連（`parallax/relations.py`）

- 入力：`latest.json` の stories と items、`board.cases`、`history.json`（続報の `lineage`）。外へは取りに行かない。
- 計算：§3.1。O(n²) は 400 件で 8 万対、標準ライブラリで 1 秒台に収まる事を試験で測る（5 秒を超えたら k-近傍を語の索引で絞る）。
- 頁の `related()` は `relations.json` があればその `edges` を、無ければ今の規則を使う（app の `js/netview.js` と hero の関連の行が同じ読み口 `js/relations.js` `relatedOf(sid)` を使う）。

### 4.2 AI がなぜ同じ出来事と判じたか（`same`）

- 規則の束：見出しの対の一致（語・場所・数・時間の差）を出す。AI が束ね直した物：`ai_joined` で、AI が結んだ束の間を規則の目で測った値を出す。
- 頁の表示（hero と app が使う）：「束ねた理由」の欄に、似ている対を 2 つ（一致した語に印）、場所、最初と最後の時間の差、「規則」か「AI（モデル名・時刻）」。

### 4.3 バイアスの箇所（`parallax/coverage.py` の findings）

- §3.2。材料は今の表と同じ（見出しと要旨だけ・本文は読まない）。今 `words` が 6 件にしか無いのは `data/coverage.json` の `sets` が少ないため。本選までに sets を足す（罷免/辞任/解任、抗議/暴動/デモ、侵攻/攻撃/作戦、減税/負担軽減、値上げ/改定 など 30 組）。足した組は公開の表なので、名前は物を指す語にし、立場の語を使わない。
- `bias.js` のバイアス度はそのまま。findings はその「どこが」を言う欄。

### 4.4 暮らしのラベル（`parallax/impact.py`）

- §3.4。六つのラベル（§18.2）とは別の軸。ラベルの名は「暮らし」（画面のチップ）、分野は areas の ja。
- 試験：語の表の各語に正例と負例の見出しを一つずつ（`tests/test_impact.py`）。精度の値は主張しない（§18.2 の caveat と同じ文）。

### 4.5 世論の反応（`parallax/reaction.py`）

- §3.3。`python -m parallax.extras` の後の段で走らせ、失敗しても構築を止めない（前のファイルを残す）。
- 間隔と量：はてなは 50 件ごとに 3 秒、全体で 10 分を超えない。Wikipedia は 1 秒に 1 件まで。どちらも User-Agent に公開の連絡先（`tomnexttech@users.noreply.github.com`）。

### 4.6 AI への依存を減らす

- AI なしで動く事を試験で固定：`latest.json` の `ai_run.status` が off の fixture で、relations・findings・impact・reaction・hero が全部出る（`tests/test_hero_pick.py` に「AI なし」の場合を一つ）。
- AI の役は二つだけ（今と同じ）：束ね直し（§3〜4）と一行の要点（§13）。どちらも構築で 3 時間に一度。来場者が押して作り手の鍵が使われる所は無い（今も無い。§22 の来場者の鍵だけ）。

### 4.7 data の受け入れの条件

1. 本物の構築（`--public --og --extras`）で `relations.json` `reaction.json` `impact.json` `hero.json` が出て、`tools/assemble_site.py` が頁と一緒に配る。`hero.json` は 30KB 以内。
2. 同じ構築で findings を持つ出来事が 20 件以上（今は words 6 件）。数は報告に実数で書く。
3. 反応の値は取得の時刻と一緒に出て、取れない源は `sources.ok=false` で残る（模擬の失敗で試す：ネットワークを切った fixture）。
4. 試験：新しい試験を足し、`python -m unittest discover -s tests` と `node --test` が全部通り、`python tools/leakcheck.py --no-history` が 0。
5. 契約 §24（relations）・§25（reaction・impact）・§26（hero）と §23 の findings を `docs/CONTRACT-public.md` に書いた。

## 5. 枝 hero（画面と体験）

### 5.1 ホームの最初の一枚（`js/hero.js`）

最初に `data/hero.json` を読み、`picks[0]` を描く。`latest.json` を待たない。hero.json が無い・古い・壊れている時は、`latest.json` が来てから同じ選び方を JS で（`entry.js` の `sides`・`oneSideOf` を使って）行う。

骨組み（電話の縦）：

```
┌───────────────────────────────┐
│ 見出し（そのまま・2 行まで）   ◯オーブ │  ← 押すと読み上げ
│ 国内 4 社 ███████████│████ 海外 3 社      │  ← 一本の棒を中央で割る（側の色は棒だけ）
├──────────┬────────┬─────────┤
│ 国内だけ  │ 両方    │ 海外だけ  │  ← coverage の行の名（片側だけ／両方）
│ 人数      │ 国防長官 │ 罷免の語  │
├──────────┴────────┴─────────┤
│ 「罷免」2 社・「辞任」1 社            │  ← findings 1〜3 行（決まった型の文）
│ 海外が国内より 1 時間 27 分早く報じた  │
├───────────────────────────────┤
│ [元の記事]  [束ねた理由]  [比べる]    │  ← 44px 以上
└───────────────────────────────┘
  ‹ 1 / 5 ›  ほかの候補（横に流す）
```

- 広い画面：左に見出しと棒と三つの列、右に 200〜240px のオーブ。下に findings。
- 押すと：「元の記事」＝各側の最初の見出し（媒体・時刻・リンク）のシート。「束ねた理由」＝§4.2 の欄。「比べる」＝今の比べる画面（`entry.js`）をこの出来事で開く。
- `tier` が `both` の時は三つの列の代わりに各側の見出しを 2 本ずつ並べる。`one_side` の時は棒を片側だけ描き、「国内だけ」などの見出しと `ONE_SIDE_NOTE` を出す。
- 見出しの語は一語：「国内だけ」「両方」「海外だけ」「元の記事」「束ねた理由」「比べる」。サイトを説明する文は置かない。
- 意匠（frontend-design の計画）：今の体系（`docs/design-system.md`：地 `#000`/`#f5f5f7`・面 `#1c1c1e`/`#fff`・シアンは選んだ物の縁だけ・側の色は印だけ・Barlow Semi Condensed の大きな数は一件に一つ）を変えない。大胆さは一か所だけ＝**中央で割れた一本の棒**。数字は棒の両端の二つで、大きな数の決まり（一件に一つ）の例外として「媒体の数を側ごとに」とする（design-system に一行足す）。カードを並べた箱の見た目・大文字の小見出し・飾りの帯は使わない。

### 5.2 デモの構え（`js/demo.js`）

- `?demo=1`（または設定の一つ）で入る。右上に「最初から」（44px）。押すと：選んだ出来事・開いたシート・スクロール・検索・並び順・読み上げを全部戻し、hero の最初の候補へ。この端末の閲覧の記録と課題の一覧も消す（デモの端末だけ・確認なし。デモでない時はこのボタンは出ない）。
- 何も触られずに 90 秒：画面の下に「10 秒後に最初に戻ります」と「続ける」を出し（WCAG 2.2.1：延ばせる）、10 秒で戻す。読み上げ中は数えない。
- 「この版で固定」：その時の `hero.json` `latest.json` `board.json` `relations.json` `reaction.json` を Cache Storage の別の箱（`parallax-demo`）に写し、デモの間はそこから読む。会場の回線が落ちても同じ画面が出る。端末の中だけで、リポジトリへは入れない（§20.1：見出しはコミットしない）。上の帯に固定した時刻を出す（古い物を今に見せない）。
- 発表者の鍵盤：`R` で最初から、`→` `←` で候補の切り替え、`Space` で読み上げ（入力欄にいる時は効かない）。

### 5.3 オーブ（`js/orb.js`）

- 元：作り手の私用の画面の Canvas 2D のオーブ（点の球・計器の環・照準の弧・声の帯で動く）。名前・注釈の固有名・私用の語は移さず、描き方と動きだけを移す。three.js 版は重い（600KB）ので既定にしない。CSP は `script-src 'self'` のままで足りる。
- 呼び口：`mountOrb(host, { size }) -> { setState('idle'|'thinking'|'speaking'|'listening'), pulse(), setBands(arr), destroy() }`。`thinking` = データを読む間、`speaking` = 読み上げ中。
- 色は頁の体系に合わせる：待つ＝白に近い氷色、話す＝白、読めない時だけ赤。黄・緑・橙は使わない。
- 声との連動：Web Speech API は出力の音を分析できない。そこで `SpeechSynthesisUtterance` の `boundary`（語の区切り）で `pulse()` し、量の帯は作らない（真似の帯を作らない）。来場者が自分の Gemini の鍵で音声を作った時だけ、音を `AnalyserNode` に通して本物の帯で `setBands`。
- 描かない時：`document.hidden`・画面外・`prefers-reduced-motion` は止まった一枚。待つ間 20fps、話す間 60fps。canvas は `aria-hidden`、押せるのは上に重ねた `<button>`（「読み上げ」/「止める」）。

### 5.4 音声の案内と要約（`js/guide.js`）

- 既定：ブラウザの Web Speech API（端末の声・費用 0・外へ何も出ない）。`js/speak.js` の声の選び方を使う。
- 台本は規則で作る（AI を呼ばない）：`hero.json` から「〔見出し〕。国内〔n〕社、海外〔m〕社。〔findings の 1 行目〕。〔findings の 2 行目〕。」。構築が作った要点（§13・AI の印付き）がある時は、その後に「AI の要点です。」と前置きして読む。数は data の値だけ。§4.7 の沈黙の語の検査を台本にも掛ける（試験）。
- 字幕：読んでいる文をオーブの下に出す（耳の聞こえない来場者・騒がしいブース）。
- Gemini の音声：来場者が設定で自分の Gemini の鍵をつないだ時だけ「声を Gemini にする」が出る。モデルの名前・料金・形式は実装の時に Google の公式の文書で確かめて `docs/hero.md` に書く。作り手の鍵は使わない。
- 自動では鳴らさない（ブラウザの決まりでもある）。デモの構えでも、最初の一押しで鳴る。

### 5.5 並び順で何が消えるか（`js/bubble.js`）— フィルターバブルを画面で

- 「並び順」の切り替え：**人気順**（はてなブックマークの件数の多い順＝§3.3 の実データ）・**自分の読み方順**（この端末で開いた分野と媒体に近い順）・**全体**（PARALLAX の並び：側と型の多さ）。
- 切り替えると、同じ上位 10 件の中で数が変わる物を出す：「海外だけのニュース 0 件 → 3 件」「地方紙・小さな媒体だけのニュース 0 件 → 2 件」「暮らしのラベル 1 件 → 4 件」。数は今のデータを数えた値。
- 自分の読み方：開いたニュースの側・分野の割合を、全体の割合と並べた横棒（この端末だけ・送らない・消すボタン）。開いた数が 5 件未満の時は出さない。
- 言葉：見出しは「並び順」。「操作されています」などの断じる文は置かない。違いの数だけを出す。

### 5.6 指で流す（`js/swipe.js`）

- 電話の縦の「流す」画面：一画面に一件の出来事（CSS の scroll-snap・縦）。一件の中で横に流すと国内・海外・官公庁の見出しが一枚ずつ。下から上で次の出来事。
- 鍵盤と読み上げソフト：`↑` `↓` で前後、`←` `→` で側、各カードは見出し付きの `<article>`、「前へ」「次へ」のボタンも置く（指以外でも全部できる）。
- 出来事の並びは §5.5 で選んだ並び順に従う（流す画面でも並び順が見える）。

### 5.7 hero の受け入れの条件

1. 公開の頁（本物のデータ）で、ホームを開いて最初の一枚が `hero.json` から描かれ、`latest.json` を待たない（撮影で、`latest.json` を遅らせた時も一枚目が出る）。
2. 候補が 0 の日の fixture で、今のホームのまま（空の枠を描かない）。
3. 「最初から」で全部が戻る（試験：状態を変えてから reset → 初期の状態と一致）。90 秒の戻りに「続ける」がある。
4. オーブは reduced-motion で止まり、隠れている間は描かない（試験：requestAnimationFrame が呼ばれない）。台本に data に無い数が出ない（試験）。
5. iPhone 縦横・iPad で `tools/overflow_check.mjs` が 0。押せる所 44px 以上・字 13px 以上。
6. 撮影：`60_final/` に hero（縦・横・iPad・デスクトップのライトとダーク）、デモの戻り、並び順の比べ、流す画面、オーブの読み上げ中。

## 6. 枝 app（検索・アプリ化・メール）

### 6.1 検索の強化（`js/search.js`）

- 言葉の揺れ：NFKC・ひらがなとカタカナ・長音・全角半角・英字の大小を畳む。`data/aliases.json`（data が持つ別名の表：米国=アメリカ=米=US、エヌビディア=Nvidia、国防長官=国防相 など）と `data/places.json` の日英の地名で広げる。広げた語は結果の上に出す（「アメリカ・米国・US でも探しました」の代わりに、語のチップを並べ、押すと外せる）。
- 絞り込み：媒体・期間（6 時間・24 時間・36 時間・7 日＝`data/archive/`）・側（国内・海外・官公庁）・分野・片側だけ・暮らし・反応の多い順。今の `searchOf` の引数を広げる形にし、`newsdesk.js` は変えない（search.js が包む）。
- 7 日分：`data/archive/index.json` と日のファイル（§21.3）を、7 日が選ばれた時だけ読む。結果は `s/<sid>.html` へ。
- 状態はアドレスの `#q=…&side=…`（共有できる・個人の情報は入らない）。
- 何も無い時：「〔語〕は見つかりません。期間を 7 日にする」のボタン（空の状態は次の一手）。

### 6.2 つながりの図（`js/netview.js`）

- `relations.json` の `nodes` と `edges` を、出来事の点と線で描く（Canvas 2D・力学の配置は数十回の反復で止め、動き続けない）。点の大きさ＝媒体の数、点の色は塗らず側の割合を小さな棒で。線の太さ＝`w`。
- 一つ押すと、その出来事と結ばれた物だけを残し、線の横に `why.words` を出す。「束ねた理由」と同じ形。
- 出来事の詳しい画面の「関連」の行もこの読み口から（理由の語を添える）。
- 電話：図の代わりに、結ばれた順の一覧を既定にし、「図」に切り替えられる。

### 6.3 ホーム画面に置けるアプリ（`manifest.webmanifest`・`js/install.js`・`sw.js` の app の区間）

- manifest：`id`・`shortcuts`（検索・流す・並び順）・`screenshots`（縦と横・§5.7 の撮影から）・本当のマスカブルのアイコン（中央 80% に収めた別の絵。今は 512 を流用している）・`display_override: ["standalone"]`。
- iPhone：`beforeinstallprompt` が無いので、Safari で、まだ standalone でない時に一度だけ「ホーム画面に追加」の手順のシート（共有のアイコン→ホーム画面に追加）。閉じたら出さない（この端末だけ）。
- オフライン：今のネットワーク優先のまま、取れない時は控えの頁と最後のデータ（時刻を赤で）。新しい JS とデータを SHELL_APP・SHELL_HERO に足す。
- できない事：サーバーを持たないので、プッシュの通知と、決まった時刻にメールを送る事はできない（§6.4）。

### 6.4 メール（`js/mail.js`）

- 宛先は端末の中だけ（`localStorage` `parallax.mail.v1`。サーバーにも設定のファイルにも置かない・「消す」がある）。宛先を保存しなくても使える（空のまま開き、メールのアプリで選ぶ）。
- 「メールで送る」：端末のメールのアプリを `mailto:` で開き、**自分宛の下書き**を作る。送るのは来場者がメールのアプリで押した時だけ。本文：日付と構築の時刻、hero と重要なニュース（`board.priority` の上位 5）の見出し・国内と海外の社数・findings の 1 行・暮らしのラベル・`s/<sid>.html` のリンク。
- 長さ：`mailto:` の長さは端末によって切れるので、本文を 1800 字で止め、残りは「続きは頁で」とリンク一本にする（試験で長さを固定）。Web Share API がある端末では「共有」も出す。
- 毎朝届く形は、サーバー無しでは作れない。RSS（`feed.xml`）があるので、来場者が自分で選んだ RSS のメールの仕組みを使う事はできる、と頁の設定に一行（特定の他社の勧めはしない）。

### 6.5 app の受け入れの条件

1. 「アメリカ」「米国」「US」で同じ出来事が出る。「えぬびでぃあ」でも出る（試験）。7 日の検索が archive から出る（fixture）。
2. iPhone の Safari でホーム画面に追加して全画面で開き、機内モードで控えと赤い時刻が出る（実機で確かめた時だけ「確かめた」と書く。できなければ Chrome の端末の真似とオフラインの模擬の結果を分けて書く）。
3. メールの下書きの本文が 1800 字以内で、宛先が `localStorage` の一つの鍵の外に書かれない（試験：他の鍵・URL・設定のファイルを見る）。
4. つながりの図が 400 点で 1 秒以内に止まり、電話は一覧が既定。overflow_check 0、44px・13px。
5. manifest の試験（`tests/js/manifest.test.js`：id・icons・maskable が別のファイル・shortcuts の先が在る）。

## 7. 発表 7 分とブース

### 7.1 最初の 60 秒（発表の冒頭・ブースで来場者に見せる順）

| 秒 | 画面 | 言う事 |
|---|---|---|
| 0〜10 | ホームの一枚。棒が中央で割れている | 同じ出来事を、国内 5 社と海外 3 社が報じています |
| 10〜25 | 「国内だけ」「海外だけ」の列、findings | 海外だけが載せた点、言葉の選び方の違いが、見出しから数えて出ています |
| 25〜35 | オーブを押す。声と字幕 | 声で読みます。費用はかかりません、端末の声です |
| 35〜50 | 並び順を「人気順」→「全体」 | 人気の順に並べると、海外だけのニュースが上位から消えます。0 件と 3 件 |
| 50〜60 | 「束ねた理由」 | AI が同じ出来事と判じた根拠です。一致した語と時間の差を、規則で測り直して出します |

残りの 6 分：課題（フィルターバブル・小さな媒体の重要なニュース）→ 仕組み（AI なしの束ね・結び・測る、AI は中枢の一か所、費用 0 円で 3 時間ごと）→ 暮らしのラベル（見出しの少ない政策）→ 反応（公開の値だけ・使わない物とその理由）→ 電話のアプリ（流す・ホーム画面）→ 限界（本文は読まない・言語をまたぐ一致は限られる・真偽と左右は判じない）。

### 7.2 ブース

- 端末：iPad（横・デモの構え・固定した版）と iPhone（来場者が自分の電話で開ける QR）。ノートの画面は発表者用。
- 迷わない導線：hero の三つのボタンだけで一周できる。どこからでも右上の「最初から」。
- 投票につながる一言の見た目：割れた棒とオーブ。QR の横に「自分の電話で開けます」。

## 8. 試験と受け入れ（共通）

- 全部通す：`node --test $(ls tests/js/*.test.js)`（今 287）・`python -m unittest discover -s tests`（今 367）・`python tools/leakcheck.py --no-history`（0）。数は減らさない。
- 画面：`tools/overflow_check.mjs` を iPhone 縦横・iPad・デスクトップで 0。撮影は Chrome の端末の真似（プロファイルは %TEMP% に作って消す）、PNG だけを提出のフォルダの `60_final/` へ。
- 音・照明・再生の試験はしない。音声は `speechSynthesis` の模擬（試験の中で speak を差し替えて、渡された文を調べる）で確かめる。
- 報告：確かめた事と確かめていない事を分ける。「直りました」は実物で確かめた時だけ。

## 9. 使わない物・できない事（一次情報で確かめた・2026-11-11）

| 物 | 判断 | 確かめた事 |
|---|---|---|
| Yahoo!ニュースのコメント | 使わない | `news.yahoo.co.jp/robots.txt` が `Disallow: /articles/*/comments` と `/api/` を置く。コメントを外へ出す公開の API は無い（LINEヤフーが出すのはコメントの評価の API で、取得の物ではない） |
| X | 使わない | 公式の料金の頁：投稿の読み取りは 1 件 $0.005、無料の読み取りの枠は書かれていない。費用 0 円で毎日動かす持続性の軸と合わない |
| Bluesky の検索 | 今回は使わない | 公開の口 `public.api.bsky.app` の `app.bsky.feed.searchPosts` が 403（認証が要る）。アカウントを作って鍵を置く形は、本選後に規約を読んでから決める |
| はてなブックマークの件数 | 使う | `bookmark.hatenaapis.com/count/entries`：鍵なし・一度に 50 件まで・連続の時は数秒あける（公式の文書）。試しの一回で 200 |
| YouTube の視聴回数 | 使う | 既に読んでいる放送局の公開フィードに `media:statistics views` がある（鍵なし） |
| Wikipedia の閲覧数 | 使う（語が記事の題と一致した物だけ） | Wikimedia の閲覧数の API：鍵なし。試しの一回で 200 |
| 決まった時刻のメール・プッシュの通知 | できない | 静的な頁でサーバーが無い。端末の下書きと RSS で代える |
| Gemini の音声 | 来場者の鍵の時だけ | 作り手の無料枠を来場者に使わせない（要望 10） |

## 10. デザインのスキルを使った記録（この設計で）

- **frontend-design**：今の体系を変えず、大胆さを一か所（中央で割れた一本の棒）に絞った。並べた箱の見た目・大文字の小見出し・飾りの帯・矢印の付いたボタンの文を避けた。動きはオーブの一つと、押した時に変わった所だけ。
- **accessibility-review**（WCAG 2.1 AA）：オーブの canvas は `aria-hidden` で押すのは `<button>`、読み上げに字幕（1.2）、自動で鳴らさない（1.4.2）、90 秒の戻りは延ばせる（2.2.1）、流す画面は鍵盤とボタンでも全部できる（2.1.1）、側の色は印だけで字に使わない（1.4.1・1.4.3）、44px（2.5.5）、reduced-motion。
- **design-critique**：最初の 2 秒で目に入るのが「割れ」でなければ失敗、と決めた。今のホームは六枚のカードが同じ重さで並び、何を比べる道具かが 2 秒では伝わらない、が直す理由。並び順の比べは断じる文でなく数の差で見せる（審査の「真偽と左右は判じない」と矛盾させない）。
- **ux-copy**：見出しとボタンは一語か短い動作（「国内だけ」「両方」「海外だけ」「元の記事」「束ねた理由」「比べる」「最初から」「続ける」「並び順」「人気順」「全体」「メールで送る」）。空の状態は次の一手（「期間を 7 日にする」）。報じなかった・隠したの語は使わない。
