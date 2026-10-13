// Board setup: set the board up for any plant without a developer. Plant name,
// functions in meeting order, owners (photo optional), and the KPIs each
// function tracks, with their goals and units. Everything applies to the board
// as it's changed and stays on this device (store.js readSetup / writeSetup).

import { readSetup, writeSetup, resetSetup, UNITS, kpiRowsFor, ownerFor, scaleExtraValues, scalePrimaryValues } from './store.js?v=20261012-235706';
import { parseInput, toInputValue, plainLabel } from './format.js?v=20261012-235706';
import { esc } from './ui.js?v=20261012-235706';
import { icon, DEPT_ICON } from './icons.js?v=20261012-235706';
import { avatarMarkup } from './board.js?v=20261012-235706';

let dlg;
let ctx;
let openFn = null; // the function whose editor is open
let opener = null;
let changeTimer;

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
  dlg.addEventListener('change', onChange);
  dlg.addEventListener('close', () => { opener?.focus?.({ preventScroll: true }); opener = null; });
}

export function openSetup() {
  opener = document.activeElement;
  render();
  if (!dlg.open) dlg.showModal();
  requestAnimationFrame(() => dlg.querySelector('#setup-title')?.focus({ preventScroll: true }));
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
    ctx.toast("This browser isn't saving (private window or storage turned off). Your setup works until you close the page.");
  }
  return ok;
}

