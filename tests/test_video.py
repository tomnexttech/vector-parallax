# -*- coding: utf-8 -*-
"""video — the broadcasters' own videos matched to the events (CONTRACT §18.14). No network: `get` is replaced."""
import datetime
import unittest

import helpers  # noqa: F401  (puts the repo on sys.path)
from parallax import build, video

NOW = 1762300000
H = 3600


def feed(rows):
    """A channel feed in the shape YouTube serves: rows of (video id, title, epoch seconds)."""
    out = ['<?xml version="1.0" encoding="UTF-8"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" '
           'xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom"><title>ch</title>']
    for vid, title, ts in rows:
        when = datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).isoformat()
        out.append("<entry><id>yt:video:%s</id><yt:videoId>%s</yt:videoId><title>%s</title><published>%s</published>"
                   "<media:group><media:title>%s</media:title></media:group></entry>" % (vid, vid, title, when, title))
    return "".join(out) + "</feed>"


ST = {"id": "aje", "short": "AJ", "name": "Al Jazeera English", "ch": "UCNye-wNBqNL5ZzHSJj3l8Bg", "mode": "live"}
JA = {"id": "ann", "short": "ANN", "name": "ANNnewsCH", "ch": "UCGCZAYq5Xxojl_tSXcVJhiQ", "mode": "uploads"}
WONG = "Hong Kong activist Joshua Wong sentenced to ten years in jail"
AKIMOTO = "秋本元議員に懲役６年求刑 無罪主張、洋上風力汚職事件―東京地裁"
AKIMOTO_V = "元衆院議員の秋本真利被告に懲役6年求刑 洋上風力発電事業巡る汚職事件"


def story(sid, ids, first=NOW - 2 * H, last=NOW - H, ai=None):
    return {"sid": sid, "member_ids": ids, "first_ts": first, "last_ts": last, "ai": ai}


def items(*rows):
    return [{"id": i, "title": t} for i, t in rows]


def vid(id_, title, ts=NOW - H, st="aje"):
    return {"id": id_, "title": title, "ts": ts, "station": st}


class ParseFeed(unittest.TestCase):
    def test_rows_newest_first_and_bad_rows_dropped(self):
        xml = feed([("aaaaaaaaaaa", "older", NOW - 5 * H), ("bbbbbbbbbbb", "newer", NOW - H),
                    ("short", "bad id", NOW), ("ccccccccccc", "   ", NOW), ("ddddddddddd", "  spaced \n title ", NOW - 2 * H)])
        got = video.parse_feed(xml, ST)
        self.assertEqual([v["id"] for v in got], ["bbbbbbbbbbb", "ddddddddddd", "aaaaaaaaaaa"])
        self.assertEqual(got[1]["title"], "spaced title")
        self.assertEqual(got[0], {"id": "bbbbbbbbbbb", "title": "newer", "ts": NOW - H, "station": "aje"})

    def test_broken_or_empty_feed_is_empty(self):
        for bad in ("", "<feed", "not xml at all", None, "<html><body>404</body></html>"):
            self.assertEqual(video.parse_feed(bad, ST), [])

    def test_the_title_is_cut(self):
        got = video.parse_feed(feed([("aaaaaaaaaaa", "x" * 400, NOW)]), ST)
        self.assertEqual(len(got[0]["title"]), video.TITLE_MAX)


class Table(unittest.TestCase):
    def test_stations_come_from_the_table_of_the_page(self):
        sts = video.stations()
        self.assertEqual(len(sts), 11)
        self.assertEqual(len({s["id"] for s in sts}), 11)
        for s in sts:
            self.assertTrue(s["ch"].startswith("UC") and len(s["ch"]) == 24, s)
            self.assertIn(s["mode"], ("live", "uploads"))
        self.assertEqual(next(s for s in sts if s["id"] == "aje")["ch"], "UCNye-wNBqNL5ZzHSJj3l8Bg")


class Match(unittest.TestCase):
    def test_a_video_of_the_event_fits_and_an_unrelated_one_does_not(self):
        its = items(("i1", WONG), ("i2", AKIMOTO))
        vs = [vid("aaaaaaaaaaa", WONG + " | AJ Show"), vid("bbbbbbbbbbb", "Cristiano Ronaldo retires from international football"),
              vid("ccccccccccc", AKIMOTO_V, st="ann")]
        got = video.match([story("s1", ["i1"]), story("s2", ["i2"])], its, vs, NOW, {"aje": "Al Jazeera English", "ann": "ANNnewsCH"})
        self.assertEqual([v["id"] for v in got["s1"]], ["aaaaaaaaaaa"])
        self.assertEqual([v["id"] for v in got["s2"]], ["ccccccccccc"])

    def test_an_event_with_no_title_is_matched_by_its_ai_headline(self):
        its = [{"id": "i1", "title": None}]
        s = story("s1", ["i1"], ai={"headline_ja": "", "headline_en": WONG})
        self.assertIn("s1", video.match([s], its, [vid("aaaaaaaaaaa", WONG)], NOW))
        self.assertEqual(video.match([story("s1", ["i1"])], its, [vid("aaaaaaaaaaa", WONG)], NOW), {})

    def test_empty_title_and_no_videos(self):
        its = items(("i1", WONG))
        self.assertEqual(video.match([story("s1", ["i1"])], its, [vid("aaaaaaaaaaa", "")], NOW), {})
        self.assertEqual(video.match([story("s1", ["i1"])], its, [], NOW), {})
        self.assertEqual(video.match([story("s1", ["i1"])], [], [vid("aaaaaaaaaaa", WONG)], NOW), {})
        self.assertEqual(video.match([], its, [vid("aaaaaaaaaaa", WONG)], NOW), {})

    def test_the_time_of_the_video_must_be_near_the_event(self):
        its = items(("i1", WONG))
        old = vid("aaaaaaaaaaa", WONG, ts=NOW - 10 * 24 * H)
        future = vid("bbbbbbbbbbb", WONG, ts=NOW + 5 * H)
        self.assertEqual(video.match([story("s1", ["i1"])], its, [old, future], NOW), {})

    def test_a_conflict_of_dates_vetoes(self):
        its = items(("i1", "首相、臨時国会を10月5日に召集へ 補正予算案を提出"))
        same = [vid("aaaaaaaaaaa", "首相、臨時国会を10月5日に召集へ 補正予算案を提出")]
        other = [vid("bbbbbbbbbbb", "首相、臨時国会を10月8日に召集へ 補正予算案を提出")]
        self.assertIn("s1", video.match([story("s1", ["i1"])], its, same, NOW))
        self.assertEqual(video.match([story("s1", ["i1"])], its, other, NOW), {})

    def test_at_most_three_newest_first(self):
        its = items(("i1", WONG))
        vs = [vid("%011d" % n, WONG, ts=NOW - n * 600) for n in range(1, 7)]
        got = video.match([story("s1", ["i1"])], its, vs, NOW)["s1"]
        self.assertEqual([v["id"] for v in got], ["%011d" % n for n in (1, 2, 3)])


