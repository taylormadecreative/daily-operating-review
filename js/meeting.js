// Meeting mode (TV): dark, full screen, one function per slide.
// Slide 0 is the summary and roadmap; slides 1-8 walk the board in order.
// Keys: arrows, PageUp/PageDown (presenter clickers), Space, Home/End, Esc.
// The recorder (js/recorder.js) adds Record, live captions, Add action and the
// minutes; this file tells it when a meeting opens and closes. Each function
// slide says what its KPIs' actions are in the board's words (actionStateFor):
// the workbook's action and that day's Action register actions, "Needs an
// action" in red for a miss nobody has picked up, or the quiet word. The last
// slide's Next is End meeting: it saves the minutes and opens them.

import { dailySeries, kpiRowsFor, notesFor, hasProblem, isoForDay } from './store.js?v=20261013-151156';
import { dayStatus, monthStatus, boardSummary, isProductionDay, compareToGoal, ON, OFF, NO_PRODUCTION, NOT_TRACKED } from './status.js?v=20261013-151156';
import {
  formatPair, plainLabel, formatDayLong, formatDayMedium, formatMonthName, formatMonthShort,
  monthSoFar, dayHeading, weekday,
} from './format.js?v=20261013-151156';
import { notesText, recordText, actionStateFor, needsSummary, ACTION_WORD, clampedNote, issueGap, ISSUE_GAP_WORD } from './board.js?v=20261013-151156';
import { esc, statusMarkup, issueStatusMarkup, glyphMarkup } from './ui.js?v=20261013-151156';
import { barChart } from './charts.js?v=20261013-151156';
import {
  connectMeeting, startMeetingSession, updateMeetingSession, endMeetingSession,
  recorderReady, recorderHoldsEscape, addActionIcon, currentMeetingId, meetingDraftFor, draftWords, addTargetName,
} from './recorder.js?v=20261013-151156';
import { actionDayText } from './actions.js?v=20261013-151156';
import { dismissAll } from './toast.js?v=20261013-151156';

/** Clear any message showing, without moving focus (the meeting decides where it goes). */
const dismissToast = () => dismissAll({ refocus: false });

const START_KEY = 'dor.meetingStartedAt';

let root;
let stage;
let handlers;
let month;
let day;
let slide = 0;
let open = false;
let wentFullscreen = false;
let timerId = null;
let chart = null;
let endWithMinutes = false; // End meeting (the last slide) opens the minutes once they're saved
let openedAt = -Infinity;   // when the meeting opened (Exit ignores the click that opened it)
const EXIT_GRACE_MS = 400;

export function initMeeting(h) {
  handlers = h;
  root = document.getElementById('meeting');
  stage = root.querySelector('[data-stage]');
  // Previous on the first slide stays focusable but does nothing (aria-disabled).
  root.querySelector('[data-prev-slide]').addEventListener('click', (e) => {
    if (e.currentTarget.getAttribute('aria-disabled') === 'true') return;
    go(slide - 1);
  });
  // Next on the last slide is End meeting.
  root.querySelector('[data-next-slide]').addEventListener('click', () => {
    if (month && slide >= month.functions.length) endMeeting();
    else go(slide + 1);
  });
  // A double click on Run meeting lands its second click here: Exit waits until the meeting has been open 400ms.
  root.querySelector('[data-exit]').addEventListener('click', (e) => {
    if (e.detail && performance.now() - openedAt < EXIT_GRACE_MS) return;
    handlers.onExit(currentFnId());
  });
  document.addEventListener('keydown', onKey);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && open && wentFullscreen) {
      wentFullscreen = false;
      // Esc while typing an action only leaves full screen; the meeting goes on.
      if (recorderHoldsEscape()) return;
      handlers.onExit(currentFnId()); // Esc in full screen lands here
    }
  });
  // Live captions take room under the slide: re-fit it without the slide fade.
  connectMeeting({ relayout: () => { if (open) render({ animate: false }); } });
}

export const isMeetingOpen = () => open;
export const currentFnId = () => (slide > 0 ? month?.functions[slide - 1]?.id ?? null : null);

/** Must be called from the Run meeting click so the browser allows it. */
export function requestFullscreen() {
  const el = document.documentElement;
  if (!el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => { wentFullscreen = true; })
    .catch(() => { wentFullscreen = false; }); // not allowed: the overlay still fills the window
}

export function openMeeting(m, d, s) {
  month = m;
  day = d;
  if (!open) {
    open = true;
    openedAt = performance.now();
    // A message from the board ("Saved…", "Added…") doesn't follow onto the TV.
    dismissToast();
    root.hidden = false;
    document.querySelectorAll('.app, .home-app').forEach((n) => { n.inert = true; });
    document.documentElement.classList.add('is-meeting');
    let started = null;
    try { started = Number(sessionStorage.getItem(START_KEY)); } catch { started = null; }
    if (!started) {
      started = Date.now();
      try { sessionStorage.setItem(START_KEY, String(started)); } catch { /* timer still runs */ }
    }
    tick(started);
    timerId = setInterval(() => tick(started), 1000);
    startMeetingSession(m, d, started);
  } else {
    updateMeetingSession(m, d);
  }
  go(Number.isInteger(s) ? s : 0, { replace: true, force: true });
  requestAnimationFrame(() => root.querySelector('[data-next-slide]')?.focus({ preventScroll: true }));
}

