import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../js/cast-state.js',import.meta.url),'utf8');
const {castFailure,describeMedia,castPhase,timeLabel}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('distinguishes discovery, transport and media failures without reporting cancellation as failure',()=>{
 assert.match(castFailure({code:'receiver_unavailable'}),/No Chromecast TV/);
 assert.match(castFailure('timeout'),/did not respond/);
 assert.match(castFailure({code:'channel_error'}),/connection.*lost/);
 assert.match(castFailure('anything','load'),/could not play this source/);
 assert.equal(castFailure({code:'cancel'}),null);
});
test('restores actual TV media descriptor and playback states',()=>{
 assert.deepEqual(describeMedia({media:{contentId:'https://example.com/live.m3u8',streamType:'LIVE',contentType:'application/x-mpegURL',metadata:{title:'News'}}}),{url:'https://example.com/live.m3u8',title:'News',live:true,kind:'hls',contentType:'application/x-mpegURL'});
 assert.equal(describeMedia(null),null);
 for(const [playerState,expected] of [['PLAYING','playing'],['PAUSED','paused'],['BUFFERING','loading']]) assert.equal(castPhase({playerState}),expected);
 assert.equal(castPhase({playerState:'IDLE',idleReason:'ERROR'}),'error');assert.equal(castPhase({playerState:'IDLE',idleReason:'FINISHED'}),'finished');
 assert.equal(timeLabel(3661),'1:01:01');assert.equal(timeLabel(42),'0:42');
});
