import { Navigate, Route, Routes, useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from './api/client'
import { AppShell, ProjectShell } from './components/Shell'
import { LoginPage } from './pages/Login'
import { ProjectsPage } from './pages/Projects'
import { GuidePage } from './pages/Guide'
import { OverviewPage } from './pages/Overview'
import { RawPipelinePage } from './pages/RawPipeline'
import { ExecPipelinePage } from './pages/ExecPipeline'
import { WorkbenchPage } from './pages/Workbench'
import { SettingsPage } from './pages/Settings'

export function App() {
  const location = useLocation()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false, staleTime: 60_000 })

  if (location.pathname === '/login') return <LoginPage />
  if (me.isPending) return <div className="splash">加载中…</div>
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      const next = encodeURIComponent(location.pathname + location.search)
      return <Navigate to={`/login?next=${next}`} replace />
    }
    return <div className="splash error">无法连接服务端：{me.error.message}</div>
  }

  return (
    <Routes>
      <Route element={<AppShell user={me.data} />}>
        <Route index element={<ProjectsPage />} />
        <Route path="guide" element={<GuidePage />} />
        <Route path="p/:slug" element={<ProjectShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="raw" element={<RawPipelinePage />} />
          <Route path="workbench" element={<WorkbenchPage />} />
          <Route path="exec" element={<ExecPipelinePage />} />
          <Route path="guide" element={<GuidePage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
