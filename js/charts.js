// Hand-rolled SVG charts for Detail and Meeting mode (dataviz rules):
// bars <= 24px with a 4px rounded data end and a square baseline, 2px lines,
// dashed goal (a target, not a grid), hairline solid grid, recessive axes,
// labels in text tokens, a hover/focus tooltip, and a table twin for every chart.
// Charts are drawn at their real pixel width so text never stretches.

import { ON, OFF, statusWord } from './status.js?v=20261013-151156';
import { formatTicks, formatPair } from './format.js?v=20261013-151156';
import { esc, glyphMarkup, statusMarkup } from './ui.js?v=20261013-151156';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

let measureCtx = null;
/** A label's width in px in the UI font (an estimate where canvas can't measure). */
function textWidth(text, fs, weight = 400) {
  try {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    const family = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'Archivo, sans-serif';
    measureCtx.font = `${weight} ${fs}px ${family}`;
    return measureCtx.measureText(String(text)).width;
  } catch {
    return String(text).length * fs * 0.62;
  }
}

function niceStep(x) {
  if (!(x > 0)) return 1;
  const exp = 10 ** Math.floor(Math.log10(x));
  const f = x / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

/** Zero-based ticks for bars. Counts get whole-number steps. */
function zeroTicks(max, unit) {
  let step = niceStep((max || 1) / 3);
  if (['count', 'people', 'parts'].includes(unit)) step = Math.max(1, Math.round(step));
  const top = Math.max(step, Math.ceil((max || 0) / step) * step);
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { top, ticks };
}

/**
 * Zero-based ticks for bars, with a little headroom over the highest value. The ticks always reach
 * the highest value (bars up to 780 hours get 0 / 400 / 800, never 0 / 500 under bars that run past
 * it): the last tick sits inside the headroom, or the plot grows to the next one.
 * -> { top, ticks } (top is where the plot ends; it needn't be a tick)
 */
function headroomTicks(max, unit) {
  const whole = ['count', 'people', 'parts'].includes(unit);
  // A small count gets one step above it (one incident fills about half the plot); nothing yet keeps 0 to 1.
  const head = (max <= 3 && unit !== 'fraction' ? max + 1 : max * 1.15) || 1;
  const exp = 10 ** Math.floor(Math.log10(head / 3));
  let best = null;
  for (const e of [exp / 10, exp, exp * 10]) {
    for (const f of [1, 2, 2.5, 4, 5]) {
      const step = Number((f * e).toPrecision(12));
      if (whole && (step < 1 || !Number.isInteger(step))) continue;
      let last = Math.floor(head / step + 1e-9) * step;
      const stretched = last < max - 1e-9;
      if (stretched) last = Math.ceil(max / step - 1e-9) * step;
      const n = Math.round(last / step);
      // Three or four ticks (two to four steps); a plot stretched past its headroom only a little.
      if (n < 2 || n > 4 || last > head * 1.25) continue;
      const score = Math.abs(n - 3) + (stretched ? 1 : 0);
      if (!best || score < best.score || (score === best.score && step > best.step)) best = { step, last, score };
    }
  }
  const ticks = [];
  if (!best) {
    // Nothing fits that rule (an empty chart's 0 to 1): even steps under the headroom.
    let step = niceStep(head / 3);
    if (head / step < 2) step = niceStep(head / 4);
    if (whole) step = Math.max(1, Math.round(step));
    for (let v = 0; v <= head + 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
    return { top: head, ticks };
  }
  for (let v = 0; v <= best.last + best.step / 2; v += best.step) ticks.push(Number(v.toFixed(10)));
  return { top: Math.max(head, best.last), ticks };
}

/**
 * "Goal 616" at the right end of a Detail or Meeting chart's goal line, in steel. When it would sit
 * within 14px of the end value's label it steps 14px away from it (up or down, whichever stays in the plot).
 */
function goalEndLabel(text, x, gy, fs, { avoidY = null, minY, maxY } = {}) {
  let y = gy;
  if (isNum(avoidY) && Math.abs(y - avoidY) < 14) {
    const up = avoidY - 14;
    const down = avoidY + 14;
    y = y <= avoidY ? (up >= minY ? up : down) : (down <= maxY ? down : up);
  }
  y = Math.min(maxY, Math.max(minY, y));
  return `<text class="chart-goal-label" x="${x.toFixed(1)}" y="${y.toFixed(1)}" dy="0.35em" font-size="${fs}">${esc(text)}</text>`;
}

/**
 * The y labels a short board chart shows: every other tick, and under 64px of plot
 * only the low and the high one (12px labels a few pixels apart would touch).
 */
function compactTicks(ticks, plotHeight) {
  if (plotHeight < 64 && ticks.length > 2) return [ticks[0], ticks[ticks.length - 1]];
  return ticks.length > 3 ? ticks.filter((_, i) => i % 2 === 0) : ticks;
}

/** Data-range ticks for lines. */
function rangeTicks(lo, hi, unit) {
  if (lo === hi) {
    // One value (often just the goal): a small band around it, never below zero for data that can't be.
    const pad = unit === 'fraction' ? Math.max(0.01, Math.abs(lo) * 0.05) : Math.max(1, Math.abs(lo) * 0.1);
    const floor = lo >= 0 ? 0 : -Infinity;
    lo = Math.max(floor, lo - pad);
    hi += pad;
  }
  let step = niceStep((hi - lo) / 3);
  if (['count', 'people', 'parts'].includes(unit)) step = Math.max(1, Math.round(step));
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { lo: a, hi: b, ticks };
}


/* ---------- Shared shell: sizing, tooltip, keyboard ---------- */

function shell(el, o, draw) {
  el.classList.add('chart');
  if (o.focusable === false) {
    // Board rows: hover only. The same numbers are in Detail, with keyboard and table.
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', o.label);
  } else {
    el.tabIndex = 0;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', `${o.label}. Use the left and right arrow keys to read each point, or open the table.`);
  }
  el.innerHTML = '';
  const svgHost = document.createElement('div');
  svgHost.className = 'chart-svg';
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.setAttribute('aria-hidden', 'true');
  const live = document.createElement('p');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  el.append(svgHost, tip, live);

  let points = [];
  let cursor = -1;
  let lastWidth = 0;
  let lastHeight = 0;

  // o.fitHeight: drawn at the host's own height, again whenever it changes (a board row that
  // grows to fill the TV gives its charts the room). Otherwise o.height, redrawn on width only.
  const render = () => {
    const width = Math.round(el.clientWidth);
    const height = o.fitHeight ? Math.round(el.clientHeight) : 0;
    if (!width || (width === lastWidth && height === lastHeight)) return;
    lastWidth = width;
    lastHeight = height;
    const out = draw(width, height || undefined);
    svgHost.innerHTML = out.svg;
    points = out.points; // [{ x, yTop, text: {value, meta, status} }]
    if (cursor >= 0) show(cursor, false);
  };

  function show(i, announce) {
    const p = points[i];
    if (!p) return hide();
    cursor = i;
    tip.innerHTML = `<strong>${esc(p.text.value)}</strong><span>`
      + (p.text.status ? glyphMarkup(p.text.status) : '')
      + `${esc(p.text.meta)}</span>`;
    tip.dataset.status = p.text.status ?? '';
    const w = el.clientWidth;
    tip.style.left = `${p.x}px`;
    tip.style.top = `${p.yTop}px`;
    tip.dataset.side = p.x > w * 0.6 ? 'left' : 'right';
    el.classList.add('is-active');
    svgHost.querySelectorAll('.is-cursor').forEach((n) => n.classList.remove('is-cursor'));
    svgHost.querySelector(`[data-i="${i}"]`)?.classList.add('is-cursor');
    // "82 of 89 people, Below goal, Fri, Feb 27". Not entered and No goal set are already in the value.
    const word = p.text.status === ON || p.text.status === OFF ? statusWord(p.text.status, o.kpi) : '';
    if (announce) live.textContent = [p.text.value, word, p.text.meta].filter(Boolean).join(', ');
  }
  function hide() {
    el.classList.remove('is-active');
    svgHost.querySelectorAll('.is-cursor').forEach((n) => n.classList.remove('is-cursor'));
  }

  el.addEventListener('pointermove', (e) => {
    if (!points.length) return;
    const x = e.clientX - el.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < points.length; i += 1) if (Math.abs(points[i].x - x) < Math.abs(points[best].x - x)) best = i;
    show(best, false);
  });
  el.addEventListener('pointerleave', () => { if (document.activeElement !== el) hide(); });
  el.addEventListener('focus', () => show(cursor >= 0 ? cursor : points.length - 1, true));
  el.addEventListener('blur', hide);
  el.addEventListener('keydown', (e) => {
    if (!points.length) return;
    const move = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }[e.key];
    if (move === undefined) return;
    e.preventDefault();
    const base = cursor >= 0 ? cursor : points.length - 1;
    const next = Math.max(0, Math.min(points.length - 1, base + (Number.isFinite(move) ? move : move > 0 ? points.length : -points.length)));
    show(next, true);
  });

  const ro = new ResizeObserver(() => requestAnimationFrame(render));
  ro.observe(el);
  render();
  return { destroy: () => ro.disconnect() };
}

