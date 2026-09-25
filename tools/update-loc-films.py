#!/usr/bin/env python3
"""
Rebuilds data/loc-films.json from four Library of Congress film collections.

PrismTV ships this snapshot instead of calling the loc.gov API from the browser,
because loc.gov sits behind a Cloudflare bot check that blocks browser fetches from
some regions. The video and poster files (tile.loc.gov) are not affected.

    python3 tools/update-loc-films.py
"""
import json, os, sys, time, urllib.request

COLLECTIONS = {
    'screening': 'national-screening-room',
    'edison': 'edison-company-motion-pictures-and-sound-recordings',
    'animation': 'origins-of-american-animation',
    'war': 'spanish-american-war-in-motion-pictures',
}

def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'PrismTV/1.0 (personal use)'})
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(req, timeout=60))
        except Exception as err:
            print('  retry', attempt + 1, err, file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    raise SystemExit('Could not fetch ' + url)

def main():
    out = {}
    for key, slug in COLLECTIONS.items():
        items, page = [], 1
        while True:
            url = 'https://www.loc.gov/collections/%s/?fo=json&fa=online-format:video&c=100&sp=%d' % (slug, page)
            data = fetch(url)
            for r in data.get('results', []):
                res = next((x for x in r.get('resources', []) if x.get('video')), None)
                if not res:
                    continue
                img = res.get('image') or ''
                if img.startswith('//'):
                    img = 'https:' + img
                desc = ' '.join(r.get('description') or [])
                item = {'id': str(r.get('id') or res.get('url')).rstrip('/').split('/')[-1],
                        't': r.get('title'), 'v': res['video']}
                y = str(r.get('date') or '')[:4]
                if y.isdigit(): item['y'] = int(y)
                if img: item['i'] = img
                if desc: item['d'] = desc[:500]
                items.append(item)
            pg = data.get('pagination') or {}
            print('%s page %d: %d so far of %s' % (key, page, len(items), pg.get('of')), file=sys.stderr)
            if not pg.get('next'):
                break
            page += 1
            time.sleep(1.5)
        out[key] = items
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'loc-films.json')
    with open(path, 'w') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
    print('Wrote', {k: len(v) for k, v in out.items()}, 'to', os.path.normpath(path), file=sys.stderr)

if __name__ == '__main__':
    main()
