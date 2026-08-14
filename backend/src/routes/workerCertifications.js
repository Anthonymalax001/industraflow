const express = require("express");
const db = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();


/*
    WORKER CERTIFICATIONS MODULE

    Every route in this file is protected by authMiddleware.

    A certification is a structured competency record belonging to one
    worker: what it is, who issued it, when it was issued and when it
    expires. Certifications attach ONLY to workers — no project,
    contractor or assignment is involved.

    Table: worker_certifications
    (id, company_id, worker_id, name, issuer, certificate_number,
     issued_date, expiry_date, document_url, status, created_at)

    Tenancy
    -------
    company_id is the tenant anchor and is NOT NULL. It always comes
    from the verified JWT (req.user.company_id) and is NEVER read from
    the body or query string.

    Migration 001 then makes cross-tenant contamination structurally
    impossible with a composite foreign key:

        (company_id, worker_id) -> workers (company_id, id) ON DELETE CASCADE

    Because the certification's own company_id is used on both sides of
    that key, the worker is forced to belong to the same company as the
    certification. We still verify ownership in application code so the
    caller gets a clean 404 instead of a raw constraint violation.

    Rules already enforced by the database (migration 001)
    -----------------------------------------------------
        worker_certifications_status_valid
            status IN ('valid','expired','revoked','pending')

        worker_certifications_dates_valid
            expiry_date IS NULL OR issued_date IS NULL
            OR expiry_date >= issued_date

    Those are NOT re-implemented here. The database stays the single
    source of truth and handleError() translates each violation into a
    useful 400 instead of leaking Postgres internals.

    Note there is no UNIQUE constraint on this table beyond the primary
    key, so duplicate certificate_number values are permitted and this
    module has no 409 conflict path.

    Two deliberate behaviours worth knowing about
    ---------------------------------------------
    1. Stored status is never changed automatically. The database has no
       trigger or job that expires a certification, so a row whose
       expiry_date has passed still reads status = 'valid' until someone
       updates it. Rather than silently rewriting stored data, every
       response carries two READ-ONLY derived fields computed in SQL:

           is_expired         expiry_date IS NOT NULL
                              AND expiry_date < CURRENT_DATE
           days_until_expiry  expiry_date - CURRENT_DATE,
                              or null when there is no expiry_date

       Those are computed per request and are never stored.

    2. issued_date and expiry_date are selected as ::text so responses
       return exactly the stored YYYY-MM-DD. The pg driver otherwise
       converts a DATE into a JS Date at LOCAL midnight, which then
       serialises to JSON shifted into the previous day on any server
       east of UTC. This cast is scoped to this module only; the global
       pg date parser is untouched, so projects and worker_assignments
       keep their existing behaviour.
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
    "name",
    "issuer",
    "certificate_number",
    "issued_date",
    "expiry_date",
    "document_url",
    "status"
];


// Certification states permitted by worker_certifications_status_valid.

const ALLOWED_STATUSES = [
    "valid",
    "expired",
    "revoked",
    "pending"
];


/*
    The state a "deleted" certification is moved into.

    See the DELETE route: certifications are revoked, never erased, so
    the compliance history survives.
*/

const REVOKED_STATUS = "revoked";


// Column widths from the schema, checked up front so the caller gets a
// clear message instead of a bare 22001 from Postgres.

const MAX_LENGTHS = {
    name: 255,
    issuer: 255,
    certificate_number: 100
};


// These need an explicit ::date cast when written through a dynamically
// built SET clause.

const DATE_FIELDS = new Set([
    "issued_date",
    "expiry_date"
]);


/*
    Every read returns the certification, the owning worker's details,
    and the two derived expiry fields.

    The join is additionally constrained on company_id. The outer WHERE
    already scopes to the caller's company, so this is redundant by
    design — it means a mistake in one predicate cannot by itself leak
    another tenant's row.

    Only columns that actually exist on these tables are selected.
*/

const CERTIFICATION_COLUMNS = `
        wc.id,
        wc.company_id,
        wc.worker_id,
        w.name            AS worker_name,
        w.employment_type AS worker_employment_type,
        w.status          AS worker_status,
        wc.name,
        wc.issuer,
        wc.certificate_number,
        wc.issued_date::text AS issued_date,
        wc.expiry_date::text AS expiry_date,
        wc.document_url,
        wc.status,
        wc.created_at,
        (
            wc.expiry_date IS NOT NULL
            AND wc.expiry_date < CURRENT_DATE
        ) AS is_expired,
        CASE
            WHEN wc.expiry_date IS NULL THEN NULL
            ELSE (wc.expiry_date - CURRENT_DATE)
        END AS days_until_expiry
`;

