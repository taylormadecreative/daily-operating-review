// App shell: routing, history, and the wiring between screens.
// URL = ?date=YYYY-MM-DD (production day) + hash for the open view:
//   (none) board · #safety detail · #enter[/fn] enter numbers · #meeting[/n] meeting

import * as store from './store.js?v=20261013-151156';
import { renderBoard, revealRow, setUndoable } from './board.js?v=20261013-151156';
import { initDetail, openDetail, closeDetail, isDetailOpen, refreshDetail } from './detail.js?v=20261013-151156';
import { initEnter, openEnter, closeEnter, isEnterOpen, isDirty, showLeave } from './enter.js?v=20261013-151156';
import { initMeeting, openMeeting, closeMeeting, isMeetingOpen, requestFullscreen, refreshMeeting, leaveFullscreen } from './meeting.js?v=20261013-151156';
import { initToast, toast, dismissAll } from './toast.js?v=20261013-151156';
import { formatDayMedium, formatMonthShort, formatMonthName, termName } from './format.js?v=20261013-151156';
import { renderHome, revealHomeRow, AREA_OPTIONS } from './home.js?v=20261013-151156';
import { renderNav, wireShell, setNavState, toggleMenu, showPopoverFrom } from './shell.js?v=20261013-151156';
import { downloadCsv, printDay } from './export.js?v=20261013-151156';
import { esc, statusMarkup } from './ui.js?v=20261013-151156';
import { initCustomize, openCustomize, closeCustomize, isCustomizeOpen } from './customize.js?v=20261013-151156';
import { startTour, endTour, isTourOpen, tourSeen, ARRIVAL_KEY } from './tour.js?v=20261013-151156';
import { ON, OFF, NOT_ENTERED, NO_GOAL, NO_PRODUCTION, NOT_TRACKED } from './status.js?v=20261013-151156';
import { initActions, openActions, addAction, listActions, refreshActions } from './actions.js?v=20261013-151156';
import { initRecorder, openMinutes } from './recorder.js?v=20261013-151156';
import { initSetup, openSetup } from './setup.js?v=20261013-151156';

// We decide where the page scrolls after views close (the saved row).
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

/* ---------- A double click is one click ---------- */

/**
 * Most buttons here open, close or remove something, so a double click's second click lands on
 * whatever the first one put under the pointer: a sheet's dimmed area (it closes again), the
 * meeting's Exit, the next row's Delete. The second click of a double click (the browser's own
 * count, or a click on the same spot within 350ms) is dropped on buttons, links,
 * summaries and a dialog's dimmed area. Text boxes aren't touched, so a double click still selects
 * a word. The day arrows (‹ ›) are left alone: clicking them quickly steps several days.
 * A click on a sheet's dimmed area in the first 400ms after it opened is dropped too.
 */
