# -*- coding: utf-8 -*-
"""Google News 経由の源（parallax/gnews.py・CONTRACT §19.2）、事件の層・代表の見出し・鍵語（CONTRACT §18.11）の試験。網には出ない。"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from parallax import board, gnews, keyterms, sources  # noqa: E402

NOW = 1762300000


def raw(title, media, ts=NOW, link="https://news.google.com/rss/articles/x"):
    return {"title": title, "source": media, "link": link, "ts": ts}


class AliasTable(unittest.TestCase):
    def test_resolve_is_exact_not_partial(self):
        self.assertEqual(gnews.resolve("産経ニュース"), ("産経新聞", "全国紙"))
        self.assertEqual(gnews.resolve("時事ドットコム"), ("時事通信", "通信社"))
        self.assertEqual(gnews.resolve("ＮＨＫ"), ("NHK", "公共放送"))             # NFKC
        self.assertIsNone(gnews.resolve("産経"))                                 # a part of a name is not a name
        self.assertIsNone(gnews.resolve("上越タウンジャーナル"))                  # unknown outlets are not guessed

    def test_every_type_is_a_known_type(self):
        for k, (canon, ty) in gnews.ALIASES.items():
            self.assertIn(ty, sources.TYPES, (k, canon, ty))

    def test_strip_tail_only_when_it_is_the_source(self):
        self.assertEqual(gnews.strip_tail("見出し - 読売新聞", "読売新聞"), "見出し")
        self.assertEqual(gnews.strip_tail("見出し - 読売新聞", "朝日新聞"), "見出し - 読売新聞")
        self.assertEqual(gnews.strip_tail("a - b - 読売新聞", "読売新聞"), "a - b")
        self.assertEqual(gnews.strip_tail(" - 読売新聞", "読売新聞"), "- 読売新聞")        # an empty headline is not made

    def test_urls(self):
        self.assertIn("site%3Ayomiuri.co.jp", gnews.search_url("site:yomiuri.co.jp when:2d").replace("%20when", "").split("&")[0])
        self.assertTrue(gnews.section_url("", True).startswith("https://news.google.com/rss?"))
        self.assertIn("topic/WORLD", gnews.section_url("WORLD", True))


class Convert(unittest.TestCase):
    SECTION = {"fixed": False, "outlet": "Google News", "type": "集約"}
    FIXED = {"fixed": True, "outlet": "読売新聞", "type": "全国紙"}

    def test_section_resolves_each_headline_and_drops_the_rest(self):
        rows = [raw("A - 産経ニュース", "産経ニュース"), raw("B - Yahoo!ニュース", "Yahoo!ニュース", link="l2"),
                raw("C - 見知らぬ媒体", "見知らぬ媒体", link="l3"), raw("D - NHKニュース", "NHKニュース", link="l4"),
                raw("E - 時事ドットコム", "時事ドットコム", ts=None, link="l5")]
        out, drop = gnews.convert(rows, self.SECTION, direct_outlets=frozenset({"NHK"}))
        self.assertEqual([(x["title"], x["outlet"], x["type"]) for x in out], [("A", "産経新聞", "全国紙")])
        self.assertEqual((drop["portal"], drop["unknown_outlet"], drop["direct_feed"], drop["no_date"]), (1, 1, 1, 1))

    def test_fixed_source_keeps_its_outlet_and_cap_keeps_the_newest(self):
        rows = [raw("t%d - 読売新聞オンライン" % i, "読売新聞オンライン", ts=NOW + i, link="l%d" % i) for i in range(50)]
        out, drop = gnews.convert(rows, self.FIXED, cap=5)
        self.assertEqual(len(out), 5)
        self.assertEqual(out[0]["title"], "t49")
        self.assertTrue(all(x["outlet"] == "読売新聞" and x["type"] == "全国紙" for x in out))

    def test_home_of(self):
        self.assertEqual(gnews.home_of("BBC", "海外公共"), "intl")
        self.assertEqual(gnews.home_of("Reuters", "通信社"), "intl")
        self.assertEqual(gnews.home_of("共同通信", "通信社"), "jp")
        self.assertEqual(gnews.home_of("産経新聞", "全国紙", {"産経新聞": "jp"}), "jp")


RSS = """<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>x</title>
<item><title>首相が会見 - 読売新聞</title><link>https://news.google.com/rss/articles/AAA</link>
<pubDate>Tue, 04 Nov 2026 01:00:00 GMT</pubDate><source url="https://www.yomiuri.co.jp">読売新聞</source></item>
<item><title>別の話 - 産経ニュース</title><link>https://news.google.com/rss/articles/BBB</link>
<pubDate>Tue, 04 Nov 2026 02:00:00 GMT</pubDate><source url="https://www.sankei.com">産経ニュース</source></item>
</channel></rss>"""


class FetchGn(unittest.TestCase):
    def test_kind_gn_sources_exist_and_have_terms_unknown(self):
        gn = [s for s in sources.SOURCES if s["kind"] == "gn"]
        self.assertGreaterEqual(len(gn), 30)
        for s in gn:
            self.assertEqual(s["terms_status"], "unknown", s["id"])
            self.assertTrue(s["url"].startswith("https://news.google.com/rss"), s["id"])
        self.assertTrue(any(not s["fixed"] for s in gn) and any(s["fixed"] for s in gn))

    def test_fetch_fixed_source_through_a_getter(self):
        src = sources.by_id("gn-yomiuri")
        rec = sources.fetch_source(src, getter=lambda url: RSS)
        self.assertTrue(rec["ok"])
        self.assertEqual({it["outlet"] for it in rec["items"]}, {"読売新聞"})          # the source fixes the outlet
        self.assertEqual(sorted(it["title"] for it in rec["items"]), ["別の話", "首相が会見"])
        it = rec["items"][0]
        self.assertTrue(it["link"].startswith("https://news.google.com/rss/articles/"))
        self.assertIsNone(it["image"])
        self.assertEqual(set(it) - {"image"}, {"title", "link", "outlet", "source_id", "type", "home", "lang", "ts", "id", "via", "media"})
        self.assertEqual(it["via"], "gnews")                                    # CONTRACT 20.7

    def test_fetch_section_resolves_outlets_and_reports_drops(self):
        src = sources.by_id("gn-ja-nation")
        rec = sources.fetch_source(src, getter=lambda url: RSS, direct_outlets=frozenset(), known_homes={})
        self.assertEqual(sorted((it["outlet"], it["type"], it["home"]) for it in rec["items"]),
                         [("産経新聞", "全国紙", "jp"), ("読売新聞", "全国紙", "jp")])
        rec2 = sources.fetch_source(src, getter=lambda url: RSS, direct_outlets=frozenset({"読売新聞"}), known_homes={})
        self.assertEqual([it["outlet"] for it in rec2["items"]], ["産経新聞"])
        self.assertEqual(rec2["dropped"]["direct_feed"], 1)

    def test_everything_marks_google_news_rows(self):
        items, status = sources.fetch_everything(sources=[sources.by_id("gn-yomiuri")], getter=lambda url: RSS)
        self.assertEqual(len(items), 2)
        self.assertEqual(status[0]["via"], "google-news")
        self.assertIn("dropped", status[0])


class KeyTermsAndRep(unittest.TestCase):
    def test_key_terms_drop_tail_dates_and_boilerplate(self):
        self.assertEqual(keyterms.key_terms("消費税減税法案が委員会で可決 - 毎日新聞")[:2], ["消費税減税法案", "委員会"])
        self.assertEqual(keyterms.key_terms("速報"), [])
        self.assertEqual(board.key_terms("消費税減税法案が委員会で可決", 1), ["消費税減税法案"])
        self.assertIn("US Election", " ".join(keyterms.key_terms("Trump Faces New Limits After US Election")))

    def test_pick_rep_prefers_japanese_major_newest(self):
        ms = [{"id": "1", "title": "Prime minister speaks", "lang": "en", "type": "海外公共", "ts": 300},
              {"id": "2", "title": "首相が会見", "lang": "ja", "type": "週刊誌・タブロイド", "ts": 250},
              {"id": "3", "title": "首相が会見へ", "lang": "ja", "type": "全国紙", "ts": 100},
              {"id": "4", "title": "首相が会見を開く", "lang": "ja", "type": "公共放送", "ts": 200}]
        self.assertEqual(board.pick_rep(ms)["id"], "4")                      # Japanese + major type + newest
        self.assertEqual(board.pick_rep([ms[0]])["id"], "1")
        self.assertEqual(board.pick_rep([dict(ms[1], ts=None), dict(ms[0], ts=None)])["id"], "2")   # no time at all: the Japanese one
        self.assertIsNone(board.pick_rep([]))

    def test_pick_rep_keeps_the_flags_of_the_original_rep(self):
        # the original rep raises the money flag; the newest Japanese major member does not -> the one that raises it wins
        ms = [{"id": "a", "title": "予算が成立 補正予算", "lang": "ja", "type": "全国紙", "ts": 100},
              {"id": "b", "title": "天気は晴れ", "lang": "ja", "type": "全国紙", "ts": 200}]
        self.assertEqual(board.pick_rep(ms, ms[0])["id"], "a")
        self.assertEqual(board.pick_rep(ms)["id"], "b")

    def test_kana_makes_a_member_japanese(self):
        self.assertTrue(board._is_ja_m({"lang": "en", "title": "これは日本語"}))
        self.assertFalse(board._is_ja_m({"lang": "en", "title": "中国外交部"}))


def story(sid, titles, ts=NOW - 3600):
    ms = [{"id": "%s-%d" % (sid, i), "title": t, "outlet": "o%d" % i, "type": "全国紙", "lang": "ja", "home": "jp", "ts": ts + i}
          for i, t in enumerate(titles)]
    return {"sid": sid, "story": {}, "members": ms, "rep": ms[0], "flags": {k: False for k in board.watch.FLAGS} | {"hits": []},
            "hits": [], "types": ["全国紙"], "n_outlets": len(ms), "first_ts": ts, "last_ts": ts + len(ms), "ja": True, "gov": False,
            "cids": ["c" + sid], "cat": "国内政治"}


class EventLayer(unittest.TestCase):
    def test_names_need_a_title_and_places_are_not_names(self):
        self.assertEqual(board.ev_names("簗農水相が予算カット発言を撤回"), ["簗"])
        self.assertEqual(board.ev_names("古謝知事が基地問題で会見"), ["古謝"])
        self.assertEqual(board.ev_names("カタール首相が会談"), [])          # an organisation or country, not a person
        self.assertEqual(board.ev_names("沖縄県知事が会見"), [])              # only a place
        self.assertEqual(board.ev_names("横浜市長が会見"), [])                # 市長 is not a key title

    def test_canon_folds_short_and_long_spellings_but_not_hayashi_and_hayashida(self):
        c = board._ev_canon(["簗", "簗和生", "林", "林田", "岩屋", "岩屋毅"])
        self.assertEqual(c["簗和生"], "簗")
        self.assertEqual(c["岩屋毅"], "岩屋")
        self.assertEqual(c["林田"], "林田")                                  # 1 + 1 characters: not folded

    def test_same_titled_person_and_similar_headlines_fold(self):
        a = story("sa", ["簗和生農水相が予算カット発言を撤回", "簗農水相、予算カット発言を撤回し謝罪"])   # a full name in the window lets the one-character name be a key
        b = story("sb", ["簗農水相の予算カット発言 野党が追及", "簗農水相 予算カット発言で追及へ"], ts=NOW - 1800)
        c = story("sc", ["全く別の話題 株価が上昇"])
        out, evs = board.events([a, b, c], NOW)
        self.assertEqual(len(evs), 1)
        self.assertEqual([x["sid"] for x in out], [evs[0]["sid"], "sc"])
        self.assertEqual(evs[0]["event"]["key"], "簗")
        self.assertEqual(sorted(evs[0]["event"]["sids"]), ["sa", "sb"])
        self.assertEqual(len(evs[0]["members"]), 4)
        self.assertEqual(evs[0]["cids"], ["csa", "csb"])

    def test_same_name_but_different_matters_do_not_fold(self):
        a = story("sa", ["木原官房長官が熊本地震の被災地を視察し、仮設住宅の整備を急ぐ考えを示した"])
        b = story("sb", ["木原官房長官は、ロシア外務省の批判に対し、北方領土をめぐり再反論した"], ts=NOW - 1800)
        out, evs = board.events([a, b], NOW)
        self.assertEqual(evs, [])
        self.assertEqual(len(out), 2)

    def test_a_name_in_too_many_stories_is_a_topic(self):
        sts = [story("s%d" % i, ["石破首相の発言%d" % i, "石破首相が語る%d" % i]) for i in range(3)]
        old = board.EVENT_MAX_DF
        try:
            board.EVENT_MAX_DF = 2
            out, evs = board.events(sts, NOW)
        finally:
            board.EVENT_MAX_DF = old
        self.assertEqual(evs, [])

    def test_sport_stories_are_never_folded(self):
        a = story("sa", ["大谷選手が本塁打 簗氏", "簗氏 本塁打を語る"])
        b = story("sb", ["簗氏 本塁打で試合", "簗氏 試合後に語る"])
        self.assertEqual(board.events([a, b], NOW)[1], [])


if __name__ == "__main__":
    unittest.main()
