#!/usr/bin/env python3
"""
Rebuilds data/commons-films.json: films on Wikidata that have a full video on
Wikimedia Commons (the same data WikiFlix uses). The live query takes about a
minute, which is why PrismTV ships a snapshot instead of asking at runtime.

    python3 tools/update-commons-films.py
"""
import json, os, re, sys, urllib.parse, urllib.request

QUERY = '''SELECT ?film ?filmLabel (SAMPLE(?video) AS ?v) (MIN(YEAR(?d)) AS ?year)
  (GROUP_CONCAT(DISTINCT ?gl; separator="|") AS ?genres) (SAMPLE(?dirl) AS ?director) WHERE {
  ?film wdt:P31/wdt:P279* wd:Q11424; wdt:P10 ?video.
  FILTER(!CONTAINS(LCASE(STR(?video)), "trailer"))
  OPTIONAL { ?film wdt:P577 ?d. }
  OPTIONAL { ?film wdt:P136 ?g. ?g rdfs:label ?gl. FILTER(LANG(?gl)="en") }
  OPTIONAL { ?film wdt:P57 ?dir. ?dir rdfs:label ?dirl. FILTER(LANG(?dirl)="en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
} GROUP BY ?film ?filmLabel'''

GENRES = [('silent', 'silent'), ('animat|cartoon|anime', 'animation'),
          ('documentar|newsreel|propaganda|educational', 'documentary'), ('comedy|slapstick', 'comedy'),
          ('horror', 'horror'), ('science fiction|fantasy|fairy', 'fantasy'), ('western', 'western'),
          ('war', 'war'), ('crime|mystery|thriller|noir|detective', 'crime'), ('romance|romantic', 'romance'),
          ('musical|music', 'musical'), ('adventure|action|swashbuckler', 'adventure'), ('drama', 'drama')]

def main():
    url = 'https://query.wikidata.org/sparql?' + urllib.parse.urlencode({'query': QUERY})
    req = urllib.request.Request(url, headers={'Accept': 'application/sparql-results+json',
                                               'User-Agent': 'PrismTV/1.0 (personal use)'})
    print('Querying Wikidata (about a minute)...', file=sys.stderr)
    rows = json.load(urllib.request.urlopen(req, timeout=180))['results']['bindings']
    films, seen = [], set()
    for b in rows:
        title = b['filmLabel']['value']
        if re.match(r'^Q\d+$', title):
            continue
        f = urllib.parse.unquote(b['v']['value'].split('Special:FilePath/')[-1])
        if re.search(r'trailer|teaser|excerpt|clip\b', f, re.I):
            continue
        q = b['film']['value'].rsplit('/', 1)[-1]
        if q in seen:
            continue
        seen.add(q)
        gl = b.get('genres', {}).get('value', '').lower()
        g = []
        for pat, name in GENRES:
            if re.search(pat, gl) and name not in g:
                g.append(name)
        o = {'q': q, 't': title, 'f': f}
        if b.get('year'): o['y'] = int(b['year']['value'])
        if g: o['g'] = g
        if b.get('director'): o['d'] = b['director']['value']
        films.append(o)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'commons-films.json')
    with open(out, 'w') as fh:
        json.dump(films, fh, ensure_ascii=False, separators=(',', ':'))
    print('Wrote %d films to %s' % (len(films), os.path.normpath(out)), file=sys.stderr)

if __name__ == '__main__':
    main()
