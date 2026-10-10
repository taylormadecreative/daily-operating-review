// Dashboard shell: the navy sidebar (and its phone drawer), Settings and the
// identity menu, the Export menu, the Area filter, and matrix cell tooltips.

import { esc } from './ui.js';
import { icon, DEPT_ICON } from './icons.js';
import { isoForDay } from './store.js';
import { getIdentity } from './identity.js';

const narrow = () => matchMedia('(max-width: 760px)').matches;

/* ---------- Links that keep the page's state (day and area) ---------- */

let navArea = 'all';
let navView = 'home';
/** app.js calls this whenever the day's view or area changes. */
export const setNavState = ({ area, view }) => { navArea = area ?? navArea; navView = view ?? navView; };

/**
 * A link to a page or a department that keeps the current day and area:
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
export function navMarkup(month, day, view) {
  const item = (cls, attrs, ic, label, current = false) => `
    <li><a class="side-link ${cls}" ${attrs} title="${esc(label)}"${current ? ' aria-current="page"' : ''}>${icon(ic)}<span class="side-text">${esc(label)}</span></a></li>`;
  return `
    <ul class="side-list">
      ${item('', `href="${pageHref(month, day, { view: 'home' })}" data-nav="home"`, 'home', 'Home', view === 'home')}
      ${item('', `href="${pageHref(month, day, { view: 'dor' })}" data-nav="dor"`, 'board', 'DOR board', view === 'dor')}
      <li><button class="side-link" type="button" data-run-meeting title="Meeting mode">${icon('presentation')}<span class="side-text">Meeting mode</span></button></li>
    </ul>
    <p class="side-group" id="side-group-label">Departments</p>
    <ul class="side-list" aria-labelledby="side-group-label">
      ${month.functions.map((fn) => item('side-link--dept', `href="${pageHref(month, day, { view, hash: fn.id })}" data-open-detail="${esc(fn.id)}"`, DEPT_ICON[fn.id] ?? 'building', fn.name)).join('')}
    </ul>`;
}

export function renderNav(month, day, view) {
  setNavState({ view });
  document.querySelectorAll('[data-side-nav]').forEach((n) => { n.innerHTML = navMarkup(month, day, view); });
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

/** Open a popover beside its trigger; inside a modal it must live in that dialog. */
export function openMenu(pop, trigger, width) {
  const host = trigger.closest('dialog') ?? document.body;
  if (pop.parentElement !== host) {
    if (pop.matches(':popover-open')) pop.hidePopover();
    host.append(pop);
  }
  pop.showPopover();
  place(pop, trigger, width);
  trigger.setAttribute('aria-expanded', 'true');
  pop.addEventListener('toggle', function onToggle(e) {
    if (e.newState === 'closed') {
      trigger.setAttribute('aria-expanded', 'false');
      pop.removeEventListener('toggle', onToggle);
    }
  });
}

function settingsMarkup(month) {
  const who = getIdentity(month);
  return `
    <p class="menu-title">Settings</p>
    <p class="menu-text">${who ? `Entering as <strong>${esc(who.name)}</strong> (${esc(month.functions.find((f) => f.id === who.functionId)?.name ?? '')})` : 'Nobody is entering on this device yet.'}</p>
    <button class="menu-item" type="button" data-switch-person>${icon('userSwitch')}<span>${who ? 'Switch person' : "Choose who's entering"}</span></button>
    <button class="menu-item" type="button" data-reset>${icon('rotate')}<span>Reset demo data</span></button>`;
}

export function wireShell({ getMonth, onArea, onExport, onSwitchPerson }) {
  const settings = document.getElementById('settings-pop');
  const exportMenu = document.getElementById('export-menu');
  const drawer = document.getElementById('drawer');

  document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-settings], [data-chip]');
    if (s) {
      settings.innerHTML = settingsMarkup(getMonth());
      openMenu(settings, s, 300);
      settings.querySelector('.menu-item')?.focus();
      return;
    }
    const ex = e.target.closest('[data-export-toggle]');
    if (ex) {
      openMenu(exportMenu, ex, 280);
      exportMenu.querySelector('[role="menuitem"]')?.focus();
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

  // Menus: arrow keys move between items, Esc closes (native popover).
  for (const menu of [exportMenu, settings, document.getElementById('dor-menu')].filter(Boolean)) {
    menu.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll('[role="menuitem"], .menu-item')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    });
  }

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
