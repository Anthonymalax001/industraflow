-- ============================================================
-- IndustraFlow — Migration 003: Assets & Equipment hardening
--
-- Brings the pre-existing `assets` table up to the tenancy standard
-- that migration 001 established for the workforce model and migration
-- 002 established for suppliers.
--
--   tenancy     : assets.company_id         (NOT NULL, always)
--   deployment  : assets.project_id         (NULLABLE — see below)
--   provenance  : assets.supplier_id        (NULLABLE — vendor / lessor)
--   lifecycle   : assets.status             active | inactive
--   operations  : assets.operational_status available | in_use
--                                           | under_maintenance
--                                           | out_of_service
--
-- The table is ALTERed in place, never dropped and recreated, so the
-- id sequence and the table's identity survive.
--
-- An asset is a COMPANY-level capital record, not a project-level one.
-- project_id records where the asset is deployed RIGHT NOW and is
-- nullable: equipment sitting in the yard belongs to the company and to
-- no project. There is deliberately no asset_assignments history table
-- in this phase, so this column is the whole deployment story.
--
-- Safe to run as written: assets is empty at the time of authoring
-- (SELECT count(*) FROM assets = 0), so every constraint below applies
-- without a backfill step. The guards are written to fail loudly rather
-- than silently invent data if that ever stops being true.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. COLUMN NAMING
-- ============================================================

-- Every other master record in this schema calls it `name`
-- (suppliers.name, workers.name, projects.name,
-- worker_certifications.name). `asset_name` was the odd one out and no
-- application code reads it yet, so the rename is free now and
-- impossible later.

ALTER TABLE assets RENAME COLUMN asset_name TO name;


-- PostgreSQL 17+ tracks NOT NULL as a named catalog constraint, and a
-- column rename does not rename it. Keep the name in step where the
-- server supports it; skip silently where it does not.

DO $$
BEGIN

    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.assets'::regclass
          AND conname  = 'assets_asset_name_not_null'
    ) THEN

        ALTER TABLE assets
            RENAME CONSTRAINT assets_asset_name_not_null
            TO assets_name_not_null;

    END IF;

END $$;


-- ============================================================
-- 2. TENANT ANCHOR: company_id becomes mandatory
-- ============================================================

-- An asset with no company belongs to no tenant. It is invisible to
-- every "WHERE company_id = $1" query, which means it can never be
-- read, updated or deleted through the API — an unreachable orphan.
-- Forbid the state outright.

ALTER TABLE assets ADD COLUMN company_id INTEGER;


-- The only derivable owner is the parent project, exactly as migration
-- 001 backfilled contractors. Assets with no project_id have no path to
-- an owner, which is why the guard below exists rather than a default.

UPDATE assets a
SET company_id = p.company_id
FROM projects p
WHERE p.id = a.project_id
  AND a.company_id IS NULL;


-- Stop rather than guess. Inventing an owner would be worse than
-- failing: it would file another company's equipment under the wrong
-- tenant, which is precisely the failure this migration exists to make
-- impossible.

DO $$
DECLARE
    orphan_count INTEGER;
BEGIN

    SELECT count(*) INTO orphan_count FROM assets WHERE company_id IS NULL;

    IF orphan_count > 0 THEN

        RAISE EXCEPTION
            'Migration 003 aborted: % asset row(s) have no derivable company_id '
            '(project_id is NULL, so there is no owner to inherit). '
            'Assign these rows to a company by hand, then re-run.',
            orphan_count;

    END IF;

END $$;


ALTER TABLE assets ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE assets
    ADD CONSTRAINT assets_company_fkey
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;


-- Composite-FK target, matching projects, contractors, workers and
-- suppliers.
--
-- Nothing references assets today. This exists so that a future
-- asset_maintenance / asset_assignments / asset_documents table can
-- declare
--
--     FOREIGN KEY (company_id, asset_id)
--         REFERENCES assets (company_id, id)
--
-- and inherit cross-tenant safety from the database rather than from
-- application code. Retrofitting this after child tables exist would
-- mean dropping and recreating their foreign keys, so it goes in now
-- while the table is empty.
--
-- It also serves as the (company_id, ...) index, so no standalone index
-- on company_id is needed.

ALTER TABLE assets
    ADD CONSTRAINT assets_company_id_unique UNIQUE (company_id, id);


-- ============================================================
-- 3. PROJECT RELATIONSHIP: tenant-safe, and non-destructive
-- ============================================================

-- The inherited constraint was
--
--     FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
--
-- which is wrong twice over:
--
--   * It is single-column, so nothing stopped an asset in company A
--     from pointing at a project in company B.
--
--   * ON DELETE CASCADE means deleting a project DESTROYS every asset
--     parked on it. Migration 001 rejected exactly this reasoning for
--     people ("Personnel are NOT collateral damage of a contractor
--     delete") and for history (worker_assignments -> projects is
--     ON DELETE RESTRICT). A company does not stop owning an excavator
--     because a project ended.

ALTER TABLE assets DROP CONSTRAINT assets_project_id_fkey;


