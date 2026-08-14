const express = require("express");
const db = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();


/*
    WORKER ASSIGNMENTS MODULE

    Every route in this file is protected by authMiddleware.

    An assignment is the *deployment* of a worker onto a project. It is
    many-to-many and time-bounded, which is why it lives in its own
    table rather than as a column on workers.

    Table: worker_assignments
    (id, company_id, worker_id, project_id, role,
     start_date, end_date, status, created_at)

    Tenancy
    -------
    company_id is the tenant anchor and is NOT NULL. It always comes
    from the verified JWT (req.user.company_id) and is NEVER read from
    the body or query string.

    Migration 001 then makes cross-tenant contamination structurally
    impossible with two composite foreign keys:

        (company_id, worker_id)  -> workers  (company_id, id)  ON DELETE CASCADE
        (company_id, project_id) -> projects (company_id, id)  ON DELETE RESTRICT

    Because the assignment's own company_id is used on BOTH sides, the
    worker and the project are forced to belong to the same company as
    the assignment. A Company A worker therefore cannot be deployed to
    a Company B project even if the checks below were removed.

    We still verify ownership in application code so the caller gets a
    clean 404 instead of a raw constraint violation.

    Rules already enforced by the database (migration 001)
    -----------------------------------------------------
        worker_assignments_status_valid
            status IN ('active','completed','cancelled')

        worker_assignments_dates_valid
            end_date IS NULL OR end_date >= start_date

        worker_assignments_active_key   (partial UNIQUE index)
            UNIQUE (worker_id, project_id) WHERE status = 'active'
            -> a worker cannot hold two concurrent ACTIVE assignments
               on the same project

    Those are NOT re-implemented here. The database stays the single
    source of truth and handleError() translates each violation into a
    useful 400 / 409 instead of leaking Postgres internals.
*/


// Apply authentication to every route registered below.

router.use(authMiddleware);


/*
    Fields a client is allowed to write.

    Anything else in the request body is ignored, so a client can never
    set id, created_at or — most importantly — company_id.
*/

const ALLOWED_FIELDS = [
    "worker_id",
    "project_id",
    "role",
    "start_date",
    "end_date",
    "status"
];


// Assignment states permitted by worker_assignments_status_valid.

const ALLOWED_STATUSES = [
    "active",
    "completed",
    "cancelled"
];


/*
    The state a "deleted" assignment is moved into.

    See the DELETE route: assignments are ended, never erased.
*/

const CANCELLED_STATUS = "cancelled";


/*
    Every read returns the assignment plus the worker and project names,
    so a client does not have to resolve ids itself.

    Both joins are additionally constrained on company_id. The outer
    WHERE already scopes to the caller's company, so this is redundant
    by design — it means a mistake in one predicate cannot by itself
    leak another tenant's row.

    Only columns that actually exist on these tables are selected.
*/

const ASSIGNMENT_COLUMNS = `
        wa.id,
        wa.company_id,
        wa.worker_id,
        w.name            AS worker_name,
        w.employment_type AS worker_employment_type,
        w.status          AS worker_status,
        wa.project_id,
        p.name            AS project_name,
        p.status          AS project_status,
        wa.role,
        wa.start_date,
        wa.end_date,
        wa.status,
        wa.created_at
`;

const ASSIGNMENT_JOINS = `
    JOIN workers w
      ON w.id = wa.worker_id
     AND w.company_id = wa.company_id
    JOIN projects p
      ON p.id = wa.project_id
     AND p.company_id = wa.company_id
`;

const BASE_SELECT = `
    SELECT ${ASSIGNMENT_COLUMNS}
    FROM worker_assignments wa
    ${ASSIGNMENT_JOINS}
`;


/*
    Writes wrap their INSERT/UPDATE in a CTE and then join, so a create
    or update returns exactly the same shape as a GET in one round trip.
*/

const returningJoined = (cte) => `
    WITH changed AS (
        ${cte}
    )
    SELECT ${ASSIGNMENT_COLUMNS}
    FROM changed wa
    ${ASSIGNMENT_JOINS}
`;


/*
    Validate and parse an integer id.

    Returns a positive integer, or null when the value is not
    a valid id. This stops malformed ids from ever reaching
    Postgres and causing a 500.
*/

const parseId = (value) => {

    const id = Number(value);

    if (!Number.isInteger(id) || id < 1) {
        return null;
    }

    return id;

};


