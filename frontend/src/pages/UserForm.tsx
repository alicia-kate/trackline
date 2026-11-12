import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, errorText } from '../api/client'
import { useAuth } from '../api/auth'
import { useMasters } from '../api/masters'
import { isAdmin, ROLE_HELP, ROLE_LABEL } from '../lib/permissions'
import type { Role, User } from '../types'

const ROLES = Object.keys(ROLE_HELP) as Role[]
const gen = () => {
  const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(crypto.getRandomValues(new Uint32Array(14)), (x) => c[x % c.length]).join('')
}

function ProjectPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const m = useMasters(), [q, setQ] = useState('')
  const all = m.projects.filter((p) => p.active)
  const hits = all.filter((p) => !value.includes(p.name) && (!q || (p.name + String(p.code ?? '') + String(p.description ?? '')).toLowerCase().includes(q.toLowerCase())))
  const add = (n: string) => onChange([...value, n])
  return (
    <>
      <label>Projects <small>({value.length} selected)</small></label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '4px 0 10px', minHeight: 28 }}>
        {value.map((n) => <span key={n} className="chip">{n}<button type="button" aria-label={`Remove ${n}`} onClick={() => onChange(value.filter((x) => x !== n))}>×</button></span>)}
        {!value.length && <small>No project chosen yet.</small>}
      </div>
      <input className="s" placeholder="Search projects to add" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="pick">
        {hits.slice(0, 50).map((p) => (
          <button type="button" key={p.name} className="pk" onClick={() => add(p.name)}>
            <span><b style={{ display: 'inline' }}>{p.name}</b>{p.code ? <small> · {String(p.code)}</small> : null}{p.description ? <><br /><small>{String(p.description).slice(0, 90)}</small></> : null}</span>
            <span className="bd bl">Add</span>
          </button>
        ))}
        {!hits.length && <small>{all.length ? 'No more projects match.' : 'There are no projects in Master data yet.'}</small>}
      </div>
      {hits.length > 0 && q && <div className="row" style={{ margin: '8px 0 0' }}><button type="button" className="btn" onClick={() => onChange([...value, ...hits.map((p) => p.name)])}>Add all {hits.length} matching</button></div>}
    </>
  )
}

