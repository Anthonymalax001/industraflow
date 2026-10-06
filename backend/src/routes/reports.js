const express = require("express");
const db = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authMiddleware);

const MAX_PAGE_SIZE = 200;

const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"];
const WORKER_STATUSES = ["active", "inactive", "suspended", "terminated"];
const WORKER_EMPLOYMENT_TYPES = ["direct", "contractor"];
const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"];
const INCIDENT_STATUSES = ["open", "investigating", "resolved", "closed", "cancelled"];
const INCIDENT_TYPES = [
  "accident",
  "near_miss",
  "injury",
  "property_damage",
  "environmental",
  "fire",
  "security",
  "other"
];
const PERMIT_TYPES = [
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
const PERMIT_RISK_LEVELS = ["low", "medium", "high", "critical"];
const PERMIT_STATUSES = [
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
const COMPLIANCE_SCOPE_TYPES = ["company", "project", "contractor", "asset", "supplier"];
const COMPLIANCE_DOCUMENT_TYPES = [
  "safety_certificate",
  "insurance",
  "environmental_permit",
  "operating_licence",
  "inspection_certificate",
  "regulatory_approval",
  "tax_compliance",
  "other"
];
const COMPLIANCE_VERIFICATION_STATUSES = ["pending", "verified", "rejected"];
const ASSET_STATUSES = ["active", "inactive"];
const ASSET_OPERATIONAL_STATUSES = ["available", "in_use", "under_maintenance", "out_of_service"];
const CONTRACTOR_CERTIFICATION_STATUSES = ["pending", "verified", "expired", "rejected"];

const makeEnvelope = (reportType, period, summary, sections, items) => ({
  generated_at: new Date().toISOString(),
  report_type: reportType,
  period: {
    scope: period.scope,
    from: period.from ? period.from.toISOString().slice(0, 10) : null,
    to: period.to ? period.to.toISOString().slice(0, 10) : null
  },
  summary,
  sections,
  items
});

const parsePositiveInteger = (value, label, defaultValue = null) => {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }

  return parsed;
};

const parseDateValue = (value, label) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} is not a valid date`);
  }

  return parsed;
};

const parsePeriod = (req) => {
  const hasFrom = Object.prototype.hasOwnProperty.call(req.query, "from");
  const hasTo = Object.prototype.hasOwnProperty.call(req.query, "to");

  if (!hasFrom && !hasTo) {
    return { scope: "snapshot", from: null, to: null };
  }

  if (!hasFrom || !hasTo) {
    throw new Error("Both from and to must be supplied together");
  }

  const from = parseDateValue(req.query.from, "from");
  const to = parseDateValue(req.query.to, "to");

  if (!from || !to) {
    throw new Error("Both from and to must be valid dates");
  }

  if (from > to) {
    throw new Error("from must be less than or equal to to");
  }

  return { scope: "period", from, to };
};

const parseEnumValue = (value, allowedValues, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const normalized = String(value).trim();

  if (!allowedValues.includes(normalized)) {
    throw new Error(`${fieldName} must be one of: ${allowedValues.join(", ")}`);
  }

  return normalized;
};

const validateCompanyResource = async (tableName, id, companyId, resourceLabel) => {
  if (id === null || id === undefined || id === "") {
    return null;
  }

  const parsed = Number(id);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${resourceLabel} ID is invalid`);
  }

  const result = await db.query(
    `SELECT id FROM ${tableName} WHERE id = $1 AND company_id = $2`,
    [parsed, companyId]
  );

  if (result.rows.length === 0) {
    const error = new Error(`${resourceLabel} not found`);
    error.statusCode = 404;
    throw error;
  }

  return parsed;
};

const getPagination = (req) => {
  const page = parsePositiveInteger(req.query.page, "page", 1);
  const limit = parsePositiveInteger(req.query.limit, "limit", 25);

  if (limit > MAX_PAGE_SIZE) {
    throw new Error(`limit must be between 1 and ${MAX_PAGE_SIZE}`);
  }

  return { page, limit, offset: (page - 1) * limit };
};

const companySummary = async (companyId) => {
  const result = await db.query(
    `
      SELECT id, name, country, industry
      FROM companies
      WHERE id = $1
    `,
    [companyId]
  );

  return result.rows[0] || null;
};

const projectStatusBreakdown = async (companyId) => {
  const result = await db.query(
    `
      SELECT status, COUNT(*)::int AS count
      FROM projects
      WHERE company_id = $1
      GROUP BY status
      ORDER BY count DESC, status ASC
    `,
    [companyId]
  );

  return result.rows;
};

const permitStatusBreakdown = async (companyId) => {
  const result = await db.query(
    `
      SELECT status, COUNT(*)::int AS count
      FROM work_permits
      WHERE company_id = $1
      GROUP BY status
      ORDER BY count DESC, status ASC
    `,
    [companyId]
  );

  return result.rows;
};

const incidentSeverityBreakdown = async (companyId) => {
  const result = await db.query(
    `
      SELECT severity, COUNT(*)::int AS count
      FROM incidents
      WHERE company_id = $1
      GROUP BY severity
      ORDER BY count DESC, severity ASC
    `,
    [companyId]
  );

  return result.rows;
};

