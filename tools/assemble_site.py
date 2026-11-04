# -*- coding: utf-8 -*-
"""assemble_site — put the page and the data into one folder, the Pages artifact (CONTRACT 20.1). Stdlib only.

    python tools/assemble_site.py [--out _site] [--root .]

Copies a whitelist only: the page files, the generated data (headlines live here, and only here) and the tracked settings.
Never copied: recorded.json, eval.json (no recorded run exists in Actions: the page shows "not measured"), summary_cache.json,
og_robots.json, withheld.json, history.json (the build's own lineage memory). Exit status 1 when the page or latest.json is missing (a deploy must not publish a page without data).
"""
import argparse
import shutil
import sys
from pathlib import Path

PAGE_FILES = ("index.html", "sw.js", "manifest.webmanifest", ".nojekyll")
PAGE_DIRS = ("css", "js", "assets")
DATA_FILES = ("latest.json", "stats.json", "board.json", "politics.json", "critical.json", "hazards.json", "markets.json",   # generated
              "prompt.json", "labels.json", "watchwords.json", "places.json", "traps.json", "scenes.json")                    # tracked settings
NEVER = ("recorded.json", "eval.json", "history.json", "summary_cache.json", "og_robots.json", "withheld.json")
DROP_FROM_LATEST = ("name_gate",)           # internal counts the page does not show


def assemble(root, out):
    root, out = Path(root), Path(out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    copied, missing = [], []
    for f in PAGE_FILES:
        if (root / f).is_file():
            shutil.copy2(root / f, out / f)
            copied.append(f)
        elif f != ".nojekyll":
            missing.append(f)
    (out / ".nojekyll").write_text("", encoding="utf-8")
    for d in PAGE_DIRS:
        if (root / d).is_dir():
            shutil.copytree(root / d, out / d)
            copied.append(d + "/")
        else:
            missing.append(d + "/")
    (out / "data").mkdir()
    for f in DATA_FILES:
        src = root / "data" / f
        if src.is_file():
            if f == "latest.json":
                import json
                d = json.loads(src.read_text(encoding="utf-8"))
                for k in DROP_FROM_LATEST:
                    d.pop(k, None)
                (out / "data" / f).write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            else:
                shutil.copy2(src, out / "data" / f)
            copied.append("data/" + f)
        else:
            missing.append("data/" + f)
    return copied, missing


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="_site")
    ap.add_argument("--root", default=".")
    a = ap.parse_args(argv)
    copied, missing = assemble(a.root, a.out)
    print("site: %d entries copied to %s; missing: %s" % (len(copied), a.out, missing or "none"))
    return 1 if ("index.html" in missing or "data/latest.json" in missing) else 0


if __name__ == "__main__":
    sys.exit(main())
