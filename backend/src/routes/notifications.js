const express = require("express");
const db = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authMiddleware);

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const NOTIFICATION_SELECT = `
    SELECT
        id,
        type,
        channel,
        subject,
        message,
        status,
        related_model,
        related_id,
        priority,
        metadata,
        event_key,
        created_at,
        updated_at,
        sent_at,
        read_at,
        dismissed_at,
        retry_count,
        last_error
    FROM notifications
`;

const parsePositiveInteger = (value, fallback, fieldName) => {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }

    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 1) {
        const error = new Error(`${fieldName} must be an integer greater than or equal to 1`);
        error.statusCode = 400;
        throw error;
    }

    return parsed;
};

const parsePagination = (req, fallbackLimit = DEFAULT_LIMIT) => {
    const page = parsePositiveInteger(req.query.page, 1, "page");
    const limit = parsePositiveInteger(req.query.limit, fallbackLimit, "limit");

    if (limit > MAX_LIMIT) {
        const error = new Error(`limit must be an integer between 1 and ${MAX_LIMIT}`);
        error.statusCode = 400;
        throw error;
    }

    return {
        page,
        limit,
        offset: (page - 1) * limit,
    };
};

const buildPagination = (page, limit, total) => {
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
        page,
        limit,
        total,
        total_pages: totalPages,
        has_prev: page > 1 && total > 0,
        has_next: page < totalPages,
    };
};

const normalizeNotification = (row) => ({
    id: row.id,
    type: row.type,
    channel: row.channel,
    subject: row.subject,
    message: row.message,
    status: row.status,
    related_model: row.related_model,
    related_id: row.related_id,
    priority: row.priority,
    metadata: row.metadata,
    event_key: row.event_key,
    created_at: row.created_at,
    updated_at: row.updated_at,
    sent_at: row.sent_at,
    read_at: row.read_at,
    dismissed_at: row.dismissed_at,
    retry_count: row.retry_count,
    last_error: row.last_error,
});

const getUserContext = (req) => ({
    company_id: req.user.company_id,
    user_id: req.user.id,
});

const parseNotificationId = (value) => {
    if (Array.isArray(value)) {
        return null;
    }

    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 1) {
        return null;
    }

    return parsed;
};

const findOwnedNotification = async (notificationId, companyId, userId) => {
    const result = await db.query(
        `${NOTIFICATION_SELECT} WHERE id = $1 AND company_id = $2 AND user_id = $3`,
        [notificationId, companyId, userId]
    );

    if (result.rows.length === 0) {
        return null;
    }

    return normalizeNotification(result.rows[0]);
};

router.get("/", async (req, res) => {
    try {
        const { company_id, user_id } = getUserContext(req);
        const { page, limit, offset } = parsePagination(req);

        const totalResult = await db.query(
            `SELECT COUNT(*)::int AS total
             FROM notifications
             WHERE company_id = $1 AND user_id = $2`,
            [company_id, user_id]
        );

        const notificationsResult = await db.query(
            `${NOTIFICATION_SELECT}
             WHERE company_id = $1 AND user_id = $2
             ORDER BY created_at DESC, id DESC
             LIMIT $3 OFFSET $4`,
            [company_id, user_id, limit, offset]
        );

        res.json({
            items: notificationsResult.rows.map(normalizeNotification),
            pagination: buildPagination(page, limit, totalResult.rows[0].total),
        });
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Unable to load notifications" });
    }
});

router.get("/unread", async (req, res) => {
    try {
        const { company_id, user_id } = getUserContext(req);
        const { page, limit, offset } = parsePagination(req);

        const totalResult = await db.query(
            `SELECT COUNT(*)::int AS total
             FROM notifications
             WHERE company_id = $1 AND user_id = $2 AND read_at IS NULL`,
            [company_id, user_id]
        );

        const notificationsResult = await db.query(
            `${NOTIFICATION_SELECT}
             WHERE company_id = $1 AND user_id = $2 AND read_at IS NULL
             ORDER BY created_at DESC, id DESC
             LIMIT $3 OFFSET $4`,
            [company_id, user_id, limit, offset]
        );

        res.json({
            items: notificationsResult.rows.map(normalizeNotification),
            pagination: buildPagination(page, limit, totalResult.rows[0].total),
        });
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Unable to load unread notifications" });
    }
});

router.get("/count", async (req, res) => {
    try {
        const { company_id, user_id } = getUserContext(req);

        const result = await db.query(
            `SELECT COUNT(*)::int AS unread_count
             FROM notifications
             WHERE company_id = $1 AND user_id = $2 AND read_at IS NULL`,
            [company_id, user_id]
        );

        res.json({ unread_count: result.rows[0].unread_count });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to count unread notifications" });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const notificationId = parseNotificationId(req.params.id);

        if (!notificationId) {
            return res.status(404).json({ error: "Notification not found" });
        }

        const { company_id, user_id } = getUserContext(req);
        const notification = await findOwnedNotification(notificationId, company_id, user_id);

        if (!notification) {
            return res.status(404).json({ error: "Notification not found" });
        }

        return res.json(notification);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Unable to load notification" });
    }
});

router.patch("/:id/read", async (req, res) => {
    try {
        const notificationId = parseNotificationId(req.params.id);

        if (!notificationId) {
            return res.status(404).json({ error: "Notification not found" });
        }

        const { company_id, user_id } = getUserContext(req);
        const existing = await findOwnedNotification(notificationId, company_id, user_id);

        if (!existing) {
            return res.status(404).json({ error: "Notification not found" });
        }

        const result = await db.query(
            `UPDATE notifications
             SET read_at = COALESCE(read_at, NOW()),
                 updated_at = NOW()
             WHERE id = $1 AND company_id = $2 AND user_id = $3
             RETURNING ${[
                 "id",
                 "type",
                 "channel",
                 "subject",
                 "message",
                 "status",
                 "related_model",
                 "related_id",
                 "priority",
                 "metadata",
                 "event_key",
                 "created_at",
                 "updated_at",
                 "sent_at",
                 "read_at",
                 "dismissed_at",
                 "retry_count",
                 "last_error",
             ].join(", ")}`,
            [notificationId, company_id, user_id]
        );

        return res.json(normalizeNotification(result.rows[0]));
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Unable to update notification" });
    }
});

router.patch("/:id/dismiss", async (req, res) => {
    try {
        const notificationId = parseNotificationId(req.params.id);

        if (!notificationId) {
            return res.status(404).json({ error: "Notification not found" });
        }

        const { company_id, user_id } = getUserContext(req);
        const existing = await findOwnedNotification(notificationId, company_id, user_id);

        if (!existing) {
            return res.status(404).json({ error: "Notification not found" });
        }

        const result = await db.query(
            `UPDATE notifications
             SET dismissed_at = COALESCE(dismissed_at, NOW()),
                 updated_at = NOW()
             WHERE id = $1 AND company_id = $2 AND user_id = $3
             RETURNING ${[
                 "id",
                 "type",
                 "channel",
                 "subject",
                 "message",
                 "status",
                 "related_model",
                 "related_id",
                 "priority",
                 "metadata",
                 "event_key",
                 "created_at",
                 "updated_at",
                 "sent_at",
                 "read_at",
                 "dismissed_at",
                 "retry_count",
                 "last_error",
             ].join(", ")}`,
            [notificationId, company_id, user_id]
        );

        return res.json(normalizeNotification(result.rows[0]));
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Unable to dismiss notification" });
    }
});

module.exports = router;
