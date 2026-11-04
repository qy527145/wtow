import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@wtow/ui/lib/utils";
import { Archive, Check, KeyRound, MoreHorizontal, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../api/client";
import type { CreatedToken, Member, Project, Role, User } from "../api/types";
import { PageHeader } from "../components/Shell";
import {
  Avatar,
  Button,
  Check2,
  CopyField,
  Dialog,
  ErrorNote,
  Field,
  Input,
  Menu,
  Select,
  Textarea,
} from "../components/ui";
import { ALL_ROLES, fmtTime, hasRole, ROLE_LABEL } from "../lib/format";
import { useMembers, useProject, useSlug } from "../lib/hooks";

const ROLE_DESC: Record<Role, string> = {
  tester: "提交原始小作文",
  assigner: "合并、去重、拆成任务",
  developer: "领取并交付任务",
  admin: "成员、令牌和项目设置",
};

export function SettingsPage() {
  const slug = useSlug();
  const project = useProject(slug).data!;
  const isAdmin = hasRole(project.my_roles, "admin");
  return (
    <>
      <PageHeader
        title="设置"
        description={
          isAdmin ? "你是项目管理员。" : "只有管理员能修改项目信息和成员；令牌可以自己管理。"
        }
      />
      <main className="flex max-w-[920px] flex-col gap-10 px-8 py-8 max-md:px-4">
        <ProjectInfo project={project} editable={isAdmin} />
        <Members slug={slug} editable={isAdmin && !project.archived} />
        <Tokens project={project} isAdmin={isAdmin} />
        {isAdmin && <ArchiveZone project={project} />}
      </main>
    </>
  );
}

function Block({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-x-10 gap-y-4 lg:grid-cols-[220px_1fr]">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && (
          <p className="mt-1 text-[13px] leading-relaxed text-graphite">{description}</p>
        )}
        {action && <div className="mt-3">{action}</div>}
      </div>
      <div className="min-w-0 rounded-lg border border-rule bg-surface">{children}</div>
    </section>
  );
}

function ProjectInfo({ project, editable }: { project: Project; editable: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState(project.name);
  const [desc, setDesc] = useState(project.description);
  const [human, setHuman] = useState(project.require_human_triage);
  useEffect(() => {
    setName(project.name);
    setDesc(project.description);
    setHuman(project.require_human_triage);
  }, [project]);
  const save = useMutation({
    mutationFn: () =>
      api.updateProject(project.slug, {
        name: name.trim(),
        description: desc.trim(),
        require_human_triage: human,
      }),
    onSuccess: (p) => {
      qc.setQueryData(["project", p.slug], p);
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("已保存");
    },
  });
  const dirty =
    name !== project.name || desc !== project.description || human !== project.require_human_triage;
  const disabled = !editable || project.archived;
  return (
    <Block title="项目信息" description="项目标识创建后不能改，CLI 和 .wtow.toml 都用它定位项目。">
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="名称">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={disabled}
              required
            />
          </Field>
          <Field label="项目标识">
            <Input className="font-mono" value={project.slug} disabled />
          </Field>
        </div>
        <Field label="描述">
          <Textarea
            rows={3}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            disabled={disabled}
          />
        </Field>
        <div className="rounded-md bg-paper px-3.5 py-3">
          <Check2 checked={human} onChange={setHuman} disabled={disabled}>
            <span className="font-medium">合并、重复、忽略必须由人来判定</span>
          </Check2>
          <p className="mt-1 ml-6 text-xs leading-relaxed text-graphite">
            开启后 Agent 令牌调用这三个操作会被拒绝，只能由人在工作台里完成。拆分不受影响。
          </p>
        </div>
        <ErrorNote error={save.error} />
        {!disabled && (
          <div className="flex justify-end">
            <Button variant="primary" disabled={!dirty} loading={save.isPending}>
              保存
            </Button>
          </div>
        )}
      </form>
    </Block>
  );
}

function Members({ slug, editable }: { slug: string; editable: boolean }) {
  const qc = useQueryClient();
  const members = useMembers(slug);
  const me = useQuery({ queryKey: ["me"], queryFn: api.me }).data;
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const remove = useMutation({
    mutationFn: (m: Member) => api.removeMember(slug, m.user_id),
    onSuccess: (_, m) => {
      qc.invalidateQueries({ queryKey: ["members", slug] });
      qc.invalidateQueries({ queryKey: ["tokens", slug] });
      toast.success(`已移除 ${m.display_name || m.email}`);
    },
  });
  return (
    <Block
      title="成员"
      description="一个人可以同时有多个角色。对方要先注册账号，才能被加进来。"
      action={
        editable && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <UserPlus className="size-3.5" />
            添加成员
          </Button>
        )
      }
    >
      <ErrorNote error={members.error || remove.error} className="m-4" />
      <ul className="divide-y divide-rule">
        {members.data?.map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 px-5 py-3">
            <Avatar name={m.display_name || m.email} size={30} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13.5px] font-medium">
                {m.display_name || m.email}
                {m.user_id === me?.id && (
                  <span className="text-xs font-normal text-faint">（你）</span>
                )}
              </div>
              <div className="truncate text-xs text-faint">{m.email}</div>
            </div>
            <div className="flex flex-wrap justify-end gap-1">
              {m.roles.map((r) => (
                <span
                  key={r}
                  className={cn(
                    "rounded-sm px-1.5 text-xs leading-5",
                    r === "admin" ? "bg-ink text-white" : "bg-ink/[0.06] text-graphite",
                  )}
                >
                  {ROLE_LABEL[r]}
                </span>
              ))}
            </div>
            {editable && (
              <Menu.Root>
                <Menu.Trigger asChild>
                  <Button variant="ghost" size="icon" aria-label="更多">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </Menu.Trigger>
                <Menu.Content>
                  <Menu.Item onSelect={() => setEditing(m)}>修改角色</Menu.Item>
                  {m.user_id !== me?.id && (
                    <Menu.Item
                      danger
                      onSelect={() =>
                        confirm(`移除 ${m.email}？他的令牌会一起吊销。`) && remove.mutate(m)
                      }
                    >
                      移出项目
                    </Menu.Item>
                  )}
                </Menu.Content>
              </Menu.Root>
            )}
          </li>
        ))}
      </ul>
      <MemberDialog slug={slug} member={editing} onClose={() => setEditing(null)} />
    </Block>
  );
}

