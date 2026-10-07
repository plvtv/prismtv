const json = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store'}});
const token = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12)))).replaceAll('+','-').replaceAll('/','_');
const error = (status, message) => { throw Object.assign(new Error(message), {status}); };
const numeric = n => typeof n === 'number' && Number.isFinite(n) ? Math.max(0,Math.min(n,1e9)) : 0;
function media(value) {
  if (!value || !['hls','file','embed'].includes(value.kind) || typeof value.url !== 'string' || value.url.length > 8192) error(400,'Invalid video.');
  let url; try { url = new URL(value.url); } catch { error(400,'Invalid video URL.'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) error(400,'Only HTTP(S) video URLs are allowed.');
  if (value.kind === 'embed' && !((['www.youtube.com','www.youtube-nocookie.com'].includes(url.hostname) && url.pathname.startsWith('/embed/')) || url.hostname === 'player.twitch.tv')) error(400,'Unsupported embedded video.');
  return {kind:value.kind,url:url.href,title:String(value.title || 'PrismTV').slice(0,200),live:!!value.live,position:numeric(value.position),contentType:['video/mp4','video/webm','video/ogg','application/x-mpegURL'].includes(value.contentType)?value.contentType:'video/mp4'};
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (!origin || !env.ALLOWED_ORIGINS.split(',').map(s=>s.trim()).includes(origin)) return json({error:'This website is not allowed to use this cast service.'},403);
    const cors = {'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Prism-Cast-Key, X-Prism-Receiver-Id','Access-Control-Max-Age':'600'};
    let response;
    try {
      if (request.method === 'OPTIONS') response = new Response(null,{status:204});
      else {
        const action = new URL(request.url).pathname.match(/^\/api\/cast\/(create|join|state|command|report|leave)$/)?.[1];
        if (!action) error(404,'Not found.');
        if (request.method !== (action === 'state' ? 'GET' : 'POST')) error(405,'Wrong request method.');
        let data={deviceId:request.headers.get('X-Prism-Receiver-Id') || ''};
        if (request.method === 'POST') {
          if (!request.headers.get('Content-Type')?.startsWith('application/json')) error(415,'JSON required.');
          const text=await request.text(); if (text.length>16384) error(413,'Request too large.');
          try { data=JSON.parse(text); } catch { error(400,'Invalid JSON.'); }
          if (!data || Array.isArray(data) || typeof data !== 'object') error(400,'Expected a JSON object.');
        }
        let key=request.headers.get('X-Prism-Cast-Key') || '';
        if (action === 'create') {
          const ip=request.headers.get('CF-Connecting-IP') || 'unknown';
          const limit=await env.CREATE_LIMIT.limit({key:ip});
          if (!limit.success) error(429,'Too many new pairing links. Try again in a minute.');
          key=token()+token();
        } else if (!/^[\w-]{32}$/.test(key)) error(404,'This pairing link is invalid or expired.');
        const room=env.CAST_ROOMS.get(env.CAST_ROOMS.idFromName(key.slice(0,16)));
        response=await room.fetch(new Request('https://room/',{method:'POST',body:JSON.stringify({action,key,data})}));
      }
    } catch (e) { response=json({error:e.status?e.message:'The cast service could not complete this request.'},e.status || 500); }
    response=new Response(response.body,response); for (const [k,v] of Object.entries(cors)) response.headers.set(k,v); return response;
  }
};
export class CastRoom {
  constructor(ctx) { this.ctx=ctx; }
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async()=>{
      try {
        const {action,key,data}=await request.json(), now=Date.now();
        let room=await this.ctx.storage.get('room');
        if(action==='create') {
          if(room) error(409,'Try creating another pairing link.');
          room={owner:key,receiver:key.slice(0,16)+token(),seen:now,devices:{}};
          await this.ctx.storage.put('room',room); await this.ctx.storage.setAlarm(now+3600000);
          return json({key:room.owner,receiverKey:room.receiver});
        }
        if(!room || now-room.seen>=3600000) error(404,'Pairing expired. Create a new link.');
        const owner=key===room.owner; if(!owner && key!==room.receiver) error(403,'Invalid pairing key.');
        room.seen=now;
        for(const [id,d] of Object.entries(room.devices)) if(now-d.seen>=300000) delete room.devices[id];
        let result;
        if(action==='join') {
          if(owner) error(403,'Use the receiving link.');
          if(Object.values(room.devices).filter(d=>now-d.seen<20000).length>=8) error(429,'Eight devices are already connected.');
          const id=token(); room.devices[id]={name:String(data.name || 'Receiving device').trim().slice(0,60) || 'Receiving device',seen:now,revision:0,mediaRevision:0,media:null,command:null,status:{phase:'ready',paused:true,position:0}};
          result={deviceId:id};
        } else if(action==='state' && owner) result={devices:Object.entries(room.devices).filter(([,d])=>now-d.seen<20000).map(([id,d])=>({id,name:d.name,media:d.media,...d.status}))};
        else {
          if(typeof data.deviceId !== 'string' || !/^[\w-]{16}$/.test(data.deviceId)) error(404,'Receiving device disconnected.');
          const d=room.devices[data.deviceId]; if(!d) error(404,'Receiving device disconnected.');
          if(action==='state' && !owner) {d.seen=now;result={revision:d.revision,mediaRevision:d.mediaRevision,media:d.media,command:d.command};}
          else if(action==='report' && !owner) {
            if(!['ready','loading','playing','paused','needs-play','embedded','error'].includes(data.phase)) error(400,'Invalid receiver status.');
            d.seen=now;d.status={phase:data.phase,paused:!!data.paused,position:numeric(data.position),message:String(data.message || '').slice(0,200)};result={ok:true};
          } else if(action==='leave' && !owner) {delete room.devices[data.deviceId];result={ok:true};}
          else if(action==='command' && owner) {
            if(now-d.seen>=20000) error(409,'Device offline. Reconnect its receiving page.');
            if(!['load','play','pause','stop'].includes(data.command)) error(400,'Unknown command.');
            if(data.command==='load') {d.media=media(data.media);d.mediaRevision++;d.status={phase:'loading',paused:false,position:d.media.position};}
            if(data.command==='stop') {d.media=null;d.mediaRevision++;d.status={phase:'ready',paused:true,position:0};}
            d.revision++;d.command=data.command;result={ok:true};
          } else error(403,'This key cannot control that device.');
        }
        await this.ctx.storage.put('room',room);return json(result);
      } catch(e) {return json({error:e.status?e.message:'Invalid cast request.'},e.status || 400);}
    });
  }
  async alarm() {
    const room=await this.ctx.storage.get('room');
    if(!room || Date.now()-room.seen>=3600000) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(room.seen+3600000);
  }
}
