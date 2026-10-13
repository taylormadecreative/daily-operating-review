// Display formatting and input parsing. Plain words, real numbers.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Units that read naturally as "X of Y" when higher is better. */
const OF_UNITS = new Set(['parts', 'people', 'hours', 'count', 'number']);
const UNIT_WORD = { parts: 'parts', people: 'people', hours: 'hours' };

/** Board labels that need plain words (meanings from the file's glossary). */
const PLAIN_LABEL = {
  TRIR: 'Recordable injury rate (TRIR)',
  'Total DL': 'Total direct labor',
  'Uptime %': 'Uptime',
  'Earned hours, month to date': 'Earned hours',
};

export function plainLabel(kpi) {
  return PLAIN_LABEL[kpi.boardLabel] ?? kpi.boardLabel;
}

/** { term, definition, name } from the plant file's glossary for a measure, or null (name: the words shown). */
export function glossaryTerm(month, kpi) {
  const g = month.glossary ?? {};
  const label = kpi.boardLabel;
  const key = g[label] ? label
    : label === 'Total DL' ? 'DL'
      : label.startsWith('Earned hours') ? 'Earned hours'
        : null;
  return key && g[key] ? { term: key, definition: g[key], name: plainLabel(kpi) } : null;
}

/**
 * The words a glossary term's info button sits beside ("DL" is shown as "Total direct labor"),
 * so the button is named after what the screen shows: "What does Total direct labor mean?".
 */
export function termName(term) {
  if (term === 'DL') return PLAIN_LABEL['Total DL'];
  return PLAIN_LABEL[term] ?? term;
}

/** Glossary definition for a label, if the plant's file has one. */
export function glossaryFor(month, kpi) {
  return glossaryTerm(month, kpi)?.definition ?? null;
}

/** " · lower is better" for measures where a smaller number is good. */
// Non-breaking spaces keep the dot attached on both sides (no stranded "·").
export const lowerNote = (kpi) => (kpi.better === 'lower' ? '\u00a0·\u00a0lower is better' : '');

export const isPercent = (kpi) => kpi.unit === 'fraction';

function decimalsNeeded(x, max) {
  for (let d = 0; d <= max; d += 1) {
    const scaled = x * 10 ** d;
    if (Math.abs(Math.round(scaled) - scaled) < 1e-6) return d;
  }
  return max;
}

