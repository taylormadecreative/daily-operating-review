// Weekly rollups for the Weekly review (WOR-ORG-PLAN Part 3; the client team's spec §5, §8, §9).
// Pure functions: no DOM, no storage. Inputs are the month from store.js, a KPI row (kpiRowsFor),
// a week from weeksOf(), and this week's stored input for the KPI (store.js dor.weekly.v1).
//
// Rules (the default comes from the unit; Board setup can pick another per KPI):
//   sum          counts, parts, hours: the total of the days; goal = the total of the daily goals
//   mean         people, numbers: average per production day (a proposed rule)
//   weighted     percents: each day weighted by that day's Operations parts produced (a stand-in
//                until scrap units and produced units are mapped; the spec's rate rule is sum ÷ sum)
//   latest       stock measures (Critical buffer parts inventory): the last valid value of the week
//   weekly-only  entered once a week, never rolled up from days
// Only days with both a number and a goal count (like with like), status is judged on unrounded
// values, a partial week is provisional, and a missing or undefined result has no status.

import { isProductionDay, compareToGoal, ON, OFF, NOT_ENTERED, NO_GOAL } from './status.js?v=20261123-135808';
import { formatPair } from './format.js?v=20261123-135808';

/** The calculation rules' version, in the words every screen and export uses (no rule is approved yet). */
export const CALC_VERSION = 'Rule v1 (proposed)';
/** A record's saved version in today's words (records saved before said "v1 · demo"). */
export const calcWords = (v) => (!v || /^v1 · demo$/.test(v) ? CALC_VERSION : v);
/** "Eastern time" from the organization's "Eastern (…)". */
export function zoneWords(org) {
  const tz = String(org?.timeZone ?? '').trim();
  if (!tz) return 'Time zone not set';
  const head = tz.split('(')[0].trim();
  return /time$/i.test(head) ? head : `${head} time`;
}

/** "Mon–Fri" (a run of days), or "Mon, Wed, Fri". */
export function productionWords(org) {
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const names = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const idx = (org?.productionDays ?? []).map((d) => order.indexOf(d)).filter((i) => i >= 0).sort((a, b) => a - b);
  if (!idx.length) return 'no production days set';
  const run = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  return run && idx.length > 2 ? `${names[order[idx[0]]]}–${names[order[idx[idx.length - 1]]]}` : idx.map((i) => names[order[i]]).join(', ');
}

export const RULE_IDS = ['sum', 'mean', 'weighted', 'latest', 'weekly-only'];

/** Each rule's plain name, its formula in words, and the note it carries. */
export const RULES = {
  sum: { name: 'Adds up the days', note: '' },
  mean: { name: 'Average per production day', note: 'Proposed rule' },
  weighted: { name: 'Weighted by parts produced', note: 'Stand-in until scrap units and produced units are mapped' },
  latest: { name: 'Last value of the week', note: 'A stock is never added up' },
  'weekly-only': { name: 'Entered once a week', note: '' },
};

/** The rule a unit starts with. */
const UNIT_RULE = { count: 'sum', parts: 'sum', hours: 'sum', people: 'mean', number: 'mean', fraction: 'weighted' };

/**
 * Workbook KPIs whose unit says the wrong thing: Materials' critical buffer parts inventory is a count,
 * but it's a stock (spec §8 "Stock or balance", §19 "Buffer inventory"), so it is never summed.
 */
