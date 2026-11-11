# -*- coding: utf-8 -*-
"""coverage — 媒体の比べ（board.cases[sid].coverage。CONTRACT §23）。stdlib だけ・AI は使わない。

一つの出来事を、媒体を横に、内容の点（誰・何・いつ・どこ・数・理由・反応・今後）を縦にして、
各媒体の見出しと要旨（配信用に出している一文。記事の本文は読まない）にその点が出ているかを並べる。

  of(members) -> {"v": 1, "outlets": [...], "rows": [...], "words": [...]} | None

  outlets[i] = {"name", "side": jp|intl|gov, "lang": ja|en, "desc": 要旨がある}
  rows[j]    = {"k": who|what|when|where|num|why|react|next, "t": 行の名前, "c": [セル × 媒体の数]}
               セル = {"p": その媒体の見出し・要旨の中の語句（そのままの一部）, "k": 目立たせる語}
                    | ""   見出しと要旨には出ていない
                    | null 言語が違うので照合していない（語の行だけ。数・時・理由・反応・今後は言語をまたいで見る）
  words[m]   = {"t": 組の名前, "v": [{"w": 実際に使われた語, "o": [その語を使った媒体の番号]}]}   同じ事を指す語の選び方の違い

守る線（CONTRACT §23）: 材料は見出しと要旨だけ。語句は見出し・要旨の一部をそのまま（句読点の切れ目で切る）。
出ていないことは「見出しと要旨には出ていない」という事実だけで、報じなかった・隠した・意図は書かない。数は書かれた通りの表記で、
作らない・足さない・丸めない。語の表は data/coverage.json にあり、そこに無い語は行にならない。失敗した時は None（欄を付けない）。
"""
import json
import re
import unicodedata
from collections import OrderedDict
from pathlib import Path

try:
    from parallax import places as _places
except ImportError:                                   # parallax/ の中から直に走らせた時
    import places as _places  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
VERSION = 1
MAX_COLS = 14        # 列にする媒体の数
MAX_ROWS = 12        # 行の数
MAX_WORDS = 4        # 言い方の違いの組
PHRASE = 30          # セルの語句の長さ（字）
MIN_OUTLETS = 2
KINDS = ("who", "what", "when", "where", "num", "why", "react", "next")
SIDE_ORDER = {"jp": 0, "intl": 1, "gov": 2}
GOV = "政府一次"

LEX = json.load(open(ROOT / "data" / "coverage.json", encoding="utf-8"))


def _words(s, phrases=False):
    """空白で区切る。英語の言い回し（phrases=True）は , だけで区切る（中の空白はそのまま。house arrest は一つの語）"""
    return [w.strip() for w in (s.split(",") if (phrases or "," in s) else s.split()) if w.strip()]


def _alt(ws):
    return "|".join(re.escape(w) for w in sorted(set(ws), key=lambda w: (-len(w), w)))


ROLES = _words(LEX["roles"])
_PRE = _alt(_words(LEX["role_prefix"]))
_ROLE = _alt(ROLES)
RE_ROLE = re.compile(r"(?:%s)?(?:%s)(?![令府選制夫職])" % (_PRE, _ROLE))
RE_NAME_ROLE = re.compile(r"(?:[ァ-ヶー]{2,}(?:・[ァ-ヶー]{2,})*|[一-龥]{2,4})(?:%s)?(?:%s)(?![令府選制夫職])" % (_PRE, _ROLE))
RE_HON = re.compile(r"(?:氏|さん|容疑者|被告|妃|王子|王女|選手|監督|議員|%s)" % _alt(ROLES))
RE_KATA = re.compile(r"[ァ-ヶー]{3,}(?:・[ァ-ヶー]{2,})*")
RE_ORG = re.compile(r"[一-龥ァ-ヶー]{2,8}(?:%s)|(?:政府|当局|議会|警察|検察|裁判所|内閣|上院|下院)" % _alt(_words(LEX["orgs"])))
RE_PREF = re.compile(r"[一-龥]{2,3}県(?:[一-龥]{1,3}[市町村区])?")
EVENTS = _words(LEX["events"])
RE_EVENT = re.compile(_alt(EVENTS))
KATA_STOP = set(_words(LEX["kata_stop"]))
_EN = LEX["en"]
EN_STOP = set(_words(_EN["stop"]))
RE_EN_EVENT = re.compile(r"\b(?:%s)\w*" % _alt(_words(_EN["events"])), re.I)

