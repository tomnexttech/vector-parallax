# -*- coding: utf-8 -*-
"""relations — ニュース同士の結び付きと、一つの出来事として束ねた根拠（data/relations.json、CONTRACT §24）。stdlib だけ・AI は使わない。

    python -m parallax.relations [--latest data/latest.json] [--board data/board.json] [--out data/relations.json]

入力は構築が書いた data/latest.json（stories と items）と data/board.json（cases）だけで、外へは取りに行かない。
計算は規則だけ：見出しと要旨の字の 2 文字組（漢字・片仮名の続き）と英語の語の TF-IDF の余弦、見出しの大きな語（keyterms）、
場所（places）、数、data/aliases.json の別名（日英・略称）。日英をまたぐ一致は場所・数・別名だけで拾い、拾えない物は結ばない。

  nodes   2 社以上の出来事と board の cases（MAX_NODES まで）
  edges   各 node から重い順に K 本まで（重複は一本・a < b）。why は一致した語・別名・場所・数・最初の時刻の差・続報か
  groups  w >= GROUP_W の辺でつながる 3 件以上のかたまり（名は付けず、語を並べるだけ）
  same    2 社以上の出来事ごとに、なぜ一つに束ねたか：見出しの対の一致。AI が束ね直した物は、AI が結んだ規則の束の間を規則の目で測り直す
          （一致が無ければ words は [] のまま。AI の判じを補って作らない）
"""
import argparse
import functools
import json
import math
import re
import sys
import time
import unicodedata
from collections import Counter
from pathlib import Path

try:
    from parallax import keyterms as _kt
    from parallax import places as _places
    from parallax import coverage as _cov
except ImportError:                                       # parallax/ の中から直に走らせた時
    import keyterms as _kt  # type: ignore
    import places as _places  # type: ignore
    import coverage as _cov  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = "parallax-relations/1"
K = 5                  # 各 node から出す辺の数
MIN_W = 0.18           # これより弱い結び付きは出さない
GROUP_W = 0.22         # かたまりにする辺の強さ
MAX_NODES = 400
MAX_GROUPS = 12
GROUP_SIDS = 40
MAX_LINKS = 6          # same[sid].links
MAX_PAIRS = 6          # same[sid].ai_joined
MAX_MEMBERS = 24       # 対を測る見出しの数（時刻の順）
MAX_TEXTS = 14
W = {"cos": 0.55, "terms": 0.25, "place": 0.10, "alias": 0.10, "num": 0.05}
METHOD = {"sim": "tfidf-bigram+terms+places", "k": K, "min_w": MIN_W, "ai": False,
          "weights": W, "group_w": GROUP_W}
GOV = "政府一次"

_RUN = re.compile(r"[一-龥々〆ヶァ-ヴー0-9]{2,}")
_EN = re.compile(r"[a-z][a-z0-9'\-]{2,}")
_EN_STOP = {"the", "and", "for", "with", "from", "that", "this", "after", "over", "amid", "into", "about", "says", "said", "will",
            "its", "has", "have", "are", "was", "were", "been", "but", "not", "new", "more", "than", "what", "how", "why", "who",
            "their", "they", "his", "her", "out", "off", "under", "could", "would", "may", "can", "first", "last", "year", "years",
            "week", "day", "days", "news", "live", "update", "updates", "report", "reports", "video", "watch", "amid", "including",
            "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march", "april",
            "june", "july", "august", "september", "october", "november", "december", "department", "secretary", "minister",
            "president", "government", "official", "officials", "alleged", "according", "people", "country", "world", "state",
            "states", "national", "international", "security", "against", "while", "still", "just", "also", "other", "some",
            "says", "told", "make", "made", "take", "back", "big", "top", "plan", "plans", "move", "deal", "talks", "time"}
