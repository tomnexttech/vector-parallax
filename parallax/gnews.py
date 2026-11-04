# -*- coding: utf-8 -*-
"""gnews — Google News の RSS を、媒体ごとの配信が無い所の補いとして読む（CONTRACT §19）。標準ライブラリだけ。

Google News の RSS は見出しの末尾に「 - 媒体名」を付け、<source> に媒体名を持つ。ここでは
  * 見出しの末尾の媒体名を落として見出しを元の形に戻し、
  * 媒体名を別名表（ALIASES）で正規名と型へ引き、
  * 表に無い媒体（地方の小さな媒体・ポータル・転載の窓口）は捨てて数える（推測で型を付けない）。
site: を付けた検索の源は媒体が決まっているので、その源の outlet・type を使う。部門（トップ・国内…）の源は
見出しごとに媒体を引き、直の RSS を読んでいる媒体（NHK・朝日など）は二重に数えないので落とす。

リンクは Google News の中継 URL（開くと元の記事へ移る）。本文は載せない。扱いの方針は README の出典の節と契約 §19。
別名表の出所は同じ作り手の以前の盤の媒体名の表で、型の語彙だけこのプロジェクトの TYPES に揃えた。
"""
import re
import time
import unicodedata
import urllib.parse

try:
    from parallax import feeds
except ImportError:                                  # parallax/ の中から直に走らせた時
    import feeds  # type: ignore

PER_SOURCE_MAX = 30                    # 一つの源から取る見出しの上限（新しい順）。件数が膨らんで data/latest.json が重くなるのを防ぐ
SKIP_TYPES = ("集約",)                 # 転載の窓口（Yahoo!ニュース等）は元の媒体が判らないので捨てる

ALIASES = {}                           # 媒体名（NFKC・大小無視）-> (正規名, 型)


def _key(s):
    return unicodedata.normalize("NFKC", s or "").strip().casefold()


def _al(canon, type_, *names):
    for n in (canon,) + names:
        ALIASES[_key(n)] = (canon, type_)


