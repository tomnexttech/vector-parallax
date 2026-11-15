# -*- coding: utf-8 -*-
"""translate — 海外の見出しの訳（CONTRACT §13.2、2026-11-16）。標準ライブラリだけ。

日本語でない見出し（lang != "ja"）を、AI が日本語に訳す。束ね直し（§4）も要約（§13）も、1 媒体だけの出来事と
AI が束ねなかった出来事には日本語を付けないので、海外の話の九割が英文のまま頁に出ていた（2026-11-16 の公開データ:
海外の出来事 347 件のうち日本語の見出しか一行があるのは 29 件）。訳は要約ではない: 一つの見出しを、足さず削らず日本語にする。

  items[id].title_ja   見出しの訳（無ければ欄が無い）
  items[id].desc_ja    配信が付けた説明（desc）の訳。desc が載る行だけ
  ai_run.translate     {status, provider, model, at, targets, cache_hits, translated, calls, calls_failed, calls_skipped,
                        attempts, call_limit, fallback_attempts, fallback_limit, left_out, dropped, errors}

控え data/title_cache.json = {"schema", "entries": {sha256(lang \\n title \\n desc): {title_ja, desc_ja, made_at, model, v}}}。
同じ見出しは二度と頼まない。窓の外の物は書く度に落とす。頁は訳に「訳」の印と元の見出しを添える（AI の読みなので）。
"""
import hashlib
import json
import re

try:
    from parallax import ai as ai_mod
    from parallax import validate as validate_mod
except ImportError:                                   # parallax/ の中から直に走らせた時
    import ai as ai_mod  # type: ignore
    import validate as validate_mod  # type: ignore

CACHE_SCHEMA = "parallax-title-cache/1"
CALL_LIMIT = 8                 # 1 build の訳の呼び（主の型）の上限
FALLBACK_LIMIT = 8             # 同じく予備の型
BATCH = 40                     # 1 呼びの見出しの数
CACHE_MAX = 4000
TIMEOUT_S = 120
JA_RE = re.compile("[぀-ヿ一-鿿]")


def is_foreign(row):
    """訳す相手か: 日本語でない見出しを持つ行（公開版で見出しを出さない源は title が None なので外れる）。"""
    t = row.get("title") if isinstance(row, dict) else None
    return isinstance(t, str) and t.strip() != "" and row.get("lang") != "ja" and not JA_RE.search(t)


def key_of(row):
    return hashlib.sha256("\n".join([str(row.get("lang") or ""), row["title"].strip(), (row.get("desc") or "").strip()]).encode("utf-8")).hexdigest()


def empty_cache():
    return {"schema": CACHE_SCHEMA, "entries": {}}


def _entry_ok(e):
    return (isinstance(e, dict) and isinstance(e.get("title_ja"), str) and JA_RE.search(e["title_ja"] or "")
            and isinstance(e.get("made_at"), (int, float)) and not isinstance(e.get("made_at"), bool)
            and isinstance(e.get("model"), str) and e["model"] and isinstance(e.get("v"), int))


def load_cache(path):
    """無い・読めない・形が違う時は空（例外を出さない）。形の悪い一件だけを捨てる。"""
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return empty_cache()
    if not (isinstance(d, dict) and d.get("schema") == CACHE_SCHEMA and isinstance(d.get("entries"), dict)):
        return empty_cache()
    return {"schema": CACHE_SCHEMA, "entries": {k: v for k, v in d["entries"].items() if isinstance(k, str) and _entry_ok(v)}}


def targets_of(stories, rows):
    """頁の並び（stories の順）で、訳す行の id。同じ id は一度だけ。どの story にも入らない行は訳さない。"""
    out, seen = [], set()
    for s in stories:
        for i in s.get("member_ids") or []:
            if i not in seen and i in rows and is_foreign(rows[i]):
                seen.add(i)
                out.append(i)
    return out


