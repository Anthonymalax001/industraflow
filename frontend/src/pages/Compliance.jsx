import { useEffect, useMemo, useState } from 'react'
import AppLayout from '../layouts/AppLayout'

const API_BASE_URL = 'https://industraflow.onrender.com/api'

const scopeOptions = [
  { value: 'all', label: 'All scopes' },
  { value: 'company', label: 'Company' },
  { value: 'project', label: 'Project' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'asset', label: 'Asset' },
  { value: 'supplier', label: 'Supplier' },
]

const documentTypeOptions = [
  { value: 'safety_certificate', label: 'Safety certificate' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'environmental_permit', label: 'Environmental permit' },
  { value: 'operating_licence', label: 'Operating licence' },
  { value: 'inspection_certificate', label: 'Inspection certificate' },
  { value: 'regulatory_approval', label: 'Regulatory approval' },
  { value: 'tax_compliance', label: 'Tax compliance' },
  { value: 'other', label: 'Other' },
]

const verificationOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'verified', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' },
]

const statusOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

const initialForm = {
  scope_type: 'company',
  parent_id: '',
  name: '',
  document_type: 'safety_certificate',
  issuing_authority: '',
  reference_number: '',
  issued_date: '',
  expiry_date: '',
  document_url: '',
  verification_status: 'pending',
  status: 'active',
}

