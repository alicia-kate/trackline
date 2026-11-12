import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../api/auth'
import { isAdmin, ROLE_LABEL } from '../lib/permissions'
import type { User } from '../types'

export default function Users() {
  const { user: me } = useAuth(), nav = useNavigate(), admin = isAdmin(me)
  const [rows, setRows] = useState<User[]>([])
  const [err, setErr] = useState('')
  useEffect(() => { api<User[]>('/users').then(setRows).catch((e) => setErr(e.message)) }, [])
  return (
    <>
      <div className="hd">
        <div>
          <h1>{admin ? 'Users & access' : 'Project access'}</h1>
          <p className="mu">{admin ? 'Only admins can create accounts. Share the temporary password in person; it must be changed at first sign-in.' : 'Choose which projects each OIC/User can work in.'}</p>
        </div>
        {admin && <Link className="btn p" to="/users/new">+ Add user</Link>}
      </div>
      {err && <div className="er">{err}</div>}
      <div className="card">
        <h2>People</h2><small>{rows.length} account{rows.length === 1 ? '' : 's'}</small>
        <div className="sc"><table>
          <thead><tr><th>Username</th><th>Full name</th><th>Role</th><th>Projects</th><th>Status</th><th>Last sign-in</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => nav(`/users/${r.id}`)}>
                <td><b>{r.username}</b>{r.id === me?.id && <small>You</small>}</td><td>{r.full_name || '—'}</td><td>{ROLE_LABEL[r.role]}</td>
                <td>{r.role === 'oic' ? r.projects.join(', ') || '—' : 'All projects'}</td>
                <td>{r.is_active ? <span className="bd gr">Active</span> : <span className="bd">Inactive</span>}{r.must_change_password && <> <span className="bd am">Must change password</span></>}</td>
                <td>{r.last_login_at ? new Date(r.last_login_at).toLocaleString() : 'Never'}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6}>{admin ? 'No accounts yet.' : 'There are no OIC/User accounts yet. An admin creates them.'}</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
