'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshRepo, miniDoc, n } = require('./helpers');
const { runWithContext } = require('../db/context');

let repo, q;
test.before(async () => { repo = await freshRepo({ withSeed: true }); q = repo.handle.query; });
test.after(() => repo.close());

test('saveProject: optimistic rev check -> REV_CONFLICT 409', async () => {
  const p = await repo.createProject(miniDoc('rev-test'));
  assert.equal(p.rev, 1);
  const saved = await repo.saveProject({ ...p, name: 'renamed' });
  assert.equal(saved.rev, 2);
  assert.equal(saved.name, 'renamed');
  await assert.rejects(repo.saveProject({ ...p, name: 'stale' }), (e) => e.code === 'REV_CONFLICT' && e.status === 409);
  assert.equal((await repo.getProject('rev-test')).name, 'renamed');
  await assert.rejects(repo.createProject(miniDoc('rev-test')), (e) => e.code === 'EXISTS' && e.status === 409);
});

test('saveProject keeps line ids stable and round-trips edits', async () => {
  const p = await repo.getProject('rev-test');
  const [before] = await q("select id from line_items where project_id='rev-test' and line_key='L1'");
  p.lines[0].qty = 2000;
  p.lines.push({ ...p.lines[0], id: 'L2', description: 'Second', items: [], weirdNewField: { a: [1, 2] } });
  const saved = await repo.saveProject(p);
  assert.deepStrictEqual(saved, { ...p, rev: 3 });
  const [after] = await q("select id, total_cost from line_items where project_id='rev-test' and line_key='L1'");
  assert.equal(after.id, before.id);
  assert.equal(n(after.total_cost), 2000 / 500 * 300 * 10); // crew days x (labor+equip) x hrs
});

test('library edit after snapshot leaves project + bid snapshots unchanged', async () => {
  const pid = 'snap-test';
  await repo.createProject(miniDoc(pid));
  const snaps = await repo.snapshotRates(pid);
  assert.deepEqual(snaps.map((s) => s.rate_key), ['pa-10']);
  const libBefore = await repo.getLibraryItem('rates', 'pa-10');
  const bid = await repo.createBidSnapshot(pid);
  await repo.updateLibraryItem('rates', 'pa-10', { laborRateHr: 999.99, production: 1 });
  assert.equal((await repo.getLibraryItem('rates', 'pa-10')).laborRateHr, 999.99);
  const [s] = await q(`select * from project_rate_snapshots where project_id='${pid}'`);
  assert.equal(n(s.labor_rate_hr), libBefore.laborRateHr);
  assert.equal(n(s.units_per_day), libBefore.production);
  await repo.snapshotRates(pid); // re-snapshot without refresh keeps frozen values
  const [s2] = await q(`select * from project_rate_snapshots where project_id='${pid}'`);
  assert.equal(n(s2.labor_rate_hr), libBefore.laborRateHr);
  const [b] = await q(`select * from bid_snapshots where id='${bid.id}'`);
  assert.equal(n(b.direct_cost), n(bid.direct_cost));
  assert.equal(n(b.direct_cost), 6000);
  assert.equal((await repo.getProject(pid)).lines[0].items[0].laborRateHr, 100);
  // restore the library for other tests
  await repo.updateLibraryItem('rates', 'pa-10', { laborRateHr: libBefore.laborRateHr, production: libBefore.production });
});

test('one vendor quote linked to two projects', async () => {
  await repo.createProject(miniDoc('quote-a'));
  await repo.createProject(miniDoc('quote-b'));
  await repo.linkQuoteToProject('quote-a', 'q-aa');
  await repo.linkQuoteToProject('quote-b', 'q-aa');
  await repo.linkQuoteToProject('quote-b', 'q-aa'); // idempotent
  const links = await q("select project_id from project_quotes where vendor_quote_id='q-aa' and project_id like 'quote-%' order by project_id");
  assert.deepEqual(links.map((r) => r.project_id), ['quote-a', 'quote-b']);
  const [h] = await repo.report('v_vendor_quote_history', { quote_id: 'q-aa' });
  assert.equal(Number(h.project_count), 3); // + Buc-ee's (line-derived link)
});

test('soft delete hides, restore brings back', async () => {
  await repo.createProject(miniDoc('soft-test'));
  await repo.softDeleteProject('soft-test');
  assert.equal(await repo.getProject('soft-test'), null);
  assert.ok(!(await repo.listProjects()).some((p) => p.id === 'soft-test'));
  assert.ok((await repo.listProjects({ includeDeleted: true })).some((p) => p.id === 'soft-test'));
  assert.ok(!(await repo.report('v_project_pipeline')).some((p) => p.project_id === 'soft-test'));
  await assert.rejects(repo.saveProject(miniDoc('soft-test')), (e) => e.code === 'NOT_FOUND');
  await repo.restoreProject('soft-test');
  assert.equal((await repo.getProject('soft-test')).id, 'soft-test');
  // master tables too
  await repo.deleteLibraryItem('crews', 'c-0');
  assert.equal(await repo.getLibraryItem('crews', 'c-0'), null);
  await repo.restore('crews', 'c-0');
  assert.ok(await repo.getLibraryItem('crews', 'c-0'));
});

test('activity_log rejects UPDATE / DELETE / TRUNCATE', async () => {
  const [row] = await q('select id from activity_log limit 1');
  await assert.rejects(q(`update activity_log set action='update' where id='${row.id}'`), /append-only/);
  await assert.rejects(q(`delete from activity_log where id='${row.id}'`), /append-only/);
  await assert.rejects(q('truncate activity_log'), /append-only/);
});

