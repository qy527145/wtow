import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { ErrorText } from '../components/ui'

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
    <div className="auth">
      <form
        className="card auth-card"
        onSubmit={(e) => {
          e.preventDefault()
          submit.mutate()
        }}
      >
        <h1>WTOW</h1>
        <p className="muted">小作文托管平台：提交反馈 → 合并去重 → 拆成任务 → 开发交付</p>
        <div className="seg">
          <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>
            登录
          </button>
          <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>
            注册
          </button>
        </div>
        <label>
          邮箱
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        {mode === 'register' && (
          <label>
            显示名
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="默认取邮箱前缀" />
          </label>
        )}
        <label>
          密码
          <input
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <ErrorText error={submit.error} />
        <button className="primary block" disabled={submit.isPending}>
          {submit.isPending ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
        </button>
      </form>
    </div>
  )
}
