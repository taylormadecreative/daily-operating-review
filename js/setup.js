// Board setup: set the board up for any plant without a developer. Plant name,
// functions in meeting order, owners (photo optional), and the KPIs each
// function tracks, with their goals and units. Everything applies to the board
// as it's changed and stays on this device (store.js readSetup / writeSetup).

import {
  readSetup, writeSetup, resetSetup, UNITS, kpiRowsFor, ownerFor, scaleExtraValues, scalePrimaryValues, getMonth, NAME_MAX,
  getOrg, editOrgDraft, checkOrgDraft, activateOrgDraft, discardOrgDraft, snapshotOrg, restoreOrg, ROLES, WEEKDAYS,
  dailyMeasuresOf, measureLoad, DAILY_MEASURE_MAX, ORG_NAME_MAX, isoForDay, boardToday, boardFirstDay,
} from './store.js?v=20261120-182315';
import { formatEnteredAt } from './format.js?v=20261120-182315';
import { glyphMarkup, statusMarkup } from './ui.js?v=20261120-182315';
import { parseInput, toInputValue, plainLabel } from './format.js?v=20261120-182315';
import { esc } from './ui.js?v=20261120-182315';
import { icon, DEPT_ICON } from './icons.js?v=20261120-182315';
import { avatarMarkup, plantName } from './board.js?v=20261120-182315';
import { fitSheetHead } from './detail.js?v=20261120-182315';
import * as cloud from './cloud.js?v=20261120-182315';
import { RULES, RULE_IDS, defaultRule } from './weekly.js?v=20261120-182315';

/** The name a new function's owner starts with: not a person yet. */
const PLACEHOLDER_OWNER = /^\s*(owner name)?\s*$/i;
/** The owner's photo or initials; a neutral person glyph until a real name is typed ("Owner name" isn't one: its "ON" read like a status). */
function ownerAvatar(owner, cls) {
  if (!owner.photo && PLACEHOLDER_OWNER.test(owner.name ?? '')) return `<span class="${cls} avatar--none" aria-hidden="true">${icon('user', 'i')}</span>`;
  return avatarMarkup(owner, cls);
}

let dlg;
let ctx;
let openFn = null; // the function whose editor is open
let opener = null;
let changeTimer;

/** The daily question fits the board whole up to 140 characters; a quiet count shows from 120. */
const QUESTION_MAX = 140;
const QUESTION_COUNT_FROM = 120;
/**
 * A question typed or pasted past 140 stays whole in its box (never cut mid-word) and isn't saved:
 * the board keeps the question it had before this edit until the new one fits.
 * questionDrafts: function id -> the box's text while it's over. questionBase: function id -> the
 * stored question when this edit began ({ had, value }), put back while the box is over.
 */
const questionDrafts = new Map();
const questionBase = new Map();
/**
 * Name boxes stop at the board's caps (store.js NAME_MAX: plant and function 60, owner and KPI
 * names 80). A paste or typing past the cap is cut by the box, never silently: the note under it
 * says so at once, seen and heard ("That's the 60-character limit, so the end was cut. ...").
 * A name typed up to the cap exactly just says it's the limit.
 */
const cutAtCap = new WeakSet(); // boxes whose last paste or typing was cut at the cap
const heardCut = new WeakSet(); // ...and a screen reader has been told
const capAttrs = (id, max, more = '') => `maxlength="${max}" data-max="${max}" aria-describedby="${[more, `${id}-limit`].filter(Boolean).join(' ')}"`;
const capNote = (id) => `<p class="su-note su-limit" id="${id}-limit" data-limit hidden></p>`;
const capNoteFor = (el) => (el.id === 'su-plant-name'
  ? dlg.querySelector('#su-plant-note [data-limit]')
  : dlg.querySelector(`#${CSS.escape(el.id)}-limit`));
function capText(el) {
  const max = Number(el.dataset.max);
  if (el.value.length < max) return el.id === 'su-plant-name' ? `Up to ${max} characters.` : '';
  return cutAtCap.has(el)
    ? `That's the ${max}-character limit, so the end was cut. Shorten the name so it ends on a whole word.`
    : `That's the ${max}-character limit.`;
}
/** Keep a name box's note in step with its length; a cut is announced once. */
function updateCap(el) {
  const max = Number(el?.dataset.max);
  if (!max) return;
  if (el.value.length < max) { cutAtCap.delete(el); heardCut.delete(el); }
  const note = capNoteFor(el);
  if (!note) return;
  const text = capText(el);
  const cut = el.value.length >= max && cutAtCap.has(el);
  note.textContent = text;
  note.hidden = !text;
  note.classList.toggle('is-cut', cut);
  if (cut && !heardCut.has(el)) {
    heardCut.add(el);
    const live = dlg.querySelector('[data-limit-live]');
    if (live) { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 60); }
  }
}

/** "People's", "Operations'". */
const possessive = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** Browsers without field-sizing: the question box grows with its words in script. */
const SIZES_ITSELF = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content');

export function initSetup(c) {
  ctx = c;
  dlg = document.createElement('dialog');
  dlg.className = 'sheet setup';
  dlg.id = 'setup';
  dlg.setAttribute('aria-labelledby', 'setup-title');
  document.body.append(dlg);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeSetup(); });
  dlg.addEventListener('click', onClick);
  dlg.addEventListener('input', onInput);
  // A pilot board's goal history is worked out from what it was when the goal box got focus, so
  // each keystroke ("1", "12", "120") replaces today's change instead of adding one.
  dlg.addEventListener('focusin', (e) => {
    if (!cloud.BOARD || !e.target.matches?.('[data-k="goal"]')) return;
    const { fnId, kpiId } = kpiTarget(e.target);
    const k = (readSetup().kpis[fnId] ?? []).find((x) => x.id === kpiId);
    if (k) goalStart.set(kpiId, structuredClone({ goals: k.goals, goal: k.goal }));
  });
  dlg.addEventListener('change', onChange);
  // A paste or typing that won't fit a name box: the box cuts it, and the note says so.
  dlg.addEventListener('beforeinput', (e) => {
    const el = e.target;
    if (!el.matches?.('input[data-max]') || !e.inputType?.startsWith('insert')) return;
    const text = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
    const incoming = text.replace(/[\r\n]+/g, '').length; // a one-line box drops line breaks
    const picked = Math.abs((el.selectionEnd ?? 0) - (el.selectionStart ?? 0));
    if (el.value.length - picked + incoming <= Number(el.dataset.max)) return;
    cutAtCap.add(el);
    // Typing at the cap changes nothing, so no input event follows: say it now.
    requestAnimationFrame(() => { if (dlg.open && el.isConnected) updateCap(el); });
  });
  // The question is one line on the board: Enter doesn't start a new one.
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches?.('textarea[data-f="question"]')) e.preventDefault();
  });
  // Leaving a question that fits ends that edit: the next one starts from what's saved now.
  dlg.addEventListener('focusout', (e) => {
    const el = e.target;
    if (!el.matches?.('textarea[data-f="question"]') || el.value.length > QUESTION_MAX) return;
    const fnId = el.closest('[data-fn]')?.dataset.fn;
    if (fnId) questionBase.delete(fnId);
  });
  dlg.addEventListener('close', () => {
    // The closed sheet keeps no fields: the page's own undo (Cmd/Ctrl+Z on the board)
    // can't reach a box in here and type into the setup again. open() draws it fresh.
    // (A message showing in the sheet has already gone back to the page.)
    [...dlg.children].forEach((n) => { if (!n.matches('[data-toasts]')) n.remove(); });
    clearTimeout(liveTimer);
    // A question still over 140 goes with the sheet: the board kept the one it had. Say so once
    // the sheet is gone (below), with the real counts: "People's daily question not changed: 170 of 140."
    const notKept = [...questionDrafts].filter(([, v]) => v.length > QUESTION_MAX);
    questionDrafts.clear();
    questionBase.clear();
    // The button that opened it can be gone (the "Open Board setup" line leaves once a function
    // is back): then another Board setup control on the page, never <body>.
    const shown = (el) => Boolean(el?.isConnected) && !el.closest('[inert], dialog:not([open])') && (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null);
    const back = shown(opener) ? opener : [...document.querySelectorAll('[data-open-setup]')].find((el) => shown(el) && !dlg.contains(el))
      ?? [document.getElementById('home'), document.getElementById('board')].find(shown);
    back?.focus?.({ preventScroll: back === opener });
    opener = null;
    if (notKept.length) ctx.toast(notKeptMessage(notKept));
  });
}

/** The toast for daily questions left over 140 when the sheet closed. One line, real counts. */
function notKeptMessage(list) {
  const month = ctx.getMonth();
  const all = [...month.functions, ...(month.hiddenFunctions ?? [])];
  const nameOf = (id) => all.find((f) => f.id === id)?.name ?? '';
  const count = (v) => `${v.length} of ${QUESTION_MAX}`;
  if (list.length === 1) {
    const [id, v] = list[0];
    const name = month.functions.length > 1 ? nameOf(id) : '';
    return `${name ? `${possessive(name)} daily` : 'Daily'} question not changed: ${count(v)}.`;
  }
  return `Daily questions not changed: ${list.map(([id, v]) => `${nameOf(id)} ${count(v)}`.trim()).join(', ')}.`;
}

