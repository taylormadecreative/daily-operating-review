// Function detail: a right-side sheet over the board (full screen on phone).
// <dialog> + showModal gives the dimmed, inert background and Esc; focus is
// moved in JS because autofocus is ignored here.

import { dailySeries, leadingIndicatorsFor, kpiRowById, isoForDay, notesFor, hasProblem } from './store.js?v=20261013-151156';
import { dayStatus, monthStatus, isProductionDay, compareToGoal, ON, OFF, NO_PRODUCTION, NOT_TRACKED } from './status.js?v=20261013-151156';
import {
  formatPair, plainLabel, formatDayMedium, formatMonthShort, monthSoFar,
  dayHeading, weekday, formatMonthName, lowerNote,
} from './format.js?v=20261013-151156';
import {
  measureMarkup, enteredByMarkup, recordText, problemStatusMarkup, notesText, actionStateFor, ACTION_WORD, issueGap, ISSUE_GAP_WORD,
} from './board.js?v=20261013-151156';
import { esc, statusMarkup, glyphMarkup, issueStatusMarkup } from './ui.js?v=20261013-151156';
import { barChart, lineChart, yearChart, dataTable } from './charts.js?v=20261013-151156';
import { actionsFor, openActions } from './actions.js?v=20261013-151156';

const AREAS = ['mold', 'bond', 'prime', 'compounding'];

let dialog;
let handlers;
let charts = [];
let current = null; // { fnId, day, parentId, kpiId, added, month }
let opener = null;  // { el, id, cls }: the link or button that opened the sheet

let closeAsked = false; // handlers.onClose already ran for this opening
// Edit closes this sheet for Enter numbers. When Cancel brings the same sheet
// back, focus lands on the Edit button that was used, and the sheet keeps the
// element that first opened it (Esc still goes back there).
let pendingEdit = null; // { fnId, day, which: 'head' | 'issue', opener }
let pendingTimer = 0;

/** Ask the app to close the sheet (it updates the URL, then calls closeDetail), once per opening. */
function requestClose() {
  if (closeAsked) return;
  closeAsked = true;
  handlers.onClose();
}

export function initDetail(h) {
  handlers = h;
  dialog = document.getElementById('detail');
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });
  // Chrome may close a modal on Esc without honoring preventDefault (after
  // several Esc presses with no click between, e.g. through the Action register
  // on top). Then closeDetail never ran: tidy up here, put focus back, sync the URL.
  dialog.addEventListener('close', () => {
    // closeDetail did it; or the event is late: the sheet has opened again since (Chrome
    // dispatches 'close' after a task, and a quick Esc in Enter numbers reopens it first).
    if (!current || dialog.open) return;
    const fnId = current.parentId ?? current.fnId;
    charts.forEach((c) => c.destroy());
    charts = [];
    current = null;
    focusBack(fnId);
    opener = null;
    requestClose();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) requestClose(); // the dimmed area outside the panel
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.matches('[data-close]')) requestClose();
    if (btn.matches('[data-edit]')) {
      const parentId = current.parentId ?? current.fnId;
      const toIssue = btn.dataset.edit === 'issue';
      clearTimeout(pendingTimer);
      pendingEdit = { fnId: current.fnId, day: current.day, which: toIssue ? 'issue' : 'head', opener };
      // The Issue and action section's Edit lands on the issue box; a KPI added in
      // Board setup opens Enter numbers on that KPI's box (from either Edit).
      if (toIssue) handlers.onEdit(parentId, current.day, current.added ? current.kpiId : null, 'issue');
      else if (current.added) handlers.onEdit(current.parentId, current.day, current.kpiId);
      else handlers.onEdit(parentId, current.day); // app.js lands this on the Plant total box
      return;
    }
    if (btn.matches('[data-add-action]')) {
      // The Action register opens over this sheet, with its add form set to this KPI.
      openActions({ addFor: current.parentId ?? current.fnId, kpiId: current.added ? current.kpiId : null });
    }
    if (btn.matches('[data-table-toggle]')) toggleTable(btn);
  });
  // The register is its own sheet. When it closes, this sheet's list of open
  // actions catches up (the 'close' event doesn't bubble: capture it).
  document.addEventListener('close', (e) => {
    // Enter numbers closed without bringing this sheet back (a save goes to the
    // board): forget the Edit that opened it. Cancel reopens the sheet first.
    if (e.target?.id === 'enter' && pendingEdit && !dialog.open) {
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => { if (!dialog.open) pendingEdit = null; }, 600);
      return;
    }
    if (e.target?.id !== 'action-register' || !dialog.open || !current) return;
    const host = dialog.querySelector('[data-detail-actions]:not([data-not-started])');
    if (host) host.innerHTML = registerMarkup();
    syncAction();
  }, true);
}

