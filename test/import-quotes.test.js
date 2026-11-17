'use strict';
// Quote importer: the Core & Main quote lands in the library, links to Innovation Building #2 and prices the
// matching bid items in its three studio jobs once; a second run writes nothing and later edits are kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { freshRepo } = require('./helpers');
const { runWithContext } = require('../db/context');
const { importStudio } = require('../db/import-studio');
const { importQuotes } = require('../db/import-quotes');
const { STUDIO_JOBS } = require('../db/studio-catalog');

test('Core & Main quote prices the Innovation jobs once', async () => {
  const repo = await freshRepo({ withSeed: true });
  const jobs = STUDIO_JOBS.filter((j) => j.projectId === 'proj-innovation-b2');
  assert.equal(jobs.length, 3);
  await runWithContext({ request_id: 't' }, () => importStudio(repo, { root: path.join(__dirname, '..'), jobs }));
  const before = new Map((await repo.listStudioJobs()).map((j) => [j.versionId, j.rev]));

  const [r1] = await runWithContext({ request_id: 't' }, () => importQuotes(repo));
  assert.equal(r1.quote, 'q-coremain-5350952');
  assert.equal(r1.wrote, true);
  assert.equal(r1.applied, 'phases-2-3: 8 items; phase-2: 6 items; phase-3: 6 items');

  const q = await repo.getLibraryItem('quotes', 'q-coremain-5350952');
  assert.equal(q.items.length, 8);
  const [link] = await repo.list('project_quotes', { project_id: 'proj-innovation-b2', vendor_quote_id: q.id });
  assert.ok(link);

  for (const j of (await repo.listStudioJobs()).filter((x) => x.projectId === 'proj-innovation-b2')) {
    assert.equal(j.rev, before.get(j.versionId) + 1, 'job revision bumped so open pages reload');
    const items = j.bid.items;
    const mat = (prefix) => Object.entries(items).find(([k]) => k.startsWith(prefix))?.[1]?.mat;
    assert.equal(mat('pipe:Wastewater'), 8.78);
    assert.equal(mat('pipe:Water'), 14.0399);
    assert.equal(mat('pipe:Storm'), 20.9281);
    assert.equal(mat('st:Storm inlet'), 2560.71);
    assert.equal(mat('st:Wastewater manhole'), 2926.1789);
    assert.equal(mat('st:Wastewater cleanout'), 411.32);
    assert.equal(mat('st:Storm FUTURE'), undefined, 'FUTURE structures are not priced');
    assert.equal(items['pipe:Storm 24" size not labelled'].matQuote.vendor, 'Core & Main (Pflugerville)');
    const custom = j.bid.custom || [];
    if (j.versionId === 'ew-innovation-phases') {
      assert.deepEqual(custom.map((c) => [c.desc, c.qty]), [['Sewer detection tape, 12x1000 ft rolls', 8], ['Fire hydrant assembly', 14]]);
      assert.equal(items[custom[1].key].mat, 5500);
      assert.equal(items[custom[0].key].mat, 10);
    } else assert.equal(custom.length, 0, 'hydrants and tape only on the Phases 2 and 3 job');
  }

  // an estimator changes a price; the next start does not put the quote back
  const phases = (await repo.listStudioJobs()).find((j) => j.versionId === 'ew-innovation-phases');
  await repo.applyBidPrices(phases.versionId, { 'pipe:Water 8" size not labelled': { mat: 15 } });
  const [r2] = await runWithContext({ request_id: 't' }, () => importQuotes(repo));
  assert.equal(r2.wrote, false);
  assert.equal(r2.applied, 'already applied');
  const after = (await repo.listStudioJobs()).find((j) => j.versionId === 'ew-innovation-phases');
  assert.equal(after.bid.items['pipe:Water 8" size not labelled'].mat, 15);

  // a database that took the first version of the quote (rev 1 marker) gets only the new lines
  await repo.setSetting('quote.applied.q-coremain-5350952', { at: 'earlier' });
  const fhKey = after.bid.custom.find((c) => c.desc === 'Fire hydrant assembly').key;
  await repo.applyBidPrices(phases.versionId, { [fhKey]: { mat: 1 } });
  const [r3] = await runWithContext({ request_id: 't' }, () => importQuotes(repo));
  assert.equal(r3.applied, 'phases-2-3: 2 items');
  const last = (await repo.listStudioJobs()).find((j) => j.versionId === 'ew-innovation-phases');
  assert.equal(last.bid.items[fhKey].mat, 5500);
  assert.equal(last.bid.items['pipe:Water 8" size not labelled'].mat, 15, 'earlier lines are not put back');
  assert.equal(last.bid.custom.length, 2, 'custom lines are not added twice');
});

test('quotes.json (the copy for pages without a server) matches db/seed-data/quotes', () => {
  const { build } = require('../db/build-quotes-json');
  const shipped = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'quotes.json'), 'utf8'));
  assert.deepEqual(shipped, build(), 'run: node db/build-quotes-json.js');
});