// Rows and cells that open something on a click count too: the home's grid rows, a board row's
// charts and its owner cell (the second click would land on whatever the first one drew there).
const ACTIVATORS = 'button, a, summary, [role="button"], input[type="submit"], input[type="button"], [data-home-row], .kpirow .mini, .v2cell--owner';
const REPEAT_OK = '[data-prev], [data-next], [data-home-prev], [data-home-next]';
// The second click of a double click comes 100 to 250ms after the first; a person reading a card
// and pressing its Next again takes longer, so a same-spot click counts as a double click within 350ms.
const DOUBLE_MS = 350;
const DOUBLE_PX = 16;
const BACKDROP_GRACE_MS = 400;
/** When each modal dialog was last opened (keepBoardPlace's showModal records it). */
const dialogOpenedAt = new WeakMap();
let lastPointerClick = { t: -Infinity, x: 0, y: 0 };
document.addEventListener('click', (e) => {
  if (!e.isTrusted || e.detail === 0) return; // keyboard and script clicks
  const now = performance.now();
  const sameSpot = now - lastPointerClick.t < DOUBLE_MS
    && Math.hypot(e.clientX - lastPointerClick.x, e.clientY - lastPointerClick.y) <= DOUBLE_PX;
  lastPointerClick = { t: now, x: e.clientX, y: e.clientY };
  const t = e.target;
  const backdrop = t instanceof HTMLDialogElement && t.open;
  const tooSoon = backdrop && now - (dialogOpenedAt.get(t) ?? -Infinity) < BACKDROP_GRACE_MS;
  const second = e.detail > 1 || sameSpot;
  const control = !backdrop && t instanceof Element && t.closest(ACTIVATORS) && !t.closest(REPEAT_OK);
  if (tooSoon || (second && (backdrop || control))) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);

/**
 * The second press of that double click mustn't move focus either. The first click opened something
 * (the Action register with focus in its Action box, a tour card); the second press lands on whatever
 * is under the pointer now (the sheet, the tour's dimmed page) and would pull focus there, so typing
 * went nowhere and Esc and the arrows did nothing. A second press (the browser's count, or the same
 * spot within 350ms) after a press on a button, link, summary or a dialog's dimmed area keeps focus
 * where the first click put it, also when it lands in a text box: Board setup's "Add a function" puts
 * focus in the new name box and scrolls it to the middle, so the second press would land in another
 * box and the typing would go there. A double click inside a text box still selects a word (its first
 * press wasn't on a control), and so does one on plain text. The day arrows (‹ ›) are left alone.
 */
// control: this press started on a control; after: the press before it did (read by mousedown).
let lastPress = { t: -Infinity, x: 0, y: 0, control: false, after: false };
/** Did this press start on something a click acts on? */
const pressedControl = (t) => (t instanceof HTMLDialogElement && t.open)
  || (t instanceof Element && Boolean(t.closest(ACTIVATORS)) && !t.closest(REPEAT_OK));
document.addEventListener('pointerdown', (e) => {
  if (!e.isTrusted || e.button !== 0) return;
  const now = performance.now();
  const sameSpot = now - lastPress.t < DOUBLE_MS
    && Math.hypot(e.clientX - lastPress.x, e.clientY - lastPress.y) <= DOUBLE_PX;
  const after = lastPress.control;
  lastPress = { t: now, x: e.clientX, y: e.clientY, control: pressedControl(e.target), after };
  // A prevented pointerdown sends no mousedown, so focus stays put (and no text selection starts).
  // `after`: the first press was on a control, so this can't be a double click selecting a word,
  // even when it lands in a text box. Without it (the first press was in the box), nothing is stopped.
  if ((e.detail > 1 || sameSpot) && after) e.preventDefault();
}, true);
document.addEventListener('mousedown', (e) => {
  // The browser's own count, for a press whose pointerdown let it through (a slower double click).
  // Text boxes included: a press after a press on a control isn't a word select.
  if (!e.isTrusted || e.button !== 0 || e.detail < 2 || !lastPress.after) return;
  e.preventDefault();
}, true);

let month;
let day;
let view = 'home'; // 'home' (dashboard) or 'dor' (ledger board)
let area = 'all';
let enterHash = 'enter';
const narrow = () => matchMedia('(max-width: 599px)').matches;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- URL ---------- */

function parseRoute() {
  const params = new URLSearchParams(location.search);
  const raw = params.get('date');
  const parsed = store.dayFromIso(month, raw);
  const d = parsed ?? store.boardDay(month);
  const badDate = raw !== null && parsed === null;
  const page = params.get('view') === 'dor' ? 'dor' : 'home';
  const a = params.get('area');
  const pickedArea = AREA_OPTIONS.some((o) => o.id === a) ? a : 'all';
  const base = { day: d, badDate, page, area: pickedArea };
  // A hash that isn't valid percent-encoding ("#people%") is read as typed, so the board still draws.
  let hash = location.hash.slice(1);
  try { hash = decodeURIComponent(hash); } catch { /* malformed: keep the raw hash */ }
  const [v, arg, extra] = hash.split('/');
  if (v === 'enter') {
    return {
      ...base,
      view: 'enter',
      fnId: store.functionById(month, arg) ? arg : null,
      mode: arg === 'switch' ? 'switch' : 'enter',
      focus: ['status', 'issue', 'numbers'].includes(extra) || String(extra ?? '').startsWith('kpi:') ? extra : null,
    };
  }
  if (v === 'meeting') return { ...base, view: 'meeting', slide: Math.max(0, Math.min(month.functions.length, Number(arg) || 0)) };
  if (v === 'customize' && page === 'dor') return { ...base, view: 'customize' };
  if (store.kpiRowById(month, v)) return { ...base, view: 'detail', fnId: v };
  return { ...base, view: 'board' };
}

function urlFor(d, hash = '') {
  const params = new URLSearchParams(location.search);
  params.set('date', store.isoForDay(month, d));
  return `${location.pathname}?${params}${hash ? `#${hash}` : ''}`;
}

const depth = () => history.state?.depth ?? 0;

function navigate(hash, { replace = false, toDay = day } = {}) {
  const url = urlFor(toDay, hash);
  if (replace) history.replaceState({ depth: depth() }, '', url);
  else history.pushState({ depth: depth() + 1 }, '', url);
  applyRoute();
}

/**
 * One step back, once: a second close before the first has landed (Save then Cancel, a double
 * click, two quick Esc) would step back twice and leave the app.
 */
let backPending = false;
let backTimer = 0;
function goBack() {
  if (backPending) return;
  backPending = true;
  // If the step back never lands (no page to go back to), closing works again after a second.
  clearTimeout(backTimer);
  backTimer = setTimeout(() => { backPending = false; }, 1000);
  history.back();
}

/** Close the open view: step back if we pushed it, otherwise replace. */
function closeView() {
  if (backPending || afterPop) return; // already on its way back
  if (depth() > 0) goBack();
  else navigate('', { replace: true });
}

let afterPop = null;
/** Back to the plain board on a given day, then run `after` once it has settled. */
function returnToBoard(toDay, after) {
  const n = depth();
  const finish = () => {
    history.replaceState({ depth: 0 }, '', urlFor(toDay));
    applyRoute();
    requestAnimationFrame(() => after?.());
  };
  if (n > 0) { afterPop = finish; history.go(-n); } else finish();
}

/* ---------- Route -> screens ---------- */

function showDateNote(text) {
  document.querySelectorAll('[data-date-note]').forEach((note) => {
    delete note.dataset.edge; // a month-edge note (sayDayEdge) gives way
    note.textContent = text ?? '';
    note.hidden = !text;
  });
}

/** Render whichever page is showing: the dashboard or the DOR board. */
/**
 * The tighter board (data-tv-dense) on a 1920-wide screen, so every function fits without
 * scrolling. A window shorter than 1000px always gets it. On a 1080p TV it's measured: the
 * board is drawn at the TV size, and drawn again dense only when its strip (and the 8px under it)
 * would end past the bottom of the screen (actions added, a weekend, a KPI from Board setup). A
 * resize measures again from the TV size; rows that change size on their own (fonts arriving) can
 * only tighten it. After that decision the space left under the board goes back to the rows
 * (fillTv), so the board fills the TV instead of leaving an empty band. The source line under the
 * board is hidden on a TV (its Start the demo over moves into the strip), so the page never scrolls.
 */
const TV = matchMedia('(min-width: 1800px) and (max-height: 1200px)');
const TV_SHORT = matchMedia('(min-width: 1800px) and (max-height: 1000px)');
/** The DOR board on a TV-sized window. */
const onTvBoard = () => TV.matches && view !== 'home' && document.documentElement.dataset.layout === 'v2';
/** The one place the dense fit is measured (a short window is always dense). */
const fitByMeasure = () => onTvBoard() && !TV_SHORT.matches;
/**
 * Where the board page ends. On a TV the source line under the board is hidden (css/board-v2.css),
 * so this is the navy strip plus the page's 8px under it: past the window's bottom, the page scrolls.
 */
function boardPageBottom() {
  const page = document.getElementById('board');
  return page ? page.getBoundingClientRect().bottom + window.scrollY : 0;
}
/** Does the board (its strip and the 8px under it) end past the bottom of the window? */
function boardSpills() {
  return Boolean(document.querySelector('.board2-foot')) && boardPageBottom() > window.innerHeight;
}
/** Back to the rows' own heights (before any measuring). */
function clearFill() {
  document.querySelector('.board2')?.style.removeProperty('--tv-fill');
  document.querySelectorAll('[data-rows2] .kpirow--fill').forEach((r) => {
    r.classList.remove('kpirow--fill');
    r.style.removeProperty('--row-h');
  });
}
/**
 * After the dense decision: the space left under the board (the page keeps 8px under its strip) is
 * shared out over the KPI rows, each over its own measured height (css/board-v2.css), so the strip
 * ends 8px above the screen's edge and the page is exactly the screen's height. Half a pixel is kept
 * back so rounding never makes the page a pixel taller than the screen. It changes no decision, so
 * it can't loop.
 */
function fillTv() {
  clearFill();
  if (!onTvBoard()) return;
  const board = document.querySelector('.board2');
  const rows = [...document.querySelectorAll('[data-rows2] .kpirow')];
  if (!board || !document.querySelector('.board2-foot') || !rows.length) return;
  const slack = window.innerHeight - boardPageBottom() - 0.5;
  if (slack > 0) {
    const heights = rows.map((r) => r.getBoundingClientRect().height); // all reads, then all writes
    rows.forEach((r, i) => {
      r.style.setProperty('--row-h', `${heights[i]}px`);
      r.classList.add('kpirow--fill');
    });
    board.style.setProperty('--tv-fill', `${Math.max(0, slack / rows.length)}px`);
  }
}
/** Before a render: dense only where it's always wanted (a short window), and no fill yet. */
function syncDensity() {
  document.documentElement.toggleAttribute('data-tv-dense', TV_SHORT.matches);
  clearFill();
}
let fittedSize = '';
/** After a render: a TV board that spills is drawn once more, dense; then the slack goes back to the rows. */
function fitDensity() {
  fittedSize = `${window.innerWidth}x${window.innerHeight}`;
  watchRows();
  clearFill();
  if (fitByMeasure() && !document.documentElement.hasAttribute('data-tv-dense') && boardSpills()) {
    document.documentElement.setAttribute('data-tv-dense', '');
    renderBoard(month, day);
  }
  fillTv();
}
/** The whole fit again, from the TV size (a resize, the fonts arriving). */
function refitDensity() {
  if (!month || !onTvBoard()) return;
  syncDensity();
  renderBoard(month, day);
  fitDensity();
}
let rowsWatch = null;
let rowsTimer = 0;
/**
 * Rows that change size without a render (fonts, a photo loading): tighten if the footer now
 * spills, then share out the slack again. It never loosens, and the fill it writes measures the
 * same the next time, so its own changes can't start a loop.
 */
function watchRows() {
  const rows = document.querySelector('[data-rows2]');
  if (rowsWatch || !rows || typeof ResizeObserver === 'undefined') return;
  rowsWatch = new ResizeObserver(() => {
    clearTimeout(rowsTimer);
    rowsTimer = setTimeout(() => {
      if (!month || !onTvBoard()) return;
      clearFill();
      if (fitByMeasure() && !document.documentElement.hasAttribute('data-tv-dense') && boardSpills()) {
        document.documentElement.setAttribute('data-tv-dense', '');
        renderBoard(month, day);
      }
      fillTv();
    }, 150);
  });
  rowsWatch.observe(rows);
}
let fitResizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(fitResizeTimer);
  fitResizeTimer = setTimeout(() => {
    // Crossing into or out of the TV sizes re-renders through the media listeners below.
    if (`${window.innerWidth}x${window.innerHeight}` !== fittedSize) refitDensity();
  }, 150);
});
// Fonts that arrive after the first render change every line: measure again from the TV size.
document.fonts?.addEventListener?.('loadingdone', () => {
  clearTimeout(fitResizeTimer);
  fitResizeTimer = setTimeout(refitDensity, 150);
});

function renderView() {
  document.documentElement.dataset.view = view;
  syncDensity();
  // The tab and bookmarks carry the brand: "Daily Operating Review, <plant> · LinkedXL OS".
  document.title = `Daily Operating Review, ${String(month.plant ?? '').replace(/\s+plant$/i, '')} · LinkedXL OS`;
  setNavState({ area, view }); // every link built below keeps the day and area
  if (view === 'home') renderHome(month, day, area);
  else renderBoard(month, day);
  renderNav(month, day, view);
  fitDensity();
  syncDayButtons();
}

