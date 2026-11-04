# -*- coding: utf-8 -*-
"""build — 取得 → 規則の束 → AI に渡す塊の選択 → AI → stories → data/latest.json（標準ライブラリだけ）。
docs/CONTRACT-public.md が正本。流れは §2〜§5、版は §7。

    python -m parallax.build [--items FILE] [--save-items FILE] [--out data/latest.json] [--window-h 36]
                             [--now EPOCH] [--no-ai] [--responses FILE] [--dump-requests FILE]
                             [--public] [--model M] [--summary-model M] [--cache FILE]

--out の既存ファイルは、AI が使えない回（鍵なし・全呼び失敗）に前回の AI の見方を保つために読む（CONTRACT §12）。

鍵（GEMINI_API_KEY）を読むのは choose_provider と choose_summary_provider だけ。--no-ai・--responses・--dump-requests のどれかがあれば読まない。
モデル名はコードに持たない（data/prompt.json の merge_model と summary_model。CONTRACT §13）。
--save-items と --dump-requests の出力は全見出しを含む。repo の外か work/（.gitignore）へ置く。

JS へ写す口（頁が BYOK の結果で stories を組み直すため）:
    assemble_stories(rule_clusters, blocks, block_results, items) -> {"stories","merges","splits"}
    story_from(member_ids, origin, bid, ai, items, cid_of) -> Story
    validate.validate(request, raw_text, prompt, items) -> {"blocks","counts","errors"}
"""
import argparse
import copy
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
from pathlib import Path

try:
    from parallax import ai as ai_mod
    from parallax import cluster as cluster_mod
    from parallax import counts as counts_mod
    from parallax import og as og_mod
    from parallax import sources as sources_mod
    from parallax import validate as validate_mod
    from parallax import withheld as withheld_mod
except ImportError:                                   # parallax/ の中から直に走らせた時
    import ai as ai_mod  # type: ignore
    import cluster as cluster_mod  # type: ignore
    import counts as counts_mod  # type: ignore
    import og as og_mod  # type: ignore
    import sources as sources_mod  # type: ignore
    import validate as validate_mod  # type: ignore
    import withheld as withheld_mod  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = "parallax/1"
DEFAULT_WINDOW_H = 36
LOOSE_T = 0.18
MAX_BLOCK_ITEMS = 40
MAX_CALL_ITEMS = 45
MERGE_CALL_LIMIT = 2                       # 1 回の build での束ね直しの呼び数の上限。やり直しも数える（CONTRACT §13）
SUMMARY_CALL_LIMIT = 15                    # 同じく要約の呼び数の上限
SUMMARY_BATCH = 45                         # 要約 1 呼びの出来事の数
SUMMARY_MAX_ITEMS = 8                      # 1 出来事あたり要約に渡す見出しの上限
MAX_CALLS = MERGE_CALL_LIMIT
CACHE_SCHEMA = "parallax-summary-cache/1"
CACHE_MAX_ENTRIES = 2000                   # 控え全体（全 provider の区画の合計）の上限
WITHHOLD_FOCUS = ("no", "nc")              # 公開版で媒体ごとの焦点を外す源の印（CONTRACT §7）
PICK_LOOSE_PAIR, PICK_TOP, PICK_INTL_JAPAN, PICK_GOV_ONLY = 20, 18, 6, 10
FUTURE_SLACK_S = 3600
KEEP_WHEN = ("nokey", "error")             # この状態の回だけ、前回の AI の見方を保つ（CONTRACT §12）
KEEPABLE = ("ok", "partial", "recorded")   # 保てる前回の AI の状態

# CONTRACT §3 の Japan pattern（人名は入れない）
JAPAN_RE = re.compile(
    r"\b(?:japan|japanese|tokyo|osaka|kyoto|okinawa|hokkaido|fukushima|hiroshima|nagasaki|yen|bank of japan|boj|nikkei)\b"
    r"|日本|日銀|円相場|円安|円高|東京|大阪|京都|沖縄|北海道|福島|広島|長崎",
    re.I)


# ---------------------------------------------------------------- 権利の扱い（CONTRACT §14）
RIGHTS = {"mode": "quote"}                 # quote = 全部の源の見出しを引用の形で出す（既定）／ strict = 利用条件が ok の源だけ見出しを出す
STRICT_ONLY_NOTE = "strict のときだけ働く処理: 見出しを隠す・no/nc の焦点を外す・媒体名を挙げた文を落とす・構成で対比文を空にする・題の語の検査"


def set_rights(mode):
    RIGHTS["mode"] = "strict" if mode == "strict" else "quote"


def strict():
    return RIGHTS["mode"] == "strict"


# ---------------------------------------------------------------- 小さな道具
def sha1_12(parts):
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:12]


def terms_ok(item):
    """公開してよい見出しか。源の表（sources.TERMS）が ok と言う源だけ。表に無ければ不可（推測で上げない）。"""
    if not strict():
        return True
    src = sources_mod.by_id(item.get("source_id"))
    return bool(src) and src.get("terms_status") == "ok"


def terms_status(item):
    """item の源の利用条件の印（sources.TERMS）。表に無い源は unknown。"""
    src = sources_mod.by_id(item.get("source_id")) if isinstance(item, dict) else None
    return src.get("terms_status") if src else "unknown"


def focus_of_no_sources(stories, items):
    """terms_status が no または nc の源（WITHHOLD_FOCUS）の item に付いた angles の (story の添字, angle の添字) の list。"""
    if not strict():
        return []
    out = []
    for si, s in enumerate(stories):
        ai = s.get("ai") if isinstance(s, dict) else None
        for ai_ix, a in enumerate(ai.get("angles") if isinstance(ai, dict) and isinstance(ai.get("angles"), list) else []):
            if isinstance(a, dict) and terms_status(items.get(a.get("item_id"))) in WITHHOLD_FOCUS:
                out.append((si, ai_ix))
    return out


def withhold_no_source_focus(stories, items):
    """公開版 (CONTRACT §7): no または nc の源の item に付いた媒体ごとの焦点（angles）を出力から外す。束ねる処理には見出しを使い続けるが、
    その媒体について AI が書いた文は公開しない。出来事全体の中立の要約（headline・contrast・flag_note）は残す。-> 外した件数"""
    gone = set(focus_of_no_sources(stories, items))
    for si, s in enumerate(stories):
        ai = s.get("ai") if isinstance(s, dict) else None
        if isinstance(ai, dict) and isinstance(ai.get("angles"), list):
            ai["angles"] = [a for k, a in enumerate(ai["angles"]) if (si, k) not in gone]
    return len(gone)


# ---------------------------------------------------------------- 公開版: no / nc の媒体名を文に出さない（CONTRACT §7）
NAMED_GOV_ALWAYS = False                   # True にすると、政府一次の源の名は報道の枠でなくても落とす（厳格）
# 媒体の別名（正規表現の断片）。一般の語と紛れる名（朝日・毎日）は、報道の主体として書かれた形だけ
OUTLET_ALIASES = {
    "NHK": ["日本放送協会"],
    "朝日新聞": ["朝日デジタル", "Asahi", "朝日(?=の報道|によると|の記事|[はが][^。]{0,16}?(?:と報じ|と伝え|と示し|とする|としている|を強調|に触れ))"],
    "毎日新聞": ["Mainichi", "毎日(?=放送|の報道|によると|の記事|[はが][^。]{0,16}?(?:と報じ|と伝え|と示し|とする|としている|を強調|に触れ))"],
    "AFP": ["AFPBB"],
    "Nikkei Asia": ["Nikkei", "日経", "日本経済新聞"],
    "Bloomberg": ["ブルームバーグ"],
    "日本銀行": ["日銀", "BOJ", "Bank of Japan"],
    "首相官邸": ["官邸"],
    "厚生労働省": ["厚労省"],
    "文部科学省": ["文科省"],
}
FRAME_SRC = "と報じ|と伝え|と示し|と記し|と書|によると|の報道|の見出し|の記事|を強調|に触れ|を挙げ|としている|とする|を重視"
_NAME_RES = {}


def _outlet_pat(p, escape):
    s = re.escape(p) if escape else p
    if re.fullmatch(r"[A-Za-z0-9 .&-]+", p):
        s = r"(?<![A-Za-z0-9])" + s + r"(?![A-Za-z0-9])"
    return s


def _name_res():
    """no / nc の源の媒体名の正規表現 (always, framed)。名前の一覧は sources の outlet と OUTLET_ALIASES から作る。
    政府一次の源（官邸・省庁・日銀）の名は、既定では「…と報じ」「…によると」のような報道の枠で書かれた時だけ（出来事の主体として書くのは可）。"""
    if NAMED_GOV_ALWAYS in _NAME_RES:
        return _NAME_RES[NAMED_GOV_ALWAYS]
    media, gov = set(), set()
    for src in sources_mod.SOURCES:
        out = src.get("outlet")
        if src.get("terms_status") not in WITHHOLD_FOCUS or not out:
            continue
        bucket = gov if src.get("type") == validate_mod.PRIMARY_TYPE else media
        bucket.add(_outlet_pat(out, True))
        for a in OUTLET_ALIASES.get(out, ()):
            bucket.add(_outlet_pat(a, False))
    if NAMED_GOV_ALWAYS:
        media |= gov
        gov = set()
    always = re.compile("|".join(sorted(media, key=lambda x: (-len(x), x))), re.I) if media else None
    framed = (re.compile("(?:" + "|".join(sorted(gov, key=lambda x: (-len(x), x))) + ")[^。]{0,16}?(?:" + FRAME_SRC + ")", re.I)
              if gov else None)
    _NAME_RES[NAMED_GOV_ALWAYS] = (always, framed)
    return always, framed


def names_withheld_outlet(text):
    """文が、no / nc の源の媒体名を挙げているか（公開版で落とす文）。"""
    if not strict() or not isinstance(text, str) or not text:
        return False
    t = unicodedata.normalize("NFKC", text)
    always, framed = _name_res()
    return bool((always and always.search(t)) or (framed and framed.search(t)))


def _named_fields(stories):
    """(story, 欄) の列: 出来事全体の文（contrast_ja・flag_note_ja・summary）が no / nc の媒体名を挙げている物。"""
    for s in stories:
        ai = s.get("ai") if isinstance(s, dict) else None
        if isinstance(ai, dict):
            for k in ("contrast_ja", "flag_note_ja"):
                if names_withheld_outlet(ai.get(k)):
                    yield s, k
        sm = s.get("summary") if isinstance(s, dict) else None
        if isinstance(sm, dict) and names_withheld_outlet(sm.get("text_ja")):
            yield s, "summary"


def count_named_outlets(stories):
    return sum(1 for _ in _named_fields(stories))


