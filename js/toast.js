// One quiet toast at a time, with an optional action (Undo).
// It waits while hovered or focused, and while the tab is hidden.
// A modal dialog makes the page under it inert and covers it, so the toast
// region always lives in the dialog on top: when one opens while a toast is
// showing, the region moves into it; when it closes, back to the next one
// down (or the page).
// On the page, a toast keeps clear of the row it reports on (opts.near, or the
// row that has focus when a sheet closes): the page scrolls that row up, or the
// toast moves to the top when the page can't scroll far enough. The DOR board
// fitted to a TV never scrolls for a toast (its header stays in view), and its
// toasts sit on the right, over Issue and Action, never over the figures.
// In a sheet, a toast that would cover the row it reports on moves to the top
// of the sheet, under its title.
// Focus never drops to <body>: after Undo (or when a focused toast leaves) it
// goes to the open sheet's title, else the board.
// Undo is one key away: Cmd+Z (Ctrl+Z off a Mac) runs a showing Undo, except in a
// text box that has its own typing to undo. An Undo started in a sheet waits
// while focus is anywhere in that sheet.

let region;
let current = null;

/** Mac keyboards undo with Cmd, everything else with Ctrl. */
const IS_MAC = /mac|iphone|ipad|ipod/i.test(navigator.userAgentData?.platform ?? navigator.platform ?? '');
const UNDO_KEYS = IS_MAC ? '⌘Z' : 'Ctrl+Z';
/** Text boxes typed in during this visit: Cmd/Ctrl+Z there is the box's own undo. */
const typedIn = new WeakSet();
/** The last box typed in: the browser's own undo goes back to it, even once it's closed or gone. */
let lastTyped = null;
const isTextBox = (el) => Boolean(el?.matches?.('textarea, [contenteditable=""], [contenteditable="true"], input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input[type="password"]'));
const shown = (el) => Boolean(el?.isConnected) && (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null);

/** The DOR board (v2) on a TV-sized window, where it fits the screen. */
const TV_BOARD = matchMedia('(min-width: 1800px) and (max-height: 1200px)');
const TV_WIDE = matchMedia('(min-width: 1800px)');
const onDorPage = () => document.documentElement.dataset.view === 'dor' && !document.documentElement.classList.contains('is-meeting');
const tvFitted = () => TV_BOARD.matches && onDorPage() && document.documentElement.dataset.layout === 'v2';

// Modal dialogs stack in the order they're shown; a toast belongs in the one on top.
const shownAt = new WeakMap();
let shownSeq = 0;

export function initToast() {
  region = document.querySelector('[data-toasts]');
  const showModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function showModalTracked(...args) {
    shownAt.set(this, ++shownSeq);
    const result = showModal.apply(this, args);
    // Enter numbers fills the screen at every size, and the Action register's form ends on
    // Save action: a message from before never sits on either (over a box's question, over
    // Save action). The board row keeps its own Undo link.
    if (current && (this.id === 'enter' || this.id === 'action-register')) dismiss(true, { refocus: false });
    // A sheet opened over a showing toast: the toast comes along, on top and pressable.
    if (current) placeRegion();
    return result;
  };
  // A dialog closed (the event doesn't bubble: capture it): the region goes to
  // the next dialog down, or back to the page, so the message stays in view,
  // clear of the row focus went back to.
  document.addEventListener('close', (e) => {
    if (!(e.target instanceof HTMLDialogElement) || !region || !e.target.contains(region)) return;
    placeRegion();
    if (current && region.parentElement === document.body) {
      requestAnimationFrame(() => requestAnimationFrame(() => { liftAboveFoot(); keepClear(rowOf(document.activeElement)); }));
    }
  }, true);
  document.addEventListener('input', (e) => {
    if (!isTextBox(e.target) || e.inputType === 'historyUndo' || e.inputType === 'historyRedo') return;
    typedIn.add(e.target);
    lastTyped = e.target;
  }, true);
  document.addEventListener('keydown', onUndoKey, true);
}

/**
 * Cmd+Z (Ctrl+Z off a Mac) presses a showing Undo, unless a text box has its own
 * typing to undo. Otherwise the browser's own undo is kept from reaching a box
 * that isn't on screen any more (a closed sheet's form), where it would change
 * words nobody can see.
 */
