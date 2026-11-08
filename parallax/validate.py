# -*- coding: utf-8 -*-
"""validate — AI の答えを検査して Story の元にする（標準ライブラリだけ）。docs/CONTRACT-public.md §4.3・§4.4 のとおり。
js/validate.js は同じことをする。fixture（tests/fixtures）を共有して食い違いを試験で捕まえる。

    validate(request, raw_text, prompt, items)
        -> {"blocks": {bid: [{"member_ids": [...], "origin": "ai"|"rule", "ai": {...}|None}]},
            "counts": {"dropped_ids","dup_ids","unassigned_ids","flags_vetoed","quoted_fields","report_words","silence_words"},
            "errors": ["json"|"shape"]}

request は ai_requests の一件（doc に別名と rule_groups、alias に別名 -> item id）。
items は item id -> item（home・type・outlet を 4.4 で読む）。別名は外へ出さない。
"""
import json
import re
import unicodedata

# 日本の主流（4.4）。sources.MAINSTREAM_TYPES と同じ（試験で揃いを確かめる）
MAINSTREAM_TYPES = ("公共放送", "通信社", "全国紙", "民放")
PRIMARY_TYPE = "政府一次"

# 空白（4.3）。Python の \s ではなく、JS と同じに揃うよう明示する
_WS = re.compile("[\t\n\x0b\x0c\r \x85\xa0  　]+")
_DROP_CATS = ("Cc", "Cf", "Cs")
_FENCE = re.compile(r"^```[A-Za-z0-9_-]*[ \t]*\r?\n?(.*?)\r?\n?[ \t]*```$", re.S)
ELLIPSIS = "…"
QUOTE_MIN = 10                      # 見出しの丸写しとみなす折り畳み後の最小の長さ（4.3 の引用検査）


def fold(text):
    """引用検査用の折り畳み: NFKC・小文字・カテゴリ L* と N* の文字だけ残す。"""
    t = unicodedata.normalize("NFKC", text).lower()
    return "".join(ch for ch in t if unicodedata.category(ch)[0] in "LN")


def copies(field, folded_titles):
    """field（掃除済みの文字列）が見出しの丸写しか。見出しが field を含む、または field が見出しを含む。"""
    f = fold(field)
    if not f:
        return False
    return any((len(t) >= QUOTE_MIN and t in f) or (len(f) >= QUOTE_MIN and f in t) for t in folded_titles)


def report_hit(text, prompt):
    """題（headline_ja・headline_en）が報じ方の語を含むか（CONTRACT §4.6）。語の表は prompt["report_words"]。
    許す形（allowed_ja。「…と報じられている」）は先に取り除く。英語は語の境界で見る（reportedly は reported に当たらない）。"""
    if (prompt or {}).get("rights_mode") != "strict":          # quote（既定）では検査しない（CONTRACT §14）
        return False
    rw = prompt.get("report_words") or {}
    t = unicodedata.normalize("NFKC", text).lower()
    for a in rw.get("allowed_ja") or []:
        t = t.replace(unicodedata.normalize("NFKC", a).lower(), " ")
    if any(unicodedata.normalize("NFKC", w).lower() in t for w in rw.get("ja") or []):
        return True
    return any(re.search(r"(?<![a-z])" + re.escape(w.lower()) + r"(?![a-z])", t) for w in rw.get("en") or [])


def silence_hit(text, prompt):
    """文が「報じなかった」系の語を含むか（CONTRACT §4.7）。mode に関わらず検査する。語の表は prompt["silence_words"]。
    取得した配信に見当たらないことは、報じなかったこと・報じていないことと同じではない。"""
    sw = (prompt or {}).get("silence_words") or {}
    t = unicodedata.normalize("NFKC", text).lower()
    if any(unicodedata.normalize("NFKC", w).lower() in t for w in sw.get("ja") or []):
        return True
    return any(re.search(r"(?<![a-z])" + re.escape(w.lower()) + r"(?![a-z])", t) for w in sw.get("en") or [])


def clean(value, limit):
    """文字列でなければ ""。空白を一つに畳み、Cc/Cf/Cs を除き、コードポイントで limit に切る。"""
    if not isinstance(value, str):
        return ""
    s = _WS.sub(" ", value).strip()
    s = "".join(ch for ch in s if unicodedata.category(ch) not in _DROP_CATS)
    s = _WS.sub(" ", s).strip()
    if len(s) > limit:
        s = s[:max(limit - 1, 0)] + ELLIPSIS
    return s