def withhold_outlet_names(stories):
    """公開版: 出来事全体の文が no / nc の媒体名を挙げていたら、その文を落とす（contrast_ja・flag_note_ja は ""、summary は外す）。-> 落とした文の数"""
    hits = list(_named_fields(stories))
    for s, k in hits:
        if k == "summary":
            s.pop("summary", None)
        else:
            s["ai"][k] = ""
    return len(hits)


# ---------------------------------------------------------------- 公開版: 構成で落とす（CONTRACT §7・§4.6）
def _has_withheld_member(story, items):
    return any(terms_status(items.get(i)) in WITHHOLD_FOCUS for i in (story.get("member_ids") or []))


def _event_text_stories(stories, items):
    """no / nc の源を一つでも含む AI の story（strict のときだけ）。"""
    if not strict():
        return []
    return [s for s in stories if isinstance(s, dict) and isinstance(s.get("ai"), dict) and _has_withheld_member(s, items)]


def withhold_event_text(stories, items):
    """公開版: no または nc の源を一つでも含む出来事の contrast_ja と flag_note_ja を、中身に関わらず空にする。
    名の照合では言い換えが素通りするので、構成（その出来事に誰の見出しが入っているか）で落とす。-> {"contrast_ja": n, "flag_note_ja": n}"""
    out = {"contrast_ja": 0, "flag_note_ja": 0}
    for s in _event_text_stories(stories, items):
        for k in out:
            if isinstance(s["ai"].get(k), str) and s["ai"][k]:
                s["ai"][k] = ""
                out[k] += 1
    return out


def event_text_problems(stories, items):
    """no / nc の源を含む出来事に contrast_ja か flag_note_ja が残っている story の数。"""
    return sum(1 for s in _event_text_stories(stories, items)
               if any(isinstance(s["ai"].get(k), str) and s["ai"][k] for k in ("contrast_ja", "flag_note_ja")))


def report_headline_count(stories, prompt):
    """AI の題（headline_ja・headline_en）で、報じ方の語を含む物の数（CONTRACT §4.6）。"""
    n = 0
    if not strict():
        return n
    sp = dict(prompt, rights_mode="strict")
    for s in stories:
        ai = s.get("ai") if isinstance(s, dict) else None
        if isinstance(ai, dict):
            n += sum(1 for k in ("headline_ja", "headline_en")
                     if isinstance(ai.get(k), str) and ai[k] and validate_mod.report_hit(ai[k], sp))
    return n


def silence_text_count(stories, prompt):
    """AI の文（題・焦点・対比・札の注）で「報じなかった」系の語を含む物の数（CONTRACT §4.7。mode に関わらず）。"""
    n = 0
    for s in stories:
        ai = s.get("ai") if isinstance(s, dict) else None
        if isinstance(ai, dict):
            texts = [ai.get(k) for k in ("headline_ja", "headline_en", "contrast_ja", "flag_note_ja")]
            texts += [a.get("focus_ja") for a in ai.get("angles") or [] if isinstance(a, dict)]
            n += sum(1 for t in texts if isinstance(t, str) and t and validate_mod.silence_hit(t, prompt))
    return n


def blank_report_headlines(stories, prompt):
    """保っている前回の AI の見方の題から、報じ方の語を含む物を空にする。-> 空にした数"""
    n = 0
    if not strict():
        return n
    sp = dict(prompt, rights_mode="strict")
    for s in stories:
        ai = s.get("ai") if isinstance(s, dict) else None
        if isinstance(ai, dict):
            for k in ("headline_ja", "headline_en"):
                if isinstance(ai.get(k), str) and ai[k] and validate_mod.report_hit(ai[k], sp):
                    ai[k] = ""
                    n += 1
    return n


# ---------------------------------------------------------------- 名の関門（CONTRACT §17）
# 作り手が書く欄（AI の題・焦点・対比・札の注・要約・実行の注）に固定語が入れば落とす。取得した見出しそのままの欄は、数えるだけで止めない。
# 語の表と分け方は tools/leakcheck.py にある（語は符号化して置いてあり、このファイルには書かない）。機械の値（利用者名など）は読まない。
_NG = {}