/**
 * The off-goal glyph (red dot with a white "!") drawn in a chart: shape as well
 * as color, and the same mark the status words use everywhere.
 * `bottom` is where the mark's lower edge sits; `attrs` go on the group.
 */
function flag(cx, bottom, fs, attrs = '', radius = null) {
  const r = radius ?? Math.max(5.5, fs * 0.5);
  const cy = bottom - r;
  const w = Math.max(1.8, r * 0.27);
  const svg = `<g class="chart-flag"${attrs}><circle cx="${cx}" cy="${cy}" r="${r}"></circle>`
    + `<rect class="chart-flag-mark" x="${cx - w / 2}" y="${cy - r * 0.6}" width="${w}" height="${r * 0.72}" rx="${w / 2}"></rect>`
    + `<circle class="chart-flag-mark" cx="${cx}" cy="${cy + r * 0.45}" r="${w * 0.62}"></circle></g>`;
  return { svg, top: cy - r };
}

function roundedTopBar(x, yTop, w, base) {
  const h = base - yTop;
  const r = Math.min(4, w / 2, h);
  return `M${x} ${base}V${yTop + r}Q${x} ${yTop} ${x + r} ${yTop}H${x + w - r}Q${x + w} ${yTop} ${x + w} ${yTop + r}V${base}Z`;
}

