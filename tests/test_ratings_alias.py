# -*- coding: utf-8 -*-
"""外部評価（data/ratings.json）の別名表が、媒体名の別名表（parallax/gnews.py）と食い違わない事の試験。網には出ない。"""
import json
import os
import sys
import unicodedata
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from parallax import gnews  # noqa: E402


def key(s):
    return unicodedata.normalize("NFKC", s or "").strip().casefold()


class RatingsAliases(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ROOT, "data", "ratings.json"), encoding="utf-8") as f:
            self.r = json.load(f)

    def test_every_alias_points_at_an_outlet_on_file(self):
        for a, target in self.r["aliases"].items():
            self.assertIn(target, self.r["outlets"], (a, target))

    def test_every_other_name_gnews_knows_for_a_rated_outlet_is_an_alias(self):
        have = {key(a): t for a, t in self.r["aliases"].items()}
        own = {key(k) for k in self.r["outlets"]}
        for k, (canon, _ty) in gnews.ALIASES.items():
            if canon in self.r["outlets"] and k not in own:
                self.assertEqual(have.get(k), canon, (k, canon))

    def test_ap_news_finds_the_ap_row(self):
        self.assertEqual(self.r["aliases"]["AP News"], "AP")


if __name__ == "__main__":
    unittest.main()