UNITS = ("人以上|人|名|件|%|円|ドル|ユーロ|元|ポンド|度|キロ|km|メートル|社|票|議席|発|機|隻|棟|戸|か所|カ所|ヵ所|ヶ所|歳|倍|割|回|位|点|校|店|台|頭|両|ポイント")
RE_NUM = re.compile(r"(?:約|およそ|ほぼ|計|最大|少なくとも|のべ|延べ|累計)?(?:\d[\d,]*(?:\.\d+)?\s?(?:万|億|兆|千|百)?|数(?:十|百|千|万|億)?|十数)\s?(?:%s)(?![一-龥ぁ-ん])" % UNITS)
RE_VAGUE = re.compile(r"(?:ほぼ|約|およそ)?(?:半数|過半数|\d分の\d|[二三四五六七八九十]分の[一二三四五六七八九十])")
RE_SHINDO = re.compile(r"震度[0-7][強弱]?|マグニチュード\s?\d(?:\.\d)?|M\s?\d(?:\.\d)?(?![\d\w])")
RE_NUM_EN = re.compile(r"[$€£¥]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|trillion|bn|m)\b)?|\d[\d,]*(?:\.\d+)?\s?(?:percent|per cent|%|million|billion|people|dead|killed|injured|deaths)\b", re.I)
RE_WHEN = re.compile(
    r"\d{1,2}月\d{1,2}日(?:午前|午後)?(?:\d{1,2}時(?:\d{1,2}分)?)?|\d{1,2}日(?!間)(?:午前|午後)?(?:\d{1,2}時(?:\d{1,2}分)?)?"
    r"|(?:午前|午後)\d{1,2}時(?:\d{1,2}分)?|\d{1,2}時\d{1,2}分|\d{1,2}時(?:ごろ|頃|過ぎ)|同日|きょう|今日|昨日|きのう|あす|明日|今月|来月|今週|来週|先週|未明|早朝|深夜")
RE_WHEN_EN = re.compile(r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2}\b|\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b"
                        r"|\b(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b|\b(?:yesterday|today|tonight|overnight)\b", re.I)
CUES = {"why": re.compile(_alt(_words(LEX["why"]))), "react": re.compile(_alt(_words(LEX["react"]))), "next": re.compile(_alt(_words(LEX["next"])))}
CUES_EN = {k: re.compile(r"\b(?:%s)\w*" % _alt(_words(_EN[k])), re.I) for k in ("why", "react", "next")}
LABEL = {"who": "誰", "what": "何", "when": "いつ", "where": "どこ", "num": "数", "why": "理由", "react": "反応", "next": "今後"}
NUM_CLASS = {"人数": ("人", "名", "dead", "killed", "injured", "deaths", "people"), "金額": ("円", "ドル", "ユーロ", "元", "ポンド", "$", "€", "£", "¥"),
             "割合": ("%", "割", "倍", "ポイント", "percent", "per cent", "半数", "分の"), "規模": ("震度", "マグニチュード", "M"), "件数": ()}
_CUT = "。！？!?\n"
_SUB = "、，,;；「」『』（）()"


def _lang(m, text):
    """本文の字で決める（かな・漢字があれば日本語）。feed の言語の印は、字が無い時だけ"""
    if re.search(r"[ぁ-んァ-ヶ一-龥]", text or ""):
        return "ja"
    return m["lang"] if m.get("lang") in ("ja", "en") else "en"


def _clean(t):
    t = unicodedata.normalize("NFKC", t or "")
    t = re.sub(r"^\s*[【\[][^】\]]{0,40}[】\]]\s*", "", t)          # 【11月6日 AFP】 の頭書き
    t = re.sub(r"\s*(?:≫|»|\.{3}|…)+\s*$", "", t)
    return re.sub(r"\s+", " ", t).strip()


def _side(m):
    return "gov" if m.get("type") == GOV else "intl" if m.get("home") == "intl" else "jp"


_PART = "のがをにはでとももへやか、・"


def _snip(text, s, e, bounds, before, after):
    """text[s:e] を含む、bounds の切れ目までの一続き（長ければ前後を切る）。見出し・要旨の一部をそのまま。頭は助詞や句読点の直後で切る（語の途中で始めない）"""
    lo = max([text.rfind(c, 0, s) for c in bounds] + [-1]) + 1
    hi = min([x for x in (text.find(c, e) for c in bounds) if x >= 0] + [len(text)])
    a, b = max(lo, s - before), min(hi, e + after)
    if a > lo and a < s:                                                   # 頭を語の途中で切らない: 窓の中の最初の助詞・読点の直後へ
        for i in range(a, s):
            if text[i - 1] in _PART and text[i] not in _PART:
                a = i
                break
        else:
            a = s if re.match(r"[ぁ-んァ-ヶ一-龥]", text[a:a + 1] or "x") and not re.match(r"\s", text[a - 1:a]) and s - a < 4 else a
    if b - a > PHRASE:
        b = max(e, a + PHRASE)
    out = text[a:b].strip().lstrip(".・…-–— 　)）」』】")
    return ("…" if a > lo else "") + out + ("…" if b < hi else "")


class _Col:
    def __init__(self, name, side):
        self.name, self.side, self.pieces, self.lang, self.desc, self.first = name, side, [], "ja", False, None

    def find(self, term, nocase=False):
        for p in self.pieces:
            i = (p.lower().find(term.lower()) if nocase else p.find(term))
            if i >= 0:
                return p, i, i + len(term)
        return None

    def search(self, rx):
        for p in self.pieces:
            m = rx.search(p)
            if m:
                return p, m
        return None


def _columns(members):
    cols = OrderedDict()
    for m in sorted([x for x in members if isinstance(x, dict)], key=lambda x: (x.get("ts") is None, x.get("ts") or 0, str(x.get("id")))):
        name = m.get("outlet")
        if not isinstance(name, str) or not name.strip():
            continue
        c = cols.get(name)
        if c is None:
            c = cols[name] = _Col(name, _side(m))
            c.first = m.get("ts")
        t, d = _clean(m.get("title")), _clean(m.get("desc"))
        if t:
            c.pieces.append(t)
        if d and d != t:
            c.pieces.append(d)
            c.desc = True
        if not c.pieces:
            continue
        c.lang = _lang(m, " ".join(c.pieces))
    out = [c for c in cols.values() if c.pieces]
    out.sort(key=lambda c: (SIDE_ORDER[c.side], c.first is None, c.first or 0, c.name))
    return out[:MAX_COLS]


