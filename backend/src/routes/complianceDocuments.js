const express = require("express");
const db = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();


/*
    COMPLIANCE DOCUMENTS MODULE

    Every route in this file is protected by authMiddleware.

    A compliance document belongs to exactly one scope:
    company, project, contractor, asset or supplier. Company-scoped
    documents have no parent id; every other scope has exactly its own
    parent id and no others. Migration 004 enforces that with
    compliance_documents_scope_xor.

    Table: compliance_documents
    (id, company_id, scope_type, project_id, contractor_id, asset_id,
     supplier_id, name, document_type, issuing_authority,
     reference_number, issued_date, expiry_date, document_url, status,
     verification_status, created_at)

    company_id is the tenant anchor and is NOT NULL. It always comes
    from the verified JWT (req.user.company_id) and is never read from
    the body or query string.

    Expiry is derived from expiry_date on each read. There is no stored
    "expired" state and no automatic expiry job.
*/


router.use(authMiddleware);


const ALLOWED_FIELDS = [
    "scope_type",
    "project_id",
    "contractor_id",
    "asset_id",
    "supplier_id",
    "name",
    "document_type",
    "issuing_authority",
    "reference_number",
    "issued_date",
    "expiry_date",
    "document_url",
    "status",
    "verification_status"
];


// New documents always start active through the database default.

const CREATE_FIELDS = ALLOWED_FIELDS.filter((field) => field !== "status");


const ALLOWED_SCOPE_TYPES = [
    "company",
    "project",
    "contractor",
    "asset",
    "supplier"
];


const SCOPE_PARENT_FIELDS = {
    company: null,
    project: "project_id",
    contractor: "contractor_id",
    asset: "asset_id",
    supplier: "supplier_id"
};


const PARENT_FIELDS = [
    "project_id",
    "contractor_id",
    "asset_id",
    "supplier_id"
];


const PARENT_LABELS = {
    project: "Project",
    contractor: "Contractor",
    asset: "Asset",
    supplier: "Supplier"
};


const ALLOWED_DOCUMENT_TYPES = [
    "safety_certificate",
    "insurance",
    "environmental_permit",
    "operating_licence",
    "inspection_certificate",
    "regulatory_approval",
    "tax_compliance",
    "other"
];


const ALLOWED_STATUSES = [
    "active",
    "inactive"
];


const ALLOWED_VERIFICATION_STATUSES = [
    "pending",
    "verified",
    "rejected"
];


const INACTIVE_STATUS = "inactive";


const MAX_LENGTHS = {
    name: 255,
    document_type: 50,
    issuing_authority: 255,
    reference_number: 100
};


const DATE_FIELDS = new Set([
    "issued_date",
    "expiry_date"
]);


const REFERENCE_FIELDS = new Set(PARENT_FIELDS);


const TRIMMED_FIELDS = new Set([
    "name",
    "issuing_authority",
    "reference_number",
    "document_url"
]);


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


/*
    Every read returns the same explicit shape, including parent names
    and derived expiry fields. Parent joins are deliberately redundant
    on company_id so a missing tenant predicate in one place cannot leak
    another company's parent row.
*/

const COMPLIANCE_DOCUMENT_COLUMNS = `
        cd.id,
        cd.company_id,
        cd.scope_type,
        cd.project_id,
        p.name AS project_name,
        p.status AS project_status,
        cd.contractor_id,
        c.company_name AS contractor_name,
        c.certification_status AS contractor_certification_status,
        cd.asset_id,
        a.name AS asset_name,
        a.status AS asset_status,
        a.operational_status AS asset_operational_status,
        cd.supplier_id,
        s.name AS supplier_name,
        s.status AS supplier_status,
        s.verification_status AS supplier_verification_status,
        cd.name,
        cd.document_type,
        cd.issuing_authority,
        cd.reference_number,
        cd.issued_date::text AS issued_date,
        cd.expiry_date::text AS expiry_date,
        cd.document_url,
        cd.status,
        cd.verification_status,
        cd.created_at,
        (
            cd.expiry_date IS NOT NULL
            AND cd.expiry_date < CURRENT_DATE
        ) AS is_expired,
        CASE
            WHEN cd.expiry_date IS NULL THEN NULL
            ELSE (cd.expiry_date - CURRENT_DATE)
        END AS days_until_expiry
`;

