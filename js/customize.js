// Customize (classic board only): status colors, where the off-goal color
// shows, the header color, which columns show, and text size. Settings live on
// this device (localStorage) and apply live behind the sheet.
//
// How it reaches the page: one <style id="cz-vars"> that sets --cz-* custom
// properties on :root[data-view="dor"] (tokens.css falls back to the defaults
// when they're unset), and a few data-cz-* attributes on <html> that board.css
// rules read. The home dashboard never matches, so it keeps its look. Detail
// and Meeting opened from the classic board inherit the status colors.

import {
  readableShade, contrast, mix, cvdDelta, normalDelta, CVD_TARGET, CVD_FLOOR, NEAR_IDENTICAL, isHex, luminance,
} from './color.js?v=20261012-235706';
import { esc } from './ui.js?v=20261012-235706';
import { toast } from './toast.js?v=20261012-235706';

const KEY = 'dor.customize.v2';
// v1 settings carry over, except strength: v2's default is the client's solid blocks.
const OLD_KEY = 'dor.customize.v1';

// Board grounds (tokens.css): the page, the quiet surface, and the light chart
// tooltip in Meeting. Dark grounds: Meeting's page and raised surface.
const LIGHT_GROUNDS = ['#fbfcfd', '#f3f6f9', '#e8eef4'];
const DARK_GROUNDS = ['#011425', '#0a2238'];
const PAGE = '#fbfcfd';

// Magenta was dropped: on a strong tint it read as the red.
export const OFF_COLORS = [
  { id: 'red', name: 'Red', hex: '#b3202e', dark: '#ff6159' },
  { id: 'orange', name: 'Orange', hex: '#c2410c' },
  { id: 'purple', name: 'Purple', hex: '#7e22ce' },
];
export const ON_COLORS = [
  { id: 'green', name: 'Green', hex: '#17705a', dark: '#79cdb5' },
  { id: 'teal', name: 'Teal', hex: '#0f766e' },
  { id: 'blue', name: 'Blue', hex: '#1d5baa' },
];
export const HEADER_COLORS = [
  { id: 'navy', name: 'LinkedXL navy', hex: '#02274c' },
  { id: 'black', name: 'Black', hex: '#121417' },
  { id: 'steel', name: 'Steel blue', hex: '#3b5a7e' },
];
const WASH = { soft: 0.075, strong: 0.17, solid: 0.17 }; // share of the off-goal color in the tint

// Custom colors start unset, so a Custom tile never looks like a preset.
export const DEFAULTS = Object.freeze({
  off: 'red', offCustom: null,
  on: 'green', onCustom: null,
  place: 'cell', strength: 'solid',
  header: 'navy', headerCustom: null,
  trend: true, notes: true, question: true,
  size: 'standard',
});

/* ---------- Settings (this device) ---------- */

let settings = load();

function load() {
  try {
    let raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!raw) {
      raw = JSON.parse(localStorage.getItem(OLD_KEY) ?? 'null');
      if (raw && typeof raw === 'object') delete raw.strength;
    }
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
    const s = { ...DEFAULTS, ...raw };
    // Anything malformed falls back to its default, field by field.
    for (const k of ['offCustom', 'onCustom', 'headerCustom']) if (!isHex(s[k])) s[k] = null;
    if (!OFF_COLORS.some((c) => c.id === s.off) && !(s.off === 'custom' && s.offCustom)) s.off = DEFAULTS.off;
    if (!ON_COLORS.some((c) => c.id === s.on) && !(s.on === 'custom' && s.onCustom)) s.on = DEFAULTS.on;
    if (!HEADER_COLORS.some((c) => c.id === s.header) && !(s.header === 'custom' && s.headerCustom)) s.header = DEFAULTS.header;
    if (!['cell', 'row', 'words'].includes(s.place)) s.place = DEFAULTS.place;
    if (!['solid', 'soft', 'strong'].includes(s.strength)) s.strength = DEFAULTS.strength;
    if (!['standard', 'large'].includes(s.size)) s.size = DEFAULTS.size;
    for (const k of ['trend', 'notes', 'question']) s[k] = s[k] !== false;
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private window: still applies for this visit */ }
}

export const getSettings = () => ({ ...settings });

/* ---------- Derived colors ---------- */

