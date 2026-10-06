const express = require("express");
const db = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();


/*
    ASSETS & EQUIPMENT MODULE

    Every route in this file is protected by authMiddleware.

    An asset is a piece of equipment the company owns, rents or leases.
    It is a COMPANY-level master record: project_id records where the
    asset is deployed RIGHT NOW and is nullable, because equipment
    sitting in the yard belongs to the company and to no project.

    There is deliberately no asset_assignments history table in this
    phase, so project_id is the whole deployment story — it answers
    "where is it?", not "where has it been?".

    Table: assets
    (id, company_id, name, asset_type, serial_number, asset_tag,
     location, project_id, supplier_id, ownership_type, purchase_date,
     purchase_cost, rental_start_date, rental_end_date, rental_rate,
     last_maintenance_date, next_maintenance_date, operational_status,
     status, created_at)

    Tenancy
    -------
    company_id is the tenant anchor and is NOT NULL. It always comes
    from the verified JWT (req.user.company_id) and is NEVER read from
    the body or query string. It is absent from ALLOWED_FIELDS, so a
    client can neither file an asset under another company nor move one
    between companies.

    Every SELECT, UPDATE and DELETE carries "AND company_id = $n", and
    a miss reads back as 404 rather than 403 — we never confirm that
    another company's asset exists.

    Migration 003 then makes cross-tenant contamination structurally
    impossible with two composite foreign keys:

        (company_id, project_id)  -> projects  (company_id, id)
                                     ON DELETE SET NULL (project_id)

        (company_id, supplier_id) -> suppliers (company_id, id)
                                     ON DELETE RESTRICT

    Because the asset's own company_id is used on both sides of each
    key, the project and the supplier are FORCED to belong to the same
    company as the asset. We still verify ownership in application code
    so the caller gets a clean 404 instead of a raw constraint
    violation.

    Deleting a project sets project_id to NULL and returns the asset to
    the unassigned pool. It does not destroy the asset — a company does
    not stop owning an excavator because a project ended.

    Two orthogonal status columns
    -----------------------------
        status               active | inactive
                             Lifecycle: "is this asset still on our
                             books?" This is what DELETE sets to
                             'inactive' (soft delete).

        operational_status   available | in_use | under_maintenance
                             | out_of_service
                             Where it is in the working cycle.

    They are kept apart on purpose, for the same reason suppliers keeps
    status and verification_status apart: folding them into one column
    would make an asset that is away for repair indistinguishable from
    one that has been written off.

    Rules already enforced by the database (migration 003)
    ------------------------------------------------------
        assets_status_valid                status IN ('active','inactive')
        assets_operational_status_valid    operational_status IN (...)
        assets_ownership_type_valid        ownership_type IN
                                           ('owned','rented','leased')
        assets_asset_type_valid            asset_type IS NULL OR IN (...)

        assets_rental_supplier_required
            ownership_type = 'owned' OR supplier_id IS NOT NULL
            -> rented and leased equipment must name its lessor

        assets_rental_dates_valid
            rental_end_date >= rental_start_date (when both present)

        assets_maintenance_dates_valid
            next_maintenance_date >= last_maintenance_date
            (when both present)

        assets_costs_non_negative
            purchase_cost >= 0 AND rental_rate >= 0

        assets_company_serial_number_key   (partial UNIQUE index)
        assets_company_asset_tag_key       (partial UNIQUE index)
            UNIQUE (company_id, lower(btrim(<column>)))
            WHERE <column> IS NOT NULL
            -> each identifier is unique per company WHEN PRESENT,
               compared case-insensitively and ignoring surrounding
               whitespace, so 'EXC-001', 'exc-001' and '  EXC-001  '
               collide

    The database stays the single source of truth for those rules. The
    validation below exists so a caller gets a clear message before the
    round trip, and handleError() translates any violation that still
    reaches Postgres into a useful 4xx instead of leaking internals.

    Note there is NO unique constraint on name. Unlike suppliers, a
    company legitimately owns ten identical "Generator 5kVA" units, so
    names are labels here rather than identifiers.

    Dates
    -----
    Every DATE column is selected as ::text so responses return exactly
    the stored YYYY-MM-DD, and every dynamically built date update
    carries an explicit ::date cast. The pg driver otherwise converts a
    DATE into a JS Date at LOCAL midnight, which then serialises to JSON
    shifted into the previous day on any server east of UTC. This is the
    same treatment worker_certifications gives issued_date/expiry_date,
    and it is scoped to this module only: the global pg date parser is
    untouched, so projects and worker_assignments keep their existing
    behaviour.

    purchase_cost and rental_rate are NUMERIC, which the pg driver
    returns as a STRING ("125000.00") rather than a JS number. That is
    deliberate on the driver's part — a float cannot hold every NUMERIC
    exactly — and it is passed through unchanged rather than being
    rounded into a number here.
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
    "asset_type",
    "serial_number",
    "asset_tag",
    "location",
    "project_id",
    "supplier_id",
    "ownership_type",
    "purchase_date",
    "purchase_cost",
    "rental_start_date",
    "rental_end_date",
    "rental_rate",
    "last_maintenance_date",
    "next_maintenance_date",
    "operational_status",
    "status"
];


/*
    Fields a client is allowed to set on create.

    status is deliberately absent: a new asset always starts 'active'
    (the database default). Deactivating is what DELETE is for, and
    creating an asset that is already written off has no meaning. A
    status sent to POST is ignored rather than rejected, which is how
    every other module in this codebase treats a field outside its
    whitelist.

    operational_status IS accepted here — an asset can legitimately be
    recorded as already in_use or under_maintenance on the day it is
    entered into the system.
*/

