# -*- coding: utf-8 -*-
"""CONTRACT 18/19: the net (watch), places, board, hazards, markets, politics, extras and the page-less sources.
Headlines are marked as synthetic ("試験 出来事A ..."); the network is never touched (fake getters)."""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from parallax import board, extras, hazards, markets, places, politics, sources, watch  # noqa: E402

NOW = 1762300000
H = 3600


def item(iid, source_id, title, ts, image=None):
    s = sources.by_id(source_id)
    return {"id": iid, "title": title, "link": "https://example.org/" + iid, "outlet": s["outlet"], "source_id": source_id,
            "type": s["type"], "home": s["home"], "lang": s["lang"], "ts": ts, "image": image}


def story(sid, items_):
    tss = [i["ts"] for i in items_ if i["ts"] is not None]
    return {"sid": sid, "origin": "rule", "rule_cids": ["c" + sid], "member_ids": [i["id"] for i in items_],
            "n_outlets": len({i["outlet"] for i in items_}), "first_ts": min(tss), "last_ts": max(tss), "ai": None}


def make_data():
    A = [item("a1", "nhk-politics", "試験 出来事A 法案 可決", NOW - 2 * H), item("a2", "asahi-politics", "試験 出来事A 法案 可決へ", NOW - H,
         {"url": "https://example.org/a.jpg", "from": "rss"})]
    B = [item("b1", "nhk-politics", "試験 出来事B 法案 可決", NOW - 30 * H)]
    C = [item("c1", "nhk-politics", "試験 出来事C 法案 可決", NOW - 30 * H), item("c2", "asahi-politics", "試験 出来事C 法案 可決", NOW - 20 * H)]
    D = [item("d1", "mof", "試験 出来事D 補正予算 予備費", NOW - 2 * H), item("d2", "soumu", "試験 出来事D 補正予算 予備費 公表", NOW - H)]
    E1 = [item("e1", "bbc-world", "試験 出来事E Tokyo flood evacuation order", NOW - H)]
    E2 = [item("e2", "bbc-world", "試験 出来事F Tokyo flood evacuation order again", NOW - 10 * H)]
    P = [item("p1", "party-cdp", "試験 出来事P 法案 可決", NOW - H), item("p2", "party-ldp", "試験 出来事P 法案 可決へ", NOW - H)]
    stories = [story("sA", A), story("sB", B), story("sC", C), story("sD", D), story("sE1", E1), story("sE2", E2), story("sP", P)]
    its = {i["id"]: i for g in (A, B, C, D, E1, E2, P) for i in g}
    return {"schema": "parallax/1", "generated_at": NOW, "window_h": 36, "edition": "public", "items": its, "stories": stories,
            "rule_clusters": [], "sources": [{"id": "nhk-politics", "name": "NHK 政治", "type": "公共放送", "home": "jp", "ok": True, "n": 3,
                                              "newest_ts": NOW - H, "oldest_ts": NOW - 40 * H, "err": ""}]}      # one Japanese mainstream feed, fetched, reaching back before every event (CONTRACT 20.3)


class Watch(unittest.TestCase):
    def test_flags_and_hits(self):
        f = watch.flags("政府がAI規制の新法案を閣議決定")
        self.assertTrue(f["law"] and f["tech"])
        self.assertIn("AI規制", f["hits"])
        self.assertTrue(watch.flags("首相が説明責任を果たさず回答を控える")["power"])
        self.assertTrue(watch.flags("震度6強の地震")["disaster"])

    def test_weak_needs_two_and_mask(self):
        self.assertFalse(watch.flags("予算について")["money"])           # one weak word is not enough
        self.assertTrue(watch.flags("予算 財政")["money"])               # two weak words are
        self.assertFalse(watch.flags("王座防衛戦")["security"])           # masked

    def test_exclude_keeps_strong_disaster_pattern(self):
        self.assertTrue(watch.flags("天気予報 震度6弱の地震")["disaster"])
        self.assertFalse(watch.flags("天気予報 大雨 洪水")["disaster"])

    def test_unknown_is_not_no(self):
        f = watch.flags(None)
        self.assertEqual(f["error"], "no headline")
        self.assertFalse(any(f[k] for k in watch.FLAGS))


