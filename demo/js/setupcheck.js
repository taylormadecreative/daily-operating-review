// Pilot boards: "Finish setting up this board" (PILOT-SPEC.md Part 4). Home and the Daily review
// show a short checklist while any function on the board has no owner or no daily goal, and drop
// it once every function has both. Days off are listed but never keep it up: a plant may have none.
// Each row's button goes to the box to fill in; js/app.js opens Board setup for the first two.

import { readSetup, getOrg } from './store.js?v=20261123-135808';
import { esc } from './ui.js?v=20261123-135808';
import { pageHref } from './shell.js?v=20261123-135808';

const PLACEHOLDER_OWNER = /^\s*(owner(\s+name)?)?\s*$/i;
const DONE = '<svg class="setup-check-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** The function's daily measure has a goal (its latest dated goal on a pilot board, else its goal). */
function hasGoal(setup, fn) {
  const list = setup.kpis?.[fn.id] ?? [];
  const k = list.find((x) => x.id === fn.firstKpiId) ?? list[0];
  if (!k) return false;
  if (Array.isArray(k.goals) && k.goals.length) return isNum(k.goals[k.goals.length - 1].goal);
  return isNum(k.goal);
}

/** What's left: { owners: { done, total, first }, goals: { done, total, first }, daysOff } */
export function setupProgress(month) {
  let setup;
  try { setup = readSetup(); } catch { setup = { kpis: {} }; }
  const fns = month.functions;
  const noOwner = fns.filter((fn) => PLACEHOLDER_OWNER.test(String(fn.owner ?? '')));
  const noGoal = fns.filter((fn) => !hasGoal(setup, fn));
  let daysOff = 0;
  try { daysOff = (getOrg(month).daysOff ?? []).length; } catch { daysOff = 0; }
  return {
    owners: { done: fns.length - noOwner.length, total: fns.length, first: noOwner[0]?.id ?? null },
    goals: { done: fns.length - noGoal.length, total: fns.length, first: noGoal[0]?.id ?? null },
    daysOff,
  };
}

function row(what, state, done, control) {
  return `<li class="setup-check-row${done ? ' is-done' : ''}">
      <span class="setup-check-what">${esc(what)}</span>
      <span class="setup-check-state">${done ? `${DONE}Done` : esc(state)}</span>
      ${done ? '' : control}
    </li>`;
}

function markup(month, day, p, n) {
  const ownersDone = p.owners.done === p.owners.total;
  const goalsDone = p.goals.done === p.goals.total;
  const daysHref = pageHref(month, day, { view: 'org', hash: 'days-off' });
  return `<h2 class="setup-check-title" id="setup-check-title-${n}">Finish setting up this board</h2>
    <p class="setup-check-lead">Numbers can go in once each function has an owner. Goals decide on track and off goal.</p>
    <ul class="setup-check-list">
      ${row("Name each function's owner", `${p.owners.done} of ${p.owners.total} named`, ownersDone,
    `<button class="btn btn--secondary" type="button" data-check="owners" data-check-fn="${esc(p.owners.first ?? '')}">Name owners</button>`)}
      ${row('Set each daily goal', `${p.goals.done} of ${p.goals.total} set`, goalsDone,
    `<button class="btn btn--secondary" type="button" data-check="goals" data-check-fn="${esc(p.goals.first ?? '')}">Set goals</button>`)}
      ${row("Add the plant's days off", p.daysOff ? `${p.daysOff} added` : 'None yet', false,
    `<a class="btn btn--secondary" href="${esc(daysHref)}" data-check="days-off">Add days off</a>`)}
    </ul>`;
}

const drawn = new WeakMap(); // host -> the markup it shows

/** Draw (or drop) the checklist under the scope line on Home and the Daily review. */
export function renderSetupCheck(month, day) {
  const p = month.functions.length ? setupProgress(month) : null;
  const open = p && (p.owners.done < p.owners.total || p.goals.done < p.goals.total);
  let n = 0;
  document.querySelectorAll('[data-scope]').forEach((scope) => {
    const page = scope.closest('[data-page]')?.dataset.page ?? (scope.closest('.app') ? 'dor' : 'home');
    let host = scope.nextElementSibling?.matches?.('[data-setup-check]') ? scope.nextElementSibling : null;
    if (!open || (page !== 'home' && page !== 'dor')) {
      host?.remove();
      return;
    }
    n += 1;
    if (!host) {
      host = document.createElement('section');
      host.className = 'setup-check';
      host.dataset.setupCheck = '';
      host.setAttribute('aria-labelledby', `setup-check-title-${n}`);
      scope.after(host);
    }
    const html = markup(month, day, p, n);
    if (drawn.get(host) === html) return;
    host.innerHTML = html;
    drawn.set(host, html);
  });
}