# --- 公共放送・通信社・全国紙・経済紙（同じ作り手の以前の盤の媒体名の表から。型の名はこのプロジェクトの TYPES）
_al("NHK", "公共放送", "NHKニュース", "NHK NEWS WEB", "nhk.or.jp", "news.web.nhk", "NHK WORLD-JAPAN", "NHK World")
_al("朝日新聞", "全国紙", "朝日新聞デジタル", "asahi.com", "やさしい朝日新聞", "The Asahi Shimbun")
_al("読売新聞", "全国紙", "読売新聞オンライン", "yomiuri.co.jp")
_al("The Japan News", "全国紙", "japannews.yomiuri.co.jp")
_al("毎日新聞", "全国紙", "mainichi.jp", "The Mainichi")
_al("産経新聞", "全国紙", "産経ニュース", "sankei.com")
_al("The Japan Times", "全国紙", "Japan Times", "japantimes.co.jp")
_al("日本経済新聞", "経済紙", "日本経済新聞 電子版", "日経電子版", "nikkei.com")
_al("日経ビジネス", "経済紙", "日経ビジネス電子版")
_al("東洋経済", "経済紙", "東洋経済オンライン", "四季報オンライン", "toyokeizai.net")
_al("ダイヤモンド", "経済紙", "ダイヤモンド・オンライン", "diamond.jp")
_al("週刊エコノミスト", "経済紙", "週刊エコノミスト Online")
_al("プレジデント", "経済紙", "PRESIDENT Online（プレジデントオンライン）", "PRESIDENT Online")
_al("Forbes JAPAN", "経済紙")
_al("JBpress", "経済紙")
_al("WSJ", "経済紙", "The Wall Street Journal", "ウォール・ストリート・ジャーナル", "jp.wsj.com")
_al("Financial Times", "経済紙", "FT", "ft.com")
_al("The Economist", "経済紙", "Economist")
_al("Nikkei Asia", "経済紙", "asia.nikkei.com")
_al("MarketWatch", "経済紙")
_al("共同通信", "通信社", "47NEWS", "共同通信社", "Japan Wire by Kyodo News", "Kyodo News", "english.kyodonews.net")
_al("時事通信", "通信社", "時事ドットコム", "時事通信社", "sp.m.jiji.com", "jiji.com")
_al("Reuters", "通信社", "ロイター", "reuters.com", "jp.reuters.com")
_al("Bloomberg", "通信社", "Bloomberg.com", "ブルームバーグ", "bloomberg.co.jp")
_al("AFP", "通信社", "AFPBB News", "AFP通信")
_al("AP", "通信社", "AP News", "Associated Press", "apnews.com")
_al("聯合ニュース", "通信社", "Yonhap News Agency")
_al("フォーカス台湾", "通信社", "Focus Taiwan")
# --- 民放
_al("TBS", "民放", "TBS NEWS DIG", "TBSテレビ", "TBS NEWS")
_al("テレビ朝日", "民放", "テレ朝NEWS", "テレ朝news")
_al("フジテレビ", "民放", "FNNプライムオンライン", "FNN")
_al("日本テレビ", "民放", "日テレNEWS NNN", "日テレNEWS", "news.ntv.co.jp", "nnn.co.jp")
_al("テレビ東京", "民放", "テレ東BIZ", "tv-tokyo.co.jp")
_al("ABEMA", "民放", "ABEMA TIMES")
_al("朝日放送", "民放", "ABCニュース")
# --- 地方紙（ブロック紙を含む）
for _canon, *_names in [
    ("東京新聞", "東京新聞 TOKYO Web", "東京新聞デジタル", "tokyo-np.co.jp"),
    ("中日新聞", "中日新聞Web", "中日BIZナビ"),
    ("北海道新聞", "北海道新聞デジタル", "hokkaido-np.co.jp"),
    ("西日本新聞", "西日本新聞me"),
    ("中国新聞", "中国新聞デジタル", "中国新聞ヒロシマ平和メディアセンター"),
    ("河北新報", "河北新報オンライン"),
    ("沖縄タイムス", "沖縄タイムス社", "沖縄タイムス＋プラス"),
    ("琉球新報", "琉球新報デジタル"),
    ("京都新聞", "京都新聞デジタル"),
    ("神戸新聞", "神戸新聞NEXT"),
    ("静岡新聞", "静岡新聞DIGITAL"),
    ("信濃毎日新聞", "信濃毎日新聞デジタル"),
    ("新潟日報",), ("徳島新聞", "徳島新聞デジタル"), ("山陽新聞",), ("四国新聞",), ("福井新聞", "福井新聞社"),
    ("佐賀新聞",), ("下野新聞", "下野新聞社", "shimotsuke.co.jp"), ("山陰中央新報", "山陰中央新報デジタル"),
    ("千葉日報", "千葉日報オンライン"), ("南日本新聞",), ("秋田魁新報", "秋田魁新報電子版"), ("神奈川新聞", "カナロコ"),
    ("東奥日報", "東奥日報社"), ("埼玉新聞",), ("福島民報", "福島民報デジタル"), ("福島民友", "福島民友新聞社"),
    ("北國新聞", "hokkoku.co.jp"), ("山形新聞",), ("熊本日日新聞", "熊本日日新聞社"), ("デーリー東北",),
    ("上毛新聞", "上毛新聞電子版"), ("岐阜新聞", "岐阜新聞デジタル"), ("愛媛新聞",), ("岩手日報",), ("大分合同新聞",),
    ("山梨日日新聞",), ("高知新聞",),
]:
    _al(_canon, "地方紙", *_names)
# --- 政党機関紙・政党の発信
_al("しんぶん赤旗", "政党機関紙", "赤旗", "jcp.or.jp")
_al("公明新聞", "政党機関紙", "公明党", "公明新聞電子版プラス")
_al("自由民主党", "政党機関紙", "jimin.jp", "自民党")
_al("立憲民主党", "政党機関紙", "cdp-japan.jp")
_al("国民民主党", "政党機関紙", "新・国民民主党", "new-kokumin.jp")
# --- 週刊誌・タブロイド・スポーツ紙
_al("文藝春秋", "週刊誌・タブロイド", "文春オンライン", "週刊文春", "週刊文春電子版")
_al("講談社", "週刊誌・タブロイド", "現代ビジネス", "FRIDAYデジタル")
_al("新潮社", "週刊誌・タブロイド", "デイリー新潮", "新潮QUE")
_al("小学館", "週刊誌・タブロイド", "NEWSポストセブン")
_al("日刊ゲンダイ", "週刊誌・タブロイド", "日刊ゲンダイDIGITAL", "日刊ゲンダイ競馬")
_al("zakzak", "週刊誌・タブロイド", "zakⅡ", "夕刊フジ")
_al("AERA", "週刊誌・タブロイド", "AERA DIGITAL", "AERA dot.", "AERA DIGITAL（アエラデジタル）")
_al("集英社", "週刊誌・タブロイド", "集英社オンライン")
_al("J-CAST ニュース", "週刊誌・タブロイド")
# --- 専門
for _canon, *_names in [
    ("ITmedia", "ITmedia NEWS", "ねとらぼ", "EE Times Japan", "MONOist"),
    ("日経クロステック",), ("Impress Watch", "PC Watch", "ケータイ Watch"), ("GIGAZINE",), ("ASCII.jp",),
    ("ZDNET Japan",), ("ギズモード",), ("Publickey",), ("日刊工業新聞", "ニュースイッチ by 日刊工業新聞社"),
    ("日本農業新聞",), ("選挙ドットコム",), ("Wedge", "Wedge ONLINE"), ("Tansa",),
    ("弁護士ドットコム", "bengo4.com", "bbs.bengo4.com", "article-archives.bengo4.com"),
    ("Slow News", "SlowNews／スローニュース", "SlowNews", "スローニュース"),
    ("38 North",), ("Lawfare", "lawfaremedia.org"), ("East Asia Forum",), ("Foreign Policy",), ("Foreign Affairs",),
    ("The Diplomat",), ("TechCrunch",), ("Ars Technica",), ("The Register",), ("Nature",), ("Phys.org",),
]:
    _al(_canon, "専門", *_names)
