// Dashboard shell: the navy sidebar (and its phone drawer), Settings and the
// identity menu, the Export menu, the Area filter, and matrix cell tooltips.

import { esc, glyphMarkup } from './ui.js?v=20261122-211924';
import { icon, DEPT_ICON } from './icons.js?v=20261122-211924';
import { isoForDay, dailySeries, rowForDay, storageWorks, getOrg, boardToday } from './store.js?v=20261122-211924';
import { weeksOf, zoneWords, productionWords } from './weekly.js?v=20261122-211924';
import { getIdentity } from './identity.js?v=20261122-211924';
import { formatDayLong, formatDayMedium } from './format.js?v=20261122-211924';
import { ON, OFF } from './status.js?v=20261122-211924';
import * as cloud from './cloud.js?v=20261122-211924';
import { statusWords, unlockButtonMarkup } from './unlock.js?v=20261122-211924';

const narrow = () => matchMedia('(max-width: 760px)').matches;

/* ---------- Links that keep the page's state (day and area) ---------- */

let navArea = 'all';
let navView = 'home';
let navWeek = null;
/** The pages, in the sidebar's order. 'home' needs no ?view=. */
export const PAGES = ['home', 'dor', 'wor', 'org'];
/** app.js calls this whenever the page, the area or the week changes (the Weekly review sets the week). */
export const setNavState = ({ area, view, week } = {}) => {
  navArea = area ?? navArea;
  navView = view ?? navView;
  if (week !== undefined) navWeek = week;
};

/**
 * A link to a page or a function that keeps the current day, area and week:
 * "./?date=2026-02-27&area=mold" (+ "view=dor|wor|org", + "week=…" for the Weekly review, + "#people").
 */
export function pageHref(month, day, { view = navView, hash = '' } = {}) {
  const p = new URLSearchParams();
  if (view !== 'home' && PAGES.includes(view)) p.set('view', view);
  // A pilot board's today needs no date: a link with none opens on the day it's opened.
  if (!cloud.BOARD || isoForDay(month, day) !== boardToday()) p.set('date', isoForDay(month, day));
  if (navArea && navArea !== 'all') p.set('area', navArea);
  if (view === 'wor' && navWeek) p.set('week', navWeek);
  if (cloud.BOARD) p.set('b', cloud.BOARD);
  return `./?${p}${hash ? `#${hash}` : ''}`;
}

/** Sidebar navigation. Rendered into the sidebar and into the phone drawer. */
export function navMarkup(month, day, view, where = 0) {
  const item = (cls, attrs, ic, label, current = false) => `
    <li><a class="side-link ${cls}" ${attrs} title="${esc(label)}"${current ? ' aria-current="page"' : ''}>${icon(ic)}<span class="side-text">${esc(label)}</span></a></li>`;
  // Commands open a sheet over the page (app.js handles each data attribute on click).
  const command = (attr, ic, label, cls = '') => `
    <li${cls ? ` class="${cls}"` : ''}><button class="side-link" type="button" ${attr} title="${esc(label)}">${icon(ic)}<span class="side-text">${esc(label)}</span></button></li>`;
  // Two sidebars share this markup (the sidebar and the phone drawer), so each gets its own label id.
  const groupId = `side-group-label-${where}`;
  return `
    <ul class="side-list side-list--pages">
      ${item('', `href="${pageHref(month, day, { view: 'home' })}" data-nav="home"`, 'home', 'Home', view === 'home')}
      ${item('', `href="${pageHref(month, day, { view: 'dor' })}" data-nav="dor"`, 'board', 'Daily review (DOR)', view === 'dor')}
      ${item('', `href="${pageHref(month, day, { view: 'wor' })}" data-nav="wor"`, 'calendarRange', 'Weekly review (WOR)', view === 'wor')}
      ${item('', `href="${pageHref(month, day, { view: 'org' })}" data-nav="org"`, 'network', 'Organization', view === 'org')}
    </ul>
    <ul class="side-list side-list--tools">
      ${view === 'wor'
        ? command('data-run-meeting data-weekly-meeting', 'presentation', 'Run weekly meeting')
        : command('data-run-meeting', 'presentation', 'Run daily meeting')}
      ${command('data-open-actions', 'clipboard', 'Action register')}
      ${command('data-open-minutes', 'fileText', 'Meeting records')}
      ${command('data-open-setup', 'layers', 'Board setup')}
      ${cloud.BOARD ? command('data-open-history', 'clock', 'Save history') : ''}
      ${cloud.BOARD ? command('data-open-feedback', 'message', 'Send feedback') : ''}
      ${view === 'dor' ? command('data-customize', 'sliders', 'Customize this board', 'side-drawer-only') : ''}
    </ul>
    <p class="side-group" id="${groupId}">Functions</p>
    <ul class="side-list" aria-labelledby="${groupId}">
      ${month.functions.map((fn) => (view === 'wor'
        // On the Weekly review a function opens in the week (its days and commentary), not the daily Detail.
        ? item('side-link--dept', `href="${pageHref(month, day, { view, hash: `wf-${fn.id}` }).replace('?', '?tab=functions&')}" data-wor-fn="${esc(fn.id)}"`, DEPT_ICON[fn.id] ?? 'building', fn.name)
        : item('side-link--dept', `href="${pageHref(month, day, { view, hash: fn.id })}" data-open-detail="${esc(fn.id)}"`, DEPT_ICON[fn.id] ?? 'building', fn.name))).join('')}
    </ul>`;
}

