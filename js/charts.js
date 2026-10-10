// Hand-rolled SVG charts for Detail and Meeting mode (dataviz rules):
// bars <= 24px with a 4px rounded data end and a square baseline, 2px lines,
// dashed goal (a target, not a grid), hairline solid grid, recessive axes,
// labels in text tokens, a hover/focus tooltip, and a table twin for every chart.
// Charts are drawn at their real pixel width so text never stretches.

import { OFF } from './status.js';
import { formatTicks } from './format.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
import { esc, glyphMarkup, statusMarkup } from './ui.js';

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

/** Data-range ticks for lines. */
function rangeTicks(lo, hi, unit) {
  if (lo === hi) { lo -= 1; hi += 1; if (lo < 0 && unit !== 'fraction') { hi -= lo; lo = 0; } }
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
  el.tabIndex = 0;
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', `${o.label}. Use the left and right arrow keys to read each point, or open the table.`);
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

  const render = () => {
    const width = Math.round(el.clientWidth);
    if (!width || width === lastWidth) return;
    lastWidth = width;
    const out = draw(width);
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
    if (announce) live.textContent = `${p.text.value}, ${p.text.meta}`;
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
function flag(cx, bottom, fs, attrs = '') {
  const r = Math.max(5.5, fs * 0.5);
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
    const m = { top: fs + 10, right: 6, bottom: fs + 12 };
    const pw = width - left - m.right;
    const base = H - m.bottom;
    const ph = base - m.top;
    const slot = pw / o.daysInMonth;
    const barW = Math.max(3, Math.min(24, slot - 4));
    const rows = o.series.filter((r) => r.day <= o.day && o.isProductionDay(r.day) !== false);
    const max = Math.max(0, ...rows.flatMap((r) => [r.actual, r.goal]).filter(isNum));
    const { top, ticks } = zeroTicks(max, o.kpi.unit);
    const y = (v) => base - (v / top) * ph;

    let svg = `<svg width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" aria-label="${esc(o.label)}">`;
    svg += gridAndYLabels(ticks, y, left, width - m.right, o.kpi.unit, fs);
    const points = [];
    let marks = '';
    let goals = '';
    let labels = '';
    for (const r of rows) {
      const sx = left + slot * (r.day - 1);
      const cx = sx + slot / 2;
      const status = o.statusOf(r);
      const i = points.length;
      if (isNum(r.goal)) goals += `<line class="chart-goal" x1="${sx + 1}" x2="${sx + slot - 1}" y1="${y(r.goal)}" y2="${y(r.goal)}"></line>`;
      let yTop = base;
      if (isNum(r.actual)) {
        yTop = r.actual > 0 ? Math.min(base - 2, y(r.actual)) : base - 2;
        const cls = status === 'off' ? 'chart-bar chart-bar--off' : 'chart-bar';
        marks += r.actual > 0
          ? `<path class="${cls}" data-i="${i}" d="${roundedTopBar(cx - barW / 2, yTop, barW, base)}"></path>`
          : `<rect class="${cls}" data-i="${i}" x="${cx - barW / 2}" y="${base - 2}" width="${barW}" height="2"></rect>`;
        if (status === OFF) {
          const f = flag(cx, yTop - 4, fs);
          marks += f.svg;
          yTop = f.top;
        }
      } else {
        marks += `<circle class="chart-missing" data-i="${i}" cx="${cx}" cy="${base - 6}" r="4"></circle>`;
        yTop = base - 12;
      }
      if (r.day === o.day && isNum(r.actual)) {
        const barTop = r.actual > 0 ? Math.min(base - 2, y(r.actual)) : base - 2;
        marks += `<rect class="chart-selected" x="${cx - barW / 2 - 3.5}" y="${barTop - 3.5}" width="${barW + 7}" height="${base - barTop + 3.5}" rx="5"></rect>`;
      }
      const isMonday = o.weekdayOf(r.day) === 1;
      if (r.day === o.day || (isMonday && Math.abs(r.day - o.day) > 2)) {
        const first = !labels;
        labels += `<text class="chart-label${r.day === o.day ? ' is-strong' : ''}" x="${cx}" y="${H - 2}" text-anchor="middle" font-size="${fs}">${first ? `${o.monthShort} ` : ''}${r.day}</text>`;
      }
      points.push({ x: cx, yTop, text: o.describe(r) });
    }
    svg += `<line class="chart-axis" x1="${left}" x2="${width - m.right}" y1="${base}" y2="${base}"></line>`;
    svg += goals + marks + labels + '</svg>';
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
    const m = { top: 12, right: Math.round(fs * 4.5), bottom: fs + 12 };
    const base = H - m.bottom;
    const pw = width - left - m.right;
    const rows = o.series.filter((r) => r.day <= o.day && o.isProductionDay(r.day) !== false);
    const vals = rows.flatMap((r) => [r.actual, r.goal]).filter(isNum);
    const { lo, hi, ticks } = rangeTicks(Math.min(...vals, vals.length ? Infinity : 0), Math.max(...vals, vals.length ? -Infinity : 1), o.kpi.unit);
    const x = (d) => left + ((d - 1) / Math.max(1, o.daysInMonth - 1)) * pw;
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
    let svg = `<svg width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" aria-label="${esc(o.label)}">`;
    svg += gridAndYLabels(ticks, y, left, width - m.right, o.kpi.unit, fs);
    svg += `<path class="chart-goal-line" d="${path('goal')}"></path><path class="chart-line" d="${path('actual')}"></path>`;
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
    const end = rows.find((r) => r.day === o.day);
    if (end && isNum(end.actual)) {
      svg += `<circle class="chart-end" cx="${x(end.day)}" cy="${y(end.actual)}" r="5"></circle>`;
      svg += `<text class="chart-value" x="${x(end.day) + 10}" y="${y(end.actual)}" dy="0.35em" font-size="${fs + 1}">${esc(o.endLabel ?? '')}</text>`;
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
  return shell(el, o, (width) => {
    const fs = o.fontSize ?? 12;
    const H = o.height ?? 170;
    const left = Math.round(fs * 3.6);
    const m = { top: fs + 8, right: 10, bottom: fs + 12 };
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
    let svg = `<svg width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" aria-label="${esc(o.label)}">`;
    svg += gridAndYLabels(ticks, y, left, width - m.right, o.kpi.unit, fs);
    const cx = (i) => left + slot * i + slot / 2;
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
      if (isNum(r.goal)) goals += `<line class="chart-goal" x1="${sx + 3}" x2="${sx + slot - 3}" y1="${y(r.goal)}" y2="${y(r.goal)}"></line>`;
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
            : `<rect class="${cls}" data-i="${i}" x="${x - barW / 2}" y="${base - 2}" width="${barW}" height="2"></rect>`;
          let top = t;
          if (status === OFF) { const f = flag(x, t - 4, fs); marks += f.svg; top = f.top; }
          yTop = Math.min(yTop, top - 6);
        }
      } else {
        pen = false;
      }
      const name = slot < fs * 3.2 ? r.month.charAt(0) : r.month.charAt(0) + r.month.slice(1).toLowerCase();
      labels += `<text class="chart-label${i === o.currentIndex ? ' is-strong' : ''}" x="${x}" y="${H - 2}" text-anchor="middle" font-size="${fs}">${name}</text>`;
      points.push({ x, yTop, text: o.describe(r, i) });
    });
    if (asLine && line) svg += `<path class="chart-line" d="${line.trim()}"></path>`;
    svg += `<line class="chart-axis" x1="${left}" x2="${width - m.right}" y1="${base}" y2="${base}"></line>`;
    svg += goals + marks + labels + '</svg>';
    return { svg, points };
  });
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
