'use strict';
/**
 * WPM company database - Drizzle ORM schema (Postgres dialect).
 *
 * PORTABILITY RULES (see docs/SQL_SERVER.md):
 *  - only varchar/text, integer/bigint identity, numeric(18,4|6), boolean, timestamp, date
 *  - text PKs (varchar(64)) generated in the app (crypto.randomUUID or the app's own ids)
 *  - no arrays, no enums (varchar + CHECK), no jsonb; a single `extra` text column holds
 *    JSON for lossless UI round-trip of fields that are not (yet) normalized
 *  - every identifier lowercase snake_case <= 30 chars; FK / index / check names are explicit
 *
 * MASTER tables are company-wide (shared by every job). PROJECT tables hang off projects.id.
 */
const { sql } = require('drizzle-orm');
const {
  pgTable, varchar, text, integer, bigint, numeric, boolean, timestamp, date,
  index, uniqueIndex, foreignKey, check, customType,
} = require('drizzle-orm/pg-core');

// ---------- column helpers ----------
const pk = () => varchar('id', { length: 64 }).primaryKey();
const ref = (name) => varchar(name, { length: 64 });
const money = (name) => numeric(name, { precision: 18, scale: 4, mode: 'number' }); // money / qty
const ratio = (name) => numeric(name, { precision: 18, scale: 6, mode: 'number' }); // pct / factors
const ts = (name) => timestamp(name, { mode: 'string', precision: 3 });
const day = (name) => date(name, { mode: 'string' });
const extra = () => text('extra'); // JSON text: unknown/non-fitting fields (UI round-trip only)
/** Soft-delete pair for business tables. Reads filter `deleted_at is null`; repo.restore() clears it. */
const soft = () => ({
  deleted_at: ts('deleted_at'),
  deleted_by: varchar('deleted_by', { length: 64 }),
});
/** bytea (Postgres-only; SQL Server = varbinary(max)). Always returned as a Node Buffer. */
const bytea = customType({
  dataType: () => 'bytea',
  toDriver: (v) => v,
  fromDriver: (v) => (v == null ? v : Buffer.from(v)),
});
const stamps = () => ({
  created_at: ts('created_at').notNull().defaultNow(),
  updated_at: ts('updated_at').notNull().defaultNow(),
});
const fk = (name, columns, foreignColumns, onDelete = 'no action') =>
  foreignKey({ name, columns, foreignColumns }).onDelete(onDelete);
