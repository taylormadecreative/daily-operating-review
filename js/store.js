// Data layer. Every screen reads the month through this module, so a
// Supabase-backed version can replace it without touching the screens.
//
// Model: the month extracted from the plant's workbook (read-only JSON) plus a
// localStorage overlay of what people entered on this device. getMonth()
// returns a fresh merged copy; nothing outside this file touches storage.

import * as cloud from './cloud.js?v=20261120-154112';
import { todayIn, monthKey, daysInMonth, monthDate, productionCalendar, shiftMonth } from './calendar.js?v=20261120-154112';

const DATA_URL = new URL('../data/conneaut-2026-02.json?v=20261120-154112', import.meta.url);
const STARTER_URL = new URL('../data/starter-board.json?v=20261120-154112', import.meta.url);
const OVERLAY_KEY = 'dor.overlay.v1';
const SETUP_KEY = 'dor.setup.v1';
export const AREA_IDS = ['plant', 'mold', 'bond', 'prime', 'compounding'];

let base = null;
// A pilot board: { board, starter }. Each month is built from the board's setup, one at a time.
let pilot = null;

/**
 * Load the month once. The demo reads the workbook month (same-origin file only);
 * a pilot board (`{ board }` from cloud.openBoard()) starts from a blank month that
 * its Board setup fills in (PILOT-SPEC.md, "What a new board starts with").
 */
export async function load({ board = null } = {}) {
  if (!base && board) {
    const res = await fetch(STARTER_URL);
    if (!res.ok) throw new Error(`Could not load the board data (${res.status}).`);
    pilot = { board, starter: await res.json() };
    base = pilotMonth(pilot.board, pilot.starter);
  }
  if (!base) {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`Could not load the board data (${res.status}).`);
    base = await res.json();
  }
  return getMonth();
}

export { todayIn };

/** A pilot board's today in its time zone ('YYYY-MM-DD'); null in the demo. */
export const boardToday = (now = new Date()) => (pilot ? todayIn(pilot.board.timeZone, now) : null);
/** A pilot board's first day ('YYYY-MM-DD'); null in the demo. */
export const boardFirstDay = () => (pilot ? pilot.board.firstDay ?? null : null);

/**
 * Show another month (or the same month on a new today): rebuilds the month from the documents
 * already in memory and returns it. Screens keep working on day numbers within one month.
 * The demo has one month, so it only returns it.
 */
export function useMonth(month) {
  if (!pilot || !base) return getMonth();
  const next = pilotMonth(pilot.board, pilot.starter, month);
  if (next.month !== base.month) overlayMem = null;
  if (next.month !== base.month || next.boardDate !== base.boardDate) base = next;
  return getMonth();
}

/**
 * A pilot board's month: plant totals only, no numbers. It is this month (today in the board's
 * time zone) unless another is asked for, kept between the first day's month and this month.
 * boardDate is today in this month, else the month's last day.
 */
function pilotMonth(board, starter = {}, want = null) {
  const today = todayIn(board.timeZone);
  const first = board.firstDay && /^\d{4}-\d{2}-\d{2}$/.test(board.firstDay) ? board.firstDay : today;
  let m = typeof want === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(want) ? want : monthKey(today);
  if (m > monthKey(today)) m = monthKey(today);
  if (m < monthKey(first) && monthKey(first) <= monthKey(today)) m = monthKey(first);
  const n = daysInMonth(m);
  return {
    plant: board.name,
    month: m,
    daysInMonth: n,
    boardDate: m === monthKey(today) ? today : monthDate(m, n),
    firstDay: first,
    areas: [{ id: 'plant', name: 'Plant total' }],
    source: '',
    pilot: true,
    functions: [],
    leadingIndicators: starter.leadingIndicators ?? {},
    glossary: starter.glossary ?? {},
    notes: [],
  };
}

/** The numbers document's key. A pilot board keeps one per month, because entries are keyed by day of the month. */
function overlayKey(month = base.month) {
  return cloud.BOARD ? OVERLAY_KEY + '@' + month : OVERLAY_KEY;
}

/* ---------- Storage (all access guarded) ---------- */

/** One saved entry, each field the right type (a damaged one is dropped, never thrown). */
function cleanEntry(e) {
  if (!isObj(e) || typeof e.functionId !== 'string' || !Number.isInteger(e.day)) return null;
  const nums = (o) => {
    const out = {};
    if (isObj(o)) for (const [k, v] of Object.entries(o)) if (isNum(v) || v === null) out[k] = v;
    return out;
  };
  const text = (v) => (typeof v === 'string' ? v : null);
  const out = {
    functionId: e.functionId,
    day: e.day,
    values: nums(e.values),
    issue: text(e.issue),
    action: text(e.action),
    issueStatus: ISSUE_STATUS.includes(e.issueStatus) ? e.issueStatus : null,
    enteredBy: text(e.enteredBy),
    enteredAt: text(e.enteredAt),
  };
  if ('month' in e && (isNum(e.month) || e.month === null)) out.month = e.month;
  if (isObj(e.extra)) out.extra = nums(e.extra);
  if (isObj(e.extraNotes)) {
    out.extraNotes = {};
    for (const [k, n] of Object.entries(e.extraNotes)) {
      if (isObj(n)) out.extraNotes[k] = { issue: text(n.issue), action: text(n.action), status: ISSUE_STATUS.includes(n.status) ? n.status : null };
    }
  }
  return out;
}

function readOverlay(key = overlayKey()) {
  try {
    // After a refused write, this visit's copy is the truth (see writeOverlay).
    const mem = key === overlayKey() ? overlayMem : null;
    const raw = mem ? null : cloud.storage().getItem(key);
    const parsed = mem ?? (raw ? JSON.parse(raw) : null);
    if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') {
      const entries = {};
      for (const [key, e] of Object.entries(parsed.entries)) {
        const clean = cleanEntry(e);
        if (clean) entries[key] = clean;
      }
      return { version: 1, entries };
    }
  } catch { /* blocked or corrupt: fall through to empty */ }
  return { version: 1, entries: {} };
}

// When this browser won't save (private window, storage off), numbers entered
// still show for this visit from this copy, like Board setup's setupMem.
let overlayMem = null;

/** Returns false when the browser refused: the change then lives in this visit's copy only. */
function writeOverlay(overlay) {
  try {
    cloud.storage().setItem(overlayKey(), JSON.stringify(overlay));
    overlayMem = null;
    return true;
  } catch {
    overlayMem = structuredClone(overlay);
    return false;
  }
}

export const entryKey = (functionId, day) => `${functionId}|${day}`;

/* ---------- Data-quality rules (from the file's own notes) ---------- */

// notes[3]: Engineering area goals for Bond, Prime and Compounding are
// placeholders in the source (2, 1, -5.5..0.5). Treat them as "goal not set".
const PLACEHOLDER_GOALS = { engineering: ['bond', 'prime', 'compounding'] };

function applyDataQuality(month) {
  for (const fn of month.functions) {
    for (const areaId of PLACEHOLDER_GOALS[fn.id] ?? []) {
      for (const row of fn.daily[areaId] ?? []) {
        if (row.goal !== null) { row.sourceGoal = row.goal; row.goal = null; row.goalNote = 'placeholder'; }
      }
    }
  }
}

// Separate notes (issue, issueExtra) are kept as paragraphs, so the dashboard
// can show one row per note while other screens show plain line breaks.
const joinText = (...parts) => parts.filter((t) => typeof t === 'string' && t.trim()).join('\n\n') || null;

export const ISSUE_STATUS = ['open', 'in-progress', 'closed'];

function applyOverlay(month, overlay) {
  const boardDay = Number(month.boardDate.slice(8, 10));
  const all = [...month.functions, ...(month.hiddenFunctions ?? [])];
  for (const fn of all) {
    // The workbook keeps one day's text: the board date. A function added in
    // Board setup isn't in the workbook, so it has no note until someone enters one.
    fn.notesByDay = fn.custom ? {} : {
      [boardDay]: {
        problem: joinText(fn.issue, fn.issueExtra),
        action: joinText(fn.action, fn.actionExtra),
        status: null, // the workbook has no problem status: "Not set"
        source: 'workbook',
      },
    };
    fn.entries = {};
  }
  for (const entry of Object.values(overlay.entries)) {
    const fn = all.find((f) => f.id === entry.functionId);
    if (!fn || !Number.isInteger(entry.day)) continue;
    // A save keeps the whole form, so "Entered by" goes on the function's own KPI only when
    // something of it differs from the workbook (a save that only filled in a KPI added in
    // Board setup leaves the main row as it was; applyExtraEntries marks that KPI's row).
    let changed = false;
    for (const areaId of AREA_IDS) {
      if (!(areaId in (entry.values ?? {}))) continue;
      const row = (fn.daily[areaId] ?? []).find((r) => r.day === entry.day);
      if (!row) continue;
      if (!sameNumber(row.actual, entry.values[areaId])) changed = true;
      row.actual = entry.values[areaId];
    }
    if ('month' in entry) {
      const row = (fn.monthToDate ?? []).find((r) => r.day === entry.day);
      if (row && !sameNumber(row.actual, entry.month)) changed = true;
      if (row) row.actual = entry.month;
    }
    const before = fn.notesByDay[entry.day] ?? { problem: null, action: null, status: null };
    const status = ISSUE_STATUS.includes(entry.issueStatus) ? entry.issueStatus : null;
    if (!sameText(before.problem, entry.issue) || !sameText(before.action, entry.action) || (before.status ?? null) !== status) changed = true;
    fn.notesByDay[entry.day] = {
      problem: entry.issue ?? null,
      action: entry.action ?? null,
      status,
      source: 'entered',
    };
    fn.entries[entry.day] = { enteredBy: entry.enteredBy, enteredAt: entry.enteredAt, changed };
  }
}

