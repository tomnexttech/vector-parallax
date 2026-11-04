# -*- coding: utf-8 -*-
"""og — 記事の HTML の og:image を読む（CONTRACT §15・§20.5・§20.6）。標準ライブラリだけ。

画像は複製しない。持つのは URL だけ（頁が記事の元から直接読む）。RSS に画像が無い item のうち、頁の最初の画面と詳細に出る出来事
（stories の先頭 OG_MAX_STORIES 件）の分だけを読む。上限 OG_MAX_FETCH 件、同じ host へは OG_GAP_S 秒以上の間を空ける。
User-Agent は feeds.UA（既存）。失敗は item の image を触らない（null のまま）。getter・sleep・clock は試験用。
読むのは写真を出せる出来事だけ（2 媒体以上・事件事故でない・通信社の写真は選ばない: parallax/photo.py）。記事の頁の前に、その host の
robots.txt を読み（控えて 24 時間）、許されない host・読めない host は取りに行かない（§20.6）。
"""
import html
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser

try:
    from parallax import feeds
    from parallax import photo
except ImportError:                                  # parallax/ の中から直に走らせた時
    import feeds  # type: ignore
    import photo  # type: ignore

OG_MAX_FETCH = 40            # 1 回の build で記事の HTML を読む件数の上限
OG_MAX_STORIES = 30          # 先頭から数える出来事の数（最初の画面と詳細に出る分）
OG_PER_STORY = 3             # 1 出来事あたり、画像が見つかるまで試す item の数
OG_GAP_S = 1.0               # 同じ host への要求の間隔（秒）
OG_TIMEOUT_S = 10
OG_MAX_BYTES = 262144        # 読む HTML の先頭の大きさ（<head> は先頭にある）
ROBOTS_TOKEN = "VECTOR-PARALLAX"
ROBOTS_TTL_S = 86400         # robots.txt の控えの有効時間
ROBOTS_MAX_BYTES = 65536
ROBOTS_KEEP_BYTES = 16384    # 控えに残す robots.txt の先頭
ROBOTS_MAX_DELAY_S = 10.0
ROBOTS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "og_robots.json")

_META = re.compile(r"<meta\b[^>]*>", re.I)
_ATTR = re.compile(r"""([A-Za-z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""")
_PRIORITY = ("og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src")


def find_og_image(html_text, base):
    """HTML の <meta property="og:image" content="..."> から画像 URL（絶対）。無い・使えない時は ""。"""
    found = {}
    for m in _META.finditer((html_text or "")[:OG_MAX_BYTES]):
        a = {}
        for name, dq, sq, bare in _ATTR.findall(m.group(0)):
            a[name.lower()] = html.unescape(dq or sq or bare)
        key = (a.get("property") or a.get("name") or "").strip().lower()
        if key in _PRIORITY and a.get("content") and key not in found:
            found[key] = a["content"].strip()
    for key in _PRIORITY:
        if key in found:
            u = feeds.abs_url(found[key], base)
            if feeds.image_ok(u):
                return u
    return ""


def fetch_robots(origin):
    """origin（scheme://host）の /robots.txt -> (HTTP の状態, 本文)。通信の失敗は例外のまま。"""
    req = urllib.request.Request(origin + "/robots.txt", headers={"User-Agent": feeds.UA, "Accept": "text/plain,*/*"})
    try:
        with urllib.request.urlopen(req, timeout=OG_TIMEOUT_S, context=feeds._ctx) as r:
            return r.status, r.read(ROBOTS_MAX_BYTES).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""


