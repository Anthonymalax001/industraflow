const express = require("express");
const db = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();


/*
    WORKFORCE MANAGEMENT MODULE

    Every route in this file is protected by authMiddleware.

    The company scope always comes from the JWT (req.user.company_id)
    and is NEVER read from the body or query string, so a client can
    neither file a worker under another company nor read one back.

    Table: workers
    (id, company_id, contractor_id, employment_type, name, position,
     skills, certification, status, employee_number, created_at)

    Two kinds of worker share this table, discriminated by
    employment_type and held apart by a database CHECK constraint:

        direct     -> company employee,  contractor_id IS NULL
        contractor -> agency personnel,  contractor_id IS NOT NULL

    That is workers_employer_xor. This module never writes one of the
    two columns without the other, so a row can never drift out of the
    state the constraint allows.

    Cross-tenant contamination is additionally prevented declaratively
    by the composite foreign key

        (company_id, contractor_id) -> contractors (company_id, id)

    which makes it impossible to attach a worker to another company's
    contractor even if the checks below were bypassed. We still verify
    ownership in application code so the caller gets a clean 404 rather
    than a constraint violation.
*/


// Apply authentication to every route registered below.

router.use(authMiddleware);


/*
    Fields a client is allowed to write.

    Anything else in the request body is ignored, so a client can never
    set id, created_at or — most importantly — company_id.

    employment_type and contractor_id are listed here because callers
    are allowed to convert a worker between the two employment models,
    but they are never written straight from the body: they are resolved
    together and validated against the XOR rule first.
*/

const ALLOWED_FIELDS = [
    "name",
    "position",
    "skills",
    "certification",
    "status",
    "employee_number",
    "employment_type",
    "contractor_id"
];


// Employment models permitted by workers_employment_type_valid.

const ALLOWED_EMPLOYMENT_TYPES = [
    "direct",
    "contractor"
];


// Worker states permitted by workers_status_valid.

const ALLOWED_STATUSES = [
    "active",
    "inactive",
    "suspended",
    "terminated"
];


// The state a "deleted" worker is moved into. Personnel records are
// never physically removed — see the DELETE route.

const INACTIVE_STATUS = "inactive";


// employee_number is VARCHAR(50) in the database.

const EMPLOYEE_NUMBER_MAX_LENGTH = 50;


/*
    Every read returns the worker plus the name of the employing
    contractor, which saves the client a second round trip.

    The join is LEFT because direct employees have no contractor, and
    it is scoped by company_id as well as id so it can only ever match
    a contractor inside the same tenant.
*/

