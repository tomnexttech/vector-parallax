# -*- coding: utf-8 -*-
"""places — which place a story is about, decided from its headlines (stdlib only; CONTRACT 18.6).

The table (data/places.json, 428 keys, 126 of them city/region precision) is public coordinates. The rules:
  - a place mentioned only as a topic is weak and is not used: English "on/over/about/amid/with" objects,
    "対〜" "〜情勢" "〜産" "〜籍", and places listed in an enumeration
  - a place that stands as a location (in/at/near, "で", "西部") is strong; cities and regions come before countries
  - when the headline has none, the places named by at least 20 % of the related member headlines are used
  - a person's name is never used to infer a place; no place is better than a guessed one
  - precision: "local" (city/region) or "country" (a country's representative point)
Every result carries the key it came from (`via`), so the page can show which word placed the story.
"""
import json
import os
import re
import unicodedata

try:
    from parallax import traps
except ImportError:                                   # parallax/ の中から直に走らせた時
    import traps  # type: ignore

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DATA = json.load(open(os.path.join(_ROOT, "data", "places.json"), encoding="utf-8"))
GEO = {k: tuple(v) for k, v in _DATA["geo"].items()}
GEO_LOCAL = set(_DATA["local"])
GEO_PLACE = dict(_DATA["label"])
_GEO_CONTEXT = {k: (re.compile(v["pattern"]), v["place"], (v["lat"], v["lon"])) for k, v in _DATA["context"].items()}

_GEO_NOISE = re.compile(
    # 局名の後ろの地名（テレビ東京・テレビ静岡）も一緒に消す（「テレビ」だけ消して東京を残していた）
    r"[一-龥ぁ-んァ-ヴー]{0,6}(?:新聞|新報|日報|放送|タイムス|タイムズ|テレビ(?:[一-龥]{2,3})?)"
    r"|中国(?:地方|電力|銀行|四国)"
    r"|(?:Japan|China|Korea|Taipei|Moscow|Tehran|Jerusalem|Kyiv|Washington|South China Morning|New York|Los Angeles|"
    r"Seattle|Boston|Chicago|Miami|Houston|Atlanta|Philadelphia|Hong Kong)\s+(?:Times|Daily|Herald|Post|Today|Independent|"
    r"Journal|Tribune|Globe|Inquirer|Chronicle|Sun|News|Free Press)"
    r"|Bank of America|America First|Americas|Georgia Tech|Indiana Jones|Hannah Montana|Kansas City Chiefs"
)
_KATA = "ァ-ヴー"
# 一字の略称（米英仏独露豪）: 漢字に挟まれていない（日米・米価・英語・育英を取らない）、後ろに助詞か国家・機関の語が続く形だけ
_ABBR_NEXT = (r"(?=[でのがはにとへもや、，・）)」』]|$|首相|大統領|政府|政権|軍|国防|国務|外相|外務|議会|上院|下院|連邦|当局|警察|"
              r"司法|紙|メディア|中銀|中央銀行|側|首都|北部|南部|東部|西部|中部|大使|王室|国王|企業|"
              r"財務|商務|通商|検察|裁判所|最高裁|州|国籍|大手)")
_ABBR_NOT = {"米": r"(?!価|粉|作|飯|穀|農|菓|の(?:値|価格|販売|生産|収穫|在庫|作)|が(?:高|安|不足))",
             "英": r"(?!語|雄|才|断|知|字|検|文|訳|会話|単語)",
             "豪": r"(?!雨|華|快|邸|傑|族|語)", "独": r"(?!自|占|立|走|身|特|裁|創|断|禁)",
             "仏": r"(?!教|像|壇|具|閣|様|事)", "露": r"(?!出|店|天|骨|呈|見)"}