/* ---------- The sticky title bar never hides what has focus (WCAG 2.4.11) ----------
   Detail and Board setup scroll inside .sheet-panel under a sticky .sheet-head. css/detail.css
   pads the panel's scrolling by the head's height (--sheet-head-h, measured here when the sheet
   is drawn and whenever the head changes size), so a box scrolled to lands clear of it. Chrome
   doesn't scroll to a control that is on screen but under the head (Shift+Tab upward), so each
   focus is checked too, and the panel scrolls just enough. */

const headWatch = new WeakMap(); // dialog -> ResizeObserver on its current .sheet-head

function measureHead(dlg) {
  const head = dlg.querySelector('.sheet-panel > .sheet-head');
  const h = head ? Math.ceil(head.getBoundingClientRect().height) : 0;
  if (h > 0) dlg.style.setProperty('--sheet-head-h', `${h}px`);
}

/** Measure the sheet's title bar now, and again whenever it changes size (a resize, a title that wraps). */
export function fitSheetHead(dlg) {
  if (!dlg) return;
  measureHead(dlg);
  if (typeof ResizeObserver === 'undefined') return;
  let ro = headWatch.get(dlg);
  if (!ro) {
    ro = new ResizeObserver(() => measureHead(dlg));
    headWatch.set(dlg, ro);
    // Once per sheet: a control that takes focus under the title bar scrolls out from under it.
    dlg.addEventListener('focusin', (e) => keepClearOfHead(dlg, e.target));
  }
  ro.disconnect();
  const head = dlg.querySelector('.sheet-panel > .sheet-head');
  if (head) ro.observe(head);
}

function keepClearOfHead(dlg, el) {
  const panel = dlg.querySelector('.sheet-panel');
  const head = panel?.querySelector(':scope > .sheet-head');
  if (!panel || !head || !panel.contains(el) || head.contains(el)) return;
  requestAnimationFrame(() => {
    if (document.activeElement !== el || !dlg.open) return;
    // A visually hidden box (the photo's file box) shows its focus on its label: keep that clear.
    const shown = el.matches('.sr-only') && el.id ? dlg.querySelector(`label[for="${CSS.escape(el.id)}"]`) ?? el : el;
    const r = shown.getBoundingClientRect();
    const top = head.getBoundingClientRect().bottom + 8;
    const bottom = panel.getBoundingClientRect().bottom - 8;
    let by = 0;
    if (r.top < top) by = r.top - top;
    else if (r.bottom > bottom) by = Math.min(r.bottom - bottom, r.top - top);
    if (by) panel.scrollBy({ top: Math.round(by), behavior: 'instant' });
  });
}

export const isDetailOpen = () => Boolean(dialog?.open);
export const detailFn = () => current?.fnId ?? null;

function toggleTable(btn) {
  const panel = document.getElementById(btn.getAttribute('aria-controls'));
  const open = btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', String(open));
  btn.textContent = open ? 'Hide table' : 'Show as table';
  panel.hidden = !open;
}

function bigFigure(actual, goal, kpi) {
  const f = formatPair(actual, goal, kpi);
  if (f.actual === null) return `<p class="kpi-figure kpi-figure--empty">${esc(f.rest)}</p>`;
  return `<p class="kpi-figure"><span class="kpi-num">${esc(f.actual)}</span>${f.rest ? ` <span class="kpi-rest">${esc(f.rest)}</span>` : ''}</p>`;
}

function areaRow(month, fn, day, area) {
  const s = dayStatus(month, fn, day, area.id);
  const f = formatPair(s.actual, s.goal, fn.kpiDaily);
  const row = (fn.daily[area.id] ?? []).find((r) => r.day === day);
  const placeholder = row?.goalNote === 'placeholder';
  // The status already says "Not entered", so the figure only gives the goal.
  let figure = f.actual === null ? (placeholder ? 'Goal not set' : f.rest) : f.phrase;
  if (s.status === NO_PRODUCTION && f.actual === null) figure = 'No numbers expected';
  return `<tr class="${area.id === 'plant' ? 'is-total' : ''}">
      <th scope="row">${esc(area.name)}</th>
      <td>${statusMarkup(s.status, { tag: 'span', kpi: fn.kpiDaily })}</td>
      <td class="num">${esc(figure)}</td>
    </tr>`;
}

/** "People's", "Operations'": whose area numbers a line means (home's line is the whole plant's). */
const possessive = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** Did this function have a number for any area on that day? */
const hasAreaNumbers = (fn, d) => AREAS.some((id) => typeof (fn.daily[id] ?? []).find((x) => x.day === d)?.actual === 'number');

/**
 * The day by area. When no area numbers exist for the day, one quiet line
 * takes the table's place and says when this function's areas were last
 * entered (nothing at all on a day with no production).
 */
