import {isKidsChannel, languageCodes, languageName} from './content.js';
import {rankForDisplay} from './data.js';
import {renderGrid} from './ui.js';
const PAGE_SIZE=12;

let getChannels, getDataset, limit=PAGE_SIZE;
const el={};
export function kidsChannels() {
  const dataset=getDataset?.();
  if(!dataset) return [];
  const query=el.search.value.trim().toLocaleLowerCase();
  return rankForDisplay(getChannels().filter(isKidsChannel).filter(channel=>
    (!query || channel.name.toLocaleLowerCase().includes(query)) &&
    (!el.language.value || languageCodes(channel,dataset).includes(el.language.value)) &&
    (!el.country.value || channel.country===el.country.value)
  ));
}
function options(select, entries, label) {
  const selected=select.value;
  select.replaceChildren(new Option(label,''));
  entries.forEach(([value,name])=>select.add(new Option(name,value)));
  if(entries.some(([value])=>value===selected)) select.value=selected;
}
function render() {
  const channels=kidsChannels();
  el.count.textContent=channels.length.toLocaleString()+' kids channel'+(channels.length===1?'':'s')+' with published sources';
  renderGrid(el.grid,channels,getDataset(),limit,'No kids channels match. Try another language or country, or choose another source index in Settings.');
  el.more.hidden=channels.length<=limit;
  el.all.hidden=!channels.length;el.all.disabled=limit===Infinity;
}
export function showKids() {
  if(!getDataset?.()) return;
  const dataset=getDataset(), pool=getChannels().filter(isKidsChannel);
  const languages=[...new Set(pool.flatMap(channel=>languageCodes(channel,dataset)))].map(code=>[code,languageName(code,dataset.languages)]).sort((a,b)=>a[1].localeCompare(b[1]));
  const countries=[...new Set(pool.map(channel=>channel.country).filter(Boolean))].map(code=>[code,dataset.countries[code]?.name || code]).sort((a,b)=>a[1].localeCompare(b[1]));
  options(el.language,languages,'All languages');options(el.country,countries,'All countries');
  render();
}
export function initKids(config) {
  ({getChannels,getDataset}=config);
  el.all=document.getElementById('kids-live-all');
  el.all.addEventListener('click',()=>{limit=Infinity;render();el.count.tabIndex=-1;el.count.focus({preventScroll:true});});
  for(const key of ['search','language','country','count','grid','more','reset']) el[key]=document.getElementById('kids-'+key);
  for(const key of ['search','language','country']) el[key].addEventListener(key==='search'?'input':'change',()=>{limit=PAGE_SIZE;render();});
  el.more.addEventListener('click',()=>{limit+=PAGE_SIZE;render();});
  el.reset.addEventListener('click',()=>{el.search.value='';el.language.value='';el.country.value='';limit=PAGE_SIZE;render();});
}
