import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { errorText } from '../api/client'
import { useAuth } from '../api/auth'
import { checkImportFile, checkImportRows, commitImport, IMPORT_TEMPLATE_URL } from '../api/imports'
import { loadAll } from '../api/stores'
import { useMasters } from '../api/masters'
import { exportWorkbook } from '../lib/export'
import type { Category, ImportCheck, ImportCol, ImportResult, ImportRow, MasterKind, NewMasters } from '../types'

const CATS: Category[] = ['Asset', 'License', 'Spare']
const TAB: Record<Category, string> = { Asset: 'Assets', License: 'Software licenses', Spare: 'Spares' }
const SHEET: Record<Category, string> = { Asset: 'Assets', License: 'Software Licenses', Spare: 'Spares' }
const STATUS = ['Available', 'Assigned', 'In Use']
const PAGE = 50
const MK: Record<string, MasterKind> = { project: 'projects', vendor: 'vendors', loc: 'locations', dept: 'departments' }
const MK_NAME: Record<MasterKind, string> = { projects: 'project', vendors: 'vendor', locations: 'location', departments: 'department' }
const low = (x: string) => x.trim().toLowerCase()
const bad = (r: ImportRow) => Object.keys(r.e).length > 0
const name = (c: ImportCol) => c.h.replace(/\s*\*$/, '')

