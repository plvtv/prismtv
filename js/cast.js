import { castFailure, describeMedia, castPhase, timeLabel } from './cast-state.js';
import { icon, toast } from './ui.js';
import { castRequest, castingInfo } from './cast-api.js';
import { loadQr } from './qr.js';

let context = null, sdkLoading = null;
let panel = null, pair = null, active = null;
let pollTimer = null, polling = false;
const bindings = [];
let controlTimer = null, observedSession = null, observedMedia = null, pending = false, failure = null;
const SESSION_MARKER = 'prismtv:cast-session';
function rememberSession(connected) {
  try { if (connected) localStorage.setItem(SESSION_MARKER, '1'); else localStorage.removeItem(SESSION_MARKER); } catch { /* Storage can be unavailable. */ }
}
function syncGoogle() {
  const session = context?.getCurrentSession();
  if (!session) {
    if (active?.kind === 'google') { active = null; rememberSession(false); tell('Disconnected from the TV.'); }
    updateButtons(); renderControls(); return;
  }
  if (session !== observedSession) {
    if (observedSession) for (const type of Object.values(window.cast.framework.SessionEventType || {})) observedSession.removeEventListener?.(type, syncGoogle);
    observedSession = session;
    for (const name of ['MEDIA_SESSION', 'VOLUME_CHANGED']) {
      const type = window.cast.framework.SessionEventType?.[name];
      if (type) session.addEventListener(type, syncGoogle);
    }
  }
  const remote = session.getMediaSession();
  if (remote !== observedMedia) {
    observedMedia?.removeUpdateListener?.(syncGoogle); observedMedia = remote;
    remote?.addUpdateListener?.(syncGoogle);
  }
  const media = describeMedia(remote);
  active = { ...((active?.kind === 'google') ? active : {}), kind:'google', name:session.getCastDevice()?.friendlyName || 'TV',
    media:media || active?.media, phase:castPhase(remote), paused:remote?.playerState === 'PAUSED' };
  rememberSession(true); updateButtons(); renderControls();
}
function showFailure(error, phase) {
  const message = castFailure(error, phase);
  if (!message) { syncGoogle(); return; }
  failure = message; tell(message); renderControls();
}
function mediaPosition() {
  const remote=context?.getCurrentSession()?.getMediaSession();
  const time=remote?.getEstimatedTime?.() ?? remote?.currentTime ?? 0;
  return Number.isFinite(time) ? Math.max(0,time) : 0;
}
function matchingBinding() {
  return bindings.find(b => !b.root.hidden && b.getMedia()?.url === active?.media?.url && b.getMedia()?.kind !== 'embed');
}


function tell(message) {
  if (panel) panel.node.querySelector('.cast-status').textContent = message;
}
function updateButtons() {
  const connected = !!active || !!context?.getCurrentSession();
  for (const { button } of bindings) {
    button.classList.toggle('on', connected);
    button.setAttribute('aria-label', connected ? 'Casting · device controls' : 'Cast to a TV or another device');
  }
}
function loadGoogleCast() {
  if (context) return Promise.resolve(true);
  if (sdkLoading) return sdkLoading;
  if (!window.isSecureContext) return Promise.resolve(false);
  sdkLoading = new Promise((resolve) => {
    let timer;
    const ready = (available) => {
      clearTimeout(timer);
      if (!available || !window.cast?.framework || !window.chrome?.cast) { resolve(false); return; }
      try {
        context = window.cast.framework.CastContext.getInstance();
        context.setOptions({
          receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
        });
        context.addEventListener(window.cast.framework.CastContextEventType.SESSION_STATE_CHANGED, syncGoogle);
        syncGoogle();
        resolve(true);
      } catch { context = null; resolve(false); }
    };
    window.__onGCastApiAvailable = ready;
    if (window.cast?.framework) { ready(true); return; }
    const script = document.createElement('script');
    script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    script.onerror = () => { clearTimeout(timer); sdkLoading = null; script.remove(); resolve(false); };
    timer = setTimeout(() => resolve(false), 10000);
    document.head.append(script);
  });
  const attempt = sdkLoading;
  attempt.then(ok => { if (!ok && sdkLoading === attempt) sdkLoading = null; });
  return attempt;
}

