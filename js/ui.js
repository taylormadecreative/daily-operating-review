// Shared markup helpers. One place for escaping, status glyphs and the
// word + glyph status pattern, so every screen draws status the same way.

import { statusWord, ON, OFF, NOT_ENTERED, NO_GOAL, NO_PRODUCTION } from './status.js';

/** Escape text for HTML (data such as names and problem text is untrusted). */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Sprite symbol for each status. Every status has its own silhouette. */
export const GLYPH = {
  [ON]: 'g-on',
  [OFF]: 'g-off',
  [NOT_ENTERED]: 'g-missing',
  [NO_GOAL]: 'g-nogoal',
  [NO_PRODUCTION]: 'g-idle',
};

export function glyphMarkup(status, cls = 'glyph') {
  return `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#${GLYPH[status]}"></use></svg>`;
}

/**
 * Status as word + glyph + color.
 * opts: { tag = 'p', extra = '', kpi, word } — pass the measure's kpi so a miss
 * says which way it missed ("Below goal" / "Above goal"); word overrides.
 */
export function statusMarkup(status, { tag = 'p', extra = '', kpi = null, word } = {}) {
  return `<${tag} class="status status--${status}${extra ? ` ${extra}` : ''}">${glyphMarkup(status)}`
    + `<span class="status-word">${esc(word ?? statusWord(status, kpi))}</span></${tag}>`;
}

/** Problem status (Open, In progress, Closed) as a quiet word with its own mark. */
export const ISSUE_WORD = { open: 'Open', 'in-progress': 'In progress', closed: 'Closed' };
export function issueStatusMarkup(status, tag = 'span') {
  if (!ISSUE_WORD[status]) return '';
  return `<${tag} class="ist ist--${status}"><span class="ist-dot" aria-hidden="true"></span>${ISSUE_WORD[status]}</${tag}>`;
}

/** Small "what does this mean?" button for a glossary term. */
export function termButton(term, definition) {
  return `<button class="term-btn" type="button" data-term="${esc(term)}" data-definition="${esc(definition)}"`
    + ` aria-label="What does ${esc(term)} mean?" aria-haspopup="dialog" aria-expanded="false">`
    + `<svg class="icon" aria-hidden="true" focusable="false"><use href="#g-info"></use></svg></button>`;
}
