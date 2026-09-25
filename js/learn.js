/**
 * Learn English.
 *
 * Lessons are official uploads from established teaching channels on YouTube, played
 * in YouTube's own embedded player with English subtitles switched on. Courses are
 * whole playlists; "New lessons" reads each channel's public RSS feed through
 * serve.py (YouTube sends no CORS header), so that row only appears under serve.sh.
 *
 * Live-TV practice rows are supplied by app.js (English-speaking channels from the
 * index) and open in the normal player with auto-captions on.
 */
import { fetchText, fetchCustomPlaylist, mirrorName } from './sources.js';
import { overlayOpened, overlayClosed } from './mobile.js';

const LEVEL_KEY = 'prismtv.learnLevel';
const MINE_KEY = 'prismtv.learnMine';
const RECENT_KEY = 'prismtv.learnRecent';
const LEVELS = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' }
];

// Whole courses: each is an official playlist. `thumb` is one of its videos, for the cover.
const COURSES = [
  { level: 'beginner', channel: "VOA Learning English", title: "Let's Learn English (Level 1)", list: 'PLd9hCvj34W5it4a-RMzhlwNJ-edf5HU3Q', thumb: '4Xn1Ysdmuvg' },
  { level: 'beginner', channel: "VOA Learning English", title: "Let's Learn English (Level 2)", list: 'PLd9hCvj34W5hWkRym8sljiEvEBJ1JGIu5', thumb: 'gTKvZSeqFsg' },
  { level: 'beginner', channel: "BBC Learning English", title: "Real Easy English", list: 'PLcetZ6gSk96_IQnT7zKUjp7GtQeeGDI1a', thumb: 'M_HGq2smydM' },
  { level: 'beginner', channel: "BBC Learning English", title: "Easy English Conversations", list: 'PLcetZ6gSk96-XmVQ1xpU3ziEtQvczLpJt', thumb: 'v9EU41cuhHY' },
  { level: 'beginner', channel: "Rachel's English", title: "100 Most Common Words", list: 'PLrqHrGoMJdTR76CbHRqi7uLbpEtTUU7eR', thumb: 'aIZdTPwWL5I' },
  { level: 'intermediate', channel: "BBC Learning English", title: "6 Minute English", list: 'PLcetZ6gSk96-FECmH9l7Vlx5VDigvgZpt', thumb: 'vOuhs1mA0xo' },
  { level: 'intermediate', channel: "BBC Learning English", title: "6 Minute Grammar", list: 'PLcetZ6gSk96_zHuVg6Ecy2F7j4Aq4valQ', thumb: 'ZXN3wROCpfs' },
  { level: 'intermediate', channel: "BBC Learning English", title: "6 Minute Vocabulary", list: 'PLcetZ6gSk96-GbYhcN0KkFtIL8LJPOG5x', thumb: '0MKoWAKhqMI' },
  { level: 'intermediate', channel: "BBC Learning English", title: "English at Work", list: 'PLcetZ6gSk969oGvAI0e4_PgVnlGbm64bp', thumb: 'UKz1Fsw_e8c' },
  { level: 'intermediate', channel: "BBC Learning English", title: "The English We Speak", list: 'PLcetZ6gSk96_sototkO7HFkGA8zL8H0lq', thumb: 'hfSJPwiQy7g' },
  { level: 'intermediate', channel: "VOA Learning English", title: "Everyday Grammar", list: 'PLd9hCvj34W5hIJ855osxqJ-fjgsmNB69n', thumb: '-LzMBUzmmrU' },
  { level: 'intermediate', channel: "Speak English With Vanessa", title: "English Listening Lessons", list: 'PLKWcPfZiScgApTbS43FUY2Bl7Vatt1-r-', thumb: 'WQCS2LDx0ow' },
  { level: 'intermediate', channel: "Speak English With Vanessa", title: "Phrasal Verb Lessons", list: 'PLKWcPfZiScgBACqEFo5TuhJWAReRNNTc8', thumb: 'G5C_TtVu4lQ' },
  { level: 'intermediate', channel: "English with Lucy", title: "English Listening Practice", list: 'PLzMXToX8Kzqhgsq9k0De5_5udvO6w9FzZ', thumb: 'S0325A8-_A4' },
  { level: 'intermediate', channel: "English with Lucy", title: "English Grammar", list: 'PLzMXToX8KzqhKrURIhVTJMb0v-HeDM3gs', thumb: 'DRl6tpsxchw' },
  { level: 'intermediate', channel: "BBC Learning English", title: "The Grammar Gameshow", list: 'PLcetZ6gSk96-ZHfHIl2EZmzfwrbZeAulE', thumb: 'mAFd4jjo0YU' },
  { level: 'intermediate', channel: "VOA Learning English", title: "English @ the Movies", list: 'PLd9hCvj34W5iVP6xGb5ehJWl9UU-Q0sGu', thumb: 'cYqAai22zxs' },
  { level: 'advanced', channel: "BBC Learning English", title: "Learning English from the News", list: 'PLcetZ6gSk96-8vlsfui2jrM0CAJ4MfrMT', thumb: 'UWwpe7cHxXw' },
  { level: 'advanced', channel: "English with Lucy", title: "Advanced English", list: 'PLzMXToX8Kzqj3tX3m3vbIkrhyQzXFK3Mc', thumb: 'FPzKyWNRWiU' },
  { level: 'advanced', channel: "English with Lucy", title: "British Expressions", list: 'PLzMXToX8Kzqg1BskUqVoyZhBmT1S_rq8A', thumb: '-5jDMf4kTkY' },
  { level: 'advanced', channel: "Rachel's English", title: "Learn English with Movies", list: 'PLrqHrGoMJdTR_P8p95DY1RA8_gD4XEOmI', thumb: '56IgTIGrGiM' },
  { level: 'advanced', channel: "Rachel's English", title: "Real English Conversation", list: 'PLrqHrGoMJdTQHLIkaW-L89_RXbt4FZliI', thumb: 'RhqBZkAwh8c' },
  { level: 'advanced', channel: "Rachel's English", title: "How to Speak English Fast", list: 'PLrqHrGoMJdTRIwCX-8v2TzNskf2U_eY24', thumb: 'mUupfHhOnHg' },
  { level: 'advanced', channel: "English with Lucy", title: "Business English", list: 'PLzMXToX8Kzqjbn3IlJjZEzqj8AsKe0jqB', thumb: 'w7ZZdVlpOeo' },
  { level: 'advanced', channel: "Speak English With Vanessa", title: "Business English", list: 'PLKWcPfZiScgCsMaLF5Nbn7FSja4n4lviC', thumb: 'mV-WW0f5DdA' },
  { level: 'pronunciation', channel: "English with Lucy", title: "British English Pronunciation", list: 'PLzMXToX8KzqgABZmT_LcYdED98Ixuc2Fx', thumb: 'DRl6tpsxchw' },
  { level: 'pronunciation', channel: "Speak English With Vanessa", title: "American Pronunciation Lessons", list: 'PLKWcPfZiScgAutnWOSAh2AH026L9w8c18', thumb: 'HBiWy2TFmA4' },
  { level: 'pronunciation', channel: "VOA Learning English", title: "How to Pronounce", list: 'PLd9hCvj34W5gxnTUV-wHERehpInsTJgq7', thumb: 'ZR36tMiYb04' },
  { level: 'pronunciation', channel: "Rachel's English", title: "Best American Accent", list: 'PLrqHrGoMJdTTm-WglbX3BVV5rElWNWUkU', thumb: 'XY1QPRy6ra0' },
  { level: 'pronunciation', channel: "BBC Learning English", title: "English In A Minute", list: 'PLcetZ6gSk96_Fprtuj6gKN9upPjaDrARH', thumb: '8HhyqlDmnWA' }
];