const CREATE_FIELDS = ALLOWED_FIELDS.filter((field) => field !== "status");


// Lifecycle states permitted by assets_status_valid.

const ALLOWED_STATUSES = [
    "active",
    "inactive"
];


// Working states permitted by assets_operational_status_valid.

const ALLOWED_OPERATIONAL_STATUSES = [
    "available",
    "in_use",
    "under_maintenance",
    "out_of_service"
];


// Categories permitted by assets_asset_type_valid.

const ALLOWED_ASSET_TYPES = [
    "heavy_equipment",
    "vehicle",
    "power_tool",
    "generator",
    "it_equipment",
    "safety_equipment",
    "other"
];


// Ownership models permitted by assets_ownership_type_valid.

const ALLOWED_OWNERSHIP_TYPES = [
    "owned",
    "rented",
    "leased"
];


// Ownership models that require a supplier — see
// assets_rental_supplier_required.

const SUPPLIER_REQUIRED_OWNERSHIP = [
    "rented",
    "leased"
];


// The state a "deleted" asset is moved into. Asset records are never
// physically removed — see the DELETE route.

const INACTIVE_STATUS = "inactive";


// Column widths from the schema, checked up front so the caller gets a
// clear message instead of a bare 22001 from Postgres.

const MAX_LENGTHS = {
    name: 255,
    serial_number: 255,
    asset_tag: 50,
    location: 255
};


/*
    These need an explicit ::date cast when written through a
    dynamically built SET clause, and are selected as ::text on the way
    out. See the module header.
*/

const DATE_FIELDS = new Set([
    "purchase_date",
    "rental_start_date",
    "rental_end_date",
    "last_maintenance_date",
    "next_maintenance_date"
]);


// NUMERIC(12,2) columns. Cast on write for the same reason as the
// dates: a text parameter should never be ambiguous.

const NUMERIC_FIELDS = new Set([
    "purchase_cost",
    "rental_rate"
]);


// Foreign keys resolved and authorised separately from the plain
// column updates.

const REFERENCE_FIELDS = new Set([
    "project_id",
    "supplier_id"
]);


// Text columns that are trimmed before they are stored. The identifier
// indexes compare with btrim(), so storing the untrimmed value would
// leave the stored text and the uniqueness key disagreeing.

const TRIMMED_FIELDS = new Set([
    "name",
    "serial_number",
    "asset_tag",
    "location"
]);


// Largest value NUMERIC(12,2) can hold. Checked up front so an
// oversized figure is a clear message rather than a bare 22003.

const MAX_MONEY = 9999999999.99;


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
    Every read returns the asset, the names of the project and supplier
    it points at, and two derived maintenance fields.

    Both joins are LEFT joins because project_id and supplier_id are
    nullable — an unassigned, company-owned asset has neither. Each join
    is additionally constrained on company_id. The outer WHERE already
    scopes to the caller's company, so this is redundant by design — it
    means a mistake in one predicate cannot by itself leak another
    tenant's row.

    Selecting the columns by name rather than with SELECT * means the
    response shape is stable even if a later migration adds a column,
    and it keeps GET, POST and PUT returning identical objects.

    is_maintenance_overdue and days_until_maintenance are computed per
    request and are never stored, mirroring is_expired /
    days_until_expiry on worker_certifications. The database has no job
    that moves an asset into 'under_maintenance' on its own, so these
    report the position without rewriting stored data.
*/

