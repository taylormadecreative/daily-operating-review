// Dashboard shell: the navy sidebar (and its phone drawer), Settings and the
// identity menu, the Export menu, the Area filter, and matrix cell tooltips.

import { esc } from './ui.js?v=20261013-151156';
import { icon, DEPT_ICON } from './icons.js?v=20261013-151156';
import { isoForDay } from './store.js?v=20261013-151156';
import { getIdentity } from './identity.js?v=20261013-151156';

const narrow = () => matchMedia('(max-width: 760px)').matches;

/* ---------- Links that keep the page's state (day and area) ---------- */

let navArea = 'all';
let navView = 'home';
/** app.js calls this whenever the day's view or area changes. */
export const setNavState = ({ area, view }) => { navArea = area ?? navArea; navView = view ?? navView; };

/**
 * A link to a page or a function that keeps the current day and area:
 * "./?date=2026-02-27&area=mold" (+ "view=dor", + "#people").
 */
export function pageHref(month, day, { view = navView, hash = '' } = {}) {
  const p = new URLSearchParams();
  if (view === 'dor') p.set('view', 'dor');
  p.set('date', isoForDay(month, day));
  if (navArea && navArea !== 'all') p.set('area', navArea);
  return `./?${p}${hash ? `#${hash}` : ''}`;
}

/** Sidebar navigation. Rendered into the sidebar and into the phone drawer. */
export function navMarkup(month, day, view, where = 0) {
  const item = (cls, attrs, ic, label, current = false) => `
    <li><a class="side-link ${cls}" ${attrs} title="${esc(label)}"${current ? ' aria-current="page"' : ''}>${icon(ic)}<span class="side-text">${esc(label)}</span></a></li>`;
  // Commands open a sheet over the page (app.js handles each data attribute on click).
  const command = (attr, ic, label) => `
    <li><button class="side-link" type="button" ${attr} title="${esc(label)}">${icon(ic)}<span class="side-text">${esc(label)}</span></button></li>`;
  // Two sidebars share this markup (the sidebar and the phone drawer), so each gets its own label id.
  const groupId = `side-group-label-${where}`;
  return `
    <ul class="side-list">
      ${item('', `href="${pageHref(month, day, { view: 'home' })}" data-nav="home"`, 'home', 'Home', view === 'home')}
      ${item('', `href="${pageHref(month, day, { view: 'dor' })}" data-nav="dor"`, 'board', 'DOR board', view === 'dor')}
      ${command('data-run-meeting', 'presentation', 'Run meeting')}
      ${command('data-open-actions', 'clipboard', 'Action register')}
      ${command('data-open-minutes', 'fileText', 'Meeting minutes')}
      ${command('data-open-setup', 'layers', 'Board setup')}
    </ul>
    <p class="side-group" id="${groupId}">Functions</p>
    <ul class="side-list" aria-labelledby="${groupId}">
      ${month.functions.map((fn) => item('side-link--dept', `href="${pageHref(month, day, { view, hash: fn.id })}" data-open-detail="${esc(fn.id)}"`, DEPT_ICON[fn.id] ?? 'building', fn.name)).join('')}
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
    <button class="menu-item" type="button" data-reset>${icon('rotate')}<span>Start the demo over</span></button>`;
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

  document.querySelector('[data-area]').addEventListener('change', (e) => onArea(e.target.value));

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