/** Two stored numbers the same (missing and null are both "no number"). */
const sameNumber = (a, b) => (isNum(a) && isNum(b) ? Math.abs(a - b) < 1e-9 : (a ?? null) === (b ?? null));
/** Two notes the same, whatever their spacing ("" and null are both "no note"). */
const sameText = (a, b) => String(a ?? '').replace(/\s+/g, ' ').trim() === String(b ?? '').replace(/\s+/g, ' ').trim();

/* ---------- Board setup (this device): plant, functions, owners, KPIs ---------- */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const UNITS = [
  { id: 'count', name: 'Count', rollup: 'total' },
  { id: 'fraction', name: 'Percent', rollup: 'average' },
  { id: 'number', name: 'Number', rollup: 'average' },
  { id: 'people', name: 'People', rollup: 'average' },
  { id: 'parts', name: 'Parts', rollup: 'total' },
  { id: 'hours', name: 'Hours', rollup: 'total' },
];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** The Weekly review's rules (js/weekly.js RULE_IDS; repeated here so this module stays free of it). */
export const WEEKLY_RULE_IDS = ['sum', 'mean', 'weighted', 'latest', 'weekly-only'];
const emptySetup = () => ({ version: 1, plant: null, functions: {}, added: [], kpis: {}, order: null });

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const okId = (id) => typeof id === 'string' && id.length > 0 && id.length < 60 && !id.includes('--') && !id.includes('|');

const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v) => (isNum(v) ? Number(v.toFixed(8)) : undefined);

/**
 * Board setup's caps, the same as the boxes' maxlength in js/setup.js, so what's typed is what
 * the board shows (never a name cut mid-word here).
 */
export const NAME_MAX = { plant: 60, fn: 60, owner: 80, kpi: 80 };

