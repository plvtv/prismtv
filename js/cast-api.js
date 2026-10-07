let configuration;
export async function castConfiguration() {
  if (!configuration) configuration = fetch(new URL('../data/cast-config.json', import.meta.url), {cache:'no-store'})
    .then(r=>r.ok?r.json():{}).catch(()=>({})).then(c=>{
      if (!c.endpoint) return {endpoint:''};
      const u=new URL(c.endpoint);
      if(u.protocol!=='https:' || u.username || u.password || u.search || u.hash) throw new Error('The hosted casting address must be a valid HTTPS URL.');
      return {endpoint:u.href.replace(/\/$/,'')};
    });
  return configuration;
}
export async function castingInfo() {
  const config=await castConfiguration();
  if(config.endpoint) return {casting:true,hosted:true,urls:[new URL('../',import.meta.url).href]};
  const res=await fetch('/api/info',{cache:'no-store'});
  if(!res.ok) throw new Error('Phone/tablet pairing on this website needs the hosted cast service to be configured. Google Cast can be used separately in Chrome.');
  const info=await res.json();
  if(!info.lan) throw new Error('Use ./serve.sh --lan for local pairing, or configure the hosted cast service to pair without LAN mode.');
  if(!info.casting) throw new Error('Restart PrismTV to enable casting.');
  return info;
}

export async function castRequest(action, key = '', data = null, deviceId = '') {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const headers = {};
    if (key) headers['X-Prism-Cast-Key'] = key;
    if (deviceId) headers['X-Prism-Receiver-Id'] = deviceId;
    if (data !== null) headers['Content-Type'] = 'application/json';
    const {endpoint}=await castConfiguration();
    const res = await fetch(endpoint + '/api/cast/' + action, {
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
