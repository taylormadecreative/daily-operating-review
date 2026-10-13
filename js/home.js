// Home dashboard (Nelson's reference layout): the one-line answer, KPI cards,
// the function × area matrix, trends and key metrics, issues and actions,
// and the daily questions. Every number is calculated from the month.

import { dailySeries, isoForDay, notesFor, noteParagraphs, entryInfo, hasProblem, kpiRowsFor, NO_ISSUE } from './store.js?v=20261013-151156';
import {
  ON, OFF, NOT_ENTERED, NO_GOAL, NO_PRODUCTION, NOT_TRACKED, STATUS_WORD,
  dayStatus, monthStatus, isProductionDay, compareToGoal, boardSummary, statusWord,
} from './status.js?v=20261013-151156';
import {
  formatPair, glossaryTerm, formatDayLong, formatDayMedium, formatEnteredAt, formatTicks, dayHeading, plainLabel,
} from './format.js?v=20261013-151156';
import { esc, termButton, GLYPH, issueStatusMarkup } from './ui.js?v=20261013-151156';
import { icon } from './icons.js?v=20261013-151156';
import { getUndoable, plantName, actionStateFor, needsSummary, ACTION_WORD, recordedOn, issueGap, ISSUE_GAP_WORD, NO_FUNCTIONS } from './board.js?v=20261013-151156';
import { getIdentity } from './identity.js?v=20261013-151156';
import { pageHref } from './shell.js?v=20261013-151156';

export const AREA_OPTIONS = [
  { id: 'all', name: 'All areas' },
  { id: 'mold', name: 'Mold' },
  { id: 'bond', name: 'Bond' },
  { id: 'prime', name: 'Prime' },
  { id: 'compounding', name: 'Compounding' },
];
const AREA_COLS = ['mold', 'bond', 'prime', 'compounding'];
export const areaName = (id) => AREA_OPTIONS.find((a) => a.id === id)?.name ?? 'All areas';

/** One status language everywhere ("Below goal" / "Above goal" for a miss). */
export const homeWord = statusWord;

// One glyph set everywhere (the sprite's g-* symbols): dot, dot with "!", ring, diamond, pause.
const mdot = (status) => `<svg class="mdot mdot--${status}" aria-hidden="true" focusable="false"><use href="#${GLYPH[status]}"></use></svg>`;
const statusLine = (status, kpi, cls = 'hs') => `<p class="${cls} hs--${status}">${mdot(status)}<span>${esc(statusWord(status, kpi))}</span></p>`;

const href = (month, day, fnId) => pageHref(month, day, { view: 'home', hash: fnId });
/**
 * "People · Fri, Feb 27": a narrow card wraps at the dot, never inside a date. The function's
 * name (first) may wrap on its own: Board setup allows 60 characters, wider than a card.
 */
const tagMarkup = (when) => when.split(' · ').map((part, i) => (i === 0 ? `<span class="kc-tag-fn">${esc(part)}</span>` : `<span class="nowrap">${esc(part)}</span>`)).join(' · ');
// The dashboard's fixed cards and tiles name a workbook function. When Board setup
// hides that function, its cards are skipped (never a link to a page that isn't there).
const byId = (month, id) => month.functions.find((f) => f.id === id) ?? null;
const actualOn = (fn, areaId, day) => (fn.daily?.[areaId] ?? []).find((r) => r.day === day)?.actual;
/**
 * The board's rule for a day with no production (board.js weekendFigure): a figure shows
 * only when it says something. No number, or the workbook's weekend 0 ("0 / Goal 0",
 * "0 of 0 hours"), is no figure at all.
 */
const noFigure = (status, actual) => status === NO_PRODUCTION && !(typeof actual === 'number' && actual !== 0);

/* ---------- The one-line answer (header subtitle) ---------- */

/**
 * "4 of 8 functions on track for Fri, Feb 27 · Off goal: People, …", each
 * function a link to its Detail. Plant totals decide it, as on the DOR board.
 */
function summaryMarkup(month, day, area) {
  const s = boardSummary(month, day);
  const y = s.yesterday;
  const link = (fn) => `<a class="h-sum-link" href="${href(month, day, fn.id)}" data-open-detail="${esc(fn.id)}">${esc(fn.name)}</a>`;
  const names = (list) => list.map(link).join(', ');
  // The date control sits right beside this sentence, so the date is said, not shown twice.
  const when = `<span class="sr-only"> for ${esc(formatDayMedium(month, day))}</span>`;
  // With an area picked, the sentence still judges plant totals, and says so.
  const parts = [s.productionDay === false
    ? `<strong>No production scheduled</strong>${when}`
    : area === 'all'
      ? `<strong>${y[ON]} of ${y.total} functions on track</strong>${when}`
      : `<strong>${y[ON]} of ${y.total} on track</strong> (plant totals)${when}`];
  if (y.attention.length) parts.push(`Off goal: ${names(y.attention)}`);
  if (y.noGoal.length) parts.push(`No goal set: ${names(y.noGoal)}`);
  if (y.missing.length && s.productionDay !== false) parts.push(`Not entered: ${names(y.missing)}`);
  if (s.productionDay !== false && !y.attention.length && !y.noGoal.length && !y.missing.length) parts.push('Nothing off goal');
  return parts.join('<span class="h-sum-sep" aria-hidden="true"> · </span><span class="sr-only">. </span>');
}

/**
 * The board's needs line, under the one-line answer: "2 off-goal KPIs have no
 * action yet: People, Engineering." (red, off glyph; each KPI a link to its
 * Detail), or the green all-clear. Empty when neither applies.
 */
function needsMarkup(month, day) {
  let sum;
  try { sum = needsSummary(month, day); } catch { return ''; }
  if (sum.list.length) {
    const links = sum.list.map((x) => `<a class="h-sum-link" href="${href(month, day, x.k.id)}" data-open-detail="${esc(x.k.id)}">${esc(x.label)}</a>`);
    return `<span class="h-needs-lead hs--off">${mdot(OFF)}${esc(sum.lead)}</span> ${links.join(', ')}.`;
  }
  if (sum.allClear) return `<span class="h-needs-lead hs--on">${mdot(ON)}${esc(sum.lead)}</span>`;
  return '';
}

/* ---------- KPI cards ---------- */

const KPI_CARDS = [
  { fn: 'safety', kind: 'day', label: 'Safety & EHS incidents', icon: 'shield' },
  { fn: 'safety', kind: 'month', label: 'Recordable injury rate (TRIR)', icon: 'fileText' },
  { fn: 'people', kind: 'day', label: 'Clocked in', icon: 'users' },
  { fn: 'people', kind: 'month', label: 'Total direct labor', icon: 'idCard' },
  { fn: 'quality', kind: 'day', label: 'Quality incidents', icon: 'badgeCheck' },
  { fn: 'quality', kind: 'month', label: 'Customer complaints', icon: 'message' },
  { fn: 'engineering', kind: 'day', label: 'Scrap %', icon: 'barChart' },
  { fn: 'maintenance', kind: 'month', label: 'Uptime', icon: 'activity' },
];

/**
 * Status and numbers for a function's daily or monthly measure, area-aware.
 * `when` names the function and the period ("People · Fri, Feb 27",
 * "Safety · Month to date"), plus the area when one is picked; monthly
 * measures don't split by area ("Plant total").
 */
