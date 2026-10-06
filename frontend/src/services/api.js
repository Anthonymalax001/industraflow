const API_BASE_URL = 'http://localhost:5000/api'

async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem('industrafow_token')

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || data.error || 'Request failed')
  }

  return data
}

export const api = {
  getAnalyticsOverview() {
    return apiRequest('/analytics/overview')
  },
}