const WORKBOOK_RULE = { materials: 'latest' };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const same = (a, b) => isNum(a) && isNum(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** The function a KPI row belongs to (a workbook KPI row is the function itself). */
export const fnIdOf = (row) => row.fnId ?? row.id;
/** The key a KPI's weekly input is stored under: its row id ("people", "people--absent"). */
export const keyOf = (row) => row.id;

/** The rule a KPI starts with before Board setup picks one: from the workbook KPI, else its unit. */
export function defaultRule(row) {
  if (!row.custom && row.primary !== false && WORKBOOK_RULE[fnIdOf(row)]) return WORKBOOK_RULE[fnIdOf(row)];
  return UNIT_RULE[row.kpiDaily?.unit] ?? 'sum';
}

/** The KPI's weekly rule: Board setup's pick, else its default. */
export function ruleFor(row) {
  return RULE_IDS.includes(row.weeklyRule) ? row.weeklyRule : defaultRule(row);
}

/* ---------- Weeks ---------- */

const DAY_MS = 86400000;
const isoOf = (t) => new Date(t).toISOString().slice(0, 10);
/** 'YYYY-MM-DD' -> its UTC time, or NaN. */
export const isoTime = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? Date.parse(`${iso}T00:00:00Z`) : NaN);
export const addDays = (iso, n) => isoOf(isoTime(iso) + n * DAY_MS);

/**
 * The weeks that touch the month, in order, each Monday to Sunday (or Sunday to Saturday when the
 * organization's week starts on Sunday). A week with no production day in the month's data (Jan 26 to
 * Feb 1 here) is left out.
 * -> [{ key, start, end, days: [{ iso, day (null outside the month), dow }], production: [day] }]
 */
export function weeksOf(month, { weekStart = 'mon' } = {}) {
  const [y, m] = String(month.month).split('-').map(Number);
  const first = Date.UTC(y, m - 1, 1);
  const last = Date.UTC(y, m - 1, month.daysInMonth);
  const startDow = weekStart === 'sun' ? 0 : 1;
  let t = first - (((new Date(first).getUTCDay() - startDow) + 7) % 7) * DAY_MS;
  const weeks = [];
  for (; t <= last; t += 7 * DAY_MS) {
    const days = [];
    for (let i = 0; i < 7; i += 1) {
      const dt = new Date(t + i * DAY_MS);
      const inMonth = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1;
      days.push({ iso: isoOf(dt.getTime()), day: inMonth ? dt.getUTCDate() : null, dow: dt.getUTCDay() });
    }
    const production = days.filter((d) => d.day !== null && isProductionDay(month, d.day) !== false).map((d) => d.day);
    if (production.length) weeks.push({ key: days[0].iso, start: days[0].iso, end: days[6].iso, days, production });
  }
  return weeks;
}

/** The week holding a day of the month; a day in a week that was left out (no production) gets the next one. */
export function weekForDay(weeks, day) {
  return weeks.find((w) => w.days.some((d) => d.day === day))
    ?? weeks.find((w) => w.days.some((d) => d.day !== null && d.day > day))
    ?? weeks[weeks.length - 1] ?? null;
}

/** The last production day of a week (the day its review looks back from). */
export const lastProductionDay = (week) => week.production[week.production.length - 1];

/* ---------- One KPI, one week ---------- */

/**
 * Why a day of the week isn't in the result (shown in words by the calculation drawer):
 *   outside       the day isn't in this month's data
 *   no-production no production scheduled (unless a number that says something was entered: sum rule)
 *   not-reached   after the day the review is looking from
 *   not-tracked   before a KPI added in Board setup existed
 *   not-entered   a production day with no number
 *   no-goal       a number, but no goal to compare it with
 *   no-weight     weighted rule: no parts count that day
 */
export const EXCLUDED_WORDS = {
  outside: "Outside this month's data",
  'no-production': 'No production scheduled',
  'not-reached': 'After the day this review looks from',
  'not-tracked': 'Before this KPI was added',
  'not-entered': 'Not entered',
  'no-goal': 'A number was entered, but no goal is set for the day, so it can\'t be compared',
  'no-weight': "No parts count for the day, so it can't be weighted",
};

/**
 * The weekly result for one KPI row.
 * opts = { asOfDay, input, weightRow, rule }
 *   asOfDay   the review looks from this day (days after it are "not reached": the week is provisional)
 *   input     this week's stored input for the KPI: { weekly: { value, by, at }, override: { value, reason,
 *             approver, at, raw }, history: [...] } (store.js)
 *   weightRow the Operations KPI row whose parts produced weight the weighted rule
 * -> {
 *   rule, kpi, days: [{ iso, day, dow, actual, goal, weight, used, reason, production }],
 *   expected, received, provisional, raw, goal, goalVaries, goalValues, num, den, latest,
 *   override, overridden, needsReapproval, effective, mode, status, marks, met, missed, missedAll }
 */
