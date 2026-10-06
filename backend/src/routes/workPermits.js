const express = require("express");
const db = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { createNotification } = require("../services/notificationService");

const router = express.Router();

router.use(authMiddleware);

const ALLOWED_PERMIT_TYPES = [
    "hot_work",
    "confined_space",
    "work_at_height",
    "excavation",
    "electrical_isolation",
    "lifting_operation",
    "line_breaking",
    "general_work",
    "other"
];

const ALLOWED_RISK_LEVELS = [
    "low",
    "medium",
    "high",
    "critical"
];

const ALLOWED_STATUSES = [
    "draft",
    "pending_review",
    "approved",
    "active",
    "suspended",
    "closed",
    "expired",
    "rejected",
    "cancelled"
];

const SETTABLE_FIELDS = [
    "project_id",
    "contractor_id",
    "permit_number",
    "title",
    "work_area",
    "work_description",
    "hazards",
    "control_measures",
    "ppe_requirements",
    "permit_type",
    "risk_level",
    "valid_from",
    "valid_until"
];

const TERMINAL_STATUSES = new Set(["closed", "cancelled", "expired"]);

const VALID_TRANSITIONS = {
    draft: ["pending_review"],
    pending_review: ["approved", "rejected"],
    approved: ["active", "cancelled"],
    active: ["suspended", "closed", "cancelled"],
    suspended: ["active", "cancelled"],
    closed: [],
    expired: [],
    rejected: [],
    cancelled: []
};

const parseId = (value) => {
    if (Array.isArray(value)) {
        return null;
    }

    const id = Number(value);

    if (!Number.isInteger(id) || id < 1) {
        return null;
    }

    return id;
};

const getBody = (req) => {
    const body = req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return {};
    }

    return body;
};

const normalizeString = (value) => {
    if (typeof value !== "string") {
        return "";
    }

    return value.trim();
};

const parseDate = (value, fieldLabel) => {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new Error(`${fieldLabel} is not a valid date`);
    }

    return date;
};

const ensureProjectBelongsToCompany = async (projectId, companyId, client = db) => {
    const result = await client.query(
        `
        SELECT id, company_id, name, status
        FROM projects
        WHERE id = $1 AND company_id = $2
        `,
        [projectId, companyId]
    );

    if (result.rows.length === 0) {
        return null;
    }

    return result.rows[0];
};

const ensureContractorBelongsToProject = async (contractorId, projectId, companyId, client = db) => {
    if (contractorId === null || contractorId === undefined) {
        return null;
    }

    const result = await client.query(
        `
        SELECT id, company_id, project_id, company_name
        FROM contractors
        WHERE id = $1 AND company_id = $2 AND project_id = $3
        `,
        [contractorId, companyId, projectId]
    );

    if (result.rows.length === 0) {
        return null;
    }

    return result.rows[0];
};

const ensureWorkerBelongsToProject = async (workerId, projectId, companyId, client = db) => {
    const result = await client.query(
        `
        SELECT w.id, w.company_id, w.name, wa.project_id, wa.status AS assignment_status
        FROM workers w
        JOIN worker_assignments wa
          ON wa.worker_id = w.id
         AND wa.company_id = w.company_id
        WHERE w.id = $1
          AND w.company_id = $2
          AND wa.project_id = $3
          AND wa.status = 'active'
        `,
        [workerId, companyId, projectId]
    );

    if (result.rows.length === 0) {
        return null;
    }

    return result.rows[0];
};

const ensureAssetBelongsToProject = async (assetId, projectId, companyId, client = db) => {
    const result = await client.query(
        `
        SELECT id, company_id, project_id, status, operational_status
        FROM assets
        WHERE id = $1 AND company_id = $2 AND project_id = $3
        `,
        [assetId, companyId, projectId]
    );

    if (result.rows.length === 0) {
        return null;
    }

    return result.rows[0];
};

const ensureComplianceDocumentBelongsToCompany = async (documentId, companyId, client = db) => {
    const result = await client.query(
        `
        SELECT id, company_id, status, verification_status, expiry_date
        FROM compliance_documents
        WHERE id = $1 AND company_id = $2
        `,
        [documentId, companyId]
    );

    if (result.rows.length === 0) {
        return null;
    }

    return result.rows[0];
};

const makePermitSelect = () => `
    SELECT
        wp.id,
        wp.company_id,
        wp.project_id,
        p.name AS project_name,
        wp.contractor_id,
        c.company_name AS contractor_name,
        wp.permit_number,
        wp.title,
        wp.work_area,
        wp.work_description,
        wp.hazards,
        wp.control_measures,
        wp.ppe_requirements,
        wp.permit_type,
        wp.risk_level,
        wp.status,
        wp.valid_from,
        wp.valid_until,
        wp.created_by,
        creator.name AS created_by_name,
        wp.reviewed_by,
        reviewer.name AS reviewed_by_name,
        wp.approved_by,
        approver.name AS approved_by_name,
        wp.closed_by,
        closer.name AS closed_by_name,
        wp.cancelled_by,
        canceller.name AS cancelled_by_name,
        wp.submitted_at,
        wp.reviewed_at,
        wp.approved_at,
        wp.closed_at,
        wp.cancelled_at,
        wp.review_comments,
        wp.rejection_reason,
        wp.closure_notes,
        wp.created_at
    FROM work_permits wp
    LEFT JOIN projects p
      ON p.id = wp.project_id
     AND p.company_id = wp.company_id
    LEFT JOIN contractors c
      ON c.id = wp.contractor_id
     AND c.company_id = wp.company_id
    LEFT JOIN users creator
      ON creator.id = wp.created_by
     AND creator.company_id = wp.company_id
    LEFT JOIN users reviewer
      ON reviewer.id = wp.reviewed_by
     AND reviewer.company_id = wp.company_id
    LEFT JOIN users approver
      ON approver.id = wp.approved_by
     AND approver.company_id = wp.company_id
    LEFT JOIN users closer
      ON closer.id = wp.closed_by
     AND closer.company_id = wp.company_id
    LEFT JOIN users canceller
      ON canceller.id = wp.cancelled_by
     AND canceller.company_id = wp.company_id
`;

const getPermitById = async (permitId, companyId, client = db) => {
    const result = await client.query(
        `${makePermitSelect()} WHERE wp.id = $1 AND wp.company_id = $2`,
        [permitId, companyId]
    );

    if (result.rows.length === 0) {
        return null;
    }

    return result.rows[0];
};