const complianceVerificationBreakdown = async (companyId) => {
  const result = await db.query(
    `
      SELECT verification_status, COUNT(*)::int AS count
      FROM compliance_documents
      WHERE company_id = $1
      GROUP BY verification_status
      ORDER BY count DESC, verification_status ASC
    `,
    [companyId]
  );

  return result.rows;
};

const renderSections = (rows, labelKey, countKey, title) => ({
  title,
  items: rows.map((row) => ({
    [labelKey]: row[labelKey] || "unknown",
    [countKey]: Number(row.count) || 0
  }))
});

const handleReportError = (res, error) => {
  console.error(error);

  if (error && error.statusCode === 404) {
    return res.status(404).json({ error: error.message });
  }

  if (error.message && (
    error.message.includes("Both from and to") ||
    error.message.includes("is not a valid date") ||
    error.message.includes("must be valid dates") ||
    error.message.includes("must be less than or equal to to") ||
    error.message.includes("must be a positive integer") ||
    error.message.includes("must be between 1 and") ||
    error.message.includes("must be one of:") ||
    error.message.includes("ID is invalid") ||
    error.message.includes("must be supplied together")
  )) {
    return res.status(400).json({ error: error.message });
  }

  return res.status(500).json({ error: "Unable to generate report" });
};