export default function Import() {
  const m = useMasters(), { user } = useAuth()
  const canCreate = user?.role === 'admin' || user?.role === 'manager' // an admin adds Master data directly; a manager's import waits for an admin or inventory manager
  const [acc, setAcc] = useState<NewMasters>({})
  const [chk, setChk] = useState<ImportCheck | null>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(false), [err, setErr] = useState('')
  const [tab, setTab] = useState<Category>('Asset'), [show, setShow] = useState<'problems' | 'all'>('all'), [page, setPage] = useState(0)
  const [skipOk, setSkipOk] = useState(false), [over, setOver] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const seq = useRef(0), timer = useRef<ReturnType<typeof setTimeout>>()
  const pick = useRef<HTMLInputElement>(null)

  const problems = rows.filter(bad), ready = rows.length - problems.length
  const listed = chk ? CATS.filter((c) => rows.some((r) => r.c === c)) : []

  // Warn before leaving with rows that have not been imported.
  useEffect(() => {
    if (!rows.length || result) return
    const f = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', f)
    return () => window.removeEventListener('beforeunload', f)
  }, [rows.length, result])

  const options = useMemo(() => ({
    project: [...(user?.role === 'oic' ? user.projects : m.projects.filter((x) => x.active).map((x) => x.name)), ...(acc.projects ?? [])], vendor: [...m.vendors.filter((x) => x.active).map((x) => x.name), ...(acc.vendors ?? [])],
    loc: [...m.locations.filter((x) => x.active).map((x) => x.name), ...(acc.locations ?? [])], dept: [...m.departments.filter((x) => x.active).map((x) => x.name), ...(acc.departments ?? [])], status: STATUS,
  } as Record<string, string[]>), [m, acc, user])

  // Values the server could not find in Master data, grouped so one decision covers every row that uses them.
  const unknowns = useMemo(() => {
    const g = new Map<string, { kind: MasterKind; value: string; label: string; rows: number }>()
    for (const r of rows) for (const k of r.u ?? []) {
      const col = chk?.cols[r.c].find((c) => c.k === k), v = r.f[k]
      if (!col || !v) continue
      const kind = MK[col.kind], id = kind + '|' + low(v)
      const hit = g.get(id)
      if (hit) hit.rows++
      else g.set(id, { kind, value: v, label: name(col), rows: 1 })
    }
    return [...g.values()]
  }, [rows, chk])
  // Master data the person agreed to add that some row still uses.
  const adding = useMemo(() => (Object.entries(acc) as [MasterKind, string[]][]).flatMap(([kind, names]) => names
    .filter((n) => rows.some((r) => chk?.cols[r.c].some((c) => MK[c.kind] === kind && low(r.f[c.k] ?? '') === low(n))))
    .map((n) => ({ kind, name: n }))), [acc, rows, chk])

  const reset = () => { setAcc({}); setChk(null); setRows([]); setFileName(''); setResult(null); setErr(''); setSkipOk(false); setPage(0); seq.current++; clearTimeout(timer.current) }

  const upload = async (file: File | undefined) => {
    if (!file) return
    if (rows.length && !result && !window.confirm('This replaces everything on this page, including any edits you made. Continue?')) return
    if (!/\.xlsx$/i.test(file.name)) return setErr('Choose an Excel file (.xlsx). Download the template to get the right format.')
    setBusy(true); setErr(''); setResult(null); seq.current++; clearTimeout(timer.current)
    try {
      const r = await checkImportFile(file)
      setAcc({}); setChk(r); setRows(r.rows); setFileName(file.name); setSkipOk(false); setPage(0)
      const first = CATS.find((c) => r.rows.some((x) => x.c === c && bad(x))) ?? CATS.find((c) => r.rows.some((x) => x.c === c)) ?? 'Asset'
      setTab(first); setShow(r.rows.some(bad) ? 'problems' : 'all')
    } catch (e) { setErr(errorText(e)) }
    setBusy(false)
    if (pick.current) pick.current.value = ''
  }

  // After an edit, wait a moment, then ask the server to check all rows again (duplicates depend on the other rows).
  const recheck = (next: ImportRow[], a: NewMasters = acc) => {
    const mine = ++seq.current
    clearTimeout(timer.current)
    setChecking(true)
    timer.current = setTimeout(async () => {
      try {
        const r = await checkImportRows(next, a)
        if (mine === seq.current) setRows(r.rows)
      } catch (e) { if (mine === seq.current) setErr(errorText(e)) }
      if (mine === seq.current) setChecking(false)
    }, 700)
  }
  const edit = (key: string, k: string, v: string) => {
    const next = rows.map((r) => { if (r.key !== key) return r; const e = { ...r.e }; delete e[k]; return { ...r, f: { ...r.f, [k]: v }, e } })
    setRows(next); recheck(next)
  }
  // One decision for every row that uses a value that is not in Master data yet.
  const addNew = (kind: MasterKind, value: string) => {
    const a = { ...acc, [kind]: [...(acc[kind] ?? []), value] }
    setAcc(a); recheck(rows, a)
  }
  const undoNew = (kind: MasterKind, value: string) => {
    const a = { ...acc, [kind]: (acc[kind] ?? []).filter((x) => low(x) !== low(value)) }
    setAcc(a); recheck(rows, a)
  }
  const switchTo = (kind: MasterKind, value: string, to: string) => {
    if (!to) return
    const next = rows.map((r) => ({ ...r, f: Object.fromEntries(Object.entries(r.f).map(([k, v]) => [k, MK[chk?.cols[r.c].find((c) => c.k === k)?.kind ?? ''] === kind && low(v) === low(value) ? to : v])) }))
    setRows(next); recheck(next)
  }
  const remove = (key: string) => {
    const next = rows.filter((r) => r.key !== key)
    setRows(next)
    if (!next.length) return reset()
    recheck(next)
  }

  const send = async (onlyValid: boolean) => {
    setBusy(true); setErr('')
    try {
      const r = await commitImport(rows, onlyValid, acc)
      setResult(r)
      await loadAll().catch(() => undefined)
    } catch (e) { setErr(errorText(e)) }
    setBusy(false)
  }

  const problemList = () => exportWorkbook('import-problems', [{
    name: 'Problems', head: ['Sheet', 'Row', 'Field', 'Problem'],
    rows: problems.flatMap((r) => Object.entries(r.e).map(([k, msg]) => [SHEET[r.c], r.n, name(chk!.cols[r.c].find((c) => c.k === k) ?? { h: k } as ImportCol), msg])),
  }])
  // Skipped rows come back in the template's own layout, so they can be fixed and uploaded again.
  const skippedFile = (skipped: ImportRow[]) => exportWorkbook('import-skipped-rows', CATS.filter((c) => skipped.some((r) => r.c === c)).map((c) => ({
    name: SHEET[c], head: [...chk!.cols[c].map((x) => x.h), 'Problems'],
    rows: skipped.filter((r) => r.c === c).map((r) => [...chk!.cols[c].map((x) => r.f[x.k] ?? ''), Object.entries(r.e).map(([k, msg]) => `${name(chk!.cols[c].find((x) => x.k === k)!)}: ${msg}`).join('; ')]),
  })))

  // ---------------------------------------------------------------- finished
  if (result) {
    const range = (k: string) => { const a = result.ids[k] ?? []; return a.length ? `${a[0]}${a.length > 1 ? ` to ${a[a.length - 1]}` : ''}` : '' }
    return (
      <>
        <div className="hd"><div><h1>Bulk import</h1></div></div>
        <div className="card">
          {result.queued ? (
            <>
              <h2>Sent for approval</h2>
              <p>{result.submitted} items were submitted. An admin or inventory manager must approve the import before they appear in the register{adding.length ? ', and the new Master data it adds' : ''}.</p>
              <p><Link className="btn p" to="/approvals">See my request</Link></p>
            </>
          ) : (
            <>
              <h2>{result.created} items imported</h2>
              <div className="kv">
                {CATS.map((c) => { const k = TAB[c].toLowerCase().replace('software ', ''); const n = result.ids[k]?.length ?? 0; return n ? <div key={c}><span>{TAB[c]}</span>{n} · {range(k)}</div> : null })}
              </div>
              {Object.entries(result.masters_created ?? {}).map(([kind, names]) => <p key={kind} className="mu">New {MK_NAME[kind as MasterKind]}{names.length > 1 ? 's' : ''} added to Master data: {names.join(', ')}</p>)}
              <p><Link className="btn p" to="/inventory">View inventory</Link></p>
            </>
          )}
          {result.skipped.length > 0 && (
            <div className="er" role="alert">
              <b>{result.skipped.length} row{result.skipped.length > 1 ? 's were' : ' was'} NOT imported</b> because they had problems.
              <p style={{ margin: '8px 0 0' }}><button className="btn" onClick={() => skippedFile(result.skipped)}>Download the skipped rows (Excel)</button></p>
              <small>The file uses the template layout with a Problems column, so you can fix the rows and upload it again.</small>
            </div>
          )}
          <p><button className="btn" onClick={reset}>Import another file</button></p>
        </div>
      </>
    )
  }

  // ---------------------------------------------------------------- upload + review
  const inTab = rows.filter((r) => r.c === tab)
  const list = show === 'problems' ? inTab.filter(bad) : inTab
  const pages = Math.max(1, Math.ceil(list.length / PAGE)), cur = Math.min(page, pages - 1)
  const cols = chk?.cols[tab] ?? []
  const cell = (r: ImportRow, c: ImportCol) => {
    const v = r.f[c.k] ?? '', e = r.e[c.k]
    const opts = options[c.kind]
    return (
      <td key={c.k} className={e ? 'ie' : ''}>
        {opts
          ? (
            <select value={v} aria-label={name(c)} onChange={(x) => edit(r.key, c.k, x.target.value)}>
              <option value="">{c.req ? 'Choose…' : '—'}</option>
              {v && !opts.includes(v) && <option value={v}>{v}</option>}
              {opts.map((o) => <option key={o}>{o}</option>)}
            </select>
          )
          : <input value={v} aria-label={name(c)} placeholder={c.kind === 'date' ? 'YYYY-MM-DD' : ''} inputMode={c.kind === 'int' || c.kind === 'money' ? 'decimal' : undefined} onChange={(x) => edit(r.key, c.k, x.target.value)} />}
        {e && <span className="im">{e}</span>}
      </td>
    )
  }

  return (
    <>
      <div className="hd"><div><h1>Bulk import</h1><p className="mu">Inventory / Bulk import · Add many assets, software licenses and spares at once from an Excel file.</p></div><Link className="btn" to="/inventory">← Back to inventory</Link></div>
      {err && <div className="er" role="alert">{err}</div>}

      <div className="card">
        <h2>1. Get the template</h2>
        <p className="mu">One workbook with a sheet each for assets, licenses and spares. Project, vendor, location and department are drop-downs filled from your Master data.</p>
        <p><a className="btn" href={IMPORT_TEMPLATE_URL}>Download Excel template</a></p>
        <h2 style={{ marginTop: 18 }}>2. Upload your filled-in file</h2>
        <p className="mu">Nothing is saved yet. You will see every row, fix any problems, and then press Import.</p>
        <div className={'drop' + (over ? ' over' : '')} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) upload(e.dataTransfer.files[0]) }}>
          <div className="row" style={{ margin: 0, justifyContent: 'center' }}>
            <input ref={pick} type="file" accept=".xlsx" hidden onChange={(e) => upload(e.target.files?.[0])} />
            <button className="btn p" disabled={busy} onClick={() => pick.current?.click()}>{chk ? 'Replace file' : 'Choose Excel file'}</button>
            {busy && !chk && <span className="mu">Checking…</span>}
            {fileName && <span className="mu">{fileName}</span>}
          </div>
          <small>or drag and drop your .xlsx file here</small>
        </div>
      </div>

      {chk && (
        <div className="card">
          <h2>3. Review</h2>
          <div className="ibar">
            <span className="bd gr">{ready} ready</span>
            {problems.length > 0 && <span className="bd rd">{problems.length} with problems</span>}
            <span className="mu">{rows.length} rows in total</span>
            {checking && <span className="mu">Checking…</span>}
            {problems.length > 0 && <button className="btn" onClick={problemList}>Download problem list (Excel)</button>}
          </div>
          {chk.warnings.map((w) => <div key={w} className="note" style={{ marginTop: 10 }}>{w}</div>)}

          {(unknowns.length > 0 || adding.length > 0) && (
            <div className="note" style={{ marginTop: 12 }}>
              {unknowns.length > 0 && <b>Not in Master data yet</b>}
              {unknowns.map((u) => (
                <div key={u.kind + u.value} className="row" style={{ margin: '8px 0 0', alignItems: 'center' }}>
                  <span><b>{u.value}</b> · {u.label} · {u.rows} row{u.rows > 1 ? 's' : ''}</span>
                  <button className="btn" disabled={!canCreate} title={canCreate ? '' : 'Only an admin or inventory manager can add Master data'} onClick={() => addNew(u.kind, u.value)}>Add as a new {MK_NAME[u.kind]}</button>
                  <select aria-label={`Use an existing ${MK_NAME[u.kind]} instead`} value="" onChange={(e) => switchTo(u.kind, u.value, e.target.value)} style={{ width: 'auto' }}>
                    <option value="">or use an existing {MK_NAME[u.kind]}…</option>
                    {options[Object.keys(MK).find((k) => MK[k] === u.kind)!].map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
              ))}
              {unknowns.length > 0 && !canCreate && <small>Only an admin or inventory manager can add Master data. Pick an existing value, or ask them to add it first.</small>}
              {adding.length > 0 && (
                <div style={{ marginTop: unknowns.length ? 10 : 0 }}>
                  <b>Will be added to Master data when you import</b>
                  {adding.map((a) => <div key={a.kind + a.name} className="row" style={{ margin: '6px 0 0', alignItems: 'center' }}><span>{a.name} <small>({MK_NAME[a.kind]})</small></span><button className="btn" onClick={() => undoNew(a.kind, a.name)}>Undo</button></div>)}
                  {user?.needs_approval && <small>These are created when an admin or inventory manager approves the import.</small>}
                </div>
              )}
            </div>
          )}

          <div className="tabs" style={{ marginTop: 14 }}>
            {listed.map((c) => {
              const n = rows.filter((r) => r.c === c), b = n.filter(bad).length
              return <button key={c} className={tab === c ? 'on' : ''} onClick={() => { setTab(c); setPage(0) }}>{TAB[c]} ({n.length}){b > 0 && <span className="bd rd" style={{ marginLeft: 6 }}>{b}</span>}</button>
            })}
          </div>
          <div className="row" style={{ margin: '0 0 10px' }}>
            <button className={'btn' + (show === 'problems' ? ' p' : '')} onClick={() => { setShow('problems'); setPage(0) }}>Problem rows ({inTab.filter(bad).length})</button>
            <button className={'btn' + (show === 'all' ? ' p' : '')} onClick={() => { setShow('all'); setPage(0) }}>All rows ({inTab.length})</button>
          </div>

          <div className="sc"><table className="itbl">
            <thead><tr><th>Row</th>{cols.map((c) => <th key={c.k} title={c.help}>{c.h}</th>)}<th></th></tr></thead>
            <tbody>
              {list.slice(cur * PAGE, cur * PAGE + PAGE).map((r) => (
                <tr key={r.key}>
                  <td><b>{r.n}</b></td>
                  {cols.map((c) => cell(r, c))}
                  <td><button className="btn d" aria-label={`Remove row ${r.n}`} title="Remove this row from the import" onClick={() => remove(r.key)}>Remove</button></td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={cols.length + 2}>{show === 'problems' ? 'No problem rows here.' : 'No rows here.'}</td></tr>}
            </tbody>
          </table></div>
          {pages > 1 && (
            <div className="row" style={{ margin: '10px 0 0' }}>
              <button className="btn" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</button>
              <span className="mu">Page {cur + 1} of {pages}</span>
              <button className="btn" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</button>
            </div>
          )}
        </div>
      )}

      {chk && (
        <div className="card">
          <h2>4. Import</h2>
          {problems.length > 0
            ? <p className="mu">{problems.length} row{problems.length > 1 ? 's have' : ' has'} problems. Fix them above, remove them, or upload a corrected file to import everything.</p>
            : <p className="mu">All {rows.length} rows passed the checks. New item IDs are created automatically.</p>}
          <p><button className="btn p" disabled={busy || checking || problems.length > 0 || !rows.length} onClick={() => send(false)}>{busy ? 'Importing…' : `Import ${rows.length} items`}</button></p>
          {problems.length > 0 && ready > 0 && (
            <details>
              <summary className="mu" style={{ cursor: 'pointer' }}>Other option: import only the valid rows</summary>
              <div className="note" style={{ marginTop: 10 }}>
                The {problems.length} problem row{problems.length > 1 ? 's' : ''} will <b>not</b> be imported. You can download them afterwards, in the template layout, to fix and upload again.
                <p style={{ margin: '8px 0' }}><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={skipOk} onChange={(e) => setSkipOk(e.target.checked)} style={{ width: 'auto' }} /> I understand that {problems.length} row{problems.length > 1 ? 's' : ''} will be skipped.</label></p>
                <button className="btn" disabled={busy || checking || !skipOk} onClick={() => send(true)}>Import {ready} valid rows, skip {problems.length}</button>
              </div>
            </details>
          )}
        </div>
      )}
    </>
  )
}
