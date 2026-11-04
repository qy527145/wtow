import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "../api/client";
import type { ExecComposition } from "../api/types";
import { fmtDateTime, fmtTime, hasRole } from "../lib/format";
import { useMemberNames, useProject, useSlug } from "../lib/hooks";
import { useInvalidatePipelines } from "../lib/invalidate";
import { LinkRow, Meta, Prose, Section } from "./detail";
import { ReasonDialog } from "./ReasonDialog";
import { AttachmentGrid, RichBody } from "./RichBody";
import { ExecStatusPill, Id, Priority, RawStatusPill } from "./status";
import { Avatar, Button, Dialog, ErrorNote, Field, Sheet, Spinner, Tag, Textarea } from "./ui";

export function ExecSheet({
  id,
  onClose,
  onOpenRaw,
}: {
  id: string | null;
  onClose: () => void;
  onOpenRaw?: (id: string) => void;
}) {
  return (
    <Sheet
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title={id && <Id className="text-[13px] text-graphite">{id}</Id>}
      footer={id && <ExecActionsFooter id={id} />}
    >
      {id && <ExecBody id={id} onOpenRaw={onOpenRaw} />}
    </Sheet>
  );
}

function useExec(id: string) {
  const slug = useSlug();
  return useQuery({ queryKey: ["exec", slug, "one", id], queryFn: () => api.exec(slug, id) });
}

function ExecBody({ id, onOpenRaw }: { id: string; onOpenRaw?: (id: string) => void }) {
  const slug = useSlug();
  const name = useMemberNames(slug);
  const exec = useExec(id);
  const sources = useQuery({
    queryKey: ["exec", slug, "raws", id],
    queryFn: () => api.execRaws(slug, id),
  });
  const e = exec.data;
  if (exec.error) return <ErrorNote error={exec.error} className="m-6" />;
  if (!e) return <Spinner className="mx-auto mt-16" />;
  const links = Array.isArray(e.result_links) ? e.result_links : [];

  return (
    <>
      <div className="px-6 pt-5 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <ExecStatusPill status={e.status} />
          <Priority p={e.priority} />
          {e.target_resources.map((t) => (
            <Tag key={t}>
              <span className="font-mono">{t}</span>
            </Tag>
          ))}
        </div>
        <div className="mt-4">
          <RichBody text={e.instruction} attachments={e.attachments} showUnreferenced={false} />
        </div>
        <div className="mt-4 flex items-center gap-2 text-[13px] text-graphite">
          {e.developer_id ? (
            <>
              <Avatar name={name(e.developer_id)} size={18} />
              {name(e.developer_id)}{" "}
              {e.status === "Done"
                ? `完成于 ${fmtTime(e.completed_at)}`
                : `领取于 ${fmtTime(e.claimed_at)}`}
            </>
          ) : (
            "还没有人领取"
          )}
        </div>
      </div>

      {(e.developer_notes || links.length > 0) && (
        <Section title="交付">
          {e.developer_notes && (
            <div className="rounded-md border-l-2 border-done bg-done-wash/50 px-4 py-3">
              <Prose>{e.developer_notes}</Prose>
            </div>
          )}
          {links.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5">
              {links.map((l) => (
                <a
                  key={l}
                  href={l}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[13px] break-all text-pencil hover:underline"
                >
                  <ExternalLink className="size-3.5 shrink-0" />
                  {l}
                </a>
              ))}
            </div>
          )}
        </Section>
      )}

      <SourceAttachments exec={e} />

      <Section
        title="来源小作文"
        aside={<span className="text-xs text-faint">{e.source_raw_ids.length} 篇</span>}
      >
        <div className="flex flex-col gap-2">
          {(sources.data ?? []).map((r) => (
            <LinkRow key={r.id} onClick={() => onOpenRaw?.(r.id)}>
              <Id>{r.id}</Id>
              <span className="min-w-0 flex-1 truncate text-[13px]">{r.title}</span>
              <span className="text-xs text-faint">{name(r.reporter_id)}</span>
              <RawStatusPill status={r.status} />
            </LinkRow>
          ))}
        </div>
      </Section>

      <Section title="记录">
        <Meta
          items={[
            ["分配者", name(e.assigner_id)],
            ["创建时间", fmtDateTime(e.created_at)],
            ["开发者", e.developer_id ? name(e.developer_id) : "—"],
            ["完成时间", fmtDateTime(e.completed_at)],
          ]}
        />
      </Section>
    </>
  );
}

type DialogKind = null | "release" | "cancel" | "reopen" | "complete" | "force";

