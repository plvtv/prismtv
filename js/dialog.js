// Shared keyboard and focus behaviour for live TV, films and lessons.
let active = null;
const selector = 'button, a[href], input, select, textarea, iframe, video[controls], [tabindex]';

function focusable(host) {
  return [...host.querySelectorAll(selector)].filter((node) =>
    !node.disabled && node.tabIndex >= 0 && !node.closest('[hidden], [inert]') && node.getClientRects().length);
}

function release(restore = true) {
  if (!active) return;
  const previous = active;
  active = null;
  previous.observer.disconnect();
  for (const [node, inert] of previous.background) node.inert = inert;
  document.body.style.overflow = previous.overflow;
  if (restore) {
    let target = previous.trigger;
    if (!target?.isConnected) {
      // Closing a film/lesson refreshes its row; find the replacement card.
      for (const attr of ['data-id', 'data-movie', 'data-learn']) {
        if (target?.hasAttribute(attr)) {
          const value = target.getAttribute(attr);
          target = [...document.querySelectorAll('[' + attr + ']')].find((node) => node.getAttribute(attr) === value && node.getClientRects().length);
          break;
        }
      }
    }
    if (target?.isConnected && !target.closest('[hidden], [inert]') && target.getClientRects().length) target.focus({ preventScroll: true });
    else [...document.querySelectorAll('.nav-link.is-active')].find((node) => node.getClientRects().length)?.focus({ preventScroll: true });
  }
}

export function focusDialog(id) {
  const root = document.getElementById(id);
  if (!root || root.hidden || active?.root === root) return;
  // Preserve the original opener when a film hands off to the YouTube player.
  const trigger = active?.trigger || document.activeElement;
  release(false);
  const dialog = root.querySelector('[role="dialog"]');
  const background = [...document.body.children]
    .filter((node) => node !== root && !['SCRIPT', 'STYLE', 'SVG'].includes(node.tagName) && node.id !== 'toast')
    .map((node) => [node, node.inert]);
  const overflow = document.body.style.overflow;
  dialog.tabIndex = -1;
  const observer = new MutationObserver(() => { if (root.hidden) release(); });
  active = { root, dialog, trigger, background, overflow, observer };
  observer.observe(root, { attributes: true, attributeFilter: ['hidden'] });
  for (const [node] of background) node.inert = true;
  document.body.style.overflow = 'hidden';
  // Allow the caller to populate the title before the dialog is announced.
  queueMicrotask(() => {
    if (active?.root === root) (root.querySelector('[aria-label="Close player"]') || focusable(dialog)[0] || dialog).focus({ preventScroll: true });
  });
}

document.addEventListener('keydown', (event) => {
  if (!active || event.key !== 'Tab') return;
  const host = document.fullscreenElement || active.dialog;
  const items = focusable(host);
  const first = items[0], last = items[items.length - 1];
  if (!first) { event.preventDefault(); active.dialog.focus(); return; }
  if (!host.contains(document.activeElement) ||
      (event.shiftKey && (document.activeElement === first || document.activeElement === host)) ||
      (!event.shiftKey && document.activeElement === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}, true);

document.addEventListener('focusin', (event) => {
  if (active && !active.root.contains(event.target)) {
    (focusable(document.fullscreenElement || active.dialog)[0] || active.dialog).focus();
  }
});
