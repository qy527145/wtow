import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { ExecComposition, ExecStatus } from '../api/types'
import { ErrorText, PriorityBadge, Tags } from '../components/ui'
import { ExecDetailDrawer } from '../components/ExecDetail'
import { RawDetailDrawer } from '../components/RawDetail'
import { EXEC_STATUS_LABEL, fmtTime } from '../lib/format'
import { POLL_MS, useMemberNames, useSlug } from '../lib/hooks'

const OPEN: ExecStatus[] = ['Queued', 'InProgress', 'Done']
const COLUMN_SIZE = 50

export function ExecPipelinePage() {
  const slug = useSlug()
  const name = useMemberNames(slug)
  const me = useQuery({ queryKey: ['me'], queryFn: api.me }).data
  const [params, setParams] = useSearchParams()
  const mineOnly = params.get('mine') === '1'
  const showCancelled = params.get('cancelled') === '1'
  const q = params.get('q') ?? ''
  const [kw, setKw] = useState(q)
  const [openExec, setOpenExec] = useState<string | null>(null)
  const [openRaw, setOpenRaw] = useState<string | null>(null)

  const statuses: ExecStatus[] = showCancelled ? [...OPEN, 'Cancelled'] : OPEN
  const developer_id = mineOnly ? me?.id : undefined
  const cols = useQueries({
    queries: statuses.map((s) => ({
      queryKey: ['exec', slug, 'col', s, { developer_id, q }],
      queryFn: () => api.execs(slug, { status: s, developer_id, q, page_size: COLUMN_SIZE }),
      refetchInterval: POLL_MS,
      enabled: !mineOnly || !!me,
    })),
  })

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  return (
    <>
      <div className="toolbar">
        <div className="seg">
          <button className={!mineOnly ? 'on' : ''} onClick={() => setParam('mine', null)}>
            全部
          </button>
          <button className={mineOnly ? 'on' : ''} onClick={() => setParam('mine', '1')}>
            我领取的
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setParam('q', kw.trim() || null)
          }}
        >
          <input className="search" placeholder="搜索指令，回车确认" value={kw} onChange={(e) => setKw(e.target.value)} />
        </form>
        <label className="inline">
          <input
            type="checkbox"
            checked={showCancelled}
            onChange={(e) => setParam('cancelled', e.target.checked ? '1' : null)}
          />
          显示已取消
        </label>
      </div>

      <div className="board">
        {statuses.map((s, i) => {
          const data = cols[i].data
          return (
            <section key={s} className={`column exec-${s}`}>
              <header>
                <span>{EXEC_STATUS_LABEL[s]}</span>
                <span className="count">{data?.total ?? '·'}</span>
              </header>
              <ErrorText error={cols[i].error} />
              <div className="cards">
                {data?.items.map((e) => (
                  <ExecCard key={e.id} exec={e} dev={name(e.developer_id)} onOpen={() => setOpenExec(e.id)} />
                ))}
                {data && data.total > data.items.length && (
                  <div className="muted small more">还有 {data.total - data.items.length} 条，请用搜索缩小范围</div>
                )}
              </div>
            </section>
          )
        })}
      </div>

      {openExec && <ExecDetailDrawer id={openExec} onClose={() => setOpenExec(null)} onOpenRaw={setOpenRaw} />}
      {openRaw && (
        <RawDetailDrawer id={openRaw} onClose={() => setOpenRaw(null)} onOpenExec={setOpenExec} onOpenRaw={setOpenRaw} />
      )}
    </>
  )
}

function ExecCard({ exec, dev, onOpen }: { exec: ExecComposition; dev: string; onOpen: () => void }) {
  return (
    <article className="kcard" onClick={onOpen}>
      <div className="kcard-top">
        <span className="mono muted">{exec.id}</span>
        <PriorityBadge priority={exec.priority} />
        <span className="spacer" />
        <span className="muted small">来源 {exec.source_raw_ids.length} 篇</span>
      </div>
      <div className="kcard-title clamp">{exec.instruction}</div>
      <div className="kcard-foot">
        <Tags tags={exec.target_resources} />
        <span className="spacer" />
        <span className="muted small">
          {exec.developer_id ? dev : '待领取'} · {fmtTime(exec.completed_at ?? exec.updated_at)}
        </span>
      </div>
    </article>
  )
}