function measure(month, fn, day, kind, area) {
  if (kind === 'month') {
    const s = monthStatus(month, fn, day);
    return { ...s, kpi: fn.kpiMonthly, when: `${fn.name} · Month to date${area === 'all' ? '' : ' · Plant total'}` };
  }
  const areaId = area === 'all' ? 'plant' : area;
  const s = dayStatus(month, fn, day, areaId);
  return { ...s, kpi: fn.kpiDaily, when: `${fn.name} · ${dayHeading(month, day)}${area === 'all' ? '' : ` · ${areaName(area)}`}` };
}

/**
 * The number and its goal. With no number, one honest line takes the value's
 * place: "Not entered" (small) and the goal in its own element, or "No goal
 * set"; never the goal where the number belongs. Returns { html, inline }:
 * inline = the line already says the status, so the card skips its status line.
 */
function valueBlock(m, { style = 'slash', card = false } = {}) {
  const f = formatPair(m.actual, m.goal, m.kpi);
  if (noFigure(m.status, m.actual)) {
    return { inline: true, html: `<p class="kc-value kc-value--empty hs--${m.status}">${mdot(m.status)}<span class="kc-empty">No production scheduled</span></p>` };
  }
  if (f.actual === null) {
    return {
      inline: true,
      html: `<p class="kc-value kc-value--empty hs--${NOT_ENTERED}">${mdot(NOT_ENTERED)}<span class="kc-empty">Not entered</span>`
        + `<span class="kc-goal">${f.goal === null ? 'No goal set' : `Goal ${esc(f.goal)}`}</span></p>`,
    };
  }
  if (f.useOf && f.goal !== null) {
    const sep = style === 'of' ? ' of ' : ' / ';
    // The space before the goal sits outside the no-wrap span, so a narrow tile can break there.
    // A KPI card also carries "Goal 89": a narrow row of cards stacks every goal under its figure
    // the same way (home.css swaps "/ 89" for it below 1600px, or with .is-stacked, fitKpiCards).
    return {
      inline: false,
      html: `<p class="kc-value${card ? ' kc-value--of' : ''}"><strong>${esc(f.actual)}</strong>${sep.startsWith(' ') ? ' ' : ''}<span class="kc-of" aria-hidden="true">${sep.trimStart()}${esc(f.goal)}</span>`
        + `${card ? `<span class="kc-under" aria-hidden="true">Goal ${esc(f.goal)}</span>` : ''}`
        + `<span class="sr-only">, goal ${esc(f.goal)}${f.word ? ` ${esc(f.word)}` : ''}</span></p>`,
    };
  }
  return {
    inline: false,
    html: `<p class="kc-value"><strong>${esc(f.actual)}</strong>`
      + `<span class="kc-goal">${f.goal === null ? 'No goal set' : `Goal ${esc(f.goal)}`}</span></p>`,
  };
}

/**
 * A card's or tile's "What does it mean?" button, right after its name. A word joiner (U+2060)
 * glues it to the name's last word (as on the board), and the name gets the card's whole
 * width beside the icon, so a word like "Recordable" isn't squeezed by a button beside it.
 */
const termAfter = (t) => (t ? `\u2060${termButton(t.term, t.definition)}` : '');

/**
 * The name a card or tile shows: its own label ("Recordable injury rate (TRIR)"),
 * or the KPI's new name when Board setup renamed the workbook KPI.
 */
function shownLabel(fn, kind, fallback) {
  const kpi = kind === 'month' ? fn.kpiMonthly : fn.kpiDaily;
  const source = kind === 'month' ? fn.sourceMonthLabel : fn.sourceDayLabel;
  return source && kpi?.boardLabel && kpi.boardLabel !== source ? plainLabel(kpi) : fallback;
}

function kpiCard(month, day, area, spec) {
  const fn = byId(month, spec.fn);
  if (!fn) return ''; // hidden in Board setup
  const m = measure(month, fn, day, spec.kind, area);
  const t = glossaryTerm(month, m.kpi);
  const v = valueBlock(m, { card: true });
  const label = shownLabel(fn, spec.kind, spec.label);
  return `
    <article class="kcard" data-status="${m.status}" data-fn="${esc(fn.id)}" data-kpi="${esc(spec.label)}">
      <div class="kc-head">
        <span class="kc-icon kc-icon--${m.status}">${icon(spec.icon)}</span>
        <div class="kc-name"><h3 class="kc-label"><a class="kc-link" href="${href(month, day, fn.id)}" data-open-detail="${esc(fn.id)}">${esc(label)}<span class="sr-only">, ${esc(m.when)}</span></a></h3>${termAfter(t)}</div>
      </div>
      <p class="kc-tag" aria-hidden="true">${tagMarkup(m.when)}</p>
      ${v.html}
      ${v.inline ? '' : statusLine(m.status, m.kpi, 'hs kc-status')}
    </article>`;
}

/**
 * From 1600px up each goal sits beside its figure. When any one card's goal would
 * wrap under its figure, every card stacks its goal instead (as below 1600px), so
 * the figures and goals stay in line across the row.
 */
function fitKpiCards(kpis) {
  kpis.classList.remove('is-stacked');
  if (kpis.hidden || matchMedia('(max-width: 1599px)').matches) return;
  const wraps = [...kpis.querySelectorAll('.kc-value:not(.kc-value--empty)')].some((v) => {
    const fig = v.querySelector('strong');
    const goal = v.querySelector('.kc-goal');
    return Boolean(fig && goal) && goal.offsetTop > fig.offsetTop + fig.offsetHeight / 2;
  });
  kpis.classList.toggle('is-stacked', wraps);
}
let kpiWidth = 0;
const kpiObserver = 'ResizeObserver' in window ? new ResizeObserver((entries) => {
  for (const e of entries) {
    const w = Math.round(e.contentRect.width);
    if (w !== kpiWidth) { kpiWidth = w; fitKpiCards(e.target); }
  }
}) : null;

/* ---------- Function × area matrix ---------- */

/**
 * The grid always fits its panel. Names keep their width up to about 14ch (home.css); when
 * long ones from Board setup would still push the status columns out of view, .mx--fit lets
 * the names wrap narrower and keeps each status column at its own width. Measured with the
 * class off first, so a wider screen goes back to the usual layout.
 */
function fitMatrix(scroll) {
  const table = scroll?.querySelector('.mx');
  if (!table || !scroll.isConnected) return;
  table.classList.remove('mx--fit');
  if (scroll.clientWidth && scroll.scrollWidth > scroll.clientWidth + 1) table.classList.add('mx--fit');
}
let mxWidth = 0;
const mxObserver = 'ResizeObserver' in window ? new ResizeObserver((entries) => {
  for (const e of entries) {
    const w = Math.round(e.contentRect.width);
    if (w !== mxWidth) { mxWidth = w; fitMatrix(e.target); }
  }
}) : null;

function cellLabel(areaLabel, fn, s, kpi) {
  const f = formatPair(s.actual, s.goal, kpi);
  const nums = noFigure(s.status, s.actual) ? '' : f.actual === null ? (f.goal === null ? '' : `, goal ${f.goal}`) : `, ${f.phrase}`;
  // "Plant total, People, Clocked in: below goal, 82 of 89 people": the tip names the KPI it judges.
  return `${areaLabel}, ${fn.name}, ${plainLabel(kpi)}: ${statusWord(s.status, kpi).toLowerCase()}${nums}`;
}

/** A function added in Board setup has a plant total only: its area cells say so, quietly. */
const tracksAreas = (fn) => !fn.custom;

/**
 * The last day, `from` or earlier, on which the board had area numbers: at least half
 * the functions with areas entered one (one leftover column doesn't count). Null when none.
 */
