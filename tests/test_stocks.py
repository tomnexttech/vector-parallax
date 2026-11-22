import unittest
from parallax import stocks


def _doc(**src):
    bars = [["2026-%02d-%02d" % (1 + i // 28, 1 + i % 28), 100.0 + i] for i in range(70)]
    base = {"name": "A licensed feed", "terms_url": "https://example.com/terms", "terms_read": "2026-11-22", "public_display_allowed": True}
    base.update(src)
    return {"schema": stocks.SCHEMA, "ok": True, "series": [{"symbol": "X", "source": base, "bars": bars}]}


class StocksGate(unittest.TestCase):
    def test_nothing_is_shown_until_a_source_is_licensed(self):
        self.assertTrue(stocks.validate(stocks.empty_doc("no licensed source")))

    def test_a_licensed_file_passes(self):
        self.assertEqual(stocks.validate(_doc()), [])

    def test_display_must_be_recorded_as_allowed(self):
        self.assertTrue(stocks.validate(_doc(public_display_allowed=False)))
        self.assertTrue(stocks.validate(_doc(public_display_allowed="yes")))

    def test_terms_page_and_read_date_are_required(self):
        self.assertTrue(stocks.validate(_doc(terms_url="")))
        self.assertTrue(stocks.validate(_doc(terms_read="")))

    def test_bars_must_rise_in_date_and_be_positive(self):
        d = _doc()
        d["series"][0]["bars"][5] = ["2026-01-01", 1.0]
        self.assertTrue(stocks.validate(d))
        d = _doc()
        d["series"][0]["bars"][9][1] = 0
        self.assertTrue(stocks.validate(d))


if __name__ == "__main__":
    unittest.main()
