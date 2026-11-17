'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freshRepo, miniDoc } = require('./helpers');
const { openDb } = require('../db/client');
const { createRepo } = require('../db/repo');

test('RESTART: data persists in a PGLITE_DIR across close/reopen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-pglite-'));
  try {
    let repo = await freshRepo({ pgliteDir: dir });
    const doc = await repo.createProject(miniDoc('restart-1'));
    const file = await repo.storeFile({ filename: 'plan.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.7 test') });
    const exp = await repo.recordExport('restart-1', { export_type: 'client_xlsx', filename: 'bid.xlsx', bytes: Buffer.from('xlsx-bytes') });
    const run = await repo.recordAiRun('restart-1', { model: 'test-model', prompt: 'count inlets', results: [{ id: 'r1', description: 'Inlet', qty: 4, unit: 'EA' }] });
    await repo.close();

    repo = createRepo(await openDb({ url: '', pgliteDir: dir }));
    assert.deepStrictEqual(await repo.getProject('restart-1'), doc);
    assert.equal((await repo.getFile(file.id)).bytes.toString(), '%PDF-1.7 test');
    const [e] = await repo.list('exports', { project_id: 'restart-1' });
    assert.equal(e.id, exp.id);
    assert.equal((await repo.getFile(e.stored_file_id)).bytes.toString(), 'xlsx-bytes');
    const [r] = await repo.list('ai_runs', { project_id: 'restart-1' });
    assert.equal(r.id, run.id);
    assert.equal((await repo.list('ai_run_results', { ai_run_id: run.id })).length, 1);
    assert.ok((await repo.activity({ project_id: 'restart-1' })).length >= 3);
    await repo.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
