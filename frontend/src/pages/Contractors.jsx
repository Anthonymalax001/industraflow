import { useEffect, useMemo, useState } from 'react'
import AppLayout from '../layouts/AppLayout'

const API_BASE_URL = 'http://localhost:5000/api'

const certificationOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'verified', label: 'Verified' },
  { value: 'expired', label: 'Expired' },
  { value: 'rejected', label: 'Rejected' },
]

const initialForm = {
  project_id: '',
  company_name: '',
  contact_person: '',
  email: '',
  phone: '',
  certification_status: 'pending',
}

function formatCertificationStatus(status) {
  if (!status) {
    return 'Unknown'
  }

  return String(status)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getCertificationClass(status) {
  switch (status) {
    case 'verified':
      return 'contractor-certification-badge contractor-certification-verified'

    case 'pending':
      return 'contractor-certification-badge contractor-certification-pending'

    case 'expired':
      return 'contractor-certification-badge contractor-certification-expired'

    case 'rejected':
      return 'contractor-certification-badge contractor-certification-rejected'

    default:
      return 'contractor-certification-badge'
  }
}

function getInitial(value) {
  return (
    String(value || 'C')
      .trim()
      .charAt(0)
      .toUpperCase() || 'C'
  )
}

function formatDate(value) {
  if (!value) {
    return '—'
  }

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

function Contractors() {
  const [contractors, setContractors] = useState([])
  const [projects, setProjects] = useState([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [search, setSearch] = useState('')
  const [certificationFilter, setCertificationFilter] =
    useState('all')
  const [projectFilter, setProjectFilter] = useState('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [selectedContractor, setSelectedContractor] =
    useState(null)

  const [form, setForm] = useState(initialForm)
  const [formError, setFormError] = useState('')

  const getToken = () =>
    localStorage.getItem('industrafow_token')

  const request = async (endpoint, options = {}) => {
    const token = getToken()

    if (!token) {
      throw new Error(
        'Your session has expired. Please sign in again.',
      )
    }

    const response = await fetch(
      `${API_BASE_URL}${endpoint}`,
      {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(options.headers || {}),
        },
      },
    )

    const data = await response
      .json()
      .catch(() => ({}))

    if (!response.ok) {
      throw new Error(
        data.error ||
          data.message ||
          'Request failed',
      )
    }

    return data
  }

  const loadContractors = async () => {
    const data = await request('/contractors')

    const contractorList = Array.isArray(
      data.contractors,
    )
      ? data.contractors
      : []

    setContractors(contractorList)
  }

  const loadProjects = async () => {
    const data = await request('/projects')

    const projectList = Array.isArray(data)
      ? data
      : data.projects || data.items || []

    setProjects(
      Array.isArray(projectList)
        ? projectList
        : [],
    )
  }

  const loadData = async () => {
    try {
      setLoading(true)
      setError('')

      await Promise.all([
        loadContractors(),
        loadProjects(),
      ])
    } catch (err) {
      setError(
        err.message ||
          'Unable to load contractor data.',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const filteredContractors = useMemo(() => {
    const searchValue =
      search.trim().toLowerCase()

    return contractors.filter((contractor) => {
      const companyName = String(
        contractor.company_name || '',
      ).toLowerCase()

      const contactPerson = String(
        contractor.contact_person || '',
      ).toLowerCase()

      const email = String(
        contractor.email || '',
      ).toLowerCase()

      const phone = String(
        contractor.phone || '',
      ).toLowerCase()

      const projectName = String(
        contractor.project_name || '',
      ).toLowerCase()

      const certificationStatus = String(
        contractor.certification_status || '',
      ).toLowerCase()

      const matchesSearch =
        !searchValue ||
        companyName.includes(searchValue) ||
        contactPerson.includes(searchValue) ||
        email.includes(searchValue) ||
        phone.includes(searchValue) ||
        projectName.includes(searchValue)

      const matchesCertification =
        certificationFilter === 'all' ||
        certificationStatus === certificationFilter

      const matchesProject =
        projectFilter === 'all' ||
        String(contractor.project_id) ===
          String(projectFilter)

      return (
        matchesSearch &&
        matchesCertification &&
        matchesProject
      )
    })
  }, [
    contractors,
    search,
    certificationFilter,
    projectFilter,
  ])

  const verifiedCount = contractors.filter(
    (contractor) =>
      contractor.certification_status ===
      'verified',
  ).length

  const pendingCount = contractors.filter(
    (contractor) =>
      contractor.certification_status ===
      'pending',
  ).length

  const expiredCount = contractors.filter(
    (contractor) =>
      contractor.certification_status ===
      'expired',
  ).length

  const rejectedCount = contractors.filter(
    (contractor) =>
      contractor.certification_status ===
      'rejected',
  ).length

  const hasFilters =
    search.trim() !== '' ||
    certificationFilter !== 'all' ||
    projectFilter !== 'all'

  const clearFilters = () => {
    setSearch('')
    setCertificationFilter('all')
    setProjectFilter('all')
  }

  const resetModal = () => {
    setModalOpen(false)
    setModalMode('create')
    setSelectedContractor(null)
    setForm(initialForm)
    setFormError('')
  }

  const openCreateModal = () => {
    setModalMode('create')
    setSelectedContractor(null)
    setForm(initialForm)
    setFormError('')
    setSuccess('')
    setModalOpen(true)
  }

  const openViewModal = (contractor) => {
    setModalMode('view')
    setSelectedContractor(contractor)

    setForm({
      project_id: contractor.project_id
        ? String(contractor.project_id)
        : '',
      company_name:
        contractor.company_name || '',
      contact_person:
        contractor.contact_person || '',
      email: contractor.email || '',
      phone: contractor.phone || '',
      certification_status:
        contractor.certification_status ||
        'pending',
    })

    setFormError('')
    setSuccess('')
    setModalOpen(true)
  }

  const openEditModal = (contractor) => {
    setModalMode('edit')
    setSelectedContractor(contractor)

    setForm({
      project_id: contractor.project_id
        ? String(contractor.project_id)
        : '',
      company_name:
        contractor.company_name || '',
      contact_person:
        contractor.contact_person || '',
      email: contractor.email || '',
      phone: contractor.phone || '',
      certification_status:
        contractor.certification_status ||
        'pending',
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

    if (!form.project_id) {
      setFormError(
        'Please select a project.',
      )
      return
    }

    if (!form.company_name.trim()) {
      setFormError(
        'Contractor company name is required.',
      )
      return
    }

    if (
      form.email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        form.email.trim(),
      )
    ) {
      setFormError(
        'Please enter a valid email address.',
      )
      return
    }

    try {
      setSaving(true)
      setFormError('')
      setError('')
      setSuccess('')

      const payload = {
        project_id: Number(form.project_id),
        company_name:
          form.company_name.trim(),
        contact_person:
          form.contact_person.trim() || null,
        email:
          form.email.trim() || null,
        phone:
          form.phone.trim() || null,
        certification_status:
          form.certification_status,
      }

      const isEditing =
        modalMode === 'edit'

      const endpoint = isEditing
        ? `/contractors/${selectedContractor.id}`
        : '/contractors'

      const data = await request(endpoint, {
        method: isEditing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })

      const savedContractor =
        data.contractor

      if (!savedContractor) {
        await loadContractors()
      } else {
        const relatedProject =
          projects.find(
            (project) =>
              String(project.id) ===
              String(
                savedContractor.project_id,
              ),
          )

        const normalizedContractor = {
          ...savedContractor,
          project_name:
            relatedProject?.name ||
            selectedContractor?.project_name ||
            '—',
        }

        if (isEditing) {
          setContractors((current) =>
            current.map((contractor) =>
              contractor.id ===
              normalizedContractor.id
                ? normalizedContractor
                : contractor,
            ),
          )
        } else {
          setContractors((current) => [
            normalizedContractor,
            ...current,
          ])
        }
      }

      resetModal()

      setSuccess(
        isEditing
          ? 'Contractor updated successfully.'
          : 'Contractor created successfully.',
      )
    } catch (err) {
      setFormError(
        err.message ||
          'Unable to save contractor.',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (
    contractor,
  ) => {
    const confirmed = window.confirm(
      `Delete "${contractor.company_name}"? This action cannot be undone.`,
    )

    if (!confirmed) {
      return
    }

    try {
      setDeleting(true)
      setError('')
      setSuccess('')

      await request(
        `/contractors/${contractor.id}`,
        {
          method: 'DELETE',
        },
      )

      setContractors((current) =>
        current.filter(
          (item) =>
            item.id !== contractor.id,
        ),
      )

      resetModal()

      setSuccess(
        'Contractor deleted successfully.',
      )
    } catch (err) {
      setError(
        err.message ||
          'Unable to delete contractor.',
      )
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AppLayout>
      <div className="page contractors-page">

        <section className="page-header">
          <div>
            <span className="eyebrow">
              WORKFORCE
            </span>

            <h2>Contractors</h2>

            <p>
              Manage external companies, contacts,
              project relationships, and contractor
              certification status.
            </p>
          </div>

          <button
            type="button"
            className="primary-button"
            onClick={openCreateModal}
          >
            + New contractor
          </button>
        </section>

        {success && (
          <div
            className="contractor-success"
            role="status"
          >
            <span className="contractor-success-icon">
              ✓
            </span>

            <span>{success}</span>

            <button
              type="button"
              onClick={() =>
                setSuccess('')
              }
              aria-label="Dismiss message"
            >
              ×
            </button>
          </div>
        )}

        {error && (
          <div
            className="dashboard-error contractor-error"
            role="alert"
          >
            <strong>
              Unable to load contractors
            </strong>

            <span>{error}</span>

            <button
              type="button"
              className="retry-button"
              onClick={loadData}
            >
              Try again
            </button>
          </div>
        )}

        <section className="contractor-summary-grid">

          <div className="contractor-summary-card">
            <span>TOTAL CONTRACTORS</span>

            <strong>
              {loading
                ? '—'
                : contractors.length}
            </strong>

            <small>
              Registered contractors
            </small>
          </div>

          <div className="contractor-summary-card">
            <span>VERIFIED</span>

            <strong>
              {loading
                ? '—'
                : verifiedCount}
            </strong>

            <small>
              Certification verified
            </small>
          </div>

          <div className="contractor-summary-card">
            <span>PENDING</span>

            <strong>
              {loading
                ? '—'
                : pendingCount}
            </strong>

            <small>
              Awaiting verification
            </small>
          </div>

          <div className="contractor-summary-card">
            <span>EXPIRED</span>

            <strong>
              {loading
                ? '—'
                : expiredCount}
            </strong>

            <small>
              Certification expired
            </small>
          </div>

        </section>

        <section className="content-card contractor-card">

          <div className="content-toolbar contractor-toolbar">

            <div className="search-wrapper">
              <input
                type="search"
                placeholder="Search contractors, contacts, projects..."
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value,
                  )
                }
              />
            </div>

            <div className="contractor-filter-group">

              <select
                value={certificationFilter}
                onChange={(event) =>
                  setCertificationFilter(
                    event.target.value,
                  )
                }
                aria-label="Filter contractors by certification status"
              >
                <option value="all">
                  All certification statuses
                </option>

                {certificationOptions.map(
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
                value={projectFilter}
                onChange={(event) =>
                  setProjectFilter(
                    event.target.value,
                  )
                }
                aria-label="Filter contractors by project"
              >
                <option value="all">
                  All projects
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

            </div>

          </div>

          {!loading && !error && (
            <div className="results-bar">

              <span>
                Showing{' '}
                <strong>
                  {filteredContractors.length}
                </strong>{' '}
                of{' '}
                <strong>
                  {contractors.length}
                </strong>{' '}
                contractors
              </span>

              {hasFilters && (
                <button
                  type="button"
                  className="clear-filters-button"
                  onClick={
                    clearFilters
                  }
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
                Loading contractors...
              </strong>

              <span>
                Fetching your organization's
                contractor data.
              </span>

            </div>
          ) : error ? (
            <div className="page-state">

              <div className="empty-state-icon">
                !
              </div>

              <strong>
                Contractors could not be loaded
              </strong>

              <span>
                Check your connection and try again.
              </span>

              <button
                type="button"
                className="primary-button"
                onClick={loadData}
              >
                Try again
              </button>

            </div>
          ) : filteredContractors.length ===
            0 ? (
            <div className="page-state">

              <div className="empty-state-icon">
                ◈
              </div>

              <strong>
                {contractors.length === 0
                  ? 'No contractors yet'
                  : 'No matching contractors'}
              </strong>

              <span>
                {contractors.length === 0
                  ? 'Add your first contractor to start managing external workforce partners.'
                  : 'Try changing your search or filter settings.'}
              </span>

              {contractors.length === 0 ? (
                <button
                  type="button"
                  className="primary-button"
                  onClick={
                    openCreateModal
                  }
                >
                  + Create contractor
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={
                    clearFilters
                  }
                >
                  Clear filters
                </button>
              )}

            </div>
          ) : (
            <div className="table-wrapper">

              <table className="data-table contractors-table">

                <thead>
                  <tr>
                    <th>Contractor</th>
                    <th>Contact person</th>
                    <th>Project</th>
                    <th>Contact</th>
                    <th>Certification</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>

                  {filteredContractors.map(
                    (contractor) => (
                      <tr key={contractor.id}>

                        <td>
                          <div className="contractor-table-identity">

                            <div className="contractor-table-avatar">
                              {getInitial(
                                contractor.company_name,
                              )}
                            </div>

                            <div>
                              <div className="table-primary">
                                {contractor.company_name ||
                                  'Unnamed contractor'}
                              </div>

                              <div className="table-secondary">
                                Contractor #
                                {contractor.id}
                              </div>
                            </div>

                          </div>
                        </td>

                        <td>
                          {contractor.contact_person ||
                            '—'}
                        </td>

                        <td>
                          <div className="project-cell">
                            {contractor.project_name ||
                              '—'}
                          </div>
                        </td>

                        <td>
                          <div className="contractor-contact-cell">

                            {contractor.email && (
                              <span>
                                {contractor.email}
                              </span>
                            )}

                            {contractor.phone && (
                              <span>
                                {contractor.phone}
                              </span>
                            )}

                            {!contractor.email &&
                              !contractor.phone && (
                                <span>—</span>
                              )}

                          </div>
                        </td>

                        <td>
                          <span
                            className={getCertificationClass(
                              contractor.certification_status,
                            )}
                          >
                            <span className="status-indicator" />

                            {formatCertificationStatus(
                              contractor.certification_status,
                            )}
                          </span>
                        </td>

                        <td>
                          {formatDate(
                            contractor.created_at,
                          )}
                        </td>

                        <td>
                          <div className="contractor-row-actions">

                            <button
                              type="button"
                              className="contractor-action-button"
                              onClick={() =>
                                openViewModal(
                                  contractor,
                                )
                              }
                            >
                              View
                            </button>

                            <button
                              type="button"
                              className="contractor-action-button"
                              onClick={() =>
                                openEditModal(
                                  contractor,
                                )
                              }
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

        {modalOpen && (
          <div
            className="contractor-modal-backdrop"
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
              className="contractor-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="contractor-modal-title"
            >

              <div className="contractor-modal-header">

                <div>
                  <span className="eyebrow">
                    {modalMode === 'create'
                      ? 'CONTRACTOR REGISTRATION'
                      : modalMode === 'edit'
                        ? 'CONTRACTOR MANAGEMENT'
                        : 'CONTRACTOR PROFILE'}
                  </span>

                  <h3 id="contractor-modal-title">
                    {modalMode === 'create'
                      ? 'Add contractor'
                      : modalMode === 'edit'
                        ? 'Edit contractor'
                        : selectedContractor?.company_name ||
                          'Contractor details'}
                  </h3>

                  <p>
                    {modalMode === 'view'
                      ? 'Review contractor contact, project, and certification information.'
                      : 'Enter the contractor information used across your project operations.'}
                  </p>
                </div>

                <button
                  type="button"
                  className="contractor-modal-close"
                  onClick={resetModal}
                  disabled={
                    saving || deleting
                  }
                  aria-label="Close contractor modal"
                >
                  ×
                </button>

              </div>

              {formError && (
                <div
                  className="contractor-form-error"
                  role="alert"
                >
                  {formError}
                </div>
              )}

              {modalMode === 'view' ? (
                <div className="contractor-view-content">

                  <div className="contractor-profile">

                    <div className="contractor-profile-avatar">
                      {getInitial(
                        selectedContractor?.company_name,
                      )}
                    </div>

                    <div>
                      <h4>
                        {selectedContractor?.company_name ||
                          'Unnamed contractor'}
                      </h4>

                      <span>
                        {selectedContractor?.project_name ||
                          'Project not specified'}
                      </span>
                    </div>

                  </div>

                  <div className="contractor-detail-grid">

                    <div className="contractor-detail-item">
                      <span>Project</span>

                      <strong>
                        {selectedContractor?.project_name ||
                          '—'}
                      </strong>
                    </div>

                    <div className="contractor-detail-item">
                      <span>Certification</span>

                      <strong>
                        {formatCertificationStatus(
                          selectedContractor?.certification_status,
                        )}
                      </strong>
                    </div>

                    <div className="contractor-detail-item">
                      <span>Contact person</span>

                      <strong>
                        {selectedContractor?.contact_person ||
                          '—'}
                      </strong>
                    </div>

                    <div className="contractor-detail-item">
                      <span>Email</span>

                      <strong>
                        {selectedContractor?.email ||
                          '—'}
                      </strong>
                    </div>

                    <div className="contractor-detail-item">
                      <span>Phone</span>

                      <strong>
                        {selectedContractor?.phone ||
                          '—'}
                      </strong>
                    </div>

                    <div className="contractor-detail-item">
                      <span>Contractor ID</span>

                      <strong>
                        #{selectedContractor?.id}
                      </strong>
                    </div>

                    <div className="contractor-detail-item">
                      <span>Created</span>

                      <strong>
                        {formatDate(
                          selectedContractor?.created_at,
                        )}
                      </strong>
                    </div>

                  </div>

                  <div className="contractor-modal-footer">

                    <button
                      type="button"
                      className="contractor-delete-button"
                      onClick={() =>
                        handleDelete(
                          selectedContractor,
                        )
                      }
                      disabled={deleting}
                    >
                      {deleting
                        ? 'Deleting...'
                        : 'Delete contractor'}
                    </button>

                    <div className="contractor-footer-actions">

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
                            selectedContractor,
                          )
                        }
                        disabled={deleting}
                      >
                        Edit contractor
                      </button>

                    </div>

                  </div>

                </div>
              ) : (
                <form
                  className="contractor-form"
                  onSubmit={handleSubmit}
                >

                  <div className="contractor-form-grid">

                    <label className="contractor-form-field contractor-form-full">
                      <span>
                        Project <b>*</b>
                      </span>

                      <select
                        name="project_id"
                        value={form.project_id}
                        onChange={
                          handleFormChange
                        }
                        required
                      >
                        <option value="">
                          Select a project
                        </option>

                        {projects.map(
                          (project) => (
                            <option
                              key={project.id}
                              value={project.id}
                            >
                              {project.name}
                            </option>
                          ),
                        )}
                      </select>
                    </label>

                    <label className="contractor-form-field contractor-form-full">
                      <span>
                        Contractor company name{' '}
                        <b>*</b>
                      </span>

                      <input
                        name="company_name"
                        value={
                          form.company_name
                        }
                        onChange={
                          handleFormChange
                        }
                        placeholder="e.g. Apex Civil Contractors Ltd"
                        maxLength={255}
                        required
                      />
                    </label>

                    <label className="contractor-form-field">
                      <span>
                        Contact person
                      </span>

                      <input
                        name="contact_person"
                        value={
                          form.contact_person
                        }
                        onChange={
                          handleFormChange
                        }
                        placeholder="Full name"
                        maxLength={255}
                      />
                    </label>

                    <label className="contractor-form-field">
                      <span>
                        Certification status
                      </span>

                      <select
                        name="certification_status"
                        value={
                          form.certification_status
                        }
                        onChange={
                          handleFormChange
                        }
                      >
                        {certificationOptions.map(
                          (option) => (
                            <option
                              key={option.value}
                              value={
                                option.value
                              }
                            >
                              {option.label}
                            </option>
                          ),
                        )}
                      </select>
                    </label>

                    <label className="contractor-form-field">
                      <span>
                        Email address
                      </span>

                      <input
                        type="email"
                        name="email"
                        value={form.email}
                        onChange={
                          handleFormChange
                        }
                        placeholder="contractor@company.com"
                        maxLength={255}
                      />
                    </label>

                    <label className="contractor-form-field">
                      <span>
                        Phone number
                      </span>

                      <input
                        type="tel"
                        name="phone"
                        value={form.phone}
                        onChange={
                          handleFormChange
                        }
                        placeholder="+254 7XX XXX XXX"
                        maxLength={50}
                      />
                    </label>

                  </div>

                  {projects.length === 0 && (
                    <div className="contractor-form-warning">
                      <strong>
                        No projects available
                      </strong>

                      <span>
                        Contractors must be attached
                        to a project. Create a project
                        first before registering a
                        contractor.
                      </span>
                    </div>
                  )}

                  <div className="contractor-form-note">
                    Contractors can only be assigned to
                    projects belonging to your company.
                    Certification status is managed
                    independently.
                  </div>

                  <div className="contractor-modal-footer">

                    <div />

                    <div className="contractor-footer-actions">

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
                        disabled={
                          saving ||
                          projects.length === 0
                        }
                      >
                        {saving
                          ? 'Saving...'
                          : modalMode === 'edit'
                            ? 'Save changes'
                            : 'Create contractor'}
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

export default Contractors