_RUN_STOP = {"について", "ニュース", "速報", "動画", "写真", "最新", "情報", "記事", "発表", "政府", "日本", "国内", "海外",
             "中継", "解説", "更新", "一覧", "特集", "掲載", "公表", "実施", "開始", "決定", "検討", "方針", "明らか",
             "関係", "関係者", "捜査", "逮捕", "事件", "問題", "対応", "影響", "可能性", "見通し", "会見", "首相", "大統領",
             "政府関係者", "当局", "警察", "容疑", "疑い", "被告", "男性", "女性", "全国", "一部", "今後", "以上", "以降"}
_HEAD = re.compile(r"^\s*[【\[][^】\]]{0,40}[】\]]\s*")


def _norm(t):
    t = unicodedata.normalize("NFKC", t or "")
    return re.sub(r"\s+", " ", _HEAD.sub("", t)).strip()


@functools.lru_cache(maxsize=20000)
def tokens(text):
    """字の 2 文字組（漢字・片仮名・数字の続きの中だけ。数字だけの組は捨てる）と英語の語（w: を付ける）"""
    t = _norm(text).lower()
    out = []
    for run in _RUN.findall(t):
        out += [run[i:i + 2] for i in range(len(run) - 1) if not run[i:i + 2].isdigit()]
    out += ["w:" + w for w in _EN.findall(t) if w not in _EN_STOP]
    return out


@functools.lru_cache(maxsize=20000)
def runs(text):
    """人に見せられる語の候補：漢字・片仮名の続き（2 字以上）と英語の語（4 字以上）"""
    t = _norm(text)
    out = set()
    for r in _RUN.findall(t):
        if len(r) >= 3 and not re.match(r"[0-9]", r) and r not in _RUN_STOP:
            out.add(r)
    for w in re.findall(r"[A-Z][A-Za-z0-9'\-]{3,}", t):
        if w.lower() not in _EN_STOP:
            out.add(w)
    return out


@functools.lru_cache(maxsize=20000)
def terms(title):
    try:
        return [x for x in _kt.key_terms(_norm(title)) if x]
    except Exception:
        return []


@functools.lru_cache(maxsize=20000)
def places_of(text):
    """-> {(lat, lon): 名}。話題として触れただけの地名（weak）は数えない"""
    out = {}
    try:
        for h in _places._geo_hits(_norm(text)):
            if h.get("weak"):
                continue
            name, lat, lon, _p = _places._geo_of(h["key"], text)
            out.setdefault((round(lat, 1), round(lon, 1)), name)
    except Exception:
        pass
    return out


@functools.lru_cache(maxsize=20000)
def nums_of(text):
    """数（単位つき）-> 値の集合。10 未満の整数は一致の根拠にしない（多すぎて何でも結ぶ）"""
    t = _norm(text)
    out = set()
    for rx in (_cov.RE_NUM, _cov.RE_NUM_EN):
        for m in rx.finditer(t):
            k = _cov._num_key(m.group(0))
            if not k:
                continue
            v = k[0]
            digits = re.match(r"\d+(?:\.\d+)?", v)
            if digits and ("." in v or not v.isdigit() or int(digits.group(0)) >= 10):
                out.add(v)
    return out


# ---------------------------------------------------------------- 別名

_AL = {}


def _alias_table(path=None):
    key = str(path or "")
    if key not in _AL:
        p = Path(path) if path else ROOT / "data" / "aliases.json"
        try:
            groups = json.loads(p.read_text(encoding="utf-8")).get("groups") or []
        except (OSError, ValueError):
            groups = []
        rx = []
        for gi, g in enumerate(groups):
            for w in g if isinstance(g, list) else []:
                if not isinstance(w, str) or not w.strip():
                    continue
                if re.fullmatch(r"[ァ-ヴー・]+", w):
                    pat = re.compile(r"(?<![ァ-ヴー])%s(?![ァ-ヴー])" % re.escape(w))
                elif re.fullmatch(r"[\x20-\x7e]+", w):
                    flags = 0 if (w.isupper() and len(w) <= 5) else re.I
                    pat = re.compile(r"(?<![A-Za-z0-9])%s(?![A-Za-z0-9])" % re.escape(w), flags)
                else:
                    pat = re.compile(re.escape(w))
                rx.append((gi, w, pat))
        _AL[key] = rx
    return _AL[key]


