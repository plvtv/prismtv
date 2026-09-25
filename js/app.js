import {
  ROW_CATEGORIES, SPOTLIGHT_COUNTRIES, HERO_COUNT, HERO_ROTATE_MS, PAGE_SIZE, MAX_ROW_ITEMS
} from './config.js';
import { loadDataset, indexDataset, rankForDisplay, daySeededShuffle, clearCache } from './data.js';
import { SOURCE_KEY, COUNTRY_ALIASES } from './config.js';
import { myList, watchHistory } from './store.js';
import { createRow, createHero, renderGrid, channelSubtitle, toast } from './ui.js';
import { initPlayer, openPlayer } from './player.js';
import { initMovies, showMovies, setYouTubeOpener } from './movies.js';
import { initLearn, showLearn, learnChannel, openYouTube } from './learn.js';
import { loadHealth, startScan, watchScan, channelHealth, streamUrls, knownCount, health } from './health.js';

const dom = {
  boot: document.getElementById('boot'),
  bootFill: document.getElementById('boot-fill'),
  bootNote: document.getElementById('boot-note'),
  topbar: document.getElementById('topbar'),
  main: document.getElementById('main'),
  hero: document.getElementById('hero'),
  rows: document.getElementById('rows'),
  browse: document.getElementById('browse'),
  browseTitle: document.getElementById('browse-title'),
  browseGrid: document.getElementById('browse-grid'),
  browseCount: document.getElementById('browse-count'),
  browseMore: document.getElementById('browse-more'),
  search: document.getElementById('search-input'),
  refresh: document.getElementById('refresh-btn'),
  fCategory: document.getElementById('f-category'),
  fCountry: document.getElementById('f-country'),
  fLanguage: document.getElementById('f-language'),
  fLogo: document.getElementById('f-logo'),
  fReset: document.getElementById('f-reset'),
  region: document.getElementById('region-select'),
  source: document.getElementById('source-select'),
  filtersWrap: document.querySelector('.filters'),
  movies: document.getElementById('movies'),
  learn: document.getElementById('learn'),
  hideDead: document.getElementById('hide-dead'),
  healthNote: document.getElementById('health-note'),
  healthScan: document.getElementById('health-scan')
};

let dataset = null;
let index = null;
let heroCtl = null;
let view = 'home';
let pageLimit = PAGE_SIZE;
let pickersWired = false;

/* ---------------- which index are we browsing ---------------- */
function sourcePref() {
  try { return localStorage.getItem(SOURCE_KEY) || 'both'; } catch { return 'both'; }
}

/** The channel pool for the current source choice. Free-TV first: it is curated. */
function activeChannels() {
  const iptv = dataset.channels || [];
  const free = dataset.freetv || [];
  const shovo = dataset.shovo || [];
  const lg = dataset.lg || [];
  const fast = dataset.fast || [];
  const pref = sourcePref();
  if (pref === 'iptv-org') return iptv;
  if (pref === 'freetv') return free;
  if (pref === 'shovo') return shovo;
  if (pref === 'lg') return lg;
  if (pref === 'fast') return fast;
  return free.concat(iptv, shovo, lg, fast);
}

/* ---------------- hide channels that are not working ---------------- */
const HIDE_KEY = 'prismtv.hideDead';
function hideDeadPref() {
  try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
}
let hiddenCount = 0;

function allChannels() {
  return (dataset.freetv || []).concat(dataset.channels || [], dataset.shovo || [], dataset.lg || [], dataset.fast || []);
}

function ago(sec) {
  const m = Math.round((Date.now() / 1000 - sec) / 60);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  return h < 48 ? h + 'h ago' : Math.round(h / 24) + ' days ago';
}

function renderHealthNote() {
  const h = health();
  dom.healthScan.disabled = !h.available || h.running;
  dom.hideDead.disabled = !h.available;
  if (!h.available) {
    dom.healthNote.textContent = 'Only available when PrismTV runs from serve.sh on your own computer.';
  } else if (h.running) {
    const pct = h.total ? Math.round((h.done / h.total) * 100) : 0;
    dom.healthNote.textContent = 'Checking streams\u2026 ' + h.done.toLocaleString() + ' of ' +
      h.total.toLocaleString() + ' (' + pct + '%). You can keep watching.';
  } else if (!knownCount()) {
    dom.healthNote.textContent = 'Not checked yet. Turning this on checks every stream from this computer (a few minutes).';
  } else {
    dom.healthNote.textContent = 'Checked ' + (health().finished ? ago(health().finished) : 'earlier') +
      (hideDeadPref() ? ' \u00b7 ' + hiddenCount.toLocaleString() + ' channels hidden' : '') + '.';
  }
}