/** Leave browser full screen if we are in it. Resolves when the screen has settled. */
export function leaveFullscreen() {
  if (!document.fullscreenElement) return Promise.resolve();
  wentFullscreen = false;
  return document.exitFullscreen().catch(() => {});
}

/** End meeting: the same way out as Exit, then the minutes open over the board. */
function endMeeting() {
  endWithMinutes = true;
  handlers.onExit(currentFnId(), { ended: true });
}

export function closeMeeting() {
  if (!open) return;
  // A message from the meeting ("Allow the microphone…", "Action added…") doesn't follow
  // onto the board or the minutes. "Minutes saved" comes after this, from the recorder.
  dismissToast();
  // Stop recording and save the minutes before the screen goes (End meeting opens them).
  const openAfter = endWithMinutes;
  endWithMinutes = false;
  endMeetingSession({ openMinutes: openAfter });
  open = false;
  root.hidden = true;
  document.querySelectorAll('.app, .home-app').forEach((n) => { n.inert = false; });
  document.documentElement.classList.remove('is-meeting');
  clearInterval(timerId);
  chart?.destroy();
  chart = null;
  try { sessionStorage.removeItem(START_KEY); } catch { /* ignore */ }
  leaveFullscreen();
}

function tick(started) {
  const secs = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, '0');
  root.querySelector('[data-timer]').textContent = `${mm}:${ss}`;
}

function onKey(e) {
  if (!open) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  // A form on top of the meeting (Add action) owns the keys, keys pressed in
  // any other open dialog stay there, and typing never moves slides.
  if (root.querySelector('dialog[open]')) return;
  if (e.target.closest?.('dialog, input, textarea, select, [contenteditable]')) return;
  const onButton = e.target.closest?.('button, a');
  switch (e.key) {
    case 'ArrowRight': case 'ArrowDown': case 'PageDown':
      e.preventDefault(); go(slide + 1); break;
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
      e.preventDefault(); go(slide - 1); break;
    case ' ':
      if (onButton) return; // Space on a focused button presses that button
      e.preventDefault(); go(slide + (e.shiftKey ? -1 : 1)); break;
    case 'Home': e.preventDefault(); go(0); break;
    case 'End': e.preventDefault(); go(month.functions.length); break;
    case 'Escape':
      e.preventDefault(); handlers.onExit(currentFnId()); break;
    default:
  }
}

function go(n, { force = false } = {}) {
  const last = month.functions.length;
  const next = Math.max(0, Math.min(last, n));
  if (next === slide && !force) return;
  slide = next;
  render();
  handlers.onSlide(slide);
}

function render({ animate = true } = {}) {
  // Keep keyboard focus on the slide's Add action button through a re-render: the same one
  // (the slide's own, or the one beside that KPI's "Needs an action") while it still shows,
  // else the slide's first.
  const addEl = document.activeElement?.closest?.('[data-meeting-add]') ?? null;
  const focusedAdd = addEl?.dataset.meetingAdd ?? null;
  const focusedKpi = addEl?.dataset.meetingAddKpi ?? null; // null: the slide's own button
  // Focus on the slide (its Add action) is lost when the slide is redrawn: it goes to the new slide's.
  const focusInStage = stage.contains(document.activeElement);
  chart?.destroy();
  chart = null;
  const total = month.functions.length;
  const fn = slide > 0 ? month.functions[slide - 1] : null;
  // Every function removed in Board setup: one slide that says so, never "0 of 0".
  root.querySelector('[data-progress-text]').textContent = fn ? `${slide} of ${total}\u00a0·\u00a0${fn.name}`
    : total ? `Summary\u00a0·\u00a0${total} ${total === 1 ? 'function' : 'functions'}` : 'Summary';
  root.querySelector('[data-progress-fill]').style.transform = `scaleX(${total ? slide / total : 1})`;
  // With nothing to step through, the arrow-keys hint has nothing to say.
  const hint = root.querySelector('.meeting-hint');
  if (hint) hint.hidden = !total;
  const prev = root.querySelector('[data-prev-slide]');
  const next = root.querySelector('[data-next-slide]');
  // Previous on the first slide looks off and does nothing, but keeps its place
  // in the tab order (focus never drops to <body>).
  prev.disabled = false;
  if (slide === 0) prev.setAttribute('aria-disabled', 'true'); else prev.removeAttribute('aria-disabled');
  // The last slide's Next ends the meeting and opens its minutes.
  const last = slide === total;
  next.disabled = false;
  next.toggleAttribute('data-end', last);
  const nextLabel = next.querySelector('[data-next-label]');
  if (nextLabel) nextLabel.textContent = last ? 'End meeting' : 'Next';
  const nextIcon = next.querySelector('[data-next-icon]');
  nextIcon?.toggleAttribute('hidden', last); // an <svg>: the attribute, not .hidden
  stage.innerHTML = fn ? fnSlide(fn) : summarySlide();
  stage.dataset.slide = String(slide);
  // A short fade so the room sees the change; none with reduced motion.
  if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    stage.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  }
  // Added KPIs share the right column with the chart: fit them first, then draw the chart in the room left.
  if (fn) { fitExtras(); keepAddReachable(fn); mountChart(fn); fitSlide(); }
  if (focusedAdd) {
    const sel = `[data-meeting-add="${CSS.escape(focusedAdd)}"]`;
    const same = focusedKpi == null
      ? stage.querySelector(`${sel}:not([data-meeting-add-kpi])`)
      : stage.querySelector(`${sel}[data-meeting-add-kpi="${CSS.escape(focusedKpi)}"]`);
    const shownSame = same && !same.closest('[hidden]') ? same : null;
    (shownSame ?? [...stage.querySelectorAll(sel)].find((b) => !b.closest('[hidden]')))?.focus({ preventScroll: true });
  }
  // Changing slides never drops focus to <body>: the new slide's Add action, else Next.
  const a = document.activeElement;
  if (focusInStage || !a || a === document.body || !a.isConnected) {
    if (!stage.contains(document.activeElement)) {
      (firstShownAdd() ?? next)?.focus({ preventScroll: true });
    }
  }
}

