// Pure date helpers for a pilot board's calendar (PILOT-SPEC.md, Part 2).
// Dates are 'YYYY-MM-DD' strings and months 'YYYY-MM'; "today" is the date in
// the board's time zone, so the day turns at midnight plant time.

import { addDays, isoTime } from './weekly.js?v=20261122-211924';

export { addDays, isoTime };

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FMT = new Map();

function fmt(timeZone) {
  const k = timeZone || '';
  if (!FMT.has(k)) {
    const opts = { year: 'numeric', month: '2-digit', day: '2-digit' };
    try {
      FMT.set(k, new Intl.DateTimeFormat('en-CA', timeZone ? { ...opts, timeZone } : opts));
    } catch {
      FMT.set(k, new Intl.DateTimeFormat('en-CA', opts));
    }
  }
  return FMT.get(k);
}

/** Today's date in a time zone, as 'YYYY-MM-DD' (an unknown zone falls back to the device's). */
export function todayIn(timeZone, now = new Date()) {
  // From the parts, never the formatted string (en-CA's order has changed between browser versions).
  const p = Object.fromEntries(fmt(timeZone).formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export const monthKey = (iso) => String(iso).slice(0, 7);

export function daysInMonth(month) {
  const [y, m] = String(month).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 'YYYY-MM' plus a day of that month -> 'YYYY-MM-DD'. */
export const monthDate = (month, day) => `${month}-${String(day).padStart(2, '0')}`;

/** The month n months after (or before) this one. */
export function shiftMonth(month, n) {
  const [y, m] = String(month).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
}

/**
 * Which days of the month are production days: the week days in `productionDays` (like ['mon', ...]),
 * less `daysOff`, plus `extraDays` (both lists of ISO dates; dates in other months are ignored).
 * -> { [day]: boolean }
 */
export function productionCalendar(month, productionDays, daysOff = [], extraDays = []) {
  const on = new Set(productionDays ?? []);
  const off = new Set(daysOff ?? []);
  const extra = new Set(extraDays ?? []);
  const out = {};
  for (let d = 1, n = daysInMonth(month); d <= n; d++) {
    const iso = monthDate(month, d);
    if (extra.has(iso)) out[d] = true;
    else if (off.has(iso)) out[d] = false;
    else out[d] = on.has(DOW[new Date(isoTime(iso)).getUTCDay()]);
  }
  return out;
}

/** The date kept between first and last (ISO strings compare in date order). */
export function clampIso(iso, first, last) {
  if (first && iso < first) return first;
  if (last && iso > last) return last;
  return iso;
}
