const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict');
const base=process.argv[2] || 'http://localhost:8080';
const html=`<!doctype html><link rel="stylesheet" href="/css/style.css"><svg width="0" height="0"><symbol id="i-cast" viewBox="0 0 24 24"><path d="M3 8V4h18v16h-9M3 12a8 8 0 0 1 8 8" fill="none" stroke="currentColor" stroke-width="1.7"/></symbol></svg><div id="fixture"><div role="dialog" class="mplayer-inner"><div class="mplayer-stage" style="min-height:200px"><video></video></div><aside><button id="fixture-cast" class="icon-btn cast-btn">Cast</button></aside></div></div><script type="module">
import {bindCast} from '/js/cast.js';
window.localResumes=[];window.localPauses=0;window.alternates=0;
window.localMedia={kind:'file',url:'https://fixture.test/movie.mp4',title:'Test movie',live:false,contentType:'video/mp4'};
bindCast({root:document.querySelector('#fixture'),button:document.querySelector('#fixture-cast'),getMedia:()=>window.localMedia,getVideo:()=>({setAttribute(){},currentTime:12,pause:()=>window.localPauses++}),resume:p=>window.localResumes.push(p),alternate:()=>window.alternates++});window.ready=true;
</script>`;
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/qa-cast',r=>r.fulfill({contentType:'text/html',body:html}));
 await page.addInitScript(()=>{
   window.mock={connectError:null,loadError:null,volume:.5,muted:false,endCalls:0};
   const listeners={},mediaListeners=new Set();let session=null;
   const notify=()=>{for(const f of mediaListeners)f(true);};
   const remote=window.remote={media:{contentId:'https://fixture.test/movie.mp4',contentType:'video/mp4',streamType:'BUFFERED',duration:180,metadata:{title:'Test movie'}},currentTime:12,playerState:'PLAYING',getEstimatedTime(){return this.currentTime},addUpdateListener:f=>mediaListeners.add(f),removeUpdateListener:f=>mediaListeners.delete(f),play(r,ok){this.playerState='PLAYING';notify();ok()},pause(r,ok){this.playerState='PAUSED';notify();ok()},seek(r,ok){this.currentTime=r.currentTime;notify();ok()}};
   const tv={getMediaSession:()=>remote,getCastDevice:()=>({friendlyName:'Living room TV'}),addEventListener(){},removeEventListener(){},getVolume:()=>mock.volume,isMute:()=>mock.muted,setVolume:async v=>{mock.volume=v},setMute:async v=>{mock.muted=v},loadMedia:async r=>{if(mock.loadError)throw {code:mock.loadError};remote.media=r.media;remote.media.duration=180;remote.currentTime=r.currentTime||0;remote.playerState='PLAYING';},endSession(){mock.endCalls++;session=null;listeners.session?.()}};
   if(localStorage.getItem('prismtv:cast-session')) session=tv;
   const ctx={setOptions(){},getCurrentSession:()=>session,addEventListener:(t,f)=>listeners[t]=f,requestSession:async()=>{if(mock.connectError)throw {code:mock.connectError};session=tv;listeners.session?.()}};
   window.notifyMedia=notify;
   window.cast={framework:{CastContext:{getInstance:()=>ctx},CastContextEventType:{SESSION_STATE_CHANGED:'session'},SessionEventType:{MEDIA_SESSION:'media',VOLUME_CHANGED:'volume'}}};
   window.chrome=window.chrome||{};window.chrome.cast={AutoJoinPolicy:{ORIGIN_SCOPED:'origin'},media:{DEFAULT_MEDIA_RECEIVER_APP_ID:'default',StreamType:{LIVE:'LIVE',BUFFERED:'BUFFERED'},PlayerState:{PAUSED:'PAUSED'},MediaInfo:function(url,type){this.contentId=url;this.contentType=type},GenericMediaMetadata:function(){},LoadRequest:function(m){this.media=m},PlayRequest:function(){},PauseRequest:function(){},SeekRequest:function(){}}};
 });
 await page.goto(base+'/qa-cast');await page.waitForFunction(()=>window.ready);
 const panel=page.locator('#fixture-cast-panel'),action=n=>panel.locator(`[data-action="${n}"]`);
 await page.locator('#fixture-cast').click();
 await page.evaluate(()=>mock.connectError='receiver_unavailable');await action('google').click();await panel.getByRole('status').filter({hasText:'No Chromecast TV'}).waitFor();
 await page.evaluate(()=>{mock.connectError=null;mock.loadError='load_media_failed'});await action('retry').click();await panel.getByRole('status').filter({hasText:'could not play this source'}).waitFor();
 await action('alternate').click();assert.equal(await page.evaluate(()=>alternates),1);await page.locator('#fixture-cast').click();
 await page.evaluate(()=>mock.loadError=null);await action('retry').click();await panel.getByRole('status').filter({hasText:'Playing on Living room TV'}).waitFor();assert.equal(await page.evaluate(()=>localPauses),1);
 await action('toggle').click();await panel.getByRole('status').filter({hasText:'Paused on Living room TV'}).waitFor();
 await panel.locator('[data-control="volume"]').evaluate(e=>e.value='72');await panel.locator('[data-control="volume"]').dispatchEvent('change');await page.waitForFunction(()=>mock.volume===.72);
 await action('mute').click();assert.equal(await page.evaluate(()=>mock.muted),true);
 await panel.locator('[data-control="seek"]').evaluate(e=>e.value='179');await panel.locator('[data-control="seek"]').dispatchEvent('change');await page.waitForFunction(()=>remote.currentTime===179);
 for(const width of [320,768,1440]){await page.setViewportSize({width,height:900});const box=await panel.boundingBox();assert(box.x>=0&&box.x+box.width<=width+1);}
 await page.reload();await page.waitForFunction(()=>window.ready);await page.locator('#fixture-cast').click();await panel.getByRole('status').filter({hasText:'Living room TV'}).waitFor();assert.equal(await action('resume').isEnabled(),true);
 await page.evaluate(()=>{localMedia.url='https://fixture.test/other.mp4';notifyMedia()});assert.equal(await action('resume').isEnabled(),false);
 await page.evaluate(()=>{localMedia.url='https://fixture.test/movie.mp4';remote.currentTime=88;notifyMedia()});await action('resume').click();assert.deepEqual(await page.evaluate(()=>localResumes),[88]);assert.equal(await page.evaluate(()=>mock.endCalls),1);
 await action('google').click();await panel.getByRole('status').filter({hasText:'Playing on Living room TV'}).waitFor();
 await page.evaluate(()=>{localMedia.live=true;remote.media.streamType='LIVE';notifyMedia()});assert.equal(await panel.locator('[data-control="seek"]').isVisible(),false);
 await action('close').click();await page.locator('.cast-stage-fullscreen').click();await page.waitForFunction(()=>!!document.fullscreenElement);await page.locator('.cast-fullscreen').click();assert.equal(await panel.evaluate(e=>document.fullscreenElement.contains(e)),true);
 await action('close').click();assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('cast-fullscreen')),true);await page.evaluate(()=>document.exitFullscreen());
 assert.deepEqual(errors,[]);console.log('Cast status/errors, volume/mute, seeking, resume, auto-recovery, responsive layout and fullscreen passed');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
