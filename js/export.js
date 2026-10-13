// Export: download the selected day as CSV (built in the browser, no network),
// or print / save as PDF with the print stylesheet in css/home.css.

import { isoForDay, notesFor, AREA_IDS, kpiRowsFor } from './store.js?v=20261012-235706';
import { dayStatus, monthStatus } from './status.js?v=20261012-235706';
import { plainLabel, formatDayLong } from './format.js?v=20261012-235706';
import { homeWord, areaName, oneLine, hasProblem } from './home.js?v=20261012-235706';
import { ISSUE_WORD } from './ui.js?v=20261012-235706';

/** Plain numbers for spreadsheets: no thousands separators, at most two decimals, percents as "1.19%". */
function csvNumber(v, unit) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  if (unit === 'fraction') return `${Number((v * 100).toFixed(2))}%`;
  return String(Number(v.toFixed(2)));
}

/**
 * One CSV cell. Formula guard: text that starts with = + - @ (or a tab or
 * return) gets a leading ' so a spreadsheet shows it instead of running it.
 * Plain numbers ("-5.5", "1.19%") are left alone.
 */
const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?%?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per KPI for the selected day. */
export function dayCsv(month, day) {
  const head = [
    'Production day', 'Function', 'Owner',
    'Daily measure', 'Plant total', 'Goal', 'Status',
    ...AREA_IDS.filter((a) => a !== 'plant').flatMap((a) => [areaName(a), `${areaName(a)} goal`]),
    'Monthly measure', 'Month so far', 'Month goal', 'Month status',
    'Problem', 'Next 24 hours', 'Problem status',
  ];
  // One row per KPI: each function's workbook KPI, then any added in Board setup.
  const rows = month.functions.flatMap((f) => kpiRowsFor(f)).map((fn) => {
    const d = dayStatus(month, fn, day);
    const m = monthStatus(month, fn, day);
    const n = notesFor(fn, day);
    const areas = AREA_IDS.filter((a) => a !== 'plant').flatMap((a) => {
      if (fn.custom) return ['', ''];
      const s = dayStatus(month, fn, day, a);
      return [
        typeof s.actual === 'number' ? csvNumber(s.actual, fn.kpiDaily.unit) : 'Not entered',
        csvNumber(s.goal, fn.kpiDaily.unit) || 'No goal set',
      ];
    });
    // Same one-line form as Issues and Actions: "line one; line two".
    const flat = (t) => oneLine(t ?? '');
    return [
      isoForDay(month, day), fn.name, fn.owner,
      plainLabel(fn.kpiDaily), typeof d.actual === 'number' ? csvNumber(d.actual, fn.kpiDaily.unit) : 'Not entered',
      csvNumber(d.goal, fn.kpiDaily.unit) || 'No goal set', homeWord(d.status, fn.kpiDaily),
      ...areas,
      plainLabel(fn.kpiMonthly), typeof m.actual === 'number' ? csvNumber(m.actual, fn.kpiMonthly.unit) : 'Not entered',
      csvNumber(m.goal, fn.kpiMonthly.unit) || 'No goal set', homeWord(m.status, fn.kpiMonthly),
      n.source === null ? 'Not recorded for this day' : flat(n.problem) || 'No problem reported',
      n.source === null ? '' : flat(n.action),
      // Same rule as the dashboard: a status only where there is a problem.
      hasProblem(n) ? (ISSUE_WORD[n.status] ?? 'Not set') : '',
    ];
  });
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

export function downloadCsv(month, day, area = 'all') {
  // BOM so Excel opens it as UTF-8.
  const blob = new Blob(['﻿', dayCsv(month, day)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${month.plant.toLowerCase().replace(/\W+/g, '-')}-dor-${isoForDay(month, day)}${area === 'all' ? '' : `-${area}`}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return a.download;
}

export function printDay(month, day) {
  // The tab title becomes the PDF's suggested file name.
  const before = document.title;
  document.title = `${month.plant} DOR Dashboard, ${formatDayLong(month, day)}`;
  window.addEventListener('afterprint', () => { document.title = before; }, { once: true });
  window.print();
}