function refreshView() {
  rebuildIndex();
  buildFilters();
  buildRegionPicker();
  pageLimit = PAGE_SIZE;
  if (view === 'home') renderHome(); else if (view !== 'movies' && view !== 'learn') renderBrowse();
  renderHealthNote();
}

async function scanAll({ force = false } = {}) {
  try {
    await startScan(streamUrls(allChannels()), { force });
  } catch (err) {
    toast(String(err.message || err));
    return;
  }
  renderHealthNote();
  if (!health().running) { refreshView(); return; }
  toast('Checking every stream in the background \u2014 channels will be hidden as results come in.');
  let lastRefresh = Date.now();
  watchScan(() => {
    renderHealthNote();
    // Re-render occasionally, not on every tick, so the page does not jump under the viewer.
    if (hideDeadPref() && Date.now() - lastRefresh > 60000) { lastRefresh = Date.now(); refreshView(); }
  }, () => {
    if (hideDeadPref()) {
      refreshView();
      toast('Check finished \u2014 ' + hiddenCount.toLocaleString() + ' channels with no working stream hidden.');
    } else {
      renderHealthNote();
      toast('Check finished.');
    }
  });
}

dom.hideDead.addEventListener('change', () => {
  try { localStorage.setItem(HIDE_KEY, dom.hideDead.checked ? '1' : '0'); } catch { /* ignore */ }
  if (dom.hideDead.checked && !health().running) scanAll();   // checks only unchecked or stale streams
  refreshView();
  if (!dom.hideDead.checked) toast('Showing every channel again.');
});
dom.healthScan.addEventListener('click', () => scanAll({ force: true }));

function rebuildIndex() {
  const pool = activeChannels();
  const shown = hideDeadPref() ? pool.filter((c) => channelHealth(c) !== 'dead') : pool;
  hiddenCount = pool.length - shown.length;
  index = indexDataset(dataset, shown);
  // Saved and recently watched channels stay reachable even when hidden from the rows.
  index.byId = new Map(pool.map((c) => [c.id, c]));
}

function buildSourcePicker() {
  const free = (dataset.freetv || []).length;
  const iptv = (dataset.channels || []).length;
  const shovo = (dataset.shovo || []).length;
  const lg = (dataset.lg || []).length;
  const fast = (dataset.fast || []).length;
  dom.source.options[0].textContent = 'All indexes \u00b7 ' + (free + iptv + shovo + lg + fast).toLocaleString();
  dom.source.options[1].textContent = 'iptv-org \u00b7 ' + iptv.toLocaleString();
  dom.source.options[2].textContent = 'Free-TV \u00b7 ' + free.toLocaleString();
  dom.source.options[3].textContent = 'Shovo extras \u00b7 ' + shovo.toLocaleString();
  dom.source.options[3].hidden = shovo === 0;   // not on the public website
  dom.source.options[4].textContent = 'LG Channels \u00b7 ' + lg.toLocaleString();
  dom.source.options[5].textContent = 'Free streaming TV \u00b7 ' + fast.toLocaleString();
  dom.source.value = sourcePref();
  dom.source.disabled = free === 0 && shovo === 0 && lg === 0;
  if (pickersWired) return;
  dom.source.addEventListener('change', () => {
    try { localStorage.setItem(SOURCE_KEY, dom.source.value); } catch { /* ignore */ }
    rebuildIndex();
    buildFilters();
    buildRegionPicker();
    pageLimit = PAGE_SIZE;
    toast(index.channels.length.toLocaleString() + ' channels from ' +
      (dom.source.value === 'both' ? 'all indexes' : dom.source.value));
    if (view === 'home') renderHome(); else if (view !== 'movies' && view !== 'learn') renderBrowse();
  });
}

/* ---------------- boot ---------------- */
function setProgress(fraction, label) {
  dom.bootFill.style.width = Math.round(Math.max(0.06, fraction) * 100) + '%';
  if (label) dom.bootNote.textContent = label;
}