def build_requests(ids, rows):
    """-> [{"rid","tids":{tid: id},"doc"}]。doc = {"titles":[{"tid","lang","title","desc"?}]}。"""
    reqs = []
    for k in range(0, len(ids), BATCH):
        chunk = ids[k:k + BATCH]
        tids, lines = {}, []
        for n, i in enumerate(chunk, 1):
            tid = "t%d" % n
            tids[tid] = i
            r = {"tid": tid, "lang": rows[i].get("lang") or "", "title": rows[i]["title"]}
            if rows[i].get("desc"):
                r["desc"] = rows[i]["desc"]
            lines.append(r)
        reqs.append({"rid": "x%d" % (len(reqs) + 1), "tids": tids,
                     "doc": json.dumps({"titles": lines}, ensure_ascii=False, separators=(",", ":"))})
    return reqs


def _check(text, limit, reject):
    """一つの訳の欄。-> (訳 | "", 捨てた理由 | None)"""
    t = validate_mod.clean(text, limit)
    if not t:
        return "", None
    if not JA_RE.search(t):
        return "", "not_ja"                          # 日本語になっていない（英文のまま返した）
    if reject and reject(t):
        return "", "named"                           # 固定語・公開版で止めた媒体の名
    return t, None


def validate_answer(req, raw, tp, rows, reject=None):
    """-> {"rows": {id: {"title_ja", "desc_ja"?}}, "dropped": n, "errors": ["json"|"shape"]}"""
    out = {"rows": {}, "dropped": 0, "errors": []}
    try:
        d = validate_mod._parse(raw)
    except ValueError:
        out["errors"].append("json")
        return out
    if not isinstance(d, dict) or not isinstance(d.get("titles"), list):
        out["errors"].append("shape")
        return out
    lim = tp.get("limits") or {}
    seen = set()
    for a in d["titles"]:
        if not isinstance(a, dict) or a.get("tid") not in req["tids"] or a["tid"] in seen:
            continue
        seen.add(a["tid"])
        i = req["tids"][a["tid"]]
        t, why = _check(a.get("title_ja"), int(lim.get("title_ja") or 120), reject)
        if not t:
            out["dropped"] += 1 if why else 0
            continue
        row = {"title_ja": t}
        if rows[i].get("desc"):
            dj, why = _check(a.get("desc_ja"), int(lim.get("desc_ja") or 200), reject)
            if dj:
                row["desc_ja"] = dj
            elif why:
                out["dropped"] += 1
        out["rows"][i] = row
    return out


def disabled_run(status="disabled"):
    return {"status": status, "provider": None, "model": None, "at": None, "targets": 0, "cache_hits": 0, "translated": 0,
            "calls": 0, "calls_failed": 0, "calls_skipped": 0, "attempts": 0, "call_limit": CALL_LIMIT,
            "fallback_attempts": 0, "fallback_limit": FALLBACK_LIMIT, "left_out": 0, "dropped": 0, "errors": []}


