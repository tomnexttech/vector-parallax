# 枝 app — 検索・つながり・アプリ化・メール（2026-11-11）

設計の正本は `docs/final-plan-20261111.md` §6。ここは app 枝が決めた事と、合わせる時に J が要る事だけを書く。

## 1. 足したファイル

| ファイル | 中身 |
|---|---|
| `js/search.js` | 言葉の揺れ（NFKC・かなの種類・長音・中黒・英字の大小）、別名と地名で広げる、絞り込み（`newsdesk.js` `searchOf` を包む・`newsdesk.js` は変えない）、7 日分（`data/archive/`）、検索のアドレス |
| `js/netview.js` | つながりの図（Canvas 2D・決まった回数で止まる配置）、一覧、理由の語 |
| `js/install.js` | ホーム画面からの起動の判定、iPhone と iPad の Safari の手順（一度だけ）、オフラインの一行 |
| `js/mail.js` | 宛先（`localStorage` `parallax.mail.v1` だけ）、下書きの本文（1800 字で止める）、`mailto:` |
| `assets/icons/icon-maskable-512.png` | マスカブル用の別の絵（今のマークを中央 0.78 倍に描き直した物。角は中心から 0.25 で、安全な円 0.4 の内） |
| `tests/js/search.test.js` `netview.test.js` `install.test.js` `mail.test.js` `manifest.test.js` | 受け入れの条件の試験（35 件） |

## 2. 共有ファイル（印の区間）

step 0 の印が main に無かったので、app の区間だけをこの枝で入れた。hero の区間は入れていない（`sw.js` だけ `SHELL_HERO = []` の空の区間を置いた）。

- `js/app.js`：`// ==== app:begin ====` 〜 `// ==== app:end ====`（`async function main()` の直前・import を含む）
- `css/app.css`：末尾の `/* ==== app:begin ==== */` 〜 `/* ==== app:end ==== */`
- `index.html`：上の帯の検索ボタンの直後に `<!-- app:begin --><div id="app-slot">…<!-- app:end -->`、`#app` の末尾に `<!-- app:begin:tail -->` 〜 `<!-- app:end:tail -->`（つながり・メールのウィンドウ・iPhone の手順・オフラインの一行）
- `js/i18n.js`：`EN` の末尾の `// app:begin` 〜 `// app:end`
- `sw.js`：`SHELL_BASE`・`// hero:begin const SHELL_HERO = []; // hero:end`・`// app:begin const SHELL_APP = [...]; // app:end`・`SHELL = [...]`。**版（v48）は上げていない**
- `manifest.webmanifest`：app だけが持つ

### 印の外の一行ずつ（`// app:hook` の印。合わせる時に J が確かめる）

区間の中の関数を呼ぶ一行だけ。どれも hero の持ち分とは重ならない行。

| 行 | 変えた事 |
|---|---|
| `matchesQ` | `e.hay` の部分一致 → `appMatch(e)`（揺れと別名） |
| `shownPriAll` の検索 | `searchOf(...)` → `appNarrow(...)`（包むだけ） |
| `qBar()` | 中身を `appQBar()` に（古い絞り込みの帯は消した） |
| `clearSearch()` | `appClearHash()` を一つ足した（解除でアドレスの `#q=` も消える） |
| `renderPri` と `newsNow` の空の行 | 「一致 0 件」→ `appEmpty()`、その下に `appArchive()`（7 日の時だけ） |
| `renderUnder` | `related(e)` → `appRelated(e) \|\| related(e)`（`relations.json` が在る時だけ置き換わる） |
| `main` の `endLoad()` の後 | `appWire();` |

`tools/overflow_check.mjs` の `PAGES` に `search`・`ties`・`mail` の三つを足した（一行）。

## 3. data 枝から読む物（無ければ出さない）

全部 `getJson` で読み、取れなければその機能を出さない（数を作らない）。

