// Three-way merge for a pilot board's saved documents (PILOT-SPEC.md, "Two people at once").
// Pure: no DOM, no storage. Used by js/cloud.js when the server says someone else saved first.
//
// For each item: if mine equals base, take theirs (a deletion included); else if
// theirs equals base, take mine; else take mine and report a clash.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (isObj(v)) {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
}
const same = (a, b) => JSON.stringify(canon(a === undefined ? null : a)) === JSON.stringify(canon(b === undefined ? null : b));

/** One item. Returns [value, clash]; value undefined means "absent". */
function pick(base, mine, theirs) {
  if (same(mine, base)) return [theirs, false];
  if (same(theirs, base)) return [mine, false];
  if (same(mine, theirs)) return [mine, false];
  return [mine, true];
}

/** Merge two maps key by key. */
function mergeMap(base, mine, theirs, state) {
  const b = isObj(base) ? base : {};
  const m = isObj(mine) ? mine : {};
  const t = isObj(theirs) ? theirs : {};
  const out = {};
  for (const k of new Set([...Object.keys(t), ...Object.keys(m), ...Object.keys(b)])) {
    const [v, clash] = pick(b[k], m[k], t[k]);
    if (clash) state.clash = true;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Merge two arrays of `{ id }` items: theirs' order, then mine's new items.
 * keepFinal: a record theirs has finalized is kept as theirs, whatever mine did (weekly records).
 */
function mergeList(base, mine, theirs, state, keepFinal = false) {
  const byId = (list) => new Map((Array.isArray(list) ? list : []).filter((x) => isObj(x) && x.id != null).map((x) => [String(x.id), x]));
  const b = byId(base), m = byId(mine), t = byId(theirs);
  const order = [...t.keys(), ...[...m.keys()].filter((id) => !t.has(id))];
  for (const id of b.keys()) if (!order.includes(id)) order.push(id);
  const out = [];
  for (const id of order) {
    if (keepFinal && t.get(id)?.state === 'finalized') { out.push(t.get(id)); continue; }
    const [v, clash] = pick(b.get(id), m.get(id), t.get(id));
    if (clash) state.clash = true;
    if (v !== undefined) out.push(v);
  }
  return out;
}

// For each document: which top-level fields merge per key (map) or per id (list), and
// which fields only make sense together (GROUPS: compared and taken as one item).
// Every other top-level field merges whole, on its own.
const SHAPES = {
  numbers: { entries: 'map' },
  setup: { functions: 'map', kpis: 'map', added: 'list' },
  org: {},
  weekly: { weeks: 'map', records: 'final-list' },
};
const GROUPS = {
  org: [['draft', 'rev', 'checked'], ['active', 'activatedAt'], ['daysOff', 'extraDays']],
};
const pickFields = (o, fields) => Object.fromEntries(fields.filter((f) => f in o).map((f) => [f, o[f]]));

/**
 * mergeDoc(name, base, mine, theirs) -> { body, clash }
 * name is the server document name: setup, org, weekly, actions, meetings, numbers-YYYY-MM.
 */
export function mergeDoc(name, base, mine, theirs) {
  const state = { clash: false };
  const kind = String(name).startsWith('numbers-') ? 'numbers' : name;
  if (kind === 'actions' || kind === 'meetings') {
    return { body: mergeList(base, mine, theirs, state), clash: state.clash };
  }
  if (theirs == null) return { body: mine, clash: false };
  if (mine == null) return { body: theirs, clash: false };
  const shape = SHAPES[kind] ?? {};
  const b = isObj(base) ? base : {};
  const m = isObj(mine) ? mine : {};
  const t = isObj(theirs) ? theirs : {};
  const body = {};
  const grouped = new Set();
  for (const fields of GROUPS[kind] ?? []) {
    const [v, clash] = pick(pickFields(b, fields), pickFields(m, fields), pickFields(t, fields));
    if (clash) state.clash = true;
    Object.assign(body, v);
    for (const f of fields) grouped.add(f);
  }
  for (const k of new Set([...Object.keys(t), ...Object.keys(m), ...Object.keys(b)])) {
    if (grouped.has(k)) continue;
    if (shape[k] === 'map') body[k] = mergeMap(b[k], m[k], t[k], state);
    else if (shape[k] === 'list') body[k] = mergeList(b[k], m[k], t[k], state);
    else if (shape[k] === 'final-list') body[k] = mergeList(b[k], m[k], t[k], state, true);
    else {
      const [v, clash] = pick(b[k], m[k], t[k]);
      if (clash) state.clash = true;
      if (v !== undefined) body[k] = v;
    }
  }
  return { body, clash: state.clash };
}