/** One function's setup: only known fields, each the right type. */
function cleanFunctionSetup(f) {
  const out = {
    name: str(f.name, NAME_MAX.fn),
    owner: str(f.owner, NAME_MAX.owner),
    question: str(f.question, 200),
    photo: typeof f.photo === 'string' && f.photo.startsWith('data:image/') ? f.photo : undefined,
    kpiLabel: str(f.kpiLabel, NAME_MAX.kpi),
    monthLabel: str(f.monthLabel, NAME_MAX.kpi),
    dayGoal: num(f.dayGoal),
    monthGoal: num(f.monthGoal),
    hidden: f.hidden === true ? true : undefined,
    icon: str(f.icon, 30),
    // The Weekly review's rule for the workbook KPI (js/weekly.js); unset = its default.
    weeklyRule: WEEKLY_RULE_IDS.includes(f.weeklyRule) ? f.weeklyRule : undefined,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/** A goal history: dated entries, sorted by date, one per date (the later one kept). */
function cleanGoals(list) {
  const byDate = new Map();
  for (const g of list) {
    if (isObj(g) && typeof g.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(g.from)) {
      byDate.set(g.from, { from: g.from, goal: isNum(g.goal) ? Number(g.goal.toFixed(8)) : null });
    }
  }
  return [...byDate.values()].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/** Every field checked, so a damaged record can never stop the board from loading. */
function normalizeSetup(raw) {
  const s = emptySetup();
  if (!isObj(raw) || raw.version !== 1) return s;
  if (typeof raw.plant === 'string' && raw.plant.trim()) s.plant = raw.plant.trim().slice(0, NAME_MAX.plant);
  if (isObj(raw.functions)) {
    for (const [id, f] of Object.entries(raw.functions)) if (okId(id) && isObj(f)) s.functions[id] = cleanFunctionSetup(f);
  }
  if (Array.isArray(raw.added)) {
    s.added = raw.added.filter((a) => isObj(a) && okId(a.id)).map((a) => ({
      id: a.id,
      name: typeof a.name === 'string' ? a.name.slice(0, NAME_MAX.fn) : 'New function',
      owner: typeof a.owner === 'string' ? a.owner.slice(0, NAME_MAX.owner) : 'Owner name',
      question: typeof a.question === 'string' ? a.question : '',
    }));
  }
  if (isObj(raw.kpis)) {
    for (const [id, list] of Object.entries(raw.kpis)) {
      if (!okId(id) || !Array.isArray(list)) continue;
      s.kpis[id] = list.filter((k) => isObj(k) && okId(k.id)).map((k) => ({
        id: k.id,
        // Capped like every other name (a 95-character KPI name made a 7-line cell on the TV).
        name: typeof k.name === 'string' && k.name.trim() ? k.name.slice(0, NAME_MAX.kpi) : 'KPI',
        unit: UNITS.some((u) => u.id === k.unit) ? k.unit : 'count',
        better: k.better === 'lower' ? 'lower' : 'higher',
        goal: isNum(k.goal) ? Number(k.goal.toFixed(8)) : null,
        ...(k.rollup === 'total' || k.rollup === 'average' ? { rollup: k.rollup } : {}),
        ...(isNum(k.monthGoal) ? { monthGoal: k.monthGoal } : {}),
        ...(Number.isInteger(k.startDay) ? { startDay: k.startDay } : {}),
        // A pilot board's measures start on a full date (PILOT-SPEC.md, Part 2).
        ...(typeof k.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k.startDate) ? { startDate: k.startDate } : {}),
        // A pilot board's goal history: each goal holds from its date until the next one.
        ...(Array.isArray(k.goals) ? { goals: cleanGoals(k.goals) } : {}),
        ...(WEEKLY_RULE_IDS.includes(k.weeklyRule) ? { weeklyRule: k.weeklyRule } : {}),
      }));
    }
  }
  if (Array.isArray(raw.order)) s.order = raw.order.filter(okId);
  return s;
}

// When this browser blocks storage, Board setup still works for the visit from this copy.
let setupMem = null;
// A write was refused (quota, storage off): the stored copy is now older than this
// visit's, so this visit's copy is the truth until a write goes through (like the overlay).
let setupWriteFailed = false;

export function readSetup() {
  if (setupWriteFailed && setupMem) return normalizeSetup(setupMem);
  try {
    const raw = cloud.storage().getItem(SETUP_KEY);
    return normalizeSetup(raw ? JSON.parse(raw) : setupMem);
  } catch {
    return normalizeSetup(setupMem); // blocked or corrupt: this visit's copy, else the workbook's setup
  }
}

export function writeSetup(setup) {
  setupMem = structuredClone(setup);
  try {
    cloud.storage().setItem(SETUP_KEY, JSON.stringify(setup));
    setupWriteFailed = false;
    return true;
  } catch {
    setupWriteFailed = true;
    return false;
  }
}

export function hasSetup() {
  const s = readSetup();
  return Boolean(s.plant || Object.keys(s.functions).length || s.added.length || Object.keys(s.kpis).length || s.order);
}

export function resetSetup() {
  const snapshot = readSetup();
  if (cloud.BOARD) return snapshot; // a real board's setup is never cleared from the app
  setupMem = null;
  setupWriteFailed = false;
  try { cloud.storage().removeItem(SETUP_KEY); } catch { /* ignore */ }
  return snapshot;
}

/* ---------- Start the demo over ---------- */

/**
 * Clear everything this demo saved on the device (numbers, Board setup, actions,
 * minutes, Customize, tours, who's entering) so the next visitor starts clean.
 * Returns a snapshot for Undo.
 */
export function resetEverything() {
  if (cloud.BOARD) return null; // a real board can never be cleared from the app
  const snapshot = { local: {}, session: {} };
  for (const name of ['local', 'session']) {
    try {
      const area = name === 'local' ? globalThis.localStorage : globalThis.sessionStorage; // can throw when blocked
      for (let i = 0; i < area.length; i += 1) {
        const k = area.key(i);
        if (k?.startsWith('dor.') && k !== RESET_UNDO_KEY) snapshot[name][k] = area.getItem(k);
      }
      for (const k of Object.keys(snapshot[name])) area.removeItem(k);
    } catch { /* blocked: nothing saved there to clear */ }
  }
  setupMem = null;
  setupWriteFailed = false;
  overlayMem = null; // this visit's numbers go too, even when the browser was refusing writes
  orgMem = null;     // and this visit's Organization
  orgWriteFailed = false;
  weeklyMem = null;  // and this visit's Weekly review
  weeklyWriteFailed = false;
  return snapshot;
}

export function restoreEverything(snapshot) {
  let ok = true;
  for (const name of ['local', 'session']) {
    try {
      const area = name === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
      for (const [k, v] of Object.entries(snapshot?.[name] ?? {})) if (typeof v === 'string') area.setItem(k, v);
    } catch { ok = false; }
  }
  return ok;
}

export const RESET_UNDO_KEY = 'dor.reset.undo';

/** Does this browser keep what's saved here? (A private window or blocked storage doesn't.) */
export function storageWorks() {
  try {
    localStorage.setItem('dor.probe', '1');
    localStorage.removeItem('dor.probe');
    return true;
  } catch {
    return false;
  }
}

/** A KPI's unit changed to or from percent: its stored numbers change scale with it (5 stays 5%, not 500%). */
export function scaleExtraValues(fnId, kpiId, factor) {
  const overlay = readOverlay();
  let changed = false;
  for (const entry of Object.values(overlay.entries)) {
    if (entry.functionId !== fnId) continue;
    // A function added in Board setup keeps its first KPI's numbers as its plant total.
    if (entry.extra && isNum(entry.extra[kpiId])) { entry.extra[kpiId] = Number((entry.extra[kpiId] * factor).toFixed(8)); changed = true; }
  }
  return changed ? writeOverlay(overlay) : true;
}

/** Same, for the plant-total number of a function added in Board setup (its first KPI). */
export function scalePrimaryValues(fnId, factor) {
  const overlay = readOverlay();
  let changed = false;
  for (const entry of Object.values(overlay.entries)) {
    if (entry.functionId !== fnId || !isNum(entry.values?.plant)) continue;
    entry.values.plant = Number((entry.values.plant * factor).toFixed(8));
    changed = true;
  }
  return changed ? writeOverlay(overlay) : true;
}

/**
 * The plant's production calendar from the workbook, worked out once, before Board setup changes
 * any goal: Operations' parts goal decides (> 0 runs, 0 doesn't), else the Plant earned-hours goal;
 * null when neither has one. status.js isProductionDay reads it (month.productionDays), so a daily
 * goal of 0 typed in Board setup never turns the month into "No production".
 */
function workbookCalendar(month) {
  const ops = month.functions.find((f) => f.id === 'operations');
  const plant = month.functions.find((f) => f.id === 'plant');
  const cal = {};
  for (let d = 1; d <= month.daysInMonth; d += 1) {
    const o = ops?.daily?.plant?.find((r) => r.day === d);
    const p = plant?.daily?.plant?.find((r) => r.day === d);
    cal[d] = isNum(o?.goal) ? o.goal > 0 : isNum(p?.goal) ? p.goal > 0 : null;
  }
  return cal;
}

/** Production days for Board setup's goals and KPIs (a day the calendar doesn't know counts as scheduled). */
function productionMap(calendar) {
  return Object.fromEntries(Object.entries(calendar).map(([d, v]) => [d, v ?? true]));
}

/**
 * The day of this month a KPI starts. The demo stores a day of the month; a pilot board stores the
 * full date (startDate), so a later month starts on its 1st and an earlier one never starts
 * (daysInMonth + 1). Nothing starts before the board's first day.
 */
function startDayOf(month, k) {
  if (!month.pilot) return Number.isInteger(k.startDay) && k.startDay >= 1 ? k.startDay : 1;
  const dayIn = (iso) => {
    if (!iso) return 1;
    const m = monthKey(iso);
    return m < month.month ? 1 : m > month.month ? month.daysInMonth + 1 : Number(iso.slice(8, 10));
  };
  return Math.max(dayIn(k.startDate), dayIn(month.firstDay));
}

/** A KPI's daily goal on a day: on a pilot board, the latest dated goal on or before that day. */
function goalOn(month, k, day) {
  if (month.pilot && k.goals?.length) {
    const iso = monthDate(month.month, day);
    let goal = null;
    for (const g of k.goals) if (g.from <= iso) goal = g.goal; else break;
    return goal;
  }
  return isNum(k.goal) ? k.goal : null;
}

/** A KPI row that isn't in the workbook: same shape as a function, with no numbers yet. */
function newKpiRow(month, fn, k, prod) {
  const unit = UNITS.find((u) => u.id === k.unit) ?? UNITS[0];
  const kpi = { name: k.name, boardLabel: k.name, unit: unit.id, better: k.better === 'lower' ? 'lower' : 'higher' };
  const days = [];
  for (let d = 1; d <= month.daysInMonth; d += 1) days.push({ day: d, actual: null, goal: prod[d] ? goalOn(month, k, d) : null });
  return {
    id: `${fn.id}--${k.id}`,
    kpiId: k.id,
    fnId: fn.id,
    primary: false,
    custom: true,
    // The board day it was added on: days before it read as "not tracked yet", not as misses.
    startDay: startDayOf(month, k),
    rollup: k.rollup === 'total' || k.rollup === 'average' ? k.rollup : unit.rollup,
    // A pilot board works the month goal out from the daily goals (finishKpiRow).
    monthGoal: isNum(k.monthGoal) && !month.pilot ? k.monthGoal : null,
    weeklyRule: WEEKLY_RULE_IDS.includes(k.weeklyRule) ? k.weeklyRule : null,
    name: fn.name,
    owner: fn.owner,
    ownerPhoto: fn.ownerPhoto ?? null,
    dorQuestion: fn.dorQuestion,
    kpiDaily: kpi,
    kpiMonthly: { ...kpi },
    daily: { plant: days },
    monthToDate: [],
    monthly: MONTHS.map((m) => ({ month: m, actual: null, goal: null })),
    notesByDay: {},
    entries: {},
  };
}

/**
 * Month to date and the year for a KPI row that isn't in the workbook, from its daily numbers.
 * On a pilot board each day can have its own goal (a goal change starts on its date): an average's
 * goal so far is the latest day's, and the month goal is the sum of the production days' goals
 * (total) or the last production day's goal (average). A pilot board's year (row.monthly) is filled
 * from yearRows() in getMonth(), actuals and goals both; here it fills only goals, in the demo.
 */
function finishKpiRow(month, row, prod) {
  let sum = 0; let n = 0; let goalSum = 0; let goalN = 0; let prodDays = 0; let allGoals = 0;
  let lastGoal = null; let anyGoal = false;
  const dayGoal = row.daily.plant.find((r) => isNum(r.goal))?.goal ?? null;
  // Tracking starts the day it was added, or earlier if someone entered an earlier day.
  const firstNumber = row.daily.plant.find((r) => isNum(r.actual))?.day ?? Infinity;
  const start = Math.min(row.startDay ?? 1, firstNumber);
  for (const r of row.daily.plant) {
    r.beforeStart = r.day < start;
    if (r.beforeStart) r.goal = null;
  }
  row.monthToDate = row.daily.plant.map((r) => {
    if (prod[r.day] && !r.beforeStart) {
      prodDays += 1;
      if (isNum(r.goal)) { allGoals += r.goal; anyGoal = true; lastGoal = r.goal; } else lastGoal = null;
    }
    // Every day with a number counts (Saturday overtime too); goals only on scheduled days.
    if (isNum(r.actual)) {
      sum += r.actual; n += 1;
      // A total is judged against the goals of the days that have a number (pace, not the whole month).
      if (isNum(r.goal)) { goalSum += r.goal; goalN += 1; }
    }
    const actual = n ? (row.rollup === 'total' ? sum : sum / n) : null;
    let goal;
    if (row.rollup === 'total') goal = n ? (goalN ? goalSum : null) : (isNum(dayGoal) ? allGoals : null);
    else goal = month.pilot ? (lastGoal ?? dayGoal) : dayGoal;
    if (r.beforeStart) return { day: r.day, actual: null, goal: null, beforeStart: true };
    return { day: r.day, actual, goal };
  });
  const dailyGoal = row.daily.plant.find((r) => isNum(r.goal))?.goal ?? null;
  if (month.pilot) {
    row.monthGoal = row.rollup === 'total' ? (anyGoal ? Number(allGoals.toFixed(8)) : null) : lastGoal;
    return;
  }
  const monthGoal = isNum(row.monthGoal) ? row.monthGoal
    : !isNum(dailyGoal) ? null
      : row.rollup === 'total' ? dailyGoal * prodDays : dailyGoal;
  // Months before this one: the KPI didn't exist yet, so no goal there.
  const thisMonth = Number(month.month.slice(5, 7)) - 1;
  row.monthly = row.monthly.map((m, i) => ({ ...m, goal: i >= thisMonth ? monthGoal : null }));
}

/** A month-to-date goal that climbs through the month (a running pace), not one number. */
function isRunningGoal(rows) {
  const goals = rows.map((r) => r.goal).filter((g) => isNum(g) && g > 0);
  if (goals.length < 3) return false;
  for (let i = 1; i < goals.length; i += 1) if (goals[i] < goals[i - 1]) return false;
  return goals[goals.length - 1] >= goals[0] * 2;
}

function applySetup(month, setup, prod) {
  month.sourcePlant = month.plant;
  if (setup.plant) month.plant = setup.plant;
  // New functions first, so their KPIs and order can be set like any other.
  for (const a of setup.added ?? []) {
    if (!a?.id || month.functions.some((f) => f.id === a.id)) continue;
    const fn = { id: a.id, name: a.name || 'New function', owner: a.owner || 'Owner', dorQuestion: a.question ?? '', custom: true, icon: a.icon ?? null };
    const first = (setup.kpis?.[a.id] ?? [])[0];
    const row = newKpiRow(month, fn, first ?? { id: 'kpi', name: 'KPI', unit: 'count', better: 'higher', goal: null }, prod);
    Object.assign(fn, { kpiDaily: row.kpiDaily, kpiMonthly: row.kpiMonthly, daily: row.daily, monthToDate: [], monthly: row.monthly, rollup: row.rollup, monthGoal: row.monthGoal, startDay: row.startDay, weeklyRule: row.weeklyRule, firstKpiId: first?.id ?? 'kpi' });
    month.functions.push(fn);
  }
  for (const fn of month.functions) {
    const f = setup.functions?.[fn.id] ?? {};
    fn.sourceQuestion = fn.dorQuestion;
    if (f.name) fn.name = f.name;
    if (f.owner) fn.owner = f.owner;
    if (typeof f.question === 'string') fn.dorQuestion = f.question;
    fn.ownerPhoto = typeof f.photo === 'string' && f.photo.startsWith('data:image/') ? f.photo : null;
    if (f.icon) fn.icon = f.icon;
    if (!fn.custom) fn.weeklyRule = WEEKLY_RULE_IDS.includes(f.weeklyRule) ? f.weeklyRule : null;
    // The workbook KPI: a new display name, and goals set here instead of the plan's.
    if (!fn.custom) {
      fn.sourceDayLabel = fn.kpiDaily.boardLabel;
      fn.sourceMonthLabel = fn.kpiMonthly.boardLabel;
      if (f.kpiLabel) fn.kpiDaily = { ...fn.kpiDaily, boardLabel: f.kpiLabel };
      if (f.monthLabel) fn.kpiMonthly = { ...fn.kpiMonthly, boardLabel: f.monthLabel };
      // Some month goals are a running pace (Plant earned hours: 616, 1,232, ... 12,320), most are one number.
      const mtd = fn.monthToDate ?? [];
      const running = isRunningGoal(mtd);
      if (isNum(f.dayGoal)) {
        for (const r of fn.daily.plant ?? []) if (prod[r.day]) r.goal = f.dayGoal;
        if (running && !isNum(f.monthGoal)) {
          let total = 0;
          for (const r of mtd) { if (prod[r.day]) total += f.dayGoal; r.goal = total; }
        }
      }
      if (isNum(f.monthGoal)) {
        if (running) {
          const days = Object.values(prod).filter(Boolean).length || 1;
          let through = 0;
          for (const r of mtd) { if (prod[r.day]) through += 1; r.goal = Number(((f.monthGoal * through) / days).toFixed(4)); }
        } else {
          for (const r of mtd) r.goal = f.monthGoal;
        }
        // From this month on: months already closed keep the goal they were judged against.
        const from = Number(month.month.slice(5, 7)) - 1;
        (fn.monthly ?? []).forEach((r, i) => { if (i >= from) r.goal = f.monthGoal; });
      }
    }
    const extra = (setup.kpis?.[fn.id] ?? []).filter((k) => k?.id && k.id !== fn.firstKpiId);
    fn.extraKpis = extra.map((k) => newKpiRow(month, fn, k, prod));
  }
  // Order, then hide what was removed (kept aside: production days still read Operations and Plant).
  if (Array.isArray(setup.order)) {
    const rank = new Map(setup.order.map((id, i) => [id, i]));
    month.functions.sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  }
  // The full meeting order, removed functions still in their places (so Put back returns them there).
  month.order = month.functions.map((f) => f.id);
  month.hiddenFunctions = month.functions.filter((fn) => setup.functions?.[fn.id]?.hidden);
  month.functions = month.functions.filter((fn) => !setup.functions?.[fn.id]?.hidden);
}

/** Numbers typed for KPIs that aren't in the workbook. */
function applyExtraEntries(month, overlay, prod) {
  const all = [...month.functions, ...(month.hiddenFunctions ?? [])];
  for (const entry of Object.values(overlay.entries)) {
    const fn = all.find((f) => f.id === entry.functionId);
    if (!fn || !Number.isInteger(entry.day)) continue;
    // An added KPI's row says who entered it when the save gave it a number or a note.
    const stamp = (row) => { row.entries[entry.day] = { enteredBy: entry.enteredBy, enteredAt: entry.enteredAt, changed: true }; };
    for (const [kpiId, value] of Object.entries(entry.extra ?? {})) {
      const row = fn.extraKpis?.find((k) => k.kpiId === kpiId);
      const r = row?.daily.plant.find((x) => x.day === entry.day);
      if (r) r.actual = isNum(value) ? value : null;
      if (r && isNum(value)) stamp(row);
    }
    for (const [kpiId, n] of Object.entries(entry.extraNotes ?? {})) {
      const row = fn.extraKpis?.find((k) => k.kpiId === kpiId);
      if (row) row.notesByDay[entry.day] = { problem: n?.issue ?? null, action: n?.action ?? null, status: ISSUE_STATUS.includes(n?.status) ? n.status : null, source: 'entered' };
      if (row && [n?.issue, n?.action].some((t) => typeof t === 'string' && t.trim())) stamp(row);
    }
  }
  for (const fn of all) {
    if (fn.custom) finishKpiRow(month, fn, prod);
    for (const row of fn.extraKpis ?? []) {
      row.name = fn.name; row.owner = fn.owner; row.ownerPhoto = fn.ownerPhoto; row.dorQuestion = fn.dorQuestion;
      finishKpiRow(month, row, prod);
    }
  }
}

/* ---------- Organization (spec §3): people, roles, who answers for each function ----------
   Stored on this device under dor.org.v1 as { version, active, draft, rev, checked, activatedAt }.
   Until an organization is activated, `active` is null and the organization is read from the board
   (one person per function owner, the Plant owner accountable for every function). Board setup
   edits a draft (a copy); Validate checks it; Activate makes it the one the pages use. Roles are
   shown, not enforced: the connected version checks sign-in. */

const ORG_KEY = 'dor.org.v1';
export const ROLES = [
  { id: 'admin', name: 'Administrator' },
  { id: 'leader', name: 'Site or department leader' },
  { id: 'contributor', name: 'Contributor' },
  { id: 'facilitator', name: 'Facilitator' },
  { id: 'verifier', name: 'Verifier' },
  { id: 'executive', name: 'Read-only executive' },
];
/** The DOR keeps each owner's morning to a few numbers (spec §1, §4: "at most 1–3"). */
export const DAILY_MEASURE_MAX = 3;
export const WEEKDAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
export const ORG_NAME_MAX = 80;

let orgMem = null;
let orgWriteFailed = false;

const emptyOrgDoc = () => ({ version: 1, active: null, draft: null, rev: 0, checked: null, activatedAt: null, daysOff: [], extraDays: [] });

/**
 * Days off and extra production days: ISO dates, sorted, no repeats. They sit at the top of the
 * organization document, beside active and draft, because they take effect when saved, with no
 * Validate or Activate (PILOT-SPEC.md D8), and merge as one group (js/merge.js).
 */
const cleanDays = (v) => [...new Set((Array.isArray(v) ? v : []).map(dayKey).filter(Boolean))].sort();

function cleanOrg(o) {
  if (!isObj(o)) return null;
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const ids = new Set();
  const people = (Array.isArray(o.people) ? o.people : []).filter((p) => isObj(p) && okId(p.id) && !ids.has(p.id) && ids.add(p.id)).map((p) => ({
    id: p.id,
    name: text(p.name, NAME_MAX.owner),
    title: text(p.title, NAME_MAX.owner),
    roles: Array.isArray(p.roles) ? ROLES.map((r) => r.id).filter((r) => p.roles.includes(r)) : [],
    reportsTo: okId(p.reportsTo) ? p.reportsTo : null,
  }));
  const functions = {};
  if (isObj(o.functions)) {
    for (const [id, f] of Object.entries(o.functions)) {
      if (okId(id) && isObj(f)) functions[id] = { responsible: okId(f.responsible) ? f.responsible : null, accountable: okId(f.accountable) ? f.accountable : null };
    }
  }
  const list = (v, max) => (Array.isArray(v) ? v : []).filter((x) => isObj(x) && okId(x.id)).map((x) => ({ id: x.id, name: text(x.name, max) }));
  const areas = (Array.isArray(o.areas) ? o.areas : []).filter((a) => isObj(a) && okId(a.id)).map((a) => ({ id: a.id, name: text(a.name, 40), lead: okId(a.lead) ? a.lead : null }));
  return {
    name: text(o.name, ORG_NAME_MAX),
    timeZone: text(o.timeZone, 60),
    weekStart: o.weekStart === 'sun' ? 'sun' : 'mon',
    productionDays: Array.isArray(o.productionDays) ? WEEKDAYS.map(([d]) => d).filter((d) => o.productionDays.includes(d)) : ['mon', 'tue', 'wed', 'thu', 'fri'],
    cutoff: typeof o.cutoff === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.cutoff) ? o.cutoff : '',
    areas,
    shifts: list(o.shifts, 40),
    people,
    functions,
    // Action verification (spec §12): an owner can't verify their own action unless this is on.
    allowSelfVerify: o.allowSelfVerify === true,
  };
}

function readOrgDoc() {
  let raw = null;
  if (orgWriteFailed && orgMem) raw = orgMem;
  else {
    try { raw = JSON.parse(cloud.storage().getItem(ORG_KEY) ?? 'null') ?? orgMem; } catch { raw = orgMem; }
  }
  const doc = emptyOrgDoc();
  if (!isObj(raw) || raw.version !== 1) return doc;
  doc.active = cleanOrg(raw.active);
  doc.draft = cleanOrg(raw.draft);
  doc.rev = Number.isInteger(raw.rev) && raw.rev >= 0 ? raw.rev : 0;
  doc.activatedAt = typeof raw.activatedAt === 'string' ? raw.activatedAt : null;
  doc.daysOff = cleanDays(raw.daysOff);
  doc.extraDays = cleanDays(raw.extraDays);
  if (isObj(raw.checked) && Number.isInteger(raw.checked.rev) && Array.isArray(raw.checked.issues)) {
    doc.checked = {
      rev: raw.checked.rev,
      ok: raw.checked.ok === true,
      at: typeof raw.checked.at === 'string' ? raw.checked.at : null,
      issues: raw.checked.issues.filter((i) => isObj(i) && typeof i.text === 'string').map((i) => ({ code: String(i.code ?? ''), text: i.text, focus: typeof i.focus === 'string' ? i.focus : null })),
    };
  }
  return doc;
}

/** Returns false when the browser refused: the change then holds for this visit only. */
function writeOrgDoc(doc) {
  orgMem = structuredClone(doc);
  try {
    cloud.storage().setItem(ORG_KEY, JSON.stringify(doc));
    orgWriteFailed = false;
    return true;
  } catch {
    orgWriteFailed = true;
    return false;
  }
}

/**
 * The organization read from the board, before anyone activated one: a person for each function's
 * owner (one person for a name that owns several), titled "{Function} lead" and the Plant owner
 * "Plant manager", every lead reporting to the Plant owner, who is the accountable leader for every
 * function. Titles and roles are starting points, all editable in Board setup.
 */
export function defaultOrg(month) {
  const people = [];
  const byName = new Map();
  const plantFn = month.functions.find((f) => f.id === 'plant') ?? null;
  for (const fn of month.functions) {
    const name = String(fn.owner ?? '').trim();
    if (!name || /^owner( name)?$/i.test(name) || byName.has(name.toLowerCase())) continue;
    const person = {
      id: `p-${fn.id}`,
      name,
      title: fn.id === 'plant' ? 'Plant manager' : `${fn.name} lead`,
      roles: fn.id === 'plant' ? ['admin', 'leader', 'facilitator', 'verifier'] : ['leader', 'contributor'],
      reportsTo: null,
    };
    byName.set(name.toLowerCase(), person);
    people.push(person);
  }
  const top = plantFn ? byName.get(String(plantFn.owner ?? '').trim().toLowerCase()) ?? null : null;
  for (const p of people) if (top && p !== top) p.reportsTo = top.id;
  const functions = {};
  for (const fn of month.functions) {
    functions[fn.id] = { responsible: byName.get(String(fn.owner ?? '').trim().toLowerCase())?.id ?? null, accountable: top?.id ?? null };
  }
  const site = String(month.sourcePlant ?? month.plant ?? '').replace(/\s+plant$/i, '');
  return {
    name: '',
    timeZone: pilot ? zoneWords(pilot.board.timeZone) : `Eastern (${site}, OH)`,
    weekStart: 'mon',
    productionDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    cutoff: '',
    areas: (month.areas ?? []).filter((a) => a.id !== 'plant').map((a) => ({ id: a.id, name: a.name, lead: null })),
    shifts: [{ id: 's1', name: '1st shift' }, { id: 's2', name: '2nd shift' }, { id: 's3', name: '3rd shift' }],
    people,
    functions,
    allowSelfVerify: false,
  };
}

/**
 * The organization the pages use (active), the one being edited (draft), and its lifecycle.
 * -> { active, stored, draft, rev, checked, activatedAt }  (`stored`: an organization was activated)
 */
export function getOrg(month) {
  const doc = readOrgDoc();
  const active = doc.active ?? defaultOrg(month);
  // A pilot board's time zone is the board's, set when it was made.
  if (pilot) active.timeZone = zoneWords(pilot.board.timeZone);
  return { active, stored: Boolean(doc.active), draft: doc.draft, rev: doc.rev, checked: doc.checked, activatedAt: doc.activatedAt, daysOff: doc.daysOff, extraDays: doc.extraDays };
}

const ZONE_WORDS = { 'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Los_Angeles': 'Pacific' };
const zoneWords = (tz) => ZONE_WORDS[tz] ?? String(tz ?? '');

/**
 * Save the days off or the extra production days (which: 'daysOff' | 'extraDays'). They take effect
 * at once, with no Validate or Activate. Returns false when the browser refused.
 */
export function setOrgDays(which, list) {
  if (which !== 'daysOff' && which !== 'extraDays') return false;
  const doc = readOrgDoc();
  doc[which] = cleanDays(list);
  return writeOrgDoc(doc);
}

/** A copy of the whole stored record, for Undo. */
export const snapshotOrg = () => structuredClone(readOrgDoc());
export const restoreOrg = (doc) => writeOrgDoc(isObj(doc) ? doc : emptyOrgDoc());

/** Change the draft (made from the active organization on the first change). Returns { ok, draft }. */
export function editOrgDraft(month, change) {
  const doc = readOrgDoc();
  if (!doc.draft) doc.draft = structuredClone(doc.active ?? defaultOrg(month));
  change(doc.draft);
  doc.draft = cleanOrg(doc.draft);
  doc.rev += 1;
  doc.checked = null;
  return { ok: writeOrgDoc(doc), draft: doc.draft };
}

/** The responsible person for a function: { id, name } or, with nobody assigned, the board's owner name. */
export function responsibleFor(month, org, fnId) {
  const pid = org.functions?.[fnId]?.responsible;
  const person = pid ? org.people.find((p) => p.id === pid) : null;
  if (person) return { id: person.id, name: person.name };
  const fn = [...month.functions, ...(month.hiddenFunctions ?? [])].find((f) => f.id === fnId);
  return { id: null, name: fn?.owner ?? '' };
}

/** The accountable leader for a function: { id, name } (name '' when nobody is set). */
export function accountableFor(org, fnId) {
  const pid = org?.functions?.[fnId]?.accountable;
  const person = pid ? (org.people ?? []).find((p) => p.id === pid) : null;
  return { id: person?.id ?? null, name: person?.name?.trim() ?? '' };
}

/** How many DOR daily measures a person owns, and where: { count, by: [{ fn, count }] }. */
export function dailyMeasuresOf(month, org, personId) {
  const by = month.functions.filter((fn) => org.functions?.[fn.id]?.responsible === personId).map((fn) => ({ fn, count: kpiRowsFor(fn).length }));
  return { count: by.reduce((n, x) => n + x.count, 0), by };
}

/**
 * The owner a new daily measure on this function would go to, and how many they already have, by the
 * active organization (an unassigned function counts on its own). -> { name, count, max }
 */
export function measureLoad(month, fnId) {
  const org = getOrg(month).active;
  const who = responsibleFor(month, org, fnId);
  const fn = month.functions.find((f) => f.id === fnId);
  const count = who.id ? dailyMeasuresOf(month, org, who.id).count : (fn ? kpiRowsFor(fn).length : 0);
  return { name: who.name, count, max: DAILY_MEASURE_MAX };
}

const listWords = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * Validate (spec §3 lifecycle): every function has a responsible owner and an accountable leader, no
 * owner has more than 3 daily measures, nobody's reporting line runs in a circle, and everyone has a
 * name. -> [{ code, text, focus }] in plain words (focus: the Board setup box that fixes it).
 */
export function validateOrg(month, org) {
  const issues = [];
  const byId = new Map(org.people.map((p) => [p.id, p]));
  const nameOf = (p) => p.name.trim() || 'A person with no name';
  org.people.forEach((p) => {
    if (!p.name.trim()) issues.push({ code: 'name', text: 'A person in the list has no name.', focus: `person:${p.id}` });
  });
  for (const fn of month.functions) {
    const a = org.functions?.[fn.id] ?? {};
    if (!a.responsible || !byId.has(a.responsible)) issues.push({ code: 'owner', text: `${fn.name} has no responsible owner.`, focus: `owner:${fn.id}` });
    if (!a.accountable || !byId.has(a.accountable)) issues.push({ code: 'leader', text: `${fn.name} has no accountable leader.`, focus: `leader:${fn.id}` });
  }
  for (const p of org.people) {
    const load = dailyMeasuresOf(month, org, p.id);
    if (load.count > DAILY_MEASURE_MAX) {
      const where = listWords(load.by.map((x) => `${x.fn.name}: ${x.count}`));
      issues.push({ code: 'cap', text: `${nameOf(p)} owns ${load.count} daily measures (${where}). The DOR shows at most ${DAILY_MEASURE_MAX} for one owner. Give a function to someone else, or remove a KPI under Functions.`, focus: `person:${p.id}` });
    }
  }
  // Reporting loops: follow each line up; a person met twice closes a circle (each circle said once).
  const seen = new Set();
  for (const start of org.people) {
    const path = [];
    let p = start;
    while (p && !path.includes(p.id) && !seen.has(p.id)) { path.push(p.id); p = byId.get(p.reportsTo); }
    if (p && path.includes(p.id)) {
      const ring = path.slice(path.indexOf(p.id)).map((id) => byId.get(id));
      const names = ring.map(nameOf);
      const text = ring.length === 1
        ? `Reporting loop: ${names[0]} reports to themselves.`
        : ring.length === 2
          ? `Reporting loop: ${names[0]} reports to ${names[1]}, who reports to ${names[0]}.`
          : `Reporting loop: ${names.map((n, i) => (i === 0 ? `${n} reports to ${names[1]}` : i < names.length - 1 ? `${n} to ${names[i + 1]}` : '')).filter(Boolean).join(', ')}, and ${names[names.length - 1]} back to ${names[0]}.`;
      issues.push({ code: 'loop', text, focus: `reports:${ring[0].id}` });
    }
    path.forEach((id) => seen.add(id));
  }
  return issues;
}

/** Validate the draft and keep the result with it. -> { ok, issues } */
export function checkOrgDraft(month) {
  const doc = readOrgDoc();
  if (!doc.draft) return { ok: false, issues: [] };
  const issues = validateOrg(month, doc.draft);
  doc.checked = { rev: doc.rev, ok: issues.length === 0, at: new Date().toISOString(), issues };
  writeOrgDoc(doc);
  return { ok: issues.length === 0, issues };
}

/** Activate a validated draft. Returns the record before, for Undo, or null when it isn't ready. */
export function activateOrgDraft() {
  const doc = readOrgDoc();
  if (!doc.draft || !doc.checked?.ok || doc.checked.rev !== doc.rev) return null;
  const before = structuredClone(doc);
  doc.active = doc.draft;
  doc.draft = null;
  doc.checked = null;
  doc.activatedAt = new Date().toISOString();
  doc.rev += 1;
  writeOrgDoc(doc);
  return before;
}

/** Throw the draft away (the active organization stays). Returns the record before, for Undo. */
export function discardOrgDraft() {
  const doc = readOrgDoc();
  const before = structuredClone(doc);
  doc.draft = null;
  doc.checked = null;
  doc.rev += 1;
  writeOrgDoc(doc);
  return before;
}

/** The active organization names each function's owner on every page (applied after Board setup). */
function applyOrg(month, org) {
  if (!org) return;
  const byId = new Map(org.people.map((p) => [p.id, p]));
  for (const fn of [...month.functions, ...(month.hiddenFunctions ?? [])]) {
    const person = byId.get(org.functions?.[fn.id]?.responsible);
    if (person?.name.trim()) {
      fn.owner = person.name.trim();
      fn.ownerPersonId = person.id;
    }
  }
}

/** The month's production days: the workbook's, or on a pilot board the Organization's week days less days off plus extra days. */
function calendarOf(month) {
  if (!month.pilot) return workbookCalendar(month);
  const doc = readOrgDoc();
  const days = doc.active?.productionDays ?? ['mon', 'tue', 'wed', 'thu', 'fri'];
  return productionCalendar(month.month, days, doc.daysOff, doc.extraDays);
}

/** One month built: workbook (or a pilot board's blank month) + Board setup + the active Organization + entries. */
function buildMonth(from, overlay) {
  const month = structuredClone(from);
  applyDataQuality(month);
  month.productionDays = calendarOf(month);
  const prod = productionMap(month.productionDays);
  applySetup(month, readSetup(), prod);
  applyOrg(month, readOrgDoc().active);
  applyOverlay(month, overlay);
  applyExtraEntries(month, overlay, prod);
  return month;
}

/** A fresh merged copy of the month: workbook + Board setup + the active Organization + entries from this device. */
export function getMonth() {
  if (!base) throw new Error('Call load() first.');
  const overlay = readOverlay();
  try {
    const month = buildMonth(base, overlay);
    if (month.pilot) fillYear(month);
    return month;
  } catch (err) {
    // Board setup or an entry this code can't read: show the workbook's board rather than nothing.
    console.warn('Board setup skipped:', err);
    const month = structuredClone(base);
    applyDataQuality(month);
    month.productionDays = calendarOf(month);
    try { applyOverlay(month, overlay); } catch { applyOverlay(month, { version: 1, entries: {} }); }
    month.setupFailed = true;
    return month;
  }
}

/* ---------- A pilot board's year ---------- */

// Built months, kept while their documents are the same text: month -> { key: [texts], month }.
const builtMonths = new Map();

function builtMonth(m) {
  const store = cloud.storage();
  const read = (k) => { try { return store.getItem(k); } catch { return null; } };
  const key = [read(SETUP_KEY), read(ORG_KEY), read(overlayKey(m)), m === base.month ? base.boardDate : ''];
  const hit = builtMonths.get(m);
  if (hit && hit.key.every((t, i) => t === key[i])) return hit.month;
  const month = buildMonth(pilotMonth(pilot.board, pilot.starter, m), readOverlay(overlayKey(m)));
  builtMonths.set(m, { key, month });
  return month;
}

/** Month to date at the month's end (or the board date this month) and the month goal, for one KPI row. */
function monthResult(month, row) {
  const last = monthKey(month.boardDate) === month.month ? Number(month.boardDate.slice(8, 10)) : month.daysInMonth;
  const r = (row.monthToDate ?? []).find((x) => x.day === last) ?? null;
  return { month: month.month, actual: r && !r.beforeStart && isNum(r.actual) ? r.actual : null, goal: isNum(row.monthGoal) ? row.monthGoal : null };
}

/**
 * A pilot board's results by month for one calendar year, from the first day's month through the
 * month shown. -> { [fnId]: { [kpiId]: [{ month: 'YYYY-MM', actual, goal }] } }
 */
export function yearRows(year, current = null) {
  const out = {};
  if (!pilot || !base) return out;
  const first = monthKey(base.firstDay ?? base.month);
  for (let m = `${year}-01`; m <= `${year}-12` && m <= base.month; m = shiftMonth(m, 1)) {
    if (m < first) continue;
    const month = current && current.month === m ? current : builtMonth(m);
    for (const fn of [...month.functions, ...(month.hiddenFunctions ?? [])]) {
      const rows = (out[fn.id] ??= {});
      (rows[fn.firstKpiId ?? 'kpi'] ??= []).push(monthResult(month, fn));
      for (const k of fn.extraKpis ?? []) (rows[k.kpiId] ??= []).push(monthResult(month, k));
    }
  }
  return out;
}

/** Fill each KPI row's year (row.monthly) from yearRows(): months before the first day and after this one stay empty. */
function fillYear(month) {
  let rows;
  try { rows = yearRows(Number(month.month.slice(0, 4)), month); } catch (err) { console.warn('Year skipped:', err); return; }
  const year = month.month.slice(0, 4);
  const fill = (row, list) => {
    row.monthly = MONTHS.map((name, i) => {
      const r = list?.find((x) => x.month === `${year}-${String(i + 1).padStart(2, '0')}`);
      return { month: name, actual: r?.actual ?? null, goal: r?.goal ?? null };
    });
  };
  for (const fn of [...month.functions, ...(month.hiddenFunctions ?? [])]) {
    fill(fn, rows[fn.id]?.[fn.firstKpiId ?? 'kpi']);
    for (const k of fn.extraKpis ?? []) fill(k, rows[fn.id]?.[k.kpiId]);
  }
}

/* ---------- Reads ---------- */

export function functionById(month, id) {
  return month.functions.find((f) => f.id === id) ?? null;
}

export function dailySeries(fn, areaId = 'plant') {
  return fn.daily?.[areaId] ?? [];
}

export function rowForDay(series, day) {
  return series.find((r) => r.day === day) ?? null;
}

export function monthToDateRow(fn, day) {
  return rowForDay(fn.monthToDate ?? [], day);
}

/** { problem, action, status, source } for a day, or nulls when nothing was recorded. */
export function notesFor(fn, day) {
  return fn.notesByDay?.[day] ?? { problem: null, action: null, status: null, source: null };
}

/** Split note text into its separate notes (paragraphs). */
export const noteParagraphs = (text) => (text ?? '').split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);

