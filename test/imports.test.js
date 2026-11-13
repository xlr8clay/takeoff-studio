'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freshRepo, miniDoc, n } = require('./helpers');
const { importEmployeesCsv } = require('../db/import-employees');
const { importJobCostsCsv } = require('../db/import-job-costs');
const { importFiles } = require('../db/import-project');
const { parseCsv } = require('../db/csv');
const { isLocalUrl } = require('../db/reset');

let repo;
test.before(async () => { repo = await freshRepo({ withSeed: true }); });
test.after(() => repo.close());

test('CSV parser handles quotes, commas and CRLF', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n'), [{ a: 'x, y', b: 'he said "hi"' }]);
});

test('import-employees: fixture upserts, re-import is a no-op, bad row reported', async () => {
  const csv = fs.readFileSync(path.join(__dirname, 'fixtures/hr-employees.sample.csv'), 'utf8');
  const r1 = await importEmployeesCsv(repo, csv);
  assert.equal(r1.inserted, 2);
  assert.equal(r1.errors.length, 1);
  const r2 = await importEmployeesCsv(repo, csv);
  assert.deepEqual([r2.inserted, r2.updated, r2.unchanged], [0, 0, 2]);
  const [e] = await repo.list('employees', { external_hr_id: 'TEST-HR-002' });
  assert.equal(e.status, 'active');
  assert.equal(e.notes, 'fixture row, quoted comma');
  const r3 = await importEmployeesCsv(repo, 'external_hr_id,department\nTEST-HR-002,Shop\n');
  assert.equal(r3.updated, 1);
  const [e2] = await repo.list('employees', { external_hr_id: 'TEST-HR-002' });
  assert.equal(e2.department, 'Shop');
  assert.equal(e2.first_name, 'Test'); // blanks/missing never overwrite
});

test('import-job-costs: fixture inserts valid rows, skips duplicates, reports bad rows', async () => {
  await repo.createProject(miniDoc('jc-1', { projectNo: 'TEST-JC-1' }));
  const csv = fs.readFileSync(path.join(__dirname, 'fixtures/job-costs.sample.csv'), 'utf8');
  const r1 = await importJobCostsCsv(repo, csv);
  assert.equal(r1.inserted, 2);
  assert.equal(r1.errors.length, 2);
  const r2 = await importJobCostsCsv(repo, csv);
  assert.equal(r2.inserted, 0);
  assert.equal(r2.skipped, 2);
  const rows = await repo.list('job_cost_actuals', { project_id: 'jc-1' });
  assert.equal(rows.reduce((a, r) => a + n(r.amount), 0), 1750.5);
  assert.ok(rows.find((r) => r.source_ref === 'FIX-1').line_item_id);
});

test('db:import-project imports a per-job JSON file and re-import bumps rev', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'job-')), 'job.json');
  const doc = miniDoc('file-job-1', { someLegacyField: [1, { x: 'y' }] });
  fs.writeFileSync(f, JSON.stringify(doc));
  const [r1] = await importFiles(repo, [f], { estimatorId: 'emp-clay', regionCode: 'TX-HEB' });
  assert.equal(r1.rev, 1);
  assert.deepStrictEqual(await repo.getProject('file-job-1'), doc);
  const [r2] = await importFiles(repo, [f]);
  assert.equal(r2.rev, 2);
});

test('db:reset refuses non-localhost DATABASE_URL', () => {
  assert.equal(isLocalUrl('postgresql://u:p@localhost:5432/db'), true);
  assert.equal(isLocalUrl('postgresql://u:p@127.0.0.1/db'), true);
  assert.equal(isLocalUrl('postgresql://u:p@dpg-xyz.oregon-postgres.render.com/db'), false);
});
