import { icon, toast } from './ui.js';
import { castRequest } from './cast-api.js';
import { loadQr } from './qr.js';

let context = null, sdkLoading = null;
let panel = null, pair = null, active = null;
let pollTimer = null, polling = false;
const bindings = [];

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
        context.addEventListener(window.cast.framework.CastContextEventType.SESSION_STATE_CHANGED, () => {
          if (!context.getCurrentSession() && active?.kind === 'google') active = null;
          updateButtons(); renderControls();
        });
        resolve(true);
      } catch { resolve(false); }
    };
    window.__onGCastApiAvailable = ready;
    if (window.cast?.framework) { ready(true); return; }
    const script = document.createElement('script');
    script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    script.onerror = () => { clearTimeout(timer); sdkLoading = null; script.remove(); resolve(false); };
    timer = setTimeout(() => resolve(false), 10000);
    document.head.append(script);
  });
  return sdkLoading;
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
  active = null;
  updateButtons(); renderControls();
  tell('Casting stopped. Use Play in PrismTV to watch on this device.');
}
async function sendGoogle(binding) {
  const media = mediaNow(binding);
  if (media.kind === 'embed') throw new Error('Open this video in the YouTube or Twitch app to use its TV casting, or connect a PrismTV receiving page below.');
  if (!await loadGoogleCast()) throw new Error('Google Cast is unavailable in this browser. Use Chrome on HTTPS or localhost, or connect a receiving page below.');
  if (!context.getCurrentSession()) await context.requestSession();
  const session = context.getCurrentSession();
  if (!session) return;
  const api = window.chrome.cast.media;
  const info = new api.MediaInfo(media.url, media.contentType || 'video/mp4');
  info.streamType = media.live ? api.StreamType.LIVE : api.StreamType.BUFFERED;
  info.metadata = new api.GenericMediaMetadata();
  info.metadata.title = media.title || 'PrismTV';
  const request = new api.LoadRequest(info);
  request.autoplay = true;
  if (!media.live) request.currentTime = media.position;
  try { await session.loadMedia(request); }
  catch { throw new Error('The TV could not load this source. Try another source; the TV must support its format and be allowed to fetch it.'); }
  if (active?.kind === 'pair' && pair) await castRequest('command', pair.key, { deviceId: active.id, command: 'stop' }).catch(() => {});
  active = { kind: 'google', media, name: session.getCastDevice()?.friendlyName || 'TV' };
  pauseLocal(binding, media);
  updateButtons(); renderControls();
  tell('Casting “' + media.title + '” to ' + active.name + '.');
}
function renderControls() {
  if (!panel) return;
  const controls = panel.node.querySelector('.cast-controls');
  controls.hidden = !active && !context?.getCurrentSession();
  const toggle = controls.querySelector('[data-action="toggle"]');
  toggle.disabled = active?.media?.kind === 'embed';
  const paused = active?.paused ?? context?.getCurrentSession()?.getMediaSession()?.playerState === 'PAUSED';
  toggle.textContent = paused ? 'Play' : 'Pause';
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
  const res = await fetch('/api/info', { cache: 'no-store' });
  if (!res.ok) throw new Error('Phone and tablet receiving needs the local server. Start PrismTV with ./serve.sh --lan.');
  const info = await res.json();
  if (!info.lan) throw new Error('Stop PrismTV in Terminal, restart with ./serve.sh --lan, then reopen Cast.');
  if (!info.casting) throw new Error('Restart the PrismTV server to enable the new casting feature.');
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
    tell(err?.message || 'Could not connect to that device. Check its Wi-Fi connection and try again.');
  }
}
function closePanel() {
  if (!panel) return;
  panel.node.hidden = true;
  panel.binding.button.setAttribute('aria-expanded', 'false');
  if (!panel.binding.root.hidden) panel.binding.button.focus({ preventScroll: true });
  panel = null;
  if (active?.kind !== 'pair') { clearInterval(pollTimer); pollTimer = null; }
}
export function bindCast({ root, button, getMedia, getVideo, suspend }) {
  const binding = { root, button, getMedia, getVideo, suspend };
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
    '<div class="cast-controls" hidden><button class="text-btn" type="button" data-action="toggle">Pause</button><button class="text-btn" type="button" data-action="stop">Stop casting</button></div>' +
    '<div class="cast-pairing" hidden><div class="cast-devices"></div><p class="prefs-note">Scan or open this link on the receiving device. Keep its page open. Embedded videos use the controls on that device.</p>' +
    '<div class="cast-qr"></div><label class="field"><span class="field-label">Receiving link</span><input class="text-input" type="text" readonly></label><button class="text-btn" type="button" data-action="copy">Copy receiving link</button></div>';
  root.querySelector('[role="dialog"]').append(node);
  button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', node.id);
  button.addEventListener('click', () => {
    if (panel?.node === node) { closePanel(); return; }
    closePanel(); panel = { node, binding }; node.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const video = getVideo?.();
    const native = node.querySelector('[data-action="native"]');
    native.hidden = !video || (!video.webkitShowPlaybackTargetPicker && !video.remote?.prompt);
    tell(window.isSecureContext ? 'Choose a TV, or connect a receiving page below.' : 'TV casting from Chrome needs HTTPS or localhost. Browser receiving works through the home-network server.');
    node.querySelector('[data-action="google"]').disabled = true;
    const currentPanel = panel;
    loadGoogleCast().then((ok) => {
      if (panel !== currentPanel) return;
      const google = node.querySelector('[data-action="google"]');
      google.disabled = !ok;
      google.querySelector('span').textContent = ok ? 'Google Cast · choose a TV' : 'Google Cast unavailable in this browser';
    });
    node.querySelector('[data-action="close"]').focus();
    renderControls(); if (pair) startPolling();
  });
  node.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'close') closePanel();
    if (action === 'google') run(() => sendGoogle(binding));
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
  new MutationObserver(() => { if (root.hidden && panel?.node === node) closePanel(); }).observe(root, { attributes: true, attributeFilter: ['hidden'] });
  updateButtons();
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && panel) { event.preventDefault(); event.stopImmediatePropagation(); closePanel(); }
}, true);
document.addEventListener('pointerdown', (event) => {
  if (panel && !panel.node.contains(event.target) && event.target !== panel.binding.button && !panel.binding.button.contains(event.target)) closePanel();
});
