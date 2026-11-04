# -*- coding: utf-8 -*-
"""CONTRACT 18.9 / 18.12: elections and the cabinet-approval series (politics.json), critical.json and data/scenes.json.
Everything is synthetic ("試験 ..." headlines, example.org links); the network is never touched (fake getters)."""
import datetime as dt
import json
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from parallax import critical, politics  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOW = int(dt.datetime(2026, 11, 5, 3, 0, tzinfo=dt.timezone.utc).timestamp())      # 2026-11-05 12:00 JST
TODAY = dt.date(2026, 11, 5)


def rd(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


# ------------------------------------------------------------------------------------------------------------------ elections
LIST_HTML = ('<html><body><ul>'
             '<li><a href="/main_content/000000001.pdf">令和8年&nbsp; 11月&nbsp; 5日執行&nbsp; &nbsp;試験県知事選挙</a></li>'
             '<li><a href="/main_content/000000002.pdf">令和8年10月25日執行　試験甲県知事選挙</a></li>'
             '<li><a href="/main_content/000000003.pdf">令和8年&nbsp; 4月&nbsp; 5日執行&nbsp; &nbsp;試験乙県知事選挙</a></li>'
             '<li><a href="/main_content/000000004.pdf">令和元年5月1日執行　試験丙県知事選挙</a></li>'
             '<li><a href="/menu_news/release001.html">報道予定</a></li>'
             '<li><a href="/main_content/000000005.pdf">令和8年10月25日執行　試験甲県知事選挙</a></li>'
             '<li><a href="/main_content/000000006.pdf">令和8年13月40日執行　日付の読めない選挙</a></li></ul></body></html>')


class Elections(unittest.TestCase):
    def test_parse_rows_dates_and_urls(self):
        rows = politics.parse_soumu_results(LIST_HTML, "https://www.soumu.go.jp/senkyo/senkyo_s/data/chiji/index.html", "governor")
        self.assertEqual([(r["date"], r["name"]) for r in rows],
                         [("2026-11-05", "試験県知事選挙"), ("2026-10-25", "試験甲県知事選挙"), ("2026-04-05", "試験乙県知事選挙"),
                          ("2019-05-01", "試験丙県知事選挙")])          # a repeated row and a date that cannot be read are dropped
        self.assertEqual(rows[0]["url"], "https://www.soumu.go.jp/main_content/000000001.pdf")
        self.assertTrue(all(r["kind"] == "governor" for r in rows))

    def test_no_row_is_a_failure_not_an_empty_answer(self):
        with self.assertRaises(ValueError):
            politics.parse_soumu_results("<html><a href='/x'>報道予定</a></html>", "https://www.soumu.go.jp/", "governor")

    def test_windows_and_status(self):
        rows = politics.parse_soumu_results(LIST_HTML, "https://www.soumu.go.jp/a/", "governor")
        pages = [{"kind": "governor", "ok": True, "n": len(rows), "err": ""}]
        e = politics.compose_elections(rows, TODAY, NOW, pages)
        self.assertEqual(e["status"], "ok")
        self.assertEqual([r["name"] for r in e["upcoming"]], ["試験県知事選挙"])      # dated today: listed with the upcoming
        self.assertEqual([r["name"] for r in e["recent"]], ["試験甲県知事選挙"])         # within 60 days; April and 2019 are outside
        self.assertEqual(e["recent"][0]["source"], "総務省")
        self.assertEqual(e["counts"], {"upcoming": 1, "recent": 1, "rows_on_pages": 4})
        z = politics.compose_elections(rows[2:], TODAY, NOW, pages)
        self.assertEqual((z["status"], z["upcoming"], z["recent"]), ("zero", [], []))
        f = politics.compose_elections([], TODAY, NOW, [{"kind": "governor", "ok": False, "n": 0, "err": "x"}])
        self.assertEqual(f["status"], "fail")

    def test_one_page_failing_leaves_the_other(self):
        def page(url):
            if "shityou" in url:
                raise OSError("down")
            return LIST_HTML
        e = politics.fetch_elections(NOW, page)
        self.assertEqual(e["status"], "ok")
        self.assertEqual([p["ok"] for p in e["source"]["pages"]], [True, False])
        self.assertIn("OSError", e["source"]["pages"][1]["err"])
        self.assertIn("総務省", e["source"]["note_ja"])

    def test_jst_today(self):
        self.assertEqual(politics.jst_today(NOW), TODAY)
        self.assertEqual(politics.jst_today(NOW + 13 * 3600), TODAY + dt.timedelta(days=1))       # 01:00 JST the next day


# --------------------------------------------------------------------------------------------------------------------- polls
WIKI = """Lead text.
==Pollsters==
{| class="wikitable"
! Name !! Note
|-
| Asahi || a
|}
==Cabinet approval/disapproval ratings==
===Test Cabinet===
====2026====
{| class="wikitable sortable"
! rowspan=2 | Fieldwork date
! rowspan=2 | Polling firm
! rowspan=2 | Sample size
! rowspan=2 | Approve
! rowspan=2 | Disapprove
! rowspan=2 | Und.
|-
|{{Opdrts|17|18|Oct|2026}}
|Asahi<ref name="Asahi 2026-10">{{Cite web |date=2026-10-18 |title=t |url=https://example.org/asahi-1018 |website=Asahi}}</ref>
|1,108
|50
|35
|15
|-
|{{Opdrts|12|Oct|2026}}
|NHK<ref name="NHK 2026-10" />
|1,184
|50.8
|32
|17.1
|-
|{{Opdrts|26|27|Sep|2026}} || Asahi<ref name="Asahi 2026-10" /> || 1,000 || 48 || 38 || 14
|-
|{{Opdrts|1|2|Sep|2026}} || Asahi || 1,000 || – || 38 || 14
|-
|{{Opdrts|30|Aug|1|Sep|2026}} || Mainichi/SSRC || 2,001 || 45 || 41 || 14
|}
==Voting intention (proportional vote)==
{| class="wikitable"
! Fieldwork date !! Polling firm !! Approve
|-
| {{Opdrts|1|Jan|2026}} || Other || 99
|}
==See also==
<ref name="NHK 2026-10">{{Cite web |title=n |url=https://example.org/nhk-202610 |website=NHK}}</ref>
"""


class Polls(unittest.TestCase):
    def test_parse(self):
        r = politics.parse_wiki_polls(WIKI)
        self.assertEqual(r["skipped"], 1)                                   # the row whose approval is a dash is left out, not zero
        by = {}
        for c in r["cabinet"]:
            by.setdefault(c["pollster"], []).append(c)
        self.assertEqual(sorted(by), ["Asahi", "Mainichi/SSRC", "NHK"])
        a = sorted(by["Asahi"], key=lambda c: c["end"])
        self.assertEqual([(c["start"], c["end"], c["approve"], c["disapprove"], c["undecided"], c["sample"]) for c in a],
                         [("2026-09-26", "2026-09-27", 48, 38, 14, 1000), ("2026-10-17", "2026-10-18", 50, 35, 15, 1108)])
        self.assertEqual(a[1]["cite_urls"], ["https://example.org/asahi-1018"])
        self.assertEqual(a[0]["cite_urls"], ["https://example.org/asahi-1018"])      # a named reference reused in another row
        self.assertEqual(by["NHK"][0]["cite_urls"], ["https://example.org/nhk-202610"])   # defined later on the page
        self.assertEqual((by["NHK"][0]["approve"], by["NHK"][0]["undecided"]), (50.8, 17.1))
        self.assertEqual((by["NHK"][0]["start"], by["NHK"][0]["end"]), ("2026-10-12", "2026-10-12"))
        self.assertEqual((by["Mainichi/SSRC"][0]["start"], by["Mainichi/SSRC"][0]["end"]), ("2026-08-30", "2026-09-01"))
        self.assertEqual(by["NHK"][0]["cabinet"], "Test Cabinet")
        self.assertEqual(by["Mainichi/SSRC"][0]["cite_urls"], [])

    def test_missing_section_and_empty_section_are_failures(self):
        with self.assertRaises(ValueError):
            politics.parse_wiki_polls("==Pollsters==\nnothing\n")
        with self.assertRaises(ValueError):
            politics.parse_wiki_polls("==Cabinet approval/disapproval ratings==\ntext only\n")

    def test_num(self):
        self.assertEqual((politics._num("1,018"), politics._num("62%"), politics._num("48.7"), politics._num("–"), politics._num("")),
                         (1018, 62, 48.7, None, None))

    def test_compose(self):
        p = politics.compose_polls(politics.parse_wiki_polls(WIKI), "Opinion polling test", 1234, NOW)
        self.assertEqual(p["status"], "ok")
        self.assertEqual(p["source"]["revid"], 1234)
        self.assertTrue(p["source"]["url"].endswith("oldid=1234"))
        self.assertEqual(p["source"]["license"], "CC BY-SA 4.0")
        self.assertEqual([s["pollster"] for s in p["series"]], ["Asahi", "NHK", "Mainichi/SSRC"])     # newest last point first
        self.assertEqual(p["series"][0]["pollster_ja"], "朝日新聞")
        self.assertEqual([x["end"] for x in p["series"][0]["points"]], ["2026-09-27", "2026-10-18"])
        self.assertEqual(p["series"][0]["points"][-1]["cite_url"], "https://example.org/asahi-1018")
        self.assertEqual(p["counts"], {"pollsters": 3, "points": 4, "skipped": 1})
        self.assertNotIn("check", p)                                          # the headline cross-check is not done

    def test_points_are_limited_to_the_newest(self):
        rows = [{"cabinet": "c", "start": "2025-%02d-01" % (i % 12 + 1), "end": "2025-%02d-02" % (i % 12 + 1), "pollster": "X", "sample": 1,
                 "approve": 40 + i % 5, "disapprove": 30, "undecided": 30, "cite_urls": []} for i in range(30)]
        for i, r in enumerate(rows):
            r["end"] = (dt.date(2025, 1, 1) + dt.timedelta(days=i)).isoformat()
            r["start"] = r["end"]
        p = politics.compose_polls({"cabinet": rows, "skipped": 0}, "t", None, NOW)
        self.assertEqual(len(p["series"][0]["points"]), politics.POLL_POINTS)
        self.assertEqual(p["series"][0]["points"][-1]["end"], rows[-1]["end"])
        self.assertTrue(p["source"]["url"].startswith("https://en.wikipedia.org/wiki/"))     # no revid: the plain page


class PoliticsCompose(unittest.TestCase):
    def test_elections_and_polls_in_the_file(self):
        def get(url):
            if "api.php" in url:
                return json.dumps({"parse": {"title": "Opinion polling test", "revid": 77, "wikitext": WIKI}})
            if "soumu.go.jp" in url:
                return LIST_HTML
            raise OSError("down")
        d = politics.compose([], NOW, get)
        self.assertEqual(d["elections"]["status"], "ok")
        self.assertEqual(d["elections"]["fetched_at"], NOW)
        self.assertEqual(d["polls"]["status"], "ok")
        self.assertEqual(d["polls"]["source"]["revid"], 77)
        self.assertNotIn("elections", d["failed"])
        self.assertNotIn("polls", d["failed"])

    def test_failure_leaves_empty_sections_with_a_status(self):
        def get(url, timeout=0):
            raise OSError("down")
        d = politics.compose([], NOW, get)
        self.assertEqual((d["elections"]["status"], d["elections"]["upcoming"], d["elections"]["recent"]), ("fail", [], []))
        self.assertEqual((d["polls"]["status"], d["polls"]["series"]), ("fail", []))
        self.assertIn("elections", d["failed"])
        self.assertIn("polls", d["failed"])
        self.assertEqual(d["polls"]["fetched_at"], NOW)


# ----------------------------------------------------------------------------------------------------------------------- critical
RSS = ('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>t</title>'
       '<item><title>試験 調査記事A</title><link>https://example.org/a</link><pubDate>Wed, 04 Nov 2026 09:00:00 +0900</pubDate></item>'
       '<item><title>試験 調査記事B</title><link>https://example.org/b</link><pubDate>Tue, 03 Nov 2026 09:00:00 +0900</pubDate></item>'
       '<item><title></title><link>https://example.org/c</link></item>'
       '<item><title>試験 リンクなし</title><link></link></item></channel></rss>')
NICHIBEN = ('<a href="/document/statement/year/2026/260901_2.html">試験 会長声明 甲</a>'
            '<a href="/document/statement/year/2026/261030.html">試験 会長声明 乙</a>'
            '<a href="/document/statement/year/2026/261030.html">重複</a>'
            '<a href="/document/statement/year/2026/261302.html">日付の読めない物</a>')
AMNESTY = ('<a href="https://www.amnesty.or.jp/news/2026/1028_11138.html">国際事務局発表ニュース 試験 声明 甲 2026年10月28日 国・地域： フランス トピック： 表現の自由</a>'
           '<a href="https://www.amnesty.or.jp/news/2026/1020_11100.html">国内ニュース 試験 声明 乙 2026年10月20日 国・地域： 日本 トピック： x</a>')
SCJ = '<a href="/ja/info/kohyo/20261102_11_01.html"><span>試験 提言</span></a><a href="/ja/info/kohyo/20261102_11_01.html">重複</a>'
JSTAGE = ('<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">'
          '<entry><article_title><ja>試験 論文 甲</ja><en>Test A</en></article_title><article_link><ja>https://example.org/j1</ja></article_link>'
          '<pubyear>2024</pubyear><material_title><ja>試験誌</ja></material_title></entry>'
          '<entry><article_title><en>Test B</en></article_title><article_link><en>https://example.org/j2</en></article_link><pubyear>20x</pubyear></entry>'
          '<entry><article_title><ja></ja></article_title><article_link><ja>https://example.org/j3</ja></article_link></entry></feed>')
SECRET = "試験 発言の本文その一"
KOKKAI = json.dumps({"speechRecord": [
    {"speaker": "会議録情報", "speech": "試験 防衛費 の見出し行", "speechURL": "https://example.org/k0"},
    {"speaker": "試験 議員", "speakerGroup": "試験会派", "speakerPosition": "", "speech": SECRET + " 防衛費 について", "date": "2026-10-22",
     "nameOfHouse": "衆議院", "nameOfMeeting": "予算委員会", "issue": "第1号", "speechURL": "https://example.org/k1"},
    {"speaker": "試験 大臣", "speakerPosition": "試験担当大臣", "speech": "答弁 防衛費 を述べる", "date": "2026-10-22",
     "nameOfHouse": "衆議院", "nameOfMeeting": "予算委員会", "issue": "第1号", "speechURL": "https://example.org/k2"},
    {"speaker": "試験 議員二", "speech": "この発言に語は無い", "date": "2026-10-21", "speechURL": "https://example.org/k3"},
]})


def fake_get(url):
    if "ourplanet" in url or "propublica" in url:
        return RSS
    if "kokkai.ndl.go.jp/api/speech" in url:
        return KOKKAI
    if "jstage" in url:
        return JSTAGE
    if "nichibenren" in url:
        return NICHIBEN
    if "amnesty" in url:
        return AMNESTY
    if "www.scj.go.jp" in url:
        return SCJ
    raise OSError("down")


class Critical(unittest.TestCase):
    def test_parsers(self):
        src = critical._BY_ID["ourplanet"]
        f = critical.parse_feed(src, RSS)
        self.assertEqual([i["title"] for i in f], ["試験 調査記事A", "試験 調査記事B"])         # no title or no link: dropped
        self.assertEqual((f[0]["kind"], f[0]["tag"], f[0]["ts"], f[0]["date"]), ("investigative", "調査", int(dt.datetime(2026, 11, 4, 0, 0, tzinfo=dt.timezone.utc).timestamp()), "2026-11-04"))
        n = critical.parse_nichiben(critical._BY_ID["nichiben"], NICHIBEN)
        self.assertEqual([(i["date"], i["title"]) for i in n], [("2026-10-30", "試験 会長声明 乙"), ("2026-09-01", "試験 会長声明 甲")])
        a = critical.parse_amnesty(critical._BY_ID["amnesty"], AMNESTY)
        self.assertEqual([(i["title"], i["scope"], i["date"]) for i in a], [("試験 声明 甲", "INT", "2026-10-28"), ("試験 声明 乙", "JP", "2026-10-20")])
        s = critical.parse_scj(critical._BY_ID["scj"], SCJ)
        self.assertEqual([(i["title"], i["date"]) for i in s], [("試験 提言", "2026-11-02")])
        j = critical.parse_jstage(critical._BY_ID["jstage"], JSTAGE, theme="th")
        self.assertEqual([(i["title"], i["date"], i["theme"]) for i in j], [("試験 論文 甲", "2024", "th"), ("Test B", "", "th")])      # a year only stays a year
        self.assertIsNone(j[0]["ts"])

    def test_kokkai_sides_and_no_body_text(self):
        its = critical.parse_kokkai(critical._BY_ID["kokkai"], KOKKAI, "防衛費", ("防衛費",))
        self.assertEqual([(i["side"], i["who"]) for i in its], [("member", "試験 議員（試験会派）"), ("gov", "試験 大臣（試験担当大臣）")])
        self.assertEqual(its[0]["title"], "衆議院 予算委員会 第1号")
        self.assertNotIn(SECRET, json.dumps(its, ensure_ascii=False))                           # nothing of the speech is kept
        self.assertNotIn("quote", its[0])

    def test_compose_status_rows_and_floor(self):
        c = critical.compose(NOW, None, fake_get)
        self.assertEqual(c["schema"], "parallax-critical/1")
        self.assertEqual(c["status"], "ok")
        rows = {r["id"]: r for r in c["sources"]}
        self.assertTrue(rows["ourplanet"]["ok"] and rows["kokkai"]["ok"] and rows["jstage"]["ok"])
        self.assertFalse(rows["iwj"]["ok"])
        self.assertIn("OSError", rows["iwj"]["err"])
        self.assertTrue(all(r["terms_status"] == "unknown" for r in c["sources"]))
        self.assertEqual(c["counts"]["sources"], len(critical.SOURCES))
        ids = [i["id"] for i in c["items"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual({i["kind"] for i in c["items"]}, set(critical.KINDS))
        whens = [critical.when(i) for i in c["items"]]
        self.assertEqual(whens, sorted(whens, reverse=True))
        f = c["featured"]
        self.assertEqual(set(f), {"investigative", "diet_question", "diet_answer", "academic", "ngo"})
        by = {i["id"]: i for i in c["items"]}
        self.assertEqual(by[f["diet_question"]]["side"], "member")
        self.assertEqual(by[f["diet_answer"]]["side"], "gov")
        self.assertEqual(by[f["ngo"]]["title"], "試験 会長声明 乙")                                  # the newest of its class
        self.assertEqual([t["theme"] for t in c["themes"]["kokkai"]], [t[0] for t in critical.KOKKAI_THEMES])
        dump = json.dumps(c, ensure_ascii=False)
        self.assertNotIn(SECRET, dump)
        from parallax import build
        for w in build.load_prompt()["silence_words"]["ja"]:
            self.assertNotIn(w, dump)

    def test_nothing_read_is_fail_and_carry_over_is_limited(self):
        def down(url):
            raise OSError("down")
        c = critical.compose(NOW, None, down)
        self.assertEqual((c["status"], c["items"]), ("fail", []))
        item = {"id": "p1", "src": "iwj", "kind": "investigative", "tag": "調査", "source": "x", "title": "試験 前回の見出し",
                "url": "https://example.org/p1", "date": "2026-11-04", "ts": NOW - 3600, "scope": "JP"}
        prev = {"sources": [{"id": "iwj", "fetched_at": NOW - 3 * 3600}], "items": [item]}
        c = critical.compose(NOW, prev, down)
        self.assertEqual([(i["id"], i.get("carried")) for i in c["items"]], [("p1", True)])
        self.assertEqual([r["carried"] for r in c["sources"] if r["id"] == "iwj"], [1])
        old = {"sources": [{"id": "iwj", "fetched_at": NOW - 4 * 86400}], "items": [item]}
        self.assertEqual(critical.compose(NOW, old, down)["items"], [])                         # older than 3 days: not carried
        again = critical.compose(NOW + 3600, c, down)                                           # a carried item does not renew its own age
        self.assertEqual(again["sources"][1]["carried_from"], NOW - 3 * 3600)

    def test_robots_denied_is_not_fetched(self):
        class Deny:
            def check(self, url):
                return False, "denied", 0.0
        c = critical.compose(NOW, None, None, robots=Deny())
        self.assertEqual(c["status"], "fail")
        self.assertTrue(all("robots.txt" in r["err"] for r in c["sources"]))


# ------------------------------------------------------------------------------------------------------------------------ scenes
class Scenes(unittest.TestCase):
    def setUp(self):
        self.s = json.loads(rd("data", "scenes.json"))

    def test_shape(self):
        s = self.s
        self.assertEqual(s["schema"], "parallax-scenes/1")
        ids = [x["id"] for x in s["scenes"]]
        self.assertEqual(sorted(ids), ["calm", "disaster", "election", "live", "world"])
        self.assertEqual(s["rules"]["priority"], ["disaster", "election", "world", "live", "calm"])
        by = {x["id"]: x for x in s["scenes"]}
        order = sorted(ids, key=lambda i: -by[i]["tier"])
        self.assertEqual(order, s["rules"]["priority"])                                        # tier and the stated order agree
        self.assertTrue(s["rules"]["arrangement_only"] and s["rules"]["fold"]["visitor_off_wins"])
        self.assertEqual((s["rules"]["demote_after_min"], s["rules"]["demote_after_min_by_scene"]["disaster"]), (30, 180))
        self.assertEqual(s["rules"]["hold_after_input_s"], 25)

    def test_panes_and_stations_exist(self):
        panes = {"src", "hours", "fields", "pri", "anom", "case", "map", "count", "tv", "haz", "mkt", "pol"}
        stations = set(re.findall(r"id: '([a-z0-9]+)', short:", rd("js", "tv.js")))
        self.assertTrue(stations)
        for sc in self.s["scenes"]:
            self.assertFalse(set(sc["big"]) & set(sc["fold"]), sc["id"])
            self.assertTrue(set(sc["big"]) | set(sc["fold"]) <= panes, sc["id"])
            self.assertNotIn("pri", sc["fold"])
            self.assertNotIn("case", sc["fold"])                                               # the event and the priority list always stay
            v = sc["video"]
            ids = set(v.get("order", [])) | set(v.get("domestic", [])) if isinstance(v.get("domestic"), list) else set(v.get("order", []))
            ids |= set(v.get("abroad", []))
            self.assertTrue(ids <= stations, (sc["id"], ids - stations))

    def test_thresholds(self):
        by = {x["id"]: x for x in self.s["scenes"]}
        el = by["election"]["auto"]["any"][0]
        self.assertEqual((el["window_h"], el["min_headlines"], el["min_outlets"]), (6, 20, 8))
        d = by["disaster"]["auto"]
        self.assertEqual([x["id"] for x in d["switch"]], ["quake_jp", "tsunami", "typhoon_gale_on_pref", "quake_world"])
        self.assertEqual(d["switch"][0]["min"], "5-")
        rank = self.s["quake_scale"]["rank"]
        self.assertGreater(rank["5-"], rank["4"])
        self.assertEqual(by["world"]["auto"]["all"][0]["min"], 8)
        self.assertEqual([x["min"] for x in by["live"]["auto"]["all"][:1]], [5])

    def test_no_headline_no_silence_word_no_verdict(self):
        raw = rd("data", "scenes.json")
        from parallax import build
        prompt = build.load_prompt()
        for w in prompt["silence_words"]["ja"] + prompt["silence_words"]["en"]:
            self.assertNotIn(w, raw)
        for w in ("偏向", "フェイク", "真偽", "左派", "右派", "リベラル"):
            self.assertNotIn(w, raw)
        self.assertNotIn("世論調査", self.s["vocab"]["election"]["ja"])                          # an opinion poll is not an election


if __name__ == "__main__":
    unittest.main()