/**
 * Open the sheet. { section: 'org' } lands on the Organization section; { focus } on one of its boxes:
 * 'person:<id>' (that person's name), 'area:<id>' (that area's lead), 'owner:<fnId>' or 'leader:<fnId>'.
 */
export function openSetup({ section = null, focus = null } = {}) {
  opener = document.activeElement;
  render();
  if (!dlg.open) dlg.showModal();
  fitSheetHead(dlg); // measured once it's showing (render() measures too, while it's open)
  requestAnimationFrame(() => {
    const target = section === 'org' ? (focus && orgTarget(focus)) || dlg.querySelector('#su-org') : null;
    if (target) {
      scrollPanelTo(target, { center: Boolean(focus) });
      target.focus({ preventScroll: true });
    } else dlg.querySelector('#setup-title')?.focus({ preventScroll: true });
  });
  fitQuestions();
}

function closeSetup() {
  clearTimeout(changeTimer);
  flush();
  if (dlg.open) dlg.close();
}

/* ---------- Saving ---------- */

let pending = null;

let warnedStorage = false;
let justWarned = false;
/** Storage refused: the change still applies for this visit; say so once. Returns true when saved. */
function saved(ok) {
  justWarned = false;
  if (!ok && !warnedStorage) {
    warnedStorage = true;
    justWarned = true;
    ctx.toast("This browser isn't saving, so it will clear when the page reloads.");
  }
  return ok;
}

/** Save now and redraw the board (structural changes). Returns true when it was saved on the device. */
function commit(setup, { rerender = true } = {}) {
  pending = null;
  clearTimeout(changeTimer);
  const ok = saved(writeSetup(setup));
  ctx.onChange();
  // Closed (an Undo pressed on the board afterwards): it's drawn fresh when it opens.
  if (rerender && dlg.open) render();
  return ok;
}

/** A success message, unless this change just raised the "isn't saving" message (that one stays on screen). */
function done(ok, message, opts) {
  if (!justWarned) ctx.toast(message, opts);
}

/** Save while typing: the board follows after a short pause, the sheet keeps focus. */
function commitSoon(setup) {
  pending = setup;
  saved(writeSetup(setup));
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => { pending = null; ctx.onChange(); }, 350);
}

function flush() {
  if (!pending) return;
  pending = null;
  ctx.onChange();
}

const fnSetup = (setup, id) => (setup.functions[id] ??= {});

/**
 * Undo for a change made in this sheet: put the setup back, then focus what it
 * restored (`target` is a selector or a function returning the element), or
 * `fallback`. Never <body>.
 */
function undoTo(snapshot, target, fallback = '#setup-title', before = null) {
  return () => {
    before?.();
    commit(snapshot);
    if (!dlg.open) return; // closed meanwhile: the toast settles focus on the board
    const el = typeof target === 'function' ? target() : dlg.querySelector(target);
    focusAfter(el, fallback);
  };
}
const newId = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Every function id in meeting order, removed ones still in their places. */
function fullOrder(month) {
  const ids = [...(month.order ?? []), ...month.functions.map((f) => f.id), ...(month.hiddenFunctions ?? []).map((f) => f.id)];
  return [...new Set(ids)];
}

/* ---------- Render ---------- */

const ARROW_UP = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';
const ARROW_DOWN = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>';

const unitOptions = (sel) => UNITS.map((u) => `<option value="${u.id}"${u.id === sel ? ' selected' : ''}>${esc(u.name)}</option>`).join('');

/** The Weekly review's rules as options; the first says which one the KPI uses by default. */
function weeklyRuleOptions(row, picked) {
  const def = defaultRule(row);
  return `<option value=""${picked ? '' : ' selected'}>${esc(`Default: ${RULES[def].name.toLowerCase()}`)}</option>`
    + RULE_IDS.map((id) => `<option value="${id}"${picked === id ? ' selected' : ''}>${esc(RULES[id].name)}</option>`).join('');
}

/** A pilot board's KPI starts on the full date being viewed (each month works out its own start day). */
const startDate = (month) => (cloud.BOARD ? { startDate: isoForDay(month, ctx.getDay()) } : {});

function goalText(v, unit) {
  if (typeof v !== 'number') return '';
  return toInputValue(v, { unit });
}

function kpiCard(fnId, k, { first = false, only = false } = {}) {
  const pre = `k-${fnId}-${k.id}`;
  const pct = k.unit === 'fraction';
  return `
    <fieldset class="su-kpi" data-kpi="${esc(k.id)}">
      ${first ? `<legend class="su-kpi-legend">Main KPI: sets the function's status</legend>` : `<legend class="sr-only">${esc(k.name || 'KPI')}</legend>`}
      <div class="su-grid">
        <div class="su-field su-field--wide">
          <label for="${pre}-name">KPI name</label>
          <input id="${pre}-name" type="text" data-k="name" value="${esc(k.name)}" ${capAttrs(`${pre}-name`, NAME_MAX.kpi)} autocomplete="off">
          ${capNote(`${pre}-name`)}
        </div>
        <div class="su-field">
          <label for="${pre}-unit">Measured in</label>
          <select id="${pre}-unit" data-k="unit">${unitOptions(k.unit)}</select>
        </div>
        <div class="su-field">
          <label for="${pre}-better">Good is</label>
          <select id="${pre}-better" data-k="better">
            <option value="higher"${k.better !== 'lower' ? ' selected' : ''}>Higher</option>
            <option value="lower"${k.better === 'lower' ? ' selected' : ''}>Lower</option>
          </select>
        </div>
        <div class="su-field">
          <label for="${pre}-goal">Daily goal</label>
          <div class="su-suffix${pct ? ' has-suffix' : ''}">
            <input id="${pre}-goal" type="text" inputmode="decimal" data-k="goal" value="${esc(goalText(k.goal, k.unit))}" autocomplete="off" aria-describedby="${pre}-goal-err">
            ${pct ? '<span aria-hidden="true">%</span>' : ''}
          </div>
          <p class="su-error" id="${pre}-goal-err" hidden></p>
          ${cloud.BOARD ? '<p class="su-note">A new goal starts today. Earlier days keep the goal they had.</p>' : ''}
        </div>
        <div class="su-field">
          <label for="${pre}-rollup">The month</label>
          <select id="${pre}-rollup" data-k="rollup">
            <option value="total"${(k.rollup ?? UNITS.find((u) => u.id === k.unit)?.rollup) === 'total' ? ' selected' : ''}>Adds up the days</option>
            <option value="average"${(k.rollup ?? UNITS.find((u) => u.id === k.unit)?.rollup) === 'average' ? ' selected' : ''}>Averages the days</option>
          </select>
        </div>
        <div class="su-field su-field--wide">
          <label for="${pre}-wrule">Weekly rule</label>
          <select id="${pre}-wrule" data-k="weeklyRule">${weeklyRuleOptions({ custom: true, kpiDaily: { unit: k.unit } }, k.weeklyRule)}</select>
        </div>
      </div>
      ${only ? '' : `<button class="btn btn--text su-remove" type="button" data-remove-kpi="${esc(k.id)}">Remove this KPI</button>`}
    </fieldset>`;
}

function workbookKpi(fn, f) {
  const pre = `wb-${fn.id}`;
  const day = fn.kpiDaily;
  const mo = fn.kpiMonthly;
  const dayPct = day.unit === 'fraction';
  const moPct = mo.unit === 'fraction';
  return `
    <fieldset class="su-kpi su-kpi--workbook">
      <legend class="su-kpi-legend">From the plant's workbook</legend>
      <div class="su-grid">
        <div class="su-field su-field--wide">
          <label for="${pre}-label">Daily KPI name</label>
          <input id="${pre}-label" type="text" data-wb="kpiLabel" value="${esc(f.kpiLabel ?? '')}" ${capAttrs(`${pre}-label`, NAME_MAX.kpi)} placeholder="${esc(plainLabel({ boardLabel: fn.sourceDayLabel ?? day.boardLabel }))}" autocomplete="off">
          ${capNote(`${pre}-label`)}
        </div>
        <div class="su-field">
          <label for="${pre}-goal">Daily goal</label>
          <div class="su-suffix${dayPct ? ' has-suffix' : ''}">
            <input id="${pre}-goal" type="text" inputmode="decimal" data-wb="dayGoal" data-unit="${esc(day.unit)}" value="${esc(goalText(f.dayGoal, day.unit))}" placeholder="From the plan" autocomplete="off" aria-describedby="${pre}-goal-note ${pre}-goal-err">
            ${dayPct ? '<span aria-hidden="true">%</span>' : ''}
          </div>
          <p class="su-error" id="${pre}-goal-err" hidden></p>
        </div>
        <div class="su-field su-field--wide">
          <label for="${pre}-mlabel">Month KPI name</label>
          <input id="${pre}-mlabel" type="text" data-wb="monthLabel" value="${esc(f.monthLabel ?? '')}" ${capAttrs(`${pre}-mlabel`, NAME_MAX.kpi)} placeholder="${esc(plainLabel({ boardLabel: fn.sourceMonthLabel ?? mo.boardLabel }))}" autocomplete="off">
          ${capNote(`${pre}-mlabel`)}
        </div>
        <div class="su-field">
          <label for="${pre}-mgoal">Month goal</label>
          <div class="su-suffix${moPct ? ' has-suffix' : ''}">
            <input id="${pre}-mgoal" type="text" inputmode="decimal" data-wb="monthGoal" data-unit="${esc(mo.unit)}" value="${esc(goalText(f.monthGoal, mo.unit))}" placeholder="From the plan" autocomplete="off" aria-describedby="${pre}-goal-note ${pre}-mgoal-err">
            ${moPct ? '<span aria-hidden="true">%</span>' : ''}
          </div>
          <p class="su-error" id="${pre}-mgoal-err" hidden></p>
        </div>
        <div class="su-field su-field--wide">
          <label for="${pre}-wrule">Weekly rule</label>
          <select id="${pre}-wrule" data-wbrule>${weeklyRuleOptions({ id: fn.id, primary: true, kpiDaily: day }, f.weeklyRule)}</select>
        </div>
      </div>
      <p class="su-note" id="${pre}-goal-note">Leave a goal empty to use the plant plan's goals, which can change day by day. Units come from the workbook.</p>
    </fieldset>`;
}

/**
 * "128 of 140" from 120 characters on ('' below that); at 140, that it's the most the board shows;
 * over 140 (pasted, typed on, or an older question), how to make it fit. Seen and heard the same.
 */
function questionCount(n) {
  if (n < QUESTION_COUNT_FROM) return '';
  if (n > QUESTION_MAX) return `${n} of ${QUESTION_MAX}. Shorten it so the board shows it whole.`;
  return n === QUESTION_MAX ? `${n} of ${QUESTION_MAX}. That's the most the board shows.` : `${n} of ${QUESTION_MAX}`;
}

