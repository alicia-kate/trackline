import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useItems } from '../api/items'
import { loadAll } from '../api/stores'
import { useMasters } from '../api/masters'
import { useAuth } from '../api/auth'
import { useRequests } from '../api/requests'
import { canApprove, isAdmin, isOic, ROLE_LABEL } from '../lib/permissions'
import { getAlerts } from '../lib/rules'
import type { Item } from '../types'

const list = (id: string, keys: (keyof Item)[], items: Item[], extra: string[] = []) => (
  <datalist id={id}>
    {[...new Set([...extra, ...keys.flatMap((k) => items.map((i) => String(i[k] ?? '')))].filter(Boolean))].sort().map((x) => <option key={x} value={x} />)}
  </datalist>
)

export default function Layout() {
  const items = useItems(), m = useMasters(), { user, logout, refresh } = useAuth()
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const load = () => { refresh().catch(() => undefined); return loadAll() }
  const reload = () => load().then(() => setState('ready')).catch(() => setState((s) => (s === 'ready' ? s : 'error')))
  useEffect(() => {
    reload()
    // Other people may have changed things: refresh when this tab is opened again.
    const f = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [])
  const admin = isAdmin(user)
  const oic = isOic(user), approver = canApprove(user)
  const pending = useRequests().filter((r) => r.status === 'pending' && r.by !== user?.username).length // waiting for someone else's decision
  const n = getAlerts(items).length
  const act = (k: 'projects' | 'vendors' | 'locations' | 'departments') => (oic && k === 'projects' ? user?.projects ?? [] : m[k].filter((x) => x.active).map((x) => x.name))
  const link = (to: string, t: string, badge?: number) => (
    <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'on' : '')}>
      {t}{badge != null && <span className="bd am">{badge}</span>}
    </NavLink>
  )
  return (
    <div className="app">
      <aside>
        <div className="logo">Trackline</div>
        <div className="ws">MSI Global</div>
        <nav>
          {link('/', 'Overview')}
          {link('/inventory', 'Inventory')}
          {link('/projects', 'Projects')}
          {link('/vendors', 'Vendors')}
          {link('/alerts', 'Alerts', n)}
          {!oic && <>{link('/reports', 'Reports')}{link('/audit', 'Audit trail')}</>}
          {(approver || oic) && link('/approvals', oic ? 'My requests' : 'Approvals', approver ? pending : undefined)}
          {approver && <><div className="nh">Administration</div>{link('/master-data', 'Master data')}{link('/users', admin ? 'Users & access' : 'Project access')}</>}
        </nav>
        <div className="me">
          <b>{user?.full_name || user?.username}</b>{user && ROLE_LABEL[user.role]}
          <br /><NavLink to="/account" style={{ textDecoration: 'underline' }}>Change password</NavLink>
          {' · '}<a style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => logout()}>Sign out</a>
        </div>
      </aside>
      <main>
        {state === 'loading' && <p className="mu">Loading…</p>}
        {state === 'error' && <div className="card"><p>Could not load the data from the server.</p><button className="btn p" onClick={() => { setState('loading'); reload() }}>Try again</button></div>}
        {state === 'ready' && <Outlet />}
        {list('pj', ['project'], items, act('projects'))}{list('vv', ['vendor'], items, act('vendors'))}{list('ll', ['loc'], items, act('locations'))}
        {list('pp', ['oic', 'user'], items)}{list('dd', ['dept'], items, act('departments'))}
      </main>
    </div>
  )
}
