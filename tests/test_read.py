# -*- coding: utf-8 -*-
"""Reading the bodies (CONTRACT 27): the one line of refusal, the check of the AI's answer, and that no body is kept.
Fake pages, fake robots.txt and a fake AI only. Nothing goes out to the network."""
import json
import tempfile
import unittest
from pathlib import Path

from helpers import load_prompt

from parallax import ai, og, read, withheld

PROMPT = load_prompt()
NOW = 1793800000

JA_BODY = ("政府は8日、新しい物価対策の骨子を発表した。電気料金への補助は来年3月まで延長される。"
           "担当大臣は記者会見で「家計への負担を和らげる」と述べた。対策の総額は4兆2000億円に上る。"
           "野党側は財源の説明が足りないと反発している。") * 4
JA_BODY2 = ("物価対策の骨子が8日に示された。補助の対象はガソリンにも広がる見通しだ。"
            "与党の幹部は「年内に法案を出す」と語った。総額は約4兆円とされる。"
            "専門家は効果の持続に疑問を示した。") * 4
EN_BODY = ("The government announced a price relief package on Monday. Electricity subsidies will run until March. "
           "The minister said the package would ease the burden on households. The total cost is 4.2 trillion yen. "
           "Opposition parties said the funding was not explained.") * 2


def page(body, extra=""):
    paras = "".join("<p>%s</p>" % s for s in body.replace("。", "。\n").replace(". ", ".\n").split("\n") if s.strip())
    return "<html><head>%s</head><body><nav><p>ホーム ニュース 天気 スポーツ ランキング メニュー</p></nav><article>%s</article><footer><p>Copyright 2026 Example</p></footer></body></html>" % (extra, paras)


def item(i, outlet, sid, link, home="jp", lang="ja", ts=NOW - 3600):
    return {"id": i, "title": "物価対策の骨子", "link": link, "outlet": outlet, "source_id": sid, "type": "全国紙", "home": home, "lang": lang, "ts": ts + int(i[-1])}


ITEMS = {
    "a1": item("a1", "東京放送", "tbs", "https://tbs.example/n/1"),
    "a2": item("a2", "報知", "toyokeizai", "https://toyo.example/n/2"),
    "a3": item("a3", "Times", "japantimes", "https://jt.example/n/3", "intl", "en"),
    "a4": item("a4", "公共", "nhk-main", "https://nhk.example/n/4"),
    "a5": item("a5", "古紙", "mainichi-flash", "https://x.example/n/5"),
}
LATEST = {"items": ITEMS, "stories": [{"sid": "s1", "member_ids": ["a1", "a2", "a3", "a4"], "n_outlets": 4}]}
PAGES = {"https://tbs.example/n/1": page(JA_BODY), "https://toyo.example/n/2": page(JA_BODY2), "https://jt.example/n/3": page(EN_BODY)}


def robots_for(table):
    return og.Robots(fetch=lambda origin: table.get(origin, (404, "")), now=lambda: NOW)


def reader(table=None, pages=PAGES, **kw):
    calls = []

    def getter(url):
        calls.append(url)
        if url not in pages:
            raise OSError("down")
        return pages[url]
    r = read.Reader(robots_for(table or {}), rules={"sources": set(), "items": set(), "photo_items": set(), "photo_sources": set()}, getter=getter,
                    sleep=lambda s: None, **kw)
    r.calls = calls
    return r


GOOD = {
    "outlets": [
        {"ref": "i1", "focus_ja": "政府の物価対策と電気料金の補助の延長", "facts": [
            {"text_ja": "電気料金への補助が来年3月まで延ばされる。", "anchor": "来年3月まで延長"},
            {"text_ja": "対策の総額は4兆2000億円。", "anchor": "4兆2000億円"}],
         "wording": [{"quote": "家計への負担を和らげる", "note_ja": "担当大臣の言葉をそのまま引き、負担の軽減を前に出す"}],
         "omits": [{"text_ja": "本文にはガソリンへの補助の記述がない。", "from_ref": "i2", "anchor": "ガソリンにも広がる"}]},
        {"ref": "i2", "focus_ja": "物価対策の骨子とガソリンへの補助の広がり", "facts": [
            {"text_ja": "補助の対象がガソリンにも広がる見通し。", "anchor": "ガソリンにも広がる見通し"}],
         "wording": [{"quote": "年内に法案を出す", "note_ja": "与党幹部の言葉で、法案の時期を示す"}], "omits": []},
        {"ref": "i3", "focus_ja": "価格の負担軽減策の発表と野党の資金面の指摘", "facts": [
            {"text_ja": "総額は4.2 trillion yen と書かれている。", "anchor": "4.2 trillion yen"}],
         "wording": [], "omits": []}],
    "contrast_ja": "総額は4兆2000億円と書く社と、約4兆円とぼかす社に分かれる。", "contrast_refs": ["i1", "i2"],
    "domestic_vs_abroad_ja": "国内の社は大臣の発言を引き、海外の社は総額を trillion yen で示す。", "dva_refs": ["i1", "i3"]}


