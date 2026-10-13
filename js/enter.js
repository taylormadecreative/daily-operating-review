// Enter numbers: 1) who's entering, 2) one form for one function and day,
// 3) save -> back to the board with a toast and Undo (handled by app.js).
// Built for a phone at 6:40 AM: big inputs, goals shown, live status,
// plain-word errors, Enter moves to the next box, only Save saves, and a
// warning only when something would be lost. Boxes show numbers the way the
// board does; a number that looks like a slip (an extra digit, a ratio typed
// as a percent, over 100%) gets a question under its box, never a block.

import { AREA_IDS, saveEntry, notesFor, NO_ISSUE } from './store.js?v=20261013-151156';
import { getIdentity, setIdentity } from './identity.js?v=20261013-151156';
import { compareToGoal, isProductionDay, ON, OFF, NOT_ENTERED, NO_PRODUCTION } from './status.js?v=20261013-151156';
import {
  toInputValue, parseInput, formatGoal, plainLabel, formatDayMedium, formatDayLong, monthSoFar, isPercent,
  glossaryTerm, formatPair, formatValue,
} from './format.js?v=20261013-151156';
import { toast } from './toast.js?v=20261013-151156';
import { esc, statusMarkup, termButton } from './ui.js?v=20261013-151156';
import { statusWord } from './status.js?v=20261013-151156';

const AREA_NAME = { plant: 'Plant total', mold: 'Mold', bond: 'Bond', prime: 'Prime', compounding: 'Compounding' };
const AREA_KEYS = ['mold', 'bond', 'prime', 'compounding'];
const NUMBER_KEYS = ['plant', ...AREA_KEYS, 'month'];
// KPIs added in Board setup get keys like "x-nearmiss"; a function added there has one number a day.
const extraKey = (k) => `x-${k.kpiId}`;
const extraOf = (fn, key) => (String(key).startsWith('x-') ? (fn.extraKpis ?? []).find((k) => extraKey(k) === key) ?? null : null);
const numberKeys = (fn) => [...(fn.custom ? ['plant'] : NUMBER_KEYS), ...(fn.extraKpis ?? []).map(extraKey)];

let dlg;
let handlers;
let month;
let st = null; // { step, fnId, requestedFnId, day, initial, exact, mode, focus, as }
let leaveAction = 'close'; // what "Leave without saving" does: 'close', 'switch' or 'goto'
let leaveGoto = null;      // 'goto': opens the form the URL asked for
let announceTimer;
let keepSelection = false; // the issue box's words were just selected on focus
let barWatch = null;       // measures the sticky top and Save bar for scroll-padding
let lastField = null;      // the box, choice or list the person was last in (Keep editing goes back to it)

/** Who this form is for: the person picked for this one form (st.as), else the one this device remembers. */
const whoNow = () => st?.as ?? getIdentity(month);

export function initEnter(h) {
  handlers = h;
  dlg = document.getElementById('enter');
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });
  dlg.addEventListener('click', onClick);
  dlg.addEventListener('input', onInput);
  dlg.addEventListener('change', onChange);
  dlg.addEventListener('keydown', onKeydown);
  dlg.addEventListener('submit', (e) => e.preventDefault()); // only the Save button saves
  // Off goal with "No new issues to report" in the issue box: focusing it selects the
  // words, so typing replaces them (a mouse click doesn't undo the selection).
  dlg.addEventListener('focusin', (e) => {
    if (!onForm() || e.target.id !== 'e-issue' || !issueOwed()) return;
    const box = e.target;
    box.select();
    keepSelection = box.value.trim() !== '';
  });
  dlg.addEventListener('mouseup', (e) => {
    if (keepSelection && e.target.id === 'e-issue') e.preventDefault();
    keepSelection = false;
  });
  // Chrome doesn't scroll to a box that's inside the screen but under the sticky
  // Save bar (scroll-padding only steers boxes it does scroll to), so check after each focus.
  dlg.addEventListener('focusin', (e) => { if (onForm()) keepFocusClear(e.target); });
  dlg.addEventListener('focusin', (e) => {
    if (!onForm()) return;
    if (e.target.matches?.('.field-input, .field-textarea, .day-select, input[type="radio"]')) lastField = e.target;
  });
  // The sticky top and Save bar: focus scrolling keeps a box clear of both (scroll-padding in enter.css).
  if (typeof ResizeObserver !== 'undefined') {
    barWatch = new ResizeObserver(() => {
      const top = dlg.querySelector('.enter-top');
      const bar = dlg.querySelector('.enter-bar');
      if (top) dlg.style.setProperty('--enter-top-h', `${Math.round(top.getBoundingClientRect().height)}px`);
      if (bar) dlg.style.setProperty('--enter-bar-h', `${Math.round(bar.getBoundingClientRect().height)}px`);
    });
  }
  window.addEventListener('beforeunload', (e) => {
    if (dlg.open && isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });
}

export const isEnterOpen = () => Boolean(dlg?.open);

/**
 * Is the form showing? Events from anything else (the person picker, or a
 * closed form the browser's own undo reaches into) are ignored.
 */
const onForm = () => Boolean(st && st.step === 'form' && dlg.open);

/** Board setup's stand-in names for an owner nobody has named yet ("Owner name", "Owner", empty): not a person. */
const PLACEHOLDER_OWNER = /^\s*(owner(\s+name)?)?\s*$/i;
const namedOwner = (f) => Boolean(f) && !PLACEHOLDER_OWNER.test(String(f.owner ?? ''));

/**
 * as: { name, functionId } to enter as for this one form without remembering
 * it on the device. With nobody chosen, a function's form defaults to its owner.
 */
export function openEnter(m, { fnId = null, day, mode = 'enter', focus = null, as = null }) {
  month = m;
  lastField = null;
  // One rule, wherever the form is opened from (Detail's Edit numbers, Enter the first one,
  // Set status): a function's form with nobody chosen on this device opens as that
  // function's owner, for this form only (Not you? is one tap away). Nothing is remembered.
  // A function whose owner isn't named yet (Board setup's "Owner name") has nobody to open as:
  // the form asks who's entering.
  if (!as && mode !== 'switch' && fnId && !getIdentity(month)) {
    const owner = month.functions.find((f) => f.id === fnId);
    if (namedOwner(owner)) as = { name: owner.owner, functionId: owner.id };
  }
  const person = mode === 'switch' ? null : as ?? getIdentity(month);
  // mode 'switch': only choose who is entering, then close.
  const step = mode === 'switch' || !person ? 'who' : 'form';
  // focus 'status': came from "Set status", so the form lands on the status control.
  // leaving: Save, Cancel or "Nothing to save" has started closing the form; nothing else closes or saves it again.
  st = { step, mode, requestedFnId: fnId, fnId: fnId ?? person?.functionId ?? null, day, initial: null, focus, as: mode === 'switch' ? null : as, leaving: false, xOff: {} };
  leaveAction = 'close';
  leaveGoto = null;
  if (st.step === 'who') renderWho();
  else renderForm();
  if (!dlg.open) dlg.showModal();
  focusLanding();
}

/** A focused box under the sticky top or the Save bar scrolls just clear of it (a tall one shows its top). */
function keepFocusClear(el) {
  const scroller = dlg.querySelector('.enter-scroll');
  // A term's definition floats over the form (it sits beside its ⓘ button in the page): nothing to scroll for.
  if (!scroller?.contains(el) || el.closest('.enter-top, .enter-bar, [popover]')) return;
  requestAnimationFrame(() => {
    if (document.activeElement !== el) return;
    const top = (dlg.querySelector('.enter-top')?.getBoundingClientRect().bottom ?? 0) + 8;
    const bottom = (dlg.querySelector('.enter-bar')?.getBoundingClientRect().top ?? window.innerHeight) - 16;
    const r = (el.closest('.segmented') ?? el).getBoundingClientRect();
    let by = 0;
    if (r.bottom > bottom) by = Math.min(r.bottom - bottom, r.top - top);
    else if (r.top < top) by = r.top - top;
    if (by) scroller.scrollBy({ top: Math.round(by), behavior: 'instant' });
  });
}

