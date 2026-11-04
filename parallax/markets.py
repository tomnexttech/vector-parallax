# -*- coding: utf-8 -*-
"""markets - public market data and what daily bars say about them (CONTRACT 18.8). Stdlib only.

Sources: only official or public-domain publishers that state what may be shown, no key, no unofficial API:
  jgb   Ministry of Finance (Japan) - JGB yields, CSV (cp932, Japanese era dates)           mof.go.jp/jgbs/reference/interest_rate
  ust   U.S. Treasury - daily par yield curve, CSV                                          home.treasury.gov
  fx    European Central Bank - euro foreign exchange reference rates (SDMX csvdata); USD/JPY, EUR/JPY, CNY/JPY are crosses
  oil   U.S. Energy Information Administration spot prices (WTI, Brent) as published by FRED  fred.stlouisfed.org (public domain series)
Not included: stock indices and anything from Yahoo (no official terms that allow display). A source that cannot be read is
a row with ok False and the reason - never a filled-in value.

The numbers are the usual daily-bar descriptions (change over 1 day / 5 days / 1 month / 3 months, 5/20/60-day averages, RSI(14) by
Wilder, position in the 3-month range, crossings, streak, realised volatility). The trend word follows a stated rule (TREND_RULE).
"A display of material for judgement. It is not a recommendation to buy or sell."
"""
import calendar
import csv
import datetime as dt
import io
import math
import time
import urllib.request

try:
    from parallax import feeds as _feeds
except ImportError:                                       # run from inside parallax/
    import feeds as _feeds  # type: ignore

SCHEMA = "parallax-markets/1"
UA = _feeds.UA
NOTE_JA = "判断材料の表示であり、売買の推奨ではありません"
NOTE_EN = "Material for your own judgement. This is not a recommendation to buy or sell."
SPARK_N = 30
HIST_N = 200
DAY = 86400
TREND_RULE = ("上昇基調=終値>20日線>60日線 かつ 20日線が5日前より上／"
              "下降基調=終値<20日線<60日線 かつ 20日線が5日前より下／それ以外=横ばい")
JGB_URL = "https://www.mof.go.jp/jgbs/reference/interest_rate/jgbcm.csv"
JGB_ALL_URL = "https://www.mof.go.jp/jgbs/reference/interest_rate/data/jgbcm_all.csv"
JGB_TENORS = ("2年", "5年", "10年", "20年", "30年")
UST_URL = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{y}/all"
           "?type=daily_treasury_yield_curve&field_tdr_date_value={y}&page&_format=csv")
ECB_URL = "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+JPY+CNY.EUR.SP00.A?startPeriod={start}&format=csvdata"
FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={id}"

SRC = {
    "jgb": {"name": "Ministry of Finance (Japan)", "url": "https://www.mof.go.jp/jgbs/reference/interest_rate/index.htm",
            "terms": "https://www.mof.go.jp/about_mof/rss/index.html"},
    "ust": {"name": "U.S. Department of the Treasury", "url": "https://home.treasury.gov/resource-center/data-chart-center/interest-rates",
            "terms": "https://home.treasury.gov/utility/privacy"},
    "ecb": {"name": "European Central Bank", "url": "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html",
            "terms": "https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html"},
    "eia": {"name": "U.S. Energy Information Administration via FRED", "url": "https://fred.stlouisfed.org/series/DCOILWTICO",
            "terms": "https://www.eia.gov/about/copyrights_reuse.php"},
}


# ── computation (no network) ─────────────────────────────────────────────

def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x == x and not math.isinf(x)


def _r(x, nd=2):
    return round(float(x), nd) if _num(x) else None


def pct(a, b):
    return None if not (_num(a) and _num(b)) or b == 0 else (a - b) / abs(b) * 100.0


def sma(xs, n):
    out = [None] * len(xs)
    for i in range(n - 1, len(xs)):
        out[i] = sum(xs[i - n + 1:i + 1]) / n
    return out


def rsi_wilder(closes, n=14):
    if len(closes) < n + 1:
        return None
    d = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    g = [x if x > 0 else 0.0 for x in d]
    l = [-x if x < 0 else 0.0 for x in d]
    ag, al = sum(g[:n]) / n, sum(l[:n]) / n
    for i in range(n, len(d)):
        ag = (ag * (n - 1) + g[i]) / n
        al = (al * (n - 1) + l[i]) / n
    if al == 0:
        return 100.0 if ag > 0 else None
    return 100.0 - 100.0 / (1.0 + ag / al)


