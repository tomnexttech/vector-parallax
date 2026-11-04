# -*- coding: utf-8 -*-
"""cluster — 同じ出来事を報じた見出しの束ね（規則・決定的・標準ライブラリだけ）。

VECTOR PARALLAX では、これは **候補** を作る段である。最終の合併・分割は AI（parallax.ai）が決める。
規則は誤結合を嫌って作ってあるので、日英を跨ぐ同じ出来事や言い換えの見出しは別の束に割れやすい。
その割れを AI が繋ぎ、話題だけで繋がった束を AI が割る。

規則の要点:
  1. 日本語は文字 bigram、英語は語を、この一束での珍しさ（idf）で重みを付けた Jaccard と
     「覆い率」（共有した珍しい語が短い方の見出しの何割か）の大きい方で比べる。
  2. 事件を特定する数（号・金額・%・日付 等）が同じ単位で食い違えば別の出来事として拒否する。
     都道府県・国（戦域でまとめる）が交わらない時も拒否する。
  3. 逆の結果（決定↔見送り・成立↔廃案・可決↔否決・承認↔却下・上昇↔下落）は別の出来事として拒否する。
  4. 日英の間は小さな対訳の概念表（_CONCEPTS）で、背景の概念を除いた強い概念の一致を要する。
  5. 単連結で繋がった群は、束を組み立てる直前に関所（_gate）で対ごとに比べ直し、核に似ない見出しを
     一本立ちにする（誤った構成員は欠けた構成員より悪い）。
  6. 転載（見出し末尾の（時事通信）等）は元の媒体へ寄せ、二重に数えない。
  7. 代表 = 政府一次＞通信社＞公共放送＞全国紙＞経済紙＞地方紙＞その他＞集約、同格なら古い方。
  決定性: 辺の並べ替えは (類似, 節点の番号)、浮動小数の和は math.fsum。PYTHONHASHSEED に依らない。

公開関数:
  similarity(a, b)  -> (score: float, veto: bool, why: str)
  cluster(items, threshold=DEFAULT_T, max_df_frac=0.08, max_gap_h=MAX_GAP_H, explain=False)
     -> [cluster]（n_sources の多い順）
     cluster = {"cid","rep","members","n_sources","types","first_ts","last_ts","n_reprints"}
  canon_source(name, link="") -> (正規名, 型)
  origin_of(title, source="", link="") -> str
  gn_members / parse_gn_html / parse_gn_xml / fetch_gn_raw は Google News の形を読むための物で、
  VECTOR PARALLAX の公開版は Google News を取得しない（媒体自身の RSS だけを使う）。

作法: 見出しは原文のまま返す。cluster() は外へ何も取りに行かない。
"""
import hashlib
import html
import math
import re
import ssl
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

try:
    from parallax import traps as _traps
except ImportError:                       # parallax/ の中から直に走らせた時
    import traps as _traps  # type: ignore

try:                                     # 同じ規則の正本があればそれを使う
    from parallax.sources import make_id  # type: ignore
except Exception:                        # 無ければ同じ規則を自前で持つ（循環 import を避ける）
    _TRACK = {"fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid",
              "igshid", "mc_cid", "mc_eid", "_ga", "_gl", "ref", "ref_src", "ref_url",
              "cmpid", "ncid", "ocid", "n_cid", "spm", "sr_share", "smid", "ito", "ftag",
              "cid_source", "rss_source"}

    def _norm_link(link):
        s = (link or "").strip()
        if not s:
            return ""
        try:
            p = urllib.parse.urlsplit(s)
        except ValueError:
            return s
        host = (p.hostname or "").lower()
        if host == "news.google.com" or host.endswith(".news.google.com"):
            return s
        if p.scheme.lower() not in ("http", "https") or not host:
            return s
        netloc = host if not p.port or p.port in (80, 443) else "%s:%d" % (host, p.port)
        q = sorted((k, v) for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True)
                   if not (k.lower() in _TRACK or k.lower().startswith("utm_")))
        path = (p.path or "").rstrip("/")
        return urllib.parse.urlunsplit(("https", netloc, path, urllib.parse.urlencode(q), ""))

    def make_id(link):
        return hashlib.sha1(_norm_link(link).encode("utf-8")).hexdigest()[:16]


EN_PENALTY = 0.06        # 英語どうしの類似から引く（取り置き検証で誤結合が多かったため）
ANCHOR_MASS_EN = 2.5     # 英語は語が単位なので bigram より少ない量で足りる
ANCHOR_MASS = 4.0        # 覆い率を使うのに要る「珍しい bigram」の量（完全に珍しい bigram 4本分）
MAX_GAP_H = 72           # 先頭見出しの時刻が72時間以上離れた物は規則では結ばない（同じ link は結ぶ）
GN_FLOOR = 0.01          # Google の束の中で、同じ言語の他の見出しと語をほぼ共有しない物は切り離す
COVER_W = 0.8            # 覆い率の重み
CAND_MIN = 20            # 候補索引で一つの鍵が拾う節点数の下限（これを超えて出る鍵は背景として候補に使わない）
DEFAULT_T = 0.34          # 人手で正誤を付けた陰性対照 42件で決めた（非公開の実データ）

# 事件単位の関所（_gate）。値は、人手で正誤を付けた二つの束の集合（49束・345件 と 50束・688件、2026-09 の実データ・非公開）で
# 90通りの組を測り、J = 適合率 − 損失率 の和が最大の物を採った。公開版はその集合を持たないので、試験は合成の例で形を確かめる。
GATE_ON = True            # False で関所を外す（前後の比較・非常用）
GATE_SEED = 0.25          # 核（2単位以上の塊）を平均連結で作る下限
GATE_MERGE = 0.16         # 核どうしを同じ事件として束ね直す平均の類似の下限
GATE_FLOAT = 0.05         # 核に入らなかった見出しが、核の最も似た一本と持つべき類似の下限
GATE_RES_FLOOR = 0.05     # 同じ言語の対: 人名・国名を除いた類似がこれ未満なら、除いた後の類似で測る
GATE_XPERSON = 0.0        # 日英の対: 共有する強い概念が人名だけで、錨（_xanchor）も無い時の類似の上限
GATE_VETO_FRAC = 0.1      # 塊どうしの対のうち拒否の割合がこれを超えれば結ばない（0 なら1対でも拒否があれば結ばない）
GATE_LANG = True          # 塊どうしの平均は同じ言語の対で測る（同じ言語の対が無い時だけ日英の対で測る）
GATE_XANCHOR = True       # 日英の人名だけの一致でも、錨（数値・日付・人物の地元以外の国・珍しい英字の語）があれば 0 にしない
GATE_MERGE_GN = 0.08      # 同じ Google の束の構成員を分け持つ塊どうしの平均の下限（None なら GATE_MERGE と同じ）
DATE_UNTIL = True         # 「10月8日まで」「29日にかけて」の日付は期間の端なので、日付の食い違いの拒否に使わない
NEAR_STRICT = True        # 金額の丸めの許しを「約・超」等の付いた額か、有効数字2桁以上への丸めに限る（加点しない）

# ================================================================ 媒体

# 転載（アグリゲータ）。元媒体が判れば元へ寄せ、判らなければ n_sources に数えない
AGGREGATORS = ("yahoo!ニュース", "yahoo!news", "yahooニュース", "ヤフーニュース", "news.yahoo",
               "dメニューニュース", "ｄメニューニュース", "dmenu", "au webポータル", "auone",
               "gooニュース", "goo news", "livedoorニュース", "livedoor news", "infoseek",
               "楽天infoseek", "smartnews", "スマートニュース", "line news", "lineニュース",
               "msn", "ニフティニュース", "@nifty", "excite", "エキサイトニュース",
               "グノシー", "gunosy", "newspicks", "antenna")

# 別名 -> 正規名。左が部分一致（小文字・NFKC 後）で当たれば右へ
_ALIAS = [
    ("時事ドットコム", "時事通信"), ("時事通信", "時事通信"), ("jiji", "時事通信"),
    ("47news", "共同通信"), ("共同通信", "共同通信"), ("kyodo", "共同通信"),
    ("ロイター", "ロイター"), ("reuters", "ロイター"), ("afp", "AFP"), ("ap通信", "AP"),
    ("apnews", "AP"), ("associated press", "AP"),
    ("bloomberg", "Bloomberg"), ("ブルームバーグ", "Bloomberg"),
    ("nhk", "NHK"), ("bbc", "BBC"),
    ("日本経済新聞", "日本経済新聞"), ("日経ビジネス", "日経ビジネス"), ("日経クロステック", "日経クロステック"),
    ("nikkei asia", "Nikkei Asia"), ("日経", "日本経済新聞"), ("nikkei", "日本経済新聞"),
    ("朝日新聞", "朝日新聞"), ("asahi", "朝日新聞"), ("読売", "読売新聞"), ("yomiuri", "読売新聞"),
    ("毎日新聞", "毎日新聞"), ("mainichi", "毎日新聞"), ("産経", "産経新聞"), ("sankei", "産経新聞"),
    ("東京新聞", "東京新聞"), ("tokyo-np", "東京新聞"), ("中日新聞", "中日新聞"),
    ("tbs", "TBS"), ("テレ朝", "テレビ朝日"), ("日テレ", "日本テレビ"), ("nnn", "日本テレビ"),
    ("fnn", "フジテレビ"), ("フジテレビ", "フジテレビ"), ("テレビ東京", "テレビ東京"), ("テレビ朝日", "テレビ朝日"),
    ("日本テレビ", "日本テレビ"), ("jnn", "TBS"),
    ("東洋経済", "東洋経済"), ("ダイヤモンド", "ダイヤモンド"), ("cnn", "CNN"),
    ("琉球新報", "琉球新報"), ("沖縄タイムス", "沖縄タイムス"), ("西日本新聞", "西日本新聞"),
    ("北海道新聞", "北海道新聞"), ("河北新報", "河北新報"), ("神戸新聞", "神戸新聞"),
    ("京都新聞", "京都新聞"), ("佐賀新聞", "佐賀新聞"), ("南日本新聞", "南日本新聞"),
    ("千葉日報", "千葉日報"), ("東奥日報", "東奥日報"), ("福井新聞", "福井新聞"),
    ("wall street journal", "WSJ"), ("wsj", "WSJ"), ("financial times", "FT"),
]

