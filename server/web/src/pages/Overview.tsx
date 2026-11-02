import { useState } from 'react'
import { Link } from 'react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { ExecStatus, RawStatus } from '../api/types'
import { DeliveryBadge, Empty, ExecBadge, PriorityBadge, RawBadge } from '../components/ui'
import { RawDetailDrawer } from '../components/RawDetail'
import { ExecDetailDrawer } from '../components/ExecDetail'
import { EXEC_STATUS_LABEL, fmtTime, hasRole, RAW_STATUS_LABEL } from '../lib/format'
import { POLL_MS, useProject, useSlug } from '../lib/hooks'

const RAW_FLOW: RawStatus[] = ['Pending', 'Claimed', 'Processed', 'Merged', 'Duplicate', 'Ignored']
const EXEC_FLOW: ExecStatus[] = ['Queued', 'InProgress', 'Done', 'Cancelled']

function useCounts<S extends string>(key: unknown[], statuses: S[], fetch: (s: S) => Promise<{ total: number }>) {
  const results = useQueries({
    queries: statuses.map((s) => ({
      queryKey: [...key, 'count', s],
      queryFn: () => fetch(s),
      refetchInterval: POLL_MS,
    })),
  })
  return statuses.map((s, i) => ({ status: s, total: results[i].data?.total }))
}

export function OverviewPage() {
  const slug = useSlug()
  const project = useProject(slug).data!
  const roles = project.my_roles
  const [openRaw, setOpenRaw] = useState<string | null>(null)
  const [openExec, setOpenExec] = useState<string | null>(null)

  const rawCounts = useCounts(['raw', slug], RAW_FLOW, (s) => api.raws(slug, { status: s, page_size: 1 }))
  const execCounts = useCounts(['exec', slug], EXEC_FLOW, (s) => api.execs(slug, { status: s, page_size: 1 }))
  const mine = useQuery({
    queryKey: ['raw', slug, 'mine-recent'],
    queryFn: () => api.raws(slug, { mine: true, page_size: 8 }),
    refetchInterval: POLL_MS,
  })
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const myTasks = useQuery({
    queryKey: ['exec', slug, 'my-active', me.data?.id],
    queryFn: () => api.execs(slug, { status: 'InProgress', developer_id: me.data!.id, page_size: 20 }),
    enabled: !!me.data && hasRole(roles, 'developer'),
    refetchInterval: POLL_MS,
  })
  const tokens = useQuery({ queryKey: ['tokens', slug], queryFn: () => api.tokens(slug) })
  const myLiveTokens = (tokens.data ?? []).filter((t) => t.user_id === me.data?.id && !t.revoked)

  return (
    <>
      {tokens.data && myLiveTokens.length === 0 && (
        <div className="banner">
          你还没有为这个项目接入 CLI / Agent。
          <Link to={`/p/${slug}/guide`}>3 分钟完成接入 →</Link>
        </div>
      )}

      <section className="pipelines">
        <PipelineFlow
          title="原始管道"
          to={`/p/${slug}/raw`}
          items={rawCounts.map((c) => ({ label: RAW_STATUS_LABEL[c.status], total: c.total, cls: `raw-${c.status}` }))}
          split={3}
          splitLabel="已关闭"
        />
        <PipelineFlow
          title="执行管道"
          to={`/p/${slug}/exec`}
          items={execCounts.map((c) => ({ label: EXEC_STATUS_LABEL[c.status], total: c.total, cls: `exec-${c.status}` }))}
          split={3}
          splitLabel="已关闭"
        />
      </section>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h3>我提交的小作文</h3>
            <Link to={`/p/${slug}/raw?mine=1`} className="small">
              全部 →
            </Link>
          </div>
          {mine.data?.items.length === 0 && <Empty>还没有提交过。可以在原始管道页提交，或让 Agent 通过 CLI 提交。</Empty>}
          <ul className="list">
            {mine.data?.items.map((r) => (
              <li key={r.id} onClick={() => setOpenRaw(r.id)}>
                <span className="mono muted">{r.id}</span>
                <span className="grow ellipsis">{r.title}</span>
                <RawBadge status={r.status} />
                <DeliveryBadge delivery={r.delivery} />
                <span className="muted small">{fmtTime(r.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>

        {hasRole(roles, 'developer') && (
          <section className="card">
            <div className="card-head">
              <h3>我正在做的任务</h3>
              <Link to={`/p/${slug}/exec`} className="small">
                执行管道 →
              </Link>
            </div>
            {myTasks.data?.items.length === 0 && <Empty>手上没有进行中的任务，可以去执行管道领取。</Empty>}
            <ul className="list">
              {myTasks.data?.items.map((e) => (
                <li key={e.id} onClick={() => setOpenExec(e.id)}>
                  <span className="mono muted">{e.id}</span>
                  <PriorityBadge priority={e.priority} />
                  <span className="grow ellipsis">{e.instruction}</span>
                  <ExecBadge status={e.status} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {openRaw && <RawDetailDrawer id={openRaw} onClose={() => setOpenRaw(null)} onOpenExec={setOpenExec} />}
      {openExec && <ExecDetailDrawer id={openExec} onClose={() => setOpenExec(null)} onOpenRaw={setOpenRaw} />}
    </>
  )
}

function PipelineFlow({
  title,
  to,
  items,
  split,
  splitLabel,
}: {
  title: string
  to: string
  items: { label: string; total: number | undefined; cls: string }[]
  split: number
  splitLabel: string
}) {
  const stage = (it: (typeof items)[number]) => (
    <div key={it.label} className={`stage ${it.cls}`}>
      <div className="stage-n">{it.total ?? '·'}</div>
      <div className="stage-l">{it.label}</div>
    </div>
  )
  return (
    <Link to={to} className="card pipeline">
      <h3>{title}</h3>
      <div className="flow">
        {items.slice(0, split).map((it, i) => (
          <div key={it.label} className="flow-step">
            {i > 0 && <span className="arrow">→</span>}
            {stage(it)}
          </div>
        ))}
        <div className="flow-closed">
          <div className="muted small">{splitLabel}</div>
          <div className="flow-closed-items">{items.slice(split).map(stage)}</div>
        </div>
      </div>
    </Link>
  )
}
