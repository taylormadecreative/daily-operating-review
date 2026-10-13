// Export: download the selected day as CSV (built in the browser, no network),
// or print / save as PDF with the print stylesheet in css/home.css.

import { isoForDay, notesFor, AREA_IDS, kpiRowsFor } from './store.js?v=20261013-151156';
import { dayStatus, monthStatus, NOT_TRACKED } from './status.js?v=20261013-151156';
import { plainLabel, formatDayLong, formatDayMedium } from './format.js?v=20261013-151156';
import { homeWord, areaName, oneLine, hasProblem } from './home.js?v=20261013-151156';
import { actionsFor } from './actions.js?v=20261013-151156';
import { recordedOn, issueGap, ISSUE_GAP_WORD, actionStateFor } from './board.js?v=20261013-151156';
import { ISSUE_WORD } from './ui.js?v=20261013-151156';

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

/**
 * One row per KPI for the selected day. With an area picked (the home's Area filter), the day's
 * numbers are that area's (value, goal, status) and an Area column names it; the month stays the
 * plant total, as on the home's cards ("Month to date · Plant total"). KPIs added in Board setup
 * have a plant total only: "Not tracked by area".
 */
export function dayCsv(month, day, area = 'all') {
  const byArea = area !== 'all' && area !== 'plant' && AREA_IDS.includes(area);
  const where = byArea ? areaName(area) : '';
  const head = [
    'Production day', ...(byArea ? ['Area'] : []), 'Function', 'Owner',
    'Daily measure',
    ...(byArea
      ? [where, `${where} goal`, `${where} status`]
      : ['Plant total', 'Goal', 'Status', ...AREA_IDS.filter((a) => a !== 'plant').flatMap((a) => [areaName(a), `${areaName(a)} goal`])]),
    'Monthly measure', byArea ? 'Month so far, plant total' : 'Month so far', 'Month goal', 'Month status',
    'Issue', 'Action, next 24 hours', 'Issue status',
  ];
  // One row per KPI: each function's workbook KPI, then any added in Board setup.
  // `fn` is the KPI row, `parent` its function (the board's action and issue rules take both).
  const rows = month.functions.flatMap((f) => kpiRowsFor(f).map((k) => [f, k])).map(([parent, fn]) => {
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
    // A KPI added in Board setup isn't judged before the day it was added: say when it starts.
    const start = (fn.daily?.plant ?? []).find((r) => !r.beforeStart)?.day;
    const tracked = start ? `Tracked from ${formatDayMedium(month, start)}` : 'Not tracked yet';
    const actual = (s, kpi) => (typeof s.actual === 'number' ? csvNumber(s.actual, kpi.unit) : s.status === NOT_TRACKED ? 'Not tracked yet' : 'Not entered');
    const goal = (s, kpi) => csvNumber(s.goal, kpi.unit) || (s.status === NOT_TRACKED ? tracked : 'No goal set');
    // The register's actions for this day, like the board's Action cell: open ones, then ones done that day or later.
    const sentence = (t) => { const one = flat(t); return /[.!?]$/.test(one) ? one : `${one}.`; };
    const register = actionsFor(fn.fnId ?? fn.id, fn.primary === false ? fn.kpiId : null, isoForDay(month, day))
      .map((a) => (a.status === 'closed'
        ? `Done: ${sentence(a.text)} Owner: ${a.owner || fn.owner}.${a.closedDayIso ? ` Done ${a.closedDayIso}.` : ''}`
        : `${sentence(a.text)} Owner: ${a.owner || fn.owner}.${a.due ? ` Due ${a.due}.` : ''}`));
    // The board's words where a cell would otherwise be blank or contradict it: an off-goal KPI with
    // something recorded and no issue written reads "Off goal: issue not written yet" (never "No issue
    // reported"), and an empty action reads as the board's Action cell does ("Needs an action",
    // "None needed", "Nothing recorded").
    const gap = issueGap(month, parent, fn, day);
    const st = actionStateFor(month, parent, fn, day);
    const next = [n.source === null ? '' : flat(n.action), ...register].filter(Boolean).join('; ');
    // The picked area's day: value, goal and status (a KPI added in Board setup has none).
    const inArea = () => {
      if (fn.custom) return ['Not tracked by area', '', ''];
      const s = dayStatus(month, fn, day, area);
      return [actual(s, fn.kpiDaily), goal(s, fn.kpiDaily), homeWord(s.status, fn.kpiDaily)];
    };
    return [
      isoForDay(month, day), ...(byArea ? [where] : []), fn.name, fn.owner,
      plainLabel(fn.kpiDaily),
      ...(byArea ? inArea() : [actual(d, fn.kpiDaily), goal(d, fn.kpiDaily), homeWord(d.status, fn.kpiDaily), ...areas]),
      plainLabel(fn.kpiMonthly), actual(m, fn.kpiMonthly),
      goal(m, fn.kpiMonthly), homeWord(m.status, fn.kpiMonthly),
      // The board's words: a number entered on an added KPI with no notes is "No issue reported".
      !recordedOn(fn, day) ? 'Nothing recorded' : gap ? ISSUE_GAP_WORD : flat(n.problem) || 'No issue reported',
      // The note's action, then the register's actions for the day (owner, due date).
      next || st.word,
      // Same rule as the dashboard: a status only where there is a problem.
      hasProblem(n) ? (ISSUE_WORD[n.status] ?? 'Not set') : '',
    ];
  });
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

export function downloadCsv(month, day, area = 'all') {
  // BOM so Excel opens it as UTF-8.
  const blob = new Blob(['﻿', dayCsv(month, day, area)], { type: 'text/csv;charset=utf-8' });
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
  document.title = `${month.plant} plant, Daily Operating Review, ${formatDayLong(month, day)}`;
  window.addEventListener('afterprint', () => { document.title = before; }, { once: true });
  window.print();
}
