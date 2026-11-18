import unittest
from parallax import read, sources


class FakeReader:
    def __init__(self, bad): self.bad = bad
    def gate(self, it): return (None, "relay", "") if it["outlet"] in self.bad else ("u", "", "")


class PickTest(unittest.TestCase):
    def test_events_with_two_readable_outlets_come_first(self):
        items = {k: {"id": k, "outlet": o, "ts": i} for i, (k, o) in enumerate([("a", "X"), ("b", "Y"), ("c", "G"), ("d", "H"), ("e", "I")])}
        latest = {"items": items, "stories": [
            {"sid": "s1", "n_outlets": 2, "member_ids": ["a", "b"]},
            {"sid": "s2", "n_outlets": 3, "member_ids": ["c", "d", "e"]}]}
        hero = {"picks": [{"sid": "s1"}]}
        got = read.pick_events(latest, hero, n=1, reader=FakeReader({"X"}))
        self.assertEqual([s["sid"] for s in got], ["s2"])
        got = read.pick_events(latest, hero, n=2, reader=FakeReader({"X"}))
        self.assertEqual([s["sid"] for s in got], ["s2", "s1"])      # the unreadable one still fills the rest, so its reasons show

    def test_path_only_feed_link_is_made_absolute(self):
        self.assertEqual(sources._abs_link("/j/press/news/2026/11/17a.html", sources.by_id("mod")), "https://www.mod.go.jp/j/press/news/2026/11/17a.html")
        self.assertEqual(sources._abs_link("https://x.test/a", sources.by_id("mod")), "https://x.test/a")


if __name__ == "__main__":
    unittest.main()
