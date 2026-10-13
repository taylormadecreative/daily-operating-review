// Enter numbers: 1) who's entering, 2) one form for one function and day,
// 3) save -> back to the board with a toast and Undo (handled by app.js).
// Built for a phone at 6:40 AM: big inputs, goals shown, live status,
// plain-word errors, Enter moves to the next box, only Save saves, and a
// warning only when something would be lost.

import { AREA_IDS, saveEntry, notesFor } from './store.js?v=20261012-235706';
import { getIdentity, setIdentity } from './identity.js?v=20261012-235706';
import { compareToGoal, isProductionDay, ON, NOT_ENTERED, NO_PRODUCTION } from './status.js?v=20261012-235706';
import {
  toInputValue, parseInput, formatGoal, plainLabel, formatDayMedium, formatDayLong, monthSoFar, isPercent,
  glossaryTerm,
} from './format.js?v=20261012-235706';
import { esc, statusMarkup, termButton } from './ui.js?v=20261012-235706';
import { statusWord } from './status.js?v=20261012-235706';

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
let st = null; // { step, fnId, requestedFnId, day, initial, mode }
let leaveAction = 'close'; // what "Leave without saving" does: 'close' or 'switch'
let announceTimer;

export function initEnter(h) {
  handlers = h;
  dlg = document.getElementById('enter');
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });
  dlg.addEventListener('click', onClick);
  dlg.addEventListener('input', onInput);
  dlg.addEventListener('change', onChange);
  dlg.addEventListener('keydown', onKeydown);
  dlg.addEventListener('submit', (e) => e.preventDefault()); // only the Save button saves
  window.addEventListener('beforeunload', (e) => {
    if (dlg.open && isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });
}

export const isEnterOpen = () => Boolean(dlg?.open);

export function openEnter(m, { fnId = null, day, mode = 'enter', focus = null }) {
  month = m;
  const who = getIdentity(month);
  // mode 'switch': only choose who is entering, then close.
  const step = mode === 'switch' || !who ? 'who' : 'form';
  // focus 'status': came from "Set status", so the form lands on the status control.
  st = { step, mode, requestedFnId: fnId, fnId: fnId ?? who?.functionId ?? null, day, initial: null, focus };
  if (st.step === 'who') renderWho();
  else renderForm();
  if (!dlg.open) dlg.showModal();
  focusLanding();
}

