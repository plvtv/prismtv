/**
 * Phone behaviour shared by the three players (live TV, films, lessons).
 *
 * Back button: opening a player adds a browser-history entry, so the phone's Back button
 * (or a back swipe) closes the player instead of leaving PrismTV.
 *
 * Swipe: on the video, swipe up for full screen (turning to landscape where the phone
 * allows it) and swipe down to leave full screen, like the YouTube app.
 */
const stack = [];          // open overlays, newest last: { name, close }
let skipPop = 0;           // history.back() calls we made ourselves

/** Call when an overlay opens. Re-opening one that is already open does not add another entry. */
export function overlayOpened(name, close) {
  if (stack.length && stack[stack.length - 1].name === name) {
    stack[stack.length - 1].close = close;
    return;
  }
  stack.push({ name, close });
  try { history.pushState({ prismOverlay: name }, ''); } catch { /* ignore */ }
}

/** Call when an overlay is closed from its own button / Esc, to drop its history entry. */
export function overlayClosed(name) {
  const i = stack.map((o) => o.name).lastIndexOf(name);
  if (i === -1) return;
  stack.splice(i, 1);
  if (history.state && history.state.prismOverlay) {
    skipPop += 1;
    history.back();
  }
}

window.addEventListener('popstate', () => {
  if (skipPop) { skipPop -= 1; return; }
  const top = stack.pop();
  if (!top) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  top.close({ fromHistory: true });
});

/* ---------------- full screen ---------------- */
export async function enterFullscreen(target, video) {
  try {
    if (target.requestFullscreen) await target.requestFullscreen({ navigationUI: 'hide' });
    else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
    else if (video && video.webkitEnterFullscreen) { video.webkitEnterFullscreen(); return; }   // iPhone
    // Android Chrome can turn to landscape once in full screen; other browsers just refuse.
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
  } catch { /* the browser refused; nothing to do */ }
}
export function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
  try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch { /* ignore */ }
}

/** Swipe up on `area` for full screen of `target`; swipe down to leave it. */
export function enableSwipeFullscreen(area, target, getVideo = () => null) {
  let x0 = 0, y0 = 0, t0 = 0, tracking = false;
  area.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    tracking = true;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  area.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dy = y0 - t.clientY;
    const dx = Math.abs(t.clientX - x0);
    if (Date.now() - t0 > 700 || Math.abs(dy) < 60 || dx > Math.abs(dy) * 0.7) return;
    const full = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    if (dy > 0 && !full) enterFullscreen(target, getVideo());
    else if (dy < 0 && full) exitFullscreen();
  }, { passive: true });
}

/** One overlay turns into another in place (e.g. a film player hands over to the YouTube player). */
export function renameOverlay(from, to) {
  const top = stack[stack.length - 1];
  if (!top || top.name !== from) return false;
  top.name = to;
  try { history.replaceState({ prismOverlay: to }, ''); } catch { /* ignore */ }
  return true;
}
