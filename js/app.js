// App shell: routing, history, and the wiring between screens.
// URL = ?date=YYYY-MM-DD (production day) + hash for the open view:
//   (none) board · #safety detail · #enter[/fn] enter numbers · #meeting[/n] meeting

import * as store from './store.js';
import { clearIdentity, snapshotIdentity, restoreIdentity } from './identity.js';
import { renderBoard, revealRow, setUndoable } from './board.js';
import { initDetail, openDetail, closeDetail, isDetailOpen, refreshDetail } from './detail.js';
import { initEnter, openEnter, closeEnter, isEnterOpen, isDirty, showLeave } from './enter.js';
import { initMeeting, openMeeting, closeMeeting, isMeetingOpen, requestFullscreen, refreshMeeting, leaveFullscreen } from './meeting.js';
import { initToast, toast } from './toast.js';
import { formatDayMedium } from './format.js';
import { renderHome, revealHomeRow, AREA_OPTIONS } from './home.js';
import { renderNav, wireShell, setNavState } from './shell.js';
import { downloadCsv, printDay } from './export.js';
import { esc, statusMarkup } from './ui.js';
import { ON, OFF, NOT_ENTERED, NO_GOAL, NO_PRODUCTION } from './status.js';

// We decide where the page scrolls after views close (the saved row).
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

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
  const hash = decodeURIComponent(location.hash.slice(1));
  const [v, arg, extra] = hash.split('/');
  if (v === 'enter') {
    return {
      ...base,
      view: 'enter',
      fnId: store.functionById(month, arg) ? arg : null,
      mode: arg === 'switch' ? 'switch' : 'enter',
      focus: extra === 'status' ? 'status' : null,
    };
  }
  if (v === 'meeting') return { ...base, view: 'meeting', slide: Math.max(0, Math.min(month.functions.length, Number(arg) || 0)) };
  if (store.functionById(month, v)) return { ...base, view: 'detail', fnId: v };
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

/** Close the open view: step back if we pushed it, otherwise replace. */
function closeView() {
  if (depth() > 0) history.back();
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
    note.textContent = text ?? '';
    note.hidden = !text;
  });
}

/** Render whichever page is showing: the dashboard or the DOR board. */
function renderView() {
  document.documentElement.dataset.view = view;
  setNavState({ area, view }); // every link built below keeps the day and area
  if (view === 'home') renderHome(month, day, area);
  else renderBoard(month, day);
  renderNav(month, day, view);
}

/** Bring a department into view after a save, an undo or the meeting. */
function revealFunction(fnId, opts = {}) {
  if (view === 'home') revealHomeRow(fnId, { target: opts.notesChanged ? 'issue' : 'matrix' });
  else revealRow(fnId, opts);
}

function applyRoute() {
  const r = parseRoute();

  if (isEnterOpen() && r.view !== 'enter' && isDirty()) {
    // Back button with unsaved numbers: stay on the form, and say why.
    history.pushState({ depth: depth() + 1 }, '', urlFor(day, enterHash));
    showLeave();
    return;
  }

  if (r.badDate) {
    // A date outside this month's data: say so quietly and fix the URL.
    showDateNote(`That date isn't in this month's data. Showing ${formatDayMedium(month, r.day)}.`);
    history.replaceState(history.state, '', urlFor(r.day, location.hash.slice(1)));
  }

  if (r.day !== day || r.page !== view || r.area !== area) {
    day = r.day;
    view = r.page;
    area = r.area;
    renderView();
  }

  if (r.view === 'enter') {
    enterHash = r.mode === 'switch' ? 'enter/switch' : r.fnId ? `enter/${r.fnId}${r.focus ? `/${r.focus}` : ''}` : 'enter';
    if (!isEnterOpen()) openEnter(month, { fnId: r.fnId, day: r.day, mode: r.mode, focus: r.focus });
  } else if (isEnterOpen()) closeEnter();

  if (r.view === 'detail') openDetail(month, r.fnId, r.day);
  else if (isDetailOpen()) closeDetail({ restoreFocus: r.view === 'board' });

  if (r.view === 'meeting') openMeeting(month, r.day, r.slide);
  else if (isMeetingOpen()) closeMeeting();
}

function onPop() {
  if (afterPop) { const f = afterPop; afterPop = null; f(); return; }
  applyRoute();
}

function refreshAll() {
  month = store.getMonth();
  renderView();
  refreshDetail(month);
}

/* ---------- Saving and Undo ---------- */

let lastSave = null; // { fnId, fnName, day, previous, dayLabel }

