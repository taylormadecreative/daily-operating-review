// Home dashboard (Nelson's reference layout): the one-line answer, KPI cards,
// the department × area matrix, trends and key metrics, issues and actions,
// and the daily questions. Every number is calculated from the month.

import { dailySeries, isoForDay, notesFor, noteParagraphs, entryInfo, hasProblem } from './store.js';
import {
  ON, OFF, NOT_ENTERED, NO_GOAL, NO_PRODUCTION,
  dayStatus, monthStatus, isProductionDay, compareToGoal, boardSummary, statusWord,
} from './status.js';
import {
  formatPair, glossaryTerm, formatDayLong, formatDayMedium, formatEnteredAt, formatTicks, dayHeading,
} from './format.js';
import { esc, termButton, GLYPH, issueStatusMarkup } from './ui.js';
import { icon } from './icons.js';
import { getUndoable } from './board.js';
import { getIdentity } from './identity.js';
import { pageHref } from './shell.js';

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
/** "People · Fri, Feb 27": a narrow card wraps at the dot, never inside a date. */
const tagMarkup = (when) => when.split(' · ').map((part) => `<span class="nowrap">${esc(part)}</span>`).join(' · ');
const byId = (month, id) => month.functions.find((f) => f.id === id);
const actualOn = (fn, areaId, day) => (fn.daily?.[areaId] ?? []).find((r) => r.day === day)?.actual;

/* ---------- The one-line answer (header subtitle) ---------- */

/**
 * "4 of 8 departments on track for Fri, Feb 27 · Off goal: People, …", each
 * department a link to its Detail. Plant totals decide it, as on the DOR board.
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
      ? `<strong>${y[ON]} of ${y.total} departments on track</strong>${when}`
      : `<strong>${y[ON]} of ${y.total} on track</strong> (plant totals)${when}`];
  if (y.attention.length) parts.push(`Off goal: ${names(y.attention)}`);
  if (y.noGoal.length) parts.push(`No goal set: ${names(y.noGoal)}`);
  if (y.missing.length && s.productionDay !== false) parts.push(`Not entered: ${names(y.missing)}`);
  if (s.productionDay !== false && !y.attention.length && !y.noGoal.length && !y.missing.length) parts.push('Nothing off goal');
  return parts.join('<span class="h-sum-sep" aria-hidden="true"> · </span><span class="sr-only">. </span>');
}

/* ---------- KPI cards ---------- */

const KPI_CARDS = [
  { fn: 'safety', kind: 'day', label: 'Safety incidents', icon: 'shield' },
  { fn: 'safety', kind: 'month', label: 'TRIR', icon: 'fileText' },
  { fn: 'people', kind: 'day', label: 'Clocked in', icon: 'users' },
  { fn: 'people', kind: 'month', label: 'Total DL', icon: 'idCard' },
  { fn: 'quality', kind: 'day', label: 'Quality incidents', icon: 'badgeCheck' },
  { fn: 'quality', kind: 'month', label: 'Customer complaints', icon: 'message' },
  { fn: 'engineering', kind: 'day', label: 'Scrap %', icon: 'barChart' },
  { fn: 'maintenance', kind: 'month', label: 'Uptime %', icon: 'activity' },
];

