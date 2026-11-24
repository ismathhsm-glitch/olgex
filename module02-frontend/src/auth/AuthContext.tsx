import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import axios from 'axios'
import { getRefreshToken, setAccessToken, setRefreshToken } from '../api/client'
import type { Envelope, OrgRole } from '../api/types'

type AuthValue = {
  isAuthenticated: boolean
  isLoading: boolean
  role: OrgRole | null
  sessionExpired: boolean
  login: (accessToken: string, refreshToken: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

function roleFromToken(token: string): OrgRole | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>
    const roleValue = payload.role ?? payload.roles ?? payload.authorities ?? payload.systemRole
    const role = Array.isArray(roleValue) ? roleValue[0] : roleValue
    const normalized = String(role ?? '').replace(/^ROLE_/, '')
    return ['ORG_ADMIN', 'ACCOUNTANT', 'STAFF', 'VIEWER', 'SUPER_ADMIN'].includes(normalized) ? normalized as OrgRole : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [sessionExpired, setSessionExpired] = useState(false)

  const logout = useCallback(() => {
    setToken(null)
    setAccessToken(null)
    setRefreshToken(null)
    setSessionExpired(false)
  }, [])

  const login = useCallback((access: string, refresh: string) => {
    setAccessToken(access)
    setRefreshToken(refresh)
    setToken(access)
    setSessionExpired(false)
  }, [])

  const expireSession = useCallback(() => {
    setToken(null)
    setAccessToken(null)
    setRefreshToken(null)
    setSessionExpired(true)
  }, [])

  useEffect(() => {
    const onExpired = () => expireSession()
    window.addEventListener('olgax:session-expired', onExpired)
    const refreshToken = getRefreshToken()
    if (!refreshToken) {
      setIsLoading(false)
      return () => window.removeEventListener('olgax:session-expired', onExpired)
    }
    const apiBase = `${import.meta.env.VITE_API_URL ?? 'http://localhost:8080'}/api/v1`
    void axios.post<Envelope<{ accessToken: string; refreshToken: string }>>(`${apiBase}/auth/refresh`, { refreshToken })
      .then(({ data }) => {
        if (!data.success || !data.data) throw new Error(data.error?.code ?? 'REFRESH_FAILED')
        login(data.data.accessToken, data.data.refreshToken)
      })
      .catch(() => expireSession())
      .finally(() => setIsLoading(false))
    return () => window.removeEventListener('olgax:session-expired', onExpired)
  }, [expireSession, login])

  const value = useMemo(() => ({
    isAuthenticated: Boolean(token),
    isLoading,
    role: token ? roleFromToken(token) : null,
    sessionExpired,
    login,
    logout,
  }), [isLoading, login, logout, sessionExpired, token])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