function undoSave() {
  if (!lastSave) return;
  const { fnId, fnName, day: savedDay, previous, dayLabel } = lastSave;
  store.restoreEntry(fnId, savedDay, previous);
  lastSave = null;
  setUndoable(null);
  refreshAll();
  revealFunction(fnId);
  toast(`Undone. ${fnName} is back to how it was for ${dayLabel}.`);
}

function onSaved(info) {
  lastSave = info;
  setUndoable({ fnId: info.fnId, day: info.day });
  month = store.getMonth();
  returnToBoard(info.day, () => {
    renderView();
    revealFunction(info.fnId, { notesChanged: info.notesChanged });
    toast(`Saved. ${info.fnName} is on the board for ${info.dayLabel}.`, { actionLabel: 'Undo', onAction: undoSave });
  });
}

/* ---------- Board interactions ---------- */

function wireBoard() {
  document.querySelectorAll('[data-prev], [data-home-prev]').forEach((b) => b.addEventListener('click', () => stepDay(-1)));
  document.querySelectorAll('[data-next], [data-home-next]').forEach((b) => b.addEventListener('click', () => stepDay(1)));

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
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      e.preventDefault();
      const row = document.getElementById(`fn-${jump.dataset.jump}`);
      row?.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
      row?.querySelector('.fn-link')?.focus({ preventScroll: true });
      return;
    }
    if (e.target.closest('[data-undo-save]')) { e.preventDefault(); undoSave(); return; }
    const setStatus = e.target.closest('[data-set-status]');
    if (setStatus) { e.preventDefault(); navigate(`enter/${setStatus.dataset.setStatus}/status`); return; }
    if (e.target.closest('[data-enter]')) { e.preventDefault(); navigate('enter'); return; }
    if (e.target.closest('[data-run-meeting]')) {
      e.preventDefault();
      requestFullscreen(); // needs the click's user activation
      navigate('meeting/0');
      return;
    }
    if (e.target.closest('[data-reset]')) resetDemo();
  });
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
  const input = document.querySelector('[data-date-input]');
  document.querySelector('[data-date-pick]').addEventListener('click', () => {
    try { input.showPicker(); } catch { input.focus(); }
  });
  input.addEventListener('change', () => {
    const d = store.dayFromIso(month, input.value);
    if (d !== null) goToDay(d);
    else input.value = store.isoForDay(month, day);
  });
}

function stepDay(delta) {
  const next = Math.min(month.daysInMonth, Math.max(1, day + delta));
  if (next === day) return;
  history.replaceState(history.state, '', urlFor(next, location.hash.slice(1)));
  day = next;
  showDateNote(null);
  renderView();
  // Focus never drops to <body>: a button that just disabled hands focus over.
  const prev = document.querySelector(view === 'home' ? '[data-home-prev]' : '[data-prev]');
  const nextBtn = document.querySelector(view === 'home' ? '[data-home-next]' : '[data-next]');
  if (prev.disabled && document.activeElement === prev) nextBtn.focus();
  if (nextBtn.disabled && document.activeElement === nextBtn) prev.focus();
}

function resetDemo() {
  const identity = snapshotIdentity();
  const { ok, snapshot } = store.resetDemo();
  clearIdentity();
  lastSave = null;
  setUndoable(null);
  refreshAll();
  toast(ok ? "Demo data reset. The board shows the workbook's numbers again." : 'This browser blocked the reset.', {
    actionLabel: ok ? 'Undo' : undefined,
    onAction: () => {
      store.restoreOverlay(snapshot);
      restoreIdentity(identity);
      refreshAll();
      toast('Undone. Your entries are back.');
    },
  });
}

/* ---------- Popovers: How to read, and term definitions ---------- */

/** Put a popover just under (or above) its button, inside the viewport. */
function placeNear(pop, btn, maxWidth) {
  const r = btn.getBoundingClientRect();
  const w = Math.min(maxWidth, window.innerWidth - 32);
  pop.style.width = `${w}px`;
  const left = Math.min(Math.max(16, r.left), window.innerWidth - w - 16);
  pop.style.left = `${left}px`;
  const h = pop.offsetHeight;
  const below = r.bottom + 8;
  pop.style.top = `${below + h > window.innerHeight - 8 && r.top - h - 8 > 8 ? r.top - h - 8 : below}px`;
  pop.style.transformOrigin = `${Math.max(12, r.left - left + 12)}px top`;
}

