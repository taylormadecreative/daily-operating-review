// Who is entering numbers on this device.
// Demo: one tap on your name, remembered in localStorage.
// Production: replace this module with Google sign-in; the rest of the app
// only calls getIdentity / setIdentity / clearIdentity.

const KEY = 'dor.identity.v1';

/** { name, functionId } of the remembered person, if they still own a row. */
export function getIdentity(month) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { saved = null; }
  if (!saved || typeof saved !== 'object') return null;
  const fn = month.functions.find((f) => f.id === saved.functionId && f.owner === saved.name);
  return fn ? { name: fn.owner, functionId: fn.id } : null;
}

export function setIdentity(person) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ name: person.name, functionId: person.functionId }));
    return true;
  } catch {
    return false; // still works for this visit; just not remembered
  }
}

export function clearIdentity() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

/** Raw stored value, for the demo reset's Undo. */
export function snapshotIdentity() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function restoreIdentity(raw) {
  try {
    if (raw) localStorage.setItem(KEY, raw);
    else localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}
