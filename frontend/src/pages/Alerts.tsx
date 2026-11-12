import { Link, useSearchParams } from 'react-router-dom'
import { useItems } from '../api/items'
import { getAlerts } from '../lib/rules'
import { Kpi } from '../components/Badges'
import type { Alert } from '../types'

const FILTERS: Record<string, { t: string; keep: (x: Alert) => boolean }> = {
  '': { t: 'Needs attention', keep: () => true },
  expired: { t: 'Expired licenses', keep: (x) => x.k === 'Expired' },
  due: { t: 'Due in 30 days', keep: (x) => x.k === 'Renewal' || x.k === 'Warranty' },
  renewal: { t: 'Licenses renewing soon', keep: (x) => x.k === 'Renewal' },
  warranty: { t: 'Warranties ending soon', keep: (x) => x.k === 'Warranty' },
  low: { t: 'Low-stock SKUs', keep: (x) => x.k === 'Low stock' },
}

export default function Alerts() {
  const a = getAlerts(useItems()), [sp, setSp] = useSearchParams()
  const k = (t: string) => a.filter((x) => x.k === t).length
  const key = FILTERS[sp.get('f') ?? ''] ? sp.get('f') ?? '' : ''
  const shown = a.filter(FILTERS[key].keep)
  const pick = (f: string) => setSp(f ? { f } : {})
  return (
    <>
      <div className="hd"><div><h1>Alerts</h1><p className="mu">Stay ahead of renewals, warranty expiries and stock shortages. Alerts are worked out from your records.</p></div></div>
      <div className="g4">
        <Kpi t="Open alerts" b={a.length} s={`${k('Renewal')} renewals · ${k('Warranty')} warranty · ${k('Low stock')} stock`} on={() => pick('')} active={key === ''} />
        <Kpi t="Expired licenses" b={k('Expired')} s="Review renewal status" on={() => pick('expired')} active={key === 'expired'} />
        <Kpi t="Due in 30 days" b={k('Renewal') + k('Warranty')} s="Licenses and warranties" on={() => pick('due')} active={key === 'due'} />
        <Kpi t="Low-stock SKUs" b={k('Low stock')} s="Below configured minimums" on={() => pick('low')} active={key === 'low'} />
      </div>
      <div className="card">
        <div className="hd" style={{ margin: '0 0 6px' }}>
          <div><h2>{FILTERS[key].t}</h2><small>{key ? `${shown.length} of ${a.length} alerts` : 'Expired first, then by due date'}</small></div>
          {key && <button className="btn" onClick={() => pick('')}>Show all alerts</button>}
        </div>
        {shown.map((x, j) => (
          <div key={j} className="li">
            <span>
              <b style={{ display: 'inline' }}>{x.t}</b> <span className={'bd ' + (x.k === 'Expired' ? 'rd' : 'am')}>{x.k}</span><br />
              <small>{x.i.id} · {x.i.project} · {x.i.loc} · OIC {x.i.oic}<br />{x.s}</small>
            </span>
            <Link className="btn" to={`/inventory/${x.i.id}`}>View</Link>
          </div>
        ))}
        {!shown.length && <p className="mu">{key ? 'Nothing in this list.' : 'No open alerts.'}</p>}
      </div>
    </>
  )
}
