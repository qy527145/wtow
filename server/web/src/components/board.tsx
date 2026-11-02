import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { Search, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { Input, Spinner } from './ui'
import { StageDot, TONE_TEXT, type Tone } from './status'

/** 看板筛选状态放在 URL 里：刷新、分享链接都能还原。 */
export function useUrlState() {
  const [params, setParams] = useSearchParams()
  const set = useCallback(
    (k: string, v: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (v) next.set(k, v)
          else next.delete(k)
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
  return { params, set }
}

export function SearchBox({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder: string }) {
  const [kw, setKw] = useState(value)
  useEffect(() => setKw(value), [value])
  // 输入停顿 300ms 后再查询，避免每个字都打一次接口。
  useEffect(() => {
    if (kw === value) return
    const t = setTimeout(() => onCommit(kw.trim()), 300)
    return () => clearTimeout(t)
  }, [kw, value, onCommit])
  return (
    <div className="relative w-72 max-sm:w-full">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
      <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder={placeholder} className="h-8 pr-8 pl-8" />
      {kw && (
        <button
          type="button"
          onClick={() => {
            setKw('')
            onCommit('')
          }}
          className="absolute top-1/2 right-2 -translate-y-1/2 text-faint hover:text-ink"
          aria-label="清空"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 border-b border-rule bg-surface px-8 py-3 max-md:px-4">{children}</div>
}

export function Board({ children }: { children: ReactNode }) {
  return (
    <div className="scrollbar-quiet flex flex-1 gap-4 overflow-x-auto px-8 py-5 max-md:px-4">{children}</div>
  )
}

export function Column({
  tone,
  title,
  hint,
  total,
  loading,
  overflow,
  children,
  muted,
}: {
  tone: Tone
  title: string
  hint?: string
  total?: number
  loading?: boolean
  overflow?: number
  children: ReactNode
  muted?: boolean
}) {
  return (
    <section className={cn('flex min-w-[290px] flex-1 basis-0 flex-col', muted ? 'max-w-[320px] opacity-80' : 'max-w-[440px]')}>
      <header className="mb-3 flex items-center gap-2 px-1">
        <StageDot tone={tone} />
        <h2 className={cn('font-semibold', TONE_TEXT[tone])}>{title}</h2>
        <span className="num text-[13px] text-faint">{total ?? ''}</span>
        {loading && <Spinner className="size-3" />}
        {hint && <span className="ml-auto truncate text-xs text-faint">{hint}</span>}
      </header>
      <div className="scrollbar-quiet flex max-h-[calc(100vh-230px)] min-h-32 flex-col gap-2 overflow-y-auto rounded-lg bg-ink/[0.035] p-2">
        {children}
        {!!overflow && overflow > 0 && (
          <div className="py-2 text-center text-xs text-faint">还有 {overflow} 条，用搜索缩小范围</div>
        )}
      </div>
    </section>
  )
}

export function ColumnEmpty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-8 text-center text-[13px] leading-relaxed text-faint">{children}</div>
}

export function Card({ onClick, children, accent }: { onClick: () => void; children: ReactNode; accent?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group w-full rounded-md border border-transparent bg-surface p-3 text-left shadow-lift transition-[border-color,box-shadow]',
        'hover:border-rule-strong hover:shadow-[0_4px_14px_-6px_rgb(21_26_36/0.18)]',
        accent && 'border-l-2 border-l-pencil',
      )}
    >
      {children}
    </button>
  )
}