function areaSection(month, fn, day) {
  const dayName = formatDayMedium(month, day);
  if (!hasAreaNumbers(fn, day)) {
    if (isProductionDay(month, day) === false) return '';
    let last = null;
    for (let d = day - 1; d >= 1 && last === null; d -= 1) if (hasAreaNumbers(fn, d)) last = d;
    const when = last === null ? 'No area numbers yet this month.' : `${esc(possessive(fn.name))} area numbers were last entered <span class="nowrap">${esc(formatDayMedium(month, last))}</span>.`;
    return `<p class="areas-empty">No area breakdown for <span class="nowrap">${esc(dayName)}</span>. ${when}</p>`;
  }
  return `
    <section class="sheet-section" aria-labelledby="sec-areas">
      <h3 class="section-title" id="sec-areas">${esc(dayName)} by area</h3>
      <table class="area-table">
        <caption class="sr-only">${esc(plainLabel(fn.kpiDaily))} by area on ${esc(dayName)}</caption>
        <thead><tr><th scope="col">Area</th><th scope="col">Status</th><th scope="col" class="num">${esc(plainLabel(fn.kpiDaily))}</th></tr></thead>
        <tbody>${month.areas.map((a) => areaRow(month, fn, day, a)).join('')}</tbody>
      </table>
      <p class="section-note">Each area is entered on its own. Areas don't add up to the plant total, so the board never sums them.</p>
    </section>`;
}

/** "Sat, Feb 28" from 'YYYY-MM-DD', on one line (the year only when it isn't the board's). */
function dueDay(iso, month) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return iso;
  const sameYear = String(y) === month.month.slice(0, 4);
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC', ...(sameYear ? {} : { year: 'numeric' }) })
    .format(dt).replace(/ /g, ' ');
}

/** This KPI row's register actions for the day: open ones, then ones closed that day or later. */
const dayList = () => actionsFor(current.parentId ?? current.fnId, current.added ? current.kpiId : null, isoForDay(current.month, current.day));

/** This KPI row's action state, read the way the board reads it (the workbook KPI or one added in Board setup). */
function actionState(month = current.month) {
  const found = kpiRowById(month, current.fnId);
  if (!found) return null;
  const k = found.row === found.fn ? { ...found.fn, primary: true } : found.row;
  return actionStateFor(month, found.fn, k, current.day);
}

/**
 * The day's action in the board's words: the workbook note; with no note, a
 * pointer to the register's actions listed right under it (never the same
 * action twice); else "Needs an action" (red, off glyph) for an off-goal KPI,
 * "None needed", or "Nothing recorded".
 */
function actionNoteMarkup(st) {
  if (!st) return `<dd class="is-empty" data-action-note>${esc(ACTION_WORD.nothing)}</dd>`;
  if (st.text) return `<dd data-action-note>${esc(st.text)}</dd>`;
  if (st.state === 'has') {
    return `<dd class="is-empty" data-action-note>${st.open?.length ? 'See open actions below' : 'See actions below'}</dd>`;
  }
  if (st.state === 'needs') return `<dd class="note-needs" data-action-note>${statusMarkup(OFF, { tag: 'span', word: ACTION_WORD.needs })}</dd>`;
  return `<dd class="is-empty" data-action-note>${esc(st.word || ACTION_WORD.nothing)}</dd>`;
}

/** Add action is the primary button while an off-goal KPI has no action. */
const addClass = (st) => `btn ${st?.state === 'needs' ? 'btn--primary' : 'btn--secondary'} reg-add`;

/** After the Action register changes: the action line and the Add action button catch up. */
function syncAction() {
  const st = actionState();
  const note = dialog.querySelector('[data-action-note]');
  if (note) note.outerHTML = actionNoteMarkup(st);
  const add = dialog.querySelector('[data-add-action]');
  if (add) add.className = addClass(st);
}

/**
 * This KPI row's actions from the Action register for the day: the open ones
 * (text, then owner, due date and status), then the ones done that day or
 * later ("Done: …" with the on-track glyph, and the day each was closed).
 */
function registerMarkup() {
  const { month, day } = current;
  const list = dayList();
  const open = list.filter((a) => a.status !== 'closed');
  const done = list.filter((a) => a.status === 'closed');
  const today = isoForDay(month, day);
  const sep = '<span aria-hidden="true"> · </span>';
  const openHtml = open.length
    ? `<ul class="reg-list" aria-labelledby="reg-title">${open.map((a) => {
      const over = a.due && a.due < today;
      const due = a.due
        ? `${over ? `<span class="reg-over">${glyphMarkup(OFF)}Overdue</span>${sep}` : ''}<span>Due ${esc(dueDay(a.due, month))}</span>`
        : '<span>No due date</span>';
      return `<li class="reg-item">
        <p class="reg-text">${esc(a.text)}</p>
        <p class="reg-meta"><span>${esc(a.owner || '')}</span>${a.owner ? sep : ''}${due}${sep}${issueStatusMarkup(a.status)}</p>
      </li>`;
    }).join('')}</ul>`
    : `<p class="reg-empty">${done.length ? 'No open actions.' : 'Nothing assigned in the Action register yet.'}</p>`;
  const doneHtml = done.length
    ? `<ul class="reg-list reg-list--done" aria-label="Done">${done.map((a) => `<li class="reg-item is-done">
        <p class="reg-text"><span class="reg-done">${glyphMarkup(ON)}Done:</span> ${esc(a.text)}</p>
        <p class="reg-meta"><span>${esc(a.owner || '')}</span>${a.owner && a.closedDayIso ? sep : ''}${a.closedDayIso ? `<span>Done ${esc(dueDay(a.closedDayIso, month))}</span>` : ''}</p>
      </li>`).join('')}</ul>`
    : '';
  return openHtml + doneHtml;
}