/**
 * Status and numbers for a function's daily or monthly measure, area-aware.
 * `when` names the department and the period ("People · Fri, Feb 27",
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
function valueBlock(m, { style = 'slash' } = {}) {
  const f = formatPair(m.actual, m.goal, m.kpi);
  if (f.actual === null) {
    if (m.status === NO_PRODUCTION) {
      return { inline: true, html: `<p class="kc-value kc-value--empty hs--${m.status}">${mdot(m.status)}<span class="kc-empty">No production scheduled</span></p>` };
    }
    return {
      inline: true,
      html: `<p class="kc-value kc-value--empty hs--${NOT_ENTERED}">${mdot(NOT_ENTERED)}<span class="kc-empty">Not entered</span>`
        + `<span class="kc-goal">${f.goal === null ? 'No goal set' : `Goal ${esc(f.goal)}`}</span></p>`,
    };
  }
  if (f.useOf && f.goal !== null) {
    const sep = style === 'of' ? ' of ' : ' / ';
    // The space before the goal sits outside the no-wrap span, so a narrow tile can break there.
    return {
      inline: false,
      html: `<p class="kc-value"><strong>${esc(f.actual)}</strong>${sep.startsWith(' ') ? ' ' : ''}<span class="kc-of" aria-hidden="true">${sep.trimStart()}${esc(f.goal)}</span>`
        + `<span class="sr-only">, goal ${esc(f.goal)}${f.word ? ` ${esc(f.word)}` : ''}</span></p>`,
    };
  }
  return {
    inline: false,
    html: `<p class="kc-value"><strong>${esc(f.actual)}</strong>`
      + `<span class="kc-goal">${f.goal === null ? 'No goal set' : `Goal ${esc(f.goal)}`}</span></p>`,
  };
}

function kpiCard(month, day, area, spec) {
  const fn = byId(month, spec.fn);
  const m = measure(month, fn, day, spec.kind, area);
  const t = glossaryTerm(month, m.kpi);
  const v = valueBlock(m);
  return `
    <article class="kcard" data-status="${m.status}" data-fn="${esc(fn.id)}" data-kpi="${esc(spec.label)}">
      <div class="kc-head">
        <span class="kc-icon kc-icon--${m.status}">${icon(spec.icon)}</span>
        <h3 class="kc-label"><a class="kc-link" href="${href(month, day, fn.id)}" data-open-detail="${esc(fn.id)}">${esc(spec.label)}<span class="sr-only">, ${esc(m.when)}</span></a></h3>
        ${t ? termButton(t.term, t.definition) : ''}
      </div>
      <p class="kc-tag" aria-hidden="true">${tagMarkup(m.when)}</p>
      ${v.html}
      ${v.inline ? '' : statusLine(m.status, m.kpi, 'hs kc-status')}
    </article>`;
}

/* ---------- Department × area matrix ---------- */

function cellLabel(areaLabel, fn, s, kpi) {
  const f = formatPair(s.actual, s.goal, kpi);
  const nums = f.actual === null ? (f.goal === null ? '' : `, goal ${f.goal}`) : `, ${f.phrase}`;
  return `${areaLabel}, ${fn.name}: ${statusWord(s.status, kpi).toLowerCase()}${nums}`;
}

function matrixRow(month, day, area, fn) {
  const cells = AREA_COLS.map((a) => {
    const s = dayStatus(month, fn, day, a);
    const label = cellLabel(areaName(a), fn, s, fn.kpiDaily);
    return `<td class="mcell${area === a ? ' is-area' : ''}"><span class="mcell-in" role="img" aria-label="${esc(label)}" data-tip="${esc(label)}">${mdot(s.status)}</span></td>`;
  }).join('');
  const p = dayStatus(month, fn, day);
  const mo = monthStatus(month, fn, day);
  const pl = cellLabel('Plant total', fn, p, fn.kpiDaily);
  const ml = cellLabel('Month so far', fn, mo, fn.kpiMonthly);
  return `<tr data-home-row="${esc(fn.id)}">
      <th scope="row"><a class="mx-link" href="${href(month, day, fn.id)}" data-open-detail="${esc(fn.id)}">${esc(fn.name)}</a></th>
      <td class="mx-owner">${esc(fn.owner)}</td>
      ${cells}
      <td class="mcell mcell--plant"><span class="mcell-in" role="img" aria-label="${esc(pl)}" data-tip="${esc(pl)}">${mdot(p.status)}</span></td>
      <td class="mcell mcell--month"><span class="mcell-in" role="img" aria-label="${esc(ml)}" data-tip="${esc(ml)}">${mdot(mo.status)}</span></td>
    </tr>`;
}

/**
 * The matrix subtitle tells the truth about the area columns, from the data:
 * "Areas last entered Thu, Feb 12 · plant totals current" when today's area
 * cells are empty, back to "Status by production area" when every one is in.
 */