async function boot({ force = false } = {}) {
  try {
    const { dataset: data, fromCache } = await loadDataset({ force, onProgress: setProgress });
    dataset = data;
    await loadHealth();
    dom.hideDead.checked = hideDeadPref() && health().available;
    rebuildIndex();
    setProgress(1, 'Ready');
    buildFilters();
    buildSourcePicker();
    buildRegionPicker();
    pickersWired = true;
    renderHome();
    updatePrefsLabel();
    renderHealthNote();
    // Keep verdicts fresh: a running scan is picked up, stale entries are rechecked quietly.
    if (health().available && (health().running || dom.hideDead.checked)) scanAll();
    dom.main.hidden = false;
    dom.boot.classList.add('out');
    setTimeout(() => { dom.boot.hidden = true; }, 600);
    if (!fromCache) {
      const free = (dataset.freetv || []).length;
      const shovo = (dataset.shovo || []).length;
      toast(dataset.channels.length.toLocaleString() + ' channels from iptv-org' +
        (free ? ' + ' + free.toLocaleString() + ' from Free-TV' : '') +
        (shovo ? ' + ' + shovo.toLocaleString() + ' from Shovo' : '') +
        ((dataset.lg || []).length ? ' + ' + dataset.lg.length.toLocaleString() + ' from LG Channels' : '') +
        ((dataset.fast || []).length ? ' + ' + dataset.fast.length.toLocaleString() + ' free streaming TV' : '') + '.');
    }
  } catch (err) {
    console.error('PrismTV boot failed:', err);
    dom.bootNote.innerHTML =
      'Could not reach the channel index.<br>' + String(err.message || err) +
      '<br><small>Check your connection, then reload.</small>';
  }
}

/* ---------------- home ---------------- */
const REGION_KEY = 'prismtv.region';

function localeCountry() {
  try {
    const raw = new Intl.Locale(navigator.language || 'en-US').maximize().region;
    const region = COUNTRY_ALIASES[raw] || raw;
    return region && index.byCountry.has(region) && dataset.countries[region] ? region : null;
  } catch { return null; }
}

/** The country whose channels get top billing. Chosen by the viewer, or from the browser locale. */
function viewerCountry() {
  let saved = null;
  try { saved = localStorage.getItem(REGION_KEY); } catch { /* ignore */ }
  if (saved && index.byCountry.has(saved) && dataset.countries[saved]) return saved;
  return localeCountry();
}

function buildRegionPicker() {
  const auto = localeCountry();
  const options = [
    '<option value="">Region: auto' + (auto ? ' (' + dataset.countries[auto].flag + ' ' + dataset.countries[auto].name + ')' : '') + '</option>'
  ];
  const countries = [...index.byCountry.entries()]
    .map(([code, list]) => ({ code, count: list.length, meta: dataset.countries[code] }))
    .filter((c) => c.meta && c.count >= 5)
    .sort((a, b) => a.meta.name.localeCompare(b.meta.name));
  for (const c of countries) {
    options.push('<option value="' + c.code + '">' + c.meta.flag + ' ' + c.meta.name + '</option>');
  }
  dom.region.innerHTML = options.join('');
  let saved = null;
  try { saved = localStorage.getItem(REGION_KEY); } catch { /* ignore */ }
  dom.region.value = saved && index.byCountry.has(saved) && dataset.countries[saved] ? saved : '';
  if (pickersWired) return;
  dom.region.addEventListener('change', () => {
    try { localStorage.setItem(REGION_KEY, dom.region.value); } catch { /* ignore */ }
    const code = viewerCountry();
    toast(code ? 'Top billing: ' + dataset.countries[code].name : 'Using your browser region');
    if (view === 'home') renderHome(); else if (view !== 'movies' && view !== 'learn') renderBrowse();
  });
}