/** Put the cursor in one box, scrolled to the middle of the screen. */
function focusBox(el) {
  requestAnimationFrame(() => {
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
  });
}

/**
 * Where the form opens: the title; the Plant total box (Detail's Edit numbers);
 * one added KPI's box (kpi:ID) or its issue box, unfolded (kpi:ID:issue); the
 * issue box; or the status control ("Set status").
 */
function focusLanding() {
  const focus = String(st?.focus ?? '');
  if (st?.step === 'form' && focus.startsWith('kpi:')) {
    const [, id, part] = focus.split(':');
    if (part === 'issue') {
      const box = dlg.querySelector(`#e-xi-${CSS.escape(id)}`);
      if (box) {
        const fold = box.closest('details');
        if (fold) fold.open = true;
        focusBox(box);
        return;
      }
    }
    const input = dlg.querySelector(`#e-x-${CSS.escape(id)}`);
    if (input) { focusBox(input); return; }
  }
  if (st?.step === 'form' && focus === 'numbers') {
    const input = dlg.querySelector('#e-plant');
    if (input) { focusBox(input); return; }
  }
  if (st?.step === 'form' && st.focus === 'issue') {
    requestAnimationFrame(() => {
      const box = dlg.querySelector('#e-issue');
      if (!box) { focusTitle(); return; }
      box.scrollIntoView({ block: 'center' });
      box.focus({ preventScroll: true });
    });
    return;
  }
  if (st?.step === 'form' && st.focus === 'status') {
    requestAnimationFrame(() => {
      const set = dlg.querySelector('.field--status:not(.field--xstatus)');
      const radio = set?.querySelector('input:checked') ?? set?.querySelector('input:not(:disabled)');
      if (!radio) { focusTitle(); return; }
      set.scrollIntoView({ block: 'center' });
      radio.focus({ preventScroll: true });
      // A mouse click on "Set status" shows no focus ring, so mark where it landed
      // until the person picks a status or moves on.
      set.classList.add('is-landed');
      const done = () => set.classList.remove('is-landed');
      set.addEventListener('change', done, { once: true });
      set.addEventListener('focusout', (e) => { if (!set.contains(e.relatedTarget)) done(); });
    });
    return;
  }
  focusTitle();
}

export function closeEnter() {
  if (!dlg.open) return;
  clearTimeout(announceTimer);
  dlg.close();
  st = null;
  lastField = null;
  // The closed form goes too: the browser's own undo (Cmd/Ctrl+Z on the board) would otherwise
  // reach back into its boxes. A message showing in the sheet stays (toast.js moves it on).
  [...dlg.children].forEach((child) => { if (!child.matches('[data-toasts]')) child.remove(); });
}

function focusTitle() {
  requestAnimationFrame(() => dlg.querySelector('#enter-title')?.focus({ preventScroll: true }));
}

/* ---------- Step 1: who's entering ---------- */

function renderWho() {
  const who = whoNow();
  // People to pick: each function's named owner (one not named yet in Board setup isn't a person).
  const people = month.functions.filter(namedOwner);
  // Nobody to pick: say why in one line, with the way to fix it.
  const none = !month.functions.length
    ? 'Every function is hidden. Put them back in Board setup.'
    : 'No function has an owner named yet. Name them in Board setup.';
  dlg.innerHTML = `
    <div class="enter-scroll">
      <header class="enter-top">
        <p class="enter-kicker">${st.mode === 'switch' ? 'Switch person' : 'Enter numbers'}</p>
        <button class="icon-btn" type="button" data-close aria-label="Close without entering">
          <svg class="icon" aria-hidden="true" focusable="false"><use href="#g-close"></use></svg>
        </button>
      </header>
      <div class="enter-body">
        <h2 class="enter-title" id="enter-title" tabindex="-1">Who's entering?</h2>
        ${people.length ? `
        <p class="enter-sub">Pick who's entering. This phone or computer will remember the choice.</p>
        <ul class="who-list">
          ${people.map((f) => `
            <li><button class="who-btn${who?.functionId === f.id ? ' is-current' : ''}" type="button" data-person="${esc(f.id)}">
              <span class="who-name">${esc(f.owner)}</span>
              <span class="who-fn">${esc(f.name)}</span>
            </button></li>`).join('')}
        </ul>` : `
        <p class="enter-sub enter-none">${esc(none)}</p>
        <p class="enter-none-tools"><button class="btn btn--primary" type="button" data-open-board-setup>Open Board setup</button></p>`}
      </div>
    </div>`;
}

/* ---------- Step 2: the form ---------- */

function fnObj() { return month.functions.find((f) => f.id === st.fnId); }
const kpiFor = (fn, key) => extraOf(fn, key)?.kpiDaily ?? (key === 'month' ? fn.kpiMonthly : fn.kpiDaily);

/**
 * A stored number as the board shows it, for a box: "12564" (no thousands
 * commas, which a later edit could turn into a decimal), "96.0" (the % sits
 * beside the box). Same precision as the board (format.js formatPair).
 */
function boxText(v, goal, kpi) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  const a = formatPair(v, goal, kpi).actual;
  return a ? a.replace(/,/g, '').replace(/%$/, '') : toInputValue(v, kpi);
}

/** A number in the board's words for a message: "12,564", "96.0%" (null when there's none). */
const shownFigure = (v, goal, kpi) => (typeof v === 'number' ? formatPair(v, goal, kpi).actual : null);

/**
 * Current stored values for the function on the form's day, as box text at the
 * board's precision, plus the exact numbers behind them: a box saved untouched
 * keeps its exact number (st.exact), never the rounded text.
 */
function storedValues(fn, day) {
  const values = {};
  const exact = {};
  const put = (key, v, kpi) => {
    values[key] = boxText(v, goalOf(fn, key, day).goal, kpi);
    if (typeof v === 'number') exact[key] = { text: values[key], value: v };
  };
  for (const a of AREA_IDS) {
    const row = (fn.daily[a] ?? []).find((r) => r.day === day);
    put(a, row?.actual, fn.kpiDaily);
  }
  const mrow = (fn.monthToDate ?? []).find((r) => r.day === day);
  put('month', mrow?.actual, fn.kpiMonthly);
  const n = notesFor(fn, day);
  values.issue = n.problem ?? '';
  values.action = n.action ?? '';
  values.issueStatus = n.status ?? '';
  for (const k of fn.extraKpis ?? []) {
    const row = k.daily.plant.find((r) => r.day === day);
    put(extraKey(k), row?.actual, k.kpiDaily);
    const xn = notesFor(k, day);
    values[`xi-${k.kpiId}`] = xn.problem ?? '';
    values[`xa-${k.kpiId}`] = xn.action ?? '';
    values[`xs-${k.kpiId}`] = xn.status ?? '';
  }
  return { values, exact };
}

/* ---------- Reading a box ---------- */

const MAX_PERCENT = 1000;

/** Numbers in the form's own words, with separators: "1,000", "1.5", "147,360". */
const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
/** A suggested percent as the words show it ("1,000"); the box gets the plain digits. */
const pctWords = (s) => NUM.format(Number(s));

/** Units that count whole things: a fraction there is probably a slip ("1.5 Quality incidents"). */
const WHOLE_UNITS = new Set(['count', 'people', 'parts']);

/**
 * The number in one box: an untouched prefilled box is the board's exact number
 * (it shows rounded, as the board does), anything else is read from the text as
 * format.js reads it. A percent box takes up to 1,000% (labor efficiency runs
 * over 100%); over 100% gets a question under the box (slipCheck), never a block.
 */