router.get("/executive", async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const period = parsePeriod(req);

    const company = await companySummary(companyId);

    const summaryQuery = await db.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM workers WHERE company_id = $1) AS total_workers,
          (SELECT COUNT(*)::int FROM workers WHERE company_id = $1 AND status = 'active') AS active_workers,
          (SELECT COUNT(*)::int FROM projects WHERE company_id = $1 AND status = 'active') AS active_projects,
          (SELECT COUNT(*)::int FROM work_permits WHERE company_id = $1 AND status = 'active') AS active_permits,
          (SELECT COUNT(*)::int FROM incidents WHERE company_id = $1 AND status = 'open') AS open_incidents,
          (SELECT COUNT(*)::int FROM assets WHERE company_id = $1 AND operational_status = 'under_maintenance') AS assets_under_maintenance,
          (SELECT COUNT(*)::int FROM worker_certifications WHERE company_id = $1 AND status = 'valid' AND expiry_date IS NOT NULL AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days') AS certifications_expiring_soon,
          (SELECT COUNT(*)::int FROM compliance_documents WHERE company_id = $1 AND status = 'active' AND expiry_date IS NOT NULL AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days') AS compliance_documents_expiring_soon
      `,
      [companyId]
    );

    const summaryRow = summaryQuery.rows[0];
    const projectBreakdown = await projectStatusBreakdown(companyId);
    const permitBreakdown = await permitStatusBreakdown(companyId);
    const incidentBreakdown = await incidentSeverityBreakdown(companyId);
    const complianceBreakdown = await complianceVerificationBreakdown(companyId);

    const summary = {
      company: {
        name: company ? company.name : null,
        country: company ? company.country : null,
        industry: company ? company.industry : null
      },
      total_workers: Number(summaryRow.total_workers || 0),
      active_workers: Number(summaryRow.active_workers || 0),
      active_projects: Number(summaryRow.active_projects || 0),
      active_permits: Number(summaryRow.active_permits || 0),
      open_incidents: Number(summaryRow.open_incidents || 0),
      assets_under_maintenance: Number(summaryRow.assets_under_maintenance || 0),
      certifications_expiring_soon: Number(summaryRow.certifications_expiring_soon || 0),
      compliance_documents_expiring_soon: Number(summaryRow.compliance_documents_expiring_soon || 0)
    };

    const sections = [
      renderSections(projectBreakdown, "status", "count", "Project status breakdown"),
      renderSections(permitBreakdown, "status", "count", "Permit status breakdown"),
      renderSections(incidentBreakdown, "severity", "count", "Incident severity breakdown"),
      renderSections(complianceBreakdown, "verification_status", "count", "Compliance verification breakdown")
    ];

    res.json(makeEnvelope("executive", period, summary, sections, []));
  } catch (error) {
    return handleReportError(res, error);
  }
});

router.get("/workforce", async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const period = parsePeriod(req);
    const { page, limit, offset } = getPagination(req);

    const projectId = req.query.project_id !== undefined ? await validateCompanyResource("projects", req.query.project_id, companyId, "Project") : null;
    const workerId = req.query.worker_id !== undefined ? await validateCompanyResource("workers", req.query.worker_id, companyId, "Worker") : null;
    const contractorId = req.query.contractor_id !== undefined ? await validateCompanyResource("contractors", req.query.contractor_id, companyId, "Contractor") : null;

    const status = parseEnumValue(req.query.status, WORKER_STATUSES, "status");
    const employmentType = parseEnumValue(req.query.employment_type, WORKER_EMPLOYMENT_TYPES, "employment_type");

    const whereClauses = ["w.company_id = $1"];
    const params = [companyId];
    let paramIndex = 2;

    if (projectId !== null) {
      whereClauses.push(`w.id IN (SELECT worker_id FROM worker_assignments WHERE company_id = $${paramIndex} AND project_id = $${paramIndex + 1})`);
      params.push(companyId, projectId);
      paramIndex += 2;
    }

    if (workerId !== null) {
      whereClauses.push(`w.id = $${paramIndex}`);
      params.push(workerId);
      paramIndex += 1;
    }

    if (contractorId !== null) {
      whereClauses.push(`w.contractor_id = $${paramIndex}`);
      params.push(contractorId);
      paramIndex += 1;
    }

    if (status) {
      whereClauses.push(`w.status = $${paramIndex}`);
      params.push(status);
      paramIndex += 1;
    }

    if (employmentType) {
      whereClauses.push(`w.employment_type = $${paramIndex}`);
      params.push(employmentType);
      paramIndex += 1;
    }

    const summaryQuery = await db.query(
      `
        SELECT
          COUNT(*)::int AS total_workers,
          COUNT(*) FILTER (WHERE w.status = 'active')::int AS active_workers,
          COUNT(*) FILTER (WHERE w.status = 'inactive')::int AS inactive_workers,
          COUNT(*) FILTER (WHERE w.status = 'suspended')::int AS suspended_workers,
          COUNT(*) FILTER (WHERE w.status = 'terminated')::int AS terminated_workers,
          COUNT(*) FILTER (WHERE w.employment_type = 'direct')::int AS direct_workers,
          COUNT(*) FILTER (WHERE w.employment_type = 'contractor')::int AS contractor_workers,
          COUNT(*) FILTER (WHERE w.status = 'active' AND w.employment_type = 'direct')::int AS active_direct_workers,
          COUNT(*) FILTER (WHERE w.status = 'active' AND w.employment_type = 'contractor')::int AS active_contractor_workers,
          COUNT(*) FILTER (WHERE w.id IN (SELECT wa.worker_id FROM worker_assignments wa WHERE wa.company_id = $1 AND wa.status = 'active'))::int AS active_assignments
        FROM workers w
        WHERE ${whereClauses.join(" AND ")}
      `,
      params
    );

    const employmentBreakdown = await db.query(
      `
        SELECT w.employment_type, COUNT(*)::int AS count
        FROM workers w
        WHERE ${whereClauses.join(" AND ")}
        GROUP BY w.employment_type
        ORDER BY w.employment_type ASC
      `,
      params
    );

    const certificationBreakdown = await db.query(
      `
        SELECT wc.status, COUNT(*)::int AS count
        FROM worker_certifications wc
        JOIN workers w ON w.id = wc.worker_id AND w.company_id = wc.company_id
        WHERE ${whereClauses.join(" AND ")}
        GROUP BY wc.status
        ORDER BY wc.status ASC
      `,
      params
    );

    const expiringSoon = await db.query(
      `
        SELECT COUNT(*)::int AS count
        FROM worker_certifications wc
        JOIN workers w ON w.id = wc.worker_id AND w.company_id = wc.company_id
        WHERE ${whereClauses.join(" AND ")} 
          AND wc.status = 'valid'
          AND wc.expiry_date IS NOT NULL
          AND wc.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
      `,
      params
    );

    const workersQuery = await db.query(
      `
        SELECT
          w.id,
          w.name,
          w.position,
          w.status,
          w.employment_type,
          w.contractor_id,
          c.company_name AS contractor_name,
          COALESCE((SELECT COUNT(*)::int FROM worker_assignments wa WHERE wa.company_id = $1 AND wa.worker_id = w.id AND wa.status = 'active'), 0) AS active_assignment_count,
          COALESCE((SELECT COUNT(*)::int FROM worker_certifications wc WHERE wc.company_id = $1 AND wc.worker_id = w.id AND wc.status = 'valid'), 0) AS valid_certifications
        FROM workers w
        LEFT JOIN contractors c ON c.id = w.contractor_id AND c.company_id = w.company_id
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY w.name ASC, w.id ASC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      [...params, limit, offset]
    );

    const summaryRow = summaryQuery.rows[0];

    const summary = {
      total_workers: Number(summaryRow.total_workers || 0),
      active_workers: Number(summaryRow.active_workers || 0),
      inactive_workers: Number(summaryRow.inactive_workers || 0),
      suspended_workers: Number(summaryRow.suspended_workers || 0),
      terminated_workers: Number(summaryRow.terminated_workers || 0),
      direct_workers: Number(summaryRow.direct_workers || 0),
      contractor_workers: Number(summaryRow.contractor_workers || 0),
      active_assignments: Number(summaryRow.active_assignments || 0),
      certifications_expiring_soon: Number(expiringSoon.rows[0].count || 0)
    };

    const sections = [
      renderSections(employmentBreakdown.rows, "employment_type", "count", "Employment type breakdown"),
      renderSections(certificationBreakdown.rows, "status", "count", "Certification status breakdown")
    ];

    res.json(makeEnvelope("workforce", period, summary, sections, workersQuery.rows));
  } catch (error) {
    return handleReportError(res, error);
  }
});