function mediaNow(binding) {
  const media = binding.getMedia();
  if (!media?.url || !/^https?:\/\//i.test(media.url)) throw new Error('Wait for the video to load, then try casting again.');
  const time = binding.getVideo?.()?.currentTime;
  return { ...media, position: Number.isFinite(time) && !media.live ? time : 0 };
}
function pauseLocal(binding, media) {
  if (binding.getMedia()?.url !== media.url) return;
  if (binding.suspend) binding.suspend();
  else binding.getVideo?.()?.pause();
}
async function stop() {
  if (active?.kind === 'pair' && pair) {
    await castRequest('command', pair.key, { deviceId: active.id, command: 'stop' });
  } else if (context?.getCurrentSession()) context.getCurrentSession().endSession(true);
  active = null; failure = null; rememberSession(false);
  updateButtons(); renderControls();
  tell('Casting stopped. Use Play in PrismTV to watch on this device.');
}
async function sendGoogle(binding) {
  if (pending) return;
  pending = true; failure = null; renderControls();
  let phase = 'connect';
  try {
    const media = mediaNow(binding);
    if (media.kind === 'embed') throw new Error('Open this video in its provider’s app for native TV casting.');
    if (!await loadGoogleCast()) throw new Error('Google Cast is unavailable here. Try Google Chrome on HTTPS or localhost. Chrome on iPhone/iPad does not support Google Cast.');
    tell('Connecting to a Chromecast TV…');
    if (!context.getCurrentSession()) await context.requestSession();
    const session = context.getCurrentSession();
    if (!session) return;
    const api = window.chrome.cast.media;
    const info = new api.MediaInfo(media.url, media.contentType || 'video/mp4');
    info.streamType = media.live ? api.StreamType.LIVE : api.StreamType.BUFFERED;
    info.metadata = new api.GenericMediaMetadata(); info.metadata.title = media.title || 'PrismTV';
    const request = new api.LoadRequest(info); request.autoplay = true;
    if (!media.live) request.currentTime = media.position;
    phase = 'load'; tell('Loading on ' + (session.getCastDevice()?.friendlyName || 'TV') + '…');
    await session.loadMedia(request);
    if (active?.kind === 'pair' && pair) await castRequest('command', pair.key, {deviceId:active.id,command:'stop'}).catch(()=>{});
    active = {kind:'google',media,name:session.getCastDevice()?.friendlyName || 'TV'};
    pauseLocal(binding, media); syncGoogle();
  } catch (error) { showFailure(error, phase); }
  finally { pending = false; renderControls(); }
}
function renderControls() {
  if (!panel) return;
  const controls = panel.node.querySelector('.cast-controls');
  panel.node.querySelector('[data-action="google"]').disabled = pending;
  panel.node.querySelector('.cast-recovery').hidden = !failure;
  if (failure) tell(failure);
  controls.hidden = !active && !context?.getCurrentSession();
  const toggle = controls.querySelector('[data-action="toggle"]');
  toggle.disabled = active?.media?.kind === 'embed';
  const paused = active?.paused ?? context?.getCurrentSession()?.getMediaSession()?.playerState === 'PAUSED';
  toggle.textContent = paused ? 'Play' : 'Pause';
  const session = context?.getCurrentSession(), remote = session?.getMediaSession();
  const google = active?.kind === 'google' && !!session;
  panel.node.querySelector('.cast-tv-controls').hidden = !google;
  toggle.disabled = pending || active?.media?.kind === 'embed' || google && (!remote || remote.playerState === 'IDLE');
  const resume = controls.querySelector('[data-action="resume"]');
  resume.hidden = !google; resume.disabled = pending || !matchingBinding();
  resume.title = resume.disabled ? 'Open the video currently playing on the TV in PrismTV to resume it here.' : '';
  if (google) {
    const duration = remote?.media?.duration;
    const seek = panel.node.querySelector('[data-control="seek"]');
    const seekable = !active.media?.live && Number.isFinite(duration) && duration > 0 && !!remote?.seek && remote.playerState !== 'IDLE';
    seek.closest('label').hidden = !seekable; seek.disabled = pending;
    if (seekable && document.activeElement !== seek) { seek.max = duration; seek.value = Math.min(mediaPosition(),duration); }
    panel.node.querySelector('.cast-time').textContent = seekable ? timeLabel(mediaPosition()) + ' / ' + timeLabel(duration) : active.media?.live ? 'Live broadcast' : '';
    const volume = panel.node.querySelector('[data-control="volume"]');
    const level = session.getVolume?.(); volume.disabled = !Number.isFinite(level);
    if (Number.isFinite(level) && document.activeElement !== volume) volume.value = Math.round(level*100);
    const mute = panel.node.querySelector('[data-action="mute"]');
    mute.disabled = typeof session.isMute?.() !== 'boolean'; mute.textContent = session.isMute?.() ? 'Unmute TV' : 'Mute TV'; mute.setAttribute('aria-pressed',String(!!session.isMute?.()));
    if (!failure && !pending) {
      const state = {playing:'Playing',paused:'Paused',loading:'Loading',finished:'Finished',connected:'Connected',error:'Playback failed'}[active.phase] || 'Connected';
      tell(state + ' on ' + active.name + (active.media?.title ? ': ' + active.media.title : '.'));
      if (active.phase === 'error') { failure = 'The TV could not play this source. Retry or choose another source.'; panel.node.querySelector('.cast-recovery').hidden = false; tell(failure); }
    }
  }
  if (active?.kind === 'pair' && active.phase) {
    tell(active.phase === 'needs-play' ? 'Connected to ' + active.name + '. Tap Play on that device to allow sound.'
      : active.phase === 'error' ? active.message || 'This source could not play on the receiving device. Try another source.'
      : active.phase === 'ready' ? active.name + ' is ready. Select it to send this video.'
      : active.phase === 'loading' ? 'Loading on ' + active.name + '…'
      : active.phase === 'embedded' ? 'Opened “' + active.media.title + '” on ' + active.name + '. Use the video controls on that device.'
      : (paused ? 'Paused on ' : 'Playing on ') + active.name + ': ' + active.media.title);
  }
}
async function togglePlayback() {
  if (active?.kind === 'pair') {
    await castRequest('command', pair.key, { deviceId: active.id, command: active.paused ? 'play' : 'pause' });
  } else {
    const media = context?.getCurrentSession()?.getMediaSession();
    if (!media) return;
    const api = window.chrome.cast.media;
    await new Promise((resolve, reject) => media.playerState === api.PlayerState.PAUSED
      ? media.play(new api.PlayRequest(), resolve, reject) : media.pause(new api.PauseRequest(), resolve, reject));
    renderControls();
  }
}
async function resumeHere() {
  const binding = matchingBinding();
  if (!binding) throw new Error('Open the video playing on the TV in PrismTV first.');
  const position = active.media.live ? 0 : mediaPosition();
  await stop();
  if (binding.resume) await binding.resume(position);
  else {
    const video=binding.getVideo();
    if (position > 0) video.currentTime = position;
    await video.play();
  }
  tell('Casting stopped. Playback is returning to this device.');
}
async function seekTo(position) {
  const media = context?.getCurrentSession()?.getMediaSession();
  if (!media || active?.media?.live) return;
  const duration = media.media?.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const request = new window.chrome.cast.media.SeekRequest();
  request.currentTime = Math.max(0,Math.min(Number(position),duration));
  await new Promise((resolve,reject)=>media.seek(request,resolve,reject)); syncGoogle();
}
async function sendPaired(binding, device) {
  const media = mediaNow(binding);
  await castRequest('command', pair.key, { deviceId: device.id, command: 'load', media });
  if (active?.kind === 'pair' && active.id !== device.id) await castRequest('command', pair.key, { deviceId: active.id, command: 'stop' }).catch(() => {});
  context?.getCurrentSession()?.endSession(true);
  active = { kind: 'pair', id: device.id, name: device.name, media, paused: false, phase: 'loading' };
  pauseLocal(binding, media);
  updateButtons(); renderControls(); startPolling();
}
async function poll() {
  if (polling || !pair || (!panel && active?.kind !== 'pair')) return;
  polling = true;
  try {
    const result = await castRequest('state', pair.key);
    const devices = result.devices || [];
    if (active?.kind === 'pair') {
      const device = devices.find((d) => d.id === active.id);
      if (device) { active = { ...active, ...device, media: active.media }; renderControls(); }
      else { active = null; updateButtons(); renderControls(); tell('The receiving device went offline. Reconnect it using the pairing link.'); }
    }
    if (panel) {
      const list = panel.node.querySelector('.cast-devices');
      const signature = JSON.stringify(devices.map((d) => [d.id, d.name]));
      if (list.dataset.signature !== signature) {
        list.dataset.signature = signature;
        list.replaceChildren();
        for (const device of devices) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'cast-option';
          button.innerHTML = icon('screen');
          const name = document.createElement('span'); name.textContent = device.name;
          button.append(name);
          button.addEventListener('click', () => run(() => sendPaired(panel.binding, device)));
          list.append(button);
        }
        if (!devices.length) { const note = document.createElement('p'); note.className = 'prefs-note'; note.textContent = 'Waiting for a device. Open the link below, then tap Connect this device.'; list.append(note); }
      }
    }
  } catch (err) {
    if (err.status === 404) { pair = null; active = null; clearInterval(pollTimer); pollTimer = null; updateButtons(); renderControls(); }
    tell(err.message);
  }
  finally { polling = false; }
}
function startPolling() {
  if (!pollTimer) pollTimer = setInterval(poll, 1500);
  poll();
}
async function pairDevices() {
  const opened = panel;
  const info = await castingInfo();
  if (!pair) pair = await castRequest('create', '', {});
  if (panel !== opened) return;
  const base = info.urls?.[0] || location.origin;
  const link = new URL('receive.html', base.endsWith('/') ? base : base + '/');
  link.hash = pair.receiverKey;
  const pairing = panel.node.querySelector('.cast-pairing');
  pairing.hidden = false;
  const input = pairing.querySelector('input'); input.value = link.href;
  const qr = pairing.querySelector('.cast-qr');
  qr.replaceChildren();
  startPolling();
  try {
    await loadQr();
    if (panel === opened) new window.QRCode(qr, { text: link.href, width: 168, height: 168, correctLevel: window.QRCode.CorrectLevel.M });
  } catch { /* The selectable link and copy action work without a QR code. */ }
}
async function run(action) {
  try { await action(); }
  catch (err) {
    const code = err?.code || err;
    if (code === 'cancel' || code === 'cancelled' || err?.name === 'NotAllowedError') return;
    showFailure(err);
  }
}
function closePanel() {
  if (!panel) return;
  panel.node.hidden = true;
  panel.binding.button.setAttribute('aria-expanded', 'false');
  if (!panel.binding.root.hidden) {
    const target = document.fullscreenElement?.contains(panel.binding.fullscreenButton) ? panel.binding.fullscreenButton : panel.binding.button;
    target.focus({ preventScroll: true });
  }
  panel = null; clearInterval(controlTimer); controlTimer = null;
  if (active?.kind !== 'pair') { clearInterval(pollTimer); pollTimer = null; }
}
export function bindCast({ root, button, getMedia, getVideo, suspend, resume, alternate }) {
  const binding = { root, button, getMedia, getVideo, suspend, resume, alternate };
  bindings.push(binding);
  const node = document.createElement('section');
  node.className = 'cast-panel'; node.id = button.id + '-panel'; node.hidden = true;
  node.setAttribute('aria-label', 'Cast and device controls');
  node.innerHTML = '<div class="cast-panel-head"><h3>Watch on another device</h3><button class="icon-btn" type="button" data-action="close" aria-label="Close casting controls">' + icon('close') + '</button></div>' +
    '<p class="prefs-note">Keep both devices on the same Wi-Fi.</p>' +
    '<button class="cast-option" type="button" data-action="google">' + icon('cast') + '<span>Google Cast · choose a TV</span></button>' +
    '<button class="cast-option" type="button" data-action="native">' + icon('screen') + '<span>AirPlay / browser device picker</span></button>' +
    '<button class="cast-option" type="button" data-action="pair">' + icon('link') + '<span>Connect a phone, tablet or browser TV</span></button>' +
    '<p class="cast-status prefs-note" role="status" aria-live="polite"></p>' +
    '<div class="cast-recovery" hidden><button class="text-btn" type="button" data-action="retry">Retry casting</button><button class="text-btn" type="button" data-action="alternate">Choose another source</button></div>' +
    '<div class="cast-controls" hidden><button class="text-btn" type="button" data-action="toggle">Pause</button><button class="text-btn" type="button" data-action="stop">Stop casting</button><button class="text-btn" type="button" data-action="resume">Resume on this device</button></div>' +
    '<div class="cast-tv-controls" hidden><label class="cast-slider">Movie position <input type="range" min="0" max="1" step="1" value="0" data-control="seek" aria-label="Movie position on TV"></label><p class="cast-time prefs-note"></p><label class="cast-slider">TV volume <input type="range" min="0" max="100" value="50" data-control="volume" aria-label="TV volume"></label><button class="text-btn" type="button" data-action="mute">Mute TV</button></div>' +
    '<div class="cast-pairing" hidden><div class="cast-devices"></div><p class="prefs-note">Scan or open this link on the receiving device. Keep its page open. Embedded videos use the controls on that device.</p>' +
    '<div class="cast-qr"></div><label class="field"><span class="field-label">Receiving link</span><input class="text-input" type="text" readonly></label><button class="text-btn" type="button" data-action="copy">Copy receiving link</button></div>';
  root.querySelector('[role="dialog"]').append(node);
  button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', node.id);
  button.addEventListener('click', () => {
    if (panel?.node === node) { closePanel(); return; }
    closePanel(); panel = { node, binding }; node.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    node.querySelector('[data-action="alternate"]').hidden = !binding.alternate;
    clearInterval(controlTimer); controlTimer = setInterval(() => { if (active?.kind === 'google') syncGoogle(); },1000);
    const video = getVideo?.();
    const native = node.querySelector('[data-action="native"]');
    native.hidden = !video || (!video.webkitShowPlaybackTargetPicker && !video.remote?.prompt);
    tell(window.isSecureContext ? 'Choose a TV, or connect a receiving page below.' : 'TV casting from Chrome needs HTTPS or localhost. Browser receiving works through the home-network server.');
    node.querySelector('[data-action="google"]').disabled = true;
    const currentPanel = panel;
    loadGoogleCast().then((ok) => {
      if (panel !== currentPanel) return;
      const google = node.querySelector('[data-action="google"]');
      google.disabled = pending;
      google.querySelector('span').textContent = ok ? 'Google Cast · choose a TV' : 'Google Cast unavailable · try Google Chrome';
    });
    node.querySelector('[data-action="close"]').focus();
    renderControls(); if (pair) startPolling();
  });
  node.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'close') closePanel();
    if (action === 'google' || action === 'retry') run(() => sendGoogle(binding));
    if (action === 'alternate') { closePanel(); binding.alternate?.(); }
    if (action === 'resume') run(resumeHere);
    if (action === 'mute') run(async()=>{ const session=context?.getCurrentSession(); if (session) { await session.setMute(!session.isMute()); syncGoogle(); } });
    if (action === 'pair') run(pairDevices);
    if (action === 'stop') run(stop);
    if (action === 'toggle') run(togglePlayback);
    if (action === 'native') run(async () => {
      const video = getVideo?.();
      if (!video || getMedia()?.kind === 'embed') throw new Error('Use the video’s own app for TV casting, or connect a receiving page.');
      if (video.webkitShowPlaybackTargetPicker) video.webkitShowPlaybackTargetPicker();
      else await video.remote.prompt();
    });
    if (action === 'copy') run(async () => {
      const input = node.querySelector('.cast-pairing input');
      try { await navigator.clipboard.writeText(input.value); toast('Receiving link copied'); }
      catch { input.focus(); input.select(); tell('Copy the selected link and open it on the receiving device.'); }
    });
  });
  node.addEventListener('change',event=> {
    if (event.target.dataset.control === 'seek') run(()=>seekTo(event.target.value));
    if (event.target.dataset.control === 'volume') run(async()=> { const session=context?.getCurrentSession(); if (session) { await session.setVolume(Number(event.target.value)/100); syncGoogle(); } });
  });
  installFullscreen(binding,node);
  new MutationObserver(() => { if (root.hidden && panel?.node === node) closePanel(); }).observe(root, { attributes: true, attributeFilter: ['hidden'] });
  updateButtons();
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && panel) { event.preventDefault(); event.stopImmediatePropagation(); closePanel(); }
}, true);
document.addEventListener('pointerdown', (event) => {
  if (panel && !panel.node.contains(event.target) && event.target !== panel.binding.button && !panel.binding.button.contains(event.target) && !panel.binding.fullscreenButton?.contains(event.target)) closePanel();
});