function lastAreaDay(month, from) {
  const byArea = month.functions.filter(tracksAreas);
  const enough = Math.ceil(byArea.length / 2);
  const hadAreas = (d) => byArea.filter((fn) => AREA_COLS.some((a) => typeof actualOn(fn, a, d) === 'number')).length >= enough;
  for (let d = from; d >= 1; d -= 1) if (hadAreas(d)) return d;
  return null;
}

/**
 * A production day on which no function has a single area number: every area cell
 * would be an empty ring, so the four columns give way to one line instead.
 */
function noAreasToday(month, day) {
  const byArea = month.functions.filter(tracksAreas);
  if (!byArea.length || isProductionDay(month, day) === false) return false;
  return byArea.every((fn) => AREA_COLS.every((a) => typeof actualOn(fn, a, day) !== 'number'));
}

/**
 * One status per function, the summary's rule: off goal when any of its KPIs
 * is, else its workbook KPI's status. `kind` 'day' or 'month'.
 * -> { status, rows: [{ k, kpi, s }], off: [same], several }
 */
function fnStatus(month, fn, day, kind) {
  const rows = kpiRowsFor(fn).map((k) => ({
    k,
    kpi: kind === 'month' ? k.kpiMonthly : k.kpiDaily,
    s: kind === 'month' ? monthStatus(month, k, day) : dayStatus(month, k, day),
  }));
  const off = rows.filter((r) => r.s.status === OFF);
  return { status: off.length ? OFF : rows[0].s.status, rows, off, several: rows.length > 1 };
}

/**
 * The words behind a function's dot. With several KPIs it names each one, so
 * "off goal" always says which KPI missed:
 * "Plant total, Safety: off goal. Safety incidents: on track, 0 vs 0 goal; Near-miss cards: below goal, 2 of 5".
 */
function fnLabel(areaLabel, fn, fs) {
  if (!fs.several) return cellLabel(areaLabel, fn, fs.rows[0].s, fs.rows[0].kpi);
  const each = fs.rows.map(({ s, kpi }) => {
    const f = formatPair(s.actual, s.goal, kpi);
    const nums = f.actual === null || noFigure(s.status, s.actual) ? '' : `, ${f.phrase}`;
    return `${plainLabel(kpi)}: ${statusWord(s.status, kpi).toLowerCase()}${nums}`;
  });
  return `${areaLabel}, ${fn.name}: ${STATUS_WORD[fs.status].toLowerCase()}. ${each.join('; ')}`;
}

/** "(Near-miss cards)" under an off-goal dot when the function has several KPIs. */
function offNote(fs) {
  if (!fs.several || fs.status !== OFF) return '';
  const name = fs.off.length === 1 ? plainLabel(fs.off[0].kpi) : `${fs.off.length} KPIs`;
  return `<span class="mcell-kpi" aria-hidden="true">(${esc(name)})</span>`;
}

/** A function's dot in the Plant total or Month so far column. */
function fnCell(month, fn, day, kind) {
  const fs = fnStatus(month, fn, day, kind);
  const label = fnLabel(kind === 'month' ? 'Month so far' : 'Plant total', fn, fs);
  return `<td class="mcell mcell--${kind === 'month' ? 'month' : 'plant'}"><span class="mcell-in" role="img" aria-label="${esc(label)}" data-tip="${esc(label)}">${mdot(fs.status)}</span>${offNote(fs)}</td>`;
}

function matrixRow(month, day, area, fn, gapCell = null) {
  // gapCell: no area numbers today. The one line sits in a row of its own above the functions
  // (areaGapRow), spanning every row; the function rows skip the column.
  const cells = gapCell !== null ? gapCell : !tracksAreas(fn)
    ? `<td class="mcell mcell--untracked" colspan="${AREA_COLS.length}"><span class="mcell-none">Not tracked<span class="sr-only"> by area for ${esc(fn.name)}</span></span></td>`
    : AREA_COLS.map((a) => {
      const s = dayStatus(month, fn, day, a);
      const label = cellLabel(areaName(a), fn, s, fn.kpiDaily);
      return `<td class="mcell${area === a ? ' is-area' : ''}"><span class="mcell-in" role="img" aria-label="${esc(label)}" data-tip="${esc(label)}">${mdot(s.status)}</span></td>`;
    }).join('');
  return `<tr data-home-row="${esc(fn.id)}">
      <th scope="row"><a class="mx-link" href="${href(month, day, fn.id)}" data-open-detail="${esc(fn.id)}"><span class="mx-cap">${esc(fn.name)}</span></a></th>
      <td class="mx-owner"><span class="mx-cap">${esc(fn.owner)}</span></td>
      ${cells}
      ${fnCell(month, fn, day, 'day')}
      ${fnCell(month, fn, day, 'month')}
    </tr>`;
}

/**
 * The matrix subtitle tells the truth about the area columns, from the data:
 * "Areas last entered Thu, Feb 12 · all plant totals entered" when today's area
 * cells are empty, back to "Status by production area" when every one is in.
 */
export function areaNote(month, day) {
  // Functions added in Board setup have no areas, so they never make areas look missing.
  const byArea = month.functions.filter(tracksAreas);
  const missing = byArea.some((fn) => AREA_COLS.some((a) => dayStatus(month, fn, day, a).status === NOT_ENTERED));
  if (!missing) return 'Status by production area';
  // "Last entered" means the board as a whole (lastAreaDay).
  const last = lastAreaDay(month, day);
  const plantIn = month.functions.every((fn) => dayStatus(month, fn, day).status !== NOT_ENTERED);
  const tail = plantIn ? 'all plant totals entered' : 'some plant totals not entered yet';
  // The grid's one line already says when areas were last entered.
  if (noAreasToday(month, day)) return `${tail.charAt(0).toUpperCase()}${tail.slice(1)}`;
  if (last === null) return `No area numbers yet this month · ${tail}`;
  if (last === day) return `Some areas not entered · ${tail}`;
  return `Areas last entered ${formatDayMedium(month, last)} · ${tail}`;
}

function matrixPanel(month, day, area) {
  const gap = noAreasToday(month, day);
  const present = new Set();
  for (const fn of month.functions) {
    if (tracksAreas(fn) && !gap) for (const a of AREA_COLS) present.add(dayStatus(month, fn, day, a).status);
    present.add(fnStatus(month, fn, day, 'day').status);
    present.add(fnStatus(month, fn, day, 'month').status);
  }
  const legend = [[ON, 'On track'], [OFF, 'Off goal'], [NOT_ENTERED, 'Not entered']];
  if (present.has(NO_GOAL)) legend.push([NO_GOAL, 'No goal set']);
  if (present.has(NO_PRODUCTION)) legend.push([NO_PRODUCTION, 'No production scheduled']);
  if (present.has(NOT_TRACKED)) legend.push([NOT_TRACKED, STATUS_WORD[NOT_TRACKED]]);
  return `
    <section class="panel panel--matrix" aria-labelledby="mx-title">
      <header class="panel-head">
        <span class="panel-icon">${icon('users')}</span>
        <div class="panel-titles"><h2 class="panel-title" id="mx-title">Function performance</h2><p class="panel-sub" data-area-note>${esc(areaNote(month, day))}</p></div>
        <ul class="mx-legend" aria-label="Legend">${legend.map(([s, w]) => `<li>${mdot(s)}<span>${w}</span></li>`).join('')}</ul>
      </header>
      <div class="mx-scroll">
        <table class="mx">
          <caption class="sr-only">Status for ${esc(formatDayMedium(month, day))} by function and production area, with the plant total and the month so far.</caption>
          <thead><tr>
            <th scope="col">Function</th><th scope="col" class="mx-owner">Owner</th>
            ${gap ? '<th scope="col" class="mx-areas-gap-head">By area</th>' : AREA_COLS.map((a) => `<th scope="col" class="mx-st${area === a ? ' is-area' : ''}">${a === 'compounding'
    ? '<span class="col-full">Compounding</span><span class="col-abbr" aria-hidden="true">Comp.</span><span class="sr-only col-abbr-sr">Compounding</span>'
    : esc(areaName(a))}</th>`).join('')}
            <th scope="col" class="mx-st mx-wrap">Plant total</th><th scope="col" class="mx-st mx-wrap">Month so far</th>
          </tr></thead>
          <tbody>${gap ? areaGapRow(month, day) : ''}${month.functions.map((fn) => matrixRow(month, day, area, fn, gap ? '' : null)).join('')}</tbody>
        </table>
      </div>
    </section>`;
}