const formatters = new Map();
function nf(decimals) {
  if (!formatters.has(decimals)) {
    formatters.set(decimals, new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  }
  return formatters.get(decimals);
}

/** A number as it's read: percent for a fraction (0.985 -> 98.5). */
const shownScale = (v, unit) => (unit === 'fraction' ? v * 100 : v);

/**
 * The places a unit usually shows, the most any of the values needs: percent 1 or 2 (1.19%, 98.0%);
 * hours whole from 100 up (615.6 reads 616), up to 2 below (a 1.5-hour goal); counts, people, parts,
 * numbers and rates up to 2 (a Cpk of 1.33).
 */
function decimalsFor(unit, values) {
  const nums = values.filter(isNum);
  if (unit === 'fraction') return Math.min(2, Math.max(1, ...nums.map((v) => decimalsNeeded(v * 100, 2))));
  if (unit === 'hours') return Math.max(0, ...nums.map((v) => (Math.abs(v) >= 100 ? 0 : decimalsNeeded(v, 2))));
  return Math.max(0, ...nums.map((v) => decimalsNeeded(v, 2)));
}

/** True when v (as read) has no more than d places. */
const exactAt = (v, unit, d) => {
  const scaled = shownScale(v, unit) * 10 ** d;
  return Math.abs(Math.round(scaled) - scaled) < 1e-6;
};

/**
 * A goal's own places: never fewer than it has, up to 3 ("Goal: ≥ 1.33", "≤ 1.5 hours", "98.5%"),
 * and never fewer than its unit shows. A goal with more than 3 (a running month pace, 4,421.0526
 * hours) shows the unit's usual places; formatPair adds places if that rounding would mislead.
 */
function goalDecimals(unit, goal) {
  const usual = decimalsFor(unit, [goal]);
  if (!isNum(goal)) return usual;
  for (let d = 0; d <= 3; d += 1) if (exactAt(goal, unit, d)) return Math.max(usual, d);
  return usual;
}

function formatWith(v, unit, decimals) {
  if (!isNum(v)) return null;
  return unit === 'fraction' ? `${nf(decimals).format(v * 100)}%` : nf(decimals).format(v);
}

/** A goal (or any number shown on its own) with every place it has, up to 3: "1.33", "1.5", "98.5%". */
export function formatValue(v, unit) {
  return formatWith(v, unit, goalDecimals(unit, v));
}

/** The number a formatted figure shows ("16,980" -> 16980, "98.5%" -> 98.5). */
const shownNumber = (s) => Number(String(s).replace(/[,%]/g, ''));
/** Does "a of g" read as meeting the goal, comparing the two printed numbers as a person would? */
const readsMet = (a, g, better) => (better === 'lower' ? shownNumber(a) <= shownNumber(g) : shownNumber(a) >= shownNumber(g));
// Same rule as status.js meetsGoal, including its hair of tolerance for float noise.
const meets = (actual, goal, better) => {
  const eps = 1e-9 * Math.max(1, Math.abs(goal));
  return better === 'lower' ? actual <= goal + eps : actual >= goal - eps;
};

/** The most places an actual takes to show why it met or missed its goal (1.3299 vs 1.33). */
const MAX_DECIMALS = 6;

/**
 * Actual vs goal as words.
 * -> { actual, rest, phrase }   { actual: '14,736', rest: 'of 16,980 parts' }
 *                               { actual: '1.19%', rest: 'vs 1.13% goal' }
 * actual is null when the number was not entered.
 */
export function formatPair(actual, goal, kpi) {
  const { unit, better } = kpi;
  // The goal keeps its own places: "82.5 of 89 people", not "of 89.0"; "1.31 of 1.33", not "of 1.3"
  // (a percent goal keeps its one place, "98.0%", as everywhere else).
  const own = goalDecimals(unit, goal);
  const goalExact = isNum(goal) && exactAt(goal, unit, own);
  // The actual shows at least the goal's places, so the two read on one scale ("1.6 vs 1.5 goal").
  const start = Math.max(decimalsFor(unit, [actual, goal]), isNum(goal) ? own : 0);
  // A goal rounded to its unit's places (a running pace) takes the actual's extra places with it.
  const at = (d) => ({ a: formatWith(actual, unit, d), g: formatWith(goal, unit, goalExact ? own : Math.max(own, d)) });
  // Never let rounding make a missed goal look met, or a met one missed: the actual takes more places
  // until the printed numbers say what the status says ("615.6 of 616 hours", "1.3299 of 1.33"), and
  // until it no longer prints the same as a goal it differs from.
  const clear = (d) => {
    const { a, g } = at(d);
    if (a === null || g === null || actual === goal) return true;
    return formatWith(actual, unit, d) !== formatWith(goal, unit, d) && readsMet(a, g, better) === meets(actual, goal, better);
  };
  let decimals = start;
  while (!clear(decimals) && decimals < MAX_DECIMALS) decimals += 1;
  // Nothing short of the float noise tells them apart: the usual places, not a row of zeros.
  if (!clear(decimals)) decimals = start;
  const { a, g } = at(decimals);
  // "of 0 parts" says nothing: a goal of 0 reads "14,736 vs 0 goal" (the goal line reads "Goal: ≥ 0").
  const useOf = better === 'higher' && OF_UNITS.has(unit) && goal !== 0;
  const word = UNIT_WORD[unit] ? ` ${UNIT_WORD[unit]}` : '';

  const parts = { goal: g, useOf, word: word.trim() };
  if (a === null) {
    const rest = g === null ? 'No goal set' : `Goal ${g}${useOf ? word : ''}`;
    return { actual: null, rest, phrase: `Not entered. ${rest}`, ...parts };
  }
  // No goal: show just the number; the status line already says "No goal set".
  if (g === null) return { actual: a, rest: word.trim(), phrase: `${a}${word}, no goal set`, ...parts };
  const rest = useOf ? `of ${g}${word}` : `vs ${g} goal`;
  return { actual: a, rest, phrase: `${a} ${rest}`, ...parts };
}

/**
 * "Goal ≥ 16,980" / "Goal ≤ 1.13%" / "Goal 0" / "No goal set" for form fields: the direction as the
 * board shows it (≥ when higher is better, ≤ when lower is, nothing on a lower-is-better goal of 0).
 */
export function formatGoal(goal, kpi, note) {
  if (note === 'placeholder') return 'Goal not set';
  if (!isNum(goal)) return 'No goal set';
  const g = formatWith(goal, kpi.unit, goalDecimals(kpi.unit, goal));
  return `Goal ${goalSign(goal, kpi)}${g}`;
}

/** "≥ " or "≤ " before a goal (none on a lower-is-better goal of 0: "≤ 0" says nothing more than "0"). */
export function goalSign(goal, kpi) {
  if (kpi.better === 'lower') return goal === 0 ? '' : '≤\u00a0';
  return '≥\u00a0';
}

/** Compact steps for axis ticks, largest first. */
const TICK_STEPS = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];

