import {initStoryCatalogue} from './story-catalogue.js';
import {focusDialog} from './dialog.js';
import {overlayOpened,overlayClosed} from './mobile.js';
const BOOKS=[
  {button:'public-audiobook-open',id:'fifteenstoriesbykeithlaumer_2608_librivox',title:'Fifteen Stories by Keith Laumer',credits:'https://librivox.org/fifteen-stories-by-keith-laumer-by-keith-laumer/'},
  {button:'public-holmes-open',id:'adventures_holmes',title:'The Adventures of Sherlock Holmes',credits:'https://librivox.org/the-adventures-of-sherlock-holmes/'},
  {button:'public-moby-open',id:'moby_dick_librivox',title:'Moby-Dick, or the Whale',credits:'https://librivox.org/moby-dick-by-herman-melville'},
  {"button": "public-alice-open", "id": "alice_in_wonderland_librivox", "title": "Alice’s Adventures in Wonderland", "credits": "https://librivox.org/alices-adventures-in-wonderland-by-lewis-carroll/"},
  {"button": "public-oz-open", "id": "wizard_of_oz", "title": "The Wonderful Wizard of Oz", "credits": "https://librivox.org/the-wonderful-wizard-of-oz/"},
  {"button": "public-treasure-open", "id": "treasure_island_dram_1306_librivox", "title": "Treasure Island — Dramatic Reading", "credits": "https://librivox.org/treasure-island-dramatic-reading-by-robert-louis-stevenson/"}
];
export function initPublicAudiobook() {
  const make=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls||'';if(text)node.textContent=text;return node;};
  const root=make('div','mplayer');root.id='public-audiobook-player';root.hidden=true;
  const dialog=make('div','archive-audio-inner audiobook-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','public-audiobook-title');
  const top=make('div','mplayer-top');top.append(make('span','mplayer-kicker','LibriVox · English audiobook'));const close=make('button','icon-btn','×');close.type='button';close.setAttribute('aria-label','Close player');top.append(close);
  const title=make('h2','','Fifteen Stories by Keith Laumer');title.id='public-audiobook-title';
  const audio=make('audio');audio.controls=true;audio.setAttribute('aria-label','Selected story recording');
  const status=make('p','learn-source-intro');status.setAttribute('role','status');
  const retry=make('button','btn','Retry playlist');retry.type='button';retry.hidden=true;
  const autoLabel=make('label','local-course-autoplay');const auto=make('input');auto.type='checkbox';auto.checked=true;autoLabel.append(auto,document.createTextNode(' Play next track automatically'));
  const list=make('ol','local-course-list');list.setAttribute('aria-label','Audiobook tracks');
  const credits=make('a','text-btn','Recording credits ↗');credits.href='https://librivox.org/fifteen-stories-by-keith-laumer-by-keith-laumer/';credits.target='_blank';credits.rel='noopener noreferrer';
  const hero=make('div','audiobook-hero');const cover=make('img','audiobook-cover');cover.alt='';const details=make('div','audiobook-details');const eyebrow=make('span','audiobook-eyebrow','NOW PLAYING');const trackTitle=make('p','audiobook-track-title');details.append(eyebrow,title,trackTitle);hero.append(cover,details);
  const playback=make('div','audiobook-playback');playback.append(audio,status,retry);
  const queueHead=make('div','audiobook-queue-head');queueHead.append(make('h3','','Chapters'),autoLabel);
  dialog.append(top,hero,playback,queueHead,list,credits);root.append(dialog);document.body.append(root);
  let tracks=[],part=0,request=null,ID=BOOKS[0].id;
  const play=index=>{if(!tracks[index]||root.hidden)return;part=index;trackTitle.textContent=tracks[index].title||tracks[index].name.replace(/_64kb\.mp3$/i,'').replace(/\.mp3$/i,'');list.querySelectorAll('button').forEach((button,i)=>{button.classList.toggle('on',i===index);button.setAttribute('aria-current',String(i===index));});status.textContent='Track '+(index+1)+' of '+tracks.length;retry.hidden=true;audio.src='https://archive.org/download/'+ID+'/'+tracks[index].name.split('/').map(encodeURIComponent).join('/');audio.play().catch(()=>{if(!root.hidden&&!audio.error)status.textContent='Press Play to listen.';});};
  const load=async()=>{
    request?.abort();const controller=new AbortController();request=controller;
    audio.pause();audio.removeAttribute('src');audio.load();tracks=[];list.replaceChildren();status.textContent='Loading story playlist…';retry.hidden=true;
    try{const response=await fetch('https://archive.org/metadata/'+ID,{signal:controller.signal});if(!response.ok)throw new Error();const data=await response.json();if(controller.signal.aborted||root.hidden)return;
      const files=(data.files||[]).filter(file=>typeof file.name==='string'&&/\.mp3$/i.test(file.name));
      // Prefer one consistent MP3 edition rather than showing duplicate encodings.
      const low=files.filter(file=>/_64kb\.mp3$/i.test(file.name));const originals=files.filter(file=>file.source==='original');
      tracks=(low.length?low:originals.length?originals:files).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));if(!tracks.length)throw new Error();
      tracks.forEach((file,i)=>{const item=make('li');const button=make('button','local-course-lesson');const label=(typeof file.title==='string'?file.title:file.name.replace(/\.mp3$/i,'').replace(/_64kb$/i,'')).replace(/^\d+\s*[-.:]\s*/,'');button.append(make('span','audiobook-track-number',String(i+1).padStart(2,'0')),make('span','audiobook-track-label',label),make('span','audiobook-track-icon','▶'));button.type='button';button.addEventListener('click',()=>play(i));item.append(button);list.append(item);});play(0);
    }catch{if(controller.signal.aborted)return;status.textContent='The story playlist is unavailable right now. Archive.org may be offline. Please retry later.';retry.hidden=false;}
  };
  const hide=(history=false)=>{request?.abort();audio.pause();audio.removeAttribute('src');audio.load();root.hidden=true;if(!history)overlayClosed(root.id);};
  const openBook=book=>{ID=book.id;cover.src='https://archive.org/services/img/'+encodeURIComponent(ID);cover.hidden=false;trackTitle.textContent='Choose a chapter and settle in.';title.textContent=book.title;credits.href=book.credits||'https://archive.org/details/'+encodeURIComponent(book.id);root.hidden=false;overlayOpened(root.id,()=>hide(true));focusDialog(root.id);load();};
  for(const book of BOOKS)document.getElementById(book.button)?.addEventListener('click',()=>openBook(book));
  initStoryCatalogue(openBook);
  cover.addEventListener('error',()=>{cover.hidden=true;});
  close.addEventListener('click',()=>hide());retry.addEventListener('click',load);root.addEventListener('mousedown',event=>{if(event.target===root)hide();});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!root.hidden)hide();});
  audio.addEventListener('ended',()=>{if(auto.checked&&part+1<tracks.length)play(part+1);});audio.addEventListener('error',()=>{if(!root.hidden){status.textContent='This track could not play. Select another track or retry the playlist.';retry.hidden=false;}});
}
