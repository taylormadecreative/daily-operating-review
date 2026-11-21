// Pilot boards: a board's six shared documents, loaded from and saved to the server
// (PILOT-SPEC.md, Part 1). With no `?b=` in the address this module does nothing and
// storage() is the browser's localStorage, so the demo behaves exactly as before.
//
// The rest of the app keeps calling getItem/setItem with the same 'demo.…' keys. In
// pilot mode the six shared keys are served from memory and saved to the server after
// 800 ms of quiet, with a version check and a three-way merge (js/merge.js). Every
// other key stays on the device.

import { CLOUD } from './cloud-config.js?v=20261120-182315';
import { mergeDoc } from './merge.js?v=20261120-182315';

const ID_RE = /^[0-9a-f]{32}$/;
const NAME_RE = /^(setup|org|weekly|actions|meetings|numbers-20\d{2}-(0[1-9]|1[0-2]))$/;
const KEY_KEY = 'demo.editKey.v1';
const PENDING_KEY = 'demo.pending.v1';
const RETRY_MS = [5000, 15000, 60000];
const POLL_MS = 60000;
const QUIET_MS = 800;
// Meeting records grow with transcripts: past this the app warns, well before the server's 2 MB limit.
const NEAR_FULL_BYTES = 1500000;
const CODES = new Set(['not_found', 'wrong_password', 'too_many_tries', 'not_unlocked', 'too_large',
  'bad_name', 'weak_password', 'bad_time_zone']);

const param = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('b');
const asked = param ? param.trim().toLowerCase() : null;
/**
 * Which copy this page is: 'main' (the real board), 'demo' (the prospect copy), 'app' (pilot
 * boards). tools/build-share.py writes window.DOR_COPY into each built page; the repo itself is 'dev'.
 * Only the 'app' and 'dev' copies open board links.
 */
export const COPY = (typeof window !== 'undefined' && window.DOR_COPY) || 'dev';
const pilotCopy = COPY === 'app' || COPY === 'dev';
/** The board in the address, or null (demo mode). A malformed id still means pilot mode: it opens as not found. */
export const BOARD = pilotCopy && asked ? asked : null;
/** A board link opened in the 'main' or 'demo' copy: it never loads there, the page points to /app/. */
export const FOREIGN_BOARD = !pilotCopy && asked && ID_RE.test(asked) ? asked : null;
/** The /app/ copy with no board in the address. */
export const NEEDS_BOARD = COPY === 'app' && !BOARD;

// A pilot page is marked for CSS, and tells browsers not to pass its address (the board
// id) to other sites and search engines not to list it.
if (BOARD && typeof document !== 'undefined') {
  document.documentElement.dataset.pilot = '';
  for (const [name, content] of [['referrer', 'no-referrer'], ['robots', 'noindex']]) {
    const m = document.createElement('meta');
    m.name = name;
    m.content = content;
    document.head.append(m);
  }
}

/** The board's address parameter for in-app links ('' in the demo). */
export const boardParam = () => (BOARD ? 'b=' + encodeURIComponent(BOARD) : '');

/**
 * Copy written for the demo says where things are kept ("Saved on this device"). On a pilot
 * board that's the server, and only once it is unlocked; this says what's true there.
 */
export function here(text) {
  if (!BOARD) return text;
  const saved = editKey() ? 'Saved for everyone' : 'Not saved yet';
  return String(text)
    .replace(/Saved on this device for this week only/g, 'Saved for this week only')
    .replace(/Saved on this device(?=;)/g, 'Saved on the server')
    .replace(/Saved on this device/g, saved)
    .replace(/Saves on this device/g, 'Saves to the server')
    .replace(/saved on this device/g, 'saved on the server');
}

/** 'setup.v1' -> 'setup'; 'overlay.v1@2026-11' -> 'numbers-2026-11'. The part before the first dot is the copy's prefix. */
export function docNameFor(key) {
  const s = String(key);
  const rest = s.slice(s.indexOf('.') + 1);
  const m = /^overlay\.v1@(\d{4}-\d{2})$/.exec(rest);
  if (m) return 'numbers-' + m[1];
  const w = /^(setup|org|weekly|actions|meetings)\.v1$/.exec(rest);
  return w ? w[1] : null;
}

/* ---------- Calling the server ---------- */