function renderHome() {
  // Hero: well-known-looking channels with artwork and several sources.
  const heroPool = daySeededShuffle(
    index.channels.filter((c) => c.logo && c.streams.length > 1 && !c.streams[0].restricted && !c.geo && !c.external)
  ).slice(0, HERO_COUNT);
  if (heroCtl) heroCtl.stop();
  heroCtl = createHero(heroPool, dataset, play, toggleList, HERO_ROTATE_MS);

  dom.rows.innerHTML = '';
  const frag = document.createDocumentFragment();

  const historyChannels = watchHistory.ids().map((id) => index.byId.get(id)).filter(Boolean);
  if (historyChannels.length) {
    frag.append(createRow('Continue watching', historyChannels, dataset, 'on this device'));
  }

  const listChannels = myList.ids().map((id) => index.byId.get(id)).filter(Boolean);
  if (listChannels.length) {
    frag.append(createRow('My List', listChannels, dataset, '', () => setView('mylist')));
  }

  const home = viewerCountry();
  if (home) {
    const local = rankForDisplay(index.byCountry.get(home) || []);
    frag.append(createRow('Popular in ' + dataset.countries[home].name, daySeededShuffle(local.slice(0, 120)), dataset, '',
      () => openBrowseWith({ country: home })));
  }

  for (const catId of ROW_CATEGORIES) {
    const pool = index.byCategory.get(catId);
    if (!pool || pool.length < 8) continue;
    const ranked = rankForDisplay(pool);
    const withArt = ranked.filter((c) => c.logo);
    const picks = daySeededShuffle((withArt.length >= MAX_ROW_ITEMS ? withArt : ranked).slice(0, 150));
    const name = dataset.categories[catId]?.name || catId;
    frag.append(createRow(name, picks, dataset, pool.length.toLocaleString() + ' channels',
      () => openBrowseWith({ category: catId })));
  }

  for (const code of SPOTLIGHT_COUNTRIES) {
    if (code === home) continue;
    const pool = index.byCountry.get(code);
    if (!pool || pool.length < 10) continue;
    const ranked = rankForDisplay(pool).filter((c) => c.logo);
    if (ranked.length < 8) continue;
    const country = dataset.countries[code];
    if (!country) { console.warn('No country record for spotlight code', code); continue; }
    frag.append(createRow(country.flag + '  ' + country.name, daySeededShuffle(ranked.slice(0, 120)), dataset, '',
      () => openBrowseWith({ country: code })));
  }

  dom.rows.append(frag);
}

/* ---------------- filters + browse/search ---------------- */
function buildFilters() {
  const catOptions = ['<option value="">All categories</option>'];
  for (const [id, cat] of Object.entries(dataset.categories)) {
    const count = index.byCategory.get(id)?.length || 0;
    if (!count) continue;
    catOptions.push('<option value="' + id + '">' + cat.name + ' (' + count + ')</option>');
  }
  dom.fCategory.innerHTML = catOptions.join('');

  const countries = [...index.byCountry.entries()]
    .map(([code, list]) => ({ code, list, meta: dataset.countries[code] }))
    .filter((x) => x.meta)
    .sort((a, b) => a.meta.name.localeCompare(b.meta.name));
  dom.fCountry.innerHTML = '<option value="">All countries</option>' +
    countries.map((c) => '<option value="' + c.code + '">' + c.meta.flag + ' ' + c.meta.name + ' (' + c.list.length + ')</option>').join('');

  const langs = [...index.byLanguage.entries()]
    .filter(([, list]) => list.length >= 12)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 80);
  dom.fLanguage.innerHTML = '<option value="">All languages</option>' +
    langs.map(([code, list]) => '<option value="' + code + '">' + code.toUpperCase() + ' (' + list.length + ')</option>').join('');
}

function currentFilters() {
  return {
    q: dom.search.value.trim().toLowerCase(),
    category: dom.fCategory.value,
    country: dom.fCountry.value,
    language: dom.fLanguage.value,
    logoOnly: dom.fLogo.checked
  };
}

function applyFilters() {
  const f = currentFilters();
  let pool = index.channels;
  if (f.category) pool = index.byCategory.get(f.category) || [];
  if (f.country) pool = pool.filter((c) => c.country === f.country);
  if (f.language) {
    const allowed = new Set((index.byLanguage.get(f.language) || []).map((c) => c.id));
    pool = pool.filter((c) => allowed.has(c.id));
  }
  if (f.logoOnly) pool = pool.filter((c) => c.logo);
  if (f.q) {
    const q = f.q;
    pool = pool.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      const country = c.country && dataset.countries[c.country];
      if (country && country.name.toLowerCase().includes(q)) return true;
      return c.categories.some((cat) => cat.includes(q));
    });
    pool = pool.slice().sort((a, b) => {
      const ai = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bi = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return ai - bi || a.name.length - b.name.length;
    });
  } else {
    pool = rankForDisplay(pool);
  }
  return pool;
}