/**
 * The daily question: a box that grows with its words (2 lines at least). It has no hard cap:
 * a longer question stays whole in the box, the count under it says how to make it fit, and
 * the board keeps its question until the new one does (onInput).
 */
function questionField(pre, q) {
  const count = questionCount(q.length);
  const over = q.length > QUESTION_MAX;
  return `<textarea class="su-question" id="${pre}-question" data-f="question" rows="2" placeholder="For example: Did we start the shift in control?" autocomplete="off" aria-describedby="${pre}-question-count"${over ? ' aria-invalid="true"' : ''}>${esc(q)}</textarea>
          <p class="su-count${over ? ' is-over' : ''}" id="${pre}-question-count"${count ? '' : ' hidden'}>${esc(count)}</p>
          <span class="sr-only" aria-live="polite" data-question-live></span>`;
}

/** Without field-sizing, size each question box to its words in script. */
function fitQuestion(el) {
  if (SIZES_ITSELF || !el) return;
  el.style.height = 'auto';
  const b = parseFloat(getComputedStyle(el).borderTopWidth) + parseFloat(getComputedStyle(el).borderBottomWidth);
  el.style.height = `${el.scrollHeight + (b || 0)}px`;
}
const fitQuestions = () => { if (!SIZES_ITSELF) dlg.querySelectorAll('textarea[data-f="question"]').forEach(fitQuestion); };

let liveTimer;
/**
 * Keep the count in step; a screen reader hears it once typing pauses, not on every key. When the
 * count first shows (it can sit below the fold), it scrolls into view.
 */
function updateQuestionCount(el) {
  const field = el.closest('.su-field');
  const out = field?.querySelector('.su-count');
  const live = field?.querySelector('[data-question-live]');
  const text = questionCount(el.value.length);
  const over = el.value.length > QUESTION_MAX;
  if (over) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
  if (out) {
    const appears = out.hidden && Boolean(text);
    out.textContent = text;
    out.hidden = !text;
    out.classList.toggle('is-over', over);
    if (appears) out.scrollIntoView({ block: 'nearest' });
  }
  clearTimeout(liveTimer);
  if (live) {
    live.textContent = '';
    if (text) liveTimer = setTimeout(() => { live.textContent = text; }, 900);
  }
}

function editor(month, fn, setup) {
  const f = setup.functions[fn.id] ?? {};
  const owner = ownerFor(fn);
  const kpis = setup.kpis[fn.id] ?? [];
  const pre = `fn-${fn.id}`;
  // Once an organization is active, it names the owner: the box gives way to the name and a way there.
  const orgDoc = getOrg(month);
  const fromOrg = orgDoc.stored && orgDoc.active.people.some((p) => p.id === orgDoc.active.functions?.[fn.id]?.responsible);
  const load = measureLoad(month, fn.id);
  const full = load.count >= load.max;
  return `
    <div class="su-editor" id="${pre}-editor">
      <div class="su-grid">
        <div class="su-field su-field--wide">
          <label for="${pre}-name">Function name</label>
          <input id="${pre}-name" type="text" data-f="name" value="${esc(fn.name)}" ${capAttrs(`${pre}-name`, NAME_MAX.fn)} autocomplete="off">
          ${capNote(`${pre}-name`)}
        </div>
        <div class="su-field su-field--full">
          <label for="${pre}-question">Daily question</label>
          ${questionField(pre, questionDrafts.get(fn.id) ?? fn.dorQuestion ?? '')}
        </div>
      </div>

      <div class="su-owner">
        ${ownerAvatar(owner, 'avatar su-avatar')}
        <div class="su-owner-fields">
          ${fromOrg ? `<div class="su-field">
            <p class="su-fixed-label">Owner</p>
            <p class="su-fixed">${esc(fn.owner)}</p>
            <p class="su-note">The active organization names the owner. <button class="btn--text su-inline-link" type="button" data-org-go="owner:${esc(fn.id)}">Change it under Organization</button></p>
          </div>` : `<div class="su-field">
            <label for="${pre}-owner">Owner</label>
            <input id="${pre}-owner" type="text" data-f="owner" value="${esc(fn.owner)}" ${capAttrs(`${pre}-owner`, NAME_MAX.owner)} autocomplete="off">
            ${capNote(`${pre}-owner`)}
          </div>`}
          <div class="su-photo">
            <label class="btn btn--secondary su-photo-btn" for="${pre}-photo">${owner.photo ? 'Change photo' : 'Add a photo'}</label>
            <input class="sr-only" id="${pre}-photo" type="file" accept="image/*" data-photo="${esc(fn.id)}">
            ${owner.photo ? `<button class="btn btn--text" type="button" data-remove-photo="${esc(fn.id)}">Remove photo</button>` : '<span class="su-note">Optional. Initials show until there\'s a photo.</span>'}
          </div>
        </div>
      </div>

      <h4 class="su-subhead">KPIs</h4>
      ${fn.custom ? '' : workbookKpi(fn, f)}
      ${kpis.map((k, i) => kpiCard(fn.id, k, { first: fn.custom && i === 0, only: fn.custom && i === 0 })).join('')}
      <div class="su-cap">
        <button class="btn btn--secondary su-add" type="button" data-add-kpi="${esc(fn.id)}"${full ? ' aria-disabled="true"' : ''} aria-describedby="${pre}-cap">${icon('clipboard', 'i')}Add a KPI to ${esc(fn.name)}</button>
        <p class="su-note su-cap-count" id="${pre}-cap">Daily measures${load.name ? ` for ${esc(load.name)}` : ''}: ${load.count} of ${load.max}.${full ? ' That\'s the most the DOR shows for one owner.' : ''}</p>
        <p class="su-error su-cap-msg" id="${pre}-cap-msg" role="alert" hidden></p>
      </div>

      <div class="su-editor-foot">
        <button class="btn btn--text su-danger" type="button" data-hide-fn="${esc(fn.id)}">${fn.custom ? 'Delete this function' : 'Remove from the board'}</button>
      </div>
    </div>`;
}

function fnRow(month, fn, setup, i, total) {
  const open = openFn === fn.id;
  const kpiCount = kpiRowsFor(fn).length;
  return `
    <li class="su-fn${open ? ' is-open' : ''}" data-fn="${esc(fn.id)}">
      <div class="su-fn-head">
        <span class="su-fn-icon" aria-hidden="true">${icon(DEPT_ICON[fn.id] ?? 'board', 'i')}</span>
        <button class="su-fn-toggle" type="button" data-toggle="${esc(fn.id)}" aria-expanded="${open}" aria-controls="fn-${esc(fn.id)}-editor">
          <span class="su-fn-text">
            <span class="su-fn-name">${esc(fn.name)}</span>
            <span class="su-fn-meta">${esc(fn.owner)} · ${kpiCount} KPI${kpiCount === 1 ? '' : 's'}</span>
          </span>
          <span class="su-fn-edit"><span class="su-fn-edit-word">${open ? 'Close' : 'Edit'}</span>${icon('chevronDown', `i su-chev${open ? ' is-open' : ''}`)}</span>
        </button>
        <div class="su-move" role="group" aria-label="Meeting order">
          <button class="icon-btn" type="button" data-move="${esc(fn.id)}" data-dir="-1" aria-label="Move ${esc(fn.name)} earlier in the meeting" title="Move up"${i === 0 ? ' disabled' : ''}>${ARROW_UP}</button>
          <button class="icon-btn" type="button" data-move="${esc(fn.id)}" data-dir="1" aria-label="Move ${esc(fn.name)} later in the meeting" title="Move down"${i === total - 1 ? ' disabled' : ''}>${ARROW_DOWN}</button>
        </div>
      </div>
      ${open ? editor(month, fn, setup) : ''}
    </li>`;
}

