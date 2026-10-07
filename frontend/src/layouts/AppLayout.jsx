import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'

const API_BASE_URL = 'https://industraflow.onrender.com/api'

const navigation = [
  { label: 'Dashboard', icon: '⌂', path: '/' },
  { label: 'Projects', icon: '▦', path: '/projects' },
  { label: 'Workers', icon: '◉', path: '/workers' },
  { label: 'Contractors', icon: '◈', path: '/contractors' },
  { label: 'Suppliers', icon: '◇', path: '/suppliers' },
  { label: 'Assets', icon: '▣', path: '/assets' },
  { label: 'Compliance', icon: '✓', path: '/compliance' },
  { label: 'Incidents', icon: '⚠', path: '/incidents' },
  { label: 'Work Permits', icon: '◫', path: '/work-permits' },
  { label: 'Reports', icon: '▤', path: '/reports' },
]

function getStoredUser() {
  try {
    const storedUser = localStorage.getItem('industrafow_user')

    if (!storedUser) {
      return null
    }

    return JSON.parse(storedUser)
  } catch {
    return null
  }
}

function getUserDisplayName(user) {
  return (
    user?.name ||
    user?.full_name ||
    user?.fullName ||
    user?.email ||
    'User Account'
  )
}

function getUserRole(user) {
  return (
    user?.role ||
    user?.job_title ||
    user?.jobTitle ||
    'Administrator'
  )
}

