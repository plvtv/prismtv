/**
 * Movies from the Internet Archive (archive.org).
 *
 * Everything here talks to archive.org directly: its search and metadata APIs send
 * CORS headers, and films are plain MP4 files that a <video> element plays with
 * seeking, so neither hls.js nor the local relay is involved.
 *
 * Only items that have an MP4 derivative are searched for, so nearly every card plays.
 * Watch progress is kept in this browser for "Continue watching".
 */
import { overlayOpened, overlayClosed, renameOverlay, enableSwipeFullscreen } from './mobile.js';

const API = 'https://archive.org';
const PLAYABLE = '(format:"h.264" OR format:"MPEG4" OR format:"512Kb MPEG4")';
// Recent films in these collections are almost always someone's unlicensed upload, not public domain.
const BASE = 'mediatype:movies AND ' + PLAYABLE + ' AND NOT year:[1995 TO 2100]';
const FIELDS = ['identifier', 'title', 'year', 'downloads', 'creator'];
const ROW_SIZE = 40;
const PAGE = 48;
const PROGRESS_KEY = 'prismtv.movieProgress';

const F = 'collection:feature_films';
const ALL_FILMS = 'collection:(feature_films OR Film_Noir OR SciFi_Horror OR silent_films OR Comedy_Films)';
const EVERYTHING = 'collection:(feature_films OR Film_Noir OR SciFi_Horror OR silent_films OR Comedy_Films OR classic_cartoons OR vintage_cartoons OR animationandcartoons OR classic_tv)';
const sub = (terms) => F + ' AND subject:(' + terms + ')';

// Every row on the Movies page, and every choice in Browse's genre menu.
const GENRES = [
  { id: 'all', title: 'All films', q: ALL_FILMS, browseOnly: true },
  { id: 'toprated', title: 'Top rated', q: F + ' AND num_reviews:[8 TO *]', sort: 'avg_rating desc' },
  { id: 'popular', title: 'Most watched', q: F },
  { id: 'comedy', title: 'Comedy', q: '(collection:Comedy_Films OR (' + sub('comedy') + '))' },
  { id: 'drama', title: 'Drama', q: sub('drama') },
  { id: 'noir', title: 'Film noir', q: '(collection:Film_Noir OR (' + sub('"film noir"') + '))' },
  { id: 'mystery', title: 'Mystery & thriller', q: sub('mystery OR thriller OR suspense') },
  { id: 'scifi', title: 'Sci-fi', q: '((collection:SciFi_Horror AND subject:("science fiction" OR "sci-fi" OR scifi)) OR (' + sub('"science fiction" OR "sci-fi"') + '))' },
  { id: 'horror', title: 'Horror', q: '((collection:SciFi_Horror AND subject:horror) OR (' + sub('horror') + '))' },
  { id: 'western', title: 'Westerns', q: sub('western OR westerns') },
  { id: 'adventure', title: 'Adventure', q: sub('adventure') },
  { id: 'action', title: 'Action', q: sub('action') },
  { id: 'crime', title: 'Crime', q: sub('crime OR gangster OR gangsters') },
  { id: 'war', title: 'War', q: sub('war') },
  { id: 'romance', title: 'Romance', q: sub('romance OR romantic') },
  { id: 'musical', title: 'Musicals', q: sub('musical OR musicals') },
  { id: 'silent', title: 'Silent era', q: 'collection:silent_films' },
  { id: 'animated', title: 'Animated features', q: sub('animation OR animated') },
  { id: 'cartoons', title: 'Cartoons', q: 'collection:(classic_cartoons OR vintage_cartoons OR animationandcartoons)' },
  { id: 'tv', title: 'Classic TV', q: 'collection:classic_tv' },
  { id: 'docs', title: 'Documentaries', q: sub('documentary OR documentaries') },
  { id: 'ephemeral', title: 'Vintage educational films', q: 'collection:prelinger' },
  { id: 'gems', title: 'Hidden gems', q: F + ' AND num_reviews:[3 TO 7] AND avg_rating:[4.3 TO 5]' }
];
const GENRE = Object.fromEntries(GENRES.map((g) => [g.id, g]));
const ROWS = GENRES.filter((g) => !g.browseOnly);

const SORTS = [
  ['downloads desc', 'Most watched'],
  ['avg_rating desc', 'Top rated'],
  ['year asc', 'Oldest first'],
  ['year desc', 'Newest films first'],
  ['addeddate desc', 'Recently added'],
  ['titleSorter asc', 'A–Z']
];
const DECADES = [1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990];

