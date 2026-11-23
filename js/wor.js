// Weekly review (?view=wor&week=YYYY-MM-DD; WOR-ORG-PLAN Part 3, the client team's spec §5, §6, §8, §9, §13).
// One page in the shell, four tabs:
//   Overview         the week in one sentence, review readiness (kept apart from performance), the
//                    scoreboard in the DOR board's look, and the broader weekly measures
//   Functions        each function's days (each links to that day on the DOR board) and its commentary
//   Actions          the Action register scoped to the week
//   Meeting records  weekly review records (Save review draft saves one) and the daily meetings' minutes
// Every weekly value opens "View calculation" (#calc/<key>): rule and version, formula in words, the days
// it used and left out, raw vs effective, the override or weekly entry, and its history.
// Numbers come from js/weekly.js (pure); what this page saves lives in store.js (dor.weekly.v1).

import {
  getOrg, kpiRowsFor, isoForDay, anyFunctionById, readWeekly, editWeekly, weekSaved, dateBounds, dayFromIso,
} from './store.js?v=20261123-135808';
import { ON, OFF, NOT_ENTERED, NO_GOAL, statusWord, monthStatus, isProductionDay } from './status.js?v=20261123-135808';
import {
  weeksOf, weekForDay, weeklyResult, repeatGap, functionWeek, weeklyPair, ruleFor, RULES, CALC_VERSION, calcWords,
  EXCLUDED_WORDS, keyOf, lastProductionDay, addDays, plainNumber, isoTime,
} from './weekly.js?v=20261123-135808';
import { plainLabel, formatValue, goalSign, parseInput, formatEnteredAt, formatStamp, glossaryTerm, formatPair } from './format.js?v=20261123-135808';
import { esc, statusMarkup, glyphMarkup, termButton, GLYPH } from './ui.js?v=20261123-135808';
import { icon, DEPT_ICON } from './icons.js?v=20261123-135808';
import { avatarMarkup, dueText, ACTION_WORD, responseFor, dailyWords, lapsedMarkup, lapsedWords, plantName, fitClampedText } from './board.js?v=20261123-135808';
import { listActions, escalateAction, addAction, linkCandidates, linkActionDay, nextProductionDayIso } from './actions.js?v=20261123-135808';
import {
  isOpenAction, isVerifiedAction, isOverdueAction, openOnDay, agingWords, actionStateMarkup,
} from './action-state.js?v=20261123-135808';
import { listMinutes } from './recorder.js?v=20261123-135808';
import { pageHref, setNavState } from './shell.js?v=20261123-135808';
import { fitSheetHead } from './detail.js?v=20261123-135808';
import { getIdentity } from './identity.js?v=20261123-135808';
import * as cloud from './cloud.js?v=20261123-135808';

// Demo copy says where things are kept; on a board they're on the server, so the words drop it.
const ON_DEVICE = cloud.BOARD ? '' : ' on this device';

/** The broader weekly set (spec §5: WOR is not a weekly copy of DOR): each function's month measure, entered once a week. */
const MEASURE_FNS = ['safety', 'people', 'quality', 'engineering', 'operations', 'maintenance'];
const TABS = [['overview', 'Overview'], ['functions', 'Functions'], ['actions', 'Actions'], ['records', 'Meeting records']];
export const COMMENT_FIELDS = [
  ['happened', 'What happened and the cause evidence'],
  ['expected', 'Expected result'],
  ['risks', 'Next-week risks'],
];

let ctx = null;
let dlg = null;
let last = null;      // the model the page was last drawn from
let sheet = null;     // { kind: 'calc' | 'record', id }
let opener = null;    // what opened the sheet
let closeAsked = false;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/* ---------- Dates ---------- */

const utc = (iso) => new Date(`${iso}T00:00:00Z`);
const F_MED = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const F_LONG = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const F_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dayMed = (iso) => F_MED.format(utc(iso));     // "Mon, Feb 23"
const dayLong = (iso) => F_LONG.format(utc(iso));   // "Sun, Mar 1, 2026"
const dayShort = (iso) => F_SHORT.format(utc(iso)); // "Feb 23"
const F_WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }); // "Tue"
const nb = (s) => String(s).replace(/ /g, ' ');
/** A separator dot ends its line, never starts the next: "Missed every day · 4 weeks" keeps a no-break space before the dot. */
const nbDot = (s) => String(s).replace(/ ·/g, '\u00a0·');
const DOW_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Dec 12" (with the year when it isn't the data's year): an override's expiry. */
const dayShortAny = (iso) => (iso ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(utc(iso)) : '');

/** "Week of Feb 23". */
export const weekLabel = (week) => `Week of ${dayShort(week.start)}`;
/** "week of Feb 23", inside a sentence. */
const weekOf = (week) => `week of ${dayShort(week.start)}`;
/** "Mon, Feb 23 – Sun, Mar 1, 2026". */
const boundaries = (week) => `${dayMed(week.start)} – ${dayLong(week.end)}`;

/* ---------- The week the page shows ---------- */

/** The organization's weeks for the month. */
const weeksFor = (month) => {
  const weeks = weeksOf(month, { weekStart: getOrg(month).active.weekStart });
  if (!cloud.BOARD) return weeks;
  // A pilot board: only weeks with a day of this month from the first day through today.
  const { min, max } = dateBounds(month);
  return weeks.filter((w) => w.days.some((d) => d.day !== null && d.iso >= min && d.iso <= max));
};

/** The Weekly review's weeks for the month (a pilot board: the first day through today). */
export const worWeeks = (month) => weeksFor(month);

/**
 * The week holding a day of the month, else the nearest one in the direction of travel
 * (dir > 0: the next, dir < 0: the one before). -> its key, or null
 */
export function weekNear(month, day, dir) {
  const weeks = weeksFor(month);
  const w = weeks.find((x) => x.days.some((d) => d.day === day))
    ?? (dir > 0 ? weeks.find((x) => x.days.some((d) => d.day !== null && d.day > day))
      : [...weeks].reverse().find((x) => x.days.some((d) => d.day !== null && d.day < day)));
  return w?.key ?? null;
}

/**
 * A week that crosses into the next month (a pilot board): "This week continues in December.
 * Those days are on December's review." Its one saved record stays under its Monday.
 */
export function splitWeekNote(week) {
  const after = week?.days.filter((d) => d.day === null && d.iso > week.days.find((x) => x.day !== null)?.iso);
  if (!cloud.BOARD || !after?.length) return '';
  const name = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(`${after[0].iso}T12:00:00Z`));
  return `This week continues in ${name}. Those days are on ${name}'s review.`;
}

/**
 * The day a Weekly review link should look from: the day itself when it falls in the asked week,
 * else that week's last production day. -> { day, week, badWeek }
 * (app.js keeps ?date= inside ?week=, so the scope line, the sidebar's links and the DOR links agree.)
 */
export function worDay(month, weekKey, day) {
  const weeks = weeksFor(month);
  let asked = weekKey ? weeks.find((w) => w.key === weekKey) : null;
  // A day inside a week (?week=2026-02-25, a Wednesday) means that week: it snaps to its Monday, and says so.
  const snapped = !asked && weekKey ? weeks.find((w) => w.days.some((d) => d.iso === weekKey)) ?? null : null;
  if (snapped) asked = snapped;
  if (!asked) return { day, week: weekForDay(weeks, day), badWeek: Boolean(weekKey) };
  const snap = snapped ? { snappedFrom: weekKey, weekKey: snapped.key } : {};
  if (asked.days.some((d) => d.day === day)) return { day, week: asked, badWeek: false, ...snap };
  let look = lastProductionDay(asked);
  // A pilot board's week this week looks from today at the latest.
  if (cloud.BOARD && isoForDay(month, look) > dateBounds(month).max) look = dayFromIso(month, dateBounds(month).max) ?? look;
  return { day: look, week: asked, badWeek: false, ...snap };
}

/** The KPI that weights the weighted rule: Operations' parts produced (hidden in Board setup or not). */
const weightRowOf = (month) => anyFunctionById(month, 'operations');

/** One KPI's result for a week, with this device's saved input for it. */
function resultFor(month, doc, row, week, asOfDay, rule) {
  return weeklyResult(month, row, week, {
    asOfDay,
    rule,
    input: weekSaved(doc, week.key).inputs[keyOf(row)] ?? null,
    weightRow: weightRowOf(month),
    today: todayIso(),
  });
}

/** Today on this device's clock ('YYYY-MM-DD'): an override's approval runs until its expiry date. */
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const addDaysLocal = (iso, n) => { const t = new Date(`${iso}T12:00:00`); t.setDate(t.getDate() + n); return todayIsoOf(t); };
const todayIsoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const F_ANY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
/** "Sat, Dec 12, 2026" for an expiry date. */
const dateWords = (iso) => (iso ? F_ANY.format(utc(iso)) : 'not set');

/** Who may approve an override: a Verifier, a Site or department leader, or an Administrator. */
export const approvers = (org) => org.people.filter((p) => p.name.trim() && p.roles.some((r) => ['verifier', 'leader', 'admin'].includes(r)));
/** Who may amend a finalized record: an Administrator or a Facilitator (as for finalizing). */
const amenders = (org) => finalizers(org);

/**
 * The most a weekly value or override can be, by unit (spec §9: authorized, plausible inputs). A percent
 * stops at 100% unless the measure can pass it (labor efficiency: earned hours can beat clocked hours).
 * -> { max, whole, words }
 */
export function weeklyLimit(kpi) {
  const name = `${kpi?.name ?? ''} ${kpi?.boardLabel ?? ''}`;
  if (kpi?.unit === 'fraction') return /efficiency/i.test(name) ? { max: 10, whole: false, words: '1,000%' } : { max: 1, whole: false, words: '100%' };
  if (kpi?.unit === 'rate') return { max: 1000, whole: false, words: '1,000' };
  if (kpi?.unit === 'count') return { max: 100000, whole: true, words: '100,000' };
  if (kpi?.unit === 'parts') return { max: 10000000, whole: true, words: '10,000,000' };
  if (kpi?.unit === 'hours') return { max: 1000000, whole: false, words: '1,000,000' };
  return { max: 100000, whole: false, words: '100,000' };
}

/** A broader weekly measure as a KPI row: the function's month measure, entered once a week. */
const measureRow = (fn) => ({ id: `m:${fn.id}`, fnId: fn.id, kpiDaily: fn.kpiMonthly, daily: { plant: [] }, measure: true });

/**
 * This week's result for one KPI row as of a day (the Organization's cards and person sheet).
 * -> { status, kpi, pair, met, days, provisional, received, expected, week }
 */
/** The week (Monday to Sunday) that holds a board day, or null (the Organization's period control). */
export const weekOfDay = (month, day) => weekForDay(weeksFor(month), day) ?? null;

export function weekFor(month, row, day) {
  const weeks = weeksFor(month);
  const week = weekForDay(weeks, day);
  if (!week) return null;
  const inWeek = week.days.some((d) => d.day === day);
  const r = resultFor(month, readWeekly(), row, week, inWeek ? day : Infinity);
  return {
    status: r.status,
    goalVaries: r.goalVaries,
    kpi: row.kpiDaily,
    pair: weeklyPair(r.effective, r.goalVaries ? null : r.goal, row.kpiDaily, r.rule, { entered: r.mode !== 'AUTO' }),
    met: r.met,
    days: r.marks.length,
    provisional: r.provisional,
    received: r.received,
    expected: r.expected,
    week,
  };
}

/**
 * This week so far, for the Home dashboard's one line: how many functions are on track for the week
 * (by each KPI's weekly rule) through the day on screen. -> { on, total, off: [names], week, asOfIso } or null
 */
export function weekGlance(month, day) {
  const week = weekForDay(weeksFor(month), day);
  if (!week) return null;
  const m = buildModel(month, day, week.key);
  if (!m) return null;
  return {
    on: m.fns.filter((f) => f.status === ON).length,
    total: m.fns.length,
    trend: m.summary.trend,
    off: m.fns.filter((f) => f.status === OFF).map((f) => f.fn.name),
    week: m.week,
    asOfIso: m.asOfIso,
  };
}

/** The week's model for another module (the weekly meeting): the week of `weekKey`, or the one holding the day. */
export const weekModel = (month, day, weekKey = undefined) => buildModel(month, day, weekKey ?? new URLSearchParams(location.search).get('week'));

/** The week's model: every KPI's result, its last weeks, the summary and readiness. */
function buildModel(month, day, want = new URLSearchParams(location.search).get('week')) {
  const org = getOrg(month).active;
  const weeks = weeksFor(month);
  const week = weeks.find((w) => w.key === want) ?? weekForDay(weeks, day);
  if (!week) return null;
  const idx = weeks.indexOf(week);
  const inWeek = week.days.some((d) => d.day === day);
  const asOfDay = inWeek ? day : week.days.filter((d) => d.day !== null).pop().day;
  const asOfIso = isoForDay(month, asOfDay);
  const doc = readWeekly();
  const saved = weekSaved(doc, week.key);

  // The week's board days through the day it looks from: the days the response rule and the daily words read.
  const weekDays = week.days.filter((d) => d.day !== null && d.day <= asOfDay).map((d) => d.day);
  const fns = month.functions.map((fn) => {
    const rows = kpiRowsFor(fn).map((row) => {
      const rule = ruleFor(row);
      const history = weeks.slice(0, idx + 1).map((w, i) => resultFor(month, doc, row, w, i === idx ? asOfDay : Infinity, rule));
      const result = history[history.length - 1];
      // board.js responseFor: the same rule as the DOR board, over the week's days.
      const response = responseFor(month, fn, row, weekDays);
      return { row, key: keyOf(row), rule, result, history, gap: repeatGap(history), acts: response.assigned, response, needs: result.status === OFF && !response.has };
    });
    return {
      fn, rows, status: functionWeek(rows.map((r) => r.result)), commentary: saved.commentary[fn.id] ?? null,
      daily: dailyWords(month, fn, weekDays),
    };
  });

  const measures = month.functions.filter((fn) => !fn.custom && MEASURE_FNS.includes(fn.id)).map((fn) => {
    const row = measureRow(fn);
    const result = resultFor(month, doc, row, week, asOfDay, 'weekly-only');
    return { fn, row, key: row.id, rule: 'weekly-only', result, monthGoal: monthStatus(month, fn, asOfDay).goal };
  });

  const m = { month, org, weeks, week, idx, day, asOfDay, asOfIso, weekDays, doc, saved, fns, measures };
  m.summary = summaryOf(m);
  m.readiness = readinessOf(m);
  return m;
}

/* ---------- The week in one sentence ---------- */

function summaryOf(m) {
  const names = (list) => list.map((x) => x.fn.name);
  const on = m.fns.filter((f) => f.status === ON);
  const off = m.fns.filter((f) => f.status === OFF);
  const everyDay = m.fns.filter((f) => f.rows.some((r) => r.result.missedAll));
  const onButMissed = m.fns.filter((f) => f.status === ON && f.rows.some((r) => r.result.missed >= 3));
  const varies = m.fns.filter((f) => f.rows.some((r) => r.result.goalVaries));
  const missing = m.fns.filter((f) => f.rows.some((r) => r.result.status === NOT_ENTERED));
  const provisional = m.fns.filter((f) => f.rows.some((r) => r.result.provisional));
  // Is it getting better? The same count for the week before, from the same rules: its whole week, or, while
  // this week is still going, the week before through the same weekday ("through Tue").
  const trend = weekTrend(m, on.length);
  const lead = `${on.length} of ${m.fns.length} on track ${trend.through ? `through ${trend.through}` : 'for the week'}${trend.words ? `, ${trend.words}` : ''}.`;
  const lines = [];
  if (everyDay.length) lines.push({ kind: OFF, label: 'Missed every production day', fns: everyDay });
  if (off.length) lines.push({ kind: OFF, label: 'Off goal for the week', fns: off });
  if (onButMissed.length) {
    lines.push({
      kind: 'mixed',
      label: 'On track for the week, but missed days',
      fns: onButMissed,
      extra: (f) => {
        const r = f.rows.find((x) => x.result.missed >= 3).result;
        return `${r.missed} of ${r.marks.length}`;
      },
    });
  }
  if (varies.length) lines.push({ kind: NO_GOAL, label: 'Goal changed during the week, so no weekly status', fns: varies });
  if (missing.length) lines.push({ kind: NOT_ENTERED, label: 'Not entered', fns: missing });
  if (provisional.length) {
    lines.push({
      kind: NOT_ENTERED,
      label: 'Provisional, not every day is in',
      fns: provisional,
      extra: (f) => {
        const r = f.rows.find((x) => x.result.provisional).result;
        return `${r.received} of ${r.expected} days`;
      },
    });
  }
  const text = [lead, ...lines.map((l) => `${l.label}: ${l.fns.map((f) => (l.extra ? `${f.fn.name} (${l.extra(f)})` : f.fn.name)).join(', ')}.`)].join(' ');
  return { lead, lines, text, on: names(on), off: names(off), everyDay: names(everyDay), trend };
}

/**
 * The week against the week before it, like with like:
 * - a whole week: "up from 4 of 8 last week", "down from 6 of 8 last week", "the same as last week";
 * - a week still going (production days left after the day it looks from): last week through the same weekday,
 *   "the same as last week through Tue", "up from 3 of 8 last week through Tue".
 * Nothing before the month's first week in the data. -> { prevOn, words, through }  (through: 'Tue' or null)
 */
function weekTrend(m, onNow) {
  const pos = m.week.days.findIndex((d) => d.day === m.asOfDay);
  const partial = m.week.days.some((d) => d.day !== null && d.day > m.asOfDay && isProductionDay(m.month, d.day) !== false);
  const through = partial && pos >= 0 ? F_WEEKDAY.format(utc(m.week.days[pos].iso)) : null;
  const i = m.idx - 1;
  if (i < 0) return { prevOn: null, words: '', through };
  const n = m.fns.length;
  const prev = m.weeks[i];
  // Last week's same weekday (or the last day of it this month has, at the month's edge).
  const prevDay = through ? prev.days.slice(0, pos + 1).filter((d) => d.day !== null).pop()?.day ?? null : null;
  if (through && prevDay === null) return { prevOn: null, words: '', through };
  const prevOn = through
    ? m.fns.filter((f) => functionWeek(f.rows.map((r) => resultFor(m.month, m.doc, r.row, prev, prevDay, r.rule))) === ON).length
    : m.fns.filter((f) => functionWeek(f.rows.map((r) => r.history[i]).filter(Boolean)) === ON).length;
  const tail = through ? ` through ${through}` : '';
  const words = prevOn < onNow ? `up from ${prevOn} of ${n} last week${tail}`
    : prevOn > onNow ? `down from ${prevOn} of ${n} last week${tail}` : `the same as last week${tail}`;
  return { prevOn, words, through };
}

/* ---------- Review readiness (spec §5 Prepare Review, §13 checklist): apart from performance ---------- */

/** Open on that day (added by then, not closed before it). */
const openOn = (a, iso) => openOnDay(a, iso) || Boolean(a.closedDayIso === iso);

/** The week's actions from the Action register, by action id. */
export function actionSets(m) {
  const all = listActions().filter((a) => !a.dayIso || a.dayIso <= m.week.end);
  const ws = m.week.start;
  const nextStart = addDays(m.week.end, 1);
  const nextEnd = addDays(m.week.end, 7);
  const carried = all.filter((a) => (!a.dayIso || a.dayIso < ws) && openOn(a, ws));
  const opened = all.filter((a) => a.dayIso && a.dayIso >= ws && a.dayIso <= m.week.end);
  const dueNext = all.filter((a) => isOpenAction(a) && a.due && a.due >= nextStart && a.due <= nextEnd);
  const overdue = all.filter((a) => a.due && a.due < m.asOfIso && openOnDay(a, m.asOfIso));
  return { carried, opened, dueNext, overdue, nextStart, nextEnd };
}

/** The latest review record saved for an earlier week. */
export const previousRecord = (m) => m.doc.records.filter((r) => r.weekKey < m.week.key)
  .sort((a, b) => b.weekKey.localeCompare(a.weekKey) || String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] ?? null;

/** The people the review needs: each function's responsible owner and accountable leader. */
function neededPeople(m) {
  const ids = new Set();
  for (const f of m.fns) {
    const a = m.org.functions?.[f.fn.id] ?? {};
    if (a.responsible) ids.add(a.responsible);
    if (a.accountable) ids.add(a.accountable);
  }
  return m.org.people.filter((p) => ids.has(p.id));
}

export const hasCommentary = (c) => Boolean(c && COMMENT_FIELDS.some(([k]) => String(c[k] ?? '').trim()));

