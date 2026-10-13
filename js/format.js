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

/** { term, definition } from the plant file's glossary for a measure, or null. */
export function glossaryTerm(month, kpi) {
  const g = month.glossary ?? {};
  const label = kpi.boardLabel;
  const key = g[label] ? label
    : label === 'Total DL' ? 'DL'
      : label.startsWith('Earned hours') ? 'Earned hours'
        : null;
  return key && g[key] ? { term: key, definition: g[key] } : null;
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

function decimalsFor(unit, values) {
  const nums = values.filter(isNum);
  if (unit === 'fraction') return Math.min(2, Math.max(1, ...nums.map((v) => decimalsNeeded(v * 100, 2))));
  if (unit === 'hours') return 0;
  if (unit === 'rate') return Math.min(2, Math.max(0, ...nums.map((v) => decimalsNeeded(v, 2))));
  return Math.min(1, Math.max(0, ...nums.map((v) => decimalsNeeded(v, 1))));
}

function formatWith(v, unit, decimals) {
  if (!isNum(v)) return null;
  return unit === 'fraction' ? `${nf(decimals).format(v * 100)}%` : nf(decimals).format(v);
}

export function formatValue(v, unit) {
  return formatWith(v, unit, decimalsFor(unit, [v]));
}

/**
 * Actual vs goal as words.
 * -> { actual, rest, phrase }   { actual: '14,736', rest: 'of 16,980 parts' }
 *                               { actual: '1.19%', rest: 'vs 1.13% goal' }
 * actual is null when the number was not entered.
 */
export function formatPair(actual, goal, kpi) {
  const { unit, better } = kpi;
  let decimals = decimalsFor(unit, [actual, goal]);
  let a = formatWith(actual, unit, decimals);
  let g = formatWith(goal, unit, decimals);
  // Never let rounding make a missed goal look met (e.g. 615.6 vs 616 hours).
  while (a !== null && g !== null && a === g && actual !== goal && decimals < 3) {
    decimals += 1;
    a = formatWith(actual, unit, decimals);
    g = formatWith(goal, unit, decimals);
  }
  const useOf = better === 'higher' && OF_UNITS.has(unit);
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

/** "Goal 16,980" / "Goal 1.13%" / "No goal set" for form fields. */
export function formatGoal(goal, kpi, note) {
  if (note === 'placeholder') return 'Goal not set';
  if (!isNum(goal)) return 'No goal set';
  const g = formatWith(goal, kpi.unit, decimalsFor(kpi.unit, [goal]));
  return `Goal ${g}`;
}

/** Axis ticks: compact from 1,000 up (0 / 8K / 16K), percent for fractions. */
export function formatTick(v, unit, decimals) {
  if (unit === 'fraction') return `${nf(decimals ?? decimalsNeeded(v * 100, 1)).format(v * 100)}%`;
  if (Math.abs(v) >= 1000) return `${nf(decimals ?? decimalsNeeded(v / 1000, 1)).format(v / 1000)}K`;
  return nf(decimals ?? decimalsNeeded(v, 2)).format(v);
}

/** Labels for a set of ticks. Percent ticks share one precision ("0.9%, 1.0%, 1.1%"). */
export function formatTicks(ticks, unit) {
  if (unit !== 'fraction') return ticks.map((v) => formatTick(v, unit));
  // Up to two decimals, so close ticks never print the same label (1.05% vs 1.1%).
  const d = Math.max(0, ...ticks.map((v) => decimalsNeeded(v * 100, 2)));
  return ticks.map((v) => formatTick(v, unit, d));
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

  if (n > 100) return { ok: false, error: "Can't be over 100%." };
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
