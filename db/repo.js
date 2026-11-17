'use strict';
/**
 * Central data layer. EVERY write goes through here and runs in ONE transaction together with its
 * activity_log row (user/employee/request from db/context.js).
 *
 *   const { openDb } = require('./db/client');
 *   const { createRepo } = require('./db/repo');
 *   const repo = createRepo(await openDb());
 *
 * Errors are RepoError { code, status }: NOT_FOUND 404, REV_CONFLICT 409, EXISTS 409, INVALID 400.
 */
const crypto = require('node:crypto');
const { sql, eq, and, isNull, inArray, notInArray, desc, asc, getTableColumns, getTableName, is } = require('drizzle-orm');
const { PgTable } = require('drizzle-orm/pg-core');
const S = require('./schema');
const calc = require('./calc');
const { getContext } = require('./context');
const M = require('./mapping');
const { addStudioApi } = require('./studio-repo');

class RepoError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const notFound = (what, id) => new RepoError('NOT_FOUND', `${what} ${id} not found`, 404);

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const r2 = (v) => (v === null || v === undefined ? null : calc.round2(v));
const r4 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 1e4) / 1e4);
const json = (v) => (v === undefined ? null : JSON.stringify(v));
const rowsOf = (res) => (Array.isArray(res) ? res : res.rows);

/** Tables reachable through the generic helpers, by SQL name. */
const TABLES = Object.fromEntries(Object.values(S).filter((t) => is(t, PgTable)).map((t) => [getTableName(t), t]));
/** Row as logged: file bytes are summarised, never copied into the log. */
const forLog = (row) => (row && row.bytes ? { ...row, bytes: `<${row.bytes.length} bytes>` } : row);
const hasCol = (t, c) => Object.prototype.hasOwnProperty.call(getTableColumns(t), c);

/** Whitelisted reporting views for repo.report(). */
const REPORT_VIEWS = [
  'v_unit_cost_history', 'v_unit_cost_history_by_estimator', 'v_vendor_quote_history', 'v_project_pipeline',
  'v_bid_hit_rate', 'v_estimate_vs_actual', 'v_employee_bids', 'v_employee_win_rate', 'v_employee_estimate_accuracy',
  'v_expiring_certifications', 'v_project_bid_snapshot', 'v_ew_balance',
];
const REPORT_OPS = ['=', '<>', '<', '<=', '>', '>='];

const OUTCOME_TO_PROJECT_STATUS = { pending: 'submitted', won: 'won', lost: 'lost', not_awarded: 'cancelled', withdrawn: 'no_bid' };

function shallowDiff(before, after) {
  if (!before || !after) return null;
  const d = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (k === 'updated_at') continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) d[k] = [before[k] ?? null, after[k] ?? null];
  }
  return d;
}
/** Project documents are large; the diff lists changed top-level keys and array lengths only. */
function docDiff(before, after) {
  const d = {};
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    const a = before?.[k], b = after?.[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    d[k] = Array.isArray(a) || Array.isArray(b)
      ? { changed: true, before_len: Array.isArray(a) ? a.length : null, after_len: Array.isArray(b) ? b.length : null }
      : [a ?? null, b ?? null];
  }
  return d;
}

