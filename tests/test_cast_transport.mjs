import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../js/cast-api.js',import.meta.url),'utf8')).replaceAll('import.meta.url',JSON.stringify('https://plvtv.github.io/prismtv/js/cast-api.js'));
const load=()=>import('data:text/javascript;base64,'+Buffer.from(source+'\n//'+Math.random()).toString('base64'));
test('hosted transport uses configured endpoint and keeps receiving link under repository path',async()=>{
 const original=globalThis.fetch,requests=[];
 globalThis.fetch=async(url,opts)=>{requests.push([String(url),opts]);return Response.json(String(url).endsWith('cast-config.json')?{endpoint:'https://prism-cast.example/'}:{key:'owner',receiverKey:'receiver'});};
 try {const api=await load(),info=await api.castingInfo();assert.equal(info.hosted,true);assert.equal(info.urls[0],'https://plvtv.github.io/prismtv/');assert.equal(new URL('receive.html',info.urls[0]).href,'https://plvtv.github.io/prismtv/receive.html');await api.castRequest('command','owner',{command:'pause',deviceId:'tablet'});assert.equal(requests[0][0],'https://plvtv.github.io/prismtv/data/cast-config.json');assert.equal(requests[1][0],'https://prism-cast.example/api/cast/command');assert.equal(requests[1][1].headers['X-Prism-Cast-Key'],'owner');assert.equal(requests[1][1].method,'POST');}
 finally {globalThis.fetch=original;}
});
test('blank configuration preserves local transport and explains missing public service',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>String(url).endsWith('cast-config.json')?Response.json({endpoint:''}):new Response('',{status:404});
 try {const api=await load();await assert.rejects(()=>api.castingInfo(),/hosted cast service/);}
 finally {globalThis.fetch=original;}
});
