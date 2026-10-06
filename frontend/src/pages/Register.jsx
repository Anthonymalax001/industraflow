import { useState } from 'react'

const API_BASE_URL = 'http://localhost:5000/api'

function Register() {
  const [form, setForm] = useState({
    companyName: '',
    industry: '',
    country: 'Kenya',
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  })

  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleChange = (event) => {
    const { name, value } = event.target

    setForm((current) => ({
      ...current,
      [name]: value,
    }))

    setError('')
    setSuccess('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    setError('')
    setSuccess('')

    const companyName = form.companyName.trim()
    const industry = form.industry.trim()
    const country = form.country.trim()
    const name = form.name.trim()
    const email = form.email.trim().toLowerCase()

    if (!companyName || !name || !email || !form.password) {
      setError(
        'Please complete your company name, full name, email, and password.'
      )
      return
    }

    if (companyName.length < 2) {
      setError('Company name must be at least 2 characters.')
      return
    }

    if (name.length < 2) {
      setError('Your name must be at least 2 characters.')
      return
    }

    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    try {
      setLoading(true)

      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          companyName,
          industry: industry || null,
          country: country || null,
          name,
          email,
          password: form.password,
        }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          data.error ||
            data.message ||
            'Unable to create your company account.'
        )
      }

      /*
       * Registration creates the company and administrator account.
       *
       * We intentionally DO NOT save the returned JWT here.
       * The user must sign in normally after registration.
       */
      setSuccess(
        'Company account created successfully. Redirecting you to sign in...'
      )

      /*
       * Clear any existing session so the newly registered account
       * always starts from the login screen.
       */
      localStorage.removeItem('industrafow_token')
      localStorage.removeItem('industrafow_user')

      /*
       * Give the user a short moment to see the success message,
       * then return to the normal sign-in flow.
       */
      setTimeout(() => {
        window.location.href = '/'
      }, 1200)
    } catch (err) {
      console.error('REGISTRATION ERROR:', err)

      setError(
        err.message ||
          'Unable to create your company account. Please try again.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page register-page">
      <div className="login-brand">
        <div className="login-brand-mark">I</div>

        <div>
          <div className="login-brand-name">IndustraFlow</div>

          <div className="login-brand-subtitle">
            Industrial Operations Platform
          </div>
        </div>
      </div>

      <div className="login-card register-card">
        <div className="login-header">
          <span className="eyebrow">GET STARTED</span>

          <h1>Create your company account</h1>

          <p>
            Set up your company workspace and become the first administrator
            of your IndustraFlow organization.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="login-form register-form">
          <div className="register-section-title">
            <span>01</span>

            <div>
              <strong>Company information</strong>

              <small>Tell us about your organization</small>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="companyName">Company name</label>

            <input
              id="companyName"
              name="companyName"
              type="text"
              value={form.companyName}
              onChange={handleChange}
              placeholder="e.g. ABC Construction Ltd"
              autoComplete="organization"
              disabled={loading}
            />
          </div>

          <div className="register-two-column">
            <div className="form-group">
              <label htmlFor="industry">Industry</label>

              <select
                id="industry"
                name="industry"
                value={form.industry}
                onChange={handleChange}
                disabled={loading}
              >
                <option value="">Select industry</option>
                <option value="Construction">Construction</option>
                <option value="Engineering">Engineering</option>
                <option value="Manufacturing">Manufacturing</option>
                <option value="Mining">Mining</option>
                <option value="Energy">Energy</option>
                <option value="Logistics">Logistics</option>
                <option value="Infrastructure">Infrastructure</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="country">Country</label>

              <input
                id="country"
                name="country"
                type="text"
                value={form.country}
                onChange={handleChange}
                placeholder="Country"
                autoComplete="country-name"
                disabled={loading}
              />
            </div>
          </div>

          <div className="register-section-title register-section-spaced">
            <span>02</span>

            <div>
              <strong>Administrator account</strong>

              <small>
                Your account will manage this company workspace
              </small>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="name">Full name</label>

            <input
              id="name"
              name="name"
              type="text"
              value={form.name}
              onChange={handleChange}
              placeholder="e.g. John Kamau"
              autoComplete="name"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="register-email">Email address</label>

            <input
              id="register-email"
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              placeholder="you@company.com"
              autoComplete="email"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="register-password">Password</label>

            <div className="password-input-wrapper">
              <input
                id="register-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={handleChange}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                disabled={loading}
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() =>
                  setShowPassword((current) => !current)
                }
                aria-label={
                  showPassword ? 'Hide password' : 'Show password'
                }
                title={
                  showPassword ? 'Hide password' : 'Show password'
                }
                disabled={loading}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm password</label>

            <div className="password-input-wrapper">
              <input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={form.confirmPassword}
                onChange={handleChange}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                disabled={loading}
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() =>
                  setShowConfirmPassword((current) => !current)
                }
                aria-label={
                  showConfirmPassword
                    ? 'Hide password'
                    : 'Show password'
                }
                title={
                  showConfirmPassword
                    ? 'Hide password'
                    : 'Show password'
                }
                disabled={loading}
              >
                {showConfirmPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          {success && (
            <div className="register-success" role="status">
              {success}
            </div>
          )}

          <button
            type="submit"
            className="login-button"
            disabled={loading}
          >
            {loading ? 'Creating account...' : 'Create company account'}
          </button>
        </form>

        <div className="login-register">
          <span>Already have an account?</span>

          <button
            type="button"
            className="login-register-button"
            onClick={() => {
              window.location.href = '/'
            }}
            disabled={loading}
          >
            Back to sign in
          </button>
        </div>

        <div className="login-footer">
          <span>
            Your company workspace is isolated and protected by
            IndustraFlow security
          </span>
        </div>
      </div>
    </div>
  )
}

export default Register