const PLUS = '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

/**
 * Issue and action, under the status cards and the KPAs, with the register's open actions.
 * startsOn: the day a KPI added in Board setup is tracked from, when that's after this day.
 * Before it there's nothing to act on, so there's no Add action (actions count from that day).
 */
function issueSection(month, fn, day, kpiName, startsOn = null) {
  const issue = notesText(month, fn, day).problem;
  const st = actionState(month);
  const found = kpiRowById(month, current.fnId);
  // Off goal with something recorded that day, and no issue written ("No new issues to
  // report" isn't one): the owner's words stay, muted, and a red line says what's missing.
  const gap = found ? issueGap(month, found.fn, found.row === found.fn ? { ...found.fn, primary: true } : found.row, day) : false;
  const muted = issue.empty || !hasProblem(notesFor(fn, day));
  const dayName = formatDayMedium(month, day);
  const what = `${fn.name}${kpiName ? `, ${kpiName}` : ''}`;
  return `
    <section class="sheet-section sheet-section--issue" aria-labelledby="sec-notes">
      <div class="section-head">
        <h3 class="section-title" id="sec-notes">Issue and action</h3>
        <button class="btn btn--secondary" type="button" data-edit="issue"><span class="btn-label">Edit</span><span class="sr-only"> issue and action, ${esc(what)}, for ${esc(dayName)}</span></button>
      </div>
      <dl class="full-notes">
        <div><dt>What's keeping us from the goal?</dt>${gap
          // Off goal with no issue written: the red line alone ("No new issues to report" would contradict it).
          ? statusMarkup(OFF, { tag: 'dd', extra: 'issue-gap', word: ISSUE_GAP_WORD })
          : `<dd class="${muted ? 'is-empty' : ''}">${esc(issue.text)}</dd>`}${notesFor(fn, day).status ? problemStatusMarkup(fn, day) : ''}</div>
        <div><dt>What are we doing in the next 24 hours?</dt>${actionNoteMarkup(st)}</div>
      </dl>
      ${enteredByMarkup(fn, day)}
      <div class="reg">
        <div class="reg-head">
          <h4 class="reg-title" id="reg-title">Open actions</h4>
          ${startsOn ? '' : `<button class="${addClass(st)}" type="button" data-add-action>${PLUS}<span>Add action</span><span class="sr-only"> for ${esc(what)}</span></button>`}
        </div>
        <div data-detail-actions${startsOn ? ' data-not-started' : ''}>${startsOn
          ? `<p class="reg-empty">Tracked from <span class="nowrap">${esc(formatDayMedium(month, startsOn))}</span>. Actions start that day.</p>`
          : registerMarkup()}</div>
      </div>
    </section>`;
}

// Secondary: Add action is the sheet's one primary button. The note says where it goes.
const escalateLink = (cls = '') => `
  <div class="escalate${cls ? ` ${cls}` : ''}">
    <a class="btn btn--secondary" href="https://cbm.linkedxl.com/login" target="_blank" rel="noopener noreferrer" aria-describedby="escalate-note">
      <span>Escalate in LinkedXL OS</span>
      <svg class="icon" aria-hidden="true" focusable="false"><use href="#g-external"></use></svg>
    </a>
    <p class="escalate-note" id="escalate-note">Opens LinkedXL OS sign-in in a new tab.</p>
  </div>`;