/**
 * ‹ › at the month's first and last day: they look off and do nothing, but stay
 * focusable (aria-disabled, like Meeting's Previous), so focus never jumps to the
 * other arrow, where a second Enter would go back a day. The board draws them
 * disabled; this turns that into aria-disabled after every draw, including the
 * redraws that happen on their own (a resize, fonts arriving).
 */
const DAY_BUTTONS = [['[data-prev]', -1], ['[data-home-prev]', -1], ['[data-next]', 1], ['[data-home-next]', 1]];
/** Why an arrow does nothing: "Feb 28 is the last day of February's data." (read with the button). */
function dayEdgeNote(dir) {
  const id = dir < 0 ? 'day-edge-first' : 'day-edge-last';
  let note = document.getElementById(id);
  if (!note) {
    note = document.createElement('span');
    note.id = id;
    note.hidden = true;
    document.body.append(note);
  }
  const edge = dir < 0 ? 1 : month.daysInMonth;
  note.textContent = `${formatMonthShort(month)} ${edge} is the ${dir < 0 ? 'first' : 'last'} day of ${formatMonthName(month)}'s data.`;
  return note;
}
/**
 * A press on a dimmed arrow at the month's edge isn't silent: the date note under the summary says
 * "Feb 28 is the last day of February's data." for a few seconds, and a screen reader hears it
 * (the note is a polite status; it's shown empty first and filled a moment later, so it's read
 * every time, also when pressed again).
 */
let edgeTimer = 0;
let edgeFill = 0;
function sayDayEdge(dir) {
  const words = dayEdgeNote(dir).textContent;
  // The TV board is exactly the screen's height: a note line would push its footer off the screen,
  // so there the words come as a message (toasts never move the TV board), unless an Undo is showing.
  if (onTvBoard() && !document.querySelector('[data-toasts] .toast .toast-action')) {
    toast(words, { duration: 6000 });
    return;
  }
  const notes = [...document.querySelectorAll('[data-date-note]')].filter((n) => n.closest(view === 'home' ? '.home-app' : '.app'));
  clearTimeout(edgeTimer);
  clearTimeout(edgeFill);
  notes.forEach((note) => { note.textContent = ''; note.hidden = false; note.dataset.edge = ''; });
  edgeFill = setTimeout(() => notes.forEach((note) => { if ('edge' in note.dataset) note.textContent = words; }), 60);
  edgeTimer = setTimeout(() => notes.forEach((note) => {
    if (!('edge' in note.dataset)) return; // another note has taken its place
    delete note.dataset.edge;
    note.textContent = '';
    note.hidden = true;
  }), 6000);
}

function syncDayButtons() {
  if (!month) return;
  for (const [sel, dir] of DAY_BUTTONS) {
    const btn = document.querySelector(sel);
    if (!btn) continue;
    const off = dir < 0 ? day <= 1 : day >= month.daysInMonth;
    if (btn.disabled) btn.disabled = false;
    if (off) {
      btn.setAttribute('aria-disabled', 'true');
      const note = dayEdgeNote(dir);
      btn.setAttribute('aria-describedby', note.id);
      btn.title = note.textContent;
    } else {
      btn.removeAttribute('aria-disabled');
      btn.removeAttribute('aria-describedby');
      btn.removeAttribute('title');
    }
  }
}
if ('MutationObserver' in window) {
  const dayButtonsWatch = new MutationObserver(syncDayButtons);
  queueMicrotask(() => DAY_BUTTONS.forEach(([sel]) => {
    const btn = document.querySelector(sel);
    if (btn) dayButtonsWatch.observe(btn, { attributes: true, attributeFilter: ['disabled'] });
  }));
}

[TV, TV_SHORT].forEach((m) => m.addEventListener('change', () => { if (view !== 'home') renderView(); }));

/**
 * Bring a department into view after a save, an undo or the meeting. The DOR board fitted to
 * a TV already shows every row: a row in full view stays put (the header and logo with it).
 */
function revealFunction(fnId, opts = {}) {
  if (view === 'home') { revealHomeRow(fnId, { target: opts.notesChanged ? 'issue' : 'matrix' }); return; }
  const y = window.scrollY;
  const r = onTvBoard() ? document.getElementById(`fn-${fnId}`)?.getBoundingClientRect() : null;
  const inView = Boolean(r) && r.top >= 0 && r.bottom <= window.innerHeight;
  revealRow(fnId, opts);
  if (inView && window.scrollY !== y) window.scrollTo({ top: y, behavior: 'instant' });
}

/**
 * The row a save's toast reports on, which the toast keeps clear of: on the DOR
 * board the function's whole group (every KPI row, so a KPI added in Board setup
 * isn't under the toast); when the group is taller than the room above the toast
 * (a phone), the KPI row that was saved. The department's row on the dashboard.
 */
function savedRow(fnId, { notesChanged = false, kpiRowId = null } = {}) {
  if (view === 'home') {
    return document.querySelector(notesChanged
      ? `.home-app tr.iss-row.is-first[data-fn="${CSS.escape(fnId)}"]`
      : `.home-app tr[data-home-row="${CSS.escape(fnId)}"]`);
  }
  const group = document.getElementById(`fn-${fnId}`);
  if (!group) return null;
  const toastEl = document.querySelector('[data-toasts] .toast');
  const room = (toastEl ? toastEl.getBoundingClientRect().top : window.innerHeight) - 12;
  if (group.getBoundingClientRect().height <= room) return group;
  const rowSel = kpiRowId ? `.kpirow[data-kpi="${CSS.escape(kpiRowId)}"]` : '.kpirow';
  return group.querySelector(rowSel) ?? group.querySelector('.kpirow') ?? group;
}

/** The hash Enter numbers was opened with: "enter", "enter/switch", "enter/people", "enter/people/status". */
const enterHashFor = (r) => (r.mode === 'switch' ? 'enter/switch' : r.fnId ? `enter/${r.fnId}${r.focus ? `/${r.focus}` : ''}` : 'enter');
/** Which form a hash asks for (the function, or the person picker), whatever box it lands on. */
const formOf = (hash) => hash.split('/').slice(0, 2).join('/');

function applyRoute() {
  const r = parseRoute();

  if (isEnterOpen() && r.view !== 'enter' && isDirty()) {
    // Back button with unsaved numbers: stay on the form, and say why.
    history.pushState({ depth: depth() + 1 }, '', urlFor(day, enterHash));
    showLeave();
    return;
  }

  if (isEnterOpen() && r.view === 'enter' && formOf(enterHashFor(r)) !== formOf(enterHash) && isDirty()) {
    // The URL asks for another function's form while this one has unsaved numbers: the URL
    // goes back to this form, and the form asks. Leave without saving goes on to the other one.
    const to = urlFor(r.day, location.hash.slice(1));
    history.replaceState(history.state, '', urlFor(day, enterHash));
    showLeave('goto', () => { history.replaceState(history.state, '', to); applyRoute(); });
    return;
  }

  if (r.badDate) {
    // A date outside this month's data: say so quietly and fix the URL.
    showDateNote(`That date isn't in this month's data. Showing ${formatDayMedium(month, r.day)}.`);
    history.replaceState(history.state, '', urlFor(r.day, location.hash.slice(1)));
  }

  // Anything opening on top of the board (Detail, Enter, Meeting, Customize: by a
  // link, the URL or Forward) ends the tour without counting it as seen.
  if (isTourOpen() && r.view !== 'board') endTour('interrupted');

  if (r.day !== day || r.page !== view || r.area !== area) {
    day = r.day;
    view = r.page;
    area = r.area;
    renderView();
  }

  if (r.view === 'enter') {
    const hash = enterHashFor(r);
    // Already open on another function's form (the URL changed): that form takes its place.
    const switching = isEnterOpen() && formOf(hash) !== formOf(enterHash);
    enterHash = hash;
    // A function's form with nobody chosen on this device opens as that function's owner,
    // for this one form only (enter.js), wherever it was opened from.
    if (!isEnterOpen() || switching) openEnter(month, { fnId: r.fnId, day: r.day, mode: r.mode, focus: r.focus });
  } else if (isEnterOpen()) closeEnter();

  if (r.view === 'detail') openDetail(month, r.fnId, r.day);
  else if (isDetailOpen()) closeDetail({ restoreFocus: r.view === 'board' });

  if (r.view === 'meeting') {
    if (!isMeetingOpen()) scrollBeforeMeeting = window.scrollY; // End meeting puts the board back here
    openMeeting(month, r.day, r.slide);
  } else if (isMeetingOpen()) closeMeeting();

  if (r.view === 'customize') openCustomize();
  else if (isCustomizeOpen()) closeCustomize();
}