function pick(list, id, custom) {
  if (id === 'custom' && custom) return { id: 'custom', name: 'Custom', hex: custom };
  return list.find((c) => c.id === id) ?? list[0];
}

/** Everything the CSS needs, worked out from the settings. Readable by construction. */
export function derive(s = settings) {
  const off = pick(OFF_COLORS, s.off, s.offCustom);
  const on = pick(ON_COLORS, s.on, s.onCustom);
  const head = pick(HEADER_COLORS, s.header, s.headerCustom);
  const wash = mix(off.hex, PAGE, WASH[s.strength]);
  // Off-goal words sit on the wash, so they must clear it too; on-track words
  // can sit inside an off-goal row when the whole row is tinted.
  const offText = readableShade(off.hex, [...LIGHT_GROUNDS, wash]);
  const onText = readableShade(on.hex, s.place === 'row' ? [...LIGHT_GROUNDS, wash] : LIGHT_GROUNDS);
  const offDark = off.dark ? { hex: off.dark } : readableShade(off.hex, DARK_GROUNDS, { dir: 'lighter' });
  const onDark = on.dark ? { hex: on.dark } : readableShade(on.hex, DARK_GROUNDS, { dir: 'lighter' });

  // Header: white text if it reads, else dark text; lines and focus follow.
  const darkHeader = contrast('#fbfcfd', head.hex) >= 4.5 || contrast('#fbfcfd', head.hex) >= contrast('#0b1b2b', head.hex);
  const bar = darkHeader
    ? {
      ink: '#fbfcfd',
      ink2: readableShade('#b9cadb', [head.hex], { dir: 'lighter' }).hex,
      line: readableShade('#6f8fb0', [head.hex], { min: 3, dir: 'lighter' }).hex,
      focus: readableShade('#79cdb5', [head.hex], { min: 3, dir: 'lighter' }).hex,
      logo: ['#fbfcfd', '#fbfcfd', '#79cdb5'],
    }
    : {
      ink: '#0b1b2b',
      ink2: readableShade('#33475e', [head.hex]).hex,
      line: readableShade('#5b6f86', [head.hex], { min: 3 }).hex,
      focus: readableShade('#02274c', [head.hex], { min: 3 }).hex,
      logo: ['#011425', '#003366', '#17705a'],
    };
  return {
    off, on, head, wash,
    offText: offText.hex, offAdjusted: offText.adjusted,
    onText: onText.hex, onAdjusted: onText.adjusted,
    offDark: offDark.hex, onDark: onDark.hex,
    bar, headerFlipped: !darkHeader, headerLight: luminance(head.hex) > 0.6,
  };
}

/**
 * Can the two status colors be told apart, on the board and on the TV?
 * Uses the dataviz validator's thresholds on both pairs (light and Meeting's dark):
 * blocked under the colorblind floor or when near-identical to everyone;
 * a warning between the floor and the target (the "!" carries the difference).
 */
export function pairCheck(s = settings) {
  const d = derive(s);
  const cvd = Math.min(cvdDelta(d.offText, d.onText), cvdDelta(d.offDark, d.onDark));
  const normal = Math.min(normalDelta(d.offText, d.onText), normalDelta(d.offDark, d.onDark));
  return { cvd, normal, blocked: cvd < CVD_FLOOR || normal < NEAR_IDENTICAL, warn: cvd < CVD_TARGET };
}

/* ---------- Apply to the page ---------- */

