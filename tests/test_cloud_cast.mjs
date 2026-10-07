import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{CastRoom} from '../cloud-cast/worker.mjs';
const origin='https://plvtv.github.io';
function environment() {
  const rooms=new Map();
  return {ALLOWED_ORIGINS:origin,CREATE_LIMIT:{limit:async()=>({success:true})},CAST_ROOMS:{idFromName:n=>n,get:n=>{
    if(!rooms.has(n)) {const values=new Map();rooms.set(n,new CastRoom({blockConcurrencyWhile:f=>f(),storage:{get:async k=>values.get(k),put:async(k,v)=>values.set(k,structuredClone(v)),setAlarm:async()=>{},deleteAll:async()=>values.clear()}}));}
    return rooms.get(n);
  }}};
}
const request=(action,key='',data={},site=origin)=>new Request('https://cast.test/api/cast/'+action,{method:action==='state'?'GET':'POST',headers:{Origin:site,'Content-Type':'application/json','X-Prism-Cast-Key':key,'X-Prism-Receiver-Id':data.deviceId || ''},body:action==='state'?undefined:JSON.stringify(data)});
test('cloud pairing and playback with separate owner/receiver keys',async()=>{
 const env=environment(),call=(a,k,d)=>worker.fetch(request(a,k,d),env);
 const create=await call('create');assert.equal(create.headers.get('Access-Control-Allow-Origin'),origin);
 const keys=await create.json();assert.equal(keys.receiverKey.length,32);assert.notEqual(keys.key,keys.receiverKey);
 const {deviceId}=await (await call('join',keys.receiverKey,{name:'Tablet'})).json();
 const stream={kind:'file',url:'https://example.com/film.mp4',position:42};
 assert.equal((await call('command',keys.receiverKey,{deviceId,command:'load',media:stream})).status,403);
 assert.equal((await call('command',keys.key,{deviceId,command:'load',media:stream})).status,200);
 let state=await (await call('state',keys.receiverKey,{deviceId})).json();assert.equal(state.media.position,42);
 await call('command',keys.key,{deviceId,command:'pause'});state=await (await call('state',keys.receiverKey,{deviceId})).json();assert.equal(state.command,'pause');assert.equal(state.mediaRevision,1);
 await call('command',keys.key,{deviceId,command:'stop'});state=await (await call('state',keys.receiverKey,{deviceId})).json();assert.equal(state.media,null);
 await call('leave',keys.receiverKey,{deviceId});assert.equal((await (await call('state',keys.key)).json()).devices.length,0);
});
test('origin protection, preflight and invalid media',async()=>{
 const env=environment();assert.equal((await worker.fetch(request('create','','','https://evil.test'),env)).status,403);
 const preflight=await worker.fetch(new Request('https://cast.test/api/cast/create',{method:'OPTIONS',headers:{Origin:origin}}),env);assert.equal(preflight.status,204);
 const keys=await (await worker.fetch(request('create'),env)).json();const {deviceId}=await (await worker.fetch(request('join',keys.receiverKey),env)).json();
 assert.equal((await worker.fetch(request('command',keys.key,{deviceId,command:'load',media:{kind:'embed',url:'https://evil.test/embed/a'}}),env)).status,400);
});
