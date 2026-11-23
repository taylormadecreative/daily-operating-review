// Organization (?view=org, spec §3): the org chart (the Plant manager, the department heads under them,
// the site's areas and their leads) and a sheet for each person: what they own, who they report to,
// their accountable leader and roles, their open actions, and this week so far. The organization
// itself lives in store.js (dor.org.v1) and is edited in Board setup (Draft, Validate, Activate).

import { getOrg, kpiRowsFor, dailyMeasuresOf, DAILY_MEASURE_MAX, ROLES, isoForDay, setOrgDays, boardFirstDay, dateBounds } from './store.js?v=20261123-135808';
import * as cloud from './cloud.js?v=20261123-135808';
import { dayStatus, monthStatus, OFF, NO_GOAL, NOT_TRACKED } from './status.js?v=20261123-135808';
import { formatDayMedium, formatDayLong, plainLabel, dayHeading, formatEnteredAt } from './format.js?v=20261123-135808';
import { esc, statusMarkup, glyphMarkup } from './ui.js?v=20261123-135808';
import { icon, DEPT_ICON } from './icons.js?v=20261123-135808';
import { avatarMarkup, plantName, dueText, periodDateMarkup } from './board.js?v=20261123-135808';
import { listActions } from './actions.js?v=20261123-135808';
import { openOnDay } from './action-state.js?v=20261123-135808';
import { pageHref } from './shell.js?v=20261123-135808';
import { fitSheetHead } from './detail.js?v=20261123-135808';
import { weekFor, weekLabel, weekOfDay } from './wor.js?v=20261123-135808';

let ctx = null;
let dlg = null;
let current = null; // { id, day }
let opener = null;  // the card link that opened the sheet
let closeAsked = false;

const ROLE_NAME = Object.fromEntries(ROLES.map((r) => [r.id, r.name]));
/** A person's title, unless it only repeats their name (a copy where names are role titles). */
const titleOf = (p) => (p.title && p.title.trim().toLowerCase() !== p.name.trim().toLowerCase() ? p.title : '');

/* ---------- Reading the organization against the board ---------- */

/** The functions a person is the responsible owner of, in meeting order. */
const ownedBy = (month, org, pid) => month.functions.filter((fn) => org.functions?.[fn.id]?.responsible === pid);
/** The functions a person is the accountable leader for. */
const accountableFor = (month, org, pid) => month.functions.filter((fn) => org.functions?.[fn.id]?.accountable === pid);

/** A function's day, the way the board's summary reads it: off goal when any of its KPIs is. */
function fnDay(month, fn, day) {
  const kpis = kpiRowsFor(fn);
  for (const k of kpis) {
    const s = dayStatus(month, k, day);
    if (s.status === OFF) return { ...s, kpi: k.kpiDaily };
  }
  return { ...dayStatus(month, fn, day), kpi: fn.kpiDaily };
}

/** Actions that count as this person's on the board day: open then (added by then, not closed by then). */
function openActionsOf(month, org, person, day) {
  const today = isoForDay(month, day);
  const mine = new Set(ownedBy(month, org, person.id).map((f) => f.id));
  const name = person.name.trim().toLowerCase();
  return listActions().filter((a) => {
    if (!openOnDay(a, today)) return false;
    const owner = String(a.owner ?? '').trim().toLowerCase();
    return owner ? owner === name : mine.has(a.fnId);
  });
}

/** Whole days between two 'YYYY-MM-DD' dates. */
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** The person's photo: the one Board setup holds for a function they own, else initials. */
function personAvatar(month, org, person, cls) {
  const fn = ownedBy(month, org, person.id).find((f) => f.ownerPhoto);
  return avatarMarkup({ name: person.name, photo: fn?.ownerPhoto ?? null }, cls);
}

/**
 * This week's result for a KPI (the Weekly review's rollup, as of the board day): its status as word +
 * glyph, the figure against its goal, and its days on goal. -> { status, html, text } or null
 */