function formatNotificationTime(value) {
  if (!value) return ''

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60000)

  if (diffMinutes < 1) {
    return 'Just now'
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`
  }

  const diffHours = Math.floor(diffMinutes / 60)

  if (diffHours < 24) {
    return `${diffHours}h ago`
  }

  const diffDays = Math.floor(diffHours / 24)

  if (diffDays < 7) {
    return `${diffDays}d ago`
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

function formatNotificationType(type) {
  if (!type) return 'Notification'

  return String(type)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getNotificationIcon(notification) {
  const type = String(
    notification?.type || ''
  ).toLowerCase()

  const relatedModel = String(
    notification?.related_model || ''
  ).toLowerCase()

  if (
    type.includes('incident') ||
    relatedModel.includes('incident')
  ) {
    return '⚠'
  }

  if (
    type.includes('permit') ||
    relatedModel.includes('permit')
  ) {
    return '◫'
  }

  if (
    type.includes('asset') ||
    relatedModel.includes('asset')
  ) {
    return '▣'
  }

  if (
    type.includes('worker') ||
    relatedModel.includes('worker')
  ) {
    return '◉'
  }

  if (
    type.includes('compliance') ||
    relatedModel.includes('compliance')
  ) {
    return '✓'
  }

  return '●'
}

function getNotificationPriorityClass(priority) {
  switch (String(priority || '').toLowerCase()) {
    case 'high':
    case 'urgent':
    case 'critical':
      return 'notification-priority-high'

    case 'medium':
      return 'notification-priority-medium'

    default:
      return 'notification-priority-normal'
  }
}

function AppLayout({ children }) {
  const { logout } = useAuth()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const [notificationOpen, setNotificationOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationActionId, setNotificationActionId] = useState(null)
  const [notificationError, setNotificationError] = useState('')

  const [logoutLoading, setLogoutLoading] = useState(false)
  const [storedUser, setStoredUser] = useState(getStoredUser)

  const currentPath = window.location.pathname
  const token = localStorage.getItem('industrafow_token')

  const userName = getUserDisplayName(storedUser)
  const userRole = getUserRole(storedUser)

  const userInitial =
    userName
      .trim()
      .charAt(0)
      .toUpperCase() || 'U'

  useEffect(() => {
    const syncUser = () => {
      setStoredUser(getStoredUser())
    }

    window.addEventListener('storage', syncUser)

    return () => {
      window.removeEventListener('storage', syncUser)
    }
  }, [])

  const notificationRequest = async (
    endpoint,
    options = {}
  ) => {
    const response = await fetch(
      `${API_BASE_URL}${endpoint}`,
      {
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
      }
    )

    const data = await response
      .json()
      .catch(() => ({}))

    if (!response.ok) {
      throw new Error(
        data.message ||
          data.error ||
          'Notification request failed'
      )
    }

    return data
  }

  const loadUnreadCount = async () => {
    try {
      const data = await notificationRequest(
        '/notifications/count'
      )

      setUnreadCount(
        Number(data.unread_count) || 0
      )
    } catch (error) {
      console.error(
        'Unable to load notification count:',
        error
      )
    }
  }

  const loadNotifications = async () => {
    try {
      setNotificationsLoading(true)
      setNotificationError('')

      const data = await notificationRequest(
        '/notifications?limit=20&page=1'
      )

      setNotifications(
        Array.isArray(data.items)
          ? data.items
          : []
      )

      if (
        data?.pagination &&
        typeof data.pagination.total === 'number'
      ) {
        // Count endpoint remains the source of truth
        // for unread badge.
        await loadUnreadCount()
      }
    } catch (error) {
      setNotificationError(
        error.message ||
          'Unable to load notifications.'
      )
    } finally {
      setNotificationsLoading(false)
    }
  }

  useEffect(() => {
    if (!token) {
      setUnreadCount(0)
      return
    }

    loadUnreadCount()

    const interval = window.setInterval(
      () => {
        loadUnreadCount()
      },
      30000
    )

    return () => {
      window.clearInterval(interval)
    }
  }, [token])

  const toggleNotifications = async () => {
    setUserMenuOpen(false)

    if (notificationOpen) {
      setNotificationOpen(false)
      return
    }

    setNotificationOpen(true)

    await loadNotifications()
  }

  const markNotificationRead = async (
    notification
  ) => {
    if (
      !notification?.id ||
      notification.read_at
    ) {
      return
    }

    try {
      setNotificationActionId(notification.id)

      const updated = await notificationRequest(
        `/notifications/${notification.id}/read`,
        {
          method: 'PATCH',
        }
      )

      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id
            ? updated
            : item
        )
      )

      setUnreadCount((current) =>
        Math.max(0, current - 1)
      )
    } catch (error) {
      setNotificationError(
        error.message ||
          'Unable to mark notification as read.'
      )
    } finally {
      setNotificationActionId(null)
    }
  }

  const dismissNotification = async (
    notification
  ) => {
    if (!notification?.id) {
      return
    }

    try {
      setNotificationActionId(notification.id)

      await notificationRequest(
        `/notifications/${notification.id}/dismiss`,
        {
          method: 'PATCH',
        }
      )

      setNotifications((current) =>
        current.filter(
          (item) => item.id !== notification.id
        )
      )

      if (!notification.read_at) {
        setUnreadCount((current) =>
          Math.max(0, current - 1)
        )
      }
    } catch (error) {
      setNotificationError(
        error.message ||
          'Unable to dismiss notification.'
      )
    } finally {
      setNotificationActionId(null)
    }
  }

  const handleNavigation = (path) => {
    setSidebarOpen(false)
    setUserMenuOpen(false)
    setNotificationOpen(false)

    if (path === currentPath) {
      return
    }

    window.location.href = path
  }

  const openSettings = () => {
    setSidebarOpen(false)
    setUserMenuOpen(false)
    setNotificationOpen(false)
    setSettingsOpen(true)
  }

  const closeSettings = () => {
    if (logoutLoading) {
      return
    }

    setSettingsOpen(false)
  }

  const handleLogout = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to log out of IndustraFlow?'
    )

    if (!confirmed) {
      return
    }

    try {
      setLogoutLoading(true)

      await logout()

      localStorage.removeItem(
        'industrafow_token'
      )

      localStorage.removeItem(
        'industrafow_user'
      )

      window.location.href = '/'
    } catch (error) {
      console.error(
        'Logout failed:',
        error
      )

      localStorage.removeItem(
        'industrafow_token'
      )

      localStorage.removeItem(
        'industrafow_user'
      )

      window.location.href = '/'
    } finally {
      setLogoutLoading(false)
    }
  }

  const currentPage =
    navigation.find(
      (item) => item.path === currentPath
    )?.label || 'Dashboard'

  return (
    <div className="app-shell">

      <aside
        className={`sidebar ${
          sidebarOpen ? 'sidebar-open' : ''
        }`}
      >
        <div className="brand">
          <div className="brand-mark">I</div>

          <div>
            <div className="brand-name">
              IndustraFlow
            </div>

            <div className="brand-subtitle">
              Operations Platform
            </div>
          </div>
        </div>

        <nav className="navigation">

          <div className="nav-section-title">
            WORKSPACE
          </div>

          {navigation.map((item) => {
            const isActive =
              item.path === currentPath ||
              (item.path === '/' &&
                currentPath === '/')

            return (
              <button
                key={item.label}
                type="button"
                className={`nav-item ${
                  isActive ? 'active' : ''
                }`}
                onClick={() =>
                  handleNavigation(item.path)
                }
              >
                <span className="nav-icon">
                  {item.icon}
                </span>

                <span>{item.label}</span>
              </button>
            )
          })}

          <div className="nav-section-title settings-title">
            SYSTEM
          </div>

          <button
            type="button"
            className="nav-item"
            onClick={openSettings}
          >
            <span className="nav-icon">
              ⚙
            </span>

            <span>Settings</span>
          </button>

        </nav>

        <div className="sidebar-footer">
          <div className="company-card">

            <div className="company-avatar">
              C
            </div>

            <div className="company-info">
              <strong>Your Company</strong>
              <span>Business account</span>
            </div>

          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-overlay"
          aria-label="Close navigation"
          onClick={() =>
            setSidebarOpen(false)
          }
        />
      )}

      <div className="main-shell">

        <header className="topbar">

          <button
            type="button"
            className="mobile-menu"
            onClick={() =>
              setSidebarOpen(true)
            }
            aria-label="Open navigation"
          >
            ☰
          </button>

          <div className="page-heading">
            <span className="breadcrumb">
              Workspace
            </span>

            <h1>{currentPage}</h1>
          </div>

          <div className="topbar-actions">

            <div className="notification-wrapper">

              <button
                type="button"
                className={`notification-button ${
                  notificationOpen
                    ? 'notification-button-active'
                    : ''
                }`}
                aria-label="Notifications"
                aria-expanded={
                  notificationOpen
                }
                onClick={
                  toggleNotifications
                }
              >
                🔔

                {unreadCount > 0 && (
                  <span className="notification-count">
                    {unreadCount > 99
                      ? '99+'
                      : unreadCount}
                  </span>
                )}
              </button>

              {notificationOpen && (
                <>
                  <button
                    type="button"
                    className="notification-menu-dismiss"
                    aria-label="Close notifications"
                    onClick={() =>
                      setNotificationOpen(false)
                    }
                  />

                  <div className="notification-dropdown">

                    <div className="notification-dropdown-header">

                      <div>
                        <span className="eyebrow">
                          ACTIVITY
                        </span>

                        <h3>
                          Notifications
                        </h3>
                      </div>

                      <div className="notification-header-count">
                        {unreadCount > 0
                          ? `${unreadCount} unread`
                          : 'All caught up'}
                      </div>

                    </div>

                    {notificationError && (
                      <div className="notification-error">
                        {notificationError}
                      </div>
                    )}

                    {notificationsLoading ? (
                      <div className="notification-loading">
                        <div className="loading-spinner" />

                        <span>
                          Loading notifications...
                        </span>
                      </div>
                    ) : notifications.length === 0 ? (
                      <div className="notification-empty">
                        <div className="notification-empty-icon">
                          ✓
                        </div>

                        <strong>
                          You're all caught up
                        </strong>

                        <span>
                          New operational notifications
                          will appear here.
                        </span>
                      </div>
                    ) : (
                      <div className="notification-list">

                        {notifications.map(
                          (notification) => (
                            <div
                              key={notification.id}
                              className={`notification-item ${
                                notification.read_at
                                  ? ''
                                  : 'notification-item-unread'
                              }`}
                            >

                              <button
                                type="button"
                                className={`notification-icon ${getNotificationPriorityClass(
                                  notification.priority
                                )}`}
                                onClick={() =>
                                  markNotificationRead(
                                    notification
                                  )
                                }
                                aria-label={
                                  notification.read_at
                                    ? 'Notification already read'
                                    : 'Mark notification as read'
                                }
                              >
                                {getNotificationIcon(
                                  notification
                                )}
                              </button>

                              <div className="notification-content">

                                <div className="notification-item-top">
                                  <span>
                                    {formatNotificationType(
                                      notification.type
                                    )}
                                  </span>

                                  <small>
                                    {formatNotificationTime(
                                      notification.created_at
                                    )}
                                  </small>
                                </div>

                                <strong>
                                  {notification.subject ||
                                    'Notification'}
                                </strong>

                                <p>
                                  {notification.message ||
                                    'No additional details available.'}
                                </p>

                                {notification.read_at ===
                                  null && (
                                  <button
                                    type="button"
                                    className="notification-read-button"
                                    onClick={() =>
                                      markNotificationRead(
                                        notification
                                      )
                                    }
                                    disabled={
                                      notificationActionId ===
                                      notification.id
                                    }
                                  >
                                    {notificationActionId ===
                                    notification.id
                                      ? 'Updating...'
                                      : 'Mark as read'}
                                  </button>
                                )}

                              </div>

                              <button
                                type="button"
                                className="notification-dismiss-button"
                                onClick={() =>
                                  dismissNotification(
                                    notification
                                  )
                                }
                                disabled={
                                  notificationActionId ===
                                  notification.id
                                }
                                aria-label="Dismiss notification"
                              >
                                ×
                              </button>

                            </div>
                          )
                        )}

                      </div>
                    )}

                    <div className="notification-dropdown-footer">
                      <span>
                        Showing your latest notifications
                      </span>
                    </div>

                  </div>
                </>
              )}

            </div>

            <div className="user-menu-wrapper">

              <button
                type="button"
                className="user-menu"
                onClick={() => {
                  setNotificationOpen(false)

                  setUserMenuOpen(
                    (current) => !current
                  )
                }}
                aria-expanded={
                  userMenuOpen
                }
                aria-label="Open user menu"
              >
                <div className="user-avatar">
                  {userInitial}
                </div>

                <div className="user-details">
                  <strong>{userName}</strong>
                  <span>{userRole}</span>
                </div>

                <span className="user-chevron">
                  {userMenuOpen
                    ? '⌃'
                    : '⌄'}
                </span>
              </button>

              {userMenuOpen && (
                <>
                  <button
                    type="button"
                    className="user-menu-dismiss"
                    aria-label="Close user menu"
                    onClick={() =>
                      setUserMenuOpen(false)
                    }
                  />

                  <div className="user-dropdown">

                    <div className="user-dropdown-header">

                      <div className="user-dropdown-avatar">
                        {userInitial}
                      </div>

                      <div>
                        <strong>
                          {userName}
                        </strong>

                        <span>
                          {userRole}
                        </span>
                      </div>

                    </div>

                    <div className="user-dropdown-divider" />

                    <button
                      type="button"
                      className="user-dropdown-item"
                      onClick={openSettings}
                    >
                      <span className="user-dropdown-icon">
                        ⚙
                      </span>

                      <div>
                        <strong>
                          Settings
                        </strong>

                        <span>
                          Account and session information
                        </span>
                      </div>
                    </button>

                    <button
                      type="button"
                      className="user-dropdown-item user-dropdown-logout"
                      onClick={handleLogout}
                      disabled={
                        logoutLoading
                      }
                    >
                      <span className="user-dropdown-icon">
                        ↪
                      </span>

                      <div>
                        <strong>
                          {logoutLoading
                            ? 'Logging out...'
                            : 'Log out'}
                        </strong>

                        <span>
                          End your current session
                        </span>
                      </div>
                    </button>

                  </div>
                </>
              )}

            </div>

          </div>
        </header>

        <main className="content-area">
          {children}
        </main>

      </div>

      {settingsOpen && (
        <div
          className="settings-modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target ===
                event.currentTarget &&
              !logoutLoading
            ) {
              closeSettings()
            }
          }}
        >
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-modal-title"
          >
            <div className="settings-modal-header">

              <div>
                <span className="eyebrow">
                  SYSTEM SETTINGS
                </span>

                <h3 id="settings-modal-title">
                  Account settings
                </h3>

                <p>
                  Review your current IndustraFlow
                  account and session information.
                </p>
              </div>

              <button
                type="button"
                className="settings-modal-close"
                onClick={closeSettings}
                disabled={logoutLoading}
                aria-label="Close settings"
              >
                ×
              </button>

            </div>

            <div className="settings-modal-content">

              <div className="settings-profile">

                <div className="settings-profile-avatar">
                  {userInitial}
                </div>

                <div>
                  <strong>
                    {userName}
                  </strong>

                  <span>
                    {userRole}
                  </span>
                </div>

              </div>

              <div className="settings-detail-grid">

                <div className="settings-detail-item">
                  <span>Account</span>
                  <strong>
                    {userName}
                  </strong>
                </div>

                <div className="settings-detail-item">
                  <span>Role</span>
                  <strong>
                    {userRole}
                  </strong>
                </div>

                <div className="settings-detail-item">
                  <span>Platform</span>
                  <strong>
                    IndustraFlow
                  </strong>
                </div>

                <div className="settings-detail-item">
                  <span>Account type</span>
                  <strong>
                    Business account
                  </strong>
                </div>

              </div>

              <div className="settings-session-box">

                <div className="settings-session-indicator">
                  <span />
                </div>

                <div>
                  <strong>
                    Session active
                  </strong>

                  <p>
                    Your current session is authenticated
                    and connected to your IndustraFlow
                    company account.
                  </p>
                </div>

              </div>

            </div>

            <div className="settings-modal-footer">

              <button
                type="button"
                className="secondary-button"
                onClick={closeSettings}
                disabled={logoutLoading}
              >
                Close
              </button>

              <button
                type="button"
                className="settings-logout-button"
                onClick={handleLogout}
                disabled={logoutLoading}
              >
                {logoutLoading
                  ? 'Logging out...'
                  : 'Log out'}
              </button>

            </div>
          </section>
        </div>
      )}

    </div>
  )
}

export default AppLayout
