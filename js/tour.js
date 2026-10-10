// Onboarding tours, one for each view. A hand-built spotlight: the page dims,
// a clear cut-out frames the part being explained, and a card beside it says
// what it is. On a phone the card is a bottom sheet and the part scrolls into
// view above it. Keyboard: focus moves into the card, ← → step, Esc skips, and
// focus goes back where it was afterwards.

import { pageHref } from './shell.js';
import { esc } from './ui.js';
import { getSettings, derive } from './customize.js';
import { dayStatus, OFF } from './status.js';

const FLAG = { home: 'dor.tour.home.v1', dor: 'dor.tour.dor.v1' };
export const ARRIVAL_KEY = 'dor.tour.arrival';
const PAD = 6; // cut-out padding around the target
const isPhone = () => matchMedia('(max-width: 599px)').matches;
/** "Tap" on touch screens, "Click" with a mouse. */
const act = (capital = false) => {
  const w = matchMedia('(hover: none)').matches ? 'tap' : 'click';
  return capital ? w[0].toUpperCase() + w.slice(1) : w;
};

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
      text: "This is your plant's Daily Operating Review. Each morning every department enters its numbers and the board works out what's on track. Here's a one-minute tour.",
    },
    { target: ['[data-home-summary]'], title: 'The one-line answer', text: "Start here. One line says how many departments hit their goal and which didn't." },
    { target: ['.h-date'], title: 'Pick a day', text: 'Pick any production day and the whole dashboard follows.' },
    {
      target: ['.h-kpis'],
      title: 'Key numbers',
      text: `Each card shows the result and its goal. Red means it missed. For things like scrap or injuries, above goal is a miss. ${act(true)} one for that department's detail.`,
    },
    {
      target: ['.panel--matrix'],
      title: 'Every department by area',
      text: 'Green dot = on track. Red dot with ! = off goal. Gray ring = not entered yet.',
    },
    {
      target: ['.panel--issues'],
      title: 'Issues and actions',
      text: "What went wrong and what's being done in the next 24 hours, with each problem's status.",
    },
    {
      target: ['.h-actions [data-enter]', '.h-mobilebar [data-enter]'],
      title: 'Update Daily',
      text: `Owners ${act()} Update Daily, pick their name and type the numbers. It takes under two minutes on a phone and the board updates right away.`,
    },
    {
      target: ['.side [data-run-meeting]'],
      fallback: '.side-menu-btn',
      fallbackNote: 'On a phone it\'s in the menu, top right.',
      title: 'Meeting mode',
      text: 'Running the morning meeting? Meeting mode shows one department at a time on the TV. Arrow keys or a clicker move through it.',
    },
    {
      done: true,
      title: "That's it",
      text: 'Reopen this tour anytime from How it works.',
      note: 'In this preview, anything you enter saves on this device only.',
      tryLabel: 'Try Update Daily',
      link: { href: pageHref(month, day, { view: 'dor' }), text: 'See the classic board →', kind: 'dor' },
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

/** The row the classic tour explains: the first department off goal that day, else the first. */
function tourRow(month, day) {
  const fn = month.functions.find((f) => dayStatus(month, f, day).status === OFF) ?? month.functions[0];
  return `#fn-${fn.id}`;
}

/** The column names as the board shows them ("Fri, Feb 27" or "Yesterday"; "February so far"). */
const headText = (sel, fallback) => document.querySelector(sel)?.textContent.trim() || fallback;

function dorSteps(month, day) {
  const row = tourRow(month, day);
  const dayCol = headText('[data-head-day]', 'day');
  const monthCol = headText('[data-head-month]', 'month so far');
  return [
    {
      title: 'Welcome',
      text: 'This is the classic view of your DOR board: one row per department, in meeting order, like the printed board.',
    },
    { target: ['[data-summary-lead]'], title: 'The summary', text: 'One sentence says how many departments hit their goal and which ones need talking about.' },
    { target: ['.datebar'], title: 'Pick a day', text: 'Step through production days and the whole board follows.' },
    {
      target: [row],
      title: 'One row per department',
      text: `Each row has the department, its owner and its daily question. The ${dayCol} column is the day's number against goal; ${monthCol} is the month. ${offGoalPhrase()}`,
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
      title: 'Problem → Next 24 hours',
      text: "What went wrong and what's being done about it before tomorrow's meeting.",
    },
    {
      target: ['.topbar [data-enter]', '.mobile-bar [data-enter]'],
      title: 'Enter numbers',
      text: `Owners ${act()} Enter numbers, pick their name and type the numbers. The board updates right away.`,
    },
    {
      target: ['.topbar [data-run-meeting]'],
      phoneNote: 'Run meeting is on the computer or TV view of this board.',
      title: 'Run meeting',
      text: 'Shows one department at a time on the TV for the morning meeting. Arrow keys or a clicker move through it.',
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
      note: 'In this preview, anything you enter saves on this device only.',
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

/** The element a step points at now, plus any note about where it went. */
function resolve(step) {
  for (const sel of step.target ?? []) {
    const el = [...document.querySelectorAll(sel)].find(visible);
    if (el) return { el, note: '' };
  }
  if (step.fallback) {
    const el = [...document.querySelectorAll(step.fallback)].find(visible);
    if (el) return { el, note: step.fallbackNote ?? '' };
  }
  return { el: null, note: step.target ? (step.phoneNote ?? '') : '' };
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
  window.removeEventListener('resize', onResize);
  window.removeEventListener('scroll', onMove, { capture: true });
  document.removeEventListener('keydown', onCardKey, true);
  cancelAnimationFrame(t.raf);
  t.inerted.forEach((el) => { el.inert = false; });
  t.target?.removeAttribute('data-tour-target');
  t.block.remove(); t.spot.remove(); t.card.remove(); t.live.remove();
  document.documentElement.classList.remove('is-touring');
  if (how === 'restart' || how === 'interrupted') return;
  const back = t.returnTo && t.returnTo !== document.body && t.returnTo.isConnected ? t.returnTo : document.querySelector(t.kind === 'dor' ? '#board' : '#home');
  back?.focus({ preventScroll: true });
  t.onEnd?.(how);
}

function cardMarkup(step, i, n, note) {
  const last = i === n - 1;
  return `
    <p class="tour-count">${i + 1} of ${n}</p>
    <h2 class="tour-title" id="tour-title" tabindex="-1">${esc(step.title)}</h2>
    <p class="tour-text" id="tour-text">${esc(step.text)}${note ? ` <span class="tour-where">${esc(note)}</span>` : ''}</p>
    ${step.note ? `<p class="tour-note">${esc(step.note)}</p>` : ''}
    <div class="tour-actions">
      <button class="btn btn--text tour-skip" type="button" ${last ? 'data-tour-close>Close' : 'data-tour-skip>Skip tour'}</button>
      <span class="tour-gap"></span>
      ${i > 0 ? '<button class="btn btn--quiet" type="button" data-tour-back>Back</button>' : ''}
      ${last
    ? `<button class="btn btn--primary" type="button" data-tour-try>${esc(step.tryLabel)}</button>`
    : `<button class="btn btn--primary" type="button" data-tour-next>${i === 0 ? 'Start' : 'Next'}</button>`}
    </div>
    ${step.link ? `<p class="tour-link-row"><a class="tour-link" href="${esc(step.link.href)}" data-tour-link data-kind="${step.link.kind}">${esc(step.link.text)}</a></p>` : ''}`;
}

function show(i, { focus = 'next' } = {}) {
  const t = tour;
  t.i = i;
  const step = t.steps[i];
  const { el, note } = resolve(step);
  // The target is marked while it's in the spotlight (checks read it; nothing styles it).
  t.target?.removeAttribute('data-tour-target');
  t.target = el;
  el?.setAttribute('data-tour-target', '');
  t.card.innerHTML = cardMarkup(step, i, t.steps.length, note);
  t.card.dataset.step = String(i + 1);
  t.card.classList.toggle('is-centered', !el);
  t.live.textContent = `Step ${i + 1} of ${t.steps.length}. ${step.title}. ${step.text}${note ? ` ${note}` : ''}`;
  place(); // lays the card out first, so its real height decides the scroll
  if (el) bringIntoView(el, t.card.offsetHeight);
  place();
  // Focus never falls out of the card when its buttons are rebuilt.
  const want = focus === 'title' ? t.card.querySelector('#tour-title')
    : t.card.querySelector(focus === 'back' && i > 0 ? '[data-tour-back]' : '[data-tour-next], [data-tour-try]');
  want?.focus({ preventScroll: true });
  requestAnimationFrame(place);
}

/** Scroll the target into view: above the phone sheet, or near the middle on a desk. */
function bringIntoView(el, cardHeight) {
  const r = el.getBoundingClientRect();
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
    const { el } = resolve(step);
    if (el !== tour.target) {
      tour.target?.removeAttribute('data-tour-target');
      tour.target = el;
      el?.setAttribute('data-tour-target', '');
      tour.card.classList.toggle('is-centered', !el);
    }
    place();
    if (tour.target) bringIntoView(tour.target, tour.card.offsetHeight);
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
  const r = el.getBoundingClientRect();
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
  else { left = vw - cw - 24; top = vh - ch - 24; } // a target as big as the screen: the card sits in its corner
  // Whatever the branch, the card stays fully on screen.
  card.style.left = `${Math.round(clampX(left))}px`;
  card.style.top = `${Math.round(clampY(top))}px`;
}

function onCardClick(e) {
  if (!tour) return;
  if (e.target.closest('[data-tour-skip]')) { endTour('skipped'); return; }
  if (e.target.closest('[data-tour-close]')) { endTour('done'); return; }
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