function readinessOf(m) {
  const items = [];
  // 1. Data complete: the daily numbers each rule needs, and the weekly measures entered.
  const dailyRows = m.fns.flatMap((f) => f.rows);
  const expected = dailyRows.reduce((n, r) => n + r.result.expected, 0);
  const received = dailyRows.reduce((n, r) => n + r.result.received, 0);
  const weeklyIn = m.measures.filter((x) => x.result.effective !== null).length;
  const gaps = [];
  for (const f of m.fns) {
    for (const r of f.rows) {
      for (const d of r.result.days) {
        if (d.production && ['not-entered', 'no-goal', 'no-weight', 'not-reached'].includes(d.reason)) {
          const why = d.reason === 'no-goal' ? 'no goal set' : d.reason === 'not-reached' ? 'not reached yet' : d.reason === 'no-weight' ? 'no parts count' : 'not entered';
          gaps.push(`${f.fn.name}, ${dayMed(d.iso)}: ${why}`);
        }
      }
    }
  }
  items.push({
    id: 'data',
    title: 'Data complete',
    done: received === expected && weeklyIn === m.measures.length,
    text: `${received} of ${expected} daily numbers · ${weeklyIn} of ${m.measures.length} weekly measures entered`,
    short: `${received} of ${expected} daily · ${weeklyIn} of ${m.measures.length} weekly`,
    detail: gaps.slice(0, 3).join('; ') + (gaps.length > 3 ? `; ${gaps.length - 3} more` : ''),
  });
  // 2. Off-goal results with no action (an open action counting this week, by action id).
  const noAction = m.fns.filter((f) => f.rows.some((r) => r.needs));
  items.push({
    id: 'actions',
    title: 'Off-goal results without an action',
    done: noAction.length === 0,
    text: noAction.length ? `${noAction.length} with no action: ${noAction.map((f) => f.fn.name).join(', ')}` : 'None: each one has a next-24-hours action or an Action register action',
    short: noAction.length ? `${noAction.length}: ${noAction.map((f) => f.fn.name).join(', ')}` : 'None',
  });
  // 3. Actions updated since the last review.
  const sets = actionSets(m);
  const prev = previousRecord(m);
  const since = prev ? (prev.updatedAt ?? prev.createdAt) : null;
  const carried = sets.carried.filter(isOpenAction);
  const updated = since ? carried.filter((a) => String(a.updatedAt || a.createdAt || '') > since) : [];
  items.push({
    id: 'updated',
    title: 'Actions updated since the last review',
    done: carried.length === 0 || (Boolean(since) && updated.length === carried.length),
    text: !carried.length ? 'No open actions carried in from before this week'
      : since ? `${updated.length} of ${carried.length} carried-in actions, since the review of ${dayShort(prev.weekKey)}`
        : `${carried.length} carried in · no earlier weekly review${ON_DEVICE} to compare with`,
    short: !carried.length ? 'None carried in' : since ? `${updated.length} of ${carried.length} updated` : `${carried.length} carried in · nothing to compare with`,
  });
  // 4. Commentary written (needed for every function off goal for the week).
  const written = m.fns.filter((f) => hasCommentary(f.commentary));
  const missingOff = m.fns.filter((f) => f.status === OFF && !hasCommentary(f.commentary));
  items.push({
    id: 'commentary',
    title: 'Commentary written',
    done: missingOff.length === 0,
    text: `${written.length} of ${m.fns.length} functions${missingOff.length ? ` · still needed: ${missingOff.map((f) => f.fn.name).join(', ')}` : ''}`,
    short: missingOff.length ? `Needed: ${missingOff.map((f) => f.fn.name).join(', ')}` : `${written.length} of ${m.fns.length} written`,
  });
  // 5. Participants confirmed (from the Organization).
  const needed = neededPeople(m);
  const confirmed = new Set(m.saved.participants);
  const yes = needed.filter((p) => confirmed.has(p.id));
  items.push({
    id: 'participants',
    title: 'Participants confirmed',
    done: needed.length > 0 && yes.length === needed.length,
    text: `${yes.length} of ${needed.length} owners and leaders`,
    short: `${yes.length} of ${needed.length} owners and leaders`,
  });
  return items;
}

/* ---------- Rendering helpers ---------- */

/** Status word for a weekly result (a varying goal reads "Goal varies", never a status). */
export const resultWord = (r, kpi) => (r.goalVaries ? 'Goal varies' : r.status === NO_GOAL ? 'No goal set' : statusWord(r.status, kpi));

/** "89, 54": the day goals of a week whose goal changes. */
export const goalList = (r, kpi) => r.goalValues.map((g) => formatValue(g, kpi.unit)).join(', then ');
/** A week whose day goals differ, in plain words for anyone reading the board (not "needs a period rule"). */
export const goalChangedWords = (r, kpi) => `Goal changed during the week (${goalList(r, kpi)}). No weekly status until one weekly goal is set.`;

/** The figure, what it's judged against, and its tags, as the solid status block shows them. */
function weekBlock(m, entry, { label = 'This week', calc = true, compact = false } = {}) {
  const r = entry.result;
  const kpi = entry.row.kpiDaily;
  const pair = weeklyPair(r.effective, r.goalVaries ? null : r.goal, kpi, r.rule, { entered: r.mode !== 'AUTO' });
  const word = resultWord(r, kpi);
  let body = '';
  if (pair.actual !== null) {
    body = `<p class="block-figure">${esc(pair.actual)}</p>`;
    if (r.goalVaries) body += `<p class="block-rest">${esc(goalChangedWords(r, kpi))}</p>`;
    else if (pair.rest) body += `<p class="block-rest">${esc(pair.rest)}</p>`;
  } else if (entry.rule === 'weekly-only') {
    body = '<p class="block-rest">Entered once a week</p>';
  } else {
    body = `<p class="block-rest">${esc(pair.rest)}</p>`;
  }
  const tags = [];
  if (r.provisional) tags.push(`Provisional · ${r.received} of ${r.expected} ${r.expected === 1 ? 'day' : 'days'}`);
  if (r.overridden) {
    const raw = weeklyPair(r.raw, null, kpi, r.rule).actual;
    tags.push(`Overridden · calculated ${raw ?? 'not entered'}`);
    if (r.needsReapproval) tags.push('Needs reapproval: the numbers changed');
  } else if (r.overrideExpired) {
    tags.push(`Override expired ${dayShortAny(r.overrideExpired.expires)}`);
  }
  const status = r.goalVaries ? NO_GOAL : r.status;
  const button = calc
    ? `<button class="btn--text wk-calc" type="button" data-calc="${esc(entry.key)}">View calculation<span class="sr-only"> for ${esc(plainLabel(kpi))}</span></button>`
    : '';
  return `<div class="v2cell v2cell--block wk-block${compact ? ' wk-block--compact' : ''}" data-status="${status}">
      <p class="v2-label">${esc(label)}</p>
      ${statusMarkup(status, { kpi, extra: 'block-status', word })}
      ${body}
      ${tags.map((t) => `<p class="wk-tag">${esc(t)}</p>`).join('')}
      ${button}
    </div>`;
}

/** Monday to Friday: one mark per production day, with its letter. */
function daysCell(m, entry) {
  const r = entry.result;
  const kpi = entry.row.kpiDaily;
  if (!r.marks.length) return '<p class="v2-note is-empty">No production days</p>';
  const marks = r.marks.map((x) => {
    const glyph = x.status === 'not-reached' ? 'g-untracked' : GLYPH[x.status];
    const word = x.status === 'not-reached' ? 'not reached yet' : statusWord(x.status, kpi).toLowerCase();
    const inner = `<svg class="glyph" aria-hidden="true" focusable="false"><use href="#${glyph}"></use></svg><span class="wk-day-d" aria-hidden="true">${DOW_LETTER[x.dow]}</span><span class="sr-only">${esc(dayMed(x.iso))}: ${esc(word)}</span>`;
    // Each day opens that day on the DOR board (this KPI's Detail), as the Functions tab's days do.
    const boardDay = x.status !== 'not-reached' && x.iso.startsWith(`${m.month.month}-`) ? Number(x.iso.slice(8, 10)) : null;
    return `<li class="wk-day wk-day--${x.status}">${boardDay
      ? `<a class="wk-day-link" href="${esc(dorDayHref(m, boardDay, entry.row.id))}" title="${esc(`${dayMed(x.iso)}: ${word}. Open it on the DOR board`)}">${inner}<span class="sr-only">. Open it on the DOR board</span></a>`
      : inner}</li>`;
  }).join('');
  // "On track" may end a line in a narrow column; "2 of 5 days" stays together, and the dot stays at the end
  // of a line (a no-break space before it), never at the start of the next.
  const caption = r.missed
    ? `On track <span class="nowrap">${r.met} of ${r.marks.length} days</span>&nbsp;· <strong class="nowrap">missed ${r.missed}</strong>`
    : `On track <span class="nowrap">${r.met} of ${r.marks.length} days</span>`;
  return `<ol class="wk-days" aria-label="Days on track">${marks}</ol><p class="mini-caption wk-days-cap">${caption}</p>`;
}

/** The last 4 weeks: each week's result (status glyph) against its goal (a dashed tick). */
function fourWeeks(m, entry) {
  const kpi = entry.row.kpiDaily;
  const slots = [];
  for (let i = 0; i < 4; i += 1) {
    const wi = m.idx - 3 + i;
    slots.push(wi >= 0 ? { week: m.weeks[wi], res: entry.history[wi] } : null);
  }
  const vals = [];
  for (const s of slots) {
    if (!s) continue;
    if (isNum(s.res.effective)) vals.push(s.res.effective);
    if (isNum(s.res.goal) && !s.res.goalVaries) vals.push(s.res.goal);
  }
  if (!vals.length) return '<p class="mini-empty">No weekly results yet</p>';
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) { const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1; lo -= pad; hi += pad; if (lo < 0 && Math.min(...vals) >= 0) { hi -= lo; lo = 0; } }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const X = (i) => (i + 0.5) * 25;
  const Y = (v) => 5 + (1 - (v - lo) / (hi - lo)) * 30;
  let line = '';
  let goals = '';
  let goalOpen = false; // one unbroken goal line across the weeks (a step where the goal changes; a gap only where there is none)
  const marks = [];
  const said = [];
  slots.forEach((s, i) => {
    if (!s) { goalOpen = false; return; }
    const r = s.res;
    const pair = weeklyPair(r.effective, r.goalVaries ? null : r.goal, kpi, r.rule, { entered: r.mode !== 'AUTO' });
    if (isNum(r.goal) && !r.goalVaries) {
      const y = Y(r.goal).toFixed(2);
      goals += `${goalOpen ? `L${(i * 25).toFixed(2)} ${y}` : `M${(i * 25).toFixed(2)} ${y}`}H${((i + 1) * 25).toFixed(2)}`;
      goalOpen = true;
    } else goalOpen = false;
    if (isNum(r.effective)) {
      line += `${line ? 'L' : 'M'}${X(i).toFixed(2)} ${Y(r.effective).toFixed(2)}`;
      const st = r.goalVaries ? NO_GOAL : r.status;
      marks.push(`<span class="w4-mark w4-mark--${st}" style="left:${X(i)}%;top:${(Y(r.effective) / 40) * 100}%">${glyphMarkup(st)}</span>`);
    }
    said.push(`${weekLabel(s.week)}: ${pair.actual ?? 'not entered'}${pair.actual !== null && pair.rest ? ` ${pair.rest}` : ''}, ${resultWord(r, kpi).toLowerCase()}${r.provisional ? ', provisional' : ''}`);
  });
  const judged = slots.filter((s) => s && (s.res.status === ON || s.res.status === OFF) && !s.res.goalVaries);
  const onCount = judged.filter((s) => s.res.status === ON).length;
  const axis = slots.map((s, i) => {
    if (!s) return '<li aria-hidden="true"></li>';
    const first = slots.slice(0, i).every((x) => !x) || s.week.start.slice(5, 7) !== slots[i - 1]?.week.start.slice(5, 7);
    const text = first ? dayShort(s.week.start) : String(Number(s.week.start.slice(8, 10)));
    return `<li${i === 3 ? ' class="is-this"' : ''}>${esc(text)}</li>`;
  }).join('');
  return `<div class="w4" role="img" aria-label="${esc(`Last 4 weeks against goal. ${said.join('. ')}.`)}">
      <div class="w4-plot">
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path class="w4-goal" d="${goals}" vector-effect="non-scaling-stroke"/>
          <path class="w4-line" d="${line}" vector-effect="non-scaling-stroke"/>
        </svg>
        ${marks.join('')}
      </div>
      <ol class="w4-axis" aria-hidden="true">${axis}</ol>
    </div>
    <p class="mini-caption">${judged.length ? `<span class="nowrap">On track ${onCount} of ${judged.length} ${judged.length === 1 ? 'week' : 'weeks'}</span>` : 'Not judged yet'}${slots[0] ? '' : `&nbsp;· <span class="nowrap">no data before ${esc(dayShort(m.weeks[0].start))}</span>`}</p>`;
}

function gapCell(entry) {
  const g = entry.gap;
  if (g.level === 'none') return '<p class="v2-note is-empty">None</p>';
  return `<p class="status status--off wk-gap wk-gap--${g.level}" title="${esc(g.long ?? g.word)}">${glyphMarkup(OFF)}<span class="status-word" aria-hidden="true">${esc(nbDot(g.word))}</span><span class="sr-only">${esc(g.long ?? g.word)}</span></p>`;
}

/** "From the daily board, Fri, Feb 27:" with the day's issue and next-24-hours action (read only). */
export function dailyFromBoard(m, f, { compact = false } = {}) {
  const groups = f.daily ?? [];
  if (!groups.length) {
    return compact ? '' : `<p class="wk-daily wk-daily--none">The daily board has no issue or next-24-hours action written for ${esc(f.fn.name)} this week.</p>`;
  }
  if (compact) {
    const g = groups[0];
    const text = g.issue ?? g.action;
    return `<p class="wk-daily-line"><span class="wk-from">From the daily board, ${esc(nb(dayMed(isoForDay(m.month, g.day))))}:</span> ${esc(text)}</p>`;
  }
  return `<div class="wk-daily">${groups.map((g) => `<p class="wk-from">From the daily board, ${esc(nb(dayMed(isoForDay(m.month, g.day))))}:</p>
      <dl class="wk-daily-dl">
        ${g.issue ? `<div><dt>Issue</dt><dd>${esc(g.issue)}</dd></div>` : ''}
        ${g.action ? `<div><dt>Next 24 hours</dt><dd>${esc(g.action)}</dd></div>` : ''}
      </dl>`).join('')}
      <p class="wk-daily-note">Read only: change it in Enter numbers. Use it as a starting point for the commentary below.</p>
    </div>`;
}

function commentCell(m, f) {
  const c = f.commentary;
  const write = `<button class="btn--text wk-write" type="button" data-write-commentary="${esc(f.fn.id)}">${hasCommentary(c) ? 'Edit' : 'Write commentary'}<span class="sr-only"> for ${esc(f.fn.name)}</span></button>`;
  if (!hasCommentary(c)) {
    const need = f.status === OFF ? '<p class="wk-need">Needed: off goal for the week</p>' : '';
    const daily = dailyFromBoard(m, f, { compact: true });
    return `${daily || '<p class="v2-note is-empty">Not written yet</p>'}${need}${write}`;
  }
  const first = COMMENT_FIELDS.map(([k]) => String(c[k] ?? '').trim()).find(Boolean);
  return `<p class="v2-note wk-comment">${esc(first)}</p>${write}`;
}

function actionCellWeek(m, f, entry) {
  const r = entry.result;
  const fnOwner = f.fn.owner;
  const note = entry.response.note;
  const noteHtml = note ? `<p class="wk-daily-line"><span class="wk-from">From the daily board, ${esc(nb(dayMed(isoForDay(m.month, note.day))))}:</span> ${esc(note.text)}</p>` : '';
  // Each listed action can take focus (tabindex -1): after Save action in the sheet, focus lands on the new one.
  const items = entry.acts.slice(0, 2).map((a) => (isVerifiedAction(a)
    ? `<li class="v2-assigned v2-assigned--done" data-wk-act="${esc(a.id)}" tabindex="-1"><span class="v2-assigned-text">${statusMarkup(ON, { tag: 'span', word: 'Verified:', extra: 'v2-done' })} ${esc(a.text)}</span><span class="v2-assigned-meta">${esc(a.owner || fnOwner)}</span></li>`
    : `<li class="v2-assigned" data-wk-act="${esc(a.id)}" tabindex="-1"><span class="v2-assigned-text">${esc(a.text)}</span><span class="v2-assigned-meta">${esc(a.owner || fnOwner)} · ${a.status === 'completed' ? 'Completed, awaiting verification' : esc(dueText(a.due))}</span></li>`)).join('');
  const more = entry.acts.length > 2 ? `<p class="v2-more">${entry.acts.length - 2} more in the Action register</p>` : '';
  const needs = entry.needs;
  const label = plainLabel(entry.row.kpiDaily);
  const add = `<button class="btn ${needs ? 'btn--primary' : 'btn--text'} v2-add" type="button" data-wk-add="${esc(f.fn.id)}" data-wk-add-kpi="${esc(entry.row.primary ? '' : entry.row.kpiId)}">Add action<span class="sr-only"> for ${esc(label)}</span></button>`;
  // A fix verified mid-week that didn't hold no longer answers for the week (board.js responseFor).
  const lapsed = lapsedMarkup(entry.response.lapsed);
  if (needs) return `<div class="v2-needs-row"><p class="v2-needs">${statusMarkup(OFF, { tag: 'span', word: ACTION_WORD.needs })}</p>${add}</div>${lapsed}${noteHtml}${items ? `<ul class="v2-assigned-list">${items}</ul>` : ''}${more}`;
  if (items || noteHtml) return `${noteHtml}${items ? `<ul class="v2-assigned-list">${items}</ul>` : ''}${more}${add}`;
  return `<p class="v2-note is-empty">${r.status === ON ? ACTION_WORD.none : ACTION_WORD.notYet}</p>${add}`;
}

/** "Goal: ≤ 0", "No goal set" from the monthly measure (a reference: no weekly goal is approved). */
function monthGoalLine(kpi, goal) {
  if (!isNum(goal)) return 'Month goal: not set';
  return `Month goal: ${goalSign(goal, kpi)}${formatValue(goal, kpi.unit)}`;
}

/** A measure's name with its ⓘ glued to the last word ("Earned hours ⓘ"): the button never sits alone on a line. */
function nameWithTerm(month, kpi) {
  const t = glossaryTerm(month, kpi);
  const label = plainLabel(kpi);
  if (!t) return esc(label);
  const words = label.split(' ');
  const last = words.pop();
  return `${words.length ? `${esc(words.join(' '))} ` : ''}<span class="nowrap">${esc(last)}${termButton(t.term, t.definition, t.name)}</span>`;
}

/** The rule's name. Its caveat ("Proposed rule", a stand-in) lives in View calculation; a small ⓘ says there's more there. */
function ruleLine(rule) {
  const r = RULES[rule];
  if (!r.note) return `<p class="wk-rule"><span class="wk-rule-name">${esc(r.name)}</span></p>`;
  // The cue travels with the name's last word ("production day ⓘ"), never alone on a line.
  const words = r.name.split(' ');
  const lastWord = words.pop();
  return `<p class="wk-rule"><span class="wk-rule-name">${words.length ? `${esc(words.join(' '))} ` : ''}<span class="nowrap">${esc(lastWord)}<svg class="icon wk-rule-cue" aria-hidden="true" focusable="false"><use href="#g-info"></use></svg></span></span><span class="sr-only"> (View calculation has a note on this rule)</span></p>`;
}

/* ---------- Overview ---------- */

function summaryMarkup(m) {
  const s = m.summary;
  const jump = (f) => `<a href="#wk-${esc(f.fn.id)}" data-wk-jump="${esc(f.fn.id)}">${esc(f.fn.name)}</a>`;
  const lines = s.lines.map((l) => {
    const glyph = l.kind === OFF ? glyphMarkup(OFF) : l.kind === 'mixed' ? glyphMarkup(ON) : glyphMarkup(l.kind);
    const list = l.fns.map((f) => (l.extra ? `<span class="nowrap">${jump(f)} (${esc(l.extra(f))})</span>` : jump(f))).join(', ');
    return `<li class="wk-line wk-line--${l.kind}">${glyph}<span>${esc(l.label)}: ${list}.</span></li>`;
  }).join('');
  return `<section class="wk-sum" aria-labelledby="wk-lead">
      <p class="wk-eyebrow">${esc(weekLabel(m.week))} · Plant total</p>
      <h2 class="wk-lead" id="wk-lead">${esc(s.lead)}</h2>
      ${lines ? `<ul class="wk-lines">${lines}</ul>` : ''}
    </section>`;
}

/** "5 exceptions" / "no exceptions"; "1 note" / "2 notes" (a note: append-only, with its author and reason). */
const exceptionWords = (n) => (n ? `${n} ${n === 1 ? 'exception' : 'exceptions'}` : 'no exceptions');
const notesWords = (n) => `${n} ${n === 1 ? 'note' : 'notes'}`;

/** The finalized version of the same week that replaced this one (the next one finalized after it), or null. */
export const replacementOf = (doc, rec) => (rec?.state === 'finalized' && doc
  ? doc.records.filter((r) => r.weekKey === rec.weekKey && r.state === 'finalized' && r.version > rec.version).sort((a, b) => a.version - b.version)[0] ?? null
  : null);

const CHECK = '<svg class="wk-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>';

/**
 * A finalized week's card: the record's state, never a to-do list. "Finalized v1 · 5 exceptions" (or "no
 * exceptions"), when and who, the way in, and the one way to change it: a revised version (v2), which
 * replaces v1 once it's finalized. The readiness rings belong to a review still being prepared.
 */
function finalMarkup(m, final) {
  const n = final.exceptions.length;
  const next = final.version + 1;
  const notes = final.amendments.length;
  return `<section class="wk-ready wk-ready--final" id="wk-ready" aria-labelledby="wk-ready-title" tabindex="-1">
      <div class="wk-ready-head">
        <h2 class="wk-ready-title" id="wk-ready-title">Review finalized</h2>
        <p class="wk-ready-count"><strong data-ready-final>Finalized v${final.version} · ${esc(exceptionWords(n))}</strong> · <span data-ready-prepared>${esc(`${formatEnteredAt(final.finalizedAt)}${final.finalizedBy ? ` · ${final.finalizedBy}` : ''}`)}</span> · <button class="btn btn--text wk-ready-open" type="button" data-record-open="${esc(final.id)}">Open record</button></p>
      </div>
      <p class="wk-ready-note">The week's record keeps its results, decisions, actions and commentary as they were${notes ? `, with ${esc(notesWords(notes))} added since` : ''}.</p>
      ${n ? `<ul class="wk-final-exc" aria-label="Exceptions noted on the record">${final.exceptions.slice(0, 3).map((x) => `<li>${esc(x.text)}</li>`).join('')}${n > 3 ? `<li class="wk-final-more">${n - 3} more on the record</li>` : ''}</ul>` : ''}
      <p class="wk-ready-amend"><button class="btn btn--secondary" type="button" data-amend-draft>Start a revised version (v${next})</button><span>For a change after finalizing. v${final.version} stays the week's record until v${next} is finalized.</span></p>
    </section>`;
}