function render(month, fn, day) {
  // A KPI added in Board setup reads like a function; its title names the KPI.
  const added = fn.primary === false;
  const kpiTitle = added ? plainLabel(fn.kpiDaily) : null;
  const y = dayStatus(month, fn, day);
  const mo = monthStatus(month, fn, day);
  const kpas = leadingIndicatorsFor(month, fn);
  const dayName = formatDayMedium(month, day);
  const offTrack = y.status === OFF || mo.status === OFF;
  const dayMeasure = plainLabel(fn.kpiDaily);
  const monthMeasure = plainLabel(fn.kpiMonthly);
  const question = fn.dorQuestion?.trim();
  // A KPI added in Board setup isn't judged before the day it was added: say when it starts.
  const start = (fn.daily?.plant ?? []).find((r) => !r.beforeStart)?.day;
  const notYet = `<p class="kpi-figure kpi-figure--empty">${start ? `Tracked from ${esc(formatDayMedium(month, start))}` : 'Not tracked yet'}</p>`;
  // The board's rule for a day with no production: a figure only when one says something.
  // No number, or the workbook's weekend 0 ("0 vs 0 goal"), reads "No numbers expected", never "No goal set".
  const noDayFigure = y.status === NO_PRODUCTION && !(typeof y.actual === 'number' && y.actual !== 0);
  // Before that day there's nothing to chart: one line instead of empty axes.
  const notStarted = Boolean(start && start > day);
  const startNote = `<p class="table-empty">Tracked from ${esc(formatDayMedium(month, start ?? day))}, so there are no days to show yet.</p>`;
  // A KPI with no numbers at all yet (added in Board setup): the board's line and its
  // "Enter the first one" (the same route the board uses), instead of empty month axes.
  const anyNumber = (fn.daily?.plant ?? []).some((r) => typeof r.actual === 'number')
    || (fn.monthly ?? []).some((r) => typeof r.actual === 'number');
  const noNumbers = !notStarted && !anyNumber;
  // The year is decided by "any number at all", before its start day too: no empty axes and goal dashes.
  const noYear = !anyNumber;
  const firstBtn = `<button class="btn btn--secondary detail-first" type="button" data-enter-kpi="${esc(current.parentId ?? fn.id)}" data-enter-kpi-id="${esc(added ? fn.kpiId : '')}">Enter the first one<span class="sr-only">, ${esc(plainLabel(fn.kpiDaily))}</span></button>`;
  const freshNote = (withButton) => `<div class="detail-fresh"><p class="table-empty">No numbers yet.</p>${withButton ? firstBtn : ''}</div>`;
  const noCharts = notStarted || noNumbers;
  // Board setup KPIs have one number a day, with no areas behind it.
  const seriesName = fn.custom ? "The day's number" : 'Plant total';

  const leading = kpas
    ? `<p class="section-sub">${esc(kpas.purpose)}.</p>
       <ol class="kbi-list">${kpas.kbis.map((k) => `<li><span class="kbi-level">${esc(k.level)}</span><span>${esc(k.text)}</span></li>`).join('')}</ol>
       <p class="kbi-lagging"><span>Results these protect:</span> ${esc(kpas.laggingLink)}</p>`
    : `<p class="section-sub">No KPAs are listed for ${esc(fn.name)} yet.</p>`;
  // A KPI added in Board setup has no KPAs of its own; the function's are the ones shown.
  const kpaTitle = added ? `What drives ${fn.name} (KPAs)` : 'What drives this KPI (KPAs)';

  dialog.innerHTML = `
    <div class="sheet-panel">
      <header class="sheet-head">
        <h2 class="sheet-title" id="detail-title" tabindex="-1">${esc(fn.name)}${kpiTitle ? `<span class="sheet-kpi">${esc(kpiTitle)}</span>` : ''}</h2>
        <div class="sheet-tools">
          <button class="btn btn--secondary sheet-edit" type="button" data-edit><span class="btn-label">Edit<span class="wide-only"> numbers</span></span><span class="sr-only"> for ${esc(dayName)}</span></button>
          <button class="icon-btn sheet-close" type="button" data-close aria-label="Close ${esc(fn.name)} detail">
            <svg class="icon" aria-hidden="true" focusable="false"><use href="#g-close"></use></svg>
          </button>
        </div>
      </header>

      <div class="sheet-body">
        <div class="sheet-id">
          <p class="sheet-owner">${esc(fn.owner)}</p>
          ${question ? `<p class="sheet-question">${esc(question)}</p>` : ''}
        </div>
        <div class="kpis">
          <section class="kpi" data-status="${y.status}" aria-label="${esc(`${dayHeading(month, day)}: ${dayMeasure}`)}">
            <h3 class="kpi-label">${esc(dayHeading(month, day))}</h3>
            ${statusMarkup(y.status, { kpi: fn.kpiDaily })}
            ${y.status === NOT_TRACKED ? notYet : noDayFigure ? '<p class="kpi-figure kpi-figure--empty">No numbers expected</p>' : bigFigure(y.actual, y.goal, fn.kpiDaily)}
            ${measureMarkup(month, fn.kpiDaily, '', 'p', 'kpi-measure')}
          </section>
          <section class="kpi" data-status="${mo.status}" aria-label="${esc(`${monthSoFar(month)}: ${monthMeasure}`)}">
            <h3 class="kpi-label">${esc(monthSoFar(month))}</h3>
            ${statusMarkup(mo.status, { kpi: fn.kpiMonthly })}
            ${mo.asOfDay === null ? '' : mo.status === NOT_TRACKED ? notYet : bigFigure(mo.actual, mo.goal, fn.kpiMonthly)}
            ${measureMarkup(month, fn.kpiMonthly, '', 'p', 'kpi-measure')}
          </section>
        </div>

        <section class="sheet-section sheet-section--kbi" aria-labelledby="sec-kbi">
          <h3 class="section-title" id="sec-kbi">${esc(kpaTitle)}</h3>
          ${leading}
        </section>

        ${issueSection(month, fn, day, kpiTitle, notStarted ? start : null)}

        ${offTrack ? escalateLink('escalate--top') : ''}

        ${fn.custom || added ? '' : areaSection(month, fn, day)}

        <section class="sheet-section" aria-labelledby="sec-days">
          <h3 class="section-title" id="sec-days">${esc(formatMonthName(month))}, day by day <span class="section-measure">· ${esc(dayMeasure)}</span></h3>
          <p class="section-sub">${seriesName}
            ${noCharts ? '' : '<span class="legend" aria-hidden="true"><span class="key key--bar"></span>Actual<span class="key key--goal"></span>Goal<span class="key key--bar m-key-off"></span>Off goal</span>'}</p>
          ${notStarted ? startNote : noNumbers ? freshNote(true) : `<div class="chart-host" data-chart="days"></div>
          <p class="chart-caption">${esc(recordText(month, fn, day))}</p>
          <button class="btn btn--text table-toggle" type="button" data-table-toggle aria-expanded="false" aria-controls="tbl-days">Show as table</button>
          <div class="table-wrap" id="tbl-days" hidden></div>`}
        </section>

        <section class="sheet-section" aria-labelledby="sec-mtd">
          <h3 class="section-title" id="sec-mtd">${esc(monthSoFar(month))} <span class="section-measure">· ${esc(monthMeasure)}</span></h3>
          <p class="section-sub">Month to date${esc(lowerNote(fn.kpiMonthly))}
            ${noCharts ? '' : '<span class="legend" aria-hidden="true"><span class="key key--actual"></span>Actual<span class="key key--goal"></span>Goal</span>'}</p>
          ${notStarted ? startNote : noNumbers ? freshNote(false) : `<div class="chart-host" data-chart="mtd"></div>
          <button class="btn btn--text table-toggle" type="button" data-table-toggle aria-expanded="false" aria-controls="tbl-mtd">Show as table</button>
          <div class="table-wrap" id="tbl-mtd" hidden></div>`}
        </section>

        <section class="sheet-section" aria-labelledby="sec-year">
          <h3 class="section-title" id="sec-year">This year <span class="section-measure">· ${esc(monthMeasure)}</span></h3>
          ${noYear ? `<p class="section-sub">By month${esc(lowerNote(fn.kpiMonthly))}.</p>
          <p class="table-empty">Starts with the first month's numbers.</p>` : `<p class="section-sub">By month${esc(lowerNote(fn.kpiMonthly))}. ${esc(formatMonthName(month))} is so far, through ${esc(dayName)}. Months with no results yet stay empty.</p>
          <div class="chart-host" data-chart="year"></div>
          <button class="btn btn--text table-toggle" type="button" data-table-toggle aria-expanded="false" aria-controls="tbl-year">Show as table</button>
          <div class="table-wrap" id="tbl-year" hidden></div>`}
        </section>

        ${offTrack ? '' : escalateLink()}
      </div>
    </div>`;

  fitSheetHead(dialog);
  mountCharts(month, fn, day, mo);
}

