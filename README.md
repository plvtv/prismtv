# PrismTV

A streaming-service style web UI for the public [iptv-org](https://github.com/iptv-org/iptv)
channel index: hero banner, category carousels, search, My List, and an in-page HLS player.

No build step, no dependencies to install, no server code. Plain ES modules + one CDN script (hls.js).

## Run it

The app fetches JSON over the network and uses ES modules, so it must be served over HTTP —
opening `index.html` straight from Finder (`file://`) will not work.

```bash
cd ~/Documents/TV/prismtv
./serve.sh          # python3 serve.py 8080
```

Then open <http://localhost:8080>.

`serve.py` also prints whether `mpv` and `yt-dlp` were found. A plain
`python3 -m http.server` still works, but without the mpv bridge below.

Use plain **http://**, not https. A lot of public IPTV streams are HTTP-only, and a page served
over HTTPS would have them blocked as mixed content.

## What it does

- **Home** — rotating hero, *Continue watching*, *My List*, a row for your own country
  (from your browser locale), one row per category, then spotlight countries.
- **Search** — type in the top bar (or press `/`). Matches channel name, country and category.
- **Browse all** — full grid with category / country / language filters and paging.
- **Captions (CC)** — like YouTube: the **CC** button or the `c` key toggles them, a menu picks the
  language when a stream offers several, and your choice is remembered for the next channel. These are
  real broadcast captions (CEA-608/708 or WebVTT), so availability depends on the channel: in a sample,
  about half of US streams carried them, a quarter of UK ones, and none of the Indian ones. When a
  stream has none, the button stays dimmed and says so.
- **Auto-captions** — when a channel has no captions of its own, the CC menu can generate them
  from the audio: Chrome's speech recognition listens to the video (not your microphone), in the
  language you pick (Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, English and more).
  The app guesses the language from the channel's name and country and remembers your pick per
  channel. **Translate to English** uses Chrome's on-device translator. With captions on, a channel
  gets its broadcast captions if it has them and auto-captions if it doesn't.
  Needs Chrome 133+ or Edge on a computer (translation: Chrome 138+). While on, the channel's audio is
  sent to Google's speech service; nothing is sent while captions are off or the video is paused.
  Accuracy drops with music, crosstalk and ads, as with any auto-captions.
  They're laid out like broadcast roll-up captions: two lines in one panel, a written line never
  changes, words still being recognised are dimmed, a pause starts a fresh line, and bursts are
  revealed a line at a time so nothing scrolls past unread. **Drag the captions** above a news
  banner; the position is remembered (double-click resets it).
- **Full screen** — the button in the player bar, `F`, or double-click the picture. The whole
  player goes full screen, so captions and messages come along; `C` toggles captions, `Esc` exits.
- **My List & history** — kept in `localStorage`, this browser only. Nothing is uploaded anywhere.
- **Player** — a source that is already playing is never abandoned over a hiccup: a dropped
  connection is retried in place up to 4 times, quietly if the picture is still moving. Only a source that
  never starts, or stays down, is swapped for the next one. — `hls.js`, falling back to native HLS on Safari. Channels often publish several
  sources; if one times out or 404s the player automatically walks to the next, and you can pick
  one by hand from the *Source* dropdown.

## Playing things the browser cannot: mpv

A browser is the weakest possible IPTV client. It refuses streams without CORS headers, cannot
set a `User-Agent` or `Referer`, and cannot touch a YouTube or Twitch page. mpv has none of those
limits, so `serve.py` exposes a small localhost-only bridge and the player offers **▶ mpv**:

- in the player bar, for any stream at any time;
- as the primary button on YouTube/Twitch entries (mpv resolves them through yt-dlp);
- underneath a failure, since *browser-blocked* sources play in mpv untouched.

```bash
brew install mpv yt-dlp
```

Without mpv the button explains what to install; without the bridge (plain static server) it
hides itself. Geo-locked streams stay geo-locked — mpv changes the client, not your location.

**How the bridge is kept safe:** it binds to `127.0.0.1` only, accepts nothing but `http`/`https`
URLs, passes the URL to mpv as an argument after `--` so it can never be read as an option, and
launches via argv rather than a shell. No option ever comes from the page.

| Endpoint | Does |
|---|---|
| `/api/health` | reports whether mpv and yt-dlp are on PATH |
| `/api/play?url=&title=` | launches mpv on that URL |
| `/api/stop` | stops players this server started |

## Two channel indexes

A **source** dropdown in the top bar picks which index you browse:

| Source | Channels | Character |
|---|---|---|
| iptv-org | ~9,900 | Huge, category-tagged, a lot of dead links |
| Free-TV | ~2,000 | Hand-curated, high hit rate, country-grouped only |
| Both | ~11,900 | Everything, Free-TV listed first |

Free-TV entries carry a cyan **FREE-TV** tag so you can tell them apart, and its own status
markers are preserved:

- **GEO** — the list flags this channel as geoblocked. Shown, not hidden, so it is still there
  if you are on a VPN.
- **LINK** — the entry is a YouTube or Twitch *page*, not a stream. The browser cannot attach to
  those, so clicking one offers **Play in mpv** (which resolves it via yt-dlp) and a plain
  **Open on YouTube** link as the fallback.

Free-TV groups by country, not category, so its channels populate the country rows but mostly
not the News/Sports/Movies rows. That is why both indexes are kept rather than one replacing
the other. Country codes it uses that iptv-org does not recognise are dropped to "no country".

## LG Channels

A fourth source, `LG_CHANNELS.m3u` (~410 streams of LG's free ad-supported TV service), parsed
by `parseLG` in `js/sources.js`. It has no logos or categories: country comes from the "(XX)"
suffix on the name or the group title, "Alt" entries become backup sources, and a few name
keywords place channels in the News/Kids/Movies/... rows. Its host sends no CORS header, so
the list is fetched through `serve.py` (`/api/hls?raw=1`) when a direct fetch fails.

## Free streaming TV

A fifth source (`FAST_PLAYLISTS` in `js/config.js`): the English line-ups of Roku Channel, Xumo,
Local Now, Vizio WatchFree+, Whale TV+, Rakuten TV UK, LG Channels UK/Canada/Australia,
Samsung TV Plus Australia and 10 FAST (Australia), about 2,150 channels. Lists come from apsattv.com and
BuddyChewChew/app-m3u-generator; most are fetched through `serve.py` (no CORS). Parsed by
`parseGeneric` in `js/sources.js`: Spanish-language sections are skipped, and the same channel
on several services becomes one channel with backup sources. Plex US and Samsung TV Plus US
were tested and left out: most of their streams are region-locked outside the US.

## Random

The **Random** button in the top bar (or the **R** key) plays a random live channel, preferring
ones the health check found working. On the Movies tab it picks a random film; on Learn English,
a random lesson or practice channel.

## Local relay for browser-blocked streams

Many broadcasters never send `Access-Control-Allow-Origin`, so the browser refuses their
streams even though they are up. When the app runs under `serve.sh`, a source that fails
that way is retried automatically through `/api/hls` on `serve.py`, which fetches the
playlist and segments itself and serves them from localhost. Playlists are rewritten so
every segment, key and variant also goes through the relay. Sources that play directly are
never relayed. **Test sources** labels relay-playable sources "playable via local relay".

## Hiding channels that are not working

Preferences → **Hide channels that aren't working**. The first time it is turned on, `serve.py`
checks every stream URL from this computer in the background (~17k URLs, about 5 minutes,
96 at a time) and saves the results in `.stream-health.json`. A channel is hidden only when
every one of its streams was checked and none answered; unchecked channels and YouTube/Twitch
pages always stay visible. Results are reused for 12 hours, after which stale entries are
rechecked quietly at startup. **Re-check all channels** forces a full pass. Channels in My List
stay reachable even when hidden from the rows.

## Movies (Internet Archive)

The **Movies** tab (`js/movies.js`) browses public-domain films on archive.org in 22 rows (`GENRES`):
Top rated, Most watched, Comedy, Drama, Film noir, Mystery & thriller, Sci-fi, Horror, Westerns,
Adventure, Action, Crime, War, Romance, Musicals, Silent era, Animated features, Cartoons, Classic TV,
Documentaries, Vintage educational films (Prelinger) and Hidden gems, 40 titles each, loaded as they
scroll into view. **See all** on a row, or **Browse all**, opens a full grid with genre, decade and
sort menus and paging: about 27,000 feature films plus 9,000 classic TV episodes, 3,000 cartoons and
10,000 educational films. Search works inside the chosen genre and decade. Everything comes straight from archive.org's search
and metadata APIs (both send CORS headers). Only items with an MP4 are listed, so films play
in a plain `<video>` with pause and seek; no relay or hls.js involved. Multi-reel items get a
Part picker and advance automatically. Duplicate uploads of the same film are collapsed, and
items dated 1995 or later are excluded (in these collections they are almost always unlicensed
uploads). Your position in each film is saved in this browser and shown as
**Continue watching**.

## Learn English

The **Learn English** tab (`js/learn.js`) has:

- **Courses by level** (Beginner / Intermediate / Advanced, chosen with the chips; your level's
  row comes first) plus a **Pronunciation** row. 30 official playlists from BBC Learning
  English, VOA Learning English, English with Lucy, Rachel's English and Speak English With
  Vanessa, hard-coded in `COURSES`. Each plays as a whole playlist in YouTube's embedded
  player with English subtitles on (`cc_load_policy=1`).
- **New lessons**: the latest uploads from 6 teaching channels, read from YouTube's public RSS
  feeds through `serve.py` (`/api/hls?raw=1`), Shorts left out. Only shown under `serve.sh`.
- **Practice rows**: English-speaking live channels (US/UK/AU/CA/IE/NZ) for news,
  documentaries and easy listening. They open in the normal player with auto-captions
  switched on (`openPlayer(channel, { captions: true })`).
- **Continue learning**: the last 20 courses or lessons you opened, kept in this browser.
- **Add your own**: paste a YouTube channel, playlist or video link, a live `.m3u8` stream, or an
  `.m3u` channel playlist. Saved in this browser (`prismtv.learnMine`); YouTube links are checked
  through `serve.py`. Channels show as rows of their latest videos; streams and playlists open in
  the live player with captions on.

## Sources picked from FMHY

From [fmhy.net/video](https://fmhy.net/video) only the legitimate, free sources were taken. Its
streaming, embed, download and torrent sites were left out on purpose.

- **Official free channels on YouTube** (`data/youtube-free.json`, 295 channels): from the
  *Free-Official-Youtube-Content* list it links to, with channels that only post clips or trailers
  dropped, plus the US National Archives, British Pathé, NFB and Films by the Year. Shown as
  rows in Movies; a card plays that channel's uploads in the YouTube player.
- **Wikimedia Commons films** (`data/commons-films.json`, ~4,080 films, the data behind WikiFlix):
  a snapshot of Wikidata films with a full video on Commons, played directly (WebM). Refresh with
  `python3 tools/update-commons-films.py`.
- **Library of Congress** collections (National Screening Room, Edison films, early animation,
  Spanish–American War; 1,707 films): a snapshot in `data/loc-films.json`, played as MP4 from
  tile.loc.gov. The loc.gov API is not called from the browser because its Cloudflare bot check
  blocks it from some regions. Refresh with `python3 tools/update-loc-films.py`.
- **Official live streams**: NASA TV Public, NASA TV Media, RetroStrange TV and Old Timey Computer
  Show, added to the channel list.

## Watch on your phone, tablet or TV

    ./serve.sh --lan

Starts PrismTV in home-network mode: any device on the same Wi-Fi can open it at the address the
server prints (for example `http://192.168.1.20:8080` or `http://Your-Mac.local:8080`).
Preferences → **Watch on another device** shows the same addresses and a QR code for phones.

- The first time, macOS asks whether python3 may accept incoming connections: choose **Allow**.
- `serve.sh --lan` runs under `caffeinate -i`, so the Mac does not idle-sleep while serving.
- Only home-network addresses (private/link-local ranges) are answered; anything else gets 403.
- mpv stays Mac-only: `/api/play` and `/api/stop` refuse other devices, and the mpv button is hidden there.
- Each device keeps its own My List, history and watch progress (browser storage);
  the stream health check is shared, because the Mac runs it.
- Works in phone and tablet browsers (Safari, Chrome) and TV browsers that play HLS. Captions from
  speech (auto-CC) need desktop Chrome, so they may be missing on phones and TVs.

## Start automatically at login

Double-click **install-autostart.command** once. It adds `PrismTV.command` to System Settings →
General → Login Items, so every time you log in PrismTV starts in home-network mode in a minimised
Terminal window (and restarts itself if it ever stops). **uninstall-autostart.command** removes it.

A Terminal login item is used rather than a background launchd service because the project lives
in Documents, which macOS blocks background services from reading; Terminal already has access.
For it to start after a power cut or restart without anyone logging in, turn on automatic login
(System Settings → Users & Groups) and, on a Mac mini, "Start up automatically after a power
failure" (System Settings → Energy).

## Publish as a public website

Double-click **publish-to-github.command**. The first time it installs GitHub's command-line tool
(via Homebrew), signs you in through your browser, creates a public `prismtv` repository and turns
on GitHub Pages. The site then lives at `https://<your-github-name>.github.io/prismtv/`. Run the
same script again to publish later changes.

`.github/workflows/pages.yml` builds the site on every push and once a day:
`tools/build-mirror.py` copies the lists a browser cannot fetch itself (free streaming TV
playlists, LG Channels, Learn English's YouTube feeds) into `data/mirror/`, and `data/site.json`
marks the site as public.

On the public site:

- **Works:** live channels from iptv-org, Free-TV, LG Channels and the free streaming TV services;
  Movies (archive.org, Wikimedia Commons, Library of Congress, YouTube channels); Learn English,
  including New lessons; Random; My List and history (kept in each visitor's browser).
- **Not available** (they need serve.py on your own computer): the relay for browser-blocked
  streams, the working-channel check, mpv, and resolving YouTube links in "Add your own".
- **Left out on purpose:** the Shovo list, because many of its extra streams are unofficial
  restreams of pay channels.
- Visitors' browsers fetch every stream directly; nothing passes through your Mac, and the site
  works while your Mac is off. Files in `.gitignore` (backups, health results) are never published.

## Where the data comes from

Fetched at runtime from `https://iptv-org.github.io/api/`:

| File | Used for |
|---|---|
| `channels.json` | names, country, categories, NSFW/closed flags |
| `streams.json` | the `.m3u8` URLs, joined on `channel` |
| `logos.json` | artwork (best in-use logo per channel) |
| `countries.json` | names, flags, languages |
| `categories.json` | row titles |

Plus `Free-TV/IPTV`'s `playlist.m3u8` (~550 KB), parsed in `js/sources.js`.

Plus `IPTV-By-Shovo`'s `index.m3u` (~2.9 MB), also parsed in `js/sources.js`. It is iptv-org's
playlist with ~4.8k extra streams, so only streams iptv-org lacks are kept. Extras whose tvg-id
matches an iptv-org channel become backup sources on that channel; the rest appear under the
**Shovo extras** source. Streams hosted on a bare IP address are skipped
(`SHOVO_SKIP_BARE_IP` in `js/config.js`).

Roughly 13 MB of JSON, merged in the browser down to the fields the UI needs and cached in
**IndexedDB for 12 hours**. First load takes a few seconds; after that it is instant. The circular
arrow in the top right forces a refetch.

Channels with no stream, flagged NSFW, or marked closed are dropped. Counts land around
~10k playable channels.

## Known limits

- **Language filter is approximate.** Channel records carry no language; the per-feed language
  data lives in `feeds.json` (another ~8 MB), so language is inferred from the broadcast country's
  languages instead. Change this in `js/data.js` → `indexDataset` if you want the exact version.
- **Geo-locks cannot be worked around from the page.** The **Test sources** button in the player
  probes every source and reports a verdict each: playable, refused (403 — the region-lock
  signature), dead link, browser-blocked, or no response. A 403 means the server answered and
  turned you away; only a VPN changes that, because your apparent location comes from your
  network and never from the app. UK BBC channels are locked this way in *both* indexes.
- **Some streams simply will not play.** They may be offline, geo-restricted, or require a specific
  `User-Agent` / `Referer` that a browser is not allowed to set — those are marked
  *needs headers* in the source dropdown. This is inherent to the public index, not a bug here.
- **CORS.** Most streams allow cross-origin playback; a few do not and will fail in the browser
  while working fine in VLC.

## Layout

```
prismtv/
├── index.html
├── serve.sh       one-liner wrapper
├── serve.py       static files + the mpv bridge
├── css/style.css
└── js/
    ├── config.js    tunables: rows, cache TTL, timeouts, index URLs
    ├── sources.js   Free-TV M3U parser -> the same channel shape
    ├── bridge.js    talks to the local mpv helper, degrades to nothing
    ├── autocc.js    auto-captions: video audio -> speech recognition -> caption box
    ├── data.js      fetch + merge + IndexedDB cache + derived indexes
    ├── store.js     My List / history in localStorage
    ├── ui.js        cards, rows, hero, grid, toasts
    ├── player.js    HLS playback + source failover
    └── app.js       boot, views, filters, wiring
```

Most things worth tweaking (which category rows appear and in what order, spotlight countries,
row length, cache lifetime, stream timeout) live in `js/config.js`.

## Legal note

PrismTV ships no video. It is a viewer over a public, community-maintained list of stream URLs
published by third parties. Availability and broadcast rights for any given stream are between you
and whoever publishes it.