# 媒体の型は sources.py の語彙（政府一次・通信社・公共放送・全国紙・経済紙・地方紙・集約 …）に揃える。
# 代表を選ぶ順（小さいほど上位）。政府一次＞通信社＞公共放送＞全国紙＞経済紙＞地方紙＞その他
AGG = "集約"
TYPE_RANK = {"政府一次": 0, "通信社": 1, "公共放送": 2, "海外公共": 2, "全国紙": 3, "経済紙": 4,
             "地方紙": 5, AGG: 8}
_OTHER_RANK = 6            # 民放・専門・海外主流・国家メディア・シンクタンク・政党機関紙・週刊誌・未知
_TYPE_OF = {
    "時事通信": "通信社", "共同通信": "通信社", "ロイター": "通信社", "AFP": "通信社", "AP": "通信社",
    "NHK": "公共放送", "BBC": "海外公共",
    "朝日新聞": "全国紙", "読売新聞": "全国紙", "毎日新聞": "全国紙", "産経新聞": "全国紙",
    "日本経済新聞": "経済紙", "日経ビジネス": "経済紙", "Nikkei Asia": "経済紙",
    "Bloomberg": "経済紙", "東洋経済": "経済紙", "ダイヤモンド": "経済紙", "WSJ": "経済紙", "FT": "経済紙",
    "東京新聞": "地方紙", "中日新聞": "地方紙", "琉球新報": "地方紙", "沖縄タイムス": "地方紙",
    "西日本新聞": "地方紙", "北海道新聞": "地方紙", "河北新報": "地方紙", "神戸新聞": "地方紙",
    "京都新聞": "地方紙", "佐賀新聞": "地方紙", "南日本新聞": "地方紙", "千葉日報": "地方紙",
    "東奥日報": "地方紙", "福井新聞": "地方紙",
    "TBS": "民放", "テレビ朝日": "民放", "日本テレビ": "民放", "フジテレビ": "民放", "テレビ東京": "民放",
}


def type_rank(ty):
    return TYPE_RANK.get(ty, _OTHER_RANK)


_GOV_HINT = ("首相官邸", "内閣府", "内閣官房", "財務省", "総務省", "外務省", "防衛省", "デジタル庁",
             "厚生労働省", "経済産業省", "金融庁", "日本銀行", "会計検査院", "e-gov", "政府広報",
             "官報", "国会", "衆議院", "参議院", "federal reserve", "ecb", "white house")

_sources_mod = None


def _load_sources():
    """sources.py の canonical があれば使う（同時に作られている部品なので、無くても動く）"""
    global _sources_mod
    if _sources_mod is None:
        try:
            from parallax import sources as m          # type: ignore
            _sources_mod = m if hasattr(m, "canonical") else False
        except Exception:
            _sources_mod = False
    return _sources_mod or None


def _nf(s):
    return unicodedata.normalize("NFKC", s or "").strip()


def is_aggregator(name, link=""):
    n = _nf(name).lower()
    if any(a in n for a in (_nf(x).lower() for x in AGGREGATORS)):
        return True
    host = (urllib.parse.urlsplit(link or "").hostname or "").lower()
    return any(h in host for h in ("news.yahoo.co.jp", "topics.smt.docomo", "article.auone",
                                   "news.goo.ne.jp", "news.livedoor.com", "news.infoseek",
                                   "smartnews.com", "news.line.me", "msn.com"))


def _alias(name):
    n = _nf(name).lower()
    if not n:
        return ""
    for k, v in _ALIAS:
        if _nf(k).lower() in n:
            return v
    return _nf(name)


def canon_source(name, link=""):
    """(正規名, 型)。型は sources.canonical が知っていればそれ、無ければ自前の表、
    それも無ければ媒体名のまま（推測で型を作らない）。"""
    nm, ty = "", None
    m = _load_sources()
    if m is not None:
        try:
            r = m.canonical(name)
            if isinstance(r, (tuple, list)) and r:
                nm, ty = (r[0] or ""), (r[1] if len(r) > 1 else None)
        except Exception:
            nm, ty = "", None
    if ty:
        return str(nm), str(ty)
    if is_aggregator(name, link):
        return _nf(name), AGG
    nm2 = _alias(name)
    ty2 = _type_of(nm2, link)
    return nm2, (ty2 or nm2)


def _type_of(nm, link=""):
    if nm in _TYPE_OF:
        return _TYPE_OF[nm]
    n = nm.lower()
    host = (urllib.parse.urlsplit(link or "").hostname or "").lower()
    if host.endswith(".go.jp") or host.endswith(".gov") or any(g in n for g in _GOV_HINT):
        return "政府一次"
    if n.endswith("新聞") or n.endswith("新報") or n.endswith("日報") or "新聞社" in n:
        return "地方紙"
    return None


# 見出し末尾の元媒体表記:  …（時事通信） / …(tenki.jp) / …：時事ドットコム / … - 毎日新聞 / …｜TBS
_ORIGIN_TAIL = re.compile(r"[（(]([^（）()]{2,24})[）)]\s*(?:-\s*\S{1,12})?\s*$")


def _tail_paren(t, maxlen=50):
    """末尾の括弧（入れ子可）を探す。-> (開き括弧の位置, 中身) / 無ければ (-1, "")"""
    t2 = t.rstrip()
    if not t2 or t2[-1] not in "）)":
        return -1, ""
    depth = 0
    for i in range(len(t2) - 1, max(-1, len(t2) - maxlen - 3), -1):
        ch = t2[i]
        if ch in "）)":
            depth += 1
        elif ch in "（(":
            depth -= 1
            if depth == 0:
                return i, t2[i + 1:-1]
    return -1, ""
_SUFFIX_TAIL = re.compile(r"\s*(?:[：:｜|]|\s-\s)\s*([^：:｜|]{2,24})\s*$")


# 括弧の中身を媒体名と認める手掛かり。（動画）（詳報）（写真）（更新）のような札を媒体に数えないため
_MEDIA_HINT = re.compile(r"新聞|通信|テレビ|放送|ニュース|日報|新報|タイムス|オンライン|ドットコム|ジャーナル|"
                         r"プレス|系\b|BIZ|Biz|ONLINE|Online|News|NEWS|Times|TIMES|Post|Press|Journal|"
                         r"\.jp|\.com|\.net|\.co\b")


def _known_media(name):
    """媒体名として知っている（自前の表・sources.canonical・媒体らしい語を含む）か"""
    if not name:
        return False
    if _alias(name) in _TYPE_OF:
        return True
    m = _load_sources()
    if m is not None:
        try:
            r = m.canonical(name)
            if isinstance(r, (tuple, list)) and len(r) > 1 and r[1]:
                return True
        except Exception:
            pass
    return bool(_MEDIA_HINT.search(name))


def origin_of(title, source="", link=""):
    """転載の元媒体を見出し末尾から推定する。判らなければ ""。"""
    if not isinstance(title, str):
        return ""
    t = re.sub(r"\s+-\s+\S{1,12}\s*$", "", _nf(title))      # … - エキスパート
    i, inner = _tail_paren(t)
    if i >= 0 and 2 <= len(inner) <= 40:
        o = re.split(r"[=＝（(]", inner)[0].strip()      # ＡＦＰ＝時事 -> AFP / FNN…（フジテレビ系） -> FNN…
        if o and not re.fullmatch(r"[\d\s./:-]+", o) and (_known_media(o) or _known_media(inner)):
            return _alias(o)
    m = _SUFFIX_TAIL.search(t)
    if m:
        cand = _alias(m.group(1))
        if cand in _TYPE_OF:
            return cand
    return ""


# ================================================================ Google News

UA = ("Mozilla/5.0 (compatible; VECTOR-PARALLAX/0.1; +https://github.com/tomnexttech/vector-parallax)")
_LI = re.compile(r"<li>\s*<a\b[^>]*href=\"([^\"]*)\"[^>]*>(.*?)</a>(?:\s|&nbsp;|\xa0)*"
                 r"(?:<font\b[^>]*>(.*?)</font>)?", re.S | re.I)


def parse_gn_html(desc_html):
    """Google News の description（HTML・既に XML のエスケープは解いた物）-> [{"title","source","link"}]"""
    if not desc_html or "<li" not in desc_html.lower():
        return []
    out = []
    for m in _LI.finditer(desc_html):
        title = html.unescape(re.sub(r"<[^>]+>", "", m.group(2))).strip()
        src = html.unescape(re.sub(r"<[^>]+>", "", m.group(3) or "")).strip()
        if title:
            out.append({"title": title, "source": src, "link": html.unescape(m.group(1)).strip()})
    return out


def gn_members(item):
    """item から Google News の束の中身を返す。item に "gn_members" があればそれ、
    "gn_html"/"description_html" があれば解析する。どちらも無ければ []（feeds.py の summary は
    タグが消されているので構造を復元できない。fetch_gn_raw で取り直すこと）。"""
    g = item.get("gn_members")
    if isinstance(g, list) and g:
        return [{"title": x["title"], "source": x.get("source") if isinstance(x.get("source"), str) else "",
                 "link": x.get("link") if isinstance(x.get("link"), str) else ""}
                for x in g if isinstance(x, dict) and isinstance(x.get("title"), str) and x["title"].strip()]
    for k in ("gn_html", "description_html"):
        if isinstance(item.get(k), str) and item.get(k):
            return parse_gn_html(item[k])
    return []


def _ts(s):
    try:
        import email.utils
        return email.utils.parsedate_to_datetime(s.strip()).timestamp()
    except Exception:
        return None


_XML_DECL = re.compile(r"^\s*<\?xml[^>]*\?>", re.S)


def _xml_str(raw):
    """bytes/str -> XML 宣言を外した str。expat は Shift_JIS 等の多バイト符号を読めないので、
    宣言の encoding（無ければ UTF-8）で Python 側で解いてから渡す。"""
    if isinstance(raw, (bytes, bytearray)):
        b = bytes(raw)
        enc = "utf-8"
        if b.startswith(b"\xef\xbb\xbf"):
            enc, b = "utf-8", b[3:]
        else:
            m = re.match(rb"\s*<\?xml[^>]*encoding=[\"']([A-Za-z0-9_.:-]+)[\"']", b[:300])
            if m:
                enc = m.group(1).decode("ascii", "replace")
        try:
            s = b.decode(enc, "replace")
        except LookupError:
            s = b.decode("utf-8", "replace")
    else:
        s = raw or ""
    return _XML_DECL.sub("", s.lstrip("﻿"), count=1)


