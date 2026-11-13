'use strict';
const crypto = require('node:crypto');
const { getContext, runWithContext } = require('../db/context');

const COOKIE = 'wpm_session';
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function setSessionCookie(res, token) {
  const parts = [`${COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${FOURTEEN_DAYS_MS / 1000}`];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function passwordOk(given, expected) {
  if (!expected) return true;
  const a = sha256(String(given ?? ''));
  const b = sha256(String(expected));
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Find or create the login row for one of the five seeded employees. */
async function ensureUser(repo, employeeId) {
  const emp = await repo.get('employees', employeeId);
  if (!emp || emp.deleted_at) return null;
  const [existing] = await repo.list('users', { employee_id: employeeId });
  if (existing) return existing;
  const roleId = employeeId === 'emp-clay' ? 'role-admin' : 'role-estimator';
  return repo.insert('users', {
    id: `user-${employeeId}`,
    username: employeeId,
    display_name: emp.display_name || emp.first_name,
    email: emp.email,
    role_id: roleId,
    employee_id: employeeId,
    is_active: true,
  });
}

async function loadAuth(repo, token) {
  if (!token) return null;
  const [session] = await repo.list('user_sessions', { token_hash: sha256(token) });
  if (!session) return null;
  if (session.expires_at && Date.parse(session.expires_at) < Date.now()) return null;
  const user = session.user_id ? await repo.get('users', session.user_id) : null;
  if (!user || user.is_active === false) return null;
  const role = user.role_id ? await repo.get('roles', user.role_id) : null;
  const employee = user.employee_id ? await repo.get('employees', user.employee_id) : null;
  return {
    sessionId: session.id,
    user,
    employee,
    role: role ? role.code : 'viewer',
    employeeId: user.employee_id,
    userId: user.id,
  };
}

function authMiddleware(repo) {
  return async function attach(req, res, next) {
    try {
      const token = readCookie(req, COOKIE);
      req.auth = await loadAuth(repo, token);
      const ctx = {
        user_id: req.auth ? req.auth.userId : null,
        employee_id: req.auth ? req.auth.employeeId : null,
        request_id: req.get('x-request-id') || crypto.randomUUID(),
      };
      runWithContext(ctx, () => next());
    } catch (err) {
      next(err);
    }
  };
}

function requireUser(req, res, next) {
  if (!req.auth) return res.status(401).json({ code: 'AUTH', message: 'Sign in first.' });
  next();
}

function requireWriter(req, res, next) {
  if (!req.auth) return res.status(401).json({ code: 'AUTH', message: 'Sign in first.' });
  if (req.auth.role === 'viewer') return res.status(403).json({ code: 'READ_ONLY', message: 'This login can view but not edit.' });
  next();
}

async function login(repo, { employeeId, password, expectedPassword }) {
  if (!passwordOk(password, expectedPassword)) {
    const err = new Error('Wrong password.');
    err.status = 401;
    err.code = 'AUTH';
    throw err;
  }
  const ctx = getContext();
  ctx.employee_id = employeeId;
  const user = await ensureUser(repo, employeeId);
  if (!user) {
    const err = new Error('Unknown employee.');
    err.status = 400;
    err.code = 'INVALID';
    throw err;
  }
  ctx.user_id = user.id;
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + FOURTEEN_DAYS_MS).toISOString();
  await repo.insert('user_sessions', {
    token_hash: sha256(token),
    user_id: user.id,
    employee_id: user.employee_id,
    expires_at: expires,
  });
  await repo.recordLogin(user.id);
  return { token, user };
}

module.exports = {
  COOKIE, sha256, readCookie, setSessionCookie, clearSessionCookie, passwordOk,
  ensureUser, loadAuth, authMiddleware, requireUser, requireWriter, login,
};