// Channels whose newest uploads feed the "New lessons" row.
const FEEDS = [
  { name: 'BBC Learning English', id: 'UCHaHD477h-FeBbVh9Sh7syA' },
  { name: 'VOA Learning English', id: 'UCKyTokYo0nK2OA-az-sDijA' },
  { name: 'English with Lucy', id: 'UCz4tgANd4yy8Oe0iXCdSWfA' },
  { name: "Rachel's English", id: 'UCvn_XCl_mgQmt3sD753zdJA' },
  { name: 'Speak English With Vanessa', id: 'UCxJGMJbjokfnr2-s4_RXPxQ' },
  { name: 'EnglishClass101', id: 'UCeTVoczn9NOZA9blls3YgUg' }
];

const ROW_TITLES = {
  beginner: 'Beginner courses',
  intermediate: 'Intermediate courses',
  advanced: 'Advanced courses',
  pronunciation: 'Pronunciation'
};

const el = {};
let started = false;
let practice = () => [];      // app.js supplies live-TV practice rows
let renderChannelRow = null;  // and the function that draws them
let current = null;

/* ---------------- prefs ---------------- */
function level() {
  try { return localStorage.getItem(LEVEL_KEY) || 'intermediate'; } catch { return 'intermediate'; }
}
function setLevel(v) {
  try { localStorage.setItem(LEVEL_KEY, v); } catch { /* ignore */ }
}
function recent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function remember(item) {
  const list = recent().filter((x) => x.key !== item.key);
  list.unshift({ ...item, at: Date.now() });
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 20))); } catch { /* ignore */ }
}

