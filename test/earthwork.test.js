'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { earthworkFacts } = require('../db/earthwork-facts');
const { freshRepo, n } = require('./helpers');
const { runWithContext } = require('../db/context');

const root = path.join(__dirname, '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));

test('Buc-ee\'s file mass balance is the stated reference, not a derived price', () => {
  const f = earthworkFacts(read('bucees.json'));
  assert.equal(f.balance.cut_cy, 3350);
  assert.equal(f.balance.fill_cy, 255296);
  assert.equal(f.balance.strip_cy, 24028);
  assert.equal(f.balance.balance_cy, -251946);
  assert.equal(f.balance.import_cy, 251946);
  assert.equal(f.balance.export_cy, 0);
  assert.equal(f.balance.fill_bank_cy, 255296);
  assert.equal(f.strip_in, 6);
  assert.equal(f.shrink_pct, 0);
  assert.equal(f.swell_pct, 0);
  assert.equal(f.areas.length, 4);
  assert.equal(f.areas[0].section_in, 13);
});

test('Brooks City Base is data.json and keeps unknown import fields null when absent', () => {
  const doc = read('data.json');
  assert.equal(doc.name, 'Building 820 Parking Lot - Brooks City Base');
  const f = earthworkFacts(doc);
  assert.equal(f.balance.cut_cy, 1310);
  assert.equal(f.balance.fill_cy, 2103);
  assert.equal(f.balance.balance_cy, -793);
  assert.equal(f.balance.import_cy, 793);
  assert.equal(f.balance.loose_cy, null);
});

test('Alamo has factors and subgrade depth and no invented quantities', () => {
  const f = earthworkFacts(read('alamo_base.json'));
  assert.equal(f.balance, null);
  assert.equal(f.strip_in, 0);
  assert.equal(f.shrink_pct, 0);
  assert.equal(f.areas.length, 1);
  assert.equal(f.areas[0].section_in, 16);
  assert.ok(f.flags.some((x) => /not in this file/.test(x)));
});

test('Innovation keeps both model quantities and does not turn them into a bid', () => {
  const f = earthworkFacts(read('innovation.json'));
  assert.equal(f.balance.cut_cy, 293439);
  assert.equal(f.balance.fill_cy, 375791);
  assert.equal(f.balance.import_cy, null);
  assert.equal(f.balance.export_cy, null);
  assert.equal(f.balance.extra.eng_cut_cy, 302022);
  assert.equal(f.balance.extra.eng_fill_cy, 377238);
  assert.equal(f.balance.select_fill_cy, 309995);
  assert.deepEqual(f.phase_names, ['Phase 2 (Buildings 1-3)', 'Phase 3 (Buildings 4-7)']);
});

test('VA building pad subgrade depth is the file value', () => {
  const f = earthworkFacts(read('va.json'));
  const pad = f.areas.find((a) => a.area_type === 'building_pad');
  assert.equal(pad.section_in, 126);
  assert.equal(pad.finish_elev, 656.5);
  assert.equal(f.balance, null);
});

test('studio save is audited, locked by rev, and survives soft delete', async () => {
  const repo = await freshRepo({ withSeed: true });
  try {
    const doc = {
      name: 'Tiny pad', frame: 'test', cell: 10, nx: 2, ny: 2, x0: 0, y0: 0, zbase: 0,
      eg: 'AAAA', fg: 'AAAA', reg: 'AAAA', dist10: 'AAAA', near: 'AAAA',
      regions: [{ name: 'Pad', type: 'building_pad', section_in: 6, rings: [] }],
      limits: [], spec: { strip_in: 4, shrink_pct: 0, swell_pct: 0, source: 'test' }, basis: [],
    };
    const job = {
      key: 'tiny', file: 'tiny.json', projectId: 'proj-tiny', projectName: 'Tiny pad', location: null,
      versionId: 'ew-tiny', scenarioKey: 'tiny', scenarioRole: 'site', sort: 0,
      aerial: null, grading: null, projectFlags: ['estimator unknown'], extraFlags: [],
    };
    await runWithContext({ employee_id: 'emp-clay', user_id: 'user-test', request_id: 't1' }, async () => {
      const imported = await repo.importStudioVersion(job, { gridBytes: Buffer.from(JSON.stringify(doc)) });
      assert.equal(imported.skipped, false);
      const again = await repo.importStudioVersion(job, { gridBytes: Buffer.from(JSON.stringify(doc)) });
      assert.equal(again.skipped, true);
      const saved = await repo.saveStudioState('ew-tiny', {
        rev: 1,
        factors: { strip: 4, shrink: 10, swell: 15, moist: 6, overbuild: 1, dz: 0.25, sec: [8] },
        balance: { cut_cy: 10, fill_cy: 4, fill_bank_cy: 4.4444, balance_cy: 5.5556, import_cy: 0, export_cy: 5.5556, strip_cy: 1, loose_cy: 6.3889, area_sy: 100, moist_sy: 40, shrink_pct: 10, swell_pct: 15 },
        grading: [{ name: 'Pad', sy: 100, section_label: '8', strip_cy: 1, cut_cy: 10, fill_cy: 4, avg_cut_ft: 0.5, avg_fill_ft: 0.2, moist_sy: 40 }],
        bid: { items: { cut: { mat: 12 } }, custom: [], trucks: [{ desc: 'Export excess', src: 'export', per: 14, rate: 100 }] },
        touched: true,
        directCost: 500,
        bidTotal: 550,
        snapshot: true,
        markupPct: 0,
      }, { expectedRev: 1 });
      assert.equal(saved.rev, 2);
      assert.ok(saved.snapshotId);
      await assert.rejects(() => repo.saveStudioState('ew-tiny', { rev: 1, factors: { strip: 1 } }, { expectedRev: 1 }), (e) => e.code === 'REV_CONFLICT' && e.status === 409);
      const [area] = await repo.handle.query("select section_in from ew_areas where version_id = 'ew-tiny'");
      assert.equal(n(area.section_in), 8);
      const snaps = await repo.handle.query("select direct_cost, earthwork_json from bid_snapshots where project_id = 'proj-tiny'");
      assert.equal(snaps.length, 1);
      assert.equal(n(snaps[0].direct_cost), 500);
      assert.match(snaps[0].earthwork_json, /ew-tiny/);
      const log = await repo.activity({ project_id: 'proj-tiny' });
      assert.ok(log.some((r) => r.entity_type === 'ew_versions' && r.action === 'update'));
      assert.ok(log.some((r) => r.employee_id === 'emp-clay'));
      await repo.softDelete('ew_versions', 'ew-tiny');
      assert.equal(await repo.getStudioVersion('ew-tiny'), null);
      await repo.restore('ew_versions', 'ew-tiny');
      const back = await repo.getStudioVersion('ew-tiny');
      assert.equal(back.rev, 2);
    });
    const [sample] = await repo.handle.query("select sum(total_cost) t from line_items where project_id = 'ce08cc827c'");
    assert.equal(n(sample.t), 18405662.10);
  } finally {
    await repo.close();
  }
});

test('the employee list is still exactly the five seeded people', async () => {
  const repo = await freshRepo({ withSeed: true });
  try {
    const rows = await repo.handle.query('select first_name, last_name from employees order by first_name');
    assert.deepEqual(rows.map((r) => r.first_name), ['Charles', 'Clay', 'Darren', 'Joe', 'Zach']);
    const blob = JSON.stringify(rows);
    const banned = ['Jack', 'Cook'].join(' ');
    assert.equal(blob.toLowerCase().includes(banned.toLowerCase()), false);
  } finally { await repo.close(); }
});

test('source tree does not name a sixth person', () => {
  const banned = ['Jack', 'Cook'].join(' ');
  try {
    const out = execFileSync('grep', ['-R', '-i', '-n', banned, '--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=.pglite', '.'], {
      cwd: root, encoding: 'utf8',
    });
    assert.fail(out);
  } catch (err) {
    if (err && err.status === 1) return;
    throw err;
  }
});
