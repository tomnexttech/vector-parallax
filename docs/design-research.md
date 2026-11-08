# PARALLAX デザインの手本（2026-11-08）

PARALLAX は「同じニュースを、国内と海外のメディア、官公庁がどう伝えたか並べて比べる」サイトです。読む人は一般の人で、目的は「一件のニュースの伝わり方の差を、数秒でつかむ」こと。手本はその目的に近い製品から取りました。

出典の確かさを三段で示します。
- **確認**：この調査で一次の文書を読んだ。
- **検索**：検索の要約で拾った（一次の文書は読めていない）。
- **観察**：製品そのものを見た時の作法。文書の出典は無い。数値は書かない。

## 1. 製品ごとに参考にする点

### Apple — HIG Materials と Liquid Glass（確認）
https://developer.apple.com/design/human-interface-guidelines/materials
- ガラスは「操作と移動の層」（タブの列・サイドバー・ポップオーバー）だけに使い、内容の層には使わない。「Don't use Liquid Glass in the content layer.」
- 使うのは要所だけ。多くの自作の部品に使うと内容から気が散る。
- 文字が多い部品（アラート・サイドバー・ポップオーバー）は、背景をぼかして明るさを整える regular の方。写真や映像の上だけ clear。明るい写真の上の clear には 35% の暗い層を足す。
- 内容の層の区別は、ぼかしの強さの違う標準の素材（ultra-thin・thin・regular・thick）で付ける。厚い素材ほど細い字の読みやすさが上がる。
- 「透明度を下げる」「コントラストを上げる」の設定で見た目が変わる前提で作る。

### Apple News（観察）
https://www.apple.com/apple-news/
- 一番上に大きな題（「Today」と日付）。区画の名がそのまま頁の題になる。
- 先頭の一件だけ写真が大きく、次の数件は写真付きの二列、その下は小さな写真の一覧。大きさの差で順位を伝え、枠や線で区切らない。
- 写真の角は丸いが、文字の段には枠が無い。媒体名は見出しの上に小さく。

### The New York Times（検索）
https://www.nytimes.com ・ 書体の経緯：https://rogerblack.com/blog/post/type_for_the_times
- 見出しは Cheltenham、ラベルや区画名は Franklin Gothic、本文は Imperial。役割ごとに書体を分け、ラベルの書体は見出しと混ぜない。
- 取り入れる点：書体の役割を三つ（見出し・本文・数字）に決めて、混ぜない。

### The Guardian — Source（確認）
https://guardian.github.io/theguardian.design ・ https://www.npmjs.com/package/@guardian/source-foundations
- 書体は三つ：題字・見出し（Guardian Headline）・本文（Text Egyptian）。
- 色は「柱」（ニュース・意見・スポーツ・文化・暮らし）ごとに一つ。色は飾りでなく、記事の種類を表す。
- 取り入れる点：PARALLAX の三つの側（国内・海外・官公庁）に色を一つずつ持たせ、その色はデータの印（棒・点）にだけ使う。

### Financial Times（検索）
https://github.com/Financial-Times/chart-doctor/blob/main/visual-vocabulary/README.md ・ https://www.npmjs.com/package/@financial-times/o-colors
- 背景の「paper」#FFF1E5 が一目で FT と分かる。地の色そのものが識別になる。
- Visual Vocabulary：伝えたい関係（偏り・比較・順位・分布・時系列・部分と全体）から図の形を選ぶ。
- 取り入れる点：図は「何の関係を見せるか」から選ぶ。件数の比＝一本の積み上げの棒、時刻＝時間の軸、言葉＝重なり。

### Bloomberg（検索）
https://www.bloombergmedia.com/press/bloomberg-relaunches-japanese-language-website-featuring-unified-global-functionality-and-tailored-local-experience/
- 2025 年 12 月に日本語のサイトを世界版と同じ作りに。字の読みやすさと移動の作りを日本語向けに整えた。
- 取り入れる点：日本語の頁でも英語版と同じ骨組みを使い、字の大きさと行間だけを日本語に合わせる。

### Reuters・日経電子版・NHK ニュース（観察）
https://www.reuters.com ・ https://www.nikkei.com ・ https://news.web.nhk/
- 速報や災害は赤一色の帯で、普段の頁に赤は少ない。赤が出たら「何か起きた」と分かる。
- 図は一色か二色。目盛と注記を図の中に置き、凡例を外に離さない。
- 取り入れる点：赤は速報・災害・読めなかった時だけ。

### Ground News（確認）
https://ground.news/about
- 同じ出来事の記事を一つにまとめ、偏り・事実性・所有者を「simple bar」で見せる。
- 取り入れる点：比べる数は一本の棒で。PARALLAX は左右でなく三つの側の件数で、評価は貼らない（中立の床）。

