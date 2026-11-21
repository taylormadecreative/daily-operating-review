// The admin page (`?admin`, PILOT-SPEC.md "The admin page"): list every board by client,
// add a board, replace a board's edit password, archive and restore. The admin password
// is checked by the server on every call; this page keeps it in memory only, so a reload
// asks for it again. Nothing here can show or reset the admin password.

import { rpc } from './cloud.js?v=20261120-182315';
import { esc } from './ui.js?v=20261120-182315';

const ZONES = [
  ['America/New_York', 'Eastern'],
  ['America/Chicago', 'Central'],
  ['America/Denver', 'Mountain'],
  ['America/Los_Angeles', 'Pacific'],
];
const WORDS = {
  wrong_password: "That password didn't match.",
  too_many_tries: 'Too many tries. Try again in 15 minutes.',
  weak_password: 'Use at least 10 characters, and not a common password.',
  bad_time_zone: 'Pick Eastern, Central, Mountain or Pacific.',
  not_found: "That board isn't there any more. Reload the list.",
  offline: "Can't reach the server. Check your connection and try again.",
};
const word = (e) => WORDS[e?.code] ?? WORDS.offline;

let root;
let boards = [];

// Held in this page's memory only: never in storage another page on this site could read. A reload asks again.
let adminPass = '';
const getPass = () => adminPass;
const setPass = (v) => { adminPass = v || ''; };

const linkFor = (id) => `${location.origin}${location.pathname}?b=${id}`;
const dayWords = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const stampWords = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No saves yet');
const clientKey = (c) => String(c ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// The server takes these four only (supabase/pilot.sql).
const knownZone = (tz) => ZONES.some(([v]) => v === tz);

/* ---------- Sign in ---------- */

function signInMarkup(msg = '') {
  return `
    <header class="admin-head"><h1 class="admin-title">Boards</h1><p>Make and manage pilot boards.</p></header>
    <form class="admin-card admin-signin" data-signin novalidate>
      <div class="su-field">
        <label for="admin-pass">Admin password</label>
        <input id="admin-pass" type="password" autocomplete="current-password" aria-describedby="admin-pass-msg">
      </div>
      <p class="su-error" id="admin-pass-msg" role="alert"${msg ? '' : ' hidden'}>${esc(msg)}</p>
      <div><button class="btn btn--primary" type="submit" data-admin-signin>Open</button></div>
    </form>`;
}

async function signIn(pass) {
  boards = await rpc('pilot_admin_list', { p_admin: pass });
  setPass(pass);
}

/* ---------- The list and the forms ---------- */

function rowMarkup(b) {
  return `<li class="admin-row" data-admin-board="${esc(b.id)}">
      <div class="admin-row-main">
        <p class="admin-board-name">${esc(b.name)}${b.archived ? ' <span class="admin-archived">Archived</span>' : ''}</p>
        <p class="admin-meta">First day ${esc(dayWords(b.first_day))} · ${esc(ZONES.find(([z]) => z === b.time_zone)?.[1] ?? b.time_zone)} · ${b.last_saved_at ? `Last saved: ${esc(stampWords(b.last_saved_at))}` : 'No numbers saved yet'}</p>
      </div>
      <div class="admin-row-tools">
        <button class="btn btn--secondary" type="button" data-admin-copy>Copy link</button>
        <button class="btn btn--secondary" type="button" data-admin-replace aria-expanded="false">Replace edit password</button>
        <button class="btn btn--quiet" type="button" data-admin-archive>${b.archived ? 'Restore' : 'Archive'}</button>
      </div>
      <form class="admin-replace" data-replace-form hidden novalidate>
        <div class="su-field"><label for="rp-${esc(b.id)}-1">New edit password</label><input id="rp-${esc(b.id)}-1" type="password" autocomplete="new-password" data-rp-1></div>
        <div class="su-field"><label for="rp-${esc(b.id)}-2">Type it again</label><input id="rp-${esc(b.id)}-2" type="password" autocomplete="new-password" data-rp-2></div>
        <div class="admin-replace-go"><button class="btn btn--primary" type="submit" data-admin-replace-save>Replace</button></div>
      </form>
      <p class="admin-note" data-row-note role="status"></p>
    </li>`;
}

function listMarkup() {
  if (!boards.length) return '<p class="admin-empty">No boards yet. Add the first one below.</p>';
  const groups = new Map();
  for (const b of boards) {
    const k = clientKey(b.client);
    if (!groups.has(k)) groups.set(k, { name: b.client, list: [] });
    groups.get(k).list.push(b);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)).map((g) => `
    <section class="admin-client" data-admin-client="${esc(g.name)}" aria-label="${esc(g.name)}">
      <h2 class="admin-client-name">${esc(g.name)}</h2>
      <ul class="admin-list">${g.list.sort((a, b) => a.name.localeCompare(b.name)).map(rowMarkup).join('')}</ul>
    </section>`).join('');
}