test('every repo write path writes an activity_log row with the request_id (same transaction)', async () => {
  const pid = 'log-test';
  let i = 0;
  const steps = [
    ['createProject', () => repo.createProject(miniDoc(pid))],
    ['saveProject', async () => repo.saveProject(await repo.getProject(pid))],
    ['setProjectStatus', () => repo.setProjectStatus(pid, 'submitted')],
    ['assignEmployee', () => repo.assignEmployee(pid, 'emp-clay', 'estimator')],
    ['snapshotRates', () => repo.snapshotRates(pid)],
    ['createBidSnapshot', () => repo.createBidSnapshot(pid)],
    ['recordBidOutcome', () => repo.recordBidOutcome(pid, { status: 'lost', awarded_to_name: 'Other bidder (test)', winning_amount: 5000 })],
    ['linkQuoteToProject', () => repo.linkQuoteToProject(pid, 'q-aa')],
    ['storeFile', () => repo.storeFile({ filename: 'a.txt', mime: 'text/plain', bytes: Buffer.from('hello') })],
    ['recordExport', () => repo.recordExport(pid, { export_type: 'proposal_pdf', filename: 'p.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF') })],
    ['recordAiRun', () => repo.recordAiRun(pid, { model: 'test-model', prompt: 'p', results: [{ id: 'r1', description: 'x', qty: 1, unit: 'EA' }] })],
    ['addJobCostActual', () => repo.addJobCostActual(pid, { cost_type: 'labor', amount: 10, cost_code: '04' })],
    ['upsertEmployee', () => repo.upsertEmployee({ employee_no: 'LOGTEST-1', first_name: 'Logtest' })],
    ['addCertification', async () => repo.addCertification((await repo.list('employees', { employee_no: 'LOGTEST-1' }))[0].id, { cert_type: 'OSHA 10', expires_on: '2030-01-01' })],
    ['addCrewMember', async () => repo.addCrewMember('c-0', (await repo.list('employees', { employee_no: 'LOGTEST-1' }))[0].id, { role_on_crew: 'operator' })],
    ['insert', () => repo.insert('companies', { id: 'co-logtest', name: 'Logtest Co', company_type: 'gc' })],
    ['update', () => repo.update('companies', 'co-logtest', { city: 'Nowhere' })],
    ['softDelete', () => repo.softDelete('companies', 'co-logtest')],
    ['restore', () => repo.restore('companies', 'co-logtest')],
    ['upsertLibraryItem', () => repo.upsertLibraryItem('crews', { id: 'c-logtest', name: 'Log crew', laborRateHr: 1, equipRateHr: 2 })],
    ['updateLibraryItem', () => repo.updateLibraryItem('crews', 'c-logtest', { name: 'Log crew 2' })],
    ['deleteLibraryItem', () => repo.deleteLibraryItem('crews', 'c-logtest')],
    ['setSetting', () => repo.setSetting('test.key', { a: 1 })],
    ['insert users', () => repo.insert('users', { id: 'u-logtest', username: 'logtest', role_id: 'role-viewer' })],
    ['recordLogin', () => repo.recordLogin('u-logtest')],
    ['softDeleteProject', () => repo.softDeleteProject(pid)],
    ['restoreProject', () => repo.restoreProject(pid)],
  ];
  for (const [name, fn] of steps) {
    const rid = `req-${++i}-${name}`;
    await runWithContext({ request_id: rid, user_id: 'u-tester', employee_id: 'emp-clay' }, fn);
    const rows = await q('select * from activity_log where request_id = $1', [rid]);
    assert.ok(rows.length > 0, `${name} wrote no activity_log row`);
    assert.ok(rows.every((r) => r.user_id === 'u-tester' && r.employee_id === 'emp-clay'), name);
  }
  const actions = new Set((await q("select distinct action from activity_log where request_id like 'req-%'")).map((r) => r.action));
  for (const a of ['create', 'update', 'delete', 'restore', 'status_change', 'export', 'ai_run', 'login']) assert.ok(actions.has(a), a);
  // stored bytes never copied into the log
  const [f] = await q("select after_json from activity_log where entity_type='stored_files' and request_id like 'req-%' limit 1");
  assert.match(f.after_json, /"bytes":"<\d+ bytes>"/);
});

test('a failing write rolls back its activity_log row too', async () => {
  const rid = 'req-fail';
  await assert.rejects(runWithContext({ request_id: rid }, () => repo.insert('companies', { id: 'co-bad', name: 'x', company_type: 'not-a-type' })));
  assert.equal((await q('select count(*) n from activity_log where request_id = $1', [rid]))[0].n * 1, 0);
});

test('report() whitelist', async () => {
  await assert.rejects(repo.report('activity_log'), (e) => e.code === 'INVALID');
  await assert.rejects(repo.report('v_project_pipeline', { 'status; drop table x': 1 }), (e) => e.code === 'INVALID');
  const r = await repo.report('v_project_pipeline', { status: { op: '<>', value: 'won' } }, { orderBy: 'name', limit: 5 });
  assert.ok(r.length >= 1);
});

test('storeFile / getFile (db bytes and s3 pointer)', async () => {
  const bytes = Buffer.from([0, 1, 2, 255]);
  const f = await repo.storeFile({ filename: 'x.bin', mime: 'application/octet-stream', bytes });
  const back = await repo.getFile(f.id);
  assert.ok(Buffer.isBuffer(back.bytes));
  assert.deepEqual([...back.bytes], [0, 1, 2, 255]);
  assert.equal(back.size_bytes, 4);
  assert.equal(back.sha256.length, 64);
  const s3 = await repo.storeFile({ filename: 'big.pdf', object_key: 'plans/big.pdf', sha256: 'a'.repeat(64), size_bytes: 1e9 });
  assert.equal((await repo.getFile(s3.id)).storage_kind, 's3');
});
