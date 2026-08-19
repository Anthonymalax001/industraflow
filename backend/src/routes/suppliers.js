const express = require("express");
const db = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();


/*
    SUPPLIERS MODULE

    Every route in this file is protected by authMiddleware.

    A supplier is a vendor the company buys goods or services from. It
    is a COMPANY-level master record, not a project-level one: the same
    supplier may eventually serve many projects, so there is no
    project_id column and no project_suppliers join table yet. Migration
    002 adds the composite-FK target that will let that be built later.

    Table: suppliers
    (id, company_id, name, service_type, contact_person, email, phone,
     verification_status, status, created_at)

    Tenancy
    -------
    company_id is the tenant anchor and is NOT NULL. It always comes
    from the verified JWT (req.user.company_id) and is NEVER read from
    the body or query string. It is absent from ALLOWED_FIELDS, so a
    client can neither file a supplier under another company nor move
    one between companies.

    Every SELECT, UPDATE and DELETE carries "AND company_id = $n", and
    a miss reads back as 404 rather than 403 — we never confirm that
    another company's supplier exists.

    Two orthogonal status columns
    -----------------------------
        status               active | inactive
                             Lifecycle: "is this supplier still on our
                             books?" This is what DELETE sets to
                             'inactive' (soft delete).

        verification_status  pending | verified | expired | rejected
                             Vetting progress. Never touched by DELETE.

    They are kept apart on purpose. Folding them into one column would
    make a deactivated supplier indistinguishable from a rejected one.

    Rules already enforced by the database (migration 002)
    ------------------------------------------------------
        suppliers_status_valid
            status IN ('active','inactive')

        suppliers_verification_status_valid
            verification_status IN ('pending','verified','expired','rejected')

        suppliers_company_name_key   (UNIQUE index)
            UNIQUE (company_id, lower(btrim(name)))
            -> one supplier name per company, compared
               case-insensitively and ignoring surrounding whitespace,
               so 'ABC Ltd', 'abc ltd' and '  ABC LTD  ' collide

    The database stays the single source of truth for those rules. The
    validation below exists so a caller gets a clear message before the
    round trip, and handleError() translates any violation that still
    reaches Postgres into a useful 4xx instead of leaking internals.

    Note the name index is NOT partial on status: a deactivated
    supplier keeps its name reserved, and the way back is
    PUT status = 'active' rather than a second row.
*/


// Apply authentication to every route registered below.

router.use(authMiddleware);


/*
    Fields a client is allowed to change on an update.

    Anything else in the request body is ignored, so a client can never
    set id, created_at or — most importantly — company_id.
*/

const ALLOWED_FIELDS = [
    "name",
    "service_type",
    "contact_person",
    "email",
    "phone",
    "verification_status",
    "status"
];


/*
    Fields a client is allowed to set on create.

    status is deliberately absent: a new supplier always starts
    'active' (the database default). Deactivating is what DELETE is
    for, and creating a supplier that is already inactive has no
    meaning. A status sent to POST is ignored rather than rejected,
    which is how every other module in this codebase treats a field
    outside its whitelist.
*/

const CREATE_FIELDS = [
    "name",
    "service_type",
    "contact_person",
    "email",
    "phone",
    "verification_status"
];


// Lifecycle states permitted by suppliers_status_valid.

const ALLOWED_STATUSES = [
    "active",
    "inactive"
];


// Vetting states permitted by suppliers_verification_status_valid.

const ALLOWED_VERIFICATION_STATUSES = [
    "pending",
    "verified",
    "expired",
    "rejected"
];


// The state a "deleted" supplier is moved into. Supplier records are
// never physically removed — see the DELETE route.

const INACTIVE_STATUS = "inactive";


// Column widths from the schema, checked up front so the caller gets a
// clear message instead of a bare 22001 from Postgres.

const MAX_LENGTHS = {
    name: 255,
    service_type: 100,
    contact_person: 255,
    email: 255,
    phone: 50
};


