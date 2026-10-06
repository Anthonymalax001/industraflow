import { useEffect, useMemo, useState } from "react";
import AppLayout from "../layouts/AppLayout";

const API_BASE_URL = "http://localhost:5000/api";

const PERMIT_TYPES = [
  { value: "hot_work", label: "Hot Work" },
  { value: "confined_space", label: "Confined Space" },
  { value: "work_at_height", label: "Work at Height" },
  { value: "excavation", label: "Excavation" },
  { value: "electrical_isolation", label: "Electrical Isolation" },
  { value: "lifting_operation", label: "Lifting Operation" },
  { value: "line_breaking", label: "Line Breaking" },
  { value: "general_work", label: "General Work" },
  { value: "other", label: "Other" },
];

const RISK_LEVELS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "pending_review", label: "Pending Review" },
  { value: "approved", label: "Approved" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "closed", label: "Closed" },
  { value: "expired", label: "Expired" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

const emptyForm = {
  project_id: "",
  contractor_id: "",
  permit_number: "",
  title: "",
  work_area: "",
  work_description: "",
  hazards: "",
  control_measures: "",
  ppe_requirements: "",
  permit_type: "general_work",
  risk_level: "medium",
  valid_from: "",
  valid_until: "",
};

const formatLabel = (value) => {
  if (!value) return "—";

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const formatDateTime = (value) => {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const toDateTimeLocal = (value) => {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (number) => String(number).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const getRiskClass = (risk) => {
  switch (risk) {
    case "critical":
      return "permit-risk critical";
    case "high":
      return "permit-risk high";
    case "medium":
      return "permit-risk medium";
    default:
      return "permit-risk low";
  }
};

const getStatusClass = (status) => {
  switch (status) {
    case "active":
      return "permit-status active";
    case "approved":
      return "permit-status approved";
    case "pending_review":
      return "permit-status pending";
    case "suspended":
      return "permit-status suspended";
    case "closed":
      return "permit-status closed";
    case "rejected":
      return "permit-status rejected";
    case "cancelled":
      return "permit-status cancelled";
    case "expired":
      return "permit-status expired";
    default:
      return "permit-status draft";
  }
};

function WorkPermits() {
  const [permits, setPermits] = useState([]);
  const [projects, setProjects] = useState([]);
  const [contractors, setContractors] = useState([]);

  const [loading, setLoading] = useState(true);
  const [supportDataLoading, setSupportDataLoading] = useState(true);

  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const [modal, setModal] = useState(null);
  const [selectedPermit, setSelectedPermit] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const [saving, setSaving] = useState(false);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);

  const [lifecycleComment, setLifecycleComment] = useState("");

  const apiRequest = async (endpoint, options = {}) => {
    const token = localStorage.getItem("industrafow_token");

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.message || data.error || "Request failed"
      );
    }

    return data;
  };

  const loadPermits = async () => {
    try {
      setLoading(true);
      setError("");

      const data = await apiRequest("/work-permits?limit=100");

      setPermits(Array.isArray(data.permits) ? data.permits : []);
    } catch (requestError) {
      setError(requestError.message || "Failed to load work permits");
    } finally {
      setLoading(false);
    }
  };

  const loadSupportData = async () => {
    try {
      setSupportDataLoading(true);

      const [projectsData, contractorsData] = await Promise.all([
        apiRequest("/projects"),
        apiRequest("/contractors"),
      ]);

      const projectRows = Array.isArray(projectsData)
        ? projectsData
        : projectsData.projects || projectsData.items || [];

      const contractorRows = Array.isArray(contractorsData)
        ? contractorsData
        : contractorsData.contractors ||
          contractorsData.items ||
          [];

      setProjects(projectRows);
      setContractors(contractorRows);
    } catch (requestError) {
      setError(
        requestError.message ||
          "Failed to load projects and contractors"
      );
    } finally {
      setSupportDataLoading(false);
    }
  };

  useEffect(() => {
    loadPermits();
    loadSupportData();
  }, []);

  const filteredPermits = useMemo(() => {
    const query = search.trim().toLowerCase();

    return permits.filter((permit) => {
      const matchesSearch =
        !query ||
        [
          permit.permit_number,
          permit.title,
          permit.project_name,
          permit.contractor_name,
        ].some((value) =>
          String(value || "").toLowerCase().includes(query)
        );

      const matchesStatus =
        !statusFilter || permit.status === statusFilter;

      const matchesRisk =
        !riskFilter || permit.risk_level === riskFilter;

      const matchesType =
        !typeFilter || permit.permit_type === typeFilter;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesRisk &&
        matchesType
      );
    });
  }, [
    permits,
    search,
    statusFilter,
    riskFilter,
    typeFilter,
  ]);

  const summary = useMemo(() => {
    return {
      total: permits.length,
      draft: permits.filter((permit) => permit.status === "draft")
        .length,
      pending: permits.filter(
        (permit) => permit.status === "pending_review"
      ).length,
      active: permits.filter((permit) => permit.status === "active")
        .length,
      highRisk: permits.filter(
        (permit) =>
          permit.risk_level === "high" ||
          permit.risk_level === "critical"
      ).length,
    };
  }, [permits]);

  const closeModal = () => {
    if (saving || lifecycleLoading) return;

    setModal(null);
    setSelectedPermit(null);
    setForm(emptyForm);
    setFormError("");
    setActionError("");
    setLifecycleComment("");
  };

  const openCreateModal = () => {
    setForm(emptyForm);
    setFormError("");
    setActionError("");
    setSelectedPermit(null);
    setModal("create");
  };

  const openViewModal = async (permit) => {
    try {
      setActionError("");

      const data = await apiRequest(
        `/work-permits/${permit.id}`
      );

      setSelectedPermit(data);
      setModal("view");
    } catch (requestError) {
      setActionError(
        requestError.message || "Failed to load permit details"
      );
    }
  };

  const openEditModal = async (permit) => {
    try {
      setFormError("");

      const data = await apiRequest(
        `/work-permits/${permit.id}`
      );

      const record = data.permit;

      setSelectedPermit(record);

      setForm({
        project_id: record.project_id
          ? String(record.project_id)
          : "",
        contractor_id: record.contractor_id
          ? String(record.contractor_id)
          : "",
        permit_number: record.permit_number || "",
        title: record.title || "",
        work_area: record.work_area || "",
        work_description: record.work_description || "",
        hazards: record.hazards || "",
        control_measures: record.control_measures || "",
        ppe_requirements: record.ppe_requirements || "",
        permit_type: record.permit_type || "general_work",
        risk_level: record.risk_level || "medium",
        valid_from: toDateTimeLocal(record.valid_from),
        valid_until: toDateTimeLocal(record.valid_until),
      });

      setModal("edit");
    } catch (requestError) {
      setActionError(
        requestError.message || "Failed to load permit"
      );
    }
  };

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const validateForm = () => {
    if (!form.project_id) {
      return "Project is required.";
    }

    if (!form.permit_number.trim()) {
      return "Permit number is required.";
    }

    if (!form.title.trim()) {
      return "Permit title is required.";
    }

    if (!form.work_description.trim()) {
      return "Work description is required.";
    }

    if (!form.hazards.trim()) {
      return "Hazards are required.";
    }

    if (!form.control_measures.trim()) {
      return "Control measures are required.";
    }

    if (!form.valid_from || !form.valid_until) {
      return "Validity start and end dates are required.";
    }

    const start = new Date(form.valid_from);
    const end = new Date(form.valid_until);

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime())
    ) {
      return "Please provide valid permit dates.";
    }

    if (end <= start) {
      return "Valid until must be later than valid from.";
    }

    return "";
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const validationError = validateForm();

    if (validationError) {
      setFormError(validationError);
      return;
    }

    try {
      setSaving(true);
      setFormError("");

      const payload = {
        project_id: Number(form.project_id),
        contractor_id: form.contractor_id
          ? Number(form.contractor_id)
          : null,
        permit_number: form.permit_number.trim(),
        title: form.title.trim(),
        work_area: form.work_area.trim() || null,
        work_description: form.work_description.trim(),
        hazards: form.hazards.trim(),
        control_measures: form.control_measures.trim(),
        ppe_requirements:
          form.ppe_requirements.trim() || null,
        permit_type: form.permit_type,
        risk_level: form.risk_level,
        valid_from: form.valid_from,
        valid_until: form.valid_until,
      };

      if (modal === "create") {
        await apiRequest("/work-permits", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else if (modal === "edit" && selectedPermit?.id) {
        await apiRequest(
          `/work-permits/${selectedPermit.id}`,
          {
            method: "PUT",
            body: JSON.stringify(payload),
          }
        );
      }

      closeModal();
      await loadPermits();
    } catch (requestError) {
      setFormError(
        requestError.message || "Failed to save work permit"
      );
    } finally {
      setSaving(false);
    }
  };

  const runLifecycleAction = async (
    action,
    body = undefined
  ) => {
    if (!selectedPermit?.permit?.id && !selectedPermit?.id) {
      return;
    }

    const permitId =
      selectedPermit.permit?.id || selectedPermit.id;

    try {
      setLifecycleLoading(true);
      setActionError("");

      await apiRequest(
        `/work-permits/${permitId}/${action}`,
        {
          method: "POST",
          ...(body
            ? {
                body: JSON.stringify(body),
              }
            : {}),
        }
      );

      const refreshed = await apiRequest(
        `/work-permits/${permitId}`
      );

      setSelectedPermit(refreshed);

      await loadPermits();
    } catch (requestError) {
      setActionError(
        requestError.message ||
          `Failed to ${formatLabel(action).toLowerCase()} permit`
      );
    } finally {
      setLifecycleLoading(false);
      setLifecycleComment("");
    }
  };

  const submitPermit = () => runLifecycleAction("submit");

  const approvePermit = () => runLifecycleAction("approve");

  const rejectPermit = () => {
    const reason = lifecycleComment.trim();

    if (!reason) {
      setActionError("Rejection reason is required.");
      return;
    }

    return runLifecycleAction("reject", {
      rejection_reason: reason,
    });
  };

  const activatePermit = () =>
    runLifecycleAction("activate");

  const suspendPermit = () =>
    runLifecycleAction("suspend", {
      comments: lifecycleComment.trim() || undefined,
    });

  const resumePermit = () =>
    runLifecycleAction("resume");

  const closePermit = () =>
    runLifecycleAction("close", {
      closure_notes: lifecycleComment.trim() || undefined,
    });

  const cancelPermit = () =>
    runLifecycleAction("cancel", {
      comments: lifecycleComment.trim() || undefined,
    });

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("");
    setRiskFilter("");
    setTypeFilter("");
  };

  const permitRecord =
    selectedPermit?.permit || selectedPermit;

  const hasFilters =
    search ||
    statusFilter ||
    riskFilter ||
    typeFilter;

  return (
    <AppLayout>
      <div className="page">
      <section className="page-header">
        <div>
          <span className="eyebrow">
            SAFETY & OPERATIONS
          </span>

          <h2>Work Permits</h2>

          <p>
            Control high-risk work through structured permits,
            approvals, validity periods, and operational
            lifecycle tracking.
          </p>
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={openCreateModal}
          disabled={supportDataLoading}
        >
          + Create work permit
        </button>
      </section>

      <section className="permit-summary-grid">
        <div className="permit-summary-card">
          <div className="permit-summary-icon">▤</div>
          <div>
            <span>Total permits</span>
            <strong>{summary.total}</strong>
          </div>
        </div>

        <div className="permit-summary-card">
          <div className="permit-summary-icon">◷</div>
          <div>
            <span>Draft</span>
            <strong>{summary.draft}</strong>
          </div>
        </div>

        <div className="permit-summary-card">
          <div className="permit-summary-icon">⌛</div>
          <div>
            <span>Pending review</span>
            <strong>{summary.pending}</strong>
          </div>
        </div>

        <div className="permit-summary-card">
          <div className="permit-summary-icon">✓</div>
          <div>
            <span>Active</span>
            <strong>{summary.active}</strong>
          </div>
        </div>

        <div className="permit-summary-card risk-card">
          <div className="permit-summary-icon">⚠</div>
          <div>
            <span>High / critical risk</span>
            <strong>{summary.highRisk}</strong>
          </div>
        </div>
      </section>

      <section className="permit-toolbar">
        <div className="permit-search">
          <span>⌕</span>

          <input
            type="search"
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="Search permit number, title, project..."
          />
        </div>

        <div className="permit-filter-group">
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value)
            }
          >
            <option value="">All statuses</option>
            {STATUSES.map((status) => (
              <option
                key={status.value}
                value={status.value}
              >
                {status.label}
              </option>
            ))}
          </select>

          <select
            value={riskFilter}
            onChange={(event) =>
              setRiskFilter(event.target.value)
            }
          >
            <option value="">All risk levels</option>
            {RISK_LEVELS.map((risk) => (
              <option
                key={risk.value}
                value={risk.value}
              >
                {risk.label}
              </option>
            ))}
          </select>

          <select
            value={typeFilter}
            onChange={(event) =>
              setTypeFilter(event.target.value)
            }
          >
            <option value="">All permit types</option>
            {PERMIT_TYPES.map((type) => (
              <option
                key={type.value}
                value={type.value}
              >
                {type.label}
              </option>
            ))}
          </select>

          {hasFilters && (
            <button
              type="button"
              className="secondary-button"
              onClick={clearFilters}
            >
              Clear
            </button>
          )}
        </div>
      </section>

      <div className="results-bar">
        <span>
          Showing <strong>{filteredPermits.length}</strong>{" "}
          permit{filteredPermits.length === 1 ? "" : "s"}
        </span>

        {hasFilters && (
          <span className="results-filtered">
            Filters applied
          </span>
        )}
      </div>

      {error && (
        <div className="page-error">
          <strong>Unable to load work permits.</strong>
          <span>{error}</span>

          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              loadPermits();
              loadSupportData();
            }}
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <section className="empty-state">
          <div className="loading-spinner" />
          <h3>Loading work permits</h3>
          <p>
            Retrieving your organization&apos;s permit records.
          </p>
        </section>
      ) : filteredPermits.length === 0 ? (
        <section className="empty-state">
          <div className="empty-state-icon">◫</div>

          <h3>
            {hasFilters
              ? "No matching permits"
              : "No work permits yet"}
          </h3>

          <p>
            {hasFilters
              ? "Try adjusting your search or filters."
              : "Create your first work permit to begin managing controlled work."}
          </p>

          {hasFilters ? (
            <button
              type="button"
              className="secondary-button"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              onClick={openCreateModal}
            >
              + Create work permit
            </button>
          )}
        </section>
      ) : (
        <section className="data-card">
          <div className="table-wrap">
            <table className="permit-table">
              <thead>
                <tr>
                  <th>Permit</th>
                  <th>Project</th>
                  <th>Type</th>
                  <th>Risk</th>
                  <th>Validity</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredPermits.map((permit) => (
                  <tr key={permit.id}>
                    <td>
                      <div className="permit-identity">
                        <strong>
                          {permit.permit_number}
                        </strong>
                        <span>{permit.title}</span>
                      </div>
                    </td>

                    <td>
                      <div className="permit-project">
                        <strong>
                          {permit.project_name || "—"}
                        </strong>

                        {permit.contractor_id && (
                          <span>
                            {permit.contractor_name ||
                              "Contractor assigned"}
                          </span>
                        )}
                      </div>
                    </td>

                    <td>
                      <span className="permit-type">
                        {formatLabel(permit.permit_type)}
                      </span>
                    </td>

                    <td>
                      <span
                        className={getRiskClass(
                          permit.risk_level
                        )}
                      >
                        {formatLabel(permit.risk_level)}
                      </span>
                    </td>

                    <td>
                      <div className="permit-validity">
                        <span>
                          {formatDateTime(
                            permit.valid_from
                          )}
                        </span>
                        <small>
                          →{" "}
                          {formatDateTime(
                            permit.valid_until
                          )}
                        </small>
                      </div>
                    </td>

                    <td>
                      <span
                        className={getStatusClass(
                          permit.status
                        )}
                      >
                        {formatLabel(permit.status)}
                      </span>
                    </td>

                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="table-action"
                          onClick={() =>
                            openViewModal(permit)
                          }
                        >
                          View
                        </button>

                        {![
                          "closed",
                          "cancelled",
                          "expired",
                        ].includes(permit.status) && (
                          <button
                            type="button"
                            className="table-action"
                            onClick={() =>
                              openEditModal(permit)
                            }
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(modal === "create" || modal === "edit") && (
        <div className="permit-modal-backdrop">
          <div className="permit-modal">
            <div className="permit-modal-header">
              <div>
                <span className="eyebrow">
                  {modal === "create"
                    ? "NEW PERMIT"
                    : "PERMIT MANAGEMENT"}
                </span>

                <h3>
                  {modal === "create"
                    ? "Create work permit"
                    : "Edit work permit"}
                </h3>

                <p>
                  Define the work scope, hazards, controls,
                  risk level, and validity period.
                </p>
              </div>

              <button
                type="button"
                className="modal-close-button"
                onClick={closeModal}
                disabled={saving}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form
              className="permit-form"
              onSubmit={handleSubmit}
            >
              {formError && (
                <div className="modal-error">
                  {formError}
                </div>
              )}

              <div className="permit-form-section">
                <div className="permit-section-heading">
                  <span>01</span>
                  <div>
                    <strong>Permit details</strong>
                    <small>
                      Identify the controlled work activity.
                    </small>
                  </div>
                </div>

                <div className="permit-form-grid">
                  <label>
                    <span>Project *</span>

                    <select
                      name="project_id"
                      value={form.project_id}
                      onChange={handleChange}
                      required
                    >
                      <option value="">
                        Select project
                      </option>

                      {projects.map((project) => (
                        <option
                          key={project.id}
                          value={project.id}
                        >
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Contractor</span>

                    <select
                      name="contractor_id"
                      value={form.contractor_id}
                      onChange={handleChange}
                    >
                      <option value="">
                        No contractor
                      </option>

                      {contractors
                        .filter((contractor) => {
                          if (!form.project_id) {
                            return true;
                          }

                          return (
                            String(
                              contractor.project_id
                            ) === String(form.project_id)
                          );
                        })
                        .map((contractor) => (
                          <option
                            key={contractor.id}
                            value={contractor.id}
                          >
                            {contractor.company_name}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label>
                    <span>Permit number *</span>

                    <input
                      type="text"
                      name="permit_number"
                      value={form.permit_number}
                      onChange={handleChange}
                      placeholder="e.g. PTW-2026-001"
                      maxLength={100}
                      required
                    />
                  </label>

                  <label>
                    <span>Permit type *</span>

                    <select
                      name="permit_type"
                      value={form.permit_type}
                      onChange={handleChange}
                      required
                    >
                      {PERMIT_TYPES.map((type) => (
                        <option
                          key={type.value}
                          value={type.value}
                        >
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="permit-form-wide">
                    <span>Permit title *</span>

                    <input
                      type="text"
                      name="title"
                      value={form.title}
                      onChange={handleChange}
                      placeholder="Describe the controlled work activity"
                      maxLength={255}
                      required
                    />
                  </label>

                  <label className="permit-form-wide">
                    <span>Work area</span>

                    <input
                      type="text"
                      name="work_area"
                      value={form.work_area}
                      onChange={handleChange}
                      placeholder="e.g. Plant room, north elevation, excavation zone"
                    />
                  </label>
                </div>
              </div>

              <div className="permit-form-section">
                <div className="permit-section-heading">
                  <span>02</span>
                  <div>
                    <strong>Risk & controls</strong>
                    <small>
                      Capture the hazards and required controls.
                    </small>
                  </div>
                </div>

                <div className="permit-form-grid">
                  <label>
                    <span>Risk level *</span>

                    <select
                      name="risk_level"
                      value={form.risk_level}
                      onChange={handleChange}
                      required
                    >
                      {RISK_LEVELS.map((risk) => (
                        <option
                          key={risk.value}
                          value={risk.value}
                        >
                          {risk.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>PPE requirements</span>

                    <input
                      type="text"
                      name="ppe_requirements"
                      value={form.ppe_requirements}
                      onChange={handleChange}
                      placeholder="e.g. Helmet, gloves, harness"
                    />
                  </label>

                  <label className="permit-form-wide">
                    <span>Work description *</span>

                    <textarea
                      name="work_description"
                      value={form.work_description}
                      onChange={handleChange}
                      placeholder="Describe exactly what work will be performed..."
                      rows={4}
                      required
                    />
                  </label>

                  <label>
                    <span>Hazards *</span>

                    <textarea
                      name="hazards"
                      value={form.hazards}
                      onChange={handleChange}
                      placeholder="List identified hazards..."
                      rows={4}
                      required
                    />
                  </label>

                  <label>
                    <span>Control measures *</span>

                    <textarea
                      name="control_measures"
                      value={form.control_measures}
                      onChange={handleChange}
                      placeholder="List controls required before and during work..."
                      rows={4}
                      required
                    />
                  </label>
                </div>
              </div>

              <div className="permit-form-section">
                <div className="permit-section-heading">
                  <span>03</span>
                  <div>
                    <strong>Validity period</strong>
                    <small>
                      Define when the permit becomes valid and
                      expires.
                    </small>
                  </div>
                </div>

                <div className="permit-form-grid">
                  <label>
                    <span>Valid from *</span>

                    <input
                      type="datetime-local"
                      name="valid_from"
                      value={form.valid_from}
                      onChange={handleChange}
                      required
                    />
                  </label>

                  <label>
                    <span>Valid until *</span>

                    <input
                      type="datetime-local"
                      name="valid_until"
                      value={form.valid_until}
                      onChange={handleChange}
                      required
                    />
                  </label>
                </div>
              </div>

              <div className="permit-modal-footer">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeModal}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : modal === "create"
                    ? "Create permit"
                    : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal === "view" && permitRecord && (
        <div className="permit-modal-backdrop">
          <div className="permit-modal permit-detail-modal">
            <div className="permit-modal-header">
              <div>
                <span className="eyebrow">
                  WORK PERMIT
                </span>

                <h3>
                  {permitRecord.permit_number}
                </h3>

                <p>{permitRecord.title}</p>
              </div>

              <button
                type="button"
                className="modal-close-button"
                onClick={closeModal}
                disabled={lifecycleLoading}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="permit-detail-body">
              {actionError && (
                <div className="modal-error">
                  {actionError}
                </div>
              )}

              <div className="permit-detail-banner">
                <div>
                  <span>Current status</span>

                  <strong
                    className={getStatusClass(
                      permitRecord.status
                    )}
                  >
                    {formatLabel(
                      permitRecord.status
                    )}
                  </strong>
                </div>

                <div>
                  <span>Risk level</span>

                  <strong
                    className={getRiskClass(
                      permitRecord.risk_level
                    )}
                  >
                    {formatLabel(
                      permitRecord.risk_level
                    )}
                  </strong>
                </div>
              </div>

              <div className="permit-detail-grid">
                <div className="permit-detail-item">
                  <span>Project</span>
                  <strong>
                    {permitRecord.project_name || "—"}
                  </strong>
                </div>

                <div className="permit-detail-item">
                  <span>Contractor</span>
                  <strong>
                    {permitRecord.contractor_name ||
                      "No contractor"}
                  </strong>
                </div>

                <div className="permit-detail-item">
                  <span>Permit type</span>
                  <strong>
                    {formatLabel(
                      permitRecord.permit_type
                    )}
                  </strong>
                </div>

                <div className="permit-detail-item">
                  <span>Work area</span>
                  <strong>
                    {permitRecord.work_area || "—"}
                  </strong>
                </div>

                <div className="permit-detail-item">
                  <span>Valid from</span>
                  <strong>
                    {formatDateTime(
                      permitRecord.valid_from
                    )}
                  </strong>
                </div>

                <div className="permit-detail-item">
                  <span>Valid until</span>
                  <strong>
                    {formatDateTime(
                      permitRecord.valid_until
                    )}
                  </strong>
                </div>

                <div className="permit-detail-item">
                  <span>Created by</span>
                  <strong>
                    {permitRecord.created_by_name ||
                      "—"}
                  </strong>
                </div>

                <div className="permit-detail-item">
                  <span>Approved by</span>
                  <strong>
                    {permitRecord.approved_by_name ||
                      "Not approved"}
                  </strong>
                </div>
              </div>

              <div className="permit-detail-section">
                <h4>Work description</h4>
                <p>
                  {permitRecord.work_description || "—"}
                </p>
              </div>

              <div className="permit-detail-two-column">
                <div className="permit-detail-section">
                  <h4>Hazards</h4>
                  <p>
                    {permitRecord.hazards || "—"}
                  </p>
                </div>

                <div className="permit-detail-section">
                  <h4>Control measures</h4>
                  <p>
                    {permitRecord.control_measures ||
                      "—"}
                  </p>
                </div>
              </div>

              <div className="permit-detail-two-column">
                <div className="permit-detail-section">
                  <h4>PPE requirements</h4>
                  <p>
                    {permitRecord.ppe_requirements ||
                      "No specific PPE recorded"}
                  </p>
                </div>

                <div className="permit-detail-section">
                  <h4>Review comments</h4>
                  <p>
                    {permitRecord.review_comments ||
                      "No review comments"}
                  </p>
                </div>
              </div>

              {permitRecord.rejection_reason && (
                <div className="permit-detail-section permit-rejection">
                  <h4>Rejection reason</h4>
                  <p>
                    {permitRecord.rejection_reason}
                  </p>
                </div>
              )}

              {permitRecord.closure_notes && (
                <div className="permit-detail-section">
                  <h4>Closure notes</h4>
                  <p>
                    {permitRecord.closure_notes}
                  </p>
                </div>
              )}

              <div className="permit-detail-section">
                <div className="permit-associated-heading">
                  <h4>Permit resources</h4>
                  <span>
                    {selectedPermit.workers?.length || 0}{" "}
                    workers ·{" "}
                    {selectedPermit.assets?.length || 0}{" "}
                    assets ·{" "}
                    {selectedPermit.documents?.length || 0}{" "}
                    documents
                  </span>
                </div>

                {selectedPermit.workers?.length > 0 && (
                  <div className="permit-resource-list">
                    {selectedPermit.workers.map(
                      (worker) => (
                        <div
                          className="permit-resource"
                          key={worker.id}
                        >
                          <strong>
                            {worker.name}
                          </strong>
                          <span>
                            {worker.position ||
                              "Worker"}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                )}

                {selectedPermit.assets?.length > 0 && (
                  <div className="permit-resource-list">
                    {selectedPermit.assets.map(
                      (asset) => (
                        <div
                          className="permit-resource"
                          key={asset.id}
                        >
                          <strong>
                            {asset.name}
                          </strong>
                          <span>
                            {asset.asset_type ||
                              "Asset"}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                )}

                {selectedPermit.documents?.length > 0 && (
                  <div className="permit-resource-list">
                    {selectedPermit.documents.map(
                      (document) => (
                        <div
                          className="permit-resource"
                          key={document.id}
                        >
                          <strong>
                            {document.name}
                          </strong>
                          <span>
                            {document.document_type ||
                              "Compliance document"}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                )}

                {!selectedPermit.workers?.length &&
                  !selectedPermit.assets?.length &&
                  !selectedPermit.documents?.length && (
                    <p className="permit-no-resources">
                      No workers, assets, or compliance
                      documents have been attached yet.
                    </p>
                  )}
              </div>

              <div className="permit-detail-section">
                <div className="permit-associated-heading">
                  <h4>Permit timeline</h4>
                  <span>
                    {selectedPermit.events?.length || 0}{" "}
                    event
                    {selectedPermit.events?.length === 1
                      ? ""
                      : "s"}
                  </span>
                </div>

                {selectedPermit.events?.length > 0 ? (
                  <div className="permit-timeline">
                    {selectedPermit.events.map(
                      (event) => (
                        <div
                          className="permit-timeline-item"
                          key={event.id}
                        >
                          <div className="permit-timeline-dot" />

                          <div>
                            <strong>
                              {formatLabel(
                                event.event_type
                              )}
                            </strong>

                            <span>
                              {event.from_status &&
                              event.to_status
                                ? `${formatLabel(
                                    event.from_status
                                  )} → ${formatLabel(
                                    event.to_status
                                  )}`
                                : formatLabel(
                                    event.to_status
                                  )}
                            </span>

                            {event.comments && (
                              <p>
                                {event.comments}
                              </p>
                            )}

                            <small>
                              {formatDateTime(
                                event.created_at
                              )}
                            </small>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                ) : (
                  <p className="permit-no-resources">
                    No timeline events available.
                  </p>
                )}
              </div>

              {![
                "closed",
                "cancelled",
                "expired",
                "rejected",
              ].includes(permitRecord.status) && (
                <div className="permit-lifecycle">
                  <div className="permit-lifecycle-heading">
                    <div>
                      <h4>Permit actions</h4>
                      <p>
                        Move this permit through its controlled
                        operational lifecycle.
                      </p>
                    </div>
                  </div>

                  {(permitRecord.status ===
                    "pending_review" ||
                    permitRecord.status ===
                      "active" ||
                    permitRecord.status ===
                      "suspended") && (
                    <textarea
                      value={lifecycleComment}
                      onChange={(event) =>
                        setLifecycleComment(
                          event.target.value
                        )
                      }
                      placeholder={
                        permitRecord.status ===
                        "pending_review"
                          ? "Add rejection reason when rejecting..."
                          : "Optional action comments..."
                      }
                      rows={3}
                    />
                  )}

                  <div className="permit-lifecycle-actions">
                    {permitRecord.status ===
                      "draft" && (
                      <button
                        type="button"
                        className="primary-button"
                        onClick={submitPermit}
                        disabled={
                          lifecycleLoading
                        }
                      >
                        Submit for review
                      </button>
                    )}

                    {permitRecord.status ===
                      "pending_review" && (
                      <>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={approvePermit}
                          disabled={
                            lifecycleLoading
                          }
                        >
                          Approve permit
                        </button>

                        <button
                          type="button"
                          className="danger-button"
                          onClick={rejectPermit}
                          disabled={
                            lifecycleLoading
                          }
                        >
                          Reject permit
                        </button>
                      </>
                    )}

                    {permitRecord.status ===
                      "approved" && (
                      <button
                        type="button"
                        className="primary-button"
                        onClick={activatePermit}
                        disabled={
                          lifecycleLoading
                        }
                      >
                        Activate permit
                      </button>
                    )}

                    {permitRecord.status === "active" && (
                      <>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={suspendPermit}
                          disabled={
                            lifecycleLoading
                          }
                        >
                          Suspend
                        </button>

                        <button
                          type="button"
                          className="primary-button"
                          onClick={closePermit}
                          disabled={
                            lifecycleLoading
                          }
                        >
                          Close permit
                        </button>
                      </>
                    )}

                    {permitRecord.status ===
                      "suspended" && (
                      <>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={resumePermit}
                          disabled={
                            lifecycleLoading
                          }
                        >
                          Resume permit
                        </button>

                        <button
                          type="button"
                          className="primary-button"
                          onClick={closePermit}
                          disabled={
                            lifecycleLoading
                          }
                        >
                          Close permit
                        </button>
                      </>
                    )}

                    {[
                      "draft",
                      "pending_review",
                      "approved",
                      "active",
                      "suspended",
                    ].includes(
                      permitRecord.status
                    ) && (
                      <button
                        type="button"
                        className="danger-button outline"
                        onClick={cancelPermit}
                        disabled={
                          lifecycleLoading
                        }
                      >
                        Cancel permit
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="permit-modal-footer">
              <button
                type="button"
                className="secondary-button"
                onClick={closeModal}
                disabled={lifecycleLoading}
              >
                Close
              </button>

              {![
                "closed",
                "cancelled",
                "expired",
                "rejected",
              ].includes(permitRecord.status) && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() =>
                    openEditModal(permitRecord)
                  }
                  disabled={lifecycleLoading}
                >
                  Edit permit
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </AppLayout>
  );
}

export default WorkPermits;