_ALC = {}


def aliases_of(text, table=None):
    """-> {group 番号: 見つかった書き方}（一つの group は最初に見つかった書き方だけ）"""
    tab = table if table is not None else _alias_table()
    key = (id(tab), text)
    if key not in _ALC:
        if len(_ALC) > 20000:
            _ALC.clear()
        _ALC[key] = _aliases_of(text, tab)
    return _ALC[key]


def _aliases_of(text, table):
    t = _norm(text)
    out = {}
    for gi, w, pat in table:
        if gi not in out and pat.search(t):
            out[gi] = w
    return out


# ---------------------------------------------------------------- 計算

def _side(it):
    return "gov" if it.get("type") == GOV else "intl" if it.get("home") == "intl" else "jp"


class _Doc:
    __slots__ = ("sid", "tf", "vec", "terms", "tlow", "runs", "places", "nums", "als", "first", "members", "lineage")


def _doc(sid, texts, titles, first, members=(), lineage=(), extra_terms=(), table=None):
    d = _Doc()
    d.sid, d.first, d.members, d.lineage = sid, first, set(members), set(lineage)
    d.tf = Counter(tok for t in texts for tok in tokens(t))
    tc = Counter()
    for i, t in enumerate(titles):
        for x in terms(t):
            tc[x] += 2 if i == 0 else 1
    for x in extra_terms or ():
        if isinstance(x, str) and x:
            tc[x] += 2
    d.terms = [x for x, n in tc.most_common(12) if n >= 2] or [x for x, _n in tc.most_common(3)]
    d.tlow = {x.lower(): x for x in d.terms}
    d.runs = set()
    for t in texts:
        d.runs |= runs(t)
    d.places, d.nums, d.als = {}, set(), {}
    for t in texts:
        for k, v in places_of(t).items():
            d.places.setdefault(k, v)
        d.nums |= nums_of(t)
        for k, v in aliases_of(t, table).items():
            d.als.setdefault(k, v)
    return d


def _vectors(docs, drop_share=0.25):
    """TF-IDF（1+log tf）× idf、長さ 1 に揃える。全体の drop_share を超える node に出る組は語として弱いので捨てる"""
    n = len(docs)
    df = Counter(tok for d in docs for tok in d.tf)
    lim = max(3, int(n * drop_share))
    idf = {tok: math.log((n + 1.0) / (c + 1.0)) + 1.0 for tok, c in df.items() if c <= lim}
    for d in docs:
        v = {tok: (1.0 + math.log(c)) * idf[tok] for tok, c in d.tf.items() if tok in idf}
        s = math.sqrt(sum(x * x for x in v.values())) or 1.0
        d.vec = {tok: x / s for tok, x in v.items()}
    return idf


def _cos(a, b):
    if len(a) > len(b):
        a, b = b, a
    return sum(x * b.get(t, 0.0) for t, x in a.items())


def _ja_first(names):
    names = list(names)
    return sorted(names, key=lambda s: (not re.search(r"[ぁ-んァ-ヶ一-龥]", s), s))