def _stdev(xs, ddof=1):
    n = len(xs)
    if n - ddof <= 0:
        return None
    m = sum(xs) / n
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (n - ddof))


def _logret(c):
    return [math.log(c[i] / c[i - 1]) for i in range(1, len(c)) if c[i] > 0 and c[i - 1] > 0]


def _crosses(a, b, lookback=10):
    n, last, ev = len(a), None, []
    for i in range(n):
        if a[i] is None or b[i] is None:
            continue
        s = (a[i] > b[i]) - (a[i] < b[i])
        if s == 0:
            continue
        if last is not None and s != last:
            ev.append({"ago": n - 1 - i, "dir": "up" if s > 0 else "down"})
        last = s
    return [e for e in ev if e["ago"] < lookback]


def _streak(c):
    k = 0
    for i in range(len(c) - 1, 0, -1):
        s = (c[i] > c[i - 1]) - (c[i] < c[i - 1])
        if s == 0 or (k and (k > 0) != (s > 0)):
            break
        k += s
    return k


def _ref_index(ts, days):
    target, idx = ts[-1] - days * DAY, None
    for i, t in enumerate(ts):
        if t <= target:
            idx = i
        else:
            break
    return idx


def analyze(ts, closes, yield_like=False):
    """Daily bars (epoch, value; ascending) -> indicators, or {"ok": False, "err"}. No value is made up: what the bars cannot
    support (a 60-day average needs 60 bars) is None."""
    n = len(closes)
    if len(ts) != n or n < 2:
        return {"ok": False, "bars": n, "err": "need at least 2 daily bars"}
    last = closes[-1]
    a = {"ok": True, "bars": n, "last": _r(last, 6), "span_days": int((ts[-1] - ts[0]) / DAY)}
    refs = {"d1": n - 2, "d5": n - 6 if n >= 6 else None, "m1": _ref_index(ts, 30), "m3": _ref_index(ts, 91)}
    a["chg"] = {k: _r(pct(last, closes[i])) if i is not None else None for k, i in refs.items()}
    if yield_like:
        a["chg_bp"] = {k: _r((last - closes[i]) * 100, 1) if i is not None else None for k, i in refs.items()}
    s5, s20, s60 = sma(closes, 5), sma(closes, 20), sma(closes, 60)
    slope20 = pct(s20[-1], s20[-6]) if n >= 25 and s20[-6] is not None else None
    a["sma"] = {"s5": _r(s5[-1], 6), "s20": _r(s20[-1], 6), "s60": _r(s60[-1], 6),
                "d20": _r(pct(last, s20[-1])), "d60": _r(pct(last, s60[-1])), "slope20": _r(slope20, 3)}
    a["rsi"] = _r(rsi_wilder(closes), 1)
    lr = _logret(closes[-21:]) if n >= 21 else []
    a["vol20"] = _r(_stdev(lr) * math.sqrt(252.0) * 100.0, 1) if len(lr) >= 20 and _stdev(lr) is not None else None
    a["z1"] = None
    if n >= 22 and closes[-1] > 0 and closes[-2] > 0:
        prev = _logret(closes[-22:-1])
        sd = _stdev(prev) if len(prev) >= 20 else None
        if sd:
            a["z1"] = _r(math.log(closes[-1] / closes[-2]) / sd, 2)
    a["bb_z"] = None
    if n >= 20 and s20[-1] is not None:
        sd = _stdev(closes[-20:], ddof=0)
        if sd:
            a["bb_z"] = _r((last - s20[-1]) / sd, 2)
    w3 = [closes[i] for i in range(n) if ts[i] >= ts[-1] - 91 * DAY]
    lo, hi = min(w3), max(w3)
    a["range3m"] = {"pos": _r((last - lo) / (hi - lo) * 100.0, 1) if hi != lo else None, "lo": _r(lo, 6), "hi": _r(hi, 6)}
    ev = []
    for kind, x, y, lab in (("p20", closes, s20, "20日線"), ("p60", closes, s60, "60日線"), ("ma5_20", s5, s20, "5日線が20日線")):
        cs = _crosses(x, y)
        if cs:
            e = cs[-1]
            ev.append({"kind": kind, "dir": e["dir"], "ago": e["ago"],
                       "label": lab + ("を上抜け" if e["dir"] == "up" else "を下抜け")})
    a["crosses"] = ev
    a["streak"] = _streak(closes)
    s20l, s60l = s20[-1], s60[-1]
    if all(_num(x) for x in (last, s20l, s60l, slope20)):
        side = lambda x: "上" if last > x else ("下" if last < x else "線上")      # noqa: E731
        a["trend_basis"] = "終値は20日線の%s・60日線の%s、20日線は5日で%+.2f%%" % (side(s20l), side(s60l), slope20)
        a["trend"] = ("上昇基調" if last > s20l > s60l and slope20 > 0 else
                      "下降基調" if last < s20l < s60l and slope20 < 0 else "横ばい")
    else:
        a["trend"], a["trend_basis"] = None, "日足が足りず判定できません（60日線に60本要る）"
    a["trend_rule"] = TREND_RULE
    sig = []
    for e in sorted(ev, key=lambda e: e["ago"]):
        sig.append(e["label"] + ("（直近）" if e["ago"] == 0 else "（%d日前）" % e["ago"]))
    z1, d1 = a["z1"], a["chg"]["d1"]
    if _num(z1) and abs(z1) >= 2 and _num(d1):
        bp = (a.get("chg_bp") or {}).get("d1")
        sig.append("前日比%+.0fbp（%.1fσ）" % (bp, abs(z1)) if yield_like and _num(bp) else "前日比%+.1f%%（%.1fσ）" % (d1, abs(z1)))
    if _num(a["rsi"]) and a["rsi"] >= 70:
        sig.append("RSI %d・買われ過ぎ圏" % round(a["rsi"]))
    elif _num(a["rsi"]) and a["rsi"] <= 30:
        sig.append("RSI %d・売られ過ぎ圏" % round(a["rsi"]))
    if _num(a["bb_z"]) and abs(a["bb_z"]) >= 2:
        sig.append("20日線%s2σ" % ("+" if a["bb_z"] > 0 else "-") + ("を上回る" if a["bb_z"] > 0 else "を下回る"))
    k = a["streak"]
    if abs(k) >= 3:
        sig.append("%d日連続%s" % (abs(k), ("上昇" if k > 0 else "低下") if yield_like else ("続伸" if k > 0 else "続落")))
    a["signals"] = sig[:6]
    return a