def stage(stories, rows, prompt, provider, status_if_none, cache, now, reject=None):
    """訳を rows（data["items"] の行）に付ける。控えが先、残りを BATCH 件ずつ・先頭 CALL_LIMIT 本まで。
    cache はその場で直す（窓の外を落とす・新しい訳を足す）。-> ai_run.translate"""
    tp = (prompt or {}).get("translate") or {}
    if tp.get("enabled") is not True:
        return disabled_run()
    v = tp.get("version") if isinstance(tp.get("version"), int) else 1
    ids = targets_of(stories, rows)
    keys = {i: key_of(rows[i]) for i in ids}
    ents = cache.setdefault("entries", {})
    hits, made, used = 0, [], set()

    def put(i, e):
        rows[i]["title_ja"] = e["title_ja"]
        if rows[i].get("desc") and e.get("desc_ja"):
            rows[i]["desc_ja"] = e["desc_ja"]
        made.append(e)

    pending = []
    for i in ids:                                     # 1. 控え（同じ版の訳だけ。公開版で止める語が後から増えても掛け直す）
        e = ents.get(keys[i])
        if _entry_ok(e) and e["v"] == v and not (reject and any(reject(x) for x in (e.get("title_ja"), e.get("desc_ja")) if x)):
            put(i, e)
            used.add(keys[i])
            hits += 1
        else:
            pending.append(i)
    all_reqs = build_requests(pending, rows)
    reqs = all_reqs[:CALL_LIMIT]
    left_out = sum(len(r["tids"]) for r in all_reqs[CALL_LIMIT:])
    run = {"calls": 0, "calls_failed": 0, "calls_skipped": 0, "errors": [], "dropped": 0}
    status = status_if_none
    if provider is not None:                          # 2. 呼ぶ
        for n, req in enumerate(reqs):
            raw, err = provider.call(tp["system"], ai_mod.render_user_text(tp, req["doc"]), tp["schema"])
            if err == "budget":
                run["calls_skipped"] += len(reqs) - n
                run["errors"].append("budget")
                break
            run["calls"] += 1
            if err or raw is None:
                run["calls_failed"] += 1
                run["errors"].append(err or "shape")
                continue
            res = validate_answer(req, raw, tp, rows, reject)
            if res["errors"]:
                run["calls_failed"] += 1
                run["errors"].extend(res["errors"])
                continue
            run["dropped"] += res["dropped"]
            model = getattr(provider, "model", None) or "unknown"
            for i, r in res["rows"].items():
                e = {"title_ja": r["title_ja"], "made_at": int(now), "model": model, "v": v}
                if r.get("desc_ja"):
                    e["desc_ja"] = r["desc_ja"]
                ents[keys[i]] = e
                used.add(keys[i])
                put(i, e)
        if not reqs:
            status = "ok"
        elif run["calls"] and run["calls_failed"] == run["calls"]:
            status = "error"
        elif run["calls_failed"] or run["calls_skipped"] or left_out:
            status = "partial"
        else:
            status = "ok"
    elif hits:
        status = "cached"                             # 鍵の無い回: 控えの訳だけを出す
    # 控えの手入れ: 今の窓の行に無い物を落とし、上限を超えたら古い物から
    live = set(keys.values())
    for k in [k for k in ents if k not in live]:
        del ents[k]
    if len(ents) > CACHE_MAX:
        for _, k in sorted((e["made_at"], k) for k, e in ents.items())[:len(ents) - CACHE_MAX]:
            del ents[k]
    budget = getattr(provider, "budget", None) if provider is not None else None
    models = sorted({e["model"] for e in made})
    return {"status": status, "provider": getattr(provider, "name", None) if provider is not None else ("gemini" if made else None),
            "model": " + ".join(models) if models else (getattr(provider, "model", None) if provider is not None else None),
            "at": max((e["made_at"] for e in made), default=None),
            "targets": len(ids), "cache_hits": hits, "translated": sum(1 for i in ids if "title_ja" in rows[i]),
            "calls": run["calls"], "calls_failed": run["calls_failed"], "calls_skipped": run["calls_skipped"],
            "attempts": budget.used if budget is not None else run["calls"], "call_limit": CALL_LIMIT,
            "fallback_attempts": getattr(getattr(provider, "fallback_budget", None), "used", 0), "fallback_limit": FALLBACK_LIMIT,
            "left_out": left_out, "dropped": run["dropped"], "errors": run["errors"]}


def problems(items):
    """check_output の一部: 訳は元の見出し（説明）がある行にだけ、日本語で。-> 問題の文の list"""
    bad = 0
    for it in items.values():
        if not isinstance(it, dict):
            continue
        tj, dj = it.get("title_ja"), it.get("desc_ja")
        if tj is not None and not (isinstance(tj, str) and JA_RE.search(tj) and isinstance(it.get("title"), str) and it["title"].strip()):
            bad += 1
        if dj is not None and not (isinstance(dj, str) and JA_RE.search(dj) and isinstance(it.get("desc"), str) and it["desc"].strip()):
            bad += 1
    return ["%d translation(s) without their own headline or description" % bad] if bad else []