def parse_gn_xml(text, feed=None):
    """Google News RSS の本文（str か bytes）-> items（feeds.py の形 + id + gn_members + gn_html）。
    壊れた XML は ET.ParseError をそのまま上げる（件数を作らない）。"""
    feed = feed or {}
    root = ET.fromstring(_xml_str(text))
    out = []
    for el in root.iter("item"):
        title = (el.findtext("title") or "").strip()
        link = (el.findtext("link") or "").strip()
        src_el = el.find("source")
        src = (src_el.text or "").strip() if src_el is not None else ""
        desc = el.findtext("description") or ""
        if src and title.endswith(" - " + src):
            title = title[: -len(" - " + src)]
        elif not src and " - " in title:
            title, src = title.rsplit(" - ", 1)
        mem = parse_gn_html(desc)
        out.append({"title": title, "link": link, "source": src or feed.get("name", ""),
                    "feed": feed.get("name", ""), "cat": feed.get("cat", ""),
                    "lang": feed.get("lang", ""), "tier": feed.get("tier", ""),
                    "ts": _ts(el.findtext("pubDate") or ""),
                    "summary": re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", desc))).strip()[:360],
                    "id": make_id(link), "gn_members": mem, "gn_html": desc})
    return out


def fetch_gn_raw(url, feed=None, timeout=15):
    """Google News の RSS を GET で取り直し、生の description から gn_members を付けて返す。
    取れなければ例外をそのまま上げる（件数を作らない）。"""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
        raw = r.read(20_000_000)          # 上限を置く（異常に大きい応答で固まらない）
    f = dict(feed or {})
    f.setdefault("name", "Google News")
    f.setdefault("lang", "ja" if "hl=ja" in url else "en")
    return parse_gn_xml(raw, f)


# ================================================================ 見出しの特徴

_BRACKET_LABEL = re.compile(r"【[^】]{1,12}】|\[[^\]]{1,16}\]|［[^］]{1,16}］|<[^>]{1,12}>")
_JA_CHARS = re.compile(r"[ぁ-んァ-ヴー一-龥々〆ヵヶ]")
_PUNCT = re.compile(r"[\s「」『』（）()【】\[\]［］、。,.・:：;；!！?？\"'“”‘’…―\-－‐|｜/／＝=~〜~+＋*＊#＃&＆%％]+")
_KATA = re.compile(r"[ァ-ヴー]{2,}")
_KANJI = re.compile(r"[一-龥々〆ヵヶ]{2,}")
_LATIN = re.compile(r"[A-Za-z][A-Za-z0-9'’.\-]*")

_EN_STOP = set("""a an the of to in on for at by with from as and or but is are was were be been being
has have had it its this that these those after before over under into about amid against
says said say new more than up down out off not no will would could should may might can
he she they we you his her their our your who what when where which why how
as per via vs latest live updates update news report reports""".split())
_KATA_STOP = {"ニュース", "トップ", "ページ", "オンライン", "デジタル", "ランキング", "シミュレーション"}

# 数の単位（長い順に当てる）。同じ単位で値の集合が交わらなければ別事件
_UNITS = ["日続伸", "日続落", "日連続", "営業日", "日間", "日ぶり", "年ぶり", "か月", "カ月", "ヶ月", "ケ月",
          "年後", "年度", "年前", "日前", "年", "月", "日", "時間", "分間", "時", "号", "円高", "円安",
          "兆円", "億円", "万円", "円", "ドル", "人", "件", "棟", "戸", "回", "項目", "法案", "倍",
          "トン", "議席", "票", "位", "歳", "度", "キロ", "メートル", "m", "%", "％", "ポイント", "銭"]
_UNIT_CANON = {"日間": "days", "カ月": "か月", "ヶ月": "か月", "ケ月": "か月", "％": "%",
               "day": "days", "days": "days", "percent": "%", "people": "人", "dead": "人",
               "killed": "人", "billion": "$", "million": "$", "trillion": "$",
               "年度": "年", "トン": "トン", "tons": "トン", "tonnes": "トン"}
# 食い違えば別事件とする単位（事件を特定する数）。日付・人数・時刻は続報で動くので拒否に使わない
_UNIT_VETO = {"date", "号", "日続伸", "日続落", "日連続", "営業日", "円高", "円安", "銭", "days", "項目", "法案",
              "議席", "%", "ポイント", "$", "ドル", "円", "トン", "年ぶり", "日ぶり"}
# 一致しても加点しない単位（同じ日の報道はみな同じ日付を持つ）
_UNIT_NOBONUS = {"年", "月", "日", "時", "分間", "時間", "年度", "年前", "日前"}
_NUM_JA = re.compile(r"(\d+(?:\.\d+)?(?:[兆億万千]\d*(?:\.\d+)?)*)\s*(" + "|".join(map(re.escape, _UNITS)) + r")")
_NUM_EN = re.compile(r"\$?\s*(\d+(?:\.\d+)?)\s*-?\s*(billion|million|trillion|percent|%|day|days|people|dead|killed|tons|tonnes|bn|m\b)?",
                     re.I)
_MULT = {"兆": 1e12, "億": 1e8, "万": 1e4, "千": 1e3}
_DATE_JA = re.compile(r"(\d{1,2})月(\d{1,2})日")
_DATE_EN = re.compile(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b", re.I)
_MONTHS = {k: i + 1 for i, k in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep",
                                            "oct", "nov", "dec"])}
_NUMWORDS = {w: i + 1 for i, w in enumerate("one two three four five six seven eight nine ten eleven twelve".split())}
_NUMWORD_DAY = re.compile(r"\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)-day\b", re.I)
_LEAD_LABEL = re.compile(r"^\s*(?:exclusive|live|opinion|analysis|breaking|watch|video|explainer|updates?)\s*[|:：]\s*", re.I)


def _ja_num(s):
    """3千万 -> 3e7 / 3億5千万 -> 3.5e8 / 1兆2000億 -> 1.2e12（千は万・億・兆の内側の桁）。
    以前は「3千万」を 13000 と読み、「3000万円」と数値の食い違いで誤って分けていた（検証 2026-09-27）"""
    total, sec, cur = 0.0, 0.0, ""
    for ch in s:
        if ch == "千":
            sec += (float(cur) if cur else 1.0) * 1e3
            cur = ""
        elif ch in _MULT:
            sec += float(cur) if cur else 0.0
            total += (sec or 1.0) * _MULT[ch]
            sec, cur = 0.0, ""
        else:
            cur += ch
    return total + sec + (float(cur) if cur else 0.0)


# ---- 地名の食い違い（誤結合の拒否）。検証 2026-09-27 で「東京都で震度5強」と「北海道で震度5強」、
#      「トランプ大統領 日本に関税25%」と「韓国に関税25%」が一つの束になった。
#      両方が都道府県を持ち、交わらなければ別事件。国は「戦域」でまとめる（ロシアとウクライナ、
#      韓国と北朝鮮、中東は同じ戦域 = 同じ事件を別の側から書くので拒否しない）。米国・中国は背景に
#      なりやすいので数えない。日本は「日本に/へ/と/の…」のように国として立っている時だけ数える。
_PREFS = ["北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島", "茨城", "栃木", "群馬", "埼玉", "千葉",
          "東京", "神奈川", "新潟", "富山", "石川", "福井", "山梨", "長野", "岐阜", "静岡", "愛知", "三重",
          "滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山", "鳥取", "島根", "岡山", "広島", "山口", "徳島",
          "香川", "愛媛", "高知", "福岡", "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄"]
_PREF_RE = re.compile("(" + "|".join(sorted((p if p == "北海道" else p + "(?:都|府|県)?" for p in _PREFS),
                                            key=len, reverse=True)) + ")")
_THEATRE_JA = [("北朝鮮", "KOREA"), ("韓国", "KOREA"), ("台湾", "TW"), ("ロシア", "RUUA"), ("ウクライナ", "RUUA"),
               ("イスラエル", "ME"), ("イラン", "ME"), ("パレスチナ", "ME"), ("レバノン", "ME"), ("シリア", "ME"),
               ("イラク", "ME"), ("イエメン", "ME"), ("サウジ", "ME"), ("インドネシア", "ID"), ("インド", "INPK"),
               ("パキスタン", "INPK"), ("英国", "UK"), ("イギリス", "UK"), ("フランス", "FR"), ("ドイツ", "DE"),
               ("カナダ", "CA"), ("メキシコ", "MX"), ("ブラジル", "BR"), ("オーストラリア", "AU"), ("豪州", "AU"),
               ("フィリピン", "PH"), ("ベトナム", "VN"), ("トルコ", "TR"), ("ミャンマー", "MM"), ("エジプト", "EG")]
_THEATRE_JA_RE = re.compile("|".join(sorted((re.escape(k) for k, _ in _THEATRE_JA), key=len, reverse=True)))
_THEATRE_JA_MAP = dict(_THEATRE_JA)
_JAPAN_JA = re.compile(r"日本(?=[にへとのがはもでを、 」』]|$)")
_THEATRE_EN = [("north korea", "KOREA"), ("south korea", "KOREA"), ("korea", "KOREA"), ("korean", "KOREA"),
               ("taiwan", "TW"), ("russia", "RUUA"), ("russian", "RUUA"), ("ukraine", "RUUA"), ("ukrainian", "RUUA"),
               ("israel", "ME"), ("israeli", "ME"), ("iran", "ME"), ("iranian", "ME"), ("lebanon", "ME"),
               ("syria", "ME"), ("iraq", "ME"), ("yemen", "ME"), ("saudi", "ME"), ("india", "INPK"),
               ("indian", "INPK"), ("pakistan", "INPK"), ("britain", "UK"), ("british", "UK"), ("france", "FR"),
               ("french", "FR"), ("germany", "DE"), ("german", "DE"), ("canada", "CA"), ("canadian", "CA"),
               ("mexico", "MX"), ("mexican", "MX"), ("brazil", "BR"), ("australia", "AU"), ("philippines", "PH"),
               ("vietnam", "VN"), ("japan", "JP"), ("japanese", "JP")]
