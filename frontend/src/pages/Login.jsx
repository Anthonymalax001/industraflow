import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

function Login() {
  const { login, loading } = useAuth()

  const [email, setEmail] = useState('admin@industrafow.com')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    if (!email.trim() || !password) {
      setError('Please enter your email and password.')
      return
    }

    try {
      await login(email.trim(), password)
      window.location.href = '/'
    } catch (err) {
      setError(err.message || 'Unable to sign in. Please check your credentials.')
    }
  }

  return (
    <div className="login-page">
      <div className="login-brand">
        <div className="login-brand-mark">I</div>

        <div>
          <div className="login-brand-name">IndustraFlow</div>
          <div className="login-brand-subtitle">
            Industrial Operations Platform
          </div>
        </div>
      </div>

      <div className="login-card">
        <div className="login-header">
          <span className="eyebrow">SECURE ACCESS</span>

          <h1>Welcome back</h1>

          <p>
            Sign in to manage your industrial operations, workforce,
            compliance, projects, and safety.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="email">Email address</label>

            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <div className="password-label-row">
              <label htmlFor="password">Password</label>

              <button
                type="button"
                className="forgot-button"
                onClick={() => {
                  setError('Password recovery will be available soon.')
                }}
              >
                Forgot password?
              </button>
            </div>

            <div className="password-input-wrapper">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                disabled={loading}
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="login-button"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div className="login-footer">
          <span>Protected by IndustraFlow security</span>
        </div>
      </div>
    </div>
  )
}

export default Login