function boxValue(fn, key) {
  const input = dlg.querySelector(`#e-${key}`);
  const ex = st.exact?.[key];
  if (ex && input.value.trim() === ex.text) return { ok: true, value: ex.value, untouched: true };
  return parseInput(input.value, kpiFor(fn, key), goalOf(fn, key, st.day).goal);
}

/** "9" from 8.68, "1,000" from 1000.2: how many times bigger, in a whole number. */
const times = (r) => NUM.format(Math.round(r));

/** The day's numbers already in the month for one box (not the form's day), for the extra-digit check. */
function otherDays(fn, key) {
  const x = extraOf(fn, key);
  const series = x ? x.daily.plant : AREA_KEYS.includes(key) || key === 'plant' ? fn.daily[key] ?? [] : [];
  return series.filter((r) => r.day !== st.day && !r.beforeStart && typeof r.actual === 'number' && r.actual > 0).map((r) => r.actual);
}

/**
 * A question under a box when the number looks like a slip; it never blocks Save.
 * -> { suggest } (a likely intended percent, with a Use button) | { check } (a line of words) | {}
 * Either comes with `fact`: the same point said after the fact, for the save message
 * ("Saved 147,360 for Operations, Fri, Feb 27. That's 9 times the goal.").
 */
function slipCheck(fn, key, value, goal, kpi, baseSuggest) {
  if (value === null || value === undefined) return {};
  // The goal at the board's own precision ("93.0%"), not stretched to the typed number's ("93.00%").
  const goalText = () => (typeof goal === 'number' ? formatValue(goal, kpi.unit) : null);
  const goalWords = () => (goalText() ? `The goal is ${goalText()}.` : null);
  if (baseSuggest) return { suggest: baseSuggest, fact: goalWords() };
  const input = dlg.querySelector(`#e-${key}`);
  if (isPercent(kpi)) {
    const n = value * 100;
    // Picked from "Did you mean": no second question about the same number.
    if (input?.dataset.used === input?.value.trim()) return {};
    if (n > 100) return { check: `Over 100%: is ${NUM.format(n)}% right?`, fact: "That's over 100%." };
    const goalPct = typeof goal === 'number' ? goal * 100 : null;
    // 1.03 for 103%: a ratio typed into a percent box, against a goal like 93%.
    if (n >= 1 && n < 10 && goalPct !== null && goalPct >= 50) {
      const asRatio = n * 100;
      if (asRatio <= MAX_PERCENT && Math.abs(Math.log(asRatio / goalPct)) < Math.log(2)) return { suggest: String(Number(asRatio.toFixed(4))), fact: goalWords() };
      const f = formatPair(value, goal, kpi);
      return { check: `Is ${f.actual} right? ${goalWords()}`, fact: goalWords() };
    }
    return {};
  }
  // A count with an extra digit: 3 times the goal, or 3 times the month's highest day so far.
  // Small counts (a 3 against a goal of 1) are real days, not slips: no question under 10.
  if (value >= 10) {
    let line = null;
    if (typeof goal === 'number' && goal > 0 && value >= 3 * goal) line = `That's ${times(value / goal)} times the goal.`;
    else if (key !== 'month') {
      const top = Math.max(0, ...otherDays(fn, key));
      if (top > 0 && value >= 3 * top) line = `That's ${times(value / top)} times the month's highest day so far.`;
    }
    if (line) return { check: line, fact: line };
  }
  // Whole things (incidents, people, parts) with a fraction: probably a slip of the decimal point.
  if (WHOLE_UNITS.has(kpi.unit) && !Number.isInteger(value)) {
    return { check: `Is ${NUM.format(value)} right? Counts are usually whole numbers.`, fact: 'Counts are usually whole numbers.' };
  }
  return {};
}

/** The month-to-date number already on the board for this day (or null): an emptied month box keeps it. */
function keptMonth(fn, day) {
  const r = (fn.monthToDate ?? []).find((x) => x.day === day);
  return typeof r?.actual === 'number' ? r.actual : null;
}

/**
 * A KPI added in Board setup has no goal on the days before it was added. A
 * number typed for one of those production days starts its tracking there, and
 * the board then judges it against the KPI's set goal, so the preview does too.
 */
function setGoalBeforeStart(series, day) {
  const row = series.find((r) => r.day === day);
  if (!row?.beforeStart || isProductionDay(month, day) === false) return null;
  return series.find((r) => typeof r.goal === 'number')?.goal ?? null;
}

function goalOf(fn, key, day) {
  const x = extraOf(fn, key);
  if (x) {
    const series = x.daily.plant;
    return { goal: series.find((r) => r.day === day)?.goal ?? setGoalBeforeStart(series, day), note: null };
  }
  if (key === 'month') {
    const r = (fn.monthToDate ?? []).find((x) => x.day === day);
    return { goal: r?.goal ?? null, note: null };
  }
  const series = fn.daily[key] ?? [];
  const r = series.find((x) => x.day === day);
  const early = fn.custom && key === 'plant' ? setGoalBeforeStart(series, day) : null;
  return { goal: r?.goal ?? early, note: r?.goalNote ?? null };
}

function fieldLabel(fn, key, label) {
  const t = key === 'plant' || key === 'month' ? glossaryTerm(month, kpiFor(fn, key)) : null;
  return `<span class="field-label-row"><label class="field-label" for="e-${key}">${esc(label)}</label>${t ? termButton(t.term, t.definition) : ''}</span>`;
}

function fieldMarkup(fn, key, label, primary, hint = '') {
  const kpi = kpiFor(fn, key);
  const id = `e-${key}`;
  const pct = isPercent(kpi);
  return `
    <div class="field${primary ? ' field--primary' : ''}" data-field="${key}">
      ${fieldLabel(fn, key, label)}
      ${hint ? `<p class="field-hint field-hint--box" id="${id}-hint">${esc(hint)}</p>` : ''}
      <div class="field-row">
        <div class="input-wrap${pct ? ' has-suffix' : ''}">
          <input class="field-input" id="${id}" name="${key}" type="text" inputmode="decimal" autocomplete="off"
            spellcheck="false" enterkeyhint="next">
          ${pct ? '<span class="suffix" aria-hidden="true">%</span>' : ''}
        </div>
        <p class="field-goal" id="${id}-goal"></p>
      </div>
      <p class="field-status" id="${id}-status"></p>
      <p class="field-error" id="${id}-err" hidden></p>
      <p class="field-nudge" id="${id}-nudge" hidden></p>
    </div>`;
}

const MONTH_HINT = "Filled in from the board. Change it only if the month's figure changed.";

function dayOptions() {
  let html = '';
  for (let d = 1; d <= month.daysInMonth; d += 1) {
    const idle = isProductionDay(month, d) === false;
    html += `<option value="${d}"${d === st.day ? ' selected' : ''}>${esc(formatDayMedium(month, d))}${idle ? ' (no production)' : ''}</option>`;
  }
  return html;
}

