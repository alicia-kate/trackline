import { useState, type FormEvent } from 'react'
import { useAuth } from '../api/auth'

export default function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { changePassword, logout } = useAuth()
  const [cur, setCur] = useState('')
  const [nw, setNw] = useState('')
  const [again, setAgain] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setOk(false)
    if (nw !== again) return setErr('The new passwords do not match.')
    try { await changePassword(cur, nw); setCur(''); setNw(''); setAgain(''); setOk(true) } catch (x) { setErr(x instanceof Error ? x.message : 'Could not change the password.') }
  }
  const form = (
    <form className="card authcard" onSubmit={submit} style={forced ? undefined : { margin: 0 }}>
      <h2>{forced ? 'Set a new password' : 'Change password'}</h2>
      {forced && <p className="mu">Your password was set by an administrator. Choose your own to continue.</p>}
      <br />
      <label>Current password</label>
      <input type="password" autoComplete="current-password" maxLength={128} value={cur} onChange={(e) => setCur(e.target.value)} /><br /><br />
      <label>New password</label>
      <input type="password" autoComplete="new-password" maxLength={128} value={nw} onChange={(e) => setNw(e.target.value)} />
      <small>At least 10 characters. Must not contain your username.</small><br /><br />
      <label>Repeat new password</label>
      <input type="password" autoComplete="new-password" maxLength={128} value={again} onChange={(e) => setAgain(e.target.value)} />
      <div className="er">{err}</div>
      {ok && <div className="note">Password changed. Your other sessions were signed out.</div>}
      <div className="acts">
        <button className="btn p" disabled={!cur || !nw || !again}>Change password</button>
        {forced && <button type="button" className="btn" onClick={() => logout()}>Sign out</button>}
      </div>
    </form>
  )
  return forced ? <div className="auth">{form}</div> : <><div className="hd"><div><h1>Account</h1><p className="mu">Change your own password.</p></div></div>{form}</>
}