function onUndoKey(e) {
  if (e.key?.toLowerCase() !== 'z' || e.shiftKey || e.altKey) return;
  if (IS_MAC ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return;
  const a = document.activeElement;
  if (isTextBox(a) && typedIn.has(a)) return;
  const offScreen = Boolean(lastTyped) && !shown(lastTyped);
  const live = Boolean(current?.undo) && current.el.isConnected;
  // A sheet opened over the page since the toast showed: its Undo belongs to the page under it,
  // and the browser's own undo would reach into a form that was closed.
  const top = topDialog();
  if (!live || e.repeat || (top && top !== current.host)) {
    if (live || offScreen) e.preventDefault();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  current.undo();
}

function topDialog() {
  const open = [...document.querySelectorAll('dialog[open]')];
  open.sort((a, b) => (shownAt.get(a) ?? 0) - (shownAt.get(b) ?? 0));
  return open.pop() ?? null;
}

/** Put the region in the dialog on top, or in the page when none is open. Keeps focus where it was. */
function placeRegion() {
  if (!region) return;
  const host = topDialog() ?? document.body;
  if (region.parentElement === host && region.isConnected) return;
  const active = document.activeElement;
  const hadFocus = region.contains(active);
  // A toast moved to the top of the page (keepClear) goes back to its place in a sheet.
  region.style.removeProperty('top');
  region.style.removeProperty('bottom');
  host.append(region);
  alignForTv();
  if (hadFocus && active.isConnected) active.focus({ preventScroll: true });
}

/**
 * The DOR board on a TV: the toast sits on the right, lined up with the board's
 * edge, over the Issue and Action columns, so it never covers a status or a month figure.
 */
function alignForTv() {
  if (!region) return;
  ['left', 'right', 'transform', 'width'].forEach((p) => region.style.removeProperty(p));
  if (region.parentElement !== document.body || !TV_WIDE.matches || !onDorPage()) return;
  const board = document.querySelector('.board2');
  const issue = document.querySelector('.board2-head .h2c--issue');
  const edge = shown(board) ? board.getBoundingClientRect().right : window.innerWidth - 24;
  region.style.left = 'auto';
  region.style.right = `${Math.max(24, Math.round(window.innerWidth - edge))}px`;
  region.style.transform = 'none';
  // As wide as Issue and Action together (a long message takes two lines rather than reach the charts).
  if (shown(issue)) {
    const w = Math.round(edge - issue.getBoundingClientRect().left);
    if (w >= 360) region.style.width = `${Math.min(560, w)}px`;
  }
}

/**
 * On a TV-sized screen the DOR board ends on its footer legend, right where a
 * toast sits: the toast rises to sit 12px above the footer while it's in view.
 */
function liftAboveFoot() {
  if (!region || region.parentElement !== document.body) return;
  if (!TV_WIDE.matches || document.documentElement.classList.contains('is-meeting')) return;
  const foot = document.querySelector('.board2-foot');
  if (!shown(foot)) return;
  const f = foot.getBoundingClientRect();
  if (f.top >= window.innerHeight || f.bottom <= 0) return;
  const lift = Math.ceil(window.innerHeight - f.top + 12);
  const now = parseFloat(getComputedStyle(region).bottom) || 0;
  if (lift > now) { region.style.bottom = `${lift}px`; region.style.top = 'auto'; }
}

/** The row a focused control sits in (board row, table row), or the control itself. */
function rowOf(el) {
  if (!el || el === document.body || !el.isConnected) return null;
  return el.closest('.kpirow, .row, tr, .fgroup, [data-ar-item]') ?? el;
}

const GAP = 12;
/** A toast's buttons ignore pointer clicks this long after it appears. */
const CLICK_GRACE_MS = 350;

/** Is the toast on (or within 12px of) any of `targets`? Measured at its place, not its rise-in transform. */
function overlaps(targets) {
  const t = region.getBoundingClientRect();
  // A pixel of slack: scrolling lands on whole pixels.
  return targets.some((el) => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.bottom > t.top - GAP + 1 && r.top < t.bottom + GAP - 1 && r.right > t.left && r.left < t.right;
  });
}

/** Move the region so its top edge sits at `y` on screen (its containing block may be a sheet, not the window). */
function placeTopAt(y) {
  region.style.top = '0px';
  region.style.bottom = 'auto';
  const off = region.getBoundingClientRect().top;
  region.style.top = `${Math.round(y - off)}px`;
}

/** The targets a toast keeps clear of: one element, a list, or a function that returns either. */
function targetsOf(near) {
  const t = typeof near === 'function' ? near() : near;
  return (Array.isArray(t) ? t : [t]).filter((el) => el?.isConnected);
}

/**
 * Keep the toast off `target` (the row it reports on). On the page: scroll so
 * the row ends above the toast (a row taller than the room shows its lower part,
 * where its action is). When the page can't scroll that far, or it's the DOR
 * board fitted to a TV (whose header must stay in view), the toast moves to the
 * top of the screen instead, under the top bar, and the page doesn't move. In
 * a sheet: keepClearInSheet.
 */
function keepClear(near) {
  if (!current || document.documentElement.classList.contains('is-meeting')) return;
  const inSheet = region.parentElement !== document.body;
  let targets = targetsOf(near);
  // In a sheet, with nothing (else) named: the row that has focus.
  if (!targets.length && inSheet) targets = targetsOf(rowOf(document.activeElement));
  if (!targets.length) return;
  if (inSheet) { keepClearInSheet(targets); return; }
  const target = targets[0];
  if (overlaps(targets)) {
    const before = { top: region.style.top, bottom: region.style.bottom };
    const restore = () => { region.style.top = before.top; region.style.bottom = before.bottom; };
    const r = target.getBoundingClientRect();
    const t = region.getBoundingClientRect();
    // Just enough for the row's bottom to clear the toast, if the page has that much left to scroll.
    const need = Math.ceil(r.bottom - (t.top - GAP));
    const room = Math.max(0, document.documentElement.scrollHeight - window.innerHeight - window.scrollY);
    const fitted = tvFitted();
    if (!fitted && need <= room + 1) {
      window.scrollBy({ top: need, behavior: 'instant' });
    } else {
      // The top of the screen, under the top bar when it's in view (a navy toast on the navy bar would vanish).
      const bar = document.querySelector('.app .topbar');
      const barBottom = shown(bar) ? bar.getBoundingClientRect().bottom : 0;
      placeTopAt(Math.max(16, barBottom + 8));
      if (overlaps(targets)) {
        // No clear place on this screen: back to the bottom, showing as much of the row as the page allows.
        restore();
        if (!fitted && room > 0) window.scrollBy({ top: Math.min(need, room), behavior: 'instant' });
      }
    }
  }
  focusInView(target);
}

/** The element that scrolls `el` inside `stop` (a sheet's body), or null. */
function scrollParent(el, stop) {
  for (let n = el?.parentElement; n && n !== stop.parentElement; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return null;
}

/**
 * In a sheet: the same idea as on the page. The sheet's content scrolls just
 * enough for the row it reports on (and anything else named) to end above the
 * toast, as long as all of it stays in view; otherwise the toast moves to the
 * top of the sheet: over its title when that leaves the sheet's own buttons
 * (Close) clear, else just under its title bar.
 */
function keepClearInSheet(targets) {
  if (!overlaps(targets)) return;
  const sheet = region.parentElement;
  const scroller = scrollParent(targets[0], sheet);
  if (scroller) {
    const t = region.getBoundingClientRect();
    // What's below the toast (out of view) doesn't count: only what it covers and what's above it.
    const rects = targets.map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0 && r.top < t.bottom + GAP);
    const need = Math.ceil(Math.max(...rects.map((r) => r.bottom)) - (t.top - GAP));
    const room = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    const stillInView = Math.min(...rects.map((r) => r.top)) - need >= scroller.getBoundingClientRect().top;
    if (need > 0 && need <= room + 1 && stillInView) {
      scroller.scrollBy({ top: need, behavior: 'instant' });
      if (!overlaps(targets)) return;
    }
  }
  const head = [...sheet.querySelectorAll('.sheet-head, .enter-top, .cz-head')].find(shown);
  const top = Math.max(sheet.getBoundingClientRect().top, 0);
  const headButtons = head ? [...head.querySelectorAll('button, a[href], select, input')].filter(shown) : [];
  const before = { top: region.style.top, bottom: region.style.bottom };
  const tries = [
    [top + 16, [...targets, ...headButtons]],
    [Math.max(top, head ? head.getBoundingClientRect().bottom : top) + 8, targets],
  ];
  for (const [y, avoid] of tries) {
    placeTopAt(y);
    if (!overlaps(avoid)) return;
  }
  region.style.top = before.top;
  region.style.bottom = before.bottom;
}

/**
 * A row taller than the room shows its lower part, which can leave focus on its
 * name above the screen: focus moves to the saved row's own KPI link or day
 * status (the row's own words, never a definition's ⓘ beside them), even when
 * it's only partly in view. When neither shows at all, the page scrolls the
 * status into view first; any other control in view is the last resort. The
 * next Tab starts where the person is looking.
 */
function focusInView(target) {
  const a = document.activeElement;
  // Focus on the function's name, the toast keeping clear of one of its KPI rows: same group.
  const group = target.closest('.fgroup') ?? target;
  if (!a || !group.contains(a)) return;
  const t = region.getBoundingClientRect();
  const toastAtTop = t.top < window.innerHeight / 2;
  const lo = toastAtTop && current ? t.bottom : 0;
  const hi = !toastAtTop && current ? t.top : window.innerHeight;
  const box = (el) => el.getBoundingClientRect();
  const inView = (el) => { const r = box(el); return r.width > 0 && r.height > 0 && r.top >= lo && r.bottom <= hi; };
  const partly = (el) => { const r = box(el); return r.width > 0 && r.height > 0 && r.bottom > lo && r.top < hi; };
  if (inView(a)) return;
  const usable = (el) => (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null) && !el.closest('[hidden], [inert]');
  // The saved row's own: its KPI link, then its day status (the row first, then the rest of its group).
  const own = ['.kpi-link, .mx-link', '.v2cell--status']
    .flatMap((sel) => [...target.querySelectorAll(sel), ...(target.matches(sel) ? [target] : [])])
    .filter(usable);
  let pick = own.find(partly) ?? null;
  if (!pick && own.length) {
    // Out of view altogether: bring the day status (else the link) just into view, clear of the toast.
    pick = own.find((el) => el.matches('.v2cell--status')) ?? own[0];
    const r = box(pick);
    const by = r.top < lo ? r.top - lo - GAP : r.bottom > hi ? Math.min(r.bottom - hi + GAP, r.top - lo - GAP) : 0;
    if (by && region.parentElement === document.body) window.scrollBy({ top: Math.round(by), behavior: 'instant' });
  }
  if (!pick) {
    const first = (sel) => [...target.querySelectorAll(sel), ...group.querySelectorAll(sel)].find((el) => usable(el) && inView(el));
    pick = first('.kpi-link, .mx-link') ?? first('.v2cell--status') ?? first('a[href], button:not(:disabled):not(.term-btn), [tabindex="0"]');
  }
  if (!pick) return;
  if (!pick.matches('a[href], button, input, select, textarea, [tabindex]')) pick.setAttribute('tabindex', '-1');
  pick.focus({ preventScroll: true });
}

/** Focus fell off (to <body>, a removed node, or the leaving toast): the open sheet's title, else the board. */
function settleFocus(leaving = null) {
  const a = document.activeElement;
  const lost = !a || a === document.body || !a.isConnected || Boolean(leaving?.contains(a)) || Boolean(a.closest?.('[inert]'));
  if (!lost) return;
  const dlg = topDialog();
  const usable = (el) => el && !region?.contains(el) && !el.closest('[hidden], [inert]');
  let target = null;
  if (dlg) {
    target = [...dlg.querySelectorAll('[tabindex="-1"]')].find(usable)
      ?? [...dlg.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].find(usable)
      ?? null;
  }
  (target ?? document.querySelector('#board'))?.focus({ preventScroll: true });
}

// A sheet that redraws itself whole (Detail, Enter numbers) would take the
// region with it. While a toast shows, put the region back if that happens.
let watcher = null;
function watchRegion(on) {
  if (on && !watcher && 'MutationObserver' in window) {
    watcher = new MutationObserver(() => { if (current && !region.isConnected) placeRegion(); });
    watcher.observe(document.documentElement, { childList: true, subtree: true });
  } else if (!on && watcher) {
    watcher.disconnect();
    watcher = null;
  }
}

/**
 * opts.near: the element, or list of elements (or a function that returns
 * either), the toast reports on; the toast keeps clear of it once it shows. In a
 * sheet it keeps clear of the focused row when nothing is named.
 */
export function toast(message, { actionLabel, onAction, duration = 10000, near = null } = {}) {
  dismiss(true);
  region.style.removeProperty('top');
  region.style.removeProperty('bottom');
  // Over an open modal (the Customize sheet) the page is inert, so the toast
  // lives in that dialog, where its Undo can be pressed; otherwise in the page.
  placeRegion();
  alignForTv();
  const el = document.createElement('div');
  el.className = 'toast';
  const text = document.createElement('p');
  text.className = 'toast-text';
  text.textContent = message;
  el.append(text);
  const isUndo = actionLabel === 'Undo';
  // A toast can appear right where the pointer is (its × over Save): for its first 350ms a click
  // on it is the end of the click that brought it, so it does nothing. Keys work at once.
  const shownTime = performance.now();
  const tooSoon = (e) => Boolean(e?.detail) && performance.now() - shownTime < CLICK_GRACE_MS;
  let press = null;
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn toast-action';
    btn.textContent = actionLabel;
    if (isUndo) {
      // The shortcut is part of its name, and shows beside it in a small chip ("Undo ⌘Z"; not on touch screens).
      btn.setAttribute('aria-label', `Undo (${UNDO_KEYS})`);
      btn.setAttribute('aria-keyshortcuts', IS_MAC ? 'Meta+Z' : 'Control+Z');
      const keys = document.createElement('span');
      keys.className = 'toast-kbd';
      keys.setAttribute('aria-hidden', 'true');
      keys.textContent = UNDO_KEYS;
      btn.append(keys);
    }
    press = (e) => {
      if (tooSoon(e)) return;
      // The action decides where focus goes (Undo puts it back on what it restored);
      // if it doesn't, focus lands on the sheet's title or the board, never <body>.
      dismiss(false, { refocus: false });
      try { onAction?.(); } finally {
        // A sheet that redrew itself whole for the Undo took the (empty) region with it: put it back.
        if (!region.isConnected) placeRegion();
        settleFocus(el);
      }
    };
    btn.addEventListener('click', press);
    el.append(btn);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-btn toast-close';
  close.setAttribute('aria-label', 'Dismiss message');
  close.innerHTML = '<svg class="icon" aria-hidden="true" focusable="false"><use href="#g-close"></use></svg>';
  close.addEventListener('click', (e) => { if (!tooSoon(e)) dismiss(); });
  el.append(close);
  region.append(el);

  // The countdown: it waits while the toast is pointed at or focused, and while
  // the tab is hidden (one pause at a time: hover then focus pauses once).
  let remaining = duration;
  let startedAt = Date.now();
  let paused = false;
  let heldInSheet = false;
  let timer = 0;
  const run = (ms) => {
    clearTimeout(timer);
    startedAt = Date.now();
    remaining = ms;
    timer = setTimeout(expire, ms);
  };
  function expire() {
    if (current?.el !== el) return;
    // An Undo started in a sheet stays while focus is anywhere in that sheet, then gives a few
    // seconds more. One that came along from the page (or from another sheet) doesn't wait.
    const host = current?.host;
    const sheet = isUndo && host instanceof HTMLDialogElement && host.open && region.parentElement === host ? host : null;
    if (sheet?.contains(document.activeElement)) { heldInSheet = true; timer = setTimeout(expire, 500); return; }
    if (heldInSheet) { heldInSheet = false; run(4000); return; }
    dismiss();
  }
  const pause = () => {
    if (paused) return;
    paused = true;
    clearTimeout(timer);
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
  };
  const resume = () => {
    if (!paused || el.matches(':hover, :focus-within') || document.hidden) return;
    paused = false;
    run(Math.max(1500, remaining));
  };
  run(duration);
  el.addEventListener('pointerenter', pause);
  el.addEventListener('pointerleave', resume);
  el.addEventListener('focusin', pause);
  el.addEventListener('focusout', resume);
  const onVis = () => (document.hidden ? pause() : resume());
  document.addEventListener('visibilitychange', onVis);
  current = { el, host: region.parentElement, undo: isUndo ? press : null, cleanup: () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); } };
  watchRegion(true);
  // On a TV-sized board the toast sits above the footer legend.
  liftAboveFoot();
  const keep = near ?? (region.parentElement !== document.body ? () => rowOf(document.activeElement) : null);
  if (keep) {
    // After the page has settled (the row was just revealed, a sheet just closed).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (current?.el !== el) return;
      liftAboveFoot();
      keepClear(keep);
    }));
  }
  return el;
}

/**
 * Take down whatever message is showing, at once (the meeting opening or
 * closing, a screen that replaces the board). Focus stays where it is unless asked.
 */
export function dismissAll({ refocus = false } = {}) {
  dismiss(true, { refocus });
}

export function dismiss(instant = false, { refocus = true } = {}) {
  if (!current) return;
  const { el, cleanup } = current;
  current = null;
  cleanup();
  watchRegion(false);
  const hadFocus = el.contains(document.activeElement);
  if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) el.remove();
  else {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 160);
  }
  // A focused toast leaving: the sheet it sat in (its title), else the board.
  if (hadFocus && refocus) settleFocus(el);
}