# ---------------------------------------------------------------- 語の行（誰・何・どこ）

def _terms_ja(col):
    out = OrderedDict()
    for p in col.pieces:
        for rx, kind in ((RE_NAME_ROLE, "who"), (RE_ORG, "who"), (RE_KATA, "what")):
            for m in rx.finditer(p):
                whole = m.group(0)
                # サンティアゴ・ペニャ は、全体と、中黒で切った各部（ペニャ）の両方を語にする（別の媒体は「ペニャ」とだけ書く）
                for t in ([whole] + [x for x in whole.split("・") if len(x) >= 3] if rx is RE_KATA and "・" in whole else [whole]):
                    if t in KATA_STOP or len(t) < 2 or (rx is RE_KATA and (t in KATA_STOP or _is_place(t))):
                        continue
                    k = "where" if _is_place(t) else kind
                    if rx is RE_KATA and k == "what" and (t is not whole or RE_HON.match(p, m.end())):
                        k = "who" if RE_HON.match(p, m.end()) or t is not whole else k    # カタカナの名前（人）は、敬称・肩書きが後ろに付く
                    out.setdefault(t, k)
        for m in RE_EVENT.finditer(p):
            out.setdefault(m.group(0), "what")
        for m in RE_PREF.finditer(p):
            out.setdefault(m.group(0), "where")
        for k in _GEO_JA:
            if k in p:
                out.setdefault(k, "where")
    return out


def _terms_en(col):
    out = OrderedDict()
    for p in col.pieces:
        low = p.lower()
        for k in _GEO_EN:
            if re.search(r"(?<![A-Za-z])%s(?![A-Za-z])" % re.escape(k), p):
                out.setdefault(k, "where")
        for m in RE_EN_EVENT.finditer(p):
            out.setdefault(m.group(0).lower(), "what")
        words = p.split()
        caps = sum(1 for w in words if w[:1].isupper())
        if len(words) >= 3 and caps / len(words) < 0.6:                     # 題の頭を全部大文字にする書き方では、名前を取らない
            for m in re.finditer(r"(?<![\w.])([A-Z][\w'’\-]+(?:\s+(?:of|de|von|van|bin|the)?\s*[A-Z][\w'’\-]+)*)", p):
                t = re.sub(r"['’]s$", "", m.group(1))
                if m.start() == 0 and t not in _GEO_EN:
                    t = t.split(None, 1)[1] if " " in t else ""
                if t in EN_STOP or len(t) < 4 or low.startswith(t.lower() + " ") and " " not in t:
                    continue
                out.setdefault(t, "where" if t in _GEO_EN else "who")
    return out


_NOT_PLACE = {"日本", "Japan", "国内", "海外"}
_GEO_JA = [k for k in _places.GEO if len(k) >= 2 and k not in _NOT_PLACE and re.search(r"[ぁ-んァ-ヶ一-龥]", k)]
_GEO_EN = [k for k in _places.GEO if k not in _NOT_PLACE and re.fullmatch(r"[A-Za-z .]{4,}", k)]
_GEO_SET = set(_GEO_JA) | set(_GEO_EN)


def _is_place(t):
    return t in _GEO_SET


def _term_rows(cols):
    rows = []
    names = [c.name for c in cols]
    for lang, finder, nocase in (("ja", _terms_ja, False), ("en", _terms_en, True)):
        mine = [i for i, c in enumerate(cols) if c.lang == lang]
        if not mine:
            continue
        cand = OrderedDict()
        for i in mine:
            for t, k in finder(cols[i]).items():
                cand.setdefault(t, k)
        scored = []
        for t, k in cand.items():
            if any(t in n or n in t for n in names):                        # 媒体の名前は語の行にしない
                continue
            cells = [None] * len(cols)
            for i in mine:
                hit = cols[i].find(t, nocase)
                if hit:
                    p, s, e = hit
                    cells[i] = {"p": _snip(p, s, e, _CUT + _SUB, 10, 16), "k": p[s:e]}
                else:
                    cells[i] = ""
            have = [i for i in mine if cells[i]]
            if not have:
                continue
            scored.append({"k": k, "t": t, "c": cells, "have": frozenset(have), "n": len(mine)})
        scored.sort(key=lambda r: (-(1 < len(r["have"]) < r["n"]), -len(r["have"]), -len(r["t"]), r["t"]))
        kept = []
        for r in sorted(scored, key=lambda r: (-len(r["have"]), -len(r["t"]), r["t"])):   # 入れ子の語（ペニャ・ペニャ大統領）は、出している媒体が多い方だけ
            if any(r["t"] in q["t"] or q["t"] in r["t"] for q in kept):
                continue
            kept.append(r)
        kept.sort(key=lambda r: (-(1 < len(r["have"]) < r["n"]), -len(r["have"]), -len(r["t"]), r["t"]))
        cap = {"who": 3, "what": 3, "where": 2}
        n = {}
        for r in kept:
            if r["k"] not in cap:
                continue
            solo = len(r["have"]) == 1
            if solo and (r["n"] < 3 or n.get(r["k"] + "1", 0) >= 1):
                continue                                                    # 一つの媒体にしか無い語は、種類ごとに一つまで
            if n.get(r["k"], 0) >= cap[r["k"]]:
                continue
            n[r["k"]] = n.get(r["k"], 0) + 1
            if solo:
                n[r["k"] + "1"] = 1
            rows.append(r)
    return rows


