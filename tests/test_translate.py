# -*- coding: utf-8 -*-
"""海外の見出しの訳（CONTRACT §13.2・2026-11-16「英語のニュースが英文のまま表示される」）。網に出ない: 偽の AI で試す。

戻ったら落ちる: 海外の見出しの行に訳（title_ja）が付かない build・英文のままの答えを訳として載せる build・控えがあるのに同じ見出しを頼み直す build。"""
import json
import unittest

from helpers import NOW, build, ai, doc_of, load_items, load_prompt  # noqa: F401
from parallax import translate


def tr_provider(edit=None):
    """行儀のよい訳の AI: 見出しの頭に「訳」を付けた日本語を返す。edit(row) で一行を壊せる。"""
    def answer(system, user_text, schema):
        doc = doc_of(user_text)
        rows = []
        for t in doc["titles"]:
            r = {"tid": t["tid"], "title_ja": "訳 " + t["title"][:40], "desc_ja": ("説明の訳 " + t["desc"][:40]) if t.get("desc") else ""}
            if edit:
                edit(r, t)
            rows.append(r)
        return json.dumps({"titles": rows}, ensure_ascii=False)
    return ai.FakeProvider(answer)


def rows_and_stories():
    rows = {
        "a": {"id": "a", "title": "Iran strikes US base in Bahrain", "lang": "en", "outlet": "CNN", "desc": "The attack came two months after"},
        "b": {"id": "b", "title": "イランが米軍施設を攻撃", "lang": "ja", "outlet": "NHK"},
        "c": {"id": "c", "title": "Ukraine talks resume", "lang": "en", "outlet": "BBC"},
        "d": {"id": "d", "title": None, "lang": "en", "outlet": "Withheld"},          # 公開版で見出しを出さない源
    }
    stories = [{"sid": "s1", "member_ids": ["a", "b"]}, {"sid": "s2", "member_ids": ["c"]}, {"sid": "s3", "member_ids": ["d"]}]
    return rows, stories


class TranslateStage(unittest.TestCase):
    def setUp(self):
        self.prompt = load_prompt()

    def test_prompt_turns_it_on(self):
        tp = self.prompt["translate"]
        self.assertIs(tp["enabled"], True)
        self.assertIn("{DOC}", tp["user_template"])
        self.assertEqual(tp["schema"]["properties"]["titles"]["items"]["required"], ["tid", "title_ja", "desc_ja"])

    def test_every_foreign_headline_gets_japanese(self):
        rows, stories = rows_and_stories()
        cache = translate.empty_cache()
        run = translate.stage(stories, rows, self.prompt, tr_provider(), "off", cache, NOW)
        self.assertEqual(run["status"], "ok")
        self.assertEqual(run["targets"], 2)
        self.assertEqual(run["translated"], 2)
        self.assertTrue(rows["a"]["title_ja"].startswith("訳 "))
        self.assertTrue(rows["a"]["desc_ja"].startswith("説明の訳 "))
        self.assertTrue(rows["c"]["title_ja"].startswith("訳 "))
        self.assertNotIn("desc_ja", rows["c"])                # 説明の無い行に説明の訳は付かない
        self.assertNotIn("title_ja", rows["b"])               # 日本語の見出しは訳さない
        self.assertNotIn("title_ja", rows["d"])               # 見出しを出さない源は訳さない
        self.assertEqual(translate.problems(rows), [])

    def test_cache_is_used_and_nothing_is_asked_again(self):
        rows, stories = rows_and_stories()
        cache = translate.empty_cache()
        translate.stage(stories, rows, self.prompt, tr_provider(), "off", cache, NOW)
        rows2, _ = rows_and_stories()
        p = tr_provider()
        run = translate.stage(stories, rows2, self.prompt, p, "off", cache, NOW + 3600)
        self.assertEqual(p.calls, [])
        self.assertEqual(run["cache_hits"], 2)
        self.assertEqual(rows2["a"]["title_ja"], rows["a"]["title_ja"])
        rows3, _ = rows_and_stories()                         # 鍵の無い回でも控えの訳は出る
        run = translate.stage(stories, rows3, self.prompt, None, "nokey", cache, NOW + 7200)
        self.assertEqual(run["status"], "cached")
        self.assertIn("title_ja", rows3["c"])

    def test_english_left_as_it_was_is_not_a_translation(self):
        rows, stories = rows_and_stories()
        run = translate.stage(stories, rows, self.prompt, tr_provider(lambda r, t: r.update(title_ja=t["title"])), "off", translate.empty_cache(), NOW)
        self.assertNotIn("title_ja", rows["a"])
        self.assertEqual(run["dropped"], 2)

    def test_reject_drops_a_named_line(self):
        rows, stories = rows_and_stories()
        translate.stage(stories, rows, self.prompt, tr_provider(), "off", translate.empty_cache(), NOW, reject=lambda t: "Ukraine" in t)
        self.assertNotIn("title_ja", rows["c"])
        self.assertIn("title_ja", rows["a"])

    def test_broken_answer_fails_the_call_only(self):
        rows, stories = rows_and_stories()
        run = translate.stage(stories, rows, self.prompt, ai.FakeProvider("not json"), "off", translate.empty_cache(), NOW)
        self.assertEqual(run["status"], "error")
        self.assertEqual(run["errors"], ["json"])
        self.assertNotIn("title_ja", rows["a"])

    def test_disabled_does_nothing(self):
        rows, stories = rows_and_stories()
        p = dict(self.prompt, translate=dict(self.prompt["translate"], enabled=False))
        run = translate.stage(stories, rows, p, tr_provider(), "off", translate.empty_cache(), NOW)
        self.assertEqual(run["status"], "disabled")
        self.assertNotIn("title_ja", rows["a"])

    def test_check_output_refuses_a_translation_without_a_headline(self):
        self.assertTrue(translate.problems({"x": {"title": None, "title_ja": "訳"}}))
        self.assertTrue(translate.problems({"x": {"title": "A", "title_ja": "B only latin"}}))
        self.assertTrue(translate.problems({"x": {"title": "A", "title_ja": "訳", "desc_ja": "説明"}}))


