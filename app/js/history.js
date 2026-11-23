// Pilot boards: Save history (PILOT-SPEC.md, Part 3). The Menu's "Save history" opens a sheet with
// the last 50 saves, newest first, under a heading for each day ("Thu, Nov 19"): each save is
// "B. Taylor · Numbers for November" with its time ("4:52 PM") under it. Names are what the app
// was told, so a note sits under the list. Words come from the spec's table.

import * as cloud from './cloud.js?v=20261122-211924';

const LABELS = {
  setup: 'Board setup',
  org: 'Organization',
  weekly: 'Weekly review',
  actions: 'Action register',
  meetings: 'Meeting records',
};
const TRUST = "Names come from Who's entering on each device.";
const UNNAMED = 'Name not picked';
const OFFLINE = "Can't reach the server. Check your connection and try again.";
const NOT_FOUND = "We couldn't find that board. Check the link, or ask the person who sent it.";

/** 'numbers-2026-11' -> 'Numbers for November'; 'setup' -> 'Board setup'. */
export function docLabel(name) {
  const m = /^numbers-(\d{4})-(\d{2})$/.exec(name);
  if (m) {
    const month = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
      .toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
    return `Numbers for ${month}`;
  }
  return LABELS[name] ?? name;
}

/** In the board's time zone: day ("Thu, Nov 19") and time ("4:52 PM"). */
function inBoardZone(at, opts) {
  const tz = cloud.boardMeta()?.timeZone;
  try { return new Date(at).toLocaleString('en-US', tz ? { ...opts, timeZone: tz } : opts); } catch { return new Date(at).toLocaleString('en-US', opts); }
}
const dayOf = (at) => inBoardZone(at, { weekday: 'short', month: 'short', day: 'numeric' });
const timeOf = (at) => inBoardZone(at, { hour: 'numeric', minute: '2-digit' });

let dlg = null;
let returnTo = null;
let asking = 0; // only the latest open's answer is drawn

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'sheet sheet--narrow save-history';
  dlg.id = 'history';
  dlg.setAttribute('aria-labelledby', 'history-title');
  dlg.innerHTML = `
    <div class="sheet-panel">
      <div class="sheet-head">
        <h2 class="sheet-title" id="history-title" tabindex="-1">Save history</h2>
        <div class="sheet-tools"><button class="btn btn--secondary" type="button" data-history-close>Close</button></div>
      </div>
      <div class="sheet-body">
        <div class="history-days" data-history-list aria-busy="true"></div>
        <p class="history-note">${TRUST}</p>
      </div>
    </div>`;
  document.body.append(dlg);
  dlg.querySelector('[data-history-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => {
    const to = returnTo;
    returnTo = null;
    if (to?.isConnected) to.focus({ preventScroll: true });
  });
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// One save: who and what on the first line, the time under it.
function row(who, what, at) {
  const li = el('li', 'history-row');
  li.dataset.historyRow = '';
  const line = el('span', 'history-what');
  line.append(el('span', who ? 'history-who' : 'history-who history-unnamed', who || UNNAMED), ' · ', el('span', null, what));
  li.append(line, el('span', 'history-time', timeOf(at)));
  return li;
}

export async function openHistory(from = document.activeElement) {
  if (!cloud.BOARD) return;
  if (!dlg) build();
  if (dlg.open) return;
  returnTo = from instanceof HTMLElement ? from : null;
  const list = dlg.querySelector('[data-history-list]');
  list.replaceChildren();
  list.removeAttribute('data-loaded');
  list.setAttribute('aria-busy', 'true');
  dlg.showModal();
  dlg.querySelector('#history-title').focus();
  const ask = ++asking;
  let rows;
  let problem = null;
  try {
    rows = await cloud.history(50);
  } catch (err) {
    problem = err.code === 'not_found' ? NOT_FOUND : OFFLINE;
  }
  if (ask !== asking || !dlg.open) return;
  if (problem) list.append(el('p', 'history-problem', problem));
  let day = null;
  let ol = null;
  for (const r of rows ?? []) {
    const d = dayOf(r.at);
    if (d !== day) {
      day = d;
      ol = el('ol', 'history-list');
      list.append(el('h3', 'history-day', d), ol);
    }
    ol.append(row(String(r.who ?? '').trim(), docLabel(r.name), r.at));
  }
  list.setAttribute('aria-busy', 'false');
  list.dataset.loaded = '';
}

/** Adds "Save history" to the Menu on a pilot board. The demo keeps its menu as it is. */
export function initHistory() {
  if (!cloud.BOARD) return;
  const menu = document.getElementById('dor-menu');
  if (!menu || menu.querySelector('[data-open-history]')) return;
  const btn = document.createElement('button');
  btn.className = 'menu-item';
  btn.type = 'button';
  btn.setAttribute('role', 'menuitem');
  btn.dataset.openHistory = '';
  btn.textContent = 'Save history';
  const customize = menu.querySelector('[data-customize]');
  if (customize) customize.before(btn);
  else menu.append(btn);
  // The Menu's item and the sidebar's (the phone drawer's too) open the same sheet.
  document.addEventListener('click', (e) => {
    const from = e.target.closest('[data-open-history]');
    if (!from) return;
    e.preventDefault();
    menu.hidePopover?.();
    openHistory(from.closest('#dor-menu') ? document.querySelector('[data-topbar-more]') : from);
  });
}