function RoleCards({
  value,
  onChange,
  allowed,
}: {
  value: Role[];
  onChange: (r: Role[]) => void;
  allowed?: Role[];
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {ALL_ROLES.filter((r) => !allowed || allowed.includes(r)).map((r) => {
        const on = value.includes(r);
        return (
          <button
            key={r}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== r) : [...value, r])}
            className={cn(
              "rounded-md border px-3 py-2.5 text-left transition-colors",
              on ? "border-pencil bg-pencil-wash" : "border-rule-strong hover:bg-paper",
            )}
          >
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <input
                type="checkbox"
                checked={on}
                readOnly
                tabIndex={-1}
                className="pointer-events-none"
              />
              {ROLE_LABEL[r]}
            </div>
            <div className="mt-0.5 ml-6 text-xs text-graphite">{ROLE_DESC[r]}</div>
          </button>
        );
      })}
    </div>
  );
}

function MemberDialog({
  slug,
  member,
  onClose,
}: {
  slug: string;
  member: Member | "new" | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const existing = member && member !== "new" ? member : null;
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<Role[]>(["tester"]);
  useEffect(() => {
    setEmail(existing?.email ?? "");
    setRoles(existing?.roles ?? ["tester"]);
  }, [member]); // eslint-disable-line react-hooks/exhaustive-deps
  const candidates = useQuery({
    queryKey: ["member-candidates", slug],
    queryFn: () => api.memberCandidates(slug),
    enabled: member === "new",
  });
  const save = useMutation({
    mutationFn: () => api.upsertMember(slug, email, roles),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members", slug] });
      qc.invalidateQueries({ queryKey: ["member-candidates", slug] });
      toast.success(existing ? "角色已更新" : `已添加 ${email}`);
      onClose();
    },
  });
  return (
    <Dialog
      open={!!member}
      onOpenChange={(o) => !o && onClose()}
      title={existing ? `修改 ${existing.display_name || existing.email} 的角色` : "添加成员"}
      description={existing ? "降低角色时，他的令牌会同步收紧。" : undefined}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {!existing && (
          <Field label="选择用户">
            <UserPicker
              users={candidates.data}
              loading={candidates.isLoading}
              value={email}
              onChange={setEmail}
            />
          </Field>
        )}
        <Field label="角色">
          <RoleCards value={roles} onChange={setRoles} />
        </Field>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={roles.length === 0 || !email}
          >
            {existing ? "保存" : "添加"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function UserPicker({
  users,
  loading,
  value,
  onChange,
}: {
  users: User[] | undefined;
  loading: boolean;
  value: string;
  onChange: (email: string) => void;
}) {
  const [q, setQ] = useState("");
  const kw = q.trim().toLowerCase();
  const list = (users ?? []).filter(
    (u) => !kw || u.email.includes(kw) || u.display_name.toLowerCase().includes(kw),
  );
  return (
    <div className="flex flex-col gap-2">
      <Input
        autoFocus
        placeholder="按邮箱或名字搜索"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="max-h-60 divide-y divide-rule overflow-y-auto rounded-md border border-rule-strong">
        {loading && <li className="px-3 py-4 text-center text-[13px] text-graphite">加载中…</li>}
        {!loading && list.length === 0 && (
          <li className="px-3 py-4 text-center text-[13px] text-graphite">
            {users?.length ? "没有匹配的用户。" : "所有注册用户都已在项目里。"}
          </li>
        )}
        {list.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              onClick={() => onChange(u.email)}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                value === u.email ? "bg-pencil-wash" : "hover:bg-paper",
              )}
            >
              <Avatar name={u.display_name || u.email} size={24} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{u.display_name || u.email}</div>
                <div className="truncate text-xs text-faint">{u.email}</div>
              </div>
              {value === u.email && <Check className="size-4 text-pencil" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tokens({ project, isAdmin }: { project: Project; isAdmin: boolean }) {
  const qc = useQueryClient();
  const slug = project.slug;
  const tokens = useQuery({ queryKey: ["tokens", slug], queryFn: () => api.tokens(slug) });
  const [creating, setCreating] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);
  const revoke = useMutation({
    mutationFn: (id: number) => api.revokeToken(slug, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tokens", slug] });
      toast.success("令牌已吊销");
    },
  });
  const list = (tokens.data ?? []).filter((t) => showRevoked || !t.revoked);
  const revokedCount = (tokens.data ?? []).filter((t) => t.revoked).length;
  return (
    <Block
      title="访问令牌"
      description={
        isAdmin
          ? "CLI 和 Agent 用令牌访问本项目。你能看到并吊销所有成员的令牌。"
          : "CLI 和 Agent 用令牌访问本项目。令牌权限不会超过你的角色。"
      }
      action={
        !project.archived && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <KeyRound className="size-3.5" />
            生成令牌
          </Button>
        )
      }
    >
      <ErrorNote error={tokens.error || revoke.error} className="m-4" />
      {tokens.data && list.length === 0 && (
        <div className="px-5 py-8 text-center text-[13px] text-graphite">还没有令牌。</div>
      )}
      <ul className="divide-y divide-rule">
        {list.map((t) => (
          <li
            key={t.id}
            className={cn("flex items-center gap-3 px-5 py-3", t.revoked && "opacity-50")}
          >
            <KeyRound className="size-4 shrink-0 text-faint" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13.5px] font-medium">
                {t.name}
                <span className="rounded-sm bg-ink/[0.06] px-1.5 text-[11px] font-normal text-graphite">
                  {t.actor_type === "agent" ? "Agent" : "本人"}
                </span>
                {t.read_only && (
                  <span className="rounded-sm bg-ink/[0.06] px-1.5 text-[11px] font-normal text-graphite">
                    只读
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-faint">
                <span className="font-mono">{t.prefix}…</span>
                {isAdmin && <span>{t.owner}</span>}
                <span>{t.roles.map((r) => ROLE_LABEL[r]).join("、")}</span>
                <span>{t.last_used_at ? `${fmtTime(t.last_used_at)}用过` : "从未使用"}</span>
                <span>
                  {t.revoked
                    ? "已吊销"
                    : t.expires_at
                      ? `${new Date(t.expires_at).toLocaleDateString("zh-CN")} 过期`
                      : "永不过期"}
                </span>
              </div>
            </div>
            {!t.revoked && (
              <Button
                variant="quiet-danger"
                size="sm"
                onClick={() =>
                  confirm(`吊销令牌「${t.name}」？用它登录的 CLI 会立即失效。`) &&
                  revoke.mutate(t.id)
                }
              >
                吊销
              </Button>
            )}
          </li>
        ))}
      </ul>
      {revokedCount > 0 && (
        <div className="border-t border-rule px-5 py-2.5">
          <Check2 checked={showRevoked} onChange={setShowRevoked}>
            <span className="text-xs text-graphite">显示已吊销的 {revokedCount} 个</span>
          </Check2>
        </div>
      )}
      <CreateTokenDialog project={project} open={creating} onOpenChange={setCreating} />
    </Block>
  );
}

export function CreateTokenDialog({
  project,
  open,
  onOpenChange,
  onCreated,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: (t: CreatedToken) => void;
}) {
  const qc = useQueryClient();
  const held: Role[] = project.my_roles.includes("admin") ? ALL_ROLES : project.my_roles;
  const [name, setName] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [actor, setActor] = useState<"agent" | "human">("agent");
  const [readOnly, setReadOnly] = useState(false);
  const [days, setDays] = useState("90");
  const [created, setCreated] = useState<CreatedToken | null>(null);
  useEffect(() => {
    if (open) {
      setName("claude-code");
      setRoles(held.filter((r) => r !== "admin"));
      setCreated(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = useMutation({
    mutationFn: () =>
      api.createToken(project.slug, {
        name: name.trim(),
        roles,
        read_only: readOnly,
        actor_type: actor,
        expires_in_days: days ? Number(days) : undefined,
      }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["tokens", project.slug] });
      setCreated(t);
      onCreated?.(t);
    },
  });

  if (created) {
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title="令牌已生成"
        description="明文只显示这一次，关掉后就看不到了。"
      >
        <div className="flex flex-col gap-4">
          <CopyField value={created.secret} label="令牌" />
          <CopyField
            multiline
            label="在终端里运行，完成 CLI 登录"
            value={`wtow login --base-url ${location.origin} --project ${project.slug} --token ${created.secret}`}
          />
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              我已保存
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="生成访问令牌"
      description="令牌只能访问这个项目，权限不会超过你的角色。"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="名称" hint="写清楚给谁用，比如设备名或 Agent 名。">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="角色">
          <RoleCards value={roles} onChange={setRoles} allowed={held} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="谁在用">
            <Select value={actor} onChange={(e) => setActor(e.target.value as "agent" | "human")}>
              <option value="agent">Agent（Claude Code 等）</option>
              <option value="human">我自己在终端用</option>
            </Select>
          </Field>
          <Field label="有效期">
            <Select value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="7">7 天</option>
              <option value="30">30 天</option>
              <option value="90">90 天</option>
              <option value="365">1 年</option>
              <option value="">永不过期</option>
            </Select>
          </Field>
        </div>
        <Check2 checked={readOnly} onChange={setReadOnly}>
          只读：只能查看，不能提交或修改
        </Check2>
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" loading={create.isPending} disabled={roles.length === 0}>
            生成令牌
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ArchiveZone({ project }: { project: Project }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => api.updateProject(project.slug, { archived: !project.archived }),
    onSuccess: (p) => {
      qc.setQueryData(["project", p.slug], p);
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(p.archived ? "项目已归档" : "已取消归档");
    },
  });
  return (
    <Block title={project.archived ? "取消归档" : "归档项目"}>
      <div className="flex flex-wrap items-center gap-4 p-5">
        <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-graphite">
          {project.archived
            ? "恢复后成员可以继续提交和处理小作文。"
            : "归档后项目变为只读：不能提交、认领或修改，数据都保留，随时可以恢复。"}
        </p>
        <Button
          variant={project.archived ? "primary" : "quiet-danger"}
          className={cn(!project.archived && "border border-alarm/30")}
          loading={toggle.isPending}
          onClick={() =>
            (project.archived || confirm(`确定归档「${project.name}」？`)) && toggle.mutate()
          }
        >
          <Archive className="size-4" />
          {project.archived ? "取消归档" : "归档项目"}
        </Button>
      </div>
    </Block>
  );
}
