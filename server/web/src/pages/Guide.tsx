import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Bot, Check, Code2, FolderPlus, Inbox, Shuffle, Terminal } from 'lucide-react'
import { api } from '../api/client'
import type { CreatedToken, Project, Role } from '../api/types'
import { PageHeader } from '../components/Shell'
import { Button, CopyField, Select } from '../components/ui'
import { cn } from '../lib/cn'
import { hasRole, ROLE_LABEL } from '../lib/format'
import { CreateTokenDialog } from './Settings'

type StepKey = 'install' | 'token' | 'login' | 'skill' | 'use'

const STEPS: { key: StepKey; title: string; sub: string }[] = [
  { key: 'install', title: '安装 CLI', sub: '一行命令' },
  { key: 'token', title: '生成令牌', sub: '绑定一个项目' },
  { key: 'login', title: '登录 CLI', sub: '保存到本机' },
  { key: 'skill', title: '安装 Skill', sub: '让 Agent 学会用' },
  { key: 'use', title: '开始使用', sub: '按你的角色' },
]

const DONE_KEY = 'wtow:guide-done'

/**
 * 首次接入引导：安装 CLI → 生成令牌 → 登录 → 安装 Skill → 按角色上手。
 * 挂在 /guide（全局，需先选项目）与 /p/:slug/connect（项目内）两处。
 */
