"""sources — VECTOR PARALLAX が読む源の表と取得（標準ライブラリだけ）。

源は媒体自身が配っている RSS / Atom と、公式の配信が無い所を補う Google News の RSS（kind gn・parallax/gnews.py・CONTRACT §19.2）。
Yahoo! ニュースなどの転載ポータルと非公式ミラーは使わない。
各源には次の欄がある:
  id       源の短い名（data/*.json と頁で使う）
  name     表示名
  outlet   媒体名（同じ媒体の複数の源は一つの outlet に寄る）
  type     媒体の型（政府一次・公共放送・通信社・全国紙・経済紙・地方紙・民放・海外公共・海外主流・国家メディア・専門）
  home     編集の拠点。"jp" か "intl"。「海外のみが報道」の札の拒否に使う（言語ではなく拠点で決める）
  lang     見出しの言語。"ja" か "en"
  cat      分野（横断・国内政治・国際・経済・社会・技術・安全保障・市場）
  url      RSS の URL
  kind     feed（媒体の RSS）・html（RSS の無い公的な頁）・gn（Google News の RSS）
  fixed    gn だけ。真なら媒体は源で決まる（site: 検索）、偽なら見出しの末尾の媒体名から引く（部門の RSS）

媒体に左右の札は付けない。型は媒体の形態であって立場ではない。
公開する data/*.json には見出し・リンク・媒体名・時刻だけを書く（本文と画像は書かない）。
"""
import concurrent.futures as cf
import gzip
import hashlib
import re
import time
import unicodedata
import urllib.parse
import urllib.request

try:
    from parallax import feeds
    from parallax import gnews
except ImportError:                                  # parallax/ の中から直に走らせた時
    import feeds  # type: ignore
    import gnews  # type: ignore

UA = feeds.UA

TYPES = ("政府一次", "公共放送", "通信社", "全国紙", "経済紙", "地方紙", "民放",
         "海外公共", "海外主流", "国家メディア", "専門",
         "政党機関紙", "週刊誌・タブロイド", "シンクタンク",
         "集約")        # types are structure, not stance. 集約 is only the type of a Google News section row (kind gn, fixed False): its items carry the type of the outlet read from the headline tail

# 「主流が未報」の札の拒否に使う、日本の主流の型
MAINSTREAM_TYPES = ("公共放送", "通信社", "全国紙", "民放")


def _S(id_, name, url, cat, lang, type_, outlet, home, kind="feed", fixed=True):
    assert type_ in TYPES, type_
    assert home in ("jp", "intl"), home
    assert lang in ("ja", "en"), lang
    assert kind in ("feed", "html", "gn"), kind
    return {"id": id_, "name": name, "url": url, "cat": cat, "lang": lang,
            "type": type_, "outlet": outlet, "home": home, "kind": kind, "fixed": fixed}


