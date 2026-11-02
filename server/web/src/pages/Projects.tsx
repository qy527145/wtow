import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderPlus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../api/client'
import type { Project } from '../api/types'
import { PageHeader, ProjectGlyph, RolesText } from '../components/Shell'
import { Button, Check2, Dialog, Empty, ErrorNote, Field, Input, Spinner, Textarea } from '../components/ui'
import { StageDot } from '../components/status'

export function ProjectsPage() {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects })
  const [params, setParams] = useSearchParams()
  const creating = params.get('new') === '1'
  const setCreating = (v: boolean) => setParams(v ? { new: '1' } : {}, { replace: true })
  const [showArchived, setShowArchived] = useState(false)
  const all = projects.data ?? []
  const list = all.filter((p) => showArchived || !p.archived)
  const archivedCount = all.filter((p) => p.archived).length

  return (
    <>
      <PageHeader
        title="项目"
        description="每个项目有自己的两条管道、成员和令牌，互不可见。"
        actions={
          <>
            {archivedCount > 0 && (
              <Check2 checked={showArchived} onChange={setShowArchived}>
                显示已归档（{archivedCount}）
              </Check2>
            )}
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              新建项目
            </Button>
          </>
        }
      />
      <main className="flex-1 px-8 py-6 max-md:px-4">
        <ErrorNote error={projects.error} />
        {projects.isPending && <Spinner className="mx-auto mt-16" />}
        {projects.data && list.length === 0 && (
          <div className="rounded-lg border border-dashed border-rule-strong bg-surface">
            <Empty
              icon={<FolderPlus className="size-8" strokeWidth={1.5} />}
              title="还没有参与任何项目"
              action={
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    新建项目
                  </Button>
                  <Link to="/guide">
                    <Button>看使用引导</Button>
                  </Link>
                </div>
              }
            >
              新建一个项目，你就是它的管理员；也可以请已有项目的管理员用你的注册邮箱把你加进去。
            </Empty>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <ProjectCard key={p.slug} project={p} />
          ))}
        </div>
      </main>
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}

function ProjectCard({ project: p }: { project: Project }) {
  // 卡片上直接给出两条管道里「等人处理」的量，进项目前就知道哪里堆积了。
  const [pending, claimed, queued, working] = useQueries({
    queries: [
      { key: 'raw', s: 'Pending' },
      { key: 'raw', s: 'Claimed' },
      { key: 'exec', s: 'Queued' },
      { key: 'exec', s: 'InProgress' },
    ].map(({ key, s }) => ({
      queryKey: [key, p.slug, 'count', s],
      queryFn: () =>
        key === 'raw'
          ? api.raws(p.slug, { status: s as 'Pending', page_size: 1 })
          : api.execs(p.slug, { status: s as 'Queued', page_size: 1 }),
      enabled: !p.archived,
    })),
  })
  const n = (q: typeof pending) => q.data?.total ?? '–'
  return (
    <Link
      to={`/p/${p.slug}`}
      className="group flex flex-col rounded-lg border border-rule bg-surface p-5 transition-[border-color,box-shadow] hover:border-rule-strong hover:shadow-lift"
    >
      <div className="flex items-start gap-3">
        <ProjectGlyph name={p.name} muted={p.archived} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold group-hover:text-pencil">{p.name}</h3>
            {p.archived && <span className="rounded bg-gone-wash px-1.5 text-[11px] text-gone">已归档</span>}
          </div>
          <div className="font-mono text-xs text-faint">{p.slug}</div>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 min-h-[2.6em] text-[13px] leading-relaxed text-graphite">
        {p.description || '没有描述'}
      </p>
      {!p.archived && (
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule">
          <div className="bg-surface px-3 py-2">
            <div className="text-[11px] text-faint">原始小作文</div>
            <div className="mt-0.5 flex items-center gap-3 text-[13px]">
              <span className="flex items-center gap-1">
                <StageDot tone="wait" />
                <span className="num font-semibold">{n(pending)}</span>
              </span>
              <span className="flex items-center gap-1">
                <StageDot tone="work" />
                <span className="num font-semibold">{n(claimed)}</span>
              </span>
            </div>
          </div>
          <div className="bg-surface px-3 py-2">
            <div className="text-[11px] text-faint">执行小作文</div>
            <div className="mt-0.5 flex items-center gap-3 text-[13px]">
              <span className="flex items-center gap-1">
                <StageDot tone="wait" />
                <span className="num font-semibold">{n(queued)}</span>
              </span>
              <span className="flex items-center gap-1">
                <StageDot tone="work" />
                <span className="num font-semibold">{n(working)}</span>
              </span>
            </div>
          </div>
        </div>
      )}
      <div className="mt-3 text-xs text-faint">
        我的角色：<RolesText roles={p.my_roles} />
      </div>
    </Link>
  )
}

function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const qc = useQueryClient()
  const navigate = useNavigate()
  const create = useMutation({
    mutationFn: () => api.createProject(slug, name, desc),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      toast.success(`已创建项目「${p.name}」`)
      navigate(`/p/${p.slug}/connect`)
    },
  })
  // 名称是纯 ASCII 时自动推一个 slug，中文名则留给用户填。
  const suggest = (n: string) =>
    n
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="新建项目"
      description="创建后你是项目管理员，可以邀请成员、分配角色。"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <Field label="项目名称">
          <Input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (!slugTouched) setSlug(suggest(e.target.value))
            }}
            placeholder="例如：财务 Agent"
            required
          />
        </Field>
        <Field label="项目标识" hint="CLI 用它定位项目，只能用小写字母、数字、- 和 _，创建后不能修改。">
          <Input
            className="font-mono"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true)
              setSlug(e.target.value.toLowerCase())
            }}
            pattern="[a-z0-9][a-z0-9_\-]{0,63}"
            placeholder="finance-agent"
            required
          />
        </Field>
        <Field label="描述">
          <Textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="这个项目收集哪类反馈？" />
        </Field>
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" loading={create.isPending}>
            创建项目
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
