'use strict';
/**
 * LOCAL ONLY: wipe the database, re-run migrations and seed.
 *  - PGlite: deletes PGLITE_DIR (default ./.pglite).
 *  - Postgres: only if DATABASE_URL points at localhost/127.0.0.1/::1; drops schemas public + drizzle.
 * Refuses any other host (e.g. Render).
 */
const fs = require('node:fs');
const path = require('node:path');

function isLocalUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return ['localhost', '127.0.0.1', '::1'].includes(host);
  } catch { return false; }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (url && !isLocalUrl(url)) {
    console.error('db:reset refused: DATABASE_URL is not localhost. Reset is for local development only.');
    process.exit(1);
  }
  const { openDb } = require('./client');
  if (!url) {
    const dir = process.env.PGLITE_DIR || './.pglite';
    if (dir !== 'memory') fs.rmSync(path.resolve(dir), { recursive: true, force: true });
  } else {
    const h = await openDb();
    await h.query('drop schema if exists drizzle cascade');
    await h.query('drop schema public cascade');
    await h.query('create schema public');
    await h.close();
  }
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, [path.join(__dirname, 'seed.js')], { stdio: 'inherit' });
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { isLocalUrl };