function weekResult(month, k, day) {
  const w = weekFor(month, k, day);
  if (!w || !w.days) return null;
  const word = w.goalVaries ? 'Goal varies' : undefined;
  const figure = w.pair.actual === null ? 'Not entered' : `${w.pair.actual}${w.goalVaries || !w.pair.rest ? '' : ` ${w.pair.rest}`}`;
  const days = `on track ${w.met} of ${w.days} ${w.days === 1 ? 'day' : 'days'}${w.provisional ? `, provisional (${w.received} of ${w.expected})` : ''}`;
  const status = w.goalVaries ? NO_GOAL : w.status;
  return {
    status,
    html: `${statusMarkup(status, { tag: 'span', kpi: k.kpiDaily, word, extra: 'oc-week-status' })} <span class="oc-week-fig">${esc(figure)}</span><span class="oc-week-days">${esc(days)}</span>`,
    text: `${figure} · ${days}`,
    week: w.week,
  };
}

const personHref = (month, day, id) => pageHref(month, day, { view: 'org', hash: `person/${id}` });

/* ---------- The chart ---------- */

function cardMarkup(month, org, person, day, { top = false } = {}) {
  const fns = ownedBy(month, org, person.id);
  const load = dailyMeasuresOf(month, org, person.id).count;
  const acts = openActionsOf(month, org, person, day).length;
  const leads = org.areas.filter((a) => a.lead === person.id);
  const dept = fns.length
    ? fns.map((fn) => `<span class="oc-dept-fn">${icon(DEPT_ICON[fn.id] ?? 'board', 'i')}${esc(fn.name)}</span>`).join('')
    : leads.length ? `<span class="oc-dept-fn">${esc(leads.map((a) => `${a.name} area`).join(', '))}</span>` : '<span class="oc-dept-fn is-empty">No function on the board</span>';
  const today = fns.length
    ? fns.map((fn) => {
      const s = fnDay(month, fn, day);
      return `<li>${fns.length > 1 ? `<span class="oc-fact-fn">${esc(fn.name)}</span> ` : ''}${statusMarkup(s.status, { tag: 'span', kpi: s.kpi })}</li>`;
    }).join('')
    : '';
  const week = fns.length ? weekResult(month, fns[0], day) : null;
  const accountable = top ? accountableFor(month, org, person.id).length : 0;
  return `
    <article class="oc${top ? ' oc--top' : ''}" data-person="${esc(person.id)}">
      ${icon('chevronRight', 'i oc-go')}
      <div class="oc-head">
        ${personAvatar(month, org, person, 'avatar oc-avatar')}
        <div class="oc-id">
          <h3 class="oc-name"><a class="oc-open" href="${personHref(month, day, person.id)}" data-open-person="${esc(person.id)}">${esc(person.name || 'No name yet')}</a></h3>
          ${titleOf(person) || !person.title ? `<p class="oc-title">${esc(titleOf(person) || 'No title yet')}</p>` : ''}
        </div>
      </div>
      <p class="oc-dept">${dept}${fns.length ? `<span class="oc-load">${load} daily ${load === 1 ? 'measure' : 'measures'}</span>` : ''}</p>
      ${accountable ? `<p class="oc-acc">Accountable leader for ${accountable === month.functions.length ? `all ${accountable}` : accountable} ${accountable === 1 ? 'function' : 'functions'}</p>` : ''}
      <dl class="oc-facts">
        ${today ? `<div class="oc-fact oc-fact--today"><dt>${esc(dayHeading(month, day))}</dt><dd><ul class="oc-today">${today}</ul></dd></div>` : ''}
        ${week ? `<div class="oc-fact oc-fact--week"><dt>This week</dt><dd class="oc-week">${week.html}</dd></div>` : ''}
        <div class="oc-fact"><dt>Open actions</dt><dd class="${acts ? '' : 'is-empty'}">${acts || (fns.length ? 'None open' : 'None')}</dd></div>
      </dl>
    </article>`;
}

/**
 * The page's headline, short and plain: "One owner and one accountable leader for every function." when
 * each function has both, else what's missing ("2 of 8 functions have no owner yet.").
 */
