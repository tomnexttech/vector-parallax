# -*- coding: utf-8 -*-
"""CONTRACT 21: the page of one event (D), the feeds (E) and the seven-day archive (F). Synthetic data only; the network is never used
(the archive is read back through a fetch that reads the folder of the previous run)."""
import importlib.util
import json
import tempfile
import unittest
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path

from helpers import ROOT  # puts the repo root on sys.path
from parallax import site
from tools import assemble_site

_spec = importlib.util.spec_from_file_location("leakcheck_for_site", ROOT / "tools" / "leakcheck.py")
LC = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(LC)
PAT = LC.fixed_patterns()                # the fixed words are read at run time, never written in a test (tests/test_namegate.py)

BASE = "https://example.test/p/"
T0 = 1794081239                       # 2026-11-08 04:53 JST
DAY = 86400
ATOM = "{http://www.w3.org/2005/Atom}"


def item(i, outlet, typ, home, ts, title, src=None, desc=None, image=None):
    d = {"id": i, "title": title, "link": "https://news.example/%s" % i, "outlet": outlet, "source_id": src or outlet.lower(), "type": typ,
         "home": home, "lang": "en" if home == "intl" else "ja", "ts": ts, "image": image}
    if desc:
        d["desc"] = desc
    return d


def dataset(now=T0, extra_a=()):
    """sA: Japan 2 and abroad 1 (abroad 87 minutes first); sB: abroad only, 2 outlets; sC: the ministries only, 1 place"""
    its = [item("a1", "BBC", "海外公共", "intl", now - 9000, "Talks <resume> & go on", desc="The first paragraph the feed carried."),
           item("a2", "NHK", "公共放送", "jp", now - 9000 + 87 * 60, "協議が再開　政府は「前進」"),
           item("a3", "朝日新聞", "全国紙", "jp", now - 3000, "協議再開、来週にも合意へ"),
           item("b1", "Reuters", "海外主流", "intl", now - 5000, "Port strike widens"),
           item("b2", "AP", "海外主流", "intl", now - 4000, "Port strike spreads to two more cities"),
           item("c1", "財務省", "政府一次", "jp", now - 2000, "国債の入札結果")]
    its += list(extra_a)
    items = {x["id"]: x for x in its}
    a_ids = ["a1", "a2", "a3"] + [x["id"] for x in extra_a]
    sid_a = "s" + ("%012x" % (0xa0 + len(extra_a)))
    stories = [{"sid": sid_a, "member_ids": a_ids}, {"sid": "s0000000000b0", "member_ids": ["b1", "b2"]}, {"sid": "s0000000000c0", "member_ids": ["c1"]}]
    latest = {"schema": "parallax/1", "generated_at": now, "items": items, "stories": stories}
    board = {"generated_at": now, "priority": [sid_a, "s0000000000b0"],
             "cases": {sid_a: {"sid": sid_a, "rep_id": "a2", "cat": "国際", "score": 2.0,
                               "photo": {"id": "a2", "url": "https://img.example/a2.jpg", "outlet": "NHK", "type": "公共放送", "from": "rss"}},
                       "s0000000000b0": {"sid": "s0000000000b0", "rep_id": "b2", "cat": "経済", "score": 1.0, "photo": None},
                       "s0000000000c0": {"sid": "s0000000000c0", "rep_id": "c1", "cat": "経済", "score": 0.5}}}
    return latest, board, sid_a


def folder_fetch(folder):
    """the public URL of the last deploy, read from its folder"""
    def fetch(url):
        p = Path(folder) / url[len(BASE):]
        if not p.is_file():
            raise OSError("404")
        return json.loads(p.read_text(encoding="utf-8"))
    return fetch


def fail_fetch(url):
    raise OSError("unreachable")


