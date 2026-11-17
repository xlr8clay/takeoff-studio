'use strict';
/**
 * Apply db/migrations (drizzle journal) to the configured database. Idempotent.
 *   npm run db:migrate
 * Uses drizzle's own migrator (table drizzle.__drizzle_migrations) for both pg and PGlite.
 */
const path = require('node:path');
const { openDb } = require('./client');

const MIGRATIONS = path.join(__dirname, 'migrations');

async function migrate(handle) {
  const mod = handle.kind === 'pg' ? require('drizzle-orm/node-postgres/migrator') : require('drizzle-orm/pglite/migrator');
  await mod.migrate(handle.db, { migrationsFolder: MIGRATIONS });
}

if (require.main === module) {
  (async () => {
    const h = await openDb();
    try {
      await migrate(h);
      console.log(`migrations applied (${h.label})`);
    } finally {
      await h.close();
    }
  })().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { migrate };
