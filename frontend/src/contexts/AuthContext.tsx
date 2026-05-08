import { createContext } from 'react'

export type AuthState = {
  isAuthenticated: boolean
  isLoading: boolean
  idToken: string | null
  signOut: () => Promise<void>
  handleUnauthorized: () => void
}

export const AuthContext = createContext<AuthState | null>(null)
