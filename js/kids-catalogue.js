// Archive subjects such as "children" and "juvenile" also describe adult dramas.
// Use children's-film phrases and familiar story titles instead of those broad tags.
const ANIMATION='collection:(classic_cartoons OR vintage_cartoons OR animationandcartoons)';
const STORY_TITLES='title:("Alice in Wonderland" OR "Gulliver\'s Travels" OR "The Jungle Book" OR "A Little Princess" OR "Jack and the Beanstalk" OR "The Wizard of Oz" OR "The Snow Queen" OR "The Pied Piper")';
const CHILDREN_FILMS='subject:("children\'s films" OR "children\'s movies" OR "films for children")';
export const KIDS_ARCHIVE_COLLECTIONS=[
  {id:'classics',title:'Classic cartoons',q:'collection:(classic_cartoons OR vintage_cartoons)'},
  {id:'children',title:'Children’s films',q:'collection:(feature_films OR classic_tv OR animationandcartoons) AND ('+CHILDREN_FILMS+' OR '+STORY_TITLES+') AND NOT subject:(horror OR adult OR "juvenile delinquency")'},
  {id:'characters',title:'Popeye, Casper & friends',q:ANIMATION+' AND title:(Popeye OR Casper OR Noveltoons OR "Little Lulu" OR Gabby OR "Felix the Cat")'},
  {id:'stories',title:'Fairy tales & storybook films',q:'collection:(feature_films OR classic_cartoons OR vintage_cartoons OR animationandcartoons) AND (subject:("fairy tales" OR "fairy tale" OR "children\'s stories") OR title:(Cinderella OR "Sleeping Beauty" OR "Jack and the Beanstalk" OR "Gulliver\'s Travels" OR "The Snow Queen")) AND NOT subject:(horror OR adult)'},
  {id:'learning',title:'Learn & explore',q:'collection:(educationalfilms OR prelinger) AND subject:(arithmetic OR counting OR "reading instruction") AND NOT subject:(sex OR puberty OR "social hygiene")'}
];
export const KIDS_ARCHIVE_QUERY='('+KIDS_ARCHIVE_COLLECTIONS.map(collection=>'('+collection.q+')').join(' OR ')+')';