_THEATRE_EN_MAP = dict(_THEATRE_EN)


def _places(t, lang):
    """(都道府県の集合, 国の戦域の集合)"""
    prefs, th = set(), set()
    if lang == "ja":
        for m in _PREF_RE.finditer(t):
            prefs.add(re.sub(r"(都|府|県)$", "", m.group(1)) if m.group(1) != "北海道" else "北海道")
        for m in _THEATRE_JA_RE.finditer(t):
            th.add(_THEATRE_JA_MAP[m.group(0)])
        if _JAPAN_JA.search(t):
            th.add("JP")
    else:
        low = t.lower()
        for k, v in _THEATRE_EN:
            if " " in k:
                if k in low:
                    th.add(v)
            elif re.search(r"\b" + k + r"(?:'s)?\b", low):
                th.add(v)
    return prefs, th


def _place_conflict(fa, fb):
    if fa.prefs and fb.prefs and not (fa.prefs & fb.prefs):
        return "都道府県:%s≠%s" % (sorted(fa.prefs), sorted(fb.prefs))
    if fa.theatres and fb.theatres and not (fa.theatres & fb.theatres):
        return "国:%s≠%s" % (sorted(fa.theatres), sorted(fb.theatres))
    return ""


# 日英の対訳の概念表（小さく・一般的な物だけ）。正解の集合を見た後に書いたので、過学習の恐れがある
_CONCEPTS = {
    "US": ["米国", "米政権", "米中", "日米", "米大統領", "アメリカ", "米軍", "u.s.", "us", "america", "american", "washington"],
    "CN": ["中国", "米中", "日中", "china", "chinese", "beijing"],
    "JP": ["日本", "日米", "日中", "政府", "japan", "japanese", "tokyo"],
    "KR": ["韓国", "south korea", "korean", "seoul"], "NK": ["北朝鮮", "north korea", "pyongyang"],
    "RU": ["ロシア", "russia", "russian", "moscow", "kremlin"], "UA": ["ウクライナ", "ukraine", "ukrainian", "kyiv"],
    "IR": ["イラン", "iran", "iranian", "tehran"], "IL": ["イスラエル", "israel", "israeli"],
    "TW": ["台湾", "taiwan", "taiwanese"], "FR": ["フランス", "仏", "パリ", "france", "french", "paris"],
    "UK": ["英国", "イギリス", "britain", "british", "uk", "london"], "DE": ["ドイツ", "独", "germany", "german", "berlin"],
    "IN": ["インド", "india", "indian"], "EU": ["欧州", "eu", "europe", "european"], "GAZA": ["ガザ", "gaza"],
    "HORMUZ": ["ホルムズ", "hormuz"], "POPE": ["教皇", "法王", "pope", "vatican", "バチカン"],
    "TRUMP": ["トランプ", "trump"], "XI": ["習近平", "習氏", "習主席", "xi"], "TAKAICHI": ["高市", "takaichi"],
    "PUTIN": ["プーチン", "putin"], "ZELENSKY": ["ゼレンスキー", "zelensky"], "NETANYAHU": ["ネタニヤフ", "netanyahu"],
    "CNN": ["cnn"], "AF1": ["大統領専用機", "エアフォースワン", "air force one"],
    "WH": ["ホワイトハウス", "米政権", "white house"], "TARIFF": ["関税", "tariff", "tariffs"],
    "SUMMIT": ["首脳会談", "首脳", "summit"], "STATEVISIT": ["国賓", "state visit"],
    "HURRICANE": ["ハリケーン", "hurricane"], "TYPHOON": ["台風", "typhoon"], "QUAKE": ["地震", "earthquake", "quake"],
    "BOJ": ["日銀", "日本銀行", "boj", "bank of japan"], "FED": ["frb", "fed", "federal reserve"],
    "NIKKEI": ["日経平均", "nikkei 225", "nikkei average"], "OPENAI": ["オープンai", "openai", "チャットgpt", "chatgpt"],
    "NVIDIA": ["エヌビディア", "nvidia"], "COAL": ["石炭", "coal"], "OIL": ["原油", "crude"],
    "MISSILE": ["ミサイル", "missile", "missiles"], "KADENA": ["嘉手納", "kadena"], "OKINAWA": ["沖縄", "okinawa"],
    "ELECTION": ["選挙", "election"], "SANCTION": ["制裁", "sanction", "sanctions"],
    "AIRAGENT": ["aiエージェント", "ai agent", "ai agents"], "SEMI": ["半導体", "chip", "chips", "semiconductor"],
}
# 背景になりやすい概念（国・大統領・首相・会談一般）は日英の一致の数に入れない
_GEO = {"US", "CN", "JP", "KR", "NK", "RU", "UA", "IR", "IL", "TW", "FR", "UK", "DE", "IN", "EU", "OKINAWA"}
_WEAK_CONCEPTS = _GEO | {"TRUMP", "SUMMIT"}


# 地名の略字が別の語の一部になっている既知の型。{概念: (その概念に当ててはいけない語, ...)}。
# 「米中間選挙」の「米中」は米国の中間選挙で、中国ではない（「米中間の対話」のような「米国と中国の間」は別なので
# 「米中間選」と書く）。その概念の照合からだけ、この語を除く。US は「米中」の語がそのまま当たる。
# parallax/eval.py の place_misread_known は、この一覧に当たる地名の札が出力に残っていないかを数える
PLACE_TRAPS = _traps.place_traps()        # data/traps.json (CONTRACT 20.4): {"CN": ("米中間選",)}


def _concepts(norm_lower, words):
    out = set()
    for cid, keys in _CONCEPTS.items():
        text = norm_lower
        for ph in PLACE_TRAPS.get(cid, ()):
            text = text.replace(ph, "")
        for k in keys:
            if re.fullmatch(r"[a-z0-9 .'-]+", k):
                if " " in k:
                    if k in text:
                        out.add(cid)
                        break
                elif k in words:
                    out.add(cid)
                    break
            elif k in text:
                out.add(cid)
                break
    return out


_TAIL_PAREN = re.compile(r"\s*[（(][^（）()]{1,40}[）)]\s*$")
_TAIL_DASH = re.compile(r"\s+[-－–—]\s+[^-－–—\s、。]{1,14}$")
_TAIL_BAR = re.compile(r"\s*[｜|]\s*[^｜|]{1,25}$")


def _strip_source_tail(t, source):
    """比較のためだけに、見出し末尾の媒体名・頁番号・日付の札を剥がす（出力には使わない）"""
    if source:
        s = _nf(source)
        for sep in (" - ", "：", ":", "｜", "|", " "):
            if t.endswith(sep + s):
                t = t[: -len(sep + s)]
                break
    for _ in range(4):
        before = t
        i, inner = _tail_paren(t)
        if i > 0:
            t = t[:i].rstrip()
        t = _TAIL_DASH.sub("", t)
        t = _TAIL_BAR.sub("", t)
        m = _SUFFIX_TAIL.search(t)
        if m and _alias(m.group(1)) in _TYPE_OF:
            t = t[: m.start()]
        if t == before or len(t) < 6:
            break
    return t.strip() or before


# ---- 逆の結果（検証 2026-09-28 追加）。同じ対象について 決定↔見送り・成立↔廃案・可決↔否決・承認↔却下・
#      上昇↔下落 を言う2本は、語をどれだけ共有しても別の出来事（結果が逆）として拒否する。
#      対象 = 結果の語の直前の内容語（日本語は助詞を2字まで飛ばした直前の漢字・カタカナ・英字の2字、
#      英語は直前の内容語＋直後4語の内容語）。片方の見出しが両側を言う時は判断しない。
#      勝つ↔負ける・当選↔落選・勝訴↔敗訴 は同じ出来事を両側から書く（アイオワが勝った＝ミシガンが負けた）ので入れない。
#      通貨の上昇↔下落も同じ（円が下落＝ドルが上昇）なので、通貨の語を含む見出しでは上昇↔下落を見ない。
_OPP_JA = [
    (r"決定(?!的)|決める|決めた|決まる|決まった", r"見送り|見送る|見送った|見送られ|先送り"),
    (r"(?<!不)成立", r"廃案|不成立"),
    (r"可決", r"否決"),
    (r"(?<!不)承認", r"却下|不承認"),
    (r"上昇|続伸|反発|高騰|急騰|値上がり", r"下落|続落|反落|急落|値下がり"),
]
_OPP_JA_RE = [(re.compile(a), re.compile(b)) for a, b in _OPP_JA]
_OPP_EN = [
    ({"approve", "approves", "approved"}, {"reject", "rejects", "rejected", "veto", "vetoes", "vetoed"}),
    ({"rise", "rises", "rose", "gain", "gains", "gained", "jump", "jumps", "jumped", "surge", "surges", "surged",
      "climb", "climbs", "climbed", "rally", "rallies", "rallied"},
     {"fall", "falls", "fell", "drop", "drops", "dropped", "slide", "slides", "slid", "plunge", "plunges", "plunged",
      "sink", "sinks", "sank", "tumble", "tumbles", "tumbled", "decline", "declines", "declined"}),
]
_OPP_LABEL_JA = [("決定", "見送り"), ("成立", "廃案"), ("可決", "否決"), ("承認", "却下"), ("上昇", "下落")]
_OPP_LABEL_EN = [("approve", "reject"), ("rise", "fall")]
_OPP_MOVE = 4                                  # 上昇↔下落 の対の番号（通貨では見ない）
_OPP_CURRENCY_JA = re.compile(r"円相場|円安|円高|ドル|ユーロ|人民元|為替|ウォン|ポンド")
_OPP_CURRENCY_EN = {"dollar", "yen", "euro", "yuan", "sterling", "pound", "currency", "forex", "won", "rupee"}
_OPP_CONTENT = re.compile(r"[一-龥々〆ヵヶァ-ヴーA-Za-z]")
# 否定の対象（決議・動議・阻止の試み）を承認/否決する見出しは、結果の向きが元の案と逆になるので判断しない
_OPP_NEGOBJ = {"resolution", "resolutions", "motion", "motions", "block", "blocking", "bid", "attempt", "challenge",
               "repeal", "ban", "veto", "override"}


