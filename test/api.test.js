'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freshRepo } = require('./helpers');
const { openDb } = require('../db/client');
const { createRepo } = require('../db/repo');
const { migrate } = require('../db/migrate');
const { seed } = require('../db/seed');
const { runWithContext } = require('../db/context');
const { createApp, listen } = require('../server/app');

const tinyDoc = {
  name: 'API pad', frame: 'test', cell: 10, nx: 1, ny: 1, x0: 1, y0: 2, zbase: 3,
  eg: 'AA', fg: 'AA', reg: 'AQ', dist10: 'AQ', near: 'AQ',
  regions: [{ name: 'Pad', type: 'building_pad', section_in: 6, rings: [] }],
  limits: [], spec: { strip_in: 4, shrink_pct: 0, swell_pct: 0 }, basis: ['test'],
};

async function boot(repo, password) {
  await runWithContext({ request_id: 'api-boot' }, () => repo.importStudioVersion({
    key: 'tiny', file: 'tiny.json', projectId: 'proj-api', projectName: 'API pad', location: null,
    versionId: 'ew-api', scenarioKey: 'tiny', scenarioRole: 'site', sort: 0,
    aerial: null, grading: null, projectFlags: [], extraFlags: [],
  }, { gridBytes: Buffer.from(JSON.stringify(tinyDoc)) }));
  const server = await listen(createApp({ repo, root: path.join(__dirname, '..'), password }), 0);
  const port = server.address().port;
  let cookie = '';
  async function api(method, url, body) {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, json, text };
  }
  return { server, api };
}

test('API auth, persistence, conflict, quotes, files and outcomes', async () => {
  const repo = await freshRepo({ withSeed: true });
  const { server, api } = await boot(repo, 'secret');
  try {
    const health = await api('GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.ok, true);
    assert.equal(health.json.user, null);
    assert.equal((await api('GET', '/api/studio/jobs')).status, 401);
    assert.equal((await api('GET', '/bucees.json')).status, 401);
    const page = await api('GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.text, /Earthwork Takeoff Studio/);

    const bad = await api('POST', '/api/login', { employeeId: 'emp-clay', password: 'nope' });
    assert.equal(bad.status, 401);
    const ok = await api('POST', '/api/login', { employeeId: 'emp-clay', password: 'secret' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.user.employeeId, 'emp-clay');

    const jobs = await api('GET', '/api/studio/jobs');
    assert.equal(jobs.status, 200);
    assert.equal(jobs.json.some((j) => j.key === 'tiny'), true);
    const doc = await api('GET', '/api/studio/jobs/tiny/document');
    assert.equal(doc.json.name, 'API pad');

    const put = await api('PUT', '/api/studio/jobs/tiny', {
      rev: 1,
      factors: { strip: 5, shrink: 0, swell: 0, moist: 6, overbuild: 1, dz: 0, sec: [6] },
      balance: { cut_cy: 3, fill_cy: 1, balance_cy: 2, import_cy: 0, export_cy: 2, strip_cy: 0.5, area_sy: 10, moist_sy: 4 },
      bid: { items: { fill: { crew: 'fill', mat: 8 } }, custom: [], trucks: [{ desc: 'Export excess', src: 'export', per: 14, rate: 90 }] },
      touched: false,
    });
    assert.equal(put.status, 200, JSON.stringify(put.json));
    assert.equal(put.json.rev, 2);
    const again = await api('PUT', '/api/studio/jobs/tiny', { rev: 1, factors: { strip: 1 } });
    assert.equal(again.status, 409);
    assert.equal(again.json.code, 'REV_CONFLICT');

    const rates = await api('PUT', '/api/studio/rates', { rev: 0, document: { ovh: 10, markup: 0, touched: true, equip: [{ id: 'dozer', name: 'Dozer', rate: 170 }], crews: [] } });
    assert.equal(rates.status, 200);
    assert.equal((await api('GET', '/api/studio/rates')).json.rev, 1);

    const outcome = await api('POST', '/api/studio/jobs/tiny/outcome', { status: 'pending' });
    assert.equal(outcome.status, 200);
    const [o] = await repo.handle.query("select status, direct_cost, winning_amount from bid_outcomes where project_id = 'proj-api'");
    assert.equal(o.status, 'pending');
    assert.equal(o.direct_cost, null);
    assert.equal(o.winning_amount, null);

    const item = await api('POST', '/api/projects/proj-api/open-items', { text: 'Confirm pond outlet invert' });
    assert.equal(item.status, 201);
    const quote = await api('POST', '/api/library/quotes', { id: 'q-studio-test', vendor: 'Example Vendor', type: 'material', items: [] });
    assert.equal(quote.status, 200, JSON.stringify(quote.json));
    const file = await api('POST', '/api/files', { filename: 'note.txt', mime: 'text/plain', base64: Buffer.from('hello plan').toString('base64'), projectId: 'proj-api' });
    assert.equal(file.status, 201);
    const downloaded = await api('GET', `/api/files/${file.json.id}`);
    assert.equal(downloaded.text, 'hello plan');

    const log = await repo.activity({ project_id: 'proj-api' });
    assert.ok(log.some((r) => r.action === 'update' && r.entity_type === 'ew_versions' && r.employee_id === 'emp-clay'));
    assert.ok(log.some((r) => r.entity_type === 'open_items'));
    const logins = await repo.activity({ entity_type: 'users' });
    assert.ok(logins.some((r) => r.action === 'login' && r.employee_id === 'emp-clay'));
  } finally {
    server.close();
    await repo.close();
  }
});

test('API data survives a server restart on the same PGlite directory', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpm-api-'));
  const password = 'secret';
  const root = path.join(__dirname, '..');
  let handle = await openDb({ url: '', pgliteDir: dir });
  await migrate(handle);
  let repo = createRepo(handle);
  await seed(repo);
  await runWithContext({ request_id: 'boot' }, () => repo.importStudioVersion({
    key: 'tiny', file: 'tiny.json', projectId: 'proj-api', projectName: 'API pad', location: null,
    versionId: 'ew-api', scenarioKey: 'tiny', scenarioRole: 'site', sort: 0,
    aerial: null, grading: null, projectFlags: [], extraFlags: [],
  }, { gridBytes: Buffer.from(JSON.stringify(tinyDoc)) }));
  let server = await listen(createApp({ repo, root, password }), 0);
  let cookie = '';
  const call = (port) => async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method, headers: { 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, json: await res.json() };
  };
  try {
    let api = call(server.address().port);
    assert.equal((await api('POST', '/api/login', { employeeId: 'emp-darren', password })).status, 200);
    assert.equal((await api('PUT', '/api/studio/jobs/tiny', {
      rev: 1, factors: { strip: 9, shrink: 0, swell: 0, sec: [6] }, touched: false,
    })).status, 200);
    server.close();
    await handle.close();

    handle = await openDb({ url: '', pgliteDir: dir });
    repo = createRepo(handle);
    server = await listen(createApp({ repo, root, password }), 0);
    cookie = '';
    api = call(server.address().port);
    assert.equal((await api('POST', '/api/login', { employeeId: 'emp-darren', password })).status, 200);
    const job = await api('GET', '/api/studio/jobs/tiny');
    assert.equal(job.status, 200);
    assert.equal(job.json.rev, 2);
    assert.equal(job.json.editor.factors.strip, 9);
    const [sample] = await repo.handle.query("select sum(total_cost)::text t from line_items where project_id = 'ce08cc827c'");
    assert.equal(sample.t.startsWith('18405662.10') || Number(sample.t) === 18405662.10, true);
  } finally {
    server.close();
    await handle.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
