'use strict';
/**
 * Load supplier quotes from db/seed-data/quotes/*.json into the quote library and apply their prices to a
 * project's studio jobs. Each file: { quote, projectId, apply: [{ line, pipe?: sys, struct?: { sys, match } }] }.
 *   pipe: every pipe bid item of that system ("pipe:<sys> ...") takes the line's unit price.
 *   struct: every structure bid item of that system whose type matches the regex takes it.
 * The quote is written when it is new or its content changed. Prices are applied once per quote (marker
 * quote.applied.<id> in app_settings), so later edits in the studio are never overwritten by a deploy.
 *   npm run db:import-quotes
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { eq } = require('drizzle-orm');
const S = require('./schema');
const { openDb } = require('./client');
const { migrate } = require('./migrate');
const { createRepo } = require('./repo');
const { runWithContext } = require('./context');

const DIR = path.join(__dirname, 'seed-data', 'quotes');
const getSetting = async (repo, key) => { const [r] = await repo.handle.db.select().from(S.app_settings).where(eq(S.app_settings.setting_key, key)); return r ? JSON.parse(r.setting_value) : null; };

function bidKeys(utilities) {
  const U = utilities || {}, pipes = new Map(), structs = new Map();
  (U.pipes || []).forEach((q) => { pipes.set(`pipe:${q.sys} ${q.size}" ${q.mat}`, q.sys); });
  (U.structs || []).forEach((q) => { structs.set(`st:${q.sys} ${q.type}`, { sys: q.sys, type: q.type }); });
  return { pipes, structs };
}

async function importQuotes(repo, { dir = DIR } = {}) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const spec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const q = spec.quote;
    // write the quote when the file is new or changed (a hash of the file's quote is kept in app_settings)
    const sha = crypto.createHash('sha256').update(JSON.stringify(q)).digest('hex').slice(0, 16);
    const shaKey = `quote.sha.${q.id}`.slice(0, 60);
    const wrote = (await getSetting(repo, shaKey)) !== sha || !(await repo.getLibraryItem('quotes', q.id));
    if (wrote) { await repo.upsertLibraryItem('quotes', q); await repo.setSetting(shaKey, sha); }
    if (spec.projectId && (await repo.get('projects', spec.projectId))) {
      const [link] = await repo.list('project_quotes', { project_id: spec.projectId, vendor_quote_id: q.id });
      if (!link) await repo.insert('project_quotes', { id: crypto.randomUUID(), project_id: spec.projectId, vendor_quote_id: q.id, link_source: 'manual' });
    }
    const marker = `quote.applied.${q.id}`.slice(0, 60);
    const done = await getSetting(repo, marker);
    const applied = [];
    if (!done && spec.projectId && Array.isArray(spec.apply)) {
      const lines = new Map((q.items || []).map((l) => [l.id, l]));
      const jobs = (await repo.listStudioJobs()).filter((j) => j.projectId === spec.projectId);
      for (const job of jobs) {
        const utilities = (job.editor && job.editor.utilities) || (await repo.getStudioDocument(job.versionId)).utilities;
        const { pipes, structs } = bidKeys(utilities);
        const prices = {};
        for (const a of spec.apply) {
          const l = lines.get(a.line);
          if (!l || l.unitPrice == null) continue;
          const matQuote = { id: q.id, line: l.id, vendor: q.vendor, quoteNo: q.quoteNo || '' };
          if (a.pipe) for (const [k, sys] of pipes) if (sys === a.pipe) prices[k] = { mat: l.unitPrice, matQuote };
          if (a.struct) { const re = new RegExp(a.struct.match, 'i'); for (const [k, s] of structs) if (s.sys === a.struct.sys && re.test(s.type)) prices[k] = { mat: l.unitPrice, matQuote }; }
        }
        if (Object.keys(prices).length) { await repo.applyBidPrices(job.versionId, prices); applied.push(`${job.key}: ${Object.keys(prices).length} items`); }
      }
      await repo.setSetting(marker, { at: new Date().toISOString(), jobs: applied });
    }
    out.push({ file: f, quote: q.id, wrote, applied: done ? 'already applied' : applied.join('; ') || 'nothing matched' });
  }
  return out;
}

if (require.main === module) {
  (async () => {
    const h = await openDb();
    try {
      await migrate(h);
      const repo = createRepo(h);
      const res = await runWithContext({ request_id: `quote-import-${Date.now()}` }, () => importQuotes(repo));
      console.table(res);
    } finally { await h.close(); }
  })().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { importQuotes, bidKeys };