function ExecActionsFooter({ id }: { id: string }) {
  const slug = useSlug();
  const project = useProject(slug).data;
  const me = useQuery({ queryKey: ["me"], queryFn: api.me }).data;
  const exec = useExec(id).data;
  const invalidate = useInvalidatePipelines(slug);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const ok = (msg: string) => () => {
    invalidate();
    setDialog(null);
    toast.success(msg);
  };

  const claim = useMutation({
    mutationFn: (force: boolean) => api.claimExec(slug, id, force),
    onSuccess: ok(`已领取 ${id}`),
    onError: (err) =>
      err instanceof ApiError && err.code === "TARGET_CONFLICT" && setDialog("force"),
  });
  const release = useMutation({
    mutationFn: (r: string) => api.releaseExec(slug, id, r),
    onSuccess: ok(`${id} 已回到排队`),
  });
  const cancel = useMutation({
    mutationFn: (r: string) => api.cancelExec(slug, id, r),
    onSuccess: ok(`已取消 ${id}`),
  });
  const reopen = useMutation({
    mutationFn: (r: string) => api.reopenExec(slug, id, r),
    onSuccess: ok(`已重新打开 ${id}`),
  });

  if (!exec || !project || project.archived) return null;
  const roles = project.my_roles;
  const isDev = exec.developer_id === me?.id;
  const isAssigner = hasRole(roles, "assigner");
  const conflict = claim.error instanceof ApiError && claim.error.code === "TARGET_CONFLICT";
  const conflicts = conflict
    ? ((
        (claim.error as ApiError).details as {
          conflicts?: { id: string; target_resources: string[] }[];
        }
      )?.conflicts ?? [])
    : [];

  return (
    <>
      {!conflict && <ErrorNote error={claim.error} className="w-full" />}
      {exec.status === "Queued" && hasRole(roles, "developer") && (
        <Button
          variant="primary"
          loading={claim.isPending && !dialog}
          onClick={() => claim.mutate(false)}
        >
          领取
        </Button>
      )}
      {exec.status === "InProgress" && isDev && (
        <Button variant="primary" onClick={() => setDialog("complete")}>
          标记完成
        </Button>
      )}
      {exec.status === "InProgress" && (isDev || isAssigner) && (
        <Button variant="ghost" onClick={() => setDialog("release")}>
          {isDev ? "放弃领取" : "释放"}
        </Button>
      )}
      {exec.status === "Done" && (isDev || isAssigner) && (
        <Button variant="ghost" onClick={() => setDialog("reopen")}>
          重新打开
        </Button>
      )}
      <div className="flex-1" />
      {(exec.status === "Queued" || exec.status === "InProgress") && isAssigner && (
        <Button variant="quiet-danger" onClick={() => setDialog("cancel")}>
          取消任务
        </Button>
      )}

      <Dialog
        open={dialog === "force"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="有人正在改同一批资源"
        description="下面这些进行中的任务和它的目标资源重叠，同时开工可能互相覆盖。"
        width="sm"
      >
        <div className="flex flex-col gap-2">
          {conflicts.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-2 rounded-md border border-wait/30 bg-wait-wash/50 px-3 py-2"
            >
              <AlertTriangle className="size-4 text-wait" />
              <Id>{c.id}</Id>
              <span className="flex flex-wrap gap-1">
                {c.target_resources.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDialog(null)}>
            先不领
          </Button>
          <Button variant="danger" loading={claim.isPending} onClick={() => claim.mutate(true)}>
            仍然领取
          </Button>
        </div>
      </Dialog>

      <CompleteDialog
        exec={exec}
        open={dialog === "complete"}
        onOpenChange={(o) => setDialog(o ? "complete" : null)}
        onDone={ok(`${id} 已完成`)}
      />

      <ReasonDialog
        open={dialog === "release"}
        onOpenChange={(o) => setDialog(o ? "release" : null)}
        title={`释放 ${id}`}
        description="任务回到「排队中」，其他开发者可以领取。"
        confirmText="释放"
        pending={release.isPending}
        error={release.error}
        onSubmit={(r) => release.mutate(r)}
      />
      <ReasonDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => setDialog(o ? "cancel" : null)}
        title={`取消 ${id}`}
        description="来源小作文如果没有其他有效任务，会自动回到「待处理」，反馈不会丢。"
        confirmText="取消任务"
        danger
        pending={cancel.isPending}
        error={cancel.error}
        onSubmit={(r) => cancel.mutate(r)}
      />
      <ReasonDialog
        open={dialog === "reopen"}
        onOpenChange={(o) => setDialog(o ? "reopen" : null)}
        title={`重新打开 ${id}`}
        description="任务回到「进行中」，原来的交付说明会保留在审计记录里。"
        confirmText="重新打开"
        pending={reopen.isPending}
        error={reopen.error}
        onSubmit={(r) => reopen.mutate(r)}
      />
    </>
  );
}

function CompleteDialog({
  exec,
  open,
  onOpenChange,
  onDone,
}: {
  exec: ExecComposition;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const slug = useSlug();
  const [notes, setNotes] = useState(exec.developer_notes ?? "");
  const [links, setLinks] = useState("");
  const complete = useMutation({
    mutationFn: () =>
      api.completeExec(
        slug,
        exec.id,
        notes.trim(),
        links
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
      ),
    onSuccess: onDone,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`完成 ${exec.id}`}
      description="写清改了什么、怎么验证，提交者能在自己的小作文里看到交付结果。"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          complete.mutate();
        }}
      >
        <Field label="交付说明">
          <Textarea
            autoFocus
            rows={5}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            required
          />
        </Field>
        <Field label="交付链接" hint="每行一个，比如 PR 或提交地址。">
          <Textarea
            rows={3}
            className="font-mono text-[13px]"
            value={links}
            onChange={(e) => setLinks(e.target.value)}
            placeholder="https://"
          />
        </Field>
        <ErrorNote error={complete.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" loading={complete.isPending} disabled={!notes.trim()}>
            标记完成
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** 指令正文没引用到的附件（自身的和来源小作文的），集中展示并标注出处。 */
function SourceAttachments({ exec }: { exec: ExecComposition }) {
  const cited = new Set([...exec.instruction.matchAll(/\]\((ATT-[^)\s]+)\)/g)].map((m) => m[1]));
  const rest = exec.attachments.filter((a) => !cited.has(a.id));
  if (rest.length === 0) return null;
  return (
    <Section
      title="附件"
      aside={<span className="text-xs text-faint">指令里没引用到的 {rest.length} 个</span>}
    >
      <AttachmentGrid attachments={rest} groupByOwner />
    </Section>
  );
}
