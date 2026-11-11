# -*- coding: utf-8 -*-
"""束ねの正誤を人が採点するための組を抜き出し、採点の結果から率を出す（標準ライブラリだけ・網に出ない・AI を呼ばない）。

    # 1) 抜き出す: 公開の latest.json（何回分でも）から組を選び、採点の HTML を一枚書く
    python tools/eval_pairs.py sample --latest latest.json [latest2.json ...] --html PARALLAX_採点.html --pairs pairs.json
    # 2) 数える: HTML の「書き出す」で保存した JSON から率を出す
    python tools/eval_pairs.py score --pairs pairs.json --results parallax_score_*.json [--md table.md]

組の種類（group）:
  ai_joined   AI が別々の規則の束を一つの出来事に結んだ組（AI の story の rule_cids が 2 つ以上・束をまたぐ見出し 2 本）
  rule_joined 規則が一つの束に結び、最後まで一つの出来事のままだった組（同じ規則の束・別の媒体の見出し 2 本）
  ai_split    規則は結んだが AI が別の出来事に割った組（ある時だけ）
  near_apart  結ばれなかったが似ている組（同じ塊で AI に送られ、別の出来事のまま残った見出し 2 本。似ている順に上から選ぶ）
抜き出し方: 乱数の種を固定（既定 20261114）。ai_joined は出来事ごとに順番に 1 組ずつ（大きな出来事に偏らない）、
rule_joined は束ごとに 1 組（束を無作為に並べて上から）、near_apart は塊ごとに順番に、似ている順の上位から。
同じ見出しの組は一度だけ。採点の画面では種類を伏せ、並びも種で混ぜる。

この台本は人の判定を作らない。AI の下読み（--prelabel）は別の欄に置き、人の数に混ぜない。
pairs.json と HTML は見出しを持つので、リポジトリに入れない（CONTRACT 20.1）。既定の置き場はリポジトリの外。
"""
import argparse
import hashlib
import html
import json
import math
import random
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from parallax import cluster as cluster_mod  # noqa: E402

SCHEMA_PAIRS = "parallax-pairs/1"
SCHEMA_RESULTS = "parallax-pairs-score/1"
DEFAULT_SEED = 20261114
GROUPS = ("ai_joined", "rule_joined", "ai_split", "near_apart")
JOINED = ("ai_joined", "rule_joined")        # 束ねた側。「別の出来事」= 誤って結んだ
APART = ("ai_split", "near_apart")           # 分けた側。「同じ出来事」= 誤って分けた
LABELS = ("same", "diff", "unsure")


def pid_of(a, b):
    x, y = sorted((a, b))
    return hashlib.sha256(("%s|%s" % (x, y)).encode()).hexdigest()[:12]


def side(it):
    return {"outlet": it.get("outlet") or "", "ts": int(it.get("ts") or 0), "link": it.get("link") or "",
            "title": it.get("title") or "", "lang": it.get("lang") or ""}


def sim(a, b):
    try:
        s, vetoed, _ = cluster_mod.similarity(a.get("title") or "", b.get("title") or "", a.get("outlet") or "", b.get("outlet") or "")
        return round(float(s), 3), bool(vetoed)
    except Exception:
        return None, None