export function weeklyResult(month, row, week, opts = {}) {
  const rule = opts.rule ?? ruleFor(row);
  const kpi = row.kpiDaily;
  const asOfDay = opts.asOfDay ?? Infinity;
  const series = row.daily?.plant ?? [];
  const at = (d) => series.find((r) => r.day === d) ?? null;
  const weightAt = (d) => opts.weightRow?.daily?.plant?.find((r) => r.day === d)?.actual ?? null;
  const input = opts.input ?? null;

  const days = week.days.map((wd) => {
    const out = { iso: wd.iso, day: wd.day, dow: wd.dow, actual: null, goal: null, weight: null, used: false, reason: null, production: false };
    if (wd.day === null) { out.reason = 'outside'; return out; }
    const r = at(wd.day);
    out.actual = isNum(r?.actual) ? r.actual : null;
    out.goal = isNum(r?.goal) ? r.goal : null;
    if (rule === 'weighted') out.weight = isNum(weightAt(wd.day)) ? weightAt(wd.day) : null;
    out.production = isProductionDay(month, wd.day) !== false;
    if (r?.beforeStart) { out.reason = 'not-tracked'; out.production = false; return out; }
    if (!out.production) {
      // A weekend number that says something (an incident, overtime) still counts toward a total.
      const counts = rule === 'sum' && wd.day <= asOfDay && isNum(out.actual) && out.actual !== 0;
      if (!counts) out.reason = 'no-production';
      return out;
    }
    if (wd.day > asOfDay) { out.reason = 'not-reached'; return out; }
    if (out.actual === null) out.reason = 'not-entered';
    else if (out.goal === null) out.reason = 'no-goal';
    else if (rule === 'weighted' && !(out.weight > 0)) out.reason = 'no-weight';
    return out;
  });

  // Production days the week expects (KPIs added in Board setup: from the day they were added).
  const expectedDays = days.filter((d) => d.production);
  const complete = days.filter((d) => d.reason === null);
  const res = {
    rule,
    kpi,
    days,
    expected: rule === 'weekly-only' ? 1 : expectedDays.length,
    received: 0,
    provisional: false,
    raw: null,
    goal: null,
    goalVaries: false,
    goalValues: [],
    num: null,
    den: null,
    latest: null,
    override: null,
    overrideExpired: null,
    overridden: false,
    needsReapproval: false,
    effective: null,
    mode: 'AUTO',
    status: NOT_ENTERED,
    marks: [],
    met: 0,
    missed: 0,
    missedAll: false,
  };

  // The day goal, when it's the same every counted day; otherwise it varies and needs a period rule.
  const dayGoal = (list) => {
    const goals = [];
    for (const d of list) if (isNum(d.goal) && !goals.some((g) => same(g, d.goal))) goals.push(d.goal);
    res.goalValues = goals;
    if (goals.length > 1) { res.goalVaries = true; return null; }
    return goals[0] ?? null;
  };

  if (rule === 'weekly-only') {
    const w = input?.weekly;
    res.raw = isNum(w?.value) ? w.value : null;
    res.received = res.raw === null ? 0 : 1;
    res.goal = null; // no weekly goal is approved for these measures yet
    res.mode = 'WEEKLY_ONLY';
  } else if (rule === 'sum') {
    complete.forEach((d) => { d.used = true; });
    const extra = days.filter((d) => !d.production && d.reason === null && isNum(d.actual));
    extra.forEach((d) => { d.used = true; });
    const used = [...complete, ...extra];
    res.received = complete.length;
    if (used.length) {
      res.raw = used.reduce((s, d) => s + d.actual, 0);
      res.goal = used.reduce((s, d) => s + (isNum(d.goal) ? d.goal : 0), 0);
    }
  } else if (rule === 'mean') {
    complete.forEach((d) => { d.used = true; });
    res.received = complete.length;
    if (complete.length) {
      res.num = complete.reduce((s, d) => s + d.actual, 0);
      res.den = complete.length;
      res.raw = res.num / res.den;
      res.goal = dayGoal(complete);
    }
  } else if (rule === 'weighted') {
    complete.forEach((d) => { d.used = true; });
    res.received = complete.length;
    if (complete.length) {
      res.num = complete.reduce((s, d) => s + d.actual * d.weight, 0);
      res.den = complete.reduce((s, d) => s + d.weight, 0);
      res.raw = res.den > 0 ? res.num / res.den : null; // zero parts: undefined, never 0%
      res.goal = dayGoal(complete);
    }
  } else if (rule === 'latest') {
    res.received = complete.length;
    const last = complete[complete.length - 1] ?? null;
    if (last) {
      last.used = true;
      res.latest = { iso: last.iso, day: last.day };
      res.raw = last.actual;
      res.goal = dayGoal(complete);
    }
  }

  // Override (spec §9): one effective result; the raw value stays, and a later change to the days
  // flags the override for reapproval instead of silently keeping or dropping it.
  // An override past its expiry date (opts.today, 'YYYY-MM-DD') no longer applies: the calculated value is
  // effective again, and the result says the override expired (spec §9: reason, approver, time and expiry).
  const ov = input?.override;
  const expired = Boolean(ov && ov.expires && opts.today && opts.today > ov.expires);
  res.overrideExpired = expired ? ov : null;
  if (ov && isNum(ov.value) && !expired) {
    res.override = ov;
    res.overridden = true;
    res.mode = 'OVERRIDE';
    // The days changed under it (the calculated value, or how many days are in): it needs approving again.
    res.needsReapproval = (isNum(ov.raw) ? !same(ov.raw, res.raw) : res.raw !== null)
      || (Number.isInteger(ov.received) && ov.received !== res.received);
    res.effective = ov.value;
  } else {
    res.effective = res.raw;
  }

  res.provisional = rule !== 'weekly-only' && res.received < res.expected && res.effective !== null && !res.overridden;
  if (res.effective === null) res.status = NOT_ENTERED;
  else if (res.goalVaries || !isNum(res.goal)) res.status = NO_GOAL;
  else res.status = compareToGoal(res.effective, res.goal, kpi.better);

  // Days on goal, Monday to Friday: each production day judged against its own goal, as the board does.
  if (rule !== 'weekly-only') {
    res.marks = expectedDays.map((d) => ({
      iso: d.iso,
      day: d.day,
      dow: d.dow,
      status: d.reason === 'not-reached' ? 'not-reached' : compareToGoal(d.actual, d.goal, kpi.better),
    }));
    res.met = res.marks.filter((x) => x.status === ON).length;
    res.missed = res.marks.filter((x) => x.status === OFF).length;
    res.missedAll = res.marks.length > 0 && res.missed === res.marks.length;
  }
  return res;
}

