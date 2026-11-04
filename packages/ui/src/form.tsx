import { ChevronDown } from "lucide-react";
import {
  cloneElement,
  forwardRef,
  type InputHTMLAttributes,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from "react";
import { cn } from "./lib/utils";

const FIELD_BASE =
  "w-full rounded-md border border-rule-strong bg-surface px-3 text-ink placeholder:text-faint transition-colors " +
  "hover:border-graphite/40 focus:border-pencil focus:outline-none focus:ring-3 focus:ring-pencil/15 " +
  "disabled:bg-paper disabled:text-graphite";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(FIELD_BASE, "h-9", className)} {...rest} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(FIELD_BASE, "resize-y py-2 leading-relaxed", className)}
      {...rest}
    />
  );
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select className={cn(FIELD_BASE, "h-9 appearance-none pr-8")} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-faint" />
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  // 提示文字放在 label 外，用 aria-describedby 关联：不污染控件的可访问名称。
  const id = useId();
  const el = isValidElement(children)
    ? (children as ReactElement<{ id?: string; "aria-describedby"?: string }>)
    : null;
  const control = el
    ? cloneElement(el, {
        id: el.props.id ?? id,
        "aria-describedby": hint ? `${id}-hint` : undefined,
      })
    : children;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
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
  );
}

export function Check2({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 text-[13px]",
        disabled && "opacity-50",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}

/** 分段选择，用于「全部 / 我的」这类二选一筛选。 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="inline-flex rounded-md bg-ink/[0.06] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-[5px] px-3 text-[13px] transition-colors",
            value === o.value
              ? "bg-surface font-medium text-ink shadow-lift"
              : "text-graphite hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