def why_of(a, b, cos=None):
    """二つの文書の一致 -> (w, why)。結ぶ理由が無ければ (0, None)"""
    if cos is None:
        cos = _cos(a.vec, b.vec)
    pl = _ja_first({a.places[k] for k in set(a.places) & set(b.places)})[:3]
    place_words = {x.lower() for k in set(a.places) | set(b.places) for x in (a.places.get(k), b.places.get(k)) if x}
    shared_t = [a.tlow[k] for k in a.tlow if k in b.tlow and k not in place_words and k not in _EN_STOP and a.tlow[k] not in _RUN_STOP]
    words, low = [], set()
    for w in shared_t:
        if w.lower() not in low:
            words.append(w)
            low.add(w.lower())
    n_terms = len(words)
    extra = 0
    for r in sorted(a.runs & b.runs, key=lambda s: (-len(s), s)):
        if len(words) >= 4:
            break
        if r.lower() not in place_words and not any(r.lower() in w.lower() or w.lower() in r.lower() for w in words):
            words.append(r)
            extra += 1
    words = words[:4]
    als = [[a.als[g], b.als[g]] for g in sorted(set(a.als) & set(b.als)) if a.als[g].lower() != b.als[g].lower()][:3]
    nm = sorted(a.nums & b.nums)[:3]
    if not (n_terms or extra >= 2 or len(als) >= 2 or (als and nm) or (pl and nm)):
        return 0.0, None
    union = len(set(a.tlow) | set(b.tlow)) or 1
    w = (W["cos"] * cos + W["terms"] * len(shared_t) / union + (W["place"] if pl else 0) + (W["alias"] if als else 0) + (W["num"] if nm else 0))
    w = round(min(1.0, w), 3)
    dt = None
    if isinstance(a.first, (int, float)) and isinstance(b.first, (int, float)):
        dt = round(abs(a.first - b.first) / 3600.0, 1)
    lin = bool(a.lineage & b.members or b.lineage & a.members)
    return w, {"words": words, "places": pl, "aliases": als, "nums": nm, "dt_h": dt, "lineage": lin}


def _pairs(docs):
    """似ている組の候補：組の索引で余弦を積み、別名・大きな語・数の一致からも候補を足す"""
    post = {}
    for i, d in enumerate(docs):
        for t, x in d.vec.items():
            post.setdefault(t, []).append((i, x))
    dot = {}
    for lst in post.values():
        for p in range(len(lst)):
            i, xi = lst[p]
            for q in range(p + 1, len(lst)):
                j, xj = lst[q]
                k = (i, j) if i < j else (j, i)
                dot[k] = dot.get(k, 0.0) + xi * xj
    for attr in ("als", "tlow", "nums"):
        idx = {}
        for i, d in enumerate(docs):
            for k in getattr(d, attr):
                idx.setdefault(k, []).append(i)
        for lst in idx.values():
            if len(lst) > 40:                                  # どこにでも出る語・数は候補にしない
                continue
            for p in range(len(lst)):
                for q in range(p + 1, len(lst)):
                    dot.setdefault((lst[p], lst[q]), 0.0)
    return dot