def provider(answer=GOOD):
    return ai.FakeProvider(lambda s, u, sc: answer)


class Extract(unittest.TestCase):
    def test_body_comes_from_the_article_not_the_menu(self):
        x = read.extract(page(JA_BODY))
        self.assertIn("電気料金", x["text"])
        self.assertNotIn("メニュー", x["text"])
        self.assertNotIn("Copyright", x["text"])

    def test_a_paywall_and_noai_are_seen(self):
        short = "<html><body><article><p>有料会員限定の記事です。続きは会員登録をして読めます。</p></article></body></html>"
        self.assertTrue(read.extract(short)["paywall"])
        ld = '<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>'
        self.assertTrue(read.extract(page(JA_BODY, ld))["paywall"])
        self.assertTrue(read.extract(page(JA_BODY, '<meta name="robots" content="noai">'))["noai"])

    def test_json_ld_body_is_used_when_longer(self):
        ld = '<script type="application/ld+json">{"@type":"NewsArticle","articleBody":"%s"}</script>' % (JA_BODY * 2)
        self.assertGreater(len(read.extract("<html><head>%s</head><body><p>短い。</p></body></html>" % ld)["text"]), 300)


class OneLine(unittest.TestCase):
    """Refused = said no. Everything else is read."""

    def test_the_terms_of_the_outlet_say_no(self):
        r = reader()
        url, why, ev = r.gate(ITEMS["a4"])
        self.assertEqual(why, "terms")
        self.assertTrue(ev.startswith("http"))

    def test_robots_disallow_names_the_line(self):
        r = reader({"https://tbs.example": (200, "User-agent: *\nDisallow: /n/")})
        _u, why, ev = r.gate(ITEMS["a1"])
        self.assertEqual(why, "robots")
        self.assertIn("Disallow: /n/", ev)

    def test_the_ai_refusal_of_robots_is_a_refusal(self):
        r = reader({"https://tbs.example": (200, "User-agent: Google-Extended\nDisallow: /")})
        _u, why, ev = r.gate(ITEMS["a1"])
        self.assertEqual(why, "ai_refused")
        self.assertIn("Google-Extended", ev)

    def test_other_ai_names_and_unknown_terms_do_not_stop_the_reading(self):
        r = reader({"https://tbs.example": (200, "User-agent: GPTBot\nDisallow: /\nUser-agent: *\nDisallow: /admin")})
        self.assertEqual(r.gate(ITEMS["a1"])[1], "")                  # tbs terms are unknown, not no
        self.assertEqual(reader({"https://tbs.example": (403, "")}).gate(ITEMS["a1"])[1], "")      # 4xx: no rules in force

    def test_a_robots_file_that_cannot_be_read_is_not_a_refusal(self):
        r = reader({"https://tbs.example": (503, "")})
        self.assertEqual(r.gate(ITEMS["a1"])[1], "unreachable")
        self.assertNotIn("unreachable", read.REFUSALS)

    def test_a_google_news_relay_without_the_address_is_unread(self):
        it = dict(ITEMS["a1"], link="https://news.google.com/rss/articles/CBMiZ0FVX3lxTE12eUFM?oc=5")
        self.assertEqual(reader().gate(it)[1], "relay")

    def test_a_refused_page_is_never_fetched(self):
        r = reader({"https://tbs.example": (200, "User-agent: *\nDisallow: /")})
        text, why = r.read(ITEMS["a1"], "https://tbs.example/n/1")
        self.assertEqual((text, why), ("", "robots"))
        self.assertEqual(r.calls, [])
        r2 = reader()
        run = read.run_read(json.loads(json.dumps(LATEST)), None, {"schema": read.CACHE_SCHEMA, "entries": {}}, PROMPT, provider(), r2, NOW)
        self.assertNotIn("https://nhk.example/n/4", r2.calls)

    def test_the_withheld_list_is_obeyed(self):
        r = read.Reader(robots_for({}), rules={"sources": {"tbs"}, "items": set(), "photo_items": set(), "photo_sources": set()}, getter=lambda u: "")
        self.assertEqual(r.gate(ITEMS["a1"])[1], "robots")

    def test_fetch_cap(self):
        r = reader(max_fetch=1)
        self.assertEqual(r.read(ITEMS["a1"], "https://tbs.example/n/1")[1], "")
        self.assertEqual(r.read(ITEMS["a2"], "https://toyo.example/n/2")[1], "cap")


