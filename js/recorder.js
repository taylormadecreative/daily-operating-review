// Meeting recorder and minutes.
//
// - A meeting session starts when Run meeting opens (js/meeting.js calls
//   startMeetingSession) and is saved as minutes when it closes, if it ran at
//   least 15 seconds or holds any transcript or actions. Minutes live on this
//   device only: localStorage dor.meetings.v1.
// - Record turns speech into text with the browser's Web Speech API and shows
//   live captions under the slide.
// - Add action (on each function slide) saves to the Action register, and the
//   slide shows it under "Action, next 24 hours" at once. Closed without saving
//   (Esc, Cancel), a typed action is kept as that function's draft for the
//   meeting: the slide says "Draft kept for People." and the form brings it back.
// - openMinutes() shows the saved minutes in a right-side sheet.
//
// ctx = { getMonth, getDay, toast, addAction, openActions }

import { kpiRowsFor, ownerFor, isoForDay } from './store.js?v=20261013-151156';
import { dayStatus, monthStatus, statusWord, ON, OFF, NO_PRODUCTION } from './status.js?v=20261013-151156';
import { formatPair, plainLabel, formatDayMedium, formatDayLong, monthSoFar } from './format.js?v=20261013-151156';
import { notesText, summaryParts, actionStateFor, needsSummary, ACTION_WORD, issueGap, ISSUE_GAP_WORD } from './board.js?v=20261013-151156';
import { esc, statusMarkup, issueStatusMarkup, glyphMarkup } from './ui.js?v=20261013-151156';
// Namespace import: the Action register is built in parallel, and a missing
// export must never stop the board from loading.
import * as register from './actions.js?v=20261013-151156';
// The payoff toast is shared with the Action register, so both say it the same way.
import { ALL_CLEAR_ADDED, clearedNeeds } from './actions.js?v=20261013-151156';
// The sheet's title bar height, so Shift+Tab never leaves a control hidden under it (shared with Detail).
import { fitSheetHead } from './detail.js?v=20261013-151156';

const MEETINGS_KEY = 'dor.meetings.v1';
const SESSION_KEY = 'dor.meetingSession.v1';
const NOTICE_KEY = 'dor.recorder.notice.v1';
const CAPTIONS_KEY = 'dor.recorder.captions.v1';
const MIN_SECONDS = 15;
// "Minutes saved" stays until it's dismissed (the longest wait a browser timer takes).
const STAY = 2147483647;

const NOTICE = "Speech is turned into text by the browser's speech service. Everyone in the room should know the meeting is being recorded.";
/** Where the minutes come from: the board, plus the recording when something was recorded. */
const honestLine = (r) => (r?.transcript?.length
  ? "Built from the board and the meeting's recording on this device."
  : 'Built from the board on this device.');

let ctx = null;
let meetingApi = null; // { relayout } from meeting.js
let session = null;    // the meeting in progress
let closing = false;

/* ---------- Small helpers ---------- */

const safeGet = (store, key) => { try { return store.getItem(key); } catch { return null; } };
const safeSet = (store, key, value) => { try { store.setItem(key, value); return true; } catch { return false; } };
const safeRemove = (store, key) => { try { store.removeItem(key); } catch { /* ignore */ } };
const local = () => { try { return window.localStorage; } catch { return null; } };
const sess = () => { try { return window.sessionStorage; } catch { return null; } };

