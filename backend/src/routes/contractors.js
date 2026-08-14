const express = require("express");
const db = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();


/*
    CONTRACTOR MANAGEMENT MODULE

    Every route in this file is protected by authMiddleware.

    Ownership chain:

        contractors.project_id -> projects.id -> projects.company_id

    Since migration 001 the table also carries its own company_id
    (NOT NULL) as a tenant anchor. The read/update/delete routes still
    enforce isolation through the parent project, which remains correct;
    the database additionally guarantees the two agree via the composite
    FK (company_id, project_id) -> projects(company_id, id).

    The company scope always comes from the JWT (req.user.company_id)
    and is NEVER read from the body or query.

    Table: contractors
    (id, company_id, project_id, company_name, contact_person,
     email, phone, certification_status, created_at)
*/


// Apply authentication to every route registered below.

router.use(authMiddleware);


// Fields a client is allowed to write. Anything else in the
// request body is ignored, so a client can never set id or created_at.

const ALLOWED_FIELDS = [
    "project_id",
    "company_name",
    "contact_person",
    "email",
    "phone",
    "certification_status"
];


// Accepted certification states. Adjust this list to match your
// business rules — the database column is a free-form varchar.

const ALLOWED_CERTIFICATION_STATUSES = [
    "pending",
    "verified",
    "expired",
    "rejected"
];


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


// Light-touch email check. We only reject values that are
// obviously not addresses rather than trying to be exhaustive.

const isValidEmail = (value) => {

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

};


/*
    Translate Postgres data errors into 400 responses.

    Anything we cannot explain is a genuine server fault (500).
*/

const handleError = (error, res, message) => {

    console.error(error);


    // 23503 = foreign key violation (project_id does not exist)
    // 22P02 = invalid text representation (bad number, etc.)

    if (error.code === "23503") {

        return res.status(400).json({
            error: "Project not found"
        });

    }


    if (error.code === "22P02") {

        return res.status(400).json({
            error: "Invalid field value in request body"
        });

    }


    return res.status(500).json({
        error: message
    });

};


/*
    Confirm a project exists AND belongs to the caller's company.

    Used on create, and on update when a contractor is being moved
    to a different project — without this check a user could attach
    a contractor to another company's project.
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
    CREATE CONTRACTOR

    POST /api/contractors

    project_id is required. The column is nullable in the database,
    but a contractor with no project has no company either, which
    would make it invisible and unreachable through this API.
*/

router.post("/", async (req, res) => {

    try {

        const {
            project_id,
            company_name,
            contact_person,
            email,
            phone,
            certification_status
        } = req.body;


        const projectId = parseId(project_id);


        if (!projectId) {

            return res.status(400).json({
                error: "A valid project_id is required"
            });

        }


        // company_name is NOT NULL in the database.

        if (!company_name || typeof company_name !== "string" || company_name.trim() === "") {

            return res.status(400).json({
                error: "Contractor company_name is required"
            });

        }


        if (email && !isValidEmail(email)) {

            return res.status(400).json({
                error: "Invalid email address"
            });

        }


        if (certification_status && !ALLOWED_CERTIFICATION_STATUSES.includes(certification_status)) {

            return res.status(400).json({
                error: `certification_status must be one of: ${ALLOWED_CERTIFICATION_STATUSES.join(", ")}`
            });

        }


        // The project must belong to the caller's company.
        // 404 rather than 403 so we never confirm that another
        // company's project exists.

        const ownsProject = await companyOwnsProject(
            projectId,
            req.user.company_id
        );


        if (!ownsProject) {

            return res.status(404).json({
                error: "Project not found"
            });

        }


        // company_id is the tenant anchor and is NOT NULL in the database.
        // It always comes from the verified JWT, never from req.body, so a
        // client cannot file a contractor under another company. The project
        // was checked above, so both columns agree on the same company.

        const result = await db.query(
            `
            INSERT INTO contractors
            (company_id, project_id, company_name, contact_person, email, phone, certification_status)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING *
            `,
            [
                req.user.company_id,   // $1 — from the token only
                projectId,
                company_name.trim(),
                contact_person || null,
                email || null,
                phone || null,
                certification_status || "pending"
            ]
        );


        res.status(201).json({
            message: "Contractor created successfully",
            contractor: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to create contractor");

    }

});



/*
    LIST CONTRACTORS

    GET /api/contractors
    GET /api/contractors?project_id=1

    Returns only contractors attached to the authenticated company's
    projects. The optional project_id filter narrows the list to one
    project; it is still constrained by the company JOIN, so it cannot
    be used to read another company's data.
*/

router.get("/", async (req, res) => {

    try {

        const values = [req.user.company_id];

        let filter = "";


        if (req.query.project_id !== undefined) {

            const projectId = parseId(req.query.project_id);


            if (!projectId) {

                return res.status(400).json({
                    error: "Invalid project_id"
                });

            }


            values.push(projectId);

            filter = `AND c.project_id = $${values.length}`;

        }


        const result = await db.query(
            `
            SELECT c.*, p.name AS project_name
            FROM contractors c
            JOIN projects p ON p.id = c.project_id
            WHERE p.company_id = $1 ${filter}
            ORDER BY c.created_at DESC, c.id DESC
            `,
            values
        );


        res.json({
            count: result.rowCount,
            contractors: result.rows
        });


    } catch(error){

        handleError(error, res, "Failed to fetch contractors");

    }

});



/*
    GET SINGLE CONTRACTOR

    GET /api/contractors/:id

    The JOIN plus p.company_id is what enforces ownership. A contractor
    belonging to another company returns 404, not 403.
*/

router.get("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid contractor id"
            });

        }


        const result = await db.query(
            `
            SELECT c.*, p.name AS project_name
            FROM contractors c
            JOIN projects p ON p.id = c.project_id
            WHERE c.id = $1 AND p.company_id = $2
            `,
            [id, req.user.company_id]
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Contractor not found"
            });

        }


        res.json({
            contractor: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to fetch contractor");

    }

});



