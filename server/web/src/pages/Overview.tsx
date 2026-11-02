import { useState } from 'react'
import { Link } from 'react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { ArrowRight, Plug } from 'lucide-react'
import { api } from '../api/client'
import { plainSummary } from '../components/RichBody'
import type { ExecStatus, RawStatus } from '../api/types'
import { PageHeader } from '../components/Shell'
import { Button, Empty } from '../components/ui'
import { DeliveryPill, EXEC_TONE, ExecStatusPill, Id, Priority, RAW_TONE, RawStatusPill, StageDot, TONE_BG, TONE_TEXT, type Tone } from '../components/status'
import { RawSheet } from '../components/RawSheet'
import { ExecSheet } from '../components/ExecSheet'
import { cn } from '../lib/cn'
import { EXEC_STATUS_LABEL, fmtTime, hasRole, RAW_STATUS_LABEL } from '../lib/format'
import { POLL_MS, useMemberNames, useProject, useSlug } from '../lib/hooks'

const RAW_ALL: RawStatus[] = ['Pending', 'Claimed', 'Processed', 'Merged', 'Duplicate', 'Ignored']
const EXEC_ALL: ExecStatus[] = ['Queued', 'InProgress', 'Done', 'Cancelled']

function useCounts<S extends string>(kind: 'raw' | 'exec', slug: string, statuses: S[]) {
  const results = useQueries({
    queries: statuses.map((s) => ({
      queryKey: [kind, slug, 'count', s],
      queryFn: () =>
        kind === 'raw'
          ? api.raws(slug, { status: s as RawStatus, page_size: 1 })
          : api.execs(slug, { status: s as ExecStatus, page_size: 1 }),
      refetchInterval: POLL_MS,
    })),
  })
  return Object.fromEntries(statuses.map((s, i) => [s, results[i].data?.total])) as Record<S, number | undefined>
}

export function OverviewPage() {
  const slug = useSlug()
  const project = useProject(slug).data!
  const roles = project.my_roles
  const [openRaw, setOpenRaw] = useState<string | null>(null)
  const [openExec, setOpenExec] = useState<string | null>(null)
  const raw = useCounts('raw', slug, RAW_ALL)
  const exec = useCounts('exec', slug, EXEC_ALL)
  const me = useQuery({ queryKey: ['me'], queryFn: api.me }).data
  const tokens = useQuery({ queryKey: ['tokens', slug], queryFn: () => api.tokens(slug) })
  const connected = (tokens.data ?? []).some((t) => t.user_id === me?.id && !t.revoked)

  return (
    <>
      <PageHeader
        title={project.name}
        description={project.description || undefined}
        actions={
          tokens.data &&
          !connected &&
          !project.archived && (
            <Link to={`/p/${slug}/connect`}>
              <Button variant="primary">
                <Plug className="size-4" />
                接入 CLI 与 Agent
              </Button>
            </Link>
          )
        }
      />
      <main className="flex flex-1 flex-col gap-6 px-8 py-6 max-md:px-4">
        <FlowMap slug={slug} raw={raw} exec={exec} />
        <div className="grid gap-6 xl:grid-cols-2">
          <MySubmissions slug={slug} onOpen={setOpenRaw} />
          {hasRole(roles, 'developer') ? (
            <MyTasks slug={slug} meId={me?.id} onOpen={setOpenExec} />
          ) : (
            <RecentDone slug={slug} onOpen={setOpenExec} />
          )}
        </div>
      </main>
      <RawSheet id={openRaw} onClose={() => setOpenRaw(null)} onOpenExec={setOpenExec} onOpenRaw={setOpenRaw} />
      <ExecSheet id={openExec} onClose={() => setOpenExec(null)} onOpenRaw={setOpenRaw} />
    </>
  )
}

/**
 * 两条管道的流向图：原始管道的活跃阶段 → 分配者判定（分流出合并 / 重复 / 忽略）→ 执行管道。
 * 每个阶段用宽度条表示它在本管道中的占比。
 */
