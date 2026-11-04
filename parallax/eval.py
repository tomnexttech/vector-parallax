# -*- coding: utf-8 -*-
"""eval — 記録済みの AI の実行を、機械で数えられる失敗の種類ごとに数える（標準ライブラリだけ）。docs/CONTRACT-public.md §11。

    python -m parallax.eval --items work/items.json --responses data/recorded.json [--now EPOCH] [--window-h 36]
                            [--out data/eval.json] [--made-at EPOCH]

同じ要求を組み直し、記録済みの答えを build と同じ validate に通して数える。書くのは数と sid だけ（見出しは書かない）。
人の判定（human）は空欄（null）のまま残す。この台本は人の判定の数を作らない。
数えるのは「疑い」までで、正誤は決めない。地名の札は、既知の誤りの型の一覧（cluster.PLACE_TRAPS）に当たる物だけ数える。
"""
import argparse
import json
import re
import sys
import time

try:
    from parallax import ai as ai_mod
    from parallax import build as build_mod
    from parallax import cluster as cluster_mod
except ImportError:                                   # parallax/ の中から直に走らせた時
    import ai as ai_mod  # type: ignore
    import build as build_mod  # type: ignore
    import cluster as cluster_mod  # type: ignore

SCHEMA = "parallax-eval/1"
MAX_VETO_NOTES = 3
MAX_NOTE_LEN = 80


def suspect_merges(stories, rule_clusters, items):
    """併合した AI の story の疑い。-> [{"sid","bid","rule_cids","veto":[...],"no_shared":bool}]（疑いのある物だけ）"""
    rc = {r["cid"]: r for r in rule_clusters}
    out = []
    for s in stories:
        if s["origin"] != "ai" or len(s["rule_cids"]) < 2:
            continue
        veto = []
        for n, ca in enumerate(s["rule_cids"]):
            for cb in s["rule_cids"][n + 1:]:
                for ia in rc[ca]["member_ids"]:
                    for ib in rc[cb]["member_ids"]:
                        if ia not in s["member_ids"] or ib not in s["member_ids"]:
                            continue
                        a, b = items[ia], items[ib]
                        _, vetoed, why = cluster_mod.similarity(a["title"], b["title"], a["outlet"], b["outlet"])
                        if vetoed and why and why[:MAX_NOTE_LEN] not in veto:
                            veto.append(why[:MAX_NOTE_LEN])
        basis = s.get("basis") or {}
        no_shared = not basis.get("words") and not basis.get("places")
        if veto or no_shared:
            out.append({"sid": s["sid"], "bid": s["bid"], "rule_cids": len(s["rule_cids"]),
                        "veto": veto[:MAX_VETO_NOTES], "no_shared": no_shared})
    return out


def place_misreads(stories, items):
    """既知の誤りの型（cluster.PLACE_TRAPS: 地名の略字が別の語の一部になっている物。例「米中間選挙」の「米中」）が
    地名の札（basis.places）として残っている story。-> [{"sid","label"}]（当たった物だけ）。
    当たる条件: 札が basis.places にあり、束の見出しのどれかに誤りの型の語が入っていて、その語を除くと
    どの見出しからもその札が取れない。見出しの無い item は見ない。一覧に無い誤りは数えない（人の判定の欄）。"""
    out = []
    for s in stories:
        for label in (s.get("basis") or {}).get("places") or []:
            phrases = cluster_mod.PLACE_TRAPS.get(label)
            if not phrases:
                continue
            lows = [cluster_mod._nf(items[m]["title"]).lower() for m in s["member_ids"] if items[m].get("title")]
            if not any(ph in t for t in lows for ph in phrases):
                continue
            stripped = []
            for t in lows:
                for ph in phrases:
                    t = t.replace(ph, "")
                stripped.append(t)
            if not any(label in cluster_mod._concepts(t, set(re.findall(r"[a-z0-9]+", t))) for t in stripped):
                out.append({"sid": s["sid"], "label": label})
    return out


def run_eval(items, status, now, window_h, provider, prompt, made_at):
    """-> eval.json の中身。items は取得の写し（全見出し）。provider は記録済みの答えを返す物。"""
    data, _ = build_mod.build(items, status, now, window_h, provider, "off", prompt, False)
    run = data["ai_run"]
    answered = run["blocks_ok"]
    errs = run["errors"]
    judged = answered > 0                              # 答えが一つも無ければ、答えに対する数は「判定していない」= null
    ai_stories = [s for s in data["stories"] if s["origin"] == "ai"]
    merged = [s for s in ai_stories if len(s["rule_cids"]) >= 2]
    sus = suspect_merges(data["stories"], data["rule_clusters"], data["items"]) if judged else []
    pm = place_misreads(data["stories"], data["items"]) if judged else []
    n = lambda v: v if judged else None
    counts = {
        "fabricated_ids": n(run["dropped_ids"]), "dup_ids": n(run["dup_ids"]), "unassigned_ids": n(run["unassigned_ids"]),
        "json_broken": errs.count("json"), "shape_broken": errs.count("shape"), "answers_missing": errs.count("missing"),
        "flags_proposed": n(sum(len(s["ai"]["flags"]) + len(s["ai"]["flags_dropped"]) for s in ai_stories)),
        "flags_vetoed": n(run["flags_vetoed"]), "quoted_fields": n(run["quoted_fields"]),
        "suspect_merges_veto": n(sum(1 for x in sus if x["veto"])),
        "suspect_merges_no_shared": n(sum(1 for x in sus if x["no_shared"])),
        "place_misread_known": n(len(pm)),
        "calls": run["calls"], "calls_failed": run["calls_failed"],
        "blocks_sent": run["blocks_sent"], "blocks_answered": answered,
        "ai_stories": n(len(ai_stories)), "merged_stories": n(len(merged)),
    }
    return {"schema": SCHEMA, "made_at": int(made_at),
            "run": {"provider": run["provider"], "model": run["model"], "recorded_at": run["at"],
                    "note_ja": run["note_ja"]},
            "input": {"items_in_window": len(data["items"]), "rule_clusters": len(data["rule_clusters"]),
                      "blocks_sent": len(data["blocks"]), "calls": len(data["ai_requests"])},
            "counts": counts, "suspect_merges": sus, "place_misreads": pm,
            "human": {"reviewed": None, "wrong_merges": None, "wrong_splits": None, "wrong_places": None, "note_ja": ""}}


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m parallax.eval", description=__doc__.split("\n")[0])
    ap.add_argument("--items", required=True, help="取得の写し（build の --save-items の形）")
    ap.add_argument("--responses", required=True, help="記録済みの答え（data/recorded.json の形）")
    ap.add_argument("--out", default=str(build_mod.ROOT / "data" / "eval.json"))
    ap.add_argument("--window-h", type=int, default=build_mod.DEFAULT_WINDOW_H)
    ap.add_argument("--now", type=int, help="既定は --items の fetched_at")
    ap.add_argument("--made-at", type=int, help="この file を作った時刻（既定は現在）")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    with open(a.items, encoding="utf-8") as f:
        snap = json.load(f)
    now = a.now if a.now is not None else int(snap.get("fetched_at") or time.time())
    prompt = build_mod.load_prompt()
    provider = ai_mod.RecordedProvider.from_file(a.responses)
    res = run_eval(snap["items"], snap.get("sources", []), now, a.window_h, provider, prompt,
                   a.made_at if a.made_at is not None else int(time.time()))
    build_mod.write_json(a.out, res)
    print("eval: " + " ".join("%s=%s" % (k, v) for k, v in res["counts"].items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
