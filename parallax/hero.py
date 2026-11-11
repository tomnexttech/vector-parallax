# -*- coding: utf-8 -*-
"""hero — ホームの最初の一枚の候補（data/hero.json、CONTRACT §26）。小さく（MAX_BYTES 以内）・先に読む。stdlib だけ・AI は使わない。

    python -m parallax.hero [--latest data/latest.json] [--board data/board.json] [--relations ...] [--reaction ...] [--out data/hero.json]

latest.json は大きい（MB の単位）。会場の回線と電話で最初の一枚を待たせないため、候補を選び、表示に要る物だけを出す。
選び方（試験で固定）：
  split     国内と海外の両方に 2 社以上・媒体の比べ（coverage）がある・findings が 1 つ以上。findings の数 → 媒体の数 → 新しさ
  both      国内と海外の両方に見出しがある物。媒体の数 → 新しさ
  one_side  片側だけ（国内だけ・海外だけ・官公庁だけ）で 2 社以上の物の最上位（js/sections.js oneSideOf と同じ規則）
どれも無ければ picks は []（頁は今のホームのまま。作らない）。段の順に詰め、MAX_PICKS まで。
"""
import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = "parallax-hero/1"
MAX_PICKS = 5
MAX_BYTES = 30000
HEADS_PER_SIDE = 2
GOV = "政府一次"
SIDES = ("jp", "intl", "gov")


def _side(it):
    return "gov" if it.get("type") == GOV else "intl" if it.get("home") == "intl" else "jp"


def _sides(ms):
    out = {}
    for k in SIDES:
        xs = [m for m in ms if _side(m) == k]
        ts = [m.get("ts") for m in xs if isinstance(m.get("ts"), (int, float))]
        out[k] = {"n": len(xs), "outlets": len({m.get("outlet") for m in xs if m.get("outlet")}), "first_ts": min(ts) if ts else None}
    return out


def _points(cov):
    """coverage の行の名を、載せた側で分ける：片側だけ / 両方"""
    out = {"jp": [], "intl": [], "both": []}
    if not isinstance(cov, dict):
        return out
    outs = cov.get("outlets") or []
    for r in cov.get("rows") or []:
        sides = {outs[i]["side"] for i, c in enumerate(r.get("c") or []) if c and i < len(outs)}
        name = r.get("t") if r.get("k") in ("who", "what", "where") else "時期" if r.get("k") == "when" else (r.get("t") or "").split("・")[-1]
        if not name:
            continue
        key = "both" if {"jp", "intl"} <= sides else "jp" if sides == {"jp"} else "intl" if sides == {"intl"} else None
        if key and name not in out[key]:
            out[key].append(name)
    return {k: v[:4] for k, v in out.items()}


def _heads(ms):
    out = []
    for k in SIDES:
        seen = set()
        for m in sorted([m for m in ms if _side(m) == k], key=lambda m: (m.get("ts") or 0, m.get("id") or "")):
            if m.get("outlet") in seen or not isinstance(m.get("title"), str):
                continue
            seen.add(m.get("outlet"))
            link = m.get("link") if isinstance(m.get("link"), str) and m["link"].startswith(("https://", "http://")) else None
            out.append({"id": m.get("id"), "side": k, "outlet": m.get("outlet"), "ts": m.get("ts"), "title": m["title"][:140], "link": link,
                        "lang": m.get("lang") if m.get("lang") in ("ja", "en") else "ja"})
            if len(seen) >= HEADS_PER_SIDE:
                break
    return out


def _same(rel_same):
    if not isinstance(rel_same, dict):
        return None
    out = {k: rel_same.get(k) for k in ("by", "rule_groups", "ai") if k in rel_same}
    out["links"] = (rel_same.get("links") or [])[:2]
    if rel_same.get("ai_joined"):
        out["ai_joined"] = rel_same["ai_joined"][:2]
    return out


