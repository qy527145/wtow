import { X } from "lucide-react";
import { Dialog as RDialog, DropdownMenu as RMenu, Tooltip as RTooltip } from "radix-ui";
import type { ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./lib/utils";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-[1px] data-[state=open]:animate-fade-in" />
        <RDialog.Content
          className={cn(
            "fixed top-[12vh] left-1/2 z-50 flex max-h-[80vh] w-[calc(100vw-32px)] -translate-x-1/2 flex-col rounded-lg bg-surface shadow-float",
            "focus:outline-none data-[state=open]:animate-pop-in",
            { sm: "max-w-sm", md: "max-w-md", lg: "max-w-2xl" }[width],
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
          {footer && (
            <div className="flex justify-end gap-2 border-t border-rule px-5 py-3">{footer}</div>
          )}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** 右侧抽屉，用于作文详情：看板保持在左侧可见。 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-ink/20 data-[state=open]:animate-fade-in" />
        <RDialog.Content className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[640px] flex-col border-l border-rule bg-surface shadow-float focus:outline-none data-[state=open]:animate-sheet-in">
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-rule px-5">
            <RDialog.Title className="flex flex-1 items-center gap-2 text-[13px]">
              {title}
            </RDialog.Title>
            <RDialog.Description className="sr-only">详情</RDialog.Description>
            <RDialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="关闭">
                <X className="size-4" />
              </Button>
            </RDialog.Close>
          </div>
          <div className="scrollbar-quiet flex-1 overflow-y-auto">{children}</div>
          {footer && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-rule bg-paper/60 px-5 py-3">
              {footer}
            </div>
          )}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function Tip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
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
  );
}

export const Menu = {
  Root: RMenu.Root,
  Trigger: RMenu.Trigger,
  Content({ children, align = "end" }: { children: ReactNode; align?: "start" | "end" }) {
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
    );
  },
  Item({
    children,
    onSelect,
    danger,
  }: {
    children: ReactNode;
    onSelect?: () => void;
    danger?: boolean;
  }) {
    return (
      <RMenu.Item
        onSelect={onSelect}
        className={cn(
          "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] outline-none select-none",
          danger ? "text-alarm data-[highlighted]:bg-alarm-wash" : "data-[highlighted]:bg-paper",
        )}
      >
        {children}
      </RMenu.Item>
    );
  },
  Label({ children }: { children: ReactNode }) {
    return <RMenu.Label className="px-2.5 pt-1.5 pb-1 text-xs text-faint">{children}</RMenu.Label>;
  },
  Separator() {
    return <RMenu.Separator className="my-1 h-px bg-rule" />;
  },
};