def candidates(d):
    """1 回の構築（latest.json）から種類ごとの候補を作る。-> {group: [[(a, b, meta), ...] 出来事・束・塊ごと]}"""
    items = d["items"]
    run = d.get("ai_run") or {}
    bm = run.get("block_models") or {}
    model_of = lambda bid: bm.get(bid) or (run.get("model") if run.get("provider") == "gemini" else None)
    story_of, cid_of = {}, {}
    for s in d["stories"]:
        for m in s["member_ids"]:
            story_of[m] = s["sid"]
    for r in d["rule_clusters"]:
        for m in r["member_ids"]:
            cid_of[m] = r["cid"]
    block_of_cid, answered = {}, set()
    for b in d.get("blocks") or []:
        for c in b["cids"]:
            block_of_cid[c] = b["bid"]
        if b.get("ai") == "answered":
            answered.add(b["bid"])
    ok = lambda i: i in items and (items[i].get("title") or "").strip()
    out = {g: [] for g in GROUPS}
    for s in d["stories"]:                                   # ai_joined
        if s.get("origin") != "ai" or len(s.get("rule_cids") or []) < 2:
            continue
        mem = [m for m in s["member_ids"] if ok(m)]
        prs = [(a, b) for n, a in enumerate(mem) for b in mem[n + 1:]
               if cid_of.get(a) != cid_of.get(b) and items[a]["outlet"] != items[b]["outlet"]]
        if prs:
            out["ai_joined"].append([(a, b, {"model": model_of(s.get("bid")), "unit": s["sid"]}) for a, b in prs])
    for r in d["rule_clusters"]:                             # rule_joined / ai_split
        mem = [m for m in r["member_ids"] if ok(m)]
        prs = [(a, b) for n, a in enumerate(mem) for b in mem[n + 1:] if items[a]["outlet"] != items[b]["outlet"]]
        if not prs:
            continue
        bid = block_of_cid.get(r["cid"])
        meta = {"model": model_of(bid) if bid in answered else None, "unit": r["cid"],
                "seen_by_ai": bid in answered}
        kept = [(a, b, meta) for a, b in prs if story_of.get(a) == story_of.get(b)]
        split = [(a, b, meta) for a, b in prs if story_of.get(a) != story_of.get(b)]
        if kept:
            out["rule_joined"].append(kept)
        if split:
            out["ai_split"].append(split)
    for b in d.get("blocks") or []:                          # near_apart
        mem = [m for c in b["cids"] for r in d["rule_clusters"] if r["cid"] == c for m in r["member_ids"] if ok(m)]
        prs = []
        for n, x in enumerate(mem):
            for y in mem[n + 1:]:
                if story_of.get(x) == story_of.get(y) or items[x]["outlet"] == items[y]["outlet"]:
                    continue
                s, _ = sim(items[x], items[y])
                prs.append((s if s is not None else -1, x, y))
        prs.sort(key=lambda t: (-t[0], t[1], t[2]))
        if prs:
            meta = {"model": model_of(b["bid"]) if b["bid"] in answered else None, "unit": b["bid"],
                    "seen_by_ai": b["bid"] in answered}
            out["near_apart"].append([(x, y, meta) for _, x, y in prs])
    return out


def round_robin(units, n, rng, shuffle_inside=True, used=None):
    """出来事・束・塊ごとの候補の列から、ユニットを一巡ずつ 1 組ずつ取る。"""
    used = used if used is not None else set()
    units = [list(u) for u in units]
    rng.shuffle(units)
    if shuffle_inside:
        for u in units:
            rng.shuffle(u)
    got = []
    while len(got) < n and any(units):
        for u in units:
            while u:
                a, b, meta = u.pop(0)
                k = pid_of(a, b)
                if k in used:
                    continue
                used.add(k)
                got.append((a, b, meta))
                break
            if len(got) >= n:
                break
    return got


def sample(latests, quota, seed=DEFAULT_SEED):
    rng = random.Random(seed)
    pairs, used, sources = [], set(), []
    per = {g: max(1, math.ceil(quota[g] / max(1, len(latests)))) if quota.get(g) else 0 for g in GROUPS}
    for path, d in latests:
        cand = candidates(d)
        run = d.get("ai_run") or {}
        sources.append({"file": Path(path).name, "generated_at": d.get("generated_at"), "ai_model": run.get("model"),
                        "ai_tier": run.get("tier"), "candidates": {g: sum(len(u) for u in cand[g]) for g in GROUPS},
                        "units": {g: len(cand[g]) for g in GROUPS}})
        for g in GROUPS:
            take = round_robin(cand[g], per[g], rng, shuffle_inside=(g != "near_apart"), used=used)
            for a, b, meta in take:
                ia, ib = d["items"][a], d["items"][b]
                s, vetoed = sim(ia, ib)
                pairs.append({"pid": pid_of(a, b), "group": g, "build": d.get("generated_at"), "model": meta.get("model"),
                              "seen_by_ai": meta.get("seen_by_ai", g == "ai_joined"), "unit": meta.get("unit"),
                              "rule_score": s, "rule_vetoed": vetoed, "a": side(ia), "b": side(ib)})
    order = list(range(len(pairs)))
    rng.shuffle(order)
    pairs = [pairs[i] for i in order]
    for n, p in enumerate(pairs):
        p["n"] = n + 1
        if rng.random() < 0.5:                               # 左右も混ぜる（先に出た方が束の頭、という手掛かりを消す）
            p["a"], p["b"] = p["b"], p["a"]
    return {"schema": SCHEMA_PAIRS, "made_at": int(time.time()), "seed": seed, "quota": quota,
            "method": ("ai_joined: 出来事ごとに一巡ずつ 1 組（束をまたぐ・別の媒体）; rule_joined: 束を無作為に並べ 1 組ずつ（別の媒体・最後まで同じ出来事）; "
                       "ai_split: 規則の束を AI が割った組（あれば全部まで）; near_apart: 同じ塊で AI に送られ別の出来事に残った組を、塊ごとに似ている順の上から; "
                       "同じ組は一度だけ・画面の並びと左右は種で混ぜる"),
            "sources": sources, "counts": {g: sum(1 for p in pairs if p["group"] == g) for g in GROUPS}, "pairs": pairs}


