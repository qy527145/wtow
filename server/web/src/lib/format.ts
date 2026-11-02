import type { Delivery, ExecStatus, RawStatus, Role } from '../api/types'

export const ROLE_LABEL: Record<Role, string> = {
  tester: '测试者',
  assigner: '分配者',
  developer: '开发者',
  admin: '管理员',
}

export const ALL_ROLES: Role[] = ['tester', 'assigner', 'developer', 'admin']

export const RAW_STATUS_LABEL: Record<RawStatus, string> = {
  Pending: '待处理',
  Claimed: '处理中',
  Processed: '已拆分',
  Merged: '已合并',
  Duplicate: '重复',
  Ignored: '已忽略',
}

export const EXEC_STATUS_LABEL: Record<ExecStatus, string> = {
  Queued: '排队中',
  InProgress: '进行中',
  Done: '已完成',
  Cancelled: '已取消',
}

export const DELIVERY_LABEL: Record<Delivery, string> = {
  none: '未拆分',
  in_progress: '开发中',
  delivered: '已交付',
  cancelled: '已取消',
}

export const PRIORITIES = [0, 1, 2, 3] as const

export function priorityLabel(p: number): string {
  return `P${p}`
}

export function hasRole(roles: Role[] | undefined, r: Role): boolean {
  return !!roles && (roles.includes(r) || roles.includes('admin'))
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`
  return d.toLocaleDateString('zh-CN')
}

export function fmtDateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—'
}
