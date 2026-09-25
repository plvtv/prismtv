import { MAX_ROW_ITEMS } from './config.js';
import { myList } from './store.js';

/* =====================================================================
   Small helpers
   ===================================================================== */
const SOURCE_TAGS = { freetv: 'Free-TV', shovo: 'Shovo', lg: 'LG Channels', mine: 'Your playlist' };
function sourceTag(channel, base) {
  const tag = channel.via || SOURCE_TAGS[channel.source];
  return tag ? (base ? base + ' · ' + tag : tag) : base;
}

export function hashHue(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

export function initials(name) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '??';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Inline reference to one of the <symbol> icons declared in index.html. */
export function icon(name, cls = 'i') {
  return '<svg class="' + cls + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
}

export function channelSubtitle(channel, dataset) {
  const bits = [];
  const country = channel.country && dataset.countries[channel.country];
  if (country) bits.push(country.flag + ' ' + country.name);
  const cat = channel.categories[0] && dataset.categories[channel.categories[0]];
  if (cat) bits.push(cat.name);
  return bits.join(' · ');
}

function qualityOf(channel) {
  return channel.streams.find((s) => s.quality)?.quality || null;
}

function pageSite(channel) {
  return channel.streams[0]?.kind === 'twitch' ? 'Twitch' : 'YouTube';
}

/** The quiet line under a card: where, what, and which index it came from. */
function cardSubline(channel, dataset) {
  const base = channelSubtitle(channel, dataset);
  return sourceTag(channel, base);
}

/** The line revealed on hover: the details that matter just before you click. */
function hoverFacts(channel) {
  if (channel.external) return 'Live on ' + pageSite(channel);
  const bits = [];
  const quality = qualityOf(channel);
  if (quality) bits.push(quality);
  const n = channel.streams.length;
  bits.push(n + ' source' + (n === 1 ? '' : 's'));
  if (channel.geo) bits.push('region-locked');
  return bits.join(' · ');
}

/**
 * Logo layer with a soft fade-in once decoded, falling back to initials.
 * Listeners are attached before `src` so a cached image can't slip past them.
 */
function mountLogo(channel, host) {
  const fallback = () => {
    const span = document.createElement('span');
    span.className = 'initials';
    span.textContent = initials(channel.name);
    host.prepend(span);
  };
  if (!channel.logo) { fallback(); return; }
  const wrap = document.createElement('div');
  wrap.className = 'logo';
  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
  img.addEventListener('error', () => { wrap.remove(); fallback(); }, { once: true });
  img.src = channel.logo;
  wrap.append(img);
  host.prepend(wrap);
}

/** Tiny corner glyphs instead of text tags: a lock for geo-flagged, an arrow for page links. */
function statusGlyphs(channel) {
  const items = [];
  if (channel.geo) items.push(['geo', 'lock', 'Flagged as region-locked']);
  if (channel.external) items.push(['ext', 'external', 'Published as a ' + pageSite(channel) + ' page']);
  if (!items.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'flags';
  for (const [cls, name, tip] of items) {
    const span = document.createElement('span');
    span.className = 'flag-ic ' + cls;
    span.title = tip;
    span.innerHTML = icon(name);
    wrap.append(span);
  }
  return wrap;
}

/* =====================================================================
   Cards
   ===================================================================== */
export function createCard(channel, dataset) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card';
  card.dataset.id = channel.id;
  card.setAttribute('aria-label', channel.name);

  const art = document.createElement('div');
  art.className = 'art';
  art.style.setProperty('--h', String(hashHue(channel.id)));
  mountLogo(channel, art);

  const glyphs = statusGlyphs(channel);
  if (glyphs) art.append(glyphs);

  if (myList.has(channel.id)) {
    const fav = document.createElement('span');
    fav.className = 'fav';
    fav.textContent = '✓';
    art.append(fav);
  }

  const shade = document.createElement('div');
  shade.className = 'shade';
  const go = document.createElement('span');
  go.className = 'go';
  go.innerHTML = icon(channel.external ? 'external' : 'play');
  if (channel.external) go.firstChild.style.marginLeft = '0';
  const facts = document.createElement('span');
  facts.className = 'facts';
  facts.textContent = hoverFacts(channel);
  shade.append(go, facts);
  art.append(shade);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = channel.name;
  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = cardSubline(channel, dataset);
  meta.append(name, sub);

  card.append(art, meta);
  return card;
}

/* =====================================================================
   Up-next rail
   ===================================================================== */
export function createSideItem(channel, subtitle) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'side-item';
  item.dataset.id = channel.id;
  item.title = channel.name;

  const thumb = document.createElement('div');
  thumb.className = 'side-thumb';
  thumb.style.setProperty('--h', String(hashHue(channel.id)));
  mountLogo(channel, thumb);

  const meta = document.createElement('div');
  meta.className = 'side-meta';
  const name = document.createElement('strong');
  name.textContent = channel.name;
  const sub = document.createElement('span');
  const base = subtitle || '';
  sub.textContent = sourceTag(channel, base);
  meta.append(name, sub);

  if (channel.geo || channel.external) {
    const st = document.createElement('span');
    st.className = 'st' + (channel.geo ? ' geo' : '');
    st.innerHTML = channel.geo
      ? icon('lock') + 'Region-locked'
      : icon('external') + pageSite(channel) + ' page';
    meta.append(st);
  }

  item.append(thumb, meta);
  return item;
}

