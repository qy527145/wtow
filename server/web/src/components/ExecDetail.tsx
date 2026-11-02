import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import type { ExecComposition } from '../api/types'
import { fmtDateTime, hasRole } from '../lib/format'
import { useMemberNames, useProject, useSlug } from '../lib/hooks'
import { useInvalidatePipelines } from '../lib/invalidate'
import { Drawer } from './Drawer'
import { ErrorText, ExecBadge, Modal, PriorityBadge, RawBadge, ReasonDialog, Tags } from './ui'

export function ExecDetailDrawer({
  id,
  onClose,
  onOpenRaw,
}: {
  id: string
  onClose: () => void
  onOpenRaw?: (id: string) => void
}) {
  const slug = useSlug()
  const name = useMemberNames(slug)
  const exec = useQuery({ queryKey: ['exec', slug, 'one', id], queryFn: () => api.exec(slug, id) })
  const sources = useQuery({ queryKey: ['exec', slug, 'raws', id], queryFn: () => api.execRaws(slug, id) })
  const e = exec.data
  const links = Array.isArray(e?.result_links) ? e!.result_links : []

  return (
    <Drawer title={<span className="mono">{id}</span>} onClose={onClose}>
      <ErrorText error={exec.error} />
      {e && (
        <>
          <div className="meta-row">
            <ExecBadge status={e.status} />
            <PriorityBadge priority={e.priority} />
            <Tags tags={e.target_resources} />
          </div>
          <div className="prose">{e.instruction}</div>
          <dl className="kv">
            <dt>分配者</dt>
            <dd>{name(e.assigner_id)}</dd>
            <dt>开发者</dt>
            <dd>{e.developer_id ? `${name(e.developer_id)}（${fmtDateTime(e.claimed_at)} 领取）` : '未领取'}</dd>
            <dt>创建时间</dt>
            <dd>{fmtDateTime(e.created_at)}</dd>
            {e.completed_at && (
              <>
                <dt>完成时间</dt>
                <dd>{fmtDateTime(e.completed_at)}</dd>
              </>
            )}
          </dl>
          {e.developer_notes && (
            <>
              <h4>开发说明</h4>
              <div className="prose">{e.developer_notes}</div>
            </>
          )}
          {links.length > 0 && (
            <>
              <h4>交付链接</h4>
              <ul className="links">
                {links.map((l) => (
                  <li key={l}>
                    <a href={l} target="_blank" rel="noreferrer">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}

          {e.attachments.length > 0 && (
            <div className="attachments">
              <h4>附件</h4>
              {e.attachments.map((a) => (
                <a key={a.id} href={`/api/v1/projects/${slug}/files/${a.id}`} target="_blank" rel="noreferrer">
                  {a.filename}（{Math.ceil(a.size_bytes / 1024)} KB{a.owner_id !== e.id && `，来自 ${a.owner_id}`}）
                </a>
              ))}
            </div>
          )}

          <h4>来源小作文</h4>
          <ul className="list">
            {sources.data?.map((r) => (
              <li key={r.id} onClick={() => onOpenRaw?.(r.id)}>
                <span className="mono muted">{r.id}</span>
                <span className="grow ellipsis">{r.title}</span>
                <RawBadge status={r.status} />
              </li>
            ))}
          </ul>

          <ExecActions exec={e} />
        </>
      )}
    </Drawer>
  )
}

function ExecActions({ exec }: { exec: ExecComposition }) {
  const slug = useSlug()
  const project = useProject(slug).data
  const me = useQuery({ queryKey: ['me'], queryFn: api.me }).data
  const invalidate = useInvalidatePipelines(slug)
  const [dialog, setDialog] = useState<null | 'release' | 'cancel' | 'reopen' | 'complete' | 'force'>(null)
  const onSuccess = () => {
    invalidate()
    setDialog(null)
  }

  const claim = useMutation({
    mutationFn: (force: boolean) => api.claimExec(slug, exec.id, force),
    onSuccess,
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'TARGET_CONFLICT') setDialog('force')
    },
  })
  const release = useMutation({ mutationFn: (r: string) => api.releaseExec(slug, exec.id, r), onSuccess })
  const cancel = useMutation({ mutationFn: (r: string) => api.cancelExec(slug, exec.id, r), onSuccess })
  const reopen = useMutation({ mutationFn: (r: string) => api.reopenExec(slug, exec.id, r), onSuccess })

  if (!project || project.archived) return null
  const roles = project.my_roles
  const isDev = exec.developer_id === me?.id
  const isAssigner = hasRole(roles, 'assigner')
  const conflicts =
    claim.error instanceof ApiError && claim.error.code === 'TARGET_CONFLICT'
      ? ((claim.error.details as { conflicts?: { id: string; target_resources: string[] }[] })?.conflicts ?? [])
      : []

  return (
    <div className="drawer-actions">
      {!(claim.error instanceof ApiError && claim.error.code === 'TARGET_CONFLICT') && <ErrorText error={claim.error} />}
      {exec.status === 'Queued' && hasRole(roles, 'developer') && (
        <button className="primary" disabled={claim.isPending} onClick={() => claim.mutate(false)}>
          领取
        </button>
      )}
      {exec.status === 'InProgress' && isDev && (
        <button className="primary" onClick={() => setDialog('complete')}>
          标记完成
        </button>
      )}
      {exec.status === 'InProgress' && (isDev || isAssigner) && (
        <button className="ghost" onClick={() => setDialog('release')}>
          {isDev ? '放弃领取' : '释放'}
        </button>
      )}
      {exec.status === 'Done' && (isDev || isAssigner) && (
        <button className="ghost" onClick={() => setDialog('reopen')}>
          重新打开
        </button>
      )}
      {(exec.status === 'Queued' || exec.status === 'InProgress') && isAssigner && (
        <button className="danger ghost" onClick={() => setDialog('cancel')}>
          取消任务
        </button>
      )}

      {dialog === 'force' && (
        <Modal title="目标资源冲突" onClose={() => setDialog(null)}>
          <p>以下进行中的任务也在改同一批资源，继续领取可能产生冲突：</p>
          <ul>
            {conflicts.map((c) => (
              <li key={c.id}>
                <span className="mono">{c.id}</span> <Tags tags={c.target_resources} />
              </li>
            ))}
          </ul>
          <div className="actions">
            <button className="ghost" onClick={() => setDialog(null)}>
              算了
            </button>
            <button className="danger" onClick={() => claim.mutate(true)} disabled={claim.isPending}>
              仍然领取
            </button>
          </div>
        </Modal>
      )}
      {dialog === 'complete' && (
        <CompleteDialog exec={exec} onClose={() => setDialog(null)} onDone={onSuccess} />
      )}
      {dialog === 'release' && (
        <ReasonDialog
          title={`释放 ${exec.id}`}
          confirmText="释放"
          onSubmit={(r) => release.mutate(r)}
          onClose={() => setDialog(null)}
          pending={release.isPending}
          error={release.error}
        >
          <p className="muted">任务会回到「排队中」，其他开发者可以领取。</p>
        </ReasonDialog>
      )}
      {dialog === 'cancel' && (
        <ReasonDialog
          title={`取消 ${exec.id}`}
          confirmText="取消任务"
          danger
          onSubmit={(r) => cancel.mutate(r)}
          onClose={() => setDialog(null)}
          pending={cancel.isPending}
          error={cancel.error}
        >
          <p className="muted">没有其他有效任务的来源小作文会自动回到「待处理」，不会丢失。</p>
        </ReasonDialog>
      )}
      {dialog === 'reopen' && (
        <ReasonDialog
          title={`重新打开 ${exec.id}`}
          confirmText="重新打开"
          onSubmit={(r) => reopen.mutate(r)}
          onClose={() => setDialog(null)}
          pending={reopen.isPending}
          error={reopen.error}
        />
      )}
    </div>
  )
}

function CompleteDialog({ exec, onClose, onDone }: { exec: ExecComposition; onClose: () => void; onDone: () => void }) {
  const slug = useSlug()
  const [notes, setNotes] = useState(exec.developer_notes ?? '')
  const [links, setLinks] = useState('')
  const complete = useMutation({
    mutationFn: () =>
      api.completeExec(
        slug,
        exec.id,
        notes.trim(),
        links
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
      ),
    onSuccess: onDone,
  })
  return (
    <Modal title={`完成 ${exec.id}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          complete.mutate()
        }}
      >
        <label>
          开发说明
          <textarea autoFocus rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} required />
        </label>
        <label>
          交付链接（每行一个，如 PR / 提交地址）
          <textarea rows={3} className="mono" value={links} onChange={(e) => setLinks(e.target.value)} />
        </label>
        <ErrorText error={complete.error} />
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={complete.isPending || !notes.trim()}>
            标记完成
          </button>
        </div>
      </form>
    </Modal>
  )
}
