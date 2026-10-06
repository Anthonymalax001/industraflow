const express = require("express");
const db = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authMiddleware);

const DEFAULT_EXPIRY_DAYS = 30;
const DEFAULT_DUE_DAYS = 30;

const PROJECT_STATUSES = [
  "planning",
  "active",
  "on_hold",
  "completed",
  "cancelled"
];

const WORKER_STATUSES = [
  "active",
  "inactive",
  "suspended",
  "terminated"
];

const WORKER_EMPLOYMENT_TYPES = [
  "direct",
  "contractor"
];

const INCIDENT_SEVERITIES = [
  "low",
  "medium",
  "high",
  "critical"
];

const INCIDENT_STATUSES = [
  "open",
  "investigating",
  "resolved",
  "closed",
  "cancelled"
];

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

const ASSET_STATUSES = [
  "active",
  "inactive"
];

const ASSET_OPERATIONAL_STATUSES = [
  "available",
  "in_use",
  "under_maintenance",
  "out_of_service"
];

const CONTRACTOR_CERTIFICATION_STATUSES = [
  "pending",
  "verified",
  "expired",
  "rejected"
];

const CONTRACTOR_VERIFICATION_STATUSES = [
  "pending",
  "verified",
  "rejected"
];

const COMPLIANCE_SCOPE_TYPES = [
  "company",
  "project",
  "contractor",
  "asset",
  "supplier"
];

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

const COMPLIANCE_STATUSES = [
  "active",
  "inactive"
];

const COMPLIANCE_VERIFICATION_STATUSES = [
  "pending",
  "verified",
  "rejected"
];

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

const PERMIT_RISK_LEVELS = [
  "low",
  "medium",
  "high",
  "critical"
];

const TREND_METRICS = [
  "incidents",
  "permits",
  "workers",
  "projects",
  "documents_expiring"
];

const TREND_GRANULARITIES = [
  "day",
  "week",
  "month"
];

const formatPeriod = (scope, from, to) => ({
  scope,
  from: from ? from.toISOString().slice(0, 10) : null,
  to: to ? to.toISOString().slice(0, 10) : null
});

const parsePositiveInt = (value, defaultValue = null) => {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
};

