# -*- coding: utf-8 -*-
"""ai — AI を呼ぶ層（標準ライブラリだけ）。docs/CONTRACT-public.md §4.5 のとおり。

provider は `name`・`model`・`call(system, user_text, schema) -> (raw_text | None, err_code)` を持つ。
  GeminiProvider    本物。鍵は `x-goog-api-key` の見出しにだけ置く（URL・ログ・例外の文に出さない）
  RecordedProvider  記録済みの答え（data/recorded.json の形）を sha256(user_text) で引く。無ければ "missing"
  FakeProvider      試験用。渡した関数の答えを返し、呼びを calls に控える

エラー符号: nokey auth quota blocked truncated http timeout network json shape missing budget
"""
import hashlib
import json
import re
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

ERROR_CODES = ("nokey", "auth", "quota", "blocked", "truncated", "http", "timeout", "network",
               "json", "shape", "missing", "budget")

_MODEL_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MAX_OUTPUT_TOKENS = 16384
RETRIES = 2                                   # やり直しは 2 回まで（計 3 回）
BACKOFF_BASE_S = 2.0                          # 2 秒、4 秒と倍に待つ
RETRY_CODES = ("quota", "http", "timeout", "network")   # 認証・形・遮断・途切れはやり直しても変わらない
_ROOT = Path(__file__).resolve().parent.parent
_messages = None


def error_message(code, lang="ja", prompt=None):
    """エラー符号 -> 利用者に見せる一文（data/prompt.json の error_messages）。無ければ符号をそのまま返す。"""
    global _messages
    table = (prompt or {}).get("error_messages")
    if table is None:
        if _messages is None:
            try:
                with open(_ROOT / "data" / "prompt.json", encoding="utf-8") as f:
                    _messages = json.load(f).get("error_messages", {})
            except (OSError, ValueError):
                _messages = {}
        table = _messages
    row = table.get(code)
    return row.get(lang) or row.get("en") or code if isinstance(row, dict) else code


def sha256_text(text):
    """user_text の指紋（UTF-8 の sha256 を 16 進で）。記録済みの答えの鍵。"""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def render_user_text(prompt, doc):
    """prompt.user_template の {DOC} を doc で置き換える。"""
    return prompt["user_template"].replace("{DOC}", doc)


# ---------------------------------------------------------------- 呼び数の上限（CONTRACT §13）
class CallBudget:
    """1 回の build で、用途ごとに provider が実際に送る呼びの数の上限。やり直し（再送）も 1 呼びと数える。
    take() が False になったら、その呼びは送らない（"budget"）。"""

    def __init__(self, limit):
        self.limit = max(0, int(limit))
        self.used = 0

    def take(self):
        if self.used >= self.limit:
            return False
        self.used += 1
        return True


def gate(provider):
    """provider に budget が付いていれば 1 呼び分を取る。取れなければ False。付いていなければ常に True。"""
    b = getattr(provider, "budget", None)
    return True if b is None else b.take()


# ---------------------------------------------------------------- 本物
def _default_transport(url, headers, body, timeout):
    """-> (status, body_text)。HTTP の 4xx/5xx も (status, text) で返す。接続の失敗・時間切れは例外。"""
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            text = e.read().decode("utf-8", "replace")
        except Exception:
            text = ""
        return e.code, text


HTTP_DETAILS = []   # 2xx でない返答の (型, 番号, 理由)。build が記録に出す（公開の記録に載るので鍵と長い数字は伏せる）


def _error_detail(text, key):
    """Gemini の誤りの本文から status と message の頭だけを取る。"""
    try:
        e = json.loads(text).get("error") or {}
        s = "%s %s" % (e.get("status") or "", e.get("message") or "")
    except Exception:
        s = text or ""
    if key:
        s = s.replace(key, "***")
    return re.sub(r"\d{6,}", "#", s).strip()[:200]


