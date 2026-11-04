#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""leakcheck — name-leak gate for this repository (standard library + the git binary).

Run it before every push:   python tools/leakcheck.py

It looks for words that must never reach the public repository, in
  1. every file git would put in a commit (tracked files, plus untracked files that are not ignored),
     and every file path;
  2. every commit message, author, committer, tag and branch name, and every file version in the history
     (skip the history scan with --no-history);
  3. Co-Authored-By trailers, and commits whose author or committer is not the expected one.

The word list is stored encoded below, so that this file does not itself contain the words it searches for.
To the fixed list it adds personal values read from the machine: the user.name and user.email of the
*global* git configuration (the repository's own configuration is ignored, it holds the public identity),
and the operating-system user name, plus any words listed in work/leakwords.txt (one per line; optional,
local only, so a real name can be added without writing it into the repository). The values are never printed: a finding shows only the place
(file:line, or commit id) and a label.

Two kinds of text in data/latest.json (CONTRACT section 17). The AI-written fields (STRICT_KEYS below: the headlines, focus lines, contrast
and flag notes, summaries and the run note) are written by this project, so a hit there is a finding like anywhere else. Every other string in
that file is a quotation of what the news feeds published (item titles, their links and image URLs, the words taken from them, the request
documents): a third party's wording, which this project does not choose. A hit there is COUNTED and printed, never a finding, so that a
scheduled build is not stopped by a headline that happens to contain a place name. parallax/build.py makes the same split before it
writes the file (it imports gate_counts from here). Every other file is scanned strictly.

Skipped: work/ (local scratch, ignored by git), .git, __pycache__, binary files (a NUL byte, or a known
binary extension; binaries are not scanned, check their metadata by hand if you add any).

Exit status: 0 = no findings, 1 = findings, 2 = the check could not run.
"""
import argparse
import base64
import getpass
import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Encoded so that this file does not contain the words (one per line; a space matches any run of
# whitespace, '_', '-' or '.', so "x y" also finds "x-y", "x_y" and "xy").
_WORDS_B64 = ("c295YQrlrpfosLcK5oOz5LmfCmlyb24gbWFuCm1hcnZlbApzdGFyawpqYXJ2aXMK"
              "ai5hLnIudi5pLnMKb3ZlcndhdGNo")

EXPECT_NAME = "VECTOR"
EXPECT_EMAIL = "tomnexttech@users.noreply.github.com"
# public identity values that may legitimately appear in the global configuration: never searched for
PUBLIC_VALUES = ("vector", "tomnexttech", "noreply")

SKIP_TOP = {"work", ".git", "__pycache__", "node_modules"}
BINARY_EXT = {".pyc", ".pyo", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf", ".zip", ".gz",
              ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".mov", ".7z", ".exe",
              ".dll", ".so", ".bin"}
COAUTHOR = re.compile(r"^\s*co-authored-by\s*:", re.I | re.M)


def _norm(s):
    return unicodedata.normalize("NFKC", s)


def _pattern(word):
    parts = [re.escape(p) for p in _norm(word).split(" ") if p]
    return re.compile(r"[\s_\-.]*".join(parts), re.I)


def fixed_patterns():
    words = base64.b64decode(_WORDS_B64).decode("utf-8").split("\n")
    return [("W%d" % (i + 1), _pattern(w)) for i, w in enumerate(w for w in words if w)]


def _git(args, cwd=None, env=None, check=False):
    try:
        r = subprocess.run(["git"] + args, cwd=str(cwd or ROOT), env=env, capture_output=True)
    except OSError:
        return None
    if check and r.returncode != 0:
        return None
    return r.stdout.decode("utf-8", errors="replace") if r.returncode == 0 else ""


def _global_value(key):
    for scope in ("--global", "--system"):
        v = _git(["config", scope, "--get", key])
        if v and v.strip():
            return v.strip()
    return ""


def personal_patterns():
    """Words taken from this machine. Never printed."""
    cands = []                                          # (label, text)
    name = _global_value("user.name")
    email = _global_value("user.email")
    if name:
        cands.append(("NAME", name))
        cands += [("NAME", t) for t in re.split(r"\s+", name) if t]
    if email:
        cands.append(("EMAIL", email))
        cands.append(("EMAIL", email.split("@")[0]))
    try:
        cands.append(("WINUSER", getpass.getuser()))
    except Exception:
        pass
    cands.append(("WINUSER", os.environ.get("USERNAME", "")))
    cands.append(("WINUSER", Path.home().name))
    extra = ROOT / "work" / "leakwords.txt"             # optional, local only (work/ is not committed): one word per line
    if extra.is_file():
        for line in extra.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.strip() and not line.lstrip().startswith("#"):
                cands.append(("EXTRA", line.strip()))
    out, seen = [], set()
    for label, text in cands:
        t = _norm(text).strip()
        if not t or t.lower() in seen:
            continue
        low = t.lower()
        if any(p in low for p in PUBLIC_VALUES):
            continue
        ascii_only = all(ord(c) < 128 for c in t)
        if len(t) < (4 if ascii_only else 2):          # too short to search for without noise
            continue
        seen.add(low)
        out.append((label, re.compile(re.escape(t), re.I)))
    return out


# A Hokkaido place name that is also one of the words: a railway line, a region, a cape, a strait. Since the headlines of the news feeds are
# published as quotations, such a compound can appear in data/latest.json. Only these compounds are let through; the bare word is still found.
# (Only the suffixes are written here; the word itself is decoded at run time, so this file does not contain it.)
_ALLOW_SUFFIXES = "本線|線|地方|岬|海峡|総合振興局|管内|支庁"
_allow_re = None


def _allow():
    global _allow_re
    if _allow_re is None:
        word = base64.b64decode(_WORDS_B64).decode("utf-8").split("\n")[1]
        _allow_re = re.compile(re.escape(_norm(word)) + "(?=" + _ALLOW_SUFFIXES + ")")
    return _allow_re


def scan_text(text, patterns):
    """-> list of (line_number, label). Line numbers only: the line itself is never returned."""
    hits = []
    for n, line in enumerate(text.splitlines() or [text], 1):
        s = _allow().sub(" ", _norm(line))
        for label, rx in patterns:
            if rx.search(s):
                hits.append((n, label))
    return hits


DATA_JSON = "data/latest.json"
# The fields in which this project writes the text itself (everything else in data/latest.json is quoted from the feeds).
STRICT_KEYS = ("headline_ja", "headline_en", "focus_ja", "contrast_ja", "flag_note_ja", "note_ja", "text_ja", "summary_ja")


def gate_counts(obj, patterns):
    """Split the hits of a parsed data/latest.json (a dict). -> (strict, quoted)
    strict: list of (json path, label), one per AI-written string that carries a word; quoted: the number of other string fields that do."""
    strict, quoted = [], [0]

    def walk(o, path, key):
        if isinstance(o, dict):
            for k, v in o.items():
                walk(v, "%s.%s" % (path, k) if path else str(k), str(k))
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, "%s[%d]" % (path, i), key)
        elif isinstance(o, str):
            hits = scan_text(o, patterns)
            if not hits:
                return
            if key in STRICT_KEYS:
                strict.extend((path, label) for label in sorted({lb for _, lb in hits}))
            else:
                quoted[0] += 1
    walk(obj, "", "")
    return strict, quoted[0]


def scan_blob(path, text, patterns):
    """-> (findings [(where, label)], quoted). data/latest.json is split by gate_counts; any other file is scanned line by line, strictly."""
    if path == DATA_JSON:
        try:
            obj = json.loads(text)
        except ValueError:
            obj = None
        if isinstance(obj, dict):
            return gate_counts(obj, patterns)
    return [(str(ln), label) for ln, label in scan_text(text, patterns)], 0


def is_binary(path, data):
    return Path(path).suffix.lower() in BINARY_EXT or b"\0" in data[:8192]


def list_files():
    """Paths git would commit. Falls back to a plain walk when git is missing."""
    if (ROOT / ".git").exists():
        out = _git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    else:
        out = None
        with tempfile.TemporaryDirectory() as td:        # let git read .gitignore without a repository here
            if _git(["init", "--bare", "-q", td], check=True) is not None:
                env = dict(os.environ, GIT_DIR=td, GIT_WORK_TREE=str(ROOT))
                out = _git(["ls-files", "-z", "--others", "--exclude-standard"], env=env)
    if out:
        return sorted({p for p in out.split("\0") if p})
    files = []
    for dp, dns, fns in os.walk(ROOT):
        dns[:] = [d for d in dns if d not in SKIP_TOP]
        files += [str(Path(dp, f).relative_to(ROOT)).replace(os.sep, "/") for f in fns]
    return sorted(files)


def check_files(patterns):
    """-> (findings, text files, quoted hits counted in data/latest.json)"""
    findings, n, quoted = [], 0, 0
    for rel in list_files():
        rel = rel.replace("\\", "/")
        if rel.split("/")[0] in SKIP_TOP:
            continue
        for _, label in scan_text(rel, patterns):
            findings.append("path %s [%s]" % (rel, label))
        p = ROOT / rel
        try:
            data = p.read_bytes()
        except OSError:
            continue
        if is_binary(rel, data):
            continue
        n += 1
        hits, q = scan_blob(rel, data.decode("utf-8", errors="replace"), patterns)
        quoted += q
        for where, label in hits:
            findings.append("%s:%s [%s]" % (rel, where, label))
    return findings, n, quoted


def check_history(patterns):
    """-> (findings, commits, blobs, quoted hits counted in the versions of data/latest.json)."""
    findings, quoted_total = [], 0
    fmt = "%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e"
    log = _git(["log", "--all", "--format=" + fmt])
    commits = [r.strip("\n") for r in (log or "").split("\x1e") if r.strip()]
    for rec in commits:
        sha, an, ae, cn, ce, body = (rec.split("\x1f") + [""] * 6)[:6]
        short = sha[:9]
        if an != EXPECT_NAME or cn != EXPECT_NAME or ae != EXPECT_EMAIL or ce != EXPECT_EMAIL:
            findings.append("commit %s author or committer is not the expected identity [AUTHOR]" % short)
        for field, text in (("author", an + " " + ae), ("committer", cn + " " + ce), ("message", body)):
            for _, label in scan_text(text, patterns):
                findings.append("commit %s %s [%s]" % (short, field, label))
        if COAUTHOR.search(body):
            findings.append("commit %s message has a Co-Authored-By line [COAUTHOR]" % short)
    refs = _git(["for-each-ref", "--format=%(refname)%1f%(contents)%1e"]) or ""
    for rec in refs.split("\x1e"):
        for _, label in scan_text(rec, patterns):
            findings.append("ref/tag [%s]" % label)
        if COAUTHOR.search(rec):
            findings.append("tag message has a Co-Authored-By line [COAUTHOR]")
    # every file version that ever existed
    blobs = 0
    objs = _git(["rev-list", "--objects", "--all"]) or ""
    path_of = {}
    for line in objs.splitlines():
        sha, _, path = line.partition(" ")
        if path:
            path_of.setdefault(sha, path)
    if path_of:
        shas = "\n".join(path_of) + "\n"
        types = subprocess.run(["git", "cat-file", "--batch-check=%(objectname) %(objecttype)"], cwd=str(ROOT),
                               input=shas.encode(), capture_output=True).stdout.decode().splitlines()
        blob_shas = [t.split()[0] for t in types if t.endswith(" blob")]
        if blob_shas:
            raw = subprocess.run(["git", "cat-file", "--batch"], cwd=str(ROOT),
                                 input=("\n".join(blob_shas) + "\n").encode(), capture_output=True).stdout
            pos = 0
            while pos < len(raw):
                nl = raw.index(b"\n", pos)
                parts = raw[pos:nl].split()
                if len(parts) < 3:
                    break
                sha, size = parts[0].decode(), int(parts[2])
                data = raw[nl + 1:nl + 1 + size]
                pos = nl + 1 + size + 1
                path = path_of.get(sha, "")
                if path.split("/")[0] in SKIP_TOP or is_binary(path, data):
                    continue
                blobs += 1
                hits, q = scan_blob(path, data.decode("utf-8", errors="replace"), patterns)
                quoted_total += q
                for where, label in hits:
                    findings.append("history %s:%s (object %s) [%s]" % (path, where, sha[:9], label))
    return findings, len(commits), blobs, quoted_total


def selftest(patterns):
    """Negative controls: the matcher must fire on planted words and stay quiet on plain text."""
    ws = base64.b64decode(_WORDS_B64).decode("utf-8").splitlines()
    full = lambda t: "".join(chr(ord(c) + 0xFEE0) if c.isalpha() and ord(c) < 128 else c for c in t)
    planted = []
    for w in ws:
        if not w:
            continue
        planted += [w, w.upper(), w.title(), "x " + w + " y", full(w)]
        if " " in w:
            planted += [w.replace(" ", "-"), w.replace(" ", "")]
    clean = ["VECTOR PARALLAX compares headlines.", "Copyright (c) 2026 VECTOR", "tomnexttech@users.noreply.github.com",
             "starting soon", "a plain sentence about news feeds"]
    missed = [t for t in planted if not scan_text(t, patterns)]
    noisy = [t for t in clean if scan_text(t, patterns)]
    place_ok = not scan_text(ws[1] + "本線の運転再開", patterns)           # the place-name compound passes ...
    bare_ok = bool(scan_text(ws[1] + "さんの話", patterns))                # ... the bare word does not
    word = ws[1]                                                              # the split of data/latest.json (section 17)
    q_obj = {"items": {"a": {"title": "x " + word + " y", "link": "https://example.org/a"}}, "stories": [{"ai": {"headline_en": "plain"}}]}
    s_obj = {"items": {"a": {"title": "plain"}}, "stories": [{"ai": {"headline_en": "x " + word + " y", "angles": [{"focus_ja": "plain"}]}}]}
    c_obj = {"stories": [{"ai": {"headline_ja": word + "本線の運転再開"}}]}
    split_ok = (gate_counts(q_obj, patterns) == ([], 1) and len(gate_counts(s_obj, patterns)[0]) == 1
                and gate_counts(s_obj, patterns)[1] == 0 and gate_counts(c_obj, patterns) == ([], 0))
    ok = not missed and not noisy and place_ok and bare_ok and split_ok
    print("selftest: %s (%d of %d planted spellings found, %d false hits on %d clean lines, place-name compound passes: %s, bare word found: %s, "
          "quoted field counted and AI field refused: %s)"
          % ("ok" if ok else "FAILED", len(planted) - len(missed), len(planted), len(noisy), len(clean), place_ok, bare_ok, split_ok))
    return ok


def main(argv=None):
    ap = argparse.ArgumentParser(description="Name-leak gate: files, commit messages, authors, history.")
    ap.add_argument("--no-history", action="store_true", help="scan only the files, not the git history")
    ap.add_argument("--selftest", action="store_true", help="run the matcher against planted words and exit")
    ap.add_argument("--fixed-only", action="store_true",
                    help="search only the fixed words, not the values read from this machine (for a CI runner, whose user name is not a secret)")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    fixed = fixed_patterns()
    personal = [] if a.fixed_only else personal_patterns()
    patterns = fixed + personal
    if a.selftest:
        return 0 if selftest(fixed) else 2
    findings, nfiles, quoted = check_files(patterns)
    commits = blobs = 0
    in_repo = (ROOT / ".git").exists()
    if in_repo and not a.no_history:
        hf, commits, blobs, hq = check_history(patterns)
        findings += hf
        quoted = (quoted, hq)
    for f in findings:
        print(f)
    if quoted != 0 and quoted != (0, 0):
        print("counted, not findings: %s quoted-field hit(s) in %s (the feeds' own wording; CONTRACT section 17)"
              % (quoted if isinstance(quoted, int) else "%d in the file, %d across its versions" % quoted, DATA_JSON))
    print("leakcheck: %d findings (%d text files%s; %d fixed words, %d personal values from this machine)"
          % (len(findings), nfiles,
             ", %d commits, %d file versions" % (commits, blobs) if in_repo and not a.no_history else ", no git history yet",
             len(fixed), len(personal)))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
