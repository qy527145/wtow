import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { ImagePlus, Loader2, Paperclip, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../api/client'
import type { Attachment } from '../api/types'
import { cn } from '../lib/cn'
import { errorMessage, Textarea } from './ui'
import { fileUrl, RichBody } from './RichBody'

/** 与服务端 files.rs 的 MAX_BYTES / ALLOWED 保持一致。 */
const MAX_BYTES = 20 * 1024 * 1024
const ACCEPT = 'image/png,image/jpeg,image/gif,text/plain,application/json,application/zip,.txt,.log,.json,.zip'

type Pending = { key: string; name: string }

/**
 * 正文编辑框：支持粘贴、拖入或选择文件。文件立即上传，图片在光标处插入 `![名称](ATT-xxx)`，
 * 与 CLI 的 `--attach` 产出同一种引用格式，Agent 拉取时能换成本地路径。
 */
export function AttachmentEditor({
  slug,
  value,
  onChange,
  attachments,
  onAttachmentsChange,
  rows = 8,
  placeholder,
  required,
  label,
}: {
  label?: string
  slug: string
  value: string
  onChange: (v: string) => void
  attachments: Attachment[]
  onAttachmentsChange: (a: Attachment[]) => void
  rows?: number
  placeholder?: string
  required?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [dragging, setDragging] = useState(false)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  // 回调里读最新值，避免并发上传时互相覆盖。
  const latest = useRef({ value, attachments })
  latest.current = { value, attachments }

  const insertAtCursor = (snippet: string) => {
    const el = ref.current
    const cur = latest.current.value
    const start = el?.selectionStart ?? cur.length
    const end = el?.selectionEnd ?? cur.length
    const before = cur.slice(0, start)
    const after = cur.slice(end)
    const pre = before && !before.endsWith('\n') ? '\n' : ''
    const post = after.startsWith('\n') ? '' : '\n'
    const next = before + pre + snippet + post + after
    onChange(next)
    latest.current.value = next
    const pos = (before + pre + snippet + post).length
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  const upload = async (files: File[]) => {
    for (const raw of files) {
      if (raw.size > MAX_BYTES) {
        toast.error(`${raw.name} 超过 20 MB`)
        continue
      }
      // 截图粘贴进来的文件名都是 image.png，补上时间方便区分。
      const file =
        raw.name === 'image.png' || !raw.name
          ? new File([raw], `截图-${new Date().toTimeString().slice(0, 8).replaceAll(':', '')}.png`, { type: raw.type })
          : raw
      const key = `${file.name}-${Math.random()}`
      setPending((p) => [...p, { key, name: file.name }])
      try {
        const att = await api.uploadFile(slug, file)
        const next = [...latest.current.attachments, att]
        onAttachmentsChange(next)
        latest.current.attachments = next
        const label = file.name.replace(/\.[a-z0-9]+$/i, '')
        insertAtCursor(att.mime.startsWith('image/') ? `![${label}](${att.id})` : `[${file.name}](${att.id})`)
      } catch (e) {
        toast.error(`${file.name} 上传失败：${errorMessage(e)}`)
      } finally {
        setPending((p) => p.filter((x) => x.key !== key))
      }
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files]
    if (files.length === 0) return
    e.preventDefault()
    upload(files)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = [...e.dataTransfer.files]
    if (files.length) upload(files)
  }

  const remove = (att: Attachment) => {
    onAttachmentsChange(attachments.filter((a) => a.id !== att.id))
    // 一并删掉正文里对它的引用，免得提交时服务端报悬空引用。
    const re = new RegExp(`\\n?!?\\[[^\\]\\n]*\\]\\(${att.id}\\)\\n?`, 'g')
    onChange(value.replace(re, '\n'))
  }

  return (
    <div
      className={cn('relative rounded-md border border-rule-strong bg-surface transition-colors focus-within:border-pencil focus-within:ring-3 focus-within:ring-pencil/15', dragging && 'border-pencil bg-pencil-wash/40')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget as Node) || setDragging(false)}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-1 border-b border-rule px-1.5 pt-1">
        {(['write', 'preview'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn('-mb-px border-b-2 px-2.5 pb-1.5 text-[13px]', tab === t ? 'border-pencil font-medium text-ink' : 'border-transparent text-graphite hover:text-ink')}
          >
            {t === 'write' ? '编辑' : '预览'}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="mb-1 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-graphite hover:bg-ink/5 hover:text-ink"
        >
          <ImagePlus className="size-4" />
          添加图片或文件
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            upload([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
      </div>

      {tab === 'write' ? (
        <Textarea
          ref={ref}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={onPaste}
          placeholder={placeholder}
          required={required}
          aria-label={label}
          className="rounded-none border-0 focus:ring-0"
        />
      ) : (
        <div className="scrollbar-quiet max-h-[50vh] min-h-40 overflow-y-auto px-3 py-2">
          {value.trim() ? <RichBody text={value} attachments={attachments} showUnreferenced={false} /> : <div className="py-6 text-center text-[13px] text-faint">还没有内容</div>}
        </div>
      )}

      {(attachments.length > 0 || pending.length > 0) && (
        <div className="flex flex-wrap gap-2 border-t border-rule px-3 py-2.5">
          {attachments.map((a) => (
            <div key={a.id} className="group relative">
              {a.mime.startsWith('image/') ? (
                <img src={fileUrl(slug, a.id)} alt={a.filename} title={a.filename} className="size-14 rounded-md border border-rule object-cover" />
              ) : (
                <div title={a.filename} className="flex h-14 max-w-40 items-center gap-1.5 rounded-md border border-rule px-2.5 text-xs text-graphite">
                  <Paperclip className="size-3.5 shrink-0" />
                  <span className="truncate">{a.filename}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => remove(a)}
                aria-label={`移除 ${a.filename}`}
                className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-ink text-white opacity-0 shadow-lift transition-opacity group-hover:opacity-100 focus:opacity-100"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          {pending.map((p) => (
            <div key={p.key} className="flex size-14 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-rule-strong text-[10px] text-faint">
              <Loader2 className="size-4 animate-spin" />
              上传中
            </div>
          ))}
        </div>
      )}

      <div className="px-3 pb-2 text-xs text-faint">可以直接粘贴截图，或把文件拖进来。单个文件不超过 20 MB。</div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-md border-2 border-dashed border-pencil bg-pencil-wash/70 text-[13px] font-medium text-pencil">
          松开即可上传
        </div>
      )}
    </div>
  )
}
