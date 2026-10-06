import { castRequest } from './cast-api.js';

const key = location.hash.slice(1);
const el = Object.fromEntries(['setup', 'stage', 'title', 'status', 'play', 'retry', 'fullscreen', 'name', 'connect', 'leave'].map((name) => [name, document.getElementById('receive-' + name)]));
let deviceId = '', timer = null, busy = false;
let revision = -1, mediaRevision = -1, generation = 0;
let media = null, video = null, hls = null, relayTried = false;
let phase = 'ready', message = '', desiredPaused = false;

function status(text, nextPhase = phase) {
  el.status.textContent = text; phase = nextPhase; message = text;
  el.play.hidden = nextPhase !== 'needs-play';
  el.retry.hidden = nextPhase !== 'error' || !media;
}
function resetPlayer() {
  generation += 1;
  if (hls) { hls.destroy(); hls = null; }
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); video = null; }
  el.stage.replaceChildren();
  el.stage.hidden = true; el.fullscreen.hidden = true;
}
async function play() {
  if (!video) return;
  const playingVideo = video, token = generation;
  try { await playingVideo.play(); }
  catch (err) {
    if (token !== generation) return;
    if (err.name === 'NotAllowedError') status('Tap Play on this device to allow video and sound.', 'needs-play');
    else if (err.name !== 'AbortError') status('This source could not play here. Retry it or choose another source in PrismTV.', 'error');
  }
}
function startHls(url, token) {
  if (hls) hls.destroy();
  const instance = hls = new window.Hls({ enableWorker: true, backBufferLength: 30 });
  instance.on(window.Hls.Events.MANIFEST_PARSED, () => { if (token === generation && !desiredPaused) play(); });
  instance.on(window.Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal || token !== generation) return;
    if (!relayTried && data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
      relayTried = true;
      startHls('/api/hls?url=' + encodeURIComponent(media.url), token);
    } else status('The stream is unavailable on this device. Retry or choose another source.', 'error');
  });
  instance.loadSource(url); instance.attachMedia(video);
}
function loadMedia(next) {
  resetPlayer(); media = next; relayTried = false;
  el.title.textContent = media?.title || '';
  if (!media) { status('Connected. Choose this device in PrismTV’s Cast panel.', 'ready'); return; }
  el.stage.hidden = false; el.fullscreen.hidden = false;
  status('Loading “' + media.title + '”…', 'loading');
  const token = generation;
  if (media.kind === 'embed') {
    const url = new URL(media.url);
    if (!((['www.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname) && url.pathname.startsWith('/embed/')) || url.hostname === 'player.twitch.tv')) {
      status('This embedded source is not supported.', 'error'); return;
    }
    if (url.hostname === 'player.twitch.tv') url.searchParams.set('parent', location.hostname);
    const frame = document.createElement('iframe');
    frame.title = media.title; frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true; frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.addEventListener('load', () => {
      if (token === generation) status('Video opened. Use its controls here; if embedding is blocked, open it in the provider’s app.', 'embedded');
    });
    frame.src = url.href; el.stage.append(frame); return;
  }
  const playingVideo = video = document.createElement('video');
  video.controls = true; video.playsInline = true; video.preload = 'auto';
  video.setAttribute('x-webkit-airplay', 'allow');
  const current = () => token === generation;
  video.addEventListener('loadedmetadata', () => {
    if (!current()) return;
    if (!media.live && media.position > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(media.position, Math.max(0, video.duration - 1));
    if (!desiredPaused) play();
  });
  video.addEventListener('playing', () => {
    if (!current()) return;
    desiredPaused = false;
    status('Playing on this device.', 'playing');
  });
  video.addEventListener('pause', () => { if (current() && phase !== 'needs-play' && phase !== 'error') status('Paused on this device.', 'paused'); });
  video.addEventListener('ended', () => { if (current()) status('Video finished. Choose another video in PrismTV.', 'paused'); });
  video.addEventListener('error', () => {
    if (!current()) return;
    if (media.kind === 'hls' && !relayTried && !hls) {
      relayTried = true; playingVideo.src = '/api/hls?url=' + encodeURIComponent(media.url);
    } else status('This video could not load. Retry or choose another source.', 'error');
  });
  el.stage.append(video);
  if (media.kind === 'hls' && window.Hls?.isSupported()) startHls(media.url, token);
  else video.src = media.url;
}
async function poll() {
  if (busy || !deviceId) return;
  busy = true;
  const joinedId = deviceId;
  try {
    const state = await castRequest('state', key, null, joinedId);
    if (deviceId !== joinedId) return;
    if (state.revision !== revision) {
      desiredPaused = state.command === 'pause';
      if (state.mediaRevision !== mediaRevision) { mediaRevision = state.mediaRevision; loadMedia(state.media); }
      if (state.command === 'pause' && video) video.pause();
      if (state.command === 'play' && video) { desiredPaused = false; play(); }
      revision = state.revision;
    }
    await castRequest('report', key, {
      deviceId: joinedId, phase, paused: video ? video.paused : true,
      position: Number.isFinite(video?.currentTime) ? video.currentTime : 0, message
    });
  } catch (err) {
    if (deviceId !== joinedId) return;
    if (err.status === 404) { clearInterval(timer); deviceId = ''; resetPlayer(); el.setup.hidden = false; el.connect.disabled = true; el.leave.hidden = true; }
    el.status.textContent = err.status === 404 ? err.message : 'Connection lost. Reconnecting to PrismTV…';
  } finally { busy = false; }
}
document.getElementById('receive-connect-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (deviceId) return;
  el.connect.disabled = true;
  try {
    const result = await castRequest('join', key, { name: el.name.value.trim() });
    deviceId = result.deviceId; el.setup.hidden = true; el.leave.hidden = false;
    status('Connected. Select “' + el.name.value.trim() + '” in PrismTV’s Cast panel.', 'ready');
    timer = setInterval(poll, 1200); poll();
  } catch (err) { status(err.message, 'error'); }
  finally { el.connect.disabled = !key; }
});
el.leave.addEventListener('click', async () => {
  const leavingId = deviceId;
  deviceId = ''; clearInterval(timer); resetPlayer(); media = null;
  revision = -1; mediaRevision = -1;
  el.setup.hidden = false; el.leave.hidden = true; el.title.textContent = '';
  try { await castRequest('leave', key, { deviceId: leavingId }); }
  catch { /* A disconnected page also ages out of the device list. */ }
  status('Disconnected. Connect again to receive another video.', 'ready');
});
el.play.addEventListener('click', () => { desiredPaused = false; play(); });
el.retry.addEventListener('click', () => { desiredPaused = false; loadMedia(media); });
el.fullscreen.addEventListener('click', async () => {
  try {
    if (el.stage.requestFullscreen) await el.stage.requestFullscreen();
    else video?.webkitEnterFullscreen?.();
  } catch { status('Use the video’s full-screen control on this browser.'); }
});
if (!/^[A-Za-z0-9_-]{32}$/.test(key)) {
  el.connect.disabled = true;
  status('Open the receiving link from PrismTV’s Cast panel. This page needs a pairing link.');
} else status('Give this device a name, then connect it to PrismTV.');
