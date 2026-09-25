export const API_BASE = 'https://iptv-org.github.io/api';

// Free-TV/IPTV: a second, hand-curated index. ~2k channels in one M3U instead of
// ~10k playable ones across 13 MB of JSON. Higher hit rate, far narrower coverage.
export const FREETV_URL = 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8';
// IPTV-By-Shovo: a community mirror of iptv-org's index.m3u plus ~4.8k extra streams
// (mostly free ad-supported channels: Pluto, Tubi, Samsung TV Plus, Amagi). Only the
// streams iptv-org does not already have are used, and bare-IP hosts are skipped:
// those are unofficial restreams that die often and sometimes rebroadcast pay TV.
export const SHOVO_URL = 'https://shovo127.github.io/IPTV-By-Shovo/index.m3u';
export const SHOVO_SKIP_BARE_IP = true;

// LG Channels: LG's free ad-supported TV service (official Amagi / Ottera feeds),
// ~400 streams across US, UK, EU, Nordics, AU and BR. Names carry a country code.
export const LG_URL = 'https://evdestek.ch/m3u8/LG_CHANNELS.m3u';

// Free ad-supported streaming TV (FAST) services, English-language line-ups. Checked from
// India: 77-100% of streams live. Plex US and Samsung US were left out: mostly region-locked.
// Lists come from the community-maintained apsattv.com pages and BuddyChewChew/app-m3u-generator.
export const FAST_PLAYLISTS = [
  { name: 'Roku Channel', country: 'US', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/roku_all.m3u' },
  { name: 'Xumo', country: 'US', url: 'https://www.apsattv.com/xumo.m3u' },
  { name: 'Local Now', country: 'US', url: 'https://www.apsattv.com/localnow.m3u' },
  { name: 'Vizio WatchFree+', country: 'US', url: 'https://www.apsattv.com/vizio.m3u' },
  { name: 'Whale TV+', country: 'US', url: 'https://www.apsattv.com/whaletvplus_us.m3u' },
  { name: 'Rakuten TV UK', country: 'GB', url: 'https://www.apsattv.com/rakuten_uk.m3u' },
  { name: 'LG Channels UK', country: 'GB', url: 'https://www.apsattv.com/gblg.m3u' },
  { name: 'LG Channels Canada', country: 'CA', url: 'https://www.apsattv.com/calg.m3u' },
  { name: 'LG Channels Australia', country: 'AU', url: 'https://www.apsattv.com/aulg.m3u' },
  { name: 'Samsung TV Plus Australia', country: 'AU', url: 'https://www.apsattv.com/ssungaus.m3u' },
  { name: '10 FAST', country: 'AU', url: 'https://www.apsattv.com/10fast.m3u' }
];

export const SOURCE_KEY = 'prismtv.source';

// How long the merged channel index is kept in IndexedDB before refetching.
export const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
export const CACHE_KEY = 'dataset:v9';

// iptv-org files the United Kingdom under "UK"; ISO 3166, Free-TV and browser locales use "GB".
// Codes are normalised to iptv-org's spelling, since its country table is the one the app uses.
export const COUNTRY_ALIASES = { GB: 'UK' };

export const HIDE_NSFW = true;   // drop channels flagged is_nsfw
export const HIDE_CLOSED = true; // drop channels with a `closed` date

export const MAX_ROW_ITEMS = 32;
export const PAGE_SIZE = 60;     // grid page size in Browse / search
export const HERO_COUNT = 6;
export const HERO_ROTATE_MS = 11000;
export const STREAM_TIMEOUT_MS = 14000;
export const MAX_AUTO_ATTEMPTS = 6; // automatic source failovers before the player stops and asks

// Category rows, in the order they appear on the home page.
export const ROW_CATEGORIES = [
  'news', 'sports', 'movies', 'entertainment', 'music', 'kids',
  'documentary', 'series', 'comedy', 'lifestyle', 'culture', 'science',
  'travel', 'cooking', 'business', 'education', 'animation', 'family',
  'outdoor', 'classic', 'weather', 'religious'
];

// Countries that get their own "Popular in ..." row, after the viewer's own.
export const SPOTLIGHT_COUNTRIES = ['US', 'UK', 'IN', 'CA', 'AU', 'DE', 'FR', 'ES', 'BR', 'JP'];
