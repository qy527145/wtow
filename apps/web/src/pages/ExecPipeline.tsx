import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { api } from "../api/client";
import type { ExecComposition, ExecStatus } from "../api/types";
import {
  Board,
  Card,
  Column,
  ColumnEmpty,
  SearchBox,
  Toolbar,
  useUrlState,
} from "../components/board";
import { ExecSheet } from "../components/ExecSheet";
import { RawSheet } from "../components/RawSheet";
import { AttachmentHint, plainSummary } from "../components/RichBody";
import { PageHeader } from "../components/Shell";
import { EXEC_TONE, Id, Priority } from "../components/status";
import { Avatar, Check2, ErrorNote, Segmented, Tag } from "../components/ui";
import { EXEC_STATUS_LABEL, fmtTime } from "../lib/format";
import { POLL_MS, useMemberNames, useSlug } from "../lib/hooks";

const OPEN: ExecStatus[] = ["Queued", "InProgress", "Done"];
const COLUMN_SIZE = 50;
const HINT: Partial<Record<ExecStatus, string>> = {
  Queued: "按优先级排序，等开发者领取",
  InProgress: "开发中",
  Done: "已交付",
};

export function ExecPipelinePage() {
  const slug = useSlug();
  const name = useMemberNames(slug);
  const me = useQuery({ queryKey: ["me"], queryFn: api.me }).data;
  const { params, set } = useUrlState();
  const mineOnly = params.get("mine") === "1";
  const showCancelled = params.get("cancelled") === "1";
  const q = params.get("q") ?? "";
  const [openExec, setOpenExec] = useState<string | null>(params.get("open"));
  const [openRaw, setOpenRaw] = useState<string | null>(null);
  const commitQ = useCallback((v: string) => set("q", v || null), [set]);

  const statuses: ExecStatus[] = showCancelled ? [...OPEN, "Cancelled"] : OPEN;
  const developer_id = mineOnly ? me?.id : undefined;
  const cols = useQueries({
    queries: statuses.map((s) => ({
      queryKey: ["exec", slug, "col", s, { developer_id, q }],
      queryFn: () => api.execs(slug, { status: s, developer_id, q, page_size: COLUMN_SIZE }),
      refetchInterval: POLL_MS,
      enabled: !mineOnly || !!me,
      placeholderData: (prev: unknown) => prev as never,
    })),
  });

  return (
    <>
      <PageHeader
        title="执行小作文"
        description="经过合并、去重、过滤后拆出的开发任务。开发者（或 Agent）领取后完成并留下交付链接。"
      />
      <Toolbar>
        <Segmented
          value={mineOnly ? "mine" : "all"}
          onChange={(v) => set("mine", v === "mine" ? "1" : null)}
          options={[
            { value: "all", label: "全部" },
            { value: "mine", label: "我领取的" },
          ]}
        />
        <SearchBox value={q} onCommit={commitQ} placeholder="搜索指令内容" />
        <div className="flex-1" />
        <Check2 checked={showCancelled} onChange={(v) => set("cancelled", v ? "1" : null)}>
          显示已取消
        </Check2>
      </Toolbar>
      <Board>
        {statuses.map((s, i) => {
          const col = cols[i];
          const data = col?.data;
          return (
            <Column
              key={s}
              tone={EXEC_TONE[s]}
              title={EXEC_STATUS_LABEL[s]}
              hint={HINT[s]}
              total={data?.total}
              loading={!!col?.isFetching && !data}
              overflow={data ? data.total - data.items.length : 0}
              muted={s === "Cancelled"}
            >
              <ErrorNote error={col?.error} />
              {data?.items.length === 0 && (
                <ColumnEmpty>
                  {s === "Queued" ? "队列是空的，分配者拆出的新任务会出现在这里。" : "空"}
                </ColumnEmpty>
              )}
              {data?.items.map((e) => (
                <ExecCard
                  key={e.id}
                  exec={e}
                  dev={name(e.developer_id)}
                  mine={e.developer_id === me?.id}
                  onOpen={() => setOpenExec(e.id)}
                />
              ))}
            </Column>
          );
        })}
      </Board>
      <ExecSheet id={openExec} onClose={() => setOpenExec(null)} onOpenRaw={setOpenRaw} />
      <RawSheet
        id={openRaw}
        onClose={() => setOpenRaw(null)}
        onOpenExec={setOpenExec}
        onOpenRaw={setOpenRaw}
      />
    </>
  );
}

function ExecCard({
  exec,
  dev,
  mine,
  onOpen,
}: {
  exec: ExecComposition;
  dev: string;
  mine: boolean;
  onOpen: () => void;
}) {
  return (
    <Card onClick={onOpen} accent={mine && exec.status === "InProgress"}>
      <div className="flex items-center gap-2">
        <Priority p={exec.priority} />
        <Id>{exec.id}</Id>
        <span className="flex-1" />
        <AttachmentHint attachments={exec.attachments} />
        <span className="text-xs text-faint" title="来源小作文数">
          {exec.source_raw_ids.length} 篇来源
        </span>
      </div>
      <div className="mt-2 line-clamp-3 text-[13.5px] leading-snug group-hover:text-pencil">
        {plainSummary(exec.instruction)}
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {exec.target_resources.slice(0, 2).map((t) => (
            <Tag key={t}>
              <span className="font-mono">{t}</span>
            </Tag>
          ))}
        </div>
        {exec.developer_id ? (
          <span className="flex items-center gap-1 text-xs text-graphite">
            <Avatar name={dev} size={16} />
            {exec.status === "Done" ? fmtTime(exec.completed_at) : dev}
          </span>
        ) : (
          <span className="text-xs text-faint">待领取</span>
        )}
      </div>
    </Card>
  );
}
