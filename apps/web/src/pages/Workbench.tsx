import { useMutation, useQuery } from "@tanstack/react-query";
import { cn } from "@wtow/ui/lib/utils";
import { ArrowRight, CopyX, EyeOff, GitMerge, Inbox, Layers, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { api } from "../api/client";
import type { Attachment, ExecComposition, RawComposition, RelatedItem } from "../api/types";
import { AttachmentEditor } from "../components/AttachmentEditor";
import { RichBody } from "../components/RichBody";
import { PageHeader } from "../components/Shell";
import { ExecStatusPill, Id, Priority, RawStatusPill } from "../components/status";
import {
  Avatar,
  Button,
  Check2,
  Dialog,
  Empty,
  ErrorNote,
  Field,
  Input,
  Kbd,
  Select,
  Spinner,
  Tag,
  Textarea,
} from "../components/ui";
import { EXEC_STATUS_LABEL, fmtTime, PRIORITIES, RAW_STATUS_LABEL } from "../lib/format";
import { POLL_MS, useMemberNames, useProject, useSlug } from "../lib/hooks";
import { useInvalidatePipelines } from "../lib/invalidate";

type TriageAction = "merge" | "duplicate" | "ignore";

/**
 * 分配工作台（DESIGN 10.1）：左侧队列，中间当前小作文与相似项对照，右侧执行小作文草稿。
 * 「多选 + 草稿」替代拖拽：读一篇、判定或加入草稿、凑齐后一次性建联。
 */
export function WorkbenchPage() {
  const slug = useSlug();
  const project = useProject(slug).data!;
  const me = useQuery({ queryKey: ["me"], queryFn: api.me }).data;
  const [params, setParams] = useSearchParams();
  const [focus, setFocusState] = useState<string | null>(params.get("focus"));
  const [draft, setDraft] = useState<string[]>([]);
  const setFocus = (id: string | null) => {
    setFocusState(id);
    setParams(id ? { focus: id } : {}, { replace: true });
  };

  const pending = useQuery({
    queryKey: ["raw", slug, "col", "Pending", "wb"],
    queryFn: () => api.raws(slug, { status: "Pending", page_size: 100 }),
    refetchInterval: POLL_MS,
  });
  const claimed = useQuery({
    queryKey: ["raw", slug, "col", "Claimed", "wb"],
    queryFn: () => api.raws(slug, { status: "Claimed", page_size: 100 }),
    refetchInterval: POLL_MS,
  });
  const myClaimed = (claimed.data?.items ?? []).filter((r) => r.claimed_by === me?.id);
  const othersClaimed = (claimed.data?.items ?? []).filter((r) => r.claimed_by !== me?.id);
  const queue = [...myClaimed, ...(pending.data?.items ?? [])];

  // j / k 在队列里上下移动，像读邮件一样连续处理。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [role=dialog]")) return;
      if (e.key !== "j" && e.key !== "k") return;
      const i = queue.findIndex((r) => r.id === focus);
      const next = queue[e.key === "j" ? Math.min(queue.length - 1, i + 1) : Math.max(0, i - 1)];
      if (next) setFocus(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (project.archived) {
    return (
      <>
        <PageHeader title="分配工作台" />
        <Empty title="项目已归档" className="mt-10">
          归档项目不能再认领和分配。
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="分配工作台"
        description={
          <>
            认领一篇，对照相似项决定合并、标记重复、忽略，或者加入右侧草稿拆成执行小作文。按{" "}
            <Kbd>J</Kbd> <Kbd>K</Kbd> 切换上下篇。
          </>
        }
      />
      <div className="grid flex-1 grid-cols-[300px_minmax(0,1fr)_360px] max-xl:grid-cols-[260px_minmax(0,1fr)] max-lg:grid-cols-1">
        <aside className="scrollbar-quiet border-r border-rule bg-surface max-lg:border-b lg:sticky lg:top-0 lg:h-[calc(100vh-0px)] lg:overflow-y-auto">
          <QueueGroup title="我认领的" count={myClaimed.length} empty="从下面认领一篇开始。">
            {myClaimed.map((r) => (
              <QueueItem
                key={r.id}
                raw={r}
                active={focus === r.id}
                inDraft={draft.includes(r.id)}
                onClick={() => setFocus(r.id)}
              />
            ))}
          </QueueGroup>
          <QueueGroup title="待处理" count={pending.data?.total} empty="队列已清空。">
            {pending.data?.items.map((r) => (
              <QueueItem
                key={r.id}
                raw={r}
                active={focus === r.id}
                onClick={() => setFocus(r.id)}
              />
            ))}
          </QueueGroup>
          {othersClaimed.length > 0 && (
            <QueueGroup title="其他人处理中" count={othersClaimed.length}>
              {othersClaimed.map((r) => (
                <QueueItem
                  key={r.id}
                  raw={r}
                  active={focus === r.id}
                  onClick={() => setFocus(r.id)}
                  dim
                />
              ))}
            </QueueGroup>
          )}
        </aside>

        <section className="min-w-0 bg-paper">
          {focus ? (
            <FocusPanel
              key={focus}
              id={focus}
              meId={me?.id}
              inDraft={draft.includes(focus)}
              onAddDraft={() => setDraft((d) => (d.includes(focus) ? d : [...d, focus]))}
              onFocus={setFocus}
              onResolved={() => {
                setDraft((d) => d.filter((x) => x !== focus));
                const i = queue.findIndex((r) => r.id === focus);
                const next = queue.filter((r) => r.id !== focus)[Math.max(0, i)];
                setFocus(next?.id ?? null);
              }}
            />
          ) : (
            <Empty
              icon={<Inbox className="size-9" strokeWidth={1.4} />}
              title={queue.length ? "从左侧选一篇开始" : "没有需要处理的小作文"}
              className="mt-16"
            >
              {queue.length
                ? "认领后可以查看相似项、合并或拆分。"
                : "新的反馈提交后会出现在左侧队列。"}
            </Empty>
          )}
        </section>

        <aside className="border-l border-rule bg-surface max-xl:col-span-2 max-xl:border-t max-xl:border-l-0 max-lg:col-span-1 xl:sticky xl:top-0 xl:h-screen xl:overflow-y-auto">
          <DraftPanel draft={draft} setDraft={setDraft} />
        </aside>
      </div>
    </>
  );
}

function QueueGroup({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count?: number;
  empty?: string;
  children: React.ReactNode;
}) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="border-b border-rule py-3 last:border-0">
      <div className="mb-1.5 flex items-center gap-2 px-4 text-xs text-graphite">
        <span className="font-medium">{title}</span>
        <span className="num text-faint">{count ?? ""}</span>
      </div>
      {has ? (
        <ul className="px-2">{children}</ul>
      ) : (
        empty && <div className="px-4 py-2 text-xs text-faint">{empty}</div>
      )}
    </div>
  );
}

function QueueItem({
  raw,
  active,
  inDraft,
  dim,
  onClick,
}: {
  raw: RawComposition;
  active: boolean;
  inDraft?: boolean;
  dim?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          "relative flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors",
          active ? "bg-pencil-wash" : "hover:bg-ink/[0.04]",
          dim && !active && "opacity-55",
        )}
      >
        {active && <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-pencil" />}
        <span className="flex items-center gap-2">
          <Id className="text-[11px]">{raw.id}</Id>
          {inDraft && (
            <span className="rounded-sm bg-pencil px-1 text-[10px] leading-4 text-white">草稿</span>
          )}
          <span className="ml-auto text-[11px] text-faint">{fmtTime(raw.created_at)}</span>
        </span>
        <span
          className={cn(
            "line-clamp-2 text-[13px] leading-snug",
            active && "font-medium text-pencil",
          )}
        >
          {raw.title}
        </span>
      </button>
    </li>
  );
}

