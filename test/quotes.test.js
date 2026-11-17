'use strict';
// Quotes API: list, create with a job link, replace, delete, and who may write.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { freshRepo } = require('./helpers');
const { createApp, listen } = require('../server/app');

test('quotes are stored, linked to a job, replaced and deleted', async () => {
  const repo = await freshRepo({ withSeed: true });
  const server = await listen(createApp({ repo, root: path.join(__dirname, '..'), password: 'secret' }), 0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body && JSON.stringify(body) });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  };
  try {
    assert.equal((await call('GET', '/api/quotes')).status, 401);
    await call('POST', '/api/login', { employeeId: 'emp-clay', password: 'secret' });
    const seeded = (await call('GET', '/api/quotes')).json;
    assert.ok(Array.isArray(seeded) && seeded.length >= 1, 'seeded library quotes are listed');
    const [project] = await repo.list('projects');

    assert.equal((await call('POST', '/api/quotes', { quote: { vendor: '', items: [{ description: 'x', unitPrice: 1 }] } })).status, 400);
    assert.equal((await call('POST', '/api/quotes', { quote: { vendor: 'A', items: [] } })).status, 400);

    const made = await call('POST', '/api/quotes', { projectId: project.id, quote: {
      vendor: 'Hanson Aggregates', quoteNo: 'H-101', date: '2026-11-17', expires: '2026-12-31', type: 'material', scope: 'Select fill',
      items: [{ description: 'Select fill delivered', unit: 'CY', qty: 1200, unitPrice: 18.5 }, { description: 'Fuel surcharge', unit: 'LS', qty: 1, unitPrice: 250, ls: true }],
    } });
    assert.equal(made.status, 201);
    assert.equal(made.json.vendor, 'Hanson Aggregates');
    assert.equal(made.json.items.length, 2);
    assert.equal(made.json.items[0].ext, 22200);
    assert.deepEqual(made.json.projectIds, [project.id]);

    const again = await call('POST', '/api/quotes', { projectId: project.id, quote: { ...made.json, items: [{ description: 'Select fill delivered', unit: 'CY', qty: 1200, unitPrice: 17.75 }] } });
    assert.equal(again.status, 201);
    assert.equal(again.json.items.length, 1);
    assert.equal(again.json.items[0].unitPrice, 17.75);
    assert.deepEqual(again.json.projectIds, [project.id], 'saving again does not link twice');

    const listed = (await call('GET', '/api/quotes')).json.find((q) => q.id === made.json.id);
    assert.equal(listed.items[0].unitPrice, 17.75);

    assert.equal((await call('DELETE', `/api/quotes/${made.json.id}`)).status, 200);
    assert.ok(!(await call('GET', '/api/quotes')).json.some((q) => q.id === made.json.id));
    assert.equal((await call('DELETE', '/api/quotes/nope')).status, 404);

    // a view-only login can read but not write
    await repo.update('users', 'user-emp-clay', { role_id: 'role-viewer' });
    assert.equal((await call('GET', '/api/quotes')).status, 200);
    assert.equal((await call('POST', '/api/quotes', { quote: { vendor: 'B', items: [{ description: 'y', unitPrice: 2 }] } })).status, 403);
  } finally { server.close(); }
});