def _gate():
    """-> (leakcheck の module, 固定語の正規表現の list)。初回に tools/leakcheck.py を読む。"""
    if not _NG:
        import importlib.util
        spec = importlib.util.spec_from_file_location("parallax_leakcheck", ROOT / "tools" / "leakcheck.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _NG["mod"], _NG["pat"] = mod, mod.fixed_patterns()
    return _NG["mod"], _NG["pat"]


def has_gate_name(text):
    """文が固定語を含むか（地名の複合形は leakcheck の許可の表で通る）。"""
    if not isinstance(text, str) or not text:
        return False
    mod, pat = _gate()
    return bool(mod.scan_text(text, pat))


def gate_names_in_ai(ai):
    """AI の一件（headline_ja・headline_en・contrast_ja・flag_note_ja・angles）から、固定語を含む欄を空にする（angles は該当の行を外す）。-> 空にした数"""
    n = 0
    for k in ("headline_ja", "headline_en", "contrast_ja", "flag_note_ja"):
        if has_gate_name(ai.get(k)):
            ai[k] = ""
            n += 1
    if isinstance(ai.get("angles"), list):
        keep = [a for a in ai["angles"] if not (isinstance(a, dict) and has_gate_name(a.get("focus_ja")))]
        n += len(ai["angles"]) - len(keep)
        ai["angles"] = keep
    return n


def gate_names_in_stories(stories):
    """story の list（検査後の答えでも組み上がった stories でも）。AI の欄と要約から固定語を含む文を落とす。-> 落とした数"""
    n = 0
    for s in stories:
        if not isinstance(s, dict):
            continue
        if isinstance(s.get("ai"), dict):
            n += gate_names_in_ai(s["ai"])
        sm = s.get("summary")
        if isinstance(sm, dict) and has_gate_name(sm.get("text_ja")):
            s.pop("summary", None)
            n += 1
    return n


def _demote_headlineless(req, bid, stories):
    """題が両方空になった AI の story は信用せず、規則の束（rule_groups）ごとに規則の story へ戻す（検査器が題の無い story にするのと同じ）。"""
    if all(s.get("origin") != "ai" or (s["ai"].get("headline_ja") or s["ai"].get("headline_en")) for s in stories):
        return stories
    alias = req.get("alias") or {}
    groups = next((b.get("rule_groups", []) for b in json.loads(req["doc"]).get("blocks", []) if b.get("bid") == bid), [])
    out = []
    for st in stories:
        if st.get("origin") != "ai" or st["ai"].get("headline_ja") or st["ai"].get("headline_en"):
            out.append(st)
            continue
        mem, placed = set(st["member_ids"]), set()
        for g in groups:
            left = [alias[a] for a in g if a in alias and alias[a] in mem]
            if left:
                out.append({"member_ids": left, "origin": "rule", "ai": None})
                placed.update(left)
        rest = [i for i in st["member_ids"] if i not in placed]
        if rest:
            out.append({"member_ids": rest, "origin": "rule", "ai": None})
    return out


def name_gate_counts(obj):
    """data（または ai_snapshot）の中の、固定語の数。-> (AI の欄で当たった (path, label) の list, 取得した見出しなどの欄で当たった数)"""
    mod, pat = _gate()
    return mod.gate_counts(obj, pat)


def make_name_gate(data):
    """data["name_gate"]（CONTRACT §17）。書いた後の data から数えた物だけ。0 件でも「走った」ことが分かるように、調べた欄の数と語の数を添える。"""
    mod, pat = _gate()
    strict, quoted = mod.gate_counts(data, pat)
    run = data.get("ai_run") if isinstance(data.get("ai_run"), dict) else {}
    sn = data.get("ai_snapshot") if isinstance(data.get("ai_snapshot"), dict) else {}
    n_ai = [0]

    def walk(o, key):
        if isinstance(o, dict):
            for k, v in o.items():
                walk(v, str(k))
        elif isinstance(o, list):
            for v in o:
                walk(v, key)
        elif isinstance(o, str) and o and key in mod.STRICT_KEYS:
            n_ai[0] += 1
    walk(data, "")
    return {"words": len(pat), "ai_fields_checked": n_ai[0], "ai_hits": len(strict),
            "ai_blanked": int(run.get("name_words") or 0) + int(sn.get("name_blanked") or 0),
            "quoted_hits": quoted,
            "quoted_fields": ["items[].title", "items[].link", "items[].image", "basis.words", "basis.places", "ai_requests[].doc", "sources[]"]}


def headlineless_ai_stories(stories):
    """題が両方空の AI の story の数（検査が通った物には無いはず）。"""
    return sum(1 for s in stories if isinstance(s, dict) and isinstance(s.get("ai"), dict)
               and not (s["ai"].get("headline_ja") or s["ai"].get("headline_en")))


def load_prompt(path=None, rights=None):
    """data/prompt.json。rights（"quote" / "strict"）で prompt.rights_mode を上書きできる。strict では system に strict_addendum を足す。"""
    with open(path or (ROOT / "data" / "prompt.json"), encoding="utf-8") as f:
        pr = json.load(f)
    pr["rights_mode"] = "strict" if (rights or pr.get("rights_mode")) == "strict" else "quote"
    if pr["rights_mode"] == "strict" and pr.get("strict_addendum"):
        pr["system"] = pr["system"] + "\n\n" + pr["strict_addendum"]
    return pr


# ---------------------------------------------------------------- 1〜2. 取り込みと整え
def prepare_items(items, now, window_h):
    """源の順に整え（安定）、id の重複を除き（先勝ち）、期間で絞る。"""
    order = {s["id"]: i for i, s in enumerate(sources_mod.SOURCES)}
    ordered = sorted((it for it in items if isinstance(it, dict)),
                     key=lambda it: order.get(it.get("source_id"), 1 << 30))
    lo, hi = now - window_h * 3600, now + FUTURE_SLACK_S
    seen, out = set(), []
    for it in ordered:
        iid = it.get("id")
        title = it.get("title")
        ts = it.get("ts")
        if not isinstance(iid, str) or not iid or iid in seen:
            continue
        if not isinstance(title, str) or not title.strip():
            continue
        if isinstance(ts, bool) or not isinstance(ts, (int, float)) or ts < lo or ts > hi:
            continue
        seen.add(iid)
        out.append(dict(it, ts=int(ts)))
    return out


# ---------------------------------------------------------------- 3. 規則の束
def _member_key(it):
    return (cluster_mod.type_rank(it["type"]), it["ts"], it["id"])


def make_rule_clusters(items):
    """-> (rule_clusters, items_by_id)。items_by_id は rule_clusters が指す item だけ。"""
    by_id = {it["id"]: it for it in items}
    feed = [dict(it, source=it["outlet"]) for it in items]
    out = []
    for c in cluster_mod.cluster(feed):
        members = sorted((by_id[m["id"]] for m in c["members"]), key=_member_key)
        out.append(_cluster_row(c["cid"], members))
    out.sort(key=lambda r: (-r["n_outlets"], -r["last_ts"], r["cid"]))
    used = {i for r in out for i in r["member_ids"]}
    return out, {i: by_id[i] for i in by_id if i in used}


def _cluster_row(cid, members):
    outlets = []
    for m in members:
        if m["outlet"] not in outlets:
            outlets.append(m["outlet"])
    return {"cid": cid, "member_ids": [m["id"] for m in members],
            "outlets": outlets, "n_outlets": len(outlets),
            "homes": sorted({m["home"] for m in members}), "langs": sorted({m["lang"] for m in members}),
            "first_ts": min(m["ts"] for m in members), "last_ts": max(m["ts"] for m in members)}


# ---------------------------------------------------------------- 4. 緩い結び
def loose_blocks(rule_clusters, items_by_id):
    """-> [[cid, ...]]（規則の束の並び順を保つ）。"""
    cid_of = {i: r["cid"] for r in rule_clusters for i in r["member_ids"]}
    index = {r["cid"]: n for n, r in enumerate(rule_clusters)}
    parent = {r["cid"]: r["cid"] for r in rule_clusters}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            if index[ra] <= index[rb]:
                parent[rb] = ra
            else:
                parent[ra] = rb

    feed = [dict(it, source=it["outlet"]) for it in items_by_id.values()]
    saved = cluster_mod.GATE_ON
    cluster_mod.GATE_ON = False
    try:
        loose = cluster_mod.cluster(feed, threshold=LOOSE_T)
    finally:
        cluster_mod.GATE_ON = saved
    for c in loose:
        cids = [cid_of[m["id"]] for m in c["members"] if m["id"] in cid_of]
        for other in cids[1:]:
            union(cids[0], other)
    groups = {}
    for r in rule_clusters:
        groups.setdefault(find(r["cid"]), []).append(r["cid"])
    size = {r["cid"]: len(r["member_ids"]) for r in rule_clusters}
    blocks = []
    for cids in groups.values():
        if sum(size[c] for c in cids) > MAX_BLOCK_ITEMS:
            blocks.extend([c] for c in cids)
        else:
            blocks.append(cids)
    blocks.sort(key=lambda cids: index[cids[0]])
    return blocks


# ---------------------------------------------------------------- 5. 選ぶ
def block_facts(cids, rc_by_cid, items):
    ids = [i for c in cids for i in rc_by_cid[c]["member_ids"]]
    its = [items[i] for i in ids]
    outlets = {it["outlet"] for it in its}
    return {"cids": cids, "ids": ids, "n_items": len(ids), "n_outlets": len(outlets),
            "homes": {it["home"] for it in its}, "last_ts": max(it["ts"] for it in its),
            "all_intl": all(it["home"] == "intl" for it in its),
            "japan": any(JAPAN_RE.search(it["title"]) for it in its),
            "gov_jp": all(it["type"] == validate_mod.PRIMARY_TYPE and it["home"] == "jp" for it in its)}


def pick_blocks(blocks, rule_clusters, items):
    """-> [{"cids","why","n_items"}]（選んだ順・重複なし）。"""
    rc_by_cid = {r["cid"]: r for r in rule_clusters}
    facts = [block_facts(cids, rc_by_cid, items) for cids in blocks]
    taken, picks = set(), []

    def take(cands, limit, why):
        for f in cands[:limit]:
            taken.add(f["cids"][0])
            picks.append({"cids": f["cids"], "why": why, "n_items": f["n_items"]})

    rc_homes = {c: r.get("homes", []) for c, r in rc_by_cid.items()}
    # 先頭: 規則では結ばれず（別々の規則の束）、緩い結びでだけ国内と海外が隣り合う組（CONTRACT §3 の 3）。小さい塊（連鎖の少ない組）から
    pool = [f for f in facts if len(f["cids"]) >= 2 and any(rc_homes[c] == ["jp"] for c in f["cids"])
            and any(rc_homes[c] == ["intl"] for c in f["cids"])]
    pool.sort(key=lambda f: (f["n_items"], -f["last_ts"], f["cids"][0]))
    take(pool, PICK_LOOSE_PAIR, "loose_pair")
    pool = [f for f in facts if f["n_outlets"] >= 2 and f["cids"][0] not in taken]
    pool.sort(key=lambda f: (-f["n_outlets"], -(len(f["homes"]) == 2), -f["last_ts"], f["cids"][0]))
    take(pool, PICK_TOP, "top")
    pool = [f for f in facts if f["cids"][0] not in taken and f["all_intl"] and f["japan"]]
    pool.sort(key=lambda f: (-f["last_ts"], f["cids"][0]))
    take(pool, PICK_INTL_JAPAN, "intl_japan")
    pool = [f for f in facts if f["cids"][0] not in taken and f["gov_jp"]]
    pool.sort(key=lambda f: (-f["last_ts"], f["cids"][0]))
    take(pool, PICK_GOV_ONLY, "gov_only")
    return picks


# ---------------------------------------------------------------- 6. 詰める
def pack(sizes, max_items=MAX_CALL_ITEMS, max_calls=MAX_CALLS):
    """sizes: 選んだ順の件数 list。first-fit。-> (calls: [[index, ...]], left_out: [index, ...])"""
    calls, loads, left = [], [], []
    for i, n in enumerate(sizes):
        for k, load in enumerate(loads):
            if load + n <= max_items:
                calls[k].append(i)
                loads[k] += n
                break
        else:
            if len(calls) < max_calls and n <= max_items:
                calls.append([i])
                loads.append(n)
            else:
                left.append(i)
    return calls, left


def assign_bids(picks):
    """詰めて送る塊に、選んだ順で b01.. を振る。-> blocks [{"bid","cids","why"}], calls [[bid,..]]"""
    calls, _ = pack([p["n_items"] for p in picks])
    sent = sorted(i for c in calls for i in c)
    bid_of = {i: "b%02d" % (n + 1) for n, i in enumerate(sent)}
    blocks = [{"bid": bid_of[i], "cids": picks[i]["cids"], "why": picks[i]["why"]} for i in sent]
    return blocks, [[bid_of[i] for i in c] for c in calls]


# ---------------------------------------------------------------- 7. 要求
def build_requests(call_bids, blocks, rule_clusters, items):
    """call_bids: [[bid, ...]]。-> ai_requests（CONTRACT §2・§4.1）。見出しは doc の中にだけ入る。"""
    blk = {b["bid"]: b for b in blocks}
    rc = {r["cid"]: r for r in rule_clusters}
    reqs = []
    for k, bids in enumerate(call_bids, 1):
        alias, n, doc_blocks = {}, 0, []
        for bid in bids:
            groups, its = [], []
            for cid in blk[bid]["cids"]:
                g = []
                for iid in rc[cid]["member_ids"]:
                    n += 1
                    a = "n%d" % n
                    alias[a] = iid
                    g.append(a)
                    it = items[iid]
                    its.append({"id": a, "outlet": it["outlet"], "home": it["home"], "lang": it["lang"],
                                "type": it["type"], "title": it["title"]})
                groups.append(g)
            doc_blocks.append({"bid": bid, "rule_groups": groups, "items": its})
        doc = json.dumps({"blocks": doc_blocks}, ensure_ascii=False, separators=(",", ":"))
        reqs.append({"rid": "r%d" % k, "bids": list(bids), "alias": alias, "doc": doc})
    return reqs


def dump_requests(requests, prompt, summary_requests=None):
    """全要求の写し。requests = 束ね直し、summary_requests = 要約（この build が実際に送る分。上限 SUMMARY_CALL_LIMIT まで）。
    どちらも sha256(user_text) が記録済みの答えの鍵。要約の system・schema は prompt["summary"]。"""
    out = {"version": "parallax-requests/2",
           "requests": [{"purpose": "merge", "rid": r["rid"], "bids": r["bids"],
                         "sha256": ai_mod.sha256_text(ai_mod.render_user_text(prompt, r["doc"])),
                         "user_text": ai_mod.render_user_text(prompt, r["doc"])} for r in requests]}
    sp = prompt.get("summary") or {}
    out["summary_requests"] = [{"purpose": "summary", "rid": r["rid"], "events": len(r["eids"]),
                                "sha256": ai_mod.sha256_text(ai_mod.render_user_text(sp, r["doc"])),
                                "user_text": ai_mod.render_user_text(sp, r["doc"])} for r in (summary_requests or [])]
    return out


# ---------------------------------------------------------------- 8. AI
def choose_provider(args, env, model=None, prompt=None):
    """束ね直しの provider。-> (provider | None, status_if_none)。鍵を読むのはここと choose_summary_provider だけ。
    --responses があれば、--dump-requests と一緒でも記録済みの答えで再生する（要約の要求を束ね直しの後の stories から作るため）。"""
    if args.get("no_ai"):
        return None, "off"
    if args.get("responses"):
        return ai_mod.RecordedProvider.from_file(args["responses"]), ""
    if args.get("dump_requests"):
        return None, "off"
    key = (env.get("GEMINI_API_KEY") or "").strip()
    if not key:
        return None, "nokey"
    pr = prompt or {}
    name = model or pr.get("merge_model")
    if not name:
        raise ValueError("data/prompt.json has no merge_model")
    return ai_mod.GeminiProvider(key, name, max_output_tokens=pr.get("max_output_tokens") or ai_mod.DEFAULT_MAX_OUTPUT_TOKENS,
                                 budget=ai_mod.CallBudget(MERGE_CALL_LIMIT),
                                 fallback_model=None if model else pr.get("merge_fallback_model")), ""


def summary_enabled(prompt):
    """要約の段は prompt.summary.enabled が true の時だけ動く。既定は false（親の確定待ち。CONTRACT §13）。"""
    return (prompt.get("summary") or {}).get("enabled") is True


def summary_disabled_run(prompt):
    return {"status": "disabled", "provider": None, "model": None, "at": None, "prompt_version": prompt.get("version"),
            "targets": 0, "cache_hits": 0, "summarized": 0, "calls": 0, "calls_failed": 0, "calls_skipped": 0, "attempts": 0,
            "call_limit": SUMMARY_CALL_LIMIT, "left_out": 0, "errors": [], "quoted_fields": 0, "empty": 0, "missing": 0,
            "named_outlets": 0, "shown_provider": None, "note_ja": ""}


def choose_summary_provider(args, env, prompt, merge_provider=None, model=None):
    """要約の provider。-> (provider | None, status_if_none)。status_if_none: off / nokey / none（記録済みに要約が無い）。
    --dump-requests では呼ばない（要求だけ作る）。--responses の記録に summary_responses があればそれを引く。
    prompt.summary.enabled が true でなければ、鍵も読まず (None, "disabled")。"""
    if not summary_enabled(prompt):
        return None, "disabled"
    if args.get("no_ai") or args.get("dump_requests"):
        return None, "off"
    if args.get("responses"):
        view = merge_provider.summary_view() if isinstance(merge_provider, ai_mod.RecordedProvider) else None
        return (view, "") if view is not None else (None, "none")
    key = (env.get("GEMINI_API_KEY") or "").strip()
    if not key:
        return None, "nokey"
    sp = prompt.get("summary") or {}
    name = model or prompt.get("summary_model")
    if not name:
        raise ValueError("data/prompt.json has no summary_model")
    return ai_mod.GeminiProvider(key, name, max_output_tokens=sp.get("max_output_tokens") or ai_mod.DEFAULT_MAX_OUTPUT_TOKENS,
                                 budget=ai_mod.CallBudget(SUMMARY_CALL_LIMIT)), ""


def run_ai(requests, provider, prompt, items, now):
    """-> (block_results {bid: [...]} 答えのあった塊だけ, ai_run の一部)"""
    run = {"calls": 0, "calls_failed": 0, "errors": [], "blocks_sent": 0, "blocks_ok": 0, "calls_skipped": 0,
           "dropped_ids": 0, "dup_ids": 0, "unassigned_ids": 0, "flags_vetoed": 0, "quoted_fields": 0,
           "report_words": 0, "silence_words": 0, "name_words": 0}
    results = {}
    for n, req in enumerate(requests):
        user_text = ai_mod.render_user_text(prompt, req["doc"])
        raw, err = provider.call(prompt["system"], user_text, prompt["schema"])
        if err == "budget":                               # 呼び数の上限（やり直しも数える）。残りは送らない（CONTRACT §13）
            run["calls_skipped"] += len(requests) - n
            run["errors"].append("budget")
            break
        run["calls"] += 1
        run["blocks_sent"] += len(req["bids"])
        if err or raw is None:
            run["calls_failed"] += 1
            run["errors"].append(err or "shape")
            continue
        res = validate_mod.validate(req, raw, prompt, items)
        if res["errors"]:
            run["calls_failed"] += 1
            run["errors"].extend(res["errors"])
            continue
        for k, v in res["counts"].items():
            run[k] += v
        for bid, stories in res["blocks"].items():            # 名の関門（§17）。固定語を含む欄を空にし、題が尽きた story は規則へ戻す
            run["name_words"] += gate_names_in_stories(stories)
            res["blocks"][bid] = _demote_headlineless(req, bid, stories)
        run["blocks_ok"] += len(res["blocks"])
        results.update(res["blocks"])
    return results, run


def make_ai_run(status, provider, prompt, now, run=None, note_ja=""):
    base = {"calls": 0, "calls_failed": 0, "errors": [], "blocks_sent": 0, "blocks_ok": 0, "calls_skipped": 0,
            "dropped_ids": 0, "dup_ids": 0, "unassigned_ids": 0, "flags_vetoed": 0, "quoted_fields": 0,
            "report_words": 0, "silence_words": 0, "name_words": 0}
    base.update(run or {})
    budget = getattr(provider, "budget", None) if provider is not None else None
    at = None
    if provider is not None:
        at = getattr(provider, "made_at", None) if isinstance(provider, ai_mod.RecordedProvider) else now
    return {"status": status, "provider": getattr(provider, "name", None) if provider else None,
            "model": getattr(provider, "model", None) if provider else None, "at": at,
            "prompt_version": prompt.get("version"),
            "calls": base["calls"], "calls_failed": base["calls_failed"], "errors": base["errors"],
            "attempts": budget.used if budget is not None else base["calls"], "call_limit": MERGE_CALL_LIMIT,
            "calls_skipped": base["calls_skipped"],
            "blocks_sent": base["blocks_sent"], "blocks_ok": base["blocks_ok"],
            "dropped_ids": base["dropped_ids"], "dup_ids": base["dup_ids"],
            "unassigned_ids": base["unassigned_ids"],
            "merges": 0, "splits": 0, "flags_vetoed": base["flags_vetoed"],
            "quoted_fields": base["quoted_fields"], "report_words": base["report_words"], "silence_words": base["silence_words"],
            "name_words": base["name_words"],
            "withheld_text": {"contrast_ja": 0, "flag_note_ja": 0}, "note_ja": note_ja}


def ai_status(provider, run):
    if run["calls"] and run["calls_failed"] == run["calls"]:
        return "error"
    if run["calls_failed"] or run.get("calls_skipped"):
        return "partial"
    return "recorded" if isinstance(provider, ai_mod.RecordedProvider) else "ok"


# ---------------------------------------------------------------- 8b. 要約の段（CONTRACT §13）
def members_digest(member_ids):
    """束の顔ぶれの指紋 = member の id を並べた物の sha256。"""
    return hashlib.sha256("\n".join(sorted(member_ids)).encode("utf-8")).hexdigest()


def empty_cache():
    return {"schema": CACHE_SCHEMA, "active": None, "partitions": {}}


def _entry_ok(e):
    return (isinstance(e, dict) and isinstance(e.get("text_ja"), str) and e["text_ja"].strip()
            and _is_epoch(e.get("made_at")) and isinstance(e.get("model"), str) and e["model"]
            and isinstance(e.get("prompt_version"), str) and e["prompt_version"])


def load_cache(path):
    """data/summary_cache.json。無い・読めない・形が違う時は空（例外を出さない）。形の悪い一件だけを捨てる。"""
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return empty_cache()
    if not (isinstance(d, dict) and d.get("schema") == CACHE_SCHEMA and isinstance(d.get("partitions"), dict)):
        return empty_cache()
    parts = {}
    for name, rows in d["partitions"].items():
        if isinstance(name, str) and name and isinstance(rows, dict):
            parts[name] = {k: v for k, v in rows.items() if isinstance(k, str) and _entry_ok(v)}
    active = d.get("active") if d.get("active") in parts else None
    return {"schema": CACHE_SCHEMA, "active": active, "partitions": parts}


def cache_lookup(cache, part, digest, prompt_version, model=None):
    """控えの当たり。鍵 = 顔ぶれの指紋 + prompt の版（どちらかが変われば外れる）。model が渡されれば、それも同じ時だけ。"""
    e = (cache.get("partitions", {}).get(part) or {}).get(digest) if part else None
    if not _entry_ok(e) or e["prompt_version"] != prompt_version:
        return None
    if model is not None and e["model"] != model:
        return None
    return e


def prune_cache(cache, live_digests):
    """窓の外へ出た束（今の stories に無い顔ぶれ）を落とし、全体を CACHE_MAX_ENTRIES 以内にする（古い物から）。-> 落とした件数"""
    dropped = 0
    for name in list(cache["partitions"]):
        rows = cache["partitions"][name]
        for k in [k for k in rows if k not in live_digests]:
            del rows[k]
            dropped += 1
    total = sum(len(r) for r in cache["partitions"].values())
    if total > CACHE_MAX_ENTRIES:
        flat = sorted(((e["made_at"], name, k) for name, rows in cache["partitions"].items() for k, e in rows.items()))
        for _, name, k in flat[:total - CACHE_MAX_ENTRIES]:
            del cache["partitions"][name][k]
            dropped += 1
    for name in [n for n, r in cache["partitions"].items() if not r]:
        del cache["partitions"][name]
    if cache.get("active") not in cache["partitions"]:
        cache["active"] = None
    return dropped


def build_summary_requests(pending, items):
    """pending: 要約が要る story（頁の並び順）。SUMMARY_BATCH 件ずつの束にする。見出しは doc の中にだけ入る。
    -> [{"rid","eids":{eid: sid},"sids","doc"}]（全部。送るのは先頭の SUMMARY_CALL_LIMIT 本まで）"""
    reqs = []
    for k in range(0, len(pending), SUMMARY_BATCH):
        chunk = pending[k:k + SUMMARY_BATCH]
        events, eids = [], {}
        for n, st in enumerate(chunk, 1):
            eid = "e%d" % n
            eids[eid] = st["sid"]
            events.append({"eid": eid, "items": [{"outlet": items[i]["outlet"], "lang": items[i]["lang"], "title": items[i]["title"]}
                                                 for i in st["member_ids"][:SUMMARY_MAX_ITEMS]]})
        doc = json.dumps({"events": events}, ensure_ascii=False, separators=(",", ":"))
        reqs.append({"rid": "s%d" % (len(reqs) + 1), "eids": eids, "sids": [st["sid"] for st in chunk], "doc": doc})
    return reqs


def run_summaries(requests, provider, prompt):
    """-> ({sid: 文}, run)。budget の上限に当たったら、残りは送らない（calls_skipped）。"""
    sp = prompt["summary"]
    run = {"calls": 0, "calls_failed": 0, "calls_skipped": 0, "errors": [],
           "quoted_fields": 0, "empty": 0, "missing": 0, "unknown_eid": 0}
    got = {}
    for n, req in enumerate(requests):
        raw, err = provider.call(sp["system"], ai_mod.render_user_text(sp, req["doc"]), sp["schema"])
        if err == "budget":
            run["calls_skipped"] += len(requests) - n
            run["errors"].append("budget")
            break
        run["calls"] += 1
        if err or raw is None:
            run["calls_failed"] += 1
            run["errors"].append(err or "shape")
            continue
        res = validate_mod.validate_summaries(req, raw, prompt)
        if res["errors"]:
            run["calls_failed"] += 1
            run["errors"].extend(res["errors"])
            continue
        got.update(res["summaries"])
        for k, v in res["counts"].items():
            run[k] += v
    return got, run


def _put_summary(story, e, part):
    story["summary"] = {"text_ja": e["text_ja"], "made_at": int(e["made_at"]), "provider": part, "model": e["model"]}


def summary_stage(stories, by_id, now, prompt, provider, status_if_none, cache, reject=None):
    """出来事ごとの中立の一行（story["summary"]）を付ける。AI の見出しを持つ story には付けない。
    控えが先、残りを SUMMARY_BATCH 件ずつ・先頭 SUMMARY_CALL_LIMIT 本まで。頁に出すのは 1 つの provider の区画だけ（混ぜない）。
    cache はその場で直す（窓の外を落とす・新しい要約を足す）。reject(text) が真の文（公開版: no / nc の媒体名を挙げた文）は付けず、控えにも入れない。
    -> (summary_run, 全 pending の要求)"""
    pv = prompt.get("version")
    targets = [s for s in stories if not s.get("ai") and s.get("n_outlets", 0) >= 2]      # 1 媒体だけの出来事には付けない（§13）
    digest = {s["sid"]: members_digest(s["member_ids"]) for s in targets}
    live = provider.name if provider is not None else None
    model = getattr(provider, "model", None)
    hits, named = 0, 0
    for s in targets:                                       # 1. 控え（この回の provider の区画・同じ model・同じ版）
        e = cache_lookup(cache, live, digest[s["sid"]], pv, model)
        if e and reject and reject(e["text_ja"]):
            cache["partitions"][live].pop(digest[s["sid"]], None)
            named += 1
            e = None
        if e:
            _put_summary(s, e, live)
            hits += 1
    pending = [s for s in targets if "summary" not in s]
    all_reqs = build_summary_requests(pending, by_id) if pending else []
    reqs = all_reqs[:SUMMARY_CALL_LIMIT]
    left_out = sum(len(r["sids"]) for r in all_reqs[SUMMARY_CALL_LIMIT:])
    got, run = {}, {"calls": 0, "calls_failed": 0, "calls_skipped": 0, "errors": [],
                    "quoted_fields": 0, "empty": 0, "missing": 0, "unknown_eid": 0}
    status = status_if_none
    if provider is not None:                                # 2. 呼ぶ
        got, run = run_summaries(reqs, provider, prompt)
        made_at = provider.made_at if isinstance(provider, ai_mod.RecordedSummaryProvider) else int(now)
        part = cache["partitions"].setdefault(live, {})
        for s in pending:
            text = got.get(s["sid"])
            if text and reject and reject(text):
                named += 1
                text = ""
            if text:
                e = {"text_ja": text, "made_at": made_at, "model": model, "prompt_version": pv, "sid": s["sid"]}
                part[digest[s["sid"]]] = e
                _put_summary(s, e, live)
        if not reqs:
            status = "recorded" if isinstance(provider, ai_mod.RecordedSummaryProvider) else "ok"
        elif run["calls"] and run["calls_failed"] == run["calls"]:
            status = "error"
        elif run["calls_failed"] or run["calls_skipped"]:
            status = "partial"
        else:
            status = "recorded" if isinstance(provider, ai_mod.RecordedSummaryProvider) else "ok"
        if hits or got:
            cache["active"] = live
    if provider is None or not (hits or got):               # 3. この回の provider の物が無い: 前回表示していた区画をそのまま（混ぜない）
        shown = cache.get("active")
        if shown and shown != live:
            for s in targets:
                e = cache_lookup(cache, shown, digest[s["sid"]], pv)
                if e and reject and reject(e["text_ja"]):
                    named += 1
                    e = None
                if e:
                    _put_summary(s, e, shown)
                    hits += 1
    prune_cache(cache, set(digest.values()))
    sm = [s["summary"] for s in stories if "summary" in s]
    budget = getattr(provider, "budget", None) if provider is not None else None
    summary_run = {"status": status, "provider": getattr(provider, "name", None) if provider else None, "model": model,
                   "at": max((x["made_at"] for x in sm), default=None), "prompt_version": pv,
                   "targets": len(targets), "cache_hits": hits, "summarized": len(sm),
                   "calls": run["calls"], "calls_failed": run["calls_failed"], "calls_skipped": run["calls_skipped"],
                   "attempts": budget.used if budget is not None else run["calls"], "call_limit": SUMMARY_CALL_LIMIT,
                   "left_out": left_out, "errors": run["errors"], "quoted_fields": run["quoted_fields"],
                   "empty": run["empty"], "missing": run["missing"], "named_outlets": named,
                   "shown_provider": sm[0]["provider"] if sm else None,
                   "note_ja": getattr(provider, "note_ja", "") or "" if provider is not None else ""}
    return summary_run, reqs


# ---------------------------------------------------------------- 9. stories
def make_basis(its, origin, span_s, word_ids=None):
    """CONTRACT §8。束ねた理由 = 見出しの二本以上に共通する語・地名（cluster.Feat から）と時刻の幅。見出しそのものは出さない。
    word_ids: 語を取ってよい item の id（公開版では見出しを出してよい源の物だけ）。None なら全部。
    地名（都道府県・国）は隠した見出しからも取る（地名と時刻の幅だけは公開してよい、と親が決めた）。"""
    if len(its) < 2:
        return None
    feats = [cluster_mod.Feat(it["title"], it["outlet"]) for it in its]
    wf = [f for it, f in zip(its, feats) if word_ids is None or it["id"] in word_ids]

    def common(fs, get):
        n = {}
        for f in fs:
            for x in get(f):
                n[x] = n.get(x, 0) + 1
        return {x for x, c in n.items() if c >= 2}

    terms = sorted(common(wf, lambda f: f.ents), key=lambda x: (-len(x), x))
    concepts = sorted(common(wf, lambda f: f.concepts) - cluster_mod._GEO)
    places = sorted(common(feats, lambda f: f.prefs) | (common(feats, lambda f: f.concepts) & cluster_mod._GEO))
    return {"by": origin, "words": (terms + concepts)[:6], "places": places, "time_span": span_s}


def story_from(member_ids, origin, bid, ai, items, cid_of, word_ids=None):
    """CONTRACT §2 の Story。member_ids は (type_rank, ts, id) の順に整える。"""
    ids = sorted(member_ids, key=lambda i: _member_key(items[i]))
    its = [items[i] for i in ids]
    outlets = []
    for it in its:
        if it["outlet"] not in outlets:
            outlets.append(it["outlet"])
    rule_cids = []
    for i in ids:
        c = cid_of[i]
        if c not in rule_cids:
            rule_cids.append(c)
    return {"sid": "s" + sha1_12(sorted(ids)), "origin": origin, "bid": bid, "rule_cids": rule_cids,
            "member_ids": ids, "outlets": outlets, "n_outlets": len(outlets),
            "homes": sorted({it["home"] for it in its}), "langs": sorted({it["lang"] for it in its}),
            "first_ts": min(it["ts"] for it in its), "last_ts": max(it["ts"] for it in its), "ai": ai,
            "basis": make_basis(its, origin, max(it["ts"] for it in its) - min(it["ts"] for it in its), word_ids)}


def assemble_stories(rule_clusters, blocks, block_results, items, word_ids=None):
    """AI が通った塊は検査後の stories、落ちた塊は規則の束ごと（bid 付き）、送らなかった束は bid=null。"""
    cid_of = {i: r["cid"] for r in rule_clusters for i in r["member_ids"]}
    rc = {r["cid"]: r for r in rule_clusters}
    in_block = {c for b in blocks for c in b["cids"]}
    stories = []
    for b in blocks:
        res = block_results.get(b["bid"])
        if res is None:
            for cid in b["cids"]:
                stories.append(story_from(rc[cid]["member_ids"], "rule", b["bid"], None, items, cid_of, word_ids))
        else:
            for r in res:
                stories.append(story_from(r["member_ids"], r["origin"], b["bid"], r["ai"], items, cid_of, word_ids))
    for r in rule_clusters:
        if r["cid"] not in in_block:
            stories.append(story_from(r["member_ids"], "rule", None, None, items, cid_of, word_ids))
    stories.sort(key=lambda s: (-s["n_outlets"], -s["last_ts"], s["sid"]))
    merges = sum(1 for s in stories if s["origin"] == "ai" and len(s["rule_cids"]) >= 2)
    where = {}
    for s in stories:
        if s["origin"] == "ai":
            for c in s["rule_cids"]:
                where.setdefault(c, set()).add(s["sid"])
    splits = sum(1 for v in where.values() if len(v) >= 2)
    return {"stories": stories, "merges": merges, "splits": splits}


# ---------------------------------------------------------------- 10. 版
def public_item(it):
    """公開版の item 行。見出しは terms_status が ok の源だけ。"""
    row = {k: it[k] for k in ("id", "title", "link", "outlet", "source_id", "type", "home", "lang", "ts")}
    row["image"] = image_row(it)
    if it.get("via"):                                    # CONTRACT 20.7: read through Google News
        row["via"], row["media"] = it["via"], it.get("media") or it.get("outlet")
    if not terms_ok(it):
        row["title"] = None
    return row


def local_item(it):
    row = {k: it[k] for k in ("id", "title", "link", "outlet", "source_id", "type", "home", "lang", "ts")}
    row["image"] = image_row(it)
    if it.get("via"):                                    # CONTRACT 20.7: read through Google News
        row["via"], row["media"] = it["via"], it.get("media") or it.get("outlet")
    return row


def source_rows(status, raw_items=None, now=None):
    """sources の行。oldest_ts は行に無ければ、取得した item（未来の ts を除く）の最古から。"""
    oldest = {}
    for it in raw_items or []:
        ts = it.get("ts") if isinstance(it, dict) else None
        if _is_epoch(ts) and it.get("source_id") and (now is None or ts <= now + FUTURE_SLACK_S):
            oldest[it["source_id"]] = min(int(ts), oldest.get(it["source_id"], int(ts)))
    out = []
    for r in status or []:
        tab = sources_mod.by_id(r.get("id"))
        terms, tstat = (tab["terms"], tab["terms_status"]) if tab else (r.get("terms") or "", "unknown")
        out.append({"id": r.get("id"), "name": r.get("name"), "outlet": r.get("outlet"), "type": r.get("type"),
                    "home": r.get("home"), "lang": r.get("lang"), "ok": bool(r.get("ok")), "n": int(r.get("n") or 0),
                    "fetched_at": r.get("fetched_at"), "newest_ts": r.get("newest_ts"),
                    "oldest_ts": r.get("oldest_ts") if _is_epoch(r.get("oldest_ts")) else oldest.get(r.get("id")),
                    "err": r.get("err") or "", "terms": terms, "terms_status": tstat})
    for row in out:                                       # CONTRACT 20.7: the search words of a Google News row can be published
        tab = sources_mod.by_id(row["id"])
        if tab and tab.get("kind") == "gn":
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(tab.get("url") or "").query).get("q")
            row["via"] = "google-news"
            row["query"] = q[0] if q else (tab.get("name") or "")
    return out