function FocusPanel({
  id,
  meId,
  inDraft,
  onAddDraft,
  onFocus,
  onResolved,
}: {
  id: string;
  meId: number | undefined;
  inDraft: boolean;
  onAddDraft: () => void;
  onFocus: (id: string) => void;
  onResolved: () => void;
}) {
  const slug = useSlug();
  const name = useMemberNames(slug);
  const invalidate = useInvalidatePipelines(slug);
  const raw = useQuery({ queryKey: ["raw", slug, "one", id], queryFn: () => api.raw(slug, id) });
  const r = raw.data;
  const mine = r?.status === "Claimed" && r.claimed_by === meId;
  const canTriage = r?.status === "Pending" || mine;
  // 只在能判定时拉相似项：服务端把这次查看记入审计，作为合并 / 建联的前置条件。
  const related = useQuery({
    queryKey: ["raw", slug, "related", id, r?.claimed_at ?? null],
    queryFn: () => api.related(slug, id),
    enabled: !!canTriage,
    staleTime: Infinity,
  });
  const [compare, setCompare] = useState<string | null>(null);
  const [triage, setTriage] = useState<null | { action: TriageAction; target?: string }>(null);
  const claim = useMutation({
    mutationFn: () => api.claimRaw(slug, id),
    onSuccess: () => {
      invalidate();
      toast.success(`已认领 ${id}`);
    },
  });
  const release = useMutation({
    mutationFn: () => api.releaseRaw(slug, id),
    onSuccess: () => {
      invalidate();
      toast(`已释放 ${id}`);
    },
  });

  if (raw.error) return <ErrorNote error={raw.error} className="m-8" />;
  if (!r) return <Spinner className="mx-auto mt-16" />;

  return (
    <div className="mx-auto max-w-[860px] px-8 py-6 max-md:px-4">
      <article className="rounded-lg border border-rule bg-surface">
        <div className="px-6 pt-5 pb-5">
          <div className="flex flex-wrap items-center gap-2">
            <Id>{r.id}</Id>
            <RawStatusPill status={r.status} />
            {r.tags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
            <span className="ml-auto flex items-center gap-1.5 text-xs text-graphite">
              <Avatar name={name(r.reporter_id)} size={16} />
              {name(r.reporter_id)}，{fmtTime(r.created_at)}
            </span>
          </div>
          <h2 className="mt-3 font-display text-[22px] leading-snug font-semibold tracking-tight">
            {r.title}
          </h2>
          <div className="scrollbar-quiet mt-3 max-h-[560px] overflow-y-auto">
            <RichBody text={r.description} attachments={r.attachments} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-paper/60 px-6 py-3">
          <ErrorNote error={claim.error || release.error} className="w-full" />
          {r.status === "Pending" && (
            <Button variant="primary" loading={claim.isPending} onClick={() => claim.mutate()}>
              认领这篇
            </Button>
          )}
          {mine && (
            <Button variant="primary" onClick={onAddDraft} disabled={inDraft}>
              <Layers className="size-4" />
              {inDraft ? "已在草稿里" : "加入执行草稿"}
            </Button>
          )}
          {canTriage && (
            <>
              <Button onClick={() => setTriage({ action: "merge" })}>
                <GitMerge className="size-4" />
                合并到…
              </Button>
              <Button onClick={() => setTriage({ action: "duplicate" })}>
                <CopyX className="size-4" />
                标记重复…
              </Button>
            </>
          )}
          <span className="flex-1" />
          {canTriage && (
            <Button variant="ghost" onClick={() => setTriage({ action: "ignore" })}>
              <EyeOff className="size-4" />
              忽略
            </Button>
          )}
          {mine && (
            <Button variant="ghost" loading={release.isPending} onClick={() => release.mutate()}>
              释放
            </Button>
          )}
          {r.status === "Claimed" && !mine && (
            <span className="text-[13px] text-graphite">{name(r.claimed_by)} 正在处理这篇。</span>
          )}
          {!canTriage && r.status !== "Claimed" && (
            <span className="text-[13px] text-graphite">这篇已经处理过了。</span>
          )}
        </div>
      </article>

      {canTriage && (
        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="size-4 text-pencil" />
            <h3 className="font-semibold">相似项</h3>
            <span className="text-xs text-faint">按标签和文本相似度排序，判定前先看一眼</span>
            {related.isFetching && <Spinner className="size-3" />}
          </div>
          <ErrorNote error={related.error} />
          {related.data?.length === 0 && (
            <div className="rounded-lg border border-dashed border-rule-strong px-4 py-6 text-center text-[13px] text-graphite">
              没有发现相似的小作文或任务，可以放心拆分。
            </div>
          )}
          <div className="flex flex-col gap-2">
            {related.data?.map((it) => (
              <RelatedCard
                key={it.kind + it.id}
                it={it}
                open={compare === it.id}
                onToggle={() => setCompare(compare === it.id ? null : it.id)}
                onFocus={() => onFocus(it.id)}
                onMerge={() => setTriage({ action: "merge", target: it.id })}
                onDuplicate={() => setTriage({ action: "duplicate", target: it.id })}
              />
            ))}
          </div>
        </section>
      )}

      <TriageDialog
        raw={r}
        state={triage}
        candidates={(related.data ?? []).filter((x) => x.kind === "raw")}
        onClose={() => setTriage(null)}
        onDone={(msg) => {
          setTriage(null);
          invalidate();
          toast.success(msg);
          onResolved();
        }}
      />
    </div>
  );
}

function RelatedCard({
  it,
  open,
  onToggle,
  onFocus,
  onMerge,
  onDuplicate,
}: {
  it: RelatedItem;
  open: boolean;
  onToggle: () => void;
  onFocus: () => void;
  onMerge: () => void;
  onDuplicate: () => void;
}) {
  const slug = useSlug();
  const detail = useQuery({
    queryKey: [it.kind, slug, "one", it.id],
    queryFn: (): Promise<RawComposition | ExecComposition> =>
      it.kind === "raw" ? api.raw(slug, it.id) : api.exec(slug, it.id),
    enabled: open,
  });
  const strength = Math.min(1, it.score / 4);
  return (
    <div
      className={cn(
        "rounded-lg border bg-surface transition-colors",
        open ? "border-pencil/40" : "border-rule",
      )}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left"
        >
          <span
            className="relative h-8 w-1 shrink-0 overflow-hidden rounded-full bg-ink/[0.07]"
            title={`相似度 ${it.score.toFixed(2)}`}
          >
            <span
              className="absolute inset-x-0 bottom-0 rounded-full bg-pencil"
              style={{ height: `${Math.max(12, strength * 100)}%` }}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded-sm px-1.5 text-[11px] leading-[18px] font-medium",
                  it.kind === "raw" ? "bg-wait-wash text-wait" : "bg-done-wash text-done",
                )}
              >
                {it.kind === "raw" ? "小作文" : "执行任务"}
              </span>
              <Id>{it.id}</Id>
              <span className="text-xs text-faint">{statusText(it)}</span>
            </span>
            <span className="mt-0.5 block truncate text-[13.5px]">{it.title}</span>
            <span className="mt-0.5 block truncate text-xs text-faint">
              {it.reasons.map(reasonText).join("，")}
            </span>
          </span>
        </button>
        {it.kind === "raw" && (
          <span className="flex shrink-0 gap-1 pr-4">
            <Button size="sm" onClick={onMerge}>
              合并进去
            </Button>
            <Button size="sm" variant="ghost" onClick={onDuplicate}>
              重复
            </Button>
          </span>
        )}
      </div>
      {open && (
        <div className="border-t border-rule px-4 py-3">
          {detail.isPending && <Spinner />}
          {detail.data && "description" in detail.data && (
            <>
              <div className="scrollbar-quiet max-h-72 overflow-y-auto">
                <RichBody text={detail.data.description} attachments={detail.data.attachments} />
              </div>
              <Button size="sm" variant="ghost" className="mt-2 -ml-2" onClick={onFocus}>
                切换到这篇
                <ArrowRight className="size-3.5" />
              </Button>
            </>
          )}
          {detail.data && "instruction" in detail.data && (
            <>
              <ExecStatusPill status={detail.data.status} />
              <div className="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap text-graphite">
                {detail.data.instruction}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function statusText(it: RelatedItem): string {
  return it.kind === "raw"
    ? ((RAW_STATUS_LABEL as Record<string, string>)[it.status] ?? it.status)
    : ((EXEC_STATUS_LABEL as Record<string, string>)[it.status] ?? it.status);
}

/** 服务端给的是英文说明（如 "title similarity 0.42"），这里转成可读中文。 */
function reasonText(r: string): string {
  const m = r.match(/^([\d.]+) shared tags$/);
  if (m) return `共享 ${Number(m[1])} 个标签`;
  const t = r.match(/^title similarity ([\d.]+)$/);
  if (t) return `标题相似 ${Math.round(Number(t[1]) * 100)}%`;
  const d = r.match(/^description similarity ([\d.]+)$/);
  if (d) return `描述相似 ${Math.round(Number(d[1]) * 100)}%`;
  return r;
}

const TRIAGE_COPY: Record<
  TriageAction,
  { title: string; hint: string; button: string; done: string }
> = {
  merge: {
    title: "合并到另一篇",
    hint: "两篇说的是同一个问题，但这篇有补充信息。合并后跟随目标一起处理。",
    button: "合并",
    done: "已合并",
  },
  duplicate: {
    title: "标记为重复",
    hint: "和目标完全一样，没有新信息。",
    button: "标记重复",
    done: "已标记为重复",
  },
  ignore: {
    title: "忽略这篇",
    hint: "不是问题、无法复现或超出范围。之后可以重新打开。",
    button: "忽略",
    done: "已忽略",
  },
};

function TriageDialog({
  raw,
  state,
  candidates,
  onClose,
  onDone,
}: {
  raw: RawComposition;
  state: null | { action: TriageAction; target?: string };
  candidates: RelatedItem[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const slug = useSlug();
  const action = state?.action ?? "merge";
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    setTarget(state?.target ?? "");
    setReason("");
  }, [state]);
  const run = useMutation({
    mutationFn: () =>
      api.triageRaw(slug, raw.id, action, {
        target_id: action === "ignore" ? undefined : target.trim(),
        reason: reason.trim(),
      }),
    onSuccess: () => onDone(`${raw.id} ${TRIAGE_COPY[action].done}`),
  });
  const copy = TRIAGE_COPY[action];
  return (
    <Dialog
      open={!!state}
      onOpenChange={(o) => !o && onClose()}
      title={`${copy.title}`}
      description={copy.hint}
      width="sm"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run.mutate();
        }}
      >
        <div className="rounded-md bg-paper px-3 py-2 text-[13px]">
          <Id>{raw.id}</Id> <span className="ml-1">{raw.title}</span>
        </div>
        {action !== "ignore" && (
          <Field label="目标小作文">
            {candidates.length > 0 ? (
              <Select value={target} onChange={(e) => setTarget(e.target.value)} required>
                <option value="">选择一篇…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id}　{c.title}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                className="font-mono"
                value={target}
                onChange={(e) => setTarget(e.target.value.toUpperCase())}
                placeholder="RAW-1001"
                required
              />
            )}
          </Field>
        )}
        <Field label="原因" hint="会写进审计记录，提交者能看到。">
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            autoFocus={action === "ignore" || !!state?.target}
          />
        </Field>
        <ErrorNote error={run.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            loading={run.isPending}
            disabled={!reason.trim() || (action !== "ignore" && !target)}
          >
            {copy.button}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DraftPanel({
  draft,
  setDraft,
}: {
  draft: string[];
  setDraft: (f: (d: string[]) => string[]) => void;
}) {
  const slug = useSlug();
  const invalidate = useInvalidatePipelines(slug);
  const [instruction, setInstruction] = useState("");
  const [targets, setTargets] = useState("");
  const [priority, setPriority] = useState(2);
  const [close, setClose] = useState(true);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const create = useMutation({
    mutationFn: () =>
      api.createExec(slug, {
        source_raw_ids: draft,
        instruction: instruction.trim(),
        target_resources: targets
          .split(/[,，\s]+/)
          .map((t) => t.trim())
          .filter(Boolean),
        priority,
        close_sources: close,
        attachment_ids: attachments.map((a) => a.id),
      }),
    onSuccess: (e) => {
      invalidate();
      toast.success(`已创建 ${e.id}`, {
        description: close ? "来源已标记为已拆分。" : "来源仍由你认领，可以继续拆下一条。",
      });
      setInstruction("");
      setTargets("");
      setAttachments([]);
      if (close) setDraft(() => []);
    },
  });

  return (
    <form
      className="flex flex-col gap-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div>
        <h2 className="font-semibold">新执行小作文</h2>
        <p className="mt-1 text-xs leading-relaxed text-graphite">
          一篇可以拆成多条，多篇也可以合成一条。来源必须是你认领中的小作文。
        </p>
      </div>

      <div className="rounded-md border border-dashed border-rule-strong p-2">
        <div className="mb-1.5 px-1 text-xs text-graphite">来源（{draft.length}）</div>
        {draft.length === 0 ? (
          <div className="px-1 py-2 text-xs text-faint">在中间点「加入执行草稿」。</div>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {draft.map((id) => (
              <li
                key={id}
                className="inline-flex h-6 items-center gap-1 rounded-full bg-pencil-wash pr-1 pl-2.5 font-mono text-xs text-pencil"
              >
                {id}
                <button
                  type="button"
                  className="grid size-4 place-items-center rounded-full hover:bg-pencil/15"
                  onClick={() => setDraft((d) => d.filter((x) => x !== id))}
                  aria-label={`移除 ${id}`}
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">开发指令</span>
        <AttachmentEditor
          label="开发指令"
          slug={slug}
          value={instruction}
          onChange={setInstruction}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          rows={7}
          placeholder={"修复……\n验收：……"}
          required
        />
        <span className="text-xs leading-relaxed text-graphite">
          开发者或 Agent 只看这里：要改什么，怎么验收。来源小作文的截图会自动带给开发者。
        </span>
      </div>
      <Field label="目标资源" hint="改动涉及的模块或路径，用来提醒并行冲突。">
        <Input
          className="font-mono text-[13px]"
          value={targets}
          onChange={(e) => setTargets(e.target.value)}
          placeholder="web/login api/auth"
        />
      </Field>
      <Field label="优先级">
        <div className="grid grid-cols-4 gap-1.5">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              className={cn(
                "flex h-9 items-center justify-center gap-1.5 rounded-md border text-[13px] transition-colors",
                priority === p
                  ? "border-pencil bg-pencil-wash"
                  : "border-rule-strong hover:bg-paper",
              )}
            >
              <Priority p={p} />
            </button>
          ))}
        </div>
      </Field>
      <Check2 checked={close} onChange={setClose}>
        创建后把来源标记为「已拆分」
      </Check2>
      <ErrorNote error={create.error} />
      <Button
        variant="primary"
        className="h-10 justify-center"
        loading={create.isPending}
        disabled={draft.length === 0 || !instruction.trim()}
      >
        创建执行小作文
      </Button>
    </form>
  );
}
