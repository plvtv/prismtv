export async function castRequest(action, key = '', data = null, deviceId = '') {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const headers = {};
    if (key) headers['X-Prism-Cast-Key'] = key;
    if (deviceId) headers['X-Prism-Receiver-Id'] = deviceId;
    if (data !== null) headers['Content-Type'] = 'application/json';
    const res = await fetch('/api/cast/' + action, {
      method: data === null ? 'GET' : 'POST', headers,
      body: data === null ? undefined : JSON.stringify(data), cache: 'no-store', signal: ctl.signal
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(result.error || 'Could not reach the cast server. Start PrismTV with ./serve.sh --lan.');
      error.status = res.status;
      throw error;
    }
    return result;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The cast server did not respond. Check your Wi-Fi connection.');
    throw err;
  } finally { clearTimeout(timer); }
}

export function contentType(url, live = false) {
  if (live || /\.m3u8(?:[?#]|$)/i.test(url)) return 'application/x-mpegURL';
  if (/\.webm(?:[?#]|$)/i.test(url)) return 'video/webm';
  if (/\.(?:ogv|ogg)(?:[?#]|$)/i.test(url)) return 'video/ogg';
  return 'video/mp4';
}