function renderForm() {
  const fn = fnObj();
  const who = whoNow();
  dlg.innerHTML = `
    <form class="enter-scroll" novalidate>
      <header class="enter-top">
        <p class="enter-as"><span class="enter-as-who">Entering as <strong>${esc(who?.name ?? 'someone')}</strong></span><span class="nowrap enter-as-switch"><span class="enter-as-dot" aria-hidden="true">·</span><button class="btn--text not-you" type="button" data-not-you>Not you?</button></span></p>
        <button class="icon-btn" type="button" data-close aria-label="Close">
          <svg class="icon" aria-hidden="true" focusable="false"><use href="#g-close"></use></svg>
        </button>
      </header>
      <div class="enter-body">
        <h2 class="enter-title" id="enter-title" tabindex="-1" data-form-title></h2>
        <div class="day-pick">
          <label for="e-day">Production day</label>
          <select id="e-day" name="day" class="day-select">${dayOptions()}</select>
          <div class="day-kept-row" data-day-kept-row hidden>
            <p class="day-kept" id="e-day-kept" data-day-kept></p>
            <button class="btn btn--secondary nudge-btn" type="button" data-use-day hidden></button>
          </div>
        </div>
        <p class="enter-sub">Numbers already on the board are filled in. Goals come from the plant's plan. Leave a box empty if you don't have the number yet.</p>

        <fieldset class="group group--primary">
          <legend><span class="group-name">${fn.custom ? "The day's number" : 'Plant total'}</span> <span class="group-note">This number sets the status on the board.${fn.custom ? ' The month is worked out from the days.' : ''}</span></legend>
          ${fieldMarkup(fn, 'plant', plainLabel(fn.kpiDaily), true)}
        </fieldset>

        ${fn.custom ? '' : `<details class="group group--areas" data-areas>
          <summary><span class="group-sum"><span class="group-name">By area</span> <span class="group-note">Optional: Mold, Bond, Prime, Compounding</span></span></summary>
          <div class="area-grid">
            ${AREA_KEYS.map((a) => fieldMarkup(fn, a, AREA_NAME[a], false)).join('')}
          </div>
        </details>

        <fieldset class="group">
          <legend><span class="group-name" data-month-legend></span></legend>
          ${fieldMarkup(fn, 'month', plainLabel(fn.kpiMonthly), false, MONTH_HINT)}
        </fieldset>`}


        ${(fn.extraKpis ?? []).length ? `<fieldset class="group group--extra">
          <legend><span class="group-name">More ${esc(fn.name)} KPIs</span> <span class="group-note">Each has its own status on the board. The month is worked out from the days.</span></legend>
          ${fn.extraKpis.map((k) => `${fieldMarkup(fn, extraKey(k), plainLabel(k.kpiDaily), false)}
          <details class="extra-notes">
            <summary>Issue and action for ${esc(plainLabel(k.kpiDaily))}</summary>
            <div class="field field--text">
              <label class="field-label" for="e-xi-${esc(k.kpiId)}">What's keeping us from the goal?</label>
              <textarea class="field-textarea" id="e-xi-${esc(k.kpiId)}" name="xi-${esc(k.kpiId)}" rows="2"></textarea>
            </div>
            <fieldset class="field field--status field--xstatus">
              <legend class="field-label">Where does it stand?</legend>
              <div class="segmented">
                <label><input type="radio" name="xs-${esc(k.kpiId)}" value="open"><span>Open</span></label>
                <label><input type="radio" name="xs-${esc(k.kpiId)}" value="in-progress"><span>In progress</span></label>
                <label><input type="radio" name="xs-${esc(k.kpiId)}" value="closed"><span>Closed</span></label>
              </div>
            </fieldset>
            <div class="field field--text">
              <label class="field-label" for="e-xa-${esc(k.kpiId)}">What are we doing in the next 24 hours?</label>
              <textarea class="field-textarea" id="e-xa-${esc(k.kpiId)}" name="xa-${esc(k.kpiId)}" rows="2"></textarea>
              <p class="field-hint field-hint--action" id="e-xa-${esc(k.kpiId)}-hint" data-xaction-hint="${esc(k.kpiId)}" aria-live="polite" hidden></p>
            </div>
          </details>`).join('')}
        </fieldset>` : ''}

        <div class="group group--text">
          ${(fn.extraKpis ?? []).length ? `<p class="group-name group-name--text">Issue and action for ${esc(plainLabel(fn.kpiDaily))}</p>` : ''}
          <div class="field field--text">
            <label class="field-label" for="e-issue">What's keeping us from the goal?</label>
            <textarea class="field-textarea" id="e-issue" name="issue" rows="3"></textarea>
            <p class="field-hint field-hint--action field-hint--issue" id="e-issue-hint" data-issue-hint hidden></p>
          </div>
          <fieldset class="field field--status" aria-describedby="e-status-hint">
            <legend class="field-label">Where does it stand?</legend>
            <div class="segmented">
              <label><input type="radio" name="issueStatus" value="open"><span>Open</span></label>
              <label><input type="radio" name="issueStatus" value="in-progress"><span>In progress</span></label>
              <label><input type="radio" name="issueStatus" value="closed"><span>Closed</span></label>
            </div>
            <p class="field-hint" id="e-status-hint" aria-live="polite"></p>
          </fieldset>
          <div class="field field--text">
            <label class="field-label" for="e-action">What are we doing in the next 24 hours?</label>
            <textarea class="field-textarea" id="e-action" name="action" rows="3"></textarea>
            <p class="field-hint field-hint--action" id="e-action-hint" data-action-hint aria-live="polite" hidden></p>
          </div>
        </div>

      </div>

      <div class="enter-bar">
        <div class="enter-bar-inner">
          <p class="form-error" data-form-error role="alert" hidden></p>
          <div class="bar-actions" data-bar-actions>
            <button class="btn btn--quiet" type="button" data-close>Cancel</button>
            <button class="btn btn--primary btn--save" type="button" data-save>Save</button>
          </div>
          <div class="leave-warning" data-leave hidden>
            <p class="leave-text">You have unsaved numbers.</p>
            <div class="leave-actions">
              <button class="btn btn--secondary" type="button" data-keep>Keep editing</button>
              <button class="btn btn--quiet" type="button" data-leave-confirm>Leave without saving</button>
            </div>
          </div>
        </div>
      </div>
      <p class="sr-only" aria-live="polite" data-announce></p>
    </form>`;

  const stored = storedValues(fn, st.day);
  st.exact = stored.exact;
  st.dayRestore = null;
  fillValues(stored.values);
  st.initial = serialize();
  updateDayDependent();
  if (barWatch) {
    barWatch.disconnect();
    dlg.querySelectorAll('.enter-top, .enter-bar').forEach((el) => barWatch.observe(el));
  }
}

function fillValues(values) {
  for (const [k, v] of Object.entries(values)) {
    if (k === 'issueStatus' || k.startsWith('xs-')) {
      dlg.querySelectorAll(`[name="${CSS.escape(k)}"]`).forEach((r) => { r.checked = r.value === v; });
      continue;
    }
    const el = dlg.querySelector(`[name="${k}"]`);
    if (el) el.value = v;
  }
  // Areas stay folded unless there is already something in them.
  const areas = dlg.querySelector('[data-areas]');
  if (areas && AREA_KEYS.some((k) => String(values[k] ?? '').trim())) areas.open = true;
  dlg.querySelectorAll('.extra-notes').forEach((d) => {
    if ([...d.querySelectorAll('textarea')].some((t) => t.value.trim())) d.open = true;
  });
  syncStatusControl();
}

/**
 * The problem status only means something when there is a problem: the control
 * stays off ("Type the problem first.") until one is typed, turns on as you type,
 * and clears if the problem is erased, so nothing is ever saved silently dropped.
 */
function syncStatusControl() {
  const set = dlg.querySelector('.field--status:not(.field--xstatus)');
  if (!set) return;
  // "No new issues to report" is no problem, so there's no status to give it.
  const issueText = dlg.querySelector('#e-issue')?.value ?? '';
  const has = Boolean(issueText.trim()) && !NO_ISSUE.test(issueText);
  set.disabled = !has;
  set.classList.toggle('is-disabled', !has);
  if (!has) dlg.querySelectorAll('[name="issueStatus"]').forEach((r) => { r.checked = false; });
  set.querySelector('.field-hint').textContent = has ? 'Shows with the issue on the board.' : 'Type the problem first.';
  // KPIs added in Board setup: their status is only for a problem too.
  dlg.querySelectorAll('.field--xstatus').forEach((x) => {
    const id = x.querySelector('input')?.name.slice(3);
    const xText = dlg.querySelector(`#e-xi-${CSS.escape(id ?? '')}`)?.value ?? '';
    const hasX = Boolean(xText.trim()) && !NO_ISSUE.test(xText);
    x.disabled = !hasX;
    x.classList.toggle('is-disabled', !hasX);
    if (!hasX) x.querySelectorAll('input').forEach((r) => { r.checked = false; });
  });
  syncActionHint();
}

