// One quiet toast at a time, with an optional action (Undo).
// It waits while hovered or focused, and while the tab is hidden.

let region;
let current = null;

export function initToast() {
  region = document.querySelector('[data-toasts]');
}

export function toast(message, { actionLabel, onAction, duration = 10000 } = {}) {
  dismiss(true);
  // Over an open modal (the Customize sheet) the page is inert, so the toast
  // lives in that dialog, where its Undo can be pressed; otherwise in the page.
  const host = [...document.querySelectorAll('dialog[open]')].pop() ?? document.body;
  if (region.parentElement !== host) {
    host.append(region);
    // When that dialog closes, the message stays on screen in the page.
    if (host !== document.body) host.addEventListener('close', () => document.body.append(region), { once: true });
  }
  const el = document.createElement('div');
  el.className = 'toast';
  const text = document.createElement('p');
  text.className = 'toast-text';
  text.textContent = message;
  el.append(text);
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn toast-action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => { dismiss(); onAction?.(); });
    el.append(btn);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-btn toast-close';
  close.setAttribute('aria-label', 'Dismiss message');
  close.innerHTML = '<svg class="icon" aria-hidden="true" focusable="false"><use href="#g-close"></use></svg>';
  close.addEventListener('click', () => dismiss());
  el.append(close);
  region.append(el);

  let remaining = duration;
  let startedAt = Date.now();
  let timer = setTimeout(() => dismiss(), remaining);
  const pause = () => { clearTimeout(timer); remaining -= Date.now() - startedAt; };
  const resume = () => {
    if (el.matches(':hover, :focus-within') || document.hidden) return;
    startedAt = Date.now();
    clearTimeout(timer);
    timer = setTimeout(() => dismiss(), Math.max(1500, remaining));
  };
  el.addEventListener('pointerenter', pause);
  el.addEventListener('pointerleave', resume);
  el.addEventListener('focusin', pause);
  el.addEventListener('focusout', resume);
  const onVis = () => (document.hidden ? pause() : resume());
  document.addEventListener('visibilitychange', onVis);
  current = { el, cleanup: () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); } };
  return el;
}

export function dismiss(instant = false) {
  if (!current) return;
  const { el, cleanup } = current;
  current = null;
  cleanup();
  const hadFocus = el.contains(document.activeElement);
  if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) el.remove();
  else {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 160);
  }
  if (hadFocus) document.querySelector('#board')?.focus({ preventScroll: true });
}