const parseDateValue = (value, label) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is not a valid date`);
  }

  return date;
};

const parseDateRange = (req) => {
  const hasFrom = Object.prototype.hasOwnProperty.call(req.query, "from");
  const hasTo = Object.prototype.hasOwnProperty.call(req.query, "to");

  if (!hasFrom && !hasTo) {
    return { hasPeriod: false, from: null, to: null };
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

  return { hasPeriod: true, from, to };
};

const ensureProjectBelongsToCompany = async (projectId, companyId) => {
  if (projectId === undefined || projectId === null || projectId === "") {
    return null;
  }

  const result = await db.query(
    `
    SELECT id
    FROM projects
    WHERE id = $1 AND company_id = $2
    `,
    [projectId, companyId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
};

const buildProjectFilter = (projectId) => {
  if (projectId === undefined || projectId === null || projectId === "") {
    return { sql: "", params: [] };
  }

  return { sql: " AND p.id = $1 ", params: [projectId] };
};

const validateEnum = (value, allowedValues, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (!allowedValues.includes(value)) {
    throw new Error(`${fieldName} must be one of: ${allowedValues.join(", ")}`);
  }

  return value;
};

const summaryResponse = (scope, from, to, metrics, items = []) => ({
  generated_at: new Date().toISOString(),
  period: formatPeriod(scope, from, to),
  metrics,
  items
});

router.get("/overview", async (req, res) => {
  try {
    if (req.query.from !== undefined || req.query.to !== undefined) {
      return res.status(400).json({
        error: "This endpoint does not accept from/to filters. Use current snapshot only."
      });
    }

    const companyId = req.user.company_id;
    const thresholdDays = parsePositiveInt(req.query.expiring_within_days, DEFAULT_EXPIRY_DAYS) ?? DEFAULT_EXPIRY_DAYS;

    const [
      totalWorkersResult,
      activeWorkersResult,
      activeProjectsResult,
      activePermitsResult,
      openIncidentsResult,
      maintenanceResult,
      certsExpiringResult,
      docsExpiringResult
    ] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS count FROM workers WHERE company_id = $1", [companyId]),
      db.query("SELECT COUNT(*)::int AS count FROM workers WHERE company_id = $1 AND status = 'active'", [companyId]),
      db.query("SELECT COUNT(*)::int AS count FROM projects WHERE company_id = $1 AND status = 'active'", [companyId]),
      db.query("SELECT COUNT(*)::int AS count FROM work_permits WHERE company_id = $1 AND status = 'active'", [companyId]),
      db.query("SELECT COUNT(*)::int AS count FROM incidents WHERE company_id = $1 AND status = 'open'", [companyId]),
      db.query("SELECT COUNT(*)::int AS count FROM assets WHERE company_id = $1 AND operational_status = 'under_maintenance'", [companyId]),
      db.query(
        `
        SELECT COUNT(*)::int AS count
        FROM worker_certifications
        WHERE company_id = $1
          AND status = 'valid'
          AND expiry_date IS NOT NULL
          AND expiry_date <= CURRENT_DATE + ($2::int || ' days')::interval
        `,
        [companyId, thresholdDays]
      ),
      db.query(
        `
        SELECT COUNT(*)::int AS count
        FROM compliance_documents
        WHERE company_id = $1
          AND expiry_date IS NOT NULL
          AND expiry_date >= CURRENT_DATE
          AND expiry_date <= CURRENT_DATE + ($2::int || ' days')::interval
        `,
        [companyId, thresholdDays]
      )
    ]);

    const payload = summaryResponse("snapshot", null, null, {
      total_workers: Number(totalWorkersResult.rows[0].count || 0),
      active_workers: Number(activeWorkersResult.rows[0].count || 0),
      active_projects: Number(activeProjectsResult.rows[0].count || 0),
      active_permits: Number(activePermitsResult.rows[0].count || 0),
      open_incidents: Number(openIncidentsResult.rows[0].count || 0),
      assets_in_maintenance: Number(maintenanceResult.rows[0].count || 0),
      certifications_expiring_soon: Number(certsExpiringResult.rows[0].count || 0),
      documents_expiring_soon: Number(docsExpiringResult.rows[0].count || 0)
    }, []);

    res.json(payload);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to fetch overview analytics" });
  }
});

router.get("/workforce", async (req, res) => {
  try {
    if (req.query.from !== undefined || req.query.to !== undefined) {
      return res.status(400).json({
        error: "This endpoint does not accept from/to filters. Use snapshot analytics only."
      });
    }

    const companyId = req.user.company_id;
    const projectId = parsePositiveInt(req.query.project_id, null);
    const employmentType = validateEnum(req.query.employment_type, WORKER_EMPLOYMENT_TYPES, "employment_type");
    const status = validateEnum(req.query.status, WORKER_STATUSES, "status");
    const expiringWithinDays = parsePositiveInt(req.query.expiring_within_days, DEFAULT_EXPIRY_DAYS) ?? DEFAULT_EXPIRY_DAYS;

    if (projectId !== null) {
      const project = await ensureProjectBelongsToCompany(projectId, companyId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
    }

    const workerFilters = [];
    const workerParams = [companyId];
    let workerParamIndex = 1;

    if (status) {
      workerParamIndex += 1;
      workerFilters.push(`status = $${workerParamIndex}`);
      workerParams.push(status);
    }

    if (employmentType) {
      workerParamIndex += 1;
      workerFilters.push(`employment_type = $${workerParamIndex}`);
      workerParams.push(employmentType);
    }

    const workerWhere = workerFilters.length > 0 ? `AND ${workerFilters.join(" AND ")}` : "";

    const totalWorkersQuery = `
      SELECT COUNT(*)::int AS count
      FROM workers
      WHERE company_id = $1 ${workerWhere}
    `;

    const activeWorkersQuery = `
      SELECT COUNT(*)::int AS count
      FROM workers
      WHERE company_id = $1 AND status = 'active' ${workerWhere.replace("AND status = $2", "").replace("AND status = $3", "").replace("AND status = $4", "")}
    `;

    const inactiveWorkersQuery = `
      SELECT COUNT(*)::int AS count
      FROM workers
      WHERE company_id = $1 AND status = 'inactive' ${workerWhere.replace("AND status = $2", "").replace("AND status = $3", "").replace("AND status = $4", "")}
    `;

    const activeAssignmentsQuery = `
      SELECT COUNT(*)::int AS count
      FROM worker_assignments
      WHERE company_id = $1 AND status = 'active'
    `;

    const assignmentParams = [companyId];
    if (projectId !== null) {
      assignmentParams.push(projectId);
      activeAssignmentsQuery += ` AND project_id = $2`;
    }

    const [
      totalWorkersResult,
      activeWorkersResult,
      inactiveWorkersResult,
      activeAssignmentsResult,
      employmentTypeResult,
      certStatusResult,
      expiringResult
    ] = await Promise.all([
      db.query(totalWorkersQuery, workerParams),
      db.query(activeWorkersQuery, workerParams),
      db.query(inactiveWorkersQuery, workerParams),
      db.query(activeAssignmentsQuery, assignmentParams),
      db.query(
        `
        SELECT employment_type AS key, COUNT(*)::int AS count
        FROM workers
        WHERE company_id = $1
          ${status ? "AND status = $2" : ""}
          ${employmentType ? "AND employment_type = $3" : ""}
        GROUP BY employment_type
        ORDER BY employment_type
        `,
        employmentType && status ? [companyId, status, employmentType] : status ? [companyId, status] : employmentType ? [companyId, employmentType] : [companyId]
      ),
      db.query(
        `
        SELECT status AS key, COUNT(*)::int AS count
        FROM worker_certifications
        WHERE company_id = $1
        GROUP BY status
        ORDER BY status
        `,
        [companyId]
      ),
      db.query(
        `
        SELECT COUNT(*)::int AS count
        FROM worker_certifications
        WHERE company_id = $1
          AND status = 'valid'
          AND expiry_date IS NOT NULL
          AND expiry_date <= CURRENT_DATE + ($2::int || ' days')::interval
        `,
        [companyId, expiringWithinDays]
      )
    ]);

    const payload = {
      generated_at: new Date().toISOString(),
      period: formatPeriod("snapshot", null, null),
      metrics: {
        total_workers: Number(totalWorkersResult.rows[0].count || 0),
        active_workers: Number(activeWorkersResult.rows[0].count || 0),
        inactive_workers: Number(inactiveWorkersResult.rows[0].count || 0),
        active_assignments: Number(activeAssignmentsResult.rows[0].count || 0)
      },
      workers_by_employment_type: employmentTypeResult.rows.map((row) => ({
        key: row.key,
        count: Number(row.count || 0)
      })),
      worker_certification_status_breakdown: certStatusResult.rows.map((row) => ({
        key: row.key,
        count: Number(row.count || 0)
      })),
      expiring_certifications: {
        count: Number(expiringResult.rows[0].count || 0),
        threshold_days: expiringWithinDays
      }
    };

    res.json(payload);
  } catch (error) {
    console.error(error);

    if (error.message && error.message.includes("must be one of")) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: "Failed to fetch workforce analytics" });
  }
});

router.get("/projects", async (req, res) => {
  try {
    if (req.query.from !== undefined || req.query.to !== undefined) {
      return res.status(400).json({
        error: "This endpoint does not accept from/to filters. Use snapshot analytics only."
      });
    }

    const companyId = req.user.company_id;
    const projectId = parsePositiveInt(req.query.project_id, null);
    const status = validateEnum(req.query.status, PROJECT_STATUSES, "status");

    if (projectId !== null) {
      const project = await ensureProjectBelongsToCompany(projectId, companyId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
    }

    let sql = `
      SELECT
        p.id AS project_id,
        p.name AS project_name,
        p.status,
        COALESCE(wa.worker_count, 0) AS worker_count,
        COALESCE(wp.permit_count, 0) AS permit_count,
        COALESCE(i.incident_count, 0) AS incident_count
      FROM projects p
      LEFT JOIN (
        SELECT project_id, COUNT(*)::int AS worker_count
        FROM worker_assignments
        WHERE company_id = $1 AND status = 'active'
        GROUP BY project_id
      ) wa ON wa.project_id = p.id
      LEFT JOIN (
        SELECT project_id, COUNT(*)::int AS permit_count
        FROM work_permits
        WHERE company_id = $1
        GROUP BY project_id
      ) wp ON wp.project_id = p.id
      LEFT JOIN (
        SELECT project_id, COUNT(*)::int AS incident_count
        FROM incidents
        WHERE company_id = $1
        GROUP BY project_id
      ) i ON i.project_id = p.id
      WHERE p.company_id = $1
    `;

    const params = [companyId];

    if (projectId !== null) {
      sql += ` AND p.id = $2 `;
      params.push(projectId);
    }

    if (status) {
      sql += ` AND p.status = $${params.length + 1} `;
      params.push(status);
    }

    sql += ` ORDER BY p.created_at DESC, p.id DESC`;

    const metricsQuery = `
      SELECT
        COUNT(*)::int AS total_projects,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)::int AS active_projects,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::int AS completed_projects
      FROM projects
      WHERE company_id = $1
    `;

    const metricParams = [companyId];
    let metricIndex = 1;

    if (projectId !== null) {
      metricIndex += 1;
      metricParams.push(projectId);
    }

    if (status) {
      metricIndex += 1;
      metricParams.push(status);
    }

    let metricSql = metricsQuery;
    if (projectId !== null) {
      metricSql += ` AND id = $2`;
    }
    if (status) {
      metricSql += ` AND status = $${metricIndex}`;
    }

    const [itemsResult, metricsResult] = await Promise.all([
      db.query(sql, params),
      db.query(metricSql, metricParams)
    ]);

    const metrics = metricsResult.rows[0] || {};

    res.json({
      generated_at: new Date().toISOString(),
      period: formatPeriod("snapshot", null, null),
      metrics: {
        total_projects: Number(metrics.total_projects || 0),
        active_projects: Number(metrics.active_projects || 0),
        completed_projects: Number(metrics.completed_projects || 0)
      },
      items: itemsResult.rows.map((row) => ({
        project_id: Number(row.project_id),
        project_name: row.project_name,
        status: row.status,
        worker_count: Number(row.worker_count || 0),
        permit_count: Number(row.permit_count || 0),
        incident_count: Number(row.incident_count || 0)
      }))
    });
  } catch (error) {
    console.error(error);

    if (error.message && error.message.includes("must be one of")) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: "Failed to fetch project analytics" });
  }
});

router.get("/contractors", async (req, res) => {
  try {
    if (req.query.from !== undefined || req.query.to !== undefined) {
      return res.status(400).json({
        error: "This endpoint does not accept from/to filters. Use snapshot analytics only."
      });
    }

    const companyId = req.user.company_id;
    const projectId = parsePositiveInt(req.query.project_id, null);
    const certificationStatus = validateEnum(req.query.certification_status, CONTRACTOR_CERTIFICATION_STATUSES, "certification_status");
    const verificationStatus = validateEnum(req.query.verification_status, CONTRACTOR_VERIFICATION_STATUSES, "verification_status");

    if (projectId !== null) {
      const project = await ensureProjectBelongsToCompany(projectId, companyId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
    }

    const contractorWhere = [];
    const contractorParams = [companyId];
    let contractorIndex = 1;

    if (projectId !== null) {
      contractorIndex += 1;
      contractorWhere.push(`project_id = $${contractorIndex}`);
      contractorParams.push(projectId);
    }

    if (certificationStatus) {
      contractorIndex += 1;
      contractorWhere.push(`certification_status = $${contractorIndex}`);
      contractorParams.push(certificationStatus);
    }

    const contractorSql = contractorWhere.length > 0 ? `AND ${contractorWhere.join(" AND ")}` : "";

    const [
      totalContractorsResult,
      activeContractorsResult,
      verifiedResult,
      pendingResult,
      expiredResult,
      rejectedResult,
      breakdownResult,
      projectBreakdownResult,
      complianceResult
    ] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS count FROM contractors WHERE company_id = $1 ${contractorSql}`, contractorParams),
      db.query(
        `
        SELECT COUNT(*)::int AS count
        FROM contractors c
        JOIN projects p
          ON p.id = c.project_id
         AND p.company_id = c.company_id
        WHERE c.company_id = $1
          AND p.status = 'active'
          ${contractorSql}
        `,
        contractorParams
      ),
      db.query(`SELECT COUNT(*)::int AS count FROM contractors WHERE company_id = $1 AND certification_status = 'verified' ${contractorSql}`, contractorParams),
      db.query(`SELECT COUNT(*)::int AS count FROM contractors WHERE company_id = $1 AND certification_status = 'pending' ${contractorSql}`, contractorParams),
      db.query(`SELECT COUNT(*)::int AS count FROM contractors WHERE company_id = $1 AND certification_status = 'expired' ${contractorSql}`, contractorParams),
      db.query(`SELECT COUNT(*)::int AS count FROM contractors WHERE company_id = $1 AND certification_status = 'rejected' ${contractorSql}`, contractorParams),
      db.query(
        `
        SELECT certification_status AS key, COUNT(*)::int AS count
        FROM contractors
        WHERE company_id = $1
          ${contractorSql}
        GROUP BY certification_status
        ORDER BY certification_status
        `,
        contractorParams
      ),
      db.query(
        `
        SELECT project_id, COUNT(*)::int AS count
        FROM contractors
        WHERE company_id = $1
          ${contractorSql}
        GROUP BY project_id
        ORDER BY project_id
        `,
        contractorParams
      ),
      db.query(
        `
        SELECT
          COUNT(*)::int AS total_contractor_documents,
          SUM(CASE WHEN cd.verification_status = 'verified' THEN 1 ELSE 0 END)::int AS verified_documents,
          SUM(CASE WHEN cd.verification_status = 'pending' THEN 1 ELSE 0 END)::int AS pending_documents,
          SUM(CASE WHEN cd.verification_status = 'rejected' THEN 1 ELSE 0 END)::int AS rejected_documents
        FROM compliance_documents cd
        INNER JOIN contractors c
          ON c.id = cd.contractor_id
         AND c.company_id = cd.company_id
        WHERE cd.company_id = $1
          AND cd.scope_type = 'contractor'
          ${verificationStatus ? "AND cd.verification_status = $2" : ""}
        `,
        verificationStatus ? [companyId, verificationStatus] : [companyId]
      )
    ]);

    res.json({
      generated_at: new Date().toISOString(),
      period: formatPeriod("snapshot", null, null),
      metrics: {
        total_contractors: Number(totalContractorsResult.rows[0].count || 0),
        active_contractors: Number(activeContractorsResult.rows[0].count || 0),
        verified_contractors: Number(verifiedResult.rows[0].count || 0),
        pending_contractors: Number(pendingResult.rows[0].count || 0),
        expired_contractors: Number(expiredResult.rows[0].count || 0),
        rejected_contractors: Number(rejectedResult.rows[0].count || 0)
      },
      contractor_certification_status_breakdown: breakdownResult.rows.map((row) => ({
        key: row.key,
        count: Number(row.count || 0)
      })),
      contractors_by_project: projectBreakdownResult.rows.map((row) => ({
        project_id: Number(row.project_id),
        count: Number(row.count || 0)
      })),
      contractor_compliance: {
        total_contractor_documents: Number(complianceResult.rows[0].total_contractor_documents || 0),
        verified_documents: Number(complianceResult.rows[0].verified_documents || 0),
        pending_documents: Number(complianceResult.rows[0].pending_documents || 0),
        rejected_documents: Number(complianceResult.rows[0].rejected_documents || 0)
      }
    });
  } catch (error) {
    console.error(error);

    if (error.message && error.message.includes("must be one of")) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: "Failed to fetch contractor analytics" });
  }
});