const CERTIFICATION_JOINS = `
    JOIN workers w
      ON w.id = wc.worker_id
     AND w.company_id = wc.company_id
`;

const BASE_SELECT = `
    SELECT ${CERTIFICATION_COLUMNS}
    FROM worker_certifications wc
    ${CERTIFICATION_JOINS}
`;


/*
    Writes wrap their INSERT/UPDATE in a CTE and then join, so a create
    or update returns exactly the same shape as a GET — including the
    derived fields — in one round trip.
*/

const returningJoined = (cte) => `
    WITH changed AS (
        ${cte}
    )
    SELECT ${CERTIFICATION_COLUMNS}
    FROM changed wc
    ${CERTIFICATION_JOINS}
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
    Parse a non-negative integer, used by the expiring_within_days
    filter where 0 is meaningful ("expiring today").

    Returns null when the value is not a valid count.
*/

const parseNonNegativeInt = (value) => {

    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 0) {
        return null;
    }

    return parsed;

};


/*
    Parse a boolean query flag. Accepts only "true" / "false" so a typo
    is reported rather than silently treated as false.
*/

const parseBooleanFlag = (value) => {

    if (value === "true") {
        return true;
    }

    if (value === "false") {
        return false;
    }

    return null;

};


/*
    Translate Postgres data errors into 4xx responses.

    The database owns the business rules; this is where each violation
    becomes an answer a client can act on. Anything we cannot explain
    is a genuine server fault (500).
*/

const handleError = (error, res, message) => {

    console.error(error);


    // 23514 = check violation. Name the rule that was broken.

    if (error.code === "23514") {

        if (error.constraint === "worker_certifications_dates_valid") {

            return res.status(400).json({
                error: "expiry_date must be on or after issued_date"
            });

        }

        if (error.constraint === "worker_certifications_status_valid") {

            return res.status(400).json({
                error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`
            });

        }

        return res.status(400).json({
            error: "Certification violates a database rule"
        });

    }


    /*
        23503 = foreign key violation.

        Ownership is verified before every write, so this is only
        reachable in a race (the worker was removed between the check
        and the write).
    */

    if (error.code === "23503") {

        return res.status(400).json({
            error: "Worker not found"
        });

    }


    // 22001 = value too long for the column.

    if (error.code === "22001") {

        return res.status(400).json({
            error: "A field value is longer than the column allows"
        });

    }


    // 23502 = not-null violation (e.g. name blanked out)
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

    Used on create, and on update when a certification is being moved
    to a different worker — without this check a user could attach a
    certification to another company's worker.
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
    Validate the fields every write shares.

    Returns an error string, or null when the payload is acceptable.
    Only the keys actually present are checked, so this serves both the
    full create and the partial update.

    Date ORDERING is deliberately not checked here — the database owns
    worker_certifications_dates_valid and handleError reports it.
*/

const validateCommonFields = (body, presentFields) => {

    // name is NOT NULL in the database.

    if (presentFields.includes("name")) {

        const name = body.name;

        if (!name || typeof name !== "string" || name.trim() === "") {
            return "Certification name is required";
        }

        if (name.trim().length > MAX_LENGTHS.name) {
            return `name must be ${MAX_LENGTHS.name} characters or fewer`;
        }

    }


    if (presentFields.includes("status")) {

        const status = body.status;

        if (!status || !ALLOWED_STATUSES.includes(status)) {
            return `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`;
        }

    }


    // Optional varchar fields: only length is our concern, and only
    // when a real value was supplied ("" / null clears them).

    for (const field of ["issuer", "certificate_number"]) {

        if (!presentFields.includes(field)) {
            continue;
        }

        const value = body[field];

        if (value !== null && value !== undefined && value !== "") {

            if (String(value).length > MAX_LENGTHS[field]) {
                return `${field} must be ${MAX_LENGTHS[field]} characters or fewer`;
            }

        }

    }


    return null;

};



/*
    CREATE CERTIFICATION

    POST /api/worker-certifications

    Body: worker_id (required), name (required), issuer,
          certificate_number, issued_date, expiry_date,
          document_url, status

    status is optional — the database defaults it to 'valid', and
    COALESCE below lets that default apply rather than sending an
    explicit NULL into a NOT NULL column.

    The worker is confirmed to belong to the authenticated company
    BEFORE the insert, which is what prevents a cross-tenant write.
*/

