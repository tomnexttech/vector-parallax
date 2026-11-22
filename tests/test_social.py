# -*- coding: utf-8 -*-
"""data/social.json (parallax/social.py): Bluesky の公開検索を数える。網には出ない：偽の get で答える。投稿の本文・名前は残さない。"""
import json
import unittest
import urllib.parse

from helpers import ROOT  # noqa: F401
from parallax import social

NOW = 1762300000
LEX = {"pos": ["嬉しい", "最高"], "neg": ["最悪", "被害"], "stop": ["今日"]}


def post(did, text):
    return {"author": {"did": did}, "record": {"text": text}}


def fake(recent_posts, prior_posts, hits=(500, 900)):
    """the window is told by `since`: the recent window starts later than the prior one"""
    calls = []

    def get(url):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
        calls.append(q)
        if "cursor" in q:
            raise AssertionError("the public search refuses a cursor; the code must not ask for one")
        recent = q["since"] >= social._iso(NOW - 12 * 3600)
        return {"hitsTotal": hits[0] if recent else hits[1], "posts": recent_posts if recent else prior_posts, "cursor": "x"}
    get.calls = calls
    return get


class SocialTests(unittest.TestCase):
    def test_rising_terms_need_posts_people_and_a_rise(self):
        rec = [("a%d" % i, "首里城の復元が最高 今日 https://x.example/a @someone") for i in range(6)] + [("z", "雑談")] * 14
        pri = [("b0", "首里城の話")] + [("y", "雑談")] * 19
        t = social.rising_terms(rec, pri, skip=("沖縄",), stop=["今日"])
        by = {x["term"]: x for x in t}
        self.assertEqual((by["首里城"]["recent"], by["首里城"]["prior"], by["首里城"]["authors"]), (6, 1, 6))
        self.assertNotIn("今日", by)
        self.assertNotIn("example", " ".join(x["term"] for x in t))          # a link is not text
        self.assertEqual(social.rising_terms([("same", "復元復元の話")] * 8, [], skip=()), [])  # fewer than MIN_AUTHORS people

    def test_a_word_in_most_posts_is_the_search_words_company(self):
        rec = [("a%d" % i, "東京タワーに行った") for i in range(10)]
        self.assertEqual(social.rising_terms(rec, [], skip=("東京",)), [])

    def test_tone_counts_words_and_the_rest_is_not_judged(self):
        posts = [("a", "最高に嬉しい"), ("b", "被害が最悪"), ("c", "最高だが最悪"), ("d", "雑談")]
        self.assertEqual(social.tone_of(posts, LEX), {"n": 4, "pos": 1, "neg": 1, "none": 2})

    def test_a_window_is_cut_in_time_and_never_pages(self):
        g = fake([post("a", "x")] * 3, [])
        hits, capped, posts = social.window("東京", NOW - 12 * 3600, NOW, 3, g, sleep=lambda s: None)
        self.assertEqual(len(g.calls), 3)
        self.assertEqual(hits, 1500)                     # three slices of the same fake count
        self.assertFalse(capped)
        self.assertEqual(len(posts), 9)

    def test_compute_keeps_numbers_and_no_text(self):
        rec = [post("a%d" % i, "首里城が最高") for i in range(6)]
        d = social.compute({"window_h": 36}, {"places": [{"key": "沖縄"}]}, LEX, NOW, get=fake(rec, [post("b", "雑談")]), sleep=lambda s: None)
        self.assertTrue(d["ok"])
        self.assertEqual((d["recent_h"], d["prior_h"]), (12, 24))
        r = d["places"]["沖縄"]
        self.assertEqual(r["recent"]["n"], 1500)
        self.assertEqual(r["tone"]["pos"], 18)
        blob = json.dumps(d, ensure_ascii=False)
        for secret in ("a0", "雑談", "x.example"):
            self.assertNotIn(secret, blob)
        self.assertIn("縮図ではありません", d["bias_ja"])

    def test_a_failed_place_is_a_row_with_its_reason_and_the_file_is_not_ok_when_all_fail(self):
        def boom(url):
            raise OSError("down")
        d = social.compute({}, {"places": [{"key": "東京"}, {"key": "大阪"}]}, LEX, NOW, get=boom, sleep=lambda s: None)
        self.assertFalse(d["ok"])
        self.assertIn("OSError", d["places"]["東京"]["err"])

    def test_kyoto_is_not_tokyo(self):
        self.assertEqual(social.precision([("a", "東京都で"), ("b", "京都で")], "京都"), 0.5)

    def test_the_places_and_the_lexicon_in_the_repository_are_whole(self):
        pl = json.loads((ROOT / "data" / "social_places.json").read_text(encoding="utf-8"))["places"]
        keys = [p["key"] for p in pl]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(sum(1 for p in pl if p["kind"] == "pref"), 47)
        lex = json.loads((ROOT / "data" / "sentiment_ja.json").read_text(encoding="utf-8"))
        self.assertTrue(lex["pos"] and lex["neg"])
        self.assertFalse(set(lex["pos"]) & set(lex["neg"]))


if __name__ == "__main__":
    unittest.main()
