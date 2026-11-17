# SQL Server portability

`db/migrations/0000_init.sql` uses only portable types: `varchar/text`, `integer`, `bigint`, `numeric(18,4|6)`,
`boolean`, `timestamp(3)`, `date`; text (uuid) primary keys generated in the app; `CHECK` constraints instead of
enums; no arrays; JSON lives in `text` columns (`extra`, `*_json`). Everything Postgres-specific is isolated in
`0001_pg_specific.sql` (trigger + views) plus the `bytea` column on `stored_files`.
`0002_earthwork.sql` uses the same portable column types. Its view `v_ew_balance` is ordinary SQL.

## Type mapping

| Postgres (here) | SQL Server |
|---|---|
| `varchar(n)` / `text` | `nvarchar(n)` / `nvarchar(max)` |
| `numeric(18,4)` | `decimal(18,4)` |
| `boolean` | `bit` |
| `timestamp(3)` / `DEFAULT now()` | `datetime2(3)` / `DEFAULT sysutcdatetime()` |
| `date` | `date` |
| `bigint` | `bigint` |
| `bytea` (`stored_files.bytes`) | `varbinary(max)` (or FILESTREAM / blob storage with `storage_kind='s3'`) |
| `CHECK (col in (...))` | same |
| FK `ON DELETE CASCADE / SET NULL` | same (watch for multiple cascade paths: switch a few to `NO ACTION`) |
| `ON CONFLICT ... DO UPDATE` (repo.js upserts) | `MERGE` |
| `LIMIT n` | `TOP (n)` / `OFFSET ... FETCH` |
| `NULLS LAST` | `ORDER BY CASE WHEN x IS NULL THEN 1 ELSE 0 END, x` |

## activity_log append-only

Postgres (0001):
```sql
CREATE TRIGGER trg_activity_log_no_update_delete BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW EXECUTE FUNCTION activity_log_append_only();   -- RAISE EXCEPTION
```
Plus permissions for the app role (run as the DB owner on Render; recommended in addition to the trigger):
```sql
CREATE ROLE takeoff_app LOGIN PASSWORD '...';         -- or use the Render-provided user for the app
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO takeoff_app;
REVOKE UPDATE, DELETE, TRUNCATE ON activity_log FROM takeoff_app;
```
SQL Server equivalent:
```sql
CREATE TRIGGER trg_activity_log_no_update_delete ON activity_log
INSTEAD OF UPDATE, DELETE AS
BEGIN
  THROW 50001, 'activity_log is append-only', 1;
END;
GO
DENY UPDATE, DELETE ON dbo.activity_log TO takeoff_app;
```
(Consider SQL Server Ledger tables - `WITH (LEDGER = ON (APPEND_ONLY = ON))` - for tamper evidence.)

## Views

All views in 0001 use ANSI SQL except:

| Postgres | SQL Server |
|---|---|
| `EXTRACT(YEAR FROM p.bid_date)` (v_bid_hit_rate) | `YEAR(p.bid_date)` |
| `c.expires_on - CURRENT_DATE` (v_expiring_certifications) | `DATEDIFF(day, CAST(GETDATE() AS date), c.expires_on)` |
| `ORDER BY ... LIMIT 1` in subquery (v_project_bid_snapshot) | `SELECT TOP (1) ... ORDER BY ...` |
| `CREATE VIEW v AS SELECT h.*` | same (SQL Server needs explicit column names only for `SCHEMABINDING`) |
| `TRUE` literal | `1` |

## App code

`db/repo.js` uses drizzle's pg-core builders; for SQL Server swap the schema to `drizzle-orm/mssql-core`
(or another ORM) - column names, ids, CHECK lists and JSON-in-text conventions stay the same, so data can be
moved with a plain table-by-table copy.