/* ---------- Organization (spec §3): Draft, Validate, Activate ---------- */

/** The organization this section shows: the draft being edited, else the active one. */
function orgShown(month) {
  const doc = getOrg(month);
  return { doc, org: doc.draft ?? doc.active };
}

/** The box a validation line or a page link points at. */
function orgTarget(key) {
  const [kind, id] = String(key ?? '').split(':');
  const sel = {
    person: `#org-p-${CSS.escape(id ?? '')}-name`,
    reports: `#org-p-${CSS.escape(id ?? '')}-reports`,
    area: `#org-area-${CSS.escape(id ?? '')}-lead`,
    owner: `#org-fn-${CSS.escape(id ?? '')}-owner`,
    leader: `#org-fn-${CSS.escape(id ?? '')}-leader`,
  }[kind];
  return sel ? dlg.querySelector(sel) : null;
}

/** "Jane Doe"; the title is added only to tell two people of the same name apart. */
const personLabel = (people, p) => {
  const name = p.name.trim() || 'No name yet';
  const twin = people.some((x) => x !== p && x.name.trim().toLowerCase() === p.name.trim().toLowerCase());
  return twin && p.title ? `${name} (${p.title})` : name;
};
const personOptions = (people, sel, { none = 'Not set', except = null } = {}) => `<option value=""${sel ? '' : ' selected'}>${esc(none)}</option>`
  + people.filter((p) => p.id !== except).map((p) => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(personLabel(people, p))}</option>`).join('');

const CHECK = '<svg class="org-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>';

/** Where the lifecycle stands: 'active' (no draft), 'draft', 'issues' (validated, something to fix), 'ready'. */
function orgStage(doc) {
  if (!doc.draft) return 'active';
  if (!doc.checked || doc.checked.rev !== doc.rev) return 'draft';
  return doc.checked.ok ? 'ready' : 'issues';
}

/** Draft → Validate → Activate, the status line, the validation result and the buttons. */
function orgStateMarkup(month) {
  const { doc } = orgShown(month);
  const stage = orgStage(doc);
  const step = { active: -1, draft: 0, issues: 1, ready: 2 }[stage];
  const steps = ['Draft', 'Validate', 'Activate'].map((name, i) => `<li class="${i < step ? 'is-done' : i === step ? 'is-current' : ''}"${i === step ? ' aria-current="step"' : ''}><span class="org-step-n" aria-hidden="true">${i < step ? CHECK : i + 1}</span>${name}${i < step ? '<span class="sr-only">, done</span>' : ''}</li>`).join('');
  const since = doc.stored ? `Active since ${esc(formatEnteredAt(doc.activatedAt))}.` : "Active: read from the board's function owners.";
  const count = doc.checked?.issues.length ?? 0;
  const line = {
    active: `${since} Change anything below to start a draft. The pages keep the active organization until you activate the draft.`,
    draft: 'Draft: not active yet. Validate it to check for gaps, then activate it.',
    issues: `Draft: ${count === 1 ? '1 thing' : `${count} things`} to fix before it can be activated.`,
    ready: 'Draft: ready to activate. Nothing is missing.',
  }[stage];
  const issues = stage === 'issues' ? `<ul class="org-issues">${doc.checked.issues.map((i) => `<li>${statusMarkup('off', { tag: 'span', word: i.text, extra: 'org-issue' })}${i.focus ? ` <button class="btn--text su-inline-link" type="button" data-org-go="${esc(i.focus)}">Fix this</button>` : ''}</li>`).join('')}</ul>` : '';
  const buttons = stage === 'active' ? '' : `
    <div class="org-buttons">
      ${stage === 'ready'
        ? '<button class="btn btn--primary" type="button" data-org-activate>Activate</button>'
        : `<button class="btn btn--primary" type="button" data-org-validate>${stage === 'issues' ? 'Validate again' : 'Validate'}</button>`}
      <button class="btn btn--text" type="button" data-org-discard>Discard draft</button>
    </div>`;
  return `<ol class="org-steps" aria-label="Organization lifecycle">${steps}</ol>
    <p class="org-state">${line}</p>${issues}${buttons}`;
}

/** Redraw just the lifecycle parts (top and bottom), keeping focus on the button that had it. */
function syncOrgState(month = ctx.getMonth(), { box = null } = {}) {
  const html = orgStateMarkup(month);
  const boxes = [...dlg.querySelectorAll('[data-org-state]')];
  const active = document.activeElement;
  const at = box ?? boxes.findIndex((b) => b.contains(active));
  const key = at >= 0 && active && boxes[at]?.contains(active)
    ? ['data-org-validate', 'data-org-activate', 'data-org-discard'].find((a) => active.hasAttribute(a)) : null;
  boxes.forEach((n) => { if (n.innerHTML !== html) n.innerHTML = html; });
  dlg.querySelectorAll('[data-org-badge]').forEach((n) => { n.textContent = orgStage(orgShown(month).doc) === 'active' ? 'Active' : 'Draft'; });
  if (key) (boxes[at].querySelector(`[${key}]`) ?? boxes[at].querySelector('[data-org-validate], [data-org-activate]'))?.focus({ preventScroll: true });
}

function orgSection(month) {
  const { doc, org } = orgShown(month);
  const people = org.people;
  const days = new Set(org.productionDays);
  const plantLabel = plantName(month);
  const tz = org.timeZone || '';
  const fnRows = month.functions.map((fn) => {
    const a = org.functions?.[fn.id] ?? {};
    const pid = a.responsible;
    const load = pid ? dailyMeasuresOf(month, org, pid).count : kpiRowsFor(fn).length;
    const over = load > DAILY_MEASURE_MAX;
    return `<tr>
      <th scope="row">${esc(fn.name)}</th>
      <td><label class="sr-only" for="org-fn-${esc(fn.id)}-owner">Responsible owner for ${esc(fn.name)}</label>
        <select id="org-fn-${esc(fn.id)}-owner" data-org-fn="${esc(fn.id)}" data-org-k="responsible">${personOptions(people, pid)}</select></td>
      <td><label class="sr-only" for="org-fn-${esc(fn.id)}-leader">Accountable leader for ${esc(fn.name)}</label>
        <select id="org-fn-${esc(fn.id)}-leader" data-org-fn="${esc(fn.id)}" data-org-k="accountable">${personOptions(people, a.accountable)}</select></td>
      <td class="org-load${over ? ' is-over' : ''}">${over ? glyphMarkup('off') : ''}${load} of ${DAILY_MEASURE_MAX}</td>
    </tr>`;
  }).join('');
  const personCards = people.map((p) => {
    const pre = `org-p-${p.id}`;
    return `<fieldset class="org-person" data-org-person="${esc(p.id)}">
      <legend class="sr-only">${esc(p.name || 'New person')}</legend>
      <div class="su-grid">
        <div class="su-field"><label for="${pre}-name">Name</label>
          <input id="${pre}-name" type="text" data-org-p="name" value="${esc(p.name)}" maxlength="${NAME_MAX.owner}" autocomplete="off"></div>
        <div class="su-field"><label for="${pre}-title">Title</label>
          <input id="${pre}-title" type="text" data-org-p="title" value="${esc(p.title)}" maxlength="${NAME_MAX.owner}" autocomplete="off"></div>
        <div class="su-field"><label for="${pre}-reports">Reports to</label>
          <select id="${pre}-reports" data-org-p="reportsTo">${personOptions(people, p.reportsTo, { none: 'Nobody (top of the chart)', except: p.id })}</select></div>
      </div>
      <fieldset class="org-roles"><legend>Roles</legend>
        ${ROLES.map((r) => `<label class="org-role"><input type="checkbox" data-org-role="${r.id}"${p.roles.includes(r.id) ? ' checked' : ''}><span>${esc(r.name)}</span></label>`).join('')}
      </fieldset>
      <button class="btn btn--text su-danger org-remove" type="button" data-org-remove="${esc(p.id)}">Remove ${esc(p.name || 'this person')}</button>
    </fieldset>`;
  }).join('');
  return `
        <section class="su-section su-org" aria-labelledby="su-org">
          <h3 class="su-head" id="su-org" tabindex="-1">Organization <span class="org-badge" data-org-badge>${orgStage(doc) === 'active' ? 'Active' : 'Draft'}</span></h3>
          <p class="su-note">Who answers for each function, and the plant's calendar. Changes here make a draft; every page keeps the active organization until you activate it.</p>
          <div class="org-state-box" data-org-state>${orgStateMarkup(month)}</div>

          <h4 class="su-subhead">Organization and site</h4>
          <div class="su-grid">
            <div class="su-field su-field--wide"><label for="org-name">Organization name</label>
              <input id="org-name" type="text" data-org-field="name" value="${esc(org.name)}" maxlength="${ORG_NAME_MAX}" placeholder="Not set" autocomplete="off"></div>
            <div class="su-field"><p class="su-fixed-label">Site</p><p class="su-fixed">${esc(plantLabel)}</p></div>
            <div class="su-field su-field--wide"><label for="org-tz">Time zone</label>
              <input id="org-tz" type="text" data-org-field="timeZone" value="${esc(tz)}" maxlength="60" autocomplete="off"></div>
            <div class="su-field"><label for="org-week">Week</label>
              <select id="org-week" data-org-field="weekStart"><option value="mon"${org.weekStart === 'mon' ? ' selected' : ''}>Mon to Sun</option><option value="sun"${org.weekStart === 'sun' ? ' selected' : ''}>Sun to Sat</option></select></div>
            <div class="su-field"><label for="org-cutoff">Production-day cutoff</label>
              <input id="org-cutoff" type="time" data-org-field="cutoff" value="${esc(org.cutoff)}" aria-describedby="org-cutoff-note"></div>
            <p class="su-note su-field--wide org-cutoff-note" id="org-cutoff-note">${org.cutoff ? 'The time a production day ends.' : 'Not set. The time a production day ends, for numbers entered after midnight.'}</p>
          </div>
          <fieldset class="org-days"><legend>Production days</legend>
            ${WEEKDAYS.map(([d, name]) => `<label class="org-role"><input type="checkbox" data-org-day="${d}"${days.has(d) ? ' checked' : ''}><span>${name}</span></label>`).join('')}
          </fieldset>
          <p class="su-note">Departments are the ${month.functions.length} functions above, in meeting order. The workbook's calendar decides which days have production goals.</p>

          <h4 class="su-subhead">Areas</h4>
          <table class="org-table">
            <thead><tr><th scope="col">Area</th><th scope="col">Lead</th></tr></thead>
            <tbody>${org.areas.map((a) => `<tr><th scope="row">${esc(a.name)}</th><td><label class="sr-only" for="org-area-${esc(a.id)}-lead">Lead for ${esc(a.name)}</label>
              <select id="org-area-${esc(a.id)}-lead" data-org-area="${esc(a.id)}">${personOptions(people, a.lead)}</select></td></tr>`).join('')}</tbody>
          </table>
          <p class="su-note">From the workbook's area columns. Add a person below to make them an area's lead.</p>

          <h4 class="su-subhead">Shifts</h4>
          <ul class="org-shifts">${org.shifts.map((sh) => `<li><label class="sr-only" for="org-shift-${esc(sh.id)}">Shift name</label>
            <input id="org-shift-${esc(sh.id)}" type="text" data-org-shift="${esc(sh.id)}" value="${esc(sh.name)}" maxlength="40" autocomplete="off">
            <button class="btn btn--text" type="button" data-org-shift-remove="${esc(sh.id)}">Remove<span class="sr-only"> ${esc(sh.name)}</span></button></li>`).join('')}</ul>
          <button class="btn btn--secondary" type="button" data-org-shift-add>${icon('plus', 'i')}Add a shift</button>

          <h4 class="su-subhead">People</h4>
          <p class="su-note org-roles-note">${cloud.BOARD ? 'Anyone with the edit password can act as any role.' : 'Roles are a demo here: anyone on this device can act as any role. The connected version checks sign-in.'}</p>
          <div class="org-people">${personCards}</div>
          <button class="btn btn--secondary" type="button" data-org-person-add>${icon('plus', 'i')}Add a person</button>

          <h4 class="su-subhead">Who answers for each function</h4>
          <p class="su-note">The responsible owner does the work and enters the numbers. The accountable leader answers for the result. Each owner has at most ${DAILY_MEASURE_MAX} daily measures.</p>
          <div class="org-table-wrap">
            <table class="org-table org-table--fns">
              <thead><tr><th scope="col">Function</th><th scope="col">Responsible owner</th><th scope="col">Accountable leader</th><th scope="col">Owner's daily measures</th></tr></thead>
              <tbody>${fnRows}</tbody>
            </table>
          </div>

          <h4 class="su-subhead">Action rules</h4>
          <label class="org-role org-flag"><input type="checkbox" id="org-self-verify" data-org-flag="allowSelfVerify" aria-describedby="org-self-verify-note"${org.allowSelfVerify ? ' checked' : ''}><span>Allow self-verification</span></label>
          <p class="su-note" id="org-self-verify-note">${org.allowSelfVerify
            ? 'On: an action\'s owner may verify it, if they have the Verifier role.'
            : 'Off: a completed action is verified by someone with the Verifier role who doesn\'t own it.'}</p>

          <div class="org-state-box org-state-box--end" data-org-state>${orgStateMarkup(month)}</div>
        </section>`;
}

/**
 * Bring a box into view inside the sheet's own scrolling panel, clear of its sticky title bar
 * (scrollIntoView would also shift the sheet itself, which clips its overflow, and hide the title bar).
 */
function scrollPanelTo(el, { center = false } = {}) {
  const panel = dlg.querySelector('.sheet-panel');
  if (!panel || !el) return;
  const head = panel.querySelector(':scope > .sheet-head')?.getBoundingClientRect().height ?? 0;
  const r = el.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  const room = p.height - head;
  const offset = center ? Math.max(12, (room - r.height) / 2) : 12;
  panel.scrollTop += r.top - p.top - head - offset;
}

/** Change the draft, then redraw (`redraw`) or just the lifecycle parts. Focus stays where it was. */
function orgEdit(change, { redraw = false } = {}) {
  const month = ctx.getMonth();
  const ok = saved(editOrgDraft(month, change).ok);
  if (redraw) redrawKeepingFocus();
  else syncOrgState(month);
  return ok;
}

/** Redraw the sheet and put focus back on the box with the same id (a select, a name, a checkbox). */
function redrawKeepingFocus(fallback = '#su-org') {
  const a = document.activeElement;
  const id = a && dlg.contains(a) ? a.id : null;
  const role = a?.dataset?.orgRole ?? a?.dataset?.orgDay;
  const personId = a?.closest?.('[data-org-person]')?.dataset.orgPerson;
  render();
  const again = (id && dlg.querySelector(`#${CSS.escape(id)}`))
    || (role && personId && dlg.querySelector(`[data-org-person="${CSS.escape(personId)}"] [data-org-role="${CSS.escape(role)}"]`))
    || (role && dlg.querySelector(`[data-org-day="${CSS.escape(role)}"]`))
    || dlg.querySelector(fallback);
  again?.focus({ preventScroll: true });
}

