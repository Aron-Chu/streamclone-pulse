import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './guards'
import Landing from './public/Landing'
import Setup from './public/Setup'
import Docs from './public/Docs'
import Status from './public/Status'
import Login from './public/Login'

const DashboardShell = lazy(() => import('./dashboard/DashboardShell'))
const AdminShell = lazy(() => import('./admin/AdminShell'))
const DashboardHome = lazy(() => import('./dashboard/Home'))
const ChannelAnalyticsPage = lazy(() => import('./analytics/ChannelAnalyticsPage'))
const StreamsHubPlaceholder = lazy(() => import('./analytics/StreamsHubPlaceholder'))

function RouteFallback() {
  return (
    <div className="app-main">
      <p className="muted">Loading…</p>
    </div>
  )
}

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/*" element={<Docs />} />
        <Route path="/status" element={<Status />} />
        <Route path="/login" element={<Login />} />

        {/* Public aggregate hub — polls /v1/public/hub only */}
        <Route path="/analytics" element={<DashboardHome />} />

        {/* Beta-gated chart / channel surfaces */}
        <Route element={<RequireAuth />}>
          <Route path="/analytics/streams" element={<StreamsHubPlaceholder />} />
          <Route path="/analytics/:login/s/:streamId" element={<ChannelAnalyticsPage />} />
          <Route path="/analytics/:login" element={<ChannelAnalyticsPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route path="/dashboard/*" element={<DashboardShell />} />
        </Route>

        <Route path="/admin/*" element={<AdminShell />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