/**
 * Fit the slide to the screen. A long name (Board setup allows 60 characters)
 * keeps to two lines from the start. Notes come next (fitNotes). When they
 * still don't fit (live captions, many actions, a long question), the display
 * type gets smaller, then the question keeps two lines, then the oldest
 * register actions give way to a "more in the Action register" line, and last
 * the issue keeps a single line. The action line and its Add action button
 * are the last to go.
 */
function fitSlide() {
  const art = stage.querySelector('.m-fn');
  if (!art) return;
  fitName(art);
  if (fitNotes()) return;
  art.classList.add('is-compact');
  fitName(art); // again, from the compact size
  if (fitNotes()) return;
  if (art.querySelector('.m-question')) {
    art.classList.add('is-tight');
    if (fitNotes()) return;
  }
  if (fitNotes({ hideActions: true })) return;
  fitNotes({ hideActions: true, floor: 1 });
}

/** Lines an element's text takes (its height over its line height). */
function linesOf(el) {
  const cs = getComputedStyle(el);
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
  return Math.round(el.getBoundingClientRect().height / lh);
}

/** Display sizes a long name steps down through (em of the slide), largest first. */
const NAME_STEPS = [3, 2.75, 2.5, 2.25, 2, 1.8, 1.6];

/**
 * The function's name takes two lines at most: a long one steps down from its
 * size until it fits in two, and only below the last step ends on an ellipsis
 * (the progress line over the slide still says it whole).
 */
function fitName(art) {
  const name = art.querySelector('.m-name');
  if (!name) return;
  name.style.fontSize = '';
  name.classList.remove('is-clamped');
  if (linesOf(name) <= 2) return;
  const base = parseFloat(getComputedStyle(name.parentElement).fontSize) || 1;
  const now = parseFloat(getComputedStyle(name).fontSize) / base;
  for (const em of NAME_STEPS.filter((e) => e < now - 0.01)) {
    name.style.fontSize = `${em}em`;
    if (linesOf(name) <= 2) return;
  }
  name.classList.add('is-clamped');
}

/**
 * KPIs added in Board setup sit under the chart, each with its issue and
 * action. The chart keeps its minimum height (its key, plot and caption).
 * A long KPI name (up to 80 characters) gets the list's full width over its
 * two columns instead of wrapping down a narrow one. When they still don't
 * all fit, measures give way to a "more on the board" line: the ones with
 * nothing to act on first, the ones that need an action last.
 */
function fitExtras() {
  const col = stage.querySelector('.m-col--right');
  const list = stage.querySelector('.m-extras');
  const extras = [...stage.querySelectorAll('.m-extra')];
  const more = stage.querySelector('[data-extra-more]');
  const head = stage.querySelector('.m-extra-head');
  if (!col || !list || !extras.length || !more) return;
  const fits = () => col.scrollHeight <= col.clientHeight + 1;
  extras.forEach((li) => { li.hidden = false; });
  more.hidden = true;
  if (head) head.hidden = false;
  list.classList.remove('is-stacked');
  if (extras.some((li) => linesOf(li.querySelector('.m-extra-name')) > 2)) list.classList.add('is-stacked');
  const needs = (li) => Boolean(li.querySelector('.m-extra-note--needs'));
  const order = [...extras.filter((li) => !needs(li)).reverse(), ...extras.filter(needs).reverse()];
  let hidden = 0;
  for (const li of order) {
    if (fits()) break;
    li.hidden = true;
    hidden += 1;
    more.textContent = `${hidden} more ${hidden === 1 ? 'measure' : 'measures'} on the board`;
    more.hidden = false;
  }
  // Every measure folded: no column heads over nothing.
  if (head) head.hidden = hidden === extras.length;
}

