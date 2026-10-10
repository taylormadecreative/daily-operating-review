// Function detail: a right-side sheet over the board (full screen on phone).
// <dialog> + showModal gives the dimmed, inert background and Esc; focus is
// moved in JS because autofocus is ignored here.

import { dailySeries, leadingIndicatorsFor } from './store.js';
import { dayStatus, monthStatus, isProductionDay, compareToGoal, OFF, NO_PRODUCTION } from './status.js';
import {
  formatPair, formatValue, plainLabel, formatDayMedium, formatMonthShort, monthSoFar,
  dayHeading, weekday, formatMonthName, lowerNote,
} from './format.js';
import { measureMarkup, notesText, enteredByMarkup, recordText, problemStatusMarkup } from './board.js';
import { esc, statusMarkup } from './ui.js';
import { barChart, lineChart, yearChart, dataTable } from './charts.js';

const AREAS = ['mold', 'bond', 'prime', 'compounding'];

let dialog;
let handlers;
let charts = [];
let current = null; // { fnId, day }

export function initDetail(h) {
  handlers = h;
  dialog = document.getElementById('detail');
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); handlers.onClose(); });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) handlers.onClose(); // the dimmed area outside the panel
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.matches('[data-close]')) handlers.onClose();
    if (btn.matches('[data-edit]')) handlers.onEdit(current.fnId, current.day);
    if (btn.matches('[data-table-toggle]')) toggleTable(btn);
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