class _Strict(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta, self.links, self.hrefs, self.stack = {}, {}, [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            self.meta[a.get("property") or a.get("name")] = a.get("content")
        if tag == "link":
            self.links[a.get("rel")] = a.get("href")
        if tag == "a":
            self.hrefs.append(a.get("href"))


def parse(page):
    p = _Strict()
    p.feed(page)
    return p


class Events(unittest.TestCase):
    def test_counts_line_names_the_first_side_and_the_gap(self):
        latest, board, sid = dataset()
        evs = site.events(latest, board)
        self.assertEqual(site.counts_line(evs[sid]), "国内 2・海外 1・最初に報じたのは海外 1時間27分先")
        self.assertTrue(site.counts_line(evs["s0000000000b0"]).startswith("海外 2・最初の報道 "))
        self.assertEqual(evs[sid]["title"], "協議が再開　政府は「前進」")            # the representative headline as published
        self.assertEqual(evs[sid]["outlet"], "NHK")

    def test_the_lead_carries_the_folded_stories(self):
        latest, board, sid = dataset()
        board["cases"][sid]["event"] = {"key": "k", "n_stories": 2, "sids": [sid, "s0000000000c0"]}
        ev = site.events(latest, board)[sid]
        self.assertEqual(ev["sides"], {"jp": 2, "intl": 1, "gov": 1})

    def test_lists(self):
        latest, board, sid = dataset()
        evs = site.events(latest, board)
        self.assertEqual([e["sid"] for e in site.big_news(evs, board)], [sid])      # sB: one side and two outlets: not big news
        self.assertEqual([(s, e["sid"]) for s, e in site.one_side(evs)], [("intl", "s0000000000b0")])   # sC: one place is not enough
        f = site.by_field(evs)
        self.assertEqual([e["sid"] for e in f["経済"]], ["s0000000000b0", "s0000000000c0"])

    def test_gap_text(self):
        self.assertEqual(site.gap_text(87 * 60), "1時間27分")
        self.assertEqual(site.gap_text(5 * 60), "5分")
        self.assertEqual(site.gap_text(DAY + 3 * 3600), "1日3時間")


class Page(unittest.TestCase):
    def setUp(self):
        self.latest, self.board, self.sid = dataset()
        self.evs = site.events(self.latest, self.board)

    def test_ogp_twitter_canonical_and_the_way_in(self):
        page = site.story_page(self.evs[self.sid], BASE, T0)
        p = parse(page)
        url = BASE + "s/%s.html" % self.sid
        self.assertEqual(p.links["canonical"], url)
        self.assertEqual(p.meta["og:url"], url)
        self.assertEqual(p.meta["og:title"], "協議が再開　政府は「前進」")
        self.assertEqual(p.meta["og:description"], "国内 2・海外 1・最初に報じたのは海外 1時間27分先")
        self.assertEqual(p.meta["og:image"], "https://img.example/a2.jpg")
        self.assertEqual(p.meta["twitter:card"], "summary_large_image")
        for k in ("og:type", "og:site_name", "twitter:title", "twitter:description", "twitter:image", "description"):
            self.assertTrue(p.meta.get(k), k)
        self.assertTrue(any(h.startswith("../?sid=%s" % self.sid) for h in p.hrefs))

    def test_headlines_without_js_quoted_and_escaped(self):
        page = site.story_page(self.evs[self.sid], BASE, T0)
        self.assertIn("Talks &lt;resume&gt; &amp; go on", page)
        self.assertNotIn("<resume>", page)
        self.assertIn("https://news.example/a1", page)
        self.assertIn("<q>The first paragraph the feed carried.</q>", page)
        self.assertIn("国内の報道 2 件", page)
        self.assertNotIn("<script", page)

    def test_a_side_without_reports_is_not_named(self):
        page = site.story_page(self.evs["s0000000000b0"], BASE, T0)
        self.assertNotIn("国内の報道", page)
        self.assertNotIn("官公庁の資料", page)
        self.assertNotRegex(page, "報じなかった|報じていない|偏向|フェイク|誤報|右派|左派")
        self.assertEqual(parse(page).meta["twitter:card"], "summary")


class Feeds(unittest.TestCase):
    def test_rss_is_well_formed_and_carries_what_the_contract_says(self):
        latest, board, sid = dataset()
        evs = site.events(latest, board)
        doc = site.rss("feed.xml", "今日の大きなニュース", "d", [(e, "") for e in site.big_news(evs, board)], BASE, T0)
        root = ET.fromstring(doc.encode("utf-8"))
        self.assertEqual(root.tag, "rss")
        self.assertEqual(root.get("version"), "2.0")
        ch = root.find("channel")
        for k in ("title", "link", "description", "language", "lastBuildDate"):
            self.assertTrue(ch.findtext(k), k)
        self.assertEqual(ch.find(ATOM + "link").get("href"), BASE + "feed.xml")
        its = ch.findall("item")
        self.assertEqual(len(its), 1)
        it = its[0]
        self.assertEqual(it.findtext("title"), "協議が再開　政府は「前進」")
        self.assertEqual(it.findtext("link"), BASE + "s/%s.html" % sid)
        self.assertEqual(it.findtext("description"), "国内 2・海外 1・最初に報じたのは海外 1時間27分先")
        self.assertEqual(it.findtext("guid"), "parallax:a1")
        parsedate_to_datetime(it.findtext("pubDate"))
        parsedate_to_datetime(ch.findtext("lastBuildDate"))

    def test_write_site_writes_every_feed_well_formed(self):
        latest, board, sid = dataset()
        with tempfile.TemporaryDirectory() as d:
            r = site.write_site(d, latest, board, BASE, fail_fetch)
            names = sorted(p.name for p in Path(d).glob("feed*.xml"))
            self.assertEqual(len(names), 2 + len(site.FIELDS))
            for n in names:
                ET.fromstring((Path(d) / n).read_bytes())
            one = ET.fromstring((Path(d) / "feed-oneside.xml").read_bytes())
            self.assertEqual([i.findtext("link") for i in one.iter("item")], [BASE + "s/s0000000000b0.html"])
            self.assertTrue(one.find("channel/item/description").text.startswith("海外の報道だけ・海外 2"))
            for p in Path(d).rglob("*"):
                if p.is_file():
                    self.assertEqual(LC.scan_text(p.read_text(encoding="utf-8"), PAT), [], p.name)
            self.assertEqual(r["pages_now"], 3)


class Archive(unittest.TestCase):
    def run_site(self, folder, latest, board, fetch):
        return site.write_site(folder, latest, board, BASE, fetch)

    def test_first_run_or_unreadable_previous_keeps_today_only(self):
        latest, board, sid = dataset()
        for fetch in (fail_fetch, lambda u: {"schema": "other"}, lambda u: ["not", "a", "dict"]):
            with tempfile.TemporaryDirectory() as d:
                r = self.run_site(d, latest, board, fetch)
                idx = json.loads((Path(d) / "data/archive/index.json").read_text(encoding="utf-8"))
                self.assertEqual([x["date"] for x in idx["days"]], ["2026-11-08"])
                day = json.loads((Path(d) / "data/archive/2026-11-08.json").read_text(encoding="utf-8"))
                self.assertEqual(day["top"], [sid])
                e = next(x for x in day["events"] if x["sid"] == sid)
                for k in ("title", "n_items", "sides", "first", "first_ts", "sid"):
                    self.assertIn(k, e)
                self.assertNotIn("desc", json.dumps(day))                      # the archive keeps no description
                self.assertTrue(r["archive_note"])

    def test_the_next_day_carries_the_previous_and_keeps_its_pages(self):
        latest, board, sid = dataset()
        with tempfile.TemporaryDirectory() as d1, tempfile.TemporaryDirectory() as d2:
            self.run_site(d1, latest, board, fail_fetch)
            l2, b2, _ = dataset(now=T0 + DAY)
            for s in l2["stories"]:                                           # other events the next day
                s["sid"] = "s1" + s["sid"][2:]
            b2["priority"] = ["s1" + x[2:] for x in b2["priority"]]
            b2["cases"] = {"s1" + k[2:]: dict(v, sid="s1" + k[2:]) for k, v in b2["cases"].items()}
            for it in l2["items"].values():
                it["id"] = "n" + it["id"]
            l2["items"] = {v["id"]: v for v in l2["items"].values()}
            for s in l2["stories"]:
                s["member_ids"] = ["n" + i for i in s["member_ids"]]
            for c in b2["cases"].values():
                c["rep_id"] = "n" + c["rep_id"]
            r = self.run_site(d2, l2, b2, folder_fetch(d1))
            idx = json.loads((Path(d2) / "data/archive/index.json").read_text(encoding="utf-8"))
            self.assertEqual([x["date"] for x in idx["days"]], ["2026-11-09", "2026-11-08"])
            self.assertEqual(r["archive_from_previous"], ["2026-11-08"])
            old = (Path(d2) / "s" / ("%s.html" % sid)).read_text(encoding="utf-8")
            self.assertIn("11月8日 時点の控え", old)
            self.assertIn("協議が再開", old)
            self.assertEqual(r["pages_kept"], 3)

    def test_a_sid_that_changed_the_same_day_is_one_event_and_its_old_page_points_on(self):
        latest, board, sid = dataset()
        with tempfile.TemporaryDirectory() as d1, tempfile.TemporaryDirectory() as d2:
            self.run_site(d1, latest, board, fail_fetch)
            l2, b2, sid2 = dataset(now=T0 + 3 * 3600, extra_a=[item("a4", "読売新聞", "全国紙", "jp", T0 + 3000, "協議再開で合意")])
            self.assertNotEqual(sid, sid2)
            self.run_site(d2, l2, b2, folder_fetch(d1))
            day = json.loads((Path(d2) / "data/archive/2026-11-08.json").read_text(encoding="utf-8"))
            self.assertEqual(day["top"], [sid2])                                   # one event, not two
            self.assertEqual(day["alias"], {sid: sid2})
            p = parse((Path(d2) / "s" / ("%s.html" % sid)).read_text(encoding="utf-8"))
            self.assertEqual(p.links["canonical"], BASE + "s/%s.html" % sid2)

    def test_seven_days_only_and_withheld_is_applied_to_the_carried_days(self):
        latest, board, sid = dataset()
        with tempfile.TemporaryDirectory() as d1, tempfile.TemporaryDirectory() as d2:
            self.run_site(d1, latest, board, fail_fetch)
            prev, why = site.read_previous(BASE, folder_fetch(d1))
            self.assertEqual(why, "")
            docs = site.merge_archive(prev, [], "2026-11-14", T0 + 6 * DAY, {"items": ["a2"], "sources": [], "photos": {"items": [], "sources": []}})
            e = next(x for x in docs["2026-11-08"]["events"] if x["sid"] == sid)
            self.assertNotIn("a2", [h["id"] for h in e["heads"]])
            self.assertEqual(e["sides"]["jp"], 1)
            self.assertNotEqual(e["title"], "協議が再開　政府は「前進」")             # the withheld headline is not the title any more
            self.assertIsNone(e["photo"])
            docs = site.merge_archive(prev, [], "2026-11-15", T0 + 7 * DAY)
            self.assertNotIn("2026-11-08", docs)                                    # the eighth day is gone

    def test_a_carried_entry_is_data_not_markup(self):
        bad = {"sid": "s0000000000ff", "title": "<script>x</script>", "heads": [{"side": "jp", "id": "z", "title": "<b>t</b>", "link": "javascript:alert(1)", "ts": T0}]}
        e = site._clean_entry(bad)
        page = site.story_page(e, BASE, None, kept_from="11月8日")
        self.assertNotIn("<script>x", page)
        self.assertNotIn("javascript:", page)
        self.assertIsNone(site._clean_entry({"sid": "../../etc", "heads": bad["heads"]}))


class Assemble(unittest.TestCase):
    def test_assemble_makes_pages_and_never_fails_on_them(self):
        latest, board, sid = dataset()
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as out:
            (Path(root) / "data").mkdir()
            (Path(root) / "index.html").write_text("<!doctype html>", encoding="utf-8")
            (Path(root) / "data/latest.json").write_text(json.dumps(latest), encoding="utf-8")
            (Path(root) / "data/board.json").write_text(json.dumps(board), encoding="utf-8")
            o = str(Path(out) / "_site")
            self.assertEqual(assemble_site.main(["--root", root, "--out", o, "--base-url", BASE, "--no-archive-fetch"]), 0)
            self.assertTrue((Path(o) / "s" / ("%s.html" % sid)).is_file())
            self.assertTrue((Path(o) / "feed.xml").is_file())
            self.assertTrue((Path(o) / "data/archive/index.json").is_file())
            (Path(root) / "data/board.json").write_text("{broken", encoding="utf-8")
            self.assertEqual(assemble_site.main(["--root", root, "--out", o, "--no-archive-fetch"]), 0)
            self.assertFalse((Path(o) / "feed.xml").exists())


if __name__ == "__main__":
    unittest.main()