def _parse(raw_text):
    if not isinstance(raw_text, str):
        raise ValueError("json")
    t = raw_text.strip()
    m = _FENCE.match(t)
    if m:
        t = m.group(1).strip()
    try:
        return json.loads(t)
    except ValueError:
        raise ValueError("json")


def veto_flags(flags, members):
    """4.4。members は item の list。-> (残った flags, [{"flag","why"}])"""
    kept, dropped = [], []
    outlets = {m.get("outlet") for m in members}
    for f in flags:
        why = None
        if f == "overseas_only":
            if any(m.get("home") == "jp" for m in members):
                why = "has_jp_outlet"
        elif f == "jp_main_not_found":
            if len(outlets) < 2:
                why = "single_outlet"
            elif any(m.get("home") == "jp" and m.get("type") in MAINSTREAM_TYPES for m in members):
                why = "has_jp_mainstream"
        elif f == "primary_only":
            if any(m.get("type") != PRIMARY_TYPE for m in members):
                why = "has_non_primary"
        if why:
            dropped.append({"flag": f, "why": why})
        else:
            kept.append(f)
    return kept, dropped


def _empty(errors=None):
    return {"blocks": {}, "counts": {"dropped_ids": 0, "dup_ids": 0, "unassigned_ids": 0, "flags_vetoed": 0,
                                     "quoted_fields": 0, "report_words": 0, "silence_words": 0},
            "errors": list(errors or [])}


def validate(request, raw_text, prompt, items):
    out = _empty()
    try:
        answer = _parse(raw_text)
    except ValueError as e:
        out["errors"].append(str(e))
        return out
    if not isinstance(answer, dict) or not isinstance(answer.get("blocks"), list):
        out["errors"].append("shape")
        return out

    doc = json.loads(request["doc"])
    alias = request.get("alias") or {}
    req_blocks = {}
    for b in doc.get("blocks", []):
        aliases = [it["id"] for it in b.get("items", [])]
        req_blocks[b["bid"]] = {"aliases": aliases, "set": set(aliases), "groups": b.get("rule_groups", [])}

    lim = prompt["limits"]
    allowed_flags = list(prompt["flags"])
    counts = out["counts"]

    def real(a):
        return alias[a]

    for entry in answer["blocks"]:
        if not isinstance(entry, dict):
            continue
        bid = entry.get("bid")
        if not isinstance(bid, str) or bid not in req_blocks or bid in out["blocks"]:
            continue                                       # 頼んでいない bid は無視・同じ bid の二つ目も無視
        rb = req_blocks[bid]
        stories_in = entry.get("stories")
        if not isinstance(stories_in, list):
            stories_in = []
        titles = []                                        # 引用検査: この塊の見出し（null は除く）
        for a in rb["aliases"]:
            t = (items.get(real(a)) or {}).get("title")
            if isinstance(t, str):
                titles.append(fold(t))
        used = set()
        built = []                                         # (members[別名], ai | None)
        for st in stories_in:
            if not isinstance(st, dict):
                continue
            members = []
            mids = st.get("member_ids")
            for a in (mids if isinstance(mids, list) else []):
                if not isinstance(a, str) or a not in rb["set"]:
                    counts["dropped_ids"] += 1
                elif a in used:
                    counts["dup_ids"] += 1
                else:
                    used.add(a)
                    members.append(a)
            if not members:
                continue
            real_items = [items.get(real(a)) or {} for a in members]
            def text(key, limit, headline=False):
                v = clean(st.get(key) if key else None, limit)
                if v and copies(v, titles):
                    counts["quoted_fields"] += 1
                    return ""
                if v and silence_hit(v, prompt):                  # 「報じなかった」系の語は mode に関わらず落とす（§4.7）
                    counts["silence_words"] += 1
                    return ""
                if v and headline and report_hit(v, prompt):      # 題は事実の叙述に限る（§4.6）。空にして、下の「題が空なら規則へ」に乗せる
                    counts["report_words"] += 1
                    return ""
                return v
            hja = text("headline_ja", lim["headline_ja"], True)
            hen = text("headline_en", lim["headline_en"], True)
            if not hja and not hen:
                built.append((members, None))              # 信用しない: 後で未割当へ戻す
                continue
            seen_angle, angles = set(), []
            for ag in (st.get("angles") if isinstance(st.get("angles"), list) else []):
                if not isinstance(ag, dict):
                    continue
                iid = ag.get("item_id")
                if not isinstance(iid, str) or iid not in members or iid in seen_angle:
                    continue
                focus = clean(ag.get("focus_ja"), lim["focus_ja"])
                if focus and copies(focus, titles):
                    counts["quoted_fields"] += 1
                    focus = ""
                elif focus and silence_hit(focus, prompt):
                    counts["silence_words"] += 1
                    focus = ""
                seen_angle.add(iid)                        # 先勝ち: 空の物が先でも二つ目は採らない
                if focus:
                    angles.append({"item_id": real(iid), "focus_ja": focus})
            flags, seen_flag = [], set()
            for f in (st.get("flags") if isinstance(st.get("flags"), list) else []):
                if isinstance(f, str) and f in allowed_flags and f not in seen_flag:
                    seen_flag.add(f)
                    flags.append(f)
            kept, dropped = veto_flags(flags, real_items)
            counts["flags_vetoed"] += len(dropped)
            note = text("flag_note_ja", lim["flag_note_ja"]) if kept else ""
            contrast = text("contrast_ja", lim["contrast_ja"])
            built.append((members, {
                "headline_ja": hja, "headline_en": hen, "angles": angles,
                "contrast_ja": contrast,
                "flags": kept, "flags_dropped": dropped, "flag_note_ja": note}))

        result = []
        for members, ai in built:
            if ai is None:
                used.difference_update(members)            # 全部読んだ後に未割当へ戻す
            else:
                result.append({"member_ids": [real(a) for a in members], "origin": "ai", "ai": ai})
        grouped = set()
        for g in rb["groups"]:
            grouped.update(g)
            left = [a for a in g if a not in used]
            if left:
                counts["unassigned_ids"] += len(left)
                result.append({"member_ids": [real(a) for a in left], "origin": "rule", "ai": None})
        stray = [a for a in rb["aliases"] if a not in grouped and a not in used]
        if stray:                                          # rule_groups に載らなかった別名（契約上は無いはず）
            counts["unassigned_ids"] += len(stray)
            result.append({"member_ids": [real(a) for a in stray], "origin": "rule", "ai": None})
        out["blocks"][bid] = result
    return out


