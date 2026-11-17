'use strict';
/**
 * Quotes: vendor and sub quotes kept company-wide in the library (vendor_quotes + vendor_quote_lines, audited),
 * linked to the jobs (projects) they were taken for through project_quotes. The page groups them by scope to
 * compare prices and can carry a quote line's unit price into a bid item.
 *   GET    /api/quotes            every quote, each with projectIds: the jobs it is linked to
 *   POST   /api/quotes            { quote, projectId? } create or replace (quote.id optional), link to projectId
 *   DELETE /api/quotes/:id        soft delete
 */
const crypto = require('node:crypto');

const clean = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const numOr = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function tidyQuote(q) {
  const id = clean(q.id, 64) || `q-${crypto.randomUUID()}`;
  const items = (Array.isArray(q.items) ? q.items : []).slice(0, 200).map((it, i) => {
    const qty = numOr(it.qty), unitPrice = numOr(it.unitPrice);
    return {
      id: clean(it.id, 64) || `${id}-l${i + 1}`,
      description: clean(it.description, 2000),
      unit: clean(it.unit, 20),
      qty,
      unitPrice,
      ext: qty != null && unitPrice != null ? Math.round(qty * unitPrice * 100) / 100 : numOr(it.ext),
      ls: !!it.ls,
      taxExempt: !!it.taxExempt,
    };
  }).filter((it) => it.description || it.unitPrice != null);
  return {
    id,
    vendor: clean(q.vendor, 300),
    quoteNo: clean(q.quoteNo, 100),
    date: isDay(q.date) ? q.date : null,
    expires: isDay(q.expires) ? q.expires : null,
    type: ['material', 'sub', 'trucking', 'equipment', 'other'].includes(q.type) ? q.type : 'material',
    scope: clean(q.scope, 300),
    notes: clean(q.notes, 4000),
    source: clean(q.source, 300) || 'studio',
    items,
  };
}

function mountQuotes(app, { repo, requireUser, requireWriter }) {
  app.get('/api/quotes', requireUser, async (_req, res, next) => {
    try {
      const quotes = await repo.listLibrary('quotes');
      const links = await repo.list('project_quotes');
      const by = new Map();
      for (const l of links) { if (!by.has(l.vendor_quote_id)) by.set(l.vendor_quote_id, []); by.get(l.vendor_quote_id).push(l.project_id); }
      res.json(quotes.map((q) => ({ ...q, projectIds: by.get(q.id) || [] })));
    } catch (err) { next(err); }
  });

  app.post('/api/quotes', requireWriter, async (req, res, next) => {
    try {
      const body = req.body || {};
      if (!body.quote || typeof body.quote !== 'object') return res.status(400).json({ code: 'INVALID', message: 'quote required' });
      const q = tidyQuote(body.quote);
      if (!q.vendor) return res.status(400).json({ code: 'INVALID', message: 'Vendor is required.' });
      if (!q.items.length) return res.status(400).json({ code: 'INVALID', message: 'Add at least one line with a description or a price.' });
      await repo.upsertLibraryItem('quotes', q);
      const projectId = clean(body.projectId, 64);
      if (projectId && (await repo.get('projects', projectId))) {
        const [have] = await repo.list('project_quotes', { project_id: projectId, vendor_quote_id: q.id });
        if (!have) await repo.insert('project_quotes', { id: crypto.randomUUID(), project_id: projectId, vendor_quote_id: q.id, link_source: 'manual' });
      }
      const links = await repo.list('project_quotes', { vendor_quote_id: q.id });
      res.status(201).json({ ...(await repo.getLibraryItem('quotes', q.id)), projectIds: links.map((l) => l.project_id) });
    } catch (err) { next(err); }
  });

  app.delete('/api/quotes/:id', requireWriter, async (req, res, next) => {
    try {
      const cur = await repo.getLibraryItem('quotes', req.params.id);
      if (!cur) return res.status(404).json({ code: 'NOT_FOUND', message: 'No such quote' });
      await repo.deleteLibraryItem('quotes', req.params.id);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });
}

module.exports = { mountQuotes, tidyQuote };