const COMPLIANCE_DOCUMENT_JOINS = `
    LEFT JOIN projects p
           ON p.id = cd.project_id
          AND p.company_id = cd.company_id
    LEFT JOIN contractors c
           ON c.id = cd.contractor_id
          AND c.company_id = cd.company_id
    LEFT JOIN assets a
           ON a.id = cd.asset_id
          AND a.company_id = cd.company_id
    LEFT JOIN suppliers s
           ON s.id = cd.supplier_id
          AND s.company_id = cd.company_id
`;

const BASE_SELECT = `
    SELECT ${COMPLIANCE_DOCUMENT_COLUMNS}
    FROM compliance_documents cd
    ${COMPLIANCE_DOCUMENT_JOINS}
`;


const returningComplianceDocument = (cte) => `
    WITH changed AS (
        ${cte}
    )
    SELECT ${COMPLIANCE_DOCUMENT_COLUMNS}
    FROM changed cd
    ${COMPLIANCE_DOCUMENT_JOINS}
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

    let id;

    if (typeof value === "number") {
        id = value;
    } else if (typeof value === "string") {

        const trimmed = value.trim();

        if (trimmed === "" || !/^\d+$/.test(trimmed)) {
            return null;
        }

        id = Number(trimmed);

    } else {
        return null;
    }

    if (!Number.isSafeInteger(id) || id < 1) {
        return null;
    }

    return id;

};


const parseNonNegativeInt = (value) => {

    let parsed;

    if (typeof value === "number") {
        parsed = value;
    } else if (typeof value === "string") {

        const trimmed = value.trim();

        if (trimmed === "" || !/^\d+$/.test(trimmed)) {
            return null;
        }

        parsed = Number(trimmed);

    } else {
        return null;
    }

    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        return null;
    }

    return parsed;

};


const parseBooleanFlag = (value) => {

    if (value === "true") {
        return true;
    }

    if (value === "false") {
        return false;
    }

    return null;

};


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
            error: "Compliance document conflicts with an existing record"
        });
    }

    if (error.code === "23514") {

        if (error.constraint === "compliance_documents_scope_type_valid") {
            return res.status(400).json({
                error: `scope_type must be one of: ${ALLOWED_SCOPE_TYPES.join(", ")}`
            });
        }

        if (error.constraint === "compliance_documents_scope_xor") {
            return res.status(400).json({
                error: "Compliance document must have exactly one matching scope"
            });
        }

        if (error.constraint === "compliance_documents_document_type_valid") {
            return res.status(400).json({
                error: `document_type must be one of: ${ALLOWED_DOCUMENT_TYPES.join(", ")}`
            });
        }

        if (error.constraint === "compliance_documents_status_valid") {
            return res.status(400).json({
                error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`
            });
        }

        if (error.constraint === "compliance_documents_verification_status_valid") {
            return res.status(400).json({
                error: `verification_status must be one of: ${ALLOWED_VERIFICATION_STATUSES.join(", ")}`
            });
        }

        if (error.constraint === "compliance_documents_dates_valid") {
            return res.status(400).json({
                error: "expiry_date must be on or after issued_date"
            });
        }

        return res.status(400).json({
            error: "Compliance document violates a database rule"
        });

    }

    if (error.code === "23503") {

        if (error.constraint === "compliance_documents_project_same_company") {
            return res.status(400).json({
                error: "Project not found"
            });
        }

        if (error.constraint === "compliance_documents_contractor_same_company") {
            return res.status(400).json({
                error: "Contractor not found"
            });
        }

        if (error.constraint === "compliance_documents_asset_same_company") {
            return res.status(400).json({
                error: "Asset not found"
            });
        }

        if (error.constraint === "compliance_documents_supplier_same_company") {
            return res.status(400).json({
                error: "Supplier not found"
            });
        }

        return res.status(400).json({
            error: "Company not found"
        });

    }

    if (error.code === "22001") {
        return res.status(400).json({
            error: "A field value is longer than the column allows"
        });
    }

    if (error.code === "22003") {
        return res.status(400).json({
            error: "A numeric value is outside the range the column allows"
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


const companyOwnsAsset = async (assetId, companyId) => {

    const result = await db.query(
        `
        SELECT id
        FROM assets
        WHERE id = $1 AND company_id = $2
        `,
        [assetId, companyId]
    );

    return result.rowCount > 0;

};


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


const PARENT_OWNERSHIP_CHECKS = {
    project: companyOwnsProject,
    contractor: companyOwnsContractor,
    asset: companyOwnsAsset,
    supplier: companyOwnsSupplier
};


const buildScopeValues = (scopeType, parentId) => {

    const values = {
        scope_type: scopeType,
        project_id: null,
        contractor_id: null,
        asset_id: null,
        supplier_id: null
    };

    const parentField = SCOPE_PARENT_FIELDS[scopeType];

    if (parentField) {
        values[parentField] = parentId;
    }

    return values;

};


const hasParentValue = (value) => {
    return value !== null && value !== undefined && value !== "";
};


const findContradictoryParentField = (body, scopeType) => {

    const matchingParentField = SCOPE_PARENT_FIELDS[scopeType];

    for (const field of PARENT_FIELDS) {

        if (field === matchingParentField || !hasOwn(body, field)) {
            continue;
        }

        if (hasParentValue(body[field])) {
            return field;
        }

    }

    return null;

};


const resolveScopedParentId = async (scopeType, rawParentId, companyId) => {

    const parentField = SCOPE_PARENT_FIELDS[scopeType];

    if (!parentField) {
        return { parentId: null };
    }

    if (rawParentId === null || rawParentId === undefined || rawParentId === "") {
        return {
            error: {
                status: 400,
                message: `${parentField} is required when scope_type is ${scopeType}`
            }
        };
    }

    const parentId = parseId(rawParentId);

    if (!parentId) {
        return {
            error: {
                status: 400,
                message: `A valid ${parentField} is required`
            }
        };
    }

    const ownsParent = await PARENT_OWNERSHIP_CHECKS[scopeType](parentId, companyId);

    if (!ownsParent) {
        return {
            error: {
                status: 404,
                message: `${PARENT_LABELS[scopeType]} not found`
            }
        };
    }

    return { parentId };

};


const resolveScopeForCreate = async (body, companyId) => {

    const scopeType = body.scope_type;

    if (!scopeType) {
        return {
            error: {
                status: 400,
                message: "scope_type is required"
            }
        };
    }

    if (!ALLOWED_SCOPE_TYPES.includes(scopeType)) {
        return {
            error: {
                status: 400,
                message: `scope_type must be one of: ${ALLOWED_SCOPE_TYPES.join(", ")}`
            }
        };
    }

    const parentField = SCOPE_PARENT_FIELDS[scopeType];
    const contradictoryParentField = findContradictoryParentField(body, scopeType);

    if (contradictoryParentField) {
        return {
            error: {
                status: 400,
                message: `${contradictoryParentField} cannot be set when scope_type is ${scopeType}`
            }
        };
    }

    if (!parentField) {
        return { updates: buildScopeValues(scopeType, null) };
    }

    if (!hasOwn(body, parentField)) {
        return {
            error: {
                status: 400,
                message: `${parentField} is required when scope_type is ${scopeType}`
            }
        };
    }

    const parent = await resolveScopedParentId(scopeType, body[parentField], companyId);

    if (parent.error) {
        return parent;
    }

    return { updates: buildScopeValues(scopeType, parent.parentId) };

};


const resolveScopeForUpdate = async (body, fields, existing, companyId) => {

    if (fields.includes("scope_type")) {

        const scopeType = body.scope_type;
        const parentField = SCOPE_PARENT_FIELDS[scopeType];
        const contradictoryParentField = findContradictoryParentField(body, scopeType);

        if (contradictoryParentField) {
            return {
                error: {
                    status: 400,
                    message: `${contradictoryParentField} cannot be set when scope_type is ${scopeType}`
                }
            };
        }

        if (!parentField) {
            return { updates: buildScopeValues(scopeType, null) };
        }

        if (!hasOwn(body, parentField)) {
            return {
                error: {
                    status: 400,
                    message: `${parentField} is required when scope_type is ${scopeType}`
                }
            };
        }

        const parent = await resolveScopedParentId(scopeType, body[parentField], companyId);

        if (parent.error) {
            return parent;
        }

        return { updates: buildScopeValues(scopeType, parent.parentId) };

    }

    const parentFields = PARENT_FIELDS.filter((field) => fields.includes(field));

    if (parentFields.length === 0) {
        return { updates: {} };
    }

    const updates = {};
    const scopeType = existing.scope_type;
    const matchingParentField = SCOPE_PARENT_FIELDS[scopeType];

    if (!matchingParentField) {

        for (const field of parentFields) {

            const value = body[field];

            if (value !== null && value !== undefined && value !== "") {
                return {
                    error: {
                        status: 400,
                        message: `${field} cannot be set when scope_type is company`
                    }
                };
            }

            updates[field] = null;

        }

        return { updates };

    }

    for (const field of parentFields) {

        if (field === matchingParentField) {
            continue;
        }

        const value = body[field];

        if (value !== null && value !== undefined && value !== "") {
            return {
                error: {
                    status: 400,
                    message: `${field} cannot be set when scope_type is ${scopeType}`
                }
            };
        }

        updates[field] = null;

    }

    if (fields.includes(matchingParentField)) {

        const parent = await resolveScopedParentId(
            scopeType,
            body[matchingParentField],
            companyId
        );

        if (parent.error) {
            return parent;
        }

        updates[matchingParentField] = parent.parentId;

    }

    return { updates };

};


const validateOptionalString = (body, field) => {

    const value = body[field];

    if (value === null || value === undefined || value === "") {
        return null;
    }

    if (typeof value !== "string") {
        return `${field} must be a string`;
    }

    if (MAX_LENGTHS[field] && value.trim().length > MAX_LENGTHS[field]) {
        return `${field} must be ${MAX_LENGTHS[field]} characters or fewer`;
    }

    return null;

};


const validateCommonFields = (body, presentFields) => {

    if (presentFields.includes("scope_type")) {

        const scopeType = body.scope_type;

        if (!scopeType || typeof scopeType !== "string" || !ALLOWED_SCOPE_TYPES.includes(scopeType)) {
            return `scope_type must be one of: ${ALLOWED_SCOPE_TYPES.join(", ")}`;
        }

    }

    if (presentFields.includes("name")) {

        const name = body.name;

        if (!name || typeof name !== "string" || name.trim() === "") {
            return "Compliance document name is required";
        }

        if (name.trim().length > MAX_LENGTHS.name) {
            return `name must be ${MAX_LENGTHS.name} characters or fewer`;
        }

    }

    if (presentFields.includes("document_type")) {

        const documentType = body.document_type;

        if (!documentType || typeof documentType !== "string" || !ALLOWED_DOCUMENT_TYPES.includes(documentType)) {
            return `document_type must be one of: ${ALLOWED_DOCUMENT_TYPES.join(", ")}`;
        }

    }

    if (presentFields.includes("status")) {

        const status = body.status;

        if (!status || typeof status !== "string" || !ALLOWED_STATUSES.includes(status)) {
            return `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`;
        }

    }

    if (presentFields.includes("verification_status")) {

        const verificationStatus = body.verification_status;

        if (!verificationStatus
            || typeof verificationStatus !== "string"
            || !ALLOWED_VERIFICATION_STATUSES.includes(verificationStatus)) {
            return `verification_status must be one of: ${ALLOWED_VERIFICATION_STATUSES.join(", ")}`;
        }

    }

    for (const field of ["issuing_authority", "reference_number"]) {

        if (!presentFields.includes(field)) {
            continue;
        }

        const error = validateOptionalString(body, field);

        if (error) {
            return error;
        }

    }

    if (presentFields.includes("document_url")) {

        const value = body.document_url;

        if (value !== null && value !== undefined && value !== "" && typeof value !== "string") {
            return "document_url must be a string";
        }

    }

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

    return null;

};


/*
    CREATE COMPLIANCE DOCUMENT

    POST /api/compliance-documents
*/

router.post("/", async (req, res) => {

    try {

        const body = getBody(req);

        const {
            name,
            document_type,
            issuing_authority,
            reference_number,
            issued_date,
            expiry_date,
            document_url,
            verification_status
        } = body;

        if (!name || typeof name !== "string" || name.trim() === "") {
            return res.status(400).json({
                error: "Compliance document name is required"
            });
        }

        if (!document_type || typeof document_type !== "string") {
            return res.status(400).json({
                error: "document_type is required"
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

        const scope = await resolveScopeForCreate(body, req.user.company_id);

        if (scope.error) {
            return res.status(scope.error.status).json({
                error: scope.error.message
            });
        }

        const result = await db.query(
            returningComplianceDocument(`
                INSERT INTO compliance_documents
                (company_id, scope_type, project_id, contractor_id, asset_id,
                 supplier_id, name, document_type, issuing_authority,
                 reference_number, issued_date, expiry_date, document_url,
                 verification_status)
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9,
                    $10,
                    $11::date,
                    $12::date,
                    $13,
                    COALESCE($14, 'pending')
                )
                RETURNING *
            `),
            [
                req.user.company_id,
                scope.updates.scope_type,
                scope.updates.project_id,
                scope.updates.contractor_id,
                scope.updates.asset_id,
                scope.updates.supplier_id,
                name.trim(),
                document_type,
                trimOrNull(issuing_authority),
                trimOrNull(reference_number),
                issued_date || null,
                expiry_date || null,
                trimOrNull(document_url),
                verification_status || null
            ]
        );

        res.status(201).json({
            message: "Compliance document created successfully",
            compliance_document: result.rows[0]
        });

    } catch(error){

        handleError(error, res, "Failed to create compliance document");

    }

});


/*
    LIST COMPLIANCE DOCUMENTS

    GET /api/compliance-documents
*/

router.get("/", async (req, res) => {

    try {

        const values = [req.user.company_id];
        const filters = [];

        if (req.query.scope_type !== undefined) {

            const scopeType = req.query.scope_type;

            if (!ALLOWED_SCOPE_TYPES.includes(scopeType)) {
                return res.status(400).json({
                    error: `scope_type must be one of: ${ALLOWED_SCOPE_TYPES.join(", ")}`
                });
            }

            values.push(scopeType);
            filters.push(`AND cd.scope_type = $${values.length}`);

        }

        for (const field of PARENT_FIELDS) {

            if (req.query[field] === undefined) {
                continue;
            }

            const id = parseId(req.query[field]);

            if (!id) {
                return res.status(400).json({
                    error: `Invalid ${field}`
                });
            }

            values.push(id);
            filters.push(`AND cd.${field} = $${values.length}`);

        }

        if (req.query.document_type !== undefined) {

            const documentType = req.query.document_type;

            if (!ALLOWED_DOCUMENT_TYPES.includes(documentType)) {
                return res.status(400).json({
                    error: `document_type must be one of: ${ALLOWED_DOCUMENT_TYPES.join(", ")}`
                });
            }

            values.push(documentType);
            filters.push(`AND cd.document_type = $${values.length}`);

        }

        if (req.query.status !== undefined) {

            const status = req.query.status;

            if (!ALLOWED_STATUSES.includes(status)) {
                return res.status(400).json({
                    error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`
                });
            }

            values.push(status);
            filters.push(`AND cd.status = $${values.length}`);

        }

        if (req.query.verification_status !== undefined) {

            const verificationStatus = req.query.verification_status;

            if (!ALLOWED_VERIFICATION_STATUSES.includes(verificationStatus)) {
                return res.status(400).json({
                    error: `verification_status must be one of: ${ALLOWED_VERIFICATION_STATUSES.join(", ")}`
                });
            }

            values.push(verificationStatus);
            filters.push(`AND cd.verification_status = $${values.length}`);

        }

        if (req.query.expiring_within_days !== undefined) {

            const days = parseNonNegativeInt(req.query.expiring_within_days);

            if (days === null) {
                return res.status(400).json({
                    error: "expiring_within_days must be a non-negative integer"
                });
            }

            values.push(days);
            filters.push(`
                AND cd.expiry_date IS NOT NULL
                AND cd.expiry_date >= CURRENT_DATE
                AND cd.expiry_date <= CURRENT_DATE + ($${values.length}::int)
            `);

        }

        if (req.query.expired !== undefined) {

            const expired = parseBooleanFlag(req.query.expired);

            if (expired === null) {
                return res.status(400).json({
                    error: "expired must be true or false"
                });
            }

            filters.push(
                expired
                    ? "AND cd.expiry_date IS NOT NULL AND cd.expiry_date < CURRENT_DATE"
                    : "AND (cd.expiry_date IS NULL OR cd.expiry_date >= CURRENT_DATE)"
            );

        }

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
                    cd.name ILIKE $${values.length}
                    OR cd.issuing_authority ILIKE $${values.length}
                    OR cd.reference_number ILIKE $${values.length}
                    OR cd.document_url ILIKE $${values.length}
                )
            `);

        }

        const result = await db.query(
            `
            ${BASE_SELECT}
            WHERE cd.company_id = $1
            ${filters.join(" ")}
            ORDER BY cd.expiry_date ASC NULLS LAST, cd.id DESC
            `,
            values
        );

        res.json({
            count: result.rowCount,
            compliance_documents: result.rows
        });

    } catch(error){

        handleError(error, res, "Failed to fetch compliance documents");

    }

});


/*
    GET SINGLE COMPLIANCE DOCUMENT

    GET /api/compliance-documents/:id
*/

router.get("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);

        if (!id) {
            return res.status(400).json({
                error: "Invalid compliance document id"
            });
        }

        const result = await db.query(
            `
            ${BASE_SELECT}
            WHERE cd.id = $1 AND cd.company_id = $2
            `,
            [id, req.user.company_id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                error: "Compliance document not found"
            });
        }

        res.json({
            compliance_document: result.rows[0]
        });

    } catch(error){

        handleError(error, res, "Failed to fetch compliance document");

    }

});


/*
    UPDATE COMPLIANCE DOCUMENT

    PUT /api/compliance-documents/:id
*/

router.put("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);

        if (!id) {
            return res.status(400).json({
                error: "Invalid compliance document id"
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
            SELECT id, scope_type, project_id, contractor_id, asset_id, supplier_id
            FROM compliance_documents
            WHERE id = $1 AND company_id = $2
            `,
            [id, req.user.company_id]
        );

        if (existing.rowCount === 0) {
            return res.status(404).json({
                error: "Compliance document not found"
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

            if (field === "scope_type" || REFERENCE_FIELDS.has(field)) {
                continue;
            }

            const value = body[field];

            if (TRIMMED_FIELDS.has(field)) {
                updates[field] = trimOrNull(value);
                continue;
            }

            updates[field] = value === "" ? null : value;

        }

        const scope = await resolveScopeForUpdate(
            body,
            fields,
            existing.rows[0],
            req.user.company_id
        );

        if (scope.error) {
            return res.status(scope.error.status).json({
                error: scope.error.message
            });
        }

        Object.assign(updates, scope.updates);

        const columns = Object.keys(updates);

        const setClauses = columns.map((column, index) => {

            const placeholder = `$${index + 1}`;

            if (DATE_FIELDS.has(column)) {
                return `${column} = ${placeholder}::date`;
            }

            return `${column} = ${placeholder}`;

        });

        const values = columns.map((column) => updates[column]);

        values.push(id, req.user.company_id);

        const result = await db.query(
            returningComplianceDocument(`
                UPDATE compliance_documents
                SET ${setClauses.join(", ")}
                WHERE id = $${values.length - 1}
                  AND company_id = $${values.length}
                RETURNING *
            `),
            values
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                error: "Compliance document not found"
            });
        }

        res.json({
            message: "Compliance document updated successfully",
            compliance_document: result.rows[0]
        });

    } catch(error){

        handleError(error, res, "Failed to update compliance document");

    }

});


/*
    DEACTIVATE COMPLIANCE DOCUMENT

    DELETE /api/compliance-documents/:id

    Soft delete only. Parent relationships and verification_status are
    deliberately left unchanged, and PUT can reactivate the record.
*/

router.delete("/:id", async (req, res) => {

    try {

        const id = parseId(req.params.id);

        if (!id) {
            return res.status(400).json({
                error: "Invalid compliance document id"
            });
        }

        const result = await db.query(
            returningComplianceDocument(`
                UPDATE compliance_documents
                SET status = $1
                WHERE id = $2 AND company_id = $3
                RETURNING *
            `),
            [INACTIVE_STATUS, id, req.user.company_id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                error: "Compliance document not found"
            });
        }

        res.json({
            message: "Compliance document deactivated successfully",
            compliance_document: result.rows[0]
        });

    } catch(error){

        handleError(error, res, "Failed to deactivate compliance document");

    }

});


module.exports = router;