/*
    Connection-level failures.

    These are not the caller's fault and they are not permanent, so
    they read back as 503 rather than 500. Neon in particular scales
    its compute to zero and a cold start surfaces here as ETIMEDOUT or
    ECONNRESET on the first request.

    The SQLSTATE entries cover the server-side half of the same story:
    class 08 is "connection exception", 57P01 is the server shutting
    down under us and 57P03 is it not being ready yet.
*/

const CONNECTION_ERROR_CODES = new Set([
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EPIPE",
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


/*
    Every read returns the same explicit column list.

    Selecting the columns by name rather than with SELECT * means the
    response shape is stable even if a later migration adds a column,
    and it keeps GET, POST and PUT returning identical objects.
*/

const SUPPLIER_COLUMNS = `
        s.id,
        s.company_id,
        s.name,
        s.service_type,
        s.contact_person,
        s.email,
        s.phone,
        s.verification_status,
        s.status,
        s.created_at
`;

const BASE_SELECT = `
    SELECT ${SUPPLIER_COLUMNS}
    FROM suppliers s
`;


/*
    Writes wrap their INSERT/UPDATE in a CTE and then re-select, so a
    create or update returns exactly the same shape as a GET in one
    round trip.

    Suppliers have no parent to join beyond companies — which is the
    caller's own company and so adds nothing — hence there is no join
    clause here. The wrapper still earns its place: it guarantees the
    column list cannot drift between reads and writes.
*/

const returningSupplier = (cte) => `
    WITH changed AS (
        ${cte}
    )
    SELECT ${SUPPLIER_COLUMNS}
    FROM changed s
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
    Read the request body as an object, whatever the client sent.

    express.json() does NOT guarantee req.body is set. Express 5 ships
    body-parser 2, which sets req.body = undefined and returns early
    whenever it declines to parse — a request with no body at all, or
    one whose Content-Type is not application/json (Postman's "raw /
    Text" mode being the usual way to hit this by accident). Express 4's
    body-parser 1 handed the route an empty object in that situation, so
    code that reads req.body directly is safe there and throws here.

    Normalising to {} restores that behaviour for this module alone,
    without touching the app-level middleware or any other route file.
    It is a normalisation, not a relaxation: an empty object carries no
    fields, so the caller lands on the SAME "no fields to update" /
    "name is required" 400 the route already returns instead of a 500.

    A non-object body is treated the same way. strict JSON parsing means
    a bare array is the only such value that can arrive, and an array
    carries no named supplier fields either.
*/

const getBody = (req) => {

    const body = req.body;


    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return {};
    }


    return body;

};


// Light-touch email check, matching contractors.js. We only reject
// values that are obviously not addresses rather than trying to be
// exhaustive.

const isValidEmail = (value) => {

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

};


/*
    Escape the LIKE metacharacters in a ?search= term.

    Without this a search for "50%" or "a_b" would be read as a
    wildcard pattern and quietly match far more than the caller asked
    for. Backslash is Postgres' default LIKE escape character, so
    escaping it plus % and _ is enough.
*/

const escapeLikePattern = (value) => {

    return value.replace(/[\\%_]/g, (character) => `\\${character}`);

};


/*
    Is this a transient connectivity failure rather than a data fault?

    A dual-stack connect attempt wraps the real causes in an
    AggregateError whose own code is undefined, so the nested errors
    are checked too — see the same handling in db.js.
*/

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


/*
    Translate Postgres data errors into 4xx responses.

    The database owns the business rules; this is where each violation
    becomes an answer a client can act on. Anything we cannot explain
    is a genuine server fault (500).
*/

const handleError = (error, res, message) => {

    console.error(error);


    /*
        The database is unreachable or still waking up. Not the
        caller's fault and not permanent, so 503 with an invitation to
        retry rather than a flat 500.
    */

    if (isConnectionError(error)) {

        return res.status(503).json({
            error: "Database temporarily unavailable, please retry"
        });

    }


    /*
        23505 = unique violation.

        The only unique index a client can collide with is
        suppliers_company_name_key, which is scoped per company — so
        the clash is always with a supplier the caller can already see.
        409 rather than 400: the body is well formed, it just conflicts
        with existing state.

        The message mentions the deactivated case because the index is
        not partial on status, so a soft-deleted supplier still holds
        its name.
    */

    if (error.code === "23505") {

        if (error.constraint === "suppliers_company_name_key") {

            return res.status(409).json({
                error: "A supplier with this name already exists for this company"
            });

        }

        return res.status(409).json({
            error: "Supplier conflicts with an existing record"
        });

    }


    // 23514 = check violation. Name the rule that was broken.

    if (error.code === "23514") {

        if (error.constraint === "suppliers_status_valid") {

            return res.status(400).json({
                error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`
            });

        }

        if (error.constraint === "suppliers_verification_status_valid") {

            return res.status(400).json({
                error: `verification_status must be one of: ${ALLOWED_VERIFICATION_STATUSES.join(", ")}`
            });

        }

        return res.status(400).json({
            error: "Supplier violates a database rule"
        });

    }


    /*
        23503 = foreign key violation.

        The only client-reachable reference on this table is
        company_id, which comes from the verified token — so this is
        only reachable in a race where the company was deleted between
        authentication and the write.
    */

    if (error.code === "23503") {

        return res.status(400).json({
            error: "Company not found"
        });

    }


    // 22001 = value too long for the column.

    if (error.code === "22001") {

        return res.status(400).json({
            error: "A field value is longer than the column allows"
        });

    }


    // 23502 = not-null violation (e.g. name blanked out)
    // 22P02 = invalid text representation (bad number, etc.)

    if (["23502", "22P02"].includes(error.code)) {

        return res.status(400).json({
            error: "Invalid field value in request body"
        });

    }


    return res.status(500).json({
        error: message
    });

};


