import { useEffect, useMemo, useState } from "react";
import AppLayout from "../layouts/AppLayout";

const API_BASE_URL = "http://localhost:5000/api";

const REPORTS = [
  {
    id: "executive",
    title: "Executive Overview",
    description:
      "High-level operational performance across workforce, projects, safety, assets, and compliance.",
    icon: "◈",
    category: "Management",
    endpoint: "/reports/executive",
  },
  {
    id: "workforce",
    title: "Workforce Report",
    description:
      "Review workforce numbers, employment structure, worker activity, and operational staffing.",
    icon: "◉",
    category: "People",
    endpoint: "/reports/workforce",
  },
  {
    id: "projects",
    title: "Projects Report",
    description:
      "Monitor project activity, status distribution, assignments, and operational performance.",
    icon: "▦",
    category: "Operations",
    endpoint: "/reports/projects",
  },
  {
    id: "contractors",
    title: "Contractors Report",
    description:
      "Review contractor activity, workforce deployment, compliance, and project involvement.",
    icon: "◈",
    category: "Operations",
    endpoint: "/reports/contractors",
  },
  {
    id: "assets",
    title: "Assets Report",
    description:
      "Track company equipment, deployment, maintenance status, and operational availability.",
    icon: "▣",
    category: "Assets",
    endpoint: "/reports/assets",
  },
  {
    id: "compliance",
    title: "Compliance Report",
    description:
      "Review compliance documents, expiry risks, coverage, and outstanding requirements.",
    icon: "✓",
    category: "Risk & Compliance",
    endpoint: "/reports/compliance",
  },
  {
    id: "incidents",
    title: "Incidents Report",
    description:
      "Analyze workplace incidents, severity, status, trends, and corrective actions.",
    icon: "⚠",
    category: "Safety",
    endpoint: "/reports/incidents",
  },
  {
    id: "work-permits",
    title: "Work Permits Report",
    description:
      "Review controlled work, permit statuses, risk levels, approvals, and lifecycle activity.",
    icon: "◫",
    category: "Safety",
    endpoint: "/reports/work-permits",
  },
];

