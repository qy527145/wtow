import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@wtow/ui/lib/utils";
import {
  Archive,
  BookOpen,
  ChevronsUpDown,
  Columns3,
  FolderPlus,
  Inbox,
  LayoutDashboard,
  LogOut,
  PenLine,
  Plug,
  Settings,
  ShieldCheck,
  Shuffle,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { api } from "../api/client";
import type { Project, User } from "../api/types";
import { hasRole, ROLE_LABEL } from "../lib/format";
import { Avatar, Button, Dialog, ErrorNote, Field, Input, Menu, Spinner } from "./ui";

const LAST_PROJECT_KEY = "wtow:last-project";

export function AppShell({ user }: { user: User }) {
  const { slug } = useParams();
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const current = projects.data?.find((p) => p.slug === slug);

  useEffect(() => {
    if (slug) localStorage.setItem(LAST_PROJECT_KEY, slug);
  }, [slug]);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-[232px] shrink-0 flex-col border-r border-rule bg-surface max-md:hidden">
        <div className="flex h-14 items-center gap-2 px-4">
          <Wordmark />
        </div>
        <div className="px-3 pb-2">
          <ProjectSwitcher projects={projects.data ?? []} current={current} />
        </div>
        <nav className="scrollbar-quiet flex-1 overflow-y-auto px-3 py-2">
          {current ? <ProjectNav project={current} /> : <GlobalNav />}
        </nav>
        <div className="border-t border-rule p-3">
          {user.is_superadmin && (
            <SideLink to="/admin" icon={<ShieldCheck className="size-4" />}>
              超管面板
            </SideLink>
          )}
          <SideLink to="/guide" icon={<BookOpen className="size-4" />} end>
            使用引导
          </SideLink>
          <UserMenu user={user} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileBar current={current} />
        <Suspense
          fallback={
            <div className="grid flex-1 place-items-center py-24">
              <Spinner />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </div>
    </div>
  );
}

/** 品牌字标：两道铅笔划把「原始」汇成「执行」，正是产品在做的事。 */
function Wordmark() {
  return (
    <NavLink to="/" className="flex items-center gap-2">
      <svg viewBox="0 0 28 28" className="size-7" aria-hidden>
        <rect width="28" height="28" rx="7" className="fill-ink" />
        <path
          d="M6 9.5 C 12 9.5, 13 14, 21 14"
          fill="none"
          stroke="#9db5ff"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M6 18.5 C 12 18.5, 13 14, 21 14"
          fill="none"
          stroke="#9db5ff"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="21.5" cy="14" r="2.6" fill="#fff" />
      </svg>
      <span className="font-display text-[17px] font-bold tracking-tight">wtow</span>
    </NavLink>
  );
}

function ProjectSwitcher({ projects, current }: { projects: Project[]; current?: Project }) {
  const navigate = useNavigate();
  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button className="flex w-full items-center gap-2.5 rounded-md border border-rule px-2.5 py-2 text-left transition-colors hover:border-rule-strong hover:bg-paper">
          <ProjectGlyph name={current?.name ?? "全部项目"} muted={!current} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              {current?.name ?? "全部项目"}
            </span>
            <span className="block truncate font-mono text-[11px] text-faint">
              {current?.slug ?? `${active.length} 个进行中`}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 text-faint" />
        </button>
      </Menu.Trigger>
      <Menu.Content align="start">
        <Menu.Item onSelect={() => navigate("/")}>
          <LayoutDashboard className="size-4 text-faint" />
          全部项目
        </Menu.Item>
        {active.length > 0 && <Menu.Separator />}
        {active.map((p) => (
          <Menu.Item key={p.slug} onSelect={() => navigate(`/p/${p.slug}`)}>
            <ProjectGlyph name={p.name} small />
            <span className="flex-1 truncate">{p.name}</span>
            {p.slug === current?.slug && <span className="size-1.5 rounded-full bg-pencil" />}
          </Menu.Item>
        ))}
        {archived.length > 0 && (
          <>
            <Menu.Separator />
            <Menu.Label>已归档</Menu.Label>
            {archived.map((p) => (
              <Menu.Item key={p.slug} onSelect={() => navigate(`/p/${p.slug}`)}>
                <Archive className="size-4 text-faint" />
                <span className="flex-1 truncate text-graphite">{p.name}</span>
              </Menu.Item>
            ))}
          </>
        )}
        <Menu.Separator />
        <Menu.Item onSelect={() => navigate("/?new=1")}>
          <FolderPlus className="size-4 text-faint" />
          新建项目
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

export function ProjectGlyph({
  name,
  small,
  muted,
}: {
  name: string;
  small?: boolean;
  muted?: boolean;
}) {
  let h = 0;
  for (const c of name) h = (h * 17 + c.charCodeAt(0)) % 360;
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-md font-display font-bold text-white",
        small ? "size-5 text-[11px]" : "size-8 text-sm",
      )}
      style={{ background: muted ? "var(--color-graphite)" : `oklch(0.45 0.12 ${h})` }}
    >
      {[...name.trim()][0]?.toUpperCase() ?? "·"}
    </span>
  );
}

function SideLink({
  to,
  icon,
  children,
  end,
  count,
}: {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  end?: boolean;
  count?: number;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors",
          isActive
            ? "bg-pencil-wash font-medium text-pencil"
            : "text-graphite hover:bg-ink/[0.04] hover:text-ink",
        )
      }
    >
      {icon}
      <span className="flex-1">{children}</span>
      {count !== undefined && count > 0 && <span className="num text-xs text-faint">{count}</span>}
    </NavLink>
  );
}

