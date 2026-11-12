import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './client'
import { clearAll } from './stores'
import type { User } from '../types'

interface Auth {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  changePassword: (current: string, next: string) => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<Auth | null>(null)

export function useAuth(): Auth {
  const c = useContext(Ctx)
  if (!c) throw new Error('AuthProvider is missing')
  return c
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    api<User>('/auth/me').then(setUser).catch(() => setUser(null)).finally(() => setLoading(false))
  }, [])
  const value: Auth = {
    user,
    loading,
    login: async (username, password) => setUser(await api<User>('/auth/login', { method: 'POST', body: { username, password } })),
    logout: async () => { try { await api('/auth/logout', { method: 'POST' }) } finally { clearAll(); setUser(null) } },
    refresh: async () => setUser(await api<User>('/auth/me')),
    changePassword: async (current, next) => setUser(await api<User>('/auth/change-password', { method: 'POST', body: { current_password: current, new_password: next } })),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