function onOrgInput(el) {
  if (el.dataset.orgField && el.type !== 'time' && el.tagName === 'INPUT') {
    orgEdit((o) => { o[el.dataset.orgField] = el.value; });
    return true;
  }
  if (el.dataset.orgP === 'name' || el.dataset.orgP === 'title') {
    const pid = el.closest('[data-org-person]')?.dataset.orgPerson;
    let person = null;
    orgEdit((o) => { const p = o.people.find((x) => x.id === pid); if (p) { p[el.dataset.orgP] = el.value; person = { ...p }; } });
    // Every list of people follows as it's typed (no redraw, so the box keeps its focus and caret).
    if (person) {
      const label = personLabel(orgShown(ctx.getMonth()).org.people, person);
      dlg.querySelectorAll(`.su-org option[value="${CSS.escape(pid)}"]`).forEach((o) => { o.textContent = label; });
      const remove = dlg.querySelector(`[data-org-remove="${CSS.escape(pid)}"]`);
      if (remove) remove.textContent = `Remove ${person.name || 'this person'}`;
    }
    return true;
  }
  if (el.dataset.orgShift) {
    orgEdit((o) => { const sh = o.shifts.find((x) => x.id === el.dataset.orgShift); if (sh) sh.name = el.value; });
    return true;
  }
  return false;
}

function onOrgChange(el) {
  const pid = el.closest('[data-org-person]')?.dataset.orgPerson;
  if (el.dataset.orgP === 'name' || el.dataset.orgP === 'title' || el.dataset.orgShift || (el.dataset.orgField && el.type === 'text')) return true; // saved as typed
  if (el.dataset.orgField === 'cutoff' || (el.tagName === 'SELECT' && el.dataset.orgField)) {
    orgEdit((o) => { o[el.dataset.orgField] = el.value; }, { redraw: el.dataset.orgField === 'cutoff' });
    return true;
  }
  if (el.dataset.orgFlag) {
    orgEdit((o) => { o[el.dataset.orgFlag] = el.checked; }, { redraw: true });
    return true;
  }
  if (el.dataset.orgDay) {
    orgEdit((o) => {
      const set = new Set(o.productionDays);
      if (el.checked) set.add(el.dataset.orgDay); else set.delete(el.dataset.orgDay);
      o.productionDays = WEEKDAYS.map(([d]) => d).filter((d) => set.has(d));
    });
    return true;
  }
  if (el.dataset.orgP === 'reportsTo') {
    orgEdit((o) => { const p = o.people.find((x) => x.id === pid); if (p) p.reportsTo = el.value || null; }, { redraw: true });
    return true;
  }
  if (el.dataset.orgRole) {
    orgEdit((o) => {
      const p = o.people.find((x) => x.id === pid);
      if (!p) return;
      const set = new Set(p.roles);
      if (el.checked) set.add(el.dataset.orgRole); else set.delete(el.dataset.orgRole);
      p.roles = [...set];
    });
    return true;
  }
  if (el.dataset.orgArea) {
    orgEdit((o) => { const a = o.areas.find((x) => x.id === el.dataset.orgArea); if (a) a.lead = el.value || null; }, { redraw: true });
    return true;
  }
  if (el.dataset.orgFn) {
    orgEdit((o) => {
      o.functions[el.dataset.orgFn] ??= { responsible: null, accountable: null };
      o.functions[el.dataset.orgFn][el.dataset.orgK] = el.value || null;
    }, { redraw: true });
    return true;
  }
  return false;
}

