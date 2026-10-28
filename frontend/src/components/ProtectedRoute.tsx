import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Brand } from './Brand'
import { useAuth } from '../store/auth'

export function PageLoader({ label = 'Loading terminal' }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink-950">
      <Brand />
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-dimx">
        <Loader2 className="h-3 w-3 animate-spin" /> {label}
      </div>
    </div>
  )
}

export function ProtectedRoute() {
  const { user, initialized, refresh } = useAuth()
  const location = useLocation()

  useEffect(() => {
    if (!initialized) void refresh()
  }, [initialized, refresh])

  if (!initialized) return <PageLoader label="Checking session" />
  if (!user) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }
  return <Outlet />
}
