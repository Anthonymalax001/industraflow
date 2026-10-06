-- ============================================================
-- IndustraFlow - Migration 004: Compliance documents hardening
--
-- Brings the existing `compliance_documents` table up to the same
-- tenant-safe standard as workforce, suppliers and assets.
--
-- Structural approach:
--   One table, one strict scope per row:
--     company | project | contractor | asset | supplier
--
-- There is deliberately no worker_id in this phase. Worker-level
-- competency documents remain in worker_certifications.
--
-- Safe to run as written only while compliance_documents is empty. The
-- migration fails loudly before altering anything if rows already exist,
-- because old rows have no company_id and no unambiguous scope_type.
-- ============================================================

BEGIN;


-- ============================================================
-- 0. EMPTY-TABLE GUARD
-- ============================================================

DO $$
DECLARE
    existing_count INTEGER;
BEGIN

    SELECT count(*) INTO existing_count FROM compliance_documents;

    IF existing_count > 0 THEN

        RAISE EXCEPTION
            'Migration 004 aborted: compliance_documents contains % row(s). '
            'Assign company_id and scope by hand before hardening in place.',
            existing_count;

    END IF;

END $$;


-- ============================================================
-- 1. LEGACY PROJECT FK AND COLUMN NAMES
-- ============================================================

ALTER TABLE compliance_documents
    DROP CONSTRAINT compliance_documents_project_id_fkey;

ALTER TABLE compliance_documents
    RENAME COLUMN document_name TO name;

ALTER TABLE compliance_documents
    RENAME COLUMN file_url TO document_url;


-- PostgreSQL 17+ tracks NOT NULL as a named catalog constraint. A column
-- rename does not rename that constraint, so keep the catalog name in
-- step where the server supports it.

DO $$
BEGIN

    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.compliance_documents'::regclass
          AND conname  = 'compliance_documents_document_name_not_null'
    ) THEN

        ALTER TABLE compliance_documents
            RENAME CONSTRAINT compliance_documents_document_name_not_null
            TO compliance_documents_name_not_null;

    END IF;

END $$;


-- ============================================================
-- 2. TENANT ANCHOR
-- ============================================================

ALTER TABLE compliance_documents
    ADD COLUMN company_id INTEGER NOT NULL;

ALTER TABLE compliance_documents
    ADD CONSTRAINT compliance_documents_company_fkey
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE compliance_documents
    ADD CONSTRAINT compliance_documents_company_id_unique
    UNIQUE (company_id, id);


-- ============================================================
-- 3. STRICT SCOPE
-- ============================================================

ALTER TABLE compliance_documents
    ADD COLUMN scope_type VARCHAR(20) NOT NULL;

ALTER TABLE compliance_documents
    ADD COLUMN contractor_id INTEGER;

ALTER TABLE compliance_documents
    ADD COLUMN asset_id INTEGER;

ALTER TABLE compliance_documents
    ADD COLUMN supplier_id INTEGER;


ALTER TABLE compliance_documents
    ADD CONSTRAINT compliance_documents_project_same_company
    FOREIGN KEY (company_id, project_id)
    REFERENCES projects (company_id, id) ON DELETE RESTRICT;

ALTER TABLE compliance_documents
    ADD CONSTRAINT compliance_documents_contractor_same_company
    FOREIGN KEY (company_id, contractor_id)
    REFERENCES contractors (company_id, id) ON DELETE RESTRICT;

ALTER TABLE compliance_documents
    ADD CONSTRAINT compliance_documents_asset_same_company
    FOREIGN KEY (company_id, asset_id)
    REFERENCES assets (company_id, id) ON DELETE RESTRICT;

ALTER TABLE compliance_documents
    ADD CONSTRAINT compliance_documents_supplier_same_company
    FOREIGN KEY (company_id, supplier_id)
    REFERENCES suppliers (company_id, id) ON DELETE RESTRICT;


-- ============================================================
-- 4. DOCUMENT METADATA
-- ============================================================

ALTER TABLE compliance_documents
    ADD COLUMN issuing_authority VARCHAR(255);

