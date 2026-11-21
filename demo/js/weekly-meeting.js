// Weekly meeting (WOR-ORG-PLAN Part 4; the client team's spec §7): the weekly review's agenda in Meeting
// mode's Control Room look. js/meeting.js runs it (keys, place, timer, Record, full screen); this module
// builds the agenda from the Weekly review's model (js/wor.js) and draws each slide:
//   1  Safety & readiness       Safety's week and the review's readiness, kept apart
//   2  Performance              one slide per function: the week's result, days on goal, last 4 weeks,
//                               repeat gap, commentary, its actions (Assign action, Escalate)
//   3  Top gaps & cause evidence  off goal for the week, or a repeat gap, with the cause evidence written
//   4  Actions                  the previous review's commitments and actions carried in, then new ones
//   5  Escalations              escalated actions and gaps; Escalate from any gap
//   6  Forward look             decisions and next-week priorities (saved to the draft record as typed)
// Decisions and escalations save to the week's draft record at once; nothing waits for the timer.

import {
  weekModel, actionSets, previousRecord, latestDraft, COMMENT_FIELDS, hasCommentary, resultWord, goalChangedWords,
  addDecision, addEscalation, readDecisionDraft, writeDecisionDraft, weekLabel,
} from './wor.js?v=20261120-181051';
import { isoForDay } from './store.js?v=20261120-181051';
import { weeklyPair, RULES, addDays } from './weekly.js?v=20261120-181051';
import { listActions } from './actions.js?v=20261120-181051';
import {
  isOpenAction, isOverdueAction, isEscalatedAction, isVerifiedAction, agingWords, actionStateMarkup,
} from './action-state.js?v=20261120-181051';
import { ON, OFF, NO_GOAL, statusWord } from './status.js?v=20261120-181051';
import { plainLabel } from './format.js?v=20261120-181051';
import { esc, statusMarkup, glyphMarkup, GLYPH } from './ui.js?v=20261120-181051';
import { recorderReady, addActionIcon } from './recorder.js?v=20261120-181051';
import { lapsedWords, fitClampedText } from './board.js?v=20261120-181051';
import { toast } from './toast.js?v=20261120-181051';