/* ---------- more free, legitimate sources (picked from FMHY's lists) ----------
 * yt:<channelId>   an official YouTube channel that posts full films/episodes (data/youtube-free.json)
 * wd:<Qid>         a film on Wikimedia Commons, from a Wikidata snapshot (data/commons-films.json)
 * loc:<id>         a film in a Library of Congress collection (live API, CORS enabled)
 */
const COMMONS = 'https://commons.wikimedia.org/wiki/Special:FilePath/';
const LOC_COLLECTIONS = {
  screening: { slug: 'national-screening-room', title: 'Library of Congress: National Screening Room' },
  edison: { slug: 'edison-company-motion-pictures-and-sound-recordings', title: 'Library of Congress: Edison films (1891\u20131918)' },
  animation: { slug: 'origins-of-american-animation', title: 'Library of Congress: Origins of American animation' },
  war: { slug: 'spanish-american-war-in-motion-pictures', title: 'Library of Congress: Spanish\u2013American War on film' }
};
const YT_SECTIONS = {
  movies: 'Free movie channels on YouTube',
  tv: 'Full TV shows on YouTube',
  cartoons: 'Cartoon channels on YouTube',
  kids: 'Kids\u2019 channels on YouTube',
  docs: 'Documentary channels on YouTube',
  archives: 'Film archives on YouTube'
};
// Rows on the Movies page, in order. Archive.org genres are referenced by id.
const PAGE_ROWS = [
  'toprated', 'popular', { yt: 'movies' }, 'comedy', 'drama',
  { commons: null, title: 'Classics from Wikimedia Commons' },
  'noir', 'mystery', { yt: 'tv' }, 'scifi', 'horror', 'western',
  { loc: 'screening' }, 'adventure', 'action', 'crime', 'war',
  { commons: 'silent', title: 'Silent films from Wikimedia Commons' },
  'romance', 'musical', 'silent', { yt: 'cartoons' }, 'animated', 'cartoons',
  { commons: 'animation', title: 'Early animation from Wikimedia Commons' },
  { yt: 'kids' }, 'tv', 'docs', { yt: 'docs' },
  { commons: 'documentary', title: 'Documentaries & newsreels from Wikimedia Commons' },
  { yt: 'archives' }, { loc: 'edison' }, { loc: 'animation' }, { loc: 'war' },
  { commons: 'comedy', title: 'Comedy from Wikimedia Commons' },
  'ephemeral', 'gems',
  { commons: 'recent', title: 'Free-licensed modern films (Wikimedia Commons)' }
];

const EXT = new Map();   // wd:/loc: id -> playable item { id, title, year, sub, desc, src, link, poster }
let ytData = null;
let commonsData = null;

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(path + ' HTTP ' + res.status);
  return res.json();
}

async function youtubeChannels() {
  if (!ytData) ytData = loadJson('data/youtube-free.json');
  return ytData;
}
function ytDoc(c) {
  const doc = {
    identifier: 'yt:' + c.id, title: c.n, square: true, poster: c.img || null,
    creator: (c.lang ? c.lang + ' \u00b7 ' : '') + (c.note || 'YouTube channel'), channelNote: c.note
  };
  byId.set(doc.identifier, doc);
  return doc;
}

