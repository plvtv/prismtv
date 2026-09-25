/**
 * Free-TV/IPTV adapter.
 *
 * That project publishes one curated M3U playlist instead of a JSON API, with its
 * metadata carried on each #EXTINF line and a few status markers glued onto the
 * display name. This module reshapes it into the same channel records the
 * iptv-org index produces, so the rest of the app never has to care which index
 * a channel came from.
 *
 * Markers used by the playlist:
 *   (G) geoblocked   (S) standard definition   (Y) YouTube live   (T) Twitch
 */
import { FREETV_URL, SHOVO_URL, SHOVO_SKIP_BARE_IP, LG_URL, FAST_PLAYLISTS } from './config.js';

const MARK_GEO = 'Ⓖ';
const MARK_SD = 'Ⓢ';
const MARK_YT = 'Ⓨ';
const MARK_TW = 'Ⓣ';
const MARKS = new RegExp('[' + MARK_GEO + MARK_SD + MARK_YT + MARK_TW + ']', 'g');

const ATTR_RE = /([a-zA-Z-]+)="([^"]*)"/g;

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

/** Some tvg-id values in the playlist are markdown links rather than ids. */
function cleanId(raw) {
  if (!raw || raw.includes('[') || raw.includes('http') || raw.includes(' ')) return null;
  return raw;
}

function streamKind(url) {
  if (/(^|\/\/)(www\.)?(youtube\.com|youtu\.be)/.test(url)) return 'youtube';
  if (/twitch\.tv/.test(url)) return 'twitch';
  return 'hls';
}

/** group-title is a country most of the time, but a few groups are genuine categories. */
function categoryFromGroup(group, categories) {
  if (!group) return [];
  const key = group.toLowerCase().trim();
  return categories[key] ? [key] : [];
}

