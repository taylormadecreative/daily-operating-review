// Color math for Customize: WCAG contrast, OKLab/OKLCH shading, tints, and the
// colorblind separation check. The CVD transform and the Delta E scale are the
// dataviz validator's (Machado et al. 2009, OKLab Delta E ×100; target 8).

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const s2lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lin2s = (c) => { c = clamp01(c); return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; };

/** "#b3202e" (or "b3202e", "#abc") -> [r, g, b] in 0..1, or null. */
export function parseHex(hex) {
  let h = String(hex ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
export const isHex = (hex) => parseHex(hex) !== null;

export function toHex(rgb) {
  return `#${rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('')}`;
}

const lin = (hex) => parseHex(hex).map(s2lin);
export function luminance(hex) {
  const [r, g, b] = lin(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix two colors in sRGB: t = share of `a` (0..1). Used for washes on a light ground. */
export function mix(a, b, t) {
  const A = parseHex(a);
  const B = parseHex(b);
  return toHex(A.map((v, i) => v * t + B[i] * (1 - t)));
}

/* ---------- OKLab / OKLCH ---------- */

function oklabFromLin([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
function linFromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
const inGamut = (rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

/** A color with OKLCH lightness L, same hue; chroma is reduced until it fits sRGB. */
function withLightness(hex, L) {
  const [, a, b] = oklabFromLin(lin(hex));
  for (let k = 1; k >= 0; k -= 0.05) {
    const rgb = linFromOklab([L, a * k, b * k]);
    if (inGamut(rgb)) return toHex(rgb.map(lin2s));
  }
  return toHex(linFromOklab([L, 0, 0]).map(lin2s));
}
export const lightnessOf = (hex) => oklabFromLin(lin(hex))[0];

/**
 * The nearest shade of `hex` (same hue, OKLCH lightness moved) that reaches
 * `min` contrast against every color in `grounds`. dir 'darker' for light
 * grounds, 'lighter' for dark ones. Returns { hex, adjusted }.
 */
export function readableShade(hex, grounds, { min = 4.5, dir = 'darker' } = {}) {
  const ok = (c) => grounds.every((g) => contrast(c, g) >= min);
  if (ok(hex)) return { hex: hex.toLowerCase(), adjusted: false };
  const L0 = lightnessOf(hex);
  let lo = dir === 'darker' ? 0 : L0;
  let hi = dir === 'darker' ? L0 : 1;
  let best = dir === 'darker' ? withLightness(hex, 0) : withLightness(hex, 1);
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    const c = withLightness(hex, mid);
    if (ok(c)) {
      best = c;
      if (dir === 'darker') lo = mid; else hi = mid; // stay as close to the pick as possible
    } else if (dir === 'darker') hi = mid; else lo = mid;
  }
  return { hex: best, adjusted: true };
}

/* ---------- Colorblind separation ---------- */

const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
};
function simulate(hex, kind) {
  const [r, g, b] = lin(hex);
  const M = MACHADO[kind];
  return M.map((row) => clamp01(row[0] * r + row[1] * g + row[2] * b));
}
function deltaE(h1, h2, kind) {
  const a = oklabFromLin(kind ? simulate(h1, kind) : lin(h1));
  const b = oklabFromLin(kind ? simulate(h2, kind) : lin(h2));
  return 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
/** Worst of protan / deutan OKLab Delta E ×100 (the dataviz check). */
export const cvdDelta = (a, b) => Math.min(deltaE(a, b, 'protan'), deltaE(a, b, 'deutan'));
/** Unsimulated OKLab Delta E ×100: are two colors near-identical to everyone? */
export const normalDelta = (a, b) => deltaE(a, b);
// The dataviz validator's colorblind thresholds: 8 is the target, 6 to 8 is legal
// only with a second cue (we have the "!" and the words), under 6 fails. Two
// status colors under 8 normal-vision Delta E are near-identical to everyone.
// (The validator's 15 is for telling chart series apart; status has words too.)
export const CVD_TARGET = 8;
export const CVD_FLOOR = 6;
export const NEAR_IDENTICAL = 8;