function daySeed(list, salt) {
  // Same order all day, different tomorrow: variety without reshuffling on every visit.
  let h = new Date().toISOString().slice(0, 10) + salt;
  let seed = 0;
  for (let i = 0; i < h.length; i++) seed = (seed * 31 + h.charCodeAt(i)) >>> 0;
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function commonsFilms(genre) {
  if (!commonsData) commonsData = loadJson('data/commons-films.json');
  const all = await commonsData;
  let list;
  if (genre === 'recent') list = all.filter((f) => f.y >= 1990).sort((a, b) => b.y - a.y);
  else if (genre) list = daySeed(all.filter((f) => (f.g || []).includes(genre)), genre);
  else list = daySeed(all.filter((f) => f.d && f.y), 'all');
  return list.map(commonsDoc);
}
function commonsDoc(f) {
  const id = 'wd:' + f.q;
  const file = encodeURIComponent(f.f.replace(/ /g, '_'));
  const item = {
    id, title: f.t, year: f.y || null, sub: [f.y, f.d].filter(Boolean).join(' \u00b7 '),
    desc: 'From Wikimedia Commons, Wikipedia\u2019s free media library.' +
      (f.d ? '\nDirected by ' + f.d + '.' : '') + (f.g ? '\nGenre: ' + f.g.join(', ') + '.' : ''),
    src: COMMONS + file, poster: COMMONS + file + '?width=360', commonsFile: f.f,
    link: 'https://commons.wikimedia.org/wiki/File:' + file, linkLabel: 'Open on Wikimedia Commons'
  };
  EXT.set(id, item);
  const doc = { identifier: id, title: f.t, year: f.y, creator: f.d, poster: item.poster };
  byId.set(id, doc);
  return doc;
}

// loc.gov's API sits behind a Cloudflare bot check that blocks browser requests from some
// regions, so the four collections ship as a snapshot (tools/update-loc-films.py).
// The films and posters themselves come from tile.loc.gov, which is not affected.
let locData = null;
async function locPage(key, page, rows = PAGE) {
  if (!locData) locData = loadJson('data/loc-films.json');
  const all = (await locData)[key] || [];
  const docs = all.slice((page - 1) * rows, page * rows).map((r) => {
    const id = 'loc:' + r.id;
    const year = r.y ? String(r.y) : null;
    const item = {
      id, title: r.t, year, sub: [year, 'Library of Congress'].filter(Boolean).join(' \u00b7 '),
      desc: r.d || '', src: r.v, poster: r.i || null,
      link: 'https://www.loc.gov/item/' + r.id + '/', linkLabel: 'Open at the Library of Congress'
    };
    EXT.set(id, item);
    const doc = { identifier: id, title: r.t, year, poster: r.i || null };
    byId.set(id, doc);
    return doc;
  });
  return { docs, total: all.length };
}

const el = {};
const byId = new Map();          // identifier -> search doc, for clicks on cards
let started = false;
let browse = { key: '', page: 1, total: 0, seen: new Set() };
let current = null;              // { id, title, files, part }
let saveTimer = 0;

/* ---------------- archive.org API ---------------- */
async function search(q, { sort = 'downloads desc', rows = ROW_SIZE, page = 1 } = {}) {
  const params = new URLSearchParams({ q: q + ' AND ' + BASE, rows: String(rows), page: String(page), output: 'json' });
  FIELDS.forEach((f) => params.append('fl[]', f));
  params.append('sort[]', sort);
  const res = await fetch(API + '/advancedsearch.php?' + params.toString());
  if (!res.ok) throw new Error('archive.org search returned HTTP ' + res.status);
  const data = await res.json();
  const docs = (data.response && data.response.docs) || [];
  for (const d of docs) byId.set(d.identifier, d);
  return { docs, total: (data.response && data.response.numFound) || 0 };
}

function fileUrl(id, name) {
  return API + '/download/' + encodeURIComponent(id) + '/' + name.split('/').map(encodeURIComponent).join('/');
}

/** Picks the playable video files of an item, best format first, parts in order. */
function pickFiles(files) {
  const ranks = [
    (f) => f.format === 'h.264' && /\.mp4$/i.test(f.name),
    (f) => f.format === 'h.264 IA' && /\.mp4$/i.test(f.name),
    (f) => /MPEG4/.test(f.format || '') && /\.mp4$/i.test(f.name),
    (f) => /\.mp4$/i.test(f.name),
    (f) => /\.(webm|ogv)$/i.test(f.name)
  ];
  for (const test of ranks) {
    const hit = files.filter(test);
    if (hit.length) return hit.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
  return [];
}

function plainText(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  return (doc.body.textContent || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function first(v) { return Array.isArray(v) ? v[0] : v; }

/** The same film is often uploaded several times; one card per title and year is enough. */
function filmKey(doc) {
  const title = String(first(doc.title) || doc.identifier).toLowerCase()
    .replace(/\s[-–|:]\s.*$/, ' ')                       // "Title - restored", "Title | 1080p"
    .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\b(19|20)\d\d\b/g, ' ')
    .replace(/\b(colou?rized|full|hd|sd|\d{3,4}p|restored|remastered|movie|film|english|ipod|flash|video|versions?|dvd\w*|rip|avi|mp4|upgrade|quality)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
  return title + ':' + (first(doc.year) || '');
}
function unique(docs, seen = new Set()) {
  return docs.filter((d) => {
    const k = filmKey(d);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ---------------- watch progress ---------------- */
function readProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); } catch { return {}; }
}
function writeProgress(all) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(all)); } catch { /* storage off: skip */ }
}
function saveProgress() {
  if (!current || !el.video.duration || !isFinite(el.video.duration)) return;
  const all = readProgress();
  const t = el.video.currentTime;
  const d = el.video.duration;
  const doneWatching = t > d - 90 && current.part === current.files.length - 1;
  if (doneWatching || t < 20) {
    if (doneWatching) delete all[current.id];
  } else {
    all[current.id] = { t, d, part: current.part, title: current.title, year: current.year || null, at: Date.now(),
      ...(current.ext ? { ext: current.ext, poster: current.ext.poster } : {}) };
  }
  writeProgress(all);
}
function continueDocs() {
  return Object.entries(readProgress())
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, ROW_SIZE)
    .map(([identifier, p]) => {
      if (p.ext) EXT.set(identifier, p.ext);
      const doc = { identifier, title: p.title, year: p.year, progress: p.t / p.d, poster: p.poster || null };
      if (!byId.has(identifier)) byId.set(identifier, doc);
      return doc;
    });
}

