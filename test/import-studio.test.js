'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { freshRepo, n } = require('./helpers');
const { importStudio } = require('../db/import-studio');
const { STUDIO_JOBS } = require('../db/studio-catalog');
const { runWithContext } = require('../db/context');

const root = path.join(__dirname, '..');

test('studio catalog covers every shipped job file once', () => {
  const files = STUDIO_JOBS.map((j) => j.file).sort();
  assert.deepEqual(files, ['alamo_alt.json', 'alamo_base.json', 'bucees.json', 'data.json', 'dunant.json', 'innovation.json', 'innovation_p2.json', 'innovation_p3.json', 'va.json']);
  const projects = new Set(STUDIO_JOBS.map((j) => j.projectId));
  assert.equal(projects.size, 6); // sample Buc-ee's plus five new projects
  assert.equal(STUDIO_JOBS.filter((j) => j.projectId === 'proj-alamo-church-p7').length, 2);
  assert.equal(STUDIO_JOBS.filter((j) => j.projectId === 'proj-innovation-b2').length, 3);
});

test('import is idempotent and does not move the Buc-ee\'s sample tie-out', { timeout: 300000 }, async () => {
  const repo = await freshRepo({ withSeed: true });
  try {
    const first = await runWithContext({ request_id: 'import-1', employee_id: 'emp-clay' }, () => importStudio(repo, { root }));
    assert.equal(first.length, 9);
    assert.equal(first.filter((r) => r.skipped).length, 0);
    const before = await repo.handle.query('select count(*)::int n from activity_log');
    const second = await runWithContext({ request_id: 'import-2' }, () => importStudio(repo, { root }));
    assert.equal(second.every((r) => r.skipped), true);
    const after = await repo.handle.query('select count(*)::int n from activity_log');
    assert.equal(after[0].n, before[0].n);

    const projects = await repo.handle.query('select id, name from projects where deleted_at is null order by id');
    assert.equal(projects.length, 6);
    const names = Object.fromEntries(projects.map((p) => [p.id, p.name]));
    assert.equal(names['proj-brooks-820'], 'Building 820 Parking Lot - Brooks City Base');
    assert.equal(names['proj-alamo-church-p7'], 'Alamo Church Phase 7');
    assert.equal(names['proj-innovation-b2'], 'Innovation Building #2 - Innovation Industrial Park');
    assert.match(names['proj-dunant'], /Dunant/);
    assert.match(names.ce08cc827c, /Buc-ee/);

    const versions = await repo.handle.query('select project_id, scenario_key, scenario_role from ew_versions where deleted_at is null order by sort_order');
    assert.equal(versions.length, 9);
    assert.deepEqual(versions.filter((v) => v.project_id === 'proj-alamo-church-p7').map((v) => v.scenario_role), ['base', 'alternate']);
    assert.equal(versions.filter((v) => v.project_id === 'proj-innovation-b2').length, 3);

    const [bal] = await repo.handle.query("select cut_cy, fill_cy, import_cy, balance_cy from ew_balance where version_id = 'ew-bucees' and source = 'file_reference'");
    assert.equal(n(bal.cut_cy), 3350);
    assert.equal(n(bal.fill_cy), 255296);
    assert.equal(n(bal.balance_cy), -251946);
    assert.equal(n(bal.import_cy), 251946);

    const [sample] = await repo.handle.query("select sum(total_cost) t from line_items where project_id = 'ce08cc827c'");
    assert.equal(n(sample.t), 18405662.10);
    const snaps = await repo.handle.query("select count(*)::int n from bid_snapshots where project_id = 'ce08cc827c'");
    assert.equal(snaps[0].n, 1);
    const outcomes = await repo.handle.query('select project_id, status from bid_outcomes');
    assert.deepEqual(outcomes, [{ project_id: 'ce08cc827c', status: 'pending' }]);

    const [aerial] = await repo.handle.query("select aerial_file_id, grading_file_id from ew_versions where id = 'ew-bucees'");
    assert.ok(aerial.aerial_file_id);
    assert.equal(aerial.grading_file_id, null);
    const [bytes] = await repo.handle.query('select size_bytes from stored_files where id = $1', [aerial.aerial_file_id]);
    assert.ok(Number(bytes.size_bytes) > 100000);

    const [alamoQty] = await repo.handle.query("select count(*)::int n from ew_balance where version_id = 'ew-alamo-base'");
    assert.equal(alamoQty.n, 0);
    const [areas] = await repo.handle.query("select count(*)::int n from ew_areas where version_id = 'ew-va' and section_in = 126");
    assert.equal(areas.n, 1);
    const [emps] = await repo.handle.query('select count(*)::int n from employees');
    assert.equal(emps.n, 5);
  } finally {
    await repo.close();
  }
});