function onPop() {
  backPending = false;
  clearTimeout(backTimer);
  if (afterPop) { const f = afterPop; afterPop = null; f(); return; }
  applyRoute();
}

function refreshAll() {
  month = store.getMonth();
  renderView();
  refreshDetail(month);
  refreshActions(); // an open register redraws after an Undo
}

/* ---------- Sheets over the board keep its place ---------- */

let scrollBeforeMeeting = 0;
// The Action register and the meeting minutes: closing them puts the board back
// where it was when the first one opened (a row's focus or a redraw while it was
// open must not leave the headline cut off at the top).
const PLACE_KEEPING_SHEETS = ['action-register', 'minutes'];
let boardScroll = null;
function keepBoardPlace() {
  const showModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function showModalKeepingPlace(...args) {
    // A double click's second click, landing on the sheet's dimmed area, doesn't close it again.
    dialogOpenedAt.set(this, performance.now());
    if (PLACE_KEEPING_SHEETS.includes(this.id) && boardScroll === null && !document.querySelector('dialog[open]') && !isMeetingOpen()) {
      boardScroll = window.scrollY;
    }
    return showModal.apply(this, args);
  };
  document.addEventListener('close', (e) => {
    if (!PLACE_KEEPING_SHEETS.includes(e.target?.id) || boardScroll === null) return;
    const y = boardScroll;
    // After the sheet's own focus return, which can scroll its row to the middle.
    requestAnimationFrame(() => {
      const open = [...document.querySelectorAll('dialog[open]')];
      if (open.some((d) => PLACE_KEEPING_SHEETS.includes(d.id))) return; // the other one is on top now: it puts the board back
      boardScroll = null;
      if (open.length || isMeetingOpen()) return; // went on to another screen, which places the board itself
      window.scrollTo({ top: y, behavior: 'instant' });
    });
  }, true);
}

/* ---------- Saving and Undo ---------- */

let lastSave = null; // { fnId, fnName, day, previous, dayLabel }

/** "Fri, Feb 27" with a no-break space between the month and the day, so a toast never splits it. */
const keepDayTogether = (label) => String(label ?? '').replace(/ (\d{1,2})$/, '\u00a0$1');

function undoSave() {
  if (!lastSave) return;
  const { fnId, fnName, day: savedDay, previous, dayLabel } = lastSave;
  store.restoreEntry(fnId, savedDay, previous);
  lastSave = null;
  setUndoable(null);
  refreshAll();
  revealFunction(fnId);
  toast(`Undone. ${fnName} is back to how it was for ${keepDayTogether(dayLabel)}.`, { near: () => savedRow(fnId) });
}

function onSaved(info) {
  lastSave = info;
  setUndoable({ fnId: info.fnId, day: info.day });
  month = store.getMonth();
  returnToBoard(info.day, () => {
    renderView();
    revealFunction(info.fnId, { notesChanged: info.notesChanged });
    // Storage blocked (private window): the numbers show for this visit, and the toast says how long.
    // The saved figure is repeated, so a slip (an extra digit) is seen once more, with the question its
    // box asked: "Saved 147,360 for Operations, Fri, Feb 27. That's 9 times the goal." A KPI added in
    // Board setup is named: "Saved 96.5% for Quality, First pass yield, Fri, Feb 27."
    const figure = info.figure ? ` ${info.figure}` : '';
    // The date never breaks between its month and day ("Fri, Feb\u00a027").
    const dayWords = keepDayTogether(info.dayLabel);
    const what = info.figureKpi ? `${info.fnName}, ${info.figureKpi}` : info.fnName;
    const check = info.figureCheck ? ` ${info.figureCheck}` : '';
    const message = info.persisted === false
      ? `Saved${figure} for this visit.${check} This browser isn't saving, so it will clear when the page reloads.`
      : `Saved${figure} for ${what}, ${dayWords}.${check}`;
    // The toast keeps clear of the saved row (on a phone it would cover its Action).
    toast(message, { actionLabel: 'Undo', onAction: undoSave, near: () => savedRow(info.fnId, info) });
  });
}

/* ---------- Board interactions ---------- */

function wireBoard() {
  // At the month's first or last day the arrow is aria-disabled: it keeps focus, and a press says why.
  const step = (b, delta) => () => {
    if (b.getAttribute('aria-disabled') === 'true') sayDayEdge(delta);
    else stepDay(delta, b);
  };
  document.querySelectorAll('[data-prev], [data-home-prev]').forEach((b) => b.addEventListener('click', step(b, -1)));
  document.querySelectorAll('[data-next], [data-home-next]').forEach((b) => b.addEventListener('click', step(b, 1)));

  // Matrix rows open Detail from anywhere in the row (the name is the keyboard target).
  document.addEventListener('click', (e) => {
    const tr = e.target.closest('.home-app tr[data-home-row]');
    if (tr && !e.target.closest('a, button')) navigate(tr.dataset.homeRow);
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('.term-btn')) return; // definitions never open the row
    const open = e.target.closest('[data-open-detail]');
    if (open && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
      e.preventDefault();
      navigate(open.dataset.openDetail);
      return;
    }
    // The needs line ("…no action yet: Operations"): straight to that KPI's Add action.
    const needs = e.target.closest('[data-needs-kpi]');
    if (needs && goToAddAction(needs.dataset.needsKpi)) { e.preventDefault(); return; }
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      e.preventDefault();
      const row = document.getElementById(`fn-${jump.dataset.jump}`);
      row?.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
      row?.querySelector('.fn-link')?.focus({ preventScroll: true });
      // A mouse click shows no focus ring: the row it landed on gets the saved row's mint wash.
      if (row) washRow(row);
      return;
    }
    if (e.target.closest('[data-undo-save]')) { e.preventDefault(); undoSave(); return; }
    const setStatus = e.target.closest('[data-set-status]');
    if (setStatus) { e.preventDefault(); navigate(`enter/${setStatus.dataset.setStatus}/status`); return; }
    if (e.target.closest('[data-enter]')) { e.preventDefault(); navigate('enter'); return; }
    if (e.target.closest('[data-run-meeting]')) {
      e.preventDefault();
      document.getElementById('dor-menu')?.hidePopover?.(); // the phone's Menu has it too
      requestFullscreen(); // needs the click's user activation
      navigate('meeting/0');
      return;
    }
    const reset = e.target.closest('[data-reset]');
    if (reset) resetDemo(reset);
    // The board's Action cell: add an action for that KPI in the Action register.
    const addAct = e.target.closest('[data-add-action]');
    // Detail and the meeting handle their own Add action buttons.
    if (addAct && addAct.dataset.addAction && !addAct.closest('#detail, #meeting')) { e.preventDefault(); openActions({ addFor: addAct.dataset.addAction, kpiId: addAct.dataset.addKpi || null }); return; }
    // A new KPI's "Enter the first one": Enter numbers, on that KPI's box.
    const first = e.target.closest('[data-enter-kpi]');
    if (first) {
      e.preventDefault();
      // Nobody chosen on this device yet: the form opens as that function's owner (Not you? is one
      // tap away). Nothing is remembered, so the board's "Your row" stays as it was.
      // A function's main KPI lands on its main box (numbers); an added KPI on its own box.
      navigate(`enter/${first.dataset.enterKpi}/${first.dataset.enterKpiId ? `kpi:${first.dataset.enterKpiId}` : 'numbers'}`);
      return;
    }
    // The owner cell opens the function's detail, like the function cell beside it.
    const ownerCell = e.target.closest('.fgroup .v2cell--owner');
    if (ownerCell) { e.preventDefault(); navigate(ownerCell.closest('.fgroup').dataset.fn); return; }
    const goDay = e.target.closest('[data-go-day]');
    if (goDay && !e.metaKey && !e.ctrlKey) { e.preventDefault(); goToDay(Number(goDay.dataset.goDay)); return; }
    // A board row's charts open that KPI's detail too (they sit above the row's link so hover still works).
    const chartRow = e.target.closest('.kpirow .mini');
    if (chartRow) { e.preventDefault(); navigate(chartRow.closest('.kpirow').dataset.kpi); return; }
    if (e.target.closest('[data-open-actions]')) { e.preventDefault(); document.getElementById('dor-menu')?.hidePopover?.(); openActions(); return; }
    if (e.target.closest('[data-open-minutes]')) { e.preventDefault(); document.getElementById('dor-menu')?.hidePopover?.(); openMinutes(); return; }
    if (e.target.closest('[data-open-setup]')) { e.preventDefault(); document.getElementById('dor-menu')?.hidePopover?.(); openSetup(); return; }
    if (e.target.closest('[data-customize]')) {
      e.preventDefault();
      document.getElementById('dor-menu')?.hidePopover?.();
      navigate('customize');
      return;
    }
    const more = e.target.closest('[data-topbar-more]');
    // The Menu button opens the menu, and closes it when it's open (a double click leaves it open).
    if (more) {
      e.preventDefault(); // opened and closed here, never by the browser as the menu's invoker
      if (toggleMenu(document.getElementById('dor-menu'), more, 240)) document.querySelector('#dor-menu .menu-item')?.focus();
      return;
    }
    if (e.target.closest('[data-start-tour]')) {
      e.preventDefault();
      document.getElementById('dor-menu')?.hidePopover?.();
      const drawer = document.getElementById('drawer');
      if (drawer?.open) drawer.close();
      runTour();
    }
  });
}