# ── parsing ──────────────────────────────────────────────────────────────

_ERA = {"R": 2018, "H": 1988, "S": 1925, "T": 1911, "M": 1867}


def wareki_to_date(s):
    """'R8.9.24' -> date(2026, 9, 24). Unreadable -> None (no date is made up)."""
    s = (s or "").strip()
    if len(s) < 2 or s[0].upper() not in _ERA:
        return None
    try:
        body = s[1:]
        if body.startswith("元"):
            body = "1" + body[1:]
        y, m, d = (int(x) for x in body.split("."))
        return dt.date(_ERA[s[0].upper()] + y, m, d)
    except (ValueError, TypeError):
        return None


def parse_jgb_csv(text):
    rows, head = [], None
    for line in text.splitlines():
        cells = [c.strip() for c in line.split(",")]
        if cells and cells[0] == "基準日":
            head = cells
            continue
        if head is None or not cells:
            continue
        d = wareki_to_date(cells[0])
        if d is None:
            continue
        vals = {}
        for k, v in zip(head[1:], cells[1:]):
            try:
                vals[k] = float(v)
            except ValueError:
                vals[k] = None
        rows.append((d, vals))
    rows.sort(key=lambda x: x[0])
    return rows


def parse_ust_csv(text):
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        try:
            d = dt.datetime.strptime((r.get("Date") or "").strip(), "%m/%d/%Y").date()
        except ValueError:
            continue
        vals = {}
        for k, v in r.items():
            try:
                vals[k.strip()] = float(v)
            except (TypeError, ValueError, AttributeError):
                vals[(k or "").strip()] = None
        rows.append((d, vals))
    rows.sort(key=lambda x: x[0])
    return rows


def parse_ecb_csv(text):
    """-> {currency: [(date, value per 1 EUR)]} ascending."""
    out = {}
    for r in csv.DictReader(io.StringIO(text)):
        try:
            d = dt.date.fromisoformat((r.get("TIME_PERIOD") or "")[:10])
            v = float(r.get("OBS_VALUE"))
        except (TypeError, ValueError):
            continue
        out.setdefault(r.get("CURRENCY"), []).append((d, v))
    for k in out:
        out[k].sort()
    return out


