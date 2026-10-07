import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../js/learn-archive-catalogue.js',import.meta.url),'utf8');
const {ARCHIVE_LESSONS,archiveLessonMatches}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('practice search combines skill and all query words without case sensitivity',()=>{
 const lesson=ARCHIVE_LESSONS.find(lesson=>lesson.key==='english-rp');
 assert.equal(archiveLessonMatches(lesson,'accents','english RP'),true);
 assert.equal(archiveLessonMatches(lesson,'reading','english RP'),false);
 assert.equal(archiveLessonMatches(lesson,'','English unavailable'),false);
 assert.equal(archiveLessonMatches(lesson,'','  '),true);
});
test('read-along sources are offered for the matching fable edition, not accent comparisons',()=>{
 const reading=ARCHIVE_LESSONS.find(lesson=>lesson.key==='milkmaid'),accent=ARCHIVE_LESSONS.find(lesson=>lesson.key==='irish');
 assert.equal(reading.text,'https://www.gutenberg.org/ebooks/11339');assert.equal(accent.text,null);
 assert.equal(new URL(reading.url).hostname,'archive.org');assert.equal(reading.language,'English');
});
