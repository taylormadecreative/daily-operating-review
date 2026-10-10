// Data layer. Every screen reads the month through this module, so a
// Supabase-backed version can replace it without touching the screens.
//
// Model: the month extracted from the plant's workbook (read-only JSON) plus a
// localStorage overlay of what people entered on this device. getMonth()
// returns a fresh merged copy; nothing outside this file touches storage.

const DATA_URL = new URL('../data/plant-2026-02.json', import.meta.url);
const OVERLAY_KEY = 'dor.overlay.v1';
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

function readOverlay() {
  try {
    const raw = localStorage.getItem(OVERLAY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') return parsed;
  } catch { /* blocked or corrupt: fall through to empty */ }
  return { version: 1, entries: {} };
}

function writeOverlay(overlay) {
  try {
    localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay));
    return true;
  } catch {
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
  for (const fn of month.functions) {
    // The workbook keeps one day's text: the board date.
    fn.notesByDay = {
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
    const fn = month.functions.find((f) => f.id === entry.functionId);
    if (!fn || !Number.isInteger(entry.day)) continue;
    for (const areaId of AREA_IDS) {
      if (!(areaId in (entry.values ?? {}))) continue;
      const row = (fn.daily[areaId] ?? []).find((r) => r.day === entry.day);
      if (row) row.actual = entry.values[areaId];
    }
    if ('month' in entry) {
      const row = (fn.monthToDate ?? []).find((r) => r.day === entry.day);
      if (row) row.actual = entry.month;
    }
    fn.notesByDay[entry.day] = {
      problem: entry.issue ?? null,
      action: entry.action ?? null,
      status: ISSUE_STATUS.includes(entry.issueStatus) ? entry.issueStatus : null,
      source: 'entered',
    };
    fn.entries[entry.day] = { enteredBy: entry.enteredBy, enteredAt: entry.enteredAt };
  }
}

/** A fresh merged copy of the month: workbook + entries from this device. */
export function getMonth() {
  if (!base) throw new Error('Call load() first.');
  const month = structuredClone(base);
  applyDataQuality(month);
  applyOverlay(month, readOverlay());
  return month;
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
const NO_ISSUE = /^\s*no (new )?(issues?|problems?)( to report)?\.?\s*$/i;
/** Is there a real problem for this day (one that can be Open, In progress or Closed)? */
export const hasProblem = (n) => n.source !== null && noteParagraphs(n.problem).some((t) => !NO_ISSUE.test(t));

/** { enteredBy, enteredAt } when this row was entered in the app. */
export function entryInfo(fn, day) {
  return fn.entries?.[day] ?? null;
}

/** Leading indicators from the KPAs tab, matched by the DOR question. */
export function leadingIndicatorsFor(month, fn) {
  const all = month.leadingIndicators ?? {};
  for (const [name, set] of Object.entries(all)) {
    if (set.dorQuestion?.trim() === fn.dorQuestion?.trim()) return { name, ...set };
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
  try { localStorage.removeItem(OVERLAY_KEY); } catch { ok = false; }
  return { ok, snapshot };
}

export function restoreOverlay(snapshot) {
  return writeOverlay(snapshot);
}

export function hasEntries() {
  return Object.keys(readOverlay().entries).length > 0;
}