/** Write the --cz-* properties (classic view only) and the data-cz-* switches. */
export function applyCustomize() {
  const d = derive();
  const s = settings;
  const vars = [];
  if (s.off !== DEFAULTS.off || s.strength !== DEFAULTS.strength) {
    vars.push(`--cz-off: ${d.offText}`, `--cz-off-light: ${d.offDark}`, `--cz-off-wash: ${d.wash}`);
  }
  if (s.on !== DEFAULTS.on || s.place === 'row') vars.push(`--cz-on: ${d.onText}`, `--cz-on-light: ${d.onDark}`);
  if (s.header !== DEFAULTS.header) {
    vars.push(
      `--cz-bar-bg: ${d.head.hex}`, `--cz-bar-ink: ${d.bar.ink}`, `--cz-bar-ink-2: ${d.bar.ink2}`,
      `--cz-bar-line: ${d.bar.line}`, `--cz-bar-focus: ${d.bar.focus}`,
      `--cz-logo-ink: ${d.bar.logo[0]}`, `--cz-logo-navy: ${d.bar.logo[1]}`, `--cz-logo-mint: ${d.bar.logo[2]}`,
    );
  }
  let style = document.getElementById('cz-vars');
  if (!style) {
    style = document.createElement('style');
    style.id = 'cz-vars';
    document.head.append(style);
  }
  style.textContent = vars.length ? `:root[data-view="dor"] {\n  ${vars.join(';\n  ')};\n}` : '';
  const attrs = {
    czPlace: s.place,
    czStrength: s.strength,
    czSize: s.size,
    czTrend: s.trend ? 'on' : 'off',
    czNotes: s.notes ? 'on' : 'off',
    czQuestion: s.question ? 'on' : 'off',
    czHeader: d.headerFlipped ? 'light' : 'dark',
    czHeaderRule: d.headerLight ? 'on' : 'off',
  };
  Object.assign(document.documentElement.dataset, attrs);
  // A small cache the page's first script reads, so the saved look paints before the app loads.
  try { localStorage.setItem('dor.customize.paint.v1', JSON.stringify({ attrs, css: style.textContent })); } catch { /* blocked: defaults on first paint */ }
}

/* ---------- The sheet ---------- */

let dialog;
let handlers = {};
let opener = null;
const blockedNote = { off: '', on: '' };

const CHECK = '<svg class="cz-check" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M6 10.3l2.6 2.6L14 7.4" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const dot = (id) => `<svg class="cz-dot" aria-hidden="true" focusable="false"><use href="#${id}"></use></svg>`;
const DEFAULT_MARK = ' <span class="cz-default">(default)</span>';

function colorOption(group, c, word, glyph) {
  const isDefault = (group === 'off' && c.id === 'red') || (group === 'on' && c.id === 'green');
  return `<label class="cz-opt" data-opt="${group}-${c.id}">
      <input type="radio" name="cz-${group}" value="${c.id}">
      <span class="cz-sample" data-sample="${group}-${c.id}">${dot(glyph)}<span>${word}</span></span>
      <span class="cz-name">${esc(c.name)}${isDefault ? DEFAULT_MARK : ''}</span>
      <span class="cz-blocked" data-blocked="${group}-${c.id}"></span>${CHECK}
    </label>`;
}

/** The Custom tile holds its own color picker, so the two never come apart. */
function customOption(group, word, glyph) {
  const label = { off: 'Custom off-goal color', on: 'Custom on-track color', header: 'Custom header color' }[group];
  const sample = group === 'header'
    ? `<span class="cz-bar" data-sample="header-custom"><span>Aa</span></span>`
    : `<span class="cz-sample" data-sample="${group}-custom">${dot(glyph)}<span>${word}</span></span>`;
  return `<div class="cz-opt cz-opt--custom" data-opt="${group}-custom">
      <label class="cz-custom-label">
        <input type="radio" name="cz-${group}" value="custom">
        ${sample}
        <span class="cz-pick-empty" data-empty="${group}">Pick a color</span>
        <span class="cz-name">Custom</span>
        <span class="cz-blocked" data-blocked="${group}-custom"></span>
        ${CHECK}
      </label>
      <input class="cz-color" type="color" data-custom="${group}" aria-label="${label}">
    </div>`;
}

function headerOption(c) {
  return `<label class="cz-opt" data-opt="header-${c.id}">
      <input type="radio" name="cz-header" value="${c.id}">
      <span class="cz-bar" data-sample="header-${c.id}"><span>Aa</span></span>
      <span class="cz-name">${esc(c.name)}${c.id === 'navy' ? DEFAULT_MARK : ''}</span>${CHECK}
    </label>`;
}

function placeOption(id, name, hint) {
  return `<label class="cz-opt cz-opt--place" data-opt="place-${id}">
      <input type="radio" name="cz-place" value="${id}">
      <span class="cz-place-art cz-place-art--${id}" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="cz-place-text"><span class="cz-name">${name}</span><span class="cz-hint">${hint}</span></span>${CHECK}
    </label>`;
}

