// Who is entering numbers on this device.
// Demo: one tap on your name, remembered in localStorage.
// Production: replace this module with Google sign-in; the rest of the app
// only calls getIdentity / setIdentity / clearIdentity.

const KEY = 'dor.identity.v1';

// This visit's copy: when the browser blocks storage (a private window), the
// person is still remembered until the page closes.
let mem = null;
let memOnly = false; // the last write was refused, so this visit's copy is the truth

/** Board setup's stand-in for an owner nobody has named yet ("Owner name", "Owner", empty): not a person. */
const PLACEHOLDER = /^\s*(owner(\s+name)?)?\s*$/i;

/** { name, functionId } of the remembered person, if they still own a row (under a real name). */
export function getIdentity(month) {
  let saved = null;
  if (memOnly) saved = mem;
  else {
    try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { saved = mem; }
  }
  if (!saved || typeof saved !== 'object') return null;
  const fn = month.functions.find((f) => f.id === saved.functionId && f.owner === saved.name);
  return fn && !PLACEHOLDER.test(String(fn.owner ?? '')) ? { name: fn.owner, functionId: fn.id } : null;
}

export function setIdentity(person) {
  mem = { name: person.name, functionId: person.functionId };
  try {
    localStorage.setItem(KEY, JSON.stringify(mem));
    memOnly = false;
    return true;
  } catch {
    memOnly = true;
    return false; // remembered for this visit only
  }
}

export function clearIdentity() {
  mem = null;
  memOnly = false;
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

/** Raw stored value, for the demo reset's Undo. */
export function snapshotIdentity() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function restoreIdentity(raw) {
  mem = null;
  memOnly = false;
  try {
    if (raw) localStorage.setItem(KEY, raw);
    else localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}
