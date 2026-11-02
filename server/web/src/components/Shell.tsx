import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { User } from '../api/types'
import { hasRole, ROLE_LABEL } from '../lib/format'
import { useProject, useSlug } from '../lib/hooks'
import { ErrorText } from './ui'

export function AppShell({ user }: { user: User }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects })
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.clear()
      navigate('/login')
    },
  })

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          WTOW
        </Link>
        <select
          className="project-switch"
          value=""
          onChange={(e) => e.target.value && navigate(`/p/${e.target.value}`)}
        >
          <option value="">切换项目…</option>
          {projects.data?.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}（{p.slug}）
            </option>
          ))}
        </select>
        <div className="spacer" />
        <NavLink to="/guide" className="toplink">
          使用引导
        </NavLink>
        <span className="me" title={user.email}>
          {user.display_name || user.email}
        </span>
        <button className="ghost small" onClick={() => logout.mutate()}>
          退出
        </button>
      </header>
      <Outlet />
    </div>
  )
}

export function ProjectShell() {
  const slug = useSlug()
  const project = useProject(slug)

  if (project.error) {
    return (
      <main className="page">
        <ErrorText error={project.error} />
        <Link to="/">返回项目列表</Link>
      </main>
    )
  }
  const p = project.data
  const roles = p?.my_roles ?? []
  const tab = (to: string, label: string, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
      {label}
    </NavLink>
  )

  return (
    <div className="project">
      <div className="project-head">
        <div>
          <h1>
            {p?.name ?? slug}
            {p?.archived && <span className="badge archived">已归档</span>}
          </h1>
          <div className="muted">
            {slug} · 我的角色：{roles.map((r) => ROLE_LABEL[r]).join('、') || '—'}
          </div>
        </div>
        <nav className="tabs">
          {tab(`/p/${slug}`, '概览', true)}
          {tab(`/p/${slug}/raw`, '原始管道')}
          {hasRole(roles, 'assigner') && tab(`/p/${slug}/workbench`, '分配工作台')}
          {tab(`/p/${slug}/exec`, '执行管道')}
          {tab(`/p/${slug}/guide`, '接入指引')}
          {tab(`/p/${slug}/settings`, '设置')}
        </nav>
      </div>
      <main className="page">{p && <Outlet />}</main>
    </div>
  )
}
