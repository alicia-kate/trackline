import type { Role, User } from '../types'

export const ROLE_LABEL: Record<Role, string> = { admin: 'Administrator', manager: 'Inventory Manager', oic: 'OIC/User', viewer: 'Viewer' }
export const ROLE_HELP: Record<Role, string> = {
  admin: 'Administrator: everything, including user accounts, projects, master data and approvals',
  manager: 'Inventory Manager: the same as an administrator, except creating and managing user accounts. Can give OIC/Users access to projects',
  oic: 'OIC/User: adds and edits items only in the projects assigned to them. Every change waits for approval',
  viewer: 'Viewer: read-only',
}

export const isAdmin = (u: User | null) => !!u && u.role === 'admin'
export const isOic = (u: User | null) => !!u && u.role === 'oic'
export const canWrite = (u: User | null) => !!u && u.role !== 'viewer' // add, edit, stock, documents; an OIC/User's changes wait for approval
export const canApprove = (u: User | null) => !!u && (u.role === 'admin' || u.role === 'manager')