function GlobalNav() {
  return (
    <div className="flex flex-col gap-0.5">
      <SideLink to="/" icon={<LayoutDashboard className="size-4" />} end>
        项目
      </SideLink>
    </div>
  );
}

function ProjectNav({ project }: { project: Project }) {
  const base = `/p/${project.slug}`;
  const roles = project.my_roles;
  const pending = useQuery({
    queryKey: ["raw", project.slug, "count", "Pending"],
    queryFn: () => api.raws(project.slug, { status: "Pending", page_size: 1 }),
    refetchInterval: 10_000,
  });
  const queued = useQuery({
    queryKey: ["exec", project.slug, "count", "Queued"],
    queryFn: () => api.execs(project.slug, { status: "Queued", page_size: 1 }),
    refetchInterval: 10_000,
  });
  return (
    <div className="flex flex-col gap-0.5">
      <SideLink to={base} icon={<LayoutDashboard className="size-4" />} end>
        概览
      </SideLink>
      <div className="mt-4 mb-1.5 px-2.5 text-xs text-faint">管道</div>
      <SideLink to={`${base}/raw`} icon={<Inbox className="size-4" />} count={pending.data?.total}>
        原始小作文
      </SideLink>
      {hasRole(roles, "assigner") && (
        <SideLink to={`${base}/workbench`} icon={<Shuffle className="size-4" />}>
          分配工作台
        </SideLink>
      )}
      <SideLink
        to={`${base}/exec`}
        icon={<Columns3 className="size-4" />}
        count={queued.data?.total}
      >
        执行小作文
      </SideLink>
      <div className="mt-4 mb-1.5 px-2.5 text-xs text-faint">项目</div>
      <SideLink to={`${base}/connect`} icon={<Plug className="size-4" />}>
        接入 CLI 与 Agent
      </SideLink>
      <SideLink to={`${base}/settings`} icon={<Settings className="size-4" />}>
        设置
      </SideLink>
    </div>
  );
}

function UserMenu({ user }: { user: User }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.clear();
      navigate("/login");
    },
  });
  const [renaming, setRenaming] = useState(false);
  const name = user.display_name || user.email;
  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <button className="mt-1 flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-ink/[0.04]">
            <Avatar name={name} size={24} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{name}</span>
              <span className="block truncate text-[11px] text-faint">{user.email}</span>
            </span>
          </button>
        </Menu.Trigger>
        <Menu.Content align="start">
          <Menu.Item onSelect={() => setRenaming(true)}>
            <PenLine className="size-4" />
            修改昵称
          </Menu.Item>
          <Menu.Item onSelect={() => logout.mutate()} danger>
            <LogOut className="size-4" />
            退出登录
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
      <RenameDialog user={user} open={renaming} onClose={() => setRenaming(false)} />
    </>
  );
}

function RenameDialog({ user, open, onClose }: { user: User; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  useEffect(() => {
    if (open) setName(user.display_name);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => api.updateMe(name),
    onSuccess: (u) => {
      qc.setQueryData(["me"], u);
      // 成员列表里也带着昵称，各处显示名都从这里取。
      qc.invalidateQueries({ queryKey: ["members"] });
      toast.success("昵称已更新");
      onClose();
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="修改昵称"
      description="昵称会显示在所有项目里。"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="昵称">
          <Input
            autoFocus
            value={name}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!name.trim() || name.trim() === user.display_name}
          >
            保存
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** 窄屏时侧栏收起，用顶栏承载品牌与项目导航。 */
function MobileBar({ current }: { current?: Project }) {
  const loc = useLocation();
  const base = current ? `/p/${current.slug}` : "";
  const links: [string, string][] = current
    ? [
        [base, "概览"],
        [`${base}/raw`, "原始"],
        [`${base}/exec`, "执行"],
        [`${base}/settings`, "设置"],
      ]
    : [
        ["/", "项目"],
        ["/guide", "引导"],
      ];
  return (
    <div className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-rule bg-surface/95 px-4 backdrop-blur md:hidden">
      <Wordmark />
      <div className="scrollbar-quiet flex flex-1 justify-end gap-1 overflow-x-auto">
        {links.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end
            className={cn(
              "rounded-md px-2 py-1 text-[13px] whitespace-nowrap",
              loc.pathname === to ? "bg-pencil-wash text-pencil" : "text-graphite",
            )}
          >
            {label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

/** 项目内页面的统一外框：页头 + 内容。 */
export function ProjectFrame() {
  const { slug } = useParams();
  const project = useQuery({ queryKey: ["project", slug], queryFn: () => api.project(slug!) });
  if (project.isPending) {
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner />
      </div>
    );
  }
  if (project.error) {
    return (
      <div className="p-8">
        <ErrorNote error={project.error} />
      </div>
    );
  }
  return (
    <>
      {project.data.archived && (
        <div className="flex items-center gap-2 border-b border-rule bg-gone-wash px-8 py-2 text-[13px] text-graphite">
          <Archive className="size-4" />
          项目已归档，所有内容只读。管理员可以在设置里取消归档。
        </div>
      )}
      <Outlet />
    </>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="border-b border-rule bg-surface px-8 pt-7 max-md:px-4 max-md:pt-5">
      <div className="flex flex-wrap items-end gap-4 pb-5">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[26px] leading-tight font-semibold tracking-tight">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-graphite">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function RolesText({ roles }: { roles: Project["my_roles"] }) {
  return <>{roles.map((r) => ROLE_LABEL[r]).join("、") || "无角色"}</>;
}