router.get("/projects", async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const period = parsePeriod(req);
    const { page, limit, offset } = getPagination(req);

    const status = parseEnumValue(req.query.status, PROJECT_STATUSES, "status");
    const projectId = req.query.project_id !== undefined ? await validateCompanyResource("projects", req.query.project_id, companyId, "Project") : null;

    const whereClauses = ["p.company_id = $1"];
    const params = [companyId];
    let paramIndex = 2;

    if (status) {
      whereClauses.push(`p.status = $${paramIndex}`);
      params.push(status);
      paramIndex += 1;
    }

    if (projectId !== null) {
      whereClauses.push(`p.id = $${paramIndex}`);
      params.push(projectId);
      paramIndex += 1;
    }

    const summaryQuery = await db.query(
      `
        SELECT
          COUNT(*)::int AS total_projects,
          COUNT(*) FILTER (WHERE p.status = 'active')::int AS active_projects,
          COUNT(*) FILTER (WHERE p.status = 'planning')::int AS planning_projects,
          COUNT(*) FILTER (WHERE p.status = 'on_hold')::int AS on_hold_projects,
          COUNT(*) FILTER (WHERE p.status = 'completed')::int AS completed_projects,
          COUNT(*) FILTER (WHERE p.status = 'cancelled')::int AS cancelled_projects
        FROM projects p
        WHERE ${whereClauses.join(" AND ")}
      `,
      params
    );

    const projectStatusQuery = await db.query(
      `
        SELECT p.status, COUNT(*)::int AS count
        FROM projects p
        WHERE ${whereClauses.join(" AND ")}
        GROUP BY p.status
        ORDER BY count DESC, p.status ASC
      `,
      params
    );

    const projectListQuery = await db.query(
      `
        SELECT
          p.id,
          p.name,
          p.location,
          p.description,
          p.status,
          p.start_date,
          p.end_date,
          COALESCE((SELECT COUNT(*)::int FROM worker_assignments wa WHERE wa.company_id = $1 AND wa.project_id = p.id AND wa.status = 'active'), 0) AS active_assignment_count,
          COALESCE((SELECT COUNT(*)::int FROM work_permits wp WHERE wp.company_id = $1 AND wp.project_id = p.id), 0) AS permit_count,
          COALESCE((SELECT COUNT(*)::int FROM incidents i WHERE i.company_id = $1 AND i.project_id = p.id), 0) AS incident_count,
          COALESCE((SELECT COUNT(*)::int FROM assets a WHERE a.company_id = $1 AND a.project_id = p.id), 0) AS asset_count,
          COALESCE((SELECT COUNT(*)::int FROM compliance_documents cd WHERE cd.company_id = $1 AND cd.project_id = p.id), 0) AS compliance_document_count
        FROM projects p
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      [...params, limit, offset]
    );

    const summaryRow = summaryQuery.rows[0];
    const summary = {
      total_projects: Number(summaryRow.total_projects || 0),
      active_projects: Number(summaryRow.active_projects || 0),
      planning_projects: Number(summaryRow.planning_projects || 0),
      on_hold_projects: Number(summaryRow.on_hold_projects || 0),
      completed_projects: Number(summaryRow.completed_projects || 0),
      cancelled_projects: Number(summaryRow.cancelled_projects || 0)
    };

    const sections = [
      renderSections(projectStatusQuery.rows, "status", "count", "Project status breakdown")
    ];

    res.json(makeEnvelope("projects", period, summary, sections, projectListQuery.rows));
  } catch (error) {
    return handleReportError(res, error);
  }
});

router.get("/contractors", async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const period = parsePeriod(req);
    const { page, limit, offset } = getPagination(req);

    const contractorId = req.query.contractor_id !== undefined ? await validateCompanyResource("contractors", req.query.contractor_id, companyId, "Contractor") : null;
    const projectId = req.query.project_id !== undefined ? await validateCompanyResource("projects", req.query.project_id, companyId, "Project") : null;

    const summaryQuery = await db.query(
      `
        SELECT
          COUNT(*)::int AS total_contractors,
          COUNT(*) FILTER (WHERE certification_status = 'verified')::int AS verified_contractors,
          COUNT(*) FILTER (WHERE certification_status = 'pending')::int AS pending_contractors,
          COUNT(*) FILTER (WHERE certification_status = 'expired')::int AS expired_contractors,
          COUNT(*) FILTER (WHERE certification_status = 'rejected')::int AS rejected_contractors
        FROM contractors
        WHERE company_id = $1
      `,
      [companyId]
    );

    const certificationBreakdown = await db.query(
      `
        SELECT certification_status, COUNT(*)::int AS count
        FROM contractors
        WHERE company_id = $1
        GROUP BY certification_status
        ORDER BY certification_status ASC
      `,
      [companyId]
    );

    const contractorRows = await db.query(
      `
        SELECT
          c.id,
          c.company_name,
          c.contact_person,
          c.email,
          c.phone,
          c.certification_status,
          p.name AS project_name,
          COALESCE((SELECT COUNT(*)::int FROM workers w WHERE w.company_id = $1 AND w.contractor_id = c.id), 0) AS worker_count,
          COALESCE((SELECT COUNT(*)::int FROM compliance_documents cd WHERE cd.company_id = $1 AND cd.contractor_id = c.id), 0) AS compliance_document_count
        FROM contractors c
        LEFT JOIN projects p ON p.id = c.project_id AND p.company_id = c.company_id
        WHERE c.company_id = $1
        ORDER BY c.company_name ASC, c.id ASC
        LIMIT $2 OFFSET $3
      `,
      [companyId, limit, offset]
    );

    const summaryRow = summaryQuery.rows[0];
    const summary = {
      total_contractors: Number(summaryRow.total_contractors || 0),
      verified_contractors: Number(summaryRow.verified_contractors || 0),
      pending_contractors: Number(summaryRow.pending_contractors || 0),
      expired_contractors: Number(summaryRow.expired_contractors || 0),
      rejected_contractors: Number(summaryRow.rejected_contractors || 0)
    };

    const sections = [
      renderSections(certificationBreakdown.rows, "certification_status", "count", "Contractor certification breakdown")
    ];

    res.json(makeEnvelope("contractors", period, summary, sections, contractorRows.rows));
  } catch (error) {
    return handleReportError(res, error);
  }
});

router.get("/assets", async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const period = parsePeriod(req);
    const { page, limit, offset } = getPagination(req);

    const assetId = req.query.asset_id !== undefined ? await validateCompanyResource("assets", req.query.asset_id, companyId, "Asset") : null;
    const projectId = req.query.project_id !== undefined ? await validateCompanyResource("projects", req.query.project_id, companyId, "Project") : null;
    const status = parseEnumValue(req.query.status, ASSET_STATUSES, "status");
    const operationalStatus = parseEnumValue(req.query.operational_status, ASSET_OPERATIONAL_STATUSES, "operational_status");

    const summaryQuery = await db.query(
      `
        SELECT
          COUNT(*)::int AS total_assets,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_assets,
          COUNT(*) FILTER (WHERE status = 'inactive')::int AS inactive_assets,
          COUNT(*) FILTER (WHERE operational_status = 'under_maintenance')::int AS under_maintenance,
          COUNT(*) FILTER (WHERE operational_status = 'in_use')::int AS in_use,
          COUNT(*) FILTER (WHERE operational_status = 'available')::int AS available,
          COUNT(*) FILTER (WHERE next_maintenance_date IS NOT NULL AND next_maintenance_date <= CURRENT_DATE + INTERVAL '30 days')::int AS maintenance_due_soon
        FROM assets
        WHERE company_id = $1
      `,
      [companyId]
    );

    const operationalBreakdown = await db.query(
      `
        SELECT operational_status, COUNT(*)::int AS count
        FROM assets
        WHERE company_id = $1
        GROUP BY operational_status
        ORDER BY operational_status ASC
      `,
      [companyId]
    );

    let whereClauses = ["a.company_id = $1"];
    const params = [companyId];
    let paramIndex = 2;

    if (assetId !== null) {
      whereClauses.push(`a.id = $${paramIndex}`);
      params.push(assetId);
      paramIndex += 1;
    }

    if (projectId !== null) {
      whereClauses.push(`a.project_id = $${paramIndex}`);
      params.push(projectId);
      paramIndex += 1;
    }

    if (status) {
      whereClauses.push(`a.status = $${paramIndex}`);
      params.push(status);
      paramIndex += 1;
    }

    if (operationalStatus) {
      whereClauses.push(`a.operational_status = $${paramIndex}`);
      params.push(operationalStatus);
      paramIndex += 1;
    }

    const assetRows = await db.query(
      `
        SELECT
          a.id,
          a.name,
          a.asset_type,
          a.serial_number,
          a.asset_tag,
          a.location,
          a.ownership_type,
          a.status,
          a.operational_status,
          a.project_id,
          p.name AS project_name,
          a.purchase_date,
          a.last_maintenance_date,
          a.next_maintenance_date,
          a.purchase_cost,
          a.rental_start_date,
          a.rental_end_date
        FROM assets a
        LEFT JOIN projects p ON p.id = a.project_id AND p.company_id = a.company_id
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY a.name ASC, a.id ASC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      [...params, limit, offset]
    );

    const summaryRow = summaryQuery.rows[0];
    const summary = {
      total_assets: Number(summaryRow.total_assets || 0),
      active_assets: Number(summaryRow.active_assets || 0),
      inactive_assets: Number(summaryRow.inactive_assets || 0),
      under_maintenance: Number(summaryRow.under_maintenance || 0),
      in_use: Number(summaryRow.in_use || 0),
      available: Number(summaryRow.available || 0),
      maintenance_due_soon: Number(summaryRow.maintenance_due_soon || 0)
    };

    const sections = [
      renderSections(operationalBreakdown.rows, "operational_status", "count", "Asset operational status breakdown")
    ];

    res.json(makeEnvelope("assets", period, summary, sections, assetRows.rows));
  } catch (error) {
    return handleReportError(res, error);
  }
});