function newId() {
  const rand = Math.random().toString(36).slice(2, 7);
  return `mtg-${Date.now().toString(36)}-${rand}`;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function isoToDate(iso) {
  const m = ISO_RE.exec(String(iso ?? ''));
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}
function dateToIso(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
const LONG_DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const MED_DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
/** "Fri, Feb 27, 2026" from "2026-02-27". */
const longDay = (iso) => { const d = isoToDate(iso); return d ? LONG_DAY.format(d) : String(iso ?? ''); };
/** "Fri, Feb 27" from "2026-02-27". */
const medDay = (iso) => { const d = isoToDate(iso); return d ? MED_DAY.format(d) : String(iso ?? ''); };

/** "Mon, Oct 12, 9:02 AM" (the year only when it isn't this year). */
function whenStarted(isoTime) {
  const d = new Date(isoTime);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}

/** "45 sec", "14 min 32 sec", "1 hr 5 min". */
function durationWords(total) {
  const sec = Math.max(0, Math.round(Number(total) || 0));
  if (sec < 60) return `${sec} sec`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return m ? `${h} hr ${m} min` : `${h} hr`;
  return s ? `${m} min ${s} sec` : `${m} min`;
}

/** Clock text for timers and transcript lines: "3:07", "1:02:45". */
function clock(totalSec) {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** A "·" between details for the eye; a screen reader hears a comma ("People, Owner: …", never "PeopleOwner: …"). */
const SEP = '<span aria-hidden="true">\u00a0· </span><span class="sr-only">, </span>';

const plural = (n, one, many) => `${n}\u00a0${n === 1 ? one : many}`;
const plain = (t) => String(t ?? '').replace(/ /g, ' ');
/** Words that end a sentence: a full stop is added unless they already end in one ("…first shift." then "Owner: …"). */
const sentence = (t) => {
  const s = String(t ?? '').trim();
  return !s || /[.!?…]["'”’)\]]*$/.test(s) ? s : `${s}.`;
};

/* ---------- Saved meetings (localStorage) ----------
   Records are checked on every read: a wrong type becomes a safe default, a
   missing list becomes an empty one, and a record (or a part of one) that
   can't be read is skipped. The minutes never throw on what storage holds. */

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const arr = (v) => (Array.isArray(v) ? v : []);
const textOf = (v) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);
const ACTION_STATES = ['has', 'needs', 'none', 'nothing'];

/** An ISO time from a string or a number of milliseconds ('' when it isn't one, or is before 2000). */
function timeIso(v) {
  const d = typeof v === 'number' || (typeof v === 'string' && v.trim()) ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) && d.getFullYear() >= 2000 ? d.toISOString() : '';
}

function normCell(c) {
  if (!isObj(c)) return null;
  return {
    status: str(c.status, 'not-entered'),
    word: typeof c.word === 'string' && c.word.trim() ? c.word : undefined,
    actual: textOf(c.actual),
    rest: str(c.rest),
    measure: str(c.measure),
    note: str(c.note),
  };
}

function normNote(n) {
  if (!isObj(n)) return null;
  return { text: textOf(n.text) ?? '', empty: Boolean(n.empty) || !textOf(n.text) };
}

/** One action as the minutes keep it (a copy, so they still say it if the register can't). */
function normAction(a) {
  if (!isObj(a)) return null;
  const text = textOf(a.text);
  if (!text) return null;
  return {
    id: textOf(a.id),
    fnId: typeof a.fnId === 'string' && a.fnId ? a.fnId : null,
    kpiId: typeof a.kpiId === 'string' && a.kpiId ? a.kpiId : null,
    fnName: str(a.fnName),
    text,
    owner: str(a.owner),
    due: typeof a.due === 'string' ? a.due : null,
    status: str(a.status, 'open'),
    meetingId: typeof a.meetingId === 'string' ? a.meetingId : null,
    // A done action: the board day it was closed on ("Done Fri, Feb 27").
    closedDayIso: typeof a.closedDayIso === 'string' && ISO_RE.test(a.closedDayIso) ? a.closedDayIso : null,
  };
}

/** A KPI row's action as the room saw it when the meeting ended (newer minutes only). */
function normAct(a) {
  if (!isObj(a) || !ACTION_STATES.includes(a.state)) return null;
  return {
    state: a.state,
    text: textOf(a.text),
    word: str(a.word),
    assigned: arr(a.assigned).map(normAction).filter(Boolean),
  };
}

function normRow(r) {
  if (!isObj(r)) return null;
  return {
    name: textOf(r.name) ?? '',
    primary: Boolean(r.primary),
    kpiId: typeof r.kpiId === 'string' && r.kpiId ? r.kpiId : null,
    day: normCell(r.day),
    month: normCell(r.month),
    issue: normNote(r.issue),
    action: normNote(r.action),
    act: normAct(r.act),
    issueGap: r.issueGap === true,
  };
}

function normFunction(f) {
  if (!isObj(f) || !textOf(f.name)) return null; // a function with no name can't be shown
  return {
    id: str(f.id),
    name: textOf(f.name),
    owner: textOf(f.owner) ?? '',
    rows: arr(f.rows).map(normRow).filter(Boolean),
  };
}

function normNeeds(n) {
  if (!isObj(n)) return null;
  const list = arr(n.list).filter((x) => typeof x === 'string');
  return { text: str(n.text), lead: str(n.lead), allClear: Boolean(n.allClear) && !list.length, list };
}

function normSnapshot(s) {
  if (!isObj(s)) return null;
  return {
    plant: textOf(s.plant) ?? '',
    dateLabel: str(s.dateLabel),
    dayLabel: str(s.dayLabel, 'Day'),
    monthLabel: str(s.monthLabel, 'Month so far'),
    summary: str(s.summary),
    offGoal: Array.isArray(s.offGoal) ? s.offGoal.filter((x) => typeof x === 'string') : undefined,
    needs: normNeeds(s.needs),
    functions: arr(s.functions).map(normFunction).filter(Boolean),
  };
}

function normLine(l) {
  if (!isObj(l)) return null;
  const text = textOf(l.text);
  if (!text) return null;
  const at = Number(l.at);
  return { at: Number.isFinite(at) && at >= 0 ? at : 0, text };
}

/** One saved meeting, checked; null when it can't be read at all. */
function normMeeting(m) {
  if (!isObj(m) || typeof m.id !== 'string' || !m.id) return null;
  const duration = Number(m.durationSec);
  return {
    id: m.id,
    dayIso: str(m.dayIso),
    startedAt: timeIso(m.startedAt),
    endedAt: timeIso(m.endedAt),
    durationSec: Number.isFinite(duration) && duration >= 0 ? duration : 0,
    transcript: arr(m.transcript).map(normLine).filter(Boolean),
    actionIds: arr(m.actionIds).map(textOf).filter(Boolean),
    actions: arr(m.actions).map(normAction).filter(Boolean),
    recorded: Boolean(m.recorded),
    snapshot: normSnapshot(m.snapshot),
  };
}

// This visit's copy of the saved minutes (as stored, JSON). When the browser
// blocks storage (a private window), it is the only copy: End meeting still
// shows the minutes, and the toast says they last until the page reloads.
let meetingsMem = null;
let meetingsStorageOk = true; // false once this browser refuses to read or write

function readMeetingsRaw() {
  if (meetingsStorageOk) {
    const store = local();
    if (store) {
      try {
        meetingsMem = store.getItem(MEETINGS_KEY);
        return meetingsMem;
      } catch { /* blocked */ }
    }
    meetingsStorageOk = false;
  }
  return meetingsMem;
}

function readMeetings() {
  const raw = readMeetingsRaw();
  if (!raw) return [];
  let list;
  try { list = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const m of list) {
    try {
      const r = normMeeting(m);
      if (r) out.push(r);
    } catch { /* skip what can't be read */ }
  }
  return out;
}

/** Keep the list for this visit, and on the device when it can. Returns true when it was saved on the device. */
function writeMeetings(list) {
  meetingsMem = JSON.stringify(list);
  if (!meetingsStorageOk) return false;
  if (safeSet(local(), MEETINGS_KEY, meetingsMem)) return true;
  meetingsStorageOk = false;
  return false;
}

/** Add or replace one meeting. Returns true when it was saved on the device (false: this visit only). */
function upsertMeeting(record) {
  const list = readMeetings();
  const i = list.findIndex((m) => m.id === record.id);
  if (i >= 0) list[i] = record; else list.push(record);
  return writeMeetings(list);
}

function removeMeeting(id) {
  const list = readMeetings();
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return null;
  const [removed] = list.splice(i, 1);
  writeMeetings(list); // gone for this visit either way
  return { removed, index: i };
}

const findMeeting = (id) => readMeetings().find((m) => m.id === id) ?? null;
const newestFirst = (list) => list.slice().sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

/* ---------- The meeting in progress (sessionStorage, so a reload keeps it) ---------- */

function persistSession() {
  if (!session) return;
  const { month, day, ...rest } = session;
  void month; void day;
  // Each function's kept Add action draft rides along, so a reload keeps it with the meeting.
  safeSet(sess(), SESSION_KEY, JSON.stringify({ ...rest, drafts: [...drafts] }));
}

/** A saved draft as the form left it, or null: { text, owner, due, kpiId, from }. */
function normDraft(d) {
  if (!isObj(d) || typeof d.text !== 'string' || !d.text.trim()) return null;
  const str = (v) => (typeof v === 'string' ? v : '');
  const keyOrNull = (v) => (typeof v === 'string' ? v : null);
  return { text: d.text, owner: str(d.owner), due: str(d.due), kpiId: keyOrNull(d.kpiId), from: keyOrNull(d.from) };
}

function readSession() {
  const raw = safeGet(sess(), SESSION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (!isObj(s) || typeof s.id !== 'string' || !Number.isFinite(Number(s.startedAt))) return null;
    return {
      ...s,
      startedAt: Number(s.startedAt),
      transcript: arr(s.transcript).map(normLine).filter(Boolean),
      actions: arr(s.actions).map(normAction).filter(Boolean),
      recorded: Boolean(s.recorded),
      drafts: arr(s.drafts)
        .filter((e) => Array.isArray(e) && typeof e[0] === 'string')
        .map(([fnId, d]) => [fnId, normDraft(d)])
        .filter(([, d]) => d),
    };
  } catch {
    return null;
  }
}

/* ---------- Snapshot of the board for the minutes ---------- */

/** One status cell as it read during the meeting: word, figure, measure. */
function cellFor(s, kpi, show) {
  const f = formatPair(s.actual, s.goal, kpi);
  return {
    status: s.status,
    word: statusWord(s.status, kpi),
    actual: show ? f.actual : null,
    rest: show ? f.rest : '',
    measure: plainLabel(kpi),
  };
}

/** The summary sentence with a date, never "yesterday" (minutes are read later). */
function absoluteSentence(text, month, day) {
  const date = formatDayMedium(month, day).replace(/ /g, ' ');
  return text.replace(/ (yesterday|today)\.$/, text.startsWith('No production') ? ` on ${date}.` : ` for ${date}.`);
}

/** A KPI row's action as the room leaves it: the board's words, and the register actions that count that day (open, then done). */
function actSnapshot(month, fn, k, day) {
  try {
    const st = actionStateFor(month, fn, k, day);
    return {
      state: st.state,
      text: st.text,
      word: st.word,
      assigned: st.assigned.map((a) => ({
        id: a.id, text: a.text, owner: a.owner || '', due: a.due ?? null, status: a.status, meetingId: a.meetingId ?? null,
        closedDayIso: a.closedDayIso ?? null,
      })),
    };
  } catch {
    return null; // the register can't be read: the minutes fall back to the board's note
  }
}

/** Off goal, something recorded, no real problem written (board.js issueGap): the minutes keep the slide's red line. */
function issueGapFor(month, fn, k, day) {
  try { return issueGap(month, fn, k, day); } catch { return false; }
}

/** What still needs an action when the meeting ended (kept, so the minutes still say it later). */
function needsSnapshot(month, day) {
  try {
    const n = needsSummary(month, day);
    return { text: n.text, lead: n.lead, allClear: n.allClear, list: n.list.map((x) => x.label) };
  } catch {
    return null;
  }
}

function buildSnapshot(month, day) {
  const { s, count } = summaryParts(month, day);
  return {
    plant: month.plant,
    dateLabel: formatDayLong(month, day),
    dayLabel: formatDayMedium(month, day),
    monthLabel: monthSoFar(month),
    summary: absoluteSentence(count, month, day),
    // The board's own list (a function is off goal when any of its measures is).
    offGoal: s.productionDay === false ? [] : s.yesterday.attention.map((fn) => fn.name),
    needs: needsSnapshot(month, day),
    functions: month.functions.map((fn) => ({
      id: fn.id,
      name: fn.name,
      owner: ownerFor(fn).name,
      rows: kpiRowsFor(fn).map((k) => {
        const y = dayStatus(month, k, day);
        const mo = monthStatus(month, k, day);
        const n = notesText(month, k, day);
        return {
          name: plainLabel(k.kpiDaily),
          primary: Boolean(k.primary),
          kpiId: k.primary ? null : (k.kpiId ?? null),
          day: cellFor(y, k.kpiDaily, !(y.status === NO_PRODUCTION && y.actual === null)),
          month: {
            ...cellFor(mo, k.kpiMonthly, mo.asOfDay !== null),
            note: mo.asOfDay && mo.asOfDay !== day ? `as of ${formatDayMedium(month, mo.asOfDay)}` : '',
          },
          issue: n.problem,
          issueGap: issueGapFor(month, fn, k, day),
          action: n.action,
          act: actSnapshot(month, fn, k, day),
        };
      }),
    })),
  };
}

function buildRecord(s, endedAt) {
  const durationSec = Math.max(0, Math.round((endedAt - s.startedAt) / 1000));
  let snapshot = null;
  try { snapshot = s.month ? buildSnapshot(s.month, s.day) : null; } catch { snapshot = null; }
  return {
    id: s.id,
    dayIso: s.dayIso,
    startedAt: new Date(s.startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationSec,
    transcript: s.transcript.slice(),
    actionIds: s.actions.map((a) => a.id).filter(Boolean),
    // A copy of what was assigned, so the minutes still say it if the register can't.
    actions: s.actions.slice(),
    recorded: Boolean(s.recorded),
    snapshot,
  };
}

const worthSaving = (r) => r.durationSec >= MIN_SECONDS || r.transcript.length > 0 || r.actions.length > 0;

/* ---------- Session API for meeting.js ---------- */

/** meeting.js hands over what the recorder may ask of it. */
export function connectMeeting(api) { meetingApi = api; }

/** True once app.js has started the recorder (Add action and Record need it). */
export const recorderReady = () => Boolean(ctx);

/** The meeting in progress (its actions read "From this meeting" on the slides), or null. */
export const currentMeetingId = () => session?.id ?? null;

/** A meeting opened. `startedAt` is the meeting timer's start, so a reload resumes the same session. */
export function startMeetingSession(month, day, startedAt) {
  const saved = readSession();
  drafts.clear();
  if (saved && saved.startedAt === startedAt) {
    // The same meeting after a reload: its kept drafts come back with it.
    const { drafts: kept = [], ...rest } = saved;
    kept.forEach(([fnId, d]) => drafts.set(fnId, d));
    session = { ...rest, month, day, dayIso: isoForDay(month, day) };
  } else {
    session = { id: newId(), startedAt, dayIso: isoForDay(month, day), transcript: [], actions: [], recorded: false, month, day };
  }
  persistSession();
  if (!ctx || !recRoot) return;
  closing = false;
  interim = '';
  setRecState('idle', { announce: false });
  renderSupport();
  renderCount();
  recRoot.hidden = false;
}

/** The meeting re-rendered with fresh data (or another day). */
export function updateMeetingSession(month, day) {
  if (!session) return;
  session.month = month;
  session.day = day;
  session.dayIso = isoForDay(month, day);
  persistSession();
}

/**
 * The meeting is closing: stop recording, save the minutes, offer to open them.
 * opts.openMinutes (End meeting on the last slide): always save, then open the
 * minutes over the board once the screen has settled.
 */
export function endMeetingSession({ openMinutes: openAfter = false } = {}) {
  if (!session) return;
  closing = true;
  stopRecording({ flush: true, now: true });
  if (addDialog?.open) addDialog.close();
  drafts.clear(); // drafts belong to this meeting
  const s = session;
  session = null;
  safeRemove(sess(), SESSION_KEY);
  closing = false;
  if (!ctx) return;
  const record = buildRecord(s, Date.now());
  if (!openAfter && !worthSaving(record)) {
    removeMeeting(record.id); // a copy saved when the page was closed mid-meeting
    return;
  }
  const label = medDay(record.dayIso);
  // Storage blocked (a private window): the minutes are kept for this visit, and the toast says so.
  const kept = upsertMeeting(record);
  const saved = kept
    ? `Minutes saved for ${label}.`
    : `Minutes kept for ${label} for this visit. This browser isn't saving, so they will clear when the page reloads.`;
  if (!openAfter) {
    ctx.toast(saved, { actionLabel: 'Open minutes', onAction: () => openMinutes(record.id), duration: STAY });
    return;
  }
  // After the board is back (full screen has let go and the row has focus),
  // so closing the minutes returns there. "Saved" is said in the minutes' own
  // header, not in a toast over the minutes' text.
  const show = () => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
    headNote = { id: record.id, text: kept ? 'Saved on this device.' : saved, warn: !kept };
    openMinutes(record.id);
  }, 0)));
  if (document.fullscreenElement) {
    let done = false;
    const once = () => { if (!done) { done = true; show(); } };
    document.addEventListener('fullscreenchange', once, { once: true });
    setTimeout(once, 1200); // the browser never says it left full screen
  } else show();
}

