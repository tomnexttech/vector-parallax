# -*- coding: utf-8 -*-
"""hazards - the map's hazard layers: typhoons, serious disasters, earthquakes (Japan and world), tsunami (CONTRACT 18.7).

Public GET endpoints, no key, one request at a time with a gap, a User-Agent that names the project:
  jma_typhoon   Japan Meteorological Agency (bosai) targetTc.json -> forecast.json / specifications.json
                position, pressure, max wind (10-min mean, m/s), the track, the forecast circles, the storm and gale areas (actual radii)
  gdacs_tc      GDACS geteventlist MAP eventtype=TC (world tropical cyclones, track and cone)
  gdacs_events  GDACS geteventlist SEARCH (Orange/Red of every type, Green flood/volcano/wildfire of the last 72 h)
  jma_quake     JMA /quake/data/list.json (about 30 days) + the detail of the notable ones (tsunami comment)
  jma_tsunami   JMA /tsunami/data/list.json -> warnings, advisories, forecasts in force, and observations
  usgs          USGS summary 2.5_day.geojson (world, M2.5+, last 24 h)

Floor: what could not be fetched is not shown and no value is invented. No typhoon means "typhoons": [] (that is an answer).
A source that fails is a row in "sources" with the reason; the other sources are still returned. Times in the output are
epoch seconds (CONTRACT 1); the parsers work on ISO strings and fetch_all converts at the end.
"""
import datetime
import json
import math
import re
import socket
import time
import urllib.error
import urllib.request

try:
    from parallax import feeds as _feeds
    from parallax import quakeplace
except ImportError:                                       # run from inside parallax/
    import feeds as _feeds  # type: ignore
    import quakeplace  # type: ignore

SCHEMA = "parallax-hazards/1"
UA = _feeds.UA
TIMEOUT = 20
GAP = 0.4
MAX_QUAKE_DETAIL = 6
QUAKE_DAYS = 7
USGS_MAX = 400

JMA = "https://www.jma.go.jp/bosai"
JMA_TC_LIST = JMA + "/typhoon/data/targetTc.json"
JMA_TC_FILE = JMA + "/typhoon/data/{tc}/{name}.json"
JMA_QUAKE_LIST = JMA + "/quake/data/list.json"
JMA_QUAKE_FILE = JMA + "/quake/data/{json}"
JMA_TSUNAMI_LIST = JMA + "/tsunami/data/list.json"
JMA_TSUNAMI_FILE = JMA + "/tsunami/data/{json}"
JMA_TC_PAGE = "https://www.jma.go.jp/bosai/map.html#contents=typhoon"
JMA_TSUNAMI_PAGE = "https://www.jma.go.jp/bosai/map.html#contents=tsunami"
JMA_QUAKE_PAGE = "https://www.data.jma.go.jp/multi/quake/quake_detail.html?eventID={eid}&lang=jp"
GDACS = "https://www.gdacs.org/gdacsapi/api/events/geteventlist"
GDACS_TC_MAP = GDACS + "/MAP?eventtype=TC"
GDACS_SEARCH = GDACS + "/SEARCH?eventlist={types}&alertlevel={levels}&fromDate={frm}&toDate={to}&pagenumber={page}"
GDACS_PAGE = 100
GDACS_MAX_PAGES = 4
USGS = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson"

SOURCES = ("jma_typhoon", "gdacs_tc", "gdacs_events", "jma_quake", "jma_tsunami", "usgs")
ATTRIBUTION = "Japan Meteorological Agency (bosai); GDACS (EC-JRC / UN OCHA); USGS"
TYPE_JP = {"EQ": "地震", "TC": "熱帯低気圧", "FL": "洪水", "VO": "火山", "WF": "林野火災", "DR": "干ばつ", "TS": "津波"}
ALERT_RANK = {"Red": 3, "Orange": 2, "Green": 1}
CLASS_JP = {"TD": "熱帯低気圧", "TS": "熱帯暴風雨", "STS": "強い熱帯暴風雨", "TY": "台風", "STY": "スーパー台風",
            "SD": "亜熱帯低気圧", "SS": "亜熱帯暴風雨", "EX": "温帯低気圧", "LOW": "温帯低気圧", "LO": "低気圧"}
RULES = {
    "disasters": "GDACS Orange/Red of every type (in progress, or last updated within 7 days). Green: floods and volcanoes updated within 72 h, wildfires started within 72 h. Green earthquakes, droughts and tropical cyclones are not shown.",
    "typhoons": "Typhoons in force from JMA (targetTc) and tropical cyclones in progress from GDACS. For the same storm JMA is used and GDACS goes to 'also'.",
    "quakes_jp": "JMA earthquake reports (list of about 30 days), grouped per earthquake, last 7 days. 'tsunami' only for earthquakes whose detail was fetched (intensity 3+, M5.0+, distant); otherwise null (unknown).",
    "quakes_world": "USGS magnitude 2.5+ in the last 24 hours (up to 400, newest first).",
    "tsunami": "JMA tsunami warnings, advisories and forecasts in force. Cancelled and expired ones are not shown. Forecast areas have no position (name and code only).",
}
INT_RANK = {"1": 1, "2": 2, "3": 3, "4": 4, "5-": 5, "5+": 6, "6-": 7, "6+": 8, "7": 9}
INT_JP = {"1": "震度1", "2": "震度2", "3": "震度3", "4": "震度4", "5-": "震度5弱", "5+": "震度5強",
          "6-": "震度6弱", "6+": "震度6強", "7": "震度7"}
QUAKE_TITLES = ("震源・震度情報", "震度速報", "震源に関する情報", "遠地地震に関する情報", "顕著な地震の震源要素更新のお知らせ")
TSUNAMI_LEVEL = {"52": "major_warning", "53": "major_warning", "51": "warning", "62": "advisory",
                 "71": "forecast", "72": "forecast", "73": "forecast"}
TSUNAMI_LEVEL_RANK = {"major_warning": 4, "warning": 3, "advisory": 2, "forecast": 1}
TIME_KEYS = {"t", "time", "issued", "from", "to", "modified", "arrival", "observed_at", "reported"}