def make_scope(rows, now, window_h):
    """CONTRACT §16: どこまで調べたか。配信の数（取得できた数と全体）、国内の主要配信の数（札の母数）、窓、最古・最新の時刻。"""
    ok = [r for r in rows if r["ok"]]
    jp = [r for r in rows if r.get("home") == "jp" and r.get("type") in sources_mod.MAINSTREAM_TYPES]
    olds = [r["oldest_ts"] for r in ok if _is_epoch(r.get("oldest_ts"))]
    news = [r["newest_ts"] for r in ok if _is_epoch(r.get("newest_ts"))]
    return {"feeds": {"total": len(rows), "fetched": len(ok), "failed": len(rows) - len(ok)},
            "jp_main": {"total": len(jp), "fetched": sum(1 for r in jp if r["ok"])},
            "window": {"hours": window_h, "from": int(now - window_h * 3600), "to": int(now)},
            "oldest_ts": min(olds) if olds else None, "newest_ts": max(news) if news else None}


def _both_homes(homes):
    return "jp" in homes and "intl" in homes


def make_cross_home(data):
    """CONTRACT §16: 国内外の両方に出た出来事の数。rules = 規則の束で、ai = AI の見方の stories で（homes に jp と intl の両方）。
    of: "build" = この回の AI の答え / "snapshot" = 保った前回の AI の見方（rules もそのスナップショットの規則の束）/ null = AI の見方が無い（ai は null）。"""
    run = data.get("ai_run") or {}
    if run.get("status") in KEEPABLE:
        return {"rules": sum(1 for r in data["rule_clusters"] if _both_homes(r["homes"])),
                "ai": sum(1 for s in data["stories"] if _both_homes(s["homes"])), "of": "build"}
    sn = data.get("ai_snapshot")
    if run.get("status") == "kept_previous" and isinstance(sn, dict):
        return {"rules": sum(1 for r in sn["rule_clusters"] if _both_homes(r["homes"])),
                "ai": sum(1 for s in sn["stories"] if _both_homes(s["homes"])), "of": "snapshot"}
    return {"rules": sum(1 for r in data["rule_clusters"] if _both_homes(r["homes"])), "ai": None, "of": None}