-- The replacement is composite, so the project is forced to belong to
-- the same company as the asset — cross-tenant deployment becomes
-- structurally impossible rather than merely checked in application
-- code.
--
-- The FK uses the default MATCH SIMPLE, under which a row with a NULL
-- project_id satisfies the constraint without needing a parent. That is
-- what lets an asset sit unassigned in the yard.
--
-- ON DELETE SET NULL (project_id) names a single column, so deleting a
-- project returns its assets to the unassigned pool instead of
-- destroying them, and leaves the tenant anchor untouched. The
-- column-list form requires PostgreSQL 15 or newer (this database is
-- 18.4); without it the whole key including company_id would be
-- nulled, which the NOT NULL above would reject.

ALTER TABLE assets
    ADD CONSTRAINT assets_project_same_company
    FOREIGN KEY (company_id, project_id)
    REFERENCES projects (company_id, id)
    ON DELETE SET NULL (project_id);


-- ============================================================
-- 4. TWO ORTHOGONAL STATUS COLUMNS
-- ============================================================

-- The inherited `status` column defaulted to 'available', i.e. it held
-- an OPERATIONAL meaning. The rest of this codebase uses `status` for
-- the LIFECYCLE axis — it is what DELETE sets to 'inactive' on
-- suppliers and workers.
--
-- Rather than break that convention for one table, the operational
-- meaning moves to a new column and `status` is repurposed to mean what
-- it means everywhere else. Folding both into one column would make an
-- asset that is away for repair indistinguishable from one that has
-- been written off — the same mistake migration 002 avoided by keeping
-- suppliers.status apart from suppliers.verification_status.

ALTER TABLE assets ADD COLUMN operational_status VARCHAR(20);


-- Carry the old meaning across BEFORE `status` is overwritten below.
-- Anything unrecognised falls back to the column default rather than
-- becoming an unnamed third state.

UPDATE assets
SET operational_status = CASE
        WHEN status IN ('available', 'in_use', 'under_maintenance', 'out_of_service')
            THEN status
        ELSE 'available'
    END;

UPDATE assets
SET operational_status = 'available'
WHERE operational_status IS NULL;


ALTER TABLE assets ALTER COLUMN operational_status SET DEFAULT 'available';

ALTER TABLE assets ALTER COLUMN operational_status SET NOT NULL;

ALTER TABLE assets
    ADD CONSTRAINT assets_operational_status_valid
    CHECK (operational_status IN
        ('available', 'in_use', 'under_maintenance', 'out_of_service'));


-- Now repurpose `status` as the lifecycle column. NOT NULL with a
-- default, matching suppliers.status and worker_assignments.status: a
-- NULL here would satisfy the CHECK below (a CHECK is not violated by
-- NULL) and would quietly become a third, unnamed lifecycle state.

ALTER TABLE assets ALTER COLUMN status DROP DEFAULT;

UPDATE assets SET status = 'active';

ALTER TABLE assets ALTER COLUMN status TYPE VARCHAR(20);

ALTER TABLE assets ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE assets ALTER COLUMN status SET NOT NULL;

ALTER TABLE assets
    ADD CONSTRAINT assets_status_valid
    CHECK (status IN ('active', 'inactive'));


-- ============================================================
-- 5. ASSET TYPE (controlled vocabulary)
-- ============================================================

-- asset_type stays nullable — the category is genuinely unknown for
-- some inherited kit — but the values it may take are now fixed.
--
-- suppliers.service_type was left as free text and the ?service_type=
-- filter has to compare it with lower(btrim(...)) as a result. A
-- whitelist here keeps the ?asset_type= filter an exact, index-friendly
-- match, and it can be widened by a later migration.
--
-- The IS NULL arm is redundant (a CHECK is satisfied by NULL) but is
-- written out so the intent is unambiguous to the next reader.

ALTER TABLE assets
    ADD CONSTRAINT assets_asset_type_valid
    CHECK (
        asset_type IS NULL
        OR asset_type IN (
            'heavy_equipment',
            'vehicle',
            'power_tool',
            'generator',
            'it_equipment',
            'safety_equipment',
            'other'
        )
    );


-- ============================================================
-- 6. ASSET IDENTIFICATION
-- ============================================================

-- Two independent optional identifiers:
--
--   serial_number  the manufacturer's serial, which may be unknown,
--                  worn off, or simply not recorded yet
--
--   asset_tag      the company's own yard sticker / fleet number. This
--                  is the equipment analogue of workers.employee_number
--
-- Both are UNIQUE PER COMPANY only WHEN PRESENT, so any number of
-- assets may have neither. Compared case-insensitively and with
-- surrounding whitespace ignored, so 'EXC-001', 'exc-001' and
-- '  EXC-001  ' collide as the same identifier.
--
-- These mirror workers_company_employee_number_key, which is likewise
-- partial on IS NOT NULL.

ALTER TABLE assets ADD COLUMN asset_tag VARCHAR(50);


CREATE UNIQUE INDEX assets_company_serial_number_key
    ON assets (company_id, lower(btrim(serial_number)))
    WHERE serial_number IS NOT NULL;

CREATE UNIQUE INDEX assets_company_asset_tag_key
    ON assets (company_id, lower(btrim(asset_tag)))
    WHERE asset_tag IS NOT NULL;