const shownEl = (el) => Boolean(el) && (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null);

/**
 * The saved row's mint wash (board.js revealRow), on a row a summary link brought into view:
 * a color-only Web Animation, so it plays under reduced motion too (a little longer there).
 * The solid status blocks keep their color; the wash is on the cells around them.
 */
function washRow(row) {
  const wash = getComputedStyle(document.documentElement).getPropertyValue('--saved-wash').trim() || '#dff3ed';
  row.querySelectorAll('.cell, .v2cell:not(.v2cell--block)').forEach((cell) => {
    const from = getComputedStyle(cell).backgroundColor;
    cell.animate(
      [{ backgroundColor: wash }, { backgroundColor: wash, offset: 0.45 }, { backgroundColor: from }],
      { duration: reduceMotion() ? 2400 : 1800, easing: 'ease-out' },
    );
  });
}

/**
 * A KPI row's Add action, from the needs line: the page scrolls so the Action cell sits in the
 * middle of what's in view between the sticky column header and, on a phone, the Enter numbers
 * bar, and focus goes to Add action (Enter there adds the action). False when that row has no
 * Add action showing (Customize hid Issue and action, or it has one now): the link does what it did.
 */
function goToAddAction(kpiId) {
  if (!kpiId) return false;
  const row = document.querySelector(`[data-rows2] .kpirow[data-kpi="${CSS.escape(kpiId)}"]`);
  const add = row?.querySelector('[data-add-action]');
  if (!shownEl(add)) return false;
  const head = document.querySelector('.board2-head');
  const bar = document.querySelector('.mobile-bar');
  const top = shownEl(head) && getComputedStyle(head).position === 'sticky' ? head.getBoundingClientRect().height : 0;
  const bottom = shownEl(bar) ? bar.getBoundingClientRect().top : window.innerHeight;
  const space = bottom - top;
  const cell = add.closest('.v2cell') ?? add;
  // The whole cell when it fits ("Needs an action" over the button), else the button itself.
  const box = (cell.getBoundingClientRect().height <= space - 24 ? cell : add).getBoundingClientRect();
  const y = window.scrollY + box.top - top - Math.max(12, (space - box.height) / 2);
  window.scrollTo({ top: Math.max(0, Math.round(y)), behavior: reduceMotion() ? 'auto' : 'smooth' });
  add.focus({ preventScroll: true });
  washRow(row); // where it landed, for a mouse click too
  return true;
}

/**
 * Where focus goes back to after the meeting: the Run meeting button that shows, or on a phone
 * (where it lives in the Menu or the drawer) the button that opens that menu; else the page.
 */
function runMeetingReturn() {
  const home = view === 'home';
  const sels = home ? ['.home-app [data-run-meeting]', '[data-open-drawer]'] : ['.app [data-run-meeting]', '[data-topbar-more]'];
  return sels.map((sel) => [...document.querySelectorAll(sel)].find(shownEl)).find(Boolean)
    ?? document.getElementById(home ? 'home' : 'board');
}

/** Start this view's tour; its last card can open the form straight away. */
function runTour() {
  startTour(view, { month, day, onTry: () => navigate('enter') });
}

/** Show another day (the ‹ › buttons and the date picker). */
function goToDay(next) {
  if (next === day) return;
  history.replaceState(history.state, '', urlFor(next, location.hash.slice(1)));
  day = next;
  showDateNote(null);
  renderView();
}

/** The date text opens the browser's own date picker, limited to the month's data. */
function wireDatePicker() {
  // The dashboard's picker and the DOR board's picker work the same way.
  for (const [btnSel, inputSel] of [['[data-date-pick]', '[data-date-input]'], ['[data-board-date-pick]', '[data-board-date-input]']]) {
    const input = document.querySelector(inputSel);
    const btn = document.querySelector(btnSel);
    if (!input || !btn) continue;
    btn.addEventListener('click', () => {
      try { input.showPicker(); } catch { input.focus(); }
    });
    input.addEventListener('change', () => {
      const d = store.dayFromIso(month, input.value);
      if (d !== null) goToDay(d);
      else input.value = store.isoForDay(month, day);
    });
  }
}

/** ‹ or ›: one day back or ahead, never past the month's first or last day in the data. */
function stepDay(delta, btn = null) {
  const next = Math.min(month.daysInMonth, Math.max(1, day + delta));
  if (next === day) return;
  history.replaceState(history.state, '', urlFor(next, location.hash.slice(1)));
  day = next;
  showDateNote(null);
  renderView();
  // The arrow keeps focus, even at the month's end (it's aria-disabled there, never disabled).
  if (btn?.isConnected && document.activeElement !== btn && (document.activeElement === document.body || !document.activeElement)) {
    btn.focus({ preventScroll: true });
  }
}

/**
 * Start the demo over: clear everything this demo saved on the device (numbers,
 * Board setup, actions, minutes, Customize, tours) and load a clean page. The
 * snapshot rides along in sessionStorage so the fresh page can offer Undo.
 */
let resetting = false;
/** Where "Start the demo over" was pressed, so Undo can put focus back there after its reload. */
const RESET_FROM_KEY = 'dor.reset.from';
const RESET_FROM = {
  menu: ['[data-topbar-more]'],
  // The line under the board, or the board's footer strip (where a TV shows it); the one pressed
  // first, the other if that one doesn't show after the reload.
  foot: ['.board-foot [data-reset]', '.board2-foot [data-reset]'],
  strip: ['.board2-foot [data-reset]', '.board-foot [data-reset]'],
  settings: ['[data-settings]', '[data-chip]', '[data-open-drawer]'],
};
function resetDemo(from = null) {
  // A double click must not run twice: the second pass would find nothing and overwrite Undo with nothing.
  if (resetting) return;
  resetting = true;
  const where = from?.closest('#dor-menu') ? 'menu' : from?.closest('#settings-pop') ? 'settings' : from?.closest('.board2-foot') ? 'strip' : from?.closest('.board-foot') ? 'foot' : null;
  const snapshot = store.resetEverything();
  const saved = Object.keys(snapshot.local).length + Object.keys(snapshot.session).length > 0;
  let undoKept = !saved; // nothing saved: nothing to undo
  if (saved) {
    const raw = JSON.stringify(snapshot);
    try {
      sessionStorage.setItem(store.RESET_UNDO_KEY, raw);
      // Checked, not assumed: a full or blocked sessionStorage drops it (a photo from Board setup can fill it).
      undoKept = sessionStorage.getItem(store.RESET_UNDO_KEY) === raw;
      if (undoKept && where) sessionStorage.setItem(RESET_FROM_KEY, where);
    } catch { undoKept = false; }
  }
  // Without its snapshot the fresh page can't offer Undo: the URL says so once (it's read and removed on load).
  const params = new URLSearchParams(view === 'dor' ? 'view=dor' : '');
  if (!undoKept) params.set(RESET_NO_UNDO_PARAM, '1');
  location.replace(`${location.pathname}${params.size ? `?${params}` : ''}`);
}

