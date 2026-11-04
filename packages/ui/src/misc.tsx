import { Check, Copy } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { cn } from "./lib/utils";

/**
 * 写剪贴板。navigator.clipboard 只在安全上下文（HTTPS / localhost）存在，
 * 用 http://<内网 IP> 部署时它是 undefined，所以退回 execCommand('copy')。
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 权限被拒等情况，继续走兜底 */
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** 选中元素内全部文字，复制失败时让用户能直接 ⌘C。 */
function selectContents(el: HTMLElement | null) {
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export function CopyButton({
  value,
  tone = "dark",
  className,
  fallbackTarget,
}: {
  value: string;
  tone?: "dark" | "light";
  className?: string;
  /** 复制失败时选中这个元素的文字 */
  fallbackTarget?: () => HTMLElement | null;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyText(value);
        if (!ok) selectContents(fallbackTarget?.() ?? null);
        setState(ok ? "copied" : "failed");
        setTimeout(() => setState("idle"), ok ? 1400 : 2400);
      }}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[5px] px-2 text-xs transition-colors",
        tone === "dark"
          ? "bg-white/10 text-white/85 hover:bg-white/20"
          : "bg-surface/70 text-pencil-deep hover:bg-surface",
        className,
      )}
    >
      {state === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {state === "copied" ? "已复制" : state === "failed" ? "已选中，按 ⌘C" : "复制"}
    </button>
  );
}

export function CopyField({
  value,
  label,
  multiline,
}: {
  value: string;
  label?: ReactNode;
  multiline?: boolean;
}) {
  const pre = useRef<HTMLPreElement>(null);
  return (
    <div className="group">
      {label && <div className="mb-1.5 text-xs text-graphite">{label}</div>}
      <div className="relative rounded-md bg-ink text-[#e7eaf0]">
        <pre
          ref={pre}
          className={cn(
            "scrollbar-quiet overflow-x-auto px-3.5 py-2.5 pr-24 font-mono text-[12.5px] leading-relaxed selection:bg-pencil selection:text-white",
            multiline ? "whitespace-pre-wrap" : "whitespace-pre",
          )}
        >
          {value}
        </pre>
        <CopyButton
          value={value}
          fallbackTarget={() => pre.current}
          className="absolute top-1.5 right-1.5"
        />
      </div>
    </div>
  );
}

export function Avatar({
  name,
  size = 22,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  // 用名字算一个稳定色相，团队里不同人一眼可分。
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
  return (
    <span
      title={name}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-medium text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.48,
        background: `oklch(0.58 0.11 ${h})`,
      }}
    >
      {initial}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded border border-rule-strong bg-surface px-1 font-mono text-[11px] text-graphite">
      {children}
    </kbd>
  );
}

export function Tag({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <span
      onClick={
        onClick &&
        ((e) => {
          e.stopPropagation();
          onClick();
        })
      }
      className={cn(
        "inline-flex h-5 items-center rounded-sm bg-ink/[0.06] px-1.5 text-[11.5px] text-graphite",
        onClick && "cursor-pointer hover:bg-pencil-wash hover:text-pencil",
      )}
    >
      {children}
    </span>
  );
}