class TranslateInBuild(unittest.TestCase):
    """build の全体で: 海外の見出しを持つ出来事は、AI が束ねなかった 1 媒体の物も含めて、日本語の見出しを持つ。"""

    def test_foreign_stories_carry_japanese(self):
        snap = load_items()
        data, _ = build.build(snap["items"], snap["sources"], NOW, 36, None, "off", load_prompt(), False,
                              translate_provider=tr_provider(), translate_status_if_none="off", title_cache=translate.empty_cache())
        items = data["items"]
        foreign = [s for s in data["stories"] if any(translate.is_foreign(items[i]) for i in s["member_ids"])]
        self.assertTrue(foreign)
        with_ja = [s for s in foreign if any("title_ja" in items[i] for i in s["member_ids"])]
        self.assertEqual(len(with_ja), len(foreign))
        self.assertEqual(data["ai_run"]["translate"]["status"], "ok")
        self.assertEqual(build.check_output(data, 0, load_prompt()), [])

    def test_no_key_says_so(self):
        snap = load_items()
        data, _ = build.build(snap["items"], snap["sources"], NOW, 36, None, "off", load_prompt(), False,
                              translate_provider=None, translate_status_if_none="nokey", title_cache=translate.empty_cache())
        self.assertEqual(data["ai_run"]["translate"]["status"], "nokey")
        self.assertFalse(any("title_ja" in it for it in data["items"].values()))

    def test_provider_choice(self):
        p = load_prompt()
        self.assertEqual(build.choose_translate_provider({"no_ai": True}, {"GEMINI_API_KEY": "k"}, p), (None, "off"))
        self.assertEqual(build.choose_translate_provider({}, {}, p), (None, "nokey"))
        prov, st = build.choose_translate_provider({}, {"GEMINI_API_KEY": "k"}, p)
        self.assertEqual(st, "")
        self.assertEqual(prov.model, p["summary_model"])
        self.assertEqual(prov.budget.limit, translate.CALL_LIMIT)


if __name__ == "__main__":
    unittest.main()