/** "No new issues to report" is the absence of a problem, so it takes no status. */
/** "No new issues to report", "No issue reported": the absence of a problem. One rule for the board, Enter numbers and the register. */
export const NO_ISSUE = /^\s*no (new )?(issues?|problems?)( to report| reported)?\.?\s*$/i;
/** Is there a real problem for this day (one that can be Open, In progress or Closed)? */
export const hasProblem = (n) => n.source !== null && noteParagraphs(n.problem).some((t) => !NO_ISSUE.test(t));

/**
 * The KPI rows a function shows on the board v2. The workbook gives each function
 * one: its daily measure, with its month measure beside it. Each row reads like a
 * function (kpiDaily, daily, monthToDate, monthly, notes), so the status and
 * chart helpers work on it unchanged. More rows come from Board setup.
 */
export function kpiRowsFor(fn) {
  return [{ ...fn, primary: true }, ...(fn.extraKpis ?? [])];
}

/** The function's owner: { name, photo } (photo is null until one is added). */
export function ownerFor(fn) {
  return { name: fn.owner, photo: fn.ownerPhoto ?? null };
}

/** A KPI row by its id: a function id (its workbook KPI) or "function--kpi" (added in Board setup). */
export function kpiRowById(month, id) {
  const fn = month.functions.find((f) => f.id === id);
  if (fn) return { fn, row: fn };
  const [fnId] = String(id).split('--');
  const parent = month.functions.find((f) => f.id === fnId);
  const row = parent?.extraKpis?.find((k) => k.id === id);
  return row ? { fn: parent, row } : null;
}