const addPermitEvent = async (client, {
    companyId,
    permitId,
    eventType,
    fromStatus,
    toStatus,
    performedBy,
    comments
}) => {
    await client.query(
        `
        INSERT INTO work_permit_events (
            company_id,
            permit_id,
            event_type,
            from_status,
            to_status,
            performed_by,
            comments
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [companyId, permitId, eventType, fromStatus, toStatus, performedBy, comments || null]
    );
};

const safelyNotifyPermitUsers = async ({
    companyId,
    permitId,
    userIds,
    type,
    subject,
    message,
}) => {
    const recipients = [...new Set(userIds.filter((userId) => userId !== null && userId !== undefined))];

    try {
        await Promise.all(recipients.map((userId) => createNotification({
            company_id: companyId,
            user_id: userId,
            type,
            channel: "in_app",
            subject,
            message,
            related_model: "work_permit",
            related_id: permitId,
            event_key: `${type}:${permitId}:${userId}`,
            metadata: { permit_id: permitId },
        })));
    } catch (error) {
        console.error("Unable to create work permit notification");
    }
};

const runInTransaction = async (callback) => {
    const client = await db.connect();

    try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error(rollbackError);
        }
        throw error;
    } finally {
        client.release();
    }
};

const buildPermitConflictError = (code, constraint, fieldName) => {
    if (code === "23505") {
        if (constraint === "work_permits_company_permit_number_key") {
            return { status: 409, error: "A permit with this number already exists for this company" };
        }

        return { status: 409, error: `${fieldName || "Permit"} conflicts with an existing record` };
    }

    if (code === "23503") {
        return { status: 400, error: "Referenced record not found or not valid for this company" };
    }

    if (code === "23514") {
        return { status: 400, error: "Permit violates a required validation rule" };
    }

    if (["22007", "22008", "22P02"].includes(code)) {
        return { status: 400, error: "Invalid field value in request body" };
    }

    return null;
};

const handleRouteError = (res, error, fallbackMessage) => {
    console.error(error);

    const mapped = buildPermitConflictError(error.code, error.constraint, "permit");
    if (mapped) {
        return res.status(mapped.status).json({ error: mapped.error });
    }

    return res.status(500).json({ error: fallbackMessage });
};

router.post("/", async (req, res) => {
    const body = getBody(req);

    try {
        const permitId = null;
        const projectId = parseId(body.project_id);
        const contractorId = body.contractor_id === null || body.contractor_id === undefined || body.contractor_id === ""
            ? null
            : parseId(body.contractor_id);

        if (!projectId) {
            return res.status(400).json({ error: "Project ID is required" });
        }

        if (!body.permit_number || typeof body.permit_number !== "string" || normalizeString(body.permit_number) === "") {
            return res.status(400).json({ error: "Permit number is required" });
        }

        if (!body.title || typeof body.title !== "string" || normalizeString(body.title) === "") {
            return res.status(400).json({ error: "Permit title is required" });
        }

        if (!body.work_description || typeof body.work_description !== "string" || normalizeString(body.work_description) === "") {
            return res.status(400).json({ error: "Work description is required" });
        }

        if (!body.hazards || typeof body.hazards !== "string" || normalizeString(body.hazards) === "") {
            return res.status(400).json({ error: "Hazards are required" });
        }

        if (!body.control_measures || typeof body.control_measures !== "string" || normalizeString(body.control_measures) === "") {
            return res.status(400).json({ error: "Control measures are required" });
        }

        if (!body.permit_type || !ALLOWED_PERMIT_TYPES.includes(body.permit_type)) {
            return res.status(400).json({ error: `Permit type must be one of: ${ALLOWED_PERMIT_TYPES.join(", ")}` });
        }

        if (!body.risk_level || !ALLOWED_RISK_LEVELS.includes(body.risk_level)) {
            return res.status(400).json({ error: `Risk level must be one of: ${ALLOWED_RISK_LEVELS.join(", ")}` });
        }

        if (!body.valid_from || !body.valid_until) {
            return res.status(400).json({ error: "valid_from and valid_until are required" });
        }

        const validFrom = parseDate(body.valid_from, "valid_from");
        const validUntil = parseDate(body.valid_until, "valid_until");

        if (!validFrom || !validUntil) {
            return res.status(400).json({ error: "valid_from and valid_until must be valid timestamps" });
        }

        if (validUntil <= validFrom) {
            return res.status(400).json({ error: "valid_until must be later than valid_from" });
        }

        const companyId = req.user.company_id;
        const project = await ensureProjectBelongsToCompany(projectId, companyId);

        if (!project) {
            return res.status(404).json({ error: "Project not found" });
        }

        if (contractorId !== null) {
            const contractor = await ensureContractorBelongsToProject(contractorId, projectId, companyId);
            if (!contractor) {
                return res.status(404).json({ error: "Contractor not found for this project and company" });
            }
        }

        const permitNumber = normalizeString(body.permit_number);
        const existingPermit = await db.query(
            `
            SELECT id
            FROM work_permits
            WHERE company_id = $1
              AND lower(btrim(permit_number)) = lower(btrim($2))
            `,
            [companyId, permitNumber]
        );

        if (existingPermit.rows.length > 0) {
            return res.status(409).json({ error: "A permit with this number already exists for this company" });
        }

        const result = await runInTransaction(async (client) => {
            const rows = await client.query(
                `
                INSERT INTO work_permits (
                    company_id,
                    project_id,
                    contractor_id,
                    permit_number,
                    title,
                    work_area,
                    work_description,
                    hazards,
                    control_measures,
                    ppe_requirements,
                    permit_type,
                    risk_level,
                    status,
                    valid_from,
                    valid_until,
                    created_by,
                    submitted_at,
                    reviewed_at,
                    approved_at,
                    closed_at,
                    cancelled_at,
                    review_comments,
                    rejection_reason,
                    closure_notes
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, 'draft', $13, $14, $15,
                    NULL, NULL, NULL, NULL, NULL,
                    NULL, NULL, NULL
                )
                RETURNING *
                `,
                [
                    companyId,
                    projectId,
                    contractorId,
                    permitNumber,
                    normalizeString(body.title),
                    normalizeString(body.work_area || "") || null,
                    normalizeString(body.work_description),
                    normalizeString(body.hazards),
                    normalizeString(body.control_measures),
                    normalizeString(body.ppe_requirements || "") || null,
                    body.permit_type,
                    body.risk_level,
                    validFrom,
                    validUntil,
                    req.user.id
                ]
            );

            const createdPermit = rows.rows[0];

            await addPermitEvent(client, {
                companyId,
                permitId: createdPermit.id,
                eventType: "created",
                fromStatus: null,
                toStatus: "draft",
                performedBy: req.user.id,
                comments: "Permit created"
            });

            return createdPermit;
        });

        const permit = await getPermitById(result.id, companyId);
        return res.status(201).json({
            message: "Permit created successfully",
            permit
        });
    } catch (error) {
        return handleRouteError(res, error, "Failed to create permit");
    }
});

router.get("/", async (req, res) => {
    try {
        const companyId = req.user.company_id;
        const { project_id, status, permit_type, risk_level, contractor_id, limit, page } = req.query;

        const filters = ["wp.company_id = $1"];
        const values = [companyId];
        let paramIndex = 2;

        if (project_id) {
            const pid = parseId(project_id);
            if (!pid) {
                return res.status(400).json({ error: "Invalid project_id" });
            }
            filters.push(`wp.project_id = $${paramIndex}`);
            values.push(pid);
            paramIndex += 1;
        }

        if (status) {
            if (!ALLOWED_STATUSES.includes(status)) {
                return res.status(400).json({ error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}` });
            }
            filters.push(`wp.status = $${paramIndex}`);
            values.push(status);
            paramIndex += 1;
        }

        if (permit_type) {
            if (!ALLOWED_PERMIT_TYPES.includes(permit_type)) {
                return res.status(400).json({ error: `Permit type must be one of: ${ALLOWED_PERMIT_TYPES.join(", ")}` });
            }
            filters.push(`wp.permit_type = $${paramIndex}`);
            values.push(permit_type);
            paramIndex += 1;
        }

        if (risk_level) {
            if (!ALLOWED_RISK_LEVELS.includes(risk_level)) {
                return res.status(400).json({ error: `Risk level must be one of: ${ALLOWED_RISK_LEVELS.join(", ")}` });
            }
            filters.push(`wp.risk_level = $${paramIndex}`);
            values.push(risk_level);
            paramIndex += 1;
        }

        if (contractor_id) {
            const cid = parseId(contractor_id);
            if (!cid) {
                return res.status(400).json({ error: "Invalid contractor_id" });
            }
            filters.push(`wp.contractor_id = $${paramIndex}`);
            values.push(cid);
            paramIndex += 1;
        }

        const pageSize = Math.min(Math.max(Number(limit) || 25, 1), 100);
        const offset = ((Math.max(Number(page) || 1, 1) - 1) * pageSize);

        const query = `
            SELECT
                wp.id,
                wp.permit_number,
                wp.title,
                wp.project_id,
                wp.contractor_id,
                wp.permit_type,
                wp.risk_level,
                wp.status,
                wp.valid_from,
                wp.valid_until,
                wp.created_by,
                wp.approved_by,
                wp.created_at
            FROM work_permits wp
            WHERE ${filters.join(" AND ")}
            ORDER BY wp.created_at DESC, wp.id DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        const result = await db.query(query, [...values, pageSize, offset]);

        const countResult = await db.query(
            `
            SELECT COUNT(*)::int AS total
            FROM work_permits wp
            WHERE ${filters.join(" AND ")}
            `,
            values
        );

        return res.json({
            count: result.rowCount,
            total: countResult.rows[0].total,
            page: Number(page) || 1,
            limit: pageSize,
            permits: result.rows
        });
    } catch (error) {
        return handleRouteError(res, error, "Failed to fetch permits");
    }
});

router.get("/:id", async (req, res) => {
    try {
        const permitId = parseId(req.params.id);

        if (!permitId) {
            return res.status(400).json({ error: "Invalid permit ID" });
        }

        const permit = await getPermitById(permitId, req.user.company_id);

        if (!permit) {
            return res.status(404).json({ error: "Permit not found" });
        }

        const workersResult = await db.query(
            `
            SELECT
                wpw.id,
                wpw.worker_id,
                w.name,
                w.position,
                w.employee_number,
                w.status AS worker_status
            FROM work_permit_workers wpw
            JOIN workers w
              ON w.id = wpw.worker_id
             AND w.company_id = wpw.company_id
            WHERE wpw.company_id = $1 AND wpw.permit_id = $2
            ORDER BY w.name ASC
            `,
            [req.user.company_id, permitId]
        );

        const assetsResult = await db.query(
            `
            SELECT
                wpa.id,
                wpa.asset_id,
                a.name,
                a.asset_type,
                a.status AS asset_status,
                a.operational_status
            FROM work_permit_assets wpa
            JOIN assets a
              ON a.id = wpa.asset_id
             AND a.company_id = wpa.company_id
            WHERE wpa.company_id = $1 AND wpa.permit_id = $2
            ORDER BY a.name ASC
            `,
            [req.user.company_id, permitId]
        );

        const documentsResult = await db.query(
            `
            SELECT
                wpd.id,
                wpd.compliance_document_id,
                cd.name,
                cd.document_type,
                cd.status AS document_status,
                cd.verification_status,
                cd.expiry_date
            FROM work_permit_documents wpd
            JOIN compliance_documents cd
              ON cd.id = wpd.compliance_document_id
             AND cd.company_id = wpd.company_id
            WHERE wpd.company_id = $1 AND wpd.permit_id = $2
            ORDER BY cd.name ASC
            `,
            [req.user.company_id, permitId]
        );

        const eventsResult = await db.query(
            `
            SELECT
                id,
                permit_id,
                event_type,
                from_status,
                to_status,
                performed_by,
                comments,
                created_at
            FROM work_permit_events
            WHERE company_id = $1 AND permit_id = $2
            ORDER BY created_at ASC, id ASC
            `,
            [req.user.company_id, permitId]
        );

        return res.json({
            permit,
            workers: workersResult.rows,
            assets: assetsResult.rows,
            documents: documentsResult.rows,
            events: eventsResult.rows
        });
    } catch (error) {
        return handleRouteError(res, error, "Failed to fetch permit");
    }
});

router.put("/:id", async (req, res) => {
    const body = getBody(req);

    try {
        const permitId = parseId(req.params.id);
        if (!permitId) {
            return res.status(400).json({ error: "Invalid permit ID" });
        }

        const existingPermit = await getPermitById(permitId, req.user.company_id);
        if (!existingPermit) {
            return res.status(404).json({ error: "Permit not found" });
        }

        if (TERMINAL_STATUSES.has(existingPermit.status)) {
            return res.status(400).json({ error: "This permit is in a terminal state and cannot be edited" });
        }

        const payload = {};

        for (const field of SETTABLE_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(body, field)) {
                payload[field] = body[field];
            }
        }

        if (Object.keys(payload).length === 0) {
            return res.status(400).json({ error: "No valid fields provided for update" });
        }

        if (payload.project_id !== undefined) {
            const projectId = parseId(payload.project_id);
            if (!projectId) {
                return res.status(400).json({ error: "Invalid project_id" });
            }
            const project = await ensureProjectBelongsToCompany(projectId, req.user.company_id);
            if (!project) {
                return res.status(404).json({ error: "Project not found" });
            }
            payload.project_id = projectId;
        }

        if (payload.contractor_id !== undefined && payload.contractor_id !== null && payload.contractor_id !== "") {
            const contractorId = parseId(payload.contractor_id);
            if (!contractorId) {
                return res.status(400).json({ error: "Invalid contractor_id" });
            }

            if (!payload.project_id) {
                payload.project_id = existingPermit.project_id;
            }

            const contractor = await ensureContractorBelongsToProject(contractorId, payload.project_id, req.user.company_id);
            if (!contractor) {
                return res.status(404).json({ error: "Contractor not found for this project and company" });
            }
            payload.contractor_id = contractorId;
        } else if (payload.contractor_id === null || payload.contractor_id === "") {
            payload.contractor_id = null;
        }

        if (payload.permit_number !== undefined) {
            const nextPermitNumber = normalizeString(payload.permit_number);
            if (nextPermitNumber === "") {
                return res.status(400).json({ error: "Permit number is required" });
            }
            payload.permit_number = nextPermitNumber;

            const duplicate = await db.query(
                `
                SELECT id
                FROM work_permits
                WHERE company_id = $1
                  AND id != $2
                  AND lower(btrim(permit_number)) = lower(btrim($3))
                `,
                [req.user.company_id, permitId, nextPermitNumber]
            );

            if (duplicate.rows.length > 0) {
                return res.status(409).json({ error: "A permit with this number already exists for this company" });
            }
        }

        if (payload.title !== undefined) {
            const title = normalizeString(payload.title);
            if (title === "") {
                return res.status(400).json({ error: "Title is required" });
            }
            payload.title = title;
        }

        if (payload.work_description !== undefined) {
            const workDescription = normalizeString(payload.work_description);
            if (workDescription === "") {
                return res.status(400).json({ error: "Work description is required" });
            }
            payload.work_description = workDescription;
        }

        if (payload.hazards !== undefined) {
            const hazards = normalizeString(payload.hazards);
            if (hazards === "") {
                return res.status(400).json({ error: "Hazards are required" });
            }
            payload.hazards = hazards;
        }

        if (payload.control_measures !== undefined) {
            const measures = normalizeString(payload.control_measures);
            if (measures === "") {
                return res.status(400).json({ error: "Control measures are required" });
            }
            payload.control_measures = measures;
        }

        if (payload.permit_type !== undefined && !ALLOWED_PERMIT_TYPES.includes(payload.permit_type)) {
            return res.status(400).json({ error: `Permit type must be one of: ${ALLOWED_PERMIT_TYPES.join(", ")}` });
        }

        if (payload.risk_level !== undefined && !ALLOWED_RISK_LEVELS.includes(payload.risk_level)) {
            return res.status(400).json({ error: `Risk level must be one of: ${ALLOWED_RISK_LEVELS.join(", ")}` });
        }

        if (payload.valid_from !== undefined) {
            const validFrom = parseDate(payload.valid_from, "valid_from");
            if (!validFrom) {
                return res.status(400).json({ error: "valid_from must be a valid timestamp" });
            }
            payload.valid_from = validFrom;
        }

        if (payload.valid_until !== undefined) {
            const validUntil = parseDate(payload.valid_until, "valid_until");
            if (!validUntil) {
                return res.status(400).json({ error: "valid_until must be a valid timestamp" });
            }
            payload.valid_until = validUntil;
        }

        const finalValidFrom = payload.valid_from !== undefined ? payload.valid_from : existingPermit.valid_from;
        const finalValidUntil = payload.valid_until !== undefined ? payload.valid_until : existingPermit.valid_until;

        if (finalValidUntil <= finalValidFrom) {
            return res.status(400).json({ error: "valid_until must be later than valid_from" });
        }

        const updates = [];
        const values = [];
        let index = 1;

        Object.entries(payload).forEach(([field, value]) => {
            updates.push(`${field} = $${index}`);
            values.push(value);
            index += 1;
        });

        values.push(permitId);
        values.push(req.user.company_id);

        const result = await db.query(
            `
            UPDATE work_permits
            SET ${updates.join(", ")}
            WHERE id = $${index} AND company_id = $${index + 1}
            RETURNING *
            `,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Permit not found" });
        }

        const updatedPermit = await getPermitById(permitId, req.user.company_id);

        return res.json({
            message: "Permit updated successfully",
            permit: updatedPermit
        });
    } catch (error) {
        return handleRouteError(res, error, "Failed to update permit");
    }
});

router.post("/:id/workers", async (req, res) => {
    const body = getBody(req);

    try {
        const permitId = parseId(req.params.id);
        if (!permitId) {
            return res.status(400).json({ error: "Invalid permit ID" });
        }

        const permit = await getPermitById(permitId, req.user.company_id);
        if (!permit) {
            return res.status(404).json({ error: "Permit not found" });
        }

        const workerId = parseId(body.worker_id);
        if (!workerId) {
            return res.status(400).json({ error: "worker_id is required" });
        }

        const worker = await ensureWorkerBelongsToProject(workerId, permit.project_id, req.user.company_id);
        if (!worker) {
            return res.status(404).json({ error: "Worker not found or not active on this project" });
        }

        const result = await runInTransaction(async (client) => {
            const existing = await client.query(
                `
                SELECT id
                FROM work_permit_workers
                WHERE company_id = $1 AND permit_id = $2 AND worker_id = $3
                `,
                [req.user.company_id, permitId, workerId]
            );

            if (existing.rows.length > 0) {
                throw Object.assign(new Error("Duplicate worker association"), { statusCode: 409, code: "23505" });
            }

            const inserted = await client.query(
                `
                INSERT INTO work_permit_workers (company_id, permit_id, worker_id)
                VALUES ($1, $2, $3)
                RETURNING *
                `,
                [req.user.company_id, permitId, workerId]
            );

            await addPermitEvent(client, {
                companyId: req.user.company_id,
                permitId,
                eventType: "created",
                fromStatus: permit.status,
                toStatus: permit.status,
                performedBy: req.user.id,
                comments: `Worker ${workerId} added to permit`
            });

            return inserted.rows[0];
        });

        return res.status(201).json({
            message: "Worker linked to permit",
            association: result
        });
    } catch (error) {
        if (error.statusCode === 409 || error.code === "23505") {
            return res.status(409).json({ error: "This worker is already attached to this permit" });
        }
        return handleRouteError(res, error, "Failed to associate worker");
    }
});

router.delete("/:id/workers/:workerId", async (req, res) => {
    try {
        const permitId = parseId(req.params.id);
        const workerId = parseId(req.params.workerId);

        if (!permitId || !workerId) {
            return res.status(400).json({ error: "Invalid permit or worker ID" });
        }

        const permit = await getPermitById(permitId, req.user.company_id);
        if (!permit) {
            return res.status(404).json({ error: "Permit not found" });
        }

        const result = await db.query(
            `
            DELETE FROM work_permit_workers
            WHERE company_id = $1 AND permit_id = $2 AND worker_id = $3
            RETURNING *
            `,
            [req.user.company_id, permitId, workerId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Worker association not found" });
        }

        return res.json({ message: "Worker removed from permit" });
    } catch (error) {
        return handleRouteError(res, error, "Failed to remove worker association");
    }
});

router.post("/:id/assets", async (req, res) => {
    const body = getBody(req);

    try {
        const permitId = parseId(req.params.id);
        if (!permitId) {
            return res.status(400).json({ error: "Invalid permit ID" });
        }

        const permit = await getPermitById(permitId, req.user.company_id);
        if (!permit) {
            return res.status(404).json({ error: "Permit not found" });
        }

        const assetId = parseId(body.asset_id);
        if (!assetId) {
            return res.status(400).json({ error: "asset_id is required" });
        }

        const asset = await ensureAssetBelongsToProject(assetId, permit.project_id, req.user.company_id);
        if (!asset) {
            return res.status(404).json({ error: "Asset not found or not assigned to this project" });
        }

        if (asset.status !== "active") {
            return res.status(400).json({ error: "Asset is not active" });
        }

        if (asset.operational_status === "out_of_service" || asset.operational_status === "under_maintenance") {
            return res.status(400).json({ error: "Asset is unavailable for permit assignment" });
        }

        const result = await runInTransaction(async (client) => {
            const duplicate = await client.query(
                `
                SELECT id
                FROM work_permit_assets
                WHERE company_id = $1 AND permit_id = $2 AND asset_id = $3
                `,
                [req.user.company_id, permitId, assetId]
            );

            if (duplicate.rows.length > 0) {
                throw Object.assign(new Error("Duplicate asset association"), { statusCode: 409, code: "23505" });
            }

            const inserted = await client.query(
                `
                INSERT INTO work_permit_assets (company_id, permit_id, asset_id)
                VALUES ($1, $2, $3)
                RETURNING *
                `,
                [req.user.company_id, permitId, assetId]
            );

            await addPermitEvent(client, {
                companyId: req.user.company_id,
                permitId,
                eventType: "created",
                fromStatus: permit.status,
                toStatus: permit.status,
                performedBy: req.user.id,
                comments: `Asset ${assetId} added to permit`
            });

            return inserted.rows[0];
        });

        return res.status(201).json({
            message: "Asset linked to permit",
            association: result
        });
    } catch (error) {
        if (error.statusCode === 409 || error.code === "23505") {
            return res.status(409).json({ error: "This asset is already attached to this permit" });
        }
        return handleRouteError(res, error, "Failed to associate asset");
    }
});

router.delete("/:id/assets/:assetId", async (req, res) => {
    try {
        const permitId = parseId(req.params.id);
        const assetId = parseId(req.params.assetId);

        if (!permitId || !assetId) {
            return res.status(400).json({ error: "Invalid permit or asset ID" });
        }

        const permit = await getPermitById(permitId, req.user.company_id);
        if (!permit) {
            return res.status(404).json({ error: "Permit not found" });
        }

        const result = await db.query(
            `
            DELETE FROM work_permit_assets
            WHERE company_id = $1 AND permit_id = $2 AND asset_id = $3
            RETURNING *
            `,
            [req.user.company_id, permitId, assetId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Asset association not found" });
        }

        return res.json({ message: "Asset removed from permit" });
    } catch (error) {
        return handleRouteError(res, error, "Failed to remove asset association");
    }
});

router.post("/:id/documents", async (req, res) => {
    const body = getBody(req);

    try {
        const permitId = parseId(req.params.id);
        if (!permitId) {
            return res.status(400).json({ error: "Invalid permit ID" });
        }

        const permit = await getPermitById(permitId, req.user.company_id);
        if (!permit) {
            return res.status(404).json({ error: "Permit not found" });
        }

        const documentId = parseId(body.compliance_document_id);
        if (!documentId) {
            return res.status(400).json({ error: "compliance_document_id is required" });
        }

        const document = await ensureComplianceDocumentBelongsToCompany(documentId, req.user.company_id);
        if (!document) {
            return res.status(404).json({ error: "Compliance document not found" });
        }

        if (document.status !== "active") {
            return res.status(400).json({ error: "Compliance document is not active" });
        }

        if (document.expiry_date) {
            const expiryDate = new Date(document.expiry_date);
            if (!Number.isNaN(expiryDate.getTime()) && expiryDate < new Date()) {
                return res.status(400).json({ error: "Compliance document has expired" });
            }
        }

        const result = await runInTransaction(async (client) => {
            const duplicate = await client.query(
                `
                SELECT id
                FROM work_permit_documents
                WHERE company_id = $1 AND permit_id = $2 AND compliance_document_id = $3
                `,
                [req.user.company_id, permitId, documentId]
            );

            if (duplicate.rows.length > 0) {
                throw Object.assign(new Error("Duplicate document association"), { statusCode: 409, code: "23505" });
            }

            const inserted = await client.query(
                `
                INSERT INTO work_permit_documents (company_id, permit_id, compliance_document_id)
                VALUES ($1, $2, $3)
                RETURNING *
                `,
                [req.user.company_id, permitId, documentId]
            );

            await addPermitEvent(client, {
                companyId: req.user.company_id,
                permitId,
                eventType: "created",
                fromStatus: permit.status,
                toStatus: permit.status,
                performedBy: req.user.id,
                comments: `Compliance document ${documentId} added to permit`
            });

            return inserted.rows[0];
        });

        return res.status(201).json({
            message: "Compliance document linked to permit",
            association: result
        });
    } catch (error) {
        if (error.statusCode === 409 || error.code === "23505") {
            return res.status(409).json({ error: "This compliance document is already attached to this permit" });
        }
        return handleRouteError(res, error, "Failed to associate compliance document");
    }
});

router.delete("/:id/documents/:documentId", async (req, res) => {
    try {
        const permitId = parseId(req.params.id);
        const documentId = parseId(req.params.documentId);

        if (!permitId || !documentId) {
            return res.status(400).json({ error: "Invalid permit or document ID" });
        }

        const permit = await getPermitById(permitId, req.user.company_id);
        if (!permit) {
            return res.status(404).json({ error: "Permit not found" });
        }

        const result = await db.query(
            `
            DELETE FROM work_permit_documents
            WHERE company_id = $1 AND permit_id = $2 AND compliance_document_id = $3
            RETURNING *
            `,
            [req.user.company_id, permitId, documentId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Document association not found" });
        }

        return res.json({ message: "Document removed from permit" });
    } catch (error) {
        return handleRouteError(res, error, "Failed to remove document association");
    }
});

const getPermitForLifecycle = async (permitId, companyId) => {
    const permit = await getPermitById(permitId, companyId);
    if (!permit) {
        throw Object.assign(new Error("Permit not found"), { statusCode: 404 });
    }
    return permit;
};

const assertLifecycleTransition = (currentStatus, nextStatus) => {
    const allowed = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(nextStatus)) {
        throw Object.assign(new Error(`Invalid status transition from ${currentStatus} to ${nextStatus}`), { statusCode: 400 });
    }
};

const validatePermitRequirementsForApproval = async (permit, companyId, client = db) => {
    const project = await ensureProjectBelongsToCompany(permit.project_id, companyId, client);
    if (!project) {
        throw Object.assign(new Error("Project not found"), { statusCode: 404 });
    }

    if (permit.contractor_id !== null) {
        const contractor = await ensureContractorBelongsToProject(permit.contractor_id, permit.project_id, companyId, client);
        if (!contractor) {
            throw Object.assign(new Error("Contractor not found for this project and company"), { statusCode: 404 });
        }
    }

    const workersResult = await client.query(
        `
        SELECT worker_id
        FROM work_permit_workers
        WHERE company_id = $1 AND permit_id = $2
        `,
        [companyId, permit.id]
    );

    for (const row of workersResult.rows) {
        const worker = await ensureWorkerBelongsToProject(row.worker_id, permit.project_id, companyId, client);
        if (!worker) {
            throw Object.assign(new Error("Worker is not active on the permit project"), { statusCode: 400 });
        }
    }

    const assetResult = await client.query(
        `
        SELECT asset_id
        FROM work_permit_assets
        WHERE company_id = $1 AND permit_id = $2
        `,
        [companyId, permit.id]
    );

    for (const row of assetResult.rows) {
        const asset = await ensureAssetBelongsToProject(row.asset_id, permit.project_id, companyId, client);
        if (!asset) {
            throw Object.assign(new Error("Asset not assigned to the permit project"), { statusCode: 400 });
        }
        if (asset.status !== "active") {
            throw Object.assign(new Error("Attached asset is not active"), { statusCode: 400 });
        }
        if (asset.operational_status === "out_of_service" || asset.operational_status === "under_maintenance") {
            throw Object.assign(new Error("Attached asset is unavailable"), { statusCode: 400 });
        }
    }

    const docsResult = await client.query(
        `
        SELECT compliance_document_id
        FROM work_permit_documents
        WHERE company_id = $1 AND permit_id = $2
        `,
        [companyId, permit.id]
    );

    for (const row of docsResult.rows) {
        const document = await ensureComplianceDocumentBelongsToCompany(row.compliance_document_id, companyId, client);
        if (!document) {
            throw Object.assign(new Error("Compliance document not found"), { statusCode: 404 });
        }
        if (document.status !== "active") {
            throw Object.assign(new Error("Attached compliance document is not active"), { statusCode: 400 });
        }
        if (document.expiry_date) {
            const expiryDate = new Date(document.expiry_date);
            if (!Number.isNaN(expiryDate.getTime()) && expiryDate < new Date()) {
                throw Object.assign(new Error("Attached compliance document has expired"), { statusCode: 400 });
            }
        }
    }
};

router.post("/:id/submit", async (req, res) => {
    try {
        const permitId = parseId(req.params.id);
        if (!permitId) {
            return res.status(400).json({ error: "Invalid permit ID" });
        }

        const permit = await getPermitForLifecycle(permitId, req.user.company_id);
        assertLifecycleTransition(permit.status, "pending_review");

        const result = await runInTransaction(async (client) => {
            const rows = await client.query(
                `
                UPDATE work_permits
                SET status = 'pending_review', submitted_at = NOW()
                WHERE id = $1 AND company_id = $2
                RETURNING *
                `,
                [permitId, req.user.company_id]
            );

            await addPermitEvent(client, {
                companyId: req.user.company_id,
                permitId,
                eventType: "submitted",
                fromStatus: permit.status,
                toStatus: "pending_review",
                performedBy: req.user.id,
                comments: "Permit submitted for review"
            });

            return rows.rows[0];
        });

        await safelyNotifyPermitUsers({
            companyId: req.user.company_id,
            permitId,
            userIds: [permit.created_by],
            type: "permit_submitted",
            subject: "Work permit submitted",
            message: `Work permit #${permitId} was submitted for review.`,
        });

        return res.json({ message: "Permit submitted for review", permit: result });
    } catch (error) {
        if (error.statusCode === 404) {
            return res.status(404).json({ error: "Permit not found" });
        }
        if (error.statusCode === 400) {
            return res.status(400).json({ error: error.message });
        }
        return handleRouteError(res, error, "Failed to submit permit");
    }
});