/** The slide's first Add action that shows (one folded away with its measure doesn't count). */
const firstShownAdd = () => [...stage.querySelectorAll('[data-meeting-add]')].find((b) => !b.closest('[hidden]')) ?? null;

/**
 * After the fold: when every Add action on the slide went with its measure, the
 * slide's own comes back at the top, so an action can always be added. A kept
 * draft's note whose button was folded away moves beside the first one shown.
 */
function keepAddReachable(fn) {
  if (!recorderReady()) return;
  if (!firstShownAdd()) {
    stage.querySelector('.m-head')?.insertAdjacentHTML('beforeend', `<div class="m-add-wrap">${addButton(fn, null)}</div>`);
  }
  const note = stage.querySelector('#m-draft');
  if (!note || !note.closest('[hidden]')) return;
  note.previousElementSibling?.removeAttribute('aria-describedby');
  note.remove();
  const b = firstShownAdd();
  if (!b) return;
  b.setAttribute('aria-describedby', 'm-draft');
  b.insertAdjacentHTML('afterend', `<p class="m-draft${b.hasAttribute('data-meeting-add-kpi') ? ' m-draft--beside' : ''}" id="m-draft">${esc(draftWords(fn, null))}</p>`);
}

/**
 * Give Issue and "Action, next 24 hours" as many lines as the screen allows,
 * then end on an ellipsis instead of cutting a line in half. The register's
 * actions are the room's newest news, so the notes give way first; then each
 * action shortens to 2 lines; then the oldest news gives way to a "more in the
 * Action register" line (this meeting's actions are the last to go).
 */
function fitNotes({ hideActions = false, floor = 2 } = {}) {
  const box = stage.querySelector('.m-notes');
  if (!box) return true;
  const problem = box.querySelector('.m-note-text--problem');
  const action = box.querySelector('.m-note-text--action');
  const items = [...box.querySelectorAll('.m-action')];
  const more = box.querySelector('[data-actions-more]');
  const fits = () => box.scrollHeight <= box.clientHeight + 1;
  let p = 8;
  let a = 5;
  const apply = () => { problem?.style.setProperty('--clamp', p); action?.style.setProperty('--clamp', a); };
  const clampItems = (n) => items.forEach((li) => li.querySelector('.m-action-text')?.style.setProperty('--clamp', n));
  items.forEach((li) => { li.hidden = false; });
  if (more) more.hidden = true;
  clampItems(3);
  apply();
  while (!fits() && ((problem && p > 3) || (action && a > 2))) {
    if (problem && p > 3 && (p > a + 1 || !action || a <= 2)) p -= 1; else a -= 1;
    apply();
  }
  if (fits()) return true;
  if (!items.length) {
    // Last resort: the issue keeps its first two lines (one, at the very last).
    while (hideActions && !fits() && problem && p > floor) { p -= 1; apply(); }
    return fits();
  }
  clampItems(2);
  if (fits() || !hideActions) return fits();
  const order = [
    ...items.filter((li) => !li.hasAttribute('data-this-meeting')).reverse(),
    ...items.filter((li) => li.hasAttribute('data-this-meeting')).reverse(),
  ];
  for (let hidden = 1; hidden < items.length; hidden += 1) {
    order[hidden - 1].hidden = true;
    if (more) {
      more.textContent = `${hidden} more ${hidden === 1 ? 'action' : 'actions'} in the Action register`;
      more.hidden = false;
    }
    if (fits()) return true;
  }
  while (!fits() && problem && p > floor) { p -= 1; apply(); }
  return fits();
}

/**
 * What still needs an action, under the headline: "2 off-goal KPIs have no
 * action yet: People, Operations." with the off glyph, or the all-clear with
 * the on-track glyph. Nothing when nothing is off goal.
 */
function needsLine() {
  let sum;
  try { sum = needsSummary(month, day); } catch { return ''; }
  if (sum.list.length) {
    return `<p class="m-needs">${glyphMarkup(OFF)}<span><span class="m-needs-lead">${esc(sum.lead)}</span> ${esc(sum.list.map((x) => x.label).join(', '))}.</span></p>`;
  }
  if (sum.allClear) return `<p class="m-needs m-needs--clear">${glyphMarkup(ON)}<span class="m-needs-lead">${esc(sum.text)}</span></p>`;
  return '';
}