function sheetMarkup() {
  return `
    <div class="cz-panel">
      <header class="cz-head">
        <h2 class="cz-title" id="cz-title" tabindex="-1">Customize this board</h2>
        <button class="icon-btn" type="button" data-cz-close aria-label="Close Customize">
          <svg class="icon" aria-hidden="true" focusable="false"><use href="#g-close"></use></svg>
        </button>
      </header>
      <p class="cz-lead">Colors and what the board shows. Changes show right away and stay on this device.</p>
      <p class="cz-setup">To change the plant name, functions, owners or KPIs, use <button class="btn--text cz-setup-link" type="button" data-open-setup>Board setup</button>.</p>
      <div class="cz-preview" role="img" data-cz-preview>
        <p class="cz-preview-label" aria-hidden="true">Preview</p>
        <div class="cz-mini-row" aria-hidden="true">
          <span class="cz-mini-fn">People</span>
          <span class="cz-mini-cell cz-mini-cell--off">${dot('g-off')}<span>Below goal</span></span>
          <span class="cz-mini-cell cz-mini-cell--on">${dot('g-on')}<span>On track</span></span>
        </div>
      </div>
      <form class="cz-body" novalidate>
        <fieldset class="cz-group">
          <legend class="cz-legend">Off-goal color</legend>
          <div class="cz-options">
            ${OFF_COLORS.map((c) => colorOption('off', c, 'Below goal', 'g-off')).join('')}
            ${customOption('off', 'Below goal', 'g-off')}
          </div>
          <p class="cz-note" data-cz-note="off" aria-live="polite"></p>
        </fieldset>

        <fieldset class="cz-group">
          <legend class="cz-legend" data-cz-place-legend>Where the red shows</legend>
          <div class="cz-options cz-options--stack">
            ${placeOption('cell', 'The cell', 'Only the day or month box that missed. (default)')}
            ${placeOption('row', 'The whole row', "The KPI's whole row when its day is off goal.")}
            ${placeOption('words', 'Just the words', 'No tint. Only the word and its dot take the color.')}
          </div>
          <fieldset class="cz-sub" data-cz-strength-set>
            <legend class="cz-sublegend">Strength</legend>
            <div class="segmented">
              <label><input type="radio" name="cz-strength" value="solid"><span>Solid</span></label>
              <label><input type="radio" name="cz-strength" value="soft"><span>Soft</span></label>
              <label><input type="radio" name="cz-strength" value="strong"><span>Strong</span></label>
            </div>
          </fieldset>
        </fieldset>

        <fieldset class="cz-group">
          <legend class="cz-legend">On-track color</legend>
          <div class="cz-options">
            ${ON_COLORS.map((c) => colorOption('on', c, 'On track', 'g-on')).join('')}
            ${customOption('on', 'On track', 'g-on')}
          </div>
          <p class="cz-note" data-cz-note="on" aria-live="polite"></p>
          <p class="cz-warn" data-cz-cvd aria-live="polite" hidden>These two colors can look alike to some people. The ! on off-goal dots still tells them apart.</p>
        </fieldset>

        <fieldset class="cz-group">
          <legend class="cz-legend">Text size</legend>
          <div class="segmented">
            <label><input type="radio" name="cz-size" value="standard"><span>Standard</span></label>
            <label><input type="radio" name="cz-size" value="large"><span>Large</span></label>
          </div>
          <p class="cz-hint">Bigger type for reading the TV across the room.</p>
        </fieldset>

        <fieldset class="cz-group">
          <legend class="cz-legend">Header color</legend>
          <div class="cz-options">
            ${HEADER_COLORS.map(headerOption).join('')}
            ${customOption('header')}
          </div>
          <p class="cz-note" data-cz-note="header" aria-live="polite"></p>
        </fieldset>

        <fieldset class="cz-group">
          <legend class="cz-legend">Show</legend>
          <label class="cz-toggle"><input type="checkbox" name="cz-trend"><span>Daily trend and year to date</span></label>
          <label class="cz-toggle"><input type="checkbox" name="cz-notes"><span>Issue and action</span></label>
          <label class="cz-toggle"><input type="checkbox" name="cz-question"><span>The daily question under each function</span></label>
        </fieldset>
      </form>
      <footer class="cz-foot">
        <button class="btn btn--quiet" type="button" data-cz-reset>Reset to default</button>
        <button class="btn btn--primary" type="button" data-cz-done>Done</button>
      </footer>
    </div>`;
}