const FILTER_CONFIG = {
  executive: [],

  workforce: [
    {
      key: "status",
      label: "Worker status",
      options: [
        ["", "All statuses"],
        ["active", "Active"],
        ["inactive", "Inactive"],
        ["suspended", "Suspended"],
        ["terminated", "Terminated"],
      ],
    },
    {
      key: "employment_type",
      label: "Employment type",
      options: [
        ["", "All employment"],
        ["direct", "Direct"],
        ["contractor", "Contractor"],
      ],
    },
  ],

  projects: [
    {
      key: "status",
      label: "Project status",
      options: [
        ["", "All statuses"],
        ["planning", "Planning"],
        ["active", "Active"],
        ["on_hold", "On hold"],
        ["completed", "Completed"],
        ["cancelled", "Cancelled"],
      ],
    },
  ],

  contractors: [],

  assets: [
    {
      key: "status",
      label: "Asset status",
      options: [
        ["", "All statuses"],
        ["active", "Active"],
        ["inactive", "Inactive"],
      ],
    },
    {
      key: "operational_status",
      label: "Operational status",
      options: [
        ["", "All operational"],
        ["available", "Available"],
        ["in_use", "In use"],
        ["under_maintenance", "Under maintenance"],
        ["out_of_service", "Out of service"],
      ],
    },
  ],

  compliance: [
    {
      key: "document_type",
      label: "Document type",
      options: [
        ["", "All document types"],
        ["safety_certificate", "Safety certificate"],
        ["insurance", "Insurance"],
        ["environmental_permit", "Environmental permit"],
        ["operating_licence", "Operating licence"],
        ["inspection_certificate", "Inspection certificate"],
        ["regulatory_approval", "Regulatory approval"],
        ["tax_compliance", "Tax compliance"],
        ["other", "Other"],
      ],
    },
    {
      key: "scope_type",
      label: "Scope",
      options: [
        ["", "All scopes"],
        ["company", "Company"],
        ["project", "Project"],
        ["contractor", "Contractor"],
        ["asset", "Asset"],
        ["supplier", "Supplier"],
      ],
    },
    {
      key: "verification_status",
      label: "Verification",
      options: [
        ["", "All verification"],
        ["pending", "Pending"],
        ["verified", "Verified"],
        ["rejected", "Rejected"],
      ],
    },
  ],

  incidents: [
    {
      key: "severity",
      label: "Severity",
      options: [
        ["", "All severities"],
        ["low", "Low"],
        ["medium", "Medium"],
        ["high", "High"],
        ["critical", "Critical"],
      ],
    },
    {
      key: "status",
      label: "Incident status",
      options: [
        ["", "All statuses"],
        ["open", "Open"],
        ["investigating", "Investigating"],
        ["resolved", "Resolved"],
        ["closed", "Closed"],
        ["cancelled", "Cancelled"],
      ],
    },
    {
      key: "incident_type",
      label: "Incident type",
      options: [
        ["", "All types"],
        ["accident", "Accident"],
        ["near_miss", "Near miss"],
        ["injury", "Injury"],
        ["property_damage", "Property damage"],
        ["environmental", "Environmental"],
        ["fire", "Fire"],
        ["security", "Security"],
        ["other", "Other"],
      ],
    },
  ],

  "work-permits": [
    {
      key: "permit_type",
      label: "Permit type",
      options: [
        ["", "All permit types"],
        ["hot_work", "Hot work"],
        ["confined_space", "Confined space"],
        ["work_at_height", "Work at height"],
        ["excavation", "Excavation"],
        ["electrical_isolation", "Electrical isolation"],
        ["lifting_operation", "Lifting operation"],
        ["line_breaking", "Line breaking"],
        ["general_work", "General work"],
        ["other", "Other"],
      ],
    },
    {
      key: "risk_level",
      label: "Risk level",
      options: [
        ["", "All risk levels"],
        ["low", "Low"],
        ["medium", "Medium"],
        ["high", "High"],
        ["critical", "Critical"],
      ],
    },
    {
      key: "status",
      label: "Permit status",
      options: [
        ["", "All statuses"],
        ["draft", "Draft"],
        ["pending_review", "Pending review"],
        ["approved", "Approved"],
        ["active", "Active"],
        ["suspended", "Suspended"],
        ["closed", "Closed"],
        ["expired", "Expired"],
        ["rejected", "Rejected"],
        ["cancelled", "Cancelled"],
      ],
    },
  ],
};

const FILTER_LABELS = {
  status: "Status",
  severity: "Severity",
  incident_type: "Incident type",
  employment_type: "Employment type",
  operational_status: "Operational status",
  document_type: "Document type",
  scope_type: "Scope",
  verification_status: "Verification",
  permit_type: "Permit type",
  risk_level: "Risk level",
};