function addMarkup() {
  const today = new Date().toLocaleDateString('en-CA');
  const clients = [...new Map(boards.map((b) => [clientKey(b.client), b.client])).values()];
  return `
    <form class="admin-card admin-add" data-add novalidate aria-labelledby="ab-title">
      <h2 class="admin-client-name" id="ab-title">Add a board</h2>
      <p class="admin-meta">A new client starts with its first board. For another board of the same client, use the same client name.</p>
      <div class="admin-grid">
        <div class="su-field"><label for="ab-client">Client name</label><input id="ab-client" type="text" list="ab-clients" autocomplete="off" maxlength="80"></div>
        <datalist id="ab-clients">${clients.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
        <div class="su-field"><label for="ab-name">Board name</label><input id="ab-name" type="text" autocomplete="off" maxlength="60"></div>
        <div class="su-field"><label for="ab-tz">Time zone</label>
          <select id="ab-tz">${ZONES.map(([v, l]) => `<option value="${v}"${v === 'America/Chicago' ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="su-field"><label for="ab-first">First day to track</label><input id="ab-first" type="date" value="${today}"></div>
        <div class="su-field"><label for="ab-pass">Edit password</label><input id="ab-pass" type="password" autocomplete="new-password"></div>
        <div class="su-field"><label for="ab-pass2">Type it again</label><input id="ab-pass2" type="password" autocomplete="new-password"></div>
      </div>
      <p class="admin-meta">Pick the plant's local time zone. It decides when the plant's day starts, and can't be changed later.</p>
      <p class="su-error" data-add-msg role="alert" hidden></p>
      <div><button class="btn btn--primary" type="submit" data-admin-create>Add the board</button></div>
      <div data-made></div>
    </form>`;
}

function render() {
  root.innerHTML = `
    <header class="admin-head">
      <h1 class="admin-title">Boards</h1>
      <p>Anyone with a board's link can view it. Its edit password lets people change it.</p>
      <button class="btn btn--quiet" type="button" data-admin-signout>Close the admin page</button>
    </header>
    <div data-list>${listMarkup()}</div>
    ${addMarkup()}`;
}

function redrawList() {
  root.querySelector('[data-list]').innerHTML = listMarkup();
}

async function refresh() {
  boards = await rpc('pilot_admin_list', { p_admin: getPass() });
  redrawList();
}

/* ---------- Actions ---------- */

function sayAdd(msg) {
  const p = root.querySelector('[data-add-msg]');
  p.textContent = msg;
  p.hidden = !msg;
}

async function create(form) {
  const v = (id) => form.querySelector(id).value;
  let client = v('#ab-client').trim().replace(/\s+/g, ' ');
  const name = v('#ab-name').trim().replace(/\s+/g, ' ');
  const tz = v('#ab-tz');
  const first = v('#ab-first');
  const pass = v('#ab-pass');
  if (!client) return sayAdd('Type the client name.');
  if (!name) return sayAdd('Type the board name.');
  if (!knownZone(tz)) return sayAdd(WORDS.bad_time_zone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(first)) return sayAdd('Pick the first day to track.');
  if (pass.length < 10) return sayAdd(WORDS.weak_password);
  if (pass !== v('#ab-pass2')) return sayAdd("The two passwords don't match.");
  // The same client typed a little differently is the same client.
  client = boards.find((b) => clientKey(b.client) === clientKey(client))?.client ?? client;
  sayAdd('');
  const btn = form.querySelector('[data-admin-create]');
  btn.disabled = true;
  try {
    const starter = await (await fetch(new URL('../data/starter-board.json?v=20261120-182315', import.meta.url))).json();
    const setup = structuredClone(starter.setup);
    setup.plant = name;
    for (const list of Object.values(setup.kpis)) for (const k of list) k.startDate = first;
    const { id } = await rpc('pilot_admin_create', {
      p_admin: getPass(), p_client: client, p_name: name, p_time_zone: tz, p_first_day: first, p_password: pass, p_setup: setup,
    });
    for (const sel of ['#ab-name', '#ab-pass', '#ab-pass2']) form.querySelector(sel).value = '';
    await refresh();
    const link = linkFor(id);
    form.querySelector('[data-made]').innerHTML = `
      <div class="admin-made" data-admin-made role="status">
        <p><strong>${esc(name)}</strong> is ready. Its link:</p>
        <p class="admin-link" data-admin-link>${esc(link)}</p>
        <p>Save the edit password now. It can't be shown again. You can replace it here.</p>
        <button class="btn btn--secondary" type="button" data-copy-made>Copy link</button>
      </div>`;
    form.querySelector('[data-copy-made]').addEventListener('click', (e) => copy(link, e.currentTarget));
  } catch (e) {
    sayAdd(word(e));
  } finally {
    btn.disabled = false;
  }
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Select the link to copy it';
  }
  setTimeout(() => { if (btn.isConnected) btn.textContent = 'Copy link'; }, 2500);
}

async function onClick(e) {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.matches('[data-admin-signout]')) {
    setPass('');
    root.innerHTML = signInMarkup();
    return;
  }
  const row = t.closest('[data-admin-board]');
  if (!row) return;
  const b = boards.find((x) => x.id === row.dataset.adminBoard);
  const note = row.querySelector('[data-row-note]');
  if (t.matches('[data-admin-copy]')) copy(linkFor(b.id), t);
  else if (t.matches('[data-admin-replace]')) {
    const f = row.querySelector('[data-replace-form]');
    f.hidden = !f.hidden;
    t.setAttribute('aria-expanded', String(!f.hidden));
    if (!f.hidden) f.querySelector('[data-rp-1]').focus();
  } else if (t.matches('[data-admin-archive]')) {
    t.disabled = true;
    try {
      await rpc('pilot_admin_archive', { p_admin: getPass(), p_board: b.id, p_archived: !b.archived });
      await refresh();
      const again = root.querySelector(`[data-admin-board="${CSS.escape(b.id)}"]`);
      again?.querySelector('[data-row-note]')?.replaceChildren(b.archived ? 'Restored. Its link opens again.' : "Archived. Its link won't open until it's restored.");
      again?.querySelector('[data-admin-archive]')?.focus();
    } catch (err) {
      note.textContent = word(err);
      t.disabled = false;
    }
  }
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.target;
  if (form.matches('[data-signin]')) {
    const box = form.querySelector('#admin-pass');
    try {
      await signIn(box.value);
      render();
    } catch (err) {
      root.innerHTML = signInMarkup(word(err));
      root.querySelector('#admin-pass').focus();
    }
  } else if (form.matches('[data-add]')) create(form);
  else if (form.matches('[data-replace-form]')) {
    const row = form.closest('[data-admin-board]');
    const note = row.querySelector('[data-row-note]');
    const a = form.querySelector('[data-rp-1]').value;
    if (a.length < 10) { note.textContent = WORDS.weak_password; return; }
    if (a !== form.querySelector('[data-rp-2]').value) { note.textContent = "The two passwords don't match."; return; }
    try {
      await rpc('pilot_admin_set_password', { p_admin: getPass(), p_board: row.dataset.adminBoard, p_password: a });
      form.reset();
      form.hidden = true;
      row.querySelector('[data-admin-replace]').setAttribute('aria-expanded', 'false');
      note.textContent = 'Edit password replaced. Everyone who was unlocked must unlock again with the new one.';
    } catch (err) {
      note.textContent = word(err);
    }
  }
}

export async function initAdmin() {
  document.documentElement.dataset.admin = '';
  document.title = 'Boards · LinkedXL OS';
  for (const [name, content] of [['referrer', 'no-referrer'], ['robots', 'noindex']]) {
    const m = document.createElement('meta');
    m.name = name;
    m.content = content;
    document.head.append(m);
  }
  root = document.createElement('main');
  root.className = 'admin';
  document.body.prepend(root);
  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  root.innerHTML = signInMarkup();
  root.querySelector('#admin-pass').focus();
}
