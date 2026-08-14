-- ============================================================
-- IndustraFlow — Migration 001: Workforce data model (Option C)
--
-- Supports BOTH contractor workers and direct company employees.
--
--   tenancy    : workers.company_id   (NOT NULL, always)
--   employment : workers.contractor_id (NULL => direct employee)
--   deployment : worker_assignments   (many-to-many, time-bounded)
--
-- Cross-tenant contamination is prevented declaratively by composite
-- foreign keys, not by application code.
--
-- Personnel records are protected: ON DELETE RESTRICT, never CASCADE.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. CONTRACTORS: add the tenant anchor needed for composite FKs
-- ============================================================

ALTER TABLE contractors ADD COLUMN company_id INTEGER;

-- Backfill from the parent project (the existing source of truth).
UPDATE contractors c
SET company_id = p.company_id
FROM projects p
WHERE p.id = c.project_id;

ALTER TABLE contractors ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE contractors
    ADD CONSTRAINT contractors_company_fkey
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

-- Composite-FK targets. These also serve as the (company_id, ...) indexes,
-- so no standalone index on company_id is needed.
ALTER TABLE projects
    ADD CONSTRAINT projects_company_id_unique UNIQUE (company_id, id);

ALTER TABLE contractors
    ADD CONSTRAINT contractors_company_id_unique UNIQUE (company_id, id);

-- A contractor's project must belong to the same company.
ALTER TABLE contractors DROP CONSTRAINT contractors_project_id_fkey;

ALTER TABLE contractors
    ADD CONSTRAINT contractors_project_same_company
    FOREIGN KEY (company_id, project_id)
    REFERENCES projects (company_id, id) ON DELETE CASCADE;


-- ============================================================
-- 2. WORKERS: tenant anchor + explicit employer XOR
-- ============================================================

ALTER TABLE workers ADD COLUMN company_id INTEGER;

-- Backfill existing contractor workers through contractor -> project.
UPDATE workers w
SET company_id = p.company_id
FROM contractors c
JOIN projects p ON p.id = c.project_id
WHERE c.id = w.contractor_id;

ALTER TABLE workers ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE workers
    ADD CONSTRAINT workers_company_fkey
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE workers
    ADD CONSTRAINT workers_company_id_unique UNIQUE (company_id, id);

-- Employment discriminator: explicit VARCHAR + CHECK (direct / contractor).
ALTER TABLE workers
    ADD COLUMN employment_type VARCHAR(20) NOT NULL DEFAULT 'direct';

UPDATE workers SET employment_type = 'contractor' WHERE contractor_id IS NOT NULL;

ALTER TABLE workers
    ADD CONSTRAINT workers_employment_type_valid
    CHECK (employment_type IN ('direct', 'contractor'));

-- Exactly one employer: never both, never neither.
ALTER TABLE workers
    ADD CONSTRAINT workers_employer_xor CHECK (
        (employment_type = 'contractor' AND contractor_id IS NOT NULL)
     OR (employment_type = 'direct'     AND contractor_id IS NULL)
    );

-- Personnel are NOT collateral damage of a contractor delete.
ALTER TABLE workers DROP CONSTRAINT workers_contractor_id_fkey;

ALTER TABLE workers
    ADD CONSTRAINT workers_contractor_same_company
    FOREIGN KEY (company_id, contractor_id)
    REFERENCES contractors (company_id, id) ON DELETE RESTRICT;

ALTER TABLE workers
    ADD CONSTRAINT workers_status_valid
    CHECK (status IN ('active', 'inactive', 'suspended', 'terminated'));

-- Stable human identity, unique per tenant (needed later for attendance).
ALTER TABLE workers ADD COLUMN employee_number VARCHAR(50);

CREATE UNIQUE INDEX workers_company_employee_number_key
    ON workers (company_id, employee_number)
    WHERE employee_number IS NOT NULL;


-- ============================================================
-- 3. WORKER ASSIGNMENTS (deployment: many-to-many, time-bounded)
-- ============================================================

CREATE TABLE worker_assignments (
    id          SERIAL PRIMARY KEY,
    company_id  INTEGER NOT NULL,
    worker_id   INTEGER NOT NULL,
    project_id  INTEGER NOT NULL,
    role        VARCHAR(100),
    start_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date    DATE,
    status      VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT worker_assignments_status_valid
        CHECK (status IN ('active', 'completed', 'cancelled')),

    CONSTRAINT worker_assignments_dates_valid
        CHECK (end_date IS NULL OR end_date >= start_date),

    -- Worker and project must both belong to the assignment's company.
    CONSTRAINT worker_assignments_worker_fkey
        FOREIGN KEY (company_id, worker_id)
        REFERENCES workers (company_id, id) ON DELETE CASCADE,

    -- Deployment history survives project cleanup.
    CONSTRAINT worker_assignments_project_fkey
        FOREIGN KEY (company_id, project_id)
        REFERENCES projects (company_id, id) ON DELETE RESTRICT
);

-- A worker cannot hold two concurrent active assignments on one project.
CREATE UNIQUE INDEX worker_assignments_active_key
    ON worker_assignments (worker_id, project_id)
    WHERE status = 'active';


-- ============================================================
-- 4. WORKER CERTIFICATIONS (structured; replaces free-text column)
-- ============================================================

CREATE TABLE worker_certifications (
    id                 SERIAL PRIMARY KEY,
    company_id         INTEGER NOT NULL,
    worker_id          INTEGER NOT NULL,
    name               VARCHAR(255) NOT NULL,
    issuer             VARCHAR(255),
    certificate_number VARCHAR(100),
    issued_date        DATE,
    expiry_date        DATE,
    document_url       TEXT,
    status             VARCHAR(20) NOT NULL DEFAULT 'valid',
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT worker_certifications_status_valid
        CHECK (status IN ('valid', 'expired', 'revoked', 'pending')),

    CONSTRAINT worker_certifications_dates_valid
        CHECK (expiry_date IS NULL OR issued_date IS NULL
               OR expiry_date >= issued_date),

    CONSTRAINT worker_certifications_worker_fkey
        FOREIGN KEY (company_id, worker_id)
        REFERENCES workers (company_id, id) ON DELETE CASCADE
);


-- ============================================================
-- 5. MISSING FOREIGN-KEY INDEXES
-- ============================================================

CREATE INDEX idx_contractors_project_id        ON contractors (project_id);
CREATE INDEX idx_workers_contractor_id         ON workers (contractor_id);
CREATE INDEX idx_workers_company_status        ON workers (company_id, status);
CREATE INDEX idx_worker_assignments_worker_id  ON worker_assignments (worker_id);
CREATE INDEX idx_worker_assignments_project_id ON worker_assignments (project_id);
CREATE INDEX idx_worker_certs_worker_id        ON worker_certifications (worker_id);

-- Drives "certifications expiring in the next 30 days" reporting.
CREATE INDEX idx_worker_certs_expiry
    ON worker_certifications (company_id, expiry_date)
    WHERE status = 'valid';

COMMIT;