| ファイル | 使う所 | 無い時 |
|---|---|---|
| `data/aliases.json` | 検索の別名。形は `{ "groups": [["米国","アメリカ","米","US"], …] }`（`[[…]]` と `{ "語": […] }` も読む） | 地名（`js/places.js`）と表記の揺れだけで広げる |
| `data/relations.json` | つながりの図・出来事の「関連」の行（理由の語を添える） | 頁が今ある `related()`（共通の語 2 つか同じ場所）で同じ形を作る。図の下に「計り方：この頁が集めた見出しの共通の語と場所・AI なし」 |
| `data/reaction.json` | 並べ替えの「反応が多い順」（はてなの和 → 動画の視聴回数） | その並べ替えを出さない |
| `data/impact.json` | 絞り込みの「暮らし」・メールの本文の暮らしの行 | その絞り込みを出さない |
| `data/hero.json` | メールの本文の 1 件目（`picks[0]`） | `board.priority` の順のまま |
| `data/archive/index.json` と日のファイル | 期間「7 日」を選んだ時だけ読む | 「7 日分を読めませんでした」 |

`tools/assemble_site.py` の `DATA_FILES` にこれらを足すのは data 枝（設計 §2.1）。

## 4. 画面

- 検索の帯：言い換え（押すと外す・もう一度で戻す）・側・期間（6 時間・24 時間・構築の窓の時間・7 日）・絞る（片側だけ・暮らし）・分野・メディア・並べ替え・共有。電話（760px 以下）は「言い換え」と「側」を出し、残りを「絞り込み」の一行に畳む（選んでいる数を出す）。
- 検索のアドレス：`#q=…&side=…&span=…&field=…&outlet=…&only=1&life=1&sort=…&x=…`。語と選んだ物だけで、個人の情報は入らない。読む時は決まった値以外を捨てる。
- 何も無い時：「「〔語〕」は見つかりません。」と「期間を 7 日にする」。
- つながり：上の帯のボタン（1400px 以上）・出来事の「関連」の見出しの横の「つながり」・アドレス `#net`。電話は一覧が既定、PC と iPad は図が既定。一本でも結ばれた出来事だけを描く。一つ押すと結ばれた物だけが残り、番号が一覧の行と対応する（理由の語は一覧に出す。図の上で文字を重ねない）。
- メール：上の帯のボタン（1400px 以上）・下の帯の「メールで送る」・アドレス `#mail`。宛先は入れなくても使える。「保存」で `parallax.mail.v1` に、「消す」で消える。
- ホーム画面に追加：Chrome などは `beforeinstallprompt` が来た時だけ下の帯に「ホーム画面に追加」。iPhone と iPad の Safari は、ホーム画面から開いていない時に 15 秒後に一度だけ二つの手順（他のウィンドウが開いている時は出さない）。閉じたら `parallax.install.v1` に印。
- オフライン：`offline` で上に赤い一行「オフライン　〔時刻〕 のデータ（〔n〕 時間前）」、更新の印を赤に。
- 上の帯：761〜1399px は場所が無いので二つのボタンを隠し、下の帯と関連の行から開く。

## 5. できない事・確かめていない事

- 決まった時刻のメール配信とプッシュの通知：サーバーが無いので作れない。代わりは端末の下書きと RSS（メールのウィンドウに一行）。
- オフラインで開けるのは、Service Worker が頁を受け持ってから一度開いた後（最初の訪問のデータは Service Worker の登録より先に読むので控えに入らない）。iPhone でホーム画面に追加して開いた二回目からは控えがある。
- iPhone の実機でホーム画面に追加して全画面で開く事・機内モードは、実機で確かめていない（Chrome の端末の真似と、Service Worker を試験の中で動かした結果だけ）。
- manifest の `screenshots` は入れていない（hero の §5.7 の撮影を使う。来場者の写真や他社の写真を含めないこと）。shortcuts は「検索」「つながり」「メール」。hero の「流す」「並び順」は hero のアドレスが決まってから J が足す（`tests/js/manifest.test.js` はショートカットの先を app.js が扱っているかを見るので、足す時は hero のアドレスの扱いと一緒に）。
