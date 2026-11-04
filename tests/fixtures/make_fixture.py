# -*- coding: utf-8 -*-
"""tests/fixtures/items.json を作る（合成の見出しだけ・網に出ない）。

    python tests/fixtures/make_fixture.py

見出しは「試験 出来事A」「Test Event A」のように明らかに作り物と判る形。リンクは test.invalid（実在しない）。
JS の試験も同じ items.json を読む。"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent))
from parallax import sources  # noqa: E402

NOW = 1762300000          # 固定値（2025-11-05 00:26:40 UTC）。--now にこれを渡す


def mk(sid, title, minutes_ago, key, ts="auto"):
    s = sources.by_id(sid)
    it = {"title": title, "link": "https://test.invalid/%s/%s" % (sid, key), "outlet": s["outlet"],
          "source_id": sid, "type": s["type"], "home": s["home"], "lang": s["lang"],
          "ts": (NOW - minutes_ago * 60) if ts == "auto" else ts}
    it["id"] = sources.item_id(it)
    return it


def items():
    out = [
        # A（日本語）: 3 媒体が同じ試験の出来事。NHK は同じ媒体の二本（束は媒体ごとに 1 本へ畳む）
        mk("tbs", "試験 出来事A 試験委員会が試験案を決定", 60, "a1"),
        mk("mainichi-flash", "試験 出来事A 試験委員会 試験案を決定した", 50, "a2"),
        mk("toyokeizai", "試験委員会が出来事Aの試験案を決定 試験市場に影響", 40, "a3"),
        mk("nhk-main", "試験 出来事A 試験委員会が試験案を決定", 58, "a7"),
        mk("nhk-society", "試験 出来事A 試験委員会が試験案を決定 続報", 20, "a8"),
        # A（英語）: 海外の 3 媒体
        mk("bbc-world", "Test Event A: test committee decides test plan", 55, "a4"),
        mk("guardian-world", "Test committee decides test plan for Test Event A", 45, "a5"),
        mk("aljazeera", "Test Event A test committee approves test plan", 30, "a6"),
        # B: 海外のみ・日本に関わる語を含む（Japan）
        mk("bbc-asia", "Test Event B: Japan test ministry announces test rule", 120, "b1"),
        mk("scmp-asia", "Japan test ministry announces Test Event B test rule", 100, "b2"),
        # C: 政府一次（ok の源）の 3 本（C は二本・D は別の出来事）。E は規則では結ばれず、緩い結びで同じ塊に入る
        mk("mof", "試験 出来事C 財務省 試験の公表", 200, "c1"),
        mk("soumu", "試験 出来事C 総務省 試験の公表", 190, "c2"),
        mk("fsa", "試験 出来事D 金融庁 試験の公表", 180, "c3"),
        # E: 政府一次・単独（ok の源。C と緩く結ばれ、AI が合併するかを試す）
        mk("mlit", "試験 出来事E 国交省 単独の公表", 70, "e1"),
        # H: 政府一次・単独・源の条件が unknown（gov_only の候補で、公開版では見出しを隠す側）
        mk("maff", "試験 出来事H 農林水産省 試験用の米穀備蓄の掲示", 75, "h1"),
        # F: 単独・日本と無関係
        mk("fed", "Test Event F Federal Reserve test statement", 80, "f1"),
        # G: 海外の単独・日本に関わる語（intl_japan の候補）
        mk("dw-world", "Test Event G Tokyo test festival opens", 90, "g1"),
        # 落ちるべき物: 期間外・時刻なし・未来・同じ id（重複）
        mk("bbc-world", "Test Event Z old item outside window", 60 * 80, "z1"),
        mk("bbc-world", "Test Event Y item without time", 0, "z2", ts=None),
        mk("bbc-world", "Test Event X item from the far future", 0, "z3", ts=NOW + 7200),
    ]
    out.append(dict(out[0]))                     # 同じ id をもう一度（先勝ち）
    return out


def sources_rows(its):
    rows = []
    for s in sources.SOURCES:
        mine = [i for i in its if i["source_id"] == s["id"] and isinstance(i["ts"], int)]
        bad = s["id"] in ("npr-world", "kantei")          # 取得に失敗した源（赤で出る側の確認用）
        rows.append({"id": s["id"], "name": s["name"], "outlet": s["outlet"], "type": s["type"],
                     "home": s["home"], "lang": s["lang"], "ok": bool(mine) and not bad,
                     "n": 0 if bad else len(mine), "fetched_at": NOW - 600,
                     "newest_ts": max(i["ts"] for i in mine) if mine and not bad else None,
                     "err": "試験: timeout" if bad else ("" if mine else "項目なし"),
                     "terms": s["terms"], "terms_status": s["terms_status"]})
    return rows


if __name__ == "__main__":
    its = items()
    doc = {"fetched_at": NOW, "items": its, "sources": sources_rows(its)}
    p = HERE / "items.json"
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("wrote", p, len(its), "items")