function browseHeading(f) {
  const cat = f.category && dataset.categories[f.category];
  const country = f.country && dataset.countries[f.country];
  if (cat && country) return cat.name + ' \u00b7 ' + country.name;
  if (cat) return cat.name;
  if (country) return country.flag + ' ' + country.name;
  return 'Browse';
}

function openBrowseWith({ category = '', country = '' } = {}) {
  dom.search.value = '';
  dom.fCategory.value = category;
  dom.fCountry.value = country;
  dom.fLanguage.value = '';
  setView('browse');
}

function renderBrowse(titleOverride) {
  const f = currentFilters();
  let results;
  if (view === 'mylist') {
    results = myList.ids().map((id) => index.byId.get(id)).filter(Boolean);
    dom.filtersWrap.hidden = true;
  } else {
    results = applyFilters();
    dom.filtersWrap.hidden = false;
  }
  dom.browseTitle.textContent = titleOverride ||
    (view === 'mylist' ? 'My List' : f.q ? 'Results for “' + dom.search.value.trim() + '”' : browseHeading(f));
  dom.browseCount.textContent = results.length
    ? results.length.toLocaleString() + ' channel' + (results.length === 1 ? '' : 's') +
      (view === 'mylist' ? ' saved on this device' : ' with a playable source')
    : (view === 'mylist' ? 'Nothing saved yet — hit “+ My List” on any channel.' : '');
  renderGrid(dom.browseGrid, results, dataset, pageLimit);
  dom.browseMore.hidden = results.length <= pageLimit;
}

/* ---------------- view switching ---------------- */
function setView(next, titleOverride) {
  view = next;
  pageLimit = PAGE_SIZE;
  const isHome = next === 'home';
  const isMovies = next === 'movies';
  const isLearn = next === 'learn';
  dom.hero.hidden = !isHome;
  dom.rows.hidden = !isHome;
  dom.browse.hidden = isHome || isMovies || isLearn;
  dom.movies.hidden = !isMovies;
  dom.learn.hidden = !isLearn;
  if (isHome) renderHome();
  else if (isMovies) showMovies();
  else if (isLearn) showLearn();
  else renderBrowse(titleOverride);
  const shown = isHome ? dom.rows : isMovies ? dom.movies : isLearn ? dom.learn : dom.browse;
  shown.classList.remove('view-enter');
  void shown.offsetWidth;
  shown.classList.add('view-enter');
  document.querySelectorAll('.nav-link').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.view === next || (next === 'search' && b.dataset.view === 'browse'));
  });
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

/* ---------------- actions ---------------- */
function play(channel) {
  openPlayer(channel, { subtitle: channelSubtitle(channel, dataset) });
}

/** The \u201cUp next\u201d rail: same category first, then same country, then a wider mix. */
function relatedFor(channel) {
  const seen = new Set([channel.id]);
  const out = [];
  const take = (pool, group, limit) => {
    if (!pool) return;
    let added = 0;
    for (const c of pool) {
      if (added >= limit) break;
      if (seen.has(c.id) || !c.streams.length) continue;
      seen.add(c.id);
      out.push({ channel: c, subtitle: channelSubtitle(c, dataset), group });
      added += 1;
    }
  };

  for (const catId of channel.categories.slice(0, 2)) {
    const name = dataset.categories[catId]?.name || catId;
    const pool = rankForDisplay(index.byCategory.get(catId) || []);
    const sameCountry = pool.filter((c) => c.country === channel.country);
    take(daySeededShuffle(sameCountry.slice(0, 60)), 'More ' + name, 10);
    take(daySeededShuffle(pool.slice(0, 120)), 'More ' + name, 8);
  }

  if (channel.country) {
    const country = dataset.countries[channel.country];
    const pool = rankForDisplay(index.byCountry.get(channel.country) || []);
    take(daySeededShuffle(pool.slice(0, 120)), country ? 'From ' + country.name : 'Same country', 12);
  }

  const list = myList.ids().map((id) => index.byId.get(id)).filter(Boolean);
  take(list, 'From My List', 8);

  take(daySeededShuffle(index.channels.filter((c) => c.logo).slice(0, 4000)), 'Elsewhere', 10);
  return out;
}

function toggleList(id) {
  const added = myList.toggle(id);
  toast(added ? 'Added to My List' : 'Removed from My List');
  refreshCardBadges();
  return added;
}