/*
    Validate the fields every write shares.

    Returns an error string, or null when the payload is acceptable.
    Only the keys actually present are checked, so this serves both the
    full create and the partial update.
*/

const validateCommonFields = (body, presentFields) => {

    // name is NOT NULL in the database.

    if (presentFields.includes("name")) {

        const name = body.name;

        if (!name || typeof name !== "string" || name.trim() === "") {
            return "Supplier name is required";
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


    if (presentFields.includes("verification_status")) {

        const verificationStatus = body.verification_status;

        if (!verificationStatus || !ALLOWED_VERIFICATION_STATUSES.includes(verificationStatus)) {
            return `verification_status must be one of: ${ALLOWED_VERIFICATION_STATUSES.join(", ")}`;
        }

    }


    // email is optional, so only a real value is validated — "" and
    // null clear the field.

    if (presentFields.includes("email")) {

        const email = body.email;

        if (email !== null && email !== undefined && email !== "") {

            if (String(email).length > MAX_LENGTHS.email) {
                return `email must be ${MAX_LENGTHS.email} characters or fewer`;
            }

            if (!isValidEmail(String(email))) {
                return "Invalid email address";
            }

        }

    }


    // The remaining optional varchar fields: only length is our
    // concern, and only when a real value was supplied.

    for (const field of ["service_type", "contact_person", "phone"]) {

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
    CREATE SUPPLIER

    POST /api/suppliers

    Body: name (required), service_type, contact_person, email, phone,
          verification_status

    company_id is taken from the verified token and is never read from
    the body. status is not accepted either: a new supplier always
    starts 'active' via the database default.

    verification_status is optional — the database defaults it to
    'pending', and COALESCE below lets that default apply rather than
    sending an explicit NULL into a NOT NULL column.
*/

router.post("/", async (req, res) => {

    try {

        const body = getBody(req);


        const {
            name,
            service_type,
            contact_person,
            email,
            phone,
            verification_status
        } = body;


        // name is required on create even though the shared validator
        // only checks the keys that are present.

        if (!name || typeof name !== "string" || name.trim() === "") {

            return res.status(400).json({
                error: "Supplier name is required"
            });

        }


        // Only validate what was sent, and only from the create
        // whitelist — a stray status or company_id is ignored.

        const presentFields = CREATE_FIELDS.filter(
            (field) => Object.prototype.hasOwnProperty.call(body, field)
        );


        const validationError = validateCommonFields(body, presentFields);


        if (validationError) {

            return res.status(400).json({
                error: validationError
            });

        }


        /*
            company_id is the tenant anchor and is NOT NULL in the
            database. It always comes from the verified JWT, never from
            req.body.

            The duplicate-name rule is left to the database;
            handleError turns a violation into a 409.
        */

        const result = await db.query(
            returningSupplier(`
                INSERT INTO suppliers
                (company_id, name, service_type, contact_person, email,
                 phone, verification_status)
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    COALESCE($7, 'pending')
                )
                RETURNING *
            `),
            [
                req.user.company_id,   // $1 — from the token only
                name.trim(),
                service_type || null,
                contact_person || null,
                email || null,
                phone || null,
                verification_status || null
            ]
        );


        res.status(201).json({
            message: "Supplier created successfully",
            supplier: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to create supplier");

    }

});



/*
    LIST SUPPLIERS

    GET /api/suppliers
    GET /api/suppliers?service_type=Bulk%20Materials
    GET /api/suppliers?verification_status=verified
    GET /api/suppliers?status=active
    GET /api/suppliers?search=cement

    Returns only suppliers belonging to the authenticated company.

    Every filter is optional and they combine with AND. Each one is
    checked against a whitelist or normalised before use, and all of
    them sit behind the company_id predicate — so a filter can only
    ever narrow the result set, never widen it past the tenant.

    service_type matches case-insensitively but exactly; ?search= is
    the fuzzy one, matching a substring of the supplier name, the
    contact person or the email.

    No implicit status filter is applied: an unfiltered list returns
    active and inactive suppliers alike, and a client that wants only
    the live ones asks for ?status=active.
*/

router.get("/", async (req, res) => {

    try {

        const values = [req.user.company_id];

        const filters = [];


        if (req.query.service_type !== undefined) {

            const serviceType = String(req.query.service_type).trim();


            if (serviceType === "") {

                return res.status(400).json({
                    error: "service_type cannot be empty"
                });

            }


            values.push(serviceType);

            filters.push(`AND lower(btrim(s.service_type)) = lower($${values.length})`);

        }


        if (req.query.verification_status !== undefined) {

            const verificationStatus = req.query.verification_status;


            if (!ALLOWED_VERIFICATION_STATUSES.includes(verificationStatus)) {

                return res.status(400).json({
                    error: `verification_status must be one of: ${ALLOWED_VERIFICATION_STATUSES.join(", ")}`
                });

            }


            values.push(verificationStatus);

            filters.push(`AND s.verification_status = $${values.length}`);

        }


        if (req.query.status !== undefined) {

            const status = req.query.status;


            if (!ALLOWED_STATUSES.includes(status)) {

                return res.status(400).json({
                    error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`
                });

            }


            values.push(status);

            filters.push(`AND s.status = $${values.length}`);

        }


        /*
            Free-text search across the three human-readable fields.

            The term is escaped before it becomes a LIKE pattern, so a
            literal % or _ in the search box matches itself instead of
            acting as a wildcard.
        */

        if (req.query.search !== undefined) {

            const search = String(req.query.search).trim();


            if (search === "") {

                return res.status(400).json({
                    error: "search cannot be empty"
                });

            }


            values.push(`%${escapeLikePattern(search)}%`);

            filters.push(`
                AND (
                    s.name ILIKE $${values.length}
                    OR s.contact_person ILIKE $${values.length}
                    OR s.email ILIKE $${values.length}
                )
            `);

        }


        const result = await db.query(
            `
            ${BASE_SELECT}
            WHERE s.company_id = $1
            ${filters.join(" ")}
            ORDER BY s.created_at DESC, s.id DESC
            `,
            values
        );


        res.json({
            count: result.rowCount,
            suppliers: result.rows
        });


    } catch(error){

        handleError(error, res, "Failed to fetch suppliers");

    }

});



/*
    GET SINGLE SUPPLIER

    GET /api/suppliers/:id

    The company_id in the WHERE clause is what enforces ownership. A
    supplier belonging to another company returns 404, not 403, so we
    never confirm that someone else's record exists.
*/

router.get("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid supplier id"
            });

        }


        const result = await db.query(
            `
            ${BASE_SELECT}
            WHERE s.id = $1 AND s.company_id = $2
            `,
            [id, req.user.company_id]
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Supplier not found"
            });

        }


        res.json({
            supplier: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to fetch supplier");

    }

});



/*
    UPDATE SUPPLIER

    PUT /api/suppliers/:id

    Supports partial updates: only the fields present in the request
    body are written. The SET clause is built from a fixed whitelist
    and all values stay parameterised, so this is not SQL-injectable.

    company_id is absent from ALLOWED_FIELDS and so can never be
    changed — a supplier cannot be moved between tenants.

    status is writable here, which is what makes a soft delete
    reversible: PUT { "status": "active" } reinstates a supplier that
    DELETE had deactivated.
*/

router.put("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid supplier id"
            });

        }


        const body = getBody(req);


        // Keep only the fields the client is actually allowed to change.

        const fields = ALLOWED_FIELDS.filter(
            (field) => Object.prototype.hasOwnProperty.call(body, field)
        );


        if (fields.length === 0) {

            return res.status(400).json({
                error: `Provide at least one field to update: ${ALLOWED_FIELDS.join(", ")}`
            });

        }


        /*
            Confirm the supplier exists inside this company first, so a
            foreign id is reported as 404 before any other work.
        */

        const existing = await db.query(
            `
            SELECT id
            FROM suppliers
            WHERE id = $1 AND company_id = $2
            `,
            [id, req.user.company_id]
        );


        if (existing.rowCount === 0) {

            return res.status(404).json({
                error: "Supplier not found"
            });

        }


        const validationError = validateCommonFields(body, fields);


        if (validationError) {

            return res.status(400).json({
                error: validationError
            });

        }


        // Column -> value map. Keys come from the whitelist only.

        const updates = {};


        for (const field of fields) {

            const value = body[field];


            if (field === "name") {
                updates.name = value.trim();
                continue;
            }


            // Allow explicitly clearing optional fields with null / "".
            // status and verification_status cannot reach this branch
            // with an empty value: the validator above rejects anything
            // outside their whitelists.

            updates[field] = value === "" ? null : value;

        }


        // Build "name = $1, phone = $2, ..." from the whitelist.

        const columns = Object.keys(updates);

        const setClauses = columns.map(
            (column, index) => `${column} = $${index + 1}`
        );

        const values = columns.map((column) => updates[column]);


        /*
            The last two placeholders scope the update to this company,
            so tenant isolation lives in the UPDATE statement itself and
            not only in the SELECT above. Without this a race could let
            the pre-check pass and the write land on another tenant's
            row.
        */

        values.push(id, req.user.company_id);


        const result = await db.query(
            returningSupplier(`
                UPDATE suppliers
                SET ${setClauses.join(", ")}
                WHERE id = $${values.length - 1}
                  AND company_id = $${values.length}
                RETURNING *
            `),
            values
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Supplier not found"
            });

        }


        res.json({
            message: "Supplier updated successfully",
            supplier: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to update supplier");

    }

});



/*
    DEACTIVATE SUPPLIER

    DELETE /api/suppliers/:id

    This deactivates the supplier instead of physically deleting it.

    A supplier is a master record that purchasing history will point at
    — the composite-FK target added in migration 002 exists precisely
    so that purchase orders and delivery records can reference it later.
    Erasing the row would orphan that history, so "delete" here means
    status = 'inactive' and the record stays intact and auditable.

    This matches DELETE on /api/workers (deactivates),
    /api/worker-assignments (cancels) and /api/worker-certifications
    (revokes).

    verification_status is deliberately left alone: deactivating a
    supplier says nothing about whether its vetting ever passed.

    The company_id predicate scopes the update, so another company's
    supplier simply matches zero rows and reads back as 404.

    The call is idempotent: deactivating an already-inactive supplier
    succeeds and returns the unchanged row.
*/

router.delete("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid supplier id"
            });

        }


        const result = await db.query(
            returningSupplier(`
                UPDATE suppliers
                SET status = $1
                WHERE id = $2 AND company_id = $3
                RETURNING *
            `),
            [INACTIVE_STATUS, id, req.user.company_id]
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Supplier not found"
            });

        }


        res.json({
            message: "Supplier deactivated successfully",
            supplier: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to deactivate supplier");

    }

});


module.exports = router;
