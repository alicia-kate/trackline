import { useState, type FormEvent } from 'react'
import { ACTIONS } from '../lib/rules'
import { submitAction } from '../api/requests'
import { useAuth } from '../api/auth'
import type { ActionKey, FieldKey, Item } from '../types'

const F: Record<FieldKey, [string, string, number, string?]> = {
  who: ['Person', 'text', 1, 'pp'], user: ['Issued to (optional)', 'text', 0, 'pp'], dept: ['Department', 'text', 0, 'dd'],
  loc: ['Location / site', 'text', 0, 'll'], due: ['New expiry date', 'date', 1], cost: ['Renewal cost', 'number', 0],
  q: ['Quantity', 'number', 1], why: ['Reason', 'text', 1], rem: ['Remarks', 'textarea', 0], remr: ['Remarks', 'textarea', 1],
}

export default function ActionDialog({ item, action, onClose }: { item: Item; action: ActionKey; onClose: () => void }) {
  const c = ACTIONS[action]
  const { user } = useAuth()
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    setBusy(true)
    const r = await submitAction(item.id, action, Object.fromEntries(new FormData(form)) as Record<string, string>)
    setBusy(false)
    if (r.error) return setErr(r.error)
    r.queued ? setSent(true) : onClose()
  }
  if (sent) return (
    <div className="modal" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h2>Sent for approval</h2>
        <p className="mu">An admin or inventory manager must approve this before the record changes. You can follow it under Approvals.</p>
        <div className="acts"><button className="btn p" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
  return (
    <div className="modal" onClick={onClose}>
      <form className="dlg" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{c.t}</h2>
        <small>{item.id} · {item.desc}</small>
        <br /><br />
        {c.fl.map((k) => {
          const [l, t, r, ls] = F[k]
          const name = k === 'remr' ? 'rem' : k
          return (
            <div key={k}>
              <label>{l}{r ? ' *' : ''}</label>
              {t === 'textarea'
                ? <textarea name={name} rows={2} required={!!r} />
                : <input name={name} type={t} required={!!r} list={ls} min={t === 'number' ? 0 : undefined} step={t === 'number' ? 'any' : undefined}
                    defaultValue={k === 'dept' ? item.dept : k === 'loc' ? item.loc : ''} />}
              <br /><br />
            </div>
          )
        })}
        <div className="er">{err}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn p" disabled={busy}>{user?.needs_approval ? 'Submit for approval' : c.t}</button>
        </div>
      </form>
    </div>
  )
}
