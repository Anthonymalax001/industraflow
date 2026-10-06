-- ============================================================
-- IndustraFlow - Migration 007: Work Permits
--
-- Creates tenant-safe work permit records, their worker/asset/document
-- associations, and the immutable lifecycle event history.
-- ============================================================

BEGIN;


CREATE TABLE work_permits (
    id                SERIAL PRIMARY KEY,
    company_id        INTEGER NOT NULL,
    project_id        INTEGER NOT NULL,
    contractor_id     INTEGER,

    permit_number     VARCHAR(50) NOT NULL,
    title             VARCHAR(255) NOT NULL,
    work_area         VARCHAR(255),
    work_description  TEXT NOT NULL,
    hazards           TEXT NOT NULL,
    control_measures  TEXT NOT NULL,
    ppe_requirements  TEXT,

    permit_type       VARCHAR(40) NOT NULL,
    risk_level        VARCHAR(20) NOT NULL DEFAULT 'medium',
    status            VARCHAR(20) NOT NULL DEFAULT 'draft',

    valid_from        TIMESTAMP NOT NULL,
    valid_until       TIMESTAMP NOT NULL,

    created_by        INTEGER NOT NULL,
    reviewed_by       INTEGER,
    approved_by       INTEGER,
    closed_by         INTEGER,
    cancelled_by      INTEGER,

    submitted_at      TIMESTAMP,
    reviewed_at       TIMESTAMP,
    approved_at       TIMESTAMP,
    closed_at         TIMESTAMP,
    cancelled_at      TIMESTAMP,

    review_comments   TEXT,
    rejection_reason  TEXT,
    closure_notes     TEXT,

    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT work_permits_permit_type_valid
        CHECK (permit_type IN (
            'hot_work',
            'confined_space',
            'work_at_height',
            'excavation',
            'electrical_isolation',
            'lifting_operation',
            'line_breaking',
            'general_work',
            'other'
        )),

    CONSTRAINT work_permits_risk_level_valid
        CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),

    CONSTRAINT work_permits_status_valid
        CHECK (status IN (
            'draft',
            'pending_review',
            'approved',
            'active',
            'suspended',
            'closed',
            'expired',
            'rejected',
            'cancelled'
        )),

    CONSTRAINT work_permits_valid_period
        CHECK (valid_until > valid_from),

    CONSTRAINT work_permits_approval_requirements
        CHECK (
            status NOT IN ('approved', 'active', 'suspended', 'closed')
            OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
        ),

    CONSTRAINT work_permits_closure_requirements
        CHECK (
            status <> 'closed'
            OR (closed_by IS NOT NULL AND closed_at IS NOT NULL)
        ),

    CONSTRAINT work_permits_cancellation_requirements
        CHECK (
            status <> 'cancelled'
            OR (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL)
        ),

    CONSTRAINT work_permits_rejection_requirement
        CHECK (
            status <> 'rejected'
            OR NULLIF(btrim(rejection_reason), '') IS NOT NULL
        ),

    CONSTRAINT work_permits_submission_requirement
        CHECK (
            status = 'draft'
            OR submitted_at IS NOT NULL
        ),

    CONSTRAINT work_permits_company_id_unique
        UNIQUE (company_id, id),

    CONSTRAINT work_permits_company_fkey
        FOREIGN KEY (company_id)
        REFERENCES companies (id) ON DELETE CASCADE,

    CONSTRAINT work_permits_project_same_company
        FOREIGN KEY (company_id, project_id)
        REFERENCES projects (company_id, id) ON DELETE RESTRICT,

    CONSTRAINT work_permits_contractor_same_company
        FOREIGN KEY (company_id, contractor_id)
        REFERENCES contractors (company_id, id) ON DELETE RESTRICT,

    CONSTRAINT work_permits_created_by_same_company
        FOREIGN KEY (company_id, created_by)
        REFERENCES users (company_id, id) ON DELETE RESTRICT,

    CONSTRAINT work_permits_reviewed_by_same_company
        FOREIGN KEY (company_id, reviewed_by)
        REFERENCES users (company_id, id) ON DELETE RESTRICT,

    CONSTRAINT work_permits_approved_by_same_company
        FOREIGN KEY (company_id, approved_by)
        REFERENCES users (company_id, id) ON DELETE RESTRICT,

    CONSTRAINT work_permits_closed_by_same_company
        FOREIGN KEY (company_id, closed_by)
        REFERENCES users (company_id, id) ON DELETE RESTRICT,

    CONSTRAINT work_permits_cancelled_by_same_company
        FOREIGN KEY (company_id, cancelled_by)
        REFERENCES users (company_id, id) ON DELETE RESTRICT
);