function Compliance() {
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [documentTypeFilter, setDocumentTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [verificationFilter, setVerificationFilter] = useState('all')
  const [expiryFilter, setExpiryFilter] = useState('all')

  const [modal, setModal] = useState(null)
  const [selectedDocument, setSelectedDocument] = useState(null)
  const [form, setForm] = useState(initialForm)

  const [saving, setSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [formError, setFormError] = useState('')

  const getToken = () => {
    return localStorage.getItem('industrafow_token')
  }

  const request = async (endpoint, options = {}) => {
    const token = getToken()

    if (!token) {
      throw new Error('Your session has expired. Please sign in again.')
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(
        data.error || data.message || 'Compliance request failed.',
      )
    }

    return data
  }

  const loadDocuments = async () => {
    try {
      setLoading(true)
      setError('')

      const data = await request('/compliance-documents')

      const documentList = Array.isArray(data.compliance_documents)
        ? data.compliance_documents
        : []

      setDocuments(documentList)
    } catch (err) {
      setError(err.message || 'Unable to load compliance documents.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDocuments()
  }, [])

  const filteredDocuments = useMemo(() => {
    const searchValue = search.toLowerCase().trim()

    return documents.filter((document) => {
      const name = String(document.name || '').toLowerCase()
      const authority = String(
        document.issuing_authority || '',
      ).toLowerCase()
      const reference = String(
        document.reference_number || '',
      ).toLowerCase()
      const projectName = String(
        document.project_name || '',
      ).toLowerCase()
      const contractorName = String(
        document.contractor_name || '',
      ).toLowerCase()
      const assetName = String(
        document.asset_name || '',
      ).toLowerCase()
      const supplierName = String(
        document.supplier_name || '',
      ).toLowerCase()

      const matchesSearch =
        !searchValue ||
        name.includes(searchValue) ||
        authority.includes(searchValue) ||
        reference.includes(searchValue) ||
        projectName.includes(searchValue) ||
        contractorName.includes(searchValue) ||
        assetName.includes(searchValue) ||
        supplierName.includes(searchValue)

      const matchesScope =
        scopeFilter === 'all' ||
        document.scope_type === scopeFilter

      const matchesDocumentType =
        documentTypeFilter === 'all' ||
        document.document_type === documentTypeFilter

      const matchesStatus =
        statusFilter === 'all' ||
        document.status === statusFilter

      const matchesVerification =
        verificationFilter === 'all' ||
        document.verification_status === verificationFilter

      let matchesExpiry = true

      if (expiryFilter === 'expired') {
        matchesExpiry = document.is_expired
      }

      if (expiryFilter === 'expiring') {
        matchesExpiry =
          !document.is_expired &&
          document.days_until_expiry !== null &&
          Number(document.days_until_expiry) >= 0 &&
          Number(document.days_until_expiry) <= 30
      }

      if (expiryFilter === 'valid') {
        matchesExpiry =
          !document.is_expired &&
          (
            document.days_until_expiry === null ||
            Number(document.days_until_expiry) > 30
          )
      }

      return (
        matchesSearch &&
        matchesScope &&
        matchesDocumentType &&
        matchesStatus &&
        matchesVerification &&
        matchesExpiry
      )
    })
  }, [
    documents,
    search,
    scopeFilter,
    documentTypeFilter,
    statusFilter,
    verificationFilter,
    expiryFilter,
  ])

  const summary = useMemo(() => {
    const active = documents.filter(
      (document) => document.status === 'active',
    )

    const expired = active.filter(
      (document) => document.is_expired,
    )

    const expiringSoon = active.filter(
      (document) =>
        !document.is_expired &&
        document.days_until_expiry !== null &&
        Number(document.days_until_expiry) >= 0 &&
        Number(document.days_until_expiry) <= 30,
    )

    const verified = active.filter(
      (document) => document.verification_status === 'verified',
    )

    const pending = active.filter(
      (document) => document.verification_status === 'pending',
    )

    return {
      total: documents.length,
      active: active.length,
      expired: expired.length,
      expiringSoon: expiringSoon.length,
      verified: verified.length,
      pending: pending.length,
    }
  }, [documents])

  const formatLabel = (value) => {
    if (!value) {
      return '—'
    }

    return String(value)
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  }

  const getScopeName = (document) => {
    if (document.scope_type === 'company') {
      return 'Company'
    }

    if (document.scope_type === 'project') {
      return document.project_name || 'Project'
    }

    if (document.scope_type === 'contractor') {
      return document.contractor_name || 'Contractor'
    }

    if (document.scope_type === 'asset') {
      return document.asset_name || 'Asset'
    }

    if (document.scope_type === 'supplier') {
      return document.supplier_name || 'Supplier'
    }

    return '—'
  }

  const getExpiryState = (document) => {
    if (!document.expiry_date) {
      return {
        label: 'No expiry',
        className: 'compliance-expiry-neutral',
      }
    }

    if (document.is_expired) {
      return {
        label: 'Expired',
        className: 'compliance-expiry-danger',
      }
    }

    const days = Number(document.days_until_expiry)

    if (days <= 30) {
      return {
        label: `${days} day${days === 1 ? '' : 's'} left`,
        className: 'compliance-expiry-warning',
      }
    }

    return {
      label: `${days} days left`,
      className: 'compliance-expiry-valid',
    }
  }

  const openCreateModal = () => {
    setForm(initialForm)
    setFormError('')
    setSelectedDocument(null)
    setModal('create')
  }

  const openViewModal = async (document) => {
    try {
      setActionLoading(true)
      setFormError('')

      const data = await request(
        `/compliance-documents/${document.id}`,
      )

      setSelectedDocument(data.compliance_document)
      setModal('view')
    } catch (err) {
      setError(err.message || 'Unable to load compliance document.')
    } finally {
      setActionLoading(false)
    }
  }

  const openEditModal = (document) => {
    setSelectedDocument(document)

    let parentId = ''

    if (document.scope_type === 'project') {
      parentId = document.project_id || ''
    }

    if (document.scope_type === 'contractor') {
      parentId = document.contractor_id || ''
    }

    if (document.scope_type === 'asset') {
      parentId = document.asset_id || ''
    }

    if (document.scope_type === 'supplier') {
      parentId = document.supplier_id || ''
    }

    setForm({
      scope_type: document.scope_type || 'company',
      parent_id: parentId,
      name: document.name || '',
      document_type: document.document_type || 'other',
      issuing_authority: document.issuing_authority || '',
      reference_number: document.reference_number || '',
      issued_date: document.issued_date || '',
      expiry_date: document.expiry_date || '',
      document_url: document.document_url || '',
      verification_status:
        document.verification_status || 'pending',
      status: document.status || 'active',
    })

    setFormError('')
    setModal('edit')
  }

  const openRenewModal = (document) => {
    setSelectedDocument(document)

    setForm({
      ...initialForm,
      scope_type: document.scope_type || 'company',
      parent_id:
        document.project_id ||
        document.contractor_id ||
        document.asset_id ||
        document.supplier_id ||
        '',
      name: document.name || '',
      document_type: document.document_type || 'other',
      issuing_authority: document.issuing_authority || '',
      reference_number: document.reference_number || '',
      issued_date: new Date().toISOString().slice(0, 10),
      expiry_date: '',
      document_url: document.document_url || '',
      verification_status:
        document.verification_status || 'pending',
      status: document.status || 'active',
    })

    setFormError('')
    setModal('renew')
  }

  const closeModal = () => {
    if (saving || actionLoading) {
      return
    }

    setModal(null)
    setSelectedDocument(null)
    setForm(initialForm)
    setFormError('')
  }

  const handleFormChange = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const buildPayload = () => {
    const payload = {
      scope_type: form.scope_type,
      name: form.name.trim(),
      document_type: form.document_type,
      issuing_authority:
        form.issuing_authority.trim() || null,
      reference_number:
        form.reference_number.trim() || null,
      issued_date: form.issued_date || null,
      expiry_date: form.expiry_date || null,
      document_url: form.document_url.trim() || null,
      verification_status: form.verification_status,
    }

    if (form.scope_type !== 'company') {
      const parentId = Number(form.parent_id)

      if (!Number.isInteger(parentId) || parentId < 1) {
        throw new Error(
          `A valid ${form.scope_type} ID is required.`,
        )
      }

      if (form.scope_type === 'project') {
        payload.project_id = parentId
      }

      if (form.scope_type === 'contractor') {
        payload.contractor_id = parentId
      }

      if (form.scope_type === 'asset') {
        payload.asset_id = parentId
      }

      if (form.scope_type === 'supplier') {
        payload.supplier_id = parentId
      }
    }

    return payload
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    try {
      setSaving(true)
      setFormError('')

      if (!form.name.trim()) {
        throw new Error('Compliance document name is required.')
      }

      if (!form.document_type) {
        throw new Error('Document type is required.')
      }

      if (
        form.issued_date &&
        form.expiry_date &&
        form.expiry_date < form.issued_date
      ) {
        throw new Error(
          'Expiry date must be on or after the issued date.',
        )
      }

      const payload = buildPayload()

      if (modal === 'create') {
        await request('/compliance-documents', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
      } else {
        await request(
          `/compliance-documents/${selectedDocument.id}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              ...payload,
              status: form.status,
            }),
          },
        )
      }

      setModal(null)
      setSelectedDocument(null)
      setForm(initialForm)
      setFormError('')

      await loadDocuments()
    } catch (err) {
      setFormError(
        err.message || 'Unable to save compliance document.',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async () => {
    if (!selectedDocument) {
      return
    }

    try {
      setActionLoading(true)
      setFormError('')

      await request(
        `/compliance-documents/${selectedDocument.id}`,
        {
          method: 'DELETE',
        },
      )

      setModal(null)
      setSelectedDocument(null)
      setFormError('')

      await loadDocuments()
    } catch (err) {
      setFormError(
        err.message || 'Unable to deactivate compliance document.',
      )
    } finally {
      setActionLoading(false)
    }
  }

  const handleReactivate = async () => {
    if (!selectedDocument) {
      return
    }

    try {
      setActionLoading(true)
      setFormError('')

      await request(
        `/compliance-documents/${selectedDocument.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            status: 'active',
          }),
        },
      )

      setModal(null)
      setSelectedDocument(null)
      setFormError('')

      await loadDocuments()
    } catch (err) {
      setFormError(
        err.message || 'Unable to reactivate compliance document.',
      )
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <AppLayout>
      <section className="page-header">
        <div>
          <span className="eyebrow">COMPLIANCE</span>

          <h2>Compliance documents</h2>

          <p>
            Monitor certificates, licences, permits, insurance,
            inspections, and regulatory documentation across your
            organization.
          </p>
        </div>

        <button
          className="primary-button"
          onClick={openCreateModal}
        >
          + New document
        </button>
      </section>

      <section className="compliance-summary-grid">
        <div className="compliance-summary-card">
          <span>TOTAL DOCUMENTS</span>
          <strong>{loading ? '—' : summary.total}</strong>
          <small>Compliance records</small>
        </div>

        <div className="compliance-summary-card">
          <span>ACTIVE</span>
          <strong>{loading ? '—' : summary.active}</strong>
          <small>Currently active</small>
        </div>

        <div className="compliance-summary-card compliance-summary-warning">
          <span>EXPIRING SOON</span>
          <strong>{loading ? '—' : summary.expiringSoon}</strong>
          <small>Within 30 days</small>
        </div>

        <div className="compliance-summary-card compliance-summary-danger">
          <span>EXPIRED</span>
          <strong>{loading ? '—' : summary.expired}</strong>
          <small>Require renewal</small>
        </div>

        <div className="compliance-summary-card">
          <span>VERIFIED</span>
          <strong>{loading ? '—' : summary.verified}</strong>
          <small>Verified records</small>
        </div>

        <div className="compliance-summary-card">
          <span>PENDING</span>
          <strong>{loading ? '—' : summary.pending}</strong>
          <small>Awaiting verification</small>
        </div>
      </section>

      {error && (
        <div className="dashboard-error" role="alert">
          <strong>Unable to load compliance documents</strong>
          <span>{error}</span>

          <button
            className="retry-button"
            onClick={loadDocuments}
          >
            Try again
          </button>
        </div>
      )}

      <section className="content-card">
        <div className="content-toolbar compliance-toolbar">
          <div className="search-wrapper">
            <input
              type="search"
              placeholder="Search documents, authorities, references..."
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
            />
          </div>

          <div className="compliance-filter-group">
            <select
              value={scopeFilter}
              onChange={(event) =>
                setScopeFilter(event.target.value)
              }
            >
              {scopeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={documentTypeFilter}
              onChange={(event) =>
                setDocumentTypeFilter(event.target.value)
              }
            >
              <option value="all">All document types</option>

              {documentTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value)
              }
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={verificationFilter}
              onChange={(event) =>
                setVerificationFilter(event.target.value)
              }
            >
              <option value="all">All verification</option>

              {verificationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={expiryFilter}
              onChange={(event) =>
                setExpiryFilter(event.target.value)
              }
            >
              <option value="all">All expiry states</option>
              <option value="valid">Valid</option>
              <option value="expiring">Expiring within 30 days</option>
              <option value="expired">Expired</option>
            </select>
          </div>
        </div>

        {!loading && !error && (
          <div className="results-bar">
            <span>
              Showing <strong>{filteredDocuments.length}</strong>{' '}
              of <strong>{documents.length}</strong> documents
            </span>

            {(search ||
              scopeFilter !== 'all' ||
              documentTypeFilter !== 'all' ||
              statusFilter !== 'all' ||
              verificationFilter !== 'all' ||
              expiryFilter !== 'all') && (
              <button
                className="clear-filters-button"
                onClick={() => {
                  setSearch('')
                  setScopeFilter('all')
                  setDocumentTypeFilter('all')
                  setStatusFilter('all')
                  setVerificationFilter('all')
                  setExpiryFilter('all')
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="page-state">
            <div className="loading-spinner" />
            <strong>Loading compliance records...</strong>
            <span>
              Fetching your organization's compliance data.
            </span>
          </div>
        ) : error ? (
          <div className="page-state">
            <div className="empty-state-icon">!</div>
            <strong>Compliance records could not be loaded</strong>
            <span>Check your connection and try again.</span>

            <button
              className="primary-button"
              onClick={loadDocuments}
            >
              Try again
            </button>
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="page-state">
            <div className="empty-state-icon">C</div>

            <strong>
              {documents.length === 0
                ? 'No compliance documents yet'
                : 'No matching compliance documents'}
            </strong>

            <span>
              {documents.length === 0
                ? 'Add your first compliance document to start monitoring regulatory requirements.'
                : 'Try changing your search or filter settings.'}
            </span>

            {documents.length === 0 && (
              <button
                className="primary-button"
                onClick={openCreateModal}
              >
                + Create document
              </button>
            )}
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table compliance-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Scope</th>
                  <th>Type</th>
                  <th>Verification</th>
                  <th>Expiry</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredDocuments.map((document) => {
                  const expiry = getExpiryState(document)

                  return (
                    <tr key={document.id}>
                      <td>
                        <div className="compliance-document-identity">
                          <div className="compliance-document-icon">
                            C
                          </div>

                          <div>
                            <div className="table-primary">
                              {document.name}
                            </div>

                            <div className="table-secondary">
                              {document.issuing_authority ||
                                'No issuing authority'}
                            </div>

                            {document.reference_number && (
                              <div className="table-tertiary">
                                Ref: {document.reference_number}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="compliance-scope">
                          <span>
                            {formatLabel(document.scope_type)}
                          </span>

                          <strong>
                            {getScopeName(document)}
                          </strong>
                        </div>
                      </td>

                      <td>
                        <span className="compliance-type-badge">
                          {formatLabel(document.document_type)}
                        </span>
                      </td>

                      <td>
                        <span
                          className={`verification-badge verification-${document.verification_status}`}
                        >
                          <span className="status-indicator" />
                          {formatLabel(
                            document.verification_status,
                          )}
                        </span>
                      </td>

                      <td>
                        <div className="compliance-expiry-cell">
                          <strong>
                            {document.expiry_date || 'No expiry'}
                          </strong>

                          <span className={expiry.className}>
                            {expiry.label}
                          </span>
                        </div>
                      </td>

                      <td>
                        <span
                          className={`worker-status-badge worker-status-${document.status}`}
                        >
                          <span className="status-indicator" />
                          {formatLabel(document.status)}
                        </span>
                      </td>

                      <td>
                        <div className="compliance-actions">
                          <button
                            className="asset-action-button asset-action-primary"
                            onClick={() =>
                              openViewModal(document)
                            }
                          >
                            View
                          </button>

                          <button
                            className="asset-action-button"
                            onClick={() =>
                              openEditModal(document)
                            }
                          >
                            Edit
                          </button>

                          {document.status === 'active' &&
                            document.expiry_date && (
                              <button
                                className="asset-action-button asset-action-success"
                                onClick={() =>
                                  openRenewModal(document)
                                }
                              >
                                Renew
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* CREATE / EDIT / RENEW MODAL */}
      {(modal === 'create' ||
        modal === 'edit' ||
        modal === 'renew') && (
        <div
          className="compliance-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeModal()
            }
          }}
        >
          <div
            className="compliance-modal"
            onMouseDown={(event) =>
              event.stopPropagation()
            }
          >
            <div className="compliance-modal-header">
              <div>
                <span className="eyebrow">
                  {modal === 'create'
                    ? 'NEW RECORD'
                    : modal === 'renew'
                      ? 'RENEWAL'
                      : 'EDIT RECORD'}
                </span>

                <h3>
                  {modal === 'create'
                    ? 'Add compliance document'
                    : modal === 'renew'
                      ? 'Renew compliance document'
                      : 'Edit compliance document'}
                </h3>

                <p>
                  {modal === 'create'
                    ? 'Add a new compliance record to your organization.'
                    : modal === 'renew'
                      ? 'Update the validity details for this compliance record.'
                      : 'Update the details and status of this compliance record.'}
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

            {formError && (
              <div className="form-error" role="alert">
                {formError}
              </div>
            )}

            <form
              className="asset-form"
              onSubmit={handleSubmit}
            >
              <div className="form-section">
                <div className="form-section-heading">
                  <strong>Document information</strong>
                  <span>
                    Core details about the compliance record.
                  </span>
                </div>

                <div className="form-grid">
                  <div className="form-group form-group-full">
                    <label htmlFor="compliance-name">
                      Document name
                    </label>

                    <input
                      id="compliance-name"
                      type="text"
                      value={form.name}
                      onChange={(event) =>
                        handleFormChange(
                          'name',
                          event.target.value,
                        )
                      }
                      placeholder="e.g. Annual Safety Certificate"
                      maxLength={255}
                      required
                      disabled={saving}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="compliance-type">
                      Document type
                    </label>

                    <select
                      id="compliance-type"
                      value={form.document_type}
                      onChange={(event) =>
                        handleFormChange(
                          'document_type',
                          event.target.value,
                        )
                      }
                      required
                      disabled={saving}
                    >
                      {documentTypeOptions.map((option) => (
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
                    <label htmlFor="compliance-authority">
                      Issuing authority
                    </label>

                    <input
                      id="compliance-authority"
                      type="text"
                      value={form.issuing_authority}
                      onChange={(event) =>
                        handleFormChange(
                          'issuing_authority',
                          event.target.value,
                        )
                      }
                      placeholder="e.g. DOSHS"
                      maxLength={255}
                      disabled={saving}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="compliance-reference">
                      Reference number
                    </label>

                    <input
                      id="compliance-reference"
                      type="text"
                      value={form.reference_number}
                      onChange={(event) =>
                        handleFormChange(
                          'reference_number',
                          event.target.value,
                        )
                      }
                      placeholder="Certificate or licence number"
                      maxLength={100}
                      disabled={saving}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="compliance-url">
                      Document URL
                    </label>

                    <input
                      id="compliance-url"
                      type="url"
                      value={form.document_url}
                      onChange={(event) =>
                        handleFormChange(
                          'document_url',
                          event.target.value,
                        )
                      }
                      placeholder="https://..."
                      disabled={saving}
                    />
                  </div>
                </div>
              </div>

              <div className="form-section">
                <div className="form-section-heading">
                  <strong>Compliance scope</strong>
                  <span>
                    Define what this document applies to.
                  </span>
                </div>

                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="compliance-scope">
                      Scope
                    </label>

                    <select
                      id="compliance-scope"
                      value={form.scope_type}
                      onChange={(event) =>
                        handleFormChange(
                          'scope_type',
                          event.target.value,
                        )
                      }
                      disabled={saving}
                    >
                      {scopeOptions
                        .filter(
                          (option) => option.value !== 'all',
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

                  {form.scope_type !== 'company' && (
                    <div className="form-group">
                      <label htmlFor="compliance-parent">
                        {formatLabel(form.scope_type)} ID
                      </label>

                      <input
                        id="compliance-parent"
                        type="number"
                        min="1"
                        value={form.parent_id}
                        onChange={(event) =>
                          handleFormChange(
                            'parent_id',
                            event.target.value,
                          )
                        }
                        placeholder={`Enter ${form.scope_type} ID`}
                        required
                        disabled={saving}
                      />

                      <small className="field-help">
                        The ID must belong to your company.
                      </small>
                    </div>
                  )}
                </div>
              </div>

              <div className="form-section">
                <div className="form-section-heading">
                  <strong>Dates & verification</strong>
                  <span>
                    Track validity and verification status.
                  </span>
                </div>

                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="compliance-issued">
                      Issued date
                    </label>

                    <input
                      id="compliance-issued"
                      type="date"
                      value={form.issued_date}
                      onChange={(event) =>
                        handleFormChange(
                          'issued_date',
                          event.target.value,
                        )
                      }
                      disabled={saving}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="compliance-expiry">
                      Expiry date
                    </label>

                    <input
                      id="compliance-expiry"
                      type="date"
                      value={form.expiry_date}
                      onChange={(event) =>
                        handleFormChange(
                          'expiry_date',
                          event.target.value,
                        )
                      }
                      disabled={saving}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="compliance-verification">
                      Verification status
                    </label>

                    <select
                      id="compliance-verification"
                      value={form.verification_status}
                      onChange={(event) =>
                        handleFormChange(
                          'verification_status',
                          event.target.value,
                        )
                      }
                      disabled={saving}
                    >
                      {verificationOptions.map((option) => (
                        <option
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {modal !== 'create' && (
                    <div className="form-group">
                      <label htmlFor="compliance-status">
                        Record status
                      </label>

                      <select
                        id="compliance-status"
                        value={form.status}
                        onChange={(event) =>
                          handleFormChange(
                            'status',
                            event.target.value,
                          )
                        }
                        disabled={saving}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {modal === 'renew' && (
                <div className="renewal-notice">
                  <div className="renewal-notice-icon">↻</div>

                  <div>
                    <strong>Renewal record</strong>

                    <span>
                      Update the issue and expiry dates for the
                      renewed compliance document. The existing
                      record will be updated rather than duplicated.
                    </span>
                  </div>
                </div>
              )}

              <div className="modal-footer">
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
                    : modal === 'create'
                      ? 'Create document'
                      : modal === 'renew'
                        ? 'Save renewal'
                        : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW MODAL */}
      {modal === 'view' && selectedDocument && (
        <div
          className="compliance-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeModal()
            }
          }}
        >
          <div
            className="compliance-modal compliance-view-modal"
            onMouseDown={(event) =>
              event.stopPropagation()
            }
          >
            <div className="compliance-modal-header">
              <div>
                <span className="eyebrow">
                  COMPLIANCE RECORD
                </span>

                <h3>{selectedDocument.name}</h3>

                <p>
                  Compliance record and verification details.
                </p>
              </div>

              <button
                className="modal-close-button"
                onClick={closeModal}
                disabled={actionLoading}
                aria-label="Close"
                type="button"
              >
                ×
              </button>
            </div>

            {formError && (
              <div className="form-error" role="alert">
                {formError}
              </div>
            )}

            <div className="compliance-detail-hero">
              <div className="compliance-detail-icon">
                C
              </div>

              <div>
                <strong>{selectedDocument.name}</strong>

                <span>
                  {formatLabel(
                    selectedDocument.document_type,
                  )}
                </span>
              </div>

              <div className="compliance-detail-statuses">
                <span
                  className={`verification-badge verification-${selectedDocument.verification_status}`}
                >
                  {formatLabel(
                    selectedDocument.verification_status,
                  )}
                </span>

                <span
                  className={`worker-status-badge worker-status-${selectedDocument.status}`}
                >
                  {formatLabel(selectedDocument.status)}
                </span>
              </div>
            </div>

            <div className="compliance-detail-grid">
              <AssetDetail
                label="Scope"
                value={formatLabel(
                  selectedDocument.scope_type,
                )}
              />

              <AssetDetail
                label="Applies to"
                value={getScopeName(selectedDocument)}
              />

              <AssetDetail
                label="Issuing authority"
                value={
                  selectedDocument.issuing_authority ||
                  'Not provided'
                }
              />

              <AssetDetail
                label="Reference number"
                value={
                  selectedDocument.reference_number ||
                  'Not provided'
                }
              />

              <AssetDetail
                label="Issued date"
                value={
                  selectedDocument.issued_date ||
                  'Not provided'
                }
              />

              <AssetDetail
                label="Expiry date"
                value={
                  selectedDocument.expiry_date ||
                  'No expiry'
                }
              />

              <AssetDetail
                label="Expiry status"
                value={
                  getExpiryState(selectedDocument).label
                }
              />

              <AssetDetail
                label="Created"
                value={
                  selectedDocument.created_at
                    ? new Date(
                        selectedDocument.created_at,
                      ).toLocaleString()
                    : 'Not available'
                }
              />
            </div>

            {selectedDocument.document_url && (
              <div className="document-link-card">
                <div>
                  <strong>Document reference</strong>

                  <span>
                    A supporting document is linked to this
                    compliance record.
                  </span>
                </div>

                <a
                  href={selectedDocument.document_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open document ↗
                </a>
              </div>
            )}

            <div className="modal-footer compliance-detail-footer">
              <div className="compliance-detail-actions">
                {selectedDocument.status === 'active' ? (
                  <button
                    type="button"
                    className="danger-button"
                    onClick={handleDeactivate}
                    disabled={actionLoading}
                  >
                    {actionLoading
                      ? 'Processing...'
                      : 'Deactivate'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="success-button"
                    onClick={handleReactivate}
                    disabled={actionLoading}
                  >
                    {actionLoading
                      ? 'Processing...'
                      : 'Reactivate'}
                  </button>
                )}
              </div>

              <div className="compliance-detail-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    openEditModal(selectedDocument)
                  }
                  disabled={actionLoading}
                >
                  Edit
                </button>

                {selectedDocument.status === 'active' &&
                  selectedDocument.expiry_date && (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() =>
                        openRenewModal(selectedDocument)
                      }
                      disabled={actionLoading}
                    >
                      Renew
                    </button>
                  )}
              </div>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

function AssetDetail({ label, value }) {
  return (
    <div className="asset-detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default Compliance
