#!/usr/bin/env python3
"""
Builds data/youtube-live.json: for every YouTube link in the channel lists (iptv-org and
Free-TV), the channel ID that YouTube's embedded player needs to show that channel's live
stream inside PrismTV (https://www.youtube.com/embed/live_stream?channel=UC...).

Most lists give links like youtube.com/@name/live or /c/name/live, which a browser cannot
turn into a channel ID by itself (youtube.com sends no CORS header). Run daily by the
GitHub Pages workflow; at home the file is used the same way.

    python3 tools/build-youtube-live.py
"""
import json, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      'Accept-Language': 'en'}
YT = re.compile(r'https?://(?:www\.|m\.)?(?:youtube\.com|youtu\.be)/\S+', re.I)


def get(url, timeout=30):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read().decode('utf-8', 'replace')


def links():
    out = set()
    try:
        for s in json.loads(get('https://iptv-org.github.io/api/streams.json', 120)):
            if YT.match(s.get('url', '')):
                out.add(s['url'].strip())
    except Exception as err:
        print('iptv-org:', err, file=sys.stderr)
    try:
        for line in get('https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8', 60).splitlines():
            if YT.match(line.strip()):
                out.add(line.strip())
    except Exception as err:
        print('Free-TV:', err, file=sys.stderr)
    return sorted(out)


def resolve(url):
    if re.search(r'[?&]v=[\w-]{11}|youtu\.be/[\w-]{11}|/(live|embed)/[\w-]{11}(?:[/?]|$)', url):
        return url, None                      # a single video: the app embeds it directly
    m = re.search(r'/channel/(UC[\w-]{22})', url)
    if m:
        return url, m.group(1)
    page = re.sub(r'/(live|streams|videos|featured)/?(\?.*)?$', '', url.split('#')[0])
    try:
        html = get(page)
    except Exception:
        return url, None
    m = re.search(r'"externalId":"(UC[\w-]{22})"', html) or re.search(r'<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]{22})', html) \
        or re.search(r'"channelId":"(UC[\w-]{22})"', html)
    return url, (m.group(1) if m else None)


def main():
    urls = links()
    with ThreadPoolExecutor(12) as pool:
        pairs = list(pool.map(resolve, urls))
    out = {u: cid for u, cid in pairs if cid}
    path = os.path.join(ROOT, 'data', 'youtube-live.json')
    with open(path, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'), sort_keys=True)
    print('%d YouTube links, %d channel IDs resolved -> %s' % (len(urls), len(out), os.path.normpath(path)), file=sys.stderr)


if __name__ == '__main__':
    main()