def rows():
    return {"i1": {"outlet": "東京放送", "side": "国内", "lang": "ja", "sent": JA_BODY, "full": JA_BODY, "item": "a1"},
            "i2": {"outlet": "報知", "side": "国内", "lang": "ja", "sent": JA_BODY2, "full": JA_BODY2, "item": "a2"},
            "i3": {"outlet": "Times", "side": "海外", "lang": "en", "sent": EN_BODY, "full": EN_BODY, "item": "a3"}}


def check(answer):
    counts = {}
    res = read.check_read(json.dumps(answer, ensure_ascii=False), rows(), PROMPT, counts)
    return res, counts


def mutated(fn):
    a = json.loads(json.dumps(GOOD, ensure_ascii=False))
    fn(a)
    return a


class Check(unittest.TestCase):
    def test_a_good_answer_passes_whole(self):
        res, counts = check(GOOD)
        self.assertEqual(len(res["outlets"]), 3)
        self.assertEqual(res["outlets"][0]["omits"][0]["from"], "a2")
        self.assertTrue(res["contrast"] and res["domestic_vs_abroad"])
        self.assertEqual(counts, {})

    def test_an_anchor_that_is_not_in_the_body_drops_the_fact(self):
        res, counts = check(mutated(lambda a: a["outlets"][0]["facts"].__setitem__(1, {"text_ja": "総額は5兆円。", "anchor": "5兆円に上る"})))
        self.assertEqual(len(res["outlets"][0]["facts"]), 1)
        self.assertEqual(counts["anchor_missing"], 1)

    def test_a_number_that_is_not_in_the_body_drops_the_sentence(self):
        res, counts = check(mutated(lambda a: a["outlets"][0]["facts"].__setitem__(1, {"text_ja": "対策の総額は9兆円。", "anchor": "4兆2000億円"})))
        self.assertEqual(len(res["outlets"][0]["facts"]), 1)
        self.assertEqual(counts["ungrounded"], 1)

    def test_a_quotation_must_be_in_the_body_and_short(self):
        def f(a):
            a["outlets"][0]["wording"] = [{"quote": "家計への負担を大きく和らげる", "note_ja": "言葉"},
                                         {"quote": "新しい物価対策の骨子を発表した。電気料金への補助は来年", "note_ja": "長い"}]
        res, counts = check(mutated(f))
        self.assertEqual(res["outlets"][0]["wording"], [])
        self.assertEqual((counts["quote_missing"], counts["quote_long"]), (1, 1))

    def test_a_long_copy_of_the_body_is_dropped(self):
        copy = "電気料金への補助は来年3月まで延長される。担当大臣は記者会見で述べた。"
        res, counts = check(mutated(lambda a: a["outlets"][0]["facts"].__setitem__(0, {"text_ja": copy, "anchor": "来年3月まで延長"})))
        self.assertEqual(len(res["outlets"][0]["facts"]), 1)
        self.assertEqual(counts["copied"], 1)

    def test_a_judgement_and_a_vague_sentence_are_dropped(self):
        def f(a):
            a["outlets"][0]["facts"][0]["text_ja"] = "来年3月までの延長を正しいと位置づけている。"
            a["outlets"][0]["facts"][1]["text_ja"] = "4兆2000億円という点を書いている。"
        res, counts = check(mutated(f))
        self.assertNotIn("a1", [o["item"] for o in res["outlets"]])       # nothing left for that outlet: not shown
        self.assertEqual(counts.get("judgement", 0) + counts.get("vague_or_silence", 0), 2)

    def test_what_a_body_does_not_say_is_checked_against_the_whole_body(self):
        def f(a):
            a["outlets"][0]["omits"] = [{"text_ja": "本文には4兆円の記述がない。", "from_ref": "i2", "anchor": "約4兆円とされる"}]
        res, counts = check(mutated(f))
        self.assertEqual(res["outlets"][0]["omits"], [])          # "4" is a number that also stands in 4兆2000億円: not provably absent
        self.assertEqual(counts["omit_unverifiable"], 1)

    def test_an_absence_across_languages_needs_a_number(self):
        def f(a):
            a["outlets"][2]["omits"] = [{"text_ja": "本文には野党の記述がない。", "from_ref": "i1", "anchor": "野党側は財源"}]
        res, counts = check(mutated(f))
        self.assertEqual(res["outlets"][2]["omits"], [])
        self.assertEqual(counts["omit_unverifiable"], 1)

    def test_a_comparison_needs_two_outlets_and_both_sides_for_domestic_vs_abroad(self):
        res, counts = check(mutated(lambda a: a.update(dva_refs=["i1", "i2"])))
        self.assertEqual(res["domestic_vs_abroad"], "")
        res, _c = check(mutated(lambda a: a.update(contrast_refs=["i1"])))
        self.assertEqual(res["contrast"], "")

    def test_an_outlet_with_nothing_left_is_not_shown_and_one_left_is_no_comparison(self):
        def f(a):
            for o in a["outlets"][1:]:
                o["facts"] = [{"text_ja": "嘘。", "anchor": "存在しない語"}]
        res, counts = check(mutated(f))
        self.assertIsNone(res)
        self.assertEqual(counts["outlet_empty"], 2)