### Particle・Kagi News・Artifact（検索）
https://www.producthunt.com/p/particle-5/particle-5 ・ https://alternativeto.net/software/kagi-news/about ・ https://uxdesign.cc/the-ux-of-artifact-c15726cb58b8
- Kagi News は「一日一回・数が限られて読み終えられる」点が評価される。広告が無く、静か。
- Artifact は操作を求める時に「何が得られるか」が明確、と評価される。
- 取り入れる点：かんたん表示は「今日の 6 件」で終わる。押す前に、押すと何が出るかを一行で言う。

### SmartNews・Google ニュース（観察）
https://www.smartnews.com ・ https://news.google.com
- 上の区画のタブを指で横に送る。スマホでは下の列に主な区画を 4〜5 個。
- Google ニュースは一件の出来事に複数の媒体の見出しを縦に並べる「全体を見る」。
- 取り入れる点：スマホは下の列 5 つ（今のまま）、親指で横に送るカードの帯（今のまま）。

### The Pudding・NYT の Upshot（検索）
https://www.storybench.org/?p=8613 ・ https://www.nytimes.com/section/upshot
- 図は文章の流れの中に置き、図の中に一文の注記を書く。題が結論を言う。
- 取り入れる点：図の題は「件数の比」でなく、読んで分かる一言（今の文言のまま、題の下に数を大きく一つ）。

## 2. 拾った作法の比べ

| 項目 | 手本の作法 | PARALLAX の今 |
|---|---|---|
| 書体の階層 | 見出し・本文・ラベルで書体と太さを分ける（NYT・Guardian） | 全部 IBM Plex Sans JP。見出しも本文も同じ顔 |
| 写真 | 先頭だけ大きく、順位を大きさで（Apple News） | 同じ大きさのカードが並ぶ |
| 見出し | 大きな題 1 つ、行間は広め | 小さな見出しが多数、行間は詰め |
| 図 | 一色か二色、関係から形を選ぶ（FT） | 図ごとに違う色が混じる |
| 余白 | 段の間を広く、枠で区切らない | 1px の線で全部を区切る |
| 色の数 | 地・字・差し色一つ・意味の色だけ | 灰と水色に、分野の色・側の色が重なる |
| 暗い時と明るい時 | 同じ骨組みで地と字だけ替える | ダークは線、ライトは影で、作りが違う |
| スマホ | 下の列・親指で横送り・大きな題 | 下の列あり。字は小さめ |

## 3. PARALLAX に取り入れる 8 点

1. **書体を三役に分ける**（NYT・Guardian）：見出し＝Zen Kaku Gothic New（太字）、本文と UI＝IBM Plex Sans JP、数字＝Barlow Semi Condensed（DIN に近い計器の数字）。
2. **大きな題を一つ**（Apple News）：区画とかんたん表示の頭に大きな題。その下の段は小さく。
3. **大きな数は一つだけ**（作り手の好み：一つの数だけを大きく）：一件のニュースで大きく出すのは「媒体の数」だけ。他の数は本文の大きさ。
4. **ガラスは移動の層だけ**（HIG）：上の帯・スマホの下の列・シート・検索の欄。内容の欄（ニュースの一覧・図）はガラスにしない。
5. **縁だけが光る**（HIG の「選んだ物に thin」）：選んだニュース・選んだ区画だけ、1px の水色の縁とごく弱い光。ライトでは縁だけ。
6. **側の色は印にだけ**（Guardian の柱）：国内・海外・官公庁の色は棒・点・小さな四角にだけ。字やボタンには使わない。
7. **赤は起きた時だけ**（Reuters・NHK）：速報・災害・読めなかった時。分野や飾りに赤を使わない。
8. **枠でなく余白で区切る**（Apple News）：欄は角の丸い面（14px）に、間は 8px。線は表の行の間だけ。

## 4. 取り入れない物と理由

- **新聞の紙面の型（明朝の大見出し・二重線・密な段組み）**：品格は出るが、ダークで弱く、数字と図が主役の PARALLAX では字の量が勝つ。見本 A で確かめた（`50_design/directions/A_*`）。
- **背景いっぱいのぼかした報道写真**：ガラスは美しく見えるが、災害や事件の写真を頁の雰囲気の色に使うことになる。写真の色で頁の印象が変わるのは中立の床に反する。見本 C で確かめた（`50_design/directions/C_*`）。
- **内容の層のガラス**：HIG が内容の層では使わないと言う。密な一覧の後ろが透けると読みにくい。
- **FT の paper のような色の付いた地**：識別にはなるが、暖色の地は報道写真の色を変えて見せる。地は無彩色のまま。
- **左右の偏りの評価・事実性の評価のラベル**（Ground News）：中立の床（真偽と左右のラベルを付けない）。
- **走査線・極小の飾りの字・FUI の飾りの数**：11/8 の裁定で除いた。
- **大文字の英字のラベル・各段の上の小さな飾りの見出し**：生成された頁によくある型。日本語のふつうの見出しにする。
