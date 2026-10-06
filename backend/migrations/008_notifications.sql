-- ============================================================
-- IndustraFlow - Migration 008: Notifications
--
-- Creates the tenant-scoped notifications table for internal company
-- users only. Notifications are designed for in-app and email delivery
-- while keeping a clear audit trail for retries and delivery state.
-- ============================================================

BEGIN;

CREATE TABLE notifications (
    id               SERIAL PRIMARY KEY,
    company_id       INTEGER NOT NULL,
    user_id          INTEGER NOT NULL,
    type             VARCHAR(50) NOT NULL,
    channel          VARCHAR(20) NOT NULL,
    subject          VARCHAR(255),
    message          TEXT NOT NULL,
    status           VARCHAR(20) NOT NULL DEFAULT 'queued',
    related_model    VARCHAR(50),
    related_id       INTEGER,
    priority         SMALLINT NOT NULL DEFAULT 1,
    metadata         JSONB,
    event_key        VARCHAR(255),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at          TIMESTAMPTZ,
    read_at          TIMESTAMPTZ,
    dismissed_at     TIMESTAMPTZ,
    retry_count      INTEGER NOT NULL DEFAULT 0,
    last_error       TEXT,

    CONSTRAINT notifications_status_valid
        CHECK (status IN (
            'queued',
            'sending',
            'sent',
            'failed',
            'retrying',
            'canceled'
        )),

    CONSTRAINT notifications_channel_valid
        CHECK (channel IN ('in_app', 'email')),

    CONSTRAINT notifications_priority_valid
        CHECK (priority BETWEEN 1 AND 5),

    CONSTRAINT notifications_company_fkey
        FOREIGN KEY (company_id)
        REFERENCES companies (id) ON DELETE CASCADE,

    CONSTRAINT notifications_user_same_company
        FOREIGN KEY (company_id, user_id)
        REFERENCES users (company_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_notifications_company_user_created
    ON notifications (company_id, user_id, created_at DESC);

CREATE INDEX idx_notifications_company_user_unread
    ON notifications (company_id, user_id, read_at, created_at DESC)
    WHERE read_at IS NULL;

CREATE INDEX idx_notifications_company_type_created
    ON notifications (company_id, type, created_at DESC);

CREATE INDEX idx_notifications_company_related
    ON notifications (company_id, related_model, related_id);

CREATE INDEX idx_notifications_status_retry_created
    ON notifications (status, retry_count, created_at DESC);

CREATE INDEX idx_notifications_event_key
    ON notifications (company_id, event_key)
    WHERE event_key IS NOT NULL;

CREATE UNIQUE INDEX notifications_company_event_key_unique
    ON notifications (company_id, event_key)
    WHERE event_key IS NOT NULL;

COMMIT;