/** In the URL after a reset whose Undo couldn't be kept. */
const RESET_NO_UNDO_PARAM = 'started-over';
/** Read and taken out of the URL at once, before any link on the page is built from it. */
const startedOverNoUndo = (() => {
  const params = new URLSearchParams(location.search);
  if (!params.has(RESET_NO_UNDO_PARAM)) return false;
  params.delete(RESET_NO_UNDO_PARAM);
  history.replaceState(history.state, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  return true;
})();
/** After a reset without Undo: say so. Returns true when shown. */
function afterResetNoUndo() {
  if (!startedOverNoUndo) return false;
  toast("Started over. Undo isn't available in this browser.");
  return true;
}

/** After a reset: say so, with Undo. Returns true when this load follows a reset. */
function afterReset() {
  let raw = null;
  let from = null;
  try {
    raw = sessionStorage.getItem(store.RESET_UNDO_KEY);
    if (!raw) return false; // (after Undo, afterRestore reads where the reset was pressed)
    from = sessionStorage.getItem(RESET_FROM_KEY);
    sessionStorage.removeItem(store.RESET_UNDO_KEY);
    sessionStorage.removeItem(RESET_FROM_KEY);
  } catch { return false; }
  let snapshot = null;
  try { snapshot = JSON.parse(raw); } catch { return false; }
  const el = toast("Demo started over. Everything is back to the plant's February workbook. Take the tour anytime.", {
    actionLabel: 'Undo',
    duration: 20000,
    onAction: () => {
      const missed = restoreAll(snapshot);
      // The fresh page says so once (read and cleared on load), and puts focus back where the reset was pressed.
      // When something couldn't be written back, it says what, never "Your changes are back."
      let told = false;
      try {
        sessionStorage.setItem(RESTORED_KEY, missed.length ? JSON.stringify({ missed }) : '1');
        told = true;
        if (from) sessionStorage.setItem(RESET_FROM_KEY, from);
      } catch { /* said through the URL instead */ }
      if (!told && missed.length) {
        const params = new URLSearchParams(location.search);
        params.set(RESTORE_MISSED_PARAM, missed.join(','));
        location.replace(`${location.pathname}?${params}${location.hash}`);
        return;
      }
      location.reload();
    },
  });
  // A fresh page has focus nowhere: start it on Undo, one key away (the toast waits while it has focus).
  el?.querySelector('.toast-action')?.focus({ preventScroll: true });
  return true;
}

const RESTORED_KEY = 'dor.reset.restored';
/** In the URL after an Undo that couldn't put everything back and couldn't say so in sessionStorage. */
const RESTORE_MISSED_PARAM = 'not-restored';
/** Read and taken out of the URL at once (like started-over). */
const restoreMissedInUrl = (() => {
  const params = new URLSearchParams(location.search);
  if (!params.has(RESTORE_MISSED_PARAM)) return null;
  const missed = String(params.get(RESTORE_MISSED_PARAM) ?? '').split(',').filter(Boolean);
  params.delete(RESTORE_MISSED_PARAM);
  history.replaceState(history.state, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  return missed;
})();

/** What each saved part of the demo is, in the words a person would use. */
const PART_WORDS = [
  ['dor.overlay.', 'the numbers and notes entered on this device'],
  ['dor.setup.', 'Board setup'],
  ['dor.actions.', 'the Action register'],
  ['dor.meetings.', 'the meeting minutes'],
  ['dor.customize.', 'Customize'],
  ['dor.identity.', "who's entering"],
];
const partOf = (key) => PART_WORDS.find(([prefix]) => key.startsWith(prefix))?.[1] ?? 'other settings';

/**
 * Undo on "Start the demo over": write everything back (store.restoreEverything), then check each
 * key and try any that didn't land on its own, so one that won't save doesn't hold the rest back.
 * Returns the parts that still couldn't be put back ("Board setup"), each once.
 */
function restoreAll(snapshot) {
  store.restoreEverything(snapshot);
  const missed = new Set();
  let back = 0;
  for (const name of ['local', 'session']) {
    let area = null;
    try { area = name === 'local' ? localStorage : sessionStorage; } catch { /* blocked */ }
    for (const [k, v] of Object.entries(snapshot?.[name] ?? {})) {
      if (typeof v !== 'string') continue;
      let ok = false;
      try {
        if (area.getItem(k) !== v) area.setItem(k, v);
        ok = area.getItem(k) === v;
      } catch { ok = false; }
      if (ok) back += 1;
      else missed.add(partOf(k));
    }
  }
  // Nothing at all came back: one word for it, so the message never says "everything else is back".
  return missed.size && !back ? ['all'] : [...missed];
}

/** After Undo on "Start the demo over": one line saying it worked, or what it couldn't put back. Returns true when shown. */
function afterRestore() {
  let flag = null;
  let from = null;
  try {
    flag = sessionStorage.getItem(RESTORED_KEY);
    from = sessionStorage.getItem(RESET_FROM_KEY);
    sessionStorage.removeItem(RESTORED_KEY);
    sessionStorage.removeItem(RESET_FROM_KEY);
  } catch { /* the URL may still say what wasn't put back */ }
  let missed = restoreMissedInUrl;
  if (!missed && flag && flag !== '1') {
    try { missed = JSON.parse(flag).missed ?? null; } catch { missed = null; }
  }
  if (!flag && !missed) return false;
  if (missed?.includes('all')) {
    toast("Undo couldn't put your changes back. This browser isn't saving.");
  } else if (missed?.length) {
    // Said plainly, with what did come back: "Undo couldn't put back the numbers and notes entered
    // on this device. This browser isn't saving everything. The rest is back."
    const list = missed.length < 2 ? missed[0] : `${missed.slice(0, -1).join(', ')} and ${missed[missed.length - 1]}`;
    toast(`Undo couldn't put back ${list}. This browser isn't saving everything. The rest is back.`);
  } else toast('Your changes are back.');
  // Focus goes back to what started it: the Menu button (its menu is closed now), the footer's
  // "Start the demo over", or Settings. Never <body>.
  const back = (RESET_FROM[from] ?? []).map((sel) => [...document.querySelectorAll(sel)].find(shownEl)).find(Boolean);
  (back ?? document.getElementById('board'))?.focus();
  return true;
}

/* ---------- Popovers: How to read, and term definitions ---------- */

/** Put a popover just under (or above) its button, inside the viewport. */
function placeNear(pop, btn, maxWidth) {
  const r = btn.getBoundingClientRect();
  const w = Math.min(maxWidth, window.innerWidth - 32);
  pop.style.width = `${w}px`;
  const left = Math.min(Math.max(16, r.left), window.innerWidth - w - 16);
  pop.style.left = `${left}px`;
  // Taller than the window: it scrolls inside, so its last line can be reached.
  pop.style.maxHeight = 'calc(100vh - 32px)';
  pop.style.overflowY = 'auto';
  const h = pop.offsetHeight;
  const below = r.bottom + 8;
  const above = r.top - h - 8;
  // Under the button; else over it; else as low as the window allows, wholly on screen.
  const top = below + h <= window.innerHeight - 8 ? below : above >= 8 ? above : Math.max(16, window.innerHeight - h - 16);
  pop.style.top = `${top}px`;
  pop.style.transformOrigin = `${Math.max(12, r.left - left + 12)}px ${top < r.top ? 'bottom' : 'top'}`;
}

function wireHowTo() {
  const pop = document.getElementById('how-to-read');
  const btn = document.querySelector('[popovertarget="how-to-read"]');
  const gloss = month.glossary ?? {};
  // After the board's own words (KPI, KPAs, in index.html): the plant file's terms, in meeting
  // order, under the names the board shows ("DL" is "Total direct labor" on the board).
  pop.querySelector('[data-glossary]').insertAdjacentHTML('beforeend', ['TRIR', 'DL', 'Scrap %', 'Earned hours']
    .filter((k) => gloss[k])
    .map((k) => `<div><dt>${esc(k === 'DL' ? termName(k) : k)}</dt><dd>${esc(gloss[k])}</dd></div>`).join(''));
  pop.querySelector('[data-states]').innerHTML = [
    [ON, 'The number met its goal.'],
    [OFF, 'The number missed its goal: below goal when higher is better, above goal when lower is better. Talk about it in the meeting.'],
    [NOT_ENTERED, 'Nobody has entered this number yet.'],
    [NO_GOAL, 'A number was entered, but there is no goal to compare it with.'],
    [NO_PRODUCTION, "The plant wasn't scheduled to run that day."],
    [NOT_TRACKED, 'A KPI added in Board setup, on a day before it was added.'],
  ].map(([s, text]) => `<li>${statusMarkup(s, { tag: 'span' })}<span>${esc(text)}</span></li>`).join('')
    // The accountability rule, in the same list: a miss needs someone's next 24 hours.
    + `<li>${statusMarkup(OFF, { tag: 'span', word: 'Needs an action' })}<span>Off goal, and nobody has written what happens in the next 24 hours. Adding an action clears it.</span></li>`;

  /**
   * The button's line: the button and what follows it there (Take the tour, Board setup, Your row).
   * The panel never covers it, so the button and those links stay in view, focus ring and all.
   */
  const lineRect = () => {
    const rects = [btn, ...[...btn.parentElement.children].slice([...btn.parentElement.children].indexOf(btn) + 1)]
      .filter((el) => el.getClientRects().length)
      .map((el) => el.getBoundingClientRect());
    return { top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)) };
  };
  /**
   * Under the line, as tall as the room under it allows: it scrolls inside, with Got it in view.
   * Only a window too short for that (under 240px of room) puts it over the line instead. Phones get
   * a bottom sheet (CSS) that stops under the line.
   */
  const place = () => {
    const line = lineRect();
    if (narrow()) {
      pop.removeAttribute('style');
      const room = window.innerHeight - Math.max(0, line.bottom) - 8;
      pop.style.maxHeight = `${Math.floor(Math.min(window.innerHeight * 0.78, Math.max(room, 200)))}px`;
      return;
    }
    const r = btn.getBoundingClientRect();
    const w = Math.min(440, window.innerWidth - 32);
    const left = Math.min(Math.max(16, r.left), window.innerWidth - w - 16);
    pop.style.width = `${w}px`;
    pop.style.left = `${left}px`;
    pop.style.overflowY = 'auto';
    const below = Math.max(8, line.bottom + 8);
    const roomBelow = window.innerHeight - below - 16;
    const roomAbove = line.top - 8 - 16;
    const up = roomBelow < 240 && roomAbove > roomBelow;
    pop.style.maxHeight = `${Math.floor(Math.max(120, up ? roomAbove : roomBelow))}px`;
    const top = up ? line.top - 8 - pop.offsetHeight : below;
    pop.style.top = `${top}px`;
    pop.style.transformOrigin = `${Math.max(12, r.left - left + 12)}px ${up ? 'bottom' : 'top'}`;
  };

  /**
   * A dialog, like the ⓘ definitions: opening it (click or key) moves focus to its title, so it's
   * read at once. Tab goes on to Got it, then out to Take the tour, and leaving closes it. Esc and
   * Got it close it and put focus back on the button; a click elsewhere keeps its own focus.
   */
  const title = pop.querySelector('.popover-title');
  let closeVia = null;
  pop.addEventListener('beforetoggle', (e) => { if (e.newState === 'open') requestAnimationFrame(place); });
  pop.addEventListener('toggle', (e) => {
    if (e.newState === 'open') {
      closeVia = null;
      place();
      if (pop.matches(':popover-open')) title.focus({ preventScroll: true });
      return;
    }
    const via = closeVia;
    closeVia = null;
    const a = document.activeElement;
    if (via && btn.isConnected && (!a || a === document.body || a === btn || pop.contains(a))) btn.focus({ preventScroll: true });
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    closeVia = 'esc';
    pop.hidePopover();
  });
  pop.querySelector('.popover-close')?.addEventListener('click', () => { closeVia = 'got-it'; });
  // Tab (or a click) on to something else closes it. Back to its own button (Shift+Tab) keeps it:
  // the button sits above it, in view.
  pop.addEventListener('focusout', (e) => {
    const to = e.relatedTarget;
    if (!to || pop.contains(to) || to === btn) return;
    if (pop.matches(':popover-open')) pop.hidePopover();
  });
  window.addEventListener('resize', () => { if (pop.matches(':popover-open')) place(); });
  // Scrolling never closes it; it follows its button (a phone's sheet grows as the line scrolls up).
  window.addEventListener('scroll', () => { if (pop.matches(':popover-open')) place(); }, { passive: true });
}

