// Month sparkline: Plant-total daily actual vs goal, hand-rolled SVG.
// Rules (DESIGN.md): 2px actual line, dashed goal (a target, not a grid),
// weekends bridged, a missing production day breaks the line, status-shaped
// end marker, hover crosshair + tooltip. Values stay readable without hover
// through the caption beside it and the Detail screen's table.

import { STATUS_WORD } from './status.js?v=20261013-151156';
import { GLYPH } from './ui.js?v=20261013-151156';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VB_W = 240;
const VB_H = 60;
const PAD_X = 4;
const PAD_Y = 8;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {object} o
 * @param {Array<{day:number, actual:number|null, goal:number|null}>} o.series
 * @param {(day:number)=>boolean|null} o.isProductionDay
 * @param {number} o.day            selected day (data drawn through this day)
 * @param {number} o.daysInMonth
 * @param {string} o.endStatus      status of the selected day
 * @param {(row)=>{date:string, value:string, status:string}} o.describe  tooltip text for a day
 * @param {string} o.label          accessible description
 */
export function renderSparkline(o) {
  const pts = o.series.filter((r) => r.day <= o.day && o.isProductionDay(r.day) !== false);
  const values = pts.flatMap((r) => [r.actual, r.goal]).filter(isNum);
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 1;
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;

  const x = (d) => PAD_X + ((d - 1) / Math.max(1, o.daysInMonth - 1)) * (VB_W - PAD_X * 2);
  const y = (v) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (VB_H - PAD_Y * 2);

  const pathFor = (key) => {
    let d = '';
    let pen = false;
    for (const r of pts) {
      if (!isNum(r[key])) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${x(r.day).toFixed(2)} ${y(r[key]).toFixed(2)} `;
      if (!pen) d += 'l0 0 '; // lone points still show as a round dot
      pen = true;
    }
    return d.trim();
  };

  const wrap = document.createElement('div');
  wrap.className = 'spark';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', o.label);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VB_W} ${VB_H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  for (const [key, cls] of [['goal', 'spark-goal'], ['actual', 'spark-actual']]) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', pathFor(key));
    p.setAttribute('class', cls);
    p.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(p);
  }
  wrap.append(svg);

  // End marker for the selected day, as HTML so it stays round when the
  // SVG stretches to the cell width.
  const end = pts.find((r) => r.day === o.day);
  if (end && o.endStatus !== 'no-production') {
    const v = isNum(end.actual) ? end.actual : isNum(end.goal) ? end.goal : null;
    if (v !== null) {
      const m = document.createElement('span');
      m.className = `spark-end spark-end--${o.endStatus}`;
      // The same status glyph as the words beside it (dot, dot with "!", ring, diamond).
      m.innerHTML = `<svg aria-hidden="true" focusable="false"><use href="#${GLYPH[o.endStatus]}"></use></svg>`;
      m.style.left = `${(x(end.day) / VB_W) * 100}%`;
      m.style.top = `${(y(v) / VB_H) * 100}%`;
      wrap.append(m);
    }
  }

  // Hover layer: crosshair snaps to the nearest drawn day.
  const cross = document.createElement('span');
  cross.className = 'spark-cross';
  const tip = document.createElement('span');
  tip.className = 'spark-tip';
  const tipValue = document.createElement('strong');
  const tipMeta = document.createElement('span');
  tip.append(tipValue, tipMeta);
  wrap.append(cross, tip);

  const drawn = pts.filter((r) => isNum(r.actual) || isNum(r.goal));
  wrap.addEventListener('pointermove', (e) => {
    if (!drawn.length) return;
    const box = wrap.getBoundingClientRect();
    const fx = ((e.clientX - box.left) / box.width) * VB_W;
    let best = drawn[0];
    for (const r of drawn) if (Math.abs(x(r.day) - fx) < Math.abs(x(best.day) - fx)) best = r;
    const left = (x(best.day) / VB_W) * 100;
    const info = o.describe(best);
    tipValue.textContent = info.value;
    tipMeta.textContent = `${info.date}, ${(info.word ?? STATUS_WORD[info.status]).toLowerCase()}`;
    cross.style.left = `${left}%`;
    tip.style.left = `${left}%`;
    tip.dataset.side = left > 55 ? 'left' : 'right';
    wrap.classList.add('is-hover');
  });
  wrap.addEventListener('pointerleave', () => wrap.classList.remove('is-hover'));

  return wrap;
}
