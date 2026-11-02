import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation, useQueries } from '@tanstack/react-query'
import { api } from '../api/client'
import type { RawComposition, RawStatus } from '../api/types'
import { DeliveryBadge, ErrorText, Modal, Tags } from '../components/ui'
import { RawDetailDrawer } from '../components/RawDetail'
import { ExecDetailDrawer } from '../components/ExecDetail'
import { fmtTime, RAW_STATUS_LABEL } from '../lib/format'
import { POLL_MS, useMemberNames, useProject, useSlug } from '../lib/hooks'
import { useInvalidatePipelines } from '../lib/invalidate'

const OPEN: RawStatus[] = ['Pending', 'Claimed', 'Processed']
const CLOSED: RawStatus[] = ['Merged', 'Duplicate', 'Ignored']
const COLUMN_SIZE = 50

export function RawPipelinePage() {
  const slug = useSlug()
  const project = useProject(slug).data!
  const name = useMemberNames(slug)
  const [params, setParams] = useSearchParams()
  const mine = params.get('mine') === '1'
  const showClosed = params.get('closed') === '1'
  const [kw, setKw] = useState(params.get('q') ?? '')
  const q = params.get('q') ?? ''
  const tag = params.get('tag') ?? ''
  const [openRaw, setOpenRaw] = useState<string | null>(null)
  const [openExec, setOpenExec] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const statuses = showClosed ? [...OPEN, ...CLOSED] : OPEN
  const cols = useQueries({
    queries: statuses.map((s) => ({
      queryKey: ['raw', slug, 'col', s, { mine, q, tag }],
      queryFn: () => api.raws(slug, { status: s, mine: mine || undefined, q, tag, page_size: COLUMN_SIZE }),
      refetchInterval: POLL_MS,
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
          <button className={!mine ? 'on' : ''} onClick={() => setParam('mine', null)}>
            全部
          </button>
          <button className={mine ? 'on' : ''} onClick={() => setParam('mine', '1')}>
            我提交的
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setParam('q', kw.trim() || null)
          }}
        >
          <input className="search" placeholder="搜索标题或描述，回车确认" value={kw} onChange={(e) => setKw(e.target.value)} />
        </form>
        {tag && (
          <button className="ghost small" onClick={() => setParam('tag', null)}>
            标签：{tag} ×
          </button>
        )}
        <label className="inline">
          <input type="checkbox" checked={showClosed} onChange={(e) => setParam('closed', e.target.checked ? '1' : null)} />
          显示已关闭（合并 / 重复 / 忽略）
        </label>
        <div className="spacer" />
        {!project.archived && (
          <button className="primary" onClick={() => setSubmitting(true)}>
            提交小作文
          </button>
        )}
      </div>

      <div className="board">
        {statuses.map((s, i) => {
          const data = cols[i].data
          return (
            <section key={s} className={`column raw-${s}`}>
              <header>
                <span>{RAW_STATUS_LABEL[s]}</span>
                <span className="count">{data?.total ?? '·'}</span>
              </header>
              <ErrorText error={cols[i].error} />
              <div className="cards">
                {data?.items.map((r) => (
                  <RawCard
                    key={r.id}
                    raw={r}
                    who={name(r.claimed_by ?? r.reporter_id)}
                    onOpen={() => setOpenRaw(r.id)}
                    onTag={(t) => setParam('tag', t)}
                  />
                ))}
                {data && data.total > data.items.length && (
                  <div className="muted small more">还有 {data.total - data.items.length} 条，请用搜索缩小范围</div>
                )}
              </div>
            </section>
          )
        })}
      </div>

      {openRaw && (
        <RawDetailDrawer id={openRaw} onClose={() => setOpenRaw(null)} onOpenExec={setOpenExec} onOpenRaw={setOpenRaw} />
      )}
      {openExec && <ExecDetailDrawer id={openExec} onClose={() => setOpenExec(null)} onOpenRaw={setOpenRaw} />}
      {submitting && <SubmitRawDialog onClose={() => setSubmitting(false)} onCreated={setOpenRaw} />}
    </>
  )
}

function RawCard({
  raw,
  who,
  onOpen,
  onTag,
}: {
  raw: RawComposition
  who: string
  onOpen: () => void
  onTag: (t: string) => void
}) {
  return (
    <article className="kcard" onClick={onOpen}>
      <div className="kcard-top">
        <span className="mono muted">{raw.id}</span>
        {raw.status === 'Processed' && <DeliveryBadge delivery={raw.delivery} />}
        {raw.merged_into_id && <span className="muted small">→ {raw.merged_into_id}</span>}
      </div>
      <div className="kcard-title">{raw.title}</div>
      <div className="kcard-foot">
        <span
          onClick={(e) => {
            e.stopPropagation()
            const t = (e.target as HTMLElement).closest('.tag')?.textContent
            if (t) onTag(t)
          }}
        >
          <Tags tags={raw.tags} />
        </span>
        <span className="spacer" />
        <span className="muted small">
          {raw.status === 'Claimed' ? `${who} 处理中` : who} · {fmtTime(raw.created_at)}
        </span>
      </div>
    </article>
  )
}

function SubmitRawDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const slug = useSlug()
  const invalidate = useInvalidatePipelines(slug)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [tags, setTags] = useState('')
  const submit = useMutation({
    mutationFn: () =>
      api.submitRaw(
        slug,
        title,
        desc,
        tags
          .split(/[,，\s]+/)
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    onSuccess: (r) => {
      invalidate()
      onClose()
      onCreated(r.id)
    },
  })
  return (
    <Modal title="提交小作文" onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit.mutate()
        }}
      >
        <label>
          标题
          <input autoFocus maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          描述
          <textarea
            rows={8}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="现象、复现步骤、期望结果……写清楚，分配者才能准确拆分"
            required
          />
        </label>
        <label>
          标签（逗号或空格分隔）
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="例如 登录 ios" />
        </label>
        <p className="hint">附件目前只能通过 CLI 上传：wtow raw submit … --attach FILE</p>
        <ErrorText error={submit.error} />
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={submit.isPending}>
            提交
          </button>
        </div>
      </form>
    </Modal>
  )
}
