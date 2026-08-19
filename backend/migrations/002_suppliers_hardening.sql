-- ============================================================
-- IndustraFlow — Migration 002: Suppliers hardening
--
-- Brings `suppliers` up to the tenancy standard that migration 001
-- established for the workforce model.
--
--   tenancy   : suppliers.company_id          (NOT NULL, always)
--   lifecycle : suppliers.status              active | inactive
--   vetting   : suppliers.verification_status pending | verified
--                                             | expired | rejected
--
-- The two status columns are deliberately SEPARATE and orthogonal:
--
--   status              answers "is this supplier still on our books?"
--                       and is what DELETE /api/suppliers/:id sets to
--                       'inactive' (soft delete).
--
--   verification_status answers "how far through vetting is it?" and is
--                       never touched by the delete path.
--
-- Overloading one column with both meanings would make a deactivated
-- supplier indistinguishable from a rejected one, so they stay apart.
--
-- Suppliers are COMPANY-level, not project-level: one supplier may
-- eventually serve many projects. No project_id column is added here
-- and no project_suppliers join table is created yet — but the
-- composite-FK target added in step 1 is precisely what will let that
-- be done safely when the need arrives.
--
-- Safe to run as written: suppliers is empty at the time of authoring
-- (SELECT count(*) FROM suppliers = 0), so every constraint below
-- applies without a backfill step.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. TENANT ANCHOR: company_id becomes mandatory
-- ============================================================

-- A supplier with no company belongs to no tenant. It is invisible to
-- every "WHERE company_id = $1" query, which means it can never be
-- read, updated or deleted through the API — an unreachable orphan.
-- Forbid the state outright.
--
-- There is nothing to backfill from: unlike contractors (which could
-- derive their company through project_id in migration 001), a supplier
-- with a NULL company_id has no path to an owner. If such a row exists
-- this statement fails loudly, which is correct — inventing an owner
-- would be worse than stopping.

ALTER TABLE suppliers ALTER COLUMN company_id SET NOT NULL;


-- The foreign key already exists as suppliers_company_id_fkey, so this
-- block is a no-op on the current database and only fires where the
-- constraint is genuinely missing.

DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid  = 'public.suppliers'::regclass
          AND contype   = 'f'
          AND confrelid = 'public.companies'::regclass
    ) THEN

        ALTER TABLE suppliers
            ADD CONSTRAINT suppliers_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

    END IF;

END $$;


-- Composite-FK target, matching projects, contractors and workers.
--
-- Nothing references suppliers today. This exists so that a future
-- project_suppliers / supplier_documents / purchase_orders table can
-- declare
--
--     FOREIGN KEY (company_id, supplier_id)
--         REFERENCES suppliers (company_id, id)
--
-- and inherit cross-tenant safety from the database rather than from
-- application code. Retrofitting this after child tables exist would
-- mean dropping and recreating their foreign keys, so it goes in now
-- while the table is empty.

ALTER TABLE suppliers
    ADD CONSTRAINT suppliers_company_id_unique UNIQUE (company_id, id);


-- ============================================================
-- 2. LIFECYCLE STATUS (drives soft delete)
-- ============================================================

-- NOT NULL with a default, matching worker_assignments.status and
-- worker_certifications.status. A NULL here would satisfy the CHECK
-- below (a CHECK is not violated by NULL) and would quietly become a
-- third, unnamed lifecycle state.

ALTER TABLE suppliers
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active';

ALTER TABLE suppliers
    ADD CONSTRAINT suppliers_status_valid
    CHECK (status IN ('active', 'inactive'));


-- ============================================================
-- 3. VERIFICATION STATUS (vetting — kept separate from lifecycle)
-- ============================================================

-- The column already exists and already defaults to 'pending', but it
-- is nullable and entirely unconstrained today.
--
-- NULL has to be dealt with BEFORE the CHECK is added: a CHECK
-- constraint is satisfied by NULL, so the whitelist would not actually
-- be enforced while the column stayed nullable.

ALTER TABLE suppliers
    ALTER COLUMN verification_status SET DEFAULT 'pending';

UPDATE suppliers
SET verification_status = 'pending'
WHERE verification_status IS NULL;

ALTER TABLE suppliers
    ALTER COLUMN verification_status SET NOT NULL;

ALTER TABLE suppliers
    ADD CONSTRAINT suppliers_verification_status_valid
    CHECK (verification_status IN ('pending', 'verified', 'expired', 'rejected'));


-- ============================================================
-- 4. DUPLICATE SUPPLIERS
-- ============================================================

-- One supplier name per company, compared case-insensitively and with
-- surrounding whitespace ignored, so all of
--
--     'ABC Ltd'   'abc ltd'   '  ABC LTD  '
--
-- collide as the same supplier.
--
-- Deliberately NOT partial on status. A supplier is a master record,
-- so a deactivated supplier keeps its name reserved and the way back
-- is PUT status = 'active', not a second row with the same name. This
-- matches workers_company_employee_number_key, which likewise keeps a
-- terminated worker's employee_number reserved rather than releasing
-- it for reuse.
--
-- (Contrast worker_assignments_active_key, which IS partial — but an
-- assignment is a repeatable event, not a master record.)

CREATE UNIQUE INDEX suppliers_company_name_key
    ON suppliers (company_id, lower(btrim(name)));


-- ============================================================
-- 5. INDEXES
-- ============================================================

-- Drives the default tenant-scoped list and the ?status= filter, and
-- mirrors idx_workers_company_status from migration 001.
--
-- A standalone index on (company_id) is deliberately NOT created:
-- suppliers_company_id_unique (company_id, id) and this index both
-- LEAD with company_id, so company-scoped lookups are already served
-- by an index prefix. Migration 001 makes the same call explicitly —
-- "these also serve as the (company_id, ...) indexes, so no standalone
-- index on company_id is needed".

CREATE INDEX idx_suppliers_company_status
    ON suppliers (company_id, status);


COMMIT;
