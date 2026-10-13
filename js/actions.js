// Action register: who will do what, and by when.
//
// A right-side sheet over the board (full screen on a phone), opened by any
// [data-open-actions] control, or by openActions({ addFor, kpiId }) straight
// into the Add form. Two sections:
//   1. Assigned actions: actions added here or by the meeting recorder, each
//      with a function (and a KPI added in Board setup, when it's for one), an
//      owner, a due date and a status.
//   2. From the board: each function's issue and next-24-hour action for the
//      selected day, with its open assigned actions under the action. Read
//      only here; the notes are changed in Enter numbers. Folded, unless
//      nothing is assigned yet (then it is the register's content).
// Above both, "Needs an action": each off-goal KPI with no action and no owner
// yet (board.js needsSummary), with an Add action button set to that KPI.
// Actions belong to days: one counts as its KPI's action from the board day it
// was added for (dayIso), while it is open, or through the board day it was
// closed on (closedDayIso), when it shows as "Done: …".
// Actions live on this device under dor.actions.v1. Every storage call is
// guarded, so the register still works for this visit when storage is blocked.
//
// ctx = { getMonth, getDay, toast, openMinutes, enterFor?, onChange? }
// ctx.onChange() runs after every add, edit, status change, delete and undo,
// so the board redraws its Action cells.

import { notesFor, ownerFor, isoForDay, functionById, kpiRowsFor, NO_ISSUE } from './store.js?v=20261013-151156';
import { isProductionDay, OFF } from './status.js?v=20261013-151156';
import { formatDayMedium, plainLabel, formatPair, monthSoFar } from './format.js?v=20261013-151156';
import { esc, issueStatusMarkup, statusMarkup } from './ui.js?v=20261013-151156';
// The board's action words and states (one wording on every screen). Used only
// inside functions: board.js imports this module too.
import { actionStateFor, needsSummary, needsLabel, ACTION_WORD, issueGap, ISSUE_GAP_WORD, NO_FUNCTIONS } from './board.js?v=20261013-151156';

const KEY = 'dor.actions.v1';
const STATUSES = ['open', 'in-progress', 'closed'];
// The stored value stays 'closed'; people see "Done", the board's word for a finished action.
const STATUS_WORD = { open: 'Open', 'in-progress': 'In progress', closed: 'Done' };

let ctx = null;
let dlg = null;

/* ---------- Storage (every access guarded) ---------- */

let storageOk = true; // false once this browser refuses to read or write
let mem = [];         // the last list read or written; the only copy when storage is blocked

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function utcDate(iso) {
  if (typeof iso !== 'string' || !ISO.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}

/** 'YYYY-MM-DD' (a longer ISO string is cut to its date), or null. */
function isoOrNull(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, 10);
  return utcDate(s) ? s : null;
}

function normStatus(s) {
  const k = String(s ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  return STATUSES.includes(k) ? k : null;
}

/** One stored action, checked. Unknown extra fields are kept as they are. */
function clean(a) {
  if (!a || typeof a !== 'object' || typeof a.text !== 'string' || !a.text.trim()) return null;
  if (typeof a.id !== 'string' && typeof a.id !== 'number') return null;
  const status = normStatus(a.status) ?? 'open';
  return {
    ...a,
    id: String(a.id),
    fnId: typeof a.fnId === 'string' && a.fnId ? a.fnId : null,
    owner: typeof a.owner === 'string' ? a.owner : '',
    due: isoOrNull(a.due),
    status,
    createdAt: typeof a.createdAt === 'string' ? a.createdAt : '',
    source: a.source === 'meeting' ? 'meeting' : 'manual',
    meetingId: a.meetingId ?? null,
    // The board day it was added for (null on older records: it counts from the start).
    dayIso: isoOrNull(a.dayIso),
    // The board day it was closed on; only a closed action has one.
    closedDayIso: status === 'closed' ? isoOrNull(a.closedDayIso) : null,
    // A KPI added in Board setup ("function--kpi" rows): its kpiId. null = the function's workbook KPI.
    kpiId: typeof a.kpiId === 'string' && a.kpiId ? a.kpiId : null,
  };
}

function readAll() {
  if (storageOk) {
    let raw = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      storageOk = false; // blocked: keep serving what this visit has
    }
    if (storageOk) {
      let parsed = [];
      try { parsed = raw ? JSON.parse(raw) : []; } catch { parsed = []; } // corrupt: start clean
      mem = Array.isArray(parsed) ? parsed.map(clean).filter(Boolean) : [];
    }
  }
  return mem.map((a) => ({ ...a }));
}

function writeAll(list) {
  mem = list.map((a) => ({ ...a }));
  if (!storageOk) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(mem));
    return true;
  } catch {
    storageOk = false;
    return false;
  }
}

