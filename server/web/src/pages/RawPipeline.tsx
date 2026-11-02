import { useCallback, useState } from 'react'
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { CornerDownRight, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../api/client'
import type { Attachment, RawComposition, RawStatus } from '../api/types'
import { PageHeader } from '../components/Shell'
import { Board, Card, Column, ColumnEmpty, SearchBox, Toolbar, useUrlState } from '../components/board'
import { RawSheet } from '../components/RawSheet'
import { AttachmentHint } from '../components/RichBody'
import { AttachmentEditor } from '../components/AttachmentEditor'
import { ExecSheet } from '../components/ExecSheet'
import { DeliveryPill, Id, RAW_TONE } from '../components/status'
import { Avatar, Button, Check2, Dialog, ErrorNote, Field, Input, Segmented, Tag } from '../components/ui'
import { fmtTime, RAW_STATUS_LABEL } from '../lib/format'
import { POLL_MS, useMemberNames, useProject, useSlug } from '../lib/hooks'
import { useInvalidatePipelines } from '../lib/invalidate'

const OPEN: RawStatus[] = ['Pending', 'Claimed', 'Processed']
const CLOSED: RawStatus[] = ['Merged', 'Duplicate', 'Ignored']
const COLUMN_SIZE = 50
const HINT: Partial<Record<RawStatus, string>> = {
  Pending: '等分配者认领',
  Claimed: '分配者处理中',
  Processed: '已拆成任务',
}

export function RawPipelinePage() {
  const slug = useSlug()
  const project = useProject(slug).data!
  const name = useMemberNames(slug)
  const { params, set } = useUrlState()
  const mine = params.get('mine') === '1'
  const showClosed = params.get('closed') === '1'
  const q = params.get('q') ?? ''
  const tag = params.get('tag') ?? ''
  const [openRaw, setOpenRaw] = useState<string | null>(params.get('open'))
  const [openExec, setOpenExec] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const commitQ = useCallback((v: string) => set('q', v || null), [set])

  const statuses = showClosed ? [...OPEN, ...CLOSED] : OPEN
  const cols = useQueries({
    queries: statuses.map((s) => ({
      queryKey: ['raw', slug, 'col', s, { mine, q, tag }],
      queryFn: () => api.raws(slug, { status: s, mine: mine || undefined, q, tag, page_size: COLUMN_SIZE }),
      refetchInterval: POLL_MS,
      placeholderData: (prev: unknown) => prev as never,
    })),
  })

  return (
    <>
      <PageHeader
        title="原始小作文"
        description="测试者和 Agent 提交的反馈原文。分配者在这里认领，合并重复的、过滤无效的，再拆成执行小作文。"
        actions={
          !project.archived && (
            <Button variant="primary" onClick={() => setSubmitting(true)}>
              <Plus className="size-4" />
              提交小作文
            </Button>
          )
        }
      />
      <Toolbar>
        <Segmented
          value={mine ? 'mine' : 'all'}
          onChange={(v) => set('mine', v === 'mine' ? '1' : null)}
          options={[
            { value: 'all', label: '全部' },
            { value: 'mine', label: '我提交的' },
          ]}
        />
        <SearchBox value={q} onCommit={commitQ} placeholder="搜索标题或描述" />
        {tag && (
          <button
            onClick={() => set('tag', null)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-pencil-wash px-2.5 text-[13px] text-pencil"
          >
            标签：{tag}
            <span aria-hidden>×</span>
          </button>
        )}
        <div className="flex-1" />
        <Check2 checked={showClosed} onChange={(v) => set('closed', v ? '1' : null)}>
          显示已合并、重复、忽略
        </Check2>
      </Toolbar>
      <Board>
        {statuses.map((s, i) => {
          const data = cols[i].data
          const closed = CLOSED.includes(s)
          return (
            <Column
              key={s}
              tone={RAW_TONE[s]}
              title={RAW_STATUS_LABEL[s]}
              hint={HINT[s]}
              total={data?.total}
              loading={cols[i].isFetching && !data}
              overflow={data ? data.total - data.items.length : 0}
              muted={closed}
            >
              <ErrorNote error={cols[i].error} />
              {data?.items.length === 0 && (
                <ColumnEmpty>{s === 'Pending' ? (mine ? '你提交的都已经被处理了。' : '没有待处理的小作文。') : '空'}</ColumnEmpty>
              )}
              {data?.items.map((r) => (
                <RawCard
                  key={r.id}
                  raw={r}
                  reporter={name(r.reporter_id)}
                  claimer={name(r.claimed_by)}
                  onOpen={() => setOpenRaw(r.id)}
                  onTag={(t) => set('tag', t)}
                />
              ))}
            </Column>
          )
        })}
      </Board>
      <RawSheet id={openRaw} onClose={() => setOpenRaw(null)} onOpenExec={setOpenExec} onOpenRaw={setOpenRaw} />
      <ExecSheet id={openExec} onClose={() => setOpenExec(null)} onOpenRaw={setOpenRaw} />
      <SubmitRawDialog open={submitting} onOpenChange={setSubmitting} onCreated={setOpenRaw} />
    </>
  )
}

function RawCard({
  raw,
  reporter,
  claimer,
  onOpen,
  onTag,
}: {
  raw: RawComposition
  reporter: string
  claimer: string
  onOpen: () => void
  onTag: (t: string) => void
}) {
  return (
    <Card onClick={onOpen}>
      <div className="flex items-center gap-2">
        <Id>{raw.id}</Id>
        <span className="flex-1" />
        <AttachmentHint attachments={raw.attachments} />
        {raw.status === 'Processed' && <DeliveryPill delivery={raw.delivery} />}
        <span className="text-xs text-faint">{fmtTime(raw.created_at)}</span>
      </div>
      <div className="mt-1.5 line-clamp-2 leading-snug font-medium group-hover:text-pencil">{raw.title}</div>
      {raw.merged_into_id && (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-merge">
          <CornerDownRight className="size-3" />
          {raw.status === 'Duplicate' ? '重复于' : '并入'} <span className="font-mono">{raw.merged_into_id}</span>
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {raw.tags.slice(0, 3).map((t) => (
            <Tag key={t} onClick={() => onTag(t)}>
              {t}
            </Tag>
          ))}
        </div>
        {raw.status === 'Claimed' ? (
          <span className="flex items-center gap-1 text-xs text-work">
            <Avatar name={claimer} size={16} />
            {claimer}
          </span>
        ) : (
          <Avatar name={reporter} size={18} />
        )}
      </div>
    </Card>
  )
}

function SubmitRawDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: (id: string) => void
}) {
  const slug = useSlug()
  const invalidate = useInvalidatePipelines(slug)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [tags, setTags] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
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
        attachments.map((a) => a.id),
      ),
    onSuccess: (r) => {
      invalidate()
      toast.success(`已提交 ${r.id}`)
      setTitle('')
      setDesc('')
      setTags('')
      setAttachments([])
      onOpenChange(false)
      onCreated(r.id)
    },
  })
  // 最近用过的标签做成快捷选项，减少同义标签。
  const recent = useQuery({
    queryKey: ['raw', slug, 'recent-tags'],
    queryFn: () => api.raws(slug, { page_size: 50 }),
    enabled: open,
    staleTime: 60_000,
  })
  const tagPool = [...new Set((recent.data?.items ?? []).flatMap((r) => r.tags))].slice(0, 10)
  const chosen = tags.split(/[,，\s]+/).filter(Boolean)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="提交小作文"
      description="把看到的问题原样写下来就行，合并、去重和拆分交给分配者。"
      width="lg"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit.mutate()
        }}
      >
        <Field label="标题">
          <Input autoFocus maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="一句话说清是什么问题" required />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">描述</span>
          <AttachmentEditor
            label="描述"
            slug={slug}
            value={desc}
            onChange={setDesc}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            placeholder={'现象：\n复现步骤：\n期望结果：\n\n截图可以直接粘贴进来。'}
            required
          />
        </div>
        <Field label="标签" hint="空格或逗号分隔。">
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="login ios" />
        </Field>
        {tagPool.length > 0 && (
          <div className="-mt-2 flex flex-wrap gap-1">
            {tagPool
              .filter((t) => !chosen.includes(t))
              .map((t) => (
                <Tag key={t} onClick={() => setTags((v) => (v.trim() ? `${v.trim()} ${t}` : t))}>
                  + {t}
                </Tag>
              ))}
          </div>
        )}
        <ErrorNote error={submit.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" loading={submit.isPending}>
            提交
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