CREATE TABLE work_permit_workers (
    id          SERIAL PRIMARY KEY,
    company_id  INTEGER NOT NULL,
    permit_id   INTEGER NOT NULL,
    worker_id   INTEGER NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT work_permit_workers_unique
        UNIQUE (company_id, permit_id, worker_id),

    CONSTRAINT work_permit_workers_permit_same_company
        FOREIGN KEY (company_id, permit_id)
        REFERENCES work_permits (company_id, id) ON DELETE RESTRICT,

    CONSTRAINT work_permit_workers_worker_same_company
        FOREIGN KEY (company_id, worker_id)
        REFERENCES workers (company_id, id) ON DELETE RESTRICT
);


CREATE TABLE work_permit_assets (
    id          SERIAL PRIMARY KEY,
    company_id  INTEGER NOT NULL,
    permit_id   INTEGER NOT NULL,
    asset_id    INTEGER NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT work_permit_assets_unique
        UNIQUE (company_id, permit_id, asset_id),

    CONSTRAINT work_permit_assets_permit_same_company
        FOREIGN KEY (company_id, permit_id)
        REFERENCES work_permits (company_id, id) ON DELETE RESTRICT,

    CONSTRAINT work_permit_assets_asset_same_company
        FOREIGN KEY (company_id, asset_id)
        REFERENCES assets (company_id, id) ON DELETE RESTRICT
);


CREATE TABLE work_permit_documents (
    id                     SERIAL PRIMARY KEY,
    company_id             INTEGER NOT NULL,
    permit_id              INTEGER NOT NULL,
    compliance_document_id INTEGER NOT NULL,
    created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT work_permit_documents_unique
        UNIQUE (company_id, permit_id, compliance_document_id),

    CONSTRAINT work_permit_documents_permit_same_company
        FOREIGN KEY (company_id, permit_id)
        REFERENCES work_permits (company_id, id) ON DELETE RESTRICT,

    CONSTRAINT work_permit_documents_document_same_company
        FOREIGN KEY (company_id, compliance_document_id)
        REFERENCES compliance_documents (company_id, id) ON DELETE RESTRICT
);


CREATE TABLE work_permit_events (
    id            SERIAL PRIMARY KEY,
    company_id    INTEGER NOT NULL,
    permit_id     INTEGER NOT NULL,
    event_type    VARCHAR(30) NOT NULL,
    from_status   VARCHAR(20),
    to_status     VARCHAR(20),
    performed_by  INTEGER NOT NULL,
    comments      TEXT,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT work_permit_events_event_type_valid
        CHECK (event_type IN (
            'created',
            'submitted',
            'reviewed',
            'approved',
            'rejected',
            'activated',
            'suspended',
            'resumed',
            'closed',
            'expired',
            'cancelled'
        )),

    CONSTRAINT work_permit_events_status_values_valid
        CHECK (
            (from_status IS NULL OR from_status IN (
                'draft',
                'pending_review',
                'approved',
                'active',
                'suspended',
                'closed',
                'expired',
                'rejected',
                'cancelled'
            ))
            AND (to_status IS NULL OR to_status IN (
                'draft',
                'pending_review',
                'approved',
                'active',
                'suspended',
                'closed',
                'expired',
                'rejected',
                'cancelled'
            ))
        ),

    CONSTRAINT work_permit_events_permit_same_company
        FOREIGN KEY (company_id, permit_id)
        REFERENCES work_permits (company_id, id) ON DELETE RESTRICT,

    CONSTRAINT work_permit_events_performed_by_same_company
        FOREIGN KEY (company_id, performed_by)
        REFERENCES users (company_id, id) ON DELETE RESTRICT
);


CREATE UNIQUE INDEX work_permits_company_permit_number_key
    ON work_permits (company_id, lower(btrim(permit_number)));


CREATE INDEX idx_work_permits_company_project_status
    ON work_permits (company_id, project_id, status);

CREATE INDEX idx_work_permits_company_status
    ON work_permits (company_id, status);

CREATE INDEX idx_work_permits_company_valid_until
    ON work_permits (company_id, valid_until);

CREATE INDEX idx_work_permits_company_contractor_id
    ON work_permits (company_id, contractor_id);


CREATE INDEX idx_work_permit_workers_company_permit
    ON work_permit_workers (company_id, permit_id);

CREATE INDEX idx_work_permit_workers_company_worker
    ON work_permit_workers (company_id, worker_id);

CREATE INDEX idx_work_permit_assets_company_permit
    ON work_permit_assets (company_id, permit_id);

CREATE INDEX idx_work_permit_assets_company_asset
    ON work_permit_assets (company_id, asset_id);

CREATE INDEX idx_work_permit_documents_company_permit
    ON work_permit_documents (company_id, permit_id);

CREATE INDEX idx_work_permit_documents_company_document
    ON work_permit_documents (company_id, compliance_document_id);


CREATE INDEX idx_work_permit_events_company_permit_created
    ON work_permit_events (company_id, permit_id, created_at);

CREATE INDEX idx_work_permit_events_company_performed_by
    ON work_permit_events (company_id, performed_by);


COMMIT;