_last = [0.0]


def _get_json(url, timeout=TIMEOUT):
    """GET -> parsed JSON. An empty body (GDACS answers 204 past the last page) is None. One at a time, with a gap."""
    wait = GAP - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            status = getattr(r, "status", 200)
            raw = r.read()
    finally:
        _last[0] = time.time()
    if status == 204 or not raw.strip():
        return None
    return json.loads(raw.decode("utf-8-sig", "replace"))


# ── 時刻 ────────────────────────────────────────────────────────────────

def _dt(s):
    """ISO の時刻（Z・+09:00・時差なし＝UTC とみなす）を aware な datetime へ。読めなければ None。"""
    if not s or not isinstance(s, str):
        return None
    t = s.strip()
    if t.endswith("Z"):
        t = t[:-1] + "+00:00"
    try:
        d = datetime.datetime.fromisoformat(t)
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=datetime.timezone.utc)
    return d.astimezone(datetime.timezone.utc)


def _iso(d):
    return d.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


def _utc(s):
    return _iso(_dt(s))


def _epoch(s):
    d = _dt(s)
    return d.timestamp() if d else None


# ── 数と形 ──────────────────────────────────────────────────────────────

def _num(v):
    """文字列の数（"975"・"4.9"）を数へ。"Ｍ不明"・"" ・"-" は None（作らない）。"""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return v if math.isfinite(v) else None
    if isinstance(v, str):
        m = re.fullmatch(r"\s*([+-]?\d+(?:\.\d+)?)\s*", v)
        if m:
            x = float(m.group(1))
            return int(x) if x.is_integer() and "." not in m.group(1) else x
    return None


def _as_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def _km(lat1, lon1, lat2, lon2):
    """大円距離（km）。"""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(a)))


def parse_cod(cod):
    """気象庁の震源の座標 "+36.1+139.9-50000/" → (lat, lon, depth_km)。深さの無い遠地は depth None。
    "+0" は「ごく浅い」＝0 km。読めなければ (None, None, None)。"""
    m = re.match(r"^\s*([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+)?/", cod or "")
    if not m:
        return None, None, None
    lat, lon = float(m.group(1)), float(m.group(2))
    depth = None if m.group(3) is None else round(abs(int(m.group(3))) / 1000.0, 1)
    return lat, lon, depth


# ── network: see _get_json above ──


def _why(e):
    """失敗の理由を短く（errors に載せる文）。"""
    if isinstance(e, urllib.error.HTTPError):
        return "HTTP %s" % e.code
    if isinstance(e, urllib.error.URLError):
        r = e.reason
        if isinstance(r, (socket.timeout, TimeoutError)):
            return "応答なし（%d 秒）" % TIMEOUT
        return "接続できません: %s" % (r,)
    if isinstance(e, (socket.timeout, TimeoutError)):
        return "応答なし（%d 秒）" % TIMEOUT
    if isinstance(e, json.JSONDecodeError):
        return "JSON を読めません"
    return "%s: %s" % (type(e).__name__, str(e)[:160])


# ── 気象庁の台風 ───────────────────────────────────────────────────────

def parse_jma_target(lst):
    """targetTc.json → [{"tc": "TC2632", "number": "2626", "category": "TY", "issue": ...}]。"""
    out = []
    for e in _as_list(lst):
        if isinstance(e, dict) and re.fullmatch(r"TC\d{4}", str(e.get("tropicalCyclone") or "")):
            out.append({"tc": e["tropicalCyclone"], "number": e.get("typhoonNumber"),
                        "category": e.get("category"), "issue": e.get("issue")})
    return out


def _jma_part_parts(doc):
    title, parts = {}, {}
    for p in _as_list(doc):
        if not isinstance(p, dict):
            continue
        if p.get("part") == "title":
            title = p
        elif isinstance(p.get("part"), dict) and isinstance(p.get("advancedHours"), (int, float)):
            parts[int(p["advancedHours"])] = p
    return title, parts


def _jma_wind(s):
    mw = (s or {}).get("maximumWind") or {}
    return _num((mw.get("sustained") or {}).get("m/s")), _num((mw.get("gust") or {}).get("m/s"))


def _jma_ranges_km(lst):
    """specifications の暴風域・強風域 [{"area": "南東", "range": {"km": 85}}] → (最大 km, [{"dir","km"}])。"""
    rs = []
    for r in _as_list(lst):
        km = _num(((r or {}).get("range") or {}).get("km"))
        if km is not None:
            rs.append({"dir": r.get("area"), "km": km})
    return (max(x["km"] for x in rs) if rs else None), rs


def _jma_circle(c):
    """{"center": [lat, lon], "radius": m} → {"lat","lon","r_km"}。"""
    if not isinstance(c, dict) or not isinstance(c.get("center"), list) or _num(c.get("radius")) is None:
        return None
    return {"lat": c["center"][0], "lon": c["center"][1], "r_km": round(_num(c["radius"]) / 1000.0, 1)}


def _jma_area(a):
    """暴風警戒域の外形。arc = [[lat, lon], 半径 m, [始め, 終わり]]（角度は北から時計回り・度——
    12 時間後の円の弧の端が接線の端と一致することで確かめた）。line = [[lat, lon], [lat, lon]]。"""
    if not isinstance(a, dict):
        return None
    arcs, lines = [], []
    for arc in _as_list(a.get("arc")):
        try:
            (lat, lon), r, (d0, d1) = arc
            arcs.append({"lat": lat, "lon": lon, "r_km": round(float(r) / 1000.0, 1), "from_deg": d0, "to_deg": d1})
        except (TypeError, ValueError):
            continue
    for ln in _as_list(a.get("line")):
        try:
            (a0, b0), (a1, b1) = ln
            lines.append([[a0, b0], [a1, b1]])
        except (TypeError, ValueError):
            continue
    return {"arcs": arcs, "lines": lines, "angle": "北から時計回り（度）"} if (arcs or lines) else None