/**
 * The one line in place of the four area columns: "Areas were last entered
 * Thu, Feb 12. See that day." (a link to that day), spanning every row.
 * It starts in a row of its own with no height, above the first function, so
 * "See that day" comes before the function links in reading and Tab order
 * (in the first function's row it sat between Safety and People). The empty
 * cells beside it keep the columns in place (Owner hides with its column on a phone).
 */
function areaGapRow(month, day) {
  const last = lastAreaDay(month, day - 1);
  const text = last === null
    ? 'No area numbers yet this month.'
    : `Areas were last entered <span class="nowrap">${esc(formatDayMedium(month, last))}</span>. <span class="nowrap"><a class="mx-gap-link" href="${pageHref(month, last, { view: 'home' })}" data-go-day="${last}">See that day<span class="sr-only">, ${esc(formatDayMedium(month, last))}</span></a>.</span>`;
  return `<tr class="mx-gaprow"><td class="mx-gaprow-pad"></td><td class="mx-gaprow-pad mx-owner"></td>`
    + `<td class="mcell mcell--areas-gap" rowspan="${month.functions.length + 1}"><p class="mx-gap">${text}</p></td>`
    + '<td class="mx-gaprow-pad"></td><td class="mx-gaprow-pad"></td></tr>';
}

/* ---------- Trends & key metrics ---------- */

function tile({ month, day, fn, label, iconName, body, status, kpi, when, showStatus = true, wide = false }) {
  const t = glossaryTerm(month, kpi);
  return `
    <article class="tile${wide ? ' tile--wide' : ''}" data-status="${status}" data-fn="${esc(fn.id)}">
      <div class="tile-head">
        <span class="tile-icon">${icon(iconName)}</span>
        <div class="kc-name"><h3 class="tile-label"><a class="kc-link" href="${href(month, day, fn.id)}" data-open-detail="${esc(fn.id)}">${esc(label)}<span class="sr-only">, ${esc(when)}</span></a></h3>${termAfter(t)}</div>
      </div>
      ${when ? `<p class="kc-tag" aria-hidden="true">${tagMarkup(when)}</p>` : ''}
      ${body}
      ${showStatus ? statusLine(status, kpi, 'hs tile-status') : ''}
    </article>`;
}

function bufferTile(month, day, area) {
  const fn = byId(month, 'materials');
  if (!fn) return ''; // hidden in Board setup
  const m = measure(month, fn, day, 'day', area);
  const f = formatPair(m.actual, m.goal, m.kpi);
  const v = valueBlock(m);
  let body = v.html;
  if (f.actual !== null && !noFigure(m.status, m.actual) && typeof m.goal === 'number' && m.goal > 0) {
    const pct = Math.round((m.actual / m.goal) * 100);
    body = `<div class="buf">
        <p class="kc-value"><strong>${esc(f.actual)}</strong> <span class="kc-of" aria-hidden="true">/ ${esc(f.goal)}</span><span class="sr-only">, goal ${esc(f.goal)}</span></p>
        <p class="buf-pct"><strong>${pct}%</strong> of goal</p>
      </div>
      <div class="bar" role="img" aria-label="${pct}% of goal"><span class="bar-fill bar-fill--${m.status}" style="width:${Math.min(100, pct)}%"></span></div>`;
  }
  return tile({ month, day, fn, label: shownLabel(fn, 'day', 'Critical buffer parts inventory'), iconName: 'layers', body, status: m.status, kpi: m.kpi, when: m.when, showStatus: !v.inline, wide: true });
}

function simpleTile(month, day, area, fnId, kind, label, iconName, style = 'of') {
  const fn = byId(month, fnId);
  if (!fn) return ''; // hidden in Board setup
  const m = measure(month, fn, day, kind, area);
  const v = valueBlock(m, { style });
  return tile({ month, day, fn, label: shownLabel(fn, kind, label), iconName, body: v.html, status: m.status, kpi: m.kpi, when: m.when, showStatus: !v.inline });
}

/** Scrap % for the last 7 production days through the selected day. */
function scrapPoints(month, day, area) {
  const fn = byId(month, 'engineering');
  const series = dailySeries(fn, area === 'all' ? 'plant' : area);
  const days = [];
  for (let d = day; d >= 1 && days.length < 7; d -= 1) if (isProductionDay(month, d) !== false) days.unshift(d);
  return days.map((d) => {
    const r = series.find((x) => x.day === d) ?? { day: d, actual: null, goal: null };
    return { ...r, label: formatDayMedium(month, d).replace(/^\w+, /, ''), status: compareToGoal(r.actual, r.goal, fn.kpiDaily.better) };
  });
}

function scrapTile(month, day, area) {
  const fn = byId(month, 'engineering');
  if (!fn) return ''; // hidden in Board setup
  const m = measure(month, fn, day, 'day', area);
  const pts = scrapPoints(month, day, area);
  const span = pts.length === 1 ? 'last production day' : `last ${pts.length} production days`;
  // "all areas" mid-sentence; a named area (Mold, Bond…) keeps its capital.
  const where = area === 'all' ? 'all areas' : areaName(area);
  const any = pts.some((p) => typeof p.actual === 'number');
  const goal = pts.find((p) => typeof p.goal === 'number')?.goal;
  const goalText = typeof goal === 'number' ? `Goal ${formatPair(goal, goal, fn.kpiDaily).actual}` : 'No goal set';
  // Renamed in Board setup: the trend takes the KPI's new name.
  const name = shownLabel(fn, 'day', 'Scrap %');
  const renamed = name !== 'Scrap %';
  const body = !pts.length
    // The month's first days were a weekend: there is no day to chart yet.
    ? '<p class="mini-empty">No production days yet this month.</p>'
    : any
    ? `<div class="mini" data-mini='${esc(JSON.stringify(pts))}' role="img" aria-label="${esc(`${name} for the ${span}: ${pts.map((p) => `${formatDayMedium(month, p.day)} ${p.actual === null ? 'not entered' : formatPair(p.actual, p.goal, fn.kpiDaily).actual}`).join(', ')}. ${goalText}.`)}"></div>
       <p class="mini-key" aria-hidden="true"><span class="mk mk--goal"></span>${esc(goalText)}</p>`
    : `<p class="mini-empty">No ${renamed ? `${esc(name)} numbers` : 'scrap numbers'} for ${esc(where)} in the ${span}.</p>`;
  // No status line here: the Scrap % card above already says it.
  return tile({
    month, day, fn, label: `${name} trend`, iconName: 'trend', body, status: m.status, kpi: m.kpi, showStatus: false, wide: true,
    when: `${fn.name} · ${!pts.length ? dayHeading(month, day) : pts.length === 1 ? '1 day so far' : `last ${pts.length} days`}${area === 'all' ? '' : ` · ${areaName(area)}`}`,
  });
}

