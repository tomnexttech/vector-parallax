# -*- coding: utf-8 -*-
"""assemble_site — put the page and the data into one folder, the Pages artifact (CONTRACT 20.1). Stdlib only.

    python tools/assemble_site.py [--out _site] [--root .]

Copies a whitelist only: the page files, the generated data (headlines live here, and only here) and the tracked settings.
Never copied: recorded.json, eval.json (no recorded run exists in Actions: the page shows "not measured"), summary_cache.json,
og_robots.json, withheld.json, history.json as it is (the build's own lineage memory: its event keys and words stay home; the site gets
history.json as three numbers only, how many it holds, how many days and when it was written, which is all the page shows). Exit status 1 when the page or latest.json is missing (a deploy must not publish a page without data).

Then the pages and feeds of CONTRACT 21 (parallax/site.py): s/<sid>.html for each event, feed.xml, feed-oneside.xml and feed-<field>.xml, and
data/archive/ (seven days, carried from the last deploy through --base-url; --no-archive-fetch for a run without the network). A failure there
is printed and the site is deployed without them: it never stops the page.
"""
import argparse
import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from parallax import site  # noqa: E402

PAGE_FILES = ("index.html", "sw.js", "manifest.webmanifest", ".nojekyll")
PAGE_DIRS = ("css", "js", "assets")
DATA_FILES = ("latest.json", "stats.json", "board.json", "politics.json", "critical.json", "hazards.json", "markets.json",   # generated
              "relations.json", "reaction.json", "impact.json", "hero.json",                                                  # generated (CONTRACT 24-26)
              "aliases.json", "lifewords.json",                                                                               # tracked rules of 24 and 25.2
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
                d = json.loads(src.read_text(encoding="utf-8"))
                for k in DROP_FROM_LATEST:
                    d.pop(k, None)
                (out / "data" / f).write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            else:
                shutil.copy2(src, out / "data" / f)
            copied.append("data/" + f)
        else:
            missing.append("data/" + f)
    hist = root / "data" / "history.json"
    if hist.is_file():
        try:
            h = json.loads(hist.read_text(encoding="utf-8"))
        except ValueError:
            h = {}
        h = h if isinstance(h, dict) else {}
        ent = h.get("entries")
        small = {"schema": h.get("schema"), "updated_at": h.get("updated_at"), "days": h.get("days"), "n": len(ent) if isinstance(ent, list) else 0}
        (out / "data" / "history.json").write_text(json.dumps(small, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        copied.append("data/history.json")
    return copied, missing


def _read(path):
    try:
        d = json.loads(Path(path).read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else None
    except (OSError, ValueError):
        return None


def pages(root, out, base, fetch=site.fetch_json):
    """CONTRACT 21. Reads the copied latest.json (without the dropped fields) and the board; prints counts and seconds, never a headline"""
    t0 = time.time()
    latest, board = _read(Path(out) / "data" / "latest.json"), _read(Path(root) / "data" / "board.json")
    if not latest or not board:
        print("site pages: skipped (latest.json or board.json missing)")
        return None
    try:
        r = site.write_site(out, latest, board, base, fetch, _read(Path(root) / "data" / "withheld.json"))
    except Exception as ex:        # noqa: BLE001 — the page is deployed without the pages rather than not at all
        print("site pages: error %s" % type(ex).__name__)
        return None
    print("site pages: %d pages (%d now, %d kept, %d alias), %d feeds %s, archive %d days (today %d events, from previous %s%s), %.1f s"
          % (r["pages"], r["pages_now"], r["pages_kept"], r["pages_alias"], r["feeds"], r["feed_items"], r["archive_days"], r["archive_today"],
             r["archive_from_previous"] or "none", ("; " + r["archive_note"]) if r["archive_note"] else "", time.time() - t0))
    return r


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="_site")
    ap.add_argument("--root", default=".")
    ap.add_argument("--base-url", default=site.BASE_URL, help="the public address: canonical links, feeds, and where the last deploy's archive is read")
    ap.add_argument("--no-archive-fetch", action="store_true", help="do not read the last deploy's archive (today only)")
    ap.add_argument("--no-pages", action="store_true", help="copy the page and the data only (CONTRACT 21 not made)")
    a = ap.parse_args(argv)
    copied, missing = assemble(a.root, a.out)
    print("site: %d entries copied to %s; missing: %s" % (len(copied), a.out, missing or "none"))
    if not a.no_pages and "data/latest.json" not in missing:
        pages(a.root, a.out, a.base_url, None if a.no_archive_fetch else site.fetch_json)
    return 1 if ("index.html" in missing or "data/latest.json" in missing) else 0


if __name__ == "__main__":
    sys.exit(main())