# --- 政府一次
for _canon, *_names in [
    ("首相官邸", "kantei.go.jp"), ("外務省", "mofa.go.jp"), ("防衛省", "mod.go.jp"), ("財務省", "mof.go.jp"),
    ("総務省", "soumu.go.jp"), ("日本銀行", "boj.or.jp"), ("政府広報オンライン", "gov-online.go.jp"),
    ("会計検査院", "jbaudit.go.jp"), ("官報", "kanpo.go.jp", "インターネット版官報"),
    ("衆議院", "shugiin.go.jp"), ("参議院", "sangiin.go.jp"), ("警察庁", "npa.go.jp"), ("農林水産省", "maff.go.jp"),
    ("消費者庁", "caa.go.jp"), ("国土交通省", "mlit.go.jp"), ("文部科学省", "mext.go.jp"),
    ("IMF", "International Monetary Fund | IMF", "imf.org"), ("UN News", "news.un.org"),
    ("Federal Reserve", "federalreserve.gov"),
]:
    _al(_canon, "政府一次", *_names)
# --- 海外公共・海外主流・国家メディア
_al("BBC", "海外公共", "BBC News", "BBCニュース", "BBCニュース日本語", "bbc.com")
_al("NPR", "海外公共")
_al("DW", "海外公共", "DW.com", "Deutsche Welle")
_al("France 24", "海外公共", "FRANCE 24")
_al("SWI swissinfo.ch", "海外公共")
for _canon, *_names in [
    ("CNN", "CNN.co.jp", "cnn.co.jp"), ("The New York Times", "New York Times", "nytimes.com"),
    ("The Washington Post", "Washington Post"), ("The Guardian", "the Guardian"), ("CBS News",), ("NBC News",),
    ("Fox News", "foxnews.com"), ("Los Angeles Times",), ("Politico", "POLITICO", "Politico Europe", "POLITICO Europe"),
    ("Axios",), ("Semafor",), ("CNBC",), ("Fortune",), ("Forbes",), ("Business Insider", "Business Insider Japan"),
    ("ニューズウィーク日本版", "Newsweek"), ("ハフポスト", "ハフポスト日本版", "HuffPost"),
    ("SCMP", "South China Morning Post"), ("Asia Times",), ("The Times of India",),
    ("朝鮮日報", "Chosunbiz", "조선일보"), ("中央日報", "中央日報日本語版"),
]:
    _al(_canon, "海外主流", *_names)
_al("CRI/CGTN", "国家メディア", "CGTN Japanese", "CRI", "中国国際放送局", "japanese.cri.cn")
_al("人民網", "国家メディア", "人民網日本語版", "j.people.com.cn")
_al("新華社", "国家メディア", "新華網", "Xinhua")
_al("中国網", "国家メディア", "中国網日本語版")
_al("Global Times", "国家メディア")
_al("Al Jazeera", "国家メディア", "Al Jazeera English")
# --- シンクタンク
for _canon, *_names in [
    ("CSIS", "CSIS | Center for Strategic and International Studies", "csis.org"),
    ("CFR", "Council on Foreign Relations", "cfr.org", "assets.cfr.org"),
    ("Carnegie", "Carnegie Endowment for International Peace"), ("Chatham House",),
    ("ISW", "Institute for the Study of War", "understandingwar.org"), ("Brookings", "Brookings Institution"),
    ("RAND", "RAND Corporation"), ("Stimson", "Stimson Center"), ("笹川平和財団",),
]:
    _al(_canon, "シンクタンク", *_names)
