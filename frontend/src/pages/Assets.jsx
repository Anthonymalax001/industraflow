import { useEffect, useMemo, useState } from 'react'
import AppLayout from '../layouts/AppLayout'

const API_BASE_URL = 'http://localhost:5000/api'

const statusOptions = [
  { value: 'all', label: 'All lifecycle statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

const operationalOptions = [
  { value: 'all', label: 'All operational statuses' },
  { value: 'available', label: 'Available' },
  { value: 'in_use', label: 'In use' },
  { value: 'under_maintenance', label: 'Under maintenance' },
  { value: 'out_of_service', label: 'Out of service' },
]

const assetTypeOptions = [
  { value: 'all', label: 'All asset types' },
  { value: 'heavy_equipment', label: 'Heavy equipment' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'power_tool', label: 'Power tool' },
  { value: 'generator', label: 'Generator' },
  { value: 'it_equipment', label: 'IT equipment' },
  { value: 'safety_equipment', label: 'Safety equipment' },
  { value: 'other', label: 'Other' },
]

const ownershipOptions = [
  { value: 'all', label: 'All ownership' },
  { value: 'owned', label: 'Owned' },
  { value: 'rented', label: 'Rented' },
  { value: 'leased', label: 'Leased' },
]

const initialForm = {
  name: '',
  asset_type: 'heavy_equipment',
  serial_number: '',
  asset_tag: '',
  location: '',
  project_id: '',
  supplier_id: '',
  ownership_type: 'owned',
  purchase_date: '',
  purchase_cost: '',
  rental_start_date: '',
  rental_end_date: '',
  rental_rate: '',
  last_maintenance_date: '',
  next_maintenance_date: '',
  operational_status: 'available',
  status: 'active',
}

function formatLabel(value) {
  if (!value) {
    return '—'
  }

  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDate(value) {
  if (!value) {
    return '—'
  }

  const date = new Date(`${value}T00:00:00`)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleDateString()
}

function Assets() {
  const [assets, setAssets] = useState([])
  const [count, setCount] = useState(0)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [operationalFilter, setOperationalFilter] = useState('all')
  const [assetTypeFilter, setAssetTypeFilter] = useState('all')
  const [ownershipFilter, setOwnershipFilter] = useState('all')

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [showLifecycleModal, setShowLifecycleModal] = useState(false)

  const [selectedAsset, setSelectedAsset] = useState(null)
  const [lifecycleAction, setLifecycleAction] = useState(null)

  const [form, setForm] = useState(initialForm)
  const [formError, setFormError] = useState('')

  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lifecycleLoading, setLifecycleLoading] = useState(false)

  const [successMessage, setSuccessMessage] = useState('')

  const loadAssets = async () => {
    try {
      setLoading(true)
      setError('')

      const token = localStorage.getItem('industrafow_token')

      if (!token) {
        throw new Error('Your session has expired. Please sign in again.')
      }

      const response = await fetch(`${API_BASE_URL}/assets`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          data.error || data.message || 'Unable to load assets.',
        )
      }

      const assetList = Array.isArray(data.assets)
        ? data.assets
        : []

      setAssets(assetList)
      setCount(Number(data.count) || assetList.length)
    } catch (err) {
      setError(err.message || 'Unable to load assets.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAssets()
  }, [])

  const filteredAssets = useMemo(() => {
    const searchValue = search.toLowerCase().trim()

    return assets.filter((asset) => {
      const name = String(asset.name || '').toLowerCase()
      const serialNumber = String(
        asset.serial_number || '',
      ).toLowerCase()
      const assetTag = String(
        asset.asset_tag || '',
      ).toLowerCase()
      const location = String(
        asset.location || '',
      ).toLowerCase()

      const matchesSearch =
        !searchValue ||
        name.includes(searchValue) ||
        serialNumber.includes(searchValue) ||
        assetTag.includes(searchValue) ||
        location.includes(searchValue)

      const matchesStatus =
        statusFilter === 'all' ||
        String(asset.status || '').toLowerCase() === statusFilter

      const matchesOperational =
        operationalFilter === 'all' ||
        String(asset.operational_status || '').toLowerCase() ===
          operationalFilter

      const matchesType =
        assetTypeFilter === 'all' ||
        String(asset.asset_type || '').toLowerCase() ===
          assetTypeFilter

      const matchesOwnership =
        ownershipFilter === 'all' ||
        String(asset.ownership_type || '').toLowerCase() ===
          ownershipFilter

      return (
        matchesSearch &&
        matchesStatus &&
        matchesOperational &&
        matchesType &&
        matchesOwnership
      )
    })
  }, [
    assets,
    search,
    statusFilter,
    operationalFilter,
    assetTypeFilter,
    ownershipFilter,
  ])

  const activeCount = assets.filter(
    (asset) => asset.status === 'active',
  ).length

  const maintenanceCount = assets.filter(
    (asset) =>
      asset.operational_status === 'under_maintenance',
  ).length

  const unassignedCount = assets.filter(
    (asset) => !asset.project_id,
  ).length

  const handleFormChange = (event) => {
    const { name, value } = event.target

    setForm((current) => ({
      ...current,
      [name]: value,
    }))

    setFormError('')
  }

  const closeCreateModal = () => {
    if (creating) {
      return
    }

    setShowCreateModal(false)
    setForm(initialForm)
    setFormError('')
  }

  const closeEditModal = () => {
    if (saving) {
      return
    }

    setShowEditModal(false)
    setSelectedAsset(null)
    setForm(initialForm)
    setFormError('')
  }

  const closeDetailsModal = () => {
    setShowDetailsModal(false)
    setSelectedAsset(null)
  }

  const closeLifecycleModal = () => {
    if (lifecycleLoading) {
      return
    }

    setShowLifecycleModal(false)
    setLifecycleAction(null)
    setSelectedAsset(null)
  }

  const validateForm = () => {
    if (!form.name.trim()) {
      return 'Asset name is required.'
    }

    if (
      (form.ownership_type === 'rented' ||
        form.ownership_type === 'leased') &&
      !form.supplier_id.trim()
    ) {
      return 'A supplier is required for rented or leased assets.'
    }

    if (
      form.rental_start_date &&
      form.rental_end_date &&
      form.rental_end_date < form.rental_start_date
    ) {
      return 'Rental end date cannot be earlier than the rental start date.'
    }

    if (
      form.last_maintenance_date &&
      form.next_maintenance_date &&
      form.next_maintenance_date < form.last_maintenance_date
    ) {
      return 'Next maintenance date cannot be earlier than the last maintenance date.'
    }

    return ''
  }

  const buildAssetBody = () => ({
    name: form.name.trim(),
    asset_type: form.asset_type,
    serial_number: form.serial_number.trim() || null,
    asset_tag: form.asset_tag.trim() || null,
    location: form.location.trim() || null,
    project_id: form.project_id
      ? Number(form.project_id)
      : null,
    supplier_id: form.supplier_id
      ? Number(form.supplier_id)
      : null,
    ownership_type: form.ownership_type,
    purchase_date: form.purchase_date || null,
    purchase_cost: form.purchase_cost
      ? Number(form.purchase_cost)
      : null,
    rental_start_date: form.rental_start_date || null,
    rental_end_date: form.rental_end_date || null,
    rental_rate: form.rental_rate
      ? Number(form.rental_rate)
      : null,
    last_maintenance_date:
      form.last_maintenance_date || null,
    next_maintenance_date:
      form.next_maintenance_date || null,
    operational_status: form.operational_status,
    status: form.status,
  })

  const handleCreateAsset = async (event) => {
    event.preventDefault()

    setFormError('')
    setSuccessMessage('')

    const validationError = validateForm()

    if (validationError) {
      setFormError(validationError)
      return
    }

    try {
      setCreating(true)

      const token = localStorage.getItem('industrafow_token')

      if (!token) {
        throw new Error('Your session has expired. Please sign in again.')
      }

      const response = await fetch(`${API_BASE_URL}/assets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(buildAssetBody()),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          data.error || data.message || 'Unable to create asset.',
        )
      }

      setShowCreateModal(false)
      setForm(initialForm)

      setSuccessMessage('Asset created successfully.')

      await loadAssets()
    } catch (err) {
      setFormError(
        err.message || 'Unable to create asset.',
      )
    } finally {
      setCreating(false)
    }
  }

  const openDetails = async (asset) => {
    setSuccessMessage('')

    try {
      const token = localStorage.getItem('industrafow_token')

      if (!token) {
        throw new Error('Your session has expired. Please sign in again.')
      }

      const response = await fetch(
        `${API_BASE_URL}/assets/${asset.id}`,
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
            'Unable to load asset details.',
        )
      }

      setSelectedAsset(data.asset || asset)
      setShowDetailsModal(true)
    } catch (err) {
      setError(
        err.message || 'Unable to load asset details.',
      )
    }
  }

  const openEdit = (asset) => {
    setSuccessMessage('')
    setFormError('')
    setSelectedAsset(asset)

    setForm({
      name: asset.name || '',
      asset_type: asset.asset_type || 'heavy_equipment',
      serial_number: asset.serial_number || '',
      asset_tag: asset.asset_tag || '',
      location: asset.location || '',
      project_id: asset.project_id
        ? String(asset.project_id)
        : '',
      supplier_id: asset.supplier_id
        ? String(asset.supplier_id)
        : '',
      ownership_type: asset.ownership_type || 'owned',
      purchase_date: asset.purchase_date || '',
      purchase_cost:
        asset.purchase_cost !== null &&
        asset.purchase_cost !== undefined
          ? String(asset.purchase_cost)
          : '',
      rental_start_date:
        asset.rental_start_date || '',
      rental_end_date:
        asset.rental_end_date || '',
      rental_rate:
        asset.rental_rate !== null &&
        asset.rental_rate !== undefined
          ? String(asset.rental_rate)
          : '',
      last_maintenance_date:
        asset.last_maintenance_date || '',
      next_maintenance_date:
        asset.next_maintenance_date || '',
      operational_status:
        asset.operational_status || 'available',
      status: asset.status || 'active',
    })

    setShowEditModal(true)
  }

  const handleUpdateAsset = async (event) => {
    event.preventDefault()

    setFormError('')
    setSuccessMessage('')

    const validationError = validateForm()

    if (validationError) {
      setFormError(validationError)
      return
    }

    if (!selectedAsset?.id) {
      setFormError('No asset was selected for editing.')
      return
    }

    try {
      setSaving(true)

      const token = localStorage.getItem('industrafow_token')

      if (!token) {
        throw new Error('Your session has expired. Please sign in again.')
      }

      const response = await fetch(
        `${API_BASE_URL}/assets/${selectedAsset.id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(buildAssetBody()),
        },
      )

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          data.error ||
            data.message ||
            'Unable to update asset.',
        )
      }

      setShowEditModal(false)
      setSelectedAsset(null)
      setForm(initialForm)

      setSuccessMessage(
        'Asset updated successfully.',
      )

      await loadAssets()
    } catch (err) {
      setFormError(
        err.message || 'Unable to update asset.',
      )
    } finally {
      setSaving(false)
    }
  }

  const openLifecycleConfirmation = (asset) => {
    setSuccessMessage('')
    setError('')
    setSelectedAsset(asset)

    setLifecycleAction(
      asset.status === 'active'
        ? 'deactivate'
        : 'reactivate',
    )

    setShowLifecycleModal(true)
  }

  const handleLifecycleAction = async () => {
    if (!selectedAsset?.id || !lifecycleAction) {
      return
    }

    try {
      setLifecycleLoading(true)
      setError('')
      setSuccessMessage('')

      const token = localStorage.getItem('industrafow_token')

      if (!token) {
        throw new Error('Your session has expired. Please sign in again.')
      }

      let response

      if (lifecycleAction === 'deactivate') {
        response = await fetch(
          `${API_BASE_URL}/assets/${selectedAsset.id}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        )
      } else {
        response = await fetch(
          `${API_BASE_URL}/assets/${selectedAsset.id}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              status: 'active',
            }),
          },
        )
      }

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          data.error ||
            data.message ||
            `Unable to ${
              lifecycleAction === 'deactivate'
                ? 'deactivate'
                : 'reactivate'
            } asset.`,
        )
      }

      const assetName =
        selectedAsset.name || 'Asset'

      setShowLifecycleModal(false)
      setLifecycleAction(null)
      setSelectedAsset(null)

      setSuccessMessage(
        lifecycleAction === 'deactivate'
          ? `${assetName} was deactivated successfully.`
          : `${assetName} was reactivated successfully.`,
      )

      await loadAssets()
    } catch (err) {
      setError(
        err.message ||
          `Unable to ${
            lifecycleAction === 'deactivate'
              ? 'deactivate'
              : 'reactivate'
          } asset.`,
      )
    } finally {
      setLifecycleLoading(false)
    }
  }

  const formatOperationalStatus = (status) => {
    if (status === 'available') {
      return 'Available'
    }

    if (status === 'in_use') {
      return 'In use'
    }

    if (status === 'under_maintenance') {
      return 'Maintenance'
    }

    if (status === 'out_of_service') {
      return 'Out of service'
    }

    return formatLabel(status)
  }

  const getMaintenanceState = (asset) => {
    if (asset.is_maintenance_overdue) {
      return {
        label: 'Overdue',
        className: 'maintenance-overdue',
      }
    }

    if (
      asset.days_until_maintenance !== null &&
      asset.days_until_maintenance !== undefined
    ) {
      const days = Number(asset.days_until_maintenance)

      if (!Number.isNaN(days) && days <= 30) {
        return {
          label: `${days} day${days === 1 ? '' : 's'}`,
          className: 'maintenance-soon',
        }
      }

      return {
        label: `${days} days`,
        className: 'maintenance-ok',
      }
    }

    if (asset.next_maintenance_date) {
      return {
        label: formatDate(asset.next_maintenance_date),
        className: 'maintenance-neutral',
      }
    }

    return {
      label: 'Not scheduled',
      className: 'maintenance-neutral',
    }
  }

  return (
    <AppLayout>
      <section className="page-header">
        <div>
          <span className="eyebrow">OPERATIONS</span>

          <h2>Assets</h2>

          <p>
            Manage equipment, vehicles, tools, generators, and other
            operational assets across your organization.
          </p>
        </div>

        <button
          className="primary-button"
          onClick={() => {
            setForm(initialForm)
            setFormError('')
            setSuccessMessage('')
            setShowCreateModal(true)
          }}
        >
          + New asset
        </button>
      </section>

      {successMessage && (
        <div className="asset-success-message" role="status">
          <span className="success-check">✓</span>

          <div>
            <strong>{successMessage}</strong>
            <span>The asset register has been updated.</span>
          </div>

          <button
            type="button"
            onClick={() => setSuccessMessage('')}
            aria-label="Dismiss success message"
          >
            ×
          </button>
        </div>
      )}

      <section className="asset-summary-grid">
        <div className="asset-summary-card">
          <span>TOTAL ASSETS</span>
          <strong>{loading ? '—' : count}</strong>
          <small>
            {loading
              ? 'Loading asset register'
              : 'Asset records'}
          </small>
        </div>

        <div className="asset-summary-card">
          <span>ACTIVE</span>
          <strong>{loading ? '—' : activeCount}</strong>
          <small>
            {loading
              ? 'Loading asset register'
              : 'Currently active'}
          </small>
        </div>

        <div className="asset-summary-card">
          <span>IN MAINTENANCE</span>
          <strong>{loading ? '—' : maintenanceCount}</strong>
          <small>
            {loading
              ? 'Loading asset register'
              : 'Under maintenance'}
          </small>
        </div>

        <div className="asset-summary-card">
          <span>UNASSIGNED</span>
          <strong>{loading ? '—' : unassignedCount}</strong>
          <small>
            {loading
              ? 'Loading asset register'
              : 'Not assigned to a project'}
          </small>
        </div>
      </section>

      {error && (
        <div className="dashboard-error" role="alert">
          <strong>Unable to process asset</strong>

          <span>{error}</span>

          <button
            className="retry-button"
            onClick={() => {
              setError('')
              loadAssets()
            }}
          >
            Try again
          </button>
        </div>
      )}

      <section className="content-card">
        <div className="content-toolbar assets-toolbar">
          <div className="search-wrapper">
            <input
              type="search"
              placeholder="Search assets, tags, serial numbers..."
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
            />
          </div>

          <div className="asset-filter-group">
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value)
              }
              aria-label="Filter assets by lifecycle status"
            >
              {statusOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={operationalFilter}
              onChange={(event) =>
                setOperationalFilter(event.target.value)
              }
              aria-label="Filter assets by operational status"
            >
              {operationalOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={assetTypeFilter}
              onChange={(event) =>
                setAssetTypeFilter(event.target.value)
              }
              aria-label="Filter assets by type"
            >
              {assetTypeOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={ownershipFilter}
              onChange={(event) =>
                setOwnershipFilter(event.target.value)
              }
              aria-label="Filter assets by ownership"
            >
              {ownershipOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!loading && !error && (
          <div className="results-bar">
            <span>
              Showing <strong>{filteredAssets.length}</strong> of{' '}
              <strong>{assets.length}</strong> assets
            </span>

            {(search ||
              statusFilter !== 'all' ||
              operationalFilter !== 'all' ||
              assetTypeFilter !== 'all' ||
              ownershipFilter !== 'all') && (
              <button
                className="clear-filters-button"
                onClick={() => {
                  setSearch('')
                  setStatusFilter('all')
                  setOperationalFilter('all')
                  setAssetTypeFilter('all')
                  setOwnershipFilter('all')
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

            <strong>Loading assets...</strong>

            <span>
              Fetching your organization's asset register.
            </span>
          </div>
        ) : error ? (
          <div className="page-state">
            <div className="empty-state-icon">!</div>

            <strong>Assets could not be loaded</strong>

            <span>
              Check your connection and try again.
            </span>

            <button
              className="primary-button"
              onClick={loadAssets}
            >
              Try again
            </button>
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="page-state">
            <div className="empty-state-icon">A</div>

            <strong>
              {assets.length === 0
                ? 'No assets yet'
                : 'No matching assets'}
            </strong>

            <span>
              {assets.length === 0
                ? 'Add your first asset to start managing your asset register.'
                : 'Try changing your search or filter settings.'}
            </span>

            {assets.length === 0 && (
              <button
                className="primary-button"
                onClick={() => {
                  setForm(initialForm)
                  setFormError('')
                  setShowCreateModal(true)
                }}
              >
                + Create asset
              </button>
            )}
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table assets-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Tag / Serial</th>
                  <th>Type</th>
                  <th>Ownership</th>
                  <th>Project</th>
                  <th>Operational</th>
                  <th>Maintenance</th>
                  <th>Lifecycle</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredAssets.map((asset) => {
                  const maintenance =
                    getMaintenanceState(asset)

                  return (
                    <tr key={asset.id}>
                      <td>
                        <div className="asset-table-identity">
                          <div className="asset-table-avatar">
                            {String(asset.name || 'A')
                              .charAt(0)
                              .toUpperCase()}
                          </div>

                          <div>
                            <div className="table-primary">
                              {asset.name || 'Unnamed asset'}
                            </div>

                            {asset.location && (
                              <div className="table-secondary">
                                {asset.location}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="asset-identifiers">
                          <strong>
                            {asset.asset_tag || 'No tag'}
                          </strong>

                          {asset.serial_number && (
                            <span>
                              {asset.serial_number}
                            </span>
                          )}
                        </div>
                      </td>

                      <td>
                        {formatLabel(asset.asset_type)}
                      </td>

                      <td>
                        <span className="ownership-badge">
                          {formatLabel(
                            asset.ownership_type,
                          )}
                        </span>
                      </td>

                      <td>
                        {asset.project_name || (
                          <span className="muted-value">
                            Unassigned
                          </span>
                        )}
                      </td>

                      <td>
                        <span
                          className={`asset-operational-badge asset-operational-${String(
                            asset.operational_status ||
                              'unknown',
                          ).toLowerCase()}`}
                        >
                          <span className="status-indicator" />

                          {formatOperationalStatus(
                            asset.operational_status,
                          )}
                        </span>
                      </td>

                      <td>
                        <span
                          className={`maintenance-badge ${maintenance.className}`}
                        >
                          {maintenance.label}
                        </span>
                      </td>

                      <td>
                        <span
                          className={`asset-lifecycle-badge asset-lifecycle-${String(
                            asset.status || 'unknown',
                          ).toLowerCase()}`}
                        >
                          {formatLabel(asset.status)}
                        </span>
                      </td>

                      <td>
                        <div className="asset-actions">
                          <button
                            type="button"
                            className="asset-action-button"
                            onClick={() => openDetails(asset)}
                          >
                            View
                          </button>

                          <button
                            type="button"
                            className="asset-action-button asset-action-primary"
                            onClick={() => openEdit(asset)}
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            className={`asset-action-button ${
                              asset.status === 'active'
                                ? 'asset-action-danger'
                                : 'asset-action-success'
                            }`}
                            onClick={() =>
                              openLifecycleConfirmation(asset)
                            }
                          >
                            {asset.status === 'active'
                              ? 'Deactivate'
                              : 'Reactivate'}
                          </button>
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

      {/* CREATE ASSET MODAL */}
      {showCreateModal && (
        <div
          className="asset-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeCreateModal()
            }
          }}
        >
          <div
            className="asset-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-asset-title"
          >
            <div className="asset-modal-header">
              <div>
                <span className="eyebrow">ASSET REGISTER</span>

                <h3 id="create-asset-title">
                  Create new asset
                </h3>

                <p>
                  Add equipment or operational property to your
                  organization's asset register.
                </p>
              </div>

              <button
                type="button"
                className="modal-close-button"
                onClick={closeCreateModal}
                disabled={creating}
                aria-label="Close create asset form"
              >
                ×
              </button>
            </div>

            <form
              className="asset-form"
              onSubmit={handleCreateAsset}
            >
              {formError && (
                <div className="asset-form-error" role="alert">
                  <strong>Unable to create asset</strong>
                  <span>{formError}</span>
                </div>
              )}

              <AssetFormFields
                form={form}
                handleFormChange={handleFormChange}
                disabled={creating}
              />

              <div className="asset-form-footer">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeCreateModal}
                  disabled={creating}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={creating}
                >
                  {creating
                    ? 'Creating asset...'
                    : 'Create asset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT ASSET MODAL */}
      {showEditModal && (
        <div
          className="asset-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeEditModal()
            }
          }}
        >
          <div
            className="asset-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-asset-title"
          >
            <div className="asset-modal-header">
              <div>
                <span className="eyebrow">ASSET REGISTER</span>

                <h3 id="edit-asset-title">
                  Edit asset
                </h3>

                <p>
                  Update asset information, deployment,
                  operational status, and maintenance details.
                </p>
              </div>

              <button
                type="button"
                className="modal-close-button"
                onClick={closeEditModal}
                disabled={saving}
                aria-label="Close edit asset form"
              >
                ×
              </button>
            </div>

            <form
              className="asset-form"
              onSubmit={handleUpdateAsset}
            >
              {formError && (
                <div className="asset-form-error" role="alert">
                  <strong>Unable to update asset</strong>
                  <span>{formError}</span>
                </div>
              )}

              <AssetFormFields
                form={form}
                handleFormChange={handleFormChange}
                disabled={saving}
                editing
              />

              <div className="asset-form-footer">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeEditModal}
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
                    ? 'Saving changes...'
                    : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DETAILS MODAL */}
      {showDetailsModal && selectedAsset && (
        <div
          className="asset-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDetailsModal()
            }
          }}
        >
          <div
            className="asset-modal asset-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-details-title"
          >
            <div className="asset-modal-header">
              <div>
                <span className="eyebrow">ASSET DETAILS</span>

                <h3 id="asset-details-title">
                  {selectedAsset.name || 'Asset'}
                </h3>

                <p>
                  Complete operational information for this asset.
                </p>
              </div>

              <button
                type="button"
                className="modal-close-button"
                onClick={closeDetailsModal}
                aria-label="Close asset details"
              >
                ×
              </button>
            </div>

            <div className="asset-details-body">
              <div className="asset-details-hero">
                <div className="asset-details-avatar">
                  {String(
                    selectedAsset.name || 'A',
                  )
                    .charAt(0)
                    .toUpperCase()}
                </div>

                <div>
                  <h4>
                    {selectedAsset.name || 'Unnamed asset'}
                  </h4>

                  <p>
                    {selectedAsset.asset_tag ||
                      'No asset tag'}
                  </p>
                </div>

                <div className="asset-details-statuses">
                  <span
                    className={`asset-lifecycle-badge asset-lifecycle-${String(
                      selectedAsset.status || 'unknown',
                    ).toLowerCase()}`}
                  >
                    {formatLabel(selectedAsset.status)}
                  </span>

                  <span
                    className={`asset-operational-badge asset-operational-${String(
                      selectedAsset.operational_status ||
                        'unknown',
                    ).toLowerCase()}`}
                  >
                    <span className="status-indicator" />

                    {formatOperationalStatus(
                      selectedAsset.operational_status,
                    )}
                  </span>
                </div>
              </div>

              <div className="asset-details-grid">
                <AssetDetail
                  label="Asset type"
                  value={formatLabel(
                    selectedAsset.asset_type,
                  )}
                />

                <AssetDetail
                  label="Ownership"
                  value={formatLabel(
                    selectedAsset.ownership_type,
                  )}
                />

                <AssetDetail
                  label="Serial number"
                  value={
                    selectedAsset.serial_number || 'Not recorded'
                  }
                />

                <AssetDetail
                  label="Asset tag"
                  value={
                    selectedAsset.asset_tag || 'Not recorded'
                  }
                />

                <AssetDetail
                  label="Current location"
                  value={
                    selectedAsset.location || 'Not specified'
                  }
                />

                <AssetDetail
                  label="Project"
                  value={
                    selectedAsset.project_name ||
                    'Unassigned'
                  }
                />

                <AssetDetail
                  label="Supplier"
                  value={
                    selectedAsset.supplier_name ||
                    'Not specified'
                  }
                />

                <AssetDetail
                  label="Purchase date"
                  value={formatDate(
                    selectedAsset.purchase_date,
                  )}
                />

                <AssetDetail
                  label="Purchase cost"
                  value={
                    selectedAsset.purchase_cost !== null &&
                    selectedAsset.purchase_cost !== undefined
                      ? selectedAsset.purchase_cost
                      : 'Not recorded'
                  }
                />

                <AssetDetail
                  label="Rental start"
                  value={formatDate(
                    selectedAsset.rental_start_date,
                  )}
                />

                <AssetDetail
                  label="Rental end"
                  value={formatDate(
                    selectedAsset.rental_end_date,
                  )}
                />

                <AssetDetail
                  label="Rental rate"
                  value={
                    selectedAsset.rental_rate !== null &&
                    selectedAsset.rental_rate !== undefined
                      ? selectedAsset.rental_rate
                      : 'Not recorded'
                  }
                />

                <AssetDetail
                  label="Last maintenance"
                  value={formatDate(
                    selectedAsset.last_maintenance_date,
                  )}
                />

                <AssetDetail
                  label="Next maintenance"
                  value={formatDate(
                    selectedAsset.next_maintenance_date,
                  )}
                />

                <AssetDetail
                  label="Maintenance status"
                  value={
                    selectedAsset.is_maintenance_overdue
                      ? 'Overdue'
                      : selectedAsset.days_until_maintenance !==
                          null &&
                        selectedAsset.days_until_maintenance !==
                          undefined
                        ? `${selectedAsset.days_until_maintenance} days remaining`
                        : 'Not scheduled'
                  }
                />

                <AssetDetail
                  label="Asset ID"
                  value={selectedAsset.id}
                />
              </div>

              <div className="asset-details-footer">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeDetailsModal}
                >
                  Close
                </button>

                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    closeDetailsModal()
                    openEdit(selectedAsset)
                  }}
                >
                  Edit asset
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LIFECYCLE CONFIRMATION MODAL */}
      {showLifecycleModal && selectedAsset && lifecycleAction && (
        <div
          className="asset-modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !lifecycleLoading
            ) {
              closeLifecycleModal()
            }
          }}
        >
          <div
            className="asset-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-lifecycle-title"
          >
            <div className="asset-modal-header">
              <div>
                <span className="eyebrow">
                  ASSET LIFECYCLE
                </span>

                <h3 id="asset-lifecycle-title">
                  {lifecycleAction === 'deactivate'
                    ? 'Deactivate asset'
                    : 'Reactivate asset'}
                </h3>

                <p>
                  {lifecycleAction === 'deactivate'
                    ? 'This will mark the asset as inactive while preserving its record and operational history.'
                    : 'This will return the asset to the active asset register.'}
                </p>
              </div>

              <button
                type="button"
                className="modal-close-button"
                onClick={closeLifecycleModal}
                disabled={lifecycleLoading}
                aria-label="Close lifecycle confirmation"
              >
                ×
              </button>
            </div>

            <div className="asset-form">
              <div className="asset-lifecycle-confirmation">
                <div
                  className={`asset-lifecycle-confirmation-icon ${
                    lifecycleAction === 'deactivate'
                      ? 'asset-lifecycle-confirmation-danger'
                      : 'asset-lifecycle-confirmation-success'
                  }`}
                >
                  {lifecycleAction === 'deactivate'
                    ? '!'
                    : '✓'}
                </div>

                <div className="asset-lifecycle-confirmation-content">
                  <strong>
                    {selectedAsset.name || 'This asset'}
                  </strong>

                  <span>
                    {selectedAsset.asset_tag
                      ? `Asset tag: ${selectedAsset.asset_tag}`
                      : 'No asset tag assigned'}
                  </span>

                  <p>
                    {lifecycleAction === 'deactivate'
                      ? 'The asset will remain in your register and can be reactivated later.'
                      : 'The asset will become active again and remain available in your register.'}
                  </p>
                </div>
              </div>

              <div className="asset-form-footer">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeLifecycleModal}
                  disabled={lifecycleLoading}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className={
                    lifecycleAction === 'deactivate'
                      ? 'danger-button'
                      : 'success-button'
                  }
                  onClick={handleLifecycleAction}
                  disabled={lifecycleLoading}
                >
                  {lifecycleLoading
                    ? lifecycleAction === 'deactivate'
                      ? 'Deactivating...'
                      : 'Reactivating...'
                    : lifecycleAction === 'deactivate'
                      ? 'Deactivate asset'
                      : 'Reactivate asset'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

function AssetFormFields({
  form,
  handleFormChange,
  disabled,
  editing = false,
}) {
  return (
    <>
      <div className="asset-form-section">
        <div className="asset-form-section-title">
          Asset information
        </div>

        <div className="asset-form-grid">
          <div className="asset-form-group asset-form-full">
            <label htmlFor={`${editing ? 'edit' : 'create'}-asset-name`}>
              Asset name <span>*</span>
            </label>

            <input
              id={`${editing ? 'edit' : 'create'}-asset-name`}
              name="name"
              value={form.name}
              onChange={handleFormChange}
              placeholder="e.g. Caterpillar Excavator 320"
              maxLength={255}
              required
              disabled={disabled}
            />
          </div>

          <div className="asset-form-group">
            <label htmlFor={`${editing ? 'edit' : 'create'}-asset-type`}>
              Asset type
            </label>

            <select
              id={`${editing ? 'edit' : 'create'}-asset-type`}
              name="asset_type"
              value={form.asset_type}
              onChange={handleFormChange}
              disabled={disabled}
            >
              {assetTypeOptions
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

          <div className="asset-form-group">
            <label htmlFor={`${editing ? 'edit' : 'create'}-asset-ownership`}>
              Ownership
            </label>

            <select
              id={`${editing ? 'edit' : 'create'}-asset-ownership`}
              name="ownership_type"
              value={form.ownership_type}
              onChange={handleFormChange}
              disabled={disabled}
            >
              <option value="owned">Owned</option>
              <option value="rented">Rented</option>
              <option value="leased">Leased</option>
            </select>
          </div>

          <div className="asset-form-group">
            <label htmlFor={`${editing ? 'edit' : 'create'}-asset-tag`}>
              Asset tag
            </label>

            <input
              id={`${editing ? 'edit' : 'create'}-asset-tag`}
              name="asset_tag"
              value={form.asset_tag}
              onChange={handleFormChange}
              placeholder="e.g. AST-001"
              maxLength={50}
              disabled={disabled}
            />
          </div>

          <div className="asset-form-group">
            <label htmlFor={`${editing ? 'edit' : 'create'}-asset-serial`}>
              Serial number
            </label>

            <input
              id={`${editing ? 'edit' : 'create'}-asset-serial`}
              name="serial_number"
              value={form.serial_number}
              onChange={handleFormChange}
              placeholder="Manufacturer serial number"
              maxLength={255}
              disabled={disabled}
            />
          </div>

          <div className="asset-form-group asset-form-full">
            <label htmlFor={`${editing ? 'edit' : 'create'}-asset-location`}>
              Current location
            </label>

            <input
              id={`${editing ? 'edit' : 'create'}-asset-location`}
              name="location"
              value={form.location}
              onChange={handleFormChange}
              placeholder="e.g. Nairobi Yard / Project Site A"
              maxLength={255}
              disabled={disabled}
            />
          </div>
        </div>
      </div>

      <div className="asset-form-section">
        <div className="asset-form-section-title">
          Deployment & status
        </div>

        <div className="asset-form-grid">
          <div className="asset-form-group">
            <label htmlFor={`${editing ? 'edit' : 'create'}-asset-project`}>
              Project ID
            </label>

            <input
              id={`${editing ? 'edit' : 'create'}-asset-project`}
              name="project_id"
              type="number"
              min="1"
              value={form.project_id}
              onChange={handleFormChange}
              placeholder="Optional"
              disabled={disabled}
            />

            <small>
              Leave blank if the asset is currently
              unassigned.
            </small>
          </div>

          <div className="asset-form-group">
            <label htmlFor={`${editing ? 'edit' : 'create'}-asset-operational-status`}>
              Operational status
            </label>

            <select
              id={`${editing ? 'edit' : 'create'}-asset-operational-status`}
              name="operational_status"
              value={form.operational_status}
              onChange={handleFormChange}
              disabled={disabled}
            >
              <option value="available">
                Available
              </option>

              <option value="in_use">
                In use
              </option>

              <option value="under_maintenance">
                Under maintenance
              </option>

              <option value="out_of_service">
                Out of service
              </option>
            </select>
          </div>

          {editing && (
            <div className="asset-form-group">
              <label htmlFor="edit-asset-status">
                Lifecycle status
              </label>

              <select
                id="edit-asset-status"
                name="status"
                value={form.status}
                onChange={handleFormChange}
                disabled={disabled}
              >
                <option value="active">
                  Active
                </option>

                <option value="inactive">
                  Inactive
                </option>
              </select>
            </div>
          )}

          {(form.ownership_type === 'rented' ||
            form.ownership_type === 'leased') && (
            <>
              <div className="asset-form-group">
                <label htmlFor={`${editing ? 'edit' : 'create'}-asset-supplier`}>
                  Supplier ID <span>*</span>
                </label>

                <input
                  id={`${editing ? 'edit' : 'create'}-asset-supplier`}
                  name="supplier_id"
                  type="number"
                  min="1"
                  value={form.supplier_id}
                  onChange={handleFormChange}
                  placeholder="Supplier ID"
                  disabled={disabled}
                />
              </div>

              <div className="asset-form-group">
                <label htmlFor={`${editing ? 'edit' : 'create'}-asset-rental-rate`}>
                  Rental rate
                </label>

                <input
                  id={`${editing ? 'edit' : 'create'}-asset-rental-rate`}
                  name="rental_rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.rental_rate}
                  onChange={handleFormChange}
                  placeholder="0.00"
                  disabled={disabled}
                />
              </div>

              <div className="asset-form-group">
                <label htmlFor={`${editing ? 'edit' : 'create'}-asset-rental-start`}>
                  Rental start date
                </label>

                <input
                  id={`${editing ? 'edit' : 'create'}-asset-rental-start`}
                  name="rental_start_date"
                  type="date"
                  value={form.rental_start_date}
                  onChange={handleFormChange}
                  disabled={disabled}
                />
              </div>

              <div className="asset-form-group">
                <label htmlFor={`${editing ? 'edit' : 'create'}-asset-rental-end`}>
                  Rental end date
                </label>

                <input
                  id={`${editing ? 'edit' : 'create'}-asset-rental-end`}
                  name="rental_end_date"
                  type="date"
                  value={form.rental_end_date}
                  onChange={handleFormChange}
                  disabled={disabled}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {form.ownership_type === 'owned' && (
        <div className="asset-form-section">
          <div className="asset-form-section-title">
            Purchase information
          </div>

          <div className="asset-form-grid">
            <div className="asset-form-group">
              <label htmlFor={`${editing ? 'edit' : 'create'}-asset-purchase-date`}>
                Purchase date
              </label>

              <input
                id={`${editing ? 'edit' : 'create'}-asset-purchase-date`}
                name="purchase_date"
                type="date"
                value={form.purchase_date}
                onChange={handleFormChange}
                disabled={disabled}
              />
            </div>

            <div className="asset-form-group">
              <label htmlFor={`${editing ? 'edit' : 'create'}-asset-purchase-cost`}>
                Purchase cost
              </label>

              <input
                id={`${editing ? 'edit' : 'create'}-asset-purchase-cost`}
                name="purchase_cost"
                type="number"
                min="0"
                step="0.01"
                value={form.purchase_cost}
                onChange={handleFormChange}
                placeholder="0.00"
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      )}

      <div className="asset-form-section">
        <div className="asset-form-section-title">
          Maintenance schedule
        </div>

        <div className="asset-form-grid">
          <div className="asset-form-group">
            <label htmlFor={`${editing ? 'edit' : 'create'}-asset-last-maintenance`}>
              Last maintenance date
            </label>

            <input
              id={`${editing ? 'edit' : 'create'}-asset-last-maintenance`}
              name="last_maintenance_date"
              type="date"
              value={form.last_maintenance_date}
              onChange={handleFormChange}
              disabled={disabled}
            />
          </div>

          <div className="asset-form-group">
            <label htmlFor={`${editing ? 'edit' : 'create'}-asset-next-maintenance`}>
              Next maintenance date
            </label>

            <input
              id={`${editing ? 'edit' : 'create'}-asset-next-maintenance`}
              name="next_maintenance_date"
              type="date"
              value={form.next_maintenance_date}
              onChange={handleFormChange}
              disabled={disabled}
            />
          </div>
        </div>
      </div>
    </>
  )
}

function AssetDetail({ label, value }) {
  return (
    <div className="asset-detail-item">
      <span>{label}</span>
      <strong>{value || '—'}</strong>
    </div>
  )
}

export default Assets

