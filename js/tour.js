// Onboarding tours, one for each view. A hand-built spotlight: the page dims,
// a clear cut-out frames the part being explained, and a card beside it says
// what it is. On a phone the card is a bottom sheet and the part scrolls into
// view above it. Keyboard: focus moves into the card, ← → step, Esc skips, and
// focus goes back where it was afterwards.

import { pageHref } from './shell.js?v=20261013-151156';
import { esc } from './ui.js?v=20261013-151156';
import { getSettings, derive } from './customize.js?v=20261013-151156';
import { dayStatus, OFF } from './status.js?v=20261013-151156';

const FLAG = { home: 'dor.tour.home.v1', dor: 'dor.tour.dor.v2' };
export const ARRIVAL_KEY = 'dor.tour.arrival';
const PAD = 6; // cut-out padding around the target
const isPhone = () => matchMedia('(max-width: 599px)').matches;
/** "Tap" on touch screens, "Click" with a mouse. */
const act = (capital = false) => {
  const w = matchMedia('(hover: none)').matches ? 'tap' : 'click';
  return capital ? w[0].toUpperCase() + w.slice(1) : w;
};
/** How to find which KPI a red dot means: point at it with a mouse; on a touch screen, a tap opens the function's detail. */
const pointWords = () => (matchMedia('(hover: none)').matches
  ? 'Tap a function to see which KPI missed.'
  : 'Point at a red dot to see which KPI missed.');

export function tourSeen(kind) {
  try { return Boolean(localStorage.getItem(FLAG[kind])); } catch { return false; }
}
function markSeen(kind, how) {
  try { localStorage.setItem(FLAG[kind], how); } catch { /* storage blocked: it may show again next visit */ }
}

/* ---------- The steps ---------- */

function homeSteps(month, day) {
  return [
    {
      title: 'Welcome',
      text: "This is your plant's Daily Operating Review. Each morning every function enters its numbers and the board works out what's on track. Here's a quick tour.",
    },
    { target: ['[data-home-summary]'], title: 'The one-line answer', text: "Start here. One line says how many functions hit their goal and which didn't." },
    { target: ['.h-date'], title: 'Pick a day', text: 'Pick any production day and the whole dashboard follows.' },
    {
      target: ['.h-kpis'],
      title: 'Key numbers',
      text: `Each card shows the result and its goal. Red means it missed. For things like scrap or injuries, above goal is a miss. ${act(true)} one for that function's detail and the KPAs that drive it.`,
    },
    {
      target: ['.panel--matrix'],
      // A card that has to sit over this wide panel goes on its left: the status dots are on the right.
      side: 'left',
      title: 'Every function at a glance',
      text: `Each function's plant total and month so far. A green dot is on track, a red dot with ! is off goal, a gray ring is not entered yet. A function with several KPIs is off goal when any of them is. ${pointWords()}`,
    },
    {
      target: ['.panel--issues'],
      side: 'left', // over this panel, the card keeps clear of Action, Owner and Status on its right
      title: 'Issues and actions',
      text: "What's keeping each function from its goal and what's being done in the next 24 hours, with each issue's status. A KPI that's off goal with no action says Needs an action.",
    },
    {
      target: ['.h-actions [data-enter]', '.h-mobilebar [data-enter]'],
      title: 'Enter numbers',
      text: `Owners ${act()} Enter numbers, pick their name and type the numbers, from a phone or a computer. The board updates right away.`,
    },
    {
      target: ['.side [data-run-meeting]'],
      fallback: '.side-menu-btn',
      fallbackNote: 'On a phone it\'s in the menu, top right.',
      title: 'Run meeting',
      text: 'Running the morning meeting? Run meeting shows one function at a time on the TV. Arrow keys or a clicker move through it.',
    },
    {
      done: true,
      title: 'Your turn',
      text: 'Enter a number and watch the dashboard change, or set the board up for your plant.',
      note: 'Anything you enter saves on this device only. Reopen this tour anytime from How it works.',
      tryLabel: 'Try Enter numbers',
      setupLabel: 'Set up your plant',
      link: { href: pageHref(month, day, { view: 'dor' }), text: 'See the Daily Operating Review board →', kind: 'dor' },
    },
  ];
}