# ---------------------------------------------------------------- 数・時・理由・反応・今後

def _num_class(expr):
    if re.search(r"震度|マグニチュード|^M", expr):
        return "規模"
    if re.search(r"[$€£¥]|円|ドル|ユーロ|元|ポンド", expr):
        return "金額"
    if re.search(r"%|percent|per cent|割|倍|ポイント|半数|分の", expr):
        return "割合"
    if re.search(r"人|名|dead|killed|injured|deaths|people", expr):
        return "人数"
    return "件数"


def _num_rows(cols):
    by = OrderedDict()
    for i, c in enumerate(cols):
        seen = set()
        for p in c.pieces:
            hits = []
            rxs = (RE_NUM_EN,) if c.lang == "en" else (RE_SHINDO, RE_VAGUE, RE_NUM)
            for rx in rxs:
                hits += [(m.start(), m) for m in rx.finditer(p)]
            for _, m in sorted(hits, key=lambda x: x[0]):
                cls = _num_class(m.group(0))
                if cls in seen:
                    continue
                seen.add(cls)
                by.setdefault(cls, {})[i] = {"p": _snip(p, m.start(), m.end(), _CUT + "、，,", 8, 10), "k": m.group(0)}
    rows = []
    for cls, got in sorted(by.items(), key=lambda kv: -len(kv[1]))[:2]:
        rows.append({"k": "num", "t": "数・" + cls, "c": [got.get(i, "") for i in range(len(cols))], "have": frozenset(got), "n": len(cols)})
    return rows


def _cue_row(cols, kind, rx_ja, rx_en, label=None):
    cells, have = [], set()
    for i, c in enumerate(cols):
        rx = rx_en if c.lang == "en" else rx_ja
        hit = c.search(rx)
        if hit:
            p, m = hit
            cells.append({"p": _snip(p, m.start(), m.end(), _CUT + _SUB, 14, 12), "k": m.group(0)})
            have.add(i)
        else:
            cells.append("")
    if not have:
        return None
    return {"k": kind, "t": label or LABEL[kind], "c": cells, "have": frozenset(have), "n": len(cols)}


def _when_row(cols):
    cells, have = [], set()
    for i, c in enumerate(cols):
        hit = c.search(RE_WHEN_EN if c.lang == "en" else RE_WHEN)
        if hit:
            p, m = hit
            cells.append({"p": _snip(p, m.start(), m.end(), _CUT + "、，,", 2, 10), "k": m.group(0)})
            have.add(i)
        else:
            cells.append("")
    return {"k": "when", "t": LABEL["when"], "c": cells, "have": frozenset(have), "n": len(cols)} if have else None


# ---------------------------------------------------------------- 言い方の違い

def _word_sets(cols):
    out = []
    for s in LEX["sets"]:
        got = OrderedDict()                                                 # 実際に使われた語 -> 媒体の番号
        for i, c in enumerate(cols):
            for grp in (s["en"] if c.lang == "en" else s["ja"]):
                ws = _words(grp, phrases=c.lang == "en")
                rx = re.compile(r"\b(?:%s)\w*" % "|".join(map(re.escape, ws)), re.I) if c.lang == "en" else re.compile(_alt(ws))
                hit = c.search(rx)
                if hit:
                    w = hit[1].group(0).lower() if c.lang == "en" else hit[1].group(0)
                    got.setdefault((grp, w), []).append(i)
        groups = {g for g, _ in got}
        users = {i for v in got.values() for i in v}
        if len(groups) >= 2 and len(users) >= 2:
            vs = sorted(({"w": w, "o": v} for (g, w), v in got.items()), key=lambda x: (-len(x["o"]), x["o"][0]))
            out.append({"t": s["t"], "v": vs[:6]})
    out.sort(key=lambda s: -sum(len(v["o"]) for v in s["v"]))
    return out[:MAX_WORDS]


# ---------------------------------------------------------------- どこが違うか（findings。CONTRACT §23.1）
# 表と言い方の違いを、決まった型の数行に畳む。文の型は下の FIND_TEXT だけで、変えるのは〔〕の所（数えた値・行の名・媒体の名）だけ。
# 守る線は §23 と同じ：見出しと要旨に「出ていない」という事実だけ。報じなかった・隠した・意図は書かない（沈黙の語の検査も掛ける）。

FIND_KINDS = ("only_side", "word_choice", "num_diff", "lead_differs", "first_gap")
FIND_MAX = 5
FIND_CAP = {"only_side": 2, "word_choice": 2, "num_diff": 1, "lead_differs": 1, "first_gap": 1}
FIRST_GAP_S = 3600                # 側どうしの最初の見出しの時刻の差がこれ以上の時だけ
_SJ = {"jp": "国内", "intl": "海外", "gov": "官公庁"}
_MAG = {"billion": "b", "bn": "b", "million": "m", "m": "m", "trillion": "t"}
_NUM_HEAD = re.compile(r"^(?:約|およそ|ほぼ|計|最大|少なくとも|のべ|延べ|累計)\s*")
_SIL = {}