/** Axis ticks: compact from 1,000 up (0 / 8K / 16K, 2.5M, 1B), percent for fractions. */
export function formatTick(v, unit, decimals) {
  if (unit === 'fraction') return `${nf(decimals ?? decimalsNeeded(v * 100, 1)).format(v * 100)}%`;
  const step = TICK_STEPS.find(([n]) => Math.abs(v) >= n);
  if (step) return `${nf(decimals ?? decimalsNeeded(v / step[0], 1)).format(v / step[0])}${step[1]}`;
  return nf(decimals ?? decimalsNeeded(v, 2)).format(v);
}

/** The smallest gap between two different ticks (0 when there is only one value). */
function tickStep(ticks) {
  const sorted = [...new Set(ticks)].sort((a, b) => a - b);
  let step = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > 0 && (!step || gap < step)) step = gap;
  }
  return step;
}

/** True when two labels print the same (close ticks rounded together). */
const repeats = (labels) => new Set(labels).size < labels.length;

/**
 * Labels for a set of ticks, all at one shared precision. Percent: "0.9%, 1.0%, 1.1%".
 * From 1,000 up, one divisor picked from the largest tick and the decimals from the step
 * ("1.18K, 1.20K, 1.22K, 1.24K"; "0, 5K, 10K"; "1.18B, 1.24B"), so close ticks never print
 * the same label. If they still would, the full numbers ("1,180, 1,240").
 */
export function formatTicks(ticks, unit) {
  const nums = ticks.filter(isNum);
  if (unit === 'fraction') {
    // Up to two decimals, so close ticks never print the same label (1.05% vs 1.1%).
    const d = Math.max(0, ...nums.map((v) => decimalsNeeded(v * 100, 2)));
    return ticks.map((v) => formatTick(v, unit, d));
  }
  // The baseline reads "0" at any precision.
  const full = () => {
    const d = Math.max(0, ...nums.map((v) => decimalsNeeded(v, 2)));
    return ticks.map((v) => (!isNum(v) ? '' : v === 0 ? '0' : nf(d).format(v)));
  };
  const largest = Math.max(0, ...nums.map((v) => Math.abs(v)));
  const compact = TICK_STEPS.find(([n]) => largest >= n);
  if (!compact) return full();
  const [div, suffix] = compact;
  const step = tickStep(nums);
  const d = step ? decimalsNeeded(step / div, 3) : Math.max(0, ...nums.map((v) => decimalsNeeded(v / div, 3)));
  const labels = ticks.map((v) => (!isNum(v) ? '' : v === 0 ? '0' : `${nf(d).format(v / div)}${suffix}`));
  if (repeats(labels)) return full();
  // A compact label longer than the number itself ("12.001K" for 12,001) says less: the full numbers.
  const plain = full();
  return labels.some((l, i) => l.length > plain[i].length) ? plain : labels;
}

/* ---------- Form input ---------- */

/** Stored value -> what a person types ("1.19" for 0.0119). */
export function toInputValue(v, kpi) {
  if (!isNum(v)) return '';
  const n = isPercent(kpi) ? v * 100 : v;
  return String(Number(n.toFixed(4)));
}

/**
 * Normalize separators. A lone comma is a decimal ("97,5" = 97.5), except in a
 * count where it is clearly a thousands separator ("14,736" parts). Several
 * commas, or commas with a dot, are thousands separators.
 */