/* ---------------- cards and rows ---------------- */
function card(doc) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mcard';
  b.dataset.movie = doc.identifier;
  b.setAttribute('aria-label', (doc.title || doc.identifier) + (doc.year ? ' (' + doc.year + ')' : ''));

  const art = document.createElement('div');
  art.className = 'mcard-art';
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '';
  img.src = doc.poster || API + '/services/img/' + encodeURIComponent(doc.identifier);
  if (doc.square) { art.classList.add('mcard-square'); b.classList.add('mcard-yt'); }
  img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
  img.addEventListener('error', () => img.remove(), { once: true });
  const initials = document.createElement('span');
  initials.className = 'mcard-fallback';
  initials.textContent = String(doc.title || doc.identifier).slice(0, 42);
  art.append(initials, img);
  const go = document.createElement('span');
  go.className = 'mcard-go';
  go.innerHTML = '<svg class="i"><use href="#i-play"/></svg>';
  art.append(go);
  if (doc.square) {
    const badge = document.createElement('span');
    badge.className = 'lcard-badge';
    badge.textContent = 'YouTube';
    art.append(badge);
  }
  if (doc.progress) {
    const bar = document.createElement('i');
    bar.className = 'mcard-progress';
    bar.style.setProperty('--p', String(Math.min(1, doc.progress)));
    art.append(bar);
  }

  const meta = document.createElement('div');
  meta.className = 'mcard-meta';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = doc.title || doc.identifier;
  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = [first(doc.year), first(doc.creator)].filter(Boolean).join(' · ');
  meta.append(name, sub);
  b.append(art, meta);
  return b;
}

function row(title, docs, onMore = null) {
  const section = document.createElement('section');
  section.className = 'row mrow';
  const head = document.createElement('div');
  head.className = 'row-head';
  const h2 = document.createElement('h2');
  h2.textContent = title;
  head.append(h2);
  if (onMore) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'row-more';
    more.innerHTML = 'See all<svg class="i"><use href="#i-arrow"/></svg>';
    more.addEventListener('click', onMore);
    head.append(more);
  }
  const scroll = document.createElement('div');
  scroll.className = 'row-scroll';
  docs.forEach((d) => scroll.append(card(d)));
  const wrap = document.createElement('div');
  wrap.className = 'row-wrap';
  const arrow = (side) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'row-arrow ' + side;
    btn.setAttribute('aria-label', side === 'left' ? 'Scroll left' : 'Scroll right');
    btn.innerHTML = '<span><svg class="i"><use href="#i-arrow"/></svg></span>';
    const dir = side === 'left' ? -1 : 1;
    btn.addEventListener('click', () => scroll.scrollBy({ left: dir * Math.max(scroll.clientWidth * 0.86, 240), behavior: 'smooth' }));
    return btn;
  };
  const left = arrow('left');
  const right = arrow('right');
  const sync = () => {
    left.disabled = scroll.scrollLeft < 8;
    right.disabled = scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 8;
  };
  scroll.addEventListener('scroll', sync, { passive: true });
  wrap.addEventListener('pointerenter', sync);
  requestAnimationFrame(sync);
  wrap.append(left, scroll, right);
  section.append(head, wrap);
  return section;
}

