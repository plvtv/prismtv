export const FEATURED_LANGUAGES = [
  {code:'tel',name:'Telugu',native:'తెలుగు'}, {code:'hin',name:'Hindi',native:'हिन्दी'},
  {code:'tam',name:'Tamil',native:'தமிழ்'}, {code:'eng',name:'English',native:'English'}
];
const LANGUAGES = {tel:'Telugu',te:'Telugu',hin:'Hindi',hi:'Hindi',tam:'Tamil',ta:'Tamil',eng:'English',en:'English',fra:'French',fre:'French',fr:'French',spa:'Spanish',es:'Spanish',deu:'German',ger:'German',de:'German',jpn:'Japanese',ja:'Japanese',kor:'Korean',ko:'Korean',mal:'Malayalam',ml:'Malayalam',kan:'Kannada',kn:'Kannada',ben:'Bengali',bn:'Bengali',mar:'Marathi',mr:'Marathi',urd:'Urdu',ur:'Urdu',por:'Portuguese',pt:'Portuguese',rus:'Russian',ru:'Russian',ara:'Arabic',ar:'Arabic',zho:'Chinese',chi:'Chinese',zh:'Chinese'};
export function languageName(value, names = {}) {
  const code=String(value || '').trim(); if(!code) return '';
  return names[code]?.name || names[code] || LANGUAGES[code.toLowerCase()] || code;
}
export function languageCodes(channel, dataset) {
  // Feed languages are authoritative. Do not turn a country's official languages into a channel claim.
  if (Array.isArray(channel.languages) && channel.languages.length) return channel.languages;
  const id=channel.id.replace(/^(?:freetv|shovo):/,'');
  return dataset.channelLanguages?.[channel.id] || dataset.channelLanguages?.[id] || [];
}
export function durationSeconds(value) {
  const text=String(value || '').trim();
  if(/^\d+(?:\.\d+)?$/.test(text)) return Number(text)*60;
  const parts=text.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if(parts) return parts[3]!==undefined?Number(parts[1])*3600+Number(parts[2])*60+Number(parts[3]):Number(parts[1])*60+Number(parts[2]);
  const minutes=text.match(/^(\d+(?:\.\d+)?)\s*(?:min|mins|minutes?)$/i);
  return minutes?Number(minutes[1])*60:NaN;
}
export function durationLabel(value) {
  const text=String(value || '').trim(); if(!text) return '';
  if(/^\d+(?:\.\d+)?$/.test(text)) { const minutes=Math.round(Number(text)); return minutes>0?minutes+' min':''; }
  const parts=text.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if(parts) {const seconds=parts[3]!==undefined?Number(parts[1])*3600+Number(parts[2])*60+Number(parts[3]):Number(parts[1])*60+Number(parts[2]);return seconds>0?Math.ceil(seconds/60)+' min':'';}
  return text.slice(0,60);
}
export function metadataLanguages(value, names={}) {
  const values=Array.isArray(value)?value:[value];
  return [...new Set(values.flatMap(v=>String(v || '').split(/[;,/]/)).map(v=>languageName(v.trim(),names)).filter(Boolean))].join(', ');
}
export function availabilityLabel(verdict, checkedAt=0, now=Date.now()) {
  if(!checkedAt || now-checkedAt*1000>48*3600000) return 'Availability not recently checked';
  if(verdict==='ok') return 'Source responded recently';
  if(verdict==='dead') return 'Source check failed';
  return 'Availability unconfirmed';
}
export function programmeWindow(programmes, now=Date.now()) {
  const valid=programmes.filter(p=>Number.isFinite(p.start)&&Number.isFinite(p.end)&&p.end>p.start&&p.title).sort((a,b)=>a.start-b.start);
  const current=valid.find(p=>p.start<=now&&p.end>now) || null;
  const upcoming=valid.filter(p=>p.start>= (current?.end || now)).slice(0,3);
  return {current,upcoming};
}
export function xmltvTime(value) {
  const m=/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-])(\d{2})(\d{2})$/.exec(value || '');
  if(!m) return NaN;
  return Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6] || 0))-(m[7]==='+'?1:-1)*(+m[8]*60 + +m[9])*60000;
}

export function isKidsChannel(channel) {
  return !channel.is_nsfw && (channel.categories || []).some(category => ['kids','children'].includes(category));
}

// Explicit selection from the bundled channel catalogue; its animation category also contains adult shows.
const KIDS_YOUTUBE = new Set([
  'Adventure Time','Angry Birds','Avatar: The Last Airbender','Ben 10','Cartoon Network UK','Cartoon Network India',
  'Code Lyoko English Official','Code Lyoko Officiel','Corneil & Bernie Officiel','Discovery Kids India',
  'Disney Channel Animation','DreamWorks Madagascar','Foot 2 Rue','Garfield & Friends','Gawayn','Green Gold TV',
  'Huntik Secrets and Seekers','Inspector Gadget','Johnny Test','Keep It Weird','Les Minijusticiers Officiel',
  'Martin Mystery','Marvel H.Q.','Minimighty Kids Official','Minuscule','Miraculous Ladybug','Nicktoons','Oddbods',
  'Oggy and the Cockroaches','Popeye And Friends Official','Robotboy','Shaun the Sheep Official',"Simon's Cat",
  'Slugterra','Smerfy • Po Polsku','Space Goofs','SpongeBob SquarePants Official','Studio Filmów Rysunkowych',
  'The Cramp Twins','The Fairly OddParents','The Loud House','The Smurfs','Totally Spies!',
  'Wallace & Gromit','WB Kids','WowKidz Movies','Zig & Sharko'
]);
export function isKidsYouTube(channel) { return channel.s==='cartoons' && KIDS_YOUTUBE.has(channel.n); }