# ---------------------------------------------------------------- 採点の結果から率
def wilson(k, n, z=1.96):
    if n == 0:
        return None
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [round(max(0.0, c - h), 3), round(min(1.0, c + h), 3)]


def rate_row(name, pairs, labels, wrong):
    lab = [labels.get(p["pid"]) for p in pairs]
    n_same, n_diff, n_unsure = lab.count("same"), lab.count("diff"), lab.count("unsure")
    decided = n_same + n_diff
    k = n_diff if wrong == "diff" else n_same
    return {"name": name, "pairs": len(pairs), "scored": n_same + n_diff + n_unsure, "same": n_same, "diff": n_diff,
            "unsure": n_unsure, "wrong": k, "decided": decided,
            "rate": round(k / decided, 3) if decided else None, "ci95": wilson(k, decided)}


def score(pairs_doc, results, ai_prelabel=None):
    """-> {"human": [...行], "ai_prelabel": [...行] | None}。人の印だけを human に数える。"""
    pairs = pairs_doc["pairs"]
    known = {p["pid"] for p in pairs}
    raw = results.get("human") or results.get("labels") or {}
    human = {k: (v.get("v") if isinstance(v, dict) else v) for k, v in raw.items() if k in known}
    human = {k: v for k, v in human.items() if v in LABELS}

    def rows(labels):
        out = []
        joined = [p for p in pairs if p["group"] in JOINED]
        apart = [p for p in pairs if p["group"] in APART]
        out.append(rate_row("誤って結んだ率（束ねた組 全体）", joined, labels, "diff"))
        for g in JOINED:
            out.append(rate_row("誤って結んだ率・" + {"ai_joined": "AI が結んだ組", "rule_joined": "規則が結んだ組"}[g],
                                [p for p in pairs if p["group"] == g], labels, "diff"))
        models = sorted({p["model"] for p in pairs if p["group"] == "ai_joined" and p["model"]})
        for m in models:
            out.append(rate_row("誤って結んだ率・AI が結んだ組・" + m, [p for p in pairs if p["group"] == "ai_joined" and p["model"] == m], labels, "diff"))
        out.append(rate_row("誤って分けた率（分けた組 全体）", apart, labels, "same"))
        for g in APART:
            sub = [p for p in pairs if p["group"] == g]
            if sub:
                out.append(rate_row("誤って分けた率・" + {"ai_split": "AI が割った組", "near_apart": "似ているが分けた組"}[g], sub, labels, "same"))
        for m in sorted({p["model"] for p in apart if p["model"]}):
            out.append(rate_row("誤って分けた率・AI が見た塊・" + m, [p for p in apart if p["model"] == m], labels, "same"))
        return out
    pre = None
    if ai_prelabel:
        pl = {k: v for k, v in (ai_prelabel.get("labels") or {}).items() if k in known and v in LABELS}
        pre = rows(pl)
        agree = [k for k in human if k in pl]
        pre_agree = {"both": len(agree), "agree": sum(1 for k in agree if human[k] == pl[k])}
    else:
        pre_agree = None
    return {"schema": "parallax-pairs-rates/1", "pairs": len(pairs), "human_scored": len(human), "seed": pairs_doc.get("seed"),
            "sources": pairs_doc.get("sources"), "human": rows(human), "ai_prelabel": pre, "ai_prelabel_agreement": pre_agree}


def pct(x):
    return "—" if x is None else "%.1f%%" % (100 * x)


