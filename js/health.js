/**
 * Stream health, as checked by serve.py.
 *
 * The browser cannot test most stream servers itself (they refuse cross-origin
 * reads), so the local server checks every stream URL in the background and keeps
 * the verdicts on disk. This module reads those verdicts and decides, per channel,
 * whether anything it publishes actually answers.
 *
 * A channel is only called "dead" when every one of its streams has been checked
 * and none worked. Unchecked channels, and YouTube/Twitch pages, count as unknown
 * and are never hidden.
 */
let results = new Map();   // url -> 'ok' | 'dead' | 'forbidden'
let state = { available: false, running: false, total: 0, done: 0, finished: 0 };

export function health() { return state; }

async function getScan(withResults) {
  const res = await fetch('/api/scan' + (withResults ? '?results=1' : ''), { cache: 'no-store' });
  if (!res.ok) throw new Error('scan unavailable');
  return res.json();
}

function absorb(data) {
  state = {
    available: true,
    running: Boolean(data.running),
    total: data.total || 0,
    done: data.done || 0,
    finished: data.finished || 0
  };
  if (data.results) results = new Map(Object.entries(data.results));
}

// data/health.json codes (tools/build-health.py). On the public website there is no relay,
// so a stream whose server blocks browsers ('n') cannot play there and counts as not working.
const STATIC_CODES = { o: 'ok', n: 'blocked', f: 'forbidden', d: 'dead' };

export async function loadHealth() {
  try {
    absorb(await getScan(true));
    return state;
  } catch { /* no serve.py: try the website's daily check */ }
  try {
    const res = await fetch('data/health.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('no health.json');
    const data = await res.json();
    results = new Map(Object.entries(data.s || {}).map(([url, code]) => [url, STATIC_CODES[code] || 'dead']));
    state = { available: true, static: true, running: false, total: results.size, done: results.size, finished: data.at || 0 };
  } catch {
    state = { ...state, available: false, static: false };
  }
  return state;
}

/** Starts a background check of `urls` (stale or unchecked ones only, unless force). */
export async function startScan(urls, { force = false } = {}) {
  if (state.static) return state;          // the website's check is rebuilt daily by GitHub, not here
  const res = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, force })
  });
  if (!res.ok) throw new Error('The local server refused the scan (HTTP ' + res.status + ')');
  absorb(await res.json());
  return state;
}

let pollTimer = null;
/** Calls onTick(state) every couple of seconds while a scan runs, then onDone(state). */
export function watchScan(onTick, onDone) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const data = await getScan(false);
      absorb(data);
      if (!data.running) {
        clearInterval(pollTimer);
        absorb(await getScan(true));
        onDone(state);
      } else {
        onTick(state);
      }
    } catch {
      clearInterval(pollTimer);
      state = { ...state, available: false, running: false };
      onDone(state);
    }
  }, 2000);
}

export function knownCount() { return results.size; }

/** 'ok', 'dead' or 'unknown' for a channel. */
export function channelHealth(channel) {
  const hls = channel.streams.filter((s) => !s.kind || s.kind === 'hls');
  if (!hls.length) return 'unknown';
  let checked = 0;
  for (const s of hls) {
    const v = results.get(s.url);
    if (v === 'ok') return 'ok';
    if (v) checked += 1;
  }
  return checked === hls.length ? 'dead' : 'unknown';
}

/** Every checkable stream URL, first sources first so early results cover the most channels. */
export function streamUrls(channels) {
  const out = [];
  const maxLen = channels.reduce((m, c) => Math.max(m, c.streams.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const c of channels) {
      const s = c.streams[i];
      if (s && (!s.kind || s.kind === 'hls')) out.push(s.url);
    }
  }
  return out;
}