/**
 * True while an Add action form is open, or for a moment after Esc closed it.
 * In full screen, Esc leaves full screen too; that must not end the meeting.
 */
export function recorderHoldsEscape() {
  return Boolean(addDialog?.open) || Date.now() - addClosedAt < 700;
}

/* ---------- Recording (Web Speech API) ---------- */

const SpeechCtor = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;

let recRoot;        // [data-rec] in the meeting top bar
let recToggle;
let recLabel;
let recLive;
let recWord;
let recTime;
let recWhy;
let recAnnounce;
let addedEl;
let captionsEl;
let captionsFinal;
let captionsInterim;
let captionsToggle;

let rec = null;             // the SpeechRecognition running now
let recState = 'idle';      // 'idle' | 'starting' | 'recording'
let wantOn = false;
let recStartedAt = 0;
let recTimer = null;
let interim = '';
let lastError = '';
let rapid = { count: 0, lastStart: 0 };
let captionsOn = safeGet(local(), CAPTIONS_KEY) !== 'off';
let captionsShown = false;

function setRecState(state, { announce = true } = {}) {
  const was = recState;
  recState = state;
  if (!recRoot) return;
  recRoot.dataset.state = state;
  const active = state !== 'idle';
  recLabel.textContent = active ? 'Stop' : 'Record';
  recToggle.setAttribute('aria-label', active ? 'Stop recording' : 'Record the meeting');
  recLive.hidden = !active;
  recWord.textContent = state === 'starting' ? 'Waiting for the microphone' : 'Recording';
  clearInterval(recTimer);
  recTimer = null;
  if (state === 'recording') {
    const tickRec = () => { recTime.textContent = clock((Date.now() - recStartedAt) / 1000); };
    tickRec();
    recTimer = setInterval(tickRec, 1000);
  } else {
    recTime.textContent = '';
  }
  if (announce && was !== state) {
    if (state === 'recording') recAnnounce.textContent = 'Recording started.';
    else if (state === 'idle' && was !== 'idle') recAnnounce.textContent = 'Recording stopped.';
  }
  syncCaptions();
}

function renderSupport() {
  const supported = Boolean(SpeechCtor());
  recToggle.disabled = !supported;
  recWhy.hidden = supported;
  if (supported) recToggle.removeAttribute('aria-describedby');
  else recToggle.setAttribute('aria-describedby', recWhy.id);
}

function renderCount() {
  const n = session?.actions.length ?? 0;
  addedEl.hidden = n === 0;
  addedEl.textContent = n ? `${plural(n, 'action', 'actions')} added` : '';
}

/** Show the caption strip while recording (unless hidden); the slide re-fits when it appears. */
function syncCaptions() {
  if (!captionsEl) return;
  const show = recState === 'recording' && captionsOn;
  captionsToggle.hidden = recState !== 'recording';
  captionsToggle.textContent = captionsOn ? 'Hide captions' : 'Show captions';
  renderCaptions();
  if (show === captionsShown) return;
  captionsShown = show;
  captionsEl.hidden = !show;
  if (!closing && session) meetingApi?.relayout?.();
  requestAnimationFrame(placeToasts);
}

/** While captions show, messages rise above them instead of covering them. */
function placeToasts() {
  const root = document.documentElement;
  const lowest = noticeEl && !noticeEl.hidden && session ? noticeEl : captionsShown && session && !captionsEl.hidden ? captionsEl : null;
  if (lowest) {
    const top = lowest.getBoundingClientRect().top;
    root.style.setProperty('--meeting-toast-bottom', `${Math.max(0, Math.round(window.innerHeight - top + 8))}px`);
  } else {
    root.style.removeProperty('--meeting-toast-bottom');
  }
}

/**
 * The first recording on a device says how speech becomes text. It sits in its
 * own line between the slide and the captions, and the slide re-fits above it,
 * so it covers nothing (a toast there would hide the chart's caption). It goes
 * after a while, on Got it, or when recording stops.
 */
let noticeEl = null;
let noticeTimer = null;
const NOTICE_MS = 12000;

function buildNotice(meeting) {
  const body = meeting.querySelector('.meeting-body');
  if (!body) return;
  noticeEl = document.createElement('div');
  noticeEl.className = 'meeting-notice';
  noticeEl.setAttribute('role', 'status');
  noticeEl.hidden = true;
  noticeEl.innerHTML = `<p class="meeting-notice-text"></p><button class="btn btn--text meeting-notice-ok" type="button">Got it</button>`;
  noticeEl.querySelector('button').addEventListener('click', () => hideNotice({ refocus: true }));
  body.insertBefore(noticeEl, captionsEl && captionsEl.parentElement === body ? captionsEl : null);
}

function showNotice() {
  if (!noticeEl) { ctx.toast(NOTICE); return; }
  clearTimeout(noticeTimer);
  noticeEl.querySelector('.meeting-notice-text').textContent = NOTICE;
  if (noticeEl.hidden) {
    noticeEl.hidden = false;
    if (!closing && session) meetingApi?.relayout?.();
    requestAnimationFrame(placeToasts);
  }
  noticeTimer = setTimeout(() => hideNotice(), NOTICE_MS);
}

function hideNotice({ refocus = false } = {}) {
  clearTimeout(noticeTimer);
  if (!noticeEl || noticeEl.hidden) return;
  const hadFocus = noticeEl.contains(document.activeElement);
  noticeEl.hidden = true;
  if (hadFocus || refocus) recToggle?.focus({ preventScroll: true });
  if (!closing && session) meetingApi?.relayout?.();
  requestAnimationFrame(placeToasts);
}

function renderCaptions() {
  if (!captionsEl) return;
  const lines = session?.transcript ?? [];
  // The last two lines heard, then what is being said now in a lighter tone.
  const tail = lines.slice(-2).map((l) => l.text).join(' ');
  captionsFinal.textContent = tail.length > 320 ? `…${tail.slice(-320)}` : tail;
  captionsInterim.textContent = interim.trim() || (tail ? '' : 'Listening…');
}

/** Tidy one finished phrase and add it to the transcript. */
function addLine(raw) {
  if (!session) return;
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  const at = Math.max(0, Math.round((Date.now() - session.startedAt) / 1000));
  session.transcript.push({ at, text: text.charAt(0).toUpperCase() + text.slice(1) });
  persistSession();
}

function startRecording() {
  const Ctor = SpeechCtor();
  if (!Ctor || !session || recState !== 'idle') return;
  if (safeGet(local(), NOTICE_KEY) !== 'seen') {
    showNotice();
    safeSet(local(), NOTICE_KEY, 'seen');
  }
  // A recognizer still finishing from a quick Stop would block the new one.
  if (rec) teardown();
  wantOn = true;
  lastError = '';
  rapid = { count: 0, lastStart: 0 };
  interim = '';
  setRecState('starting');
  launch(Ctor);
}

function launch(Ctor) {
  let r;
  try {
    r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
  } catch {
    fail('Recording could not start in this browser.');
    return;
  }
  rec = r;
  let lastFinal = -1;
  r.onstart = () => {
    if (rec !== r || !session) return;
    if (recState !== 'recording') {
      recStartedAt = Date.now();
      session.recorded = true;
      persistSession();
      setRecState('recording');
    }
  };
  r.onresult = (e) => {
    if (rec !== r || !session) return;
    let live = '';
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const res = e.results[i];
      const text = res[0]?.transcript ?? '';
      if (res.isFinal) {
        if (i > lastFinal) { addLine(text); lastFinal = i; }
      } else {
        live += text;
      }
    }
    interim = live;
    rapid.count = 0;
    lastError = '';
    renderCaptions();
  };
  r.onerror = (e) => {
    if (rec !== r) return;
    handleError(e.error);
  };
  r.onend = () => {
    if (rec !== r) return;
    // Whatever was half heard when the service stopped is kept.
    if (interim.trim()) { addLine(interim); interim = ''; renderCaptions(); }
    if (wantOn && session) relaunch(Ctor);
    else { rec = null; if (recState !== 'idle') setRecState('idle'); }
  };
  try {
    r.start();
    rapid.lastStart = Date.now();
  } catch {
    fail('Recording could not start in this browser.');
  }
}

/** Chrome stops listening after a silence; start again while Record is on. */
function relaunch(Ctor) {
  const quick = Date.now() - rapid.lastStart < 3000;
  rapid.count = quick ? rapid.count + 1 : 0;
  if (rapid.count >= 5) {
    fail(lastError === 'network'
      ? "The browser's speech service can't be reached, so recording stopped. Check the connection and press Record again."
      : 'Recording stopped because the speech service kept disconnecting. Press Record to try again.');
    return;
  }
  const r = rec;
  setTimeout(() => {
    if (rec === r && wantOn && session) launch(Ctor);
  }, quick ? 600 : 150);
}

function handleError(code) {
  lastError = code;
  switch (code) {
    case 'no-speech':
    case 'aborted':
    case 'network':
      return; // `end` follows; Record stays on and listening starts again
    case 'not-allowed':
      fail('Allow the microphone to record the meeting.');
      return;
    case 'service-not-allowed':
      fail("This browser's speech service isn't available here, so recording stopped.");
      return;
    case 'audio-capture':
      fail('No microphone was found. Connect one and press Record again.');
      return;
    case 'language-not-supported':
      fail("This browser's speech service doesn't support English (US), so recording stopped.");
      return;
    default:
      fail('Recording stopped because of a problem with speech to text. Press Record to try again.');
  }
}

/** Stop and say why. The transcript so far is kept. */
function fail(message) {
  stopRecording({ flush: true, now: true });
  // Never onto the board once the meeting has closed.
  if (ctx && !closing && session) ctx.toast(message);
}

/**
 * Stop listening. `now` ends at once (meeting closing, errors): anything half
 * heard is kept as a line. Otherwise the service gets a moment to finish the
 * last phrase.
 */
function stopRecording({ flush = true, now = false } = {}) {
  wantOn = false;
  hideNotice();
  const r = rec;
  if (r && !now) {
    try { r.stop(); } catch { /* already stopped */ }
    setRecState('idle');
    // If the service never says it ended, let go after a moment.
    setTimeout(() => {
      if (rec !== r) return;
      if (flush && interim.trim()) addLine(interim);
      interim = '';
      teardown();
      renderCaptions();
    }, 1500);
    return;
  }
  if (flush && interim.trim()) addLine(interim);
  interim = '';
  teardown();
  if (recState !== 'idle') setRecState('idle');
}

