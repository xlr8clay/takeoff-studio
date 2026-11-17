'use strict';
const { openDb } = require('../db/client');
const { migrate } = require('../db/migrate');
const { createRepo } = require('../db/repo');
const { seed } = require('../db/seed');

/** Fresh in-memory PGlite (or a dir), migrated, optionally seeded. Never touches DATABASE_URL. */
async function freshRepo({ withSeed = false, pgliteDir = 'memory' } = {}) {
  const h = await openDb({ url: '', pgliteDir });
  await migrate(h);
  const repo = createRepo(h);
  if (withSeed) await seed(repo);
  return repo;
}

/** Minimal valid old-shape project document. */
function miniDoc(id, over = {}) {
  return {
    id, rev: 1, name: `Test project ${id}`, gc: '', location: '', bidDate: '2026-01-10', markupPct: null, taxPct: 0.07,
    avgLoadTons: 20, hoursPerDay: 10, fillTonsPerCY: 1.4, baseTonsPerCY: 1.6,
    sections: [{ id: 's1', name: 'Earthwork', area: 'Onsite', row: 1, division: 'Earthwork' }],
    lines: [{
      id: 'L1', sectionId: 's1', group: '', bidItemRow: 1, description: 'Excavation', unit: 'CY', qty: 1000, include: true,
      sheetRef: '', flag: '', notes: '', priceSource: '', qtySource: 'estimator', aiQty: null, aiConfidence: null, estQty: 1000,
      items: [{ id: 'I1', label: 'Excavate', qty: null, unit: 'CY', production: 500, laborRateHr: 100, equipRateHr: 200, rateRef: 'pa-10' }],
      excludedReason: '', quoteIds: [], proposalGroup: 'EARTHWORK',
    }],
    openItems: [], assumptions: [], plans: [], aiProposals: [], proposal: { title: '', quoteTo: '', footnote: true },
    ...over,
  };
}

const n = (v) => (v === null || v === undefined ? v : Number(v));

module.exports = { freshRepo, miniDoc, n };
