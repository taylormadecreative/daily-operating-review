// Board (home): the summary sentence and the eight functions in meeting order.

import { dailySeries, isoForDay, notesFor, entryInfo, hasProblem } from './store.js';
import {
  ON, NO_PRODUCTION,
  dayStatus, monthStatus, trackRecord, boardSummary, isProductionDay, compareToGoal, statusWord,
} from './status.js';
import {
  formatPair, plainLabel, glossaryTerm, formatDayLong, formatDayMedium, formatMonthName,
  dayHeading, daySentence, monthSoFar, formatEnteredAt, lowerNote,
} from './format.js';
import { renderSparkline } from './sparkline.js';
import { getIdentity } from './identity.js';
import { esc, statusMarkup, termButton, issueStatusMarkup } from './ui.js';
import { pageHref } from './shell.js';

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
  return `<p class="entered-by">Entered by ${esc(info.enteredBy)}${when ? ` <span class="nowrap">· ${esc(when)}</span>` : ''}`
    + `${undo ? ` <button class="btn--text undo-link" type="button" data-undo-save>Undo</button>` : ''}</p>`;
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
  document.querySelectorAll('[data-plant]').forEach((n) => { n.textContent = `${month.plant} plant\u00a0·\u00a0LinkedXL OS`; });

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

  const list = document.querySelector('[data-rows]');
  list.replaceChildren(...month.functions.map((fn) => rowElement(month, fn, day)));
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
  row.querySelectorAll('.cell').forEach((cell) => {
    const from = getComputedStyle(cell).backgroundColor;
    cell.animate(
      [{ backgroundColor: wash }, { backgroundColor: wash, offset: 0.45 }, { backgroundColor: from }],
      { duration: reduce ? 2400 : 1800, easing: 'ease-out' },
    );
  });
}
