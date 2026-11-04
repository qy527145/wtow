import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  KeyRound,
  MoreHorizontal,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { api } from "../api/client";
import type { AdminProject, AdminUser, User } from "../api/types";
import { PageHeader, ProjectGlyph } from "../components/Shell";
import {
  Avatar,
  Button,
  Check2,
  Dialog,
  ErrorNote,
  Field,
  Input,
  Menu,
  Segmented,
  Spinner,
} from "../components/ui";
import { fmtTime } from "../lib/format";

type Tab = "projects" | "users";

export function AdminPage({ user }: { user: User }) {
  const [tab, setTab] = useState<Tab>("projects");
  return (
    <>
      <PageHeader
        title="超管面板"
        description="跨项目查看与操作。进入任意项目后你都按项目管理员处理，可以改成员、发令牌、处理两条管道。"
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "projects", label: "全部项目" },
              { value: "users", label: "全部用户" },
            ]}
          />
        }
      />
      <main className="flex-1 px-8 py-6 max-md:px-4">
        {tab === "projects" ? <Projects /> : <Users me={user} />}
      </main>
    </>
  );
}

function Projects() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ["admin", "projects"], queryFn: api.adminProjects });
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(true);
  const [deleting, setDeleting] = useState<AdminProject | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin", "projects"] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };
  const archive = useMutation({
    mutationFn: (p: AdminProject) => api.updateProject(p.slug, { archived: !p.archived }),
    onSuccess: (p) => {
      qc.setQueryData(["project", p.slug], p);
      refresh();
      toast.success(p.archived ? `已归档「${p.name}」` : `已取消归档「${p.name}」`);
    },
  });
  const needle = q.trim().toLowerCase();
  const rows = (list.data ?? []).filter(
    (p) =>
      (showArchived || !p.archived) &&
      (!needle ||
        p.slug.includes(needle) ||
        p.name.toLowerCase().includes(needle) ||
        p.creator.toLowerCase().includes(needle)),
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Input
          className="max-w-xs"
          placeholder="按名称、标识、创建者筛选"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Check2 checked={showArchived} onChange={setShowArchived}>
          包含已归档
        </Check2>
        <span className="ml-auto text-xs text-faint">共 {list.data?.length ?? "–"} 个项目</span>
      </div>
      <ErrorNote error={list.error || archive.error} className="mb-4" />
      {list.isPending && <Spinner className="mx-auto mt-16" />}
      {list.data && (
        <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
          <table className="w-full text-[13px]">
            <thead className="border-b border-rule text-left text-xs text-faint">
              <tr>
                <th className="px-4 py-2.5 font-normal">项目</th>
                <th className="px-4 py-2.5 font-normal">创建者</th>
                <th className="px-4 py-2.5 text-right font-normal">成员</th>
                <th className="px-4 py-2.5 text-right font-normal">原始（待处理 / 总数）</th>
                <th className="px-4 py-2.5 text-right font-normal">执行（未完成 / 总数）</th>
                <th className="px-4 py-2.5 font-normal">最近活动</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {rows.map((p) => (
                <tr key={p.slug} className="hover:bg-paper">
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/p/${p.slug}`}
                      className="flex items-center gap-2.5 hover:text-pencil"
                    >
                      <ProjectGlyph name={p.name} small muted={p.archived} />
                      <span className="font-medium">{p.name}</span>
                      <span className="font-mono text-xs text-faint">{p.slug}</span>
                      {p.archived && (
                        <span className="rounded bg-gone-wash px-1.5 text-[11px] text-gone">
                          已归档
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-graphite">{p.creator}</td>
                  <td className="num px-4 py-2.5 text-right">{p.member_count}</td>
                  <td className="num px-4 py-2.5 text-right">
                    <span className="font-semibold">{p.raw_pending}</span>
                    <span className="text-faint"> / {p.raw_total}</span>
                  </td>
                  <td className="num px-4 py-2.5 text-right">
                    <span className="font-semibold">{p.exec_open}</span>
                    <span className="text-faint"> / {p.exec_total}</span>
                  </td>
                  <td className="px-4 py-2.5 text-graphite">
                    {fmtTime(p.last_activity_at ?? p.created_at)}
                  </td>
                  <td className="px-2 py-1.5">
                    <Menu.Root>
                      <Menu.Trigger asChild>
                        <Button variant="ghost" size="icon" aria-label="更多">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </Menu.Trigger>
                      <Menu.Content>
                        <Menu.Item onSelect={() => navigate(`/p/${p.slug}`)}>
                          <ExternalLink className="size-4" />
                          进入项目
                        </Menu.Item>
                        <Menu.Item onSelect={() => navigate(`/p/${p.slug}/settings`)}>
                          <KeyRound className="size-4" />
                          成员与令牌
                        </Menu.Item>
                        <Menu.Item
                          onSelect={() =>
                            (p.archived || confirm(`确定归档「${p.name}」？`)) && archive.mutate(p)
                          }
                        >
                          {p.archived ? (
                            <ArchiveRestore className="size-4" />
                          ) : (
                            <Archive className="size-4" />
                          )}
                          {p.archived ? "取消归档" : "归档"}
                        </Menu.Item>
                        <Menu.Separator />
                        <Menu.Item danger onSelect={() => setDeleting(p)}>
                          <Trash2 className="size-4" />
                          彻底删除
                        </Menu.Item>
                      </Menu.Content>
                    </Menu.Root>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-graphite">
                    没有匹配的项目
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <DeleteProjectDialog
        project={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={refresh}
      />
    </>
  );
}

function DeleteProjectDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: AdminProject | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const del = useMutation({
    mutationFn: (slug: string) => api.adminDeleteProject(slug),
    onSuccess: () => {
      toast.success(`已删除项目「${project?.name}」`);
      onDeleted();
      onClose();
    },
  });
  return (
    <Dialog
      open={!!project}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setTyped("");
          del.reset();
        }
      }}
      title="彻底删除项目"
      description="作文、附件、成员、令牌和审计记录会一起删除，无法恢复。只想停用的话请用归档。"
    >
      {project && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            del.mutate(project.slug);
          }}
        >
          <Field
            label={
              <>
                输入项目标识 <span className="font-mono">{project.slug}</span> 确认
              </>
            }
          >
            <Input
              className="font-mono"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>
          <ErrorNote error={del.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button variant="danger" disabled={typed !== project.slug} loading={del.isPending}>
              删除
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function Users({ me }: { me: User }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["admin", "users"], queryFn: api.adminUsers });
  const [q, setQ] = useState("");
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const toggle = useMutation({
    mutationFn: (u: AdminUser) => api.adminUpdateUser(u.id, { is_superadmin: !u.is_superadmin }),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      toast.success(u.is_superadmin ? `已设 ${u.email} 为超管` : `已撤销 ${u.email} 的超管`);
    },
  });
  const needle = q.trim().toLowerCase();
  const rows = (list.data ?? []).filter(
    (u) => !needle || u.email.includes(needle) || u.display_name.toLowerCase().includes(needle),
  );
  return (
    <>
      <div className="mb-4 flex items-center gap-4">
        <Input
          className="max-w-xs"
          placeholder="按邮箱、昵称筛选"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="ml-auto text-xs text-faint">共 {list.data?.length ?? "–"} 个用户</span>
      </div>
      <ErrorNote error={list.error || toggle.error} className="mb-4" />
      {list.isPending && <Spinner className="mx-auto mt-16" />}
      {list.data && (
        <ul className="divide-y divide-rule rounded-lg border border-rule bg-surface">
          {rows.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-5 py-3">
              <Avatar name={u.display_name || u.email} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13.5px] font-medium">
                  {u.display_name || u.email}
                  {u.id === me.id && <span className="text-xs font-normal text-faint">（你）</span>}
                  {u.is_superadmin && (
                    <span className="rounded-sm bg-ink px-1.5 text-xs leading-5 font-normal text-white">
                      超管
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-faint">{u.email}</div>
              </div>
              <div className="text-xs text-graphite max-sm:hidden">
                参与 <span className="num">{u.project_count}</span> 个项目 · 注册于{" "}
                {fmtTime(u.created_at)}
              </div>
              <Menu.Root>
                <Menu.Trigger asChild>
                  <Button variant="ghost" size="icon" aria-label="更多">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </Menu.Trigger>
                <Menu.Content>
                  {u.id !== me.id && (
                    <Menu.Item
                      onSelect={() =>
                        (!u.is_superadmin
                          ? confirm(`设 ${u.email} 为超管？对方将能查看和操作所有项目。`)
                          : true) && toggle.mutate(u)
                      }
                    >
                      {u.is_superadmin ? (
                        <ShieldOff className="size-4" />
                      ) : (
                        <ShieldCheck className="size-4" />
                      )}
                      {u.is_superadmin ? "撤销超管" : "设为超管"}
                    </Menu.Item>
                  )}
                  <Menu.Item onSelect={() => setResetting(u)}>
                    <KeyRound className="size-4" />
                    重置密码
                  </Menu.Item>
                </Menu.Content>
              </Menu.Root>
            </li>
          ))}
        </ul>
      )}
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
    </>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const reset = useMutation({
    mutationFn: (id: number) => api.adminUpdateUser(id, { password: pw }),
    onSuccess: (u) => {
      toast.success(`已重置 ${u.email} 的密码`);
      close();
    },
  });
  const close = () => {
    setPw("");
    reset.reset();
    onClose();
  };
  return (
    <Dialog
      open={!!user}
      onOpenChange={(o) => !o && close()}
      title="重置密码"
      description={
        user && `为 ${user.email} 设置新密码。对方已登录的网页会话会全部失效，CLI 令牌不受影响。`
      }
    >
      {user && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            reset.mutate(user.id);
          }}
        >
          <Field label="新密码" hint="至少 8 位。">
            <Input
              type="text"
              autoFocus
              minLength={8}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              required
            />
          </Field>
          <ErrorNote error={reset.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              取消
            </Button>
            <Button variant="primary" disabled={pw.length < 8} loading={reset.isPending}>
              重置
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
