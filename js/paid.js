/**
 * Pay-TV channels, left out of the PUBLIC website only (data.js checks data/site.json).
 * A free stream of a subscription channel is almost never authorised by its owner.
 *
 * Only the iptv-org index is filtered: Free-TV lists free-to-air channels by policy, and the
 * free streaming TV services carry official free feeds. A channel is also kept whenever one of
 * its streams comes from an official free service (Pluto TV, Samsung TV Plus, Roku, Xumo...),
 * because those carry legitimate free versions of pay brands ("MTV Reality", "Nick Jr. Pluto TV").
 */
const OFFICIAL_FREE_HOSTS = /pluto\.tv|jmp2\.uk|amagi\.tv|samsung|wurl\.(com|tv)|roku|xumo|tubi|stitcher|plex\.tv|ottera\.tv|sling|vizio|localnow|frequency\.stream|redbox|lgchannels|lge-|tsv2\.amagi|cloudfront\.net\/.*(pluto|samsung)/i;

const ANY = [
  // international pay networks (brand names that are unambiguous worldwide)
  /^(hbo|cinemax|showtime|starz|epix|mgm\+|axn|paramount network|comedy central|syfy|hallmark channel|lifetime|a&e|cinecanal|studio universal|universal tv|warner tv|sony (channel|movies|one|canal)|star (life|movies|world|gold|plus|bharat|utsav|maa|vijay|jalsha|pravah|suvarna|kiran)\b|starplus)/i,
  /^(disney|nick(elodeon|\s?jr|toons)|cartoon network|boomerang|baby ?tv|discovery|animal planet|investigation discovery|tlc$|dmax|nat ?geo|national geographic)/i,
  /^(history( tv18| channel)?)$/i, /^history\b.*\b(latin america|asia|europe)\b/i,
  /^(tnt|tbs|fx|amc|bravo|e!)( (latin america|en espanol|europe|hd|series|novelas|international|life|asia))?$/i,
  /^(mtv|vh1)(\s|$)(?!.*\b(lebanon|chontales|guyana|volgograd)\b)/i,
  // sports rights holders
  /^(star sports|sony (sports|ten|six)|ten sports|willow|espn|sky (sports|cinema|atlantic|one|max|showcase|comedy|witness|crime|documentaries|nature|history|arts|kids)|bt sport|tnt sports|eurosport|dazn|bein sports(?! xtra)|fox sports|nbc sports|cbs sports network|nfl network|nba tv|mlb network|nhl network|sportsnet|tsn(?! telesondrio)|supersport|premier sports|setanta|viaplay|canal\+|movistar (deportes|plus|laliga|liga)|arena sport|sport tv\+?\d*$|match!|osn|rotana cinema|mbc (max|action))/i
];
// Indian (and South Asian) pay networks whose short names collide with unrelated channels abroad.
const SOUTH_ASIA = new Set(['IN', 'PK', 'BD', 'LK', 'NP']);
const INDIA = [
  /^(sony|set)\b(?!.*\bnews\b)/i, /\bsab\b/i, /^zee\b(?!.*\bnews\b)(?!\s*(business|hindustan|24|bharat|salaam|delhi|bihar|madhya|punjab|rajasthan|uttar|odisha|up\b|mp\b))/i,
  /^&\s?(tv|pictures|flix|priv[eé]|xplor)/i, /^and\s?(tv|pictures|flix)\b/i, /^colors\b/i, /^rishtey\b/i,
  /^sun\s?(tv|music|life|bangla|marathi|neo)\b/i, /^(ktv|chutti tv|adithya tv|kochu tv|surya (tv|movies|music|comedy))\b/i,
  /^gemini\s?(tv|movies|music|comedy|life)\b/i, /^udaya\s?(tv|movies|music|comedy)\b/i,
  /^(maa|vijay|asianet|jalsha|pravah|suvarna)\b(?!.*\bnews\b)/i, /^etv\b(?!.*\b(andhra pradesh|telangana|news|bharat)\b)/i,
  /^(zing|zoom|big magic|dangal 2|b4u|epic tv|hungama|sonic)\b(?!.*\bnews\b)/i
];
// Free-to-air broadcasters that share a pay brand's name: Finland's MTV, Greece's Star Channel, North Macedonia's Star.
const COUNTRY_FREE = [/^mtv(\s?(ava|sub|uutiset|3))/i, /televizija/i];
const EXCEPT_COUNTRY = { GR: [/^star\b/i] };
// Disney's European / Latin American "Star" pay channels (not Greece's free Star Channel).
const STAR_PAY = /^star (channel|crime|comedy)\b/i;

export function isPaidChannel(channel) {
  const name = String(channel.name || '').trim();
  if ((channel.streams || []).some((s) => OFFICIAL_FREE_HOSTS.test(s.url))) return false;
  if (COUNTRY_FREE.some((re) => re.test(name))) return false;
  if ((EXCEPT_COUNTRY[channel.country] || []).some((re) => re.test(name))) return false;
  if (STAR_PAY.test(name)) return true;
  if (ANY.some((re) => re.test(name))) return true;
  return SOUTH_ASIA.has(channel.country) && INDIA.some((re) => re.test(name));
}