/** The title, the status control ("Set status"), or one KPI's box (a KPI added in Board setup). */
function focusLanding() {
  if (st?.step === 'form' && String(st.focus ?? '').startsWith('kpi:')) {
    const input = dlg.querySelector(`#e-x-${CSS.escape(st.focus.slice(4))}`);
    if (input) {
      requestAnimationFrame(() => {
        input.scrollIntoView({ block: 'center' });
        input.focus({ preventScroll: true });
      });
      return;
    }
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
}

function focusTitle() {
  requestAnimationFrame(() => dlg.querySelector('#enter-title')?.focus({ preventScroll: true }));
}

/* ---------- Step 1: who's entering ---------- */

function renderWho() {
  const who = getIdentity(month);
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
        <p class="enter-sub">Tap your name. This phone or computer will remember you.</p>
        <ul class="who-list">
          ${month.functions.map((f) => `
            <li><button class="who-btn${who?.functionId === f.id ? ' is-current' : ''}" type="button" data-person="${esc(f.id)}">
              <span class="who-name">${esc(f.owner)}</span>
              <span class="who-fn">${esc(f.name)}</span>
            </button></li>`).join('')}
        </ul>
      </div>
    </div>`;
}

/* ---------- Step 2: the form ---------- */

function fnObj() { return month.functions.find((f) => f.id === st.fnId); }
const kpiFor = (fn, key) => extraOf(fn, key)?.kpiDaily ?? (key === 'month' ? fn.kpiMonthly : fn.kpiDaily);

/** Current stored values for the function on the form's day, as input text. */
function storedValues(fn, day) {
  const out = {};
  for (const a of AREA_IDS) {
    const row = (fn.daily[a] ?? []).find((r) => r.day === day);
    out[a] = toInputValue(row?.actual, fn.kpiDaily);
  }
  const mrow = (fn.monthToDate ?? []).find((r) => r.day === day);
  out.month = toInputValue(mrow?.actual, fn.kpiMonthly);
  const n = notesFor(fn, day);
  out.issue = n.problem ?? '';
  out.action = n.action ?? '';
  out.issueStatus = n.status ?? '';
  for (const k of fn.extraKpis ?? []) {
    const row = k.daily.plant.find((r) => r.day === day);
    out[extraKey(k)] = toInputValue(row?.actual, k.kpiDaily);
    const xn = notesFor(k, day);
    out[`xi-${k.kpiId}`] = xn.problem ?? '';
    out[`xa-${k.kpiId}`] = xn.action ?? '';
    out[`xs-${k.kpiId}`] = xn.status ?? '';
  }
  return out;
}

function goalOf(fn, key, day) {
  const x = extraOf(fn, key);
  if (x) return { goal: x.daily.plant.find((r) => r.day === day)?.goal ?? null, note: null };
  if (key === 'month') {
    const r = (fn.monthToDate ?? []).find((x) => x.day === day);
    return { goal: r?.goal ?? null, note: null };
  }
  const r = (fn.daily[key] ?? []).find((x) => x.day === day);
  return { goal: r?.goal ?? null, note: r?.goalNote ?? null };
}

function fieldLabel(fn, key, label) {
  const t = key === 'plant' || key === 'month' ? glossaryTerm(month, kpiFor(fn, key)) : null;
  return `<span class="field-label-row"><label class="field-label" for="e-${key}">${esc(label)}</label>${t ? termButton(t.term, t.definition) : ''}</span>`;
}

function fieldMarkup(fn, key, label, primary) {
  const kpi = kpiFor(fn, key);
  const id = `e-${key}`;
  const pct = isPercent(kpi);
  return `
    <div class="field${primary ? ' field--primary' : ''}" data-field="${key}">
      ${fieldLabel(fn, key, label)}
      <div class="field-row">
        <div class="input-wrap${pct ? ' has-suffix' : ''}">
          <input class="field-input" id="${id}" name="${key}" type="text" inputmode="decimal" autocomplete="off"
            spellcheck="false" enterkeyhint="next" aria-describedby="${id}-goal ${id}-status ${id}-err ${id}-nudge">
          ${pct ? '<span class="suffix" aria-hidden="true">%</span>' : ''}
        </div>
        <p class="field-goal" id="${id}-goal"></p>
      </div>
      <p class="field-status" id="${id}-status"></p>
      <p class="field-error" id="${id}-err" hidden></p>
      <p class="field-nudge" id="${id}-nudge" hidden></p>
    </div>`;
}

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
  const who = getIdentity(month);
  dlg.innerHTML = `
    <form class="enter-scroll" novalidate>
      <header class="enter-top">
        <p class="enter-as">Entering as <strong>${esc(who?.name ?? 'someone')}</strong>
          <span class="nowrap"><span aria-hidden="true">·</span>
          <button class="btn--text not-you" type="button" data-not-you>Not you?</button></span></p>
        <button class="icon-btn" type="button" data-close aria-label="Close">
          <svg class="icon" aria-hidden="true" focusable="false"><use href="#g-close"></use></svg>
        </button>
      </header>
      <div class="enter-body">
        <h2 class="enter-title" id="enter-title" tabindex="-1" data-form-title></h2>
        <div class="day-pick">
          <label for="e-day">Production day</label>
          <select id="e-day" name="day" class="day-select">${dayOptions()}</select>
        </div>
        <p class="enter-sub">Numbers already on the board are filled in. Change any that are wrong. Goals come from the plant's plan. Leave a box empty if you don't have the number yet.</p>

        <fieldset class="group group--primary">
          <legend><span class="group-name">${fn.custom ? "The day's number" : 'Plant total'}</span> <span class="group-note">This number sets the status on the board.${fn.custom ? ' The month adds up by itself.' : ''}</span></legend>
          ${fieldMarkup(fn, 'plant', plainLabel(fn.kpiDaily), true)}
        </fieldset>

        ${fn.custom ? '' : `<details class="group group--areas" data-areas>
          <summary><span class="group-name">By area</span> <span class="group-note">Optional: Mold, Bond, Prime, Compounding</span></summary>
          <div class="area-grid">
            ${AREA_KEYS.map((a) => fieldMarkup(fn, a, AREA_NAME[a], false)).join('')}
          </div>
        </details>

        <fieldset class="group">
          <legend><span class="group-name" data-month-legend></span></legend>
          ${fieldMarkup(fn, 'month', plainLabel(fn.kpiMonthly), false)}
        </fieldset>`}


        ${(fn.extraKpis ?? []).length ? `<fieldset class="group group--extra">
          <legend><span class="group-name">More ${esc(fn.name)} KPIs</span> <span class="group-note">Each has its own status on the board. The month adds up by itself.</span></legend>
          ${fn.extraKpis.map((k) => `${fieldMarkup(fn, extraKey(k), plainLabel(k.kpiDaily), false)}
          <details class="extra-notes">
            <summary>Issue and action for ${esc(plainLabel(k.kpiDaily))}</summary>
            <div class="field field--text">
              <label class="field-label" for="e-xi-${esc(k.kpiId)}">What problem needs solving?</label>
              <textarea class="field-textarea" id="e-xi-${esc(k.kpiId)}" name="xi-${esc(k.kpiId)}" rows="2"></textarea>
            </div>
            <fieldset class="field field--status field--xstatus">
              <legend class="field-label">Where is this problem?</legend>
              <div class="segmented">
                <label><input type="radio" name="xs-${esc(k.kpiId)}" value="open"><span>Open</span></label>
                <label><input type="radio" name="xs-${esc(k.kpiId)}" value="in-progress"><span>In progress</span></label>
                <label><input type="radio" name="xs-${esc(k.kpiId)}" value="closed"><span>Closed</span></label>
              </div>
            </fieldset>
            <div class="field field--text">
              <label class="field-label" for="e-xa-${esc(k.kpiId)}">What are we doing in the next 24 hours?</label>
              <textarea class="field-textarea" id="e-xa-${esc(k.kpiId)}" name="xa-${esc(k.kpiId)}" rows="2"></textarea>
            </div>
          </details>`).join('')}
        </fieldset>` : ''}

        <div class="group group--text">
          ${(fn.extraKpis ?? []).length ? `<p class="group-name group-name--text">Issue and action for ${esc(plainLabel(fn.kpiDaily))}</p>` : ''}
          <div class="field field--text">
            <label class="field-label" for="e-issue">What problem needs solving?</label>
            <textarea class="field-textarea" id="e-issue" name="issue" rows="3"></textarea>
          </div>
          <fieldset class="field field--status" aria-describedby="e-status-hint">
            <legend class="field-label">Where is this problem?</legend>
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

  fillValues(storedValues(fn, st.day));
  st.initial = serialize();
  updateDayDependent();
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
  const has = Boolean(dlg.querySelector('#e-issue')?.value.trim());
  set.disabled = !has;
  set.classList.toggle('is-disabled', !has);
  if (!has) dlg.querySelectorAll('[name="issueStatus"]').forEach((r) => { r.checked = false; });
  set.querySelector('.field-hint').textContent = has ? 'Shows in Issues and Actions on the dashboard.' : 'Type the problem first.';
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
  dlg.querySelector('[data-form-title]').textContent = `${fn.name} numbers for ${formatDayMedium(month, st.day).replace(/ /g, ' ')}`;
  const legend = dlg.querySelector('[data-month-legend]');
  if (legend) legend.textContent = `${monthSoFar(month)}, through ${formatDayMedium(month, st.day)}`;
  for (const key of numberKeys(fn)) {
    const { goal, note } = goalOf(fn, key, st.day);
    dlg.querySelector(`#e-${key}-goal`).textContent = formatGoal(goal, kpiFor(fn, key), note);
    updatePreview(key);
  }
}

function evaluate(key) {
  const fn = fnObj();
  const kpi = kpiFor(fn, key);
  const input = dlg.querySelector(`#e-${key}`);
  const { goal } = goalOf(fn, key, st.day);
  const parsed = parseInput(input.value, kpi, goal);
  if (!parsed.ok) return { error: parsed.error };
  const idle = key !== 'month' && isProductionDay(month, st.day) === false;
  if (parsed.value === null) return { status: idle ? NO_PRODUCTION : NOT_ENTERED, empty: true };
  const s = compareToGoal(parsed.value, goal, kpi.better);
  return { status: idle && s === ON ? NO_PRODUCTION : s, suggest: parsed.suggest };
}

function updatePreview(key, { showError = false } = {}) {
  const res = evaluate(key);
  const input = dlg.querySelector(`#e-${key}`);
  const statusEl = dlg.querySelector(`#e-${key}-status`);
  const errEl = dlg.querySelector(`#e-${key}-err`);
  const nudgeEl = dlg.querySelector(`#e-${key}-nudge`);
  if (res.error) {
    statusEl.innerHTML = '';
    nudgeEl.hidden = true;
    if (showError || !errEl.hidden) {
      errEl.textContent = res.error;
      errEl.hidden = false;
      input.setAttribute('aria-invalid', 'true');
    }
    return res;
  }
  errEl.hidden = true;
  input.removeAttribute('aria-invalid');
  // A question only when the number is probably a slip (0.975 for 97.5%).
  if (res.suggest) {
    // Rebuild only when the suggestion changes, so a click on "Use" is never
    // lost to a re-render when the box loses focus.
    if (nudgeEl.dataset.suggest !== res.suggest) {
      nudgeEl.innerHTML = `<span>Did you mean ${esc(res.suggest)}%?</span> `
        + `<button class="btn btn--secondary nudge-btn" type="button" data-use="${esc(key)}" data-value="${esc(res.suggest)}">Use ${esc(res.suggest)}%</button>`;
      nudgeEl.dataset.suggest = res.suggest;
    }
    nudgeEl.hidden = false;
  } else {
    nudgeEl.hidden = true;
    nudgeEl.innerHTML = '';
    delete nudgeEl.dataset.suggest;
  }
  if (AREA_KEYS.includes(key) && res.empty) { statusEl.innerHTML = ''; return res; }
  statusEl.innerHTML = statusMarkup(res.status, { tag: 'span', kpi: kpiFor(fnObj(), key) });
  return res;
}

/* ---------- Events ---------- */

function visibleNumberInputs() {
  return numberKeys(fnObj())
    .map((k) => dlg.querySelector(`#e-${k}`))
    .filter((el) => el && !el.closest('details:not([open])'));
}

function onKeydown(e) {
  if (e.key !== 'Enter' || e.isComposing) return;
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
  const el = e.target;
  if (el.name === 'issueStatus') { hideLeave(); return; }
  if (!el.classList?.contains('field-input')) {
    if (el.classList?.contains('field-textarea')) hideLeave();
    if (el.name === 'issue') {
      syncStatusControl();
      // A problem typed with no status yet starts as Open (visible, changeable).
      if (el.value.trim() && !dlg.querySelector('[name="issueStatus"]:checked')) {
        dlg.querySelector('[name="issueStatus"][value="open"]').checked = true;
      }
    }
    return;
  }
  hideLeave();
  const res = updatePreview(el.name, { showError: /[^\d.,%\s]/.test(el.value) });
  clearTimeout(announceTimer);
  // Worded now, while the form is open; the announcement waits for a pause in typing.
  const word = res.status ? statusWord(res.status, kpiFor(fnObj(), el.name)) : '';
  announceTimer = setTimeout(() => {
    const live = dlg.querySelector('[data-announce]');
    const name = el.name === 'month' ? 'Month' : AREA_NAME[el.name] ?? plainLabel(kpiFor(fnObj(), el.name));
    if (live && !res.error && word) live.textContent = `${name}: ${word}${res.suggest ? `. Did you mean ${res.suggest}%?` : ''}`;
  }, 700);
}

function onChange(e) {
  const el = e.target;
  if (el.name === 'day') {
    const fn = fnObj();
    const dirty = isDirty();
    st.day = Number(el.value);
    if (!dirty) {
      // Nothing typed yet: show what is already stored for that day.
      fillValues(storedValues(fn, st.day));
      st.initial = serialize();
    }
    // If something was typed, keep it: the person probably fixed the date.
    updateDayDependent();
    return;
  }
  if (el.classList?.contains('field-input')) updatePreview(el.name, { showError: true });
}

function onClick(e) {
  if (e.target === dlg) return; // full screen; no backdrop to click
  const btn = e.target.closest('button');
  if (!btn || btn.matches('.term-btn')) return;
  if (btn.matches('[data-close]')) { requestClose(); return; }
  if (btn.matches('[data-save]')) { save(); return; }
  if (btn.matches('[data-use]')) {
    const input = dlg.querySelector(`#e-${btn.dataset.use}`);
    input.value = btn.dataset.value;
    updatePreview(btn.dataset.use);
    input.focus();
    return;
  }
  if (btn.matches('[data-keep]')) { hideLeave(); dlg.querySelector('.field-input')?.focus(); return; }
  if (btn.matches('[data-leave-confirm]')) {
    st.initial = serialize();
    if (leaveAction === 'switch') switchPerson();
    else handlers.onCancel();
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
  if (isDirty()) { showLeave('close'); return; }
  handlers.onCancel();
}

export function showLeave(action = 'close') {
  const box = dlg.querySelector('[data-leave]');
  if (!box) return;
  leaveAction = action;
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
  const fn = fnObj();
  const who = getIdentity(month);
  const values = {};
  let firstBad = null;
  for (const key of numberKeys(fn)) {
    const kpi = kpiFor(fn, key);
    const res = updatePreview(key, { showError: true });
    const parsed = parseInput(dlg.querySelector(`#e-${key}`).value, kpi, goalOf(fn, key, st.day).goal);
    if (!parsed.ok || res.error) {
      if (AREA_KEYS.includes(key)) dlg.querySelector('[data-areas]').open = true;
      firstBad ??= dlg.querySelector(`#e-${key}`);
      continue;
    }
    values[key] = parsed.value;
  }
  const formError = dlg.querySelector('[data-form-error]');
  if (firstBad) {
    formError.textContent = 'Some boxes need a fix before saving. They are marked in red.';
    formError.hidden = false;
    firstBad.focus();
    return;
  }
  formError.hidden = true;
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
    if (xi || xa) extraNotes[k.kpiId] = { issue: xi, action: xa, status: xi ? (xs ?? 'open') : null };
  }
  const issue = text('issue');
  // Did the problem, its next step or its status change? Then the dashboard
  // shows the issue row after saving; otherwise the department's matrix row.
  const before = JSON.parse(st.initial ?? '{}');
  const now = currentValues();
  const notesChanged = ['issue', 'action', 'issueStatus'].some((k) => String(before[k] ?? '').trim() !== String(now[k] ?? '').trim());
  const { ok, previous } = saveEntry({
    functionId: fn.id,
    day: st.day,
    values,
    ...(fn.custom ? {} : { month: monthValue }),
    ...(Object.keys(extra).length ? { extra, extraNotes } : {}),
    issue,
    action: text('action'),
    issueStatus: issue ? (dlg.querySelector('[name="issueStatus"]:checked')?.value ?? null) : null,
    enteredBy: who?.name ?? null,
  });
  if (!ok) {
    formError.textContent = "This browser blocked saving (private window or storage turned off). Your numbers weren't saved.";
    formError.hidden = false;
    return;
  }
  st.initial = serialize();
  handlers.onSaved({ fnId: fn.id, fnName: fn.name, day: st.day, previous, notesChanged, dayLabel: formatDayMedium(month, st.day), dayLong: formatDayLong(month, st.day) });
}