function FlowMap({
  slug,
  raw,
  exec,
}: {
  slug: string
  raw: Record<RawStatus, number | undefined>
  exec: Record<ExecStatus, number | undefined>
}) {
  const rawTotal = RAW_ALL.reduce((a, s) => a + (raw[s] ?? 0), 0)
  const execTotal = EXEC_ALL.reduce((a, s) => a + (exec[s] ?? 0), 0)
  const closedRaw = (raw.Merged ?? 0) + (raw.Duplicate ?? 0) + (raw.Ignored ?? 0)
  const dedupRate = rawTotal ? Math.round((closedRaw / rawTotal) * 100) : 0

  return (
    <section className="overflow-hidden rounded-lg border border-rule bg-surface">
      <div className="grid lg:grid-cols-[1fr_auto_1fr]">
        <Lane
          title="原始小作文"
          sub={`共 ${rawTotal} 篇`}
          to={`/p/${slug}/raw`}
          stages={(['Pending', 'Claimed', 'Processed'] as RawStatus[]).map((s) => ({
            key: s,
            label: RAW_STATUS_LABEL[s],
            n: raw[s],
            tone: RAW_TONE[s],
            to: `/p/${slug}/raw`,
          }))}
          total={rawTotal}
        />

        <div className="relative flex flex-col items-center justify-center gap-3 border-rule bg-paper/60 px-6 py-6 max-lg:border-y lg:border-x">
          <div className="text-xs text-faint">分配者判定</div>
          <div className="flex items-center gap-2">
            {(['Merged', 'Duplicate', 'Ignored'] as RawStatus[]).map((s) => (
              <Link
                key={s}
                to={`/p/${slug}/raw?closed=1`}
                className="flex w-16 flex-col items-center rounded-md border border-rule bg-surface py-2 transition-colors hover:border-rule-strong"
              >
                <span className={cn('num text-lg font-semibold', TONE_TEXT[RAW_TONE[s]])}>{raw[s] ?? '–'}</span>
                <span className="text-[11px] text-graphite">{RAW_STATUS_LABEL[s]}</span>
              </Link>
            ))}
          </div>
          <div className="text-center text-xs text-graphite">
            <span className="num font-semibold text-ink">{dedupRate}%</span> 的反馈被合并、去重或过滤
          </div>
          <ArrowRight className="absolute top-1/2 -right-3 z-10 size-6 -translate-y-1/2 rounded-full border border-rule bg-surface p-1 text-faint max-lg:hidden" />
          <ArrowRight className="absolute top-1/2 -left-3 z-10 size-6 -translate-y-1/2 rounded-full border border-rule bg-surface p-1 text-faint max-lg:hidden" />
        </div>

        <Lane
          title="执行小作文"
          sub={`共 ${execTotal} 条${exec.Cancelled ? `，${exec.Cancelled} 条已取消` : ''}`}
          to={`/p/${slug}/exec`}
          stages={(['Queued', 'InProgress', 'Done'] as ExecStatus[]).map((s) => ({
            key: s,
            label: EXEC_STATUS_LABEL[s],
            n: exec[s],
            tone: EXEC_TONE[s],
            to: `/p/${slug}/exec`,
          }))}
          total={execTotal - (exec.Cancelled ?? 0)}
        />
      </div>
    </section>
  )
}

function Lane({
  title,
  sub,
  to,
  stages,
  total,
}: {
  title: string
  sub: string
  to: string
  stages: { key: string; label: string; n: number | undefined; tone: Tone; to: string }[]
  total: number
}) {
  return (
    <div className="flex flex-col p-6">
      <div className="flex items-baseline justify-between">
        <Link to={to} className="font-semibold hover:text-pencil">
          {title}
        </Link>
        <span className="text-xs text-faint">{sub}</span>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-4">
        {stages.map((s) => (
          <Link key={s.key} to={s.to} className="group">
            <div className="flex items-center gap-1.5 text-xs text-graphite">
              <StageDot tone={s.tone} />
              {s.label}
            </div>
            <div className="num mt-1 text-[34px] leading-none font-semibold tracking-tight group-hover:text-pencil">
              {s.n ?? '–'}
            </div>
          </Link>
        ))}
      </div>
      <div className="mt-5 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-ink/[0.05]">
        {total > 0 &&
          stages.map((s) =>
            s.n ? (
              <div
                key={s.key}
                className={cn('h-full transition-[flex-grow] duration-500', TONE_BG[s.tone])}
                style={{ flexGrow: s.n }}
              />
            ) : null,
          )}
      </div>
    </div>
  )
}

