import { STREAM_TIMEOUT_MS, MAX_AUTO_ATTEMPTS } from './config.js';
import { myList, watchHistory } from './store.js';
import { createSideItem, createSideGroup, toast, icon, hashHue } from './ui.js';
import { bridge, probeBridge, playInMpv, relayUrl } from './bridge.js';
import { overlayOpened, overlayClosed, enableSwipeFullscreen, enterFullscreen, exitFullscreen } from './mobile.js';
import {
  createAutoCaptions, isSupported as autoSupported, translationSupported,
  LANGUAGES, languageName, baseLanguage, guessLanguage
} from './autocc.js';

const el = {
  root: document.getElementById('player'),
  video: document.getElementById('video'),
  overlay: document.getElementById('player-overlay'),
  status: document.getElementById('player-status'),
  logo: document.getElementById('player-logo'),
  name: document.getElementById('player-name'),
  sub: document.getElementById('player-sub'),
  source: document.getElementById('player-source'),
  fav: document.getElementById('player-fav'),
  copy: document.getElementById('player-copy'),
  check: document.getElementById('player-check'),
  mpv: document.getElementById('player-mpv'),
  close: document.getElementById('player-close'),
  inner: document.getElementById('player-inner'),
  side: document.getElementById('player-side'),
  sideList: document.getElementById('side-list'),
  sideToggle: document.getElementById('player-side-toggle'),
  autoplay: document.getElementById('side-autoplay'),
  stage: document.getElementById('player-stage'),
  stageArt: document.getElementById('stage-art'),
  cc: document.getElementById('player-cc'),
  ccMenu: document.getElementById('cc-menu'),
  autocc: document.getElementById('autocc'),
  fs: document.getElementById('player-fs')
};

const PREF_SIDE = 'prismtv.sideOpen';
const PREF_AUTO = 'prismtv.autoplay';
function pref(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; }
}
function setPref(key, value) {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* ignore */ }
}

let hls = null;
let timer = null;
let retryTimer = null;
let current = null;    // channel being played
let sourceIndex = 0;
let attempts = 0;      // automatic failovers used for this channel
let onFavouriteChange = () => {};
let relatedFor = () => [];
let related = [];   // [{ channel, subtitle, group }] currently in the rail
let probe = [];     // per-source diagnosis, same order as current.streams
let relayed = new Set(); // source indexes that play through the local relay
let probing = false;

/* ---------------- source diagnostics ----------------
 * A browser cannot spoof its location, but it can tell you WHY a source failed,
 * which is the part that is actually actionable:
 *   ok        - the manifest loaded, this source should play
 *   forbidden - the server answered 401/403; that is what region-locking looks like
 *   missing   - 404/410, the link is simply dead
 *   blocked   - the server is reachable but refuses cross-origin reads (fine in VLC)
 *   relay     - blocked, but plays through serve.py's relay on localhost
 *   offline   - nothing answered at all
 */
const PROBE_TIMEOUT_MS = 6000;
const PROBE_CONCURRENCY = 8;

const PROBE_LABEL = {
  ok: '\u2713 playable',
  forbidden: '\u26a0 refused (403 \u2014 usually region-locked)',
  missing: '\u2715 dead link (404)',
  blocked: '\u2298 browser-blocked (works in VLC)',
  relay: '\u2713 playable via local relay',
  offline: '\u2715 no response',
  error: '\u26a0 server error'
};

async function probeSource(url) {
  const attempt = (mode) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
    return fetch(url, { mode, signal: ctl.signal, cache: 'no-store', redirect: 'follow' })
      .finally(() => clearTimeout(timer));
  };
  try {
    const res = await attempt('cors');
    if (res.ok) return 'ok';
    if (res.status === 401 || res.status === 403) return 'forbidden';
    if (res.status === 404 || res.status === 410) return 'missing';
    return 'error';
  } catch {
    // A CORS refusal and a dead host both throw here. An opaque request
    // separates them: it resolves whenever the server answered at all.
    try { await attempt('no-cors'); } catch { return 'offline'; }
    // Reachable but blocked: if serve.py is running, see whether it can fetch it instead.
    if (!bridge().relay) return 'blocked';
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS * 2);
      const res = await fetch(relayUrl(url), { signal: ctl.signal, cache: 'no-store' }).finally(() => clearTimeout(t));
      return res.ok ? 'relay' : 'blocked';
    } catch { return 'blocked'; }
  }
}

async function runProbe({ auto = false } = {}) {
  if (probing || !current) return;
  probing = true;
  const channel = current;
  el.check.disabled = true;
  el.check.classList.add('busy');
  el.check.dataset.tip = 'Testing every source\u2026';

  const urls = channel.streams.map((s) => s.url);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, urls.length) }, async () => {
    while (cursor < urls.length) {
      const i = cursor++;
      const st = channel.streams[i];
      const verdict = (st.kind && st.kind !== 'hls') ? 'external'
        // the source on screen is playing: that is a better test than any probe
        : (i === sourceIndex && el.stage.classList.contains('is-playing')) ? 'ok'
        : await probeSource(urls[i]);
      if (current !== channel) return;          // viewer moved on
      probe[i] = verdict;
      renderSources();
    }
  });
  await Promise.all(workers);

  probing = false;
  el.check.disabled = false;
  el.check.classList.remove('busy');
  el.check.dataset.tip = 'Test every source';
  if (current !== channel) return;

  // Only ever switch when nothing is playing. A working stream is never interrupted.
  const playingNow = el.stage.classList.contains('is-playing');
  probe.forEach((v, i) => { if (v === 'relay') relayed.add(i); });
  const firstOk = probe.indexOf('ok') !== -1 ? probe.indexOf('ok') : probe.indexOf('relay');
  if (!playingNow && firstOk !== -1 && (auto || !['ok', 'relay'].includes(probe[sourceIndex]))) {
    selectSource(firstOk);
    return;
  }
  if (auto) { reportProbe(); return; }
  const ok = (tally().ok || 0) + (tally().relay || 0);
  toast(ok + ' of ' + current.streams.length + ' source' + (current.streams.length === 1 ? '' : 's') + ' respond \u2014 labelled in the Source list');
}