def candidates(latest, board=None):
    """-> [(tier, story, members, case)] 段の順・段の中は並びの規則の順"""
    items = latest.get("items") or {}
    if isinstance(items, list):
        items = {it.get("id"): it for it in items if isinstance(it, dict)}
    cases = (board or {}).get("cases") or {}
    cases = cases if isinstance(cases, dict) else {}
    split, both, one = [], [], []
    for s in latest.get("stories") or []:
        if not isinstance(s, dict) or not s.get("sid"):
            continue
        ms = [items[i] for i in s.get("member_ids") or [] if i in items]
        if not ms:
            continue
        sd = _sides(ms)
        case = cases.get(s["sid"]) if isinstance(cases.get(s["sid"]), dict) else {}
        cov = case.get("coverage") if isinstance(case.get("coverage"), dict) else None
        nf = len(cov.get("findings") or []) if cov else 0
        last = s.get("last_ts") or 0
        n_out = s.get("n_outlets") or len({m.get("outlet") for m in ms})
        if sd["jp"]["outlets"] >= 2 and sd["intl"]["outlets"] >= 2 and cov and nf >= 1:
            split.append(((-nf, -n_out, -last, s["sid"]), s, ms, case))
        elif sd["jp"]["n"] >= 1 and sd["intl"]["n"] >= 1:
            both.append(((-n_out, -last, s["sid"]), s, ms, case))
        else:
            on = [k for k in SIDES if sd[k]["n"]]
            if len(on) == 1 and sd[on[0]]["outlets"] >= 2:
                one.append(((-sd[on[0]]["outlets"], -last, s["sid"]), s, ms, case))
    out = []
    for tier, lst in (("split", split), ("both", both), ("one_side", one)):
        out += [(tier, s, ms, case) for _k, s, ms, case in sorted(lst, key=lambda x: x[0])]
    return out


def _title(s, ms, case):
    ai = s.get("ai") if isinstance(s.get("ai"), dict) else {}
    if isinstance(ai.get("headline_ja"), str) and ai["headline_ja"].strip():
        return {"text": ai["headline_ja"][:120], "outlet": None, "lang": "ja", "ai": True}
    rep = next((m for m in ms if m.get("id") == case.get("rep_id")), None) or sorted(ms, key=lambda m: (m.get("ts") or 0))[0]
    return {"text": (rep.get("title") or "")[:140], "outlet": rep.get("outlet"), "lang": rep.get("lang") if rep.get("lang") in ("ja", "en") else "ja", "ai": False}


def compute(latest, board=None, relations=None, reaction=None, now=None):
    run = latest.get("ai_run") if isinstance(latest.get("ai_run"), dict) else {}
    snap = latest.get("ai_snapshot") if isinstance(latest.get("ai_snapshot"), dict) else {}
    ai_at = run.get("at") or snap.get("ai_at")
    same = (relations or {}).get("same") or {}
    rev = (reaction or {}).get("events") or {}
    picks = []
    for tier, s, ms, case in candidates(latest, board)[:MAX_PICKS]:
        cov = case.get("coverage") if isinstance(case.get("coverage"), dict) else None
        title = _title(s, ms, case)
        if title["ai"]:
            title["at"] = ai_at
            title["model"] = run.get("model") if isinstance(run.get("model"), str) else None
        r = rev.get(s["sid"]) if isinstance(rev.get(s["sid"]), dict) else None
        reaction_v = None
        if r and (r.get("hb") or r.get("yt")):
            reaction_v = {"hb": (r.get("hb") or {}).get("sum"), "hb_at": (r.get("hb") or {}).get("at"),
                          "yt": (r.get("yt") or {}).get("views"), "yt_at": (r.get("yt") or {}).get("at")}
        ph = case.get("photo") if isinstance(case.get("photo"), dict) else None
        picks.append({
            "sid": s["sid"], "tier": tier, "title": title, "n_outlets": s.get("n_outlets"), "first_ts": s.get("first_ts"), "last_ts": s.get("last_ts"),
            "sides": _sides(ms), "points": _points(cov),
            "findings": [{k: f.get(k) for k in ("kind", "text", "side")} for f in (cov.get("findings") or [])[:3]] if cov else [],
            "heads": _heads(ms), "same": _same(same.get(s["sid"])), "reaction": reaction_v,
            "photo": {"url": ph.get("url"), "outlet": ph.get("outlet")} if ph and isinstance(ph.get("url"), str) and ph["url"].startswith("https://") else None})
    out = {"schema": SCHEMA, "generated_at": int(now if now is not None else time.time()), "latest_generated_at": latest.get("generated_at"),
           "ai": run.get("status"), "picks": picks}
    while len(json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > MAX_BYTES and out["picks"]:
        out["picks"].pop()                                                 # 大きすぎる時は後ろの候補から落とす（最初の一枚は残す）
    return out


def _read(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m parallax.hero")
    for k in ("latest", "board", "relations", "reaction"):
        ap.add_argument("--" + k, default=str(ROOT / "data" / (k + ".json")))
    ap.add_argument("--out", default=str(ROOT / "data" / "hero.json"))
    a = ap.parse_args(argv)
    latest = _read(a.latest)
    if not latest:
        print("hero: no latest.json (previous file kept)", file=sys.stderr)
        return 0
    d = compute(latest, _read(a.board), _read(a.relations), _read(a.reaction))
    from parallax.extras import write_json
    write_json(a.out, d)
    print("hero picks=%d tiers=%s bytes=%d" % (len(d["picks"]), [p["tier"] for p in d["picks"]], Path(a.out).stat().st_size))
    return 0


if __name__ == "__main__":
    sys.exit(main())
