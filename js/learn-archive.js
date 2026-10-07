import {ARCHIVE_LESSONS,ARCHIVE_SKILLS,archiveLessonMatches} from './learn-archive-catalogue.js';
import {bindCast} from './cast.js';
import {overlayOpened,overlayClosed} from './mobile.js';

const PROGRESS='prismtv.learnArchiveProgress',SPEED='prismtv.learnArchiveSpeed';
const el={};let skill='',limit=6,current=null,lastSave=0,initialized=false;
function progress() {try{const value=JSON.parse(localStorage.getItem(PROGRESS)||'{}');return value && typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}
function secondsLabel(seconds) {return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');}
function save() {
  if(!current || !Number.isFinite(el.audio.duration) || !el.audio.duration) return;
  const saved=progress(),time=el.audio.currentTime;
  if(time>=el.audio.duration-1 || time<2) delete saved[current.key];
  else saved[current.key]={time,at:Date.now()};
  try{localStorage.setItem(PROGRESS,JSON.stringify(saved));}catch{}
}
function render() {
  const saved=progress(),matches=ARCHIVE_LESSONS.filter(lesson=>archiveLessonMatches(lesson,skill,el.search.value));
  for(const button of el.skills.querySelectorAll('button')) {
    const selected=button.dataset.skill===skill;button.classList.toggle('on',selected);button.setAttribute('aria-pressed',String(selected));
  }
  el.count.textContent=matches.length?matches.length+' recording'+(matches.length===1?'':'s')+' · LibriVox on Archive.org':'No recordings match. Try another story, accent or skill.';
  el.all.hidden=matches.length<=limit;el.grid.replaceChildren();
  for(const lesson of matches.slice(0,limit)) {
    const button=document.createElement('button');button.type='button';button.className='archive-lesson-card';button.dataset.archiveLesson=lesson.key;
    const label=document.createElement('span');label.className='archive-lesson-kind';label.textContent=ARCHIVE_SKILLS.find(item=>item.id===lesson.skill).name+' · Audio';
    const title=document.createElement('strong');title.textContent=lesson.title;
    const meta=document.createElement('span');meta.className='archive-lesson-meta';meta.textContent=secondsLabel(lesson.seconds)+' · English · LibriVox';
    const note=document.createElement('span');note.className='archive-lesson-note';note.textContent=lesson.practice;
    const action=document.createElement('span');action.className='archive-lesson-action';action.textContent=Number.isFinite(saved[lesson.key]?.time)?'Resume listening':'Listen now';
    button.append(label,title,meta,note,action);button.addEventListener('click',()=>open(lesson));el.grid.append(button);
  }
}
export function showArchiveLearn() {if(initialized)render();}
function start(resume=false) {
  if(!current) return;
  const lesson=current,saved=progress()[lesson.key]?.time;
  el.status.textContent='Loading recording…';el.retry.hidden=true;
  el.audio.src=lesson.url;
  el.audio.addEventListener('loadedmetadata',()=>{
    if(current!==lesson) return;
    if(resume && Number.isFinite(saved) && saved>0 && saved<el.audio.duration-1) el.audio.currentTime=saved;
    el.status.textContent='';
  },{once:true});
  const speed=Number(el.speed.value);el.audio.playbackRate=speed;
  el.audio.play().catch(()=>{if(current===lesson && !el.audio.error)el.status.textContent='Press Play to start listening.';});
}
function open(lesson) {
  save();el.audio.pause();current=lesson;
  el.root.hidden=false;el.title.textContent=lesson.title;
  el.sub.textContent=secondsLabel(lesson.seconds)+' · English · LibriVox on Archive.org';
  el.practice.textContent=lesson.practice;
  el.text.hidden=!lesson.text;if(lesson.text)el.text.href=lesson.text;else el.text.removeAttribute('href');
  el.source.href=lesson.archive;el.credit.href=lesson.source;
  el.repeat.checked=false;el.audio.loop=false;
  overlayOpened('archive-audio-player',()=>close(true));
  start(true);
}
function close(fromHistory=false) {
  if(!current)return;
  save();el.audio.pause();el.audio.removeAttribute('src');el.audio.load();current=null;
  if(!fromHistory)overlayClosed('archive-audio-player');
  el.root.hidden=true;render();
}
export function initArchiveLearn() {
  if(initialized)return;initialized=true;
  for(const [key,id] of Object.entries({skills:'learn-archive-skills',search:'learn-archive-search',count:'learn-archive-count',grid:'learn-archive-grid',all:'learn-archive-all',heading:'learn-archive-title',root:'archive-audio-player',audio:'archive-audio',title:'archive-audio-title',sub:'archive-audio-sub',practice:'archive-audio-practice',text:'archive-audio-text',source:'archive-audio-source',credit:'archive-audio-credit',status:'archive-audio-status',retry:'archive-audio-retry',close:'archive-audio-close',repeat:'archive-audio-repeat',speed:'archive-audio-speed',replay:'archive-audio-replay'}))el[key]=document.getElementById(id);
  for(const item of [{id:'',name:'All skills'},...ARCHIVE_SKILLS]) {
    const button=document.createElement('button');button.type='button';button.className='chip';button.dataset.skill=item.id;button.textContent=item.name;
    button.addEventListener('click',()=>{skill=item.id;limit=6;render();});el.skills.append(button);
  }
  el.search.addEventListener('input',()=>{limit=6;render();});
  el.all.addEventListener('click',()=>{limit=Infinity;render();el.heading.focus({preventScroll:true});});
  try{const speed=localStorage.getItem(SPEED);if(['0.75','1','1.25'].includes(speed))el.speed.value=speed;}catch{}
  el.speed.addEventListener('change',()=>{el.audio.playbackRate=Number(el.speed.value);try{localStorage.setItem(SPEED,el.speed.value);}catch{}});
  el.repeat.addEventListener('change',()=>{el.audio.loop=el.repeat.checked;});
  el.replay.addEventListener('click',()=>{el.audio.currentTime=Math.max(0,el.audio.currentTime-10);});
  el.retry.addEventListener('click',()=>start(true));el.close.addEventListener('click',()=>close());
  el.root.addEventListener('mousedown',event=>{if(event.target===el.root)close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&current)close();});
  el.audio.addEventListener('playing',()=>{el.status.textContent='';el.retry.hidden=true;});
  el.audio.addEventListener('waiting',()=>{if(current)el.status.textContent='Buffering…';});
  el.audio.addEventListener('error',()=>{if(current){el.status.textContent='This recording is unavailable right now. Try again, or open it on Archive.org.';el.retry.hidden=false;}});
  el.audio.addEventListener('timeupdate',()=>{if(Date.now()-lastSave>3000){lastSave=Date.now();save();}});
  el.audio.addEventListener('pause',save);el.audio.addEventListener('ended',save);window.addEventListener('pagehide',save);
  bindCast({root:el.root,button:document.getElementById('archive-audio-cast'),getVideo:()=>el.audio,
    getMedia:()=>current?{kind:'file',url:current.url,title:current.title,live:false,contentType:'audio/mpeg'}:null,
    resume:async position=>{if(current){el.audio.currentTime=position;await el.audio.play();}}
  });
}
