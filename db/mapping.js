'use strict';
/**
 * Lossless JSON <-> row mapping.
 *
 * Each spec entry is [jsonKey, column, type]. A JSON value goes into its typed column only if it survives the
 * round trip exactly (e.g. a number with <= 4 decimals for numeric(18,4), a 'YYYY-MM-DD' string for a date).
 * Anything else - unknown keys, nested objects, values that would lose precision or type - is kept in the
 * row's `extra` text column as JSON, together with `__keys` (original key order, so present-vs-absent and
 * null-vs-missing are preserved). Reading rebuilds the exact original object.
 */
const crypto = require('node:crypto');

const DEC = { n4: 4, n6: 6 };

function fits(v, type) {
  if (type === 'B') return typeof v === 'boolean';
  if (v === null) return true;
  if (type === 'b') return typeof v === 'boolean';
  if (type === 'i') return Number.isInteger(v) && Math.abs(v) < 2 ** 31;
  if (type === 'd') return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  if (type === 'n4' || type === 'n6') {
    if (typeof v !== 'number' || !Number.isFinite(v) || Object.is(v, -0)) return false;
    if (Math.abs(v) >= 10 ** (18 - DEC[type] - 1)) return false;
    return Number(v.toFixed(DEC[type])) === v;
  }
  if (type === 't') return typeof v === 'string';
  const m = /^s(\d+)$/.exec(type);
  if (m) return typeof v === 'string' && v.length <= Number(m[1]);
  throw new Error(`unknown mapping type ${type}`);
}

function fromDb(v, type) {
  if (v === null || v === undefined) return null;
  if (type === 'n4' || type === 'n6' || type === 'i') return Number(v);
  return v;
}

/**
 * @param obj    source JSON object
 * @param spec   [[jsonKey, column, type], ...]
 * @param handled  { jsonKey: (value) => boolean }  keys stored elsewhere (child tables) if the predicate accepts
 * @returns row object (every spec column present) with `extra`
 */
function toRow(obj, spec, handled = {}) {
  const row = {};
  const extra = { __keys: Object.keys(obj) };
  const bySpec = new Map(spec.map((s) => [s[0], s]));
  for (const [, col] of spec) row[col] = null;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const s = bySpec.get(k);
    if (s && v !== undefined && fits(v, s[2])) row[s[1]] = v;
    else if (handled[k] && handled[k](v)) { /* child table */ }
    else extra[k] = v;
  }
  row.extra = JSON.stringify(extra);
  return row;
}

/** children: { jsonKey: value } for keys stored in child tables. */
function fromRow(row, spec, children = {}) {
  const extra = row.extra ? JSON.parse(row.extra) : { __keys: spec.map((s) => s[0]) };
  const bySpec = new Map(spec.map((s) => [s[0], s]));
  const out = {};
  for (const k of extra.__keys) {
    if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
    else if (bySpec.has(k)) { const [, col, type] = bySpec.get(k); out[k] = fromDb(row[col], type); }
    else if (Object.prototype.hasOwnProperty.call(children, k)) out[k] = children[k];
  }
  return out;
}

/** Deterministic child id (<= 64 chars). */
function cid(...parts) {
  const s = parts.join('~');
  return s.length <= 64 ? s : crypto.createHash('sha1').update(s).digest('hex');
}