const BASE_SELECT = `
    SELECT
        w.*,
        c.company_name AS contractor_name
    FROM workers w
    LEFT JOIN contractors c
           ON c.id = w.contractor_id
          AND c.company_id = w.company_id
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
    Normalise an employee_number.

    null, undefined and "" all mean "no employee number". The partial
    unique index only covers non-null values, so clearing the field is
    always allowed even when several workers have none.
*/

const normalizeEmployeeNumber = (value) => {

    if (value === null || value === undefined) {
        return null;
    }

    const employeeNumber = String(value).trim();

    return employeeNumber === "" ? null : employeeNumber;

};


/*
    Translate Postgres data errors into 4xx responses.

    Anything we cannot explain is a genuine server fault (500).
*/

const handleError = (error, res, message) => {

    console.error(error);


    /*
        23505 = unique violation.

        The only unique index a client can collide with is
        workers_company_employee_number_key, which is scoped per
        company — so the clash is always with a worker the caller
        can already see. 409 rather than 400: the body is well
        formed, it just conflicts with existing state.
    */

    if (error.code === "23505") {

        return res.status(409).json({
            error: "A worker with this employee_number already exists"
        });

    }


    // 23503 = foreign key violation. On this table the only client
    // controlled reference is the contractor.

    if (error.code === "23503") {

        return res.status(400).json({
            error: "Contractor not found"
        });

    }


    /*
        23514 = check violation. Reachable only if a request slips past
        the validation above, so treat it as a bad request and say which
        rule was broken.
    */

    if (error.code === "23514") {

        return res.status(400).json({
            error: "Worker violates an employment_type / contractor_id / status rule"
        });

    }


    // 23502 = not-null violation (e.g. name blanked out)
    // 22001 = value too long for the column
    // 22P02 = invalid text representation (bad number, etc.)

    if (["23502", "22001", "22P02"].includes(error.code)) {

        return res.status(400).json({
            error: "Invalid field value in request body"
        });

    }


    return res.status(500).json({
        error: message
    });

};


/*
    Confirm a contractor exists AND belongs to the caller's company.

    Used on create, and on update whenever a worker is being attached
    to a contractor — without this check a user could hang a worker off
    another company's contractor.
*/

const companyOwnsContractor = async (contractorId, companyId) => {

    const result = await db.query(
        `
        SELECT id
        FROM contractors
        WHERE id = $1 AND company_id = $2
        `,
        [contractorId, companyId]
    );

    return result.rowCount > 0;

};


/*
    Validate the fields every write shares.

    Returns an error string, or null when the payload is acceptable.
    Only the keys actually present are checked, so this serves both
    the full create and the partial update.
*/

const validateCommonFields = (body, presentFields) => {

    // name is NOT NULL in the database.

    if (presentFields.includes("name")) {

        const name = body.name;

        if (!name || typeof name !== "string" || name.trim() === "") {
            return "Worker name is required";
        }

    }


    if (presentFields.includes("status")) {

        const status = body.status;

        if (!status || !ALLOWED_STATUSES.includes(status)) {
            return `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`;
        }

    }


    if (presentFields.includes("employee_number")) {

        const employeeNumber = normalizeEmployeeNumber(body.employee_number);

        if (employeeNumber && employeeNumber.length > EMPLOYEE_NUMBER_MAX_LENGTH) {
            return `employee_number must be ${EMPLOYEE_NUMBER_MAX_LENGTH} characters or fewer`;
        }

    }


    return null;

};



/*
    CREATE WORKER

    POST /api/workers

    Body: name (required), employment_type, contractor_id, position,
          skills, certification, status, employee_number

    employment_type may be omitted: a body carrying a contractor_id is
    read as a contractor worker, otherwise the worker is direct. This
    mirrors the database default and keeps simple payloads simple.
*/

router.post("/", async (req, res) => {

    try {

        const {
            name,
            position,
            skills,
            certification,
            status,
            employee_number,
            contractor_id
        } = req.body;


        // Only validate what was sent; name is forced below.

        const presentFields = ALLOWED_FIELDS.filter(
            (field) => Object.prototype.hasOwnProperty.call(req.body, field)
        );


        if (!name || typeof name !== "string" || name.trim() === "") {

            return res.status(400).json({
                error: "Worker name is required"
            });

        }


        const validationError = validateCommonFields(req.body, presentFields);


        if (validationError) {

            return res.status(400).json({
                error: validationError
            });

        }


        // A contractor_id of null / "" means "no contractor".

        const hasContractorId =
            contractor_id !== undefined &&
            contractor_id !== null &&
            contractor_id !== "";


        // Absent employment_type is inferred from the presence of a
        // contractor_id, which matches the database default of 'direct'.

        const employmentType = req.body.employment_type === undefined
            ? (hasContractorId ? "contractor" : "direct")
            : req.body.employment_type;


        if (!ALLOWED_EMPLOYMENT_TYPES.includes(employmentType)) {

            return res.status(400).json({
                error: `employment_type must be one of: ${ALLOWED_EMPLOYMENT_TYPES.join(", ")}`
            });

        }


        let contractorId = null;


        if (employmentType === "contractor") {

            // Contractor workers must name their employer.

            if (!hasContractorId) {

                return res.status(400).json({
                    error: "contractor_id is required when employment_type is 'contractor'"
                });

            }


            contractorId = parseId(contractor_id);


            if (!contractorId) {

                return res.status(400).json({
                    error: "Invalid contractor_id"
                });

            }


            /*
                The contractor must belong to the caller's company.
                404 rather than 403 so we never confirm that another
                company's contractor exists.
            */

            const ownsContractor = await companyOwnsContractor(
                contractorId,
                req.user.company_id
            );


            if (!ownsContractor) {

                return res.status(404).json({
                    error: "Contractor not found"
                });

            }

        } else {

            /*
                Direct workers must have contractor_id NULL — that is the
                other half of workers_employer_xor. Reject rather than
                silently dropping the value, because a body carrying both
                'direct' and a contractor_id is self-contradictory and we
                cannot know which half the caller meant.
            */

            if (hasContractorId) {

                return res.status(400).json({
                    error: "A direct worker cannot have a contractor_id"
                });

            }

        }


        /*
            company_id is the tenant anchor and is NOT NULL in the
            database. It always comes from the verified JWT, never from
            req.body. employment_type and contractor_id are written from
            the pair resolved above, so the XOR constraint always holds.

            "position" is quoted because POSITION is a SQL keyword.
        */

        const result = await db.query(
            `
            INSERT INTO workers
            (company_id, employment_type, contractor_id, name, "position",
             skills, certification, status, employee_number)
            VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'active'),$9)
            RETURNING *
            `,
            [
                req.user.company_id,   // $1 — from the token only
                employmentType,
                contractorId,
                name.trim(),
                position || null,
                skills || null,
                certification || null,
                status || null,
                normalizeEmployeeNumber(employee_number)
            ]
        );


        res.status(201).json({
            message: "Worker created successfully",
            worker: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to create worker");

    }

});



/*
    LIST WORKERS

    GET /api/workers
    GET /api/workers?contractor_id=1
    GET /api/workers?project_id=2
    GET /api/workers?status=active
    GET /api/workers?employment_type=contractor

    Returns only workers belonging to the authenticated company. Every
    filter is optional and they combine with AND. Each one is checked
    against a whitelist or parsed as an integer before it is used, and
    all of them sit behind the company_id predicate, so none can widen
    the result set beyond the caller's own tenant.
*/

router.get("/", async (req, res) => {

    try {

        const values = [req.user.company_id];

        const filters = [];


        if (req.query.contractor_id !== undefined) {

            const contractorId = parseId(req.query.contractor_id);


            if (!contractorId) {

                return res.status(400).json({
                    error: "Invalid contractor_id"
                });

            }


            values.push(contractorId);

            filters.push(`AND w.contractor_id = $${values.length}`);

        }


        /*
            Workers are not attached to a project directly — deployment
            lives in worker_assignments, which is many-to-many and time
            bounded. So project_id matches any worker holding at least
            one assignment on that project, of any assignment status.

            The subquery is scoped by company as well, though the outer
            WHERE already guarantees it.
        */

        if (req.query.project_id !== undefined) {

            const projectId = parseId(req.query.project_id);


            if (!projectId) {

                return res.status(400).json({
                    error: "Invalid project_id"
                });

            }


            values.push(projectId);

            filters.push(`
                AND EXISTS (
                    SELECT 1
                    FROM worker_assignments wa
                    WHERE wa.worker_id = w.id
                      AND wa.company_id = w.company_id
                      AND wa.project_id = $${values.length}
                )
            `);

        }


        if (req.query.status !== undefined) {

            const status = req.query.status;


            if (!ALLOWED_STATUSES.includes(status)) {

                return res.status(400).json({
                    error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`
                });

            }


            values.push(status);

            filters.push(`AND w.status = $${values.length}`);

        }


        if (req.query.employment_type !== undefined) {

            const employmentType = req.query.employment_type;


            if (!ALLOWED_EMPLOYMENT_TYPES.includes(employmentType)) {

                return res.status(400).json({
                    error: `employment_type must be one of: ${ALLOWED_EMPLOYMENT_TYPES.join(", ")}`
                });

            }


            values.push(employmentType);

            filters.push(`AND w.employment_type = $${values.length}`);

        }


        const result = await db.query(
            `
            ${BASE_SELECT}
            WHERE w.company_id = $1
            ${filters.join(" ")}
            ORDER BY w.created_at DESC, w.id DESC
            `,
            values
        );


        res.json({
            count: result.rowCount,
            workers: result.rows
        });


    } catch(error){

        handleError(error, res, "Failed to fetch workers");

    }

});