def _groups(sids, edges, n_out):
    parent = {s: s for s in sids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for e in edges:
        if e["w"] >= GROUP_W:
            ra, rb = find(e["a"]), find(e["b"])
            if ra != rb:
                parent[ra] = rb
    comp = {}
    for s in sids:
        comp.setdefault(find(s), []).append(s)
    out = []
    for members in comp.values():
        if len(members) < 3:
            continue
        ms = set(members)
        wc = Counter(w for e in edges if e["a"] in ms and e["b"] in ms and e["w"] >= GROUP_W for w in e["why"]["words"])
        members.sort(key=lambda s: (-n_out.get(s, 0), s))
        out.append({"sids": members[:GROUP_SIDS], "n": len(members), "terms": [w for w, _n in wc.most_common(3)]})
    out.sort(key=lambda g: (-g["n"], g["sids"][0]))
    for i, g in enumerate(out[:MAX_GROUPS]):
        g["gid"] = "g%d" % (i + 1)
    return [{"gid": g["gid"], "sids": g["sids"], "n": g["n"], "terms": g["terms"]} for g in out[:MAX_GROUPS]]


def _item_doc(it, idf, table):
    texts = [it.get("title") or ""] + ([it["desc"]] if isinstance(it.get("desc"), str) and it.get("desc") else [])
    d = _doc(it.get("id"), texts, [it.get("title") or ""], it.get("ts"), table=table)
    mx = max(idf.values()) if idf else 1.0
    v = {tok: (1.0 + math.log(c)) * idf.get(tok, mx) for tok, c in d.tf.items()}
    s = math.sqrt(sum(x * x for x in v.values())) or 1.0
    d.vec = {tok: x / s for tok, x in v.items()}
    return d


def _link(da, db):
    _w, why = why_of(da, db)
    sim = round(_cos(da.vec, db.vec), 3)
    dtm = round(abs(da.first - db.first) / 60.0) if isinstance(da.first, (int, float)) and isinstance(db.first, (int, float)) else None
    if why is None:
        why = {"words": [], "places": [], "aliases": [], "nums": []}
    return {"a": da.sid, "b": db.sid, "sim": sim, "words": why["words"], "places": why["places"], "aliases": why["aliases"], "nums": why["nums"], "dt_min": dtm}


def compute(latest, board=None, now=None, aliases_path=None):
    """-> data/relations.json の中身。latest は data/latest.json、board は data/board.json（無くてよい）"""
    t0 = time.time()
    table = _alias_table(aliases_path)
    items = latest.get("items") or {}
    if isinstance(items, list):
        items = {it.get("id"): it for it in items if isinstance(it, dict)}
    stories = [s for s in latest.get("stories") or [] if isinstance(s, dict) and s.get("sid")]
    by_sid = {s["sid"]: s for s in stories}
    cases = (board or {}).get("cases") or {}
    cases = cases if isinstance(cases, dict) else {}
    cand = [s for s in stories if (s.get("n_outlets") or 0) >= 2 or s["sid"] in cases]
    cand.sort(key=lambda s: (-(s.get("n_outlets") or 0), -(s.get("last_ts") or 0), s["sid"]))
    cand = cand[:MAX_NODES]
    docs, nodes, n_out = [], [], {}
    for s in cand:
        ms = sorted([items[i] for i in s.get("member_ids") or [] if i in items], key=lambda it: (it.get("ts") or 0, it.get("id") or ""))
        ai = s.get("ai") if isinstance(s.get("ai"), dict) else {}
        titles = list(dict.fromkeys(m.get("title") for m in ms if m.get("title")))[:MAX_TEXTS]
        texts = titles + [m["desc"] for m in ms if isinstance(m.get("desc"), str) and m["desc"]][:6]
        texts += [x for x in (ai.get("headline_ja"), ai.get("headline_en")) if isinstance(x, str) and x]
        case = cases.get(s["sid"]) or {}
        lineage = [e.get("key") for e in case.get("lineage") or [] if isinstance(e, dict)]
        d = _doc(s["sid"], texts, titles, s.get("first_ts"), [m.get("id") for m in ms], lineage, case.get("key_terms") or (), table)
        docs.append(d)
        sides = {"jp": set(), "intl": set(), "gov": set()}
        for m in ms:
            if m.get("outlet"):
                sides[_side(m)].add(m["outlet"])
        n_out[s["sid"]] = s.get("n_outlets") or 0
        nodes.append({"sid": s["sid"], "cat": case.get("cat") if isinstance(case.get("cat"), str) else None, "n_outlets": n_out[s["sid"]],
                      "sides": {k: len(v) for k, v in sides.items()}, "terms": d.terms[:4], "first_ts": s.get("first_ts"), "last_ts": s.get("last_ts")})
    idf = _vectors(docs)
    common = Counter(g for d in docs for g in d.als)                  # どこにでも出る別名（大統領の名など）は結ぶ根拠にしない
    lim = max(4, int(len(docs) * 0.08))
    for d in docs:
        d.als = {g: w for g, w in d.als.items() if common[g] <= lim}
    best = {i: [] for i in range(len(docs))}
    for (i, j), c in _pairs(docs).items():
        w, why = why_of(docs[i], docs[j], c)
        if why is None or w < MIN_W:
            continue
        best[i].append((w, j, why))
        best[j].append((w, i, why))
    seen = {}
    for i, lst in best.items():
        for w, j, why in sorted(lst, key=lambda x: (-x[0], docs[x[1]].sid))[:K]:
            a, b = sorted((docs[i].sid, docs[j].sid))
            seen[(a, b)] = {"a": a, "b": b, "w": w, "why": why}
    edges = sorted(seen.values(), key=lambda e: (-e["w"], e["a"], e["b"]))
    groups = _groups([n["sid"] for n in nodes], edges, n_out)
    # same: なぜ一つに束ねたか
    run = latest.get("ai_run") if isinstance(latest.get("ai_run"), dict) else {}
    snap = latest.get("ai_snapshot") if isinstance(latest.get("ai_snapshot"), dict) else {}
    ai_at = run.get("at") or snap.get("ai_at")
    rc_members = {r.get("cid"): r.get("member_ids") or [] for r in latest.get("rule_clusters") or [] if isinstance(r, dict)}
    same = {}
    idocs = {}

    def idoc(iid):
        if iid not in idocs:
            idocs[iid] = _item_doc(items[iid], idf, table)
        return idocs[iid]
    for s in stories:
        if (s.get("n_outlets") or 0) < 2:
            continue
        mids = sorted([i for i in s.get("member_ids") or [] if i in items], key=lambda i: (items[i].get("ts") or 0, i))[:MAX_MEMBERS]
        links = []
        for p in range(len(mids)):
            for q in range(p + 1, len(mids)):
                if items[mids[p]].get("outlet") == items[mids[q]].get("outlet"):
                    continue
                links.append(_link(idoc(mids[p]), idoc(mids[q])))
        links.sort(key=lambda l: (-(l["sim"] + 0.05 * len(l["words"]) + 0.05 * len(l["places"]) + 0.05 * len(l["aliases"])), l["a"], l["b"]))
        by = "ai" if s.get("origin") == "ai" else "rule"
        ent = {"by": by, "rule_cids": list(s.get("rule_cids") or []), "rule_groups": len(s.get("rule_cids") or []), "links": links[:MAX_LINKS]}
        if by == "ai":
            ent["ai"] = {"model": run.get("model") if isinstance(run.get("model"), str) else None, "at": ai_at}
            joined = []
            cids = ent["rule_cids"]
            for p in range(len(cids)):
                for q in range(p + 1, len(cids)):
                    A = [i for i in rc_members.get(cids[p], []) if i in items][:MAX_MEMBERS]
                    B = [i for i in rc_members.get(cids[q], []) if i in items][:MAX_MEMBERS]
                    cands = [_link(idoc(x), idoc(y)) for x in A for y in B]
                    if not cands:
                        continue
                    b = max(cands, key=lambda l: (len(l["words"]) + len(l["aliases"]) + len(l["places"]), l["sim"]))
                    joined.append({"cids": [cids[p], cids[q]], "best": b})
                    if len(joined) >= MAX_PAIRS:
                        break
                if len(joined) >= MAX_PAIRS:
                    break
            ent["ai_joined"] = joined
        same[s["sid"]] = ent
    return {"schema": SCHEMA, "generated_at": int(now if now is not None else time.time()), "latest_generated_at": latest.get("generated_at"),
            "method": METHOD, "nodes": nodes, "edges": edges, "groups": groups, "same": same,
            "counts": {"nodes": len(nodes), "edges": len(edges), "groups": len(groups), "same": len(same), "secs": round(time.time() - t0, 2)}}


def _read(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m parallax.relations")
    ap.add_argument("--latest", default=str(ROOT / "data" / "latest.json"))
    ap.add_argument("--board", default=str(ROOT / "data" / "board.json"))
    ap.add_argument("--out", default=str(ROOT / "data" / "relations.json"))
    a = ap.parse_args(argv)
    latest = _read(a.latest)
    if not latest:
        print("relations: no latest.json (previous file kept)", file=sys.stderr)
        return 0
    d = compute(latest, _read(a.board))
    from parallax.extras import write_json
    write_json(a.out, d)
    print("relations nodes=%(nodes)d edges=%(edges)d groups=%(groups)d same=%(same)d (%(secs).1fs)" % d["counts"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