/** Save now and redraw the board (structural changes). Returns true when it was saved on the device. */
function commit(setup, { rerender = true } = {}) {
  pending = null;
  clearTimeout(changeTimer);
  const ok = saved(writeSetup(setup));
  ctx.onChange();
  if (rerender) render();
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
          <input id="${pre}-name" type="text" data-k="name" value="${esc(k.name)}" autocomplete="off">
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
        </div>
        <div class="su-field">
          <label for="${pre}-rollup">The month</label>
          <select id="${pre}-rollup" data-k="rollup">
            <option value="total"${(k.rollup ?? UNITS.find((u) => u.id === k.unit)?.rollup) === 'total' ? ' selected' : ''}>Adds up the days</option>
            <option value="average"${(k.rollup ?? UNITS.find((u) => u.id === k.unit)?.rollup) === 'average' ? ' selected' : ''}>Averages the days</option>
          </select>
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
          <input id="${pre}-label" type="text" data-wb="kpiLabel" value="${esc(f.kpiLabel ?? '')}" placeholder="${esc(plainLabel({ boardLabel: fn.sourceDayLabel ?? day.boardLabel }))}" autocomplete="off">
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
          <input id="${pre}-mlabel" type="text" data-wb="monthLabel" value="${esc(f.monthLabel ?? '')}" placeholder="${esc(plainLabel({ boardLabel: fn.sourceMonthLabel ?? mo.boardLabel }))}" autocomplete="off">
        </div>
        <div class="su-field">
          <label for="${pre}-mgoal">Month goal</label>
          <div class="su-suffix${moPct ? ' has-suffix' : ''}">
            <input id="${pre}-mgoal" type="text" inputmode="decimal" data-wb="monthGoal" data-unit="${esc(mo.unit)}" value="${esc(goalText(f.monthGoal, mo.unit))}" placeholder="From the plan" autocomplete="off" aria-describedby="${pre}-goal-note ${pre}-mgoal-err">
            ${moPct ? '<span aria-hidden="true">%</span>' : ''}
          </div>
          <p class="su-error" id="${pre}-mgoal-err" hidden></p>
        </div>
      </div>
      <p class="su-note" id="${pre}-goal-note">Leave a goal empty to use the plant plan's goals, which can change day by day. Units come from the workbook.</p>
    </fieldset>`;
}

function editor(month, fn, setup) {
  const f = setup.functions[fn.id] ?? {};
  const owner = ownerFor(fn);
  const kpis = setup.kpis[fn.id] ?? [];
  const pre = `fn-${fn.id}`;
  return `
    <div class="su-editor" id="${pre}-editor">
      <div class="su-grid">
        <div class="su-field su-field--wide">
          <label for="${pre}-name">Function name</label>
          <input id="${pre}-name" type="text" data-f="name" value="${esc(fn.name)}" autocomplete="off">
        </div>
        <div class="su-field su-field--full">
          <label for="${pre}-question">Daily question</label>
          <input id="${pre}-question" type="text" data-f="question" value="${esc(fn.dorQuestion ?? '')}" placeholder="For example: Did we start the shift in control?" autocomplete="off">
        </div>
      </div>

      <div class="su-owner">
        ${avatarMarkup(owner, 'avatar su-avatar')}
        <div class="su-owner-fields">
          <div class="su-field">
            <label for="${pre}-owner">Owner</label>
            <input id="${pre}-owner" type="text" data-f="owner" value="${esc(fn.owner)}" autocomplete="off">
          </div>
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
      <button class="btn btn--secondary su-add" type="button" data-add-kpi="${esc(fn.id)}">${icon('clipboard', 'i')}Add a KPI to ${esc(fn.name)}</button>

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
          <span class="su-fn-edit">${open ? 'Close' : 'Edit'}${icon('chevronDown', `i su-chev${open ? ' is-open' : ''}`)}</span>
        </button>
        <div class="su-move" role="group" aria-label="Meeting order">
          <button class="icon-btn" type="button" data-move="${esc(fn.id)}" data-dir="-1" aria-label="Move ${esc(fn.name)} earlier in the meeting" title="Move up"${i === 0 ? ' disabled' : ''}>${ARROW_UP}</button>
          <button class="icon-btn" type="button" data-move="${esc(fn.id)}" data-dir="1" aria-label="Move ${esc(fn.name)} later in the meeting" title="Move down"${i === total - 1 ? ' disabled' : ''}>${ARROW_DOWN}</button>
        </div>
      </div>
      ${open ? editor(month, fn, setup) : ''}
    </li>`;
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
        <p class="su-lead">Set the board up for any plant: its name, the functions in meeting order, who owns each one, and the KPIs they track. Changes show on the board right away and stay on this device.</p>

        <section class="su-section" aria-labelledby="su-plant">
          <h3 class="su-head" id="su-plant">Plant</h3>
          <div class="su-field">
            <label for="su-plant-name">Plant name</label>
            <input id="su-plant-name" type="text" data-plant-input value="${esc(month.plant)}" autocomplete="off" aria-describedby="su-plant-note">
            <p class="su-note" id="su-plant-note">Shows as "${esc(month.plant)} plant" on the board.</p>
          </div>
        </section>

        <section class="su-section" aria-labelledby="su-fns">
          <h3 class="su-head" id="su-fns">Functions, in meeting order</h3>
          <ol class="su-fns">${month.functions.map((fn, i) => fnRow(month, fn, setup, i, month.functions.length)).join('')}</ol>
          <button class="btn btn--primary su-add-fn" type="button" data-add-fn>Add a function</button>
          ${hidden.length ? `
            <h4 class="su-subhead">Removed from the board</h4>
            <ul class="su-hidden">${hidden.map((fn) => `<li><span>${esc(fn.name)} <span class="su-fn-meta">${esc(fn.owner)}</span></span><button class="btn btn--secondary" type="button" data-restore="${esc(fn.id)}">Put back</button></li>`).join('')}</ul>` : ''}
        </section>

        <section class="su-section su-section--reset" aria-labelledby="su-reset">
          <h3 class="su-head" id="su-reset">Start over</h3>
          <p class="su-note">Go back to the plant workbook's setup. Numbers people entered stay.</p>
          <button class="btn btn--secondary" type="button" data-reset-setup>Reset board setup</button>
        </section>
      </div>
    </div>`;
  const panel = dlg.querySelector('.sheet-panel');
  if (panel) panel.scrollTop = keep;
}