/*
    Translate Postgres data errors into 4xx responses.

    The database owns the business rules; this is where each violation
    becomes an answer a client can act on. Anything we cannot explain
    is a genuine server fault (500).
*/

const handleError = (error, res, message) => {

    console.error(error);


    /*
        23505 = unique violation.

        The only unique index a client can collide with is
        worker_assignments_active_key, i.e. this worker already has an
        ACTIVE assignment on this project. 409 rather than 400: the
        body is well formed, it just conflicts with existing state.
    */

    if (error.code === "23505") {

        if (error.constraint === "worker_assignments_active_key") {

            return res.status(409).json({
                error: "This worker already has an active assignment on this project"
            });

        }

        return res.status(409).json({
            error: "Assignment conflicts with an existing record"
        });

    }


    // 23514 = check violation. Name the rule that was broken.

    if (error.code === "23514") {

        if (error.constraint === "worker_assignments_dates_valid") {

            return res.status(400).json({
                error: "end_date must be on or after start_date"
            });

        }

        if (error.constraint === "worker_assignments_status_valid") {

            return res.status(400).json({
                error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`
            });

        }

        return res.status(400).json({
            error: "Assignment violates a database rule"
        });

    }


    /*
        23503 = foreign key violation.

        Both routes verify ownership before writing, so this is only
        reachable in a race (the worker or project was removed between
        the check and the write). Report it as a bad reference.
    */

    if (error.code === "23503") {

        if (error.constraint === "worker_assignments_worker_fkey") {

            return res.status(400).json({
                error: "Worker not found"
            });

        }

        if (error.constraint === "worker_assignments_project_fkey") {

            return res.status(400).json({
                error: "Project not found"
            });

        }

        return res.status(400).json({
            error: "Assignment references a record that does not exist"
        });

    }


    // 23502 = not-null violation (e.g. start_date blanked out)
    // 22007 / 22008 = invalid or out-of-range date
    // 22P02        = invalid text representation (bad number, etc.)

    if (["23502", "22007", "22008", "22P02"].includes(error.code)) {

        return res.status(400).json({
            error: "Invalid field value in request body"
        });

    }


    return res.status(500).json({
        error: message
    });

};


/*
    Confirm a worker exists AND belongs to the caller's company.

    Used on create, and on update when an assignment is being moved to
    a different worker — without this check a user could deploy another
    company's worker.
*/

const companyOwnsWorker = async (workerId, companyId) => {

    const result = await db.query(
        `
        SELECT id
        FROM workers
        WHERE id = $1 AND company_id = $2
        `,
        [workerId, companyId]
    );

    return result.rowCount > 0;

};


/*
    Confirm a project exists AND belongs to the caller's company.

    This is the check that stops a Company A worker being assigned to
    a Company B project.
*/

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


/*
    Resolve and authorise a worker_id coming from a request body.

    Returns { error } for a bad or foreign id, otherwise { workerId }.
    404 rather than 403 so we never confirm that another company's
    worker exists.
*/

const resolveWorkerId = async (rawWorkerId, companyId) => {

    const workerId = parseId(rawWorkerId);


    if (!workerId) {
        return { error: { status: 400, message: "A valid worker_id is required" } };
    }


    const owned = await companyOwnsWorker(workerId, companyId);


    if (!owned) {
        return { error: { status: 404, message: "Worker not found" } };
    }


    return { workerId };

};


/*
    Resolve and authorise a project_id coming from a request body.

    Returns { error } for a bad or foreign id, otherwise { projectId }.
*/

const resolveProjectId = async (rawProjectId, companyId) => {

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



/*
    CREATE ASSIGNMENT

    POST /api/worker-assignments

    Body: worker_id (required), project_id (required),
          role, start_date, end_date, status

    start_date and status are optional — the database defaults them to
    CURRENT_DATE and 'active', and COALESCE below lets those defaults
    apply rather than sending an explicit NULL into a NOT NULL column.

    Both the worker and the project are confirmed to belong to the
    authenticated company BEFORE the insert, which is what prevents a
    cross-company deployment.
*/

router.post("/", async (req, res) => {

    try {

        const {
            worker_id,
            project_id,
            role,
            start_date,
            end_date,
            status
        } = req.body;


        // The worker must exist and belong to the caller's company.

        const worker = await resolveWorkerId(worker_id, req.user.company_id);


        if (worker.error) {

            return res.status(worker.error.status).json({
                error: worker.error.message
            });

        }


        // The project must exist and belong to the caller's company.

        const project = await resolveProjectId(project_id, req.user.company_id);


        if (project.error) {

            return res.status(project.error.status).json({
                error: project.error.message
            });

        }


        if (status !== undefined && !ALLOWED_STATUSES.includes(status)) {

            return res.status(400).json({
                error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`
            });

        }


        /*
            company_id comes from the verified token only.

            The date ordering rule and the duplicate-active-assignment
            rule are left to the database; handleError turns either
            violation into a 400 / 409.
        */

        const result = await db.query(
            returningJoined(`
                INSERT INTO worker_assignments
                (company_id, worker_id, project_id, role, start_date, end_date, status)
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    COALESCE($5::date, CURRENT_DATE),
                    $6::date,
                    COALESCE($7, 'active')
                )
                RETURNING *
            `),
            [
                req.user.company_id,   // $1 — from the token only
                worker.workerId,
                project.projectId,
                role || null,
                start_date || null,
                end_date || null,
                status || null
            ]
        );


        res.status(201).json({
            message: "Worker assignment created successfully",
            assignment: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to create worker assignment");

    }

});



/*
    LIST ASSIGNMENTS

    GET /api/worker-assignments
    GET /api/worker-assignments?worker_id=24
    GET /api/worker-assignments?project_id=2
    GET /api/worker-assignments?status=active

    Returns only assignments belonging to the authenticated company.

    Every filter is optional and they combine with AND. Each one is
    parsed as an integer or checked against a whitelist before use, and
    all of them sit behind the company_id predicate — so a filter can
    only ever narrow the result set, never widen it past the tenant.
*/

router.get("/", async (req, res) => {

    try {

        const values = [req.user.company_id];

        const filters = [];


        if (req.query.worker_id !== undefined) {

            const workerId = parseId(req.query.worker_id);


            if (!workerId) {

                return res.status(400).json({
                    error: "Invalid worker_id"
                });

            }


            values.push(workerId);

            filters.push(`AND wa.worker_id = $${values.length}`);

        }


        if (req.query.project_id !== undefined) {

            const projectId = parseId(req.query.project_id);


            if (!projectId) {

                return res.status(400).json({
                    error: "Invalid project_id"
                });

            }


            values.push(projectId);

            filters.push(`AND wa.project_id = $${values.length}`);

        }


        if (req.query.status !== undefined) {

            const status = req.query.status;


            if (!ALLOWED_STATUSES.includes(status)) {

                return res.status(400).json({
                    error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`
                });

            }


            values.push(status);

            filters.push(`AND wa.status = $${values.length}`);

        }


        const result = await db.query(
            `
            ${BASE_SELECT}
            WHERE wa.company_id = $1
            ${filters.join(" ")}
            ORDER BY wa.start_date DESC, wa.id DESC
            `,
            values
        );


        res.json({
            count: result.rowCount,
            assignments: result.rows
        });


    } catch(error){

        handleError(error, res, "Failed to fetch worker assignments");

    }

});



/*
    GET SINGLE ASSIGNMENT

    GET /api/worker-assignments/:id

    The company_id in the WHERE clause is what enforces ownership. An
    assignment belonging to another company returns 404, not 403, so we
    never confirm that someone else's record exists.
*/

router.get("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid assignment id"
            });

        }


        const result = await db.query(
            `
            ${BASE_SELECT}
            WHERE wa.id = $1 AND wa.company_id = $2
            `,
            [id, req.user.company_id]
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Worker assignment not found"
            });

        }


        res.json({
            assignment: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to fetch worker assignment");

    }

});



/*
    UPDATE ASSIGNMENT

    PUT /api/worker-assignments/:id

    Supports partial updates: only the fields present in the request
    body are written. The SET clause is built from a fixed whitelist
    and all values stay parameterised, so this is not SQL-injectable.

    Reassigning worker_id or project_id is allowed, but the destination
    worker AND project must both belong to the caller's company, so a
    cross-company reassignment is impossible. company_id itself is not
    writable, and the composite foreign keys enforce the same rule at
    the database level.

    Setting status back to 'active' can collide with the partial unique
    index; that surfaces as a 409.
*/

router.put("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid assignment id"
            });

        }


        // Keep only the fields the client is actually allowed to change.

        const fields = ALLOWED_FIELDS.filter(
            (field) => Object.prototype.hasOwnProperty.call(req.body, field)
        );


        if (fields.length === 0) {

            return res.status(400).json({
                error: `Provide at least one field to update: ${ALLOWED_FIELDS.join(", ")}`
            });

        }


        /*
            Confirm the assignment exists inside this company first, so
            a foreign id is reported as 404 before we do any other work.
        */

        const existing = await db.query(
            `
            SELECT id
            FROM worker_assignments
            WHERE id = $1 AND company_id = $2
            `,
            [id, req.user.company_id]
        );


        if (existing.rowCount === 0) {

            return res.status(404).json({
                error: "Worker assignment not found"
            });

        }


        if (fields.includes("status")) {

            const status = req.body.status;

            if (!status || !ALLOWED_STATUSES.includes(status)) {

                return res.status(400).json({
                    error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`
                });

            }

        }


        // start_date is NOT NULL — reject an attempt to blank it out.

        if (fields.includes("start_date")) {

            const startDate = req.body.start_date;

            if (startDate === null || startDate === "") {

                return res.status(400).json({
                    error: "start_date cannot be empty"
                });

            }

        }


        // Column -> value map. Keys come from the whitelist only.

        const updates = {};


        for (const field of fields) {

            if (field === "worker_id" || field === "project_id") {
                continue;   // resolved and authorised below
            }


            const value = req.body[field];


            // Allow explicitly clearing optional fields with null / "".

            updates[field] = value === "" ? null : value;

        }


        // Moving the assignment to another worker.

        if (fields.includes("worker_id")) {

            const worker = await resolveWorkerId(
                req.body.worker_id,
                req.user.company_id
            );


            if (worker.error) {

                return res.status(worker.error.status).json({
                    error: worker.error.message
                });

            }


            updates.worker_id = worker.workerId;

        }


        // Moving the assignment to another project.

        if (fields.includes("project_id")) {

            const project = await resolveProjectId(
                req.body.project_id,
                req.user.company_id
            );


            if (project.error) {

                return res.status(project.error.status).json({
                    error: project.error.message
                });

            }


            updates.project_id = project.projectId;

        }


        // Build "role = $1, status = $2, ..." from the whitelist.

        const columns = Object.keys(updates);

        const setClauses = columns.map(
            (column, index) => `${column} = $${index + 1}`
        );

        const values = columns.map((column) => updates[column]);


        // The last two placeholders scope the update to this company,
        // so ownership is enforced in the SQL and not only by the
        // SELECT above.

        values.push(id, req.user.company_id);


        const result = await db.query(
            returningJoined(`
                UPDATE worker_assignments
                SET ${setClauses.join(", ")}
                WHERE id = $${values.length - 1}
                  AND company_id = $${values.length}
                RETURNING *
            `),
            values
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Worker assignment not found"
            });

        }


        res.json({
            message: "Worker assignment updated successfully",
            assignment: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to update worker assignment");

    }

});



/*
    END (CANCEL) ASSIGNMENT

    DELETE /api/worker-assignments/:id

    This ends the assignment instead of physically deleting it. That is
    what the schema asks for, not a preference:

      * status already carries a 'cancelled' value, so the table has a
        terminal state for a revoked deployment.

      * worker_assignments_active_key is a PARTIAL unique index scoped
        to status = 'active'. Cancelling therefore releases the slot
        and the worker can be re-assigned to the same project — which
        only makes sense if cancelling, not deleting, is the intended
        way to withdraw an assignment.

      * the project foreign key is ON DELETE RESTRICT, i.e. migration
        001 deliberately preserves deployment history rather than
        letting it be cleaned up.

    It also matches DELETE /api/workers/:id, which deactivates.

    end_date is closed off at the same time, but only if it was still
    open. GREATEST(start_date, CURRENT_DATE) guarantees the result
    never violates worker_assignments_dates_valid, even for an
    assignment whose start_date is in the future.

    The company_id predicate scopes the update, so another company's
    assignment simply matches zero rows and reads back as 404.

    The call is idempotent: cancelling an already-cancelled assignment
    succeeds and returns the unchanged row.
*/

router.delete("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid assignment id"
            });

        }


        const result = await db.query(
            returningJoined(`
                UPDATE worker_assignments
                SET status = $1,
                    end_date = COALESCE(end_date, GREATEST(start_date, CURRENT_DATE))
                WHERE id = $2 AND company_id = $3
                RETURNING *
            `),
            [CANCELLED_STATUS, id, req.user.company_id]
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Worker assignment not found"
            });

        }


        res.json({
            message: "Worker assignment cancelled successfully",
            assignment: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to cancel worker assignment");

    }

});


module.exports = router;
