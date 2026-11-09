# -*- coding: utf-8 -*-
"""CONTRACT 23: 媒体の比べ（board.cases[sid].coverage）。見出しと要旨だけを材料にした、規則による抜き出しと束ね。
合成のデータだけ。網には出ない。守る線: 載せた所は元の文の一部そのまま／出ていない所は事実だけ／数を作らない／報じなかった・隠したとは書かない。"""
import json
import re
import unittest

from helpers import ROOT  # puts the repo root on sys.path
from parallax import coverage, site

H = 3600
T0 = 1794081239


def m(i, outlet, title, desc=None, side="jp", ts=None, lang=None, typ="全国紙"):
    d = {"id": "i%d" % i, "title": title, "outlet": outlet, "home": "intl" if side == "intl" else "jp", "type": "政府一次" if side == "gov" else typ,
         "ts": T0 - (10 - i) * H if ts is None else ts, "link": "https://example.org/%d" % i}
    if desc:
        d["desc"] = desc
    if lang:
        d["lang"] = lang
    return d


def paraguay():
    return [
        m(1, "朝日新聞", "パラグアイ大統領に弾劾と刑事訴追の恐れ 大手銀行の経営破綻めぐり"),
        m(2, "読売新聞", "自身関与の銀行破綻で、南米パラグアイ・ペニャ氏が動画で国民に謝罪"),
        m(3, "NHK", "大手金融機関破綻の南米パラグアイで大統領が罷免され混乱続く", "人口の半数近くが口座を持つ大手金融機関が経営破綻したことをめぐって、大統領が議会で罷免されるなど混乱が続いています。"),
        m(4, "AFP", "パラグアイ大統領が辞任表明、人口のほぼ半数が預金凍結で混乱", "南米パラグアイで、サンティアゴ・ペニャ大統領が5日、辞任を表明した。同日、数千人が街頭で怒りの抗議を行った", side="intl"),
        m(5, "BBC", "パラグアイ大統領を弾劾罷免、自宅軟禁に デジタル銀行破綻で", "南米パラグアイの上院は6日、サンティアゴ・ペニャ大統領の弾劾罷免を可決した。", side="intl"),
    ]


def cells(cov, kind, term=None):
    for r in cov["rows"]:
        if r["k"] == kind and (term is None or r["t"] == term):
            return r
    return None


