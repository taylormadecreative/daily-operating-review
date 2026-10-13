// Data layer. Every screen reads the month through this module, so a
// Supabase-backed version can replace it without touching the screens.
//
// Model: the month extracted from the plant's workbook (read-only JSON) plus a
// localStorage overlay of what people entered on this device. getMonth()
// returns a fresh merged copy; nothing outside this file touches storage.

const DATA_URL = new URL('../data/conneaut-2026-02.json?v=20261013-151156', import.meta.url);
const OVERLAY_KEY = 'dor.overlay.v1';
const SETUP_KEY = 'dor.setup.v1';
export const AREA_IDS = ['plant', 'mold', 'bond', 'prime', 'compounding'];

let base = null;

/** Load the workbook month once. Same-origin file only. */
export async function load() {
  if (!base) {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`Could not load the board data (${res.status}).`);
    base = await res.json();
  }
  return getMonth();
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

function readOverlay() {
  try {
    // After a refused write, this visit's copy is the truth (see writeOverlay).
    const raw = overlayMem ? null : localStorage.getItem(OVERLAY_KEY);
    const parsed = overlayMem ?? (raw ? JSON.parse(raw) : null);
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
    localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay));
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
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
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
    const raw = localStorage.getItem(SETUP_KEY);
    return normalizeSetup(raw ? JSON.parse(raw) : setupMem);
  } catch {
    return normalizeSetup(setupMem); // blocked or corrupt: this visit's copy, else the workbook's setup
  }
}

export function writeSetup(setup) {
  setupMem = structuredClone(setup);
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify(setup));
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
  setupMem = null;
  setupWriteFailed = false;
  try { localStorage.removeItem(SETUP_KEY); } catch { /* ignore */ }
  return snapshot;
}

/* ---------- Start the demo over ---------- */

/**
 * Clear everything this demo saved on the device (numbers, Board setup, actions,
 * minutes, Customize, tours, who's entering) so the next visitor starts clean.
 * Returns a snapshot for Undo.
 */
export function resetEverything() {
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

/** A KPI row that isn't in the workbook: same shape as a function, with no numbers yet. */
function newKpiRow(month, fn, k, prod) {
  const unit = UNITS.find((u) => u.id === k.unit) ?? UNITS[0];
  const kpi = { name: k.name, boardLabel: k.name, unit: unit.id, better: k.better === 'lower' ? 'lower' : 'higher' };
  const goal = isNum(k.goal) ? k.goal : null;
  const days = [];
  for (let d = 1; d <= month.daysInMonth; d += 1) days.push({ day: d, actual: null, goal: prod[d] ? goal : null });
  return {
    id: `${fn.id}--${k.id}`,
    kpiId: k.id,
    fnId: fn.id,
    primary: false,
    custom: true,
    // The board day it was added on: days before it read as "not tracked yet", not as misses.
    startDay: Number.isInteger(k.startDay) && k.startDay >= 1 ? k.startDay : 1,
    rollup: k.rollup === 'total' || k.rollup === 'average' ? k.rollup : unit.rollup,
    monthGoal: isNum(k.monthGoal) ? k.monthGoal : null,
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

/** Month to date and the year for a KPI row that isn't in the workbook, from its daily numbers. */
function finishKpiRow(month, row, prod) {
  let sum = 0; let n = 0; let goalSum = 0; let goalN = 0; let prodDays = 0; let allGoals = 0;
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
      if (isNum(r.goal)) allGoals += r.goal;
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
    else goal = dayGoal;
    if (r.beforeStart) return { day: r.day, actual: null, goal: null, beforeStart: true };
    return { day: r.day, actual, goal };
  });
  const dailyGoal = row.daily.plant.find((r) => isNum(r.goal))?.goal ?? null;
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
    Object.assign(fn, { kpiDaily: row.kpiDaily, kpiMonthly: row.kpiMonthly, daily: row.daily, monthToDate: [], monthly: row.monthly, rollup: row.rollup, monthGoal: row.monthGoal, startDay: row.startDay, firstKpiId: first?.id ?? 'kpi' });
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

/** A fresh merged copy of the month: workbook + Board setup + entries from this device. */
export function getMonth() {
  if (!base) throw new Error('Call load() first.');
  const overlay = readOverlay();
  try {
    const month = structuredClone(base);
    applyDataQuality(month);
    month.productionDays = workbookCalendar(month);
    const prod = productionMap(month.productionDays);
    applySetup(month, readSetup(), prod);
    applyOverlay(month, overlay);
    applyExtraEntries(month, overlay, prod);
    return month;
  } catch (err) {
    // Board setup or an entry this code can't read: show the workbook's board rather than nothing.
    console.warn('Board setup skipped:', err);
    const month = structuredClone(base);
    applyDataQuality(month);
    month.productionDays = workbookCalendar(month);
    try { applyOverlay(month, overlay); } catch { applyOverlay(month, { version: 1, entries: {} }); }
    month.setupFailed = true;
    return month;
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

/** Put back what was there before a save (null removes the entry). */
export function restoreEntry(functionId, day, previous) {
  const overlay = readOverlay();
  const key = entryKey(functionId, day);
  if (previous) overlay.entries[key] = previous;
  else delete overlay.entries[key];
  return writeOverlay(overlay);
}

/** Clear everything entered on this device. Returns a snapshot for Undo. */
export function resetDemo() {
  const snapshot = readOverlay();
  let ok = true;
  overlayMem = null; // else a refused write's copy would keep the numbers on screen
  try { localStorage.removeItem(OVERLAY_KEY); } catch { ok = false; }
  return { ok, snapshot };
}

export function restoreOverlay(snapshot) {
  return writeOverlay(snapshot);
}

export function hasEntries() {
  return Object.keys(readOverlay().entries).length > 0;
}
