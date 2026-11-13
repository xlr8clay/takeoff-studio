'use strict';
/**
 * Job-cost CSV -> job_cost_actuals. STUB for accounting/field exports.
 * Columns: project_id | project_no, cost_code, cost_type (labor|equipment|material|sub|trucking|other), qty, unit,
 *          amount, cost_date (YYYY-MM-DD), source_ref, line_key (optional, old-app line id), notes
 * Rows whose (project, source='csv', source_ref) already exist are skipped, so re-importing a file is safe.
 *   node db/import-job-costs.js path/to/costs.csv
 */
const fs = require('node:fs');
const { parseCsv, blankToNull } = require('./csv');

async function importJobCostsCsv(repo, text) {
  const out = { inserted: 0, skipped: 0, errors: [] };
  const rows = parseCsv(text);
  for (const [i, r] of rows.entries()) {
    try {
      let projectId = blankToNull(r.project_id);
      if (!projectId && r.project_no) {
        const [p] = await repo.list('projects', { project_no: r.project_no });
        if (!p) throw new Error(`unknown project_no ${r.project_no}`);
        projectId = p.id;
      }
      if (!projectId) throw new Error('project_id or project_no required');
      const sourceRef = blankToNull(r.source_ref);
      if (sourceRef) {
        const dup = await repo.list('job_cost_actuals', { project_id: projectId, source: 'csv', source_ref: sourceRef });
        if (dup.length) { out.skipped++; continue; }
      }
      let lineItemId = null;
      if (r.line_key) {
        const [li] = await repo.list('line_items', { project_id: projectId, line_key: r.line_key });
        lineItemId = li?.id ?? null;
      }
      const amount = Number(r.amount);
      if (!Number.isFinite(amount)) throw new Error(`bad amount ${r.amount}`);
      await repo.addJobCostActual(projectId, {
        cost_code: blankToNull(r.cost_code), cost_type: (r.cost_type || '').toLowerCase(), qty: r.qty ? Number(r.qty) : null,
        unit: blankToNull(r.unit), amount, cost_date: blankToNull(r.cost_date), source: 'csv', source_ref: sourceRef,
        line_item_id: lineItemId, notes: blankToNull(r.notes),
      });
      out.inserted++;
    } catch (err) {
      out.errors.push({ row: i + 2, error: err.message });
    }
  }
  return out;
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node db/import-job-costs.js <file.csv>'); process.exit(2); }
  (async () => {
    const { openDb } = require('./client');
    const { createRepo } = require('./repo');
    const { runWithContext } = require('./context');
    const h = await openDb();
    try {
      const res = await runWithContext({ request_id: `jobcost-import-${Date.now()}` }, () => importJobCostsCsv(createRepo(h), fs.readFileSync(file, 'utf8')));
      console.log(res);
    } finally { await h.close(); }
  })().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { importJobCostsCsv };
