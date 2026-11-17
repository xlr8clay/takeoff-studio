'use strict';
/**
 * Earthwork Takeoff Studio server.
 * Binds 0.0.0.0:$PORT (Render sets PORT). Postgres when DATABASE_URL is set, else PGlite.
 * Does not embed a database URL. Refuses to boot in production without APP_PASSWORD.
 */
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('../db/client');
const { migrate } = require('../db/migrate');
const { seed } = require('../db/seed');
const { createRepo } = require('../db/repo');
const { runWithContext } = require('../db/context');
const { importStudio } = require('../db/import-studio');
const { createApp, listen } = require('./app');

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] != null) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    process.env[key] = val;
  }
}

async function main() {
  loadEnvFile();
  const production = process.env.NODE_ENV === 'production';
  const password = process.env.APP_PASSWORD || '';
  if (production && !password) {
    console.error('APP_PASSWORD is required when NODE_ENV=production. Set it in the Render dashboard. Refusing to start.');
    process.exit(1);
  }
  const root = path.join(__dirname, '..');
  const handle = await openDb();
  await migrate(handle);
  const repo = createRepo(handle);
  await runWithContext({ request_id: `boot-${Date.now()}` }, async () => {
    await seed(repo);
    if (process.env.STUDIO_IMPORT !== '0') {
      const imported = await importStudio(repo, { root });
      const fresh = imported.filter((r) => !r.skipped).length;
      console.log(`studio jobs: ${imported.length} (${fresh} written, ${imported.length - fresh} unchanged)`);
    }
  });
  const app = createApp({ repo, root, password });
  const port = Number(process.env.PORT || 3000);
  const server = await listen(app, port);
  console.log(`Earthwork Takeoff Studio on 0.0.0.0:${port} (${handle.label})`);
  const shutdown = async () => {
    server.close();
    await handle.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