function skeletonRow(title) {
  const section = row(title, []);
  const scroll = section.querySelector('.row-scroll');
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('div');
    s.className = 'mcard mcard-skel';
    s.innerHTML = '<div class="mcard-art"></div><div class="mcard-meta"><span class="name">&nbsp;</span></div>';
    scroll.append(s);
  }
  return section;
}

/** A page row as { title, first(): docs, grid(): spec for See all }. */
function rowSpec(r) {
  if (typeof r === 'string') {
    const g = GENRE[r];
    return {
      key: r, title: g.title,
      first: () => search(g.q, { sort: g.sort || 'downloads desc' }).then((x) => x.docs),
      more: () => openBrowse(r)
    };
  }
  if (r.yt) {
    const list = () => youtubeChannels().then((all) => all.filter((c) => c.s === r.yt).map(ytDoc));
    return {
      key: 'yt-' + r.yt, title: YT_SECTIONS[r.yt], first: () => list().then((d) => d.slice(0, ROW_SIZE)),
      more: () => openGrid({ title: YT_SECTIONS[r.yt], all: list })
    };
  }
  if ('commons' in r) {
    const list = () => commonsFilms(r.commons);
    return {
      key: 'wd-' + r.commons, title: r.title, first: () => list().then((d) => d.slice(0, ROW_SIZE)),
      more: () => openGrid({ title: r.title, all: list })
    };
  }
  const c = LOC_COLLECTIONS[r.loc];
  return {
    key: 'loc-' + r.loc, title: c.title, first: () => locPage(r.loc, 1, ROW_SIZE).then((x) => x.docs),
    more: () => openGrid({ title: c.title, page: (n) => locPage(r.loc, n) })
  };
}
const SPECS = PAGE_ROWS.map(rowSpec);
const SPEC_BY_KEY = Object.fromEntries(SPECS.map((x) => [x.key, x]));

function loadRow(spec, holder) {
  spec.first()
    .then((docs) => {
      if (!docs.length) { holder.remove(); return; }
      holder.replaceWith(row(spec.title, unique(docs), spec.more));
    })
    .catch(() => {
      holder.querySelector('.row-scroll').innerHTML = '<p class="mrow-err">Could not load this row right now.</p>';
    });
}

async function renderRows() {
  el.rows.innerHTML = '';
  const cont = continueDocs();
  if (cont.length) el.rows.append(row('Continue watching', cont));
  // Rows fetch as they come near the screen, so 22 rows never mean 22 requests at once.
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      loadRow(SPEC_BY_KEY[e.target.dataset.genre], e.target);
    }
  }, { rootMargin: '900px 0px' }) : null;
  for (const spec of SPECS) {
    const holder = skeletonRow(spec.title);
    holder.dataset.genre = spec.key;
    el.rows.append(holder);
    if (io) io.observe(holder); else loadRow(spec, holder);
  }
}