function mountCharts(month, fn, day, mo) {
  charts.forEach((c) => c.destroy());
  charts = [];
  const isProd = (d) => isProductionDay(month, d);
  const daily = dailySeries(fn);
  const statusOf = (r) => compareToGoal(r.actual, r.goal, fn.kpiDaily.better);
  // Days before a Board setup KPI existed aren't misses or blanks: they're left out.
  const shown = daily.filter((r) => r.day <= day && !r.beforeStart && isProd(r.day) !== false);
  const common = { day, daysInMonth: month.daysInMonth, isProductionDay: isProd, monthShort: formatMonthShort(month), weekdayOf: (d) => weekday(month, d) };
  const phrase = (f) => (f.actual === null ? `Not entered. ${f.rest}` : `${f.actual}${f.rest ? ` ${f.rest}` : ', no goal set'}`);
  const mtdStatus = (r) => compareToGoal(r.actual, r.goal, fn.kpiMonthly.better);
  const mtdRows = (fn.monthToDate ?? []).filter((r) => r.day <= day && !r.beforeStart && isProd(r.day) !== false);

  // A Board setup KPI seen before its first day has no day-by-day or month-so-far charts (render says so).
  if (dialog.querySelector('[data-chart="days"]')) {
    charts.push(barChart(dialog.querySelector('[data-chart="days"]'), {
      ...common,
      series: daily,
      kpi: fn.kpiDaily,
      statusOf,
      label: `${plainLabel(fn.kpiDaily)}, ${fn.custom ? "the day's number" : 'plant total'}, each production day of ${formatMonthName(month)} through ${formatDayMedium(month, day)}`,
      describe: (r) => ({ value: phrase(formatPair(r.actual, r.goal, fn.kpiDaily)), meta: formatDayMedium(month, r.day), status: statusOf(r) }),
    }));
    dialog.querySelector('#tbl-days').append(dataTable(shown, [
      { label: 'Day', cell: (r) => formatDayMedium(month, r.day) },
      { label: 'Actual', num: true, cell: (r) => formatPair(r.actual, r.goal, fn.kpiDaily).actual ?? 'Not entered' },
      { label: 'Goal', num: true, cell: (r) => formatPair(r.actual, r.goal, fn.kpiDaily).goal ?? 'No goal set' },
      { label: 'Status', cell: (r) => ({ status: statusOf(r), kpi: fn.kpiDaily }) },
    ], `${plainLabel(fn.kpiDaily)} by day`));

    const endRow = mtdRows.find((r) => r.day === day);
    charts.push(lineChart(dialog.querySelector('[data-chart="mtd"]'), {
      ...common,
      series: fn.monthToDate ?? [],
      kpi: fn.kpiMonthly,
      endLabel: endRow ? formatPair(endRow.actual, endRow.goal, fn.kpiMonthly).actual ?? '' : '',
      label: `${plainLabel(fn.kpiMonthly)}, ${monthSoFar(month)}, against goal`,
      describe: (r) => ({ value: phrase(formatPair(r.actual, r.goal, fn.kpiMonthly)), meta: `through ${formatDayMedium(month, r.day)}`, status: mtdStatus(r) }),
    }));
    dialog.querySelector('#tbl-mtd').append(dataTable(mtdRows, [
      { label: 'Through', cell: (r) => formatDayMedium(month, r.day) },
      { label: 'Actual', num: true, cell: (r) => formatPair(r.actual, r.goal, fn.kpiMonthly).actual ?? 'Not entered' },
      { label: 'Goal', num: true, cell: (r) => formatPair(r.actual, r.goal, fn.kpiMonthly).goal ?? 'No goal set' },
      { label: 'Status', cell: (r) => ({ status: mtdStatus(r), kpi: fn.kpiMonthly }) },
    ], `${plainLabel(fn.kpiMonthly)} month to date`));

    // No production days to list yet (the month's first days were a weekend).
    for (const [id, rows] of [['#tbl-days', shown], ['#tbl-mtd', mtdRows]]) {
      if (rows.length) continue;
      const p = document.createElement('p');
      p.className = 'table-empty';
      p.textContent = 'No production days yet.';
      dialog.querySelector(id).replaceChildren(p);
    }
  }

  // No numbers yet: the year says so in words (render), with no chart to draw.
  if (!dialog.querySelector('[data-chart="year"]')) return;
  // The current month uses the same month-to-date row as the headline, so the
  // year never contradicts it (the file's monthly block is a later snapshot).
  // Before the month's first production day there is no month to date yet: the
  // current month stays empty, never the file's end-of-month figure.
  const monthIndex = Number(month.month.slice(5, 7)) - 1;
  const yearRows = (fn.monthly ?? []).map((r, i) => {
    if (i !== monthIndex) return r;
    return mo.asOfDay !== null
      ? { ...r, actual: mo.actual, goal: mo.goal, soFar: true }
      : { ...r, actual: null, soFar: true };
  });
  const monthName = (r) => r.month.charAt(0) + r.month.slice(1).toLowerCase();
  charts.push(yearChart(dialog.querySelector('[data-chart="year"]'), {
    monthly: yearRows,
    kpi: fn.kpiMonthly,
    currentIndex: monthIndex,
    statusOf: mtdStatus,
    label: `${plainLabel(fn.kpiMonthly)} by month this year`,
    describe: (r) => {
      const f = formatPair(r.actual, r.goal, fn.kpiMonthly);
      return {
        value: f.actual === null ? `No results yet. ${f.rest}` : phrase(f),
        meta: `${monthName(r)}${r.soFar ? `, through ${formatDayMedium(month, day)}` : ''}`,
        status: f.actual === null ? null : mtdStatus(r),
      };
    },
  }));
  dialog.querySelector('#tbl-year').append(dataTable(yearRows, [
    { label: 'Month', cell: (r) => `${monthName(r)}${r.soFar ? ' (so far)' : ''}` },
    { label: 'Actual', num: true, cell: (r) => formatPair(r.actual, r.goal, fn.kpiMonthly).actual ?? 'No results yet' },
    { label: 'Goal', num: true, cell: (r) => formatPair(r.actual, r.goal, fn.kpiMonthly).goal ?? 'No goal set' },
    { label: 'Status', cell: (r) => (typeof r.actual === 'number' ? { status: mtdStatus(r), kpi: fn.kpiMonthly } : 'No results yet') },
  ], `${plainLabel(fn.kpiMonthly)} by month`));
}