router.post("/", async (req, res) => {

    try {

        const {
            worker_id,
            name,
            issuer,
            certificate_number,
            issued_date,
            expiry_date,
            document_url,
            status
        } = req.body;


        // The worker must exist and belong to the caller's company.

        const worker = await resolveWorkerId(worker_id, req.user.company_id);


        if (worker.error) {

            return res.status(worker.error.status).json({
                error: worker.error.message
            });

        }


        // name is required on create even though the shared validator
        // only checks the keys that are present.

        if (!name || typeof name !== "string" || name.trim() === "") {

            return res.status(400).json({
                error: "Certification name is required"
            });

        }


        const presentFields = ALLOWED_FIELDS.filter(
            (field) => Object.prototype.hasOwnProperty.call(req.body, field)
        );


        const validationError = validateCommonFields(req.body, presentFields);


        if (validationError) {

            return res.status(400).json({
                error: validationError
            });

        }


        /*
            company_id comes from the verified token only.

            The date ordering rule is left to the database; handleError
            turns a violation into a 400.
        */

        const result = await db.query(
            returningJoined(`
                INSERT INTO worker_certifications
                (company_id, worker_id, name, issuer, certificate_number,
                 issued_date, expiry_date, document_url, status)
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6::date,
                    $7::date,
                    $8,
                    COALESCE($9, 'valid')
                )
                RETURNING *
            `),
            [
                req.user.company_id,   // $1 — from the token only
                worker.workerId,
                name.trim(),
                issuer || null,
                certificate_number || null,
                issued_date || null,
                expiry_date || null,
                document_url || null,
                status || null
            ]
        );


        res.status(201).json({
            message: "Worker certification created successfully",
            certification: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to create worker certification");

    }

});



/*
    LIST CERTIFICATIONS

    GET /api/worker-certifications
    GET /api/worker-certifications?worker_id=23
    GET /api/worker-certifications?status=valid
    GET /api/worker-certifications?expiring_within_days=30
    GET /api/worker-certifications?expired=true

    Returns only certifications belonging to the authenticated company.

    Every filter is optional and they combine with AND. Each one is
    parsed as a number, a boolean or checked against a whitelist before
    use, and all of them sit behind the company_id predicate — so a
    filter can only ever narrow the result set, never widen it past the
    tenant.

    Ordered soonest-expiry-first, which is the compliance view; rows
    with no expiry_date sort last.
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

            filters.push(`AND wc.worker_id = $${values.length}`);

        }


        if (req.query.status !== undefined) {

            const status = req.query.status;


            if (!ALLOWED_STATUSES.includes(status)) {

                return res.status(400).json({
                    error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`
                });

            }


            values.push(status);

            filters.push(`AND wc.status = $${values.length}`);

        }


        /*
            "Expiring within N days" means not yet expired but due on or
            before today + N. N = 0 is valid and means "expires today".

            Combined with ?status=valid this is served by the partial
            index idx_worker_certs_expiry (company_id, expiry_date)
            WHERE status = 'valid'.
        */

        if (req.query.expiring_within_days !== undefined) {

            const days = parseNonNegativeInt(req.query.expiring_within_days);


            if (days === null) {

                return res.status(400).json({
                    error: "expiring_within_days must be a non-negative integer"
                });

            }


            values.push(days);

            filters.push(`
                AND wc.expiry_date IS NOT NULL
                AND wc.expiry_date >= CURRENT_DATE
                AND wc.expiry_date <= CURRENT_DATE + ($${values.length}::int)
            `);

        }


        /*
            Filters on the DERIVED expiry state rather than the stored
            status, because the database never auto-expires a row.
        */

        if (req.query.expired !== undefined) {

            const expired = parseBooleanFlag(req.query.expired);


            if (expired === null) {

                return res.status(400).json({
                    error: "expired must be true or false"
                });

            }


            filters.push(
                expired
                    ? `AND wc.expiry_date IS NOT NULL AND wc.expiry_date < CURRENT_DATE`
                    : `AND (wc.expiry_date IS NULL OR wc.expiry_date >= CURRENT_DATE)`
            );

        }


        const result = await db.query(
            `
            ${BASE_SELECT}
            WHERE wc.company_id = $1
            ${filters.join(" ")}
            ORDER BY wc.expiry_date ASC NULLS LAST, wc.id DESC
            `,
            values
        );


        res.json({
            count: result.rowCount,
            certifications: result.rows
        });


    } catch(error){

        handleError(error, res, "Failed to fetch worker certifications");

    }

});



