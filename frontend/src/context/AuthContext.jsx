import { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

const API_BASE_URL = 'https://industraflow.onrender.com/api'

const TOKEN_KEY = 'industrafow_token'
const USER_KEY = 'industrafow_user'
const SESSION_KEY = 'industrafow_active_session'

/*
 * A session belongs to the current browser tab.
 *
 * When the site is opened in a completely new tab,
 * that tab starts without authentication.
 *
 * Refreshing the page keeps the session.
 */

const getStoredSession = () => {
  const activeSession = sessionStorage.getItem(SESSION_KEY)

  if (activeSession !== 'true') {
    return {
      token: null,
      user: null,
    }
  }

  const storedToken = sessionStorage.getItem(TOKEN_KEY)
  const storedUser = sessionStorage.getItem(USER_KEY)

  if (!storedToken || !storedUser) {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(USER_KEY)
    sessionStorage.removeItem(SESSION_KEY)

    return {
      token: null,
      user: null,
    }
  }

  try {
    return {
      token: storedToken,
      user: JSON.parse(storedUser),
    }
  } catch {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(USER_KEY)
    sessionStorage.removeItem(SESSION_KEY)

    return {
      token: null,
      user: null,
    }
  }
}

export function AuthProvider({ children }) {
  const initialSession = getStoredSession()

  const [token, setToken] = useState(initialSession.token)
  const [user, setUser] = useState(initialSession.user)
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
        throw new Error(
          data.error ||
            data.message ||
            'Login failed'
        )
      }

      const receivedToken = data.token || data.accessToken
      const receivedUser = data.user || data

      if (!receivedToken) {
        throw new Error(
          'Login succeeded but no authentication token was returned'
        )
      }

      /*
       * Store authentication only in this browser tab session.
       */
      sessionStorage.setItem(
        TOKEN_KEY,
        receivedToken
      )

      sessionStorage.setItem(
        USER_KEY,
        JSON.stringify(receivedUser)
      )

      sessionStorage.setItem(
        SESSION_KEY,
        'true'
      )

      /*
       * Make sure old persistent authentication
       * from previous versions cannot automatically
       * authenticate the user.
       */
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
      localStorage.removeItem(SESSION_KEY)

      setToken(receivedToken)
      setUser(receivedUser)

      return data
    } finally {
      setLoading(false)
    }
  }

  const logout = () => {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(USER_KEY)
    sessionStorage.removeItem(SESSION_KEY)

    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(SESSION_KEY)

    setToken(null)
    setUser(null)
  }

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
    throw new Error(
      'useAuth must be used inside AuthProvider'
    )
  }

  return context
}