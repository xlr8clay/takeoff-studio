-- =====================================================================================
-- 0001_pg_specific: the ONLY Postgres-specific objects in this package.
--   * append-only trigger on activity_log (plpgsql)
--   * reporting views
-- SQL Server equivalents: docs/SQL_SERVER.md. Everything else (0000_init) is portable DDL.
-- =====================================================================================

CREATE OR REPLACE FUNCTION activity_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activity_log is append-only (% rejected)', TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trg_activity_log_no_update_delete
  BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW EXECUTE FUNCTION activity_log_append_only();
--> statement-breakpoint
CREATE TRIGGER trg_activity_log_no_truncate
  BEFORE TRUNCATE ON activity_log
  FOR EACH STATEMENT EXECUTE FUNCTION activity_log_append_only();
--> statement-breakpoint

-- Helper: the snapshot that counts for a project = the one on its bid outcome, else the latest.
CREATE VIEW v_project_bid_snapshot AS
SELECT p.id AS project_id, s.id AS bid_snapshot_id, s.snapshot_at, s.direct_cost, s.markup_pct, s.markup_amount,
       s.bid_total, s.labor_cost, s.equip_cost, s.material_cost, s.tax_cost, s.sub_cost
FROM projects p
LEFT JOIN bid_outcomes o ON o.project_id = p.id
JOIN bid_snapshots s ON s.id = COALESCE(o.bid_snapshot_id, (
  SELECT s2.id FROM bid_snapshots s2 WHERE s2.project_id = p.id
  ORDER BY s2.snapshot_at DESC, s2.id DESC LIMIT 1))
WHERE p.deleted_at IS NULL;
--> statement-breakpoint

CREATE VIEW v_unit_cost_history AS
SELECT li.id AS line_item_id, li.project_id, p.project_no, p.name AS project_name, p.bid_date, p.status AS project_status,
       r.code AS region_code, li.line_key, li.description, li.unit, li.estimator_qty AS qty, li.unit_price, li.total_cost,
       li.pricing_method, li.proposal_group, COALESCE(li.estimator_id, p.estimator_id) AS estimator_id
FROM line_items li
JOIN projects p ON p.id = li.project_id
LEFT JOIN regions r ON r.id = p.region_id
WHERE p.deleted_at IS NULL AND li.unit_price IS NOT NULL AND (li.include_in_bid IS NULL OR li.include_in_bid = TRUE);
--> statement-breakpoint

CREATE VIEW v_unit_cost_history_by_estimator AS
SELECT h.*, COALESCE(e.display_name, e.first_name) AS estimator_name
FROM v_unit_cost_history h
LEFT JOIN employees e ON e.id = h.estimator_id;
--> statement-breakpoint

CREATE VIEW v_vendor_quote_history AS
SELECT q.id AS quote_id, q.vendor_id, q.vendor_name, q.quote_no, q.quote_date, q.expires_on, q.quote_type, q.tax_rate,
       q.is_complete AS quote_complete, q.owner_id, l.id AS quote_line_id, l.description, l.unit, l.qty, l.unit_price,
       l.ext, l.scope_key, l.is_complete AS line_complete, l.tax_exempt,
       (SELECT COUNT(*) FROM project_quotes pq JOIN projects p ON p.id = pq.project_id
         WHERE pq.vendor_quote_id = q.id AND p.deleted_at IS NULL) AS project_count
FROM vendor_quotes q
LEFT JOIN vendor_quote_lines l ON l.quote_id = q.id
WHERE q.deleted_at IS NULL;
--> statement-breakpoint

CREATE VIEW v_project_pipeline AS
SELECT p.id AS project_id, p.project_no, p.name, p.status, p.bid_date, r.code AS region_code, p.estimator_id,
       COALESCE(e.display_name, e.first_name) AS estimator_name, p.rev,
       s.direct_cost, s.markup_amount, s.bid_total, o.status AS outcome_status, o.decision_date, o.winning_amount,
       o.awarded_to_name
FROM projects p
LEFT JOIN regions r ON r.id = p.region_id
LEFT JOIN employees e ON e.id = p.estimator_id
LEFT JOIN v_project_bid_snapshot s ON s.project_id = p.id
LEFT JOIN bid_outcomes o ON o.project_id = p.id
WHERE p.deleted_at IS NULL;
--> statement-breakpoint

CREATE VIEW v_bid_hit_rate AS
SELECT CAST(EXTRACT(YEAR FROM p.bid_date) AS INTEGER) AS bid_year,
       COUNT(*) AS bids,
       SUM(CASE WHEN o.status = 'won' THEN 1 ELSE 0 END) AS won,
       SUM(CASE WHEN o.status = 'lost' THEN 1 ELSE 0 END) AS lost,
       SUM(CASE WHEN o.status = 'not_awarded' THEN 1 ELSE 0 END) AS not_awarded,
       SUM(CASE WHEN o.status = 'withdrawn' THEN 1 ELSE 0 END) AS withdrawn,
       SUM(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END) AS pending,
       CAST(SUM(CASE WHEN o.status = 'won' THEN 1 ELSE 0 END) AS NUMERIC(18,4))
         / NULLIF(SUM(CASE WHEN o.status IN ('won', 'lost') THEN 1 ELSE 0 END), 0) AS hit_rate,
       SUM(COALESCE(o.our_bid_total, o.direct_cost)) AS dollars_bid,
       SUM(CASE WHEN o.status = 'won' THEN COALESCE(o.our_bid_total, o.direct_cost) ELSE 0 END) AS dollars_won