function readinessMarkup(m) {
  const done = m.readiness.filter((x) => x.done).length;
  const needed = neededPeople(m);
  const confirmed = new Set(m.saved.participants);
  // The week's record, in the readiness line: a revised version being prepared after it was finalized, or
  // the draft saved for the meeting. A finalized week's card is the record's state instead (finalMarkup).
  const final = latestFinal(m.doc, m.week.key);
  const draft = latestDraft(m.doc, m.week.key);
  if (final && !draft) return finalMarkup(m, final);
  const prepared = draft?.basedOn ? `Revised version v${draft.version} (draft) · saved ${formatEnteredAt(draft.updatedAt ?? draft.createdAt)}`
    : m.saved.preparedAt ? `Draft saved ${formatEnteredAt(m.saved.preparedAt)}` : 'No draft saved yet';
  const people = needed.map((p) => `<li><label class="wk-person"><input type="checkbox" data-participant="${esc(p.id)}"${confirmed.has(p.id) ? ' checked' : ''}><span>${esc(p.name || 'No name yet')}</span>${p.title ? `<span class="wk-person-title">${esc(p.title)}</span>` : ''}</label></li>`).join('');
  // Compact: one line an item (its short words; the full ones are its title and in the record), so the
  // scoreboard starts on the first screen of a laptop and the TV.
  return `<section class="wk-ready" id="wk-ready" aria-labelledby="wk-ready-title" tabindex="-1">
      <div class="wk-ready-head">
        <h2 class="wk-ready-title" id="wk-ready-title">Review readiness</h2>
        <p class="wk-ready-count"><strong>${done} of ${m.readiness.length}</strong> ready · <span data-ready-prepared>${esc(prepared)}</span></p>
      </div>
      <p class="wk-ready-note">About the meeting, not the plant's results.</p>
      <ul class="wk-ready-list">
        ${m.readiness.map((x) => `<li class="wk-ready-item${x.done ? ' is-done' : ''}" data-ready="${esc(x.id)}" title="${esc(`${x.title}: ${x.text}`)}">
          <span class="wk-ready-mark">${x.done ? CHECK : '<span class="wk-ring" aria-hidden="true"></span>'}<span class="sr-only">${x.done ? 'Ready: ' : 'Not ready: '}</span></span>
          <span class="wk-ready-text"><span class="wk-ready-name">${esc(x.title)}</span><span class="wk-ready-val"><span aria-hidden="true">${esc(x.short ?? x.text)}</span><span class="sr-only">${esc(x.text)}</span></span>${x.detail ? `<span class="wk-ready-detail">${esc(x.detail)}</span>` : ''}</span>
        </li>`).join('')}
      </ul>
      <details class="wk-people"${needed.length && confirmed.size === 0 ? '' : ''}>
        <summary>Confirm participants <span class="wk-people-n">${needed.filter((p) => confirmed.has(p.id)).length} of ${needed.length}</span></summary>
        <ul class="wk-people-list">${people || '<li class="is-empty">Nobody owns a function yet. Set people up in Board setup.</li>'}</ul>
      </details>
    </section>`;
}

/**
 * One KPI's cells. Their order in the page is the order they're read and tabbed through: the last row
 * carries the function's commentary before its action (the table's Commentary column sits left of
 * Action), and a phone's fold button sits where it shows, under the days.
 */
function rowCells(m, f, entry, r, lastRow = false) {
  const kpi = entry.row.kpiDaily;
  return `<div class="wk-row" style="--r:${r}" data-key="${esc(entry.key)}">
      <div class="v2cell wk-kpi">
        <p class="v2-label">Measure and weekly rule</p>
        <p class="kpi-name">${nameWithTerm(m.month, kpi)}</p>
        ${ruleLine(entry.rule)}
      </div>
      ${weekBlock(m, entry)}
      <div class="v2cell wk-dayscell"><p class="v2-label">Days on track</p>${daysCell(m, entry)}</div>
      ${lastRow ? expandButton(f).replace('aria-expanded="false"', `aria-expanded="${openGroups.has(f.fn.id)}"`) : ''}
      <div class="v2cell wk-trend"><p class="v2-label">Last 4 weeks</p>${fourWeeks(m, entry)}</div>
      <div class="v2cell wk-gapcell${entry.gap.level === 'streak' || entry.gap.level === 'all' ? ' v2cell--needs' : ''}"><p class="v2-label">Repeat gap</p>${gapCell(entry)}</div>
      ${lastRow ? `<div class="v2cell wk-commentcell" id="wk-${esc(f.fn.id)}-comment"><p class="v2-label">Commentary</p>${commentCell(m, f)}</div>` : ''}
      <div class="v2cell wk-action${entry.needs ? ' v2cell--needs' : ''}"><p class="v2-label">Action</p>${actionCellWeek(m, f, entry)}</div>
    </div>`;
}

function groupMarkup(m, f) {
  const owner = { name: f.fn.owner, photo: f.fn.ownerPhoto ?? null };
  return `<li class="wk-group${openGroups.has(f.fn.id) ? ' is-open' : ''}" id="wk-${esc(f.fn.id)}" data-fn="${esc(f.fn.id)}" style="--kpis:${f.rows.length}">
      <div class="v2cell wk-fn">
        <span class="fn-icon" aria-hidden="true">${icon(DEPT_ICON[f.fn.id] ?? 'board', 'i')}</span>
        <div class="fn-text">
          <h3 class="fn-name wk-fn-name">${esc(f.fn.name)}</h3>
          <p class="wk-owner">${avatarMarkup(owner, 'avatar avatar--sm')}<span><span class="sr-only">Owner: </span>${esc(owner.name)}</span></p>
        </div>
      </div>
      ${f.rows.map((e, i) => rowCells(m, f, e, i + 1, i === f.rows.length - 1)).join('')}
    </li>`;
}

/**
 * Phones only (css/wor.css): a function keeps its status, figure and days marks in view; its last 4 weeks,
 * repeat gap, commentary and action fold behind this button (it says when an action is needed).
 */
function expandButton(f) {
  const needs = f.rows.some((e) => e.needs);
  const gap = f.rows.find((e) => e.gap.level !== 'none')?.gap ?? null;
  const flags = [
    needs ? statusMarkup(OFF, { tag: 'span', word: ACTION_WORD.needs, extra: 'wk-expand-flag' }) : '',
    gap ? `<span class="wk-expand-gap">${esc(nbDot(gap.word))}</span>` : '',
  ].filter(Boolean).join('');
  return `<button class="wk-expand" type="button" aria-expanded="false" data-wk-expand="${esc(f.fn.id)}">
      <span class="wk-expand-text">Last 4 weeks, repeat gap, commentary, action<span class="sr-only"> for ${esc(f.fn.name)}</span></span>
      ${flags ? `<span class="wk-expand-flags">${flags}</span>` : ''}
    </button>`;
}

function boardKey(m) {
  return `<div class="board2-foot wk-foot">
      <p class="b2-brand">LinkedXL OS<span class="b2-sep" aria-hidden="true">&nbsp;·</span> <span class="b2-tagline">Weekly results from the daily numbers, by each KPI's weekly rule</span></p>
      <ul class="b2-key" aria-label="Key">
        <li><svg class="glyph b2-key-on" aria-hidden="true" focusable="false"><use href="#g-on"></use></svg>On track</li>
        <li><svg class="glyph b2-key-off" aria-hidden="true" focusable="false"><use href="#g-off"></use></svg>Off goal</li>
        <li><svg class="glyph b2-key-na" aria-hidden="true" focusable="false"><use href="#g-missing"></use></svg>Not entered</li>
        <li><svg class="glyph b2-key-na" aria-hidden="true" focusable="false"><use href="#g-nogoal"></use></svg>Goal varies or not set</li>
      </ul>
      <p class="b2-updated">${cloud.here('Calculated just now from data saved on this device. View calculation shows each rule and its version.')}</p>
    </div>`;
}

function measuresMarkup(m) {
  // A pilot board has one measure per function, so this section would repeat the daily measure.
  if (!m.measures.length || cloud.BOARD) return '';
  const rows = m.measures.map((x) => {
    const r = x.result;
    const kpi = x.row.kpiDaily;
    const how = r.overridden
      ? `Override by ${esc(r.override.approver || 'no name')}: ${esc(r.override.reason)}`
      : r.effective !== null
        ? `Weekly value${x.result && m.saved.inputs[x.key]?.weekly?.by ? `, entered by ${esc(m.saved.inputs[x.key].weekly.by)}` : ''}`
        : 'Weekly value · not entered yet';
    return `<li class="wk-mrow" data-key="${esc(x.key)}">
        <div class="v2cell wk-mfn"><span class="fn-icon fn-icon--sm" aria-hidden="true">${icon(DEPT_ICON[x.fn.id] ?? 'board', 'i')}</span><span class="wk-mfn-name">${esc(x.fn.name)}</span></div>
        <div class="v2cell wk-mkpi">
          <p class="v2-label">Measure</p>
          <p class="kpi-name">${nameWithTerm(m.month, kpi)}</p>
          ${ruleLine('weekly-only')}
          <p class="wk-mgoal">${esc(monthGoalLine(kpi, x.monthGoal))} · no weekly goal set</p>
        </div>
        ${weekBlock(m, x, { compact: true })}
        <div class="v2cell wk-mmode"><p class="v2-label">How it's set</p><p class="wk-mode">${how}</p></div>
        <div class="v2cell wk-menter"><button class="btn btn--secondary wk-enter" type="button" data-calc="${esc(x.key)}" data-calc-focus="entry">${r.effective === null ? 'Enter' : 'Change'}<span class="sr-only"> ${esc(plainLabel(kpi))} for the week</span></button></div>
      </li>`;
  }).join('');
  return `<section class="wk-more" aria-labelledby="wk-more-title">
      <h2 class="wk-h2" id="wk-more-title">More weekly measures</h2>
      <p class="wk-h2-sub">The broader weekly set. Each is measured once a week, not added up from the daily board, and entering one never changes a daily number.</p>
      <div class="wk-mboard">
        <div class="board2-head wk-mhead" aria-hidden="true">
          <span class="h2c h2c--fn">Function</span><span class="h2c">Measure<small>and weekly rule</small></span><span class="h2c">This week<small>${esc(weekLabel(m.week))}</small></span><span class="h2c">How it's set</span><span class="h2c"><span class="sr-only">Enter</span></span>
        </div>
        <ol class="wk-mrows" aria-label="More weekly measures">${rows}</ol>
      </div>
    </section>`;
}

function overviewMarkup(m) {
  return `<div class="wk-top">${summaryMarkup(m)}${readinessMarkup(m)}</div>
    <section class="wk-board" aria-labelledby="wk-board-title">
      <h2 class="sr-only" id="wk-board-title">Weekly scoreboard</h2>
      <div class="board2-head wk-head" aria-hidden="true">
        <span class="h2c h2c--fn">Function</span>
        <span class="h2c">Measure<small>and weekly rule</small></span>
        <span class="h2c">This week<small>${esc(`${dayShort(m.week.start)} – ${dayShort(m.week.end)}`)}</small></span>
        <span class="h2c">Days on track<small>Mon – Fri</small></span>
        <span class="h2c">Last 4 weeks<small>Result vs goal</small></span>
        <span class="h2c">Repeat gap</span>
        <span class="h2c">Commentary</span>
        <span class="h2c">Action</span>
      </div>
      <ol class="wk-rows" aria-label="Functions in meeting order">${m.fns.map((f) => groupMarkup(m, f)).join('')}</ol>
      ${boardKey(m)}
    </section>
    ${measuresMarkup(m)}`;
}

/* ---------- Functions ---------- */

function dorDayHref(m, day, key) {
  return pageHref(m.month, day, { view: 'dor', hash: key });
}

function functionsMarkup(m) {
  const final = latestFinal(m.doc, m.week.key);
  const sealed = final && !latestDraft(m.doc, m.week.key);
  const finalNote = final ? `<p class="wk-final-note">${statusMarkup(ON, { tag: 'span', word: `Finalized v${final.version}` })} <span>The record keeps the commentary as it was then. A change here shows on the record as "now: …"${sealed ? `, and Start a revised version (v${final.version + 1}) on the Overview carries it into a new version` : ''}.</span> <a href="#record/${esc(final.id)}">Open the record</a></p>` : '';
  return `<p class="wk-tab-intro">Each day links to that day on the DOR board. ${cloud.here('Commentary is saved on this device and never changes a number.')}</p>
    ${finalNote}
    ${m.fns.map((f) => {
    const kpis = f.rows.map((e) => {
      const kpi = e.row.kpiDaily;
      const days = e.result.days.filter((d) => d.production || d.used).map((d) => {
        const st = d.reason === 'not-reached' ? 'not-reached' : d.actual === null ? NOT_ENTERED : d.goal === null ? NO_GOAL : (e.result.marks.find((x) => x.iso === d.iso)?.status ?? NO_GOAL);
        const pair = formatPair(d.actual, d.goal, kpi);
        const glyph = st === 'not-reached' ? 'g-untracked' : GLYPH[st];
        const word = st === 'not-reached' ? 'Not reached yet' : statusWord(st, kpi);
        return `<li><a class="wf-day wf-day--${st}" href="${esc(dorDayHref(m, d.day, e.row.id))}">
            <span class="wf-day-date">${esc(dayMed(d.iso))}</span>
            <span class="wf-day-val">${esc(pair.actual ?? 'Not entered')}</span>
            <span class="wf-day-goal">${esc(pair.actual === null ? pair.rest : pair.rest || 'No goal set')}</span>
            <span class="status status--${st === 'not-reached' ? 'not-tracked' : st} wf-day-status"><svg class="glyph" aria-hidden="true" focusable="false"><use href="#${glyph}"></use></svg><span class="status-word">${esc(word)}</span></span>
          </a></li>`;
      }).join('');
      return `<div class="wf-kpi">
          <h4 class="wf-kpi-name">${esc(plainLabel(kpi))}<span class="wf-kpi-rule"> · ${esc(RULES[e.rule].name)}</span></h4>
          <div class="wf-kpi-body">
            <ol class="wf-days" aria-label="${esc(`${plainLabel(kpi)}, day by day`)}">${days}</ol>
            ${weekBlock(m, e, { compact: true })}
          </div>
        </div>`;
    }).join('');
    const c = f.commentary ?? {};
    const fields = COMMENT_FIELDS.map(([k, label]) => {
      const id = `wc-${f.fn.id}-${k}`;
      return `<div class="wf-field"><label for="${id}">${esc(label)}</label><textarea id="${id}" rows="3" data-commentary="${esc(f.fn.id)}" data-field="${k}" maxlength="4000">${esc(c[k] ?? '')}</textarea></div>`;
    }).join('');
    const savedLine = cloud.here(c.at ? `Saved on this device · ${formatEnteredAt(c.at)}` : 'Saves on this device as you type');
    return `<section class="wf" id="wf-${esc(f.fn.id)}" aria-labelledby="wf-${esc(f.fn.id)}-title">
        <header class="wf-head">
          <span class="fn-icon" aria-hidden="true">${icon(DEPT_ICON[f.fn.id] ?? 'board', 'i')}</span>
          <h3 class="wf-name" id="wf-${esc(f.fn.id)}-title">${esc(f.fn.name)}</h3>
          <p class="wf-owner">${esc(f.fn.owner)}</p>
        </header>
        ${kpis}
        <fieldset class="wf-comment">
          <legend>Commentary for the ${esc(weekOf(m.week))}</legend>
          ${dailyFromBoard(m, f)}
          <div class="wf-fields">${fields}</div>
          <p class="wf-saved" data-saved-for="${esc(f.fn.id)}" role="status">${esc(savedLine)}</p>
        </fieldset>
      </section>`;
  }).join('')}`;
}

/* ---------- Actions ---------- */

function actionItem(m, a) {
  const fn = anyFunctionById(m.month, a.fnId);
  const aging = isVerifiedAction(a) ? (a.closedDayIso ? `Verified ${dayMed(a.closedDayIso)}` : 'Verified')
    : a.status === 'cancelled' ? (a.closedDayIso ? `Cancelled ${dayMed(a.closedDayIso)}` : 'Cancelled')
      : agingWords(a, m.asOfIso) || 'Open since before this month';
  const over = isOverdueAction(a, m.asOfIso);
  return `<li class="wa-item">
      <p class="wa-text">${esc(a.text)}</p>
      <p class="wa-meta">
        <span class="wa-id">ID ${esc(String(a.id).slice(0, 8))}</span>
        <span>${esc(fn?.name ?? 'No function')}</span>
        <span>${esc(a.owner || fn?.owner || 'No owner')}</span>
        <span class="wa-status">${actionStateMarkup(a.status)}</span>
        ${a.escalation && isOpenAction(a) ? `<span class="wa-esc">Escalated to ${esc(a.escalation.to)}</span>` : ''}
        ${over ? statusMarkup(OFF, { tag: 'span', word: `Overdue: ${dueText(a.due).replace(/^Due /, 'due ')}`, extra: 'wa-over' }) : `<span>${esc(dueText(a.due))}</span>`}
        <span>${esc(aging)}</span>
      </p>
    </li>`;
}

function actionsMarkup(m) {
  const sets = actionSets(m);
  const group = (id, title, sub, list, empty) => `<section class="wa-group" aria-labelledby="wa-${id}">
      <h3 class="wa-title" id="wa-${id}">${esc(title)} <span class="wa-n">${list.length}</span></h3>
      <p class="wa-sub">${esc(sub)}</p>
      ${list.length ? `<ul class="wa-list">${list.map((a) => actionItem(m, a)).join('')}</ul>` : `<p class="wa-empty">${esc(empty)}</p>`}
    </section>`;
  const prev = previousRecord(m);
  const all = listActions();
  const commitments = prev
    ? `<p class="wa-sub">From the weekly review of ${esc(dayShort(prev.weekKey))} (${prev.state === 'finalized' ? 'finalized' : 'draft'}).</p>
       ${prev.decisions.length ? `<ul class="wa-list">${prev.decisions.map((d) => `<li class="wa-item"><p class="wa-text">${esc(d.text)}</p><p class="wa-meta"><span>Decision</span>${d.by ? `<span>${esc(d.by)}</span>` : ''}</p></li>`).join('')}</ul>` : '<p class="wa-empty">No decisions were recorded in that review.</p>'}
       ${prev.actionIds.length ? `<ul class="wa-list">${prev.actionIds.map((id) => all.find((a) => a.id === id)).filter(Boolean).map((a) => actionItem(m, a)).join('')}</ul>` : ''}`
    : '<div class="wa-calm"><p class="wa-empty">No weekly review was saved for an earlier week' + ON_DEVICE + '.</p><p class="wa-next">Once a week is reviewed, its decisions and actions show here the week after, so the room checks what it promised.</p></div>';
  // First, what the week still needs (the same response rule as the scoreboard and Finish review).
  const needs = m.fns.flatMap((f) => f.rows.filter((e) => e.needs).map((e) => ({ f, e })));
  const needsBlock = needs.length
    ? `<section class="wa-needs" aria-labelledby="wa-needs-title">
        <h3 class="wa-title" id="wa-needs-title">${statusMarkup(OFF, { tag: 'span', word: 'Needs an action this week' })} <span class="wa-n">${needs.length}</span></h3>
        <p class="wa-sub">Off goal for the week, with no next-24-hours action on the daily board and none in the Action register that still holds.</p>
        <ul class="wa-list">${needs.map(({ f, e }) => `<li class="wa-item wa-need">
            <p class="wa-text">${esc(f.fn.name)}<span class="wa-need-kpi"> · ${esc(plainLabel(e.row.kpiDaily))}</span>${e.response.lapsed.length ? `<span class="wa-lapsed">${esc(lapsedWords(e.response.lapsed[0]))}: ${esc(e.response.lapsed[0].a.text)}</span>` : ''}</p>
            <button class="btn btn--primary" type="button" data-wk-add="${esc(f.fn.id)}" data-wk-add-kpi="${esc(e.row.primary ? '' : e.row.kpiId)}">Add action<span class="sr-only"> for ${esc(f.fn.name)}</span></button>
          </li>`).join('')}</ul>
      </section>`
    : `<p class="wa-allclear">${statusMarkup(ON, { tag: 'span', word: 'Nothing off goal for the week is waiting for an action.' })}</p>`;
  return `<div class="wa-head">
      <p class="wk-tab-intro">The Action register for the ${esc(weekOf(m.week))}, by action ID. Changes are made in the register, so it stays one list.</p>
      <button class="btn btn--secondary" type="button" data-open-actions>Open the Action register</button>
    </div>
    ${needsBlock}
    <div class="wa-grid">
      ${group('carried', 'Carried in', `Opened before ${dayMed(m.week.start)} and still open then.`, sets.carried, 'Nothing was open before this week.')}
      ${group('opened', 'Opened this week', `Added for ${dayShort(m.week.start)} to ${dayShort(m.week.end)}.`, sets.opened, 'No action was added this week. Add one from the scoreboard\'s Action column.')}
      ${group('next', 'Due next week', `Due ${dayShort(sets.nextStart)} to ${dayShort(sets.nextEnd)}, not done.`, sets.dueNext, 'Nothing is due next week.')}
      ${group('overdue', 'Overdue', `Past due on ${dayMed(m.asOfIso)} and not done.`, sets.overdue, 'Nothing is overdue.')}
    </div>
    <section class="wa-group wa-prev" aria-labelledby="wa-prev">
      <h3 class="wa-title" id="wa-prev">The previous review's commitments</h3>
      ${commitments}
    </section>`;
}

/* ---------- Meeting records ---------- */

/** A finalized (or draft) record against today's numbers: what changed since it was saved. */
function revisions(m, rec) {
  if (rec.weekKey !== m.week.key) return liveRevisions(m, rec);
  const live = new Map(snapshotResults(m).map((x) => [x.key, x]));
  return compareResults(rec, live);
}

function compareResults(rec, live) {
  const out = [];
  const close = (a, b) => (a === null && b === null) || (isNum(a) && isNum(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));
  for (const x of rec.results) {
    const now = live.get(x.key);
    if (!now) continue;
    const kpi = { unit: x.unit, better: x.better };
    if (!close(x.effective, now.effective) || !close(x.goal, now.goal) || x.status !== now.status) {
      const was = weeklyPair(x.effective, null, kpi, x.rule).actual ?? 'not entered';
      const is = weeklyPair(now.effective, null, kpi, now.rule).actual ?? 'not entered';
      out.push(`${x.fnName}, ${x.kpiName}: ${was} then, ${is} now`);
    } else if (!close(x.raw, now.raw)) {
      // Under an override the effective value can stay put while the days under it change: still a revision.
      const was = weeklyPair(x.raw, null, kpi, x.rule).actual ?? 'not entered';
      const is = weeklyPair(now.raw, null, kpi, now.rule).actual ?? 'not entered';
      out.push(`${x.fnName}, ${x.kpiName}: calculated ${was} then, ${is} now${now.overridden ? ' (under the override)' : ''}`);
    } else if (Boolean(x.provisional) !== Boolean(now.provisional) || (Number.isInteger(x.received) && x.received !== now.received)) {
      out.push(`${x.fnName}, ${x.kpiName}: ${now.received} of ${now.expected} days in now, ${x.received} then`);
    }
  }
  return out;
}