const CONTROL = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/**
 * Remember what opened the sheet, so closing it can put focus back there.
 * Opened from something that isn't a control (a board row's chart or owner
 * cell leaves focus on <main>): the KPI's own link in that row instead.
 */
function rememberOpener(kpiRowId) {
  const el = document.activeElement;
  if (el && dialog.contains(el)) { opener = null; return; }
  if (!el || el === document.body || !el.matches(CONTROL)) { opener = { el: null, id: kpiRowId, cls: 'kpi-link' }; return; }
  opener = { el, id: el.getAttribute('data-open-detail'), cls: el.classList[0] ?? null };
}

const isShown = (el) => Boolean(el?.isConnected) && !el.closest('[inert], dialog:not([open])')
  && (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null);

/**
 * Focus goes back to the link that opened the sheet: the same element when it
 * is still on the page, else its twin after a re-render (same class, same
 * data-open-detail), else the function's row on the page that's showing.
 */
function focusBack(fnId) {
  let target = isShown(opener?.el) ? opener.el : null;
  if (!target && opener?.id) {
    target = [...document.querySelectorAll(`[data-open-detail="${CSS.escape(opener.id)}"]`)]
      .find((n) => (!opener.cls || n.classList.contains(opener.cls)) && isShown(n)) ?? null;
  }
  if (!target && fnId) {
    const id = CSS.escape(fnId);
    target = [`#fn-${id} .fn-link`, `.home-app tr[data-home-row="${id}"] .mx-link`]
      .map((s) => document.querySelector(s)).find(isShown) ?? null;
  }
  target?.focus({ preventScroll: false });
}

