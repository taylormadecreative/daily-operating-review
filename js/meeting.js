// Meeting mode (TV): dark, full screen, one function per slide.
// Slide 0 is the summary and roadmap; slides 1-8 walk the board in order.
// Keys: arrows, PageUp/PageDown (presenter clickers), Space, Home/End, Esc.
// The recorder (js/recorder.js) adds Record, live captions, Add action and the
// minutes; this file tells it when a meeting opens and closes. Each function
// slide lists its open actions from the Action register (js/actions.js) under
// "Action, next 24 hours".

import { dailySeries, kpiRowsFor, notesFor, hasProblem, isoForDay } from './store.js?v=20261012-235706';
import { dayStatus, monthStatus, boardSummary, isProductionDay, compareToGoal, ON, OFF, NO_PRODUCTION } from './status.js?v=20261012-235706';
import {
  formatPair, plainLabel, formatDayLong, formatDayMedium, formatMonthName, formatMonthShort,
  monthSoFar, dayHeading, weekday,
} from './format.js?v=20261012-235706';
import { notesText, recordText } from './board.js?v=20261012-235706';
import { esc, statusMarkup, issueStatusMarkup, glyphMarkup } from './ui.js?v=20261012-235706';
import { barChart } from './charts.js?v=20261012-235706';
import {
  connectMeeting, startMeetingSession, updateMeetingSession, endMeetingSession,
  recorderReady, recorderHoldsEscape, addActionIcon, currentMeetingId,
} from './recorder.js?v=20261012-235706';
import { actionsFor, actionDayText } from './actions.js?v=20261012-235706';

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

export function initMeeting(h) {
  handlers = h;
  root = document.getElementById('meeting');
  stage = root.querySelector('[data-stage]');
  root.querySelector('[data-prev-slide]').addEventListener('click', () => go(slide - 1));
  root.querySelector('[data-next-slide]').addEventListener('click', () => go(slide + 1));
  root.querySelector('[data-exit]').addEventListener('click', () => handlers.onExit(currentFnId()));
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

export function closeMeeting() {
  if (!open) return;
  endMeetingSession(); // stop recording and save the minutes before the screen goes
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
  // Keep keyboard focus on the slide's Add action button through a re-render.
  const focusedAdd = document.activeElement?.closest?.('[data-meeting-add]')?.dataset.meetingAdd ?? null;
  chart?.destroy();
  chart = null;
  const total = month.functions.length;
  const fn = slide > 0 ? month.functions[slide - 1] : null;
  root.querySelector('[data-progress-text]').textContent = fn ? `${slide} of ${total}\u00a0·\u00a0${fn.name}` : `Summary\u00a0·\u00a0${total} functions`;
  root.querySelector('[data-progress-fill]').style.transform = `scaleX(${slide / total})`;
  const prev = root.querySelector('[data-prev-slide]');
  const next = root.querySelector('[data-next-slide]');
  prev.disabled = slide === 0;
  next.disabled = slide === total;
  // Focus never drops to <body>: if the focused button just disabled, hand
  // focus to the other one.
  if (prev.disabled && document.activeElement === prev) next.focus();
  if (next.disabled && document.activeElement === next) prev.focus();
  stage.innerHTML = fn ? fnSlide(fn) : summarySlide();
  stage.dataset.slide = String(slide);
  // A short fade so the room sees the change; none with reduced motion.
  if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    stage.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  }
  if (fn) { mountChart(fn); fitSlide(); }
  if (focusedAdd) stage.querySelector(`[data-meeting-add="${CSS.escape(focusedAdd)}"]`)?.focus({ preventScroll: true });
}

/**
 * Fit the slide to the screen. Notes come first (fitNotes). When they still
 * don't fit (live captions, extra measures or many actions take room), the
 * display numbers get smaller, then the oldest register actions give way to a
 * "more in the Action register" line, then the last extra measures give way
 * to a "more on the board" line.
 */