def _geo_pattern(name):
    if name in _ABBR_NOT:
        return re.compile(r"(?<![一-龥々])" + name + _ABBR_NOT[name] + _ABBR_NEXT)
    if name in ("US", "USA", "UK", "UAE"):
        return re.compile(r"(?<![A-Za-z.])" + name + r"(?![A-Za-z])")          # 大文字だけ（us・Uk は取らない）
    if name.startswith("京都"):
        return re.compile(r"(?<!東)" + re.escape(name))                         # 東京都市大学 の「京都市」は取らない
    if re.fullmatch(r"[A-Za-z .]+", name):
        # 所有格（Georgia's・Myanmar’s）は取る。後ろに英字が続く語（Americans・Georgian）は取らない
        return re.compile(r"(?<![A-Za-z])" + re.escape(name) + r"(?![A-Za-z])")
    if re.fullmatch("[" + _KATA + "]+", name):
        # 片仮名の短い鍵が長い語の中で当たらないように（タイ→タイミング、インド→インドネシア）
        return re.compile("(?<![" + _KATA + "])" + re.escape(name) + "(?![" + _KATA + "])")
    return re.compile(re.escape(name))


_GEO_KEYS = sorted(GEO, key=len, reverse=True)          # 長い鍵から（North Korea → Korea の順）
_GEO_PAT = {k: _geo_pattern(k) for k in _GEO_KEYS}

# ── 束の地点（2026-09-29 検証の指摘で組み直し）──────────────────────────────
# 見出しの中で「話題として触れただけ」の地名は弱い: 英語は前置詞 on/over/about/amid/as/with… の目的語
# （Kemp suspends Georgia's gas tax as Iran war… の Iran・Backs Trump on Iran の Iran）、日本語は
# 対イラン・イラン情勢・ロシア産・英国籍・台湾有事の形。場所を示す印（in/at/near・「で」「西部」）は強い
_EN_WEAK_PRE = re.compile(r"(?i)\b(?:on|over|about|against|toward|towards|regarding|than|like|vs\.?|versus|with|from|"
                          r"because of|due to)\s+(?:the\s+|a\s+)?$")
# as/amid/despite/after/while の後は、地名が名詞の前に立つ時だけ弱い（as Iran war squeezes… は弱く、as Japan set to… は強い）
_EN_COND_PRE = re.compile(r"(?i)\b(?:as|amid|amidst|despite|after|while|since|during)\s+(?:the\s+)?$")
_EN_TOPIC_NOUN = re.compile(r"(?i)^(?:['’]s)?[\s-]+(?:war|wars|conflict|crisis|sanctions?|tariffs?|policy|deal|talks|trade|"
                            r"imports?|exports?|goods|stocks?|shares|bonds?|markets?|oil|gas|tensions|threat|nuclear|"
                            r"strikes?|attacks?|troops|forces|military|aid|ties|relations|elections?|debt|economy|"
                            r"dollar|yen|yuan|visas?|fears|concerns|standoff|ceasefire|truce)\b")
_EN_WAR_PRE = re.compile(r"(?i)\b(?:war|conflict|fighting|crisis|tensions?|strikes?|attacks?|sanctions?|tariffs?|deal|talks)"
                         r"\s+(?:in|on|with|against|over|for)\s+(?:the\s+)?$")
_EN_LOC_PRE = re.compile(r"(?i)\b(?:in|at|near|inside|across|throughout|outside)\s+(?:the\s+)?$")
_JA_WEAK_PRE = re.compile(r"[対親反脱嫌]$")
_JA_WEAK_POST = re.compile(r"^(?:情勢|戦争|紛争|危機|問題|核|産|製|系|籍|人(?![民口工])|出身|大使|制裁|"
                           r"有事|統一|侵攻|併合|との|風|式|流|料理)")
_JA_LOC_POST = re.compile(r"^(?:で|市|州|県|沖|近海|上空|国内|全土|各地|西部|東部|南部|北部|中部|首都|現地)")
_GN_TAIL = re.compile(r"\s+[-–—|｜]\s+[^-–—|｜]{2,40}$")          # Google ニュースの「 - 媒体名」
# 地名と地名の間がこれだけなら並べ挙げ（「、」は日本語の主語の後にも付くので採らない）
_GEO_ENUM_SEP = re.compile(r"\s*(?:,|・|/|／|&|-|–|and|or|と|や|及び|および)\s*", re.I)