/** "Off-goal cells turn red", worded for this device's Customize choices. */
function offGoalPhrase() {
  const s = getSettings();
  const color = s.off === 'custom' ? 'your off-goal color' : derive(s).off.name.toLowerCase();
  if (s.place === 'row') return `A department's whole row turns ${color} when its day is off goal.`;
  if (s.place === 'words') return `Off-goal words turn ${color}.`;
  return `Off-goal cells turn ${color}.`;
}

/** The row the tour explains: the first function off goal that day, else the first; null when Board setup removed them all. */
function tourRow(month, day) {
  const fn = month.functions.find((f) => dayStatus(month, f, day).status === OFF) ?? month.functions[0];
  return fn ? `#fn-${CSS.escape(fn.id)}` : null;
}

/** Where the second cell sits from the first: "next to it" or "below it" (on a phone when it can't be measured). */
function besideOrBelow(a, b) {
  if (a && b) {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return rb.top >= ra.bottom - 2 ? 'below it' : 'next to it';
  }
  return isPhone() ? 'below it' : 'next to it';
}

/** The column names as the board shows them ("Fri, Feb 27" or "Yesterday"; "February so far"). */
const headText = (sel, fallback) => document.querySelector(sel)?.textContent.trim() || fallback;

/** The DOR board v2 tour (the client's layout): one row per KPI, grouped by function. */
function boardV2Steps(month, day) {
  const row = tourRow(month, day);
  return [
    {
      title: 'Welcome',
      text: 'This is your Daily Operating Review board. Every function, its owner and its KPIs, in meeting order. Every goal connected, every KPI driven by KPAs, every action accountable.',
    },
    { target: ['[data-summary-lead]'], title: 'The summary', text: "One sentence says how many functions hit their goal, which ones didn't, and which misses still need an action. Pick another day from the date at the top." },
    ...(row ? [{
      target: [`${row} .kpirow`, row],
      title: 'One row per KPI',
      text: `Each KPI shows its goal, the day's status and the month so far. Status is worked out from the number and its goal, never typed, so a miss can't show green. ${act(true)} any KPI for its trend and the KPAs, the daily activities, that drive it.`,
    },
    {
      // Both cells in one spotlight.
      target: [`${row} .v2cell--trend`, row],
      with: [`${row} .v2cell--ytd`],
      title: 'Daily trend and year to date',
      text: 'Every day this month against the daily goal, and every month this year against the monthly goal.',
    },
    {
      target: [`${row} .v2cell--issue`, row],
      with: [`${row} .v2cell--action`],
      title: 'Issue and action',
      // "next to it" in the full table, "below it" where the row stacks (phones, tablets).
      text: ([issue, action]) => `Issue says what's keeping the KPI from its goal. Action, ${besideOrBelow(issue, action)}, says what's being done in the next 24 hours. A KPI that's off goal with no action says Needs an action, until someone adds one.`,
    }] : []),
    {
      target: ['.topbar [data-enter]', '.mobile-bar [data-enter]'],
      title: 'Enter numbers',
      text: `Owners ${act()} Enter numbers, pick their name and type the day's numbers. The board updates right away.`,
    },
    {
      target: ['.topbar [data-run-meeting]'],
      // A phone has no Run meeting button in its bar: it's in the Menu.
      fallback: '[data-topbar-more]',
      fallbackNote: "It's in the Menu, top right.",
      title: 'Run meeting',
      text: 'One function at a time on the TV for the morning meeting. Record it, add actions as they come up, and the minutes are saved when it ends.',
    },
    {
      target: ['.topbar [data-open-actions]'],
      fallback: '[data-topbar-more]',
      fallbackNote: "It's in the Menu, top right.",
      title: 'Action register',
      text: 'Every corrective action in one place, with its owner, due date and status, including the ones added during meetings.',
    },
    {
      target: ['.summary [data-open-setup]'],
      fallback: '[data-topbar-more]',
      fallbackNote: "It's in the Menu, top right.",
      title: 'Board setup',
      text: 'Rename the plant, add or remove functions, change owners, and add KPIs with their goals and units. No developer needed.',
    },
    {
      done: true,
      title: 'Your turn',
      text: 'Enter a number and watch the status change, or set the board up for your plant.',
      note: 'Anything you enter saves on this device only. Reopen this tour anytime from Take the tour.',
      tryLabel: 'Try Enter numbers',
      setupLabel: 'Set up your plant',
      link: { href: pageHref(month, day, { view: 'home' }), text: 'See the new dashboard →', kind: 'home' },
    },
  ];
}