function gridAndYLabels(ticks, y, left, right, unit, fs) {
  const labels = formatTicks(ticks, unit);
  return ticks.map((t, i) => `<line class="chart-grid" x1="${left}" x2="${right}" y1="${y(t)}" y2="${y(t)}"></line>`
    + `<text class="chart-label" x="${left - 8}" y="${y(t)}" dy="0.35em" text-anchor="end" font-size="${fs}">${esc(labels[i])}</text>`).join('');
}

/* ---------- Month, day by day: bars vs dashed goal ---------- */

/**
 * o = { series, day, daysInMonth, isProductionDay(d), statusOf(row), describe(row),
 *       kpi, label, height?, fontSize?, monthShort, weekdayOf(d) }
 */
export function barChart(el, o) {
  return shell(el, o, (width) => {
    const fs = o.fontSize ?? 12;
    const H = o.height ?? 200;
    const left = Math.round(fs * 3.6);
    const rows = o.series.filter((r) => r.day <= o.day && !r.beforeStart && o.isProductionDay(r.day) !== false);
    // A goal of 0 every day is the axis itself: no dashed line on top of it.
    const goals = rows.map((r) => r.goal).filter(isNum);
    const drawGoal = goals.some((g) => g !== 0);
    // The goal's last level is named at the right end ("Goal 616"); the plot leaves room for it.
    const lastGoal = drawGoal ? [...rows].reverse().find((r) => isNum(r.goal)) : null;
    const goalText = lastGoal ? `Goal ${formatPair(null, lastGoal.goal, o.kpi).goal}` : '';
    const m = { top: fs + 10, right: goalText ? Math.ceil(textWidth(goalText, fs) + 14) : 6, bottom: fs + 12 };
    const pw = width - left - m.right;
    const base = H - m.bottom;
    const ph = base - m.top;
    const slot = pw / o.daysInMonth;
    const barW = Math.max(3, Math.min(24, slot - 4));
    const max = Math.max(0, ...rows.flatMap((r) => [r.actual, r.goal]).filter(isNum));
    // Headroom over the highest bar, with ticks that reach it (headroomTicks).
    const { top, ticks } = headroomTicks(max, o.kpi.unit);
    const y = (v) => base - (v / top) * ph;

    let svg = `<svg width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" aria-label="${esc(o.label)}">`;
    svg += gridAndYLabels(ticks, y, left, width - m.right, o.kpi.unit, fs);
    const points = [];
    let marks = '';
    let goalPath = '';
    let selectedFlag = '';
    let labels = '';
    rows.forEach((r, ri) => {
      const sx = left + slot * (r.day - 1);
      const cx = sx + slot / 2;
      const status = o.statusOf(r);
      const i = points.length;
      // One stepped goal line: a step joins two days in a row with a vertical at the slot
      // edge; a gap (a weekend, a day with no goal) breaks it. Never a diagonal.
      if (drawGoal && isNum(r.goal)) {
        const prev = rows[ri - 1];
        const next = rows[ri + 1];
        const joinPrev = prev && prev.day === r.day - 1 && isNum(prev.goal);
        const joinNext = next && next.day === r.day + 1 && isNum(next.goal);
        const gy = y(r.goal).toFixed(1);
        goalPath += joinPrev ? `V${gy} ` : `M${(sx + 1).toFixed(1)} ${gy} `;
        goalPath += `H${(joinNext ? sx + slot : sx + slot - 1).toFixed(1)} `;
      }
      let yTop = base;
      if (isNum(r.actual)) {
        // A zero is a short stub in the Actual color, so "nothing happened" still shows as a mark.
        yTop = r.actual > 0 ? Math.min(base - 2, y(r.actual)) : base - 4;
        const cls = status === OFF ? 'chart-bar chart-bar--off' : r.actual > 0 || status !== ON ? 'chart-bar' : 'chart-bar chart-bar--zero';
        marks += r.actual > 0
          ? `<path class="${cls}" data-i="${i}" d="${roundedTopBar(cx - barW / 2, yTop, barW, base)}"></path>`
          : `<rect class="${cls}" data-i="${i}" x="${cx - barW / 2}" y="${base - 4}" width="${barW}" height="4" rx="1"></rect>`;
        if (r.day === o.day) {
          marks += `<rect class="chart-selected" x="${cx - barW / 2 - 3.5}" y="${yTop - 3.5}" width="${barW + 7}" height="${base - yTop + 3.5}" rx="5"></rect>`;
        }
        // Red bars mark every miss; the off glyph sits only on the day being looked at,
        // painted last so the goal line never crosses it.
        if (status === OFF && r.day === o.day) {
          const f = flag(cx, yTop - 6, fs);
          selectedFlag = f.svg;
          yTop = f.top;
        }
      } else {
        marks += `<circle class="chart-missing" data-i="${i}" cx="${cx}" cy="${base - 6}" r="4"></circle>`;
        yTop = base - 12;
      }
      const isMonday = o.weekdayOf(r.day) === 1;
      if (r.day === o.day || (isMonday && Math.abs(r.day - o.day) > 2)) {
        const first = !labels;
        labels += `<text class="chart-label${r.day === o.day ? ' is-strong' : ''}" x="${cx}" y="${H - 2}" text-anchor="middle" font-size="${fs}">${first ? `${o.monthShort} ` : ''}${r.day}</text>`;
      }
      points.push({ x: cx, yTop, text: o.describe(r) });
    });
    svg += `<line class="chart-axis" x1="${left}" x2="${width - m.right}" y1="${base}" y2="${base}"></line>`;
    svg += marks + (goalPath ? `<path class="chart-goal-step" d="${goalPath.trim()}"></path>` : '') + selectedFlag + labels;
    if (goalText) svg += goalEndLabel(goalText, width - m.right + 8, y(lastGoal.goal), fs, { minY: m.top, maxY: base - 2 });
    svg += '</svg>';
    return { svg, points };
  });
}

