#!/usr/bin/env python3
"""
Builds data/health.json for the public website: every live-TV stream URL the site offers,
checked once, so "Hide channels that aren't working" works without serve.py.

Status codes (kept short; the file is ~20,000 entries):
  o  answers and allows browsers (CORS)          -> plays on the website
  n  answers but sends no CORS header            -> the website cannot play it (no relay there)
  f  refused (401/403/451, usually region-locked from the checker's location)
  d  dead (404, timeout, not a stream)

Run by the GitHub Pages workflow after tools/build-mirror.py. The checks run from GitHub's
servers (USA), so a few region-locked streams may differ from what viewers elsewhere see.

    python3 tools/build-health.py
"""
import json, os, re, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
ORIGIN = 'https://example.github.io'
TIMEOUT = 8
WORKERS = 128


def get(url, timeout=120):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=timeout).read().decode('utf-8', 'replace')


def playlist_urls(text):
    return [l.strip() for l in text.splitlines() if re.match(r'https?://', l.strip())]


def all_urls():
    urls = set()
    try:
        urls.update(s['url'] for s in json.loads(get('https://iptv-org.github.io/api/streams.json')) if s.get('url'))
    except Exception as err:
        print('iptv-org:', err, file=sys.stderr)
    try:
        urls.update(playlist_urls(get('https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8')))
    except Exception as err:
        print('Free-TV:', err, file=sys.stderr)
    mirror = os.path.join(ROOT, 'data', 'mirror')
    if os.path.isdir(mirror):
        for name in os.listdir(mirror):
            if name.endswith(('.m3u', '.m3u8')):
                urls.update(playlist_urls(open(os.path.join(mirror, name), encoding='utf-8', errors='replace').read()))
    return sorted(u for u in urls if not re.search(r'youtube\.com|youtu\.be|twitch\.tv', u))


def check(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*', 'Origin': ORIGIN})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            head = res.read(2048)
            ctype = (res.headers.get('Content-Type') or '').lower()
            cors = bool(res.headers.get('Access-Control-Allow-Origin'))
            playable = (head.lstrip().startswith(b'#EXTM3U') and b'#EXT' in head) or 'mpegurl' in ctype \
                or ctype.startswith(('video/', 'audio/')) or head[:1] == b'G'
            if not playable:
                return 'd'
            return 'o' if cors else 'n'
    except urllib.error.HTTPError as err:
        return 'f' if err.code in (401, 403, 451) else 'd'
    except Exception:
        return 'd'


def main():
    urls = all_urls()
    started = time.time()
    with ThreadPoolExecutor(WORKERS) as pool:
        codes = list(pool.map(check, urls))
    out = {'at': int(time.time()), 's': dict(zip(urls, codes))}
    path = os.path.join(ROOT, 'data', 'health.json')
    with open(path, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'))
    tally = {c: codes.count(c) for c in 'onfd'}
    print('%d streams checked in %ds: %s -> %s' % (len(urls), time.time() - started, tally, os.path.normpath(path)), file=sys.stderr)


if __name__ == '__main__':
    main()
