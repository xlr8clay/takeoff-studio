'use strict';
/**
 * Pull earthwork facts out of a studio job file.
 * Only numbers that are actually in the file are returned. Missing quantities stay null
 * and are named in `flags`. Nothing here is a price.
 */

function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function round4(v) {
  if (v == null) return null;
  return Math.round(v * 10000) / 10000;
}

/**
 * @param {object} doc parsed *.json job file
 * @param {string[]} [extraFlags]
 */
function earthworkFacts(doc, extraFlags = []) {
  const spec = doc && doc.spec && typeof doc.spec === 'object' ? doc.spec : {};
  const ref = doc && doc.reference && typeof doc.reference === 'object' && !Array.isArray(doc.reference) ? doc.reference : {};
  const flags = [...extraFlags];

  const cutStated = num(ref['Total excavation']);
  const fillStated = num(ref['Total fill placed']);
  const cutCy = cutStated != null ? cutStated : num(ref.cut_cy);
  const fillCy = fillStated != null ? fillStated : num(ref.fill_cy);
  if (cutStated == null && num(ref.cut_cy) != null) flags.push('cut_cy is reference.cut_cy from the file');
  if (fillStated == null && num(ref.fill_cy) != null) flags.push('fill_cy is reference.fill_cy from the file');
  if (num(ref.eng_cut_cy) != null || num(ref.eng_fill_cy) != null) {
    flags.push('eng_cut_cy and eng_fill_cy are kept beside cut_cy and fill_cy; neither replaces the other');
  }

  const balance = num(ref['Mass balance (cut sources - common/MC fill bank)']);
  const strip = num(ref['Stripping volume']);
  const area = num(ref['Limits of disturbance']);
  const fillBank = num(ref['Common + moisture-conditioned fill - bank CY required']);
  const undercut = num(ref['Undercut / overexcavation']);
  const selectImport = num(ref['Select fill import (loose, truck)']);
  const proof = num(ref['Subgrade preparation / proof roll']);
  const moistCond = num(ref['Moisture conditioning / scarify & recompact']);

  let importCy = null;
  let exportCy = null;
  if (balance != null) {
    importCy = balance < 0 ? round4(Math.abs(balance)) : 0;
    exportCy = balance > 0 ? round4(balance) : 0;
    flags.push('import_cy and export_cy are the file mass-balance figure: negative means import, positive means export');
  }

  const extras = Array.isArray(doc && doc.extras) ? doc.extras : [];
  const selectExtras = extras.filter((x) => x && num(x.qty) != null && /select fill/i.test(String(x.desc || '')));
  let selectFill = null;
  let selectDesc = null;
  if (selectExtras.length === 1) {
    selectFill = num(selectExtras[0].qty);
    selectDesc = selectExtras[0].desc || null;
    flags.push('select_fill_cy is the select-fill quantity stated on the file extras list');
  } else if (selectExtras.length > 1) {
    flags.push('more than one select-fill extra; select_fill_cy left null');
  }

  const regions = Array.isArray(doc && doc.regions) ? doc.regions : [];
  const areas = regions.map((r, i) => ({
    sort_order: i,
    name: r && r.name != null ? String(r.name) : null,
    area_type: r && r.type != null ? String(r.type) : null,
    section_in: r ? num(r.section_in) : null,
    moisture_in: r ? num(r.moisture_in) : null,
    finish_elev: r ? num(r.finish_elev) : null,
    source: 'file',
  }));

  const hasQty = cutCy != null || fillCy != null || balance != null || strip != null || selectFill != null || selectImport != null;
  if (!hasQty) flags.push('cut, fill, import and export are not in this file');
  if (balance == null && (cutCy != null || fillCy != null)) {
    flags.push('import and export are not stated on this file and were not derived');
  }
  if (num(spec.moisture_in) == null && !regions.some((r) => r && num(r.moisture_in) != null)) {
    flags.push('moisture-conditioning depth is not in this file; the page default of 6 in is not stored as a fact');
  }
  flags.push('curb overbuild is not in this file; the page default of 1 ft is not stored until someone edits it');
  flags.push('estimator, bid outcome and bid prices are not in this file');

  const balanceRow = hasQty ? {
    scope: 'site',
    phase_name: null,
    area_name: null,
    cut_cy: cutCy,
    fill_cy: fillCy,
    fill_bank_cy: fillBank,
    import_cy: importCy,
    export_cy: exportCy,
    strip_cy: strip,
    loose_cy: null,
    balance_cy: balance,
    shrink_pct: num(spec.shrink_pct),
    swell_pct: num(spec.swell_pct),
    area_sy: area,
    moist_sy: proof,
    select_fill_cy: selectFill,
    undercut_cy: undercut,
    source: 'file_reference',
    extra: {
      select_import_loose_cy: selectImport,
      select_fill_desc: selectDesc,
      moisture_conditioning_sy: moistCond,
      eng_cut_cy: num(ref.eng_cut_cy),
      eng_fill_cy: num(ref.eng_fill_cy),
      band_agree_pct: num(ref.band_agree_pct),
      common_fill_cy: num(ref['  of which common fill']),
      engineered_fill_cy: num(ref['  of which select / engineered fill']),
    },
  } : null;

  return {
    strip_in: num(spec.strip_in),
    shrink_pct: num(spec.shrink_pct),
    swell_pct: num(spec.swell_pct),
    spec_source: typeof spec.source === 'string' ? spec.source : null,
    cell_ft: num(doc && doc.cell),
    nx: Number.isInteger(doc && doc.nx) ? doc.nx : null,
    ny: Number.isInteger(doc && doc.ny) ? doc.ny : null,
    zbase: num(doc && doc.zbase),
    areas,
    balance: balanceRow,
    phase_names: Array.isArray(doc && doc.phase_names) ? doc.phase_names : null,
    header: {
      frame: doc && doc.frame != null ? String(doc.frame) : null,
      crs: doc && doc.crs != null ? String(doc.crs) : null,
      crs_name: doc && doc.crs_name != null ? String(doc.crs_name) : null,
      x0: num(doc && doc.x0),
      y0: num(doc && doc.y0),
    },
    flags,
  };
}

module.exports = { earthworkFacts, num, round4 };