def parse_jma_typhoon(entry, forecast, spec):
    """targetTc の一件と forecast.json・specifications.json から台風を一つ組む。
    経路の点は位置だけ（気象庁の JSON に時刻・気圧・風は無い）——無いものは null のまま。"""
    tf, pf = _jma_part_parts(forecast)
    ts, ps = _jma_part_parts(spec)
    af, as_ = pf.get(0), ps.get(0)
    if not af and not as_:
        raise ValueError("%s: 実況がありません" % entry.get("tc"))
    af, as_ = af or {}, as_ or {}
    center = af.get("center") or ((as_.get("position") or {}).get("deg"))
    if not (isinstance(center, list) and len(center) == 2):
        raise ValueError("%s: 実況の中心がありません" % entry.get("tc"))

    num_s = str(tf.get("typhoonNumber") or ts.get("typhoonNumber") or entry.get("number") or "")
    number = int(num_s[-2:]) if re.fullmatch(r"\d{4}", num_s) else None
    nm = tf.get("name") or ts.get("name") or {}
    name_jp, name_en = nm.get("jp") or None, nm.get("en") or None
    cat = as_.get("category") or ts.get("category") or {}
    cls = cat.get("en") or entry.get("category")
    if number is not None:
        name = "台風第%d号" % number + ("（%s）" % name_jp if name_jp else "")
    else:
        name = (cat.get("jp") or "熱帯低気圧") + "（%s）" % entry.get("tc")
    wind, gust = _jma_wind(as_)

    track = []
    tr = af.get("track") or {}
    for stage, key in (("pre", "preTyphoon"), ("ty", "typhoon")):
        for pt in _as_list(tr.get(key)):
            if not (isinstance(pt, list) and len(pt) == 2):
                continue
            if track and track[-1]["lat"] == pt[0] and track[-1]["lon"] == pt[1]:
                continue      # 熱帯低気圧の段と台風の段の継ぎ目は同じ点
            track.append({"t": None, "lat": pt[0], "lon": pt[1], "pressure": None, "wind": None, "stage": stage})
    t_now = _utc((af.get("validtime") or as_.get("validtime") or {}).get("UTC"))
    if track and track[-1]["lat"] == center[0] and track[-1]["lon"] == center[1]:
        track[-1]["t"] = t_now          # 経路の終端は実況の中心（その時刻だけは分かる）
        track[-1]["pressure"], track[-1]["wind"] = _num(as_.get("pressure")), wind

    forecast_pts = []
    for h in sorted(set(pf) | set(ps)):
        if h <= 0:
            continue
        f, s = pf.get(h) or {}, ps.get(h) or {}
        c = f.get("center") or ((s.get("position") or {}).get("deg"))
        if not (isinstance(c, list) and len(c) == 2):
            continue
        pc = f.get("probabilityCircle") or {}
        r = _num(pc.get("radius"))
        r_km = round(r / 1000.0, 1) if r is not None else _num((s.get("probabilityCircleRadius") or {}).get("km"))
        w, g = _jma_wind(s)
        storm_km, _ = _jma_ranges_km(s.get("stormWarning"))
        forecast_pts.append({
            "t": _utc((f.get("validtime") or s.get("validtime") or {}).get("UTC")), "hours": h,
            "lat": c[0], "lon": c[1], "r_km": r_km,
            "pressure": _num(s.get("pressure")), "wind": w, "gust": g,
            "class": (s.get("category") or {}).get("en"), "class_jp": (s.get("category") or {}).get("jp"),
            "storm_r_km": storm_km,
        })

    storm_area = None
    for h in sorted(pf, reverse=True):
        if h > 0 and pf[h].get("stormWarningArea"):
            storm_area = _jma_area(pf[h]["stormWarningArea"])
            break
    storm_km, storm_dirs = _jma_ranges_km(as_.get("stormWarning"))
    gale_km, gale_dirs = _jma_ranges_km(as_.get("galeWarning"))
    storm_now = None
    arcs = _as_list((af.get("stormWarningArea") or {}).get("arc"))
    if arcs:
        try:
            (la, lo), rr, _ = arcs[0]
            storm_now = {"lat": la, "lon": lo, "r_km": round(float(rr) / 1000.0, 1)}
        except (TypeError, ValueError):
            storm_now = None

    speed = as_.get("speed") or {}
    issue = ((tf.get("issue") or ts.get("issue") or {}).get("UTC")) or entry.get("issue")
    return {
        "id": "jma:%s" % entry.get("tc"), "name": name, "name_jp": name_jp, "name_en": name_en,
        "number": number, "src": "JMA", "time": t_now, "issued": _utc(issue),
        "lat": center[0], "lon": center[1],
        "pressure": _num(as_.get("pressure")), "wind": wind, "gust": gust,
        "wind_unit": "m/s（気象庁・10 分平均）",
        "class": cls, "class_jp": cat.get("jp"),
        "intensity_jp": as_.get("intensity") if as_.get("intensity") not in (None, "-") else None,
        "scale_jp": as_.get("scale") if as_.get("scale") not in (None, "-") else None,
        "location_jp": as_.get("location"), "course_jp": as_.get("course"), "speed_kmh": _num(speed.get("km/h")),
        "storm": storm_now, "storm_r_km": storm_km, "storm_dirs": storm_dirs,
        "gale": _jma_circle(af.get("galeWarningArea")), "gale_r_km": gale_km, "gale_dirs": gale_dirs,
        "track": track, "forecast": forecast_pts, "storm_area": storm_area, "cone": None,
        "alert": None, "url": JMA_TC_PAGE,
    }


def fetch_jma_typhoons():
    """(台風の list, 部分的な失敗の理由 or None)。一覧そのものが取れなければ例外。"""
    lst = _get_json(JMA_TC_LIST)
    out, errs = [], []
    for e in parse_jma_target(lst or []):
        try:
            fc = _get_json(JMA_TC_FILE.format(tc=e["tc"], name="forecast"))
            sp = _get_json(JMA_TC_FILE.format(tc=e["tc"], name="specifications"))
            out.append(parse_jma_typhoon(e, fc or [], sp or []))
        except Exception as ex:
            errs.append("%s: %s" % (e["tc"], _why(ex)))
    return out, ("; ".join(errs) or None)


