import { useEffect, useState, type ReactNode } from 'react'
import { ApiError } from '../api/client'
import type { Delivery, ExecStatus, RawStatus } from '../api/types'
import { DELIVERY_LABEL, EXEC_STATUS_LABEL, priorityLabel, RAW_STATUS_LABEL } from '../lib/format'

export function RawBadge({ status }: { status: RawStatus }) {
  return <span className={`badge raw-${status}`}>{RAW_STATUS_LABEL[status]}</span>
}

export function ExecBadge({ status }: { status: ExecStatus }) {
  return <span className={`badge exec-${status}`}>{EXEC_STATUS_LABEL[status]}</span>
}

export function DeliveryBadge({ delivery }: { delivery: Delivery }) {
  return <span className={`badge delivery-${delivery}`}>{DELIVERY_LABEL[delivery]}</span>
}

export function PriorityBadge({ priority }: { priority: number }) {
  return <span className={`badge prio prio-${priority}`}>{priorityLabel(priority)}</span>
}

export function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return null
  return (
    <span className="tags">
      {tags.map((t) => (
        <span key={t} className="tag">
          {t}
        </span>
      ))}
    </span>
  )
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null
  const msg =
    error instanceof ApiError ? `${error.message}（${error.code}）` : error instanceof Error ? error.message : String(error)
  return <div className="error-text">{msg}</div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="ghost icon" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

/** 需要填写原因的确认弹窗：取消、释放、重开、忽略等操作都要求 reason。 */
export function ReasonDialog({
  title,
  confirmText = '确认',
  danger,
  onSubmit,
  onClose,
  pending,
  error,
  children,
}: {
  title: string
  confirmText?: string
  danger?: boolean
  onSubmit: (reason: string) => void
  onClose: () => void
  pending?: boolean
  error?: unknown
  children?: ReactNode
}) {
  const [reason, setReason] = useState('')
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (reason.trim()) onSubmit(reason.trim())
        }}
      >
        {children}
        <label>
          原因
          <textarea autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required />
        </label>
        <ErrorText error={error} />
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className={danger ? 'danger' : 'primary'} disabled={pending || !reason.trim()}>
            {pending ? '提交中…' : confirmText}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function CopyBlock({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="copy-block">
      {label && <div className="copy-label">{label}</div>}
      <pre>{text}</pre>
      <button
        type="button"
        className="ghost small copy-btn"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  )
}

export function Pager({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number
  pageSize: number
  total: number
  onChange: (p: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <div className="pager">
      <button className="ghost small" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        上一页
      </button>
      <span>
        {page} / {pages}（共 {total} 条）
      </span>
      <button className="ghost small" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        下一页
      </button>
    </div>
  )
}
