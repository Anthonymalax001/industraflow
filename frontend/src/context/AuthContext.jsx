import { createContext, useContext, useEffect, useState } from 'react'

const AuthContext = createContext(null)

const API_BASE_URL = 'https://industraflow.onrender.com/api'
const TOKEN_KEY = 'industrafow_token'
const USER_KEY = 'industrafow_user'

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState(() => {
    const storedUser = localStorage.getItem(USER_KEY)

    try {
      return storedUser ? JSON.parse(storedUser) : null
    } catch {
      return null
    }
  })

  const [loading, setLoading] = useState(false)

  const login = async (email, password) => {
    setLoading(true)

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
        }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Login failed')
      }

      const receivedToken = data.token || data.accessToken
      const receivedUser = data.user || data

      if (!receivedToken) {
        throw new Error('Login succeeded but no authentication token was returned')
      }

      localStorage.setItem(TOKEN_KEY, receivedToken)
      localStorage.setItem(USER_KEY, JSON.stringify(receivedUser))

      setToken(receivedToken)
      setUser(receivedUser)

      return data
    } finally {
      setLoading(false)
    }
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)

    setToken(null)
    setUser(null)
  }

  useEffect(() => {
    if (!token) {
      return
    }

    localStorage.setItem(TOKEN_KEY, token)
  }, [token])

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        loading,
        isAuthenticated: Boolean(token),
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider')
  }

  return context
}
