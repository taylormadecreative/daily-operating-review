// Board (home): the summary sentence and the eight functions in meeting order.

import { dailySeries, isoForDay, notesFor, entryInfo, hasProblem, kpiRowsFor, ownerFor } from './store.js?v=20261012-235706';
import {
  ON, OFF, NO_PRODUCTION,
  dayStatus, monthStatus, trackRecord, boardSummary, isProductionDay, compareToGoal, statusWord,
} from './status.js?v=20261012-235706';
import {
  formatPair, plainLabel, glossaryTerm, formatDayLong, formatDayMedium, formatMonthName, formatMonthShort,
  dayHeading, daySentence, monthSoFar, formatEnteredAt, lowerNote, formatValue,
} from './format.js?v=20261012-235706';
import { trendChart, yearChart } from './charts.js?v=20261012-235706';
import { actionsFor } from './actions.js?v=20261012-235706';
import { icon, DEPT_ICON } from './icons.js?v=20261012-235706';
import { renderSparkline } from './sparkline.js?v=20261012-235706';
import { getIdentity } from './identity.js?v=20261012-235706';
import { esc, statusMarkup, termButton, issueStatusMarkup } from './ui.js?v=20261012-235706';
import { pageHref } from './shell.js?v=20261012-235706';

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
    body = `${esc(label.slice(0, cut + 1))}<span class="nowrap">${esc(label.slice(cut + 1))} ${termButton(t.term, t.definition)}</span>`;
  }
  return `<${tag} class="${cls}">${body}${note ? `<span class="measure-note">${esc(note)}</span>` : ''}</${tag}>`;
}

/** "Parts produced: met goal 0 of 20 days" (+ " · lower is better"). */
export function recordText(month, fn, day) {
  const r = trackRecord(month, fn, day);
  const label = plainLabel(fn.kpiDaily);
  if (r.days === 0) return `${label}: no production days yet`;
  let text = `${label}: met goal ${r.met} of ${r.days} days`;
  if (r.notEntered) text += `, ${r.notEntered} not entered`;
  if (r.noGoal) text += `, ${r.noGoal} with no goal`;
  return text + lowerNote(fn.kpiDaily);
}

/** Problem and action text for a day, with plain empty states. */
export function notesText(month, fn, day) {
  const n = notesFor(fn, day);
  if (n.source === null) {
    return {
      problem: { text: 'Not recorded for this day', empty: true },
      action: { text: 'Not recorded for this day', empty: true },
    };
  }
  const flat = (t) => t.replace(/\n\s*\n/g, '\n');
  return {
    problem: n.problem ? { text: flat(n.problem), empty: false } : { text: 'No problem reported', empty: true },
    action: n.action ? { text: flat(n.action), empty: false } : { text: 'No action entered', empty: true },
  };
}

/** "Status: In progress" under a problem (Detail, Meeting); nothing when there is no problem. */
export function problemStatusMarkup(fn, day, cls = 'problem-status') {
  const n = notesFor(fn, day);
  if (!hasProblem(n)) return '';
  return `<p class="${cls}"><span class="problem-status-label">Status:</span>${n.status ? issueStatusMarkup(n.status) : '<span class="ist ist--unset"><span class="ist-dot" aria-hidden="true"></span>Not set</span>'}</p>`;
}

/** "Entered by Jeff VanSickle · 6:41 AM" (the dot stays with the time). */
export function enteredByMarkup(fn, day, { undo = false } = {}) {
  const info = entryInfo(fn, day);
  if (!info?.enteredBy) return '';
  const when = formatEnteredAt(info.enteredAt);
  // The time and Undo stay together on one line.
  return `<p class="entered-by">Entered by ${esc(info.enteredBy)} <span class="nowrap">${when ? `· ${esc(when)}` : ''}`
    + `${undo ? ` <button class="btn--text undo-link" type="button" data-undo-save>Undo</button>` : ''}</span></p>`;
}

