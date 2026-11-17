'use strict';
// AI chat route with a fake Claude client: nothing here calls the real API.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { freshRepo } = require('./helpers');
const { createApp, listen } = require('../server/app');
const { cleanMessages, MODEL } = require('../server/ai');

function fakeClient({ chunks = ['Cut is ', '1,200 CY.'], stopReason = 'end_turn', fail = null } = {}) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        stream(params) {
          calls.push(params);
          return {
            abort() {},
            async *[Symbol.asyncIterator]() {
              if (fail) throw fail;
              for (const t of chunks) yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } };
            },
            async finalMessage() { return { stop_reason: stopReason, content: [] }; },
          };
        },
      },
    },
  };
}

async function boot(aiClient) {
  const repo = await freshRepo({ withSeed: true });
  const server = await listen(createApp({ repo, root: path.join(__dirname, '..'), password: 'secret', aiClient }), 0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body && JSON.stringify(body) });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, type: res.headers.get('content-type') || '', text: await res.text() };
  };
  return { server, call };
}

const ask = { messages: [{ role: 'user', content: 'How much cut?' }] };

test('AI chat needs a login, streams text, and sends the right request', async () => {
  const client = fakeClient();
  const { server, call } = await boot(client);
  try {
    assert.equal((await call('POST', '/api/ai/chat', ask)).status, 401);
    assert.equal((await call('POST', '/api/login', { employeeId: 'emp-darren', password: 'secret' })).status, 200);
    const r = await call('POST', '/api/ai/chat', ask);
    assert.equal(r.status, 200);
    assert.match(r.type, /text\/plain/);
    assert.equal(r.text, 'Cut is 1,200 CY.');
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].model, MODEL);
    assert.deepEqual(client.calls[0].messages, ask.messages);
    assert.equal(client.calls[0].fallbacks, 'default');
    assert.equal((await call('POST', '/api/ai/chat', { messages: [] })).status, 400);
    assert.equal(client.calls.length, 1);
  } finally { server.close(); }
});

test('AI chat is off without a key, and reports API errors plainly', async () => {
  let { server, call } = await boot(null);
  try {
    await call('POST', '/api/login', { employeeId: 'emp-joe', password: 'secret' });
    const off = await call('POST', '/api/ai/chat', ask);
    assert.equal(off.status, 503);
    assert.match(off.text, /AI_OFF/);
  } finally { server.close(); }

  ({ server, call } = await boot(fakeClient({ fail: new Error('socket hang up') })));
  try {
    await call('POST', '/api/login', { employeeId: 'emp-joe', password: 'secret' });
    const bad = await call('POST', '/api/ai/chat', ask);
    assert.equal(bad.status, 502);
    assert.match(bad.text, /AI_ERROR/);
  } finally { server.close(); }

  ({ server, call } = await boot(fakeClient({ chunks: [], stopReason: 'refusal' })));
  try {
    await call('POST', '/api/login', { employeeId: 'emp-joe', password: 'secret' });
    const no = await call('POST', '/api/ai/chat', ask);
    assert.equal(no.status, 200);
    assert.match(no.text, /declined/);
  } finally { server.close(); }
});

test('cleanMessages rejects bad shapes', () => {
  assert.equal(cleanMessages({}), null);
  assert.equal(cleanMessages({ messages: [{ role: 'assistant', content: 'hi' }] }), null);
  assert.equal(cleanMessages({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }), null);
  assert.equal(cleanMessages({ messages: [{ role: 'system', content: 'x' }] }), null);
  assert.equal(cleanMessages({ messages: [{ role: 'user', content: 'x'.repeat(200001) }] }), null);
  assert.deepEqual(cleanMessages(ask), ask.messages);
});
