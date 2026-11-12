import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useItems } from '../api/items'
import { useRequests } from '../api/requests'
import { useAuth } from '../api/auth'
import { ACTIONS, canDo } from '../lib/rules'
import { canRun, mineRole } from '../lib/permissions'
import { StatusBadge, DueCell } from '../components/Badges'
import ActionDialog from '../components/ActionDialog'
import type { ActionKey, Item } from '../types'

// The OIC/User's home: only the items they are responsible for or currently use.
export default function MyItems() {
  const { user } = useAuth(), nav = useNavigate()
  const items = useItems().filter((i) => i.active)
  const waiting = useRequests().filter((r) => r.status === 'pending').length
  const [sel, setSel] = useState<{ i: Item; a: ActionKey } | null>(null)
  return (
    <>
      <div className="hd"><div><h1>My items</h1><p className="mu">Items you are responsible for or currently use. Update their status or hand them over here.</p></div></div>
      {waiting > 0 && <div className="note">{waiting} update{waiting > 1 ? 's are' : ' is'} waiting for approval. <Link to="/approvals" style={{ textDecoration: 'underline' }}>See my requests</Link></div>}
      <div className="card">
        <h2>Assigned to me</h2><small>{items.length} item{items.length === 1 ? '' : 's'}</small>
        <div className="sc"><table>
          <thead><tr><th>Item</th><th>My role</th><th>Status</th><th>Location</th><th>Renewal / warranty</th><th></th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} onClick={() => nav(`/inventory/${i.id}`)}>
                <td><b>{i.desc}</b><small>{i.id} · {i.c}</small></td>
                <td>{mineRole(user, i.oic, i.user) || '—'}</td>
                <td><StatusBadge s={i.status} /></td>
                <td>{i.loc}</td>
                <td><DueCell i={i} /></td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="row" style={{ margin: 0 }}>
                    {(Object.keys(ACTIONS) as ActionKey[]).filter((a) => canDo(i, a) && canRun(user, a)).map((a) => (
                      <button key={a} className="btn" onClick={() => setSel({ i, a })}>{ACTIONS[a].t}</button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={6}>Nothing is assigned to you yet. Ask an inventory manager to put your name as the OIC or current user of an item.</td></tr>}
          </tbody>
        </table></div>
      </div>
      {sel && <ActionDialog item={sel.i} action={sel.a} onClose={() => setSel(null)} />}
    </>
  )
}