const navDrawn = new WeakMap(); // nav element -> the markup it shows

export function renderNav(month, day, view) {
  setNavState({ view });
  // The plant name (drawn by home.js) can be cut at two lines: its whole name on hover.
  document.querySelectorAll('[data-plant-name]').forEach((n) => { n.title = n.textContent.trim(); });
  // Redraw only what changed: a sheet opened from the sidebar (the Action register,
  // Board setup) returns focus to its own button, so that button must stay the same element.
  document.querySelectorAll('[data-side-nav]').forEach((n, i) => {
    const html = navMarkup(month, day, view, i);
    if (navDrawn.get(n) === html) return;
    n.innerHTML = html;
    navDrawn.set(n, html);
  });
  // The DOR board's brand and its Home link go back to the dashboard on the same day and area.
  document.querySelectorAll('[data-nav-home]').forEach((a) => { a.href = pageHref(month, day, { view: 'home' }); });
  // The TV board's Menu lists the pages too (the sidebar steps aside there).
  document.querySelectorAll('[data-nav-page]').forEach((a) => { a.href = pageHref(month, day, { view: a.dataset.navPage }); });
  // On a pilot board every in-app link carries the board (the DOR board sets its own This week link too).
  if (cloud.BOARD) document.querySelectorAll('[data-week-link]').forEach((a) => { a.href = pageHref(month, day, { view: 'wor' }).replace(/&week=[^&#]*/, ''); });
}

/* ---------- The icon rail (remembered on this device) ---------- */

const SIDE_KEY = 'pilot.side.v1';
/** Is the sidebar the icon rail by this device's choice? (Narrower than 1280 it always is.) */
export const isRail = () => document.documentElement.dataset.side === 'rail';
function syncSideToggle() {
  const rail = isRail();
  const label = rail ? 'Expand menu' : 'Collapse menu';
  document.querySelectorAll('[data-side-toggle]').forEach((b) => {
    b.setAttribute('aria-label', label);
    b.title = label;
    const text = b.querySelector('.side-text');
    if (text) text.textContent = label;
  });
}
/** Full sidebar or icon rail, kept on this device (index.html reads it before the first paint). */
export function setRail(rail) {
  if (rail) document.documentElement.dataset.side = 'rail';
  else delete document.documentElement.dataset.side;
  try {
    if (rail) localStorage.setItem(SIDE_KEY, 'rail');
    else localStorage.removeItem(SIDE_KEY);
  } catch { /* storage blocked: it holds for this visit */ }
  syncSideToggle();
  window.dispatchEvent(new Event('dor:side'));
}

/* ---------- Scope, pinned on every page ---------- */

const AREA_WORDS = { all: 'Plant total', mold: 'Mold', bond: 'Bond', prime: 'Prime', compounding: 'Compounding' };
/** A plain check beside "Saved on this device" (a fact about the device, never a colored status dot). */
const SAVED_MARK = '<svg class="scope-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>';
export const scopeWord = (area) => AREA_WORDS[area] ?? 'Plant total';

/**
 * "Riverside plant · Plant total · Fri, Feb 27, 2026 · 8 of 8 entered · Saved on this device".
 * The DOR board's scope is its Area filter (it governs the board's daily Status column); Home's
 * filter is in its header, so the line names it. The Organization and the Weekly review judge
 * plant totals. "Entered" counts the functions with a number for the day in that scope.
 */
export function scopeMarkup(month, day, { area = 'all', view = navView, offOnly = false } = {}) {
  const plantLabel = month.pilot ? String(month.plant ?? '') : `${String(month.plant ?? '').replace(/\s+plant$/i, '')} plant`;
  const scoped = view === 'dor' || view === 'home' ? area : 'all';
  const areaId = scoped === 'all' ? 'plant' : scoped;
  const fns = month.functions;
  const entered = fns.filter((fn) => typeof rowForDay(dailySeries(fn, areaId), day)?.actual === 'number').length;
  // "8 of 8 functions entered" for a day (in the board's area), "40 of 40 daily numbers in" for a week.
  let enteredWords = `${entered} of ${fns.length} functions entered`;
  // The Weekly review: its week, the day it looks from, and the functions with a number every production day so far.
  let when = `<span class="scope-item"><time datetime="${isoForDay(month, day)}">${esc(formatDayLong(month, day))}</time></span>`;
  const week = view === 'wor' ? weekOn(month, day) : null;
  if (week) {
    const through = week.production.filter((d) => d <= day).pop() ?? null;
    const fmt = (iso, year) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
    let org = null;
    try { org = getOrg(month).active; } catch { org = null; }
    // The week's exact boundaries, its time zone and production days (spec §5), then the day it looks from.
    when = `<span class="scope-item">Week ${esc(fmt(week.start, false))} – ${esc(fmt(week.end, true))}, ${esc(zoneWords(org))}</span><span class="sr-only">, </span>`
      + `<span class="scope-item">Production days ${esc(productionWords(org))}</span><span class="sr-only">, </span>`
      + (through ? `<span class="scope-item">through&nbsp;<time datetime="${isoForDay(month, through)}">${esc(formatDayLong(month, through))}</time></span>` : '<span class="scope-item">no production day yet</span>');
    const days = week.production.filter((d) => d <= day);
    // The week counts daily numbers, not functions: one for each function on each production day so far.
    const got = fns.reduce((n, fn) => n + days.filter((d) => typeof rowForDay(dailySeries(fn, 'plant'), d)?.actual === 'number').length, 0);
    enteredWords = `${got} of ${fns.length * days.length} daily numbers in`;
  }
  const saving = storageWorks();
  const sep = '<span class="sr-only">, </span>';
  // A pilot board has plant totals only, so it has no Area filter.
  const scopeItem = (view === 'dor' || view === 'home') && !month.pilot
    ? `<label class="scope-item scope-area"><span>Area</span><select class="scope-select" data-scope-area>${Object.entries(AREA_WORDS)
      .map(([id, name]) => `<option value="${id}"${id === scoped ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></label>`
    : `<span class="scope-item scope-area-word">${esc(scopeWord(scoped))}</span>`;
  // The DOR board's exceptions-only filter sits beside its date (spec §4), remembered on the device.
  const filter = view === 'dor'
    ? `<label class="scope-item scope-filter"><input type="checkbox" data-off-only${offOnly ? ' checked' : ''}><span>Off goal on ${esc(formatDayMedium(month, day))} only</span></label>${sep}`
    : '';
  return `<p class="scope-line${scoped === 'all' ? '' : ' is-area'}"><span class="sr-only">Showing: </span>`
    + `<span class="scope-item scope-plant">${esc(plantLabel)}</span>${sep}`
    + `${scopeItem}${sep}`
    + `${when}${sep}`
    + filter
    + `<span class="scope-item">${enteredWords}</span>${sep}`
    + (month.pilot ? pilotSaved()
      : saving
      ? `<span class="scope-item scope-saved">${SAVED_MARK}Saved on this device</span>`
      : '<span class="scope-item scope-saved is-off">Not saving in this browser</span>')
    + '</p>';
}

/** A pilot board's save state and its Unlock to edit / Lock button. */
function pilotSaved() {
  const w = statusWords();
  return `<span class="scope-item scope-saved${w.off ? ' is-off' : ''}" data-save-state>${w.off ? glyphMarkup(OFF) : w.text.startsWith('Saved') ? SAVED_MARK : ''}${esc(w.text)}</span>`
    + `<span class="sr-only">, </span><span class="scope-item">${unlockButtonMarkup()}</span>`;
}

/** The organization's week holding a day (the Weekly review's scope). */
function weekOn(month, day) {
  try {
    return weeksOf(month, { weekStart: getOrg(month).active.weekStart }).find((w) => w.days.some((d) => d.day === day)) ?? null;
  } catch { return null; }
}

const scopeDrawn = new WeakMap();
/** Draw the scope line on every page; a redraw keeps focus on the Area filter when it had it. */
export function renderScope(month, day, opts) {
  document.querySelectorAll('[data-scope]').forEach((host) => {
    const page = host.closest('[data-page]')?.dataset.page ?? (host.closest('.app') ? 'dor' : 'home');
    const html = scopeMarkup(month, day, { ...opts, view: page });
    if (scopeDrawn.get(host) === html) return;
    const hadFocus = host.contains(document.activeElement);
    const which = document.activeElement?.matches?.('[data-off-only]') ? '[data-off-only]' : 'select';
    host.innerHTML = html;
    scopeDrawn.set(host, html);
    if (hadFocus) host.querySelector(which)?.focus({ preventScroll: true });
  });
}

/* ---------- Floating menus (Settings, identity, Export) ---------- */

function place(pop, trigger, width) {
  const r = trigger.getBoundingClientRect();
  const w = Math.min(width, window.innerWidth - 24);
  pop.style.width = `${w}px`;
  const alignRight = r.left + w > window.innerWidth - 12;
  const left = alignRight ? Math.max(12, r.right - w) : Math.max(12, r.left);
  pop.style.left = `${left}px`;
  const h = pop.offsetHeight;
  const below = r.bottom + 6;
  pop.style.top = `${below + h > window.innerHeight - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : below}px`;
}

/** The button that opened each menu: Esc and Tab hand focus back to it. */
const openedBy = new WeakMap();

/** A menu's items that are showing at this size, in order. */
const menuItems = (menu) => [...menu.querySelectorAll('[role="menuitem"], .menu-item')]
  .filter((el) => !el.disabled && (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null));

/** Roving tab stop: only the item that has focus (or the first) can be reached with Tab. */
function setRoving(menu, current) {
  const items = menuItems(menu);
  const on = items.includes(current) ? current : items[0];
  for (const el of menu.querySelectorAll('[role="menuitem"], .menu-item')) el.tabIndex = el === on ? 0 : -1;
}

/**
 * Can a popover name the button that opened it (showPopover({ source }))? Then a press on that
 * button isn't a press outside the menu: it doesn't close it on the way down (light dismiss), so
 * the button's click can close it, and a double click's second press leaves it open.
 */
let popoverSource = false;
try {
  document.createElement('div').showPopover({ get source() { popoverSource = true; return null; } });
} catch { /* a plain div isn't a popover: only the option was being read */ }

/**
 * Show a popover as opened by `source`. The button is also made the popover's invoker
 * (popoverTargetElement, as popovertarget would), which is what tells the browser's light dismiss
 * that a press on that button is not a press outside: a press there no longer closes it on the way
 * down or up, so the button's own click can close it, and a double click's second press leaves it
 * open. Every click handler on these buttons cancels the click, so the browser never toggles it itself.
 */
export function showPopoverFrom(pop, source) {
  if (source && 'popoverTargetElement' in source && source.popoverTargetElement !== pop) source.popoverTargetElement = pop;
  if (popoverSource && source) pop.showPopover({ source });
  else pop.showPopover();
}

/** When each menu last closed and which button had opened it (for browsers without a popover source). */
const closedBy = new WeakMap();

/** Open a popover beside its trigger; inside a modal it must live in that dialog. */
export function openMenu(pop, trigger, width) {
  const host = trigger.closest('dialog') ?? document.body;
  if (pop.parentElement !== host) {
    if (pop.matches(':popover-open')) pop.hidePopover();
    host.append(pop);
  }
  // Open for another button (the identity chip, then Settings): it moves to this one.
  const before = openedBy.get(pop);
  if (before && before !== trigger) before.setAttribute('aria-expanded', 'false');
  if (pop.matches(':popover-open')) pop.hidePopover();
  showPopoverFrom(pop, trigger);
  place(pop, trigger, width);
  openedBy.set(pop, trigger);
  setRoving(pop, null);
  trigger.setAttribute('aria-expanded', 'true');
  pop.addEventListener('toggle', function onToggle(e) {
    if (e.newState === 'closed') {
      trigger.setAttribute('aria-expanded', 'false');
      closedBy.set(pop, { trigger, at: performance.now() });
      pop.removeEventListener('toggle', onToggle);
    }
  });
}

/**
 * A menu's button opens it, and closes it when it's open from that button. Returns true when it
 * opened. Where a press on the button has already closed it on the way down (no popover source),
 * that counts as this button closing it, so the click doesn't open it again.
 */
export function toggleMenu(pop, trigger, width) {
  const open = pop.matches(':popover-open');
  const last = closedBy.get(pop);
  const closedJustNow = !popoverSource && last?.trigger === trigger && performance.now() - last.at < 400;
  if ((open && openedBy.get(pop) === trigger) || (!open && closedJustNow)) {
    if (open) pop.hidePopover();
    return false;
  }
  openMenu(pop, trigger, width);
  return true;
}

/**
 * Menus act like menus from the keyboard: one Tab stop (the item in focus), arrow
 * keys, Home and End move between items; Esc closes and puts focus back on the
 * button that opened it; Tab or Shift+Tab closes it and carries on from that
 * button; focus leaving any other way (a click elsewhere) closes it too.
 */
function wireMenuKeys(menu) {
  const close = () => { if (menu.matches(':popover-open')) menu.hidePopover(); };
  menu.addEventListener('keydown', (e) => {
    const items = menuItems(menu);
    const i = items.indexOf(document.activeElement);
    const go = (n) => { const el = items[(n + items.length) % items.length]; if (el) { setRoving(menu, el); el.focus(); } };
    if (e.key === 'ArrowDown') { e.preventDefault(); go(i + 1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); go(i < 0 ? items.length - 1 : i - 1); return; }
    if (e.key === 'Home') { e.preventDefault(); go(0); return; }
    if (e.key === 'End') { e.preventDefault(); go(items.length - 1); return; }
    const trigger = openedBy.get(menu);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      trigger?.focus();
      return;
    }
    // Tab: the menu closes and focus moves on from its button, as if the menu had never opened.
    // (The menu sits at the end of the page, so the browser's own Tab would leave the page.)
    if (e.key === 'Tab' && trigger?.isConnected) {
      close();
      trigger.focus({ preventScroll: true });
    }
  });
  menu.addEventListener('focusin', (e) => { if (menuItems(menu).includes(e.target)) setRoving(menu, e.target); });
  menu.addEventListener('focusout', (e) => {
    // Pressing its own button: that button's click closes it (toggleMenu), not this.
    if (menu.contains(e.relatedTarget) || (e.relatedTarget && e.relatedTarget === openedBy.get(menu))) return;
    // After the move has landed: a switch to another window keeps it open.
    setTimeout(() => {
      if (document.hasFocus() && !menu.contains(document.activeElement)) close();
    }, 0);
  });
}

function settingsMarkup(month) {
  const who = getIdentity(month);
  return `
    <p class="menu-title">Settings</p>
    <p class="menu-text">${who ? `Entering as <strong>${esc(who.name)}</strong> (${esc(month.functions.find((f) => f.id === who.functionId)?.name ?? '')})` : 'Nobody is entering on this device yet.'}</p>
    <button class="menu-item" type="button" data-switch-person>${icon('userSwitch')}<span>${who ? 'Switch person' : "Choose who's entering"}</span></button>
    ${cloud.BOARD ? '' : `<button class="menu-item" type="button" data-reset>${icon('rotate')}<span>Start the demo over</span></button>`}`;
}

export function wireShell({ getMonth, onArea, onExport, onSwitchPerson }) {
  const settings = document.getElementById('settings-pop');
  const exportMenu = document.getElementById('export-menu');
  const drawer = document.getElementById('drawer');

  document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-settings], [data-chip]');
    if (s) {
      e.preventDefault(); // the button opens and closes its menu here, not as a popover invoker
      if (!(settings.matches(':popover-open') && openedBy.get(settings) === s)) settings.innerHTML = settingsMarkup(getMonth());
      if (toggleMenu(settings, s, 300)) settings.querySelector('.menu-item')?.focus();
      return;
    }
    const ex = e.target.closest('[data-export-toggle]');
    if (ex) {
      e.preventDefault();
      if (toggleMenu(exportMenu, ex, 280)) exportMenu.querySelector('[role="menuitem"]')?.focus();
      return;
    }
    const item = e.target.closest('[data-export]');
    if (item) {
      exportMenu.hidePopover();
      onExport(item.dataset.export);
      return;
    }
    if (e.target.closest('#settings-pop [data-reset]')) { settings.hidePopover(); return; }
    if (e.target.closest('[data-switch-person]')) {
      settings.hidePopover();
      if (drawer.open) drawer.close();
      onSwitchPerson();
      return;
    }
    if (e.target.closest('[data-open-drawer]')) {
      drawer.showModal();
      drawer.querySelector('.side-link')?.focus();
      return;
    }
    if (e.target.closest('[data-close-drawer]') || e.target === drawer) { drawer.close(); return; }
    // Following a link or command from the drawer closes it.
    if (drawer.open && e.target.closest('#drawer .side-link')) drawer.close();
  }, true);

  // Menus: one Tab stop, arrow keys between items, Esc and Tab close (wireMenuKeys).
  for (const menu of [exportMenu, settings, document.getElementById('dor-menu')].filter(Boolean)) wireMenuKeys(menu);

  // A menu's button (Menu, Export) from the keyboard: ↓ opens it on its first item, ↑ on its last,
  // and neither scrolls the page.
  document.addEventListener('keydown', (e) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const trigger = e.target.closest?.('[aria-haspopup="menu"][aria-controls]');
    const menu = trigger ? document.getElementById(trigger.getAttribute('aria-controls')) : null;
    if (!menu) return;
    e.preventDefault();
    if (!menu.matches(':popover-open')) trigger.click(); // opens it the way a click does
    if (!menu.matches(':popover-open')) return;
    const items = menuItems(menu);
    const el = e.key === 'ArrowUp' ? items[items.length - 1] : items[0];
    if (el) { setRoving(menu, el); el.focus(); }
  });

  // Home's Area filter (its header) and the DOR board's (its scope line) set the same area.
  document.addEventListener('change', (e) => {
    if (e.target.matches?.('[data-area], [data-scope-area]')) onArea(e.target.value);
  });
  // Full sidebar or icon rail.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-side-toggle]')) return;
    setRail(!isRail());
  });
  syncSideToggle();

  // Matrix cell tooltips: the numbers behind each dot, on hover.
  const tip = document.getElementById('mx-tip');
  document.addEventListener('pointerover', (e) => {
    const cell = e.target.closest?.('.home-app [data-tip]');
    if (!cell) { tip.hidden = true; return; }
    tip.textContent = cell.dataset.tip;
    tip.hidden = false;
    const r = cell.getBoundingClientRect();
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2))}px`;
    tip.style.top = `${r.top - tip.offsetHeight - 6 + window.scrollY}px`;
  });
  window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
  window.addEventListener('resize', () => { if (!narrow() && drawer.open) drawer.close(); });
}
