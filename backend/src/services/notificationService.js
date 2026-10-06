const db = require("../db");

const NOTIFICATION_COLUMNS = `
    id,
    company_id,
    user_id,
    type,
    channel,
    subject,
    message,
    status,
    priority,
    related_model,
    related_id,
    metadata,
    event_key,
    created_at,
    updated_at,
    sent_at,
    read_at,
    dismissed_at,
    retry_count,
    last_error`;

const createNotification = async ({
    company_id,
    user_id,
    type,
    channel,
    subject = null,
    message,
    status = "queued",
    priority = 1,
    related_model = null,
    related_id = null,
    metadata = null,
    event_key = null,
}) => {
    try {
        const result = await db.query(
            `INSERT INTO notifications (
                company_id,
                user_id,
                type,
                channel,
                subject,
                message,
                status,
                priority,
                related_model,
                related_id,
                metadata,
                event_key
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (company_id, event_key) WHERE event_key IS NOT NULL
            DO NOTHING
            RETURNING ${NOTIFICATION_COLUMNS}`,
            [
                company_id,
                user_id,
                type,
                channel,
                subject,
                message,
                status,
                priority,
                related_model,
                related_id,
                metadata,
                event_key,
            ]
        );

        if (result.rows.length > 0) {
            return result.rows[0];
        }

        const existing = await db.query(
            `SELECT ${NOTIFICATION_COLUMNS}
             FROM notifications
             WHERE company_id = $1 AND event_key = $2`,
            [company_id, event_key]
        );

        return existing.rows[0] || null;
    } catch (error) {
        throw new Error("Unable to create notification");
    }
};

module.exports = { createNotification };