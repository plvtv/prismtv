// Exact media links and runtimes from the official LibriVox catalogues.
// These are listening exercises, not a modern grammar syllabus or CEFR certification.
const TEXT='https://www.gutenberg.org/ebooks/11339';
const sources={
  listening:{id:'aesop_fables_volume_one_librivox',catalogue:'https://librivox.org/aesops-fables-volume-1-fables-1-25/'},
  reading:{id:'aesop_fables_volume_two_librivox',catalogue:'https://librivox.org/aesops-fables-volume-2-fables-26-50/'},
  accents:{id:'dialect_accent_0909_librivox',catalogue:'https://librivox.org/celebration-of-dialects-and-accents-vol-1/'}
};
export const ARCHIVE_SKILLS=[{id:'listening',name:'Short listening'},{id:'reading',name:'Read & retell'},{id:'accents',name:'Accent listening'}];
const recordings={
  listening:[
    ['fox-grapes','The Fox and the Grapes','fables_01_01_aesop_64kb.mp3',46,'Listen once without the text. Explain why the fox walks away in one sentence.'],
    ['golden-eggs','The Goose That Laid the Golden Eggs','fables_01_02_aesop_64kb.mp3',66,'Listen for the sequence of events. Retell it using first, then and finally.'],
    ['dog-sow','The Dog and the Sow','fables_01_08_aesop_64kb.mp3',44,'Listen twice. Write down three words you recognize, then check the source text.'],
    ['lion-mouse','The Lion and the Mouse','fables_01_19_aesop_64kb.mp3',107,'Notice how the two characters help each other. Summarize the story in your own words.'],
    ['crow-pitcher','The Crow and the Pitcher','fables_01_20_aesop_64kb.mp3',84,'Listen for the problem and its solution. Describe the solution using action verbs.']
  ],
  reading:[
    ['fox-stork','The Fox and the Stork','fables_02_01_aesop_64kb.mp3',71,'Find the story in the source text. Listen, then read a few sentences aloud.'],
    ['milkmaid','The Milkmaid and Her Pail','fables_02_04_aesop_64kb.mp3',102,'Read along once. Close the text and retell the story in three sentences.'],
    ['oak-reeds','The Oak and the Reeds','fables_02_16_aesop_64kb.mp3',62,'Look up two unfamiliar words. Read their sentences aloud and copy the speaker’s rhythm.'],
    ['shepherd-wolf','The Shepherd’s Boy and the Wolf','fables_02_21_aesop_64kb.mp3',61,'Listen for repeated ideas. Explain the ending, then compare your summary with the text.'],
    ['crab-mother','The Crab and His Mother','fables_02_25_aesop_64kb.mp3',57,'Listen and read the short dialogue. Practise saying each character’s lines aloud.']
  ],
  accents:[
    ['irish','The North Wind and the Sun · Irish accent','dialectaccent_vol_01_02poh_64kb.mp3',74,'Compare this reading with another accent. Notice the vowel sounds and sentence stress.'],
    ['australian','The North Wind and the Sun · Australian accent','dialectaccent_vol_01_03arb_64kb.mp3',60,'Listen to one sentence several times. Say it aloud and compare your rhythm.'],
    ['english-rp','The North Wind and the Sun · English RP accent','dialectaccent_vol_01_04rg_64kb.mp3',75,'Compare familiar words with the Australian reading. Focus on understanding both pronunciations.'],
    ['american','The North Wind and the Sun · American accent','dialectaccent_vol_01_17kara_64kb.mp3',52,'Compare this reading with the English RP recording. Notice differences in the sound of r.'],
    ['canadian','The North Wind and the Sun · Canadian accent','dialectaccent_vol_01_20smh_64kb.mp3',54,'Listen for the same story in a different voice. Write a one-sentence summary without looking at the text.']
  ]
};
// Interleave skills so the initial selection includes examples of each.
export const ARCHIVE_LESSONS=Array.from({length:5},(_,index)=>ARCHIVE_SKILLS.map(skill=>{
  const [key,title,file,seconds,practice]=recordings[skill.id][index],source=sources[skill.id];
  return {key,skill:skill.id,title,seconds,practice,language:'English',source:source.catalogue,
    url:'https://archive.org/download/'+source.id+'/'+file,archive:'https://archive.org/details/'+source.id,
    text:skill.id==='accents'?null:TEXT};
})).flat();
export function archiveLessonMatches(lesson,skill='',query='') {
  const words=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text=(lesson.title+' '+lesson.practice+' '+ARCHIVE_SKILLS.find(item=>item.id===lesson.skill)?.name).toLocaleLowerCase();
  return (!skill || lesson.skill===skill) && words.every(word=>text.includes(word));
}
