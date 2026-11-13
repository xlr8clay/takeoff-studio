'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshRepo, n } = require('./helpers');
const { seed, STANDARD_EXCLUSIONS, STANDARD_NOTES } = require('../db/seed');
const BUCEES = require('../db/seed-data/bucees-49.project.json');
const LIBRARY = require('../db/seed-data/library.json');

let repo, q;
test.before(async () => { repo = await freshRepo({ withSeed: true }); q = repo.handle.query; });
test.after(() => repo.close());

const count = async (sqlText) => Number((await q(sqlText))[0].n);

test('fresh migrate: all tables and views exist', async () => {
  assert.equal(await count("select count(*) n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"), 61);
  const views = (await q("select table_name from information_schema.views where table_schema='public'")).map((r) => r.table_name);
  for (const v of repo.REPORT_VIEWS) assert.ok(views.includes(v), v);
});

test('seed counts', async () => {
  assert.equal(await count('select count(*) n from production_rates'), 81);
  assert.equal(await count('select count(*) n from crews'), 12);
  assert.equal(await count('select count(*) n from vendor_quotes'), 22);
  assert.equal(await count('select count(*) n from fdot_reference_prices'), 89);
  assert.equal(await count('select count(*) n from note_templates'), 3);
  assert.equal(await count('select count(*) n from exclusion_templates'), 13);
  assert.equal(await count('select count(*) n from roles'), 3);
  assert.deepEqual((await q('select body from note_templates order by sort_order')).map((r) => r.body), STANDARD_NOTES);
  assert.deepEqual((await q('select body from exclusion_templates order by sort_order')).map((r) => r.body), STANDARD_EXCLUSIONS);
  const [co] = await q("select * from companies where company_type='self'");
  assert.equal(co.name, 'WPM Construction');
  assert.equal(co.address1, '5415 McKinney Falls Pkwy.');
  assert.equal(co.email, 'cdeering@wpmcivil.com');
  const regions = (await q('select code from regions order by code')).map((r) => r.code);
  assert.deepEqual(regions, ['FDOT-MA10', 'FL-SWFL', 'TX-HEB']);
  const [ver] = await q('select v.*, r.code from rate_library_versions v join regions r on r.id = v.region_id');
  assert.equal(ver.code, 'TX-HEB');
});

test('exactly five employees; only Clay has title/contact', async () => {
  const emps = await q('select * from employees order by first_name');
  assert.deepEqual(emps.map((e) => e.first_name), ['Charles', 'Clay', 'Darren', 'Joe', 'Zach']);
  for (const e of emps) {
    const filled = Object.entries(e).filter(([k, v]) => v !== null && !['id', 'first_name', 'created_at', 'updated_at'].includes(k)).map(([k]) => k);
    if (e.first_name === 'Clay') {
      assert.equal(e.last_name, 'Deering');
      assert.equal(e.title_role, 'estimator');
      assert.equal(e.phone, '830-499-3860');
      assert.equal(e.email, 'cdeering@wpmcivil.com');
    } else {
      assert.deepEqual(filled, [], `${e.first_name} must have only a first name`);
    }
  }
});

test("Buc-ee's #49 direct cost ties to 18405662.10 (lines, sections, snapshot)", async () => {
  const [s] = await q(`select sum(total_cost) total, count(*) n from line_items where project_id = '${BUCEES.id}'`);
  assert.equal(n(s.total), 18405662.10);
  assert.equal(Number(s.n), BUCEES.lines.length);
  assert.equal(BUCEES.sampleTieOut.appDirectCost, 18405662.10);
  // per section: item-level costs (4 dp) and cent-rounded line totals
  const secs = await q(`select b.name, count(l.id) lines, coalesce(sum(l.total_cost), 0) total,
      coalesce((select sum(c.total_cost) from line_item_costs c join line_items l2 on l2.id = c.line_item_id where l2.bid_section_id = b.id), 0) item_total
    from bid_sections b left join line_items l on l.bid_section_id = b.id
    where b.project_id = '${BUCEES.id}' group by b.id, b.name, b.sort_order order by b.sort_order`);
  assert.equal(secs.length, 22);
  const checks = BUCEES.sampleTieOut.sectionChecks;
  assert.equal(checks.length, 22);
  for (const c of checks) {
    const row = secs.find((r) => r.name === c.section);
    assert.ok(row, c.section);
    assert.equal(Math.round(n(row.item_total) * 100) / 100, c.app, `${c.section}: items ${row.item_total} vs ${c.app}`);
    // stored line totals are cent-rounded, so a section can differ by at most half a cent per line
    assert.ok(Math.abs(n(row.total) - c.app) <= 0.005 * Number(row.lines) + 1e-9, `${c.section}: ${row.total} vs ${c.app}`);
    if (c.workbook !== null) assert.ok(Math.abs(c.workbook - c.app) < 0.01);
  }
  const [snap] = await q(`select * from bid_snapshots where project_id = '${BUCEES.id}'`);
  assert.equal(n(snap.direct_cost), 18405662.10);
  assert.equal(snap.markup_amount, null);
  assert.equal(JSON.parse(snap.sections_json).reduce((a, x) => a + Math.round(x.total * 100), 0), 1840566210);
  const [cost] = await q(`select sum(total_cost) t from line_item_costs where project_id = '${BUCEES.id}'`);
  assert.ok(Math.abs(n(cost.t) - 18405662.10) < 0.01);
});

test("Buc-ee's: Clay is estimator, outcome pending with nulls", async () => {
  const a = await q(`select * from project_assignments where project_id = '${BUCEES.id}'`);
  assert.deepEqual(a.map((x) => [x.employee_id, x.role]), [['emp-clay', 'estimator']]);
  const [o] = await q(`select * from bid_outcomes where project_id = '${BUCEES.id}'`);
  assert.equal(o.status, 'pending');
  for (const k of ['decision_date', 'awarded_to_company_id', 'awarded_to_name', 'winning_amount', 'our_bid_total', 'markup_amount']) assert.equal(o[k], null, k);
  assert.equal(n(o.direct_cost), 18405662.10);
  const [li] = await q(`select count(*) n from line_items where project_id = '${BUCEES.id}' and estimator_id = 'emp-clay'`);
  assert.equal(Number(li.n), BUCEES.lines.length);
});

test('project JSON round-trip is lossless; library round-trip is lossless', async () => {
  assert.deepStrictEqual(await repo.getProject(BUCEES.id), BUCEES);
  assert.deepStrictEqual(await repo.getLibrary(), LIBRARY);
});

test('seed is idempotent', async () => {
  const before = await count('select count(*) n from activity_log');
  await seed(repo);
  assert.equal(await count('select count(*) n from employees'), 5);
  assert.equal(await count('select count(*) n from production_rates'), 81);
  assert.equal(await count('select count(*) n from projects'), 1);
  assert.equal(await count('select count(*) n from activity_log'), before);
});