const oneOf = (col, values, nullable = false) =>
  sql.raw(`${nullable ? `${col} is null or ` : ''}${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

// ---------- lookup value lists (varchar + CHECK, no enums) ----------
const COMPANY_TYPES = ['self', 'client', 'gc', 'owner', 'vendor', 'sub', 'agency', 'other'];
const VENDOR_TYPES = ['material', 'trucking', 'sub', 'equipment', 'service', 'other'];
const PROJECT_STATUSES = ['lead', 'bidding', 'submitted', 'won', 'lost', 'no_bid', 'cancelled'];
const EMPLOYEE_ROLES = ['estimator', 'pm', 'superintendent', 'foreman', 'operator', 'laborer', 'truck_driver', 'mechanic', 'admin', 'other'];
const EMPLOYEE_STATUSES = ['active', 'inactive'];
const ASSIGNMENT_ROLES = ['estimator', 'pm', 'superintendent', 'foreman', 'engineer', 'admin', 'other'];
const BID_OUTCOMES = ['pending', 'won', 'lost', 'not_awarded', 'withdrawn'];
const ACTIVITY_ACTIONS = ['create', 'update', 'delete', 'restore', 'status_change', 'export', 'ai_run', 'login'];
const COST_TYPES = ['labor', 'equipment', 'material', 'sub', 'trucking', 'other'];
const STORAGE_KINDS = ['db', 's3'];
const AI_RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];

// =====================================================================
// MASTER (company-wide)
// =====================================================================
const roles = pgTable('roles', {
  id: pk(),
  code: varchar('code', { length: 30 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
}, (t) => [uniqueIndex('ux_roles_code').on(t.code)]);

const app_settings = pgTable('app_settings', {
  setting_key: varchar('setting_key', { length: 60 }).primaryKey(),
  setting_value: text('setting_value'),
  updated_at: ts('updated_at').notNull().defaultNow(),
});

const regions = pgTable('regions', {
  id: pk(),
  code: varchar('code', { length: 30 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  state: varchar('state', { length: 10 }),
  market_type: varchar('market_type', { length: 30 }),
  notes: text('notes'),
  ...stamps(),
  ...soft(),
}, (t) => [uniqueIndex('ux_regions_code').on(t.code)]);

const companies = pgTable('companies', {
  id: pk(),
  name: varchar('name', { length: 300 }).notNull(),
  company_type: varchar('company_type', { length: 20 }).notNull(),
  address1: varchar('address1', { length: 300 }),
  address2: varchar('address2', { length: 300 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 30 }),
  postal_code: varchar('postal_code', { length: 20 }),
  phone: varchar('phone', { length: 40 }),
  email: varchar('email', { length: 200 }),
  website: varchar('website', { length: 300 }),
  notes: text('notes'),
  is_active: boolean('is_active').notNull().default(true),
  ...stamps(),
  ...soft(),
}, (t) => [
  index('ix_companies_name').on(t.name),
  check('ck_companies_type', oneOf('company_type', COMPANY_TYPES)),
]);

const contacts = pgTable('contacts', {
  id: pk(),
  company_id: ref('company_id'),
  first_name: varchar('first_name', { length: 100 }),
  last_name: varchar('last_name', { length: 100 }),
  title: varchar('title', { length: 100 }),
  phone: varchar('phone', { length: 40 }),
  mobile: varchar('mobile', { length: 40 }),
  email: varchar('email', { length: 200 }),
  notes: text('notes'),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_contacts_company', [t.company_id], [companies.id], 'cascade'),
  index('ix_contacts_company').on(t.company_id),
]);

const vendors = pgTable('vendors', {
  id: pk(),
  company_id: ref('company_id'),
  name: varchar('name', { length: 300 }).notNull(),
  vendor_type: varchar('vendor_type', { length: 20 }).notNull().default('material'),
  trade_tags: varchar('trade_tags', { length: 500 }), // comma-separated tags (no arrays)
  phone: varchar('phone', { length: 40 }),
  email: varchar('email', { length: 200 }),
  notes: text('notes'),
  is_active: boolean('is_active').notNull().default(true),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_vendors_company', [t.company_id], [companies.id], 'set null'),
  index('ix_vendors_name').on(t.name),
  check('ck_vendors_type', oneOf('vendor_type', VENDOR_TYPES)),
]);

const labor_classes = pgTable('labor_classes', {
  id: pk(),
  code: varchar('code', { length: 30 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  base_wage: money('base_wage'),
  burden_pct: ratio('burden_pct'),
  effective_from: day('effective_from'),
  effective_to: day('effective_to'),
  notes: text('notes'),
  ...stamps(),
  ...soft(),
}, (t) => [index('ix_labor_classes_code').on(t.code)]);

const equipment_catalog = pgTable('equipment_catalog', {
  id: pk(),
  code: varchar('code', { length: 30 }),
  description: varchar('description', { length: 300 }).notNull(),
  category: varchar('category', { length: 100 }),
  hourly_rate: money('hourly_rate'),
  ownership: varchar('ownership', { length: 10 }),
  effective_from: day('effective_from'),
  effective_to: day('effective_to'),
  notes: text('notes'),
  ...stamps(),
  ...soft(),
}, (t) => [check('ck_equipment_ownership', oneOf('ownership', ['owned', 'rented'], true))]);

const materials_catalog = pgTable('materials_catalog', {
  id: pk(),
  code: varchar('code', { length: 30 }),
  description: varchar('description', { length: 300 }).notNull(),
  unit: varchar('unit', { length: 20 }),
  default_unit_price: money('default_unit_price'),
  default_vendor_id: ref('default_vendor_id'),
  notes: text('notes'),
  ...stamps(),
  ...soft(),
}, (t) => [fk('fk_materials_vendor', [t.default_vendor_id], [vendors.id], 'set null')]);

const employees = pgTable('employees', {
  id: pk(),
  employee_no: varchar('employee_no', { length: 30 }),
  first_name: varchar('first_name', { length: 100 }),
  last_name: varchar('last_name', { length: 100 }),
  display_name: varchar('display_name', { length: 200 }),
  title_role: varchar('title_role', { length: 30 }),
  department: varchar('department', { length: 100 }),
  phone: varchar('phone', { length: 40 }),
  email: varchar('email', { length: 200 }),
  hire_date: day('hire_date'),
  status: varchar('status', { length: 10 }), // null = unknown (seed stores only what we know)
  labor_class_id: ref('labor_class_id'),
  emergency_contact_name: varchar('emergency_contact_name', { length: 200 }),
  emergency_contact_phone: varchar('emergency_contact_phone', { length: 40 }),
  home_yard_or_office: varchar('home_yard_or_office', { length: 300 }),
  notes: text('notes'),
  external_hr_id: varchar('external_hr_id', { length: 60 }),
  ...stamps(),
  ...soft(),
}, (t) => [
  uniqueIndex('ux_employees_no').on(t.employee_no),
  uniqueIndex('ux_employees_hr_id').on(t.external_hr_id),
  fk('fk_employees_labor_class', [t.labor_class_id], [labor_classes.id], 'set null'),
  check('ck_employees_role', oneOf('title_role', EMPLOYEE_ROLES, true)),
  check('ck_employees_status', oneOf('status', EMPLOYEE_STATUSES, true)),
]);

const employee_certifications = pgTable('employee_certifications', {
  id: pk(),
  employee_id: ref('employee_id').notNull(),
  cert_type: varchar('cert_type', { length: 100 }).notNull(), // OSHA 10, OSHA 30, CDL A, CDL B, competent person, ...
  cert_number: varchar('cert_number', { length: 100 }),
  issued_on: day('issued_on'),
  expires_on: day('expires_on'),
  issuer: varchar('issuer', { length: 200 }),
  notes: text('notes'),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_emp_certs_employee', [t.employee_id], [employees.id], 'cascade'),
  index('ix_emp_certs_employee').on(t.employee_id),
  index('ix_emp_certs_expires').on(t.expires_on),
]);

const users = pgTable('users', {
  id: pk(),
  username: varchar('username', { length: 100 }).notNull(),
  display_name: varchar('display_name', { length: 200 }),
  email: varchar('email', { length: 200 }),
  role_id: ref('role_id').notNull(),
  employee_id: ref('employee_id'),
  password_hash: varchar('password_hash', { length: 300 }),
  is_active: boolean('is_active').notNull().default(true),
  last_login_at: ts('last_login_at'),
  ...stamps(),
  ...soft(),
}, (t) => [
  uniqueIndex('ux_users_username').on(t.username),
  uniqueIndex('ux_users_employee').on(t.employee_id),
  fk('fk_users_role', [t.role_id], [roles.id]),
  fk('fk_users_employee', [t.employee_id], [employees.id], 'set null'),
]);

/**
 * Append-only activity log. Written by db/repo.js in the SAME transaction as the change it describes.
 * No FKs on purpose (rows must survive anything); a trigger (migration 0001) rejects UPDATE/DELETE/TRUNCATE.
 */
const activity_log = pgTable('activity_log', {
  id: pk(),
  occurred_at: ts('occurred_at').notNull().defaultNow(),
  user_id: ref('user_id'),
  employee_id: ref('employee_id'),
  project_id: ref('project_id'),
  entity_type: varchar('entity_type', { length: 60 }).notNull(),
  entity_id: varchar('entity_id', { length: 64 }),
  action: varchar('action', { length: 20 }).notNull(),
  before_json: text('before_json'),
  after_json: text('after_json'),
  diff_json: text('diff_json'),
  request_id: varchar('request_id', { length: 100 }),
}, (t) => [
  index('ix_activity_project_time').on(t.project_id, t.occurred_at),
  index('ix_activity_entity').on(t.entity_type, t.entity_id),
  index('ix_activity_user').on(t.user_id),
  index('ix_activity_request').on(t.request_id),
  check('ck_activity_action', oneOf('action', ACTIVITY_ACTIONS)),
]);

/** Company cost codes (generic civil divisions). Used by job_cost_actuals and optionally line items. */
const cost_codes = pgTable('cost_codes', {
  id: pk(),
  code: varchar('code', { length: 30 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  division: varchar('division', { length: 100 }),
  cost_type: varchar('cost_type', { length: 20 }),
  sort_order: integer('sort_order').notNull().default(0),
  ...stamps(),
  ...soft(),
}, (t) => [
  uniqueIndex('ux_cost_codes_code').on(t.code),
  check('ck_cost_codes_type', oneOf('cost_type', COST_TYPES, true)),
]);

/** File bytes (storage_kind=db -> bytes) or a pointer to object storage (storage_kind=s3 -> object_key). */
const stored_files = pgTable('stored_files', {
  id: pk(),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  mime: varchar('mime', { length: 150 }),
  size_bytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  filename: varchar('filename', { length: 400 }),
  storage_kind: varchar('storage_kind', { length: 5 }).notNull().default('db'),
  bytes: bytea('bytes'),
  object_key: varchar('object_key', { length: 600 }),
  created_by: ref('created_by'),
  ...stamps(),
  ...soft(),
}, (t) => [
  index('ix_stored_files_sha').on(t.sha256),
  check('ck_stored_files_kind', oneOf('storage_kind', STORAGE_KINDS)),
  check('ck_stored_files_payload', sql`(storage_kind = 'db' and bytes is not null) or (storage_kind = 's3' and object_key is not null)`),
]);

// ---------- rates / crews ----------
const rate_libraries = pgTable('rate_libraries', {
  id: pk(),
  name: varchar('name', { length: 200 }).notNull(),
  source: varchar('source', { length: 60 }), // e.g. HEB, WPM, FDOT
  region_id: ref('region_id'),
  description: text('description'),
  ...stamps(),
  ...soft(),
}, (t) => [
  uniqueIndex('ux_rate_libraries_name').on(t.name),
  fk('fk_rate_libraries_region', [t.region_id], [regions.id], 'set null'),
]);

const rate_library_versions = pgTable('rate_library_versions', {
  id: pk(),
  rate_library_id: ref('rate_library_id').notNull(),
  version_label: varchar('version_label', { length: 60 }).notNull(),
  region_id: ref('region_id'),
  source: varchar('source', { length: 200 }),
  effective_from: day('effective_from'),
  effective_to: day('effective_to'),
  is_current: boolean('is_current').notNull().default(true),
  notes: text('notes'),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_rlv_library', [t.rate_library_id], [rate_libraries.id], 'cascade'),
  fk('fk_rlv_region', [t.region_id], [regions.id], 'set null'),
  index('ix_rlv_library').on(t.rate_library_id),
]);

const crews = pgTable('crews', {
  id: pk(),
  name: varchar('name', { length: 200 }),
  labor_rate_hr: money('labor_rate_hr'),
  equip_rate_hr: money('equip_rate_hr'),
  source: text('source'),
  sort_order: integer('sort_order').notNull().default(0),
  extra: extra(),
  ...stamps(),
  ...soft(),
}, (t) => [index('ix_crews_name').on(t.name)]);

/** Costing makeup of a crew (labor classes + equipment). People on the crew are crew_members. */
const crew_resources = pgTable('crew_resources', {
  id: pk(),
  crew_id: ref('crew_id').notNull(),
  resource_type: varchar('resource_type', { length: 20 }).notNull(),
  labor_class_id: ref('labor_class_id'),
  equipment_id: ref('equipment_id'),
  quantity: money('quantity').notNull().default(1),
  notes: text('notes'),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_crew_res_crew', [t.crew_id], [crews.id], 'cascade'),
  fk('fk_crew_res_labor_class', [t.labor_class_id], [labor_classes.id], 'set null'),
  fk('fk_crew_res_equipment', [t.equipment_id], [equipment_catalog.id], 'set null'),
  index('ix_crew_res_crew').on(t.crew_id),
  check('ck_crew_res_type', oneOf('resource_type', ['labor', 'equipment'])),
]);

const crew_members = pgTable('crew_members', {
  id: pk(),
  crew_id: ref('crew_id').notNull(),
  employee_id: ref('employee_id').notNull(),
  role_on_crew: varchar('role_on_crew', { length: 30 }),
  effective_from: day('effective_from'),
  effective_to: day('effective_to'),
  notes: text('notes'),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_crew_members_crew', [t.crew_id], [crews.id], 'cascade'),
  fk('fk_crew_members_employee', [t.employee_id], [employees.id], 'cascade'),
  index('ix_crew_members_crew').on(t.crew_id),
  index('ix_crew_members_employee').on(t.employee_id),
]);

const production_rates = pgTable('production_rates', {
  id: pk(),
  version_id: ref('version_id').notNull(),
  crew_id: ref('crew_id'),
  rate_key: varchar('rate_key', { length: 64 }), // app key (e.g. 'pa-10'); line items reference it as rateRef
  item_code: varchar('item_code', { length: 60 }), // HEB activity / cost code
  heb_activity: text('heb_activity'),
  description: text('description'),
  unit: varchar('unit', { length: 20 }),
  crew_name: varchar('crew_name', { length: 200 }),
  units_per_day: money('units_per_day'),
  labor_rate_hr: money('labor_rate_hr'),
  equip_rate_hr: money('equip_rate_hr'),
  material_unit_cost: money('material_unit_cost'),
  status: varchar('status', { length: 60 }),
  source: text('source'),
  notes: text('notes'),
  bid_row: integer('bid_row'),
  heb_qty: money('heb_qty'),
  heb_crew_hrs: money('heb_crew_hrs'),
  sort_order: integer('sort_order').notNull().default(0),
  extra: extra(),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_prod_rates_version', [t.version_id], [rate_library_versions.id], 'cascade'),
  fk('fk_prod_rates_crew', [t.crew_id], [crews.id], 'set null'),
  index('ix_prod_rates_version').on(t.version_id),
  index('ix_prod_rates_item_code').on(t.item_code),
  index('ix_prod_rates_rate_key').on(t.rate_key),
]);

// ---------- quotes (material quotes and sub (LS) quotes share a layout) ----------
function quoteTable(name, abbr) {
  return pgTable(name, {
    id: pk(),
    vendor_id: ref('vendor_id'),
    vendor_name: varchar('vendor_name', { length: 300 }),
    quote_no: varchar('quote_no', { length: 100 }),
    quote_date: day('quote_date'),
    expires_on: day('expires_on'),
    expires_note: text('expires_note'),
    quote_type: varchar('quote_type', { length: 20 }),
    scope: text('scope'),
    notes: text('notes'),
    source: text('source'),
    sheet: varchar('sheet', { length: 200 }),
    total: money('total'),
    tax_rate: ratio('tax_rate'),
    is_complete: boolean('is_complete'),
    completeness_notes: text('completeness_notes'),
    owner_id: ref('owner_id'),
    sort_order: integer('sort_order').notNull().default(0),
    extra: extra(),
    ...stamps(),
    ...soft(),
  }, (t) => [
    fk(`fk_${abbr}_vendor`, [t.vendor_id], [vendors.id], 'set null'),
    fk(`fk_${abbr}_owner`, [t.owner_id], [employees.id], 'set null'),
    index(`ix_${abbr}_vendor`).on(t.vendor_id),
    index(`ix_${abbr}_expires`).on(t.expires_on),
  ]);
}
function quoteLineTable(name, abbr, parent) {
  return pgTable(name, {
    id: pk(),
    quote_id: ref('quote_id').notNull(),
    line_key: varchar('line_key', { length: 64 }),
    description: text('description'),
    unit: varchar('unit', { length: 20 }),
    qty: money('qty'),
    unit_price: money('unit_price'),
    ext: money('ext'),
    scope_key: varchar('scope_key', { length: 100 }),
    is_complete: boolean('is_complete'),
    status: varchar('status', { length: 100 }),
    how_used: text('how_used'),
    proposal_row: integer('proposal_row'),
    haul_unit: money('haul_unit'),
    mat_unit: money('mat_unit'),
    is_ls: boolean('is_ls'),
    tax_exempt: boolean('tax_exempt'),
    unit_note: text('unit_note'),
    sort_order: integer('sort_order').notNull().default(0),
    extra: extra(),
  }, (t) => [
    fk(`fk_${abbr}_quote`, [t.quote_id], [parent.id], 'cascade'),
    index(`ix_${abbr}_quote`).on(t.quote_id),
    index(`ix_${abbr}_scope`).on(t.scope_key),
  ]);
}
const vendor_quotes = quoteTable('vendor_quotes', 'vq');
const vendor_quote_lines = quoteLineTable('vendor_quote_lines', 'vql', vendor_quotes);
const sub_quotes = quoteTable('sub_quotes', 'sq');
const sub_quote_lines = quoteLineTable('sub_quote_lines', 'sql', sub_quotes);

const fdot_reference_prices = pgTable('fdot_reference_prices', {
  id: pk(),
  region_id: ref('region_id'),
  category: varchar('category', { length: 100 }),
  item_label: text('item_label'),
  pay_item: varchar('pay_item', { length: 40 }),
  description: text('description'),
  unit: varchar('unit', { length: 20 }),
  statewide_6mo: money('statewide_6mo'),
  ma10_12mo: money('ma10_12mo'),
  as_of: day('as_of'),
  bid_row: integer('bid_row'),
  note: text('note'),
  sort_order: integer('sort_order').notNull().default(0),
  extra: extra(),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_fdot_region', [t.region_id], [regions.id], 'set null'),
  index('ix_fdot_pay_item').on(t.pay_item),
]);

const exclusion_templates = pgTable('exclusion_templates', {
  id: pk(),
  template_name: varchar('template_name', { length: 100 }).notNull(),
  sort_order: integer('sort_order').notNull().default(0),
  body: text('body').notNull(),
  is_active: boolean('is_active').notNull().default(true),
  ...stamps(),
  ...soft(),
}, (t) => [index('ix_excl_tpl_name').on(t.template_name, t.sort_order)]);

const note_templates = pgTable('note_templates', {
  id: pk(),
  template_name: varchar('template_name', { length: 100 }).notNull(),
  sort_order: integer('sort_order').notNull().default(0),
  body: text('body').notNull(),
  is_active: boolean('is_active').notNull().default(true),
  ...stamps(),
  ...soft(),
}, (t) => [index('ix_note_tpl_name').on(t.template_name, t.sort_order)]);

// =====================================================================
// PROJECT (keyed on project_id)
// =====================================================================
const projects = pgTable('projects', {
  id: pk(),
  project_no: varchar('project_no', { length: 40 }),
  name: text('name'),
  gc_name: text('gc_name'),
  client_company_id: ref('client_company_id'),
  location: text('location'),
  region_id: ref('region_id'),
  bid_date: day('bid_date'),
  status: varchar('status', { length: 20 }).notNull().default('bidding'),
  markup_pct: ratio('markup_pct'),
  tax_pct: ratio('tax_pct'),
  avg_load_tons: money('avg_load_tons'),
  hours_per_day: money('hours_per_day'),
  fill_tons_per_cy: ratio('fill_tons_per_cy'),
  base_tons_per_cy: ratio('base_tons_per_cy'),
  estimator_id: ref('estimator_id'),
  rev: integer('rev').notNull().default(1),
  is_sample: boolean('is_sample').notNull().default(false),
  extra: extra(),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_projects_client', [t.client_company_id], [companies.id], 'set null'),
  fk('fk_projects_region', [t.region_id], [regions.id], 'set null'),
  fk('fk_projects_estimator', [t.estimator_id], [employees.id], 'set null'),
  index('ix_projects_status').on(t.status),
  index('ix_projects_bid_date').on(t.bid_date),
  index('ix_projects_project_no').on(t.project_no),
  check('ck_projects_status', oneOf('status', PROJECT_STATUSES)),
]);

const project_status_history = pgTable('project_status_history', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  from_status: varchar('from_status', { length: 20 }),
  to_status: varchar('to_status', { length: 20 }).notNull(),
  changed_at: ts('changed_at').notNull().defaultNow(),
  changed_by: varchar('changed_by', { length: 100 }),
  note: text('note'),
}, (t) => [
  fk('fk_psh_project', [t.project_id], [projects.id], 'cascade'),
  index('ix_psh_project').on(t.project_id),
]);

const project_assignments = pgTable('project_assignments', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  employee_id: ref('employee_id').notNull(),
  role: varchar('role', { length: 30 }).notNull(),
  start_date: day('start_date'),
  end_date: day('end_date'),
  notes: text('notes'),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_proj_assign_project', [t.project_id], [projects.id], 'cascade'),
  fk('fk_proj_assign_employee', [t.employee_id], [employees.id], 'cascade'),
  index('ix_proj_assign_project').on(t.project_id),
  index('ix_proj_assign_employee').on(t.employee_id),
  check('ck_proj_assign_role', oneOf('role', ASSIGNMENT_ROLES)),
]);

/** Frozen at submission: direct cost, markup and totals + the full project document. Never updated. */
const bid_snapshots = pgTable('bid_snapshots', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  project_rev: integer('project_rev').notNull(),
  snapshot_at: ts('snapshot_at').notNull().defaultNow(),
  reason: varchar('reason', { length: 60 }), // submission | revision | manual
  submitted_on: day('submitted_on'),
  estimator_id: ref('estimator_id'),
  labor_cost: money('labor_cost'),
  equip_cost: money('equip_cost'),
  material_cost: money('material_cost'),
  tax_cost: money('tax_cost'),
  sub_cost: money('sub_cost'),
  direct_cost: money('direct_cost').notNull(),
  markup_pct: ratio('markup_pct'),
  markup_amount: money('markup_amount'),
  bid_total: money('bid_total'), // null when no markup entered (calc.applyMarkup rule)
  sections_json: text('sections_json'), // [{sectionKey,name,total}]
  document_json: text('document_json'), // full project JSON at snapshot time
  earthwork_json: text('earthwork_json'), // mass balance, factors, grading rows frozen with this bid
  created_by: ref('created_by'),
}, (t) => [
  fk('fk_bid_snap_project', [t.project_id], [projects.id], 'cascade'),
  fk('fk_bid_snap_estimator', [t.estimator_id], [employees.id], 'set null'),
  index('ix_bid_snap_project').on(t.project_id, t.snapshot_at),
]);

/** One current outcome per project; history of changes is in activity_log + project_status_history. */
const bid_outcomes = pgTable('bid_outcomes', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  bid_snapshot_id: ref('bid_snapshot_id'),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  decision_date: day('decision_date'),
  awarded_to_company_id: ref('awarded_to_company_id'),
  awarded_to_name: varchar('awarded_to_name', { length: 300 }),
  winning_amount: money('winning_amount'),
  our_bid_total: money('our_bid_total'),
  direct_cost: money('direct_cost'),
  markup_amount: money('markup_amount'),
  markup_pct: ratio('markup_pct'),
  our_rank: integer('our_rank'),
  reason: text('reason'),
  notes: text('notes'),
  ...stamps(),
}, (t) => [
  fk('fk_bid_out_project', [t.project_id], [projects.id], 'cascade'),
  fk('fk_bid_out_snapshot', [t.bid_snapshot_id], [bid_snapshots.id], 'set null'),
  fk('fk_bid_out_company', [t.awarded_to_company_id], [companies.id], 'set null'),
  uniqueIndex('ux_bid_out_project').on(t.project_id),
  index('ix_bid_out_status').on(t.status),
  check('ck_bid_out_status', oneOf('status', BID_OUTCOMES)),
]);

const bid_competitors = pgTable('bid_competitors', {
  id: pk(),
  bid_outcome_id: ref('bid_outcome_id').notNull(),
  project_id: ref('project_id').notNull(),
  company_id: ref('company_id'),
  competitor_name: varchar('competitor_name', { length: 300 }).notNull(),
  bid_amount: money('bid_amount'),
  rank: integer('rank'),
  notes: text('notes'),
}, (t) => [
  fk('fk_bid_comp_outcome', [t.bid_outcome_id], [bid_outcomes.id], 'cascade'),
  fk('fk_bid_comp_project', [t.project_id], [projects.id]),
  fk('fk_bid_comp_company', [t.company_id], [companies.id], 'set null'),
  index('ix_bid_comp_outcome').on(t.bid_outcome_id),
  index('ix_bid_comp_project').on(t.project_id),
]);

const plan_sets = pgTable('plan_sets', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  plan_key: varchar('plan_key', { length: 64 }),
  name: text('name'),
  file_path: text('file_path'), // legacy: relative to DATA_DIR
  stored_file_id: ref('stored_file_id'),
  page_count: integer('page_count'),
  size_bytes: bigint('size_bytes', { mode: 'number' }),
  uploaded_at: ts('uploaded_at'),
  sort_order: integer('sort_order').notNull().default(0),
  extra: extra(),
}, (t) => [
  fk('fk_plan_sets_project', [t.project_id], [projects.id], 'cascade'),
  fk('fk_plan_sets_file', [t.stored_file_id], [stored_files.id], 'set null'),
  index('ix_plan_sets_project').on(t.project_id),
]);

const plan_sheets = pgTable('plan_sheets', {
  id: pk(),
  plan_set_id: ref('plan_set_id').notNull(),
  project_id: ref('project_id').notNull(),
  page_no: integer('page_no').notNull(),
  sheet_label: varchar('sheet_label', { length: 40 }),
  title: text('title'),
  stored_file_id: ref('stored_file_id'), // single-page image/PDF of the sheet
}, (t) => [
  fk('fk_plan_sheets_set', [t.plan_set_id], [plan_sets.id], 'cascade'),
  fk('fk_plan_sheets_project', [t.project_id], [projects.id]),
  fk('fk_plan_sheets_file', [t.stored_file_id], [stored_files.id], 'set null'),
  index('ix_plan_sheets_set').on(t.plan_set_id),
  index('ix_plan_sheets_project').on(t.project_id),
]);

const bid_sections = pgTable('bid_sections', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  section_key: varchar('section_key', { length: 64 }),
  name: text('name'),
  area: varchar('area', { length: 100 }),
  division: varchar('division', { length: 100 }),
  source_row: integer('source_row'),
  sort_order: integer('sort_order').notNull().default(0),
  extra: extra(),
}, (t) => [
  fk('fk_bid_sections_project', [t.project_id], [projects.id], 'cascade'),
  index('ix_bid_sections_project').on(t.project_id),
]);

const line_items = pgTable('line_items', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  bid_section_id: ref('bid_section_id'),
  line_key: varchar('line_key', { length: 64 }),
  section_key: varchar('section_key', { length: 64 }),
  item_no: integer('item_no'), // bid-form row / item number
  group_name: text('group_name'),
  description: text('description'),
  unit: varchar('unit', { length: 20 }),
  estimator_qty: money('estimator_qty'), // the qty that prices the bid
  ai_qty: money('ai_qty'),
  est_qty: money('est_qty'),
  variance: ratio('variance'), // computed at save: (ai - estimator) / estimator
  qty_source: varchar('qty_source', { length: 30 }),
  ai_confidence: ratio('ai_confidence'),
  include_in_bid: boolean('include_in_bid'),
  pricing_method: varchar('pricing_method', { length: 20 }), // computed: production / material / sub / mixed / none
  sheet_ref: text('sheet_ref'),
  flag: text('flag'),
  notes: text('notes'),
  price_source: text('price_source'),
  excluded_reason: text('excluded_reason'),
  proposal_group: text('proposal_group'),
  fdot_ref: varchar('fdot_ref', { length: 64 }),
  is_no_bid_line: boolean('is_no_bid_line'),
  fold_into: varchar('fold_into', { length: 64 }),
  fold_auto: boolean('fold_auto'),
  estimator_id: ref('estimator_id'),
  unit_price: money('unit_price'), // computed at save (direct cost / qty)
  total_cost: money('total_cost'), // computed at save (direct cost, 0 when excluded)
  sort_order: integer('sort_order').notNull().default(0),
  extra: extra(),
}, (t) => [
  fk('fk_line_items_project', [t.project_id], [projects.id], 'cascade'),
  fk('fk_line_items_section', [t.bid_section_id], [bid_sections.id], 'set null'),
  fk('fk_line_items_estimator', [t.estimator_id], [employees.id], 'set null'),
  index('ix_line_items_project').on(t.project_id, t.sort_order),
  index('ix_line_items_section').on(t.bid_section_id),
  index('ix_line_items_desc').on(t.description),
]);

const line_item_quotes = pgTable('line_item_quotes', {
  id: pk(),
  line_item_id: ref('line_item_id').notNull(),
  project_id: ref('project_id').notNull(),
  quote_ref: varchar('quote_ref', { length: 64 }),
  sort_order: integer('sort_order').notNull().default(0),
}, (t) => [
  fk('fk_liq_line', [t.line_item_id], [line_items.id], 'cascade'),
  fk('fk_liq_project', [t.project_id], [projects.id]),
  index('ix_liq_line').on(t.line_item_id),
  index('ix_liq_project').on(t.project_id),
]);

/** Cost build-up of a line (labor / equipment / material / tax / sub / trucking). Inputs + computed results. */
const line_item_costs = pgTable('line_item_costs', {
  id: pk(),
  line_item_id: ref('line_item_id').notNull(),
  project_id: ref('project_id').notNull(),
  item_key: varchar('item_key', { length: 64 }),
  label: text('label'),
  qty: money('qty'),
  unit: varchar('unit', { length: 20 }),
  units_per_day: money('units_per_day'),
  crew_days_override: money('crew_days_override'),
  labor_rate_hr: money('labor_rate_hr'),
  equip_rate_hr: money('equip_rate_hr'),
  crew_name: varchar('crew_name', { length: 200 }),
  rate_ref: varchar('rate_ref', { length: 64 }),
  rate_status: varchar('rate_status', { length: 60 }),
  rate_source: text('rate_source'),
  rate_note: text('rate_note'),
  qty_note: text('qty_note'),
  has_material: boolean('has_material').notNull().default(false),
  mat_unit_price: money('mat_unit_price'),
  mat_ext: money('mat_ext'),
  mat_qty: money('mat_qty'),
  mat_qty_basis: varchar('mat_qty_basis', { length: 20 }),
  mat_qty_factor: ratio('mat_qty_factor'),
  mat_factor_ref: varchar('mat_factor_ref', { length: 20 }),
  mat_fixed: money('mat_fixed'),
  mat_unit: varchar('mat_unit', { length: 20 }),
  mat_tax_exempt: boolean('mat_tax_exempt'),
  mat_note: text('mat_note'),
  has_sub: boolean('has_sub').notNull().default(false),
  sub_amount: money('sub_amount'),
  sub_is_ls: boolean('sub_is_ls'),
  sub_unit_price: money('sub_unit_price'),
  sub_qty: money('sub_qty'),
  sub_qty_basis: varchar('sub_qty_basis', { length: 20 }),
  sub_qty_factor: ratio('sub_qty_factor'),
  sub_factor_ref: varchar('sub_factor_ref', { length: 20 }),
  sub_fixed: money('sub_fixed'),
  sub_unit: varchar('sub_unit', { length: 20 }),
  sub_note: text('sub_note'),
  // computed at save (calc.itemCost) - reporting only, never read back into the UI document
  crew_days: money('crew_days'),
  labor_cost: money('labor_cost'),
  equip_cost: money('equip_cost'),
  material_cost: money('material_cost'),
  tax_cost: money('tax_cost'),
  sub_cost: money('sub_cost'),
  trucking_cost: money('trucking_cost'),
  total_cost: money('total_cost'),
  unit_price: money('unit_price'),
  sort_order: integer('sort_order').notNull().default(0),
  extra: extra(),
}, (t) => [
  fk('fk_lic_line', [t.line_item_id], [line_items.id], 'cascade'),
  fk('fk_lic_project', [t.project_id], [projects.id]),
  index('ix_lic_line').on(t.line_item_id),
  index('ix_lic_project').on(t.project_id),
  index('ix_lic_rate_ref').on(t.rate_ref),
]);

/** Production-rate values frozen at bid time. Editing the library never changes these. */
const project_rate_snapshots = pgTable('project_rate_snapshots', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  rate_key: varchar('rate_key', { length: 64 }).notNull(),
  source_rate_id: ref('source_rate_id'),
  source_version_id: ref('source_version_id'),
  item_code: varchar('item_code', { length: 60 }),
  description: text('description'),
  unit: varchar('unit', { length: 20 }),
  crew_name: varchar('crew_name', { length: 200 }),
  units_per_day: money('units_per_day'),
  labor_rate_hr: money('labor_rate_hr'),
  equip_rate_hr: money('equip_rate_hr'),
  source_extra: text('source_extra'),
  captured_at: ts('captured_at').notNull().defaultNow(),
}, (t) => [
  fk('fk_prs_project', [t.project_id], [projects.id], 'cascade'),
  fk('fk_prs_rate', [t.source_rate_id], [production_rates.id], 'set null'),
  fk('fk_prs_version', [t.source_version_id], [rate_library_versions.id], 'set null'),
  uniqueIndex('ux_prs_project_rate').on(t.project_id, t.rate_key),
]);

const project_price_overrides = pgTable('project_price_overrides', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  line_key: varchar('line_key', { length: 64 }),
  scope_key: varchar('scope_key', { length: 100 }),
  unit_price: money('unit_price').notNull(),
  unit: varchar('unit', { length: 20 }),
  reason: text('reason'),
  created_by: varchar('created_by', { length: 100 }),
  ...stamps(),
}, (t) => [
  fk('fk_ppo_project', [t.project_id], [projects.id], 'cascade'),
  index('ix_ppo_project').on(t.project_id),
]);

function projectLinkTable(name, abbr, col, parent) {
  return pgTable(name, {
    id: pk(),
    project_id: ref('project_id').notNull(),
    [col]: ref(col).notNull(),
    link_source: varchar('link_source', { length: 10 }).notNull().default('manual'), // line | manual
    note: text('note'),
    linked_at: ts('linked_at').notNull().defaultNow(),
  }, (t) => [
    fk(`fk_${abbr}_project`, [t.project_id], [projects.id], 'cascade'),
    fk(`fk_${abbr}_quote`, [t[col]], [parent.id], 'cascade'),
    uniqueIndex(`ux_${abbr}_project_quote`).on(t.project_id, t[col]),
    index(`ix_${abbr}_quote`).on(t[col]),
    check(`ck_${abbr}_source`, oneOf('link_source', ['line', 'manual'])),
  ]);
}
const project_quotes = projectLinkTable('project_quotes', 'pq', 'vendor_quote_id', vendor_quotes);
const project_sub_quotes = projectLinkTable('project_sub_quotes', 'psq', 'sub_quote_id', sub_quotes);

const ai_proposals = pgTable('ai_proposals', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  proposal_key: varchar('proposal_key', { length: 64 }),
  status: varchar('status', { length: 20 }),
  description: text('description'),
  unit: varchar('unit', { length: 20 }),
  qty: money('qty'),
  sheet: text('sheet'),
  confidence: ratio('confidence'),
  division: varchar('division', { length: 100 }),
  method: text('method'),
  calculation: text('calculation'),
  notes: text('notes'),
  plan_file: text('plan_file'),
  created_at: ts('created_at'),
  sort_order: integer('sort_order').notNull().default(0),
  extra: extra(),
}, (t) => [
  fk('fk_ai_prop_project', [t.project_id], [projects.id], 'cascade'),
  index('ix_ai_prop_project').on(t.project_id),
]);

const open_items = pgTable('open_items', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  item_key: varchar('item_key', { length: 64 }),
  body: text('body'),
  area: varchar('area', { length: 100 }),
  qty: money('qty'),
  unit: varchar('unit', { length: 20 }),
  reason: text('reason'),
  line_key: varchar('line_key', { length: 64 }),
  status: varchar('status', { length: 30 }),
  source: text('source'),
  sort_order: integer('sort_order').notNull().default(0),
  extra: extra(),
}, (t) => [
  fk('fk_open_items_project', [t.project_id], [projects.id], 'cascade'),
  index('ix_open_items_project').on(t.project_id),
]);

const assumptions = pgTable('assumptions', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  item_key: varchar('item_key', { length: 64 }),
  body: text('body'),
  status: varchar('status', { length: 30 }),
  source: text('source'),
  sort_order: integer('sort_order').notNull().default(0),
  extra: extra(),
}, (t) => [
  fk('fk_assumptions_project', [t.project_id], [projects.id], 'cascade'),
  index('ix_assumptions_project').on(t.project_id),
]);

const proposal_settings = pgTable('proposal_settings', {
  project_id: varchar('project_id', { length: 64 }).primaryKey(),
  title: text('title'),
  quote_to: text('quote_to'),
  quote_phone: varchar('quote_phone', { length: 60 }),
  quote_fax: varchar('quote_fax', { length: 60 }),
  job_name: text('job_name'),
  date_plans: varchar('date_plans', { length: 60 }),
  rev_date: varchar('rev_date', { length: 60 }),
  footnote: boolean('footnote'),
  custom_exclusions: boolean('custom_exclusions').notNull().default(false),
  custom_notes: boolean('custom_notes').notNull().default(false),
  validity_days: integer('validity_days'),
  has_company: boolean('has_company').notNull().default(false),
  company_name: varchar('company_name', { length: 300 }),
  company_address1: varchar('company_address1', { length: 300 }),
  company_address2: varchar('company_address2', { length: 300 }),
  company_contact: varchar('company_contact', { length: 200 }),
  company_phone: varchar('company_phone', { length: 60 }),
  company_email: varchar('company_email', { length: 200 }),
  extra: extra(),
}, (t) => [fk('fk_proposal_set_project', [t.project_id], [projects.id], 'cascade')]);

const project_exclusions = pgTable('project_exclusions', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  template_id: ref('template_id'),
  body: text('body'),
  sort_order: integer('sort_order').notNull().default(0),
}, (t) => [
  fk('fk_proj_excl_project', [t.project_id], [projects.id], 'cascade'),
  fk('fk_proj_excl_template', [t.template_id], [exclusion_templates.id], 'set null'),
  index('ix_proj_excl_project').on(t.project_id),
]);

const project_notes = pgTable('project_notes', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  template_id: ref('template_id'),
  body: text('body'),
  sort_order: integer('sort_order').notNull().default(0),
}, (t) => [
  fk('fk_proj_notes_project', [t.project_id], [projects.id], 'cascade'),
  fk('fk_proj_notes_template', [t.template_id], [note_templates.id], 'set null'),
  index('ix_proj_notes_project').on(t.project_id),
]);

/** Generated documents (proposal PDF, client bid form XLSX, JSON backup...). */
const exports_ = pgTable('exports', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  export_type: varchar('export_type', { length: 40 }).notNull(),
  filename: varchar('filename', { length: 400 }),
  stored_file_id: ref('stored_file_id'),
  project_rev: integer('project_rev'),
  created_by: ref('created_by'),
  notes: text('notes'),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_exports_project', [t.project_id], [projects.id], 'cascade'),
  fk('fk_exports_file', [t.stored_file_id], [stored_files.id], 'set null'),
  index('ix_exports_project').on(t.project_id),
]);

/** One AI takeoff run (model call) against a project / plan sheet. */
const ai_runs = pgTable('ai_runs', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  plan_sheet_id: ref('plan_sheet_id'),
  model: varchar('model', { length: 100 }),
  prompt_hash: varchar('prompt_hash', { length: 64 }),
  status: varchar('status', { length: 20 }).notNull().default('queued'),
  started_at: ts('started_at'),
  finished_at: ts('finished_at'),
  error: text('error'),
  raw_result: text('raw_result'),
  input_tokens: integer('input_tokens'),
  output_tokens: integer('output_tokens'),
  created_by: ref('created_by'),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_ai_runs_project', [t.project_id], [projects.id], 'cascade'),
  fk('fk_ai_runs_sheet', [t.plan_sheet_id], [plan_sheets.id], 'set null'),
  index('ix_ai_runs_project').on(t.project_id),
  check('ck_ai_runs_status', oneOf('status', AI_RUN_STATUSES)),
]);

const ai_run_results = pgTable('ai_run_results', {
  id: pk(),
  ai_run_id: ref('ai_run_id').notNull(),
  project_id: ref('project_id').notNull(),
  result_key: varchar('result_key', { length: 64 }),
  description: text('description'),
  qty: money('qty'),
  unit: varchar('unit', { length: 20 }),
  confidence: ratio('confidence'),
  sheet: text('sheet'),
  line_key: varchar('line_key', { length: 64 }),
  sort_order: integer('sort_order').notNull().default(0),
  extra: extra(),
}, (t) => [
  fk('fk_ai_res_run', [t.ai_run_id], [ai_runs.id], 'cascade'),
  fk('fk_ai_res_project', [t.project_id], [projects.id]),
  index('ix_ai_res_run').on(t.ai_run_id),
  index('ix_ai_res_project').on(t.project_id),
]);

/** Field / accounting actual costs for estimate-vs-actual. */
const job_cost_actuals = pgTable('job_cost_actuals', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  line_item_id: ref('line_item_id'),
  cost_code_id: ref('cost_code_id'),
  cost_type: varchar('cost_type', { length: 20 }).notNull(),
  qty: money('qty'),
  unit: varchar('unit', { length: 20 }),
  amount: money('amount').notNull(),
  cost_date: day('cost_date'),
  source: varchar('source', { length: 30 }), // manual | csv | accounting
  source_ref: varchar('source_ref', { length: 200 }),
  entered_by: ref('entered_by'),
  notes: text('notes'),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_jca_project', [t.project_id], [projects.id], 'cascade'),
  fk('fk_jca_line', [t.line_item_id], [line_items.id], 'set null'),
  fk('fk_jca_cost_code', [t.cost_code_id], [cost_codes.id], 'set null'),
  index('ix_jca_project').on(t.project_id, t.cost_date),
  index('ix_jca_cost_code').on(t.cost_code_id),
  index('ix_jca_source_ref').on(t.project_id, t.source, t.source_ref),
  check('ck_jca_cost_type', oneOf('cost_type', COST_TYPES)),
]);

// =====================================================================
// EARTHWORK (studio takeoff: one project can have several grids / bids)
// =====================================================================
const EW_ROLES = ['site', 'base', 'alternate', 'phase'];
const EW_SCOPES = ['site', 'phase', 'area'];
const EW_SOURCES = ['file_reference', 'computed'];
const EW_AREA_SOURCES = ['file', 'user'];

/** A grading grid (scenario) belonging to a project. rev is the studio optimistic lock. */
const ew_versions = pgTable('ew_versions', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  scenario_key: varchar('scenario_key', { length: 40 }).notNull(),
  label: varchar('label', { length: 300 }),
  source_file: varchar('source_file', { length: 200 }),
  scenario_role: varchar('scenario_role', { length: 20 }).notNull().default('site'),
  sort_order: integer('sort_order').notNull().default(0),
  strip_in: money('strip_in'),
  shrink_pct: ratio('shrink_pct'),
  swell_pct: ratio('swell_pct'),
  moisture_in: money('moisture_in'),
  overbuild_ft: money('overbuild_ft'),
  finish_offset_ft: money('finish_offset_ft'),
  cell_ft: money('cell_ft'),
  nx: integer('nx'),
  ny: integer('ny'),
  zbase: money('zbase'),
  grid_file_id: ref('grid_file_id'),
  aerial_file_id: ref('aerial_file_id'),
  grading_file_id: ref('grading_file_id'),
  content_sha: varchar('content_sha', { length: 64 }),
  rev: integer('rev').notNull().default(1),
  editor_json: text('editor_json'),
  flags_json: text('flags_json'),
  extra: extra(),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_ew_ver_project', [t.project_id], [projects.id], 'cascade'),
  fk('fk_ew_ver_grid', [t.grid_file_id], [stored_files.id], 'set null'),
  fk('fk_ew_ver_aerial', [t.aerial_file_id], [stored_files.id], 'set null'),
  fk('fk_ew_ver_grading', [t.grading_file_id], [stored_files.id], 'set null'),
  uniqueIndex('ux_ew_ver_scenario').on(t.project_id, t.scenario_key),
  index('ix_ew_ver_project').on(t.project_id),
  check('ck_ew_ver_role', oneOf('scenario_role', EW_ROLES)),
]);

/** Subgrade depth and area identity. File rows are replaced on re-import; user rows stay. */
const ew_areas = pgTable('ew_areas', {
  id: pk(),
  version_id: ref('version_id').notNull(),
  project_id: ref('project_id').notNull(),
  sort_order: integer('sort_order').notNull().default(0),
  name: text('name'),
  area_type: varchar('area_type', { length: 40 }),
  section_in: money('section_in'),
  moisture_in: money('moisture_in'),
  finish_elev: money('finish_elev'),
  source: varchar('source', { length: 20 }).notNull().default('file'),
  extra: extra(),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_ew_areas_version', [t.version_id], [ew_versions.id], 'cascade'),
  fk('fk_ew_areas_project', [t.project_id], [projects.id], 'cascade'),
  index('ix_ew_areas_version').on(t.version_id),
  check('ck_ew_areas_source', oneOf('source', EW_AREA_SOURCES)),
]);

/** Cut, fill, import, export, shrink and swell. One site row plus optional phase or area rows. */
const ew_balance = pgTable('ew_balance', {
  id: pk(),
  version_id: ref('version_id').notNull(),
  project_id: ref('project_id').notNull(),
  scope: varchar('scope', { length: 10 }).notNull(),
  phase_name: varchar('phase_name', { length: 200 }),
  area_name: text('area_name'),
  cut_cy: money('cut_cy'),
  fill_cy: money('fill_cy'),
  fill_bank_cy: money('fill_bank_cy'),
  import_cy: money('import_cy'),
  export_cy: money('export_cy'),
  strip_cy: money('strip_cy'),
  loose_cy: money('loose_cy'),
  balance_cy: money('balance_cy'),
  shrink_pct: ratio('shrink_pct'),
  swell_pct: ratio('swell_pct'),
  area_sy: money('area_sy'),
  moist_sy: money('moist_sy'),
  select_fill_cy: money('select_fill_cy'),
  undercut_cy: money('undercut_cy'),
  source: varchar('source', { length: 20 }).notNull(),
  extra: extra(),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_ew_bal_version', [t.version_id], [ew_versions.id], 'cascade'),
  fk('fk_ew_bal_project', [t.project_id], [projects.id], 'cascade'),
  index('ix_ew_bal_version').on(t.version_id),
  index('ix_ew_bal_project').on(t.project_id),
  check('ck_ew_bal_scope', oneOf('scope', EW_SCOPES)),
  check('ck_ew_bal_source', oneOf('source', EW_SOURCES)),
]);

/** Per-area grading result (from the file when present, otherwise from a studio compute). */
const ew_grading = pgTable('ew_grading', {
  id: pk(),
  version_id: ref('version_id').notNull(),
  project_id: ref('project_id').notNull(),
  sort_order: integer('sort_order').notNull().default(0),
  area_name: text('area_name'),
  area_sy: money('area_sy'),
  section_label: varchar('section_label', { length: 40 }),
  strip_cy: money('strip_cy'),
  cut_cy: money('cut_cy'),
  fill_cy: money('fill_cy'),
  avg_cut_ft: money('avg_cut_ft'),
  avg_fill_ft: money('avg_fill_ft'),
  moist_sy: money('moist_sy'),
  source: varchar('source', { length: 20 }).notNull().default('computed'),
  extra: extra(),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_ew_grd_version', [t.version_id], [ew_versions.id], 'cascade'),
  fk('fk_ew_grd_project', [t.project_id], [projects.id], 'cascade'),
  index('ix_ew_grd_version').on(t.version_id),
  check('ck_ew_grd_source', oneOf('source', EW_SOURCES)),
]);

/** Company-wide equipment and crew card the studio edits. Separate from the HEB rate library. */
const studio_rates = pgTable('studio_rates', {
  id: pk(),
  rev: integer('rev').notNull().default(1),
  document_json: text('document_json'),
  ...stamps(),
  ...soft(),
});

/** Per-scenario bid worksheet (quantities, trucking, material unit prices). Dollars stay null until the user edits rates. */
const studio_bids = pgTable('studio_bids', {
  id: pk(),
  project_id: ref('project_id').notNull(),
  version_id: ref('version_id').notNull(),
  rev: integer('rev').notNull().default(1),
  items_json: text('items_json'),
  custom_json: text('custom_json'),
  trucks_json: text('trucks_json'),
  direct_cost: money('direct_cost'),
  bid_total: money('bid_total'),
  touched: boolean('touched').notNull().default(false),
  ...stamps(),
  ...soft(),
}, (t) => [
  fk('fk_studio_bids_project', [t.project_id], [projects.id], 'cascade'),
  fk('fk_studio_bids_version', [t.version_id], [ew_versions.id], 'cascade'),
  uniqueIndex('ux_studio_bids_version').on(t.version_id),
  index('ix_studio_bids_project').on(t.project_id),
]);

/** Login sessions. The cookie holds the raw token; the row stores only its sha256. */
const user_sessions = pgTable('user_sessions', {
  id: pk(),
  token_hash: varchar('token_hash', { length: 64 }).notNull(),
  user_id: ref('user_id'),
  employee_id: ref('employee_id'),
  expires_at: ts('expires_at').notNull(),
  ...stamps(),
  ...soft(),
}, (t) => [
  uniqueIndex('ux_user_sessions_hash').on(t.token_hash),
  fk('fk_sessions_user', [t.user_id], [users.id], 'cascade'),
  fk('fk_sessions_employee', [t.employee_id], [employees.id], 'set null'),
  index('ix_sessions_expires').on(t.expires_at),
]);

module.exports = {
  // value lists
  COMPANY_TYPES, VENDOR_TYPES, PROJECT_STATUSES, EMPLOYEE_ROLES, EMPLOYEE_STATUSES, ASSIGNMENT_ROLES, BID_OUTCOMES,
  ACTIVITY_ACTIONS, COST_TYPES, STORAGE_KINDS, AI_RUN_STATUSES, EW_ROLES, EW_SCOPES, EW_SOURCES, EW_AREA_SOURCES,
  // master
  roles, app_settings, regions, companies, contacts, vendors, labor_classes, equipment_catalog, materials_catalog,
  employees, employee_certifications, users, activity_log, cost_codes, stored_files, rate_libraries, rate_library_versions,
  crews, crew_resources, crew_members, production_rates, vendor_quotes, vendor_quote_lines, sub_quotes, sub_quote_lines,
  fdot_reference_prices, exclusion_templates, note_templates,
  // project
  projects, project_status_history, project_assignments, bid_snapshots, bid_outcomes, bid_competitors, plan_sets,
  plan_sheets, bid_sections, line_items, line_item_quotes, line_item_costs, project_rate_snapshots, project_price_overrides,
  project_quotes, project_sub_quotes, ai_proposals, open_items, assumptions, proposal_settings, project_exclusions,
  project_notes, exports: exports_, ai_runs, ai_run_results, job_cost_actuals,
  ew_versions, ew_areas, ew_balance, ew_grading, studio_rates, studio_bids, user_sessions,
};
