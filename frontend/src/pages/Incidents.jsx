import { useEffect, useMemo, useState } from 'react'
import AppLayout from '../layouts/AppLayout'
import { useAuth } from '../context/AuthContext'

const API_BASE_URL = 'http://localhost:5000/api'

const incidentTypes = [
  { value: 'all', label: 'All incident types' },
  { value: 'accident', label: 'Accident' },
  { value: 'near_miss', label: 'Near miss' },
  { value: 'injury', label: 'Injury' },
  { value: 'property_damage', label: 'Property damage' },
  { value: 'environmental', label: 'Environmental' },
  { value: 'fire', label: 'Fire' },
  { value: 'security', label: 'Security' },
  { value: 'other', label: 'Other' },
]

const severityOptions = [
  { value: 'all', label: 'All severities' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

const statusOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const emptyForm = {
  title: '',
  description: '',
  incident_type: 'accident',
  severity: 'medium',
  status: 'open',
  project_id: '',
  reported_by: '',
  assigned_to: '',
  occurred_at: '',
  resolved_at: '',
  corrective_action: '',
}

function formatLabel(value) {
  if (!value) {
    return '—'
  }

  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDateTime(value) {
  if (!value) {
    return '—'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

function toDateTimeLocal(value) {
  if (!value) {
    return ''
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const offset = date.getTimezoneOffset()
  const localDate = new Date(date.getTime() - offset * 60000)

  return localDate.toISOString().slice(0, 16)
}

function getSeverityClass(severity) {
  return `incident-severity-${String(
    severity || 'unknown',
  ).toLowerCase()}`
}

function getStatusClass(status) {
  return `incident-status-${String(status || 'unknown')
    .toLowerCase()
    .replace(/\s+/g, '_')}`
}

function getUserId(user, token) {
  const directId =
    user?.id ||
    user?.user_id ||
    user?.userId

  if (directId) {
    return directId
  }

  if (!token) {
    return ''
  }

  try {
    const parts = token.split('.')

    if (parts.length !== 3) {
      return ''
    }

    const normalizedPayload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')

    const decodedPayload = atob(normalizedPayload)

    const payload = JSON.parse(decodedPayload)

    return (
      payload.id ||
      payload.user_id ||
      payload.userId ||
      payload.sub ||
      ''
    )
  } catch {
    return ''
  }
}

function Incidents() {
  const { user } = useAuth()

  const [incidents, setIncidents] = useState([])
  const [projects, setProjects] = useState([])

  const [loading, setLoading] = useState(true)
  const [projectsLoading, setProjectsLoading] = useState(true)

  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')

  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')

  const [modal, setModal] = useState(null)
  const [selectedIncident, setSelectedIncident] = useState(null)

  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const token = localStorage.getItem('industrafow_token')

  const loadIncidents = async () => {
    try {
      setLoading(true)
      setError('')

      if (!token) {
        throw new Error(
          'Your session has expired. Please sign in again.',
        )
      }

      const response = await fetch(
        `${API_BASE_URL}/incidents`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      )

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          data.error ||
            data.message ||
            'Unable to load incidents.',
        )
      }

      setIncidents(
        Array.isArray(data.incidents)
          ? data.incidents
          : [],
      )
    } catch (err) {
      setError(
        err.message ||
          'Unable to load incidents.',
      )
    } finally {
      setLoading(false)
    }
  }

  const loadProjects = async () => {
    try {
      setProjectsLoading(true)

      if (!token) {
        return
      }

      const response = await fetch(
        `${API_BASE_URL}/projects`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      )

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          data.error ||
            data.message ||
            'Unable to load projects.',
        )
      }

      const projectList = Array.isArray(data)
        ? data
        : data.projects ||
          data.items ||
          []

      setProjects(projectList)
    } catch (err) {
      console.error(
        'Unable to load projects:',
        err,
      )
    } finally {
      setProjectsLoading(false)
    }
  }

  useEffect(() => {
    loadIncidents()
    loadProjects()
  }, [])

  const filteredIncidents = useMemo(() => {
    const searchValue = search
      .toLowerCase()
      .trim()

    return incidents.filter((incident) => {
      const title = String(
        incident.title || '',
      ).toLowerCase()

      const description = String(
        incident.description || '',
      ).toLowerCase()

      const projectName = String(
        incident.project_name || '',
      ).toLowerCase()

      const reporterName = String(
        incident.reporter_name || '',
      ).toLowerCase()

      const matchesSearch =
        !searchValue ||
        title.includes(searchValue) ||
        description.includes(searchValue) ||
        projectName.includes(searchValue) ||
        reporterName.includes(searchValue)

      const matchesSeverity =
        severityFilter === 'all' ||
        incident.severity === severityFilter

      const matchesStatus =
        statusFilter === 'all' ||
        incident.status === statusFilter

      const matchesType =
        typeFilter === 'all' ||
        incident.incident_type === typeFilter

      return (
        matchesSearch &&
        matchesSeverity &&
        matchesStatus &&
        matchesType
      )
    })
  }, [
    incidents,
    search,
    severityFilter,
    statusFilter,
    typeFilter,
  ])

  const summary = useMemo(() => {
    return {
      total: incidents.length,

      open: incidents.filter(
        (incident) =>
          incident.status === 'open',
      ).length,

      investigating: incidents.filter(
        (incident) =>
          incident.status === 'investigating',
      ).length,

      critical: incidents.filter(
        (incident) =>
          incident.severity === 'critical',
      ).length,

      resolved: incidents.filter(
        (incident) =>
          incident.status === 'resolved' ||
          incident.status === 'closed',
      ).length,
    }
  }, [incidents])

  const closeModal = () => {
    if (saving) {
      return
    }

    setModal(null)
    setSelectedIncident(null)
    setFormError('')
  }

  const openCreateModal = () => {
    setFormError('')

    const currentUserId = getUserId(
      user,
      token,
    )

    setForm({
      ...emptyForm,
      reported_by: currentUserId
        ? String(currentUserId)
        : '',
      occurred_at: toDateTimeLocal(
        new Date().toISOString(),
      ),
    })

    setSelectedIncident(null)
    setModal('create')
  }

  const openViewModal = async (incident) => {
    try {
      setFormError('')

      const response = await fetch(
        `${API_BASE_URL}/incidents/${incident.id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      )

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          data.error ||
            data.message ||
            'Unable to load incident.',
        )
      }

      setSelectedIncident(data.incident)
      setModal('view')
    } catch (err) {
      setError(
        err.message ||
          'Unable to load incident.',
      )
    }
  }

  const openEditModal = async (incident) => {
    try {
      setFormError('')

      const response = await fetch(
        `${API_BASE_URL}/incidents/${incident.id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      )

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          data.error ||
            data.message ||
            'Unable to load incident.',
        )
      }

      const current = data.incident

      setSelectedIncident(current)

      setForm({
        title: current.title || '',
        description: current.description || '',
        incident_type:
          current.incident_type ||
          'accident',
        severity:
          current.severity ||
          'medium',
        status:
          current.status ||
          'open',
        project_id: current.project_id
          ? String(current.project_id)
          : '',
        reported_by:
          current.reported_by
            ? String(current.reported_by)
            : '',
        assigned_to:
          current.assigned_to
            ? String(current.assigned_to)
            : '',
        occurred_at:
          toDateTimeLocal(
            current.occurred_at,
          ),
        resolved_at:
          toDateTimeLocal(
            current.resolved_at,
          ),
        corrective_action:
          current.corrective_action ||
          '',
      })

      setModal('edit')
    } catch (err) {
      setError(
        err.message ||
          'Unable to load incident.',
      )
    }
  }

  const updateForm = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    setSaving(true)
    setFormError('')

    try {
      if (!form.title.trim()) {
        throw new Error(
          'Incident title is required.',
        )
      }

      if (!form.description.trim()) {
        throw new Error(
          'Incident description is required.',
        )
      }

      if (!form.occurred_at) {
        throw new Error(
          'Incident occurrence time is required.',
        )
      }

      if (!form.reported_by) {
        throw new Error(
          'A reporter is required. Your logged-in account could not be identified.',
        )
      }

      const payload = {
        title: form.title.trim(),
        description:
          form.description.trim(),
        incident_type:
          form.incident_type,
        severity: form.severity,
        status: form.status,
        project_id: form.project_id
          ? Number(form.project_id)
          : null,
        reported_by:
          Number(form.reported_by),
        assigned_to: form.assigned_to
          ? Number(form.assigned_to)
          : null,
        occurred_at:
          form.occurred_at,
        resolved_at:
          form.resolved_at || null,
        corrective_action:
          form.corrective_action.trim() ||
          null,
      }

      const isEditing =
        modal === 'edit'

      const response = await fetch(
        isEditing
          ? `${API_BASE_URL}/incidents/${selectedIncident.id}`
          : `${API_BASE_URL}/incidents`,
        {
          method: isEditing
            ? 'PUT'
            : 'POST',
          headers: {
            'Content-Type':
              'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(
            payload,
          ),
        },
      )

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          data.error ||
            data.message ||
            `Unable to ${
              isEditing
                ? 'update'
                : 'create'
            } incident.`,
        )
      }

      setModal(null)
      setSelectedIncident(null)
      setForm(emptyForm)
      setFormError('')

      await loadIncidents()
    } catch (err) {
      setFormError(
        err.message ||
          `Unable to ${
            modal === 'edit'
              ? 'update'
              : 'create'
          } incident.`,
      )
    } finally {
      setSaving(false)
    }
  }

  const changeStatus = async (status) => {
    if (!selectedIncident) {
      return
    }

    try {
      setSaving(true)
      setFormError('')

      const response = await fetch(
        `${API_BASE_URL}/incidents/${selectedIncident.id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type':
              'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            status,
          }),
        },
      )

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          data.error ||
            data.message ||
            'Unable to update incident status.',
        )
      }

      setSelectedIncident(
        data.incident,
      )

      await loadIncidents()
    } catch (err) {
      setFormError(
        err.message ||
          'Unable to update incident status.',
      )
    } finally {
      setSaving(false)
    }
  }

  const clearFilters = () => {
    setSearch('')
    setSeverityFilter('all')
    setStatusFilter('all')
    setTypeFilter('all')
  }

  return (
    <AppLayout>
      {/* =====================================================
          INCIDENT PAGE HEADER
      ===================================================== */}

      <section className="page-header">
        <div>
          <span className="eyebrow">
            SAFETY & RISK
          </span>

          <h2>Incidents</h2>

          <p>
            Record, investigate, and track
            workplace incidents across your
            organization.
          </p>
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={openCreateModal}
        >
          + Report incident
        </button>
      </section>

      {/* =====================================================
          SUMMARY
      ===================================================== */}

      <section className="incident-summary-grid">
        <div className="incident-summary-card">
          <span>TOTAL INCIDENTS</span>

          <strong>
            {loading ? '—' : summary.total}
          </strong>

          <small>
            All recorded incidents
          </small>
        </div>

        <div className="incident-summary-card incident-summary-warning">
          <span>OPEN</span>

          <strong>
            {loading ? '—' : summary.open}
          </strong>

          <small>
            Awaiting investigation
          </small>
        </div>

        <div className="incident-summary-card incident-summary-investigating">
          <span>INVESTIGATING</span>

          <strong>
            {loading
              ? '—'
              : summary.investigating}
          </strong>

          <small>
            Under active review
          </small>
        </div>

        <div className="incident-summary-card incident-summary-critical">
          <span>CRITICAL</span>

          <strong>
            {loading
              ? '—'
              : summary.critical}
          </strong>

          <small>
            Highest severity
          </small>
        </div>

        <div className="incident-summary-card incident-summary-success">
          <span>RESOLVED</span>

          <strong>
            {loading
              ? '—'
              : summary.resolved}
          </strong>

          <small>
            Resolved or closed
          </small>
        </div>
      </section>

      {/* =====================================================
          ERROR
      ===================================================== */}

      {error && (
        <div
          className="dashboard-error"
          role="alert"
        >
          <strong>
            Unable to load incidents
          </strong>

          <span>{error}</span>

          <button
            className="retry-button"
            onClick={loadIncidents}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      {/* =====================================================
          INCIDENT LIST
      ===================================================== */}

      <section className="content-card">
        <div className="content-toolbar incident-toolbar">
          <div className="search-wrapper">
            <input
              type="search"
              placeholder="Search incidents, descriptions, projects..."
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value,
                )
              }
            />
          </div>

          <div className="incident-filter-group">
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value,
                )
              }
            >
              {statusOptions.map(
                (option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ),
              )}
            </select>

            <select
              value={severityFilter}
              onChange={(event) =>
                setSeverityFilter(
                  event.target.value,
                )
              }
            >
              {severityOptions.map(
                (option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ),
              )}
            </select>

            <select
              value={typeFilter}
              onChange={(event) =>
                setTypeFilter(
                  event.target.value,
                )
              }
            >
              {incidentTypes.map(
                (option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ),
              )}
            </select>
          </div>
        </div>

        {!loading && !error && (
          <div className="results-bar">
            <span>
              Showing{' '}
              <strong>
                {filteredIncidents.length}
              </strong>{' '}
              of{' '}
              <strong>
                {incidents.length}
              </strong>{' '}
              incidents
            </span>

            {(search ||
              statusFilter !== 'all' ||
              severityFilter !== 'all' ||
              typeFilter !== 'all') && (
              <button
                className="clear-filters-button"
                onClick={clearFilters}
                type="button"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="page-state">
            <div className="loading-spinner" />

            <strong>
              Loading incidents...
            </strong>

            <span>
              Fetching your
              organization's incident
              records.
            </span>
          </div>
        ) : error ? (
          <div className="page-state">
            <div className="empty-state-icon">
              !
            </div>

            <strong>
              Incidents could not be
              loaded
            </strong>

            <span>
              Check your connection and
              try again.
            </span>

            <button
              className="primary-button"
              onClick={loadIncidents}
              type="button"
            >
              Try again
            </button>
          </div>
        ) : filteredIncidents.length === 0 ? (
          <div className="page-state">
            <div className="empty-state-icon">
              !
            </div>

            <strong>
              {incidents.length === 0
                ? 'No incidents recorded'
                : 'No matching incidents'}
            </strong>

            <span>
              {incidents.length === 0
                ? 'Report an incident to begin building your safety record.'
                : 'Try changing your search or filter settings.'}
            </span>

            {incidents.length === 0 && (
              <button
                className="primary-button"
                onClick={openCreateModal}
                type="button"
              >
                + Report incident
              </button>
            )}
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table incidents-table">
              <thead>
                <tr>
                  <th>Incident</th>
                  <th>Project</th>
                  <th>Type</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Occurred</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredIncidents.map(
                  (incident) => (
                    <tr
                      key={
                        incident.id
                      }
                    >
                      <td>
                        <div className="incident-table-identity">
                          <div className="incident-number">
                            #
                            {
                              incident.id
                            }
                          </div>

                          <div>
                            <div className="table-primary">
                              {
                                incident.title
                              }
                            </div>

                            <div className="table-secondary">
                              Reported by{' '}
                              {incident.reporter_name ||
                                'Unknown'}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td>
                        {incident.project_name ||
                          'Company-wide'}
                      </td>

                      <td>
                        {formatLabel(
                          incident.incident_type,
                        )}
                      </td>

                      <td>
                        <span
                          className={`incident-severity-badge ${getSeverityClass(
                            incident.severity,
                          )}`}
                        >
                          {formatLabel(
                            incident.severity,
                          )}
                        </span>
                      </td>

                      <td>
                        <span
                          className={`incident-status-badge ${getStatusClass(
                            incident.status,
                          )}`}
                        >
                          <span className="incident-status-dot" />

                          {formatLabel(
                            incident.status,
                          )}
                        </span>
                      </td>

                      <td>
                        {formatDateTime(
                          incident.occurred_at,
                        )}
                      </td>

                      <td>
                        <div className="incident-actions">
                          <button
                            className="incident-action-button"
                            onClick={() =>
                              openViewModal(
                                incident,
                              )
                            }
                            type="button"
                          >
                            View
                          </button>

                          <button
                            className="incident-action-button incident-action-primary"
                            onClick={() =>
                              openEditModal(
                                incident,
                              )
                            }
                            type="button"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* =====================================================
          CREATE / EDIT MODAL
      ===================================================== */}

      {(modal === 'create' ||
        modal === 'edit') && (
        <div
          className="incident-modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeModal()
            }
          }}
        >
          <div
            className="incident-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="incident-modal-title"
            onMouseDown={(event) =>
              event.stopPropagation()
            }
          >
            <div className="incident-modal-header">
              <div>
                <span className="eyebrow">
                  {modal === 'edit'
                    ? `INCIDENT #${selectedIncident?.id || ''}`
                    : 'SAFETY RECORD'}
                </span>

                <h3 id="incident-modal-title">
                  {modal === 'edit'
                    ? 'Edit incident'
                    : 'Report incident'}
                </h3>

                <p>
                  {modal === 'edit'
                    ? 'Update the investigation record and incident lifecycle.'
                    : 'Capture the incident details and assign it for investigation.'}
                </p>
              </div>

              <button
                className="modal-close-button"
                onClick={closeModal}
                disabled={saving}
                aria-label="Close"
                type="button"
              >
                ×
              </button>
            </div>

            <IncidentForm
              form={form}
              projects={projects}
              projectsLoading={
                projectsLoading
              }
              formError={formError}
              saving={saving}
              onChange={updateForm}
              onSubmit={handleSubmit}
              onCancel={closeModal}
              isEditing={
                modal === 'edit'
              }
            />
          </div>
        </div>
      )}

      {/* =====================================================
          VIEW MODAL
      ===================================================== */}

      {modal === 'view' &&
        selectedIncident && (
          <div
            className="incident-modal-backdrop"
            onMouseDown={(event) => {
              if (
                event.target ===
                event.currentTarget
              ) {
                closeModal()
              }
            }}
          >
            <div
              className="incident-modal incident-detail-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="incident-view-title"
              onMouseDown={(event) =>
                event.stopPropagation()
              }
            >
              <div className="incident-modal-header">
                <div>
                  <span className="eyebrow">
                    INCIDENT #
                    {
                      selectedIncident.id
                    }
                  </span>

                  <h3 id="incident-view-title">
                    {
                      selectedIncident.title
                    }
                  </h3>

                  <p>
                    Incident record and
                    investigation details.
                  </p>
                </div>

                <button
                  className="modal-close-button"
                  onClick={closeModal}
                  aria-label="Close"
                  type="button"
                >
                  ×
                </button>
              </div>

              {formError && (
                <div
                  className="modal-error"
                  role="alert"
                >
                  {formError}
                </div>
              )}

              <div className="incident-detail-status-row">
                <span
                  className={`incident-severity-badge ${getSeverityClass(
                    selectedIncident.severity,
                  )}`}
                >
                  {formatLabel(
                    selectedIncident.severity,
                  )}
                </span>

                <span
                  className={`incident-status-badge ${getStatusClass(
                    selectedIncident.status,
                  )}`}
                >
                  <span className="incident-status-dot" />

                  {formatLabel(
                    selectedIncident.status,
                  )}
                </span>
              </div>

              <div className="incident-detail-grid">
                <div className="incident-detail-section incident-detail-wide">
                  <span>
                    DESCRIPTION
                  </span>

                  <p>
                    {
                      selectedIncident.description ||
                      '—'
                    }
                  </p>
                </div>

                <div className="incident-detail-item">
                  <span>
                    INCIDENT TYPE
                  </span>

                  <strong>
                    {formatLabel(
                      selectedIncident.incident_type,
                    )}
                  </strong>
                </div>

                <div className="incident-detail-item">
                  <span>
                    PROJECT
                  </span>

                  <strong>
                    {
                      selectedIncident.project_name ||
                      'Company-wide'
                    }
                  </strong>
                </div>

                <div className="incident-detail-item">
                  <span>
                    REPORTED BY
                  </span>

                  <strong>
                    {
                      selectedIncident.reporter_name ||
                      'Unknown'
                    }
                  </strong>
                </div>

                <div className="incident-detail-item">
                  <span>
                    ASSIGNED TO
                  </span>

                  <strong>
                    {
                      selectedIncident.assignee_name ||
                      'Not assigned'
                    }
                  </strong>
                </div>

                <div className="incident-detail-item">
                  <span>
                    OCCURRED
                  </span>

                  <strong>
                    {formatDateTime(
                      selectedIncident.occurred_at,
                    )}
                  </strong>
                </div>

                <div className="incident-detail-item">
                  <span>
                    RESOLVED
                  </span>

                  <strong>
                    {formatDateTime(
                      selectedIncident.resolved_at,
                    )}
                  </strong>
                </div>

                <div className="incident-detail-section incident-detail-wide">
                  <span>
                    CORRECTIVE ACTION
                  </span>

                  <p>
                    {
                      selectedIncident.corrective_action ||
                      'No corrective action recorded yet.'
                    }
                  </p>
                </div>
              </div>

              <div className="incident-status-actions">
                <div>
                  <span className="incident-status-actions-label">
                    UPDATE STATUS
                  </span>

                  <p>
                    Move this incident through
                    its investigation lifecycle.
                  </p>
                </div>

                <div className="incident-status-buttons">
                  {[
                    'open',
                    'investigating',
                    'resolved',
                    'closed',
                    'cancelled',
                  ].map((status) => (
                    <button
                      key={status}
                      className={`incident-status-action ${
                        selectedIncident.status ===
                        status
                          ? 'active'
                          : ''
                      }`}
                      disabled={
                        saving ||
                        selectedIncident.status ===
                          status
                      }
                      onClick={() =>
                        changeStatus(
                          status,
                        )
                      }
                      type="button"
                    >
                      {formatLabel(
                        status,
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="modal-footer">
                <button
                  className="secondary-button"
                  onClick={closeModal}
                  disabled={saving}
                  type="button"
                >
                  Close
                </button>

                <button
                  className="primary-button"
                  onClick={() =>
                    openEditModal(
                      selectedIncident,
                    )
                  }
                  disabled={saving}
                  type="button"
                >
                  Edit incident
                </button>
              </div>
            </div>
          </div>
        )}
    </AppLayout>
  )
}

function IncidentForm({
  form,
  projects,
  projectsLoading,
  formError,
  saving,
  onChange,
  onSubmit,
  onCancel,
  isEditing,
}) {
  return (
    <form
      className="incident-form"
      onSubmit={onSubmit}
    >
      {formError && (
        <div
          className="modal-error"
          role="alert"
        >
          {formError}
        </div>
      )}

      <div className="incident-form-grid">
        <div className="form-group incident-form-wide">
          <label htmlFor="incident-title">
            Incident title
          </label>

          <input
            id="incident-title"
            type="text"
            value={form.title}
            onChange={(event) =>
              onChange(
                'title',
                event.target.value,
              )
            }
            placeholder="e.g. Forklift collision at loading area"
            maxLength={255}
            disabled={saving}
            required
          />
        </div>

        <div className="form-group incident-form-wide">
          <label htmlFor="incident-description">
            Description
          </label>

          <textarea
            id="incident-description"
            value={form.description}
            onChange={(event) =>
              onChange(
                'description',
                event.target.value,
              )
            }
            placeholder="Describe what happened, where it happened, and the immediate circumstances."
            rows={5}
            disabled={saving}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="incident-type">
            Incident type
          </label>

          <select
            id="incident-type"
            value={form.incident_type}
            onChange={(event) =>
              onChange(
                'incident_type',
                event.target.value,
              )
            }
            disabled={saving}
          >
            {incidentTypes
              .filter(
                (option) =>
                  option.value !==
                  'all',
              )
              .map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="incident-severity">
            Severity
          </label>

          <select
            id="incident-severity"
            value={form.severity}
            onChange={(event) =>
              onChange(
                'severity',
                event.target.value,
              )
            }
            disabled={saving}
          >
            {severityOptions
              .filter(
                (option) =>
                  option.value !==
                  'all',
              )
              .map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="incident-project">
            Project
          </label>

          <select
            id="incident-project"
            value={form.project_id}
            onChange={(event) =>
              onChange(
                'project_id',
                event.target.value,
              )
            }
            disabled={
              saving ||
              projectsLoading
            }
          >
            <option value="">
              {projectsLoading
                ? 'Loading projects...'
                : 'Company-wide / no project'}
            </option>

            {projects.map((project) => (
              <option
                key={project.id}
                value={project.id}
              >
                {project.name}
                {project.code
                  ? ` (${project.code})`
                  : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="incident-status">
            Status
          </label>

          <select
            id="incident-status"
            value={form.status}
            onChange={(event) =>
              onChange(
                'status',
                event.target.value,
              )
            }
            disabled={saving}
          >
            {statusOptions
              .filter(
                (option) =>
                  option.value !==
                  'all',
              )
              .map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="incident-occurred">
            Occurred at
          </label>

          <input
            id="incident-occurred"
            type="datetime-local"
            value={form.occurred_at}
            onChange={(event) =>
              onChange(
                'occurred_at',
                event.target.value,
              )
            }
            disabled={saving}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="incident-resolved">
            Resolved at
          </label>

          <input
            id="incident-resolved"
            type="datetime-local"
            value={form.resolved_at}
            onChange={(event) =>
              onChange(
                'resolved_at',
                event.target.value,
              )
            }
            disabled={saving}
          />

          <small className="form-help">
            Required by the backend only when
            the incident is resolved or closed.
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="incident-reporter">
            Reporter ID
          </label>

          <input
            id="incident-reporter"
            type="number"
            min="1"
            value={form.reported_by}
            onChange={(event) =>
              onChange(
                'reported_by',
                event.target.value,
              )
            }
            disabled={saving}
          />

          <small className="form-help">
            Automatically populated from your
            signed-in account when available.
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="incident-assignee">
            Assignee ID
          </label>

          <input
            id="incident-assignee"
            type="number"
            min="1"
            value={form.assigned_to}
            onChange={(event) =>
              onChange(
                'assigned_to',
                event.target.value,
              )
            }
            placeholder="Optional"
            disabled={saving}
          />

          <small className="form-help">
            Leave empty if the incident has not
            been assigned.
          </small>
        </div>

        <div className="form-group incident-form-wide">
          <label htmlFor="incident-corrective-action">
            Corrective action
          </label>

          <textarea
            id="incident-corrective-action"
            value={form.corrective_action}
            onChange={(event) =>
              onChange(
                'corrective_action',
                event.target.value,
              )
            }
            placeholder="Describe corrective or preventive actions taken."
            rows={4}
            disabled={saving}
          />
        </div>
      </div>

      <div className="modal-footer">
        <button
          type="button"
          className="secondary-button"
          onClick={onCancel}
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
            ? isEditing
              ? 'Saving changes...'
              : 'Reporting incident...'
            : isEditing
              ? 'Save changes'
              : 'Report incident'}
        </button>
      </div>
    </form>
  )
}

export default Incidents