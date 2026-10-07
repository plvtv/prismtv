import { API_BASE } from './config.js';
import { programmeWindow, xmltvTime } from './content.js';
const schedules = new Map(), files = new Map();
let directory;
export function guideNow(id) { return programmeWindow(schedules.get(id) || []); }
async function read(url, type='text', timeout=8000) {
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeout);
  try {
    const res=await fetch(url,{signal:ctl.signal});if(!res.ok)throw new Error('Guide unavailable');
    const text=await res.text();if(text.length>8e6)throw new Error('Guide too large');
    return type==='json'?JSON.parse(text):text;
  } finally {clearTimeout(timer);}
}
export function parseGuide(xml, ids) {
  const doc=new DOMParser().parseFromString(xml,'text/xml');
  if(doc.querySelector('parsererror'))throw new Error('Invalid programme guide');
  const allowed=new Set(ids);
  return [...doc.querySelectorAll('programme')].filter(p=>allowed.has(p.getAttribute('channel'))).map(p=>({
    start:xmltvTime(p.getAttribute('start')),end:xmltvTime(p.getAttribute('stop')),
    title:p.querySelector('title')?.textContent.trim() || '',description:p.querySelector('desc')?.textContent.trim() || ''
  })).filter(p=>Number.isFinite(p.start)&&Number.isFinite(p.end)&&p.end>p.start&&p.title);
}
async function guideFile(url) {
  const cached=files.get(url);
  if(cached && Date.now()-cached.at<30*60000)return cached.promise;
  const promise=read(url).catch(()=>read('/api/hls?raw=1&url='+encodeURIComponent(url),'text',4000)).catch(e=>{files.delete(url);throw e});
  if(files.size>=8)files.delete(files.keys().next().value);
  files.set(url,{at:Date.now(),promise});return promise;
}
async function load(channel) {
  if(Array.isArray(channel.programmes)) {schedules.set(channel.id,channel.programmes);return;}
  if(!directory)directory=read(API_BASE+'/guides.json','json').catch(e=>{directory=null;throw e});
  const all=await directory;
  const feed=channel.streams?.[0]?.feed;
  const entries=all.filter(g=>g.channel===channel.id && (!feed || !g.feed || g.feed===feed)).sort((a,b)=>Number(b.lang==='en')-Number(a.lang==='en'));
  const deadline=Date.now()+20000;
  for(const entry of entries.slice(0,2)) {
    for(const source of (entry.sources || []).slice(0,2)) {
      if(Date.now()>deadline)throw new Error('Programme guide timed out');
      if(!/^https?:\/\//.test(source.url || '') || !/XML/i.test(source.format || ''))continue;
      try {
        const programmes=parseGuide(await guideFile(source.url),[channel.id, entry.feed?channel.id+'@'+entry.feed:channel.id,entry.site_id]);
        if(programmes.length) {schedules.set(channel.id,programmes);document.dispatchEvent(new CustomEvent('prismtv:guide'));return;}
      } catch { /* Try another provider; never substitute a similarly named channel. */ }
    }
  }
  schedules.set(channel.id,[]);
}
export function showGuide(host,channel) {
  host.replaceChildren();
  const detail=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Programme guide';
  const body=document.createElement('div');body.className='programme-guide-body';detail.append(summary,body);host.append(detail);
  let loading=false,loaded=false;
  const paint=()=>{
    if(!host.isConnected || host.firstElementChild!==detail)return;
    body.replaceChildren();const window=guideNow(channel.id);
    const append=(label,p)=>{
      const line=document.createElement('p'),time=document.createElement('time');
      time.dateTime=new Date(p.start).toISOString();time.textContent=new Date(p.start).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      const text=document.createElement('span');text.textContent=label+' · '+p.title;line.append(time,text);body.append(line);
    };
    if(window.current)append('Now',window.current);
    window.upcoming.forEach((p,i)=>append(i?'Later':'Next',p));
    if(!body.childElementCount) {const text=document.createElement('p');text.textContent='No current programme guide is available for this channel.';body.append(text);}
    const note=document.createElement('p');note.className='prefs-note';note.textContent='Times use your device’s timezone. Published schedules can change.';body.append(note);
  };
  detail.addEventListener('toggle',async()=>{
    if(!detail.open || loading)return;
    if(loaded){paint();return;}
    loading=true;body.textContent='Loading programme guide…';body.setAttribute('role','status');
    try {await load(channel);loaded=true;paint();}
    catch {body.textContent='Could not load a programme guide. Close and reopen to retry.';}
    finally{loading=false;body.removeAttribute('role');}
  });
}
