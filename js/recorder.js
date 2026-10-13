// Meeting recorder and minutes.
//
// - A meeting session starts when Run meeting opens (js/meeting.js calls
//   startMeetingSession) and is saved as minutes when it closes, if it ran at
//   least 15 seconds or holds any transcript or actions. Minutes live on this
//   device only: localStorage dor.meetings.v1.
// - Record turns speech into text with the browser's Web Speech API and shows
//   live captions under the slide.
// - Add action (on each function slide) saves to the Action register, and the
//   slide shows it under "Action, next 24 hours" at once.
// - openMinutes() shows the saved minutes in a right-side sheet.
//
// ctx = { getMonth, getDay, toast, addAction, openActions }

import { kpiRowsFor, ownerFor, isoForDay } from './store.js?v=20261012-235706';
import { dayStatus, monthStatus, statusWord, OFF, NO_PRODUCTION } from './status.js?v=20261012-235706';
import { formatPair, plainLabel, formatDayMedium, formatDayLong, monthSoFar } from './format.js?v=20261012-235706';
import { notesText, summaryParts } from './board.js?v=20261012-235706';
import { esc, statusMarkup, issueStatusMarkup } from './ui.js?v=20261012-235706';
// Namespace import: the Action register is built in parallel, and a missing
// export must never stop the board from loading.
import * as register from './actions.js?v=20261012-235706';

const MEETINGS_KEY = 'dor.meetings.v1';
const SESSION_KEY = 'dor.meetingSession.v1';
const NOTICE_KEY = 'dor.recorder.notice.v1';
const CAPTIONS_KEY = 'dor.recorder.captions.v1';
const MIN_SECONDS = 15;
// "Minutes saved" stays until it's dismissed (the longest wait a browser timer takes).
const STAY = 2147483647;

const NOTICE = "Speech is turned into text by the browser's speech service. Everyone in the room should know the meeting is being recorded.";
const HONEST = "Built from the board and the meeting's transcript on this device.";

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

const plural = (n, one, many) => `${n}\u00a0${n === 1 ? one : many}`;
const plain = (t) => String(t ?? '').replace(/ /g, ' ');

/* ---------- Saved meetings (localStorage) ---------- */

function readMeetings() {
  const raw = safeGet(local(), MEETINGS_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((m) => m && typeof m.id === 'string') : [];
  } catch {
    return [];
  }
}

function writeMeetings(list) {
  return safeSet(local(), MEETINGS_KEY, JSON.stringify(list));
}

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
  return writeMeetings(list) ? { removed, index: i } : null;
}

const findMeeting = (id) => readMeetings().find((m) => m.id === id) ?? null;
const newestFirst = (list) => list.slice().sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

/* ---------- The meeting in progress (sessionStorage, so a reload keeps it) ---------- */

function persistSession() {
  if (!session) return;
  const { month, day, ...rest } = session;
  void month; void day;
  safeSet(sess(), SESSION_KEY, JSON.stringify(rest));
}