/** Find a function, including one hidden in Board setup. */
export function anyFunctionById(month, id) {
  return month.functions.find((f) => f.id === id) ?? month.hiddenFunctions?.find((f) => f.id === id) ?? null;
}

/** { enteredBy, enteredAt } when this row was entered in the app. */
export function entryInfo(fn, day) {
  return fn.entries?.[day] ?? null;
}

/** Leading indicators from the KPAs tab, matched by the DOR question. */
export function leadingIndicatorsFor(month, fn) {
  const all = month.leadingIndicators ?? {};
  const q = (fn.sourceQuestion ?? fn.dorQuestion)?.trim();
  for (const [name, set] of Object.entries(all)) {
    if (set.dorQuestion?.trim() === q) return { name, ...set };
  }
  return null;
}

export function isoForDay(month, day) {
  return `${month.month}-${String(day).padStart(2, '0')}`;
}

export function dayFromIso(month, iso) {
  if (typeof iso !== 'string' || !iso.startsWith(`${month.month}-`)) return null;
  const day = Number(iso.slice(8, 10));
  return Number.isInteger(day) && day >= 1 && day <= month.daysInMonth ? day : null;
}

export const boardDay = (month) => dayFromIso(month, month.boardDate);

/**
 * The dates the ‹ › arrows and the date pickers reach: on a pilot board its first day through
 * today, across months; in the demo the month's data. -> { min, max } ('YYYY-MM-DD')
 */
