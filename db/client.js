'use strict';
/**
 * Provider switch.
 *   DATABASE_URL set   -> node-postgres Pool (Render: postgresql://USER:PASS@HOST:5432/DB)
 *                         SSL on by default (rejectUnauthorized:false); DATABASE_SSL=false disables it.
 *                         DB_POOL_MAX (default 5).
 *   DATABASE_URL unset -> PGlite (embedded Postgres, WASM) at PGLITE_DIR (default ./.pglite);
 *                         PGLITE_DIR=memory -> in-memory (tests).
 *
 * openDb(opts?) -> { db (drizzle), kind: 'pg'|'pglite', query(text, params) -> rows, close() }
 * opts override env: { url, pgliteDir }
 */
const path = require('node:path');
const schema = require('./schema');

function redact(url) {
  return String(url).replace(/\/\/([^:@/]+):[^@]*@/, '//$1:***@');
}

async function openDb(opts = {}) {
  const url = opts.url !== undefined ? opts.url : process.env.DATABASE_URL;
  if (url) {
    const { Pool } = require('pg');
    const { drizzle } = require('drizzle-orm/node-postgres');
    const sslOff = String(process.env.DATABASE_SSL || '').toLowerCase() === 'false';
    const pool = new Pool({
      connectionString: url,
      ssl: sslOff ? false : { rejectUnauthorized: false },
      max: Number(process.env.DB_POOL_MAX || 5),
    });
    const db = drizzle(pool, { schema });
    return {
      db, kind: 'pg', label: redact(url),
      query: async (text, params = []) => (await pool.query(text, params)).rows,
      close: () => pool.end(),
    };
  }
  const { PGlite } = require('@electric-sql/pglite');
  const { drizzle } = require('drizzle-orm/pglite');
  const dir = opts.pgliteDir || process.env.PGLITE_DIR || './.pglite';
  const client = dir === 'memory' ? new PGlite() : new PGlite(path.resolve(dir));
  await client.waitReady;
  const db = drizzle(client, { schema });
  return {
    db, kind: 'pglite', label: dir === 'memory' ? 'pglite:memory' : `pglite:${path.resolve(dir)}`,
    query: async (text, params = []) => (await client.query(text, params)).rows,
    close: () => client.close(),
  };
}

module.exports = { openDb, redact };
