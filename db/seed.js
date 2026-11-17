'use strict';
/**
 * Idempotent seed (safe to re-run): roles, WPM company, regions, cost codes, the HEB/TX library from
 * seed-data/library.json, standard note + exclusion templates, the five known employees, and the
 * Buc-ee's #49 sample project (Clay = estimator, bid outcome pending).
 *   npm run db:seed            (runs migrations first)
 * Nothing here invents people, wages, outcomes or costs: unknown values are NULL.
 */
const path = require('node:path');
const { openDb } = require('./client');
const { migrate } = require('./migrate');
const { createRepo } = require('./repo');
const { runWithContext } = require('./context');

const LIBRARY = require('./seed-data/library.json');
const BUCEES_FILE = path.join(__dirname, 'seed-data', 'bucees-49.project.json');

const ROLES = [
  { id: 'role-admin', code: 'admin', name: 'Administrator', description: 'Full access incl. users and library' },
  { id: 'role-estimator', code: 'estimator', name: 'Estimator', description: 'Create and edit projects / bids' },
  { id: 'role-viewer', code: 'viewer', name: 'Viewer', description: 'Read-only' },
];
const REGIONS = [
  { id: 'rgn-tx-heb', code: 'TX-HEB', name: 'Texas - HEB production-rate market', state: 'TX', market_type: 'rate_library' },
  { id: 'rgn-fl-swfl', code: 'FL-SWFL', name: 'Florida - Southwest Florida', state: 'FL', market_type: 'market' },
  { id: 'rgn-fdot-ma10', code: 'FDOT-MA10', name: 'FDOT Market Area 10', state: 'FL', market_type: 'fdot_market_area' },
];
// Generic civil divisions only (no company-specific numbering invented).
const COST_CODES = [
  ['01', 'General Conditions', 'other'], ['02', 'Demolition & Clearing', null], ['03', 'Erosion Control', null],
  ['04', 'Earthwork & Grading', null], ['05', 'Dewatering', null], ['06', 'Storm Drainage', null], ['07', 'Sanitary Sewer', null],
  ['08', 'Water & Fire Protection', null], ['09', 'Force Main & Lift Station', null], ['10', 'Paving & Base', null],
  ['11', 'Site Concrete', null], ['12', 'Striping & Signage', null], ['13', 'Trucking & Hauling', 'trucking'],
  ['14', 'Traffic Control / MOT', null], ['15', 'Survey & Testing', 'sub'],
].map(([code, name, cost_type], i) => ({ id: `cc-${code}`, code, name, division: name, cost_type, sort_order: i }));

const STANDARD_NOTES = [
  'General fill to be 40 PI or less.',
  'Existing excess material to be placed on future sites and remain onsite.',
  'Discount for select fill above 18 PI upon approval.',
];
const STANDARD_EXCLUSIONS = [
  'Payment or performance bonds, fire hydrant bollards.',
  'SWPPP or erosion control measures; testing of materials (e.g., proctors, density testing).',
  'Concrete traffic barriers, arrow boards, scorpion trucks, water-filled barriers.',
  'Dewatering of existing groundwater, taps on asbestos pipe, grease traps, sample wells, bores or tunneling.',
  'Removal or replacement of existing structures (including fences).',
  'Removal or replacement of existing pavements, other than what is itemized above.',
  'Payment or furnishing of services for laboratory testing; clearing, prep, or restoration of public right-of-way.',
  'Seeding or sodding, tree protection, finish landscaping, impact fees, capital recovery fees.',
  'Handling or removal of contaminated or otherwise objectionable material.',
  'Removal and/or relocation (including costs) of existing utilities or irrigation systems.',
  'Fill material containing large debris or boulders; all meters or fees; backflow preventers (except as noted).',
  "Any additional insurance beyond standard liability and workers' compensation coverage.",
  'Night work, unknown utility conflicts.',
];

// EXACTLY these five people. Only Clay has anything beyond a first name.
const EMPLOYEES = [
  { id: 'emp-zach', first_name: 'Zach' },
  {
    id: 'emp-clay', first_name: 'Clay', last_name: 'Deering', display_name: 'Clay Deering', title_role: 'estimator',
    phone: '830-499-3860', email: 'cdeering@wpmcivil.com',
  },
  { id: 'emp-darren', first_name: 'Darren' },
  { id: 'emp-joe', first_name: 'Joe' },
  { id: 'emp-charles', first_name: 'Charles' },
];