ALTER TABLE compliance_documents
    ADD COLUMN reference_number VARCHAR(100);

ALTER TABLE compliance_documents
    ADD COLUMN issued_date DATE;

ALTER TABLE compliance_documents
    ADD COLUMN verification_status VARCHAR(20) NOT NULL DEFAULT 'pending';


ALTER TABLE compliance_documents
    ALTER COLUMN status DROP DEFAULT;

UPDATE compliance_documents
SET status = 'active';

ALTER TABLE compliance_documents
    ALTER COLUMN status TYPE VARCHAR(20);

ALTER TABLE compliance_documents
    ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE compliance_documents
    ALTER COLUMN status SET NOT NULL;


ALTER TABLE compliance_documents
    ALTER COLUMN document_type TYPE VARCHAR(50);

ALTER TABLE compliance_documents
    ALTER COLUMN document_type SET NOT NULL;


-- ============================================================
-- 5. CHECK CONSTRAINTS
-- ============================================================

ALTER TABLE compliance_documents
    ADD CONSTRAINT compliance_documents_scope_type_valid
    CHECK (scope_type IN (
        'company',
        'project',
        'contractor',
        'asset',
        'supplier'
    ));

ALTER TABLE compliance_documents
    ADD CONSTRAINT compliance_documents_scope_xor
    CHECK (
        (
            scope_type = 'company'
            AND project_id IS NULL
            AND contractor_id IS NULL
            AND asset_id IS NULL
            AND supplier_id IS NULL
        )
        OR (
            scope_type = 'project'
            AND project_id IS NOT NULL
            AND contractor_id IS NULL
            AND asset_id IS NULL
            AND supplier_id IS NULL
        )
        OR (
            scope_type = 'contractor'
            AND project_id IS NULL
            AND contractor_id IS NOT NULL
            AND asset_id IS NULL
            AND supplier_id IS NULL
        )
        OR (
            scope_type = 'asset'
            AND project_id IS NULL
            AND contractor_id IS NULL
            AND asset_id IS NOT NULL
            AND supplier_id IS NULL
        )
        OR (
            scope_type = 'supplier'
            AND project_id IS NULL
            AND contractor_id IS NULL
            AND asset_id IS NULL
            AND supplier_id IS NOT NULL
        )
    );

ALTER TABLE compliance_documents
    ADD CONSTRAINT compliance_documents_document_type_valid
    CHECK (document_type IN (
        'safety_certificate',
        'insurance',
        'environmental_permit',
        'operating_licence',
        'inspection_certificate',
        'regulatory_approval',
        'tax_compliance',
        'other'
    ));

ALTER TABLE compliance_documents
    ADD CONSTRAINT compliance_documents_status_valid
    CHECK (status IN ('active', 'inactive'));

ALTER TABLE compliance_documents
    ADD CONSTRAINT compliance_documents_verification_status_valid
    CHECK (verification_status IN ('pending', 'verified', 'rejected'));

ALTER TABLE compliance_documents
    ADD CONSTRAINT compliance_documents_dates_valid
    CHECK (
        expiry_date IS NULL
        OR issued_date IS NULL
        OR expiry_date >= issued_date
    );


-- ============================================================
-- 6. INDEXES
-- ============================================================

CREATE INDEX idx_compliance_docs_company_status
    ON compliance_documents (company_id, status);

CREATE INDEX idx_compliance_docs_company_scope
    ON compliance_documents (company_id, scope_type);

CREATE INDEX idx_compliance_docs_expiry
    ON compliance_documents (company_id, expiry_date)
    WHERE status = 'active';

CREATE INDEX idx_compliance_docs_project_id
    ON compliance_documents (project_id);

CREATE INDEX idx_compliance_docs_contractor_id
    ON compliance_documents (contractor_id);

CREATE INDEX idx_compliance_docs_asset_id
    ON compliance_documents (asset_id);

CREATE INDEX idx_compliance_docs_supplier_id
    ON compliance_documents (supplier_id);


COMMIT;
