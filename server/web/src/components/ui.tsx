import { cloneElement, forwardRef, isValidElement, useId, useRef, useState, type ButtonHTMLAttributes, type ReactElement, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Dialog as RDialog, Tooltip as RTooltip, DropdownMenu as RMenu } from 'radix-ui'
import { Check, ChevronDown, Copy, Loader2, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { ApiError } from '../api/client'

/* ---------- 按钮 ---------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet-danger'
type Size = 'sm' | 'md' | 'icon'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-pencil text-white hover:bg-pencil-deep shadow-[inset_0_-1px_0_rgb(0_0_0/0.15)]',
  secondary: 'bg-surface text-ink border border-rule-strong hover:border-graphite/50 hover:bg-paper',
  ghost: 'text-graphite hover:text-ink hover:bg-ink/5',
  danger: 'bg-alarm text-white hover:bg-alarm/90',
  'quiet-danger': 'text-alarm hover:bg-alarm-wash',
}
const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 gap-2',
  icon: 'h-8 w-8 justify-center',
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }
>(function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex shrink-0 items-center rounded-md font-medium whitespace-nowrap transition-colors select-none',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  )
})

/* ---------- 表单 ---------- */

const FIELD_BASE =
  'w-full rounded-md border border-rule-strong bg-surface px-3 text-ink placeholder:text-faint transition-colors ' +
  'hover:border-graphite/40 focus:border-pencil focus:outline-none focus:ring-3 focus:ring-pencil/15 ' +
  'disabled:bg-paper disabled:text-graphite'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(FIELD_BASE, 'h-9', className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(FIELD_BASE, 'resize-y py-2 leading-relaxed', className)} {...rest} />
})

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn('relative', className)}>
      <select className={cn(FIELD_BASE, 'h-9 appearance-none pr-8')} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-faint" />
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  // 提示文字放在 label 外，用 aria-describedby 关联：不污染控件的可访问名称。
  const id = useId()
  const el = isValidElement(children) ? (children as ReactElement<{ id?: string; 'aria-describedby'?: string }>) : null
  const control = el
    ? cloneElement(el, {
        id: el.props.id ?? id,
        'aria-describedby': hint ? `${id}-hint` : undefined,
      })
    : children
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      {control}
      {hint && (
        <span id={`${id}-hint`} className="text-xs leading-relaxed text-graphite">
          {hint}
        </span>
      )}
    </div>
  )
}