function chunk(arr, n = 400) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function createRepo(handle) {
  const db = handle.db;

  // ------------------------------------------------------------------ core helpers
  async function log(tx, { action, entity_type, entity_id, project_id = null, before = null, after = null, diff }) {
    const c = getContext();
    await tx.insert(S.activity_log).values({
      id: uuid(), occurred_at: now(), user_id: c.user_id, employee_id: c.employee_id, project_id,
      entity_type, entity_id: entity_id == null ? null : String(entity_id), action,
      before_json: json(forLog(before) ?? undefined), after_json: json(forLog(after) ?? undefined),
      diff_json: json(diff === undefined ? shallowDiff(forLog(before), forLog(after)) ?? undefined : diff ?? undefined), request_id: c.request_id,
    });
  }
  const tx = (fn) => db.transaction(fn);
  const tableOf = (name) => {
    const t = TABLES[name];
    if (!t) throw new RepoError('INVALID', `unknown table ${name}`, 400);
    return t;
  };
  const projectIdOf = (name, row) => (name === 'projects' ? row.id : row.project_id ?? null);

  async function insertRow(t, name, values, { action = 'create', logIt = true } = {}) {
    const row = { ...values, id: values.id ?? uuid() };
    if (hasCol(TABLES[name], 'created_at') && !row.created_at) { row.created_at = now(); row.updated_at = now(); }
    const [saved] = await t.insert(TABLES[name]).values(row).returning();
    if (logIt) await log(t, { action, entity_type: name, entity_id: saved.id, project_id: projectIdOf(name, saved), after: saved, diff: null });
    return saved;
  }
  async function getRowTx(t, name, id, { forUpdate = false } = {}) {
    const tb = tableOf(name);
    let q = t.select().from(tb).where(eq(tb.id, id));
    if (forUpdate && handle.kind === 'pg') q = q.for('update');
    const [row] = await q;
    return row || null;
  }
  async function updateRowTx(t, name, id, patch, { action = 'update' } = {}) {
    const tb = tableOf(name);
    const before = await getRowTx(t, name, id, { forUpdate: true });
    if (!before) throw notFound(name, id);
    const p = { ...patch };
    delete p.id;
    if (hasCol(tb, 'updated_at')) p.updated_at = now();
    const [after] = await t.update(tb).set(p).where(eq(tb.id, id)).returning();
    await log(t, { action, entity_type: name, entity_id: id, project_id: projectIdOf(name, after), before, after });
    return after;
  }

  /** Generic helpers (any table by SQL name). */
  const insert = (name, values) => { tableOf(name); return tx((t) => insertRow(t, name, values)); };
  const update = (name, id, patch) => tx((t) => updateRowTx(t, name, id, patch));
  function softDelete(name, id) {
    const tb = tableOf(name);
    if (!hasCol(tb, 'deleted_at')) throw new RepoError('INVALID', `${name} has no soft delete`, 400);
    return tx((t) => updateRowTx(t, name, id, { deleted_at: now(), deleted_by: getContext().user_id }, { action: 'delete' }));
  }
  function restore(name, id) {
    tableOf(name);
    return tx((t) => updateRowTx(t, name, id, { deleted_at: null, deleted_by: null }, { action: 'restore' }));
  }
  /** Read one row; soft-deleted rows are hidden unless includeDeleted. */
  async function get(name, id, { includeDeleted = false } = {}) {
    const row = await getRowTx(db, name, id);
    if (!row || (!includeDeleted && row.deleted_at)) return null;
    return row;
  }
  /** List rows with equality filters; soft-deleted rows hidden unless includeDeleted. */
  async function list(name, filters = {}, { includeDeleted = false, orderBy } = {}) {
    const tb = tableOf(name);
    const conds = Object.entries(filters).map(([k, v]) => {
      if (!hasCol(tb, k)) throw new RepoError('INVALID', `unknown column ${name}.${k}`, 400);
      return v === null ? isNull(tb[k]) : eq(tb[k], v);
    });
    if (!includeDeleted && hasCol(tb, 'deleted_at')) conds.push(isNull(tb.deleted_at));
    let q = db.select().from(tb).where(conds.length ? and(...conds) : undefined);
    const ob = orderBy || (hasCol(tb, 'sort_order') ? 'sort_order' : hasCol(tb, 'created_at') ? 'created_at' : 'id');
    q = q.orderBy(asc(tb[ob]), asc(tb.id));
    return q;
  }

  async function upsertMany(t, tb, rows) {
    if (!rows.length) return;
    const cols = getTableColumns(tb);
    for (const part of chunk(rows)) {
      const set = {};
      for (const k of Object.keys(part[0])) if (k !== 'id') set[k] = sql.raw(`excluded."${cols[k].name}"`);
      await t.insert(tb).values(part).onConflictDoUpdate({ target: tb.id, set });
    }
  }
  async function insertMany(t, tb, rows) {
    for (const part of chunk(rows)) await t.insert(tb).values(part);
  }

  // ------------------------------------------------------------------ project document <-> rows
  function pricingMethod(items) {
    const kinds = new Set();
    for (const i of items || []) {
      if (calc.n0(i.production) > 0 || calc.num(i.crewDaysOverride) !== null) kinds.add('production');
      if (i.material) kinds.add('material');
      if (i.sub) kinds.add('sub');
    }
    if (!kinds.size) return 'none';
    return kinds.size > 1 ? 'mixed' : [...kinds][0];
  }

  function subCols(prefix, spec) {
    const out = {};
    const s = M.isObj(spec) ? spec : null;
    const pick = (k, type) => (s && s[k] !== undefined && M.fits(s[k], type) ? s[k] : null);
    out[`has_${prefix === 'mat' ? 'material' : 'sub'}`] = !!s;
    out[`${prefix}_unit_price`] = pick('unitPrice', 'n4');
    out[`${prefix}_qty`] = pick('qty', 'n4');
    out[`${prefix}_qty_basis`] = pick('qtyBasis', 's20');
    out[`${prefix}_qty_factor`] = pick('qtyFactor', 'n6');
    out[`${prefix}_factor_ref`] = pick('factorRef', 's20');
    out[`${prefix}_fixed`] = pick('fixed', 'n4');
    out[`${prefix}_unit`] = pick('unit', 's20');
    out[`${prefix}_note`] = pick('note', 't');
    if (prefix === 'mat') { out.mat_ext = pick('ext', 'n4'); out.mat_tax_exempt = pick('taxExempt', 'b'); }
    else { out.sub_amount = pick('amount', 'n4'); out.sub_is_ls = pick('ls', 'b'); }
    return out;
  }

  /** Writes the whole document's child rows (sync by deterministic ids). Returns computed totals. */
  async function writeDocChildren(t, pid, doc, { estimatorId }) {
    const totals = calc.projectTotals(doc);
    const H = { sections: M.isObjArray, lines: M.isObjArray, openItems: M.isObjArray, assumptions: M.isObjArray, plans: M.isObjArray, aiProposals: M.isObjArray, proposal: M.isObj };
    const has = (k) => Object.prototype.hasOwnProperty.call(doc, k) && H[k](doc[k]);

    // leaf rows are always rebuilt
    for (const tb of [S.line_item_costs, S.line_item_quotes, S.open_items, S.assumptions, S.ai_proposals, S.proposal_settings, S.project_exclusions, S.project_notes]) {
      await t.delete(tb).where(eq(tb.project_id, pid));
    }
    await t.delete(S.project_quotes).where(and(eq(S.project_quotes.project_id, pid), eq(S.project_quotes.link_source, 'line')));
    await t.delete(S.project_sub_quotes).where(and(eq(S.project_sub_quotes.project_id, pid), eq(S.project_sub_quotes.link_source, 'line')));

    // sections (upsert; referenced by line_items)
    const sections = has('sections') ? doc.sections : [];
    const secRows = sections.map((s, i) => ({ id: M.cid(pid, 's', s.id ?? `#${i}`), project_id: pid, sort_order: i, ...M.toRow(s, M.SPEC.section) }));
    await upsertMany(t, S.bid_sections, secRows);
    const secIdByKey = new Map(sections.map((s, i) => [s.id, secRows[i].id]));

    // lines (upsert; referenced by job_cost_actuals)
    const lines = has('lines') ? doc.lines : [];
    const lineRows = [];
    const itemRows = [];
    const quoteRows = [];
    const quoteRefs = new Set();
    lines.forEach((l, i) => {
      const id = M.cid(pid, 'l', l.id ?? `#${i}`);
      const lt = totals.lines[l.id] || { total: 0, unitPrice: null, items: [] };
      const itemsOk = M.isObjArray(l.items);
      const qOk = M.isStrArray(l.quoteIds);
      const base = M.toRow(l, M.SPEC.line, { items: M.isObjArray, quoteIds: M.isStrArray });
      lineRows.push({
        id, project_id: pid, sort_order: i, ...base,
        bid_section_id: secIdByKey.get(l.sectionId) ?? null,
        estimator_id: estimatorId ?? null,
        variance: r4(calc.lineVariance(l)),
        pricing_method: pricingMethod(itemsOk ? l.items : []),
        total_cost: r2(lt.total), // cent-rounded line direct cost (0 when excluded)
        unit_price: r4(lt.unitPrice),
      });
      if (itemsOk) {
        l.items.forEach((it, j) => {
          const c = calc.itemCost(it, l, doc);
          const inc = calc.isIncluded(l);
          itemRows.push({
            id: M.cid(id, it.id ?? `#${j}`), line_item_id: id, project_id: pid, sort_order: j,
            ...M.toRow(it, M.SPEC.item),
            ...subCols('mat', it.material), ...subCols('sub', it.sub),
            crew_days: r4(c.crewDays), labor_cost: r4(inc ? c.labor : 0), equip_cost: r4(inc ? c.equip : 0),
            material_cost: r4(inc ? c.material : 0), tax_cost: r4(inc ? c.tax : 0), sub_cost: r4(inc ? c.sub : 0),
            trucking_cost: null, total_cost: r4(inc ? c.total : 0), unit_price: c.qty > 0 ? r4(c.total / c.qty) : null,
          });
        });
      }
      if (qOk) l.quoteIds.forEach((q, j) => { quoteRows.push({ id: M.cid(id, 'q', j), line_item_id: id, project_id: pid, quote_ref: q, sort_order: j }); quoteRefs.add(q); });
    });
    await upsertMany(t, S.line_items, lineRows);
    await t.delete(S.line_items).where(and(eq(S.line_items.project_id, pid), notInArray(S.line_items.id, lineRows.map((r) => r.id))));
    await t.delete(S.bid_sections).where(and(eq(S.bid_sections.project_id, pid), notInArray(S.bid_sections.id, secRows.map((r) => r.id))));
    await insertMany(t, S.line_item_costs, itemRows);
    await insertMany(t, S.line_item_quotes, quoteRows);

    // quote links (line-derived) to master quotes that exist
    if (quoteRefs.size) {
      const refs = [...quoteRefs];
      const vq = await t.select({ id: S.vendor_quotes.id }).from(S.vendor_quotes).where(inArray(S.vendor_quotes.id, refs));
      const sq = await t.select({ id: S.sub_quotes.id }).from(S.sub_quotes).where(inArray(S.sub_quotes.id, refs));
      if (vq.length) await t.insert(S.project_quotes).values(vq.map((q) => ({ id: uuid(), project_id: pid, vendor_quote_id: q.id, link_source: 'line', linked_at: now() }))).onConflictDoNothing();
      if (sq.length) await t.insert(S.project_sub_quotes).values(sq.map((q) => ({ id: uuid(), project_id: pid, sub_quote_id: q.id, link_source: 'line', linked_at: now() }))).onConflictDoNothing();
    }

    // simple child lists
    const simple = [['openItems', S.open_items, M.SPEC.openItem, 'o'], ['assumptions', S.assumptions, M.SPEC.assumption, 'a'], ['aiProposals', S.ai_proposals, M.SPEC.aiProposal, 'p']];
    for (const [key, tb, spec, tag] of simple) {
      if (!has(key)) continue;
      await insertMany(t, tb, doc[key].map((o, i) => ({ id: M.cid(pid, tag, o.id ?? `#${i}`, i), project_id: pid, sort_order: i, ...M.toRow(o, spec) })));
    }
    const plans = has('plans') ? doc.plans : [];
    const planRows = plans.map((o, i) => ({ id: M.cid(pid, 'plan', o.id ?? `#${i}`), project_id: pid, sort_order: i, ...M.toRow(o, M.SPEC.plan) }));
    await upsertMany(t, S.plan_sets, planRows);
    await t.delete(S.plan_sets).where(and(eq(S.plan_sets.project_id, pid), notInArray(S.plan_sets.id, planRows.map((r) => r.id))));

    if (has('proposal')) {
      const p = doc.proposal;
      await t.insert(S.proposal_settings).values({ project_id: pid, ...M.toRow(p, M.SPEC.proposal, { exclusions: M.isStrArray, notes: M.isStrArray }) });
      if (M.isStrArray(p.exclusions)) await insertMany(t, S.project_exclusions, p.exclusions.map((b, i) => ({ id: M.cid(pid, 'x', i), project_id: pid, body: b, sort_order: i })));
      if (M.isStrArray(p.notes)) await insertMany(t, S.project_notes, p.notes.map((b, i) => ({ id: M.cid(pid, 'n', i), project_id: pid, body: b, sort_order: i })));
    }
    return totals;
  }

  function projectColumns(doc) {
    const H = { id: () => true, rev: () => true, sections: M.isObjArray, lines: M.isObjArray, openItems: M.isObjArray, assumptions: M.isObjArray, plans: M.isObjArray, aiProposals: M.isObjArray, proposal: M.isObj };
    const row = M.toRow(doc, M.SPEC.project, H);
    if (row.is_sample === null) row.is_sample = false;
    return row;
  }

  async function readDoc(t, pid, { includeDeleted = false } = {}) {
    const [p] = await t.select().from(S.projects).where(eq(S.projects.id, pid));
    if (!p || (!includeDeleted && p.deleted_at)) return null;
    const by = (tb) => t.select().from(tb).where(eq(tb.project_id, pid)).orderBy(asc(tb.sort_order));
    const [secs, lines, items, quotes, opens, assumps, ais, plans, props, excls, notes] = await Promise.all([
      by(S.bid_sections), by(S.line_items), t.select().from(S.line_item_costs).where(eq(S.line_item_costs.project_id, pid)).orderBy(asc(S.line_item_costs.line_item_id), asc(S.line_item_costs.sort_order)),
      t.select().from(S.line_item_quotes).where(eq(S.line_item_quotes.project_id, pid)).orderBy(asc(S.line_item_quotes.line_item_id), asc(S.line_item_quotes.sort_order)),
      by(S.open_items), by(S.assumptions), by(S.ai_proposals), by(S.plan_sets),
      t.select().from(S.proposal_settings).where(eq(S.proposal_settings.project_id, pid)), by(S.project_exclusions), by(S.project_notes),
    ]);
    const group = (rows) => rows.reduce((m, r) => { (m[r.line_item_id] ||= []).push(r); return m; }, {});
    const itemsBy = group(items);
    const quotesBy = group(quotes);
    const children = {
      sections: secs.map((r) => M.fromRow(r, M.SPEC.section)),
      lines: lines.map((r) => M.fromRow(r, M.SPEC.line, {
        items: (itemsBy[r.id] || []).map((i) => M.fromRow(i, M.SPEC.item)),
        quoteIds: (quotesBy[r.id] || []).map((q) => q.quote_ref),
      })),
      openItems: opens.map((r) => M.fromRow(r, M.SPEC.openItem)),
      assumptions: assumps.map((r) => M.fromRow(r, M.SPEC.assumption)),
      aiProposals: ais.map((r) => M.fromRow(r, M.SPEC.aiProposal)),
      plans: plans.map((r) => M.fromRow(r, M.SPEC.plan)),
    };
    if (props[0]) children.proposal = M.fromRow(props[0], M.SPEC.proposal, { exclusions: excls.map((x) => x.body), notes: notes.map((x) => x.body) });
    children.id = p.id;
    children.rev = p.rev;
    const doc = M.fromRow(p, M.SPEC.project, children);
    if (!('id' in doc)) doc.id = p.id;
    if (!('rev' in doc)) doc.rev = p.rev;
    return doc;
  }

  async function setEstimatorTx(t, pid, employeeId) {
    await t.update(S.projects).set({ estimator_id: employeeId }).where(eq(S.projects.id, pid));
    await t.update(S.line_items).set({ estimator_id: employeeId }).where(eq(S.line_items.project_id, pid));
  }

  // ------------------------------------------------------------------ projects
  /**
   * Create a project from an old-app JSON document.
   * opts: { estimatorId (employee), regionCode, clientCompanyId, status }
   */
  function createProject(doc, opts = {}) {
    return tx(async (t) => {
      const pid = doc.id || uuid();
      const [exists] = await t.select({ id: S.projects.id }).from(S.projects).where(eq(S.projects.id, pid));
      if (exists) throw new RepoError('EXISTS', `project ${pid} already exists`, 409);
      let region_id = null;
      if (opts.regionCode) {
        const [r] = await t.select().from(S.regions).where(eq(S.regions.code, opts.regionCode));
        region_id = r?.id ?? null;
      }
      const d = { ...doc, id: pid };
      await t.insert(S.projects).values({
        id: pid, ...projectColumns(d), rev: 1, status: opts.status || 'bidding', region_id,
        client_company_id: opts.clientCompanyId ?? null, estimator_id: opts.estimatorId ?? null, created_at: now(), updated_at: now(),
      });
      await writeDocChildren(t, pid, d, { estimatorId: opts.estimatorId });
      await t.insert(S.project_status_history).values({ id: uuid(), project_id: pid, from_status: null, to_status: opts.status || 'bidding', changed_at: now(), changed_by: getContext().user_id });
      if (opts.estimatorId) {
        await insertRow(t, 'project_assignments', { project_id: pid, employee_id: opts.estimatorId, role: 'estimator' });
      }
      const after = await readDoc(t, pid);
      await log(t, { action: 'create', entity_type: 'projects', entity_id: pid, project_id: pid, after, diff: null });
      return after;
    });
  }

  /** Save a full document with optimistic concurrency (expectedRev defaults to doc.rev). */
  function saveProject(doc, { expectedRev } = {}) {
    if (!doc || !doc.id) throw new RepoError('INVALID', 'doc.id required', 400);
    const expected = expectedRev ?? doc.rev;
    return tx(async (t) => {
      const cur = await getRowTx(t, 'projects', doc.id, { forUpdate: true });
      if (!cur || cur.deleted_at) throw notFound('project', doc.id);
      if (expected !== undefined && expected !== null && Number(expected) !== cur.rev) {
        throw new RepoError('REV_CONFLICT', `project ${doc.id} is at rev ${cur.rev}, you sent rev ${expected}`, 409);
      }
      const before = await readDoc(t, doc.id);
      const rev = cur.rev + 1;
      await t.update(S.projects).set({ ...projectColumns(doc), rev, updated_at: now() }).where(eq(S.projects.id, doc.id));
      await writeDocChildren(t, doc.id, doc, { estimatorId: cur.estimator_id });
      const after = await readDoc(t, doc.id);
      await log(t, { action: 'update', entity_type: 'projects', entity_id: doc.id, project_id: doc.id, before, after, diff: docDiff(before, after) });
      return after;
    });
  }

  /** Import an old-shape JSON file: create, or overwrite (latest rev) if the id already exists. */
  async function importProject(doc, opts = {}) {
    const existing = doc.id ? await get('projects', doc.id, { includeDeleted: true }) : null;
    if (!existing) return createProject(doc, opts);
    return saveProject({ ...doc }, { expectedRev: existing.rev });
  }

  const getProject = (id, opts) => readDoc(db, id, opts);

  async function listProjects({ status, includeDeleted = false } = {}) {
    const c = [];
    if (status) c.push(eq(S.projects.status, status));
    if (!includeDeleted) c.push(isNull(S.projects.deleted_at));
    return db.select({
      id: S.projects.id, project_no: S.projects.project_no, name: S.projects.name, status: S.projects.status, bid_date: S.projects.bid_date,
      rev: S.projects.rev, estimator_id: S.projects.estimator_id, region_id: S.projects.region_id, updated_at: S.projects.updated_at, deleted_at: S.projects.deleted_at,
    }).from(S.projects).where(c.length ? and(...c) : undefined).orderBy(desc(S.projects.updated_at));
  }

  async function setProjectStatusTx(t, id, status, note) {
    if (!S.PROJECT_STATUSES.includes(status)) throw new RepoError('INVALID', `bad project status ${status}`, 400);
    const before = await getRowTx(t, 'projects', id, { forUpdate: true });
    if (!before || before.deleted_at) throw notFound('project', id);
    if (before.status === status) return before;
    const [after] = await t.update(S.projects).set({ status, updated_at: now() }).where(eq(S.projects.id, id)).returning();
    await t.insert(S.project_status_history).values({ id: uuid(), project_id: id, from_status: before.status, to_status: status, changed_at: now(), changed_by: getContext().user_id, note: note ?? null });
    await log(t, { action: 'status_change', entity_type: 'projects', entity_id: id, project_id: id, before: { status: before.status }, after: { status, note: note ?? null } });
    return after;
  }
  const setProjectStatus = (id, status, { note } = {}) => tx((t) => setProjectStatusTx(t, id, status, note));
  const softDeleteProject = (id) => softDelete('projects', id);
  const restoreProject = (id) => restore('projects', id);

  /** Assign an employee to a project (role estimator also sets projects.estimator_id + line_items.estimator_id). */
  function assignEmployee(projectId, employeeId, role, extra = {}) {
    return tx(async (t) => {
      const row = await insertRow(t, 'project_assignments', { project_id: projectId, employee_id: employeeId, role, ...extra });
      if (role === 'estimator') await setEstimatorTx(t, projectId, employeeId);
      return row;
    });
  }

  // ------------------------------------------------------------------ rate snapshots / bid snapshots / outcomes
  /** Freeze the library rates this project references (item.rateRef) into project_rate_snapshots. */
  function snapshotRates(projectId, { refresh = false } = {}) {
    return tx(async (t) => {
      const refs = rowsOf(await t.execute(sql`select distinct rate_ref from line_item_costs where project_id = ${projectId} and rate_ref is not null`)).map((r) => r.rate_ref);
      if (!refs.length) return [];
      const rates = rowsOf(await t.execute(sql`
        select r.* from production_rates r join rate_library_versions v on v.id = r.version_id
        where r.deleted_at is null and v.deleted_at is null and v.is_current = true and r.rate_key in ${refs}
        order by r.rate_key, v.effective_from desc nulls last`));
      const seen = new Set();
      const rows = [];
      for (const r of rates) {
        if (seen.has(r.rate_key)) continue;
        seen.add(r.rate_key);
        rows.push({
          id: uuid(), project_id: projectId, rate_key: r.rate_key, source_rate_id: r.id, source_version_id: r.version_id, item_code: r.item_code,
          description: r.description, unit: r.unit, crew_name: r.crew_name, units_per_day: r.units_per_day == null ? null : Number(r.units_per_day),
          labor_rate_hr: r.labor_rate_hr == null ? null : Number(r.labor_rate_hr), equip_rate_hr: r.equip_rate_hr == null ? null : Number(r.equip_rate_hr),
          source_extra: r.extra, captured_at: now(),
        });
      }
      if (refresh) await t.delete(S.project_rate_snapshots).where(eq(S.project_rate_snapshots.project_id, projectId));
      if (rows.length) await t.insert(S.project_rate_snapshots).values(rows).onConflictDoNothing();
      await log(t, { action: 'create', entity_type: 'project_rate_snapshots', entity_id: projectId, project_id: projectId, after: { rate_keys: rows.map((r) => r.rate_key), refresh }, diff: null });
      return t.select().from(S.project_rate_snapshots).where(eq(S.project_rate_snapshots.project_id, projectId)).orderBy(asc(S.project_rate_snapshots.rate_key));
    });
  }

  /** Freeze direct cost / markup / totals (+ the full document) at submission. */
  function createBidSnapshot(projectId, { reason = 'submission', submitted_on = null } = {}) {
    return tx(async (t) => {
      const doc = await readDoc(t, projectId);
      if (!doc) throw notFound('project', projectId);
      const p = await getRowTx(t, 'projects', projectId);
      const lines = await t.select().from(S.line_items).where(eq(S.line_items.project_id, projectId));
      const secs = await t.select().from(S.bid_sections).where(eq(S.bid_sections.project_id, projectId)).orderBy(asc(S.bid_sections.sort_order));
      const tot = calc.projectTotals(doc);
      // direct cost = sum of the stored cent-rounded line totals (exactly what line_items.total_cost holds)
      const directCents = lines.reduce((a, l) => a + Math.round(Number(l.total_cost || 0) * 100), 0);
      const direct = directCents / 100;
      const mk = calc.applyMarkup(direct, doc.markupPct);
      const sections = secs.map((s) => ({
        sectionKey: s.section_key, name: s.name,
        total: lines.filter((l) => l.bid_section_id === s.id).reduce((a, l) => a + Math.round(Number(l.total_cost || 0) * 100), 0) / 100,
      }));
      return insertRow(t, 'bid_snapshots', {
        project_id: projectId, project_rev: p.rev, snapshot_at: now(), reason, submitted_on, estimator_id: p.estimator_id,
        labor_cost: r2(tot.labor), equip_cost: r2(tot.equip), material_cost: r2(tot.material), tax_cost: r2(tot.tax), sub_cost: r2(tot.sub),
        direct_cost: direct, markup_pct: mk.markupPct, markup_amount: mk.markup, bid_total: mk.total,
        sections_json: JSON.stringify(sections), document_json: JSON.stringify(doc), created_by: getContext().user_id,
      });
    });
  }

  /** Record (upsert) the bid outcome; copies totals from the snapshot and moves the project status. */
  function recordBidOutcome(projectId, o = {}) {
    const status = o.status || 'pending';
    if (!S.BID_OUTCOMES.includes(status)) throw new RepoError('INVALID', `bad outcome ${status}`, 400);
    return tx(async (t) => {
      let snap = null;
      if (o.bid_snapshot_id) snap = await getRowTx(t, 'bid_snapshots', o.bid_snapshot_id);
      else [snap] = await t.select().from(S.bid_snapshots).where(eq(S.bid_snapshots.project_id, projectId)).orderBy(desc(S.bid_snapshots.snapshot_at), desc(S.bid_snapshots.id)).limit(1);
      const values = {
        project_id: projectId, bid_snapshot_id: snap?.id ?? null, status,
        decision_date: o.decision_date ?? null, awarded_to_company_id: o.awarded_to_company_id ?? null, awarded_to_name: o.awarded_to_name ?? null,
        winning_amount: o.winning_amount ?? null, our_rank: o.our_rank ?? null, reason: o.reason ?? null, notes: o.notes ?? null,
        our_bid_total: snap ? (snap.bid_total == null ? null : Number(snap.bid_total)) : null,
        direct_cost: snap ? Number(snap.direct_cost) : null,
        markup_amount: snap?.markup_amount == null ? null : Number(snap.markup_amount),
        markup_pct: snap?.markup_pct == null ? null : Number(snap.markup_pct),
      };
      const [existing] = await t.select().from(S.bid_outcomes).where(eq(S.bid_outcomes.project_id, projectId));
      const row = existing
        ? await updateRowTx(t, 'bid_outcomes', existing.id, values, { action: 'status_change' })
        : await insertRow(t, 'bid_outcomes', values);
      await setProjectStatusTx(t, projectId, OUTCOME_TO_PROJECT_STATUS[status], `bid outcome: ${status}`);
      return row;
    });
  }

  function linkQuoteToProject(projectId, quoteId, { kind = 'vendor', note = null } = {}) {
    const [name, col] = kind === 'sub' ? ['project_sub_quotes', 'sub_quote_id'] : ['project_quotes', 'vendor_quote_id'];
    return tx(async (t) => {
      const tb = TABLES[name];
      const [ex] = await t.select().from(tb).where(and(eq(tb.project_id, projectId), eq(tb[col], quoteId)));
      if (ex) return ex;
      return insertRow(t, name, { project_id: projectId, [col]: quoteId, link_source: 'manual', note, linked_at: now() });
    });
  }

  // ------------------------------------------------------------------ files / exports / AI runs
  async function storeFileTx(t, f) {
    const kind = f.storage_kind || (f.object_key && !f.bytes ? 's3' : 'db');
    const bytes = f.bytes == null ? null : Buffer.from(f.bytes);
    const sha = f.sha256 || crypto.createHash('sha256').update(bytes || Buffer.alloc(0)).digest('hex');
    return insertRow(t, 'stored_files', {
      sha256: sha, mime: f.mime ?? null, size_bytes: f.size_bytes ?? (bytes ? bytes.length : 0), filename: f.filename ?? null,
      storage_kind: kind, bytes: kind === 'db' ? bytes : null, object_key: f.object_key ?? null, created_by: getContext().user_id,
    }).then(({ bytes: _b, ...meta }) => meta);
  }
  /** Store bytes in the DB (storage_kind db) or register an object-storage key (storage_kind s3). */
  const storeFile = (f) => tx((t) => storeFileTx(t, f));
  async function getFile(id) {
    const row = await get('stored_files', id);
    return row ? { ...row, bytes: row.bytes ? Buffer.from(row.bytes) : null } : null;
  }

  function recordExport(projectId, e) {
    return tx(async (t) => {
      const p = await getRowTx(t, 'projects', projectId);
      if (!p) throw notFound('project', projectId);
      const file = e.bytes || e.object_key ? await storeFileTx(t, { filename: e.filename, mime: e.mime, bytes: e.bytes, object_key: e.object_key }) : null;
      return insertRow(t, 'exports', {
        project_id: projectId, export_type: e.export_type || e.type, filename: e.filename ?? null, stored_file_id: file?.id ?? e.stored_file_id ?? null,
        project_rev: p.rev, created_by: getContext().user_id, notes: e.notes ?? null,
      }, { action: 'export' });
    });
  }

  function recordAiRun(projectId, r) {
    return tx(async (t) => {
      const promptHash = r.prompt_hash || (r.prompt ? crypto.createHash('sha256').update(r.prompt).digest('hex') : null);
      const run = await insertRow(t, 'ai_runs', {
        project_id: projectId, plan_sheet_id: r.plan_sheet_id ?? null, model: r.model ?? null, prompt_hash: promptHash,
        status: r.status || 'succeeded', started_at: r.started_at ?? now(), finished_at: r.finished_at ?? (r.status === 'running' ? null : now()),
        error: r.error ?? null, raw_result: r.raw_result == null ? null : typeof r.raw_result === 'string' ? r.raw_result : JSON.stringify(r.raw_result),
        input_tokens: r.input_tokens ?? null, output_tokens: r.output_tokens ?? null, created_by: getContext().user_id,
      }, { action: 'ai_run' });
      const results = (r.results || []).map((x, i) => ({
        id: uuid(), ai_run_id: run.id, project_id: projectId, sort_order: i,
        ...M.toRow(x, [['id', 'result_key', 's64'], ['description', 'description', 't'], ['qty', 'qty', 'n4'], ['unit', 'unit', 's20'], ['confidence', 'confidence', 'n6'], ['sheet', 'sheet', 't'], ['lineId', 'line_key', 's64']]),
      }));
      await insertMany(t, S.ai_run_results, results);
      return { ...run, results: results.length };
    });
  }
  const updateAiRun = (id, patch) => update('ai_runs', id, patch);

  // ------------------------------------------------------------------ job cost
  function addJobCostActual(projectId, a) {
    if (!S.COST_TYPES.includes(a.cost_type)) throw new RepoError('INVALID', `bad cost_type ${a.cost_type}`, 400);
    return tx(async (t) => {
      let costCodeId = a.cost_code_id ?? null;
      if (!costCodeId && a.cost_code) {
        const [cc] = await t.select().from(S.cost_codes).where(eq(S.cost_codes.code, a.cost_code));
        if (!cc) throw new RepoError('INVALID', `unknown cost code ${a.cost_code}`, 400);
        costCodeId = cc.id;
      }
      return insertRow(t, 'job_cost_actuals', {
        project_id: projectId, line_item_id: a.line_item_id ?? null, cost_code_id: costCodeId, cost_type: a.cost_type,
        qty: a.qty ?? null, unit: a.unit ?? null, amount: a.amount, cost_date: a.cost_date ?? null, source: a.source ?? 'manual',
        source_ref: a.source_ref ?? null, entered_by: a.entered_by ?? getContext().user_id, notes: a.notes ?? null,
      });
    });
  }

  // ------------------------------------------------------------------ employees
  const EMP_COLS = Object.keys(getTableColumns(S.employees)).filter((c) => !['id', 'created_at', 'updated_at', 'deleted_at', 'deleted_by'].includes(c));
  /** Upsert by id, then external_hr_id, then employee_no. Only provided keys are written. */
  function upsertEmployee(e) {
    return tx(async (t) => {
      let cur = null;
      if (e.id) cur = await getRowTx(t, 'employees', e.id);
      if (!cur && e.external_hr_id) [cur] = await t.select().from(S.employees).where(eq(S.employees.external_hr_id, e.external_hr_id));
      if (!cur && e.employee_no) [cur] = await t.select().from(S.employees).where(eq(S.employees.employee_no, e.employee_no));
      const vals = {};
      for (const c of EMP_COLS) if (e[c] !== undefined) vals[c] = e[c];
      if (!cur) return insertRow(t, 'employees', { id: e.id, ...vals });
      if (!Object.keys(vals).length || Object.entries(vals).every(([k, v]) => cur[k] === v)) return cur;
      return updateRowTx(t, 'employees', cur.id, vals);
    });
  }
  const addCertification = (employeeId, c) => insert('employee_certifications', { employee_id: employeeId, ...c });
  const addCrewMember = (crewId, employeeId, m = {}) => insert('crew_members', { crew_id: crewId, employee_id: employeeId, ...m });

  /** Login audit: stamps users.last_login_at and logs action 'login'. */
  function recordLogin(userId) {
    return tx(async (t) => {
      await t.update(S.users).set({ last_login_at: now() }).where(eq(S.users.id, userId));
      await log(t, { action: 'login', entity_type: 'users', entity_id: userId, diff: null });
    });
  }

  // ------------------------------------------------------------------ library (company-wide)
  const LIB = {
    rates: { table: 'production_rates', spec: M.SPEC.rate },
    crews: { table: 'crews', spec: M.SPEC.crew },
    quotes: { table: 'vendor_quotes', spec: M.SPEC.quote },
    fdot: { table: 'fdot_reference_prices', spec: M.SPEC.fdot },
  };
  async function currentVersionId(t, libraryName) {
    const r = rowsOf(await t.execute(sql`select v.id from rate_library_versions v join rate_libraries l on l.id = v.rate_library_id
      where v.is_current = true and v.deleted_at is null and l.deleted_at is null ${libraryName ? sql`and l.name = ${libraryName}` : sql``}
      order by v.effective_from desc nulls last, v.created_at desc limit 1`));
    return r[0]?.id ?? null;
  }
  function libRow(kind, obj, ctx) {
    const { spec } = LIB[kind];
    if (kind === 'rates') {
      return { id: M.cid(ctx.versionId, obj.id), version_id: ctx.versionId, sort_order: ctx.sort ?? 0, ...M.toRow(obj, spec), crew_id: ctx.crewIdByName?.get(obj.crew) ?? null };
    }
    if (kind === 'quotes') return { id: obj.id, sort_order: ctx.sort ?? 0, ...M.toRow(obj, spec, { items: M.isObjArray }) };
    return { id: obj.id, sort_order: ctx.sort ?? 0, ...M.toRow(obj, spec) };
  }
  async function writeQuoteLines(t, quoteId, items) {
    await t.delete(S.vendor_quote_lines).where(eq(S.vendor_quote_lines.quote_id, quoteId));
    if (M.isObjArray(items)) await insertMany(t, S.vendor_quote_lines, items.map((it, i) => ({ id: M.cid(quoteId, it.id ?? `#${i}`), quote_id: quoteId, sort_order: i, ...M.toRow(it, M.SPEC.quoteLine) })));
  }
  /**
   * Create or replace a library item from its app JSON shape. kind: rates | crews | quotes | fdot.
   * opts.versionId (rates) defaults to the current version (opts.libraryName narrows it).
   */
  function upsertLibraryItem(kind, obj, opts = {}) {
    if (!LIB[kind]) throw new RepoError('INVALID', `bad library kind ${kind}`, 400);
    if (!obj || !obj.id) throw new RepoError('INVALID', 'library item needs id', 400);
    return tx(async (t) => {
      const versionId = kind === 'rates' ? opts.versionId || (await currentVersionId(t, opts.libraryName)) : null;
      if (kind === 'rates' && !versionId) throw new RepoError('INVALID', 'no current rate library version', 400);
      const crews = kind === 'rates' ? await t.select({ id: S.crews.id, name: S.crews.name }).from(S.crews) : [];
      const row = libRow(kind, obj, { versionId, sort: opts.sort, crewIdByName: new Map(crews.map((c) => [c.name, c.id])) });
      const name = LIB[kind].table;
      const before = await getRowTx(t, name, row.id);
      let saved;
      if (!before) saved = await insertRow(t, name, row);
      else {
        if (opts.sort === undefined) delete row.sort_order;
        saved = await updateRowTx(t, name, row.id, { ...row, deleted_at: null, deleted_by: null });
      }
      if (kind === 'quotes') await writeQuoteLines(t, saved.id, obj.items);
      return saved;
    });
  }
  async function readLibraryItem(t, kind, row) {
    const { spec } = LIB[kind];
    if (kind !== 'quotes') return M.fromRow(row, spec);
    const lines = await t.select().from(S.vendor_quote_lines).where(eq(S.vendor_quote_lines.quote_id, row.id)).orderBy(asc(S.vendor_quote_lines.sort_order));
    return M.fromRow(row, spec, { items: lines.map((l) => M.fromRow(l, M.SPEC.quoteLine)) });
  }
  /** Library item by app key (rates: in the current version). */
  async function getLibraryItem(kind, key, opts = {}) {
    if (!LIB[kind]) throw new RepoError('INVALID', `bad library kind ${kind}`, 400);
    const id = kind === 'rates' ? M.cid(opts.versionId || (await currentVersionId(db, opts.libraryName)), key) : key;
    const row = await get(LIB[kind].table, id);
    return row ? readLibraryItem(db, kind, row) : null;
  }
  /** Merge a patch (app JSON keys) into a library item. */
  async function updateLibraryItem(kind, key, patch, opts = {}) {
    const cur = await getLibraryItem(kind, key, opts);
    if (!cur) throw notFound(kind, key);
    return upsertLibraryItem(kind, { ...cur, ...patch, id: key }, opts);
  }
  async function deleteLibraryItem(kind, key, opts = {}) {
    const id = kind === 'rates' ? M.cid(opts.versionId || (await currentVersionId(db, opts.libraryName)), key) : key;
    return softDelete(LIB[kind].table, id);
  }
  async function listLibrary(kind, opts = {}) {
    const name = LIB[kind].table;
    let rows;
    if (kind === 'rates') {
      const vid = opts.versionId || (await currentVersionId(db, opts.libraryName));
      rows = await list(name, { version_id: vid });
    } else rows = await list(name);
    const out = [];
    for (const r of rows) out.push(await readLibraryItem(db, kind, r));
    return out;
  }
  /** The whole library in the old app's library.json shape. */
  async function getLibrary(opts = {}) {
    const [s] = await db.select().from(S.app_settings).where(eq(S.app_settings.setting_key, 'library.settings'));
    const [seeded] = await db.select().from(S.app_settings).where(eq(S.app_settings.setting_key, 'library.seeded'));
    const out = { settings: s ? JSON.parse(s.setting_value) : {} };
    for (const k of ['rates', 'crews', 'quotes', 'fdot']) out[k] = await listLibrary(k, opts);
    if (seeded) out.seeded = JSON.parse(seeded.setting_value);
    return out;
  }
  function setSetting(key, value) {
    return tx(async (t) => {
      const [before] = await t.select().from(S.app_settings).where(eq(S.app_settings.setting_key, key));
      const v = JSON.stringify(value);
      if (before) await t.update(S.app_settings).set({ setting_value: v, updated_at: now() }).where(eq(S.app_settings.setting_key, key));
      else await t.insert(S.app_settings).values({ setting_key: key, setting_value: v, updated_at: now() });
      await log(t, { action: before ? 'update' : 'create', entity_type: 'app_settings', entity_id: key, before: before ? { value: before.setting_value } : null, after: { value: v } });
    });
  }

  // ------------------------------------------------------------------ reporting
  const viewCols = new Map();
  async function columnsOf(view) {
    if (!viewCols.has(view)) {
      const r = await handle.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [view]);
      viewCols.set(view, new Set(r.map((x) => x.column_name)));
    }
    return viewCols.get(view);
  }
  /**
   * repo.report('v_employee_win_rate', { employee_id: 'x' })
   * filters: { col: value } or { col: { op: '<=', value } }; opts: { orderBy: 'col', desc: true, limit: 100 }
   */
  async function report(viewName, filters = {}, opts = {}) {
    if (!REPORT_VIEWS.includes(viewName)) throw new RepoError('INVALID', `view ${viewName} is not reportable`, 400);
    const cols = await columnsOf(viewName);
    const where = [];
    const params = [];
    for (const [k, f] of Object.entries(filters)) {
      if (!cols.has(k)) throw new RepoError('INVALID', `unknown column ${k}`, 400);
      const { op, value } = f !== null && typeof f === 'object' ? f : { op: '=', value: f };
      if (!REPORT_OPS.includes(op)) throw new RepoError('INVALID', `bad op ${op}`, 400);
      if (value === null) where.push(`"${k}" is ${op === '<>' ? 'not ' : ''}null`);
      else { params.push(value); where.push(`"${k}" ${op} $${params.length}`); }
    }
    let q = `select * from ${viewName}${where.length ? ` where ${where.join(' and ')}` : ''}`;
    if (opts.orderBy) {
      if (!cols.has(opts.orderBy)) throw new RepoError('INVALID', `unknown column ${opts.orderBy}`, 400);
      q += ` order by "${opts.orderBy}"${opts.desc ? ' desc' : ''}`;
    }
    if (opts.limit) q += ` limit ${Math.max(1, Math.min(10000, Number(opts.limit) | 0))}`;
    return handle.query(q, params);
  }

  /** Activity rows (newest first). */
  function activity({ project_id, entity_type, entity_id, request_id, limit = 200 } = {}) {
    const A = S.activity_log;
    const c = [];
    if (project_id) c.push(eq(A.project_id, project_id));
    if (entity_type) c.push(eq(A.entity_type, entity_type));
    if (entity_id) c.push(eq(A.entity_id, entity_id));
    if (request_id) c.push(eq(A.request_id, request_id));
    return db.select().from(A).where(c.length ? and(...c) : undefined).orderBy(desc(A.occurred_at)).limit(limit);
  }

  const studio = addStudioApi({
    tx, insertRow, updateRowTx, getRowTx, storeFileTx, handle, uuid, now, notFound, RepoError,
  });

  return {
    handle, db, close: () => handle.close(),
    ...studio,
    // generic
    insert, update, softDelete, restore, get, list,
    // projects
    createProject, saveProject, importProject, getProject, listProjects, setProjectStatus, softDeleteProject, restoreProject, assignEmployee,
    snapshotRates, createBidSnapshot, recordBidOutcome, linkQuoteToProject,
    // files / exports / ai
    storeFile, getFile, recordExport, recordAiRun, updateAiRun,
    // job cost / employees / users
    addJobCostActual, upsertEmployee, addCertification, addCrewMember, recordLogin,
    // library
    upsertLibraryItem, updateLibraryItem, deleteLibraryItem, getLibraryItem, listLibrary, getLibrary, setSetting, currentVersionId: () => currentVersionId(db),
    // reporting
    report, activity, REPORT_VIEWS,
  };
}

module.exports = { createRepo, RepoError, REPORT_VIEWS };