export function dateBounds(month) {
  if (!pilot) return { min: isoForDay(month, 1), max: isoForDay(month, month.daysInMonth) };
  const today = boardToday();
  return { min: pilot.board.firstDay && pilot.board.firstDay <= today ? pilot.board.firstDay : today, max: today };
}

/* ---------- Writes ---------- */

/**
 * Save one function's numbers and text for one day.
 * entry = { functionId, day, values: {plant, mold, bond, prime, compounding},
 *           month, issue, action, issueStatus, enteredBy }
 * Returns { ok, previous } so the caller can offer Undo.
 */
export function saveEntry(entry) {
  const overlay = readOverlay();
  const key = entryKey(entry.functionId, entry.day);
  const previous = overlay.entries[key] ?? null;
  overlay.entries[key] = { ...entry, enteredAt: new Date().toISOString() };
  return { ok: writeOverlay(overlay), previous };
}

/**
 * Put back what was there before a save (null removes the entry). `inMonth` ('YYYY-MM') is the month
 * the save went into, on a pilot board that may no longer be the month shown (midnight, the arrows).
 */
export function restoreEntry(functionId, day, previous, inMonth = null) {
  if (pilot && inMonth && inMonth !== base.month) {
    const key = overlayKey(inMonth);
    const overlay = readOverlay(key);
    if (previous) overlay.entries[entryKey(functionId, day)] = previous;
    else delete overlay.entries[entryKey(functionId, day)];
    try { cloud.storage().setItem(key, JSON.stringify(overlay)); return true; } catch { return false; }
  }
  const overlay = readOverlay();
  const key = entryKey(functionId, day);
  if (previous) overlay.entries[key] = previous;
  else delete overlay.entries[key];
  return writeOverlay(overlay);
}