function teardown() {
  const r = rec;
  rec = null;
  if (!r) return;
  r.onstart = null;
  r.onresult = null;
  r.onerror = null;
  r.onend = null;
  try { r.abort(); } catch { /* already stopped */ }
}

function toggleRecording() {
  if (recState === 'idle') startRecording();
  else stopRecording();
}

/* ---------- Add action (a dialog on top of the meeting) ---------- */

let addDialog;
let addForm;
let addFn = null;
let addClosedAt = 0;
let addSaving = false;
let addSaved = false; // the form is closing because its action was saved
let addFromKpi = null; // opened from beside a KPI's "Needs an action" (its key: '' or a KPI id), else null (the slide's own): focus goes back there

// A typed action that wasn't saved is kept for its function, as the Action
// register keeps its draft: Esc or Cancel keeps it, the form brings it back,
// Save clears it. Kept for this meeting only. `from` is the button it was
// typed from (a KPI key, or null for the slide's own), so the note sits there.
const drafts = new Map(); // fnId -> { text, owner, due, kpiId, from }

/** The kept draft for a function's Add action, or null. meeting.js says "Draft kept" beside the button. */
export const meetingDraftFor = (fnId) => (session && fnId ? drafts.get(fnId) ?? null : null);

/**
 * What one Add action button is for: "People", or "Quality, First pass yield" for the button
 * beside one KPI's "Needs an action" when the function has more than one KPI (kpiKey '' is
 * its own KPI, else an added KPI's id; null is the slide's own button).
 */
export function addTargetName(fn, kpiKey = null) {
  if (!fn) return '';
  if (kpiKey == null) return fn.name;
  const rows = kpiRowsFor(fn);
  if (rows.length < 2) return fn.name;
  const row = rows.find((k) => (k.primary ? '' : String(k.kpiId ?? '')) === kpiKey);
  return row ? `${fn.name}, ${plainLabel(row.kpiDaily)}` : fn.name;
}

/** The words beside a slide's Add action while a draft is kept: "Draft kept for People." */
export const draftWords = (fn, kpiKey = null) => `Draft kept for ${addTargetName(fn, kpiKey)}.`;

const PLUS = '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 4.5v11M4.5 10h11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
export const addActionIcon = PLUS;

function buildAddDialog(host) {
  addDialog = document.createElement('dialog');
  addDialog.className = 'ma';
  addDialog.setAttribute('aria-labelledby', 'ma-title');
  addDialog.setAttribute('aria-describedby', 'ma-sub');
  addDialog.innerHTML = `
    <form class="ma-form" novalidate>
      <header class="ma-head">
        <h2 class="ma-title" id="ma-title"></h2>
        <p class="ma-sub" id="ma-sub"></p>
      </header>
      <div class="ma-field" data-ma-kpi-field hidden>
        <label class="ma-label" for="ma-kpi">Measure</label>
        <span class="ma-pick"><select class="ma-input ma-select" id="ma-kpi" name="kpiId"></select></span>
      </div>
      <div class="ma-field">
        <label class="ma-label" for="ma-text">Action</label>
        <textarea class="ma-input ma-textarea" id="ma-text" name="text" rows="3" maxlength="400" required></textarea>
        <p class="ma-error" id="ma-text-error" data-msg="Write the action first." hidden></p>
      </div>
      <div class="ma-row">
        <div class="ma-field">
          <label class="ma-label" for="ma-owner">Owner</label>
          <input class="ma-input" id="ma-owner" name="owner" type="text" list="ma-owners" maxlength="80" autocomplete="off" required>
          <datalist id="ma-owners"></datalist>
          <p class="ma-error" id="ma-owner-error" data-msg="Name who owns it." hidden></p>
        </div>
        <div class="ma-field">
          <label class="ma-label" for="ma-due">Due date</label>
          <input class="ma-input" id="ma-due" name="due" type="date" required>
          <p class="ma-error" id="ma-due-error" data-msg="Pick a due date." hidden></p>
        </div>
      </div>
      <p class="ma-form-error" data-ma-error role="alert" hidden></p>
      <div class="ma-actions">
        <button class="btn btn--secondary" type="button" data-ma-cancel>Cancel</button>
        <button class="btn btn--primary" type="submit">Save action</button>
      </div>
    </form>`;
  host.append(addDialog);
  addForm = addDialog.querySelector('form');

  addForm.addEventListener('submit', (e) => { e.preventDefault(); saveAction(); });
  addDialog.querySelector('[data-ma-cancel]').addEventListener('click', () => addDialog.close());
  addDialog.addEventListener('cancel', () => { addClosedAt = Date.now(); });
  // A click outside the form closes it, unless an action is typed (a stray click never loses it).
  addDialog.addEventListener('click', (e) => {
    if (e.target !== addDialog) return;
    if (addForm.querySelector('#ma-text').value.trim()) return;
    addDialog.close();
  });
  addDialog.addEventListener('close', () => {
    addClosedAt = Date.now();
    const fn = addFn;
    const saved = addSaved;
    addFn = null;
    addSaved = false;
    const fromKpi = addFromKpi;
    addFromKpi = null;
    if (!session) { drafts.clear(); return; } // the meeting ended under the form
    // Esc or Cancel with words typed: the draft is kept for this function, beside the button it came from, and said so.
    const before = fn ? drafts.get(fn.id) ?? null : null;
    const kept = fn && !saved ? keepDraft(fn, fromKpi) : false;
    const after = fn ? drafts.get(fn.id) ?? null : null;
    // The slide shows "Draft kept" beside that Add action, moves it there, or drops it.
    if (fn && (Boolean(before) !== Boolean(after) || (before && after && (before.from ?? null) !== (after.from ?? null)))) {
      meetingApi?.relayout?.();
    }
    // Back to the Add action button it was opened from (the slide may have re-rendered) while it
    // still shows, else the slide's first (after a save, its "Needs an action" may be gone).
    const sel = fn ? `#meeting [data-meeting-add="${CSS.escape(fn.id)}"]` : null;
    const same = !sel ? null
      : fromKpi == null ? document.querySelector(`${sel}:not([data-meeting-add-kpi])`)
        : document.querySelector(`${sel}[data-meeting-add-kpi="${CSS.escape(fromKpi)}"]`);
    // A button folded away with its measure ("2 more measures on the board") doesn't count.
    const shown = (b) => (b && !b.closest('[hidden]') ? b : null);
    const btn = shown(same) ?? (sel ? [...document.querySelectorAll(sel)].find((b) => shown(b)) ?? null : null);
    if (btn) btn.focus({ preventScroll: true });
    else document.querySelector('#meeting [data-next-slide]')?.focus({ preventScroll: true });
    if (kept && recAnnounce) {
      // The same words as the note beside the button.
      const words = document.getElementById('m-draft')?.textContent || draftWords(fn, fromKpi);
      recAnnounce.textContent = '';
      requestAnimationFrame(() => { recAnnounce.textContent = words; });
    }
  });
  // Ctrl or Cmd + Enter saves from the text box.
  addForm.querySelector('#ma-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addForm.requestSubmit(); }
  });
  addForm.addEventListener('input', (e) => {
    const field = e.target.closest('.ma-field');
    if (field && e.target.value.trim()) showFieldError(e.target, false);
  });
}

/**
 * Keep what's typed in the form for `fn` (true), or drop its draft when the action box is empty
 * (false). `from` is the Add action button it was opened from (a KPI key, or null for the slide's own).
 */
function keepDraft(fn, from = null) {
  const text = addForm.querySelector('#ma-text').value;
  if (!text.trim()) { drafts.delete(fn.id); persistSession(); return false; }
  const kpiField = addForm.querySelector('[data-ma-kpi-field]');
  drafts.set(fn.id, {
    text,
    owner: addForm.querySelector('#ma-owner').value,
    due: addForm.querySelector('#ma-due').value,
    kpiId: kpiField.hidden ? null : addForm.querySelector('#ma-kpi').value,
    from: typeof from === 'string' ? from : null,
  });
  persistSession();
  return true;
}

/**
 * A field's error shows with its words and describes the field; once fixed (or the form reopens)
 * it is hidden, emptied and no longer named by aria-describedby, so a screen reader never hears
 * "Name who owns it." over a field that holds a name.
 */
function showFieldError(input, on) {
  const msg = document.getElementById(`${input.id}-error`);
  if (msg) {
    msg.textContent = on ? msg.dataset.msg ?? '' : '';
    msg.hidden = !on;
  }
  if (on && msg) input.setAttribute('aria-describedby', msg.id); else input.removeAttribute('aria-describedby');
  if (on) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
}