function trendsPanel(month, day, area) {
  const tiles = [
    bufferTile(month, day, area),
    scrapTile(month, day, area),
    simpleTile(month, day, area, 'operations', 'month', 'Labor efficiency', 'gauge'),
    simpleTile(month, day, area, 'operations', 'day', 'Parts produced', 'package'),
    simpleTile(month, day, area, 'plant', 'day', 'Earned hours', 'clock'),
    simpleTile(month, day, area, 'maintenance', 'day', 'Critical equipment down', 'wrench'),
  ].join('');
  return `
    <section class="panel panel--trends" aria-labelledby="tr-title">
      <header class="panel-head">
        <span class="panel-icon">${icon('barChart')}</span>
        <div class="panel-titles"><h2 class="panel-title" id="tr-title">Trends and key metrics</h2></div>
        <p class="panel-aside">Performance for ${esc(formatDayMedium(month, day))}</p>
      </header>
      ${tiles.trim() ? `<div class="tiles">${tiles}</div>` : '<p class="mini-empty">The functions these metrics come from are hidden in Board setup.</p>'}
    </section>`;
}

/** Ticks in steps people read easily (0.25%, 0.5%, 1%…), three of them. */
function niceTicks(lo0, hi0) {
  const steps = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1];
  for (const step of steps) {
    const lo = Math.max(0, Math.floor(lo0 / step) * step);
    if (lo + step * 2 >= hi0) return [lo, lo + step, lo + step * 2].map((t) => Number(t.toFixed(5)));
  }
  const step = (hi0 - lo0) / 2 || 0.01;
  return [lo0, lo0 + step, lo0 + step * 2];
}

/** Space between the last point and its value label. */
const LABEL_GAP = 8;

/**
 * The Scrap % line at its real width (dataviz: 2px line, dashed goal, every
 * production day labelled, the last value labelled, misses as the off glyph).
 * The right margin holds the end label: drawn once, the label is measured, and
 * when it needs more room than was kept the line is drawn again with that room.
 */
function drawMini(el, right = 34) {
  const pts = JSON.parse(el.dataset.mini);
  const w = Math.round(el.clientWidth);
  const h = Math.round(el.clientHeight) || 112;
  if (!w) return;
  const fs = 11;
  const left = 36;
  const top = 14;
  const bottom = h - 18;
  const vals = pts.flatMap((p) => [p.actual, p.goal]).filter((v) => typeof v === 'number');
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const lo = ticks[0];
  const hi = ticks[2];
  const plotW = w - left - right;
  const x = (i) => left + (pts.length === 1 ? plotW / 2 : (i / (pts.length - 1)) * plotW);
  const y = (v) => bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top);
  const labels = formatTicks(ticks, 'fraction');
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">`;
  ticks.forEach((t, i) => {
    svg += `<line class="mini-grid" x1="${left}" x2="${w - right}" y1="${y(t)}" y2="${y(t)}"></line>`;
    svg += `<text class="mini-label" x="${left - 6}" y="${y(t)}" dy="0.35em" text-anchor="end" font-size="${fs}">${labels[i]}</text>`;
  });
  let goal = '';
  let line = '';
  let pen = false;
  pts.forEach((p, i) => {
    if (typeof p.goal === 'number') goal += `${goal ? 'L' : 'M'}${x(i)} ${y(p.goal)} `;
    if (typeof p.actual === 'number') { line += `${pen ? 'L' : 'M'}${x(i)} ${y(p.actual)} `; pen = true; } else pen = false;
  });
  // A single day still gets a goal line to read against, drawn across the plot.
  if (pts.length === 1 && typeof pts[0].goal === 'number') goal = `M${left} ${y(pts[0].goal)} L${w - right} ${y(pts[0].goal)}`;
  svg += `<path class="mini-goal" d="${goal.trim()}"></path><path class="mini-line" d="${line.trim()}"></path>`;
  // Every production day gets a label: short dates when they fit, else day numbers.
  // Under 22px a day, the numbers would run together: the first day, the last (bold)
  // and every other day between (never the one right beside the last).
  const slot = pts.length > 1 ? plotW / (pts.length - 1) : plotW;
  const useDates = slot >= 44;
  const sparse = slot < 22;
  const lastI = pts.length - 1;
  pts.forEach((p, i) => {
    const last = i === lastI;
    const labelled = !sparse || i === 0 || last || (i % 2 === 0 && i !== lastI - 1);
    const text = useDates ? p.label : String(p.day);
    if (labelled) svg += `<text class="mini-label${last ? ' is-strong' : ''}" x="${x(i)}" y="${h - 3}" text-anchor="middle" font-size="${fs}">${esc(text)}</text>`;
    if (typeof p.actual !== 'number') return;
    const cx = x(i);
    const cy = y(p.actual);
    if (p.status === OFF) {
      // The off-goal glyph: red dot with a white "!".
      svg += `<g class="mini-pt mini-pt--off"><circle cx="${cx}" cy="${cy}" r="5.5"></circle>`
        + `<rect class="mini-pt-mark" x="${cx - 0.9}" y="${cy - 3.3}" width="1.8" height="4" rx="0.9"></rect>`
        + `<circle class="mini-pt-mark" cx="${cx}" cy="${cy + 2.5}" r="1.1"></circle></g>`;
    } else {
      svg += `<circle class="mini-pt mini-pt--${p.status}" cx="${cx}" cy="${cy}" r="4"></circle>`;
    }
  });
  const lastPt = [...pts].reverse().find((p) => typeof p.actual === 'number');
  if (lastPt) {
    const i = pts.indexOf(lastPt);
    const f = formatPair(lastPt.actual, lastPt.goal, { unit: 'fraction', better: 'lower' });
    svg += `<text class="mini-value" x="${x(i) + LABEL_GAP}" y="${y(lastPt.actual)}" dy="0.35em" font-size="${fs + 1}">${f.actual}</text>`;
  }
  el.innerHTML = `${svg}</svg>`;
  // The end label sits LABEL_GAP right of the last point and ends inside the chart's box
  // (the tile's padding stays clear), however wide the value is.
  const label = el.querySelector('.mini-value');
  const width = label?.getComputedTextLength?.() ?? 0;
  const need = width ? Math.ceil(LABEL_GAP + width) : 34;
  if (need > right) drawMini(el, need);
}

/* ---------- Issues and actions ---------- */

/** Several lines of one note become one line ("a; b" or "a. b"). */
export const oneLine = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean)
  .reduce((acc, l) => (acc ? `${acc}${/[.!?;:]$/.test(acc) ? ' ' : '; '}${l}` : l), '');

export { hasProblem };

/** "Sat, Feb 28" from 'YYYY-MM-DD', on one line (the year only when it isn't the board's). */
function dueDay(iso, month) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return iso;
  const sameYear = String(y) === month.month.slice(0, 4);
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC', ...(sameYear ? {} : { year: 'numeric' }) })
    .format(dt).replace(/ /g, ' ');
}

/**
 * Open actions from the Action register for one KPI row: the text, then
 * "Owner · Due Sat, Feb 28" ("Overdue" with the off glyph when the due day has
 * passed the selected day; "No due date" when there is none).
 */