function newId() {
  try {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  } catch { /* not available here */ }
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------- Small helpers ---------- */

const nb = (s) => String(s).replace(/ /g, ' '); // keep "Fri, Feb 27" on one line
const glyph = (id, cls = 'glyph') => `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#${id}"></use></svg>`;
const PLUS = '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const sel = (attr, value) => `[${attr}="${CSS.escape(value)}"]`;

/** "Done:" in the on-track color with its glyph, before a closed action's words. */
const doneMark = () => `<span class="ar-done">${glyph('g-on')}Done:</span> `;
/** " · Done Fri, Feb 27" after a closed action's owner (nothing when the day isn't known). */
const closedText = (a, month) => (a.closedDayIso
  ? `<span class="ar-dotsep"> · </span><span class="ar-due">Done ${esc(nb(dayText(a.closedDayIso, month)))}</span>`
  : '');

const DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const DAY_Y = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** "Mon, Mar 2" (the year is added when it isn't the board's year). */
function dayText(iso, month) {
  const dt = utcDate(iso);
  if (!dt) return '';
  return (iso.slice(0, 4) === month.month.slice(0, 4) ? DAY : DAY_Y).format(dt);
}

function addDays(iso, n) {
  const dt = utcDate(iso);
  if (!dt) return null;
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

const isWeekdayIso = (iso) => { const w = utcDate(iso)?.getUTCDay(); return w !== undefined && w !== 0 && w !== 6; };

/**
 * The next production day after a board day, as 'YYYY-MM-DD' (the default due
 * date). The month's plan decides (status.js isProductionDay); a day the plan
 * doesn't know counts when it's a weekday. Past the month's last day, the next
 * weekday: Fri, Feb 27 gives Mon, Mar 2.
 */
export function nextProductionDayIso(month, day) {
  const from = isoForDay(month, day);
  try {
    for (let d = day + 1; d <= month.daysInMonth; d += 1) {
      const p = isProductionDay(month, d);
      if (p === true || (p === null && isWeekdayIso(isoForDay(month, d)))) return isoForDay(month, d);
    }
    let iso = addDays(isoForDay(month, month.daysInMonth), 1);
    for (let i = 0; iso && i < 7 && !isWeekdayIso(iso); i += 1) iso = addDays(iso, 1);
    return iso ?? addDays(from, 1);
  } catch {
    return addDays(from, 1);
  }
}

/** "Mon, Mar 2" for a due date (the year is added when it isn't the board's year). */
export const actionDayText = (iso, month) => dayText(iso, month);

/** A function on the board, or one Board setup has hidden. */
function fnLookup(month, id) {
  if (!id) return null;
  return functionById(month, id) ?? (month.hiddenFunctions ?? []).find((f) => f.id === id) ?? null;
}
const fnName = (month, id) => fnLookup(month, id)?.name ?? (id ? 'Function not on the board' : 'No function');
const ownerName = (month, id) => {
  const fn = fnLookup(month, id);
  return fn ? (ownerFor(fn).name ?? '') : '';
};

/** The KPIs added in Board setup for a function (its workbook KPI is kpiId null). */
const extraKpis = (fn) => (Array.isArray(fn?.extraKpis) ? fn.extraKpis : []);
/** An added KPI's id as actions store it: its own id ("absent"), not the row's ("people--absent"). */
const kpiKey = (k) => k?.kpiId ?? k?.id ?? null;
const findKpi = (month, fnId, kpiId) => extraKpis(fnLookup(month, fnId)).find((k) => kpiKey(k) === kpiId || k.id === kpiId) ?? null;
/** The KPI's id when the function has that KPI (either id works), else null. */
const validKpi = (month, fnId, kpiId) => (typeof kpiId === 'string' && kpiId ? kpiKey(findKpi(month, fnId, kpiId)) : null);
/** The KPI's name when an action is for a KPI added in Board setup ('' otherwise). */
function kpiName(month, fnId, kpiId) {
  if (!kpiId) return '';
  const k = findKpi(month, fnId, kpiId);
  return k?.kpiDaily ? plainLabel(k.kpiDaily) : 'A measure not on the board';
}

/**
 * Does an action count as its KPI's action on a board day ('YYYY-MM-DD')?
 * From the day it was added for (an older record with no day: from the start),
 * for as long as it is open, or through the day it was closed. With no day,
 * only open actions count (the old rule).
 */
function countsOn(a, dayIso) {
  if (!dayIso) return a.status !== 'closed';
  if (a.dayIso && a.dayIso > dayIso) return false;
  if (a.status !== 'closed') return true;
  return Boolean(a.closedDayIso) && a.closedDayIso >= dayIso;
}

/** One KPI row's actions from a list: open ones first (soonest due), then done ones (latest closed first). */
function kpiActions(list, fnId, kpiId = null) {
  const mine = list.filter((a) => a.fnId === fnId && (a.kpiId ?? null) === (kpiId ?? null));
  const open = mine.filter((a) => a.status !== 'closed')
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || String(a.createdAt).localeCompare(String(b.createdAt)));
  const done = mine.filter((a) => a.status === 'closed')
    .sort((a, b) => (b.closedDayIso ?? '').localeCompare(a.closedDayIso ?? '') || String(b.createdAt).localeCompare(String(a.createdAt)));
  return [...open, ...done];
}

// "No new issues to report" is the absence of a problem (NO_ISSUE, the board's rule).
const paragraphs = (t) => (t ?? '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
const hasReal = (t) => paragraphs(t).some((p) => !NO_ISSUE.test(p));
const hasAny = (t) => paragraphs(t).length > 0;

const isOverdue = (a, boardIso) => a.status !== 'closed' && Boolean(a.due) && a.due < boardIso;

/** Newest first; ties keep the newer insertion first. */
function newestFirst(list) {
  return list
    .map((a, i) => [a, i])
    .sort((x, y) => (y[0].createdAt || '').localeCompare(x[0].createdAt || '') || y[1] - x[1])
    .map(([a]) => a);
}

/* ---------- State ---------- */

const view = {
  show: 'open',         // 'open' (open + in progress) | 'all'
  fn: 'all',            // function id or 'all'
  boardOpen: false,     // "From the board" expanded (open by itself only when nothing is assigned)
  boardTouched: false,  // someone opened or folded it this visit: their choice stands
  pinned: new Set(),    // rows kept in view after a change, until a filter changes
};
let addOpen = false;
let addDraft = null;    // { fnId, kpiId, text, owner, ownerEdited, due }
let editingId = null;
let editDraft = null;
let opener = null;
let lastTrigger = null; // { el, at }: the [data-open-actions] or board [data-add-action] control that was clicked
let returnTo = null;    // { fn, kpi }: the board row whose Add action opened the sheet (focus goes back to it)
let lastAdded = null;   // { fn, kpi }: the board row of the last action added since the sheet opened
let skipRestore = false;
let downOnBackdrop = false;
let cleanupPending = false; // the sheet is open and its close clean-up hasn't run
// "Update in Enter numbers" closes this sheet for Enter numbers. When Enter numbers closes
// (Cancel, Esc or Save), the register comes back as it was: the same scroll, the same section,
// focus on the button that was used, and Esc still going back to what first opened it
// (Detail does the same after Edit numbers).
let backFromEnter = null; // { key, scroll, opener, returnTo, lastAdded }

const draftHasText = () => Boolean(addDraft && addDraft.text.trim());

/** Tell the app the register changed, so the board redraws its Action cells. */
function changed() {
  try { ctx?.onChange?.(); } catch (err) { console.error(err); }
}

/* ---------- Public API ---------- */

export function initActions(c) {
  ctx = c;
  dlg = document.createElement('dialog');
  dlg.className = 'sheet ar';
  dlg.id = 'action-register';
  dlg.setAttribute('aria-labelledby', 'ar-title');
  dlg.innerHTML = shellMarkup();
  document.body.append(dlg);

  dlg.addEventListener('cancel', onCancel);
  dlg.addEventListener('close', afterClose);
  dlg.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', onClick);
  dlg.addEventListener('change', onChange);
  dlg.addEventListener('input', onInput);
  dlg.addEventListener('submit', onSubmit);
  // A control that takes focus at the scroll area's edge (half under the footer) comes fully into view.
  dlg.addEventListener('focusin', (e) => keepInBody(e.target));
  // Ctrl or Cmd + Enter saves the Add or Edit form from its text boxes (as the meeting's Add action does).
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.isComposing) return;
    const form = e.target.closest?.('form.ar-form');
    if (!form || !dlg.contains(form) || !e.target.matches('textarea, input')) return;
    e.preventDefault();
    form.requestSubmit();
  });

  // Remember which control opened the sheet (a menu item may be hidden by then,
  // and a board button is drawn again once an action is saved).
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('[data-open-actions], [data-add-action]');
    if (t) lastTrigger = { el: t, at: Date.now() };
  }, true);
  // Run meeting pressed in a sheet on top of this one (the minutes): step aside
  // first, so the meeting is on top. app.js starts it from the same click.
  document.addEventListener('click', (e) => {
    if (dlg.open && e.target.closest?.('[data-run-meeting]')) { skipRestore = true; closeActions(); }
  }, true);
  // Another tab changed the register.
  window.addEventListener('storage', (e) => { if (e.key === KEY && dlg.open) render(); });
  // Enter numbers, opened from "Update in Enter numbers", closes by going back in the history
  // (Cancel, Esc, Save). This listener is added before the app's own (initActions runs first),
  // so its frame comes before the app's: the register is open again before a Save's
  // "Saved … Undo" toast is shown, and that toast shows in it. The close event is the fallback.
  window.addEventListener('popstate', () => { if (backFromEnter) requestAnimationFrame(returnFromEnter); });
  document.addEventListener('close', (e) => {
    if (e.target?.id === 'enter' && backFromEnter) requestAnimationFrame(() => requestAnimationFrame(returnFromEnter));
  }, true);
  // Toasts shown in the sheet sit above its footer.
  const foot = dlg.querySelector('.ar-foot');
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => dlg.style.setProperty('--ar-foot-h', `${foot.offsetHeight}px`)).observe(foot);
  }
}

/**
 * Open the register.
 * opts.addFor = a function id opens it with the Add form showing, set to that
 * function (and opts.kpiId, a KPI added in Board setup), the cursor in the
 * Action box. No opts: the register as it was left.
 */
export function openActions(opts = {}) {
  if (!dlg || !ctx) return;
  const o = opts && typeof opts === 'object' && !(opts instanceof Event) ? opts : {};
  const month = ctx.getMonth();
  const addFor = typeof o.addFor === 'string' && fnLookup(month, o.addFor) ? o.addFor : null;
  const kpiId = addFor ? validKpi(month, addFor, o.kpiId) : null;
  const body = dlg.querySelector('[data-ar-body]');
  if (dlg.open) {
    // Already open. Under another sheet (the meeting minutes): bring it to the front.
    // Already in front (a second call from the same click): keep it as it is.
    const top = body.scrollTop;
    if (!isOnTop()) {
      dlg.close();
      document.body.append(dlg);
      dlg.showModal();
    }
    render();
    body.scrollTop = top;
    if (addFor) showAdd(addFor, kpiId);
    else if (!dlg.contains(document.activeElement)) focusTitle();
    return;
  }
  const recent = lastTrigger && Date.now() - lastTrigger.at < 1500 ? lastTrigger.el : null;
  lastTrigger = null;
  opener = recent ?? (document.activeElement !== document.body ? document.activeElement : null);
  // A board row's Add action: remember which row, since saving redraws the board.
  returnTo = opener?.matches?.('[data-add-action]') && opener.dataset.addAction && !opener.closest('dialog, #meeting')
    ? { fn: opener.dataset.addAction, kpi: opener.dataset.addKpi ?? '' }
    : null;
  lastAdded = null;
  view.pinned.clear();
  // Nothing assigned yet: the day's issues and actions are what there is to see.
  if (!view.boardTouched) view.boardOpen = !readAll().some((a) => a.status !== 'closed');
  if (addOpen && !draftHasText()) { addOpen = false; addDraft = null; }
  // Opening over another sheet: be last in the page, so toasts land in this one.
  if (document.querySelector('dialog[open]')) document.body.append(dlg);
  render();
  renderAddForm();
  dlg.showModal();
  cleanupPending = true;
  body.scrollTop = 0;
  if (addFor) showAdd(addFor, kpiId); else focusTitle();
}

/**
 * Save an action (the meeting recorder uses this).
 * input = { fnId, kpiId?, text, owner, due, status, source, meetingId, dayIso? }
 * kpiId: a KPI added in Board setup, or null for the function's workbook KPI.
 * Returns the saved action, or null when there is no text.
 */
export function addAction(action) {
  if (!ctx) return null;
  const text = typeof action?.text === 'string' ? action.text.trim() : '';
  if (!text) return null;
  const saved = insert({ ...action, text });
  if (dlg?.open) render();
  changed();
  return saved;
}

/** Every stored action (a copy, in the order they were added). */
export function listActions() {
  return readAll();
}

/**
 * The actions that count for one function's KPI row on a board day: open ones
 * added for that day or before (soonest due first), then ones closed on that
 * day or later (status 'closed': show them as "Done: …").
 * kpiId null = the function's workbook KPI; a string = a KPI added in Board setup.
 * dayIso 'YYYY-MM-DD' = the board day; without it, every open action (the old rule).
 * The board, Detail, the meeting slides and the dashboard show these as the row's action.
 */
export function actionsFor(fnId, kpiId = null, dayIso = null) {
  const day = isoOrNull(dayIso);
  return kpiActions(readAll().filter((a) => countsOn(a, day)), fnId, kpiId);
}

/** The toast after a save that leaves every off-goal KPI with an action (the meeting's Add action can use it too). */
export const ALL_CLEAR_ADDED = 'Added. Every off-goal KPI now has an action and an owner.';

/**
 * Did a save just empty the needs list? Pass board.js needsSummary(month, day)
 * from before the save and from after it.
 */
export function clearedNeeds(before, after) {
  return Boolean(before?.list?.length) && !after?.list?.length && Boolean(after?.allClear);
}

