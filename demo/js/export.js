// Export: download the selected day as CSV (built in the browser, no network),
// or print / save as PDF with the print stylesheet in css/home.css.

import { isoForDay, notesFor, AREA_IDS, kpiRowsFor, entryInfo } from './store.js?v=20261123-135808';
import { dayStatus, monthStatus, NOT_TRACKED, statusWord } from './status.js?v=20261123-135808';
import { plainLabel, formatDayLong, formatDayMedium } from './format.js?v=20261123-135808';
import { homeWord, areaName, oneLine, hasProblem } from './home.js?v=20261123-135808';
import { actionsFor } from './actions.js?v=20261123-135808';
import { isVerifiedAction, ACTION_STATE_WORD } from './action-state.js?v=20261123-135808';
import { recordedOn, issueGap, ISSUE_GAP_WORD, actionStateFor } from './board.js?v=20261123-135808';
import { ISSUE_WORD } from './ui.js?v=20261123-135808';

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
  // Exports say what they are (spec §13): this one is the live board, not a finalized snapshot.
  const head = [
    'View', 'Production day', ...(byArea ? ['Area'] : []), 'Function', 'Owner',
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
      .map((a) => (isVerifiedAction(a)
        ? `Verified: ${sentence(a.text)} Owner: ${a.owner || fn.owner}.${a.closedDayIso ? ` Verified ${a.closedDayIso}.` : ''}`
        : `${sentence(a.text)} Owner: ${a.owner || fn.owner}. ${ACTION_STATE_WORD[a.status] ?? 'Open'}.${a.due ? ` Due ${a.due}.` : ''}`));
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
      'Live view', isoForDay(month, day), ...(byArea ? [where] : []), fn.name, fn.owner,
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

/** "2026-11-02 16:52" in the board's time zone; '' when there's no time. */
function stampIn(at, timeZone) {
  if (!at) return '';
  const t = new Date(at);
  if (Number.isNaN(t.getTime())) return '';
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t);
  } catch {
    return t.toISOString().slice(0, 16).replace('T', ' ');
  }
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/**
 * Every number on a pilot board, one row per measure per day, oldest first (PILOT-SPEC.md Part 4):
 * each production day from the first day through today, and any other day that has a number.
 * months: store.boardMonths(). The board's own words for blanks and statuses.
 */
export function boardCsv(months, { firstDay, today, timeZone }) {
  const head = ['Date', 'Function', 'Owner', 'Measure', 'Actual', 'Goal', 'Status', 'Issue', 'Action', 'Entered by', 'Entered at'];
  const rows = [];
  for (const month of months) {
    for (let day = 1; day <= month.daysInMonth; day += 1) {
      const iso = isoForDay(month, day);
      if ((firstDay && iso < firstDay) || (today && iso > today)) continue;
      const production = Boolean(month.productionDays?.[day]);
      for (const f of month.functions) {
        for (const fn of kpiRowsFor(f)) {
          const s = dayStatus(month, fn, day);
          const has = typeof s.actual === 'number';
          if (!production && !has) continue;
          const n = notesFor(fn, day);
          const info = entryInfo(fn, day);
          const unit = fn.kpiDaily?.unit;
          rows.push([
            iso, f.name, String(f.owner ?? '').trim(), plainLabel(fn.kpiDaily),
            has ? csvNumber(s.actual, unit) : s.status === NOT_TRACKED ? 'Not tracked yet' : 'Not entered',
            csvNumber(s.goal, unit) || 'No goal set',
            statusWord(s.status, fn.kpiDaily),
            oneLine(n.problem ?? ''), oneLine(n.action ?? ''),
            info?.enteredBy ?? '', stampIn(info?.enteredAt, timeZone),
          ]);
        }
      }
    }
  }
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

/** Save CSV text as a file (with a byte-order mark so Excel reads it as UTF-8). */
export function saveCsv(text, filename) {
  const blob = new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  document.title = `${month.plant} plant, Daily Operating Review, ${formatDayLong(month, day)} (live view)`;
  window.addEventListener('afterprint', () => { document.title = before; }, { once: true });
  window.print();
}