FROM bid_outcomes o
JOIN projects p ON p.id = o.project_id
WHERE p.deleted_at IS NULL
GROUP BY CAST(EXTRACT(YEAR FROM p.bid_date) AS INTEGER);
--> statement-breakpoint

CREATE VIEW v_estimate_vs_actual AS
SELECT p.id AS project_id, p.project_no, p.name AS project_name, p.status, s.bid_snapshot_id,
       s.direct_cost AS est_direct_cost,
       s.labor_cost AS est_labor, s.equip_cost AS est_equipment, s.material_cost + COALESCE(s.tax_cost, 0) AS est_material,
       s.sub_cost AS est_sub,
       COALESCE(a.actual_cost, 0) AS actual_cost,
       COALESCE(a.actual_labor, 0) AS actual_labor, COALESCE(a.actual_equipment, 0) AS actual_equipment,
       COALESCE(a.actual_material, 0) AS actual_material, COALESCE(a.actual_sub, 0) AS actual_sub,
       COALESCE(a.actual_trucking, 0) AS actual_trucking, COALESCE(a.actual_other, 0) AS actual_other,
       COALESCE(a.actual_cost, 0) - s.direct_cost AS variance,
       (COALESCE(a.actual_cost, 0) - s.direct_cost) / NULLIF(s.direct_cost, 0) AS variance_pct,
       COALESCE(a.entries, 0) AS actual_entries
FROM projects p
JOIN v_project_bid_snapshot s ON s.project_id = p.id
LEFT JOIN (
  SELECT project_id, COUNT(*) AS entries, SUM(amount) AS actual_cost,
         SUM(CASE WHEN cost_type = 'labor' THEN amount ELSE 0 END) AS actual_labor,
         SUM(CASE WHEN cost_type = 'equipment' THEN amount ELSE 0 END) AS actual_equipment,
         SUM(CASE WHEN cost_type = 'material' THEN amount ELSE 0 END) AS actual_material,
         SUM(CASE WHEN cost_type = 'sub' THEN amount ELSE 0 END) AS actual_sub,
         SUM(CASE WHEN cost_type = 'trucking' THEN amount ELSE 0 END) AS actual_trucking,
         SUM(CASE WHEN cost_type = 'other' THEN amount ELSE 0 END) AS actual_other
  FROM job_cost_actuals WHERE deleted_at IS NULL GROUP BY project_id
) a ON a.project_id = p.id
WHERE p.deleted_at IS NULL;
--> statement-breakpoint

CREATE VIEW v_employee_bids AS
SELECT e.id AS employee_id, COALESCE(e.display_name, e.first_name) AS employee_name, p.id AS project_id,
       p.project_no, p.name AS project_name, p.bid_date, COALESCE(o.status, 'pending') AS outcome_status,
       COALESCE(o.our_bid_total, o.direct_cost, s.bid_total, s.direct_cost) AS bid_amount,
       COALESCE(o.direct_cost, s.direct_cost) AS direct_cost, o.winning_amount, o.decision_date
FROM project_assignments a
JOIN employees e ON e.id = a.employee_id
JOIN projects p ON p.id = a.project_id
LEFT JOIN bid_outcomes o ON o.project_id = p.id
LEFT JOIN v_project_bid_snapshot s ON s.project_id = p.id
WHERE a.role = 'estimator' AND a.deleted_at IS NULL AND p.deleted_at IS NULL AND e.deleted_at IS NULL;
--> statement-breakpoint

CREATE VIEW v_employee_win_rate AS
SELECT employee_id, employee_name,
       COUNT(*) AS bids,
       SUM(CASE WHEN outcome_status = 'won' THEN 1 ELSE 0 END) AS won,
       SUM(CASE WHEN outcome_status = 'lost' THEN 1 ELSE 0 END) AS lost,
       CAST(SUM(CASE WHEN outcome_status = 'won' THEN 1 ELSE 0 END) AS NUMERIC(18,4))
         / NULLIF(SUM(CASE WHEN outcome_status IN ('won', 'lost') THEN 1 ELSE 0 END), 0) AS win_rate,
       SUM(bid_amount) AS dollars_bid,
       SUM(CASE WHEN outcome_status = 'won' THEN bid_amount ELSE 0 END) AS dollars_won
FROM v_employee_bids
GROUP BY employee_id, employee_name;
--> statement-breakpoint

CREATE VIEW v_employee_estimate_accuracy AS
SELECT b.employee_id, b.employee_name, COUNT(*) AS won_jobs_with_actuals,
       SUM(v.est_direct_cost) AS est_direct_cost, SUM(v.actual_cost) AS actual_cost,
       AVG(v.variance_pct) AS avg_variance_pct,
       AVG(ABS(v.variance_pct)) AS avg_abs_variance_pct
FROM v_employee_bids b
JOIN v_estimate_vs_actual v ON v.project_id = b.project_id
WHERE b.outcome_status = 'won' AND v.actual_entries > 0
GROUP BY b.employee_id, b.employee_name;
--> statement-breakpoint

CREATE VIEW v_expiring_certifications AS
SELECT c.id AS certification_id, c.employee_id, COALESCE(e.display_name, e.first_name) AS employee_name,
       c.cert_type, c.cert_number, c.issued_on, c.expires_on, (c.expires_on - CURRENT_DATE) AS days_until_expiry
FROM employee_certifications c
JOIN employees e ON e.id = c.employee_id
WHERE c.deleted_at IS NULL AND e.deleted_at IS NULL AND c.expires_on IS NOT NULL;