/** The shade note: a swatch of the real word color, said plainly. */
const shadeNote = (hex) => `<span class="cz-shade" style="--sample:${hex}" aria-hidden="true"></span>Words will show in this darker shade so they stay readable.`;

/** Put the settings into the controls, paint the samples, and say what was adjusted. */
function syncSheet({ keepPicker = null } = {}) {
  if (!dialog?.open) return;
  const s = settings;
  const d = derive();
  const set = (name, value) => dialog.querySelectorAll(`[name="${name}"]`).forEach((r) => { r.checked = r.value === value; });
  set('cz-off', s.off); set('cz-on', s.on); set('cz-place', s.place); set('cz-strength', s.strength);
  set('cz-header', s.header); set('cz-size', s.size);
  dialog.querySelector('[name="cz-trend"]').checked = s.trend;
  dialog.querySelector('[name="cz-notes"]').checked = s.notes;
  dialog.querySelector('[name="cz-question"]').checked = s.question;

  // Custom tiles: their own color when one is set, else a plain "Pick a color".
  for (const g of ['off', 'on', 'header']) {
    const hex = s[`${g}Custom`];
    const tile = dialog.querySelector(`[data-opt="${g}-custom"]`);
    tile.classList.toggle('is-empty', !hex);
    const input = tile.querySelector('.cz-color');
    // A picker that's mid-pick keeps what the person is pointing at.
    if (g !== keepPicker) input.value = hex ?? (g === 'header' ? '#5b6f86' : '#808080');
  }

  // Each sample wears the shade the board would really use.
  for (const c of [...OFF_COLORS, { id: 'custom' }]) {
    if (c.id === 'custom' && !s.offCustom) continue;
    dialog.querySelector(`[data-sample="off-${c.id}"]`).style.setProperty('--sample', derive({ ...s, off: c.id }).offText);
  }
  for (const c of [...ON_COLORS, { id: 'custom' }]) {
    if (c.id === 'custom' && !s.onCustom) continue;
    dialog.querySelector(`[data-sample="on-${c.id}"]`).style.setProperty('--sample', derive({ ...s, on: c.id }).onText);
  }
  for (const c of [...HEADER_COLORS, { id: 'custom' }]) {
    if (c.id === 'custom' && !s.headerCustom) continue;
    const h = derive({ ...s, header: c.id });
    const el = dialog.querySelector(`[data-sample="header-${c.id}"]`);
    el.style.setProperty('--sample', h.head.hex);
    el.style.setProperty('--sample-ink', h.bar.ink);
  }

  // A pair that can't be told apart can't be picked: the tile says why.
  const block = (group, id, other) => {
    const radio = dialog.querySelector(`[name="cz-${group}"][value="${id}"]`);
    const msg = dialog.querySelector(`[data-blocked="${group}-${id}"]`);
    const unset = id === 'custom' && !s[`${group}Custom`];
    const isBlocked = !unset && s[group] !== id && pairCheck({ ...s, [group]: id }).blocked;
    radio.disabled = isBlocked;
    radio.closest('.cz-opt').classList.toggle('is-blocked', isBlocked);
    msg.textContent = isBlocked ? `Too close to ${other}` : '';
  };
  const offName = s.off === 'custom' ? 'your off-goal color' : d.off.name;
  const onName = s.on === 'custom' ? 'your on-track color' : d.on.name;
  for (const c of [...OFF_COLORS, { id: 'custom' }]) block('off', c.id, onName);
  for (const c of [...ON_COLORS, { id: 'custom' }]) block('on', c.id, offName);

  dialog.querySelector('[data-cz-strength-set]').disabled = s.place === 'words';
  dialog.querySelector('[data-cz-place-legend]').textContent = `Where the ${s.off === 'custom' ? 'off-goal color' : d.off.name.toLowerCase()} shows`;

  const note = (k, html) => { dialog.querySelector(`[data-cz-note="${k}"]`).innerHTML = html; };
  note('off', blockedNote.off ? esc(blockedNote.off) : s.off === 'custom' && d.offAdjusted ? shadeNote(d.offText) : '');
  note('on', blockedNote.on ? esc(blockedNote.on) : s.on === 'custom' && d.onAdjusted ? shadeNote(d.onText) : '');
  note('header', s.header === 'custom' && d.headerFlipped ? 'Text switched to dark so it stays readable on this color.' : '');
  dialog.querySelector('[data-cz-cvd]').hidden = !pairCheck().warn;

  const where = { cell: 'only the day cell is tinted', row: 'the whole row is tinted', words: 'no tint, colored words only' }[s.place];
  dialog.querySelector('[data-cz-preview]').setAttribute('aria-label',
    `Preview: Below goal in ${s.off === 'custom' ? 'your custom color' : d.off.name.toLowerCase()}, ${where}${s.place === 'words' ? '' : `, ${s.strength}`}. On track in ${s.on === 'custom' ? 'your custom color' : d.on.name.toLowerCase()}.`);
}