/* ---------- Events ---------- */

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
  const el = e.target;
  const setup = readSetup();
  if (el.matches('[data-plant-input]')) {
    // "Riverside Plant" and "Riverside" both read "Riverside plant" on the board.
    setup.plant = el.value.trim().replace(/\s+plant$/i, '') || null;
    const note = dlg.querySelector('#su-plant-note');
    if (note) note.textContent = `Shows as "${setup.plant ?? ctx.getMonth().sourcePlant} plant" on the board.`;
    commitSoon(setup);
    return;
  }
  const { fnId, kpiId } = kpiTarget(el);
  if (!fnId) return;
  if (el.dataset.f) {
    const v = el.value.trim();
    if (el.dataset.f === 'question') fnSetup(setup, fnId).question = el.value;
    else if (v) fnSetup(setup, fnId)[el.dataset.f] = v;
    else delete fnSetup(setup, fnId)[el.dataset.f];
    if (el.dataset.f === 'name') {
      // Keep the list's name in step without redrawing the sheet.
      const name = el.closest('[data-fn]').querySelector('.su-fn-name');
      if (name) name.textContent = v || '';
    }
    commitSoon(setup);
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
    k.goal = g;
    commitSoon(setup);
  }
}

function onChange(e) {
  const el = e.target;
  if (el.matches('[data-photo]')) { addPhoto(el.dataset.photo, el.files?.[0]); return; }
  const { fnId, kpiId } = kpiTarget(el);
  if (!fnId || !kpiId || !['unit', 'better', 'rollup'].includes(el.dataset.k)) return;
  const setup = readSetup();
  const k = (setup.kpis[fnId] ?? []).find((x) => x.id === kpiId);
  if (!k) return;
  if (el.dataset.k === 'unit') {
    // A goal typed as a percent means something else as a count: convert it, and the numbers already entered.
    const factor = k.unit !== 'fraction' && el.value === 'fraction' ? 0.01 : k.unit === 'fraction' && el.value !== 'fraction' ? 100 : 1;
    if (typeof k.goal === 'number') k.goal *= factor;
    if (factor !== 1) {
      const fn = ctx.getMonth().functions.find((f) => f.id === fnId);
      if (fn?.custom && fn.firstKpiId === kpiId) scalePrimaryValues(fnId, factor);
      else scaleExtraValues(fnId, kpiId, factor);
    }
    k.unit = el.value;
    delete k.rollup; // follows the unit unless picked
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
    done(ok, `${month.functions[i].name} moved ${Number(btn.dataset.dir) < 0 ? 'earlier' : 'later'} in the meeting.`, { actionLabel: 'Undo', onAction: () => commit(before) });
    return;
  }

  if (btn.dataset.addKpi) {
    const fnId = btn.dataset.addKpi;
    // It starts on the board day it's added, so earlier days don't read as misses.
    const k = { id: newId('k'), name: 'New KPI', unit: 'count', better: 'higher', goal: null, startDay: ctx.getDay() };
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
    done(ok, `${gone.name} removed from the board.`, {
      actionLabel: 'Undo',
      onAction: () => { const s = readSetup(); (s.kpis[fnId] ??= []).splice(i, 0, gone); commit(s); },
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
    done(ok, `${fn?.name ?? 'Function'} ${fn?.custom ? 'deleted' : 'removed from the board'}.`, { actionLabel: 'Undo', onAction: () => commit(before) });
    return;
  }

  if (btn.dataset.restore) {
    const f = fnSetup(setup, btn.dataset.restore);
    delete f.hidden;
    const ok = commit(setup);
    done(ok, `${(month.hiddenFunctions ?? []).find((x) => x.id === btn.dataset.restore)?.name ?? 'Function'} is back on the board.`);
    return;
  }

  if (btn.matches('[data-add-fn]')) {
    const id = newId('f');
    setup.added.push({ id, name: 'New function', owner: 'Owner name', question: '' });
    setup.kpis[id] = [{ id: newId('k'), name: 'New KPI', unit: 'count', better: 'higher', goal: null, startDay: ctx.getDay() }];
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
    done(ok, 'Photo removed.', { actionLabel: 'Undo', onAction: () => commit(before) });
    return;
  }

  if (btn.matches('[data-reset-setup]')) {
    const snapshot = resetSetup();
    openFn = null;
    commit(readSetup());
    ctx.toast('Board setup is back to the plant workbook.', { actionLabel: 'Undo', onAction: () => commit(snapshot) });
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