export function areaNote(month, day) {
  const missing = month.functions.some((fn) => AREA_COLS.some((a) => dayStatus(month, fn, day, a).status === NOT_ENTERED));
  if (!missing) return 'Status by production area';
  // "Last entered" means the board as a whole: the last day on which at least
  // half the departments had area numbers (one leftover column doesn't count).
  const enough = Math.ceil(month.functions.length / 2);
  const hadAreas = (d) => month.functions.filter((fn) => AREA_COLS.some((a) => typeof actualOn(fn, a, d) === 'number')).length >= enough;
  let last = null;
  for (let d = day; d >= 1 && last === null; d -= 1) if (hadAreas(d)) last = d;
  const plantIn = month.functions.every((fn) => dayStatus(month, fn, day).status !== NOT_ENTERED);
  const tail = plantIn ? 'plant totals current' : 'plant totals partly entered';
  if (last === null) return `No area numbers yet this month · ${tail}`;
  if (last === day) return `Some areas not entered · ${tail}`;
  return `Areas last entered ${formatDayMedium(month, last)} · ${tail}`;
}

function matrixPanel(month, day, area) {
  const present = new Set();
  for (const fn of month.functions) {
    for (const a of [...AREA_COLS, 'plant']) present.add(dayStatus(month, fn, day, a).status);
    present.add(monthStatus(month, fn, day).status);
  }
  const legend = [[ON, 'On track'], [OFF, 'Off goal'], [NOT_ENTERED, 'Not entered']];
  if (present.has(NO_GOAL)) legend.push([NO_GOAL, 'No goal set']);
  if (present.has(NO_PRODUCTION)) legend.push([NO_PRODUCTION, 'No production scheduled']);
  return `
    <section class="panel panel--matrix" aria-labelledby="mx-title">
      <header class="panel-head">
        <span class="panel-icon">${icon('users')}</span>
        <div class="panel-titles"><h2 class="panel-title" id="mx-title">Department Performance</h2><p class="panel-sub" data-area-note>${esc(areaNote(month, day))}</p></div>
        <ul class="mx-legend" aria-label="Legend">${legend.map(([s, w]) => `<li>${mdot(s)}<span>${w}</span></li>`).join('')}</ul>
      </header>
      <div class="mx-scroll">
        <table class="mx">
          <caption class="sr-only">Status for ${esc(formatDayMedium(month, day))} by department and production area, with the plant total and the month so far.</caption>
          <thead><tr>
            <th scope="col">Department</th><th scope="col" class="mx-owner">Owner</th>
            ${AREA_COLS.map((a) => `<th scope="col" class="${area === a ? 'is-area' : ''}">${a === 'compounding'
    ? '<span class="col-full">Compounding</span><span class="col-abbr" aria-hidden="true">Comp.</span><span class="sr-only col-abbr-sr">Compounding</span>'
    : esc(areaName(a))}</th>`).join('')}
            <th scope="col" class="mx-wrap">Plant total</th><th scope="col" class="mx-wrap">Month so far</th>
          </tr></thead>
          <tbody>${month.functions.map((fn) => matrixRow(month, day, area, fn)).join('')}</tbody>
        </table>
      </div>
    </section>`;
}

/* ---------- Trends & key metrics ---------- */

function tile({ month, day, fn, label, iconName, body, status, kpi, when, showStatus = true }) {
  const t = glossaryTerm(month, kpi);
  return `
    <article class="tile" data-status="${status}" data-fn="${esc(fn.id)}">
      <div class="tile-head">
        <span class="tile-icon">${icon(iconName)}</span>
        <h3 class="tile-label"><a class="kc-link" href="${href(month, day, fn.id)}" data-open-detail="${esc(fn.id)}">${esc(label)}<span class="sr-only">, ${esc(when)}</span></a></h3>
        ${t ? termButton(t.term, t.definition) : ''}
      </div>
      ${when ? `<p class="kc-tag" aria-hidden="true">${tagMarkup(when)}</p>` : ''}
      ${body}
      ${showStatus ? statusLine(status, kpi, 'hs tile-status') : ''}
    </article>`;
}

