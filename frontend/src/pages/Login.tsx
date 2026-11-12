import { useState, type FormEvent } from 'react'
import { useAuth } from '../api/auth'

export default function Login() {
  const { login } = useAuth()
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try { await login(u, p) } catch (x) { setErr(x instanceof Error ? x.message : 'Could not sign in.'); setP('') } finally { setBusy(false) }
  }
  return (
    <div className="auth">
      <form className="card authcard" onSubmit={submit}>
        <div className="logo">Trackline</div>
        <p className="mu">Sign in to continue</p>
        <label>Username</label>
        <input autoFocus autoComplete="username" maxLength={50} value={u} onChange={(e) => setU(e.target.value)} />
        <br /><br />
        <label>Password</label>
        <input type="password" autoComplete="current-password" maxLength={128} value={p} onChange={(e) => setP(e.target.value)} />
        <div className="er">{err}</div>
        <button className="btn p" style={{ width: '100%' }} disabled={busy || !u || !p}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p><small>Accounts are created by an administrator.</small></p>
      </form>
    </div>
  )
}