def _cut_tail(text):
    """見出し末尾の「 - 媒体名」「 | 媒体名」を落とす（末尾が本文より短い時だけ）"""
    t = text or ""
    m = _GN_TAIL.search(t)
    return t[:m.start()] if m and m.start() > len(m.group(0)) else t


def _geo_hits(text):
    """文の中の地名 → [{"key","pos","grade","weak","loc"}]（文の中の順）。同じ鍵は一度（強い方）。
    grade 2 = 場所として立つ / 1 = 名詞の前に立つ（US sanctions・Iran war）/ 0 = 話題として触れただけ（weak）"""
    t = _GEO_NOISE.sub(lambda m: " " * len(m.group(0)), traps.fix(_cut_tail(text)))      # 「米中間選挙」は「米国中間選挙」と読む（CONTRACT 20.4）
    spans, raw, found = [], [], {}
    for k in _GEO_KEYS:
        for m in _GEO_PAT[k].finditer(t):
            s, e = m.start(), m.end()
            if any(a < e and s < b for a, b in spans):       # 長い鍵が既に取った範囲は取らない
                continue
            spans.append((s, e))
            raw.append((s, e, k))
    raw.sort()
    # 並べ挙げた地名（Iran, Ukraine and…・US-Canada・米軍・ヨーロッパ）はどれも話題——どれか一つを場所にしない
    enum = set()
    for (s0, e0, k0), (s1, e1, k1) in zip(raw, raw[1:]):
        if _GEO_ENUM_SEP.fullmatch(t[e0:s1]):
            enum.update(((s0, k0), (s1, k1)))
    for s, e, k in raw:
        pre, post = t[max(0, s - 40):s], t[e:e + 8]
        if re.search(r"[A-Za-z]", k):
            attr = bool(_EN_TOPIC_NOUN.match(t[e:e + 16]))
            weak = bool(_EN_WEAK_PRE.search(pre) or _EN_WAR_PRE.search(pre) or (attr and _EN_COND_PRE.search(pre)))
            loc = bool(_EN_LOC_PRE.search(pre))
        else:
            attr = False
            weak = bool(_JA_WEAK_PRE.search(pre) or _JA_WEAK_POST.match(post))
            loc = bool(_JA_LOC_POST.match(post))
        if (s, k) in enum and not loc:
            weak = True
        grade = 0 if weak else 1 if attr else 2
        if not weak and traps.bare_blocked(k, t, loc):         # 「日本」の一語だけでは日本（国内）に置かない
            weak = True
            grade = 0
        h = found.get(k)
        if h is None or grade > h["grade"]:
            found[k] = {"key": k, "pos": s, "grade": grade, "weak": weak, "loc": loc}
    return sorted(found.values(), key=lambda h: h["pos"])


def _geo_of(k, text):
    """鍵 → (札の名, lat, lon, 精度)。同じ綴りで別の場所を指す鍵は文脈で選ぶ。"""
    ctx = _GEO_CONTEXT.get(k)
    if ctx and ctx[0].search(text or ""):
        return ctx[1], ctx[2][0], ctx[2][1], "country"
    lat, lon = GEO[k]
    return GEO_PLACE.get(k, k), lat, lon, ("local" if k in GEO_LOCAL else "country")


_REL_STOP = {"令和", "年度", "告示", "指定", "一部", "改正", "実施", "公表", "掲載", "速報", "独自", "省令", "政令",
             "公示", "通信", "新聞", "共同", "時事", "ニュ", "ュー", "ース", "動画", "写真", "更新", "について"}
_EN_STOP = {"the", "and", "for", "with", "from", "that", "this", "after", "over", "amid", "into", "about", "says",
            "said", "will", "would", "could", "have", "has", "been", "were", "what", "when", "where", "which", "while",
            "their", "they", "them", "than", "more", "most", "news", "latest", "breaking", "video", "live", "update",
            "updates", "report", "reports", "week", "year", "years", "today", "just", "also", "still", "back", "some"}


