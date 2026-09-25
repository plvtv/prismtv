/**
 * Talks to serve.py, the local helper that can hand a URL to mpv.
 *
 * Everything here degrades quietly: if the app is being served by a plain static
 * server the health check just 404s, `available` stays false, and the UI hides
 * every mpv affordance.
 */
let state = { available: false, mpv: false, ytdlp: false, relay: false, remote: false };

export function bridge() {
  return state;
}

export async function probeBridge() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) throw new Error('no bridge');
    const data = await res.json();
    // remote: this page was opened from another device on the home network (mpv would play on the Mac).
    state = { available: true, mpv: Boolean(data.mpv), ytdlp: Boolean(data.ytdlp), relay: Boolean(data.relay), remote: data.thisMac === false };
  } catch {
    state = { available: false, mpv: false, ytdlp: false, relay: false, remote: false };
  }
  return state;
}

export async function playInMpv(url, title) {
  const query = new URLSearchParams({ url, title: title || '' });
  const res = await fetch('/api/play?' + query.toString(), { cache: 'no-store' });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const err = new Error(data.error || 'The helper returned HTTP ' + res.status);
    err.hint = data.hint;
    throw err;
  }
  return data;
}

/**
 * The same stream, fetched by serve.py and served from localhost. Used only for
 * sources whose servers refuse cross-origin reads, which the browser cannot play directly.
 */
export function relayUrl(url) {
  return '/api/hls?url=' + encodeURIComponent(url);
}
