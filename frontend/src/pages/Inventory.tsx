import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useItems } from '../api/items'
import { useMasters } from '../api/masters'
import { requestAccess } from '../api/requests'
import { useAuth } from '../api/auth'
import { canWrite, isOic } from '../lib/permissions'
import { daysLeft, expiryOf, STATUSES } from '../lib/rules'
import { StatusBadge, DueCell } from '../components/Badges'
import { exportXlsx, exportPdf, ITEM_HEAD, itemRow } from '../lib/export'
import Spares from './Spares'
import type { Item } from '../types'

interface Filters { q: string; c: string; s: string; p: string; l: string; o: string; v: string; r: string; x: boolean }
const EMPTY: Filters = { q: '', c: '', s: '', p: '', l: '', o: '', v: '', r: '', x: false }
const inRange = (i: Item, r: string) => { const l = daysLeft(expiryOf(i)); return !r || (l != null && (r === 'od' ? l < 0 : l >= 0 && l <= +r)) }

function AddMenu({ cat }: { cat: string }) {
  const [open, setOpen] = useState(false), ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div className="dd" ref={ref}>
      <button className="btn p" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>+ Add item ▾</button>
      {open && (
        <div className="ddm" role="menu">
          <Link role="menuitem" to="/inventory/new" state={cat ? { c: cat } : undefined}><b>Add one item</b><small>Fill in a form and attach documents</small></Link>
          <Link role="menuitem" to="/inventory/import"><b>Bulk import</b><small>Upload many items from an Excel file</small></Link>
        </div>
      )}
    </div>
  )
}

function AccessRequest() {
  const { user } = useAuth(), m = useMasters()
  const [p, setP] = useState(''), [why, setWhy] = useState(''), [msg, setMsg] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const mine = new Set((user?.projects ?? []).map((x) => x.toLowerCase()))
  const options = m.projects.filter((x) => x.active && !mine.has(x.name.toLowerCase()))
  const send = async () => {
    setBusy(true); setErr(''); setMsg('')
    const r = await requestAccess(p, why)
    setBusy(false)
    if (r.error) return setErr(r.error)
    setMsg('Request sent. An admin or inventory manager will decide it. See My requests.')
    setP(''); setWhy('')
  }
  return (
    <details className="card noprint">
      <summary style={{ cursor: 'pointer' }}><b>Your projects:</b> {user?.projects.length ? user.projects.join(', ') : 'none yet'}. Need another project?</summary>
      <div className="row" style={{ margin: '12px 0 0' }}>
        <select value={p} onChange={(e) => setP(e.target.value)} style={{ width: 'auto' }}><option value="">Choose a project…</option>{options.map((x) => <option key={x.name}>{x.name}</option>)}</select>
        <input className="s" placeholder="Why do you need it? (optional)" maxLength={200} value={why} onChange={(e) => setWhy(e.target.value)} />
        <button className="btn p" disabled={!p || busy} onClick={send}>Request access</button>
      </div>
      {err && <div className="er" style={{ marginTop: 10 }}>{err}</div>}
      {msg && <div className="note" style={{ marginTop: 10 }}>{msg}</div>}
    </details>
  )
}

export default function Inventory() {
  const items = useItems(), nav = useNavigate(), { user } = useAuth(), [sp] = useSearchParams()
  const [f, setF] = useState({ ...EMPTY, c: sp.get('c') ?? '', p: sp.get('p') ?? '', l: sp.get('l') ?? '' })
  const set = (k: keyof Filters) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value })
  const u = (k: keyof Item) => [...new Set(items.map((i) => String(i[k] ?? '')).filter(Boolean))].sort()
  const rows = items.filter((i) => (f.x || i.active) && (!f.c || i.c === f.c) && (!f.s || i.status === f.s) && (!f.p || i.project === f.p) && (!f.l || i.loc === f.l)
    && (!f.o || i.oic === f.o) && (!f.v || i.vendor === f.v) && (!f.q || (i.id + i.mg + i.desc + i.use + i.sn + i.make + i.model).toLowerCase().includes(f.q.toLowerCase())) && inRange(i, f.r))
  const sel = (k: Exclude<keyof Filters, 'x'>, l: string, a: string[]) => (
    <div key={k}><label>{l}</label>
      <select value={f[k]} onChange={set(k)}><option value="">All</option>{a.map((x) => <option key={x}>{x}</option>)}</select>
    </div>
  )
  return (
    <>
      <div className="hd"><div><h1>Inventory</h1><p className="mu">Find, track and manage every item throughout its lifecycle.</p></div>{canWrite(user) && <AddMenu cat={f.c} />}</div>
      {isOic(user) && <AccessRequest />}
      <div className="tabs noprint">
        {([['', 'All items'], ['Asset', 'Assets'], ['License', 'Software licenses'], ['Spare', 'Spares & stock']] as const).map(([c, t]) => (
          <button key={c} className={f.c === c ? 'on' : ''} onClick={() => setF({ ...f, c })}>{t} {items.filter((i) => i.active && (!c || i.c === c)).length}</button>
        ))}
      </div>
      {f.c === 'Spare' ? <Spares embedded /> : <>
      <div className="card">
        <div className="row">
          <input className="s" placeholder="Search by item ID, MG No, name, description or serial number" value={f.q} onChange={set('q')} />
          <button className="btn" onClick={() => exportXlsx('inventory', ITEM_HEAD, rows.map(itemRow))}>Excel</button>
          <button className="btn" onClick={exportPdf}>PDF</button>
          <label style={{ margin: 0 }}><input type="checkbox" checked={f.x} onChange={set('x')} style={{ width: 'auto' }} /> Show inactive</label>
        </div>
        <div className="f2">
          {sel('c', 'Category', ['Asset', 'License', 'Spare'])}{sel('s', 'Status', STATUSES)}{sel('p', 'Project', u('project'))}{sel('l', 'Location / site', u('loc'))}
          {sel('o', 'OIC', u('oic'))}{sel('v', 'Vendor', u('vendor'))}
          <div><label>Renewal / expiry</label>
            <select value={f.r} onChange={set('r')}>
              <option value="">Any date</option><option value="30">Next 30 days</option><option value="90">Next 90 days</option><option value="od">Overdue</option>
            </select>
          </div>
        </div>
        <div className="row" style={{ margin: '12px 0 0' }}><button className="btn" onClick={() => setF(EMPTY)}>Reset filters</button></div>
      </div>
      <div className="card">
        <h2>All inventory</h2><small>{rows.length} of {items.length} records</small>
        <div className="sc"><table>
          <thead><tr><th>Item</th><th>Category</th><th>Project / site</th><th>OIC / current user</th><th>Status</th><th>Renewal / warranty</th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} onClick={() => nav(`/inventory/${i.id}`)}>
                <td><b>{i.desc}</b><small>{i.id}{i.sn && i.c === 'Asset' ? ` · SN ${i.sn}` : ''}{i.mg ? ` · MG ${i.mg}` : ''}{i.c === 'License' ? ` · ${i.qty} seats` : i.c === 'Spare' ? ` · ${i.qty} units` : ''}</small></td>
                <td>{i.c}</td><td>{i.project}<br /><small>{i.loc}</small></td>
                <td>{i.oic}<br /><small>{i.user || 'Unassigned'}{i.dept ? ` · ${i.dept}` : ''}</small></td>
                <td><StatusBadge s={i.status} />{!i.active && <> <span className="bd">Inactive</span></>}</td><td><DueCell i={i} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6}>No items match. Reset the filters or add an item.</td></tr>}
          </tbody>
        </table></div>
      </div>
      </>}
    </>
  )
}
