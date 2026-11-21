// Board (home): the summary sentence and the eight functions in meeting order.

import { dailySeries, isoForDay, dateBounds, notesFor, entryInfo, hasProblem, kpiRowsFor, ownerFor, noteParagraphs, NO_ISSUE } from './store.js?v=20261120-182315';
import {
  ON, OFF, NO_PRODUCTION, NOT_TRACKED, NOT_ENTERED,
  dayStatus, monthStatus, trackRecord, boardSummary, isProductionDay, lastProductionDay, compareToGoal, statusWord,
} from './status.js?v=20261120-182315';
import {
  formatPair, plainLabel, glossaryTerm, formatDayLong, formatDayMedium, formatMonthName, formatMonthShort,
  dayHeading, daySentence, monthSoFar, formatEnteredAt, lowerNote, formatValue, goalSign,
} from './format.js?v=20261120-182315';
import { trendChart, yearChart } from './charts.js?v=20261120-182315';
import { actionsFor, actionsForDays, verifiedBetween } from './actions.js?v=20261120-182315';
import { isOpenAction, isVerifiedAction, isCompletedAction, isEscalatedAction } from './action-state.js?v=20261120-182315';
import { icon, DEPT_ICON } from './icons.js?v=20261120-182315';
import { renderSparkline } from './sparkline.js?v=20261120-182315';
import { getIdentity } from './identity.js?v=20261120-182315';
import { esc, statusMarkup, termButton, issueStatusMarkup } from './ui.js?v=20261120-182315';
import { pageHref, scopeWord } from './shell.js?v=20261120-182315';
import * as cloud from './cloud.js?v=20261120-182315';

/* ---------- Pieces shared with Detail and Meeting ---------- */

export function figureMarkup(actual, goal, kpi) {
  const f = formatPair(actual, goal, kpi);
  if (f.actual === null) return `<p class="figure figure--empty"><span class="figure-rest">${esc(f.rest)}</span></p>`;
  return `<p class="figure"><span class="figure-actual">${esc(f.actual)}</span>${f.rest ? ` <span class="figure-rest">${esc(f.rest)}</span>` : ''}</p>`;
}

/** Measure name, with a "what does this mean?" button when the file defines it. */
export function measureMarkup(month, kpi, note = '', tag = 'p', cls = 'measure') {
  const t = glossaryTerm(month, kpi);
  const label = plainLabel(kpi);
  let body = esc(label);
  if (t) {
    // Keep the info button with the last word so it never wraps alone.
    const cut = label.lastIndexOf(' ');
    body = `${esc(label.slice(0, cut + 1))}<span class="nowrap">${esc(label.slice(cut + 1))} ${termButton(t.term, t.definition, t.name)}</span>`;
  }
  return `<${tag} class="${cls}">${body}${note ? `<span class="measure-note">${esc(note)}</span>` : ''}</${tag}>`;
}

/** "Parts produced: met goal 0 of 20 days" (+ " · lower is better"). */
export function recordText(month, fn, day) {
  const r = trackRecord(month, fn, day);
  const label = plainLabel(fn.kpiDaily);
  if (r.days === 0) {
    // Added in Board setup after this day: say when it starts, as the board's caption does.
    const start = trackedFrom(fn);
    return start && start > day ? `${label}: tracked from ${formatDayMedium(month, start)}` : `${label}: no production days yet`;
  }
  let text = `${label}: met goal ${r.met} of ${r.days} ${r.days === 1 ? 'day' : 'days'}`;
  if (r.notEntered) text += `, ${r.notEntered} not entered`;
  if (r.noGoal) text += `, ${noGoalDays(r.noGoal)}`;
  return text + lowerNote(fn.kpiDaily);
}

/** "1 day had no goal set", "2 days had no goal set" (the captions' tail). */
const noGoalDays = (n) => `${n} ${n === 1 ? 'day' : 'days'} had no goal set`;

/** Problem and action text for a day, with plain empty states. */
export function notesText(month, fn, day) {
  const n = notesFor(fn, day);
  // A KPI added in Board setup with a number but no notes: something was recorded, just no issue.
  if (n.source === null && fn.custom && recordedOn(fn, day)) {
    return { problem: { text: 'No issue reported', empty: true }, action: { text: ACTION_WORD.notYet, empty: true } };
  }
  if (n.source === null) {
    return {
      problem: { text: ACTION_WORD.nothing, empty: true },
      action: { text: ACTION_WORD.nothing, empty: true },
    };
  }
  const flat = (t) => t.replace(/\n\s*\n/g, '\n');
  return {
    problem: n.problem ? { text: flat(n.problem), empty: false } : { text: 'No issue reported', empty: true },
    action: n.action ? { text: flat(n.action), empty: false } : { text: ACTION_WORD.notYet, empty: true },
  };
}

/** "Status: In progress" under a problem (Detail, Meeting); nothing when there is no problem. */
export function problemStatusMarkup(fn, day, cls = 'problem-status') {
  const n = notesFor(fn, day);
  // No status chosen: say nothing (Edit sets one); "Not set" read as unfinished data.
  if (!hasProblem(n) || !n.status) return '';
  return `<p class="${cls}"><span class="problem-status-label">Status:</span>${issueStatusMarkup(n.status)}</p>`;
}

/**
 * "Entered by Jane Doe at 6:41 AM" ("at 6:41 AM" and Undo stay together on one line), on the KPI
 * row the entry changed: a save that only filled in a KPI added in Board setup says so on that
 * KPI's row, not on the function's own (store.js marks each row's entry with `changed`).
 */
export function enteredByMarkup(fn, day, { undo = false } = {}) {
  const info = entryInfo(fn, day);
  if (!info?.enteredBy || info.changed === false) return '';
  // "6:41 AM" today, "Feb 26, 6:41 AM" on another day: "on Feb 26 at 6:41 AM".
  const when = formatEnteredAt(info.enteredAt);
  const cut = when.lastIndexOf(', ');
  const date = cut > 0 ? ` on ${esc(when.slice(0, cut))}` : '';
  const time = cut > 0 ? when.slice(cut + 2) : when;
  const tail = [time ? `at ${esc(time)}` : '', undo ? '<button class="btn--text undo-link" type="button" data-undo-save>Undo</button>' : ''].filter(Boolean).join(' ');
  return `<p class="entered-by">Entered by ${esc(info.enteredBy)}${date}${tail ? ` <span class="nowrap">${tail}</span>` : ''}</p>`;
}

export function detailHref(month, fnId, day) {
  // DOR board links keep the board view, the day and the area when opened in a new tab.
  return pageHref(month, day, { view: 'dor', hash: fnId });
}

/* ---------- Undo on the saved row ---------- */

let undoable = null; // { fnId, day } of the last save, until the next save or a reload
export const setUndoable = (v) => { undoable = v; };
export const getUndoable = () => undoable;

/* ---------- Scope: the Area filter governs the daily Status column ---------- */

/**
 * A KPI row seen through the Area filter: its daily series for that area, read like its plant series,
 * so the status helpers work unchanged. A KPI added in Board setup has one number a day and no areas:
 * null (the block says "Not tracked by area"). 'all' is the row itself (plant totals).
 */
export function scopedRow(k, area) {
  if (!area || area === 'all') return k;
  if (k.custom || !Array.isArray(k.daily?.[area])) return null;
  return { ...k, daily: { ...k.daily, plant: k.daily[area] } };
}

/**
 * The day's status in the board's scope. A missing area number reads "Not entered for Mold", never the
 * plant value; a KPI with no area numbers at all reads "Not tracked by area".
 * -> { status, actual, goal, word }
 */
export function scopedDayStatus(month, k, day, area) {
  const row = scopedRow(k, area);
  if (!row) return { status: NOT_TRACKED, actual: null, goal: null, word: 'Not tracked by area' };
  const y = dayStatus(month, row, day);
  const word = area && area !== 'all' && y.status === NOT_ENTERED ? `Not entered for ${scopeWord(area)}` : undefined;
  return { ...y, word };
}

/* ---------- Rows ---------- */