/** Clear everything entered on this device. Returns a snapshot for Undo. */
export function resetDemo() {
  if (cloud.BOARD) return null;
  const snapshot = readOverlay();
  let ok = true;
  overlayMem = null; // else a refused write's copy would keep the numbers on screen
  try { cloud.storage().removeItem(overlayKey()); } catch { ok = false; }
  return { ok, snapshot };
}

export function restoreOverlay(snapshot) {
  return writeOverlay(snapshot);
}

export function hasEntries() {
  return Object.keys(readOverlay().entries).length > 0;
}

/* ---------- Weekly review (dor.weekly.v1): inputs, commentary, readiness, review records ----------
   Everything the Weekly review saves on this device, by week ('YYYY-MM-DD' of the week's first day):

   { version: 1,
     weeks: { [weekKey]: {
       inputs: { [metricKey]: {            metricKey: a KPI row id ("engineering", "people--absent"),
                                           or "m:<functionId>" for a broader weekly measure (TRIR, Uptime)
         weekly:   { value, by, at } | null           WEEKLY_ONLY: the week's value, entered once
         override: { value, reason, approver, approverId, expires, at, raw, received } | null
                                           OVERRIDE: replaces the effective result; raw = the calculated
                                           value when it was approved (a later change flags reapproval)
         history:  [{ kind, value, raw, reason, approver, by, at }]
                                           kind: 'weekly-entered' | 'weekly-changed' | 'weekly-cleared' |
                                           'override-added' | 'override-removed'; never trimmed
       } },
       commentary: { [functionId]: { happened, expected, risks, at } }   never changes a number
       participants: [personId],                                         confirmed from the Organization
       preparedAt: ISO time | null }                                    the last Prepare review
     },
     records: [ReviewRecord] }

   ReviewRecord (a weekly review's Governance record, spec §7 and §13):
   { id: 'wor-…', type: 'WOR', weekKey, weekStart, weekEnd, asOfIso,
     state: 'draft' | 'finalized',      Prepare review saves or refreshes the week's draft; Finish review finalizes it
     createdAt, updatedAt, finalizedAt, finalizedBy (name), version, calcVersion,
     facilitator: personId | null,      who finalized it (an Administrator or Facilitator)
     attendees: [personId], decisions: [{ id, text, by, at, context }],   context: the agenda item it was taken on
     attendeeNames: [{ id, name }], actionSnapshots: [{ id, text, status, owner, ownerPersonId, due, fnId }]   frozen when finalized
     commentary: { fnId: { happened, expected, risks } }   each function's commentary when saved (frozen when finalized)
     actionIds: [actionId],             carried in, opened this week, assigned in the meeting, escalated (by native id)
     escalations: [{ id, fnId, label, actionId, to, reason, by, at }],
     exceptions: [{ text }], exceptionNote,   what was still open when it was finalized, and why (stays visible)
     nextReviewDate: 'YYYY-MM-DD',      the next week's first day
     meeting: { startedAt, endedAt, durationSec, recorded, transcript: [{ at, text }] } | null,
     basedOn: recordId | null,          a draft started after the week was finalized
     amendments: [{ text, by, at }],    notes appended after finalizing, with reason and author (shown as "Notes")
     summary: string,
     results: [{ key, fnId, fnName, owner, kpiName, unit, better, rule, raw, effective, goal, goalVaries,
                 status, expected, received, provisional, overridden, met, missed, gap }],
     readiness: [{ id, done, text }] }
   Lifecycle: Draft → Finalized → Revised. A finalized record never changes: editWeekly puts it back
   if a change touches it, except notes (`amendments`) appended to its end. Changes after finalizing go into a
   revised version (a new draft, basedOn the finalized one, version continues); once it's finalized it is the
   week's record and the earlier version reads "Replaced by v2". It keeps its numbers: the page compares them with the live calculation and
   says "Source revised" when a later edit changed the week. The connected version keeps these in
   LinkedXL OS Governance; here they live on this device only. */

const WEEKLY_KEY = 'dor.weekly.v1';
export const WEEKLY_HISTORY_KINDS = ['weekly-entered', 'weekly-changed', 'weekly-cleared', 'override-added', 'override-removed'];
let weeklyMem = null;
let weeklyWriteFailed = false;

const isoTime = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
const dayKey = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const textField = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');

function cleanInput(i) {
  if (!isObj(i)) return null;
  const weekly = isObj(i.weekly) && isNum(i.weekly.value)
    ? { value: i.weekly.value, by: textField(i.weekly.by, NAME_MAX.owner), at: isoTime(i.weekly.at) }
    : null;
  const override = isObj(i.override) && isNum(i.override.value)
    ? {
      value: i.override.value,
      reason: textField(i.override.reason, 500),
      approver: textField(i.override.approver, NAME_MAX.owner),
      approverId: okId(i.override.approverId) ? i.override.approverId : null,
      expires: dayKey(i.override.expires),
      at: isoTime(i.override.at),
      raw: isNum(i.override.raw) ? i.override.raw : null,
      received: Number.isInteger(i.override.received) ? i.override.received : null,
    }
    : null;
  const history = (Array.isArray(i.history) ? i.history : []).filter((h) => isObj(h) && WEEKLY_HISTORY_KINDS.includes(h.kind)).map((h) => ({
    kind: h.kind,
    value: isNum(h.value) ? h.value : null,
    raw: isNum(h.raw) ? h.raw : null,
    reason: textField(h.reason, 500),
    approver: textField(h.approver, NAME_MAX.owner),
    expires: dayKey(h.expires),
    // Every step says who; an older one saved without a name says so.
    by: textField(h.by, NAME_MAX.owner).trim() || 'Not recorded (an older entry)',
    at: isoTime(h.at),
  }));
  return { weekly, override, history };
}

function cleanWeek(w) {
  const out = { inputs: {}, commentary: {}, participants: [], preparedAt: null };
  if (!isObj(w)) return out;
  if (isObj(w.inputs)) {
    for (const [k, v] of Object.entries(w.inputs)) {
      const c = typeof k === 'string' && k.length < 120 ? cleanInput(v) : null;
      if (c) out.inputs[k] = c;
    }
  }
  if (isObj(w.commentary)) {
    for (const [fnId, c] of Object.entries(w.commentary)) {
      if (!okId(fnId) || !isObj(c)) continue;
      out.commentary[fnId] = { happened: textField(c.happened), expected: textField(c.expected), risks: textField(c.risks), at: isoTime(c.at) };
    }
  }
  if (Array.isArray(w.participants)) out.participants = [...new Set(w.participants.filter(okId))];
  out.preparedAt = isoTime(w.preparedAt);
  return out;
}