function openAddAction(fnId, kpiKey = null) {
  if (!session || !addDialog || addDialog.open) return;
  const fn = session.month?.functions.find((f) => f.id === fnId);
  if (!fn) return;
  addFn = fn;
  addFromKpi = kpiKey;
  addSaving = false;
  const owner = ownerFor(fn).name;
  addDialog.querySelector('#ma-title').textContent = `Add action for ${fn.name}`;
  addDialog.querySelector('#ma-sub').textContent = 'It goes to the Action register and these meeting minutes.';
  // "Measure" when the function has KPIs added in Board setup (as in the Action
  // register). It starts on the first one that needs an action, else the main one.
  // A draft kept from an earlier Esc or Cancel comes back as it was left.
  const draft = drafts.get(fn.id) ?? null;
  const rows = kpiRowsFor(fn);
  const kpiField = addForm.querySelector('[data-ma-kpi-field]');
  const kpiSelect = addForm.querySelector('#ma-kpi');
  kpiField.hidden = rows.length < 2;
  if (rows.length > 1) {
    const keyOf = (k) => (k.primary ? '' : String(k.kpiId ?? ''));
    let pick = '';
    for (const k of rows) {
      let state = null;
      try { state = actionStateFor(session.month, fn, k, session.day).state; } catch { state = null; }
      if (state === 'needs') { pick = keyOf(k); break; }
    }
    if (draft?.kpiId != null && rows.some((k) => keyOf(k) === draft.kpiId)) pick = draft.kpiId;
    // Opened from beside a KPI's "Needs an action": that KPI (a draft kept from this same button keeps the measure it was left on).
    const sameButton = Boolean(draft) && (draft.from ?? null) === kpiKey;
    if (kpiKey != null && !sameButton && rows.some((k) => keyOf(k) === kpiKey)) pick = kpiKey;
    kpiSelect.innerHTML = rows.map((k) => `<option value="${esc(keyOf(k))}"${keyOf(k) === pick ? ' selected' : ''}>${esc(plainLabel(k.kpiDaily))}</option>`).join('');
  } else {
    kpiSelect.innerHTML = '';
  }
  const text = addForm.querySelector('#ma-text');
  const ownerInput = addForm.querySelector('#ma-owner');
  const due = addForm.querySelector('#ma-due');
  text.value = draft?.text ?? '';
  ownerInput.value = draft ? draft.owner : owner;
  const owners = [...new Set(session.month.functions.map((f) => ownerFor(f).name).filter(Boolean))];
  addForm.querySelector('#ma-owners').innerHTML = owners.map((n) => `<option value="${esc(n)}"></option>`).join('');
  const boardDay = isoToDate(session.dayIso);
  if (boardDay) {
    // The next production day after the board day (Fri, Feb 27 gives Mon, Mar 2).
    let next = null;
    try { next = typeof register.nextProductionDayIso === 'function' ? register.nextProductionDayIso(session.month, session.day) : null; } catch { next = null; }
    due.value = next && isoToDate(next) ? next : dateToIso(new Date(boardDay.getTime() + 86400000));
    due.min = session.dayIso;
    // The draft's due date, unless it's now before the board day.
    if (draft && ISO_RE.test(draft.due) && draft.due >= session.dayIso) due.value = draft.due;
  } else {
    due.value = draft && ISO_RE.test(draft.due) ? draft.due : '';
    due.removeAttribute('min');
  }
  [text, ownerInput, due].forEach((i) => showFieldError(i, false));
  const formError = addForm.querySelector('[data-ma-error]');
  formError.hidden = true;
  formError.textContent = '';
  addDialog.showModal();
  text.focus();
  // A kept draft: the cursor goes to the end of its words, ready to finish them.
  if (draft) text.setSelectionRange(text.value.length, text.value.length);
}

async function saveAction() {
  if (!addFn || !session || addSaving) return;
  const text = addForm.querySelector('#ma-text');
  const ownerInput = addForm.querySelector('#ma-owner');
  const due = addForm.querySelector('#ma-due');
  const checks = [
    [text, text.value.trim() !== ''],
    [ownerInput, ownerInput.value.trim() !== ''],
    [due, ISO_RE.test(due.value)],
  ];
  checks.forEach(([input, ok]) => showFieldError(input, !ok));
  const firstBad = checks.find(([, ok]) => !ok);
  if (firstBad) { firstBad[0].focus(); return; }

  const fn = addFn;
  const kpiSelect = addForm.querySelector('#ma-kpi');
  const action = {
    fnId: fn.id,
    // The Measure picked (a KPI added in Board setup), or null for the function's workbook KPI.
    kpiId: addForm.querySelector('[data-ma-kpi-field]').hidden ? null : (kpiSelect.value || null),
    text: text.value.trim(),
    owner: ownerInput.value.trim(),
    due: due.value,
    status: 'open',
    source: 'meeting',
    meetingId: session.id,
    dayIso: session.dayIso,
  };
  addSaving = true;
  // Did this action clear the last off-goal KPI with no action? Then the toast says so.
  const before = needsNow();
  let result;
  try {
    result = ctx.addAction(action);
    if (result && typeof result.then === 'function') result = await result;
  } catch {
    addSaving = false;
    const formError = addForm.querySelector('[data-ma-error]');
    formError.textContent = "The action wasn't saved. Try Save action again.";
    formError.hidden = false;
    return;
  }
  addSaving = false;
  if (!session) return; // the meeting ended while saving
  const id = typeof result === 'string' ? result : (result && typeof result === 'object' && result.id != null ? String(result.id) : null);
  session.actions.push({ id, fnId: fn.id, kpiId: action.kpiId, fnName: fn.name, text: action.text, owner: action.owner, due: action.due, status: 'open' });
  // Saved: its draft is done with (and goes from the stored meeting with it).
  drafts.delete(fn.id);
  persistSession();
  renderCount();
  addSaved = true;
  // The slide lists the function's actions: redraw it now, so the new one shows.
  meetingApi?.relayout?.();
  addDialog.close();
  // Kept for this visit only when this browser isn't saving: said the way the Action register says it.
  const stored = id == null || storedInRegister(id);
  if (clearedNeeds(before, needsNow())) {
    ctx.toast(stored ? ALL_CLEAR_ADDED : `${ALL_CLEAR_ADDED} ${NOT_SAVING}`, { duration: stored ? 6000 : 8000 });
    return;
  }
  // Name the measure when it's one added in Board setup: "Action added for People (Absenteeism)."
  const measure = action.kpiId ? kpiRowsFor(fn).find((k) => !k.primary && k.kpiId === action.kpiId) : null;
  const added = `Action added for ${fn.name}${measure ? ` (${plainLabel(measure.kpiDaily)})` : ''}`;
  // Short: the meeting moves on, and the message mustn't ride along onto the next slides.
  if (stored) ctx.toast(`${added}.`, { duration: 4000 });
  else ctx.toast(`${added} for this visit. ${NOT_SAVING}`, { duration: 8000 });
}

/** The Action register's words when this browser refuses to keep what's added. */
const NOT_SAVING = "This browser isn't saving, so it will clear when the page reloads.";

/** True when the Action register's copy on this device holds the action (false when this browser isn't saving). */
function storedInRegister(id) {
  const raw = safeGet(local(), 'dor.actions.v1'); // the register's key (js/actions.js)
  try {
    const list = JSON.parse(raw ?? 'null');
    return Array.isArray(list) && list.some((a) => a && String(a.id) === String(id));
  } catch {
    return false;
  }
}

/** board.js needsSummary for the meeting's board day (null when it can't be read). */
function needsNow() {
  try {
    return needsSummary(ctx.getMonth?.() ?? session.month, session.day);
  } catch {
    return null;
  }
}

/* ---------- Minutes sheet ---------- */

let sheet;
let returnFocus = null;
let shownId = null; // the meeting on screen, or null for the list

const CLOSE_ICON = '<svg class="icon" aria-hidden="true" focusable="false"><use href="#g-close"></use></svg>';
const PREV_ICON = '<svg class="icon" aria-hidden="true" focusable="false"><use href="#g-prev"></use></svg>';
const NEXT_ICON = '<svg class="icon mn-item-chevron" aria-hidden="true" focusable="false"><use href="#g-next"></use></svg>';

function buildSheet() {
  sheet = document.createElement('dialog');
  sheet.className = 'sheet mn-sheet';
  sheet.id = 'minutes';
  sheet.setAttribute('aria-labelledby', 'mn-title');
  document.body.append(sheet);
  sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeMinutes(); });
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) { closeMinutes(); return; } // the dimmed area beside the panel
    const btn = e.target.closest('button, a');
    if (!btn) return;
    if (btn.matches('[data-mn-close]')) closeMinutes();
    else if (btn.matches('[data-mn-open]')) showMeeting(btn.dataset.mnOpen);
    else if (btn.matches('[data-mn-back]')) showList(shownId);
    else if (btn.matches('[data-mn-copy]')) copyMinutes(shownId);
    else if (btn.matches('[data-mn-print]')) printMinutes(shownId);
    else if (btn.matches('[data-mn-delete]')) deleteMinutes(shownId);
    else if (btn.matches('[data-mn-register]')) openRegister();
    else if (btn.matches('[data-run-meeting]')) closeMinutes({ restore: false }); // app.js starts the meeting
  });
  // Run meeting from a sheet (the minutes' empty state): every sheet steps aside
  // first, so the meeting is on top and its keys work. app.js then starts the
  // meeting from this same click (full screen needs it). The Action register
  // closes itself (actions.js); Detail and Customize close with the route.
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('[data-run-meeting]')) return;
    if (sheet.open) closeMinutes({ restore: false });
    const setup = document.querySelector('dialog#setup[open]');
    if (setup) {
      // Its own Close, so a half-typed change is saved first.
      const close = setup.querySelector('[data-close]');
      if (close) close.click(); else setup.close();
    }
  }, true);
}

/**
 * Open the minutes sheet: one meeting's minutes, or the list of saved
 * meetings (newest first) when no id is given.
 */
export function openMinutes(meetingId) {
  if (!sheet) return;
  const id = typeof meetingId === 'string' ? meetingId : null; // ignore event objects
  if (!sheet.open) {
    const active = document.activeElement;
    returnFocus = active && active !== document.body && !sheet.contains(active) ? active : null;
    // Over another sheet (the Action register): be last in the page, so toasts land in this one.
    if (document.querySelector('dialog[open]')) document.body.append(sheet);
    sheet.showModal();
  }
  if (id) showMeeting(id); else showList();
}

function closeMinutes({ restore = true } = {}) {
  if (!sheet?.open) return;
  sheet.close();
  shownId = null;
  const back = returnFocus;
  returnFocus = null;
  if (!restore) return;
  const usable = (el) => el && el.isConnected && !el.closest('[inert]') && (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null);
  if (usable(back)) back.focus({ preventScroll: true });
  else {
    const fallback = [...document.querySelectorAll('[data-topbar-more], #board')].find(usable);
    fallback?.focus({ preventScroll: true });
  }
}

/** Draw the sheet's content. A message showing in the sheet (its toast region) stays put. */
function paintSheet(html) {
  const toasts = sheet.querySelector(':scope > [data-toasts]');
  sheet.innerHTML = html;
  if (toasts) sheet.append(toasts);
  // The panel's scroll padding is the title bar's real height (measured again when it changes size).
  fitSheetHead(sheet);
}

function focusTitle() {
  // One meeting's minutes: the "Held … for the … board" line describes the sheet.
  if (sheet.querySelector('#mn-head-sub')) sheet.setAttribute('aria-describedby', 'mn-head-sub');
  else sheet.removeAttribute('aria-describedby');
  sheet.querySelector('.sheet-panel')?.scrollTo?.(0, 0);
  sheet.querySelector('#mn-title')?.focus({ preventScroll: true });
}

/** One line for the next minutes shown: "Saved on this device." right after End meeting (or that it isn't saving). */
let headNote = null;