/* ---------- Writes ---------- */

function insert(input) {
  const month = ctx.getMonth();
  const fnId = typeof input.fnId === 'string' && input.fnId ? input.fnId : null;
  const owner = typeof input.owner === 'string' && input.owner.trim() ? input.owner.trim() : ownerName(month, fnId);
  const status = normStatus(input.status) ?? 'open';
  const dayIso = isoOrNull(input.dayIso) ?? isoForDay(month, ctx.getDay());
  const action = {
    id: newId(),
    fnId,
    // A KPI added in Board setup; null = the function's workbook KPI.
    kpiId: fnId && typeof input.kpiId === 'string' && input.kpiId ? (validKpi(month, fnId, input.kpiId) ?? input.kpiId) : null,
    text: input.text,
    owner,
    due: isoOrNull(input.due),
    status,
    createdAt: new Date().toISOString(),
    source: input.source === 'meeting' ? 'meeting' : 'manual',
    meetingId: input.meetingId ?? null,
    dayIso,
    // Saved already closed: done on the day it was added for.
    closedDayIso: status === 'closed' ? dayIso : null,
  };
  const list = readAll();
  list.push(action);
  writeAll(list);
  return { ...action };
}

function setStatus(id, status) {
  const s = normStatus(status);
  const list = readAll();
  const a = list.find((x) => x.id === id);
  if (!a || !s || a.status === s) return;
  const month = ctx.getMonth();
  const day = ctx.getDay();
  const closing = s === 'closed';
  const prev = { status: a.status, closedDayIso: a.closedDayIso ?? null };
  const needsBefore = closing ? needsDays(month, a) : null;
  a.status = s;
  // Closed on the board day being looked at: it shows as done through that day. Never
  // before the day it was added for (closing it while looking at an earlier day closes
  // it on the day it was added, so the record never reads "Done Feb 3 · Added Feb 27").
  const viewed = isoForDay(month, day);
  a.closedDayIso = closing ? (a.dayIso && a.dayIso > viewed ? a.dayIso : viewed) : null;
  writeAll(list);
  view.pinned.add(id); // stays in view under "Open" until the filter changes
  render();
  changed();
  if (closing) closedToast({ ...a }, prev, needsBefore, month, day);
}

/** The board row an action is for: { fn, k }, or null when it isn't on the board. */
function rowOf(month, a) {
  const fn = functionById(month, a.fnId);
  if (!fn) return null;
  if (!a.kpiId) return { fn, k: { ...fn, primary: true } };
  const k = findKpi(month, a.fnId, a.kpiId);
  return k ? { fn, k } : null;
}

/** The days this month on which the action's KPI is on the needs list. */
function needsDays(month, a) {
  const out = new Set();
  const row = rowOf(month, a);
  if (!row) return out;
  for (let d = 1; d <= month.daysInMonth; d += 1) if (stateOf(month, row.fn, row.k, d).state === 'needs') out.add(d);
  return out;
}

/**
 * Say what marking it done did: "Marked done. It shows as done for Fri, Feb 27."
 * When the KPI is back on the needs list for a day (closed on a day before it),
 * say so. Undo reopens it.
 */
function closedToast(a, prev, needsBefore, month, day) {
  const parts = ['Marked done.'];
  if (countsOn(a, isoForDay(month, day))) parts.push(`It shows as done for ${nb(formatDayMedium(month, day))}.`);
  // Done while looking at a day before it was added: it was done on the day it was added for.
  else if (a.closedDayIso) parts.push(`It shows as done for ${nb(dayText(a.closedDayIso, month))}, the day it was added for.`);
  const row = rowOf(month, a);
  if (row && needsBefore) {
    const back = [...needsDays(month, a)].filter((d) => !needsBefore.has(d)).sort((x, y) => x - y);
    if (back.length) {
      const who = needsLabel(row.fn, row.k, false);
      const first = nb(formatDayMedium(month, back[0]));
      parts.push(back.length === 1
        ? `${who} is back on the needs list for ${first}.`
        : `${who} is back on the needs list for ${back.length} days, from ${first}.`);
    }
  }
  // The toast keeps clear of the action just closed (the last one in the list sat under it).
  ctx.toast(parts.join(' '), {
    actionLabel: 'Undo',
    onAction: () => reopen(a.id, prev),
    near: () => [dlg.querySelector(sel('data-ar-item', a.id))].filter(Boolean),
  });
}

/** Undo a close: the status it had before, and no closed day. */
function reopen(id, prev) {
  const list = readAll();
  const a = list.find((x) => x.id === id);
  if (!a) return;
  a.status = prev.status;
  a.closedDayIso = prev.status === 'closed' ? prev.closedDayIso : null;
  writeAll(list);
  view.pinned.add(id);
  changed();
  if (dlg.open) {
    render();
    focusKey(`st-${id}`);
  }
  ctx.toast(`Reopened. It's ${STATUS_WORD[prev.status].toLowerCase()} again.`);
}

function remove(id) {
  const list = readAll();
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) return;
  const visible = visibleActions(list, ctx.getMonth()).map((a) => a.id);
  const pos = visible.indexOf(id);
  const nextId = visible[pos + 1] ?? visible[pos - 1] ?? null;
  const [gone] = list.splice(idx, 1);
  writeAll(list);
  if (editingId === id) { editingId = null; editDraft = null; }
  render();
  changed();
  if (nextId) focusRow(nextId);
  else dlg.querySelector('#ar-list-title')?.focus({ preventScroll: true });
  ctx.toast(storageOk ? 'Action deleted.' : 'Action deleted for this visit.', {
    actionLabel: 'Undo',
    onAction: () => restore(gone, idx),
  });
}

function restore(action, idx) {
  const list = readAll();
  if (!list.some((a) => a.id === action.id)) {
    list.splice(Math.min(idx, list.length), 0, action);
    writeAll(list);
  }
  changed();
  view.pinned.add(action.id);
  if (dlg.open) {
    render();
    focusRow(action.id, { flash: true });
  }
  ctx.toast('Action restored.');
}

/* ---------- Opening and closing ---------- */

function focusTitle() {
  dlg.querySelector('#ar-title')?.focus({ preventScroll: true });
}

/**
 * Is the open sheet the one in front? A sheet opened over another one is moved
 * to the end of the page first (here and in the minutes), so no open dialog
 * after this one in the page means nothing sits over it.
 */
function isOnTop() {
  return ![...document.querySelectorAll('dialog[open]')].some((d) => d !== dlg && !dlg.contains(d)
    && (dlg.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING));
}

function closeActions() {
  if (!dlg.open) return;
  dlg.close();
  afterClose(); // now, not on the close event (Chromium fires that on the next frame)
}

function isShown(el) {
  if (!el || !el.isConnected || el === document.body || el.closest('[inert]')) return false;
  return el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null;
}

/** Runs once per opening: when this module closes the sheet, or on the close event otherwise. */
function afterClose() {
  if (!cleanupPending || dlg.open) return; // already done, or closed and opened again on top
  cleanupPending = false;
  editingId = null;
  editDraft = null;
  if (addOpen && !draftHasText()) { addOpen = false; addDraft = null; }
  const back = opener;
  const row = returnTo;
  const added = lastAdded;
  opener = null;
  returnTo = null;
  lastAdded = null;
  if (skipRestore) { skipRestore = false; return; }
  // Opened from a board row's Add action: back to that row (the board has been
  // drawn again by now), never to the Menu.
  if (row) {
    if (focusBoardRow(row)) return;
    const fallback = [back, document.getElementById('board'), document.getElementById('home')].find(isShown) ?? document.getElementById('board');
    fallback?.focus({ preventScroll: true });
    return;
  }
  // Opened from the board's needs line ("Open the Action register"): the board has been
  // drawn again, so that button is a new element. Back to it; once every off-goal KPI
  // has an action the line has no button, so back to the row of the action just added.
  if (back && !back.isConnected && back.matches?.('[data-open-actions]')) {
    const again = [...document.querySelectorAll('.board-note [data-open-actions]')].find(isShown);
    if (again) { again.focus(); return; }
    if (added && focusBoardRow(added)) return;
  }
  // Back to the control that opened it; a hidden menu item hands over to the Menu button.
  const target = [back, document.querySelector('.topbar [data-topbar-more]'), document.querySelector('.topbar [data-open-actions]')]
    .find(isShown) ?? document.getElementById('board');
  target?.focus({ preventScroll: true });
}

/**
 * The board row an Add action came from: its Add action button when the row
 * still shows one, else the KPI's link (the row now has an action), else the
 * function's name. Scrolled to the middle of the screen and focused.
 */
function focusBoardRow({ fn, kpi }) {
  const onBoard = (el) => isShown(el) && !el.closest('dialog, #meeting');
  const find = (selector) => [...document.querySelectorAll(selector)].find(onBoard) ?? null;
  const rowId = kpi ? `${fn}--${kpi}` : fn;
  const el = find(`[data-add-action="${CSS.escape(fn)}"][data-add-kpi="${CSS.escape(kpi)}"]`)
    ?? find(`.kpirow[data-kpi="${CSS.escape(rowId)}"] .kpi-link`)
    ?? find(`#fn-${CSS.escape(fn)} .fn-link`)
    // The home's Issues and actions row for that KPI (its Add action is gone once it has one).
    ?? find(`.home-app tr.iss-row.is-first[data-kpi-row="${CSS.escape(rowId)}"] .iss-link`);
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  el.focus({ preventScroll: true });
  return true;
}