/* ---------------- search ---------------- */
function escapeQuery(text) {
  return text.replace(/[\\+\-!(){}[\]^"~*?:/]|&&|\|\|/g, ' ').replace(/\s+/g, ' ').trim();
}

function fillBrowseControls() {
  el.bGenre.innerHTML = GENRES.map((g) => '<option value="' + g.id + '">' + g.title + '</option>').join('');
  el.bDecade.innerHTML = '<option value="">Any year</option>' +
    DECADES.map((d) => '<option value="' + d + '">' + d + 's</option>').join('');
  el.bSort.innerHTML = SORTS.map(([v, label]) => '<option value="' + v + '">' + label + '</option>').join('');
}

/** Shows the full grid for a genre (from a row's "See all" or the Browse button). */
function openBrowse(genreId = 'all') {
  const g = GENRE[genreId] || GENRE.all;
  el.bGenre.value = g.id;
  el.bSort.value = g.sort || 'downloads desc';
  el.bDecade.value = '';
  el.search.value = '';
  runBrowse(false);
  el.section.scrollIntoView({ block: 'start' });
  window.scrollTo({ top: 0 });
}

/* A See-all grid for sources other than archive.org search: either a full local list
   (`all`) or a paged remote one (`page(n)`). */
let grid = null;
async function openGrid(spec) {
  grid = { ...spec, n: 0, total: 0, seen: new Set(), list: null };
  el.search.value = '';
  el.rows.hidden = true;
  el.results.hidden = false;
  el.results.classList.add('is-grid');
  el.browseBtn.hidden = true;
  el.grid.innerHTML = '';
  el.count.textContent = 'Loading\u2026';
  window.scrollTo({ top: 0 });
  await gridMore();
}
async function gridMore() {
  const g = grid;
  if (!g) return;
  g.n += 1;
  el.more.hidden = true;
  try {
    let docs;
    if (g.all) {
      if (!g.list) g.list = await g.all();
      g.total = g.list.length;
      docs = g.list.slice((g.n - 1) * PAGE, g.n * PAGE);
    } else {
      const r = await g.page(g.n);
      g.total = r.total;
      docs = r.docs;
    }
    if (grid !== g) return;
    unique(docs, g.seen).forEach((d) => el.grid.append(card(d)));
    const loaded = g.n * PAGE;
    el.count.textContent = g.total.toLocaleString() + ' title' + (g.total === 1 ? '' : 's') + ' \u00b7 ' + g.title;
    el.more.hidden = loaded >= g.total;
    el.more.textContent = 'Show more (' + Math.max(0, g.total - loaded).toLocaleString() + ' left)';
  } catch (err) {
    el.count.textContent = 'Could not load: ' + String(err.message || err);
  }
}

function closeBrowse() {
  grid = null;
  el.results.classList.remove('is-grid');
  el.search.value = '';
  el.results.hidden = true;
  el.rows.hidden = false;
  el.browseBtn.hidden = false;
}

async function runBrowse(more = false) {
  grid = null;
  el.results.classList.remove('is-grid');
  const text = escapeQuery(el.search.value.trim());
  const g = GENRE[el.bGenre.value] || GENRE.all;
  const decade = el.bDecade.value;
  const sort = el.bSort.value || 'downloads desc';
  const key = [text, g.id, decade, sort].join('|');
  if (!more || key !== browse.key) browse = { key, page: 1, total: 0, seen: new Set() };
  else browse.page += 1;

  el.rows.hidden = true;
  el.results.hidden = false;
  el.browseBtn.hidden = true;
  if (browse.page === 1) {
    el.grid.innerHTML = '';
    el.count.textContent = 'Loading from archive.org…';
  }
  el.more.hidden = true;

  let q = text && g.id === 'all' ? EVERYTHING : g.q;
  if (text) q += ' AND (' + text.split(' ').map((w) => 'title:(' + w + '*)').join(' AND ') + ')';
  if (decade) q += ' AND year:[' + decade + ' TO ' + (Number(decade) + 9) + ']';
  try {
    const { docs, total } = await search(q, { rows: PAGE, page: browse.page, sort });
    if (browse.key !== key) return;                 // filters changed while this was loading
    browse.total = total;
    unique(docs, browse.seen).forEach((d) => el.grid.append(card(d)));
    const loaded = browse.page * PAGE;
    const bits = [g.id === 'all' && text ? 'Everything' : g.title];
    if (decade) bits.push(decade + 's');
    if (text) bits.push('“' + el.search.value.trim() + '”');
    el.count.textContent = total
      ? total.toLocaleString() + ' title' + (total === 1 ? '' : 's') + ' · ' + bits.join(' · ')
      : 'Nothing found for ' + bits.join(' · ') + '. Try another decade or genre.';
    el.more.hidden = loaded >= total;
    el.more.textContent = 'Show more (' + Math.max(0, total - loaded).toLocaleString() + ' left)';
  } catch (err) {
    el.count.textContent = 'Could not reach archive.org. ' + String(err.message || err);
  }
}

/* ---------------- player ---------------- */
function setStatus(text) {
  el.status.textContent = text || '';
  el.status.hidden = !text;
}

function loadPart(i, resumeAt = 0) {
  current.part = i;
  el.parts.value = String(i);
  const f = current.files[i];
  el.video.src = f.url || fileUrl(current.id, f.name);
  el.video.currentTime = 0;
  setStatus('Loading…');
  el.video.addEventListener('loadedmetadata', () => {
    if (resumeAt > 0 && resumeAt < el.video.duration - 30) el.video.currentTime = resumeAt;
  }, { once: true });
  el.video.play().catch(() => setStatus(''));
}

let openYouTube = null;   // provided by app.js (the lesson player doubles as a YouTube player)
export function setYouTubeOpener(fn) { openYouTube = fn; }

/**
 * Commons keeps the uploaded original plus transcoded copies. Chrome cannot play Ogg Theora
 * originals, and some WebM originals are very large, so ask which copies exist and take the
 * best WebM up to 720p, else the original.
 */
async function commonsSource(file, fallback) {
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=videoinfo' +
    '&viprop=derivatives%7Curl%7Cmime%7Csize&titles=' + encodeURIComponent('File:' + file);
  try {
    const data = await loadJson(url);
    const page = Object.values((data.query && data.query.pages) || {})[0] || {};
    const vi = (page.videoinfo || [])[0];
    if (!vi) return fallback;
    const webm = (vi.derivatives || [])
      .filter((d) => /^video\/webm/.test(d.type || '') && (d.height || 0) <= 720)
      .sort((a, b) => (b.height || 0) - (a.height || 0));
    const originalWebm = /webm/.test(vi.mime || '');
    if (webm.length && (!originalWebm || (vi.height || 0) > 720 || (webm[0].height || 0) >= 480)) return webm[0].src;
    return originalWebm ? vi.url : (webm[0] ? webm[0].src : fallback);
  } catch {
    return fallback;
  }
}

function openExternal(item) {
  closeMovie(false);
  current = { id: item.id, title: item.title, year: item.year, files: [{ url: item.src }], part: 0, ext: item };
  el.root.hidden = false;
  overlayOpened('mplayer', () => closeMovie(true, true));
  document.body.classList.add('player-open');
  el.title.textContent = item.title;
  el.sub.textContent = item.sub || '';
  el.desc.textContent = item.desc || '';
  el.link.href = item.link;
  el.linkLabel.textContent = item.linkLabel || 'Open source page';
  el.parts.hidden = true;
  el.video.poster = item.poster || '';
  el.close.focus();
  const saved = readProgress()[item.id];
  if (item.commonsFile) {
    setStatus('Finding the best copy\u2026');
    commonsSource(item.commonsFile, item.src).then((src) => {
      if (!current || current.id !== item.id) return;
      current.files = [{ url: src }];
      loadPart(0, saved ? saved.t : 0);
    });
    return;
  }
  loadPart(0, saved ? saved.t : 0);
}

export async function openMovie(id) {
  if (id.startsWith('yt:')) {
    const d = byId.get(id) || {};
    // Hand the film player's Back-button entry over to the YouTube player instead of stacking another.
    if (current) { closeMovie(false, true); renameOverlay('mplayer', 'lplayer'); }
    if (openYouTube) openYouTube({ list: 'UU' + id.slice(5), title: d.title || 'YouTube channel', channel: d.channelNote || 'Official YouTube channel', thumb: null });
    return;
  }
  if (EXT.has(id)) { openExternal(EXT.get(id)); return; }
  if (/^(wd|loc):/.test(id)) return;
  const doc = byId.get(id) || { identifier: id };
  closeMovie(false);
  current = { id, title: doc.title || id, year: first(doc.year) || null, files: [], part: 0 };
  el.root.hidden = false;
  overlayOpened('mplayer', () => closeMovie(true, true));
  document.body.classList.add('player-open');
  el.title.textContent = current.title;
  el.sub.textContent = [first(doc.year), first(doc.creator)].filter(Boolean).join(' · ');
  el.desc.textContent = '';
  el.link.href = API + '/details/' + encodeURIComponent(id);
  el.linkLabel.textContent = 'Open on archive.org';
  el.parts.hidden = true;
  el.video.poster = API + '/services/img/' + encodeURIComponent(id);
  setStatus('Finding the film…');
  el.close.focus();

  let meta;
  try {
    const res = await fetch(API + '/metadata/' + encodeURIComponent(id));
    meta = await res.json();
  } catch {
    setStatus('Could not reach archive.org.');
    return;
  }
  if (!current || current.id !== id) return;
  const m = meta.metadata || {};
  current.title = first(m.title) || current.title;
  current.year = first(m.year) || (first(m.date) || '').slice(0, 4) || current.year;
  el.title.textContent = current.title;
  el.sub.textContent = [current.year, first(m.creator), first(m.runtime)].filter(Boolean).join(' · ');
  el.desc.textContent = plainText(first(m.description)).slice(0, 1800);

  current.files = pickFiles(meta.files || []);
  if (!current.files.length) {
    setStatus('This item has no video file a browser can play. Open it on archive.org instead.');
    return;
  }
  el.parts.innerHTML = '';
  current.files.forEach((f, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = 'Part ' + (i + 1) + ' of ' + current.files.length;
    el.parts.append(opt);
  });
  el.parts.hidden = current.files.length < 2;

  const saved = readProgress()[id];
  loadPart(saved ? Math.min(saved.part || 0, current.files.length - 1) : 0, saved ? saved.t : 0);
}

export function closeMovie(refocus = true, fromHistory = false) {
  if (!current) return;
  if (refocus && !fromHistory) overlayClosed('mplayer');
  saveProgress();
  el.video.pause();
  el.video.removeAttribute('src');
  el.video.load();
  current = null;
  el.root.hidden = true;
  document.body.classList.remove('player-open');
  if (refocus && !el.section.hidden) {
    const cont = el.rows.querySelector('.mrow');
    // refresh "Continue watching" so the film just left shows up there
    if (cont && !el.rows.hidden) renderContinueOnly();
  }
}

function renderContinueOnly() {
  const existing = [...el.rows.querySelectorAll('.mrow')].find((r) => r.querySelector('h2').textContent === 'Continue watching');
  const docs = continueDocs();
  const next = docs.length ? row('Continue watching', docs) : null;
  if (existing && next) existing.replaceWith(next);
  else if (existing) existing.remove();
  else if (next) el.rows.prepend(next);
}

/* ---------------- wiring ---------------- */
export function initMovies() {
  Object.assign(el, {
    section: document.getElementById('movies'),
    rows: document.getElementById('movies-rows'),
    results: document.getElementById('movies-results'),
    grid: document.getElementById('movies-grid'),
    count: document.getElementById('movies-count'),
    more: document.getElementById('movies-more'),
    search: document.getElementById('movies-search'),
    bGenre: document.getElementById('mb-genre'),
    bDecade: document.getElementById('mb-decade'),
    bSort: document.getElementById('mb-sort'),
    bBack: document.getElementById('mb-back'),
    browseBtn: document.getElementById('movies-browse-btn'),
    root: document.getElementById('mplayer'),
    video: document.getElementById('mvideo'),
    status: document.getElementById('mplayer-status'),
    title: document.getElementById('mplayer-title'),
    sub: document.getElementById('mplayer-sub'),
    desc: document.getElementById('mplayer-desc'),
    link: document.getElementById('mplayer-link'),
    linkLabel: document.getElementById('mplayer-link-label'),
    parts: document.getElementById('mplayer-parts'),
    close: document.getElementById('mplayer-close')
  });

  document.addEventListener('click', (e) => {
    const c = e.target.closest('.mcard[data-movie]');
    if (c) openMovie(c.dataset.movie);
  });
  let t;
  fillBrowseControls();
  el.search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      // Typing searches (inside the chosen genre/decade); clearing the box on the rows view goes back.
      if (!el.search.value.trim() && el.results.hidden) return;
      runBrowse(false);
    }, 350);
  });
  el.more.addEventListener('click', () => (grid ? gridMore() : runBrowse(true)));
  [el.bGenre, el.bDecade, el.bSort].forEach((n) => n.addEventListener('change', () => runBrowse(false)));
  el.bBack.addEventListener('click', closeBrowse);
  el.browseBtn.addEventListener('click', () => openBrowse('all'));

  el.close.addEventListener('click', () => closeMovie());
  enableSwipeFullscreen(el.video.parentElement, el.video.parentElement, () => el.video);
  el.root.addEventListener('mousedown', (e) => { if (e.target === el.root) closeMovie(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current && !document.fullscreenElement) closeMovie();
  });
  el.parts.addEventListener('change', () => loadPart(Number(el.parts.value)));

  el.video.addEventListener('playing', () => setStatus(''));
  el.video.addEventListener('waiting', () => setStatus('Buffering…'));
  el.video.addEventListener('canplay', () => { if (el.status.textContent === 'Buffering…') setStatus(''); });
  el.video.addEventListener('error', () => {
    if (current) setStatus('archive.org could not serve this file right now. Try again, or open it on archive.org.');
  });
  el.video.addEventListener('timeupdate', () => {
    if (Date.now() - saveTimer > 5000) { saveTimer = Date.now(); saveProgress(); }
  });
  el.video.addEventListener('ended', () => {
    if (current && current.part < current.files.length - 1) loadPart(current.part + 1);
    else saveProgress();
  });
  window.addEventListener('pagehide', saveProgress);
}

/** Called when the Movies tab is shown. Rows load once; later visits just refresh progress. */
export function showMovies() {
  if (!started) {
    started = true;
    renderRows();
  } else if (!el.rows.hidden) {
    renderContinueOnly();
  }
}