/* ---------------- cards and rows ---------------- */
function thumbUrl(videoId) {
  return 'https://i.ytimg.com/vi/' + encodeURIComponent(videoId) + '/hqdefault.jpg';
}

function lcard(item) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lcard';
  b.dataset.learn = JSON.stringify(item);
  b.setAttribute('aria-label', item.title + ', ' + item.channel);

  const art = document.createElement('div');
  art.className = 'lcard-art';
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '';
  img.src = thumbUrl(item.thumb);
  img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
  img.addEventListener('error', () => img.remove(), { once: true });
  art.append(img);
  if (item.list) {
    const badge = document.createElement('span');
    badge.className = 'lcard-badge';
    badge.textContent = 'Course';
    art.append(badge);
  }
  const go = document.createElement('span');
  go.className = 'mcard-go';
  go.innerHTML = '<svg class="i"><use href="#i-play"/></svg>';
  art.append(go);

  const meta = document.createElement('div');
  meta.className = 'mcard-meta';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = item.title;
  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = item.channel + (item.date ? ' · ' + item.date : '');
  meta.append(name, sub);
  b.append(art, meta);
  return b;
}

function row(title, items, note = '') {
  const section = document.createElement('section');
  section.className = 'row lrow';
  const head = document.createElement('div');
  head.className = 'row-head';
  const h2 = document.createElement('h2');
  h2.textContent = title;
  head.append(h2);
  if (note) {
    const small = document.createElement('span');
    small.className = 'row-note';
    small.textContent = note;
    head.append(small);
  }
  const wrap = document.createElement('div');
  wrap.className = 'row-wrap';
  const scroll = document.createElement('div');
  scroll.className = 'row-scroll';
  items.forEach((it) => scroll.append(lcard(it)));
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

/* ---------------- new lessons (RSS via serve.py) ---------------- */
async function relayText(url) {
  // serve.py's relay at home; on the public website, the daily copy in data/mirror/ (feeds only).
  for (const path of ['/api/hls?raw=1&url=' + encodeURIComponent(url), 'data/mirror/' + mirrorName(url)]) {
    try {
      const res = await fetch(path);
      const text = res.ok ? await res.text() : '';
      if (text && !/^\s*<!doctype html/i.test(text)) return text;
    } catch { /* try the next one */ }
  }
  throw new Error('HTTP unavailable');
}

async function feed(ch) {
  const url = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + ch.id;
  const xml = new DOMParser().parseFromString(await relayText(url), 'application/xml');
  return [...xml.getElementsByTagName('entry')].map((e) => {
    const vid = (e.getElementsByTagName('yt:videoId')[0] || {}).textContent;
    const title = (e.getElementsByTagName('title')[0] || {}).textContent || '';
    const published = (e.getElementsByTagName('published')[0] || {}).textContent || '';
    return { video: vid, thumb: vid, title, channel: ch.name, published };
  }).filter((x) => x.video && !/#shorts?\b/i.test(x.title));
}

function shortDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const days = Math.round((Date.now() - d) / 86400000);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 14) return days + ' days ago';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

async function newLessonsRow(holder) {
  const results = await Promise.allSettled(FEEDS.map(feed));
  const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, 30)
    .map((x) => ({ ...x, date: shortDate(x.published) }));
  if (!items.length) { holder.remove(); return; }
  holder.replaceWith(row('New lessons', items, 'Latest uploads from 6 teaching channels'));
}

/* ---------------- page ---------------- */
function renderLevelChips() {
  el.levels.innerHTML = '';
  for (const l of LEVELS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (l.id === level() ? ' on' : '');
    b.textContent = l.label;
    b.setAttribute('aria-pressed', String(l.id === level()));
    b.addEventListener('click', () => { setLevel(l.id); render(); });
    el.levels.append(b);
  }
}