function onCancel(e) {
  // Esc inside a form closes that form, not the whole sheet.
  e.preventDefault();
  const form = document.activeElement?.closest?.('form.ar-form');
  if (form && dlg.contains(form)) {
    if (form.matches('[data-ar-edit-form]')) cancelEdit();
    else hideAdd();
    return;
  }
  closeActions();
}

/* ---------- Events ---------- */

function onClick(e) {
  if (e.target === dlg) {
    // The dimmed area outside the panel (only when the press started there too).
    if (downOnBackdrop) closeActions();
    return;
  }
  const b = e.target.closest('button');
  if (!b || !dlg.contains(b) || b.closest('.toast')) return;
  if (b.matches('[data-ar-close]')) closeActions();
  else if (b.matches('[data-ar-add]')) (addOpen ? hideAdd() : showAdd());
  else if (b.matches('[data-ar-add-for]')) showAdd(b.dataset.arAddFor, b.dataset.arAddKpi || null);
  else if (b.matches('[data-ar-add-cancel]')) cancelAdd();
  else if (b.matches('[data-ar-update]')) updateInEnter(b.dataset.arUpdate || null, b);
  else if (b.matches('[data-ar-board-toggle]')) toggleBoard(b);
  else if (b.matches('[data-ar-edit]')) startEdit(b.dataset.arEdit);
  else if (b.matches('[data-ar-edit-cancel]')) cancelEdit();
  else if (b.matches('[data-ar-delete]')) remove(b.dataset.arDelete);
  else if (b.matches('[data-ar-source]')) {
    const a = readAll().find((x) => x.id === b.dataset.arSource);
    minutes(a?.meetingId ?? undefined);
  } else if (b.matches('[data-ar-minutes]')) minutes();
  else if (b.matches('[data-ar-reset]')) {
    if (b.dataset.arReset === 'show') view.show = 'all';
    else view.fn = 'all';
    view.pinned.clear();
    render();
    dlg.querySelector('#ar-list-title')?.focus({ preventScroll: true });
  }
}

function onChange(e) {
  const t = e.target;
  if (t.matches('[data-ar-show]')) {
    view.show = t.value;
    view.pinned.clear();
    render();
    return;
  }
  if (t.matches('[data-ar-fn-filter]')) {
    view.fn = t.value;
    view.pinned.clear();
    render();
    return;
  }
  if (t.matches('[data-ar-status]')) {
    setStatus(t.dataset.arStatus, t.value);
    return;
  }
  if (t.name === 'kpiId') {
    const draft = draftFor(t.closest('form'));
    if (draft) draft.kpiId = t.value || null;
    return;
  }
  if (t.name === 'fnId') {
    const form = t.closest('form');
    const draft = draftFor(form);
    if (!draft) return;
    draft.fnId = t.value || null;
    // Another function: its own KPIs (the workbook one to start).
    draft.kpiId = null;
    renderKpiSlot(form, draft);
    if (t.value) setError(t, '');
    // The owner follows the function until someone types a different name.
    if (!draft.ownerEdited) {
      draft.owner = ownerName(ctx.getMonth(), draft.fnId);
      const owner = form.elements.namedItem('owner');
      owner.value = draft.owner;
      if (draft.owner) setError(owner, '');
    }
  }
}

function onInput(e) {
  const t = e.target;
  const draft = draftFor(t.closest?.('form'));
  if (!draft) return;
  if (t.name === 'text') draft.text = t.value;
  if (t.name === 'owner') {
    draft.owner = t.value;
    // A typed name sticks; an emptied box goes back to following the function.
    const typed = t.value.trim();
    draft.ownerEdited = typed !== '' && typed !== ownerName(ctx.getMonth(), draft.fnId);
  }
  if (t.name === 'due') draft.due = t.value || null;
  // An error goes away as soon as the field is fixed (new ones wait for Save).
  if (t.getAttribute('aria-invalid') === 'true' && fieldError(t) === '') setError(t, '');
}

function onSubmit(e) {
  e.preventDefault();
  const form = e.target;
  if (form.matches('[data-ar-add-form]')) saveAdd(form);
  else if (form.matches('[data-ar-edit-form]')) saveEdit(form);
}

function draftFor(form) {
  if (!form) return null;
  if (form.matches('[data-ar-add-form]')) return addDraft;
  if (form.matches('[data-ar-edit-form]')) return editDraft;
  return null;
}

function minutes(meetingId) {
  try {
    if (meetingId === undefined || meetingId === null) ctx.openMinutes();
    else ctx.openMinutes(meetingId);
  } catch (err) {
    console.error(err);
    ctx.toast("Meeting minutes couldn't open. Try again from the Menu.");
  }
}

function updateInEnter(fnId, used = null) {
  // What to come back to when Enter numbers closes (closing this sheet forgets its opener).
  const back = {
    key: used?.getAttribute('data-fk') ?? null,
    scroll: dlg.querySelector('[data-ar-body]')?.scrollTop ?? 0,
    opener,
    returnTo,
    lastAdded,
  };
  // Straight to that function's form when the app offers it; otherwise Enter numbers as usual.
  if (fnId && ctx.enterFor) {
    skipRestore = true; // Enter numbers takes focus
    closeActions();
    ctx.enterFor(fnId);
  } else {
    const btn = document.querySelector('.topbar [data-enter], .mobile-bar [data-enter]');
    if (btn) skipRestore = true; // Enter numbers takes focus
    closeActions();
    btn?.click();
  }
  // Only when Enter numbers did open: its close brings this sheet back.
  backFromEnter = document.getElementById('enter')?.open ? back : null;
}

/** Enter numbers has closed (it stays open over unsaved numbers): bring the register back, once. */
function returnFromEnter() {
  if (!backFromEnter || document.getElementById('enter')?.open) return;
  const back = backFromEnter;
  backFromEnter = null;
  reopenAfterEnter(back);
}

/**
 * Back from Enter numbers: the register as it was left (filters, the From the board
 * section open or folded, the scroll), drawn from the latest numbers and notes, with
 * focus on the Update in Enter numbers button that was used (its section's toggle, or
 * the title, when that card has gone). Nothing happens when another screen has taken over.
 */
function reopenAfterEnter(back) {
  if (!dlg || !ctx || dlg.open) return;
  if (document.documentElement.classList.contains('is-meeting')) return;
  // A plain message already showing (Save with nothing changed: "Nothing to save.") would be
  // cleared by this sheet opening (toast.js): say it again here. One with Undo can't be showing
  // yet: the app shows a save's toast in the frame after this one.
  const shown = document.querySelector('[data-toasts] .toast:not(.is-leaving)');
  const note = shown && !shown.querySelector('.toast-action') ? shown.querySelector('.toast-text')?.textContent ?? '' : '';
  opener = back.opener;
  returnTo = back.returnTo;
  lastAdded = back.lastAdded;
  // Over Detail (the register was opened from it): be last in the page, so it's on top and toasts land here.
  if (document.querySelector('dialog[open]')) document.body.append(dlg);
  render();
  renderAddForm();
  dlg.showModal();
  cleanupPending = true;
  const body = dlg.querySelector('[data-ar-body]');
  if (body) body.scrollTop = back.scroll;
  const used = back.key ? dlg.querySelector(sel('data-fk', back.key)) : null;
  const target = [used, dlg.querySelector('[data-ar-board-toggle]')].find(isShown);
  if (target) {
    // A save can change the cards above it: keep the button in view.
    target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    target.focus({ preventScroll: true });
  } else focusTitle();
  if (note) ctx.toast(note);
}

/** Draw the open register again after the board's numbers or notes changed under it (a save's Undo). Focus stays put. */
export function refreshActions() {
  if (dlg?.open && ctx) render();
}

function toggleBoard(btn) {
  view.boardOpen = !view.boardOpen;
  view.boardTouched = true;
  btn.setAttribute('aria-expanded', String(view.boardOpen));
  const body = dlg.querySelector('#ar-board-body');
  if (body) body.hidden = !view.boardOpen;
  // Opened low in the sheet: bring its heading up so the notes show under it.
  if (view.boardOpen) btn.closest('.ar-section')?.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
}

/* ---------- Add form ---------- */

function freshDraft(month, fnId, kpiId = null) {
  const id = fnLookup(month, fnId) ? fnId : (month.functions[0]?.id ?? null);
  return {
    fnId: id,
    kpiId: id === fnId ? validKpi(month, id, kpiId) : null,
    text: '',
    owner: ownerName(month, id),
    ownerEdited: false,
    // The next production day after the board day (Fri, Feb 27 gives Mon, Mar 2).
    due: nextProductionDayIso(month, ctx.getDay()),
  };
}

function showAdd(fnId, kpiId = null) {
  const month = ctx.getMonth();
  if (!addDraft) addDraft = freshDraft(month, fnId ?? (view.fn !== 'all' ? view.fn : null), kpiId);
  else if (fnId && (fnId !== addDraft.fnId || validKpi(month, fnId, kpiId) !== (addDraft.kpiId ?? null))) {
    // A typed action is kept; it now goes to the function asked for.
    if (fnId !== addDraft.fnId && !addDraft.ownerEdited) addDraft.owner = ownerName(month, fnId);
    addDraft.fnId = fnId;
    addDraft.kpiId = validKpi(month, fnId, kpiId);
  }
  const wasOpen = addOpen;
  addOpen = true;
  if (!wasOpen || fnId) renderAddForm();
  const form = dlg.querySelector('[data-ar-add-form]');
  form.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
  // From a board card the function is already picked, so start on the words. With no
  // functions on the board, the form is one line and its Open Board setup button.
  (dlg.querySelector(fnId ? '#ar-a-text' : '#ar-a-fn') ?? form.querySelector('button'))?.focus({ preventScroll: true });
}