class Run(unittest.TestCase):
    def fresh(self):
        return json.loads(json.dumps(LATEST)), {"schema": read.CACHE_SCHEMA, "entries": {}}

    def test_the_story_gets_a_read_with_the_unread_and_the_evidence(self):
        latest, cache = self.fresh()
        run = read.run_read(latest, None, cache, PROMPT, provider(), reader(), NOW)
        r = latest["stories"][0]["read"]
        self.assertEqual((run["status"], r["status"], len(r["outlets"])), ("ok", "ok", 3))
        self.assertEqual([(u["outlet"], u["why"]) for u in r["unread"]], [("公共", "terms")])
        self.assertTrue(r["unread"][0]["evidence"])
        self.assertEqual(run["calls"], 1)

    def test_no_body_is_in_the_output_or_the_cache(self):
        latest, cache = self.fresh()
        read.run_read(latest, None, cache, PROMPT, provider(), reader(), NOW)
        blob = json.dumps(latest, ensure_ascii=False) + json.dumps(cache, ensure_ascii=False)
        for body in (JA_BODY, JA_BODY2, EN_BODY):
            for k in range(0, len(body) - 20, 10):
                self.assertNotIn(body[k:k + 25], blob.replace("<p>", ""), "a run of the body is kept")
        for w in blob.split('"quote":')[1:]:
            q = w.split('"')[1]
            self.assertLessEqual(len(q), read.QUOTE_MAX)

    def test_the_cache_stops_a_second_call(self):
        latest, cache = self.fresh()
        read.run_read(latest, None, cache, PROMPT, provider(), reader(), NOW)
        latest2, _ = self.fresh()
        p2, r2 = provider(), reader()
        run = read.run_read(latest2, None, cache, PROMPT, p2, r2, NOW + 3600)
        self.assertEqual((len(p2.calls), r2.calls, run["cache_hits"]), (0, [], 1))
        self.assertIn("read", latest2["stories"][0])

    def test_two_unreadable_sources_give_an_unread_event_and_no_ai_call(self):
        latest, cache = self.fresh()
        p = provider()
        r = reader({"https://tbs.example": (200, "User-agent: *\nDisallow: /"), "https://toyo.example": (200, "User-agent: *\nDisallow: /")})
        read.run_read(latest, None, cache, PROMPT, p, r, NOW)
        s = latest["stories"][0]["read"]
        self.assertEqual((s["status"], p.calls), ("unread", []))
        self.assertEqual({u["why"] for u in s["unread"]}, {"robots", "terms"})
        self.assertNotIn(read.members_digest(["a1", "a2", "a3", "a4"]), cache["entries"])

    def test_the_main_call_limit_is_respected(self):
        latest, cache = self.fresh()
        p = ai.FakeProvider(lambda s, u, sc: GOOD, budget=ai.CallBudget(0))
        run = read.run_read(latest, None, cache, PROMPT, p, reader(), NOW)
        self.assertEqual((run["calls"], run["calls_skipped"]), (0, 1))
        self.assertNotIn("read", latest["stories"][0])

    def test_without_a_key_nothing_is_fetched(self):
        latest, cache = self.fresh()
        r = reader()
        run = read.run_read(latest, None, cache, PROMPT, None, r, NOW)
        self.assertEqual((run["status"], r.calls), ("nokey", []))

    def test_main_writes_latest_and_the_cache_without_bodies(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            latest, _c = self.fresh()
            (d / "latest.json").write_text(json.dumps(latest), encoding="utf-8")
            hosts = {h: {"at": 1 << 40, "status": 404, "body": ""} for h in ("https://tbs.example", "https://toyo.example", "https://jt.example", "https://nhk.example")}
            (d / "og_robots.json").write_text(json.dumps({"schema": "parallax-og-robots/1", "hosts": hosts}), encoding="utf-8")
            read.main(["--data-dir", td], env={}, getter=lambda u: PAGES[u], provider=provider())
            out = json.loads((d / "latest.json").read_text(encoding="utf-8"))
            self.assertEqual(out["stories"][0]["read"]["status"], "ok")
            self.assertEqual(out["read_run"]["calls"], 1)
            self.assertTrue((d / "read_cache.json").exists())


if __name__ == "__main__":
    unittest.main()