/** Is the day's number (or the month) off goal in the form as it stands? */
const formOff = () => ['plant', 'month'].some((k) => dlg.querySelector(`#e-${k}`) && evaluate(k).status === OFF);

/**
 * Off goal, and the issue box is empty or says "No new issues to report": the
 * issue is owed. The box says so under it, and focusing it selects its words.
 */
function issueOwed() {
  const box = dlg.querySelector('#e-issue');
  if (!box) return false;
  return formOff() && (!box.value.trim() || NO_ISSUE.test(box.value));
}

/**
 * The "Off goal." line under a text box (the issue box, an action box): `ask` shows it with those
 * words, null hides it. The box is described by the line only while it shows, and a hidden line
 * keeps no words, so a screen reader never hears "Off goal" for a box that's done or on track.
 */
function setOffHint(hint, ask) {
  const box = dlg.querySelector(`#${CSS.escape(hint.id.replace(/-hint$/, ''))}`);
  if (!ask) {
    hint.hidden = true;
    hint.innerHTML = '';
    delete hint.dataset.ask;
    box?.removeAttribute('aria-describedby');
    return;
  }
  // Shown first, then filled, so a polite live line is read when it appears.
  hint.hidden = false;
  if (hint.dataset.ask !== ask) {
    hint.innerHTML = `${statusMarkup(OFF, { tag: 'span', word: 'Off goal.' })} ${esc(ask)}`;
    hint.dataset.ask = ask;
  }
  box?.setAttribute('aria-describedby', hint.id);
}

function syncIssueHint() {
  const hint = dlg.querySelector('[data-issue-hint]');
  if (!hint) return;
  if (!issueOwed()) { setOffHint(hint, null); return; }
  setOffHint(hint, dlg.querySelector('#e-issue').value.trim() ? 'Replace this with what went wrong.' : 'Say what went wrong.');
}

/** "Off goal. Add what Quality will do in the next 24 hours, or the board shows Needs an action." under an action box. */
function setActionHint(hint, show) {
  setOffHint(hint, show ? `Add what ${fnObj().name} will do in the next 24 hours, or the board shows Needs an action.` : null);
}

/** Off goal with no plan yet: say so under the action box, before the board says Needs an action. */
function syncActionHint() {
  syncIssueHint();
  syncExtraHints();
  const hint = dlg.querySelector('[data-action-hint]');
  if (!hint) return;
  const empty = !dlg.querySelector('#e-action')?.value.trim();
  // What went wrong is asked under the issue box; here, what happens next.
  setActionHint(hint, formOff() && empty);
}

/**
 * A KPI added in Board setup whose number is off goal: its folded "Issue and action for …"
 * opens (once, as it turns off goal, so it can be folded again), and its action box asks for
 * the next 24 hours the same way the main KPI's does.
 */
function syncExtraHints() {
  if (!st) return;
  st.xOff ??= {};
  for (const hint of dlg.querySelectorAll('[data-xaction-hint]')) {
    const id = hint.dataset.xactionHint;
    const off = Boolean(dlg.querySelector(`#e-x-${CSS.escape(id)}`)) && evaluate(`x-${id}`).status === OFF;
    if (off && !st.xOff[id]) {
      const fold = hint.closest('details');
      if (fold) fold.open = true;
    }
    st.xOff[id] = off;
    const empty = !dlg.querySelector(`#e-xa-${CSS.escape(id)}`)?.value.trim();
    setActionHint(hint, off && empty);
  }
}

/**
 * A box by the words over it: its KPI's name ("Critical buffer parts inventory"), an area
 * ("Mold"), or "Month" for a month box whose name is the same as the day's ("Earned hours").
 */
function boxName(fn, key) {
  if (AREA_KEYS.includes(key)) return AREA_NAME[key];
  const label = plainLabel(kpiFor(fn, key));
  if (key === 'month' && label === plainLabel(fn.kpiDaily)) return 'Month';
  return label;
}

/**
 * The line over Save names the boxes that need a fix (never color alone):
 * "Critical buffer parts inventory needs a fix before saving." or
 * "2 boxes need a fix before saving: Plant total and Month."
 */
function fixWords() {
  const fn = fnObj();
  const names = [...dlg.querySelectorAll('.field-input[aria-invalid="true"]')].map((el) => boxName(fn, el.name));
  if (!names.length) return '';
  if (names.length === 1) return `${names[0]} needs a fix before saving.`;
  return `${names.length} boxes need a fix before saving: ${listWords(names)}.`;
}

/** The line over Save follows the boxes: it goes as soon as none is marked, and names the ones still marked. */
function syncFormError() {
  const formError = dlg.querySelector('[data-form-error]');
  if (!formError || formError.hidden) return;
  const words = fixWords();
  if (!words) { formError.hidden = true; formError.textContent = ''; }
  else if (formError.textContent !== words) formError.textContent = words;
}

function currentValues() {
  const out = {};
  dlg.querySelectorAll('.field-input, .field-textarea').forEach((el) => { out[el.name] = el.value; });
  out.issueStatus = dlg.querySelector('[name="issueStatus"]:checked')?.value ?? '';
  dlg.querySelectorAll('.field--xstatus input:checked').forEach((r) => { out[r.name] = r.value; });
  return out;
}

const serialize = () => JSON.stringify(currentValues());
export const isDirty = () => Boolean(st && st.step === 'form' && st.initial !== null && dlg.querySelector('form') && serialize() !== st.initial);

function updateDayDependent() {
  const fn = fnObj();
  dlg.querySelector('[data-form-title]').textContent = `${fn.name} numbers for ${formatDayMedium(month, st.day).replace(/ /g, '\u00a0')}`;
  const legend = dlg.querySelector('[data-month-legend]');
  if (legend) legend.textContent = `${monthSoFar(month)}, through ${formatDayMedium(month, st.day)}`;
  // The month box's rule shows only when the board has a month figure for the day to fill it with.
  const monthHint = dlg.querySelector('#e-month-hint');
  if (monthHint) {
    const has = keptMonth(fn, st.day) !== null;
    monthHint.textContent = has ? MONTH_HINT : '';
    monthHint.hidden = !has;
  }
  for (const key of numberKeys(fn)) {
    const { goal, note } = goalOf(fn, key, st.day);
    dlg.querySelector(`#e-${key}-goal`).textContent = formatGoal(goal, kpiFor(fn, key), note);
    updatePreview(key);
  }
  syncActionHint();
}

function evaluate(key) {
  const fn = fnObj();
  const kpi = kpiFor(fn, key);
  const { goal } = goalOf(fn, key, st.day);
  const parsed = boxValue(fn, key);
  if (!parsed.ok) return { error: parsed.error };
  const idle = key !== 'month' && isProductionDay(month, st.day) === false;
  if (parsed.value === null) {
    const kept = key === 'month' ? keptMonth(fn, st.day) : null;
    if (kept !== null) return { status: compareToGoal(kept, goal, kpi.better), kept: shownFigure(kept, goal, kpi) };
    return { status: idle ? NO_PRODUCTION : NOT_ENTERED, empty: true };
  }
  const s = compareToGoal(parsed.value, goal, kpi.better);
  // The board's own number, untouched, gets no question; a typed one might.
  const slip = parsed.untouched ? {} : slipCheck(fn, key, parsed.value, goal, kpi, parsed.suggest);
  return { status: idle && s === ON ? NO_PRODUCTION : s, value: parsed.value, ...slip };
}

/** The status line while a box's number has a question under it: neutral words and glyph, never on or off colors. */
const CHECK_WORD = 'Check the number';
const CHECK_STATUS = `<span class="status status--check"><svg class="glyph" aria-hidden="true" focusable="false"><use href="#g-info"></use></svg><span class="status-word">${CHECK_WORD}</span></span>`;

