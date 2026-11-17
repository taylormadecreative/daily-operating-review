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
// States (spec §12, js/action-state.js): Open → In progress → Completed → Verified, with
// Reject (back to In progress, with a reason), Cancel (with a reason; it never resolves the
// issue), Reopen (with a reason) and a separate Escalated flag. Every step lands in the
// action's history. Records saved before verification existed ('closed') read as Verified
// with the history note "Closed before verification existed", and are saved back that way.
// Repeat losses: adding an action for a KPI that already has an open one offers to link the
// day to it (its affectedDays) instead of starting another.
//
// ctx = { getMonth, getDay, toast, openMinutes, enterFor?, onChange? }
// ctx.onChange() runs after every add, edit, status change, delete and undo,
// so the board redraws its Action cells.

import { notesFor, ownerFor, isoForDay, functionById, kpiRowsFor, NO_ISSUE, getOrg, accountableFor, readWeekly } from './store.js?v=20261117-065120';
import {
  ACTION_STATES, ACTION_STATE_WORD, MIGRATED_NOTE, MIGRATED_OPEN_NOTE, isOpenAction, isClosedAction, isVerifiedAction, isCancelledAction,
  isEscalatedAction, isOverdueAction, countsOnDay, coversDay, actionDays, agingWords, verifierOptions, actionStateMarkup,
} from './action-state.js?v=20261117-065120';
import { getIdentity } from './identity.js?v=20261117-065120';
import { isProductionDay, OFF } from './status.js?v=20261117-065120';
import { formatDayMedium, plainLabel, formatPair, monthSoFar } from './format.js?v=20261117-065120';
import { esc, issueStatusMarkup, statusMarkup } from './ui.js?v=20261117-065120';
// The board's action words and states (one wording on every screen). Used only
// inside functions: board.js imports this module too.
import { actionStateFor, needsSummary, needsLabel, ACTION_WORD, issueGap, ISSUE_GAP_WORD, NO_FUNCTIONS } from './board.js?v=20261117-065120';

const KEY = 'demo.actions.v1';
const STATUS_WORD = ACTION_STATE_WORD;

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

/** A stored status in the current set. The old 'closed' (shown as "Done") reads as Verified. */
function normStatus(s) {
  const k = String(s ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (k === 'closed' || k === 'done') return 'verified';
  return ACTION_STATES.includes(k) ? k : null;
}
const isLegacyClosed = (s) => ['closed', 'done'].includes(String(s ?? '').trim().toLowerCase());

/** Who a step is by when nobody is chosen on this device, and for older steps saved without a name. */
export const BY_DEVICE = 'Someone on this device';
const BY_UNKNOWN = 'Not recorded (an older entry)';
const BY_APP = 'The board (automatic)';
const HISTORY_KINDS = ['created', 'started', 'completed', 'verified', 'rejected', 'cancelled', 'reopened', 'escalated', 'deescalated', 'linked', 'edited', 'migrated'];
const txt = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
const isoTimeOrNull = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

/** One history entry, checked (a damaged one is dropped). */
function cleanStep(h) {
  if (!h || typeof h !== 'object' || !HISTORY_KINDS.includes(h.kind)) return null;
  // Every step says who: an older step saved without a name says so instead of nothing.
  const out = { kind: h.kind, at: isoTimeOrNull(h.at), dayIso: isoOrNull(h.dayIso), by: txt(h.by, 80).trim() || BY_UNKNOWN };
  for (const k of ['from', 'to']) if (typeof h[k] === 'string' && h[k]) out[k] = h[k].slice(0, 20);
  for (const k of ['reason', 'note', 'verifier', 'evidence', 'escalatedTo']) if (typeof h[k] === 'string' && h[k].trim()) out[k] = txt(h[k]);
  return out;
}

/** One stored action, checked. Unknown extra fields are kept as they are. */
function clean(a) {
  if (!a || typeof a !== 'object' || typeof a.text !== 'string' || !a.text.trim()) return null;
  if (typeof a.id !== 'string' && typeof a.id !== 'number') return null;
  const status = normStatus(a.status) ?? 'open';
  const history = (Array.isArray(a.history) ? a.history : []).map(cleanStep).filter(Boolean);
  // Saved before verification existed: "Done" becomes Verified, and the history says so (once).
  if (isLegacyClosed(a.status) && !history.some((h) => h.kind === 'migrated')) {
    history.push({ kind: 'migrated', from: 'closed', to: 'verified', note: MIGRATED_NOTE, by: BY_APP, at: isoTimeOrNull(a.updatedAt) ?? isoTimeOrNull(a.createdAt), dayIso: isoOrNull(a.closedDayIso) });
  }
  // Saved before action states existed (no history at all): an Open or In progress action says it was carried over.
  if (!history.length) {
    history.push({ kind: 'migrated', from: status, to: status, note: MIGRATED_OPEN_NOTE, by: BY_APP, at: isoTimeOrNull(a.updatedAt) ?? isoTimeOrNull(a.createdAt), dayIso: isoOrNull(a.dayIso) });
  }
  const closed = status === 'verified' || status === 'cancelled';
  const esc8 = a.escalation && typeof a.escalation === 'object' && typeof a.escalation.reason === 'string' && a.escalation.reason.trim()
    ? { to: txt(a.escalation.to, 80), reason: txt(a.escalation.reason), by: txt(a.escalation.by, 80), at: isoTimeOrNull(a.escalation.at), dayIso: isoOrNull(a.escalation.dayIso) }
    : null;
  const ver = status === 'verified' && a.verification && typeof a.verification === 'object'
    ? { verifier: txt(a.verification.verifier, 80), evidence: txt(a.verification.evidence), at: isoTimeOrNull(a.verification.at), dayIso: isoOrNull(a.verification.dayIso) }
    : null;
  return {
    ...a,
    id: String(a.id),
    fnId: typeof a.fnId === 'string' && a.fnId ? a.fnId : null,
    owner: typeof a.owner === 'string' ? a.owner : '',
    // The owner as a person in the Organization (renaming them never changes who owns it); null: someone outside it.
    ownerPersonId: typeof a.ownerPersonId === 'string' && a.ownerPersonId ? a.ownerPersonId : null,
    due: isoOrNull(a.due),
    status,
    createdAt: typeof a.createdAt === 'string' ? a.createdAt : '',
    source: a.source === 'meeting' ? 'meeting' : 'manual',
    meetingId: a.meetingId ?? null,
    // The board day it was added for (null on older records: it counts from the start).
    dayIso: isoOrNull(a.dayIso),
    // The board day it was closed on (verified or cancelled); only a closed action has one.
    closedDayIso: closed ? isoOrNull(a.closedDayIso) : null,
    // The board day the work was marked completed (kept once verified).
    completedDayIso: status === 'completed' || status === 'verified' ? isoOrNull(a.completedDayIso) : null,
    // A KPI added in Board setup ("function--kpi" rows): its kpiId. null = the function's workbook KPI.
    kpiId: typeof a.kpiId === 'string' && a.kpiId ? a.kpiId : null,
    // Repeat losses linked to this action (spec §4: reuse an open issue), besides the day it was added for.
    affectedDays: [...new Set((Array.isArray(a.affectedDays) ? a.affectedDays : []).map(isoOrNull).filter(Boolean))].sort(),
    escalation: esc8,
    verification: ver,
    cancelReason: status === 'cancelled' ? txt(a.cancelReason) : '',
    history,
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
      // Older records are saved back once, so every reader agrees: 'closed' as Verified with its note, an
      // action from before the states with its "Migrated" step, and each owner as a person (by name, once).
      const people = orgPeople();
      let moved = Array.isArray(parsed) && parsed.some((a) => isLegacyClosed(a?.status) || (a && (!Array.isArray(a.history) || !a.history.length)));
      // An owner not tied to a person yet (an older record, or read before the Organization was ready) is
      // matched by name once; from then on the id decides, so renaming someone never changes who owns it.
      if (people) {
        for (const a of mem) {
          if (a.ownerPersonId) continue;
          const id = personIdFor(people, a.owner);
          if (id) { a.ownerPersonId = id; moved = true; }
        }
      }
      if (moved) writeAll(mem);
    }
  }
  const people = orgPeople();
  return mem.map((a) => {
    // The owner's name as the Organization has it now (a person renamed in Board setup).
    const now = a.ownerPersonId && people ? people.find((p) => p.id === a.ownerPersonId)?.name?.trim() : '';
    return { ...a, owner: now || a.owner, affectedDays: [...a.affectedDays], history: [...a.history] };
  });
}

