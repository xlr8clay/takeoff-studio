# HR import (employees)

`db/import-employees.js` is a **stub** CSV upsert for an HR/payroll export. Extend the column mapping once the
real export format is known.

```bash
node db/import-employees.js path/to/hr-export.csv
```

## Columns (header row, case-insensitive; all optional except an id)

| column | notes |
|---|---|
| `external_hr_id` | preferred match key (HR system id) - unique |
| `employee_no` | second match key - unique |
| `first_name`, `last_name`, `display_name` | |
| `title_role` | one of `estimator, pm, superintendent, foreman, operator, laborer, truck_driver, mechanic, admin, other` (lower-cased) |
| `department`, `phone`, `email`, `home_yard_or_office`, `notes` | |
| `hire_date` | `YYYY-MM-DD` |
| `status` | `active` / `inactive` (lower-cased) |
| `emergency_contact_name`, `emergency_contact_phone` | sensitive - restrict who can read |

## Rules

- Match order: `external_hr_id`, then `employee_no`. No match -> insert.
- **Blank cells never overwrite** existing values (so partial exports are safe).
- Rows with neither id are reported in `errors` with their CSV line number and skipped.
- Every insert/update goes through `repo.upsertEmployee` -> one `activity_log` row each (request id `hr-import-<ts>`).
- Re-running the same file is a no-op (`unchanged` count).
- Certifications: add with `repo.addCertification(employeeId, { cert_type, cert_number, issued_on, expires_on })`;
  `v_expiring_certifications` lists them with `days_until_expiry`.
- Linking a login: set `users.employee_id`.

Fixture: `test/fixtures/hr-employees.sample.csv` (placeholder test rows - not real people).

The five seeded employees (Zach, Clay Deering, Darren, Joe, Charles) have no `external_hr_id`/`employee_no` yet.
Before the first real import, set those keys on the existing rows (e.g. `repo.upsertEmployee({ id: 'emp-zach', external_hr_id: '...' })`)
so the import updates them instead of creating duplicates.
