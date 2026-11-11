# 枝 hero（画面と体験）— 決めた事と読み口

設計の正本は `docs/final-plan-20261111.md` §5。ここは枝 hero が実装で決めた事と、合わせる時に J が §27（頁）へ写す物。

## ファイル

| ファイル | 役 |
|---|---|
| `js/hero.js` | ホームの最初の一枚。`data/hero.json` の読み口（`readHero`）と、無い時の同じ選び方（`pickHeroes`）、描画（`createHero`） |
| `js/orb.js` | Canvas 2D のオーブ（点の球・目盛りの環・照準の弧）。`mountOrb(host) -> { setState, pulse, setBands, destroy }` |
| `js/guide.js` | 規則で作る読み上げの台本（`scriptOf`）と、端末の声で読む（`createGuide`）。字幕と語の区切りの脈 |
| `js/demo.js` | `?demo=1` の構え。「最初から」・90 秒の戻り（「続ける」付き）・「この版で固定」・発表者の鍵盤 |
| `js/bubble.js` | 並び順（人気順・自分の読み方順・全体）と、上位 10 件で変わる数 |
| `js/swipe.js` | 流す画面（縦に一件ずつ・横に国内・海外・官公庁） |

共有ファイルは印の区間だけを書いた：`js/app.js`（`// ==== hero:begin ====`〜`hero:end`、`main()` の中に `heroWire();` の一行）・`index.html`（`<!-- hero:begin -->` の `section#hero` と `<!-- hero:begin:tail -->`）・`css/app.css`（末尾の hero 区間）・`js/i18n.js`（辞書の末尾の hero 区間）・`sw.js`（`SHELL_HERO`、`SHELL = [...SHELL_BASE, ...SHELL_HERO]`）。main に step 0 がまだ無かったので、hero の分の印はこの枝で入れた。app の印（`SHELL_APP` など）は入れていない。`sw.js` の版は上げていない。

## 最初の一枚

- 読む順：`heroWire()` は `main()` の中で `latest.json` を取りに行く前に呼ばれ、`data/hero.json` を先に読む。読めて picks があればすぐ描く。
- `hero.json` が無い・壊れている・`latest_generated_at` が画面の `latest.json` より古い時は、`latest.json` が来てから同じ選び方を JS で行う（`pickHeroes`：split → both → one_side、5 まで）。
- findings：`board.cases[sid].coverage.findings` があればそれを使う（`[]` は「無い」として残し、作らない）。この欄がまだ無い構築では、表と時刻から測れる三つだけを頁で出す：`only_side`（表の行を片側だけが載せた）・`word_choice`（表の `words`）・`first_gap`（最初の報道の差が 30 分以上の時）。文は §3.2 の型。日付の行（`いつ`）は名を「時期」と書く。
- 束ねた理由：`relations.json` の `same[sid]` があればそれ、無ければ story の `basis`（語・場所・時間の幅）。AI の判じなら `ai_run` のモデル名と時刻を添える。`ai_joined` で語が無い時は「規則では一致が見つからない」。
- 候補が 0 の日は `section#hero` を `hidden` のままにし、ホームは今のまま（空の枠は描かない）。
- iPhone の横持ち（高さ 500px 以下の横）では出さない。既存の「一画面に見出し 3〜4 本」の一覧の格子を守るため（試した結果、上に置くと一覧の高さが 0 になった）。iPad の縦横・iPhone の縦・PC では出す。
- 読み込み直後、`select()` が一覧の行を追って頁を下へ送るので、触られる前に限って最初の一枚まで戻す。
- 最初の一枚が 25% 以上見えている間は、下の「注目ニュース」の 12 秒ごとの自動の切り替えを止める（`state.pausedUntil` を延ばすだけ）。切り替えが一覧の行を `scrollIntoView` で追い、頁を一枚から引き離すため。

## オーブと声

- 状態は idle（20fps）・thinking（30fps）・speaking（60fps）・error（止まった一枚）。`document.hidden`・画面外（IntersectionObserver）では requestAnimationFrame を呼ばない。`prefers-reduced-motion` と設定の「動きを減らす」（`data-calm`）は変化ごとに一枚だけ描く。
- 色は氷白・白・赤だけ。ライトの外観でも点が読めるよう、オーブは常に暗いレンズ（円）の上に描く。
- Web Speech API は出力の音を測れないので、`boundary`（語の区切り）で `pulse()` するだけ。偽の帯は作らない。
- 台本：「（AI の見出しなら「AI が付けた見出しです。」）見出し。国内 n 社、海外 m 社。findings の 1〜2 行目。（AI の要点があれば「AI の要点です。」と前置きして要点）」。沈黙の語を含む行は読まない（`SILENCE_JA`・`prompt.json` の表と試験で照合）。
- 自動では鳴らさない。押した時だけ。字幕はオーブの下（電話では読み上げボタンの下）。

### できていない事

- 「声を Gemini にする」（来場者の鍵で音声を作り、AnalyserNode で本物の帯を出す）は作っていない。`setBands()` の受け口だけがある。モデル名・料金・形式を Google の公式の文書で確かめる作業もしていない。

## デモの構え

- `?demo=1`：右上（電話では下）に「この版で固定」と「最初から」。
- 「最初から」で戻す物（`RESET_STEPS` の順）：読み上げ・重なった画面（流す・シート・検索の窓・設定・データと AI・案内）・検索・並び順・分野・画面（ホーム）・この端末の閲覧の記録・保存したニュース・最初の一枚の 1 番目・スクロール。デモの時だけ・確認なし。
- 90 秒、人が触らない（pointerdown・keydown・wheel・touchstart）と「n 秒後に最初に戻ります」と「続ける」を出し、10 秒で戻す。読み上げ中は数えない。一覧の自動スクロールは「触った」に数えない。
- 「この版で固定」：`latest.json` `board.json` `hero.json` `relations.json` `reaction.json` `impact.json` `labels.json` のうち取れた物を Cache Storage `parallax-demo` に写し、`localStorage` `parallax.demo.v1` に時刻を置く。デモの間は `fetch` を包み、この七つだけをそこから読む。帯に「固定 11/11 15:50」。リポジトリには何も入らない。
- 鍵盤（入力欄では効かない）：`R` 最初から・`←` `→` 候補・`Space` 読み上げ。デモの時は `R` が「自動」への切り替えより先に取られる。

## 並び順と流す

- 人気順は `reaction.json` にはてなブックマークの件数がある時だけ出す。自分の読み方順は開いた記録が 5 件以上の時だけ。どちらも無ければ「全体」だけで、切り替えのボタンは出さない。
- 変わる数：海外だけのニュース・地方紙・小さな媒体だけのニュース（`SMALL_TYPES`：地方紙・専門・政党機関紙・週刊誌・独立系）・暮らしのラベル（`impact.json` がある時だけ）。前に選んでいた並び順から今の並び順への「n 件 → m 件」。
- 自分の読み方：5 件以上で、自分と全体の側の割合の棒と「記録を消す」。
- 流す：`?flow=1` で開く（app 枝の manifest のショートカットの先）。並び順は今選んでいる物。`↑` `↓` 出来事・`←` `→` 側・`Esc` 閉じる。側ごとのボタン（「国内 5」など）・「前へ」「次へ」「比べる」「閉じる」。Tab は層の中で回る。

## 英語の画面

i18n の hero 区間に固定の語を足した。数の入る文（「n 秒後に最初に戻ります」「n 件 → m 件」）と findings の文は日本語のまま（findings はデータの文と同じ扱い）。