def _silent(text):
    """「報じなかった」系の語を含む文は出さない（CONTRACT §4.7。語は data/prompt.json の silence_words）"""
    if "w" not in _SIL:
        try:
            sw = json.loads((ROOT / "data" / "prompt.json").read_text(encoding="utf-8")).get("silence_words") or {}
        except (OSError, ValueError):
            sw = {}
        _SIL["w"] = [unicodedata.normalize("NFKC", w).lower() for w in (sw.get("ja") or []) + (sw.get("en") or [])]
    t = unicodedata.normalize("NFKC", text).lower()
    return any(w in t for w in _SIL["w"])


def _by_side(cols, idx):
    """[媒体の番号] -> 「国内 3 社・海外 1 社」"""
    n = OrderedDict()
    for i in sorted(idx, key=lambda i: SIDE_ORDER[cols[i].side]):
        n[cols[i].side] = n.get(cols[i].side, 0) + 1
    return "・".join("%s %d 社" % (_SJ[s], k) for s, k in n.items())


def _row_name(r):
    if r["k"] in ("who", "what", "where"):
        return "「%s」" % r["t"]
    if r["k"] == "num" and "・" in r["t"]:
        return r["t"].split("・", 1)[1]
    return "時期" if r["k"] == "when" else r["t"]                      # 表の行の名「いつ」は問いの形なので、文の中では「時期」（js/hero.js の rowName と同じ）


def _num_key(k):
    """数のセルの語 -> (値, 単位)。「約300人」と「300人」は同じ値。比べられない物は None"""
    t = _NUM_HEAD.sub("", unicodedata.normalize("NFKC", k or "").strip()).replace(",", "")
    m = re.match(r"^([$€£¥]?)\s?(\d+(?:\.\d+)?)\s?(万|億|兆|千|百|million|billion|trillion|bn|m)?\s?(.*)$", t, re.I)
    if not m:
        return None
    unit = (m.group(1) + (m.group(4) or "")).strip().lower()
    mag = _MAG.get((m.group(3) or "").lower(), m.group(3) or "")
    return (m.group(2).rstrip("0").rstrip(".") if "." in m.group(2) else m.group(2)) + mag, unit


def _dur(s):
    h, m = divmod(int(round(abs(s) / 60.0)), 60)
    return ("%d 時間 %d 分" % (h, m)) if h and m else ("%d 時間" % h) if h else ("%d 分" % m)