def _rel_tokens(t):
    """同じ事件かを見る粗い語の集合（漢字・片仮名の二字組と英語の語幹）"""
    import unicodedata
    t = unicodedata.normalize("NFKC", t or "").lower()
    out = set()
    for run in re.findall(r"[一-龥々ァ-ヴー]{2,}", t):
        out.update(g for g in (run[i:i + 2] for i in range(len(run) - 1)) if g not in _REL_STOP)
    for w in re.findall(r"[a-z][a-z'’-]{3,}", t):
        w = w.strip("'’-")
        if len(w) >= 4 and w not in _EN_STOP:
            out.add(w[:-1] if w.endswith("s") and len(w) > 4 else w)
    return out


def _related(a_tok, b):
    """見出し同士が同じ事件を語っているか（語を二つ以上分け合う）。
    束ねの誤り（別件の官報・警察庁・財務省の告示が一つに入った）から、他人の地名を借りないため"""
    b_tok = _rel_tokens(b)
    s = a_tok & b_tok
    return len(s) >= 2 or (len(s) >= 1 and min(len(a_tok), len(b_tok)) <= 3)


def _locate(c):
    """束の地点を一つの規則で決める（面の柱と場面の札で食い違わないように・2026-09-29 組み直し）。
      1. 束の見出しの、話題として触れただけでない地名。都市・地域を国より先に、同じ精度なら
         同じ事件を報じた構成員の見出しが多く挙げる方、次に場所の印（in・「で」）、次に文の中で先の方
      2. 見出しに無ければ、見出しと語を分け合う構成員（同じ事件）の見出しで最も多く挙がる地名
      3. それも無ければ置かない（話題の地名・人名から場所を推さない——判らないは判らない）
    見出しの中では、名詞の前に立つだけの地名（US sanctions・Iran war）より場所として立つ地名を先に採る"""
    title = c.get("title") or ""
    others, seen = [], {title}
    for m in (c.get("members") or []):
        t = m.get("title") or ""
        if t and t not in seen:
            seen.add(t)
            others.append(t)
    tt = _rel_tokens(title)
    rel = [t for t in others if _related(tt, t)]

    def ident(k, t):
        g = _geo_of(k, t)
        return (g[1], g[2])

    support = {}
    first = {}
    for i, t in enumerate(rel):
        for h in _geo_hits(t):
            if h["weak"]:
                continue
            p = ident(h["key"], t)
            if p not in first or h["grade"] > first[p][2]["grade"]:
                first[p] = (i, h["pos"], h)
            support.setdefault(p, set()).add(i)

    cands = [h for h in _geo_hits(title) if not h["weak"]]
    if cands:
        def rank(h):
            g = _geo_of(h["key"], title)
            return (-h["grade"], 0 if g[3] == "local" else 1, -len(support.get((g[1], g[2]), ())),
                    0 if h["loc"] else 1, h["pos"])
        k, src = min(cands, key=rank)["key"], title
    else:
        # 構成員だけが挙げる地名は、同じ事件の構成員の二割以上が挙げる物だけ（14 本中 1 本の言及で置かない）
        need = max(1, int(round(0.2 * len(rel))))
        ok = [p for p in support if len(support[p]) >= need]
        if not ok:
            return None

        def rank2(p):
            i, pos, h = first[p]
            return (-len(support[p]), -h["grade"], 0 if h["key"] in GEO_LOCAL else 1, 0 if h["loc"] else 1, i, pos)
        p = min(ok, key=rank2)
        k, src = first[p][2]["key"], rel[first[p][0]]
    place, lat, lon, prec = _geo_of(k, src)
    return {"place": place, "lat": lat, "lon": lon, "via": k, "prec": prec}



def locate(title, members=()):
    """title: the headline of the story; members: the headlines of the related members. -> dict or None.
    {"place", "lat", "lon", "via", "prec"}"""
    return _locate({"title": title or "", "members": [{"title": t} for t in members or ()]})