def _opp_marks(t, lang):
    """見出し -> {(対の番号, 側): 対象の集合}。側は 0/1。"""
    out = {}
    if lang == "ja":
        cur = bool(_OPP_CURRENCY_JA.search(t))
        for k, pair in enumerate(_OPP_JA_RE):
            if k == _OPP_MOVE and cur:
                continue
            for side, rx in enumerate(pair):
                for m in rx.finditer(t):
                    i, skip = m.start() - 1, 0
                    while i >= 0 and not _OPP_CONTENT.match(t[i]) and skip < 2:
                        i, skip = i - 1, skip + 1
                    if i >= 1 and _OPP_CONTENT.match(t[i]) and _OPP_CONTENT.match(t[i - 1]):
                        out.setdefault((k, side), set()).add(t[i - 1:i + 1].lower())
        return out
    words = re.findall(r"[a-z][a-z0-9'’-]*", t.lower())
    cur = bool(_OPP_CURRENCY_EN & set(words))
    for k, (va, vb) in enumerate(_OPP_EN):
        if k == 1 and cur:                      # rise↔fall は通貨では見ない
            continue
        for side, vocab in enumerate((va, vb)):
            for i, w in enumerate(words):
                if w not in vocab:
                    continue
                head = next((x for x in reversed(words[max(0, i - 3):i]) if x not in _EN_STOP and len(x) > 2), "")
                obj = frozenset(x for x in words[i + 1:i + 5] if x not in _EN_STOP and len(x) > 2
                                and x not in va and x not in vb)
                if k == 0 and obj & _OPP_NEGOBJ:
                    continue                            # 「〜を阻む決議を否決」は元の案の承認と同じ出来事（検証 2026-09-28 r2）
                if head:
                    out.setdefault((k, side), set()).add((head, obj))
    return out


def _opp_same(ka, kb, lang):
    if lang == "ja":
        return ka == kb
    (ha, oa), (hb, ob) = ka, kb
    return ha == hb and (not oa or not ob or bool(oa & ob))


def _opposite(fa, fb):
    """逆の結果なら理由の文字列、違えば ""。"""
    if fa.lang != fb.lang or not fa.opp or not fb.opp:
        return ""
    for (k, side), ka in fa.opp.items():
        if (k, 1 - side) in fa.opp or (k, side) in fb.opp:
            continue                            # 片方が両側を言う（「利上げ見送りを決定」）
        kb = fb.opp.get((k, 1 - side))
        if kb and any(_opp_same(x, y, fa.lang) for x in ka for y in kb):
            lab = (_OPP_LABEL_JA if fa.lang == "ja" else _OPP_LABEL_EN)[k]
            return "逆の結果 %s↔%s" % (lab[side], lab[1 - side])
    return ""


_APPROX = re.compile(r"約|およそ|程度|規模|超|近く|余り|前後|弱|強|about|around|nearly|roughly|almost|over|more than|some|~|〜",
                     re.I)
_UNTIL = re.compile(r"\s*(?:まで|にかけ|頃まで|ごろまで)")


def _sig(numstr):
    """数字の文字列の有効数字の桁数（"11.6"→3・"12"→2・"300"→1・"3億5千万"は先頭の数だけ見る）"""
    m = re.match(r"\d+(?:\.\d+)?", numstr or "")
    if not m:
        return 0
    s = m.group(0)
    if "." in s:
        return len(s.replace(".", "").lstrip("0"))
    return len(s.lstrip("0").rstrip("0")) or 1


class Feat:
    __slots__ = ("lang", "grams", "words", "ents", "nums", "concepts", "norm", "prefs", "theatres", "opp",
                 "money", "__weakref__")

    def __init__(self, title, source=""):
        t = _nf(title if isinstance(title, str) else "")
        source = source if isinstance(source, str) else ""
        t = _strip_source_tail(t, source)
        t = _BRACKET_LABEL.sub(" ", t)
        t = _LEAD_LABEL.sub("", t)
        t = _NUMWORD_DAY.sub(lambda m: "%d-day" % _NUMWORDS[m.group(1).lower()], t)
        t = re.sub(r"(?<=\d),(?=\d{3})", "", t)
        self.norm = t
        low = t.lower()
        ja = len(_JA_CHARS.findall(t))
        self.lang = "ja" if ja >= max(2, 0.2 * len(t.replace(" ", ""))) else "en"
        self.words = {re.sub(r"['’]s$", "", w).strip("'’.-").lower() for w in _LATIN.findall(t)}
        self.words = {w[:-1] if len(w) > 4 and w.endswith("s") and not w.endswith("ss") else w
                      for w in self.words if w and w not in _EN_STOP}
        if self.lang == "ja":
            grams = set()
            for seg in _PUNCT.split(low):
                seg = seg.strip()
                if len(seg) == 1:
                    grams.add(seg)
                for i in range(len(seg) - 1):
                    grams.add(seg[i:i + 2])
            self.grams = grams
        else:
            self.grams = set(self.words)
        ents = set()
        for m in _KATA.finditer(t):
            if m.group(0) not in _KATA_STOP:
                ents.add(m.group(0))
        for m in _KANJI.finditer(t):
            ents.add(m.group(0))
        for w in _LATIN.findall(t):
            if (w[0].isupper() or w.isupper()) and w.lower() not in _EN_STOP and len(w) > 1:
                ents.add(w.lower().rstrip("'’s."))
        self.ents = ents
        nums = {}
        money = []                                      # 金額: (単位, 値, 有効数字の桁数, 「約・超」等の印)
        for m in _DATE_JA.finditer(t):                  # 9月26日 = 日付の特定（食い違えば別事件）
            if DATE_UNTIL and _UNTIL.match(t, m.end()):
                continue                                # 「10月8日まで」は予報・期間の端で、出来事の日付ではない
            nums.setdefault("date", set()).add(int(m.group(1)) * 100 + int(m.group(2)))
        for m in _DATE_EN.finditer(t):                  # September 26 / Sept. 26
            mo = _MONTHS.get(m.group(1).lower()[:3])
            if mo:
                nums.setdefault("date", set()).add(mo * 100 + int(m.group(2)))
        for m in _NUM_JA.finditer(t):
            u = _UNIT_CANON.get(m.group(2), m.group(2))
            v = _ja_num(m.group(1))
            if u in ("兆円", "億円", "万円"):
                v *= _MULT[u[0]]
                u = "円"
            nums.setdefault(u, set()).add(round(v, 3))
            if u in ("円", "ドル"):
                money.append((u, round(v, 3), _sig(m.group(1)),
                              bool(_APPROX.search(t[max(0, m.start() - 3):m.end() + 3]))))
        if self.lang == "en":
            for m in _NUM_EN.finditer(t):
                u = (m.group(2) or "").lower()
                if not u:
                    continue
                v = float(m.group(1))
                if u in ("billion", "bn"):
                    v *= 1e9
                elif u in ("million", "m"):
                    v *= 1e6
                elif u == "trillion":
                    v *= 1e12
                u = _UNIT_CANON.get(u, u)
                nums.setdefault(u, set()).add(round(v, 3))
                if u == "$":
                    money.append((u, round(v, 3), _sig(m.group(1)),
                                  bool(_APPROX.search(t[max(0, m.start() - 12):m.start()]))))
        self.nums = nums
        self.money = money
        self.concepts = _concepts(low, set(re.findall(r"[a-z0-9]+", low)) | self.words)
        self.prefs, self.theatres = _places(t, self.lang)
        self.opp = _opp_marks(t, self.lang)


def _rounds_to(fine, coarse, sig):
    """fine を有効数字 sig 桁に丸めると coarse になるか"""
    if fine <= 0 or sig <= 0:
        return False
    e = math.floor(math.log10(fine)) - sig + 1
    return abs(round(fine / 10 ** e) * 10 ** e - coarse) <= 1e-9 * max(fine, coarse)


def _near(fa, fb, u):
    """1億以上の金額の丸め（$11.6 billion ↔ $12 billion、53億円 ↔ 約54億円）は食い違いとして拒否しない。
    関所は拒否のある対を同じ核に入れないので、丸め方の違いを「数値の食い違い」とすると同じ契約の報道を
    切り離していた（実例: Bloomberg の「$12 Billion」。2026-09-28）。
    ただし「内閣広報に300億円」↔「310億円」のような似た額の別の予算を結ばないよう、許すのは
    (a) どちらかに「約・超・規模」等の印がある 5%以内の額、(b) 一方が他方を有効数字2桁以上で丸めた額 だけ（検証 2026-09-28 r2）。
    一致の加点はしない（拒否を外すだけ）"""
    if not NEAR_STRICT:
        return any(a >= 1e8 and b >= 1e8 and abs(a - b) <= 0.05 * max(a, b)
                   for a in fa.nums.get(u, ()) for b in fb.nums.get(u, ()))
    for ua, a, sa, pa in fa.money:
        if ua != u or a < 1e8:
            continue
        for ub, b, sb, pb in fb.money:
            if ub != u or b < 1e8 or abs(a - b) > 0.05 * max(a, b):
                continue
            if pa or pb:
                return True
            if (sb >= 2 and sa > sb and _rounds_to(a, b, sb)) or (sa >= 2 and sb > sa and _rounds_to(b, a, sa)):
                return True
    return False


def _num_relation(fa, fb):
    """(一致した単位の数, 食い違い理由 or "")"""
    match, conflict = 0, ""
    for u, va in fa.nums.items():
        vb = fb.nums.get(u)
        if not vb:
            continue
        if va & vb:
            if u not in _UNIT_NOBONUS:
                match += 1
        elif u in ("$", "ドル", "円") and _near(fa, fb, u):
            if not NEAR_STRICT and u not in _UNIT_NOBONUS:
                match += 1
        elif u in _UNIT_VETO and not conflict:
            conflict = "%s:%s≠%s" % (u, sorted(va), sorted(vb))
    return match, conflict


