# -*- coding: utf-8 -*-
"""CONTRACT 25.1: data/reaction.json — 世論の反応（公開の値だけ）。網には出ない：偽の get で答える。"""
import json
import sys
import unittest
import urllib.parse

from helpers import ROOT, FIX
sys.path.insert(0, str(FIX))
from parallax import reaction, video  # noqa: E402
import make_data_samples as S  # noqa: E402


class ReactionTests(unittest.TestCase):
    def test_values_come_with_their_time_and_by_side(self):
        d = S.build_all(ai=True)["reaction"]
        self.assertEqual(d["schema"], "parallax-reaction/1")
        hs = d["sources"]["hatena"]
        self.assertTrue(hs["ok"])
        self.assertEqual(hs["fetched_at"], S.NOW)
        e = d["events"]["s1000000000a1"]["hb"]
        self.assertEqual(e["at"], S.NOW)
        self.assertEqual(e["sum"], sum(e["by_side"].values()))
        self.assertEqual(e["n"], 5)
        self.assertGreaterEqual(e["sum"], e["max"])
        w = d["events"]["s1000000000a1"]["wiki"][0]
        self.assertEqual(w["title"], "国防長官")
        self.assertEqual(len(w["views"]), 7)
        self.assertEqual({x["name"] for x in d["not_used"]}, {"Yahoo!ニュースのコメント", "X", "Bluesky の検索"})
        for x in d["not_used"]:
            self.assertTrue(x["url"].startswith("https://"))

    def test_network_down_keeps_the_sources_with_ok_false(self):
        d = S.build_all(ai=True, fail=True)["reaction"]
        self.assertFalse(d["sources"]["hatena"]["ok"])
        self.assertIn("network is down", d["sources"]["hatena"]["err"])
        self.assertFalse(d["sources"]["wikipedia"]["ok"])
        self.assertIsNone(d["sources"]["hatena"]["fetched_at"])
        self.assertEqual(d["items"], {})
        self.assertFalse(any("hb" in e or "wiki" in e for e in d["events"].values()))   # 値を埋めない

    def test_hatena_calls_are_batched_by_fifty_with_a_gap(self):
        calls, sleeps = [], []

        def get(url):
            calls.append(url)
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            return json.dumps({u: 1 for u in q["url"]})
        urls = ["https://example.test/%d" % i for i in range(120)]
        got, err = reaction.hatena(urls, get, sleeps.append, deadline=1e18)
        self.assertEqual(len(calls), 3)
        self.assertEqual(sleeps, [reaction.HATENA_GAP_S] * 2)
        self.assertEqual(len(got), 120)
        self.assertEqual(err, "")
        for u in calls:
            self.assertTrue(u.startswith("https://bookmark.hatenaapis.com/count/entries?"))
            self.assertLessEqual(len(urllib.parse.parse_qs(urllib.parse.urlsplit(u).query)["url"]), 50)

    def test_a_slow_or_closed_wikipedia_is_left_after_two_failures(self):
        import urllib.error
        latest, board, _p = S.sample(ai=True)
        calls = []
        ok = S.fake_get()

        def get(url):
            if "pageviews" in url:
                calls.append(url)
                raise urllib.error.URLError("timed out")
            return ok(url)
        d = reaction.compute(latest, board, None, S.NOW, get=get, sleep=lambda x: None, clock=lambda: S.NOW)
        self.assertEqual(len(calls), reaction.WIKI_FAILS)
        self.assertFalse(d["sources"]["wikipedia"]["ok"])
        self.assertTrue(d["sources"]["hatena"]["ok"])                 # ほかの源の値は出る

    def test_long_urls_are_split_so_the_query_stays_short(self):
        urls = ["https://example.test/" + "x" * 400 + str(i) for i in range(40)]
        chunks = reaction._chunks(urls)
        self.assertGreater(len(chunks), 1)
        self.assertEqual(sum(len(c) for c in chunks), 40)
        for c in chunks:
            self.assertLessEqual(len(urllib.parse.urlencode([("url", u) for u in c])), reaction.HATENA_QUERY_MAX)
        self.assertEqual(reaction._chunks(["https://example.test/" + "y" * 9000]), [])

    def test_the_time_limit_stops_the_calls(self):
        got, err = reaction.hatena(["https://example.test/1"], lambda u: "{}", lambda s: None, deadline=0)
        self.assertEqual((got, err), ({}, "time limit"))

    def test_youtube_views_are_summed_per_event(self):
        latest, board, _p = S.sample(ai=True)
        s = next(x for x in latest["stories"] if x["sid"] == "s1000000000a1")
        s["videos"] = [{"id": "aaaaaaaaaaa", "title": "x", "ts": 1, "station": "ann", "views": 1200, "views_at": S.NOW - 60},
                       {"id": "bbbbbbbbbbb", "title": "y", "ts": 2, "station": "tbs", "views": 300, "views_at": S.NOW}]
        d = reaction.compute(latest, board, None, S.NOW, get=S.fake_get(True), sleep=lambda x: None, clock=lambda: S.NOW)
        self.assertEqual(d["events"]["s1000000000a1"]["yt"], {"views": 1500, "n": 2, "at": S.NOW})
        self.assertTrue(d["sources"]["youtube"]["ok"])
        self.assertEqual(d["sources"]["youtube"]["n"], 2)

    def test_a_feed_without_view_counts_is_not_ok(self):
        latest, board, _p = S.sample(ai=True)
        latest["stories"][0]["videos"] = [{"id": "aaaaaaaaaaa", "title": "x", "ts": 1, "station": "ann"}]
        d = reaction.compute(latest, board, None, S.NOW, get=S.fake_get(True), sleep=lambda x: None, clock=lambda: S.NOW)
        self.assertFalse(d["sources"]["youtube"]["ok"])

    def test_the_channel_feed_view_count_is_read(self):
        xml = ('<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">'
               '<entry><yt:videoId>aaaaaaaaaaa</yt:videoId><title>t</title><published>2026-11-10T00:00:00+00:00</published>'
               '<media:group><media:community><media:statistics views="4321"/></media:community></media:group></entry>'
               '<entry><yt:videoId>bbbbbbbbbbb</yt:videoId><title>u</title><published>2026-11-10T01:00:00+00:00</published></entry></feed>')
        got = {v["id"]: v for v in video.parse_feed(xml, {"id": "ann"})}
        self.assertEqual(got["aaaaaaaaaaa"]["views"], 4321)
        self.assertNotIn("views", got["bbbbbbbbbbb"])                  # 無い値は作らない

    def test_words_of_judgement_are_not_used(self):
        txt = json.dumps(S.build_all(ai=True)["reaction"], ensure_ascii=False)
        for w in ("賛成", "反対", "炎上"):
            self.assertNotIn(w, txt.replace("賛成か反対かではありません", ""))

    def test_the_committed_sample_is_what_the_code_makes(self):
        got = S.build_all(ai=True)["reaction"]
        want = json.loads((FIX / "reaction.sample.json").read_text(encoding="utf-8"))
        self.assertEqual(json.loads(json.dumps(got, ensure_ascii=False)), want)


if __name__ == "__main__":
    unittest.main()