const ASSET_COLUMNS = `
        a.id,
        a.company_id,
        a.name,
        a.asset_type,
        a.serial_number,
        a.asset_tag,
        a.location,
        a.project_id,
        p.name   AS project_name,
        p.status AS project_status,
        a.supplier_id,
        s.name   AS supplier_name,
        a.ownership_type,
        a.purchase_date::text     AS purchase_date,
        a.purchase_cost,
        a.rental_start_date::text AS rental_start_date,
        a.rental_end_date::text   AS rental_end_date,
        a.rental_rate,
        a.last_maintenance_date::text AS last_maintenance_date,
        a.next_maintenance_date::text AS next_maintenance_date,
        a.operational_status,
        a.status,
        a.created_at,
        (
            a.next_maintenance_date IS NOT NULL
            AND a.next_maintenance_date < CURRENT_DATE
        ) AS is_maintenance_overdue,
        CASE
            WHEN a.next_maintenance_date IS NULL THEN NULL
            ELSE (a.next_maintenance_date - CURRENT_DATE)
        END AS days_until_maintenance
`;

const ASSET_JOINS = `
    LEFT JOIN projects p
           ON p.id = a.project_id
          AND p.company_id = a.company_id
    LEFT JOIN suppliers s
           ON s.id = a.supplier_id
          AND s.company_id = a.company_id
`;

const BASE_SELECT = `
    SELECT ${ASSET_COLUMNS}
    FROM assets a
    ${ASSET_JOINS}
`;


/*
    Writes wrap their INSERT/UPDATE in a CTE and then join, so a create
    or update returns exactly the same shape as a GET — including the
    joined names and the derived fields — in one round trip.
*/

const returningAsset = (cte) => `
    WITH changed AS (
        ${cte}
    )
    SELECT ${ASSET_COLUMNS}
    FROM changed a
    ${ASSET_JOINS}
`;


/*
    Read the request body as an object, whatever the client sent.

    express.json() does NOT guarantee req.body is set. Express 5 ships
    body-parser 2, which sets req.body = undefined and returns early
    whenever it declines to parse — a request with no body at all, or
    one whose Content-Type is not application/json. Express 4's
    body-parser 1 handed the route an empty object in that situation, so
    code that reads req.body directly is safe there and throws here.

    Normalising to {} keeps the "no usable fields were sent" path
    intact: the whitelist filter finds nothing and the caller gets the
    existing 400 instead of a 500.
*/

const getBody = (req) => {

    const body = req.body;


    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return {};
    }


    return body;

};


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
    Parse a non-negative integer, used by the
    maintenance_due_within_days filter where 0 is meaningful ("due
    today or already overdue").
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
    Is this a real YYYY-MM-DD calendar date?

    Format is checked strictly rather than left to Postgres. Postgres
    would accept '01/02/2026' and interpret it according to the server's
    DateStyle, which means the same request could store 1 February or
    2 January depending on a setting the client cannot see. Demanding
    ISO removes that ambiguity, and it also rejects impossible dates
    like 2026-02-31 that a bare regex would let through.

    The round trip is built in UTC so this check cannot itself be
    shifted by the server's timezone.
*/

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isValidDateString = (value) => {

    if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
        return false;
    }


    const [year, month, day] = value.split("-").map(Number);

    const parsed = new Date(Date.UTC(year, month - 1, day));


    return parsed.getUTCFullYear() === year
        && parsed.getUTCMonth() === month - 1
        && parsed.getUTCDate() === day;

};


/*
    Is this an acceptable money value for a NUMERIC(12,2) column?

    Numbers and numeric strings are both accepted, since JSON clients
    send either. Booleans, arrays and objects are not — Number(true)
    is 1 and Number([]) is 0, which would silently store nonsense.
*/

const isValidMoney = (value) => {

    if (typeof value !== "number" && typeof value !== "string") {
        return false;
    }


    if (typeof value === "string" && value.trim() === "") {
        return false;
    }


    const parsed = Number(value);


    return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_MONEY;

};


/*
    Normalise an optional text value.

    Returns the trimmed string, or null for null/undefined/blank — so
    "" and "   " clear the column rather than storing whitespace.
*/