# ── GDACS の熱帯低気圧 ──────────────────────────────────────────────────

def _ring_center(ring):
    """点を表す小さな円の多角形 → 中心 (lat, lon)。日付変更線を跨ぐ円も扱う。"""
    lons = [p[0] for p in ring if isinstance(p, list) and len(p) >= 2]
    lats = [p[1] for p in ring if isinstance(p, list) and len(p) >= 2]
    if not lons:
        return None
    if max(lons) - min(lons) > 180:
        lons = [x + 360 if x < 0 else x for x in lons]
    lon = (min(lons) + max(lons)) / 2.0
    if lon > 180:
        lon -= 360
    return round((min(lats) + max(lats)) / 2.0, 2), round(lon, 2)


def _gdacs_label_time(label, ref):
    """"23/09 06:00 UTC"（年が無い）→ UTC の datetime。年は嵐の始まり ref から補い、年跨ぎを直す。"""
    m = re.search(r"(\d{1,2})/(\d{1,2})\s+(\d{1,2}):(\d{2})", label or "")
    if not m or not ref:
        return None
    d, mo, hh, mm = (int(x) for x in m.groups())
    try:
        t = datetime.datetime(ref.year, mo, d, hh, mm, tzinfo=datetime.timezone.utc)
    except ValueError:
        return None
    if (ref - t).days > 180:
        t = t.replace(year=ref.year + 1)
    return t


def parse_gdacs_tc_map(gj, now):
    """GDACS MAP?eventtype=TC の GeoJSON → 熱帯低気圧の list。
    Point_Centroid＝現在位置、Point_Polygon_Point_N＝経路の点（小円・札が時刻）、Line_Line_N＝区間（札が階級）、
    Poly_Cones＝予報の不確実性の錐。区間の札は終点の階級（SURIGAE の実況点へ入る区間が HU・出る区間が TS で、
    気象庁の実況 TY → 12 時間後 STS と一致することで確かめた）。点ごとの風・気圧は MAP に無い——null のまま。"""
    storms = {}
    for f in (gj or {}).get("features") or []:
        p, g = f.get("properties") or {}, f.get("geometry") or {}
        if p.get("eventtype") != "TC" or p.get("eventid") is None:
            continue
        s = storms.setdefault(p["eventid"], {"base": None, "points": [], "lines": [], "cone": None, "pdate": None})
        cls = p.get("Class") or ""
        if cls == "Point_Centroid":
            s["base"] = (p, g)
        elif cls.startswith("Point_Polygon_Point") and g.get("type") == "Polygon":
            s["points"].append((p.get("polygonlabel"), g))
        elif cls.startswith("Line_Line") and g.get("type") == "LineString":
            s["lines"].append((p.get("polygonlabel"), g))
        elif cls == "Poly_Cones":
            s["cone"] = g
        if cls != "Point_Centroid" and p.get("polygondate"):
            s["pdate"] = max(s["pdate"] or "", p["polygondate"])

    out = []
    for eid, s in storms.items():
        if not s["base"]:
            continue
        p, g = s["base"]
        if str(p.get("iscurrent")).lower() != "true":
            continue
        t_to = _dt(p.get("todate"))
        if not t_to or now - t_to.timestamp() > 48 * 3600:
            continue
        coords = g.get("coordinates") or []
        if g.get("type") != "Point" or len(coords) < 2:
            continue
        ref = _dt(p.get("fromdate")) or t_to
        t_an = _dt(s["pdate"]) or t_to              # 実況（解析）の時刻
        cls_at = {}
        for label, lg in s["lines"]:
            c = lg.get("coordinates") or []
            if len(c) >= 2:
                cls_at[(round(c[-1][1], 1), round(c[-1][0], 1))] = label or None
        track, fc = [], []
        pts = []
        for label, pg in s["points"]:
            ctr = _ring_center((pg.get("coordinates") or [[]])[0])
            t = _gdacs_label_time(label, ref)
            if ctr and t:
                pts.append((t, ctr))
        for t, (lat, lon) in sorted(pts):
            cls = cls_at.get((round(lat, 1), round(lon, 1)))
            if t <= t_an + datetime.timedelta(minutes=1):
                track.append({"t": _iso(t), "lat": lat, "lon": lon, "pressure": None, "wind": None, "class": cls})
            else:
                fc.append({"t": _iso(t), "hours": round((t - t_an).total_seconds() / 3600.0),
                           "lat": lat, "lon": lon, "r_km": None, "class": cls})
        cone = None
        cg = s["cone"] or {}
        rings = []
        if cg.get("type") == "Polygon":
            rings = cg.get("coordinates") or []
        elif cg.get("type") == "MultiPolygon":
            rings = [r for poly in cg.get("coordinates") or [] for r in poly]
        if rings:
            cone = [[[round(pt[1], 3), round(pt[0], 3)] for pt in r if len(pt) >= 2] for r in rings]
        base = re.sub(r"-\d{2}$", "", (p.get("eventname") or "").strip()) or None
        sev = p.get("severitydata") or {}
        lat, lon = coords[1], coords[0]
        cur_cls = cls_at.get((round(lat, 1), round(lon, 1)))
        out.append({
            "id": "gdacs:TC:%s" % eid, "name": base or p.get("name"), "name_jp": None, "name_en": base,
            "number": None, "src": "GDACS/%s" % (p.get("source") or "?"),
            "time": _iso(t_an), "issued": _utc(p.get("datemodified")),
            "lat": lat, "lon": lon, "pressure": None, "wind": None, "gust": None,
            "wind_max_kmh": _num(sev.get("severity")) if (sev.get("severityunit") == "km/h") else None,
            "wind_unit": None, "severity": (sev.get("severitytext") or "").strip() or None,
            "class": cur_cls, "class_jp": None,
            "country": (p.get("country") or "").strip() or None,
            "track": track, "forecast": fc, "cone": cone, "storm_area": None,
            "alert": p.get("alertlevel"), "url": (p.get("url") or {}).get("report"),
        })
    return out


