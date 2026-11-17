'use strict';
/**
 * People: the admin adds, removes and sets access for the names on the sign-in list.
 * Everyone shares one password (APP_PASSWORD); this list decides who can pick a name and
 * whether that name can edit. Every change goes through the audited repo, so the activity log
 * records which admin made it. Removing someone is a soft delete and also ends their sessions.
 */
const crypto = require('node:crypto');
const { ensureUser } = require('./auth');

const ACCESS_ROLE = { admin: 'role-admin', edit: 'role-estimator', view: 'role-viewer' };
const ROLE_ACCESS = { 'role-admin': 'admin', 'role-estimator': 'edit', 'role-viewer': 'view' };

function requireAdmin(req, res, next) {
  if (!req.auth) return res.status(401).json({ code: 'AUTH', message: 'Sign in first.' });
  if (req.auth.role !== 'admin') return res.status(403).json({ code: 'ADMIN_ONLY', message: 'Only an admin can manage people.' });
  next();
}

const clean = (v, n) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, n) : '');

async function personRows(repo) {
  const emps = await repo.list('employees', {}, { includeDeleted: true });
  const users = await repo.list('users', {}, { includeDeleted: true });
  const byEmp = new Map(users.map((u) => [u.employee_id, u]));
  return emps.map((e) => {
    const u = byEmp.get(e.id);
    return {
      id: e.id,
      firstName: e.first_name,
      lastName: e.last_name,
      name: e.display_name || [e.first_name, e.last_name].filter(Boolean).join(' '),
      // Someone who has never signed in gets edit access on first sign-in (Clay gets admin).
      access: u ? (ROLE_ACCESS[u.role_id] || 'view') : (e.id === 'emp-clay' ? 'admin' : 'edit'),
      active: !e.deleted_at,
      lastLogin: u ? u.last_login_at : null,
    };
  }).sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
}

function mountPeople(app, { repo }) {
  app.get('/api/admin/people', requireAdmin, async (_req, res, next) => {
    try { res.json(await personRows(repo)); } catch (err) { next(err); }
  });

  app.post('/api/admin/people', requireAdmin, async (req, res, next) => {
    try {
      const first = clean(req.body && req.body.firstName, 100);
      const last = clean(req.body && req.body.lastName, 100);
      const access = (req.body && req.body.access) || 'edit';
      if (!first) return res.status(400).json({ code: 'INVALID', message: 'First name is required.' });
      if (access !== 'edit' && access !== 'view') return res.status(400).json({ code: 'INVALID', message: 'Access must be edit or view.' });
      const name = [first, last].filter(Boolean).join(' ');
      const live = await repo.list('employees');
      if (live.some((e) => (e.display_name || [e.first_name, e.last_name].filter(Boolean).join(' ')).toLowerCase() === name.toLowerCase())) {
        return res.status(409).json({ code: 'EXISTS', message: `${name} is already on the list.` });
      }
      const slug = first.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'person';
      const id = `emp-${slug}-${crypto.randomBytes(3).toString('hex')}`;
      await repo.insert('employees', { id, first_name: first, last_name: last || null, display_name: last ? name : null });
      await repo.insert('users', {
        id: `user-${id}`, username: id, display_name: name, role_id: ACCESS_ROLE[access], employee_id: id, is_active: true,
      });
      res.status(201).json((await personRows(repo)).find((p) => p.id === id));
    } catch (err) { next(err); }
  });

  app.patch('/api/admin/people/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = req.params.id;
      const emp = await repo.get('employees', id, { includeDeleted: true });
      if (!emp) return res.status(404).json({ code: 'NOT_FOUND', message: 'No such person.' });
      const { access, active } = req.body || {};
      if (id === req.auth.employeeId && (active === false || (access && access !== 'admin'))) {
        return res.status(400).json({ code: 'SELF', message: 'You cannot remove yourself or drop your own admin access.' });
      }
      if (access !== undefined && !ACCESS_ROLE[access]) return res.status(400).json({ code: 'INVALID', message: 'Access must be admin, edit or view.' });

      if (active === true && emp.deleted_at) await repo.restore('employees', id);
      let user = (await repo.list('users', { employee_id: id }, { includeDeleted: true }))[0];
      if (!user && (access || active === true)) user = await ensureUser(repo, id);
      if (user) {
        const patch = {};
        if (access && user.role_id !== ACCESS_ROLE[access]) patch.role_id = ACCESS_ROLE[access];
        if (active === true && user.is_active === false) patch.is_active = true;
        if (active === false && user.is_active !== false) patch.is_active = false; // ends their open sessions
        if (Object.keys(patch).length) await repo.update('users', user.id, patch);
      }
      if (active === false && !emp.deleted_at) await repo.softDelete('employees', id);
      res.json((await personRows(repo)).find((p) => p.id === id));
    } catch (err) { next(err); }
  });
}

module.exports = { mountPeople, requireAdmin, personRows };