def get_for(rows_by_ch, fail=()):
    def get(url):
        ch = url.split("channel_id=")[1]
        if ch in fail:
            raise OSError("down")
        return feed(rows_by_ch.get(ch, []))
    return get


class Attach(unittest.TestCase):
    def data(self):
        return {"stories": [story("s1", ["i1"]), story("s2", ["i2"])]}

    def test_videos_land_in_the_matching_event_only(self):
        d = self.data()
        its = items(("i1", WONG), ("i2", AKIMOTO))
        get = get_for({ST["ch"]: [("aaaaaaaaaaa", WONG, NOW - H)], JA["ch"]: [("bbbbbbbbbbb", "【速報】全く別の話題 台風が接近", NOW - H)]})
        rep = video.attach(d, its, NOW, get=get, sts=[ST, JA])
        self.assertEqual(d["stories"][0]["videos"], [{"id": "aaaaaaaaaaa", "title": WONG, "ts": NOW - H, "station": "aje"}])
        self.assertNotIn("videos", d["stories"][1])
        self.assertEqual((rep["ok"], rep["failed"], rep["events"], rep["videos"]), (2, [], 1, 1))

    def test_a_channel_that_fails_is_skipped_and_all_failing_gives_none(self):
        d = self.data()
        its = items(("i1", WONG), ("i2", AKIMOTO))
        rep = video.attach(d, its, NOW, get=get_for({ST["ch"]: [("aaaaaaaaaaa", WONG, NOW - H)]}, fail={JA["ch"]}), sts=[ST, JA])
        self.assertEqual(rep["failed"], ["ann"])
        self.assertEqual(rep["events"], 1)
        d2 = self.data()
        rep2 = video.attach(d2, its, NOW, get=get_for({}, fail={ST["ch"], JA["ch"]}), sts=[ST, JA])
        self.assertEqual((rep2["ok"], rep2["fetched"], rep2["events"]), (0, 0, 0))
        self.assertTrue(all("videos" not in s for s in d2["stories"]))

    def test_a_blocked_title_or_station_is_dropped(self):
        its = items(("i1", WONG))
        get = get_for({ST["ch"]: [("aaaaaaaaaaa", WONG, NOW - H)], JA["ch"]: [("bbbbbbbbbbb", WONG, NOW - H)]})
        d = self.data()
        video.attach(d, its, NOW, get=get, blocked=lambda t: "Al Jazeera" in t, sts=[ST, JA])
        self.assertEqual([v["station"] for v in d["stories"][0]["videos"]], ["ann"])
        d = self.data()
        video.attach(d, its, NOW, get=get, blocked=lambda t: t == WONG, sts=[ST, JA])
        self.assertNotIn("videos", d["stories"][0])

    def test_a_second_run_replaces_the_first(self):
        d = self.data()
        d["stories"][0]["videos"] = [{"id": "zzzzzzzzzzz", "title": "old", "ts": 1, "station": "aje"}]
        video.attach(d, items(("i1", WONG)), NOW, get=get_for({}), sts=[ST])
        self.assertNotIn("videos", d["stories"][0])


class InBuild(unittest.TestCase):
    def test_build_never_stops_when_the_read_fails(self):
        d = {"stories": [story("s1", ["i1"])]}
        d["stories"][0]["videos"] = [{"id": "zzzzzzzzzzz", "title": "x", "ts": 1, "station": "aje"}]

        def boom(url):
            raise RuntimeError("down")
        rep = build.attach_videos(d, items(("i1", WONG)), NOW, get=boom)
        self.assertEqual(rep["ok"], 0)                     # every channel failed; the build goes on with no videos
        self.assertNotIn("videos", d["stories"][0])

    def test_the_name_gate_is_applied(self):
        d = {"stories": [story("s1", ["i1"])]}
        get = lambda url: feed([("aaaaaaaaaaa", WONG + " " + "Mar" + "vel", NOW - H)])  # noqa: E731
        rep = build.attach_videos(d, items(("i1", WONG)), NOW, get=get)
        self.assertIsNotNone(rep)
        self.assertNotIn("videos", d["stories"][0])


if __name__ == "__main__":
    unittest.main()