/** Undo for a change to the stored organization: put the record back and redraw the pages. */
function orgUndo(before, focusSel) {
  return () => {
    restoreOrg(before);
    ctx.onChange();
    if (!dlg.open) return;
    render();
    focusAfter(dlg.querySelector(focusSel), '#su-org');
  };
}

function onOrgClick(btn) {
  const month = ctx.getMonth();
  if (btn.dataset.orgGo) {
    const t = orgTarget(btn.dataset.orgGo);
    if (t) { scrollPanelTo(t, { center: true }); t.focus({ preventScroll: true }); }
    return true;
  }
  if (btn.matches('[data-org-validate]')) {
    const boxes = [...dlg.querySelectorAll('[data-org-state]')];
    const at = Math.max(0, boxes.findIndex((b) => b.contains(btn)));
    const r = checkOrgDraft(month);
    syncOrgState(month, { box: at });
    // The result is read out; focus stays on the lifecycle (Activate when it's ready).
    const next = boxes[at]?.querySelector(r.ok ? '[data-org-activate]' : '[data-org-validate]');
    next?.focus({ preventScroll: true });
    const live = dlg.querySelector('[data-limit-live]');
    if (live) {
      live.textContent = '';
      setTimeout(() => { live.textContent = r.ok ? 'Ready to activate. Nothing is missing.' : `${r.issues.length === 1 ? '1 thing' : `${r.issues.length} things`} to fix: ${r.issues.map((i) => i.text).join(' ')}`; }, 60);
    }
    return true;
  }
  if (btn.matches('[data-org-activate]')) {
    const before = activateOrgDraft();
    if (!before) { syncOrgState(month); return true; }
    ctx.onChange();
    render();
    focusAfter(dlg.querySelector('#su-org'), '#setup-title');
    ctx.toast('Organization activated. Every page now uses it.', { actionLabel: 'Undo', onAction: orgUndo(before, '[data-org-state] [data-org-activate]') });
    return true;
  }
  if (btn.matches('[data-org-discard]')) {
    const before = discardOrgDraft();
    render();
    focusAfter(dlg.querySelector('#su-org'), '#setup-title');
    ctx.toast('Draft discarded. The active organization is unchanged.', { actionLabel: 'Undo', onAction: orgUndo(before, '[data-org-state] [data-org-discard]') });
    return true;
  }
  if (btn.matches('[data-org-person-add]')) {
    const id = newId('p');
    orgEdit((o) => { o.people.push({ id, name: '', title: '', roles: ['contributor'], reportsTo: null }); }, { redraw: true });
    const input = dlg.querySelector(`#org-p-${CSS.escape(id)}-name`);
    scrollPanelTo(input, { center: true });
    input?.focus({ preventScroll: true });
    return true;
  }
  if (btn.dataset.orgRemove) {
    const pid = btn.dataset.orgRemove;
    const shown = orgShown(month).org;
    const i = shown.people.findIndex((p) => p.id === pid);
    const gone = shown.people[i];
    const before = snapshotOrg();
    orgEdit((o) => {
      o.people = o.people.filter((p) => p.id !== pid);
      // Nobody points at someone who isn't there: their places read "Not set" (Validate says what's missing).
      for (const p of o.people) if (p.reportsTo === pid) p.reportsTo = null;
      for (const f of Object.values(o.functions)) { if (f.responsible === pid) f.responsible = null; if (f.accountable === pid) f.accountable = null; }
      for (const a of o.areas) if (a.lead === pid) a.lead = null;
    }, { redraw: true });
    const near = shown.people[i - 1] ?? shown.people[i + 1];
    focusAfter(near && dlg.querySelector(`#org-p-${CSS.escape(near.id)}-name`), '[data-org-person-add]');
    done(true, `${gone?.name || 'Person'} removed from the draft.`, { actionLabel: 'Undo', onAction: orgUndo(before, `#org-p-${CSS.escape(pid)}-name`) });
    return true;
  }
  if (btn.matches('[data-org-shift-add]')) {
    const id = newId('s');
    orgEdit((o) => { o.shifts.push({ id, name: `${o.shifts.length + 1}${['st', 'nd', 'rd'][o.shifts.length] ?? 'th'} shift` }); }, { redraw: true });
    const input = dlg.querySelector(`#org-shift-${CSS.escape(id)}`);
    input?.focus();
    input?.select();
    return true;
  }
  if (btn.dataset.orgShiftRemove) {
    const before = snapshotOrg();
    const name = orgShown(month).org.shifts.find((x) => x.id === btn.dataset.orgShiftRemove)?.name ?? 'Shift';
    orgEdit((o) => { o.shifts = o.shifts.filter((x) => x.id !== btn.dataset.orgShiftRemove); }, { redraw: true });
    focusAfter(dlg.querySelector('[data-org-shift-add]'), '#su-org');
    done(true, `${name} removed from the draft.`, { actionLabel: 'Undo', onAction: orgUndo(before, '[data-org-shift-add]') });
    return true;
  }
  if (btn.matches('[data-reset-org]')) {
    const before = snapshotOrg();
    restoreOrg(null);
    ctx.onChange();
    render();
    focusAfter(dlg.querySelector('#su-org'), '#su-reset');
    ctx.toast("The organization is back to the board's function owners.", { actionLabel: 'Undo', onAction: orgUndo(before, '[data-reset-org]') });
    return true;
  }
  return false;
}

function render() {
  const month = ctx.getMonth();
  const setup = readSetup();
  const scroller = dlg.querySelector('.sheet-panel');
  const keep = scroller?.scrollTop ?? 0;
  const hidden = month.hiddenFunctions ?? [];
  dlg.innerHTML = `
    <div class="sheet-panel">
      <header class="sheet-head">
        <h2 class="su-title" id="setup-title" tabindex="-1">Board setup</h2>
        <button class="icon-btn sheet-close" type="button" data-close aria-label="Close board setup">
          <svg class="icon" aria-hidden="true" focusable="false"><use href="#g-close"></use></svg>
        </button>
      </header>
      <div class="su-body">
        <span class="sr-only" aria-live="polite" data-limit-live></span>
        <p class="su-lead">Set the board up for any plant: its name, the functions in meeting order, who owns each one, and the KPIs they track. Changes show on the board right away${cloud.BOARD ? ' and save to the server once the board is unlocked.' : ' and stay on this device.'}</p>

        <section class="su-section" aria-labelledby="su-plant">
          <h3 class="su-head" id="su-plant">Plant</h3>
          <div class="su-field">
            <label for="su-plant-name">Plant name</label>
            <input id="su-plant-name" type="text" data-plant-input value="${esc(month.plant)}" maxlength="${NAME_MAX.plant}" data-max="${NAME_MAX.plant}" autocomplete="off" aria-describedby="su-plant-note">
            <p class="su-note" id="su-plant-note"><span data-plant-shows>Shows as "${esc(plantName(month))}" on the board.</span> <span class="su-limit" data-limit>Up to ${NAME_MAX.plant} characters.</span></p>
          </div>
        </section>

        <section class="su-section" aria-labelledby="su-fns">
          <h3 class="su-head" id="su-fns" tabindex="-1">Functions, in meeting order</h3>
          <ol class="su-fns">${month.functions.map((fn, i) => fnRow(month, fn, setup, i, month.functions.length)).join('')}</ol>
          <button class="btn btn--primary su-add-fn" type="button" data-add-fn>Add a function</button>
          ${hidden.length ? `
            <h4 class="su-subhead">Removed from the board</h4>
            <ul class="su-hidden">${hidden.map((fn) => `<li><span>${esc(fn.name)} <span class="su-fn-meta">${esc(fn.owner)}</span></span><button class="btn btn--secondary" type="button" data-restore="${esc(fn.id)}">Put back</button></li>`).join('')}</ul>` : ''}
        </section>

        ${orgSection(month)}

        ${cloud.BOARD ? '' : `<section class="su-section su-section--reset" aria-labelledby="su-reset">
          <h3 class="su-head" id="su-reset" tabindex="-1">Start over</h3>
          <p class="su-note">Go back to the plant workbook's setup. Numbers people entered stay.</p>
          <button class="btn btn--secondary" type="button" data-reset-setup>Reset board setup</button>
          ${getOrg(month).stored || getOrg(month).draft ? `<p class="su-note su-reset-org">Or go back to the organization read from the board's owners.</p>
          <button class="btn btn--secondary" type="button" data-reset-org>Reset the organization</button>` : ''}
        </section>`}
      </div>
    </div>`;
  const panel = dlg.querySelector('.sheet-panel');
  if (panel) panel.scrollTop = keep;
  if (dlg.open) fitSheetHead(dlg);
  fitQuestions();
  dlg.querySelectorAll('input[data-max]').forEach(updateCap);
}