function rowElement(month, fn, day, area = 'all') {
  const y = scopedDayStatus(month, fn, day, area);
  const mo = monthStatus(month, fn, day);
  const notes = notesText(month, fn, day);
  const caption = recordText(month, fn, day);
  const li = document.createElement('li');
  li.className = 'row';
  li.id = `fn-${fn.id}`;
  li.dataset.fn = fn.id;

  const monthNote = mo.asOfDay && mo.asOfDay !== day ? `as of ${formatDayMedium(month, mo.asOfDay)}` : '';
  const note = (label, o) => `<p class="note-text${o.empty ? ' is-empty' : ''}"><span class="note-label">${label}</span>${esc(o.text)}</p>`;
  const showDayFigure = !(y.status === NO_PRODUCTION && y.actual === null);
  const showMonthFigure = mo.asOfDay !== null;
  const undo = undoable && undoable.fnId === fn.id && undoable.day === day;

  li.innerHTML = `
    <div class="cell cell--fn">
      <h2 class="fn-name"><a class="fn-link" href="${detailHref(month, fn.id, day)}" data-open-detail="${esc(fn.id)}">${esc(fn.name)}</a></h2>
      <p class="fn-owner">${esc(fn.owner)}</p>
      <p class="fn-question">${esc(fn.dorQuestion)}</p>
    </div>
    <div class="cell cell--day" data-status="${y.status}">
      <p class="cell-label">${esc(area === 'all' ? dayHeading(month, day) : `${scopeWord(area)} · ${dayHeading(month, day)}`)}</p>
      ${statusMarkup(y.status, { kpi: fn.kpiDaily, word: y.word })}
      ${showDayFigure ? figureMarkup(y.actual, y.goal, fn.kpiDaily) + measureMarkup(month, fn.kpiDaily) : ''}
    </div>
    <div class="cell cell--month" data-status="${mo.status}">
      <p class="cell-label">${esc(area === 'all' ? monthSoFar(month) : `${monthSoFar(month)} · Plant total`)}</p>
      ${statusMarkup(mo.status, { kpi: fn.kpiMonthly })}
      ${showMonthFigure ? figureMarkup(mo.actual, mo.goal, fn.kpiMonthly) + measureMarkup(month, fn.kpiMonthly, monthNote) : ''}
    </div>
    <div class="cell cell--trend">
      <p class="cell-label">Trend, day by day <span class="legend" aria-hidden="true"><span class="key key--actual"></span>Actual<span class="key key--goal"></span>Goal</span></p>
      <div class="spark-slot"></div>
      <p class="spark-caption">${esc(caption)}</p>
    </div>
    <div class="cell cell--notes">
      <p class="cell-label">Problem → Next 24 hours</p>
      <div class="notes">${note('Problem', notes.problem)}${note('Next 24 hours', notes.action)}</div>
      ${enteredByMarkup(fn, day, { undo })}
    </div>`;

  const spark = renderSparkline({
    series: dailySeries(fn),
    day,
    daysInMonth: month.daysInMonth,
    isProductionDay: (d) => isProductionDay(month, d),
    endStatus: y.status,
    label: `${formatMonthName(month)} so far. ${caption}.`,
    describe: (r) => {
      const f = formatPair(r.actual, r.goal, fn.kpiDaily);
      return {
        date: formatDayMedium(month, r.day),
        value: f.actual === null ? `Not entered (${f.rest.toLowerCase()})` : `${f.actual}${f.rest ? ` ${f.rest}` : ''}`,
        status: compareToGoal(r.actual, r.goal, fn.kpiDaily.better),
        word: statusWord(compareToGoal(r.actual, r.goal, fn.kpiDaily.better), fn.kpiDaily),
      };
    },
  });
  li.querySelector('.spark-slot').replaceWith(spark);
  return li;
}

/* ---------- Summary ---------- */

export function summaryParts(month, day, area = 'all') {
  const s = boardSummary(month, day);
  const y = s.yesterday;
  // With an area picked, the count still judges plant totals (as Home's does), and says so first.
  // A pilot board starts each day empty: before numbers come in, the office TV says so rather than
  // "0 of 8 on track", and after, it counts what's in ("3 of 8 entered, 2 on track today").
  const entered = y.total - y.missing.length;
  const count = s.productionDay === false
    ? `No production was scheduled ${daySentence(month, day, 'on')}.`
    : month.pilot
      ? (entered ? `${entered} of ${y.total} entered, ${y[ON]} on track ${daySentence(month, day)}.` : `No numbers entered yet ${daySentence(month, day)}.`)
      : `${area === 'all' ? '' : 'Plant totals: '}${y[ON]} of ${y.total} on track ${daySentence(month, day)}.`;
  return { s, count };
}

/** Every function removed in Board setup: one line in place of "0 of 0 on track" over an empty table. */
export const NO_FUNCTIONS = 'Every function is hidden. Put them back in Board setup.';

/* ---------- Off goal only (spec §4: exceptions-only filter), remembered on this device ---------- */

const OFF_ONLY_KEY = 'dor.offOnly.v1';
let offOnlyMem = false;
export function getOffOnly() {
  try { return localStorage.getItem(OFF_ONLY_KEY) === '1'; } catch { return offOnlyMem; }
}
export function setOffOnly(on) {
  offOnlyMem = Boolean(on);
  try {
    if (on) localStorage.setItem(OFF_ONLY_KEY, '1'); else localStorage.removeItem(OFF_ONLY_KEY);
  } catch { /* this visit only */ }
}

/** Is any of the function's KPIs off goal on the day, as the Status column shows it (the Area filter's scope)? */
export function offOnDay(month, fn, day, area = 'all') {
  return kpiRowsFor(fn).some((k) => (area === 'all' ? dayStatus(month, k, day) : scopedDayStatus(month, k, day, area)).status === OFF);
}

/**
 * The filter's words say its scope: the day (the Status column, in the Area filter's scope). A month-only
 * miss isn't in it: the filter answers "what went wrong on this day?". -> "Off goal on Fri, Feb 27 only"
 */
export const offOnlyLabel = (month, day) => `Off goal on ${formatDayMedium(month, day)} only`;

/** The functions the board shows: all of them, or with Off goal only on, the ones off goal that day. */
export function shownFunctions(month, day, area = 'all') {
  return getOffOnly() ? month.functions.filter((fn) => offOnDay(month, fn, day, area)) : month.functions;
}

/**
 * The honest empty state when Off goal only finds nothing: "All 8 on track for Fri, Feb 27." when that's
 * so; otherwise what the day does hold ("Nothing is off goal for Fri, Feb 27. 6 on track, 2 not entered.").
 */
export function offOnlyEmptyText(month, day, area = 'all') {
  const total = month.functions.length;
  const when = formatDayMedium(month, day);
  const where = area === 'all' ? '' : ` for ${scopeWord(area)}`;
  const counts = {};
  for (const fn of month.functions) {
    const st = area === 'all' ? dayStatus(month, fn, day).status : scopedDayStatus(month, fn, day, area).status;
    counts[st] = (counts[st] ?? 0) + 1;
  }
  if (area === 'all' && counts[ON] === total) return { lead: `All ${total} on track for ${when}.`, rest: '' };
  if (counts[NO_PRODUCTION] === total) return { lead: `Nothing is off goal on ${when}.`, rest: 'No production was scheduled that day.' };
  const words = { [ON]: 'on track', [NOT_ENTERED]: 'not entered', 'no-goal': 'no goal set', [NO_PRODUCTION]: 'no production scheduled', [NOT_TRACKED]: 'not tracked yet' };
  const rest = Object.entries(counts).filter(([st]) => words[st]).map(([st, n]) => `${n} ${words[st]}`).join(', ');
  return { lead: `Nothing is off goal${where} on ${when}.`, rest: rest ? `${rest.charAt(0).toUpperCase()}${rest.slice(1)}.` : '' };
}

function summaryMarkup(month, day, area = 'all') {
  if (!month.functions.length) return { lead: `<span class="summary-count">${esc(NO_FUNCTIONS)}</span>`, monthLine: '' };
  const { s, count } = summaryParts(month, day, area);
  const link = (fn) => `<a href="#fn-${esc(fn.id)}" data-jump="${esc(fn.id)}">${esc(fn.name)}</a>`;
  const names = (list) => list.map(link).join(', ');
  const y = s.yesterday;
  let lead = `<span class="summary-count">${esc(count)}</span>`;
  if (y.attention.length) lead += ` <span class="summary-attention">Off goal: ${names(y.attention)}.</span>`;
  else if (s.productionDay !== false && !y.missing.length && !y.noGoal.length) lead += ' <span class="summary-attention">Nothing is off goal.</span>';
  if (y.noGoal.length) lead += ` <span class="summary-nogoal">No goal set: ${names(y.noGoal)}.</span>`;
  if (y.missing.length) lead += ` <span class="summary-missing">Not entered yet: ${names(y.missing)}.</span>`;

  const mo = s.month;
  let monthLine;
  if (!s.monthStarted) monthLine = `${esc(monthSoFar(month))}: no production yet.`;
  else {
    monthLine = `${esc(monthSoFar(month))}: ${mo[ON]} of ${mo.total} on track.`;
    if (mo.attention.length) monthLine += ` Off goal: ${names(mo.attention)}.`;
    if (mo.noGoal.length) monthLine += ` No goal set: ${names(mo.noGoal)}.`;
  }
  return { lead, monthLine };
}

/**
 * "Fri, Feb 27<span class="period-year">, 2026</span>": the header's day, with the year in its own span so a
 * tight header (css/header.css) can drop it; the scope line under the band always has it.
 */
export function periodDateMarkup(long) {
  const i = String(long).lastIndexOf(', ');
  return i > 0 ? `${esc(long.slice(0, i))}<span class="period-year">${esc(long.slice(i))}</span>` : esc(long);
}

