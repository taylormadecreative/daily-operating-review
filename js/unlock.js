// Pilot boards: the edit password (PILOT-SPEC.md, "The board link and the edit password").
// The page opens in view only. "Unlock to edit" (in the scope line on every page) opens this
// sheet; a change made in view only opens it too, and closing it leaves a banner up until the
// person unlocks or reloads. Words come from the spec's table.

import * as cloud from './cloud.js?v=20261120-154112';

const WORDS = {
  wrong_password: "That password didn't match.",
  too_many_tries: 'Too many tries. Try again in 15 minutes.',
  not_found: "We couldn't find that board. Check the link, or ask the person who sent it.",
  offline: "Can't reach the server. Check your connection and try again.",
};

let dlg = null;
let banner = null;
let returnTo = null;
let busy = false;
// The sheet was closed without unlocking while a change waits: the banner says so from then on.
let dismissed = false;

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'sheet sheet--narrow unlock';
  dlg.id = 'unlock';
  dlg.setAttribute('aria-labelledby', 'unlock-title');
  dlg.innerHTML = `
    <div class="sheet-panel">
      <div class="sheet-head">
        <h2 class="sheet-title" id="unlock-title" tabindex="-1">Unlock to edit</h2>
        <div class="sheet-tools"><button class="btn btn--secondary" type="button" data-unlock-close>Close</button></div>
      </div>
      <form class="unlock-form" data-unlock-form novalidate>
        <p class="unlock-text">Anyone with this link can view. Type the edit password to change numbers.</p>
        <div class="su-field">
          <label for="unlock-pass">Edit password</label>
          <input id="unlock-pass" type="password" autocomplete="current-password" required aria-describedby="unlock-msg">
        </div>
        <label class="unlock-stay"><input id="unlock-stay" type="checkbox"> <span>Stay unlocked on this device</span></label>
        <p class="su-error unlock-msg" id="unlock-msg" data-unlock-msg role="alert" hidden></p>
        <div class="unlock-actions"><button class="btn btn--primary" type="submit" data-unlock-submit>Unlock</button></div>
      </form>
    </div>`;
  document.body.append(dlg);
  dlg.querySelector('[data-unlock-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => {
    dismissed = cloud.status().state === 'held';
    syncBanner();
    const to = returnTo;
    returnTo = null;
    if (to?.isConnected) to.focus({ preventScroll: true });
  });
  dlg.querySelector('[data-unlock-form]').addEventListener('submit', submit);

  banner = document.createElement('div');
  banner.className = 'held-banner';
  banner.dataset.heldBanner = '';
  banner.setAttribute('role', 'status');
  banner.hidden = true;
  banner.innerHTML = `<p>You're in view only. What you just changed isn't saved. Unlock to save it, or reload to drop it.</p>
    <button class="btn btn--secondary" type="button" data-unlock>Unlock to edit</button>`;
  document.body.prepend(banner);
}

function say(code) {
  const msg = dlg.querySelector('[data-unlock-msg]');
  msg.textContent = code ? (WORDS[code] ?? WORDS.offline) : '';
  msg.hidden = !code;
  dlg.querySelector('#unlock-pass').setAttribute('aria-invalid', String(Boolean(code)));
}

async function submit(e) {
  e.preventDefault();
  if (busy) return;
  const box = dlg.querySelector('#unlock-pass');
  if (!box.value) { box.focus(); return; }
  busy = true;
  const btn = dlg.querySelector('[data-unlock-submit]');
  btn.disabled = true;
  try {
    await cloud.unlock(box.value, dlg.querySelector('#unlock-stay').checked);
    box.value = '';
    say(null);
    dlg.close();
  } catch (err) {
    say(err.code ?? 'offline');
    box.select();
  } finally {
    busy = false;
    btn.disabled = false;
  }
}

export function openUnlock(from = document.activeElement) {
  if (!dlg || dlg.open) return;
  returnTo = from instanceof HTMLElement ? from : null;
  say(null);
  // A sheet already open (Enter numbers, Board setup) stays under this one.
  dlg.showModal();
  dlg.querySelector('#unlock-pass').focus();
}

function syncBanner() {
  if (!banner) return;
  const s = cloud.status();
  if (s.state !== 'held') dismissed = false;
  // The banner's "reload to drop it" is true only for a change made in view only. When an unlock
  // ended, the change is kept on the device and sent after the next unlock: the scope line says so.
  banner.hidden = !dismissed || dlg.open || s.keyEnded;
}

/** The scope line's button: "Unlock to edit" in view only, "Lock" when unlocked. */
export function unlockButtonMarkup() {
  return cloud.isUnlocked()
    ? '<button class="btn btn--text scope-lock" type="button" data-unlock>Lock</button>'
    : '<button class="btn btn--text scope-lock" type="button" data-unlock>Unlock to edit</button>';
}

/** Scope line words for the save state (PILOT-SPEC.md, "What the screen says"). */
export function statusWords() {
  const { state, at } = cloud.status();
  if (state === 'saved') {
    const time = at ? new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
    return { text: time ? `Saved to the server · ${time}` : 'Saved to the server', off: false };
  }
  if (state === 'saving') return { text: 'Saving…', off: false };
  if (state === 'offline') return { text: 'Not saved yet. Trying again.', off: true };
  if (state === 'too-large') return { text: 'Too large to save. Remove something from it and try again.', off: true };
  if (state === 'device-full') return { text: 'Not saved, and this device is full. Keep this page open.', off: true };
  if (state === 'held' && cloud.status().keyEnded) return { text: 'Your unlock ended. Unlock to save what you changed.', off: true };
  return { text: 'View only', off: state === 'held' };
}

export function initUnlock({ onStatus, toast }) {
  if (!cloud.BOARD) return;
  build();
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-unlock]');
    if (!btn) return;
    if (cloud.isUnlocked()) await cloud.lock();
    else openUnlock(btn);
  });
  cloud.onNeedUnlock(() => {
    // The first change made in view only opens the sheet; once it's closed, the banner says so.
    if (!dismissed) openUnlock();
  });
  cloud.onStatus((s) => { syncBanner(); onStatus?.(s); });
}
