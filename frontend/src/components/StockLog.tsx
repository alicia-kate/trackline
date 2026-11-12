import { useEffect, useState } from 'react'
import { api, errorText } from '../api/client'
import type { Item, StockMove } from '../types'

// The stock in / stock out log of one spare. It reloads whenever the balance changes.
export default function StockLog({ item, bare }: { item: Item; bare?: boolean }) {
  const [rows, setRows] = useState<StockMove[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let on = true
    setErr('')
    api<StockMove[]>(`/items/${item.id}/movements`)
      .then((r) => on && setRows(r))
      .catch((e) => { if (on) { setRows([]); setErr(errorText(e)) } })
    return () => { on = false }
  }, [item.id, item.qty])
  const body = (
    <>
      {err && <div className="er" role="alert">{err}</div>}
      {rows === null && <p className="mu">Loading…</p>}
      {rows && (
        <div className="sc"><table>
          <thead><tr><th>Date</th><th>Movement</th><th>Qty</th><th>Balance</th><th>Reason</th><th>Issued to</th><th>By</th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td>{m.at}</td>
                <td><span className={'bd ' + (m.dir === 'in' ? 'gr' : 'am')}>{m.dir === 'in' ? 'Stock in' : 'Stock out'}</span></td>
                <td>{m.dir === 'in' ? '+' : '−'}{m.qty}</td><td>{m.balance}</td>
                <td>{m.why || '—'}{m.note && <small>{m.note}</small>}</td><td>{m.to || '—'}</td><td>{m.by}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7}>No stock movements recorded yet.</td></tr>}
          </tbody>
        </table></div>
      )}
    </>
  )
  return bare ? body : <div className="card"><h2>Stock movements</h2><small>Every stock in and stock out, with the balance after each.</small>{body}</div>
}