def _findings(cols, rows, words):
    out = {k: [] for k in FIND_KINDS}
    # 片側だけ：一部の媒体にだけ出ている行（側の分かれ目が綺麗な物・数や理由の行・2 社以上が載せた物を先に）
    cand = []
    for j, r in enumerate(rows):
        have = [i for i, c in enumerate(r["c"]) if c]
        none = [i for i, c in enumerate(r["c"]) if c == ""]
        if not have or not none:
            continue
        sh, so = {cols[i].side for i in have}, {cols[i].side for i in none}
        split = len(sh) == 1 and len(so) == 1 and sh != so
        if not (split or len(have) >= 2 or r["k"] in ("num", "why", "react", "next")):
            continue
        score = (3 if split else 0) + (1 if r["k"] in ("num", "why", "react", "next") else 0) + (1 if len(have) >= 2 else 0)
        cand.append((-score, j, r, have, none, sh))
    for _s, _j, r, have, none, sh in sorted(cand, key=lambda x: (x[0], x[1])):
        out["only_side"].append({
            "kind": "only_side", "row": r["k"], "outlets": have, "others": none, "side": next(iter(sh)) if len(sh) == 1 else None,
            "text": "%sは%sが載せ、%sの見出しと要旨には出ていない" % (_row_name(r), _by_side(cols, have), _by_side(cols, none)),
            "evidence": [{"o": i, "p": r["c"][i]["p"], "k": r["c"][i]["k"]} for i in have[:3]]})
    # 言葉の選び方：同じ事を指す語の組（data/coverage.json の sets）で、媒体が別の語を選んだ物
    for w in words:
        v = w["v"]
        if len(v) < 2 or sum(len(x["o"]) for x in v) < 3:
            continue
        ev = []
        for x in v[:2]:
            hit = cols[x["o"][0]].find(x["w"], nocase=True)
            if hit:
                p, s, e = hit
                ev.append({"o": x["o"][0], "p": _snip(p, s, e, _CUT + _SUB, 12, 12), "k": p[s:e]})
        out["word_choice"].append({
            "kind": "word_choice", "row": None, "outlets": list(v[0]["o"]), "others": list(v[1]["o"]), "side": None,
            "text": "%s：%s" % (w["t"], "・".join("「%s」%d 社" % (x["w"], len(x["o"])) for x in v[:3])), "evidence": ev})
    # 数の違い：同じ種類・同じ単位の数で、値が違う物
    for r in rows:
        if r["k"] != "num":
            continue
        vals = OrderedDict()
        for i, c in enumerate(r["c"]):
            if c:
                key = _num_key(c["k"])
                if key:
                    vals.setdefault(key, []).append(i)
        units = {u for (_v, u) in vals}
        if len(vals) < 2 or len(units) != 1:
            continue
        groups = sorted(vals.items(), key=lambda kv: (-len(kv[1]), kv[1][0]))
        a, b = groups[0][1], [i for _k, g in groups[1:] for i in g]
        names = lambda g: "・".join(cols[i].name for i in g[:2]) + (" ほか %d" % (len(g) - 2) if len(g) > 2 else "")
        out["num_diff"].append({
            "kind": "num_diff", "row": "num", "outlets": a, "others": b, "side": None,
            "text": "%sが違う：%s" % (_row_name(r), "・".join("%s（%s）" % (r["c"][g[0]]["k"], names(g)) for _k, g in groups[:3])),
            "evidence": [{"o": g[0], "p": r["c"][g[0]]["p"], "k": r["c"][g[0]]["k"]} for _k, g in groups[:3]]})
    # 見出しの最初の語：側ごとに、見出しが最初に出した大きな語（誰・何・どこの行の語）。同じ言語の側どうしだけ比べる
    terms = [r for r in rows if r["k"] in ("who", "what", "where")]
    lead = {}
    for i, c in enumerate(cols):
        best = None
        for r in terms:
            if r["c"][i] is None or not c.pieces:
                continue
            pos = c.pieces[0].find(r["t"]) if c.lang == "ja" else c.pieces[0].lower().find(r["t"].lower())
            if pos >= 0 and (best is None or pos < best[0]):
                best = (pos, r["t"])
        if best:
            lead.setdefault(c.side, OrderedDict()).setdefault(best[1], []).append(i)
    sides = [s for s in ("jp", "intl", "gov") if s in lead]
    for a_i, sa in enumerate(sides):
        for sb in sides[a_i + 1:]:
            wa = max(lead[sa].items(), key=lambda kv: (len(kv[1]), -kv[1][0]))
            wb = max(lead[sb].items(), key=lambda kv: (len(kv[1]), -kv[1][0]))
            if wa[0] != wb[0] and cols[wa[1][0]].lang == cols[wb[1][0]].lang:
                out["lead_differs"].append({
                    "kind": "lead_differs", "row": None, "outlets": wa[1], "others": wb[1], "side": None,
                    "text": "見出しの最初の語：%sは「%s」・%sは「%s」" % (_SJ[sa], wa[0], _SJ[sb], wb[0]),
                    "evidence": [{"o": wa[1][0], "p": _snip(cols[wa[1][0]].pieces[0], 0, 0, _CUT, 0, 24), "k": wa[0]},
                                 {"o": wb[1][0], "p": _snip(cols[wb[1][0]].pieces[0], 0, 0, _CUT, 0, 24), "k": wb[0]}]})
    # 最初の見出しの時刻の差（集めた見出しの時刻。側ごとの最初）
    first = {}
    for i, c in enumerate(cols):
        if isinstance(c.first, (int, float)) and not isinstance(c.first, bool):
            if c.side not in first or c.first < cols[first[c.side]].first:
                first[c.side] = i
    fs = sorted(first.items(), key=lambda kv: cols[kv[1]].first)
    if len(fs) >= 2:
        (s0, i0), (s1, i1) = fs[0], fs[1]
        gap = cols[i1].first - cols[i0].first
        if gap >= FIRST_GAP_S:
            out["first_gap"].append({
                "kind": "first_gap", "row": None, "outlets": [i0], "others": [i1], "side": s0,
                "text": "%sが%sより %s 早く報じた" % (_SJ[s0], _SJ[s1], _dur(gap)), "evidence": []})
    got = []
    for k in FIND_KINDS:
        got += [f for f in out[k] if not _silent(f["text"])][:FIND_CAP[k]]
    return got[:FIND_MAX]


# ---------------------------------------------------------------- 全体

_NG = {}


def _gated(cov):
    """見出しと要旨の引用に固定語（CONTRACT §17。語は tools/leakcheck.py にあり、ここには書かない）が入る出来事は、表を作らない。読めなければ通す"""
    try:
        if not _NG:
            import importlib.util
            spec = importlib.util.spec_from_file_location("parallax_leakcheck_cov", ROOT / "tools" / "leakcheck.py")
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            _NG["mod"], _NG["pat"] = mod, mod.fixed_patterns()
        return bool(_NG["mod"].scan_text(json.dumps(cov, ensure_ascii=False), _NG["pat"]))
    except Exception:
        return False


def of(members):
    """-> coverage | None（媒体が二つ未満・行が無い・失敗した時は None。呼ぶ側は欄を付けない）"""
    try:
        cov = _of(members)
        return None if cov and _gated(cov) else cov
    except Exception:                                                       # 抽出に失敗しても組み立ては止めない
        return None


def _of(members):
    cols = _columns(members)
    if len(cols) < MIN_OUTLETS:
        return None
    rows = []
    rows += _term_rows(cols)
    rows += [r for r in (_when_row(cols),) if r]
    rows += _num_rows(cols)
    rows += [r for r in (_cue_row(cols, k, CUES[k], CUES_EN[k]) for k in ("why", "react", "next")) if r]
    order = {k: i for i, k in enumerate(KINDS)}
    for r in rows:                                                          # 一部の媒体にだけ出ている行を先に残す
        r["v"] = (2 if 0 < len(r["have"]) < len(cols) else 0) + (1 if len(r["have"]) >= 2 else 0)
    if len(rows) > MAX_ROWS:
        keep = sorted(range(len(rows)), key=lambda i: (-rows[i]["v"], i))[:MAX_ROWS]
        rows = [rows[i] for i in sorted(keep)]
    rows.sort(key=lambda r: order[r["k"]])
    words = _word_sets(cols)
    if len(rows) < 2 and not words:
        return None
    try:
        found = _findings(cols, rows, words)
    except Exception:                                                       # 畳めなくても表は出す
        found = []
    out = {"v": VERSION,
           "outlets": [{"name": c.name, "side": c.side, "lang": c.lang, "desc": bool(c.desc)} for c in cols],
           "rows": [{"k": r["k"], "t": r["t"], "c": r["c"]} for r in rows],
           "words": [{"t": w["t"], "v": w["v"]} for w in words]}
    if found:
        out["findings"] = found
    return out




