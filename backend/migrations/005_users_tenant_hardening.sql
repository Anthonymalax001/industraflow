-- ============================================================
-- IndustraFlow - Migration 005: Users tenant hardening
--
-- Prepares users to be referenced by future tenant-safe foreign keys,
-- including Incident Reporting fields such as:
--
--     (company_id, reported_by) -> users (company_id, id)
--     (company_id, assigned_to) -> users (company_id, id)
--
-- This migration does not alter credentials, roles, ids or company
-- assignments. It only makes the existing tenant anchor mandatory and
-- adds the composite unique target needed by child tables.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. TENANT ANCHOR: company_id becomes mandatory
-- ============================================================

-- A user with no company cannot be safely used as a tenant-scoped
-- reporter or assignee. Stop rather than guessing an owner.

DO $$
DECLARE
    null_user_count INTEGER;
BEGIN

    SELECT count(*) INTO null_user_count
    FROM users
    WHERE company_id IS NULL;

    IF null_user_count > 0 THEN

        RAISE EXCEPTION
            'Migration 005 aborted: users contains % row(s) with NULL company_id. '
            'Assign company_id by hand before hardening users.',
            null_user_count;

    END IF;

END $$;


ALTER TABLE users
    ALTER COLUMN company_id SET NOT NULL;


-- ============================================================
-- 2. COMPOSITE FOREIGN-KEY TARGET
-- ============================================================

-- Future incident rows can now reference users through their own
-- company_id, making cross-tenant reporter/assignee links structurally
-- impossible.

ALTER TABLE users
    ADD CONSTRAINT users_company_id_unique
    UNIQUE (company_id, id);


COMMIT;