function render() {
  renderLevelChips();
  el.rows.innerHTML = '';
  const mine = level();

  const rec = recent();
  if (rec.length) el.rows.append(row('Continue learning', rec));

  renderMine();

  el.rows.append(row(ROW_TITLES[mine], COURSES.filter((c) => c.level === mine), 'Your level'));

  const holder = document.createElement('div');
  el.rows.append(holder);
  newLessonsRow(holder).catch(() => holder.remove());

  el.rows.append(row(ROW_TITLES.pronunciation, COURSES.filter((c) => c.level === 'pronunciation')));

  // Practice with real English on live TV, captions switched on automatically.
  if (renderChannelRow) {
    for (const p of practice()) {
      if (p.channels.length) el.rows.append(renderChannelRow(p.title, p.channels, p.note));
    }
  }

  for (const l of LEVELS) {
    if (l.id !== mine) el.rows.append(row(ROW_TITLES[l.id], COURSES.filter((c) => c.level === l.id)));
  }
}

/* ---------------- your own channels and links ----------------
 * Accepted: a YouTube channel (@handle, /channel/UC..., /c/, /user/), playlist (list=)
 * or video (watch?v=, youtu.be, /shorts/, /live/); a single live stream (.m3u8);
 * or an M3U playlist of channels. Saved in this browser.
 */
const mineChannels = new Map();   // id -> channel record, for stream / playlist cards

function mine() {
  try { return JSON.parse(localStorage.getItem(MINE_KEY) || '[]'); } catch { return []; }
}
function saveMine(list) {
  try { localStorage.setItem(MINE_KEY, JSON.stringify(list)); } catch { /* storage off */ }
}

/** Looks up a stream/playlist channel added here, for app.js's card click handler. */
export function learnChannel(id) { return mineChannels.get(id) || null; }

function ytParts(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (!/^(youtube\.com|youtu\.be|youtube-nocookie\.com|music\.youtube\.com)$/.test(host)) return null;
  const list = u.searchParams.get('list');
  let video = u.searchParams.get('v');
  if (host === 'youtu.be') video = u.pathname.slice(1).split('/')[0];
  const m = /^\/(?:shorts|live|embed)\/([\w-]{6,})/.exec(u.pathname);
  if (m && m[1] !== 'videoseries') video = m[1];
  const channel = (/^\/channel\/(UC[\w-]{20,})/.exec(u.pathname) || [])[1] || null;
  const handle = /^\/(@[\w.-]+|c\/[\w.-]+|user\/[\w.-]+)/.exec(u.pathname);
  return { list, video, channel, handle: handle ? handle[1] : null, url: u };
}

async function playlistInfo(list) {
  const xml = new DOMParser().parseFromString(
    await relayText('https://www.youtube.com/feeds/videos.xml?playlist_id=' + encodeURIComponent(list)), 'application/xml');
  const title = (xml.getElementsByTagName('title')[0] || {}).textContent || 'Playlist';
  const author = (xml.querySelector('author > name') || {}).textContent || 'YouTube';
  const first = xml.getElementsByTagName('yt:videoId')[0];
  if (!first) throw new Error('That playlist is empty or private.');
  return { title, channel: author, thumb: first.textContent };
}