function installFullscreen(binding,node) {
  const stage=binding.root.querySelector('.player-stage, .mplayer-stage');
  if (!stage) return;
  const home=node.parentElement;
  const cast=document.createElement('button');cast.type='button';cast.className='icon-btn cast-btn cast-fullscreen';cast.setAttribute('aria-label','Cast and TV controls');cast.innerHTML=icon('cast')+'<span>Cast</span>';
  cast.addEventListener('click',()=>binding.button.click()); binding.fullscreenButton = cast; stage.append(cast);
  if (stage.classList.contains('mplayer-stage')) {
    const full=document.createElement('button');full.type='button';full.className='icon-btn cast-stage-fullscreen';full.setAttribute('aria-label','Full screen with Cast controls');full.innerHTML=icon('expand');
    full.addEventListener('click',()=>run(async()=> { if (document.fullscreenElement) await document.exitFullscreen(); else if (stage.requestFullscreen) await stage.requestFullscreen(); }));stage.append(full);
    binding.getVideo?.()?.setAttribute('controlslist','nofullscreen');
  }
  document.addEventListener('fullscreenchange',()=>{
    if (document.fullscreenElement === stage) stage.append(node); else home.append(node);
  });
}
try { if (localStorage.getItem(SESSION_MARKER)) loadGoogleCast(); } catch { /* Storage can be unavailable. */ }
