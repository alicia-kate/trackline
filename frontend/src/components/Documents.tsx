import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { useAuth } from '../api/auth'
import { errorText } from '../api/client'
import { ALLOWED_EXT, DOC_TYPES, MAX_MB, canPreview, deleteDocument, fileUrl, listDocuments, sizeText, uploadDocument } from '../api/documents'
import { loadItems } from '../api/items'
import { loadRequests } from '../api/requests'
import { canApprove, canWrite, isAdmin } from '../lib/permissions'
import ShareDoc from './ShareDoc'
import type { Attachment } from '../types'

export default function Documents({ itemId }: { itemId: string }) {
  const { user } = useAuth()
  const [list, setList] = useState<Attachment[] | null>(null)
  const [docType, setDocType] = useState<string>(DOC_TYPES[0])
  const [err, setErr] = useState(''), [info, setInfo] = useState(''), [busy, setBusy] = useState(false), [over, setOver] = useState(false)
  const [view, setView] = useState<Attachment | null>(null), [share, setShare] = useState<Attachment | null>(null)
  const pick = useRef<HTMLInputElement>(null)
  const up = canWrite(user), admin = isAdmin(user), staff = canApprove(user)

  const load = useCallback(() => listDocuments(itemId).then(setList).catch((e) => { setList([]); setErr(errorText(e)) }), [itemId])
  useEffect(() => { setList(null); setErr(''); setInfo(''); load() }, [load])

  async function upload(files: FileList | File[]) {
    setErr(''); setInfo('')
    const todo = Array.from(files)
    if (!todo.length) return
    setBusy(true)
    let sent = 0, held = 0
    for (const f of todo) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      if (!ALLOWED_EXT.includes(ext)) { setErr(`${f.name}: allowed types are PDF, JPG, PNG, Excel (xlsx) and Word (docx).`); break }
      if (f.size > MAX_MB * 1024 * 1024) { setErr(`${f.name}: files can be up to ${MAX_MB} MB.`); break }
      try {
        const r = await uploadDocument(itemId, docType, f)
        r.queued ? held++ : sent++
      } catch (e) { setErr(`${f.name}: ${errorText(e)}`); break }
    }
    setBusy(false)
    if (pick.current) pick.current.value = ''
    if (sent) setInfo(`${sent} file${sent > 1 ? 's' : ''} uploaded.`)
    if (held) setInfo(`${held} file${held > 1 ? 's' : ''} sent for approval. ${held > 1 ? 'They' : 'It'} will show to everyone once approved.`)
    await Promise.all([load(), loadItems(), loadRequests()]).catch(() => undefined)
  }

  async function remove(a: Attachment) {
    if (!window.confirm(`Remove "${a.name}"${a.items.length > 1 ? ` from all ${a.items.length} linked items` : ''}? It will be hidden from the list. The file itself stays in the storage folder.`)) return
    try { await deleteDocument(a.id); setInfo('Document removed.'); setErr('') } catch (e) { setErr(errorText(e)) }
    await Promise.all([load(), loadItems()]).catch(() => undefined)
  }

  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (up && !busy) upload(e.dataTransfer.files) }

  return (
    <div className="card">
      <h2>Documents</h2><small>Invoices, warranties, transmittal advice and asset files for this item.</small>
      {up && (
        <div className={'drop' + (over ? ' over' : '')} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={drop}>
          <div className="row" style={{ margin: 0, justifyContent: 'center' }}>
            <select aria-label="Document type" value={docType} onChange={(e) => setDocType(e.target.value)} style={{ width: 'auto' }}>
              {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <button className="btn p" type="button" disabled={busy} onClick={() => pick.current?.click()}>{busy ? 'Uploading…' : 'Choose files'}</button>
            <input ref={pick} type="file" multiple hidden accept={ALLOWED_EXT.map((x) => '.' + x).join(',')} onChange={(e) => e.target.files && upload(e.target.files)} />
          </div>
          <small>or drag files here · PDF, JPG, PNG, Excel, Word · up to {MAX_MB} MB each{user?.needs_approval && ' · uploads wait for approval'}</small>
        </div>
      )}
      {err && <div className="er" role="alert">{err}</div>}
      {info && <div className="note" style={{ margin: '10px 0 0' }}>{info}</div>}
      {list === null && <p className="mu">Loading…</p>}
      {list?.map((a) => (
        <div key={a.id} className="li doc">
          <span style={{ minWidth: 0 }}>
            <b style={{ display: 'inline', wordBreak: 'break-word' }}>{a.name}</b>{' '}
            {a.status === 'pending' && <span className="bd am">Waiting for approval</span>}
            <br /><small>{a.docType} · {sizeText(a.size)} · {a.by} · {a.at}</small>
            {a.items.length > 1 && <><br /><small>Also linked to {a.items.filter((x) => x !== itemId).join(', ')}</small></>}
          </span>
          <span className="row" style={{ margin: 0, flexWrap: 'nowrap' }}>
            {canPreview(a.type) && <button className="btn" onClick={() => setView(a)}>View</button>}
            <a className="btn" href={fileUrl(a.id, true)}>Download</a>
            {staff && a.status === 'active' && <button className="btn" onClick={() => setShare(a)}>Share</button>}
            {admin && a.status === 'active' && <button className="btn d" onClick={() => remove(a)}>Remove</button>}
          </span>
        </div>
      ))}
      {list?.length === 0 && !err && <p className="mu">No documents yet.</p>}
      {share && <ShareDoc doc={share} onClose={() => setShare(null)} onChanged={() => Promise.all([load(), loadItems()]).catch(() => undefined)} />}
      {view && (
        <div className="modal" onClick={() => setView(null)}>
          <div className="dlg" style={{ width: 'min(960px, 96%)' }} onClick={(e) => e.stopPropagation()}>
            <div className="hd" style={{ marginBottom: 10 }}>
              <div><h2 style={{ wordBreak: 'break-word' }}>{view.name}</h2><small>{view.docType} · {sizeText(view.size)}</small></div>
              <div className="row" style={{ margin: 0 }}>
                <a className="btn" href={fileUrl(view.id, true)}>Download</a>
                <button className="btn" onClick={() => setView(null)}>Close</button>
              </div>
            </div>
            {view.type === 'application/pdf'
              ? <iframe className="view" title={view.name} src={fileUrl(view.id)} />
              : <img className="view img" alt={view.name} src={fileUrl(view.id)} />}
          </div>
        </div>
      )}
    </div>
  )
}