class _Ctx:
    """束ねる集合の中での珍しさ（df）と、その重みの控え。"""

    def __init__(self, df=None, n_docs=0, cdf=None):
        self.df = df or {}
        self.cdf = cdf                       # 概念の df（束ねる集合の中で）。None なら全て珍しい扱い
        self.N = max(n_docs, 1)
        self.on = bool(df)
        self.lnN = math.log(1.0 + self.N)
        self._w = {}
        self._tot = {}

    def w(self, g):
        v = self._w.get(g)
        if v is None:
            v = math.log(1.0 + self.N / self.df.get(g, 1)) if self.on else 1.0
            self._w[g] = v
        return v

    def rare_concept(self, c):
        """背景になっていない概念か（束の1%以下・最低3件まで）"""
        if not self.cdf:
            return True
        return self.cdf.get(c, 0) <= max(3, 0.01 * self.N)

    def tot(self, f):
        # 控えの鍵は Feat そのもの（id(f) だと、捨てられた Feat の id が別の見出しに再利用されて
        # 古い合計を返していた。検証 2026-09-27: 8スレッドで similarity が3通りの値を返した）
        v = self._tot.get(f)
        if v is None:
            v = math.fsum(self.w(g) for g in f.grams)       # fsum: 足す順（集合の順 = PYTHONHASHSEED）に依らない
            self._tot[f] = v
        return v


def _sim_feat(fa, fb, df=None, n_docs=0, ctx=None, why=True):
    """(score, veto, why)。df は束ねる集合の中での出現数（珍しいほど重い）"""
    match, conflict = _num_relation(fa, fb)
    if conflict:
        return 0.0, True, ("数値の食い違い " + conflict) if why else ""
    if fa.lang == fb.lang:
        pc = _place_conflict(fa, fb)
        if pc:
            return 0.0, True, ("地名の食い違い " + pc) if why else ""
        op = _opposite(fa, fb)
        if op:
            return 0.0, True, op if why else ""
    if ctx is None:
        ctx = _Ctx(df, n_docs)               # 呼ぶたびに新しく（共有の控えはスレッドと id の再利用で壊れる）
    df, n_docs = ctx.df, (ctx.N if ctx.on else 0)
    if fa.lang == fb.lang:
        inter = fa.grams & fb.grams
        j = cover = 0.0
        if inter:
            si = math.fsum(ctx.w(g) for g in inter)
            ta, tb = ctx.tot(fa), ctx.tot(fb)
            su = ta + tb - si
            j = si / su if su > 0 else 0.0
            # 覆い率: 共有する珍しい bigram の重みが、短い方の見出しの重みの何割か（長さの差に強い）
            if ctx.on:
                mass = si / ctx.lnN
                small = min(ta, tb) / ctx.lnN
                if mass >= (ANCHOR_MASS if fa.lang == "ja" else ANCHOR_MASS_EN) and small:
                    cover = mass / small
        shared = fa.ents & fb.ents
        rare = 0.0
        for e in shared:
            d = df.get(e, 1) if ctx.on else 1
            if n_docs and d > max(2, 0.005 * n_docs):     # 束の0.5%超に出る語は背景
                continue
            rare += 1.0 if len(e) >= 3 else 0.5
        strong = {c for c in (fa.concepts & fb.concepts) - _WEAK_CONCEPTS if ctx.rare_concept(c)}
        s = max(j, COVER_W * cover) + 0.06 * min(rare, 3) + 0.05 * min(len(strong), 2) + 0.12 * min(match, 2)
        if fa.lang == "en":
            s -= EN_PENALTY          # 英語の見出しは語頭が大文字で固有名詞の加点が甘くなるため
        return s, False, ("j=%.2f cover=%.2f rare=%.1f strong=%d num=%d" % (j, cover, rare, len(strong), match)) if why else ""
    # 日英の間: 国・大統領・首脳会談のような背景の概念を除いた「強い概念」が2つ、または
    #          強い概念1つ＋(共有3概念以上 / 数値の一致 / 米日中以外の特定の国・地域の一致)
    shared = fa.concepts & fb.concepts
    strong = shared - _WEAK_CONCEPTS
    place = (shared & _GEO) - {"US", "JP", "CN"}           # 米日中以外の特定の国・地域
    if (len(strong) >= 2 or (len(strong) >= 1 and len(shared) >= 3) or (len(strong) >= 1 and match)
            or (len(strong) >= 1 and place)):
        s = 0.36 + 0.1 * (len(strong) - 1) + 0.04 * len(shared - strong) + 0.12 * min(match, 2)
        return s, False, ("xlang strong=%s weak=%s num=%d" % (sorted(strong), sorted(shared - strong), match)) if why else ""
    return 0.0, False, ("xlang 概念不足 %s" % sorted(shared)) if why else ""


def similarity(a, b, source_a="", source_b=""):
    """見出し2本の比較（試験・調整用）。a, b は str か item。"""
    ta = a.get("title", "") if isinstance(a, dict) else a
    tb = b.get("title", "") if isinstance(b, dict) else b
    sa = source_a or (a.get("source", "") if isinstance(a, dict) else "")
    sb = source_b or (b.get("source", "") if isinstance(b, dict) else "")
    return _sim_feat(Feat(ta, sa), Feat(tb, sb))


# ================================================================ 事件単位の関所（検証 2026-09-28 追加）
# 単連結は「話題」で繋がる。実測: 「ゼレンスキー氏、ウクライナ復興へ投資呼びかけ」が、人名（ゼレンスキー）と
# 国だけの日英の結合で BBC の「データセンター攻撃」へ、そこから Google の「ロシアの攻撃」の束へ繋がり、
# 17媒体の束になっていた（Al Jazeera「At least 10 people killed…」等）。
# 束を組み立てる直前に、単連結で繋がった群の見出しを対で比べ直し、事件ごとに切り直す:
#   1. 同じ記事・同じ見出しを一つの単位に畳む
#   2. 対の類似。話題の印（人名・国名）しか共有しない対は似ていないとみなす
#      （同じ言語: 印を除いた類似が GATE_RES_FLOOR 未満ならそれで測る / 日英: 人名だけの一致は GATE_XPERSON。
#       ただし数値・日付・人物の地元以外の国・珍しい英字の語が一致する日英の対は除く＝_xanchor）
#   3. 平均連結で核（2単位以上）を作る（GATE_SEED）。核どうしは平均 GATE_MERGE 以上で束ね直す。
#      同じ Google の束の構成員を分け持つ核どうしは GATE_MERGE_GN 以上で束ね直す。
#      平均は同じ言語の対で測り（無い時だけ日英の対）、拒否の対が GATE_VETO_FRAC を超える塊どうしは結ばない
#   4. 核に入らなかった単位は、最も似た核の一本（核に同じ言語の単位があればその中で）との類似が GATE_FLOAT 以上なら
#      核へ付け、そうでなければ一本立ち
#   5. 核が一つも無い群は、Google の束（節点）ごとに残し、節点を跨いでは結ばない
# 値の決め方は上の GATE_* の註。

_PERSONS = {"XI", "TAKAICHI", "PUTIN", "ZELENSKY", "NETANYAHU", "TRUMP", "POPE"}
_TOPIC_KEYS = None


def _topic_keys():
    """話題の印（人名・国名）の鍵。日本語は2字以上の鍵、英語は語"""
    global _TOPIC_KEYS
    if _TOPIC_KEYS is None:
        ja, en = [], set()
        for c in sorted(_PERSONS | _GEO):
            for k in _CONCEPTS.get(c, []):
                if re.fullmatch(r"[a-z0-9 .'-]+", k):
                    en.update(k.split())
                elif len(k) >= 2:
                    ja.append(k)
        _TOPIC_KEYS = (tuple(ja), frozenset(en))
    return _TOPIC_KEYS


def _residue(f):
    """話題の印（人名・国名）の bigram・語・固有名・概念を除いた写し。事件の中身だけで比べるため"""
    ja, en = _topic_keys()
    r = object.__new__(Feat)
    for k in Feat.__slots__:
        if k != "__weakref__":
            setattr(r, k, getattr(f, k))
    if f.lang == "ja":
        low = f.norm.lower()
        drop = {k[i:i + 2] for k in ja if k in low for i in range(len(k) - 1)}
        r.grams = {g for g in f.grams if g not in drop}
    else:
        r.grams = {g for g in f.grams if g not in en}
    r.words = {w for w in f.words if w not in en}
    r.ents = {e for e in f.ents if e not in en and not any(k in e for k in ja)}
    r.concepts = f.concepts - _PERSONS - _GEO
    return r


# 人物の「地元」の国。人名と地元の国しか共有しない日英の対は話題の一致にすぎない（ゼレンスキー＋ウクライナ）
_PERSON_HOME = {"ZELENSKY": {"UA", "RU"}, "PUTIN": {"RU", "UA"}, "XI": {"CN", "TW", "US"},
                "TAKAICHI": {"JP", "CN", "US"}, "TRUMP": {"US"}, "NETANYAHU": {"IL", "IR"}, "POPE": set()}


def _xanchor(fa, fb, ctx=None):
    """日英の対で、人名のほかに事件を特定する一致があるか（検証 2026-09-28 r2）:
    日付・数値の一致、人物の地元以外の特定の国（米日中を除く）、珍しい英字の語（日本語の見出しの中の OpenAI 等）"""
    if fa.nums.get("date") and fb.nums.get("date") and fa.nums["date"] & fb.nums["date"]:
        return True
    if _num_relation(fa, fb)[0]:
        return True
    shared = fa.concepts & fb.concepts
    home = set().union(*[_PERSON_HOME.get(p, set()) for p in shared & _PERSONS])
    if (shared & _GEO) - {"US", "JP", "CN"} - home:
        return True
    _, en = _topic_keys()
    n = ctx.N if ctx is not None and ctx.on else 0
    for w in fa.words & fb.words:
        if len(w) >= 3 and w not in en and w not in _EN_STOP and not w.isdigit():
            if not n or ctx.df.get(w, 1) <= max(3, 0.01 * n):
                return True
    return False


def _person_only(fa, fb, ctx=None):
    """日英の間で、共有する強い概念が人名だけ（数値の一致も無い）か。GATE_XANCHOR なら錨のある対は除く"""
    if fa.lang == fb.lang:
        return False
    strong = (fa.concepts & fb.concepts) - _WEAK_CONCEPTS
    if not (bool(strong) and strong <= _PERSONS and not _num_relation(fa, fb)[0]):
        return False
    return not (GATE_XANCHOR and _xanchor(fa, fb, ctx))


