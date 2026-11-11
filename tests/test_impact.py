# -*- coding: utf-8 -*-
"""CONTRACT 25.2: data/impact.json — 暮らしのラベル。公開の語の表（data/lifewords.json）だけで判じ、当たった語を根拠として出す。"""
import json
import sys
import unittest

from helpers import ROOT, FIX
sys.path.insert(0, str(FIX))
from parallax import impact  # noqa: E402
import make_data_samples as S  # noqa: E402

V = impact.load_vocab()

# 各分野の強い語の一つずつに、正例（政策の見出し）と負例（同じ字の出ない見出し）
CASES = {
    "tax": ("社会保険料の引き上げ 政府が来年度から検討", "球場の新しい観客席が完成"),
    "price": ("物価高への対策 政府が給付を検討", "新しい星座の観測に成功"),
    "work": ("最低賃金の引き上げ 審議会が答申", "動物園でパンダの赤ちゃんが誕生"),
    "care": ("介護報酬の改定案 厚生労働省が示す", "夏祭りの花火が中止に"),
    "pension": ("年金の受給開始の年齢 法改正の議論", "高校野球の決勝戦"),
    "kids": ("児童手当の拡充 法案を閣議決定", "新作映画が公開"),
    "home": ("家賃補助の制度を導入へ 国土交通省", "山で紅葉が見ごろ"),
    "energy": ("電気料金の補助 政府が延長を決定", "ピアノの演奏会"),
    "data": ("マイナンバーの利用を拡大する法改正", "料理の新しいレシピ"),
    "move": ("ライドシェアの規制を見直し 国土交通省", "将棋の対局"),
}


class VocabTests(unittest.TestCase):
    def test_the_table_is_public_and_well_formed(self):
        self.assertEqual(V["schema"], "lifewords/1")
        self.assertEqual((V["strong"], V["weak"], V["threshold"]), (2, 1, 2))
        ids = [a["id"] for a in V["areas"]]
        self.assertEqual(sorted(ids), sorted(CASES))
        for a in V["areas"]:
            self.assertTrue(a["ja"] and a["strong"])
            for w in a["strong"] + a["weak"]:
                self.assertIsInstance(w, str)
        self.assertIn("caveat", V)

    def test_each_area_one_positive_and_one_negative(self):
        for area, (pos, neg) in CASES.items():
            areas, hits, _st = impact.score(pos, V)
            self.assertIn(area, areas, pos)
            self.assertTrue(hits, pos)
            self.assertEqual(impact.score(neg, V)[0], [], neg)

    def test_one_weak_word_alone_is_below_the_threshold(self):
        self.assertEqual(impact.score("教育の話題", V)[0], [])          # 弱い語 1 = 1 点 < 2

    def test_stage_is_the_first_stage_word_by_priority(self):
        self.assertEqual(impact.score("年金の法案が成立", V)[2], "成立")
        self.assertEqual(impact.score("年金の法案を審議入り", V)[2], "法案")
        self.assertIsNone(impact.score("年金の話", V)[2])


class ComputeTests(unittest.TestCase):
    def test_labels_hits_and_quiet(self):
        latest, _b, politics = S.sample(ai=True)
        d = impact.compute(latest, politics, S.NOW)
        self.assertEqual(d["schema"], "parallax-impact/1")
        e = d["events"]["s4000000000d4"]                              # 意見募集と週刊誌 1 誌だけ
        self.assertEqual(e["areas"], ["care"])
        self.assertIn("介護報酬", e["hits"])
        self.assertEqual(e["stage"], "意見募集")
        self.assertTrue(e["primary"] and e["quiet"])
        self.assertEqual(e["mainstream_n"], 0)
        e = d["events"]["s3000000000c3"]
        self.assertFalse(e["quiet"])                                  # 一次資料が無い
        self.assertNotIn("s1000000000a1", d["events"])                # 暮らしの語が無い
        kinds = {x["kind"] for x in d["docs"]}
        self.assertEqual(kinds, {"gazette", "bill", "pubcomment"})
        pc = next(x for x in d["docs"] if x["kind"] == "pubcomment")
        self.assertEqual(pc["sid"], "s4000000000d4")
        for x in d["docs"]:
            self.assertTrue(x["url"].startswith("https://"))
            self.assertTrue(x["hits"])

    def test_no_words_that_claim_intent(self):
        latest, _b, politics = S.sample(ai=True)
        txt = json.dumps(impact.compute(latest, politics, S.NOW), ensure_ascii=False)
        for w in ("隠", "報じない", "報じなかった", "黙殺"):
            self.assertNotIn(w, txt)

    def test_the_committed_sample_is_what_the_code_makes(self):
        got = S.build_all(ai=True)["impact"]
        want = json.loads((FIX / "impact.sample.json").read_text(encoding="utf-8"))
        self.assertEqual(json.loads(json.dumps(got, ensure_ascii=False)), want)


if __name__ == "__main__":
    unittest.main()
