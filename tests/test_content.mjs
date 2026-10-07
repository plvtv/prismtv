import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../js/content.js',import.meta.url),'utf8');
const {isKidsYouTube,isKidsChannel,languageCodes,languageName,metadataLanguages,durationLabel,durationSeconds,programmeWindow,xmltvTime,availabilityLabel}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('languages use feed records and never infer all of a country’s official languages',()=>{
 const dataset={channelLanguages:{'News.in':['tel']},countries:{IN:{languages:['tel','hin','tam']}}};
 assert.deepEqual(languageCodes({id:'News.in',country:'IN'},dataset),['tel']);
 assert.deepEqual(languageCodes({id:'freetv:News.in',country:'IN'},dataset),['tel']);
 assert.deepEqual(languageCodes({id:'Unknown.in',country:'IN'},dataset),[]);
 assert.equal(languageName('tel'),'Telugu');assert.equal(metadataLanguages(['eng','en','Hindi']),'English, Hindi');
});
test('metadata retains unknown values rather than inventing runtime or languages',()=>{
 assert.equal(durationSeconds('05:12'),312);assert.equal(durationSeconds('30'),1800);assert(Number.isNaN(durationSeconds(undefined)));
 assert.equal(durationLabel('01:29:30'),'90 min');assert.equal(durationLabel('05:12'),'6 min');assert.equal(durationLabel('70'),'70 min');assert.equal(durationLabel(undefined),'');assert.equal(metadataLanguages(undefined),'');
});
test('programme boundaries and XMLTV timezone offsets select the actual current show',()=>{
 const now=Date.UTC(2026,9,7,10);
 assert.equal(xmltvTime('20261007153000 +0530'),now);assert(Number.isNaN(xmltvTime('20261007153000')));
 const programmes=[{title:'Previous',start:now-2000,end:now},{title:'Now',start:now,end:now+1000},{title:'Next',start:now+1000,end:now+2000},{title:'Wrong',start:now,end:now-1}];
 const result=programmeWindow(programmes,now);assert.equal(result.current.title,'Now');assert.equal(result.upcoming[0].title,'Next');
});
test('a stale check is not presented as recent availability',()=>{
 const now=Date.now();assert.equal(availabilityLabel('ok',now/1000,now),'Source responded recently');assert.match(availabilityLabel('ok',(now-72*3600000)/1000,now),/not recently checked/);assert.match(availabilityLabel('unknown',now/1000,now),/unconfirmed/);
});

test('Kids includes explicitly tagged channels and excludes adult or general animation',()=>{
 assert.equal(isKidsChannel({categories:['kids','animation']}),true);
 assert.equal(isKidsChannel({categories:['children']}),true);
 assert.equal(isKidsChannel({categories:['animation']}),false);
 assert.equal(isKidsChannel({categories:['family']}),false);
 assert.equal(isKidsChannel({categories:['kids'],is_nsfw:true}),false);
 assert.equal(isKidsChannel({}),false);
});

test('Kids YouTube selection excludes adult animation and unclassified channels',()=>{
 assert.equal(isKidsYouTube({s:'cartoons',n:'WB Kids'}),true);
 for(const n of ['Adult Swim','Rick and Morty','Family guy','Vivziepop/SpindleHorse','Unknown']) assert.equal(isKidsYouTube({s:'cartoons',n}),false);
});
