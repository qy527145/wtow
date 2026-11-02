import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { RawComposition } from '../api/types'
import { fmtDateTime, hasRole } from '../lib/format'
import { useMemberNames, useProject, useSlug } from '../lib/hooks'
import { useInvalidatePipelines } from '../lib/invalidate'
import { DeliveryBadge, ErrorText, ExecBadge, PriorityBadge, RawBadge, ReasonDialog, Tags } from './ui'
import { Drawer } from './Drawer'

export function RawDetailDrawer({
  id,
  onClose,
  onOpenExec,
  onOpenRaw,
}: {
  id: string
  onClose: () => void
  onOpenExec?: (id: string) => void
  onOpenRaw?: (id: string) => void
}) {
  const slug = useSlug()
  const name = useMemberNames(slug)
  const raw = useQuery({ queryKey: ['raw', slug, 'one', id], queryFn: () => api.raw(slug, id) })
  const execs = useQuery({ queryKey: ['raw', slug, 'execs', id], queryFn: () => api.rawExecs(slug, id) })
  const r = raw.data

  return (
    <Drawer title={<span className="mono">{id}</span>} onClose={onClose}>
      <ErrorText error={raw.error} />
      {r && (
        <>
          <h2 className="detail-title">{r.title}</h2>
          <div className="meta-row">
            <RawBadge status={r.status} />
            <DeliveryBadge delivery={r.delivery} />
            <Tags tags={r.tags} />
          </div>
          <dl className="kv">
            <dt>提交者</dt>
            <dd>{name(r.reporter_id)}</dd>
            <dt>提交时间</dt>
            <dd>{fmtDateTime(r.created_at)}</dd>
            {r.claimed_by && (
              <>
                <dt>认领人</dt>
                <dd>
                  {name(r.claimed_by)}（{fmtDateTime(r.claimed_at)}）
                </dd>
              </>
            )}
            {r.merged_into_id && (
              <>
                <dt>{r.status === 'Duplicate' ? '重复于' : '合并到'}</dt>
                <dd>
                  <a className="mono" onClick={() => onOpenRaw?.(r.merged_into_id!)}>
                    {r.merged_into_id}
                  </a>
                </dd>
              </>
            )}
            {r.triage_reason && (
              <>
                <dt>判定原因</dt>
                <dd>{r.triage_reason}</dd>
              </>
            )}
          </dl>
          <div className="prose">{r.description}</div>
          {r.attachments.length > 0 && (
            <div className="attachments">
              <h4>附件</h4>
              {r.attachments.map((a) => (
                <a key={a.id} href={`/api/v1/projects/${slug}/files/${a.id}`} target="_blank" rel="noreferrer">
                  {a.filename}（{Math.ceil(a.size_bytes / 1024)} KB）
                </a>
              ))}
            </div>
          )}

          <h4>拆出的执行作文</h4>
          {execs.data?.length === 0 && <div className="muted">暂无。</div>}
          <ul className="list">
            {execs.data?.map((e) => (
              <li key={e.id} onClick={() => onOpenExec?.(e.id)}>
                <span className="mono muted">{e.id}</span>
                <PriorityBadge priority={e.priority} />
                <span className="grow ellipsis">{e.instruction}</span>
                <ExecBadge status={e.status} />
              </li>
            ))}
          </ul>

          <RawActions raw={r} />
        </>
      )}
    </Drawer>
  )
}

function RawActions({ raw }: { raw: RawComposition }) {
  const slug = useSlug()
  const project = useProject(slug).data
  const me = useQuery({ queryKey: ['me'], queryFn: api.me }).data
  const invalidate = useInvalidatePipelines(slug)
  const [dialog, setDialog] = useState<null | 'reopen'>(null)
  const onSuccess = () => {
    invalidate()
    setDialog(null)
  }
  const claim = useMutation({ mutationFn: () => api.claimRaw(slug, raw.id), onSuccess })
  const release = useMutation({ mutationFn: () => api.releaseRaw(slug, raw.id), onSuccess })
  const reopen = useMutation({ mutationFn: (reason: string) => api.reopenRaw(slug, raw.id, reason), onSuccess })

  if (!project || !hasRole(project.my_roles, 'assigner') || project.archived) return null
  const mineClaimed = raw.status === 'Claimed' && raw.claimed_by === me?.id
  const canReopen = ['Merged', 'Duplicate', 'Ignored', 'Processed'].includes(raw.status)

  return (
    <div className="drawer-actions">
      <ErrorText error={claim.error || release.error} />
      {raw.status === 'Pending' && (
        <button className="primary" disabled={claim.isPending} onClick={() => claim.mutate()}>
          认领
        </button>
      )}
      {raw.status === 'Claimed' && (mineClaimed || hasRole(project.my_roles, 'admin')) && (
        <button className="ghost" disabled={release.isPending} onClick={() => release.mutate()}>
          {mineClaimed ? '释放认领' : '强制释放'}
        </button>
      )}
      {canReopen && (
        <button className="ghost" onClick={() => setDialog('reopen')}>
          重新打开
        </button>
      )}
      {(raw.status === 'Pending' || mineClaimed) && <span className="muted small">合并、去重和拆分请到「分配工作台」。</span>}
      {dialog === 'reopen' && (
        <ReasonDialog
          title={`重新打开 ${raw.id}`}
          confirmText="重新打开"
          onSubmit={(r) => reopen.mutate(r)}
          onClose={() => setDialog(null)}
          pending={reopen.isPending}
          error={reopen.error}
        >
          <p className="muted">作文会回到「待处理」，已关联的执行作文保留不变。</p>
        </ReasonDialog>
      )}
    </div>
  )
}