# ---------------------------------------------------------------- 読み戻し（board.json を読む側。s/<sid>.html の組み立て）

_SIDES = ("jp", "intl", "gov")


def _str(v, n):
    return v.strip()[:n] if isinstance(v, str) else ""


def clean(raw):
    """board.cases[sid].coverage を読む側の検査（js/coverage.js coverageOf と同じ）。形が崩れていれば None。文字は切り詰め、番号は範囲内だけ"""
    try:
        if not isinstance(raw, dict) or raw.get("v") != VERSION:
            return None
        ro = raw.get("outlets") if isinstance(raw.get("outlets"), list) else []
        outlets = [{"name": _str(o.get("name"), 40), "side": o.get("side") if o.get("side") in _SIDES else "jp", "lang": "en" if o.get("lang") == "en" else "ja", "desc": o.get("desc") is True}
                   for o in ro if isinstance(o, dict)]
        if len(outlets) < MIN_OUTLETS or len(outlets) > MAX_COLS or len(outlets) != len(ro) or not all(o["name"] for o in outlets):
            return None
        rows = []
        for r in raw.get("rows") if isinstance(raw.get("rows"), list) else []:
            if not isinstance(r, dict) or r.get("k") not in KINDS:
                continue
            c = r.get("c") if isinstance(r.get("c"), list) else []
            cells = []
            for i in range(len(outlets)):
                x = c[i] if i < len(c) else ""
                if isinstance(x, dict) and _str(x.get("p"), 60):
                    cells.append({"p": _str(x.get("p"), 60), "k": _str(x.get("k"), 40)})
                else:
                    cells.append(None if x is None else "")
            t = _str(r.get("t"), 40)
            if t and any(cells):
                rows.append({"k": r["k"], "t": t, "c": cells})
        words = []
        for w in raw.get("words") if isinstance(raw.get("words"), list) else []:
            if not isinstance(w, dict):
                continue
            vs = []
            for x in w.get("v") if isinstance(w.get("v"), list) else []:
                if isinstance(x, dict) and _str(x.get("w"), 30):
                    o = sorted({i for i in (x.get("o") if isinstance(x.get("o"), list) else []) if isinstance(i, int) and not isinstance(i, bool) and 0 <= i < len(outlets)})
                    if o:
                        vs.append({"w": _str(x.get("w"), 30), "o": o})
            if _str(w.get("t"), 30) and len(vs) >= 2:
                words.append({"t": _str(w.get("t"), 30), "v": vs[:6]})
        rows, words = rows[:14], words[:MAX_WORDS]
        if len(rows) < 2 and not words:
            return None
        return {"outlets": outlets, "rows": rows, "words": words, "findings": clean_findings(raw.get("findings"), len(outlets))}
    except Exception:
        return None


def _idx(v, n):
    return sorted({i for i in (v if isinstance(v, list) else []) if isinstance(i, int) and not isinstance(i, bool) and 0 <= i < n})


def clean_findings(raw, n):
    """findings を読む側の検査（js/coverage.js findingsOf と同じ）。型の外の物・番号の外は落とす。-> list（無ければ []）"""
    out = []
    for f in raw if isinstance(raw, list) else []:
        if not isinstance(f, dict) or f.get("kind") not in FIND_KINDS:
            continue
        text = _str(f.get("text"), 160)
        if not text or _silent(text):
            continue
        ev = []
        for e in f.get("evidence") if isinstance(f.get("evidence"), list) else []:
            if isinstance(e, dict) and isinstance(e.get("o"), int) and not isinstance(e.get("o"), bool) and 0 <= e["o"] < n:
                ev.append({"o": e["o"], "p": _str(e.get("p"), 60), "k": _str(e.get("k"), 40)})
        out.append({"kind": f["kind"], "row": f.get("row") if f.get("row") in KINDS else None,
                    "outlets": _idx(f.get("outlets"), n), "others": _idx(f.get("others"), n),
                    "side": f.get("side") if f.get("side") in _SIDES else None, "text": text, "evidence": ev[:4]})
    return out[:FIND_MAX]


def gaps(row):
    """one row: how many outlets carry it, how many do not (in the row's language), how many were not compared"""
    have = sum(1 for x in row["c"] if x)
    na = sum(1 for x in row["c"] if x is None)
    return have, len(row["c"]) - have - na, na


def lead_rows(cov, n=7):
    """the rows shown first: those that only some outlets carry come before those all or none carry; the original order inside"""
    if len(cov["rows"]) <= n:
        return cov["rows"]
    rank = []
    for i, r in enumerate(cov["rows"]):
        have, none, _ = gaps(r)
        rank.append((-((2 if have > 0 and none > 0 else 0) + (1 if have >= 2 else 0)), i))
    keep = {i for _, i in sorted(rank)[:n]}
    return [r for i, r in enumerate(cov["rows"]) if i in keep]