def _reply_text(outer):
    """Gemini の返答（JSON を読んだ物）から本文を取る。-> (text | None, err)"""
    if not isinstance(outer, dict):
        return None, "shape"
    pf = outer.get("promptFeedback")
    if isinstance(pf, dict) and pf.get("blockReason"):
        return None, "blocked"
    cands = outer.get("candidates")
    if not isinstance(cands, list) or not cands or not isinstance(cands[0], dict):
        return None, "shape"
    c = cands[0]
    fr = c.get("finishReason") or ""
    if isinstance(fr, str) and fr.startswith("MAX_"):
        return None, "truncated"
    if fr in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"):
        return None, "blocked"
    content = c.get("content")
    parts = content.get("parts") if isinstance(content, dict) else None
    if not isinstance(parts, list):
        return None, "shape"
    text = "".join(p["text"] for p in parts
                   if isinstance(p, dict) and isinstance(p.get("text"), str) and not p.get("thought"))
    if not text.strip():
        return None, "shape"
    return text, ""


class GeminiProvider:
    """鍵は引数で渡す（この層は環境変数を読まない。build.choose_provider が渡す）。

    transport は試験用の差し替え口: transport(url, headers, body_bytes, timeout) -> (status, text)。
    """
    name = "gemini"

    budget = None

    def __init__(self, key, model, timeout=90, transport=None, max_output_tokens=DEFAULT_MAX_OUTPUT_TOKENS,
                 retries=RETRIES, sleep=time.sleep, budget=None):
        key = (key or "").strip()
        if not key:
            raise ValueError("nokey")
        if not _MODEL_RE.match(model or ""):
            raise ValueError("badmodel")
        self._key = key                      # 外へ出さない（repr にも出さない）
        self.model = model
        self.timeout = timeout
        self._transport = transport or _default_transport
        self.max_output_tokens = int(max_output_tokens)
        self.retries = max(0, int(retries))
        self._sleep = sleep
        self.budget = budget                 # CallBudget | None。やり直しも 1 呼びに数える（CONTRACT §13）

    def __repr__(self):
        return "GeminiProvider(model=%r)" % self.model

    def build_request(self, system, user_text, schema):
        """-> (url, headers, body_bytes)。鍵は headers にだけ入る。"""
        url = GEMINI_ENDPOINT.format(model=self.model)
        headers = {"Content-Type": "application/json", "x-goog-api-key": self._key}
        body = {
            "contents": [{"role": "user", "parts": [{"text": user_text}]}],
            "systemInstruction": {"parts": [{"text": system}]},
            "generationConfig": {"responseMimeType": "application/json",
                                 "responseSchema": schema, "temperature": 0,
                                 "maxOutputTokens": self.max_output_tokens},
        }
        return url, headers, json.dumps(body, ensure_ascii=False).encode("utf-8")

    def call(self, system, user_text, schema):
        """やり直しは RETRY_CODES の時だけ、最大 RETRIES 回、BACKOFF_BASE_S * 2**n 秒待って。
        budget があれば、やり直しも 1 呼びに数え、上限に達したらそこで止める（最後の本物の誤りを返す）。"""
        raw, err = self._call_once(system, user_text, schema)
        for n in range(self.retries):
            if err not in RETRY_CODES:
                break
            if self.budget is not None and self.budget.used >= self.budget.limit:
                break
            self._sleep(BACKOFF_BASE_S * (2 ** n))
            raw2, err2 = self._call_once(system, user_text, schema)
            if err2 == "budget":
                break
            raw, err = raw2, err2
        return raw, err

    def _call_once(self, system, user_text, schema):
        if not gate(self):
            return None, "budget"
        url, headers, body = self.build_request(system, user_text, schema)
        try:
            status, text = self._transport(url, headers, body, self.timeout)
        except (socket.timeout, TimeoutError):
            return None, "timeout"
        except urllib.error.URLError as e:
            return None, "timeout" if isinstance(getattr(e, "reason", None), (socket.timeout, TimeoutError)) else "network"
        except OSError:
            return None, "network"
        except Exception:
            return None, "network"
        if not (200 <= status < 300):
            HTTP_DETAILS.append((self.model, status, _error_detail(text, self._key)))
        if status in (401, 403):
            return None, "auth"
        if status == 429:
            return None, "quota"
        if not (200 <= status < 300):
            return None, "http"
        try:
            outer = json.loads(text)
        except ValueError:
            return None, "json"
        raw, err = _reply_text(outer)
        return (raw, "") if raw is not None else (None, err)