export function parsePlaylist(text, { categories = {} } = {}) {
  const lines = text.split('\n');
  const byId = new Map();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXTINF')) continue;

    const url = (lines[i + 1] || '').trim();
    if (!url || url.startsWith('#')) continue;

    const attrs = {};
    ATTR_RE.lastIndex = 0;
    let match;
    while ((match = ATTR_RE.exec(line)) !== null) attrs[match[1]] = match[2];

    const rawName = line.includes(',') ? line.slice(line.indexOf(',') + 1) : '';
    const name = rawName.replace(MARKS, '').replace(/\s+/g, ' ').trim();
    if (!name) continue;

    const country = (attrs['tvg-country'] || '').split(';')[0].trim().toUpperCase() || null;
    const id = 'freetv:' + (cleanId(attrs['tvg-id']) || slug(name) + (country ? '.' + country.toLowerCase() : ''));

    const stream = {
      url,
      quality: rawName.includes(MARK_SD) ? 'SD' : 'HD',
      restricted: false,
      kind: streamKind(url),
      geo: rawName.includes(MARK_GEO)
    };

    const existing = byId.get(id);
    if (existing) {
      if (!existing.streams.some((s) => s.url === url)) existing.streams.push(stream);
      continue;
    }
    byId.set(id, {
      id,
      name,
      country,
      categories: categoryFromGroup(attrs['group-title'], categories),
      website: null,
      logo: attrs['tvg-logo'] || null,
      group: attrs['group-title'] || null,
      source: 'freetv',
      streams: [stream]
    });
  }

  const list = [...byId.values()];
  for (const channel of list) {
    // Playable HLS first, then geo-flagged, then YouTube/Twitch pages last.
    channel.streams.sort((a, b) =>
      Number(a.kind !== 'hls') - Number(b.kind !== 'hls') ||
      Number(a.geo) - Number(b.geo));
    channel.geo = channel.streams.every((s) => s.geo);
    channel.external = channel.streams.every((s) => s.kind !== 'hls');
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

export async function fetchFreeTV(categories) {
  const res = await fetch(FREETV_URL, { mode: 'cors' });
  if (!res.ok) throw new Error('Free-TV playlist returned HTTP ' + res.status);
  return parsePlaylist(await res.text(), { categories });
}

/* ---------------- IPTV-By-Shovo ---------------- */

const BARE_IP_RE = /^https?:\/\/\d{1,3}(\.\d{1,3}){3}([:/]|$)/;

/**
 * Parses the Shovo playlist, keeping only streams iptv-org does not already list.
 *
 * Its tvg-ids use iptv-org's spelling plus a feed suffix ("Foo.us@HD"). When the base
 * id is an iptv-org channel, the stream is returned in `extraStreams` so it can be added
 * to that channel as a backup source rather than creating a duplicate. Everything else
 * becomes a channel record of its own, in the same shape as the other indexes.
 */
export function parseShovo(text, { knownUrls = new Set(), knownIds = new Set(), categories = {} } = {}) {
  const lines = text.split('\n');
  const byId = new Map();
  const extraStreams = new Map();
  const seen = new Set(knownUrls);
  let skippedIp = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXTINF')) continue;

    let j = i + 1;
    let needsHeaders = /http-(user-agent|referrer)=/.test(line);
    while (j < lines.length && lines[j].startsWith('#')) {
      if (/http-(user-agent|referrer)=/.test(lines[j])) needsHeaders = true;
      j++;
    }
    const url = (lines[j] || '').trim();
    if (!url || !/^https?:\/\//.test(url) || seen.has(url)) continue;
    if (SHOVO_SKIP_BARE_IP && BARE_IP_RE.test(url)) { skippedIp++; continue; }
    seen.add(url);

    const attrs = {};
    ATTR_RE.lastIndex = 0;
    let match;
    while ((match = ATTR_RE.exec(line)) !== null) attrs[match[1]] = match[2];

    const rawName = line.includes(',') ? line.slice(line.lastIndexOf('",') + 2) : '';
    const quality = (/\((\d{3,4}p)\)/.exec(rawName) || [])[1] || null;
    const geo = /\[geo-blocked\]/i.test(rawName);
    const name = rawName.replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
    if (!name) continue;

    const stream = { url, quality, restricted: needsHeaders, kind: streamKind(url), geo };

    const baseId = (attrs['tvg-id'] || '').split('@')[0].trim();
    if (baseId && knownIds.has(baseId)) {
      const arr = extraStreams.get(baseId) || [];
      arr.push(stream);
      extraStreams.set(baseId, arr);
      continue;
    }

    const cc = (/\.([a-z]{2})$/i.exec(baseId) || [])[1];
    const country = cc ? cc.toUpperCase() : null;
    const id = 'shovo:' + (cleanId(baseId) || slug(name) + (country ? '.' + country.toLowerCase() : ''));
    const cats = (attrs['group-title'] || '').split(';')
      .map((g) => g.toLowerCase().trim()).filter((g) => categories[g]);

    const existing = byId.get(id);
    if (existing) { existing.streams.push(stream); continue; }
    byId.set(id, {
      id,
      name,
      country,
      categories: cats,
      website: null,
      logo: attrs['tvg-logo'] || null,
      source: 'shovo',
      streams: [stream]
    });
  }

  const channels = [...byId.values()];
  for (const channel of channels) {
    channel.streams.sort((a, b) =>
      Number(a.restricted) - Number(b.restricted) ||
      Number(a.geo) - Number(b.geo) ||
      Number(b.url.startsWith('https')) - Number(a.url.startsWith('https')));
    channel.geo = channel.streams.every((s) => s.geo);
    channel.external = channel.streams.every((s) => s.kind !== 'hls');
  }
  channels.sort((a, b) => a.name.localeCompare(b.name));
  return { channels, extraStreams, skippedIp };
}

export async function fetchShovo(opts) {
  const res = await fetch(SHOVO_URL, { mode: 'cors' });
  if (!res.ok) throw new Error('Shovo playlist returned HTTP ' + res.status);
  return parseShovo(await res.text(), opts);
}

/* ---------------- LG Channels ---------------- */

// group-title -> country, for entries whose name carries no "(XX)" code.
const LG_GROUP_COUNTRY = {
  USA_LG_USA: 'US', ENGLAND_LG_GB: 'GB', LG_AU: 'AU', LG_ESP: 'ES', LG_BR: 'BR', LG_FR: 'FR',
  LG_NL: 'NL', LG_IT: 'IT', LG_CH: 'CH', LG_AT: 'AT', GERMAN_MIX: 'DE'
};

// The list has no categories; a few obvious words in the name are enough for the rows.
const LG_KEYWORDS = [
  [/news|ndtv|tv9|cbs|nbc|abc|bloomberg|euronews|sky|cnn|reuters/i, 'news'],
  [/kids|baby|shark|poli|cartoon|junior|toon|pocoyo|peppa/i, 'kids'],
  [/movie|cine|film|kino|screamin/i, 'movies'],
  [/sport|golf|racing|fight|surf|ski|motor|outdoor/i, 'sports'],
  [/music|xite|hits|deluxe|k-pop|vevo|mtv|pop\b/i, 'music'],
  [/travel|earth|nature|wild|adventure|bergblick/i, 'travel'],
  [/crime|cops|detective|forensic/i, 'series'],
  [/food|cook|kitchen|chef/i, 'cooking'],
  [/comedy|laugh|funny/i, 'comedy'],
  [/docu|history|science/i, 'documentary']
];

export function parseLG(text, { knownUrls = new Set(), categories = {} } = {}) {
  const lines = text.split('\n');
  const byId = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXTINF')) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].startsWith('#')) j++;
    const url = (lines[j] || '').trim();
    if (!/^https?:\/\//.test(url) || knownUrls.has(url)) continue;

    const group = (/group-title="([^"]*)"/.exec(line) || [])[1] || '';
    let name = line.slice(line.lastIndexOf(',') + 1).trim().replace(/\s+alt$/i, '');
    const cc = /\(([A-Z]{2})\)\s*$/.exec(name);
    const country = cc ? cc[1] : (LG_GROUP_COUNTRY[group] || null);
    name = name.replace(/\s*\([A-Z]{2}\)\s*$/, '').trim();
    if (!name) continue;

    const id = 'lg:' + slug(name) + (country ? '.' + country.toLowerCase() : '');
    const stream = { url, quality: null, restricted: false, kind: streamKind(url), geo: false };
    const existing = byId.get(id);
    if (existing) {
      if (!existing.streams.some((s) => s.url === url)) existing.streams.push(stream);
      continue;
    }
    const cats = [];
    for (const [re, cat] of LG_KEYWORDS) if (re.test(name) && categories[cat] && !cats.includes(cat)) cats.push(cat);
    byId.set(id, {
      id, name, country, categories: cats, website: null, logo: null,
      source: 'lg', streams: [stream], geo: false, external: stream.kind !== 'hls'
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The list's host sends no CORS header: fetchText falls back to serve.py, then to data/mirror/. */
export async function fetchLG(opts) {
  return parseLG(await fetchText(LG_URL), opts);
}

/* ---------------- generic M3U (FAST services, your own playlists) ---------------- */

/** File name of a list's copy in data/mirror/ (must match mirror_name() in tools/build-mirror.py). */
export function mirrorName(url) {
  return url.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 150);
}

async function textFrom(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(url + ' returned HTTP ' + res.status);
  const text = await res.text();
  if (/^\s*<!doctype html/i.test(text)) throw new Error(url + ' returned a web page');
  return text;
}

/**
 * Fetches a text file: directly when its host allows it, else through serve.py's relay
 * (at home), else from the copy the public website keeps in data/mirror/.
 */
export async function fetchText(url) {
  try { return await textFrom(url, { mode: 'cors' }); } catch { /* no CORS header */ }
  try { return await textFrom('/api/hls?raw=1&url=' + encodeURIComponent(url)); } catch { /* no serve.py */ }
  return textFrom('data/mirror/' + mirrorName(url));
}

// group-title / name words -> iptv-org category ids. First match wins per category.
const GENERIC_CATEGORIES = [
  [/news|opinion|weather/i, 'news'],
  [/sport|golf|fight|racing|poker|wrestl|fishing|hunting/i, 'sports'],
  [/movie|film|cinema|action & drama|horror|sci-fi|western/i, 'movies'],
  [/comedy|laugh|funny|sitcom/i, 'comedy'],
  [/crime|mystery|detective|reality|tv shows|tv & entertainment|entertainment|drama|series|^tv$/i, 'series'],
  [/music|hits|concert|karaoke/i, 'music'],
  [/kid|family|animation|cartoon|anime/i, 'kids'],
  [/doc|factual|nature|animal|outdoor|history|science|explor/i, 'documentary'],
  [/food|cook|kitchen|chef|tasty/i, 'cooking'],
  [/travel|explore|beach/i, 'travel'],
  [/lifestyle|home|diy|garden/i, 'lifestyle'],
  [/classic|retro|vintage|rewind/i, 'classic'],
  [/faith|relig|gospel|church/i, 'religious'],
  [/business|finance|money/i, 'business']
];
const SKIP_GROUP = /latino|espa[nñ]ol|spanish|en espanol/i;
const LOCAL_GROUP = /local|my city|more cities/i;

function decodeEntities(t) {
  return t.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function genericName(raw) {
  return decodeEntities(raw).replace(/\r/g, '')
    .replace(/^\d{2,5}\s+/, '')                                   // "1001 LG 1: Film" channel numbers
    .replace(/\s*\((?:Australia|NZ|US|UK|Ireland|Canada)\)\s*/gi, ' ')
    .replace(/\s*[-\u2013]\s*TCL\b/i, '')
    .replace(/\s*\((?:geo|GEO)\)|\s+GEO$/g, '')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Parses any M3U into channel records. `country` applies when the list has none;
 * `source` tags the records; identical names (per country) become one channel with
 * several sources, which is what happens when two services carry the same channel.
 */
export function parseGeneric(text, { source, country = null, label = '', knownUrls = new Set(), categories = {}, into = new Map() } = {}) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (!line.startsWith('#EXTINF')) continue;
    let j = i + 1;
    let needsHeaders = false;
    while (j < lines.length && lines[j].startsWith('#')) {
      if (/http-(user-agent|referrer)/i.test(lines[j])) needsHeaders = true;
      j++;
    }
    const url = (lines[j] || '').trim();
    if (!/^https?:\/\//.test(url) || knownUrls.has(url)) continue;
    knownUrls.add(url);

    const attrs = {};
    ATTR_RE.lastIndex = 0;
    let m;
    while ((m = ATTR_RE.exec(line)) !== null) attrs[m[1]] = m[2];
    const bare = line.replace(ATTR_RE, '');
    const rawName = bare.slice(bare.indexOf(',') + 1) || attrs['tvg-name'] || '';
    const group = decodeEntities((attrs['group-title'] || '').replace(/^[^:]*:\s*/, ''));
    if (SKIP_GROUP.test(group)) continue;
    const name = genericName(rawName);
    if (!name) continue;

    const cc = ((attrs['tvg-country'] || '').split(';')[0].trim().toUpperCase()) || country;
    const key = slug(name) + (cc ? '.' + cc.toLowerCase() : '');
    const id = source + ':' + key;
    const stream = {
      url, quality: null, restricted: needsHeaders, kind: streamKind(url),
      geo: /\(geo\)|\bGEO\b/.test(rawName)
    };
    const existing = into.get(id);
    if (existing) {
      if (!existing.streams.some((s) => s.url === url)) existing.streams.push(stream);
      if (!existing.logo && attrs['tvg-logo']) existing.logo = attrs['tvg-logo'];
      continue;
    }
    const cats = [];
    if (!LOCAL_GROUP.test(group)) {
      for (const [re, cat] of GENERIC_CATEGORIES) {
        if (cat === 'kids' && /adult|mature|18\+/i.test(group + ' ' + name)) continue;   // adult animation is not for kids
        if ((re.test(group) || re.test(name)) && categories[cat] && !cats.includes(cat)) cats.push(cat);
        if (cats.length >= 2) break;
      }
    }
    into.set(id, {
      id, name, country: cc, categories: cats, website: null,
      logo: attrs['tvg-logo'] || null, source, via: label, streams: [stream], geo: false, external: false
    });
  }
  return into;
}

function finishChannels(map) {
  const list = [...map.values()];
  for (const c of list) {
    c.streams.sort((a, b) => Number(a.restricted) - Number(b.restricted) || Number(a.geo) - Number(b.geo));
    c.geo = c.streams.every((s) => s.geo);
    c.external = c.streams.every((s) => s.kind !== 'hls');
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/** All FAST lists, merged. A list that fails to load is skipped, never fatal. */
export async function fetchFast({ knownUrls = new Set(), categories = {} } = {}) {
  const texts = await Promise.allSettled(FAST_PLAYLISTS.map((p) => fetchText(p.url)));
  const into = new Map();
  texts.forEach((r, i) => {
    const p = FAST_PLAYLISTS[i];
    if (r.status !== 'fulfilled') { console.warn(p.name + ' playlist unavailable:', r.reason); return; }
    parseGeneric(r.value, { source: 'fast', country: p.country, label: p.name, knownUrls, categories, into });
  });
  return finishChannels(into);
}

/** One of your own playlists (added in Learn English). */
export async function fetchCustomPlaylist(url, { categories = {} } = {}) {
  const text = await fetchText(url);
  if (!/#EXTM3U|#EXTINF/.test(text)) throw new Error('That link is not an M3U playlist.');
  return finishChannels(parseGeneric(text, { source: 'mine', categories, into: new Map() }));
}