def merge_typhoons(jma, gdacs):
    """同じ嵐は気象庁を採る。名前（英名）が一致するか、どちらかが無名で 300 km 以内なら同じとみなす。
    GDACS 側は捨てずに also へ（警報色・出典の道筋を残す）。"""
    out = [dict(t) for t in jma]
    for g in gdacs:
        hit = None
        for j in out:
            if not j["src"].startswith("JMA"):
                continue
            a, b = (j.get("name_en") or "").upper(), (g.get("name_en") or "").upper()
            if a and b:
                same = a == b
            else:
                same = _km(j["lat"], j["lon"], g["lat"], g["lon"]) < 300
            if same:
                hit = j
                break
        if hit is not None:
            hit.setdefault("also", []).append({"id": g["id"], "src": g["src"], "alert": g.get("alert"),
                                              "severity": g.get("severity"), "url": g.get("url")})
            if hit.get("alert") is None:
                hit["alert"] = g.get("alert")
        else:
            out.append(g)
    return out


# ── GDACS の災害 ───────────────────────────────────────────────────────

def parse_gdacs_events(gj):
    """GDACS SEARCH の GeoJSON → 正規化した災害の list（絞る前）。"""
    out = []
    for f in (gj or {}).get("features") or []:
        p, g = f.get("properties") or {}, f.get("geometry") or {}
        typ = p.get("eventtype")
        if not typ or p.get("eventid") is None:
            continue
        c = g.get("coordinates") if g.get("type") == "Point" else None
        if not c:
            bb = f.get("bbox") or []
            c = [(bb[0] + bb[2]) / 2.0, (bb[1] + bb[3]) / 2.0] if len(bb) == 4 else None
        if not c:
            continue
        sev = p.get("severitydata") or {}
        out.append({
            "id": "gdacs:%s:%s" % (typ, p["eventid"]), "type": typ, "type_jp": TYPE_JP.get(typ, typ),
            "name": (p.get("name") or "").strip(), "lat": c[1], "lon": c[0],
            "alert": p.get("alertlevel"), "severity": (sev.get("severitytext") or "").strip() or None,
            "country": (p.get("country") or "").strip() or None,
            "from": _utc(p.get("fromdate")), "to": _utc(p.get("todate")),
            "url": (p.get("url") or {}).get("report"), "src": "GDACS/%s" % (p.get("source") or "?"),
            "current": str(p.get("iscurrent")).lower() == "true", "episode": p.get("episodeid"),
            "modified": _utc(p.get("datemodified")),
        })
    return out


def select_disasters(events, now):
    """RULES["disasters"] の通りに絞り、同じ事象は新しい回（episode）を採って並べる（Red→Orange→Green、新しい順）。"""
    keep = {}
    for e in events:
        t_to, t_from = _epoch(e.get("to")), _epoch(e.get("from"))
        a, typ = e.get("alert"), e.get("type")
        if a in ("Orange", "Red"):
            ok = e.get("current") or (t_to is not None and now - t_to <= 7 * 86400)
        elif a == "Green" and typ in ("FL", "VO"):
            ok = t_to is not None and now - t_to <= 72 * 3600
        elif a == "Green" and typ == "WF":
            ok = t_from is not None and now - t_from <= 72 * 3600
        else:
            ok = False
        if not ok:
            continue
        old = keep.get(e["id"])
        if old is None or (e.get("episode") or 0) > (old.get("episode") or 0):
            keep[e["id"]] = e
    return sorted(keep.values(), key=lambda e: (-ALERT_RANK.get(e.get("alert"), 0), -(_epoch(e.get("to")) or 0)))


def _gdacs_search(types, levels, frm, to):
    """SEARCH を頁ごとに引く。(features, 切り詰めたか)。頁の先は 204 空。"""
    feats = []
    for page in range(1, GDACS_MAX_PAGES + 1):
        gj = _get_json(GDACS_SEARCH.format(types=types, levels=levels, frm=frm, to=to, page=page))
        fs = (gj or {}).get("features") or []
        feats.extend(fs)
        if len(fs) < GDACS_PAGE:
            return feats, False
    return feats, True


