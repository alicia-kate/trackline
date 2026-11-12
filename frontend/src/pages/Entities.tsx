import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../api/auth'
import { errorText } from '../api/client'
import { canPreview, fileUrl, listDocumentsBy, sizeText } from '../api/documents'
import { useItems } from '../api/items'
import { useMasters } from '../api/masters'
import ShareDoc from '../components/ShareDoc'
import { DueCell, Kpi, StatusBadge } from '../components/Badges'
import { canApprove, isOic } from '../lib/permissions'
import { getAlerts } from '../lib/rules'
import type { Attachment, Category, Item } from '../types'

type Kind = 'projects' | 'vendors'
const KEY = { projects: 'project', vendors: 'vendor' } as const
const TITLE = { projects: 'Projects', vendors: 'Vendors' } as const
const norm = (s: string) => s.trim().toLowerCase()
const FIELDS: Record<Kind, [string, string][]> = {
  projects: [['Project code', 'code'], ['Project lead', 'lead'], ['Primary site', 'site']],
  vendors: [['Contact person', 'contact'], ['Email', 'email'], ['Phone', 'phone']],
}
const CATS: [string, string][] = [['', 'All'], ['Asset', 'Assets'], ['License', 'Software licenses'], ['Spare', 'Spares']]
const cnt = (a: Item[], c: Category) => a.filter((i) => i.c === c).length