function bufferTile(month, day, area) {
  const fn = byId(month, 'materials');
  const m = measure(month, fn, day, 'day', area);
  const f = formatPair(m.actual, m.goal, m.kpi);
  const v = valueBlock(m);
  let body = v.html;
  if (f.actual !== null && typeof m.goal === 'number' && m.goal > 0) {
    const pct = Math.round((m.actual / m.goal) * 100);
    body = `<div class="buf">
        <p class="kc-value"><strong>${esc(f.actual)}</strong> <span class="kc-of" aria-hidden="true">/ ${esc(f.goal)}</span><span class="sr-only">, goal ${esc(f.goal)}</span></p>
        <p class="buf-pct"><strong>${pct}%</strong> of goal</p>
      </div>
      <div class="bar" role="img" aria-label="${pct}% of goal"><span class="bar-fill bar-fill--${m.status}" style="width:${Math.min(100, pct)}%"></span></div>`;
  }
  return tile({ month, day, fn, label: 'Critical buffer parts', iconName: 'layers', body, status: m.status, kpi: m.kpi, when: m.when, showStatus: !v.inline });
}

function simpleTile(month, day, area, fnId, kind, label, iconName, style = 'of') {
  const fn = byId(month, fnId);
  const m = measure(month, fn, day, kind, area);
  const v = valueBlock(m, { style });
  return tile({ month, day, fn, label, iconName, body: v.html, status: m.status, kpi: m.kpi, when: m.when, showStatus: !v.inline });
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
  const m = measure(month, fn, day, 'day', area);
  const pts = scrapPoints(month, day, area);
  const span = pts.length === 1 ? 'last production day' : `last ${pts.length} production days`;
  const any = pts.some((p) => typeof p.actual === 'number');
  const goal = pts.find((p) => typeof p.goal === 'number')?.goal;
  const goalText = typeof goal === 'number' ? `Goal ${formatPair(goal, goal, fn.kpiDaily).actual}` : 'No goal set';
  const body = any
    ? `<div class="mini" data-mini='${esc(JSON.stringify(pts))}' role="img" aria-label="${esc(`Scrap % for the ${span}: ${pts.map((p) => `${formatDayMedium(month, p.day)} ${p.actual === null ? 'not entered' : formatPair(p.actual, p.goal, fn.kpiDaily).actual}`).join(', ')}. ${goalText}.`)}"></div>
       <p class="mini-key" aria-hidden="true"><span class="mk mk--goal"></span>${esc(goalText)}</p>`
    : `<p class="mini-empty">No scrap numbers for ${esc(areaName(area))} in the ${span}.</p>`;
  // No status line here: the Scrap % card above already says it.
  return tile({
    month, day, fn, label: 'Scrap % trend', iconName: 'trend', body, status: m.status, kpi: m.kpi, showStatus: false,
    when: `${fn.name} · ${pts.length === 1 ? '1 day so far' : `last ${pts.length} days`}${area === 'all' ? '' : ` · ${areaName(area)}`}`,
  });
}

