"""三つの枝を合わせた時に揃えた言葉（11-11）。表の行の名「いつ」は問いの形なので、文の中と最初の一枚では「時期」。ラベルの下の文はラベルの語を繰り返さない。"""
import unittest

from helpers import ROOT  # puts the repo root on sys.path
from parallax import coverage, hero


class Joined(unittest.TestCase):
    def test_the_date_row_is_named_by_what_it_holds_in_a_sentence(self):
        self.assertEqual(coverage._row_name({"k": "when", "t": "いつ"}), "時期")
        self.assertEqual(coverage._row_name({"k": "who", "t": "長官"}), "「長官」")

    def test_the_points_of_the_first_card_use_the_same_name(self):
        cov = {"outlets": [{"side": "jp"}, {"side": "intl"}], "rows": [{"k": "when", "t": "いつ", "c": ["", {"p": "5日", "k": "5日"}]}]}
        self.assertEqual(hero._points(cov)["intl"], ["時期"])

    def test_a_sentence_under_its_label_does_not_repeat_it(self):
        self.assertEqual(coverage._unlabel({"kind": "lead_differs", "text": "見出しの最初の語：国内は「米国」・海外は「下院」"}), "国内は「米国」・海外は「下院」")
        self.assertEqual(coverage._unlabel({"kind": "only_side", "text": "時期は海外 2 社が載せ、国内 3 社の見出しと要旨には出ていない"}),
                         "時期は海外 2 社が載せ、国内 3 社の見出しと要旨には出ていない")


if __name__ == "__main__":
    unittest.main()