export function EntityList({ kind }: { kind: Kind }) {
  const items = useItems(), m = useMasters(), { user } = useAuth(), nav = useNavigate()
  const [q, setQ] = useState('')
  const key = KEY[kind], scoped = isOic(user)
  const base = scoped ? (kind === 'projects' ? user?.projects ?? [] : []) : m[kind].map((r) => r.name)
  const names = [...new Set([...base, ...items.map((i) => i[key]).filter(Boolean)])].sort((a, b) => a.localeCompare(b))
  const rows = names.map((n) => ({ n, r: m[kind].find((x) => norm(x.name) === norm(n)), it: items.filter((i) => i.active && norm(i[key]) === norm(n)) }))
    .filter((x) => !q || (x.n + String(x.r?.description ?? '') + String(x.r?.code ?? '')).toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <div className="hd">
        <div><h1>{TITLE[kind]}</h1><p className="mu">{scoped && kind === 'projects' ? 'The projects you are assigned to.' : kind === 'projects' ? 'Open a project to see everything in it: assets, licenses, spares and documents.' : 'Open a vendor to see what you bought from them and the documents on file.'}</p></div>
        {canApprove(user) && <Link className="btn" to="/master-data">Manage in Master data</Link>}
      </div>
      <div className="card">
        <div className="row"><input className="s" placeholder={`Search ${TITLE[kind].toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="sc"><table>
          <thead><tr><th>{TITLE[kind].slice(0, -1)}</th><th>{kind === 'projects' ? 'Description' : 'Contact'}</th><th>Assets</th><th>Licenses</th><th>Spares</th><th>Alerts</th></tr></thead>
          <tbody>
            {rows.map(({ n, r, it }) => (
              <tr key={n} onClick={() => nav(`/${kind}/${encodeURIComponent(n)}`)}>
                <td><b>{n}</b>{r && !r.active && <> <span className="bd">Inactive</span></>}{kind === 'projects' && r?.code ? <small>{String(r.code)}</small> : null}</td>
                <td style={{ maxWidth: 340 }}>{String(kind === 'projects' ? r?.description ?? '' : r?.contact ?? '') || '—'}</td>
                <td>{cnt(it, 'Asset')}</td><td>{cnt(it, 'License')}</td><td>{cnt(it, 'Spare')}</td><td>{getAlerts(it).length || '—'}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6}>{scoped && kind === 'projects' ? 'No projects are assigned to you yet. Ask an admin or inventory manager.' : 'Nothing here yet.'}</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  )
}

export function EntityDetail({ kind }: { kind: Kind }) {
  const { name = '' } = useParams(), items = useItems(), m = useMasters(), { user } = useAuth(), nav = useNavigate()
  const key = KEY[kind]
  const mine = items.filter((i) => norm(i[key]) === norm(name)), live = mine.filter((i) => i.active)
  const row = m[kind].find((r) => norm(r.name) === norm(name))
  const [tab, setTab] = useState(''), [docs, setDocs] = useState<Attachment[] | null>(null), [err, setErr] = useState(''), [share, setShare] = useState<Attachment | null>(null)
  const load = useCallback(() => listDocumentsBy({ [key]: name }).then(setDocs).catch((e) => { setDocs([]); setErr(errorText(e)) }), [key, name])
  useEffect(() => { setDocs(null); setErr(''); load() }, [load])
  const shown = mine.filter((i) => !tab || i.c === tab)
  const locked = isOic(user) && kind === 'projects' && !user?.projects.some((p) => norm(p) === norm(name))
  const fields = FIELDS[kind].filter(([, k]) => row?.[k])
  const desc = kind === 'projects' ? String(row?.description ?? '') : ''
  return (
    <>
      <div className="hd">
        <div><h1>{name}</h1><p className="mu"><Link to={`/${kind}`} style={{ textDecoration: 'underline' }}>{TITLE[kind]}</Link> / {name}{row && !row.active ? ' · Inactive' : ''}</p></div>
        <div className="row" style={{ margin: 0 }}>
          {canApprove(user) && <Link className="btn" to="/master-data">Edit details</Link>}
          <button className="btn" onClick={() => nav(`/${kind}`)}>Back to {TITLE[kind].toLowerCase()}</button>
        </div>
      </div>
      {locked && <div className="note">You are not assigned to this project, so its items and documents are hidden. You can request access from the Inventory page.</div>}
      {(fields.length > 0 || desc) && (
        <div className="card">
          {desc && <p style={{ margin: '0 0 ' + (fields.length ? 12 : 0) + 'px', whiteSpace: 'pre-wrap' }}>{desc}</p>}
          {fields.length > 0 && <div className="kv" style={{ margin: 0 }}>{fields.map(([l, k]) => <div key={k}><span>{l}</span>{String(row?.[k])}</div>)}</div>}
        </div>
      )}
      <div className="g4">
        <Kpi t="Records" b={live.length} s="Active items" />
        <Kpi t="Assets" b={cnt(live, 'Asset')} s="Hardware & equipment" />
        <Kpi t="Software licenses" b={cnt(live, 'License')} s="Software & subscriptions" />
        <Kpi t="Spares" b={cnt(live, 'Spare')} s="Parts & consumables" />
        <Kpi t="Open alerts" b={getAlerts(live).length} s="Renewals, warranties, stock" />
      </div>
      <div className="card">
        <h2>Inventory</h2>
        <div className="tabs" style={{ margin: '8px 0 0' }}>{CATS.map(([c, t]) => <button key={c} className={tab === c ? 'on' : ''} onClick={() => setTab(c)}>{t} {mine.filter((i) => !c || i.c === c).length}</button>)}</div>
        <div className="sc"><table>
          <thead><tr><th>Item</th><th>Category</th><th>{kind === 'projects' ? 'Vendor' : 'Project'}</th><th>OIC / current user</th><th>Status</th><th>Renewal / warranty</th></tr></thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id} onClick={() => nav(`/inventory/${i.id}`)}>
                <td><b>{i.desc}</b><small>{i.id}</small></td><td>{i.c}</td><td>{(kind === 'projects' ? i.vendor : i.project) || '—'}</td>
                <td>{i.oic || '—'}<br /><small>{i.user || 'Unassigned'}</small></td>
                <td><StatusBadge s={i.status} />{!i.active && <> <span className="bd">Inactive</span></>}</td><td><DueCell i={i} /></td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={6}>No items yet.</td></tr>}
          </tbody>
        </table></div>
      </div>
      <div className="card">
        <h2>Documents</h2><small>Every document on an item in this {kind === 'projects' ? 'project' : 'vendor'}. A document linked to several items is listed once.</small>
        {err && <div className="er" role="alert">{err}</div>}
        {docs === null && <p className="mu">Loading…</p>}
        {docs && docs.length > 0 && (
          <div className="sc"><table>
            <thead><tr><th>Document</th><th>Linked items</th><th>Added</th><th /></tr></thead>
            <tbody>
              {docs.map((a) => (
                <tr key={a.id}>
                  <td style={{ wordBreak: 'break-word' }}><b>{a.name}</b>{a.status === 'pending' && <> <span className="bd am">Waiting for approval</span></>}<small>{a.docType} · {sizeText(a.size)}</small></td>
                  <td>{a.items.slice(0, 4).map((id) => <Link key={id} className="chip" to={`/inventory/${id}`}>{id}</Link>)}{a.items.length > 4 && <small> +{a.items.length - 4} more</small>}</td>
                  <td>{a.by}<small>{a.at}</small></td>
                  <td><span className="row" style={{ margin: 0, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                    {canPreview(a.type) && <a className="btn" href={fileUrl(a.id)} target="_blank" rel="noreferrer">View</a>}
                    <a className="btn" href={fileUrl(a.id, true)}>Download</a>
                    {canApprove(user) && a.status === 'active' && <button className="btn" onClick={() => setShare(a)}>Share</button>}
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {docs?.length === 0 && !err && <p className="mu">No documents yet. Upload them on an item and they show up here.</p>}
      </div>
      {share && <ShareDoc doc={share} onClose={() => setShare(null)} onChanged={load} />}
    </>
  )
}