router.get("/compliance", async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const period = parsePeriod(req);
    const { page, limit, offset } = getPagination(req);

    const projectId = req.query.project_id !== undefined ? await validateCompanyResource("projects", req.query.project_id, companyId, "Project") : null;
    const contractorId = req.query.contractor_id !== undefined ? await validateCompanyResource("contractors", req.query.contractor_id, companyId, "Contractor") : null;
    const assetId = req.query.asset_id !== undefined ? await validateCompanyResource("assets", req.query.asset_id, companyId, "Asset") : null;
    const supplierId = req.query.supplier_id !== undefined ? await validateCompanyResource("suppliers", req.query.supplier_id, companyId, "Supplier") : null;
    const documentType = parseEnumValue(req.query.document_type, COMPLIANCE_DOCUMENT_TYPES, "document_type");
    const scopeType = parseEnumValue(req.query.scope_type, COMPLIANCE_SCOPE_TYPES, "scope_type");
    const verificationStatus = parseEnumValue(req.query.verification_status, COMPLIANCE_VERIFICATION_STATUSES, "verification_status");

    const summaryQuery = await db.query(
      `
        SELECT
          COUNT(*)::int AS total_documents,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_documents,
          COUNT(*) FILTER (WHERE status = 'inactive')::int AS inactive_documents,
          COUNT(*) FILTER (WHERE verification_status = 'verified')::int AS verified_documents,
          COUNT(*) FILTER (WHERE verification_status = 'pending')::int AS pending_documents,
          COUNT(*) FILTER (WHERE verification_status = 'rejected')::int AS rejected_documents,
          COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE)::int AS expired_documents,
          COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days')::int AS expiring_soon
        FROM compliance_documents
        WHERE company_id = $1
      `,
      [companyId]
    );

    const verificationBreakdown = await db.query(
      `
        SELECT verification_status, COUNT(*)::int AS count
        FROM compliance_documents
        WHERE company_id = $1
        GROUP BY verification_status
        ORDER BY verification_status ASC
      `,
      [companyId]
    );

    let whereClauses = ["cd.company_id = $1"];
    const params = [companyId];
    let paramIndex = 2;

    if (projectId !== null) {
      whereClauses.push(`cd.project_id = $${paramIndex}`);
      params.push(projectId);
      paramIndex += 1;
    }

    if (contractorId !== null) {
      whereClauses.push(`cd.contractor_id = $${paramIndex}`);
      params.push(contractorId);
      paramIndex += 1;
    }

    if (assetId !== null) {
      whereClauses.push(`cd.asset_id = $${paramIndex}`);
      params.push(assetId);
      paramIndex += 1;
    }

    if (supplierId !== null) {
      whereClauses.push(`cd.supplier_id = $${paramIndex}`);
      params.push(supplierId);
      paramIndex += 1;
    }

    if (documentType) {
      whereClauses.push(`cd.document_type = $${paramIndex}`);
      params.push(documentType);
      paramIndex += 1;
    }

    if (scopeType) {
      whereClauses.push(`cd.scope_type = $${paramIndex}`);
      params.push(scopeType);
      paramIndex += 1;
    }

    if (verificationStatus) {
      whereClauses.push(`cd.verification_status = $${paramIndex}`);
      params.push(verificationStatus);
      paramIndex += 1;
    }

    const complianceRows = await db.query(
      `
        SELECT
          cd.id,
          cd.name,
          cd.document_type,
          cd.scope_type,
          cd.status,
          cd.verification_status,
          cd.issued_date,
          cd.expiry_date,
          cd.reference_number,
          cd.issuing_authority,
          p.name AS project_name,
          c.company_name AS contractor_name,
          a.name AS asset_name,
          s.name AS supplier_name
        FROM compliance_documents cd
        LEFT JOIN projects p ON p.id = cd.project_id AND p.company_id = cd.company_id
        LEFT JOIN contractors c ON c.id = cd.contractor_id AND c.company_id = cd.company_id
        LEFT JOIN assets a ON a.id = cd.asset_id AND a.company_id = cd.company_id
        LEFT JOIN suppliers s ON s.id = cd.supplier_id AND s.company_id = cd.company_id
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY cd.expiry_date NULLS LAST, cd.id DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      [...params, limit, offset]
    );

    const summaryRow = summaryQuery.rows[0];
    const summary = {
      total_documents: Number(summaryRow.total_documents || 0),
      active_documents: Number(summaryRow.active_documents || 0),
      inactive_documents: Number(summaryRow.inactive_documents || 0),
      verified_documents: Number(summaryRow.verified_documents || 0),
      pending_documents: Number(summaryRow.pending_documents || 0),
      rejected_documents: Number(summaryRow.rejected_documents || 0),
      expired_documents: Number(summaryRow.expired_documents || 0),
      expiring_soon: Number(summaryRow.expiring_soon || 0)
    };

    const sections = [
      renderSections(verificationBreakdown.rows, "verification_status", "count", "Compliance verification breakdown")
    ];

    res.json(makeEnvelope("compliance", period, summary, sections, complianceRows.rows));
  } catch (error) {
    return handleReportError(res, error);
  }
});

router.get("/incidents", async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const period = parsePeriod(req);
    const { page, limit, offset } = getPagination(req);

    const projectId = req.query.project_id !== undefined ? await validateCompanyResource("projects", req.query.project_id, companyId, "Project") : null;
    const severity = parseEnumValue(req.query.severity, INCIDENT_SEVERITIES, "severity");
    const status = parseEnumValue(req.query.status, INCIDENT_STATUSES, "status");
    const incidentType = parseEnumValue(req.query.incident_type, INCIDENT_TYPES, "incident_type");

    let whereClauses = ["i.company_id = $1"];
    const params = [companyId];
    let paramIndex = 2;

    if (projectId !== null) {
      whereClauses.push(`i.project_id = $${paramIndex}`);
      params.push(projectId);
      paramIndex += 1;
    }

    if (severity) {
      whereClauses.push(`i.severity = $${paramIndex}`);
      params.push(severity);
      paramIndex += 1;
    }

    if (status) {
      whereClauses.push(`i.status = $${paramIndex}`);
      params.push(status);
      paramIndex += 1;
    }

    if (incidentType) {
      whereClauses.push(`i.incident_type = $${paramIndex}`);
      params.push(incidentType);
      paramIndex += 1;
    }

    if (period.scope === "period") {
      whereClauses.push(`i.occurred_at >= $${paramIndex}`);
      params.push(period.from);
      paramIndex += 1;
      whereClauses.push(`i.occurred_at <= $${paramIndex}`);
      params.push(period.to);
      paramIndex += 1;
    }

    const summaryQuery = await db.query(
      `
        SELECT
          COUNT(*)::int AS total_incidents,
          COUNT(*) FILTER (WHERE status = 'open')::int AS open_incidents,
          COUNT(*) FILTER (WHERE status = 'investigating')::int AS investigating_incidents,
          COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved_incidents,
          COUNT(*) FILTER (WHERE status = 'closed')::int AS closed_incidents,
          COUNT(*) FILTER (WHERE severity = 'critical')::int AS critical_incidents,
          COUNT(*) FILTER (WHERE severity = 'high')::int AS high_incidents,
          COUNT(*) FILTER (WHERE severity = 'medium')::int AS medium_incidents,
          COUNT(*) FILTER (WHERE severity = 'low')::int AS low_incidents
        FROM incidents i
        WHERE i.company_id = $1
      `,
      [companyId]
    );

    const severityBreakdown = await db.query(
      `
        SELECT severity, COUNT(*)::int AS count
        FROM incidents
        WHERE company_id = $1
        GROUP BY severity
        ORDER BY severity ASC
      `,
      [companyId]
    );

    const incidentRows = await db.query(
      `
        SELECT
          i.id,
          i.title,
          i.incident_type,
          i.severity,
          i.status,
          i.occurred_at,
          i.resolved_at,
          p.name AS project_name,
          reporter.name AS reported_by_name,
          assignee.name AS assigned_to_name,
          i.corrective_action
        FROM incidents i
        LEFT JOIN projects p ON p.id = i.project_id AND p.company_id = i.company_id
        LEFT JOIN users reporter ON reporter.id = i.reported_by AND reporter.company_id = i.company_id
        LEFT JOIN users assignee ON assignee.id = i.assigned_to AND assignee.company_id = i.company_id
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY i.occurred_at DESC, i.id DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      [...params, limit, offset]
    );

    const summaryRow = summaryQuery.rows[0];
    const summary = {
      total_incidents: Number(summaryRow.total_incidents || 0),
      open_incidents: Number(summaryRow.open_incidents || 0),
      investigating_incidents: Number(summaryRow.investigating_incidents || 0),
      resolved_incidents: Number(summaryRow.resolved_incidents || 0),
      closed_incidents: Number(summaryRow.closed_incidents || 0),
      critical_incidents: Number(summaryRow.critical_incidents || 0),
      high_incidents: Number(summaryRow.high_incidents || 0),
      medium_incidents: Number(summaryRow.medium_incidents || 0),
      low_incidents: Number(summaryRow.low_incidents || 0)
    };

    const sections = [
      renderSections(severityBreakdown.rows, "severity", "count", "Incident severity breakdown")
    ];

    res.json(makeEnvelope("incidents", period, summary, sections, incidentRows.rows));
  } catch (error) {
    return handleReportError(res, error);
  }
});