# ---------------------------------------------------------------- 記録済み
class RecordedProvider:
    """記録済みの答え。data は {"version","provider","model","made_at","note_ja","responses":{sha256: raw}}。"""

    def __init__(self, data):
        if not isinstance(data, dict) or not isinstance(data.get("responses"), dict):
            raise ValueError("recorded file has no responses")
        self.data = data
        self.name = data.get("provider") or "claude-recorded"
        self.model = data.get("model") or None
        self.made_at = data.get("made_at") if isinstance(data.get("made_at"), int) else None
        self.note_ja = data.get("note_ja") if isinstance(data.get("note_ja"), str) else ""
        self._responses = data["responses"]
        self.budget = None
        sr = data.get("summary_responses")
        self._summary_responses = sr if isinstance(sr, dict) else {}

    @classmethod
    def from_file(cls, path):
        with open(path, encoding="utf-8") as f:
            return cls(json.load(f))

    def call(self, system, user_text, schema):
        if not gate(self):
            return None, "budget"
        raw = self._responses.get(sha256_text(user_text))
        if not isinstance(raw, str):
            return None, "missing"
        return raw, ""

    @property
    def has_summaries(self):
        return bool(self._summary_responses)

    def summary_view(self):
        """要約の段の provider。`summary_responses`（sha256 -> 答え）を引く。`summary` に provider・model・made_at・note_ja が
        あればそれを、無ければ全体の物を名乗る。要約の記録が無ければ None。"""
        if not self.has_summaries:
            return None
        meta = self.data.get("summary") if isinstance(self.data.get("summary"), dict) else {}
        return RecordedSummaryProvider(self._summary_responses, meta.get("provider") or self.name, meta.get("model") or self.model,
                                       meta.get("made_at") if isinstance(meta.get("made_at"), int) else self.made_at,
                                       meta.get("note_ja") if isinstance(meta.get("note_ja"), str) else self.note_ja)


class RecordedSummaryProvider:
    """記録済みの要約の答え。Claude の要約と Gemini の要約を混ぜないため、名前（provider）は記録の持ち主のまま出す。"""

    def __init__(self, responses, name, model, made_at, note_ja):
        self._responses = responses
        self.name, self.model, self.made_at, self.note_ja = name, model, made_at, note_ja
        self.budget = None

    def call(self, system, user_text, schema):
        if not gate(self):
            return None, "budget"
        raw = self._responses.get(sha256_text(user_text))
        if not isinstance(raw, str):
            return None, "missing"
        return raw, ""


# ---------------------------------------------------------------- 偽（試験用）
class FakeProvider:
    """responder(system, user_text, schema) の返り値を答えにする。
    str -> その文字列、dict/list -> json.dumps、(raw, err) -> そのまま、None -> (None, "network")。
    responder が例外 FakeError(code) を投げれば (None, code)。呼びは calls に控える。"""
    name = "fake"
    model = "fake"

    def __init__(self, responder, budget=None):
        self.responder = responder
        self.calls = []
        self.budget = budget

    def call(self, system, user_text, schema):
        if not gate(self):
            return None, "budget"
        self.calls.append({"system": system, "user_text": user_text, "schema": schema})
        try:
            r = self.responder(system, user_text, schema) if callable(self.responder) else self.responder
        except FakeError as e:
            return None, e.code
        if r is None:
            return None, "network"
        if isinstance(r, tuple):
            return r
        if isinstance(r, str):
            return r, ""
        return json.dumps(r, ensure_ascii=False), ""


class FakeError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code
