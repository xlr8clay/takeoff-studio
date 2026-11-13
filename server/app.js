'use strict';
const crypto = require('node:crypto');
const express = require('express');
const { RepoError } = require('../db/repo');
const { STUDIO_JOBS } = require('../db/studio-catalog');
const {
  authMiddleware, requireUser, requireWriter, login, setSessionCookie, clearSessionCookie,
} = require('./auth');

const STATIC_DENY = [/^\/db(?:\/|$)/, /^\/server(?:\/|$)/, /^\/test(?:\/|$)/, /^\/node_modules(?:\/|$)/, /^\/docs(?:\/|$)/, /^\/\.env/, /^\/\.git/];

function jobByKey(jobs, key) {
  return jobs.find((j) => j.key === key || j.versionId === key || j.scenario_key === key);
}

function createApp({ repo, root, password = '' }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '80mb' }));
  if (repo.handle.kind === 'pglite') {
    let chain = Promise.resolve();
    app.use((_req, res, next) => {
      const prev = chain;
      let release;
      chain = new Promise((done) => { release = done; });
      prev.then(() => {
        let settled = false;
        const finish = () => { if (!settled) { settled = true; release(); } };
        res.on('finish', finish);
        res.on('close', finish);
        next();
      }).catch(next);
    });
  }
  app.use(authMiddleware(repo));

  app.get('/favicon.ico', (_req, res) => res.status(204).end());

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      db: repo.handle.kind,
      authRequired: !!password,
      user: req.auth ? {
        id: req.auth.userId,
        employeeId: req.auth.employeeId,
        name: req.auth.employee ? (req.auth.employee.display_name || req.auth.employee.first_name) : req.auth.user.display_name,
        role: req.auth.role,
      } : null,
    });
  });

  app.get('/api/auth/employees', async (_req, res, next) => {
    try {
      const rows = await repo.list('employees');
      res.json(rows.map((e) => ({
        id: e.id,
        name: e.display_name || e.first_name,
        firstName: e.first_name,
        title: e.title_role,
      })));
    } catch (err) { next(err); }
  });

  app.post('/api/login', async (req, res, next) => {
    try {
      const { token, user } = await login(repo, {
        employeeId: req.body && req.body.employeeId,
        password: req.body && req.body.password,
        expectedPassword: password,
      });
      setSessionCookie(res, token);
      const emp = await repo.get('employees', user.employee_id);
      res.json({
        ok: true,
        user: { id: user.id, employeeId: user.employee_id, name: emp.display_name || emp.first_name, role: user.role_id },
      });
    } catch (err) { next(err); }
  });

  app.post('/api/logout', requireUser, async (req, res, next) => {
    try {
      await repo.softDelete('user_sessions', req.auth.sessionId);
      clearSessionCookie(res);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  app.get('/api/studio/jobs', requireUser, async (_req, res, next) => {
    try { res.json(await repo.listStudioJobs()); } catch (err) { next(err); }
  });

  app.get('/api/studio/jobs/:key/document', requireUser, async (req, res, next) => {
    try {
      const jobs = await repo.listStudioJobs();
      const job = jobByKey(jobs, req.params.key);
      if (!job) return res.status(404).json({ code: 'NOT_FOUND', message: 'No such job' });
      res.json(await repo.getStudioDocument(job.versionId));
    } catch (err) { next(err); }
  });

  app.get('/api/studio/jobs/:key', requireUser, async (req, res, next) => {
    try {
      const jobs = await repo.listStudioJobs();
      const job = jobByKey(jobs, req.params.key);
      if (!job) return res.status(404).json({ code: 'NOT_FOUND', message: 'No such job' });
      res.json(await repo.getStudioVersion(job.versionId));
    } catch (err) { next(err); }
  });

  app.post('/api/studio/jobs', requireWriter, async (req, res, next) => {
    try {
      const doc = req.body && req.body.document;
      if (!doc || !doc.name) return res.status(400).json({ code: 'INVALID', message: 'document.name required' });
      const versionId = (req.body.versionId || `ew-${crypto.randomUUID()}`).slice(0, 64);
      const projectId = (req.body.projectId || `proj-${crypto.randomUUID()}`).slice(0, 64);
      const saved = await repo.importStudioVersion({
        key: versionId,
        file: `${String(doc.name).slice(0, 60)}.json`,
        projectId,
        projectName: String(doc.name).slice(0, 300),
        location: null,
        versionId,
        scenarioKey: versionId.slice(0, 40),
        scenarioRole: 'site',
        sort: 1000,
        aerial: null,
        grading: null,
        projectFlags: ['built in the studio; estimator, outcome and prices were not supplied'],
        extraFlags: [],
      }, { gridBytes: Buffer.from(JSON.stringify(doc)) });
      res.status(201).json(saved);
    } catch (err) { next(err); }
  });

  app.put('/api/studio/jobs/:key', requireWriter, async (req, res, next) => {
    try {
      const jobs = await repo.listStudioJobs();
      const job = jobByKey(jobs, req.params.key);
      if (!job) return res.status(404).json({ code: 'NOT_FOUND', message: 'No such job' });
      const saved = await repo.saveStudioState(job.versionId, req.body || {}, { expectedRev: req.body && req.body.rev });
      res.json(saved);
    } catch (err) { next(err); }
  });

  app.get('/api/studio/rates', requireUser, async (_req, res, next) => {
    try { res.json(await repo.getStudioRates()); } catch (err) { next(err); }
  });

  app.put('/api/studio/rates', requireWriter, async (req, res, next) => {
    try {
      const body = req.body || {};
      const saved = await repo.saveStudioRates(body.document || {}, { expectedRev: body.rev });
      res.json({ id: saved.id, rev: saved.rev });
    } catch (err) { next(err); }
  });

  app.post('/api/studio/jobs/:key/outcome', requireWriter, async (req, res, next) => {
    try {
      const jobs = await repo.listStudioJobs();
      const job = jobByKey(jobs, req.params.key);
      if (!job) return res.status(404).json({ code: 'NOT_FOUND', message: 'No such job' });
      const status = req.body && req.body.status;
      let snapshotId = req.body && req.body.bidSnapshotId;
      if (!snapshotId && job.projectId === 'ce08cc827c') {
        const [outcome] = await repo.list('bid_outcomes', { project_id: job.projectId });
        snapshotId = outcome ? outcome.bid_snapshot_id : null;
      }
      const row = await repo.recordBidOutcome(job.projectId, {
        status,
        bid_snapshot_id: snapshotId || undefined,
        decision_date: req.body.decisionDate || null,
        awarded_to_name: req.body.awardedToName || null,
        winning_amount: req.body.winningAmount == null ? null : req.body.winningAmount,
        notes: req.body.notes || null,
      });
      res.json({ id: row.id, status: row.status, projectId: job.projectId });
    } catch (err) { next(err); }
  });

  app.post('/api/projects/:id/open-items', requireWriter, async (req, res, next) => {
    try {
      const project = await repo.get('projects', req.params.id);
      if (!project) return res.status(404).json({ code: 'NOT_FOUND', message: 'No such project' });
      const text = req.body && req.body.text;
      if (!text) return res.status(400).json({ code: 'INVALID', message: 'text required' });
      const row = await repo.insert('open_items', {
        project_id: project.id,
        body: String(text),
        status: (req.body && req.body.status) || 'open',
        source: 'studio',
      });
      res.status(201).json({ id: row.id });
    } catch (err) { next(err); }
  });

  app.post('/api/library/quotes', requireWriter, async (req, res, next) => {
    try {
      const row = await repo.upsertLibraryItem('quotes', req.body || {});
      res.json({ id: row.id });
    } catch (err) { next(err); }
  });

  app.post('/api/files', requireWriter, async (req, res, next) => {
    try {
      const body = req.body || {};
      if (!body.filename || !body.base64) return res.status(400).json({ code: 'INVALID', message: 'filename and base64 required' });
      const bytes = Buffer.from(body.base64, 'base64');
      const meta = await repo.storeFile({ filename: body.filename, mime: body.mime || 'application/octet-stream', bytes });
      if (body.projectId) {
        const project = await repo.get('projects', body.projectId);
        if (!project) return res.status(404).json({ code: 'NOT_FOUND', message: 'No such project' });
        await repo.insert('plan_sets', {
          project_id: project.id,
          plan_key: body.planKey || meta.id,
          name: body.filename,
          file_path: body.filename,
          stored_file_id: meta.id,
          size_bytes: bytes.length,
          uploaded_at: new Date().toISOString(),
        });
      }
      res.status(201).json({ id: meta.id, sha256: meta.sha256, size: bytes.length });
    } catch (err) { next(err); }
  });

  app.get('/api/files/:id', requireUser, async (req, res, next) => {
    try {
      const file = await repo.getFile(req.params.id);
      if (!file || !file.bytes) return res.status(404).end();
      res.setHeader('Content-Type', file.mime || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${String(file.filename || 'file').replace(/"/g, '')}"`);
      res.send(file.bytes);
    } catch (err) { next(err); }
  });

  app.get('/api/projects', requireUser, async (_req, res, next) => {
    try { res.json(await repo.listProjects()); } catch (err) { next(err); }
  });

  app.get('/api/reports/:name', requireUser, async (req, res, next) => {
    try { res.json(await repo.report(req.params.name, req.query.project_id ? { project_id: req.query.project_id } : {}, { limit: 500 })); }
    catch (err) { next(err); }
  });

  // Job grids and imagery are the company record. With a password set, they are not served anonymously.
  app.use((req, res, next) => {
    if (!password) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (/\.(json|png)$/i.test(req.path) && !req.auth) {
      return res.status(401).json({ code: 'AUTH', message: 'Sign in first.' });
    }
    next();
  });

  app.use((req, res, next) => {
    if (STATIC_DENY.some((re) => re.test(req.path))) return res.status(404).end();
    next();
  });
  app.use(express.static(root, { index: 'index.html', dotfiles: 'deny', extensions: ['html'] }));

  app.use((err, _req, res, _next) => {
    const status = err.status || (err instanceof RepoError ? err.status : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ code: err.code || 'ERROR', message: err.message || 'error' });
  });

  app.locals.catalog = STUDIO_JOBS;
  return app;
}

function listen(app, port) {
  return new Promise((resolve) => {
    const server = app.listen(port, '0.0.0.0', () => resolve(server));
  });
}

module.exports = { createApp, listen, jobByKey };