function wireHowTo() {
  const pop = document.getElementById('how-to-read');
  const btn = document.querySelector('[popovertarget="how-to-read"]');
  const gloss = month.glossary ?? {};
  pop.querySelector('[data-glossary]').innerHTML = ['TRIR', 'DL', 'Earned hours']
    .filter((k) => gloss[k])
    .map((k) => `<div><dt>${esc(k)}</dt><dd>${esc(gloss[k])}</dd></div>`).join('');
  pop.querySelector('[data-states]').innerHTML = [
    [ON, 'The number met its goal.'],
    [OFF, 'The number missed its goal: below goal when higher is better, above goal when lower is better. Talk about it in the meeting.'],
    [NOT_ENTERED, 'Nobody has entered this number yet.'],
    [NO_GOAL, 'A number was entered, but there is no goal to compare it with.'],
    [NO_PRODUCTION, "The plant wasn't scheduled to run that day."],
  ].map(([s, text]) => `<li>${statusMarkup(s, { tag: 'span' })}<span>${esc(text)}</span></li>`).join('');

  // Phones get a bottom sheet (CSS). Desktop gets a popover under the button.
  const place = () => {
    if (narrow()) { pop.removeAttribute('style'); return; }
    placeNear(pop, btn, 440);
  };
  pop.addEventListener('beforetoggle', (e) => { if (e.newState === 'open') requestAnimationFrame(place); });
  pop.addEventListener('toggle', (e) => { if (e.newState === 'open') place(); });
  window.addEventListener('resize', () => { if (pop.matches(':popover-open')) place(); });
  // Scrolling never closes it; on desktop it follows its button.
  window.addEventListener('scroll', () => { if (pop.matches(':popover-open') && !narrow()) place(); }, { passive: true });
}

function wireTerms() {
  const pop = document.getElementById('term-pop');
  const title = pop.querySelector('[data-term-title]');
  const text = pop.querySelector('[data-term-text]');
  let owner = null;
  let openedVia = 'click';
  let hideTimer = null;
  let dismissed = { at: 0, owner: null, via: 'click' };

  const show = (btn, via = 'click') => {
    clearTimeout(hideTimer);
    // Inside a modal (Detail, Enter) the popover must live in that dialog.
    const host = btn.closest('dialog') ?? document.body;
    if (pop.parentElement !== host) {
      if (pop.matches(':popover-open')) pop.hidePopover();
      host.append(pop);
    }
    if (owner && owner !== btn) owner.setAttribute('aria-expanded', 'false');
    owner = btn;
    openedVia = via;
    title.textContent = btn.dataset.term;
    text.textContent = btn.dataset.definition;
    btn.setAttribute('aria-expanded', 'true');
    if (!pop.matches(':popover-open')) pop.showPopover();
    placeNear(pop, btn, 320);
  };
  const hide = () => { if (pop.matches(':popover-open')) pop.hidePopover(); };

  pop.addEventListener('toggle', (e) => {
    if (e.newState === 'closed' && owner) {
      owner.setAttribute('aria-expanded', 'false');
      dismissed = { at: Date.now(), owner, via: openedVia };
      owner = null;
    }
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

/* ---------- Start ---------- */

async function init() {
  try {
    month = await store.load();
  } catch (err) {
    document.querySelector('[data-summary-lead]').textContent = `${err.message} Reload the page to try again.`;
    return;
  }
  initToast();
  initDetail({
    onClose: closeView,
    onEdit: (fnId, d) => navigate(`enter/${fnId}`, { toDay: d }),
  });
  initEnter({
    onCancel: closeView,
    onSaved,
    onSwitched: (person) => {
      closeView();
      requestAnimationFrame(() => { renderView(); toast(`Now entering as ${person.name}.`); });
    },
  });
  initMeeting({
    onSlide: (n) => history.replaceState(history.state, '', urlFor(day, `meeting/${n}`)),
    onExit: (fnId) => {
      // Leaving full screen resizes the window, so scroll once it has settled.
      const settled = leaveFullscreen();
      const scrollTo = () => settled.then(() => requestAnimationFrame(() => {
        const row = !fnId ? null : view === 'home'
          ? document.querySelector(`.home-app tr[data-home-row="${fnId}"]`)
          : document.getElementById(`fn-${fnId}`);
        if (row) {
          row.scrollIntoView({ block: 'center' });
          row.querySelector('.fn-link, .mx-link')?.focus({ preventScroll: true });
        } else {
          window.scrollTo(0, 0);
          document.querySelector(view === 'home' ? '.home-app [data-run-meeting]' : '.app [data-run-meeting]')?.focus({ preventScroll: true });
        }
      }));
      if (depth() > 0) { afterPop = () => { applyRoute(); scrollTo(); }; history.back(); }
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
  window.addEventListener('popstate', onPop);
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(refreshMeeting, 150); });
  applyRoute();
}

init();