# ---------------------------------------------------------------- 要約（CONTRACT §13）
BRIEF_FIELDS = ("what_ja", "background_ja", "views_ja", "next_ja")
_NUM_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")
_LATIN_RE = re.compile(r"[a-z][a-z0-9.\-]+")
_KANA_RE = re.compile(r"[\u30a1-\u30fa\u30fc]{3,}")


def _material(doc_event):
    """一つの出来事の材料（見出し・配信の説明・媒体名を除いた時刻）を一つの折り畳んだ文字列にする。-> (text, 媒体名の list, 数として許す文字列の set)"""
    parts, outlets, sides = [], [], set()
    for it in doc_event.get("items", []):
        if not isinstance(it, dict):
            continue
        for k in ("title", "desc", "at"):
            if isinstance(it.get(k), str):
                parts.append(it[k])
        if isinstance(it.get("outlet"), str) and it["outlet"]:
            outlets.append(it["outlet"])
        if isinstance(it.get("side"), str):
            sides.add(it["side"])
    text = unicodedata.normalize("NFKC", chr(10).join(parts)).lower()
    n_items = len([it for it in doc_event.get("items", []) if isinstance(it, dict)])
    allowed = {str(n) for n in range(0, n_items + 1)} | {str(len(set(outlets))), str(len(sides)), "3"}
    return text, outlets, allowed


def ungrounded(text, material, allowed_numbers, generic_katakana=()):
    """文の中の、材料に無い数・英字の語・カタカナの語。材料に無い事を書いた徴（CONTRACT §13）。-> 材料に無かった語の list
    数は材料にそのまま在るか、材料の件数・媒体数・側の数。カタカナは 3 字以上の連なりで、材料に在るか generic_katakana の語。
    漢字の名前（人名・組織名）はここでは見ない（指示文で縛る）。"""
    t = unicodedata.normalize("NFKC", text).lower()
    nums = {m.replace(",", "") for m in _NUM_RE.findall(material)}
    bad = []
    for m in _NUM_RE.findall(t):
        m = m.replace(",", "").rstrip(".")
        if m not in nums and m not in allowed_numbers and m not in material.replace(",", ""):
            bad.append(m)
    for m in _LATIN_RE.findall(t):
        if m not in material:
            bad.append(m)
    gen = [unicodedata.normalize("NFKC", g).lower() for g in generic_katakana]
    for m in _KANA_RE.findall(t):
        if m not in material and not any(m == g or m in g for g in gen):
            bad.append(m)
    return bad


