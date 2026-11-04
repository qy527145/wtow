import { Loader2 } from "lucide-react";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "./lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet-danger";
type Size = "sm" | "md" | "icon";

const VARIANT: Record<Variant, string> = {
  primary: "bg-pencil text-white hover:bg-pencil-deep shadow-[inset_0_-1px_0_rgb(0_0_0/0.15)]",
  secondary:
    "bg-surface text-ink border border-rule-strong hover:border-graphite/50 hover:bg-paper",
  ghost: "text-graphite hover:text-ink hover:bg-ink/5",
  danger: "bg-alarm text-white hover:bg-alarm/90",
  "quiet-danger": "text-alarm hover:bg-alarm-wash",
};
const SIZE: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[13px] gap-1.5",
  md: "h-9 px-3.5 gap-2",
  icon: "h-8 w-8 justify-center",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }
>(function Button(
  { variant = "secondary", size = "md", loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex shrink-0 items-center rounded-md font-medium whitespace-nowrap transition-colors select-none",
        "disabled:pointer-events-none disabled:opacity-45",
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
  );
});
