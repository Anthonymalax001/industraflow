const express = require("express");
const db = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { createNotification } = require("../services/notificationService");

const router = express.Router();


/*
    INCIDENT REPORTING MODULE

    Every route in this file is protected by authMiddleware.

    Table: incidents
    (id, company_id, project_id, reported_by, assigned_to, title,
     description, incident_type, severity, status, occurred_at,
     resolved_at, corrective_action, created_at)

    Tenancy
    -------
    company_id is the tenant anchor and is NOT NULL. It always comes
    from the verified JWT (req.user.company_id) and is never read from
    the body or query string.

    Migration 006 makes cross-tenant contamination structurally
    impossible with composite foreign keys:

        (company_id, project_id)  -> projects (company_id, id) ON DELETE RESTRICT
        (company_id, reported_by) -> users    (company_id, id) ON DELETE RESTRICT
        (company_id, assigned_to) -> users    (company_id, id) ON DELETE RESTRICT

    We still verify referenced records before writes and reference
    filters so callers get clean 404s without learning whether another
    company's id exists.

    There is intentionally no DELETE route here. Migration 006 has only
    incident lifecycle statuses (open, investigating, resolved, closed,
    cancelled), and no separate active/inactive field. Using cancelled
    as a fake soft delete would destroy a valid incident state.
*/


router.use(authMiddleware);


const ALLOWED_FIELDS = [
    "project_id",
    "reported_by",
    "assigned_to",
    "title",
    "description",
    "incident_type",
    "severity",
    "status",
    "occurred_at",
    "resolved_at",
    "corrective_action"
];


const CREATE_FIELDS = ALLOWED_FIELDS;


const REFERENCE_FIELDS = new Set([
    "project_id",
    "reported_by",
    "assigned_to"
]);


const TIMESTAMP_FIELDS = new Set([
    "occurred_at",
    "resolved_at"
]);


const TRIMMED_FIELDS = new Set([
    "title",
    "description",
    "corrective_action"
]);


const ALLOWED_INCIDENT_TYPES = [
    "accident",
    "near_miss",
    "injury",
    "property_damage",
    "environmental",
    "fire",
    "security",
    "other"
];


const ALLOWED_SEVERITIES = [
    "low",
    "medium",
    "high",
    "critical"
];


const ALLOWED_STATUSES = [
    "open",
    "investigating",
    "resolved",
    "closed",
    "cancelled"
];


const MAX_LENGTHS = {
    title: 255,
    incident_type: 30,
    severity: 20,
    status: 20
};


const CONNECTION_ERROR_CODES = new Set([
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EPIPE",
    "EACCES",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "08000",
    "08003",
    "08006",
    "08001",
    "08004",
    "57P01",
    "57P03"
]);


const INCIDENT_COLUMNS = `
        i.id,
        i.company_id,
        i.project_id,
        p.name AS project_name,
        p.status AS project_status,
        i.reported_by,
        reporter.name AS reporter_name,
        reporter.email AS reporter_email,
        i.assigned_to,
        assignee.name AS assignee_name,
        assignee.email AS assignee_email,
        i.title,
        i.description,
        i.incident_type,
        i.severity,
        i.status,
        i.occurred_at,
        i.resolved_at,
        i.corrective_action,
        i.created_at
`;


const INCIDENT_JOINS = `
    LEFT JOIN projects p
           ON p.id = i.project_id
          AND p.company_id = i.company_id
    JOIN users reporter
      ON reporter.id = i.reported_by
     AND reporter.company_id = i.company_id
    LEFT JOIN users assignee
           ON assignee.id = i.assigned_to
          AND assignee.company_id = i.company_id
`;


const BASE_SELECT = `
    SELECT ${INCIDENT_COLUMNS}
    FROM incidents i
    ${INCIDENT_JOINS}
`;


const returningIncident = (cte) => `
    WITH changed AS (
        ${cte}
    )
    SELECT ${INCIDENT_COLUMNS}
    FROM changed i
    ${INCIDENT_JOINS}
`;


const hasOwn = (object, field) => {
    return Object.prototype.hasOwnProperty.call(object, field);
};


const getBody = (req) => {

    const body = req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return {};
    }

    return body;

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