function normalizeNumber(raw, kpi) {
  let t = raw.replace(/\s+/g, '').replace(/%$/, '');
  const commas = (t.match(/,/g) ?? []).length;
  if (commas === 1 && !t.includes('.')) {
    const thousands = !isPercent(kpi) && /^-?\d{1,3},\d{3}$/.test(t);
    t = thousands ? t.replace(',', '') : t.replace(',', '.');
  } else {
    t = t.replace(/,/g, '');
  }
  return t;
}

/**
 * What a person typed -> stored value.
 * -> { ok: true, value: number|null, suggest?: string } or { ok: false, error }
 * `suggest` is a likely intended entry for a percent box (typed 0.975, meant 97.5).
 */
export function parseInput(text, kpi, goal = null) {
  const raw = String(text ?? '').trim();
  if (raw === '') return { ok: true, value: null };
  const cleaned = normalizeNumber(raw, kpi);
  const example = isPercent(kpi) ? '97.5' : kpi.unit === 'parts' ? '14736' : '12';
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(cleaned)) {
    return { ok: false, error: `Use numbers only, like ${example}.` };
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { ok: false, error: `Use numbers only, like ${example}.` };
  if (n < 0) return { ok: false, error: 'Use 0 or more.' };
  if (!isPercent(kpi)) return { ok: true, value: n };

  if (n > 1000) return { ok: false, error: "Can't be over 1,000%." };
  const value = Number((n / 100).toFixed(8));
  const out = { ok: true, value };
  // Likely slip: a fraction typed into a percent box. Only ask when the
  // percent reading sits much closer to the goal than the number as typed
  // (uptime goal 98%: "0.975" -> 97.5%). Scrap of 0.98% against a 1.13% goal
  // is a real reading and gets no question.
  const goalPct = isNum(goal) ? goal * 100 : null;
  if (n > 0 && n < 1 && goalPct !== null && goalPct >= 1) {
    const asTyped = Math.abs(Math.log(n / goalPct));
    const asPercent = Math.abs(Math.log((n * 100) / goalPct));
    if (asPercent < asTyped && asPercent < Math.log(2)) out.suggest = String(Number((n * 100).toFixed(4)));
  }
  return out;
}

/* ---------- Dates (calendar data: format in UTC) ---------- */

function utcDate(month, day) {
  const [y, m] = month.month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

const LONG = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const MEDIUM = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });
const MONTH_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/** "Fri, Feb 27, 2026" */
export const formatDayLong = (month, day) => LONG.format(utcDate(month, day));
/** "Fri, Feb 27" */
export const formatDayMedium = (month, day) => MEDIUM.format(utcDate(month, day));
/** "February" */
export const formatMonthName = (month) => MONTH.format(utcDate(month, 1));
/** "Feb" */
export const formatMonthShort = (month) => MONTH_SHORT.format(utcDate(month, 1));
/** "February so far" */
export const monthSoFar = (month) => `${formatMonthName(month)} so far`;

/** 0 = Sunday ... 6 = Saturday */
export const weekday = (month, day) => utcDate(month, day).getUTCDay();

function localIso(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/**
 * Relative words only when they are true on this device's clock.
 * -> 'today' | 'yesterday' | null
 */
export function relativeDay(month, day, now = new Date()) {
  const iso = `${month.month}-${String(day).padStart(2, '0')}`;
  if (iso === localIso(now)) return 'today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (iso === localIso(y)) return 'yesterday';
  return null;
}

/** Column heading: "Yesterday", "Today" or "Fri, Feb 27". */
export function dayHeading(month, day) {
  const rel = relativeDay(month, day);
  if (rel === 'today') return 'Today';
  if (rel === 'yesterday') return 'Yesterday';
  return formatDayMedium(month, day);
}

/** Inside a sentence: "yesterday", "today" or "on Fri, Feb 27". */
export function daySentence(month, day, prep = 'for') {
  // Non-breaking spaces keep "Fri, Feb 27" on one line.
  return relativeDay(month, day) ?? `${prep} ${formatDayMedium(month, day).replace(/ /g, '\u00a0')}`;
}

/** "6:41 AM", or "Oct 9, 6:41 AM" when it was not today. */
export function formatEnteredAt(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (localIso(d) === localIso(now)) return time;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}