function refreshCardBadges() {
  document.querySelectorAll('.card').forEach((card) => {
    const art = card.querySelector('.art');
    const existing = art.querySelector('.fav');
    const should = myList.has(card.dataset.id);
    if (should && !existing) {
      const fav = document.createElement('span');
      fav.className = 'fav';
      fav.textContent = '✓';
      art.append(fav);
    } else if (!should && existing) {
      existing.remove();
    }
  });
}

/* ---------------- wiring ---------------- */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

document.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (card && index) {
    const channel = index.byId.get(card.dataset.id) || learnChannel(card.dataset.id);
    // Cards on the Learn English page are listening practice: start captions with the stream.
    if (channel) openPlayer(channel, { subtitle: channelSubtitle(channel, dataset), captions: Boolean(card.closest('#learn')) });
  }
});

document.querySelectorAll('.nav-link').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.view !== 'browse') dom.search.value = '';
    setView(btn.dataset.view);
  });
});

dom.search.addEventListener('input', debounce(() => {
  const q = dom.search.value.trim();
  if (!q && view === 'search') { setView('home'); return; }
  if (q) { view = 'search'; setView('search'); }
}, 220));

[dom.fCategory, dom.fCountry, dom.fLanguage, dom.fLogo].forEach((node) => {
  node.addEventListener('change', () => { pageLimit = PAGE_SIZE; renderBrowse(); });
});

dom.fReset.addEventListener('click', () => {
  dom.fCategory.value = '';
  dom.fCountry.value = '';
  dom.fLanguage.value = '';
  dom.fLogo.checked = true;
  pageLimit = PAGE_SIZE;
  renderBrowse();
});

dom.browseMore.addEventListener('click', () => {
  pageLimit += PAGE_SIZE;
  renderBrowse();
});

dom.refresh.addEventListener('click', async () => {
  dom.refresh.classList.add('spin');
  await clearCache();
  dom.boot.hidden = false;
  dom.boot.classList.remove('out');
  dom.main.hidden = true;
  setProgress(0.05, 'Refreshing channel index…');
  await boot({ force: true });
  dom.refresh.classList.remove('spin');
});

window.addEventListener('scroll', () => {
  dom.topbar.classList.toggle('solid', window.scrollY > 40);
}, { passive: true });

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== dom.search) {
    e.preventDefault();
    dom.search.focus();
  }
});

/* ---------------- preferences popover ---------------- */
const prefsBtn = document.getElementById('prefs-btn');
const prefsPanel = document.getElementById('prefs-panel');
const prefsLabel = document.getElementById('prefs-label');

function setPrefsOpen(open) {
  prefsPanel.hidden = !open;
  prefsBtn.setAttribute('aria-expanded', String(open));
}

function updatePrefsLabel() {
  if (!dataset || !index) return;
  const src = { both: 'All indexes', 'iptv-org': 'iptv-org', freetv: 'Free-TV', shovo: 'Shovo', lg: 'LG Channels', fast: 'Free streaming TV' }[dom.source.value] || 'All indexes';
  const code = viewerCountry();
  const flag = code && dataset.countries[code] ? dataset.countries[code].flag + '  ' : '';
  prefsLabel.textContent = flag + src;
}

prefsBtn.addEventListener('click', () => setPrefsOpen(prefsPanel.hidden));
document.addEventListener('pointerdown', (e) => {
  if (!prefsPanel.hidden && !e.target.closest('#prefs')) setPrefsOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !prefsPanel.hidden) { setPrefsOpen(false); prefsBtn.focus(); }
});
dom.source.addEventListener('change', updatePrefsLabel);
dom.region.addEventListener('change', updatePrefsLabel);

// The wordmark is a way home, not a hash link.
document.querySelector('.brand').addEventListener('click', (e) => {
  e.preventDefault();
  dom.search.value = '';
  setView('home');
});

initPlayer({
  onFavourite: () => { refreshCardBadges(); toast('My List updated'); },
  getRelated: relatedFor
});
boot();

initMovies();
setYouTubeOpener((item) => openYouTube(item, { learning: false }));

