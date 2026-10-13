// Function detail: a right-side sheet over the board (full screen on phone).
// <dialog> + showModal gives the dimmed, inert background and Esc; focus is
// moved in JS because autofocus is ignored here.

import { dailySeries, leadingIndicatorsFor, kpiRowById, notesFor, isoForDay } from './store.js?v=20261012-235706';
import { dayStatus, monthStatus, isProductionDay, compareToGoal, OFF, NO_PRODUCTION } from './status.js?v=20261012-235706';
import {
  formatPair, formatValue, plainLabel, formatDayMedium, formatMonthShort, monthSoFar,
  dayHeading, weekday, formatMonthName, lowerNote,
} from './format.js?v=20261012-235706';
import { measureMarkup, enteredByMarkup, recordText, problemStatusMarkup } from './board.js?v=20261012-235706';
import { esc, statusMarkup, glyphMarkup, issueStatusMarkup } from './ui.js?v=20261012-235706';
import { barChart, lineChart, yearChart, dataTable } from './charts.js?v=20261012-235706';
import { actionsFor, openActions } from './actions.js?v=20261012-235706';

const AREAS = ['mold', 'bond', 'prime', 'compounding'];

let dialog;
let handlers;
let charts = [];
let current = null; // { fnId, day, parentId, kpiId, added, month }
let opener = null;  // { el, id, cls }: the link or button that opened the sheet

let closeAsked = false; // handlers.onClose already ran for this opening

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
    if (!current) return; // closeDetail did it
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
      // A KPI added in Board setup opens Enter numbers on that KPI's box.
      if (current.added) handlers.onEdit(current.parentId, current.day, current.kpiId);
      else handlers.onEdit(current.parentId ?? current.fnId, current.day);
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
    if (e.target?.id !== 'action-register' || !dialog.open || !current) return;
    const host = dialog.querySelector('[data-detail-actions]');
    if (host) host.innerHTML = registerMarkup();
    const note = dialog.querySelector('[data-action-note]');
    const row = kpiRowById(current.month, current.fnId)?.row;
    if (note && row) note.outerHTML = actionNoteMarkup(issueText(row, current.day).action);
  }, true);
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

/**
 * The day by area. When no area numbers exist for the day, one quiet line
 * takes the table's place (nothing at all on a day with no production).
 */
