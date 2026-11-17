-- Earthwork Takeoff Studio tables. Portable column types (see docs/SQL_SERVER.md).
-- Bid snapshots gain a nullable earthwork_json so a frozen bid can carry the mass balance.
ALTER TABLE "bid_snapshots" ADD COLUMN "earthwork_json" text;
--> statement-breakpoint
CREATE TABLE "ew_versions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"scenario_key" varchar(40) NOT NULL,
	"label" varchar(300),
	"source_file" varchar(200),
	"scenario_role" varchar(20) DEFAULT 'site' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"strip_in" numeric(18, 4),
	"shrink_pct" numeric(18, 6),
	"swell_pct" numeric(18, 6),
	"moisture_in" numeric(18, 4),
	"overbuild_ft" numeric(18, 4),
	"finish_offset_ft" numeric(18, 4),
	"cell_ft" numeric(18, 4),
	"nx" integer,
	"ny" integer,
	"zbase" numeric(18, 4),
	"grid_file_id" varchar(64),
	"aerial_file_id" varchar(64),
	"grading_file_id" varchar(64),
	"content_sha" varchar(64),
	"rev" integer DEFAULT 1 NOT NULL,
	"editor_json" text,
	"flags_json" text,
	"extra" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64),
	CONSTRAINT "fk_ew_ver_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade,
	CONSTRAINT "fk_ew_ver_grid" FOREIGN KEY ("grid_file_id") REFERENCES "stored_files"("id") ON DELETE set null,
	CONSTRAINT "fk_ew_ver_aerial" FOREIGN KEY ("aerial_file_id") REFERENCES "stored_files"("id") ON DELETE set null,
	CONSTRAINT "fk_ew_ver_grading" FOREIGN KEY ("grading_file_id") REFERENCES "stored_files"("id") ON DELETE set null,
	CONSTRAINT "ck_ew_ver_role" CHECK (scenario_role in ('site', 'base', 'alternate', 'phase'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ux_ew_ver_scenario" ON "ew_versions" ("project_id","scenario_key");
--> statement-breakpoint
CREATE INDEX "ix_ew_ver_project" ON "ew_versions" ("project_id");
--> statement-breakpoint
CREATE TABLE "ew_areas" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"version_id" varchar(64) NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"name" text,
	"area_type" varchar(40),
	"section_in" numeric(18, 4),
	"moisture_in" numeric(18, 4),
	"finish_elev" numeric(18, 4),
	"source" varchar(20) DEFAULT 'file' NOT NULL,
	"extra" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64),
	CONSTRAINT "fk_ew_areas_version" FOREIGN KEY ("version_id") REFERENCES "ew_versions"("id") ON DELETE cascade,
	CONSTRAINT "fk_ew_areas_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade,
	CONSTRAINT "ck_ew_areas_source" CHECK (source in ('file', 'user'))
);
--> statement-breakpoint
CREATE INDEX "ix_ew_areas_version" ON "ew_areas" ("version_id");
--> statement-breakpoint
CREATE TABLE "ew_balance" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"version_id" varchar(64) NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"scope" varchar(10) NOT NULL,
	"phase_name" varchar(200),
	"area_name" text,
	"cut_cy" numeric(18, 4),
	"fill_cy" numeric(18, 4),
	"fill_bank_cy" numeric(18, 4),
	"import_cy" numeric(18, 4),
	"export_cy" numeric(18, 4),
	"strip_cy" numeric(18, 4),
	"loose_cy" numeric(18, 4),
	"balance_cy" numeric(18, 4),
	"shrink_pct" numeric(18, 6),
	"swell_pct" numeric(18, 6),
	"area_sy" numeric(18, 4),
	"moist_sy" numeric(18, 4),
	"select_fill_cy" numeric(18, 4),
	"undercut_cy" numeric(18, 4),
	"source" varchar(20) NOT NULL,
	"extra" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64),
	CONSTRAINT "fk_ew_bal_version" FOREIGN KEY ("version_id") REFERENCES "ew_versions"("id") ON DELETE cascade,
	CONSTRAINT "fk_ew_bal_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade,
	CONSTRAINT "ck_ew_bal_scope" CHECK (scope in ('site', 'phase', 'area')),
	CONSTRAINT "ck_ew_bal_source" CHECK (source in ('file_reference', 'computed'))
);
--> statement-breakpoint
CREATE INDEX "ix_ew_bal_version" ON "ew_balance" ("version_id");
--> statement-breakpoint
CREATE INDEX "ix_ew_bal_project" ON "ew_balance" ("project_id");
--> statement-breakpoint
CREATE TABLE "ew_grading" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"version_id" varchar(64) NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"area_name" text,
	"area_sy" numeric(18, 4),
	"section_label" varchar(40),
	"strip_cy" numeric(18, 4),
	"cut_cy" numeric(18, 4),
	"fill_cy" numeric(18, 4),
	"avg_cut_ft" numeric(18, 4),
	"avg_fill_ft" numeric(18, 4),
	"moist_sy" numeric(18, 4),
	"source" varchar(20) DEFAULT 'computed' NOT NULL,
	"extra" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64),
	CONSTRAINT "fk_ew_grd_version" FOREIGN KEY ("version_id") REFERENCES "ew_versions"("id") ON DELETE cascade,
	CONSTRAINT "fk_ew_grd_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade,
	CONSTRAINT "ck_ew_grd_source" CHECK (source in ('file_reference', 'computed'))
);
--> statement-breakpoint
CREATE INDEX "ix_ew_grd_version" ON "ew_grading" ("version_id");
--> statement-breakpoint
CREATE TABLE "studio_rates" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"document_json" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "studio_bids" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"version_id" varchar(64) NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"items_json" text,
	"custom_json" text,
	"trucks_json" text,
	"direct_cost" numeric(18, 4),
	"bid_total" numeric(18, 4),
	"touched" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64),
	CONSTRAINT "fk_studio_bids_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade,
	CONSTRAINT "fk_studio_bids_version" FOREIGN KEY ("version_id") REFERENCES "ew_versions"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ux_studio_bids_version" ON "studio_bids" ("version_id");
--> statement-breakpoint
CREATE INDEX "ix_studio_bids_project" ON "studio_bids" ("project_id");
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"user_id" varchar(64),
	"employee_id" varchar(64),
	"expires_at" timestamp(3) NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3),
	"deleted_by" varchar(64),
	CONSTRAINT "fk_sessions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade,
	CONSTRAINT "fk_sessions_employee" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ux_user_sessions_hash" ON "user_sessions" ("token_hash");
--> statement-breakpoint
CREATE INDEX "ix_sessions_expires" ON "user_sessions" ("expires_at");
--> statement-breakpoint
CREATE VIEW v_ew_balance AS
SELECT b.id AS balance_id, b.project_id, p.name AS project_name, p.status AS project_status,
       b.version_id, v.scenario_key, v.label AS version_label, v.source_file,
       b.scope, b.phase_name, b.area_name, b.cut_cy, b.fill_cy, b.fill_bank_cy,
       b.import_cy, b.export_cy, b.strip_cy, b.loose_cy, b.balance_cy,
       b.shrink_pct, b.swell_pct, b.area_sy, b.moist_sy, b.select_fill_cy, b.undercut_cy,
       b.source
FROM ew_balance b
JOIN ew_versions v ON v.id = b.version_id
JOIN projects p ON p.id = b.project_id
WHERE b.deleted_at IS NULL AND v.deleted_at IS NULL AND p.deleted_at IS NULL;