/** A review record, checked: a damaged one is dropped, never thrown. */
function cleanRecord(r) {
  if (!isObj(r) || typeof r.id !== 'string' || !r.id || !dayKey(r.weekKey)) return null;
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    id: r.id.slice(0, 80),
    type: 'WOR',
    weekKey: r.weekKey,
    weekStart: dayKey(r.weekStart) ?? r.weekKey,
    weekEnd: dayKey(r.weekEnd),
    asOfIso: dayKey(r.asOfIso),
    state: r.state === 'finalized' ? 'finalized' : 'draft',
    createdAt: isoTime(r.createdAt),
    updatedAt: isoTime(r.updatedAt),
    finalizedAt: isoTime(r.finalizedAt),
    finalizedBy: textField(r.finalizedBy, NAME_MAX.owner) || null,
    finalizedById: okId(r.finalizedById) ? r.finalizedById : null,
    version: Number.isInteger(r.version) && r.version > 0 ? r.version : 1,
    calcVersion: textField(r.calcVersion, 40),
    facilitator: okId(r.facilitator) ? r.facilitator : null,
    attendees: list(r.attendees).filter(okId),
    // Frozen when finalized: the attendees' names and each action as it stood (the record shows "now: …" beside changes).
    attendeeNames: list(r.attendeeNames).filter((x) => isObj(x) && okId(x.id)).map((x) => ({ id: x.id, name: textField(x.name, NAME_MAX.owner) })),
    actionSnapshots: list(r.actionSnapshots).filter((x) => isObj(x) && typeof x.id === 'string' && x.id).map((x) => (x.missing
      ? { id: x.id.slice(0, 80), missing: true }
      : { id: x.id.slice(0, 80), text: textField(x.text, 2000), status: textField(x.status, 20), owner: textField(x.owner, NAME_MAX.owner), ownerPersonId: okId(x.ownerPersonId) ? x.ownerPersonId : null, due: dayKey(x.due), fnId: textField(x.fnId, 60) || null })),
    // null: saved before records kept commentary (the record says so rather than "nothing written").
    commentary: isObj(r.commentary) ? Object.fromEntries(Object.entries(r.commentary).filter(([k, v]) => okId(k) && isObj(v))
      .map(([k, v]) => [k, { happened: textField(v.happened, 4000), expected: textField(v.expected, 4000), risks: textField(v.risks, 4000) }])) : null,
    decisions: list(r.decisions).filter((d) => isObj(d) && typeof d.text === 'string' && d.text.trim())
      .map((d) => ({ id: textField(d.id, 80), text: textField(d.text, 2000), by: textField(d.by, NAME_MAX.owner), at: isoTime(d.at), context: textField(d.context, 160) })),
    actionIds: [...new Set(list(r.actionIds).filter((x) => typeof x === 'string' && x).map((x) => x.slice(0, 80)))],
    escalations: list(r.escalations).filter((e) => isObj(e) && typeof e.reason === 'string' && e.reason.trim())
      .map((e) => ({ id: textField(e.id, 80), fnId: textField(e.fnId, 60), label: textField(e.label, 200), actionId: typeof e.actionId === 'string' && e.actionId ? e.actionId.slice(0, 80) : null, to: textField(e.to, NAME_MAX.owner), reason: textField(e.reason, 1000), by: textField(e.by, NAME_MAX.owner), at: isoTime(e.at) })),
    exceptions: list(r.exceptions).filter((x) => isObj(x) && typeof x.text === 'string' && x.text.trim()).map((x) => ({ text: textField(x.text, 400) })),
    exceptionNote: textField(r.exceptionNote, 1000),
    nextReviewDate: dayKey(r.nextReviewDate),
    meeting: isObj(r.meeting) ? {
      startedAt: isoTime(r.meeting.startedAt),
      endedAt: isoTime(r.meeting.endedAt),
      durationSec: Number.isFinite(Number(r.meeting.durationSec)) && Number(r.meeting.durationSec) >= 0 ? Math.round(Number(r.meeting.durationSec)) : 0,
      recorded: r.meeting.recorded === true,
      transcript: list(r.meeting.transcript).filter((l) => isObj(l) && typeof l.text === 'string' && l.text.trim()).slice(0, 2000)
        .map((l) => ({ at: Number.isFinite(Number(l.at)) && Number(l.at) >= 0 ? Number(l.at) : 0, text: textField(l.text, 1000) })),
    } : null,
    basedOn: typeof r.basedOn === 'string' && r.basedOn ? r.basedOn.slice(0, 80) : null,
    amendments: list(r.amendments).filter((a) => isObj(a) && typeof a.text === 'string')
      .map((a) => ({ text: textField(a.text, 2000), by: textField(a.by, NAME_MAX.owner), byId: okId(a.byId) ? a.byId : null, at: isoTime(a.at) })),
    summary: textField(r.summary, 1000),
    results: list(r.results).filter((x) => isObj(x) && typeof x.key === 'string').map((x) => ({
      key: x.key.slice(0, 120),
      fnId: textField(x.fnId, 60),
      fnName: textField(x.fnName, NAME_MAX.fn),
      owner: textField(x.owner, NAME_MAX.owner),
      kpiName: textField(x.kpiName, NAME_MAX.kpi + 40),
      unit: textField(x.unit, 20) || 'count',
      better: x.better === 'lower' ? 'lower' : 'higher',
      rule: WEEKLY_RULE_IDS.includes(x.rule) ? x.rule : 'sum',
      raw: isNum(x.raw) ? x.raw : null,
      effective: isNum(x.effective) ? x.effective : null,
      goal: isNum(x.goal) ? x.goal : null,
      goalVaries: x.goalVaries === true,
      status: textField(x.status, 20) || 'not-entered',
      expected: Number.isInteger(x.expected) ? x.expected : 0,
      received: Number.isInteger(x.received) ? x.received : 0,
      provisional: x.provisional === true,
      overridden: x.overridden === true,
      met: Number.isInteger(x.met) ? x.met : 0,
      missed: Number.isInteger(x.missed) ? x.missed : 0,
      gap: textField(x.gap, 120),
    })),
    readiness: list(r.readiness).filter((x) => isObj(x)).map((x) => ({ id: textField(x.id, 40), done: x.done === true, text: textField(x.text, 400) })),
  };
}

/** The whole Weekly review document, checked on every read. */
export function readWeekly() {
  let raw = null;
  if (weeklyWriteFailed && weeklyMem) raw = weeklyMem;
  else {
    try { raw = JSON.parse(cloud.storage().getItem(WEEKLY_KEY) ?? 'null') ?? weeklyMem; } catch { raw = weeklyMem; }
  }
  const doc = { version: 1, weeks: {}, records: [] };
  if (!isObj(raw) || raw.version !== 1) return doc;
  if (isObj(raw.weeks)) for (const [k, w] of Object.entries(raw.weeks)) if (dayKey(k)) doc.weeks[k] = cleanWeek(w);
  if (Array.isArray(raw.records)) doc.records = raw.records.map(cleanRecord).filter(Boolean);
  return doc;
}

/** Returns false when the browser refused: the change then holds for this visit only. */
function writeWeekly(doc) {
  weeklyMem = structuredClone(doc);
  try {
    cloud.storage().setItem(WEEKLY_KEY, JSON.stringify(doc));
    weeklyWriteFailed = false;
    return true;
  } catch {
    weeklyWriteFailed = true;
    return false;
  }
}

/** One week's saved state (an empty one when nothing is saved for it yet). */
export const weekSaved = (doc, weekKey) => doc.weeks[weekKey] ?? cleanWeek(null);

/**
 * Change the Weekly review document: change(doc, week) mutates it (week = that week's state, created
 * on first use). -> { ok, doc }  (ok false: this browser isn't saving; it holds for this visit)
 */
export function editWeekly(weekKey, change) {
  const doc = readWeekly();
  if (weekKey && !doc.weeks[weekKey]) doc.weeks[weekKey] = cleanWeek(null);
  // A finalized record never changes (spec §13): only amendments appended to it are kept.
  const sealed = new Map(doc.records.filter((r) => r.state === 'finalized').map((r) => [r.id, structuredClone(r)]));
  change(doc, weekKey ? doc.weeks[weekKey] : null);
  if (weekKey) doc.weeks[weekKey] = cleanWeek(doc.weeks[weekKey]);
  doc.records = doc.records.map(cleanRecord).filter(Boolean).map((r) => {
    const was = sealed.get(r.id);
    if (!was) return r;
    const body = (x) => JSON.stringify({ ...x, amendments: null });
    const kept = r.amendments.length >= was.amendments.length && JSON.stringify(r.amendments.slice(0, was.amendments.length)) === JSON.stringify(was.amendments);
    if (body(r) === body(was) && kept) return r;
    return { ...was, amendments: kept ? r.amendments : was.amendments };
  });
  // Nor is one ever removed.
  for (const [id, was] of sealed) if (!doc.records.some((r) => r.id === id)) doc.records.push(was);
  return { ok: writeWeekly(doc), doc };
}
