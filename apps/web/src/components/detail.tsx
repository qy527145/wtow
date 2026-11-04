import { cn } from "@wtow/ui/lib/utils";
import type { ReactNode } from "react";

/** 详情抽屉里的分节：左侧小标题 + 内容。 */
export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border-t border-rule px-6 py-5", className)}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Meta({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[88px_1fr] gap-x-4 gap-y-2.5 text-[13px]">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-graphite">{k}</dt>
          <dd className="min-w-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="text-[14px] leading-[1.75] break-words whitespace-pre-wrap text-ink">
      {children}
    </div>
  );
}

/** 一行可点击的关联项，用于来源 / 去向列表。 */
export function LinkRow({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md border border-rule bg-surface px-3 py-2.5 text-left transition-colors hover:border-pencil/40 hover:bg-pencil-wash/40"
    >
      {children}
    </button>
  );
}