/* ---------- Month so far: line vs dashed goal ---------- */

/** o = { series, day, daysInMonth, isProductionDay, describe, kpi, label, height?, fontSize?, monthShort, weekdayOf } */
export function lineChart(el, o) {
  return shell(el, o, (width) => {
    const fs = o.fontSize ?? 12;
    const H = o.height ?? 170;
    const left = Math.round(fs * 3.6);
    const rows = o.series.filter((r) => r.day <= o.day && !r.beforeStart && o.isProductionDay(r.day) !== false);
    const end = rows.find((r) => r.day === o.day);
    const hasEnd = Boolean(end && isNum(end.actual));
    // The goal's last level is named at its right end ("Goal 98"), beside the end value's label.
    const lastGoal = [...rows].reverse().find((r) => isNum(r.goal)) ?? null;
    const goalText = lastGoal ? `Goal ${formatPair(hasEnd ? end.actual : null, lastGoal.goal, o.kpi).goal}` : '';
    // Both labels start 10px past the day: the right margin leaves them room even on the month's last day.
    const labelW = Math.max(hasEnd ? textWidth(o.endLabel ?? '', fs + 1, 700) : 0, goalText ? textWidth(goalText, fs) : 0);
    const along = Math.max(0, Math.min(1, (o.day - 1) / Math.max(1, o.daysInMonth - 1)));
    const room = along > 0 ? (10 + labelW + 4 - (width - left) * (1 - along)) / along : 0;
    const m = { top: 12, right: Math.max(Math.round(fs * 4.5), Math.ceil(room)), bottom: fs + 12 };
    const base = H - m.bottom;
    const pw = width - left - m.right;
    const vals = rows.flatMap((r) => [r.actual, r.goal]).filter(isNum);
    const { lo, hi, ticks } = rangeTicks(Math.min(...vals, vals.length ? Infinity : 0), Math.max(...vals, vals.length ? -Infinity : 1), o.kpi.unit);
    const x = (d) => left + ((d - 1) / Math.max(1, o.daysInMonth - 1)) * pw;
    const y = (v) => base - ((v - lo) / (hi - lo || 1)) * (base - m.top);
    const path = (key) => {
      let d = ''; let pen = false;
      rows.forEach((r) => {
        if (!isNum(r[key])) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${x(r.day).toFixed(1)} ${y(r[key]).toFixed(1)} ${pen ? '' : 'l0 0 '}`;
        pen = true;
      });
      return d.trim();
    };
    // The goal is a step, as on the board's trend: one level per production day across its own day
    // (half a day each side), a riser where back-to-back days change it, and the pen lifted over
    // weekends and days with no goal. Never a diagonal. A lone day is a short tick around its point.
    const dayW = pw / Math.max(1, o.daysInMonth - 1);
    let goalEnd = null; // where the goal line stops: its label starts 10px past it
    const goalPath = () => {
      let d = '';
      rows.forEach((r, i) => {
        if (!isNum(r.goal)) return;
        const prev = rows[i - 1];
        const next = rows[i + 1];
        const join = prev && prev.day === r.day - 1 && isNum(prev.goal);
        const alone = !join && !(next && next.day === r.day + 1 && isNum(next.goal));
        const half = alone ? Math.max(dayW / 2, 12) : dayW / 2;
        const gy = y(r.goal).toFixed(1);
        const from = Math.max(left, x(r.day) - half).toFixed(1);
        // Nothing past the day being looked at: the end marker and its value label sit there.
        const to = Math.min(width - m.right, x(o.day), x(r.day) + half).toFixed(1);
        // A riser only where the goal changes from one day to the next.
        if (join) d += `${y(prev.goal).toFixed(1) === gy ? '' : `V${gy} `}H${to} `;
        else d += `M${from} ${gy} H${to} `;
        goalEnd = { x: Number(to), y: Number(gy) };
      });
      return d.trim();
    };
    let svg = `<svg width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" aria-label="${esc(o.label)}">`;
    svg += gridAndYLabels(ticks, y, left, width - m.right, o.kpi.unit, fs);
    // The goal is painted over the actual, so where they're equal (People from Feb 6) the dashes still show.
    svg += `<path class="chart-line" d="${path('actual')}"></path><path class="chart-goal-line" d="${goalPath()}"></path>`;
    const points = [];
    let labels = '';
    for (const r of rows) {
      const v = isNum(r.actual) ? r.actual : r.goal;
      if (!isNum(v)) continue;
      points.push({ x: x(r.day), yTop: y(v) - 8, text: o.describe(r) });
      svg += `<circle class="chart-hit" data-i="${points.length - 1}" cx="${x(r.day)}" cy="${y(v)}" r="4"></circle>`;
      if (r.day === o.day || (o.weekdayOf(r.day) === 1 && Math.abs(r.day - o.day) > 2)) {
        labels += `<text class="chart-label${r.day === o.day ? ' is-strong' : ''}" x="${x(r.day)}" y="${H - 2}" text-anchor="middle" font-size="${fs}">${labels ? '' : `${o.monthShort} `}${r.day}</text>`;
      }
    }
    if (hasEnd) {
      svg += `<circle class="chart-end" cx="${x(end.day)}" cy="${y(end.actual)}" r="5"></circle>`;
      svg += `<text class="chart-value" x="${x(end.day) + 10}" y="${y(end.actual)}" dy="0.35em" font-size="${fs + 1}">${esc(o.endLabel ?? '')}</text>`;
    }
    if (goalText && goalEnd) {
      svg += goalEndLabel(goalText, goalEnd.x + 10, goalEnd.y, fs, { avoidY: hasEnd ? y(end.actual) : null, minY: Math.ceil(fs * 0.6), maxY: base - 2 });
    }
    svg += labels + '</svg>';
    return { svg, points };
  });
}

/* ---------- This year: 12 months, actual where it exists ---------- */

/**
 * o = { monthly: [{month, actual, goal}], kpi, statusOf(row), describe(row, i),
 *       label, currentIndex, height?, fontSize? }
 * Percent measures plot as a line with dots on a range that shows misses
 * (zero-based bars would flatten 97.5% vs 98%). Counts and hours stay as
 * zero-based bars. Off-goal months are red with the off-goal glyph (red dot with a "!").
 */
export function yearChart(el, o) {
  const asLine = o.kpi.unit === 'fraction';
  return shell(el, o, (width, fitH) => {
    const fs = o.fontSize ?? 12;
    const H = fitH ?? o.height ?? 170;
    const left = o.left ?? Math.round(fs * 3.6);
    const m = { top: o.top ?? fs + 8, right: o.right ?? 10, bottom: fs + (o.compact ? 6 : 12) };
    const base = H - m.bottom;
    const pw = width - left - m.right;
    const slot = pw / 12;
    const barW = Math.max(6, Math.min(24, slot - 8));
    const vals = o.monthly.flatMap((r) => [r.actual, r.goal]).filter(isNum);
    let y;
    let ticks;
    if (asLine) {
      const r = rangeTicks(Math.min(...vals), Math.max(...vals), o.kpi.unit);
      ticks = r.ticks;
      y = (v) => base - ((v - r.lo) / (r.hi - r.lo || 1)) * (base - m.top);
    } else {
      const z = zeroTicks(Math.max(0, ...vals), o.kpi.unit);
      ticks = z.ticks;
      y = (v) => base - (v / z.top) * (base - m.top);
    }
    let svg = `<svg width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" ${o.focusable === false ? 'aria-hidden="true" focusable="false"' : `role="img" aria-label="${esc(o.label)}"`}>`;
    // Board rows are short: every other tick, and only the low and high one under 64px of plot, so labels never touch.
    const shownTicks = o.compact ? compactTicks(ticks, base - m.top) : ticks;
    svg += gridAndYLabels(shownTicks, y, left, width - m.right, o.kpi.unit, fs);
    const cx = (i) => left + slot * i + slot / 2;
    const monthName = (r) => (slot < fs * 3.2 ? r.month.charAt(0) : r.month.charAt(0) + r.month.slice(1).toLowerCase());
    const monthLabels = yearLabelPlaces(o.monthly, o.currentIndex, { cx, slot, fs, left, name: monthName });
    const points = [];
    let goals = '';
    let marks = '';
    let labels = '';
    let line = '';
    let pen = false;
    o.monthly.forEach((r, i) => {
      const sx = left + slot * i;
      const x = cx(i);
      const has = isNum(r.actual);
      const status = has ? o.statusOf(r) : null;
      // Under 18px a month's dashes break into specks: a solid tick reads as one goal per month.
      // Months still to come are drawn at half strength, so goals that differ a little month
      // to month (working days) don't read as jitter beside the months with results.
      if (isNum(r.goal)) {
        const future = Number.isInteger(o.currentIndex) && i > o.currentIndex ? ' chart-goal--future' : '';
        goals += slot < 18
          ? `<line class="chart-goal chart-goal--solid${future}" x1="${sx + 2}" x2="${sx + slot - 2}" y1="${y(r.goal)}" y2="${y(r.goal)}"></line>`
          : `<line class="chart-goal${future}" x1="${sx + 3}" x2="${sx + slot - 3}" y1="${y(r.goal)}" y2="${y(r.goal)}"></line>`;
      }
      let yTop = isNum(r.goal) ? y(r.goal) - 6 : base - 10;
      if (has) {
        if (asLine) {
          const vy = y(r.actual);
          line += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${vy.toFixed(1)} `;
          pen = true;
          marks += status === OFF
            ? flag(x, vy + Math.max(5.5, fs * 0.6), fs * 1.2, ` data-i="${i}"`).svg
            : `<circle class="chart-dot chart-point" data-i="${i}" cx="${x}" cy="${vy}" r="${Math.max(4.5, fs * 0.38)}"></circle>`;
          yTop = Math.min(yTop, vy - fs);
        } else {
          const t = r.actual > 0 ? Math.min(base - 2, y(r.actual)) : base - 2;
          const cls = status === OFF ? 'chart-bar chart-bar--off' : 'chart-bar';
          marks += r.actual > 0
            ? `<path class="${cls}" data-i="${i}" d="${roundedTopBar(x - barW / 2, t, barW, base)}"></path>`
            : `<rect class="${cls}" data-i="${i}" x="${x - barW / 2}" y="${base - 4}" width="${barW}" height="3" rx="1"></rect>`;
          let top = t;
          if (status === OFF) { const f = flag(x, t - 4, fs); marks += f.svg; top = f.top; }
          yTop = Math.min(yTop, top - 6);
        }
      } else {
        pen = false;
      }
      const at = monthLabels.get(i);
      if (at !== undefined) {
        labels += `<text class="chart-label${i === o.currentIndex ? ' is-strong' : ''}" x="${at.toFixed(1)}" y="${H - 2}" text-anchor="middle" font-size="${fs}">${monthName(r)}</text>`;
      }
      points.push({ x, yTop, text: o.describe(r, i) });
    });
    if (asLine && line) svg += `<path class="chart-line" d="${line.trim()}"></path>`;
    svg += `<line class="chart-axis" x1="${left}" x2="${width - m.right}" y1="${base}" y2="${base}"></line>`;
    svg += goals + marks + labels + '</svg>';
    return { svg, points };
  });
}

/**
 * Where each month's label goes (index -> x), so letters never run together. Wide charts label
 * every month. Narrow ones label the first month, the current one (bold) and every third month
 * (J F A J O), each only where it clears the labels already placed; the first month always shows,
 * stepping left of the current month's label when they would touch.
 */
function yearLabelPlaces(monthly, current, { cx, slot, fs, left, name }) {
  const places = new Map();
  if (slot >= fs * 1.5) {
    monthly.forEach((_, i) => places.set(i, cx(i)));
    return places;
  }
  const gap = Math.max(3, fs * 0.3);
  const placed = [];
  const order = [current, 0, 3, 6, 9].filter((i, k, all) => Number.isInteger(i) && i >= 0 && i < monthly.length && all.indexOf(i) === k);
  for (const i of order) {
    const w = textWidth(name(monthly[i]), fs, i === current ? 700 : 400);
    let a = cx(i) - w / 2;
    let b = cx(i) + w / 2;
    const hit = placed.find((p) => a < p.b + gap && b > p.a - gap);
    if (hit) {
      if (i !== 0) continue;
      // The year's first month: just left of the label it touches, at most into the axis gutter.
      b = hit.a - gap;
      a = b - w;
      if (a < left - fs * 2.5) continue;
    }
    placed.push({ a, b });
    places.set(i, (a + b) / 2);
  }
  return places;
}

/* ---------- Table twin ---------- */

/** columns = [{ label, cell(row) -> {text, status?} | string, num? }] */
export function dataTable(rows, columns, caption) {
  const table = document.createElement('table');
  table.className = 'data-table';
  const cap = document.createElement('caption');
  cap.className = 'sr-only';
  cap.textContent = caption;
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const c of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = c.label;
    if (c.num) th.className = 'num';
    hr.append(th);
  }
  thead.append(hr);
  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    columns.forEach((c, i) => {
      const td = document.createElement(i === 0 ? 'th' : 'td');
      if (i === 0) td.scope = 'row';
      const v = c.cell(r);
      if (v && typeof v === 'object' && v.status) {
        td.innerHTML = statusMarkup(v.status, { tag: 'span', kpi: v.kpi ?? null });
      } else {
        td.textContent = v ?? '';
      }
      if (c.num) td.className = 'num';
      tr.append(td);
    });
    tbody.append(tr);
  }
  table.append(cap, thead, tbody);
  return table;
}

/* ---------- Board row: the month so far, day by day (compact) ---------- */

/**
 * A small line of each production day's actual against its goal, for a board row.
 * On-goal days are dots in the on-track color; off-goal days are the off-goal glyph
 * (red dot with a "!"), so shape carries the status as well as color. The goal is a
 * dashed line (a target, not a grid). A production day with no number breaks the
 * line and shows a hollow ring on the baseline.
 * o = { series, day, isProductionDay(d), statusOf(row), describe(row), kpi, label,
 *       height?, fitHeight?, fontSize?, firstLabel(d), firstLabelShort(d)?, lastLabel(d), focusable? }
 */
export function trendChart(el, o) {
  return shell(el, o, (width, fitH) => {
    // 11px at the least on a laptop or phone (10px was too small to read); the board passes 12 on a TV.
    const fs = o.fontSize ?? 11;
    const H = fitH ?? o.height ?? 88;
    const left = o.left ?? Math.round(fs * 3.4);
    const m = { top: 8, right: 8, bottom: fs + 6 };
    const base = H - m.bottom;
    const rows = o.series.filter((r) => r.day <= o.day && !r.beforeStart && o.isProductionDay(r.day) !== false);
    const vals = rows.flatMap((r) => [r.actual, r.goal]).filter(isNum);
    const { lo, hi, ticks } = rangeTicks(vals.length ? Math.min(...vals) : 0, vals.length ? Math.max(...vals) : 1, o.kpi.unit);
    const shown = compactTicks(ticks, base - m.top);
    const first = rows[0]?.day ?? 1;
    const last = Math.max(first, rows[rows.length - 1]?.day ?? first);
    // One day so far sits in the middle; more spread from the first day to the last.
    const x = (d) => (last === first ? left + (width - left - m.right) / 2 : left + 4 + ((d - first) / (last - first)) * (width - left - m.right - 8));
    const y = (v) => base - ((v - lo) / (hi - lo || 1)) * (base - m.top);
    const path = (key) => {
      let d = ''; let pen = false;
      for (const r of rows) {
        if (!isNum(r[key])) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${x(r.day).toFixed(1)} ${y(r[key]).toFixed(1)} `;
        if (!pen) d += 'l0 0 ';
        pen = true;
      }
      return d.trim();
    };
    // The goal is one level per production day, across its own day step (half a step each side);
    // a riser joins back-to-back production days, and the pen lifts over weekends and days with no
    // goal. Never a diagonal. One day so far: a short tick.
    const step = last === first ? 24 : (width - left - m.right - 8) / (last - first);
    const goalPath = () => {
      let d = '';
      rows.forEach((r, i) => {
        if (!isNum(r.goal)) return;
        const prev = rows[i - 1];
        const join = prev && prev.day === r.day - 1 && isNum(prev.goal);
        const gy = y(r.goal).toFixed(1);
        const from = Math.max(left, x(r.day) - step / 2).toFixed(1);
        const to = Math.min(width - m.right, x(r.day) + step / 2).toFixed(1);
        d += join ? `V${gy} H${to} ` : `M${from} ${gy} H${to} `;
      });
      return d.trim();
    };
    let svg = `<svg width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" aria-hidden="true" focusable="false">`;
    svg += gridAndYLabels(shown, y, left, width - m.right, o.kpi.unit, fs);
    svg += `<line class="chart-axis" x1="${left}" x2="${width - m.right}" y1="${base}" y2="${base}"></line>`;
    // The goal is painted over the actual, so where they're equal (People from Feb 6) the dashes still show.
    svg += `<path class="chart-line" d="${path('actual')}"></path><path class="chart-goal-line" d="${goalPath()}"></path>`;
    const points = [];
    let marks = '';
    for (const r of rows) {
      const i = points.length;
      const cx = x(r.day);
      if (isNum(r.actual)) {
        const cy = y(r.actual);
        const status = o.statusOf(r);
        // Small dots with no ring, so close days don't merge; a miss is a slightly larger red dot.
        // The selected day carries the full off-goal glyph (red dot with "!"), the shape that never relies on color.
        if (r.day === o.day && status === OFF) marks += flag(cx, cy + 5, 9, ` data-i="${i}"`, 5).svg;
        else marks += `<circle class="chart-dot chart-dot--${status}" data-i="${i}" cx="${cx}" cy="${cy}" r="${status === OFF ? 3.25 : 2.5}"></circle>`;
        points.push({ x: cx, yTop: cy - 10, text: o.describe(r) });
      } else {
        marks += `<circle class="chart-missing" data-i="${i}" cx="${cx}" cy="${base - 3}" r="2"></circle>`;
        points.push({ x: cx, yTop: base - 12, text: o.describe(r) });
      }
    }
    svg += marks;
    if (rows.length) {
      // The first day's label steps down to its short form ("2"), then away, where it would touch the
      // last day's (a narrow column with Large text): the selected day's label always shows whole.
      const lastText = last !== first ? o.lastLabel(last) : null;
      const room = (t) => lastText === null || x(first) + textWidth(t, fs) + Math.max(4, fs * 0.5) <= x(last) - textWidth(lastText, fs, 700);
      const firstText = [o.firstLabel(first), o.firstLabelShort?.(first)].find((t) => t && room(t));
      if (firstText) svg += `<text class="chart-label" x="${x(first)}" y="${H - 1}" text-anchor="start" font-size="${fs}">${esc(firstText)}</text>`;
      if (lastText !== null) svg += `<text class="chart-label is-strong" x="${x(last)}" y="${H - 1}" text-anchor="end" font-size="${fs}">${esc(lastText)}</text>`;
    }
    svg += '</svg>';
    return { svg, points };
  });
}