router.post("/:id/review", async (req, res) => {
    const body = getBody(req);

    try {
        const permitId = parseId(req.params.id);
        if (!permitId) {
            return res.status(400).json({ error: "Invalid permit ID" });
        }

        const permit = await getPermitForLifecycle(permitId, req.user.company_id);
        if (permit.status !== "pending_review") {
            return res.status(400).json({ error: "Only permits in pending_review can be reviewed" });
        }

        const reviewComments = body.review_comments === undefined ? null : normalizeString(body.review_comments);

        const result = await runInTransaction(async (client) => {
            const rows = await client.query(
                `
                UPDATE work_permits
                SET reviewed_by = $1,
                    reviewed_at = NOW(),
                    review_comments = $2
                WHERE id = $3 AND company_id = $4
                RETURNING *
                `,
                [req.user.id, reviewComments || null, permitId, req.user.company_id]
            );

            await addPermitEvent(client, {
                companyId: req.user.company_id,
                permitId,
                eventType: "reviewed",
                fromStatus: "pending_review",
                toStatus: "pending_review",
                performedBy: req.user.id,
                comments: reviewComments || "Permit reviewed"
            });

            return rows.rows[0];
        });

        return res.json({ message: "Permit reviewed", permit: result });
    } catch (error) {
        if (error.statusCode === 404) {
            return res.status(404).json({ error: "Permit not found" });
        }
        return handleRouteError(res, error, "Failed to review permit");
    }
});