const trimOrNull = (value) => {

    if (value === null || value === undefined) {
        return null;
    }


    const trimmed = String(value).trim();


    return trimmed === "" ? null : trimmed;

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

        The only unique indexes a client can collide with are the two
        identifier indexes, both scoped per company — so the clash is
        always with an asset the caller can already see. 409 rather than
        400: the body is well formed, it just conflicts with existing
        state.

        The messages mention the deactivated case because neither index
        is partial on status, so a written-off asset still holds its
        serial number and tag.
    */

    if (error.code === "23505") {

        if (error.constraint === "assets_company_serial_number_key") {

            return res.status(409).json({
                error: "An asset with this serial_number already exists for this company"
            });

        }

        if (error.constraint === "assets_company_asset_tag_key") {

            return res.status(409).json({
                error: "An asset with this asset_tag already exists for this company"
            });

        }

        return res.status(409).json({
            error: "Asset conflicts with an existing record"
        });

    }


    // 23514 = check violation. Name the rule that was broken.

    if (error.code === "23514") {

        if (error.constraint === "assets_status_valid") {

            return res.status(400).json({
                error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`
            });

        }

        if (error.constraint === "assets_operational_status_valid") {

            return res.status(400).json({
                error: `operational_status must be one of: ${ALLOWED_OPERATIONAL_STATUSES.join(", ")}`
            });

        }

        if (error.constraint === "assets_ownership_type_valid") {

            return res.status(400).json({
                error: `ownership_type must be one of: ${ALLOWED_OWNERSHIP_TYPES.join(", ")}`
            });

        }

        if (error.constraint === "assets_asset_type_valid") {

            return res.status(400).json({
                error: `asset_type must be one of: ${ALLOWED_ASSET_TYPES.join(", ")}`
            });

        }

        if (error.constraint === "assets_rental_supplier_required") {

            return res.status(400).json({
                error: "supplier_id is required when ownership_type is rented or leased"
            });

        }

        if (error.constraint === "assets_rental_dates_valid") {

            return res.status(400).json({
                error: "rental_end_date must be on or after rental_start_date"
            });

        }

        if (error.constraint === "assets_maintenance_dates_valid") {

            return res.status(400).json({
                error: "next_maintenance_date must be on or after last_maintenance_date"
            });

        }

        if (error.constraint === "assets_costs_non_negative") {

            return res.status(400).json({
                error: "purchase_cost and rental_rate cannot be negative"
            });

        }

        return res.status(400).json({
            error: "Asset violates a database rule"
        });

    }


    /*
        23503 = foreign key violation.

        The project and the supplier are both verified to belong to the
        caller's company before every write, so this is only reachable
        in a race where one of them was removed in between.
    */

    if (error.code === "23503") {

        if (error.constraint === "assets_project_same_company") {

            return res.status(400).json({
                error: "Project not found"
            });

        }

        if (error.constraint === "assets_supplier_same_company") {

            return res.status(400).json({
                error: "Supplier not found"
            });

        }

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


    // 22003 = numeric value out of range for NUMERIC(12,2).

    if (error.code === "22003") {

        return res.status(400).json({
            error: "A monetary value is outside the range the column allows"
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
    Confirm a project exists AND belongs to the caller's company.

    Without this check a user could park their asset on another
    company's project. The composite foreign key would refuse the write
    anyway, but the caller would get an opaque constraint error instead
    of a clean 404.
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
    Confirm a supplier exists AND belongs to the caller's company.

    Deliberately does NOT filter on suppliers.status: a deactivated
    supplier is still the lessor of record for equipment already on
    hire, and refusing to reference it would make history unrecordable.
*/

const companyOwnsSupplier = async (supplierId, companyId) => {

    const result = await db.query(
        `
        SELECT id
        FROM suppliers
        WHERE id = $1 AND company_id = $2
        `,
        [supplierId, companyId]
    );

    return result.rowCount > 0;

};


/*
    Resolve and authorise a project_id coming from a request body.

    Returns { projectId } — possibly null, which clears the assignment
    — or { error } for a malformed or foreign id. 404 rather than 403 so
    we never confirm that another company's project exists.
*/

const resolveProjectId = async (rawProjectId, companyId) => {

    // null / "" detaches the asset from its project.

    if (rawProjectId === null || rawProjectId === undefined || rawProjectId === "") {
        return { projectId: null };
    }


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
    Resolve and authorise a supplier_id coming from a request body.

    Same contract as resolveProjectId.
*/

const resolveSupplierId = async (rawSupplierId, companyId) => {

    if (rawSupplierId === null || rawSupplierId === undefined || rawSupplierId === "") {
        return { supplierId: null };
    }


    const supplierId = parseId(rawSupplierId);


    if (!supplierId) {
        return { error: { status: 400, message: "A valid supplier_id is required" } };
    }


    const owned = await companyOwnsSupplier(supplierId, companyId);


    if (!owned) {
        return { error: { status: 404, message: "Supplier not found" } };
    }


    return { supplierId };

};


/*
    Validate the fields every write shares.

    Returns an error string, or null when the payload is acceptable.
    Only the keys actually present are checked, so this serves both the
    full create and the partial update.

    Date ORDERING and the rented-needs-a-supplier rule are deliberately
    NOT checked here — the database owns assets_rental_dates_valid,
    assets_maintenance_dates_valid and assets_rental_supplier_required,
    and handleError reports each one. A partial update only sees half
    the picture anyway: PUT { "rental_end_date": ... } cannot know the
    stored rental_start_date without a second query.
*/

const validateCommonFields = (body, presentFields) => {

    // name is NOT NULL in the database.

    if (presentFields.includes("name")) {

        const name = body.name;

        if (!name || typeof name !== "string" || name.trim() === "") {
            return "Asset name is required";
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


    if (presentFields.includes("operational_status")) {

        const operationalStatus = body.operational_status;

        if (!operationalStatus || !ALLOWED_OPERATIONAL_STATUSES.includes(operationalStatus)) {
            return `operational_status must be one of: ${ALLOWED_OPERATIONAL_STATUSES.join(", ")}`;
        }

    }


    if (presentFields.includes("ownership_type")) {

        const ownershipType = body.ownership_type;

        if (!ownershipType || !ALLOWED_OWNERSHIP_TYPES.includes(ownershipType)) {
            return `ownership_type must be one of: ${ALLOWED_OWNERSHIP_TYPES.join(", ")}`;
        }

    }


    // asset_type is optional, so only a real value is validated —
    // "" and null clear the field.

    if (presentFields.includes("asset_type")) {

        const assetType = body.asset_type;

        if (assetType !== null && assetType !== undefined && assetType !== "") {

            if (!ALLOWED_ASSET_TYPES.includes(assetType)) {
                return `asset_type must be one of: ${ALLOWED_ASSET_TYPES.join(", ")}`;
            }

        }

    }


    // The optional varchar fields: only length is our concern, and only
    // when a real value was supplied.

    for (const field of ["serial_number", "asset_tag", "location"]) {

        if (!presentFields.includes(field)) {
            continue;
        }

        const value = body[field];

        if (value !== null && value !== undefined && value !== "") {

            if (String(value).trim().length > MAX_LENGTHS[field]) {
                return `${field} must be ${MAX_LENGTHS[field]} characters or fewer`;
            }

        }

    }


    // Dates must be real ISO calendar dates. "" and null clear them.

    for (const field of DATE_FIELDS) {

        if (!presentFields.includes(field)) {
            continue;
        }

        const value = body[field];

        if (value !== null && value !== undefined && value !== "") {

            if (!isValidDateString(value)) {
                return `${field} must be a valid date in YYYY-MM-DD format`;
            }

        }

    }


    // Money must be a non-negative figure the column can hold.

    for (const field of NUMERIC_FIELDS) {

        if (!presentFields.includes(field)) {
            continue;
        }

        const value = body[field];

        if (value !== null && value !== undefined && value !== "") {

            if (!isValidMoney(value)) {
                return `${field} must be a non-negative number no greater than ${MAX_MONEY}`;
            }

        }

    }


    return null;

};


/*
    Reject a rented/leased create that names no supplier BEFORE the
    insert.

    assets_rental_supplier_required would catch it anyway, but only
    after the round trip, and only as a constraint name. On create we
    have the whole picture, so the caller gets the specific message
    immediately. Update is left to the database, where a partial body
    genuinely cannot see the stored ownership_type.
*/

const ownershipNeedsSupplier = (ownershipType, supplierId) => {

    return SUPPLIER_REQUIRED_OWNERSHIP.includes(ownershipType) && !supplierId;

};



/*
    CREATE ASSET

    POST /api/assets

    Body: name (required), asset_type, serial_number, asset_tag,
          location, project_id, supplier_id, ownership_type,
          purchase_date, purchase_cost, rental_start_date,
          rental_end_date, rental_rate, last_maintenance_date,
          next_maintenance_date, operational_status

    company_id is taken from the verified token and is never read from
    the body. status is not accepted either: a new asset always starts
    'active' via the database default.

    ownership_type and operational_status are optional — the database
    defaults them to 'owned' and 'available', and COALESCE below lets
    those defaults apply rather than sending an explicit NULL into a
    NOT NULL column.

    The project and the supplier are both confirmed to belong to the
    authenticated company BEFORE the insert, which is what prevents a
    cross-tenant write.
*/

router.post("/", async (req, res) => {

    try {

        const body = getBody(req);


        const {
            name,
            asset_type,
            serial_number,
            asset_tag,
            location,
            ownership_type,
            purchase_date,
            purchase_cost,
            rental_start_date,
            rental_end_date,
            rental_rate,
            last_maintenance_date,
            next_maintenance_date,
            operational_status
        } = body;


        // name is required on create even though the shared validator
        // only checks the keys that are present.

        if (!name || typeof name !== "string" || name.trim() === "") {

            return res.status(400).json({
                error: "Asset name is required"
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


        // The project must exist and belong to the caller's company.

        const project = await resolveProjectId(body.project_id, req.user.company_id);


        if (project.error) {

            return res.status(project.error.status).json({
                error: project.error.message
            });

        }


        // The supplier must exist and belong to the caller's company.

        const supplier = await resolveSupplierId(body.supplier_id, req.user.company_id);


        if (supplier.error) {

            return res.status(supplier.error.status).json({
                error: supplier.error.message
            });

        }


        if (ownershipNeedsSupplier(ownership_type, supplier.supplierId)) {

            return res.status(400).json({
                error: "supplier_id is required when ownership_type is rented or leased"
            });

        }


        /*
            company_id is the tenant anchor and is NOT NULL in the
            database. It always comes from the verified JWT, never from
            the body.

            The date ordering rules, the identifier uniqueness rules and
            the rented-needs-a-supplier rule are left to the database;
            handleError turns each violation into a 400 or a 409.
        */

        const result = await db.query(
            returningAsset(`
                INSERT INTO assets
                (company_id, name, asset_type, serial_number, asset_tag,
                 location, project_id, supplier_id, ownership_type,
                 purchase_date, purchase_cost, rental_start_date,
                 rental_end_date, rental_rate, last_maintenance_date,
                 next_maintenance_date, operational_status)
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    COALESCE($9, 'owned'),
                    $10::date,
                    $11::numeric,
                    $12::date,
                    $13::date,
                    $14::numeric,
                    $15::date,
                    $16::date,
                    COALESCE($17, 'available')
                )
                RETURNING *
            `),
            [
                req.user.company_id,          // $1 — from the token only
                name.trim(),
                trimOrNull(asset_type),
                trimOrNull(serial_number),
                trimOrNull(asset_tag),
                trimOrNull(location),
                project.projectId,
                supplier.supplierId,
                ownership_type || null,
                purchase_date || null,
                purchase_cost === "" || purchase_cost === undefined ? null : purchase_cost,
                rental_start_date || null,
                rental_end_date || null,
                rental_rate === "" || rental_rate === undefined ? null : rental_rate,
                last_maintenance_date || null,
                next_maintenance_date || null,
                operational_status || null
            ]
        );


        res.status(201).json({
            message: "Asset created successfully",
            asset: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to create asset");

    }

});



/*
    LIST ASSETS

    GET /api/assets
    GET /api/assets?status=active
    GET /api/assets?operational_status=available
    GET /api/assets?asset_type=heavy_equipment
    GET /api/assets?ownership_type=rented
    GET /api/assets?project_id=2
    GET /api/assets?supplier_id=1
    GET /api/assets?unassigned=true
    GET /api/assets?search=excavator
    GET /api/assets?maintenance_due_within_days=30

    Returns only assets belonging to the authenticated company.

    Every filter is optional and they combine with AND. Each one is
    checked against a whitelist, parsed as a number or parsed as a
    boolean before use, and all of them sit behind the company_id
    predicate — so a filter can only ever narrow the result set, never
    widen it past the tenant.

    ?search= is the fuzzy one, matching a substring of the asset name,
    the serial number or the asset tag.

    ?unassigned=true returns assets sitting in no project; false returns
    only deployed ones. Combining it with ?project_id= is permitted and
    simply yields nothing, because the filters are AND-combined.

    ?maintenance_due_within_days=N returns assets due for service on or
    before today + N, INCLUDING those already overdue. That differs
    from ?expiring_within_days= on worker_certifications, which excludes
    the past — but that module has a separate ?expired= filter and this
    one does not, so excluding overdue assets here would leave the most
    urgent kit invisible. The is_maintenance_overdue field on every row
    lets a caller tell the two apart.

    No implicit status filter is applied: an unfiltered list returns
    active and inactive assets alike, and a client that wants only the
    live ones asks for ?status=active.
*/

router.get("/", async (req, res) => {

    try {

        const values = [req.user.company_id];

        const filters = [];


        if (req.query.status !== undefined) {

            const status = req.query.status;


            if (!ALLOWED_STATUSES.includes(status)) {

                return res.status(400).json({
                    error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`
                });

            }


            values.push(status);

            filters.push(`AND a.status = $${values.length}`);

        }


        if (req.query.operational_status !== undefined) {

            const operationalStatus = req.query.operational_status;


            if (!ALLOWED_OPERATIONAL_STATUSES.includes(operationalStatus)) {

                return res.status(400).json({
                    error: `operational_status must be one of: ${ALLOWED_OPERATIONAL_STATUSES.join(", ")}`
                });

            }


            values.push(operationalStatus);

            filters.push(`AND a.operational_status = $${values.length}`);

        }


        /*
            asset_type is a controlled vocabulary in the database, so
            this is an exact match rather than the lower(btrim(...))
            comparison ?service_type= needs on suppliers.
        */

        if (req.query.asset_type !== undefined) {

            const assetType = req.query.asset_type;


            if (!ALLOWED_ASSET_TYPES.includes(assetType)) {

                return res.status(400).json({
                    error: `asset_type must be one of: ${ALLOWED_ASSET_TYPES.join(", ")}`
                });

            }


            values.push(assetType);

            filters.push(`AND a.asset_type = $${values.length}`);

        }


        if (req.query.ownership_type !== undefined) {

            const ownershipType = req.query.ownership_type;


            if (!ALLOWED_OWNERSHIP_TYPES.includes(ownershipType)) {

                return res.status(400).json({
                    error: `ownership_type must be one of: ${ALLOWED_OWNERSHIP_TYPES.join(", ")}`
                });

            }


            values.push(ownershipType);

            filters.push(`AND a.ownership_type = $${values.length}`);

        }


        if (req.query.project_id !== undefined) {

            const projectId = parseId(req.query.project_id);


            if (!projectId) {

                return res.status(400).json({
                    error: "Invalid project_id"
                });

            }


            values.push(projectId);

            filters.push(`AND a.project_id = $${values.length}`);

        }


        if (req.query.supplier_id !== undefined) {

            const supplierId = parseId(req.query.supplier_id);


            if (!supplierId) {

                return res.status(400).json({
                    error: "Invalid supplier_id"
                });

            }


            values.push(supplierId);

            filters.push(`AND a.supplier_id = $${values.length}`);

        }


        if (req.query.unassigned !== undefined) {

            const unassigned = parseBooleanFlag(req.query.unassigned);


            if (unassigned === null) {

                return res.status(400).json({
                    error: "unassigned must be true or false"
                });

            }


            filters.push(
                unassigned
                    ? "AND a.project_id IS NULL"
                    : "AND a.project_id IS NOT NULL"
            );

        }


        /*
            "Due within N days" includes anything already overdue —
            see the route comment above. N = 0 means "due today or
            earlier".

            Combined with ?status=active this is served by the partial
            index idx_assets_next_maintenance (company_id,
            next_maintenance_date) WHERE status = 'active'.
        */

        if (req.query.maintenance_due_within_days !== undefined) {

            const days = parseNonNegativeInt(req.query.maintenance_due_within_days);


            if (days === null) {

                return res.status(400).json({
                    error: "maintenance_due_within_days must be a non-negative integer"
                });

            }


            values.push(days);

            filters.push(`
                AND a.next_maintenance_date IS NOT NULL
                AND a.next_maintenance_date <= CURRENT_DATE + ($${values.length}::int)
            `);

        }


        /*
            Free-text search across the name and the two identifiers.

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
                    a.name ILIKE $${values.length}
                    OR a.serial_number ILIKE $${values.length}
                    OR a.asset_tag ILIKE $${values.length}
                )
            `);

        }


        const result = await db.query(
            `
            ${BASE_SELECT}
            WHERE a.company_id = $1
            ${filters.join(" ")}
            ORDER BY a.created_at DESC, a.id DESC
            `,
            values
        );


        res.json({
            count: result.rowCount,
            assets: result.rows
        });


    } catch(error){

        handleError(error, res, "Failed to fetch assets");

    }

});



/*
    GET SINGLE ASSET

    GET /api/assets/:id

    The company_id in the WHERE clause is what enforces ownership. An
    asset belonging to another company returns 404, not 403, so we
    never confirm that someone else's record exists.
*/

