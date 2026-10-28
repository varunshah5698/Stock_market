import { create } from 'zustand'
import { api, post } from '../lib/api'
import type { Preferences, User } from '../lib/types'

interface AuthState {
  user: User | null
  preferences: Preferences | null
  capabilities: Record<string, boolean | string> | null
  initialized: boolean
  busy: boolean
  refresh: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<void>
  logout: () => Promise<void>
  markUnauthorized: () => void
}

interface MeResponse {
  user: User
  preferences: Preferences
  capabilities: Record<string, boolean | string>
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  preferences: null,
  capabilities: null,
  initialized: false,
  busy: false,

  refresh: async () => {
    try {
      const data = await api<MeResponse>('/api/v1/auth/me')
      set({ user: data.user, preferences: data.preferences, capabilities: data.capabilities, initialized: true })
    } catch {
      set({ user: null, preferences: null, capabilities: null, initialized: true })
    }
  },

  login: async (email, password) => {
    set({ busy: true })
    try {
      const data = await post<{ user: User }>('/api/v1/auth/login', { email, password })
      const me = await api<MeResponse>('/api/v1/auth/me')
      set({ user: me.user ?? data.user, preferences: me.preferences, capabilities: me.capabilities, initialized: true })
    } finally {
      set({ busy: false })
    }
  },

  register: async (email, password, displayName) => {
    set({ busy: true })
    try {
      await post<{ user: User }>('/api/v1/auth/register', { email, password, display_name: displayName })
      const me = await api<MeResponse>('/api/v1/auth/me')
      set({ user: me.user, preferences: me.preferences, capabilities: me.capabilities, initialized: true })
    } finally {
      set({ busy: false })
    }
  },

  logout: async () => {
    try {
      await post('/api/v1/auth/logout')
    } finally {
      set({ user: null, preferences: null, capabilities: null })
    }
  },

  markUnauthorized: () => set({ user: null, preferences: null }),
}))
