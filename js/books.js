import {focusDialog} from './dialog.js';
import {overlayOpened,overlayClosed} from './mobile.js';
async function initBookCatalogue(openBook) {
  const grid=document.getElementById('books-grid'),search=document.getElementById('books-search'),count=document.getElementById('books-count'),more=document.getElementById('books-more'),retry=document.getElementById('books-retry');
  if(!grid)return;
  let books=[],limit=24;
  const make=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls||'';if(text)node.textContent=text;return node;};
  function render() {
    const words=search.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches=books.filter(book=>words.every(word=>(book.title+' '+book.author).toLocaleLowerCase().includes(word)));
    const shown=matches.slice(0,limit);count.textContent=matches.length?'Showing '+shown.length+' of '+matches.length+' books':'No books match. Try another title or author.';grid.replaceChildren();more.hidden=shown.length>=matches.length;
    for(const book of shown){const button=make('button','learn-source-card learn-book-card books-card');button.type='button';button.dataset.storyId=book.id;
      const cover=make('div','learn-cover learn-cover-book');cover.setAttribute('aria-hidden','true');const image=make('img');image.alt='';image.loading='lazy';image.decoding='async';image.src='https://archive.org/services/img/'+encodeURIComponent(book.id);image.addEventListener('error',()=>{image.remove();cover.append(make('span','story-cover-fallback','Book'));},{once:true});cover.append(image);
      button.append(cover,make('span','learn-source-level','Historic English book'),make('h3','',book.title),make('span','learn-source-provider',book.author),make('span','learn-source-action','Read book'));button.addEventListener('click',()=>openBook(book));grid.append(button);
    }
  }
  async function load(){count.textContent='Loading book library…';retry.hidden=true;try{const response=await fetch('./data/book-catalogue.json');if(!response.ok)throw new Error();const data=await response.json();if(!Array.isArray(data.items))throw new Error();books=data.items.filter(book=>typeof book.id==='string'&&typeof book.title==='string'&&typeof book.author==='string');render();}catch{count.textContent='Could not load the book library.';retry.hidden=false;}}
  search.addEventListener('input',()=>{limit=24;render();});more.addEventListener('click',()=>{limit+=24;render();});retry.addEventListener('click',load);await load();
}

export function initBooks() {
  const root=document.createElement('div');root.id='book-reader';root.className='mplayer';root.hidden=true;
  root.innerHTML='<div class="book-reader-inner" role="dialog" aria-modal="true" aria-labelledby="book-reader-title"><header><h2 id="book-reader-title"></h2><div class="book-reader-actions"><button class="btn book-fullscreen" aria-label="Enter fullscreen" aria-pressed="false" type="button"><svg class="i"><use href="#i-expand"/></svg><span>Fullscreen</span></button><button class="icon-btn" aria-label="Close player" type="button">×</button></div></header><p>Loading is handled by Archive.org. If the reader is unavailable, open the original book below.</p><div class="book-fit-tools" role="group" aria-label="Reading view"><button class="chip" type="button" data-fit="Fit" aria-pressed="false">Fit page</button><button class="chip" type="button" data-fit="FitH" aria-pressed="false">Fit width</button><button class="chip on" type="button" data-fit="archive" aria-pressed="true">Archive reader</button></div><p class="book-fit-status" role="status" hidden></p><iframe title="Archive.org book reader" allowfullscreen></iframe><a class="text-btn" target="_blank" rel="noopener noreferrer">Open original book ↗</a></div>';
  document.body.append(root);const frame=root.querySelector('iframe');
  const reader=root.querySelector('.book-reader-inner'),fullscreen=root.querySelector('.book-fullscreen');
  let currentBook=null,pdf=null,fitRequest=null;
  const fitStatus=root.querySelector('.book-fit-status');
  const selectFit=mode=>root.querySelectorAll('[data-fit]').forEach(button=>{const selected=button.dataset.fit===mode;button.classList.toggle('on',selected);button.setAttribute('aria-pressed',String(selected));});
  const archiveUrl=()=> 'https://archive.org/stream/'+encodeURIComponent(currentBook.id)+'?ui=embed';
  for(const button of root.querySelectorAll('[data-fit]'))button.addEventListener('click',async()=>{
    if(!currentBook)return;fitRequest?.abort();const controller=new AbortController();fitRequest=controller;
    const book=currentBook,mode=button.dataset.fit;
    if(mode==='archive'){frame.src=archiveUrl();selectFit(mode);fitStatus.hidden=true;return;}
    fitStatus.hidden=false;fitStatus.textContent='Loading PDF for fitted reading…';
    try{
      if(!pdf){const response=await fetch('https://archive.org/metadata/'+encodeURIComponent(book.id),{signal:controller.signal});if(!response.ok)throw new Error();const data=await response.json();if(controller.signal.aborted||currentBook!==book)return;const files=(data.files||[]).filter(file=>typeof file.name==='string'&&/\.pdf$/i.test(file.name));const file=files.find(file=>file.format==='Text PDF')||files.find(file=>!/_bw\.pdf$/i.test(file.name))||files[0];if(!file)throw new Error();pdf='https://archive.org/download/'+encodeURIComponent(book.id)+'/'+file.name.split('/').map(encodeURIComponent).join('/');}
      if(controller.signal.aborted||currentBook!==book)return;
      frame.src=pdf+'#view='+mode;selectFit(mode);fitStatus.textContent='PDF view · switching views starts at the beginning. Fitting uses your browser’s PDF viewer.';
    }catch{if(!controller.signal.aborted){fitStatus.textContent='The PDF is unavailable right now. You can keep using the Archive reader or try again.';}}
  });
  const expanded=()=>document.fullscreenElement===reader||reader.classList.contains('book-expanded');
  const sync=()=>{fullscreen.setAttribute('aria-pressed',String(expanded()));fullscreen.setAttribute('aria-label',expanded()?'Exit fullscreen':'Enter fullscreen');fullscreen.querySelector('span').textContent=expanded()?'Exit fullscreen':'Fullscreen';};
  const exit=()=>{if(document.fullscreenElement===reader)document.exitFullscreen().catch(()=>{});reader.classList.remove('book-expanded');sync();};
  fullscreen.addEventListener('click',async()=>{if(expanded()){exit();return;}try{if(!reader.requestFullscreen)throw new Error();await reader.requestFullscreen();}catch{reader.classList.add('book-expanded');}sync();});
  document.addEventListener('fullscreenchange',sync);
  const close=(history=false)=>{fitRequest?.abort();currentBook=null;pdf=null;exit();root.hidden=true;frame.removeAttribute('src');if(!history)overlayClosed(root.id);};
  root.querySelector('[aria-label="Close player"]').addEventListener('click',()=>close());root.addEventListener('mousedown',event=>{if(event.target===root)close();});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!root.hidden){if(expanded()){event.preventDefault();exit();}else close();}});
  initBookCatalogue(book=>{fitRequest?.abort();currentBook=book;pdf=null;selectFit('archive');fitStatus.hidden=true;root.querySelector('h2').textContent=book.title;frame.src='https://archive.org/stream/'+encodeURIComponent(book.id)+'?ui=embed';root.querySelector('a').href='https://archive.org/details/'+encodeURIComponent(book.id);root.hidden=false;overlayOpened(root.id,()=>close(true));focusDialog(root.id);});
}