const HEB_LIBRARY = { id: 'lib-heb-tx', name: 'HEB Production Rates (TX)', source: 'HEB', region_id: 'rgn-tx-heb', description: 'HEB crew production assumptions, Texas rates (verify for FL).' };
const HEB_VERSION = {
  id: 'ver-heb-tx-1', rate_library_id: 'lib-heb-tx', version_label: 'TX (from Buc-ee\'s workbook)', region_id: 'rgn-tx-heb',
  source: "Buc-ee's workbook / Production Assumptions", is_current: true,
};

async function ensure(repo, table, row) {
  const ex = await repo.get(table, row.id, { includeDeleted: true });
  return ex || repo.insert(table, row);
}

async function seed(repo, { projectFile = BUCEES_FILE } = {}) {
  for (const r of ROLES) await ensure(repo, 'roles', r);
  for (const r of REGIONS) await ensure(repo, 'regions', r);
  const c = LIBRARY.settings.company;
  await ensure(repo, 'companies', {
    id: 'co-wpm', name: c.name, company_type: 'self', address1: c.address1, city: 'Austin', state: 'TX', postal_code: '78744',
    phone: c.phone, email: c.email,
  });
  await ensure(repo, 'contacts', { id: 'ct-wpm-clay', company_id: 'co-wpm', first_name: 'Clay', last_name: 'Deering', phone: c.phone, email: c.email });
  for (const cc of COST_CODES) await ensure(repo, 'cost_codes', cc);
  for (let i = 0; i < STANDARD_NOTES.length; i++) await ensure(repo, 'note_templates', { id: `note-std-${i + 1}`, template_name: 'standard', sort_order: i + 1, body: STANDARD_NOTES[i] });
  for (let i = 0; i < STANDARD_EXCLUSIONS.length; i++) await ensure(repo, 'exclusion_templates', { id: `excl-std-${i + 1}`, template_name: 'standard', sort_order: i + 1, body: STANDARD_EXCLUSIONS[i] });
  for (const e of EMPLOYEES) await ensure(repo, 'employees', e);

  // ---- library
  const lib = await repo.getLibrary();
  if (!lib.seeded) {
    await repo.setSetting('library.settings', LIBRARY.settings);
    await ensure(repo, 'rate_libraries', HEB_LIBRARY);
    await ensure(repo, 'rate_library_versions', HEB_VERSION);
    for (const [i, cr] of LIBRARY.crews.entries()) if (!(await repo.getLibraryItem('crews', cr.id))) await repo.upsertLibraryItem('crews', cr, { sort: i });
    for (const [i, r] of LIBRARY.rates.entries()) if (!(await repo.getLibraryItem('rates', r.id, { versionId: HEB_VERSION.id }))) await repo.upsertLibraryItem('rates', r, { versionId: HEB_VERSION.id, sort: i });
    for (const [i, q] of LIBRARY.quotes.entries()) if (!(await repo.getLibraryItem('quotes', q.id))) await repo.upsertLibraryItem('quotes', q, { sort: i });
    for (const [i, f] of LIBRARY.fdot.entries()) {
      if (await repo.getLibraryItem('fdot', f.id)) continue;
      const row = await repo.upsertLibraryItem('fdot', f, { sort: i });
      await repo.update('fdot_reference_prices', row.id, { region_id: 'rgn-fdot-ma10' });
    }
    await repo.setSetting('library.seeded', LIBRARY.seeded);
  }

  // ---- Buc-ee's #49 sample project
  const doc = require(projectFile);
  if (!(await repo.get('projects', doc.id, { includeDeleted: true }))) {
    await repo.createProject(doc, { estimatorId: 'emp-clay', regionCode: 'FL-SWFL', status: 'bidding' });
    await repo.snapshotRates(doc.id);
    await repo.createBidSnapshot(doc.id, { reason: 'submission', submitted_on: doc.bidDate || null });
    await repo.recordBidOutcome(doc.id, { status: 'pending' }); // all outcome fields NULL until known
  }
  return { projectId: doc.id };
}

if (require.main === module) {
  (async () => {
    const h = await openDb();
    try {
      await migrate(h);
      const repo = createRepo(h);
      await runWithContext({ request_id: `seed-${Date.now()}` }, () => seed(repo));
      const n = await h.query('select (select count(*) from production_rates) rates, (select count(*) from employees) employees, (select count(*) from projects) projects');
      console.log(`seeded (${h.label}):`, n[0]);
    } finally {
      await h.close();
    }
  })().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { seed, EMPLOYEES, STANDARD_NOTES, STANDARD_EXCLUSIONS, ROLES, REGIONS, COST_CODES };