function orgLead(month, org, byId, unowned) {
  const n = month.functions.length;
  if (!n) return 'No functions on the board yet.';
  const noLeader = month.functions.filter((fn) => !byId.has(org.functions?.[fn.id]?.accountable));
  if (!unowned.length && !noLeader.length) return n === 1 ? 'One owner and one accountable leader for the function.' : 'One owner and one accountable leader for every function.';
  const parts = [];
  if (unowned.length) parts.push(`${unowned.length} of ${n} ${n === 1 ? 'function has' : 'functions have'} no owner yet`);
  if (noLeader.length) parts.push(`${noLeader.length} of ${n} no accountable leader`);
  return `${parts.join('; ')}.`;
}

/** The person at the top: nobody above them, and the most people under them. */
function topPerson(org) {
  const ids = new Set(org.people.map((p) => p.id));
  const roots = org.people.filter((p) => !p.reportsTo || !ids.has(p.reportsTo));
  const count = (p) => org.people.filter((x) => x.reportsTo === p.id).length;
  return roots.sort((a, b) => count(b) - count(a))[0] ?? null;
}

export function renderOrg(month, day) {
  const host = document.querySelector('[data-org]');
  if (!host) return;
  const doc = getOrg(month);
  const org = doc.active;
  document.querySelectorAll('[data-org-sub]').forEach((n) => { n.textContent = `${plantName(month)} · LinkedXL OS`; });
  // The day the chart reads, and its week (the cards' "This week"), in the page's period control.
  const label = document.querySelector('[data-org-date]');
  if (label) {
    label.innerHTML = periodDateMarkup(formatDayLong(month, day));
    label.setAttribute('datetime', isoForDay(month, day));
    const wk = weekOfDay(month, day);
    const wkEl = document.querySelector('[data-org-week]');
    if (wkEl) wkEl.textContent = wk ? `· ${weekLabel(wk).replace(/^Week/, 'week')}` : '';
    const picker = document.querySelector('[data-org-date-input]');
    const bounds = dateBounds(month);
    if (picker) { picker.min = bounds.min; picker.max = bounds.max; picker.value = isoForDay(month, day); }
    document.querySelector('[data-org-prev]').disabled = isoForDay(month, day) <= bounds.min;
    document.querySelector('[data-org-next]').disabled = isoForDay(month, day) >= bounds.max;
  }

  const byId = new Map(org.people.map((p) => [p.id, p]));
  const top = topPerson(org);
  const reports = top ? org.people.filter((p) => p.reportsTo === top.id) : [];
  // Everyone reached from the top; area leads have their own row; anyone else waits in "Not placed yet".
  const reached = new Set(top ? [top.id] : []);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of org.people) if (!reached.has(p.id) && reached.has(p.reportsTo)) { reached.add(p.id); grew = true; }
  }
  const areaLeads = new Set(org.areas.map((a) => a.lead).filter(Boolean));
  const unplaced = org.people.filter((p) => !reached.has(p.id) && !areaLeads.has(p.id));
  const owners = new Set(month.functions.map((fn) => org.functions?.[fn.id]?.responsible).filter((id) => byId.has(id)));
  const unowned = month.functions.filter((fn) => !byId.has(org.functions?.[fn.id]?.responsible));

  // The accountable leaders, by how many functions each answers for.
  const acc = new Map();
  for (const fn of month.functions) {
    const p = byId.get(org.functions?.[fn.id]?.accountable);
    if (p) acc.set(p, (acc.get(p) ?? 0) + 1);
  }
  const accWords = [...acc].sort((a, b) => b[1] - a[1]).map(([p, n]) => (acc.size === 1
    ? `${esc(p.name)}${titleOf(p) ? `, ${esc(titleOf(p))}` : ''}, for ${n === month.functions.length ? `all ${n}` : n} ${n === 1 ? 'function' : 'functions'}`
    : `${esc(p.name)} (${n})`));
  const status = doc.stored
    ? `Active since ${esc(formatEnteredAt(doc.activatedAt))}.`
    : "Read from the board's function owners. Board setup can change it.";

  const deeper = (p) => org.people.filter((x) => x.reportsTo === p.id);
  const reportsList = reports.map((p) => {
    const under = deeper(p);
    return `<li class="oc-slot">${cardMarkup(month, org, p, day)}${under.length ? `
      <ul class="oc-under" aria-label="Reports to ${esc(p.name)}">${under.map((u) => `<li><a class="oc-under-link" href="${personHref(month, day, u.id)}" data-open-person="${esc(u.id)}">${esc(u.name || 'No name yet')}</a><span>${esc(titleOf(u))}</span></li>`).join('')}</ul>` : ''}</li>`;
  }).join('');

  host.innerHTML = `
    <p class="date-note" data-org-note role="status" hidden></p>
    <section class="org-summary" aria-labelledby="org-lead">
      <h2 class="org-lead" id="org-lead">${orgLead(month, org, byId, unowned)}</h2>
      <p class="org-line">${accWords.length ? `Accountable ${acc.size === 1 ? 'leader' : 'leaders'}: ${accWords.join(', ')}.` : 'No accountable leader is set yet.'} ${status}</p>
      ${doc.draft ? `<p class="org-draft">${glyphMarkup('no-goal')}<span>A draft in Board setup isn't active yet.</span> <button class="btn btn--text" type="button" data-open-setup data-setup-section="org">Open the draft</button></p>` : ''}
    </section>

    <section class="oc-chart" aria-labelledby="oc-chart-title">
      <h2 class="sr-only" id="oc-chart-title">Org chart</h2>
      ${top ? `<div class="oc-root">${cardMarkup(month, org, top, day, { top: true })}</div>` : '<p class="org-empty">Nobody is in the organization yet. Add people in Board setup.</p>'}
      ${reports.length ? `<ul class="oc-reports${reports.length > 7 ? ' oc-reports--wrap' : ''}" style="--n: ${reports.length}" aria-label="Reports to ${esc(top.name)}">${reportsList}</ul>` : ''}
      ${unowned.length ? `<p class="org-note">${glyphMarkup('not-entered')}<span>No responsible owner yet: ${esc(unowned.map((f) => f.name).join(', '))}. Assign one in Board setup, under Organization.</span></p>` : ''}
    </section>

    ${unplaced.length ? `
    <section class="org-group" aria-labelledby="org-unplaced">
      <h2 class="org-group-title" id="org-unplaced">Not in the chart yet</h2>
      <p class="org-group-sub">Nobody is set above them. Pick who they report to in Board setup.</p>
      <ul class="oc-grid">${unplaced.map((p) => `<li>${cardMarkup(month, org, p, day)}</li>`).join('')}</ul>
    </section>` : ''}

    <section class="org-group" aria-labelledby="org-areas">
      <h2 class="org-group-title" id="org-areas">Areas</h2>
      <p class="org-group-sub">${esc(plantName(month))}'s production areas. Each can have its own lead.</p>
      <ul class="oc-areas">${org.areas.map((a) => {
        const lead = byId.get(a.lead);
        return `<li class="oc-area">
          <p class="oc-area-name">${esc(a.name)}</p>
          ${lead
            ? `<p class="oc-area-lead"><a class="oc-under-link" href="${personHref(month, day, lead.id)}" data-open-person="${esc(lead.id)}">${esc(lead.name || 'No name yet')}</a><span>${esc(titleOf(lead))}</span></p>`
            : `<button class="oc-add" type="button" data-open-setup data-setup-section="org" data-setup-focus="area:${esc(a.id)}">${icon('plus', 'i')}Add a lead<span class="sr-only"> for ${esc(a.name)}</span></button>`}
        </li>`;
      }).join('')}</ul>
    </section>
    ${cloud.BOARD ? daysMarkup(doc) : ''}`;
  wireDays(host);
}

/* ---------- Days off and extra production days (pilot boards) ---------- */

const DAY_LISTS = [
  ['daysOff', 'Days off', 'Weekdays the plant doesn\'t run. A day off has no goal and counts no miss.'],
  ['extraDays', 'Extra production days', 'Days it runs that are usually off, like a Saturday.'],
];
const dayWords = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${iso}T12:00:00Z`));