function dorSteps(month, day) {
  if (document.documentElement.dataset.layout === 'v2') return boardV2Steps(month, day);
  const row = tourRow(month, day);
  const dayCol = headText('[data-head-day]', 'day');
  const monthCol = headText('[data-head-month]', 'month so far');
  return [
    {
      title: 'Welcome',
      text: 'This is the classic view of your DOR board: one row per function, in meeting order, like the printed board.',
    },
    { target: ['[data-summary-lead]'], title: 'The summary', text: 'One sentence says how many functions hit their goal and which ones need talking about.' },
    { target: ['.datebar'], title: 'Pick a day', text: 'Step through production days and the whole board follows.' },
    // With every function removed in Board setup there's no row to show: those steps are left out.
    ...(row ? [{
      target: [row],
      title: 'One row per function',
      text: `Each row has the function, its owner and its daily question. The ${dayCol} column is the day's number against goal; ${monthCol} is the month. ${offGoalPhrase()}`,
    },
    {
      target: [`${row} .cell--trend`],
      fallback: row,
      fallbackNote: 'The trend column is turned off in Customize.',
      title: 'Trend',
      text: 'Every day this month against the goal.',
    },
    {
      target: [`${row} .cell--notes`],
      fallback: row,
      fallbackNote: 'This column is turned off in Customize.',
      title: 'Issue and action',
      text: "What went wrong and what's being done about it before tomorrow's meeting.",
    }] : []),
    {
      target: ['.topbar [data-enter]', '.mobile-bar [data-enter]'],
      title: 'Enter numbers',
      text: `Owners ${act()} Enter numbers, pick their name and type the numbers. The board updates right away.`,
    },
    {
      target: ['.topbar [data-run-meeting]'],
      fallback: '[data-topbar-more]',
      fallbackNote: "It's in the Menu, top right.",
      title: 'Run meeting',
      text: 'Shows one function at a time on the TV for the morning meeting. Arrow keys or a clicker move through it.',
    },
    {
      target: ['.topbar [data-customize]'],
      fallback: '[data-topbar-more]',
      fallbackNote: 'On a phone it\'s in the Menu, top right.',
      title: 'Customize',
      text: 'Make the board yours: change the colors, where the red shows, and which columns appear.',
    },
    {
      done: true,
      title: "That's it",
      text: 'Reopen this tour anytime from Take the tour.',
      note: 'In this demo, anything you enter saves on this device only.',
      tryLabel: 'Try Enter numbers',
      link: { href: pageHref(month, day, { view: 'home' }), text: 'See the new dashboard →', kind: 'home' },
    },
  ];
}

/* ---------- Engine ---------- */

let tour = null; // { kind, steps, i, block, spot, card, live, returnTo, inerted, onEnd, raf }

export const isTourOpen = () => Boolean(tour);

function visible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  return getComputedStyle(el).visibility !== 'hidden';
}