/**
 * The repeat gap for one KPI, from its results week by week up to this one (oldest first):
 * every production day missed this week and the weeks before it in a row, or 3 or more days missed.
 * -> { level: 'streak' | 'all' | 'three' | 'none', weeks, missed, days, word }
 */
export function repeatGap(history) {
  const now = history[history.length - 1];
  if (!now) return { level: 'none', weeks: 0, missed: 0, days: 0, word: '' };
  let weeks = 0;
  for (let i = history.length - 1; i >= 0 && history[i]?.missedAll; i -= 1) weeks += 1;
  const days = now.marks.length;
  // Short words for the scoreboard's narrow column; `long` says it in full (View calculation, screen readers, exports).
  if (weeks >= 2) return { level: 'streak', weeks, missed: now.missed, days, word: `Missed every day · ${weeks} weeks`, long: `Missed every production day for ${weeks} weeks` };
  if (weeks === 1) return { level: 'all', weeks, missed: now.missed, days, word: 'Missed every day this week', long: 'Missed every production day this week' };
  if (now.missed >= 3) return { level: 'three', weeks: 0, missed: now.missed, days, word: `Missed ${now.missed} of ${days} days`, long: `Missed ${now.missed} of ${days} production days` };
  return { level: 'none', weeks: 0, missed: now.missed, days, word: '' };
}