router.post("/:id/approve", async (req, res) => {
    try {
        const permitId = parseId(req.params.id);
        if (!permitId) {
            return res.status(400).json({ error: "Invalid permit ID" });
        }

        const permit = await getPermitForLifecycle(permitId, req.user.company_id);
        if (permit.status !== "pending_review") {
            return res.status(400).json({ error: "Only pending_review permits can be approved" });
        }

        const result = await runInTransaction(async (client) => {
            await validatePermitRequirementsForApproval(permit, req.user.company_id, client);

            const rows = await client.query(
                `
                UPDATE work_permits
                SET approved_by = $1,
                    approved_at = NOW(),
                    status = 'approved'
                WHERE id = $2 AND company_id = $3
                RETURNING *
                `,
                [req.user.id, permitId, req.user.company_id]
            );

            await addPermitEvent(client, {
                companyId: req.user.company_id,
                permitId,
                eventType: "approved",
                fromStatus: "pending_review",
                toStatus: "approved",
                performedBy: req.user.id,
                comments: "Permit approved"
            });

            return rows.rows[0];
        });

        await safelyNotifyPermitUsers({
            companyId: req.user.company_id,
            permitId,
            userIds: [permit.created_by, result.approved_by],
            type: "permit_approved",
            subject: "Work permit approved",
            message: `Work permit #${permitId} was approved.`,
        });

        return res.json({ message: "Permit approved", permit: result });
    } catch (error) {
        if (error.statusCode === 404) {
            return res.status(404).json({ error: error.message });
        }
        if (error.statusCode === 400) {
            return res.status(400).json({ error: error.message });
        }
        return handleRouteError(res, error, "Failed to approve permit");
    }
});