/**
 * The element a step points at now, any cells shown with it (`with`: one
 * spotlight around them all), and any note about where it went.
 */
function resolve(step) {
  for (const sel of step.target ?? []) {
    const el = [...document.querySelectorAll(sel)].find(visible);
    if (el) {
      // The extra cells only join their own row's cell (not the whole-row fallback).
      const also = sel === step.target[0]
        ? (step.with ?? []).map((w) => [...document.querySelectorAll(w)].find(visible)).filter(Boolean)
        : [];
      return { el, also, note: '' };
    }
  }
  if (step.fallback) {
    const el = [...document.querySelectorAll(step.fallback)].find(visible);
    if (el) return { el, also: [], note: step.fallbackNote ?? '' };
  }
  return { el: null, also: [], note: step.target ? (step.phoneNote ?? '') : '' };
}

/** A step's words: some depend on the layout (where one cell sits from the other). */
const stepText = (step, els) => (typeof step.text === 'function' ? step.text(els) : step.text);

/** One box around every element in the spotlight. */
function unionRect(els) {
  const rects = els.map((el) => el.getBoundingClientRect());
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** Mark what's in the spotlight (checks read it; nothing styles it). */
function markTargets(t, el, also) {
  for (const n of t.targets ?? []) n.removeAttribute('data-tour-target');
  t.target = el;
  t.targets = el ? [el, ...also] : [];
  for (const n of t.targets) n.setAttribute('data-tour-target', '');
}

export function startTour(kind, { month, day, onEnd, onTry } = {}) {
  if (tour) endTour('restart');
  const steps = kind === 'dor' ? dorSteps(month, day) : homeSteps(month, day);
  const block = document.createElement('div');
  block.className = 'tour-block';
  const spot = document.createElement('div');
  spot.className = 'tour-spot';
  spot.setAttribute('aria-hidden', 'true');
  const card = document.createElement('div');
  card.className = 'tour-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'tour-title');
  card.setAttribute('aria-describedby', 'tour-text');
  const live = document.createElement('p');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  document.body.append(block, spot, card, live);

  // The page behind is out of reach while the tour is open.
  const inerted = [...document.querySelectorAll('.home-app, .app')].filter((el) => !el.inert);
  inerted.forEach((el) => { el.inert = true; });

  tour = { kind, steps, i: 0, block, spot, card, live, returnTo: document.activeElement, inerted, onEnd, onTry, raf: 0 };
  document.documentElement.classList.add('is-touring');
  card.addEventListener('click', onCardClick);
  // Keys are heard on the document: the card's buttons are rebuilt on every step.
  document.addEventListener('keydown', onCardKey, true);
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onMove, { passive: true, capture: true });
  show(0, { focus: 'title' });
}

/**
 * Close the tour. how: 'done' | 'skipped' (both stop auto-start for good),
 * 'interrupted' (something else opened on top: not marked seen, focus left alone),
 * or 'restart'.
 */
