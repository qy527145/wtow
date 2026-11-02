import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { CreatedToken, Role } from '../api/types'
import { CopyBlock, Empty } from '../components/ui'
import { hasRole, ROLE_LABEL } from '../lib/format'
import { CreateTokenDialog } from './Settings'

/**
 * 首次使用引导：安装 CLI → 选项目并生成令牌 → 登录 → 安装 Skill → 按角色开始使用。
 * 挂在 /guide（全局）与 /p/:slug/guide（已选定项目）两处。
 */
export function GuidePage() {
  const routeSlug = useParams().slug
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects })
  const [picked, setPicked] = useState<string | null>(null)
  const active = (projects.data ?? []).filter((p) => !p.archived)
  const slug = routeSlug ?? picked ?? (active.length === 1 ? active[0].slug : null)
  const project = (projects.data ?? []).find((p) => p.slug === slug) ?? null
  const [token, setToken] = useState<CreatedToken | null>(null)
  const [creatingToken, setCreatingToken] = useState(false)
  const origin = location.origin

  const loginCmd = `wtow login --base-url ${origin} --project ${slug ?? '<项目标识>'} --token ${token?.secret ?? '<令牌>'}`

  const body = (
    <div className="guide">
      {!routeSlug && (
        <div className="guide-hero">
          <h1>欢迎使用 WTOW</h1>
          <p>
            WTOW 把零散的反馈（「小作文」）变成可执行的开发任务：测试者提交<strong>原始小作文</strong>，
            分配者合并、去重、过滤后拆成<strong>执行小作文</strong>，开发者领取并交付。人和 Agent 都可以参与每一环。
          </p>
          <FlowDiagram />
        </div>
      )}

      <Step n={1} title="安装 wtow CLI">
        <p>macOS / Linux 一行命令安装到 ~/.local/bin：</p>
        <CopyBlock text={`curl -fsSL ${origin}/install.sh | sh`} />
        <p className="hint">
          装完运行 <code>wtow --version</code> 确认。提示 PATH 缺失时把 ~/.local/bin 加入 PATH。也可以去
          <a href="/download">下载页</a>手动下载二进制。
        </p>
      </Step>

      <Step n={2} title="选择项目并生成访问令牌">
        {projects.data && active.length === 0 ? (
          <Empty>
            你还没有加入任何项目。<Link to="/">新建一个项目</Link>，或请管理员把你加为成员后再回到这里。
          </Empty>
        ) : (
          <>
            {!routeSlug && (
              <label>
                项目
                <select value={slug ?? ''} onChange={(e) => {
                    setPicked(e.target.value || null)
                    setToken(null)
                  }}>
                  <option value="">请选择…</option>
                  {active.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}（{p.slug}）
                    </option>
                  ))}
                </select>
              </label>
            )}
            {project && (
              <>
                <p>
                  你在 <strong>{project.name}</strong> 的角色：
                  {project.my_roles.map((r) => ROLE_LABEL[r]).join('、')}。令牌与单个项目绑定，权限不超过你的角色。
                </p>
                {token ? (
                  <div className="ok-text">已生成令牌「{token.name}」，下一步的命令已自动填好。</div>
                ) : (
                  <button className="primary" onClick={() => setCreatingToken(true)} disabled={project.archived}>
                    生成令牌
                  </button>
                )}
                <p className="hint">
                  已经有令牌？直接把下一步命令里的 &lt;令牌&gt; 换成它。令牌可在 <Link to={`/p/${project.slug}/settings`}>项目设置</Link> 管理。
                </p>
              </>
            )}
          </>
        )}
      </Step>

      <Step n={3} title="登录 CLI">
        <CopyBlock text={loginCmd} />
        <p className="hint">
          凭证保存在 ~/.config/wtow/config.toml，按项目名建 profile；多个项目用 <code>wtow profile use &lt;名字&gt;</code> 切换。
          运行 <code>wtow whoami</code> 检查是否登录成功。
        </p>
        <details>
          <summary>团队仓库里的推荐配置</summary>
          <p>
            在代码仓库根目录提交一个 <code>.wtow.toml</code>，Agent 在仓库里执行命令时自动识别项目；令牌通过环境变量注入，不进仓库：
          </p>
          <CopyBlock text={`# .wtow.toml\nbase_url = "${origin}"\nproject  = "${slug ?? '<项目标识>'}"`} />
          <CopyBlock text={`export WTOW_TOKEN="${token?.secret ?? 'wtow_pat_xxx'}"`} />
        </details>
      </Step>

      <Step n={4} title="安装 Agent Skill">
        <p>让 Claude Code 等 Agent 学会使用 wtow：</p>
        <CopyBlock text="wtow skill install" />
        <p className="hint">
          默认装到 ~/.claude/skills/wtow/（所有项目可用）。只想在当前代码仓库启用时用
          <code>wtow skill install --scope project</code>，会写入 ./.claude/skills/wtow/，可以随仓库提交。
        </p>
      </Step>

      <Step n={5} title="开始使用">
        <RoleTips roles={project?.my_roles} />
        {project && (
          <div className="actions left">
            <Link className="button primary" to={`/p/${project.slug}`}>
              进入 {project.name} →
            </Link>
          </div>
        )}
      </Step>
    </div>
  )

  return (
    <>
      {routeSlug ? body : <main className="page narrow">{body}</main>}
      {creatingToken && project && (
        <CreateTokenDialog project={project} onClose={() => setCreatingToken(false)} onCreated={setToken} />
      )}
    </>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="step card">
      <div className="step-n">{n}</div>
      <div className="step-body">
        <h3>{title}</h3>
        {children}
      </div>
    </section>
  )
}