/** Hide the form and keep what was typed (the Add action button brings it back). */
function hideAdd() {
  addOpen = false;
  renderAddForm();
  dlg.querySelector('[data-ar-add]')?.focus({ preventScroll: true });
}

function cancelAdd() {
  addDraft = null;
  hideAdd();
}

function renderAddForm() {
  const form = dlg.querySelector('[data-ar-add-form]');
  const toggle = dlg.querySelector('[data-ar-add]');
  toggle.setAttribute('aria-expanded', String(addOpen));
  // While the form is open its button steps aside, so a second press can't fold
  // the form away with a typed action in it (Cancel and Esc are the ways out).
  toggle.hidden = addOpen;
  form.hidden = !addOpen;
  if (!addOpen) { form.innerHTML = ''; return; }
  const month = ctx.getMonth();
  if (!month.functions.length) {
    // Every function removed in Board setup: no function to pick, so no empty picker. The
    // board's line and the way back (Board setup opens over the register) instead.
    form.innerHTML = `
      <h3 class="ar-form-title" id="ar-add-title">Add action</h3>
      <p class="ar-empty ar-empty--fns">${esc(NO_FUNCTIONS)}</p>
      <div class="ar-form-actions">
        <button class="btn btn--primary" type="button" data-open-setup>Open Board setup</button>
        <button class="btn btn--secondary" type="button" data-ar-add-cancel>Close</button>
      </div>`;
    return;
  }
  if (!addDraft) addDraft = freshDraft(month, view.fn !== 'all' ? view.fn : null);
  form.innerHTML = `
    <h3 class="ar-form-title" id="ar-add-title">Add action</h3>
    ${fieldsMarkup('ar-a', addDraft, month)}
    <div class="ar-form-actions">
      <button class="btn btn--primary" type="submit">Save action</button>
      <button class="btn btn--secondary" type="button" data-ar-add-cancel>Cancel</button>
    </div>`;
}

function saveAdd(form) {
  if (!validate(form)) return;
  const d = readForm(form);
  const before = needsSum(ctx.getMonth(), ctx.getDay());
  const saved = insert({ ...d, status: 'open', source: 'manual', meetingId: null });
  if (saved.fnId) lastAdded = { fn: saved.fnId, kpi: saved.kpiId ?? '' };
  // The payoff: this save took the last off-goal KPI off the needs list.
  const cleared = clearedNeeds(before, needsSum(ctx.getMonth(), ctx.getDay()));
  addOpen = false;
  addDraft = null;
  renderAddForm();
  // Make sure the new row can be seen.
  if (view.fn !== 'all' && view.fn !== saved.fnId) view.fn = 'all';
  view.pinned.add(saved.id);
  render();
  changed();
  focusRow(saved.id, { flash: true, scroll: true });
  const unsaved = "This browser isn't saving, so it will clear when the page reloads.";
  if (cleared) ctx.toast(storageOk ? ALL_CLEAR_ADDED : `${ALL_CLEAR_ADDED} ${unsaved}`);
  else ctx.toast(storageOk ? 'Added to the Action register.' : `Added for this visit. ${unsaved}`);
}

/* ---------- Edit ---------- */

