// 与 contract/src/dto.rs 一一对应。改 DTO 时同步这里。

export type Role = 'tester' | 'assigner' | 'developer' | 'admin'
export type ActorType = 'human' | 'agent'

export interface Meta {
  server_version: string
  api_version: number
  min_cli_version: string
}

export interface User {
  id: number
  email: string
  display_name: string
}

export interface Project {
  slug: string
  name: string
  description: string
  require_human_triage: boolean
  archived: boolean
  my_roles: Role[]
}

export interface Member {
  user_id: number
  email: string
  display_name: string
  roles: Role[]
}

export interface Token {
  id: number
  name: string
  prefix: string
  roles: Role[]
  read_only: boolean
  actor_type: ActorType
  revoked: boolean
  user_id: number
  owner: string
  last_used_at: string | null
  expires_at: string | null
  created_at: string
}

export interface CreatedToken extends Token {
  secret: string
}

export interface Page<T> {
  items: T[]
  total: number
}

export type RawStatus = 'Pending' | 'Claimed' | 'Processed' | 'Merged' | 'Duplicate' | 'Ignored'
export type Delivery = 'none' | 'in_progress' | 'delivered' | 'cancelled'

export interface Attachment {
  id: string
  filename: string
  mime: string
  size_bytes: number
  owner_id: string | null
}

export interface RawComposition {
  id: string
  title: string
  description: string
  tags: string[]
  status: RawStatus
  reporter_id: number
  claimed_by: number | null
  claimed_at: string | null
  merged_into_id: string | null
  triage_reason: string | null
  version: number
  created_at: string
  updated_at: string
  delivery: Delivery
  attachments: Attachment[]
}

export type ExecStatus = 'Queued' | 'InProgress' | 'Done' | 'Cancelled'

export interface ExecComposition {
  id: string
  instruction: string
  target_resources: string[]
  status: ExecStatus
  priority: number
  assigner_id: number
  developer_id: number | null
  claimed_at: string | null
  developer_notes: string | null
  result_links: string[] | null
  version: number
  created_at: string
  updated_at: string
  completed_at: string | null
  source_raw_ids: string[]
  attachments: Attachment[]
}

export interface RelatedItem {
  kind: 'raw' | 'exec'
  id: string
  title: string
  status: string
  score: number
  reasons: string[]
}

export interface ErrorBody {
  code: string
  message: string
  details: unknown
}