router.post("/:id/reject", async (req, res) => {
    const body = getBody(req);

    try {
        const permitId = parseId(req.params.id);
        if (!permitId) {
            return res.status(400).json({ error: "Invalid permit ID" });
        }

        const permit = await getPermitForLifecycle(permitId, req.user.company_id);
        if (permit.status !== "pending_review") {
            return res.status(400).json({ error: "Only pending_review permits can be rejected" });
        }

        const rejectionReason = normalizeString(body.rejection_reason || "");
        if (rejectionReason === "") {
            return res.status(400).json({ error: "rejection_reason is required" });
        }

        const result = await runInTransaction(async (client) => {
            const rows = await client.query(
                `
                UPDATE work_permits
                SET status = 'rejected',
                    reviewed_by = COALESCE(reviewed_by, $1),
                    reviewed_at = COALESCE(reviewed_at, NOW()),
                    rejection_reason = $2
                WHERE id = $3 AND company_id = $4
                RETURNING *
                `,
                [req.user.id, rejectionReason, permitId, req.user.company_id]
            );

            await addPermitEvent(client, {
                companyId: req.user.company_id,
                permitId,
                eventType: "rejected",
                fromStatus: "pending_review",
                toStatus: "rejected",
                performedBy: req.user.id,
                comments: rejectionReason
            });

            return rows.rows[0];
        });

        await safelyNotifyPermitUsers({
            companyId: req.user.company_id,
            permitId,
            userIds: [permit.created_by, result.reviewed_by],
            type: "permit_rejected",
            subject: "Work permit rejected",
            message: `Work permit #${permitId} was rejected.`,
        });

        return res.json({ message: "Permit rejected", permit: result });
    } catch (error) {
        if (error.statusCode === 404) {
            return res.status(404).json({ error: "Permit not found" });
        }
        return handleRouteError(res, error, "Failed to reject permit");
    }
});