def parse_fred_csv(text):
    out = []
    rd = csv.reader(io.StringIO(text))
    next(rd, None)
    for row in rd:
        if len(row) < 2:
            continue
        try:
            d = dt.date.fromisoformat(row[0][:10])
            v = float(row[1])
        except ValueError:
            continue                                     # FRED writes "." for a day without a value
        out.append((d, v))
    out.sort()
    return out


def _ts(d):
    return calendar.timegm(d.timetuple())


def series_row(sid, group, name_ja, name_en, unit, src, points, yield_like=False, now=None):
    """points: ascending [(date, value)]. -> the series row the page draws."""
    pts = [(d, v) for d, v in points if _num(v)][-HIST_N:]
    row = {"id": sid, "group": group, "name_ja": name_ja, "name_en": name_en, "unit": unit, "source": SRC[src],
           "ok": False, "err": "", "as_of": None, "last": None, "prev": None, "chg": None, "chg_pct": None, "chg_bp": None,
           "spark": [], "ta": None}
    if len(pts) < 2:
        row["err"] = "fewer than 2 observations"
        return row
    ts, cl = [_ts(d) for d, _ in pts], [v for _, v in pts]
    row.update(ok=True, as_of=pts[-1][0].isoformat(), last=_r(cl[-1], 6), prev=_r(cl[-2], 6),
               chg=_r(cl[-1] - cl[-2], 6), chg_pct=_r(pct(cl[-1], cl[-2]), 3),
               spark=[[t, _r(v, 6)] for t, v in zip(ts[-SPARK_N:], cl[-SPARK_N:])])
    if yield_like:
        row["chg_bp"] = _r((cl[-1] - cl[-2]) * 100, 1)
    row["ta"] = analyze(ts, cl, yield_like)
    row["age_days"] = max(0, int((now - ts[-1]) // DAY)) if now else None
    return row


# ── fetching ─────────────────────────────────────────────────────────────

def _get_text(url, timeout=40, encoding="utf-8"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/csv,*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode(encoding, "replace")


def fetch_all(now=None, get=None):
    """-> the dict written to data/markets.json. Never raises; a failed source is a row in "sources" and its series are ok False."""
    now = time.time() if now is None else now
    get = get or _get_text
    today = dt.datetime.fromtimestamp(now, dt.timezone.utc).date()
    series, srcs, jgb_out = [], {}, None

    def src_status(name, ok, err="", n=0):
        srcs[name] = {"ok": ok, "err": err, "n": n, "fetched_at": int(now)}

    def failed(sid, group, name_ja, name_en, unit, s, err):
        series.append({"id": sid, "group": group, "name_ja": name_ja, "name_en": name_en, "unit": unit, "source": SRC[s],
                       "ok": False, "err": err, "as_of": None, "last": None, "prev": None, "chg": None, "chg_pct": None,
                       "chg_bp": None, "spark": [], "ta": None})

    # JGB (MOF): current month + the all-period file (the all-period one lags by a month)
    try:
        cur = parse_jgb_csv(get(JGB_URL, encoding="cp932"))
        try:
            allr = parse_jgb_csv(get(JGB_ALL_URL, 60, "cp932"))
        except Exception:
            allr = []
        merged = {}
        for d, v in allr + cur:
            merged[d] = v
        rows = sorted(merged.items())
        if len(rows) < 2:
            raise ValueError("fewer than 2 valid rows")
        (d0, v0), (d1, v1) = rows[-2], rows[-1]
        tenors = []
        for t in JGB_TENORS:
            y, p = v1.get(t), v0.get(t)
            ok = y is not None and p is not None
            tenors.append({"tenor": t, "yield": y, "prev": p, "chg_bp": _r((y - p) * 100, 1) if ok else None, "ok": ok})
        jgb_out = {"date": d1.isoformat(), "prev_date": d0.isoformat(), "unit": "%", "tenors": tenors,
                   "gap_days": (d1 - d0).days}
        for t in ("2年", "10年", "30年"):
            pts = [(d, v.get(t)) for d, v in rows if v.get(t) is not None]
            series.append(series_row("jgb-" + t[:-1] + "y", "rates", "日本国債 " + t, "JGB %s-year" % t[:-1], "%", "jgb", pts, True, now))
        src_status("jgb", True, "", len(rows))
    except Exception as e:
        src_status("jgb", False, ("%s: %s" % (type(e).__name__, e))[:160])
        for t in ("2", "10", "30"):
            failed("jgb-%sy" % t, "rates", "日本国債 %s年" % t, "JGB %s-year" % t, "%", "jgb", srcs["jgb"]["err"])

    # US Treasury par yields
    try:
        rows = parse_ust_csv(get(UST_URL.format(y=today.year)))
        if len(rows) < HIST_N // 2:
            rows = parse_ust_csv(get(UST_URL.format(y=today.year - 1))) + rows
        for col, ja, en in (("2 Yr", "米国債 2年", "US Treasury 2-year"), ("10 Yr", "米国債 10年", "US Treasury 10-year"),
                            ("30 Yr", "米国債 30年", "US Treasury 30-year")):
            series.append(series_row("ust-" + col.split()[0] + "y", "rates", ja, en, "%", "ust",
                                     [(d, v.get(col)) for d, v in rows], True, now))
        src_status("ust", True, "", len(rows))
    except Exception as e:
        src_status("ust", False, ("%s: %s" % (type(e).__name__, e))[:160])
        for t in ("2", "10", "30"):
            failed("ust-%sy" % t, "rates", "米国債 %s年" % t, "US Treasury %s-year" % t, "%", "ust", srcs["ust"]["err"])

    # ECB reference rates (per 1 EUR) -> USD/JPY, EUR/JPY, EUR/USD, CNY/JPY
    try:
        start = (today - dt.timedelta(days=HIST_N * 7 // 5 + 20)).isoformat()
        by = parse_ecb_csv(get(ECB_URL.format(start=start)))
        usd, jpy, cny = dict(by.get("USD", [])), dict(by.get("JPY", [])), dict(by.get("CNY", []))
        def cross(num, den):
            return [(d, num[d] / den[d]) for d in sorted(num) if d in den and den[d]]
        for sid, ja, en, pts in (("fx-usdjpy", "ドル円", "USD/JPY", cross(jpy, usd)),
                                 ("fx-eurjpy", "ユーロ円", "EUR/JPY", sorted(jpy.items())),
                                 ("fx-eurusd", "ユーロドル", "EUR/USD", sorted(usd.items())),
                                 ("fx-cnyjpy", "人民元円", "CNY/JPY", cross(jpy, cny))):
            series.append(series_row(sid, "fx", ja, en, "", "ecb", pts, False, now))
        src_status("ecb", True, "", sum(len(v) for v in by.values()))
    except Exception as e:
        src_status("ecb", False, ("%s: %s" % (type(e).__name__, e))[:160])
        for sid, ja, en in (("fx-usdjpy", "ドル円", "USD/JPY"), ("fx-eurjpy", "ユーロ円", "EUR/JPY"),
                            ("fx-eurusd", "ユーロドル", "EUR/USD"), ("fx-cnyjpy", "人民元円", "CNY/JPY")):
            failed(sid, "fx", ja, en, "", "ecb", srcs["ecb"]["err"])

    # EIA spot oil via FRED
    for sid, fid, ja, en in (("oil-wti", "DCOILWTICO", "WTI 原油", "WTI crude"), ("oil-brent", "DCOILBRENTEU", "ブレント原油", "Brent crude")):
        try:
            pts = parse_fred_csv(get(FRED_URL.format(id=fid)))[-HIST_N:]
            series.append(series_row(sid, "commodity", ja, en, "USD/bbl", "eia", pts, False, now))
            src_status("eia-" + fid, True, "", len(pts))
        except Exception as e:
            src_status("eia-" + fid, False, ("%s: %s" % (type(e).__name__, e))[:160])
            failed(sid, "commodity", ja, en, "USD/bbl", "eia", srcs["eia-" + fid]["err"])

    return {"schema": SCHEMA, "generated_at": int(now), "ok": any(s["ok"] for s in series), "note_ja": NOTE_JA, "note_en": NOTE_EN,
            "sources": srcs, "series": series, "jgb": jgb_out,
            "not_included": "Stock indices (Nikkei 225, TOPIX, S&P 500, Nasdaq, Dow) and crypto: no publisher terms that allow display were found, and the unofficial Yahoo endpoints are not used."}