export function endTour(how = 'skipped') {
  if (!tour) return;
  const t = tour;
  tour = null;
  if (how === 'done' || how === 'skipped') markSeen(t.kind, how);
  // Skip means no tours: the other view doesn't start its own. It greets once
  // instead (the done card's link does the same), saying where its tour is.
  const other = t.kind === 'dor' ? 'home' : 'dor';
  if (how === 'skipped' && !tourSeen(other)) {
    markSeen(other, 'arrived');
    try { sessionStorage.setItem(ARRIVAL_KEY, other); } catch { /* no greeting then */ }
  }
  window.removeEventListener('resize', onResize);
  window.removeEventListener('scroll', onMove, { capture: true });
  document.removeEventListener('keydown', onCardKey, true);
  cancelAnimationFrame(t.raf);
  t.inerted.forEach((el) => { el.inert = false; });
  for (const n of t.targets ?? []) n.removeAttribute('data-tour-target');
  t.block.remove(); t.spot.remove(); t.card.remove(); t.live.remove();
  document.documentElement.classList.remove('is-touring');
  if (how === 'restart' || how === 'interrupted') return;
  // On a phone the tour scrolled the page to each part: the page goes back to its top
  // (the home tour would otherwise end mid-page at Issues and actions). Said again once focus has
  // settled: the home's own keep-clear scroll for a focused element (home.js) runs in the next frame,
  // and on the tall page itself (#home) it would leave the page part way down.
  const top = () => { if (isPhone()) window.scrollTo({ top: 0, behavior: 'instant' }); };
  top();
  const back = t.returnTo && t.returnTo !== document.body && t.returnTo.isConnected ? t.returnTo : document.querySelector(t.kind === 'dor' ? '#board' : '#home');
  back?.focus({ preventScroll: true });
  if (isPhone() && (back?.id === 'home' || back?.id === 'board')) requestAnimationFrame(() => requestAnimationFrame(top));
  t.onEnd?.(how);
}

function cardMarkup(step, i, n, note, text) {
  const last = i === n - 1;
  return `
    <p class="tour-count">${i + 1} of ${n}</p>
    <h2 class="tour-title" id="tour-title" tabindex="-1">${esc(step.title)}</h2>
    <p class="tour-text" id="tour-text">${esc(text)}${note ? ` <span class="tour-where">${esc(note)}</span>` : ''}</p>
    ${step.note ? `<p class="tour-note">${esc(step.note)}</p>` : ''}
    ${last ? `<div class="tour-cta">
      <button class="btn btn--primary" type="button" data-tour-try>${esc(step.tryLabel)}</button>
      ${step.setupLabel ? `<button class="btn btn--secondary" type="button" data-tour-setup>${esc(step.setupLabel)}</button>` : ''}
    </div>` : ''}
    <div class="tour-actions">
      <button class="btn btn--text tour-skip" type="button" ${last ? 'data-tour-close>Close' : 'data-tour-skip>Skip tour'}</button>
      <span class="tour-gap"></span>
      ${i > 0 ? '<button class="btn btn--quiet" type="button" data-tour-back>Back</button>' : ''}
      ${last ? '' : `<button class="btn btn--primary" type="button" data-tour-next>${i === 0 ? 'Start' : 'Next'}</button>`}
    </div>
    ${step.link ? `<p class="tour-link-row"><a class="tour-link" href="${esc(step.link.href)}" data-tour-link data-kind="${step.link.kind}">${esc(step.link.text)}</a></p>` : ''}`;
}

function show(i, { focus = 'next' } = {}) {
  const t = tour;
  t.i = i;
  const step = t.steps[i];
  const { el, also, note } = resolve(step);
  // The target is marked while it's in the spotlight (checks read it; nothing styles it).
  markTargets(t, el, also);
  const text = stepText(step, t.targets);
  t.card.innerHTML = cardMarkup(step, i, t.steps.length, note, text);
  t.card.dataset.step = String(i + 1);
  t.card.classList.toggle('is-centered', !el);
  t.live.textContent = `Step ${i + 1} of ${t.steps.length}. ${step.title}. ${text}${note ? ` ${note}` : ''}`;
  place(); // lays the card out first, so its real height decides the scroll
  if (el) bringIntoView(t.targets, t.card.offsetHeight);
  // A card with nothing to point at (welcome, the last card) dims the page from its top, so the
  // navy header isn't left cut off where an earlier step scrolled to (a phone's last card).
  else window.scrollTo({ top: 0, behavior: 'instant' });
  place();
  // Focus never falls out of the card when its buttons are rebuilt.
  const want = focus === 'title' ? t.card.querySelector('#tour-title')
    : t.card.querySelector(focus === 'back' && i > 0 ? '[data-tour-back]' : '[data-tour-next], [data-tour-try]');
  want?.focus({ preventScroll: true });
  requestAnimationFrame(place);
}

