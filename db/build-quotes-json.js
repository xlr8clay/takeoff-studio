'use strict';
/**
 * Write quotes.json next to the page from db/seed-data/quotes/*.json, for copies with no server (claude.ai
 * artifact, GitHub Pages). Each entry keeps the quote and its apply rules, with the project and job versions
 * turned into the job file names the page loads. The page lists these quotes and fills their prices into a
 * job's bid the first time that job is opened in a browser that has no saved bid for it.
 *   node db/build-quotes-json.js
 */
const fs = require('node:fs');
const path = require('node:path');
const { STUDIO_JOBS } = require('./studio-catalog');

const DIR = path.join(__dirname, 'seed-data', 'quotes');
const OUT = path.join(__dirname, '..', 'quotes.json');

function build() {
  const fileOf = new Map(STUDIO_JOBS.map((j) => [j.versionId, j.file]));
  const out = [];
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.json')).sort()) {
    const spec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const files = STUDIO_JOBS.filter((j) => j.projectId === spec.projectId).map((j) => j.file);
    out.push({
      quote: spec.quote,
      files,
      apply: (spec.apply || []).map(({ versions, rev, ...a }) => (versions ? { ...a, files: versions.map((v) => fileOf.get(v)).filter(Boolean) } : a)),
    });
  }
  return out;
}

if (require.main === module) {
  const q = build();
  fs.writeFileSync(OUT, JSON.stringify(q, null, 1) + '\n');
  console.log(`wrote ${OUT}: ${q.length} quote(s)`);
}

module.exports = { build };