router.get("/work-permits", async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const period = parsePeriod(req);
    const { page, limit, offset } = getPagination(req);

    const projectId = req.query.project_id !== undefined ? await validateCompanyResource("projects", req.query.project_id, companyId, "Project") : null;
    const contractorId = req.query.contractor_id !== undefined ? await validateCompanyResource("contractors", req.query.contractor_id, companyId, "Contractor") : null;
    const permitType = parseEnumValue(req.query.permit_type, PERMIT_TYPES, "permit_type");
    const riskLevel = parseEnumValue(req.query.risk_level, PERMIT_RISK_LEVELS, "risk_level");
    const status = parseEnumValue(req.query.status, PERMIT_STATUSES, "status");

    let whereClauses = ["wp.company_id = $1"];
    const params = [companyId];
    let paramIndex = 2;

    if (projectId !== null) {
      whereClauses.push(`wp.project_id = $${paramIndex}`);
      params.push(projectId);
      paramIndex += 1;
    }

    if (contractorId !== null) {
      whereClauses.push(`wp.contractor_id = $${paramIndex}`);
      params.push(contractorId);
      paramIndex += 1;
    }

    if (permitType) {
      whereClauses.push(`wp.permit_type = $${paramIndex}`);
      params.push(permitType);
      paramIndex += 1;
    }

    if (riskLevel) {
      whereClauses.push(`wp.risk_level = $${paramIndex}`);
      params.push(riskLevel);
      paramIndex += 1;
    }

    if (status) {
      whereClauses.push(`wp.status = $${paramIndex}`);
      params.push(status);
      paramIndex += 1;
    }

    if (period.scope === "period") {
      whereClauses.push(`wp.created_at >= $${paramIndex}`);
      params.push(period.from);
      paramIndex += 1;
      whereClauses.push(`wp.created_at <= $${paramIndex}`);
      params.push(period.to);
      paramIndex += 1;
    }

    const summaryQuery = await db.query(
      `
        SELECT
          COUNT(*)::int AS total_permits,
          COUNT(*) FILTER (WHERE status = 'draft')::int AS draft_permits,
          COUNT(*) FILTER (WHERE status = 'pending_review')::int AS pending_review_permits,
          COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_permits,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_permits,
          COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended_permits,
          COUNT(*) FILTER (WHERE status = 'closed')::int AS closed_permits,
          COUNT(*) FILTER (WHERE status = 'expired')::int AS expired_permits,
          COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_permits,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_permits
        FROM work_permits
        WHERE company_id = $1
      `,
      [companyId]
    );

    const permitStatusBreakdown = await db.query(
      `
        SELECT status, COUNT(*)::int AS count
        FROM work_permits
        WHERE company_id = $1
        GROUP BY status
        ORDER BY status ASC
      `,
      [companyId]
    );

    const permitRows = await db.query(
      `
        SELECT
          wp.id,
          wp.permit_number,
          wp.title,
          p.name AS project_name,
          c.company_name AS contractor_name,
          wp.permit_type,
          wp.risk_level,
          wp.status,
          COALESCE(
            (
              SELECT e.created_at
              FROM work_permit_events e
              WHERE e.company_id = wp.company_id
                AND e.permit_id = wp.id
                AND e.event_type = 'activated'
              ORDER BY e.created_at ASC
              LIMIT 1
            ),
            wp.valid_from
          ) AS valid_from,
          wp.valid_until,
          creator.name AS created_by_name,
          reviewer.name AS reviewed_by_name,
          approver.name AS approved_by_name,
          wp.submitted_at,
          wp.reviewed_at,
          wp.approved_at,
          CASE
            WHEN wp.submitted_at IS NOT NULL AND wp.approved_at IS NOT NULL THEN wp.approved_at - wp.submitted_at
            ELSE NULL
          END AS approval_processing_time,
          COALESCE((SELECT COUNT(*)::int FROM work_permit_workers wpw WHERE wpw.company_id = $1 AND wpw.permit_id = wp.id), 0) AS worker_count,
          COALESCE((SELECT COUNT(*)::int FROM work_permit_assets wpa WHERE wpa.company_id = $1 AND wpa.permit_id = wp.id), 0) AS asset_count,
          COALESCE((SELECT COUNT(*)::int FROM work_permit_documents wpd WHERE wpd.company_id = $1 AND wpd.permit_id = wp.id), 0) AS document_count
        FROM work_permits wp
        LEFT JOIN projects p ON p.id = wp.project_id AND p.company_id = wp.company_id
        LEFT JOIN contractors c ON c.id = wp.contractor_id AND c.company_id = wp.company_id
        LEFT JOIN users creator ON creator.id = wp.created_by AND creator.company_id = wp.company_id
        LEFT JOIN users reviewer ON reviewer.id = wp.reviewed_by AND reviewer.company_id = wp.company_id
        LEFT JOIN users approver ON approver.id = wp.approved_by AND approver.company_id = wp.company_id
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY wp.created_at DESC, wp.id DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      [...params, limit, offset]
    );

    const summaryRow = summaryQuery.rows[0];
    const summary = {
      total_permits: Number(summaryRow.total_permits || 0),
      draft_permits: Number(summaryRow.draft_permits || 0),
      pending_review_permits: Number(summaryRow.pending_review_permits || 0),
      approved_permits: Number(summaryRow.approved_permits || 0),
      active_permits: Number(summaryRow.active_permits || 0),
      suspended_permits: Number(summaryRow.suspended_permits || 0),
      closed_permits: Number(summaryRow.closed_permits || 0),
      expired_permits: Number(summaryRow.expired_permits || 0),
      rejected_permits: Number(summaryRow.rejected_permits || 0),
      cancelled_permits: Number(summaryRow.cancelled_permits || 0)
    };

    const sections = [
      renderSections(permitStatusBreakdown.rows, "status", "count", "Permit status breakdown")
    ];

    res.json(makeEnvelope("work-permits", period, summary, sections, permitRows.rows));
  } catch (error) {
    return handleReportError(res, error);
  }
});

module.exports = router;
