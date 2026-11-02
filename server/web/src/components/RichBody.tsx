import { useState, type ReactNode } from 'react'
import { Dialog as RDialog } from 'radix-ui'
import { Download, FileText, ImageOff, Paperclip, X } from 'lucide-react'
import type { Attachment } from '../api/types'
import { cn } from '../lib/cn'
import { useSlug } from '../lib/hooks'

export function fileUrl(slug: string, id: string, download = false) {
  return `/api/v1/projects/${encodeURIComponent(slug)}/files/${id}${download ? '?download=1' : ''}`
}

const isImage = (a: Attachment) => a.mime.startsWith('image/')

function fmtSize(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.ceil(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

type Token =
  | { kind: 'text'; text: string }
  | { kind: 'image'; alt: string; ref: string }
  | { kind: 'link'; text: string; href: string }

/**
 * 正文只认两种标记：`![说明](ATT-xxx 或 URL)` 和 `[文字](URL)`，其余原样保留。
 * 这是 CLI 与 Skill 约定的引用格式（见 cli/skill/references/cli.md），不引入完整 Markdown。
 */
function tokenize(src: string): Token[] {
  const re = /(!?)\[([^\]\n]*)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()（）]+)/g
  const out: Token[] = []
  let last = 0
  for (const m of src.matchAll(re)) {
    if (m.index! > last) out.push({ kind: 'text', text: src.slice(last, m.index) })
    if (m[4]) out.push({ kind: 'link', text: m[4], href: m[4] })
    else if (m[1]) out.push({ kind: 'image', alt: m[2], ref: m[3] })
    else out.push({ kind: 'link', text: m[2] || m[3], href: m[3] })
    last = m.index! + m[0].length
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) })
  // 图片按块显示，紧邻的换行由块本身承担，否则上下会各多出一段空白。
  out.forEach((t, i) => {
    if (t.kind !== 'text') return
    if (out[i - 1]?.kind === 'image') t.text = t.text.replace(/^[ \t]*\n+/, '')
    if (out[i + 1]?.kind === 'image') t.text = t.text.replace(/\n+[ \t]*$/, '')
  })
  return out
}

function safeHref(href: string): string | null {
  return /^https?:\/\//i.test(href) ? href : null
}

/** 作文正文：把附件引用渲染成内联图片，未被正文引用的附件列在下方。 */
export function RichBody({
  text,
  attachments,
  className,
  showUnreferenced = true,
}: {
  text: string
  attachments: Attachment[]
  className?: string
  showUnreferenced?: boolean
}) {
  const slug = useSlug()
  const [preview, setPreview] = useState<{ src: string; alt: string; att?: Attachment } | null>(null)
  const byId = new Map(attachments.map((a) => [a.id, a]))
  const tokens = tokenize(text)
  const referenced = new Set(tokens.flatMap((t) => (t.kind === 'image' && byId.has(t.ref) ? [t.ref] : [])))
  const rest = attachments.filter((a) => !referenced.has(a.id))

  const nodes: ReactNode[] = tokens.map((t, i) => {
    if (t.kind === 'text') return <span key={i}>{t.text}</span>
    if (t.kind === 'link') {
      const href = safeHref(t.href)
      return href ? (
        <a key={i} href={href} target="_blank" rel="noreferrer" className="break-all text-pencil underline decoration-pencil/30 underline-offset-2 hover:decoration-pencil">
          {t.text}
        </a>
      ) : (
        <span key={i}>{t.text}</span>
      )
    }
    const att = byId.get(t.ref)
    if (att && isImage(att)) {
      const src = fileUrl(slug, att.id)
      return <Figure key={i} src={src} alt={t.alt || att.filename} onOpen={() => setPreview({ src, alt: t.alt || att.filename, att })} />
    }
    if (att) return <FileChip key={i} slug={slug} att={att} label={t.alt} inline />
    const href = safeHref(t.ref)
    if (href) return <Figure key={i} src={href} alt={t.alt} onOpen={() => setPreview({ src: href, alt: t.alt })} />
    return <MissingRef key={i} alt={t.alt} ref_={t.ref} />
  })

  return (
    <div className={className}>
      <div className="text-[14px] leading-[1.75] break-words whitespace-pre-wrap text-ink">{nodes}</div>
      {showUnreferenced && rest.length > 0 && <AttachmentGrid attachments={rest} onPreview={setPreview} />}
      <Lightbox preview={preview} onClose={() => setPreview(null)} />
    </div>
  )
}

function Figure({ src, alt, onOpen }: { src: string; alt: string; onOpen: () => void }) {
  const [broken, setBroken] = useState(false)
  if (broken) return <MissingRef alt={alt} ref_="" note="图片加载失败" />
  return (
    <figure className="my-2.5 block whitespace-normal">
      <button
        type="button"
        onClick={onOpen}
        className="group block max-w-full cursor-zoom-in overflow-hidden rounded-md border border-rule bg-surface"
      >
        <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} className="block max-h-[420px] max-w-full object-contain transition-opacity group-hover:opacity-95" />
      </button>
      {alt && <figcaption className="mt-1.5 text-xs text-graphite">{alt}</figcaption>}
    </figure>
  )
}

