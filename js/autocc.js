/**
 * Auto-captions: speech recognition over the channel's own audio.
 *
 * Since Chrome 133 (desktop), SpeechRecognition.start() accepts a MediaStreamTrack
 * instead of listening to the microphone. We capture the <video>'s audio with
 * captureStream(), hand that track to the recogniser, and lay the words out
 * ourselves. Optional translation to English uses Chrome's on-device Translator
 * API (Chrome 138+).
 *
 * Privacy: Chrome's recogniser sends the audio to Google's speech service.
 * The translation runs locally.
 */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

/** Languages Chrome's recogniser handles well, Indian languages first. */
export const LANGUAGES = [
  ['hi-IN', 'Hindi'], ['te-IN', 'Telugu'], ['ta-IN', 'Tamil'], ['kn-IN', 'Kannada'],
  ['ml-IN', 'Malayalam'], ['bn-IN', 'Bengali'], ['mr-IN', 'Marathi'], ['gu-IN', 'Gujarati'],
  ['pa-Guru-IN', 'Punjabi'], ['ur-IN', 'Urdu'], ['en-IN', 'English (India)'],
  ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['es-ES', 'Spanish'],
  ['es-MX', 'Spanish (Latin America)'], ['fr-FR', 'French'], ['de-DE', 'German'],
  ['pt-BR', 'Portuguese'], ['it-IT', 'Italian'], ['ru-RU', 'Russian'], ['ar-SA', 'Arabic'],
  ['tr-TR', 'Turkish'], ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'],
  ['cmn-Hans-CN', 'Chinese (Mandarin)'], ['id-ID', 'Indonesian']
];

const NAME_HINTS = [
  [/telugu/i, 'te-IN'], [/tamil/i, 'ta-IN'], [/kannada/i, 'kn-IN'], [/malayalam/i, 'ml-IN'],
  [/bangla|bengali/i, 'bn-IN'], [/marathi/i, 'mr-IN'], [/gujarati/i, 'gu-IN'],
  [/punjabi/i, 'pa-Guru-IN'], [/urdu/i, 'ur-IN'], [/hindi/i, 'hi-IN'], [/english/i, 'en-IN']
];

const COUNTRY_DEFAULT = {
  IN: 'hi-IN', PK: 'ur-IN', BD: 'bn-IN', US: 'en-US', CA: 'en-US', UK: 'en-GB', IE: 'en-GB',
  AU: 'en-GB', NZ: 'en-GB', FR: 'fr-FR', DE: 'de-DE', AT: 'de-DE', ES: 'es-ES', MX: 'es-MX',
  AR: 'es-MX', CO: 'es-MX', CL: 'es-MX', PE: 'es-MX', BR: 'pt-BR', IT: 'it-IT', RU: 'ru-RU',
  SA: 'ar-SA', AE: 'ar-SA', EG: 'ar-SA', QA: 'ar-SA', TR: 'tr-TR', JP: 'ja-JP', KR: 'ko-KR',
  CN: 'cmn-Hans-CN', TW: 'cmn-Hans-CN', ID: 'id-ID'
};

export function languageName(code) {
  return (LANGUAGES.find(([c]) => c === code) || [code, code])[1];
}

/** Translator API wants bare language codes; the recogniser's Mandarin tag maps to "zh". */
export function baseLanguage(code) {
  const base = String(code || '').split('-')[0];
  return base === 'cmn' ? 'zh' : base;
}

/** A sensible first guess: the channel's name wins ("… Telugu"), then its country. */
export function guessLanguage(channel) {
  for (const [re, code] of NAME_HINTS) if (re.test(channel.name || '')) return code;
  return COUNTRY_DEFAULT[channel.country] || 'en-US';
}

