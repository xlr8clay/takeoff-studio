'use strict';
// People admin: only an admin manages the sign-in list; added people can sign in with the access given.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { freshRepo } = require('./helpers');
const { createApp, listen } = require('../server/app');

async function boot() {
  const repo = await freshRepo({ withSeed: true });
  const server = await listen(createApp({ repo, root: path.join(__dirname, '..'), password: 'secret' }), 0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const agent = () => {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body && JSON.stringify(body) });
      const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { json = text; }
      return { status: res.status, json };
    };
  };
  return { server, repo, agent };
}

test('admin adds, limits, removes and restores people', async () => {
  const { server, repo, agent } = await boot();
  try {
    const clay = agent();
    const joe = agent();
    assert.equal((await clay('GET', '/api/admin/people')).status, 401);
    await joe('POST', '/api/login', { employeeId: 'emp-joe', password: 'secret' });
    assert.equal((await joe('GET', '/api/admin/people')).status, 403);
    assert.equal((await joe('POST', '/api/admin/people', { firstName: 'X' })).status, 403);

    await clay('POST', '/api/login', { employeeId: 'emp-clay', password: 'secret' });
    const list = await clay('GET', '/api/admin/people');
    assert.equal(list.status, 200);
    assert.equal(list.json.length, 5);
    assert.equal(list.json.find((p) => p.id === 'emp-clay').access, 'admin');

    assert.equal((await clay('POST', '/api/admin/people', { firstName: ' ' })).status, 400);
    const maria = await clay('POST', '/api/admin/people', { firstName: 'Maria', lastName: 'Lopez', access: 'view' });
    assert.equal(maria.status, 201);
    assert.equal(maria.json.name, 'Maria Lopez');
    assert.equal(maria.json.access, 'view');
    assert.equal((await clay('POST', '/api/admin/people', { firstName: 'maria', lastName: 'lopez' })).status, 409);

    // Maria shows on the sign-in list and signs in read-only
    const names = (await agent()('GET', '/api/auth/employees')).json.map((e) => e.name);
    assert.ok(names.includes('Maria Lopez'));
    const m = agent();
    assert.equal((await m('POST', '/api/login', { employeeId: maria.json.id, password: 'secret' })).status, 200);
    assert.equal((await m('GET', '/api/health')).json.user.role, 'viewer');
    assert.equal((await m('POST', '/api/studio/jobs', { document: { name: 'x' } })).status, 403);

    // Give her edit access: same session now writes
    assert.equal((await clay('PATCH', `/api/admin/people/${maria.json.id}`, { access: 'edit' })).json.access, 'edit');
    assert.equal((await m('GET', '/api/health')).json.user.role, 'estimator');

    // Remove: signed out, off the list, cannot sign in; restore brings her back
    assert.equal((await clay('PATCH', `/api/admin/people/${maria.json.id}`, { active: false })).json.active, false);
    assert.equal((await m('GET', '/api/health')).json.user, null);
    assert.ok(!(await agent()('GET', '/api/auth/employees')).json.some((e) => e.id === maria.json.id));
    assert.equal((await agent()('POST', '/api/login', { employeeId: maria.json.id, password: 'secret' })).status, 400);
    assert.equal((await clay('PATCH', `/api/admin/people/${maria.json.id}`, { active: true })).json.active, true);
    assert.equal((await agent()('POST', '/api/login', { employeeId: maria.json.id, password: 'secret' })).status, 200);

    // A seeded person who never signed in can be set to view-only before their first sign-in
    assert.equal((await clay('PATCH', '/api/admin/people/emp-zach', { access: 'view' })).json.access, 'view');
    const z = agent();
    await z('POST', '/api/login', { employeeId: 'emp-zach', password: 'secret' });
    assert.equal((await z('GET', '/api/health')).json.user.role, 'viewer');

    // The admin cannot lock themself out
    assert.equal((await clay('PATCH', '/api/admin/people/emp-clay', { active: false })).status, 400);
    assert.equal((await clay('PATCH', '/api/admin/people/emp-clay', { access: 'edit' })).status, 400);
    assert.equal((await clay('PATCH', '/api/admin/people/emp-nobody', { active: false })).status, 404);

    // Every change is in the activity log under Clay
    const log = await repo.handle.query("select count(*)::int n from activity_log where entity_id = $1 and user_id = 'user-emp-clay'", [maria.json.id]);
    assert.ok((log.rows || log)[0].n >= 3);
  } finally { server.close(); }
});
