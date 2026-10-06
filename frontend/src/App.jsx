import { useEffect, useState } from 'react'
import AppLayout from './layouts/AppLayout'
import Login from './pages/Login'
import Projects from './pages/Projects'
import Workers from './pages/Workers'
import Contractors from './pages/Contractors'
import Suppliers from './pages/Suppliers'
import Assets from './pages/Assets'
import Compliance from './pages/Compliance'
import Incidents from './pages/Incidents'
import WorkPermits from './pages/WorkPermits'
import Reports from './pages/Reports'
import { useAuth } from './context/AuthContext'
import { api } from './services/api'

function Dashboard() {
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    const loadDashboard = async () => {
      try {
        setLoading(true)
        setError('')

        const data = await api.getAnalyticsOverview()

        if (!cancelled) {
          setAnalytics(data.metrics || {})
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.message ||
              'Unable to load dashboard data.',
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadDashboard()

    return () => {
      cancelled = true
    }
  }, [])

  const value = (key) => {
    if (loading) return '—'
    return analytics?.[key] ?? 0
  }

  return (
    <AppLayout>
      <section className="welcome-section">
        <div>
          <span className="eyebrow">OVERVIEW</span>

          <h2>Welcome to IndustraFlow</h2>

          <p>
            Manage your workforce, projects, assets, compliance, incidents,
            and work permits from one platform.
          </p>
        </div>
      </section>

      {error && (
        <div className="dashboard-error" role="alert">
          <strong>Unable to load dashboard data</strong>
          <span>{error}</span>
        </div>
      )}

      <section className="dashboard-grid">
        <div className="stat-card">
          <span>WORKERS</span>

          <strong>{value('total_workers')}</strong>

          <small>
            {loading
              ? 'Loading operational data'
              : `${value('active_workers')} currently active`}
          </small>
        </div>

        <div className="stat-card">
          <span>PROJECTS</span>

          <strong>{value('active_projects')}</strong>

          <small>
            {loading ? 'Loading operational data' : 'Active projects'}
          </small>
        </div>

        <div className="stat-card">
          <span>OPEN INCIDENTS</span>

          <strong>{value('open_incidents')}</strong>

          <small>
            {loading ? 'Loading operational data' : 'Require attention'}
          </small>
        </div>

        <div className="stat-card">
          <span>ACTIVE PERMITS</span>

          <strong>{value('active_permits')}</strong>

          <small>
            {loading ? 'Loading operational data' : 'Current work permits'}
          </small>
        </div>
      </section>

      <section className="dashboard-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">OPERATIONS</span>

            <h3>Operational health</h3>
          </div>

          <span className="section-status">
            {loading ? 'Updating' : 'Live data'}
          </span>
        </div>

        <div className="health-grid">
          <div className="health-card">
            <div className="health-card-header">
              <div className="health-icon">W</div>

              <div>
                <h4>Workforce</h4>
                <p>Current workforce activity</p>
              </div>
            </div>

            <div className="health-value">
              <strong>{value('active_workers')}</strong>
              <span>active workers</span>
            </div>

            <div className="health-meta">
              <span>Total workforce</span>
              <strong>{value('total_workers')}</strong>
            </div>
          </div>

          <div className="health-card">
            <div className="health-card-header">
              <div className="health-icon">S</div>

              <div>
                <h4>Safety</h4>
                <p>Incident monitoring</p>
              </div>
            </div>

            <div className="health-value">
              <strong>{value('open_incidents')}</strong>
              <span>open incidents</span>
            </div>

            <div className="health-empty">
              {!loading && value('open_incidents') === 0
                ? 'No incidents currently require attention.'
                : 'Safety items require review.'}
            </div>
          </div>

          <div className="health-card">
            <div className="health-card-header">
              <div className="health-icon">C</div>

              <div>
                <h4>Compliance</h4>
                <p>Certification & document status</p>
              </div>
            </div>

            <div className="compliance-summary">
              <div>
                <strong>
                  {value('certifications_expiring_soon')}
                </strong>

                <span>certifications expiring</span>
              </div>

              <div>
                <strong>
                  {value('documents_expiring_soon')}
                </strong>

                <span>documents expiring</span>
              </div>
            </div>

            <div className="health-empty">
              {!loading &&
              value('certifications_expiring_soon') === 0 &&
              value('documents_expiring_soon') === 0
                ? 'No upcoming compliance expirations.'
                : 'Compliance items require review.'}
            </div>
          </div>

          <div className="health-card">
            <div className="health-card-header">
              <div className="health-icon">A</div>

              <div>
                <h4>Assets</h4>
                <p>Maintenance monitoring</p>
              </div>
            </div>

            <div className="health-value">
              <strong>{value('assets_in_maintenance')}</strong>
              <span>assets in maintenance</span>
            </div>

            <div className="health-empty">
              {!loading && value('assets_in_maintenance') === 0
                ? 'No assets are currently in maintenance.'
                : 'Maintenance activity requires attention.'}
            </div>
          </div>
        </div>
      </section>

      <section className="dashboard-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">CURRENT ACTIVITY</span>

            <h3>Operational snapshot</h3>
          </div>
        </div>

        <div className="snapshot-grid">
          <div className="snapshot-card">
            <span>ACTIVE PROJECTS</span>

            <strong>{value('active_projects')}</strong>

            <p>
              {loading
                ? 'Loading project activity'
                : value('active_projects') === 0
                  ? 'No active projects'
                  : 'Projects currently underway'}
            </p>
          </div>

          <div className="snapshot-card">
            <span>WORK PERMITS</span>

            <strong>{value('active_permits')}</strong>

            <p>
              {loading
                ? 'Loading permit activity'
                : value('active_permits') === 0
                  ? 'No active permits'
                  : 'Permits currently in progress'}
            </p>
          </div>

          <div className="snapshot-card">
            <span>MAINTENANCE</span>

            <strong>{value('assets_in_maintenance')}</strong>

            <p>
              {loading
                ? 'Loading maintenance data'
                : value('assets_in_maintenance') === 0
                  ? 'No maintenance backlog'
                  : 'Assets requiring maintenance'}
            </p>
          </div>
        </div>
      </section>
    </AppLayout>
  )
}

function App() {
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) {
    return <Login />
  }

  if (window.location.pathname === '/projects') {
    return <Projects />
  }

  if (window.location.pathname === '/workers') {
    return <Workers />
  }

  if (window.location.pathname === '/contractors') {
    return <Contractors />
  }

  if (window.location.pathname === '/suppliers') {
    return <Suppliers />
  }

  if (window.location.pathname === '/assets') {
    return <Assets />
  }

  if (window.location.pathname === '/compliance') {
    return <Compliance />
  }

  if (window.location.pathname === '/incidents') {
    return <Incidents />
  }

  if (window.location.pathname === '/work-permits') {
    return <WorkPermits />
  }

  if (window.location.pathname === '/reports') {
    return <Reports />
  }

  return <Dashboard />
}

export default App