SOURCES = [
    # ---------------------------------------------------------------- 日本語・日本の媒体
    _S("nhk-main", "NHK 主要", "https://news.web.nhk/n-data/conf/na/rss/cat0.xml", "横断", "ja", "公共放送", "NHK", "jp"),
    _S("nhk-society", "NHK 社会", "https://news.web.nhk/n-data/conf/na/rss/cat1.xml", "社会", "ja", "公共放送", "NHK", "jp"),
    _S("nhk-science", "NHK 科学・医療", "https://news.web.nhk/n-data/conf/na/rss/cat3.xml", "技術", "ja", "公共放送", "NHK", "jp"),
    _S("nhk-politics", "NHK 政治", "https://news.web.nhk/n-data/conf/na/rss/cat4.xml", "国内政治", "ja", "公共放送", "NHK", "jp"),
    _S("nhk-business", "NHK 経済", "https://news.web.nhk/n-data/conf/na/rss/cat5.xml", "経済", "ja", "公共放送", "NHK", "jp"),
    _S("nhk-world", "NHK 国際", "https://news.web.nhk/n-data/conf/na/rss/cat6.xml", "国際", "ja", "公共放送", "NHK", "jp"),
    _S("asahi-top", "朝日新聞 速報", "https://www.asahi.com/rss/asahi/newsheadlines.rdf", "横断", "ja", "全国紙", "朝日新聞", "jp"),
    _S("asahi-politics", "朝日新聞 政治", "https://www.asahi.com/rss/asahi/politics.rdf", "国内政治", "ja", "全国紙", "朝日新聞", "jp"),
    _S("asahi-business", "朝日新聞 経済", "https://www.asahi.com/rss/asahi/business.rdf", "経済", "ja", "全国紙", "朝日新聞", "jp"),
    _S("asahi-world", "朝日新聞 国際", "https://www.asahi.com/rss/asahi/international.rdf", "国際", "ja", "全国紙", "朝日新聞", "jp"),
    _S("asahi-society", "朝日新聞 社会", "https://www.asahi.com/rss/asahi/national.rdf", "社会", "ja", "全国紙", "朝日新聞", "jp"),
    _S("mainichi-flash", "毎日新聞 速報", "https://mainichi.jp/rss/etc/mainichi-flash.rss", "横断", "ja", "全国紙", "毎日新聞", "jp"),
    _S("tbs", "TBS NEWS DIG", "https://newsdig.tbs.co.jp/list/feed/rss", "横断", "ja", "民放", "TBS", "jp"),
    _S("toyokeizai", "東洋経済オンライン", "https://toyokeizai.net/list/feed/rss", "経済", "ja", "経済紙", "東洋経済", "jp"),
    _S("okinawatimes", "沖縄タイムス", "https://www.okinawatimes.co.jp/list/feed/rss", "社会", "ja", "地方紙", "沖縄タイムス", "jp"),
    # ---------------------------------------------------------------- 日本語・海外の媒体の日本語版
    _S("afpbb", "AFPBB News", "http://feeds.afpbb.com/rss/afpbb/afpbbnews", "国際", "ja", "通信社", "AFP", "intl"),
    _S("bbc-ja", "BBCニュース日本語", "https://feeds.bbci.co.uk/japanese/rss.xml", "国際", "ja", "海外公共", "BBC", "intl"),
    _S("cnn-ja", "CNN.co.jp", "http://feeds.cnn.co.jp/cnn/rss", "国際", "ja", "海外主流", "CNN", "intl"),
    # ---------------------------------------------------------------- 日本語・政府一次
    _S("kantei", "首相官邸 新着", "https://www.kantei.go.jp/index-jnews.rdf", "国内政治", "ja", "政府一次", "首相官邸", "jp"),
    _S("cao", "内閣府 新着", "https://www.cao.go.jp/rss/news.rdf", "国内政治", "ja", "政府一次", "内閣府", "jp"),
    _S("mof", "財務省 新着", "https://www.mof.go.jp/news.rss", "経済", "ja", "政府一次", "財務省", "jp"),
    _S("soumu", "総務省 新着", "https://www.soumu.go.jp/news.rdf", "国内政治", "ja", "政府一次", "総務省", "jp"),
    _S("digital", "デジタル庁 新着", "https://www.digital.go.jp/rss/news.xml", "技術", "ja", "政府一次", "デジタル庁", "jp"),
    _S("mod", "防衛省 新着", "https://www.mod.go.jp/j/rss/news.xml", "安全保障", "ja", "政府一次", "防衛省", "jp"),
    _S("egov-pc", "e-Gov パブコメ 意見募集", "https://public-comment.e-gov.go.jp/rss/pcm_list.xml", "国内政治", "ja", "政府一次", "e-Gov", "jp"),
    _S("fsa", "金融庁 新着", "https://www.fsa.go.jp/fsaNewsListAll_rss2.xml", "市場", "ja", "政府一次", "金融庁", "jp"),
    _S("boj", "日本銀行 新着", "https://www.boj.or.jp/rss/whatsnew.xml", "市場", "ja", "政府一次", "日本銀行", "jp"),
    _S("mhlw", "厚生労働省 報道発表", "https://www.mhlw.go.jp/stf/news.rdf", "社会", "ja", "政府一次", "厚生労働省", "jp"),
    _S("npa", "警察庁 新着", "https://www.npa.go.jp/newlyarrived/rss20.xml", "安全保障", "ja", "政府一次", "警察庁", "jp"),
    _S("caa", "消費者庁 新着", "https://www.caa.go.jp/news.rss", "社会", "ja", "政府一次", "消費者庁", "jp"),
    _S("mlit", "国土交通省 新着", "https://www.mlit.go.jp/index.rdf", "国内政治", "ja", "政府一次", "国土交通省", "jp"),
    _S("mext", "文部科学省 新着", "https://www.mext.go.jp/b_menu/news/index.rdf", "社会", "ja", "政府一次", "文部科学省", "jp"),
    _S("maff", "農林水産省 新着", "https://www.maff.go.jp/rss.xml", "経済", "ja", "政府一次", "農林水産省", "jp"),
    # ---------------------------------------------------------------- 英語・日本の媒体
    _S("japantimes", "The Japan Times", "https://www.japantimes.co.jp/news/feed/", "国際", "en", "全国紙", "The Japan Times", "jp"),
    _S("japannews", "The Japan News", "https://japannews.yomiuri.co.jp/feed/", "国際", "en", "全国紙", "The Japan News", "jp"),
    _S("nikkei-asia", "Nikkei Asia", "https://asia.nikkei.com/rss/feed/nar", "経済", "en", "経済紙", "Nikkei Asia", "jp"),
    # ---------------------------------------------------------------- 英語・海外の媒体
    _S("bbc-world", "BBC World", "https://feeds.bbci.co.uk/news/world/rss.xml", "国際", "en", "海外公共", "BBC", "intl"),
    _S("bbc-asia", "BBC Asia", "https://feeds.bbci.co.uk/news/world/asia/rss.xml", "国際", "en", "海外公共", "BBC", "intl"),
    _S("bbc-business", "BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml", "経済", "en", "海外公共", "BBC", "intl"),
    _S("guardian-world", "Guardian World", "https://www.theguardian.com/world/rss", "国際", "en", "海外主流", "The Guardian", "intl"),
    _S("aljazeera", "Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml", "国際", "en", "国家メディア", "Al Jazeera", "intl"),
    _S("npr-world", "NPR World", "https://feeds.npr.org/1004/rss.xml", "国際", "en", "海外公共", "NPR", "intl"),
    _S("dw-world", "DW World", "https://rss.dw.com/xml/rss-en-world", "国際", "en", "海外公共", "DW", "intl"),
    _S("france24", "France 24", "https://www.france24.com/en/rss", "国際", "en", "海外公共", "France 24", "intl"),
    _S("scmp-asia", "SCMP Asia", "https://www.scmp.com/rss/2/feed", "国際", "en", "海外主流", "SCMP", "intl"),
    _S("bloomberg-politics", "Bloomberg Politics", "https://feeds.bloomberg.com/politics/news.rss", "国際", "en", "通信社", "Bloomberg", "intl"),
    _S("bloomberg-economics", "Bloomberg Economics", "https://feeds.bloomberg.com/economics/news.rss", "経済", "en", "通信社", "Bloomberg", "intl"),
    _S("cnbc-world", "CNBC World", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362", "国際", "en", "海外主流", "CNBC", "intl"),
    _S("diplomat-japan", "The Diplomat (Japan)", "https://thediplomat.com/tag/japan/feed/", "国際", "en", "専門", "The Diplomat", "intl"),
    _S("un-news", "UN News", "https://news.un.org/feed/subscribe/en/news/all/rss.xml", "国際", "en", "政府一次", "UN News", "intl"),
    _S("fed", "Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml", "経済", "en", "政府一次", "Federal Reserve", "intl"),
    _S("ecb", "ECB", "https://www.ecb.europa.eu/rss/press.html", "経済", "en", "政府一次", "ECB", "intl"),
    # ---------------------------------------------------------------- breadth added 2026-11-04 night (CONTRACT 19)
    _S("party-ldp", "自由民主党 ニュース", "http://rss.jimin.jp/f1887/index.rdf", "国内政治", "ja", "政党機関紙", "自由民主党", "jp"),
    _S("party-cdp", "立憲民主党 ニュース", "https://cdp-japan.jp/news/feed", "国内政治", "ja", "政党機関紙", "立憲民主党", "jp"),
    _S("party-ishin", "日本維新の会 ニュース", "https://o-ishin.jp/news/atom.xml", "国内政治", "ja", "政党機関紙", "日本維新の会", "jp"),
    _S("party-komei", "公明党 ニュース", "https://www.komei.or.jp/komeinews/feed/", "国内政治", "ja", "政党機関紙", "公明新聞", "jp"),
    _S("party-dpp", "国民民主党 ニュース", "https://new-kokumin.jp/feed", "国内政治", "ja", "政党機関紙", "国民民主党", "jp"),
    _S("party-sanseito", "参政党 ニュース", "https://sanseito.jp/feed/", "国内政治", "ja", "政党機関紙", "参政党", "jp"),
    _S("party-mirai", "チームみらい（note）", "https://note.com/team_mirai_jp/rss", "国内政治", "ja", "政党機関紙", "チームみらい", "jp"),
    _S("party-inochi", "いのちの党 ニュース", "https://inochinoto.jp/feed/", "国内政治", "ja", "政党機関紙", "いのちの党", "jp"),
    _S("party-sdp", "社会民主党 ニュース", "https://sdp.or.jp/feed/", "国内政治", "ja", "政党機関紙", "社会民主党", "jp"),
    _S("party-hoshu", "日本保守党 ニュース", "https://hoshuto.jp/feed/", "国内政治", "ja", "政党機関紙", "日本保守党", "jp"),
    _S("dailyshincho", "デイリー新潮", "https://www.dailyshincho.jp/feed/", "社会", "ja", "週刊誌・タブロイド", "新潮社", "jp"),
    _S("aera-dot", "AERA DIGITAL", "https://dot.asahi.com/list/feed/rss", "社会", "ja", "週刊誌・タブロイド", "AERA", "jp"),
    _S("bunshun", "文春オンライン", "https://bunshun.jp/list/feed/rss", "社会", "ja", "週刊誌・タブロイド", "文藝春秋", "jp"),
    _S("gendai", "現代ビジネス", "https://gendai.media/list/feed/rss", "社会", "ja", "週刊誌・タブロイド", "講談社", "jp"),
    _S("president", "プレジデントオンライン", "https://president.jp/list/rss", "経済", "ja", "経済紙", "プレジデント", "jp"),
    _S("itmedia-ai", "ITmedia AI+", "https://rss.itmedia.co.jp/rss/2.0/aiplus.xml", "技術", "ja", "専門", "ITmedia", "jp"),
    _S("wedge", "Wedge ONLINE", "https://wedge.ismedia.jp/list/feed/rss", "安全保障", "ja", "専門", "Wedge", "jp"),
    _S("jpx", "日本取引所グループ 新着", "https://www.jpx.co.jp/rss/jpx-news.xml", "市場", "ja", "政府一次", "日本取引所グループ", "jp"),
    _S("brookings", "Brookings", "https://www.brookings.edu/feed/?post_type=article", "国際", "en", "シンクタンク", "Brookings", "intl"),
    _S("rand", "RAND Blog", "https://www.rand.org/blog.xml", "安全保障", "en", "シンクタンク", "RAND", "intl"),
    _S("stimson", "Stimson Center", "https://www.stimson.org/feed/", "安全保障", "en", "シンクタンク", "Stimson", "intl"),
    _S("warontherocks", "War on the Rocks", "https://warontherocks.com/feed/", "安全保障", "en", "専門", "War on the Rocks", "intl"),
    _S("defenseone", "Defense One", "https://www.defenseone.com/rss/all/", "安全保障", "en", "専門", "Defense One", "intl"),
    _S("breakingdefense", "Breaking Defense", "https://breakingdefense.com/feed/", "安全保障", "en", "専門", "Breaking Defense", "intl"),
    _S("bellingcat", "Bellingcat", "https://www.bellingcat.com/feed/", "安全保障", "en", "専門", "Bellingcat", "intl"),
    _S("foreignaffairs", "Foreign Affairs", "https://www.foreignaffairs.com/rss.xml", "国際", "en", "専門", "Foreign Affairs", "intl"),
    _S("projectsyndicate", "Project Syndicate", "https://www.project-syndicate.org/rss", "経済", "en", "専門", "Project Syndicate", "intl"),
    _S("mit-tr", "MIT Technology Review", "https://www.technologyreview.com/feed/", "技術", "en", "専門", "MIT Technology Review", "intl"),
    _S("arstechnica", "Ars Technica", "https://feeds.arstechnica.com/arstechnica/index", "技術", "en", "専門", "Ars Technica", "intl"),
    _S("primary-jbaudit", "会計検査院 新着", "https://www.jbaudit.go.jp/", "国内政治", "ja", "政府一次", "会計検査院", "jp", kind="html"),
    _S("primary-kanpo", "官報 目次", "https://www.kanpo.go.jp/", "国内政治", "ja", "政府一次", "官報", "jp", kind="html"),
    _S("primary-shugiin", "衆議院 議案", "https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/menu.htm", "国内政治", "ja", "政府一次", "衆議院", "jp", kind="html"),
    _S("primary-sangiin", "参議院 議案", "https://www.sangiin.go.jp/japanese/joho1/kousei/gian/current/gian.htm", "国内政治", "ja", "政府一次", "参議院", "jp", kind="html"),
]


# ---------------------------------------------------------------- Google News 経由（CONTRACT §19.2・2026-11-04 夜）
# 媒体自身の RSS が無い全国紙・通信社・地方紙などを、Google News の site: 検索 RSS で補う（kind gn）。
# fixed 真: 媒体は源で決まる。fixed 偽: 部門の RSS で、見出しの末尾の媒体名を parallax/gnews.py の別名表で引く
# （表に無い媒体・転載の窓口・直の RSS を読んでいる媒体は捨てて数える）。見出しは末尾の媒体名を落とした元の形、
# リンクは Google News の中継 URL（開くと元の記事へ移る）。扱いの方針は README の出典の節。
def _G(id_, name, q, cat, lang, type_, outlet, home):
    return _S(id_, name, gnews.search_url(q, lang == "ja"), cat, lang, type_, outlet, home, kind="gn", fixed=True)


def _GS(id_, name, topic, cat):
    return _S(id_, name, gnews.section_url(topic, True), cat, "ja", "集約", "Google News", "jp", kind="gn", fixed=False)


SOURCES += [
    _G("gn-yomiuri", "読売新聞（Google News）", "site:yomiuri.co.jp when:2d", "横断", "ja", "全国紙", "読売新聞", "jp"),
    _G("gn-sankei", "産経新聞（Google News）", "site:sankei.com when:2d", "横断", "ja", "全国紙", "産経新聞", "jp"),
    _G("gn-nikkei", "日本経済新聞（Google News）", "site:nikkei.com when:2d", "経済", "ja", "経済紙", "日本経済新聞", "jp"),
    _G("gn-47news", "共同通信 47NEWS（Google News）", "site:47news.jp when:2d", "横断", "ja", "通信社", "共同通信", "jp"),
    _G("gn-jiji", "時事通信（Google News）", "site:jiji.com when:2d", "横断", "ja", "通信社", "時事通信", "jp"),
    _G("gn-tokyo-np", "東京新聞（Google News）", "site:tokyo-np.co.jp when:2d", "横断", "ja", "地方紙", "東京新聞", "jp"),
    _G("gn-chunichi", "中日新聞（Google News）", "site:chunichi.co.jp when:2d", "横断", "ja", "地方紙", "中日新聞", "jp"),
    _G("gn-ryukyu", "琉球新報（Google News）", "site:ryukyushimpo.jp when:2d", "社会", "ja", "地方紙", "琉球新報", "jp"),
    _G("gn-hokkaido", "北海道新聞（Google News）", "site:hokkaido-np.co.jp when:2d", "横断", "ja", "地方紙", "北海道新聞", "jp"),
    _G("gn-nishinippon", "西日本新聞（Google News）", "site:nishinippon.co.jp when:2d", "横断", "ja", "地方紙", "西日本新聞", "jp"),
    _G("gn-kanaloco", "神奈川新聞（Google News）", "site:kanaloco.jp when:2d", "横断", "ja", "地方紙", "神奈川新聞", "jp"),
    _G("gn-zakzak", "zakzak（Google News）", "site:zakzak.co.jp when:2d", "横断", "ja", "週刊誌・タブロイド", "zakzak", "jp"),
    _G("gn-gendai", "日刊ゲンダイ（Google News）", "site:nikkan-gendai.com when:2d", "横断", "ja", "週刊誌・タブロイド", "日刊ゲンダイ", "jp"),
    _G("gn-tansa", "Tansa（Google News）", "site:tansajp.org", "社会", "ja", "専門", "Tansa", "jp"),
    _G("gn-bengo4", "弁護士ドットコム（Google News）", "site:bengo4.com when:7d", "社会", "ja", "専門", "弁護士ドットコム", "jp"),
    _G("gn-cri", "CRI・人民網 日本語（Google News）", "site:japanese.cri.cn OR site:j.people.com.cn", "国際", "ja", "国家メディア", "CRI/人民網", "intl"),
    _G("gn-focustaiwan", "フォーカス台湾（Google News）", "site:japan.focustaiwan.tw", "国際", "ja", "通信社", "フォーカス台湾", "intl"),
    _G("gn-kyodo-en", "Kyodo News English（Google News）", "site:english.kyodonews.net when:2d", "国際", "en", "通信社", "共同通信", "jp"),
    _G("gn-reuters", "Reuters（Google News）", "site:reuters.com when:1d", "国際", "en", "通信社", "Reuters", "intl"),
    _G("gn-ap", "AP（Google News）", "site:apnews.com when:1d", "国際", "en", "通信社", "AP", "intl"),
    _G("gn-ft", "Financial Times（Google News）", "site:ft.com when:1d", "経済", "en", "経済紙", "Financial Times", "intl"),
    _G("gn-wsj", "WSJ（Google News）", "site:wsj.com when:1d", "経済", "en", "経済紙", "WSJ", "intl"),
    _G("gn-economist", "The Economist（Google News）", "site:economist.com when:2d", "国際", "en", "経済紙", "The Economist", "intl"),
    _G("gn-csis", "CSIS（Google News）", "site:csis.org when:7d", "安全保障", "en", "シンクタンク", "CSIS", "intl"),
    _G("gn-cfr", "CFR（Google News）", "site:cfr.org when:7d", "国際", "en", "シンクタンク", "CFR", "intl"),
    _G("gn-carnegie", "Carnegie（Google News）", "site:carnegieendowment.org when:7d", "国際", "en", "シンクタンク", "Carnegie", "intl"),
    _G("gn-chathamhouse", "Chatham House（Google News）", "site:chathamhouse.org when:7d", "国際", "en", "シンクタンク", "Chatham House", "intl"),
    _G("gn-isw", "ISW（Google News）", "site:understandingwar.org when:7d", "安全保障", "en", "シンクタンク", "ISW", "intl"),
    _G("gn-imf", "IMF（Google News）", "site:imf.org when:7d", "経済", "en", "政府一次", "IMF", "intl"),
    _G("gn-38north", "38 North（Google News）", "site:38north.org when:14d", "安全保障", "en", "専門", "38 North", "intl"),
    _G("gn-lawfare", "Lawfare（Google News）", "site:lawfaremedia.org when:7d", "安全保障", "en", "専門", "Lawfare", "intl"),
    _GS("gn-ja-top", "Google News 日本 トップ", "", "横断"),
    _GS("gn-ja-nation", "Google News 国内", "NATION", "国内政治"),
    _GS("gn-ja-world", "Google News 国際", "WORLD", "国際"),
    _GS("gn-ja-business", "Google News ビジネス", "BUSINESS", "経済"),
    _GS("gn-ja-tech", "Google News テクノロジー", "TECHNOLOGY", "技術"),
]

# ---------------------------------------------------------------- 再表示の条件（2026-11-04 に一次資料で確かめた）
# 印: ok = 見出しとリンクの再表示が条件上できると確かめた / nc = 非商用なら可 / no = 再配布を禁じる文言あり
#     unknown = 条件の頁を確かめられなかった。公開版（--public）は ok の源だけ見出しを書き出す。
# url は源が条件を述べている頁（見つからなければ ""）。推測で ok にしない。
TERMS_STATUS = ("ok", "nc", "no", "unknown")
_NHK = "https://www.nhk.or.jp/toppage/rss/index.html"
_ASAHI = "https://www.asahi.com/information/service/rss.html"
TERMS = {
    **{k: ("no", _NHK) for k in ("nhk-main", "nhk-society", "nhk-science", "nhk-politics", "nhk-business", "nhk-world")},
    **{k: ("no", _ASAHI) for k in ("asahi-top", "asahi-politics", "asahi-business", "asahi-world", "asahi-society")},
    "mainichi-flash": ("nc", "https://mainichi.jp/rss/"),
    "tbs": ("unknown", ""),
    "toyokeizai": ("unknown", "https://toyokeizai.net/sp/about-service/contents/"),
    "okinawatimes": ("unknown", "https://www.okinawatimes.co.jp/list/info/reprint"),
    "afpbb": ("no", "https://www.afpbb.com/list/info/rss/"),
    "bbc-ja": ("unknown", ""),
    "cnn-ja": ("unknown", "https://www.cnn.co.jp/info/copyright.html"),
    "kantei": ("no", "https://www.kantei.go.jp/rss.html"),
    "cao": ("no", "https://www.cao.go.jp/rss/"),
    "mof": ("ok", "https://www.mof.go.jp/about_mof/rss/index.html"),
    "soumu": ("ok", "https://www.soumu.go.jp/menu_kyotsuu/rss_information.html"),
    "digital": ("unknown", "https://services.digital.go.jp/copyright-policy/"),
    "mod": ("unknown", ""),
    "egov-pc": ("ok", "https://public-comment.e-gov.go.jp/contents/terms"),
    "fsa": ("ok", "https://www.fsa.go.jp/kouhou/rss.html"),
    "boj": ("nc", "https://www.boj.or.jp/about/copyright.htm"),
    "mhlw": ("no", "https://www.mhlw.go.jp/rss/index.html"),
    "npa": ("no", "https://www.npa.go.jp/rss/index.html"),
    "caa": ("no", "https://www.caa.go.jp/rss/"),
    "mlit": ("ok", "https://www.mlit.go.jp/page/rssinfo.html"),
    "mext": ("no", "https://www.mext.go.jp/rss.html"),
    "maff": ("unknown", "https://www.maff.go.jp/j/use/link.html"),
    "japantimes": ("unknown", "https://japantimes.co.jp/about-us/link-policy"),
    "japannews": ("unknown", ""),
    "nikkei-asia": ("no", "https://info.asia.nikkei.com/rss"),
    "bbc-world": ("unknown", ""),
    "bbc-asia": ("unknown", ""),
    "bbc-business": ("unknown", ""),
    "guardian-world": ("unknown", ""),
    "aljazeera": ("unknown", "https://www.aljazeera.com/terms-and-conditions"),
    "npr-world": ("no", "https://www.npr.org/about-npr/179881519/rights-and-permissions-information"),
    "dw-world": ("unknown", ""),
    "france24": ("unknown", "https://www.france24.com/en/rss-feeds"),
    "scmp-asia": ("unknown", "https://www.scmp.com/terms-conditions"),
    "bloomberg-politics": ("no", "https://www.bloomberg.com/notices/tos/"),
    "bloomberg-economics": ("no", "https://www.bloomberg.com/notices/tos/"),
    "cnbc-world": ("unknown", "https://www.cnbc.com/rss-feeds/"),
    "diplomat-japan": ("unknown", "https://thediplomat.com/syndication/"),
    "un-news": ("unknown", "https://www.un.org/en/about-us/copyright"),
    "fed": ("ok", "https://www.federalreserve.gov/disclaimer.htm"),
    "ecb": ("ok", "https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html"),
    # sources added 2026-11-04 night: their terms pages were not read (unknown). rights_mode quote shows the headline as a quotation with outlet, time and link.
    "party-ldp": ("unknown", ""),
    "party-cdp": ("unknown", ""),
    "party-ishin": ("unknown", ""),
    "party-komei": ("unknown", ""),
    "party-dpp": ("unknown", ""),
    "party-sanseito": ("unknown", ""),
    "party-mirai": ("unknown", ""),
    "party-inochi": ("unknown", ""),
    "party-sdp": ("unknown", ""),
    "party-hoshu": ("unknown", ""),
    "dailyshincho": ("unknown", ""),
    "aera-dot": ("unknown", ""),
    "bunshun": ("unknown", ""),
    "gendai": ("unknown", ""),
    "president": ("unknown", ""),
    "itmedia-ai": ("unknown", ""),
    "wedge": ("unknown", ""),
    "jpx": ("unknown", ""),
    "brookings": ("unknown", ""),
    "rand": ("unknown", ""),
    "stimson": ("unknown", ""),
    "warontherocks": ("unknown", ""),
    "defenseone": ("unknown", ""),
    "breakingdefense": ("unknown", ""),
    "bellingcat": ("unknown", ""),
    "foreignaffairs": ("unknown", ""),
    "projectsyndicate": ("unknown", ""),
    "mit-tr": ("unknown", ""),
    "arstechnica": ("unknown", ""),
    "primary-jbaudit": ("unknown", ""),
    "primary-kanpo": ("unknown", ""),
    "primary-shugiin": ("unknown", ""),
    "primary-sangiin": ("unknown", ""),
}
for _s0g in SOURCES:                                   # Google News 経由は全て unknown（媒体ごとの条件の頁は読んでいない）
    if _s0g["kind"] == "gn":
        TERMS[_s0g["id"]] = ("unknown", "")
for _s1 in SOURCES:
    _st, _url = TERMS[_s1["id"]]                       # 表に無い源は KeyError で落とす（印の付け忘れを通さない）
    assert _st in TERMS_STATUS, _st
    _s1["terms_status"], _s1["terms"] = _st, _url
assert set(TERMS) == {s["id"] for s in SOURCES}, "TERMS と SOURCES の id が揃っていない"

_BY_ID = {s["id"]: s for s in SOURCES}
assert len(_BY_ID) == len(SOURCES), "源の id が重複している"


def all_sources():
    """源の表の写し（呼び手が書き換えても表は壊れない）。"""
    return [dict(s) for s in SOURCES]


def by_id(sid):
    s = _BY_ID.get(sid)
    return dict(s) if s else None


def outlet_info():
    """outlet -> {"type","home","lang":[...]}。頁と AI の入力で媒体の属性を引くため。"""
    out = {}
    for s in SOURCES:
        o = out.setdefault(s["outlet"], {"type": s["type"], "home": s["home"], "langs": []})
        if s["lang"] not in o["langs"]:
            o["langs"].append(s["lang"])
    return out


def _key(s):
    return unicodedata.normalize("NFKC", s or "").strip().lower()


_OUTLET_FOLDED = {}
for _s0 in SOURCES:
    _OUTLET_FOLDED.setdefault(_key(_s0["outlet"]), (_s0["outlet"], _s0["type"]))
    _OUTLET_FOLDED.setdefault(_key(_s0["name"]), (_s0["outlet"], _s0["type"]))


def canonical(source_name):
    """媒体名 -> (正規名, 型)。源の表の outlet / name と NFKC・大小無視で一致した時だけ型を返す。
    未知は (元の名, None)。推測はしない（cluster.canon_source が自前の表で補う）。"""
    if source_name is None:
        return (None, None)
    if not isinstance(source_name, str):
        return (source_name, None)
    hit = _OUTLET_FOLDED.get(_key(source_name))
    return hit if hit else (source_name, None)


# ---------------------------------------------------------------- id
_TRACK_EXACT = {
    "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid",
    "igshid", "mc_cid", "mc_eid", "_ga", "_gl", "ref", "ref_src", "ref_url",
    "cmpid", "ncid", "ocid", "n_cid", "spm", "sr_share", "smid", "ito", "ftag",
    "cid_source", "rss_source",
}


def _is_tracking(key):
    k = key.lower()
    return k in _TRACK_EXACT or k.startswith("utm_")


_SURR = re.compile("[\ud800-\udfff]")


def _s(v):
    """None は ""、str 以外は str()、孤立サロゲートは U+FFFD。"""
    if v is None:
        return ""
    if not isinstance(v, str):
        v = str(v)
    return _SURR.sub("�", v) if _SURR.search(v) else v


def normalize_link(link):
    """追跡用の引数を除き、引数を並べ、https に揃え、末尾の / を除く。読めない物は空白除去だけで返す。"""
    s = _s(link).strip()
    if not s:
        return ""
    try:
        p = urllib.parse.urlsplit(s)
    except ValueError:
        return s
    host = (p.hostname or "").lower()
    if p.scheme.lower() not in ("http", "https") or not host:
        return s
    try:
        port = p.port
    except ValueError:
        return s
    netloc = f"[{host}]" if ":" in host else host
    if port and port not in (80, 443):
        netloc = f"{netloc}:{port}"
    try:
        qs = urllib.parse.parse_qsl(p.query, keep_blank_values=True)
    except ValueError:
        return s
    q = sorted((k, v) for k, v in qs if not _is_tracking(k))
    path = p.path or ""
    while path.endswith("/"):
        path = path[:-1]
    return urllib.parse.urlunsplit(("https", netloc, path, urllib.parse.urlencode(q), ""))


def make_id(link):
    return hashlib.sha1(normalize_link(link).encode("utf-8")).hexdigest()[:16]


def item_id(it):
    """link があれば make_id(link)。link の無い見出しは「源＋見出し」で id を作る。"""
    if it.get("id"):
        return str(it["id"])
    link = _s(it.get("link")).strip()
    if link:
        return make_id(link)
    key = "nolink:%s|%s" % (_s(it.get("source_id") or it.get("feed")), _s(it.get("title")))
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------- 取得
def _get(url, timeout=20):
    """gzip を解き、utf-8 → shift_jis → euc_jp → cp932 の順に復号する。"""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout, context=feeds._ctx) as r:
        raw = r.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    for enc in ("utf-8", "shift_jis", "euc_jp", "cp932"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


_XML_DECL = re.compile(r"^\s*<\?xml[^>]*\?>")


def parse(text):
    """feeds.parse の外側。XML 宣言が Shift_JIS 等だと ElementTree が ValueError を投げるので、
    復号済みの文字列から宣言を外して読み直す。"""
    try:
        return feeds.parse(text)
    except ValueError:
        return feeds.parse(_XML_DECL.sub("", text, count=1))


def _finish(it, src):
    """feeds の item を公開できる形へ。見出しは書き換えない。summary と image は落とす。"""
    out = {
        "title": _s(it.get("title")).strip(),
        "link": _s(it.get("link")).strip(),
        "outlet": src["outlet"],
        "source_id": src["id"],
        "type": src["type"],
        "home": src["home"],
        "lang": src["lang"],
        "ts": int(it["ts"]) if isinstance(it.get("ts"), (int, float)) else None,
    }
    out["id"] = item_id(out)
    img = _s(it.get("image")).strip()
    out["image"] = {"url": img, "from": "rss"} if img.lower().startswith(("http://", "https://")) else None
    return out


def _finish_gn(g, src, known_homes):
    """gnews.convert の項目 -> 公開できる形。fixed の源は源の home、部門の源は媒体から home を引く。"""
    home = src["home"] if src.get("fixed") else gnews.home_of(g["outlet"], g["type"], known_homes)
    out = {"title": _s(g["title"]).strip(), "link": _s(g["link"]).strip(), "outlet": g["outlet"], "source_id": src["id"],
           "type": g["type"], "home": home, "lang": src["lang"], "ts": g["ts"]}
    out["id"] = item_id(out)
    out["image"] = None
    out["via"] = "gnews"                                   # CONTRACT 20.7: read through Google News; the page never shows a news.google.com URL as a source
    out["media"] = g.get("media") or g["outlet"]
    return out


def fetch_source(src, getter=None, direct_outlets=frozenset(), known_homes=None):
    """一つの源を取る。返すのは {"items", "ok", "err", "fetched_at"}（Google News 経由の源は "dropped" も）。例外は投げない。
    getter は試験用（url -> 文字列）。"""
    now = time.time()
    try:
        text = (getter or _get)(src["url"])
        raw = parse(text)
        if src.get("kind") == "gn":
            conv, drop = gnews.convert(raw, src, direct_outlets)
            items = [_finish_gn(g, src, known_homes) for g in conv]
            n_drop = sum(drop.values())
            return {"items": items, "ok": bool(items), "fetched_at": now, "dropped": drop,
                    "err": "" if items else ("項目なし（捨てた %d）" % n_drop if n_drop else "項目なし")}
        items = [_finish(it, src) for it in raw if _s(it.get("title")).strip()]
        return {"items": items, "ok": bool(items), "err": "" if items else "項目なし",
                "fetched_at": now}
    except Exception as e:                              # 一つの源の失敗で全体を止めない
        return {"items": [], "ok": False, "err": ("%s: %s" % (type(e).__name__, e))[:160],
                "fetched_at": now}


GN_WORKERS = 2                                          # Google News へは同時に 2 本まで


def fetch_everything(sources=None, workers=12, getter=None):
    """全源を並列で取る（Google News 経由の源は別の組で同時 2 本まで）。返すのは (items, status)。
    落ちた源は status に理由付きで残る（件数を作らない）。"""
    allsrc = [x for x in (sources if sources is not None else SOURCES) if x.get("kind", "feed") in ("feed", "gn")]
    srcs = [x for x in allsrc if x.get("kind", "feed") == "feed"]
    gns = [x for x in allsrc if x.get("kind") == "gn"]
    direct = frozenset(s["outlet"] for s in SOURCES if s.get("kind", "feed") == "feed")
    known_homes = {s["outlet"]: s["home"] for s in SOURCES if s.get("kind", "feed") != "gn" or s.get("fixed")}
    items, status = [], []

    def run(pool_srcs, n_workers, kw):
        with cf.ThreadPoolExecutor(max_workers=n_workers) as ex:
            futs = {ex.submit(fetch_source, s, getter, **kw): s for s in pool_srcs}
            for fu in cf.as_completed(futs):
                s = futs[fu]
                rec = fu.result()
                items.extend(rec["items"])
                tss = [it["ts"] for it in rec["items"] if isinstance(it.get("ts"), (int, float))]
                row = {"id": s["id"], "name": s["name"], "outlet": s["outlet"], "type": s["type"],
                       "home": s["home"], "lang": s["lang"], "ok": rec["ok"], "n": len(rec["items"]),
                       "fetched_at": int(rec["fetched_at"]), "newest_ts": int(max(tss)) if tss else None,
                       "oldest_ts": int(min(tss)) if tss else None,
                       "err": rec["err"], "terms": s.get("terms", ""),
                       "terms_status": s.get("terms_status", "unknown")}
                if s.get("kind") == "gn":
                    row["via"] = "google-news"
                    row["dropped"] = rec.get("dropped", {})
                status.append(row)
    run(srcs, workers, {})
    if gns:
        run(gns, GN_WORKERS, {"direct_outlets": direct, "known_homes": known_homes})
    order = {s["id"]: i for i, s in enumerate(allsrc)}
    status.sort(key=lambda r: order.get(r["id"], 1 << 30))
    return items, status


# ---------------------------------------------------------------- pages without a feed (parallax/primary.py)
_PRIMARY_BY_NAME = {"会計検査院 新着": "primary-jbaudit", "官報 目次": "primary-kanpo",
                    "衆議院 議案": "primary-shugiin", "参議院 議案": "primary-sangiin"}


def fetch_primary_sources(budget=None, getter=None):
    """The government pages that have no feed (audit board, official gazette, bills of both houses) as items and status rows
    in the same shape as fetch_everything. Never raises: a page that fails is a status row with ok False and the reason.
    budget: seconds for the whole fetch (None = env PARALLAX_PRIMARY_BUDGET, else 150)."""
    import os
    try:
        from parallax import primary
    except ImportError:                                   # run from inside parallax/
        import primary  # type: ignore
    if budget is None:
        budget = float(os.environ.get("PARALLAX_PRIMARY_BUDGET") or 150)
    now = time.time()
    try:
        raw, st = (getter or primary.fetch_primary)(budget=budget)
    except Exception as e:                                # one broken page must not stop the build
        raw, st = [], [{"name": n, "ok": False, "n": 0, "err": ("%s: %s" % (type(e).__name__, e))[:160]}
                       for n in _PRIMARY_BY_NAME]
    items, status = [], []
    for it in raw:
        src = _BY_ID.get(_PRIMARY_BY_NAME.get(it.get("feed")))
        if not src or not it.get("title") or not it.get("link"):
            continue
        out = {"title": _s(it["title"]).strip(), "link": _s(it["link"]).strip(), "outlet": src["outlet"],
               "source_id": src["id"], "type": src["type"], "home": src["home"], "lang": "ja",
               "ts": int(it["ts"]) if isinstance(it.get("ts"), (int, float)) else None, "image": None}
        out["id"] = item_id(out)
        items.append(out)
    for r in st:
        src = _BY_ID.get(_PRIMARY_BY_NAME.get(r.get("name")))
        if not src:
            continue
        mine = [i for i in items if i["source_id"] == src["id"]]
        tss = [i["ts"] for i in mine if i["ts"] is not None]
        status.append({"id": src["id"], "name": src["name"], "outlet": src["outlet"], "type": src["type"],
                       "home": src["home"], "lang": "ja", "ok": bool(r.get("ok")), "n": len(mine),
                       "fetched_at": int(now), "newest_ts": max(tss) if tss else None,
                       "oldest_ts": min(tss) if tss else None, "err": r.get("err") or "",
                       "terms": src.get("terms", ""), "terms_status": src.get("terms_status", "unknown")})
    return items, status