router.get("/assets", async (req, res) => {
  try {
    if (req.query.from !== undefined || req.query.to !== undefined) {
      return res.status(400).json({
        error: "This endpoint does not accept from/to filters. Use snapshot analytics only."
      });
    }

    const companyId = req.user.company_id;
    const projectId = parsePositiveInt(req.query.project_id, null);
    const operationalStatus = validateEnum(req.query.operational_status, ASSET_OPERATIONAL_STATUSES, "operational_status");
    const status = validateEnum(req.query.status, ASSET_STATUSES, "status");
    const dueWithinDays = parsePositiveInt(req.query.due_within_days, DEFAULT_DUE_DAYS) ?? DEFAULT_DUE_DAYS;

    if (projectId !== null) {
      const project = await ensureProjectBelongsToCompany(projectId, companyId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
    }

    const whereClauses = ["company_id = $1"];
    const params = [companyId];
    let paramIndex = 1;

    if (projectId !== null) {
      paramIndex += 1;
      whereClauses.push(`project_id = $${paramIndex}`);
      params.push(projectId);
    }

    if (operationalStatus) {
      paramIndex += 1;
      whereClauses.push(`operational_status = $${paramIndex}`);
      params.push(operationalStatus);
    }

    if (status) {
      paramIndex += 1;
      whereClauses.push(`status = $${paramIndex}`);
      params.push(status);
    }

    const whereSql = `WHERE ${whereClauses.join(" AND ")}`;

    const [
      totalResult,
      activeResult,
      availableResult,
      maintenanceResult,
      ownershipResult,
      projectBreakdownResult,
      dueResult
    ] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS count FROM assets ${whereSql}`, params),
      db.query(`SELECT COUNT(*)::int AS count FROM assets ${whereSql} AND status = 'active'`, params),
      db.query(`SELECT COUNT(*)::int AS count FROM assets ${whereSql} AND operational_status = 'available'`, params),
      db.query(`SELECT COUNT(*)::int AS count FROM assets ${whereSql} AND operational_status = 'under_maintenance'`, params),
      db.query(
        `
        SELECT ownership_type AS key, COUNT(*)::int AS count
        FROM assets
        ${whereSql}
        GROUP BY ownership_type
        ORDER BY ownership_type
        `,
        params
      ),
      db.query(
        `
        SELECT project_id, COUNT(*)::int AS count
        FROM assets
        ${whereSql}
        GROUP BY project_id
        ORDER BY project_id
        `,
        params
      ),
      db.query(
        `
        SELECT COUNT(*)::int AS count
        FROM assets
        WHERE company_id = $1
          AND next_maintenance_date IS NOT NULL
          AND next_maintenance_date <= CURRENT_DATE + ($2::int || ' days')::interval
        ${projectId !== null ? "AND project_id = $3" : ""}
        ${operationalStatus ? "AND operational_status = $4" : ""}
        ${status ? "AND status = $5" : ""}
        `,
        projectId !== null && operationalStatus && status
          ? [companyId, dueWithinDays, projectId, operationalStatus, status]
          : projectId !== null && operationalStatus
            ? [companyId, dueWithinDays, projectId, operationalStatus]
            : projectId !== null && status
              ? [companyId, dueWithinDays, projectId, status]
              : projectId !== null
                ? [companyId, dueWithinDays, projectId]
                : operationalStatus && status
                  ? [companyId, dueWithinDays, operationalStatus, status]
                  : operationalStatus
                    ? [companyId, dueWithinDays, operationalStatus]
                    : status
                      ? [companyId, dueWithinDays, status]
                      : [companyId, dueWithinDays]
      )
    ]);

    res.json({
      generated_at: new Date().toISOString(),
      period: formatPeriod("snapshot", null, null),
      metrics: {
        total_assets: Number(totalResult.rows[0].count || 0),
        active_assets: Number(activeResult.rows[0].count || 0),
        available_assets: Number(availableResult.rows[0].count || 0),
        assets_under_maintenance: Number(maintenanceResult.rows[0].count || 0),
        assets_due_for_maintenance: Number(dueResult.rows[0].count || 0),
        threshold_days: dueWithinDays
      },
      assets_by_ownership_type: ownershipResult.rows.map((row) => ({
        key: row.key,
        count: Number(row.count || 0)
      })),
      assets_by_project: projectBreakdownResult.rows.map((row) => ({
        project_id: Number(row.project_id),
        count: Number(row.count || 0)
      }))
    });
  } catch (error) {
    console.error(error);

    if (error.message && error.message.includes("must be one of")) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: "Failed to fetch asset analytics" });
  }
});

router.get("/compliance", async (req, res) => {
  try {
    if (req.query.from !== undefined || req.query.to !== undefined) {
      return res.status(400).json({
        error: "This endpoint does not accept from/to filters. Use snapshot analytics only."
      });
    }

    const companyId = req.user.company_id;
    const scopeType = validateEnum(req.query.scope_type, COMPLIANCE_SCOPE_TYPES, "scope_type");
    const documentType = validateEnum(req.query.document_type, COMPLIANCE_DOCUMENT_TYPES, "document_type");
    const verificationStatus = validateEnum(req.query.verification_status, COMPLIANCE_VERIFICATION_STATUSES, "verification_status");
    const status = validateEnum(req.query.status, COMPLIANCE_STATUSES, "status");
    const expiringWithinDays = parsePositiveInt(req.query.expiring_within_days, DEFAULT_EXPIRY_DAYS) ?? DEFAULT_EXPIRY_DAYS;

    const whereClauses = ["company_id = $1"];
    const params = [companyId];
    let index = 1;

    if (scopeType) {
      index += 1;
      whereClauses.push(`scope_type = $${index}`);
      params.push(scopeType);
    }

    if (documentType) {
      index += 1;
      whereClauses.push(`document_type = $${index}`);
      params.push(documentType);
    }

    if (verificationStatus) {
      index += 1;
      whereClauses.push(`verification_status = $${index}`);
      params.push(verificationStatus);
    }

    if (status) {
      index += 1;
      whereClauses.push(`status = $${index}`);
      params.push(status);
    }

    const whereSql = `WHERE ${whereClauses.join(" AND ")}`;

    const [
      totalResult,
      verifiedResult,
      pendingResult,
      rejectedResult,
      inactiveResult,
      expiredResult,
      expiringResult,
      byTypeResult,
      byScopeResult
    ] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS count FROM compliance_documents ${whereSql}`, params),
      db.query(`SELECT COUNT(*)::int AS count FROM compliance_documents ${whereSql} AND verification_status = 'verified'`, params),
      db.query(`SELECT COUNT(*)::int AS count FROM compliance_documents ${whereSql} AND verification_status = 'pending'`, params),
      db.query(`SELECT COUNT(*)::int AS count FROM compliance_documents ${whereSql} AND verification_status = 'rejected'`, params),
      db.query(`SELECT COUNT(*)::int AS count FROM compliance_documents ${whereSql} AND status = 'inactive'`, params),
      db.query(`SELECT COUNT(*)::int AS count FROM compliance_documents ${whereSql} AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE`, params),
      db.query(
        `
        SELECT COUNT(*)::int AS count
        FROM compliance_documents
        WHERE company_id = $1
          AND expiry_date IS NOT NULL
          AND expiry_date >= CURRENT_DATE
          AND expiry_date <= CURRENT_DATE + ($2::int || ' days')::interval
        ${scopeType ? "AND scope_type = $3" : ""}
        ${documentType ? "AND document_type = $4" : ""}
        ${verificationStatus ? "AND verification_status = $5" : ""}
        ${status ? "AND status = $6" : ""}
        `,
        scopeType && documentType && verificationStatus && status
          ? [companyId, expiringWithinDays, scopeType, documentType, verificationStatus, status]
          : scopeType && documentType && verificationStatus
            ? [companyId, expiringWithinDays, scopeType, documentType, verificationStatus]
            : scopeType && documentType
              ? [companyId, expiringWithinDays, scopeType, documentType]
              : scopeType
                ? [companyId, expiringWithinDays, scopeType]
                : documentType
                  ? [companyId, expiringWithinDays, documentType]
                  : verificationStatus
                    ? [companyId, expiringWithinDays, verificationStatus]
                    : status
                      ? [companyId, expiringWithinDays, status]
                      : [companyId, expiringWithinDays]
      ),
      db.query(
        `
        SELECT document_type AS key, COUNT(*)::int AS count
        FROM compliance_documents
        WHERE company_id = $1
        ${scopeType ? "AND scope_type = $2" : ""}
        ${documentType ? "AND document_type = $3" : ""}
        ${verificationStatus ? "AND verification_status = $4" : ""}
        ${status ? "AND status = $5" : ""}
        GROUP BY document_type
        ORDER BY document_type
        `,
        scopeType && documentType && verificationStatus && status
          ? [companyId, scopeType, documentType, verificationStatus, status]
          : scopeType && documentType && verificationStatus
            ? [companyId, scopeType, documentType, verificationStatus]
            : scopeType && documentType
              ? [companyId, scopeType, documentType]
              : scopeType
                ? [companyId, scopeType]
                : documentType
                  ? [companyId, documentType]
                  : verificationStatus
                    ? [companyId, verificationStatus]
                    : status
                      ? [companyId, status]
                      : [companyId]
      ),
      db.query(
        `
        SELECT scope_type AS key, COUNT(*)::int AS count
        FROM compliance_documents
        WHERE company_id = $1
        ${scopeType ? "AND scope_type = $2" : ""}
        ${documentType ? "AND document_type = $3" : ""}
        ${verificationStatus ? "AND verification_status = $4" : ""}
        ${status ? "AND status = $5" : ""}
        GROUP BY scope_type
        ORDER BY scope_type
        `,
        scopeType && documentType && verificationStatus && status
          ? [companyId, scopeType, documentType, verificationStatus, status]
          : scopeType && documentType && verificationStatus
            ? [companyId, scopeType, documentType, verificationStatus]
            : scopeType && documentType
              ? [companyId, scopeType, documentType]
              : scopeType
                ? [companyId, scopeType]
                : documentType
                  ? [companyId, documentType]
                  : verificationStatus
                    ? [companyId, verificationStatus]
                    : status
                      ? [companyId, status]
                      : [companyId]
      )
    ]);

    res.json({
      generated_at: new Date().toISOString(),
      period: formatPeriod("snapshot", null, null),
      metrics: {
        total_documents: Number(totalResult.rows[0].count || 0),
        verified_documents: Number(verifiedResult.rows[0].count || 0),
        pending_documents: Number(pendingResult.rows[0].count || 0),
        rejected_documents: Number(rejectedResult.rows[0].count || 0),
        inactive_documents: Number(inactiveResult.rows[0].count || 0),
        expired_documents: Number(expiredResult.rows[0].count || 0),
        documents_expiring_soon: Number(expiringResult.rows[0].count || 0),
        threshold_days: expiringWithinDays
      },
      documents_by_type: byTypeResult.rows.map((row) => ({
        key: row.key,
        count: Number(row.count || 0)
      })),
      documents_by_scope_type: byScopeResult.rows.map((row) => ({
        key: row.key,
        count: Number(row.count || 0)
      }))
    });
  } catch (error) {
    console.error(error);

    if (error.message && error.message.includes("must be one of")) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: "Failed to fetch compliance analytics" });
  }
});

