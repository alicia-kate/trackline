import type { ActionDef, ActionKey, Alert, Category, Item, Status } from '../types'

export const STATUSES: Status[] = ['Available', 'Assigned', 'In Use', 'Under Repair', 'Expired', 'Disposed']
export const dn = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
export const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ')
export const expiryOf = (i: Item) => (i.c === 'Asset' ? i.wdue : i.c === 'License' ? i.due : '') // warranty end for assets, renewal for licenses
export const daysLeft = (s: string | null | undefined): number | null => (s ? Math.round((Date.parse(s) - Date.parse(dn(0))) / 864e5) : null)
export const CURRENCY = 'SGD' // keep in step with CURRENCY in backend/app/services/importer.py
export const money = (v: number | '' | null | undefined) => (v === '' || v == null ? '' : 'S$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 }))

const AL: Category[] = ['Asset', 'License']
export const ACTIONS: Record<ActionKey, ActionDef> = {
  assign: { t: 'Assign', cats: AL, from: ['Available'], to: 'Assigned', fl: ['who', 'dept', 'loc', 'rem'] },
  use: { t: 'Mark in use', cats: AL, from: ['Assigned'], to: 'In Use', fl: ['rem'] },
  transfer: { t: 'Transfer', cats: AL, from: ['Assigned', 'In Use'], fl: ['who', 'dept', 'loc', 'rem'] },
  return: { t: 'Return', cats: AL, from: ['Assigned', 'In Use'], to: 'Available', fl: ['loc', 'rem'] },
  repair: { t: 'Send for repair', cats: ['Asset'], from: ['Available', 'Assigned', 'In Use'], to: 'Under Repair', fl: ['rem'] },
  fixed: { t: 'Repair completed', cats: ['Asset'], from: ['Under Repair'], to: 'Available', fl: ['loc', 'rem'] },
  renew: { t: 'Record renewal', cats: ['License'], from: ['Available', 'Assigned', 'In Use', 'Expired'], fl: ['due', 'cost', 'rem'] },
  in: { t: 'Stock in', cats: ['Spare'], from: ['Available'], fl: ['q', 'why', 'rem'] },
  out: { t: 'Stock out', cats: ['Spare'], from: ['Available'], fl: ['q', 'why', 'user', 'rem'] },
  dispose: { t: 'Dispose', cats: AL, from: ['Available', 'Under Repair', 'Expired'], to: 'Disposed', fl: ['remr'], d: 1 },
  off: { t: 'Deactivate', fl: ['rem'], d: 1 },
  on: { t: 'Reactivate', fl: ['rem'] },
}

export const canDo = (i: Item, a: ActionKey) => {
  const c = ACTIONS[a]
  return a === 'on' ? !i.active : i.active && (!c.cats || c.cats.includes(i.c)) && (!c.from || c.from.includes(i.status))
}

export function getAlerts(items: Item[]): Alert[] {
  const r: Alert[] = []
  items.filter((i) => i.active && i.status !== 'Disposed').forEach((i) => {
    const l = daysLeft(i.due), w = daysLeft(i.wdue)
    if (i.c === 'License' && l != null && l < 0) r.push({ i, k: 'Expired', w: -1000 + l, t: `${i.desc} has expired`, s: `Expired ${i.due} · ${i.qty} seats.` })
    else if (i.c === 'License' && l != null && l <= 30) r.push({ i, k: 'Renewal', w: l, t: `${i.desc} renewal approaching`, s: `${i.qty} seats · due ${i.due} · ${l} days remaining.` })
    if (i.c === 'Asset' && w != null && w >= 0 && w <= 30) r.push({ i, k: 'Warranty', w, t: `${i.desc} warranty ends soon`, s: `Coverage expires ${i.wdue} · ${w} days remaining.` })
    if (i.c === 'Spare' && i.qty < i.min) r.push({ i, k: 'Low stock', w: -500, t: `${i.desc} is below minimum`, s: `${i.qty} units / minimum ${i.min}. Reorder at least ${i.min - i.qty} units.` })
  })
  return r.sort((a, b) => a.w - b.w)
}
