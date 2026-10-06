import { useEffect, useMemo, useState } from 'react'
import AppLayout from '../layouts/AppLayout'

const API_BASE_URL = 'http://localhost:5000/api'

const initialForm = {
  name: '',
  location: '',
  description: '',
  status: 'planning',
  start_date: '',
  end_date: '',
}

const statusOptions = [
  'planning',
  'active',
  'on_hold',
  'completed',
  'cancelled',
]

function formatStatus(status) {
  if (!status) return 'Unknown'

  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getStatusClass(status) {
  switch (status) {
    case 'active':
      return 'status-badge status-active'

    case 'planned':
    case 'planning':
      return 'status-badge status-planned'

    case 'completed':
      return 'status-badge status-completed'

    case 'on_hold':
      return 'status-badge status-on_hold'

    case 'cancelled':
      return 'status-badge status-cancelled'

    default:
      return 'status-badge status-neutral'
  }
}

function formatDate(value) {
  if (!value) return '—'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function dateInputValue(value) {
  if (!value) return ''

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function Projects() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [selectedProject, setSelectedProject] = useState(null)

  const [form, setForm] = useState(initialForm)
  const [formError, setFormError] = useState('')

  const token = localStorage.getItem('industrafow_token')

  const request = async (endpoint, options = {}) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token
          ? {
              Authorization: `Bearer ${token}`,
            }
          : {}),
        ...(options.headers || {}),
      },
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(
        data.message ||
          data.error ||
          'Request failed'
      )
    }

    return data
  }

  const loadProjects = async () => {
    try {
      setLoading(true)
      setError('')

      const data = await request('/projects')

      const rows = Array.isArray(data)
        ? data
        : data.projects || data.items || []

      setProjects(Array.isArray(rows) ? rows : [])
    } catch (requestError) {
      setError(
        requestError.message ||
          'Unable to load projects.'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProjects()
  }, [])

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase()

    return projects.filter((project) => {
      const matchesSearch =
        !query ||
        String(project.name || '')
          .toLowerCase()
          .includes(query) ||
        String(project.location || '')
          .toLowerCase()
          .includes(query) ||
        String(project.description || '')
          .toLowerCase()
          .includes(query)

      const matchesStatus =
        statusFilter === 'all' ||
        project.status === statusFilter

      return matchesSearch && matchesStatus
    })
  }, [projects, search, statusFilter])

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
  }

  const hasFilters =
    search.trim() !== '' ||
    statusFilter !== 'all'

  const resetModal = () => {
    setModalOpen(false)
    setModalMode('create')
    setSelectedProject(null)
    setForm(initialForm)
    setFormError('')
  }

  const openCreateModal = () => {
    setModalMode('create')
    setSelectedProject(null)
    setForm(initialForm)
    setFormError('')
    setSuccess('')
    setModalOpen(true)
  }

  const openViewModal = (project) => {
    setModalMode('view')
    setSelectedProject(project)
    setForm({
      name: project.name || '',
      location: project.location || '',
      description: project.description || '',
      status: project.status || 'planning',
      start_date: dateInputValue(project.start_date),
      end_date: dateInputValue(project.end_date),
    })
    setFormError('')
    setSuccess('')
    setModalOpen(true)
  }

  const openEditModal = (project) => {
    setModalMode('edit')
    setSelectedProject(project)
    setForm({
      name: project.name || '',
      location: project.location || '',
      description: project.description || '',
      status: project.status || 'planning',
      start_date: dateInputValue(project.start_date),
      end_date: dateInputValue(project.end_date),
    })
    setFormError('')
    setSuccess('')
    setModalOpen(true)
  }

  const handleFormChange = (event) => {
    const { name, value } = event.target

    setForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!form.name.trim()) {
      setFormError('Project name is required.')
      return
    }

    if (
      form.start_date &&
      form.end_date &&
      new Date(form.end_date) < new Date(form.start_date)
    ) {
      setFormError(
        'End date cannot be earlier than the start date.'
      )
      return
    }

    try {
      setSaving(true)
      setFormError('')
      setError('')
      setSuccess('')

      const payload = {
        name: form.name.trim(),
        location: form.location.trim() || null,
        description: form.description.trim() || null,
        status: form.status,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      }

      const isEditing = modalMode === 'edit'

      const endpoint = isEditing
        ? `/projects/${selectedProject.id}`
        : '/projects'

      const data = await request(endpoint, {
        method: isEditing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })

      if (data.project) {
        setProjects((current) => {
          if (isEditing) {
            return current.map((project) =>
              project.id === data.project.id
                ? data.project
                : project
            )
          }

          return [data.project, ...current]
        })
      } else {
        await loadProjects()
      }

      resetModal()

      setSuccess(
        isEditing
          ? 'Project updated successfully.'
          : 'Project created successfully.'
      )
    } catch (requestError) {
      setFormError(
        requestError.message ||
          'Unable to save project.'
      )
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (project) => {
    const confirmed = window.confirm(
      `Delete "${project.name}"? This action cannot be undone.`
    )

    if (!confirmed) return

    try {
      setDeleting(true)
      setError('')
      setSuccess('')

      await request(`/projects/${project.id}`, {
        method: 'DELETE',
      })

      setProjects((current) =>
        current.filter(
          (item) => item.id !== project.id
        )
      )

      resetModal()

      setSuccess(
        'Project deleted successfully.'
      )
    } catch (requestError) {
      setError(
        requestError.message ||
          'Unable to delete project.'
      )
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AppLayout>
      <div className="page projects-page">

        <section className="page-header">
          <div>
            <span className="eyebrow">
              PROJECT MANAGEMENT
            </span>

            <h2>Projects</h2>

            <p>
              Manage active projects, locations,
              project status, schedules, and
              operational activity across your
              organization.
            </p>
          </div>

          <button
            type="button"
            className="primary-button"
            onClick={openCreateModal}
          >
            + New project
          </button>
        </section>

        {success && (
          <div
            className="project-success"
            role="status"
          >
            <span>✓</span>

            <span>{success}</span>

            <button
              type="button"
              onClick={() => setSuccess('')}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {error && (
          <div
            className="page-error"
            role="alert"
          >
            <strong>
              Unable to load projects
            </strong>

            <span>{error}</span>

            <button
              type="button"
              className="secondary-button"
              onClick={loadProjects}
            >
              Retry
            </button>
          </div>
        )}

        <section className="toolbar">

          <div className="search-field">
            <span className="search-icon">
              ⌕
            </span>

            <input
              type="search"
              placeholder="Search projects..."
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
            />
          </div>

          <select
            className="filter-select"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value)
            }
          >
            <option value="all">
              All statuses
            </option>

            <option value="planning">
              Planning
            </option>

            <option value="active">
              Active
            </option>

            <option value="on_hold">
              On hold
            </option>

            <option value="completed">
              Completed
            </option>

            <option value="cancelled">
              Cancelled
            </option>
          </select>

          {hasFilters && (
            <button
              type="button"
              className="secondary-button"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
        </section>

        {loading ? (
          <section className="loading-state">
            <div className="loading-spinner" />

            <span>
              Loading projects...
            </span>
          </section>
        ) : filteredProjects.length === 0 ? (
          <section className="empty-state">

            <div className="empty-state-icon">
              ▦
            </div>

            <h3>
              {projects.length === 0
                ? 'No projects yet'
                : 'No matching projects'}
            </h3>

            <p>
              {projects.length === 0
                ? 'Create your first project to begin managing operations.'
                : 'Try adjusting your search or status filter.'}
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
                + New project
              </button>
            )}
          </section>
        ) : (
          <section className="data-card">

            <div className="table-wrap">

              <table className="data-table project-table">

                <thead>
                  <tr>
                    <th>Project</th>
                    <th>ID</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th>Start date</th>
                    <th>End date</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredProjects.map(
                    (project) => (
                      <tr key={project.id}>

                        <td>
                          <div className="project-identity">
                            <div className="project-avatar">
                              {(project.name || 'P')
                                .trim()
                                .charAt(0)
                                .toUpperCase()}
                            </div>

                            <div className="project-identity-text">
                              <strong>
                                {project.name ||
                                  'Unnamed project'}
                              </strong>

                              {project.description && (
                                <span>
                                  {project.description}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        <td>
                          <span className="table-muted">
                            #{project.id}
                          </span>
                        </td>

                        <td>
                          <span className="table-muted">
                            {project.location ||
                              '—'}
                          </span>
                        </td>

                        <td>
                          <span
                            className={getStatusClass(
                              project.status
                            )}
                          >
                            {formatStatus(
                              project.status
                            )}
                          </span>
                        </td>

                        <td>
                          <span className="table-muted">
                            {formatDate(
                              project.start_date
                            )}
                          </span>
                        </td>

                        <td>
                          <span className="table-muted">
                            {formatDate(
                              project.end_date
                            )}
                          </span>
                        </td>

                        <td>
                          <span className="table-muted">
                            {formatDate(
                              project.created_at
                            )}
                          </span>
                        </td>

                        <td>
                          <div className="project-row-actions">

                            <button
                              type="button"
                              className="project-action-button"
                              onClick={() =>
                                openViewModal(project)
                              }
                            >
                              View
                            </button>

                            <button
                              type="button"
                              className="project-action-button"
                              onClick={() =>
                                openEditModal(project)
                              }
                            >
                              Edit
                            </button>

                          </div>
                        </td>

                      </tr>
                    )
                  )}
                </tbody>

              </table>

            </div>

          </section>
        )}

        {modalOpen && (
          <div
            className="project-modal-backdrop"
            onMouseDown={(event) => {
              if (
                event.target ===
                event.currentTarget &&
                !saving &&
                !deleting
              ) {
                resetModal()
              }
            }}
          >

            <section
              className="project-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="project-modal-title"
            >

              <div className="project-modal-header">

                <div>
                  <span className="eyebrow">
                    {modalMode === 'create'
                      ? 'PROJECT CREATION'
                      : modalMode === 'edit'
                        ? 'PROJECT MANAGEMENT'
                        : 'PROJECT DETAILS'}
                  </span>

                  <h3 id="project-modal-title">
                    {modalMode === 'create'
                      ? 'Create a new project'
                      : modalMode === 'edit'
                        ? 'Edit project'
                        : selectedProject?.name ||
                          'Project details'}
                  </h3>

                  <p>
                    {modalMode === 'view'
                      ? 'Review the project information, schedule, and current status.'
                      : 'Enter the project information used to manage this operation.'}
                  </p>
                </div>

                <button
                  type="button"
                  className="project-modal-close"
                  onClick={resetModal}
                  disabled={saving || deleting}
                  aria-label="Close project modal"
                >
                  ×
                </button>

              </div>

              {formError && (
                <div
                  className="project-form-error"
                  role="alert"
                >
                  {formError}
                </div>
              )}

              {modalMode === 'view' ? (
                <div className="project-view-content">

                  <div className="project-profile">

                    <div className="project-profile-avatar">
                      {(selectedProject?.name || 'P')
                        .trim()
                        .charAt(0)
                        .toUpperCase()}
                    </div>

                    <div>
                      <h4>
                        {selectedProject?.name ||
                          'Unnamed project'}
                      </h4>

                      <span>
                        {selectedProject?.location ||
                          'Location not specified'}
                      </span>
                    </div>

                  </div>

                  <div className="project-detail-grid">

                    <div className="project-detail-item">
                      <span>Project ID</span>
                      <strong>
                        #{selectedProject?.id}
                      </strong>
                    </div>

                    <div className="project-detail-item">
                      <span>Status</span>
                      <strong>
                        {formatStatus(
                          selectedProject?.status
                        )}
                      </strong>
                    </div>

                    <div className="project-detail-item">
                      <span>Location</span>
                      <strong>
                        {selectedProject?.location ||
                          '—'}
                      </strong>
                    </div>

                    <div className="project-detail-item">
                      <span>Start date</span>
                      <strong>
                        {formatDate(
                          selectedProject?.start_date
                        )}
                      </strong>
                    </div>

                    <div className="project-detail-item">
                      <span>End date</span>
                      <strong>
                        {formatDate(
                          selectedProject?.end_date
                        )}
                      </strong>
                    </div>

                    <div className="project-detail-item">
                      <span>Created</span>
                      <strong>
                        {formatDate(
                          selectedProject?.created_at
                        )}
                      </strong>
                    </div>

                  </div>

                  <div className="project-description-box">
                    <span>Description</span>

                    <p>
                      {selectedProject?.description ||
                        'No project description provided.'}
                    </p>
                  </div>

                  <div className="project-modal-footer">

                    <button
                      type="button"
                      className="project-delete-button"
                      onClick={() =>
                        handleDelete(selectedProject)
                      }
                      disabled={deleting}
                    >
                      {deleting
                        ? 'Deleting...'
                        : 'Delete project'}
                    </button>

                    <div className="project-footer-actions">

                      <button
                        type="button"
                        className="secondary-button"
                        onClick={resetModal}
                        disabled={deleting}
                      >
                        Close
                      </button>

                      <button
                        type="button"
                        className="primary-button"
                        onClick={() =>
                          openEditModal(
                            selectedProject
                          )
                        }
                        disabled={deleting}
                      >
                        Edit project
                      </button>

                    </div>

                  </div>

                </div>
              ) : (
                <form
                  className="project-form"
                  onSubmit={handleSubmit}
                >

                  <div className="project-form-grid">

                    <label className="project-form-field project-form-full">
                      <span>
                        Project name <b>*</b>
                      </span>

                      <input
                        name="name"
                        value={form.name}
                        onChange={handleFormChange}
                        placeholder="e.g. Nairobi Industrial Plant"
                        maxLength={255}
                        required
                      />
                    </label>

                    <label className="project-form-field">
                      <span>Location</span>

                      <input
                        name="location"
                        value={form.location}
                        onChange={handleFormChange}
                        placeholder="e.g. Athi River, Machakos"
                        maxLength={255}
                      />
                    </label>

                    <label className="project-form-field">
                      <span>Status</span>

                      <select
                        name="status"
                        value={form.status}
                        onChange={handleFormChange}
                      >
                        {statusOptions.map(
                          (status) => (
                            <option
                              key={status}
                              value={status}
                            >
                              {formatStatus(status)}
                            </option>
                          )
                        )}
                      </select>
                    </label>

                    <label className="project-form-field">
                      <span>Start date</span>

                      <input
                        type="date"
                        name="start_date"
                        value={form.start_date}
                        onChange={handleFormChange}
                      />
                    </label>

                    <label className="project-form-field">
                      <span>End date</span>

                      <input
                        type="date"
                        name="end_date"
                        value={form.end_date}
                        onChange={handleFormChange}
                      />
                    </label>

                    <label className="project-form-field project-form-full">
                      <span>Description</span>

                      <textarea
                        name="description"
                        value={form.description}
                        onChange={handleFormChange}
                        placeholder="Describe the project, scope, site activities, or other operational details..."
                        rows="5"
                        maxLength={2000}
                      />
                    </label>

                  </div>

                  <div className="project-form-note">
                    Project ownership is automatically
                    assigned to your authenticated company.
                  </div>

                  <div className="project-modal-footer">

                    <div />

                    <div className="project-footer-actions">

                      <button
                        type="button"
                        className="secondary-button"
                        onClick={resetModal}
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
                          ? 'Saving...'
                          : modalMode === 'edit'
                            ? 'Save changes'
                            : 'Create project'}
                      </button>

                    </div>

                  </div>

                </form>
              )}

            </section>

          </div>
        )}

      </div>
    </AppLayout>
  )
}

export default Projects