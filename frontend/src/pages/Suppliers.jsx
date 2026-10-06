import { useEffect, useMemo, useState } from 'react'
import AppLayout from '../layouts/AppLayout'

const API_BASE_URL = 'http://localhost:5000/api'

const initialForm = {
  name: '',
  service_type: '',
  contact_person: '',
  email: '',
  phone: '',
  verification_status: 'pending',
}

const verificationOptions = [
  'pending',
  'verified',
  'expired',
  'rejected',
]

function formatLabel(value) {
  if (!value) return '—'

  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function verificationClass(status) {
  return `supplier-badge supplier-verification-${status || 'pending'}`
}

function lifecycleClass(status) {
  return `supplier-badge supplier-lifecycle-${status || 'inactive'}`
}

function Suppliers() {
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [verificationFilter, setVerificationFilter] = useState('all')
  const [serviceFilter, setServiceFilter] = useState('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [selectedSupplier, setSelectedSupplier] = useState(null)
  const [form, setForm] = useState(initialForm)
  const [formError, setFormError] = useState('')

  const token = () => localStorage.getItem('industrafow_token')

  const request = async (endpoint, options = {}) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
        ...(options.headers || {}),
      },
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Request failed')
    }

    return data
  }

  const loadSuppliers = async () => {
    try {
      setLoading(true)
      setError('')

      const data = await request('/suppliers')
      const rows = Array.isArray(data)
        ? data
        : data.suppliers || []

      setSuppliers(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setError(err.message || 'Unable to load suppliers.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSuppliers()
  }, [])

  const serviceTypes = useMemo(() => {
    return [
      ...new Set(
        suppliers
          .map((supplier) => supplier.service_type?.trim())
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b))
  }, [suppliers])

  const summary = useMemo(() => {
    return {
      total: suppliers.length,
      active: suppliers.filter((supplier) => supplier.status === 'active').length,
      verified: suppliers.filter(
        (supplier) => supplier.verification_status === 'verified',
      ).length,
      pending: suppliers.filter(
        (supplier) => supplier.verification_status === 'pending',
      ).length,
    }
  }, [suppliers])

  const filteredSuppliers = useMemo(() => {
    const query = search.trim().toLowerCase()

    return suppliers.filter((supplier) => {
      const matchesSearch =
        !query ||
        [
          supplier.name,
          supplier.service_type,
          supplier.contact_person,
          supplier.email,
          supplier.phone,
        ].some((value) => String(value || '').toLowerCase().includes(query))

      const matchesStatus =
        statusFilter === 'all' || supplier.status === statusFilter

      const matchesVerification =
        verificationFilter === 'all' ||
        supplier.verification_status === verificationFilter

      const matchesService =
        serviceFilter === 'all' || supplier.service_type === serviceFilter

      return (
        matchesSearch &&
        matchesStatus &&
        matchesVerification &&
        matchesService
      )
    })
  }, [suppliers, search, statusFilter, verificationFilter, serviceFilter])

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setVerificationFilter('all')
    setServiceFilter('all')
  }

  const hasFilters =
    search.trim() !== '' ||
    statusFilter !== 'all' ||
    verificationFilter !== 'all' ||
    serviceFilter !== 'all'

  const openCreateModal = () => {
    setModalMode('create')
    setSelectedSupplier(null)
    setForm(initialForm)
    setFormError('')
    setModalOpen(true)
  }

  const openViewModal = (supplier) => {
    setModalMode('view')
    setSelectedSupplier(supplier)
    setForm({
      name: supplier.name || '',
      service_type: supplier.service_type || '',
      contact_person: supplier.contact_person || '',
      email: supplier.email || '',
      phone: supplier.phone || '',
      verification_status: supplier.verification_status || 'pending',
    })
    setFormError('')
    setModalOpen(true)
  }

  const openEditModal = (supplier) => {
    setModalMode('edit')
    setSelectedSupplier(supplier)
    setForm({
      name: supplier.name || '',
      service_type: supplier.service_type || '',
      contact_person: supplier.contact_person || '',
      email: supplier.email || '',
      phone: supplier.phone || '',
      verification_status: supplier.verification_status || 'pending',
    })
    setFormError('')
    setModalOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setSelectedSupplier(null)
    setFormError('')
  }

  const handleFormChange = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!form.name.trim()) {
      setFormError('Supplier name is required.')
      return
    }

    try {
      setSaving(true)
      setFormError('')
      setError('')
      setSuccess('')

      const payload = {
        name: form.name.trim(),
        service_type: form.service_type.trim(),
        contact_person: form.contact_person.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        verification_status: form.verification_status,
      }

      const isEditing = modalMode === 'edit'
      const endpoint = isEditing
        ? `/suppliers/${selectedSupplier.id}`
        : '/suppliers'

      const data = await request(endpoint, {
        method: isEditing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })

      const savedSupplier = data.supplier

      if (savedSupplier) {
        setSuppliers((current) => {
          if (isEditing) {
            return current.map((supplier) =>
              supplier.id === savedSupplier.id ? savedSupplier : supplier,
            )
          }

          return [savedSupplier, ...current]
        })
      } else {
        await loadSuppliers()
      }

      setModalOpen(false)
      setSuccess(
        isEditing
          ? 'Supplier details updated successfully.'
          : 'Supplier created successfully.',
      )
    } catch (err) {
      setFormError(err.message || 'Unable to save supplier.')
    } finally {
      setSaving(false)
    }
  }

  const toggleLifecycle = async (supplier) => {
    const isActive = supplier.status === 'active'
    const nextStatus = isActive ? 'inactive' : 'active'
    const action = isActive ? 'deactivate' : 'reactivate'

    const confirmed = window.confirm(
      `Are you sure you want to ${action} ${supplier.name}?`,
    )

    if (!confirmed) return

    try {
      setError('')
      setSuccess('')

      const data = await request(`/suppliers/${supplier.id}`, {
        method: isActive ? 'DELETE' : 'PUT',
        ...(isActive
          ? {}
          : { body: JSON.stringify({ status: nextStatus }) }),
      })

      if (data.supplier) {
        setSuppliers((current) =>
          current.map((item) =>
            item.id === data.supplier.id ? data.supplier : item,
          ),
        )
      } else {
        await loadSuppliers()
      }

      setSuccess(
        isActive
          ? 'Supplier deactivated successfully.'
          : 'Supplier reactivated successfully.',
      )
    } catch (err) {
      setError(err.message || `Unable to ${action} supplier.`)
    }
  }

  return (
    <AppLayout>
      <div className="page suppliers-page">
        <section className="page-header">
          <div>
            <span className="eyebrow">VENDOR MANAGEMENT</span>
            <h2>Suppliers</h2>
            <p>
              Manage your company's suppliers, service providers, and
              verification status in one place.
            </p>
          </div>

          <button
            type="button"
            className="primary-button"
            onClick={openCreateModal}
          >
            + Add supplier
          </button>
        </section>

        {success && (
          <div className="supplier-alert supplier-alert-success" role="status">
            <span>✓</span>
            <span>{success}</span>
            <button
              type="button"
              aria-label="Dismiss message"
              onClick={() => setSuccess('')}
            >
              ×
            </button>
          </div>
        )}

        {error && (
          <div className="supplier-alert supplier-alert-error" role="alert">
            <div>
              <strong>Something went wrong</strong>
              <span>{error}</span>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={loadSuppliers}
            >
              Retry
            </button>
          </div>
        )}

        <section className="supplier-summary-grid">
          <div className="supplier-summary-card">
            <div className="supplier-summary-top">
              <span>Total suppliers</span>
              <span className="supplier-summary-icon">▤</span>
            </div>
            <strong>{loading ? '—' : summary.total}</strong>
            <small>Registered suppliers</small>
          </div>

          <div className="supplier-summary-card">
            <div className="supplier-summary-top">
              <span>Active suppliers</span>
              <span className="supplier-summary-icon">✓</span>
            </div>
            <strong>{loading ? '—' : summary.active}</strong>
            <small>Currently available</small>
          </div>

          <div className="supplier-summary-card">
            <div className="supplier-summary-top">
              <span>Verified</span>
              <span className="supplier-summary-icon">◆</span>
            </div>
            <strong>{loading ? '—' : summary.verified}</strong>
            <small>Verification completed</small>
          </div>

          <div className="supplier-summary-card">
            <div className="supplier-summary-top">
              <span>Pending verification</span>
              <span className="supplier-summary-icon">◷</span>
            </div>
            <strong>{loading ? '—' : summary.pending}</strong>
            <small>Awaiting review</small>
          </div>
        </section>

        <section className="supplier-toolbar">
          <div className="supplier-search">
            <span>⌕</span>
            <input
              type="search"
              placeholder="Search suppliers, contacts, email..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <select
            className="filter-select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter by lifecycle status"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>

          <select
            className="filter-select"
            value={verificationFilter}
            onChange={(event) => setVerificationFilter(event.target.value)}
            aria-label="Filter by verification"
          >
            <option value="all">All verification</option>
            {verificationOptions.map((status) => (
              <option key={status} value={status}>
                {formatLabel(status)}
              </option>
            ))}
          </select>

          <select
            className="filter-select"
            value={serviceFilter}
            onChange={(event) => setServiceFilter(event.target.value)}
            aria-label="Filter by service type"
          >
            <option value="all">All service types</option>
            {serviceTypes.map((service) => (
              <option key={service} value={service}>
                {service}
              </option>
            ))}
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

        <section className="supplier-table-card">
          <div className="supplier-table-heading">
            <div>
              <h3>Supplier directory</h3>
              <p>
                {loading
                  ? 'Loading supplier records...'
                  : `${filteredSuppliers.length} supplier${filteredSuppliers.length === 1 ? '' : 's'} shown`}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="loading-state">
              <div className="loading-spinner" />
              <span>Loading suppliers...</span>
            </div>
          ) : filteredSuppliers.length === 0 ? (
            <div className="supplier-empty-state">
              <div className="supplier-empty-icon">◇</div>
              <h3>
                {suppliers.length === 0
                  ? 'No suppliers registered yet'
                  : 'No matching suppliers'}
              </h3>
              <p>
                {suppliers.length === 0
                  ? 'Add your first supplier to start building your supplier directory.'
                  : 'Try changing your search or filters to find a supplier.'}
              </p>
              {suppliers.length === 0 ? (
                <button
                  type="button"
                  className="primary-button"
                  onClick={openCreateModal}
                >
                  + Add first supplier
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table supplier-table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Service type</th>
                    <th>Contact person</th>
                    <th>Verification</th>
                    <th>Status</th>
                    <th>Added</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map((supplier) => (
                    <tr key={supplier.id}>
                      <td>
                        <div className="supplier-identity">
                          <div className="supplier-avatar">
                            {(supplier.name || 'S').trim().charAt(0).toUpperCase()}
                          </div>
                          <div className="supplier-identity-text">
                            <strong>{supplier.name || 'Unnamed supplier'}</strong>
                            <span>{supplier.email || 'No email provided'}</span>
                          </div>
                        </div>
                      </td>
                      <td>{supplier.service_type || '—'}</td>
                      <td>
                        <div className="supplier-contact-cell">
                          <strong>{supplier.contact_person || '—'}</strong>
                          <span>{supplier.phone || 'No phone provided'}</span>
                        </div>
                      </td>
                      <td>
                        <span
                          className={verificationClass(
                            supplier.verification_status,
                          )}
                        >
                          {formatLabel(supplier.verification_status)}
                        </span>
                      </td>
                      <td>
                        <span className={lifecycleClass(supplier.status)}>
                          {formatLabel(supplier.status)}
                        </span>
                      </td>
                      <td>
                        {supplier.created_at
                          ? new Date(supplier.created_at).toLocaleDateString(
                              undefined,
                              {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              },
                            )
                          : '—'}
                      </td>
                      <td>
                        <div className="supplier-row-actions">
                          <button
                            type="button"
                            className="supplier-action-button"
                            onClick={() => openViewModal(supplier)}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="supplier-action-button"
                            onClick={() => openEditModal(supplier)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={`supplier-action-button ${
                              supplier.status === 'active'
                                ? 'supplier-action-danger'
                                : 'supplier-action-restore'
                            }`}
                            onClick={() => toggleLifecycle(supplier)}
                          >
                            {supplier.status === 'active'
                              ? 'Deactivate'
                              : 'Reactivate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {modalOpen && (
          <div
            className="asset-modal-backdrop supplier-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeModal()
            }}
          >
            <section
              className="asset-modal supplier-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="supplier-modal-title"
            >
              <div className="asset-modal-header">
                <div>
                  <span className="eyebrow">
                    {modalMode === 'create'
                      ? 'SUPPLIER REGISTRATION'
                      : modalMode === 'edit'
                        ? 'SUPPLIER MANAGEMENT'
                        : 'SUPPLIER PROFILE'}
                  </span>
                  <h3 id="supplier-modal-title">
                    {modalMode === 'create'
                      ? 'Add a supplier'
                      : modalMode === 'edit'
                        ? 'Edit supplier'
                        : 'Supplier details'}
                  </h3>
                  <p>
                    {modalMode === 'view'
                      ? 'Review supplier contact and verification information.'
                      : 'Enter accurate supplier details for your company directory.'}
                  </p>
                </div>

                <button
                  type="button"
                  className="modal-close-button"
                  onClick={closeModal}
                  aria-label="Close modal"
                >
                  ×
                </button>
              </div>

              {formError && (
                <div className="supplier-form-error" role="alert">
                  {formError}
                </div>
              )}

              {modalMode === 'view' ? (
                <div className="supplier-view-content">
                  <div className="supplier-profile-heading">
                    <div className="supplier-profile-avatar">
                      {(selectedSupplier?.name || 'S')
                        .trim()
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                    <div>
                      <h4>{selectedSupplier?.name || 'Unnamed supplier'}</h4>
                      <span>
                        {selectedSupplier?.service_type || 'Service type not specified'}
                      </span>
                    </div>
                  </div>

                  <div className="supplier-detail-grid">
                    <div className="supplier-detail-item">
                      <span>Contact person</span>
                      <strong>{selectedSupplier?.contact_person || '—'}</strong>
                    </div>
                    <div className="supplier-detail-item">
                      <span>Email address</span>
                      <strong>{selectedSupplier?.email || '—'}</strong>
                    </div>
                    <div className="supplier-detail-item">
                      <span>Phone number</span>
                      <strong>{selectedSupplier?.phone || '—'}</strong>
                    </div>
                    <div className="supplier-detail-item">
                      <span>Service type</span>
                      <strong>{selectedSupplier?.service_type || '—'}</strong>
                    </div>
                    <div className="supplier-detail-item">
                      <span>Verification status</span>
                      <strong>
                        {formatLabel(selectedSupplier?.verification_status)}
                      </strong>
                    </div>
                    <div className="supplier-detail-item">
                      <span>Lifecycle status</span>
                      <strong>{formatLabel(selectedSupplier?.status)}</strong>
                    </div>
                    <div className="supplier-detail-item">
                      <span>Date registered</span>
                      <strong>
                        {selectedSupplier?.created_at
                          ? new Date(
                              selectedSupplier.created_at,
                            ).toLocaleDateString()
                          : '—'}
                      </strong>
                    </div>
                  </div>

                  <div className="supplier-modal-footer">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={closeModal}
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => openEditModal(selectedSupplier)}
                    >
                      Edit supplier
                    </button>
                  </div>
                </div>
              ) : (
                <form className="asset-form supplier-form" onSubmit={handleSubmit}>
                  <div className="supplier-form-grid">
                    <label className="supplier-form-field">
                      <span>Supplier name <b>*</b></span>
                      <input
                        name="name"
                        value={form.name}
                        onChange={handleFormChange}
                        placeholder="e.g. Nairobi Building Supplies"
                        maxLength={255}
                        required
                      />
                    </label>

                    <label className="supplier-form-field">
                      <span>Service type</span>
                      <input
                        name="service_type"
                        value={form.service_type}
                        onChange={handleFormChange}
                        placeholder="e.g. Bulk Materials"
                        maxLength={100}
                      />
                    </label>

                    <label className="supplier-form-field">
                      <span>Contact person</span>
                      <input
                        name="contact_person"
                        value={form.contact_person}
                        onChange={handleFormChange}
                        placeholder="Full name"
                        maxLength={255}
                      />
                    </label>

                    <label className="supplier-form-field">
                      <span>Email address</span>
                      <input
                        type="email"
                        name="email"
                        value={form.email}
                        onChange={handleFormChange}
                        placeholder="supplier@company.com"
                        maxLength={255}
                      />
                    </label>

                    <label className="supplier-form-field">
                      <span>Phone number</span>
                      <input
                        type="tel"
                        name="phone"
                        value={form.phone}
                        onChange={handleFormChange}
                        placeholder="+254 7XX XXX XXX"
                        maxLength={50}
                      />
                    </label>

                    <label className="supplier-form-field">
                      <span>Verification status</span>
                      <select
                        name="verification_status"
                        value={form.verification_status}
                        onChange={handleFormChange}
                      >
                        {verificationOptions.map((status) => (
                          <option key={status} value={status}>
                            {formatLabel(status)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="supplier-form-note">
                    New suppliers are automatically registered as active.
                    Verification status is managed separately from lifecycle status.
                  </div>

                  <div className="supplier-modal-footer">
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
                        ? 'Saving...'
                        : modalMode === 'edit'
                          ? 'Save changes'
                          : 'Create supplier'}
                    </button>
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

export default Suppliers