function update(patch) {
  settings = { ...settings, ...patch };
  save();
  applyCustomize();
  syncSheet();
}

/** A custom color: kept only if it can still be told apart from the other status color. */
function tryCustom(group, hex, { final }) {
  if (!isHex(hex)) return;
  if (group === 'header') { update({ headerCustom: hex, header: 'custom' }); return; }
  const next = { ...settings, [`${group}Custom`]: hex, [group]: 'custom' };
  if (pairCheck(next).blocked) {
    blockedNote[group] = group === 'off'
      ? 'Too close to your on-track color. Pick something further apart.'
      : 'Too close to your off-goal color. Pick something further apart.';
    // Keep the previous choice; once the pick is final the picker goes back to it too.
    syncSheet({ keepPicker: final ? null : group });
    return;
  }
  blockedNote[group] = '';
  update({ [`${group}Custom`]: hex, [group]: 'custom' });
}

export function initCustomize(h = {}) {
  handlers = h;
  dialog = document.getElementById('customize');
  applyCustomize();
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); handlers.onClose?.(); });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) { handlers.onClose?.(); return; } // the clear area beside the sheet
    if (e.target.closest('[data-cz-close], [data-cz-done]')) { handlers.onClose?.(); return; }
    if (e.target.closest('[data-cz-reset]')) {
      const before = { ...settings };
      settings = { ...DEFAULTS };
      blockedNote.off = '';
      blockedNote.on = '';
      save();
      applyCustomize();
      syncSheet();
      dialog.querySelector('#cz-title').focus();
      toast('The board is back to its default look.', {
        actionLabel: 'Undo',
        onAction: () => { settings = before; save(); applyCustomize(); syncSheet(); },
      });
    }
  });
  // input = live while dragging a color picker; change = radios, checkboxes, the picker's final pick.
  const onEdit = (e) => {
    const el = e.target;
    if (el.dataset.custom) { tryCustom(el.dataset.custom, el.value, { final: e.type === 'change' }); return; }
    const name = el.name?.replace(/^cz-/, '');
    if (!name) return;
    if (el.type === 'checkbox') { update({ [name]: el.checked }); return; }
    if (!el.checked) return;
    // Custom with no color yet: open the picker instead and keep the current choice.
    if (el.value === 'custom' && !settings[`${name}Custom`]) {
      syncSheet();
      const input = dialog.querySelector(`[data-custom="${name}"]`);
      try { input.showPicker(); } catch { input.click(); }
      return;
    }
    if (name === 'off' || name === 'on') blockedNote[name] = '';
    update({ [name]: el.value });
  };
  dialog.addEventListener('input', onEdit);
  dialog.addEventListener('change', onEdit);
}

export const isCustomizeOpen = () => Boolean(dialog?.open);

export function openCustomize() {
  if (dialog.open) return;
  opener = document.activeElement;
  blockedNote.off = '';
  blockedNote.on = '';
  dialog.innerHTML = sheetMarkup();
  dialog.showModal();
  syncSheet();
  // On a phone the sheet covers the lower half: bring an off-goal row into view above it.
  if (matchMedia('(max-width: 599px)').matches) {
    const row = document.querySelector('.app .row:has(.cell--day[data-status="off"])') ?? document.querySelector('.app .row');
    if (row) window.scrollTo({ top: Math.max(0, window.scrollY + row.getBoundingClientRect().top - 8), behavior: 'instant' });
  }
  requestAnimationFrame(() => dialog.querySelector('#cz-title')?.focus({ preventScroll: true }));
}

export function closeCustomize() {
  if (!dialog?.open) return;
  dialog.close();
  const back = opener && opener.isConnected ? opener : document.querySelector('.app [data-customize]');
  back?.focus({ preventScroll: true });
  opener = null;
}
