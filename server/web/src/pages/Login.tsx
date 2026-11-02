import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { Button, ErrorNote, Field, Input, Segmented } from '../components/ui'

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const submit = useMutation({
    mutationFn: async () => {
      if (mode === 'register') await api.register(email, name || email.split('@')[0], password)
      return api.login(email, password)
    },
    onSuccess: (user) => {
      qc.setQueryData(['me'], user)
      // 新注册用户先去引导页，老用户回到原来要去的地方。
      const next = params.get('next')
      navigate(mode === 'register' ? '/guide' : next && next.startsWith('/') ? next : '/', { replace: true })
    },
  })

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-ink text-white lg:flex lg:flex-col lg:justify-between lg:p-14">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 28 28" className="size-8" aria-hidden>
            <rect width="28" height="28" rx="7" fill="#fff" fillOpacity="0.08" />
            <path d="M6 9.5 C 12 9.5, 13 14, 21 14" fill="none" stroke="#9db5ff" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M6 18.5 C 12 18.5, 13 14, 21 14" fill="none" stroke="#9db5ff" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="21.5" cy="14" r="2.6" fill="#fff" />
          </svg>
          <span className="font-display text-xl font-bold tracking-tight">wtow</span>
        </div>

        <ConvergeArt />

        <div className="max-w-md">
          <h2 className="font-display text-[34px] leading-[1.15] font-semibold tracking-tight">
            十篇反馈，
            <br />
            归成一件要做的事。
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            测试者和 Agent 随手写下的小作文，经分配者合并、去重、过滤，变成开发者能直接领走的任务。
          </p>
        </div>
      </section>

      <section className="flex items-center justify-center bg-surface px-6 py-12">
        <form
          className="w-full max-w-[360px]"
          onSubmit={(e) => {
            e.preventDefault()
            submit.mutate()
          }}
        >
          <h1 className="font-display text-[28px] font-semibold tracking-tight">
            {mode === 'login' ? '欢迎回来' : '创建账号'}
          </h1>
          <p className="mt-1.5 text-[13px] text-graphite">
            {mode === 'login' ? '登录后进入你参与的项目。' : '注册后会带你一步步接入 CLI 和 Agent。'}
          </p>

          <div className="mt-7">
            <Segmented
              value={mode}
              onChange={(m) => {
                setMode(m)
                submit.reset()
              }}
              options={[
                { value: 'login', label: '登录' },
                { value: 'register', label: '注册' },
              ]}
            />
          </div>

          <div className="mt-5 flex flex-col gap-4">
            <Field label="邮箱">
              <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </Field>
            {mode === 'register' && (
              <Field label="显示名" hint="团队成员在看板上看到的名字，默认取邮箱前缀。">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
            )}
            <Field label="密码" hint={mode === 'register' ? '至少 8 位。' : undefined}>
              <Input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={mode === 'register' ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <ErrorNote error={submit.error} />
            <Button variant="primary" className="mt-1 h-10 w-full justify-center" loading={submit.isPending}>
              {mode === 'login' ? '登录' : '注册并登录'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}

/** 左侧插画：散落的原始小作文沿曲线汇入一条执行线。 */
function ConvergeArt() {
  const sources = [
    { y: 40, w: 150, label: '登录页白屏' },
    { y: 96, w: 120, label: '登录后空白' },
    { y: 152, w: 168, label: 'iOS 无法进入首页' },
    { y: 208, w: 110, label: '报销金额为 0' },
    { y: 264, w: 136, label: '金额显示异常' },
  ]
  const target = [{ y: 104 }, { y: 104 }, { y: 104 }, { y: 236 }, { y: 236 }]
  return (
    <svg viewBox="0 0 560 300" className="my-10 w-full max-w-[560px]" aria-hidden>
      {sources.map((s, i) => {
        const ty = target[i].y
        const len = 380
        return (
          <g key={i}>
            <rect x="0" y={s.y - 13} width={s.w} height="26" rx="6" fill="#fff" fillOpacity="0.07" stroke="#fff" strokeOpacity="0.14" />
            <text x="12" y={s.y + 4.5} fill="#fff" fillOpacity="0.72" fontSize="12.5">
              {s.label}
            </text>
            <path
              d={`M ${s.w + 6} ${s.y} C ${s.w + 120} ${s.y}, 300 ${ty}, 372 ${ty}`}
              fill="none"
              stroke="#9db5ff"
              strokeOpacity={0.55}
              strokeWidth="1.6"
              strokeDasharray={len}
              style={{ ['--len' as string]: len, animationDelay: `${i * 90}ms` }}
              className="animate-flow-in"
            />
          </g>
        )
      })}
      {[
        { y: 104, label: '修复 iOS 登录白屏', p: 'P1' },
        { y: 236, label: '修正报销金额计算', p: 'P2' },
      ].map((t) => (
        <g key={t.y}>
          <rect x="376" y={t.y - 17} width="184" height="34" rx="7" fill="#1f4fd8" />
          <text x="390" y={t.y + 4.5} fill="#fff" fontSize="13" fontWeight="600">
            {t.label}
          </text>
          <text x="532" y={t.y + 4.5} fill="#fff" fillOpacity="0.6" fontSize="11" fontWeight="600">
            {t.p}
          </text>
        </g>
      ))}
    </svg>
  )
}
