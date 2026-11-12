import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useItems } from '../api/items'
import { submitCreate, submitUpdate } from '../api/requests'
import { useAuth } from '../api/auth'
import { StatusBadge } from '../components/Badges'
import { ALLOWED_EXT, DOC_TYPES, MAX_MB, sizeText, stageDocument, unstageDocument } from '../api/documents'
import { errorText } from '../api/client'
import { CURRENCY } from '../lib/rules'
import type { Category, Item } from '../types'

// [key, label per category (Asset|License|Spare), type, hidden for, required for, datalist]
type FieldDef = [keyof Item, string, string, string, string, string?]
const FS: FieldDef[] = [
  ['desc', 'Item name', 'text', '', 'ALS'], ['use', 'Description (what it is used for)', 'text', '', ''], ['make', 'Make|Publisher|Make', 'text', '', 'A'], ['model', 'Model', 'text', 'L', 'A'],
  ['sn', 'Serial number|License key|Part number', 'text', '', ''], ['mg', 'MG No', 'text', 'LS', ''], ['qty', 'Quantity|Seats|Opening balance', 'number', 'A', 'LS'],
  ['min', 'Reorder level', 'number', 'AL', 'S'], ['date', 'Purchase date', 'date', '', ''], ['cost', `Purchase cost (${CURRENCY})`, 'number', '', ''],
  ['project', 'Purchase project', 'text', '', 'ALS', 'pj'], ['vendor', 'Vendor / supplier', 'text', '', '', 'vv'], ['loc', 'Location / site', 'text', '', 'ALS', 'll'],
  ['oic', 'OIC responsible person', 'text', '', 'ALS', 'pp'], ['status', 'Status', 'select', 'S', ''], ['user', 'Current user', 'text', 'S', '', 'pp'],
  ['dept', 'Department', 'text', 'S', '', 'dd'], ['due', 'Next renewal / expiry', 'date', 'AS', 'L'], ['wdue', 'Warranty / support end date', 'date', 'LS', ''],
  ['winfo', 'Warranty / support terms', 'text', 'S', ''], ['remarks', 'Remarks', 'textarea', '', ''],
]
const NUM: (keyof Item)[] = ['qty', 'min', 'cost']
const SEC: [string, (keyof Item)[]][] = [
  ['01 Item information', ['desc', 'use', 'make', 'model', 'sn', 'mg', 'qty', 'min']],
  ['02 Purchase & supplier', ['date', 'cost', 'project', 'vendor']],
  ['03 Warranty, support & renewal', ['wdue', 'winfo', 'due']],
]
const SIDE: (keyof Item)[] = ['status', 'loc', 'oic', 'user', 'dept', 'remarks']
const def = (k: keyof Item) => FS.find((s) => s[0] === k)!