function tally() {
  const counts = {};
  for (const verdict of probe) if (verdict) counts[verdict] = (counts[verdict] || 0) + 1;
  return counts;
}

function reportProbe() {
  const counts = tally();
  const total = current.streams.length;
  const chips = [];
  if (counts.ok) chips.push('<b class="ok">' + counts.ok + ' playable</b>');
  if (counts.relay) chips.push('<b class="ok">' + counts.relay + ' via relay</b>');
  if (counts.forbidden) chips.push('<b class="geo">' + counts.forbidden + ' refused (403)</b>');
  if (counts.blocked) chips.push('<b>' + counts.blocked + ' browser-blocked</b>');
  if (counts.missing) chips.push('<b>' + counts.missing + ' dead</b>');
  if (counts.offline) chips.push('<b>' + counts.offline + ' no response</b>');
  if (counts.error) chips.push('<b>' + counts.error + ' errored</b>');

  let verdict;
  if (counts.ok || counts.relay) {
    verdict = 'Found a working source \u2014 switching to it.';
  } else if ((counts.forbidden || 0) >= Math.max(2, total * 0.4)) {
    verdict = 'Most sources answered but <strong>refused this connection</strong>. That is what a ' +
      'region lock looks like, and nothing inside this page can change it \u2014 your apparent location ' +
      'comes from your network, not from the app. A VPN or a source published for your region is the ' +
      'only fix.';
  } else if ((counts.blocked || 0) >= Math.max(2, total * 0.4)) {
    verdict = 'The servers are up but refuse cross-origin reads, so no browser can play them. ' +
      (bridge().mpv
        ? 'mpv is not a browser and ignores that entirely \u2014 send it there.'
        : 'Use <strong>Copy link</strong> and open it in VLC.');
  } else {
    verdict = 'These links are simply down. The public index carries a lot of dead entries \u2014 ' +
      'try another channel, or <strong>Copy link</strong> for VLC.';
  }
  showStatus('Tested all ' + total + ' source' + (total === 1 ? '' : 's') + '.' +
    '<div class="probe-summary">' + chips.join('') + '</div><br>' + verdict);
  if (!counts.ok && !counts.relay) offerMpv();
}

function clearTimers() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
}

function teardown() {
  clearTimers();
  // Cancel every listener this attempt registered *before* touching the element,
  // so resetting it cannot fire a stale 'error' into the next source.
  if (session) { session.ctl.abort(); clearTimeout(session.waitTimer); session = null; }
  if (hls) { hls.destroy(); hls = null; }
  el.video.removeAttribute('src');
  el.video.load();
  el.video.controls = false;
  el.stage.querySelectorAll('.stage-frame').forEach((f) => f.remove());
  el.stage.classList.remove('is-playing', 'is-embed');
  resetCaptions();
}

/* ---------------- YouTube / Twitch channels, played inside the page ----------------
 * Their official embedded players accept a video id, a channel's live stream (by channel id)
 * or a Twitch channel name. Links like youtube.com/@name/live carry no id, so
 * data/youtube-live.json (tools/build-youtube-live.py) maps them to one.
 */