/* ---------------- Learn English: live-TV practice rows ---------------- */
const ENGLISH_COUNTRIES = new Set(['US', 'UK', 'AU', 'CA', 'IE', 'NZ']);
const PRACTICE = [
  { title: 'Practice: news in English', cats: ['news', 'weather', 'business'], note: 'Captions start automatically' },
  { title: 'Practice: documentaries', cats: ['documentary', 'science', 'travel', 'outdoor', 'cooking'] },
  { title: 'Practice: easy listening for learners', cats: ['kids', 'animation', 'education', 'family'] }
];
function practiceRows() {
  if (!index) return [];
  const pool = index.channels.filter((c) => ENGLISH_COUNTRIES.has(c.country) && !c.external);
  return PRACTICE.map((p) => ({
    title: p.title,
    note: p.note || '',
    channels: rankForDisplay(pool.filter((c) => c.categories.some((k) => p.cats.includes(k)))).slice(0, 32)
  }));
}
initLearn({ getPractice: practiceRows, channelRow: (title, channels, note) => createRow(title, channels, dataset, note) });

/* ---------------- Random ----------------
 * Movies tab: a random film from the rows. Learn tab: a random lesson or practice channel.
 * Everywhere else: a random live channel, preferring ones the health check found working.
 */
const randomBtn = document.getElementById('random-btn');
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
/** The channels Random draws from: what the current page is showing. */
function randomPool() {
  if (view === 'browse' || view === 'search') return applyFilters();       // Browse filters + search
  if (view === 'mylist') return myList.ids().map((id) => index.byId.get(id)).filter(Boolean);
  return index.channels;
}
function randomChannel() {
  if (!index) return null;
  const pool = randomPool().filter((c) => !c.external && !c.geo && c.streams.length);
  const working = pool.filter((c) => channelHealth(c) === 'ok');
  // Checked-and-working channels when there are enough of them, else anything not known dead.
  const from = working.length >= Math.min(50, Math.ceil(pool.length / 4)) && working.length
    ? working : pool.filter((c) => channelHealth(c) !== 'dead');
  return from.length ? pick(from) : null;
}
/** "Kids", "Kids · United Kingdom", "“bbc”", "My List" or '' for the toast. */
function randomScope() {
  if (view === 'mylist') return 'My List';
  if (view === 'search' && dom.search.value.trim()) return '\u201c' + dom.search.value.trim() + '\u201d';
  if (view !== 'browse') return '';
  const h = browseHeading(currentFilters());
  return h === 'Browse' ? '' : h.replace(/^\p{Regional_Indicator}{2}\s*/u, '');
}
function spin(btn) {
  btn.classList.remove('roll');
  void btn.offsetWidth;
  btn.classList.add('roll');
  setTimeout(() => btn.classList.remove('roll'), 520);
}
const isOpen = (id) => !document.getElementById(id).hidden;
function randomCard(selector, skip) {
  const cards = [...document.querySelectorAll(selector)].filter((c) => !skip || (c.dataset.id || c.dataset.movie) !== skip);
  if (!cards.length) return false;
  pick(cards).click();
  return true;
}
function playRandom(from = randomBtn) {
  spin(from);
  // Inside a player: stay in that kind of player.
  if (isOpen('mplayer') && randomCard('#movies .mcard[data-movie]')) return;
  if (isOpen('lplayer') && randomCard(view === 'movies' ? '#movies .mcard-yt[data-movie]' : '#learn .lcard')) return;
  if (isOpen('player')) {
    const now = document.getElementById('player-name').textContent;
    // From Learn English: another practice channel, captions on.
    if (view === 'learn' && randomCard('#learn .card')) return;
    for (let i = 0; i < 5; i++) {
      const c = randomChannel();
      if (c && c.name !== now) { toast('Random' + (randomScope() ? ' (' + randomScope() + ')' : '') + ': ' + c.name); play(c); return; }
    }
  }
  if (view === 'movies') {
    if (randomCard('#movies .mcard[data-movie]')) return;
    toast('Films are still loading \u2014 try again in a moment.');
    return;
  }
  if (view === 'learn') {
    // Learn English: a random lesson, never an unrelated live channel.
    if (randomCard('#learn .lcard')) return;
    toast('Lessons are still loading \u2014 try again in a moment.');
    return;
  }
  const channel = randomChannel();
  const scope = randomScope();
  if (!channel) {
    toast(scope ? 'No playable channels match ' + scope + '. Try loosening the filters.' : 'No channels to pick from yet.');
    return;
  }
  toast('Random' + (scope ? ' (' + scope + ')' : '') + ': ' + channel.name);
  play(channel);
}
randomBtn.addEventListener('click', () => playRandom(randomBtn));
document.querySelectorAll('.js-random').forEach((b) => b.addEventListener('click', () => playRandom(b)));
document.addEventListener('keydown', (e) => {
  if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !e.altKey &&
      !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) {
    const inPlayer = ['player', 'mplayer', 'lplayer'].find(isOpen);
    playRandom(inPlayer ? document.querySelector('#' + inPlayer + ' .js-random') : randomBtn);
  }
});