function daysMarkup(doc) {
  return DAY_LISTS.map(([which, title, sub]) => `
    <section class="org-group org-days" aria-labelledby="org-${which}" data-days="${which}">
      <h2 class="org-group-title" id="org-${which}">${title}</h2>
      <p class="org-group-sub">${sub} They take effect as soon as they are saved.</p>
      <ul class="org-days-list">${(doc[which] ?? []).map((iso) => `
        <li><time datetime="${iso}">${esc(dayWords(iso))}</time>
          <button class="btn btn--text" type="button" data-day-remove="${iso}">Remove<span class="sr-only"> ${esc(dayWords(iso))}</span></button></li>`).join('')}</ul>
      <form class="org-days-add" data-day-add>
        <label for="org-${which}-new">Add a day</label>
        <input id="org-${which}-new" type="date" min="${esc(boardFirstDay() ?? '')}" required>
        <button class="btn" type="submit">Add</button>
      </form>
    </section>`).join('');
}

function wireDays(host) {
  if (host.dataset.daysWired) return;
  host.dataset.daysWired = '1';
  const save = (which, change) => {
    const doc = getOrg(ctx.getMonth());
    setOrgDays(which, change(doc[which] ?? []));
    ctx.onDaysChange?.();
  };
  host.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-day-add]');
    if (!form) return;
    e.preventDefault();
    const which = form.closest('[data-days]').dataset.days;
    const iso = form.querySelector('input').value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) save(which, (list) => [...list, iso]);
    host.querySelector(`[data-days="${which}"] input`)?.focus();
  });
  host.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-day-remove]');
    if (!btn) return;
    const which = btn.closest('[data-days]').dataset.days;
    save(which, (list) => list.filter((x) => x !== btn.dataset.dayRemove));
    host.querySelector(`[data-days="${which}"] input`)?.focus();
  });
}

