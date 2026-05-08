import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getCurrentUser, getIdToken, logout } from '../lib/auth'
import { AuthContext } from './AuthContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [idToken, setIdToken] = useState<string | null>(null)

  const checkAuth = useCallback(async () => {
    try {
      await getCurrentUser()
      const token = await getIdToken()
      setIdToken(token)
      setIsAuthenticated(true)
    } catch {
      setIsAuthenticated(false)
      setIdToken(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void checkAuth()
  }, [checkAuth])

  async function signOut() {
    await logout()
    setIsAuthenticated(false)
    setIdToken(null)
  }

  function handleUnauthorized() {
    logout().catch(() => {})
    setIsAuthenticated(false)
    setIdToken(null)
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, idToken, signOut, handleUnauthorized }}>
      {children}
    </AuthContext.Provider>
  )
}