function summarySlide() {
  if (!month.functions.length) {
    return `
    <section class="m-summary" aria-labelledby="m-headline">
      <p class="m-date">${esc(formatDayLong(month, day))}</p>
      <h2 class="m-empty" id="m-headline">Every function is hidden. Put them back in Board setup.</h2>
    </section>`;
  }
  const s = boardSummary(month, day);
  const y = s.yesterday;
  const headline = s.productionDay === false ? 'No production scheduled' : `${y[ON]} of ${y.total} on track`;
  return `
    <section class="m-summary" aria-labelledby="m-headline">
      <p class="m-date">${esc(formatDayLong(month, day))}</p>
      <h2 class="m-headline${s.productionDay === false ? ' m-headline--words' : ''}" id="m-headline">${esc(headline)}</h2>
      ${needsLine()}
      <p class="m-sub">${esc(monthSoFar(month))}: ${s.monthStarted ? `${s.month[ON]} of ${s.month.total} on track` : 'no production yet'}</p>
      <ol class="m-grid">
        ${month.functions.map((f, i) => {
          // Same rule as the headline: off goal when any of the function's measures is.
          const offRow = kpiRowsFor(f).find((k) => dayStatus(month, k, day).status === OFF);
          const st = offRow ? OFF : dayStatus(month, f, day).status;
          const kpi = offRow ? offRow.kpiDaily : f.kpiDaily;
          return `<li class="m-tile" data-status="${st}">
              <span class="m-tile-num">${i + 1}</span>
              <span class="m-tile-name">${esc(f.name)}</span>
              ${statusMarkup(st, { tag: 'span', extra: 'm-tile-status', kpi })}
            </li>`;
        }).join('')}
      </ol>
    </section>`;
}

/** "Tracked from Fri, Feb 20" for a KPI added in Board setup, on a day before it was added ('' otherwise). */
function trackedFrom(k, s) {
  if (s.status !== NOT_TRACKED) return '';
  const start = (k.daily?.plant ?? []).find((r) => !r.beforeStart)?.day;
  // The date stays on one line.
  return start ? `Tracked from ${formatDayMedium(month, start).replace(/ /g, '\u00a0')}` : '';
}

function kpiBlock(label, s, kpi, measure, k = null) {
  const f = formatPair(s.actual, s.goal, kpi);
  const from = k ? trackedFrom(k, s) : '';
  return `<section class="m-kpi" data-status="${s.status}">
      <h3 class="m-kpi-label">${esc(label)}</h3>
      ${statusMarkup(s.status, { extra: 'm-status', kpi })}
      ${f.actual === null
        ? `<p class="m-num m-num--empty">${esc(from || f.rest)}</p>`
        : `<p class="m-num">${esc(f.actual)}</p>${f.rest ? `<p class="m-rest">${esc(f.rest)}</p>` : ''}`}
      <p class="m-measure">${esc(measure)}</p>
    </section>`;
}

/**
 * One extra measure's status and figure, in the day or month column. The column
 * heads over the list say which is which; the cell repeats it for screen readers.
 */
function extraCell(label, s, kpi, show, measureNote = '', k = null) {
  const f = formatPair(s.actual, s.goal, kpi);
  // Before the day it was added: when it starts, not "No goal set".
  const from = k ? trackedFrom(k, s) : '';
  // The number and its "vs 98.0% goal" each stay whole; a narrow column wraps only between them.
  const nw = (t) => `<span class="nowrap">${esc(t)}</span>`;
  const fig = from ? esc(from)
    : !show ? ''
      : f.actual === null ? nw(f.rest) : `${nw(f.actual)}${f.rest ? ` ${nw(f.rest)}` : ''}`;
  return `<p class="m-extra-cell"><span class="sr-only">${esc(label)}: </span>`
    + `${statusMarkup(s.status, { tag: 'span', kpi, extra: 'm-extra-status' })}`
    + `${fig ? ` <span class="m-extra-fig${from ? ' m-extra-fig--from' : ''}">${fig}</span>` : ''}`
    + `${measureNote ? ` <span class="m-extra-measure">${esc(measureNote)}</span>` : ''}</p>`;
}

/**
 * An extra measure's issue and action, in the two columns under its figures.
 * The action is in the board's words: the note and that day's Action register
 * actions, "Needs an action" in red, or the quiet word. One line when nothing
 * was recorded for it that day.
 */
