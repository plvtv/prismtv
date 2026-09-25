import { API_BASE, CACHE_TTL_MS, CACHE_KEY, HIDE_NSFW, HIDE_CLOSED, COUNTRY_ALIASES } from './config.js';
import { fetchFreeTV, fetchShovo, fetchLG, fetchFast } from './sources.js';

const OFFICIAL_LIVE = [
  { id: 'extras:nasa-tv-public', name: 'NASA TV Public', country: 'US', categories: ['science', 'education'],
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/NASA_logo.svg/240px-NASA_logo.svg.png',
    url: 'https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8' },
  { id: 'extras:nasa-tv-media', name: 'NASA TV Media', country: 'US', categories: ['science', 'education'],
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/NASA_logo.svg/240px-NASA_logo.svg.png',
    url: 'https://ntv2.akamaized.net/hls/live/2013923/NASA-NTV2-HLS/master.m3u8' },
  { id: 'extras:retrostrange', name: 'RetroStrange TV', country: 'US', categories: ['classic', 'movies'],
    logo: 'https://retrostrange.com/wp-content/uploads/2021/01/cropped-RS-MINI-ALT-192x192.png',
    url: 'https://live.retrostrange.com/hls/stream.m3u8' },
  { id: 'extras:old-timey-computer-show', name: 'Old Timey Computer Show', country: 'US', categories: ['classic', 'education'],
    logo: 'https://otcs.minuspoint.com/favicon.ico',
    url: 'https://otcs.minuspoint.com/hls/0/stream.m3u8' }
];

/* ---------------- tiny IndexedDB wrapper ---------------- */
const DB_NAME = 'prismtv';
const STORE = 'cache';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } catch { return null; }
}
async function idbSet(key, value) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const r = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  } catch { /* quota or private mode: just skip caching */ }
}
export async function clearCache() {
  try {
    const db = await openDB();
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(CACHE_KEY);
  } catch { /* ignore */ }
}

/* ---------------- fetching ---------------- */
async function getJSON(name) {
  const res = await fetch(API_BASE + '/' + name + '.json', { mode: 'cors' });
  if (!res.ok) throw new Error(name + '.json returned HTTP ' + res.status);
  return res.json();
}

const FORMAT_RANK = { SVG: 4, PNG: 3, WEBP: 2, JPEG: 1, GIF: 0 };

function pickLogos(logos) {
  const best = new Map();
  for (const logo of logos) {
    if (!logo.channel || !logo.url) continue;
    const score =
      (logo.in_use ? 10000 : 0) +
      (FORMAT_RANK[logo.format] ?? 0) * 1000 +
      Math.min(logo.width || 0, 900);
    const current = best.get(logo.channel);
    if (!current || score > current.score) best.set(logo.channel, { url: logo.url, score });
  }
  const out = new Map();
  for (const [id, v] of best) out.set(id, v.url);
  return out;
}

function qualityRank(q) {
  if (!q) return 0;
  const m = /(\d+)/.exec(q);
  return m ? parseInt(m[1], 10) : 0;
}

function groupStreams(streams) {
  const map = new Map();
  for (const s of streams) {
    if (!s.channel || !s.url) continue;
    const arr = map.get(s.channel) || [];
    if (arr.some((x) => x.url === s.url)) continue;
    arr.push({
      url: s.url,
      quality: s.quality || null,
      // The browser cannot spoof these, so a stream that needs them will likely fail.
      restricted: Boolean(s.user_agent || s.referrer)
    });
    map.set(s.channel, arr);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) =>
      Number(a.restricted) - Number(b.restricted) ||
      Number(b.url.startsWith('https')) - Number(a.url.startsWith('https')) ||
      qualityRank(b.quality) - qualityRank(a.quality));
  }
  return map;
}

/**
 * Downloads the iptv-org index and reduces it to what the UI needs.
 * onProgress(fraction, label) is called as each piece lands.
 */