/** A record of another week: its numbers against that week's live calculation. */
function liveRevisions(m, rec) {
  const week = m.weeks.find((w) => w.key === rec.weekKey);
  if (!week) return [];
  const sub = buildModel(m.month, lastProductionDay(week), week.key);
  return sub ? compareResults(rec, new Map(snapshotResults(sub).map((x) => [x.key, x]))) : [];
}

function snapshotResults(m) {
  const out = [];
  for (const f of m.fns) {
    for (const e of f.rows) {
      const r = e.result;
      out.push({
        key: e.key, fnId: f.fn.id, fnName: f.fn.name, owner: f.fn.owner, kpiName: plainLabel(e.row.kpiDaily),
        unit: e.row.kpiDaily.unit, better: e.row.kpiDaily.better, rule: e.rule,
        raw: r.raw, effective: r.effective, goal: r.goalVaries ? null : r.goal, goalVaries: r.goalVaries,
        status: r.status, expected: r.expected, received: r.received, provisional: r.provisional,
        overridden: r.overridden, met: r.met, missed: r.missed, gap: e.gap.long ?? e.gap.word,
      });
    }
  }
  for (const x of m.measures) {
    const r = x.result;
    out.push({
      key: x.key, fnId: x.fn.id, fnName: x.fn.name, owner: x.fn.owner, kpiName: plainLabel(x.row.kpiDaily),
      unit: x.row.kpiDaily.unit, better: x.row.kpiDaily.better, rule: 'weekly-only',
      raw: r.raw, effective: r.effective, goal: null, goalVaries: false, status: r.status,
      expected: r.expected, received: r.received, provisional: false, overridden: r.overridden, met: 0, missed: 0, gap: '',
    });
  }
  return out;
}

function recordRow(m, rec) {
  const rev = revisions(m, rec);
  const finalized = rec.state === 'finalized';
  const replaced = replacementOf(m.doc, rec);
  const state = replaced ? `Replaced by v${replaced.version}` : finalized ? 'Finalized' : rec.basedOn ? 'Revised version, draft' : 'Draft';
  const notes = rec.amendments.length;
  const flag = rev.length ? `<p class="wr-flag">${statusMarkup(OFF, { tag: 'span', word: finalized ? 'Source revised' : 'Numbers changed since it was prepared' })}<span class="wr-flag-detail"> ${esc(rev.slice(0, 2).join('; '))}${rev.length > 2 ? `; ${rev.length - 2} more` : ''}</span></p>` : '';
  return `<li class="wr-item" data-record="${esc(rec.id)}">
      <span class="wr-type">WOR</span>
      <div class="wr-main">
        <h3 class="wr-title">Weekly review, ${esc(weekOf({ start: rec.weekStart }))}</h3>
        <p class="wr-meta"><span class="wr-state wr-state--${replaced ? 'replaced' : rec.state}">${esc(state)}</span><span>Reviews ${esc(`${dayMed(rec.weekStart)} – ${rec.weekEnd ? dayLong(rec.weekEnd) : ''}`)}</span><span>${esc(finalized && rec.finalizedAt ? `Finalized ${formatStamp(rec.finalizedAt)}${rec.finalizedBy ? ` by ${rec.finalizedBy}` : ''}` : `Prepared ${formatStamp(rec.updatedAt ?? rec.createdAt)}`)}</span><span>${rec.attendees.length} ${rec.attendees.length === 1 ? 'attendee' : 'attendees'}</span><span>${rec.decisions.length} ${rec.decisions.length === 1 ? 'decision' : 'decisions'}</span>${rec.exceptions.length ? `<span>${rec.exceptions.length} ${rec.exceptions.length === 1 ? 'exception' : 'exceptions'}</span>` : ''}${notes ? `<span>${esc(notesWords(notes))}</span>` : ''}<span>Version ${rec.version}</span></p>
        ${flag}
      </div>
      <div class="wr-tools">
        ${finalized ? '' : `<button class="btn btn--primary" type="button" data-finish="${esc(rec.weekKey)}">Finish review<span class="sr-only"> for the week of ${esc(dayShort(rec.weekStart))}</span></button>`}
        <button class="btn btn--secondary" type="button" data-record-open="${esc(rec.id)}">Open<span class="sr-only"> the weekly review of ${esc(dayShort(rec.weekStart))}</span></button>
        <button class="btn btn--text" type="button" data-record-csv="${esc(rec.id)}">Export CSV</button>
        <button class="btn btn--text" type="button" data-record-print="${esc(rec.id)}">Print</button>
      </div>
    </li>`;
}

function minutesRow(min) {
  const day = min.dayIso && isNum(isoTime(min.dayIso)) ? dayMed(min.dayIso) : 'a day';
  const mins = Math.max(1, Math.round((min.durationSec ?? 0) / 60));
  return `<li class="wr-item" data-minutes="${esc(min.id)}">
      <span class="wr-type wr-type--dor">DOR</span>
      <div class="wr-main">
        <h3 class="wr-title">Daily meeting, ${esc(day)}</h3>
        <p class="wr-meta"><span class="wr-state wr-state--${min.state === 'finalized' ? 'finalized' : 'draft'}">${min.state === 'finalized' ? 'Finalized' : 'Draft'}</span><span>${esc(min.startedAt ? `Held ${formatStamp(min.startedAt)}` : cloud.here('Saved on this device'))}</span><span>${mins} min</span><span>${min.actions.length} ${min.actions.length === 1 ? 'action' : 'actions'}</span>${min.recorded ? '<span>Recorded</span>' : ''}</p>
      </div>
      <div class="wr-tools">
        <button class="btn btn--secondary" type="button" data-minutes-open="${esc(min.id)}">Open<span class="sr-only"> the minutes of ${esc(day)}</span></button>
        <button class="btn btn--text" type="button" data-minutes-csv="${esc(min.id)}">Export CSV</button>
      </div>
    </li>`;
}

function recordsMarkup(m) {
  const recs = m.doc.records.slice().sort((a, b) => b.weekKey.localeCompare(a.weekKey) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  let minutes = [];
  try { minutes = listMinutes(); } catch { minutes = []; }
  const thisWeek = recs.some((r) => r.weekKey === m.week.key);
  const open = !latestFinal(m.doc, m.week.key) || latestDraft(m.doc, m.week.key);
  return `<div class="wa-head">
      <p class="wk-tab-intro">Weekly reviews and the daily meetings' minutes, each a Draft until it's finalized. A finalized record never changes: a note can be added to it (with its author and reason), and a change to a weekly review goes into a revised version (v2) that replaces it once it's finalized. ${cloud.here('Saved on this device;')} the connected version keeps them in LinkedXL OS Governance.</p>
      <div class="wr-head-tools">
        ${thisWeek ? '' : `<button class="btn btn--secondary" type="button" data-prepare>Save a review draft for the ${esc(weekOf(m.week))}</button>`}
        ${open ? `<button class="btn btn--primary" type="button" data-finish="${esc(m.week.key)}">Finish review for the ${esc(weekOf(m.week))}</button>` : ''}
      </div>
    </div>
    <section class="wa-group" aria-labelledby="wr-wor">
      <h3 class="wa-title" id="wr-wor">Weekly reviews <span class="wa-n">${recs.length}</span></h3>
      ${recs.length ? `<ul class="wr-list">${recs.map((r) => recordRow(m, r)).join('')}</ul>` : `<div class="wa-calm"><p class="wa-empty">No weekly review is saved for this month yet.</p><p class="wa-next">Save review draft (top right) keeps this week's numbers, readiness and participants as a draft record; the weekly meeting and Finish review finalize it.</p></div>`}
    </section>
    <section class="wa-group" aria-labelledby="wr-dor">
      <h3 class="wa-title" id="wr-dor">Daily meetings <span class="wa-n">${minutes.length}</span></h3>
      ${minutes.length ? `<ul class="wr-list">${minutes.map(minutesRow).join('')}</ul>` : '<div class="wa-calm"><p class="wa-empty">No daily meeting minutes saved' + ON_DEVICE + ' yet.</p><p class="wa-next">Run daily meeting on the DOR board saves its minutes here when it ends.</p></div>'}
    </section>`;
}

/* ---------- The page ---------- */

function headMarkup(m) {
  const final = latestFinal(m.doc, m.week.key);
  const sealed = final && !latestDraft(m.doc, m.week.key);
  // A finalized week's main button opens its record; a new version is the explicit Start a revised version (its card).
  const primary = sealed
    ? `<button class="btn btn--mint" type="button" data-record-open="${esc(final.id)}">Open finalized record</button>`
    : '<button class="btn btn--mint" type="button" data-prepare title="Saves this week\'s numbers, readiness and participants as the meeting\'s draft record">Save review draft</button>';
  const options = m.weeks.map((w) => `<option value="${esc(w.key)}"${w === m.week ? ' selected' : ''}>${esc(weekLabel(w))}</option>`).join('');
  // A pilot board steps across months, from the first day's week through this week.
  const { min, max } = dateBounds(m.month);
  const own = m.week.days.filter((d) => d.day !== null);
  const first = m.idx === 0 && !(cloud.BOARD && own[0]?.iso > min);
  const lastWeek = m.idx === m.weeks.length - 1 && !(cloud.BOARD && own[own.length - 1]?.iso < max);
  const step = (dir, label, glyph, off) => `<button class="icon-btn wk-step period-step" type="button" data-wk-step="${dir}" aria-label="${label}"${off ? ' aria-disabled="true"' : ''}><svg class="icon" aria-hidden="true" focusable="false"><use href="#${glyph}"></use></svg></button>`;
  // The same period control as Home's and the DOR board's day (css/header.css): ‹, the week, ›, joined.
  return `<nav class="wk-nav period" aria-label="Week">
      ${step(-1, 'Previous week', 'g-prev', first)}
      <label class="wk-pick"><span class="sr-only">Week</span><select class="wk-select period-label" data-wk-select>${options}</select></label>
      ${step(1, 'Next week', 'g-next', lastWeek)}
    </nav>
    <div class="wk-actions pg-actions">
      ${primary}
      <button class="btn btn--outline-light" type="button" data-run-meeting data-weekly-meeting>Run weekly meeting</button>
    </div>`;
}

const currentTab = () => {
  const t = new URLSearchParams(location.search).get('tab');
  return TABS.some(([id]) => id === t) ? t : 'overview';
};

function pageMarkup(m) {
  const tab = currentTab();
  const tabs = TABS.map(([id, label]) => `<button class="wk-tab" type="button" role="tab" id="wk-tab-${id}" aria-controls="wk-panel-${id}" aria-selected="${id === tab}" tabindex="${id === tab ? 0 : -1}" data-wk-tab="${id}">${esc(label)}</button>`).join('');
  const panel = (id, body) => `<div class="wk-panel" role="tabpanel" id="wk-panel-${id}" aria-labelledby="wk-tab-${id}" tabindex="0"${id === tab ? '' : ' hidden'}>${body}</div>`;
  const split = splitWeekNote(m.week);
  return `<p class="date-note" data-wk-note role="status" hidden></p>
    ${split ? `<p class="date-note wk-split" data-wk-split>${esc(split)}</p>` : ''}
    <div class="wk-tabs" role="tablist" aria-label="Weekly review">${tabs}</div>
    ${panel('overview', overviewMarkup(m))}
    ${panel('functions', functionsMarkup(m))}
    ${panel('actions', actionsMarkup(m))}
    ${panel('records', recordsMarkup(m))}`;
}

/** Which control had focus (and where its cursor was), so a redraw can put it back. */
function focusKey() {
  const a = document.activeElement;
  const page = document.querySelector('.page-app[data-page="wor"]');
  if (!a || !page?.contains(a)) return null;
  const attr = a.id ? ['id', a.id] : [...a.attributes].map((x) => [x.name, x.value]).find(([n]) => n.startsWith('data-'));
  if (!attr) return null;
  const sel = attr[0] === 'id' ? `#${CSS.escape(attr[1])}` : `[${attr[0]}="${CSS.escape(attr[1])}"]`;
  return { sel, start: a.selectionStart ?? null, end: a.selectionEnd ?? null };
}
function restoreFocus(k) {
  if (!k) return;
  const el = document.querySelector(`.page-app[data-page="wor"] ${k.sel}`);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (k.start !== null && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(k.start, k.end); } catch { /* not a text box */ } }
}