class Robots:
    """host ごとの robots.txt を読んで控える（§20.6）。許されない host・読めない host は取りに行かない。
    404 などの 4xx は「規則なし」で許す。401・403・5xx・通信の失敗は許さない（読めない = 全部禁止として扱う）。通信の失敗は控えない。"""

    def __init__(self, fetch=None, path=None, now=time.time, ttl=ROBOTS_TTL_S):
        self.fetch, self.path, self.now, self.ttl = fetch, path, now, ttl
        self.hosts = {}                                   # origin -> {"at", "status", "body"}
        self.parsers = {}
        self.seen = set()
        self.stats = {"hosts": 0, "denied": 0, "unreachable": 0, "denied_hosts": []}
        self.dirty = False
        if path:
            try:
                with open(path, encoding="utf-8") as f:
                    d = json.load(f)
                if isinstance(d, dict) and isinstance(d.get("hosts"), dict):
                    self.hosts = {k: v for k, v in d["hosts"].items() if isinstance(v, dict)}
            except (OSError, ValueError):
                self.hosts = {}

    @classmethod
    def allow_all(cls):
        return cls(fetch=lambda origin: (404, ""))

    def save(self):
        if not (self.path and self.dirty):
            return
        keep = {k: v for k, v in self.hosts.items() if self.now() - v.get("at", 0) < 7 * self.ttl}
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            json.dump({"schema": "parallax-og-robots/1", "hosts": keep}, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, self.path)
        self.dirty = False

    def _entry(self, origin):
        e = self.hosts.get(origin)
        if e and self.now() - e.get("at", 0) < self.ttl:
            return e
        try:
            status, body = (self.fetch or fetch_robots)(origin)
        except Exception:                                  # 読めない: 控えず、この回は取りに行かない
            return {"at": self.now(), "status": 0, "body": "", "volatile": True}
        e = {"at": self.now(), "status": int(status), "body": (body or "")[:ROBOTS_KEEP_BYTES]}
        self.hosts[origin] = e
        self.dirty = True
        return e

    def _parser(self, origin, e):
        key = (origin, e["at"])
        p = self.parsers.get(key)
        if p is None:
            p = urllib.robotparser.RobotFileParser()
            p.parse(e["body"].splitlines())
            self.parsers[key] = p
        return p

    def check(self, url):
        """-> (許すか, 理由, 待ち秒)。理由: "" / "denied" / "unreachable"。"""
        u = urllib.parse.urlsplit(url)
        origin = "%s://%s" % (u.scheme, u.netloc.lower())
        e = self._entry(origin)
        if origin not in self.seen:
            self.seen.add(origin)
            self.stats["hosts"] += 1
            if e.get("volatile"):
                self.stats["unreachable"] += 1
        st = e["status"]
        if e.get("volatile") or st == 0:
            return False, "unreachable", 0.0
        if st in (401, 403) or st >= 500:
            self._deny(origin)
            return False, "denied", 0.0
        if st >= 400:
            return True, "", 0.0
        p = self._parser(origin, e)
        path = u.path or "/"
        if u.query:
            path += "?" + u.query
        if not p.can_fetch(ROBOTS_TOKEN, origin + path):
            self._deny(origin)
            return False, "denied", 0.0
        delay = p.crawl_delay(ROBOTS_TOKEN)
        return True, "", (min(float(delay), ROBOTS_MAX_DELAY_S) if delay else 0.0)

    def _deny(self, origin):
        host = urllib.parse.urlsplit(origin).netloc
        if host not in self.stats["denied_hosts"]:
            self.stats["denied"] += 1
            if len(self.stats["denied_hosts"]) < 50:
                self.stats["denied_hosts"].append(host)


def fetch_html(url):
    """記事の HTML の先頭（OG_MAX_BYTES）を取る。"""
    req = urllib.request.Request(url, headers={"User-Agent": feeds.UA, "Accept": "text/html,*/*"})
    with urllib.request.urlopen(req, timeout=OG_TIMEOUT_S, context=feeds._ctx) as r:
        raw = r.read(OG_MAX_BYTES)
    for enc in ("utf-8", "shift_jis", "euc_jp", "cp932"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def fill(stories, items, getter=None, max_fetch=OG_MAX_FETCH, max_stories=OG_MAX_STORIES, per_story=OG_PER_STORY,
         gap_s=OG_GAP_S, sleep=time.sleep, clock=time.monotonic, robots=None):
    """stories の先頭 max_stories 件のうち、写真を出せる出来事（2 媒体以上・事件事故でない: photo.eligible）で、どの item にも image が無い物について、
    item の記事の og:image を読んで item["image"] = {"url", "from": "og"} を入れる（items をその場で直す）。通信社の item は読まない。
    robots.txt が許さない host・読めない host は取りに行かない（§20.6）。
    -> {"stories","tried","found","failed","capped","skipped":{理由: 数},"robots_hosts","robots_denied","robots_unreachable","denied_hosts"}
    getter を渡した時（試験）は robots も通信しない（robots を渡せば使う）。"""
    get = getter or fetch_html
    if robots is None:
        robots = Robots.allow_all() if getter is not None else Robots(path=ROBOTS_PATH)
    last, out = {}, {"stories": 0, "tried": 0, "found": 0, "failed": 0, "capped": 0, "skipped": {}}
    for s in stories[:max_stories]:
        members = [items[i] for i in s.get("member_ids", []) if i in items]
        if any(m.get("image") for m in members):
            continue
        ok, why = photo.eligible(members, check_image=False)
        if not ok:
            out["skipped"][why] = out["skipped"].get(why, 0) + 1
            continue
        out["stories"] += 1
        for m in [x for x in members if x.get("type") not in photo.SKIP_TYPES][:per_story]:
            link = m.get("link") or ""
            if not link.lower().startswith(("http://", "https://")):
                continue
            if out["tried"] >= max_fetch:
                out["capped"] += 1
                break
            allowed, reason, delay = robots.check(link)
            if not allowed:
                out["skipped"][reason] = out["skipped"].get(reason, 0) + 1
                continue
            host = urllib.parse.urlsplit(link).netloc.lower()
            if host in last:
                wait = max(gap_s, delay) - (clock() - last[host])
                if wait > 0:
                    sleep(wait)
            out["tried"] += 1
            try:
                text = get(link)
            except Exception:                                 # 一つの失敗で全体を止めない。失敗は null のまま
                text = None
            last[host] = clock()
            url = find_og_image(text, link) if text else ""
            if url:
                m["image"] = {"url": url, "from": "og"}
                out["found"] += 1
                break
            out["failed"] += 1
    robots.save()
    out.update(robots_hosts=robots.stats["hosts"], robots_denied=robots.stats["denied"],
               robots_unreachable=robots.stats["unreachable"], denied_hosts=robots.stats["denied_hosts"])
    return out