router.get("/incidents", async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const projectId = parsePositiveInt(req.query.project_id, null);
    const status = validateEnum(req.query.status, INCIDENT_STATUSES, "status");
    const severity = validateEnum(req.query.severity, INCIDENT_SEVERITIES, "severity");
    const incidentType = validateEnum(req.query.incident_type, INCIDENT_TYPES, "incident_type");

    if (projectId !== null) {
      const project = await ensureProjectBelongsToCompany(projectId, companyId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
    }

    const { hasPeriod, from, to } = parseDateRange(req);

    const whereClauses = ["company_id = $1"];
    const params = [companyId];
    let index = 1;

    if (projectId !== null) {
      index += 1;
      whereClauses.push(`project_id = $${index}`);
      params.push(projectId);
    }

    if (status) {
      index += 1;
      whereClauses.push(`status = $${index}`);
      params.push(status);
    }

    if (severity) {
      index += 1;
      whereClauses.push(`severity = $${index}`);
      params.push(severity);
    }

    if (incidentType) {
      index += 1;
      whereClauses.push(`incident_type = $${index}`);
      params.push(incidentType);
    }

    if (hasPeriod) {
      index += 1;
      whereClauses.push(`occurred_at >= $${index}`);
      params.push(from);
      index += 1;
      whereClauses.push(`occurred_at <= $${index}`);
      params.push(to);
    }

    const whereSql = `WHERE ${whereClauses.join(" AND ")}`;

    const [
      totalResult,
      severityResult,
      typeResult,
      timeSeriesResult,
      statusResult
    ] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS count FROM incidents ${whereSql}`, params),
      db.query(
        `
        SELECT severity AS key, COUNT(*)::int AS count
        FROM incidents
        ${whereSql}
        GROUP BY severity
        ORDER BY severity
        `,
        params
      ),
      db.query(
        `
        SELECT incident_type AS key, COUNT(*)::int AS count
        FROM incidents
        ${whereSql}
        GROUP BY incident_type
        ORDER BY incident_type
        `,
        params
      ),
      hasPeriod
        ? db.query(
            `
            SELECT DATE(occurred_at) AS date, COUNT(*)::int AS count
            FROM incidents
            ${whereSql}
            GROUP BY DATE(occurred_at)
            ORDER BY DATE(occurred_at)
            `,
            params
          )
        : Promise.resolve({ rows: [] }),
      hasPeriod
        ? Promise.resolve({ rows: [] })
        : db.query(
            `
            SELECT status AS key, COUNT(*)::int AS count
            FROM incidents
            WHERE company_id = $1
            ${projectId !== null ? "AND project_id = $2" : ""}
            ${status ? "AND status = $3" : ""}
            ${severity ? "AND severity = $4" : ""}
            ${incidentType ? "AND incident_type = $5" : ""}
            GROUP BY status
            ORDER BY status
            `,
            projectId !== null && status && severity && incidentType
              ? [companyId, projectId, status, severity, incidentType]
              : projectId !== null && status && severity
                ? [companyId, projectId, status, severity]
                : projectId !== null && status
                  ? [companyId, projectId, status]
                  : projectId !== null
                    ? [companyId, projectId]
                    : status && severity && incidentType
                      ? [companyId, status, severity, incidentType]
                      : status && severity
                        ? [companyId, status, severity]
                        : status
                          ? [companyId, status]
                          : severity
                            ? [companyId, severity]
                            : incidentType
                              ? [companyId, incidentType]
                              : [companyId]
          )
    ]);

    const response = {
      generated_at: new Date().toISOString(),
      period: formatPeriod(hasPeriod ? "period" : "snapshot", from, to),
      metrics: hasPeriod ? {
        total_incidents: Number(totalResult.rows[0].count || 0)
      } : {
        total_incidents: Number(totalResult.rows[0].count || 0),
        open_incidents: Number(statusResult.rows.find((row) => row.key === "open")?.count || 0),
        investigating_incidents: Number(statusResult.rows.find((row) => row.key === "investigating")?.count || 0),
        resolved_incidents: Number(statusResult.rows.find((row) => row.key === "resolved")?.count || 0),
        closed_incidents: Number(statusResult.rows.find((row) => row.key === "closed")?.count || 0)
      },
      incidents_by_severity: severityResult.rows.map((row) => ({
        key: row.key,
        count: Number(row.count || 0)
      })),
      incidents_by_type: typeResult.rows.map((row) => ({
        key: row.key,
        count: Number(row.count || 0)
      }))
    };

    if (hasPeriod) {
      response.incidents_over_time = timeSeriesResult.rows.map((row) => ({
        date: row.date ? row.date.toISOString().slice(0, 10) : null,
        count: Number(row.count || 0)
      }));
    }

    res.json(response);
  } catch (error) {
    console.error(error);

    if (error.message && error.message.includes("Both from and to")) {
      return res.status(400).json({ error: error.message });
    }

    if (error.message && error.message.includes("must be one of")) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: "Failed to fetch incident analytics" });
  }
});

router.get("/work-permits", async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const projectId = parsePositiveInt(req.query.project_id, null);
    const status = validateEnum(req.query.status, PERMIT_STATUSES, "status");
    const permitType = validateEnum(req.query.permit_type, PERMIT_TYPES, "permit_type");
    const riskLevel = validateEnum(req.query.risk_level, PERMIT_RISK_LEVELS, "risk_level");

    if (projectId !== null) {
      const project = await ensureProjectBelongsToCompany(projectId, companyId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
    }

    const { hasPeriod, from, to } = parseDateRange(req);

    const whereClauses = ["company_id = $1"];
    const params = [companyId];
    let index = 1;

    if (projectId !== null) {
      index += 1;
      whereClauses.push(`project_id = $${index}`);
      params.push(projectId);
    }

    if (status) {
      index += 1;
      whereClauses.push(`status = $${index}`);
      params.push(status);
    }

    if (permitType) {
      index += 1;
      whereClauses.push(`permit_type = $${index}`);
      params.push(permitType);
    }

    if (riskLevel) {
      index += 1;
      whereClauses.push(`risk_level = $${index}`);
      params.push(riskLevel);
    }

    if (hasPeriod) {
      index += 1;
      whereClauses.push(`COALESCE(submitted_at, created_at) >= $${index}`);
      params.push(from);
      index += 1;
      whereClauses.push(`COALESCE(submitted_at, created_at) <= $${index}`);
      params.push(to);
    }

    const whereSql = `WHERE ${whereClauses.join(" AND ")}`;

    const [
      totalResult,
      activeResult,
      pendingReviewResult,
      rejectedResult,
      expiredResult,
      statusBreakdownResult,
      typeBreakdownResult,
      riskBreakdownResult,
      avgApprovalResult,
      activationResult
    ] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS count FROM work_permits ${whereSql}`, params),
      db.query(`SELECT COUNT(*)::int AS count FROM work_permits ${whereSql} AND status = 'active'`, params),
      db.query(`SELECT COUNT(*)::int AS count FROM work_permits ${whereSql} AND status = 'pending_review'`, params),
      db.query(`SELECT COUNT(*)::int AS count FROM work_permits ${whereSql} AND status = 'rejected'`, params),
      db.query(`SELECT COUNT(*)::int AS count FROM work_permits ${whereSql} AND status = 'expired'`, params),
      db.query(
        `
        SELECT status AS key, COUNT(*)::int AS count
        FROM work_permits
        ${whereSql}
        GROUP BY status
        ORDER BY status
        `,
        params
      ),
      db.query(
        `
        SELECT permit_type AS key, COUNT(*)::int AS count
        FROM work_permits
        ${whereSql}
        GROUP BY permit_type
        ORDER BY permit_type
        `,
        params
      ),
      db.query(
        `
        SELECT risk_level AS key, COUNT(*)::int AS count
        FROM work_permits
        ${whereSql}
        GROUP BY risk_level
        ORDER BY risk_level
        `,
        params
      ),
      db.query(
        `
        SELECT AVG(EXTRACT(EPOCH FROM (approved_at - submitted_at)) / 86400.0) AS average_approval_processing_time_days
        FROM work_permits
        WHERE company_id = $1
          AND approved_at IS NOT NULL
          AND submitted_at IS NOT NULL
          ${projectId !== null ? "AND project_id = $2" : ""}
          ${status ? "AND status = $3" : ""}
          ${permitType ? "AND permit_type = $4" : ""}
          ${riskLevel ? "AND risk_level = $5" : ""}
        `,
        projectId !== null && status && permitType && riskLevel
          ? [companyId, projectId, status, permitType, riskLevel]
          : projectId !== null && status && permitType
            ? [companyId, projectId, status, permitType]
            : projectId !== null && status
              ? [companyId, projectId, status]
              : projectId !== null
                ? [companyId, projectId]
                : status && permitType && riskLevel
                  ? [companyId, status, permitType, riskLevel]
                  : status && permitType
                    ? [companyId, status, permitType]
                    : status
                      ? [companyId, status]
                      : permitType
                        ? [companyId, permitType]
                        : riskLevel
                          ? [companyId, riskLevel]
                          : [companyId]
      ),
      db.query(
        `
        SELECT AVG(EXTRACT(EPOCH FROM (e.created_at - wp.approved_at)) / 86400.0) AS activation_latency_days
        FROM work_permit_events e
        INNER JOIN work_permits wp
          ON wp.id = e.permit_id
         AND wp.company_id = e.company_id
        WHERE e.company_id = $1
          AND e.event_type = 'activated'
          AND e.created_at IS NOT NULL
          AND wp.approved_at IS NOT NULL
          ${projectId !== null ? "AND wp.project_id = $2" : ""}
          ${status ? "AND wp.status = $3" : ""}
          ${permitType ? "AND wp.permit_type = $4" : ""}
          ${riskLevel ? "AND wp.risk_level = $5" : ""}
        `,
        projectId !== null && status && permitType && riskLevel
          ? [companyId, projectId, status, permitType, riskLevel]
          : projectId !== null && status && permitType
            ? [companyId, projectId, status, permitType]
            : projectId !== null && status
              ? [companyId, projectId, status]
              : projectId !== null
                ? [companyId, projectId]
                : status && permitType && riskLevel
                  ? [companyId, status, permitType, riskLevel]
                  : status && permitType
                    ? [companyId, status, permitType]
                    : status
                      ? [companyId, status]
                      : permitType
                        ? [companyId, permitType]
                        : riskLevel
                          ? [companyId, riskLevel]
                          : [companyId]
      )
    ]);

    const response = {
      generated_at: new Date().toISOString(),
      period: formatPeriod(hasPeriod ? "period" : "snapshot", from, to),
      metrics: {
        total_permits: Number(totalResult.rows[0].count || 0),
        active_permits: Number(activeResult.rows[0].count || 0),
        pending_review: Number(pendingReviewResult.rows[0].count || 0),
        rejected: Number(rejectedResult.rows[0].count || 0),
        expired: Number(expiredResult.rows[0].count || 0)
      },
      permits_by_status: statusBreakdownResult.rows.map((row) => ({
        key: row.key,
        count: Number(row.count || 0)
      })),
      permits_by_type: typeBreakdownResult.rows.map((row) => ({
        key: row.key,
        count: Number(row.count || 0)
      })),
      permits_by_risk_level: riskBreakdownResult.rows.map((row) => ({
        key: row.key,
        count: Number(row.count || 0)
      }))
    };

    const avgApproval = Number(avgApprovalResult.rows[0].average_approval_processing_time_days || 0);
    if (Number.isFinite(avgApproval) && avgApproval >= 0) {
      response.metrics.average_approval_processing_time_days = Number(avgApproval.toFixed(2));
    }

    const activation = Number(activationResult.rows[0].activation_latency_days || 0);
    if (Number.isFinite(activation) && activation >= 0 && activationResult.rows[0].activation_latency_days !== null) {
      response.metrics.activation_latency_days = Number(activation.toFixed(2));
    }

    res.json(response);
  } catch (error) {
    console.error(error);

    if (error.message && error.message.includes("Both from and to")) {
      return res.status(400).json({ error: error.message });
    }

    if (error.message && error.message.includes("must be one of")) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: "Failed to fetch permit analytics" });
  }
});

