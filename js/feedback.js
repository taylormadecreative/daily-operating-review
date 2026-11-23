// Pilot boards: Send feedback (PILOT-SPEC.md Part 4). The Menu's and the sidebar's "Send feedback"
// open a sheet; the note goes to the server with the page it came from and the name picked under
// "Who's entering". The admin page lists the newest notes. View only can send one: it needs no
// edit password. Words come from the spec's table.

import * as cloud from './cloud.js?v=20261122-211924';
import { getIdentity } from './identity.js?v=20261122-211924';
import { getMonth } from './store.js?v=20261122-211924';

const MAX = 2000;
const WORDS = {
  offline: "Can't reach the server. Your feedback wasn't sent. Try again.",
  too_many_reports: 'This board has sent a lot of feedback today. Try again tomorrow.',
};

let dlg = null;
let returnTo = null;
let sending = false;
let opts = { toast: () => {}, page: () => '' };

function who() {
  try { return getIdentity(getMonth())?.name ?? ''; } catch { return ''; }
}

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'sheet sheet--narrow feedback';
  dlg.id = 'feedback';
  dlg.setAttribute('aria-labelledby', 'feedback-title');
  dlg.innerHTML = `
    <div class="sheet-panel">
      <div class="sheet-head">
        <h2 class="sheet-title" id="feedback-title" tabindex="-1">Send feedback</h2>
        <div class="sheet-tools"><button class="btn btn--secondary" type="button" data-feedback-close>Close</button></div>
      </div>
      <form class="unlock-form feedback-form" data-feedback-form novalidate>
        <p class="unlock-text">Tell the team running this pilot what isn't working, or what would help.</p>
        <div class="su-field">
          <label for="feedback-text">Your feedback</label>
          <textarea id="feedback-text" rows="6" maxlength="${MAX}" aria-describedby="feedback-who feedback-msg"></textarea>
        </div>
        <p class="feedback-who" id="feedback-who" data-feedback-who></p>
        <p class="su-error" id="feedback-msg" data-feedback-msg role="alert" hidden></p>
        <div class="unlock-actions"><button class="btn btn--primary" type="submit" data-feedback-send>Send</button></div>
      </form>
    </div>`;
  document.body.append(dlg);
  dlg.querySelector('[data-feedback-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => {
    const to = returnTo;
    returnTo = null;
    if (to?.isConnected) to.focus({ preventScroll: true });
  });
  dlg.querySelector('[data-feedback-form]').addEventListener('submit', submit);
}

function say(text) {
  const p = dlg.querySelector('[data-feedback-msg]');
  p.textContent = text ?? '';
  p.hidden = !text;
}

async function submit(e) {
  e.preventDefault();
  if (sending) return;
  const box = dlg.querySelector('#feedback-text');
  const text = box.value.trim();
  if (!text) { box.focus(); return; }
  const btn = dlg.querySelector('[data-feedback-send]');
  sending = true;
  btn.disabled = true;
  say(null);
  try {
    await cloud.report('feedback', text, { page: opts.page(), who: who() });
    box.value = '';
    dlg.close();
    opts.toast('Thanks. Your feedback was sent.');
  } catch (err) {
    say(WORDS[err.code] ?? WORDS.offline);
  } finally {
    sending = false;
    btn.disabled = false;
  }
}

export function openFeedback(from = document.activeElement) {
  if (!cloud.BOARD) return;
  if (!dlg) build();
  if (dlg.open) return;
  returnTo = from instanceof HTMLElement ? from : null;
  const name = who();
  dlg.querySelector('[data-feedback-who]').textContent = name ? `Sent as ${name}.` : 'Sent without a name.';
  say(null);
  dlg.showModal();
  dlg.querySelector('#feedback-text').focus();
}

/** Adds "Send feedback" to the Menu on a pilot board (the sidebar draws its own). page() names the page. */
export function initFeedback({ toast, page }) {
  if (!cloud.BOARD) return;
  opts = { toast, page };
  const menu = document.getElementById('dor-menu');
  if (menu && !menu.querySelector('[data-open-feedback]')) {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.dataset.openFeedback = '';
    btn.textContent = 'Send feedback';
    const before = menu.querySelector('[data-start-tour]');
    if (before) before.before(btn);
    else menu.append(btn);
  }
  document.addEventListener('click', (e) => {
    const from = e.target.closest('[data-open-feedback]');
    if (!from) return;
    e.preventDefault();
    menu?.hidePopover?.();
    if (document.getElementById('drawer')?.open && from.closest('#drawer')) document.getElementById('drawer').close();
    openFeedback(from.closest('#dor-menu') ? document.querySelector('[data-topbar-more]') : from);
  });
}