def _gate_sim(fa, fb, ra, rb, ctx):
    """関所で使う対の類似 -> (score, veto)"""
    s, v, _ = _sim_feat(fa, fb, ctx=ctx)
    if v:
        return 0.0, True
    if fa.lang != fb.lang:
        if _person_only(fa, fb, ctx):
            s = min(s, GATE_XPERSON)
    elif GATE_RES_FLOOR:
        sr = _sim_feat(ra, rb, ctx=ctx)[0]
        if sr < GATE_RES_FLOOR:
            s = min(s, sr)
    return s, False


def _units(members, feats):
    """同じ記事（id）・同じ見出し（比較用に正規化した物）を一つの単位に畳む -> [[members の番号]]"""
    uf = list(range(len(members)))

    def f(x):
        while uf[x] != x:
            uf[x] = uf[uf[x]]
            x = uf[x]
        return x
    first = {}
    for k, (m, ft) in enumerate(zip(members, feats)):
        for key in (("id", m.get("id")), ("t", re.sub(r"\s+", "", ft.norm.lower()))):
            if key[1]:
                if key in first:
                    uf[f(k)] = f(first[key])
                else:
                    first[key] = k
    groups = {}
    for k in range(len(members)):
        groups.setdefault(f(k), []).append(k)
    return list(groups.values())


def _blocked(nv, npairs):
    """塊どうしの拒否の対の数から、結ばないか。GATE_VETO_FRAC 0 なら1対でも拒否があれば結ばない。
    1本の見出しの思わぬ数字（「10月8日までの雨風シミュレーション」）で大きな束が割れていた（検証 2026-09-28 r2）"""
    if not nv:
        return False
    return nv > GATE_VETO_FRAC * npairs if GATE_VETO_FRAC else True


def _avg_link(parts, S, V, thr, L=None, N=None, thr_gn=None):
    """平均連結。拒否が多すぎず平均の類似が thr 以上の塊の対を、似た順に一つにする（同点は番号の小さい対）。
    L（単位の言語）があれば、平均は同じ言語の対で測り、同じ言語の対が無い時だけ日英の対で測る
    （日英の類似は概念の表だけで測る粗い物なので、混ぜると同じ言語の強い一致が薄まっていた。検証 2026-09-28 r2）。
    N（単位の節点の集合）と thr_gn があれば、同じ Google の束の構成員を分け持つ塊どうしは thr_gn で結ぶ"""
    cl = [list(p) for p in parts]
    n = len(cl)
    ts = [[0.0] * n for _ in range(n)]      # 同じ言語の対の類似の和
    cs = [[0] * n for _ in range(n)]        # 同じ言語の対の数
    tx = [[0.0] * n for _ in range(n)]      # 日英の対
    cx = [[0] * n for _ in range(n)]
    nv = [[0] * n for _ in range(n)]        # 拒否の対の数
    cn = [set().union(*[N[a] for a in c]) for c in cl] if N is not None else None
    for i in range(n):
        for j in range(i + 1, n):
            a1 = a2 = 0.0
            b1 = b2 = v = 0
            for a in cl[i]:
                for c in cl[j]:
                    if L is not None and L[a] != L[c]:
                        a2 += S[a][c]
                        b2 += 1
                    else:
                        a1 += S[a][c]
                        b1 += 1
                    v += V[a][c]
            ts[i][j] = ts[j][i] = a1
            cs[i][j] = cs[j][i] = b1
            tx[i][j] = tx[j][i] = a2
            cx[i][j] = cx[j][i] = b2
            nv[i][j] = nv[j][i] = v
    alive = list(range(n))
    while True:
        best, bi, bj = None, -1, -1
        for x in range(len(alive)):
            i = alive[x]
            for y in range(x + 1, len(alive)):
                j = alive[y]
                npairs = cs[i][j] + cx[i][j]
                if _blocked(nv[i][j], npairs):
                    continue
                if L is not None and GATE_LANG and cs[i][j]:
                    avg = ts[i][j] / cs[i][j]
                else:
                    avg = (ts[i][j] + tx[i][j]) / npairs
                t = thr_gn if (thr_gn is not None and cn is not None and cn[i] & cn[j]) else thr
                if avg >= t and (best is None or avg > best):
                    best, bi, bj = avg, i, j
        if bi < 0:
            return [cl[i] for i in alive]
        cl[bi] = cl[bi] + cl[bj]
        if cn is not None:
            cn[bi] = cn[bi] | cn[bj]
        alive.remove(bj)
        for k in alive:
            if k != bi:
                for M in (ts, cs, tx, cx, nv):
                    M[bi][k] = M[k][bi] = M[bi][k] + M[bj][k]


def _gate(mems, feats, nids, ctx):
    """一つの群（単連結で繋がった見出し）を事件ごとの塊へ切り直す -> [[member]]。nids は各 member の節点の番号"""
    units = _units(mems, feats)
    U = len(units)
    if U == 1:
        return [list(mems)]
    fs = [feats[u[0]] for u in units]
    rs = [_residue(f) for f in fs] if GATE_RES_FLOOR else fs
    unodes = [{nids[k] for k in u} for u in units]
    L = [f.lang for f in fs]
    S = [[0.0] * U for _ in range(U)]
    V = [[False] * U for _ in range(U)]
    for a in range(U):
        for b in range(a + 1, U):
            S[a][b], V[a][b] = _gate_sim(fs[a], fs[b], rs[a], rs[b], ctx)
            S[b][a], V[b][a] = S[a][b], V[a][b]
    cl = _avg_link([[a] for a in range(U)], S, V, GATE_SEED, L)
    seeds = [c for c in cl if len(c) >= 2]
    if not seeds:                                      # 核が無い: Google の束（節点）ごとに残す
        comp = list(range(U))
        for a in range(U):
            for b in range(a + 1, U):
                if not V[a][b] and unodes[a] & unodes[b] and comp[a] != comp[b]:
                    old = comp[b]
                    comp = [comp[a] if c == old else c for c in comp]
        byc = {}
        for u in range(U):
            byc.setdefault(comp[u], []).append(u)
        return [[mems[k] for u in us for k in units[u]] for us in byc.values()]
    if len(seeds) >= 2:
        seeds = _avg_link(seeds, S, V, GATE_MERGE, L, unodes, GATE_MERGE_GN)
    parts = [list(c) for c in seeds]
    lone = []
    for u in (c[0] for c in cl if len(c) == 1):
        best, bi = None, -1
        for i, c in enumerate(seeds):
            if _blocked(sum(V[u][x] for x in c), len(c)):
                continue
            same = [x for x in c if L[x] == L[u]] if GATE_LANG else []
            sc = max(S[u][x] for x in (same or c))
            if best is None or sc > best:
                best, bi = sc, i
        if bi >= 0 and best >= GATE_FLOAT:
            parts[bi].append(u)
        else:
            lone.append(u)
    return [[mems[k] for u in p for k in units[u]] for p in parts] + [[mems[k] for k in units[u]] for u in lone]


# ================================================================ 束ね

def _mk_member(item, title, source, link, via):
    it = {"title": title, "link": link or "", "source": source,
          "feed": item.get("feed", ""), "cat": item.get("cat", ""), "lang": item.get("lang", ""),
          "tier": item.get("tier", ""), "ts": None, "summary": "", "via": via}
    it["id"] = make_id(link) if link else hashlib.sha1(
        ("nolink:%s|%s" % (source, title)).encode("utf-8", "surrogatepass")).hexdigest()[:16]
    return it


def _prep(it):
    """item -> (正規媒体名, 型, 転載か)。転載は元媒体に寄せる"""
    src, link = it.get("source", "") or it.get("feed", ""), it.get("link", "")
    src = src if isinstance(src, str) else ""
    link = link if isinstance(link, str) else ""
    name, ty = canon_source(src, link)
    if ty == AGG or is_aggregator(src, link):
        o = origin_of(it.get("title", ""), src, link)
        if o:
            oname, oty = canon_source(o)
            return oname, (oty if oty != AGG else oname), False
        return (_nf(src) or name), AGG, True
    return name, ty, False


class _UF:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, x):
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x