function fail(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

export async function rpc(name, args) {
  let res;
  try {
    res = await fetch(CLOUD.url + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { apikey: CLOUD.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw fail('offline');
  }
  if (res.ok) {
    const text = await res.text();
    const out = text ? JSON.parse(text) : null;
    // A refused password is an answer, not an error, so the server keeps the record of the try.
    if (out && typeof out === 'object' && !Array.isArray(out) && Object.keys(out).length === 1 && CODES.has(out.error)) throw fail(out.error);
    return out;
  }
  let msg = null;
  try { msg = (await res.json())?.message ?? null; } catch { /* not JSON */ }
  throw fail(res.status === 400 && CODES.has(msg) ? msg : 'offline');
}

/* ---------- The edit key ---------- */

const local = () => { try { return globalThis.localStorage; } catch { return null; } };
const session = () => { try { return globalThis.sessionStorage; } catch { return null; } };
const readJson = (area, key) => { try { return JSON.parse(area?.getItem(key) ?? 'null') ?? {}; } catch { return {}; } };
const writeJson = (area, key, v) => { try { area?.setItem(key, JSON.stringify(v)); return true; } catch { return false; } };

export function editKey() {
  if (!BOARD) return null;
  const s = readJson(session(), KEY_KEY)[BOARD];
  if (typeof s === 'string') return s;
  const l = readJson(local(), KEY_KEY)[BOARD];
  if (l && typeof l.key === 'string' && Date.parse(l.expires) > Date.now()) return l.key;
  return null;
}

function forgetKey() {
  for (const area of [session(), local()]) {
    const all = readJson(area, KEY_KEY);
    if (BOARD in all) { delete all[BOARD]; writeJson(area, KEY_KEY, all); }
  }
}

export const isUnlocked = () => Boolean(editKey());

/** Throws Error('wrong_password' | 'too_many_tries' | 'not_found' | 'offline'). */
export async function unlock(password, stay) {
  const out = await rpc('pilot_unlock', { p_board: BOARD, p_password: String(password ?? ''), p_days: stay ? 90 : 0 });
  forgetKey();
  if (stay) {
    const all = readJson(local(), KEY_KEY);
    all[BOARD] = { key: out.key, expires: out.expires_at };
    writeJson(local(), KEY_KEY, all);
  } else {
    const all = readJson(session(), KEY_KEY);
    all[BOARD] = out.key;
    writeJson(session(), KEY_KEY, all);
  }
  offline = false;
  keyUsed = true;
  persistPending();
  flushAll();
  emitStatus();
}

export async function lock() {
  const key = editKey();
  forgetKey();
  emitStatus();
  if (key) { try { await rpc('pilot_lock', { p_key: key }); } catch { /* the key ends on its own */ } }
}

/* ---------- Documents in memory ---------- */

// name -> { version, server (last body known on the server: the merge base), local, text, dirty, inflight, refused }
const docs = new Map();
let offline = false;
let lastSavedAt = null;
// The device couldn't keep the unsaved changes (its storage is full).
let deviceFull = false;
// An edit key was in use on this visit, so a change waiting without one means the unlock ended.
let keyUsed = false;
let retryIndex = 0;
let retryTimer = null;
const timers = new Map();
let who = () => '';

/** Who's entering, sent with every save. A string or a function returning one. */
export function whoFor(nameOrFn) {
  who = typeof nameOrFn === 'function' ? nameOrFn : () => String(nameOrFn ?? '');
}

function docFor(name) {
  let d = docs.get(name);
  if (!d) {
    d = { version: 0, server: null, local: null, text: null, dirty: false, inflight: false, refused: null };
    docs.set(name, d);
  }
  return d;
}

const memory = {
  getItem(key) {
    const name = docNameFor(key);
    if (!name) return globalThis.localStorage.getItem(key);
    return docs.get(name)?.text ?? null;
  },
  /**
   * opts.quiet: a write the app makes on its own while reading (an older record brought up to
   * date). It changes what this visit reads, but is never a change of its own: it doesn't save,
   * and never asks a view-only visitor to unlock. It goes to the server with the next real change.
   */
  setItem(key, text, opts) {
    const name = docNameFor(key);
    if (!name) { globalThis.localStorage.setItem(key, text); return; }
    const d = docFor(name);
    d.text = String(text);
    d.local = JSON.parse(d.text);
    if (opts?.quiet) {
      if (!d.dirty) d.server = d.local;
      return;
    }
    changed(name);
    if (!editKey()) emitNeedUnlock();
  },
  removeItem(key) {
    const name = docNameFor(key);
    if (!name) { globalThis.localStorage.removeItem(key); return; }
    const d = docFor(name);
    d.text = null;
    d.local = null;
    changed(name);
  },
};

/** What the app reads and writes through. The demo gets localStorage itself (which can throw when blocked, as before). */
export function storage() {
  return BOARD ? memory : globalThis.localStorage;
}

let warnedNearFull = false;

/** Meeting records past 1.5 MB: warns once per visit (on open, or on the change that crosses it). */
export function checkNearFull() {
  const d = docs.get('meetings');
  if (warnedNearFull || !d?.text || new TextEncoder().encode(d.text).length <= NEAR_FULL_BYTES) return;
  warnedNearFull = true;
  emitProblem('near_full', 'meetings');
}

function changed(name) {
  const d = docs.get(name);
  d.dirty = true;
  d.refused = null;
  if (name === 'meetings') checkNearFull();
  persistPending();
  clearTimeout(timers.get(name));
  timers.set(name, setTimeout(() => flush(name), QUIET_MS));
  emitStatus();
}

/* ---------- Unsaved changes kept on the device ---------- */

function persistPending() {
  if (!BOARD || !editKey()) return;
  const all = readJson(local(), PENDING_KEY);
  const mine = {};
  // A document the server refused (too large) would be refused again: it isn't kept on the device.
  // One refused because the board was archived is kept: if the board is restored, it's sent then.
  for (const [name, d] of docs) if (d.dirty && (!d.refused || d.refused === 'not_found')) mine[name] = { base: d.version, baseBody: d.server, body: d.local };
  if (Object.keys(mine).length) all[BOARD] = mine;
  else delete all[BOARD];
  deviceFull = !writeJson(local(), PENDING_KEY, all) && Object.keys(mine).length > 0;
  if (deviceFull) {
    // Too big for the device: keep the numbers at least.
    for (const n of Object.keys(mine)) if (!n.startsWith('numbers-')) delete mine[n];
    all[BOARD] = mine;
    writeJson(local(), PENDING_KEY, all);
  }
}

/* ---------- Saving ---------- */

async function flush(name) {
  const d = docs.get(name);
  if (!d || !d.dirty || d.inflight || d.refused) return;
  clearTimeout(timers.get(name));
  const key = editKey();
  if (!key) { emitStatus(); return; }
  keyUsed = true;
  d.inflight = true;
  emitStatus();
  const sending = d.local;
  const sentText = d.text;
  let again = false;
  try {
    const out = await rpc('pilot_save', {
      p_board: BOARD, p_key: key, p_name: name, p_base_version: d.version,
      p_body: sending, p_who: String(who() ?? '').slice(0, 80),
    });
    offline = false;
    retryIndex = 0;
    if (out?.ok) {
      d.version = out.version;
      d.server = sending;
      if (d.text === sentText) d.dirty = false;
      else again = true;
      lastSavedAt = new Date();
    } else if (out?.conflict) {
      const m = mergeDoc(name, d.server, d.local, out.body);
      d.version = out.version;
      d.server = out.body;
      d.local = m.body;
      d.text = m.body == null ? null : JSON.stringify(m.body);
      again = true;
      emitRemote([name], m.clash);
    }
  } catch (e) {
    if (e.code === 'not_unlocked') { forgetKey(); emitNeedUnlock(); }
    else if (e.code === 'too_large' || e.code === 'bad_name') { d.refused = e.code; emitProblem(e.code, name); }
    else if (e.code === 'not_found') { d.refused = e.code; emitProblem(e.code, name); }
    else { offline = true; scheduleRetry(); }
  } finally {
    d.inflight = false;
    persistPending();
    emitStatus();
  }
  if (again && !offline) flush(name);
}

function flushAll() {
  for (const [name, d] of docs) if (d.dirty && !d.inflight) flush(name);
}

function scheduleRetry() {
  if (retryTimer) return;
  const ms = RETRY_MS[Math.min(retryIndex, RETRY_MS.length - 1)];
  retryIndex += 1;
  retryTimer = setTimeout(() => { retryTimer = null; flushAll(); }, ms);
}

/* ---------- Opening and keeping current ---------- */

let meta = null;

/** Load the board. Throws Error('not_found') or Error('offline'). */
export async function openBoard() {
  if (!BOARD) throw fail('not_found');
  if (!ID_RE.test(BOARD)) throw fail('not_found');
  const out = await rpc('pilot_board_open', { p_board: BOARD });
  docs.clear();
  for (const [name, doc] of Object.entries(out.docs ?? {})) {
    const d = docFor(name);
    d.version = doc.version;
    d.server = doc.body;
    d.local = doc.body;
    d.text = doc.body == null ? null : JSON.stringify(doc.body);
  }
  // Changes this device couldn't send last time.
  const pending = readJson(local(), PENDING_KEY)[BOARD] ?? {};
  for (const [name, p] of Object.entries(pending)) {
    if (!NAME_RE.test(name) || !p || typeof p !== 'object') continue;
    const d = docFor(name);
    const body = d.version === p.base ? p.body : mergeDoc(name, p.baseBody ?? null, p.body, d.server).body;
    d.local = body;
    d.text = body == null ? null : JSON.stringify(body);
    d.dirty = true;
  }
  meta = { id: out.id, client: out.client, name: out.name, timeZone: out.time_zone, firstDay: out.first_day };
  if (editKey()) keyUsed = true;
  startWatching();
  flushAll();
  emitStatus();
  return meta;
}

export const boardMeta = () => meta;

let watching = false;
let polling = false;

function startWatching() {
  if (watching) return;
  watching = true;
  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
  window.addEventListener('beforeunload', (e) => {
    if (hasUnsaved()) { e.preventDefault(); e.returnValue = ''; }
  });
}

export async function poll() {
  if (!BOARD || polling) return;
  polling = true;
  try {
    const versions = await rpc('pilot_board_versions', { p_board: BOARD });
    const wasOffline = offline;
    offline = false;
    const newer = Object.keys(versions).filter((n) => versions[n] > (docs.get(n)?.version ?? 0));
    if (newer.length) {
      const got = await rpc('pilot_board_docs', { p_board: BOARD, p_names: newer });
      const applied = [];
      let clash = false;
      for (const name of newer) {
        const g = got[name];
        const d = docFor(name);
        if (!g || d.inflight || g.version <= d.version) continue;
        if (d.dirty) {
          const m = mergeDoc(name, d.server, d.local, g.body);
          d.local = m.body;
          clash = clash || m.clash;
        } else d.local = g.body;
        d.text = d.local == null ? null : JSON.stringify(d.local);
        d.server = g.body;
        d.version = g.version;
        applied.push(name);
      }
      if (applied.length) emitRemote(applied, clash);
    }
    if (wasOffline) flushAll();
  } catch (e) {
    if (e.code === 'offline' && hasUnsaved()) offline = true;
    // Archived (or gone) while open: say so instead of leaving the last numbers up.
    else if (e.code === 'not_found') emitProblem('not_found', null);
  } finally {
    polling = false;
    emitStatus();
  }
}

/** The last saves, newest first: [{at, name, who}] (PILOT-SPEC.md, Part 3). */
export async function history(limit = 50) {
  if (!BOARD) return [];
  const rows = await rpc('pilot_history', { p_board: BOARD, p_limit: limit });
  return Array.isArray(rows) ? rows : [];
}

export function hasUnsaved() {
  for (const d of docs.values()) if (d.dirty) return true;
  return false;
}

/* ---------- Status ---------- */

const statusCbs = new Set();
const remoteCbs = new Set();
const problemCbs = new Set();

/**
 * { state, at: iso|null, keyEnded }. state is 'saved' | 'saving' | 'offline' | 'too-large' |
 * 'device-full' | 'view-only' | 'held' (a change waiting for an unlock; keyEnded: one was in use).
 */
export function status() {
  let dirty = false;
  let busy = false;
  let tooLarge = false;
  for (const d of docs.values()) {
    if (d.dirty && !d.refused) dirty = true;
    if (d.inflight) busy = true;
    if (d.refused === 'too_large') tooLarge = true;
  }
  let state;
  if (!editKey()) state = dirty ? 'held' : 'view-only';
  else if (deviceFull && dirty) state = 'device-full';
  else if (offline && dirty) state = 'offline';
  else if (tooLarge) state = 'too-large';
  else if (dirty || busy) state = 'saving';
  else state = 'saved';
  return { state, at: lastSavedAt ? lastSavedAt.toISOString() : null, keyEnded: state === 'held' && keyUsed };
}

let lastStatus = '';
function emitStatus() {
  const s = status();
  const sig = s.state + '|' + s.at + '|' + s.keyEnded;
  if (sig === lastStatus) return;
  lastStatus = sig;
  for (const cb of statusCbs) { try { cb(s); } catch (e) { console.error(e); } }
}
function emitRemote(names, clash) {
  for (const cb of remoteCbs) { try { cb({ names, clash }); } catch (e) { console.error(e); } }
}
const needCbs = new Set();
function emitNeedUnlock() {
  for (const cb of needCbs) { try { cb(); } catch (e) { console.error(e); } }
}
function emitProblem(code, name) {
  for (const cb of problemCbs) { try { cb({ code, name }); } catch (e) { console.error(e); } }
}

export const onStatus = (cb) => { statusCbs.add(cb); return () => statusCbs.delete(cb); };
export const onRemoteChange = (cb) => { remoteCbs.add(cb); return () => remoteCbs.delete(cb); };
/** Someone changed something in view only. */
// A listener that arrives after the refusal (the board opened with a change waiting and the unlock
// already ended) still hears it, so the unlock sheet opens first (PILOT-SPEC.md, "When the connection drops").
export const onNeedUnlock = (cb) => {
  needCbs.add(cb);
  if (status().state === 'held') queueMicrotask(cb);
  return () => needCbs.delete(cb);
};
export const onProblem = (cb) => { problemCbs.add(cb); return () => problemCbs.delete(cb); };
