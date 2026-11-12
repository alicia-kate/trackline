import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useItems } from '../api/items'
import { useRequests } from '../api/requests'
import { useAuth } from '../api/auth'
import { canWrite } from '../lib/permissions'
import { useMasters } from '../api/masters'
import { ACTIONS, canDo, daysLeft, money } from '../lib/rules'
import { StatusBadge } from '../components/Badges'
import type { ActionKey } from '../types'
import ActionDialog from '../components/ActionDialog'
import Documents from '../components/Documents'
import StockLog from '../components/StockLog'

const KV = ({ l, v }: { l: string; v: string | number | null | undefined }) => <div><span>{l}</span>{v === '' || v == null ? '—' : v}</div>

export default function ItemDetail() {
  const { id } = useParams(), items = useItems(), i = items.find((x) => x.id === id)
  const [act, setAct] = useState<ActionKey | null>(null), [show, setShow] = useState(false)
  const { user } = useAuth(), w = canWrite(user), vendors = useMasters().vendors
  const pend = useRequests().filter((r) => r.status === 'pending' && r.itemId === id).length
  if (!i) return <div className="card">Item not found. <Link to="/inventory" style={{ textDecoration: 'underline' }}>Back to inventory</Link></div>
  const lic = i.c === 'License', l = daysLeft(lic ? i.due : i.wdue)
  const vd = i.vendor ? vendors.find((x) => x.name === i.vendor) : undefined
  return (
    <>
      <div className="hd"><div><h1>{i.desc}</h1><p className="mu">Inventory / {i.c} / {i.id}</p>{i.use && <p>{i.use}</p>}</div>{w && <Link className="btn" to={`/inventory/${i.id}/edit`}>Edit item</Link>}</div>
      {pend > 0 && <div className="note">{pend} change{pend > 1 ? 's' : ''} on this item {pend > 1 ? 'are' : 'is'} waiting for approval.</div>}
      <div className="card">
        <b style={{ display: 'inline' }}>{i.id}</b> <StatusBadge s={i.status} />{!i.active && <> <span className="bd">Inactive</span></>}
        <br /><small>{[i.make, i.model].filter(Boolean).join(' · ')}</small>
      </div>
      <div className="acts">
        {(Object.keys(ACTIONS) as ActionKey[]).filter((a) => canDo(i, a) && w).map((a) => <button key={a} className={'btn' + (ACTIONS[a].d ? ' d' : '')} onClick={() => setAct(a)}>{ACTIONS[a].t}</button>)}
      </div>
      <div className="g2">
        <div>
          <div className="card"><h2>Item information</h2>
            <div className="kv">
              <KV l="Category" v={i.c} /><KV l={i.c === 'Spare' ? 'On hand' : lic ? 'Seats' : 'Quantity'} v={i.qty} />
              {i.c === 'Spare' && <KV l="Reorder level" v={i.min} />}
              <KV l="Make / publisher" v={i.make} />{!lic && <KV l="Model" v={i.model} />}
              {lic && i.sn
                ? <div><span>License key</span>{show ? i.sn : '•••••' + i.sn.slice(-4)} <button className="btn" style={{ padding: '2px 8px' }} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Reveal'}</button></div>
                : <KV l={i.c === 'Spare' ? 'Part number' : 'Serial number'} v={i.sn} />}
              {i.c === 'Asset' && <KV l="MG No" v={i.mg} />}<KV l="Purchase date" v={i.date} /><KV l="Purchase cost" v={money(i.cost)} /><div><span>Purchase project</span>{i.project ? <Link to={`/projects/${encodeURIComponent(i.project)}`} style={{ textDecoration: 'underline' }}>{i.project}</Link> : '—'}</div><div><span>Vendor / supplier</span>{i.vendor ? <Link to={`/vendors/${encodeURIComponent(i.vendor)}`} style={{ textDecoration: 'underline' }}>{i.vendor}</Link> : '—'}</div>
            </div>
          </div>
          <div className="card"><h2>Custody &amp; location</h2>
            <div className="kv"><KV l="OIC responsible person" v={i.oic} /><KV l="Current user" v={i.user || 'Unassigned'} /><KV l="Department" v={i.dept} /><KV l="Storage location / site" v={i.loc} /></div>
            <p><span className="mu">Remarks</span><br />{i.remarks || '—'}</p>
          </div>
          <Documents itemId={i.id} />
          {i.c === 'Spare' && <StockLog item={i} />}
          <div className="card"><h2>History</h2><small>Every custody and lifecycle event is retained.</small>
            {i.hist.map((h, n) => <div key={n} className="li v"><b style={{ display: 'inline' }}>{h.a}</b> <small>{h.t} · {h.by}</small><br /><small>{h.n}</small></div>)}
          </div>
        </div>
        <div>
          {i.c !== 'Spare' && (
            <div className="card"><h2>{lic ? 'Renewal & support' : 'Warranty & support'}</h2>
              <div className="kv" style={{ gridTemplateColumns: '1fr' }}>
                <KV l={lic ? 'Next renewal / expiry' : 'Warranty / support end date'} v={lic ? i.due : i.wdue} />
                {l != null && <KV l="Time remaining" v={l < 0 ? `${-l} days overdue` : `${l} days`} />}
                <KV l="Warranty / support terms" v={i.winfo} />
              </div>
            </div>
          )}
          {i.vendor && (
            <div className="card"><h2>Vendor / supplier</h2>
              <div className="kv" style={{ gridTemplateColumns: '1fr' }}>
                <KV l="Name" v={i.vendor} />
                <KV l="Contact person" v={vd?.contact as string} /><KV l="Phone" v={vd?.phone as string} /><KV l="Email" v={vd?.email as string} />
              </div>
              {!vd && <small>No contact details on file. An admin can add them under Master data.</small>}
            </div>
          )}
          <div className="card"><h2>Record controls</h2><small>Deactivation hides this item from active registers. Disposal keeps the full history and financial record.</small></div>
        </div>
      </div>
      {act && <ActionDialog item={i} action={act} onClose={() => setAct(null)} />}
    </>
  )
}
