import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./lib/utils";

/** 带机器可读错误码的错误（web 的 fetch 客户端抛出的就是这种）。ui 包不依赖具体客户端。 */
function errorCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error && typeof error.code === "string")
    return error.code;
  return undefined;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  return (
    <div
      className={cn(
        "rounded-md border border-alarm/25 bg-alarm-wash px-3 py-2 text-[13px] text-alarm",
        className,
      )}
    >
      {errorMessage(error)}
      {errorCode(error) && (
        <span className="ml-1.5 font-mono text-[11px] opacity-70">{errorCode(error)}</span>
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-faint", className)} />;
}

export function Empty({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <div className="font-medium text-ink">{title}</div>
      {children && (
        <div className="mt-1 max-w-sm text-[13px] leading-relaxed text-graphite">{children}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
