// Pilot boards: Save history (PILOT-SPEC.md, Part 3). The Menu's "Save history" opens a sheet with
// the last 50 saves, newest first: "Thu, Nov 19, 4:52 PM · Numbers for November · B. Taylor".
// Names are what the app was told, so the trust note sits under the list. Words come from the
// spec's table.

import * as cloud from './cloud.js?v=20261120-154112';

const LABELS = {
  setup: 'Board setup',
  org: 'Organization',
  weekly: 'Weekly review',
  actions: 'Action register',
  meetings: 'Meeting records',
};
const TRUST = "Names are what each person picked under Who's entering. One password is shared, so this isn't proof of who made a change.";
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

/** "Thu, Nov 19, 4:52 PM", in the board's time zone. */
function stamp(at) {
  const tz = cloud.boardMeta()?.timeZone;
  const opts = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  try { return new Date(at).toLocaleString('en-US', tz ? { ...opts, timeZone: tz } : opts); } catch { return new Date(at).toLocaleString('en-US', opts); }
}

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
        <ol class="history-list" data-history-list aria-busy="true"></ol>
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

// One save: its time, document and name each stay whole, so a narrow screen wraps between them.
function row(...parts) {
  const li = document.createElement('li');
  li.className = 'history-row';
  parts.forEach((text, i) => {
    if (i) li.append(' · ');
    const span = document.createElement('span');
    span.textContent = text;
    li.append(span);
  });
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
  if (problem) list.append(row(problem));
  for (const r of rows ?? []) {
    const who = String(r.who ?? '').trim();
    const li = row(stamp(r.at), docLabel(r.name), who || 'Not named');
    if (!who) li.lastElementChild.classList.add('history-unnamed');
    li.dataset.historyRow = '';
    list.append(li);
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