const AGENDA = ['Safety & readiness', 'Performance', 'Top gaps', 'Actions', 'Escalations', 'Forward look'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const utc = (iso) => new Date(`${iso}T00:00:00Z`);
const F_MED = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const F_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dayMed = (iso) => F_MED.format(utc(iso)).replace(/ /g, ' ');
const dayShort = (iso) => F_SHORT.format(utc(iso)).replace(/ /g, ' ');

/* ---------- The agenda ---------- */

/**
 * The week's agenda: 1 + one slide per function + 4 (13 with eight functions). -> { m, slides } or null.
 * Each slide: { kind, title, step (1-6), fnId? }.
 */
export function buildWeeklyAgenda(month, day) {
  const m = weekModel(month, day);
  if (!m) return null;
  const slides = [{ kind: 'ready', title: 'Safety & readiness', step: 1 }];
  m.fns.forEach((f) => slides.push({ kind: 'fn', title: f.fn.name, step: 2, fnId: f.fn.id }));
  slides.push({ kind: 'gaps', title: 'Top gaps & cause evidence', step: 3 });
  slides.push({ kind: 'actions', title: 'Actions', step: 4 });
  slides.push({ kind: 'escalations', title: 'Escalations', step: 5 });
  slides.push({ kind: 'forward', title: 'Forward look', step: 6 });
  return { m, slides };
}

/** The place line's words for a slide: "Performance · People", "Top gaps & cause evidence". */
export const slidePlace = (s) => (s.kind === 'fn' ? `Performance · ${s.title}` : s.title);

/* ---------- Shared pieces ---------- */

function agendaMarkup(step) {
  return `<ol class="wm-agenda" aria-label="Agenda">${AGENDA.map((name, i) => `<li${i + 1 === step ? ' class="is-now" aria-current="step"' : i + 1 < step ? ' class="is-done"' : ''}><span class="wm-agenda-n">${i + 1}</span>${esc(name)}</li>`).join('')}</ol>`;
}

function headMarkup(agenda, s, titleHtml, sub = '') {
  const w = agenda.m.week;
  return `<header class="wm-head">
      <div class="wm-head-top"><p class="wm-week">${esc(weekLabel(w))} · Plant total</p>${agendaMarkup(s.step)}</div>
      <div class="wm-head-title"><h2 class="wm-title" id="wm-title">${titleHtml}</h2>${sub ? `<p class="wm-sub">${sub}</p>` : ''}</div>
    </header>`;
}

/** The week's result as a solid block (word + glyph + color), the meeting's own size. */
function weekBlock(entry, { label = '' } = {}) {
  const r = entry.result;
  const kpi = entry.row.kpiDaily;
  const pair = weeklyPair(r.effective, r.goalVaries ? null : r.goal, kpi, r.rule, { entered: r.mode !== 'AUTO' });
  const st = r.goalVaries ? NO_GOAL : r.status;
  const tags = [];
  if (r.provisional) tags.push(`Provisional · ${r.received} of ${r.expected} days`);
  if (r.overridden) tags.push(`Overridden · calculated ${weeklyPair(r.raw, null, kpi, r.rule).actual ?? 'not entered'}`);
  const rest = r.goalVaries ? goalChangedWords(r, kpi) : pair.rest;
  return `<section class="m-kpi wm-block" data-status="${st}">
      <h3 class="m-kpi-label">${esc(label || plainLabel(kpi))}</h3>
      ${statusMarkup(st, { extra: 'm-status', kpi, word: resultWord(r, kpi) })}
      ${pair.actual === null ? `<p class="m-num m-num--empty">${esc(r.rule === 'weekly-only' ? 'Entered once a week' : rest)}</p>` : `<p class="m-num">${esc(pair.actual)}</p>${rest ? `<p class="m-rest">${esc(rest)}</p>` : ''}`}
      <p class="m-measure">${esc(RULES[r.rule]?.name ?? '')}</p>
      ${tags.map((t) => `<p class="wm-tag">${esc(t)}</p>`).join('')}
    </section>`;
}

/** Monday to Friday, one big mark each with its letter, and "On track 2 of 5 days · missed 3". */
function daysMarkup(entry) {
  const r = entry.result;
  const kpi = entry.row.kpiDaily;
  if (!r.marks.length) return '<p class="wm-quiet">No production days</p>';
  const marks = r.marks.map((x) => {
    const glyph = x.status === 'not-reached' ? 'g-untracked' : GLYPH[x.status];
    const word = x.status === 'not-reached' ? 'not reached yet' : statusWord(x.status, kpi).toLowerCase();
    return `<li class="wm-day wm-day--${x.status}"><svg class="glyph" aria-hidden="true" focusable="false"><use href="#${glyph}"></use></svg><span aria-hidden="true">${DOW[x.dow]}</span><span class="sr-only">${esc(dayMed(x.iso))}: ${esc(word)}</span></li>`;
  }).join('');
  return `<ol class="wm-days" aria-label="Days on track">${marks}</ol>
    <p class="wm-cap">On track ${r.met} of ${r.marks.length} days${r.missed ? `&nbsp;· <strong>missed ${r.missed}</strong>` : ''}</p>`;
}

/** The last 4 weeks as four cells (week, glyph and word, figure): readable from across the room. */
function fourWeeksMarkup(agenda, entry) {
  const m = agenda.m;
  const kpi = entry.row.kpiDaily;
  const cells = [];
  for (let i = m.idx - 3; i <= m.idx; i += 1) {
    if (i < 0) { cells.push('<li class="wm-wk is-none"><span class="wm-wk-d">No data</span></li>'); continue; }
    const r = entry.history[i];
    const st = r.goalVaries ? NO_GOAL : r.status;
    const pair = weeklyPair(r.effective, r.goalVaries ? null : r.goal, kpi, r.rule, { entered: r.mode !== 'AUTO' });
    const word = st === ON ? 'On track' : st === OFF ? 'Off goal' : r.goalVaries ? 'Goal varies' : st === NO_GOAL ? 'No goal' : 'Not entered';
    cells.push(`<li class="wm-wk${i === m.idx ? ' is-this' : ''}" data-status="${st}"><span class="wm-wk-d">${esc(dayShort(m.weeks[i].start))}</span><span class="wm-wk-st">${glyphMarkup(st)}${esc(word)}</span><span class="wm-wk-v">${esc(pair.actual ?? 'Not entered')}</span></li>`);
  }
  return `<ol class="wm-weeks" aria-label="Last 4 weeks">${cells.join('')}</ol>`;
}

function gapMarkup(entry) {
  const g = entry.gap;
  if (g.level === 'none') return '<p class="wm-quiet">No repeat gap</p>';
  return statusMarkup(OFF, { tag: 'p', word: g.long ?? g.word, extra: 'wm-gap-word' });
}

/** One register action in the meeting's words: its state mark, the words, owner, due or overdue, aging, escalation. */
function actionLine(m, a, fnName = '') {
  const over = isOverdueAction(a, m.asOfIso);
  const when = isVerifiedAction(a) ? (a.closedDayIso ? `Verified ${dayMed(a.closedDayIso)}` : 'Verified')
    : a.status === 'cancelled' ? 'Cancelled'
      : a.due ? `${over ? '' : 'Due '}${dayMed(a.due)}` : 'No due date';
  const meta = [
    fnName ? esc(fnName) : '',
    esc(a.owner || 'No owner named'),
    over ? `<span class="m-over">${glyphMarkup(OFF)}Overdue</span> ${esc(when)}` : esc(when),
    isOpenAction(a) ? esc(agingWords(a, m.asOfIso)) : '',
    isEscalatedAction(a) ? `<strong>Escalated to ${esc(a.escalation.to)}</strong>` : '',
  ].filter(Boolean).join('<span class="m-dot"> · </span>');
  return `<li class="wm-act" data-action="${esc(a.id)}">
      <p class="wm-act-text">${actionStateMarkup(a.status)} <span>${esc(a.text)}</span></p>
      <p class="wm-act-meta">${meta}</p>
    </li>`;
}

/** A fix verified this week that didn't hold (board.js responseFor): why the room needs a new action. */
const lapsedLines = (rows) => rows.flatMap((e) => (e.response?.lapsed ?? []).slice(0, 1))
  .map((x) => `<p class="wm-text wm-lapsed"><span class="wm-from">${esc(lapsedWords(x))}:</span> ${esc(x.a.text)}</p>`).join('');

const assignButton = (fnId, kpiKey = null, label = '') => (recorderReady()
  ? `<button class="btn btn--secondary m-add wm-assign" type="button" data-meeting-add="${esc(fnId)}"${kpiKey !== null ? ` data-meeting-add-kpi="${esc(kpiKey)}"` : ''}>${addActionIcon}Assign action${label ? `<span class="sr-only"> for ${esc(label)}</span>` : ''}</button>`
  : '');
const escalateButton = (fnId, kpiKey, label) => `<button class="btn btn--secondary wm-escalate" type="button" data-wm-escalate="${esc(fnId)}" data-wm-kpi="${esc(kpiKey)}" data-wm-label="${esc(label)}">Escalate<span class="sr-only"> ${esc(label)}</span></button>`;

const kpiKeyOf = (row) => (row.primary ? '' : String(row.kpiId ?? ''));
const accountable = (m, fnId) => {
  const pid = m.org.functions?.[fnId]?.accountable;
  return m.org.people.find((p) => p.id === pid)?.name?.trim() ?? '';
};

/** "From the daily board, Fri, Feb 27:" with that day's issue and next-24-hours action (board.js dailyWords). */
function dailyMarkup(m, f) {
  const groups = f.daily ?? [];
  if (!groups.length) return `<p class="wm-quiet">The daily board has no issue or next-24-hours action written this week.</p>`;
  return groups.map((g) => `<div class="wm-note wm-daily">
      <h3 class="m-section-title">From the daily board, ${esc(dayMed(isoForDay(m.month, g.day)))}</h3>
      ${g.issue ? `<p class="wm-text"><span class="wm-from">Issue:</span> ${esc(g.issue)}</p>` : ''}
      ${g.action ? `<p class="wm-text"><span class="wm-from">Next 24 hours:</span> ${esc(g.action)}</p>` : ''}
    </div>`).join('');
}

/* ---------- 1  Safety & readiness ---------- */

const CHECK = '<svg class="wm-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>';

function readySlide(agenda, s) {
  const m = agenda.m;
  const safety = m.fns.find((f) => f.fn.id === 'safety') ?? m.fns[0];
  const done = m.readiness.filter((x) => x.done).length;
  const entry = safety?.rows[0];
  const lines = m.summary.lines.slice(0, 3).map((l) => `<li>${l.kind === OFF ? glyphMarkup(OFF) : l.kind === 'mixed' ? glyphMarkup(ON) : glyphMarkup(l.kind === 'not-entered' ? 'not-entered' : NO_GOAL)}<span>${esc(l.label)}: ${esc(l.fns.map((f) => (l.extra ? `${f.fn.name} (${l.extra(f)})` : f.fn.name)).join(', '))}</span></li>`).join('');
  const c = safety?.commentary;
  return `<article class="wm wm--ready" aria-labelledby="wm-title">
      ${headMarkup(agenda, s, 'Safety &amp; readiness', esc(m.summary.lead))}
      <div class="wm-cols">
        <section class="wm-col" aria-label="Safety this week">
          ${entry ? `<h3 class="wm-fnname">${esc(safety.fn.name)}</h3>
          <div class="wm-pair">${weekBlock(entry, { label: `This week · ${plainLabel(entry.row.kpiDaily)}` })}
            <div class="wm-stack"><h3 class="m-section-title">Days on track</h3>${daysMarkup(entry)}<h3 class="m-section-title">Repeat gap</h3>${gapMarkup(entry)}</div></div>
          ${hasCommentary(c) && c.happened?.trim() ? `<div class="wm-note"><h3 class="m-section-title">What happened and the cause evidence</h3><p class="wm-text">${esc(c.happened.trim())}</p></div>` : dailyMarkup(m, safety)}` : '<p class="wm-quiet">Safety is not on the board.</p>'}
          ${lines ? `<ul class="wm-lines">${lines}</ul>` : ''}
        </section>
        <section class="wm-col wm-ready" aria-labelledby="wm-ready-title">
          <h3 class="wm-ready-title" id="wm-ready-title">Review readiness <span class="wm-ready-n">${done} of ${m.readiness.length} ready</span></h3>
          <p class="wm-quiet">About the meeting, not the plant's results.</p>
          <ul class="wm-ready-list">${m.readiness.map((x) => `<li class="${x.done ? 'is-done' : ''}"><span class="wm-ready-mark">${x.done ? CHECK : '<span class="wm-ring" aria-hidden="true"></span>'}<span class="sr-only">${x.done ? 'Ready: ' : 'Not ready: '}</span></span><span class="wm-ready-text"><span class="wm-ready-name">${esc(x.title)}</span><span class="wm-ready-val">${esc(x.text)}</span></span></li>`).join('')}</ul>
        </section>
      </div>
    </article>`;
}

/* ---------- 2  Performance, one function ---------- */

function fnSlide(agenda, s) {
  const m = agenda.m;
  const f = m.fns.find((x) => x.fn.id === s.fnId);
  if (!f) return '';
  const lead = accountable(m, f.fn.id);
  const sub = `Owner: ${esc(f.fn.owner)}${lead ? ` · Accountable: ${esc(lead)}` : ''}`;
  // One measure (the usual case) gets the whole column: the last 4 weeks run full width under the
  // week's block, with figures sized for the room. Several measures keep each row tight.
  const solo = f.rows.length === 1;
  const rows = f.rows.map((e) => `<div class="wm-kpirow" data-fold-item>
      ${weekBlock(e, { label: `This week · ${plainLabel(e.row.kpiDaily)}` })}
      <div class="wm-stack">
        <h3 class="m-section-title">Days on track</h3>${daysMarkup(e)}
        <h3 class="m-section-title">Repeat gap</h3>${gapMarkup(e)}
      </div>
      <div class="wm-stack wm-weeks-box"><h3 class="m-section-title">Last 4 weeks</h3>${fourWeeksMarkup(agenda, e)}</div>
    </div>`).join('');
  const c = f.commentary ?? {};
  const written = hasCommentary(c);
  // The commentary as written; before anyone writes it, the daily board's own words (read only), never three empty boxes.
  const commentary = written
    ? COMMENT_FIELDS.filter(([k]) => String(c[k] ?? '').trim()).map(([k, label]) => `<div class="wm-note"><h3 class="m-section-title">${esc(label)}</h3><p class="wm-text">${esc(String(c[k]).trim())}</p></div>`).join('')
    : `${dailyMarkup(m, f)}<p class="wm-quiet wm-next">Commentary not written yet: the owner writes it on the Weekly review, Functions tab.</p>`;
  const acts = f.rows.flatMap((e) => e.acts.map((a) => ({ a, e })));
  const needs = f.rows.filter((e) => e.needs);
  // The daily board's next-24-hours words that count as this week's action (board.js responseFor).
  const notes = f.rows.map((e) => e.response?.note).filter(Boolean);
  const label = (e) => (f.rows.length > 1 ? `${f.fn.name}, ${plainLabel(e.row.kpiDaily)}` : f.fn.name);
  const buttons = f.rows.map((e) => `<div class="wm-btns">${assignButton(f.fn.id, kpiKeyOf(e.row), label(e))}${escalateButton(f.fn.id, kpiKeyOf(e.row), `${f.fn.name}, ${plainLabel(e.row.kpiDaily)}`)}</div>`).join('');
  return `<article class="wm wm--fn${solo ? ' wm--solo' : ''}" aria-labelledby="wm-title">
      ${headMarkup(agenda, s, esc(f.fn.name), sub)}
      <div class="wm-cols wm-cols--fn">
        <section class="wm-col" aria-label="This week" data-fold-list>${rows}<p class="wm-more" data-fold-more hidden></p></section>
        <section class="wm-col wm-col--right" aria-label="Commentary and actions">
          ${commentary}
          <div class="wm-note wm-note--acts"><h3 class="m-section-title">Actions</h3>
            ${needs.length ? `<p class="wm-needs">${statusMarkup(OFF, { tag: 'span', word: 'Needs an action', extra: 'm-needs-status' })}</p>` : ''}
            ${lapsedLines(f.rows)}
            ${written && notes.length ? notes.map((n) => `<p class="wm-text wm-daily-act"><span class="wm-from">Next 24 hours, ${esc(dayMed(isoForDay(m.month, n.day)))}:</span> ${esc(n.text)}</p>`).join('') : ''}
            ${acts.length ? `<ul class="wm-acts" data-fold-list>${acts.map(({ a }) => actionLine(m, a).replace('<li class="wm-act"', '<li class="wm-act" data-fold-item')).join('')}<li class="wm-more" data-fold-more hidden></li></ul>` : needs.length || notes.length ? '' : `<p class="wm-quiet">${f.status === ON ? 'None needed: on track for the week.' : 'No action yet.'} Assign one below if the room agrees.</p>`}
            ${buttons}
          </div>
        </section>
      </div>
    </article>`;
}

/* ---------- 3  Top gaps & cause evidence ---------- */

/** Off goal for the week, or a repeat gap: the worst first (every day for weeks, every day, off, 3+ days). */
function gapEntries(m) {
  const rank = { streak: 0, all: 1, three: 3 };
  const out = [];
  for (const f of m.fns) {
    for (const e of f.rows) {
      const off = e.result.status === OFF;
      if (!off && e.gap.level === 'none') continue;
      out.push({ f, e, rank: e.gap.level in rank && e.gap.level !== 'three' ? rank[e.gap.level] : off ? 2 : 3 });
    }
  }
  return out.sort((a, b) => a.rank - b.rank);
}

function gapsSlide(agenda, s) {
  const m = agenda.m;
  const list = gapEntries(m);
  const items = list.map(({ f, e }) => {
    const kpi = e.row.kpiDaily;
    const r = e.result;
    const pair = weeklyPair(r.effective, r.goalVaries ? null : r.goal, kpi, r.rule, { entered: r.mode !== 'AUTO' });
    const st = r.goalVaries ? NO_GOAL : r.status;
    const written = String(f.commentary?.happened ?? '').trim();
    const daily = (f.daily ?? []).find((g) => g.issue);
    const cause = written || (daily ? daily.issue : '');
    const causeLabel = written ? 'Cause evidence' : daily ? `Cause evidence · from the daily board, ${dayMed(isoForDay(m.month, daily.day))}` : 'Cause evidence';
    const acts = e.acts.filter(isOpenAction);
    const label = `${f.fn.name}, ${plainLabel(kpi)}`;
    return `<li class="wm-gap" data-fold-item>
        <div class="wm-gap-who"><p class="wm-gap-fn">${esc(f.fn.name)}</p><p class="wm-gap-kpi">${esc(plainLabel(kpi))}</p></div>
        <div class="wm-gap-res">${statusMarkup(st, { kpi, word: resultWord(r, kpi), extra: 'wm-gap-st' })}<p class="wm-gap-fig">${esc(pair.actual ?? 'Not entered')} <span>${esc(r.goalVaries ? '' : pair.rest)}</span></p>${e.gap.level !== 'none' ? `<p class="wm-gap-rep">${esc(e.gap.long ?? e.gap.word)}</p>` : ''}</div>
        <div class="wm-gap-cause"><p class="wm-label">${esc(causeLabel)}</p><p class="wm-text${cause ? '' : ' is-empty'}">${esc(cause || 'Not written yet')}</p></div>
        <div class="wm-gap-act">${acts.length ? `<p class="wm-gap-acts">${actionStateMarkup(acts[0].status)} ${esc(acts[0].text)}${acts.length > 1 ? ` <span class="wm-quiet">+${acts.length - 1}</span>` : ''}</p>`
          : e.response?.note ? `<p class="wm-gap-acts"><span class="wm-from">Next 24 hours:</span> ${esc(e.response.note.text)}</p>`
            : e.needs ? `${statusMarkup(OFF, { tag: 'p', word: 'Needs an action', extra: 'm-needs-status' })}${lapsedLines([e])}` : '<p class="wm-quiet">No action yet</p>'}
          <div class="wm-btns">${assignButton(f.fn.id, kpiKeyOf(e.row), label)}${escalateButton(f.fn.id, kpiKeyOf(e.row), label)}</div></div>
      </li>`;
  }).join('');
  return `<article class="wm wm--gaps" aria-labelledby="wm-title">
      ${headMarkup(agenda, s, 'Top gaps &amp; cause evidence', list.length ? `${list.length} ${list.length === 1 ? 'result' : 'results'}: off goal for the week, or missed 3 days or more` : '')}
      ${list.length ? `<ol class="wm-gaps" data-fold-list>${items}<li class="wm-more" data-fold-more hidden></li></ol>` : '<div class="wm-calm"><p class="wm-empty">Every result is on track for the week, and no miss repeats.</p><p class="wm-quiet">Nothing to dig into here. Next: Actions (→).</p></div>'}
    </article>`;
}

/* ---------- 4  Actions ---------- */

function actionsSlide(agenda, s) {
  const m = agenda.m;
  const sets = actionSets(m);
  const prev = previousRecord(m);
  const all = listActions();
  const name = (a) => m.fns.find((f) => f.fn.id === a.fnId)?.fn.name ?? '';
  const prior = prev ? prev.actionIds.map((id) => all.find((a) => a.id === id)).filter(Boolean) : [];
  const carried = [...prior, ...sets.carried.filter((a) => !prior.includes(a))];
  const decisions = prev?.decisions ?? [];
  const fresh = sets.opened;
  const list = (items, empty) => (items.length
    ? `<ul class="wm-acts" data-fold-list>${items.map((a) => actionLine(m, a, name(a)).replace('<li class="wm-act"', '<li class="wm-act" data-fold-item')).join('')}<li class="wm-more" data-fold-more hidden></li></ul>`
    : `<p class="wm-quiet">${esc(empty)}</p>`);
  return `<article class="wm wm--actions" aria-labelledby="wm-title">
      ${headMarkup(agenda, s, 'Actions', 'By action ID, from the Action register. A completed action waits for its verifier.')}
      <div class="wm-cols">
        <section class="wm-col" aria-labelledby="wm-prior"><h3 class="wm-h3" id="wm-prior">Prior commitments <span class="wm-n">${carried.length + decisions.length}</span></h3>
          ${prev ? `<p class="wm-quiet">From the weekly review of ${esc(dayShort(prev.weekKey))} (${prev.state === 'finalized' ? 'finalized' : 'draft'}), and actions still open from before ${esc(dayMed(m.week.start))}.</p>` : `<p class="wm-quiet">Actions still open from before ${esc(dayMed(m.week.start))}. No earlier weekly review on this device.</p>`}
          ${decisions.length ? `<ul class="wm-decisions">${decisions.slice(0, 3).map((d) => `<li><span class="wm-label">Decision</span> ${esc(d.text)}</li>`).join('')}</ul>` : ''}
          ${list(carried, 'Nothing was carried in: no action was still open from before this week.')}
        </section>
        <section class="wm-col" aria-labelledby="wm-new"><div class="wm-h3-row"><h3 class="wm-h3" id="wm-new">New this week <span class="wm-n">${fresh.length}</span></h3>${assignButton('*', null)}</div>
          <p class="wm-quiet">Added ${esc(dayShort(m.week.start))} to ${esc(dayShort(m.week.end))}, this meeting's too.</p>
          ${list(fresh, 'No action added this week yet. Assign action adds one here.')}
        </section>
      </div>
    </article>`;
}

/* ---------- 5  Escalations ---------- */

function escalationsSlide(agenda, s) {
  const m = agenda.m;
  const all = listActions();
  const name = (fnId) => m.fns.find((f) => f.fn.id === fnId)?.fn.name ?? '';
  const escalated = all.filter(isEscalatedAction);
  const draft = latestDraft(m.doc, m.week.key);
  const loose = (draft?.escalations ?? []).filter((e) => !e.actionId);
  const items = [
    ...escalated.map((a) => `<li class="wm-esc" data-fold-item><p class="wm-esc-what"><strong>${esc(name(a.fnId))}</strong> ${esc(a.text)}</p><p class="wm-esc-meta">To ${esc(a.escalation.to)}: ${esc(a.escalation.reason)}<span class="m-dot"> · </span>${actionStateMarkup(a.status)}</p></li>`),
    ...loose.map((e) => `<li class="wm-esc" data-fold-item><p class="wm-esc-what"><strong>${esc(e.label)}</strong></p><p class="wm-esc-meta">To ${esc(e.to)}: ${esc(e.reason)}<span class="m-dot"> · </span>No action yet</p></li>`),
  ];
  const done = new Set([...escalated.map((a) => `${a.fnId}|${a.kpiId ?? ''}`), ...loose.map((e) => e.fnId)]);
  const open = gapEntries(m).filter(({ f, e }) => !done.has(`${f.fn.id}|${e.row.primary ? '' : e.row.kpiId}`) && !done.has(f.fn.id));
  return `<article class="wm wm--esc" aria-labelledby="wm-title">
      ${headMarkup(agenda, s, 'Escalations', 'An escalated action keeps its state: escalating asks a leader for help, it doesn\'t close anything.')}
      <div class="wm-cols">
        <section class="wm-col" aria-labelledby="wm-esc-now"><h3 class="wm-h3" id="wm-esc-now">Escalated <span class="wm-n">${items.length}</span></h3>
          ${items.length ? `<ul class="wm-escs" data-fold-list>${items.join('')}<li class="wm-more" data-fold-more hidden></li></ul>` : '<div class="wm-calm wm-calm--left"><p class="wm-empty wm-empty--left">Nothing is escalated this week.</p><p class="wm-quiet">Escalate a gap on the right when it needs a leader\'s help.</p></div>'}
        </section>
        <section class="wm-col" aria-labelledby="wm-esc-gaps"><h3 class="wm-h3" id="wm-esc-gaps">Gaps not escalated <span class="wm-n">${open.length}</span></h3>
          ${open.length ? `<ul class="wm-escs" data-fold-list>${open.map(({ f, e }) => {
            const label = `${f.fn.name}, ${plainLabel(e.row.kpiDaily)}`;
            return `<li class="wm-esc wm-esc--gap" data-fold-item><p class="wm-esc-what"><strong>${esc(f.fn.name)}</strong> ${esc(plainLabel(e.row.kpiDaily))}<span class="wm-quiet"> · ${esc(e.gap.long || e.gap.word || resultWord(e.result, e.row.kpiDaily))}</span></p>${escalateButton(f.fn.id, kpiKeyOf(e.row), label)}</li>`;
          }).join('')}<li class="wm-more" data-fold-more hidden></li></ul>` : '<p class="wm-quiet">No gap is waiting: each one is escalated, or nothing is off goal.</p>'}
        </section>
      </div>
    </article>`;
}

/* ---------- 6  Forward look ---------- */

function forwardSlide(agenda, s) {
  const m = agenda.m;
  const draft = latestDraft(m.doc, m.week.key);
  const decisions = draft?.decisions ?? [];
  const sets = actionSets(m);
  const risks = m.fns.filter((f) => String(f.commentary?.risks ?? '').trim()).map((f) => ({ name: f.fn.name, text: f.commentary.risks.trim() }));
  const name = (a) => m.fns.find((f) => f.fn.id === a.fnId)?.fn.name ?? '';
  const typed = readDecisionDraft(m.week.key);
  const next = addDays(m.week.end, 1);
  return `<article class="wm wm--forward" aria-labelledby="wm-title">
      ${headMarkup(agenda, s, 'Forward look', `Next review: week of ${esc(dayMed(next))}`)}
      <div class="wm-cols">
        <section class="wm-col" aria-labelledby="wm-dec"><h3 class="wm-h3" id="wm-dec">Decisions and next-week priorities <span class="wm-n">${decisions.length}</span></h3>
          ${decisions.length ? `<ol class="wm-decisions wm-decisions--list" data-fold-list>${decisions.map((d) => `<li data-fold-item>${esc(d.text)}${d.context ? ` <span class="wm-quiet">· ${esc(d.context)}</span>` : ''}</li>`).join('')}<li class="wm-more" data-fold-more hidden></li></ol>` : '<p class="wm-quiet">None yet. Type one below; it saves to this week\'s draft record.</p>'}
          <form class="wm-decide" data-wm-decision-form novalidate>
            <label class="wm-label" for="wm-decision">Decision or priority</label>
            <textarea class="ma-input ma-textarea" id="wm-decision" rows="2" maxlength="2000" data-wm-decision-draft="${esc(m.week.key)}">${esc(typed)}</textarea>
            <p class="ma-error" id="wm-decision-err" hidden></p>
            <div class="wm-btns"><button class="btn btn--primary" type="submit">Save decision</button>${typed.trim() ? '<span class="wm-quiet wm-unsaved">Not saved yet</span>' : ''}</div>
          </form>
        </section>
        <section class="wm-col" aria-label="Next week">
          <h3 class="wm-h3">Due next week <span class="wm-n">${sets.dueNext.length}</span></h3>
          ${sets.dueNext.length ? `<ul class="wm-acts" data-fold-list>${sets.dueNext.map((a) => actionLine(m, a, name(a)).replace('<li class="wm-act"', '<li class="wm-act" data-fold-item')).join('')}<li class="wm-more" data-fold-more hidden></li></ul>` : `<p class="wm-quiet">Nothing is due ${esc(dayShort(sets.nextStart))} to ${esc(dayShort(sets.nextEnd))}.</p>`}
          <h3 class="wm-h3">Next-week risks</h3>
          ${risks.length ? `<ul class="wm-risks" data-fold-list>${risks.map((r) => `<li data-fold-item><strong>${esc(r.name)}:</strong> ${esc(r.text)}</li>`).join('')}<li class="wm-more" data-fold-more hidden></li></ul>` : '<p class="wm-quiet">No next-week risk is written yet (Functions tab, Next-week risks).</p>'}
        </section>
      </div>
    </article>`;
}

/** One slide's markup. */
export function weeklySlideMarkup(agenda, i) {
  const s = agenda.slides[i];
  if (!s) return '';
  if (s.kind === 'ready') return readySlide(agenda, s);
  if (s.kind === 'fn') return fnSlide(agenda, s);
  if (s.kind === 'gaps') return gapsSlide(agenda, s);
  if (s.kind === 'actions') return actionsSlide(agenda, s);
  if (s.kind === 'escalations') return escalationsSlide(agenda, s);
  return forwardSlide(agenda, s);
}

/** Clamped words on the weekly slides (each ends on one clean "…": board.js fitClampedText). */
const WM_CLAMPED = '.wm-text, .wm-gap-acts';

/**
 * Fit the slide to the screen: first the compact type, then lists fold from their end, each into
 * "N more on the Weekly review page", until nothing overflows. Nothing is cut mid-line. A slide with
 * room to spare gives it to what's on it (fillRoom). Every clamp ends on one clean "…".
 */
export function fitWeeklySlide(stage) {
  const art = stage.querySelector('.wm');
  if (!art) return;
  fitWeeklyBody(art);
  fitClampedText(art, WM_CLAMPED);
}

function fitWeeklyBody(art) {
  fitWeekFigures(art);
  // Portrait and phones: the slide scrolls and every part keeps its natural height, so nothing folds.
  if (getComputedStyle(art).overflowY === 'auto') return;
  // The slide, each column, and any list that clips its own overflow.
  const boxes = [art, ...art.querySelectorAll('.wm-col, .wm-gaps')];
  const over = () => boxes.some((c) => c.scrollHeight > c.clientHeight + 1);
  if (!over()) { fillRoom(art, over); return; }
  art.classList.add('is-compact');
  fitWeekFigures(art);
  const lists = [...art.querySelectorAll('[data-fold-list]')];
  for (let guard = 0; guard < 60 && over(); guard += 1) {
    // The longest list gives way first.
    const list = lists.map((l) => ({ l, items: [...l.querySelectorAll(':scope > [data-fold-item]:not([hidden])')] }))
      .filter((x) => x.items.length > 1).sort((a, b) => b.items.length - a.items.length)[0];
    if (!list) break;
    list.items[list.items.length - 1].hidden = true;
    const more = list.l.querySelector(':scope > [data-fold-more]');
    const n = list.l.querySelectorAll(':scope > [data-fold-item][hidden]').length;
    if (more) { more.hidden = false; more.textContent = `${n} more on the Weekly review page`; }
  }
}

/** Text running past its box sideways anywhere inside `box` (a figure, a word, a row of day marks). */
const tooWide = (box) => [box, ...box.querySelectorAll('*')].some((el) => {
  if (el instanceof SVGElement || el.matches('.sr-only') || el.clientWidth <= 0 || el.scrollWidth <= el.clientWidth + 1) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'inline' && cs.position !== 'absolute';
});

/**
 * Room left on a landscape slide goes to what's on it, never to an empty band at the bottom:
 * - one measure (the usual function slide): the left column's week block, day marks and last 4 weeks
 *   grow together (--wm-grow, up to 1.5x) until the column is full or something would get too wide;
 * - every slide: a clamped text (the daily board's words, cause evidence, commentary) takes another
 *   line, one at a time, while the slide still holds it.
 */
function fillRoom(art, over) {
  const left = art.matches('.wm--solo') ? art.querySelector('.wm-cols--fn > .wm-col:not(.wm-col--right)') : null;
  if (left) {
    // 3px to spare under the last row (this week's ring, and rounding at the edge).
    const fits = () => Math.max(...[...left.children].map((k) => k.getBoundingClientRect().bottom)) <= left.getBoundingClientRect().bottom - 3
      && !tooWide(left);
    // The largest value in [lo, hi] that still fits (a few halvings), applied.
    const search = (set, lo, hi, ok = fits) => {
      set(hi);
      if (ok()) return hi;
      for (let i = 0; i < 7; i += 1) {
        const mid = (lo + hi) / 2;
        set(mid);
        if (ok()) lo = mid; else hi = mid;
      }
      set(lo);
      return lo;
    };
    const g = search((v) => { art.style.setProperty('--wm-grow', String(v)); fitWeekFigures(art); }, 1, 1.5);
    // Then the last 4 weeks alone, up to 1.8x, while each week's figure still fits its tile whole.
    const unstepped = () => fits() && ![...left.querySelectorAll('.wm-wk-v')].some((v) => v.style.fontSize);
    search((v) => { art.style.setProperty('--wm-grow-wk', String(v)); fitWeekFigures(art); }, g, Math.max(g, 1.8), unstepped);
  }
  const clamps = [...art.querySelectorAll(WM_CLAMPED)];
  const lines = (el) => parseInt(getComputedStyle(el).webkitLineClamp, 10);
  for (let guard = 0; guard < 40; guard += 1) {
    let grew = false;
    for (const el of clamps) {
      const n = lines(el);
      if (!(n > 0) || n >= 12 || el.scrollHeight <= el.clientHeight + 1) continue;
      el.style.setProperty('-webkit-line-clamp', String(n + 1));
      el.style.setProperty('line-clamp', String(n + 1));
      if (over()) {
        el.style.setProperty('-webkit-line-clamp', String(n));
        el.style.setProperty('line-clamp', String(n));
      } else grew = true;
    }
    if (!grew) break;
  }
}

/**
 * A figure is never cut ("2,79…"): when the widest of a row's four week figures is wider than its
 * tile, all four step down together (they stay one size, so they still compare), to 0.6 of their
 * size at the least. The status word wraps inside its tile instead (css/meeting.css).
 */
function fitWeekFigures(art) {
  for (const list of art.querySelectorAll('.wm-weeks')) {
    const figs = [...list.querySelectorAll('.wm-wk-v')];
    figs.forEach((v) => { v.style.fontSize = ''; });
    const ratio = Math.min(1, ...figs.filter((v) => v.scrollWidth > 0).map((v) => v.clientWidth / v.scrollWidth));
    if (ratio >= 1) continue;
    const base = parseFloat(getComputedStyle(figs[0]).fontSize) || 0;
    const size = Math.max(base * 0.6, Math.floor(base * ratio * 0.98));
    figs.forEach((v) => { v.style.fontSize = `${size}px`; });
  }
}

/* ---------- Decisions and escalations: small forms over the meeting ---------- */

let ctx = null;   // { host, getMonth, getDay, relayout }
let dlg = null;
let mode = null;  // { kind: 'decide' | 'escalate', fnId, kpiKey, label, context }
let closedAt = 0;

/** Esc in full screen closes the form and leaves full screen: the meeting goes on (as the Add action form). */
export const weeklyHoldsEscape = () => Boolean(dlg?.open) || Date.now() - closedAt < 700;

const weekKeyNow = () => buildWeeklyAgenda(ctx.getMonth(), ctx.getDay())?.m.week.key ?? null;

function openForm(next) {
  if (!dlg || dlg.open) return;
  mode = next;
  const m = buildWeeklyAgenda(ctx.getMonth(), ctx.getDay())?.m;
  if (!m) return;
  const title = dlg.querySelector('#wm-dlg-title');
  const sub = dlg.querySelector('#wm-dlg-sub');
  const to = dlg.querySelector('[data-wm-to-field]');
  const text = dlg.querySelector('#wm-dlg-text');
  const label = dlg.querySelector('[for="wm-dlg-text"]');
  const save = dlg.querySelector('[data-wm-save]');
  dlg.querySelectorAll('.ma-error').forEach((e) => { e.hidden = true; e.textContent = ''; });
  text.removeAttribute('aria-invalid');
  if (next.kind === 'escalate') {
    title.textContent = `Escalate ${next.label}`;
    sub.textContent = 'It goes on this week\'s record. An open action for it is flagged Escalated and keeps its state.';
    label.textContent = 'Why it needs escalating';
    save.textContent = 'Escalate';
    to.hidden = false;
    const lead = accountable(m, next.fnId);
    to.querySelector('select').innerHTML = m.org.people.filter((p) => p.name.trim())
      .map((p) => `<option value="${esc(p.name)}"${p.name === lead ? ' selected' : ''}>${esc(p.name)}${p.name === lead ? ' (accountable leader)' : ''}</option>`).join('');
    text.value = '';
  } else {
    title.textContent = 'Add a decision';
    sub.textContent = `It saves to the ${weekLabel(m.week).toLowerCase()} draft record at once.`;
    label.textContent = 'Decision or next-week priority';
    save.textContent = 'Save decision';
    to.hidden = true;
    text.value = readDecisionDraft(m.week.key);
  }
  dlg.showModal();
  text.focus();
  text.setSelectionRange(text.value.length, text.value.length);
}

function saveForm(e) {
  e.preventDefault();
  const text = dlg.querySelector('#wm-dlg-text');
  const err = dlg.querySelector('#wm-dlg-text-err');
  const words = text.value.trim();
  if (!words) {
    err.textContent = mode.kind === 'escalate' ? 'Say why it needs escalating.' : 'Write the decision first.';
    err.hidden = false;
    text.setAttribute('aria-invalid', 'true');
    text.focus();
    return;
  }
  const month = ctx.getMonth();
  const day = ctx.getDay();
  const weekKey = weekKeyNow();
  if (mode.kind === 'escalate') {
    const kpiId = mode.kpiKey ? mode.kpiKey : null;
    const r = addEscalation(month, day, weekKey, { fnId: mode.fnId, kpiId, label: mode.label, to: dlg.querySelector('#wm-dlg-to').value, reason: words });
    mode = null;
    dlg.close();
    ctx.relayout();
    toast(r.ok ? `Escalated to ${r.to}.${r.actionId ? ' Its open action is flagged and keeps its state.' : ' No action yet: assign one.'}` : r.error ?? 'Escalated for this visit.', { duration: 5000 });
  } else {
    const r = addDecision(month, day, weekKey, words, mode.context ?? '');
    mode = null;
    dlg.close();
    ctx.relayout();
    toast(`Decision saved to the draft record (${r.count} this week).${r.ok ? '' : " This browser isn't saving."}`, { duration: 5000 });
  }
}

/** The Forward look slide's own decision box. */
function saveInline(form) {
  const box = form.querySelector('#wm-decision');
  const err = form.querySelector('#wm-decision-err');
  const words = box.value.trim();
  if (!words) { err.textContent = 'Write the decision first.'; err.hidden = false; box.setAttribute('aria-invalid', 'true'); box.focus(); return; }
  const r = addDecision(ctx.getMonth(), ctx.getDay(), weekKeyNow(), words, 'Forward look');
  ctx.relayout();
  ctx.host.querySelector('#wm-decision')?.focus({ preventScroll: true });
  toast(`Decision saved to the draft record (${r.count} this week).${r.ok ? '' : " This browser isn't saving."}`, { duration: 5000 });
}

/** Called once by js/meeting.js: the forms live inside the meeting, so they show over it in full screen. */
export function initWeeklyMeeting(c) {
  ctx = c;
  dlg = document.createElement('dialog');
  dlg.className = 'ma wm-dlg';
  dlg.setAttribute('aria-labelledby', 'wm-dlg-title');
  dlg.setAttribute('aria-describedby', 'wm-dlg-sub');
  dlg.innerHTML = `
    <form class="ma-form" novalidate>
      <header class="ma-head"><h2 class="ma-title" id="wm-dlg-title"></h2><p class="ma-sub" id="wm-dlg-sub"></p></header>
      <div class="ma-field" data-wm-to-field hidden>
        <label class="ma-label" for="wm-dlg-to">Escalate to</label>
        <span class="ma-pick"><select class="ma-input ma-select" id="wm-dlg-to"></select></span>
      </div>
      <div class="ma-field">
        <label class="ma-label" for="wm-dlg-text"></label>
        <textarea class="ma-input ma-textarea" id="wm-dlg-text" rows="3" maxlength="2000" aria-describedby="wm-dlg-text-err"></textarea>
        <p class="ma-error" id="wm-dlg-text-err" hidden></p>
      </div>
      <div class="ma-actions">
        <button class="btn btn--secondary" type="button" data-wm-cancel>Cancel</button>
        <button class="btn btn--primary" type="submit" data-wm-save>Save</button>
      </div>
    </form>`;
  c.host.append(dlg);
  dlg.querySelector('form').addEventListener('submit', saveForm);
  dlg.querySelector('[data-wm-cancel]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('cancel', () => { closedAt = Date.now(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && !dlg.querySelector('#wm-dlg-text').value.trim()) dlg.close(); });
  dlg.addEventListener('close', () => {
    closedAt = Date.now();
    // A decision closed unsaved is kept (Finish review asks about it); an escalation's words are dropped.
    if (mode?.kind === 'decide') {
      const key = weekKeyNow();
      if (key) writeDecisionDraft(key, dlg.querySelector('#wm-dlg-text').value);
      ctx.relayout();
    }
    mode = null;
    (c.host.querySelector('[data-wm-decide]:not([hidden])') ?? c.host.querySelector('[data-next-slide]'))?.focus({ preventScroll: true });
  });
  c.host.addEventListener('click', (e) => {
    const esc8 = e.target.closest('[data-wm-escalate]');
    if (esc8) { openForm({ kind: 'escalate', fnId: esc8.dataset.wmEscalate, kpiKey: esc8.dataset.wmKpi, label: esc8.dataset.wmLabel }); return; }
    if (e.target.closest('[data-wm-decide]')) openForm({ kind: 'decide', context: c.context?.() ?? '' });
  });
  c.host.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-wm-decision-form]')) return;
    e.preventDefault();
    saveInline(e.target);
  });
  c.host.addEventListener('input', (e) => {
    if (e.target.matches?.('[data-wm-decision-draft]')) writeDecisionDraft(e.target.dataset.wmDecisionDraft, e.target.value);
  });
}