router.post("/:id/activate", async (req, res) => {
    try {
        const permitId = parseId(req.params.id);
        if (!permitId) {
            return res.status(400).json({ error: "Invalid permit ID" });
        }

        const permit = await getPermitForLifecycle(permitId, req.user.company_id);
        if (permit.status !== "approved") {
            return res.status(400).json({ error: "Only approved permits can be activated" });
        }

        const now = new Date();
        if (new Date(permit.valid_until) <= now) {
            return res.status(400).json({ error: "Permit is expired and cannot be activated" });
        }

        const result = await runInTransaction(async (client) => {
            const rows = await client.query(
                `
                UPDATE work_permits
                SET status = 'active'
                WHERE id = $1 AND company_id = $2
                RETURNING *
                `,
                [permitId, req.user.company_id]
            );

            await addPermitEvent(client, {
                companyId: req.user.company_id,
                permitId,
                eventType: "activated",
                fromStatus: "approved",
                toStatus: "active",
                performedBy: req.user.id,
                comments: "Permit activated"
            });

            return rows.rows[0];
        });

        await safelyNotifyPermitUsers({
            companyId: req.user.company_id,
            permitId,
            userIds: [permit.created_by, permit.approved_by],
            type: "permit_activated",
            subject: "Work permit activated",
            message: `Work permit #${permitId} was activated.`,
        });

        return res.json({ message: "Permit activated", permit: result });
    } catch (error) {
        if (error.statusCode === 404) {
            return res.status(404).json({ error: "Permit not found" });
        }
        return handleRouteError(res, error, "Failed to activate permit");
    }
});

