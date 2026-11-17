// Action states (the client team's spec §12), one set of rules for every screen.
//
//   Open → In progress → Completed → Verified (closed)
//   Completed → In progress (a verifier rejects it, with a reason)
//   Open, In progress or Completed → Cancelled (with a reason; it does not resolve the issue)
//   Verified or Cancelled → Open (reopened, with a reason; the history keeps every step)
//
// Escalated is a separate flag (an action stays in progress while escalated). Overdue is derived:
// past its due date and not closed. Aging is the days it has been open.
// No imports: the board, the register, the meeting, the minutes and the Weekly review all read it.

export const ACTION_STATES = ['open', 'in-progress', 'completed', 'verified', 'cancelled'];

export const ACTION_STATE_WORD = {
  open: 'Open',
  'in-progress': 'In progress',
  completed: 'Completed',
  verified: 'Verified',
  cancelled: 'Cancelled',
};

/** The words a record migrated from the old Open / In progress / Done set carries in its history. */
export const MIGRATED_NOTE = 'Closed before verification existed';
/** The step an Open or In progress action from before the action states carries. */
export const MIGRATED_OPEN_NOTE = 'Kept from before the action states existed';

/** Closed: verified, or cancelled. Everything else is open work (Completed waits for its verifier). */
export const isClosedAction = (a) => a?.status === 'verified' || a?.status === 'cancelled';
export const isOpenAction = (a) => Boolean(a) && !isClosedAction(a);
export const isVerifiedAction = (a) => a?.status === 'verified';
export const isCancelledAction = (a) => a?.status === 'cancelled';
export const isCompletedAction = (a) => a?.status === 'completed';
/** Escalated and still open (the flag stays on a closed action's record, but it no longer asks for anything). */
export const isEscalatedAction = (a) => isOpenAction(a) && Boolean(a?.escalation);

/** Past its due date on the day looked from, and not closed. */
export const isOverdueAction = (a, iso) => isOpenAction(a) && Boolean(a?.due) && Boolean(iso) && a.due < iso;

/** The days this action answers for: the day it was added for, and each day linked to it (repeat losses). */
export function actionDays(a) {
  const days = new Set((Array.isArray(a?.affectedDays) ? a.affectedDays : []).filter(Boolean));
  if (a?.dayIso) days.add(a.dayIso);
  return [...days].sort();
}

/** Does the action already answer for this board day (its own day, or a day linked to it)? */
export const coversDay = (a, iso) => Boolean(iso) && (a?.dayIso === iso || (a?.affectedDays ?? []).includes(iso));

/**
 * Does the action count as its KPI's action on a board day ('YYYY-MM-DD')? From the day it was added
 * for (and on any day linked to it), while open, and through the day it was verified. A cancelled one
 * never does: cancelling doesn't resolve the issue, so the KPI asks for an action again. With no day,
 * only open actions count.
 */
export function countsOnDay(a, iso) {
  if (!iso) return isOpenAction(a);
  if (isCancelledAction(a)) return false;
  if (a.dayIso && a.dayIso > iso && !coversDay(a, iso)) return false;
  if (isOpenAction(a)) return true;
  return Boolean(a.closedDayIso) && a.closedDayIso >= iso;
}

/** Was it open (added, not yet closed) on that day? The Weekly review's carried-in and overdue lists ask this. */
export function openOnDay(a, iso) {
  if (a?.dayIso && a.dayIso > iso) return false;
  if (isOpenAction(a)) return true;
  return Boolean(a?.closedDayIso && a.closedDayIso > iso);
}

const dayMs = (iso) => Date.parse(`${iso}T00:00:00Z`);

/** Aging: whole days open, from the first day it answers for to the day looked from (or the day it closed). null when unknown. */
export function actionAgeDays(a, asOfIso) {
  const start = actionDays(a)[0];
  if (!start || !asOfIso) return null;
  const end = isClosedAction(a) && a.closedDayIso && a.closedDayIso < asOfIso ? a.closedDayIso : asOfIso;
  const n = Math.round((dayMs(end) - dayMs(start)) / 86400000);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

/** "Open 4 days", "Added this day", or '' when the start isn't known. */
export function agingWords(a, asOfIso) {
  const n = actionAgeDays(a, asOfIso);
  if (n === null) return '';
  if (isClosedAction(a)) return `Was open ${n} ${n === 1 ? 'day' : 'days'}`;
  return n === 0 ? 'Added this day' : `Open ${n} ${n === 1 ? 'day' : 'days'}`;
}

/** Same person by name (without case or extra spaces): only for an owner who isn't in the Organization. */
export const samePerson = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase() && String(a ?? '').trim() !== '';

/**
 * Does this person own the action? By person id when the action has one (renaming someone in Board setup
 * never makes them a different person), by name only for an owner outside the Organization.
 */
export const ownsAction = (person, a) => (a?.ownerPersonId ? person?.id === a.ownerPersonId : samePerson(person?.name, a?.owner));

/**
 * Who may verify this action: the organization's people with the Verifier role, each marked when they
 * own the action. Self-verification is off unless the organization allows it.
 * -> { options: [{ id, name, self, allowed }], allowSelf, any }  (any: someone can verify)
 */
export function verifierOptions(org, a) {
  const allowSelf = org?.allowSelfVerify === true;
  const options = (org?.people ?? [])
    .filter((p) => (p.roles ?? []).includes('verifier') && String(p.name ?? '').trim())
    .map((p) => {
      const self = ownsAction(p, a);
      return { id: p.id, name: p.name.trim(), self, allowed: !self || allowSelf };
    });
  return { options, allowSelf, any: options.some((o) => o.allowed) };
}

/** The status as a word with its own mark (shapes differ, not just colors): the register's, Detail's and the minutes' look. */
export function actionStateMarkup(status, tag = 'span') {
  const word = ACTION_STATE_WORD[status];
  if (!word) return '';
  return `<${tag} class="ast ast--${status}"><span class="ast-mark" aria-hidden="true"></span>${word}</${tag}>`;
}
