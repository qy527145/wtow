import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { RawComposition, RelatedItem } from '../api/types'
import { Empty, ErrorText, Modal, RawBadge, Tags } from '../components/ui'
import { fmtTime, PRIORITIES, priorityLabel } from '../lib/format'
import { POLL_MS, useMemberNames, useProject, useSlug } from '../lib/hooks'
import { useInvalidatePipelines } from '../lib/invalidate'

/** 分配工作台，见 DESIGN 10.1：左侧待处理列表，中间详情与相似项，右侧执行作文草稿。 */
export function WorkbenchPage() {
  const slug = useSlug()
  const project = useProject(slug).data!
  const me = useQuery({ queryKey: ['me'], queryFn: api.me }).data
  const name = useMemberNames(slug)
  const [focus, setFocus] = useState<string | null>(null)
  const [draft, setDraft] = useState<string[]>([])

  const pending = useQuery({
    queryKey: ['raw', slug, 'col', 'Pending', 'wb'],
    queryFn: () => api.raws(slug, { status: 'Pending', page_size: 100 }),
    refetchInterval: POLL_MS,
  })
  const claimed = useQuery({
    queryKey: ['raw', slug, 'col', 'Claimed', 'wb'],
    queryFn: () => api.raws(slug, { status: 'Claimed', page_size: 100 }),
    refetchInterval: POLL_MS,
  })
  const myClaimed = (claimed.data?.items ?? []).filter((r) => r.claimed_by === me?.id)
  const othersClaimed = (claimed.data?.items ?? []).filter((r) => r.claimed_by !== me?.id)

  if (project.archived) return <Empty>项目已归档，不能再分配。</Empty>

  const item = (r: RawComposition) => (
    <li key={r.id} className={focus === r.id ? 'on' : ''} onClick={() => setFocus(r.id)}>
      <div className="row">
        <span className="mono muted">{r.id}</span>
        <span className="spacer" />
        {draft.includes(r.id) && <span className="badge draft">草稿</span>}
        <span className="muted small">{fmtTime(r.created_at)}</span>
      </div>
      <div className="ellipsis">{r.title}</div>
    </li>
  )

  return (
    <div className="workbench">
      <aside className="wb-list card">
        <h4>我认领的（{myClaimed.length}）</h4>
        {myClaimed.length === 0 && <div className="muted small">先从下方认领一篇。</div>}
        <ul className="pick">{myClaimed.map(item)}</ul>
        <h4>待处理（{pending.data?.total ?? '·'}）</h4>
        <ul className="pick">{pending.data?.items.map(item)}</ul>
        {othersClaimed.length > 0 && (
          <>
            <h4>他人处理中（{othersClaimed.length}）</h4>
            <ul className="pick dim">
              {othersClaimed.map((r) => (
                <li key={r.id} onClick={() => setFocus(r.id)}>
                  <div className="row">
                    <span className="mono muted">{r.id}</span>
                    <span className="spacer" />
                    <span className="muted small">{name(r.claimed_by)}</span>
                  </div>
                  <div className="ellipsis">{r.title}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      <section className="wb-detail card">
        {focus ? (
          <FocusPanel
            key={focus}
            id={focus}
            meId={me?.id}
            inDraft={draft.includes(focus)}
            onAddDraft={() => setDraft((d) => (d.includes(focus) ? d : [...d, focus]))}
            onFocus={setFocus}
            onClosed={() => {
              setDraft((d) => d.filter((x) => x !== focus))
              setFocus(null)
            }}
          />
        ) : (
          <Empty>
            从左侧选择一篇小作文。
            <br />
            处理流程：认领 → 查看相似项 → 合并 / 标记重复 / 忽略，或者加入右侧草稿拆成执行作文。
          </Empty>
        )}
      </section>

      <aside className="wb-draft card">
        <DraftPanel draft={draft} setDraft={setDraft} onCreated={() => setDraft([])} />
      </aside>
    </div>
  )
}

function FocusPanel({
  id,
  meId,
  inDraft,
  onAddDraft,
  onFocus,
  onClosed,
}: {
  id: string
  meId: number | undefined
  inDraft: boolean
  onAddDraft: () => void
  onFocus: (id: string) => void
  onClosed: () => void
}) {
  const slug = useSlug()
  const name = useMemberNames(slug)
  const invalidate = useInvalidatePipelines(slug)
  const raw = useQuery({ queryKey: ['raw', slug, 'one', id], queryFn: () => api.raw(slug, id) })
  const r = raw.data
  const mine = r?.status === 'Claimed' && r.claimed_by === meId
  const canTriage = r?.status === 'Pending' || mine
  // 只有能判定时才拉相似项：服务端会把这次查看记入审计，作为合并 / 建联的前置条件。
  const related = useQuery({
    queryKey: ['raw', slug, 'related', id, r?.claimed_at ?? null],
    queryFn: () => api.related(slug, id),
    enabled: !!canTriage,
    staleTime: Infinity,
  })
  const [triage, setTriage] = useState<null | { action: 'merge' | 'duplicate' | 'ignore'; target?: string }>(null)

  const claim = useMutation({ mutationFn: () => api.claimRaw(slug, id), onSuccess: invalidate })
  const release = useMutation({ mutationFn: () => api.releaseRaw(slug, id), onSuccess: invalidate })

  if (!r) return <ErrorText error={raw.error} />

  return (
    <>
      <div className="row">
        <span className="mono muted">{r.id}</span>
        <RawBadge status={r.status} />
        <Tags tags={r.tags} />
        <span className="spacer" />
        <span className="muted small">
          {name(r.reporter_id)} · {fmtTime(r.created_at)}
        </span>
      </div>
      <h2 className="detail-title">{r.title}</h2>
      <div className="prose scroll">{r.description}</div>

      <div className="drawer-actions">
        <ErrorText error={claim.error || release.error} />
        {r.status === 'Pending' && (
          <button className="primary" onClick={() => claim.mutate()} disabled={claim.isPending}>
            认领
          </button>
        )}
        {mine && (
          <button className="primary" onClick={onAddDraft} disabled={inDraft}>
            {inDraft ? '已在草稿中' : '加入执行草稿 →'}
          </button>
        )}
        {canTriage && (
          <>
            <button className="ghost" onClick={() => setTriage({ action: 'merge' })}>
              合并到…
            </button>
            <button className="ghost" onClick={() => setTriage({ action: 'duplicate' })}>
              标记重复…
            </button>
            <button className="ghost" onClick={() => setTriage({ action: 'ignore' })}>
              忽略
            </button>
          </>
        )}
        {mine && (
          <button className="ghost" onClick={() => release.mutate()} disabled={release.isPending}>
            释放
          </button>
        )}
        {r.status === 'Claimed' && !mine && <span className="muted">{name(r.claimed_by)} 正在处理。</span>}
      </div>

      {canTriage && (
        <>
          <h4>相似项</h4>
          <ErrorText error={related.error} />
          {related.data?.length === 0 && <div className="muted small">没有发现相似的小作文或任务。</div>}
          <ul className="list related">
            {related.data?.map((it) => (
              <RelatedRow
                key={it.kind + it.id}
                it={it}
                onOpen={() => it.kind === 'raw' && onFocus(it.id)}
                onMerge={() => setTriage({ action: 'merge', target: it.id })}
                onDuplicate={() => setTriage({ action: 'duplicate', target: it.id })}
              />
            ))}
          </ul>
        </>
      )}

      {triage && (
        <TriageDialog
          raw={r}
          action={triage.action}
          initialTarget={triage.target}
          candidates={(related.data ?? []).filter((x) => x.kind === 'raw')}
          onClose={() => setTriage(null)}
          onDone={() => {
            setTriage(null)
            invalidate()
            onClosed()
          }}
        />
      )}
    </>
  )
}

function RelatedRow({
  it,
  onOpen,
  onMerge,
  onDuplicate,
}: {
  it: RelatedItem
  onOpen: () => void
  onMerge: () => void
  onDuplicate: () => void
}) {
  return (
    <li onClick={onOpen}>
      <span className={`badge kind-${it.kind}`}>{it.kind === 'raw' ? '小作文' : '任务'}</span>
      <span className="mono muted">{it.id}</span>
      <span className="grow ellipsis" title={it.reasons.join('；')}>
        {it.title}
      </span>
      <span className="muted small">{it.status}</span>
      {it.kind === 'raw' && (
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <button className="ghost small" onClick={onMerge}>
            合并到此
          </button>
          <button className="ghost small" onClick={onDuplicate}>
            重复于此
          </button>
        </span>
      )}
    </li>
  )
}

const TRIAGE_TEXT = {
  merge: { title: '合并到另一篇', hint: '两篇描述的是同一问题但各有补充，内容并入目标后一起处理。' },
  duplicate: { title: '标记为重复', hint: '与目标完全相同，没有新信息。' },
  ignore: { title: '忽略', hint: '无需处理（不是问题、无法复现、超出范围等）。之后可以重新打开。' },
}

function TriageDialog({
  raw,
  action,
  initialTarget,
  candidates,
  onClose,
  onDone,
}: {
  raw: RawComposition
  action: 'merge' | 'duplicate' | 'ignore'
  initialTarget?: string
  candidates: RelatedItem[]
  onClose: () => void
  onDone: () => void
}) {
  const slug = useSlug()
  const [target, setTarget] = useState(initialTarget ?? '')
  const [reason, setReason] = useState('')
  const run = useMutation({
    mutationFn: () =>
      api.triageRaw(slug, raw.id, action, { target_id: action === 'ignore' ? undefined : target.trim(), reason: reason.trim() }),
    onSuccess: onDone,
  })
  const t = TRIAGE_TEXT[action]
  return (
    <Modal title={`${t.title}：${raw.id}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          run.mutate()
        }}
      >
        <p className="muted">{t.hint}</p>
        {action !== 'ignore' && (
          <label>
            目标小作文
            <input
              className="mono"
              list="triage-candidates"
              value={target}
              onChange={(e) => setTarget(e.target.value.toUpperCase())}
              placeholder="RAW-1001"
              required
            />
            <datalist id="triage-candidates">
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </datalist>
          </label>
        )}
        <label>
          原因
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required />
        </label>
        <ErrorText error={run.error} />
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={run.isPending || !reason.trim()}>
            确认
          </button>
        </div>
      </form>
    </Modal>
  )
}

function DraftPanel({
  draft,
  setDraft,
  onCreated,
}: {
  draft: string[]
  setDraft: (f: (d: string[]) => string[]) => void
  onCreated: () => void
}) {
  const slug = useSlug()
  const invalidate = useInvalidatePipelines(slug)
  const [instruction, setInstruction] = useState('')
  const [targets, setTargets] = useState('')
  const [priority, setPriority] = useState(2)
  const [close, setClose] = useState(true)
  const [created, setCreated] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () =>
      api.createExec(slug, {
        source_raw_ids: draft,
        instruction: instruction.trim(),
        target_resources: targets
          .split(/[,，\s]+/)
          .map((t) => t.trim())
          .filter(Boolean),
        priority,
        close_sources: close,
      }),
    onSuccess: (e) => {
      invalidate()
      setCreated(e.id)
      setInstruction('')
      setTargets('')
      if (close) onCreated()
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
    >
      <h4>执行作文草稿</h4>
      {draft.length === 0 ? (
        <div className="muted small">认领小作文后点「加入执行草稿」。一篇可以拆成多条任务，多篇也可以合成一条。</div>
      ) : (
        <ul className="chips">
          {draft.map((id) => (
            <li key={id}>
              <span className="mono">{id}</span>
              <button type="button" className="ghost icon" onClick={() => setDraft((d) => d.filter((x) => x !== id))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <label>
        开发指令
        <textarea
          rows={8}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="要改什么、验收标准是什么。开发者（或 Agent）只看这里。"
          required
        />
      </label>
      <label>
        目标资源（逗号分隔，用于检测并行冲突）
        <input className="mono" value={targets} onChange={(e) => setTargets(e.target.value)} placeholder="web/login, api/auth" />
      </label>
      <label>
        优先级
        <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {priorityLabel(p)}
              {p === 0 ? '（最高）' : p === 3 ? '（最低）' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="inline">
        <input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} />
        创建后把来源标记为「已拆分」
      </label>
      <p className="hint">不勾选时来源仍由你认领，可以继续拆出下一条任务。</p>
      <ErrorText error={create.error} />
      {created && !create.isPending && <div className="ok-text">已创建 {created}</div>}
      <button className="primary block" disabled={create.isPending || draft.length === 0 || !instruction.trim()}>
        创建执行作文
      </button>
    </form>
  )
}