/**
 * A function's week, the way the summary reads it: off goal when any of its KPIs is, on goal when every
 * KPI that could be judged met its goal, otherwise not judged (goal varies, not entered).
 */
export function functionWeek(results) {
  if (results.some((r) => r.status === OFF)) return OFF;
  const judged = results.filter((r) => r.status === ON || r.status === OFF);
  return judged.length && judged.length === results.length ? ON : NO_GOAL;
}

/* ---------- Numbers as words ---------- */

/**
 * The places a weekly figure shows: a calculated average one place past the unit's usual (87.2 people),
 * a calculated percent at its goal's precision (weeklyPair: 1.11% against 1.13%), a total of hours to one
 * place (3,037.1), a count of parts or incidents whole. Then, like formatPair, more places until the
 * printed numbers say what the status says. Exports keep the full value.
 */
function weeklyPlaces(value, unit, rule) {
  if (rule === 'mean' || rule === 'weighted') return unit === 'fraction' ? 3 : 1;
  if (rule === 'sum' && unit === 'hours') return 1;
  if (rule === 'sum' && Number.isInteger(Number(value.toFixed(6)))) return 0;
  return null; // as entered: formatPair's own places
}

const nf = new Map();
const numberAt = (v, unit, d) => {
  if (!nf.has(d)) nf.set(d, new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  return unit === 'fraction' ? `${nf.get(d).format(v * 100)}%` : nf.get(d).format(v);
};
const shown = (s) => Number(String(s).replace(/[,%]/g, ''));
/** Decimal places a printed figure shows ("1.13%" → 2). */
const placesOf = (s) => (String(s).replace(/[,%]/g, '').split('.')[1] ?? '').length;

/**
 * A weekly figure and what it's judged against: { actual: '1.11%', rest: 'vs 1.13% goal', goal: '1.13%' }.
 * actual is null when there is no result. A varying goal shows no goal here (the block says why).
 * entered: the value was typed (an override or a weekly value), not calculated.
 */
export function weeklyPair(value, goal, kpi, rule, { entered = false } = {}) {
  const g = isNum(goal) ? goal : null;
  const base = formatPair(value, g, kpi);
  if (!isNum(value)) return { actual: null, rest: base.rest, goal: base.goal };
  // A typed value (an override, a weekly entry) keeps the places a person gives it ("2.10%").
  let d = entered ? null : weeklyPlaces(value, kpi.unit, rule);
  if (d === null) return { actual: base.actual, rest: base.rest, goal: base.goal };
  // A calculated percent reads at its goal's precision ("1.11%" against "1.13%"; 2 places with no goal),
  // and gains a place below only when rounding would read as the goal or flip the comparison.
  if (kpi.unit === 'fraction') d = g !== null ? placesOf(base.goal) : 2;
  // Never let rounding show a met goal as missed, or a miss as met.
  if (g !== null) {
    const met = compareToGoal(value, g, kpi.better) === ON;
    const g0 = shown(base.goal);
    while (d < 6) {
      const a = shown(numberAt(value, kpi.unit, d));
      const reads = kpi.better === 'lower' ? a <= g0 : a >= g0;
      if (reads === met && !(a === g0 && !same(value, g))) break;
      d += 1;
    }
  }
  return { actual: numberAt(value, kpi.unit, d), rest: base.rest, goal: base.goal };
}

/** A plain number at the weekly result's precision (calculation drawer totals: "811.49", "73,100"). */
export function plainNumber(v, places = 2) {
  if (!isNum(v)) return '';
  const d = Math.abs(v - Math.round(v)) < 1e-9 ? 0 : places;
  return numberAt(v, 'number', d);
}