function extraNotes(fn, k, addFor) {
  const st = stateFor(fn, k);
  const issue = notesText(month, k, day).problem;
  if (st.state === 'nothing' && issue.empty) {
    return `<div class="m-extra-notes"><p class="m-extra-note m-extra-note--wide is-empty"><span class="m-extra-tag">Issue and action</span>${esc(ACTION_WORD.nothing)}</p></div>`;
  }
  const gap = gapFor(fn, k);
  // Off goal with no issue written: only the red line (the owner's "No new issues" would contradict it).
  const issueHtml = gap
    ? `<p class="m-extra-note"><span class="m-extra-tag">Issue</span><span class="m-issue-gap m-issue-gap--extra">${issueGapMarkup('m-gap-status')}</span></p>`
    : `<p class="m-extra-note${issue.empty ? ' is-empty' : ''}"><span class="m-extra-tag">Issue</span>${esc(issue.text)}</p>`;
  let action;
  if (st.state === 'needs') {
    // Its own Add action beside the red line, opening the form on this measure.
    action = `<div class="m-extra-note m-extra-note--needs"><span class="m-extra-tag">Action</span>`
      + `<div class="m-action-needs">${statusMarkup(OFF, { tag: 'span', word: ACTION_WORD.needs, extra: 'm-needs-status' })}${addFor(kpiKeyOf(k))}</div></div>`;
  } else if (st.state !== 'has') {
    action = `<p class="m-extra-note is-empty"><span class="m-extra-tag">Action</span>${esc(st.word)}</p>`;
  } else {
    // The workbook's note, then up to two register actions (open ones first, then "Done: …").
    const thisMeeting = currentMeetingId();
    const shown = st.assigned.slice(0, 2);
    const more = st.assigned.length - shown.length;
    const items = shown.map((a) => {
      const mine = Boolean(thisMeeting) && a.meetingId === thisMeeting;
      return `<li><span class="m-extra-text">${isDone(a) ? doneMark() : ''}${esc(a.text)}</span><span class="m-extra-meta">${esc(metaText(a))}${mine ? '<span class="m-dot"> · </span><span class="m-from">Added in this meeting</span>' : ''}</span></li>`;
    }).join('');
    action = `<div class="m-extra-note"><span class="m-extra-tag">Action</span>`
      + `${st.text ? `<span class="m-extra-text">${esc(st.text)}</span>` : ''}`
      + `${items ? `<ul class="m-extra-actions" aria-label="Actions for ${esc(plainLabel(k.kpiDaily))}">${items}</ul>` : ''}`
      + `${more > 0 ? `<span class="m-extra-meta">${more} more in the Action register</span>` : ''}</div>`;
  }
  return `<div class="m-extra-notes">${issueHtml}${action}</div>`;
}

/** A KPI row's key in the Add action form's Measure list: '' for the function's own KPI, else its id. */
const kpiKeyOf = (k) => (k.primary ? '' : String(k.kpiId ?? ''));

/**
 * One Add action button. kpiKey null is the slide's own (top right, shown only when nothing on
 * the slide needs an action); '' or a KPI id is the one beside that KPI's "Needs an action",
 * which opens the form on that measure. Each says what it's for ("Add action for Quality,
 * First pass yield"). `note` is a kept draft's "Draft kept for …", right after the button it
 * was kept from, and the button is described by it.
 */
function addButton(fn, kpiKey = null, note = '') {
  if (!recorderReady()) return '';
  const beside = kpiKey != null;
  return `<button class="btn btn--secondary m-add${beside ? ' m-add--needs' : ''}" type="button" data-meeting-add="${esc(fn.id)}"`
    + `${beside ? ` data-meeting-add-kpi="${esc(kpiKey)}"` : ''}${note ? ' aria-describedby="m-draft"' : ''}>`
    + `${addActionIcon}Add action<span class="sr-only"> for ${esc(addTargetName(fn, kpiKey))}</span></button>`
    + `${note ? `<p class="m-draft${beside ? ' m-draft--beside' : ''}" id="m-draft">${esc(note)}</p>` : ''}`;
}

/**
 * Where a kept draft's note goes: beside the button it was kept from while that button shows,
 * else beside the slide's first Add action (then it names only the function, as the draft is
 * the function's). `keys` are the slide's buttons in order (null = the slide's own).
 * Returns { at, text } or null.
 */
function draftPlace(fn, keys) {
  const draft = recorderReady() ? meetingDraftFor(fn.id) : null;
  if (!draft || !keys.length) return null;
  const from = draft.from ?? null;
  return keys.includes(from) ? { at: from, text: draftWords(fn, from) } : { at: keys[0], text: draftWords(fn, null) };
}

/** "Mon,\u00a0Mar\u00a02": a date never breaks across lines. */
const dueDay = (iso) => actionDayText(iso, month).replace(/ /g, '\u00a0');
/** "Due Mon, Mar 2" (one piece when it wraps), or "No due date". */
const dueWords = (iso) => (iso ? `Due\u00a0${dueDay(iso)}` : 'No due date');
/** A done action (closed that day or later): "Done Fri, Feb 27", as the board says it, or '' when the day isn't known. */
const closedWords = (a) => (a.closedDayIso ? `Done\u00a0${dueDay(a.closedDayIso)}` : '');
const isDone = (a) => a.status === 'closed';
/** "Done:" with the on-track glyph, before a done action's words. */
const doneMark = () => `<span class="m-done">${glyphMarkup(ON)}Done:</span> `;

/** "Jane Doe · Due Mon, Mar 2" for one register action ("Jane Doe · Done Fri, Feb 27" once it's done). */
function metaText(a) {
  if (!a) return '';
  return [a.owner, isDone(a) ? closedWords(a) : dueWords(a.due)].filter(Boolean).join(' · ');
}

/** The action state for one KPI row (the register can't be read: as if it had no actions). */
function stateFor(fn, k) {
  try { return actionStateFor(month, fn, k, day); } catch {
    return { state: 'nothing', word: ACTION_WORD.nothing, text: null, assigned: [], off: false, monthOnly: false };
  }
}

