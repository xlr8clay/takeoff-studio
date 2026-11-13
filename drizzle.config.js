'use strict';
// drizzle-kit config. `npm run db:generate` diffs db/schema.js against db/migrations and writes new SQL.
// Generation needs no database connection; DATABASE_URL is only used by `drizzle-kit studio`/`push`.
const { defineConfig } = require('drizzle-kit');

module.exports = defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.js',
  out: './db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL || 'postgresql://localhost:5432/postgres' },
  strict: true,
  verbose: true,
});