function updatePreview(key, { showError = false } = {}) {
  const res = evaluate(key);
  const input = dlg.querySelector(`#e-${key}`);
  const statusEl = dlg.querySelector(`#e-${key}-status`);
  const errEl = dlg.querySelector(`#e-${key}-err`);
  const nudgeEl = dlg.querySelector(`#e-${key}-nudge`);
  if (res.error) {
    statusEl.innerHTML = '';
    clearNudge(nudgeEl);
    if (showError || !errEl.hidden) {
      errEl.textContent = res.error;
      errEl.hidden = false;
      input.setAttribute('aria-invalid', 'true');
    }
    describeBox(key);
    return res;
  }
  // A hidden line keeps no words: a box's description is built from what shows (describeBox).
  errEl.hidden = true;
  errEl.textContent = '';
  input.removeAttribute('aria-invalid');
  // A question only when the number is probably a slip (0.975 for 97.5%, an
  // extra digit, over 100%). It never blocks Save.
  if (res.suggest) {
    // Rebuild only when the suggestion changes, so a click on "Use" is never
    // lost to a re-render when the box loses focus.
    if (nudgeEl.dataset.suggest !== res.suggest) {
      nudgeEl.innerHTML = `<span>Did you mean ${esc(pctWords(res.suggest))}%?</span> `
        + `<button class="btn btn--secondary nudge-btn" type="button" data-use="${esc(key)}" data-value="${esc(res.suggest)}">Use ${esc(pctWords(res.suggest))}%</button>`;
      nudgeEl.dataset.suggest = res.suggest;
      delete nudgeEl.dataset.check;
    }
    nudgeEl.hidden = false;
  } else if (res.check) {
    if (nudgeEl.dataset.check !== res.check) {
      nudgeEl.innerHTML = `<span class="field-check">${esc(res.check)}</span>`;
      nudgeEl.dataset.check = res.check;
      delete nudgeEl.dataset.suggest;
    }
    nudgeEl.hidden = false;
  } else {
    clearNudge(nudgeEl);
  }
  if (AREA_KEYS.includes(key) && res.empty) statusEl.innerHTML = '';
  // A number that looks like a slip isn't judged yet: no green or red over its question.
  else if (res.suggest || res.check) statusEl.innerHTML = CHECK_STATUS;
  else {
    statusEl.innerHTML = statusMarkup(res.status, { tag: 'span', kpi: kpiFor(fnObj(), key) })
      + (res.kept ? ` <span class="field-kept">Keeps ${esc(res.kept)} unless you type a new number</span>` : '');
  }
  describeBox(key);
  return res;
}

/** The question under a box goes, words and all (a hidden line named by aria-describedby is still read). */
function clearNudge(nudgeEl) {
  nudgeEl.hidden = true;
  nudgeEl.innerHTML = '';
  delete nudgeEl.dataset.suggest;
  delete nudgeEl.dataset.check;
}

/**
 * A box is described by what shows with it now, in reading order: its rule (the month box), its
 * goal, its status, its error and its question. Lines that are hidden or empty are left out, so a
 * screen reader never hears a fixed error or a question that has gone ("Goal ≥ 16,980, Below goal").
 */
function describeBox(key) {
  const input = dlg.querySelector(`#${CSS.escape(`e-${key}`)}`);
  if (!input) return;
  const ids = ['hint', 'goal', 'status', 'err', 'nudge']
    .map((part) => dlg.querySelector(`#${CSS.escape(`e-${key}-${part}`)}`))
    .filter((el) => el && !el.hidden && el.textContent.trim())
    .map((el) => el.id);
  if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
  else input.removeAttribute('aria-describedby');
}

/* ---------- Events ---------- */

function visibleNumberInputs() {
  return numberKeys(fnObj())
    .map((k) => dlg.querySelector(`#e-${k}`))
    .filter((el) => el && !el.closest('details:not([open])'));
}

/** Keep editing: the warning goes and focus returns to the box the person was in. */
function keepEditing() {
  hideLeave();
  const back = lastField?.isConnected && !lastField.closest('details:not([open])') && !lastField.disabled ? lastField : dlg.querySelector('.field-input');
  back?.focus();
}

function onKeydown(e) {
  if (!st || !dlg.open) return;
  // Esc is handled here, never by the browser's own dialog close: Chrome stops asking
  // (and just closes) after a refused close with no click or typing in between, which
  // would drop unsaved numbers on a third Esc. A definition open in the form closes
  // first; "You have unsaved numbers" showing means Keep editing; otherwise Esc is Close.
  if (e.key === 'Escape' && !e.isComposing) {
    e.preventDefault();
    e.stopPropagation();
    const pop = dlg.querySelector(':popover-open');
    if (pop) { pop.hidePopover(); return; }
    const leave = dlg.querySelector('[data-leave]');
    if (leave && !leave.hidden) keepEditing();
    else requestClose();
    return;
  }
  if (e.key !== 'Enter' || e.isComposing || !onForm()) return;
  const el = e.target;
  if (!el.classList?.contains('field-input')) {
    // Enter never submits from the day picker either.
    if (el.tagName === 'SELECT') e.preventDefault();
    return;
  }
  // Enter = next box. The last number box hands off to the problem text.
  e.preventDefault();
  updatePreview(el.name, { showError: true });
  const inputs = visibleNumberInputs();
  const i = inputs.indexOf(el);
  const next = inputs[i + 1] ?? dlg.querySelector('#e-issue');
  next?.focus();
}

function onInput(e) {
  // A closed form gets no events (the board's Cmd/Ctrl+Z can send the browser's undo here).
  if (!onForm()) return;
  const el = e.target;
  if (el.name === 'issueStatus') { hideLeave(); return; }
  if (!el.classList?.contains('field-input')) {
    if (el.classList?.contains('field-textarea')) hideLeave();
    if (el.name === 'action' || el.name?.startsWith('xa-')) syncActionHint();
    if (el.name?.startsWith('xi-')) {
      syncStatusControl();
      // Same as the main issue: a problem typed with no status yet starts as Open.
      const id = el.name.slice(3);
      const radios = dlg.querySelectorAll(`[name="xs-${CSS.escape(id)}"]`);
      if (el.value.trim() && !NO_ISSUE.test(el.value) && ![...radios].some((r) => r.checked)) {
        [...radios].find((r) => r.value === 'open').checked = true;
      }
    }
    if (el.name === 'issue') {
      syncStatusControl();
      // A problem typed with no status yet starts as Open (visible, changeable).
      if (el.value.trim() && !NO_ISSUE.test(el.value) && !dlg.querySelector('[name="issueStatus"]:checked')) {
        dlg.querySelector('[name="issueStatus"][value="open"]').checked = true;
      }
    }
    return;
  }
  hideLeave();
  const res = updatePreview(el.name, { showError: /[^\d.,%\s]/.test(el.value) });
  syncActionHint();
  syncFormError();
  clearTimeout(announceTimer);
  // Worded now, while the form is open; the announcement waits for a pause in typing.
  const word = res.suggest || res.check ? CHECK_WORD : res.status ? statusWord(res.status, kpiFor(fnObj(), el.name)) : '';
  announceTimer = setTimeout(() => {
    const live = dlg.querySelector('[data-announce]');
    const name = el.name === 'month' ? 'Month' : AREA_NAME[el.name] ?? plainLabel(kpiFor(fnObj(), el.name));
    if (live && !res.error && word) live.textContent = `${name}: ${word}${res.suggest ? `. Did you mean ${pctWords(res.suggest)}%?` : res.check ? `. ${res.check}` : ''}`;
  }, 700);
}