router.post("/:id/suspend", async (req, res) => {
    const body = getBody(req);

    try {
        const permitId = parseId(req.params.id);
        if (!permitId) {
            return res.status(400).json({ error: "Invalid permit ID" });
        }

        const permit = await getPermitForLifecycle(permitId, req.user.company_id);
        if (permit.status !== "active") {
            return res.status(400).json({ error: "Only active permits can be suspended" });
        }

        const comments = body.comments === undefined ? null : normalizeString(body.comments);

        const result = await runInTransaction(async (client) => {
            const rows = await client.query(
                `
                UPDATE work_permits
                SET status = 'suspended'
                WHERE id = $1 AND company_id = $2
                RETURNING *
                `,
                [permitId, req.user.company_id]
            );

            await addPermitEvent(client, {
                companyId: req.user.company_id,
                permitId,
                eventType: "suspended",
                fromStatus: "active",
                toStatus: "suspended",
                performedBy: req.user.id,
                comments: comments || "Permit suspended"
            });

            return rows.rows[0];
        });

        return res.json({ message: "Permit suspended", permit: result });
    } catch (error) {
        if (error.statusCode === 404) {
            return res.status(404).json({ error: "Permit not found" });
        }
        return handleRouteError(res, error, "Failed to suspend permit");
    }
});