def md_table(res):
    lines = ["人の採点 %d / %d 組（種 %s）。率 = 誤り ÷（同じ＋別）。判らないは分母に入れない。括弧は 95%% の幅（Wilson）。"
             % (res["human_scored"], res["pairs"], res["seed"]), "",
             "| 項目 | 組 | 採点 | 誤り | 率 | 95% の幅 | 判らない |", "|---|---:|---:|---:|---:|---|---:|"]
    for r in res["human"]:
        ci = "—" if not r["ci95"] else "%s〜%s" % (pct(r["ci95"][0]), pct(r["ci95"][1]))
        lines.append("| %s | %d | %d | %d | %s | %s | %d |" % (r["name"], r["pairs"], r["scored"], r["wrong"], pct(r["rate"]), ci, r["unsure"]))
    if res.get("ai_prelabel"):
        lines += ["", "AI による下読み（人の数には入れない）。人の採点と両方ある組 %d のうち一致 %d。"
                  % (res["ai_prelabel_agreement"]["both"], res["ai_prelabel_agreement"]["agree"]), "",
                  "| 項目 | 誤り | 率 |", "|---|---:|---:|"]
        for r in res["ai_prelabel"]:
            lines.append("| %s | %d | %s |" % (r["name"], r["wrong"], pct(r["rate"])))
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- 採点の HTML
def write_html(pairs_doc, path, prelabel=None):
    tpl = (ROOT / "tools" / "eval_pairs_template.html").read_text(encoding="utf-8")
    view = {"schema": pairs_doc["schema"], "seed": pairs_doc["seed"], "made_at": pairs_doc["made_at"],
            "key": hashlib.sha256(json.dumps([p["pid"] for p in pairs_doc["pairs"]]).encode()).hexdigest()[:10],
            "pairs": [{"pid": p["pid"], "n": p["n"], "a": p["a"], "b": p["b"]} for p in pairs_doc["pairs"]],   # 種類・型の名は伏せる
            "ai_prelabel": (prelabel or {}).get("labels") or {}}
    blob = json.dumps(view, ensure_ascii=False).replace("</", "<\\/")
    Path(path).write_text(tpl.replace("/*__DATA__*/null", blob), encoding="utf-8", newline="\n")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python tools/eval_pairs.py", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sample")
    s.add_argument("--latest", nargs="+", required=True)
    s.add_argument("--pairs", required=True, help="抜き出した組（見出しを持つ。リポジトリの外へ）")
    s.add_argument("--html", help="採点の HTML の置き場")
    s.add_argument("--prelabel", help="AI の下読み {labels:{pid: same|diff|unsure}}（任意・人の数に混ぜない）")
    s.add_argument("--seed", type=int, default=DEFAULT_SEED)
    s.add_argument("--n-ai", type=int, default=40)
    s.add_argument("--n-rule", type=int, default=30)
    s.add_argument("--n-split", type=int, default=10)
    s.add_argument("--n-near", type=int, default=30)
    h = sub.add_parser("html")
    h.add_argument("--pairs", required=True)
    h.add_argument("--html", required=True)
    h.add_argument("--prelabel")
    c = sub.add_parser("score")
    c.add_argument("--pairs", required=True)
    c.add_argument("--results", required=True, help="採点の HTML が書き出した JSON")
    c.add_argument("--prelabel")
    c.add_argument("--out", help="率の JSON")
    c.add_argument("--md", help="資料へ写す短い表（Markdown）")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    load = lambda p: json.loads(Path(p).read_text(encoding="utf-8"))
    if a.cmd == "sample":
        doc = sample([(p, load(p)) for p in a.latest],
                     {"ai_joined": a.n_ai, "rule_joined": a.n_rule, "ai_split": a.n_split, "near_apart": a.n_near}, a.seed)
        Path(a.pairs).write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
        if a.html:
            write_html(doc, a.html, load(a.prelabel) if a.prelabel else None)
        print("pairs=%d %s" % (len(doc["pairs"]), " ".join("%s=%d" % (g, doc["counts"][g]) for g in GROUPS)))
        for src in doc["sources"]:
            print("source %s generated_at=%s model=%s candidates=%s" % (src["file"], src["generated_at"], src["ai_model"], src["candidates"]))
        return 0
    if a.cmd == "html":
        write_html(load(a.pairs), a.html, load(a.prelabel) if a.prelabel else None)
        return 0
    res = score(load(a.pairs), load(a.results), load(a.prelabel) if a.prelabel else None)
    if a.out:
        Path(a.out).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    table = md_table(res)
    if a.md:
        Path(a.md).write_text(table, encoding="utf-8")
    print(table)
    return 0


if __name__ == "__main__":
    sys.exit(main())
