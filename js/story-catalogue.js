export async function initStoryCatalogue(openBook) {
  const grid=document.getElementById('story-library-grid'),search=document.getElementById('story-library-search'),count=document.getElementById('story-library-count'),more=document.getElementById('story-library-more'),retry=document.getElementById('story-library-retry');
  if(!grid)return;
  let books=[],limit=24;
  const make=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls||'';if(text)node.textContent=text;return node;};
  function render() {
    const words=search.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches=books.filter(book=>words.every(word=>(book.title+' '+book.author).toLocaleLowerCase().includes(word)));
    const shown=matches.slice(0,limit);count.textContent=matches.length?'Showing '+shown.length+' of '+matches.length+' recordings':'No recordings match. Try another title or author.';grid.replaceChildren();more.hidden=shown.length>=matches.length;
    for(const book of shown){const button=make('button','learn-source-card learn-book-card story-library-card');button.type='button';button.dataset.storyId=book.id;
      const cover=make('div','learn-cover learn-cover-book');cover.setAttribute('aria-hidden','true');const image=make('img');image.alt='';image.loading='lazy';image.decoding='async';image.src='https://archive.org/services/img/'+encodeURIComponent(book.id);image.addEventListener('error',()=>{image.remove();cover.append(make('span','story-cover-fallback','Audio'));},{once:true});cover.append(image);
      button.append(cover,make('span','learn-source-level','English · LibriVox audiobook'),make('h3','',book.title),make('span','learn-source-provider',book.author),make('span','learn-source-action','▶ Open listening playlist'));button.addEventListener('click',()=>openBook(book));grid.append(button);
    }
  }
  async function load(){count.textContent='Loading story library…';retry.hidden=true;try{const response=await fetch('./data/story-catalogue.json');if(!response.ok)throw new Error();const data=await response.json();if(!Array.isArray(data.items))throw new Error();books=data.items.filter(book=>typeof book.id==='string'&&typeof book.title==='string'&&typeof book.author==='string');render();}catch{count.textContent='Could not load the story library.';retry.hidden=false;}}
  search.addEventListener('input',()=>{limit=24;render();});more.addEventListener('click',()=>{limit+=24;render();});retry.addEventListener('click',load);await load();
}