router.get("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid asset id"
            });

        }


        const result = await db.query(
            `
            ${BASE_SELECT}
            WHERE a.id = $1 AND a.company_id = $2
            `,
            [id, req.user.company_id]
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Asset not found"
            });

        }


        res.json({
            asset: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to fetch asset");

    }

});



/*
    UPDATE ASSET

    PUT /api/assets/:id

    Supports partial updates: only the fields present in the request
    body are written. The SET clause is built from a fixed whitelist
    and all values stay parameterised, so this is not SQL-injectable.

    company_id is absent from ALLOWED_FIELDS and so can never be
    changed — an asset cannot be moved between tenants.

    status is writable here, which is what makes a soft delete
    reversible: PUT { "status": "active" } reinstates an asset that
    DELETE had deactivated.

    project_id and supplier_id are writable too, and may be set to null
    to detach the asset from a project or clear its supplier. Both are
    re-authorised against the caller's company before the write.
*/

router.put("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid asset id"
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
            Confirm the asset exists inside this company first, so a
            foreign id is reported as 404 before any other work.
        */

        const existing = await db.query(
            `
            SELECT id
            FROM assets
            WHERE id = $1 AND company_id = $2
            `,
            [id, req.user.company_id]
        );


        if (existing.rowCount === 0) {

            return res.status(404).json({
                error: "Asset not found"
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

            if (REFERENCE_FIELDS.has(field)) {
                continue;   // resolved and authorised below
            }


            const value = body[field];


            if (TRIMMED_FIELDS.has(field)) {

                // name is NOT NULL and the validator has already
                // rejected a blank one, so trimOrNull cannot null it.

                updates[field] = trimOrNull(value);
                continue;

            }


            // Allow explicitly clearing optional fields with null / "".
            // status, operational_status and ownership_type cannot reach
            // this branch with an empty value: the validator above
            // rejects anything outside their whitelists.

            updates[field] = value === "" ? null : value;

        }


        // Re-parking the asset on another project, or detaching it.

        if (fields.includes("project_id")) {

            const project = await resolveProjectId(body.project_id, req.user.company_id);


            if (project.error) {

                return res.status(project.error.status).json({
                    error: project.error.message
                });

            }


            updates.project_id = project.projectId;

        }


        // Changing or clearing the vendor / lessor.

        if (fields.includes("supplier_id")) {

            const supplier = await resolveSupplierId(body.supplier_id, req.user.company_id);


            if (supplier.error) {

                return res.status(supplier.error.status).json({
                    error: supplier.error.message
                });

            }


            updates.supplier_id = supplier.supplierId;

        }


        /*
            Build "name = $1, purchase_date = $2::date, ..." from the
            whitelist. The date and numeric columns carry an explicit
            cast so a text parameter is never ambiguous.
        */

        const columns = Object.keys(updates);

        const setClauses = columns.map((column, index) => {

            const placeholder = `$${index + 1}`;


            if (DATE_FIELDS.has(column)) {
                return `${column} = ${placeholder}::date`;
            }


            if (NUMERIC_FIELDS.has(column)) {
                return `${column} = ${placeholder}::numeric`;
            }


            return `${column} = ${placeholder}`;

        });

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
            returningAsset(`
                UPDATE assets
                SET ${setClauses.join(", ")}
                WHERE id = $${values.length - 1}
                  AND company_id = $${values.length}
                RETURNING *
            `),
            values
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Asset not found"
            });

        }


        res.json({
            message: "Asset updated successfully",
            asset: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to update asset");

    }

});