class Places(unittest.TestCase):
    def test_table(self):
        with open(os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "places.json"), encoding="utf-8") as f:
            d = json.load(f)
        self.assertEqual((d["n_keys"], d["n_local"]), (428, 126))

    def test_location_and_weak(self):
        p = places.locate("東京で震度5強の地震")
        self.assertEqual((p["via"], p["prec"]), ("東京", "local"))
        self.assertIsNone(places.locate("対中関税をめぐり協議"))            # a topic, not a place
        self.assertIsNone(places.locate("試験 出来事Z 野党が法案を提出"))   # no place: none is better than a guess

    def test_context_spelling(self):
        self.assertEqual(places.locate("Georgia Tbilisi protest Kobakhidze")["prec"], "country")


class Board(unittest.TestCase):
    def setUp(self):
        self.d = make_data()
        self.b, self.hist = board.compose(self.d, None, NOW, None)

    def test_priority_rules(self):
        self.assertEqual(self.b["priority"][:3], ["sD", "sA", "sP"])      # primary source +0.5 puts sD first; then by weight x freshness
        self.assertNotIn("sB", self.b["priority"])                      # stale: nothing for 24 h
        self.assertNotIn("sB", self.b["cases"])
        self.assertNotIn("sC", self.b["priority"])                      # first report > 24 h ago and quiet for > 18 h
        self.assertEqual(self.b["examined"]["stale_dropped"], 1)
        self.assertEqual(self.b["examined"]["priority_dropped"], 1)

    def test_fresher_wins_at_equal_weight(self):
        self.assertLess(self.b["priority"].index("sE1"), self.b["priority"].index("sE2"))

    def test_number_of_outlets_is_not_weight(self):
        a, p = self.b["cases"]["sA"], self.b["cases"]["sP"]
        self.assertEqual(a["n_outlets"], 2)
        self.assertAlmostEqual(a["weight"] - p["weight"], 0.1 * (len(a["types"]) - len(p["types"])), 3)   # two outlets of two types vs one: only the types count

    def test_asymmetry_wording_and_kind(self):
        kinds = {a["sid"]: a["kind"] for a in self.b["asymmetry"]}
        self.assertEqual(kinds.get("sD"), "primary_only")
        self.assertEqual(kinds.get("sP"), "periphery_only")
        labels = {a["sid"]: a["label_ja"] for a in self.b["asymmetry"]}
        self.assertEqual(labels["sD"], "官公庁の資料だけ")
        self.assertEqual(labels["sP"], "政党機関紙だけ")                                     # the side that carried it, by type (CONTRACT 20.3)
        self.assertNotIn("sB", kinds)                                                      # one outlet: never labelled
        self.assertTrue(self.b["asym_status"]["complete"])
        text = json.dumps(self.b["asym_labels"], ensure_ascii=False)
        self.assertNotIn("報じなかった", text)
        self.assertNotIn("did not report", text)

    def test_case_anatomy(self):
        c = self.b["cases"]["sA"]
        self.assertEqual([t["off_min"] for t in c["timeline"]], [0, 60])
        self.assertEqual(c["fingerprint"][0]["first_off_min"], 0)
        self.assertEqual(sum(sum(r) for r in c["heat"]["rows"].values()), 2)
        self.assertEqual(c["images"][0]["url"], "https://example.org/a.jpg")
        self.assertEqual(c["flags"], ["law"])
        self.assertEqual(c["n_new6h"], 2)
        self.assertEqual(self.b["cases"]["sE1"]["place"]["via"], "Tokyo")

    def test_missing_time_is_not_zero(self):
        d = make_data()
        d["items"]["a2"]["ts"] = None
        b, _ = board.compose(d, None, NOW, None)
        self.assertEqual([t["off_min"] for t in b["cases"]["sA"]["timeline"]][-1], None)

    def test_volume_counts_real_headlines(self):
        raw = list(self.d["items"].values()) + [item("z1", "nhk-politics", "試験 範囲外", NOW - 100 * H),
                                                item("z2", "nhk-politics", "試験 日付なし", None)]
        b, _ = board.compose(self.d, raw, NOW, None)
        self.assertEqual(sum(b["volume"]["total"]), sum(1 for i in self.d["items"].values() if NOW - i["ts"] < 48 * H))   # 100 h ago and undated are not counted
        self.assertEqual(b["health"]["no_date"], 1)

    def test_lineage_from_history(self):
        hist = {"entries": [{"key": "old1", "first_ts": NOW - 90 * H, "last_ts": NOW - 80 * H, "n_outlets": 3,
                             "terms": board.key_terms("試験 出来事A 法案 可決")[:3], "cat": "国内政治"}]}
        b, h2 = board.compose(self.d, None, NOW, hist)
        self.assertEqual([e["key"] for e in b["cases"]["sA"]["lineage"]], ["old1"])
        self.assertTrue(any(e["key"] == "a1" for e in h2["entries"]))
        self.assertTrue(all("title" not in e for e in h2["entries"]))   # keys, times, counts and words only

    def test_write_extras_never_raises(self):
        from parallax import build
        with tempfile.TemporaryDirectory() as td:
            def down(url, timeout=0):
                raise OSError("down")
            build.write_extras(self.d, list(self.d["items"].values()), NOW, td, get=down)      # politics and critical on a dead network: must not raise
            self.assertTrue(os.path.exists(os.path.join(td, "board.json")))
            for name in ("politics.json", "critical.json"):
                self.assertTrue(os.path.exists(os.path.join(td, name)), name)
            with open(os.path.join(td, "critical.json"), encoding="utf-8") as f:
                self.assertEqual(json.load(f)["status"], "fail")