function sheetHead(titleHtml, closeName, subText = '', note = null) {
  return `
    <header class="sheet-head mn-head">
      <div class="mn-head-text">
        <h2 class="sheet-title mn-title" id="mn-title" tabindex="-1">${titleHtml}</h2>
        ${subText ? `<p class="mn-head-sub" id="mn-head-sub">${esc(subText)}</p>` : ''}
        ${note ? `<p class="mn-head-note${note.warn ? ' is-warn' : ''}" role="status">${esc(note.text)}</p>` : ''}
      </div>
      <div class="sheet-tools">
        <button class="icon-btn sheet-close" type="button" data-mn-close aria-label="${esc(closeName)}">${CLOSE_ICON}</button>
      </div>
    </header>`;
}

/** "Fri, Feb 27" for the board day the meeting reviewed (the year only when it isn't this year). */
function boardDayText(iso) {
  const d = isoToDate(iso);
  if (!d) return '';
  return d.getUTCFullYear() === new Date().getFullYear() ? medDay(iso) : longDay(iso);
}

/**
 * "Held Tue, Oct 13, 12:41 AM for the Fri, Feb 27 board": when the meeting
 * ran and which board day it reviewed, in one line, so the two dates never
 * read as one. ("Held", not "Recorded": a meeting can run without Record.)
 */
function recordedLine(r) {
  // Each date stays on one line ("Fri, Feb 27", "1:24 AM").
  const keep = (t) => t.replace(/, (?=\d{1,2}:)/, ',\u2009').replace(/ /g, '\u00a0').replace(/,\u2009/, ', ');
  const when = keep(whenStarted(r.startedAt));
  const board = keep(boardDayText(r.dayIso));
  if (when && board) return `Held ${when} for the ${board} board`;
  if (when) return `Held ${when}`;
  return board ? `For the ${board} board` : '';
}

/** "Held Tue, Oct 13, 12:41 AM · 3 min 2 sec" for the list of meetings. */
function metaLine(r) {
  const parts = [];
  const when = whenStarted(r.startedAt);
  if (when) parts.push(`Held ${when}`);
  parts.push(durationWords(r.durationSec));
  return parts.join('\u00a0· ');
}

function showList(focusId = null) {
  shownId = null;
  const list = newestFirst(readMeetings());
  const items = list.map((r) => {
    const n = Math.max(r.actions.length, r.actionIds.length);
    const meta = [metaLine(r), plural(n, 'action', 'actions')].join('\u00a0· ');
    const board = boardDayText(r.dayIso);
    return `<li><button class="mn-item" type="button" data-mn-open="${esc(r.id)}">
        <span class="mn-item-text"><span class="mn-item-date">${esc(board ? `${board} board` : 'Meeting')}</span><span class="mn-item-meta">${esc(meta)}</span></span>${NEXT_ICON}
      </button></li>`;
  }).join('');
  paintSheet(`
    <div class="sheet-panel">
      ${sheetHead('Meeting minutes', 'Close meeting minutes')}
      <div class="sheet-body mn-body">
        ${list.length
          ? `<p class="mn-intro">Saved on this device, newest first. Each opens its minutes.</p>
             <ul class="mn-list" aria-label="Saved meetings">${items}</ul>`
          : `<div class="mn-empty">
               <p class="mn-empty-text">No meetings yet. Run meeting records the minutes here.</p>
               <a class="btn btn--primary mn-empty-run" href="#meeting/0" data-run-meeting>Run meeting</a>
             </div>`}
      </div>
    </div>`);
  const target = focusId ? sheet.querySelector(`[data-mn-open="${CSS.escape(focusId)}"]`) : null;
  if (target) target.focus({ preventScroll: false });
  else focusTitle();
}

/* ---------- One meeting's minutes ---------- */

const KNOWN_STATUS = ['on', 'off', 'not-entered', 'no-goal', 'no-production', 'not-tracked'];

function statusCell(label, c, { measure = true } = {}) {
  if (!c) return '';
  const status = KNOWN_STATUS.includes(c.status) ? c.status : 'not-entered';
  const fig = c.actual !== null && c.actual !== undefined
    ? `<p class="mn-fig"><span class="mn-fig-actual">${esc(c.actual)}</span>${c.rest ? ` <span class="mn-fig-rest">${esc(c.rest)}</span>` : ''}</p>`
    : c.rest ? `<p class="mn-fig mn-fig--empty">${esc(c.rest)}</p>` : '';
  return `<div class="mn-cell" data-status="${status}">
      <p class="mn-cell-label">${esc(label)}</p>
      ${statusMarkup(status, { word: c.word })}
      ${fig}
      ${measure || c.note ? `<p class="mn-measure">${measure ? esc(c.measure) : ''}${c.note ? `<span class="mn-note">${measure ? ', ' : ''}${esc(c.note)}</span>` : ''}</p>` : ''}
    </div>`;
}

/** The board's empty-note words, in today's words (older minutes kept older ones). */
const OLD_WORDS = new Map([
  ['No problem reported', 'No issue reported'],
  ['Not recorded for this day', ACTION_WORD.nothing],
  ['No action entered', ACTION_WORD.notYet],
]);
const noteWords = (n) => { const t = String(n?.text ?? ''); return OLD_WORDS.get(t) ?? t; };
const ACTION_LABEL = 'Action, next 24 hours';
const noteHtml = (label, n) => `<div><dt>${label}</dt><dd class="${n?.empty ? 'is-empty' : ''}">${esc(noteWords(n))}</dd></div>`;
const NO_NOTE = { text: ACTION_WORD.nothing, empty: true };
/** A row's issue; off goal with no problem written, only a red line saying the issue is owed (as on the slide). */
const issueHtml = (row) => (row.issueGap
  ? `<div><dt>Issue</dt><dd class="mn-issue-gap">${statusMarkup(OFF, { tag: 'span', word: ISSUE_GAP_WORD })}</dd></div>`
  : noteHtml('Issue', row.issue ?? NO_NOTE));

/**
 * A KPI row's action in the board's words. Newer minutes kept it when the
 * meeting ended (act); older ones are worked out from what they kept: the
 * board's note, this meeting's actions, and whether the row was off goal.
 * -> { state: 'has' | 'needs' | 'none' | 'nothing', text, word, assigned }
 */
function rowAction(row, legacyAssigned = []) {
  if (row.act) return row.act;
  const text = row.action && !row.action.empty ? noteWords(row.action) : null;
  if (text || legacyAssigned.length) return { state: 'has', text, word: '', assigned: legacyAssigned };
  const unrecorded = /^(Not recorded for this day|Nothing recorded)$/.test(String(row.action?.text ?? ''));
  if (unrecorded || !row.action) return { state: 'nothing', text: null, word: ACTION_WORD.nothing, assigned: [] };
  const off = row.day?.status === OFF || row.month?.status === OFF;
  return off
    ? { state: 'needs', text: null, word: ACTION_WORD.needs, assigned: [] }
    : { state: 'none', text: null, word: ACTION_WORD.none, assigned: [] };
}

/** "Done Fri, Feb 27" for a done action, as the board and the register say it ('' when the day isn't known). */
const closedWords = (a) => (isoToDate(a.closedDayIso) ? `Done ${medDay(a.closedDayIso)}` : '');
/** "Done:" with the on-track glyph, before a closed action's words. */
const doneMark = () => `<span class="mn-done">${glyphMarkup(ON)}Done:</span> `;

/**
 * One assigned action in the minutes: the words, then owner and due date
 * ("Added in this meeting" when it was). A done one reads "Done: …" and the day it was closed.
 */
function assignedItem(a, meetingId) {
  const mine = Boolean(meetingId) && a.meetingId === meetingId;
  const sep = '<span aria-hidden="true"> · </span><span class="sr-only">, </span>';
  const done = a.status === 'closed';
  const when = done ? closedWords(a) : dueWords(a.due);
  return `<li><span class="mn-alist-text">${done ? doneMark() : ''}${esc(a.text)}</span> <span class="mn-alist-meta">${esc(a.owner || 'No owner named')}${when ? `${sep}${esc(when)}` : ''}${mine ? `${sep}<span class="mn-alist-mine">Added in this meeting</span>` : ''}</span></li>`;
}

/**
 * "Action, next 24 hours" as the board says it: the workbook's action and the
 * open Action register actions, "Needs an action" in red when nobody had
 * picked up a miss, or the quiet word ("None needed", "Nothing recorded").
 */
function actionHtml(act, meetingId) {
  if (act.state === 'needs') {
    return `<div><dt>${ACTION_LABEL}</dt><dd class="mn-needs-cell">${statusMarkup(OFF, { tag: 'span', word: ACTION_WORD.needs })}</dd></div>`;
  }
  if (act.state !== 'has') return `<div><dt>${ACTION_LABEL}</dt><dd class="is-empty">${esc(act.word || ACTION_WORD.nothing)}</dd></div>`;
  const note = act.text ? `<dd>${esc(act.text)}</dd>` : '';
  const list = act.assigned.length
    ? `<dd class="mn-assigned"><ul class="mn-alist">${act.assigned.map((a) => assignedItem(a, meetingId)).join('')}</ul></dd>`
    : '';
  return `<div><dt>${ACTION_LABEL}</dt>${note}${list}</div>`;
}

/** Issue and action for one KPI row (one quiet line when nothing was recorded for it). */
function rowNotesHtml(row, act, meetingId) {
  if (act.state === 'nothing' && (!row.issue || row.issue.empty)) {
    return `<dl class="mn-notes"><div><dt>Issue and action</dt><dd class="is-empty">${esc(ACTION_WORD.nothing)}</dd></div></dl>`;
  }
  return `<dl class="mn-notes">${issueHtml(row)}${actionHtml(act, meetingId)}</dl>`;
}