function Panel({
  title,
  link,
  linkLabel,
  children,
}: {
  title: string
  link: string
  linkLabel: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col rounded-lg border border-rule bg-surface">
      <div className="flex h-12 items-center justify-between border-b border-rule px-5">
        <h2 className="font-semibold">{title}</h2>
        <Link to={link} className="text-[13px] text-graphite hover:text-pencil">
          {linkLabel}
        </Link>
      </div>
      <div className="flex-1">{children}</div>
    </section>
  )
}

function MySubmissions({ slug, onOpen }: { slug: string; onOpen: (id: string) => void }) {
  const mine = useQuery({
    queryKey: ['raw', slug, 'mine-recent'],
    queryFn: () => api.raws(slug, { mine: true, page_size: 8 }),
    refetchInterval: POLL_MS,
  })
  return (
    <Panel title="我提交的" link={`/p/${slug}/raw?mine=1`} linkLabel="查看全部">
      {mine.data?.items.length === 0 && (
        <Empty title="你还没有提交过小作文">在「原始小作文」里提交，或者让 Agent 用 wtow raw submit 提交。</Empty>
      )}
      <ul className="divide-y divide-rule">
        {mine.data?.items.map((r) => (
          <li key={r.id}>
            <button onClick={() => onOpen(r.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-paper/70">
              <Id>{r.id}</Id>
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              <RawStatusPill status={r.status} />
              <span className="w-16">
                <DeliveryPill delivery={r.delivery} />
              </span>
              <span className="w-16 text-right text-xs text-faint">{fmtTime(r.created_at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function MyTasks({ slug, meId, onOpen }: { slug: string; meId?: number; onOpen: (id: string) => void }) {
  const tasks = useQuery({
    queryKey: ['exec', slug, 'my-active', meId],
    queryFn: () => api.execs(slug, { status: 'InProgress', developer_id: meId, page_size: 20 }),
    enabled: !!meId,
    refetchInterval: POLL_MS,
  })
  return (
    <Panel title="我正在做" link={`/p/${slug}/exec?mine=1`} linkLabel="打开执行管道">
      {tasks.data?.items.length === 0 && <Empty title="手上没有任务">去执行管道领一条排队中的任务。</Empty>}
      <ul className="divide-y divide-rule">
        {tasks.data?.items.map((e) => (
          <li key={e.id}>
            <button onClick={() => onOpen(e.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-paper/70">
              <Priority p={e.priority} />
              <Id>{e.id}</Id>
              <span className="min-w-0 flex-1 truncate">{plainSummary(e.instruction)}</span>
              <span className="text-xs text-faint">领取于 {fmtTime(e.claimed_at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function RecentDone({ slug, onOpen }: { slug: string; onOpen: (id: string) => void }) {
  const name = useMemberNames(slug)
  const done = useQuery({
    queryKey: ['exec', slug, 'recent-done'],
    queryFn: () => api.execs(slug, { status: 'Done', page_size: 8 }),
    refetchInterval: POLL_MS,
  })
  return (
    <Panel title="最近交付" link={`/p/${slug}/exec`} linkLabel="打开执行管道">
      {done.data?.items.length === 0 && <Empty title="还没有交付的任务" />}
      <ul className="divide-y divide-rule">
        {done.data?.items.map((e) => (
          <li key={e.id}>
            <button onClick={() => onOpen(e.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-paper/70">
              <ExecStatusPill status={e.status} />
              <span className="min-w-0 flex-1 truncate">{plainSummary(e.instruction)}</span>
              <span className="text-xs text-faint">
                {name(e.developer_id)}，{fmtTime(e.completed_at)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
