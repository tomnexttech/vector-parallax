# -*- coding: utf-8 -*-
"""配信の説明文 items[].desc（CONTRACT §14.1）と、要約の段を入れた版の呼び数の勘定（§13）の試験。合成の fixture・偽の getter だけ。網には出ない。"""
import copy
import json
import unittest
from unittest import mock

from helpers import NOW, ROOT, build, load_items
from parallax import feeds, sources, withheld

QUOTE = build.load_prompt(rights="quote")
STRICT = build.load_prompt(rights="strict")


def cut(raw, title="", outlet="NHK"):
    return sources.make_desc(feeds.first_paragraph(raw), title, outlet)


class FirstParagraph(unittest.TestCase):
    def test_first_paragraph_of_html_escaped_html_and_cdata(self):
        self.assertEqual(feeds.first_paragraph("<p>一つ目の段落です。</p><p>二つ目</p>"), "一つ目の段落です。")
        self.assertEqual(feeds.first_paragraph("&lt;p&gt;エスケープされた&amp;段落&lt;/p&gt;&lt;p&gt;次&lt;/p&gt;"), "エスケープされた&段落")
        self.assertEqual(feeds.first_paragraph("<![CDATA[<div>CDATA の段落</div><div>次</div>]]>"), "CDATA の段落")
        self.assertEqual(feeds.first_paragraph("前半です。<br><br>後半です。"), "前半です。")
        self.assertEqual(feeds.first_paragraph("一行目\n\n二行目"), "一行目")

    def test_an_image_only_paragraph_is_skipped_and_nothing_gives_empty(self):
        self.assertEqual(feeds.first_paragraph('<p><img src="https://a.example/x.jpg"></p><p>本文の頭です。</p>'), "本文の頭です。")
        for raw in ("", None, "<p></p>", "  <br> ", 5):
            self.assertEqual(feeds.first_paragraph(raw), "")

    def test_parse_reads_description_then_summary_then_content_in_both_paths(self):
        rss = ('<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>'
               '<item><title>A</title><link>https://t.example/a</link><description>&lt;p&gt;説明の頭です。&lt;/p&gt;</description></item>'
               '<item><title>B</title><link>https://t.example/b</link><content:encoded><![CDATA[<p>本体だけの頭です。</p>]]></content:encoded></item>'
               '</channel></rss>')
        got = {x["title"]: x["desc"] for x in feeds.parse(rss)}
        self.assertEqual(got, {"A": "説明の頭です。", "B": "本体だけの頭です。"})
        atom = ('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>C</title><link href="https://t.example/c"/>'
                '<summary>Atom の要約です。</summary><content>長い本体</content></entry></feed>')
        self.assertEqual(feeds.parse(atom)[0]["desc"], "Atom の要約です。")
        broken = ("<rss><channel><item><title>D</title><link>https://t.example/d</link>"
                  "<description><![CDATA[<p>壊れた XML でも拾う。</p>]]></description></item><item><title>E")      # 閉じていない
        self.assertEqual(feeds.parse(broken)[0]["desc"], "壊れた XML でも拾う。")