function trendsPanel(month, day, area) {
  return `
    <section class="panel panel--trends" aria-labelledby="tr-title">
      <header class="panel-head">
        <span class="panel-icon">${icon('barChart')}</span>
        <div class="panel-titles"><h2 class="panel-title" id="tr-title">Trends &amp; Key Metrics</h2></div>
        <p class="panel-aside">Performance for ${esc(formatDayMedium(month, day))}</p>
      </header>
      <div class="tiles">
        ${bufferTile(month, day, area)}
        ${scrapTile(month, day, area)}
        ${simpleTile(month, day, area, 'operations', 'month', 'Labor efficiency', 'gauge')}
        ${simpleTile(month, day, area, 'operations', 'day', 'Parts produced', 'package')}
        ${simpleTile(month, day, area, 'plant', 'day', 'Earned hours', 'clock')}
        ${simpleTile(month, day, area, 'maintenance', 'day', 'Critical equipment down', 'wrench')}
      </div>
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

/**
 * The Scrap % line at its real width (dataviz: 2px line, dashed goal, every
 * production day labelled, the last value labelled, misses as the off glyph).
 */
function drawMini(el) {
  const pts = JSON.parse(el.dataset.mini);
  const w = Math.round(el.clientWidth);
  const h = Math.round(el.clientHeight) || 112;
  if (!w) return;
  const fs = 11;
  const left = 36;
  const right = 34;
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
  const slot = pts.length > 1 ? plotW / (pts.length - 1) : plotW;
  const useDates = slot >= 44;
  pts.forEach((p, i) => {
    const last = i === pts.length - 1;
    const anchor = 'middle';
    const text = useDates ? p.label : String(p.day);
    svg += `<text class="mini-label${last ? ' is-strong' : ''}" x="${x(i)}" y="${h - 3}" text-anchor="${anchor}" font-size="${fs}">${esc(text)}</text>`;
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
    svg += `<text class="mini-value" x="${x(i) + 8}" y="${y(lastPt.actual)}" dy="0.35em" font-size="${fs + 1}">${f.actual}</text>`;
  }
  el.innerHTML = `${svg}</svg>`;
}

/* ---------- Issues and actions ---------- */

/** Several lines of one note become one line ("a; b" or "a. b"). */
export const oneLine = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean)
  .reduce((acc, l) => (acc ? `${acc}${/[.!?;:]$/.test(acc) ? ' ' : '; '}${l}` : l), '');

export { hasProblem };

function issueRows(month, day, fn) {
  const n = notesFor(fn, day);
  const st = dayStatus(month, fn, day).status;
  // Problem status shows once, on the department's first row: the status, a quiet
  // "Set status" link when there is a problem without one, or nothing at all.
  let statusCell = '';
  if (hasProblem(n)) {
    statusCell = n.status
      ? issueStatusMarkup(n.status)
      : `<a class="set-status" href="#enter/${esc(fn.id)}/status" data-set-status="${esc(fn.id)}">Set status<span class="sr-only"> for ${esc(fn.name)}'s problem</span></a>`;
  }
  let notes;
  let actions;
  if (n.source === null) {
    notes = [{ text: 'Not recorded for this day', empty: true }];
    actions = [];
  } else {
    const p = noteParagraphs(n.problem);
    notes = p.length ? p.map((t) => ({ text: oneLine(t) })) : [{ text: 'No problem reported', empty: true }];
    actions = noteParagraphs(n.action).map(oneLine);
  }
  const info = entryInfo(fn, day);
  const undo = getUndoable();
  const entered = info?.enteredBy
    ? `<p class="iss-entered">Entered by ${esc(info.enteredBy)} <span class="nowrap">· ${esc(formatEnteredAt(info.enteredAt))}</span>${undo && undo.fnId === fn.id && undo.day === day ? ' <button class="undo-link" type="button" data-undo-save>Undo</button>' : ''}</p>`
    : '';
  return notes.map((nt, i) => {
    // Actions line up with their notes; any extra actions join the last row.
    let act = actions[i] ?? '';
    if (i === notes.length - 1 && actions.length > notes.length) act = oneLine(actions.slice(i).join('\n'));
    const first = i === 0;
    return `<tr class="iss-row${first ? ' is-first' : ''}" data-status="${st}" data-fn="${esc(fn.id)}">
        <th scope="row" class="iss-dept"><span class="iss-bar iss-bar--${st}" aria-hidden="true"></span><a class="iss-link" href="${href(month, day, fn.id)}" data-open-detail="${esc(fn.id)}">${esc(fn.name)}<span class="sr-only">, ${esc(statusWord(st, fn.kpiDaily).toLowerCase())}${notes.length > 1 ? `, note ${i + 1} of ${notes.length}` : ''}</span></a></th>
        <td class="iss-notes" data-label="Details / Notes"><span class="${nt.empty ? 'is-empty' : ''}">${esc(nt.text)}</span>${first ? entered : ''}</td>
        <td class="iss-action" data-label="Action / Next step">${act ? esc(act) : '<span class="is-empty" aria-label="None">—</span>'}</td>
        <td class="iss-owner" data-label="Owner">${esc(fn.owner)}</td>
        <td class="iss-status${first && statusCell ? '' : ' is-blank'}" data-label="Status">${first ? statusCell : ''}</td>
      </tr>`;
  }).join('');
}