/* ---------- Events ---------- */

/**
 * After a change that redraws the sheet, focus goes to `el` (or the first match
 * of `fallback`), never to <body>. Scrolled into view only when it's off screen.
 */
function focusAfter(el, fallback) {
  const target = (el?.isConnected ? el : null) ?? (fallback ? dlg.querySelector(fallback) : null) ?? dlg.querySelector('#setup-title');
  if (!target) return;
  target.focus({ preventScroll: true });
  const r = target.getBoundingClientRect();
  // Under the sticky title bar counts as off screen too.
  const headBottom = dlg.querySelector('.sheet-head')?.getBoundingClientRect().bottom ?? 0;
  if (r.top < headBottom || r.bottom > window.innerHeight) target.scrollIntoView({ block: 'center' });
}

function kpiTarget(el) {
  const li = el.closest('[data-fn]');
  const card = el.closest('[data-kpi]');
  return { fnId: li?.dataset.fn, kpiId: card?.dataset.kpi };
}

function showGoalError(input, msg) {
  const err = document.getElementById(input.getAttribute('aria-describedby')?.split(' ').pop());
  if (!err) return;
  err.textContent = msg ?? '';
  err.hidden = !msg;
  if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
}

/** A goal box: empty = no goal; percent boxes take "95" for 95%. Returns undefined when it can't be read. */
function readGoal(input, unit) {
  const r = parseInput(input.value, { unit, better: 'higher' });
  if (!r.ok) { showGoalError(input, r.error); return undefined; }
  showGoalError(input, null);
  return r.value;
}

function onInput(e) {
  // Only while the sheet is open: the page's undo can fire input on a closed sheet's boxes.
  if (!dlg.open) return;
  const el = e.target;
  if (el.closest?.('.su-org') && onOrgInput(el)) return;
  if (el.matches('input[data-max]')) updateCap(el);
  if (el.matches('textarea[data-f="question"]')) {
    // One line on the board: a pasted line break becomes a space.
    if (/[\r\n]/.test(el.value)) {
      const at = el.selectionStart;
      el.value = el.value.replace(/\s*[\r\n]+\s*/g, ' ');
      el.setSelectionRange(Math.min(at, el.value.length), Math.min(at, el.value.length));
    }
    updateQuestionCount(el);
    fitQuestion(el);
  }
  const setup = readSetup();
  if (el.matches('[data-plant-input]')) {
    // "Riverside Plant" and "Riverside" both read "Riverside plant" on the board.
    setup.plant = el.value.trim().replace(/\s+plant$/i, '') || null;
    const note = dlg.querySelector('#su-plant-note [data-plant-shows]');
    // Exactly what the board will show: the store's rule (trimmed, capped) and the board's plantName.
    const stored = setup.plant ? setup.plant.trim().slice(0, NAME_MAX.plant) : null;
    if (note) note.textContent = `Shows as "${plantName({ plant: stored ?? ctx.getMonth().sourcePlant })}" on the board.`;
    commitSoon(setup);
    return;
  }
  const { fnId, kpiId } = kpiTarget(el);
  if (!fnId) return;
  if (el.dataset.f === 'question') {
    const f = fnSetup(setup, fnId);
    // What the board showed when this edit began: kept while the box is over 140.
    if (!questionBase.has(fnId)) questionBase.set(fnId, { had: typeof f.question === 'string', value: f.question });
    if (el.value.length > QUESTION_MAX) {
      questionDrafts.set(fnId, el.value);
      const base = questionBase.get(fnId);
      const want = base.had ? base.value : undefined;
      if (f.question === want) return; // the board already shows it
      if (base.had) f.question = base.value; else delete f.question;
      commitSoon(setup);
      return;
    }
    questionDrafts.delete(fnId);
    f.question = el.value;
    commitSoon(setup);
    return;
  }
  if (el.dataset.f) {
    const v = el.value.trim();
    if (v) fnSetup(setup, fnId)[el.dataset.f] = v;
    else delete fnSetup(setup, fnId)[el.dataset.f];
    commitSoon(setup);
    if (el.dataset.f === 'name') {
      // Keep the list's name in step without redrawing the sheet. An emptied box
      // goes back to the workbook's name (or "New function"): say that name, never a blank.
      const name = el.closest('[data-fn]').querySelector('.su-fn-name');
      let shown = v;
      if (!v) {
        try { shown = getMonth().functions.find((f) => f.id === fnId)?.name ?? ''; } catch { shown = ''; }
        if (shown) el.placeholder = shown;
      }
      if (name) name.textContent = shown;
    }
    return;
  }
  if (el.dataset.wb) {
    const f = fnSetup(setup, fnId);
    if (el.dataset.wb === 'kpiLabel' || el.dataset.wb === 'monthLabel') {
      const v = el.value.trim();
      if (v) f[el.dataset.wb] = v; else delete f[el.dataset.wb];
    } else {
      const g = readGoal(el, el.dataset.unit);
      if (g === undefined) return;
      if (g === null) delete f[el.dataset.wb]; else f[el.dataset.wb] = g;
    }
    commitSoon(setup);
    return;
  }
  if (kpiId && el.dataset.k === 'name') {
    const k = (setup.kpis[fnId] ?? []).find((x) => x.id === kpiId);
    if (!k) return;
    k.name = el.value.trim() || 'KPI';
    commitSoon(setup);
    return;
  }
  if (kpiId && el.dataset.k === 'goal') {
    const k = (setup.kpis[fnId] ?? []).find((x) => x.id === kpiId);
    if (!k) return;
    const g = readGoal(el, k.unit);
    if (g === undefined) return;
    if (cloud.BOARD) k.goals = goalHistory(goalStart.get(kpiId) ?? k, g);
    k.goal = g;
    commitSoon(setup);
  }
}

/**
 * A pilot board's goal history after a change: the new goal starts today, replacing any change made
 * earlier today, and earlier days keep theirs. The first goal ever starts on the board's first day.
 */
const goalStart = new Map(); // kpiId -> { goals, goal } when its goal box got focus

function goalHistory(k, goal) {
  const today = boardToday();
  const first = boardFirstDay() ?? today;
  let list = Array.isArray(k.goals) ? k.goals.filter((x) => x.from !== today) : [];
  if (!Array.isArray(k.goals) && typeof k.goal === 'number') list = [{ from: first, goal: k.goal }];
  if (!list.length) return [{ from: first < today ? first : today, goal }];
  return [...list, { from: today, goal }].sort((a, b) => (a.from < b.from ? -1 : 1));
}

function onChange(e) {
  if (!dlg.open) return;
  const el = e.target;
  if (el.closest?.('.su-org') && onOrgChange(el)) return;
  if (el.matches('[data-photo]')) { addPhoto(el.dataset.photo, el.files?.[0]); return; }
  const { fnId, kpiId } = kpiTarget(el);
  if (el.matches('[data-wbrule]') && fnId) {
    // The workbook KPI's weekly rule (the Weekly review); empty = its default.
    const setup = readSetup();
    const f = fnSetup(setup, fnId);
    if (el.value) f.weeklyRule = el.value; else delete f.weeklyRule;
    commit(setup);
    dlg.querySelector(`[data-fn="${CSS.escape(fnId)}"] [data-wbrule]`)?.focus();
    return;
  }
  if (!fnId || !kpiId || !['unit', 'better', 'rollup', 'weeklyRule'].includes(el.dataset.k)) return;
  const setup = readSetup();
  const k = (setup.kpis[fnId] ?? []).find((x) => x.id === kpiId);
  if (!k) return;
  if (el.dataset.k === 'unit') {
    // A goal typed as a percent means something else as a count: convert it, and the numbers already entered.
    const factor = k.unit !== 'fraction' && el.value === 'fraction' ? 0.01 : k.unit === 'fraction' && el.value !== 'fraction' ? 100 : 1;
    // Rounded, so 95 as a count becomes exactly 95% (never 95.00000000000001%, which would read as a miss).
    if (typeof k.goal === 'number') k.goal = Number((k.goal * factor).toFixed(8));
    if (factor !== 1) {
      const fn = ctx.getMonth().functions.find((f) => f.id === fnId);
      if (fn?.custom && fn.firstKpiId === kpiId) scalePrimaryValues(fnId, factor);
      else scaleExtraValues(fnId, kpiId, factor);
    }
    k.unit = el.value;
    delete k.rollup; // follows the unit unless picked
  } else if (el.dataset.k === 'weeklyRule') {
    if (el.value) k.weeklyRule = el.value; else delete k.weeklyRule;
  } else {
    k[el.dataset.k] = el.value;
  }
  commit(setup);
  dlg.querySelector(`[data-kpi="${CSS.escape(kpiId)}"] [data-k="${el.dataset.k}"]`)?.focus();
}