function wireTerms() {
  const pop = document.getElementById('term-pop');
  const title = pop.querySelector('[data-term-title]');
  const text = pop.querySelector('[data-term-text]');
  let owner = null;
  let openedVia = 'click';
  let hideTimer = null;
  let homeTimer = null;
  let focusInside = false;
  let dismissed = { at: 0, owner: null, via: 'click' };

  /**
   * The definition opens right after its button in the page, so a screen reader reaches it next
   * (and inside a modal, Detail or Enter numbers, it lives in that dialog). A click or a key moves
   * focus to its title, so it's read at once: the dialog is named by the term and described by its
   * definition. Tab moves on from there (and closes it); Esc closes it and focus goes back to the
   * button. Hover leaves focus where it is.
   */
  const show = (btn, via = 'click') => {
    clearTimeout(hideTimer);
    clearTimeout(homeTimer);
    if (pop.previousElementSibling !== btn) {
      if (pop.matches(':popover-open')) pop.hidePopover();
      btn.after(pop);
    }
    if (owner && owner !== btn) owner.setAttribute('aria-expanded', 'false');
    owner = btn;
    openedVia = via;
    title.textContent = btn.dataset.term;
    text.textContent = btn.dataset.definition;
    btn.setAttribute('aria-expanded', 'true');
    // Opened from its button: a press on that button isn't a press outside it, so a click there
    // closes it (below) and a double click's second press doesn't light-dismiss it.
    if (!pop.matches(':popover-open')) showPopoverFrom(pop, btn);
    placeNear(pop, btn, 320);
    if (via === 'click') title.focus({ preventScroll: true });
  };
  const hide = () => { if (pop.matches(':popover-open')) pop.hidePopover(); };

  pop.addEventListener('beforetoggle', (e) => {
    if (e.newState === 'closed') focusInside = pop.contains(document.activeElement);
  });
  pop.addEventListener('toggle', (e) => {
    if (e.newState === 'closed' && owner) {
      const btn = owner;
      btn.setAttribute('aria-expanded', 'false');
      dismissed = { at: Date.now(), owner: btn, via: openedVia };
      owner = null;
      // Closed with focus in it (Esc, Enter numbers' Esc): back to its button. A click elsewhere keeps its own focus.
      const a = document.activeElement;
      if (focusInside && btn.isConnected && (!a || a === document.body || pop.contains(a))) btn.focus({ preventScroll: true });
      focusInside = false;
      // Once its fade is over, it goes back to the end of the page (a redraw of its row can't take it along).
      homeTimer = setTimeout(() => { if (!pop.matches(':popover-open') && pop.parentElement !== document.body) document.body.append(pop); }, 200);
    }
  });
  // Esc in the definition: it closes, and focus goes back to its button (the dialog under it stays open).
  pop.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    focusInside = true;
    const btn = owner;
    hide();
    btn?.focus({ preventScroll: true });
  });
  // Tab (or a click) on to something else: the definition closes behind it.
  pop.addEventListener('focusout', (e) => {
    const to = e.relatedTarget;
    if (!to || pop.contains(to) || to === owner) return;
    hide();
  });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.term-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    // Keyboard (Enter/Space): a plain toggle.
    const isOpenFor = owner === btn && pop.matches(':popover-open');
    if (e.detail === 0) {
      if (isOpenFor) hide(); else show(btn, 'click');
      return;
    }
    // Pointer: a tap on the open term's own button closes it (light dismiss
    // already did on pointerdown). If hover opened it, the tap pins it open.
    const justClosed = dismissed.owner === btn && Date.now() - dismissed.at < 350;
    if (justClosed && dismissed.via === 'click') return;
    if (isOpenFor && openedVia === 'click') hide(); else show(btn, 'click');
  }, true);
  // Hover: a short delay so passing over a button doesn't flash it open.
  document.addEventListener('pointerover', (e) => {
    const btn = e.target.closest?.('.term-btn');
    if (!btn || e.pointerType !== 'mouse') return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (owner !== btn) show(btn, 'hover'); }, 250);
  });
  document.addEventListener('pointerout', (e) => {
    const btn = e.target.closest?.('.term-btn');
    if (!btn || e.pointerType !== 'mouse' || btn.contains(e.relatedTarget)) return;
    clearTimeout(hideTimer);
    if (owner === btn && openedVia === 'hover') hideTimer = setTimeout(() => { if (!pop.matches(':hover')) hide(); }, 200);
  });
  pop.addEventListener('pointerleave', () => { if (openedVia === 'hover') hideTimer = setTimeout(hide, 200); });
  window.addEventListener('scroll', () => { if (owner) placeNear(pop, owner, 320); }, { passive: true, capture: true });
}