export function Check2({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-[13px]', disabled && 'opacity-50')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

/** 分段选择，用于「全部 / 我的」这类二选一筛选。 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
}) {
  return (
    <div className="inline-flex rounded-md bg-ink/[0.06] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 rounded-[5px] px-3 text-[13px] transition-colors',
            value === o.value ? 'bg-surface font-medium text-ink shadow-lift' : 'text-graphite hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- 反馈 ---------- */

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null
  return (
    <div className={cn('rounded-md border border-alarm/25 bg-alarm-wash px-3 py-2 text-[13px] text-alarm', className)}>
      {errorMessage(error)}
      {error instanceof ApiError && <span className="ml-1.5 font-mono text-[11px] opacity-70">{error.code}</span>}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-faint', className)} />
}

export function Empty({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <div className="font-medium text-ink">{title}</div>
      {children && <div className="mt-1 max-w-sm text-[13px] leading-relaxed text-graphite">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/* ---------- 弹层 ---------- */

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'md',
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: 'sm' | 'md' | 'lg'
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-[1px] data-[state=open]:animate-fade-in" />
        <RDialog.Content
          className={cn(
            'fixed top-[12vh] left-1/2 z-50 flex max-h-[80vh] w-[calc(100vw-32px)] -translate-x-1/2 flex-col rounded-lg bg-surface shadow-float',
            'focus:outline-none data-[state=open]:animate-pop-in',
            { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl' }[width],
          )}
        >
          <div className="flex items-start gap-4 px-5 pt-5 pb-3">
            <div className="flex-1">
              <RDialog.Title className="text-base font-semibold">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-1 text-[13px] leading-relaxed text-graphite">
                  {description}
                </RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{title}</RDialog.Description>
              )}
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="关闭" className="-mt-1 -mr-2">
                <X className="size-4" />
              </Button>
            </RDialog.Close>
          </div>
          <div className="scrollbar-quiet overflow-y-auto px-5 pb-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-rule px-5 py-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

/** 右侧抽屉，用于作文详情：看板保持在左侧可见。 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-ink/20 data-[state=open]:animate-fade-in" />
        <RDialog.Content className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[640px] flex-col border-l border-rule bg-surface shadow-float focus:outline-none data-[state=open]:animate-sheet-in">
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-rule px-5">
            <RDialog.Title className="flex flex-1 items-center gap-2 text-[13px]">{title}</RDialog.Title>
            <RDialog.Description className="sr-only">详情</RDialog.Description>
            <RDialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="关闭">
                <X className="size-4" />
              </Button>
            </RDialog.Close>
          </div>
          <div className="scrollbar-quiet flex-1 overflow-y-auto">{children}</div>
          {footer && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-rule bg-paper/60 px-5 py-3">{footer}</div>
          )}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

export function Tip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <RTooltip.Root delayDuration={250}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="z-[60] max-w-xs rounded-md bg-ink px-2.5 py-1.5 text-xs leading-relaxed text-white shadow-float data-[state=delayed-open]:animate-fade-in"
        >
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}

export const Menu = {
  Root: RMenu.Root,
  Trigger: RMenu.Trigger,
  Content({ children, align = 'end' }: { children: ReactNode; align?: 'start' | 'end' }) {
    return (
      <RMenu.Portal>
        <RMenu.Content
          align={align}
          sideOffset={6}
          className="z-50 min-w-48 rounded-lg border border-rule bg-surface p-1 shadow-float data-[state=open]:animate-pop-in"
        >
          {children}
        </RMenu.Content>
      </RMenu.Portal>
    )
  },
  Item({ children, onSelect, danger }: { children: ReactNode; onSelect?: () => void; danger?: boolean }) {
    return (
      <RMenu.Item
        onSelect={onSelect}
        className={cn(
          'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] outline-none select-none',
          danger ? 'text-alarm data-[highlighted]:bg-alarm-wash' : 'data-[highlighted]:bg-paper',
        )}
      >
        {children}
      </RMenu.Item>
    )
  },
  Label({ children }: { children: ReactNode }) {
    return <RMenu.Label className="px-2.5 pt-1.5 pb-1 text-xs text-faint">{children}</RMenu.Label>
  },
  Separator() {
    return <RMenu.Separator className="my-1 h-px bg-rule" />
  },
}

/* ---------- 小件 ---------- */

/**
 * 写剪贴板。navigator.clipboard 只在安全上下文（HTTPS / localhost）存在，
 * 用 http://<内网 IP> 部署时它是 undefined，所以退回 execCommand('copy')。
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* 权限被拒等情况，继续走兜底 */
    }
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  return ok
}

/** 选中元素内全部文字，复制失败时让用户能直接 ⌘C。 */
function selectContents(el: HTMLElement | null) {
  if (!el) return
  const range = document.createRange()
  range.selectNodeContents(el)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

export function CopyButton({
  value,
  tone = 'dark',
  className,
  fallbackTarget,
}: {
  value: string
  tone?: 'dark' | 'light'
  className?: string
  /** 复制失败时选中这个元素的文字 */
  fallbackTarget?: () => HTMLElement | null
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyText(value)
        if (!ok) selectContents(fallbackTarget?.() ?? null)
        setState(ok ? 'copied' : 'failed')
        setTimeout(() => setState('idle'), ok ? 1400 : 2400)
      }}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[5px] px-2 text-xs transition-colors',
        tone === 'dark' ? 'bg-white/10 text-white/85 hover:bg-white/20' : 'bg-surface/70 text-pencil-deep hover:bg-surface',
        className,
      )}
    >
      {state === 'copied' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {state === 'copied' ? '已复制' : state === 'failed' ? '已选中，按 ⌘C' : '复制'}
    </button>
  )
}

export function CopyField({ value, label, multiline }: { value: string; label?: ReactNode; multiline?: boolean }) {
  const pre = useRef<HTMLPreElement>(null)
  return (
    <div className="group">
      {label && <div className="mb-1.5 text-xs text-graphite">{label}</div>}
      <div className="relative rounded-md bg-ink text-[#e7eaf0]">
        <pre
          ref={pre}
          className={cn(
            'scrollbar-quiet overflow-x-auto px-3.5 py-2.5 pr-24 font-mono text-[12.5px] leading-relaxed selection:bg-pencil selection:text-white',
            multiline ? 'whitespace-pre-wrap' : 'whitespace-pre',
          )}
        >
          {value}
        </pre>
        <CopyButton value={value} fallbackTarget={() => pre.current} className="absolute top-1.5 right-1.5" />
      </div>
    </div>
  )
}

export function Avatar({ name, size = 22, className }: { name: string; size?: number; className?: string }) {
  // 用名字算一个稳定色相，团队里不同人一眼可分。
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  const initial = [...name.trim()][0]?.toUpperCase() ?? '?'
  return (
    <span
      title={name}
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-medium text-white', className)}
      style={{ width: size, height: size, fontSize: size * 0.48, background: `oklch(0.58 0.11 ${h})` }}
    >
      {initial}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded border border-rule-strong bg-surface px-1 font-mono text-[11px] text-graphite">
      {children}
    </kbd>
  )
}

export function Tag({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <span
      onClick={
        onClick &&
        ((e) => {
          e.stopPropagation()
          onClick()
        })
      }
      className={cn(
        'inline-flex h-5 items-center rounded-sm bg-ink/[0.06] px-1.5 text-[11.5px] text-graphite',
        onClick && 'cursor-pointer hover:bg-pencil-wash hover:text-pencil',
      )}
    >
      {children}
    </span>
  )
}