/** Scroll the spotlight into view: above the phone sheet, or near the middle on a desk. */
function bringIntoView(els, cardHeight) {
  const el = els[0];
  const r = unionRect(els);
  const fixed = isFixed(el);
  if (fixed) return;
  const vh = window.innerHeight;
  if (isPhone()) {
    const topSafe = stickyTop() + 12;
    const room = vh - cardHeight - topSafe - 12;
    const y = window.scrollY + r.top - topSafe - (r.height < room ? (room - r.height) / 2 : 0);
    window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
    return;
  }
  const fits = r.height < vh * 0.7;
  if (r.top >= 12 && r.bottom <= vh - 12) return;
  const y = window.scrollY + r.top - (fits ? (vh - r.height) / 2 : 80);
  window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
}

function isFixed(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const p = getComputedStyle(n).position;
    if (p === 'fixed') return true;
    if (p === 'sticky' && n.matches('.h-mobilebar, .side')) return true;
  }
  return false;
}

/** Height of a bar stuck to the top of the page on a phone (the home's top bar). */
function stickyTop() {
  const side = document.querySelector('[data-view="home"] .side');
  if (side && getComputedStyle(side).position === 'sticky') return side.getBoundingClientRect().height;
  return 0;
}

function onMove() {
  if (!tour) return;
  cancelAnimationFrame(tour.raf);
  tour.raf = requestAnimationFrame(place);
}

/** A resize can move the target under the phone card: measure again, scroll, re-place. */
function onResize() {
  if (!tour) return;
  cancelAnimationFrame(tour.raf);
  tour.raf = requestAnimationFrame(() => {
    if (!tour) return;
    const step = tour.steps[tour.i];
    const { el, also } = resolve(step);
    if (el !== tour.target || also.length !== tour.targets.length - 1 || also.some((n, j) => n !== tour.targets[j + 1])) {
      markTargets(tour, el, also);
      tour.card.classList.toggle('is-centered', !el);
    }
    // Words that depend on the layout follow it ("next to it" becomes "below it").
    if (typeof step.text === 'function') {
      const p = tour.card.querySelector('#tour-text');
      const text = stepText(step, tour.targets);
      if (p && p.firstChild?.nodeType === Node.TEXT_NODE && p.firstChild.textContent !== text) p.firstChild.textContent = text;
    }
    place();
    if (tour.target) bringIntoView(tour.targets, tour.card.offsetHeight);
    place();
  });
}