/**
 * A message in the Action register keeps clear of the action it's about: the row that has
 * focus and, for an action, its echo under "From the board" (where the board's Action cell
 * now shows it). toast.js scrolls the register's list or moves the message to the top of the
 * sheet when it would cover them.
 */
function registerNear() {
  const dlg = document.getElementById('action-register');
  const a = document.activeElement;
  if (!dlg?.open || !a || !dlg.contains(a)) return null;
  const row = a.closest('[data-ar-item]') ?? a;
  const id = row.getAttribute('data-ar-item');
  const action = id ? listActions().find((x) => x.id === id) : null;
  const card = action?.fnId ? dlg.querySelector(`[data-ar-update="${CSS.escape(action.fnId)}"]`)?.closest('.ar-bcard') : null;
  const echo = card
    ? [...card.querySelectorAll('.ar-alist li')].find((li) => li.querySelector('.ar-alist-text')?.textContent.trim() === String(action.text ?? '').trim()) ?? card
    : null;
  return [row, echo].filter(Boolean);
}

/* ---------- Start ---------- */

async function init() {
  try {
    month = await store.load();
  } catch (err) {
    document.querySelector('[data-summary-lead]').textContent = `${err.message} Reload the page to try again.`;
    return;
  }
  initToast();
  keepBoardPlace();
  initDetail({
    onClose: closeView,
    // Detail's Edit: an added KPI's box, the issue box (Issue and action's Edit), or the top of the form.
    // Edit numbers lands on the Plant total box (or the added KPI's box); Issue and action's Edit on the issue box.
    onEdit: (fnId, d, kpiId, focus) => {
      const land = kpiId ? `kpi:${kpiId}${focus === 'issue' ? ':issue' : ''}` : focus === 'issue' ? 'issue' : 'numbers';
      navigate(`enter/${fnId}/${land}`, { toDay: d });
    },
  });
  initEnter({
    onCancel: closeView,
    onSaved,
    // Nobody to enter for (every function hidden): back to the board, with Board setup open over it.
    onSetup: () => returnToBoard(day, () => openSetup()),
    onSwitched: (person) => {
      closeView();
      requestAnimationFrame(() => { renderView(); toast(`Now entering as ${person.name}.`); });
    },
  });
  initMeeting({
    onSlide: (n) => history.replaceState(history.state, '', urlFor(day, `meeting/${n}`)),
    onExit: (fnId, { ended = false } = {}) => {
      // Already on its way out (Esc then Exit, a double click): one step back, never two.
      if (afterPop || backPending) return;
      // A message from the meeting never carries into the minutes or back onto the board.
      dismissAll();
      // Leaving full screen resizes the window, so scroll once it has settled.
      const settled = leaveFullscreen();
      const scrollTo = () => settled.then(() => requestAnimationFrame(() => {
        if (ended) {
          // End meeting: the minutes open over the board, which is back where it was
          // before the meeting (its headline in view), with focus on Run meeting.
          window.scrollTo({ top: scrollBeforeMeeting, behavior: 'instant' });
          runMeetingReturn()?.focus({ preventScroll: true });
          return;
        }
        const row = !fnId ? null : view === 'home'
          ? document.querySelector(`.home-app tr[data-home-row="${fnId}"]`)
          : document.getElementById(`fn-${fnId}`);
        if (row) {
          row.scrollIntoView({ block: 'center' });
          row.querySelector('.fn-link, .mx-link')?.focus({ preventScroll: true });
        } else {
          window.scrollTo(0, 0);
          runMeetingReturn()?.focus({ preventScroll: true });
        }
      }));
      if (depth() > 0) { afterPop = () => { applyRoute(); scrollTo(); }; goBack(); }
      else { navigate('', { replace: true }); scrollTo(); }
    },
  });

  const first = parseRoute();
  day = first.day;
  view = first.page;
  area = first.area;
  renderView();
  wireBoard();
  wireShell({
    getMonth: () => month,
    onArea: (a) => {
      area = a;
      const params = new URLSearchParams(location.search);
      if (a === 'all') params.delete('area'); else params.set('area', a);
      history.replaceState(history.state, '', `${location.pathname}?${params}${location.hash}`);
      renderView();
    },
    onExport: (kind) => {
      if (kind === 'csv') {
        const name = downloadCsv(month, day, area);
        toast(`Downloaded ${name}${area === 'all' ? '' : ` (area: ${AREA_OPTIONS.find((o) => o.id === area).name})`}.`);
      } else {
        printDay(month, day);
      }
    },
    onSwitchPerson: () => navigate('enter/switch'),
  });
  wireHowTo();
  wireTerms();
  wireDatePicker();
  // Customize changed what the board draws (text size, which columns show): draw it again.
  // Listening before initCustomize, so its first apply redraws a board drawn without the
  // settings (a load with no paint cache yet): hidden Issue and action, Large text.
  let czTimer;
  window.addEventListener('dor:customized', () => { clearTimeout(czTimer); czTimer = setTimeout(() => { if (view === 'dor') renderView(); }, 120); });
  initCustomize({ onClose: closeView });
  // Demo features that live on this device: the Action Register, meeting minutes, and Board setup.
  initActions({
    getMonth: () => month,
    getDay: () => day,
    toast: (message, opts = {}) => toast(message, { near: registerNear, ...opts }),
    openMinutes: (id) => openMinutes(id),
    enterFor: (fnId) => navigate(`enter/${fnId}`),
    // An action was added, changed or removed: the board's Action cells follow.
    onChange: () => { month = store.getMonth(); renderView(); refreshDetail(month); },
  });
  initRecorder({ getMonth: () => month, getDay: () => day, toast, addAction, openActions });
  initSetup({
    getMonth: () => month,
    getDay: () => day,
    toast,
    onChange: () => { month = store.getMonth(); renderView(); },
  });
  window.addEventListener('popstate', onPop);
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(refreshMeeting, 150); });
  applyRoute();
  // Right after "Start the demo over", the Undo message comes first; the tour waits for Take the tour.
  if (!afterReset() && !afterResetNoUndo() && !afterRestore()) autoTour();
}

/**
 * First visit to each view: the tour starts by itself, once, and only on the
 * board itself (never over Detail, Enter numbers, Meeting or Customize).
 * ?tour=off keeps it away; ?tour=1 runs it again.
 */
function autoTour() {
  const params = new URLSearchParams(location.search);
  const ask = params.get('tour');
  // Arrived from the other view's tour: one greeting, no second tour back to back.
  let arrived = null;
  try { arrived = sessionStorage.getItem(ARRIVAL_KEY); sessionStorage.removeItem(ARRIVAL_KEY); } catch { /* storage blocked */ }
  if (arrived === view) {
    toast(view === 'dor'
      ? 'This is the DOR board. Take its tour anytime from Take the tour.'
      : 'This is the new dashboard. Take its tour anytime from How it works.');
  }
  if (ask === 'off' || parseRoute().view !== 'board' || isTourOpen()) return;
  if (ask === '1' || !tourSeen(view)) {
    runTour();
    if (ask === '1') {
      // ?tour=1 is for this visit only: a reload or a shared link won't re-run it.
      params.delete('tour');
      history.replaceState(history.state, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
    }
  }
}

init();
