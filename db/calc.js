'use strict';
/**
 * Copied verbatim from db/seed-data/calc.reference.js (the old app's pricing math). db/repo.js uses it at
 * save time to fill the reporting columns (line_items.total_cost, line_item_costs.*_cost, bid_snapshots).
 *
 * Pricing math. Pure functions - no I/O. Mirrors the Buc'ee's "Labor & Equip" build-up:
 *   crew days   = qty / production (units per crew-day)   [or explicit override]
 *   labor $     = crew days x labor $/crew-hr x hours per crew-day
 *   equipment $ = crew days x equip $/crew-hr x hours per crew-day
 *   material $  = quote qty x quote unit price            (taxed at project tax %)
 *   sub $       = LS amount, or qty x unit price (+fixed) (NOT taxed)
 *   total       = labor + equip + material + material tax + sub
 * Markup is NEVER applied here; direct cost only. Markup is applied only on the proposal export.
 */

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const n0 = (v) => num(v) ?? 0;

const DEFAULT_SETTINGS = {
  taxPct: 0.07,          // material tax rate (quote + 7%)
  avgLoadTons: 20,       // average truck load, tons
  hoursPerDay: 10,       // hours per crew-day (HEB calendar 610: 6 days @ 10 hrs)
  fillTonsPerCY: 1.4,    // ASSUMED (Disney Bermont fill)
  baseTonsPerCY: 1.6,    // ASSUMED (shell base, compacted)
};

function factorFor(project, ref) {
  if (!ref) return 1;
  if (ref === 'fill') return n0(project.fillTonsPerCY ?? DEFAULT_SETTINGS.fillTonsPerCY);
  if (ref === 'base') return n0(project.baseTonsPerCY ?? DEFAULT_SETTINGS.baseTonsPerCY);
  return num(ref) ?? 1;
}

/** Resolve the quantity a cost item works on. */
function itemQty(item, line) {
  return num(item.qty) ?? n0(line && line.qty);
}

function basisQty(spec, item, line) {
  // spec = item.material / item.sub ; qtyBasis 'line' uses the bid-line qty, otherwise the item qty
  if (num(spec.qty) !== null) return num(spec.qty);
  if (spec.qtyBasis === 'line') return n0(line && line.qty);
  return itemQty(item, line);
}

function materialExt(item, line, project) {
  const m = item.material;
  if (!m) return 0;
  if (num(m.ext) !== null && num(m.unitPrice) === null) return num(m.ext);
  const qty = basisQty(m, item, line) * factorFor(project, m.factorRef) * (num(m.qtyFactor) ?? 1);
  return qty * n0(m.unitPrice) + n0(m.fixed);
}

function subExt(item, line, project) {
  const s = item.sub;
  if (!s) return 0;
  if (num(s.amount) !== null) return num(s.amount);
  const qty = basisQty(s, item, line) * factorFor(project, s.factorRef) * (num(s.qtyFactor) ?? 1);
  return qty * n0(s.unitPrice) + n0(s.fixed);
}

function itemCost(item, line, project) {
  const hrs = n0(project.hoursPerDay ?? DEFAULT_SETTINGS.hoursPerDay);
  const taxPct = n0(project.taxPct ?? DEFAULT_SETTINGS.taxPct);
  const qty = itemQty(item, line);
  const prod = n0(item.production);
  const crewDays = num(item.crewDaysOverride) !== null ? num(item.crewDaysOverride) : prod > 0 ? qty / prod : 0;
  const labor = crewDays * n0(item.laborRateHr) * hrs;
  const equip = crewDays * n0(item.equipRateHr) * hrs;
  const material = materialExt(item, line, project);
  const tax = item.material && item.material.taxExempt ? 0 : material * taxPct;
  const sub = subExt(item, line, project);
  const total = labor + equip + material + tax + sub;
  return { qty, crewDays, labor, equip, material, tax, sub, total };
}

/** Per-line roll-up (own cost items only; folded no-bid-line costs are added in projectTotals). */
function lineCost(line, project) {
  const z = { crewDays: 0, labor: 0, equip: 0, material: 0, tax: 0, sub: 0, total: 0 };
  const items = [];
  for (const it of line.items || []) {
    const c = itemCost(it, line, project);
    items.push({ id: it.id, ...c });
    for (const k of Object.keys(z)) z[k] += c[k];
  }
  return { ...z, items };
}

const isIncluded = (line) => line.include !== false;