def image_row(it):
    """CONTRACT §15: item の image = null か {"url": http(s) の URL, "from": "rss" | "og"}。URL だけを持つ（画像は複製しない）。"""
    im = it.get("image") if isinstance(it, dict) else None
    if isinstance(im, dict) and isinstance(im.get("url"), str) and im["url"].lower().startswith(("http://", "https://")) \
            and im.get("from") in ("rss", "og"):
        return {"url": im["url"], "from": im["from"]}
    return None


def image_stats(items, og_run=None):
    rows = [image_row(it) for it in items.values()]
    return {"items": len(rows), "rss": sum(1 for r in rows if r and r["from"] == "rss"),
            "og": sum(1 for r in rows if r and r["from"] == "og"), "none": sum(1 for r in rows if not r),
            "og_run": og_run}


# ---------------------------------------------------------------- 11. 前回の AI の見方を保つ（CONTRACT §12）
def _is_epoch(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def load_previous(path):
    """--out にある前回の latest.json。無い・読めない・JSON でない・schema が違う時は None（例外を出さない）。"""
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) and d.get("schema") == SCHEMA else None


def _coverage_problems(data):
    """規則の束・items・stories の整合（check_output と ai_snapshot の検査で共通）。-> 問題の文の list"""
    bad = []
    items = data.get("items", {})
    rule_ids = [i for r in data.get("rule_clusters", []) for i in r["member_ids"]]
    if len(rule_ids) != len(set(rule_ids)):
        bad.append("item in two rule clusters")
    if set(rule_ids) != set(items):
        bad.append("items do not match rule clusters")
    story_ids = [i for s in data.get("stories", []) for i in s["member_ids"]]
    if len(story_ids) != len(set(story_ids)):
        bad.append("item in two stories")
    if set(story_ids) != set(rule_ids):
        bad.append("stories do not cover every item")
    return bad