function onClick(e) {
  if (e.target === dlg) { closeSetup(); return; }
  const btn = e.target.closest('button');
  if (!btn) return;
  const month = ctx.getMonth();
  const setup = readSetup();

  if (btn.matches('[data-close]')) { closeSetup(); return; }
  if (onOrgClick(btn)) return;

  if (btn.dataset.toggle) {
    flush();
    openFn = openFn === btn.dataset.toggle ? null : btn.dataset.toggle;
    render();
    dlg.querySelector(`[data-toggle="${CSS.escape(btn.dataset.toggle)}"]`)?.focus();
    return;
  }

  if (btn.dataset.move) {
    const order = setup.order?.length ? [...new Set([...setup.order, ...fullOrder(month)])] : fullOrder(month);
    const visible = month.functions.map((f) => f.id);
    const i = visible.indexOf(btn.dataset.move);
    const j = i + Number(btn.dataset.dir);
    if (i < 0 || j < 0 || j >= visible.length) return;
    const a = order.indexOf(visible[i]);
    const b = order.indexOf(visible[j]);
    const before = structuredClone(setup);
    [order[a], order[b]] = [order[b], order[a]];
    setup.order = order;
    const ok = commit(setup);
    const again = dlg.querySelector(`[data-move="${CSS.escape(btn.dataset.move)}"][data-dir="${btn.dataset.dir}"]`);
    (again && !again.disabled ? again : dlg.querySelector(`[data-toggle="${CSS.escape(btn.dataset.move)}"]`))?.focus();
    // Undo: back on the same arrow (or the function's row when that arrow is now off).
    const id = CSS.escape(btn.dataset.move);
    const sameArrow = () => {
      const b = dlg.querySelector(`[data-move="${id}"][data-dir="${btn.dataset.dir}"]`);
      return b && !b.disabled ? b : dlg.querySelector(`[data-toggle="${id}"]`);
    };
    done(ok, `${month.functions[i].name} moved ${Number(btn.dataset.dir) < 0 ? 'earlier' : 'later'} in the meeting.`, { actionLabel: 'Undo', onAction: undoTo(before, sameArrow) });
    return;
  }

  if (btn.dataset.addKpi) {
    const fnId = btn.dataset.addKpi;
    // At most 3 daily measures per owner (spec §1, §4): a 4th is refused, in plain words, beside the button.
    const load = measureLoad(month, fnId);
    if (load.count >= load.max) {
      const msg = dlg.querySelector(`#fn-${CSS.escape(fnId)}-cap-msg`);
      if (msg) {
        msg.hidden = false;
        msg.textContent = '';
        // Filled a moment later, so a screen reader hears it on every press.
        setTimeout(() => { msg.textContent = `${load.name || 'This owner'} already has ${load.max} daily measures, the most the DOR shows for one owner. Remove one first, or give this function to someone else under Organization.`; }, 40);
      }
      return;
    }
    // It starts on the board day it's added, so earlier days don't read as misses.
    const k = { id: newId('k'), name: 'New KPI', unit: 'count', better: 'higher', goal: null, startDay: ctx.getDay(), ...startDate(month) };
    (setup.kpis[fnId] ??= []).push(k);
    commit(setup);
    const input = dlg.querySelector(`[data-kpi="${CSS.escape(k.id)}"] [data-k="name"]`);
    input?.focus();
    input?.select();
    return;
  }

  if (btn.dataset.removeKpi) {
    const { fnId } = kpiTarget(btn);
    const list = setup.kpis[fnId] ?? [];
    const i = list.findIndex((k) => k.id === btn.dataset.removeKpi);
    if (i < 0) return;
    const [gone] = list.splice(i, 1);
    const ok = commit(setup);
    // Focus stays in the list: the KPI above's name box, or Add a KPI when it was the first.
    const prev = list[i - 1];
    focusAfter(prev && dlg.querySelector(`[data-kpi="${CSS.escape(prev.id)}"] [data-k="name"]`), `[data-add-kpi="${CSS.escape(fnId)}"]`);
    done(ok, `${gone.name} removed from the board.`, {
      actionLabel: 'Undo',
      // The KPI comes back where it was, with focus on its name box (its function's editor open).
      onAction: () => {
        const s = readSetup();
        (s.kpis[fnId] ??= []).splice(i, 0, gone);
        undoTo(s, `[data-kpi="${CSS.escape(gone.id)}"] [data-k="name"]`, `[data-toggle="${CSS.escape(fnId)}"]`, () => { openFn = fnId; })();
      },
    });
    return;
  }

  if (btn.dataset.hideFn) {
    const id = btn.dataset.hideFn;
    const fn = month.functions.find((f) => f.id === id);
    const before = structuredClone(setup);
    if (fn?.custom) {
      setup.added = setup.added.filter((a) => a.id !== id);
      delete setup.kpis[id];
      delete setup.functions[id];
      if (setup.order) setup.order = setup.order.filter((x) => x !== id);
    } else {
      fnSetup(setup, id).hidden = true;
    }
    openFn = null;
    const ok = commit(setup);
    // Removed: its Put back. Deleted (added here): the function that was above it, else Add a function.
    const i = month.functions.findIndex((f) => f.id === id);
    const near = month.functions[i - 1] ?? month.functions[i + 1];
    if (fn?.custom) focusAfter(near && dlg.querySelector(`[data-toggle="${CSS.escape(near.id)}"]`), '[data-add-fn]');
    else focusAfter(dlg.querySelector(`[data-restore="${CSS.escape(id)}"]`), '[data-add-fn]');
    done(ok, `${fn?.name ?? 'Function'} ${fn?.custom ? 'deleted' : 'removed from the board'}.`, {
      actionLabel: 'Undo',
      onAction: undoTo(before, `[data-toggle="${CSS.escape(id)}"]`, '#su-fns'),
    });
    return;
  }

  if (btn.dataset.restore) {
    const id = btn.dataset.restore;
    const before = structuredClone(setup);
    const f = fnSetup(setup, id);
    delete f.hidden;
    const ok = commit(setup);
    focusAfter(dlg.querySelector(`[data-toggle="${CSS.escape(id)}"]`), '#su-fns');
    done(ok, `${(month.hiddenFunctions ?? []).find((x) => x.id === id)?.name ?? 'Function'} is back on the board.`, {
      actionLabel: 'Undo',
      // Removed again: focus on its Put back.
      onAction: undoTo(before, `[data-restore="${CSS.escape(id)}"]`, '#su-fns'),
    });
    return;
  }

  if (btn.matches('[data-add-fn]')) {
    const id = newId('f');
    setup.added.push({ id, name: 'New function', owner: 'Owner name', question: '' });
    setup.kpis[id] = [{ id: newId('k'), name: 'New KPI', unit: 'count', better: 'higher', goal: null, startDay: ctx.getDay(), ...startDate(month) }];
    setup.order = [...fullOrder(month), id];
    openFn = id;
    const ok = commit(setup);
    const input = dlg.querySelector(`#fn-${CSS.escape(id)}-name`);
    input?.scrollIntoView({ block: 'center' });
    input?.focus();
    input?.select();
    done(ok, 'Function added at the end of the meeting. Name it, then add its owner and KPIs.');
    return;
  }

  if (btn.dataset.removePhoto) {
    const before = structuredClone(setup);
    delete fnSetup(setup, btn.dataset.removePhoto).photo;
    const ok = commit(setup);
    // "Add a photo" is a label for the file box: the box takes the focus (and shows the ring on the label).
    focusAfter(dlg.querySelector(`#fn-${CSS.escape(btn.dataset.removePhoto)}-photo`), '#setup-title');
    const photoFn = btn.dataset.removePhoto;
    done(ok, 'Photo removed.', {
      actionLabel: 'Undo',
      // The photo is back: focus its Remove photo button again.
      onAction: undoTo(before, `[data-remove-photo="${CSS.escape(photoFn)}"]`, `#fn-${CSS.escape(photoFn)}-photo`, () => { openFn = photoFn; }),
    });
    return;
  }

  if (btn.matches('[data-reset-setup]')) {
    const snapshot = resetSetup();
    openFn = null;
    questionDrafts.clear();
    questionBase.clear();
    commit(readSetup());
    focusAfter(dlg.querySelector('#su-reset'), '#setup-title');
    ctx.toast('Board setup is back to the plant workbook.', { actionLabel: 'Undo', onAction: undoTo(snapshot, '#su-reset') });
  }
}

/** A square, small JPEG of the photo (center crop), so it fits in this device's storage. */
function addPhoto(fnId, file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { ctx.toast('That file isn\'t a photo. Pick a JPG or PNG.'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const size = 160;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = Math.max(0, (img.naturalHeight - side) / 2 - side * 0.08); // a little above center: faces
      canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
      const setup = readSetup();
      fnSetup(setup, fnId).photo = canvas.toDataURL('image/jpeg', 0.85);
      const ok = commit(setup);
      done(ok, 'Photo added.');
      dlg.querySelector(`#fn-${CSS.escape(fnId)}-photo`)?.focus();
    };
    img.onerror = () => ctx.toast('That photo couldn\'t be read. Try a JPG or PNG.');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}
