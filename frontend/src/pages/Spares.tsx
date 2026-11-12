import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { useItems } from '../api/items'
import { useAuth } from '../api/auth'
import { canWrite } from '../lib/permissions'
import { Kpi } from '../components/Badges'
import ActionDialog from '../components/ActionDialog'
import StockLog from '../components/StockLog'
import type { ActionKey, Item } from '../types'

export default function Spares({ embedded = false }: { embedded?: boolean }) {
  const S = useItems().filter((i) => i.c === 'Spare' && i.active)
  const w = canWrite(useAuth().user)
  const [sel, setSel] = useState<{ i: Item; a: ActionKey } | null>(null), [open, setOpen] = useState<string | null>(null)
  return (
    <>
      {!embedded && <div className="hd"><div><h1>Spares &amp; stock</h1><p className="mu">Control stock balances, movements and reorder thresholds.</p></div>{w && <Link className="btn p" to="/inventory/new" state={{ c: 'Spare' }}>+ Add spare</Link>}</div>}
      <div className="g4">
        <Kpi t="Tracked SKUs" b={S.length} s={`Across ${new Set(S.map((i) => i.loc)).size} storage locations`} />
        <Kpi t="Units on hand" b={S.reduce((a, i) => a + i.qty, 0)} s="Current available stock" />
        <Kpi t="Below threshold" b={S.filter((i) => i.qty < i.min).length} s="Reorder recommended" />
      </div>
      <div className="card"><h2>Stock balances</h2>
        <div className="sc"><table>
          <thead><tr><th>Spare / SKU</th><th>Store</th><th>On hand</th><th>Min.</th><th>Stock health</th><th></th></tr></thead>
          <tbody>
            {S.map((i) => (
              <Fragment key={i.id}>
              <tr>
                <td><b><Link to={`/inventory/${i.id}`} style={{ textDecoration: 'underline' }}>{i.desc}</Link></b><small>{i.id}</small></td>
                <td>{i.loc}</td><td>{i.qty}</td><td>{i.min}</td>
                <td>{i.qty < i.min ? <span className="bd am">Low stock</span> : <span className="bd gr">Available</span>}</td>
                <td>
                  {w && <><button className="btn" onClick={() => setSel({ i, a: 'in' })}>Stock in</button> <button className="btn" onClick={() => setSel({ i, a: 'out' })}>Stock out</button> </>}
                  <button className="btn" onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? 'Hide log' : 'Log'}</button>
                </td>
              </tr>
              {open === i.id && <tr><td colSpan={6}><StockLog item={i} bare /></td></tr>}
              </Fragment>
            ))}
            {!S.length && <tr><td colSpan={6}>No spares yet.</td></tr>}
          </tbody>
        </table></div>
      </div>
      {sel && <ActionDialog item={sel.i} action={sel.a} onClose={() => setSel(null)} />}
    </>
  )
}
