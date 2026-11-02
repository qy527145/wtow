import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { CreatedToken, Member, Project, Role } from '../api/types'
import { CopyBlock, ErrorText, Modal } from '../components/ui'
import { ALL_ROLES, fmtTime, hasRole, ROLE_LABEL } from '../lib/format'
import { useMembers, useProject, useSlug } from '../lib/hooks'

export function SettingsPage() {
  const slug = useSlug()
  const project = useProject(slug).data!
  const isAdmin = hasRole(project.my_roles, 'admin')
  return (
    <div className="settings">
      <ProjectInfo project={project} editable={isAdmin} />
      <Members slug={slug} editable={isAdmin && !project.archived} />
      <Tokens project={project} isAdmin={isAdmin} />
      {isAdmin && <Archive project={project} />}
    </div>
  )
}

function ProjectInfo({ project, editable }: { project: Project; editable: boolean }) {
  const qc = useQueryClient()
  const [name, setName] = useState(project.name)
  const [desc, setDesc] = useState(project.description)
  const [human, setHuman] = useState(project.require_human_triage)
  const save = useMutation({
    mutationFn: () =>
      api.updateProject(project.slug, { name: name.trim(), description: desc.trim(), require_human_triage: human }),
    onSuccess: (p) => {
      qc.setQueryData(['project', p.slug], p)
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
  const dirty = name !== project.name || desc !== project.description || human !== project.require_human_triage
  const disabled = !editable || project.archived
  return (
    <section className="card">
      <h3>项目信息</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <label>
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} required />
        </label>
        <label>
          标识
          <input className="mono" value={project.slug} disabled />
        </label>
        <label>
          描述
          <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} disabled={disabled} />
        </label>
        <label className="inline">
          <input type="checkbox" checked={human} onChange={(e) => setHuman(e.target.checked)} disabled={disabled} />
          合并 / 重复 / 忽略必须由人工判定（Agent 令牌调用会被拒绝）
        </label>
        <ErrorText error={save.error} />
        {!disabled && (
          <div className="actions">
            <button className="primary" disabled={!dirty || save.isPending}>
              保存
            </button>
          </div>
        )}
      </form>
    </section>
  )
}

function Members({ slug, editable }: { slug: string; editable: boolean }) {
  const qc = useQueryClient()
  const members = useMembers(slug)
  const me = useQuery({ queryKey: ['me'], queryFn: api.me }).data
  const [editing, setEditing] = useState<Member | 'new' | null>(null)
  const remove = useMutation({
    mutationFn: (uid: number) => api.removeMember(slug, uid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', slug] }),
  })
  return (
    <section className="card">
      <div className="card-head">
        <h3>成员</h3>
        {editable && (
          <button className="primary small" onClick={() => setEditing('new')}>
            添加成员
          </button>
        )}
      </div>
      <ErrorText error={members.error || remove.error} />
      <table className="table">
        <thead>
          <tr>
            <th>成员</th>
            <th>邮箱</th>
            <th>角色</th>
            {editable && <th />}
          </tr>
        </thead>
        <tbody>
          {members.data?.map((m) => (
            <tr key={m.user_id}>
              <td>{m.display_name}</td>
              <td className="mono">{m.email}</td>
              <td>{m.roles.map((r) => ROLE_LABEL[r]).join('、')}</td>
              {editable && (
                <td className="right">
                  <button className="ghost small" onClick={() => setEditing(m)}>
                    改角色
                  </button>
                  {m.user_id !== me?.id && (
                    <button
                      className="ghost small danger"
                      onClick={() => confirm(`移除 ${m.email}？其令牌会一并吊销。`) && remove.mutate(m.user_id)}
                    >
                      移除
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {editable && <p className="hint">对方需要先在本站注册账号，才能被添加为成员。</p>}
      {editing && <MemberDialog slug={slug} member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function RolePicker({ value, onChange, allowed }: { value: Role[]; onChange: (r: Role[]) => void; allowed?: Role[] }) {
  return (
    <div className="role-picker">
      {ALL_ROLES.filter((r) => !allowed || allowed.includes(r)).map((r) => (
        <label key={r} className="inline">
          <input
            type="checkbox"
            checked={value.includes(r)}
            onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))}
          />
          {ROLE_LABEL[r]}
        </label>
      ))}
    </div>
  )
}

function MemberDialog({ slug, member, onClose }: { slug: string; member: Member | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [email, setEmail] = useState(member?.email ?? '')
  const [roles, setRoles] = useState<Role[]>(member?.roles ?? ['tester'])
  const save = useMutation({
    mutationFn: () => api.upsertMember(slug, email, roles),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members', slug] })
      onClose()
    },
  })
  return (
    <Modal title={member ? `修改 ${member.email} 的角色` : '添加成员'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        {!member && (
          <label>
            邮箱
            <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
        )}
        <div className="field">
          角色
          <RolePicker value={roles} onChange={setRoles} />
          <span className="hint">测试者提交反馈；分配者去重并拆成任务；开发者领取任务；管理员拥有全部权限。</span>
        </div>
        <ErrorText error={save.error} />
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={save.isPending || roles.length === 0}>
            保存
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Tokens({ project, isAdmin }: { project: Project; isAdmin: boolean }) {
  const qc = useQueryClient()
  const slug = project.slug
  const tokens = useQuery({ queryKey: ['tokens', slug], queryFn: () => api.tokens(slug) })
  const [creating, setCreating] = useState(false)
  const revoke = useMutation({
    mutationFn: (id: number) => api.revokeToken(slug, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tokens', slug] }),
  })
  return (
    <section className="card">
      <div className="card-head">
        <h3>{isAdmin ? '访问令牌（全部成员）' : '我的访问令牌'}</h3>
        {!project.archived && (
          <button className="primary small" onClick={() => setCreating(true)}>
            生成令牌
          </button>
        )}
      </div>
      <p className="hint">CLI 和 Agent 用令牌访问本项目。令牌权限不会超过你自己的角色，成员被降权时令牌随之降权。</p>
      <ErrorText error={tokens.error || revoke.error} />
      <table className="table">
        <thead>
          <tr>
            <th>名称</th>
            <th>前缀</th>
            {isAdmin && <th>持有者</th>}
            <th>角色</th>
            <th>类型</th>
            <th>最近使用</th>
            <th>过期</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tokens.data?.map((t) => (
            <tr key={t.id} className={t.revoked ? 'dim' : ''}>
              <td>{t.name}</td>
              <td className="mono">{t.prefix}…</td>
              {isAdmin && <td>{t.owner}</td>}
              <td>
                {t.roles.map((r) => ROLE_LABEL[r]).join('、')}
                {t.read_only && <span className="badge">只读</span>}
              </td>
              <td>{t.actor_type === 'agent' ? 'Agent' : '人工'}</td>
              <td>{fmtTime(t.last_used_at)}</td>
              <td>{t.expires_at ? new Date(t.expires_at).toLocaleDateString('zh-CN') : '永不'}</td>
              <td className="right">
                {t.revoked ? (
                  <span className="muted">已吊销</span>
                ) : (
                  <button
                    className="ghost small danger"
                    onClick={() => confirm(`吊销令牌「${t.name}」？使用它的 CLI 会立即失效。`) && revoke.mutate(t.id)}
                  >
                    吊销
                  </button>
                )}
              </td>
            </tr>
          ))}
          {tokens.data?.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">
                还没有令牌。
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {creating && <CreateTokenDialog project={project} onClose={() => setCreating(false)} />}
    </section>
  )
}

export function CreateTokenDialog({
  project,
  onClose,
  onCreated,
}: {
  project: Project
  onClose: () => void
  onCreated?: (t: CreatedToken) => void
}) {
  const qc = useQueryClient()
  const held: Role[] = project.my_roles.includes('admin') ? ALL_ROLES : project.my_roles
  const [name, setName] = useState('my-agent')
  const [roles, setRoles] = useState<Role[]>(held.filter((r) => r !== 'admin'))
  const [actor, setActor] = useState<'agent' | 'human'>('agent')
  const [readOnly, setReadOnly] = useState(false)
  const [days, setDays] = useState('90')
  const [created, setCreated] = useState<CreatedToken | null>(null)
  const create = useMutation({
    mutationFn: () =>
      api.createToken(project.slug, {
        name: name.trim(),
        roles,
        read_only: readOnly,
        actor_type: actor,
        expires_in_days: days ? Number(days) : undefined,
      }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['tokens', project.slug] })
      setCreated(t)
      onCreated?.(t)
    },
  })

  if (created) {
    return (
      <Modal title="令牌已生成" onClose={onClose}>
        <p>
          <strong>令牌只显示这一次</strong>，关闭后无法再查看，请立即复制保存。
        </p>
        <CopyBlock text={created.secret} />
        <CopyBlock
          label="在终端执行，完成 CLI 登录："
          text={`wtow login --base-url ${location.origin} --project ${project.slug} --token ${created.secret}`}
        />
        <div className="actions">
          <button className="primary" onClick={onClose}>
            我已保存
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="生成访问令牌" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <label>
          名称
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 claude-code-laptop" required />
        </label>
        <div className="field">
          角色（不能超过你自己的角色）
          <RolePicker value={roles} onChange={setRoles} allowed={held} />
        </div>
        <div className="field">
          使用者
          <div className="role-picker">
            <label className="inline">
              <input type="radio" checked={actor === 'agent'} onChange={() => setActor('agent')} />
              Agent（Claude Code 等）
            </label>
            <label className="inline">
              <input type="radio" checked={actor === 'human'} onChange={() => setActor('human')} />
              我自己在终端使用
            </label>
          </div>
        </div>
        <label className="inline">
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
          只读
        </label>
        <label>
          有效期
          <select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">7 天</option>
            <option value="30">30 天</option>
            <option value="90">90 天</option>
            <option value="365">1 年</option>
            <option value="">永不过期</option>
          </select>
        </label>
        <ErrorText error={create.error} />
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={create.isPending || roles.length === 0}>
            生成
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Archive({ project }: { project: Project }) {
  const qc = useQueryClient()
  const toggle = useMutation({
    mutationFn: () => api.updateProject(project.slug, { archived: !project.archived }),
    onSuccess: (p) => {
      qc.setQueryData(['project', p.slug], p)
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
  return (
    <section className="card danger-zone">
      <h3>{project.archived ? '取消归档' : '归档项目'}</h3>
      <p className="muted">
        {project.archived
          ? '恢复后成员可以继续提交和处理小作文。'
          : '归档后项目只读：不能再提交、认领或修改任何作文，数据保留，可随时恢复。'}
      </p>
      <ErrorText error={toggle.error} />
      <button
        className={project.archived ? 'primary' : 'danger'}
        disabled={toggle.isPending}
        onClick={() => (project.archived || confirm(`确定归档 ${project.name}？`)) && toggle.mutate()}
      >
        {project.archived ? '取消归档' : '归档'}
      </button>
    </section>
  )
}