class OfTests(unittest.TestCase):
    def setUp(self):
        self.ms = paraguay()
        self.cov = coverage.of(self.ms)

    def test_a_table_with_the_outlets_across_domestic_first_then_abroad(self):
        c = self.cov
        self.assertEqual([o["name"] for o in c["outlets"]], ["朝日新聞", "読売新聞", "NHK", "AFP", "BBC"])
        self.assertEqual([o["side"] for o in c["outlets"]], ["jp", "jp", "jp", "intl", "intl"])
        self.assertEqual([o["desc"] for o in c["outlets"]], [False, False, True, True, True])      # 見出しだけの媒体は印が付く
        for r in c["rows"]:
            self.assertEqual(len(r["c"]), len(c["outlets"]))
        self.assertEqual(c["v"], 1)

    def test_every_phrase_is_a_part_of_what_the_outlet_published(self):
        """載せた所の語句は、その媒体の見出しか要旨の一部そのまま（… の印を除く）。数は書かれた通り"""
        src = {}
        for x in self.ms:
            src.setdefault(x["outlet"], "")
            src[x["outlet"]] += (x["title"] or "") + "\n" + (x.get("desc") or "") + "\n"
        n = 0
        for r in self.cov["rows"]:
            for o, c in zip(self.cov["outlets"], r["c"]):
                if isinstance(c, dict):
                    n += 1
                    body = c["p"].strip("…")
                    self.assertIn(body, src[o["name"]].replace(" ", " "), (r["t"], o["name"], c["p"]))
                    self.assertIn(c["k"], c["p"])
        self.assertGreater(n, 10)

    def test_absent_is_an_empty_cell_and_the_other_outlets_still_carry_it(self):
        r = cells(self.cov, "who", "ペニャ")
        self.assertIsNotNone(r)
        got = {o["name"]: bool(c) for o, c in zip(self.cov["outlets"], r["c"])}
        self.assertEqual(got, {"朝日新聞": False, "読売新聞": True, "NHK": False, "AFP": True, "BBC": True})
        self.assertTrue(all(c == "" or isinstance(c, dict) for c in r["c"]))

    def test_the_numbers_are_the_ones_written_never_made_up(self):
        r = cells(self.cov, "num")
        self.assertIsNotNone(r)
        texts = " ".join((x["title"] or "") + (x.get("desc") or "") for x in self.ms)
        for c in r["c"]:
            if isinstance(c, dict):
                self.assertIn(c["k"], texts)
        ks = [c["k"] for c in r["c"] if isinstance(c, dict)]
        self.assertIn("半数", " ".join(ks))               # 「半数近く」と「ほぼ半数」: 丸め方の違いがそのまま並ぶ
        when = cells(self.cov, "when")
        self.assertEqual([c["k"] for c in when["c"] if isinstance(c, dict)], ["5日", "6日"])

    def test_the_choice_of_words_lines_up_what_each_outlet_used_for_the_same_thing(self):
        ws = {w["t"]: w for w in self.cov["words"]}
        self.assertIn("職を離れる", ws)
        used = {v["w"]: [self.cov["outlets"][i]["name"] for i in v["o"]] for v in ws["職を離れる"]["v"]}
        self.assertEqual(used["罷免"], ["NHK", "BBC"])
        self.assertEqual(used["弾劾"], ["朝日新聞", "BBC"])
        self.assertEqual(used["辞任"], ["AFP"])

    def test_no_word_of_silence_or_motive_anywhere(self):
        """報じなかった・隠した・意図は書かない（CONTRACT 4.7・22）"""
        txt = json.dumps(self.cov, ensure_ascii=False) + coverage.html_block(coverage.clean(self.cov))
        for w in ("報じなかった", "報じていない", "報じず", "報道しなかった", "伝えなかった", "黙殺", "隠", "意図", "did not report", "failed to report"):
            self.assertNotIn(w, txt, w)

    def test_one_outlet_or_nothing_to_compare_gives_no_table(self):
        self.assertIsNone(coverage.of(self.ms[:1]))
        self.assertIsNone(coverage.of([m(1, "A", "あ"), m(2, "B", "い")]))
        self.assertIsNone(coverage.of([]))
        self.assertIsNone(coverage.of([None, 3, "x"]))
        self.assertIsNone(coverage.of([m(1, "同じ社", "大統領が辞任を表明した"), m(2, "同じ社", "大統領が辞任を表明、混乱")]))   # 媒体が一つ

    def test_a_failure_never_stops_the_build(self):
        bad = [{"outlet": "A", "title": 5, "desc": ["x"], "ts": "no"}, {"outlet": "B", "title": None}]
        self.assertIsNone(coverage.of(bad))

    def test_the_same_data_gives_the_same_table(self):
        self.assertEqual(coverage.of(self.ms), coverage.of(list(reversed(self.ms))))

    def test_a_japanese_and_an_english_outlet_are_not_compared_by_their_words(self):
        ms = paraguay()[:4] + [m(9, "Reuters", "Paraguay president Peña ousted after bank collapse", side="intl", lang="en")]
        c = coverage.of(ms)
        i = [o["name"] for o in c["outlets"]].index("Reuters")
        self.assertEqual(c["outlets"][i]["lang"], "en")
        r = cells(c, "who", "ペニャ")
        self.assertIsNotNone(r)
        self.assertIsNone(r["c"][i])                      # 照合なし（空ではない）
        r2 = cells(c, "who", "Peña")
        if r2:
            self.assertTrue(all(x is None for x, o in zip(r2["c"], c["outlets"]) if o["lang"] == "ja"))

    def test_english_phrases_are_whole_phrases(self):
        ms = [m(1, "The Guardian", "Paraguay's president placed under house arrest after banking crisis", side="intl", lang="en"),
              m(2, "AP", "Paraguay's ousted president faces prosecutors after removal over bank collapse", side="intl", lang="en"),
              m(3, "BBC", "Paraguay president detained as bank run spreads", side="intl", lang="en")]
        c = coverage.of(ms)
        self.assertIsNotNone(c)
        ws = [v["w"] for w in c["words"] for v in w["v"]]
        self.assertIn("house arrest", ws)
        self.assertNotIn("house", ws)


