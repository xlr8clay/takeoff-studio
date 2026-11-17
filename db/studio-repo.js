'use strict';
/**
 * Earthwork studio writes. Every change runs in the same transaction as its activity_log row
 * via the repo helpers passed in from db/repo.js.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const { eq, and, isNull, asc } = require('drizzle-orm');
const S = require('./schema');
const { earthworkFacts } = require('./earthwork-facts');
const { getContext } = require('./context');

const n4 = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10000) / 10000);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function addStudioApi({ tx, insertRow, updateRowTx, getRowTx, storeFileTx, handle, uuid, now, notFound, RepoError }) {
  async function storeDeduped(t, { filename, mime, bytes }) {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const sha = sha256(buf);
    const [ex] = await t.select({ id: S.stored_files.id }).from(S.stored_files)
      .where(and(eq(S.stored_files.sha256, sha), isNull(S.stored_files.deleted_at))).limit(1);
    if (ex) return { id: ex.id, sha, reused: true };
    const row = await storeFileTx(t, { filename, mime, bytes: buf, sha256: sha });
    return { id: row.id, sha, reused: false };
  }

  async function readFileRow(id) {
    if (!id) return null;
    const rows = await handle.query('select id, filename, mime, bytes, sha256, size_bytes from stored_files where id = $1 and deleted_at is null', [id]);
    const row = rows[0];
    if (!row) return null;
    return { ...row, bytes: row.bytes ? Buffer.from(row.bytes) : null };
  }

  function conflict(id, rev, sent) {
    return new RepoError('REV_CONFLICT', `earthwork ${id} is at rev ${rev}, you sent rev ${sent}`, 409);
  }

  async function ensureShellProject(t, job) {
    const cur = await getRowTx(t, 'projects', job.projectId);
    if (cur) return { row: cur, created: false };
    if (job.attachExisting) throw notFound('project', job.projectId);
    const row = await insertRow(t, 'projects', {
      id: job.projectId,
      name: job.projectName,
      location: job.location ?? null,
      status: 'bidding',
      rev: 1,
      is_sample: false,
    });
    await insertRow(t, 'project_status_history', {
      project_id: job.projectId,
      from_status: null,
      to_status: 'bidding',
      changed_at: now(),
      note: 'Imported from an Earthwork Takeoff Studio file. Estimator and bid outcome are unknown.',
    });
    return { row, created: true };
  }

  async function replaceFileChildren(t, versionId, projectId, facts) {
    await t.delete(S.ew_areas).where(and(eq(S.ew_areas.version_id, versionId), eq(S.ew_areas.source, 'file')));
    await t.delete(S.ew_balance).where(and(eq(S.ew_balance.version_id, versionId), eq(S.ew_balance.source, 'file_reference')));
    for (const [i, a] of facts.areas.entries()) {
      await insertRow(t, 'ew_areas', {
        id: `${versionId}-a${i}`.slice(0, 64),
        version_id: versionId,
        project_id: projectId,
        sort_order: a.sort_order,
        name: a.name,
        area_type: a.area_type,
        section_in: n4(a.section_in),
        moisture_in: n4(a.moisture_in),
        finish_elev: n4(a.finish_elev),
        source: 'file',
      });
    }
    if (facts.balance) {
      const b = facts.balance;
      await insertRow(t, 'ew_balance', {
        id: `${versionId}-file`.slice(0, 64),
        version_id: versionId,
        project_id: projectId,
        scope: 'site',
        cut_cy: n4(b.cut_cy),
        fill_cy: n4(b.fill_cy),
        fill_bank_cy: n4(b.fill_bank_cy),
        import_cy: n4(b.import_cy),
        export_cy: n4(b.export_cy),
        strip_cy: n4(b.strip_cy),
        loose_cy: n4(b.loose_cy),
        balance_cy: n4(b.balance_cy),
        shrink_pct: n4(b.shrink_pct) == null ? b.shrink_pct : Math.round(b.shrink_pct * 1e6) / 1e6,
        swell_pct: b.swell_pct == null ? null : Math.round(b.swell_pct * 1e6) / 1e6,
        area_sy: n4(b.area_sy),
        moist_sy: n4(b.moist_sy),
        select_fill_cy: n4(b.select_fill_cy),
        undercut_cy: n4(b.undercut_cy),
        source: 'file_reference',
        extra: JSON.stringify(b.extra || {}),
      });
    }
  }

  async function linkPlan(t, { projectId, versionId, kind, filename, fileId, sort }) {
    const id = `plan-${versionId}-${kind}`.slice(0, 64);
    const existing = await getRowTx(t, 'plan_sets', id);
    if (existing) return existing;
    return insertRow(t, 'plan_sets', {
      id,
      project_id: projectId,
      plan_key: `${versionId}:${kind}`,
      name: filename,
      file_path: filename,
      stored_file_id: fileId,
      sort_order: sort,
      uploaded_at: now(),
    });
  }

  /**
   * Idempotent import of one studio job file.
   * job: catalog entry. paths: { grid, aerial, grading } absolute paths or null.
   * gridBytes may be passed instead of paths.grid (tests).
   */
  function importStudioVersion(job, paths = {}) {
    return tx(async (t) => {
      const gridBuf = paths.gridBytes != null
        ? Buffer.from(paths.gridBytes)
        : fs.readFileSync(paths.grid);
      const sha = sha256(gridBuf);
      const existing = await getRowTx(t, 'ew_versions', job.versionId);
      if (existing && !existing.deleted_at && existing.content_sha === sha) {
        return { id: existing.id, projectId: existing.project_id, rev: existing.rev, skipped: true };
      }
      if (existing && !existing.deleted_at && existing.rev > 1) {
        return { id: existing.id, projectId: existing.project_id, rev: existing.rev, skipped: true, reason: 'user-edited' };
      }
      const doc = JSON.parse(gridBuf.toString('utf8'));
      const facts = earthworkFacts(doc, job.extraFlags || []);
      const flags = [...facts.flags, ...(job.projectFlags || [])];
      if (Array.isArray(facts.phase_names) && facts.phase_names.length && !facts.balance) {
        flags.push('phase names are stored; per-phase quantities are not in the file');
      }
      await ensureShellProject(t, job);
      const gridFile = await storeDeduped(t, { filename: job.file, mime: 'application/json', bytes: gridBuf });
      let aerialId = null;
      let gradingId = null;
      if (paths.aerial && fs.existsSync(paths.aerial)) {
        aerialId = (await storeDeduped(t, { filename: job.aerial, mime: 'image/png', bytes: fs.readFileSync(paths.aerial) })).id;
      } else if (job.aerial) flags.push(`aerial file ${job.aerial} was not found on disk`);
      if (paths.grading && fs.existsSync(paths.grading)) {
        gradingId = (await storeDeduped(t, { filename: job.grading, mime: 'image/png', bytes: fs.readFileSync(paths.grading) })).id;
      } else if (job.grading) flags.push(`grading file ${job.grading} was not found on disk`);

      const values = {
        project_id: job.projectId,
        scenario_key: job.scenarioKey,
        label: doc.name || job.projectName || job.key,
        source_file: job.file,
        scenario_role: job.scenarioRole,
        sort_order: job.sort ?? 0,
        strip_in: n4(facts.strip_in),
        shrink_pct: facts.shrink_pct == null ? null : Math.round(facts.shrink_pct * 1e6) / 1e6,
        swell_pct: facts.swell_pct == null ? null : Math.round(facts.swell_pct * 1e6) / 1e6,
        moisture_in: null,
        cell_ft: n4(facts.cell_ft),
        nx: facts.nx,
        ny: facts.ny,
        zbase: n4(facts.zbase),
        grid_file_id: gridFile.id,
        aerial_file_id: aerialId,
        grading_file_id: gradingId,
        content_sha: sha,
        flags_json: JSON.stringify(flags),
        extra: JSON.stringify({
          phase_names: facts.phase_names,
          spec_source: facts.spec_source,
          header: facts.header,
          project_flags: job.projectFlags || [],
        }),
      };

      let saved;
      if (!existing) {
        saved = await insertRow(t, 'ew_versions', { id: job.versionId, rev: 1, ...values });
      } else if (existing.deleted_at) {
        saved = await updateRowTx(t, 'ew_versions', existing.id, { ...values, deleted_at: null, deleted_by: null }, { action: 'restore' });
      } else {
        saved = await updateRowTx(t, 'ew_versions', existing.id, values);
      }
      await replaceFileChildren(t, saved.id, job.projectId, facts);
      if (aerialId) await linkPlan(t, { projectId: job.projectId, versionId: saved.id, kind: 'aerial', filename: job.aerial, fileId: aerialId, sort: 0 });
      if (gradingId) await linkPlan(t, { projectId: job.projectId, versionId: saved.id, kind: 'grading', filename: job.grading, fileId: gradingId, sort: 1 });
      if (gridFile.id) await linkPlan(t, { projectId: job.projectId, versionId: saved.id, kind: 'grid', filename: job.file, fileId: gridFile.id, sort: 2 });
      return { id: saved.id, projectId: job.projectId, rev: saved.rev, skipped: false, flags };
    });
  }

  async function listStudioJobs() {
    const rows = await handle.query(`
      select v.id, v.project_id, v.scenario_key, v.label, v.source_file, v.scenario_role, v.rev, v.sort_order,
             v.editor_json, v.flags_json, v.aerial_file_id, v.grading_file_id, v.grid_file_id,
             v.strip_in, v.shrink_pct, v.swell_pct,
             p.name as project_name, p.status as project_status,
             b.items_json, b.custom_json, b.trucks_json, b.touched, b.direct_cost, b.bid_total, b.rev as bid_rev,
             o.status as outcome_status
      from ew_versions v
      join projects p on p.id = v.project_id
      left join studio_bids b on b.version_id = v.id and b.deleted_at is null
      left join bid_outcomes o on o.project_id = v.project_id
      where v.deleted_at is null and p.deleted_at is null
      order by v.sort_order, v.id`);
    return rows.map(presentJob);
  }

  function presentJob(row) {
    return {
      key: row.scenario_key,
      versionId: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      projectStatus: row.project_status,
      label: row.label,
      sourceFile: row.source_file,
      role: row.scenario_role,
      rev: row.rev,
      sort: row.sort_order,
      flags: row.flags_json ? JSON.parse(row.flags_json) : [],
      editor: row.editor_json ? JSON.parse(row.editor_json) : null,
      bid: row.items_json ? {
        items: JSON.parse(row.items_json),
        custom: row.custom_json ? JSON.parse(row.custom_json) : [],
        trucks: row.trucks_json ? JSON.parse(row.trucks_json) : null,
        touched: row.touched,
        directCost: row.direct_cost == null ? null : Number(row.direct_cost),
        bidTotal: row.bid_total == null ? null : Number(row.bid_total),
        rev: row.bid_rev,
      } : null,
      outcome: row.outcome_status || null,
      aerialFileId: row.aerial_file_id,
      gradingFileId: row.grading_file_id,
    };
  }

  async function getStudioVersion(id) {
    const row = await getRowTx(handle.db, 'ew_versions', id);
    if (!row || row.deleted_at) return null;
    const [job] = (await listStudioJobs()).filter((j) => j.versionId === id);
    const areas = await handle.db.select().from(S.ew_areas)
      .where(and(eq(S.ew_areas.version_id, id), isNull(S.ew_areas.deleted_at)))
      .orderBy(asc(S.ew_areas.sort_order));
    const balance = await handle.db.select().from(S.ew_balance)
      .where(and(eq(S.ew_balance.version_id, id), isNull(S.ew_balance.deleted_at)))
      .orderBy(asc(S.ew_balance.source));
    return { ...job, areas, balance, contentSha: row.content_sha };
  }

  async function getStudioDocument(id) {
    const row = await getRowTx(handle.db, 'ew_versions', id);
    if (!row || row.deleted_at) throw notFound('ew_versions', id);
    const file = await readFileRow(row.grid_file_id);
    if (!file || !file.bytes) throw notFound('stored_files', row.grid_file_id);
    return JSON.parse(file.bytes.toString('utf8'));
  }

  function saveStudioRates(document, { expectedRev } = {}) {
    if (!document || typeof document !== 'object') throw new RepoError('INVALID', 'rate card required', 400);
    return tx(async (t) => {
      const cur = await getRowTx(t, 'studio_rates', 'studio-default');
      const body = JSON.stringify(document);
      if (!cur || cur.deleted_at) {
        if (expectedRev != null && Number(expectedRev) !== 0 && !cur) {
          throw conflict('studio-rates', 0, expectedRev);
        }
        if (cur && cur.deleted_at) {
          return updateRowTx(t, 'studio_rates', 'studio-default', { rev: cur.rev + 1, document_json: body, deleted_at: null, deleted_by: null }, { action: 'restore' });
        }
        return insertRow(t, 'studio_rates', { id: 'studio-default', rev: 1, document_json: body });
      }
      const expected = expectedRev == null ? cur.rev : Number(expectedRev);
      if (expected !== cur.rev) throw conflict('studio-rates', cur.rev, expected);
      return updateRowTx(t, 'studio_rates', 'studio-default', { rev: cur.rev + 1, document_json: body });
    });
  }

  async function getStudioRates() {
    const rows = await handle.query("select rev, document_json from studio_rates where id = 'studio-default' and deleted_at is null");
    if (!rows[0]) return { rev: 0, document: null };
    return { rev: rows[0].rev, document: rows[0].document_json ? JSON.parse(rows[0].document_json) : null };
  }

  function saveStudioState(versionId, body = {}, { expectedRev } = {}) {
    return tx(async (t) => {
      const cur = await getRowTx(t, 'ew_versions', versionId, { forUpdate: true });
      if (!cur || cur.deleted_at) throw notFound('ew_versions', versionId);
      const expected = expectedRev == null ? body.rev : expectedRev;
      if (expected != null && Number(expected) !== cur.rev) throw conflict(versionId, cur.rev, expected);
      const factors = body.factors || {};
      const editor = {
        factors: {
          strip: n4(factors.strip),
          shrink: n4(factors.shrink),
          swell: n4(factors.swell),
          moist: n4(factors.moist),
          overbuild: n4(factors.overbuild),
          dz: n4(factors.dz),
          sec: Array.isArray(factors.sec) ? factors.sec.map(n4) : null,
        },
        utilities: body.utilities || null,
        utilParams: body.utilParams || null,
        savedAt: now(),
      };
      const patch = {
        rev: cur.rev + 1,
        editor_json: JSON.stringify(editor),
        finish_offset_ft: n4(factors.dz),
        overbuild_ft: n4(factors.overbuild),
        moisture_in: n4(factors.moist),
      };
      if (factors.strip != null) patch.strip_in = n4(factors.strip);
      if (factors.shrink != null) patch.shrink_pct = Math.round(Number(factors.shrink) * 1e6) / 1e6;
      if (factors.swell != null) patch.swell_pct = Math.round(Number(factors.swell) * 1e6) / 1e6;
      if (body.grid && typeof body.grid === 'object') {
        const buf = Buffer.from(JSON.stringify(body.grid));
        const stored = await storeDeduped(t, { filename: cur.source_file || 'job.json', mime: 'application/json', bytes: buf });
        patch.grid_file_id = stored.id;
        patch.content_sha = stored.sha;
      }
      const saved = await updateRowTx(t, 'ew_versions', versionId, patch);

      if (Array.isArray(factors.sec)) {
        const areas = await t.select().from(S.ew_areas)
          .where(and(eq(S.ew_areas.version_id, versionId), isNull(S.ew_areas.deleted_at)))
          .orderBy(asc(S.ew_areas.sort_order));
        for (let i = 0; i < factors.sec.length && i < areas.length; i++) {
          const next = n4(factors.sec[i]);
          if (next == null) continue;
          if (Number(areas[i].section_in) !== next) await updateRowTx(t, 'ew_areas', areas[i].id, { section_in: next });
        }
      }

      await t.delete(S.ew_balance).where(and(eq(S.ew_balance.version_id, versionId), eq(S.ew_balance.source, 'computed')));
      await t.delete(S.ew_grading).where(and(eq(S.ew_grading.version_id, versionId), eq(S.ew_grading.source, 'computed')));
      const bal = body.balance;
      if (bal && typeof bal === 'object') {
        await insertRow(t, 'ew_balance', {
          version_id: versionId,
          project_id: cur.project_id,
          scope: 'site',
          cut_cy: n4(bal.cut_cy),
          fill_cy: n4(bal.fill_cy),
          fill_bank_cy: n4(bal.fill_bank_cy),
          import_cy: n4(bal.import_cy),
          export_cy: n4(bal.export_cy),
          strip_cy: n4(bal.strip_cy),
          loose_cy: n4(bal.loose_cy),
          balance_cy: n4(bal.balance_cy),
          shrink_pct: bal.shrink_pct == null ? null : Math.round(Number(bal.shrink_pct) * 1e6) / 1e6,
          swell_pct: bal.swell_pct == null ? null : Math.round(Number(bal.swell_pct) * 1e6) / 1e6,
          area_sy: n4(bal.area_sy),
          moist_sy: n4(bal.moist_sy),
          source: 'computed',
          extra: JSON.stringify({ from: 'studio' }),
        });
      }
      if (Array.isArray(body.phases)) {
        for (const [i, h] of body.phases.entries()) {
          const cut = n4(h.cut_cy);
          const fill = n4(h.fill_cy);
          const shrink = Number(factors.shrink) || 0;
          const fillBank = fill == null || shrink >= 100 ? null : n4(fill / (1 - shrink / 100));
          const balanceCy = cut == null || fillBank == null ? null : n4(cut - fillBank);
          await insertRow(t, 'ew_balance', {
            version_id: versionId,
            project_id: cur.project_id,
            scope: 'phase',
            phase_name: h.name ? String(h.name).slice(0, 200) : `phase ${i + 1}`,
            cut_cy: cut,
            fill_cy: fill,
            fill_bank_cy: fillBank,
            strip_cy: n4(h.strip_cy),
            area_sy: n4(h.sy),
            balance_cy: balanceCy,
            import_cy: balanceCy != null && balanceCy < 0 ? n4(Math.abs(balanceCy)) : balanceCy === 0 ? 0 : null,
            export_cy: balanceCy != null && balanceCy > 0 ? balanceCy : balanceCy === 0 ? 0 : null,
            shrink_pct: factors.shrink == null ? null : Math.round(Number(factors.shrink) * 1e6) / 1e6,
            swell_pct: factors.swell == null ? null : Math.round(Number(factors.swell) * 1e6) / 1e6,
            source: 'computed',
          });
        }
      }
      if (Array.isArray(body.grading)) {
        for (const [i, g] of body.grading.entries()) {
          await insertRow(t, 'ew_grading', {
            version_id: versionId,
            project_id: cur.project_id,
            sort_order: i,
            area_name: g.name != null ? String(g.name) : null,
            area_sy: n4(g.sy),
            section_label: g.section_label != null ? String(g.section_label).slice(0, 40) : null,
            strip_cy: n4(g.strip_cy),
            cut_cy: n4(g.cut_cy),
            fill_cy: n4(g.fill_cy),
            avg_cut_ft: n4(g.avg_cut_ft),
            avg_fill_ft: n4(g.avg_fill_ft),
            moist_sy: n4(g.moist_sy),
            source: 'computed',
          });
        }
      }

      const touched = !!body.touched;
      const bidVals = {
        items_json: JSON.stringify(body.bid && body.bid.items ? body.bid.items : {}),
        custom_json: JSON.stringify(body.bid && body.bid.custom ? body.bid.custom : []),
        trucks_json: body.bid && body.bid.trucks != null ? JSON.stringify(body.bid.trucks) : null,
        touched,
        direct_cost: touched ? n4(body.directCost) : null,
        bid_total: touched ? n4(body.bidTotal) : null,
      };
      const [bid] = await t.select().from(S.studio_bids).where(eq(S.studio_bids.version_id, versionId));
      let bidRow;
      if (!bid) bidRow = await insertRow(t, 'studio_bids', { project_id: cur.project_id, version_id: versionId, rev: 1, ...bidVals });
      else bidRow = await updateRowTx(t, 'studio_bids', bid.id, { ...bidVals, rev: bid.rev + 1, deleted_at: null, deleted_by: null });

      let snapshot = null;
      if (body.snapshot && touched && n4(body.directCost) != null) {
        const project = await getRowTx(t, 'projects', cur.project_id);
        snapshot = await insertRow(t, 'bid_snapshots', {
          project_id: cur.project_id,
          project_rev: project.rev,
          snapshot_at: now(),
          reason: 'studio_pricing',
          estimator_id: project.estimator_id,
          direct_cost: n4(body.directCost),
          bid_total: n4(body.bidTotal),
          markup_pct: body.markupPct == null ? null : Math.round(Number(body.markupPct) * 1e6) / 1e6,
          earthwork_json: JSON.stringify({
            version_id: versionId,
            rev: saved.rev,
            balance: body.balance || null,
            phases: body.phases || null,
            factors: editor.factors,
          }),
          document_json: JSON.stringify({ studio: true, version_id: versionId, bid: body.bid || null }),
          created_by: getContext().user_id,
        });
      }
      return { id: saved.id, rev: saved.rev, projectId: cur.project_id, bidRev: bidRow.rev, snapshotId: snapshot ? snapshot.id : null };
    });
  }

  return {
    importStudioVersion,
    listStudioJobs,
    getStudioVersion,
    getStudioDocument,
    saveStudioState,
    saveStudioRates,
    getStudioRates,
    readStoredFile: readFileRow,
  };
}

module.exports = { addStudioApi, sha256 };
