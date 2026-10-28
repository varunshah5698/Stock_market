import { create } from 'zustand'

export type ToastTone = 'success' | 'error' | 'info' | 'warning'

export interface ToastItem {
  id: string
  title: string
  description?: string
  tone: ToastTone
}

interface ToastState {
  toasts: ToastItem[]
  push: (title: string, tone?: ToastTone, description?: string) => void
  dismiss: (id: string) => void
}

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (title, tone = 'info', description) => {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random())
    set({ toasts: [...get().toasts, { id, title, tone, description }].slice(-4) })
    window.setTimeout(() => get().dismiss(id), 5500)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
}))

interface UiState {
  paletteOpen: boolean
  sidebarOpen: boolean
  setPalette: (open: boolean) => void
  setSidebar: (open: boolean) => void
}

export const useUi = create<UiState>((set) => ({
  paletteOpen: false,
  sidebarOpen: false,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setSidebar: (sidebarOpen) => set({ sidebarOpen }),
}))
