#!/usr/bin/env python3
"""
Builds data/mirror/: copies of the lists a browser cannot fetch by itself (their hosts send
no CORS header), for the public website, which has no serve.py relay.

  * every playlist in FAST_PLAYLISTS and LG_URL (js/config.js)
  * the YouTube feeds behind Learn English's "New lessons" row (FEEDS in js/learn.js)

The app tries a source directly, then serve.py's relay, then data/mirror/<name>, so the same
code works at home and on the public site. The GitHub Pages workflow runs this daily.

    python3 tools/build-mirror.py
"""
import os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'data', 'mirror')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'


def mirror_name(url):
    """Must match mirrorName() in js/sources.js."""
    return re.sub(r'[^A-Za-z0-9._-]+', '_', re.sub(r'^https?://', '', url))[:150]


def sources():
    config = open(os.path.join(ROOT, 'js', 'config.js'), encoding='utf-8').read()
    learn = open(os.path.join(ROOT, 'js', 'learn.js'), encoding='utf-8').read()
    urls = re.findall(r"url: '(https?://[^']+\.m3u8?)'", config)
    urls += re.findall(r"LG_URL = '(https?://[^']+)'", config)
    feeds = learn[learn.index('const FEEDS'):learn.index('];', learn.index('const FEEDS'))]
    urls += ['https://www.youtube.com/feeds/videos.xml?channel_id=' + cid
             for cid in re.findall(r"id: '(UC[\w-]{20,})'", feeds)]
    return urls


def fetch(url):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            body = urllib.request.urlopen(req, timeout=60).read()
            if body.strip():
                return body
        except Exception as err:
            last = err
        time.sleep(2 * (attempt + 1))
    raise RuntimeError('%s: %s' % (url, last if 'last' in dir() else 'empty'))


def main():
    os.makedirs(OUT, exist_ok=True)
    urls = sources()
    ok = 0

    def one(url):
        body = fetch(url)
        with open(os.path.join(OUT, mirror_name(url)), 'wb') as fh:
            fh.write(body)
        return url, len(body)

    with ThreadPoolExecutor(6) as pool:
        for fut in [pool.submit(one, u) for u in urls]:
            try:
                url, size = fut.result()
                ok += 1
                print('ok   %7d  %s' % (size, url), file=sys.stderr)
            except Exception as err:
                print('FAIL %s' % err, file=sys.stderr)
    print('%d of %d mirrored into %s' % (ok, len(urls), os.path.normpath(OUT)), file=sys.stderr)


if __name__ == '__main__':
    main()