def summary_problems(stories):
    """story["summary"] の形（CONTRACT §13）。本文は問題文に入れない。-> 問題の文の list"""
    bad, providers = [], set()
    for s in stories:
        sm = s.get("summary") if isinstance(s, dict) else None
        if sm is None:
            continue
        if not (isinstance(sm, dict) and isinstance(sm.get("text_ja"), str) and sm["text_ja"].strip()
                and _is_epoch(sm.get("made_at")) and isinstance(sm.get("provider"), str) and sm["provider"]
                and isinstance(sm.get("model"), str) and sm["model"]):
            return ["a story summary has the wrong shape"]
        if s.get("ai"):
            bad.append("a story carries both an AI headline and a summary")
        if isinstance(s.get("n_outlets"), int) and s["n_outlets"] < 2:
            bad.append("a summary sits on an event with a single outlet")
        providers.add(sm["provider"])
    if len(providers) > 1:
        bad.append("summaries of more than one provider in one file")
    return bad


def snapshot_problems(sn, public=False, prompt=None):
    """ai_snapshot 単体の検査（CONTRACT §10）。-> 問題の文の list。見出しは問題文に入れない。"""
    if not isinstance(sn, dict):
        return ["snapshot is not an object"]
    bad = []
    for k in ("ai_at", "source_fetched_at"):
        if not _is_epoch(sn.get(k)):
            bad.append("snapshot %s is not an epoch" % k)
    if not (isinstance(sn.get("items"), dict) and isinstance(sn.get("rule_clusters"), list)
            and isinstance(sn.get("stories"), list) and isinstance(sn.get("blocks"), list)):
        return bad + ["snapshot has the wrong shape"]
    try:
        bad += ["snapshot: " + p for p in _coverage_problems(sn)]
    except (KeyError, TypeError, AttributeError):
        return bad + ["snapshot has the wrong shape"]
    bad += ["snapshot: " + p for p in summary_problems(sn["stories"])]
    prompt = prompt or load_prompt()
    n_rep = report_headline_count(sn["stories"], prompt)
    if n_rep:
        bad.append("snapshot carries %d headline(s) that use a reporting word" % n_rep)
    n_sil = silence_text_count(sn["stories"], prompt)
    if n_sil:
        bad.append("snapshot carries %d AI text(s) that say an outlet did not report" % n_sil)
    if headlineless_ai_stories(sn["stories"]):
        bad.append("snapshot has an AI story without a headline")
    n_name = len(name_gate_counts({"stories": sn["stories"], "ai_run": sn.get("ai_run")})[0])
    if n_name:
        bad.append("snapshot carries %d AI text field(s) with a word that must not appear" % n_name)
    run = sn.get("ai_run")
    if not isinstance(run, dict) or run.get("status") not in KEEPABLE:
        bad.append("snapshot ai_run is not an ok / partial / recorded run")
    if not any(isinstance(s, dict) and s.get("origin") == "ai" and isinstance(s.get("ai"), dict) for s in sn["stories"]):
        bad.append("snapshot has no AI story")
    if sn.get("edition") not in ("public", "local"):
        bad.append("snapshot edition")
    if public or sn.get("edition") == "public":
        shown = [i for i, it in sn["items"].items()
                 if isinstance(it, dict) and it.get("title") is not None and not terms_ok(it)]
        if shown:
            bad.append("public snapshot carries %d title(s) of sources that do not allow it" % len(shown))
        n_focus = len(focus_of_no_sources(sn["stories"], sn["items"]))
        if n_focus:
            bad.append("public snapshot carries %d focus text(s) of sources that do not allow it" % n_focus)
        n_named = count_named_outlets(sn["stories"])
        if n_named:
            bad.append("public snapshot names a withheld outlet in %d event-level sentence(s)" % n_named)
        n_evt = event_text_problems(sn["stories"], sn["items"])
        if n_evt:
            bad.append("public snapshot keeps contrast / flag text on %d event(s) that include a withheld source" % n_evt)
    return bad


def _regate_public(sn, prompt=None):
    """公開版: スナップショットの見出しも、今の源の表で ok の物だけ残す。見出しを失う story の basis.words は空にする
    （語は見出しから取った物なので、見出しが無くなれば残さない。CONTRACT §8）。no の源の焦点も外す（§7）。"""
    lost = set()
    for iid, it in sn["items"].items():
        if isinstance(it, dict) and it.get("title") is not None and not terms_ok(it):
            it["title"] = None
            lost.add(iid)
    withhold_no_source_focus(sn["stories"], sn["items"])
    withhold_event_text(sn["stories"], sn["items"])
    withhold_outlet_names(sn["stories"])
    blank_report_headlines(sn["stories"], prompt or load_prompt())
    for s in sn["stories"]:
        b = s.get("basis")
        if isinstance(b, dict):
            members = s.get("member_ids") or []
            shown = sum(1 for i in members if isinstance(sn["items"].get(i), dict) and sn["items"][i].get("title") is not None)
            if shown < 2 or lost.intersection(members):
                b["words"] = []
    sn["edition"] = "public"


def snapshot_from(previous, public, prompt=None):
    """前回の latest.json から AI の見方を一揃いで取る。-> ai_snapshot | None（保てない時）。
    前回が既に kept_previous なら、その ai_snapshot をそのまま（ai_at・source_fetched_at を新しく見せない）。
    そうでなければ、前回自身の items・rule_clusters・blocks・stories・ai_run を、AI の story を持つ時だけ。"""
    if not isinstance(previous, dict) or previous.get("schema") != SCHEMA:
        return None
    run = previous.get("ai_run") if isinstance(previous.get("ai_run"), dict) else {}
    try:
        if run.get("status") == "kept_previous" and isinstance(previous.get("ai_snapshot"), dict):
            sn = copy.deepcopy(previous["ai_snapshot"])
        elif run.get("status") in KEEPABLE:
            sn = copy.deepcopy({"ai_at": run.get("at"), "source_fetched_at": previous.get("generated_at"),
                                "edition": previous.get("edition"), "window_h": previous.get("window_h"),
                                "items": previous.get("items"), "rule_clusters": previous.get("rule_clusters"),
                                "blocks": previous.get("blocks"), "stories": previous.get("stories"), "ai_run": run,
                                "scope": previous.get("scope")})
        else:
            return None
        if not isinstance(sn.get("window_h"), int) or isinstance(sn.get("window_h"), bool) or sn["window_h"] <= 0:
            sn["window_h"] = DEFAULT_WINDOW_H
        if public or sn.get("edition") == "public":
            _regate_public(sn, prompt)                        # 先に今の規則を掛ける（古い公開版が持っていた焦点や見出しで弾かれないように）
        blanked = gate_names_in_stories(sn["stories"])         # 名の関門（§17）も、前回の AI の見方に掛け直す
        if isinstance(sn.get("ai_run"), dict) and has_gate_name(sn["ai_run"].get("note_ja")):
            sn["ai_run"]["note_ja"] = ""
            blanked += 1
        if snapshot_problems(sn, public, prompt):
            return None
    except (KeyError, TypeError, AttributeError):
        return None
    keys = ("ai_at", "source_fetched_at", "edition", "window_h", "items", "rule_clusters", "blocks", "stories", "ai_run")
    out = {k: sn.get(k) for k in keys}
    if isinstance(sn.get("scope"), dict):
        out["scope"] = sn["scope"]
    if blanked:
        out["name_blanked"] = blanked
    return out


def kept_run(own):
    """この回自身の ai_run（nokey / error）を、kept_previous の ai_run に直す。reason = この回自身の状態。
    at は None（この回は答えを作っていない）。provider・model・calls・errors は、この回の試みのまま。"""
    out = {"status": "kept_previous", "reason": own["status"]}
    out.update({k: v for k, v in own.items() if k != "status"})
    out["at"] = None
    return out