class MakeDesc(unittest.TestCase):
    def test_a_short_whole_sentence_is_kept_as_it_is(self):
        t = "日本銀行は金融政策決定会合で、政策金利を据え置くことを決めた。"
        self.assertEqual(cut(t, "日銀が据え置き"), t)

    def test_a_long_text_is_cut_at_the_last_full_stop_within_140(self):
        s1, s2 = "あ" * 60 + "。", "い" * 70 + "。"
        d = cut(s1 + s2 + "う" * 50 + "。", "題")
        self.assertEqual(d, s1 + s2 if len(s1 + s2) <= sources.DESC_MAX else s1)
        self.assertLessEqual(len(d), sources.DESC_MAX)
        self.assertTrue(d.endswith("。"))
        en = "Tokyo stocks rose sharply on Monday. " + "w" * 30 + " " + "x" * 30 + " " + "y" * 30 + " " + "z" * 60
        self.assertEqual(cut(en, "t"), "Tokyo stocks rose sharply on Monday.")

    def test_without_a_full_stop_it_is_cut_at_a_word_or_at_the_limit_with_an_ellipsis(self):
        d = cut("word " * 60, "t")
        self.assertLessEqual(len(d), sources.DESC_MAX)
        self.assertTrue(d.endswith("…") and "wor…" not in d)
        d = cut("あ" * 300, "t")
        self.assertEqual(len(d), sources.DESC_MAX)
        self.assertTrue(d.endswith("…"))

    def test_left_out_empty_fragments_the_headline_again_and_ad_lines(self):
        left_out = ["", "短い", "続きを読む", "Read more", "Continue reading »", "広告", "Sponsored",
                    "The post 見出し appeared first on Some Blog.", "Article URL: https://x.example/a",
                    "https://x.example/only-a-link-here", "[…]", "...."]
        for t in left_out:
            self.assertEqual(cut(t, "全く別の見出し"), "", t)
        self.assertEqual(cut("首相が会見を開いた", "首相が会見を開いた"), "")                         # 見出しと同じ
        self.assertEqual(cut("Cabinet approves budget plan - NHK", "Cabinet approves budget plan"), "")      # 見出し + 媒体名
        self.assertEqual(cut("Cabinet approves the budget plan.", "Cabinet approves budget plan"), "")        # ほぼ同じ

    def test_a_trailing_continue_line_is_taken_off_and_the_sentence_is_kept(self):
        self.assertEqual(cut("政府は新しい経済対策を閣議決定した。 続きを読む", "経済対策"), "政府は新しい経済対策を閣議決定した。")
        self.assertEqual(cut("Officials said the plan starts in March. Read more »", "Plan"), "Officials said the plan starts in March.")

    def test_the_words_are_not_changed(self):
        t = "二人が会談した。「合意には至らなかった」と述べた。"
        self.assertEqual(cut(t, "会談"), t)


FEED = """<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>x</title>
<item><title>首相が会見</title><link>https://t.example/a</link><pubDate>Tue, 04 Nov 2026 01:00:00 GMT</pubDate>
<description>&lt;p&gt;首相は四日、官邸で記者会見を開き、経済対策の方針を説明した。&lt;/p&gt;&lt;p&gt;二段落目&lt;/p&gt;</description></item>
<item><title>別の話</title><link>https://t.example/b</link><pubDate>Tue, 04 Nov 2026 02:00:00 GMT</pubDate><description>別の話</description></item>
</channel></rss>"""


class FetchSource(unittest.TestCase):
    def test_a_feed_source_carries_desc_and_a_google_news_source_and_a_government_page_do_not(self):
        src = dict(sources.SOURCES[0], kind="feed")
        rec = sources.fetch_source(src, getter=lambda url: FEED)
        by = {it["title"]: it for it in rec["items"]}
        self.assertEqual(by["首相が会見"]["desc"], "首相は四日、官邸で記者会見を開き、経済対策の方針を説明した。")
        self.assertNotIn("desc", by["別の話"])                       # 見出しと同じ
        gn = next(s for s in sources.SOURCES if s["kind"] == "gn")
        gn_rss = FEED.replace("<title>首相が会見</title>", "<title>首相が会見 - 読売新聞</title>").replace(
            "<link>https://t.example/a</link>", "<link>https://news.google.com/rss/articles/AAA</link>")
        rec = sources.fetch_source(gn, getter=lambda url: gn_rss)
        self.assertTrue(rec["items"])
        self.assertTrue(all("desc" not in it for it in rec["items"]))


def with_desc(n=8):
    """基準の build の items のうち n 件に desc を付けた版。-> (items, sources, 付けた item の id の list)"""
    snap = load_items()
    base = build.build(snap["items"], snap["sources"], NOW, 36, None, "off", STRICT, False)[0]
    ids = list(base["items"])[:n]
    its = copy.deepcopy(snap["items"])
    for it in its:
        if it["id"] in ids:
            it["desc"] = "説明の頭です。" + it["id"]
    return its, snap["sources"], ids