/** This meeting's actions by KPI row: "fnId|" for a function's main KPI, "fnId|kpiId" for an added one. */
const rowKey = (fnId, kpiId) => `${fnId}|${kpiId ?? ''}`;
function actionsByRow(actions) {
  const map = new Map();
  for (const a of actions) {
    if (!a.fnId) continue;
    const key = rowKey(a.fnId, a.kpiId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(a);
  }
  return map;
}

function functionHtml(s, f, i, byRow = new Map(), meetingId = null) {
  const [primary, ...extras] = f.rows;
  // Older minutes didn't keep each row's actions: this meeting's actions stand in.
  const legacy = (row) => (row.primary || row.kpiId ? byRow.get(rowKey(f.id, row.primary ? null : row.kpiId)) ?? [] : []);
  const extraHtml = extras.length
    ? `<div class="mn-extras">
         <p class="mn-extras-title">More measures</p>
         <ul class="mn-extra-list">${extras.map((r) => `
           <li class="mn-extra">
             <p class="mn-extra-name">${esc(r.name)}</p>
             <div class="mn-pair mn-pair--compact">${statusCell(s.dayLabel, r.day, { measure: r.day?.measure !== r.name })}${statusCell(s.monthLabel, r.month, { measure: r.month?.measure !== r.name })}</div>
             ${rowNotesHtml(r, rowAction(r, legacy(r)), meetingId)}
           </li>`).join('')}</ul>
       </div>`
    : '';
  return `<li class="mn-fn">
      <div class="mn-fn-head">
        <h4 class="mn-fn-name"><span class="mn-fn-num">${i + 1}</span>${esc(f.name)}</h4>
        <p class="mn-fn-owner">${esc(f.owner)}</p>
      </div>
      ${primary ? `<div class="mn-pair">${statusCell(s.dayLabel, primary.day)}${statusCell(s.monthLabel, primary.month)}</div>
      <dl class="mn-notes">${issueHtml(primary)}${actionHtml(rowAction(primary, legacy(primary)), meetingId)}</dl>` : ''}
      ${extraHtml}
    </li>`;
}

// The register's words: Open, In progress, Done (a done action is stored as 'closed'; its date line reads "Done Fri, Feb 27").
const REG_STATUS_WORD = { open: 'Open', 'in-progress': 'In progress', done: 'Done', closed: 'Done' };
const actionWord = (status) => REG_STATUS_WORD[status] ?? (status ? String(status).charAt(0).toUpperCase() + String(status).slice(1) : 'Open');

/** Actions from the register for this meeting, plus any it doesn't have. */
function actionsFor(r) {
  let live = [];
  try {
    const all = typeof register.listActions === 'function' ? register.listActions() : [];
    live = Array.isArray(all) ? all.filter((a) => a && a.meetingId === r.id) : [];
  } catch { live = []; }
  const names = new Map((r.snapshot?.functions ?? []).map((f) => [f.id, f.name]));
  // An action for a KPI added in Board setup names that KPI too.
  const kpiNames = new Map();
  for (const f of r.snapshot?.functions ?? []) for (const row of f.rows) if (row.kpiId) kpiNames.set(rowKey(f.id, row.kpiId), row.name);
  const kpiName = (a) => (a.kpiId ? kpiNames.get(rowKey(a.fnId, a.kpiId)) ?? '' : '');
  const out = live.map((a) => ({
    fnId: a.fnId ?? null,
    kpiId: a.kpiId ?? null,
    kpiName: kpiName(a),
    fnName: names.get(a.fnId) ?? a.fnName ?? '',
    text: a.text, owner: a.owner, due: a.due, status: actionWord(a.status), statusKey: a.status, fromRegister: true,
    closedDayIso: typeof a.closedDayIso === 'string' ? a.closedDayIso : null,
  }));
  const liveIds = new Set(live.map((a) => String(a.id)));
  for (const a of r.actions ?? []) {
    if (a.id && liveIds.has(String(a.id))) continue;
    out.push({
      fnId: a.fnId ?? null,
      kpiId: a.kpiId ?? null,
      kpiName: kpiName(a),
      fnName: a.fnName || names.get(a.fnId) || '',
      text: a.text, owner: a.owner, due: a.due,
      status: a.id ? 'No longer in the Action register' : 'Kept in these minutes only',
      fromRegister: false,
    });
  }
  return out;
}

const dueWords = (due) => (isoToDate(due) ? `Due ${medDay(due)}` : due ? `Due ${due}` : 'No due date');

function offGoalNames(s) {
  if (Array.isArray(s?.offGoal)) return s.offGoal;
  return (s?.functions ?? []).filter((f) => f.rows?.some((r) => r.day?.status === OFF)).map((f) => f.name);
}

function transcriptEmptyText(r) {
  return r.recorded
    ? "No recording. Record was on, but it didn't hear any speech."
    : 'No recording. Press Record during a meeting to keep a transcript here.';
}

/** The same, for copied or printed minutes: a statement, never a button to press. */
const transcriptEmptyPlain = (r) => (r.recorded ? 'Recorded, but no speech was heard.' : 'Not recorded.');

/** "Riverside plant" (a name typed as "Riverside Plant" doesn't become "Riverside Plant plant"). */
const plantWords = (plant) => (plant ? `${String(plant).replace(/\s+plant$/i, '')} plant` : '');

/** "2 off-goal KPIs have no action yet: People, Operations." from the minutes' snapshot ('' when it didn't keep one). */
function needsText(needs) {
  if (!needs) return '';
  if (needs.list.length) return `${needs.lead || 'Off-goal KPIs with no action yet:'} ${needs.list.join(', ')}.`;
  return needs.allClear ? needs.text : '';
}

/** The same line as the meeting's summary slide: red off glyph for the list, green on glyph for the all-clear. */
function needsHtml(needs) {
  if (!needs) return '';
  if (needs.list.length) {
    return `<p class="mn-needs">${glyphMarkup(OFF)}<span><span class="mn-needs-lead">${esc(needs.lead || 'Off-goal KPIs with no action yet:')}</span> ${esc(needs.list.join(', '))}.</span></p>`;
  }
  return needs.allClear ? `<p class="mn-needs mn-needs--clear">${glyphMarkup(ON)}<span class="mn-needs-lead">${esc(needs.text)}</span></p>` : '';
}

/** Every function was removed in Board setup when the meeting ran: one line, never "0 of 0". */
const NO_FUNCTIONS = 'Every function was hidden in Board setup, so there was nothing to review.';
const noFunctions = (s) => Boolean(s) && !s.functions.length;

function minutesBody(r, { print = false } = {}) {
  const s = r.snapshot;
  const actions = actionsFor(r);
  const byRow = actionsByRow(actions);
  const off = offGoalNames(s);
  const lines = r.transcript;
  const transcriptList = lines.length
    ? `<ol class="mn-lines">${lines.map((l) => `<li><span class="mn-at">${esc(clock(l.at))}</span><span class="mn-line-text">${esc(l.text)}</span></li>`).join('')}</ol>`
    : `<p class="mn-quiet">${esc(print ? transcriptEmptyPlain(r) : transcriptEmptyText(r))}</p>`;
  const kpiTag = (a) => (a.kpiName ? `<span class="mn-action-kpi">${esc(a.kpiName)}</span>${SEP}` : '');

  return `
    <p class="mn-meta">Length: ${esc(durationWords(r.durationSec))}</p>
    <p class="mn-honest">${esc(honestLine(r))}</p>
    ${print ? '' : `<div class="mn-tools">
      <button class="btn btn--secondary" type="button" data-mn-copy>Copy as text</button>
      <button class="btn btn--secondary" type="button" data-mn-print>Print</button>
      <button class="btn btn--secondary mn-delete" type="button" data-mn-delete>Delete<span class="sr-only"> these minutes</span></button>
    </div>`}

    <section class="mn-section" aria-labelledby="mn-sec-summary">
      <h3 class="section-title" id="mn-sec-summary">Summary</h3>
      ${noFunctions(s) ? `<p class="mn-quiet">${esc(NO_FUNCTIONS)}</p>`
        : s ? `<p class="mn-summary">${esc(s.summary || 'The board as it read when the meeting ended.')}</p>
      ${off.length ? `<p class="mn-summary-off">Off goal: ${esc(off.join(', '))}.</p>` : ''}
      ${needsHtml(s.needs)}`
        : '<p class="mn-quiet">The board could not be read when this meeting ended.</p>'}
    </section>

    ${s && !noFunctions(s) ? `<section class="mn-section" aria-labelledby="mn-sec-fns">
      <h3 class="section-title" id="mn-sec-fns">By function</h3>
      <ol class="mn-fns">${s.functions.map((f, i) => functionHtml(s, f, i, byRow, r.id)).join('')}</ol>
    </section>` : ''}

    <section class="mn-section" aria-labelledby="mn-sec-actions">
      <div class="mn-section-head">
        <h3 class="section-title" id="mn-sec-actions">Actions assigned in this meeting</h3>
        ${print ? '' : '<button class="btn btn--secondary" type="button" data-mn-register>Open the Action register</button>'}
      </div>
      ${actions.length
        ? `<ul class="mn-actions">${actions.map((a) => `
            <li class="mn-action">
              <p class="mn-action-text">${a.fromRegister && a.statusKey === 'closed' ? doneMark() : ''}${esc(a.text)}</p>
              <p class="mn-action-meta">${a.fnName ? `<span class="mn-action-fn">${esc(a.fnName)}</span>${SEP}` : ''}${kpiTag(a)}Owner: ${esc(a.owner || 'Not set')}${SEP}${a.fromRegister && a.statusKey === 'closed'
                // Done: the day it was closed says it all.
                ? esc(closedWords(a) || 'Done')
                : `${esc(dueWords(a.due))}${SEP}${a.fromRegister && REG_STATUS_WORD[a.statusKey] && a.statusKey !== 'done' ? issueStatusMarkup(a.statusKey) : `<span class="mn-action-status${a.fromRegister ? '' : ' is-quiet'}">${esc(a.status)}</span>`}`}</p>
            </li>`).join('')}</ul>`
        : '<p class="mn-quiet">No actions were added in this meeting.</p>'}
    </section>

    <section class="mn-section" aria-labelledby="mn-sec-transcript">
      ${print || !lines.length
        ? `<h3 class="section-title" id="mn-sec-transcript">Transcript</h3>${transcriptList}`
        : `<details class="mn-transcript">
            <summary><h3 class="section-title mn-summary-title" id="mn-sec-transcript">Transcript</h3><span class="mn-count">${plural(lines.length, 'line', 'lines')}</span></summary>
            ${transcriptList}
          </details>`}
    </section>`;
}

function showMeeting(id) {
  const r = findMeeting(id);
  if (!r) {
    shownId = null;
    paintSheet(`
      <div class="sheet-panel">
        ${sheetHead('Meeting minutes', 'Close meeting minutes')}
        <div class="sheet-body mn-body">
          <p class="mn-empty-text">These minutes aren't on this device. They may have been deleted.</p>
          <p class="mn-back-row"><button class="btn btn--secondary" type="button" data-mn-back>${PREV_ICON}See all meetings</button></p>
        </div>
      </div>`);
    focusTitle();
    return;
  }
  shownId = r.id;
  // Shown once, on the minutes End meeting just saved.
  const note = headNote?.id === r.id ? headNote : null;
  headNote = null;
  paintSheet(`
    <div class="sheet-panel">
      ${sheetHead('Meeting minutes', 'Close minutes', recordedLine(r), note)}
      <div class="sheet-body mn-body">
        <p class="mn-back-row"><button class="btn btn--text mn-back" type="button" data-mn-back>${PREV_ICON}Back to all meetings</button></p>
        ${minutesBody(r)}
      </div>
    </div>`);
  focusTitle();
}

function openRegister() {
  closeMinutes({ restore: false });
  try {
    ctx.openActions?.();
  } catch {
    ctx.toast("The Action register couldn't open.");
  }
}

/* ---------- Copy, print, delete ---------- */

function cellText(c) {
  if (!c) return '';
  const fig = c.actual !== null && c.actual !== undefined ? `${c.actual}${c.rest ? ` ${c.rest}` : ''}` : c.rest;
  // "On track, 0.00 vs 3.50 goal · Recordable injury rate (TRIR)": no brackets around a name that has its own.
  return `${c.word}${fig ? `, ${fig}` : ''} · ${c.measure}${c.note ? `, ${c.note}` : ''}`;
}

const indent = (text, pad) => String(text ?? '').split('\n').join(`\n${pad}`);

function minutesText(r) {
  const s = r.snapshot;
  const out = [];
  const plantLine = plantWords(s?.plant);
  out.push(`${plantLine ? `${plantLine}, ` : ''}Daily Operating Review`);
  out.push('Meeting minutes');
  const recorded = recordedLine(r);
  if (recorded) out.push(recorded);
  out.push(`Length: ${durationWords(r.durationSec)}`);
  out.push(honestLine(r));
  out.push('');
  out.push('SUMMARY');
  if (noFunctions(s)) {
    out.push(NO_FUNCTIONS);
  } else if (s) {
    if (s.summary) out.push(s.summary);
    const off = offGoalNames(s);
    if (off.length) out.push(`Off goal: ${off.join(', ')}.`);
    const needs = needsText(s.needs);
    if (needs) out.push(needs);
    out.push('');
    out.push('BY FUNCTION');
    const byRow = actionsByRow(actionsFor(r));
    s.functions.forEach((f, i) => {
      out.push(`${i + 1}. ${f.name}, ${f.owner}`);
      f.rows.forEach((row) => {
        const pad = row.primary ? '   ' : '      ';
        if (!row.primary) out.push(`   ${row.name}`);
        out.push(`${pad}${s.dayLabel}: ${cellText(row.day)}`);
        out.push(`${pad}${s.monthLabel}: ${cellText(row.month)}`);
        const legacy = row.primary || row.kpiId ? byRow.get(rowKey(f.id, row.primary ? null : row.kpiId)) ?? [] : [];
        const act = rowAction(row, legacy);
        if (!row.primary && act.state === 'nothing' && (!row.issue || row.issue.empty)) {
          out.push(`${pad}Issue and action: ${ACTION_WORD.nothing}`);
          return;
        }
        out.push(`${pad}Issue: ${row.issueGap ? ISSUE_GAP_WORD : indent(noteWords(row.issue ?? NO_NOTE), `${pad}  `)}`);
        if (act.state === 'has') {
          out.push(`${pad}${ACTION_LABEL}:${act.text ? ` ${indent(act.text, `${pad}  `)}` : ''}`);
          act.assigned.forEach((a) => {
            const done = a.status === 'closed';
            const when = done ? closedWords(a) : dueWords(a.due);
            out.push(`${pad}  - ${done ? 'Done: ' : ''}${a.text} (${a.owner || 'No owner named'}${when ? `, ${when}` : ''}${a.meetingId && a.meetingId === r.id ? ', added in this meeting' : ''})`);
          });
        } else {
          out.push(`${pad}${ACTION_LABEL}: ${act.state === 'needs' ? ACTION_WORD.needs : act.word || ACTION_WORD.nothing}`);
        }
      });
    });
  } else {
    out.push('The board could not be read when this meeting ended.');
  }
  out.push('');
  out.push('ACTIONS ASSIGNED IN THIS MEETING');
  const actions = actionsFor(r);
  if (actions.length) {
    actions.forEach((a) => {
      const done = a.fromRegister && a.statusKey === 'closed';
      const tail = done ? `${closedWords(a) || 'Done'}.` : `${dueWords(a.due)}. ${a.status}.`;
      out.push(`- ${a.fnName ? `${a.fnName}${a.kpiName ? ` (${a.kpiName})` : ''}: ` : ''}${done ? 'Done: ' : ''}${sentence(a.text)} Owner: ${a.owner || 'Not set'}. ${tail}`);
    });
  } else out.push('No actions were added in this meeting.');
  out.push('');
  out.push('TRANSCRIPT');
  const lines = r.transcript;
  if (lines.length) lines.forEach((l) => out.push(`${clock(l.at)}  ${l.text}`));
  else out.push(transcriptEmptyPlain(r));
  return plain(out.join('\n'));
}

async function copyMinutes(id) {
  const r = findMeeting(id);
  if (!r) return;
  const text = minutesText(r);
  let ok = false;
  try {
    if (navigator.clipboard?.writeText) {
      // Some browsers leave the promise waiting (an unfocused window); don't wait forever.
      const wait = new Promise((resolve) => { setTimeout(() => resolve(false), 1500); });
      ok = await Promise.race([navigator.clipboard.writeText(text).then(() => true, () => false), wait]);
    }
  } catch { ok = false; }
  if (!ok && sheet.open) {
    // Older path: a hidden text box inside the sheet (the page behind is inert).
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.className = 'mn-copy-area';
    sheet.append(area);
    area.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    sheet.querySelector('[data-mn-copy]')?.focus({ preventScroll: true });
  }
  ctx.toast(ok ? 'Minutes copied. Paste them into an email or a document.' : "This browser blocked copying. Use Print to save them as a PDF instead.");
}

function printMinutes(id) {
  const r = findMeeting(id);
  if (!r) return;
  const page = document.createElement('div');
  page.className = 'mn-print';
  page.innerHTML = `
    <p class="mn-print-kicker">${esc(plantWords(r.snapshot?.plant) ? `${plantWords(r.snapshot.plant)}, Daily Operating Review` : 'Daily Operating Review')}</p>
    <h1 class="mn-print-title">Meeting minutes</h1>
    ${recordedLine(r) ? `<p class="mn-print-when">${esc(recordedLine(r))}</p>` : ''}
    ${minutesBody(r, { print: true })}`;
  document.body.append(page);
  const html = document.documentElement;
  html.classList.add('mn-printing');
  const before = document.title;
  document.title = `${r.snapshot?.plant ?? 'DOR'} DOR minutes, ${longDay(r.dayIso)}`;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    page.remove();
    html.classList.remove('mn-printing');
    document.title = before;
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  try { window.print(); } catch { /* no print here */ }
  // Browsers lay out the printout when print() is called; tidy up even if afterprint never comes.
  setTimeout(cleanup, 1000);
}

function deleteMinutes(id) {
  const result = id ? removeMeeting(id) : null;
  if (!result) {
    ctx.toast("These minutes aren't on this device anymore.");
    showList();
    return;
  }
  const { removed, index } = result;
  showList();
  ctx.toast(`Minutes deleted for ${medDay(removed.dayIso)}.`, {
    actionLabel: 'Undo',
    onAction: () => {
      const list = readMeetings();
      if (!list.some((m) => m.id === removed.id)) {
        list.splice(Math.min(index, list.length), 0, removed);
        writeMeetings(list); // back for this visit even when the browser isn't saving
      }
      if (sheet.open && shownId === null) {
        showList(removed.id);
        ctx.toast(`Minutes for ${medDay(removed.dayIso)} are back.`);
      } else {
        ctx.toast(`Minutes for ${medDay(removed.dayIso)} are back.`, { actionLabel: 'Open minutes', onAction: () => openMinutes(removed.id) });
      }
    },
  });
}

/* ---------- Start ---------- */

export function initRecorder(c) {
  ctx = c;
  const meeting = document.getElementById('meeting');
  recRoot = meeting?.querySelector('[data-rec]');
  if (recRoot) {
    recToggle = recRoot.querySelector('[data-rec-toggle]');
    recLabel = recRoot.querySelector('[data-rec-label]');
    recLive = recRoot.querySelector('[data-rec-live]');
    recWord = recRoot.querySelector('[data-rec-word]');
    recTime = recRoot.querySelector('[data-rec-time]');
    recWhy = recRoot.querySelector('[data-rec-why]');
    recAnnounce = recRoot.querySelector('[data-rec-announce]');
    addedEl = meeting.querySelector('[data-actions-added]');
    captionsEl = meeting.querySelector('[data-captions]');
    captionsFinal = meeting.querySelector('[data-captions-final]');
    captionsInterim = meeting.querySelector('[data-captions-interim]');
    captionsToggle = meeting.querySelector('[data-captions-toggle]');
    recToggle.addEventListener('click', toggleRecording);
    captionsToggle.addEventListener('click', () => {
      captionsOn = !captionsOn;
      safeSet(local(), CAPTIONS_KEY, captionsOn ? 'on' : 'off');
      syncCaptions();
    });
    meeting.addEventListener('click', (e) => {
      // Its own attribute: the board's [data-add-action] opens the Action register instead.
      const add = e.target.closest('[data-meeting-add]');
      // The button beside "Needs an action" names its KPI, so the form starts on that measure.
      if (add) openAddAction(add.dataset.meetingAdd, add.dataset.meetingAddKpi ?? null);
    });
    buildAddDialog(meeting);
    buildNotice(meeting);
  }
  buildSheet();
  window.addEventListener('resize', () => { if (captionsShown) requestAnimationFrame(placeToasts); });

  // Closing the tab mid-meeting still keeps the minutes; a reload resumes the
  // same meeting (the copy is replaced when it ends).
  window.addEventListener('pagehide', () => {
    if (!session) return;
    if (interim.trim()) { addLine(interim); interim = ''; }
    persistSession();
    const record = buildRecord(session, Date.now());
    if (worthSaving(record)) upsertMeeting(record);
  });

  // The meeting opened before the recorder started (a reload on #meeting): pick it up.
  if (session && recRoot) {
    setRecState('idle', { announce: false });
    renderSupport();
    renderCount();
    recRoot.hidden = false;
    meetingApi?.relayout?.();
  }
}