# ---------------------------------------------------------------- s/<sid>.html の表（script の無い静的な HTML。js/coverage.js と同じ作り）

SIDE_JA = {"jp": "国内", "intl": "海外", "gov": "官公庁"}
KIND_JA = {"who": "誰", "what": "何", "when": "いつ", "where": "どこ", "num": "数", "why": "理由", "react": "反応", "next": "今後"}
TERM_KINDS = ("who", "what", "where")
LEAD_ROWS = 7
FIND_JA = {"only_side": "載せた点", "word_choice": "言葉の選び方", "num_diff": "数", "lead_differs": "見出しの最初の語", "first_gap": "最初の時刻"}


def _unlabel(f):
    """ラベルの下に出す文: ラベルと同じ語で始まる文（見出しの最初の語：…）はその語を落とす。最初の一枚では文だけなので落とさない"""
    lab, t = FIND_JA.get(f.get("kind"), ""), f.get("text") or ""
    return t[len(lab) + 1:] if lab and t.startswith(lab + "：") else t


def _esc(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _mark(text, key):
    i = text.find(key) if key else -1
    if i < 0:
        return _esc(text)
    return "%s<mark>%s</mark>%s" % (_esc(text[:i]), _esc(key), _esc(text[i + len(key):]))


def html_block(cov, heading="媒体の比べ"):
    """cov は clean() を通した物。表（全部の行）と言い方の違いを <section class="cov"> で返す。None なら空の文字"""
    if not cov:
        return ""
    outs = cov["outlets"]
    head = "".join('<th scope="col" data-side="%s"><b>%s</b>%s</th>' % (o["side"], _esc(o["name"]), "" if o["desc"] else "<small>見出しのみ</small>") for o in outs)
    body = []
    for r in cov["rows"]:
        have, none, _ = gaps(r)
        n = have + none
        term = r["k"] in TERM_KINDS
        if r["k"] == "num" and "・" in r["t"]:
            k1, name = r["t"].split("・", 1)
        else:
            k1, name = (KIND_JA[r["k"]] if term else None), r["t"]
        sub = "・".join(x for x in (k1, "%d/%d" % (have, n) if n > 1 else None) if x)
        cells = []
        for c, o in zip(r["c"], outs):
            if c is None:
                cells.append('<td class="na" data-side="%s" title="言語が違うので照合していません"><span class="sr">照合なし</span><span aria-hidden="true">·</span></td>' % o["side"])
            elif c == "":
                cells.append('<td class="off" data-side="%s" title="%s の見出しと要旨には出ていない"><span class="sr">出ていない</span><span aria-hidden="true">—</span></td>' % (o["side"], _esc(o["name"])))
            else:
                cells.append('<td class="on" data-side="%s"%s title="%s"><span class="cv-p">%s</span></td>' % (o["side"], ' lang="en"' if o["lang"] == "en" else "", _esc(o["name"] + ": " + c["p"]), _mark(c["p"], c["k"])))
        body.append('<tr><th scope="row"><span class="cv-l">%s</span>%s</th>%s</tr>' % (_esc(name), "<small>%s</small>" % _esc(sub) if sub else "", "".join(cells)))
    has_na = any(x is None for r in cov["rows"] for x in r["c"])
    lg = '<span class="lg"><span class="on">出ている</span><span class="off">見出しと要旨には出ていない</span>%s</span>' % ('<span class="na">照合なし</span>' if has_na else "")
    out = ['<section class="cov" aria-label="%s"><h2>%s%s</h2>' % (_esc(heading), _esc(heading), lg)]
    if cov.get("findings"):
        out.append('<div class="cv-w cv-f"><h3>違い</h3><ul>%s</ul></div>'
                   % "".join("<li>%s<span>%s</span></li>" % ("" if i and cov["findings"][i - 1]["kind"] == f["kind"] else "<b>%s</b>" % _esc(FIND_JA[f["kind"]]), _esc(_unlabel(f))) for i, f in enumerate(cov["findings"])))
    if cov["rows"]:
        out.append('<div class="cv-sc" role="region" tabindex="0" aria-label="媒体の比べの表（横に流せます）"><table class="cv-t"><thead><tr><th scope="col"><span class="sr">内容の点</span></th>%s</tr></thead><tbody>%s</tbody></table></div>' % (head, "".join(body)))
    if cov["words"]:
        items = []
        for w in cov["words"]:
            chips = []
            for x in w["v"]:
                names = "・".join(outs[i]["name"] for i in x["o"][:3]) + (" ほか %d" % (len(x["o"]) - 3) if len(x["o"]) > 3 else "")
                dots = "".join('<i data-side="%s"></i>' % outs[i]["side"] for i in x["o"][:6])
                chips.append('<span class="cv-x"><span class="cv-wd"%s>%s</span><span class="cv-d" aria-hidden="true">%s</span><small>%s</small></span>' % (' lang="en"' if x["w"].isascii() else "", _esc(x["w"]), dots, _esc(names)))
            items.append("<li><b>%s</b><span class=\"cv-v\">%s</span></li>" % (_esc(w["t"]), "".join(chips)))
        out.append('<div class="cv-w"><h3>言い方の違い</h3><ul>%s</ul></div>' % "".join(items))
    out.append("</section>")
    return "".join(out)
