import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useItems } from '../api/items'
import { useRequests } from '../api/requests'
import { exportXlsx } from '../lib/export'

interface Ev { t: string; a: string; n: string; by: string; id: string; desc: string; project: string; c: string }

const keyOf = (e: Ev) => [e.t, e.a, e.id, e.by, e.n].join('|')
const isItem = (id: string) => /^[A-Z]{3}-\d+$/.test(id)

export default function AuditTrail() {
  const items = useItems(), reqs = useRequests()
  const [q, setQ] = useState(''), [ev, setEv] = useState(''), [p, setP] = useState(''), [c, setC] = useState('')
  const [sel, setSel] = useState('')
  const rev: Ev[] = reqs.flatMap((r) => {
    const base = { id: r.itemId || 'New item', desc: r.summary, project: '', c: r.category as string }
    const out: Ev[] = [{ ...base, t: r.at, a: 'Approval requested', n: r.summary, by: r.by }]
    if (r.status !== 'pending') out.push({ ...base, t: r.decidedAt ?? r.at, a: r.status === 'approved' ? 'Request approved' : 'Request rejected', n: r.summary + (r.note ? ' · ' + r.note : ''), by: r.decidedBy ?? '' })
    return out
  })
  const all: Ev[] = [...items.flatMap((i) => i.hist.map((h) => ({ ...h, id: i.id, desc: i.desc, project: i.project, c: i.c as string }))), ...rev].sort((a, b) => b.t.localeCompare(a.t))
  const rows = all.filter((e) => (!ev || e.a === ev) && (!p || e.project === p) && (!c || e.c === c) && (!q || (e.id + e.desc + e.by + e.a + e.n).toLowerCase().includes(q.toLowerCase())))
  const cur = rows.find((e) => keyOf(e) === sel) ?? rows[0]
  const u = (f: (e: Ev) => string) => [...new Set(all.map(f).filter(Boolean))].sort()
  const dd = (l: string, v: string, set: (s: string) => void, a: string[]) => (
    <div><label>{l}</label><select value={v} onChange={(e) => set(e.target.value)}><option value="">All</option>{a.map((x) => <option key={x}>{x}</option>)}</select></div>
  )
  return (
    <>
      <div className="hd">
        <div><h1>Audit trail</h1><p className="mu">A record of who changed what, and when.</p></div>
        <button className="btn" onClick={() => exportXlsx('audit-log', ['Timestamp', 'Actor', 'Event', 'Item ID', 'Description', 'Project', 'Details'], rows.map((e) => [e.t, e.by, e.a, e.id, e.desc, e.project, e.n]))}>Export audit log</button>
      </div>
      <div className="note"><b>Read-only event log.</b> Every addition, change, custody action and stock movement is retained. Entries cannot be edited or deleted here.</div>
      <div className="card">
        <div className="row"><input className="s" placeholder="Search item ID, actor or event" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="f2">{dd('Event type', ev, setEv, u((e) => e.a))}{dd('Project', p, setP, u((e) => e.project))}{dd('Record category', c, setC, ['Asset', 'License', 'Spare'])}</div>
      </div>
      <div className="g2">
        <div className="card">
          <h2>Activity log</h2><small>{rows.length} events</small>
          <div className="sc"><table>
            <thead><tr><th>Timestamp / actor</th><th>Event / record</th><th>Change summary</th></tr></thead>
            <tbody>
              {rows.slice(0, 100).map((e, j) => (
                <tr key={j} className={cur && keyOf(e) === keyOf(cur) ? 'sel' : ''} onClick={() => setSel(keyOf(e))}>
                  <td><b>{e.t}</b><small>{e.by}</small></td><td>{e.a}<br /><small>{e.id}</small></td><td>{e.n}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={3}>No events match.</td></tr>}
            </tbody>
          </table></div>
          {rows.length > 100 && <small>Showing the latest 100 of {rows.length}. Narrow the filters or export to see all.</small>}
        </div>
        {cur && (
          <div className="card" style={{ position: 'sticky', top: 16 }}>
            <h2>Event details</h2><small>{cur.a} · {cur.id}</small>
            <div className="kv" style={{ gridTemplateColumns: '1fr' }}>
              <div><span>Event</span>{cur.a}</div><div><span>Actor</span>{cur.by || '—'}</div><div><span>Timestamp</span>{cur.t}</div>
              <div><span>Record</span>{cur.id} · {cur.desc}</div><div><span>Category</span>{cur.c || '—'}</div><div><span>Project</span>{cur.project || '—'}</div>
              <div><span>Details</span>{cur.n || '—'}</div>
            </div>
            {isItem(cur.id) && <div className="acts"><Link className="btn" to={`/inventory/${cur.id}`}>Open record</Link></div>}
          </div>
        )}
      </div>
    </>
  )
}