/* ---------- The person sheet ---------- */

function requestClose() {
  if (closeAsked) return;
  closeAsked = true;
  ctx.onClose();
}

export function initOrg(c) {
  ctx = c;
  dlg = document.createElement('dialog');
  dlg.className = 'sheet person';
  dlg.id = 'person';
  dlg.setAttribute('aria-labelledby', 'person-title');
  document.body.append(dlg);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });
  dlg.addEventListener('close', () => {
    // Chrome can close a modal on Esc without honoring preventDefault: tidy up and sync the URL.
    if (!current || dlg.open) return;
    const id = current.id;
    current = null;
    focusBack(id);
    requestClose();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) requestClose(); // the dimmed area
    if (e.target.closest('[data-close]')) requestClose();
  });
}

export const isPersonOpen = () => Boolean(dlg?.open);

function section(id, title, body) {
  return `<section class="sheet-section ps-section" aria-labelledby="ps-${id}"><h3 class="section-title" id="ps-${id}">${title}</h3>${body}</section>`;
}

function personMarkup(month, org, person, day) {
  const byId = new Map(org.people.map((p) => [p.id, p]));
  const fns = ownedBy(month, org, person.id);
  const load = dailyMeasuresOf(month, org, person.id).count;
  const link = (p) => `<a class="ps-person" href="${personHref(month, day, p.id)}" data-open-person="${esc(p.id)}">${esc(p.name || 'No name yet')}</a>${titleOf(p) ? `<span class="ps-person-title">${esc(titleOf(p))}</span>` : ''}`;
  const kpiHref = (k) => pageHref(month, day, { view: 'org', hash: k.id });

  const owns = fns.length ? `
    <p class="ps-load">${load} daily ${load === 1 ? 'measure' : 'measures'} (up to ${DAILY_MEASURE_MAX} allowed)${load > DAILY_MEASURE_MAX ? ': more than the DOR shows for one owner' : ''}</p>
    ${fns.map((fn) => `
      <div class="ps-fn">
        <h4 class="ps-fn-name">${icon(DEPT_ICON[fn.id] ?? 'board', 'i')}${esc(fn.name)}</h4>
        <ul class="ps-kpis">${kpiRowsFor(fn).map((k) => {
          const s = dayStatus(month, k, day);
          return `<li>
            <span class="ps-tag">DOR daily</span>
            <a class="ps-kpi" href="${kpiHref(k)}" data-open-detail="${esc(k.id)}">${esc(plainLabel(k.kpiDaily))}</a>
            ${s.status === NOT_TRACKED ? '' : statusMarkup(s.status, { tag: 'span', kpi: k.kpiDaily, extra: 'ps-status' })}
          </li>`;
        }).join('')}
          <li class="ps-month"><span class="ps-tag ps-tag--quiet">Month</span><span>${esc(plainLabel(fn.kpiMonthly))}</span>${statusMarkup(monthStatus(month, fn, day).status, { tag: 'span', kpi: fn.kpiMonthly, extra: 'ps-status' })}</li>
        </ul>
      </div>`).join('')}`
    : '<p class="ps-empty">Not the responsible owner of a function on the board.</p>';

  const manager = byId.get(person.reportsTo);
  const reports = org.people.filter((p) => p.reportsTo === person.id);
  const reportsTo = `
    <dl class="ps-dl">
      <div><dt>Reports to</dt><dd>${manager ? link(manager) : '<span class="is-empty">Nobody above them</span>'}</dd></div>
      <div><dt>Direct reports</dt><dd>${reports.length ? `<ul class="ps-list">${reports.map((p) => `<li>${link(p)}</li>`).join('')}</ul>` : '<span class="is-empty">None</span>'}</dd></div>
    </dl>`;

  const accFor = accountableFor(month, org, person.id);
  const leaders = fns.map((fn) => {
    const p = byId.get(org.functions?.[fn.id]?.accountable);
    return `<li><span class="ps-fn-label">${esc(fn.name)}</span>${p ? link(p) : '<span class="is-empty">Not set</span>'}</li>`;
  }).join('');
  const accountability = `
    <dl class="ps-dl">
      ${fns.length ? `<div><dt>Accountable leader</dt><dd><ul class="ps-list">${leaders}</ul></dd></div>` : ''}
      ${accFor.length ? `<div><dt>Accountable for</dt><dd>${esc(accFor.map((f) => f.name).join(', '))}</dd></div>` : ''}
      <div><dt>Roles</dt><dd>${person.roles.length ? `<ul class="ps-roles">${person.roles.map((r) => `<li>${esc(ROLE_NAME[r])}</li>`).join('')}</ul>` : '<span class="is-empty">No roles yet</span>'}</dd></div>
    </dl>`;

  const today = isoForDay(month, day);
  const acts = openActionsOf(month, org, person, day).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const fnName = (id) => month.functions.find((f) => f.id === id)?.name ?? '';
  const actions = acts.length ? `<ul class="ps-actions">${acts.map((a) => {
    const over = a.due && a.due < today;
    const age = a.dayIso ? daysBetween(a.dayIso, today) : null;
    const aging = age === null ? 'Open since before this month' : age === 0 ? 'Added this day' : `Open ${age} ${age === 1 ? 'day' : 'days'}`;
    return `<li class="ps-action">
      <p class="ps-action-text">${esc(a.text)}</p>
      <p class="ps-action-meta">${fnName(a.fnId) ? `<span>${esc(fnName(a.fnId))}</span>` : ''}${over ? statusMarkup(OFF, { tag: 'span', word: `Overdue: ${dueText(a.due).replace(/^Due /, 'due ')}`, extra: 'ps-over' }) : `<span>${esc(dueText(a.due))}</span>`}<span>${esc(aging)}</span></p>
    </li>`;
  }).join('')}</ul>` : `<p class="ps-empty">No open actions${fns.length ? ` for ${esc(fns.map((f) => f.name).join(', '))}` : ''} as of ${esc(formatDayMedium(month, day))}.</p>
    ${fns.length ? `<p class="ps-note">When a result goes off goal, its Add action (DOR board or Weekly review) assigns one here.</p>` : ''}`;

  const weekRows = fns.flatMap((fn) => kpiRowsFor(fn)).map((k) => ({ k, w: weekResult(month, k, day) })).filter((x) => x.w);
  const wk = weekRows[0]?.w.week ?? null;
  const week = weekRows.length ? `<ul class="ps-week">${weekRows.map(({ k, w }) => `<li><span>${esc(plainLabel(k.kpiDaily))}</span><span class="ps-week-res">${w.html}</span></li>`).join('')}</ul>
    <p class="ps-note">${esc(wk ? weekLabel(wk) : 'This week')}, through ${esc(formatDayMedium(month, day))}, by each KPI's weekly rule. <a href="${pageHref(month, day, { view: 'wor' })}">Open the Weekly review</a></p>`
    : '<p class="ps-empty">Nothing to show: no function on the board.</p>';

  return `
    <div class="sheet-panel">
      <header class="sheet-head">
        <h2 class="sheet-title ps-title" id="person-title" tabindex="-1">${esc(person.name || 'No name yet')}</h2>
        <div class="sheet-tools">
          <button class="icon-btn sheet-close" type="button" data-close aria-label="Close ${esc(person.name || 'this person')}'s sheet">
            <svg class="icon" aria-hidden="true" focusable="false"><use href="#g-close"></use></svg>
          </button>
        </div>
      </header>
      <div class="sheet-body">
        <div class="ps-id">
          ${personAvatar(month, org, person, 'avatar ps-avatar')}
          <div>
            ${titleOf(person) || !person.title ? `<p class="ps-role-title">${esc(titleOf(person) || 'No title yet')}</p>` : ''}
            <p class="ps-scope">${esc(plantName(month))} · ${esc(dayHeading(month, day))}</p>
          </div>
        </div>
        ${section('owns', 'What they own', owns)}
        ${section('line', 'Reporting line', reportsTo)}
        ${section('acc', 'Accountability and roles', accountability)}
        ${section('acts', `Open actions${acts.length ? ` <span class="section-measure">· ${acts.length}</span>` : ''}`, actions)}
        ${section('week', 'This week so far', week)}
        <div class="ps-foot">
          <button class="btn btn--secondary" type="button" data-open-setup data-setup-section="org" data-setup-focus="person:${esc(person.id)}">Edit in Board setup</button>
        </div>
      </div>
    </div>`;
}