/*
    GET SINGLE CERTIFICATION

    GET /api/worker-certifications/:id

    The company_id in the WHERE clause is what enforces ownership. A
    certification belonging to another company returns 404, not 403, so
    we never confirm that someone else's record exists.
*/

router.get("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid certification id"
            });

        }


        const result = await db.query(
            `
            ${BASE_SELECT}
            WHERE wc.id = $1 AND wc.company_id = $2
            `,
            [id, req.user.company_id]
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Worker certification not found"
            });

        }


        res.json({
            certification: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to fetch worker certification");

    }

});



/*
    UPDATE CERTIFICATION

    PUT /api/worker-certifications/:id

    Supports partial updates: only the fields present in the request
    body are written. The SET clause is built from a fixed whitelist
    and all values stay parameterised, so this is not SQL-injectable.

    Moving the certification to a different worker is allowed, but the
    destination worker must belong to the caller's company, so a
    cross-company move is impossible. company_id itself is not
    writable, and the composite foreign key enforces the same rule at
    the database level.
*/

router.put("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid certification id"
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
            Confirm the certification exists inside this company first,
            so a foreign id is reported as 404 before any other work.
        */

        const existing = await db.query(
            `
            SELECT id
            FROM worker_certifications
            WHERE id = $1 AND company_id = $2
            `,
            [id, req.user.company_id]
        );


        if (existing.rowCount === 0) {

            return res.status(404).json({
                error: "Worker certification not found"
            });

        }


        const validationError = validateCommonFields(req.body, fields);


        if (validationError) {

            return res.status(400).json({
                error: validationError
            });

        }


        // Column -> value map. Keys come from the whitelist only.

        const updates = {};


        for (const field of fields) {

            if (field === "worker_id") {
                continue;   // resolved and authorised below
            }


            const value = req.body[field];


            if (field === "name") {
                updates.name = value.trim();
                continue;
            }


            // Allow explicitly clearing optional fields with null / "".

            updates[field] = value === "" ? null : value;

        }


        // Moving the certification to another worker.

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


        /*
            Build "name = $1, expiry_date = $2::date, ..." from the
            whitelist. The date columns carry an explicit cast so a
            text parameter is never ambiguous.
        */

        const columns = Object.keys(updates);

        const setClauses = columns.map((column, index) => {

            const placeholder = `$${index + 1}`;

            return DATE_FIELDS.has(column)
                ? `${column} = ${placeholder}::date`
                : `${column} = ${placeholder}`;

        });

        const values = columns.map((column) => updates[column]);


        // The last two placeholders scope the update to this company,
        // so ownership is enforced in the SQL and not only by the
        // SELECT above.

        values.push(id, req.user.company_id);


        const result = await db.query(
            returningJoined(`
                UPDATE worker_certifications
                SET ${setClauses.join(", ")}
                WHERE id = $${values.length - 1}
                  AND company_id = $${values.length}
                RETURNING *
            `),
            values
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Worker certification not found"
            });

        }


        res.json({
            message: "Worker certification updated successfully",
            certification: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to update worker certification");

    }

});



/*
    REVOKE CERTIFICATION

    DELETE /api/worker-certifications/:id

    This revokes the certification instead of physically deleting it.
    A competency record is compliance evidence: auditors need to see
    that a certification once existed and when it stopped being
    honoured, so the row is kept and only its status changes.

    'revoked' is one of the four states the schema already allows, and
    this matches DELETE on /api/workers (deactivates) and on
    /api/worker-assignments (cancels).

    The company_id predicate scopes the update, so another company's
    certification simply matches zero rows and reads back as 404.

    The call is idempotent: revoking an already-revoked certification
    succeeds and returns the unchanged row.
*/

router.delete("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid certification id"
            });

        }


        const result = await db.query(
            returningJoined(`
                UPDATE worker_certifications
                SET status = $1
                WHERE id = $2 AND company_id = $3
                RETURNING *
            `),
            [REVOKED_STATUS, id, req.user.company_id]
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Worker certification not found"
            });

        }


        res.json({
            message: "Worker certification revoked successfully",
            certification: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to revoke worker certification");

    }

});


module.exports = router;