/*
    UPDATE CONTRACTOR

    PUT /api/contractors/:id

    Supports partial updates: only the fields present in the request
    body are written. The SET clause is built from a fixed whitelist
    and all values stay parameterised, so this is not SQL-injectable.

    Reassigning project_id is allowed, but the destination project
    must also belong to the caller's company.
*/

router.put("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid contractor id"
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


        // company_name is NOT NULL — reject an attempt to blank it out.

        if (fields.includes("company_name")) {

            const companyName = req.body.company_name;

            if (!companyName || typeof companyName !== "string" || companyName.trim() === "") {

                return res.status(400).json({
                    error: "Contractor company_name cannot be empty"
                });

            }

        }


        if (fields.includes("email")) {

            const email = req.body.email;

            // "" / null clears the field, so only validate real values.

            if (email && !isValidEmail(email)) {

                return res.status(400).json({
                    error: "Invalid email address"
                });

            }

        }


        if (fields.includes("certification_status")) {

            const status = req.body.certification_status;

            if (!status || !ALLOWED_CERTIFICATION_STATUSES.includes(status)) {

                return res.status(400).json({
                    error: `certification_status must be one of: ${ALLOWED_CERTIFICATION_STATUSES.join(", ")}`
                });

            }

        }


        // Moving the contractor to another project: the destination
        // must belong to the caller's company, otherwise a user could
        // push a contractor into another company's project.

        if (fields.includes("project_id")) {

            const projectId = parseId(req.body.project_id);


            if (!projectId) {

                return res.status(400).json({
                    error: "A valid project_id is required"
                });

            }


            const ownsProject = await companyOwnsProject(
                projectId,
                req.user.company_id
            );


            if (!ownsProject) {

                return res.status(404).json({
                    error: "Project not found"
                });

            }

        }


        // Build "company_name = $1, phone = $2, ..." from the whitelist.

        const setClauses = fields.map(
            (field, index) => `${field} = $${index + 1}`
        );


        const values = fields.map((field) => {

            const value = req.body[field];

            if (field === "company_name") {
                return value.trim();
            }

            if (field === "project_id") {
                return parseId(value);
            }

            // Allow explicitly clearing optional fields with null / "".

            return value === "" ? null : value;

        });


        // The last two placeholders scope the update to this company.

        values.push(id, req.user.company_id);


        const result = await db.query(
            `
            UPDATE contractors
            SET ${setClauses.join(", ")}
            WHERE id = $${values.length - 1}
              AND project_id IN (
                    SELECT id FROM projects WHERE company_id = $${values.length}
              )
            RETURNING *
            `,
            values
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Contractor not found"
            });

        }


        res.json({
            message: "Contractor updated successfully",
            contractor: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to update contractor");

    }

});



/*
    DELETE CONTRACTOR

    DELETE /api/contractors/:id

    The subquery restricts the delete to projects owned by the
    caller's company, so a foreign id simply matches zero rows.
*/

router.delete("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid contractor id"
            });

        }


        const result = await db.query(
            `
            DELETE FROM contractors
            WHERE id = $1
              AND project_id IN (
                    SELECT id FROM projects WHERE company_id = $2
              )
            RETURNING id
            `,
            [id, req.user.company_id]
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Contractor not found"
            });

        }


        res.json({
            message: "Contractor deleted successfully",
            id: result.rows[0].id
        });


    } catch(error){

        handleError(error, res, "Failed to delete contractor");

    }

});


module.exports = router;