class Hazards(unittest.TestCase):
    def test_parse_quake_list_and_cancel(self):
        lst = [{"eid": "1", "ttl": "震源・震度情報", "ctt": "20260101000000", "at": "2026-01-01T00:00:00+09:00", "anm": "千葉県東方沖",
                "cod": "+35.4+140.4-40000/", "mag": "3.4", "maxi": "2", "json": "a.json", "rdt": "2026-01-01T00:05:00+09:00"},
               {"eid": "2", "ttl": "震源・震度情報", "ctt": "20260101010000", "at": "2026-01-01T01:00:00+09:00", "anm": "x", "ift": "取消",
                "cod": "+35.4+140.4-40000/", "json": "b.json"}]
        qs = hazards.parse_jma_quake_list(lst)
        self.assertEqual(len(qs), 1)
        self.assertEqual((qs[0]["mag"], qs[0]["maxint_jp"], qs[0]["depth_km"]), (3.4, "震度2", 40.0))

    def test_select_disasters_green_earthquake_not_shown(self):
        ev = [{"id": "g1", "type": "EQ", "alert": "Green", "from": "2026-11-04T00:00:00Z", "to": "2026-11-04T00:00:00Z", "current": True},
              {"id": "g2", "type": "FL", "alert": "Orange", "from": "2026-11-04T00:00:00Z", "to": "2026-11-04T00:00:00Z", "current": True}]
        self.assertEqual([e["id"] for e in hazards.select_disasters(ev, 1762300000)], ["g2"])

    def test_usgs(self):
        gj = {"features": [{"id": "x", "properties": {"mag": 4.6, "time": 1762290000000, "place": "somewhere", "url": "u"},
                            "geometry": {"coordinates": [140.0, 35.0, 10.0]}}, {"id": "bad", "properties": {}, "geometry": {}}]}
        q = hazards.parse_usgs(gj)
        self.assertEqual((len(q), q[0]["mag"], q[0]["depth_km"]), (1, 4.6, 10.0))

    def test_failure_is_a_row_not_an_exception(self):
        def get(url, timeout=0):
            if "usgs" in url:
                return {"features": []}
            raise OSError("down")
        d = hazards.fetch_all(NOW, get)
        self.assertEqual(d["typhoons"], [])
        self.assertFalse(d["sources"]["jma_typhoon"]["ok"])
        self.assertTrue(d["sources"]["usgs"]["ok"])
        self.assertTrue(d["ok"])
        self.assertIsInstance(d["generated_at"], int)

    def test_times_are_epoch(self):
        d = hazards.fetch_all(NOW, lambda url, timeout=0: {"features": [{"id": "x", "properties": {"mag": 5.0, "time": 1762290000000}, "geometry": {"coordinates": [1, 2, 3]}}]}
                              if "usgs" in url else None)
        self.assertEqual(d["quakes_world"][0]["t"], 1762290000)