def fetch_gdacs_events(now):
    d = datetime.datetime.fromtimestamp(now, datetime.timezone.utc)
    to = (d + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    f1, cut1 = _gdacs_search("EQ;TC;FL;VO;DR;WF", "Orange;Red",
                             (d - datetime.timedelta(days=30)).strftime("%Y-%m-%d"), to)
    f2, cut2 = _gdacs_search("FL;VO;WF", "Green", (d - datetime.timedelta(days=3)).strftime("%Y-%m-%d"), to)
    ev = parse_gdacs_events({"features": f1 + f2})
    note = None
    if cut1 or cut2:
        note = "GDACS の一覧が %d 頁を超えました（先は読んでいません）" % GDACS_MAX_PAGES
    return ev, note


# ── 気象庁の地震 ───────────────────────────────────────────────────────

def _int_max(vals):
    best = None
    for v in vals:
        if v in INT_RANK and (best is None or INT_RANK[v] > INT_RANK[best]):
            best = v
    return best


def parse_jma_quake_list(lst):
    """list.json → 地震ごとに束ねた list（新しい順）。各地震は最新の座標付きの報を位置の代表に、
    最大震度は全報の最大を採る。取消で終わった地震は落とす。_files は詳細を引くための候補。"""
    by = {}
    for e in _as_list(lst):
        if not isinstance(e, dict) or e.get("ttl") not in QUAKE_TITLES or not e.get("eid"):
            continue
        by.setdefault(e["eid"], []).append(e)
    out = []
    for eid, es in by.items():
        es.sort(key=lambda e: str(e.get("ctt") or ""))
        if es[-1].get("ift") == "取消":
            continue
        rep = None
        for e in reversed(es):
            if parse_cod(e.get("cod"))[0] is not None:
                rep = e
                break
        lat, lon, depth = parse_cod((rep or {}).get("cod"))
        mag = None
        for e in reversed(es):
            mag = _num(e.get("mag"))
            if mag is not None:
                break
        maxi = _int_max([e.get("maxi") for e in es])
        head = rep or es[-1]
        distant = any(e.get("ttl") == "遠地地震に関する情報" for e in es)
        out.append({
            "id": "jma:quake:%s" % eid, "eid": eid,
            "t": _utc(head.get("at")), "reported": _utc(es[-1].get("rdt")),
            "place": head.get("anm") or None, "place_en": head.get("en_anm") or None,
            "lat": lat, "lon": lon, "depth_km": depth, "mag": mag,
            "maxint": maxi, "maxint_jp": INT_JP.get(maxi), "distant": distant,
            "tsunami": None, "url": JMA_QUAKE_PAGE.format(eid=eid), "src": "JMA",
            "_file": (rep or es[-1]).get("json"),
        })
    out.sort(key=lambda q: q["t"] or "", reverse=True)
    return out


def quake_wants_detail(q):
    """津波の付記を詳細から引く値打ちのある地震か（震度 3 以上・M5.0 以上・遠地）。"""
    return bool(q.get("_file")) and (
        (q.get("maxint") in INT_RANK and INT_RANK[q["maxint"]] >= 3)
        or (q.get("mag") is not None and q["mag"] >= 5.0) or q.get("distant"))


def parse_jma_quake_comment(detail):
    """地震の詳細 JSON → 津波の付記（ForecastComment）。無ければ ""。"""
    c = (((detail or {}).get("Body") or {}).get("Comments") or {})
    t = ((c.get("ForecastComment") or {}).get("Text") or "").strip()
    return t


def fetch_jma_quakes(details):
    """(地震の list, 詳細で落ちた理由 or None)。details は不変のファイル名 → 付記の控え（成功だけ入る）。"""
    lst = _get_json(JMA_QUAKE_LIST)
    qs = parse_jma_quake_list(lst or [])
    fails, pulled = [], 0
    for q in qs:
        f = q.get("_file")
        if not quake_wants_detail(q) or f in details:
            continue
        if pulled >= MAX_QUAKE_DETAIL:
            break
        pulled += 1
        try:
            details[f] = parse_jma_quake_comment(_get_json(JMA_QUAKE_FILE.format(json=f)))
        except Exception as ex:
            fails.append("%s: %s" % (f, _why(ex)))
    live = {q["_file"] for q in qs if q.get("_file")}
    for f in list(details):
        if f not in live:
            del details[f]          # 一覧から消えた地震の控えは捨てる
    return qs, ("津波の付記を引けません: " + "; ".join(fails) if fails else None)


# ── 気象庁の津波 ───────────────────────────────────────────────────────

def _tsunami_kind(e):
    j = str(e.get("json") or "")
    for k in ("VTSE41", "VTSE51", "VTSE52"):
        if k in j:
            return k
    t = str(e.get("ttl") or "")
    if "警報" in t or "注意報" in t or "予報" in t:
        return "VTSE41"
    if "沖合" in t:
        return "VTSE52"
    if "津波情報" in t or "観測" in t:
        return "VTSE51"
    return None


def pick_tsunami_files(lst):
    """list.json → {eid: {"VTSE41": 最新の報, "VTSE51": 最新の報}}。取消の報は除く。"""
    by = {}
    for e in _as_list(lst):
        if not isinstance(e, dict) or not e.get("json") or e.get("ift") == "取消":
            continue
        k = _tsunami_kind(e)
        if k not in ("VTSE41", "VTSE51"):
            continue
        cur = by.setdefault(e.get("eid") or e["json"], {}).get(k)
        if cur is None or str(e.get("ctt") or "") > str(cur.get("ctt") or ""):
            by[e.get("eid") or e["json"]][k] = e
    return by


def _tsunami_quake(body):
    eqs = _as_list((body or {}).get("Earthquake"))
    if not eqs:
        return None
    eq = eqs[0] or {}
    area = ((eq.get("Hypocenter") or {}).get("Area") or {})
    lat, lon, depth = parse_cod(area.get("Coordinate"))
    return {"t": _utc(eq.get("OriginTime")), "place": area.get("Name"), "place_en": area.get("enName"),
            "lat": lat, "lon": lon, "depth_km": depth, "mag": _num(eq.get("Magnitude"))}


def parse_jma_tsunami(warn, obs=None, now=None):
    """VTSE41（警報・注意報・予報）と VTSE51（観測）→ 発表中の津波の一件。発表中の予報区が無ければ None。"""
    head, body = (warn or {}).get("Head") or {}, (warn or {}).get("Body") or {}
    if head.get("InfoType") == "取消":
        return None
    valid = _epoch(head.get("ValidDateTime"))
    expired = valid is not None and now is not None and now > valid
    areas = []
    for it in _as_list(((body.get("Tsunami") or {}).get("Forecast") or {}).get("Item")):
        kind = ((it or {}).get("Category") or {}).get("Kind") or {}
        lvl = TSUNAMI_LEVEL.get(str(kind.get("Code")))
        if not lvl or (expired and lvl == "forecast"):
            continue
        area, fh, mh = it.get("Area") or {}, it.get("FirstHeight") or {}, it.get("MaxHeight") or {}
        areas.append({"code": area.get("Code"), "name": area.get("Name"), "name_en": area.get("enName"),
                      "kind": kind.get("Name"), "kind_code": kind.get("Code"), "level": lvl,
                      "max_height": mh.get("TsunamiHeight") or ((mh.get("Condition") or None)),
                      "arrival": _utc(fh.get("ArrivalTime")), "condition": fh.get("Condition")})
    if not areas:
        return None
    observed = []
    ob_body = ((obs or {}).get("Body") or {}).get("Tsunami") or {}
    for it in _as_list((ob_body.get("Observation") or {}).get("Item")):
        for st in _as_list((it or {}).get("Station")):
            mh, ll = (st or {}).get("MaxHeight") or {}, (st or {}).get("latlon") or {}
            observed.append({"station": st.get("Name"), "area": ((it.get("Area") or {}).get("Name")),
                             "lat": _num(ll.get("lat")), "lon": _num(ll.get("lon")),
                             "height": mh.get("TsunamiHeight") or mh.get("Condition"),
                             "time": _utc(mh.get("DateTime")),
                             "first": ((st.get("FirstHeight") or {}).get("Condition"))})
    top = max(areas, key=lambda a: TSUNAMI_LEVEL_RANK[a["level"]])["level"]
    comment = ((((body.get("Comments") or {}).get("WarningComment")) or {}).get("Text") or "").strip()
    return {"id": "jma:tsunami:%s" % head.get("EventID"), "eid": head.get("EventID"),
            "issued": _utc(head.get("ReportDateTime")), "title": head.get("Title"),
            "headline": ((head.get("Headline") or {}).get("Text") or "").strip() or None,
            "level": top, "areas": areas, "observed": observed,
            "observed_at": _utc(((obs or {}).get("Head") or {}).get("TargetDateTime")) if obs else None,
            "quake": _tsunami_quake(body), "comment": comment or None,
            "url": JMA_TSUNAMI_PAGE, "src": "JMA"}


def fetch_jma_tsunami(details, now):
    lst = _get_json(JMA_TSUNAMI_LIST)
    picks = pick_tsunami_files(lst or [])
    out, fails, live = [], [], set()
    for eid, d in picks.items():
        docs = {}
        for k in ("VTSE41", "VTSE51"):
            e = d.get(k)
            if not e:
                continue
            f = e["json"]
            live.add(f)
            if f not in details:
                try:
                    details[f] = _get_json(JMA_TSUNAMI_FILE.format(json=f))
                except Exception as ex:
                    fails.append("%s: %s" % (f, _why(ex)))
                    continue
            docs[k] = details[f]
        if "VTSE41" in docs:
            t = parse_jma_tsunami(docs["VTSE41"], docs.get("VTSE51"), now)
            if t:
                out.append(t)
        elif d.get("VTSE41"):
            pass                    # 警報の報を引けなかった——fails に理由がある
    for f in list(details):
        if f not in live:
            del details[f]
    out.sort(key=lambda t: (-TSUNAMI_LEVEL_RANK.get(t["level"], 0), t.get("issued") or ""))
    return out, ("津波の報を引けません: " + "; ".join(fails) if fails else None)


# ── 面へ出す札（名前・階級・強さ）─────────────────────────────────────────
# 2026-09-29 検証の指摘: 地図の札が「NOLO NOLO・・HU」（名の重複・空の区切り・生の符号）、災害は GDACS の英文
# （Tropical Cyclone POLO-26・Magnitude 0・25 か国の列挙）、HOME の行は強さの代わりに警報色の語（Green・Red）。
# 源の値から短い札を組む: label（名）・class_jp（階級）・strength（強さの数）・place（国）。判らない物は None（0 と書かない）

def class_jp(code, lat=None, lon=None):
    """階級の符号 → 日本語。HU は海域で決める。判らなければ None。"""
    c = str(code or "").strip().upper()
    if not c:
        return None
    if c == "HU":
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            return None
        if lat >= 0 and 100 <= lon <= 180:
            return "台風"
        if lat >= 0 and lon < -20:
            return "ハリケーン"
        return "サイクロン"
    return CLASS_JP.get(c)


def _n(x):
    return "{:,}".format(int(round(x)))


def typhoon_strength(t):
    """台風の強さの札: 気象庁は「強さ・中心気圧・最大風速」、GDACS は生涯最大風速（km/h）。無ければ None。"""
    parts = []
    if t.get("intensity_jp"):
        parts.append(t["intensity_jp"])
    if _num(t.get("pressure")) is not None:
        parts.append("%s hPa" % _n(t["pressure"]))
    if _num(t.get("wind")) is not None:
        parts.append("%s m/s" % _n(t["wind"]))
    elif _num(t.get("wind_max_kmh")) is not None:
        parts.append("最大 %s km/h" % _n(t["wind_max_kmh"]))
    return "・".join(parts) or None


def short_place(country):
    """GDACS の国の並び（末尾の読点・重複の空白つき）→「最初の国」または「最初の国 +残りの数」。無ければ None。"""
    cs = [re.sub(r"\s+", " ", c).strip() for c in str(country or "").split(",")]
    cs = [c for c in cs if c]
    if not cs:
        return None
    return cs[0] if len(cs) == 1 else "%s +%d" % (cs[0], len(cs) - 1)


def disaster_strength(e):
    """GDACS の severity の文 → 強さの札。洪水の「Magnitude 0」は値が無いという意味——None（0 と書かない）。"""
    sev = str(e.get("severity") or "")
    m = re.search(r"maximum wind speed of ([\d.]+)\s*km/h", sev, re.I)
    if m:
        return "最大 %s km/h" % _n(float(m.group(1)))
    m = re.search(r"Magnitude\s*([\d.]+)", sev, re.I)
    if m and e.get("type") == "EQ" and float(m.group(1)) > 0:
        dp = re.search(r"Depth\s*:?\s*([\d.]+)\s*km", sev, re.I)
        return "M%s" % m.group(1) + ("・深さ %s km" % dp.group(1) if dp else "")
    m = re.search(r"\bin ([\d.]+)\s*km2\b", sev)
    if m and float(m.group(1)) > 0:
        return "%s km²" % _n(float(m.group(1)))
    m = re.search(r"\bin ([\d.]+)\s*ha\b", sev)
    if m and float(m.group(1)) > 0:
        return "%s ha" % _n(float(m.group(1)))
    return None


def _tc_class_from_severity(sev):
    t = str(sev or "")
    if re.search(r"Tropical Depression", t, re.I):
        return "TD"
    if re.search(r"Tropical Storm", t, re.I):
        return "TS"
    if re.search(r"Hurricane|Typhoon", t, re.I):
        return "HU"
    return None


def decorate_typhoon(t):
    """台風の写しに札を付ける（label・class_jp・strength。点ごとの class_jp も）"""
    d = dict(t)
    if not d.get("class_jp"):
        d["class_jp"] = class_jp(d.get("class"), d.get("lat"), d.get("lon"))
    for key in ("track", "forecast"):
        pts = []
        for p in d.get(key) or []:
            q = dict(p)
            if q.get("class") and not q.get("class_jp"):
                q["class_jp"] = class_jp(q["class"], q.get("lat"), q.get("lon"))
            pts.append(q)
        d[key] = pts
    base = d.get("name") or d.get("name_en")
    if str(d.get("src") or "").startswith("JMA"):
        d["label"] = base
    else:
        d["label"] = " ".join(x for x in (d["class_jp"], base) if x) or None
    d["strength"] = typhoon_strength(d)
    return d


def decorate_disaster(e, typhoon_of=None):
    """災害の写しに札を付ける（name の空白を整え、label・place・strength・class_jp、同じ嵐の台風の id）"""
    d = dict(e)
    nm = re.sub(r"\s+", " ", str(d.get("name") or "")).strip().rstrip(",").strip()
    d["name"] = nm
    typ = d.get("type")
    d["place"] = short_place(d.get("country"))
    if typ == "TC":
        m = re.match(r"(?i)tropical cyclone\s+(.+?)(?:-\d{2})?$", nm)
        short = m.group(1) if m else nm
        d["class_jp"] = class_jp(_tc_class_from_severity(d.get("severity")), d.get("lat"), d.get("lon"))
    elif typ == "VO":
        m = re.match(r"(?i)eruption\s+(.+)$", nm)
        short = m.group(1) if m else nm
    else:
        short = d["place"] or nm
    d["label"] = " ".join(x for x in ((d.get("class_jp") if typ == "TC" else None) or d.get("type_jp") or typ, short) if x)
    d["strength"] = disaster_strength(d)
    if typhoon_of and d.get("id") in typhoon_of:
        d["same_as"] = typhoon_of[d["id"]]          # 台風の層に同じ嵐がある（地図は二度描かない）
    return d



# ── USGS (world earthquakes) ──────────────────────────────────────────────

def parse_usgs(gj):
    out = []
    for f in (gj or {}).get("features") or []:
        p, g = f.get("properties") or {}, f.get("geometry") or {}
        c = g.get("coordinates") or []
        mag, tms = _num(p.get("mag")), _num(p.get("time"))
        if len(c) < 2 or mag is None or tms is None:
            continue
        pl = (p.get("place") or "").strip() or None
        out.append({"id": "usgs:%s" % f.get("id"),
                    "t": _iso(datetime.datetime.fromtimestamp(tms / 1000.0, datetime.timezone.utc)),
                    "lat": c[1], "lon": c[0], "depth_km": _num(c[2]) if len(c) > 2 else None, "mag": mag,
                    "place": quakeplace.ja(pl) or pl, "place_en": pl, "url": p.get("url"), "src": "USGS"})
    out.sort(key=lambda q: q["t"], reverse=True)
    return out[:USGS_MAX]


# ── all sources ──────────────────────────────────────────────────────────

def _epochify(o):
    if isinstance(o, dict):
        return {k: (int(_epoch(v)) if k in TIME_KEYS and isinstance(v, str) and _epoch(v) is not None else _epochify(v))
                for k, v in o.items()}
    if isinstance(o, list):
        return [_epochify(x) for x in o]
    return o


def fetch_all(now=None, get=None):
    """-> the dict that is written to data/hazards.json. Never raises; a failed source is a row in "sources".
    get: a replacement for _get_json (tests)."""
    global _get_json
    now = time.time() if now is None else now
    saved = _get_json
    if get is not None:
        _get_json = get
    try:
        got, srcs = {}, {}

        def run(name, fn):
            t0 = time.time()
            try:
                data, note = fn()
                got[name] = data
                srcs[name] = {"ok": True, "n": len(data), "err": "", "note": note or "", "fetched_at": int(t0)}
            except Exception as e:                      # a source that fails is reported, the others go on
                got[name] = None
                srcs[name] = {"ok": False, "n": 0, "err": _why(e), "note": "", "fetched_at": int(t0)}

        run("jma_typhoon", fetch_jma_typhoons)
        run("gdacs_tc", lambda: (parse_gdacs_tc_map(_get_json(GDACS_TC_MAP), now), None))
        run("gdacs_events", lambda: fetch_gdacs_events(now))
        run("jma_quake", lambda: fetch_jma_quakes({}))
        run("jma_tsunami", lambda: fetch_jma_tsunami({}, now))
        run("usgs", lambda: (parse_usgs(_get_json(USGS)), None))
    finally:
        _get_json = saved
    typhoons = [decorate_typhoon(t) for t in merge_typhoons(got["jma_typhoon"] or [], got["gdacs_tc"] or [])]
    typhoon_of = {}
    for t in typhoons:
        typhoon_of[t["id"]] = t["id"]
        for a in t.get("also") or []:
            typhoon_of[a.get("id")] = t["id"]
    disasters = [decorate_disaster(e, typhoon_of) for e in select_disasters(got["gdacs_events"] or [], now)]
    cut = now - QUAKE_DAYS * 86400
    quakes_jp = []
    for q in got["jma_quake"] or []:
        t = _epoch(q.get("t"))
        if t is not None and t >= cut:
            quakes_jp.append({k: v for k, v in q.items() if not k.startswith("_")})
    out = {"schema": SCHEMA, "generated_at": int(now), "ok": any(s["ok"] for s in srcs.values()),
           "sources": srcs, "typhoons": typhoons, "disasters": disasters, "quakes_jp": quakes_jp,
           "quakes_world": got["usgs"] or [], "tsunami": got["jma_tsunami"] or [],
           "rules": RULES, "attribution": ATTRIBUTION}
    return _epochify(out)