function registerMarkup(month, day, row, list) {
  const today = isoForDay(month, day);
  return `<ul class="iss-reg" aria-label="From the Action register">${list.map((a) => {
    // Closed that day or later: still this KPI's action for the day, and done.
    if (a.status === 'closed') {
      const closed = a.closedDayIso ? ` · Done ${esc(dueDay(a.closedDayIso, month))}` : '';
      return `<li class="is-done"><span class="iss-reg-text"><span class="iss-done">${mdot(ON)}Done:</span> ${esc(a.text)}</span><span class="iss-reg-meta">${esc(a.owner || row.owner)}${closed}</span></li>`;
    }
    const over = a.due && a.due < today;
    const due = a.due
      ? `${over ? `<span class="iss-over">${mdot(OFF)}Overdue</span> · ` : ''}Due ${esc(dueDay(a.due, month))}`
      : 'No due date';
    return `<li><span class="iss-reg-text">${esc(a.text)}</span><span class="iss-reg-meta">${esc(a.owner || row.owner)} · ${due}</span></li>`;
  }).join('')}</ul>`;
}

/**
 * No action for a KPI row: red "Needs an action" with the off glyph when it's off goal
 * (" (this month)" when only the month missed, since the row's bar shows the day) and the
 * board's Add action button after it (app.js opens the Action register on that KPI), else the plain word.
 */
function emptyAction(st, fn, row) {
  if (st.state === 'needs') {
    const added = row !== fn;
    const what = added ? `${fn.name}, ${plainLabel(row.kpiDaily)}` : fn.name;
    return `<span class="iss-needs-row"><span class="iss-needs">${mdot(OFF)}<span>${ACTION_WORD.needs}${st.monthOnly ? '<span class="iss-needs-why"> (this month)</span>' : ''}</span></span>`
      + `<button class="btn--text iss-add" type="button" data-add-action="${esc(fn.id)}" data-add-kpi="${esc(added ? row.kpiId : '')}">Add action<span class="sr-only"> for ${esc(what)}</span></button></span>`;
  }
  return `<span class="is-empty">${esc(st.word || ACTION_WORD.notYet)}</span>`;
}

/**
 * The rows for one KPI row of a function: its workbook KPI (row = fn) or a KPI
 * added in Board setup (row = one of fn.extraKpis). One table row per issue note.
 */
function issueRows(month, day, fn, row = fn) {
  const added = row !== fn;
  const named = added || (fn.extraKpis?.length ?? 0) > 0; // a function with several KPIs names each one
  const kpiName = named ? plainLabel(row.kpiDaily) : '';
  const n = notesFor(row, day);
  const st = dayStatus(month, row, day).status;
  // Issue status shows once, on the line with the real problem (never on a "No new issues
  // to report" line above it): the status, one quiet "Set status" link when there is an
  // issue without one, or nothing at all.
  let statusCell = '';
  if (hasProblem(n)) {
    statusCell = n.status
      ? issueStatusMarkup(n.status)
      : `<a class="set-status" href="#enter/${esc(fn.id)}/status" data-set-status="${esc(fn.id)}">Set status<span class="sr-only"> for ${esc(fn.name)}${kpiName ? `, ${esc(kpiName)}` : ''} issue</span></a>`;
  }
  let notes;
  let actions;
  if (n.source === null) {
    // A number entered on a KPI added in Board setup, with no notes: recorded, just no issue (the board's words).
    notes = [{ text: recordedOn(row, day) ? 'No issue reported' : ACTION_WORD.nothing, empty: true }];
    actions = [];
  } else {
    const p = noteParagraphs(n.problem);
    // "No new issues to report" isn't an issue: the owner's words stay, muted, as on the board.
    notes = p.length ? p.map((t) => ({ text: oneLine(t), empty: NO_ISSUE.test(t) })) : [{ text: 'No issue reported', empty: true }];
    actions = noteParagraphs(n.action).map(oneLine);
  }
  // Off goal, something recorded, no issue written (board.js issueGap, the board's rule):
  // the red line alone takes the issue's place ("No new issues to report" above it would contradict it).
  const isGap = issueGap(month, fn, added ? row : { ...fn, primary: true }, day);
  const gap = isGap ? `<p class="iss-gap">${mdot(OFF)}<span>${esc(ISSUE_GAP_WORD)}</span></p>` : '';
  if (isGap) notes = [{ text: '', empty: true, gap: true }];
  // The status's line: the first note that is a real problem (the first line when none is).
  const statusAt = Math.max(0, notes.findIndex((nt) => !nt.empty));
  // The board's action words for this KPI row: Needs an action, None needed, Nothing recorded.
  const ast = actionStateFor(month, fn, added ? row : { ...fn, primary: true }, day);
  // With no action in the note, the row shows its open actions from the Action register.
  const register = actions.length ? [] : ast.assigned;
  const info = added ? null : entryInfo(fn, day);
  const undo = getUndoable();
  // Same rule and words as the board (board.js enteredByMarkup): only the row the entry changed
  // says who entered it, "Entered by Jane Doe at 6:41 AM" ("on Feb 26 at 6:41 AM" on another day).
  let entered = '';
  if (info?.enteredBy && info.changed !== false) {
    const when = formatEnteredAt(info.enteredAt);
    const cut = when.lastIndexOf(', ');
    const date = cut > 0 ? ` on ${esc(when.slice(0, cut))}` : '';
    const time = cut > 0 ? when.slice(cut + 2) : when;
    const undoBtn = undo && undo.fnId === fn.id && undo.day === day ? '<button class="undo-link" type="button" data-undo-save>Undo</button>' : '';
    const tail = [time ? `at ${esc(time)}` : '', undoBtn].filter(Boolean).join(' ');
    entered = `<p class="iss-entered">Entered by ${esc(info.enteredBy)}${date}${tail ? ` <span class="nowrap">${tail}</span>` : ''}</p>`;
  }
  return notes.map((nt, i) => {
    // Actions line up with their notes; any extra actions join the last row.
    let act = actions[i] ?? '';
    if (i === notes.length - 1 && actions.length > notes.length) act = oneLine(actions.slice(i).join('\n'));
    const first = i === 0;
    // A later note with no action of its own: "None needed" stays "None needed"; under
    // "Needs an action" it stays empty (the first row already says it), and so it does under
    // Action register actions (the first row lists them for the KPI); otherwise "No action yet".
    const later = ast.state === 'none' || ast.state === 'nothing' ? ast.word
      : (ast.state === 'needs' || (ast.assigned ?? []).length) ? '' : ACTION_WORD.notYet;
    let actCell = act ? esc(act) : later ? `<span class="is-empty">${esc(later)}</span>` : '';
    if (!act && first) actCell = register.length ? registerMarkup(month, day, row, register) : emptyAction(ast, fn, row);
    return `<tr class="iss-row${first ? ' is-first' : ''}" data-status="${st}" data-fn="${esc(fn.id)}" data-kpi-row="${esc(row.id)}">
        <th scope="row" class="iss-dept"><span class="iss-bar iss-bar--${st}" aria-hidden="true"></span><a class="iss-link${kpiName ? ' iss-link--kpi' : ''}" href="${href(month, day, row.id)}" data-open-detail="${esc(row.id)}">${esc(fn.name)}${kpiName ? `<span class="iss-kpi"><span class="sr-only">, </span>${esc(kpiName)}</span>` : ''}<span class="sr-only">, ${esc(statusWord(st, row.kpiDaily).toLowerCase())}${notes.length > 1 ? `, note ${i + 1} of ${notes.length}` : ''}</span></a></th>
        <td class="iss-notes${nt.gap ? ' is-gap' : ''}" data-label="Issue">${nt.gap ? '' : `<span class="${nt.empty ? 'is-empty' : ''}">${esc(nt.text)}</span>`}${first ? gap + entered : ''}</td>
        <td class="iss-action"${actCell ? ' data-label="Action, next 24 hours"' : ''}>${actCell}</td>
        <td class="iss-owner" data-label="Owner">${esc(row.owner)}</td>
        <td class="iss-status${i === statusAt && statusCell ? '' : ' is-blank'}" data-label="Status">${i === statusAt ? statusCell : ''}</td>
      </tr>`;
  }).join('');
}