/** Render the whole board for a day. `area` (the Area filter) governs the daily Status column. */
export function renderBoard(month, day, area = 'all') {
  const label = document.querySelector('[data-board-date]');
  label.innerHTML = periodDateMarkup(formatDayLong(month, day));
  label.setAttribute('datetime', isoForDay(month, day));
  const bounds = dateBounds(month);
  document.querySelector('[data-prev]').disabled = isoForDay(month, day) <= bounds.min;
  document.querySelector('[data-next]').disabled = isoForDay(month, day) >= bounds.max;
  document.querySelectorAll('[data-plant]').forEach((n) => { n.textContent = `${plantName(month)}\u00a0·\u00a0LinkedXL OS`; });
  // "This week →": the week holding this day, on the Weekly review (pageHref keeps the day; the review finds its week).
  document.querySelectorAll('[data-week-link]').forEach((a) => { a.href = pageHref(month, day, { view: 'wor' }).replace(/&week=[^&#]*/, ''); });
  document.querySelectorAll('[data-week-link-sr]').forEach((n) => { n.textContent = `: the week holding ${formatDayMedium(month, day)}, in the Weekly review`; });

  const { lead, monthLine } = summaryMarkup(month, day, area);
  document.querySelector('[data-summary-lead]').innerHTML = lead;
  document.querySelector('[data-summary-month]').innerHTML = monthLine;
  document.querySelector('[data-head-day]').textContent = area === 'all' ? dayHeading(month, day) : `${scopeWord(area)} · ${dayHeading(month, day)}`;
  document.querySelector('[data-head-month]').textContent = area === 'all' ? monthSoFar(month) : `${monthSoFar(month)} · Plant total`;

  // Shortcut to the remembered person's own row (phones: row 6 is far down).
  const yours = document.querySelector('[data-your-row]');
  const who = getIdentity(month);
  const mine = who && month.functions.find((f) => f.id === who.functionId);
  yours.hidden = !mine;
  if (mine) {
    // Worst of the row's KPIs, as the summary counts it: a miss on a KPI added in Board setup
    // is a miss for the row, and it is named ("Below goal: First pass yield").
    const offRow = kpiRowsFor(mine).find((k) => dayStatus(month, k, day).status === OFF);
    const st = offRow ? OFF : dayStatus(month, mine, day).status;
    const kpi = offRow ? offRow.kpiDaily : mine.kpiDaily;
    const word = offRow && !offRow.primary ? `${statusWord(OFF, kpi)}: ${plainLabel(kpi)}` : undefined;
    yours.innerHTML = `<a class="your-row-link" href="#fn-${esc(mine.id)}" data-jump="${esc(mine.id)}">Your row: ${esc(mine.name)}</a> ${statusMarkup(st, { tag: 'span', kpi, word })}`;
  }

  // Both pickers (classic and v2 share the top bar): limited to the month's data (a pilot board: first day to today).
  document.querySelectorAll('[data-board-date-input]').forEach((picker) => {
    picker.min = bounds.min;
    picker.max = bounds.max;
    picker.value = isoForDay(month, day);
  });

  if (document.documentElement.dataset.layout === 'v2') renderBoardV2(month, day, area);
  else {
    const list = document.querySelector('[data-rows]');
    const shown = shownFunctions(month, day, area);
    renderOffEmpty(list.closest('.board'), month, day, area, Boolean(month.functions.length) && !shown.length);
    list.replaceChildren(...shown.map((fn) => rowElement(month, fn, day, area)));
    fitClampedText(list, CLASSIC_CLAMPED);
  }
  document.documentElement.dataset.ready = 'true';
}

/**
 * After a save: bring the row into view, put focus on its link, and wash it
 * briefly (color only, so it is safe for reduced motion).
 */
export function revealRow(fnId, { highlight = true } = {}) {
  const row = document.getElementById(`fn-${fnId}`);
  if (!row) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  row.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'instant' });
  row.querySelector('.fn-link')?.focus({ preventScroll: true });
  if (!highlight) return;
  const wash = getComputedStyle(document.documentElement).getPropertyValue('--saved-wash').trim() || '#dff3ed';
  // The solid status blocks keep their color; the wash is on the cells around them.
  row.querySelectorAll('.cell, .v2cell:not(.v2cell--block)').forEach((cell) => {
    const from = getComputedStyle(cell).backgroundColor;
    cell.animate(
      [{ backgroundColor: wash }, { backgroundColor: wash, offset: 0.45 }, { backgroundColor: from }],
      { duration: reduce ? 2400 : 1800, easing: 'ease-out' },
    );
  });
}

/** "Riverside plant" (a name typed as "Riverside Plant" doesn't become "Riverside Plant plant"). */
// A pilot board's plant name is its board name as typed (PILOT-SPEC.md); the demo's reads "<name> plant".
export const plantName = (month) => (month.pilot ? String(month.plant ?? '') : `${String(month.plant ?? '').replace(/\s+plant$/i, '')} plant`);

/* ---------- Board v2 (the client's layout, 10/12) ----------
   One group per function, in meeting order. The function and its owner span
   every KPI row of that function; each KPI row has its goal, the day's status,
   the month so far, a daily trend, the year by month, and Issue / Action. */

let boardCharts = [];

/** "JD" from "Jane Doe". */
const initialsOf = (name) => String(name ?? '').trim().split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/** No real name yet: empty, or Board setup's placeholder "Owner name" (its "ON" read like a status). */
const isPlaceholderOwner = (name) => !String(name ?? '').trim() || String(name).trim().toLowerCase() === 'owner name';

/** Owner photo, or initials when no photo has been added yet; a neutral person glyph until a real name is set (as in Board setup). */
export function avatarMarkup(owner, cls = 'avatar') {
  if (owner.photo) return `<img class="${cls}" src="${esc(owner.photo)}" alt="" width="72" height="72" decoding="async">`;
  if (isPlaceholderOwner(owner.name)) return `<span class="${cls} avatar--none" aria-hidden="true">${icon('user', 'i')}</span>`;
  return `<span class="${cls} avatar--initials" aria-hidden="true">${esc(initialsOf(owner.name))}</span>`;
}

/**
 * The glossary's info button for a measure, when the plant's file defines it. A word joiner
 * (U+2060) glues it to the name's last word, so "Earned hours ⓘ" never leaves the ⓘ on a line alone.
 */
function termFor(month, kpi) {
  const t = glossaryTerm(month, kpi);
  return t ? `\u2060${termButton(t.term, t.definition, t.name)}` : '';
}

/**
 * Under "No production", the block shows a number only when one says something:
 * a weekend's "0 vs 0 goal" or "0 of 0 hours" is the workbook's blank, so the block says just "No production".
 */
const weekendFigure = (actual) => typeof actual === 'number' && actual !== 0;

/**
 * "Goal: ≥ 89 people", "Goal: ≤ 1.13%", "Goal: 0" as markup: the label, then the value as
 * one unbreakable unit (narrow cells put the value on its own line for every KPI);
 * "No goal set" when there's no goal.
 */
function goalLine(kpi, goal, scope = '') {
  const f = formatPair(null, goal, kpi);
  if (f.goal === null) return scope ? `No ${esc(scope)} goal set` : 'No goal set';
  const word = f.useOf && f.word ? `\u00a0${f.word}` : '';
  const sign = goalSign(goal, kpi);
  return `<span class="kpi-goal-label">${scope ? `${esc(scope)} goal:` : 'Goal:'}</span> <span class="kpi-goal-value">${esc(`${sign}${f.goal}${word}`)}</span>`;
}

/** The first day a KPI is tracked: the day it was added in Board setup (or its first number), else day 1. */
function trackedFrom(k) {
  return (k.daily?.plant ?? []).find((r) => !r.beforeStart)?.day ?? null;
}

/**
 * The goal a KPI usually carries on a production day, for days that have none of their own
 * (a weekend, a day before a Board setup KPI starts): the most common one; when it changes
 * every day, the latest one on or before this day.
 */
function usualGoal(month, k, day) {
  const rows = (k.daily?.plant ?? []).filter((r) => !r.beforeStart && typeof r.goal === 'number' && isProductionDay(month, r.day) !== false);
  if (!rows.length) return null;
  const tally = new Map();
  rows.forEach((r) => tally.set(r.goal, (tally.get(r.goal) ?? 0) + 1));
  const most = Math.max(...tally.values());
  const pick = rows.filter((r) => tally.get(r.goal) === most);
  return (pick.filter((r) => r.day <= day).pop() ?? pick[0]).goal;
}

/**
 * A long figure steps its size down so it fits the narrowest block (about 108px):
 * "14,736" stays full size; "1,000,000" and "1,000,000,000" step down (css/board-v2.css).
 */
const figureStep = (s) => (s.length > 13 ? ' block-figure--xs'
  : s.length > 11 ? ' block-figure--s'
    : s.length > 9 ? ' block-figure--m'
      : s.length > 7 ? ' block-figure--l' : '');

/**
 * The solid status block: word + glyph, the measure when it differs, the number big, then "of 89 people".
 * Long states take short words: "No production", and before a Board setup KPI starts,
 * "Tracked from Fri, Feb 20" with nothing under it (the goal is in the KPI cell).
 */
function blockMarkup(o) {
  const f = formatPair(o.actual, o.goal, o.kpi);
  const label = `<p class="v2-label">${esc(o.label)}</p>`;
  if (o.status === NOT_TRACKED) {
    const word = o.word ?? (o.from ? `Tracked from ${o.from.replace(/ /g, '\u00a0')}` : undefined);
    return `${label}${statusMarkup(o.status, { kpi: o.kpi, extra: 'block-status', word })}`;
  }
  let body = '';
  if (o.show && f.actual !== null) {
    body = `<p class="block-figure${figureStep(f.actual)}">${esc(f.actual)}</p>${f.rest ? `<p class="block-rest">${esc(f.rest)}</p>` : ''}`;
  } else if (o.show) {
    body = `<p class="block-rest">${esc(f.rest)}</p>`;
  }
  const word = o.status === NO_PRODUCTION ? 'No production' : o.word;
  return `${label}${statusMarkup(o.status, { kpi: o.kpi, extra: 'block-status', word })}${body}${o.measure ?? ''}${o.extra ?? ''}`;
}

/** "Mon, Mar 2" for a due date (it can fall in the next month). */
const DUE = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
export const dueText = (iso) => {
  const d = iso ? new Date(`${iso}T00:00:00Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? `Due\u00a0${DUE.format(d).replace(/ /g, '\u00a0')}` : 'No due date';
};

/** "Met goal 13 of 20 days" for the board (the KPI is already named in its row). */
function captionFor(month, k, day, { html = false } = {}) {
  const r = trackRecord(month, k, day);
  if (r.days === 0) {
    const start = trackedFrom(k);
    return start && start > day ? `Tracked from ${formatDayMedium(month, start)}` : 'No production days yet';
  }
  const met = `Met goal ${r.met} of ${r.days} ${r.days === 1 ? 'day' : 'days'}`;
  let rest = '';
  if (r.notEntered) rest += `, ${r.notEntered} not entered`;
  if (r.noGoal) rest += `, ${noGoalDays(r.noGoal)}`;
  const lower = k.kpiDaily.better === 'lower';
  if (!html) return `${met}${rest}${lower ? ' · lower is better' : ''}`;
  // "Met goal 13" and "of 20 days" each stay whole: one line wherever it fits, and where it can't (Large
  // text in a narrow chart column) the break falls between them, never past the cell's edge. "lower is
  // better" moves as one unit. On a 1080p TV and a short laptop the goal's ≤ already says it, so that part drops away.
  const metHtml = `<span class="nowrap">Met goal ${r.met}</span> <span class="nowrap">of ${r.days} ${r.days === 1 ? 'day' : 'days'}</span>`;
  return `${metHtml}${rest}${lower ? '<span class="cap-lower">\u00a0· <span class="nowrap">lower is better</span></span>' : ''}`;
}

/** Chart text: 11px at the least on laptops and phones (10px was too small to read), following Customize's Large text (11.9px); 12px on a 1080p TV. */
const chartFont = () => (matchMedia('(min-width: 1800px) and (max-height: 1200px)').matches
  ? 12
  : Math.max(11, Math.round((parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) * 0.625 * 10) / 10));

/** Has this KPI any numbers this month? A new one shows a plain "no numbers yet" instead of empty charts. */
const hasNumbers = (k) => (k.daily?.plant ?? []).some((r) => typeof r.actual === 'number');

/** One set of words for a KPI's action, on every screen (board, Detail, meeting, minutes, register, home). */
export const ACTION_WORD = {
  needs: 'Needs an action',
  none: 'None needed',
  nothing: 'Nothing recorded',
  notYet: 'No action yet',
};

/** Did anyone record this KPI for this day (notes saved, or a number entered on a KPI added in Board setup)? */
export function recordedOn(k, day) {
  const n = notesFor(k, day);
  if (n.source === 'workbook') return true;
  const hasNumber = typeof (k.daily?.plant ?? []).find((r) => r.day === day)?.actual === 'number';
  // An entry someone emptied and saved is not a record: it needs a number or words.
  if (n.source !== null) return hasNumber || [n.problem, n.action].some((t) => typeof t === 'string' && t.trim() !== '');
  return Boolean(k.custom) && hasNumber;
}

/** A note's real words: its paragraphs other than "No new issues to report" (null when there are none). */
export const realWords = (t) => noteParagraphs(t).filter((p) => !NO_ISSUE.test(p)).join('\n') || null;

/**
 * THE response rule: one function decides whether a KPI has an action, for the DOR board (one day), the
 * Weekly review's scoreboard, its readiness, Finish review and the weekly meeting (the week's days
 * through the day it looks from). A KPI has an action for those days when, on one of them:
 *   - its owner wrote what happens in the next 24 hours on the daily board (words other than
 *     "No new issues to report"), or
 *   - the Action register has an action that counts that day (open, or verified that day or later;
 *     a cancelled one never counts: cancelling doesn't resolve the issue).
 * A verified fix answers only while it holds: when the KPI is off goal on a day after the day it was
 * verified (through the last day looked at), it stops counting and is listed in `lapsed` ("Verified
 * Tue, Feb 24 · missed 3 days since"). So a week whose action was verified on Tuesday, then missed
 * Wednesday to Friday, needs an action, as the DOR board says on Friday.
 * days: board days (numbers).
 * -> { has, note: { day, text } | null (the latest written), assigned, lapsed: [{ a, verifiedIso, missed }] }
 */
export function responseFor(month, fn, k, days) {
  const list = (days ?? []).filter((d) => Number.isInteger(d)).sort((a, b) => a - b);
  let note = null;
  for (const d of list) {
    const words = realWords(notesFor(k, d).action);
    if (words) note = { day: d, text: words };
  }
  const kpiId = k.primary ? null : k.kpiId;
  const counted = actionsForDays(fn.id, kpiId, list.map((d) => isoForDay(month, d)));
  const lapsed = lapsedFixes(month, fn, k, list);
  const assigned = counted.filter((a) => !lapsed.some((x) => x.a.id === a.id));
  return { has: Boolean(note) || assigned.length > 0, note, assigned, lapsed };
}

/**
 * Verified actions for a KPI whose fix didn't hold: verified on or after the first day looked at (a
 * single day looks back over the 6 days before it) and before the last, with off-goal days since.
 * -> [{ a, verifiedIso, missed }] newest verification first.
 */
function lapsedFixes(month, fn, k, list) {
  if (!list.length) return [];
  const last = list[list.length - 1];
  const lastIso = isoForDay(month, last);
  const fromIso = list.length > 1 ? isoForDay(month, list[0])
    : new Date(Date.parse(`${lastIso}T00:00:00Z`) - 6 * 864e5).toISOString().slice(0, 10);
  const out = [];
  for (const a of verifiedBetween(fn.id, k.primary ? null : k.kpiId, fromIso, lastIso)) {
    let missed = 0;
    for (let d = 1; d <= last; d += 1) {
      if (isoForDay(month, d) > a.closedDayIso && dayStatus(month, k, d).status === OFF) missed += 1;
    }
    if (missed) out.push({ a, verifiedIso: a.closedDayIso, missed });
  }
  return out;
}

/** "Verified Tue, Feb 24 · missed 3 days since": a fix that didn't hold, in the board's words. */
export function lapsedWords(x) {
  const d = new Date(`${x.verifiedIso}T00:00:00Z`);
  const when = Number.isNaN(d.getTime()) ? x.verifiedIso
    : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `Verified ${when} · missed ${x.missed} ${x.missed === 1 ? 'day' : 'days'} since`;
}

/**
 * The daily board's own words for a function across some days (the Weekly review's commentary starts
 * from them): the latest issue and the latest next-24-hours action written, each with its day. Read only.
 * -> [{ day, issue, action }] newest first (one entry per day that has either), at most two days.
 */
export function dailyWords(month, fn, days) {
  const rows = kpiRowsFor(fn);
  const named = rows.length > 1;
  const latest = { issue: null, action: null };
  const list = (days ?? []).filter((d) => Number.isInteger(d)).sort((a, b) => b - a);
  for (const kind of ['issue', 'action']) {
    for (const d of list) {
      const parts = rows.map((k) => {
        const n = notesFor(k, d);
        const words = realWords(kind === 'issue' ? n.problem : n.action);
        return words ? `${named ? `${plainLabel(k.kpiDaily)}: ` : ''}${words}` : null;
      }).filter(Boolean);
      if (parts.length) { latest[kind] = { day: d, text: parts.join('\n') }; break; }
    }
  }
  const byDay = new Map();
  for (const kind of ['issue', 'action']) {
    const x = latest[kind];
    if (!x) continue;
    if (!byDay.has(x.day)) byDay.set(x.day, { day: x.day, issue: null, action: null });
    byDay.get(x.day)[kind] = x.text;
  }
  return [...byDay.values()].sort((a, b) => b.day - a.day);
}

/**
 * The action state for one KPI row on a day, the same on every screen.
 * state: 'has' (a note, or Action register actions that count that day), 'needs' (off goal, nothing to fix it yet),
 *        'none' (not off goal), 'nothing' (nothing recorded for this KPI that day).
 * assigned: the register's actions for that day, open ones first, then verified ones
 * (verified that day or later: show them as "Verified: …"); open and done are the same
 * two lists apart. Cancelled actions never count (cancelling doesn't resolve the issue).
 * -> { state, word, text, assigned, open, done, off, monthOnly, y, mo }
 */
export function actionStateFor(month, fn, k, day) {
  const y = dayStatus(month, k, day);
  const mo = monthStatus(month, k, day);
  const n = notesFor(k, day);
  // Actions belong to days: added for this day or before, and still open or closed this day or later.
  const response = responseFor(month, fn, k, [day]);
  const assigned = response.assigned;
  const open = assigned.filter(isOpenAction);
  const done = assigned.filter(isVerifiedAction);
  const text = typeof n.action === 'string' && n.action.trim() ? n.action.replace(/\n\s*\n/g, '\n') : null;
  const dayOff = y.status === OFF;
  const monthOff = mo.status === OFF;
  const off = dayOff || monthOff;
  let state;
  // One rule with the Weekly review (responseFor). Words that only say "No new issues to report" show
  // as written on a row that's on track, but they don't answer for a miss.
  if (response.has || (text && !off)) state = 'has';
  // A verified fix that didn't hold (off goal again since) needs a new action whether or not anything was
  // written on the board that day: the miss itself is the news, so it's never "Nothing recorded".
  else if (off && response.lapsed.length) state = 'needs';
  else if (!recordedOn(k, day)) state = 'nothing';
  else if (off) state = 'needs';
  else state = 'none';
  const word = state === 'needs' ? ACTION_WORD.needs : state === 'none' ? ACTION_WORD.none : state === 'nothing' ? ACTION_WORD.nothing : '';
  return { state, word, text, assigned, open, done, off, monthOnly: monthOff && !dayOff, y, mo, lapsed: response.lapsed };
}

/** "Operations (On-time delivery, this month)": names the KPI when a function has several, and a month-only miss. */
export function needsLabel(fn, k, monthOnly) {
  const parts = [];
  if (kpiRowsFor(fn).length > 1) parts.push(plainLabel(k.kpiDaily));
  if (monthOnly) parts.push('this month');
  return `${fn.name}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

/**
 * Off-goal KPIs that still need an action that day, and the one line that says so.
 * The all-clear ("Every off-goal KPI has an action and an owner.") only when
 * every off-goal KPI row has an action: one that is off goal with nothing
 * recorded that day keeps it away.
 */
export function needsSummary(month, day) {
  const list = [];
  let covered = 0;   // off goal, with an action
  let unrecorded = 0; // off goal, nothing recorded that day
  for (const fn of month.functions) {
    for (const k of kpiRowsFor(fn)) {
      const st = actionStateFor(month, fn, k, day);
      if (!st.off) continue;
      if (st.state === 'has') covered += 1;
      else if (st.state === 'nothing') unrecorded += 1;
      else if (st.state === 'needs') list.push({ fn, k, monthOnly: st.monthOnly, label: needsLabel(fn, k, st.monthOnly) });
    }
  }
  const allClear = !list.length && !unrecorded && covered > 0;
  const lead = list.length
    ? (list.length === 1 ? '1 off-goal KPI has no action yet:' : `${list.length} off-goal KPIs have no action yet:`)
    : allClear ? 'Every off-goal KPI has an action and an owner.' : '';
  return { list, lead, allClear, text: list.length ? `${lead} ${list.map((x) => x.label).join(', ')}.` : lead };
}

function actionCell(month, fn, k, day, st, undo) {
  const addLabel = plainLabel(st.monthOnly ? k.kpiMonthly : k.kpiDaily);
  const owner = (a) => esc(a.owner || ownerFor(fn).name);
  // " · Verified Fri, Feb 27" after a verified action's owner (the board day it was closed on), as an
  // open one reads " · Due Mon, Mar 2"; the register and the minutes use the same words.
  const closedOn = (iso) => (typeof iso === 'string' && iso.startsWith(`${month.month}-`)
    ? ` · Verified\u00a0${esc(formatDayMedium(month, Number(iso.slice(8, 10))).replace(/ /g, '\u00a0'))}`
    : '');
  const items = st.assigned.slice(0, 2).map((a) => (isVerifiedAction(a)
    // Verified that day or later: it was this KPI's action that day, and it's closed.
    ? `
    <li class="v2-assigned v2-assigned--done">
      <span class="v2-assigned-text">${statusMarkup(ON, { tag: 'span', word: 'Verified:', extra: 'v2-done' })} ${esc(a.text)}</span>
      <span class="v2-assigned-meta">${owner(a)}${closedOn(a.closedDayIso)}</span>
    </li>`
    : `
    <li class="v2-assigned">
      <span class="v2-assigned-text">${esc(a.text)}</span>
      <span class="v2-assigned-meta">${owner(a)} · ${isCompletedAction(a) ? 'Completed, awaiting verification' : esc(dueText(a.due))}${isEscalatedAction(a) ? ' · Escalated' : ''}</span>
    </li>`)).join('');
  const more = st.assigned.length > 2 ? `<p class="v2-more">${st.assigned.length - 2} more in the Action register</p>` : '';
  const needs = st.state === 'needs';
  const add = `<button class="btn ${needs ? 'btn--primary' : 'btn--text'} v2-add" type="button" data-add-action="${esc(fn.id)}" data-add-kpi="${esc(k.primary ? '' : k.kpiId)}">Add action<span class="sr-only"> for ${esc(addLabel)}</span></button>`;
  let body;
  if (st.state === 'has') {
    body = `${st.text ? `<p class="v2-note">${esc(st.text)}</p>` : ''}${items ? `<ul class="v2-assigned-list">${items}</ul>` : ''}${more}${add}`;
  } else if (needs) {
    // "Needs an action" and its Add action button share a line where they fit (it wraps under when narrow).
    body = `<div class="v2-needs-row"><p class="v2-needs">${statusMarkup(OFF, { tag: 'span', word: ACTION_WORD.needs })}</p>${add}</div>${lapsedMarkup(st.lapsed)}`;
  } else {
    body = `<p class="v2-note is-empty">${esc(st.word)}</p>`;
  }
  // "Entered by" sits on the KPI row the entry changed (an added KPI's own row when only it was filled in).
  return `${body}${enteredByMarkup(k, day, { undo })}`;
}

/** A verified fix that didn't hold, under "Needs an action": "Verified Tue, Feb 24 · missed 3 days since: …". */
export function lapsedMarkup(lapsed) {
  if (!lapsed?.length) return '';
  const x = lapsed[0];
  return `<p class="v2-lapsed"><span class="v2-lapsed-when">${esc(lapsedWords(x))}:</span> ${esc(x.a.text)}</p>`;
}

/**
 * A note as the board's clamped cells show it: blank lines folded, and one period dropped at
 * the end of each line, so a line cut by the clamp reads "repaired…", not "repaired.…".
 * The stored text and Detail's full text keep every period.
 */
export const clampedNote = (t) => t.replace(/\n\s*\n/g, '\n').replace(/(?<!\.)\.(?=\n|$)/g, '');

/** The red line under an Issue that should say what went wrong. */
export const ISSUE_GAP_WORD = 'Off goal: issue not written yet';

/**
 * Off goal (for the day or the month), something was recorded that day, and no issue is
 * written (empty, or only "No new issues to report" / "No issue reported"). "Nothing recorded"
 * days are never flagged. `k` is the KPI row (kpiRowsFor); null means the function's own KPI.
 * One rule for the board, Detail, the meeting and the home.
 */
export function issueGap(month, fn, k, day) {
  const row = k ?? fn;
  if (!recordedOn(row, day) || hasProblem(notesFor(row, day))) return false;
  return dayStatus(month, row, day).status === OFF || monthStatus(month, row, day).status === OFF;
}

function issueCell(month, fn, k, day) {
  // A miss with no issue written says only that, in red with the off glyph. The owner's text
  // is empty or "No new issues to report" by definition, which would contradict the red line.
  if (issueGap(month, fn, k, day)) return statusMarkup(OFF, { tag: 'p', word: ISSUE_GAP_WORD, extra: 'v2-gap' });
  const n = notesFor(k, day);
  const problemStatus = n.status ? problemStatusMarkup(k, day, 'problem-status v2-pstatus') : '';
  if (n.source === null) return `<p class="v2-note is-empty">${recordedOn(k, day) ? 'No issue reported' : ACTION_WORD.nothing}</p>`;
  if (!hasProblem(n)) return `<p class="v2-note is-empty">${esc(n.problem ? clampedNote(n.problem) : 'No issue reported')}</p>`;
  return `<p class="v2-note">${esc(clampedNote(n.problem))}</p>${problemStatus}`;
}

function kpiRowMarkup(month, fn, k, day, { undo = false, area = 'all' } = {}) {
  const y = dayStatus(month, k, day);
  // The Status block and the KPI's goal follow the Area filter; the month, trend and year stay plant totals.
  const scoped = area !== 'all';
  const ys = scoped ? scopedDayStatus(month, k, day, area) : y;
  const sRow = scopedRow(k, area);
  const plantTag = scoped ? ' · Plant total' : '';
  const mo = monthStatus(month, k, day);
  const sameMeasure = plainLabel(k.kpiMonthly) === plainLabel(k.kpiDaily);
  // "as of" and "Fri, Feb 20" each stay whole; the line breaks between them only in a very narrow block.
  const monthNote = mo.asOfDay && mo.asOfDay !== day ? `as\u00a0of ${formatDayMedium(month, mo.asOfDay).replace(/ /g, '\u00a0')}` : '';
  // Many workbook rows judge the month by a different measure (People: Clocked in today, Total direct labor this month).
  const monthName = !sameMeasure && mo.asOfDay !== null ? measureMarkup(month, k.kpiMonthly, '', 'span', 'block-measure-name') : '';
  // A weekend's "as of Fri, Feb 20" is its own line under the measure (css/board-v2.css), so a long
  // measure never pushes the date past the block's edges. From 1240 up it shows once, in the
  // column head, and stays here for screen readers.
  const asOf = monthNote ? `<span class="block-asof">${esc(monthNote)}</span>` : '';
  const monthMeasure = monthName || asOf ? `<p class="block-measure">${monthName}${asOf}</p>` : '';
  const st = actionStateFor(month, fn, k, day);
  st.needs = st.state === 'needs';
  // A KPI with no numbers yet, or one added in Board setup seen before its first day: one plain line
  // in each chart cell instead of empty axes.
  const start = trackedFrom(k);
  const early = start !== null && start > day;
  const numbers = hasNumbers(k);
  const fresh = !numbers || early;
  // The month's first days can all be weekends (Sun, Feb 1): nothing to plot yet, so the trend says so
  // in words. The year still shows the months before this one.
  const plotted = (k.daily?.plant ?? []).some((r) => r.day <= day && !r.beforeStart && isProductionDay(month, r.day) !== false);
  const label = plainLabel(k.kpiDaily);
  // Weekends and days before a Board setup KPI starts have no goal of their own: the KPI's usual one
  // (a weekend with no usual goal shows none; the block already says "No production").
  const gs = sRow ? ys : y; // a KPI with no area numbers keeps its plant goal, named so
  const ownGoal = gs.status !== NO_PRODUCTION && gs.status !== NOT_TRACKED;
  const goalShown = ownGoal ? gs.goal : usualGoal(month, sRow ?? k, day);
  const goalScope = !scoped ? '' : sRow ? scopeWord(area) : 'Plant total';
  const goal = gs.status === NO_PRODUCTION && goalShown === null ? '' : goalLine(k.kpiDaily, goalShown, goalScope);
  const from = start !== null ? formatDayMedium(month, start) : null;
  // Before an added KPI's first day nothing can be entered for it yet: no entry link.
  const first = numbers || early ? '' : ` <button class="btn--text v2-first" type="button" data-enter-kpi="${esc(fn.id)}" data-enter-kpi-id="${esc(k.primary ? '' : k.kpiId)}">Enter the first one</button>`;
  // Days before an added KPI starts: its Issue and Action say so, plainly, as its blocks do.
  const untracked = y.status === NOT_TRACKED ? `<p class="v2-note is-empty">${esc(statusWord(NOT_TRACKED))}</p>` : '';
  const trend = fresh || !plotted
    ? `<div class="v2cell v2cell--trend v2cell--fresh"><p class="v2-label">Daily trend${plantTag}</p><p class="mini-empty">${fresh ? `No numbers yet${first ? `.${first}` : ''}` : esc(captionFor(month, k, day))}</p></div>`
    : `<div class="v2cell v2cell--trend">
        <p class="v2-label">Daily trend${plantTag}</p>
        <div class="mini" data-mini="daily"></div>
        <p class="mini-caption">${captionFor(month, k, day, { html: true })}</p>
      </div>`;
  const ytd = fresh
    ? `<div class="v2cell v2cell--ytd v2cell--fresh"><p class="v2-label">Year to date${plantTag}</p><p class="mini-empty">${numbers ? 'No monthly results yet' : 'Shows once a month has numbers'}</p></div>`
    : `<div class="v2cell v2cell--ytd">
        <p class="v2-label">Year to date${plantTag}</p>
        <div class="mini" data-mini="ytd"></div>
        <p class="mini-caption" data-ytd-caption></p>
      </div>`;
  const charts = `${trend}
      ${ytd}`;
  return `
    <div class="kpirow${st.needs ? ' kpirow--needs' : ''}" data-kpi="${esc(k.id)}">
      <div class="v2cell v2cell--kpi">
        <p class="v2-label">Measure</p>
        <p class="kpi-name"><a class="kpi-link" href="${detailHref(month, k.id, day)}" data-open-detail="${esc(k.id)}" aria-label="${esc(label)}, details"><span class="kpi-link-text">${esc(label)}</span></a>${termFor(month, k.kpiDaily)}</p>
        ${goal ? `<p class="kpi-goal">${goal}</p>` : ''}
      </div>
      <div class="v2cell v2cell--block v2cell--status" data-status="${ys.status}"${scoped ? ` data-area-scope="${esc(area)}"` : ''}>
        ${blockMarkup({ label: scoped ? `${scopeWord(area)} · ${dayHeading(month, day)}` : dayHeading(month, day), status: ys.status, word: ys.word, actual: ys.actual, goal: ys.goal, kpi: k.kpiDaily, show: ys.status !== NO_PRODUCTION || weekendFigure(ys.actual), from })}
      </div>
      <div class="v2cell v2cell--block v2cell--mtd" data-status="${mo.status}">
        ${blockMarkup({ label: `${monthSoFar(month)}${plantTag}`, status: mo.status, actual: mo.actual, goal: mo.goal, kpi: k.kpiMonthly, show: mo.asOfDay !== null, measure: monthMeasure, from })}
      </div>
      ${charts}
      <div class="v2cell v2cell--issue">
        <p class="v2-label">Issue</p>
        ${untracked || issueCell(month, fn, k, day)}
      </div>
      <div class="v2cell v2cell--action${st.needs ? ' v2cell--needs' : ''}">
        <p class="v2-label"><span class="v2-label-long">Action, next 24\u00a0hours</span><span class="v2-label-short" aria-hidden="true">Next 24\u00a0hours</span></p>
        ${untracked || actionCell(month, fn, k, day, { ...st, text: st.text && clampedNote(st.text) }, undo)}
      </div>
    </div>`;
}

function mountRowCharts(month, k, day, rowEl) {
  if (!rowEl.querySelector('[data-mini]')) return;
  const isProd = (d) => isProductionDay(month, d);
  const phrase = (f) => (f.actual === null ? `Not entered. ${f.rest}` : `${f.actual}${f.rest ? ` ${f.rest}` : ', no goal set'}`);
  const statusOf = (r) => compareToGoal(r.actual, r.goal, k.kpiDaily.better);
  const short = formatMonthShort(month);
  // Charts take the height their cell gives them (shorter on a 1080p TV).
  const hostH = (el) => Math.round(el?.getBoundingClientRect().height) || 88;
  const dailyHost = rowEl.querySelector('[data-mini="daily"]');
  // No production day yet this month (Sun, Feb 1): the trend cell says so in words, and only the year draws.
  if (dailyHost) boardCharts.push(trendChart(dailyHost, {
    height: hostH(dailyHost),
    fitHeight: true, // a TV row that grows to fill the screen gives its chart the room
    series: dailySeries(k),
    day,
    isProductionDay: isProd,
    statusOf,
    kpi: k.kpiDaily,
    focusable: false,
    compact: true,
    fontSize: chartFont(),
    firstLabel: (d) => `${short} ${d}`,
    firstLabelShort: (d) => String(d),
    lastLabel: (d) => `${short} ${d}`,
    label: `${plainLabel(k.kpiDaily)}, each production day of ${formatMonthName(month)} through ${formatDayMedium(month, day)}, against the daily goal. ${captionFor(month, k, day)}.`,
    describe: (r) => ({ value: phrase(formatPair(r.actual, r.goal, k.kpiDaily)), meta: formatDayMedium(month, r.day), status: statusOf(r) }),
  }));

  // The current month uses the same month-to-date row as the month block, so the two never disagree.
  // Before the month's first production day there is no result yet: the file's monthly row is the
  // month's end snapshot, so it never stands in for "so far".
  const mo = monthStatus(month, k, day);
  const monthIndex = Number(month.month.slice(5, 7)) - 1;
  const yearRows = (k.monthly ?? []).map((r, i) => {
    if (i !== monthIndex) return r;
    return mo.asOfDay !== null ? { ...r, actual: mo.actual, goal: mo.goal, soFar: true } : { ...r, actual: null, soFar: true };
  });
  const mtdStatus = (r) => compareToGoal(r.actual, r.goal, k.kpiMonthly.better);
  const monthName = (r) => r.month.charAt(0) + r.month.slice(1).toLowerCase();
  const done = yearRows.filter((r) => typeof r.actual === 'number');
  // Judged against a goal only where the month has one; the rest are named, as the daily caption does.
  const judged = done.filter((r) => typeof r.goal === 'number');
  const met = judged.filter((r) => mtdStatus(r) === ON).length;
  const noGoal = done.length - judged.length;
  const noGoalText = noGoal ? `${noGoal} ${noGoal === 1 ? 'month' : 'months'} had no goal set` : '';
  const record = judged.length ? `met goal ${met} of ${judged.length}` : '';
  const host = rowEl.querySelector('[data-mini="ytd"]');
  const caption = rowEl.querySelector('[data-ytd-caption]');
  if (!host) return;
  if (!yearRows.length || !done.length) {
    // One plain line, not an empty chart over a caption that says the same.
    host.outerHTML = '<p class="mini-empty">No monthly results yet</p>';
    caption?.remove();
    return;
  }
  // The year is judged by the month measure: name it, since it can differ from the row's daily KPI.
  if (caption) {
    // Full on desks; short on a 1080p TV and a short laptop (the month block already names the measure).
    // Under 1340 the short laptop's column can't hold "By month · met goal 2 of 2" on one line, and the
    // J F A J O axis already says "by month": just "Met goal 2 of 2" there (css/board-v2.css, cap-tiny).
    const tail = [record && `<span class="nowrap">${record}</span>`, esc(noGoalText)].filter(Boolean).join(', ');
    const tiny = [record && `<span class="nowrap">M${record.slice(1)}</span>`, esc(noGoalText)].filter(Boolean).join(', ');
    caption.innerHTML = `<span class="cap-full">${esc(plainLabel(k.kpiMonthly))} by month: ${tail}</span><span class="cap-short">By month\u00a0· ${tail}</span><span class="cap-tiny">${tiny}</span>`;
  }
  boardCharts.push(yearChart(host, {
    monthly: yearRows,
    kpi: k.kpiMonthly,
    currentIndex: monthIndex,
    statusOf: mtdStatus,
    focusable: false,
    height: hostH(host),
    fitHeight: true,
    fontSize: chartFont(),
    left: Math.round(chartFont() * 3.4),
    top: 10,
    right: 4,
    compact: true,
    label: `${plainLabel(k.kpiMonthly)} by month this year against the monthly goal: ${[record && `${record} months so far`, noGoalText].filter(Boolean).join(', ')}.`,
    describe: (r) => {
      const f = formatPair(r.actual, r.goal, k.kpiMonthly);
      return {
        value: f.actual === null ? `No results yet. ${f.rest}` : phrase(f),
        meta: `${monthName(r)}${r.soFar ? `, through ${formatDayMedium(month, day)}` : ''}`,
        status: f.actual === null ? null : mtdStatus(r),
      };
    },
  }));
}

function groupElement(month, fn, day, area = 'all') {
  const kpis = kpiRowsFor(fn);
  const owner = ownerFor(fn);
  // After a save, Undo rides on the first "Entered by" line the save put on this function's rows.
  const saved = undoable && undoable.fnId === fn.id && undoable.day === day;
  const undoRow = saved ? kpis.find((k) => { const info = entryInfo(k, day); return info?.enteredBy && info.changed !== false; }) : null;
  const li = document.createElement('li');
  li.className = 'fgroup';
  li.id = `fn-${fn.id}`;
  li.dataset.fn = fn.id;
  li.style.setProperty('--kpis', String(kpis.length));
  const iconName = DEPT_ICON[fn.id] ?? 'board';
  li.innerHTML = `
    <div class="v2cell v2cell--fn">
      <span class="fn-icon" aria-hidden="true">${icon(iconName, 'i')}</span>
      <div class="fn-text">
        <h2 class="fn-name"><a class="fn-link" href="${detailHref(month, fn.id, day)}" data-open-detail="${esc(fn.id)}">${esc(fn.name)}</a></h2>
        ${fn.dorQuestion ? `<p class="fn-question" title="${esc(fn.dorQuestion)}">${esc(fn.dorQuestion)}</p>` : ''}
        <p class="fn-owner-inline">${avatarMarkup(owner, 'avatar avatar--sm')}<span><span class="sr-only">Owner: </span>${esc(owner.name)}</span></p>
      </div>
    </div>
    <div class="v2cell v2cell--owner">
      ${avatarMarkup(owner)}
      <p class="owner-name"><span class="sr-only">Owner: </span>${esc(owner.name)}</p>
    </div>
    ${kpis.map((k) => kpiRowMarkup(month, fn, k, day, { undo: k === undoRow, area })).join('')}`;
  return li;
}

/** One-line notes under the summary: days the workbook kept no notes for, then what still needs an action (or the all-clear). */
function boardNotes(month, day, area = 'all') {
  // No functions on the board: the one way back, under the line that says so.
  if (!month.functions.length) return '<p class="board-note board-note--empty"><button class="btn btn--primary" type="button" data-open-setup>Open Board setup</button></p>';
  const out = [];
  if (getOffOnly()) {
    const n = shownFunctions(month, day, area).length;
    if (n) out.push(`<p class="board-note board-note--filter">${esc(offOnlyLabel(month, day))}: showing the ${n} of ${month.functions.length} functions with a KPI off goal that day. <button class="board-note-link" type="button" data-off-only-clear>Show all</button></p>`);
  }
  const wbDay = Number(month.boardDate.slice(8, 10));
  const anyNotes = month.functions.some((fn) => kpiRowsFor(fn).some((k) => recordedOn(k, day)));
  if (!cloud.BOARD && !anyNotes && day !== wbDay) {
    out.push(`<p class="board-note">The plant's workbook kept issues and actions for ${esc(formatDayMedium(month, wbDay))} only. <a href="${pageHref(month, wbDay, { view: 'dor' })}" data-go-day="${wbDay}">Go to ${esc(formatDayMedium(month, wbDay))}</a></p>`);
  }
  const sum = needsSummary(month, day);
  // data-needs-kpi: the KPI row, so a click can land on that row's Add action (js/app.js).
  const link = (x) => `<a href="#fn-${esc(x.fn.id)}" data-jump="${esc(x.fn.id)}" data-needs-kpi="${esc(x.k.id)}">${esc(x.label)}</a>`;
  if (sum.list.length) {
    // Each name links to its row, where Add action is. When Customize hides Issue and action the
    // rows have no Add action to land on: the line names the KPIs and opens the Action register
    // instead. Both forms are drawn; css/board-v2.css shows the one that fits the setting.
    const rows = `<span class="needs-rows">${sum.list.map(link).join(', ')}.</span>`;
    const register = `<span class="needs-register">${sum.list.map((x) => esc(x.label)).join(', ')}. <button class="board-note-link" type="button" data-open-actions>Open the Action register</button></span>`;
    out.push(`<p class="board-note board-note--needs">${statusMarkup(OFF, { tag: 'span', word: sum.lead })} ${rows}${register}</p>`);
  } else if (sum.allClear) {
    out.push(`<p class="board-note board-note--clear">${statusMarkup(ON, { tag: 'span', word: sum.lead })}</p>`);
  }
  return out.join('');
}

function renderBoardV2(month, day, area = 'all') {
  boardCharts.forEach((c) => c.destroy());
  boardCharts = [];
  // With an area picked the Status column is that area's day, and every other number column says it's the plant's.
  // The scope is its own line in the column head, in the head's full ink (css/shell.css).
  const plantTag = area === 'all' ? '' : '<span class="h2c-scope">Plant total</span>';
  document.querySelectorAll('[data-head-day2]').forEach((n) => {
    n.innerHTML = `${esc(formatDayMedium(month, day))}${area === 'all' ? '' : `<span class="h2c-scope">${esc(scopeWord(area))}</span>`}`;
  });
  document.querySelectorAll('[data-head-ytd2]').forEach((n) => { n.innerHTML = area === 'all' ? 'Jan &ndash; Dec vs goal' : `Jan &ndash; Dec vs goal${plantTag}`; });
  // On a weekend the month blocks run to the last production day. Wherever the column heads show (1240
  // and up: laptops, desks, a TV) it's said once, here ("Month to date / as of Fri, Feb 20"), instead of on
  // every row; narrower, each block says it.
  const asOfDay = lastProductionDay(month, day);
  const headAsOf = asOfDay && asOfDay !== day
    ? `<span class="h2c-asof">as of ${esc(formatDayMedium(month, asOfDay)).replace(/ /g, '\u00a0')}</span>`
    : '';
  document.querySelectorAll('[data-head-month2]').forEach((n) => {
    n.innerHTML = `<span class="h2c-month">${esc(formatMonthName(month))}</span>${headAsOf}${plantTag}`;
  });
  // "Feb 1 – 27"; on the 1st just "Feb 1" (not "Feb 1 – 1").
  document.querySelectorAll('[data-head-trend]').forEach((n) => { n.innerHTML = `${esc(day > 1 ? `${formatMonthShort(month)} 1 – ${day}` : `${formatMonthShort(month)} 1`)}${plantTag}`; });
  const notes = document.querySelector('[data-board-notes]');
  if (notes) notes.innerHTML = boardNotes(month, day, area);
  const list = document.querySelector('[data-rows2]');
  // Off goal only: just the functions off goal that day (the summary above still counts all of them).
  const shown = shownFunctions(month, day, area);
  // No functions: the column heads and the empty list go (css/board-v2.css); the strip under them stays.
  list.closest('.board2')?.toggleAttribute('data-empty', !month.functions.length);
  list.closest('.board2')?.toggleAttribute('data-filter-empty', Boolean(month.functions.length) && !shown.length);
  renderOffEmpty(list.closest('.board2'), month, day, area, Boolean(month.functions.length) && !shown.length);
  const groups = shown.map((fn) => groupElement(month, fn, day, area));
  list.replaceChildren(...groups);
  groups.forEach((li, gi) => {
    const fn = shown[gi];
    kpiRowsFor(fn).forEach((k, ki) => mountRowCharts(month, k, day, li.querySelectorAll('.kpirow')[ki]));
  });
  fitKpiNames(list);
  fitOwnerNames(list);
  fitClampedText(list);
  watchHead();
  const last = latestEntry(month);
  document.querySelectorAll('[data-last-updated]').forEach((n) => {
    n.textContent = last ? `Last entry: ${last.by}, ${formatEnteredAt(last.at)}`
      : cloud.BOARD ? 'No numbers entered yet.' : `Numbers from the plant workbook, through ${formatDayMedium(month, Number(month.boardDate.slice(8, 10)))}`;
  });
}

/** Off goal only with nothing off goal: one honest line where the rows would be, and the way back. */
function renderOffEmpty(host, month, day, area, show) {
  if (!host) return;
  let box = host.querySelector(':scope > [data-off-empty]');
  if (!show) { box?.remove(); return; }
  if (!box) {
    box = document.createElement('div');
    box.className = 'off-empty';
    box.dataset.offEmpty = '';
    box.setAttribute('role', 'status');
    host.prepend(box);
  }
  const t = offOnlyEmptyText(month, day, area);
  box.innerHTML = `${t.lead.startsWith('All') ? statusMarkup(ON, { tag: 'p', word: t.lead, extra: 'off-empty-lead' }) : `<p class="off-empty-lead">${esc(t.lead)}</p>`}${t.rest ? `<p class="off-empty-rest">${esc(t.rest)}</p>` : ''}<p class="off-empty-tools"><button class="btn btn--secondary" type="button" data-off-only-clear>Show all functions</button></p>`;
}

/* ---------- Focus never lands under the sticky column heads ---------- */

let headWatch = null;
/**
 * The column heads stick to the top of the window (1240 and up), so a control reached with
 * Shift+Tab could sit right under them. The page's scroll-padding-top (css/board-v2.css) keeps
 * the heads' height, plus 8px, clear of focus. That height changes with the width, Large text
 * and the TV pass, so it's measured here and kept current (0 where the heads are hidden).
 * A function or KPI link draws its focus ring on its whole cell (or KPI row), so each link's
 * offset inside that cell is measured too: its scroll-margin-top keeps the cell's ring clear.
 */
function watchHead() {
  const head = document.querySelector('.board2-head');
  if (!head) return;
  const offset = (link, cell) => {
    if (!link || !cell) return 0;
    return Math.max(0, Math.ceil(link.getBoundingClientRect().top - cell.getBoundingClientRect().top));
  };
  const write = () => {
    const fnLink = document.querySelector('[data-rows2] .v2cell--fn .fn-link');
    const kpiLink = document.querySelector('[data-rows2] .kpirow .kpi-link');
    // All reads, then all writes.
    const vals = {
      '--board2-head-h': Math.ceil(head.getBoundingClientRect().height),
      '--fn-link-off': offset(fnLink, fnLink?.closest('.v2cell--fn')),
      '--kpi-link-off': offset(kpiLink, kpiLink?.closest('.kpirow')),
    };
    for (const [k, v] of Object.entries(vals)) document.documentElement.style.setProperty(k, `${v}px`);
  };
  write();
  if (headWatch || typeof ResizeObserver === 'undefined') return;
  headWatch = new ResizeObserver(write);
  headWatch.observe(head);
}

/* ---------- Clamped cells end on a clean "…" ---------- */

const CLAMPED = ':is(.v2-note, .v2-assigned-text, .fn-question)';
/** The classic ledger's Problem and Next 24 hours (`?layout=classic`). */
const CLASSIC_CLAMPED = '.note-text';
const ELLIPSIS = '…';
/** Drop what shouldn't sit before the "…": spaces, a trailing . , ; : and a dangling dash ("fthts -…"). */
const cleanEnd = (s) => s.replace(/[\s.,;:!?\-\u2013\u2014]+$/u, '');

/**
 * A line clamp puts its "…" right after the last character that fits, so a clamp that lands
 * after a period reads "employee.…" (four dots on screen) and one inside a word reads "floo…".
 * After each render (and a resize), every clamped element that overflows gets its last text cut
 * at a word, trailing . , ; : dropped, and one "…". A label before the text ("Issue:", "Problem")
 * stays as it is; only the element's last text node is cut. Screen readers still get the full text.
 * One layout to find the cuts, then a check or two; the stored text and Detail keep every period.
 * `selector` picks the clamped elements (the DOR board's cells by default; the classic board, the
 * meetings and the Weekly review pass their own).
 */
export function fitClampedText(scope = document, selector = CLAMPED) {
  if (!scope) return;
  const els = [...scope.querySelectorAll(selector)];
  // Back to the full text first: a wider window can give it room again.
  els.forEach(unclamp);
  const overflows = (el) => el.scrollHeight > el.clientHeight + 1;
  // The text to cut is the element's last child; anything before it (a label) is kept whole.
  const over = els.filter((el) => el.lastChild?.nodeType === Node.TEXT_NODE && el.lastChild.data.trim() && el.clientHeight > 0 && overflows(el));
  if (!over.length) return;

  // Where each clamp cuts: the last character on a line that shows. Reads only, so one layout.
  const range = document.createRange();
  const jobs = over.map((el) => {
    const node = el.lastChild;
    const text = node.data;
    const box = el.getBoundingClientRect();
    const bottom = box.top + el.clientTop + el.clientHeight;
    // A character's line box (collapsed spaces have none: use the next one that does).
    const lineMid = (i) => {
      for (let j = i; j < text.length; j += 1) {
        range.setStart(node, j);
        range.setEnd(node, j + 1);
        const rects = range.getClientRects();
        if (rects.length) { const r = rects[rects.length - 1]; return r.top + r.height / 2; }
      }
      return Infinity;
    };
    // The label alone fills the clamp: leave the clamp's own ellipsis.
    if (lineMid(0) > bottom) return null;
    let lo = 0;
    let hi = text.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineMid(mid) <= bottom) lo = mid; else hi = mid - 1;
    }
    return { el, node, text, shown: text.slice(0, lo + 1) };
  }).filter(Boolean);

  // Try the shown text with "…"; if that spills, drop a word and try again (a few rounds at most).
  const write = (job, body) => {
    const span = document.createElement('span');
    span.setAttribute('aria-hidden', 'true');
    span.dataset.clampPart = '';
    span.textContent = `${body}${ELLIPSIS}`;
    const full = document.createElement('span');
    full.className = 'sr-only';
    full.dataset.clampPart = '';
    full.textContent = job.text;
    job.el.querySelectorAll(':scope > [data-clamp-part]').forEach((n) => n.remove());
    if (job.node.isConnected) job.node.remove();
    job.el.dataset.full = job.text;
    job.el.append(span, full);
  };
  let pending = jobs;
  for (let round = 0; round < 4 && pending.length; round += 1) {
    pending = pending.filter((job) => {
      const body = cleanEnd(job.shown);
      if (!body.trim()) {
        // Nothing left to cut at a word: the clamp's own ellipsis stays.
        unclamp(job.el);
        return false;
      }
      write(job, body);
      // Next round (if this spills): one word fewer.
      job.shown = body.replace(/\s*\S+$/u, '');
      return true;
    });
    pending = pending.filter((job) => overflows(job.el));
  }
  // Still spilling after a few words (very long words): the clamp's own ellipsis, never two.
  pending.forEach((job) => unclamp(job.el));
}

/** Put a clamped element's full last text back (fitClampedText). */
function unclamp(el) {
  if (el.dataset.full === undefined) return;
  el.querySelectorAll(':scope > [data-clamp-part]').forEach((n) => n.remove());
  el.append(document.createTextNode(el.dataset.full));
  delete el.dataset.full;
}

/* ---------- A long KPI name stops at three lines ---------- */

const KPI_NAME_LINES = 3;
/** How many lines an inline element takes (one client rect per line it runs over). */
const lineCount = (el) => new Set([...el.getClientRects()].map((r) => Math.round(r.top))).size;

/**
 * A KPI named in Board setup can be 80 characters, seven lines in a 1280 KPI column. The board
 * shows at most three, cut at a word with one "…" (a single word too long for that, at a
 * character); the ⓘ stays glued to the last word shown. The link's aria-label keeps the whole
 * name for screen readers and its title shows it on hover. After each render and a resize.
 */
export function fitKpiNames(scope = document) {
  if (!scope) return;
  const spans = [...scope.querySelectorAll('.kpi-name .kpi-link-text')];
  // Back to the whole name first: a wider window can give it room again.
  for (const sp of spans) {
    if (sp.dataset.full === undefined) continue;
    sp.textContent = sp.dataset.full;
    delete sp.dataset.full;
    sp.closest('.kpi-link')?.removeAttribute('title');
  }
  const over = spans.filter((sp) => lineCount(sp) > KPI_NAME_LINES);
  for (const sp of over) {
    const full = sp.textContent;
    const show = (len) => { sp.textContent = `${cleanEnd(full.slice(0, len))}${ELLIPSIS}`; };
    // The longest cut (from an ascending list) that keeps three lines, or null.
    const longest = (cuts) => {
      let lo = 0;
      let hi = cuts.length - 1;
      let best = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        show(cuts[mid]);
        if (lineCount(sp) <= KPI_NAME_LINES) { best = cuts[mid]; lo = mid + 1; } else hi = mid - 1;
      }
      return best;
    };
    const atWords = [...full.matchAll(/\s+/gu)].map((m) => m.index).filter((i) => i > 0);
    const cut = longest(atWords) ?? longest(Array.from({ length: Math.max(0, full.length - 1) }, (_, i) => i + 1));
    if (cut === null) { sp.textContent = full; continue; }
    show(cut);
    sp.dataset.full = full;
    sp.closest('.kpi-link')?.setAttribute('title', full);
  }
}

/* ---------- An owner's name keeps whole words ---------- */

const OWNER_STEPS = ['owner-name--s', 'owner-name--xs'];
const SHY = '\u00ad';
/**
 * Break points for a word too wide for its column even at the smallest step: soft hyphens with three
 * letters kept on each side ("Papadopou-" / "los", never "Papadopoulo" / "s"). Spelled out, since
 * browsers don't hyphenate capitalized words, and names are.
 */
const hyphenate = (w) => {
  const ch = [...w];
  return ch.length < 7 ? w : `${ch.slice(0, 3).join('')}${ch.slice(3, -3).map((c) => `${SHY}${c}`).join('')}${SHY}${ch.slice(-3).join('')}`;
};

/**
 * The owner column is 96px on laptops (72px for the name, 77px with Large text): real names fit whole
 * ("Doe"), but a long one broke mid-word ("Christophe / r / Richardson"). A name whose longest word
 * is wider than its box steps down one size, then a second (css/board-v2.css); only a word still too
 * wide at the smallest step ("Papadopoulos") breaks, at a hyphen. Measured with words held whole, so a
 * word that doesn't fit makes a line wider than the box. After each render and a resize; a write and a
 * read per step, no loop. Screen readers skip the soft hyphens.
 */
export function fitOwnerNames(scope = document) {
  if (!scope) return;
  const els = [...scope.querySelectorAll('.v2cell--owner .owner-name')];
  if (!els.length) return;
  for (const el of els) {
    // Back to the name as typed first: a wider window can give it room again.
    if (el.dataset.full !== undefined && el.lastChild?.nodeType === Node.TEXT_NODE) el.lastChild.data = el.dataset.full;
    delete el.dataset.full;
    el.classList.remove(...OWNER_STEPS, 'owner-name--break');
    el.classList.add('owner-name--measure');
  }
  const range = document.createRange();
  // The name is the text after the screen-reader "Owner: ". Layout works in 1/64px steps: a word
  // 0.02px too wide still breaks.
  const nameOf = (el) => (el.lastChild?.nodeType === Node.TEXT_NODE ? el.lastChild : null);
  const widest = (node, from, to) => {
    range.setStart(node, from);
    range.setEnd(node, to);
    return Math.max(0, ...[...range.getClientRects()].map((r) => r.width));
  };
  const tooWide = (el) => {
    const box = el.getBoundingClientRect().width;
    const name = nameOf(el);
    if (!box || !name) return false; // hidden (phones fold the owner into the function)
    return widest(name, 0, name.length) > box + 0.01;
  };
  let over = els.filter(tooWide);
  for (const step of OWNER_STEPS) {
    if (!over.length) break;
    for (const el of over) { el.classList.remove(...OWNER_STEPS); el.classList.add(step); }
    over = over.filter(tooWide);
  }
  // Still too wide: only the words that don't fit get break points (reads, then writes).
  const breaks = over.map((el) => {
    const name = nameOf(el);
    const box = el.getBoundingClientRect().width;
    const wide = new Set([...name.data.matchAll(/\S+/gu)].filter((m) => widest(name, m.index, m.index + m[0].length) > box + 0.01).map((m) => m.index));
    return { el, name, text: name.data.replace(/\S+/gu, (w, i) => (wide.has(i) ? hyphenate(w) : w)) };
  });
  for (const { el, name, text } of breaks) {
    el.dataset.full = name.data;
    name.data = text;
    el.classList.add('owner-name--break');
  }
  for (const el of els) el.classList.remove('owner-name--measure');
}

let textFitTimer = 0;
if (typeof window !== 'undefined') {
  const refit = () => {
    clearTimeout(textFitTimer);
    textFitTimer = setTimeout(() => {
      const rows = document.querySelector('[data-rows2]');
      fitKpiNames(rows);
      fitOwnerNames(rows);
      fitClampedText(rows);
      fitClampedText(document.querySelector('[data-rows]'), CLASSIC_CLAMPED);
    }, 150);
  };
  window.addEventListener('resize', refit);
  // The first render can run before the fonts arrive; the cuts follow the real line breaks.
  document.fonts?.addEventListener?.('loadingdone', refit);
}

/** The most recent entry made in the app, for the footer. */
function latestEntry(month) {
  let best = null;
  for (const fn of month.functions) {
    for (const info of Object.values(fn.entries ?? {})) {
      if (info?.enteredAt && (!best || info.enteredAt > best.at)) best = { at: info.enteredAt, by: info.enteredBy };
    }
  }
  return best;
}