class Markets(unittest.TestCase):
    def test_wareki_and_csv(self):
        import datetime as dt
        self.assertEqual(markets.wareki_to_date("R8.11.2"), dt.date(2026, 11, 2))
        self.assertIsNone(markets.wareki_to_date("2026/11/2"))
        rows = markets.parse_jgb_csv("国債金利情報,,\n基準日,1年,10年\nR8.10.30,1.6,2.8\nR8.11.2,1.7,-\n")
        self.assertEqual(rows[-1][1], {"1年": 1.7, "10年": None})

    def test_rsi_and_trend_rule(self):
        up = [100 + i for i in range(80)]
        ts = [1760000000 + i * 86400 for i in range(80)]
        a = markets.analyze(ts, up)
        self.assertEqual(a["trend"], "上昇基調")
        self.assertEqual(a["rsi"], 100.0)
        self.assertIsNone(markets.analyze(ts[:30], up[:30])["sma"]["s60"])          # a 60-day average needs 60 bars
        self.assertIsNone(markets.analyze(ts[:30], up[:30])["trend"])               # and the trend then says "cannot judge"
        self.assertFalse(markets.analyze([1], [1])["ok"])

    def test_every_source_down_gives_failed_rows_and_the_note(self):
        def get(url, timeout=0, encoding="utf-8"):
            raise OSError("down")
        d = markets.fetch_all(NOW, get)
        self.assertFalse(d["ok"])
        self.assertTrue(all(not s["ok"] and s["last"] is None and s["spark"] == [] for s in d["series"]))
        self.assertIn("売買の推奨ではありません", d["note_ja"])
        self.assertNotIn("finance.yahoo", json.dumps(markets.SRC) + markets.FRED_URL + markets.UST_URL + markets.ECB_URL)

    def test_ecb_crosses(self):
        csv_text = "CURRENCY,TIME_PERIOD,OBS_VALUE\nUSD,2026-11-02,1.1\nJPY,2026-11-02,165\nUSD,2026-11-03,1.1\nJPY,2026-11-03,176\nCNY,2026-11-03,7.5\n"
        by = markets.parse_ecb_csv(csv_text)
        self.assertEqual(by["JPY"][-1][1], 176.0)


class ExtrasAndSources(unittest.TestCase):
    def test_previous_file_kept_when_nothing_fetched(self):
        with tempfile.TemporaryDirectory() as td:
            p = os.path.join(td, "x.json")
            open(p, "w").write('{"keep": 1}')
            self.assertFalse(extras.run("t", lambda n: {"ok": False, "sources": {"a": {"ok": False, "err": "down"}}}, p, NOW))
            self.assertEqual(open(p).read(), '{"keep": 1}')
            self.assertTrue(extras.run("t", lambda n: {"ok": True, "sources": {}}, p, NOW))
            self.assertIn('"ok":true', open(p).read())

    def test_html_sources_are_not_fetched_as_feeds(self):
        called = []
        items, status = sources.fetch_everything(getter=lambda url: called.append(url) or "<rss/>")
        self.assertFalse(any("jbaudit" in u or "kanpo" in u or "shugiin" in u or "sangiin.go.jp/japanese" in u for u in called))
        self.assertEqual(len(status), sum(1 for s in sources.SOURCES if s["kind"] in ("feed", "gn")))   # feeds and Google News rows; html pages are read by primary.py

    def test_primary_adapter_maps_pages_to_sources(self):
        raw = [{"title": "〔成立〕試験 法律案", "link": "https://example.org/bill/1", "feed": "衆議院 議案", "ts": NOW}]
        st = [{"name": "衆議院 議案", "ok": True, "n": 1, "err": ""}, {"name": "官報 目次", "ok": False, "n": 0, "err": "HTTP 503"}]
        items, status = sources.fetch_primary_sources(getter=lambda budget=0: (raw, st))
        self.assertEqual((items[0]["source_id"], items[0]["type"], items[0]["lang"]), ("primary-shugiin", "政府一次", "ja"))
        self.assertEqual({r["id"]: r["ok"] for r in status}, {"primary-shugiin": True, "primary-kanpo": False})

    def test_new_types_are_known(self):
        for t in ("政党機関紙", "週刊誌・タブロイド", "シンクタンク"):
            self.assertIn(t, sources.TYPES)
        self.assertEqual(sources.TYPES[0], "政府一次")


class Politics(unittest.TestCase):
    def test_compose_with_failing_network(self):
        its = [item("p1", "primary-shugiin", "〔成立〕試験 法律案", NOW), item("p2", "primary-shugiin", "〔審議中〕試験 法律案2", NOW - H),
               item("c1", "party-cdp", "試験 党の発表", NOW), item("c2", "party-ldp", "試験 党の発表", NOW), item("k1", "kantei", "試験 官邸", NOW)]

        def get(url, timeout=0):
            raise OSError("down")
        d = politics.compose(its, NOW, get)
        self.assertEqual(d["bills"]["counts"]["shugiin"], {"成立": 1, "審議中": 1})
        self.assertEqual(sum(d["bills"]["counts"]["shugiin"].values()), 2)
        self.assertEqual([p["outlet"] for p in d["parties"]], sorted(p["outlet"] for p in d["parties"]))
        self.assertIn("kokkai", d["failed"])
        self.assertIsNone(d["kokkai"])
        self.assertIn("gazette", d["failed"])               # nothing from the gazette in this run: said, not filled


if __name__ == "__main__":
    unittest.main()
