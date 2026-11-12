import { daysLeft, expiryOf } from '../lib/rules'
import type { Item } from '../types'

const C: Record<string, string> = { Available: 'gr', Assigned: 'bl', 'In Use': 'bl', 'Under Repair': 'am', Expired: 'rd' }

export const StatusBadge = ({ s }: { s: string }) => <span className={'bd ' + (C[s] || '')}>{s}</span>

export function DueCell({ i }: { i: Item }) {
  const d = expiryOf(i), l = daysLeft(d)
  if (i.c === 'Spare') return i.qty < i.min ? <span className="bd am">Low stock</span> : '—'
  if (l == null) return '—'
  return (
    <>
      {d}
      <br />
      <small>{i.c === 'License' ? 'Renewal' : 'Warranty'} · {l < 0 ? `${-l} days overdue` : `in ${l} days`}</small>
    </>
  )
}

export const Kpi = ({ t, b, s, on, active }: { t: string; b: number | string; s: string; on?: () => void; active?: boolean }) => (
  <div className={'card kpi' + (on ? ' lk' : '') + (active ? ' act' : '')} {...(on ? { role: 'button', tabIndex: 0, onClick: on, onKeyDown: (e: { key: string }) => e.key === 'Enter' && on() } : {})}>
    <small>{t}</small><b>{b}</b><small>{s}</small>
  </div>
)