export function renderWor(month, day) {
  const host = document.querySelector('[data-wor]');
  if (!host) return;
  const m = buildModel(month, day);
  if (!m) { host.innerHTML = '<p class="wk-empty">No production weeks in this month\'s data.</p>'; return; }
  last = m;
  setNavState({ week: m.week.key });
  const keep = focusKey();
  // The header says what every page's header says (the plant); the week's exact boundaries, time zone and
  // production days are in the scope line under it (shell.js), with the rest of the page's scope.
  document.querySelectorAll('[data-wor-sub]').forEach((n) => { n.textContent = `${plantName(month)} · LinkedXL OS`; });
  const head = document.querySelector('[data-wor-head]');
  if (head) head.innerHTML = headMarkup(m);
  host.innerHTML = pageMarkup(m);
  restoreFocus(keep);
  fitWorText();
  // Opened from a function's link (#wf-people): that function's section, once.
  const want = location.hash.match(/^#wf-([\w-]+)$/)?.[1];
  if (want && !shownFnHash) {
    shownFnHash = true;
    requestAnimationFrame(() => document.getElementById(`wf-${want}`)?.scrollIntoView({ block: 'start' }));
  }
  document.documentElement.dataset.ready = 'true';
}
let shownFnHash = false;
/** Functions opened on a phone (their folded detail stays open when the page redraws). */
const openGroups = new Set();

/** Redraw one panel in place (the commentary saves, so the box being typed in stays as it is). */
function redrawPanel(id) {
  if (!last || !ctx) return;
  const m = buildModel(ctx.getMonth(), ctx.getDay());
  if (!m) return;
  last = m;
  const panel = document.getElementById(`wk-panel-${id}`);
  if (!panel) return;
  const keep = focusKey();
  panel.innerHTML = id === 'overview' ? overviewMarkup(m) : id === 'actions' ? actionsMarkup(m) : id === 'records' ? recordsMarkup(m) : functionsMarkup(m);
  restoreFocus(keep);
  fitWorText();
}

/* ---------- Words that fit their cells ---------- */

/** Clamped words on this page (each ends on one clean "…": board.js fitClampedText). */
const WOR_CLAMPED = '.wk-comment, .wk-daily-line';

/**
 * A function's name on the scoreboard is never cut ("MAINTENANC"): Big Shoulders is already condensed and
 * a name is one word, so when the widest name passes its cell, every name on the board steps down together
 * (they stay one size, like the board's signage), to 0.7 of the size at the least; below that a name may
 * wrap. Measured at the cell's room (the cell less its icon), on the shown tab only.
 */
function fitFnNames(scope) {
  const names = [...scope.querySelectorAll('.wk-board .wk-fn-name')];
  names.forEach((n) => { n.style.fontSize = ''; });
  const shown = names.filter((n) => n.getClientRects().length);
  if (!shown.length) return;
  const range = document.createRange();
  const need = (el) => { range.selectNodeContents(el); return range.getBoundingClientRect().width; };
  const room = (el) => {
    const cell = el.closest('.wk-fn');
    const cs = getComputedStyle(cell);
    // The icon takes room beside the name, unless it sits over it (the compact table).
    const iconW = cs.flexDirection === 'column' ? 0 : cell.querySelector('.fn-icon')?.getBoundingClientRect().width ?? 0;
    return cell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - iconW - (iconW ? parseFloat(cs.columnGap) || 0 : 0);
  };
  const ratio = Math.min(1, ...shown.map((el) => room(el) / need(el)));
  if (ratio >= 1) return;
  const base = parseFloat(getComputedStyle(shown[0]).fontSize);
  const size = Math.max(base * 0.7, Math.floor(base * ratio * 0.98 * 4) / 4);
  names.forEach((n) => { n.style.fontSize = `${size}px`; });
}

/** After a render, a redraw, a tab change or a resize: names fit, and clamps end cleanly. */
export function fitWorText() {
  const host = document.querySelector('[data-wor]');
  if (!host) return;
  fitFnNames(host);
  const panel = host.querySelector('.wk-panel:not([hidden])');
  if (panel) fitClampedText(panel, WOR_CLAMPED);
}
let worFitTimer = 0;
if (typeof window !== 'undefined') {
  const refit = () => { clearTimeout(worFitTimer); worFitTimer = setTimeout(fitWorText, 150); };
  window.addEventListener('resize', refit);
  document.fonts?.addEventListener?.('loadingdone', refit);
}

/* ---------- Tabs (ARIA tabs: arrows, Home and End move and select) ---------- */

/**
 * Show a tab. A person's choice (push) adds a history entry, so Back returns to the tab they came from;
 * a tab chosen for them (Go to it, a sidebar link) or read back from the URL (Back) replaces it.
 */
function selectTab(id, { focus = false, push = false } = {}) {
  if (!TABS.some(([t]) => t === id)) return;
  const was = currentTab();
  document.querySelectorAll('[data-wk-tab]').forEach((b) => {
    const on = b.dataset.wkTab === id;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('.wk-panel').forEach((p) => { p.hidden = p.id !== `wk-panel-${id}`; });
  if (id !== was) fitWorText();
  const params = new URLSearchParams(location.search);
  if (id === 'overview') params.delete('tab'); else params.set('tab', id);
  const url = `${location.pathname}?${params}${location.hash}`;
  if (push && id !== was) history.pushState(history.state, '', url);
  else history.replaceState(history.state, '', url);
  if (focus) document.getElementById(`wk-tab-${id}`)?.focus();
}

/** Back or Forward changed ?tab=: show that tab (app.js calls this after every route change on this page). */
export function syncWorTab() {
  const want = currentTab();
  const shownNow = document.querySelector('[data-wk-tab][aria-selected="true"]')?.dataset.wkTab;
  if (shownNow && shownNow !== want) selectTab(want);
}

/** One function in the week: the Functions tab, scrolled to its section, focus on its name. */
function showFunction(fnId) {
  selectTab('functions', { push: true });
  const sec = document.getElementById(`wf-${fnId}`);
  const title = document.getElementById(`wf-${fnId}-title`);
  if (!sec) return;
  history.replaceState(history.state, '', `${location.pathname}${location.search}#wf-${fnId}`);
  sec.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
}

/** A quiet note under the tabs (a week or a record a link asked for that isn't here), as the board's date note. */
export function sayWorNote(text) {
  const note = document.querySelector('[data-wk-note]');
  if (!note) return;
  note.textContent = text ?? '';
  note.hidden = !text;
}

/* ---------- Saving: commentary, participants, Prepare review ---------- */

let commentTimer = 0;
let pendingComment = null; // the box whose typing waits to be saved
function saveCommentary(el, { quiet = false } = {}) {
  commentTimer = 0;
  if (!last) return;
  const fnId = el.dataset.commentary;
  const field = el.dataset.field;
  const value = el.value;
  const { ok } = editWeekly(last.week.key, (doc, w) => {
    const c = w.commentary[fnId] ?? { happened: '', expected: '', risks: '', at: null };
    c[field] = value;
    c.at = new Date().toISOString();
    w.commentary[fnId] = c;
  });
  const line = document.querySelector(`[data-saved-for="${CSS.escape(fnId)}"]`);
  if (line) line.textContent = ok ? cloud.here(`Saved on this device · ${formatEnteredAt(new Date().toISOString())}`) : "Kept for this visit. This browser isn't saving.";
  if (!quiet) redrawPanel('overview');
}

function saveParticipant(el) {
  if (!last) return;
  const id = el.dataset.participant;
  editWeekly(last.week.key, (doc, w) => {
    const set = new Set(w.participants);
    if (el.checked) set.add(id); else set.delete(id);
    w.participants = [...set];
  });
  const details = el.closest('details');
  const wasOpen = details?.open;
  redrawPanel('overview');
  if (wasOpen) document.querySelector('.wk-people')?.setAttribute('open', '');
  document.querySelector(`[data-participant="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
}

const newId = (p = 'wor') => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** What a record keeps of the week: its numbers, readiness, attendees and the actions by id. */
function snapshotOf(m) {
  const sets = actionSets(m);
  return {
    weekKey: m.week.key,
    weekStart: m.week.start,
    weekEnd: m.week.end,
    asOfIso: m.asOfIso,
    calcVersion: CALC_VERSION,
    attendees: m.saved.participants,
    actionIds: [...new Set([...sets.carried, ...sets.opened].map((a) => a.id))],
    summary: m.summary.text,
    results: snapshotResults(m),
    readiness: m.readiness.map((x) => ({ id: x.id, done: x.done, text: `${x.title}: ${x.text}` })),
    nextReviewDate: addDays(m.week.end, 1),
    commentary: commentarySnapshot(m),
  };
}

/** Each function's three commentary fields as they stand: { fnId: { happened, expected, risks } }, written ones only. */
function commentarySnapshot(m) {
  const out = {};
  for (const f of m.fns) {
    const c = f.commentary ?? {};
    const fields = Object.fromEntries(COMMENT_FIELDS.map(([k]) => [k, String(c[k] ?? '').trim()]));
    if (Object.values(fields).some(Boolean)) out[f.fn.id] = fields;
  }
  return out;
}

const byNewest = (a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt)) || b.version - a.version;

/** The week's draft record (the newest), or null. */
export const latestDraft = (doc, weekKey) => doc.records.filter((r) => r.weekKey === weekKey && r.state === 'draft').sort(byNewest)[0] ?? null;
/** The week's newest finalized record, or null. */
export const latestFinal = (doc, weekKey) => doc.records.filter((r) => r.weekKey === weekKey && r.state === 'finalized').sort(byNewest)[0] ?? null;

/**
 * The week's draft inside an editWeekly change: the one there is, or a new one with the week's numbers.
 * After the week was finalized, a new draft carries changes on (its version continues; basedOn names it).
 * -> { draft, created }
 */
function ensureDraftIn(doc, m, now) {
  const have = latestDraft(doc, m.week.key);
  if (have) return { draft: have, created: false };
  const week = doc.records.filter((r) => r.weekKey === m.week.key);
  const draft = {
    id: newId(), type: 'WOR', state: 'draft', createdAt: now, updatedAt: now, finalizedAt: null, finalizedBy: null,
    version: week.reduce((n, r) => Math.max(n, r.version), 0) + 1,
    facilitator: null, decisions: [], amendments: [], escalations: [], exceptions: [], exceptionNote: '', meeting: null,
    basedOn: latestFinal(doc, m.week.key)?.id ?? null,
    ...snapshotOf(m),
  };
  doc.records.push(draft);
  return { draft, created: true };
}

/** Save review draft (the spec's Prepare Review): check readiness and save (or refresh) the week's draft record. */
function prepare({ amend = false } = {}) {
  if (!ctx) return;
  const m = buildModel(ctx.getMonth(), ctx.getDay());
  if (!m) return;
  const final = latestFinal(m.doc, m.week.key);
  // A finalized week starts a new version only when someone asks for a revised version.
  if (final && !latestDraft(m.doc, m.week.key) && !amend) { ctx.navigate(`record/${final.id}`); return; }
  const now = new Date().toISOString();
  let refreshed = false;
  let afterFinal = false;
  let recId = null;
  let version = 0;
  const { ok } = editWeekly(m.week.key, (doc, w) => {
    w.preparedAt = now;
    const { draft, created } = ensureDraftIn(doc, m, now);
    afterFinal = created && Boolean(draft.basedOn);
    if (!created) {
      // The draft's decisions, escalations and meeting stay; its numbers and readiness are refreshed.
      // Same draft, same version: the version moves only when a new record starts (a revised version).
      Object.assign(draft, snapshotOf(m), { updatedAt: now });
      refreshed = true;
    }
    recId = draft.id;
    version = draft.version;
  });
  ctx.refresh();
  const open = m.readiness.filter((x) => !x.done).length;
  const ready = open ? `${open} readiness ${open === 1 ? 'item is' : 'items are'} still open.` : 'Everything on the readiness list is done.';
  const what = afterFinal ? `Revised version v${version} started for the ${weekOf(m.week)}, as a draft. Finalized v${final?.version ?? version - 1} stays the week's record until Finish review finalizes v${version}.`
    : `${refreshed ? 'Draft updated' : 'Draft saved'} for the ${weekOf(m.week)}: version ${version}, in Meeting records.`;
  ctx.toast(`${what} ${ready}${ok ? '' : " This browser isn't saving, so it lasts until the page reloads."}`, {
    actionLabel: 'Open draft',
    onAction: () => { if (recId) ctx.navigate(`record/${recId}`); },
  });
  // The result shows where the button was pressed: the readiness line says when the draft was saved, briefly washed.
  if (currentTab() === 'overview') {
    const card = document.getElementById('wk-ready');
    card?.querySelector('.wk-ready-head')?.classList.add('is-flash');
    card?.focus({ preventScroll: false });
  }
}

/* ---------- Decisions, escalations and the meeting, saved to the week's draft as they happen ---------- */

const DECISION_DRAFT_KEY = 'dor.worDecisionDraft.v1';
/** A decision typed but not saved yet (Finish review asks about it). */
export function readDecisionDraft(weekKey) {
  try {
    const d = JSON.parse(sessionStorage.getItem(DECISION_DRAFT_KEY) ?? 'null');
    return d && d.weekKey === weekKey && typeof d.text === 'string' ? d.text : '';
  } catch { return ''; }
}
export function writeDecisionDraft(weekKey, text) {
  try {
    if (String(text ?? '').trim()) sessionStorage.setItem(DECISION_DRAFT_KEY, JSON.stringify({ weekKey, text }));
    else sessionStorage.removeItem(DECISION_DRAFT_KEY);
  } catch { /* this visit only */ }
}

/**
 * Finish review's "Why finalize with N items open" note, by week (sessionStorage, as a typed decision is):
 * written as it's typed and when the page goes away, back in its box when Finish review opens again,
 * cleared when the week is finalized.
 */
const FINISH_NOTE_KEY = 'dor.worFinishNote.v1';
function readFinishNote(weekKey) {
  try {
    const d = JSON.parse(sessionStorage.getItem(FINISH_NOTE_KEY) ?? 'null');
    return d && d.weekKey === weekKey && typeof d.text === 'string' ? d.text : '';
  } catch { return ''; }
}
function writeFinishNote(weekKey, text) {
  try {
    if (weekKey && String(text ?? '').trim()) sessionStorage.setItem(FINISH_NOTE_KEY, JSON.stringify({ weekKey, text }));
    else sessionStorage.removeItem(FINISH_NOTE_KEY);
  } catch { /* this visit only */ }
}

/** Save a decision (or next-week priority) to the week's draft record at once. -> { ok, count } */
export function addDecision(month, day, weekKey, text, context = '') {
  const words = String(text ?? '').trim();
  const m = buildModel(month, day, weekKey);
  if (!words || !m) return { ok: false, count: 0 };
  const now = new Date().toISOString();
  const by = actorWords(month);
  let count = 0;
  const { ok } = editWeekly(m.week.key, (doc) => {
    const { draft } = ensureDraftIn(doc, m, now);
    draft.decisions.push({ id: newId('d'), text: words.slice(0, 2000), by, at: now, context });
    draft.updatedAt = now;
    count = draft.decisions.length;
  });
  writeDecisionDraft(m.week.key, '');
  return { ok, count };
}

/** People who may finalize: Administrators and Facilitators (roles are a demo here). */
export const finalizers = (org) => org.people.filter((p) => p.name.trim() && (p.roles.includes('admin') || p.roles.includes('facilitator')));

/**
 * Escalate a gap (spec §7, §12): flags the KPI's first open action escalated (it keeps its state) and
 * records the escalation on the week's draft, with or without an action. -> { ok, to, actionId, error? }
 */
export function addEscalation(month, day, weekKey, { fnId, kpiId = null, label, to, reason }) {
  const why = String(reason ?? '').trim();
  if (!why) return { ok: false, error: 'Say why it needs escalating.' };
  const m = buildModel(month, day, weekKey);
  if (!m) return { ok: false, error: 'No week to record it in.' };
  const who = String(to ?? '').trim() || accountableName(m, fnId) || 'the accountable leader';
  const open = listActions().filter((a) => a.fnId === fnId && (a.kpiId ?? null) === (kpiId ?? null) && isOpenAction(a))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  let actionId = null;
  if (open.length) {
    const r = escalateAction(open[0].id, { to: who, reason: why });
    if (r.ok) actionId = open[0].id;
  }
  const now = new Date().toISOString();
  const by = actorWords(month);
  const { ok } = editWeekly(m.week.key, (doc) => {
    const { draft } = ensureDraftIn(doc, m, now);
    draft.escalations.push({ id: newId('e'), fnId, label, actionId, to: who, reason: why, by, at: now });
    if (actionId) draft.actionIds = [...new Set([...draft.actionIds, actionId])];
    draft.updatedAt = now;
  });
  return { ok, to: who, actionId };
}

/** The function's accountable leader's name ('' when nobody is set). */
function accountableName(m, fnId) {
  const pid = m.org.functions?.[fnId]?.accountable;
  return m.org.people.find((p) => p.id === pid)?.name?.trim() ?? '';
}

/**
 * The weekly meeting ended (js/recorder.js): its times, whether it was recorded, its transcript and the
 * actions assigned in it go onto the week's draft record (recording stays optional).
 */
export function attachMeetingSession(month, day, weekKey, summary) {
  const m = buildModel(month, day, weekKey);
  if (!m || !summary) return { ok: false };
  const now = new Date().toISOString();
  return editWeekly(m.week.key, (doc) => {
    const { draft } = ensureDraftIn(doc, m, now);
    const was = draft.meeting;
    draft.meeting = {
      startedAt: was?.startedAt ?? summary.startedAt,
      endedAt: summary.endedAt,
      durationSec: (was?.durationSec ?? 0) + (summary.durationSec ?? 0),
      recorded: Boolean(was?.recorded || summary.recorded),
      transcript: [...(was?.transcript ?? []), ...(summary.transcript ?? [])],
    };
    draft.actionIds = [...new Set([...draft.actionIds, ...(summary.actionIds ?? [])])];
    draft.updatedAt = now;
  });
}

/* ---------- Finish review (spec §7) ---------- */

const clip = (t, n = 80) => (t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t);

/**
 * What still stands between this week and a finalized record, in plain words, each with where to fix it:
 * no decision recorded, a typed decision not saved, an off-goal week result with no action responding.
 * -> [{ id, text, go }]   go: 'decision' | 'functions' | 'row:<fnId>:<kpiKey>'
 */
export function finishItems(m) {
  const items = [];
  const draft = latestDraft(m.doc, m.week.key);
  const typed = readDecisionDraft(m.week.key);
  if (!draft?.decisions.length) items.push({ id: 'decisions', text: 'No decision is recorded for this review yet.', go: 'decision' });
  if (typed.trim()) items.push({ id: 'unsaved', text: `A typed decision isn't saved yet: "${clip(typed.trim())}"`, go: 'decision' });
  if (commentTimer) items.push({ id: 'commentary', text: 'Commentary is still being saved.', go: 'functions' });
  for (const f of m.fns) {
    for (const r of f.rows) {
      if (r.needs) {
        items.push({ id: `response:${r.key}`, text: `${f.fn.name}, ${plainLabel(r.row.kpiDaily)}: off goal for the week, and no action responds to it.`, go: `row:${f.fn.id}:${r.row.primary ? '' : r.row.kpiId}` });
      }
    }
  }
  return items;
}

/**
 * Finalize the week (spec §7, §13): the draft becomes a Finalized record with the week's snapshot,
 * attendees, decisions, action ids, escalations, the next review date and a new version. Open items
 * are allowed only with a note (an Administrator or Facilitator documents them; they stay visible).
 * -> { ok, id?, version?, error? }
 */
export function finalizeReview(month, day, weekKey, { personId, note = '' }) {
  const m = buildModel(month, day, weekKey);
  if (!m) return { ok: false, error: 'No week to finalize.' };
  const person = finalizers(m.org).find((p) => p.id === personId);
  if (!person) return { ok: false, error: 'Choose who finalizes it: an Administrator or a Facilitator.', field: 'by' };
  const items = finishItems(m);
  const why = String(note).trim();
  if (items.length && !why) return { ok: false, error: 'Say why it\'s finalized with these still open.', field: 'note' };
  const now = new Date().toISOString();
  const escalated = listActions().filter((a) => isOpenAction(a) && a.escalation);
  let id = null;
  let version = 0;
  const { ok } = editWeekly(m.week.key, (doc, w) => {
    const { draft } = ensureDraftIn(doc, m, now);
    const snap = snapshotOf(m);
    const known = new Set(draft.escalations.map((e) => e.actionId).filter(Boolean));
    const fnName = (fnId) => anyFunctionById(month, fnId)?.name ?? '';
    const more = escalated.filter((a) => !known.has(a.id)).map((a) => ({
      id: newId('e'), fnId: a.fnId, label: `${fnName(a.fnId)}: ${a.text}`, actionId: a.id, to: a.escalation.to, reason: a.escalation.reason, by: a.escalation.by, at: a.escalation.at,
    }));
    const actionIds = [...new Set([...snap.actionIds, ...draft.actionIds, ...escalated.map((a) => a.id)])];
    const all = listActions();
    const names = new Map(m.org.people.map((p) => [p.id, p.name]));
    Object.assign(draft, snap, {
      state: 'finalized',
      finalizedAt: now,
      finalizedBy: person.name,
      finalizedById: person.id,
      facilitator: person.id,
      updatedAt: now,
      // Draft v1 becomes Finalized v1 (a revised version v2 becomes Finalized v2, and v1 reads Replaced by v2).
      version: draft.version,
      attendees: w.participants,
      // Frozen at finalize (spec §13): what each action and attendee was then. The record shows "now: …" beside any that changed.
      attendeeNames: w.participants.map((pid) => ({ id: pid, name: String(names.get(pid) ?? '').trim() })),
      actionSnapshots: actionIds.map((aid) => {
        const a = all.find((x) => x.id === aid);
        return a ? { id: aid, text: a.text, status: a.status, owner: a.owner, ownerPersonId: a.ownerPersonId ?? null, due: a.due ?? null, fnId: a.fnId } : { id: aid, missing: true };
      }),
      actionIds,
      escalations: [...draft.escalations, ...more],
      exceptions: items.map((x) => ({ text: x.text })),
      exceptionNote: items.length ? why : '',
    });
    id = draft.id;
    version = draft.version;
  });
  if (id) writeDecisionDraft(m.week.key, '');
  return { ok: Boolean(id), saved: ok, id, version };
}

/**
 * Add a note to a finalized record: what it adds and why, and who. Append-only (stored as `amendments`);
 * nothing else on the record moves, and its lifecycle step doesn't change.
 */
export function amendRecord(recordId, { text, personId, month }) {
  const words = String(text ?? '').trim();
  if (!words) return { ok: false, error: 'Say what the note adds, and why.', field: 'text' };
  const person = amenders(getOrg(month).active).find((p) => p.id === personId) ?? null;
  if (!person) return { ok: false, error: 'Choose who is adding it: an Administrator or a Facilitator.', field: 'by' };
  let found = false;
  const { ok } = editWeekly(null, (doc) => {
    const rec = doc.records.find((r) => r.id === recordId && r.state === 'finalized');
    if (!rec) return;
    rec.amendments.push({ text: words, by: person.name.trim(), byId: person.id, at: new Date().toISOString() });
    found = true;
  });
  return { ok: found, saved: ok };
}

/**
 * Draft → Finalized → Revised: one week's record (spec §13), as three steps with a line that says where it is.
 * - Draft: the first draft (v1), until Finish review finalizes it.
 * - Finalized: the week's record. It never changes; a note can be added to it (that doesn't move it).
 * - Revised: a revised version (v2, started from a finalized one), a draft until its own Finish review and then
 *   the week's record; the version it replaced stays as it was and says "Replaced by v2".
 * `doc` (the weekly store) tells a replaced version; without it a record is read on its own.
 */
export function lifecycleMarkup(rec, doc = null) {
  const replaced = replacementOf(doc, rec);
  const finalized = rec?.state === 'finalized';
  const stage = !rec ? 0 : rec.basedOn || replaced ? 2 : finalized ? 1 : 0;
  const baseV = rec?.basedOn ? (doc?.records.find((r) => r.id === rec.basedOn)?.version ?? rec.version - 1) : null;
  const steps = ['Draft', 'Finalized', 'Revised'].map((name, i) => {
    const done = i < stage;
    const cur = i === stage;
    return `<li class="${done ? 'is-done' : cur ? 'is-current' : ''}"${cur ? ' aria-current="step"' : ''}><span class="org-step-n" aria-hidden="true">${done ? CHECK_SMALL : i + 1}</span>${name}${done ? '<span class="sr-only">, done</span>' : ''}</li>`;
  }).join('');
  const words = !rec ? ''
    : replaced ? `Replaced by v${replaced.version}${replaced.finalizedAt ? ` (finalized ${formatStamp(replaced.finalizedAt)})` : ''}. v${rec.version} keeps its numbers as they were.`
      : rec.basedOn && finalized ? `Finalized v${rec.version}, the week's record. It replaced v${baseV}.`
        : rec.basedOn ? `Revised version v${rec.version}, a draft. Finalized v${baseV} stays the week's record until this one is finalized.`
          : finalized ? `Finalized v${rec.version}, the week's record. It never changes; a note can be added at the end.`
            : `Draft v${rec.version}. Finish review finalizes it.`;
  const open = replaced ? ` <a href="#record/${esc(replaced.id)}">Open v${replaced.version}</a>` : '';
  return `<ol class="org-steps wr-life" aria-label="Record lifecycle">${steps}</ol>${words ? `<p class="wr-life-note" data-life-note>${esc(words)}${open}</p>` : ''}`;
}
const CHECK_SMALL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>';

/** "Finalized snapshot v2" or "Draft snapshot v1 · not finalized": what an export or printout is. */
export const snapshotLabel = (rec, doc = null) => {
  if (rec.state !== 'finalized') return `Draft snapshot v${rec.version} · not finalized`;
  const replaced = replacementOf(doc ?? readWeekly(), rec);
  return `Finalized snapshot v${rec.version}${replaced ? ` · replaced by v${replaced.version}` : ''}${rec.amendments.length ? ` · ${notesWords(rec.amendments.length)}` : ''}`;
};

/* ---------- Exports ---------- */

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?%?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvNumber = (v, unit) => (isNum(v) ? (unit === 'fraction' ? `${Number((v * 100).toFixed(4))}%` : String(Number(v.toFixed(4)))) : '');

function download(name, rows) {
  const text = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

const STATUS_CSV = (x) => (x.goalVaries ? 'Goal varies' : x.status === NO_GOAL ? 'No goal set' : statusWord(x.status, { better: x.better }));

function recordCsv(rec) {
  const head = ['Snapshot', 'Week', 'Record', 'State', 'Version', 'Function', 'Owner', 'Measure', 'Weekly rule', 'Result', 'Goal', 'Status',
    'Provisional', 'Days expected', 'Days received', 'Days on track', 'Days missed', 'Overridden', 'Calculated', 'Repeat gap', 'Calculation',
    ...COMMENT_FIELDS.map(([, label]) => label)];
  const kept = rec.commentary ?? {};
  const rows = rec.results.map((x) => [
    snapshotLabel(rec), rec.weekStart, rec.id, replacementOf(readWeekly(), rec) ? `Replaced by v${replacementOf(readWeekly(), rec).version}` : rec.state === 'finalized' ? 'Finalized' : 'Draft', rec.version, x.fnName, x.owner, x.kpiName, RULES[x.rule]?.name ?? x.rule,
    csvNumber(x.effective, x.unit) || 'Not entered', x.goalVaries ? 'Varies' : csvNumber(x.goal, x.unit), STATUS_CSV(x),
    x.provisional ? 'Yes' : '', x.expected, x.received, x.met, x.missed, x.overridden ? 'Yes' : '', csvNumber(x.raw, x.unit), x.gap, calcWords(rec.calcVersion),
    ...COMMENT_FIELDS.map(([k]) => kept[x.fnId]?.[k] ?? ''),
  ]);
  return download(`weekly-review-${rec.weekStart}${rec.state === 'finalized' ? '' : '-draft'}.csv`, [head, ...rows]);
}

function minutesCsv(min) {
  const s = min.snapshot;
  const head = ['Snapshot', 'Day', 'Function', 'Owner', 'Measure', 'Day result', 'Day status', 'Month result', 'Month status', 'Issue', 'Action'];
  const cell = (c) => [c?.actual, c?.rest].filter(Boolean).join(' ');
  const label = min.state === 'finalized' ? `Finalized minutes v${min.version ?? 1}` : 'Draft minutes · not finalized';
  const rows = (s?.functions ?? []).flatMap((f) => f.rows.map((r) => [
    label, min.dayIso, f.name, f.owner, r.name, cell(r.day), r.day?.word ?? r.day?.status ?? '', cell(r.month), r.month?.word ?? r.month?.status ?? '',
    r.issue?.empty ? '' : r.issue?.text ?? '', r.action?.empty ? '' : r.action?.text ?? '',
  ]));
  return download(`daily-meeting-${min.dayIso || 'minutes'}.csv`, [head, ...rows]);
}

function printRecord(rec) {
  const page = document.createElement('div');
  page.className = 'wk-print';
  page.innerHTML = recordBody(last, rec, { print: true });
  document.body.append(page);
  const html = document.documentElement;
  html.classList.add('wk-printing');
  const before = document.title;
  document.title = `Weekly Operating Review (WOR), ${weekOf({ start: rec.weekStart })}`;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    page.remove();
    html.classList.remove('wk-printing');
    document.title = before;
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  try { window.print(); } catch { /* no print here */ }
  setTimeout(cleanup, 1000);
}

/* ---------- The sheet: View calculation, and a review record ---------- */

const findEntry = (m, key) => m.fns.flatMap((f) => f.rows.map((e) => ({ ...e, fn: f.fn }))).find((e) => e.key === key)
  ?? m.measures.find((x) => x.key === key) ?? null;

function dayRowsTable(m, e) {
  const r = e.result;
  const kpi = e.row.kpiDaily;
  const weighted = r.rule === 'weighted';
  const shown = r.days.filter((d) => d.day !== null && (d.production || d.used));
  if (!shown.length) return '<p class="wc-empty">No days to show.</p>';
  const rows = shown.map((d) => {
    const pair = formatPair(d.actual, d.goal, kpi);
    const st = d.reason === 'not-reached' ? null : d.actual === null ? NOT_ENTERED : d.goal === null ? NO_GOAL : (r.marks.find((x) => x.iso === d.iso)?.status ?? NO_GOAL);
    const counted = d.used ? (r.rule === 'latest' ? 'Used: the last value' : 'Counted')
      : d.reason === null && r.rule === 'latest' ? 'Earlier value: a stock counts its last one'
        : (EXCLUDED_WORDS[d.reason] ?? 'Not counted');
    // data-label: on a phone each day stacks as a short list, every column named (no sideways scroll).
    return `<tr${d.used ? ' class="is-used"' : ''}>
        <th scope="row"><a href="${esc(dorDayHref(m, d.day, e.row.id))}">${esc(dayMed(d.iso))}</a></th>
        <td class="num" data-label="Number">${esc(pair.actual ?? 'Not entered')}</td>
        <td class="num" data-label="Goal">${esc(formatPair(null, d.goal, kpi).goal ?? 'No goal set')}</td>
        ${weighted ? `<td class="num" data-label="Parts produced">${esc(isNum(d.weight) ? plainNumber(d.weight) : 'Not entered')}</td><td class="num" data-label="× parts">${d.used ? esc(plainNumber(d.actual * d.weight, 2)) : '<span aria-hidden="true">–</span>'}</td>` : ''}
        <td data-label="On the day">${st ? statusMarkup(st, { tag: 'span', kpi }) : '<span class="status status--not-tracked">Not reached yet</span>'}</td>
        <td data-label="In the week">${esc(counted)}</td>
      </tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data-table wc-table">
      <caption class="sr-only">${esc(plainLabel(kpi))}, day by day this week</caption>
      <thead><tr><th scope="col">Day</th><th scope="col" class="num">Number</th><th scope="col" class="num">Goal</th>${weighted ? `<th scope="col" class="num">Parts produced (weight)</th><th scope="col" class="num">${esc(plainLabel(kpi))} × parts</th>` : ''}<th scope="col">On the day</th><th scope="col">In the week</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

/** The formula in words, with this week's own numbers. */
function formulaWords(e) {
  const r = e.result;
  const kpi = e.row.kpiDaily;
  const fmt = (v) => weeklyPair(v, null, kpi, r.rule).actual;
  const used = r.days.filter((d) => d.used);
  const goalWord = r.goalVaries ? goalChangedWords(r, kpi)
    : isNum(r.goal) ? null : 'No goal is set.';
  if (r.rule === 'weekly-only') {
    return `<p>Entered once a week for the whole week. It is not added up from days, and no weekly goal is approved for it yet.</p>`;
  }
  if (!used.length) return '<p>No day has both a number and a goal yet, so there is no result.</p>';
  if (r.rule === 'sum') {
    const parts = used.map((d) => formatPair(d.actual, null, kpi).actual).join(' + ');
    const goals = used.map((d) => formatPair(null, d.goal, kpi).goal ?? '0').join(' + ');
    return `<p>The week's total is the days added up: ${esc(parts)} = <strong>${esc(fmt(r.raw))}</strong>.</p>
      <p>The goal is the daily goals of the same days added up: ${esc(goals)} = <strong>${esc(formatValue(r.goal, kpi.unit))}</strong>.</p>`;
  }
  if (r.rule === 'mean') {
    return `<p>The days' numbers added up, divided by the production days counted: ${esc(plainNumber(r.num))} ÷ ${r.den} = <strong>${esc(fmt(r.raw))}</strong>.</p>
      <p>${goalWord ? esc(goalWord) : `The goal is the day goal, the same every day this week: <strong>${esc(formatValue(r.goal, kpi.unit))}</strong>.`}</p>`;
  }
  if (r.rule === 'weighted') {
    return `<p>Each day's ${esc(plainLabel(kpi))} times that day's parts produced (Operations), added up, divided by the week's parts produced: ${esc(plainNumber(r.num, 2))} ÷ ${esc(plainNumber(r.den))} = <strong>${esc(fmt(r.raw))}</strong>. A day with more parts counts for more, so this is not the average of the daily percents.</p>
      <p>${goalWord ? esc(goalWord) : `The goal is the day goal, the same every day this week: <strong>${esc(formatValue(r.goal, kpi.unit))}</strong>.`}</p>`;
  }
  if (r.rule === 'latest') {
    return `<p>A stock is counted, not added up: the week's result is the last value entered, on <strong>${esc(dayMed(r.latest.iso))}</strong>: <strong>${esc(fmt(r.raw))}</strong>.</p>
      <p>${goalWord ? esc(goalWord) : `The goal is the day goal: <strong>${esc(formatValue(r.goal, kpi.unit))}</strong>.`}</p>`;
  }
  return '';
}

function historyList(input, kpi, rule) {
  const h = input?.history ?? [];
  const typed = (v) => weeklyPair(v, null, kpi, rule, { entered: true }).actual;
  const calc = (v) => weeklyPair(v, null, kpi, rule, { entered: rule === 'weekly-only' }).actual;
  if (!h.length) return '<p class="wc-empty">No changes yet.</p>';
  const words = { 'weekly-entered': 'Weekly value entered', 'weekly-changed': 'Weekly value changed', 'weekly-cleared': 'Weekly value cleared', 'override-added': 'Override added', 'override-removed': 'Override removed' };
  return `<ol class="wc-history">${h.slice().reverse().map((x) => `<li><span class="wc-h-what">${esc(words[x.kind] ?? x.kind)}</span>
      <span class="wc-h-meta">${[x.value !== null ? typed(x.value) : '', x.raw !== null ? `${rule === 'weekly-only' ? 'was' : 'calculated'} ${calc(x.raw)}` : '', x.reason ? `reason: ${x.reason}` : '', x.approver ? `approved by ${x.approver}` : '', x.expires ? `valid until ${dateWords(x.expires)}` : '', x.by ? `by ${x.by}` : '', x.at ? formatStamp(x.at) : ''].filter(Boolean).map(esc).join(' · ')}</span></li>`).join('')}</ol>`;
}

/** Who did it, for a record or a history line: the person chosen on this device, never blank. */
const actorWords = (month) => String(getIdentity(month)?.name ?? '').trim() || (cloud.BOARD ? 'Someone' : 'Someone on this device');

/** The weekly entry or override form (mode selector: the week's own value, or an override with a reason and an approver). */
function entryForm(m, e) {
  const r = e.result;
  const kpi = e.row.kpiDaily;
  const pct = kpi.unit === 'fraction';
  const weeklyOnly = r.rule === 'weekly-only';
  const canOverride = r.raw !== null;
  const people = approvers(m.org);
  const limit = weeklyLimit(kpi);
  const ownMode = weeklyOnly ? 'weekly' : 'auto';
  const autoLabel = weeklyOnly ? 'Weekly value: entered once for the week' : 'Automatic: worked out from the days';
  return `<form class="wc-form" data-entry-form novalidate>
      <fieldset class="wc-modes">
        <legend>How this week's number is set</legend>
        <label class="wc-mode"><input type="radio" name="wc-mode" value="${ownMode}" checked data-mode> <span>${esc(autoLabel)}</span></label>
        <label class="wc-mode${canOverride ? '' : ' is-off'}"><input type="radio" name="wc-mode" value="override" data-mode${canOverride ? '' : ' disabled aria-describedby="wc-ov-why"'}> <span>Override: replace this week's value (needs a reason and an approver)</span></label>
        ${canOverride ? '' : `<p class="wc-hint" id="wc-ov-why">${weeklyOnly ? 'Enter the weekly value first: an override replaces a value.' : 'Nothing to override yet: no day of this week has a number and a goal.'}</p>`}
      </fieldset>
      <div class="wc-fields">
        <div class="wc-field" data-show-for="${weeklyOnly ? 'weekly override' : 'override'}"${weeklyOnly ? '' : ' hidden'}>
          <label for="wc-value">${weeklyOnly ? 'This week\'s value' : 'Override value'}</label>
          <div class="su-suffix${pct ? ' has-suffix' : ''}"><input id="wc-value" type="text" inputmode="decimal" autocomplete="off" aria-describedby="wc-value-hint wc-value-err" value="${weeklyOnly && isNum(r.raw) ? esc(String(Number((pct ? r.raw * 100 : r.raw).toFixed(4)))) : ''}">${pct ? '<span aria-hidden="true">%</span>' : ''}</div>
          <p class="wc-hint wc-hint--flush" id="wc-value-hint">${esc(`0 to ${limit.words}${limit.whole ? ', a whole number' : ''}.`)}</p>
          <p class="su-error" id="wc-value-err" hidden></p>
        </div>
        <div class="wc-field" data-show-for="override" hidden>
          <label for="wc-reason">Reason</label>
          <textarea id="wc-reason" rows="2" maxlength="500" aria-describedby="wc-reason-err"></textarea>
          <p class="su-error" id="wc-reason-err" hidden></p>
        </div>
        <div class="wc-field" data-show-for="override" hidden>
          <label for="wc-approver">Approved by</label>
          <span class="su-select"><select id="wc-approver" aria-describedby="wc-approver-hint wc-approver-err">
            <option value="">${people.length ? 'Choose who approved it' : 'Nobody has the role yet'}</option>
            ${people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.title ? ` (${esc(p.title)})` : ''}</option>`).join('')}
          </select></span>
          <p class="wc-hint wc-hint--flush" id="wc-approver-hint">${people.length ? 'A Verifier, a Site or department leader, or an Administrator (Board setup, Organization).' : 'Give someone the Verifier, Site or department leader, or Administrator role in Board setup, under Organization.'}</p>
          <p class="su-error" id="wc-approver-err" hidden></p>
        </div>
        <div class="wc-field" data-show-for="override" hidden>
          <label for="wc-expiry">Approval valid until</label>
          <input id="wc-expiry" type="date" value="${esc(addDaysLocal(todayIso(), 28))}" min="${esc(todayIso())}" aria-describedby="wc-expiry-hint wc-expiry-err">
          <p class="wc-hint wc-hint--flush" id="wc-expiry-hint">After this date the override stops counting and the calculated value is effective again.</p>
          <p class="su-error" id="wc-expiry-err" hidden></p>
        </div>
      </div>
      <div class="wc-buttons">
        <button class="btn btn--primary" type="submit" data-entry-save${weeklyOnly ? '' : ' hidden'}>${weeklyOnly ? 'Save weekly value' : 'Save override'}</button>
      </div>
      <p class="wc-note">${weeklyOnly ? cloud.here('Saved on this device for this week only. It never changes a daily number.') : 'An override replaces the effective result for this week only. The calculated value is kept, and the daily numbers, month to date and year to date stay as they are.'}</p>
    </form>`;
}

function calcBody(m, e) {
  const r = e.result;
  const kpi = e.row.kpiDaily;
  const fn = e.fn;
  const input = m.saved.inputs[e.key] ?? null;
  const pair = weeklyPair(r.effective, r.goalVaries ? null : r.goal, kpi, r.rule, { entered: r.mode !== 'AUTO' });
  const rawPair = weeklyPair(r.raw, null, kpi, r.rule, { entered: r.rule === 'weekly-only' });
  const excluded = r.days.filter((d) => !d.used && d.reason && !(d.reason === 'no-production' && d.day === null));
  const ov = r.override;
  const expiredOv = r.overrideExpired;
  const rule = RULES[r.rule];
  const expectedLine = r.rule === 'weekly-only'
    ? `1 weekly value expected · ${r.received ? 'entered' : 'not entered yet'}`
    : `${r.expected} production ${r.expected === 1 ? 'day' : 'days'} expected · ${r.received} received with a number and a goal${r.provisional ? ' · provisional' : ''}`;
  const overrideBlock = ov
    ? `<div class="wc-ov">
        <p class="wc-ov-line"><strong>${esc(weeklyPair(ov.value, null, kpi, r.rule, { entered: true }).actual)} · overridden</strong></p>
        <dl class="wc-dl">
          <div><dt>Reason</dt><dd>${esc(ov.reason)}</dd></div>
          <div><dt>Approved by</dt><dd>${esc(ov.approver)}</dd></div>
          <div><dt>When</dt><dd>${esc(ov.at ? formatStamp(ov.at) : 'Not recorded')}</dd></div>
          <div><dt>Valid until</dt><dd>${esc(ov.expires ? dateWords(ov.expires) : 'No expiry set (an older override)')}</dd></div>
          <div><dt>Calculated then</dt><dd>${esc(isNum(ov.raw) ? weeklyPair(ov.raw, null, kpi, r.rule).actual : 'Not entered')}</dd></div>
        </dl>
        ${r.needsReapproval ? `<p class="wc-warn">${statusMarkup(OFF, { tag: 'span', word: 'Needs reapproval' })} The days changed since it was approved: calculated ${esc(rawPair.actual ?? 'not entered')} now.</p>` : ''}
        <button class="btn btn--secondary" type="button" data-remove-override>Remove override</button>
      </div>`
    : `${expiredOv ? `<p class="wc-warn">${statusMarkup(OFF, { tag: 'span', word: `Override expired ${dateWords(expiredOv.expires)}` })} ${esc(weeklyPair(expiredOv.value, null, kpi, r.rule, { entered: true }).actual)}, approved by ${esc(expiredOv.approver)}, no longer counts: the calculated value is effective again. Approve a new override below if it should still stand.</p>` : ''}${entryForm(m, e)}`;
  return `<p class="wc-sub">${esc(fn.name)} · ${esc(weekLabel(m.week))} · ${esc(boundaries(m.week))} · Plant total</p>
    <div class="wc-result">
      ${weekBlock(m, e, { label: 'This week', calc: false })}
    </div>
    <section class="sheet-section" aria-labelledby="wc-rule"><h3 class="section-title" id="wc-rule">Rule</h3>
      <p class="wc-rule-line"><strong>${esc(rule.name)}</strong> · ${esc(CALC_VERSION)}</p>
      ${rule.note ? `<p class="wc-rule-note">${esc(rule.note)}</p>` : ''}
      ${e.measure || r.rule === 'weekly-only' ? '' : '<p class="wc-rule-note">Board setup can pick another weekly rule for this KPI.</p>'}
    </section>
    <section class="sheet-section" aria-labelledby="wc-how"><h3 class="section-title" id="wc-how">How it's worked out</h3>${formulaWords(e)}</section>
    ${r.rule === 'weekly-only' ? '' : `<section class="sheet-section" aria-labelledby="wc-days"><h3 class="section-title" id="wc-days">The days</h3>${dayRowsTable(m, e)}</section>`}
    <section class="sheet-section" aria-labelledby="wc-count"><h3 class="section-title" id="wc-count">Expected and received</h3><p>${esc(expectedLine)}</p></section>
    ${r.rule === 'weekly-only' ? '' : `<section class="sheet-section" aria-labelledby="wc-out"><h3 class="section-title" id="wc-out">Left out, and why</h3>
      ${excluded.length ? `<ul class="wc-out">${excluded.map((d) => `<li><span class="wc-out-day">${esc(dayMed(d.iso))}</span><span>${esc(EXCLUDED_WORDS[d.reason] ?? 'Not counted')}</span></li>`).join('')}</ul>` : '<p>Nothing was left out.</p>'}
    </section>`}
    <section class="sheet-section" aria-labelledby="wc-raw"><h3 class="section-title" id="wc-raw">Calculated and effective</h3>
      <dl class="wc-dl">
        <div><dt>${r.rule === 'weekly-only' ? 'Entered' : 'Calculated (raw)'}</dt><dd>${esc(rawPair.actual ?? 'Not entered')}</dd></div>
        <div><dt>Effective</dt><dd>${esc(pair.actual ?? 'Not entered')}${r.overridden ? ' · overridden' : r.rule === 'weekly-only' ? ' · weekly value' : ' · automatic'}</dd></div>
      </dl>
    </section>
    <section class="sheet-section" aria-labelledby="wc-entry" id="wc-entry-section"><h3 class="section-title" id="wc-entry">${ov ? 'Override' : r.rule === 'weekly-only' ? 'Enter this week' : 'Override'}</h3>${overrideBlock}</section>
    <section class="sheet-section" aria-labelledby="wc-hist"><h3 class="section-title" id="wc-hist">History</h3>${historyList(input, kpi, r.rule)}</section>
    <p class="wc-foot">${cloud.here('Calculated just now from data saved on this device.')} The connected version recalculates in LinkedXL OS and keeps a version for every change.</p>`;
}

function recordBody(m, rec, { print = false } = {}) {
  const rev = revisions(m, rec);
  const finalized = rec.state === 'finalized';
  const people = new Map(m.org.people.map((p) => [p.id, p]));
  const all = listActions();
  const rows = rec.results.map((x) => {
    const kpi = { unit: x.unit, better: x.better };
    const pair = weeklyPair(x.effective, x.goalVaries ? null : x.goal, kpi, x.rule, { entered: x.overridden || x.rule === 'weekly-only' });
    const st = x.goalVaries ? NO_GOAL : x.status;
    return `<tr><th scope="row">${esc(x.fnName)}</th><td>${esc(x.kpiName)}</td><td class="num">${esc(pair.actual ?? 'Not entered')}${x.overridden ? ' · overridden' : ''}</td><td>${esc(x.goalVaries ? 'Goal varies' : pair.actual !== null ? pair.rest : '')}</td><td>${statusMarkup(st, { tag: 'span', kpi, word: STATUS_CSV(x) })}${x.provisional ? ' <span class="wk-tag-inline">Provisional</span>' : ''}</td><td class="num">${x.expected && x.rule !== 'weekly-only' ? `${x.met} of ${x.expected}` : ''}</td></tr>`;
  }).join('');
  const when = (iso) => (iso ? formatStamp(iso) : '');
  const snaps = new Map((rec.actionSnapshots ?? []).map((x) => [x.id, x]));
  const actionLine = (id) => {
    const a = all.find((x) => x.id === id);
    const snap = finalized ? snaps.get(id) : null;
    if (snap && !snap.missing) {
      // As it was when the record was finalized, with "now: …" beside anything that has changed since.
      const fn = anyFunctionById(m.month, snap.fnId);
      const now = (field, words) => (a && a[field] !== snap[field] ? ` <span class="wr-now">now: ${esc(words(a))}</span>` : '');
      const gone = a ? '' : ` <span class="wr-now">now: no longer in the Action register${ON_DEVICE}</span>`;
      return `<li><span class="wa-id">ID ${esc(id.slice(0, 8))}</span> ${esc(snap.text)}${now('text', (x) => x.text)}
        <span class="wr-sub">${esc([fn?.name, snap.owner].filter(Boolean).join(' · '))}${now('owner', (x) => x.owner || 'no owner')}${esc(snap.due ? ` · ${dueText(snap.due)}` : '')}${now('due', (x) => (x.due ? dueText(x.due) : 'no due date'))}</span>
        ${actionStateMarkup(snap.status)}${now('status', (x) => ACTION_STATE_WORDS[x.status] ?? x.status)}${gone}</li>`;
    }
    if (!a) return `<li><span class="wa-id">ID ${esc(id.slice(0, 8))}</span> No longer in the Action register${ON_DEVICE}</li>`;
    const fn = anyFunctionById(m.month, a.fnId);
    return `<li><span class="wa-id">ID ${esc(id.slice(0, 8))}</span> ${esc(a.text)} <span class="wr-sub">${esc([fn?.name, a.owner, a.due ? dueText(a.due) : ''].filter(Boolean).join(' · '))}</span> ${actionStateMarkup(a.status)}</li>`;
  };
  const frozen = new Map((rec.attendeeNames ?? []).map((x) => [x.id, x.name]));
  const attendee = (id) => {
    const live = String(people.get(id)?.name ?? '').trim();
    if (finalized && frozen.has(id)) {
      const was = frozen.get(id) || 'No name then';
      const now = !people.has(id) ? 'no longer in the organization' : live !== was ? live || 'no name' : '';
      return `<li>${esc(was)}${now ? ` <span class="wr-now">now: ${esc(now)}</span>` : ''}</li>`;
    }
    return `<li>${esc(live || 'Someone no longer in the organization')}</li>`;
  };
  const finalBlock = finalized ? `<dl class="wc-dl wr-final">
      <div><dt>Finalized</dt><dd>${esc(when(rec.finalizedAt))}${rec.finalizedBy ? ` by ${esc(rec.finalizedBy)}` : ''}</dd></div>
      <div><dt>Facilitator</dt><dd>${esc(people.get(rec.facilitator)?.name ?? rec.finalizedBy ?? 'Not recorded')}</dd></div>
      <div><dt>Next review</dt><dd>${esc(rec.nextReviewDate ? `Week of ${dayMed(rec.nextReviewDate)}` : 'Not set')}</dd></div>
      ${rec.meeting ? `<div><dt>Meeting</dt><dd>${esc(`${when(rec.meeting.startedAt)} to ${rec.meeting.endedAt ? new Date(rec.meeting.endedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'not recorded'}, ${Math.max(1, Math.round(rec.meeting.durationSec / 60))} min${rec.meeting.recorded ? ', recorded' : ', not recorded'}`)}</dd></div>` : ''}
    </dl>` : '';
  const exceptions = rec.exceptions.length ? `<section class="sheet-section wr-exc" aria-labelledby="wr-exc-${esc(rec.id)}">
      <h3 class="section-title" id="wr-exc-${esc(rec.id)}">${statusMarkup(OFF, { tag: 'span', word: `Finalized with ${rec.exceptions.length} ${rec.exceptions.length === 1 ? 'exception' : 'exceptions'}` })}</h3>
      <ul class="wr-people">${rec.exceptions.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>
      <p class="wr-note"><strong>Why:</strong> ${esc(rec.exceptionNote || 'Not recorded')}</p>
    </section>` : '';
  const amendments = finalized ? `<section class="sheet-section" aria-labelledby="wr-amd-${esc(rec.id)}"><h3 class="section-title" id="wr-amd-${esc(rec.id)}">Notes</h3>
      ${rec.amendments.length ? `<ol class="wr-people wr-amends">${rec.amendments.map((a) => `<li>${esc(a.text)} <span class="wr-sub">${esc([a.by ? `by ${a.by}` : '', when(a.at)].filter(Boolean).join(' · '))}</span></li>`).join('')}</ol>` : '<p class="wc-empty">No notes yet. A note is added at the end, with who added it and why; it changes nothing above.</p>'}
      ${print ? '' : amendForm(m, rec)}
    </section>` : '';
  return `${print ? `<p class="wk-print-kicker">Weekly review · ${esc(snapshotLabel(rec, m.doc))} · ${esc(calcWords(rec.calcVersion))}</p><h1 class="wk-print-title">${esc(weekLabel({ start: rec.weekStart }))}</h1>` : ''}
    <p class="wc-sub"><strong>Reviewed week: ${esc(dayMed(rec.weekStart))} – ${esc(rec.weekEnd ? dayLong(rec.weekEnd) : '')}</strong> · looked from ${esc(rec.asOfIso ? dayMed(rec.asOfIso) : 'its last production day')} · Plant total · ${esc(snapshotLabel(rec, m.doc))}${rec.state === 'finalized' ? '' : ` · prepared ${esc(formatStamp(rec.updatedAt ?? rec.createdAt))}`}</p>
    ${lifecycleMarkup(rec, m.doc)}
    ${rev.length ? `<p class="wc-warn">${statusMarkup(OFF, { tag: 'span', word: finalized ? 'Source revised' : 'Numbers changed since it was prepared' })} ${esc(rev.join('; '))}. ${finalized ? 'The record keeps the numbers it was finalized with.' : 'Save review draft again to update it.'}</p>` : ''}
    ${finalBlock}
    ${!finalized && !print ? `<p class="wr-finish-row"><button class="btn btn--primary" type="button" data-finish="${esc(rec.weekKey)}">Finish review</button><span class="wr-sub">Checks what's missing, then finalizes the week.</span></p>` : ''}
    <p class="wr-summary">${esc(rec.summary)}</p>
    ${exceptions}
    <section class="sheet-section"><h3 class="section-title">Results</h3>
      <div class="table-wrap"><table class="data-table wr-table"><thead><tr><th scope="col">Function</th><th scope="col">Measure</th><th scope="col" class="num">Result</th><th scope="col">Goal</th><th scope="col">Status</th><th scope="col" class="num">Days on track</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>
    ${commentarySection(m, rec)}
    <section class="sheet-section"><h3 class="section-title">Attendees</h3>
      ${rec.attendees.length ? `<ul class="wr-people">${rec.attendees.map(attendee).join('')}</ul>` : '<p class="wc-empty">No participants were confirmed.</p>'}
    </section>
    <section class="sheet-section"><h3 class="section-title">Decisions</h3>
      ${rec.decisions.length ? `<ul class="wr-people">${rec.decisions.map((d) => `<li>${esc(d.text)}${d.context || d.by ? ` <span class="wr-sub">${esc([d.context, d.by ? `by ${d.by}` : ''].filter(Boolean).join(' · '))}</span>` : ''}</li>`).join('')}</ul>` : '<p class="wc-empty">No decisions recorded yet. Decisions are captured in the weekly meeting or in Finish review.</p>'}
    </section>
    <section class="sheet-section"><h3 class="section-title">Escalations</h3>
      ${rec.escalations.length ? `<ul class="wr-people">${rec.escalations.map((e) => `<li><strong>${esc(e.label)}</strong> to ${esc(e.to)}: ${esc(e.reason)}${e.actionId ? ` <span class="wa-id">action ${esc(e.actionId.slice(0, 8))}</span>` : ' <span class="wr-sub">no action yet</span>'}</li>`).join('')}</ul>` : '<p class="wc-empty">Nothing was escalated.</p>'}
    </section>
    <section class="sheet-section"><h3 class="section-title">Actions, by ID</h3>
      ${rec.actionIds.length ? `<ul class="wr-people wr-actions">${rec.actionIds.map(actionLine).join('')}</ul>` : '<p class="wc-empty">No actions were carried in or opened that week.</p>'}
    </section>
    <section class="sheet-section"><h3 class="section-title">Readiness when prepared</h3>
      <ul class="wr-people">${rec.readiness.map((x) => `<li>${x.done ? 'Ready' : 'Not ready'}: ${esc(x.text)}</li>`).join('')}</ul>
    </section>
    ${amendments}
    ${print ? '' : `<div class="wc-buttons"><button class="btn btn--secondary" type="button" data-record-csv="${esc(rec.id)}">Export CSV</button><button class="btn btn--secondary" type="button" data-record-print="${esc(rec.id)}">Print</button></div>`}
    <p class="wc-foot">${finalized ? `A finalized record never changes: it keeps its numbers, and a note can be added with its author and reason. A change goes into a revised version: Start a revised version (v${rec.version + 1}) on the Overview, then Finish review; it replaces this one once it's finalized.` : 'A draft record: Save review draft refreshes its numbers; decisions and escalations are added as they happen.'} ${cloud.BOARD ? 'Saved for everyone on this board.' : 'Saved on this device; the connected version keeps it in LinkedXL OS Governance.'}</p>`;
}

/**
 * The commentary the record kept (a draft: when it was saved; finalized: frozen then), function by
 * function, with "now: …" beside a field written differently since, as actions and attendees show it.
 */
function commentarySection(m, rec) {
  const title = '<h3 class="section-title">Commentary</h3>';
  if (rec.commentary === null) {
    return `<section class="sheet-section">${title}<p class="wc-empty">This record was saved before records kept commentary. The Functions tab has what is written now.</p></section>`;
  }
  const live = weekSaved(m.doc, rec.weekKey).commentary ?? {};
  const kept = rec.commentary ?? {};
  const fnIds = [...new Set([...rec.results.map((x) => x.fnId), ...Object.keys(kept), ...Object.keys(live)])].filter(Boolean);
  const blocks = fnIds.map((fnId) => {
    const was = kept[fnId] ?? {};
    const now = live[fnId] ?? {};
    const rows = COMMENT_FIELDS.map(([k, label]) => {
      const a = String(was[k] ?? '').trim();
      const b = String(now[k] ?? '').trim();
      if (!a && !b) return '';
      const changed = a !== b;
      return `<div><dt>${esc(label)}</dt><dd>${a ? esc(a) : '<span class="wr-sub">Not written then</span>'}${changed ? ` <span class="wr-now">now: ${esc(b || 'cleared')}</span>` : ''}</dd></div>`;
    }).join('');
    if (!rows) return '';
    const name = rec.results.find((x) => x.fnId === fnId)?.fnName ?? anyFunctionById(m.month, fnId)?.name ?? fnId;
    return `<div class="wr-comment"><h4 class="wr-comment-fn">${esc(name)}</h4><dl class="wc-dl wr-comment-dl">${rows}</dl></div>`;
  }).join('');
  return `<section class="sheet-section">${title}${blocks || '<p class="wc-empty">No commentary was written for this week.</p>'}</section>`;
}

/** Add a note to a finalized record: what it adds and why, and who. Appended; nothing else on the record moves. */
function amendForm(m, rec) {
  const me = getIdentity(m.month)?.name ?? '';
  const who = amenders(m.org);
  const pick = who.find((p) => p.name === me) ?? null;
  return `<form class="wc-form wr-amend" data-amend-form="${esc(rec.id)}" novalidate>
      <div class="wc-field"><label for="wr-amend-text">Note: what it adds, and why</label>
        <textarea id="wr-amend-text" rows="2" maxlength="2000" aria-describedby="wr-amend-text-err"></textarea>
        <p class="su-error" id="wr-amend-text-err" hidden></p></div>
      <div class="wc-field"><label for="wr-amend-by">Added by</label>
        <span class="su-select"><select id="wr-amend-by" aria-describedby="wr-amend-by-hint wr-amend-by-err">
          <option value="">${who.length ? 'Choose who is adding it' : 'Nobody has the role yet'}</option>
          ${who.map((p) => `<option value="${esc(p.id)}"${p === pick ? ' selected' : ''}>${esc(p.name)}${p.title ? ` (${esc(p.title)})` : ''}</option>`).join('')}
        </select></span>
        <p class="wc-hint wc-hint--flush" id="wr-amend-by-hint">An Administrator or Facilitator, as for finalizing.</p>
        <p class="su-error" id="wr-amend-by-err" hidden></p></div>
      <div class="wc-buttons"><button class="btn btn--secondary" type="submit">Add a note</button></div>
    </form>`;
}

/* ---------- Add action for one KPI and week (the sheet: #add/<fnId>[/<kpiId>]) ---------- */

/**
 * What's typed in an Add action form that was closed unsaved, by week, function and KPI. It lives in
 * sessionStorage (as a typed decision does), so a reload, a phone that drops the page, or leaving and
 * coming back in the same tab finds it again; Save clears it.
 */
const ADD_DRAFT_KEY = 'dor.worAddDraft.v1';
const addDrafts = {
  all() {
    try {
      const d = JSON.parse(sessionStorage.getItem(ADD_DRAFT_KEY) ?? 'null');
      return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
    } catch { return {}; }
  },
  get(key) {
    const d = this.all()[key];
    return d && typeof d.text === 'string' ? d : undefined;
  },
  set(key, value) {
    const all = this.all();
    all[key] = value;
    try { sessionStorage.setItem(ADD_DRAFT_KEY, JSON.stringify(all)); } catch { /* storage blocked: not kept */ }
  },
  delete(key) {
    const all = this.all();
    if (!(key in all)) return;
    delete all[key];
    try {
      if (Object.keys(all).length) sessionStorage.setItem(ADD_DRAFT_KEY, JSON.stringify(all));
      else sessionStorage.removeItem(ADD_DRAFT_KEY);
    } catch { /* storage blocked */ }
  },
};
const addKey = (m, fnId, kpiKey) => `${m.week.key}|${fnId}|${kpiKey}`;

/** "people" or "people|absent" from the sheet id: { fnId, kpiKey } ('' is the function's own KPI). */
const parseAddId = (id) => { const [fnId, kpiKey = ''] = String(id ?? '').split('|'); return { fnId, kpiKey }; };

function addEntry(m, fnId, kpiKey) {
  const f = m.fns.find((x) => x.fn.id === fnId);
  const e = f?.rows.find((r) => (r.row.primary ? '' : String(r.row.kpiId ?? '')) === kpiKey) ?? f?.rows[0];
  return f && e ? { f, e } : null;
}

/**
 * A focused form for one KPI's action this week: the week's result, then (spec §4, repeat losses) "Link to
 * the open issue" picked by default when the KPI already has an open action, or the action's words,
 * its owner (a person from the Organization) and its due date. It never opens the whole register.
 */
function addBody(m, fnId, kpiKey) {
  const found = addEntry(m, fnId, kpiKey);
  if (!found) return null;
  const { f, e } = found;
  const kpi = e.row.kpiDaily;
  const r = e.result;
  const pair = weeklyPair(r.effective, r.goalVaries ? null : r.goal, kpi, r.rule, { entered: r.mode !== 'AUTO' });
  const draft = addDrafts.get(addKey(m, fnId, kpiKey)) ?? null;
  const cands = linkCandidates(fnId, kpiKey || null, m.asOfIso);
  const linkPick = draft ? draft.link : (cands[0]?.id ?? '');
  const people = m.org.people.filter((p) => p.name.trim());
  const ownerId = draft?.ownerId ?? m.org.functions?.[fnId]?.responsible ?? '';
  const due = draft?.due ?? nextProductionDayIso(m.month, m.asOfDay) ?? '';
  const asOf = nb(dayMed(m.asOfIso));
  const opt = (a) => `<label class="ar-link-opt"><input type="radio" name="wa-link" value="${esc(a.id)}"${linkPick === a.id ? ' checked' : ''} data-wa-link>
      <span><span class="ar-link-lead">Link to the open issue:</span> <span class="ar-link-text">${esc(a.text)}</span><span class="ar-link-meta">${esc([a.owner, ACTION_STATE_WORDS[a.status] ?? '', a.dayIso ? `open since ${nb(dayMed(a.dayIso))}` : '', a.due ? `due ${nb(dayMed(a.due))}` : ''].filter(Boolean).join(' · '))}</span></span></label>`;
  const linking = cands.length > 0 && Boolean(linkPick);
  return `<p class="wc-sub">${esc(f.fn.name)} · ${esc(plainLabel(kpi))} · ${esc(weekLabel(m.week))}</p>
    <div class="wa-week">
      ${statusMarkup(r.goalVaries ? NO_GOAL : r.status, { kpi, word: resultWord(r, kpi), extra: 'wa-week-st' })}
      <p class="wa-week-fig">${esc(pair.actual ?? 'Not entered')} <span>${esc(r.goalVaries ? 'goal varies this week' : pair.rest ?? '')}</span></p>
      ${e.gap.level !== 'none' ? `<p class="wa-week-gap">${esc(nbDot(e.gap.word))}</p>` : ''}
    </div>
    <form class="wc-form wa-form" data-wa-form="${esc(`${fnId}|${kpiKey}`)}" novalidate>
      ${cands.length ? `<fieldset class="ar-link-set">
        <legend class="ar-label">This KPI already has an open action</legend>
        ${cands.map(opt).join('')}
        <label class="ar-link-opt"><input type="radio" name="wa-link" value=""${linking ? '' : ' checked'} data-wa-link><span>Start a new action instead</span></label>
      </fieldset>
      <p class="wc-hint wa-hint">Linking adds ${esc(asOf)} to that action's days, so one action answers for a loss that repeats.</p>` : ''}
      <div class="wc-fields" data-wa-new${linking ? ' hidden' : ''}>
        <div class="wc-field"><label for="wa-text">Action</label>
          <textarea id="wa-text" rows="3" maxlength="2000" aria-describedby="wa-text-err">${esc(draft?.text ?? '')}</textarea>
          <p class="su-error" id="wa-text-err" hidden></p></div>
        <div class="wc-row">
          <div class="wc-field"><label for="wa-owner">Owner</label>
            <span class="su-select"><select id="wa-owner" aria-describedby="wa-owner-err">${people.map((p) => `<option value="${esc(p.id)}"${p.id === ownerId ? ' selected' : ''}>${esc(p.name)}${p.title ? ` (${esc(p.title)})` : ''}</option>`).join('') || '<option value="">Nobody in the organization yet</option>'}</select></span>
            <p class="su-error" id="wa-owner-err" hidden></p></div>
          <div class="wc-field"><label for="wa-due">Due date</label>
            <input id="wa-due" type="date" value="${esc(due)}" min="${esc(m.asOfIso)}" aria-describedby="wa-due-err">
            <p class="su-error" id="wa-due-err" hidden></p></div>
        </div>
      </div>
      <div class="wc-buttons">
        <button class="btn btn--primary" type="submit" data-wa-save>${linking ? `Link ${esc(asOf)}` : 'Save action'}</button>
        <button class="btn btn--secondary" type="button" data-close>Cancel</button>
      </div>
      <p class="wc-note">It goes to the Action register for ${esc(asOf)}, the day this week looks from, and counts as this KPI's action from then on.</p>
    </form>`;
}

const ACTION_STATE_WORDS = { open: 'Open', 'in-progress': 'In progress', completed: 'Completed', verified: 'Verified', cancelled: 'Cancelled' };

function syncAddMode(form) {
  const linking = Boolean(form.querySelector('[data-wa-link]:checked')?.value);
  const fields = form.querySelector('[data-wa-new]');
  if (fields) fields.hidden = linking;
  const save = form.querySelector('[data-wa-save]');
  if (save && last) save.textContent = linking ? `Link ${nb(dayMed(last.asOfIso))}` : 'Save action';
}

/** Keep what's typed (closing unsaved keeps it for this visit; Save clears it). */
function keepAddDraft(form) {
  if (!form || !last) return;
  const { fnId, kpiKey } = parseAddId(form.dataset.waForm);
  const text = form.querySelector('#wa-text')?.value ?? '';
  const key = addKey(last, fnId, kpiKey);
  if (!text.trim()) { addDrafts.delete(key); return; }
  addDrafts.set(key, {
    text,
    ownerId: form.querySelector('#wa-owner')?.value ?? '',
    due: form.querySelector('#wa-due')?.value ?? '',
    link: form.querySelector('[data-wa-link]:checked')?.value ?? '',
  });
}

/** After the sheet closes: back to that row's Add action (or its action, once it has one). */
let addReturn = null;

function submitAdd(form) {
  const month = ctx.getMonth();
  const m = buildModel(month, ctx.getDay());
  const { fnId, kpiKey } = parseAddId(form.dataset.waForm);
  const found = m && addEntry(m, fnId, kpiKey);
  if (!found) return;
  const label = `${found.f.fn.name}, ${plainLabel(found.e.row.kpiDaily)}`;
  const link = form.querySelector('[data-wa-link]:checked')?.value || '';
  addReturn = { fnId, kpiKey };
  if (link) {
    const r = linkActionDay(link, m.asOfIso);
    if (!r.ok) { ctx.toast('That action closed in the meantime. Start a new action instead.'); redrawSheetKeep(); return; }
    addDrafts.delete(addKey(m, fnId, kpiKey));
    goAfterClose = () => focusNewAction(link, fnId);
    requestClose();
    ctx.toast(`Linked ${nb(dayMed(m.asOfIso))} to the open action for ${label}. One action now answers for the repeat loss.`, { near: () => addReturnTarget() });
    return;
  }
  const text = form.querySelector('#wa-text')?.value.trim() ?? '';
  const ownerId = form.querySelector('#wa-owner')?.value ?? '';
  const due = form.querySelector('#wa-due')?.value ?? '';
  const owner = m.org.people.find((p) => p.id === ownerId);
  showError('wa-text-err', text ? null : 'Write what will be done.');
  showError('wa-owner-err', owner ? null : 'Choose who owns it.');
  showError('wa-due-err', /^\d{4}-\d{2}-\d{2}$/.test(due) ? null : 'Pick a due date.');
  const bad = form.querySelector('[aria-invalid="true"]');
  if (bad) { bad.focus(); return; }
  const saved = addAction({
    fnId, kpiId: kpiKey || null, text, owner: owner.name, ownerPersonId: owner.id, due, status: 'open', source: 'manual', dayIso: m.asOfIso,
    note: `Added in the Weekly review, ${weekLabel(m.week).toLowerCase()}`,
  });
  addDrafts.delete(addKey(m, fnId, kpiKey));
  if (saved) goAfterClose = () => focusNewAction(saved.id, fnId);
  requestClose();
  ctx.toast(saved ? `Added to the Action register for ${label}, owned by ${owner.name}.` : "The action wasn't saved. Try again.", { near: () => addReturnTarget() });
}

/** After Save action: focus on the action just added (or linked) in its row, once the page has redrawn. */
function focusNewAction(id, fnId) {
  const land = () => {
    const el = document.querySelector(`#wk-${CSS.escape(fnId)} [data-wk-act="${CSS.escape(id)}"]`);
    const target = el && el.checkVisibility?.() !== false ? el : document.querySelector(`#wk-${CSS.escape(fnId)} [data-wk-add]`);
    target?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    target?.focus({ preventScroll: true });
  };
  requestAnimationFrame(() => requestAnimationFrame(land));
}

function addReturnTarget() {
  if (!addReturn) return null;
  const row = document.getElementById(`wk-${addReturn.fnId}`);
  return row ? [row.querySelector(`.wk-row[data-key]`)?.closest('.wk-group') ?? row].filter(Boolean) : null;
}

function redrawSheetKeep() {
  if (sheet) refreshWorSheet(ctx.getMonth());
}

/* ---------- Finish review (the sheet: #finish) ---------- */

function finishBody(m) {
  const draft = latestDraft(m.doc, m.week.key);
  const final = latestFinal(m.doc, m.week.key);
  const items = finishItems(m);
  const typed = readDecisionDraft(m.week.key);
  const who = finalizers(m.org);
  const me = getIdentity(m.month)?.name ?? '';
  const pick = who.find((p) => p.name === me) ?? who[0] ?? null;
  const decisions = draft?.decisions ?? [];
  const list = items.length
    // What's left to do is about the meeting, not the plant's results: readiness's navy and steel (a ring), never the off-goal red.
    ? `<ul class="ff-items">${items.map((x) => `<li class="ff-item" data-ff-item="${esc(x.id)}"><span class="ff-item-text"><span class="wk-ring" aria-hidden="true"></span><span class="sr-only">Not done: </span><span class="ff-item-words">${esc(x.text)}</span></span><button class="btn btn--secondary ff-go" type="button" data-ff-go="${esc(x.go)}">Go to it<span class="sr-only">: ${esc(x.text)}</span></button></li>`).join('')}</ul>`
    : `<p class="ff-clear">${statusMarkup(ON, { tag: 'span', word: 'Nothing is missing.' })} Decisions are recorded, every off-goal result has an action, and nothing typed is waiting to be saved.</p>`;
  return `<p class="wc-sub">${esc(weekLabel(m.week))} · ${esc(boundaries(m.week))} · Plant total</p>
    ${lifecycleMarkup(draft ?? { state: 'draft', version: (final?.version ?? 0) + 1, basedOn: final?.id ?? null }, m.doc)}
    <section class="sheet-section" aria-labelledby="ff-check"><h3 class="section-title" id="ff-check">Before you&nbsp;finalize${items.length ? `&nbsp;<span class="ff-n">${items.length} open</span>` : ''}</h3>
      ${list}
    </section>
    <section class="sheet-section" aria-labelledby="ff-dec"><h3 class="section-title" id="ff-dec">Decisions and next-week priorities&nbsp;<span class="ff-n">${decisions.length}</span></h3>
      ${decisions.length ? `<ol class="wr-people ff-decisions">${decisions.map((d) => `<li>${esc(d.text)}${d.context ? ` <span class="wr-sub">${esc(d.context)}</span>` : ''}</li>`).join('')}</ol>` : '<p class="wc-empty">None yet.</p>'}
      <form class="wc-form ff-decide" data-ff-decision novalidate>
        <div class="wc-field"><label for="ff-decision">Add a decision</label>
          <textarea id="ff-decision" rows="2" maxlength="2000" data-decision-draft="${esc(m.week.key)}" aria-describedby="ff-decision-err">${esc(typed)}</textarea>
          <p class="su-error" id="ff-decision-err" hidden></p></div>
        <div class="wc-buttons"><button class="btn btn--secondary" type="submit">Save decision</button></div>
      </form>
    </section>
    <section class="sheet-section" aria-labelledby="ff-final"><h3 class="section-title" id="ff-final">Finalize</h3>
      <form class="wc-form ff-final" data-ff-finalize novalidate>
        <div class="wc-field"><label for="ff-by">Finalized by</label>
          <span class="su-select"><select id="ff-by" aria-describedby="ff-by-note ff-by-err">${who.map((p) => `<option value="${esc(p.id)}"${p === pick ? ' selected' : ''}>${esc(p.name)}${p.title ? ` (${esc(p.title)})` : ''}</option>`).join('') || '<option value="">Nobody has the role yet</option>'}</select></span>
          <p class="wc-hint" id="ff-by-note">${who.length ? 'An Administrator or Facilitator finalizes the record (Board setup, Organization).' : 'Nobody has the Administrator or Facilitator role. Give someone the role in Board setup, under Organization.'}</p>
          <p class="su-error" id="ff-by-err" hidden></p></div>
        ${items.length ? `<div class="wc-field"><label for="ff-note">Why finalize with ${items.length} ${items.length === 1 ? 'item' : 'items'} open</label>
          <textarea id="ff-note" rows="2" maxlength="1000" data-finish-note="${esc(m.week.key)}" aria-describedby="ff-note-hint ff-note-err">${esc(readFinishNote(m.week.key))}</textarea>
          <p class="wc-hint" id="ff-note-hint">The open items and this note stay visible on the finalized record.</p>
          <p class="su-error" id="ff-note-err" hidden></p></div>` : ''}
        <div class="wc-buttons"><button class="btn btn--primary" type="submit"${who.length ? '' : ' aria-disabled="true"'}>${items.length ? 'Finalize with exceptions' : 'Finalize review'}</button></div>
        <p class="wc-note">Finalizing keeps this week's results, attendees, decisions, actions by ID, escalations and the next review date (week of ${esc(dayMed(addDays(m.week.end, 1)))}) as version ${draft?.version ?? (final?.version ?? 0) + 1}${final ? `, which replaces v${final.version}` : ''}. It never changes after that; a note can be added, with its author and reason.</p>
      </form>
    </section>`;
}

function sheetMarkup(title, body) {
  return `<div class="sheet-panel">
      <header class="sheet-head">
        <h2 class="sheet-title wc-title" id="wor-sheet-title" tabindex="-1">${esc(title)}</h2>
        <div class="sheet-tools">
          <button class="icon-btn sheet-close" type="button" data-close aria-label="Close ${esc(title)}">
            <svg class="icon" aria-hidden="true" focusable="false"><use href="#g-close"></use></svg>
          </button>
        </div>
      </header>
      <div class="sheet-body">${body}</div>
    </div>`;
}

function drawSheet(month, kind, id, day) {
  const m = buildModel(month, day);
  if (!m) return false;
  last = last ?? m;
  if (kind === 'calc') {
    const e = findEntry(m, id);
    if (!e) return false;
    dlg.innerHTML = sheetMarkup(plainLabel(e.row.kpiDaily), calcBody(m, e));
  } else if (kind === 'finish') {
    const fm = buildModel(month, day, id && id !== 'week' ? id : undefined) ?? m;
    dlg.innerHTML = sheetMarkup(`Finish the weekly review`, finishBody(fm));
  } else if (kind === 'add') {
    const { fnId, kpiKey } = parseAddId(id);
    const body = addBody(m, fnId, kpiKey);
    if (!body) return false;
    const found = addEntry(m, fnId, kpiKey);
    dlg.innerHTML = sheetMarkup(`Add action: ${found.f.fn.name}${found.f.rows.length > 1 ? `, ${plainLabel(found.e.row.kpiDaily)}` : ''}`, body);
  } else {
    const rec = m.doc.records.find((r) => r.id === id);
    if (!rec) return false;
    dlg.innerHTML = sheetMarkup(`Weekly review, ${weekOf({ start: rec.weekStart })}`, recordBody(m, rec));
  }
  fitSheetHead(dlg);
  return true;
}

function requestClose() {
  if (closeAsked) return;
  closeAsked = true;
  ctx.onClose();
}

export const isWorSheetOpen = () => Boolean(dlg?.open);

/** Open the sheet: kind 'calc' (a weekly value's calculation) or 'record' (a review record). */
export function openWorSheet(month, kind, id, day, { focus = null } = {}) {
  const wasOpen = dlg.open;
  if (!wasOpen) {
    const a = document.activeElement;
    opener = a && a !== document.body && !dlg.contains(a) ? a : null;
    closeAsked = false;
  }
  const same = wasOpen && sheet?.kind === kind && sheet?.id === id;
  const scroll = same ? dlg.querySelector('.sheet-panel')?.scrollTop ?? 0 : 0;
  if (!drawSheet(month, kind, id, day)) {
    if (!wasOpen) {
      sayWorNote(kind === 'record'
        ? cloud.here("That meeting record isn't saved on this device. Meeting records lists the ones that are.")
        : kind === 'calc' ? "That weekly value isn't on this page. Each row's View calculation opens its own."
          : "That function or KPI isn't on the board, so there's nothing to add an action for.");
      requestClose();
    }
    return false;
  }
  sheet = { kind, id };
  if (!wasOpen) dlg.showModal();
  if (same) dlg.querySelector('.sheet-panel').scrollTop = scroll;
  const want = focus ?? pendingFocus;
  pendingFocus = null;
  if (want === 'entry') {
    const panel = dlg.querySelector('.sheet-panel');
    const sec = dlg.querySelector('#wc-entry-section');
    const box = dlg.querySelector('#wc-value:not([hidden])');
    if (sec && panel) panel.scrollTop = sec.offsetTop - 80;
    (box && box.closest('[hidden]') === null ? box : dlg.querySelector('[data-mode]:checked'))?.focus({ preventScroll: true });
  } else if (kind === 'add' && !same) {
    const pick = dlg.querySelector('[data-wa-link]:checked');
    (pick?.value ? pick : dlg.querySelector('#wa-text'))?.focus({ preventScroll: true });
  } else if (!same) {
    dlg.querySelector('#wor-sheet-title')?.focus({ preventScroll: true });
  }
  return true;
}
let pendingFocus = null;

export function refreshWorSheet(month) {
  if (!dlg?.open || !sheet) return;
  const k = (() => {
    const a = document.activeElement;
    return a && dlg.contains(a) && a.id ? a.id : null;
  })();
  if (!drawSheet(month, sheet.kind, sheet.id, ctx.getDay())) { requestClose(); return; }
  if (k) document.getElementById(k)?.focus({ preventScroll: true });
}

function focusBack() {
  const shown = (el) => Boolean(el?.isConnected) && !el.closest('[inert], dialog:not([open]), [hidden]') && (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null);
  let target = shown(opener) ? opener : null;
  if (!target && sheet) {
    let sel = sheet.kind === 'calc' ? `[data-calc="${CSS.escape(sheet.id)}"]` : `[data-record-open="${CSS.escape(sheet.id)}"]`;
    if (sheet.kind === 'add') {
      const { fnId, kpiKey } = parseAddId(sheet.id);
      sel = `[data-wk-add="${CSS.escape(fnId)}"][data-wk-add-kpi="${CSS.escape(kpiKey)}"], #wk-${CSS.escape(fnId)} [data-calc]`;
    }
    target = [...document.querySelectorAll(sel)].find(shown) ?? null;
  }
  (target ?? document.getElementById('wor'))?.focus({ preventScroll: false });
}

/** After the sheet closes, go somewhere on the page instead of back to its opener (Finish review's Go to it). */
let goAfterClose = null;

export function closeWorSheet({ restoreFocus = true } = {}) {
  if (!dlg?.open) return;
  if (sheet?.kind === 'add') keepAddDraft(dlg.querySelector('[data-wa-form]'));
  dlg.close();
  if (goAfterClose) {
    const go = goAfterClose;
    goAfterClose = null;
    requestAnimationFrame(go);
  } else if (restoreFocus) focusBack();
  sheet = null;
  opener = null;
}

/** Finish review's "Go to it": the decision box in the sheet, or the page's place for the item. */
function goTo(target) {
  if (target === 'decision') {
    const box = dlg.querySelector('#ff-decision');
    box?.scrollIntoView({ block: 'center', behavior: 'instant' });
    box?.focus();
    return;
  }
  goAfterClose = () => {
    if (target === 'functions') {
      selectTab('functions');
      document.querySelector('[data-commentary]')?.focus();
      return;
    }
    const [, fnId, kpi = ''] = target.split(':');
    selectTab('overview');
    const row = document.getElementById(`wk-${fnId}`);
    const add = row?.querySelector(`[data-wk-add][data-wk-add-kpi="${CSS.escape(kpi)}"]`) ?? row?.querySelector('[data-wk-add]');
    row?.scrollIntoView({ block: 'center', behavior: 'instant' });
    (add ?? row?.querySelector('[data-calc]'))?.focus({ preventScroll: true });
  };
  requestClose();
}

function fieldError(id, msg) {
  showError(`${id}-err`, msg);
  if (msg) document.getElementById(id)?.focus();
}

function saveFinishDecision(form) {
  const box = form.querySelector('#ff-decision');
  const text = box?.value ?? '';
  if (!text.trim()) { fieldError('ff-decision', 'Write the decision first.'); return; }
  const month = ctx.getMonth();
  const weekKey = sheet?.id && sheet.id !== 'week' ? sheet.id : last?.week.key;
  const r = addDecision(month, ctx.getDay(), weekKey, text, 'Finish review');
  ctx.refresh();
  dlg.querySelector('#ff-decision')?.focus();
  ctx.toast(`Decision saved to the week's draft record (${r.count} so far).${r.ok ? '' : " This browser isn't saving."}`);
}

function submitFinalize(form) {
  const month = ctx.getMonth();
  const weekKey = sheet?.id && sheet.id !== 'week' ? sheet.id : last?.week.key;
  const personId = form.querySelector('#ff-by')?.value ?? '';
  const note = form.querySelector('#ff-note')?.value ?? '';
  showError('ff-by-err', null);
  showError('ff-note-err', null);
  const r = finalizeReview(month, ctx.getDay(), weekKey, { personId, note });
  if (!r.ok) { fieldError(r.field === 'note' ? 'ff-note' : 'ff-by', r.error); return; }
  writeFinishNote(weekKey, '');
  const rec = readWeekly().records.find((x) => x.id === r.id);
  ctx.refresh();
  ctx.navigate(`record/${r.id}`, { replace: true });
  const exc = rec?.exceptions.length ?? 0;
  const base = rec?.basedOn ? readWeekly().records.find((x) => x.id === rec.basedOn) : null;
  ctx.toast(`Finalized: the weekly review of ${dayShort(rec?.weekStart ?? weekKey)}, version ${r.version}${base ? `. It replaces v${base.version}` : ''}.${exc ? ` ${exc} ${exc === 1 ? 'exception is' : 'exceptions are'} noted on the record.` : ''}${r.saved ? '' : " This browser isn't saving."}`);
}

function submitAmend(form) {
  const id = form.dataset.amendForm;
  showError('wr-amend-text-err', null);
  showError('wr-amend-by-err', null);
  const r = amendRecord(id, { text: form.querySelector('#wr-amend-text')?.value, personId: form.querySelector('#wr-amend-by')?.value, month: ctx.getMonth() });
  if (!r.ok) { fieldError(r.field === 'by' ? 'wr-amend-by' : 'wr-amend-text', r.error ?? 'That record isn\'t finalized.'); return; }
  ctx.refresh();
  dlg.querySelector('[data-amend-form] textarea')?.focus();
  ctx.toast(`Note added at the end of the record, with who added it and when. Its numbers and decisions are unchanged.${r.saved ? '' : " This browser isn't saving."}`);
}

/* ---------- Entry and override (in the sheet) ---------- */

function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg ?? '';
  el.hidden = !msg;
  const box = document.getElementById(id.replace(/-err$/, ''));
  if (box) box.setAttribute('aria-invalid', msg ? 'true' : 'false');
}

function syncMode(form) {
  const mode = form.querySelector('[data-mode]:checked')?.value ?? 'auto';
  form.querySelectorAll('[data-show-for]').forEach((el) => { el.hidden = !el.dataset.showFor.split(' ').includes(mode); });
  const save = form.querySelector('[data-entry-save]');
  if (save) {
    save.hidden = mode === 'auto';
    save.textContent = mode === 'override' ? 'Save override' : 'Save weekly value';
  }
}

function submitEntry(form) {
  if (!sheet || sheet.kind !== 'calc' || !ctx) return;
  const month = ctx.getMonth();
  const m = buildModel(month, ctx.getDay());
  const e = m && findEntry(m, sheet.id);
  if (!e) return;
  const kpi = e.row.kpiDaily;
  const mode = form.querySelector('[data-mode]:checked')?.value ?? 'auto';
  if (mode === 'auto') return;
  const valueBox = form.querySelector('#wc-value');
  const parsed = parseInput(valueBox.value, kpi);
  const limit = weeklyLimit(kpi);
  let bad = false;
  if (!parsed.ok) { showError('wc-value-err', parsed.error); bad = true; } else if (parsed.value === null) { showError('wc-value-err', mode === 'override' ? 'Enter the value that replaces it.' : 'Enter this week\'s value.'); bad = true; } else if (parsed.value > limit.max + 1e-9) { showError('wc-value-err', `Can't be over ${limit.words} for ${plainLabel(kpi)}.`); bad = true; } else if (limit.whole && !Number.isInteger(parsed.value)) { showError('wc-value-err', `${plainLabel(kpi)} is counted in whole numbers.`); bad = true; } else showError('wc-value-err', null);
  const reason = form.querySelector('#wc-reason')?.value.trim() ?? '';
  const approverId = form.querySelector('#wc-approver')?.value ?? '';
  const approverPerson = approvers(m.org).find((p) => p.id === approverId) ?? null;
  const expires = form.querySelector('#wc-expiry')?.value ?? '';
  if (mode === 'override') {
    if (!reason) { showError('wc-reason-err', 'Say why this week\'s value is overridden.'); bad = true; } else showError('wc-reason-err', null);
    if (!approverPerson) { showError('wc-approver-err', 'Choose who approved the override.'); bad = true; } else showError('wc-approver-err', null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) { showError('wc-expiry-err', 'Pick the date the approval runs until.'); bad = true; } else if (expires < todayIso()) { showError('wc-expiry-err', 'Pick today or a later date.'); bad = true; } else showError('wc-expiry-err', null);
  }
  if (bad) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
  const now = new Date().toISOString();
  const by = actorWords(month);
  const r = e.result;
  const approver = approverPerson?.name.trim() ?? '';
  const { ok } = editWeekly(m.week.key, (doc, w) => {
    const input = w.inputs[e.key] ?? { weekly: null, override: null, history: [] };
    if (mode === 'override') {
      input.override = { value: parsed.value, reason, approver, approverId: approverPerson.id, expires, at: now, raw: r.raw, received: r.received };
      input.history.push({ kind: 'override-added', value: parsed.value, raw: r.raw, reason, approver, expires, by, at: now });
    } else {
      const had = input.weekly;
      input.weekly = { value: parsed.value, by, at: now };
      input.history.push({ kind: had ? 'weekly-changed' : 'weekly-entered', value: parsed.value, raw: had?.value ?? null, reason: '', approver: '', by, at: now });
    }
    w.inputs[e.key] = input;
  });
  const shownValue = weeklyPair(parsed.value, r.goalVaries ? null : r.goal, kpi, r.rule, { entered: true }).actual;
  const what = plainLabel(kpi);
  ctx.refresh();
  if (mode === 'override') {
    ctx.toast(`Override saved: ${shownValue} for ${what} in the ${weekOf(m.week)}. The calculated ${weeklyPair(r.raw, null, kpi, r.rule).actual} is kept.${ok ? '' : " This browser isn't saving."}`);
  } else {
    ctx.toast(`Saved ${shownValue} for ${what} in the ${weekOf(m.week)}.${ok ? '' : " This browser isn't saving."}`);
  }
  dlg.querySelector('#wor-sheet-title')?.focus({ preventScroll: true });
}

function removeOverride() {
  if (!sheet || !ctx) return;
  const month = ctx.getMonth();
  const m = buildModel(month, ctx.getDay());
  const e = m && findEntry(m, sheet.id);
  if (!e?.result.override) return;
  const ov = e.result.override;
  const now = new Date().toISOString();
  editWeekly(m.week.key, (doc, w) => {
    const input = w.inputs[e.key];
    if (!input) return;
    input.override = null;
    input.history.push({ kind: 'override-removed', value: ov.value, raw: e.result.raw, reason: ov.reason, approver: ov.approver, by: actorWords(month), at: now });
  });
  ctx.refresh();
  const kpi = e.row.kpiDaily;
  ctx.toast(`Override removed. ${plainLabel(kpi)} is back to the calculated ${weeklyPair(e.result.raw, null, kpi, e.result.rule).actual ?? 'value'}. The history keeps it.`);
  dlg.querySelector('#wc-entry')?.closest('section')?.querySelector('[data-mode]')?.focus({ preventScroll: true });
}

/* ---------- Wiring ---------- */

/**
 * ctx = { onClose, getMonth, getDay, goToWeek(key), navigate(hash), toast, openMinutes(id), refresh() }
 */
export function initWor(c) {
  ctx = c;
  dlg = document.createElement('dialog');
  dlg.className = 'sheet wor-sheet';
  dlg.id = 'wor-sheet';
  dlg.setAttribute('aria-labelledby', 'wor-sheet-title');
  document.body.append(dlg);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });
  dlg.addEventListener('close', () => {
    if (!sheet || dlg.open) return;
    focusBack();
    sheet = null;
    requestClose();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) { requestClose(); return; }
    if (e.target.closest('[data-close]')) { requestClose(); return; }
    if (e.target.closest('[data-remove-override]')) { removeOverride(); return; }
    const go = e.target.closest('[data-ff-go]');
    if (go) { goTo(go.dataset.ffGo); return; }
    const fin = e.target.closest('[data-finish]');
    if (fin) { ctx.navigate('finish'); return; }
    const csv = e.target.closest('[data-record-csv]');
    if (csv) { const rec = readWeekly().records.find((r) => r.id === csv.dataset.recordCsv); if (rec) ctx.toast(`Downloaded ${recordCsv(rec)}.`); return; }
    const pr = e.target.closest('[data-record-print]');
    if (pr) { const rec = readWeekly().records.find((r) => r.id === pr.dataset.recordPrint); if (rec) printRecord(rec); }
  });
  dlg.addEventListener('change', (e) => {
    if (e.target.matches('[data-mode]')) syncMode(e.target.closest('form'));
    if (e.target.matches('[data-wa-link]')) syncAddMode(e.target.closest('form'));
  });
  dlg.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.matches('[data-ff-decision]')) { e.preventDefault(); saveFinishDecision(f); return; }
    if (f.matches('[data-ff-finalize]')) { e.preventDefault(); submitFinalize(f); return; }
    if (f.matches('[data-amend-form]')) { e.preventDefault(); submitAmend(f); return; }
    if (f.matches('[data-wa-form]')) { e.preventDefault(); submitAdd(f); return; }
    if (!f.matches('[data-entry-form]')) return;
    e.preventDefault();
    submitEntry(f);
  });
  // A decision typed in Finish review is kept as it's typed, so a close never loses it (Finish asks about it).
  dlg.addEventListener('input', (e) => {
    if (e.target.matches?.('[data-decision-draft]')) writeDecisionDraft(e.target.dataset.decisionDraft, e.target.value);
    if (e.target.matches?.('[data-finish-note]')) writeFinishNote(e.target.dataset.finishNote, e.target.value);
  });

  const inPage = (el) => Boolean(el.closest('.page-app[data-page="wor"]'));
  // The sidebar's (and the phone drawer's) functions on this page: that function in the week, on the Functions tab.
  document.addEventListener('click', (e) => {
    const link = e.target instanceof Element ? e.target.closest('[data-wor-fn]') : null;
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    showFunction(link.dataset.worFn);
  });
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element) || !inPage(t)) return;
    const step = t.closest('[data-wk-step]');
    if (step) {
      if (step.getAttribute('aria-disabled') === 'true') {
        const note = document.querySelector('[data-wk-note]');
        if (note) {
          note.textContent = Number(step.dataset.wkStep) < 0 ? `${weekLabel(last.week)} is the first week of this month's data.` : `${weekLabel(last.week)} is the last week of this month's data.`;
          note.hidden = false;
        }
        return;
      }
      const to = last?.weeks[last.idx + Number(step.dataset.wkStep)];
      if (to) ctx.goToWeek(to.key);
      // A pilot board: the other half of a split week, or the week next to this one, in the next month.
      else if (cloud.BOARD && last) ctx.stepWeek?.(Number(step.dataset.wkStep), last.week);
      return;
    }
    const tab = t.closest('[data-wk-tab]');
    if (tab) { selectTab(tab.dataset.wkTab, { push: true }); return; }
    const calc = t.closest('[data-calc]');
    if (calc) {
      e.preventDefault();
      pendingFocus = calc.dataset.calcFocus ?? null;
      ctx.navigate(`calc/${calc.dataset.calc}`);
      return;
    }
    const more = t.closest('[data-wk-expand]');
    if (more) {
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open));
      more.closest('.wk-group')?.classList.toggle('is-open', open);
      openGroups[open ? 'add' : 'delete'](more.dataset.wkExpand);
      return;
    }
    const add = t.closest('[data-wk-add]');
    if (add) {
      e.preventDefault();
      const kpi = add.dataset.wkAddKpi ?? '';
      ctx.navigate(`add/${add.dataset.wkAdd}${kpi ? `/${kpi}` : ''}`);
      return;
    }
    if (t.closest('[data-prepare]')) { e.preventDefault(); prepare(); return; }
    if (t.closest('[data-amend-draft]')) { e.preventDefault(); prepare({ amend: true }); return; }
    if (t.closest('[data-finish]')) { e.preventDefault(); ctx.navigate('finish'); return; }
    const write = t.closest('[data-write-commentary]');
    if (write) {
      // A history step, as a tab picked by hand is: Back returns to the scoreboard (on a phone it never leaves the app).
      selectTab('functions', { push: true });
      const box = document.getElementById(`wc-${write.dataset.writeCommentary}-happened`);
      box?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      box?.focus({ preventScroll: true });
      return;
    }
    const jump = t.closest('[data-wk-jump]');
    if (jump) {
      e.preventDefault();
      const row = document.getElementById(`wk-${jump.dataset.wkJump}`);
      row?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      row?.querySelector('[data-calc]')?.focus({ preventScroll: true });
      return;
    }
    const open = t.closest('[data-record-open]');
    if (open) { e.preventDefault(); ctx.navigate(`record/${open.dataset.recordOpen}`); return; }
    const csv = t.closest('[data-record-csv]');
    if (csv) { const rec = readWeekly().records.find((r) => r.id === csv.dataset.recordCsv); if (rec) ctx.toast(`Downloaded ${recordCsv(rec)}.`); return; }
    const pr = t.closest('[data-record-print]');
    if (pr) { const rec = readWeekly().records.find((r) => r.id === pr.dataset.recordPrint); if (rec) printRecord(rec); return; }
    const mo = t.closest('[data-minutes-open]');
    if (mo) { ctx.openMinutes(mo.dataset.minutesOpen); return; }
    const mc = t.closest('[data-minutes-csv]');
    if (mc) {
      let min = null;
      try { min = listMinutes().find((x) => x.id === mc.dataset.minutesCsv); } catch { min = null; }
      if (min) ctx.toast(`Downloaded ${minutesCsv(min)}.`);
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof Element) || !inPage(t)) return;
    if (t.matches('[data-wk-select]')) { ctx.goToWeek(t.value); return; }
    if (t.matches('[data-participant]')) { saveParticipant(t); return; }
    if (t.matches('[data-commentary]')) { clearTimeout(commentTimer); pendingComment = null; saveCommentary(t); }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!(t instanceof Element) || !t.matches('[data-commentary]') || !inPage(t)) return;
    clearTimeout(commentTimer);
    pendingComment = t;
    commentTimer = setTimeout(() => { pendingComment = null; saveCommentary(t); }, 400);
  });
  // Leaving the page or the tab (a phone locked, the app switched): what's typed is saved now, not lost.
  const flush = () => {
    if (commentTimer && pendingComment?.isConnected) { clearTimeout(commentTimer); const el = pendingComment; pendingComment = null; saveCommentary(el, { quiet: true }); }
    for (const box of document.querySelectorAll('[data-decision-draft], [data-wm-decision-draft]')) {
      writeDecisionDraft(box.dataset.decisionDraft ?? box.dataset.wmDecisionDraft, box.value);
    }
    document.querySelectorAll('[data-finish-note]').forEach((box) => writeFinishNote(box.dataset.finishNote, box.value));
    if (sheet?.kind === 'add') keepAddDraft(dlg.querySelector('[data-wa-form]'));
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  document.addEventListener('keydown', (e) => {
    const tab = e.target instanceof Element ? e.target.closest('[data-wk-tab]') : null;
    if (!tab) return;
    const ids = TABS.map(([id]) => id);
    const i = ids.indexOf(tab.dataset.wkTab);
    const go = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: ids.length - 1 }[e.key];
    if (go === undefined) return;
    e.preventDefault();
    selectTab(ids[(go + ids.length) % ids.length], { focus: true, push: true });
  });
}