export function detailHref(month, fnId, day) {
  // DOR board links keep the board view, the day and the area when opened in a new tab.
  return pageHref(month, day, { view: 'dor', hash: fnId });
}

/* ---------- Undo on the saved row ---------- */

let undoable = null; // { fnId, day } of the last save, until the next save or a reload
export const setUndoable = (v) => { undoable = v; };
export const getUndoable = () => undoable;

/* ---------- Rows ---------- */

function rowElement(month, fn, day) {
  const y = dayStatus(month, fn, day);
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
      <p class="cell-label">${esc(dayHeading(month, day))}</p>
      ${statusMarkup(y.status, { kpi: fn.kpiDaily })}
      ${showDayFigure ? figureMarkup(y.actual, y.goal, fn.kpiDaily) + measureMarkup(month, fn.kpiDaily) : ''}
    </div>
    <div class="cell cell--month" data-status="${mo.status}">
      <p class="cell-label">${esc(monthSoFar(month))}</p>
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

export function summaryParts(month, day) {
  const s = boardSummary(month, day);
  const y = s.yesterday;
  const count = s.productionDay === false
    ? `No production was scheduled ${daySentence(month, day, 'on')}.`
    : `${y[ON]} of ${y.total} on track ${daySentence(month, day)}.`;
  return { s, count };
}

function summaryMarkup(month, day) {
  const { s, count } = summaryParts(month, day);
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

/** Render the whole board for a day. */
export function renderBoard(month, day) {
  const label = document.querySelector('[data-board-date]');
  label.textContent = formatDayLong(month, day);
  label.setAttribute('datetime', isoForDay(month, day));
  document.querySelector('[data-prev]').disabled = day <= 1;
  document.querySelector('[data-next]').disabled = day >= month.daysInMonth;
  document.querySelectorAll('[data-plant]').forEach((n) => { n.textContent = `${plantName(month)}\u00a0·\u00a0LinkedXL OS`; });

  const { lead, monthLine } = summaryMarkup(month, day);
  document.querySelector('[data-summary-lead]').innerHTML = lead;
  document.querySelector('[data-summary-month]').innerHTML = monthLine;
  document.querySelector('[data-head-day]').textContent = dayHeading(month, day);
  document.querySelector('[data-head-month]').textContent = monthSoFar(month);

  // Shortcut to the remembered person's own row (phones: row 6 is far down).
  const yours = document.querySelector('[data-your-row]');
  const who = getIdentity(month);
  const mine = who && month.functions.find((f) => f.id === who.functionId);
  yours.hidden = !mine;
  if (mine) {
    const st = dayStatus(month, mine, day).status;
    yours.innerHTML = `<a class="your-row-link" href="#fn-${esc(mine.id)}" data-jump="${esc(mine.id)}">Your row: ${esc(mine.name)}</a> ${statusMarkup(st, { tag: 'span', kpi: mine.kpiDaily })}`;
  }

  // Both pickers (classic and v2 share the top bar): limited to the month's data.
  document.querySelectorAll('[data-board-date-input]').forEach((picker) => {
    picker.min = isoForDay(month, 1);
    picker.max = isoForDay(month, month.daysInMonth);
    picker.value = isoForDay(month, day);
  });

  if (document.documentElement.dataset.layout === 'v2') renderBoardV2(month, day);
  else {
    const list = document.querySelector('[data-rows]');
    list.replaceChildren(...month.functions.map((fn) => rowElement(month, fn, day)));
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

/** "Conneaut plant" (a name typed as "Riverside Plant" doesn't become "Riverside Plant plant"). */
export const plantName = (month) => `${String(month.plant ?? '').replace(/\s+plant$/i, '')} plant`;

/* ---------- Board v2 (the client's layout, 10/12) ----------
   One group per function, in meeting order. The function and its owner span
   every KPI row of that function; each KPI row has its goal, the day's status,
   the month so far, a daily trend, the year by month, and Issue / Action. */

let boardCharts = [];

/** "JD" from "Jane Doe". */
const initialsOf = (name) => String(name ?? '').trim().split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/** Owner photo, or initials when no photo has been added yet. */
export function avatarMarkup(owner, cls = 'avatar') {
  if (owner.photo) return `<img class="${cls}" src="${esc(owner.photo)}" alt="" width="72" height="72" decoding="async">`;
  return `<span class="${cls} avatar--initials" aria-hidden="true">${esc(initialsOf(owner.name))}</span>`;
}

/** The glossary's info button for a measure, when the plant's file defines it. */
function termFor(month, kpi) {
  const t = glossaryTerm(month, kpi);
  return t ? ` ${termButton(t.term, t.definition)}` : '';
}

/** "Goal: ≥ 89 people", "Goal: ≤ 1.13%", "Goal: 0", or plain words when there's no goal. */
function goalLine(kpi, goal, status) {
  if (status === NO_PRODUCTION) return 'No production scheduled';
  const f = formatPair(null, goal, kpi);
  if (f.goal === null) return 'No goal set';
  const word = f.useOf && f.word ? ` ${f.word}` : '';
  if (kpi.better === 'lower') return goal === 0 ? `Goal: ${f.goal}${word}` : `Goal: ≤ ${f.goal}${word}`;
  return `Goal: ≥ ${f.goal}${word}`;
}

/** The solid status block: word + glyph, the measure when it differs, the number big, then "of 89 people". */
function blockMarkup(o) {
  const f = formatPair(o.actual, o.goal, o.kpi);
  let body = '';
  if (o.show && f.actual !== null) {
    body = `<p class="block-figure">${esc(f.actual)}</p>${f.rest ? `<p class="block-rest">${esc(f.rest)}</p>` : ''}`;
  } else if (o.show) {
    body = `<p class="block-rest">${esc(f.rest)}</p>`;
  }
  return `<p class="v2-label">${esc(o.label)}</p>${statusMarkup(o.status, { kpi: o.kpi, extra: 'block-status' })}${o.measure ?? ''}${body}${o.extra ?? ''}`;
}

/** "Mon, Mar 2" for a due date (it can fall in the next month). */
const DUE = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
export const dueText = (iso) => {
  const d = iso ? new Date(`${iso}T00:00:00Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? `due ${DUE.format(d).replace(/ /g, ' ')}` : 'no due date';
};

/** "Met goal 13 of 20 days" for the board (the KPI is already named in its row). */
function captionFor(month, k, day) {
  const r = trackRecord(month, k, day);
  if (r.days === 0) return 'No production days yet';
  let text = `Met goal ${r.met} of ${r.days} days`;
  if (r.notEntered) text += `, ${r.notEntered} not entered`;
  if (r.noGoal) text += `, ${r.noGoal} with no goal`;
  return text + lowerNote(k.kpiDaily);
}

/** Has this KPI any numbers this month? A new one shows a plain "no numbers yet" instead of empty charts. */
const hasNumbers = (k) => (k.daily?.plant ?? []).some((r) => typeof r.actual === 'number');

/** What the Action cell says, and whether this KPI still needs an action. */
function actionState(month, fn, k, day, y, mo) {
  const n = notesFor(k, day);
  const assigned = actionsFor(fn.id, k.primary ? null : k.kpiId);
  const text = typeof n.action === 'string' && n.action.trim() ? n.action.replace(/\n\s*\n/g, '\n') : null;
  const off = y.status === OFF || mo.status === OFF;
  return { text, assigned, needs: off && !text && !assigned.length, off };
}

function actionCell(month, fn, k, day, st, undo) {
  const items = st.assigned.slice(0, 2).map((a) => `
    <li class="v2-assigned">
      <span class="v2-assigned-text">${esc(a.text)}</span>
      <span class="v2-assigned-meta">${esc(a.owner || ownerFor(fn).name)} · ${esc(dueText(a.due))}</span>
    </li>`).join('');
  const more = st.assigned.length > 2 ? `<p class="v2-more">${st.assigned.length - 2} more in the Action register</p>` : '';
  let body;
  if (st.text || st.assigned.length) {
    body = `${st.text ? `<p class="v2-note">${esc(st.text)}</p>` : ''}${items ? `<ul class="v2-assigned-list">${items}</ul>` : ''}${more}`;
  } else if (st.needs) {
    body = `<p class="v2-needs">${statusMarkup(OFF, { tag: 'span', word: 'Needs an action' })}</p>`;
  } else {
    body = `<p class="v2-note is-empty">${st.off ? 'No action yet' : 'None needed'}</p>`;
  }
  const add = `<button class="btn ${st.needs ? 'btn--primary' : 'btn--text'} v2-add" type="button" data-add-action="${esc(fn.id)}" data-add-kpi="${esc(k.primary ? '' : k.kpiId)}">Add action<span class="sr-only"> for ${esc(plainLabel(k.kpiDaily))}</span></button>`;
  return `${body}${st.needs || st.text || st.assigned.length ? add : ''}${k.primary ? enteredByMarkup(fn, day, { undo }) : ''}`;
}

function issueCell(month, k, day) {
  const n = notesFor(k, day);
  const problemStatus = n.status ? problemStatusMarkup(k, day, 'problem-status v2-pstatus') : '';
  if (n.source === null) return '<p class="v2-note is-empty">Nothing recorded</p>';
  if (!hasProblem(n)) return `<p class="v2-note is-empty">${esc(n.problem ? n.problem.replace(/\n\s*\n/g, '\n') : 'No problem reported')}</p>`;
  return `<p class="v2-note">${esc(n.problem.replace(/\n\s*\n/g, '\n'))}</p>${problemStatus}`;
}

function kpiRowMarkup(month, fn, k, day) {
  const y = dayStatus(month, k, day);
  const mo = monthStatus(month, k, day);
  const undo = undoable && undoable.fnId === fn.id && undoable.day === day && k.primary;
  const sameMeasure = plainLabel(k.kpiMonthly) === plainLabel(k.kpiDaily);
  const monthNote = mo.asOfDay && mo.asOfDay !== day ? `as of ${formatDayMedium(month, mo.asOfDay)}` : '';
  // Many workbook rows judge the month by a different measure (People: Clocked in today, Total direct labor this month).
  const monthMeasure = !sameMeasure && mo.asOfDay !== null ? measureMarkup(month, k.kpiMonthly, '', 'p', 'block-measure') : '';
  const st = actionState(month, fn, k, day, y, mo);
  const fresh = !hasNumbers(k);
  const label = plainLabel(k.kpiDaily);
  const charts = fresh
    ? `<div class="v2cell v2cell--trend v2cell--fresh"><p class="v2-label">Daily trend</p><p class="mini-empty">No numbers yet. <button class="btn--text v2-first" type="button" data-enter-kpi="${esc(fn.id)}" data-enter-kpi-id="${esc(k.primary ? '' : k.kpiId)}">Enter the first one</button></p></div>
       <div class="v2cell v2cell--ytd v2cell--fresh"><p class="v2-label">Year to date</p><p class="mini-empty">Starts with the first month's numbers</p></div>`
    : `<div class="v2cell v2cell--trend">
        <p class="v2-label">Daily trend</p>
        <div class="mini" data-mini="daily"></div>
        <p class="mini-caption">${esc(captionFor(month, k, day))}</p>
      </div>
      <div class="v2cell v2cell--ytd">
        <p class="v2-label">Year to date</p>
        <div class="mini" data-mini="ytd"></div>
        <p class="mini-caption" data-ytd-caption></p>
      </div>`;
  return `
    <div class="kpirow${st.needs ? ' kpirow--needs' : ''}" data-kpi="${esc(k.id)}">
      <div class="v2cell v2cell--kpi">
        <p class="v2-label">KPI</p>
        <p class="kpi-name"><a class="kpi-link" href="${detailHref(month, k.id, day)}" data-open-detail="${esc(k.id)}">${esc(label)}<span class="sr-only">, details</span></a>${termFor(month, k.kpiDaily)}</p>
        <p class="kpi-goal">${esc(goalLine(k.kpiDaily, y.goal, y.status))}</p>
      </div>
      <div class="v2cell v2cell--block v2cell--status" data-status="${y.status}">
        ${blockMarkup({ label: dayHeading(month, day), status: y.status, actual: y.actual, goal: y.goal, kpi: k.kpiDaily, show: !(y.status === NO_PRODUCTION && y.actual === null) })}
      </div>
      <div class="v2cell v2cell--block v2cell--mtd" data-status="${mo.status}">
        ${blockMarkup({ label: monthSoFar(month), status: mo.status, actual: mo.actual, goal: mo.goal, kpi: k.kpiMonthly, show: mo.asOfDay !== null, measure: monthMeasure, extra: monthNote ? `<p class="block-measure">${esc(monthNote)}</p>` : '' })}
      </div>
      ${charts}
      <div class="v2cell v2cell--issue">
        <p class="v2-label">Issue</p>
        ${issueCell(month, k, day)}
      </div>
      <div class="v2cell v2cell--action${st.needs ? ' v2cell--needs' : ''}">
        <p class="v2-label">Action, next 24 hours</p>
        ${actionCell(month, fn, k, day, st, undo)}
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
  boardCharts.push(trendChart(dailyHost, {
    height: hostH(dailyHost),
    series: dailySeries(k),
    day,
    isProductionDay: isProd,
    statusOf,
    kpi: k.kpiDaily,
    focusable: false,
    compact: true,
    firstLabel: (d) => `${short} ${d}`,
    lastLabel: (d) => `${short} ${d}`,
    label: `${plainLabel(k.kpiDaily)}, each production day of ${formatMonthName(month)} through ${formatDayMedium(month, day)}, against the daily goal. ${captionFor(month, k, day)}.`,
    describe: (r) => ({ value: phrase(formatPair(r.actual, r.goal, k.kpiDaily)), meta: formatDayMedium(month, r.day), status: statusOf(r) }),
  }));

  // The current month uses the same month-to-date row as the month block, so the two never disagree.
  const mo = monthStatus(month, k, day);
  const monthIndex = Number(month.month.slice(5, 7)) - 1;
  const yearRows = (k.monthly ?? []).map((r, i) => (i === monthIndex && mo.asOfDay !== null
    ? { ...r, actual: mo.actual, goal: mo.goal, soFar: true }
    : r));
  const mtdStatus = (r) => compareToGoal(r.actual, r.goal, k.kpiMonthly.better);
  const monthName = (r) => r.month.charAt(0) + r.month.slice(1).toLowerCase();
  const done = yearRows.filter((r) => typeof r.actual === 'number');
  const met = done.filter((r) => mtdStatus(r) === ON).length;
  const host = rowEl.querySelector('[data-mini="ytd"]');
  const caption = rowEl.querySelector('[data-ytd-caption]');
  // The year is judged by the month measure: name it, since it can differ from the row's daily KPI.
  if (caption) caption.textContent = `${plainLabel(k.kpiMonthly)} by month${done.length ? `: met goal ${met} of ${done.length}` : ''}`;
  if (!yearRows.length || !done.length) {
    host.outerHTML = '<p class="mini-empty">No monthly results yet</p>';
    return;
  }
  boardCharts.push(yearChart(host, {
    monthly: yearRows,
    kpi: k.kpiMonthly,
    currentIndex: monthIndex,
    statusOf: mtdStatus,
    focusable: false,
    height: hostH(host),
    fontSize: 10,
    left: 34,
    top: 10,
    right: 4,
    compact: true,
    label: `${plainLabel(k.kpiMonthly)} by month this year against the monthly goal: met goal ${met} of ${done.length} months so far.`,
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

function groupElement(month, fn, day) {
  const kpis = kpiRowsFor(fn);
  const owner = ownerFor(fn);
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
        ${fn.dorQuestion ? `<p class="fn-question">${esc(fn.dorQuestion)}</p>` : ''}
        <p class="fn-owner-inline" aria-hidden="true">${avatarMarkup(owner, 'avatar avatar--sm')}<span>${esc(owner.name)}</span></p>
      </div>
    </div>
    <div class="v2cell v2cell--owner">
      ${avatarMarkup(owner)}
      <p class="owner-name"><span class="sr-only">Owner: </span>${esc(owner.name)}</p>
    </div>
    ${kpis.map((k) => kpiRowMarkup(month, fn, k, day)).join('')}`;
  return li;
}

/** One-line notes under the summary: KPIs that are off goal with no action, and days the workbook kept no notes for. */
function boardNotes(month, day) {
  const needs = [];
  for (const fn of month.functions) {
    for (const k of kpiRowsFor(fn)) {
      const st = actionState(month, fn, k, day, dayStatus(month, k, day), monthStatus(month, k, day));
      if (st.needs) needs.push({ fn, k });
    }
  }
  const link = ({ fn, k }) => `<a href="#fn-${esc(fn.id)}" data-jump="${esc(fn.id)}">${esc(fn.name)}${k.primary ? '' : ` (${esc(plainLabel(k.kpiDaily))})`}</a>`;
  const out = [];
  if (needs.length) {
    out.push(`<p class="board-note board-note--needs">${statusMarkup(OFF, { tag: 'span', word: needs.length === 1 ? '1 off-goal KPI has no action yet:' : `${needs.length} off-goal KPIs have no action yet:` })} ${needs.map(link).join(', ')}.</p>`);
  }
  const wbDay = Number(month.boardDate.slice(8, 10));
  const anyNotes = month.functions.some((fn) => kpiRowsFor(fn).some((k) => notesFor(k, day).source !== null));
  if (!anyNotes && day !== wbDay) {
    out.push(`<p class="board-note">The plant's workbook kept issues and actions for ${esc(formatDayMedium(month, wbDay))} only. <a href="${pageHref(month, wbDay, { view: 'dor' })}" data-go-day="${wbDay}">Go to ${esc(formatDayMedium(month, wbDay))}</a></p>`);
  }
  return out.join('');
}

function renderBoardV2(month, day) {
  boardCharts.forEach((c) => c.destroy());
  boardCharts = [];
  document.querySelectorAll('[data-head-day2]').forEach((n) => { n.textContent = formatDayMedium(month, day); });
  document.querySelectorAll('[data-head-month2]').forEach((n) => { n.textContent = formatMonthName(month); });
  document.querySelectorAll('[data-head-trend]').forEach((n) => { n.textContent = `${formatMonthShort(month)} 1 – ${day}`; });
  const notes = document.querySelector('[data-board-notes]');
  if (notes) notes.innerHTML = boardNotes(month, day);
  const list = document.querySelector('[data-rows2]');
  const groups = month.functions.map((fn) => groupElement(month, fn, day));
  list.replaceChildren(...groups);
  groups.forEach((li, gi) => {
    const fn = month.functions[gi];
    kpiRowsFor(fn).forEach((k, ki) => mountRowCharts(month, k, day, li.querySelectorAll('.kpirow')[ki]));
  });
  const last = latestEntry(month);
  document.querySelectorAll('[data-last-updated]').forEach((n) => {
    n.textContent = last ? `Last entry: ${last.by}, ${formatEnteredAt(last.at)}` : `Numbers from the plant workbook, through ${formatDayMedium(month, Number(month.boardDate.slice(8, 10)))}`;
  });
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