export default function ItemForm() {
  const { id } = useParams(), items = useItems(), nav = useNavigate(), st = useLocation().state, { user } = useAuth()
  const it = id ? items.find((x) => x.id === id) : undefined
  const [c, setC] = useState<Category>(it ? it.c : st?.c || 'Asset')
  const [v, setV] = useState<Partial<Item>>(it || { status: 'Available' })
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const [docs, setDocs] = useState<{ f: File; t: string; id?: number }[]>([]), [docType, setDocType] = useState<string>(DOC_TYPES[0]), [over, setOver] = useState(false)
  const pick = useRef<HTMLInputElement>(null)
  if (id && !it) return <div className="card">Item not found.</div>
  const k = c[0], ci = 'ALS'.indexOf(k)
  const hidden = (s: FieldDef) => (it && s[0] === 'qty' ? 'AS' : it && s[0] === 'status' ? 'ALS' : s[3])
  const vis = (s: FieldDef) => !hidden(s).includes(k)
  const val = (n: keyof Item) => String(v[n] ?? '')
  const ch = (n: keyof Item) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [n]: e.target.value })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const miss = FS.filter((s) => vis(s) && s[4].includes(k) && val(s[0]).trim() === '').map((s) => s[1].split('|')[0])
    if (miss.length) return setErr('Fill in: ' + miss.join(', '))
    const o: Record<string, string | number> = {}
    FS.filter(vis).forEach((s) => { const x = val(s[0]); o[s[0]] = NUM.includes(s[0]) && x !== '' ? +x : x.trim() })
    setBusy(true)
    let staged = docs
    if (!it) {
      try {
        staged = []
        for (const d of docs) staged.push(d.id ? d : { ...d, id: (await stageDocument(d.t, d.f)).id })
        setDocs(staged)
      } catch (x) { setBusy(false); return setErr(errorText(x)) }
    }
    const r = it ? await submitUpdate(it.id, o as Partial<Item>) : await submitCreate(c, o as Partial<Item>, staged.map((d) => d.id!))
    setBusy(false)
    if (r.error) return setErr(r.error)
    nav(r.queued ? '/approvals' : `/inventory/${r.id}`)
  }
  const addDocs = (files: FileList | File[]) => {
    const ok: { f: File; t: string }[] = []
    for (const f of Array.from(files)) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      if (!ALLOWED_EXT.includes(ext)) return setErr(`${f.name}: allowed types are PDF, JPG, PNG, Excel (xlsx) and Word (docx).`)
      if (f.size > MAX_MB * 1024 * 1024) return setErr(`${f.name}: files can be up to ${MAX_MB} MB.`)
      ok.push({ f, t: docType })
    }
    setErr(''); setDocs([...docs, ...ok])
    if (pick.current) pick.current.value = ''
  }
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); addDocs(e.dataTransfer.files) }
  const fld = ([n, l, t, , r, ls]: FieldDef) => {
    const p = l.split('|')
    return (
      <div key={n}>
        <label>{(p[ci] || p[0]) + (r.includes(k) ? ' *' : '')}</label>
        {t === 'select'
          ? <select value={val(n) || 'Available'} onChange={ch(n)}>{['Available', 'Assigned', 'In Use'].map((x) => <option key={x}>{x}</option>)}</select>
          : t === 'textarea'
            ? <textarea rows={3} value={val(n)} onChange={ch(n)} />
            : <input type={t} list={ls} value={val(n)} onChange={ch(n)} min={t === 'number' ? 0 : undefined} step={t === 'number' ? 'any' : undefined} />}
      </div>
    )
  }
  return (
    <>
      <div className="hd">
        <div><h1>{it ? 'Edit item' : 'Add item'}</h1><p className="mu">Inventory / {it ? `${it.id} / ${it.desc}` : 'New item · Register a purchase and establish custody.'} Fields marked * are required.</p></div>
        <Link className="btn" to={it ? `/inventory/${it.id}` : '/inventory'}>{it ? 'View record' : '← Back to inventory'}</Link>
      </div>
      <form onSubmit={submit} noValidate>
        <div className="g2">
          <div>
            {!it && <div className="acts">{(['Asset', 'License', 'Spare'] as Category[]).map((x) => <button key={x} type="button" className={'btn' + (x === c ? ' p' : '')} onClick={() => setC(x)}>{x === 'License' ? 'Software licenses' : x === 'Spare' ? 'Spares / consumables' : 'Assets'}</button>)}</div>}
            {SEC.map(([t, ks]) => {
              const fs = ks.map(def).filter(vis)
              return fs.length ? <div key={t} className="card"><h2>{t}</h2><br /><div className="f2">{fs.map(fld)}</div></div> : null
            })}
            {!it && (
              <div className="card"><h2>04 Documents</h2><small>Invoice, warranty, transmittal advice or asset files. Optional.</small>
                <>
                    <div className={'drop' + (over ? ' over' : '')} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={drop}>
                      <div className="row" style={{ margin: 0, justifyContent: 'center' }}>
                        <select aria-label="Document type" value={docType} onChange={(e) => setDocType(e.target.value)} style={{ width: 'auto' }}>{DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                        <button className="btn p" type="button" disabled={busy} onClick={() => pick.current?.click()}>Choose files</button>
                        <input ref={pick} type="file" multiple hidden accept={ALLOWED_EXT.map((x) => '.' + x).join(',')} onChange={(e) => e.target.files && addDocs(e.target.files)} />
                      </div>
                      <small>or drag files here · PDF, JPG, PNG, Excel, Word · up to {MAX_MB} MB each · {user?.needs_approval ? 'sent for approval together with the item' : 'saved together with the item'}</small>
                    </div>
                    {docs.map((d, n) => (
                      <div key={n} className="li">
                        <span style={{ minWidth: 0 }}><b style={{ display: 'inline', wordBreak: 'break-word' }}>{d.f.name}</b><br /><small>{d.t} · {sizeText(d.f.size)}</small></span>
                        <button type="button" className="btn" disabled={busy} onClick={() => { if (d.id) unstageDocument(d.id).catch(() => undefined); setDocs(docs.filter((_, j) => j !== n)) }}>Remove</button>
                      </div>
                    ))}
                </>
              </div>
            )}
          </div>
          <div>
            <div className="card"><h2>Status &amp; custody</h2><br />
              {SIDE.map(def).filter(vis).map((s) => <div key={s[0]} style={{ marginBottom: 12 }}>{fld(s)}</div>)}
            </div>
            <div className="card"><small>Record preview</small><h2>{it ? it.id : 'ID generated on save'}</h2>
              {val('desc') || '—'}<br /><StatusBadge s={it ? it.status : val('status') || 'Available'} /><br />
              <small>{val('project') || 'No project'}{val('oic') ? ` · Responsible: ${val('oic')}` : ''}</small>
            </div>
            <div className="er">{err}</div>
            <div className="acts">
              <Link className="btn" to={it ? `/inventory/${it.id}` : '/inventory'}>Cancel</Link>
              <button className="btn p" disabled={busy}>{user?.needs_approval ? 'Submit for approval' : it ? 'Save changes' : 'Create item'}</button>
            </div>
          </div>
        </div>
      </form>
    </>
  )
}