const FIELD_LABELS = {
  id: "ID",
  name: "Name",
  title: "Title",
  company_name: "Company",
  contact_person: "Contact person",
  email: "Email",
  phone: "Phone",
  position: "Position",
  status: "Status",
  employment_type: "Employment type",
  contractor_name: "Contractor",
  contractor_id: "Contractor ID",
  project_name: "Project",
  project_id: "Project ID",
  asset_name: "Asset",
  asset_type: "Asset type",
  serial_number: "Serial number",
  asset_tag: "Asset tag",
  location: "Location",
  ownership_type: "Ownership",
  operational_status: "Operational status",
  document_type: "Document type",
  scope_type: "Scope",
  verification_status: "Verification",
  issued_date: "Issued",
  expiry_date: "Expiry",
  reference_number: "Reference",
  issuing_authority: "Issuing authority",
  supplier_name: "Supplier",
  incident_type: "Incident type",
  severity: "Severity",
  occurred_at: "Occurred",
  resolved_at: "Resolved",
  reported_by_name: "Reported by",
  assigned_to_name: "Assigned to",
  corrective_action: "Corrective action",
  permit_number: "Permit number",
  permit_type: "Permit type",
  risk_level: "Risk level",
  valid_from: "Valid from",
  valid_until: "Valid until",
  created_by_name: "Created by",
  reviewed_by_name: "Reviewed by",
  approved_by_name: "Approved by",
  submitted_at: "Submitted",
  reviewed_at: "Reviewed",
  approved_at: "Approved",
  approval_processing_time: "Approval processing",
  worker_count: "Workers",
  asset_count: "Assets",
  document_count: "Documents",
  active_assignment_count: "Assignments",
  active_workers: "Active workers",
  total_workers: "Total workers",
  direct_workers: "Direct workers",
  contractor_workers: "Contractor workers",
  valid_certifications: "Valid certifications",
  start_date: "Start date",
  end_date: "End date",
  description: "Description",
  purchase_date: "Purchase date",
  last_maintenance_date: "Last maintenance",
  next_maintenance_date: "Next maintenance",
  purchase_cost: "Purchase cost",
  rental_start_date: "Rental start",
  rental_end_date: "Rental end",
  certification_status: "Certification status",
  worker_count: "Workers",
  compliance_document_count: "Compliance documents",
  project_count: "Projects",
};

const PRIORITY_FIELDS = {
  workforce: [
    "name",
    "position",
    "status",
    "employment_type",
    "contractor_name",
    "active_assignment_count",
    "valid_certifications",
  ],

  projects: [
    "name",
    "location",
    "status",
    "start_date",
    "end_date",
    "active_assignment_count",
    "permit_count",
    "incident_count",
    "asset_count",
    "compliance_document_count",
  ],

  contractors: [
    "company_name",
    "contact_person",
    "email",
    "phone",
    "certification_status",
    "project_name",
    "worker_count",
    "compliance_document_count",
  ],

  assets: [
    "name",
    "asset_type",
    "asset_tag",
    "serial_number",
    "location",
    "ownership_type",
    "status",
    "operational_status",
    "project_name",
    "next_maintenance_date",
  ],

  compliance: [
    "name",
    "document_type",
    "scope_type",
    "status",
    "verification_status",
    "issued_date",
    "expiry_date",
    "project_name",
    "contractor_name",
    "asset_name",
    "supplier_name",
  ],

  incidents: [
    "title",
    "incident_type",
    "severity",
    "status",
    "occurred_at",
    "project_name",
    "reported_by_name",
    "assigned_to_name",
    "corrective_action",
  ],

  "work-permits": [
    "permit_number",
    "title",
    "project_name",
    "contractor_name",
    "permit_type",
    "risk_level",
    "status",
    "valid_from",
    "valid_until",
    "created_by_name",
    "reviewed_by_name",
    "approved_by_name",
    "worker_count",
    "asset_count",
    "document_count",
  ],
};