export function openDetail(month, fnId, day) {
  const found = kpiRowById(month, fnId);
  if (!found) return false;
  const fn = found.row;
  const same = dialog.open && current?.fnId === fnId && current?.day === day;
  const wasOpen = dialog.open;
  // Back from Enter numbers (Cancel) on the same KPI and day: the Edit that was used.
  const back = !wasOpen && pendingEdit?.fnId === fnId && pendingEdit?.day === day ? pendingEdit : null;
  if (!wasOpen) {
    rememberOpener(fnId);
    closeAsked = false;
    clearTimeout(pendingTimer);
    pendingEdit = null;
    if (back) opener = back.opener; // Esc still returns to what first opened the sheet
  }
  const added = fn.primary === false;
  current = { fnId, day, parentId: found.fn.id, kpiId: added ? fn.kpiId : null, added, month };
  // Open first so the charts measure their real width.
  if (!wasOpen) dialog.showModal();
  if (!same) render(month, fn, day);
  if (!wasOpen) {
    // autofocus is ignored for <dialog> here: move focus explicitly.
    const edit = back && dialog.querySelector(back.which === 'issue' ? '.sheet-section--issue [data-edit]' : '.sheet-edit');
    if (edit) edit.focus();
    else dialog.querySelector('#detail-title')?.focus({ preventScroll: true });
  }
  return true;
}

/** Re-render in place (after data changes) without moving focus. */
export function refreshDetail(month) {
  if (!dialog.open || !current) return;
  const fn = kpiRowById(month, current.fnId)?.row;
  if (!fn) return;
  current.month = month;
  // Keep focus where it was when the button it was on is drawn again.
  const active = document.activeElement;
  const key = dialog.contains(active) ? ['data-edit', 'data-add-action', 'data-close'].find((a) => active.hasAttribute(a)) : null;
  const inIssue = Boolean(active?.closest?.('.sheet-section--issue'));
  const scroll = dialog.querySelector('.sheet-panel')?.scrollTop ?? 0;
  // The Action register, open on top, returns focus to this very button when it
  // closes, so the same element is kept through the redraw.
  const addBtn = dialog.querySelector('[data-add-action]');
  render(month, fn, current.day);
  const fresh = dialog.querySelector('[data-add-action]');
  if (addBtn && fresh) { addBtn.innerHTML = fresh.innerHTML; addBtn.className = fresh.className; fresh.replaceWith(addBtn); }
  const panel = dialog.querySelector('.sheet-panel');
  if (panel) panel.scrollTop = scroll;
  if (key) {
    const again = key === 'data-edit' && inIssue ? dialog.querySelector('.sheet-section--issue [data-edit]') : dialog.querySelector(`[${key}]`);
    again?.focus({ preventScroll: true });
  }
}

export function closeDetail({ restoreFocus = true } = {}) {
  if (!dialog.open) return;
  const fnId = current?.parentId ?? current?.fnId;
  dialog.close();
  charts.forEach((c) => c.destroy());
  charts = [];
  current = null;
  if (restoreFocus) focusBack(fnId);
  opener = null;
}