export function GuidePage() {
  const routeSlug = useParams().slug
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects })
  const active = (projects.data ?? []).filter((p) => !p.archived)
  const [picked, setPicked] = useState<string | null>(null)
  const slug = routeSlug ?? picked ?? (active.length === 1 ? active[0].slug : null)
  const project = (projects.data ?? []).find((p) => p.slug === slug) ?? null
  const [token, setToken] = useState<CreatedToken | null>(null)
  const [creatingToken, setCreatingToken] = useState(false)
  const [step, setStep] = useState<StepKey>('install')
  const [done, setDone] = useState<Set<StepKey>>(() => new Set(JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]')))
  const origin = location.origin

  useEffect(() => localStorage.setItem(DONE_KEY, JSON.stringify([...done])), [done])
  useEffect(() => setToken(null), [slug])

  const complete = (k: StepKey) => {
    setDone((d) => new Set(d).add(k))
    const i = STEPS.findIndex((s) => s.key === k)
    if (STEPS[i + 1]) setStep(STEPS[i + 1].key)
  }

  const header = routeSlug ? (
    <PageHeader title="接入 CLI 与 Agent" description="五步把 wtow 接进你的终端和 Claude Code。每一步的命令都已经替你填好了。" />
  ) : (
    <PageHeader
      title="使用引导"
      description="wtow 把零散的反馈（小作文）整理成可执行的开发任务：测试者提交，分配者合并、去重、过滤后拆分，开发者领取交付。人和 Agent 都能参与每一环。"
    />
  )

  return (
    <>
      {header}
      <main className="flex-1 px-8 py-8 max-md:px-4">
        <div className="mx-auto grid max-w-[1040px] gap-8 lg:grid-cols-[220px_1fr]">
          <ol className="relative flex flex-col gap-1 lg:sticky lg:top-8 lg:self-start">
            {STEPS.map((s, i) => {
              const isDone = done.has(s.key)
              const isCur = step === s.key
              return (
                <li key={s.key} className="relative">
                  {i < STEPS.length - 1 && (
                    <span className={cn('absolute top-9 left-[19px] h-[calc(100%-22px)] w-px', isDone ? 'bg-pencil' : 'bg-rule-strong')} />
                  )}
                  <button
                    onClick={() => setStep(s.key)}
                    className={cn('flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors', isCur ? 'bg-surface shadow-lift' : 'hover:bg-ink/[0.03]')}
                  >
                    <span
                      className={cn(
                        'num relative z-10 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                        isDone ? 'bg-pencil text-white' : isCur ? 'bg-ink text-white' : 'border border-rule-strong bg-paper text-graphite',
                      )}
                    >
                      {isDone ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                    </span>
                    <span>
                      <span className={cn('block text-[13.5px]', isCur ? 'font-semibold' : 'text-ink')}>{s.title}</span>
                      <span className="block text-xs text-faint">{s.sub}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>

          <div className="min-w-0">
            {step === 'install' && (
              <StepCard
                icon={<Terminal className="size-5" />}
                title="安装 wtow CLI"
                lead="macOS 和 Linux 都可以用这一行安装，二进制会放到 ~/.local/bin。"
                onNext={() => complete('install')}
              >
                <CopyField value={`curl -fsSL ${origin}/install.sh | sh`} />
                <Checklist
                  items={[
                    <>
                      装完运行 <code>wtow --version</code>，能看到版本号就成功了。
                    </>,
                    <>
                      如果提示找不到命令，把 <code>~/.local/bin</code> 加进 PATH。
                    </>,
                    <>
                      也可以去 <a className="text-pencil hover:underline" href="/download">下载页</a> 手动下载对应平台的二进制。
                    </>,
                  ]}
                />
              </StepCard>
            )}

            {step === 'token' && (
              <StepCard
                icon={<FolderPlus className="size-5" />}
                title="选择项目，生成访问令牌"
                lead="令牌只能访问一个项目，权限不会超过你在这个项目里的角色。"
                onNext={() => complete('token')}
                nextDisabled={!project}
                nextLabel={token ? '下一步' : '我已经有令牌了'}
              >
                {projects.data && active.length === 0 ? (
                  <div className="rounded-md border border-dashed border-rule-strong p-5 text-[13px] leading-relaxed text-graphite">
                    你还没有加入任何项目。
                    <Link to="/?new=1" className="mx-1 text-pencil hover:underline">
                      新建一个项目
                    </Link>
                    ，或者请管理员用你的注册邮箱把你加进去。
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {!routeSlug && (
                      <div className="max-w-sm">
                        <Select value={slug ?? ''} onChange={(e) => setPicked(e.target.value || null)}>
                          <option value="">选择项目…</option>
                          {active.map((p) => (
                            <option key={p.slug} value={p.slug}>
                              {p.name}（{p.slug}）
                            </option>
                          ))}
                        </Select>
                      </div>
                    )}
                    {project && (
                      <div className="flex flex-wrap items-center gap-4 rounded-md border border-rule bg-paper px-4 py-3.5">
                        <div className="min-w-0 flex-1 text-[13px]">
                          <div className="font-medium">{project.name}</div>
                          <div className="mt-0.5 text-graphite">
                            你的角色：{project.my_roles.map((r) => ROLE_LABEL[r]).join('、')}
                          </div>
                        </div>
                        {token ? (
                          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-done">
                            <Check className="size-4" />
                            已生成「{token.name}」
                          </span>
                        ) : (
                          <Button variant="primary" onClick={() => setCreatingToken(true)}>
                            生成令牌
                          </Button>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-graphite">
                      令牌明文只显示一次。之后可以在项目的 <span className="text-ink">设置 › 访问令牌</span> 里查看、吊销。
                    </p>
                  </div>
                )}
              </StepCard>
            )}

            {step === 'login' && (
              <StepCard
                icon={<Terminal className="size-5" />}
                title="登录 CLI"
                lead={token ? '命令里已经填好了刚生成的令牌，复制到终端运行即可。' : '把命令里的 <令牌> 换成你的令牌后运行。'}
                onNext={() => complete('login')}
              >
                <CopyField
                  multiline
                  value={`wtow login --base-url ${origin} --project ${slug ?? '<项目标识>'} --token ${token?.secret ?? '<令牌>'}`}
                />
                <Checklist
                  items={[
                    <>
                      运行 <code>wtow whoami</code>，能看到你的邮箱和角色就说明登录成功。
                    </>,
                    <>
                      凭证存在 <code>~/.config/wtow/config.toml</code>，每个项目一个 profile，用 <code>wtow profile use &lt;名字&gt;</code> 切换。
                    </>,
                  ]}
                />
                <details className="group mt-5 rounded-md border border-rule">
                  <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-medium select-none group-open:border-b group-open:border-rule">
                    在团队仓库里共享配置
                  </summary>
                  <div className="flex flex-col gap-3 p-4">
                    <p className="text-[13px] leading-relaxed text-graphite">
                      在代码仓库根目录提交一个 <code>.wtow.toml</code>，Agent 在仓库里运行命令时会自动认出项目。令牌放环境变量，不进仓库。
                    </p>
                    <CopyField multiline label=".wtow.toml" value={`base_url = "${origin}"\nproject  = "${slug ?? '<项目标识>'}"`} />
                    <CopyField label="环境变量" value={`export WTOW_TOKEN="${token?.secret ?? 'wtow_pat_…'}"`} />
                  </div>
                </details>
              </StepCard>
            )}

            {step === 'skill' && (
              <StepCard
                icon={<Bot className="size-5" />}
                title="安装 Agent Skill"
                lead="Skill 告诉 Claude Code 什么时候、怎样调用 wtow：提交反馈、拆分任务、领取并交付。"
                onNext={() => complete('skill')}
              >
                <CopyField value="wtow skill install" />
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <ScopeCard title="装给自己（默认）" path="~/.claude/skills/wtow/" desc="你本机所有项目里的 Agent 都能用。" />
                  <ScopeCard
                    title="装进当前仓库"
                    path="./.claude/skills/wtow/"
                    desc="随仓库提交，团队成员拉代码就有。"
                    cmd="wtow skill install --scope project"
                  />
                </div>
              </StepCard>
            )}

            {step === 'use' && (
              <StepCard
                icon={<Check className="size-5" />}
                title="开始使用"
                lead={project ? `下面是你在「${project.name}」里能做的事。可以直接对 Agent 说，也可以自己敲命令。` : '按角色看看能做什么。'}
                onNext={() => complete('use')}
                nextLabel="完成"
                extra={
                  project && (
                    <Link to={`/p/${project.slug}`}>
                      <Button>进入项目</Button>
                    </Link>
                  )
                }
              >
                <RoleTips project={project} />
              </StepCard>
            )}
          </div>
        </div>
      </main>
      {project && <CreateTokenDialog project={project} open={creatingToken} onOpenChange={setCreatingToken} onCreated={setToken} />}
    </>
  )
}

function StepCard({
  icon,
  title,
  lead,
  children,
  onNext,
  nextLabel = '下一步',
  nextDisabled,
  extra,
}: {
  icon: ReactNode
  title: string
  lead: string
  children: ReactNode
  onNext: () => void
  nextLabel?: string
  nextDisabled?: boolean
  extra?: ReactNode
}) {
  return (
    <section key={title} className="animate-pop-in rounded-lg border border-rule bg-surface">
      <div className="px-7 pt-7 pb-6 max-md:px-5">
        <div className="mb-4 grid size-10 place-items-center rounded-lg bg-pencil-wash text-pencil">{icon}</div>
        <h2 className="font-display text-[22px] font-semibold tracking-tight">{title}</h2>
        <p className="mt-1.5 mb-6 text-[13.5px] leading-relaxed text-graphite">{lead}</p>
        {children}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-rule bg-paper/50 px-7 py-3.5 max-md:px-5">
        {extra}
        <Button variant="primary" onClick={onNext} disabled={nextDisabled}>
          {nextLabel}
        </Button>
      </div>
    </section>
  )
}

function Checklist({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-5 flex flex-col gap-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-graphite">
          <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-rule-strong" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  )
}

function ScopeCard({ title, path, desc, cmd }: { title: string; path: string; desc: string; cmd?: string }) {
  return (
    <div className="rounded-md border border-rule p-4">
      <div className="text-[13px] font-medium">{title}</div>
      <div className="mt-1 font-mono text-xs text-pencil">{path}</div>
      <div className="mt-1.5 text-xs leading-relaxed text-graphite">{desc}</div>
      {cmd && <div className="mt-2.5 font-mono text-[11.5px] text-graphite">{cmd}</div>}
    </div>
  )
}

const TIPS: { role: Role; icon: ReactNode; title: string; say: string; cli: string; web: string }[] = [
  {
    role: 'tester',
    icon: <Inbox className="size-4" />,
    title: '提交反馈',
    say: '帮我把登录页白屏的问题提交到 wtow，附上这张截图。',
    cli: 'wtow raw submit --title "登录页白屏" \\\n  --desc "iOS 17 点击登录后白屏" \\\n  --tag login --attach shot.png',
    web: '在「原始小作文」提交，切到「我提交的」跟踪交付进度。',
  },
  {
    role: 'assigner',
    icon: <Shuffle className="size-4" />,
    title: '整理与拆分',
    say: '处理 wtow 里待处理的小作文：相似的合并，然后拆成开发任务。',
    cli: 'wtow raw list --status Pending\nwtow raw claim RAW-1001\nwtow raw related RAW-1001\nwtow exec create --from RAW-1001 \\\n  --instruction "…" --close',
    web: '在「分配工作台」认领、对照相似项、合并或拆分。',
  },
  {
    role: 'developer',
    icon: <Code2 className="size-4" />,
    title: '领取与交付',
    say: '从 wtow 领一个优先级最高的任务做掉，完成后附上 PR 链接。',
    cli: 'wtow exec list --status Queued\nwtow exec claim EXEC-1001\nwtow exec complete EXEC-1001 \\\n  --notes "…" --link <PR 地址>',
    web: '在「执行小作文」领取，完成后填写交付说明和链接。',
  },
]

function RoleTips({ project }: { project: Project | null }) {
  const tips = project ? TIPS.filter((t) => hasRole(project.my_roles, t.role)) : TIPS
  const [active, setActive] = useState(tips[0]?.role)
  const tip = tips.find((t) => t.role === active) ?? tips[0]
  if (!tip) return null
  return (
    <div>
      {tips.length > 1 && (
        <div className="mb-4 flex gap-1 border-b border-rule">
          {tips.map((t) => (
            <button
              key={t.role}
              onClick={() => setActive(t.role)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-3 pb-2.5 text-[13px] transition-colors',
                t.role === tip.role ? 'border-pencil font-medium text-pencil' : 'border-transparent text-graphite hover:text-ink',
              )}
            >
              {t.icon}
              {ROLE_LABEL[t.role]}：{t.title}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs text-graphite">
            <Bot className="size-3.5" />
            对 Agent 说
          </div>
          <div className="relative rounded-lg rounded-tl-sm bg-pencil-wash px-4 py-3 text-[14px] leading-relaxed text-pencil-deep">{tip.say}</div>
          <p className="mt-4 text-[13px] leading-relaxed text-graphite">
            <span className="text-ink">在网页上：</span>
            {tip.web}
          </p>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs text-graphite">
            <Terminal className="size-3.5" />
            或者自己敲
          </div>
          <CopyField multiline value={tip.cli} />
        </div>
      </div>
    </div>
  )
}
