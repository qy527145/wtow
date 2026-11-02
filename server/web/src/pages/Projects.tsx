import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { Empty, ErrorText, Modal } from '../components/ui'
import { ROLE_LABEL } from '../lib/format'

export function ProjectsPage() {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects })
  const [creating, setCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const list = (projects.data ?? []).filter((p) => showArchived || !p.archived)
  const archivedCount = (projects.data ?? []).filter((p) => p.archived).length

  return (
    <main className="page">
      <div className="page-head">
        <h1>我的项目</h1>
        <div className="spacer" />
        {archivedCount > 0 && (
          <label className="inline">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            显示已归档（{archivedCount}）
          </label>
        )}
        <button className="primary" onClick={() => setCreating(true)}>
          新建项目
        </button>
      </div>
      <ErrorText error={projects.error} />
      {projects.data && list.length === 0 && (
        <Empty>
          还没有参与任何项目。你可以新建一个项目，或者请项目管理员把你加为成员。
          <br />
          第一次使用？先看看 <Link to="/guide">使用引导</Link>。
        </Empty>
      )}
      <div className="grid">
        {list.map((p) => (
          <Link key={p.slug} to={`/p/${p.slug}`} className="card project-card">
            <div className="row">
              <h3>{p.name}</h3>
              {p.archived && <span className="badge archived">已归档</span>}
            </div>
            <div className="muted mono">{p.slug}</div>
            <p>{p.description || <span className="muted">暂无描述</span>}</p>
            <div className="muted small">{p.my_roles.map((r) => ROLE_LABEL[r]).join(' · ')}</div>
          </Link>
        ))}
      </div>
      {creating && <CreateProjectDialog onClose={() => setCreating(false)} />}
    </main>
  )
}

function CreateProjectDialog({ onClose }: { onClose: () => void }) {
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const qc = useQueryClient()
  const navigate = useNavigate()
  const create = useMutation({
    mutationFn: () => api.createProject(slug, name, desc),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      navigate(`/p/${p.slug}/guide`)
    },
  })
  return (
    <Modal title="新建项目" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <label>
          项目名称
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          标识（slug）
          <input
            className="mono"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            pattern="[a-z0-9][a-z0-9_\-]{0,63}"
            placeholder="例如 finance-agent"
            required
          />
          <span className="hint">小写字母、数字、- 和 _，创建后不可修改，CLI 用它定位项目。</span>
        </label>
        <label>
          描述
          <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label>
        <ErrorText error={create.error} />
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={create.isPending}>
            创建
          </button>
        </div>
      </form>
    </Modal>
  )
}