router.get("/trends", async (req, res) => {
  try {
    const metric = req.query.metric;
    const granularity = req.query.granularity;

    if (!metric || !TREND_METRICS.includes(metric)) {
      return res.status(400).json({
        error: `metric must be one of: ${TREND_METRICS.join(", ")}`
      });
    }

    if (!granularity || !TREND_GRANULARITIES.includes(granularity)) {
      return res.status(400).json({
        error: `granularity must be one of: ${TREND_GRANULARITIES.join(", ")}`
      });
    }

    const { from, to } = parseDateRange(req);
    if (!from || !to) {
      return res.status(400).json({ error: "Trend endpoints require both from and to parameters" });
    }

    const companyId = req.user.company_id;

    if (metric === "workers" || metric === "projects") {
      return res.status(400).json({
        error: "Historical trend data for workers or projects is not supported by the current schema because it stores current-state rows only."
      });
    }

    const dateTrunc = {
      day: "DATE",
      week: "DATE_TRUNC('week', ",
      month: "DATE_TRUNC('month', "
    };

    let sql = "";
    let params = [companyId, from, to];

    if (metric === "incidents") {
      sql = `
        SELECT DATE(occurred_at) AS date, COUNT(*)::int AS value
        FROM incidents
        WHERE company_id = $1
          AND occurred_at >= $2
          AND occurred_at <= $3
        GROUP BY DATE(occurred_at)
        ORDER BY DATE(occurred_at)
      `;
    } else if (metric === "permits") {
      sql = `
        SELECT DATE(created_at) AS date, COUNT(*)::int AS value
        FROM work_permits
        WHERE company_id = $1
          AND created_at >= $2
          AND created_at <= $3
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at)
      `;
    } else if (metric === "documents_expiring") {
      sql = `
        SELECT DATE(expiry_date) AS date, COUNT(*)::int AS value
        FROM compliance_documents
        WHERE company_id = $1
          AND expiry_date IS NOT NULL
          AND expiry_date >= $2
          AND expiry_date <= $3
        GROUP BY DATE(expiry_date)
        ORDER BY DATE(expiry_date)
      `;
    }

    if (!sql) {
      return res.status(400).json({ error: "Unsupported trend metric" });
    }

    const result = await db.query(sql, params);

    const items = result.rows.map((row) => ({
      date: row.date ? row.date.toISOString().slice(0, 10) : null,
      value: Number(row.value || 0)
    }));

    res.json({
      generated_at: new Date().toISOString(),
      period: {
        scope: "trend",
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10)
      },
      metric,
      granularity,
      items
    });
  } catch (error) {
    console.error(error);

    if (error.message && error.message.includes("Both from and to")) {
      return res.status(400).json({ error: error.message });
    }

    if (error.message && error.message.includes("must be one of")) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: "Failed to fetch trend analytics" });
  }
});

module.exports = router;