function areaSection(month, fn, day) {
  const dayName = formatDayMedium(month, day);
  const anyArea = AREAS.some((id) => {
    const r = (fn.daily[id] ?? []).find((x) => x.day === day);
    return typeof r?.actual === 'number';
  });
  if (!anyArea) {
    if (isProductionDay(month, day) === false) return '';
    return `<p class="areas-empty">Areas weren't entered for <span class="nowrap">${esc(dayName)}</span>.</p>`;
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

/** The day's issue and action in the board's words, with plain empty states. */
function issueText(row, day) {
  const n = notesFor(row, day);
  if (n.source === null) {
    const none = { text: 'Not recorded for this day', empty: true };
    return { issue: none, action: none };
  }
  const flat = (t) => t.replace(/\n\s*\n/g, '\n');
  return {
    issue: n.problem ? { text: flat(n.problem), empty: false } : { text: 'No issue reported', empty: true },
    action: n.action ? { text: flat(n.action), empty: false } : { text: 'No action yet', empty: true },
  };
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

const openList = () => actionsFor(current.parentId ?? current.fnId, current.added ? current.kpiId : null);

/** The day's action. With none in the note but open actions in the register, it points to them. */
function actionNoteMarkup(action) {
  const text = action.empty && action.text === 'No action yet' && openList().length ? 'None in the note. See the open actions below.' : action.text;
  return `<dd class="${action.empty ? 'is-empty' : ''}" data-action-note>${esc(text)}</dd>`;
}

/** This KPI row's open actions from the Action register: text, then owner, due date and status. */
function registerMarkup() {
  const { month, day } = current;
  const list = openList();
  if (!list.length) return '<p class="reg-empty">No open actions in the Action register yet.</p>';
  const today = isoForDay(month, day);
  return `<ul class="reg-list" aria-labelledby="reg-title">${list.map((a) => {
    const over = a.due && a.due < today;
    const due = a.due
      ? `${over ? `<span class="reg-over">${glyphMarkup(OFF)}Overdue</span><span aria-hidden="true"> · </span>` : ''}<span>Due ${esc(dueDay(a.due, month))}</span>`
      : '<span>No due date</span>';
    return `<li class="reg-item">
        <p class="reg-text">${esc(a.text)}</p>
        <p class="reg-meta"><span>${esc(a.owner || '')}</span>${a.owner ? '<span aria-hidden="true"> · </span>' : ''}${due}<span aria-hidden="true"> · </span>${issueStatusMarkup(a.status)}</p>
      </li>`;
  }).join('')}</ul>`;
}

const PLUS = '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

/** Issue and action, right under the two status cards, with the register's open actions. */
function issueSection(month, fn, day, kpiName) {
  const notes = issueText(fn, day);
  const dayName = formatDayMedium(month, day);
  const what = `${fn.name}${kpiName ? `, ${kpiName}` : ''}`;
  return `
    <section class="sheet-section sheet-section--issue" aria-labelledby="sec-notes">
      <div class="section-head">
        <h3 class="section-title" id="sec-notes">Issue and action</h3>
        <button class="btn btn--secondary" type="button" data-edit><span class="btn-label">Edit</span><span class="sr-only"> ${esc(what)} for ${esc(dayName)}</span></button>
      </div>
      <dl class="full-notes">
        <div><dt>What's keeping us from the goal?</dt><dd class="${notes.issue.empty ? 'is-empty' : ''}">${esc(notes.issue.text)}</dd>${problemStatusMarkup(fn, day)}</div>
        <div><dt>What are we doing in the next 24 hours?</dt>${actionNoteMarkup(notes.action)}</div>
      </dl>
      ${enteredByMarkup(fn, day)}
      <div class="reg">
        <div class="reg-head">
          <h4 class="reg-title" id="reg-title">Open actions</h4>
          <button class="btn btn--secondary reg-add" type="button" data-add-action>${PLUS}<span>Add action</span><span class="sr-only"> for ${esc(what)}</span></button>
        </div>
        <div data-detail-actions>${registerMarkup()}</div>
      </div>
    </section>`;
}

const escalateLink = (cls = '') => `
  <p class="escalate${cls ? ` ${cls}` : ''}">
    <a class="btn btn--primary" href="https://cbm.linkedxl.com/login" target="_blank" rel="noopener noreferrer">
      <span>Escalate in LinkedXL OS</span>
      <svg class="icon" aria-hidden="true" focusable="false"><use href="#g-external"></use></svg>
      <span class="sr-only">(opens in a new tab)</span>
    </a>
  </p>`;

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

  const leading = kpas
    ? `<p class="section-sub">${esc(kpas.purpose)}.</p>
       <ol class="kbi-list">${kpas.kbis.map((k) => `<li><span class="kbi-level">${esc(k.level)}</span><span>${esc(k.text)}</span></li>`).join('')}</ol>
       <p class="kbi-lagging"><span>Results these protect:</span> ${esc(kpas.laggingLink)}</p>`
    : `<p class="section-sub">The workbook's KPA tab has no leading indicators for ${esc(fn.name)} yet.</p>`;
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
            ${measureMarkup(month, fn.kpiDaily, '', 'p', 'kpi-measure')}
            ${statusMarkup(y.status, { kpi: fn.kpiDaily })}
            ${bigFigure(y.actual, y.goal, fn.kpiDaily)}
          </section>
          <section class="kpi" data-status="${mo.status}" aria-label="${esc(`${monthSoFar(month)}: ${monthMeasure}`)}">
            <h3 class="kpi-label">${esc(monthSoFar(month))}</h3>
            ${measureMarkup(month, fn.kpiMonthly, '', 'p', 'kpi-measure')}
            ${statusMarkup(mo.status, { kpi: fn.kpiMonthly })}
            ${mo.asOfDay === null ? '' : bigFigure(mo.actual, mo.goal, fn.kpiMonthly)}
          </section>
        </div>

        ${issueSection(month, fn, day, kpiTitle)}

        ${offTrack ? escalateLink('escalate--top') : ''}

        ${fn.custom || added ? '' : areaSection(month, fn, day)}

        <section class="sheet-section" aria-labelledby="sec-days">
          <h3 class="section-title" id="sec-days">${esc(formatMonthName(month))}, day by day <span class="section-measure">· ${esc(dayMeasure)}</span></h3>
          <p class="section-sub">Plant total
            <span class="legend" aria-hidden="true"><span class="key key--bar"></span>Actual<span class="key key--goal"></span>Goal<svg class="key-glyph" aria-hidden="true" focusable="false"><use href="#g-off"></use></svg>Off goal</span></p>
          <div class="chart-host" data-chart="days"></div>
          <p class="chart-caption">${esc(recordText(month, fn, day))}</p>
          <button class="btn btn--text table-toggle" type="button" data-table-toggle aria-expanded="false" aria-controls="tbl-days">Show as table</button>
          <div class="table-wrap" id="tbl-days" hidden></div>
        </section>

        <section class="sheet-section" aria-labelledby="sec-mtd">
          <h3 class="section-title" id="sec-mtd">${esc(monthSoFar(month))} <span class="section-measure">· ${esc(monthMeasure)}</span></h3>
          <p class="section-sub">Month to date${esc(lowerNote(fn.kpiMonthly))}
            <span class="legend" aria-hidden="true"><span class="key key--actual"></span>Actual<span class="key key--goal"></span>Goal</span></p>
          <div class="chart-host" data-chart="mtd"></div>
          <button class="btn btn--text table-toggle" type="button" data-table-toggle aria-expanded="false" aria-controls="tbl-mtd">Show as table</button>
          <div class="table-wrap" id="tbl-mtd" hidden></div>
        </section>

        <section class="sheet-section" aria-labelledby="sec-year">
          <h3 class="section-title" id="sec-year">This year <span class="section-measure">· ${esc(monthMeasure)}</span></h3>
          <p class="section-sub">By month${esc(lowerNote(fn.kpiMonthly))}. ${esc(formatMonthName(month))} is so far, through ${esc(dayName)}. Months with no results yet stay empty.</p>
          <div class="chart-host" data-chart="year"></div>
          <button class="btn btn--text table-toggle" type="button" data-table-toggle aria-expanded="false" aria-controls="tbl-year">Show as table</button>
          <div class="table-wrap" id="tbl-year" hidden></div>
        </section>

        <section class="sheet-section" aria-labelledby="sec-kbi">
          <h3 class="section-title" id="sec-kbi">${esc(kpaTitle)}</h3>
          ${leading}
        </section>

        ${offTrack ? '' : escalateLink()}
      </div>
    </div>`;

  mountCharts(month, fn, day, mo);
}

function mountCharts(month, fn, day, mo) {
  charts.forEach((c) => c.destroy());
  charts = [];
  const isProd = (d) => isProductionDay(month, d);
  const daily = dailySeries(fn);
  const statusOf = (r) => compareToGoal(r.actual, r.goal, fn.kpiDaily.better);
  const shown = daily.filter((r) => r.day <= day && isProd(r.day) !== false);
  const common = { day, daysInMonth: month.daysInMonth, isProductionDay: isProd, monthShort: formatMonthShort(month), weekdayOf: (d) => weekday(month, d) };
  const phrase = (f) => (f.actual === null ? `Not entered. ${f.rest}` : `${f.actual}${f.rest ? ` ${f.rest}` : ', no goal set'}`);

  charts.push(barChart(dialog.querySelector('[data-chart="days"]'), {
    ...common,
    series: daily,
    kpi: fn.kpiDaily,
    statusOf,
    label: `${plainLabel(fn.kpiDaily)}, plant total, each production day of ${formatMonthName(month)} through ${formatDayMedium(month, day)}`,
    describe: (r) => ({ value: phrase(formatPair(r.actual, r.goal, fn.kpiDaily)), meta: formatDayMedium(month, r.day), status: statusOf(r) }),
  }));
  dialog.querySelector('#tbl-days').append(dataTable(shown, [
    { label: 'Day', cell: (r) => formatDayMedium(month, r.day) },
    { label: 'Actual', num: true, cell: (r) => formatValue(r.actual, fn.kpiDaily.unit) ?? 'Not entered' },
    { label: 'Goal', num: true, cell: (r) => formatValue(r.goal, fn.kpiDaily.unit) ?? 'No goal set' },
    { label: 'Status', cell: (r) => ({ status: statusOf(r), kpi: fn.kpiDaily }) },
  ], `${plainLabel(fn.kpiDaily)} by day`));

  const mtdStatus = (r) => compareToGoal(r.actual, r.goal, fn.kpiMonthly.better);
  const mtdRows = (fn.monthToDate ?? []).filter((r) => r.day <= day && isProd(r.day) !== false);
  const endRow = mtdRows.find((r) => r.day === day);
  charts.push(lineChart(dialog.querySelector('[data-chart="mtd"]'), {
    ...common,
    series: fn.monthToDate ?? [],
    kpi: fn.kpiMonthly,
    endLabel: endRow ? formatValue(endRow.actual, fn.kpiMonthly.unit) ?? '' : '',
    label: `${plainLabel(fn.kpiMonthly)}, ${monthSoFar(month).toLowerCase()}, against goal`,
    describe: (r) => ({ value: phrase(formatPair(r.actual, r.goal, fn.kpiMonthly)), meta: `through ${formatDayMedium(month, r.day)}`, status: mtdStatus(r) }),
  }));
  dialog.querySelector('#tbl-mtd').append(dataTable(mtdRows, [
    { label: 'Through', cell: (r) => formatDayMedium(month, r.day) },
    { label: 'Actual', num: true, cell: (r) => formatValue(r.actual, fn.kpiMonthly.unit) ?? 'Not entered' },
    { label: 'Goal', num: true, cell: (r) => formatValue(r.goal, fn.kpiMonthly.unit) ?? 'No goal set' },
    { label: 'Status', cell: (r) => ({ status: mtdStatus(r), kpi: fn.kpiMonthly }) },
  ], `${plainLabel(fn.kpiMonthly)} month to date`));

  // The current month uses the same month-to-date row as the headline, so the
  // year never contradicts it (the file's monthly block is a later snapshot).
  const monthIndex = Number(month.month.slice(5, 7)) - 1;
  const yearRows = (fn.monthly ?? []).map((r, i) => (i === monthIndex && mo.asOfDay !== null
    ? { ...r, actual: mo.actual, goal: mo.goal, soFar: true }
    : r));
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
    { label: 'Actual', num: true, cell: (r) => formatValue(r.actual, fn.kpiMonthly.unit) ?? 'No results yet' },
    { label: 'Goal', num: true, cell: (r) => formatValue(r.goal, fn.kpiMonthly.unit) ?? 'No goal set' },
    { label: 'Status', cell: (r) => (typeof r.actual === 'number' ? { status: mtdStatus(r), kpi: fn.kpiMonthly } : 'No results yet') },
  ], `${plainLabel(fn.kpiMonthly)} by month`));
}

/** Remember what opened the sheet, so closing it can put focus back there. */
function rememberOpener() {
  const el = document.activeElement;
  if (!el || el === document.body || dialog.contains(el)) { opener = null; return; }
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
  if (!wasOpen) { rememberOpener(); closeAsked = false; }
  const added = fn.primary === false;
  current = { fnId, day, parentId: found.fn.id, kpiId: added ? fn.kpiId : null, added, month };
  // Open first so the charts measure their real width.
  if (!wasOpen) dialog.showModal();
  if (!same) render(month, fn, day);
  if (!wasOpen) {
    // autofocus is ignored for <dialog> here: move focus explicitly.
    dialog.querySelector('#detail-title')?.focus({ preventScroll: true });
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
  if (addBtn && fresh) { addBtn.innerHTML = fresh.innerHTML; fresh.replaceWith(addBtn); }
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