/** Put the cut-out over the target and the card beside it (or docked, on a phone). */
function place() {
  const t = tour;
  if (!t) return;
  const { spot, card } = t;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const el = t.target && t.target.isConnected ? t.target : null;
  const els = el ? t.targets.filter((n) => n.isConnected) : [];
  const phone = isPhone();
  card.classList.toggle('is-sheet', phone);
  card.classList.remove('is-top');
  card.style.removeProperty('left');
  card.style.removeProperty('top');

  if (!el) {
    spot.classList.add('is-none');
    spot.removeAttribute('style');
    if (!phone) {
      card.style.left = `${Math.round((vw - card.offsetWidth) / 2)}px`;
      card.style.top = `${Math.round(Math.max(16, (vh - card.offsetHeight) / 2))}px`;
    }
    return;
  }
  spot.classList.remove('is-none');
  const r = unionRect(els);
  const box = {
    left: Math.max(4, r.left - PAD),
    top: Math.max(4, r.top - PAD),
    right: Math.min(vw - 4, r.right + PAD),
    bottom: Math.min(vh - 4, r.bottom + PAD),
  };
  spot.style.left = `${box.left}px`;
  spot.style.top = `${box.top}px`;
  spot.style.width = `${Math.max(0, box.right - box.left)}px`;
  spot.style.height = `${Math.max(0, box.bottom - box.top)}px`;

  if (phone) {
    // Docked at the bottom, unless the target is pinned down there (a fixed bottom bar).
    if (isFixed(el) && r.bottom > vh - card.offsetHeight - 8) card.classList.add('is-top');
    return;
  }
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const gap = 14;
  const clampX = (x) => Math.min(Math.max(16, x), vw - cw - 16);
  const clampY = (y) => Math.min(Math.max(16, y), vh - ch - 16);
  let left;
  let top;
  if (vh - box.bottom >= ch + gap + 16) { top = box.bottom + gap; left = box.left; }
  else if (box.top >= ch + gap + 16) { top = box.top - gap - ch; left = box.left; }
  else if (vw - box.right >= cw + gap + 16) { left = box.right + gap; top = box.top; }
  else if (box.left >= cw + gap + 16) { left = box.left - gap - cw; top = box.top; }
  else if (box.right - box.left > vw * 0.6 && t.steps[t.i]?.side === 'left') {
    // No room around a wide cut-out: the card sits over its side whose key columns it doesn't hide
    // (the grid's dots and the issues' Status are on the right, so the card goes bottom left).
    left = 16; top = vh - ch - 24;
  } else { left = vw - cw - 24; top = vh - ch - 24; } // a target as big as the screen: the card sits in its corner
  // Whatever the branch, the card stays fully on screen.
  card.style.left = `${Math.round(clampX(left))}px`;
  card.style.top = `${Math.round(clampY(top))}px`;
}

function onCardClick(e) {
  if (!tour) return;
  if (e.target.closest('[data-tour-skip]')) { endTour('skipped'); return; }
  if (e.target.closest('[data-tour-close]')) { endTour('done'); return; }
  if (e.target.closest('[data-tour-setup]')) {
    endTour('done');
    document.querySelector('.summary [data-open-setup], [data-open-setup]')?.click();
    return;
  }
  if (e.target.closest('[data-tour-try]')) {
    const onTry = tour.onTry;
    endTour('done');
    onTry?.();
    return;
  }
  if (e.target.closest('[data-tour-back]')) { if (tour.i > 0) show(tour.i - 1, { focus: 'back' }); return; }
  if (e.target.closest('[data-tour-next]')) {
    if (tour.i < tour.steps.length - 1) show(tour.i + 1); else endTour('done');
    return;
  }
  const link = e.target.closest('[data-tour-link]');
  if (link) {
    // Both tours count as seen: the other view greets with one toast, not a second tour.
    markSeen(tour.kind, 'done');
    markSeen(link.dataset.kind, 'arrived');
    try { sessionStorage.setItem(ARRIVAL_KEY, link.dataset.kind); } catch { /* no greeting then */ }
  }
}

function onCardKey(e) {
  if (!tour) return;
  // Only keys meant for the card: anything else (a dialog on top) handles its own.
  if (!tour.card.contains(e.target)) return;
  if (e.key === 'Escape') { e.preventDefault(); endTour('skipped'); return; }
  if (e.key === 'ArrowRight' && !e.target.matches('a')) {
    e.preventDefault();
    if (tour.i < tour.steps.length - 1) show(tour.i + 1);
    return;
  }
  if (e.key === 'ArrowLeft' && !e.target.matches('a')) {
    e.preventDefault();
    if (tour.i > 0) show(tour.i - 1, { focus: 'back' });
    return;
  }
  if (e.key === 'Tab') {
    // Keep focus inside the card while it's open.
    const f = [...tour.card.querySelectorAll('button, a[href], [tabindex="-1"]')].filter((n) => !n.disabled);
    const items = f.filter((n) => n.tabIndex >= 0);
    if (!items.length) return;
    const first = items[0];
    const lastItem = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !items.includes(document.activeElement))) { e.preventDefault(); lastItem.focus(); }
    else if (!e.shiftKey && document.activeElement === lastItem) { e.preventDefault(); first.focus(); }
  }
}