let ytLiveMap = null;
function youtubeLiveMap() {
  if (!ytLiveMap) ytLiveMap = fetch('data/youtube-live.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return ytLiveMap;
}
async function embedUrl(stream) {
  const u = stream.url;
  const yt = 'autoplay=1&playsinline=1&rel=0&modestbranding=1';
  if (stream.kind === 'twitch') {
    const m = /twitch\.tv\/(?:videos\/)?([\w]+)/i.exec(u);
    return m ? { src: 'https://player.twitch.tv/?channel=' + m[1] + '&parent=' + location.hostname + '&autoplay=true', watch: u } : null;
  }
  let m = /[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})|\/(?:live|embed|shorts)\/([\w-]{11})(?:[/?#]|$)/.exec(u);
  if (m) {
    const v = m[1] || m[2] || m[3];
    return { src: 'https://www.youtube.com/embed/' + v + '?' + yt, watch: 'https://www.youtube.com/watch?v=' + v };
  }
  const map = await youtubeLiveMap();
  const channels = map.c || map;           // older files were a flat link -> channel map
  m = /\/channel\/(UC[\w-]{22})/.exec(u);
  const id = (m && m[1]) || channels[u];
  if (!id) return null;
  // The channel's current live video: fresh from serve.py at home, else from the daily build.
  let video = null;
  try {
    const res = await fetch('/api/ytlive?channel=' + id, { cache: 'no-store' });
    if (res.ok) video = (await res.json()).video;
  } catch { /* public website: no serve.py */ }
  video = video || (map.v || {})[id];
  if (video) return { src: 'https://www.youtube.com/embed/' + video + '?' + yt, watch: 'https://www.youtube.com/watch?v=' + video };
  // Last resort: YouTube's "this channel's live stream" shortcut (sometimes says unavailable).
  return { src: 'https://www.youtube.com/embed/live_stream?channel=' + id + '&' + yt, watch: u };
}
async function playEmbed(stream) {
  const site = stream.kind === 'youtube' ? 'YouTube' : 'Twitch';
  showStatus('Opening the ' + site + ' player\u2026', true);
  const embed = await embedUrl(stream);
  if (!current || current.streams[sourceIndex] !== stream) return;       // viewer moved on
  if (!embed) { showExternal(stream); return; }
  const frame = document.createElement('iframe');
  frame.className = 'stage-frame';
  frame.title = current.name;
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.src = embed.src;
  // Escape hatch when the channel refuses to play outside YouTube.
  const out = document.createElement('a');
  out.className = 'stage-frame stage-out';
  out.href = embed.watch;
  out.target = '_blank';
  out.rel = 'noreferrer';
  out.innerHTML = icon('external') + 'Watch on ' + site;
  el.stage.append(frame, out);
  el.stage.classList.add('is-playing', 'is-embed');
  clearTimers();
  hideStatus();
}

function showStatus(html, loading = false) {
  el.status.innerHTML = html;
  el.overlay.classList.toggle('is-loading', loading);
  el.overlay.hidden = false;
}

/** Autoplay was refused (common without a prior click): offer a real Play button. */
function readyToPlay() {
  clearTimers();                     // the stream is fine; don't time it out
  showStatus('Ready when you are.');
  el.video.controls = true;
  const row = document.createElement('div');
  row.style.cssText = 'margin-top:14px;display:flex;justify-content:center';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-play';
  btn.innerHTML = icon('play') + 'Play';
  btn.addEventListener('click', () => el.video.play().catch(() => {}));
  row.append(btn);
  el.status.append(row);
}
function hideStatus() {
  el.overlay.hidden = true;
}

/* ---------------- handing off to mpv ----------------
 * A browser is a poor IPTV client: it blocks cross-origin streams, cannot set a
 * User-Agent or Referer, and cannot open a YouTube or Twitch page. mpv has none
 * of those limits, so when the local helper is running we offer it everywhere a
 * stream is hard to play -- and it is the only way to play a page-URL entry.
 */
function mpvBlocker() {
  const state = bridge();
  if (!state.available) {
    return 'The local mpv helper is not running. Start the app with ./serve.sh instead of a plain static server.';
  }
  if (!state.mpv) {
    return 'mpv is not installed on this machine. Install it with:  brew install mpv yt-dlp';
  }
  return null;
}

async function sendToMpv(url, isPage) {
  const blocker = mpvBlocker();
  if (blocker) { showStatus(blocker); return; }
  try {
    const result = await playInMpv(url, current && current.name);
    if (isPage && !result.ytdlp) {
      showStatus('Handed to mpv, but yt-dlp is not installed so it cannot resolve a ' +
        'YouTube or Twitch page. Install it with:  brew install yt-dlp');
    } else {
      toast('Playing in mpv');
    }
  } catch (err) {
    showStatus('mpv could not start: ' + err.message + (err.hint ? '  (' + err.hint + ')' : ''));
  }
}

function mpvButton(url, { label = 'Play in mpv', ghost = false, isPage = false } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn ' + (ghost ? 'btn-ghost' : 'btn-play');
  btn.innerHTML = icon('screen') + label;
  btn.addEventListener('click', () => sendToMpv(url, isPage));
  return btn;
}

/** Offer mpv underneath whatever the overlay is currently saying. */
function offerMpv() {
  if (!bridge().mpv || !current) return;
  const row = document.createElement('div');
  row.style.cssText = 'margin-top:16px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap';
  row.append(mpvButton(current.streams[sourceIndex].url, { label: 'Play in mpv instead' }));
  el.status.append(row);
}

function giveUp(reason) {
  teardown();
  if (el.autoplay.checked && related.length) {
    const next = related[0];
    showStatus(reason + ' \u2014 autoplaying <strong>' + next.channel.name + '</strong>\u2026', true);
    retryTimer = setTimeout(() => openPlayer(next.channel, { subtitle: next.subtitle }), 1400);
    return;
  }
  const total = current.streams.length;
  if (!probing && !probe.some(Boolean)) {
    showStatus(reason + '. Testing all ' + total + ' source' + (total === 1 ? '' : 's') +
      ' to find out why\u2026', true);
    runProbe({ auto: true });
    return;
  }
  showStatus(
    reason + '. Tried ' + attempts + ' of ' + total + ' published source' + (total === 1 ? '' : 's') + '.<br><br>' +
    'Use <strong>Test sources</strong> for a per-source verdict, or <strong>Copy link</strong> to try it in VLC.'
  );
  offerMpv();
}

/** The moment we decide to leave a source, it stops being able to influence anything. */
function retireSession() {
  if (session) session.ctl.abort();       // a dying source often fires several errors in a row
  if (hls) hls.stopLoad();
  el.stage.classList.remove('is-playing');
}

function nextSource(reason) {
  if (!current) return;
  retireSession();
  attempts += 1;
  if (attempts >= MAX_AUTO_ATTEMPTS || sourceIndex + 1 >= current.streams.length) {
    giveUp(reason);
    return;
  }
  sourceIndex += 1;
  el.source.value = String(sourceIndex);
  showStatus(reason + ' — trying source ' + (sourceIndex + 1) + ' of ' + current.streams.length + '…', true);
  // Breathe between attempts so a run of instant failures does not flicker.
  clearTimers();
  retryTimer = setTimeout(attach, 450);
}

/** YouTube / Twitch entries are web pages, not streams: hand the viewer a link out. */
function showExternal(stream) {
  const site = stream.kind === 'youtube' ? 'YouTube' : 'Twitch';
  const state = bridge();
  el.status.textContent = current.name + ' is published as a ' + site +
    ' live page rather than a direct stream, so the browser cannot play it.' +
    (state.mpv ? ' mpv can, by resolving it with yt-dlp.' : '');

  const row = document.createElement('div');
  row.style.cssText = 'margin-top:16px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap';
  if (state.mpv) row.append(mpvButton(stream.url, { isPage: true }));

  const link = document.createElement('a');
  link.className = 'btn ' + (state.mpv ? 'btn-ghost' : 'btn-play');
  link.href = stream.url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.innerHTML = icon('external') + 'Open on ' + site;
  row.append(link);

  el.status.append(row);
  el.overlay.classList.remove('is-loading');
  el.overlay.hidden = false;
}

/* ---------------- playback lifecycle ----------------
 * Two very different situations used to share one error path:
 *   before the first frame -> the source never started: fail over to the next.
 *   after the first frame  -> a live server hiccuped: reconnect to the SAME source.
 * Each attempt gets a fresh <video> and one AbortController for everything it
 * registers, so nothing from an earlier source can fire into a later one.
 */
const RECONNECT_LIMIT = 4;       // in-place reconnects before a playing source is abandoned
const FIRST_FRAME_MS = 25000;    // once the server has answered, time allowed for a first frame
let session = null;              // { ctl, started, reconnects, mediaFixes, waitTimer }

function armTimeout(ms, reason) {
  clearTimeout(timer);
  timer = setTimeout(() => nextSource(reason), ms);
}

function freshVideo() {
  const video = document.createElement('video');
  video.id = 'video';
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  // The native fullscreen button would take only the <video>, leaving our captions behind.
  video.setAttribute('controlslist', 'nofullscreen');
  el.video.replaceWith(video);
  el.video = video;
}

/* ---------------- captions ----------------
 * Two kinds, one button:
 *  - broadcast captions: CEA-608/708 inside the stream, or WebVTT renditions in the
 *    playlist. hls.js exposes them as native TextTracks, styled via video::cue.
 *  - auto-captions: speech recognition over the channel's own audio (autocc.js),
 *    for streams that carry none, or whenever the viewer picks it.
 * With captions on, a channel gets its broadcast captions if it has them and falls
 * back to auto-captions if it doesn't, much as YouTube does.
 */
const PREF_CC = 'prismtv.captions';
const PREF_CC_LANG = 'prismtv.captionsLang';
const PREF_AUTO_TRANSLATE = 'prismtv.autoTranslate';
const AUTO_LANGS_KEY = 'prismtv.autoLangs';       // { channelId: 'te-IN' }, most recent last
const AUTO_FALLBACK_MS = 2500;                     // let broadcast captions show up first
const AUTO_SUPPORTED = autoSupported();

let autoExplicit = false;     // the viewer picked auto-captions for this channel
let autoBroken = false;       // the speech service refused: don't keep retrying this channel
let autoFallbackTimer = null;
let autoState = { status: '', translate: 'off', progress: 0, message: '' };

const auto = createAutoCaptions({
  layer: el.autocc,
  onState(update) {
    autoState = { ...autoState, ...update };
    if (update.status === 'error') {
      autoExplicit = false;
      autoBroken = true;
      toast(update.message);
      syncCaptions();
    }
    refreshCaptionMenu();
  }
});

function readAutoLangs() {
  try { return JSON.parse(localStorage.getItem(AUTO_LANGS_KEY) || '{}') || {}; } catch { return {}; }
}
function autoLangFor(channel) {
  return readAutoLangs()[channel.id] || guessLanguage(channel);
}
function rememberAutoLang(channel, code) {
  const map = readAutoLangs();
  delete map[channel.id];
  map[channel.id] = code;
  const keys = Object.keys(map);
  while (keys.length > 300) delete map[keys.shift()];
  try { localStorage.setItem(AUTO_LANGS_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

function ccTracks() {
  return [...el.video.textTracks].filter((t) => t.kind === 'captions' || t.kind === 'subtitles');
}
function shownTrack() {
  return ccTracks().find((t) => t.mode === 'showing') || null;
}
function trackName(track, i) {
  return track.label || (track.language ? track.language.toUpperCase() : 'Track ' + (i + 1));
}
function preferredTrack() {
  const tracks = ccTracks();
  let want = '';
  try { want = localStorage.getItem(PREF_CC_LANG) || ''; } catch { /* ignore */ }
  return tracks.find((t) => want && (t.language === want || t.label === want)) || tracks[0] || null;
}
function applyTrack(track) {
  for (const t of ccTracks()) t.mode = t === track ? 'showing' : 'disabled';
}

function startAuto(explicit) {
  if (!AUTO_SUPPORTED || !current) return;
  clearTimeout(autoFallbackTimer);
  autoExplicit = explicit;
  applyTrack(null);
  auto.start(el.video, { lang: autoLangFor(current), translate: pref(PREF_AUTO_TRANSLATE, false) });
  syncCaptions();
}
function stopAuto() {
  clearTimeout(autoFallbackTimer);
  if (auto.active) auto.stop();
  autoExplicit = false;
}

/** A viewer's choice of a broadcast track (or Off): apply it and remember it. */
function chooseTrack(track) {
  stopAuto();
  applyTrack(track);
  setPref(PREF_CC, Boolean(track));
  if (track) {
    try { localStorage.setItem(PREF_CC_LANG, track.language || track.label || ''); } catch { /* ignore */ }
  }
  syncCaptions();
}
function chooseAuto() {
  autoBroken = false;
  setPref(PREF_CC, true);
  startAuto(true);
}

/** Keep what's on screen in line with the remembered preference as tracks appear. */
function enforceCaptionPref() {
  const shown = shownTrack();
  if (auto.active && autoExplicit) { if (shown) applyTrack(null); return; }   // chosen: leave it be
  const want = pref(PREF_CC, false);
  if (want && !shown) {
    const t = preferredTrack();
    if (t) { if (auto.active) auto.stop(); applyTrack(t); }                  // real beats generated
  }
  if (!want && shown) applyTrack(null);
}

/** Runs whenever a source starts or resumes playing. */
function onPlaybackStarted() {
  if (!AUTO_SUPPORTED || auto.active || autoBroken || !current) return;
  if (autoExplicit) { startAuto(true); return; }
  if (!pref(PREF_CC, false)) return;
  clearTimeout(autoFallbackTimer);
  autoFallbackTimer = setTimeout(() => {
    if (!current || shownTrack() || auto.active || !el.stage.classList.contains('is-playing')) return;
    startAuto(false);
  }, AUTO_FALLBACK_MS);
}

function toggleCaptions() {
  if (shownTrack() || auto.active) { chooseTrack(null); toast('Captions off'); return; }
  if (ccTracks().length) { chooseTrack(preferredTrack()); toast('Captions on'); return; }
  if (AUTO_SUPPORTED) {
    if (!el.stage.classList.contains('is-playing')) {
      setPref(PREF_CC, true);
      toast('Captions will start when the stream plays');
      return;
    }
    chooseAuto();
    toast('Auto-captions on · ' + languageName(auto.lang));
    return;
  }
  toast('No captions in this stream');
}

function syncCaptions() {
  const tracks = ccTracks();
  const usable = tracks.length > 0 || AUTO_SUPPORTED;
  const on = Boolean(shownTrack()) || auto.active;
  el.cc.disabled = !usable;
  el.cc.classList.toggle('on', on);
  el.cc.setAttribute('aria-pressed', String(on));
  el.cc.dataset.tip = auto.active ? 'Auto-captions · ' + languageName(auto.lang)
    : shownTrack() ? 'Captions on · C'
    : usable ? 'Captions · C' : 'No captions detected';
  el.cc.setAttribute('aria-label', el.cc.dataset.tip);
  if (!usable) closeCaptionMenu();
  else refreshCaptionMenu();
}
function resetCaptions() {
  clearTimeout(autoFallbackTimer);
  if (auto.active) auto.stop();       // the engine stops; the viewer's intent (autoExplicit) survives
  closeCaptionMenu();
  el.cc.classList.remove('on');
  el.cc.setAttribute('aria-pressed', 'false');
  el.cc.disabled = !AUTO_SUPPORTED;
  el.cc.dataset.tip = AUTO_SUPPORTED ? 'Captions · C' : 'No captions detected';
}
function watchCaptions(video, signal) {
  const onChange = () => { enforceCaptionPref(); syncCaptions(); };
  video.textTracks.addEventListener('addtrack', onChange, { signal });
  video.textTracks.addEventListener('removetrack', syncCaptions, { signal });
  video.textTracks.addEventListener('change', onChange, { signal });
  // no point streaming silence to the speech service while paused
  video.addEventListener('pause', () => { if (auto.active) { auto.stop(); syncCaptions(); } }, { signal });
}

/* ---------------- the CC menu ---------------- */
function autoStatusText() {
  if (!AUTO_SUPPORTED) return '';
  const lang = languageName(auto.active ? auto.lang : current ? autoLangFor(current) : 'en-US');
  if (pref(PREF_AUTO_TRANSLATE, false)) {
    const tr = autoState.translate;
    if (tr === 'unsupported') return 'Translation needs Chrome 138 or newer on a computer.';
    if (tr === 'unavailable') return 'Chrome can’t translate ' + lang + ' to English yet.';
    if (tr === 'downloading') return 'Downloading the ' + lang + ' → English translator… ' + Math.round((autoState.progress || 0) * 100) + '%';
    if (tr === 'error') return 'Translation failed: ' + autoState.message;
  }
  if (!auto.active) return '';
  if (autoState.status === 'waiting-audio') return 'Waiting for sound…';
  if (autoState.status === 'listening') return 'Listening for ' + lang + '…';
  if (autoState.status === 'live') return 'Live · ' + lang + (auto.translating ? ' → English' : '');
  return '';
}

function menuItem(key, label, sub, onPick) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'cc-item';
  item.dataset.key = key;
  item.setAttribute('role', 'menuitemradio');
  item.innerHTML = icon('check');
  const text = document.createElement('span');
  text.className = 'cc-text';
  const main = document.createElement('span');
  main.textContent = label;
  text.append(main);
  if (sub) { const small = document.createElement('small'); small.textContent = sub; text.append(small); }
  item.append(text);
  item.addEventListener('click', () => { onPick(); closeCaptionMenu(); el.cc.focus(); });
  return item;
}

function renderCaptionMenu() {
  const m = el.ccMenu;
  const tracks = ccTracks();
  m.innerHTML = '';
  const head = (t) => { const h = document.createElement('div'); h.className = 'cc-head'; h.textContent = t; m.append(h); };
  const note = (t) => { const p = document.createElement('p'); p.className = 'cc-note'; p.textContent = t; m.append(p); };

  head('Captions');
  m.append(menuItem('off', 'Off', '', () => chooseTrack(null)));
  tracks.forEach((t, i) => m.append(menuItem('track-' + i, trackName(t, i), 'From the broadcast', () => chooseTrack(t))));

  const sep = document.createElement('div');
  sep.className = 'cc-sep';
  m.append(sep);
  head('Auto-generated');
  if (!AUTO_SUPPORTED) {
    note('Generating captions from the audio needs Chrome or Edge on a computer.');
    refreshCaptionMenu();
    return;
  }
  m.append(menuItem('auto', 'Auto-captions', 'Generated from the audio', () => chooseAuto()));

  const langRow = document.createElement('label');
  langRow.className = 'cc-field';
  const langLabel = document.createElement('span');
  langLabel.textContent = 'Spoken language';
  const wrap = document.createElement('span');
  wrap.className = 'select select-sm';
  const sel = document.createElement('select');
  sel.id = 'cc-lang';
  for (const [code, name] of LANGUAGES) {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = name;
    sel.append(o);
  }
  sel.value = auto.active ? auto.lang : current ? autoLangFor(current) : 'en-US';
  sel.addEventListener('change', () => {
    if (!current) return;
    rememberAutoLang(current, sel.value);
    if (auto.active) { auto.setLanguage(sel.value); syncCaptions(); }
    else chooseAuto();
    refreshCaptionMenu();
  });
  wrap.append(sel);
  langRow.append(langLabel, wrap);
  m.append(langRow);

  const tr = document.createElement('label');
  tr.className = 'switch switch-sm cc-switch';
  tr.innerHTML = '<input type="checkbox" id="cc-translate"><i></i><span>Translate to English</span>';
  const box = tr.querySelector('input');
  box.checked = pref(PREF_AUTO_TRANSLATE, false);
  box.addEventListener('change', () => {
    setPref(PREF_AUTO_TRANSLATE, box.checked);
    if (auto.active) auto.setTranslate(box.checked);
    else if (box.checked) chooseAuto();
    refreshCaptionMenu();
  });
  m.append(tr);

  const status = document.createElement('p');
  status.className = 'cc-status';
  status.id = 'cc-status';
  m.append(status);
  note('While on, the channel’s audio is sent to Google’s speech service. Translation runs on this computer.');
  refreshCaptionMenu();
}

/** Update checks and status in place, so a menu the viewer is using never rebuilds under them. */
function refreshCaptionMenu() {
  if (el.ccMenu.hidden) return;
  const tracks = ccTracks();
  if (el.ccMenu.querySelectorAll('[data-key^="track-"]').length !== tracks.length &&
      !el.ccMenu.contains(document.activeElement)) {
    renderCaptionMenu();
    return;
  }
  const shown = shownTrack();
  el.ccMenu.querySelectorAll('.cc-item').forEach((item) => {
    const key = item.dataset.key;
    const on = key === 'auto' ? auto.active
      : key === 'off' ? !shown && !auto.active
      : !auto.active && shown === tracks[Number(key.slice(6))];
    item.classList.toggle('on', on);
    item.setAttribute('aria-checked', String(on));
  });
  const status = document.getElementById('cc-status');
  if (status) status.textContent = autoStatusText();
  const sel = document.getElementById('cc-lang');
  const box = document.getElementById('cc-translate');
  if (sel && box) box.disabled = baseLanguage(sel.value) === 'en' || !translationSupported();
}

function openCaptionMenu() {
  el.ccMenu.hidden = false;
  renderCaptionMenu();
  el.cc.setAttribute('aria-expanded', 'true');
}
function closeCaptionMenu() {
  el.ccMenu.hidden = true;
  el.cc.setAttribute('aria-expanded', 'false');
}

function attach() {
  const stream = current.streams[sourceIndex];
  teardown();
  if (stream.kind && stream.kind !== 'hls') { playEmbed(stream); return; }

  freshVideo();
  const video = el.video;
  const viaRelay = relayed.has(sourceIndex) && bridge().relay;
  const src = viaRelay ? relayUrl(stream.url) : stream.url;
  const s = session = { ctl: new AbortController(), started: false, reconnects: 0, mediaFixes: 0, waitTimer: null };
  const { signal } = s.ctl;

  showStatus('Connecting to source ' + (sourceIndex + 1) + (viaRelay ? ' through the local relay' : '') + '…', true);
  armTimeout(STREAM_TIMEOUT_MS, 'Timed out');

  video.addEventListener('playing', () => {
    s.started = true;
    s.reconnects = 0;
    clearTimeout(timer);
    clearTimeout(s.waitTimer);
    hideStatus();
    video.controls = true;
    el.stage.classList.add('is-playing');
    onPlaybackStarted();
  }, { signal });

  // Short stalls are normal on live streams; only mention one that lingers.
  video.addEventListener('waiting', () => {
    if (!s.started) return;
    clearTimeout(s.waitTimer);
    s.waitTimer = setTimeout(() => showStatus('Buffering…', true), 1500);
  }, { signal });

  const reconnect = (restart) => {
    s.reconnects += 1;
    const msg = 'Connection dropped — reconnecting (' + s.reconnects + ' of ' + RECONNECT_LIMIT + ')…';
    // Still playing from buffer? Say so quietly instead of covering a picture that's still moving.
    if (!video.paused && video.readyState >= 3) toast(msg);
    else showStatus(msg, true);
    retryTimer = setTimeout(() => { if (!signal.aborted) restart(); }, 1000 * s.reconnects);
  };
  const lost = () => 'Source ' + (sourceIndex + 1) + ' dropped and did not come back';

  watchCaptions(video, signal);

  if (window.Hls && window.Hls.isSupported()) {
    const Hls = window.Hls;
    const h = hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 60,
      enableCEA708Captions: true,     // captions embedded in the broadcast
      enableWebVTT: true,             // subtitle renditions listed in the playlist
      renderTextTracksNatively: true  // expose both as <video> text tracks
    });
    h.on(Hls.Events.MANIFEST_PARSED, () => {
      if (signal.aborted) return;
      armTimeout(FIRST_FRAME_MS, 'Timed out');          // the server answered: give it real time
      video.play().catch(readyToPlay);
    });
    h.on(Hls.Events.FRAG_LOADED, () => {
      if (signal.aborted) return;
      if (!s.started) { armTimeout(FIRST_FRAME_MS, 'Timed out'); return; }  // data is flowing, not dead
      if (s.reconnects) { s.reconnects = 0; hideStatus(); }               // recovered without a stall
    });
    h.on(Hls.Events.ERROR, (_evt, data) => {
      if (signal.aborted || !data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && s.mediaFixes < 2) {
        s.mediaFixes += 1;
        if (s.mediaFixes === 2) h.swapAudioCodec();
        h.recoverMediaError();
        return;
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && s.started && s.reconnects < RECONNECT_LIMIT) {
        reconnect(() => h.startLoad());
        return;
      }
      const blocked = data.details === 'manifestLoadError' && data.response && data.response.code === 0;
      // Browser-blocked before any picture: retry this same source through serve.py, once.
      if (!s.started && !viaRelay && bridge().relay && data.type === Hls.ErrorTypes.NETWORK_ERROR &&
          data.response && data.response.code === 0) {
        relayed.add(sourceIndex);
        retireSession();
        showStatus('Source blocked this browser \u2014 retrying through the local relay\u2026', true);
        clearTimers();
        retryTimer = setTimeout(attach, 200);
        return;
      }
      nextSource(s.started ? lost() : blocked ? 'Source blocked this browser' : 'Source unreachable');
    });
    h.loadSource(src);
    h.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.addEventListener('loadedmetadata', () => armTimeout(FIRST_FRAME_MS, 'Timed out'), { signal, once: true });
    video.addEventListener('error', () => {
      if (s.started && s.reconnects < RECONNECT_LIMIT) {
        reconnect(() => { video.src = src; video.play().catch(() => {}); });
        return;
      }
      nextSource(s.started ? lost() : 'Source unreachable');
    }, { signal });
    video.src = src;
    video.play().catch(readyToPlay);
  } else {
    clearTimers();
    showStatus('This browser cannot play HLS streams.');
  }
}

function selectSource(i) {
  sourceIndex = i;
  attempts = 0;             // a manual pick resets the automatic budget
  el.source.value = String(i);
  attach();
}

function renderSources() {
  el.source.innerHTML = '';
  current.streams.forEach((s, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    const bits = ['Source ' + (i + 1)];
    if (s.quality) bits.push(s.quality);
    if (s.restricted) bits.push('needs headers');
    if (s.geo) bits.push('geo-flagged');
    if (s.kind === 'youtube') bits.push('YouTube page');
    if (s.kind === 'twitch') bits.push('Twitch page');
    if (probe[i]) bits.push(PROBE_LABEL[probe[i]] || probe[i]);
    else if (relayed.has(i)) bits.push('via local relay');
    opt.textContent = bits.join(' · ');
    el.source.append(opt);
  });
  el.source.value = String(sourceIndex);
  el.source.parentElement.hidden = current.streams.length < 2;
}

function renderSide() {
  related = relatedFor(current) || [];
  el.sideList.innerHTML = '';
  if (!related.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Nothing related to show.';
    el.sideList.append(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  let group = null;
  let n = 0;
  for (const entry of related) {
    if (entry.group && entry.group !== group) {
      group = entry.group;
      frag.append(createSideGroup(group));
    }
    const item = createSideItem(entry.channel, entry.subtitle);
    item.style.setProperty('--i', String(n++));
    item.addEventListener('click', () => openPlayer(entry.channel, { subtitle: entry.subtitle }));
    frag.append(item);
  }
  el.sideList.append(frag);
  el.sideList.scrollTop = 0;
}

function syncFav() {
  const on = myList.has(current.id);
  el.fav.classList.toggle('on', on);
  el.fav.setAttribute('aria-pressed', String(on));
  el.fav.dataset.tip = on ? 'In My List' : 'Add to My List';
  el.fav.setAttribute('aria-label', el.fav.dataset.tip);
}

export function openPlayer(channel, meta = {}) {
  if (!current || current.id !== channel.id) { autoExplicit = false; autoBroken = false; }
  if (meta.captions) autoExplicit = true;   // e.g. English practice: start auto-captions on play
  current = channel;
  sourceIndex = 0;
  attempts = 0;
  probe = new Array(channel.streams.length).fill(null);
  relayed = new Set();
  el.check.disabled = false;
  el.check.classList.remove('busy');
  el.check.dataset.tip = 'Test every source';
  clearTimeout(closeTimer);
  el.root.classList.remove('closing');
  el.root.hidden = false;
  overlayOpened('player', () => closePlayer({ fromHistory: true }));
  document.body.style.overflow = 'hidden';
  document.body.classList.add('player-open');
  el.stage.style.setProperty('--h', String(hashHue(channel.id)));
  el.stageArt.onerror = () => { el.stageArt.hidden = true; };
  if (channel.logo) { el.stageArt.hidden = false; el.stageArt.src = channel.logo; }
  else { el.stageArt.hidden = true; el.stageArt.removeAttribute('src'); }
  el.name.textContent = channel.name;
  el.sub.textContent = meta.subtitle || '';
  el.logo.onerror = () => { el.logo.hidden = true; };
  if (channel.logo) { el.logo.hidden = false; el.logo.src = channel.logo; }
  else { el.logo.removeAttribute('src'); el.logo.hidden = true; }
  renderSources();
  renderSide();
  syncFav();
  el.copy.classList.remove('on');
  el.copy.dataset.tip = 'Copy stream link';
  watchHistory.push(channel.id);
  attach();
}

/* ---------------- fullscreen ----------------
 * Fullscreen the stage, not the <video>: the stage holds the captions, status
 * messages and backdrop, which a fullscreened <video> would leave behind.
 */
function toggleFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) { exitFullscreen(); return; }
  enterFullscreen(el.stage, el.video);      // iPhone: falls back to the video's own full screen
}

function syncFullscreen() {
  const on = document.fullscreenElement === el.stage;
  el.fs.classList.toggle('on', on);
  el.fs.dataset.tip = on ? 'Exit full screen \u00b7 F' : 'Full screen \u00b7 F';
  el.fs.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
  auto.relayout();
  if (on) toast('C captions \u00b7 F or Esc to exit');
}

let closeTimer = null;
export function closePlayer({ fromHistory = false } = {}) {
  if (el.root.hidden || el.root.classList.contains('closing')) return;
  if (!fromHistory) overlayClosed('player');   // drop the history entry the player added
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  teardown();
  current = null;
  document.body.style.overflow = '';
  document.body.classList.remove('player-open');
  el.root.classList.add('closing');
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    el.root.hidden = true;
    el.root.classList.remove('closing');
  }, 240);
}

