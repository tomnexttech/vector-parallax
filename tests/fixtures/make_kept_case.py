# -*- coding: utf-8 -*-
"""tests/fixtures/kept_case.json を作る。前回の AI の見方を保った回（CONTRACT §12）の例を、js/snapshot.js と js/rerun.js の試験に渡す。

    python tests/fixtures/make_kept_case.py

previous = 合成の取得を、行儀のよい偽の AI で組んだ回（NOW）。
nokey / error = その後の回（NOW + 1 時間）。前者は鍵なし、後者は Gemini の呼びが全部 429。どちらも previous の AI の見方を ai_snapshot に保つ。
後の回の取得からは bbc-world の見出しを抜いてあるので、前回にだけある item があり、混ざれば見つかる。
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent.parent))

from helpers import NOW, build, fake, load_items, load_prompt  # noqa: E402
from parallax import ai  # noqa: E402

PROMPT = load_prompt()


def main():
    snap = load_items()
    prev, _ = build.build(snap["items"], snap["sources"], NOW, 36, fake(), "off", PROMPT, False)
    fewer = [it for it in snap["items"] if it.get("source_id") != "bbc-world"]
    later = NOW + 3600
    nokey, _ = build.build(fewer, snap["sources"], later, 36, None, "nokey", PROMPT, False, prev)
    failing = ai.FakeProvider(lambda *a: (None, "quota"))
    error, _ = build.build(fewer, snap["sources"], later, 36, failing, "off", PROMPT, False, prev)
    for name, d in (("nokey", nokey), ("error", error)):
        assert d["ai_run"]["status"] == "kept_previous", name
        assert build.check_output(d) == [], name
    out = {"version": "parallax-kept-case/1", "now": later, "ai_at": NOW, "previous": prev, "nokey": nokey, "error": error}
    path = HERE / "kept_case.json"
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8", newline="\n")
    print("wrote", path, path.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
