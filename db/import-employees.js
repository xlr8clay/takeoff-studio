'use strict';
/**
 * HR CSV -> employees (upsert). STUB: maps the documented columns (docs/HR_IMPORT.md); extend as the HR export
 * format becomes known. Match order: external_hr_id, then employee_no. Blank cells never overwrite existing data.
 *   node db/import-employees.js path/to/hr.csv
 */
const fs = require('node:fs');
const { parseCsv, blankToNull } = require('./csv');

const COLUMNS = ['external_hr_id', 'employee_no', 'first_name', 'last_name', 'display_name', 'title_role', 'department', 'phone',
  'email', 'hire_date', 'status', 'home_yard_or_office', 'emergency_contact_name', 'emergency_contact_phone', 'notes'];

async function importEmployeesCsv(repo, text) {
  const out = { inserted: 0, updated: 0, unchanged: 0, errors: [] };
  const rows = parseCsv(text);
  for (const [i, r] of rows.entries()) {
    const e = {};
    for (const c of COLUMNS) { const v = blankToNull(r[c]); if (v !== null) e[c] = c === 'status' || c === 'title_role' ? v.toLowerCase() : v; }
    if (!e.external_hr_id && !e.employee_no) { out.errors.push({ row: i + 2, error: 'external_hr_id or employee_no required' }); continue; }
    try {
      const before = await findExisting(repo, e);
      const saved = await repo.upsertEmployee(e);
      if (!before) out.inserted++;
      else if (saved.updated_at !== before.updated_at) out.updated++;
      else out.unchanged++;
    } catch (err) {
      out.errors.push({ row: i + 2, error: err.message });
    }
  }
  return out;
}

async function findExisting(repo, e) {
  if (e.external_hr_id) { const [x] = await repo.list('employees', { external_hr_id: e.external_hr_id }, { includeDeleted: true }); if (x) return x; }
  if (e.employee_no) { const [x] = await repo.list('employees', { employee_no: e.employee_no }, { includeDeleted: true }); if (x) return x; }
  return null;
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node db/import-employees.js <file.csv>'); process.exit(2); }
  (async () => {
    const { openDb } = require('./client');
    const { createRepo } = require('./repo');
    const { runWithContext } = require('./context');
    const h = await openDb();
    try {
      const res = await runWithContext({ request_id: `hr-import-${Date.now()}` }, () => importEmployeesCsv(createRepo(h), fs.readFileSync(file, 'utf8')));
      console.log(res);
    } finally { await h.close(); }
  })().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { importEmployeesCsv, COLUMNS };
