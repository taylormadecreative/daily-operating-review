// Meeting mode (TV): dark, full screen, one function per slide.
// Slide 0 is the summary and roadmap; slides 1-8 walk the board in order.
// Keys: arrows, PageUp/PageDown (presenter clickers), Space, Home/End, Esc.

import { dailySeries } from './store.js';
import { dayStatus, monthStatus, boardSummary, isProductionDay, compareToGoal, ON } from './status.js';
import {
  formatPair, plainLabel, formatDayLong, formatDayMedium, formatMonthName, formatMonthShort,
  monthSoFar, dayHeading, weekday,
} from './format.js';
import { notesText, recordText, problemStatusMarkup } from './board.js';
import { esc, statusMarkup } from './ui.js';
import { barChart } from './charts.js';

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
      handlers.onExit(currentFnId()); // Esc in full screen lands here
    }
  });
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

function render() {
  chart?.destroy();
  chart = null;
  const total = month.functions.length;
  const fn = slide > 0 ? month.functions[slide - 1] : null;
  root.querySelector('[data-progress-text]').textContent = fn ? `${slide} of ${total}\u00a0·\u00a0${fn.name}` : `Summary\u00a0·\u00a0${total} departments`;
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
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    stage.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  }
  if (fn) { mountChart(fn); fitNotes(); }
}

/**
 * Give Problem and Next 24 hours as many lines as the screen allows, then end
 * on an ellipsis instead of cutting a line in half.
 */
function fitNotes() {
  const box = stage.querySelector('.m-notes');
  const problem = stage.querySelector('.m-note-text--problem');
  const action = stage.querySelector('.m-note-text:not(.m-note-text--problem)');
  if (!box || !problem || !action) return;
  const fits = () => box.scrollHeight <= box.clientHeight + 1;
  let p = 8;
  let a = 5;
  const apply = () => { problem.style.setProperty('--clamp', p); action.style.setProperty('--clamp', a); };
  apply();
  while (!fits() && (p > 3 || a > 2)) {
    if (p > a + 1 && p > 3) p -= 1; else if (a > 2) a -= 1; else p -= 1;
    apply();
  }
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
          const st = dayStatus(month, f, day).status;
          return `<li class="m-tile" data-status="${st}">
              <span class="m-tile-num">${i + 1}</span>
              <span class="m-tile-name">${esc(f.name)}</span>
              ${statusMarkup(st, { tag: 'span', extra: 'm-tile-status', kpi: f.kpiDaily })}
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

function fnSlide(fn) {
  const y = dayStatus(month, fn, day);
  const mo = monthStatus(month, fn, day);
  const notes = notesText(month, fn, day);
  // Left: who, the question, the two numbers, then problem and action.
  // Right: the month chart at full height. No empty lower third.
  return `
    <article class="m-fn" aria-labelledby="m-name">
      <div class="m-col m-col--left">
        <header class="m-head">
          <h2 class="m-name" id="m-name">${esc(fn.name)}</h2>
          <p class="m-owner">${esc(fn.owner)}</p>
          <p class="m-question">${esc(fn.dorQuestion)}</p>
        </header>
        <div class="m-kpis">
          ${kpiBlock(dayHeading(month, day), y, fn.kpiDaily, plainLabel(fn.kpiDaily))}
          ${kpiBlock(monthSoFar(month), mo, fn.kpiMonthly, plainLabel(fn.kpiMonthly))}
        </div>
        <section class="m-notes" aria-label="Problem and next 24 hours">
          <div class="m-note"><div class="m-note-head"><h3 class="m-section-title">Problem</h3>${problemStatusMarkup(fn, day, 'problem-status m-problem-status')}</div><p class="m-note-text m-note-text--problem${notes.problem.empty ? ' is-empty' : ''}">${esc(notes.problem.text)}</p></div>
          <div class="m-note"><h3 class="m-section-title">Next 24 hours</h3><p class="m-note-text${notes.action.empty ? ' is-empty' : ''}">${esc(notes.action.text)}</p></div>
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