const trimOrNull = (value) => {

    if (value === null || value === undefined) {
        return null;
    }

    const trimmed = String(value).trim();

    return trimmed === "" ? null : trimmed;

};


const escapeLikePattern = (value) => {

    return value.replace(/[\\%_]/g, (character) => `\\${character}`);

};


const isConnectionError = (error) => {

    if (!error) {
        return false;
    }

    if (CONNECTION_ERROR_CODES.has(error.code)) {
        return true;
    }

    if (Array.isArray(error.errors)) {
        return error.errors.some((nested) => isConnectionError(nested));
    }

    return false;

};


const handleError = (error, res, message) => {

    console.error(error);

    if (isConnectionError(error)) {
        return res.status(503).json({
            error: "Database temporarily unavailable, please retry"
        });
    }

    if (error.code === "23505") {
        return res.status(409).json({
            error: "Incident conflicts with an existing record"
        });
    }

    if (error.code === "23514") {

        if (error.constraint === "incidents_incident_type_valid") {
            return res.status(400).json({
                error: `incident_type must be one of: ${ALLOWED_INCIDENT_TYPES.join(", ")}`
            });
        }

        if (error.constraint === "incidents_severity_valid") {
            return res.status(400).json({
                error: `severity must be one of: ${ALLOWED_SEVERITIES.join(", ")}`
            });
        }

        if (error.constraint === "incidents_status_valid") {
            return res.status(400).json({
                error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`
            });
        }

        if (error.constraint === "incidents_resolved_at_status_valid") {
            return res.status(400).json({
                error: "resolved_at can only be set when status is resolved or closed"
            });
        }

        if (error.constraint === "incidents_resolved_at_after_occurred_at") {
            return res.status(400).json({
                error: "resolved_at must not be earlier than occurred_at"
            });
        }

        return res.status(400).json({
            error: "Incident violates a database rule"
        });

    }

    if (error.code === "23503") {

        if (error.constraint === "incidents_project_same_company") {
            return res.status(400).json({
                error: "Project not found"
            });
        }

        if (error.constraint === "incidents_reported_by_same_company") {
            return res.status(400).json({
                error: "Reporter not found"
            });
        }

        if (error.constraint === "incidents_assigned_to_same_company") {
            return res.status(400).json({
                error: "Assignee not found"
            });
        }

        return res.status(400).json({
            error: "Incident references a record that does not exist"
        });

    }

    if (error.code === "22001") {
        return res.status(400).json({
            error: "A field value is longer than the column allows"
        });
    }

    if (["23502", "22007", "22008", "22P02"].includes(error.code)) {
        return res.status(400).json({
            error: "Invalid field value in request body"
        });
    }

    return res.status(500).json({
        error: message
    });

};


const companyOwnsProject = async (projectId, companyId) => {

    const result = await db.query(
        `
        SELECT id
        FROM projects
        WHERE id = $1 AND company_id = $2
        `,
        [projectId, companyId]
    );

    return result.rowCount > 0;

};


const companyOwnsUser = async (userId, companyId) => {

    const result = await db.query(
        `
        SELECT id
        FROM users
        WHERE id = $1 AND company_id = $2
        `,
        [userId, companyId]
    );

    return result.rowCount > 0;

};


const notifyIncidentUsers = async ({
    companyId,
    incidentId,
    userIds,
    type,
    subject,
    message,
    eventKey,
}) => {

    const recipients = [...new Set(userIds.filter((userId) => userId !== null && userId !== undefined))];

    await Promise.all(recipients.map((userId) => createNotification({
        company_id: companyId,
        user_id: userId,
        type,
        channel: "in_app",
        subject,
        message,
        related_model: "incident",
        related_id: incidentId,
        event_key: `${eventKey}:${userId}`,
        metadata: { incident_id: incidentId },
    })));

};


const safelyNotifyIncidentUsers = async (notification) => {

    try {
        await notifyIncidentUsers(notification);
    } catch (error) {
        console.error("Unable to create incident notification");
    }

};


const resolveRequiredProjectId = async (rawProjectId, companyId) => {

    const projectId = parseId(rawProjectId);

    if (!projectId) {
        return { error: { status: 400, message: "A valid project_id is required" } };
    }

    const owned = await companyOwnsProject(projectId, companyId);

    if (!owned) {
        return { error: { status: 404, message: "Project not found" } };
    }

    return { projectId };

};


const resolveProjectId = async (rawProjectId, companyId) => {

    if (rawProjectId === null || rawProjectId === undefined || rawProjectId === "") {
        return { projectId: null };
    }

    return resolveRequiredProjectId(rawProjectId, companyId);

};


const resolveRequiredUserId = async (field, rawUserId, companyId) => {

    if (rawUserId === null || rawUserId === undefined || rawUserId === "") {
        return { error: { status: 400, message: `${field} is required` } };
    }

    const userId = parseId(rawUserId);

    if (!userId) {
        return { error: { status: 400, message: `A valid ${field} is required` } };
    }

    const owned = await companyOwnsUser(userId, companyId);

    if (!owned) {

        const message = field === "reported_by"
            ? "Reporter not found"
            : "Assignee not found";

        return { error: { status: 404, message } };

    }

    return { userId };

};


const resolveOptionalUserId = async (field, rawUserId, companyId) => {

    if (rawUserId === null || rawUserId === undefined || rawUserId === "") {
        return { userId: null };
    }

    const userId = parseId(rawUserId);

    if (!userId) {
        return { error: { status: 400, message: `A valid ${field} is required` } };
    }

    const owned = await companyOwnsUser(userId, companyId);

    if (!owned) {
        return { error: { status: 404, message: "Assignee not found" } };
    }

    return { userId };

};


const validateTimestampValue = (body, field, required) => {

    const value = body[field];

    if (value === null || value === undefined || value === "") {
        return required ? `${field} is required` : null;
    }

    if (typeof value !== "string") {
        return `${field} must be a timestamp string`;
    }

    if (value.trim() === "") {
        return required ? `${field} is required` : null;
    }

    return null;

};


const validateCommonFields = (body, presentFields) => {

    if (presentFields.includes("title")) {

        const title = body.title;

        if (!title || typeof title !== "string" || title.trim() === "") {
            return "Incident title is required";
        }

        if (title.trim().length > MAX_LENGTHS.title) {
            return `title must be ${MAX_LENGTHS.title} characters or fewer`;
        }

    }

    if (presentFields.includes("description")) {

        const description = body.description;

        if (!description || typeof description !== "string" || description.trim() === "") {
            return "Incident description is required";
        }

    }

    if (presentFields.includes("incident_type")) {

        const incidentType = body.incident_type;

        if (!incidentType || typeof incidentType !== "string" || !ALLOWED_INCIDENT_TYPES.includes(incidentType)) {
            return `incident_type must be one of: ${ALLOWED_INCIDENT_TYPES.join(", ")}`;
        }

        if (incidentType.length > MAX_LENGTHS.incident_type) {
            return `incident_type must be ${MAX_LENGTHS.incident_type} characters or fewer`;
        }

    }

    if (presentFields.includes("severity")) {

        const severity = body.severity;

        if (!severity || typeof severity !== "string" || !ALLOWED_SEVERITIES.includes(severity)) {
            return `severity must be one of: ${ALLOWED_SEVERITIES.join(", ")}`;
        }

        if (severity.length > MAX_LENGTHS.severity) {
            return `severity must be ${MAX_LENGTHS.severity} characters or fewer`;
        }

    }

    if (presentFields.includes("status")) {

        const status = body.status;

        if (!status || typeof status !== "string" || !ALLOWED_STATUSES.includes(status)) {
            return `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`;
        }

        if (status.length > MAX_LENGTHS.status) {
            return `status must be ${MAX_LENGTHS.status} characters or fewer`;
        }

    }

    if (presentFields.includes("occurred_at")) {

        const error = validateTimestampValue(body, "occurred_at", true);

        if (error) {
            return error;
        }

    }

    if (presentFields.includes("resolved_at")) {

        const error = validateTimestampValue(body, "resolved_at", false);

        if (error) {
            return error;
        }

    }

    if (presentFields.includes("corrective_action")) {

        const correctiveAction = body.corrective_action;

        if (correctiveAction !== null
            && correctiveAction !== undefined
            && correctiveAction !== ""
            && typeof correctiveAction !== "string") {
            return "corrective_action must be a string";
        }

    }

    return null;

};


const requireSingleQueryValue = (value, field) => {

    if (Array.isArray(value)) {
        return { error: `${field} must be a single value` };
    }

    return { value };

};


const validateTimestampQueryValue = (value, field) => {

    const single = requireSingleQueryValue(value, field);

    if (single.error) {
        return single;
    }

    if (single.value === null || single.value === undefined || single.value === "") {
        return { error: `${field} cannot be empty` };
    }

    if (typeof single.value !== "string") {
        return { error: `${field} must be a timestamp string` };
    }

    if (single.value.trim() === "") {
        return { error: `${field} cannot be empty` };
    }

    return { value: single.value };

};


/*
    CREATE INCIDENT

    POST /api/incidents
*/

router.post("/", async (req, res) => {

    try {

        const body = getBody(req);

        const {
            title,
            description,
            incident_type,
            severity,
            status,
            occurred_at,
            resolved_at,
            corrective_action
        } = body;

        if (!title || typeof title !== "string" || title.trim() === "") {
            return res.status(400).json({
                error: "Incident title is required"
            });
        }

        if (!description || typeof description !== "string" || description.trim() === "") {
            return res.status(400).json({
                error: "Incident description is required"
            });
        }

        if (!incident_type || typeof incident_type !== "string") {
            return res.status(400).json({
                error: "incident_type is required"
            });
        }

        if (occurred_at === null || occurred_at === undefined || occurred_at === "") {
            return res.status(400).json({
                error: "occurred_at is required"
            });
        }

        const presentFields = CREATE_FIELDS.filter(
            (field) => hasOwn(body, field)
        );

        const validationError = validateCommonFields(body, presentFields);

        if (validationError) {
            return res.status(400).json({
                error: validationError
            });
        }

        const project = await resolveProjectId(body.project_id, req.user.company_id);

        if (project.error) {
            return res.status(project.error.status).json({
                error: project.error.message
            });
        }

        const reporter = await resolveRequiredUserId(
            "reported_by",
            body.reported_by,
            req.user.company_id
        );

        if (reporter.error) {
            return res.status(reporter.error.status).json({
                error: reporter.error.message
            });
        }

        const assignee = await resolveOptionalUserId(
            "assigned_to",
            body.assigned_to,
            req.user.company_id
        );

        if (assignee.error) {
            return res.status(assignee.error.status).json({
                error: assignee.error.message
            });
        }

        const result = await db.query(
            returningIncident(`
                INSERT INTO incidents
                (company_id, project_id, reported_by, assigned_to, title,
                 description, incident_type, severity, status, occurred_at,
                 resolved_at, corrective_action)
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    COALESCE($8, 'medium'),
                    COALESCE($9, 'open'),
                    $10::timestamp,
                    $11::timestamp,
                    $12
                )
                RETURNING *
            `),
            [
                req.user.company_id,
                project.projectId,
                reporter.userId,
                assignee.userId,
                title.trim(),
                description.trim(),
                incident_type,
                severity || null,
                status || null,
                occurred_at,
                resolved_at || null,
                trimOrNull(corrective_action)
            ]
        );

        const incident = result.rows[0];

        await safelyNotifyIncidentUsers({
            companyId: req.user.company_id,
            incidentId: incident.id,
            userIds: [incident.reported_by, incident.assigned_to],
            type: "incident_created",
            subject: "Incident created",
            message: `Incident #${incident.id} was created.`,
            eventKey: `incident_created:${incident.id}`,
        });

        res.status(201).json({
            message: "Incident created successfully",
            incident
        });

    } catch(error){

        handleError(error, res, "Failed to create incident");

    }

});