function FlowDiagram() {
  return (
    <div className="flow-diagram">
      <div className="fd-node">
        <div className="fd-role">测试者</div>
        <div>提交原始小作文</div>
      </div>
      <span className="arrow">→</span>
      <div className="fd-node">
        <div className="fd-role">分配者</div>
        <div>合并 · 去重 · 忽略 · 拆分</div>
      </div>
      <span className="arrow">→</span>
      <div className="fd-node">
        <div className="fd-role">开发者</div>
        <div>领取执行小作文并交付</div>
      </div>
    </div>
  )
}

const TIPS: { role: Role; title: string; say: string; cli: string; web: string }[] = [
  {
    role: 'tester',
    title: '提交反馈',
    say: '「帮我把这个登录页白屏的问题提交到 wtow，附上截图」',
    cli: 'wtow raw submit --title "登录页白屏" --desc "复现步骤…" --tag login --attach shot.png',
    web: '在「原始管道」点「提交小作文」，切到「我提交的」可以跟踪交付进度。',
  },
  {
    role: 'assigner',
    title: '整理与拆分',
    say: '「处理一下 wtow 里待处理的小作文，相似的合并，然后拆成开发任务」',
    cli: 'wtow raw list --status Pending\nwtow raw claim RAW-1001 && wtow raw related RAW-1001\nwtow exec create --from RAW-1001 --instruction "…" --close',
    web: '在「分配工作台」认领 → 看相似项 → 合并 / 去重 / 忽略，或加入草稿后创建执行作文。',
  },
  {
    role: 'developer',
    title: '领取并交付',
    say: '「从 wtow 领一个优先级最高的任务做掉，完成后附上 PR 链接」',
    cli: 'wtow exec list --status Queued\nwtow exec claim EXEC-1001\nwtow exec complete EXEC-1001 --notes "…" --link <PR>',
    web: '在「执行管道」打开任务点「领取」，完成后「标记完成」并填写交付链接。',
  },
]

function RoleTips({ roles }: { roles?: Role[] }) {
  const tips = roles ? TIPS.filter((t) => hasRole(roles, t.role)) : TIPS
  return (
    <div className="role-tips">
      {tips.map((t) => (
        <div key={t.role} className="role-tip">
          <h4>
            {ROLE_LABEL[t.role]} · {t.title}
          </h4>
          <p>对 Agent 说：</p>
          <blockquote>{t.say}</blockquote>
          <p>或者直接用 CLI：</p>
          <CopyBlock text={t.cli} />
          <p className="hint">Web：{t.web}</p>
        </div>
      ))}
    </div>
  )
}