function formatLabel(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatValue(value, key = "") {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (
    typeof value === "boolean"
  ) {
    return value ? "Yes" : "No";
  }

  if (
    typeof value === "number" &&
    key.toLowerCase().includes("cost")
  ) {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      maximumFractionDigits: 2,
    }).format(value);
  }

  if (
    typeof value === "number"
  ) {
    return value.toLocaleString();
  }

  if (
    typeof value === "string" &&
    (key.includes("_at") ||
      key.includes("_date") ||
      key === "date")
  ) {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    }
  }

  if (Array.isArray(value)) {
    return value.length
      ? value.join(", ")
      : "—";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function getStatusClass(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (
    [
      "active",
      "approved",
      "verified",
      "resolved",
      "closed",
      "available",
      "completed",
      "planning",
    ].includes(normalized)
  ) {
    return "status-positive";
  }

  if (
    [
      "pending",
      "pending_review",
      "investigating",
      "medium",
      "in_use",
      "on_hold",
    ].includes(normalized)
  ) {
    return "status-warning";
  }

  if (
    [
      "high",
      "critical",
      "rejected",
      "cancelled",
      "expired",
      "inactive",
      "terminated",
      "suspended",
      "out_of_service",
      "under_maintenance",
    ].includes(normalized)
  ) {
    return "status-danger";
  }

  return "status-neutral";
}

function isStatusField(key) {
  return [
    "status",
    "severity",
    "risk_level",
    "verification_status",
    "operational_status",
    "certification_status",
    "employment_type",
    "incident_type",
    "permit_type",
    "scope_type",
  ].includes(key);
}

function normalizeSectionData(section) {
  if (!section) {
    return [];
  }

  if (Array.isArray(section)) {
    return section;
  }

  if (Array.isArray(section.data)) {
    return section.data;
  }

  if (Array.isArray(section.rows)) {
    return section.rows;
  }

  if (Array.isArray(section.items)) {
    return section.items;
  }

  return [];
}

function getSectionTitle(section, index) {
  if (typeof section === "string") {
    return formatLabel(section);
  }

  return (
    section?.title ||
    section?.name ||
    section?.label ||
    `Breakdown ${index + 1}`
  );
}

function getSectionRows(section) {
  const rows = normalizeSectionData(section);

  if (rows.length) {
    return rows;
  }

  if (
    section &&
    typeof section === "object" &&
    !Array.isArray(section)
  ) {
    const entries = Object.entries(section).filter(
      ([key]) =>
        ![
          "title",
          "name",
          "label",
          "description",
        ].includes(key)
    );

    if (
      entries.length &&
      entries.every(
        ([, value]) =>
          typeof value !== "object"
      )
    ) {
      return entries.map(([label, value]) => ({
        label,
        value,
      }));
    }
  }

  return [];
}

function getObjectKeys(rows) {
  const keys = [];

  rows.forEach((row) => {
    if (
      row &&
      typeof row === "object" &&
      !Array.isArray(row)
    ) {
      Object.keys(row).forEach((key) => {
        if (!keys.includes(key)) {
          keys.push(key);
        }
      });
    }
  });

  return keys;
}

function ReportSummary({ summary }) {
  if (!summary || typeof summary !== "object") {
    return null;
  }

  const entries = Object.entries(summary);

  if (!entries.length) {
    return null;
  }

  return (
    <section className="report-summary-section">
      <div className="report-subsection-heading">
        <div>
          <span className="eyebrow">
            PERFORMANCE SNAPSHOT
          </span>
          <h4>Key metrics</h4>
        </div>
      </div>

      <div className="report-kpi-grid">
        {entries.map(([key, value]) => {
          if (
            value &&
            typeof value === "object" &&
            !Array.isArray(value)
          ) {
            return null;
          }

          return (
            <div
              className="report-kpi-card"
              key={key}
            >
              <span>
                {FIELD_LABELS[key] ||
                  FILTER_LABELS[key] ||
                  formatLabel(key)}
              </span>

              <strong>
                {formatValue(value, key)}
              </strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReportSections({ sections }) {
  if (!sections) {
    return null;
  }

  const sectionEntries = Array.isArray(sections)
    ? sections
    : Object.entries(sections).map(
        ([key, value]) => ({
          title: formatLabel(key),
          data: value,
        })
      );

  if (!sectionEntries.length) {
    return null;
  }

  return (
    <section className="report-breakdown-section">
      <div className="report-subsection-heading">
        <div>
          <span className="eyebrow">
            ANALYSIS
          </span>
          <h4>Operational breakdown</h4>
        </div>
      </div>

      <div className="report-breakdown-grid">
        {sectionEntries.map(
          (section, index) => {
            const rows =
              getSectionRows(section);

            return (
              <div
                className="report-breakdown-card"
                key={`${getSectionTitle(
                  section,
                  index
                )}-${index}`}
              >
                <div className="report-breakdown-card-header">
                  <h5>
                    {getSectionTitle(
                      section,
                      index
                    )}
                  </h5>
                </div>

                {!rows.length ? (
                  <div className="report-empty-small">
                    No breakdown data available.
                  </div>
                ) : (
                  <div className="report-breakdown-list">
                    {rows.map(
                      (row, rowIndex) => {
                        if (
                          row &&
                          typeof row ===
                            "object" &&
                          !Array.isArray(row)
                        ) {
                          const entries =
                            Object.entries(
                              row
                            );

                          const labelEntry =
                            entries.find(
                              ([key]) =>
                                [
                                  "label",
                                  "name",
                                  "status",
                                  "severity",
                                  "type",
                                  "category",
                                ].includes(
                                  key
                                )
                            );

                          const valueEntry =
                            entries.find(
                              ([key]) =>
                                [
                                  "count",
                                  "total",
                                  "value",
                                  "amount",
                                ].includes(
                                  key
                                )
                            );

                          return (
                            <div
                              className="report-breakdown-row"
                              key={rowIndex}
                            >
                              <span>
                                {formatLabel(
                                  labelEntry
                                    ? labelEntry[1]
                                    : entries[0]?.[1]
                                )}
                              </span>

                              <strong>
                                {formatValue(
                                  valueEntry
                                    ? valueEntry[1]
                                    : entries[1]?.[1],
                                  valueEntry
                                    ? valueEntry[0]
                                    : entries[1]?.[0]
                                )}
                              </strong>
                            </div>
                          );
                        }

                        return (
                          <div
                            className="report-breakdown-row"
                            key={rowIndex}
                          >
                            <span>
                              {formatLabel(
                                row
                              )}
                            </span>
                          </div>
                        );
                      }
                    )}
                  </div>
                )}
              </div>
            );
          }
        )}
      </div>
    </section>
  );
}

function ReportItemsTable({
  reportId,
  items,
}) {
  if (!Array.isArray(items)) {
    return null;
  }

  if (!items.length) {
    return (
      <section className="report-items-section">
        <div className="report-subsection-heading">
          <div>
            <span className="eyebrow">
              RECORDS
            </span>
            <h4>Report records</h4>
          </div>
        </div>

        <div className="report-empty-state">
          <div className="report-empty-icon">
            ◌
          </div>
          <h4>No records found</h4>
          <p>
            There are no records matching the
            selected report criteria.
          </p>
        </div>
      </section>
    );
  }

  let keys = PRIORITY_FIELDS[reportId] || [];

  const availableKeys =
    getObjectKeys(items);

  keys = keys.filter((key) =>
    availableKeys.includes(key)
  );

  availableKeys.forEach((key) => {
    if (!keys.includes(key)) {
      keys.push(key);
    }
  });

  const visibleKeys = keys.slice(0, 12);

  return (
    <section className="report-items-section">
      <div className="report-subsection-heading">
        <div>
          <span className="eyebrow">
            RECORDS
          </span>

          <h4>Report records</h4>

          <p>
            Showing {items.length.toLocaleString()}{" "}
            records returned by the report.
          </p>
        </div>
      </div>

      <div className="report-table-shell">
        <div className="report-table-scroll">
          <table className="report-table">
            <thead>
              <tr>
                {visibleKeys.map((key) => (
                  <th key={key}>
                    {FIELD_LABELS[key] ||
                      formatLabel(key)}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {items.map(
                (item, rowIndex) => (
                  <tr
                    key={
                      item?.id ||
                      item?.permit_number ||
                      `${reportId}-${rowIndex}`
                    }
                  >
                    {visibleKeys.map(
                      (key) => {
                        const value =
                          item?.[key];

                        return (
                          <td key={key}>
                            {isStatusField(
                              key
                            ) ? (
                              <span
                                className={`report-status-badge ${getStatusClass(
                                  value
                                )}`}
                              >
                                {formatLabel(
                                  value
                                )}
                              </span>
                            ) : (
                              <span
                                className={
                                  key ===
                                    "corrective_action" ||
                                  key ===
                                    "description"
                                    ? "report-table-text"
                                    : ""
                                }
                              >
                                {formatValue(
                                  value,
                                  key
                                )}
                              </span>
                            )}
                          </td>
                        );
                      }
                    )}
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Reports() {
  const [selectedReport, setSelectedReport] =
    useState(null);

  const [reportData, setReportData] =
    useState(null);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const [filters, setFilters] =
    useState({});

  const [fromDate, setFromDate] =
    useState("");

  const [toDate, setToDate] =
    useState("");

  const [page, setPage] =
    useState(1);

  const [limit, setLimit] =
    useState(25);

  const currentFilterConfig =
    useMemo(() => {
      if (!selectedReport) {
        return [];
      }

      return (
        FILTER_CONFIG[
          selectedReport.id
        ] || []
      );
    }, [selectedReport]);

  const loadReport = async (
    report = selectedReport,
    requestedPage = page
  ) => {
    if (!report) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const token = localStorage.getItem(
        "industrafow_token"
      );

      const params =
        new URLSearchParams();

      params.set(
        "page",
        String(requestedPage)
      );

      params.set(
        "limit",
        String(limit)
      );

      if (fromDate) {
        params.set("from", fromDate);
      }

      if (toDate) {
        params.set("to", toDate);
      }

      Object.entries(filters).forEach(
        ([key, value]) => {
          if (
            value !== undefined &&
            value !== null &&
            value !== ""
          ) {
            params.set(key, value);
          }
        }
      );

      const response = await fetch(
        `${API_BASE_URL}${report.endpoint}?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.error ||
            "Unable to load report."
        );
      }

      setReportData(data);
      setPage(
        Number(data.page) ||
          requestedPage
      );
    } catch (err) {
      setError(
        err.message ||
          "Unable to load report."
      );
    } finally {
      setLoading(false);
    }
  };

  const openReport = (report) => {
    setSelectedReport(report);
    setReportData(null);
    setError("");
    setFilters({});
    setFromDate("");
    setToDate("");
    setPage(1);
  };

  useEffect(() => {
    if (selectedReport) {
      loadReport(
        selectedReport,
        1
      );
    }

    // Intentionally run only when a new report is opened.
    // Filter changes are applied through Apply Filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReport]);

  const closeReport = () => {
    setSelectedReport(null);
    setReportData(null);
    setError("");
    setFilters({});
    setFromDate("");
    setToDate("");
    setPage(1);
  };

  const handleFilterChange = (
    key,
    value
  ) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const applyFilters = () => {
    setPage(1);
    loadReport(
      selectedReport,
      1
    );
  };

  const clearFilters = () => {
    setFilters({});
    setFromDate("");
    setToDate("");
    setPage(1);

    setTimeout(() => {
      loadReport(
        selectedReport,
        1
      );
    }, 0);
  };

  const goToPage = (nextPage) => {
    if (
      nextPage < 1 ||
      loading
    ) {
      return;
    }

    setPage(nextPage);

    loadReport(
      selectedReport,
      nextPage
    );
  };

  const total =
    Number(
      reportData?.total ??
        reportData?.count ??
        0
    ) || 0;

  const currentPage =
    Number(
      reportData?.page ??
        page
    ) || page;

  const currentLimit =
    Number(
      reportData?.limit ??
        limit
    ) || limit;

  const totalPages =
    total > 0
      ? Math.ceil(
          total /
            currentLimit
        )
      : 1;

  return (
    <AppLayout>
      <div className="page reports-page">
        <section className="page-header">
          <div>
            <span className="eyebrow">
              REPORTING & ANALYTICS
            </span>

            <h2>Reports</h2>

            <p>
              Generate operational reports
              across workforce, projects,
              safety, assets, compliance,
              and controlled work.
            </p>
          </div>
        </section>

        <section className="reports-summary-grid">
          <div className="reports-summary-card">
            <div className="reports-summary-icon">
              ◈
            </div>

            <div>
              <span>
                Available reports
              </span>

              <strong>
                {REPORTS.length}
              </strong>
            </div>
          </div>

          <div className="reports-summary-card">
            <div className="reports-summary-icon">
              ◉
            </div>

            <div>
              <span>
                Operational areas
              </span>

              <strong>6</strong>
            </div>
          </div>

          <div className="reports-summary-card">
            <div className="reports-summary-icon">
              ⚠
            </div>

            <div>
              <span>
                Safety reports
              </span>

              <strong>2</strong>
            </div>
          </div>

          <div className="reports-summary-card">
            <div className="reports-summary-icon">
              ✓
            </div>

            <div>
              <span>
                Compliance coverage
              </span>

              <strong>Live</strong>
            </div>
          </div>
        </section>

        <section className="reports-section">
          <div className="reports-section-heading">
            <div>
              <span className="eyebrow">
                REPORT CENTER
              </span>

              <h3>
                Operational reports
              </h3>

              <p>
                Select a report to retrieve
                live information from your
                organization.
              </p>
            </div>
          </div>

          <div className="reports-grid">
            {REPORTS.map(
              (report) => (
                <article
                  key={report.id}
                  className="report-card"
                >
                  <div className="report-card-top">
                    <div className="report-icon">
                      {report.icon}
                    </div>

                    <span className="report-category">
                      {report.category}
                    </span>
                  </div>

                  <div className="report-card-content">
                    <h3>
                      {report.title}
                    </h3>

                    <p>
                      {report.description}
                    </p>
                  </div>

                  <div className="report-card-footer">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() =>
                        openReport(
                          report
                        )
                      }
                    >
                      View report
                    </button>
                  </div>
                </article>
              )
            )}
          </div>
        </section>

        {selectedReport && (
          <div className="reports-modal-backdrop">
            <div className="reports-modal">
              <div className="reports-modal-header">
                <div>
                  <span className="eyebrow">
                    {selectedReport.category}
                  </span>

                  <h3>
                    {selectedReport.title}
                  </h3>

                  <p>
                    {
                      selectedReport.description
                    }
                  </p>
                </div>

                <button
                  type="button"
                  className="modal-close-button"
                  onClick={
                    closeReport
                  }
                  aria-label="Close report"
                >
                  ×
                </button>
              </div>

              <div className="reports-modal-body">
                <section className="report-control-panel">
                  <div className="report-control-heading">
                    <div>
                      <span className="eyebrow">
                        REPORT CONTROLS
                      </span>

                      <h4>
                        Filter report
                      </h4>

                      <p>
                        Refine the report
                        using the available
                        operational criteria.
                      </p>
                    </div>

                    <button
                      type="button"
                      className="report-refresh-button"
                      onClick={() =>
                        loadReport(
                          selectedReport,
                          currentPage
                        )
                      }
                      disabled={
                        loading
                      }
                    >
                      ↻ Refresh
                    </button>
                  </div>

                  <div className="report-filter-grid">
                    <div className="report-filter-field">
                      <label htmlFor="report-from">
                        From date
                      </label>

                      <input
                        id="report-from"
                        type="date"
                        value={
                          fromDate
                        }
                        onChange={(
                          event
                        ) =>
                          setFromDate(
                            event
                              .target
                              .value
                          )
                        }
                      />
                    </div>

                    <div className="report-filter-field">
                      <label htmlFor="report-to">
                        To date
                      </label>

                      <input
                        id="report-to"
                        type="date"
                        value={
                          toDate
                        }
                        onChange={(
                          event
                        ) =>
                          setToDate(
                            event
                              .target
                              .value
                          )
                        }
                      />
                    </div>

                    {currentFilterConfig.map(
                      (filter) => (
                        <div
                          className="report-filter-field"
                          key={
                            filter.key
                          }
                        >
                          <label
                            htmlFor={`report-filter-${filter.key}`}
                          >
                            {
                              filter.label
                            }
                          </label>

                          <select
                            id={`report-filter-${filter.key}`}
                            value={
                              filters[
                                filter
                                  .key
                              ] ||
                              ""
                            }
                            onChange={(
                              event
                            ) =>
                              handleFilterChange(
                                filter.key,
                                event
                                  .target
                                  .value
                              )
                            }
                          >
                            {filter.options.map(
                              ([
                                value,
                                label,
                              ]) => (
                                <option
                                  value={
                                    value
                                  }
                                  key={
                                    value ||
                                    "all"
                                  }
                                >
                                  {
                                    label
                                  }
                                </option>
                              )
                            )}
                          </select>
                        </div>
                      )
                    )}
                  </div>

                  <div className="report-filter-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={
                        clearFilters
                      }
                      disabled={
                        loading
                      }
                    >
                      Clear filters
                    </button>

                    <button
                      type="button"
                      className="primary-button"
                      onClick={
                        applyFilters
                      }
                      disabled={
                        loading
                      }
                    >
                      {loading
                        ? "Generating..."
                        : "Apply filters"}
                    </button>
                  </div>
                </section>

                {loading && (
                  <div className="reports-loading">
                    <div className="reports-loading-icon">
                      ◌
                    </div>

                    <h4>
                      Generating report
                    </h4>

                    <p>
                      Retrieving the latest
                      operational data...
                    </p>
                  </div>
                )}

                {!loading &&
                  error && (
                    <div className="page-error">
                      <strong>
                        Unable to load
                        report.
                      </strong>

                      <span>
                        {error}
                      </span>

                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          loadReport(
                            selectedReport,
                            currentPage
                          )
                        }
                      >
                        Retry
                      </button>
                    </div>
                  )}

                {!loading &&
                  !error &&
                  reportData && (
                    <div className="report-result">
                      <div className="report-result-header">
                        <div>
                          <span className="eyebrow">
                            LIVE REPORT
                          </span>

                          <h4>
                            {
                              selectedReport.title
                            }
                          </h4>

                          {reportData
                            .period && (
                            <p className="report-period">
                              {reportData
                                .period
                                .scope ===
                              "snapshot"
                                ? "Current operational snapshot"
                                : `Period: ${
                                    reportData
                                      .period
                                      .from ||
                                    "—"
                                  } → ${
                                    reportData
                                      .period
                                      .to ||
                                    "—"
                                  }`}
                            </p>
                          )}
                        </div>

                        <div className="report-result-meta">
                          <span className="report-live-badge">
                            Live data
                          </span>

                          {reportData.generated_at && (
                            <span className="report-generated-time">
                              Generated{" "}
                              {new Date(
                                reportData.generated_at
                              ).toLocaleString(
                                "en-GB",
                                {
                                  day: "2-digit",
                                  month:
                                    "short",
                                  year:
                                    "numeric",
                                  hour:
                                    "2-digit",
                                  minute:
                                    "2-digit",
                                }
                              )}
                            </span>
                          )}
                        </div>
                      </div>

                      <ReportSummary
                        summary={
                          reportData.summary
                        }
                      />

                      <ReportSections
                        sections={
                          reportData.sections
                        }
                      />

                      <ReportItemsTable
                        reportId={
                          selectedReport.id
                        }
                        items={
                          reportData.items
                        }
                      />

                      {total > 0 && (
                        <div className="report-pagination">
                          <div className="report-pagination-info">
                            Showing page{" "}
                            <strong>
                              {
                                currentPage
                              }
                            </strong>{" "}
                            of{" "}
                            <strong>
                              {
                                totalPages
                              }
                            </strong>{" "}
                            ·{" "}
                            <strong>
                              {total.toLocaleString()}
                            </strong>{" "}
                            total records
                          </div>

                          <div className="report-pagination-controls">
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={
                                currentPage <=
                                  1 ||
                                loading
                              }
                              onClick={() =>
                                goToPage(
                                  currentPage -
                                    1
                                )
                              }
                            >
                              ← Previous
                            </button>

                            <span className="report-page-number">
                              {currentPage}
                            </span>

                            <button
                              type="button"
                              className="secondary-button"
                              disabled={
                                currentPage >=
                                  totalPages ||
                                loading
                              }
                              onClick={() =>
                                goToPage(
                                  currentPage +
                                    1
                                )
                              }
                            >
                              Next →
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

export default Reports;