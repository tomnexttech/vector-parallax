# -*- coding: utf-8 -*-
"""extras - the map and market data files, written independently of the news build (CONTRACT 18.7, 18.8).

    python -m parallax.extras [--out-dir data] [--only hazards,markets] [--now EPOCH]

Each file is written only when its fetch produced something (`ok`). When a section fails altogether the previous file is kept
(exit status 0, a line on stderr): the page then shows the previous time of that file, in red when it is old - an old value is
never shown as a current one. data/latest.json is not touched by this module.
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    from parallax import hazards, markets
except ImportError:                                       # run from inside parallax/
    import hazards  # type: ignore
    import markets  # type: ignore

ROOT = Path(__file__).resolve().parent.parent


def write_json(path, obj):
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    os.replace(tmp, path)


def run(name, fn, path, now):
    t0 = time.time()
    try:
        d = fn(now)
    except Exception as e:                                # fetch_all should not raise; this is the last net
        print("%s FAILED (previous file kept): %s: %s" % (name, type(e).__name__, e), file=sys.stderr)
        return False
    if not d.get("ok"):
        print("%s: nothing could be fetched (previous file kept): %s"
              % (name, {k: v.get("err") for k, v in d.get("sources", {}).items() if not v.get("ok")}), file=sys.stderr)
        return False
    write_json(path, d)
    return d, round(time.time() - t0, 1)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m parallax.extras")
    ap.add_argument("--out-dir", default=str(ROOT / "data"))
    ap.add_argument("--only", default="hazards,markets")
    ap.add_argument("--now", type=int)
    a = ap.parse_args(argv)
    now = a.now if a.now is not None else int(time.time())
    out = Path(a.out_dir)
    only = {x.strip() for x in a.only.split(",") if x.strip()}
    if "hazards" in only:
        r = run("hazards", lambda n: hazards.fetch_all(n), out / "hazards.json", now)
        if r:
            d, secs = r
            print("hazards typhoons=%d disasters=%d quakes_jp=%d quakes_world=%d tsunami=%d failed=%s (%.1fs)"
                  % (len(d["typhoons"]), len(d["disasters"]), len(d["quakes_jp"]), len(d["quakes_world"]), len(d["tsunami"]),
                     [k for k, v in d["sources"].items() if not v["ok"]], secs))
    if "markets" in only:
        r = run("markets", lambda n: markets.fetch_all(n), out / "markets.json", now)
        if r:
            d, secs = r
            print("markets series=%d ok=%d failed=%s (%.1fs)"
                  % (len(d["series"]), sum(1 for s in d["series"] if s["ok"]),
                     [s["id"] for s in d["series"] if not s["ok"]], secs))
    return 0


if __name__ == "__main__":
    sys.exit(main())