function onChange(e) {
  if (!onForm()) return;
  const el = e.target;
  if (el.name === 'day') {
    const fn = fnObj();
    // Only what the person changed comes along (they probably fixed the date);
    // every other box shows what that day already has on the board, so another
    // day's month to date, areas or notes are never saved onto this one.
    const before = JSON.parse(st.initial ?? '{}');
    const now = currentValues();
    const changed = {};
    for (const [k, v] of Object.entries(now)) if (String(v ?? '') !== String(before[k] ?? '')) changed[k] = v;
    st.day = Number(el.value);
    const stored = storedValues(fn, st.day);
    const fresh = stored.values;
    st.exact = stored.exact;
    fillValues(fresh);
    // The new day's own numbers are the starting point, so what came along still counts as unsaved.
    st.initial = serialize();
    if (Object.keys(changed).length) fillValues(changed);
    updateDayDependent();
    syncFormError();
    // Said under the day picker, not only to screen readers: what came along, and what it replaced.
    const kept = showKept(fn, changed, fresh);
    const live = dlg.querySelector('[data-announce]');
    if (live) {
      clearTimeout(announceTimer);
      live.textContent = `Showing ${formatDayMedium(month, st.day)}.${kept ? ` ${kept}` : ''}`;
    }
    return;
  }
  if (el.classList?.contains('field-input')) { updatePreview(el.name, { showError: true }); syncFormError(); }
}

/**
 * The line under the day picker after a switch, with a one-tap way back to that day's own
 * number when it had a different one ("Kept your 15,200. Thu, Feb 26 had 14,667. [Use 14,667]").
 * Returns the line's words ('' when nothing came along).
 */
function showKept(fn, changed, fresh) {
  const { text, restore } = keptLine(fn, changed, fresh);
  st.dayRestore = restore;
  const row = dlg.querySelector('[data-day-kept-row]');
  const line = dlg.querySelector('[data-day-kept]');
  const use = dlg.querySelector('[data-use-day]');
  const select = dlg.querySelector('#e-day');
  if (!row || !line) return text;
  line.textContent = text;
  row.hidden = !text;
  if (use) {
    use.textContent = restore?.label ?? '';
    use.hidden = !restore;
  }
  // The day picker is described by the line only while it shows (hidden words would still be read).
  if (text) select?.setAttribute('aria-describedby', line.id);
  else select?.removeAttribute('aria-describedby');
  return text;
}

/** Use 14,667: the boxes go back to what the new day has on the board (its exact numbers). */
function useDayNumbers() {
  const restore = st?.dayRestore;
  if (!restore) return;
  const fn = fnObj();
  const boxes = restore.keys.map((k) => dlg.querySelector(`#${CSS.escape(`e-${k}`)}`)).filter(Boolean);
  for (const box of boxes) {
    box.value = restore.values[box.name] ?? '';
    delete box.dataset.used;
    updatePreview(box.name);
  }
  syncActionHint();
  syncFormError();
  hideLeave();
  // Whatever else came along (notes) is still said; the numbers line goes.
  const before = JSON.parse(st.initial ?? '{}');
  const now = currentValues();
  const changed = {};
  for (const [k, v] of Object.entries(now)) if (String(v ?? '') !== String(before[k] ?? '')) changed[k] = v;
  showKept(fn, changed, before);
  const first = boxes[0];
  if (first) {
    const fold = first.closest('details');
    if (fold) fold.open = true;
    first.focus();
  }
  const live = dlg.querySelector('[data-announce]');
  if (live) {
    clearTimeout(announceTimer);
    live.textContent = `Using ${restore.dayWords}'s ${restore.figures}.`;
  }
}

/** "a", "a and b", "a, b and c". */
const listWords = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * After a day switch: "Kept your 15,500. Thu, Feb 26 had 14,812." Names the boxes
 * when more than one number came along; "Kept your changes." for notes or an emptied box.
 * -> { text, restore }: restore (or null) is what "Use 14,812" puts back: the boxes the new day
 * had a different number in, with that day's box text, and its button's words.
 */
function keptLine(fn, changed, fresh) {
  const keys = Object.keys(changed);
  if (!keys.length) return { text: '', restore: null };
  const nums = numberKeys(fn);
  // At the board's precision ("Month 96.0%", as the board and the box's Keeps line say it).
  const shown = (k, raw) => {
    const kpi = kpiFor(fn, k);
    const { goal } = goalOf(fn, k, st.day);
    const ex = st.exact?.[k];
    const p = ex && String(raw ?? '').trim() === ex.text ? { ok: true, value: ex.value } : parseInput(String(raw ?? ''), kpi, goal);
    const v = p.ok && p.value !== null ? formatPair(p.value, goal, kpi).actual : String(raw ?? '').trim();
    return v.replace(/ /g, '\u00a0');
  };
  const name = (k) => (k === 'month' ? 'Month' : AREA_NAME[k] && !fn.custom ? AREA_NAME[k] : plainLabel(kpiFor(fn, k)));
  const typed = keys.filter((k) => nums.includes(k) && String(changed[k]).trim());
  const rest = keys.filter((k) => !typed.includes(k));
  // Notes (issue, action, status) or an emptied box: said in words, not numbers.
  const restWords = !rest.length ? '' : rest.every((k) => !nums.includes(k)) ? 'notes' : 'other changes';
  const label = typed.length > 1;
  let first;
  if (!typed.length) first = `Kept your ${restWords === 'notes' ? 'notes' : 'changes'}.`;
  else {
    const items = typed.map((k) => (label ? `${name(k)} ${shown(k, changed[k])}` : shown(k, changed[k])));
    if (restWords) items.push(`your ${restWords}`);
    first = `Kept your ${listWords(items)}.`;
  }
  // What the new day had in those boxes, where it was different.
  const had = keys.filter((k) => nums.includes(k) && String(fresh[k] ?? '').trim() && shown(k, fresh[k]) !== shown(k, changed[k]));
  if (!had.length) return { text: first, restore: null };
  const day = formatDayMedium(month, st.day).replace(/ /g, '\u00a0');
  const was = listWords(had.map((k) => (label || had.length > 1 || !typed.includes(k) ? `${name(k)} ${shown(k, fresh[k])}` : shown(k, fresh[k]))));
  const values = Object.fromEntries(had.map((k) => [k, fresh[k]]));
  // One number: "Use 14,667", like the box's own "Use 103%". Several: "Use Thu, Feb 26's numbers".
  const restore = {
    keys: had,
    values,
    dayWords: day,
    figures: was,
    label: had.length === 1 ? `Use ${shown(had[0], fresh[had[0]])}` : `Use ${day}'s numbers`,
  };
  return { text: `${first} ${day} had ${was}.`, restore };
}

function onClick(e) {
  if (!st || e.target === dlg) return; // full screen; no backdrop to click
  const btn = e.target.closest('button');
  if (!btn || btn.matches('.term-btn')) return;
  if (btn.matches('[data-close]')) { requestClose(); return; }
  if (btn.matches('[data-save]')) { save(); return; }
  if (btn.matches('[data-use]')) {
    const input = dlg.querySelector(`#e-${btn.dataset.use}`);
    input.value = btn.dataset.value;
    input.dataset.used = btn.dataset.value;
    updatePreview(btn.dataset.use);
    syncActionHint();
    syncFormError();
    input.focus();
    return;
  }
  if (btn.matches('[data-use-day]')) { useDayNumbers(); return; }
  if (btn.matches('[data-open-board-setup]')) { handlers.onSetup?.(); return; }
  if (btn.matches('[data-keep]')) { keepEditing(); return; }
  if (btn.matches('[data-leave-confirm]')) {
    st.initial = serialize();
    if (leaveAction === 'switch') switchPerson();
    else if (leaveAction === 'goto' && leaveGoto) {
      const go = leaveGoto;
      leaveGoto = null;
      leaveAction = 'close';
      hideLeave();
      go();
    } else closeOnce();
    return;
  }
  if (btn.matches('[data-not-you]')) {
    if (isDirty()) { showLeave('switch'); return; }
    switchPerson();
    return;
  }
  if (btn.matches('[data-person]')) {
    const f = month.functions.find((x) => x.id === btn.dataset.person);
    setIdentity({ name: f.owner, functionId: f.id });
    if (st.mode === 'switch') { handlers.onSwitched?.({ name: f.owner, functionId: f.id }); return; }
    // The person picked here enters this form, even when this browser can't remember them.
    st.as = { name: f.owner, functionId: f.id };
    st.step = 'form';
    st.fnId = st.requestedFnId ?? f.id;
    renderForm();
    focusLanding();
  }
}

