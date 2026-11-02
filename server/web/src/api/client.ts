import type {
  CreatedToken,
  ErrorBody,
  ExecComposition,
  ExecStatus,
  Member,
  Meta,
  Page,
  Project,
  RawComposition,
  RawStatus,
  RelatedItem,
  Role,
  Token,
  User,
} from './types'

const BASE = '/api/v1'

export class ApiError extends Error {
  status: number
  code: string
  details: unknown

  constructor(status: number, body: ErrorBody) {
    super(body.message)
    this.status = status
    this.code = body.code
    this.details = body.details
  }
}

type Query = Record<string, string | number | boolean | undefined | null>

function qs(q?: Query): string {
  if (!q) return ''
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const headers: Record<string, string> = {}
  // 会话 Cookie 的写请求必须带此头，服务端借此防 CSRF。
  if (method !== 'GET') headers['x-requested-with'] = 'wtow-web'
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(BASE + path + qs(query), {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? JSON.parse(text) : undefined
  if (!res.ok) {
    const err: ErrorBody = data?.error ?? { code: 'HTTP_' + res.status, message: res.statusText, details: null }
    throw new ApiError(res.status, err)
  }
  return data as T
}

const p = (slug: string) => `/projects/${encodeURIComponent(slug)}`

export const api = {
  meta: () => request<Meta>('GET', '/meta'),

  me: () => request<User>('GET', '/me'),
  login: (email: string, password: string) => request<User>('POST', '/auth/login', { email, password }),
  register: (email: string, display_name: string, password: string) =>
    request<User>('POST', '/auth/register', { email, display_name, password }),
  logout: () => request<void>('POST', '/auth/logout'),

  projects: () => request<Project[]>('GET', '/projects'),
  createProject: (slug: string, name: string, description: string) =>
    request<Project>('POST', '/projects', { slug, name, description }),
  project: (slug: string) => request<Project>('GET', p(slug)),
  updateProject: (
    slug: string,
    patch: Partial<Pick<Project, 'name' | 'description' | 'require_human_triage' | 'archived'>>,
  ) => request<Project>('PATCH', p(slug), patch),

  members: (slug: string) => request<Member[]>('GET', `${p(slug)}/members`),
  upsertMember: (slug: string, email: string, roles: Role[]) =>
    request<Member>('PUT', `${p(slug)}/members`, { email, roles }),
  removeMember: (slug: string, userId: number) => request<void>('DELETE', `${p(slug)}/members/${userId}`),

  tokens: (slug: string) => request<Token[]>('GET', `${p(slug)}/tokens`),
  createToken: (
    slug: string,
    req: { name: string; roles: Role[]; read_only: boolean; actor_type: 'human' | 'agent'; expires_in_days?: number },
  ) => request<CreatedToken>('POST', `${p(slug)}/tokens`, req),
  revokeToken: (slug: string, id: number) => request<void>('POST', `${p(slug)}/tokens/${id}/revoke`),

  raws: (slug: string, q: { status?: RawStatus; mine?: boolean; q?: string; tag?: string; page?: number; page_size?: number }) =>
    request<Page<RawComposition>>('GET', `${p(slug)}/raw`, undefined, q),
  raw: (slug: string, id: string) => request<RawComposition>('GET', `${p(slug)}/raw/${id}`),
  submitRaw: (slug: string, title: string, description: string, tags: string[]) =>
    request<RawComposition>('POST', `${p(slug)}/raw`, { title, description, tags }),
  rawExecs: (slug: string, id: string) => request<ExecComposition[]>('GET', `${p(slug)}/raw/${id}/execs`),
  related: (slug: string, id: string) => request<RelatedItem[]>('GET', `${p(slug)}/raw/${id}/related`),
  claimRaw: (slug: string, id: string) => request<RawComposition>('POST', `${p(slug)}/raw/${id}/claim`),
  releaseRaw: (slug: string, id: string) => request<RawComposition>('DELETE', `${p(slug)}/raw/${id}/claim`),
  triageRaw: (
    slug: string,
    id: string,
    action: 'merge' | 'duplicate' | 'ignore',
    req: { target_id?: string; reason: string },
  ) => request<RawComposition>('POST', `${p(slug)}/raw/${id}/${action}`, req),
  reopenRaw: (slug: string, id: string, reason: string) =>
    request<RawComposition>('POST', `${p(slug)}/raw/${id}/reopen`, { reason }),

  execs: (slug: string, q: { status?: ExecStatus; developer_id?: number; q?: string; page?: number; page_size?: number }) =>
    request<Page<ExecComposition>>('GET', `${p(slug)}/exec`, undefined, q),
  exec: (slug: string, id: string) => request<ExecComposition>('GET', `${p(slug)}/exec/${id}`),
  execRaws: (slug: string, id: string) => request<RawComposition[]>('GET', `${p(slug)}/exec/${id}/raws`),
  createExec: (
    slug: string,
    req: { source_raw_ids: string[]; instruction: string; target_resources: string[]; priority: number; close_sources: boolean },
  ) => request<ExecComposition>('POST', `${p(slug)}/exec`, req),
  claimExec: (slug: string, id: string, force = false) =>
    request<ExecComposition>('POST', `${p(slug)}/exec/${id}/claim`, undefined, { force: force || undefined }),
  releaseExec: (slug: string, id: string, reason: string) =>
    request<ExecComposition>('DELETE', `${p(slug)}/exec/${id}/claim`, { reason }),
  completeExec: (slug: string, id: string, developer_notes: string, result_links: string[]) =>
    request<ExecComposition>('POST', `${p(slug)}/exec/${id}/complete`, { developer_notes, result_links }),
  cancelExec: (slug: string, id: string, reason: string, requeue_sources = true) =>
    request<ExecComposition>('POST', `${p(slug)}/exec/${id}/cancel`, { reason, requeue_sources }),
  reopenExec: (slug: string, id: string, reason: string) =>
    request<ExecComposition>('POST', `${p(slug)}/exec/${id}/reopen`, { reason }),
}
