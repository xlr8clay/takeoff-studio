'use strict';
/**
 * Request context for the activity log (who / which request). Set once per HTTP request:
 *   app.use((req, res, next) => runWithContext({ user_id, employee_id, request_id }, next));
 * repo.js reads it for every write.
 */
const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

const als = new AsyncLocalStorage();

function runWithContext(ctx, fn) {
  const c = {
    user_id: ctx.user_id ?? null,
    employee_id: ctx.employee_id ?? null,
    request_id: ctx.request_id ?? crypto.randomUUID(),
  };
  return als.run(c, fn);
}

function getContext() {
  return als.getStore() || { user_id: null, employee_id: null, request_id: null };
}

module.exports = { runWithContext, getContext };