function chromiumMajor() {
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  const hit = brands.find((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand));
  if (hit) return parseInt(hit.version, 10) || 0;
  const m = navigator.userAgent.match(/Chrom(?:e|ium)\/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Feeding a track to the recogniser landed in Chrome 133. An older Chromium would
 * silently ignore the track and open the *microphone* instead, so we gate on version
 * rather than try it and see. Mobile Chrome does not support it yet.
 */
export function isSupported() {
  return Boolean(SR) &&
    typeof HTMLMediaElement !== 'undefined' &&
    typeof HTMLMediaElement.prototype.captureStream === 'function' &&
    chromiumMajor() >= 133 &&
    !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}

export function translationSupported() {
  return typeof self !== 'undefined' && 'Translator' in self;
}

/* =====================================================================
   Caption view
   Laid out the way broadcast roll-up captions are, because that is what makes
   live captions readable:
     - Line breaks are computed greedily from the start of each phrase, measured in
       real pixels. Greedy breaking is prefix-stable: adding words at the end can
       never change a line above, so once a line is written it stays exactly put.
     - Two lines on screen. When a third starts, the text scrolls up one line.
     - A pause in speech starts a fresh line, capitalised.
     - The block is left-anchored, so text grows to the right like typing instead
       of re-centring (and shifting) on every word.
     - Words still being recognised are slightly dimmed; only they can change.
   ===================================================================== */
const MAX_LINES = 2;
const PAUSE_BREAK_MS = 1400;     // silence that starts a new line
const CLEAR_AFTER_MS = 5500;     // silence that clears the box
const KEEP_LINES = 6;            // history kept per phrase, trimmed on line boundaries
const PACE_MS = 850;             // when several lines land at once, reveal one per beat

function createCaptionView(layer) {
  const panel = layer.querySelector('.autocc-panel');
  const linesEl = layer.querySelector('.autocc-lines');
  const ctx = document.createElement('canvas').getContext('2d');

  let paragraphs = [];     // committed words, one array per phrase
  let interim = [];        // words still being recognised
  let dropped = 0;         // lines scrolled away for good, keeps line numbering stable
  let lastTop = -1;
  let lastActivity = 0;
  let joiner = ' ';
  let locale = 'en';
  let maxWidth = 640;
  let clearTimer = null;
  let paceTimer = null;

  function measure() {
    const cs = getComputedStyle(panel);
    ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    const fontPx = parseFloat(cs.fontSize) || 20;
    const stageWidth = (layer.parentElement && layer.parentElement.clientWidth) || 960;
    // ~40–45 characters a line, the broadcast norm; never wider than most of the picture
    maxWidth = Math.max(160, Math.min(stageWidth * 0.8, fontPx * 22));
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    layer.style.setProperty('--cc-rail', Math.ceil(maxWidth + padX + 2) + 'px');
  }

  const width = (text) => ctx.measureText(text).width;

  function split(text) {
    const t = String(text || '').trim();
    if (!t) return [];
    return joiner ? t.split(/\s+/) : Array.from(t.replace(/\s+/g, ''));
  }

  function layout(words, firstTentative) {
    const lines = [];
    let line = [];
    let lineWidth = 0;
    const gap = joiner ? width(joiner) : 0;
    words.forEach((w, i) => {
      const ww = width(w);
      if (line.length && lineWidth + gap + ww > maxWidth) {
        lines.push(line);
        line = [];
        lineWidth = 0;
      }
      lineWidth += (line.length ? gap : 0) + ww;
      line.push({ w, tentative: i >= firstTentative });
    });
    if (line.length) lines.push(line);
    return lines;
  }

  function capitalise(word) {
    return word ? word.charAt(0).toLocaleUpperCase(locale) + word.slice(1) : word;
  }

  function tidy(word) {
    return locale === 'en' && word === 'i' ? 'I' : word;
  }

  /** Keep history bounded without ever reflowing what's visible. */
  function trim() {
    while (paragraphs.length > 3) dropped += layout(paragraphs.shift(), Infinity).length;
    const last = paragraphs[paragraphs.length - 1];
    if (!last) return;
    const lines = layout(last, Infinity);
    if (lines.length > KEEP_LINES) {
      const cut = lines.length - KEEP_LINES;
      const wordsCut = lines.slice(0, cut).reduce((n, l) => n + l.length, 0);
      last.splice(0, wordsCut);       // cut on a line boundary: the rest breaks identically
      dropped += cut;
    }
  }

  function lineNode(line) {
    const div = document.createElement('div');
    div.className = 'cc-line';
    const done = line.filter((x) => !x.tentative).map((x) => x.w).join(joiner);
    const maybe = line.filter((x) => x.tentative).map((x) => x.w).join(joiner);
    if (done) div.append(document.createTextNode(done));
    if (maybe) {
      const span = document.createElement('span');
      span.className = 'tent';
      span.textContent = (done && joiner ? joiner : '') + maybe;
      div.append(span);
    }
    return div;
  }

  function render() {
    // Measure only while visible: sizes come from the player's width, which a hidden box can't see.
    if (layer.hidden) { layer.hidden = false; measure(); }
    const all = [];
    paragraphs.forEach((p, i) => {
      const isLast = i === paragraphs.length - 1;
      const words = isLast ? p.concat(interim) : p;
      for (const line of layout(words, isLast ? p.length : Infinity)) all.push(line);
    });
    // Where the window would sit if we simply showed the newest two lines...
    const newest = dropped + Math.max(0, all.length - MAX_LINES);
    let top = newest;
    clearTimeout(paceTimer);
    if (lastTop >= 0) {
      // ...but never scroll backwards when a guess gets shorter,
      top = Math.max(top, Math.min(lastTop, dropped + all.length - 1));
      // and never skip a line nobody had time to read: advance one line per beat.
      if (top > lastTop + 1) {
        top = lastTop + 1;
        paceTimer = setTimeout(render, PACE_MS);
      }
    }
    top = Math.max(top, dropped);
    const shown = all.slice(top - dropped, top - dropped + MAX_LINES);
    linesEl.replaceChildren(...shown.map(lineNode));
    layer.hidden = shown.length === 0;
    layer.classList.remove('fading');
    // Roll-up: when the top line changes, slide the text up by one line.
    if (lastTop >= 0 && top > lastTop && shown.length === MAX_LINES && linesEl.animate) {
      const lineHeight = linesEl.firstChild.getBoundingClientRect().height || 30;
      linesEl.animate(
        [{ transform: 'translateY(' + lineHeight + 'px)' }, { transform: 'translateY(0)' }],
        { duration: 240, easing: 'cubic-bezier(.16, 1, .3, 1)' }
      );
    }
    lastTop = top;
    clearTimeout(clearTimer);
    if (shown.length) {
      clearTimer = setTimeout(() => {
        layer.classList.add('fading');
        clearTimer = setTimeout(reset, 400);
      }, CLEAR_AFTER_MS);
    }
  }

  /** A pause before new speech starts a fresh, capitalised line. */
  function noteActivity() {
    const now = Date.now();
    const last = paragraphs[paragraphs.length - 1];
    if (!last || (now - lastActivity > PAUSE_BREAK_MS && last.length)) paragraphs.push([]);
    lastActivity = now;
  }

  function reset() {
    clearTimeout(clearTimer);
    clearTimeout(paceTimer);
    paragraphs = [];
    interim = [];
    dropped = 0;
    lastTop = -1;
    linesEl.replaceChildren();
    layer.hidden = true;
    layer.classList.remove('fading');
  }

  return {
    setLanguage(code) {
      const base = baseLanguage(code);
      joiner = base === 'ja' || base === 'zh' ? '' : ' ';
      locale = base;
    },
    interim(text) {
      noteActivity();
      interim = split(text);
      render();
    },
    final(text) {
      noteActivity();
      const words = split(text).map(tidy);
      interim = [];
      if (words.length) {
        const para = paragraphs[paragraphs.length - 1];
        if (!para.length) words[0] = capitalise(words[0]);
        para.push(...words);
        trim();
      }
      render();
    },
    relayout() {
      measure();
      if (paragraphs.length) render();
    },
    reset,
    measure
  };
}

/** Drag the caption box up or down; the position is remembered. Double-click resets. */
function makeDraggable(layer) {
  const KEY = 'prismtv.ccBottom';
  const stage = layer.parentElement;
  const apply = (frac) => stage.style.setProperty('--cc-bottom', (frac * 100).toFixed(2) + '%');
  try { const saved = parseFloat(localStorage.getItem(KEY)); if (saved >= 0.02 && saved <= 0.9) apply(saved); } catch { /* ignore */ }

  const panel = layer.querySelector('.autocc-panel');
  let drag = null;
  panel.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const rect = stage.getBoundingClientRect();
    const box = layer.getBoundingClientRect();
    drag = { rect, offset: box.bottom - e.clientY };
    panel.setPointerCapture(e.pointerId);
    layer.classList.add('dragging');
    e.preventDefault();
  });
  panel.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const bottom = drag.rect.bottom - (e.clientY + drag.offset);
    apply(Math.min(0.9, Math.max(0.02, bottom / drag.rect.height)));
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    layer.classList.remove('dragging');
    const v = parseFloat(getComputedStyle(stage).getPropertyValue('--cc-bottom')) / 100;
    try { if (v) localStorage.setItem(KEY, String(v)); } catch { /* ignore */ }
  };
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', end);
  panel.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    stage.style.removeProperty('--cc-bottom');
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  });
}

