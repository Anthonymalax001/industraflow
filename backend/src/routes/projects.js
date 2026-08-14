const express = require("express");
const db = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();


/*
    PROJECTS MODULE

    Every route in this file is protected by authMiddleware.
    The company scope always comes from the JWT (req.user.company_id)
    and is NEVER read from the request body or query string.

    This guarantees a company can only ever touch its own projects.

    Table: projects
    (id, company_id, name, location, description,
     status, start_date, end_date, created_at)
*/


// Apply authentication to every route registered below.

router.use(authMiddleware);


// Fields a client is allowed to write. Anything else in the
// request body is ignored, so a client can never set company_id or id.

const ALLOWED_FIELDS = [
    "name",
    "location",
    "description",
    "status",
    "start_date",
    "end_date"
];


// Accepted project statuses. Adjust this list to match your
// business rules — the database column is a free-form varchar.

const ALLOWED_STATUSES = [
    "planning",
    "active",
    "on_hold",
    "completed",
    "cancelled"
];


/*
    Validate and parse a route :id parameter.

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
    Translate Postgres data errors into 400 responses.

    Anything we cannot explain is a genuine server fault (500).
*/

const handleError = (error, res, message) => {

    console.error(error);


    // 22007 / 22008 = invalid or out-of-range date
    // 22P02        = invalid text representation (bad number, etc.)

    if (["22007", "22008", "22P02"].includes(error.code)) {

        return res.status(400).json({
            error: "Invalid field value in request body"
        });

    }


    return res.status(500).json({
        error: message
    });

};



/*
    CREATE PROJECT

    POST /api/projects
*/

router.post("/", async (req, res) => {

    try {

        const {
            name,
            location,
            description,
            status,
            start_date,
            end_date
        } = req.body;


        // name is NOT NULL in the database, so validate it up front.

        if (!name || typeof name !== "string" || name.trim() === "") {

            return res.status(400).json({
                error: "Project name is required"
            });

        }


        // status is optional — the database defaults it to 'active'.

        if (status && !ALLOWED_STATUSES.includes(status)) {

            return res.status(400).json({
                error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`
            });

        }


        const result = await db.query(
            `
            INSERT INTO projects
            (company_id, name, location, description, status, start_date, end_date)
           VALUES (
    $1,
    $2,
    $3,
    $4,
    COALESCE($5, 'active'),
    $6,
    $7
)
            RETURNING *
            `,
            [
                req.user.company_id,   // scope comes from the token only
                name.trim(),
                location || null,
                description || null,
                status || null,
                start_date || null,
                end_date || null
            ]
        );


        res.status(201).json({
            message: "Project created successfully",
            project: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to create project");

    }

});



/*
    LIST PROJECTS

    GET /api/projects

    Returns only the authenticated company's projects.
*/

router.get("/", async (req, res) => {

    try {

        const result = await db.query(
            `
            SELECT *
            FROM projects
            WHERE company_id = $1
            ORDER BY created_at DESC, id DESC
            `,
            [req.user.company_id]
        );


        res.json({
            count: result.rowCount,
            projects: result.rows
        });


    } catch(error){

        handleError(error, res, "Failed to fetch projects");

    }

});



/*
    GET SINGLE PROJECT

    GET /api/projects/:id

    The company_id in the WHERE clause is what enforces ownership.
    A project belonging to another company returns 404, not 403,
    so we never confirm that someone else's project exists.
*/

router.get("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid project id"
            });

        }


        const result = await db.query(
            `
            SELECT *
            FROM projects
            WHERE id = $1 AND company_id = $2
            `,
            [id, req.user.company_id]
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Project not found"
            });

        }


        res.json({
            project: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to fetch project");

    }

});



/*
    UPDATE PROJECT

    PUT /api/projects/:id

    Supports partial updates: only the fields present in the request
    body are written. The SET clause is built from a fixed whitelist
    and all values stay parameterised, so this is not SQL-injectable.
*/

router.put("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid project id"
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


        // name is NOT NULL — reject an attempt to blank it out.

        if (fields.includes("name")) {

            const name = req.body.name;

            if (!name || typeof name !== "string" || name.trim() === "") {

                return res.status(400).json({
                    error: "Project name cannot be empty"
                });

            }

        }


        if (fields.includes("status")) {

            const status = req.body.status;

            if (!status || !ALLOWED_STATUSES.includes(status)) {

                return res.status(400).json({
                    error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`
                });

            }

        }


        // Build "name = $1, location = $2, ..." from the whitelist.

        const setClauses = fields.map(
            (field, index) => `${field} = $${index + 1}`
        );


        const values = fields.map((field) => {

            const value = req.body[field];

            if (field === "name") {
                return value.trim();
            }

            // Allow explicitly clearing optional fields with null / "".

            return value === "" ? null : value;

        });


        // The last two placeholders scope the update to this company.

        values.push(id, req.user.company_id);


        const result = await db.query(
            `
            UPDATE projects
            SET ${setClauses.join(", ")}
            WHERE id = $${values.length - 1} AND company_id = $${values.length}
            RETURNING *
            `,
            values
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Project not found"
            });

        }


        res.json({
            message: "Project updated successfully",
            project: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to update project");

    }

});



/*
    DELETE PROJECT

    DELETE /api/projects/:id
*/

router.delete("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid project id"
            });

        }


        const result = await db.query(
            `
            DELETE FROM projects
            WHERE id = $1 AND company_id = $2
            RETURNING id
            `,
            [id, req.user.company_id]
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Project not found"
            });

        }


        res.json({
            message: "Project deleted successfully",
            id: result.rows[0].id
        });


    } catch(error){

        handleError(error, res, "Failed to delete project");

    }

});


module.exports = router;