function readSession() {
  const raw = safeGet(sess(), SESSION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    return s && typeof s.id === 'string' && Array.isArray(s.transcript) && Array.isArray(s.actions) ? s : null;
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
          day: cellFor(y, k.kpiDaily, !(y.status === NO_PRODUCTION && y.actual === null)),
          month: {
            ...cellFor(mo, k.kpiMonthly, mo.asOfDay !== null),
            note: mo.asOfDay && mo.asOfDay !== day ? `as of ${formatDayMedium(month, mo.asOfDay)}` : '',
          },
          issue: n.problem,
          action: n.action,
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
  if (saved && saved.startedAt === startedAt) {
    session = { ...saved, month, day, dayIso: isoForDay(month, day) };
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

/** The meeting is closing: stop recording, save the minutes, offer to open them. */
export function endMeetingSession() {
  if (!session) return;
  closing = true;
  stopRecording({ flush: true, now: true });
  if (addDialog?.open) addDialog.close();
  const s = session;
  session = null;
  safeRemove(sess(), SESSION_KEY);
  closing = false;
  if (!ctx) return;
  const record = buildRecord(s, Date.now());
  if (!worthSaving(record)) {
    removeMeeting(record.id); // a copy saved when the page was closed mid-meeting
    return;
  }
  const label = medDay(record.dayIso);
  if (upsertMeeting(record)) {
    ctx.toast(`Minutes saved for ${label}.`, { actionLabel: 'Open minutes', onAction: () => openMinutes(record.id), duration: STAY });
  } else {
    ctx.toast("This browser blocked saving the minutes, so they weren't kept.");
  }
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
  if (captionsShown && session && !captionsEl.hidden) {
    const top = captionsEl.getBoundingClientRect().top;
    root.style.setProperty('--meeting-toast-bottom', `${Math.max(0, Math.round(window.innerHeight - top + 8))}px`);
  } else {
    root.style.removeProperty('--meeting-toast-bottom');
  }
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
    ctx.toast(NOTICE);
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
  if (ctx && !closing) ctx.toast(message);
}

/**
 * Stop listening. `now` ends at once (meeting closing, errors): anything half
 * heard is kept as a line. Otherwise the service gets a moment to finish the
 * last phrase.
 */
function stopRecording({ flush = true, now = false } = {}) {
  wantOn = false;
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
      <div class="ma-field">
        <label class="ma-label" for="ma-text">Action</label>
        <textarea class="ma-input ma-textarea" id="ma-text" name="text" rows="3" maxlength="400" required aria-describedby="ma-text-error"></textarea>
        <p class="ma-error" id="ma-text-error" hidden>Write the action first.</p>
      </div>
      <div class="ma-row">
        <div class="ma-field">
          <label class="ma-label" for="ma-owner">Owner</label>
          <input class="ma-input" id="ma-owner" name="owner" type="text" list="ma-owners" maxlength="80" autocomplete="off" required aria-describedby="ma-owner-error">
          <datalist id="ma-owners"></datalist>
          <p class="ma-error" id="ma-owner-error" hidden>Name who owns it.</p>
        </div>
        <div class="ma-field">
          <label class="ma-label" for="ma-due">Due date</label>
          <input class="ma-input" id="ma-due" name="due" type="date" required aria-describedby="ma-due-error">
          <p class="ma-error" id="ma-due-error" hidden>Pick a due date.</p>
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
  addDialog.addEventListener('click', (e) => { if (e.target === addDialog) addDialog.close(); });
  addDialog.addEventListener('close', () => {
    addClosedAt = Date.now();
    const id = addFn?.id;
    addFn = null;
    // Back to the slide's Add action button (the slide may have re-rendered).
    const btn = id ? document.querySelector(`#meeting [data-meeting-add="${CSS.escape(id)}"]`) : null;
    if (btn) btn.focus({ preventScroll: true });
    else document.querySelector('#meeting [data-next-slide]')?.focus({ preventScroll: true });
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

function showFieldError(input, on) {
  const msg = document.getElementById(`${input.id}-error`);
  if (msg) msg.hidden = !on;
  if (on) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
}

function openAddAction(fnId) {
  if (!session || !addDialog || addDialog.open) return;
  const fn = session.month?.functions.find((f) => f.id === fnId);
  if (!fn) return;
  addFn = fn;
  addSaving = false;
  const owner = ownerFor(fn).name;
  addDialog.querySelector('#ma-title').textContent = `Add action for ${fn.name}`;
  addDialog.querySelector('#ma-sub').textContent = 'It goes to the Action register and these meeting minutes.';
  const text = addForm.querySelector('#ma-text');
  const ownerInput = addForm.querySelector('#ma-owner');
  const due = addForm.querySelector('#ma-due');
  text.value = '';
  ownerInput.value = owner;
  const owners = [...new Set(session.month.functions.map((f) => ownerFor(f).name).filter(Boolean))];
  addForm.querySelector('#ma-owners').innerHTML = owners.map((n) => `<option value="${esc(n)}"></option>`).join('');
  const boardDay = isoToDate(session.dayIso);
  if (boardDay) {
    // The next production day after the board day (Fri, Feb 27 gives Mon, Mar 2).
    let next = null;
    try { next = typeof register.nextProductionDayIso === 'function' ? register.nextProductionDayIso(session.month, session.day) : null; } catch { next = null; }
    due.value = next && isoToDate(next) ? next : dateToIso(new Date(boardDay.getTime() + 86400000));
    due.min = session.dayIso;
  } else {
    due.value = '';
    due.removeAttribute('min');
  }
  [text, ownerInput, due].forEach((i) => showFieldError(i, false));
  const formError = addForm.querySelector('[data-ma-error]');
  formError.hidden = true;
  formError.textContent = '';
  addDialog.showModal();
  text.focus();
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
  const action = {
    fnId: fn.id,
    kpiId: null, // the function's workbook KPI (the slide's main measure)
    text: text.value.trim(),
    owner: ownerInput.value.trim(),
    due: due.value,
    status: 'open',
    source: 'meeting',
    meetingId: session.id,
    dayIso: session.dayIso,
  };
  addSaving = true;
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
  session.actions.push({ id, fnId: fn.id, fnName: fn.name, text: action.text, owner: action.owner, due: action.due, status: 'open' });
  persistSession();
  renderCount();
  // The slide lists the function's actions: redraw it now, so the new one shows.
  meetingApi?.relayout?.();
  addDialog.close();
  ctx.toast(`Action added for ${fn.name}.`);
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

function focusTitle() {
  sheet.querySelector('.sheet-panel')?.scrollTo?.(0, 0);
  sheet.querySelector('#mn-title')?.focus({ preventScroll: true });
}

function sheetHead(titleHtml, closeName) {
  return `
    <header class="sheet-head mn-head">
      <h2 class="sheet-title mn-title" id="mn-title" tabindex="-1">${titleHtml}</h2>
      <div class="sheet-tools">
        <button class="icon-btn sheet-close" type="button" data-mn-close aria-label="${esc(closeName)}">${CLOSE_ICON}</button>
      </div>
    </header>`;
}

function metaLine(r) {
  const parts = [];
  const when = whenStarted(r.startedAt);
  if (when) parts.push(`Started ${when}`);
  parts.push(durationWords(r.durationSec));
  return parts.join(' · ');
}

function showList(focusId = null) {
  shownId = null;
  const list = newestFirst(readMeetings());
  const items = list.map((r) => {
    const n = (r.actions?.length ?? r.actionIds?.length ?? 0);
    const meta = [metaLine(r), plural(n, 'action', 'actions')].join(' · ');
    return `<li><button class="mn-item" type="button" data-mn-open="${esc(r.id)}">
        <span class="mn-item-text"><span class="mn-item-date">${esc(longDay(r.dayIso))}</span><span class="mn-item-meta">${esc(meta)}</span></span>${NEXT_ICON}
      </button></li>`;
  }).join('');
  sheet.innerHTML = `
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
    </div>`;
  const target = focusId ? sheet.querySelector(`[data-mn-open="${CSS.escape(focusId)}"]`) : null;
  if (target) target.focus({ preventScroll: false });
  else focusTitle();
}

/* ---------- One meeting's minutes ---------- */

const KNOWN_STATUS = ['on', 'off', 'not-entered', 'no-goal', 'no-production'];

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

/** The board's empty-note words, in the minutes' words ("Issue", not "Problem"). */
const noteWords = (n) => String(n?.text ?? '').replace(/^No problem reported$/, 'No issue reported');
const ACTION_LABEL = 'Action, next 24 hours';
const noteHtml = (label, n) => `<div><dt>${label}</dt><dd class="${n?.empty ? 'is-empty' : ''}">${esc(noteWords(n))}</dd></div>`;

/**
 * "Action, next 24 hours" for a function's main measure: the board's note,
 * then the actions assigned to it in this meeting ("No action entered" only
 * when there are neither).
 */
function actionHtml(n, assigned) {
  if (!assigned.length) return noteHtml(ACTION_LABEL, n);
  const note = n && !n.empty ? `<dd>${esc(noteWords(n))}</dd>` : '';
  const list = assigned.map((a) => `<li><span class="mn-alist-text">${esc(a.text)}</span> <span class="mn-alist-meta">${esc(a.owner || 'No owner named')}<span aria-hidden="true"> · </span><span class="sr-only">, </span>${esc(dueWords(a.due))}</span></li>`).join('');
  return `<div><dt>${ACTION_LABEL}</dt>${note}<dd class="mn-assigned"><ul class="mn-alist">${list}</ul></dd></div>`;
}

/** This meeting's actions for each function's main measure, by function id. */
function actionsByFn(actions) {
  const map = new Map();
  for (const a of actions) {
    if (!a.fnId || a.kpiId) continue;
    if (!map.has(a.fnId)) map.set(a.fnId, []);
    map.get(a.fnId).push(a);
  }
  return map;
}

function functionHtml(s, f, i, byFn = new Map()) {
  const [primary, ...extras] = Array.isArray(f.rows) ? f.rows : [];
  const extraHtml = extras.length
    ? `<div class="mn-extras">
         <p class="mn-extras-title">More measures</p>
         <ul class="mn-extra-list">${extras.map((r) => `
           <li class="mn-extra">
             <p class="mn-extra-name">${esc(r.name)}</p>
             <div class="mn-pair mn-pair--compact">${statusCell(s.dayLabel, r.day, { measure: r.day?.measure !== r.name })}${statusCell(s.monthLabel, r.month, { measure: r.month?.measure !== r.name })}</div>
             ${!r.issue?.empty || !r.action?.empty ? `<dl class="mn-notes">${r.issue?.empty ? '' : noteHtml('Issue', r.issue)}${r.action?.empty ? '' : noteHtml(ACTION_LABEL, r.action)}</dl>` : ''}
           </li>`).join('')}</ul>
       </div>`
    : '';
  return `<li class="mn-fn">
      <div class="mn-fn-head">
        <h4 class="mn-fn-name"><span class="mn-fn-num">${i + 1}</span>${esc(f.name)}</h4>
        <p class="mn-fn-owner">${esc(f.owner)}</p>
      </div>
      ${primary ? `<div class="mn-pair">${statusCell(s.dayLabel, primary.day)}${statusCell(s.monthLabel, primary.month)}</div>
      <dl class="mn-notes">${noteHtml('Issue', primary.issue)}${actionHtml(primary.action, byFn.get(f.id) ?? [])}</dl>` : ''}
      ${extraHtml}
    </li>`;
}

const ACTION_WORD = { open: 'Open', 'in-progress': 'In progress', done: 'Done', closed: 'Closed' };
const actionWord = (status) => ACTION_WORD[status] ?? (status ? String(status).charAt(0).toUpperCase() + String(status).slice(1) : 'Open');

/** Actions from the register for this meeting, plus any it doesn't have. */
function actionsFor(r) {
  let live = [];
  try {
    const all = typeof register.listActions === 'function' ? register.listActions() : [];
    live = Array.isArray(all) ? all.filter((a) => a && a.meetingId === r.id) : [];
  } catch { live = []; }
  const names = new Map((r.snapshot?.functions ?? []).map((f) => [f.id, f.name]));
  const out = live.map((a) => ({
    fnId: a.fnId ?? null,
    kpiId: a.kpiId ?? null,
    fnName: names.get(a.fnId) ?? a.fnName ?? '',
    text: a.text, owner: a.owner, due: a.due, status: actionWord(a.status), statusKey: a.status, fromRegister: true,
  }));
  const liveIds = new Set(live.map((a) => String(a.id)));
  for (const a of r.actions ?? []) {
    if (a.id && liveIds.has(String(a.id))) continue;
    out.push({
      fnId: a.fnId ?? null,
      kpiId: a.kpiId ?? null,
      fnName: a.fnName ?? names.get(a.fnId) ?? '',
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
  return r.recorded ? "No transcript. The recorder didn't hear any speech." : 'No transcript. Recording was off.';
}

function minutesBody(r, { print = false } = {}) {
  const s = r.snapshot;
  const actions = actionsFor(r);
  const off = offGoalNames(s);
  const lines = Array.isArray(r.transcript) ? r.transcript : [];
  const transcriptList = lines.length
    ? `<ol class="mn-lines">${lines.map((l) => `<li><span class="mn-at">${esc(clock(l.at))}</span><span class="mn-line-text">${esc(l.text)}</span></li>`).join('')}</ol>`
    : `<p class="mn-quiet">${esc(transcriptEmptyText(r))}</p>`;

  return `
    <p class="mn-meta">${esc(metaLine(r))}</p>
    <p class="mn-honest">${esc(HONEST)}</p>
    ${print ? '' : `<div class="mn-tools">
      <button class="btn btn--secondary" type="button" data-mn-copy>Copy as text</button>
      <button class="btn btn--secondary" type="button" data-mn-print>Print</button>
      <button class="btn btn--secondary mn-delete" type="button" data-mn-delete>Delete<span class="sr-only"> these minutes</span></button>
    </div>`}

    <section class="mn-section" aria-labelledby="mn-sec-summary">
      <h3 class="section-title" id="mn-sec-summary">Summary</h3>
      ${s ? `<p class="mn-summary">${esc(s.summary)}</p>
      ${off.length ? `<p class="mn-summary-off">Off goal: ${esc(off.join(', '))}.</p>` : ''}`
        : '<p class="mn-quiet">The board could not be read when this meeting ended.</p>'}
    </section>

    ${s ? `<section class="mn-section" aria-labelledby="mn-sec-fns">
      <h3 class="section-title" id="mn-sec-fns">By function</h3>
      <ol class="mn-fns">${s.functions.map((f, i) => functionHtml(s, f, i, actionsByFn(actions))).join('')}</ol>
    </section>` : ''}

    <section class="mn-section" aria-labelledby="mn-sec-actions">
      <div class="mn-section-head">
        <h3 class="section-title" id="mn-sec-actions">Actions assigned in this meeting</h3>
        ${print ? '' : '<button class="btn btn--secondary" type="button" data-mn-register>Open the Action register</button>'}
      </div>
      ${actions.length
        ? `<ul class="mn-actions">${actions.map((a) => `
            <li class="mn-action">
              <p class="mn-action-text">${esc(a.text)}</p>
              <p class="mn-action-meta">${a.fnName ? `<span class="mn-action-fn">${esc(a.fnName)}</span><span aria-hidden="true"> · </span>` : ''}Owner: ${esc(a.owner || 'Not set')}<span aria-hidden="true"> · </span>${esc(dueWords(a.due))}<span aria-hidden="true"> · </span>${a.fromRegister && ACTION_WORD[a.statusKey] && a.statusKey !== 'done' ? issueStatusMarkup(a.statusKey) : `<span class="mn-action-status${a.fromRegister ? '' : ' is-quiet'}">${esc(a.status)}</span>`}</p>
            </li>`).join('')}</ul>`
        : '<p class="mn-quiet">No actions were added in this meeting.</p>'}
    </section>

    <section class="mn-section" aria-labelledby="mn-sec-transcript">
      ${print
        ? `<h3 class="section-title" id="mn-sec-transcript">Transcript</h3>${transcriptList}`
        : `<details class="mn-transcript">
            <summary><h3 class="section-title mn-summary-title" id="mn-sec-transcript">Transcript</h3><span class="mn-count">${lines.length ? plural(lines.length, 'line', 'lines') : 'empty'}</span></summary>
            ${transcriptList}
          </details>`}
    </section>`;
}

function titleHtml(r) {
  return `Minutes<span class="mn-title-sep" aria-hidden="true"> · </span><span class="sr-only">, </span><span class="mn-title-date">${esc(longDay(r.dayIso))}</span>`;
}

function showMeeting(id) {
  const r = findMeeting(id);
  if (!r) {
    shownId = null;
    sheet.innerHTML = `
      <div class="sheet-panel">
        ${sheetHead('Meeting minutes', 'Close meeting minutes')}
        <div class="sheet-body mn-body">
          <p class="mn-empty-text">These minutes aren't on this device. They may have been deleted.</p>
          <p class="mn-back-row"><button class="btn btn--secondary" type="button" data-mn-back>${PREV_ICON}See all meetings</button></p>
        </div>
      </div>`;
    focusTitle();
    return;
  }
  shownId = r.id;
  sheet.innerHTML = `
    <div class="sheet-panel">
      ${sheetHead(titleHtml(r), 'Close minutes')}
      <div class="sheet-body mn-body">
        <p class="mn-back-row"><button class="btn btn--text mn-back" type="button" data-mn-back>${PREV_ICON}Back to all meetings</button></p>
        ${minutesBody(r)}
      </div>
    </div>`;
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
  return `${c.word}${fig ? `, ${fig}` : ''} (${c.measure}${c.note ? `, ${c.note}` : ''})`;
}

const indent = (text, pad) => String(text ?? '').split('\n').join(`\n${pad}`);

function minutesText(r) {
  const s = r.snapshot;
  const out = [];
  out.push(`${s?.plant ? `${s.plant} plant, ` : ''}Daily Operating Review`);
  out.push(`Minutes · ${longDay(r.dayIso)}`);
  out.push(metaLine(r));
  out.push(HONEST);
  out.push('');
  out.push('SUMMARY');
  if (s) {
    out.push(s.summary);
    const off = offGoalNames(s);
    if (off.length) out.push(`Off goal: ${off.join(', ')}.`);
    out.push('');
    out.push('BY FUNCTION');
    const byFn = actionsByFn(actionsFor(r));
    s.functions.forEach((f, i) => {
      out.push(`${i + 1}. ${f.name}, ${f.owner}`);
      (f.rows ?? []).forEach((row) => {
        const pad = row.primary ? '   ' : '      ';
        if (!row.primary) out.push(`   ${row.name}`);
        out.push(`${pad}${s.dayLabel}: ${cellText(row.day)}`);
        out.push(`${pad}${s.monthLabel}: ${cellText(row.month)}`);
        if (row.primary || !row.issue?.empty) out.push(`${pad}Issue: ${indent(noteWords(row.issue), `${pad}  `)}`);
        const assigned = row.primary ? (byFn.get(f.id) ?? []) : [];
        if (assigned.length) {
          out.push(`${pad}${ACTION_LABEL}:${row.action?.empty ? '' : ` ${indent(row.action?.text, `${pad}  `)}`}`);
          assigned.forEach((a) => out.push(`${pad}  - ${a.text} (${a.owner || 'No owner named'}, ${dueWords(a.due)})`));
        } else if (row.primary || !row.action?.empty) out.push(`${pad}${ACTION_LABEL}: ${indent(row.action?.text, `${pad}  `)}`);
      });
    });
  } else {
    out.push('The board could not be read when this meeting ended.');
  }
  out.push('');
  out.push('ACTIONS ASSIGNED IN THIS MEETING');
  const actions = actionsFor(r);
  if (actions.length) {
    actions.forEach((a) => out.push(`- ${a.fnName ? `${a.fnName}: ` : ''}${a.text} Owner: ${a.owner || 'Not set'}. ${dueWords(a.due)}. ${a.status}.`));
  } else out.push('No actions were added in this meeting.');
  out.push('');
  out.push('TRANSCRIPT');
  const lines = Array.isArray(r.transcript) ? r.transcript : [];
  if (lines.length) lines.forEach((l) => out.push(`${clock(l.at)}  ${l.text}`));
  else out.push(transcriptEmptyText(r));
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
    <p class="mn-print-kicker">${esc(r.snapshot?.plant ? `${r.snapshot.plant} plant, Daily Operating Review` : 'Daily Operating Review')}</p>
    <h1 class="mn-print-title">Minutes · ${esc(longDay(r.dayIso))}</h1>
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
    ctx.toast("This browser blocked the change, so the minutes are still here.");
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
        if (!writeMeetings(list)) { ctx.toast("This browser blocked the change, so the minutes couldn't come back."); return; }
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
      if (add) openAddAction(add.dataset.meetingAdd);
    });
    buildAddDialog(meeting);
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