/* =====================================================================
   Recognition + translation
   ===================================================================== */
export function createAutoCaptions({ layer, onState = () => {} }) {
  const view = createCaptionView(layer);
  makeDraggable(layer);

  let active = false;
  let video = null;
  let lang = 'en-US';
  let translate = false;
  let rec = null;
  let track = null;
  let restartTimer = null;
  let recentEnds = [];        // timestamps of recent session ends, for back-off
  let failures = 0;           // consecutive errors with no words in between
  let heardAnything = false;

  let translator = null;
  let translatorFor = null;
  let translateChain = Promise.resolve();   // keeps translated phrases in spoken order

  /* ---------- translation ---------- */
  async function prepareTranslator() {
    translator = null;
    translatorFor = null;
    const source = baseLanguage(lang);
    if (!translate) { onState({ translate: 'off' }); return; }
    if (source === 'en') { onState({ translate: 'not-needed' }); return; }
    if (!translationSupported()) { onState({ translate: 'unsupported' }); return; }
    try {
      const availability = await self.Translator.availability({ sourceLanguage: source, targetLanguage: 'en' });
      if (availability === 'unavailable') { onState({ translate: 'unavailable' }); return; }
      onState({ translate: availability === 'available' ? 'preparing' : 'downloading', progress: 0 });
      const made = await self.Translator.create({
        sourceLanguage: source,
        targetLanguage: 'en',
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => onState({ translate: 'downloading', progress: e.loaded }));
        }
      });
      if (!translate || baseLanguage(lang) !== source) return;   // settings changed meanwhile
      translator = made;
      translatorFor = source;
      view.setLanguage('en');
      onState({ translate: 'ready' });
    } catch (err) {
      onState({ translate: 'error', message: String((err && err.message) || err) });
    }
  }

  const translatingNow = () => translate && Boolean(translator);

  /** Translation works phrase by phrase: tentative words would mean re-translating constantly. */
  function showFinal(text) {
    if (!translatingNow()) { view.final(text); return; }
    const t = translator;
    translateChain = translateChain
      .then(() => t.translate(text))
      .then((out) => { if (active && translatingNow()) view.final(out); })
      .catch(() => { if (active) view.final(text); });
  }

  /* ---------- recognition ---------- */
  function releaseTrack() {
    if (track) { try { track.stop(); } catch { /* already ended */ } }
    track = null;
  }

  function captureTrack() {
    try {
      const stream = video.captureStream();
      return stream.getAudioTracks()[0] || null;
    } catch {
      return null;
    }
  }

  function scheduleRestart(base = 250) {
    if (!active) return;
    const now = Date.now();
    recentEnds = recentEnds.filter((t) => now - t < 15000);
    recentEnds.push(now);
    const delay = recentEnds.length > 4 ? 4000 : base;   // a session that keeps dying gets breathing room
    clearTimeout(restartTimer);
    restartTimer = setTimeout(begin, delay);
  }

  function fail(message) {
    stop();
    onState({ status: 'error', message });
  }

  function begin() {
    if (!active) return;
    releaseTrack();
    track = captureTrack();
    if (!track) { onState({ status: 'waiting-audio' }); scheduleRestart(1500); return; }

    const r = rec = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (e) => {
      if (rec !== r) return;
      failures = 0;
      if (!heardAnything) { heardAnything = true; onState({ status: 'live' }); }
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = (result[0] && result[0].transcript || '').trim();
        if (!text) continue;
        if (result.isFinal) showFinal(text);
        else pending += (pending ? ' ' : '') + text;
      }
      if (pending && !translatingNow()) view.interim(pending);
    };

    r.onerror = (e) => {
      if (rec !== r) return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        fail('This browser blocked its speech service, so auto-captions are unavailable here.');
      } else if (e.error === 'language-not-supported') {
        fail(languageName(lang) + ' isn’t supported by this browser’s speech service.');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        failures += 1;
        if (failures >= 6) fail('Couldn’t reach the speech service. Check your connection and try again.');
      }
      // everything else: 'end' follows and we pick up again
    };

    r.onend = () => {
      if (rec !== r) return;
      rec = null;
      scheduleRestart();      // Chrome ends sessions after silences and time limits; keep going
    };

    try {
      r.start(track);
      onState({ status: heardAnything ? 'live' : 'listening' });
    } catch {
      rec = null;
      scheduleRestart(1500);
    }
  }

  function stop() {
    active = false;
    clearTimeout(restartTimer);
    if (rec) {
      const r = rec;
      rec = null;
      try { r.abort(); } catch { /* not started */ }
    }
    releaseTrack();
    view.reset();
  }

  function restartRecognition() {
    if (!active) return;
    if (rec) { const r = rec; rec = null; try { r.abort(); } catch { /* ignore */ } }
    view.reset();
    heardAnything = false;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(begin, 120);
  }

  return {
    get active() { return active; },
    get lang() { return lang; },
    get translating() { return translatingNow(); },

    start(videoEl, options = {}) {
      stop();
      video = videoEl;
      lang = options.lang || lang;
      translate = Boolean(options.translate);
      view.setLanguage(translate && translatorFor === baseLanguage(lang) ? 'en' : lang);
      view.measure();
      active = true;
      failures = 0;
      heardAnything = false;
      recentEnds = [];
      onState({ status: 'listening' });
      begin();
      if (translate && translatorFor !== baseLanguage(lang)) prepareTranslator();
    },

    stop,

    setLanguage(code) {
      lang = code;
      view.setLanguage(code);
      restartRecognition();
      if (translate) prepareTranslator();
    },

    setTranslate(on) {
      translate = Boolean(on);
      view.reset();
      if (!translate) {
        translator = null;
        translatorFor = null;
        view.setLanguage(lang);
        onState({ translate: 'off' });
        return;
      }
      prepareTranslator();
    },

    /** Call when the stage changes size (fullscreen, window resize). */
    relayout() { view.relayout(); }
  };
}
