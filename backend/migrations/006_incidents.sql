-- ============================================================
-- IndustraFlow - Migration 006: Incident Reporting
--
-- Creates tenant-safe incident records. Reporters are mandatory,
-- assignees and projects are optional, and every relationship is
-- scoped through company_id to prevent cross-tenant links.
-- ============================================================

BEGIN;


CREATE TABLE incidents (
    id                SERIAL PRIMARY KEY,
    company_id        INTEGER NOT NULL,
    project_id        INTEGER,
    reported_by       INTEGER NOT NULL,
    assigned_to       INTEGER,
    title             VARCHAR(255) NOT NULL,
    description       TEXT NOT NULL,
    incident_type     VARCHAR(30) NOT NULL,
    severity          VARCHAR(20) NOT NULL DEFAULT 'medium',
    status            VARCHAR(20) NOT NULL DEFAULT 'open',
    occurred_at       TIMESTAMP NOT NULL,
    resolved_at       TIMESTAMP,
    corrective_action TEXT,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT incidents_incident_type_valid
        CHECK (incident_type IN (
            'accident',
            'near_miss',
            'injury',
            'property_damage',
            'environmental',
            'fire',
            'security',
            'other'
        )),

    CONSTRAINT incidents_severity_valid
        CHECK (severity IN ('low', 'medium', 'high', 'critical')),

    CONSTRAINT incidents_status_valid
        CHECK (status IN (
            'open',
            'investigating',
            'resolved',
            'closed',
            'cancelled'
        )),

    CONSTRAINT incidents_resolved_at_status_valid
        CHECK (
            resolved_at IS NULL
            OR status IN ('resolved', 'closed')
        ),

    CONSTRAINT incidents_resolved_at_after_occurred_at
        CHECK (
            resolved_at IS NULL
            OR resolved_at >= occurred_at
        ),

    CONSTRAINT incidents_project_same_company
        FOREIGN KEY (company_id, project_id)
        REFERENCES projects (company_id, id) ON DELETE RESTRICT,

    CONSTRAINT incidents_reported_by_same_company
        FOREIGN KEY (company_id, reported_by)
        REFERENCES users (company_id, id) ON DELETE RESTRICT,

    CONSTRAINT incidents_assigned_to_same_company
        FOREIGN KEY (company_id, assigned_to)
        REFERENCES users (company_id, id) ON DELETE RESTRICT
);


CREATE INDEX idx_incidents_company_status
    ON incidents (company_id, status);

CREATE INDEX idx_incidents_company_project
    ON incidents (company_id, project_id);

CREATE INDEX idx_incidents_company_severity
    ON incidents (company_id, severity);

CREATE INDEX idx_incidents_occurred_at
    ON incidents (company_id, occurred_at);


COMMIT;
