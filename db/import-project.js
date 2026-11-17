'use strict';
/**
 * Import one or more old-app per-job JSON files (same shape as seed-data/bucees-49.project.json).
 * Existing ids are overwritten as a new rev (history is in activity_log); new ids are created.
 *   npm run db:import-project -- data/jobs/*.json [--estimator emp-clay] [--region FL-SWFL] [--status bidding]
 */
const fs = require('node:fs');
const { openDb } = require('./client');
const { createRepo } = require('./repo');
const { runWithContext } = require('./context');

function parseArgs(argv) {
  const files = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--estimator') opts.estimatorId = argv[++i];
    else if (a === '--region') opts.regionCode = argv[++i];
    else if (a === '--status') opts.status = argv[++i];
    else files.push(a);
  }
  return { files, opts };
}

async function importFiles(repo, files, opts = {}) {
  const out = [];
  for (const f of files) {
    const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
    const saved = await repo.importProject(doc, opts);
    out.push({ file: f, id: saved.id, rev: saved.rev, lines: (saved.lines || []).length });
  }
  return out;
}

if (require.main === module) {
  const { files, opts } = parseArgs(process.argv.slice(2));
  if (!files.length) { console.error('usage: npm run db:import-project -- <file.json> [...] [--estimator <employee_id>] [--region <code>]'); process.exit(2); }
  (async () => {
    const h = await openDb();
    try {
      const res = await runWithContext({ request_id: `import-${Date.now()}` }, () => importFiles(createRepo(h), files, opts));
      console.table(res);
    } finally { await h.close(); }
  })().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { importFiles, parseArgs };