-- Note there is deliberately NO unique constraint on `name`. Unlike
-- suppliers, where one company has exactly one "Rift Valley Cement
-- Ltd", a company legitimately owns ten identical "Generator 5kVA"
-- units. Names are labels here, not identifiers.


-- ============================================================
-- 7. OWNERSHIP, SUPPLIER AND FINANCIALS
-- ============================================================

ALTER TABLE assets
    ADD COLUMN ownership_type VARCHAR(20) NOT NULL DEFAULT 'owned';

ALTER TABLE assets
    ADD CONSTRAINT assets_ownership_type_valid
    CHECK (ownership_type IN ('owned', 'rented', 'leased'));


-- supplier_id is meaningful for ALL THREE ownership types: for owned
-- kit it is the vendor the asset was bought from, for rented and leased
-- kit it is the lessor.
--
-- This is the first consumer of suppliers_company_id_unique, which
-- migration 002 created for exactly this purpose. Composite again, so a
-- company can never attach another company's supplier.
--
-- ON DELETE RESTRICT: an asset's provenance must not evaporate. In
-- practice suppliers are soft-deleted (status = 'inactive') and never
-- physically removed, so this rarely fires — it is the backstop for a
-- direct DELETE.

ALTER TABLE assets ADD COLUMN supplier_id INTEGER;

ALTER TABLE assets
    ADD CONSTRAINT assets_supplier_same_company
    FOREIGN KEY (company_id, supplier_id)
    REFERENCES suppliers (company_id, id) ON DELETE RESTRICT;


ALTER TABLE assets ADD COLUMN purchase_date     DATE;
ALTER TABLE assets ADD COLUMN purchase_cost     NUMERIC(12,2);
ALTER TABLE assets ADD COLUMN rental_start_date DATE;
ALTER TABLE assets ADD COLUMN rental_end_date   DATE;
ALTER TABLE assets ADD COLUMN rental_rate       NUMERIC(12,2);


-- Rented or leased equipment belongs to somebody, and that somebody is
-- a supplier. Owned equipment may name the vendor it was bought from
-- but does not have to.
--
-- This is the same shape as workers_employer_xor from migration 001:
-- the relationship implied by a type column is enforced declaratively
-- rather than trusted to application code.

ALTER TABLE assets
    ADD CONSTRAINT assets_rental_supplier_required
    CHECK (ownership_type = 'owned' OR supplier_id IS NOT NULL);


-- Mirrors worker_assignments_dates_valid: an open-ended rental is fine,
-- a rental that ends before it starts is not.

ALTER TABLE assets
    ADD CONSTRAINT assets_rental_dates_valid
    CHECK (
        rental_end_date IS NULL
        OR rental_start_date IS NULL
        OR rental_end_date >= rental_start_date
    );


-- Money is never negative here. NUMERIC(12,2) already caps the
-- magnitude; this closes the other end.

ALTER TABLE assets
    ADD CONSTRAINT assets_costs_non_negative
    CHECK (
        (purchase_cost IS NULL OR purchase_cost >= 0)
        AND (rental_rate IS NULL OR rental_rate >= 0)
    );


-- ============================================================
-- 8. MAINTENANCE DATES
-- ============================================================

-- Held directly on the asset in this phase. There is deliberately no
-- asset_maintenance child table yet, so these two columns are the whole
-- maintenance story: when it was last serviced and when it is next due.

ALTER TABLE assets ADD COLUMN last_maintenance_date DATE;
ALTER TABLE assets ADD COLUMN next_maintenance_date DATE;

ALTER TABLE assets
    ADD CONSTRAINT assets_maintenance_dates_valid
    CHECK (
        next_maintenance_date IS NULL
        OR last_maintenance_date IS NULL
        OR next_maintenance_date >= last_maintenance_date
    );


-- ============================================================
-- 9. INDEXES
-- ============================================================

-- Drives the default tenant-scoped list and the ?status= filter,
-- mirroring idx_suppliers_company_status and idx_workers_company_status.
--
-- A standalone index on (company_id) is deliberately NOT created:
-- assets_company_id_unique (company_id, id) and these indexes all LEAD
-- with company_id, so company-scoped lookups are already served by an
-- index prefix. Migrations 001 and 002 make the same call explicitly.

CREATE INDEX idx_assets_company_status
    ON assets (company_id, status);

CREATE INDEX idx_assets_company_operational_status
    ON assets (company_id, operational_status);


-- Foreign-key indexes. Postgres does not create these automatically and
-- without them every project or supplier delete has to seq-scan assets
-- to check the referencing rows.

CREATE INDEX idx_assets_project_id  ON assets (project_id);
CREATE INDEX idx_assets_supplier_id ON assets (supplier_id);


-- Drives "maintenance due in the next 30 days" reporting, and is the
-- direct counterpart of idx_worker_certs_expiry from migration 001.
-- Partial on the lifecycle column: a written-off asset is not due for
-- service.

CREATE INDEX idx_assets_next_maintenance
    ON assets (company_id, next_maintenance_date)
    WHERE status = 'active';


COMMIT;