/** Off goal, something recorded, no real problem written (board.js issueGap): the issue is owed. */
const gapFor = (fn, k) => { try { return issueGap(month, fn, k, day); } catch { return false; } };
/** The red line under an issue that isn't written yet (word + glyph + color). */
const issueGapMarkup = (cls) => statusMarkup(OFF, { tag: 'span', word: ISSUE_GAP_WORD, extra: cls });

/** KPIs added in Board setup: under the chart, each with its day and month status, issue and action. */
function extrasBlock(fn, extras, addFor) {
  if (!extras.length) return '';
  const dayLabel = dayHeading(month, day);
  const monthLabel = monthSoFar(month);
  return `
    <section class="m-extras" aria-labelledby="m-extras-title">
      <h3 class="m-section-title m-extras-title" id="m-extras-title">More measures<span class="sr-only"> for ${esc(fn.name)}</span></h3>
      <p class="m-extra-head" aria-hidden="true"><span class="m-extra-head-name"></span><span class="m-extra-col"><span>${esc(dayLabel)}</span></span><span class="m-extra-col"><span>${esc(monthLabel)}</span></span></p>
      <ul class="m-extra-list">${extras.map((k) => {
        const y = dayStatus(month, k, day);
        const mo = monthStatus(month, k, day);
        const monthMeasure = plainLabel(k.kpiMonthly) === plainLabel(k.kpiDaily) ? '' : plainLabel(k.kpiMonthly);
        return `<li class="m-extra">
            <p class="m-extra-name">${esc(plainLabel(k.kpiDaily))}</p>
            ${extraCell(dayLabel, y, k.kpiDaily, !(y.status === NO_PRODUCTION && y.actual === null), '', k)}
            ${extraCell(monthLabel, mo, k.kpiMonthly, mo.asOfDay !== null, monthMeasure, k)}
            ${extraNotes(fn, k, addFor)}
          </li>`;
      }).join('')}</ul>
      <p class="m-extra-more" data-extra-more hidden></p>
    </section>`;
}

/** The issue's status (Open, In progress, Closed), only when one was set. */
function issueStatus(fn) {
  const n = notesFor(fn, day);
  if (!hasProblem(n) || !n.status) return '';
  return `<p class="problem-status m-problem-status"><span class="problem-status-label">Status:</span>${issueStatusMarkup(n.status)}</p>`;
}

/**
 * "Action, next 24 hours" for the function's main KPI, in the board's words:
 * the workbook's action and that day's Action register actions (open ones with
 * their owner and due date, done ones as "Done: …" with the day they were closed,
 * "Added in this meeting" on the ones added here), "Needs an
 * action" in red when it's off goal and nobody has picked it up, or the quiet
 * word ("None needed", "Nothing recorded").
 */
function actionNote(fn, st, addFor) {
  if (st.state === 'needs') {
    // Add action sits beside the red line it answers (the slide then has no button at the top).
    return `<div class="m-action-needs">${statusMarkup(OFF, { tag: 'span', word: ACTION_WORD.needs, extra: 'm-needs-status' })}${addFor('')}</div>`;
  }
  if (st.state !== 'has') return `<p class="m-note-text m-note-text--action is-empty">${esc(st.word)}</p>`;
  const assigned = st.assigned;
  const parts = [];
  if (st.text) parts.push(`<p class="m-note-text m-note-text--action">${esc(clampedNote(st.text))}</p>`);
  if (assigned.length) {
    const thisMeeting = currentMeetingId();
    const boardIso = isoForDay(month, day);
    const items = assigned.map((a) => {
      const mine = Boolean(thisMeeting) && a.meetingId === thisMeeting;
      const done = isDone(a);
      // Done: the day it was closed. Open: its due date, "Overdue" first when it's past.
      const when = done
        ? esc(closedWords(a))
        : `${a.due && a.due < boardIso ? `<span class="m-over">${glyphMarkup(OFF)}Overdue</span><span class="m-dot"> · </span>` : ''}${esc(dueWords(a.due))}`;
      const meta = [a.owner ? esc(a.owner) : '', when, mine ? '<span class="m-from">Added in this meeting</span>' : ''].filter(Boolean);
      return `<li class="m-action${done ? ' is-done' : ''}"${mine ? ' data-this-meeting' : ''}>
          <p class="m-action-text">${done ? doneMark() : ''}${esc(a.text)}</p>
          <p class="m-action-meta">${meta.join('<span class="m-dot"> · </span>')}</p>
        </li>`;
    }).join('');
    parts.push(`<ul class="m-actions" aria-label="Actions for ${esc(fn.name)}">${items}</ul>`
      + '<p class="m-actions-more" data-actions-more hidden></p>');
  }
  return parts.join('');
}

