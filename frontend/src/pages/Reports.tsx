import { useState, type ChangeEvent } from 'react'
import { useItems } from '../api/items'
import { CURRENCY, daysLeft, expiryOf, money, STATUSES } from '../lib/rules'
import { exportXlsx, exportPdf, ITEM_HEAD, itemRow } from '../lib/export'
import { Kpi } from '../components/Badges'
import type { Item } from '../types'

type Tab = 'register' | 'renewals' | 'movements' | 'custody'
const TABS: [Tab, string][] = [['register', 'Inventory register'], ['renewals', 'Renewals & warranties'], ['movements', 'Stock movements'], ['custody', 'Custody summary']]
const EMPTY = { p: '', c: '', v: '', l: '', o: '', s: '', from: '', to: '' }

export default function Reports() {
  const all = useItems()
  const [tab, setTab] = useState<Tab>('register')
  const [f, setF] = useState(EMPTY)
  const set = (k: keyof typeof EMPTY) => (e: ChangeEvent<HTMLSelectElement | HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const u = (k: keyof Item) => [...new Set(all.map((i) => String(i[k] ?? '')).filter(Boolean))].sort()
  const items = all.filter((i) => i.active && (!f.p || i.project === f.p) && (!f.c || i.c === f.c) && (!f.v || i.vendor === f.v) && (!f.l || i.loc === f.l)
    && (!f.o || i.oic === f.o) && (!f.s || i.status === f.s) && (!f.from || (expiryOf(i) && expiryOf(i) >= f.from)) && (!f.to || (expiryOf(i) && expiryOf(i) <= f.to)))

  let head: string[], rows: (string | number)[][]
  if (tab === 'register') { head = ITEM_HEAD; rows = items.map(itemRow) }
  else if (tab === 'renewals') {
    head = ['Item', 'ID', 'Category', 'Vendor', 'OIC', 'Qty / seats', 'Renewal / expiry', 'Days left', 'Status', `Cost (${CURRENCY})`]
    rows = items.filter((i) => expiryOf(i)).sort((a, b) => expiryOf(a).localeCompare(expiryOf(b))).map((i) => [i.desc, i.id, i.c, i.vendor, i.oic, i.qty, expiryOf(i), daysLeft(expiryOf(i)) ?? '', i.status, i.cost])
  } else if (tab === 'movements') {
    head = ['Date / time', 'Item', 'ID', 'Movement', 'Details', 'By']
    rows = items.filter((i) => i.c === 'Spare').flatMap((i) => i.hist.filter((h) => h.a === 'Stock in' || h.a === 'Stock out').map((h) => [h.t, i.desc, i.id, h.a, h.n, h.by]))
  } else {
    head = ['OIC', 'Assets', 'Licenses', 'Spares', 'Total']
    rows = u('oic').filter((n) => items.some((i) => i.oic === n)).map((n) => { const m = items.filter((i) => i.oic === n); return [n, ...(['Asset', 'License', 'Spare'] as const).map((c) => m.filter((i) => i.c === c).length), m.length] })
  }
  const lic = items.filter((i) => i.c === 'License')
  const sel = (k: keyof typeof EMPTY, l: string, a: string[]) => (
    <div key={k}><label>{l}</label><select value={f[k]} onChange={set(k)}><option value="">All</option>{a.map((x) => <option key={x}>{x}</option>)}</select></div>
  )
  const name = TABS.find((t) => t[0] === tab)![1]
  return (
    <>
      <div className="hd noprint">
        <div><h1>Reports</h1><p className="mu">Turn the live register into filter-aware operational reports.</p></div>
        <div className="acts"><button className="btn" onClick={() => exportXlsx(tab, head, rows)}>Export Excel</button><button className="btn p" onClick={exportPdf}>Export PDF</button></div>
      </div>
      <div className="tabs noprint">{TABS.map(([k, t]) => <button key={k} className={k === tab ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>)}</div>
      <div className="card noprint">
        <div className="hd" style={{ margin: '0 0 8px' }}><h2>Report filters</h2><button className="btn" onClick={() => setF(EMPTY)}>Reset filters</button></div>
        <div className="f2">
          {sel('p', 'Project', u('project'))}{sel('c', 'Category', ['Asset', 'License', 'Spare'])}{sel('v', 'Vendor', u('vendor'))}{sel('l', 'Location', u('loc'))}
          {sel('o', 'OIC', u('oic'))}{sel('s', 'Status', STATUSES)}
          <div><label>Renewal from</label><input type="date" value={f.from} onChange={set('from')} /></div>
          <div><label>Renewal to</label><input type="date" value={f.to} onChange={set('to')} /></div>
        </div>
      </div>
      <div className="note noprint"><b>Exports match this filtered report.</b> Excel exports as an .xlsx workbook. PDF uses your browser print dialog. License keys are never included.</div>
      <div className="g3">
        <Kpi t="Matching records" b={rows.length} s={name} />
        <Kpi t="Seats covered" b={lic.reduce((a, i) => a + i.qty, 0)} s={`${lic.length} software licenses`} />
        <Kpi t="Renewal value" b={money(lic.reduce((a, i) => a + (+i.cost || 0), 0)) || 'S$0.00'} s={`${CURRENCY} · licenses in this report`} />
      </div>
      <div className="card">
        <h2>{name}</h2><small>Generated {new Date().toLocaleString()} · Admin</small>
        <div className="sc"><table>
          <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{c === '' ? '—' : c}</td>)}</tr>)}
            {!rows.length && <tr><td colSpan={head.length}>No records match these filters.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
