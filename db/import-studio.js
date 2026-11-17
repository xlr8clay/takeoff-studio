'use strict';
/**
 * Load Earthwork Takeoff Studio job files into Postgres.
 * Idempotent: a second run with the same files does not write again.
 *   npm run db:import-studio
 *   npm run db:import-studio -- --root /path/to/studio
 */
const path = require('node:path');
const { openDb } = require('./client');
const { migrate } = require('./migrate');
const { createRepo } = require('./repo');
const { runWithContext } = require('./context');
const { STUDIO_JOBS } = require('./studio-catalog');

function resolveJob(job, root) {
  return {
    ...job,
    paths: {
      grid: path.join(root, job.file),
      aerial: job.aerial ? path.join(root, job.aerial) : null,
      grading: job.grading ? path.join(root, job.grading) : null,
    },
  };
}

async function importStudio(repo, { root, jobs = STUDIO_JOBS } = {}) {
  const out = [];
  for (const job of jobs) {
    const item = job.paths ? job : resolveJob(job, root);
    const res = await repo.importStudioVersion(item, item.paths);
    out.push({ key: item.key || item.scenarioKey, file: item.file, ...res });
  }
  return out;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let root = path.join(__dirname, '..');
  for (let i = 0; i < args.length; i++) if (args[i] === '--root') root = args[++i];
  (async () => {
    const h = await openDb();
    try {
      await migrate(h);
      const repo = createRepo(h);
      const res = await runWithContext({ request_id: `studio-import-${Date.now()}` }, () => importStudio(repo, { root }));
      console.table(res.map((r) => ({ key: r.key, id: r.id, rev: r.rev, skipped: !!r.skipped, reason: r.reason || '' })));
    } finally { await h.close(); }
  })().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { importStudio, resolveJob };
