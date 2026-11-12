import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useItems } from '../api/items'
import { useMasters, saveMaster, setMasterActive } from '../api/masters'
import type { Item, MasterKind, MasterRow } from '../types'

const CFG: Record<MasterKind, { label: string; one: string; key: keyof Item; cols: [string, string][]; fields: [string, string][] }> = {
  projects: { label: 'Projects', one: 'project', key: 'project', cols: [['Project lead', 'lead'], ['Primary site', 'site']],
    fields: [['name', 'Project name'], ['code', 'Project code'], ['lead', 'Project lead'], ['site', 'Primary site'], ['description', 'Description']] },
  vendors: { label: 'Vendors', one: 'vendor', key: 'vendor', cols: [['Contact', 'contact'], ['Email', 'email']],
    fields: [['name', 'Vendor name'], ['contact', 'Contact person'], ['email', 'Email'], ['phone', 'Phone']] },
  locations: { label: 'Locations', one: 'location', key: 'loc', cols: [['Code', 'code'], ['Site', 'site']],
    fields: [['name', 'Location name'], ['code', 'Code'], ['site', 'Site']] },
  departments: { label: 'Departments', one: 'department', key: 'dept', cols: [['Code', 'code'], ['Head', 'head']],
    fields: [['name', 'Department name'], ['code', 'Code'], ['head', 'Department head']] },
}
const KINDS = Object.keys(CFG) as MasterKind[]

export default function MasterData() {
  const items = useItems(), m = useMasters()
  const [kind, setKind] = useState<MasterKind>('projects')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const cfg = CFG[kind]
  const rows = m[kind].filter((r) => !q || Object.values(r).join(' ').toLowerCase().includes(q.toLowerCase()))
  const cur = sel ? m[kind].find((r) => r.name === sel) : undefined
  const count = (name: string) => items.filter((i) => i[cfg.key] === name).length
  const pick = (r: MasterRow | null) => {
    setSel(r ? r.name : null)
    setForm(r ? Object.fromEntries(cfg.fields.map(([k]) => [k, String(r[k] ?? '')])) : {})
    setErr('')
  }
  const tab = (k: MasterKind) => { setKind(k); setSel(null); setForm({}); setQ(''); setErr('') }
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.name?.trim()) return setErr(`${cfg.fields[0][1]} is required.`)
    const r = await saveMaster(kind, { ...form, name: form.name.trim() }, sel)
    r.error ? setErr(r.error) : pick(null)
  }
  return (
    <>
      <div className="hd">
        <div><h1>Master data</h1><p className="mu">Maintain the shared projects, vendors, locations and departments behind your register.</p></div>
        <button className="btn p" onClick={() => pick(null)}>+ Add {cfg.one}</button>
      </div>
      <div className="tabs">{KINDS.map((k) => <button key={k} className={k === kind ? 'on' : ''} onClick={() => tab(k)}>{CFG[k].label} {m[k].length}</button>)}</div>
      <div className="g2">
        <div>
          <div className="card">
            <h2>{cfg.label}</h2><small>Shared across all inventory categories</small>
            <div className="row" style={{ margin: '12px 0' }}><input className="s" placeholder={`Search ${cfg.label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="sc"><table>
              <thead><tr><th>{cfg.label.slice(0, -1)} / code</th>{cfg.cols.map(([l]) => <th key={l}>{l}</th>)}<th>Items</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} onClick={() => pick(r)}>
                    <td><b>{r.name}</b>{kind === 'projects' && <small>{String(r.code ?? '')}</small>}</td>
                    {cfg.cols.map(([l, k]) => <td key={l}>{String(r[k] ?? '') || '—'}</td>)}
                    <td>{count(r.name)}</td>
                    <td>{r.active ? <span className="bd gr">Active</span> : <span className="bd">Inactive</span>}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={cfg.cols.length + 3}>Nothing here yet.</td></tr>}
              </tbody>
            </table></div>
            <small>{m[kind].length} {cfg.label.toLowerCase()} · {items.length} linked inventory records</small>
          </div>
          <div className="note"><b>Safe deactivation.</b> Master records with linked inventory cannot be deleted. Deactivate them to prevent new use while keeping existing history and reports.</div>
        </div>
        <form className="card" onSubmit={save} noValidate>
          <h2>{sel ? `Edit ${cfg.one}` : `Add ${cfg.one}`}</h2>
          {sel && <small>{sel} {cur && (cur.active ? '· Active' : '· Inactive')}{(kind === 'projects' || kind === 'vendors') && <> · <Link to={`/${kind}/${encodeURIComponent(sel)}`} style={{ textDecoration: 'underline' }}>View items &amp; documents</Link></>}</small>}
          <br /><br />
          {cfg.fields.map(([k, l], j) => (
            <div key={k} style={{ marginBottom: 12 }}>
              <label>{l}{j === 0 ? ' *' : ''}</label>
              {k === 'description'
                ? <textarea rows={4} maxLength={1000} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                : <input value={form[k] ?? ''} readOnly={!!sel && k === 'name'} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />}
              {sel && k === 'name' && <small>Name cannot change after use</small>}
            </div>
          ))}
          <div className="er">{err}</div>
          <div className="acts">
            <button type="button" className="btn" onClick={() => pick(null)}>Cancel</button>
            <button className="btn p">{sel ? 'Save changes' : `Add ${cfg.one}`}</button>
            {cur && <button type="button" className={'btn' + (cur.active ? ' d' : '')} onClick={() => setMasterActive(kind, cur.name, !cur.active)}>{cur.active ? 'Deactivate' : 'Reactivate'}</button>}
          </div>
        </form>
      </div>
    </>
  )
}