/* ---------------- watch on another device ----------------
 * serve.py --lan lets phones, tablets and TVs on the home Wi-Fi open this page.
 * The panel shows the address (and a QR code for phones), or how to switch that mode on.
 */
const shareBtn = document.getElementById('share-btn');
const sharePanel = document.getElementById('share-panel');
const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
let qrLoading = null;
function loadQr() {
  if (window.QRCode) return Promise.resolve();
  if (!qrLoading) {
    qrLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = QR_LIB;
      s.onload = resolve;
      s.onerror = reject;
      document.head.append(s);
    });
  }
  return qrLoading;
}
function escapeHtml(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
async function renderShare() {
  sharePanel.innerHTML = '<p>Checking\u2026</p>';
  let info = null;
  try {
    const res = await fetch('/api/info', { cache: 'no-store' });
    if (res.ok) info = await res.json();
  } catch { /* not served by serve.py */ }

  if (!info) {
    // Public website (no serve.py): share this page's own address.
    const here = location.origin + location.pathname;
    sharePanel.innerHTML = '<p>Share this link with friends. It opens on any phone, tablet, TV or computer:</p>' +
      '<div class="share-url"><code>' + escapeHtml(here) + '</code>' +
      '<button class="icon-btn" type="button" data-copy="' + escapeHtml(here) + '" aria-label="Copy link"><svg class="i"><use href="#i-link"/></svg></button></div>' +
      '<div class="share-qr" id="share-qr"></div>';
    sharePanel.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(here); toast('Link copied'); } catch { toast(here); }
    });
    try {
      await loadQr();
      new window.QRCode(document.getElementById('share-qr'), { text: here, width: 168, height: 168, correctLevel: window.QRCode.CorrectLevel.M });
    } catch { document.getElementById('share-qr')?.remove(); }
    return;
  }
  if (!info.lan) {
    sharePanel.innerHTML =
      '<p>Right now only this Mac can open PrismTV. To use it on a phone, tablet or TV at home:</p>' +
      '<ol><li>Stop the server in Terminal (<code class="cmd">Ctrl+C</code>).</li>' +
      '<li>Start it with <code class="cmd">./serve.sh --lan</code></li>' +
      '<li>If macOS asks about incoming connections for python3, choose <b>Allow</b>.</li>' +
      '<li>Reopen this panel for the address and a QR code.</li></ol>';
    return;
  }
  if (!info.thisMac) {
    sharePanel.innerHTML = '<p>You are watching from another device. Same address on any phone, tablet or TV on this Wi-Fi:</p>' +
      info.urls.map((u) => '<div class="share-url"><code>' + escapeHtml(u) + '</code></div>').join('');
    return;
  }
  const urls = info.urls.length ? info.urls : ['http://' + location.hostname + ':' + info.port];
  sharePanel.innerHTML =
    '<p>On a phone, tablet or TV connected to the <b>same Wi-Fi</b>, open:</p>' +
    urls.map((u) => '<div class="share-url"><code>' + escapeHtml(u) + '</code>' +
      '<button class="icon-btn" type="button" data-copy="' + escapeHtml(u) + '" aria-label="Copy address"><svg class="i"><use href="#i-link"/></svg></button></div>').join('') +
    '<div class="share-qr" id="share-qr" aria-label="QR code for ' + escapeHtml(urls[0]) + '"></div>' +
    '<p class="prefs-note">Scan with your phone camera. Keep this Mac awake and PrismTV running. ' +
    'If the first address does not open, try the other one.</p>';
  sharePanel.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Address copied'); } catch { toast(b.dataset.copy); }
  }));
  try {
    await loadQr();
    new window.QRCode(document.getElementById('share-qr'), { text: urls[0], width: 168, height: 168, correctLevel: window.QRCode.CorrectLevel.M });
  } catch {
    const box = document.getElementById('share-qr');
    if (box) box.remove();
  }
}
shareBtn.addEventListener('click', () => {
  const open = sharePanel.hidden;
  sharePanel.hidden = !open;
  shareBtn.setAttribute('aria-expanded', String(open));
  if (open) renderShare();
});
