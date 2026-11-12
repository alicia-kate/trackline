import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../api/auth'
import { useRequests, decide } from '../api/requests'
import { canApprove } from '../lib/permissions'

const LABEL: Record<string, string> = {
  desc: 'Item name', use: 'Description', winfo: 'Warranty / support terms', wdue: 'Warranty / support end date', make: 'Make', model: 'Model', sn: 'Serial / key', mg: 'MG No', qty: 'Quantity', min: 'Reorder level', date: 'Purchase date', cost: 'Cost (SGD)',
  project: 'Project', vendor: 'Vendor', due: 'Expiry / renewal', loc: 'Location', oic: 'OIC', user: 'User', dept: 'Department', remarks: 'Remarks', status: 'Status',
  who: 'Person', q: 'Quantity', why: 'Reason', rem: 'Remarks', note: 'Reason given', file: 'File', type: 'Document type', size: 'Size',
}

export default function Approvals() {
  const { user } = useAuth()
  const all = useRequests()
  const approver = canApprove(user)
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [err, setErr] = useState('')
  const mine = approver ? all : all.filter((r) => r.by === user?.username)
  const pending = mine.filter((r) => r.status === 'pending')
  const done = mine.filter((r) => r.status !== 'pending')
  const act = async (id: number, ok: boolean) => {
    const r = await decide(id, ok, notes[id] ?? '')
    setErr(r.error ?? '')
  }
  return (
    <>
      <div className="hd"><div><h1>{approver ? 'Approvals' : 'My requests'}</h1><p className="mu">{approver ? 'Changes submitted by other people wait here until an admin or inventory manager approves or rejects them. You cannot decide your own requests.' : 'Your changes wait here until an admin or inventory manager approves them.'}</p></div></div>
      {err && <div className="er">{err}</div>}
      <div className="card">
        <h2>Waiting for approval</h2><small>{pending.length} pending</small>
        {pending.map((r) => (
          <div key={r.id} className="li v">
            <b style={{ display: 'inline' }}>{r.summary}</b> <small>by {r.by} · {r.at}{r.itemId && <> · <Link to={`/inventory/${r.itemId}`} style={{ textDecoration: 'underline' }}>{r.itemId}</Link></>}</small>
            <div className="kv">
              {Object.entries(r.payload).filter(([, v]) => v !== '').map(([k, v]) => <div key={k}><span>{LABEL[k] ?? k}</span>{String(v)}</div>)}
            </div>
            {!!r.docs?.length && <div className="kv"><div><span>Documents</span>{r.docs.map((d) => <div key={d.id}><a href={`/api/attachments/${d.id}/file`} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>{d.name}</a> <small>{d.type}</small></div>)}</div></div>}
            {r.attachmentId != null && <p><a className="btn" href={`/api/attachments/${r.attachmentId}/file`} target="_blank" rel="noreferrer">Open the file</a></p>}
            {approver && r.by !== user?.username
              ? (
                <div className="row" style={{ margin: '12px 0 0' }}>
                  <input className="s" placeholder="Reason (optional, shown if rejected)" value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                  <button className="btn p" onClick={() => act(r.id, true)}>Approve</button>
                  <button className="btn d" onClick={() => act(r.id, false)}>Reject</button>
                </div>
              )
              : <p><span className="bd am">{approver ? 'Waiting for an admin or another inventory manager' : 'Waiting for approval'}</span></p>}
          </div>
        ))}
        {!pending.length && <p className="mu">Nothing is waiting.</p>}
      </div>
      <div className="card">
        <h2>History</h2>
        <div className="sc"><table>
          <thead><tr><th>Request</th><th>Requested by</th><th>Decision</th><th>Decided by</th><th>Reason</th></tr></thead>
          <tbody>
            {done.map((r) => (
              <tr key={r.id}>
                <td><b>{r.summary}</b><small>{r.at}</small></td><td>{r.by}</td>
                <td><span className={'bd ' + (r.status === 'approved' ? 'gr' : 'rd')}>{r.status}</span></td>
                <td>{r.decidedBy}<br /><small>{r.decidedAt}</small></td><td>{r.note || '—'}</td>
              </tr>
            ))}
            {!done.length && <tr><td colSpan={5}>No decisions yet.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