class CleanTests(unittest.TestCase):
    def test_a_board_made_here_reads_back_the_same(self):
        c = coverage.of(paraguay())
        k = coverage.clean(c)
        self.assertEqual(len(k["outlets"]), 5)
        self.assertEqual(len(k["rows"]), len(c["rows"]))
        self.assertEqual(k["words"], c["words"])

    def test_old_or_broken_shapes_give_none(self):
        c = coverage.of(paraguay())
        for bad in (None, 3, "x", [], {}, {"v": 2}, dict(c, v=2), dict(c, outlets=c["outlets"][:1]), dict(c, outlets="x"),
                    dict(c, outlets=[dict(o, name="") for o in c["outlets"]]), dict(c, rows="x", words="y")):
            self.assertIsNone(coverage.clean(bad), bad if not isinstance(bad, dict) else list(bad))

    def test_text_is_cut_numbers_stay_in_range_and_unknown_kinds_go(self):
        c = coverage.of(paraguay())
        c = json.loads(json.dumps(c))
        c["rows"][0]["c"][0] = {"p": "あ" * 200, "k": "い" * 200}
        c["rows"].append({"k": "weird", "t": "x", "c": [{"p": "y", "k": "y"}] * 5})
        c["words"][0]["v"][0]["o"] = [0, 99, -1, True, 1.5, 2]
        k = coverage.clean(c)
        self.assertLessEqual(len(k["rows"][0]["c"][0]["p"]), 60)
        self.assertNotIn("weird", [r["k"] for r in k["rows"]])
        self.assertEqual(k["words"][0]["v"][0]["o"], [0, 2])


class PageTests(unittest.TestCase):
    def test_the_page_of_an_event_carries_the_table_without_script_and_says_only_the_fact(self):
        ms = paraguay()
        cov = coverage.of(ms)
        ev = site.make_event("s0123456789ab", [dict(x) for x in ms], {"coverage": cov, "cat": "国際"})
        self.assertIsNotNone(ev["coverage"])
        page = site.story_page(ev, base="https://example.test/p/", generated_at=T0)
        self.assertIn('<section class="cov"', page)
        self.assertIn("見出しと要旨には出ていない", page)
        self.assertNotIn("<script", page)
        self.assertEqual(page.count("<table"), 1)
        self.assertLess(page.index('class="cov"'), page.index("国内の報道"))        # 要点のあと・各側の見出しの前
        for w in ("報じなかった", "隠", "意図"):
            self.assertNotIn(w, page)

    def test_an_event_without_the_field_shows_the_page_as_before(self):
        ms = paraguay()
        ev = site.make_event("s0123456789ab", [dict(x) for x in ms], {"cat": "国際"})
        self.assertIsNone(ev["coverage"])
        page = site.story_page(ev, base="https://example.test/p/", generated_at=T0)
        self.assertNotIn('class="cov"', page)
        self.assertIn("国内の報道", page)
        ev2 = site.make_event("s0123456789ab", [dict(x) for x in ms], {"cat": "国際", "coverage": {"v": 9, "outlets": 3}})
        self.assertIsNone(ev2["coverage"])

    def test_html_is_escaped(self):
        c = coverage.clean(coverage.of(paraguay()))
        c["outlets"][0]["name"] = '<b>"x"</b>'
        c["rows"][0]["c"][1] = {"p": "<script>alert(1)</script>ペニャ", "k": "ペニャ"}
        h = coverage.html_block(c)
        self.assertNotIn("<script>", h)
        self.assertNotIn("<b>\"x\"", h)


class BoardTests(unittest.TestCase):
    def test_a_case_carries_the_field_only_when_it_could_be_made(self):
        from parallax import board
        from test_board import make_data, NOW
        data = make_data()
        b = board.compose(data, now=NOW)
        b = b[0] if isinstance(b, tuple) else b
        for sid, c in b["cases"].items():
            if "coverage" in c:
                self.assertIsNotNone(coverage.clean(c["coverage"]), sid)
        two = [c for c in b["cases"].values() if c["n_outlets"] >= 2]
        self.assertTrue(two)


if __name__ == "__main__":
    unittest.main()