function areaSection(month, fn, day) {
  const dayName = formatDayMedium(month, day);
  const anyArea = AREAS.some((id) => {
    const r = (fn.daily[id] ?? []).find((x) => x.day === day);
    return typeof r?.actual === 'number';
  });
  const areas = anyArea ? month.areas : month.areas.filter((a) => a.id === 'plant');
  return `
    <section class="sheet-section" aria-labelledby="sec-areas">
      <h3 class="section-title" id="sec-areas">${esc(dayName)} by area</h3>
      ${anyArea ? '' : '<p class="section-sub areas-empty">Areas weren\'t entered for this day.</p>'}
      <table class="area-table${anyArea ? '' : ' area-table--total-only'}">
        <caption class="sr-only">${esc(plainLabel(fn.kpiDaily))} by area on ${esc(dayName)}</caption>
        <thead><tr><th scope="col">Area</th><th scope="col">Status</th><th scope="col" class="num">${esc(plainLabel(fn.kpiDaily))}</th></tr></thead>
        <tbody>${areas.map((a) => areaRow(month, fn, day, a)).join('')}</tbody>
      </table>
      ${anyArea ? '<p class="section-note">Each area is entered on its own. Areas don\'t add up to the plant total, so the board never sums them.</p>' : ''}
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
  const y = dayStatus(month, fn, day);
  const mo = monthStatus(month, fn, day);
  const notes = notesText(month, fn, day);
  const kpas = leadingIndicatorsFor(month, fn);
  const dayName = formatDayMedium(month, day);
  const offTrack = y.status === OFF || mo.status === OFF;

  const leading = kpas
    ? `<p class="section-sub">${esc(kpas.purpose)}.</p>
       <ol class="kbi-list">${kpas.kbis.map((k) => `<li><span class="kbi-level">${esc(k.level)}</span><span>${esc(k.text)}</span></li>`).join('')}</ol>
       <p class="kbi-lagging"><span>Results these protect:</span> ${esc(kpas.laggingLink)}</p>`
    : `<p class="section-sub">The workbook's KPA tab has no leading indicators for ${esc(fn.name)} yet.</p>`;

  dialog.innerHTML = `
    <div class="sheet-panel">
      <header class="sheet-head">
        <h2 class="sheet-title" id="detail-title" tabindex="-1">${esc(fn.name)}</h2>
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
          <p class="sheet-question">${esc(fn.dorQuestion)}</p>
        </div>
        <div class="kpis">
          <section class="kpi" data-status="${y.status}" aria-labelledby="kpi-day">
            <h3 class="kpi-label" id="kpi-day">${esc(dayHeading(month, day))}</h3>
            ${statusMarkup(y.status, { kpi: fn.kpiDaily })}
            ${bigFigure(y.actual, y.goal, fn.kpiDaily)}
            ${measureMarkup(month, fn.kpiDaily)}
          </section>
          <section class="kpi" data-status="${mo.status}" aria-labelledby="kpi-month">
            <h3 class="kpi-label" id="kpi-month">${esc(monthSoFar(month))}</h3>
            ${statusMarkup(mo.status, { kpi: fn.kpiMonthly })}
            ${mo.asOfDay === null ? '' : bigFigure(mo.actual, mo.goal, fn.kpiMonthly) + measureMarkup(month, fn.kpiMonthly)}
          </section>
        </div>
        ${offTrack ? escalateLink('escalate--top') : ''}

        ${areaSection(month, fn, day)}

        <section class="sheet-section" aria-labelledby="sec-days">
          <h3 class="section-title" id="sec-days">${esc(formatMonthName(month))}, day by day</h3>
          <p class="section-sub">${esc(plainLabel(fn.kpiDaily))}, plant total
            <span class="legend" aria-hidden="true"><span class="key key--bar"></span>Actual<span class="key key--goal"></span>Goal<svg class="key-glyph" aria-hidden="true" focusable="false"><use href="#g-off"></use></svg>Off goal</span></p>
          <div class="chart-host" data-chart="days"></div>
          <p class="chart-caption">${esc(recordText(month, fn, day))}</p>
          <button class="btn btn--text table-toggle" type="button" data-table-toggle aria-expanded="false" aria-controls="tbl-days">Show as table</button>
          <div class="table-wrap" id="tbl-days" hidden></div>
        </section>

        <section class="sheet-section" aria-labelledby="sec-mtd">
          <h3 class="section-title" id="sec-mtd">${esc(monthSoFar(month))}</h3>
          <p class="section-sub">${esc(plainLabel(fn.kpiMonthly))}, month to date${esc(lowerNote(fn.kpiMonthly))}
            <span class="legend" aria-hidden="true"><span class="key key--actual"></span>Actual<span class="key key--goal"></span>Goal</span></p>
          <div class="chart-host" data-chart="mtd"></div>
          <button class="btn btn--text table-toggle" type="button" data-table-toggle aria-expanded="false" aria-controls="tbl-mtd">Show as table</button>
          <div class="table-wrap" id="tbl-mtd" hidden></div>
        </section>

        <section class="sheet-section" aria-labelledby="sec-year">
          <h3 class="section-title" id="sec-year">This year</h3>
          <p class="section-sub">${esc(plainLabel(fn.kpiMonthly))} by month${esc(lowerNote(fn.kpiMonthly))}. ${esc(formatMonthName(month))} is so far, through ${esc(dayName)}. Months with no results yet stay empty.</p>
          <div class="chart-host" data-chart="year"></div>
          <button class="btn btn--text table-toggle" type="button" data-table-toggle aria-expanded="false" aria-controls="tbl-year">Show as table</button>
          <div class="table-wrap" id="tbl-year" hidden></div>
        </section>

        <section class="sheet-section" aria-labelledby="sec-notes">
          <div class="section-head">
            <h3 class="section-title" id="sec-notes">Problem → Next 24 hours</h3>
            <button class="btn btn--secondary" type="button" data-edit><span class="btn-label">Edit</span><span class="sr-only"> ${esc(fn.name)} numbers for ${esc(dayName)}</span></button>
          </div>
          <dl class="full-notes">
            <div><dt>What problem needs solving?</dt><dd class="${notes.problem.empty ? 'is-empty' : ''}">${esc(notes.problem.text)}</dd>${problemStatusMarkup(fn, day)}</div>
            <div><dt>What are we doing in the next 24 hours?</dt><dd class="${notes.action.empty ? 'is-empty' : ''}">${esc(notes.action.text)}</dd></div>
          </dl>
          ${enteredByMarkup(fn, day)}
        </section>

        <section class="sheet-section" aria-labelledby="sec-kbi">
          <h3 class="section-title" id="sec-kbi">What we watch to stay ahead</h3>
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

export function openDetail(month, fnId, day) {
  const fn = month.functions.find((f) => f.id === fnId);
  if (!fn) return false;
  const same = dialog.open && current?.fnId === fnId && current?.day === day;
  const wasOpen = dialog.open;
  current = { fnId, day };
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
  const fn = month.functions.find((f) => f.id === current.fnId);
  if (fn) render(month, fn, current.day);
}

export function closeDetail({ restoreFocus = true } = {}) {
  if (!dialog.open) return;
  const fnId = current?.fnId;
  dialog.close();
  charts.forEach((c) => c.destroy());
  charts = [];
  current = null;
  if (restoreFocus && fnId) document.querySelector(`#fn-${fnId} .fn-link`)?.focus({ preventScroll: false });
}
