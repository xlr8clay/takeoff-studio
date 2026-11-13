CREATE TABLE "roles" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"setting_key" varchar(60) PRIMARY KEY NOT NULL,
	"setting_value" text,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" varchar(200) NOT NULL,
	"state" varchar(10),
	"market_type" varchar(30),
	"notes" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(300) NOT NULL,
	"company_type" varchar(20) NOT NULL,
	"address1" varchar(300),
	"address2" varchar(300),
	"city" varchar(100),
	"state" varchar(30),
	"postal_code" varchar(20),
	"phone" varchar(40),
	"email" varchar(200),
	"website" varchar(300),
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64),
	CONSTRAINT "ck_companies_type" CHECK (company_type in ('self', 'client', 'gc', 'owner', 'vendor', 'sub', 'agency', 'other'))
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" varchar(64),
	"first_name" varchar(100),
	"last_name" varchar(100),
	"title" varchar(100),
	"phone" varchar(40),
	"mobile" varchar(40),
	"email" varchar(200),
	"notes" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" varchar(64),
	"name" varchar(300) NOT NULL,
	"vendor_type" varchar(20) DEFAULT 'material' NOT NULL,
	"trade_tags" varchar(500),
	"phone" varchar(40),
	"email" varchar(200),
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64),
	CONSTRAINT "ck_vendors_type" CHECK (vendor_type in ('material', 'trucking', 'sub', 'equipment', 'service', 'other'))
);
--> statement-breakpoint
CREATE TABLE "labor_classes" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" varchar(200) NOT NULL,
	"base_wage" numeric(18, 4),
	"burden_pct" numeric(18, 6),
	"effective_from" date,
	"effective_to" date,
	"notes" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "equipment_catalog" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"code" varchar(30),
	"description" varchar(300) NOT NULL,
	"category" varchar(100),
	"hourly_rate" numeric(18, 4),
	"ownership" varchar(10),
	"effective_from" date,
	"effective_to" date,
	"notes" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64),
	CONSTRAINT "ck_equipment_ownership" CHECK (ownership is null or ownership in ('owned', 'rented'))
);
--> statement-breakpoint
CREATE TABLE "materials_catalog" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"code" varchar(30),
	"description" varchar(300) NOT NULL,
	"unit" varchar(20),
	"default_unit_price" numeric(18, 4),
	"default_vendor_id" varchar(64),
	"notes" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"employee_no" varchar(30),
	"first_name" varchar(100),
	"last_name" varchar(100),
	"display_name" varchar(200),
	"title_role" varchar(30),
	"department" varchar(100),
	"phone" varchar(40),
	"email" varchar(200),
	"hire_date" date,
	"status" varchar(10),
	"labor_class_id" varchar(64),
	"emergency_contact_name" varchar(200),
	"emergency_contact_phone" varchar(40),
	"home_yard_or_office" varchar(300),
	"notes" text,
	"external_hr_id" varchar(60),
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64),
	CONSTRAINT "ck_employees_role" CHECK (title_role is null or title_role in ('estimator', 'pm', 'superintendent', 'foreman', 'operator', 'laborer', 'truck_driver', 'mechanic', 'admin', 'other')),
	CONSTRAINT "ck_employees_status" CHECK (status is null or status in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "employee_certifications" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"employee_id" varchar(64) NOT NULL,
	"cert_type" varchar(100) NOT NULL,
	"cert_number" varchar(100),
	"issued_on" date,
	"expires_on" date,
	"issuer" varchar(200),
	"notes" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"username" varchar(100) NOT NULL,
	"display_name" varchar(200),
	"email" varchar(200),
	"role_id" varchar(64) NOT NULL,
	"employee_id" varchar(64),
	"password_hash" varchar(300),
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp(3),
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"occurred_at" timestamp(3) DEFAULT now() NOT NULL,
	"user_id" varchar(64),
	"employee_id" varchar(64),
	"project_id" varchar(64),
	"entity_type" varchar(60) NOT NULL,
	"entity_id" varchar(64),
	"action" varchar(20) NOT NULL,
	"before_json" text,
	"after_json" text,
	"diff_json" text,
	"request_id" varchar(100),
	CONSTRAINT "ck_activity_action" CHECK (action in ('create', 'update', 'delete', 'restore', 'status_change', 'export', 'ai_run', 'login'))
);
--> statement-breakpoint
CREATE TABLE "cost_codes" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" varchar(200) NOT NULL,
	"division" varchar(100),
	"cost_type" varchar(20),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64),
	CONSTRAINT "ck_cost_codes_type" CHECK (cost_type is null or cost_type in ('labor', 'equipment', 'material', 'sub', 'trucking', 'other'))
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"mime" varchar(150),
	"size_bytes" bigint NOT NULL,
	"filename" varchar(400),
	"storage_kind" varchar(5) DEFAULT 'db' NOT NULL,
	"bytes" "bytea",
	"object_key" varchar(600),
	"created_by" varchar(64),
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64),
	CONSTRAINT "ck_stored_files_kind" CHECK (storage_kind in ('db', 's3')),
	CONSTRAINT "ck_stored_files_payload" CHECK ((storage_kind = 'db' and bytes is not null) or (storage_kind = 's3' and object_key is not null))
);
--> statement-breakpoint
CREATE TABLE "rate_libraries" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"source" varchar(60),
	"region_id" varchar(64),
	"description" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "rate_library_versions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"rate_library_id" varchar(64) NOT NULL,
	"version_label" varchar(60) NOT NULL,
	"region_id" varchar(64),
	"source" varchar(200),
	"effective_from" date,
	"effective_to" date,
	"is_current" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "crews" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(200),
	"labor_rate_hr" numeric(18, 4),
	"equip_rate_hr" numeric(18, 4),
	"source" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"extra" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "crew_resources" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"crew_id" varchar(64) NOT NULL,
	"resource_type" varchar(20) NOT NULL,
	"labor_class_id" varchar(64),
	"equipment_id" varchar(64),
	"quantity" numeric(18, 4) DEFAULT 1 NOT NULL,
	"notes" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64),
	CONSTRAINT "ck_crew_res_type" CHECK (resource_type in ('labor', 'equipment'))
);
--> statement-breakpoint
CREATE TABLE "crew_members" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"crew_id" varchar(64) NOT NULL,
	"employee_id" varchar(64) NOT NULL,
	"role_on_crew" varchar(30),
	"effective_from" date,
	"effective_to" date,
	"notes" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "production_rates" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"version_id" varchar(64) NOT NULL,
	"crew_id" varchar(64),
	"rate_key" varchar(64),
	"item_code" varchar(60),
	"heb_activity" text,
	"description" text,
	"unit" varchar(20),
	"crew_name" varchar(200),
	"units_per_day" numeric(18, 4),
	"labor_rate_hr" numeric(18, 4),
	"equip_rate_hr" numeric(18, 4),
	"material_unit_cost" numeric(18, 4),
	"status" varchar(60),
	"source" text,
	"notes" text,
	"bid_row" integer,
	"heb_qty" numeric(18, 4),
	"heb_crew_hrs" numeric(18, 4),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"extra" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "vendor_quotes" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"vendor_id" varchar(64),
	"vendor_name" varchar(300),
	"quote_no" varchar(100),
	"quote_date" date,
	"expires_on" date,
	"expires_note" text,
	"quote_type" varchar(20),
	"scope" text,
	"notes" text,
	"source" text,
	"sheet" varchar(200),
	"total" numeric(18, 4),
	"tax_rate" numeric(18, 6),
	"is_complete" boolean,
	"completeness_notes" text,
	"owner_id" varchar(64),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"extra" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "vendor_quote_lines" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"quote_id" varchar(64) NOT NULL,
	"line_key" varchar(64),
	"description" text,
	"unit" varchar(20),
	"qty" numeric(18, 4),
	"unit_price" numeric(18, 4),
	"ext" numeric(18, 4),
	"scope_key" varchar(100),
	"is_complete" boolean,
	"status" varchar(100),
	"how_used" text,
	"proposal_row" integer,
	"haul_unit" numeric(18, 4),
	"mat_unit" numeric(18, 4),
	"is_ls" boolean,
	"tax_exempt" boolean,
	"unit_note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"extra" text
);
--> statement-breakpoint
CREATE TABLE "sub_quotes" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"vendor_id" varchar(64),
	"vendor_name" varchar(300),
	"quote_no" varchar(100),
	"quote_date" date,
	"expires_on" date,
	"expires_note" text,
	"quote_type" varchar(20),
	"scope" text,
	"notes" text,
	"source" text,
	"sheet" varchar(200),
	"total" numeric(18, 4),
	"tax_rate" numeric(18, 6),
	"is_complete" boolean,
	"completeness_notes" text,
	"owner_id" varchar(64),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"extra" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "sub_quote_lines" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"quote_id" varchar(64) NOT NULL,
	"line_key" varchar(64),
	"description" text,
	"unit" varchar(20),
	"qty" numeric(18, 4),
	"unit_price" numeric(18, 4),
	"ext" numeric(18, 4),
	"scope_key" varchar(100),
	"is_complete" boolean,
	"status" varchar(100),
	"how_used" text,
	"proposal_row" integer,
	"haul_unit" numeric(18, 4),
	"mat_unit" numeric(18, 4),
	"is_ls" boolean,
	"tax_exempt" boolean,
	"unit_note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"extra" text
);
--> statement-breakpoint
CREATE TABLE "fdot_reference_prices" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"region_id" varchar(64),
	"category" varchar(100),
	"item_label" text,
	"pay_item" varchar(40),
	"description" text,
	"unit" varchar(20),
	"statewide_6mo" numeric(18, 4),
	"ma10_12mo" numeric(18, 4),
	"as_of" date,
	"bid_row" integer,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"extra" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "exclusion_templates" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"template_name" varchar(100) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"body" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "note_templates" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"template_name" varchar(100) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"body" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_no" varchar(40),
	"name" text,
	"gc_name" text,
	"client_company_id" varchar(64),
	"location" text,
	"region_id" varchar(64),
	"bid_date" date,
	"status" varchar(20) DEFAULT 'bidding' NOT NULL,
	"markup_pct" numeric(18, 6),
	"tax_pct" numeric(18, 6),
	"avg_load_tons" numeric(18, 4),
	"hours_per_day" numeric(18, 4),
	"fill_tons_per_cy" numeric(18, 6),
	"base_tons_per_cy" numeric(18, 6),
	"estimator_id" varchar(64),
	"rev" integer DEFAULT 1 NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"extra" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64),
	CONSTRAINT "ck_projects_status" CHECK (status in ('lead', 'bidding', 'submitted', 'won', 'lost', 'no_bid', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "project_status_history" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"from_status" varchar(20),
	"to_status" varchar(20) NOT NULL,
	"changed_at" timestamp(3) DEFAULT now() NOT NULL,
	"changed_by" varchar(100),
	"note" text
);
--> statement-breakpoint
CREATE TABLE "project_assignments" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"employee_id" varchar(64) NOT NULL,
	"role" varchar(30) NOT NULL,
	"start_date" date,
	"end_date" date,
	"notes" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64),
	CONSTRAINT "ck_proj_assign_role" CHECK (role in ('estimator', 'pm', 'superintendent', 'foreman', 'engineer', 'admin', 'other'))
);
--> statement-breakpoint
CREATE TABLE "bid_snapshots" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"project_rev" integer NOT NULL,
	"snapshot_at" timestamp(3) DEFAULT now() NOT NULL,
	"reason" varchar(60),
	"submitted_on" date,
	"estimator_id" varchar(64),
	"labor_cost" numeric(18, 4),
	"equip_cost" numeric(18, 4),
	"material_cost" numeric(18, 4),
	"tax_cost" numeric(18, 4),
	"sub_cost" numeric(18, 4),
	"direct_cost" numeric(18, 4) NOT NULL,
	"markup_pct" numeric(18, 6),
	"markup_amount" numeric(18, 4),
	"bid_total" numeric(18, 4),
	"sections_json" text,
	"document_json" text,
	"created_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "bid_outcomes" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"bid_snapshot_id" varchar(64),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"decision_date" date,
	"awarded_to_company_id" varchar(64),
	"awarded_to_name" varchar(300),
	"winning_amount" numeric(18, 4),
	"our_bid_total" numeric(18, 4),
	"direct_cost" numeric(18, 4),
	"markup_amount" numeric(18, 4),
	"markup_pct" numeric(18, 6),
	"our_rank" integer,
	"reason" text,
	"notes" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_bid_out_status" CHECK (status in ('pending', 'won', 'lost', 'not_awarded', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "bid_competitors" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"bid_outcome_id" varchar(64) NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"company_id" varchar(64),
	"competitor_name" varchar(300) NOT NULL,
	"bid_amount" numeric(18, 4),
	"rank" integer,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "plan_sets" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"plan_key" varchar(64),
	"name" text,
	"file_path" text,
	"stored_file_id" varchar(64),
	"page_count" integer,
	"size_bytes" bigint,
	"uploaded_at" timestamp(3),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"extra" text
);
--> statement-breakpoint
CREATE TABLE "plan_sheets" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"plan_set_id" varchar(64) NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"page_no" integer NOT NULL,
	"sheet_label" varchar(40),
	"title" text,
	"stored_file_id" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "bid_sections" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"section_key" varchar(64),
	"name" text,
	"area" varchar(100),
	"division" varchar(100),
	"source_row" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"extra" text
);
--> statement-breakpoint
CREATE TABLE "line_items" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"bid_section_id" varchar(64),
	"line_key" varchar(64),
	"section_key" varchar(64),
	"item_no" integer,
	"group_name" text,
	"description" text,
	"unit" varchar(20),
	"estimator_qty" numeric(18, 4),
	"ai_qty" numeric(18, 4),
	"est_qty" numeric(18, 4),
	"variance" numeric(18, 6),
	"qty_source" varchar(30),
	"ai_confidence" numeric(18, 6),
	"include_in_bid" boolean,
	"pricing_method" varchar(20),
	"sheet_ref" text,
	"flag" text,
	"notes" text,
	"price_source" text,
	"excluded_reason" text,
	"proposal_group" text,
	"fdot_ref" varchar(64),
	"is_no_bid_line" boolean,
	"fold_into" varchar(64),
	"fold_auto" boolean,
	"estimator_id" varchar(64),
	"unit_price" numeric(18, 4),
	"total_cost" numeric(18, 4),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"extra" text
);
--> statement-breakpoint
CREATE TABLE "line_item_quotes" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"line_item_id" varchar(64) NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"quote_ref" varchar(64),
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_item_costs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"line_item_id" varchar(64) NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"item_key" varchar(64),
	"label" text,
	"qty" numeric(18, 4),
	"unit" varchar(20),
	"units_per_day" numeric(18, 4),
	"crew_days_override" numeric(18, 4),
	"labor_rate_hr" numeric(18, 4),
	"equip_rate_hr" numeric(18, 4),
	"crew_name" varchar(200),
	"rate_ref" varchar(64),
	"rate_status" varchar(60),
	"rate_source" text,
	"rate_note" text,
	"qty_note" text,
	"has_material" boolean DEFAULT false NOT NULL,
	"mat_unit_price" numeric(18, 4),
	"mat_ext" numeric(18, 4),
	"mat_qty" numeric(18, 4),
	"mat_qty_basis" varchar(20),
	"mat_qty_factor" numeric(18, 6),
	"mat_factor_ref" varchar(20),
	"mat_fixed" numeric(18, 4),
	"mat_unit" varchar(20),
	"mat_tax_exempt" boolean,
	"mat_note" text,
	"has_sub" boolean DEFAULT false NOT NULL,
	"sub_amount" numeric(18, 4),
	"sub_is_ls" boolean,
	"sub_unit_price" numeric(18, 4),
	"sub_qty" numeric(18, 4),
	"sub_qty_basis" varchar(20),
	"sub_qty_factor" numeric(18, 6),
	"sub_factor_ref" varchar(20),
	"sub_fixed" numeric(18, 4),
	"sub_unit" varchar(20),
	"sub_note" text,
	"crew_days" numeric(18, 4),
	"labor_cost" numeric(18, 4),
	"equip_cost" numeric(18, 4),
	"material_cost" numeric(18, 4),
	"tax_cost" numeric(18, 4),
	"sub_cost" numeric(18, 4),
	"trucking_cost" numeric(18, 4),
	"total_cost" numeric(18, 4),
	"unit_price" numeric(18, 4),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"extra" text
);
--> statement-breakpoint
CREATE TABLE "project_rate_snapshots" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"rate_key" varchar(64) NOT NULL,
	"source_rate_id" varchar(64),
	"source_version_id" varchar(64),
	"item_code" varchar(60),
	"description" text,
	"unit" varchar(20),
	"crew_name" varchar(200),
	"units_per_day" numeric(18, 4),
	"labor_rate_hr" numeric(18, 4),
	"equip_rate_hr" numeric(18, 4),
	"source_extra" text,
	"captured_at" timestamp(3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_price_overrides" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"line_key" varchar(64),
	"scope_key" varchar(100),
	"unit_price" numeric(18, 4) NOT NULL,
	"unit" varchar(20),
	"reason" text,
	"created_by" varchar(100),
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_quotes" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"vendor_quote_id" varchar(64) NOT NULL,
	"link_source" varchar(10) DEFAULT 'manual' NOT NULL,
	"note" text,
	"linked_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_pq_source" CHECK (link_source in ('line', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "project_sub_quotes" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"sub_quote_id" varchar(64) NOT NULL,
	"link_source" varchar(10) DEFAULT 'manual' NOT NULL,
	"note" text,
	"linked_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_psq_source" CHECK (link_source in ('line', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "ai_proposals" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"proposal_key" varchar(64),
	"status" varchar(20),
	"description" text,
	"unit" varchar(20),
	"qty" numeric(18, 4),
	"sheet" text,
	"confidence" numeric(18, 6),
	"division" varchar(100),
	"method" text,
	"calculation" text,
	"notes" text,
	"plan_file" text,
	"created_at" timestamp(3),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"extra" text
);
--> statement-breakpoint
CREATE TABLE "open_items" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"item_key" varchar(64),
	"body" text,
	"area" varchar(100),
	"qty" numeric(18, 4),
	"unit" varchar(20),
	"reason" text,
	"line_key" varchar(64),
	"status" varchar(30),
	"source" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"extra" text
);
--> statement-breakpoint
CREATE TABLE "assumptions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"item_key" varchar(64),
	"body" text,
	"status" varchar(30),
	"source" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"extra" text
);
--> statement-breakpoint
CREATE TABLE "proposal_settings" (
	"project_id" varchar(64) PRIMARY KEY NOT NULL,
	"title" text,
	"quote_to" text,
	"quote_phone" varchar(60),
	"quote_fax" varchar(60),
	"job_name" text,
	"date_plans" varchar(60),
	"rev_date" varchar(60),
	"footnote" boolean,
	"custom_exclusions" boolean DEFAULT false NOT NULL,
	"custom_notes" boolean DEFAULT false NOT NULL,
	"validity_days" integer,
	"has_company" boolean DEFAULT false NOT NULL,
	"company_name" varchar(300),
	"company_address1" varchar(300),
	"company_address2" varchar(300),
	"company_contact" varchar(200),
	"company_phone" varchar(60),
	"company_email" varchar(200),
	"extra" text
);
--> statement-breakpoint
CREATE TABLE "project_exclusions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"template_id" varchar(64),
	"body" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_notes" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"template_id" varchar(64),
	"body" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"export_type" varchar(40) NOT NULL,
	"filename" varchar(400),
	"stored_file_id" varchar(64),
	"project_rev" integer,
	"created_by" varchar(64),
	"notes" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"plan_sheet_id" varchar(64),
	"model" varchar(100),
	"prompt_hash" varchar(64),
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"started_at" timestamp(3),
	"finished_at" timestamp(3),
	"error" text,
	"raw_result" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_by" varchar(64),
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64),
	CONSTRAINT "ck_ai_runs_status" CHECK (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "ai_run_results" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"ai_run_id" varchar(64) NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"result_key" varchar(64),
	"description" text,
	"qty" numeric(18, 4),
	"unit" varchar(20),
	"confidence" numeric(18, 6),
	"sheet" text,
	"line_key" varchar(64),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"extra" text
);
--> statement-breakpoint
CREATE TABLE "job_cost_actuals" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"line_item_id" varchar(64),
	"cost_code_id" varchar(64),
	"cost_type" varchar(20) NOT NULL,
	"qty" numeric(18, 4),
	"unit" varchar(20),
	"amount" numeric(18, 4) NOT NULL,
	"cost_date" date,
	"source" varchar(30),
	"source_ref" varchar(200),
	"entered_by" varchar(64),
	"notes" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64),
	CONSTRAINT "ck_jca_cost_type" CHECK (cost_type in ('labor', 'equipment', 'material', 'sub', 'trucking', 'other'))
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "fk_contacts_company" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "fk_vendors_company" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials_catalog" ADD CONSTRAINT "fk_materials_vendor" FOREIGN KEY ("default_vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "fk_employees_labor_class" FOREIGN KEY ("labor_class_id") REFERENCES "public"."labor_classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_certifications" ADD CONSTRAINT "fk_emp_certs_employee" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "fk_users_role" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "fk_users_employee" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_libraries" ADD CONSTRAINT "fk_rate_libraries_region" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_library_versions" ADD CONSTRAINT "fk_rlv_library" FOREIGN KEY ("rate_library_id") REFERENCES "public"."rate_libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_library_versions" ADD CONSTRAINT "fk_rlv_region" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_resources" ADD CONSTRAINT "fk_crew_res_crew" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_resources" ADD CONSTRAINT "fk_crew_res_labor_class" FOREIGN KEY ("labor_class_id") REFERENCES "public"."labor_classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_resources" ADD CONSTRAINT "fk_crew_res_equipment" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment_catalog"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "fk_crew_members_crew" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "fk_crew_members_employee" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_rates" ADD CONSTRAINT "fk_prod_rates_version" FOREIGN KEY ("version_id") REFERENCES "public"."rate_library_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_rates" ADD CONSTRAINT "fk_prod_rates_crew" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_quotes" ADD CONSTRAINT "fk_vq_vendor" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_quotes" ADD CONSTRAINT "fk_vq_owner" FOREIGN KEY ("owner_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_quote_lines" ADD CONSTRAINT "fk_vql_quote" FOREIGN KEY ("quote_id") REFERENCES "public"."vendor_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_quotes" ADD CONSTRAINT "fk_sq_vendor" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_quotes" ADD CONSTRAINT "fk_sq_owner" FOREIGN KEY ("owner_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_quote_lines" ADD CONSTRAINT "fk_sql_quote" FOREIGN KEY ("quote_id") REFERENCES "public"."sub_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fdot_reference_prices" ADD CONSTRAINT "fk_fdot_region" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "fk_projects_client" FOREIGN KEY ("client_company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "fk_projects_region" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "fk_projects_estimator" FOREIGN KEY ("estimator_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_status_history" ADD CONSTRAINT "fk_psh_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "fk_proj_assign_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "fk_proj_assign_employee" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_snapshots" ADD CONSTRAINT "fk_bid_snap_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_snapshots" ADD CONSTRAINT "fk_bid_snap_estimator" FOREIGN KEY ("estimator_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_outcomes" ADD CONSTRAINT "fk_bid_out_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_outcomes" ADD CONSTRAINT "fk_bid_out_snapshot" FOREIGN KEY ("bid_snapshot_id") REFERENCES "public"."bid_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_outcomes" ADD CONSTRAINT "fk_bid_out_company" FOREIGN KEY ("awarded_to_company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_competitors" ADD CONSTRAINT "fk_bid_comp_outcome" FOREIGN KEY ("bid_outcome_id") REFERENCES "public"."bid_outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_competitors" ADD CONSTRAINT "fk_bid_comp_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_competitors" ADD CONSTRAINT "fk_bid_comp_company" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_sets" ADD CONSTRAINT "fk_plan_sets_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_sets" ADD CONSTRAINT "fk_plan_sets_file" FOREIGN KEY ("stored_file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_sheets" ADD CONSTRAINT "fk_plan_sheets_set" FOREIGN KEY ("plan_set_id") REFERENCES "public"."plan_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_sheets" ADD CONSTRAINT "fk_plan_sheets_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_sheets" ADD CONSTRAINT "fk_plan_sheets_file" FOREIGN KEY ("stored_file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_sections" ADD CONSTRAINT "fk_bid_sections_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "fk_line_items_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "fk_line_items_section" FOREIGN KEY ("bid_section_id") REFERENCES "public"."bid_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "fk_line_items_estimator" FOREIGN KEY ("estimator_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_item_quotes" ADD CONSTRAINT "fk_liq_line" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_item_quotes" ADD CONSTRAINT "fk_liq_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_item_costs" ADD CONSTRAINT "fk_lic_line" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_item_costs" ADD CONSTRAINT "fk_lic_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_rate_snapshots" ADD CONSTRAINT "fk_prs_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_rate_snapshots" ADD CONSTRAINT "fk_prs_rate" FOREIGN KEY ("source_rate_id") REFERENCES "public"."production_rates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_rate_snapshots" ADD CONSTRAINT "fk_prs_version" FOREIGN KEY ("source_version_id") REFERENCES "public"."rate_library_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_price_overrides" ADD CONSTRAINT "fk_ppo_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_quotes" ADD CONSTRAINT "fk_pq_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_quotes" ADD CONSTRAINT "fk_pq_quote" FOREIGN KEY ("vendor_quote_id") REFERENCES "public"."vendor_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sub_quotes" ADD CONSTRAINT "fk_psq_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sub_quotes" ADD CONSTRAINT "fk_psq_quote" FOREIGN KEY ("sub_quote_id") REFERENCES "public"."sub_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "fk_ai_prop_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_items" ADD CONSTRAINT "fk_open_items_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assumptions" ADD CONSTRAINT "fk_assumptions_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_settings" ADD CONSTRAINT "fk_proposal_set_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_exclusions" ADD CONSTRAINT "fk_proj_excl_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_exclusions" ADD CONSTRAINT "fk_proj_excl_template" FOREIGN KEY ("template_id") REFERENCES "public"."exclusion_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_notes" ADD CONSTRAINT "fk_proj_notes_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_notes" ADD CONSTRAINT "fk_proj_notes_template" FOREIGN KEY ("template_id") REFERENCES "public"."note_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "fk_exports_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "fk_exports_file" FOREIGN KEY ("stored_file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "fk_ai_runs_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "fk_ai_runs_sheet" FOREIGN KEY ("plan_sheet_id") REFERENCES "public"."plan_sheets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run_results" ADD CONSTRAINT "fk_ai_res_run" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run_results" ADD CONSTRAINT "fk_ai_res_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cost_actuals" ADD CONSTRAINT "fk_jca_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cost_actuals" ADD CONSTRAINT "fk_jca_line" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cost_actuals" ADD CONSTRAINT "fk_jca_cost_code" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_roles_code" ON "roles" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_regions_code" ON "regions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ix_companies_name" ON "companies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "ix_contacts_company" ON "contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ix_vendors_name" ON "vendors" USING btree ("name");--> statement-breakpoint
CREATE INDEX "ix_labor_classes_code" ON "labor_classes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_employees_no" ON "employees" USING btree ("employee_no");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_employees_hr_id" ON "employees" USING btree ("external_hr_id");--> statement-breakpoint
CREATE INDEX "ix_emp_certs_employee" ON "employee_certifications" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "ix_emp_certs_expires" ON "employee_certifications" USING btree ("expires_on");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_users_username" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_users_employee" ON "users" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "ix_activity_project_time" ON "activity_log" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_activity_entity" ON "activity_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "ix_activity_user" ON "activity_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_activity_request" ON "activity_log" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_cost_codes_code" ON "cost_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ix_stored_files_sha" ON "stored_files" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_rate_libraries_name" ON "rate_libraries" USING btree ("name");--> statement-breakpoint
CREATE INDEX "ix_rlv_library" ON "rate_library_versions" USING btree ("rate_library_id");--> statement-breakpoint
CREATE INDEX "ix_crews_name" ON "crews" USING btree ("name");--> statement-breakpoint
CREATE INDEX "ix_crew_res_crew" ON "crew_resources" USING btree ("crew_id");--> statement-breakpoint
CREATE INDEX "ix_crew_members_crew" ON "crew_members" USING btree ("crew_id");--> statement-breakpoint
CREATE INDEX "ix_crew_members_employee" ON "crew_members" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "ix_prod_rates_version" ON "production_rates" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "ix_prod_rates_item_code" ON "production_rates" USING btree ("item_code");--> statement-breakpoint
CREATE INDEX "ix_prod_rates_rate_key" ON "production_rates" USING btree ("rate_key");--> statement-breakpoint
CREATE INDEX "ix_vq_vendor" ON "vendor_quotes" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "ix_vq_expires" ON "vendor_quotes" USING btree ("expires_on");--> statement-breakpoint
CREATE INDEX "ix_vql_quote" ON "vendor_quote_lines" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "ix_vql_scope" ON "vendor_quote_lines" USING btree ("scope_key");--> statement-breakpoint
CREATE INDEX "ix_sq_vendor" ON "sub_quotes" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "ix_sq_expires" ON "sub_quotes" USING btree ("expires_on");--> statement-breakpoint
CREATE INDEX "ix_sql_quote" ON "sub_quote_lines" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "ix_sql_scope" ON "sub_quote_lines" USING btree ("scope_key");--> statement-breakpoint
CREATE INDEX "ix_fdot_pay_item" ON "fdot_reference_prices" USING btree ("pay_item");--> statement-breakpoint
CREATE INDEX "ix_excl_tpl_name" ON "exclusion_templates" USING btree ("template_name","sort_order");--> statement-breakpoint
CREATE INDEX "ix_note_tpl_name" ON "note_templates" USING btree ("template_name","sort_order");--> statement-breakpoint
CREATE INDEX "ix_projects_status" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_projects_bid_date" ON "projects" USING btree ("bid_date");--> statement-breakpoint
CREATE INDEX "ix_projects_project_no" ON "projects" USING btree ("project_no");--> statement-breakpoint
CREATE INDEX "ix_psh_project" ON "project_status_history" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_proj_assign_project" ON "project_assignments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_proj_assign_employee" ON "project_assignments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "ix_bid_snap_project" ON "bid_snapshots" USING btree ("project_id","snapshot_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_bid_out_project" ON "bid_outcomes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_bid_out_status" ON "bid_outcomes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_bid_comp_outcome" ON "bid_competitors" USING btree ("bid_outcome_id");--> statement-breakpoint
CREATE INDEX "ix_bid_comp_project" ON "bid_competitors" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_plan_sets_project" ON "plan_sets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_plan_sheets_set" ON "plan_sheets" USING btree ("plan_set_id");--> statement-breakpoint
CREATE INDEX "ix_plan_sheets_project" ON "plan_sheets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_bid_sections_project" ON "bid_sections" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_line_items_project" ON "line_items" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX "ix_line_items_section" ON "line_items" USING btree ("bid_section_id");--> statement-breakpoint
CREATE INDEX "ix_line_items_desc" ON "line_items" USING btree ("description");--> statement-breakpoint
CREATE INDEX "ix_liq_line" ON "line_item_quotes" USING btree ("line_item_id");--> statement-breakpoint
CREATE INDEX "ix_liq_project" ON "line_item_quotes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_lic_line" ON "line_item_costs" USING btree ("line_item_id");--> statement-breakpoint
CREATE INDEX "ix_lic_project" ON "line_item_costs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_lic_rate_ref" ON "line_item_costs" USING btree ("rate_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_prs_project_rate" ON "project_rate_snapshots" USING btree ("project_id","rate_key");--> statement-breakpoint
CREATE INDEX "ix_ppo_project" ON "project_price_overrides" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_pq_project_quote" ON "project_quotes" USING btree ("project_id","vendor_quote_id");--> statement-breakpoint
CREATE INDEX "ix_pq_quote" ON "project_quotes" USING btree ("vendor_quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_psq_project_quote" ON "project_sub_quotes" USING btree ("project_id","sub_quote_id");--> statement-breakpoint
CREATE INDEX "ix_psq_quote" ON "project_sub_quotes" USING btree ("sub_quote_id");--> statement-breakpoint
CREATE INDEX "ix_ai_prop_project" ON "ai_proposals" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_open_items_project" ON "open_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_assumptions_project" ON "assumptions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_proj_excl_project" ON "project_exclusions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_proj_notes_project" ON "project_notes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_exports_project" ON "exports" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_ai_runs_project" ON "ai_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_ai_res_run" ON "ai_run_results" USING btree ("ai_run_id");--> statement-breakpoint
CREATE INDEX "ix_ai_res_project" ON "ai_run_results" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_jca_project" ON "job_cost_actuals" USING btree ("project_id","cost_date");--> statement-breakpoint
CREATE INDEX "ix_jca_cost_code" ON "job_cost_actuals" USING btree ("cost_code_id");--> statement-breakpoint
CREATE INDEX "ix_jca_source_ref" ON "job_cost_actuals" USING btree ("project_id","source","source_ref");