// Create a user (admin) or open one: admin edits everything, an inventory manager only gives projects to OIC/Users.
export default function UserForm() {
  const { id } = useParams(), nav = useNavigate(), { user: me } = useAuth(), admin = isAdmin(me)
  const [target, setTarget] = useState<User | null>(null), [loaded, setLoaded] = useState(!id)
  const [f, setF] = useState<{ username: string; full_name: string; role: Role; password: string; projects: string[] }>({ username: '', full_name: '', role: 'oic', password: '', projects: [] })
  const [pw, setPw] = useState(''), [err, setErr] = useState(''), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false)

  const open = (t: User) => { setTarget(t); setF({ username: t.username, full_name: t.full_name ?? '', role: t.role, password: '', projects: t.projects }) }
  useEffect(() => {
    if (!id) return
    api<User[]>('/users').then((all) => { const t = all.find((x) => x.id === +id); if (t) open(t) }).catch((e) => setErr(errorText(e))).finally(() => setLoaded(true))
  }, [id])

  if (!loaded) return <p className="mu">Loading…</p>
  if (id && !target) return <div className="card"><p>User not found.</p><Link className="btn" to="/users">Back to users</Link></div>

  const oic = f.role === 'oic'
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(''); setMsg(''); setBusy(true)
    try { await fn(); setMsg(ok) } catch (e) { setErr(errorText(e)) }
    setBusy(false)
  }
  const create = (e: FormEvent) => {
    e.preventDefault()
    if (oic && !f.projects.length) return setErr('Choose at least one project for an OIC/User.')
    run(() => api<User>('/users', { method: 'POST', body: { ...f, projects: oic ? f.projects : [] } }).then(() => nav('/users')), 'User created.')
  }
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!target) return
    if (oic && !f.projects.length) return setErr('Choose at least one project for an OIC/User.')
    const call = admin
      ? api<User>(`/users/${target.id}`, { method: 'PATCH', body: { role: f.role, full_name: f.full_name, projects: oic ? f.projects : undefined } })
      : api<User>(`/users/${target.id}/projects`, { method: 'PUT', body: { projects: f.projects } })
    run(() => call.then(open), 'Saved.')
  }
  const toggleActive = () => target && run(() => api<User>(`/users/${target.id}`, { method: 'PATCH', body: { is_active: !target.is_active } }).then(open), target.is_active ? 'User deactivated and signed out.' : 'User reactivated.')
  const reset = () => target && run(() => api(`/users/${target.id}/reset-password`, { method: 'POST', body: { new_password: pw } }).then(() => setPw('')), 'Password reset. The user must change it at next sign-in.')

  const head = (
    <div className="hd">
      <div><h1>{target ? target.username : 'Add user'}</h1><p className="mu">Users &amp; access / {target ? (admin ? 'Edit user' : 'Project access') : 'New user'}</p></div>
      <Link className="btn" to="/users">Back to users</Link>
    </div>
  )
  const access = (
    <div className="card">
      <h2>Project access</h2>
      {oic ? <><small>An OIC/User only sees, adds and edits items in these projects. At least one is needed.</small><br /><br /><ProjectPicker value={f.projects} onChange={(projects) => setF({ ...f, projects })} /></>
        : <small>{ROLE_LABEL[f.role]}s see every project, so nothing needs to be chosen here.</small>}
    </div>
  )
  const roleSelect = (
    <div>
      <label>Role</label>
      <select value={f.role} disabled={!!target && target.id === me?.id} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{ROLES.map((k) => <option key={k} value={k}>{ROLE_LABEL[k]}</option>)}</select>
      <small>{ROLE_HELP[f.role]}</small>
    </div>
  )

  if (!target) {
    return (
      <>
        {head}
        {err && <div className="er">{err}</div>}
        <form className="ug" onSubmit={create}>
          <div className="card">
            <h2>Details</h2><br />
            <div className="f2">
              <div><label>Username</label><input autoComplete="off" maxLength={30} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /><small>3 to 30 characters: letters, numbers, dot, dash, underscore.</small></div>
              <div><label>Full name</label><input autoComplete="off" maxLength={100} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></div>
            </div><br />
            {roleSelect}<br />
            <label>Temporary password</label>
            <div className="row" style={{ margin: 0 }}>
              <input className="s" autoComplete="off" maxLength={128} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
              <button type="button" className="btn" onClick={() => setF({ ...f, password: gen() })}>Generate</button>
            </div>
            <small>At least 10 characters. Share it in person; it must be changed at first sign-in.</small>
          </div>
          {access}
          <div className="acts ugf"><Link className="btn" to="/users">Cancel</Link><button className="btn p" disabled={busy || !f.username || !f.password}>Create user</button></div>
        </form>
      </>
    )
  }

  const self = target.id === me?.id
  return (
    <>
      {head}
      {err && <div className="er">{err}</div>}
      {msg && <div className="note">{msg}</div>}
      <form className="ug" onSubmit={save}>
        <div className="card">
          <h2>Details</h2><br />
          <div className="f2">
            <div><label>Username</label><div>{target.username}</div></div>
            <div><label>Full name</label>{admin ? <input maxLength={100} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /> : <div>{target.full_name || '—'}</div>}</div>
          </div><br />
          {admin ? roleSelect : <div><label>Role</label><div>{ROLE_LABEL[target.role]}</div></div>}
        </div>
        {access}
        <div className="acts ugf"><button className="btn p" disabled={busy}>{admin ? 'Save changes' : 'Save projects'}</button></div>
      </form>
      {admin && (
        <div className="card">
          <h2>Account</h2><br />
          <div className="f2">
            <div>
              <label>Status</label>
              <div className="row" style={{ margin: 0 }}>
                {target.is_active ? <span className="bd gr">Active</span> : <span className="bd">Inactive</span>}
                {!self && <button className={'btn' + (target.is_active ? ' d' : '')} disabled={busy} onClick={toggleActive}>{target.is_active ? 'Deactivate' : 'Reactivate'}</button>}
              </div>
            </div>
            <div>
              <label>Reset password</label>
              <div className="row" style={{ margin: 0 }}>
                <input className="s" autoComplete="off" maxLength={128} value={pw} onChange={(e) => setPw(e.target.value)} />
                <button type="button" className="btn" onClick={() => setPw(gen())}>Generate</button>
                <button type="button" className="btn" disabled={!pw || busy} onClick={reset}>Reset</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
