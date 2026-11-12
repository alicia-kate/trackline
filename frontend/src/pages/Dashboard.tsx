import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useItems } from '../api/items'
import { getAlerts, STATUSES } from '../lib/rules'
import { StatusBadge } from '../components/Badges'
import type { Category } from '../types'

type Pill = { n: number; l: string; f: string; c: 'am' | 'rd' }
const CAT = { Asset: 'ca', License: 'cl', Spare: 'cs' } as const
const Tri = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 1 21h22L12 2Zm1 15h-2v-2h2v2Zm0-4h-2V9h2v4Z" /></svg>
)
const FlowCard = ({ t, d, n, cat, qs, pills }: { t: string; d: string; n: number; cat: Category; qs: string; pills: Pill[] }) => {
  const nav = useNavigate(), on = pills.filter((p) => p.n > 0), go = () => nav('/inventory?c=' + cat + qs)
  return (
    <div className="fw"><div className={'fc ' + CAT[cat]} role="link" tabIndex={0} onClick={go} onKeyDown={(e) => e.key === 'Enter' && go()}>
      <b className="fn">{n}</b>
      <div><div className="fct">{t}</div><small>{d}</small></div>
      <div className="fp">
        {on.length ? on.map((p) => <Link key={p.l} to={'/alerts?f=' + p.f} onClick={(e) => e.stopPropagation()} className={'bd ' + p.c}><Tri /> {p.n} {p.l}</Link>) : <span className="bd gr">All clear</span>}
      </div>
    </div></div>
  )
}

export default function Dashboard() {
  const all = useItems(), nav = useNavigate(), [p0, setP0] = useState(''), [l0, setL0] = useState('')
  const A = all.filter((i) => i.active && (!p0 || i.project === p0) && (!l0 || i.loc === l0)), a = getAlerts(A)
  const u = (k: 'project' | 'loc') => [...new Set(all.map((i) => i[k]).filter(Boolean))].sort()
  const k = (t: string) => a.filter((x) => x.k === t).length
  const n = (c: string) => A.filter((i) => i.c === c).length
  const pj = [...new Set(A.map((i) => i.project).filter(Boolean))].sort()
  const cnt = (p: string, c?: string) => A.filter((i) => i.project === p && (!c || i.c === c)).length
  const top = [...pj].sort((a, b) => cnt(b) - cnt(a) || a.localeCompare(b)).slice(0, 5)
  const mx = Math.max(1, ...top.map((p) => cnt(p)))
  const qs = (p0 ? '&p=' + encodeURIComponent(p0) : '') + (l0 ? '&l=' + encodeURIComponent(l0) : '')
  return (
    <>
      <div className="hd"><div><h1>Overview</h1><p className="mu">A clear view of every asset, license and spare across your organisation.</p></div>
        <div className="row" style={{ margin: 0 }}>
          <select value={p0} onChange={(e) => setP0(e.target.value)}><option value="">All projects</option>{u('project').map((x) => <option key={x}>{x}</option>)}</select>
          <select value={l0} onChange={(e) => setL0(e.target.value)}><option value="">All locations</option>{u('loc').map((x) => <option key={x}>{x}</option>)}</select>
        </div>
      </div>
      <div className="flow">
        <div className="froot">
          <small>Total inventory</small>
          <b>{A.length}</b>
          <small>Across {pj.length} project{pj.length === 1 ? '' : 's'}</small>
        </div>
        <div className="fcards">
          <FlowCard t="Assets" d="Hardware & equipment" n={n('Asset')} cat="Asset" qs={qs} pills={[{ n: k('Warranty'), l: 'warranty ending', f: 'warranty', c: 'am' }]} />
          <FlowCard t="Software licenses" d="Software & subscriptions" n={n('License')} cat="License" qs={qs} pills={[{ n: k('Expired'), l: 'expired', f: 'expired', c: 'rd' }, { n: k('Renewal'), l: 'renewing soon', f: 'renewal', c: 'am' }]} />
          <FlowCard t="Spares / consumables" d="Spare parts & consumables" n={n('Spare')} cat="Spare" qs={qs} pills={[{ n: k('Low stock'), l: 'low-stock', f: 'low', c: 'am' }]} />
        </div>
      </div>
      <div className="g2">
        <div className="card">
          <div className="hd" style={{ margin: '0 0 4px' }}>
            <div><h2>Inventory by project</h2><small>Top {top.length} of {pj.length} · {A.length} records</small></div>
            <Link className="btn" to="/projects">View all projects</Link>
          </div>
          <div className="lg"><span><i className="ca" />Assets</span><span><i className="cl" />Licenses</span><span><i className="cs" />Spares</span></div>
          {top.map((p) => (
            <div key={p} className="li v lk" role="link" tabIndex={0} onClick={() => nav('/projects/' + encodeURIComponent(p))} onKeyDown={(e) => e.key === 'Enter' && nav('/projects/' + encodeURIComponent(p))}>
              <b style={{ display: 'inline' }}>{p}</b><span style={{ float: 'right' }}>{cnt(p)}</span>
              <div className="bar">{(['Asset', 'License', 'Spare'] as const).map((c) => <i key={c} className={CAT[c]} title={`${c}: ${cnt(p, c)}`} style={{ width: `${(cnt(p, c) / mx) * 100}%` }} />)}</div>
            </div>
          ))}
          {!top.length && <p className="mu">No projects yet.</p>}
        </div>
        <div className="card">
          <h2>Inventory by status</h2><small>Active records</small>
          {STATUSES.map((s) => {
            const x = A.filter((i) => i.status === s).length
            return <div key={s} className="li"><StatusBadge s={s} /><span>{x} · {A.length ? Math.round((x / A.length) * 100) : 0}%</span></div>
          })}
        </div>
      </div>
      <div className="card">
        <div className="hd" style={{ margin: '0 0 8px' }}>
          <div><h2>Coming up next</h2><small>Renewals, warranties and stock needing action</small></div>
          <Link className="btn" to="/alerts">All alerts</Link>
        </div>
        {a.length ? (
          <div className="sc"><table>
            <thead><tr><th>Item</th><th>Project / OIC</th><th>Detail</th><th>Type</th></tr></thead>
            <tbody>{a.slice(0, 5).map((x, j) => (
              <tr key={j} onClick={() => nav(`/inventory/${x.i.id}`)}>
                <td><b>{x.i.desc}</b><small>{x.i.id}</small></td><td>{x.i.project}<br /><small>{x.i.oic}</small></td><td>{x.s}</td>
                <td><span className={'bd ' + (x.k === 'Expired' ? 'rd' : 'am')}>{x.k}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="mu">Nothing needs attention.</p>}
      </div>
    </>
  )
}