class InTheData(unittest.TestCase):
    def setUp(self):
        build.set_rights("quote")
        self.addCleanup(build.set_rights, "strict")

    def test_quote_carries_desc_in_both_editions_and_absent_otherwise(self):
        its, srcs, ids = with_desc()
        for public in (True, False):
            d = build.build(its, srcs, NOW, 36, None, "off", QUOTE, public)[0]
            self.assertEqual(sum(1 for r in d["items"].values() if "desc" in r), len(ids))
            for i in ids:
                self.assertEqual(d["items"][i]["desc"], "説明の頭です。" + i)
            self.assertTrue(all("desc" not in r for i, r in d["items"].items() if i not in ids))
            self.assertEqual(d["name_gate"]["desc_carried"], len(ids))
            self.assertEqual(build.check_output(d, prompt=QUOTE), [])

    def test_a_google_news_item_never_carries_desc(self):
        its, srcs, ids = with_desc()
        for it in its:
            if it["id"] == ids[0]:
                it["via"], it["media"] = "gnews", it["outlet"]
        d = build.build(its, srcs, NOW, 36, None, "off", QUOTE, True)[0]
        self.assertNotIn("desc", d["items"][ids[0]])
        bad = copy.deepcopy(d)
        bad["items"][ids[0]]["desc"] = "付いてはいけない説明です。"
        self.assertTrue(any("Google News" in p for p in build.check_output(bad, prompt=QUOTE)))

    def test_a_description_with_a_gate_word_is_not_carried_and_is_counted(self):
        its, srcs, ids = with_desc()
        for it in its:
            if it["id"] == ids[0]:
                it["desc"] = "BLOCKED を含む説明です。"
        with mock.patch.object(build, "has_gate_name", lambda t: isinstance(t, str) and "BLOCKED" in t):
            d = build.build(its, srcs, NOW, 36, None, "off", QUOTE, True)[0]
            self.assertNotIn("desc", d["items"][ids[0]])
            self.assertEqual((d["name_gate"]["desc_carried"], d["name_gate"]["desc_blanked"]), (len(ids) - 1, 1))
            self.assertEqual(build.check_output(d, prompt=QUOTE), [])
            bad = copy.deepcopy(d)
            bad["items"][ids[0]]["desc"] = "BLOCKED を含む説明です。"
            self.assertTrue(any("word that must not appear" in p for p in build.check_output(bad, prompt=QUOTE)))

    def test_too_long_or_not_text_is_refused_by_check_output(self):
        its, srcs, ids = with_desc()
        d = build.build(its, srcs, NOW, 36, None, "off", QUOTE, True)[0]
        for v in ("あ" * (sources.DESC_MAX + 1), "", 5):
            bad = copy.deepcopy(d)
            bad["items"][ids[0]]["desc"] = v
            self.assertTrue(any("wrong shape or are too long" in p for p in build.check_output(bad, prompt=QUOTE)), repr(v)[:10])

    def test_strict_public_follows_the_title_and_strict_local_carries_it(self):
        its, srcs, ids = with_desc(40)
        build.set_rights("strict")
        pub = build.build(its, srcs, NOW, 36, None, "off", STRICT, True)[0]
        loc = build.build(its, srcs, NOW, 36, None, "off", STRICT, False)[0]
        ok = [i for i in ids if build.terms_ok(loc["items"][i])]
        no = [i for i in ids if i in loc["items"] and not build.terms_ok(loc["items"][i])]
        self.assertTrue(ok and no)                                  # 試験の前提: fixture に ok の源と ok でない源がある
        self.assertTrue(all("desc" in pub["items"][i] for i in ok))
        self.assertTrue(all("desc" not in pub["items"][i] and pub["items"][i]["title"] is None for i in no))
        self.assertTrue(all("desc" in loc["items"][i] for i in ids if i in loc["items"]))
        self.assertEqual(build.check_output(pub, prompt=STRICT), [])
        bad = copy.deepcopy(pub)
        bad["items"][no[0]]["desc"] = "出してはいけない説明です。"
        self.assertTrue(any("do not allow it" in p for p in build.check_output(bad, prompt=STRICT)))

    def test_nothing_of_desc_goes_to_the_ai(self):
        its, srcs, ids = with_desc()
        d, req = build.build(its, srcs, NOW, 36, None, "off", QUOTE, True)
        self.assertNotIn("説明の頭です", json.dumps(req, ensure_ascii=False))
        self.assertNotIn("説明の頭です", json.dumps(d["ai_requests"], ensure_ascii=False))