function fitSlide() {
  if (fitNotes()) return;
  const art = stage.querySelector('.m-fn');
  if (!art) return;
  art.classList.add('is-compact');
  if (fitNotes()) return;
  if (fitNotes({ hideActions: true })) return;
  const extras = [...stage.querySelectorAll('.m-extra')];
  if (!extras.length) return;
  const more = stage.querySelector('[data-extra-more]');
  for (let i = extras.length - 1, hidden = 1; i >= 0; i -= 1, hidden += 1) {
    extras[i].hidden = true;
    more.textContent = `${hidden} more ${hidden === 1 ? 'measure' : 'measures'} on the board`;
    more.hidden = false;
    if (fitNotes({ hideActions: true })) return;
  }
}

/**
 * Give Issue and "Action, next 24 hours" as many lines as the screen allows,
 * then end on an ellipsis instead of cutting a line in half. The register's
 * actions are the room's newest news, so the notes give way first; then each
 * action shortens to 2 lines; then the oldest news gives way to a "more in the
 * Action register" line (this meeting's actions are the last to go).
 */
function fitNotes({ hideActions = false } = {}) {
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
  if (fits() || !items.length) return fits();
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
  while (!fits() && problem && p > 2) { p -= 1; apply(); }
  return fits();
}

function summarySlide() {
  const s = boardSummary(month, day);
  const y = s.yesterday;
  const headline = s.productionDay === false ? 'No production scheduled' : `${y[ON]} of ${y.total} on track`;
  return `
    <section class="m-summary" aria-labelledby="m-headline">
      <p class="m-date">${esc(formatDayLong(month, day))}</p>
      <h2 class="m-headline" id="m-headline">${esc(headline)}</h2>
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

function kpiBlock(label, s, kpi, measure) {
  const f = formatPair(s.actual, s.goal, kpi);
  return `<section class="m-kpi" data-status="${s.status}">
      <h3 class="m-kpi-label">${esc(label)}</h3>
      ${statusMarkup(s.status, { extra: 'm-status', kpi })}
      ${f.actual === null
        ? `<p class="m-num m-num--empty">${esc(f.rest)}</p>`
        : `<p class="m-num">${esc(f.actual)}</p>${f.rest ? `<p class="m-rest">${esc(f.rest)}</p>` : ''}`}
      <p class="m-measure">${esc(measure)}</p>
    </section>`;
}

/** One extra measure's status and figure, in the day or month column. */
function extraCell(label, s, kpi, show, measureNote = '') {
  const f = formatPair(s.actual, s.goal, kpi);
  const fig = !show ? '' : f.actual === null ? f.rest : `${f.actual}${f.rest ? ` ${f.rest}` : ''}`;
  return `<p class="m-extra-cell"><span class="sr-only">${esc(label)}: </span>`
    + `${statusMarkup(s.status, { tag: 'span', kpi, extra: 'm-extra-status' })}`
    + `${fig ? ` <span class="m-extra-fig">${esc(fig)}</span>` : ''}`
    + `${measureNote ? ` <span class="m-extra-measure">${esc(measureNote)}</span>` : ''}</p>`;
}

/** Extra measures from Board setup: a compact list under the main figures, in the same two columns. */
function extrasBlock(fn, extras) {
  if (!extras.length) return '';
  const dayLabel = dayHeading(month, day);
  const monthLabel = monthSoFar(month);
  return `
    <section class="m-extras" aria-label="More measures for ${esc(fn.name)}">
      <ul class="m-extra-list">${extras.map((k) => {
        const y = dayStatus(month, k, day);
        const mo = monthStatus(month, k, day);
        const monthMeasure = plainLabel(k.kpiMonthly) === plainLabel(k.kpiDaily) ? '' : plainLabel(k.kpiMonthly);
        return `<li class="m-extra">
            <p class="m-extra-name">${esc(plainLabel(k.kpiDaily))}</p>
            ${extraCell(dayLabel, y, k.kpiDaily, !(y.status === NO_PRODUCTION && y.actual === null))}
            ${extraCell(monthLabel, mo, k.kpiMonthly, mo.asOfDay !== null, monthMeasure)}
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

/** The function's open actions from the Action register (none when it can't be read). */
function registerActions(fnId) {
  try { return actionsFor(fnId, null); } catch { return []; }
}

/**
 * "Action, next 24 hours": the board's note first (when there is one), then
 * the function's open actions from the Action register, each with its owner
 * and due date, and "From this meeting" on the ones added in this meeting.
 */
function actionNote(fn, note) {
  const assigned = registerActions(fn.id);
  const parts = [];
  if (!note.empty || !assigned.length) {
    parts.push(`<p class="m-note-text m-note-text--action${note.empty ? ' is-empty' : ''}">${esc(note.text)}</p>`);
  }
  if (assigned.length) {
    const thisMeeting = currentMeetingId();
    const boardIso = isoForDay(month, day);
    const items = assigned.map((a) => {
      const mine = Boolean(thisMeeting) && a.meetingId === thisMeeting;
      const due = !a.due
        ? 'no due date'
        : a.due < boardIso
          ? `<span class="m-over">${glyphMarkup(OFF)}Overdue</span>, due ${esc(actionDayText(a.due, month))}`
          : `due ${esc(actionDayText(a.due, month))}`;
      const meta = [a.owner ? esc(a.owner) : '', due, mine ? '<span class="m-from">From this meeting</span>' : ''].filter(Boolean);
      return `<li class="m-action"${mine ? ' data-this-meeting' : ''}>
          <p class="m-action-text">${esc(a.text)}</p>
          <p class="m-action-meta">${meta.join('<span class="m-dot"> · </span>')}</p>
        </li>`;
    }).join('');
    parts.push(`<ul class="m-actions" aria-label="Open actions for ${esc(fn.name)}">${items}</ul>`
      + '<p class="m-actions-more" data-actions-more hidden></p>');
  }
  return parts.join('');
}

function fnSlide(fn) {
  const y = dayStatus(month, fn, day);
  const mo = monthStatus(month, fn, day);
  const notes = notesText(month, fn, day);
  const issueText = notes.problem.text.replace(/^No problem reported$/, 'No issue reported');
  const extras = kpiRowsFor(fn).filter((k) => !k.primary);
  const addButton = recorderReady()
    ? `<button class="btn btn--secondary m-add" type="button" data-meeting-add="${esc(fn.id)}">${addActionIcon}Add action<span class="sr-only"> for ${esc(fn.name)}</span></button>`
    : '';
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
          ${addButton}
        </header>
        <div class="m-kpis">
          ${kpiBlock(dayHeading(month, day), y, fn.kpiDaily, plainLabel(fn.kpiDaily))}
          ${kpiBlock(monthSoFar(month), mo, fn.kpiMonthly, plainLabel(fn.kpiMonthly))}
        </div>
        ${extrasBlock(fn, extras)}
        <section class="m-notes" aria-label="Issue and action, next 24 hours">
          <div class="m-note"><div class="m-note-head"><h3 class="m-section-title">Issue</h3>${issueStatus(fn)}</div><p class="m-note-text m-note-text--problem${notes.problem.empty ? ' is-empty' : ''}">${esc(issueText)}</p></div>
          <div class="m-note m-note--action"><h3 class="m-section-title">Action, next 24 hours</h3>${actionNote(fn, notes.action)}</div>
        </section>
      </div>
      <section class="m-col m-col--right m-chart" aria-labelledby="m-chart-title">
        <h3 class="m-section-title" id="m-chart-title">${esc(formatMonthName(month))}, day by day
          <span class="legend" aria-hidden="true"><span class="key key--bar"></span>Actual<span class="key key--goal"></span>Goal<svg class="key-glyph" aria-hidden="true" focusable="false"><use href="#g-off"></use></svg>Off goal</span></h3>
        <div class="chart-host" data-meeting-chart></div>
        <p class="m-record">${esc(recordText(month, fn, day))}</p>
      </section>
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
    describe: (r) => {
      const f = formatPair(r.actual, r.goal, fn.kpiDaily);
      return { value: f.actual === null ? `Not entered. ${f.rest}` : f.phrase, meta: formatDayMedium(month, r.day), status: statusOf(r) };
    },
  });
  host.tabIndex = -1; // the room watches; the presenter's keys drive slides
}

/** Re-render after a resize so chart text keeps its size. */
export function refreshMeeting() {
  if (open) render();
}
