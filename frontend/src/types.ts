export type Category = 'Asset' | 'License' | 'Spare'
export type Status = 'Available' | 'Assigned' | 'In Use' | 'Under Repair' | 'Expired' | 'Disposed'
export type ActionKey = 'assign' | 'use' | 'transfer' | 'return' | 'repair' | 'fixed' | 'renew' | 'in' | 'out' | 'dispose' | 'off' | 'on'
export type FieldKey = 'who' | 'user' | 'dept' | 'loc' | 'due' | 'cost' | 'q' | 'why' | 'rem' | 'remr'

export interface HistoryEntry { t: string; a: string; n: string; by: string }

export interface Item {
  id: string
  c: Category
  desc: string
  make: string
  model: string
  sn: string
  mg: string
  qty: number
  min: number
  date: string
  cost: number | ''
  project: string
  vendor: string
  due: string
  wdue: string
  winfo: string
  use: string
  status: Status
  loc: string
  oic: string
  user: string
  dept: string
  remarks: string
  active: boolean
  hist: HistoryEntry[]
}

export interface ActionDef { t: string; cats?: Category[]; from?: Status[]; to?: Status; fl: FieldKey[]; d?: number }
export interface Alert { i: Item; k: 'Expired' | 'Renewal' | 'Warranty' | 'Low stock'; w: number; t: string; s: string }

export type MasterKind = 'projects' | 'vendors' | 'locations' | 'departments'
export type MasterRow = { name: string; active: boolean; [k: string]: string | boolean }
export type Masters = Record<MasterKind, MasterRow[]>

export type Role = 'admin' | 'manager' | 'oic' | 'viewer'
export interface User { id: number; username: string; full_name: string | null; needs_approval: boolean; projects: string[]; role: Role; is_active: boolean; must_change_password: boolean; last_login_at: string | null; created_at: string }

export type RequestStatus = 'pending' | 'approved' | 'rejected'
export interface ChangeRequest {
  id: number
  kind: 'create' | 'update' | 'action' | 'attachment' | 'import' | 'access'
  itemId: string
  category: Category
  action?: ActionKey | null
  payload: Record<string, string | number>
  summary: string
  by: string
  at: string
  status: RequestStatus
  decidedBy?: string | null
  decidedAt?: string | null
  note?: string | null
  attachmentId?: number | null
  docs?: { id: number; name: string; type: string }[]
}

export type ImportKind = 'text' | 'int' | 'money' | 'date' | 'status' | 'project' | 'vendor' | 'loc' | 'dept'
export interface ImportCol { k: string; h: string; kind: ImportKind; req: boolean; help: string }
export interface ImportRow { key: string; c: Category; n: number; f: Record<string, string>; e: Record<string, string>; u?: string[] }
export type NewMasters = Partial<Record<MasterKind, string[]>>
export interface ImportCheck { rows: ImportRow[]; warnings: string[]; cols: Record<Category, ImportCol[]>; max: number }
export interface ImportResult { created: number; queued: boolean; submitted?: number; ids: Record<string, string[]>; masters_created?: NewMasters; skipped: ImportRow[] }

export interface StockMove { id: number; at: string; dir: 'in' | 'out'; qty: number; balance: number; why: string; to: string; note: string; by: string }

export interface Attachment {
  id: number
  itemId: string
  docType: string
  name: string
  type: string
  size: number
  by: string
  at: string
  status: 'active' | 'pending'
  items: string[]
}