router.post("/:id/resume", async (req, res) => {
    try {
        const permitId = parseId(req.params.id);
        if (!permitId) {
            return res.status(400).json({ error: "Invalid permit ID" });
        }

        const permit = await getPermitForLifecycle(permitId, req.user.company_id);
        if (permit.status !== "suspended") {
            return res.status(400).json({ error: "Only suspended permits can be resumed" });
        }

        const now = new Date();
        if (new Date(permit.valid_until) <= now) {
            return res.status(400).json({ error: "Permit has expired and cannot be resumed" });
        }

        const result = await runInTransaction(async (client) => {
            const rows = await client.query(
                `
                UPDATE work_permits
                SET status = 'active'
                WHERE id = $1 AND company_id = $2
                RETURNING *
                `,
                [permitId, req.user.company_id]
            );

            await addPermitEvent(client, {
                companyId: req.user.company_id,
                permitId,
                eventType: "resumed",
                fromStatus: "suspended",
                toStatus: "active",
                performedBy: req.user.id,
                comments: "Permit resumed"
            });

            return rows.rows[0];
        });

        return res.json({ message: "Permit resumed", permit: result });
    } catch (error) {
        if (error.statusCode === 404) {
            return res.status(404).json({ error: "Permit not found" });
        }
        return handleRouteError(res, error, "Failed to resume permit");
    }
});

router.post("/:id/close", async (req, res) => {
    const body = getBody(req);

    try {
        const permitId = parseId(req.params.id);
        if (!permitId) {
            return res.status(400).json({ error: "Invalid permit ID" });
        }

        const permit = await getPermitForLifecycle(permitId, req.user.company_id);
        if (!(["active", "suspended"].includes(permit.status))) {
            return res.status(400).json({ error: "Only active or suspended permits can be closed" });
        }

        const closureNotes = body.closure_notes === undefined ? null : normalizeString(body.closure_notes);

        const result = await runInTransaction(async (client) => {
            const rows = await client.query(
                `
                UPDATE work_permits
                SET status = 'closed',
                    closed_by = $1,
                    closed_at = NOW(),
                    closure_notes = $2
                WHERE id = $3 AND company_id = $4
                RETURNING *
                `,
                [req.user.id, closureNotes || null, permitId, req.user.company_id]
            );

            await addPermitEvent(client, {
                companyId: req.user.company_id,
                permitId,
                eventType: "closed",
                fromStatus: permit.status,
                toStatus: "closed",
                performedBy: req.user.id,
                comments: closureNotes || "Permit closed"
            });

            return rows.rows[0];
        });

        return res.json({ message: "Permit closed", permit: result });
    } catch (error) {
        if (error.statusCode === 404) {
            return res.status(404).json({ error: "Permit not found" });
        }
        return handleRouteError(res, error, "Failed to close permit");
    }
});

router.post("/:id/cancel", async (req, res) => {
    const body = getBody(req);

    try {
        const permitId = parseId(req.params.id);
        if (!permitId) {
            return res.status(400).json({ error: "Invalid permit ID" });
        }

        const permit = await getPermitForLifecycle(permitId, req.user.company_id);
        if (["closed", "cancelled", "expired", "rejected"].includes(permit.status)) {
            return res.status(400).json({ error: "This permit cannot be cancelled from its current state" });
        }

        const comments = body.comments === undefined ? null : normalizeString(body.comments);

        const result = await runInTransaction(async (client) => {
            const rows = await client.query(
                `
                UPDATE work_permits
                SET status = 'cancelled',
                    cancelled_by = $1,
                    cancelled_at = NOW(),
                    closure_notes = COALESCE(closure_notes, $2)
                WHERE id = $3 AND company_id = $4
                RETURNING *
                `,
                [req.user.id, comments || null, permitId, req.user.company_id]
            );

            await addPermitEvent(client, {
                companyId: req.user.company_id,
                permitId,
                eventType: "cancelled",
                fromStatus: permit.status,
                toStatus: "cancelled",
                performedBy: req.user.id,
                comments: comments || "Permit cancelled"
            });

            return rows.rows[0];
        });

        return res.json({ message: "Permit cancelled", permit: result });
    } catch (error) {
        if (error.statusCode === 404) {
            return res.status(404).json({ error: "Permit not found" });
        }
        return handleRouteError(res, error, "Failed to cancel permit");
    }
});

module.exports = router;