async function resolve(raw, name) {
  const yt = ytParts(raw);
  if (yt) {
    if (yt.list && !yt.video) {
      const info = await playlistInfo(yt.list);
      return { type: 'playlist', list: yt.list, title: name || info.title, channel: info.channel, thumb: info.thumb };
    }
    if (yt.video) {
      let title = name || 'YouTube video';
      let channel = 'YouTube';
      try {
        const o = JSON.parse(await relayText('https://www.youtube.com/oembed?format=json&url=' +
          encodeURIComponent('https://www.youtube.com/watch?v=' + yt.video)));
        title = name || o.title || title;
        channel = o.author_name || channel;
      } catch { /* oEmbed is optional */ }
      return { type: 'video', video: yt.video, list: null, title, channel, thumb: yt.video };
    }
    let id = yt.channel;
    if (!id && yt.handle) {
      const html = await relayText('https://www.youtube.com/' + yt.handle);
      id = (/"externalId":"(UC[\w-]{20,})"/.exec(html) || /channel\/(UC[\w-]{20,})/.exec(html) || [])[1];
    }
    if (!id) throw new Error('Could not find that YouTube channel.');
    const xml = new DOMParser().parseFromString(
      await relayText('https://www.youtube.com/feeds/videos.xml?channel_id=' + id), 'application/xml');
    const title = (xml.getElementsByTagName('title')[0] || {}).textContent;
    if (!title) throw new Error('That YouTube channel has no public videos.');
    return { type: 'channel', channelId: id, title: name || title };
  }

  let u;
  try { u = new URL(raw); } catch { throw new Error('That is not a link. Paste a full address starting with https://'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https links work.');
  let text = '';
  try { text = await fetchText(u.href); } catch { /* unreachable now; keep it as a stream and let the player try */ }
  const entries = (text.match(/#EXTINF/g) || []).length;
  const fallback = name || decodeURIComponent(u.pathname.split('/').pop() || u.hostname).replace(/\.m3u8?$/i, '') || u.hostname;
  if (entries > 0 && !/#EXT-X-TARGETDURATION|#EXT-X-STREAM-INF/.test(text)) {
    return { type: 'm3u', url: u.href, title: name || fallback, count: entries };
  }
  return { type: 'stream', url: u.href, title: name || fallback };
}

function streamChannel(item) {
  const id = 'mine:' + item.key;
  const ch = {
    id, name: item.title, country: null, categories: [], website: null, logo: null, source: 'mine',
    via: 'Your link', streams: [{ url: item.url, quality: null, restricted: false, kind: 'hls', geo: false }],
    geo: false, external: false
  };
  mineChannels.set(id, ch);
  return ch;
}

function renderMine() {
  const list = mine();
  if (!list.length) return;
  const lessons = list.filter((x) => x.type === 'playlist' || x.type === 'video');
  if (lessons.length) el.rows.append(row('Your lessons', lessons, 'Added by you'));

  for (const ch of list.filter((x) => x.type === 'channel')) {
    const holder = document.createElement('div');
    el.rows.append(holder);
    feed({ id: ch.channelId, name: ch.title })
      .then((items) => {
        if (!items.length) { holder.remove(); return; }
        holder.replaceWith(row(ch.title, items.map((x) => ({ ...x, date: shortDate(x.published) })), 'Your channel · latest videos'));
      })
      .catch(() => holder.remove());
  }

  const streams = list.filter((x) => x.type === 'stream').map(streamChannel);
  if (streams.length && renderChannelRow) el.rows.append(renderChannelRow('Your live streams', streams, 'Captions start automatically'));

  for (const pl of list.filter((x) => x.type === 'm3u')) {
    const holder = document.createElement('div');
    el.rows.append(holder);
    fetchCustomPlaylist(pl.url)
      .then((channels) => {
        channels.forEach((c) => { c.id = 'mine:' + pl.key + ':' + c.id; c.via = pl.title; mineChannels.set(c.id, c); });
        if (!channels.length || !renderChannelRow) { holder.remove(); return; }
        holder.replaceWith(renderChannelRow(pl.title, channels.slice(0, 60), channels.length + ' channels · your playlist'));
      })
      .catch(() => holder.remove());
  }
}

const TYPE_LABEL = { channel: 'YouTube channel', playlist: 'YouTube playlist', video: 'YouTube video', stream: 'Live stream', m3u: 'Channel playlist' };

function renderMineList() {
  el.mineList.innerHTML = '';
  const list = mine();
  el.mineEmpty.hidden = list.length > 0;
  for (const item of list) {
    const li = document.createElement('li');
    const text = document.createElement('div');
    const b = document.createElement('strong');
    b.textContent = item.title;
    const small = document.createElement('span');
    small.textContent = TYPE_LABEL[item.type] + (item.count ? ' · ' + item.count + ' channels' : '');
    text.append(b, small);
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'icon-btn';
    rm.setAttribute('aria-label', 'Remove ' + item.title);
    rm.dataset.tip = 'Remove';
    rm.innerHTML = '<svg class="i"><use href="#i-close"/></svg>';
    rm.addEventListener('click', () => {
      saveMine(mine().filter((x) => x.key !== item.key));
      renderMineList();
      render();
    });
    li.append(text, rm);
    el.mineList.append(li);
  }
}

async function addMine(e) {
  e.preventDefault();
  const raw = el.mineUrl.value.trim();
  const name = el.mineName.value.trim();
  if (!raw) return;
  el.mineAdd.disabled = true;
  el.mineMsg.className = 'mine-msg';
  el.mineMsg.textContent = 'Checking the link…';
  try {
    const item = await resolve(raw, name);
    item.key = (item.channelId || item.list || item.video || item.url || raw).replace(/[^\w-]+/g, '').slice(-60) || String(Date.now());
    if (mine().some((x) => x.key === item.key)) throw new Error('You already added that.');
    saveMine(mine().concat(item));
    el.mineUrl.value = '';
    el.mineName.value = '';
    el.mineMsg.textContent = 'Added “' + item.title + '” (' + TYPE_LABEL[item.type].toLowerCase() + ').';
    renderMineList();
    render();
  } catch (err) {
    el.mineMsg.className = 'mine-msg err';
    el.mineMsg.textContent = /HTTP|fetch|Failed/i.test(String(err.message))
      ? 'Could not check that link. YouTube links need PrismTV running through serve.sh.'
      : String(err.message || err);
  } finally {
    el.mineAdd.disabled = false;
  }
}

/* ---------------- player (YouTube embed) ---------------- */
function embedUrl(item) {
  const params = new URLSearchParams({
    autoplay: '1', cc_load_policy: '1', cc_lang_pref: 'en', hl: 'en',
    rel: '0', modestbranding: '1', playsinline: '1'
  });
  if (item.list) {
    params.set('list', item.list);
    return 'https://www.youtube-nocookie.com/embed/videoseries?' + params.toString();
  }
  return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(item.video) + '?' + params.toString();
}

function openLearnLesson(item) { openYouTube(item, { learning: true }); }

/** Plays any YouTube video or playlist in this player. Outside Learn English the study tips are hidden. */
export function openYouTube(item, { learning = false } = {}) {
  current = item;
  if (learning) {
    remember({
      key: item.list || item.video, list: item.list || null, video: item.video || null,
      thumb: item.thumb, title: item.title, channel: item.channel
    });
  }
  el.tips.hidden = !learning;
  el.kicker.textContent = learning ? 'Learn English' : 'YouTube';
  el.frame.src = embedUrl(item);
  el.title.textContent = item.title;
  el.sub.textContent = item.channel + (item.list && learning ? ' · full course' : '');
  el.link.href = item.list ? 'https://www.youtube.com/playlist?list=' + item.list
    : 'https://www.youtube.com/watch?v=' + item.video;
  el.root.hidden = false;
  overlayOpened('lplayer', () => closeLesson(true));
  document.body.classList.add('player-open');
  el.close.focus();
}

function closeLesson(fromHistory = false) {
  if (!current) return;
  if (!fromHistory) overlayClosed('lplayer');
  current = null;
  el.frame.src = 'about:blank';
  el.root.hidden = true;
  document.body.classList.remove('player-open');
  if (!el.section.hidden) render();   // refresh "Continue learning"
}

export function initLearn({ getPractice, channelRow } = {}) {
  if (getPractice) practice = getPractice;
  if (channelRow) renderChannelRow = channelRow;
  Object.assign(el, {
    section: document.getElementById('learn'),
    rows: document.getElementById('learn-rows'),
    levels: document.getElementById('learn-levels'),
    root: document.getElementById('lplayer'),
    frame: document.getElementById('lframe'),
    title: document.getElementById('lplayer-title'),
    sub: document.getElementById('lplayer-sub'),
    link: document.getElementById('lplayer-link'),
    close: document.getElementById('lplayer-close'),
    tips: document.getElementById('lplayer-tips'),
    kicker: document.querySelector('#lplayer-kicker span'),
    mineBtn: document.getElementById('learn-add-btn'),
    minePanel: document.getElementById('learn-add'),
    mineForm: document.getElementById('learn-add-form'),
    mineUrl: document.getElementById('learn-add-url'),
    mineName: document.getElementById('learn-add-name'),
    mineAdd: document.getElementById('learn-add-submit'),
    mineMsg: document.getElementById('learn-add-msg'),
    mineList: document.getElementById('learn-add-list'),
    mineEmpty: document.getElementById('learn-add-empty')
  });
  el.mineBtn.addEventListener('click', () => {
    const open = el.minePanel.hidden;
    el.minePanel.hidden = !open;
    el.mineBtn.setAttribute('aria-expanded', String(open));
    if (open) { renderMineList(); el.mineUrl.focus(); }
  });
  el.mineForm.addEventListener('submit', addMine);
  document.addEventListener('click', (e) => {
    const c = e.target.closest('.lcard[data-learn]');
    if (!c) return;
    try { openLearnLesson(JSON.parse(c.dataset.learn)); } catch { /* malformed card */ }
  });
  el.close.addEventListener('click', () => closeLesson());
  el.root.addEventListener('mousedown', (e) => { if (e.target === el.root) closeLesson(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current && !document.fullscreenElement) closeLesson();
  });
}

export function showLearn() {
  if (!started) started = true;
  render();
}