function switchPerson() {
  st.step = 'who';
  renderWho();
  focusTitle();
}

export function requestClose() {
  if (st?.leaving) return; // already closing (a second click, Esc after Save)
  if (isDirty()) { showLeave('close'); return; }
  closeOnce();
}

/** Close the form, once: app.js steps back in history, and a second request before it has closed does nothing. */
function closeOnce() {
  if (!st || st.leaving) return;
  markLeaving();
  handlers.onCancel();
}

/** The form is on its way out. Should it somehow still be open a moment later, it works again. */
function markLeaving() {
  const mine = st;
  mine.leaving = true;
  setTimeout(() => { if (st === mine && dlg.open) mine.leaving = false; }, 1500);
}

/**
 * "You have unsaved numbers." action: 'close' (Back, Cancel), 'switch' (Not you?), or 'goto' with
 * `go`, which opens the form the URL asked for (another function's).
 */
export function showLeave(action = 'close', go = null) {
  const box = dlg.querySelector('[data-leave]');
  if (!box || st?.leaving) return;
  leaveAction = action;
  leaveGoto = action === 'goto' ? go : null;
  box.querySelector('[data-leave-confirm]').textContent = action === 'switch' ? 'Switch without saving' : 'Leave without saving';
  dlg.querySelector('[data-bar-actions]').hidden = true;
  box.hidden = false;
  box.querySelector('[data-keep]').focus();
}

function hideLeave() {
  const box = dlg.querySelector('[data-leave]');
  if (!box || box.hidden) return;
  box.hidden = true;
  dlg.querySelector('[data-bar-actions]').hidden = false;
}

function save() {
  // Once Save (or Cancel) has started closing the form, another Save does nothing until it has closed:
  // a double click must not save twice, or step back twice through "Nothing to save" and leave the app.
  if (!st || st.leaving) return;
  const fn = fnObj();
  const who = whoNow();
  // Nothing changed: nothing to save. It closes like Cancel, so a Save on a filled-in
  // day never stamps "Entered by", and an empty one never turns "Nothing recorded" into "None needed".
  if (!isDirty()) {
    closeOnce();
    toast('Nothing to save.');
    return;
  }
  const values = {};
  let firstBad = null;
  for (const key of numberKeys(fn)) {
    const res = updatePreview(key, { showError: true });
    // An untouched box keeps the board's exact number (the box shows it rounded).
    const parsed = boxValue(fn, key);
    if (!parsed.ok || res.error) {
      if (AREA_KEYS.includes(key)) dlg.querySelector('[data-areas]').open = true;
      firstBad ??= dlg.querySelector(`#e-${key}`);
      continue;
    }
    values[key] = parsed.value;
  }
  const formError = dlg.querySelector('[data-form-error]');
  if (firstBad) {
    formError.textContent = fixWords();
    formError.hidden = false;
    firstBad.focus();
    return;
  }
  formError.hidden = true;
  formError.textContent = '';
  // The toast repeats the number that changed ("Saved 147,360 for Operations"): the main
  // KPI's first, then a KPI added in Board setup, then the month.
  const before = JSON.parse(st.initial ?? '{}');
  const now = currentValues();
  const changed = (k) => String(before[k] ?? '').trim() !== String(now[k] ?? '').trim();
  const figureKey = ['plant', ...(fn.extraKpis ?? []).map(extraKey), 'month']
    .find((k) => typeof values[k] === 'number' && changed(k)) ?? null;
  const figure = figureKey ? shownFigure(values[figureKey], goalOf(fn, figureKey, st.day).goal, kpiFor(fn, figureKey)) : null;
  const figureExtra = figureKey ? extraOf(fn, figureKey) : null;
  const kpiRowId = figureExtra?.id ?? fn.id;
  // A KPI added in Board setup is named ("Saved 96.5% for Quality, First pass yield, …"), and a
  // number that had a question under its box says it once more ("… That's 9 times the goal.").
  const figureKpi = figureExtra ? plainLabel(figureExtra.kpiDaily) : null;
  // Every other changed box with a question under it says it too, named with its number, so a
  // question isn't lost behind the first figure ("Saved 15,000 for Operations, Fri, Feb 27.
  // Labor efficiency 954.0%: that's over 100%.").
  const lowerFirst = (x) => x.charAt(0).toLowerCase() + x.slice(1);
  const otherChecks = numberKeys(fn)
    .filter((k) => k !== figureKey && typeof values[k] === 'number' && changed(k))
    .map((k) => {
      const fact = evaluate(k).fact;
      if (!fact) return null;
      return `${boxName(fn, k)} ${shownFigure(values[k], goalOf(fn, k, st.day).goal, kpiFor(fn, k))}: ${lowerFirst(fact)}`;
    })
    .filter(Boolean);
  const figureCheck = [figureKey ? evaluate(figureKey).fact ?? null : null, ...otherChecks].filter(Boolean).join(' ') || null;
  const text = (name) => {
    const v = dlg.querySelector(`[name="${name}"]`).value.trim();
    return v || null;
  };
  const monthValue = values.month;
  delete values.month;
  // KPIs added in Board setup: their numbers and their own issue and action.
  const extra = {};
  const extraNotes = {};
  for (const k of fn.extraKpis ?? []) {
    extra[k.kpiId] = values[extraKey(k)] ?? null;
    delete values[extraKey(k)];
    const xi = text(`xi-${k.kpiId}`);
    const xa = text(`xa-${k.kpiId}`);
    const xs = dlg.querySelector(`[name="xs-${CSS.escape(k.kpiId)}"]:checked`)?.value ?? null;
    // A problem with no status picked starts as Open; no problem, no status.
    if (xi || xa) extraNotes[k.kpiId] = { issue: xi, action: xa, status: xi && !NO_ISSUE.test(xi) ? (xs ?? 'open') : null };
  }
  // From here the form is saving and closing: a second Save, Cancel or Esc does nothing.
  markLeaving();
  const issue = text('issue');
  // Did the problem, its next step or its status change? Then the dashboard
  // shows the issue row after saving; otherwise the department's matrix row.
  const notesChanged = ['issue', 'action', 'issueStatus'].some(changed);
  const { ok, previous } = saveEntry({
    functionId: fn.id,
    day: st.day,
    values,
    // An emptied month box keeps the month's number as it was (it is easy to clear by mistake at 6:40 AM).
    ...(fn.custom ? {} : { month: monthValue ?? keptMonth(fn, st.day) }),
    ...(Object.keys(extra).length ? { extra, extraNotes } : {}),
    issue,
    action: text('action'),
    issueStatus: issue ? (dlg.querySelector('[name="issueStatus"]:checked')?.value ?? null) : null,
    enteredBy: who?.name ?? null,
  });
  // ok false: this browser isn't saving (private window, storage off). The board
  // still holds the numbers for this visit (store.js), and the toast says so.
  st.initial = serialize();
  handlers.onSaved({
    fnId: fn.id, fnName: fn.name, day: st.day, previous, notesChanged, persisted: ok, figure, figureKpi, figureCheck, kpiRowId,
    dayLabel: formatDayMedium(month, st.day), dayLong: formatDayLong(month, st.day),
  });
}