class Withheld(unittest.TestCase):
    def setUp(self):
        build.set_rights("quote")
        self.addCleanup(build.set_rights, "strict")

    def test_a_withheld_source_or_article_takes_its_description_with_it(self):
        its, srcs, ids = with_desc()
        sid = next(it["source_id"] for it in its if it["id"] == ids[0])
        gone_items = {it["id"] for it in its if it["source_id"] == sid}
        rules = {"sources": {sid}, "items": {ids[-1]}, "photo_items": set(), "photo_sources": set()}
        kept, removed, _ = withheld.apply(its, rules)
        d = build.build(kept, srcs, NOW, 36, None, "off", QUOTE, True)[0]
        self.assertTrue(removed >= gone_items | {ids[-1]})
        self.assertFalse(removed & set(d["items"]))
        self.assertNotIn("説明の頭です。" + ids[0], json.dumps(d, ensure_ascii=False))
        self.assertNotIn("説明の頭です。" + ids[-1], json.dumps(d, ensure_ascii=False))
        self.assertTrue(any("desc" in r for r in d["items"].values()) or len(ids) <= len(removed))

    def test_the_kept_previous_version_loses_the_description_of_what_was_withheld(self):
        its, srcs, ids = with_desc()
        prev = build.build(its, srcs, NOW, 36, None, "off", QUOTE, True)[0]
        self.assertIn("desc", prev["items"][ids[0]])
        rules = {"sources": set(), "items": {ids[0]}, "photo_items": set(), "photo_sources": set()}
        scrubbed, n = withheld.scrub(prev, rules)
        self.assertEqual(n, 1)
        self.assertNotIn(ids[0], scrubbed["items"])
        self.assertNotIn("説明の頭です。" + ids[0], json.dumps(scrubbed, ensure_ascii=False))


class SummaryBudgetWithTheStageOn(unittest.TestCase):
    """要約の段を入れた版の呼び数の勘定（CONTRACT §13・README の AI cost）。"""
    PROMPT = json.loads((ROOT / "data" / "prompt.json").read_text(encoding="utf-8"))
    FLASH_LITE_RPD = 500                                           # gemini-3.5-flash-lite の無料枠の 1 日の上限（README の AI cost の表）
    BUILDS_PER_DAY = 8                                             # 3 時間ごと

    def test_the_stage_is_on_with_the_light_model_and_the_bundling_models_are_unchanged(self):
        self.assertIs(self.PROMPT["summary"]["enabled"], True)
        self.assertEqual(self.PROMPT["summary_model"], "gemini-3.5-flash-lite")
        self.assertEqual((self.PROMPT["merge_model"], self.PROMPT["merge_fallback_models"]), ("gemini-3.6-flash", ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]))
        self.assertEqual(self.PROMPT["summary_fallback_models"], ["gemini-3.1-flash-lite"])
        self.assertEqual((build.MERGE_CALL_LIMIT, build.SUMMARY_CALL_LIMIT), (2, 15))

    def test_a_day_of_builds_stays_inside_the_free_tier_of_every_model_even_when_the_chains_are_used_every_time(self):
        b = self.BUILDS_PER_DAY
        self.assertEqual((build.MERGE_FALLBACK_LIMIT, build.SUMMARY_FALLBACK_LIMIT), (4, 20))
        on_36 = b * build.MERGE_CALL_LIMIT                                                       # gemini-3.6-flash: 8 x 2 = 16 of 20
        on_35 = b * build.SUMMARY_CALL_LIMIT + b * build.MERGE_FALLBACK_LIMIT                    # gemini-3.5-flash-lite: 120 + 32 = 152
        on_31 = b * build.MERGE_FALLBACK_LIMIT + b * build.SUMMARY_FALLBACK_LIMIT                # gemini-3.1-flash-lite: 32 + 160 = 192（鎖の予備の上限は鎖の全部で一つ）
        self.assertEqual((on_36, on_35, on_31), (16, 152, 192))
        self.assertLessEqual(on_36, 20)
        self.assertLessEqual(on_35, self.FLASH_LITE_RPD)
        self.assertLessEqual(on_31, self.FLASH_LITE_RPD)             # 3.1 の無料枠は未確認（要ログイン）: 同じ Flash-Lite の 500 を仮に当てる

    def test_a_build_sends_at_most_fifteen_summary_calls_and_the_rest_is_left_out(self):
        from test_summary import PROMPT_ON, sfake, stage, synth
        stories, items = synth(build.SUMMARY_BATCH * (build.SUMMARY_CALL_LIMIT + 3))
        sp = sfake()
        run, _ = stage(stories, items, sp, build.empty_cache(), prompt=PROMPT_ON)
        self.assertEqual(len(sp.calls), build.SUMMARY_CALL_LIMIT)
        self.assertEqual(run["left_out"], build.SUMMARY_BATCH * 3)


if __name__ == "__main__":
    unittest.main()