export function createSideGroup(label) {
  const el = document.createElement('div');
  el.className = 'side-group';
  el.textContent = label;
  return el;
}

/* =====================================================================
   Rows
   ===================================================================== */
export function createRow(title, channels, dataset, note = '', onMore = null) {
  const section = document.createElement('section');
  section.className = 'row';

  const head = document.createElement('div');
  head.className = 'row-head';
  const h2 = document.createElement('h2');
  h2.textContent = title;
  head.append(h2);
  if (note) {
    const small = document.createElement('span');
    small.className = 'row-note';
    small.textContent = note;
    head.append(small);
  }
  if (onMore) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'row-more';
    more.innerHTML = 'See all' + icon('arrow');
    more.addEventListener('click', onMore);
    head.append(more);
  }

  const wrap = document.createElement('div');
  wrap.className = 'row-wrap';
  const scroll = document.createElement('div');
  scroll.className = 'row-scroll';
  const frag = document.createDocumentFragment();
  for (const channel of channels.slice(0, MAX_ROW_ITEMS)) frag.append(createCard(channel, dataset));
  scroll.append(frag);

  const arrow = (side) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'row-arrow ' + side;
    btn.setAttribute('aria-label', side === 'left' ? 'Scroll left' : 'Scroll right');
    btn.innerHTML = '<span>' + icon('arrow') + '</span>';
    return btn;
  };
  const left = arrow('left');
  const right = arrow('right');

  const page = () => Math.max(scroll.clientWidth * 0.86, 240);
  left.addEventListener('click', () => scroll.scrollBy({ left: -page(), behavior: 'smooth' }));
  right.addEventListener('click', () => scroll.scrollBy({ left: page(), behavior: 'smooth' }));

  const sync = () => {
    left.disabled = scroll.scrollLeft < 8;
    right.disabled = scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 8;
  };
  scroll.addEventListener('scroll', sync, { passive: true });
  // Rows render lazily (content-visibility), so measure when the pointer arrives.
  wrap.addEventListener('pointerenter', sync);
  requestAnimationFrame(sync);

  wrap.append(left, scroll, right);
  section.append(head, wrap);
  return section;
}

/* =====================================================================
   Hero
   The rotation is driven by the progress bar's own CSS animation: when the
   bar finishes, we advance. Pausing the animation (hover, focus, off-screen,
   player open) therefore pauses rotation with zero timer bookkeeping, and the
   bar can never drift out of sync with the slide.
   ===================================================================== */