const isObjArray = (v) => Array.isArray(v) && v.every((x) => x && typeof x === 'object' && !Array.isArray(x));
const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ------------------------------------------------------------------ specs
const SPEC = {
  project: [
    ['name', 'name', 't'], ['gc', 'gc_name', 't'], ['location', 'location', 't'], ['bidDate', 'bid_date', 'd'],
    ['projectNo', 'project_no', 's40'], ['markupPct', 'markup_pct', 'n6'], ['taxPct', 'tax_pct', 'n6'],
    ['avgLoadTons', 'avg_load_tons', 'n4'], ['hoursPerDay', 'hours_per_day', 'n4'],
    ['fillTonsPerCY', 'fill_tons_per_cy', 'n6'], ['baseTonsPerCY', 'base_tons_per_cy', 'n6'], ['isSample', 'is_sample', 'B'],
  ],
  section: [['id', 'section_key', 's64'], ['name', 'name', 't'], ['area', 'area', 's100'], ['division', 'division', 's100'], ['row', 'source_row', 'i']],
  line: [
    ['id', 'line_key', 's64'], ['sectionId', 'section_key', 's64'], ['group', 'group_name', 't'], ['bidItemRow', 'item_no', 'i'],
    ['description', 'description', 't'], ['unit', 'unit', 's20'], ['qty', 'estimator_qty', 'n4'], ['include', 'include_in_bid', 'b'],
    ['sheetRef', 'sheet_ref', 't'], ['flag', 'flag', 't'], ['notes', 'notes', 't'], ['priceSource', 'price_source', 't'],
    ['qtySource', 'qty_source', 's30'], ['aiQty', 'ai_qty', 'n4'], ['aiConfidence', 'ai_confidence', 'n6'], ['estQty', 'est_qty', 'n4'],
    ['excludedReason', 'excluded_reason', 't'], ['proposalGroup', 'proposal_group', 't'], ['fdotId', 'fdot_ref', 's64'],
    ['noBidLine', 'is_no_bid_line', 'b'], ['foldInto', 'fold_into', 's64'], ['foldAuto', 'fold_auto', 'b'],
  ],
  item: [
    ['id', 'item_key', 's64'], ['label', 'label', 't'], ['qty', 'qty', 'n4'], ['unit', 'unit', 's20'], ['production', 'units_per_day', 'n4'],
    ['crewDaysOverride', 'crew_days_override', 'n4'], ['laborRateHr', 'labor_rate_hr', 'n4'], ['equipRateHr', 'equip_rate_hr', 'n4'],
    ['crew', 'crew_name', 's200'], ['rateRef', 'rate_ref', 's64'], ['rateStatus', 'rate_status', 's60'], ['rateSource', 'rate_source', 't'],
    ['rateNote', 'rate_note', 't'], ['qtyNote', 'qty_note', 't'],
  ],
  openItem: [['id', 'item_key', 's64'], ['text', 'body', 't'], ['area', 'area', 's100'], ['qty', 'qty', 'n4'], ['unit', 'unit', 's20'], ['reason', 'reason', 't'], ['lineId', 'line_key', 's64'], ['status', 'status', 's30'], ['source', 'source', 't']],
  assumption: [['id', 'item_key', 's64'], ['text', 'body', 't'], ['status', 'status', 's30'], ['source', 'source', 't']],
  plan: [['id', 'plan_key', 's64'], ['name', 'name', 't'], ['file', 'file_path', 't'], ['pageCount', 'page_count', 'i'], ['size', 'size_bytes', 'i']],
  aiProposal: [
    ['id', 'proposal_key', 's64'], ['status', 'status', 's20'], ['description', 'description', 't'], ['unit', 'unit', 's20'], ['qty', 'qty', 'n4'],
    ['sheet', 'sheet', 't'], ['confidence', 'confidence', 'n6'], ['division', 'division', 's100'], ['method', 'method', 't'],
    ['calculation', 'calculation', 't'], ['notes', 'notes', 't'], ['planFile', 'plan_file', 't'],
  ],
  proposal: [
    ['title', 'title', 't'], ['quoteTo', 'quote_to', 't'], ['quotePhone', 'quote_phone', 's60'], ['quoteFax', 'quote_fax', 's60'],
    ['jobName', 'job_name', 't'], ['datePlans', 'date_plans', 's60'], ['revDate', 'rev_date', 's60'], ['footnote', 'footnote', 'b'],
    ['validityDays', 'validity_days', 'i'],
  ],
  // ---- library
  rate: [
    ['id', 'rate_key', 's64'], ['bidRow', 'bid_row', 'i'], ['item', 'description', 't'], ['unit', 'unit', 's20'], ['status', 'status', 's60'],
    ['hebActivity', 'heb_activity', 't'], ['crew', 'crew_name', 's200'], ['production', 'units_per_day', 'n4'],
    ['laborRateHr', 'labor_rate_hr', 'n4'], ['equipRateHr', 'equip_rate_hr', 'n4'], ['materialUnitCost', 'material_unit_cost', 'n4'],
    ['hebQty', 'heb_qty', 'n4'], ['hebCrewHrs', 'heb_crew_hrs', 'n4'], ['source', 'source', 't'], ['notes', 'notes', 't'],
  ],
  crew: [['id', 'id', 's64'], ['name', 'name', 's200'], ['laborRateHr', 'labor_rate_hr', 'n4'], ['equipRateHr', 'equip_rate_hr', 'n4'], ['source', 'source', 't']],
  quote: [
    ['id', 'id', 's64'], ['sheet', 'sheet', 's200'], ['vendor', 'vendor_name', 's300'], ['quoteNo', 'quote_no', 's100'], ['date', 'quote_date', 'd'],
    ['expires', 'expires_on', 'd'], ['expiresNote', 'expires_note', 't'], ['type', 'quote_type', 's20'], ['scope', 'scope', 't'],
    ['notes', 'notes', 't'], ['source', 'source', 't'], ['taxRate', 'tax_rate', 'n6'], ['complete', 'is_complete', 'b'],
    ['completenessNotes', 'completeness_notes', 't'],
  ],
  quoteLine: [
    ['id', 'line_key', 's64'], ['description', 'description', 't'], ['unit', 'unit', 's20'], ['qty', 'qty', 'n4'], ['unitPrice', 'unit_price', 'n4'],
    ['ext', 'ext', 'n4'], ['proposalRow', 'proposal_row', 'i'], ['howUsed', 'how_used', 't'], ['scopeKey', 'scope_key', 's100'],
    ['status', 'status', 's100'], ['complete', 'is_complete', 'b'], ['haulUnit', 'haul_unit', 'n4'], ['matUnit', 'mat_unit', 'n4'],
    ['ls', 'is_ls', 'b'], ['taxExempt', 'tax_exempt', 'b'], ['unitNote', 'unit_note', 't'],
  ],
  fdot: [
    ['id', 'id', 's64'], ['category', 'category', 's100'], ['item', 'item_label', 't'], ['payItem', 'pay_item', 's40'], ['desc', 'description', 't'],
    ['unit', 'unit', 's20'], ['statewide6mo', 'statewide_6mo', 'n4'], ['ma10_12mo', 'ma10_12mo', 'n4'], ['asOf', 'as_of', 'd'],
    ['bidRow', 'bid_row', 'i'], ['note', 'note', 't'],
  ],
};

module.exports = { fits, toRow, fromRow, cid, isObjArray, isStrArray, isObj, SPEC };
