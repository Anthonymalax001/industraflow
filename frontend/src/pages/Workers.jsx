import { useEffect, useMemo, useState } from 'react'
import AppLayout from '../layouts/AppLayout'

const API_BASE_URL = 'http://localhost:5000/api'

const statusOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'terminated', label: 'Terminated' },
]

const employmentOptions = [
  { value: 'all', label: 'All employment types' },
  { value: 'direct', label: 'Direct employees' },
  { value: 'contractor', label: 'Contractors' },
]

const workerStatusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'terminated', label: 'Terminated' },
]

const initialForm = {
  name: '',
  position: '',
  skills: '',
  certification: '',
  status: 'active',
  employee_number: '',
  employment_type: 'direct',
  contractor_id: '',
}

function formatLabel(value) {
  if (!value) return '—'

  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatEmploymentType(value) {
  if (value === 'contractor') {
    return 'Contractor'
  }

  if (value === 'direct') {
    return 'Direct employee'
  }

  return '—'
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

function getWorkerStatusClass(status) {
  switch (status) {
    case 'active':
      return 'worker-status-badge worker-status-active'

    case 'inactive':
      return 'worker-status-badge worker-status-inactive'

    case 'suspended':
      return 'worker-status-badge worker-status-suspended'

    case 'terminated':
      return 'worker-status-badge worker-status-terminated'

    default:
      return 'worker-status-badge'
  }
}

function getInitial(value) {
  return (
    String(value || 'W')
      .trim()
      .charAt(0)
      .toUpperCase() || 'W'
  )
}

function Workers() {
  const [workers, setWorkers] = useState([])
  const [contractors, setContractors] = useState([])
  const [count, setCount] = useState(0)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deactivating, setDeactivating] = useState(false)

  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [employmentFilter, setEmploymentFilter] = useState('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [selectedWorker, setSelectedWorker] = useState(null)

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

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(
        data.error ||
          data.message ||
          'Request failed',
      )
    }

    return data
  }

  const loadWorkers = async () => {
    const data = await request('/workers')

    const workerList = Array.isArray(data.workers)
      ? data.workers
      : []

    setWorkers(workerList)
    setCount(
      Number(data.count) ||
        workerList.length,
    )
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

  const loadData = async () => {
    try {
      setLoading(true)
      setError('')

      await Promise.all([
        loadWorkers(),
        loadContractors(),
      ])
    } catch (err) {
      setError(
        err.message ||
          'Unable to load workforce data.',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const filteredWorkers = useMemo(() => {
    const searchValue = search
      .toLowerCase()
      .trim()

    return workers.filter((worker) => {
      const name = String(
        worker.name || '',
      ).toLowerCase()

      const employeeNumber = String(
        worker.employee_number || '',
      ).toLowerCase()

      const position = String(
        worker.position || '',
      ).toLowerCase()

      const contractorName = String(
        worker.contractor_name || '',
      ).toLowerCase()

      const matchesSearch =
        !searchValue ||
        name.includes(searchValue) ||
        employeeNumber.includes(searchValue) ||
        position.includes(searchValue) ||
        contractorName.includes(searchValue)

      const workerStatus = String(
        worker.status || '',
      ).toLowerCase()

      const matchesStatus =
        statusFilter === 'all' ||
        workerStatus === statusFilter

      const workerEmployment = String(
        worker.employment_type || '',
      ).toLowerCase()

      const matchesEmployment =
        employmentFilter === 'all' ||
        workerEmployment ===
          employmentFilter

      return (
        matchesSearch &&
        matchesStatus &&
        matchesEmployment
      )
    })
  }, [
    workers,
    search,
    statusFilter,
    employmentFilter,
  ])

  const activeCount = workers.filter(
    (worker) =>
      worker.status === 'active',
  ).length

  const contractorCount = workers.filter(
    (worker) =>
      worker.employment_type ===
      'contractor',
  ).length

  const directCount = workers.filter(
    (worker) =>
      worker.employment_type ===
      'direct',
  ).length

  const hasFilters =
    search.trim() !== '' ||
    statusFilter !== 'all' ||
    employmentFilter !== 'all'

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setEmploymentFilter('all')
  }

  const resetModal = () => {
    setModalOpen(false)
    setModalMode('create')
    setSelectedWorker(null)
    setForm(initialForm)
    setFormError('')
  }

  const openCreateModal = () => {
    setModalMode('create')
    setSelectedWorker(null)
    setForm(initialForm)
    setFormError('')
    setSuccess('')
    setModalOpen(true)
  }

  const openViewModal = (worker) => {
    setModalMode('view')
    setSelectedWorker(worker)

    setForm({
      name: worker.name || '',
      position: worker.position || '',
      skills: worker.skills || '',
      certification:
        worker.certification || '',
      status: worker.status || 'active',
      employee_number:
        worker.employee_number || '',
      employment_type:
        worker.employment_type ||
        'direct',
      contractor_id: worker.contractor_id
        ? String(worker.contractor_id)
        : '',
    })

    setFormError('')
    setSuccess('')
    setModalOpen(true)
  }

  const openEditModal = (worker) => {
    setModalMode('edit')
    setSelectedWorker(worker)

    setForm({
      name: worker.name || '',
      position: worker.position || '',
      skills: worker.skills || '',
      certification:
        worker.certification || '',
      status: worker.status || 'active',
      employee_number:
        worker.employee_number || '',
      employment_type:
        worker.employment_type ||
        'direct',
      contractor_id: worker.contractor_id
        ? String(worker.contractor_id)
        : '',
    })

    setFormError('')
    setSuccess('')
    setModalOpen(true)
  }

  const handleFormChange = (event) => {
    const { name, value } = event.target

    setForm((current) => {
      const next = {
        ...current,
        [name]: value,
      }

      if (
        name === 'employment_type' &&
        value === 'direct'
      ) {
        next.contractor_id = ''
      }

      return next
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!form.name.trim()) {
      setFormError(
        'Worker name is required.',
      )
      return
    }

    if (
      form.employee_number.trim().length >
      50
    ) {
      setFormError(
        'Employee number must be 50 characters or fewer.',
      )
      return
    }

    if (
      form.employment_type ===
        'contractor' &&
      !form.contractor_id
    ) {
      setFormError(
        'Please select the employing contractor.',
      )
      return
    }

    if (
      form.employment_type === 'direct' &&
      form.contractor_id
    ) {
      setFormError(
        'A direct employee cannot have a contractor.',
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

        position:
          form.position.trim() || null,

        skills:
          form.skills.trim() || null,

        certification:
          form.certification.trim() ||
          null,

        status: form.status,

        employee_number:
          form.employee_number.trim() ||
          null,

        employment_type:
          form.employment_type,

        contractor_id:
          form.employment_type ===
          'contractor'
            ? Number(form.contractor_id)
            : null,
      }

      const isEditing =
        modalMode === 'edit'

      const endpoint = isEditing
        ? `/workers/${selectedWorker.id}`
        : '/workers'

      const data = await request(
        endpoint,
        {
          method: isEditing
            ? 'PUT'
            : 'POST',
          body: JSON.stringify(payload),
        },
      )

      if (data.worker) {
        const contractor =
          contractors.find(
            (item) =>
              String(item.id) ===
              String(
                data.worker.contractor_id,
              ),
          )

        const normalizedWorker = {
          ...data.worker,
          contractor_name:
            contractor?.company_name ||
            data.worker.contractor_name ||
            null,
        }

        if (isEditing) {
          setWorkers((current) =>
            current.map((worker) =>
              worker.id ===
              normalizedWorker.id
                ? normalizedWorker
                : worker,
            ),
          )
        } else {
          setWorkers((current) => [
            normalizedWorker,
            ...current,
          ])

          setCount(
            (current) => current + 1,
          )
        }
      } else {
        await loadWorkers()
      }

      resetModal()

      setSuccess(
        isEditing
          ? 'Worker updated successfully.'
          : 'Worker created successfully.',
      )
    } catch (err) {
      setFormError(
        err.message ||
          'Unable to save worker.',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (
    worker,
  ) => {
    if (worker.status === 'inactive') {
      return
    }

    const confirmed = window.confirm(
      `Deactivate "${worker.name}"? The worker record and its history will be retained.`,
    )

    if (!confirmed) {
      return
    }

    try {
      setDeactivating(true)
      setError('')
      setSuccess('')

      const data = await request(
        `/workers/${worker.id}`,
        {
          method: 'DELETE',
        },
      )

      if (data.worker) {
        setWorkers((current) =>
          current.map((item) =>
            item.id ===
            data.worker.id
              ? {
                  ...item,
                  ...data.worker,
                }
              : item,
          ),
        )
      } else {
        await loadWorkers()
      }

      resetModal()

      setSuccess(
        'Worker deactivated successfully.',
      )
    } catch (err) {
      setError(
        err.message ||
          'Unable to deactivate worker.',
      )
    } finally {
      setDeactivating(false)
    }
  }

  return (
    <AppLayout>
      <div className="page workers-page">

        <section className="page-header">
          <div>
            <span className="eyebrow">
              WORKFORCE
            </span>

            <h2>Workers</h2>

            <p>
              Manage your organization's
              workforce, employment status,
              roles, and contractor personnel.
            </p>
          </div>

          <button
            type="button"
            className="primary-button"
            onClick={openCreateModal}
          >
            + New worker
          </button>
        </section>

        {success && (
          <div
            className="worker-success"
            role="status"
          >
            <span>✓</span>

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

        <section className="worker-summary-grid">
          <div className="worker-summary-card">
            <span>TOTAL WORKERS</span>

            <strong>
              {loading ? '—' : count}
            </strong>

            <small>
              {loading
                ? 'Loading workforce'
                : 'Personnel records'}
            </small>
          </div>

          <div className="worker-summary-card">
            <span>ACTIVE</span>

            <strong>
              {loading
                ? '—'
                : activeCount}
            </strong>

            <small>
              Currently active
            </small>
          </div>

          <div className="worker-summary-card">
            <span>DIRECT EMPLOYEES</span>

            <strong>
              {loading
                ? '—'
                : directCount}
            </strong>

            <small>
              Company employees
            </small>
          </div>

          <div className="worker-summary-card">
            <span>CONTRACTORS</span>

            <strong>
              {loading
                ? '—'
                : contractorCount}
            </strong>

            <small>
              Contractor personnel
            </small>
          </div>
        </section>

        {error && (
          <div
            className="dashboard-error worker-error"
            role="alert"
          >
            <strong>
              Unable to load workers
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

        <section className="content-card worker-card">

          <div className="content-toolbar worker-toolbar">

            <div className="search-wrapper">
              <input
                type="search"
                placeholder="Search workers, positions, employee numbers..."
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value,
                  )
                }
              />
            </div>

            <div className="worker-filter-group">

              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value,
                  )
                }
                aria-label="Filter workers by status"
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
                value={employmentFilter}
                onChange={(event) =>
                  setEmploymentFilter(
                    event.target.value,
                  )
                }
                aria-label="Filter workers by employment type"
              >
                {employmentOptions.map(
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
                  {filteredWorkers.length}
                </strong>{' '}
                of{' '}
                <strong>
                  {workers.length}
                </strong>{' '}
                workers
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
                Loading workers...
              </strong>

              <span>
                Fetching your organization's
                workforce data.
              </span>

            </div>
          ) : error ? (
            <div className="page-state">

              <div className="empty-state-icon">
                !
              </div>

              <strong>
                Workers could not be loaded
              </strong>

              <span>
                Check your connection and try
                again.
              </span>

              <button
                type="button"
                className="primary-button"
                onClick={loadData}
              >
                Try again
              </button>

            </div>
          ) : filteredWorkers.length === 0 ? (
            <div className="page-state">

              <div className="empty-state-icon">
                W
              </div>

              <strong>
                {workers.length === 0
                  ? 'No workers yet'
                  : 'No matching workers'}
              </strong>

              <span>
                {workers.length === 0
                  ? 'Add your first worker to start managing your workforce.'
                  : 'Try changing your search or filter settings.'}
              </span>

              {workers.length === 0 ? (
                <button
                  type="button"
                  className="primary-button"
                  onClick={
                    openCreateModal
                  }
                >
                  + Create worker
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

              <table className="data-table workers-table">

                <thead>
                  <tr>
                    <th>Worker</th>
                    <th>Employee No.</th>
                    <th>Position</th>
                    <th>Employment</th>
                    <th>Contractor</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>

                  {filteredWorkers.map(
                    (worker) => (
                      <tr key={worker.id}>

                        <td>
                          <div className="worker-table-identity">

                            <div className="worker-table-avatar">
                              {getInitial(
                                worker.name,
                              )}
                            </div>

                            <div>
                              <div className="table-primary">
                                {worker.name ||
                                  'Unnamed worker'}
                              </div>

                              {worker.certification && (
                                <div className="table-secondary">
                                  {
                                    worker.certification
                                  }
                                </div>
                              )}
                            </div>

                          </div>
                        </td>

                        <td>
                          {worker.employee_number ||
                            '—'}
                        </td>

                        <td>
                          {worker.position ||
                            '—'}
                        </td>

                        <td>
                          <span className="employment-badge">
                            {formatEmploymentType(
                              worker.employment_type,
                            )}
                          </span>
                        </td>

                        <td>
                          {worker.contractor_name ||
                            '—'}
                        </td>

                        <td>
                          <span
                            className={getWorkerStatusClass(
                              worker.status,
                            )}
                          >
                            <span className="status-indicator" />

                            {formatLabel(
                              worker.status,
                            )}
                          </span>
                        </td>

                        <td>
                          <div className="worker-row-actions">

                            <button
                              type="button"
                              className="worker-action-button"
                              onClick={() =>
                                openViewModal(
                                  worker,
                                )
                              }
                            >
                              View
                            </button>

                            <button
                              type="button"
                              className="worker-action-button"
                              onClick={() =>
                                openEditModal(
                                  worker,
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
            className="worker-modal-backdrop"
            onMouseDown={(event) => {
              if (
                event.target ===
                  event.currentTarget &&
                !saving &&
                !deactivating
              ) {
                resetModal()
              }
            }}
          >

            <section
              className="worker-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="worker-modal-title"
            >

              <div className="worker-modal-header">

                <div>
                  <span className="eyebrow">
                    {modalMode === 'create'
                      ? 'WORKFORCE REGISTRATION'
                      : modalMode === 'edit'
                        ? 'WORKFORCE MANAGEMENT'
                        : 'WORKER PROFILE'}
                  </span>

                  <h3 id="worker-modal-title">
                    {modalMode === 'create'
                      ? 'Add worker'
                      : modalMode === 'edit'
                        ? 'Edit worker'
                        : selectedWorker?.name ||
                          'Worker details'}
                  </h3>

                  <p>
                    {modalMode === 'view'
                      ? 'Review worker identity, employment, status, and credential information.'
                      : 'Enter the workforce details for this personnel record.'}
                  </p>
                </div>

                <button
                  type="button"
                  className="worker-modal-close"
                  onClick={resetModal}
                  disabled={
                    saving ||
                    deactivating
                  }
                  aria-label="Close worker modal"
                >
                  ×
                </button>

              </div>

              {formError && (
                <div
                  className="worker-form-error"
                  role="alert"
                >
                  {formError}
                </div>
              )}

              {modalMode === 'view' ? (
                <div className="worker-view-content">

                  <div className="worker-profile">

                    <div className="worker-profile-avatar">
                      {getInitial(
                        selectedWorker?.name,
                      )}
                    </div>

                    <div>
                      <h4>
                        {selectedWorker?.name ||
                          'Unnamed worker'}
                      </h4>

                      <span>
                        {selectedWorker?.position ||
                          'Position not specified'}
                      </span>
                    </div>

                  </div>

                  <div className="worker-detail-grid">

                    <div className="worker-detail-item">
                      <span>Employment</span>

                      <strong>
                        {formatEmploymentType(
                          selectedWorker?.employment_type,
                        )}
                      </strong>
                    </div>

                    <div className="worker-detail-item">
                      <span>Status</span>

                      <strong>
                        {formatLabel(
                          selectedWorker?.status,
                        )}
                      </strong>
                    </div>

                    <div className="worker-detail-item">
                      <span>Employer</span>

                      <strong>
                        {selectedWorker?.contractor_name ||
                          (selectedWorker?.employment_type ===
                          'direct'
                            ? 'Company employee'
                            : '—')}
                      </strong>
                    </div>

                    <div className="worker-detail-item">
                      <span>Employee number</span>

                      <strong>
                        {selectedWorker?.employee_number ||
                          '—'}
                      </strong>
                    </div>

                    <div className="worker-detail-item">
                      <span>Certification</span>

                      <strong>
                        {selectedWorker?.certification ||
                          '—'}
                      </strong>
                    </div>

                    <div className="worker-detail-item">
                      <span>Worker ID</span>

                      <strong>
                        #{selectedWorker?.id}
                      </strong>
                    </div>

                    <div className="worker-detail-item">
                      <span>Created</span>

                      <strong>
                        {formatDate(
                          selectedWorker?.created_at,
                        )}
                      </strong>
                    </div>

                  </div>

                  <div className="worker-text-box">
                    <span>Skills</span>

                    <p>
                      {selectedWorker?.skills ||
                        'No skills recorded.'}
                    </p>
                  </div>

                  <div className="worker-modal-footer">

                    <button
                      type="button"
                      className="worker-deactivate-button"
                      onClick={() =>
                        handleDeactivate(
                          selectedWorker,
                        )
                      }
                      disabled={
                        deactivating ||
                        selectedWorker?.status ===
                          'inactive'
                      }
                    >
                      {deactivating
                        ? 'Deactivating...'
                        : selectedWorker?.status ===
                            'inactive'
                          ? 'Already inactive'
                          : 'Deactivate worker'}
                    </button>

                    <div className="worker-footer-actions">

                      <button
                        type="button"
                        className="secondary-button"
                        onClick={
                          resetModal
                        }
                        disabled={
                          deactivating
                        }
                      >
                        Close
                      </button>

                      <button
                        type="button"
                        className="primary-button"
                        onClick={() =>
                          openEditModal(
                            selectedWorker,
                          )
                        }
                        disabled={
                          deactivating
                        }
                      >
                        Edit worker
                      </button>

                    </div>

                  </div>

                </div>
              ) : (
                <form
                  className="worker-form"
                  onSubmit={handleSubmit}
                >

                  <div className="worker-form-grid">

                    <label className="worker-form-field">
                      <span>
                        Worker name <b>*</b>
                      </span>

                      <input
                        name="name"
                        value={form.name}
                        onChange={
                          handleFormChange
                        }
                        placeholder="e.g. Brian Mwangi"
                        maxLength={255}
                        required
                      />
                    </label>

                    <label className="worker-form-field">
                      <span>
                        Employee number
                      </span>

                      <input
                        name="employee_number"
                        value={
                          form.employee_number
                        }
                        onChange={
                          handleFormChange
                        }
                        placeholder="e.g. EMP-001"
                        maxLength={50}
                      />
                    </label>

                    <label className="worker-form-field">
                      <span>
                        Position
                      </span>

                      <input
                        name="position"
                        value={
                          form.position
                        }
                        onChange={
                          handleFormChange
                        }
                        placeholder="e.g. Site Supervisor"
                      />
                    </label>

                    <label className="worker-form-field">
                      <span>
                        Employment type
                      </span>

                      <select
                        name="employment_type"
                        value={
                          form.employment_type
                        }
                        onChange={
                          handleFormChange
                        }
                      >
                        <option value="direct">
                          Direct employee
                        </option>

                        <option value="contractor">
                          Contractor
                        </option>
                      </select>
                    </label>

                    {form.employment_type ===
                      'contractor' && (
                      <label className="worker-form-field">
                        <span>
                          Contractor <b>*</b>
                        </span>

                        <select
                          name="contractor_id"
                          value={
                            form.contractor_id
                          }
                          onChange={
                            handleFormChange
                          }
                          required
                        >
                          <option value="">
                            Select contractor
                          </option>

                          {contractors.map(
                            (contractor) => (
                              <option
                                key={contractor.id}
                                value={contractor.id}
                              >
                                {
                                  contractor.company_name
                                }
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                    )}

                    <label className="worker-form-field">
                      <span>
                        Status
                      </span>

                      <select
                        name="status"
                        value={form.status}
                        onChange={
                          handleFormChange
                        }
                      >
                        {workerStatusOptions.map(
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
                    </label>

                    <label className="worker-form-field">
                      <span>
                        Certification
                      </span>

                      <input
                        name="certification"
                        value={
                          form.certification
                        }
                        onChange={
                          handleFormChange
                        }
                        placeholder="e.g. OSHA / First Aid"
                      />
                    </label>

                    <label className="worker-form-field">
                      <span>
                        Skills
                      </span>

                      <input
                        name="skills"
                        value={form.skills}
                        onChange={
                          handleFormChange
                        }
                        placeholder="e.g. Welding, lifting, electrical"
                      />
                    </label>

                  </div>

                  {form.employment_type ===
                    'contractor' &&
                    contractors.length === 0 && (
                      <div className="worker-form-warning">
                        <strong>
                          No contractors available
                        </strong>

                        <span>
                          Create a contractor first
                          before registering a
                          contractor-employed worker.
                        </span>
                      </div>
                    )}

                  <div className="worker-form-note">
                    Direct employees cannot have a
                    contractor. Contractor personnel
                    must be linked to a contractor in
                    your company.
                  </div>

                  <div className="worker-modal-footer">

                    <div />

                    <div className="worker-footer-actions">

                      <button
                        type="button"
                        className="secondary-button"
                        onClick={
                          resetModal
                        }
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
                          : modalMode ===
                              'edit'
                            ? 'Save changes'
                            : 'Create worker'}
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

export default Workers