function issuesPanel(month, day) {
  const key = [[ON, 'On track'], [OFF, 'Off goal'], [NOT_ENTERED, 'Not entered']]
    .map(([s, w]) => `<span class="iss-key-item"><span class="iss-key-bar iss-bar--${s}"></span>${w}</span>`).join('');
  return `
    <section class="panel panel--issues" aria-labelledby="iss-title">
      <header class="panel-head">
        <span class="panel-icon">${icon('clipboard')}</span>
        <div class="panel-titles"><h2 class="panel-title" id="iss-title">Issues and Actions</h2></div>
        <p class="panel-aside iss-key"><span>Bar color = the department's status for the day:</span>${key}</p>
      </header>
      <div class="iss-scroll">
        <table class="iss">
          <caption class="sr-only">Problems, next steps and their status for ${esc(formatDayMedium(month, day))}</caption>
          <thead><tr><th scope="col">Department</th><th scope="col">Details / Notes</th><th scope="col">Action / Next step</th><th scope="col">Owner</th><th scope="col">Status</th></tr></thead>
          <tbody>${month.functions.map((fn) => issueRows(month, day, fn)).join('')}</tbody>
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
        <div class="panel-titles"><h2 class="panel-title" id="kbi-title">Daily Questions / KBIs</h2></div>
        <p class="panel-aside">Check in. Drive performance. Every day.</p>
      </header>
      <ol class="kbi-q">
        ${month.functions.map((fn, i) => {
          const st = dayStatus(month, fn, day).status;
          return `
          <li><a class="kbi-link" href="${href(month, day, fn.id)}" data-open-detail="${esc(fn.id)}">
            <span class="kbi-n" aria-hidden="true">${i + 1}</span>
            <span class="kbi-question">${esc(fn.dorQuestion)}</span>
            <span class="kbi-meta"><span class="kbi-dept">${esc(fn.name)}</span><span class="kbi-st hs--${st}">${mdot(st)}<span>${esc(statusWord(st, fn.kpiDaily))}</span></span></span>
          </a></li>`;
        }).join('')}
      </ol>
    </section>`;
}

/* ---------- Render ---------- */

const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

let miniObserver = null;

export function renderHome(month, day, area) {
  document.querySelectorAll('[data-home-title]').forEach((n) => { n.textContent = `${month.plant} DOR Dashboard`; });
  document.querySelectorAll('[data-plant-name]').forEach((n) => { n.textContent = `${month.plant} plant`; });
  document.querySelector('[data-home-summary]').innerHTML = summaryMarkup(month, day, area);
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
  chip.setAttribute('aria-label', who ? `${who.name}: switch person or reset demo data` : "Choose who's entering, or reset demo data");
  chip.title = who ? who.name : "Who's entering?";
  chip.classList.toggle('is-unset', !who);

  // An unseen h2 keeps the outline whole: page h1, then this group's h2, then each card's h3.
  document.querySelector('[data-kpis]').innerHTML = `<h2 class="sr-only">Key numbers</h2>${KPI_CARDS.map((c) => kpiCard(month, day, area, c)).join('')}`;
  document.querySelector('[data-row2]').innerHTML = matrixPanel(month, day, area) + trendsPanel(month, day, area);
  document.querySelector('[data-row3]').innerHTML = issuesPanel(month, day) + kbiPanel(month, day);
  document.querySelector('[data-print-meta]').textContent = `Area: ${areaName(area)}`;

  miniObserver?.disconnect();
  const minis = [...document.querySelectorAll('.home-app [data-mini]')];
  minis.forEach((el) => drawMini(el));
  miniObserver = new ResizeObserver(() => minis.forEach((el) => drawMini(el)));
  minis.forEach((el) => miniObserver.observe(el));
  document.documentElement.dataset.ready = 'true';
}

// Printing lays the page out at paper width; redraw the trend line to fit it,
// and again when the print layout goes away. (Print CSS also scales it as a fallback.)
const printQuery = matchMedia('print');
printQuery.addEventListener('change', () => {
  document.querySelectorAll('.home-app [data-mini]').forEach((el) => drawMini(el));
});

/**
 * After a save on the home: bring the department into view, wash it briefly and
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