def names_outlet(text, outlets):
    """文が、その出来事の材料にある媒体の名を挙げているか。"""
    f = fold(text)
    return any(len(fold(o)) >= 2 and fold(o) in f for o in set(outlets))


def validate_summaries(request, raw_text, prompt):
    """要約の答えの検査。request = {"doc": JSON 文字列 {"events":[{"eid","items":[{"outlet","lang","title","side","at","desc"}]}]}, "eids": {eid: sid}}。
    -> {"summaries": {sid: 文}, "briefs": {sid: {what_ja, background_ja, views_ja, next_ja}},
        "counts": {"quoted_fields","empty","unknown_eid","missing","brief_fields_dropped","ungrounded","named_outlets"}, "errors": ["json"|"shape"]}
    見出し・説明の丸写し（4.3 と同じ折り畳み）は捨てる。頼んでいない eid・同じ eid の二つ目は無視。答えの無かった event は missing に数える。
    brief（詳しい要約）は欄ごとに検査する: 丸写し・「報じなかった」系の語・媒体名・材料に無い数や語は、その欄だけを落とす。
    what_ja が残らなければ brief は付けない。brief の無い答え（古い形）は、要約だけが残る。"""
    out = {"summaries": {}, "briefs": {}, "counts": {"quoted_fields": 0, "empty": 0, "unknown_eid": 0, "missing": 0,
                                                        "brief_fields_dropped": 0, "ungrounded": 0, "named_outlets": 0}, "errors": []}
    try:
        answer = _parse(raw_text)
    except ValueError as e:
        out["errors"].append(str(e))
        return out
    if not isinstance(answer, dict) or not isinstance(answer.get("summaries"), list):
        out["errors"].append("shape")
        return out
    doc = json.loads(request["doc"])
    eids = request.get("eids") or {}
    events = {ev.get("eid"): ev for ev in doc.get("events", []) if isinstance(ev, dict)}
    limits = prompt["summary"]["limits"]
    limit = limits["summary_ja"]
    unknown = (prompt["summary"].get("unknown_ja") or "").strip()
    generic = prompt["summary"].get("generic_katakana") or []
    seen, counts = set(), out["counts"]
    for entry in answer["summaries"]:
        if not isinstance(entry, dict):
            continue
        eid = entry.get("eid")
        if not isinstance(eid, str) or eid not in eids:
            counts["unknown_eid"] += 1
            continue
        if eid in seen:
            continue
        seen.add(eid)
        ev = events.get(eid) or {}
        titles = [fold(it["title"]) for it in ev.get("items", [])
                  if isinstance(it, dict) and isinstance(it.get("title"), str)]
        descs = [fold(it["desc"]) for it in ev.get("items", [])
                 if isinstance(it, dict) and isinstance(it.get("desc"), str)]
        material, outlets, allowed = _material(ev)
        text = clean(entry.get("summary_ja"), limit)
        if not text:
            counts["empty"] += 1
        elif copies(text, titles):
            counts["quoted_fields"] += 1
        else:
            out["summaries"][eids[eid]] = text
        br = entry.get("brief")
        if isinstance(br, dict) and prompt["summary"].get("brief_version"):
            fields = {}
            for k in BRIEF_FIELDS:
                v = clean(br.get(k), limits.get(k, 140))
                if not v:
                    fields[k] = ""
                    continue
                if unknown and v == unknown:
                    fields[k] = v if k != "what_ja" else ""        # 材料に無い、と言う決まった言い方（what_ja には使えない）
                    continue
                if copies(v, titles + descs):
                    counts["quoted_fields"] += 1
                    counts["brief_fields_dropped"] += 1
                    fields[k] = ""
                elif silence_hit(v, prompt):
                    counts["brief_fields_dropped"] += 1
                    fields[k] = ""
                elif names_outlet(v, outlets):
                    counts["named_outlets"] += 1
                    counts["brief_fields_dropped"] += 1
                    fields[k] = ""
                elif ungrounded(v, material, allowed, generic):
                    counts["ungrounded"] += 1
                    counts["brief_fields_dropped"] += 1
                    fields[k] = ""
                else:
                    fields[k] = v
            if fields["what_ja"]:
                out["briefs"][eids[eid]] = fields
    counts["missing"] = len(eids) - len(seen)
    return out