export function createHero(channels, dataset, onPlay, onList, rotateMs = 11000) {
  const host = document.getElementById('hero');
  host.innerHTML = '';
  host.classList.remove('paused');
  host.style.setProperty('--hero-dur', rotateMs + 'ms');

  const ctl = new AbortController();
  const { signal } = ctl;

  const layers = [document.createElement('div'), document.createElement('div')];
  layers.forEach((l) => { l.className = 'hero-layer'; });
  const bloom = document.createElement('img');
  bloom.className = 'hero-bloom';
  bloom.alt = '';
  bloom.setAttribute('aria-hidden', 'true');
  const grain = document.createElement('div');
  grain.className = 'hero-grain';
  const badge = document.createElement('div');
  badge.className = 'hero-badge';
  badge.setAttribute('aria-hidden', 'true');
  const badgeImg = document.createElement('img');
  badgeImg.alt = '';
  badge.append(badgeImg);
  const body = document.createElement('div');
  body.className = 'hero-body';
  host.append(layers[0], layers[1], bloom, grain, badge, body);

  let index = 0;
  let front = 0;
  let swapTimer = null;

  function paintBackdrop(channel) {
    const h = hashHue(channel.id);
    const next = layers[1 - front];
    next.style.background =
      'radial-gradient(58% 72% at 74% 36%, hsl(' + h + ' 52% 32% / .9), transparent 70%),' +
      'radial-gradient(46% 58% at 16% 96%, hsl(' + ((h + 60) % 360) + ' 42% 22% / .7), transparent 72%),' +
      'linear-gradient(160deg, hsl(' + h + ' 28% 12%), #07070b 72%)';
    next.classList.add('on');
    layers[front].classList.remove('on');
    front = 1 - front;

    // Fade the logo out, swap it while invisible, fade the new one in once decoded.
    badge.classList.remove('on');
    bloom.classList.remove('on');
    clearTimeout(swapTimer);
    if (!channel.logo) return;
    swapTimer = setTimeout(() => {
      const token = channel.id;
      badgeImg.onload = () => {
        if (channels[index].id !== token) return;
        badge.classList.add('on');
        bloom.classList.add('on');
      };
      badgeImg.onerror = () => { /* keep the badge hidden */ };
      badgeImg.src = channel.logo;
      bloom.src = channel.logo;
    }, 380);
  }

  function renderBody(channel) {
    body.innerHTML = '';
    const country = channel.country && dataset.countries[channel.country];

    const eyebrow = document.createElement('div');
    eyebrow.className = 'hero-eyebrow';
    const live = document.createElement('span');
    live.className = 'live-pill';
    live.textContent = 'LIVE';
    eyebrow.append(live);
    const facts = [];
    if (country) facts.push(country.flag + ' ' + country.name);
    const cat = channel.categories[0] && dataset.categories[channel.categories[0]];
    if (cat) facts.push(cat.name);
    const quality = qualityOf(channel);
    if (quality) facts.push(quality);
    for (const text of facts) {
      const span = document.createElement('span');
      span.textContent = text;
      eyebrow.append(span);
    }

    const h1 = document.createElement('h1');
    h1.textContent = channel.name;

    const desc = document.createElement('p');
    desc.className = 'hero-desc';
    const cats = channel.categories.map((c) => dataset.categories[c]?.name).filter(Boolean);
    const what = cats.length ? cats.slice(0, 2).join(' and ') : 'General';
    desc.textContent = what + ' programming' + (country ? ' from ' + country.name : '') +
      ', streaming free-to-air right now across ' + channel.streams.length +
      ' source' + (channel.streams.length === 1 ? '' : 's') + '.';

    const actions = document.createElement('div');
    actions.className = 'hero-actions';
    const watch = document.createElement('button');
    watch.type = 'button';
    watch.className = 'btn btn-play';
    watch.innerHTML = icon('play') + 'Watch now';
    watch.addEventListener('click', () => onPlay(channel));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn-ghost';
    const syncAdd = () => {
      const on = myList.has(channel.id);
      add.classList.toggle('on', on);
      add.innerHTML = icon(on ? 'check' : 'plus') + (on ? 'In My List' : 'My List');
    };
    syncAdd();
    add.addEventListener('click', () => { onList(channel.id); syncAdd(); });
    actions.append(watch, add);

    const progress = document.createElement('div');
    progress.className = 'hero-progress';
    channels.forEach((c, i) => {
      const seg = document.createElement('button');
      seg.type = 'button';
      seg.setAttribute('aria-label', 'Show ' + c.name);
      if (i === index) seg.className = 'on';
      seg.append(document.createElement('i'));
      seg.addEventListener('click', () => go(i));
      progress.append(seg);
    });
    progress.addEventListener('animationend', (e) => {
      if (e.animationName === 'progress') go((index + 1) % channels.length);
    });

    body.append(eyebrow, h1, desc, actions, progress);
    body.classList.remove('swap');
    void body.offsetWidth;          // restart the entrance animation
    body.classList.add('swap');
  }

  function go(i) {
    index = i;
    const channel = channels[index];
    paintBackdrop(channel);
    renderBody(channel);
  }

  // Pause while the viewer is reading, interacting, or looking elsewhere.
  const pause = () => host.classList.add('paused');
  const resume = () => { if (!host.matches(':hover') && !host.contains(document.activeElement)) host.classList.remove('paused'); };
  host.addEventListener('pointerenter', pause, { signal });
  host.addEventListener('pointerleave', resume, { signal });
  host.addEventListener('focusin', pause, { signal });
  host.addEventListener('focusout', () => setTimeout(resume, 0), { signal });
  let observer = null;
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(([entry]) => {
      if (entry.intersectionRatio < 0.35) pause(); else resume();
    }, { threshold: [0, 0.35, 1] });
    observer.observe(host);
  }

  if (channels.length) go(0);

  return {
    next() { go((index + 1) % channels.length); },
    stop() {
      ctl.abort();
      observer?.disconnect();
      clearTimeout(swapTimer);
    }
  };
}

/* =====================================================================
   Grid, toast
   ===================================================================== */
export function renderGrid(host, channels, dataset, limit) {
  host.innerHTML = '';
  if (!channels.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No channels match those filters.';
    host.append(p);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const channel of channels.slice(0, limit)) frag.append(createCard(channel, dataset));
  host.append(frag);
}

let toastTimer = null;
export function toast(message) {
  const node = document.getElementById('toast');
  const host = document.fullscreenElement || document.body;   // otherwise invisible in fullscreen
  if (node.parentElement !== host) host.append(node);
  node.textContent = message;
  node.hidden = false;
  node.style.animation = 'none';
  void node.offsetWidth;            // replay the entrance on every message
  node.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 3000);
}