/*
    GET SINGLE WORKER

    GET /api/workers/:id

    The company_id in the WHERE clause is what enforces ownership.
    A worker belonging to another company returns 404, not 403, so we
    never confirm that someone else's worker exists.
*/

router.get("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid worker id"
            });

        }


        const result = await db.query(
            `
            ${BASE_SELECT}
            WHERE w.id = $1 AND w.company_id = $2
            `,
            [id, req.user.company_id]
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Worker not found"
            });

        }


        res.json({
            worker: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to fetch worker");

    }

});



/*
    UPDATE WORKER

    PUT /api/workers/:id

    Supports partial updates: only the fields present in the request
    body are written. The SET clause is built from a fixed whitelist
    and all values stay parameterised, so this is not SQL-injectable.

    employment_type and contractor_id are resolved as a pair and are
    always written together, so the worker can never land in a state
    workers_employer_xor forbids:

        both sent          -> they must agree, otherwise 400
        only the type sent -> 'direct' clears the contractor;
                              'contractor' keeps the current one and
                              fails if there is none to keep
        only the id sent   -> a real id makes the worker a contractor
                              worker, null makes it direct

    Any resulting contractor must belong to the caller's company.
*/

router.put("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid worker id"
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


        const validationError = validateCommonFields(req.body, fields);


        if (validationError) {

            return res.status(400).json({
                error: validationError
            });

        }


        /*
            Load the current row, scoped to this company.

            This both gives the caller a clean 404 before any further
            work and supplies the existing employment pair, which the
            resolution below needs when only one half was sent.
        */

        const existing = await db.query(
            `
            SELECT id, employment_type, contractor_id
            FROM workers
            WHERE id = $1 AND company_id = $2
            `,
            [id, req.user.company_id]
        );


        if (existing.rowCount === 0) {

            return res.status(404).json({
                error: "Worker not found"
            });

        }


        const current = existing.rows[0];


        // Column -> value map. Built from the whitelist only.

        const updates = {};


        for (const field of fields) {

            // Handled jointly below, never written straight from the body.

            if (field === "employment_type" || field === "contractor_id") {
                continue;
            }


            const value = req.body[field];


            if (field === "name") {
                updates.name = value.trim();
                continue;
            }


            if (field === "employee_number") {
                updates.employee_number = normalizeEmployeeNumber(value);
                continue;
            }


            // Allow explicitly clearing optional fields with null / "".

            updates[field] = value === "" ? null : value;

        }


        const touchesType = fields.includes("employment_type");
        const touchesContractor = fields.includes("contractor_id");


        if (touchesType || touchesContractor) {

            let nextEmploymentType = null;
            let nextContractorId = null;


            // Normalise the incoming contractor_id: null / "" clears it.

            let bodyContractorId = null;


            if (touchesContractor) {

                const rawContractorId = req.body.contractor_id;


                if (rawContractorId !== null && rawContractorId !== "") {

                    bodyContractorId = parseId(rawContractorId);


                    if (!bodyContractorId) {

                        return res.status(400).json({
                            error: "Invalid contractor_id"
                        });

                    }

                }

            }


            if (touchesType) {

                nextEmploymentType = req.body.employment_type;


                if (!ALLOWED_EMPLOYMENT_TYPES.includes(nextEmploymentType)) {

                    return res.status(400).json({
                        error: `employment_type must be one of: ${ALLOWED_EMPLOYMENT_TYPES.join(", ")}`
                    });

                }

            }


            if (touchesType && touchesContractor) {

                /*
                    Both halves supplied: they must agree. We do not
                    silently correct one to match the other, because a
                    contradictory body gives no way to tell which half
                    the caller actually meant.
                */

                nextContractorId = bodyContractorId;


                if (nextEmploymentType === "contractor" && nextContractorId === null) {

                    return res.status(400).json({
                        error: "contractor_id is required when employment_type is 'contractor'"
                    });

                }


                if (nextEmploymentType === "direct" && nextContractorId !== null) {

                    return res.status(400).json({
                        error: "A direct worker cannot have a contractor_id"
                    });

                }

            } else if (touchesType) {

                if (nextEmploymentType === "direct") {

                    // Converting to a direct employee detaches the
                    // contractor — the XOR permits nothing else.

                    nextContractorId = null;

                } else {

                    // Converting to a contractor worker needs an employer.
                    // Keep the existing one if the row already has it.

                    nextContractorId = current.contractor_id;


                    if (nextContractorId === null) {

                        return res.status(400).json({
                            error: "contractor_id is required when employment_type is 'contractor'"
                        });

                    }

                }

            } else {

                // Only contractor_id moved — the type follows from it.

                nextContractorId = bodyContractorId;

                nextEmploymentType = nextContractorId === null
                    ? "direct"
                    : "contractor";

            }


            /*
                The destination contractor must belong to the caller's
                company, otherwise a user could move a worker onto
                another company's contractor.
            */

            if (nextContractorId !== null) {

                const ownsContractor = await companyOwnsContractor(
                    nextContractorId,
                    req.user.company_id
                );


                if (!ownsContractor) {

                    return res.status(404).json({
                        error: "Contractor not found"
                    });

                }

            }


            // Always written as a pair, so the row stays XOR-valid.

            updates.employment_type = nextEmploymentType;
            updates.contractor_id = nextContractorId;

        }


        /*
            Build 'name' = $1, "position" = $2, ... from the whitelist.

            The identifiers come from ALLOWED_FIELDS, never from the
            body, and are quoted because "position" is a SQL keyword.
        */

        const columns = Object.keys(updates);

        const setClauses = columns.map(
            (column, index) => `"${column}" = $${index + 1}`
        );

        const values = columns.map((column) => updates[column]);


        // The last two placeholders scope the update to this company,
        // so ownership is enforced in the SQL and not just by the
        // SELECT above.

        values.push(id, req.user.company_id);


        const result = await db.query(
            `
            UPDATE workers
            SET ${setClauses.join(", ")}
            WHERE id = $${values.length - 1} AND company_id = $${values.length}
            RETURNING *
            `,
            values
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Worker not found"
            });

        }


        res.json({
            message: "Worker updated successfully",
            worker: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to update worker");

    }

});



/*
    DEACTIVATE WORKER

    DELETE /api/workers/:id

    Personnel records are never physically deleted. Attendance,
    assignment and certification history all reference this row, and
    the workforce migration deliberately protects it with ON DELETE
    RESTRICT — so "delete" here means deactivate: status becomes
    'inactive' and the record stays intact and auditable.

    The company_id predicate scopes the update, so another company's
    worker simply matches zero rows and reads back as 404.

    The call is idempotent: deactivating an already-inactive worker
    succeeds and returns the unchanged row.
*/

router.delete("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid worker id"
            });

        }


        const result = await db.query(
            `
            UPDATE workers
            SET status = $1
            WHERE id = $2 AND company_id = $3
            RETURNING *
            `,
            [INACTIVE_STATUS, id, req.user.company_id]
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Worker not found"
            });

        }


        res.json({
            message: "Worker deactivated successfully",
            worker: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to deactivate worker");

    }

});


module.exports = router;
