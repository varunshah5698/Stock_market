import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense, lazy, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { CommandPalette } from './components/CommandPalette'
import { PageLoader, ProtectedRoute } from './components/ProtectedRoute'
import { Toasts } from './components/Toasts'
import { useAuth } from './store/auth'

const Landing = lazy(() => import('./pages/Landing'))
const LoginPage = lazy(() => import('./pages/Auth').then((module) => ({ default: module.LoginPage })))
const RegisterPage = lazy(() => import('./pages/Auth').then((module) => ({ default: module.RegisterPage })))
const ForgotPasswordPage = lazy(() => import('./pages/Auth').then((module) => ({ default: module.ForgotPasswordPage })))
const ResetPasswordPage = lazy(() => import('./pages/Auth').then((module) => ({ default: module.ResetPasswordPage })))
const Overview = lazy(() => import('./pages/Overview'))
const Screener = lazy(() => import('./pages/Screener'))
const Research = lazy(() => import('./pages/Research'))
const Compare = lazy(() => import('./pages/Compare'))
const PredictionLab = lazy(() => import('./pages/PredictionLab'))
const ExperimentDetail = lazy(() => import('./pages/ExperimentDetail'))
const Strategies = lazy(() => import('./pages/Strategies'))
const BacktestDetail = lazy(() => import('./pages/BacktestDetail'))
const Portfolios = lazy(() => import('./pages/Portfolios'))
const Watchlists = lazy(() => import('./pages/Watchlists'))
const DataStudio = lazy(() => import('./pages/DataStudio'))
const PaperTrading = lazy(() => import('./pages/PaperTrading'))
const News = lazy(() => import('./pages/News'))
const Reliability = lazy(() => import('./pages/Reliability'))
const Settings = lazy(() => import('./pages/Settings'))
const Legal = lazy(() => import('./pages/Legal'))
const NotFound = lazy(() => import('./pages/NotFound'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])
  return null
}

export default function App() {
  const { markUnauthorized } = useAuth()

  useEffect(() => {
    const onUnauthorized = () => markUnauthorized()
    window.addEventListener('stockpulse:unauthorized', onUnauthorized)
    return () => window.removeEventListener('stockpulse:unauthorized', onUnauthorized)
  }, [markUnauthorized])

  return (
    <QueryClientProvider client={queryClient}>
      <ScrollToTop />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/legal/:kind" element={<Legal />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Navigate to="/app/overview" replace />} />
              <Route path="overview" element={<Overview />} />
              <Route path="screener" element={<Screener />} />
              <Route path="research" element={<Navigate to="/app/research/AAPL" replace />} />
              <Route path="research/:symbol" element={<Research />} />
              <Route path="compare" element={<Compare />} />
              <Route path="prediction" element={<PredictionLab />} />
              <Route path="experiments/:id" element={<ExperimentDetail />} />
              <Route path="strategies" element={<Strategies />} />
              <Route path="backtests/:id" element={<BacktestDetail />} />
              <Route path="portfolios" element={<Portfolios />} />
              <Route path="watchlists" element={<Watchlists />} />
              <Route path="data" element={<DataStudio />} />
              <Route path="paper" element={<PaperTrading />} />
              <Route path="news" element={<News />} />
              <Route path="reliability" element={<Reliability />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <CommandPalette />
      <Toasts />
    </QueryClientProvider>
  )
}