function fnSlide(fn) {
  const y = dayStatus(month, fn, day);
  const mo = monthStatus(month, fn, day);
  const notes = notesText(month, fn, day);
  const issueText = notes.problem.text;
  const rows = kpiRowsFor(fn);
  const extras = rows.filter((k) => !k.primary);
  const st = stateFor(fn, rows[0]);
  // Off goal with no problem written: only a red line, saying the issue is owed.
  const gap = gapFor(fn, rows[0]);
  // A goal of 0 every day is the chart's axis, so it draws no goal line: no Goal key either (as charts.js decides).
  // Its zero days are stubs in the Actual color, so the Actual swatch covers them too.
  const goals = dailySeries(fn)
    .filter((r) => r.day <= day && !r.beforeStart && isProductionDay(month, r.day) !== false)
    .map((r) => r.goal)
    .filter((g) => typeof g === 'number' && Number.isFinite(g));
  const goalKey = goals.some((g) => g !== 0) ? '<span class="key key--goal"></span>Goal' : '';
  // One Add action per thing that needs one: each "Needs an action" (the main KPI's and each
  // More measures one) has its own beside it, and then there's none at the top of the slide.
  // With nothing needing one, the slide keeps its single Add action at the top.
  const needKeys = rows.filter((k) => (k.primary ? st : stateFor(fn, k)).state === 'needs').map(kpiKeyOf);
  const keys = needKeys.length ? needKeys : [null];
  // A typed action kept from Esc or Cancel says so beside the button it was kept from, until it's saved.
  const draft = draftPlace(fn, keys);
  const addFor = (key) => addButton(fn, key, draft && draft.at === key ? draft.text : '');
  const topAdd = recorderReady() && !needKeys.length ? `<div class="m-add-wrap">${addFor(null)}</div>` : '';
  // Left: who, the question, the two numbers, then the issue and the action.
  // Right: the month chart at full height. No empty lower third.
  return `
    <article class="m-fn" aria-labelledby="m-name">
      <div class="m-col m-col--left">
        <header class="m-head">
          <div class="m-head-text">
            <h2 class="m-name" id="m-name">${esc(fn.name)}</h2>
            <p class="m-owner">${esc(fn.owner)}</p>
            <p class="m-question">${esc(fn.dorQuestion)}</p>
          </div>
          ${topAdd}
        </header>
        <div class="m-kpis">
          ${kpiBlock(dayHeading(month, day), y, fn.kpiDaily, plainLabel(fn.kpiDaily), fn)}
          ${kpiBlock(monthSoFar(month), mo, fn.kpiMonthly, plainLabel(fn.kpiMonthly), fn)}
        </div>
        <section class="m-notes" aria-label="Issue and action, next 24 hours">
          <div class="m-note"><div class="m-note-head"><h3 class="m-section-title">Issue</h3>${issueStatus(fn)}</div>${gap
            ? `<p class="m-issue-gap">${issueGapMarkup('m-gap-status')}</p>`
            : `<p class="m-note-text m-note-text--problem${notes.problem.empty ? ' is-empty' : ''}">${esc(clampedNote(issueText))}</p>`}</div>
          <div class="m-note m-note--action${st.state === 'needs' ? ' is-needs' : ''}"><h3 class="m-section-title">Action, next 24 hours</h3>${actionNote(fn, st, addFor)}</div>
        </section>
      </div>
      <div class="m-col m-col--right${extras.length ? ' has-extras' : ''}">
        <section class="m-chart" aria-labelledby="m-chart-title">
          <h3 class="m-section-title" id="m-chart-title">${esc(formatMonthName(month))}, day by day
            <span class="legend" aria-hidden="true"><span class="key key--bar"></span>Actual${goalKey}<span class="key key--bar m-key-off"></span>Off goal</span></h3>
          <div class="chart-host" data-meeting-chart></div>
          <p class="m-record">${esc(recordText(month, fn, day))}</p>
        </section>
        ${extrasBlock(fn, extras, addFor)}
      </div>
    </article>`;
}

function mountChart(fn) {
  const host = stage.querySelector('[data-meeting-chart]');
  const base = parseFloat(getComputedStyle(root).fontSize) || 20;
  const statusOf = (r) => compareToGoal(r.actual, r.goal, fn.kpiDaily.better);
  chart = barChart(host, {
    series: dailySeries(fn),
    day,
    daysInMonth: month.daysInMonth,
    isProductionDay: (d) => isProductionDay(month, d),
    statusOf,
    kpi: fn.kpiDaily,
    height: Math.round(host.clientHeight || base * 9),
    fontSize: Math.max(12, Math.round(base * 0.78)),
    monthShort: formatMonthShort(month),
    weekdayOf: (d) => weekday(month, d),
    label: `${plainLabel(fn.kpiDaily)}, each production day of ${formatMonthName(month)}`,
    // The room watches and the presenter's keys drive slides: a plain picture with its name, no arrow-key reading here.
    focusable: false,
    describe: (r) => {
      const f = formatPair(r.actual, r.goal, fn.kpiDaily);
      return { value: f.actual === null ? `Not entered. ${f.rest}` : f.phrase, meta: formatDayMedium(month, r.day), status: statusOf(r) };
    },
  });
}

/** Re-render after a resize so chart text keeps its size. */
export function refreshMeeting() {
  if (open) render();
}
