import { lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from './api/client'
import { AppShell, ProjectFrame } from './components/Shell'
import { Spinner } from './components/ui'
import { LoginPage } from './pages/Login'
import { ProjectsPage } from './pages/Projects'
import { OverviewPage } from './pages/Overview'
import { RawPipelinePage } from './pages/RawPipeline'
import { ExecPipelinePage } from './pages/ExecPipeline'

// 低频页面按需加载，首屏只带看板相关代码。
const GuidePage = lazy(() => import('./pages/Guide').then((m) => ({ default: m.GuidePage })))
const WorkbenchPage = lazy(() => import('./pages/Workbench').then((m) => ({ default: m.WorkbenchPage })))
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })))

export function App() {
  const location = useLocation()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false, staleTime: 60_000 })

  if (location.pathname === '/login') return <LoginPage />
  if (me.isPending) {
    return (
      <div className="grid h-screen place-items-center">
        <Spinner />
      </div>
    )
  }
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      const next = encodeURIComponent(location.pathname + location.search)
      return <Navigate to={`/login?next=${next}`} replace />
    }
    return (
      <div className="grid h-screen place-items-center text-graphite">连不上服务端：{me.error.message}</div>
    )
  }

  return (
    <Routes>
      <Route element={<AppShell user={me.data} />}>
        <Route index element={<ProjectsPage />} />
        <Route path="guide" element={<GuidePage />} />
        <Route path="p/:slug" element={<ProjectFrame />}>
          <Route index element={<OverviewPage />} />
          <Route path="raw" element={<RawPipelinePage />} />
          <Route path="workbench" element={<WorkbenchPage />} />
          <Route path="exec" element={<ExecPipelinePage />} />
          <Route path="connect" element={<GuidePage />} />
          <Route path="guide" element={<Navigate to="../connect" replace />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