# ---------------------------------------------------------------- 全体
def build(items, status, now, window_h=DEFAULT_WINDOW_H, provider=None, status_if_none="off",
          prompt=None, public=False, previous=None, summary_provider=None, summary_status_if_none="off",
          cache=None, extras=None, og=None, withheld=None):
    """-> (data, requests_full)。requests_full は全塊の要求（--dump-requests 用・全見出しを含む）。
    previous: 前回の latest.json（dict）。この回の AI が nokey / error の時だけ、その AI の見方を ai_snapshot に保つ。
    summary_provider・cache: 要約の段（§13）。cache（empty_cache() の形）はその場で直す。extras が dict なら
    extras["summary_requests"] に、この回が送る要約の要求（全見出しを含む）を入れる。"""
    prompt = prompt or load_prompt()
    set_rights(prompt.get("rights_mode"))
    pool = prepare_items(items, now, window_h)
    rclusters, by_id = make_rule_clusters(pool)
    blocks_cids = loose_blocks(rclusters, by_id)
    picks = pick_blocks(blocks_cids, rclusters, by_id)
    blocks, call_bids = assign_bids(picks)
    requests_full = build_requests(call_bids, blocks, rclusters, by_id)

    if provider is None:
        results, run, ai_run = {}, None, make_ai_run(status_if_none, None, prompt, now)
    else:
        results, run = run_ai(requests_full, provider, prompt, by_id, now)
        ai_run = make_ai_run(ai_status(provider, run), provider, prompt, now, run,
                             getattr(provider, "note_ja", "") or "")
    word_ids = {i for i, it in by_id.items() if terms_ok(it)} if public else None
    st = assemble_stories(rclusters, blocks, results, by_id, word_ids)
    og_run = og(st["stories"], by_id) if og else None                 # RSS に画像が無い出来事の記事から og:image を読む（§15）
    named = 0
    if public:
        withhold_no_source_focus(st["stories"], by_id)
        ai_run["withheld_text"] = withhold_event_text(st["stories"], by_id)
        named = withhold_outlet_names(st["stories"])
    if has_gate_name(ai_run.get("note_ja")):
        ai_run["note_ja"] = ""
        ai_run["name_words"] += 1
    ai_run["merges"], ai_run["splits"] = st["merges"], st["splits"]
    ai_run["named_outlets"] = named
    cache = cache if isinstance(cache, dict) else empty_cache()
    if summary_enabled(prompt):
        ai_run["summary"], s_requests = summary_stage(st["stories"], by_id, now, prompt, summary_provider,
                                                      summary_status_if_none, cache,
                                                      reject=(lambda t: has_gate_name(t) or names_withheld_outlet(t)) if public else has_gate_name)
    else:                                              # 既定: 呼ばない・控えに触れない・story に何も付けない
        ai_run["summary"], s_requests = summary_disabled_run(prompt), []
    if extras is not None:
        extras["summary_requests"] = s_requests
    snapshot = snapshot_from(previous, public, prompt) if ai_run["status"] in KEEP_WHEN else None
    if snapshot is not None:
        ai_run = kept_run(ai_run)                     # この回の stories は規則だけのまま。前回の AI は別の一揃いで添える

    if public:
        rc = {r["cid"]: r for r in rclusters}
        ok_blocks = [b for b in blocks
                     if all(terms_ok(by_id[i]) for c in b["cids"] for i in rc[c]["member_ids"])]
        sizes = [sum(len(rc[c]["member_ids"]) for c in b["cids"]) for b in ok_blocks]
        calls, _ = pack(sizes)
        ai_requests = build_requests([[ok_blocks[i]["bid"] for i in c] for c in calls], blocks, rclusters, by_id)
        rows = {i: public_item(it) for i, it in by_id.items()}
    else:
        ai_requests = requests_full
        rows = {i: local_item(it) for i, it in by_id.items()}

    src_rows = source_rows(status, items, now)
    data = {"schema": SCHEMA, "generated_at": int(now), "window_h": window_h, "rights_mode": RIGHTS["mode"],
            "sources": src_rows, "scope": make_scope(src_rows, now, window_h), "items": rows,
            "edition": "public" if public else "local",
            "rule_clusters": rclusters,
            "blocks": [{"bid": b["bid"], "cids": b["cids"], "why": b["why"],
                        "ai": "none" if provider is None else ("answered" if b["bid"] in results else "fallback")}
                       for b in blocks],
            "ai_requests": ai_requests, "stories": st["stories"], "ai_run": ai_run}
    if snapshot is not None:
        data["ai_snapshot"] = snapshot
    data["window_items"] = len(pool)                    # CONTRACT 20.2: headlines inside the window (counts.headlines.in_window)
    data["cross_home"] = make_cross_home(data)
    if withheld is not None:
        data["withheld"] = withheld                      # CONTRACT 20.9: counts only
    data["images"] = image_stats(by_id, og_run)
    data["name_gate"] = make_name_gate(data)
    return data, requests_full


def check_output(data, min_stories=0, prompt=None):
    """CONTRACT §10。書く前の検査。-> 問題の文の list（空なら通る）。見出しは問題文に入れない。"""
    set_rights(data.get("rights_mode") or "strict")                   # 旧い形（欄が無い）は厳しい側で検査する
    bad = []
    if data.get("schema") != SCHEMA:
        bad.append("schema")
    items = data.get("items", {})
    bad += _coverage_problems(data)
    if any(it.get("image") is not None and image_row(it) is None for it in items.values() if isinstance(it, dict)):
        bad.append("an item has a malformed image")
    bad += summary_problems(data.get("stories", []))
    prompt = prompt or load_prompt()
    n_rep = report_headline_count(data.get("stories", []), prompt)
    if n_rep:
        bad.append("%d AI headline(s) use a reporting word" % n_rep)
    n_sil = silence_text_count(data.get("stories", []), prompt)
    if n_sil:
        bad.append("%d AI text(s) say that an outlet did not report" % n_sil)
    strict_hits, _ = name_gate_counts(data)               # 作り手が書く欄だけ。取得した見出しなどの欄は数えるだけ（§17）
    if strict_hits:
        bad.append("%d AI text field(s) carry a word that must not appear" % len(strict_hits))
    if len(data.get("stories", [])) < min_stories:
        bad.append("stories %d below the threshold %d" % (len(data.get("stories", [])), min_stories))
    if data.get("edition") == "public":
        hidden = {i for i, it in items.items() if not terms_ok(it)}
        shown = [i for i in hidden if items[i].get("title") is not None]
        if shown:
            bad.append("public edition carries %d title(s) of sources that do not allow it" % len(shown))
        for r in data.get("ai_requests", []):
            if any(iid in hidden for iid in r["alias"].values()):
                bad.append("public ai_requests carry an item of a source that does not allow it")
                break
        n_focus = len(focus_of_no_sources(data.get("stories", []), items))
        if n_focus:
            bad.append("public edition carries %d focus text(s) of sources that do not allow it" % n_focus)
        n_named = count_named_outlets(data.get("stories", []))
        if n_named:
            bad.append("public edition names a withheld outlet in %d event-level sentence(s)" % n_named)
        n_evt = event_text_problems(data.get("stories", []), items)
        if n_evt:
            bad.append("public edition keeps contrast / flag text on %d event(s) that include a withheld source" % n_evt)
    run = data.get("ai_run") if isinstance(data.get("ai_run"), dict) else {}
    kept = run.get("status") == "kept_previous"
    if kept != ("ai_snapshot" in data):
        bad.append("ai_snapshot must be present exactly when ai_run.status is kept_previous")
    if kept:
        if run.get("reason") not in KEEP_WHEN:
            bad.append("kept_previous without a reason")
        if any(s.get("origin") == "ai" or s.get("ai") for s in data.get("stories", [])):
            bad.append("kept_previous but a story of this build carries AI text")
        bad += snapshot_problems(data.get("ai_snapshot"), data.get("edition") == "public", prompt)
    return bad


def kept_stats(sn):
    """CONTRACT §9 の ai.kept。ai_snapshot から数えた物だけ。"""
    stories = sn.get("stories", []) if isinstance(sn, dict) else []
    return {"ai_at": sn.get("ai_at"), "source_fetched_at": sn.get("source_fetched_at"),
            "ai_stories": sum(1 for s in stories if s.get("origin") == "ai"), "stories": len(stories)}


def make_stats(data, raw_items, now, window_h, board_counts=None):
    """CONTRACT §9。build の結果と取得の写しから数えた物だけ。推定を混ぜない。"""
    pool = prepare_items(raw_items, now, window_h)
    cts = board_counts or counts_mod.merge(counts_mod.base(data, raw_items))
    its = list(data["items"].values())
    rcs = data["rule_clusters"]
    kind = lambda r: ("jp" if r["homes"] == ["jp"] else "intl" if r["homes"] == ["intl"] else "mixed")
    gov = lambda r: all(data["items"][i]["type"] == validate_mod.PRIMARY_TYPE for i in r["member_ids"])
    multi = [r for r in rcs if r["n_outlets"] >= 2]
    run = data["ai_run"]
    sr = run.get("summary") or {}
    sent = {c for b in data["blocks"] if b["ai"] != "none" for c in b["cids"]}
    cl_fallen = {c for b in data["blocks"] if b["ai"] == "fallback" for c in b["cids"]}
    return {"schema": "parallax-stats/1", "generated_at": data["generated_at"], "edition": data["edition"],
            "rights_mode": data.get("rights_mode"), "cross_home": data.get("cross_home"), "scope": data.get("scope"),
            "images": data.get("images"), "name_gate": data.get("name_gate"),
            "counts": cts,      # CONTRACT 20.2: the same object as board.json counts
            "withheld": data.get("withheld"),
            "window": {"hours": window_h, "from": now - window_h * 3600, "to": now,
                       "oldest_ts": min((it["ts"] for it in pool), default=None),
                       "newest_ts": max((it["ts"] for it in pool), default=None)},
            "sources": cts["sources"],
            "headlines": cts["headlines"],                       # CONTRACT 20.2: one definition, the same object as counts
            "clusters": {"total": len(rcs), "multi_outlet": len(multi),
                         "jp_only": sum(1 for r in rcs if kind(r) == "jp"),
                         "intl_only": sum(1 for r in rcs if kind(r) == "intl"),
                         "gov_primary_only": sum(1 for r in rcs if gov(r)),
                         "multi_outlet_jp_only": sum(1 for r in multi if kind(r) == "jp"),
                         "multi_outlet_intl_only": sum(1 for r in multi if kind(r) == "intl"),
                         "multi_outlet_gov_primary_only": sum(1 for r in multi if gov(r))},
            "ai": {"status": run["status"], "blocks_chosen": len(data["blocks"]), "blocks_sent": run["blocks_sent"],
                   "blocks_ok": run["blocks_ok"], "blocks_failed": run["blocks_sent"] - run["blocks_ok"],
                   "clusters_sent": len(sent), "clusters_fallen": len(cl_fallen),
                   "calls": run["calls"], "calls_failed": run["calls_failed"],
                   "stories": len(data["stories"]), "ai_stories": sum(1 for s in data["stories"] if s["origin"] == "ai"),
                   "reason": run.get("reason") if run["status"] == "kept_previous" else None,
                   "kept": kept_stats(data.get("ai_snapshot")) if run["status"] == "kept_previous" else None,
                   "merge": {"provider": run.get("provider"), "model": run.get("model"), "calls": run["calls"],
                             "attempts": run.get("attempts", run["calls"]), "calls_failed": run["calls_failed"],
                             "limit": run.get("call_limit", MERGE_CALL_LIMIT), "named_outlets": run.get("named_outlets", 0),
                             "report_words": run.get("report_words", 0), "silence_words": run.get("silence_words", 0), "name_words": run.get("name_words", 0), "withheld_text": run.get("withheld_text", {"contrast_ja": 0, "flag_note_ja": 0})},
                   "summary": {"status": sr.get("status", "off"), "provider": sr.get("provider"), "model": sr.get("model"),
                               "calls": sr.get("calls", 0), "attempts": sr.get("attempts", 0),
                               "calls_failed": sr.get("calls_failed", 0), "limit": sr.get("call_limit", SUMMARY_CALL_LIMIT),
                               "targets": sr.get("targets", 0), "cache_hits": sr.get("cache_hits", 0),
                               "left_out": sr.get("left_out", 0), "shown_provider": sr.get("shown_provider"),
                               "named_outlets": sr.get("named_outlets", 0),
                               "at": sr.get("at")},
                   "summarized": sum(1 for s in data["stories"] if "summary" in s)}}