/** The Organization's people, read again only when it changed (null before the app is ready). */
let peopleCache = { key: null, people: null };
function orgPeople() {
  if (!ctx) return null;
  let raw = null;
  try { raw = localStorage.getItem('demo.org.v1'); } catch { raw = null; }
  let month = null;
  try { month = ctx.getMonth(); } catch { return null; }
  if (!month) return null;
  const key = `${raw}|${month.functions.map((f) => `${f.id}:${f.owner}`).join(',')}`;
  if (peopleCache.key === key) return peopleCache.people;
  let people = null;
  try { people = getOrg(month).active.people ?? []; } catch { people = null; }
  peopleCache = { key, people };
  return people;
}

/** The person a name belongs to in the Organization (same words, any case), else null. */
function personIdFor(people, name) {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n || !people) return null;
  return people.find((p) => String(p.name ?? '').trim().toLowerCase() === n)?.id ?? null;
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

/** "Verified:" in the on-track color with its glyph, before a verified action's words. */
const doneMark = () => `<span class="ar-done">${glyph('g-on')}Verified:</span> `;
/** " · Verified Fri, Feb 27" after a verified action's owner (nothing when the day isn't known). */
const closedText = (a, month) => (a.closedDayIso
  ? `<span class="ar-dotsep"> · </span><span class="ar-due">Verified ${esc(nb(dayText(a.closedDayIso, month)))}</span>`
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

/** The function's responsible owner as a person in the Organization (null: nobody, or no Organization yet). */
const ownerIdFor = (month, fnId) => {
  let id = null;
  try { id = getOrg(month).active.functions?.[fnId]?.responsible ?? null; } catch { id = null; }
  const people = orgPeople();
  if (id && people?.some((p) => p.id === id)) return id;
  return personIdFor(people, ownerName(month, fnId));
};
/** A name typed before owners were picked from the Organization (an older action): kept as it is. */
const NAME_PICK = 'name:';

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
 * From the day it was added for (an older record with no day: from the start) and on any day
 * linked to it, while it is open, or through the day it was verified. A cancelled action never
 * counts (cancelling doesn't resolve the issue). With no day, only open actions count.
 */
const countsOn = (a, dayIso) => countsOnDay(a, dayIso);

/** One KPI row's actions from a list: open ones first (soonest due), then verified ones (latest first), then cancelled. */
function kpiActions(list, fnId, kpiId = null) {
  const mine = list.filter((a) => a.fnId === fnId && (a.kpiId ?? null) === (kpiId ?? null));
  const open = mine.filter(isOpenAction)
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || String(a.createdAt).localeCompare(String(b.createdAt)));
  const done = mine.filter(isClosedAction)
    .sort((a, b) => Number(isCancelledAction(a)) - Number(isCancelledAction(b)) || (b.closedDayIso ?? '').localeCompare(a.closedDayIso ?? '') || String(b.createdAt).localeCompare(String(a.createdAt)));
  return [...open, ...done];
}

// "No new issues to report" is the absence of a problem (NO_ISSUE, the board's rule).
const paragraphs = (t) => (t ?? '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
const hasReal = (t) => paragraphs(t).some((p) => !NO_ISSUE.test(p));
const hasAny = (t) => paragraphs(t).length > 0;

const isOverdue = (a, boardIso) => isOverdueAction(a, boardIso);

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
let txOpen = null;      // { id, kind }: the step form open under an action (verify, reject, cancel, reopen, escalate)
let txDraft = null;     // what's typed in it: { reason, verifier, evidence, to }
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

/* What's typed in Add action survives a reload (sessionStorage `dor.arAddDraft.v1`): written as it's typed and
   when the page goes away; the register brings it back, open, the next time it opens; Save and Cancel clear it. */
const ADD_DRAFT_KEY = 'demo.arAddDraft.v1';
let addRestored = false; // the form shows "Back where you left off" until it's saved or cancelled
let addDraftTimer = 0;
function keepAddDraft() {
  clearTimeout(addDraftTimer);
  try {
    if (draftHasText()) sessionStorage.setItem(ADD_DRAFT_KEY, JSON.stringify({ draft: addDraft, at: Date.now() }));
    else sessionStorage.removeItem(ADD_DRAFT_KEY);
  } catch { /* storage off: this visit only */ }
}
const keepAddDraftSoon = () => { clearTimeout(addDraftTimer); addDraftTimer = setTimeout(keepAddDraft, 250); };
/** After a reload: the typed action comes back (for a function that's still on the board). */
function restoreAddDraft(month) {
  if (addDraft) return;
  let kept = null;
  try { kept = JSON.parse(sessionStorage.getItem(ADD_DRAFT_KEY) ?? 'null'); } catch { kept = null; }
  const d = kept?.draft;
  if (!d || typeof d.text !== 'string' || !d.text.trim()) return;
  const fresh = freshDraft(month, d.fnId, d.kpiId ?? null);
  addDraft = { ...fresh, text: d.text, due: typeof d.due === 'string' ? d.due : fresh.due,
    ...(d.ownerEdited && typeof d.owner === 'string' ? { owner: d.owner, ownerPersonId: d.ownerPersonId ?? null, ownerEdited: true } : {}) };
  addOpen = true;
  addRestored = true;
}

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
  // The page going away (a reload, a phone locked): what's typed in Add action is kept now.
  window.addEventListener('pagehide', keepAddDraft);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') keepAddDraft(); });
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
  restoreAddDraft(month);
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
  if (!view.boardTouched) view.boardOpen = !readAll().some(isOpenAction);
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
 * day or later (Verified: show them as "Verified: …"). Cancelled ones never count.
 * kpiId null = the function's workbook KPI; a string = a KPI added in Board setup.
 * dayIso 'YYYY-MM-DD' = the board day; without it, every open action (the old rule).
 * The board, Detail, the meeting slides and the dashboard show these as the row's action.
 */
export function actionsFor(fnId, kpiId = null, dayIso = null) {
  const day = isoOrNull(dayIso);
  return kpiActions(readAll().filter((a) => countsOn(a, day)), fnId, kpiId);
}

/**
 * The same, for a stretch of board days (the Weekly review's week, through the day it looks from):
 * the actions that count on any one of them, in the register's order.
 */
export function actionsForDays(fnId, kpiId = null, dayIsos = []) {
  const days = dayIsos.map(isoOrNull).filter(Boolean);
  if (!days.length) return [];
  return kpiActions(readAll().filter((a) => days.some((d) => countsOn(a, d))), fnId, kpiId);
}

/**
 * A KPI's verified actions whose verification day falls in [fromIso, toIso): the response rule
 * (board.js responseFor) asks whether each fix held after it was verified. Newest first.
 */
export function verifiedBetween(fnId, kpiId = null, fromIso, toIso) {
  return kpiActions(readAll().filter((a) => isVerifiedAction(a) && typeof a.closedDayIso === 'string'
    && a.closedDayIso >= fromIso && a.closedDayIso < toIso), fnId, kpiId);
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

/** Who is acting, for the history ("" when nobody is chosen on this device). */
function actorName() {
  let name = '';
  try { name = getIdentity(ctx.getMonth())?.name ?? ''; } catch { name = ''; }
  return String(name).trim() || BY_DEVICE;
}
/** One step in an action's history. */
const step = (kind, extra = {}) => ({ kind, at: new Date().toISOString(), by: actorName(), ...extra });

function insert(input) {
  const month = ctx.getMonth();
  const fnId = typeof input.fnId === 'string' && input.fnId ? input.fnId : null;
  const owner = typeof input.owner === 'string' && input.owner.trim() ? input.owner.trim() : ownerName(month, fnId);
  const people = orgPeople();
  const ownerPersonId = (typeof input.ownerPersonId === 'string' && people?.some((p) => p.id === input.ownerPersonId) ? input.ownerPersonId : null)
    ?? personIdFor(people, owner);
  const raw = normStatus(input.status);
  // Added here or in a meeting: always open (verification is a step of its own).
  const status = raw && raw !== 'verified' && raw !== 'cancelled' ? raw : 'open';
  const dayIso = isoOrNull(input.dayIso) ?? isoForDay(month, ctx.getDay());
  const action = {
    id: newId(),
    fnId,
    // A KPI added in Board setup; null = the function's workbook KPI.
    kpiId: fnId && typeof input.kpiId === 'string' && input.kpiId ? (validKpi(month, fnId, input.kpiId) ?? input.kpiId) : null,
    text: input.text,
    owner,
    ownerPersonId,
    due: isoOrNull(input.due),
    status,
    createdAt: new Date().toISOString(),
    source: input.source === 'meeting' ? 'meeting' : 'manual',
    meetingId: input.meetingId ?? null,
    dayIso,
    closedDayIso: null,
    completedDayIso: null,
    affectedDays: [],
    escalation: null,
    verification: null,
    cancelReason: '',
    history: [step('created', { to: status, dayIso, note: typeof input.note === 'string' && input.note ? input.note : input.source === 'meeting' ? (input.weekly ? 'Assigned in the weekly review' : 'Added in the meeting') : '' })],
  };
  const list = readAll();
  list.push(action);
  writeAll(list);
  return { ...action };
}

/**
 * The steps an action can take (spec §12). `needs` are the form's required fields.
 * Start and Mark completed apply at once (with Undo); the rest open a short form first.
 */
export const TRANSITIONS = {
  start: { from: ['open'], to: 'in-progress', label: 'Start work', done: 'Started. It\'s in progress.' },
  complete: { from: ['open', 'in-progress'], to: 'completed', label: 'Mark completed', done: 'Marked completed. It waits for a verifier.' },
  verify: { from: ['completed'], to: 'verified', label: 'Verify', needs: ['verifier', 'evidence'], done: 'Verified and closed.' },
  reject: { from: ['completed'], to: 'in-progress', label: 'Reject', needs: ['reason'], done: 'Rejected. It\'s back in progress.' },
  cancel: { from: ['open', 'in-progress', 'completed'], to: 'cancelled', label: 'Cancel action', needs: ['reason'], done: 'Cancelled. The issue isn\'t resolved by this.' },
  reopen: { from: ['verified', 'cancelled'], to: 'open', label: 'Reopen', needs: ['reason'], done: 'Reopened. Its history is kept.' },
};
const HISTORY_KIND = { start: 'started', complete: 'completed', verify: 'verified', reject: 'rejected', cancel: 'cancelled', reopen: 'reopened' };

/** The board day a step is recorded on: the day looked at, never before the action's own day. */
function stepDay(month, a) {
  const viewed = isoForDay(month, ctx.getDay());
  return a.dayIso && a.dayIso > viewed ? a.dayIso : viewed;
}

/**
 * Move an action to its next state. data: { reason, verifier, evidence } as the step needs.
 * Verify needs a verifier with the Verifier role who isn't the owner (unless the organization
 * allows self-verification). -> { ok, error?, action?, prev? }
 */
export function transitionAction(id, kind, data = {}) {
  if (!ctx) return { ok: false, error: 'The Action register isn\'t ready.' };
  const t = TRANSITIONS[kind];
  const list = readAll();
  const a = list.find((x) => x.id === id);
  if (!t || !a) return { ok: false, error: 'That action isn\'t in the register anymore.' };
  if (!t.from.includes(a.status)) return { ok: false, error: `A ${STATUS_WORD[a.status].toLowerCase()} action can't be ${kind === 'verify' ? 'verified' : 'changed that way'}.` };
  const month = ctx.getMonth();
  const reason = String(data.reason ?? '').trim();
  if ((t.needs ?? []).includes('reason') && !reason) return { ok: false, error: 'Say why.', field: 'reason' };
  let verifier = '';
  if (kind === 'verify') {
    const evidence = String(data.evidence ?? '').trim();
    const opts = verifierOptions(getOrg(month).active, a);
    const pick = opts.options.find((o) => o.id === data.verifier || o.name === data.verifier);
    if (!pick) return { ok: false, error: 'Choose who verifies it.', field: 'verifier' };
    if (!pick.allowed) return { ok: false, error: `${pick.name} owns this action, and self-verification is off. Someone else with the Verifier role verifies it.`, field: 'verifier' };
    if (!evidence) return { ok: false, error: 'Say what shows it worked.', field: 'evidence' };
    verifier = pick.name;
    data = { ...data, evidence };
  }
  const prev = structuredClone(a);
  const day = stepDay(month, a);
  a.status = t.to;
  if (kind === 'complete') a.completedDayIso = day;
  if (kind === 'verify') {
    a.closedDayIso = day;
    a.verification = { verifier, evidence: data.evidence, at: new Date().toISOString(), dayIso: day };
  }
  if (kind === 'cancel') { a.closedDayIso = day; a.cancelReason = reason; }
  if (kind === 'reject') a.completedDayIso = null;
  if (kind === 'reopen') { a.closedDayIso = null; a.completedDayIso = null; a.verification = null; a.cancelReason = ''; }
  a.history.push(step(HISTORY_KIND[kind], { from: prev.status, to: t.to, dayIso: day, reason, verifier, evidence: kind === 'verify' ? data.evidence : '' }));
  a.updatedAt = new Date().toISOString();
  writeAll(list);
  return { ok: true, action: { ...a }, prev };
}

/** Put an action back exactly as it was (Undo of a step just taken: not a reopen, so no history line). */
function putBack(prev) {
  const list = readAll();
  const i = list.findIndex((x) => x.id === prev.id);
  if (i < 0) return false;
  list[i] = clean(prev);
  writeAll(list);
  return true;
}

/**
 * Escalate an open action (a flag of its own: the action keeps its state). to: who it goes to
 * (default the function's accountable leader), reason: why. -> { ok, error?, action? }
 */
export function escalateAction(id, { to = '', reason = '' } = {}) {
  if (!ctx) return { ok: false, error: 'The Action register isn\'t ready.' };
  const list = readAll();
  const a = list.find((x) => x.id === id);
  if (!a || !isOpenAction(a)) return { ok: false, error: 'Only an open action can be escalated.' };
  const why = String(reason).trim();
  if (!why) return { ok: false, error: 'Say why it needs escalating.', field: 'reason' };
  const month = ctx.getMonth();
  const who = String(to).trim() || accountableFor(getOrg(month).active, a.fnId).name || 'the accountable leader';
  const day = stepDay(month, a);
  a.escalation = { to: who, reason: why, by: actorName(), at: new Date().toISOString(), dayIso: day };
  a.history.push(step('escalated', { dayIso: day, reason: why, escalatedTo: who }));
  a.updatedAt = new Date().toISOString();
  writeAll(list);
  return { ok: true, action: { ...a } };
}

/** Take the escalation off (its history keeps it). */
export function deescalateAction(id) {
  const list = readAll();
  const a = list.find((x) => x.id === id);
  if (!a?.escalation) return { ok: false };
  const prev = structuredClone(a);
  a.escalation = null;
  a.history.push(step('deescalated', { dayIso: stepDay(ctx.getMonth(), a) }));
  a.updatedAt = new Date().toISOString();
  writeAll(list);
  return { ok: true, action: { ...a }, prev };
}

/**
 * Repeat losses (spec §4): link another day to an open action for the same KPI instead of starting
 * a new one. The action then answers for that day too. -> { ok, action? }
 */
export function linkActionDay(id, dayIso) {
  const iso = isoOrNull(dayIso);
  const list = readAll();
  const a = list.find((x) => x.id === id);
  if (!a || !iso || !isOpenAction(a)) return { ok: false };
  if (!coversDay(a, iso)) {
    a.affectedDays = [...new Set([...a.affectedDays, iso])].sort();
    a.history.push(step('linked', { dayIso: iso, note: 'Repeat loss linked to this open action' }));
    a.updatedAt = new Date().toISOString();
    writeAll(list);
  }
  return { ok: true, action: { ...a } };
}

/**
 * The open actions a new one for this function and KPI could link to instead (repeat losses):
 * open (not Verified or Cancelled), same KPI, and not already answering for that day.
 */
export function linkCandidates(fnId, kpiId, dayIso) {
  return readAll().filter((a) => a.fnId === fnId && (a.kpiId ?? null) === (kpiId ?? null) && isOpenAction(a) && !coversDay(a, dayIso))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

/** A simple step from the register (Start work, Mark completed): at once, with Undo. */
function quickStep(id, kind) {
  const r = transitionAction(id, kind);
  if (!r.ok) { ctx.toast(r.error); return; }
  view.pinned.add(id);
  render();
  changed();
  focusAfterStep(id);
  ctx.toast(TRANSITIONS[kind].done, {
    actionLabel: 'Undo',
    onAction: () => undoStep(r.prev, `${STATUS_WORD[r.prev.status]} again.`),
    near: () => [dlg.querySelector(sel('data-ar-item', id))].filter(Boolean),
  });
}

/** Undo a step: the action as it was, focus back on it. */
function undoStep(prev, words) {
  if (!putBack(prev)) return;
  view.pinned.add(prev.id);
  changed();
  if (dlg.open) {
    render();
    focusKey(`st-${prev.id}`);
  }
  ctx.toast(`Undone. ${words}`);
}

/**
 * The records that cite an action (spec §12, §13: a governed record keeps its action IDs): weekly reviews
 * (their actions, escalations and frozen snapshots) and the daily meetings' minutes. -> ['Weekly review, …']
 */
export function citedBy(id) {
  const out = [];
  try {
    for (const r of readWeekly().records ?? []) {
      const ids = new Set([...(r.actionIds ?? []), ...(r.escalations ?? []).map((e) => e.actionId), ...(r.actionSnapshots ?? []).map((x) => x.id)]);
      if (ids.has(id)) out.push(`the weekly review of ${r.weekStart}`);
    }
  } catch { /* no weekly records here */ }
  try {
    const minutes = JSON.parse(localStorage.getItem('demo.meetings.v1') ?? '[]');
    for (const r of Array.isArray(minutes) ? minutes : []) {
      const ids = new Set([...(r?.actionIds ?? []), ...(r?.actions ?? []).map((a) => a?.id)].filter(Boolean).map(String));
      if (ids.has(String(id))) out.push(`the minutes of ${r.dayIso ?? 'a meeting'}`);
    }
  } catch { /* no minutes here */ }
  return out;
}

/**
 * Delete is for a mistake caught at once: an Open action with no steps after it was added, that no
 * record cites. Anything else is cancelled with a reason, so the history stays (spec §12, §14).
 */
export function canDeleteAction(a) {
  if (!a || a.status !== 'open' || a.escalation || a.affectedDays?.length) return false;
  const quiet = (a.history ?? []).every((h) => h.kind === 'created' || (h.kind === 'migrated' && h.from === h.to));
  return quiet && !citedBy(a.id).length;
}

function remove(id) {
  const list = readAll();
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) return;
  if (!canDeleteAction(list[idx])) {
    ctx.toast("This action has a history or a record cites it, so it can't be deleted. Cancel it with a reason instead.");
    return;
  }
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
  txOpen = null;
  txDraft = null;
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
    else if (form.matches('[data-ar-tx-form]')) closeTx();
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
  else if (b.matches('[data-ar-step]')) quickStep(b.dataset.arId, b.dataset.arStep);
  else if (b.matches('[data-ar-tx]')) openTx(b.dataset.arId, b.dataset.arTx);
  else if (b.matches('[data-ar-tx-cancel]')) closeTx();
  else if (b.matches('[data-ar-deescalate]')) deescalate(b.dataset.arDeescalate);
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
  // A change to the typed Add action (its function, KPI, owner, due, link) is kept for a reload too.
  if (addDraft && t.closest?.('[data-ar-add-form]')) keepAddDraftSoon();
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
  if (t.name === 'ar-link') {
    if (addDraft) addDraft.link = t.value || null;
    syncLinkMode(t.closest('form'));
    return;
  }
  if (t.closest?.('[data-ar-tx-form]')) {
    if (txDraft && t.name) txDraft[t.name] = t.value;
    return;
  }
  if (t.name === 'kpiId') {
    const form = t.closest('form');
    const draft = draftFor(form);
    if (draft) draft.kpiId = t.value || null;
    if (draft === addDraft) { draft.link = undefined; renderLinkSlot(form, draft); }
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
    if (draft === addDraft) { draft.link = undefined; renderLinkSlot(form, draft); }
    if (t.value) setError(t, '');
    // The owner follows the function until someone types a different name.
    if (!draft.ownerEdited) {
      draft.owner = ownerName(ctx.getMonth(), draft.fnId);
      draft.ownerPersonId = ownerIdFor(ctx.getMonth(), draft.fnId);
      const owner = form.elements.namedItem('ownerPersonId') ?? form.elements.namedItem('owner');
      if (owner?.name === 'ownerPersonId') { if (draft.ownerPersonId) owner.value = draft.ownerPersonId; }
      else if (owner) owner.value = draft.owner;
      if (owner && owner.value) setError(owner, '');
    }
  }
}

function onInput(e) {
  const t = e.target;
  if (t.closest?.('[data-ar-tx-form]')) {
    if (txDraft && t.name) txDraft[t.name] = t.value;
    if (t.getAttribute('aria-invalid') === 'true' && t.value.trim()) setError(t, '');
    return;
  }
  const draft = draftFor(t.closest?.('form'));
  if (!draft) return;
  if (draft === addDraft) keepAddDraftSoon();
  if (t.name === 'text') draft.text = t.value;
  if (t.name === 'owner') {
    draft.owner = t.value;
    // A typed name sticks; an emptied box goes back to following the function.
    const typed = t.value.trim();
    draft.ownerEdited = typed !== '' && typed !== ownerName(ctx.getMonth(), draft.fnId);
  }
  if (t.name === 'ownerPersonId') {
    // A person picked from the Organization: their id decides who owns it (renaming them never changes it).
    const picked = ownerPick(t.value);
    draft.ownerPersonId = picked.id;
    draft.owner = picked.name;
    draft.ownerEdited = t.value !== (ownerIdFor(ctx.getMonth(), draft.fnId) ?? '');
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
  else if (form.matches('[data-ar-tx-form]')) saveTx(form);
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
    ctx.toast("Meeting records couldn't open. Try again from the Menu.");
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
    ownerPersonId: ownerIdFor(month, id),
    ownerEdited: false,
    // The next production day after the board day (Fri, Feb 27 gives Mon, Mar 2).
    due: nextProductionDayIso(month, ctx.getDay()),
    // Repeat losses: the open action to link this day to (undefined: the first one there is, by default).
    link: undefined,
  };
}

function showAdd(fnId, kpiId = null) {
  const month = ctx.getMonth();
  if (!addDraft) addDraft = freshDraft(month, fnId ?? (view.fn !== 'all' ? view.fn : null), kpiId);
  else if (fnId && (fnId !== addDraft.fnId || validKpi(month, fnId, kpiId) !== (addDraft.kpiId ?? null))) {
    // A typed action is kept; it now goes to the function asked for.
    if (fnId !== addDraft.fnId && !addDraft.ownerEdited) { addDraft.owner = ownerName(month, fnId); addDraft.ownerPersonId = ownerIdFor(month, fnId); }
    addDraft.fnId = fnId;
    addDraft.kpiId = validKpi(month, fnId, kpiId);
    addDraft.link = undefined;
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
  addRestored = false;
  keepAddDraft();
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
    ${addRestored ? '<p class="ar-hint ar-restored" data-ar-restored>Back where you left off: the action you typed before the page closed. It isn\'t saved yet.</p>' : ''}
    ${fieldsMarkup('ar-a', addDraft, month)}
    <div class="ar-form-actions">
      <button class="btn btn--primary" type="submit" data-ar-add-save>Save action</button>
      <button class="btn btn--secondary" type="button" data-ar-add-cancel>Cancel</button>
    </div>`;
  renderLinkSlot(form, addDraft);
}

/** The open action this draft links to (null: a new action). */
function draftLink(d) {
  if (!d?.fnId) return null;
  const list = linkCandidates(d.fnId, d.kpiId ?? null, isoForDay(ctx.getMonth(), ctx.getDay()));
  if (!list.length) return null;
  if (d.link === null) return null;                 // "Start a new action instead"
  return list.find((a) => a.id === d.link) ?? list[0]; // the default: link to the open issue
}

/**
 * Repeat losses (spec §4): when the function and KPI already have an open action that doesn't
 * answer for this board day, the form offers to link the day to it, picked by default, with
 * "Start a new action instead" beside it.
 */
function renderLinkSlot(form, d) {
  const slot = form?.querySelector('[data-ar-link-slot]');
  if (!slot) return;
  const month = ctx.getMonth();
  const dayIso = isoForDay(month, ctx.getDay());
  const list = d?.fnId ? linkCandidates(d.fnId, d.kpiId ?? null, dayIso) : [];
  slot.hidden = !list.length;
  if (!list.length) { slot.innerHTML = ''; syncLinkMode(form); return; }
  const picked = draftLink(d);
  const dayName = esc(nb(formatDayMedium(month, ctx.getDay())));
  const opt = (a) => {
    const since = a.dayIso ? `open since ${nb(dayText(a.dayIso, month))}` : 'open';
    const meta = [a.owner || ownerName(month, a.fnId), STATUS_WORD[a.status], since, a.due ? `due ${nb(dayText(a.due, month))}` : ''].filter(Boolean).join(' · ');
    return `<label class="ar-link-opt"><input type="radio" name="ar-link" value="${esc(a.id)}"${picked?.id === a.id ? ' checked' : ''} data-fk="link-${esc(a.id)}">
      <span><span class="ar-link-lead">Link to the open issue:</span> <span class="ar-link-text">${esc(a.text)}</span><span class="ar-link-meta">${esc(meta)}</span></span></label>`;
  };
  slot.innerHTML = `
    <fieldset class="ar-link-set">
      <legend class="ar-label">This KPI already has an open action</legend>
      ${list.map(opt).join('')}
      <label class="ar-link-opt"><input type="radio" name="ar-link" value=""${picked ? '' : ' checked'} data-fk="link-new"><span>Start a new action instead</span></label>
    </fieldset>
    <p class="ar-hint">Linking adds ${dayName} to that action's days, so one action answers for a loss that repeats.</p>`;
  syncLinkMode(form);
}

/** Linking needs no text, owner or due date: those boxes step aside, and Save says what it does. */
function syncLinkMode(form) {
  if (!form) return;
  const linking = Boolean(form.querySelector('input[name="ar-link"]:checked')?.value);
  form.querySelectorAll('[data-ar-new]').forEach((el) => { el.hidden = linking; });
  const save = form.querySelector('[data-ar-add-save]');
  if (save) save.textContent = linking ? `Link ${nb(formatDayMedium(ctx.getMonth(), ctx.getDay()))}` : 'Save action';
}

function saveAdd(form) {
  const link = form.querySelector('input[name="ar-link"]:checked')?.value || null;
  if (link) { saveLink(form, link); return; }
  if (!validate(form)) return;
  const d = readForm(form);
  const before = needsSum(ctx.getMonth(), ctx.getDay());
  const saved = insert({ ...d, status: 'open', source: 'manual', meetingId: null });
  if (saved.fnId) lastAdded = { fn: saved.fnId, kpi: saved.kpiId ?? '' };
  // The payoff: this save took the last off-goal KPI off the needs list.
  const cleared = clearedNeeds(before, needsSum(ctx.getMonth(), ctx.getDay()));
  addOpen = false;
  addDraft = null;
  addRestored = false;
  keepAddDraft();
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

/** Link the board day to an open action (repeat loss) instead of adding a new one. */
function saveLink(form, id) {
  const month = ctx.getMonth();
  const dayIso = isoForDay(month, ctx.getDay());
  const r = linkActionDay(id, dayIso);
  if (!r.ok) { renderLinkSlot(form, addDraft); return; }
  const a = r.action;
  if (a.fnId) lastAdded = { fn: a.fnId, kpi: a.kpiId ?? '' };
  addOpen = false;
  addDraft = null;
  addRestored = false;
  keepAddDraft();
  renderAddForm();
  if (view.fn !== 'all' && view.fn !== a.fnId) view.fn = 'all';
  view.pinned.add(a.id);
  render();
  changed();
  focusRow(a.id, { flash: true, scroll: true });
  const n = actionDays(a).length;
  ctx.toast(`Linked ${nb(formatDayMedium(month, ctx.getDay()))} to the open action. It now answers for ${n} ${n === 1 ? 'day' : 'days'}.${storageOk ? '' : " This browser isn't saving, so it will clear when the page reloads."}`);
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
    ownerPersonId: a.ownerPersonId ?? null,
    ownerEdited: (a.ownerPersonId ?? null) !== ownerIdFor(month, a.fnId),
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
  const month = ctx.getMonth();
  const dueMoved = (a.due ?? null) !== (d.due ?? null)
    ? `due date ${a.due ? `from ${dayText(a.due, month)}` : 'set'}${d.due ? ` to ${dayText(d.due, month)}` : ' removed'}` : '';
  // The picker names a person by id (a name box, before the Organization is ready, matches by name).
  const ownerPersonId = d.ownerPersonId !== undefined ? d.ownerPersonId : a.owner === d.owner ? a.ownerPersonId : personIdFor(orgPeople(), d.owner);
  const ownerMoved = (a.ownerPersonId ?? null) !== (ownerPersonId ?? null) || (!ownerPersonId && a.owner !== d.owner);
  const changedWhat = [a.text !== d.text ? 'text' : '', ownerMoved ? 'owner' : '', dueMoved, a.fnId !== d.fnId || (a.kpiId ?? null) !== (d.fnId ? d.kpiId : null) ? 'function' : ''].filter(Boolean);
  Object.assign(a, { fnId: d.fnId, kpiId: d.fnId ? d.kpiId : null, text: d.text, owner: d.owner, ownerPersonId, due: d.due, updatedAt: new Date().toISOString() });
  // A moved due date keeps its story (spec §12: a missed deadline keeps the original date in the history).
  if (changedWhat.length) a.history.push(step('edited', { note: `Changed the ${changedWhat.join(', ')}` }));
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
  const add = p === 'ar-a';
  return `
    <div class="ar-fields">
      <div class="ar-field">
        <label class="ar-label" for="${p}-fn">Function</label>
        <span class="ar-pick"><select id="${p}-fn" name="fnId" data-fk="${p}-fn">${options}</select></span>
        ${errorMarkup(`${p}-fn`)}
      </div>
      <div class="ar-field" data-ar-kpi-slot${kpi ? '' : ' hidden'}>${kpi}</div>
      ${add ? '<div class="ar-field ar-field--wide ar-link" data-ar-link-slot hidden></div>' : ''}
      <div class="ar-field ar-field--wide"${add ? ' data-ar-new' : ''}>
        <label class="ar-label" for="${p}-text">Action</label>
        <textarea class="ar-textarea" id="${p}-text" name="text" rows="3" required data-fk="${p}-text" aria-keyshortcuts="Control+Enter Meta+Enter">${esc(d.text)}</textarea>
        ${errorMarkup(`${p}-text`)}
      </div>
      <div class="ar-field"${add ? ' data-ar-new' : ''}>
        <label class="ar-label" for="${p}-owner">Owner</label>
        ${ownerFieldMarkup(p, d)}
        ${errorMarkup(`${p}-owner`)}
      </div>
      <div class="ar-field"${add ? ' data-ar-new' : ''}>
        <label class="ar-label" for="${p}-due">Due date</label>
        <input class="ar-input ar-date" id="${p}-due" name="due" type="date" value="${esc(d.due ?? '')}" data-fk="${p}-due">
        ${errorMarkup(`${p}-due`)}
      </div>
    </div>`;
}

/**
 * The owner: a person from the Organization (as the Weekly review's Add action picks one), so the action
 * is tied to who they are, not how their name was typed; self-verification compares that id. An older
 * action owned by a name outside the Organization keeps it as its own choice. Before the Organization
 * is ready (no people), a plain name box.
 */
function ownerFieldMarkup(p, d) {
  const people = (orgPeople() ?? []).filter((x) => String(x.name ?? '').trim());
  const hint = `<p class="ar-hint" id="${p}-owner-hint">Filled in from the function. Pick someone else from the Organization if they will do it.</p>`;
  if (!people.length) {
    return `<input class="ar-input" id="${p}-owner" name="owner" type="text" autocomplete="off"
          value="${esc(d.owner)}" required aria-describedby="${p}-owner-hint" data-fk="${p}-owner">${hint}`;
  }
  const dupes = new Set(people.map((x) => x.name.trim().toLowerCase()).filter((n, i, all) => all.indexOf(n) !== i));
  const known = people.some((x) => x.id === d.ownerPersonId);
  const outside = !known && String(d.owner ?? '').trim() ? `<option value="${esc(NAME_PICK + d.owner.trim())}" selected>${esc(d.owner.trim())} (not in the Organization)</option>` : '';
  const opts = people.map((x) => `<option value="${esc(x.id)}"${x.id === d.ownerPersonId ? ' selected' : ''}>${esc(x.name.trim())}${dupes.has(x.name.trim().toLowerCase()) && x.title ? ` (${esc(x.title)})` : ''}</option>`).join('');
  return `<span class="ar-pick"><select id="${p}-owner" name="ownerPersonId" required aria-describedby="${p}-owner-hint" data-fk="${p}-owner">${!known && !outside ? '<option value="" selected>Choose who will do it</option>' : ''}${outside}${opts}</select></span>${hint}`;
}

/** A value from the owner picker: { id, name } (a kept outside name has no id). */
function ownerPick(value) {
  const v = String(value ?? '');
  if (v.startsWith(NAME_PICK)) return { id: null, name: v.slice(NAME_PICK.length) };
  const person = (orgPeople() ?? []).find((x) => x.id === v);
  return person ? { id: person.id, name: person.name.trim() } : { id: null, name: '' };
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
  if (el.name === 'ownerPersonId') return el.value ? '' : 'Choose who will do it.';
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
  for (const name of ['fnId', 'text', 'owner', 'ownerPersonId', 'due']) {
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
  const picked = form.elements.namedItem('ownerPersonId') ? ownerPick(v('ownerPersonId')) : { id: undefined, name: v('owner').trim() };
  return { fnId, kpiId: fnId ? v('kpiId') || null : null, text: v('text').trim(), owner: picked.name, ownerPersonId: picked.id, due: isoOrNull(v('due')) };
}

/* ---------- Render ---------- */

function visibleActions(all, month) {
  void month;
  return newestFirst(all).filter((a) => view.pinned.has(a.id) || (
    (view.show === 'all' || isOpenAction(a)) && (view.fn === 'all' || a.fnId === view.fn)
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
  const over = all.filter((a) => isOverdue(a, isoForDay(month, day))).length;
  const parts = [];
  if (needs) parts.push(`<span class="ar-part ar-over">${glyph('g-off')}${needs} ${needs === 1 ? 'needs' : 'need'} an action</span>`);
  // Something is off goal and every one of those KPIs has an action: say so first.
  else if (sum.allClear) parts.push(`<span class="ar-part ar-clear">${glyph('g-on')}Every off-goal KPI has an action</span>`);
  if (!all.length) parts.push('<span class="ar-part">No actions assigned yet</span>');
  else parts.push(...stateCounts(all).map((t) => `<span class="ar-part">${t}</span>`));
  const escalated = all.filter(isEscalatedAction).length;
  if (escalated) parts.push(`<span class="ar-part">${escalated} escalated</span>`);
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
            // Verified on this day or later: it was the KPI's action that day, and it's closed.
            if (isVerifiedAction(a)) {
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
      <p class="ar-empty">No assigned actions yet. Use Add action above, or add them during Run daily meeting.</p>`;
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
      const closed = inFn.filter(isClosedAction).length;
      body = `<p class="ar-empty">Nothing open${view.fn === 'all' ? '' : ` for ${name}`}. ${closed} closed ${closed === 1 ? 'action is' : 'actions are'} hidden.</p>
        <p class="ar-empty-tools"><button class="btn btn--secondary" type="button" data-ar-reset="show" data-fk="empty-showall">Show all</button></p>`;
    }
    host.innerHTML = head + body;
    return;
  }

  // Counts by status (for the function picked, if one is), so a status change shows here at once.
  const base = view.fn === 'all' ? all : all.filter((a) => a.fnId === view.fn);
  // Only the counts there are, as in the head ("1 verified", never "0 open").
  const parts = stateCounts(base);
  if (view.fn !== 'all') parts.unshift(esc(fnName(month, view.fn)));
  if (visible.length !== base.length) parts.push(`showing ${visible.length}`);
  parts.push('newest first');
  host.innerHTML = `${head}
    <p class="section-sub ar-list-sub" data-ar-list-count>${parts.map((t) => `<span class="ar-part">${t}</span>`).join('<span class="ar-dotsep"> · </span>')}</p>
    <ul class="ar-list">${visible.map((a, i) => itemMarkup(a, i, month, boardIso)).join('')}</ul>`;
}

/** "2 open · 1 in progress · 1 completed · 3 verified · 1 cancelled": only the counts there are. */
function stateCounts(list) {
  const n = (st) => list.filter((a) => a.status === st).length;
  const words = { open: 'open', 'in-progress': 'in progress', completed: 'completed', verified: 'verified', cancelled: 'cancelled' };
  return ACTION_STATES.filter((st) => n(st)).map((st) => `${n(st)} ${words[st]}`);
}

const HISTORY_WORD = {
  created: 'Added', started: 'Started', completed: 'Marked completed', verified: 'Verified', rejected: 'Rejected',
  cancelled: 'Cancelled', reopened: 'Reopened', escalated: 'Escalated', deescalated: 'Escalation removed',
  linked: 'Day linked', edited: 'Edited', migrated: 'Migrated',
};

/** One action's history, oldest first, in a disclosure (folded). */
function historyMarkup(a, month) {
  const steps = a.history ?? [];
  if (!steps.length) return '';
  const when = (h) => [h.dayIso ? `for ${nb(dayText(h.dayIso, month))}` : '', h.by ? `by ${h.by}` : ''].filter(Boolean).join(' ');
  const items = steps.map((h) => {
    const detail = [
      h.kind === 'escalated' && h.escalatedTo ? `to ${h.escalatedTo}` : '',
      h.verifier ? `by ${h.verifier}` : '',
      h.evidence ? `evidence: ${h.evidence}` : '',
      h.reason ? `reason: ${h.reason}` : '',
      h.note ?? '',
    ].filter(Boolean).join(' · ');
    const what = h.kind === 'linked' && h.dayIso ? `Linked ${nb(dayText(h.dayIso, month))}`
      : h.kind === 'migrated' && h.to === 'verified' ? 'Verified' : (HISTORY_WORD[h.kind] ?? h.kind);
    return `<li><span class="ar-h-what">${esc(what)}</span>${detail ? ` <span class="ar-h-detail">${esc(detail)}</span>` : ''}${h.kind !== 'linked' && when(h) ? ` <span class="ar-h-when">${esc(when(h))}</span>` : ''}</li>`;
  }).join('');
  return `<details class="ar-history"><summary data-fk="hist-${esc(a.id)}">History <span class="ar-history-n">(${steps.length})</span></summary><ol class="ar-history-list">${items}</ol></details>`;
}

/** The step form under an action: verify, reject, cancel, reopen or escalate, each with what it needs. */
function txFormMarkup(a, kind, month, i) {
  const d = txDraft ?? {};
  const k = esc(a.id);
  const p = `ar-x-${k}`;
  const org = getOrg(month).active;
  const reasonField = (label, hint = '') => `
      <div class="ar-field ar-field--wide">
        <label class="ar-label" for="${p}-reason">${esc(label)}</label>
        <textarea class="ar-textarea" id="${p}-reason" name="reason" rows="2" data-fk="${p}-reason"${hint ? ` aria-describedby="${p}-reason-hint"` : ''}>${esc(d.reason ?? '')}</textarea>
        ${hint ? `<p class="ar-hint" id="${p}-reason-hint">${esc(hint)}</p>` : ''}
        ${errorMarkup(`${p}-reason`)}
      </div>`;
  let title;
  let fields;
  let save;
  if (kind === 'verify') {
    const opts = verifierOptions(org, a);
    title = 'Verify and close';
    save = 'Verify and close';
    const options = [
      `<option value="">Choose who verifies</option>`,
      ...opts.options.map((o) => `<option value="${esc(o.id)}"${o.allowed ? '' : ' disabled'}${d.verifier === o.id ? ' selected' : ''}>${esc(o.name)}${o.allowed ? '' : ' (owns it: can\'t verify their own action)'}</option>`),
    ].join('');
    const rule = opts.allowSelf
      ? 'Self-verification is allowed in Board setup, so the owner may verify too.'
      : 'Self-verification is off: the owner can\'t verify their own action (Board setup, Organization, Allow self-verification).';
    const none = !opts.options.length ? 'Nobody has the Verifier role yet. Give someone the role in Board setup, under Organization.'
      : !opts.any ? 'The only verifier owns this action. Give someone else the Verifier role, or allow self-verification, in Board setup.' : '';
    fields = `
      <div class="ar-field ar-field--wide">
        <label class="ar-label" for="${p}-verifier">Verifier</label>
        <span class="ar-pick"><select id="${p}-verifier" name="verifier" data-fk="${p}-verifier" aria-describedby="${p}-verifier-hint">${options}</select></span>
        <p class="ar-hint" id="${p}-verifier-hint">${esc(none || rule)}</p>
        ${errorMarkup(`${p}-verifier`)}
      </div>
      <div class="ar-field ar-field--wide">
        <label class="ar-label" for="${p}-evidence">Evidence it worked</label>
        <textarea class="ar-textarea" id="${p}-evidence" name="evidence" rows="2" data-fk="${p}-evidence" aria-describedby="${p}-evidence-hint">${esc(d.evidence ?? '')}</textarea>
        <p class="ar-hint" id="${p}-evidence-hint">What was checked, and over which days. Completing the work isn't proof the problem is solved.</p>
        ${errorMarkup(`${p}-evidence`)}
      </div>`;
  } else if (kind === 'reject') {
    title = 'Reject: back to In progress';
    save = 'Send back to In progress';
    fields = reasonField('Why it isn\'t done yet');
  } else if (kind === 'cancel') {
    title = 'Cancel this action';
    save = 'Cancel the action';
    fields = reasonField('Reason', 'Cancelling doesn\'t resolve the issue: while the KPI is off goal, it needs another action.');
  } else if (kind === 'reopen') {
    title = 'Reopen';
    save = 'Reopen';
    fields = reasonField('Why it\'s reopened', 'Its history stays: earlier steps, the verifier and the reasons are kept.');
  } else {
    const leader = accountableFor(org, a.fnId).name;
    const people = org.people.filter((x) => x.name.trim());
    const to = d.to ?? leader;
    title = 'Escalate';
    save = 'Escalate';
    fields = `
      <div class="ar-field">
        <label class="ar-label" for="${p}-to">Escalate to</label>
        <span class="ar-pick"><select id="${p}-to" name="to" data-fk="${p}-to">${people.map((x) => `<option value="${esc(x.name)}"${x.name === to ? ' selected' : ''}>${esc(x.name)}${x.name === leader ? ' (accountable leader)' : ''}</option>`).join('')}</select></span>
      </div>
      ${reasonField('Why it needs escalating', 'The action keeps its state. Escalated is a flag of its own.')}`;
  }
  return `
    <form class="ar-form ar-form--tx" data-ar-tx-form="${k}" data-kind="${kind}" novalidate aria-labelledby="${p}-title">
      <h4 class="ar-form-title" id="${p}-title">${esc(title)}<span class="sr-only">: ${esc(a.text)}</span></h4>
      <div class="ar-fields">${fields}</div>
      <div class="ar-form-actions">
        <button class="btn btn--primary" type="submit" data-fk="${p}-save">${esc(save)}</button>
        <button class="btn btn--secondary" type="button" data-ar-tx-cancel data-fk="${p}-cancel">Not now</button>
      </div>
    </form>`;
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
  const closed = isClosedAction(a);
  const sep = '<span class="ar-dotsep"> · </span>';
  const dueText = a.due ? `Due ${esc(nb(dayText(a.due, month)))}` : '';
  // A closed action says the board day it closed ("Verified Fri, Feb 27"), instead of when it was due.
  let due;
  if (isVerifiedAction(a) && a.closedDayIso) due = `<span class="ar-due">Verified ${esc(nb(dayText(a.closedDayIso, month)))}</span>`;
  else if (isCancelledAction(a) && a.closedDayIso) due = `<span class="ar-due">Cancelled ${esc(nb(dayText(a.closedDayIso, month)))}</span>`;
  else if (!a.due) due = '<span class="ar-due is-none">No due date</span>';
  else if (over) due = `<span class="ar-over">${glyph('g-off')}Overdue</span>${sep}<span class="ar-due">${dueText}</span>`;
  else due = `<span class="ar-due">${dueText}</span>`;
  const aging = agingWords(a, boardIso);
  const when = a.dayIso ? esc(nb(dayText(a.dayIso, month))) : '';
  const source = a.source === 'meeting'
    ? `<button class="btn btn--text ar-src" type="button" data-ar-source="${k}" data-fk="src-${k}">${when ? `From the ${when} meeting` : 'From a meeting'}</button>`
    : `<span class="ar-src-text">${when ? `Added ${when}` : 'Added here'}</span>`;
  const leader = accountableFor(getOrg(month).active, a.fnId).name;
  const linked = a.affectedDays.length
    ? `<p class="ar-meta ar-days">Answers for ${actionDays(a).map((d) => esc(nb(dayText(d, month)))).join(', ')}<span class="ar-days-note"> (repeat loss linked)</span></p>` : '';
  const esc8 = a.escalation
    ? `<p class="ar-esc${isOpenAction(a) ? '' : ' is-past'}"><span class="ar-esc-lead">${isOpenAction(a) ? 'Escalated' : 'Was escalated'} to ${esc(a.escalation.to)}:</span> ${esc(a.escalation.reason)}</p>` : '';
  const verified = isVerifiedAction(a)
    ? `<p class="ar-proof">${a.verification ? `<span class="ar-proof-lead">Verified by ${esc(a.verification.verifier)}:</span> ${esc(a.verification.evidence)}` : `<span class="ar-proof-lead">${esc(MIGRATED_NOTE)}.</span>`}</p>` : '';
  const cancelled = isCancelledAction(a) && a.cancelReason ? `<p class="ar-proof"><span class="ar-proof-lead">Cancelled:</span> ${esc(a.cancelReason)}</p>` : '';
  const describe = ` aria-describedby="ar-t-${i}"`;
  const stepBtn = (kind, primary = false) => `<button class="btn ${primary ? 'btn--primary' : 'btn--secondary'} ar-step" type="button" data-ar-step="${kind}" data-ar-id="${k}" data-fk="step-${kind}-${k}"${describe}>${esc(TRANSITIONS[kind].label)}</button>`;
  const txBtn = (kind, cls = 'btn--secondary') => `<button class="btn ${cls} ar-step" type="button" data-ar-tx="${kind}" data-ar-id="${k}" data-fk="tx-${kind}-${k}" aria-expanded="${txOpen?.id === a.id && txOpen.kind === kind}"${describe}>${esc(kind === 'escalate' ? 'Escalate' : TRANSITIONS[kind].label)}</button>`;
  const steps = [];
  if (a.status === 'open') steps.push(stepBtn('start', true), stepBtn('complete'));
  if (a.status === 'in-progress') steps.push(stepBtn('complete', true));
  if (a.status === 'completed') steps.push(txBtn('verify', 'btn--primary'), txBtn('reject'));
  if (closed) steps.push(txBtn('reopen'));
  const tools = [];
  if (isOpenAction(a)) {
    tools.push(a.escalation
      ? `<button class="btn btn--quiet" type="button" data-ar-deescalate="${k}" data-fk="deesc-${k}"${describe}>Remove escalation</button>`
      : txBtn('escalate', 'btn--quiet'));
    tools.push(txBtn('cancel', 'btn--quiet'));
    tools.push(`<button class="btn btn--quiet" type="button" data-ar-edit="${k}" data-fk="edit-${k}"${describe}>Edit</button>`);
  }
  // Delete only while nothing has happened to it and no record cites it; after that, Cancel keeps the history.
  if (canDeleteAction(a)) tools.push(`<button class="btn btn--quiet" type="button" data-ar-delete="${k}" data-fk="del-${k}"${describe}>Delete</button>`);
  const tx = txOpen?.id === a.id ? txFormMarkup(a, txOpen.kind, month, i) : '';
  return `
    <li class="ar-item${over ? ' is-overdue' : ''}${closed ? ' is-closed' : ''}${tx ? ' has-tx' : ''}" data-ar-item="${k}" data-status="${esc(a.status)}" data-fk="row-${k}" tabindex="-1">
      <div class="ar-item-main">
        <p class="ar-text" id="ar-t-${i}">${esc(a.text)}</p>
        <p class="ar-meta"><span class="ar-meta-fn">${esc(fnName(month, a.fnId))}</span>${a.kpiId ? `${sep}<span class="ar-meta-kpi">${esc(kpiName(month, a.fnId, a.kpiId))}</span>` : ''}</p>
        <p class="ar-meta"><span class="ar-who">Owner: ${a.owner ? esc(a.owner) : 'not named'}</span>${leader ? `${sep}<span class="ar-who">Accountable: ${esc(leader)}</span>` : ''}</p>
        <p class="ar-meta ar-meta--due">${due}${aging ? `${sep}<span class="ar-age">${esc(aging)}</span>` : ''}</p>
        <p class="ar-meta ar-meta--when">${source}</p>
        ${linked}${esc8}${verified}${cancelled}
        ${historyMarkup(a, month)}
      </div>
      <div class="ar-item-side">
        <div class="ar-status">
          <p class="ar-label">Status</p>
          <p class="ar-state" data-fk="st-${k}" tabindex="-1">${actionStateMarkup(a.status)}${a.status === 'completed' ? '<span class="ar-state-note">Waiting for a verifier</span>' : ''}</p>
        </div>
        ${steps.length ? `<div class="ar-steps">${steps.join('')}</div>` : ''}
        <div class="ar-item-tools">${tools.join('')}</div>
      </div>
      ${tx}
    </li>`;
}

/* ---------- Step forms (verify, reject, cancel, reopen, escalate) ---------- */

function openTx(id, kind) {
  if (txOpen?.id === id && txOpen.kind === kind) { closeTx(); return; }
  txOpen = { id, kind };
  txDraft = {};
  editingId = null;
  editDraft = null;
  view.pinned.add(id);
  render();
  const form = dlg.querySelector(`[data-ar-tx-form="${CSS.escape(id)}"]`);
  form?.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
  form?.querySelector('select:not([disabled]), textarea')?.focus({ preventScroll: true });
}

function closeTx() {
  const back = txOpen;
  txOpen = null;
  txDraft = null;
  render();
  if (back) (dlg.querySelector(sel('data-fk', `tx-${back.kind}-${back.id}`)) ?? dlg.querySelector(sel('data-ar-item', back.id)))?.focus({ preventScroll: true });
}

function saveTx(form) {
  if (!txOpen) return;
  const { id, kind } = txOpen;
  const v = (name) => form.elements.namedItem(name)?.value ?? '';
  const before = needsSum(ctx.getMonth(), ctx.getDay());
  const r = kind === 'escalate'
    ? escalateAction(id, { to: v('to'), reason: v('reason') })
    : transitionAction(id, kind, { reason: v('reason'), verifier: v('verifier'), evidence: v('evidence') });
  form.querySelectorAll('[aria-invalid="true"]').forEach((el) => setError(el, ''));
  if (!r.ok) {
    const field = form.elements.namedItem(r.field ?? 'reason') ?? form.querySelector('select, textarea');
    if (field) { setError(field, r.error); field.focus(); } else ctx.toast(r.error);
    return;
  }
  txOpen = null;
  txDraft = null;
  view.pinned.add(id);
  render();
  changed();
  focusAfterStep(id);
  const a = r.action;
  let words;
  if (kind === 'escalate') words = `Escalated to ${a.escalation.to}. It stays ${STATUS_WORD[a.status].toLowerCase()}.`;
  else if (kind === 'cancel') {
    const back = needsSum(ctx.getMonth(), ctx.getDay()).list.length > before.list.length;
    words = `${TRANSITIONS.cancel.done}${back ? ' The KPI is back on the needs list.' : ''}`;
  } else words = TRANSITIONS[kind].done;
  ctx.toast(words, {
    ...(r.prev ? { actionLabel: 'Undo', onAction: () => undoStep(r.prev, `${STATUS_WORD[r.prev.status]} again.`) } : {}),
    near: () => [dlg.querySelector(sel('data-ar-item', id))].filter(Boolean),
  });
}

/** After a step: the next step's button, else the status line. */
function focusAfterStep(id) {
  const row = dlg.querySelector(sel('data-ar-item', id));
  (row?.querySelector('.ar-steps button') ?? row?.querySelector('.ar-state') ?? row)?.focus({ preventScroll: true });
}

function deescalate(id) {
  const r = deescalateAction(id);
  if (!r.ok) return;
  view.pinned.add(id);
  render();
  changed();
  focusAfterStep(id);
  ctx.toast('Escalation removed. Its history keeps it.', { actionLabel: 'Undo', onAction: () => undoStep(r.prev, 'Escalated again.') });
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
      </div>
      <footer class="ar-foot">
        <button class="btn btn--secondary" type="button" data-ar-minutes>Meeting records</button>
        <p class="ar-foot-note" data-ar-storage></p>
      </footer>
    </div>`;
}