function draw(month, id, day) {
  const org = getOrg(month).active;
  const person = org.people.find((p) => p.id === id);
  if (!person) return false;
  const scroll = dlg.querySelector('.sheet-panel')?.scrollTop ?? 0;
  const same = current?.id === id;
  dlg.innerHTML = personMarkup(month, org, person, day);
  if (same) dlg.querySelector('.sheet-panel').scrollTop = scroll;
  fitSheetHead(dlg);
  return true;
}

/** A quiet line under the scope (a bad link, said once; the next render clears it). */
export function sayOrgNote(text) {
  const note = document.querySelector('[data-org-note]');
  if (!note) return;
  note.textContent = text ?? '';
  note.hidden = !text;
}

export function openPerson(month, id, day) {
  const wasOpen = dlg.open;
  if (!wasOpen) {
    const a = document.activeElement;
    opener = a && a !== document.body && !dlg.contains(a) ? a : null;
    closeAsked = false;
  }
  if (!draw(month, id, day)) {
    // A person who isn't in the organization (an old link): back to the chart, with a quiet note (as a bad
    // week or record link says on the Weekly review).
    if (!wasOpen) requestClose();
    sayOrgNote("That person isn't in this organization (an old link?). Showing the chart.");
    return false;
  }
  const switched = wasOpen && current?.id !== id;
  current = { id, day };
  if (!wasOpen) dlg.showModal();
  if (!wasOpen || switched) dlg.querySelector('#person-title')?.focus({ preventScroll: true });
  return true;
}

/** Redraw in place after the data changed (an action added, the organization activated). */
export function refreshPerson(month) {
  if (!dlg?.open || !current) return;
  const active = document.activeElement;
  const key = active && dlg.contains(active) ? [...active.attributes].find((a) => a.name.startsWith('data-'))?.name : null;
  if (!draw(month, current.id, ctx.getDay())) { requestClose(); return; }
  if (key) dlg.querySelector(`[${key}]`)?.focus({ preventScroll: true });
}

function focusBack(id) {
  const shown = (el) => Boolean(el?.isConnected) && !el.closest('[inert], dialog:not([open])') && (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null);
  const target = (shown(opener) && opener) || [...document.querySelectorAll(`.oc [data-open-person="${CSS.escape(id ?? '')}"]`)].find(shown) || document.getElementById('org');
  target?.focus({ preventScroll: false });
}

export function closePerson({ restoreFocus = true } = {}) {
  if (!dlg?.open) return;
  const id = current?.id;
  current = null;
  dlg.close();
  if (restoreFocus) focusBack(id);
  opener = null;
}