def write_json(path, obj):
    """一時ファイルへ書いて os.replace（途中で落ちても半端な物を残さない）。"""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8", newline="\n")
    os.replace(tmp, p)


def write_extras(data, items, now, out_dir, removed=()):
    """CONTRACT 18: board.json (+ history.json) and politics.json. Each is written only if it was computed; an exception is
    printed and the previous file stays. This never changes latest.json and never raises."""
    out_dir = Path(out_dir)
    counts = None
    try:
        from parallax import board as board_mod
        prev = None
        try:
            prev = json.loads((out_dir / "history.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            prev = None
        if prev and removed:                              # CONTRACT 20.9: the lineage memory forgets what was withheld
            prev["entries"] = [e for e in prev.get("entries", []) if e.get("key") not in removed]
        b, hist = board_mod.compose(data, items, now, prev)
        counts = b.get("counts")
        write_json(out_dir / "board.json", b)
        write_json(out_dir / "history.json", hist)
        ex = b["examined"]
        print("board priority=%d outline=%d outside=%d asymmetric=%d cases=%d with_place=%d primary_items=%d history=%d"
              % (len(b["priority"]), sum(len(v) for v in b["outline"].values()), len(b["outside"]), len(b["asymmetry"]),
                 len(b["cases"]), ex["with_place"], ex["primary_items"], len(hist["entries"])))
    except Exception as e:
        print("board FAILED (previous board.json kept): %s: %s" % (type(e).__name__, e), file=sys.stderr)
    try:
        from parallax import politics as politics_mod
        pol = politics_mod.compose(items, now)
        write_json(out_dir / "politics.json", pol)
        print("politics bills=%s parties=%d kokkai=%s failed=%s"
              % ({h: sum(c.values()) for h, c in pol["bills"]["counts"].items()}, len(pol["parties"]),
                 "ok" if pol.get("kokkai") else "none", list(pol["failed"])))
    except Exception as e:
        print("politics FAILED (previous politics.json kept): %s: %s" % (type(e).__name__, e), file=sys.stderr)
    return counts


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m parallax.build", description=__doc__.split("\n")[0])
    ap.add_argument("--items", help="取得の写し（--save-items の形）を読む。取得しない")
    ap.add_argument("--save-items", help="取得を {fetched_at, items, sources} で保存（全見出しを含む: work/ へ）")
    ap.add_argument("--out", default=str(ROOT / "data" / "latest.json"))
    ap.add_argument("--window-h", type=int, default=DEFAULT_WINDOW_H)
    ap.add_argument("--now", type=int, help="epoch 秒。既定は --items の fetched_at、無ければ現在")
    ap.add_argument("--no-ai", action="store_true", help="AI を呼ばない（status off）")
    ap.add_argument("--responses", help="記録済みの答え（data/recorded.json の形）で再生する")
    ap.add_argument("--dump-requests", help="全塊の要求を書く。送らない（全見出しを含む: work/ へ）")
    ap.add_argument("--rights", choices=("quote", "strict"), default=os.environ.get("PARALLAX_RIGHTS") or None,
                    help="権利の扱い（既定は data/prompt.json の rights_mode = quote。strict は利用条件が ok の源だけ見出しを出す）")
    ap.add_argument("--pick-loose-pair", type=int, default=None,
                    help="先頭に置く「規則では結ばれず、緩い結びでだけ国内と海外が隣り合う組」の最大数（既定 PICK_LOOSE_PAIR。0 で旧い選び方）")
    ap.add_argument("--og", action="store_true", help="RSS に画像が無い出来事の記事から og:image を読む（網に出る。上限あり: parallax/og.py）")
    ap.add_argument("--public", action="store_true", help="公開版: terms_status が ok でない源の見出しを null にする")
    ap.add_argument("--model", help="束ね直しのモデル名（既定は data/prompt.json の merge_model）")
    ap.add_argument("--summary-model", help="要約のモデル名（既定は data/prompt.json の summary_model）")
    ap.add_argument("--cache", help="要約の控えの置き場（既定は --out と同じ場所の summary_cache.json）")
    ap.add_argument("--min-stories", type=int, default=0,
                    help="stories がこれ未満なら --out を上書きしない（前の良い版を残す）。Actions では実数を渡す")
    ap.add_argument("--stats", help="stats.json の置き場（既定は --out と同じ場所の stats.json）")
    ap.add_argument("--extras", action="store_true",
                    help="CONTRACT 18: also read the pages that have no feed (audit board, gazette, bills) and write board.json, history.json, politics.json next to --out. A failure here never stops latest.json")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    if a.items:
        with open(a.items, encoding="utf-8") as f:
            snap = json.load(f)
        items, status = snap["items"], snap.get("sources", [])
        now = a.now if a.now is not None else int(snap.get("fetched_at") or time.time())
    else:
        items, status = sources_mod.fetch_everything()
        if a.extras:                                      # pages without a feed; a failure is a status row, not an exception
            p_items, p_status = sources_mod.fetch_primary_sources()
            items, status = items + p_items, status + p_status
        now = a.now if a.now is not None else int(time.time())
        if a.save_items:
            write_json(a.save_items, {"fetched_at": now, "items": items, "sources": status})
    if a.items and a.save_items:
        write_json(a.save_items, {"fetched_at": now, "items": items, "sources": status})

    w_rules = withheld_mod.load()                       # CONTRACT 20.9: applied before anything else
    items, w_removed, w_counts = withheld_mod.apply(items, w_rules)
    prompt = load_prompt(rights=a.rights) if a.rights else load_prompt()
    if a.pick_loose_pair is not None:
        globals()["PICK_LOOSE_PAIR"] = max(0, a.pick_loose_pair)
    set_rights(prompt["rights_mode"])
    provider, status_if_none = choose_provider(
        {"no_ai": a.no_ai, "responses": a.responses, "dump_requests": a.dump_requests},
        os.environ, a.model, prompt)
    args = {"no_ai": a.no_ai, "responses": a.responses, "dump_requests": a.dump_requests}
    s_provider, s_status = choose_summary_provider(args, os.environ, prompt, provider, a.summary_model)
    cache_path = Path(a.cache) if a.cache else Path(a.out).with_name("summary_cache.json")
    cache = load_cache(cache_path)
    previous = load_previous(a.out)                   # 読むだけ。AI が使えない回に、前回の AI の見方を保つ（CONTRACT §12）
    previous, n_prev = withheld_mod.scrub(previous, w_rules)      # 止めた物は前の版からも戻さない（CONTRACT 20.9）
    extras = {}
    data, requests_full = build(items, status, now, a.window_h, provider, status_if_none, prompt, a.public, previous,
                                s_provider, s_status, cache, extras, og_mod.fill if a.og else None, withheld=w_counts)
    if a.dump_requests:
        write_json(a.dump_requests, dump_requests(requests_full, prompt, extras.get("summary_requests")))
    problems = check_output(data, a.min_stories, prompt)
    if problems:
        print("REFUSED: %s is left as it was. problems: %s" % (a.out, "; ".join(problems)), file=sys.stderr)
        if n_prev and isinstance(previous, dict):         # the kept previous version loses what was withheld (CONTRACT 20.9)
            write_json(a.out, previous)
            print("withheld: %d item(s)/photo(s) taken out of the kept previous version" % n_prev, file=sys.stderr)
        return 2
    write_json(a.out, data)
    board_counts = write_extras(data, items, now, Path(a.out).parent, w_removed) if a.extras else None
    write_json(a.stats or Path(a.out).with_name("stats.json"), make_stats(data, items, now, a.window_h, board_counts))
    print("withheld sources=%d items=%d photos=%d removed=%d photos_cleared=%d" % (w_counts["sources"], w_counts["items"], w_counts["photos"], w_counts["items_removed"], w_counts["photos_cleared"]))
    if not (a.no_ai or a.dump_requests):              # 要約の控え。点検に通った回だけ書く。--no-ai と --dump-requests は読むだけ
        write_json(cache_path, cache)
    for code in dict.fromkeys(data["ai_run"]["errors"]):
        print("ai error %s: %s" % (code, ai_mod.error_message(code, "en", prompt)))
    for model, status, detail in ai_mod.HTTP_DETAILS:
        print("ai http model=%s status=%d detail=%s" % (model, status, detail))
    n_null = sum(1 for it in data["items"].values() if it["title"] is None)
    run = data["ai_run"]
    print("edition=%s items=%d rule_clusters=%d blocks=%d calls=%d stories=%d null_title=%d ai=%s"
          % (data["edition"], len(data["items"]), len(data["rule_clusters"]), len(data["blocks"]),
             len(requests_full), len(data["stories"]), n_null, run["status"]))
    print("ai status=%s reason=%s ai_calls=%d ai_calls_failed=%d ai_stories=%d"
          % (run["status"], run.get("reason") or "-", run["calls"], run["calls_failed"],
             sum(1 for s in data["stories"] if s["origin"] == "ai")))
    sr = run["summary"]
    print("summary status=%s provider=%s model=%s targets=%d cache_hits=%d summarized=%d calls=%d attempts=%d/%d failed=%d left_out=%d"
          % (sr["status"], sr["provider"] or "-", sr["model"] or "-", sr["targets"], sr["cache_hits"], sr["summarized"],
             sr["calls"], sr["attempts"], sr["call_limit"], sr["calls_failed"], sr["left_out"]))
    if "ai_snapshot" in data:
        sn = data["ai_snapshot"]
        print("ai kept: answers made at %s (UTC) on the fetch of %s (UTC); they are not from this build"
              % (time.strftime("%Y-%m-%d %H:%M", time.gmtime(sn["ai_at"])),
                 time.strftime("%Y-%m-%d %H:%M", time.gmtime(sn["source_fetched_at"]))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