function startEdit(id) {
  const a = readAll().find((x) => x.id === id);
  if (!a) return;
  const month = ctx.getMonth();
  editingId = id;
  editDraft = {
    fnId: a.fnId,
    kpiId: a.kpiId ?? null,
    text: a.text,
    owner: a.owner,
    ownerEdited: a.owner.trim() !== '' && a.owner.trim() !== ownerName(month, a.fnId),
    due: a.due,
  };
  render();
  const form = dlg.querySelector('[data-ar-edit-form]');
  form?.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
  const ta = dlg.querySelector('#ar-e-text');
  if (ta) {
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
}

function cancelEdit() {
  const id = editingId;
  editingId = null;
  editDraft = null;
  render();
  if (id) focusKey(`edit-${id}`);
}

function saveEdit(form) {
  if (!validate(form)) return;
  const d = readForm(form);
  const list = readAll();
  const a = list.find((x) => x.id === editingId);
  const id = editingId;
  editingId = null;
  editDraft = null;
  if (!a) { render(); return; }
  const before = needsSum(ctx.getMonth(), ctx.getDay());
  Object.assign(a, { fnId: d.fnId, kpiId: d.fnId ? d.kpiId : null, text: d.text, owner: d.owner, due: d.due });
  writeAll(list);
  view.pinned.add(id);
  render();
  changed();
  focusKey(`edit-${id}`);
  flash(dlg.querySelector(sel('data-ar-item', id)));
  // Moved to the last KPI that needed one: the same payoff as an Add.
  const cleared = clearedNeeds(before, needsSum(ctx.getMonth(), ctx.getDay()));
  const done = cleared ? 'Updated. Every off-goal KPI now has an action and an owner.' : 'Action updated.';
  ctx.toast(storageOk ? done : `${done} This browser isn't saving, so it will clear when the page reloads.`);
}

/* ---------- Form fields, shared by Add and Edit ---------- */

function fieldsMarkup(p, d, month) {
  const known = month.functions.some((f) => f.id === d.fnId);
  const hidden = !known && d.fnId ? fnLookup(month, d.fnId) : null;
  const options = [
    !d.fnId ? '<option value="" selected>Choose a function</option>' : '',
    ...month.functions.map((f) => `<option value="${esc(f.id)}"${f.id === d.fnId ? ' selected' : ''}>${esc(f.name)}</option>`),
    hidden ? `<option value="${esc(hidden.id)}" selected>${esc(hidden.name)} (not on the board)</option>` : '',
  ].join('');
  const kpi = kpiFieldMarkup(p, d, month);
  return `
    <div class="ar-fields">
      <div class="ar-field">
        <label class="ar-label" for="${p}-fn">Function</label>
        <span class="ar-pick"><select id="${p}-fn" name="fnId" data-fk="${p}-fn">${options}</select></span>
        ${errorMarkup(`${p}-fn`)}
      </div>
      <div class="ar-field" data-ar-kpi-slot${kpi ? '' : ' hidden'}>${kpi}</div>
      <div class="ar-field ar-field--wide">
        <label class="ar-label" for="${p}-text">Action</label>
        <textarea class="ar-textarea" id="${p}-text" name="text" rows="3" required data-fk="${p}-text" aria-keyshortcuts="Control+Enter Meta+Enter">${esc(d.text)}</textarea>
        ${errorMarkup(`${p}-text`)}
      </div>
      <div class="ar-field">
        <label class="ar-label" for="${p}-owner">Owner</label>
        <input class="ar-input" id="${p}-owner" name="owner" type="text" autocomplete="off" list="ar-owners"
          value="${esc(d.owner)}" required aria-describedby="${p}-owner-hint" data-fk="${p}-owner">
        <p class="ar-hint" id="${p}-owner-hint">Filled in from the function. Change it if someone else will do it.</p>
        ${errorMarkup(`${p}-owner`)}
      </div>
      <div class="ar-field">
        <label class="ar-label" for="${p}-due">Due date</label>
        <input class="ar-input ar-date" id="${p}-due" name="due" type="date" value="${esc(d.due ?? '')}" data-fk="${p}-due">
        ${errorMarkup(`${p}-due`)}
      </div>
    </div>`;
}

/**
 * "Measure": shown only when the function tracks a KPI added in Board setup.
 * The first choice is the function's workbook KPI (kpiId null).
 */
function kpiFieldMarkup(p, d, month) {
  const fn = fnLookup(month, d.fnId);
  const extras = extraKpis(fn);
  if (!fn || (!extras.length && !d.kpiId)) return '';
  const opts = [['', fn.kpiDaily ? plainLabel(fn.kpiDaily) : 'Main measure'],
    ...extras.map((k) => [kpiKey(k), k.kpiDaily ? plainLabel(k.kpiDaily) : 'Measure'])];
  if (d.kpiId && !opts.some(([v]) => v === d.kpiId)) opts.push([d.kpiId, 'A measure not on the board']);
  const picked = d.kpiId ?? '';
  return `
        <label class="ar-label" for="${p}-kpi">Measure</label>
        <span class="ar-pick"><select id="${p}-kpi" name="kpiId" data-fk="${p}-kpi">${opts
          .map(([v, t]) => `<option value="${esc(v)}"${v === picked ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></span>`;
}

/** The function changed in a form: show its measures (or none). */
function renderKpiSlot(form, draft) {
  const slot = form?.querySelector('[data-ar-kpi-slot]');
  if (!slot) return;
  const html = kpiFieldMarkup(form.matches('[data-ar-edit-form]') ? 'ar-e' : 'ar-a', draft, ctx.getMonth());
  slot.innerHTML = html;
  slot.hidden = !html;
}

const errorMarkup = (id) => `<p class="ar-error" id="${id}-err" hidden>${glyph('g-off')}<span></span></p>`;

/** The message a field should show now ('' when it's fine). */
function fieldError(el) {
  if (el.name === 'fnId') return el.value ? '' : 'Pick the function this belongs to.';
  if (el.name === 'text') return el.value.trim() ? '' : 'Write what will be done.';
  if (el.name === 'owner') return el.value.trim() ? '' : 'Name who will do it.';
  if (el.name === 'due') return el.validity?.badInput ? 'Finish the date, or clear it for no due date.' : '';
  return '';
}

function setError(el, message) {
  const err = dlg.querySelector(`#${CSS.escape(el.id)}-err`);
  if (!err) return;
  err.hidden = !message;
  err.querySelector('span').textContent = message;
  const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((x) => x && x !== err.id);
  if (message) {
    el.setAttribute('aria-invalid', 'true');
    ids.push(err.id);
  } else {
    el.removeAttribute('aria-invalid');
  }
  if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
  else el.removeAttribute('aria-describedby');
}

function validate(form) {
  let first = null;
  for (const name of ['fnId', 'text', 'owner', 'due']) {
    const el = form.elements.namedItem(name);
    if (!el) continue;
    const message = fieldError(el);
    setError(el, message);
    if (message && !first) first = el;
  }
  if (first) {
    first.focus();
    // The message can push Save action down past the footer: keep it in view under the field to fix.
    keepInBody(first, form.querySelector(':scope > .ar-form-actions'));
  }
  return !first;
}

/** Room kept between a focused control (and its focus ring) and the scroll area's top and bottom. */
const BODY_EDGE = 12;
/**
 * The register scrolls between its title bar and its footer (css/actions.css .ar-body, whose
 * scroll-padding keeps the same room when the browser scrolls). The browser leaves a control
 * that is partly on screen where it is, so it can sit cut off at the footer: move the list just
 * enough that the control, and `alsoShow` under it when both fit, sit clear of both edges.
 * A field moves with its label (the field's box), so the label never goes under the title bar.
 */
function keepInBody(el, alsoShow = null) {
  const body = dlg?.querySelector('.ar-body');
  if (!body || !el || !body.contains(el)) return;
  requestAnimationFrame(() => {
    if (!dlg.open || document.activeElement !== el) return;
    const b = body.getBoundingClientRect();
    const top = b.top + BODY_EDGE;
    const bottom = b.bottom - BODY_EDGE;
    const start = (el.closest('.ar-field') ?? el).getBoundingClientRect().top;
    const end = Math.max(el.getBoundingClientRect().bottom, alsoShow?.getBoundingClientRect().bottom ?? 0);
    let by = 0;
    if (start < top) by = start - top;
    else if (end > bottom) by = Math.min(end - bottom, start - top);
    if (by) body.scrollBy({ top: Math.round(by), behavior: 'instant' });
  });
}

function readForm(form) {
  const v = (name) => form.elements.namedItem(name)?.value ?? '';
  const fnId = v('fnId') || null;
  return { fnId, kpiId: fnId ? v('kpiId') || null : null, text: v('text').trim(), owner: v('owner').trim(), due: isoOrNull(v('due')) };
}

/* ---------- Render ---------- */

function visibleActions(all, month) {
  void month;
  return newestFirst(all).filter((a) => view.pinned.has(a.id) || (
    (view.show === 'all' || a.status !== 'closed') && (view.fn === 'all' || a.fnId === view.fn)
  ));
}

/** Redraw everything except the Add form, keeping keyboard focus where it was. */
function render() {
  const active = document.activeElement;
  const key = active && dlg.contains(active) ? active.getAttribute('data-fk') : null;
  let range = null;
  try { if (key && typeof active.selectionStart === 'number') range = [active.selectionStart, active.selectionEnd]; } catch { /* no selection here */ }

  const month = ctx.getMonth();
  const day = ctx.getDay();
  const all = readAll();
  renderCount(all, month, day);
  renderNeeds(month, day);
  renderFilters(month);
  renderList(all, month, day);
  renderBoard(month, day, all);
  renderStorageNote();
  dlg.querySelector('[data-ar-owners]').innerHTML = [...new Set(month.functions.map((f) => ownerFor(f).name).filter(Boolean))]
    .map((n) => `<option value="${esc(n)}"></option>`).join('');

  if (key && !active.isConnected) {
    const el = dlg.querySelector(sel('data-fk', key));
    if (el) {
      el.focus({ preventScroll: true });
      if (range) { try { el.setSelectionRange(...range); } catch { /* not a text field */ } }
    }
  }
}

/** The board's needs summary for the day (an empty one when the board can't say). */
function needsSum(month, day) {
  try { return needsSummary(month, day); } catch { return { list: [], lead: '', text: '', allClear: false }; }
}

/** Off-goal KPIs with no action yet, for the day (none when the board can't say). */
const needsList = (month, day) => needsSum(month, day).list;

/** One KPI row's action state (as if it had nothing recorded when the board can't say). */
function stateOf(month, fn, k, day) {
  try { return actionStateFor(month, fn, k, day); } catch { return { state: 'nothing', word: ACTION_WORD.nothing, text: null, assigned: [] }; }
}

/** Off goal with no issue written (board.js issueGap, one rule on every screen); false when the board can't say. */
function gapOf(month, fn, k, day) {
  try { return issueGap(month, fn, k, day); } catch { return false; }
}

/**
 * The head's counts, in words a first-time reader follows:
 * "2 need an action · 1 open · 1 in progress · 1 done · 1 overdue".
 * Always the whole board and every assigned action, whatever the filters show.
 */
function renderCount(all, month, day) {
  const el = dlg.querySelector('[data-ar-count]');
  const sum = needsSum(month, day);
  const needs = sum.list.length;
  const count = (s) => all.filter((a) => a.status === s).length;
  const over = all.filter((a) => isOverdue(a, isoForDay(month, day))).length;
  const parts = [];
  if (needs) parts.push(`<span class="ar-part ar-over">${glyph('g-off')}${needs} ${needs === 1 ? 'needs' : 'need'} an action</span>`);
  // Something is off goal and every one of those KPIs has an action: say so first.
  else if (sum.allClear) parts.push(`<span class="ar-part ar-clear">${glyph('g-on')}Every off-goal KPI has an action</span>`);
  if (!all.length) parts.push('<span class="ar-part">No actions assigned yet</span>');
  else {
    // Only the counts there are: "1 done", never "0 open" (a phone stacks each one on its own line).
    if (count('open')) parts.push(`<span class="ar-part">${count('open')} open</span>`);
    if (count('in-progress')) parts.push(`<span class="ar-part">${count('in-progress')} in progress</span>`);
    if (count('closed')) parts.push(`<span class="ar-part">${count('closed')} done</span>`);
  }
  if (over) parts.push(`<span class="ar-part ar-over">${glyph('g-off')}${over} overdue</span>`);
  el.innerHTML = parts.join('<span class="ar-dotsep">\u00a0· </span>');
}

/**
 * "Needs an action", at the top: each off-goal KPI with no action and no owner
 * yet, its status and number, and an Add action button set to that KPI.
 * Hidden when there are none.
 */
function renderNeeds(month, day) {
  const host = dlg.querySelector('[data-ar-needs]');
  const list = needsList(month, day);
  host.hidden = !list.length;
  if (!list.length) { host.innerHTML = ''; return; }
  host.innerHTML = `
    <div class="ar-section-head">
      <h3 class="section-title ar-needs-title" id="ar-needs-title">${statusMarkup(OFF, { tag: 'span', word: ACTION_WORD.needs })}<span class="ar-needs-n">(${list.length})</span></h3>
    </div>
    <p class="section-sub ar-needs-sub">Off goal, and nobody has an action for it yet. Add one and it leaves this list.</p>
    <ul class="ar-nlist">${list.map((item) => needsRow(item, month, day)).join('')}</ul>`;
}

function needsRow({ fn, k, monthOnly, label }, month, day) {
  const st = stateOf(month, fn, k, day);
  const s = (monthOnly ? st.mo : st.y) ?? { status: OFF, actual: null, goal: null };
  const kpi = monthOnly ? k.kpiMonthly : k.kpiDaily;
  const f = formatPair(s.actual, s.goal, kpi);
  const fig = f.actual === null ? '' : `${f.actual}${f.rest ? ` ${f.rest}` : ''}`;
  const when = monthOnly ? monthSoFar(month) : formatDayMedium(month, day);
  const kpiKeyValue = k.primary ? '' : String(k.kpiId ?? '');
  const sep = '<span class="ar-dotsep">\u00a0· </span>';
  return `
    <li class="ar-nrow">
      <div class="ar-nrow-main">
        <p class="ar-nrow-name">${esc(label)}</p>
        <p class="ar-nrow-meta"><span class="ar-nrow-when">${esc(nb(when))}:</span> ${statusMarkup(s.status, { tag: 'span', kpi })}${fig ? `${sep}<span class="ar-nrow-fig">${esc(fig)}</span>` : ''}${sep}<span>${esc(ownerFor(fn).name ?? '')}</span></p>
      </div>
      <button class="btn btn--primary ar-nrow-add" type="button" data-ar-add-for="${esc(fn.id)}" data-ar-add-kpi="${esc(kpiKeyValue)}" data-fk="needs-${esc(k.id)}">${PLUS}Add action<span class="sr-only"> for ${esc(label)}</span></button>
    </li>`;
}

function renderFilters(month) {
  dlg.querySelectorAll('[data-ar-show]').forEach((r) => { r.checked = r.value === view.show; });
  const select = dlg.querySelector('[data-ar-fn-filter]');
  const opts = [['all', 'All functions'], ...month.functions.map((f) => [f.id, f.name])];
  const signature = JSON.stringify(opts);
  if (select.dataset.sig !== signature) {
    select.innerHTML = opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    select.dataset.sig = signature;
  }
  if (!opts.some(([v]) => v === view.fn)) view.fn = 'all';
  select.value = view.fn;
}

const CHEVRON = '<svg class="ar-chev" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The functions with something on the board for the day (an issue, an action, or an open assigned action). */
function boardCards(month, day, all, fnFilter = view.fn) {
  // The actions that count for the day: open ones added by then, and ones closed that day or later.
  const counted = all.filter((a) => countsOn(a, isoForDay(month, day)));
  const fns = month.functions.filter((f) => fnFilter === 'all' || f.id === fnFilter);
  const cards = [];
  const quiet = [];
  for (const fn of fns) {
    const measures = boardNotes(month, fn, day, counted);
    if (measures.length) cards.push({ fn, measures });
    else quiet.push(fn);
  }
  return { fns, cards, quiet };
}

/**
 * The functions with nothing to show here, in the board's words:
 * "Needs an action: Operations." (off goal, nobody on it yet), then
 * "No issue reported: Quality." and "Nothing recorded: Safety."
 */
function quietLines(month, day, quiet) {
  const groups = { needs: [], none: [], nothing: [] };
  for (const fn of quiet) {
    const states = kpiRowsFor(fn).map((k) => stateOf(month, fn, k, day).state);
    if (states.includes('needs')) groups.needs.push(fn);
    else if (states.every((s) => s === 'nothing')) groups.nothing.push(fn);
    else groups.none.push(fn);
  }
  const names = (list) => list.map((f) => esc(f.name)).join(', ');
  const lines = [];
  if (groups.needs.length) lines.push(`<p class="ar-quiet ar-quiet--needs">${statusMarkup(OFF, { tag: 'span', word: `${ACTION_WORD.needs}:` })} ${names(groups.needs)}.</p>`);
  if (groups.none.length) lines.push(`<p class="ar-quiet">No issue reported: ${names(groups.none)}.</p>`);
  if (groups.nothing.length) lines.push(`<p class="ar-quiet">${esc(ACTION_WORD.nothing)}: ${names(groups.nothing)}.</p>`);
  return { html: lines.join(''), onlyNothing: !groups.needs.length && !groups.none.length };
}

function renderBoard(month, day, all) {
  const host = dlg.querySelector('[data-ar-board]');
  const dayName = esc(nb(formatDayMedium(month, day)));
  const boardIso = isoForDay(month, day);
  const { fns, cards, quiet } = boardCards(month, day, all);
  const forWho = view.fn === 'all' ? '' : ` for ${esc(fnName(month, view.fn))}`;

  const quietInfo = quietLines(month, day, quiet);
  if (!cards.length) {
    host.innerHTML = `
      <div class="ar-section-head"><h3 class="section-title" id="ar-board-title">From the board, ${dayName}</h3></div>
      ${quietInfo.onlyNothing
        ? `<p class="ar-empty">No issues or actions on the board${forWho} for ${dayName} yet. Issues and next-24-hour actions entered in Enter numbers show up here.</p>`
        : `<p class="ar-empty">No issues or next-24-hour actions${forWho} for ${dayName}.</p>${quietInfo.html}`}
      <p class="ar-empty-tools"><button class="btn btn--secondary" type="button" data-ar-update data-fk="upd-empty">Update in Enter numbers</button></p>`;
    return;
  }
  const n = cards.length;
  const lead = view.fn === 'all' ? `${n} of ${fns.length} functions have an issue or action. ` : '';
  // Folded by default: the toggle is the heading, and it says how many functions are inside.
  host.innerHTML = `
    <div class="ar-section-head">
      <h3 class="section-title ar-board-title" id="ar-board-title">
        <button class="ar-disclosure" type="button" data-ar-board-toggle aria-expanded="${view.boardOpen}" aria-controls="ar-board-body" data-fk="board-toggle">${CHEVRON}<span>From the board, ${dayName} (${n}<span class="sr-only"> ${n === 1 ? 'function' : 'functions'}</span>)</span></button>
      </h3>
    </div>
    <div class="ar-board-body" id="ar-board-body"${view.boardOpen ? '' : ' hidden'}>
      <p class="section-sub">${lead}Read only here. Change them in Enter numbers.</p>
      <ul class="ar-blist">${cards.map((c) => boardCard(c, month, boardIso)).join('')}</ul>
      ${quietInfo.html}
    </div>`;
}

/**
 * The day's notes for a function: its main measure plus any measures added in
 * Board setup (each keeps its own issue, action and status, as on the board),
 * with each measure's assigned actions for the day (open, then done).
 */
function boardNotes(month, fn, day, counted) {
  return kpiRowsFor(fn)
    .map((r) => ({
      label: r.kpiDaily?.boardLabel ? plainLabel(r.kpiDaily) : '',
      n: notesFor(r, day),
      assigned: kpiActions(counted, fn.id, r.primary ? null : kpiKey(r)),
      st: stateOf(month, fn, r, day),
      gap: gapOf(month, fn, r, day),
    }))
    .filter(({ n, assigned }) => hasReal(n.problem) || hasReal(n.action) || assigned.length > 0);
}

function boardCard({ fn, measures }, month, boardIso) {
  const id = esc(fn.id);
  const name = esc(fn.name);
  // Name the measure only when the function tracks more than one.
  const named = extraKpis(fn).length > 0;
  // Off goal with no issue written: the board's red line alone ("No new issues to report"
  // under a miss would contradict it), as on every other screen.
  const issue = (n, gap) => {
    if (gap) return `<dd class="ar-gap-dd">${statusMarkup(OFF, { tag: 'span', word: ISSUE_GAP_WORD })}</dd>`;
    return hasAny(n.problem)
      ? `<dd>${esc(paragraphs(n.problem).join('\n'))}</dd>`
      : `<dd class="is-empty">${n.source === null ? esc(ACTION_WORD.nothing) : 'No issue reported'}</dd>`;
  };
  // The board's action first, then the open assigned actions under it; with
  // neither, the board's words ("Needs an action" in red, or the quiet word).
  const action = (text, assigned, st) => {
    const board = hasAny(text) ? `<dd>${esc(paragraphs(text).join('\n'))}</dd>` : '';
    if (!board && !assigned.length) {
      if (st?.state === 'needs') return `<dd class="ar-needs-dd">${statusMarkup(OFF, { tag: 'span', word: ACTION_WORD.needs })}</dd>`;
      return `<dd class="is-empty">${esc(st?.word || ACTION_WORD.notYet)}</dd>`;
    }
    const list = assigned.length ? `
          <dd class="ar-assigned"><ul class="ar-alist" aria-label="Assigned actions for ${name}">${assigned.map((a) => {
            const owner = a.owner ? esc(a.owner) : 'No owner named';
            // Closed on this day or later: it was the KPI's action that day, and it's done.
            if (a.status === 'closed') {
              return `<li class="is-done"><p class="ar-alist-text">${doneMark()}${esc(a.text)}</p><p class="ar-alist-meta">${owner}${closedText(a, month)}</p></li>`;
            }
            const due = a.due ? `Due ${esc(nb(dayText(a.due, month)))}` : 'No due date';
            const over = isOverdue(a, boardIso) ? `<span class="ar-over">${glyph('g-off')}Overdue</span><span class="ar-dotsep"> · </span>` : '';
            return `<li><p class="ar-alist-text">${esc(a.text)}</p><p class="ar-alist-meta">${owner}<span class="ar-dotsep"> · </span>${over}<span class="ar-due">${due}</span></p></li>`;
          }).join('')}</ul></dd>` : '';
    return board + list;
  };
  // An issue's status shows only when one was set.
  const status = (n) => (hasReal(n.problem) && n.status
    ? `<p class="problem-status"><span class="problem-status-label">Issue status:</span>${issueStatusMarkup(n.status)}</p>`
    : '');
  const blocks = measures.map(({ label, n, assigned, st, gap }) => `
      <div class="ar-measure">
        ${named && label ? `<p class="ar-measure-name">${esc(label)}</p>` : ''}
        <dl class="ar-notes">
          <div><dt>Issue</dt>${issue(n, gap)}</div>
          <div><dt>Action, next 24 hours</dt>${action(n.action, assigned, st)}</div>
        </dl>
        ${status(n)}
      </div>`).join('');
  return `
    <li class="ar-bcard">
      <div class="ar-bcard-head">
        <h4 class="ar-fn">${name}</h4>
        <p class="ar-owner">${esc(ownerFor(fn).name ?? '')}</p>
      </div>
      ${blocks}
      <div class="ar-bcard-tools">
        <button class="btn btn--secondary" type="button" data-ar-update="${id}" data-fk="upd-${id}">Update in Enter numbers<span class="sr-only">: ${name}</span></button>
        <button class="btn btn--quiet" type="button" data-ar-add-for="${id}" data-fk="addfor-${id}">Add action<span class="sr-only"> for ${name}</span></button>
      </div>
    </li>`;
}

function renderList(all, month, day) {
  const host = dlg.querySelector('[data-ar-list]');
  const boardIso = isoForDay(month, day);
  const visible = visibleActions(all, month);
  const head = `
    <div class="ar-section-head">
      <h3 class="section-title" id="ar-list-title" tabindex="-1">Assigned actions</h3>
    </div>`;

  if (!all.length) {
    // The toolbar's Add action is the one way in (no second button here).
    host.innerHTML = `${head}
      <p class="ar-empty">No assigned actions yet. Use Add action above, or add them during Run meeting.</p>`;
    return;
  }

  if (!visible.length) {
    const inFn = view.fn === 'all' ? all : all.filter((a) => a.fnId === view.fn);
    const name = esc(fnName(month, view.fn));
    let body;
    if (!inFn.length) {
      body = `<p class="ar-empty">No assigned actions for ${name} yet. Add action above starts one for ${name}.</p>
        <p class="ar-empty-tools">
          <button class="btn btn--secondary" type="button" data-ar-reset="fn" data-fk="empty-allfn">Show all functions</button>
        </p>`;
    } else {
      const closed = inFn.filter((a) => a.status === 'closed').length;
      body = `<p class="ar-empty">Nothing open${view.fn === 'all' ? '' : ` for ${name}`}. ${closed} done ${closed === 1 ? 'action is' : 'actions are'} hidden.</p>
        <p class="ar-empty-tools"><button class="btn btn--secondary" type="button" data-ar-reset="show" data-fk="empty-showall">Show all</button></p>`;
    }
    host.innerHTML = head + body;
    return;
  }

  // Counts by status (for the function picked, if one is), so a status change shows here at once.
  const base = view.fn === 'all' ? all : all.filter((a) => a.fnId === view.fn);
  const count = (s) => base.filter((a) => a.status === s).length;
  // Only the counts there are, as in the head ("1 done", never "0 open").
  const parts = [];
  if (count('open')) parts.push(`${count('open')} open`);
  if (count('in-progress')) parts.push(`${count('in-progress')} in progress`);
  if (count('closed')) parts.push(`${count('closed')} done`);
  if (view.fn !== 'all') parts.unshift(esc(fnName(month, view.fn)));
  if (visible.length !== base.length) parts.push(`showing ${visible.length}`);
  parts.push('newest first');
  host.innerHTML = `${head}
    <p class="section-sub ar-list-sub" data-ar-list-count>${parts.map((t) => `<span class="ar-part">${t}</span>`).join('<span class="ar-dotsep"> · </span>')}</p>
    <ul class="ar-list">${visible.map((a, i) => itemMarkup(a, i, month, boardIso)).join('')}</ul>`;
}

function itemMarkup(a, i, month, boardIso) {
  const k = esc(a.id);
  if (a.id === editingId && editDraft) {
    return `
      <li class="ar-item is-editing" data-ar-item="${k}">
        <form class="ar-form ar-form--edit" data-ar-edit-form="${k}" novalidate aria-labelledby="ar-edit-title">
          <h4 class="ar-form-title" id="ar-edit-title">Edit action</h4>
          ${fieldsMarkup('ar-e', editDraft, month)}
          <div class="ar-form-actions">
            <button class="btn btn--primary" type="submit" data-fk="ar-e-save">Save changes</button>
            <button class="btn btn--secondary" type="button" data-ar-edit-cancel data-fk="ar-e-cancel">Cancel</button>
          </div>
        </form>
      </li>`;
  }
  const over = isOverdue(a, boardIso);
  const dueText = a.due ? `Due ${esc(nb(dayText(a.due, month)))}` : '';
  // A done action says the board day it was done ("Done Fri, Feb 27"), instead of when it was due.
  let due;
  if (a.status === 'closed' && a.closedDayIso) due = `<span class="ar-due">Done ${esc(nb(dayText(a.closedDayIso, month)))}</span>`;
  else if (!a.due) due = '<span class="ar-due is-none">No due date</span>';
  else if (over) due = `<span class="ar-over">${glyph('g-off')}Overdue</span><span class="ar-dotsep"> · </span><span class="ar-due">${dueText}</span>`;
  else due = `<span class="ar-due">${dueText}</span>`;
  const when = a.dayIso ? esc(nb(dayText(a.dayIso, month))) : '';
  const source = a.source === 'meeting'
    ? `<button class="btn btn--text ar-src" type="button" data-ar-source="${k}" data-fk="src-${k}">${when ? `From the ${when} meeting` : 'From a meeting'}</button>`
    : `<span class="ar-src-text">${when ? `Added ${when}` : 'Added here'}</span>`;
  const options = STATUSES.map((s) => `<option value="${s}"${s === a.status ? ' selected' : ''}>${STATUS_WORD[s]}</option>`).join('');
  return `
    <li class="ar-item${over ? ' is-overdue' : ''}${a.status === 'closed' ? ' is-closed' : ''}" data-ar-item="${k}" data-fk="row-${k}" tabindex="-1">
      <div class="ar-item-main">
        <p class="ar-text" id="ar-t-${i}">${esc(a.text)}</p>
        <p class="ar-meta"><span class="ar-meta-fn">${esc(fnName(month, a.fnId))}</span>${a.kpiId ? `<span class="ar-dotsep"> · </span><span class="ar-meta-kpi">${esc(kpiName(month, a.fnId, a.kpiId))}</span>` : ''}<span class="ar-dotsep"> · </span><span>${a.owner ? esc(a.owner) : 'No owner named'}</span></p>
        <p class="ar-meta ar-meta--when">${due}<span class="ar-dotsep"> · </span>${source}</p>
      </div>
      <div class="ar-item-side">
        <div class="ar-status">
          <label class="ar-label" for="ar-st-${i}">Status</label>
          <span class="ar-pick ar-pick--status" data-status="${a.status}">
            <span class="ar-dot" aria-hidden="true"></span>
            <select id="ar-st-${i}" data-ar-status="${k}" data-fk="st-${k}" aria-describedby="ar-t-${i}">${options}</select>
          </span>
        </div>
        <div class="ar-item-tools">
          <button class="btn btn--quiet" type="button" data-ar-edit="${k}" data-fk="edit-${k}" aria-describedby="ar-t-${i}">Edit</button>
          <button class="btn btn--quiet" type="button" data-ar-delete="${k}" data-fk="del-${k}" aria-describedby="ar-t-${i}">Delete</button>
        </div>
      </div>
    </li>`;
}

function renderStorageNote() {
  dlg.querySelector('[data-ar-storage]').textContent = storageOk
    ? 'Saved on this device.'
    : "This browser isn't saving. Actions clear when the page reloads.";
}

/* ---------- Focus and highlight ---------- */

function focusKey(key) {
  dlg.querySelector(sel('data-fk', key))?.focus({ preventScroll: false });
}

function focusRow(id, { flash: doFlash = false, scroll = false } = {}) {
  const row = dlg.querySelector(sel('data-ar-item', id));
  if (!row) return;
  if (scroll) row.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
  row.focus({ preventScroll: scroll });
  if (doFlash) flash(row);
}

/** A color-only mint wash on a row that was just saved (safe under reduced motion). */
function flash(row) {
  if (!row?.animate) return;
  const from = getComputedStyle(dlg).getPropertyValue('--saved-wash').trim() || '#dff3ed';
  const to = getComputedStyle(row).backgroundColor;
  row.animate([{ backgroundColor: from }, { backgroundColor: to }], { duration: 1600, easing: 'ease-out' });
}

/* ---------- Shell ---------- */

function shellMarkup() {
  return `
    <div class="ar-panel">
      <header class="sheet-head ar-head">
        <div class="ar-head-text">
          <h2 class="sheet-title" id="ar-title" tabindex="-1">Action register</h2>
          <p class="ar-count" data-ar-count></p>
        </div>
        <button class="icon-btn sheet-close" type="button" data-ar-close aria-label="Close Action register">
          ${glyph('g-close', 'icon')}
        </button>
      </header>
      <div class="ar-body" data-ar-body>
        <section class="ar-section ar-section--needs" data-ar-needs aria-labelledby="ar-needs-title" hidden></section>
        <div class="ar-toolbar">
          <button class="btn btn--secondary ar-add-btn" type="button" data-ar-add aria-expanded="false" aria-controls="ar-add">${PLUS}Add action</button>
          <div class="ar-filters">
            <fieldset class="ar-filter">
              <legend class="ar-label">Show</legend>
              <div class="segmented ar-seg">
                <label><input type="radio" name="ar-show" value="open" data-ar-show aria-label="Open and in progress"><span>Open</span></label>
                <label><input type="radio" name="ar-show" value="all" data-ar-show><span>All</span></label>
              </div>
            </fieldset>
            <div class="ar-filter ar-filter--fn">
              <label class="ar-label" for="ar-fn"><span class="sr-only">Filter by function</span><span aria-hidden="true">Function</span></label>
              <span class="ar-pick"><select id="ar-fn" data-ar-fn-filter></select></span>
            </div>
          </div>
        </div>
        <form class="ar-form ar-form--add" id="ar-add" data-ar-add-form hidden novalidate aria-labelledby="ar-add-title"></form>
        <section class="ar-section" data-ar-list aria-labelledby="ar-list-title"></section>
        <section class="ar-section ar-section--board" data-ar-board aria-labelledby="ar-board-title"></section>
        <datalist id="ar-owners" data-ar-owners></datalist>
      </div>
      <footer class="ar-foot">
        <button class="btn btn--secondary" type="button" data-ar-minutes>Meeting minutes</button>
        <p class="ar-foot-note" data-ar-storage></p>
      </footer>
    </div>`;
}
