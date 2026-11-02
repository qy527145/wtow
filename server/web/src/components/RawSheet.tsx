import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { CornerDownRight, Shuffle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../api/client'
import type { RawComposition } from '../api/types'
import { fmtDateTime, fmtTime, hasRole } from '../lib/format'
import { useMemberNames, useProject, useSlug } from '../lib/hooks'
import { useInvalidatePipelines } from '../lib/invalidate'
import { LinkRow, Meta, Section } from './detail'
import { plainSummary, RichBody } from './RichBody'
import { ReasonDialog } from './ReasonDialog'
import { DeliveryPill, ExecStatusPill, Id, Priority, RawStatusPill } from './status'
import { Avatar, Button, ErrorNote, Sheet, Spinner, Tag } from './ui'

export function RawSheet({
  id,
  onClose,
  onOpenExec,
  onOpenRaw,
}: {
  id: string | null
  onClose: () => void
  onOpenExec?: (id: string) => void
  onOpenRaw?: (id: string) => void
}) {
  return (
    <Sheet
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title={id && <Id className="text-[13px] text-graphite">{id}</Id>}
      footer={id && <RawActionsFooter id={id} />}
    >
      {id && <RawBody id={id} onOpenExec={onOpenExec} onOpenRaw={onOpenRaw} />}
    </Sheet>
  )
}

function useRaw(id: string) {
  const slug = useSlug()
  return useQuery({ queryKey: ['raw', slug, 'one', id], queryFn: () => api.raw(slug, id) })
}

function RawBody({
  id,
  onOpenExec,
  onOpenRaw,
}: {
  id: string
  onOpenExec?: (id: string) => void
  onOpenRaw?: (id: string) => void
}) {
  const slug = useSlug()
  const name = useMemberNames(slug)
  const raw = useRaw(id)
  const execs = useQuery({ queryKey: ['raw', slug, 'execs', id], queryFn: () => api.rawExecs(slug, id) })
  const r = raw.data
  if (raw.error) return <ErrorNote error={raw.error} className="m-6" />
  if (!r) return <Spinner className="mx-auto mt-16" />

  return (
    <>
      <div className="px-6 pt-5 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <RawStatusPill status={r.status} />
          {r.status === 'Processed' && <DeliveryPill delivery={r.delivery} />}
        </div>
        <h2 className="mt-3 font-display text-[22px] leading-snug font-semibold tracking-tight">{r.title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px] text-graphite">
          <Avatar name={name(r.reporter_id)} size={18} />
          {name(r.reporter_id)} 提交于 {fmtTime(r.created_at)}
          {r.tags.length > 0 && <span className="mx-1 text-rule-strong">|</span>}
          {r.tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
        <div className="mt-5 rounded-md bg-paper px-4 py-3.5">
          <RichBody text={r.description} attachments={r.attachments} />
        </div>
      </div>

      {(r.merged_into_id || r.triage_reason) && (
        <Section title={r.status === 'Ignored' ? '忽略原因' : r.status === 'Duplicate' ? '与它重复' : '合并去向'}>
          {r.merged_into_id && (
            <LinkRow onClick={() => onOpenRaw?.(r.merged_into_id!)}>
              <CornerDownRight className="size-4 text-merge" />
              <Id>{r.merged_into_id}</Id>
              <span className="text-[13px] text-graphite">查看目标小作文</span>
            </LinkRow>
          )}
          {r.triage_reason && <p className="mt-2.5 text-[13px] leading-relaxed text-graphite">「{r.triage_reason}」</p>}
        </Section>
      )}

      <Section title="拆出的执行小作文" aside={<span className="text-xs text-faint">{execs.data?.length ?? 0} 条</span>}>
        {execs.data?.length === 0 && <p className="text-[13px] text-graphite">还没有拆分。分配者在工作台里认领后可以拆成任务。</p>}
        <div className="flex flex-col gap-2">
          {execs.data?.map((e) => (
            <LinkRow key={e.id} onClick={() => onOpenExec?.(e.id)}>
              <Priority p={e.priority} />
              <Id>{e.id}</Id>
              <span className="min-w-0 flex-1 truncate text-[13px]">{plainSummary(e.instruction)}</span>
              <ExecStatusPill status={e.status} />
            </LinkRow>
          ))}
        </div>
      </Section>

      <Section title="记录">
        <Meta
          items={[
            ['提交者', name(r.reporter_id)],
            ['提交时间', fmtDateTime(r.created_at)],
            ['最近更新', fmtDateTime(r.updated_at)],
            ...(r.claimed_by
              ? ([['认领人', `${name(r.claimed_by)}，${fmtTime(r.claimed_at)}`]] as [string, string][])
              : []),
          ]}
        />
      </Section>
    </>
  )
}

function RawActionsFooter({ id }: { id: string }) {
  const slug = useSlug()
  const project = useProject(slug).data
  const me = useQuery({ queryKey: ['me'], queryFn: api.me }).data
  const raw = useRaw(id).data
  const invalidate = useInvalidatePipelines(slug)
  const [reopening, setReopening] = useState(false)
  const done = (msg: string) => () => {
    invalidate()
    toast.success(msg)
  }
  const claim = useMutation({ mutationFn: () => api.claimRaw(slug, id), onSuccess: done(`已认领 ${id}`) })
  const release = useMutation({ mutationFn: () => api.releaseRaw(slug, id), onSuccess: done(`已释放 ${id}`) })
  const reopen = useMutation({
    mutationFn: (reason: string) => api.reopenRaw(slug, id, reason),
    onSuccess: () => {
      setReopening(false)
      done(`${id} 已回到待处理`)()
    },
  })

  if (!raw || !project || project.archived || !hasRole(project.my_roles, 'assigner')) return null
  const mine = raw.status === 'Claimed' && raw.claimed_by === me?.id
  const canReopen = (['Merged', 'Duplicate', 'Ignored', 'Processed'] as RawComposition['status'][]).includes(raw.status)

  return (
    <>
      <ErrorNote error={claim.error || release.error} className="w-full" />
      {raw.status === 'Pending' && (
        <Button variant="primary" loading={claim.isPending} onClick={() => claim.mutate()}>
          认领
        </Button>
      )}
      {(raw.status === 'Pending' || mine) && (
        <Link to={`/p/${slug}/workbench?focus=${id}`}>
          <Button>
            <Shuffle className="size-4" />
            去工作台处理
          </Button>
        </Link>
      )}
      {raw.status === 'Claimed' && (mine || hasRole(project.my_roles, 'admin')) && (
        <Button variant="ghost" loading={release.isPending} onClick={() => release.mutate()}>
          {mine ? '释放认领' : '强制释放'}
        </Button>
      )}
      {canReopen && (
        <Button variant="ghost" onClick={() => setReopening(true)}>
          重新打开
        </Button>
      )}
      <ReasonDialog
        open={reopening}
        onOpenChange={setReopening}
        title={`重新打开 ${id}`}
        description="小作文会回到「待处理」，已经拆出的执行小作文保持不变。"
        confirmText="重新打开"
        pending={reopen.isPending}
        error={reopen.error}
        onSubmit={(r) => reopen.mutate(r)}
      />
    </>
  )
}
