// Status is calculated, never typed. Pure functions only: no DOM, no storage.
// Inputs are the month object from store.js (or pieces of it).

export const ON = 'on';
export const OFF = 'off';
export const NOT_ENTERED = 'not-entered';
export const NO_GOAL = 'no-goal';
export const NO_PRODUCTION = 'no-production';

// One status language everywhere. OFF reads as the group label "Off goal" in
// summaries and legends; next to a number it says which way it missed.
export const STATUS_WORD = {
  [ON]: 'On track',
  [OFF]: 'Off goal',
  [NOT_ENTERED]: 'Not entered',
  [NO_GOAL]: 'No goal set',
  [NO_PRODUCTION]: 'No production scheduled',
};

/** The word for one measure: "Below goal" when higher is better, "Above goal" when lower is. */
export function statusWord(status, kpi) {
  if (status === OFF && kpi) return kpi.better === 'lower' ? 'Above goal' : 'Below goal';
  return STATUS_WORD[status] ?? '';
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function seriesRow(fn, areaId, day) {
  return (fn?.daily?.[areaId] ?? []).find((r) => r.day === day) ?? null;
}

/**
 * Did the actual meet the goal in the direction that counts?
 * Returns true / false, or null when either number is missing.
 */
export function meetsGoal(actual, goal, better) {
  if (!isNum(actual) || !isNum(goal)) return null;
  return better === 'lower' ? actual <= goal : actual >= goal;
}

/**
 * ON / OFF from a pair of numbers.
 * A missing actual is NOT_ENTERED. An entered actual with no goal is NO_GOAL:
 * someone did enter it, so it must never read "Not entered".
 */
export function compareToGoal(actual, goal, better) {
  if (!isNum(actual)) return NOT_ENTERED;
  if (!isNum(goal)) return NO_GOAL;
  return meetsGoal(actual, goal, better) ? ON : OFF;
}

/**
 * Was production scheduled on this day?
 * Operations' plant parts goal decides (> 0 scheduled, 0 not). When Operations
 * has no goal entered, the Plant earned-hours goal decides the same way.
 * Returns true, false, or null (unknown: callers treat unknown as scheduled).
 */
export function isProductionDay(month, day) {
  const ops = seriesRow(month.functions.find((f) => f.id === 'operations'), 'plant', day);
  if (ops && isNum(ops.goal)) return ops.goal > 0;
  const plant = seriesRow(month.functions.find((f) => f.id === 'plant'), 'plant', day);
  if (plant && isNum(plant.goal)) return plant.goal > 0;
  return null;
}

/**
 * The day's status for one function (Plant total unless an area is given).
 * -> { status, actual, goal, day }
 */
export function dayStatus(month, fn, day, areaId = 'plant') {
  const row = seriesRow(fn, areaId, day);
  const actual = row?.actual ?? null;
  const goal = row?.goal ?? null;
  const compared = compareToGoal(actual, goal, fn.kpiDaily.better);
  if (isProductionDay(month, day) === false && compared !== OFF) {
    // A weekend reads as "No production scheduled", unless a number was
    // entered and misses goal (an incident or a machine down still counts).
    return { status: NO_PRODUCTION, actual, goal, day };
  }
  return { status: compared, actual, goal, day };
}

/** The last production day on or before `day`, or null if there is none yet. */
export function lastProductionDay(month, day) {
  for (let d = day; d >= 1; d -= 1) {
    if (isProductionDay(month, d) !== false) return d;
  }
  return null;
}

/**
 * This month's status for one function, from its month-to-date row.
 * On a no-production day it carries the last production day's row. Before the
 * month's first production day there is nothing to judge yet.
 * -> { status, actual, goal, asOfDay }
 */
export function monthStatus(month, fn, day) {
  const asOfDay = lastProductionDay(month, day);
  if (asOfDay === null) return { status: NO_PRODUCTION, actual: null, goal: null, asOfDay: null };
  const row = (fn.monthToDate ?? []).find((r) => r.day === asOfDay) ?? null;
  const actual = row?.actual ?? null;
  const goal = row?.goal ?? null;
  return { status: compareToGoal(actual, goal, fn.kpiMonthly.better), actual, goal, asOfDay };
}

/**
 * Production days so far this month, judged against the daily goal.
 * -> { met, missed, notEntered, noGoal, days }
 */
export function trackRecord(month, fn, day, areaId = 'plant') {
  const out = { met: 0, missed: 0, notEntered: 0, noGoal: 0, days: 0 };
  for (let d = 1; d <= day; d += 1) {
    if (isProductionDay(month, d) === false) continue;
    out.days += 1;
    const row = seriesRow(fn, areaId, d);
    const s = compareToGoal(row?.actual ?? null, row?.goal ?? null, fn.kpiDaily.better);
    if (s === ON) out.met += 1;
    else if (s === OFF) out.missed += 1;
    else if (s === NO_GOAL) out.noGoal += 1;
    else out.notEntered += 1;
  }
  return out;
}

/**
 * Board summary for a day.
 * -> { productionDay, monthStarted, yesterday: {counts, attention, missing, noGoal}, month: {...} }
 */
export function boardSummary(month, day) {
  const tally = (pick) => {
    const t = { total: 0, [ON]: 0, [OFF]: 0, [NOT_ENTERED]: 0, [NO_GOAL]: 0, [NO_PRODUCTION]: 0, attention: [], missing: [], noGoal: [] };
    for (const fn of month.functions) {
      const s = pick(fn).status;
      t.total += 1;
      t[s] += 1;
      if (s === OFF) t.attention.push(fn);
      if (s === NOT_ENTERED) t.missing.push(fn);
      if (s === NO_GOAL) t.noGoal.push(fn);
    }
    return t;
  };
  return {
    productionDay: isProductionDay(month, day),
    monthStarted: lastProductionDay(month, day) !== null,
    yesterday: tally((fn) => dayStatus(month, fn, day)),
    month: tally((fn) => monthStatus(month, fn, day)),
  };
}
