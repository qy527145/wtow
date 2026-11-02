import type { Delivery, ExecStatus, RawStatus } from '../api/types'
import { cn } from '../lib/cn'
import { DELIVERY_LABEL, EXEC_STATUS_LABEL, RAW_STATUS_LABEL } from '../lib/format'

/** 阶段 → 色调。同一色调在两条管道中语义一致：等待 / 进行 / 完成 / 归并 / 退出。 */
export type Tone = 'wait' | 'work' | 'done' | 'merge' | 'gone'

export const RAW_TONE: Record<RawStatus, Tone> = {
  Pending: 'wait',
  Claimed: 'work',
  Processed: 'done',
  Merged: 'merge',
  Duplicate: 'gone',
  Ignored: 'gone',
}

export const EXEC_TONE: Record<ExecStatus, Tone> = {
  Queued: 'wait',
  InProgress: 'work',
  Done: 'done',
  Cancelled: 'gone',
}

const DELIVERY_TONE: Record<Delivery, Tone> = {
  none: 'gone',
  in_progress: 'work',
  delivered: 'done',
  cancelled: 'gone',
}

export const TONE_TEXT: Record<Tone, string> = {
  wait: 'text-wait',
  work: 'text-work',
  done: 'text-done',
  merge: 'text-merge',
  gone: 'text-gone',
}
export const TONE_BG: Record<Tone, string> = {
  wait: 'bg-wait',
  work: 'bg-work',
  done: 'bg-done',
  merge: 'bg-merge',
  gone: 'bg-gone',
}
export const TONE_WASH: Record<Tone, string> = {
  wait: 'bg-wait-wash',
  work: 'bg-work-wash',
  done: 'bg-done-wash',
  merge: 'bg-merge-wash',
  gone: 'bg-gone-wash',
}

/** 圆点的填充程度表达进度：空心 = 等待，半满 = 进行，实心 = 完成。 */
export function StageDot({ tone, className }: { tone: Tone; className?: string }) {
  const color = TONE_TEXT[tone]
  return (
    <svg viewBox="0 0 12 12" className={cn('size-3 shrink-0', color, className)} aria-hidden>
      <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {tone === 'work' && <path d="M6 1.25 A4.75 4.75 0 0 1 6 10.75 Z" fill="currentColor" />}
      {(tone === 'done' || tone === 'merge') && <circle cx="6" cy="6" r="3" fill="currentColor" />}
      {tone === 'gone' && <path d="M3.5 6h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  )
}

function Pill({ tone, label, className }: { tone: Tone; label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1.5 rounded-full pr-2 pl-1.5 text-xs font-medium whitespace-nowrap',
        TONE_WASH[tone],
        TONE_TEXT[tone],
        className,
      )}
    >
      <StageDot tone={tone} className="size-[11px]" />
      {label}
    </span>
  )
}

export function RawStatusPill({ status, className }: { status: RawStatus; className?: string }) {
  return <Pill tone={RAW_TONE[status]} label={RAW_STATUS_LABEL[status]} className={className} />
}

export function ExecStatusPill({ status, className }: { status: ExecStatus; className?: string }) {
  return <Pill tone={EXEC_TONE[status]} label={EXEC_STATUS_LABEL[status]} className={className} />
}

export function DeliveryPill({ delivery }: { delivery: Delivery }) {
  const tone = DELIVERY_TONE[delivery]
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs whitespace-nowrap', TONE_TEXT[tone])}>
      <StageDot tone={tone} className="size-[11px]" />
      {DELIVERY_LABEL[delivery]}
    </span>
  )
}

const PRIO_STYLE = [
  'bg-alarm text-white',
  'bg-wait-wash text-wait ring-1 ring-inset ring-wait/25',
  'bg-ink/[0.06] text-graphite',
  'text-faint ring-1 ring-inset ring-rule-strong',
]

export function Priority({ p, className }: { p: number; className?: string }) {
  return (
    <span
      title={['最高优先级', '高优先级', '普通优先级', '低优先级'][p]}
      className={cn(
        'num inline-grid h-[18px] min-w-[26px] place-items-center rounded-[4px] px-1 text-[11px] font-semibold',
        PRIO_STYLE[p] ?? PRIO_STYLE[2],
        className,
      )}
    >
      P{p}
    </span>
  )
}

export function Id({ children, className }: { children: string; className?: string }) {
  return <span className={cn('font-mono text-[12px] text-faint tabular-nums', className)}>{children}</span>
}