/*
    DEACTIVATE ASSET

    DELETE /api/assets/:id

    This deactivates the asset instead of physically deleting it.

    An asset is a capital master record that maintenance history and
    future purchase orders will point at — the composite-FK target
    added in migration 003 exists precisely so that asset_maintenance
    and asset_assignments can reference it later. Erasing the row would
    orphan that history, so "delete" here means status = 'inactive' and
    the record stays intact and auditable.

    This matches DELETE on /api/suppliers (deactivates),
    /api/workers (deactivates), /api/worker-assignments (cancels) and
    /api/worker-certifications (revokes).

    operational_status is deliberately left alone: writing an asset off
    the books says nothing about whether it was in the workshop at the
    time. project_id is left alone too, so the record still shows where
    the asset was when it was retired.

    The company_id predicate scopes the update, so another company's
    asset simply matches zero rows and reads back as 404.

    The call is idempotent: deactivating an already-inactive asset
    succeeds and returns the unchanged row.
*/

router.delete("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);


        if (!id) {

            return res.status(400).json({
                error: "Invalid asset id"
            });

        }


        const result = await db.query(
            returningAsset(`
                UPDATE assets
                SET status = $1
                WHERE id = $2 AND company_id = $3
                RETURNING *
            `),
            [INACTIVE_STATUS, id, req.user.company_id]
        );


        if (result.rowCount === 0) {

            return res.status(404).json({
                error: "Asset not found"
            });

        }


        res.json({
            message: "Asset deactivated successfully",
            asset: result.rows[0]
        });


    } catch(error){

        handleError(error, res, "Failed to deactivate asset");

    }

});


module.exports = router;