function issuesPanel(month, day) {
  const key = [[ON, 'On track'], [OFF, 'Off goal'], [NOT_ENTERED, 'Not entered']]
    .map(([s, w]) => `<span class="iss-key-item"><span class="iss-key-bar iss-bar--${s}"></span>${w}</span>`).join('');
  const rows = month.functions.map((fn) => [fn, ...(fn.extraKpis ?? [])].map((row) => issueRows(month, day, fn, row)).join('')).join('');
  return `
    <section class="panel panel--issues" aria-labelledby="iss-title">
      <header class="panel-head">
        <span class="panel-icon">${icon('clipboard')}</span>
        <div class="panel-titles"><h2 class="panel-title" id="iss-title">Issues and actions</h2></div>
        <p class="panel-aside iss-key"><span>Bar color shows that row's status for the day:</span>${key}</p>
      </header>
      <div class="iss-scroll">
        <table class="iss">
          <caption class="sr-only">Issues, actions and their status for ${esc(formatDayMedium(month, day))}</caption>
          <thead><tr><th scope="col">Function</th><th scope="col">Issue</th><th scope="col">Action, next 24 hours</th><th scope="col">Owner</th><th scope="col">Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}

/* ---------- Daily questions ---------- */

function kbiPanel(month, day) {
  return `
    <section class="panel panel--kbi" aria-labelledby="kbi-title">
      <header class="panel-head">
        <span class="panel-icon">${icon('help')}</span>
        <div class="panel-titles"><h2 class="panel-title" id="kbi-title">Daily questions</h2></div>
        <p class="panel-aside">Check in. Drive performance. Every day.</p>
      </header>
      <ol class="kbi-q">
        ${month.functions.map((fn, i) => {
          // The function's one status for the day (off goal when any of its KPIs is), naming the KPI that missed.
          const fs = fnStatus(month, fn, day, 'day');
          const st = fs.status;
          const word = fs.several ? STATUS_WORD[st] : statusWord(st, fn.kpiDaily);
          const which = fs.several && st === OFF ? (fs.off.length === 1 ? plainLabel(fs.off[0].kpi) : `${fs.off.length} KPIs`) : '';
          const q = fn.dorQuestion?.trim();
          return `
          <li><a class="kbi-link" href="${href(month, day, fn.id)}" data-open-detail="${esc(fn.id)}"${fs.several ? ` title="${esc(fnLabel(dayHeading(month, day), fn, fs))}"` : ''}>
            <span class="kbi-n" aria-hidden="true">${i + 1}</span>
            <span class="kbi-question${q ? '' : ' is-empty'}">${q ? esc(q) : 'No daily question yet'}</span>
            <span class="kbi-meta"><span class="kbi-dept">${esc(fn.name)}</span><span class="kbi-st hs--${st}">${mdot(st)}<span>${esc(word)}</span></span>${which ? `<span class="kbi-which">(${esc(which)})</span>` : ''}</span>
          </a></li>`;
        }).join('')}
      </ol>
    </section>`;
}

/* ---------- Render ---------- */

const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

let miniObserver = null;
let lastRender = null; // { month, day } of the last render, for the Action register refresh

// The Action register is its own sheet. When it closes, the issues panel picks up
// the actions added, edited or closed there (the 'close' event doesn't bubble: capture it).
document.addEventListener('close', (e) => {
  if (e.target?.id !== 'action-register' || !lastRender) return;
  const panel = document.querySelector('.home-app .panel--issues');
  if (!panel || document.documentElement.dataset.view !== 'home') return;
  const scroll = panel.querySelector('.iss-scroll')?.scrollLeft ?? 0;
  // The register put focus back on this panel (the row an Add action came from): keep it there
  // through the redraw, on the same control of the same row, else that row's link.
  const active = panel.contains(document.activeElement) ? document.activeElement : null;
  const tr = active?.closest('tr.iss-row');
  const rowSel = tr ? `tr.iss-row${tr.classList.contains('is-first') ? '.is-first' : ''}[data-kpi-row="${CSS.escape(tr.dataset.kpiRow)}"]` : '';
  const ctl = ['iss-link', 'iss-add', 'set-status', 'undo-link'].find((c) => active?.classList.contains(c));
  panel.outerHTML = issuesPanel(lastRender.month, lastRender.day);
  const next = document.querySelector('.home-app .panel--issues .iss-scroll');
  if (next) next.scrollLeft = scroll;
  if (rowSel) {
    const fresh = document.querySelector(`.home-app .panel--issues ${rowSel}`);
    (ctl && fresh?.querySelector(`.${ctl}`) || fresh?.querySelector('.iss-link'))?.focus({ preventScroll: true });
  }
}, true);

export function renderHome(month, day, area) {
  // "Riverside plant · Daily Operating Review": a narrow screen breaks after the dot (a long plant name may still wrap).
  document.querySelectorAll('[data-home-title]').forEach((n) => { n.innerHTML = `${esc(plantName(month))} · <span class="nowrap">Daily Operating Review</span>`; });
  document.querySelectorAll('[data-plant-name]').forEach((n) => { n.textContent = plantName(month); });
  // Every function removed in Board setup: the board's one line (never "0 of 0 functions on
  // track" over empty tables), and under it the one way back, as on the board.
  const none = !month.functions.length;
  document.querySelector('[data-home-summary]').innerHTML = none ? `<strong>${esc(NO_FUNCTIONS)}</strong>` : summaryMarkup(month, day, area);
  const needsLine = document.querySelector('[data-home-needs]');
  if (needsLine) {
    needsLine.innerHTML = none
      ? '<button class="hbtn hbtn--primary h-setup-btn" type="button" data-open-setup>Open Board setup</button>'
      : needsMarkup(month, day);
    needsLine.hidden = !needsLine.innerHTML;
  }
  const label = document.querySelector('[data-home-date]');
  label.textContent = formatDayLong(month, day);
  label.setAttribute('datetime', isoForDay(month, day));
  const picker = document.querySelector('[data-date-input]');
  picker.min = isoForDay(month, 1);
  picker.max = isoForDay(month, month.daysInMonth);
  picker.value = isoForDay(month, day);
  document.querySelector('[data-home-prev]').disabled = day <= 1;
  document.querySelector('[data-home-next]').disabled = day >= month.daysInMonth;
  const sel = document.querySelector('[data-area]');
  if (sel.value !== area) sel.value = area;

  // Identity chip: initials and name, or a person icon when nobody is set.
  const who = getIdentity(month);
  const chip = document.querySelector('[data-chip]');
  chip.innerHTML = who
    ? `<span class="chip-initials" aria-hidden="true">${esc(initials(who.name))}</span><span class="chip-name">${esc(who.name)}</span>${icon('chevronDown', 'i chip-chev')}`
    : `<span class="chip-initials chip-initials--none" aria-hidden="true">${icon('user')}</span>${icon('chevronDown', 'i chip-chev')}`;
  chip.setAttribute('aria-label', who ? `${who.name}: switch person or start the demo over` : "Choose who's entering, or start the demo over");
  chip.title = who ? who.name : "Who's entering?";
  chip.classList.toggle('is-unset', !who);

  // An unseen h2 keeps the outline whole: page h1, then this group's h2, then each card's h3.
  // Cards for functions hidden in Board setup are skipped; the row keeps one column per card.
  const cards = KPI_CARDS.map((c) => kpiCard(month, day, area, c)).filter(Boolean);
  const kpis = document.querySelector('[data-kpis]');
  kpis.innerHTML = `<h2 class="sr-only">Key numbers</h2>${cards.join('')}`;
  kpis.style.setProperty('--kpi-n', String(Math.max(1, cards.length)));
  kpis.hidden = cards.length === 0;
  fitKpiCards(kpis);
  kpiObserver?.observe(kpis);
  document.querySelector('[data-row2]').innerHTML = none ? '' : matrixPanel(month, day, area) + trendsPanel(month, day, area);
  const mxScroll = document.querySelector('.home-app .mx-scroll');
  fitMatrix(mxScroll);
  mxObserver?.disconnect();
  mxWidth = mxScroll?.clientWidth ?? 0;
  if (mxScroll) mxObserver?.observe(mxScroll);
  document.querySelector('[data-row3]').innerHTML = none ? '' : issuesPanel(month, day) + kbiPanel(month, day);
  lastRender = { month, day };
  document.querySelector('[data-print-meta]').textContent = `Area: ${areaName(area)}`;

  miniObserver?.disconnect();
  const minis = [...document.querySelectorAll('.home-app [data-mini]')];
  minis.forEach((el) => drawMini(el));
  miniObserver = new ResizeObserver(() => minis.forEach((el) => drawMini(el)));
  minis.forEach((el) => miniObserver.observe(el));
  // The end label and the grid's names are measured: once the web font is in, measure them again.
  document.fonts?.ready?.then(() => {
    minis.forEach((el) => el.isConnected && drawMini(el));
    fitMatrix(mxScroll);
    fitSide();
  });
  // The sidebar's function links are drawn right after this (shell.js renderNav): measure next frame.
  requestAnimationFrame(fitSide);
  watchBars();
  document.documentElement.dataset.ready = 'true';
}

/* ---------- Phone: the sticky bars never cover the focused control ---------- */

const PHONE = matchMedia('(max-width: 760px)');
let barsWatch = null;
const topBar = () => document.querySelector('.home-app > .side');
const enterBar = () => document.querySelector('.home-app > .h-mobilebar');

/**
 * On a phone the top bar (plant name, Menu) and the Enter numbers bar stick to the screen's
 * edges. The page's scroll-padding (css/home.css) keeps their heights, plus 8px, clear when the
 * browser scrolls a focused control into view. Their heights are measured here and kept current.
 */
function watchBars() {
  const top = topBar();
  const bar = enterBar();
  if (!top || !bar) return;
  const write = () => {
    const root = document.documentElement.style;
    root.setProperty('--home-top-h', `${Math.ceil(top.getBoundingClientRect().height)}px`);
    root.setProperty('--home-bar-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
  };
  write();
  if (barsWatch || typeof ResizeObserver === 'undefined') return;
  barsWatch = new ResizeObserver(write);
  barsWatch.observe(top);
  barsWatch.observe(bar);
}

// The browser doesn't scroll to a control that is on screen but covered by a sticky bar
// (Tab onto a button behind Enter numbers, Shift+Tab onto a link behind the top bar): the
// page moves just enough that the control and its focus ring sit clear of both bars.
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!PHONE.matches || document.documentElement.dataset.view !== 'home' || !el.closest?.('.home-app .h-wrap')) return;
  requestAnimationFrame(() => {
    if (document.activeElement !== el) return;
    // An issue card's link draws its focus ring on the whole card.
    const shown = el.matches('.iss-link') ? el.closest('tr') ?? el : el;
    const r = shown.getBoundingClientRect();
    const ring = 5; // 3px outline, 2px offset
    const min = (topBar()?.getBoundingClientRect().bottom ?? 0) + 8;
    const bar = enterBar();
    const max = (bar && bar.offsetHeight ? bar.getBoundingClientRect().top : window.innerHeight) - 8;
    // Something taller than the free space (the page itself, a whole panel) can't sit clear: leave it.
    if (r.height + ring * 2 > max - min) return;
    let by = 0;
    if (r.top - ring < min) by = r.top - ring - min;
    else if (r.bottom + ring > max) by = Math.min(r.bottom + ring - max, r.top - ring - min);
    if (by) window.scrollBy({ top: Math.round(by), behavior: 'instant' });
  });
});

/**
 * Functions added in Board setup make the sidebar longer than a laptop screen. When it would
 * scroll, .is-tight lets the "Powered by" panel go; still too long, .is-tighter puts How it works
 * and Settings side by side as icons (their names stay for screen readers and in the tooltip).
 * Every link keeps its 44px. Measured with both off first, so a taller screen gets them back.
 */
function fitSide() {
  const side = document.querySelector('.home-app .side');
  if (!side || document.documentElement.dataset.view !== 'home') return;
  side.classList.remove('is-tight', 'is-tighter');
  const over = () => side.clientHeight > 0 && side.scrollHeight > side.clientHeight + 1;
  if (over()) side.classList.add('is-tight');
  if (over()) side.classList.add('is-tighter');
}
let sideTimer = 0;
window.addEventListener('resize', () => { clearTimeout(sideTimer); sideTimer = setTimeout(fitSide, 120); });

// The grid's areas line spans every row but sits in the first: a click on it (not on
// its link) isn't a click on that function's row, so it doesn't open its Detail.
document.addEventListener('click', (e) => {
  if (e.target.closest?.('.home-app .mcell--areas-gap') && !e.target.closest('a')) e.stopPropagation();
}, true);

// "See that day" (the grid's line when no areas were entered): once that day is
// drawn, the date control has focus, so the keyboard isn't left on the page body.
document.addEventListener('click', (e) => {
  if (!e.target.closest?.('.home-app .mx-gap-link') || e.metaKey || e.ctrlKey || e.shiftKey) return;
  requestAnimationFrame(() => document.querySelector('.home-app [data-date-pick]')?.focus());
});

// Printing lays the page out at paper width; redraw the trend line to fit it,
// and again when the print layout goes away. (Print CSS also scales it as a fallback.)
const printQuery = matchMedia('print');
printQuery.addEventListener('change', () => {
  document.querySelectorAll('.home-app [data-mini]').forEach((el) => drawMini(el));
});

/**
 * After a save on the home: bring the function into view, wash it briefly and
 * put focus on its link. A changed problem or status goes to its issue row;
 * numbers go to its matrix row.
 */
export function revealHomeRow(fnId, { target = 'matrix' } = {}) {
  const row = target === 'issue'
    ? document.querySelector(`.home-app tr.iss-row.is-first[data-fn="${fnId}"]`)
    : document.querySelector(`.home-app tr[data-home-row="${fnId}"]`);
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: 'instant' });
  row.querySelector(target === 'issue' ? '.iss-link' : '.mx-link')?.focus({ preventScroll: true });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  row.animate([{ backgroundColor: '#dff3ed' }, { backgroundColor: '#dff3ed', offset: 0.45 }, { backgroundColor: 'transparent' }],
    { duration: reduce ? 2400 : 1800, easing: 'ease-out' });
}