# --- 捨てる窓口（他社記事の再配信・Google News 自身）。元の媒体が判らないので捨てる
_al("転載", "集約",
    "Yahoo!ニュース", "news.yahoo.co.jp", "Yahoo!ファイナンス", "finance.yahoo.co.jp", "topics.smt.docomo.ne.jp",
    "ｄメニューニュース", "dメニューニュース", "au Webポータル", "UQライフ", "Infoseek", "楽天Infoseek",
    "news.livedoor.com", "ライブドアニュース", "excite.co.jp", "ニコニコニュース", "SmartNews", "NEWSjp", "MEDIAMIXI",
    "goo ニュース", "gooニュース", "BIGLOBEニュース", "trilltrill.jp", "newspicks.com", "NewsPicks")
_al("Google News", "集約", "Google ニュース")


# 編集の拠点が海外の媒体（部門の RSS で見出しごとに媒体を引いた時の home。ここに無い媒体は型で決める）
INTL_OUTLETS = {"Reuters", "Bloomberg", "AFP", "AP", "聯合ニュース", "フォーカス台湾", "WSJ", "Financial Times", "The Economist",
                "MarketWatch", "38 North", "Lawfare", "East Asia Forum", "Foreign Policy", "Foreign Affairs", "The Diplomat",
                "TechCrunch", "Ars Technica", "The Register", "Nature", "Phys.org", "Forbes", "Fortune", "Business Insider"}
INTL_TYPES = {"海外公共", "海外主流", "国家メディア", "シンクタンク"}


def home_of(outlet, type_, known_homes=None):
    """部門の RSS の見出しの編集の拠点。既に源の表にある媒体はその home、無ければ海外の型・表、残りは日本。"""
    if known_homes and outlet in known_homes:
        return known_homes[outlet]
    if type_ in INTL_TYPES or outlet in INTL_OUTLETS:
        return "intl"
    if type_ == "政府一次" and outlet in ("IMF", "UN News", "Federal Reserve"):
        return "intl"
    return "jp"


def resolve(name):
    """媒体名 -> (正規名, 型) か None。完全な別名（NFKC・大小無視）だけ。部分一致で当てない。"""
    return ALIASES.get(_key(name))


def search_url(q, ja=True):
    return ("https://news.google.com/rss/search?q=" + urllib.parse.quote(q) +
            ("&hl=ja&gl=JP&ceid=JP:ja" if ja else "&hl=en-US&gl=US&ceid=US:en"))


def section_url(topic, ja=True):
    if not topic:                                    # 日本語・英語のトップ
        return "https://news.google.com/rss" + ("?hl=ja&gl=JP&ceid=JP:ja" if ja else "?hl=en-US&gl=US&ceid=US:en")
    return ("https://news.google.com/rss/headlines/section/topic/" + topic +
            ("?hl=ja&gl=JP&ceid=JP:ja" if ja else "?hl=en-US&gl=US&ceid=US:en"))


def strip_tail(title, media):
    """「見出し - 媒体名」の媒体名を落とす。<source> と同じ名の時だけ。"""
    t = (title or "").strip()
    if media:
        for sep in (" - ", " – ", " — "):
            suf = sep + media
            if t.endswith(suf) and len(t) > len(suf):
                return t[: -len(suf)].rstrip()
    return t


def convert(raw_items, src, direct_outlets=frozenset(), cap=PER_SOURCE_MAX):
    """feeds.parse の item の並び -> ({"title","link","media","ts","image"…} の並び, 捨てた数の内訳)。
    src["fixed"] が真なら src の outlet・type を使う（site: 検索）。偽なら見出しごとに媒体を引き、
    表に無い・転載の窓口・直の RSS を読んでいる媒体は捨てる。ts の無い項目は捨てる。"""
    out, drop = [], {"unknown_outlet": 0, "portal": 0, "direct_feed": 0, "no_date": 0, "no_title": 0}
    for it in raw_items:
        media = (it.get("source") or "").strip()
        title = strip_tail(it.get("title"), media)
        if not title or not it.get("link"):
            drop["no_title"] += 1
            continue
        if not isinstance(it.get("ts"), (int, float)):
            drop["no_date"] += 1
            continue
        if src.get("fixed"):
            outlet, type_ = src["outlet"], src["type"]
        else:
            hit = resolve(media)
            if not hit:
                drop["unknown_outlet"] += 1
                continue
            outlet, type_ = hit
            if type_ in SKIP_TYPES:
                drop["portal"] += 1
                continue
            if outlet in direct_outlets:
                drop["direct_feed"] += 1
                continue
        out.append({"title": title, "link": it["link"], "outlet": outlet, "type": type_, "media": media,
                    "ts": int(it["ts"]), "image": it.get("image")})
    out.sort(key=lambda x: -x["ts"])
    return out[:cap], drop
