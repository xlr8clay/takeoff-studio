'use strict';
// Employee performance views. ALL people/costs/outcomes here are synthetic and exist only in this in-memory DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshRepo, miniDoc, n } = require('./helpers');

let repo;
test.before(async () => { repo = await freshRepo(); });
test.after(() => repo.close());

test('employee win rate, estimate accuracy, bids, hit rate, estimate vs actual, unit cost history, expiring certs', async () => {
  const a = await repo.upsertEmployee({ id: 'syn-a', first_name: 'SynA', display_name: 'Synthetic A' });
  const b = await repo.upsertEmployee({ id: 'syn-b', first_name: 'SynB', display_name: 'Synthetic B' });
  // each mini project: direct cost = 1000 CY / 500 x (100+200) x 10 = 6000; markup 10% -> bid 6600
  const plan = [
    ['p1', a.id, 'won', [3000, 3600]], // actual 6600 -> +10%
    ['p2', a.id, 'won', [5400]], // actual 5400 -> -10%
    ['p3', a.id, 'lost', []],
    ['p4', b.id, 'lost', []],
    ['p5', b.id, 'pending', []],
  ];
  for (const [pid, emp, status, actuals] of plan) {
    await repo.createProject(miniDoc(pid, { markupPct: 0.1 }), { estimatorId: emp });
    await repo.createBidSnapshot(pid);
    await repo.recordBidOutcome(pid, { status, decision_date: status === 'pending' ? null : '2026-02-01' });
    for (const amt of actuals) await repo.addJobCostActual(pid, { cost_type: 'labor', amount: amt, cost_date: '2026-03-01' });
  }

  const win = await repo.report('v_employee_win_rate', {}, { orderBy: 'employee_id' });
  const wa = win.find((r) => r.employee_id === 'syn-a');
  const wb = win.find((r) => r.employee_id === 'syn-b');
  assert.deepEqual([Number(wa.bids), Number(wa.won), Number(wa.lost)], [3, 2, 1]);
  assert.ok(Math.abs(n(wa.win_rate) - 2 / 3) < 1e-4);
  assert.equal(n(wa.dollars_bid), 3 * 6600);
  assert.equal(n(wa.dollars_won), 2 * 6600);
  assert.deepEqual([Number(wb.bids), Number(wb.won), Number(wb.lost)], [2, 0, 1]);
  assert.equal(n(wb.win_rate), 0);

  const acc = await repo.report('v_employee_estimate_accuracy');
  assert.equal(acc.length, 1);
  assert.equal(acc[0].employee_id, 'syn-a');
  assert.equal(Number(acc[0].won_jobs_with_actuals), 2);
  assert.ok(Math.abs(n(acc[0].avg_variance_pct)) < 1e-9); // (+10% + -10%) / 2
  assert.ok(Math.abs(n(acc[0].avg_abs_variance_pct) - 0.1) < 1e-9);

  const eva = await repo.report('v_estimate_vs_actual', { project_id: 'p1' });
  assert.equal(n(eva[0].est_direct_cost), 6000);
  assert.equal(n(eva[0].actual_cost), 6600);
  assert.equal(n(eva[0].variance), 600);

  const bids = await repo.report('v_employee_bids', { employee_id: 'syn-b' }, { orderBy: 'project_id' });
  assert.deepEqual(bids.map((r) => r.outcome_status), ['lost', 'pending']);

  const [hit] = await repo.report('v_bid_hit_rate');
  assert.deepEqual([Number(hit.bids), Number(hit.won), Number(hit.lost), Number(hit.pending)], [5, 2, 2, 1]);
  assert.equal(n(hit.hit_rate), 0.5);

  const uc = await repo.report('v_unit_cost_history_by_estimator', { estimator_id: 'syn-a' });
  assert.equal(uc.length, 3);
  assert.equal(n(uc[0].unit_price), 6);
  assert.equal(uc[0].estimator_name, 'Synthetic A');
  assert.equal((await repo.report('v_unit_cost_history')).length, 5);

  const pipe = await repo.report('v_project_pipeline', { project_id: 'p1' });
  assert.equal(pipe[0].status, 'won');
  assert.equal(n(pipe[0].bid_total), 6600);

  const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  await repo.addCertification('syn-a', { cert_type: 'CDL A', expires_on: soon });
  await repo.addCertification('syn-b', { cert_type: 'OSHA 30', expires_on: '2099-01-01' });
  const exp = await repo.report('v_expiring_certifications', { days_until_expiry: { op: '<=', value: 30 } });
  assert.equal(exp.length, 1);
  assert.equal(exp[0].cert_type, 'CDL A');
});