function MissingRef({ alt, ref_, note }: { alt: string; ref_: string; note?: string }) {
  return (
    <span className="mx-0.5 inline-flex items-center gap-1 rounded bg-gone-wash px-1.5 py-0.5 align-middle text-xs text-graphite" title={ref_}>
      <ImageOff className="size-3.5" />
      {alt || ref_}
      <span className="text-faint">（{note ?? (ref_.startsWith('ATT-') ? '附件不在本作文中' : '本地路径，未上传')}）</span>
    </span>
  )
}

function FileChip({ slug, att, label, inline }: { slug: string; att: Attachment; label?: string; inline?: boolean }) {
  return (
    <a
      href={fileUrl(slug, att.id, true)}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md border border-rule bg-surface px-2.5 py-1.5 text-[13px] whitespace-normal transition-colors hover:border-pencil/40 hover:text-pencil',
        inline && 'mx-0.5 align-middle',
      )}
    >
      <FileText className="size-3.5 shrink-0" />
      <span className="truncate">{label || att.filename}</span>
      <span className="shrink-0 text-xs text-faint">{fmtSize(att.size_bytes)}</span>
    </a>
  )
}

/** 正文没有引用的附件：图片给缩略图，其余给文件卡片。 */
export function AttachmentGrid({
  attachments,
  onPreview,
  groupByOwner,
}: {
  attachments: Attachment[]
  onPreview?: (p: { src: string; alt: string; att?: Attachment }) => void
  groupByOwner?: boolean
}) {
  const slug = useSlug()
  const [local, setLocal] = useState<{ src: string; alt: string; att?: Attachment } | null>(null)
  const open = onPreview ?? setLocal
  const images = attachments.filter(isImage)
  const files = attachments.filter((a) => !isImage(a))
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs text-graphite">
        <Paperclip className="size-3.5" />
        附件 {attachments.length}
      </div>
      {images.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
          {images.map((a) => {
            const src = fileUrl(slug, a.id)
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => open({ src, alt: a.filename, att: a })}
                className="group relative aspect-[4/3] cursor-zoom-in overflow-hidden rounded-md border border-rule bg-[repeating-conic-gradient(#eef0f3_0%_25%,#f7f8fa_0%_50%)] bg-[length:14px_14px]"
                title={a.filename}
              >
                <img src={src} alt={a.filename} loading="lazy" className="size-full object-contain p-1.5 transition-transform duration-200 group-hover:scale-[1.03]" />
                <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-ink/70 to-transparent px-2 pt-4 pb-1 text-left text-[11px] text-white">
                  {groupByOwner && a.owner_id ? `${a.owner_id} · ` : ''}
                  {a.filename}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {files.length > 0 && (
        <div className={cn('flex flex-wrap gap-2', images.length > 0 && 'mt-2')}>
          {files.map((a) => (
            <FileChip key={a.id} slug={slug} att={a} />
          ))}
        </div>
      )}
      {!onPreview && <Lightbox preview={local} onClose={() => setLocal(null)} />}
    </div>
  )
}

function Lightbox({ preview, onClose }: { preview: { src: string; alt: string; att?: Attachment } | null; onClose: () => void }) {
  const slug = useSlug()
  return (
    <RDialog.Root open={!!preview} onOpenChange={(o) => !o && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-[70] bg-ink/85 data-[state=open]:animate-fade-in" />
        <RDialog.Content
          className="fixed inset-0 z-[70] flex flex-col focus:outline-none"
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <div className="flex h-14 shrink-0 items-center gap-3 px-5 text-white">
            <RDialog.Title className="min-w-0 flex-1 truncate text-[13px] text-white/85">{preview?.alt}</RDialog.Title>
            <RDialog.Description className="sr-only">图片预览</RDialog.Description>
            {preview?.att && (
              <a
                href={fileUrl(slug, preview.att.id, true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white/10 px-3 text-[13px] hover:bg-white/20"
              >
                <Download className="size-4" />
                下载
              </a>
            )}
            <RDialog.Close className="grid size-8 place-items-center rounded-md bg-white/10 hover:bg-white/20" aria-label="关闭">
              <X className="size-4" />
            </RDialog.Close>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-6 pt-0" onClick={(e) => e.target === e.currentTarget && onClose()}>
            {preview && <img src={preview.src} alt={preview.alt} className="max-h-full max-w-full rounded-md object-contain shadow-float data-[state=open]:animate-pop-in" />}
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

/** 列表卡片上的轻量提示：有几张图、几个附件。 */
export function AttachmentHint({ attachments }: { attachments?: Attachment[] }) {
  if (!attachments?.length) return null
  const imgs = attachments.filter(isImage).length
  return (
    <span className="inline-flex items-center gap-1 text-xs text-faint" title={`${attachments.length} 个附件`}>
      <Paperclip className="size-3" />
      {imgs ? `${imgs} 图` : attachments.length}
    </span>
  )
}

/** 列表卡片里正文摘要：把附件引用折成「[图] 说明」，避免把 ATT-xxx 原样露出来。 */
export function plainSummary(text: string): string {
  return text.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, (_, alt) => `[图]${alt ? ` ${alt}` : ''}`).replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, '$1')
}