export function initPlayer({ onFavourite, getRelated } = {}) {
  onFavouriteChange = onFavourite || (() => {});
  relatedFor = getRelated || (() => []);

  const sideOpen = pref(PREF_SIDE, true);
  el.inner.classList.toggle('no-side', !sideOpen);
  el.sideToggle.classList.toggle('on', sideOpen);
  el.autoplay.checked = pref(PREF_AUTO, false);

  el.sideToggle.addEventListener('click', () => {
    const open = el.inner.classList.toggle('no-side') === false;
    el.sideToggle.classList.toggle('on', open);
    setPref(PREF_SIDE, open);
  });
  el.autoplay.addEventListener('change', () => setPref(PREF_AUTO, el.autoplay.checked));
  el.check.addEventListener('click', () => runProbe({ auto: false }));
  el.mpv.addEventListener('click', () => {
    if (!current) return;
    const stream = current.streams[sourceIndex];
    sendToMpv(stream.url, Boolean(stream.kind && stream.kind !== 'hls'));
  });
  probeBridge().then((state) => {
    el.mpv.hidden = !state.available || state.remote;
    el.mpv.dataset.tip = state.mpv ? 'Play in mpv' : 'mpv not installed';
  });
  el.close.addEventListener('click', () => closePlayer());
  enableSwipeFullscreen(el.stage, el.stage, () => el.video);
  el.root.addEventListener('mousedown', (e) => { if (e.target === el.root) closePlayer(); });
  el.source.addEventListener('change', () => selectSource(Number(el.source.value)));
  el.fav.addEventListener('click', () => {
    if (!current) return;
    myList.toggle(current.id);
    syncFav();
    onFavouriteChange(current.id);
  });
  el.copy.addEventListener('click', async () => {
    if (!current) return;
    const url = current.streams[sourceIndex].url;
    try {
      await navigator.clipboard.writeText(url);
      el.copy.classList.add('on');
      el.copy.dataset.tip = 'Copied';
      toast('Stream link copied');
    } catch {
      window.prompt('Stream URL', url);
    }
    setTimeout(() => { el.copy.classList.remove('on'); el.copy.dataset.tip = 'Copy stream link'; }, 2000);
  });
  el.cc.addEventListener('click', (e) => {
    e.stopPropagation();
    // One broadcast track and nothing else to offer: CC is a simple switch.
    if (!AUTO_SUPPORTED && ccTracks().length === 1) { toggleCaptions(); return; }
    if (el.ccMenu.hidden) openCaptionMenu(); else closeCaptionMenu();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!el.ccMenu.hidden && !e.target.closest('.cc-wrap')) closeCaptionMenu();
  });
  resetCaptions();

  el.fs.addEventListener('click', toggleFullscreen);
  el.stage.addEventListener('dblclick', (e) => {
    if (e.target.closest('.autocc-panel, .player-overlay .msg')) return;
    toggleFullscreen();
  });
  document.addEventListener('fullscreenchange', syncFullscreen);
  // Captions are laid out in real pixels: redo it when the player changes size or fonts arrive.
  if ('ResizeObserver' in window) new ResizeObserver(() => auto.relayout()).observe(el.stage);
  if (document.fonts) document.fonts.addEventListener('loadingdone', () => auto.relayout());

  document.addEventListener('keydown', (e) => {
    if (el.root.hidden) return;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if (e.key === 'Escape') {
      if (document.fullscreenElement) return;      // Esc belongs to the browser: it exits fullscreen
      if (!el.ccMenu.hidden) { closeCaptionMenu(); el.cc.focus(); return; }
      closePlayer();
      return;
    }
    if (typing) return;
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    if (e.key === 'c' || e.key === 'C') toggleCaptions();
    if (e.key === ' ') { e.preventDefault(); el.video.paused ? el.video.play() : el.video.pause(); }
  });

  // Test hook (only with ?debug in the URL): lets automated checks inspect playback state.
  if (new URLSearchParams(location.search).has('debug')) {
    window.__player = {
      get hls() { return hls; },
      get sourceIndex() { return sourceIndex; },
      get session() { return session; },
      get video() { return el.video; },
      open: openPlayer,
      get autoCaptions() { return auto; }
    };
  }
}