/*
    LIST INCIDENTS

    GET /api/incidents
*/

router.get("/", async (req, res) => {

    try {

        const values = [req.user.company_id];
        const filters = [];

        if (req.query.project_id !== undefined) {

            const project = await resolveRequiredProjectId(
                req.query.project_id,
                req.user.company_id
            );

            if (project.error) {
                return res.status(project.error.status).json({
                    error: project.error.message
                });
            }

            values.push(project.projectId);
            filters.push(`AND i.project_id = $${values.length}`);

        }

        if (req.query.reported_by !== undefined) {

            const reporter = await resolveRequiredUserId(
                "reported_by",
                req.query.reported_by,
                req.user.company_id
            );

            if (reporter.error) {
                return res.status(reporter.error.status).json({
                    error: reporter.error.message
                });
            }

            values.push(reporter.userId);
            filters.push(`AND i.reported_by = $${values.length}`);

        }

        if (req.query.assigned_to !== undefined) {

            const assignee = await resolveRequiredUserId(
                "assigned_to",
                req.query.assigned_to,
                req.user.company_id
            );

            if (assignee.error) {
                return res.status(assignee.error.status).json({
                    error: assignee.error.message
                });
            }

            values.push(assignee.userId);
            filters.push(`AND i.assigned_to = $${values.length}`);

        }

        if (req.query.incident_type !== undefined) {

            const single = requireSingleQueryValue(req.query.incident_type, "incident_type");

            if (single.error) {
                return res.status(400).json({ error: single.error });
            }

            const incidentType = single.value;

            if (!ALLOWED_INCIDENT_TYPES.includes(incidentType)) {
                return res.status(400).json({
                    error: `incident_type must be one of: ${ALLOWED_INCIDENT_TYPES.join(", ")}`
                });
            }

            values.push(incidentType);
            filters.push(`AND i.incident_type = $${values.length}`);

        }

        if (req.query.severity !== undefined) {

            const single = requireSingleQueryValue(req.query.severity, "severity");

            if (single.error) {
                return res.status(400).json({ error: single.error });
            }

            const severityFilter = single.value;

            if (!ALLOWED_SEVERITIES.includes(severityFilter)) {
                return res.status(400).json({
                    error: `severity must be one of: ${ALLOWED_SEVERITIES.join(", ")}`
                });
            }

            values.push(severityFilter);
            filters.push(`AND i.severity = $${values.length}`);

        }

        if (req.query.status !== undefined) {

            const single = requireSingleQueryValue(req.query.status, "status");

            if (single.error) {
                return res.status(400).json({ error: single.error });
            }

            const statusFilter = single.value;

            if (!ALLOWED_STATUSES.includes(statusFilter)) {
                return res.status(400).json({
                    error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`
                });
            }

            values.push(statusFilter);
            filters.push(`AND i.status = $${values.length}`);

        }

        if (req.query.from_date !== undefined) {

            const fromDate = validateTimestampQueryValue(req.query.from_date, "from_date");

            if (fromDate.error) {
                return res.status(400).json({
                    error: fromDate.error
                });
            }

            values.push(fromDate.value);
            filters.push(`AND i.occurred_at >= $${values.length}::timestamp`);

        }

        if (req.query.to_date !== undefined) {

            const toDate = validateTimestampQueryValue(req.query.to_date, "to_date");

            if (toDate.error) {
                return res.status(400).json({
                    error: toDate.error
                });
            }

            values.push(toDate.value);
            filters.push(`AND i.occurred_at <= $${values.length}::timestamp`);

        }

        if (req.query.search !== undefined) {

            const single = requireSingleQueryValue(req.query.search, "search");

            if (single.error) {
                return res.status(400).json({ error: single.error });
            }

            const search = String(single.value).trim();

            if (search === "") {
                return res.status(400).json({
                    error: "search cannot be empty"
                });
            }

            values.push(`%${escapeLikePattern(search)}%`);
            filters.push(`
                AND (
                    i.title ILIKE $${values.length}
                    OR i.description ILIKE $${values.length}
                )
            `);

        }

        const result = await db.query(
            `
            ${BASE_SELECT}
            WHERE i.company_id = $1
            ${filters.join(" ")}
            ORDER BY i.occurred_at DESC, i.id DESC
            `,
            values
        );

        res.json({
            count: result.rowCount,
            incidents: result.rows
        });

    } catch(error){

        handleError(error, res, "Failed to fetch incidents");

    }

});


/*
    GET SINGLE INCIDENT

    GET /api/incidents/:id
*/

router.get("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);

        if (!id) {
            return res.status(400).json({
                error: "Invalid incident id"
            });
        }

        const result = await db.query(
            `
            ${BASE_SELECT}
            WHERE i.id = $1 AND i.company_id = $2
            `,
            [id, req.user.company_id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                error: "Incident not found"
            });
        }

        res.json({
            incident: result.rows[0]
        });

    } catch(error){

        handleError(error, res, "Failed to fetch incident");

    }

});


/*
    UPDATE INCIDENT

    PUT /api/incidents/:id
*/

router.put("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);

        if (!id) {
            return res.status(400).json({
                error: "Invalid incident id"
            });
        }

        const body = getBody(req);

        const fields = ALLOWED_FIELDS.filter(
            (field) => hasOwn(body, field)
        );

        if (fields.length === 0) {
            return res.status(400).json({
                error: `Provide at least one field to update: ${ALLOWED_FIELDS.join(", ")}`
            });
        }

        const existing = await db.query(
            `
            SELECT id, reported_by, assigned_to, status
            FROM incidents
            WHERE id = $1 AND company_id = $2
            `,
            [id, req.user.company_id]
        );

        if (existing.rowCount === 0) {
            return res.status(404).json({
                error: "Incident not found"
            });
        }

        const validationError = validateCommonFields(body, fields);

        if (validationError) {
            return res.status(400).json({
                error: validationError
            });
        }

        const updates = {};

        for (const field of fields) {

            if (REFERENCE_FIELDS.has(field)) {
                continue;
            }

            const value = body[field];

            if (TRIMMED_FIELDS.has(field)) {
                updates[field] = field === "corrective_action"
                    ? trimOrNull(value)
                    : String(value).trim();
                continue;
            }

            updates[field] = value === "" ? null : value;

        }

        if (fields.includes("project_id")) {

            const project = await resolveProjectId(
                body.project_id,
                req.user.company_id
            );

            if (project.error) {
                return res.status(project.error.status).json({
                    error: project.error.message
                });
            }

            updates.project_id = project.projectId;

        }

        if (fields.includes("reported_by")) {

            const reporter = await resolveRequiredUserId(
                "reported_by",
                body.reported_by,
                req.user.company_id
            );

            if (reporter.error) {
                return res.status(reporter.error.status).json({
                    error: reporter.error.message
                });
            }

            updates.reported_by = reporter.userId;

        }

        if (fields.includes("assigned_to")) {

            const assignee = await resolveOptionalUserId(
                "assigned_to",
                body.assigned_to,
                req.user.company_id
            );

            if (assignee.error) {
                return res.status(assignee.error.status).json({
                    error: assignee.error.message
                });
            }

            updates.assigned_to = assignee.userId;

        }

        const columns = Object.keys(updates);

        const setClauses = columns.map((column, index) => {

            const placeholder = `$${index + 1}`;

            if (TIMESTAMP_FIELDS.has(column)) {
                return `${column} = ${placeholder}::timestamp`;
            }

            return `${column} = ${placeholder}`;

        });

        const values = columns.map((column) => updates[column]);

        values.push(id, req.user.company_id);

        const result = await db.query(
            returningIncident(`
                UPDATE incidents
                SET ${setClauses.join(", ")}
                WHERE id = $${values.length - 1}
                  AND company_id = $${values.length}
                RETURNING *
            `),
            values
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                error: "Incident not found"
            });
        }

        const incident = result.rows[0];

        if (fields.includes("assigned_to")
            && existing.rows[0].assigned_to !== incident.assigned_to
            && incident.assigned_to !== null) {
            await safelyNotifyIncidentUsers({
                companyId: req.user.company_id,
                incidentId: incident.id,
                userIds: [incident.assigned_to],
                type: "incident_assigned",
                subject: "Incident assigned",
                message: `Incident #${incident.id} was assigned to you.`,
                eventKey: `incident_assigned:${incident.id}:${incident.assigned_to}`,
            });
        }

        if (fields.includes("status")
            && existing.rows[0].status !== incident.status) {
            await safelyNotifyIncidentUsers({
                companyId: req.user.company_id,
                incidentId: incident.id,
                userIds: [incident.reported_by, incident.assigned_to],
                type: "incident_status_changed",
                subject: "Incident status changed",
                message: `Incident #${incident.id} status changed to ${incident.status}.`,
                eventKey: `incident_status_changed:${incident.id}:${incident.status}`,
            });
        }

        res.json({
            message: "Incident updated successfully",
            incident
        });

    } catch(error){

        handleError(error, res, "Failed to update incident");

    }

});


module.exports = router;