def cluster(items, threshold=DEFAULT_T, max_df_frac=0.08, max_gap_h=MAX_GAP_H, explain=False):
    """items（feeds.py の形 + id。Google News は gn_members 付き）-> clusters（n_sources の多い順）。
    同じ事件を二つに分ける方を、別事件を一つにするより選ぶ。"""
    # 壊れた入力（None・dict 以外・見出しが str でない物）は捨てる。見出しは書き換えない
    items = [dict(it) for it in (items or []) if isinstance(it, dict)
             and isinstance(it.get("title"), str) and it["title"].strip()]
    for it in items:
        if not (isinstance(it.get("id"), str) and it["id"]):
            lk = it.get("link")
            it["id"] = make_id(lk) if isinstance(lk, str) and lk.strip() else hashlib.sha1(
                ("nolink:%s|%s" % (it.get("source", ""), it["title"])).encode("utf-8", "surrogatepass")).hexdigest()[:16]
    # ---- 節点: 一つの item（Google News なら骨格ごと）が一つの節点
    nodes = []        # {"lead": item, "members":[item], "feats":[Feat], "lead_feat": Feat}
    for it in items:
        mem = [it]
        gm = gn_members(it)
        for g in gm:
            mem.append(_mk_member(it, g["title"], g.get("source", ""), g.get("link", ""), "gn"))
        feats = [Feat(m["title"], m.get("source", "")) for m in mem]
        nodes.append({"lead": it, "members": mem, "feats": feats, "gn": bool(gm)})
    n = len(nodes)
    # ---- 珍しさ（固有名詞の df）と候補の絞り込み（転置索引）
    df = {}
    for nd in nodes:
        seen = set()
        for f in nd["feats"]:
            seen |= f.ents | f.grams
        for e in seen:
            df[e] = df.get(e, 0) + 1
    cdf = {}
    for nd in nodes:
        for c in set().union(*[f.concepts for f in nd["feats"]]):
            cdf[c] = cdf.get(c, 0) + 1
    # ---- 骨格の検品: Google の束には、他のどの見出しとも語を共有しない物が紛れる
    #      （例: 群馬の殺人事件の束に「栃木県高校新人 柔道の競技結果」）。それは切り離して一本立ちさせる
    ctx0 = _Ctx(df, len(nodes), cdf)
    detached = []
    for nd in nodes:
        if not nd["gn"] or len(nd["members"]) < 3:
            continue
        keep_m, keep_f = [], []
        for k, (m, f) in enumerate(zip(nd["members"], nd["feats"])):
            if k == 0:
                keep_m.append(m)
                keep_f.append(f)
                continue
            best, judged = 0.0, False
            for k2, f2 in enumerate(nd["feats"]):
                if k2 != k and f2.lang == f.lang and nd["members"][k2]["title"] != m["title"]:
                    judged = True                           # 言語の違う見出ししか無ければ判断しない
                    sc, _, _ = _sim_feat(f, f2, ctx=ctx0)
                    best = max(best, sc)
            if judged and best < GN_FLOOR:
                mm = dict(m)
                mm["via"] = "gn-detached"
                detached.append({"lead": mm, "members": [mm], "feats": [f], "gn": False})
            else:
                keep_m.append(m)
                keep_f.append(f)
        nd["members"], nd["feats"] = keep_m, keep_f
    nodes.extend(detached)
    n = len(nodes)
    index = {}
    for i, nd in enumerate(nodes):
        keys = set()
        for f in nd["feats"]:
            keys |= {("g", g) for g in f.grams if len(g) == 2 or f.lang == "en"}   # 日本語は bigram・英語は語
            keys |= {("c", c) for c in f.concepts - _WEAK_CONCEPTS}
            keys |= {("id", nd["lead"]["id"])}
            keys |= {("l", m["id"]) for m in nd["members"] if m.get("link")}
        for k in keys:
            index.setdefault(k, []).append(i)
    cap = max(CAND_MIN, int(max_df_frac * n))
    # 2026-10-04 memory-fix: 全ての候補の対を一つの dict（cand）に溜めると、件数の二乗で膨らむ
    # （9/30 の 48 時間窓 17,505 件で cand 1,071 万対・約 893 MB、memo 282 万件・約 794 MB）。
    # 鍵ごとの重みだけを控え、節点ごとに共有する鍵を数えてその場で評価する。出力は元と同じ（sha1 で照合済み）
    inc_of = {}
    for k, lst in index.items():
        if len(lst) < 2:
            continue
        if k[0] in ("id", "l"):                            # 同じ記事（同じ link）は同じ事件
            inc_of[k] = 99
        elif len(lst) > cap:
            continue
        else:
            inc_of[k] = 2 if k[0] == "c" else 1            # 日英は共有概念1つで候補に入れる
    keys_of = [[] for _ in range(n)]
    for k in inc_of:
        for i in index[k]:
            keys_of[i].append(k)
    ctx = _Ctx(df, n, cdf)
    memo = {}
    _VETO = (0.0, True, "")
    _MISS = object()

    def lead_sim(x, y):
        # memo の鍵は整数（x*n+y）、値は score だけ（veto は None）。理由の文字列は explain の時だけ作って控える
        key = x * n + y if x < y else y * n + x
        r = memo.get(key, _MISS)
        if r is _MISS:
            s_, v_, w_ = _sim_feat(nodes[x]["feats"][0], nodes[y]["feats"][0], ctx=ctx, why=explain)
            if explain:
                memo[key] = (s_, v_, w_)
            else:
                memo[key] = None if v_ else s_
            return s_, v_, w_
        if explain:
            return r
        return _VETO if r is None else (r, False, "")

    def _cands():
        """節点 a ごとに、a より後ろの節点との共有鍵の重みを数えて (a, b, c) を出す（全対の dict を作らない）"""
        for a in range(n):
            cnt = {}
            for k in keys_of[a]:
                inc = inc_of[k]
                for b in index[k]:
                    if b > a:
                        cnt[b] = cnt.get(b, 0) + inc
            for b, c in cnt.items():
                yield a, b, c
    # ---- 対の類似
    edges, veto = [], set()
    for a, b, c in _cands():
        if c >= 99:
            edges.append((9.0, a, b, "同じ記事"))
            continue
        if c < 2:                                          # 珍しい bigram を2つ以上共有しない対は見ない
            continue
        na, nb = nodes[a], nodes[b]
        ta, tb = _tsf(na["lead"].get("ts")), _tsf(nb["lead"].get("ts"))
        if max_gap_h and ta and tb and abs(ta - tb) > max_gap_h * 3600:
            continue                                       # 日を隔てた似た見出しは別の出来事として扱う
        best, why, vt = 0.0, "", False
        s0, v0, w0 = lead_sim(a, b)
        if v0:
            veto.add((a, b))
            continue
        best, why = s0, w0
        if na["gn"] or nb["gn"]:                           # 骨格の中の別の見出しとも比べる
            for fa in na["feats"]:
                for fb in nb["feats"]:
                    s, v, w = _sim_feat(fa, fb, ctx=ctx, why=explain)
                    if not v and s > best:
                        best, why = s, w
        if best >= threshold:
            edges.append((best, a, b, why))
    edges.sort(key=lambda e: (-e[0], e[1], e[2]))            # 同点は節点の番号で（PYTHONHASHSEED に依らない）
    uf = _UF(n)
    groups = {i: [i] for i in range(n)}
    why_log = []
    for s, a, b, why in edges:
        ra, rb = uf.find(a), uf.find(b)
        if ra == rb:
            continue
        ga, gb = groups[ra], groups[rb]
        ok, tot, cnt = True, 0.0, 0
        for x in ga:
            for y in gb:
                key = (x, y) if x < y else (y, x)
                if key in veto:
                    ok = False
                    break
                sx, vx, _ = lead_sim(x, y)
                if vx:
                    ok = False
                    break
                tot += sx
                cnt += 1
            if not ok:
                break
        if not ok or (s < 9.0 and cnt and tot / cnt < threshold * 0.5):
            continue
        uf.p[rb] = ra
        groups[ra] = ga + gb
        del groups[rb]
        if explain:
            why_log.append((s, a, b, why))
    del keys_of, inc_of, index, memo, veto, edges          # 2026-10-04 memory-fix: _assemble の前に手放す
    out = _assemble(nodes, groups, ctx)
    if explain:
        return out, why_log, nodes
    return out


def _assemble(nodes, groups, ctx):
    """群（根 -> 節点の番号の list）-> 束の list（n_sources の多い順）。関所で事件ごとに切り直してから組み立てる"""
    parts = []
    lead_ts = {}                     # member（の dict の id）-> その節点の先頭の時刻。Google の束の構成員は時刻を持たない
    for idxs in groups.values():
        mems = [m for i in idxs for m in nodes[i]["members"]]
        for i in idxs:
            t = _tsf(nodes[i]["lead"].get("ts"))
            if t is not None:
                for m in nodes[i]["members"]:
                    lead_ts[id(m)] = t
        if GATE_ON and len(mems) >= 2:
            parts.extend(_gate(mems, [f for i in idxs for f in nodes[i]["feats"]],
                               [i for i in idxs for _ in nodes[i]["members"]], ctx))
        else:
            parts.append(mems)
    out = []
    for mems in parts:
        # 束の時刻: 構成員の時刻。どれも時刻を持たない束（関所が Google の束の構成員だけを切り離した片）は、
        # その Google の束の先頭の時刻で補う（無いと面の並びで最後に回り、床の点群からも落ちた。検証 2026-09-28 r2）
        fb_ts = [lead_ts[id(m)] for m in mems if id(m) in lead_ts]
        cands = []
        for m in mems:
            name, ty, rep = _prep(m)
            cands.append((name, ty, rep, m))
        by_src = {}
        for name, ty, rep, m in cands:                    # 媒体ごとに1本（最古・上位を残す）
            key = name if not rep else "reprint:" + name + ":" + m["id"]
            cur = by_src.get(key)
            if cur is None or _order(m, ty) < _order(cur[3], cur[1]):
                by_src[key] = (name, ty, rep, m)
        members, types, srcs, n_rep = [], set(), set(), 0
        for key, (name, ty, rep, m) in by_src.items():
            m = dict(m)
            m.pop("gn_html", None)                         # 生 HTML は gn_members と重複するので束には載せない
            m["canon_source"], m["source_type"] = name, ty
            m["reprint_unresolved"] = rep
            members.append(m)
            types.add(ty)
            if rep:
                n_rep += 1
            else:
                srcs.add(name)
        # 元媒体の判らない転載は、既に他の媒体があるなら数えない（二重計上を避ける）
        n_sources = len(srcs) if srcs else len({mm["canon_source"] for mm in members})
        members.sort(key=lambda m: _order(m, m["source_type"]))
        rep_item = members[0]
        tss = [v for v in (_tsf(m.get("ts")) for m in members) if v is not None] or fb_ts
        out.append({"cid": "c" + hashlib.sha1("|".join(sorted(m["id"] for m in members)).encode()).hexdigest()[:12],
                    "rep": rep_item, "members": members, "n_sources": n_sources,
                    "types": sorted(types, key=lambda t: (type_rank(t), t)),
                    "first_ts": min(tss) if tss else None, "last_ts": max(tss) if tss else None,
                    "n_reprints": n_rep})
    out.sort(key=lambda c: (-c["n_sources"], -(c["last_ts"] or 0)))
    return out


def _tsf(v):
    """ts を epoch 秒の float へ（feeds.py は epoch か None。ISO 文字列・RFC 822 も読む）。読めなければ None"""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if math.isfinite(v) and v > 0 else None
    if isinstance(v, str) and v.strip():
        s = v.strip()
        try:
            f = float(s)
            return f if math.isfinite(f) and f > 0 else None
        except ValueError:
            pass
        try:
            import datetime
            d = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
            if d.tzinfo is None:
                d = d.replace(tzinfo=datetime.timezone.utc)
            return d.timestamp()
        except (ValueError, OverflowError, OSError):
            pass
        return _ts(s)
    return None


def _order(m, ty):
    t = _tsf(m.get("ts"))
    return (type_rank(ty), t if t is not None else float("inf"), m.get("via") == "gn")
