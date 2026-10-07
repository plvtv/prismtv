import {focusDialog} from './dialog.js';
import {overlayOpened,overlayClosed} from './mobile.js';

// Private course identifiers live only in the ignored local data file.
export async function initLocalLearn() {
  if (!['localhost','127.0.0.1','[::1]'].includes(location.hostname)) return;
  try {
    const response=await fetch('./data/local-learn.json',{cache:'no-store'});
    if(!response.ok)return;
    const entries=await response.json();if(!Array.isArray(entries))return;
    const make=(tag,className,text)=>{const node=document.createElement(tag);node.className=className||'';if(text)node.textContent=text;return node;};
    const section=make('section','learn-video-sources');section.append(make('h2','','Your local courses'),make('p','learn-source-intro','Private playlists · available on localhost only'));
    const grid=make('div','learn-source-grid');section.append(grid);
    const root=make('div','mplayer');root.id='local-course-player';root.hidden=true;
    const dialog=make('div','mplayer-inner local-course-inner');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','local-course-title');
    const stage=make('div','mplayer-stage');const video=make('video');video.controls=true;video.playsInline=true;stage.append(video);
    const aside=make('aside','mplayer-info');const top=make('div','mplayer-top');top.append(make('span','mplayer-kicker','Local course'));
    const close=make('button','icon-btn','×');close.type='button';close.setAttribute('aria-label','Close player');top.append(close);
    const title=make('h2');title.id='local-course-title';const status=make('p','learn-source-intro');status.setAttribute('role','status');
    const retry=make('button','btn','Retry loading playlist');retry.type='button';retry.hidden=true;
    const list=make('ol','local-course-list');list.setAttribute('aria-label','Course lessons');
    const autoplayLabel=make('label','local-course-autoplay');const autoplay=make('input');autoplay.type='checkbox';autoplay.checked=true;autoplayLabel.append(autoplay,document.createTextNode(' Play next lesson automatically'));
    aside.append(top,title,status,retry,autoplayLabel,list);dialog.append(stage,aside);root.append(dialog);document.body.append(root);
    let current=null,files=[],part=0,request=null;
    const stop=(history=false)=>{request?.abort();video.pause();video.removeAttribute('src');video.load();current=null;root.hidden=true;if(!history)overlayClosed(root.id);};
    const play=index=>{
      if(!current||!files[index])return;part=index;
      for(const [i,button] of [...list.querySelectorAll('button')].entries()){button.classList.toggle('on',i===index);button.setAttribute('aria-current',i===index?'true':'false');}
      status.textContent='Lesson '+(index+1)+' of '+files.length;
      video.src='https://archive.org/download/'+encodeURIComponent(current.id)+'/'+files[index].name.split('/').map(encodeURIComponent).join('/');
      video.play().catch(()=>{if(current&&!video.error)status.textContent='Press Play to start lesson '+(part+1)+'.';});
    };
    const load=async()=>{
      request?.abort();const controller=new AbortController();request=controller;const course=current;
      status.textContent='Loading course playlist…';retry.hidden=true;list.replaceChildren();files=[];
      try {
        const response=await fetch('https://archive.org/metadata/'+encodeURIComponent(course.id),{signal:controller.signal});if(!response.ok)throw new Error('Unavailable');
        const data=await response.json();if(current!==course||controller.signal.aborted)return;
        const videos=(data.files||[]).filter(file=>typeof file.name==='string'&&/\.(mp4|webm)$/i.test(file.name));
        const originals=videos.filter(file=>file.source==='original');files=(originals.length?originals:videos).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
        if(!files.length)throw new Error('No playable lessons');
        files.forEach((file,index)=>{const item=make('li');const button=make('button','local-course-lesson',(index+1)+'. '+(typeof file.title==='string'?file.title:file.name.replace(/^.*\//,'').replace(/\.(mp4|webm)$/i,'')));button.type='button';button.addEventListener('click',()=>play(index));item.append(button);list.append(item);});play(0);
      }catch(error){if(controller.signal.aborted)return;status.textContent='Could not load the course videos. Archive.org may be offline. Try again when the source is available.';retry.hidden=false;}
    };
    close.addEventListener('click',()=>stop());retry.addEventListener('click',load);
    root.addEventListener('mousedown',event=>{if(event.target===root)stop();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&current)stop();});
    video.addEventListener('ended',()=>{if(autoplay.checked&&part+1<files.length)play(part+1);});
    video.addEventListener('error',()=>{if(current)status.textContent='This lesson could not play. Select another lesson or retry the playlist.';});
    for(const entry of entries) {
      if(typeof entry.title!=='string'||typeof entry.url!=='string')continue;
      const url=new URL(entry.url);if(url.hostname!=='archive.org'||!url.pathname.startsWith('/details/'))continue;
      const id=url.pathname.split('/')[2];if(!id)continue;
      const button=make('button','learn-source-card');button.type='button';button.append(make('span','learn-source-level','Private video playlist'),make('h3','',entry.title),make('span','learn-source-action','▶ Open playlist'));
      button.addEventListener('click',()=>{current={id,title:entry.title};title.textContent=entry.title;root.hidden=false;overlayOpened(root.id,()=>stop(true));focusDialog(root.id);load();});grid.append(button);
    }
    if(grid.childElementCount)document.getElementById('learn-archive').before(section);
  }catch{/* Missing private data leaves the public library unchanged. */}
}