/**
 * Whole-project roll-up. Returns per-line, per-section and grand totals.
 * Lines with include=false contribute 0 (Proposal col H = "N" in the workbook).
 * Lines with foldInto=<lineId> add their cost into that line's ALL-IN figure (client-format export);
 * the working bid keeps them on their own row so section/grand totals are unchanged by folding.
 */
function projectTotals(project) {
  const lines = project.lines || [];
  const byId = new Map(lines.map((l) => [l.id, l]));
  const out = { lines: {}, sections: {}, labor: 0, equip: 0, material: 0, tax: 0, sub: 0, direct: 0 };
  for (const l of lines) {
    const c = lineCost(l, project);
    const inc = isIncluded(l);
    const eff = inc ? c : { crewDays: 0, labor: 0, equip: 0, material: 0, tax: 0, sub: 0, total: 0, items: c.items.map((i) => ({ ...i, total: 0 })) };
    out.lines[l.id] = { ...eff, included: inc, ownTotal: eff.total, allIn: eff.total, folded: 0 };
  }
  for (const l of lines) {
    if (l.foldInto && byId.has(l.foldInto) && l.foldInto !== l.id) {
      const t = out.lines[l.id].ownTotal;
      out.lines[l.foldInto].allIn += t;
      out.lines[l.foldInto].folded += t;
      out.lines[l.id].foldedAway = true;
    }
  }
  for (const l of lines) {
    const c = out.lines[l.id];
    const qty = n0(l.qty);
    c.unitPrice = qty > 0 && !c.foldedAway ? c.allIn / qty : null;
    const sid = l.sectionId;
    const s = (out.sections[sid] ||= { labor: 0, equip: 0, material: 0, tax: 0, sub: 0, total: 0, lines: 0 });
    for (const k of ['labor', 'equip', 'material', 'tax', 'sub', 'total']) s[k] += c[k];
    s.lines += 1;
    for (const k of ['labor', 'equip', 'material', 'tax', 'sub']) out[k] += c[k];
    out.direct += c.total;
  }
  return out;
}

/** Markup is applied ONLY when a markup % is entered. Returns nulls (blank) otherwise. */
function applyMarkup(direct, markupPct) {
  const m = num(markupPct);
  if (m === null || m <= 0) return { markupPct: null, markup: null, total: null, applied: false };
  const pct = m > 1 ? m / 100 : m; // accept 17 or 0.17
  const markup = round2(direct * pct);
  return { markupPct: pct, markup, total: round2(direct + markup), applied: true };
}

const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * Allocate a rounded total across parts so the displayed (cent-rounded) parts sum exactly to the total.
 * Largest-remainder method - same approach as the Buc'ee's proposal generator.
 */
function allocateCents(rawParts, targetTotal) {
  const cents = rawParts.map((v) => Math.round(v * 100));
  let diff = Math.round(targetTotal * 100) - cents.reduce((a, b) => a + b, 0);
  const order = rawParts
    .map((v, i) => ({ i, rem: v * 100 - Math.round(v * 100) }))
    .sort((a, b) => (diff > 0 ? b.rem - a.rem : a.rem - b.rem));
  let k = 0;
  while (diff !== 0 && order.length) {
    const step = diff > 0 ? 1 : -1;
    cents[order[k % order.length].i] += step;
    diff -= step;
    k++;
  }
  return cents.map((c) => c / 100);
}

/** Production-rate label for the client format: "800 CY/day", "Sub", "Material" (same style as the Buc'ee's form). */
function productionLabel(line) {
  const items = line.items || [];
  const prod = items.filter((i) => n0(i.production) > 0);
  if (prod.length) {
    const v = n0(prod[0].production);
    const t = v < 10 ? v.toFixed(1) : Number(v.toFixed(2)).toString();
    return `${t} ${(line.unit || prod[0].unit || '').toUpperCase()}/day`.replace('  ', ' ');
  }
  if (items.some((i) => i.sub)) return 'Sub';
  if (items.some((i) => i.material)) return 'Material';
  return '';
}

/** Variance of the AI qty vs the ESTIMATOR's qty. Not computed when the line qty itself came from the AI (nothing independent to compare). */
function lineVariance(line) {
  if (!line || line.qtySource === 'ai-accepted') return null;
  return variance(line.aiQty, line.qty);
}

function variance(aiQty, estQty) {
  const a = num(aiQty), e = num(estQty);
  if (a === null || e === null) return null;
  if (e === 0) return a === 0 ? 0 : null;
  return (a - e) / e;
}

module.exports = {
  DEFAULT_SETTINGS, num, n0, round2, factorFor, itemQty, itemCost, lineCost, projectTotals,
  applyMarkup, allocateCents, productionLabel, variance, lineVariance, isIncluded,
};