export async function buildDataset(onProgress = () => {}) {
  const parts = ['channels', 'streams', 'logos', 'countries', 'categories'];
  let done = 0;
  const results = await Promise.all(parts.map(async (name) => {
    const data = await getJSON(name);
    done += 1;
    onProgress(done / (parts.length + 1), 'Loaded ' + name);
    return data;
  }));
  const [channels, streams, logos, countries, categories] = results;

  onProgress(0.9, 'Merging ' + channels.length.toLocaleString() + ' channels');

  const logoByChannel = pickLogos(logos);
  const streamsByChannel = groupStreams(streams);
  const countryByCode = Object.fromEntries(countries.map((c) => [c.code, c]));
  const categoryById = Object.fromEntries(categories.map((c) => [c.id, c]));

  const list = [];
  for (const ch of channels) {
    const chStreams = streamsByChannel.get(ch.id);
    if (!chStreams || !chStreams.length) continue;
    if (HIDE_NSFW && ch.is_nsfw) continue;
    if (HIDE_CLOSED && ch.closed) continue;
    list.push({
      source: 'iptv-org',
      id: ch.id,
      name: ch.name,
      country: ch.country || null,
      categories: ch.categories || [],
      website: ch.website || null,
      logo: logoByChannel.get(ch.id) || null,
      streams: chStreams
    });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));

  // The second index is a bonus, never a blocker: if it fails, carry on without it.
  onProgress(0.95, 'Loading the Free-TV list');
  let freetv = [];
  try {
    freetv = await fetchFreeTV(categoryById);
  } catch (err) {
    console.warn('Free-TV playlist unavailable:', err);
  }

  // Third index: only streams iptv-org lacks. Backups for known channels are merged
  // into those channels; the rest become their own "Shovo" list.
  onProgress(0.97, 'Loading the Shovo list');
  let shovo = [];
  try {
    const byId = new Map(list.map((c) => [c.id, c]));
    const knownUrls = new Set();
    for (const c of list) for (const s of c.streams) knownUrls.add(s.url);
    // The public website (data/site.json, written by the GitHub Pages workflow) leaves Shovo out:
    // many of its extra streams are unofficial restreams of pay channels.
    const site = await fetch('data/site.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    if (site.public) throw new Error('skipped on the public website');
    const result = await fetchShovo({ knownUrls, knownIds: new Set(byId.keys()), categories: categoryById });
    for (const [id, extra] of result.extraStreams) byId.get(id).streams.push(...extra);
    shovo = result.channels;
    console.info('Shovo: ' + shovo.length + ' new channels, ' + result.extraStreams.size +
      ' iptv-org channels got backup streams, ' + result.skippedIp + ' bare-IP streams skipped');
  } catch (err) {
    console.warn('Shovo playlist unavailable:', err);
  }

  // Fourth index: LG Channels. Streams already listed elsewhere are skipped.
  onProgress(0.98, 'Loading LG Channels');
  let lg = [];
  try {
    const knownUrls = new Set();
    for (const c of list.concat(shovo, freetv)) for (const s of c.streams) knownUrls.add(s.url);
    lg = await fetchLG({ knownUrls, categories: categoryById });
  } catch (err) {
    console.warn('LG Channels list unavailable:', err);
  }

  // Fifth index: free streaming-TV services (Roku, Xumo, Local Now, Vizio, ...).
  onProgress(0.99, 'Loading free streaming TV');
  let fast = [];
  try {
    const knownUrls = new Set();
    for (const c of list.concat(shovo, freetv, lg)) for (const s of c.streams) knownUrls.add(s.url);
    fast = await fetchFast({ knownUrls, categories: categoryById });
  } catch (err) {
    console.warn('Free streaming TV lists unavailable:', err);
  }

  // A few official live streams that no index carries (picked from FMHY's Live TV / Classics lists).
  // When another source already has the channel, the official stream becomes its first source instead.
  const byName = new Map();
  for (const c of list.concat(freetv, shovo, lg, fast)) {
    const k = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!byName.has(k)) byName.set(k, c);
  }
  for (const c of OFFICIAL_LIVE) {
    const stream = { url: c.url, quality: '720p', restricted: false, kind: 'hls', geo: false };
    const existing = byName.get(c.name.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (existing) {
      if (!existing.streams.some((s) => s.url === c.url)) existing.streams.unshift(stream);
      continue;
    }
    fast.push({ ...c, source: 'extras', via: 'Official stream', website: null, geo: false, external: false, streams: [stream] });
  }

  // The indexes do not use identical country codes. Anything the country
  // table cannot resolve becomes null rather than a dangling lookup later on.
  const unknown = new Set();
  for (const ch of freetv.concat(shovo, lg, fast)) {
    if (ch.country && COUNTRY_ALIASES[ch.country]) ch.country = COUNTRY_ALIASES[ch.country];
    if (ch.country && !countryByCode[ch.country]) { unknown.add(ch.country); ch.country = null; }
  }
  if (unknown.size) console.warn('Country codes not in the index:', [...unknown].join(', '));

  const dataset = {
    version: 9,
    builtAt: Date.now(),
    channels: list,
    freetv,
    shovo,
    lg,
    fast,
    countries: countryByCode,
    categories: categoryById
  };
  await idbSet(CACHE_KEY, dataset);
  return dataset;
}

/** Returns the cached dataset when fresh, otherwise rebuilds it. */
export async function loadDataset({ force = false, onProgress = () => {} } = {}) {
  if (!force) {
    const cached = await idbGet(CACHE_KEY);
    if (cached && cached.version === 9 && Date.now() - cached.builtAt < CACHE_TTL_MS) {
      onProgress(1, 'Loaded from cache');
      return { dataset: cached, fromCache: true };
    }
  }
  const dataset = await buildDataset(onProgress);
  return { dataset, fromCache: false };
}

/* ---------------- derived views ---------------- */
export function indexDataset(dataset, channels = dataset.channels) {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const byCategory = new Map();
  const byCountry = new Map();
  for (const ch of channels) {
    for (const cat of ch.categories) {
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(ch);
    }
    if (ch.country) {
      if (!byCountry.has(ch.country)) byCountry.set(ch.country, []);
      byCountry.get(ch.country).push(ch);
    }
  }
  // Language is not on the channel record; the index ties languages to countries,
  // so we approximate a channel's language from where it broadcasts.
  const languageNames = new Map();
  const byLanguage = new Map();
  for (const ch of channels) {
    const country = ch.country && dataset.countries[ch.country];
    if (!country) continue;
    for (const lang of country.languages || []) {
      if (!byLanguage.has(lang)) byLanguage.set(lang, []);
      byLanguage.get(lang).push(ch);
    }
  }
  return { byId, byCategory, byCountry, byLanguage, languageNames, channels };
}

/** Channels that look good on a poster wall: artwork, a clean name, a working-ish stream. */
export function rankForDisplay(channels) {
  return channels.slice().sort((a, b) => {
    const art = Number(Boolean(b.logo)) - Number(Boolean(a.logo));
    if (art) return art;
    const geo = Number(Boolean(a.geo)) - Number(Boolean(b.geo));
    if (geo) return geo;
    const open = Number(!b.streams[0].restricted) - Number(!a.streams[0].restricted);
    if (open) return open;
    return b.streams.length - a.streams.length;
  });
}

/** Deterministic per-day shuffle so rows feel fresh but stay stable while browsing. */
export function daySeededShuffle(items) {
  const day = Math.floor(Date.now() / 86400000);
  let seed = day * 2654435761 % 2147483647;
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
