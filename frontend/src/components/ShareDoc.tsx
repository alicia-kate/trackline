import { useState } from 'react'
import { useItems } from '../api/items'
import { errorText } from '../api/client'
import { shareDocument, unlinkDocument } from '../api/documents'
import type { Attachment } from '../types'

// Link one document to many items, or take it off an item. The document stays in one place.
export default function ShareDoc({ doc, onClose, onChanged }: { doc: Attachment; onClose: () => void; onChanged: () => void }) {
  const items = useItems()
  const [linked, setLinked] = useState(doc.items), [q, setQ] = useState(''), [pick, setPick] = useState<string[]>([]), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const name = (id: string) => items.find((i) => i.id === id)?.desc ?? ''
  const hits = items.filter((i) => i.active && !linked.includes(i.id) && (!q || (i.id + i.desc + i.project + i.sn + i.mg).toLowerCase().includes(q.toLowerCase()))).slice(0, 40)
  const toggle = (id: string) => setPick(pick.includes(id) ? pick.filter((x) => x !== id) : [...pick, id])
  const run = async (fn: () => Promise<void>) => { setErr(''); setBusy(true); try { await fn(); onChanged() } catch (e) { setErr(errorText(e)) } setBusy(false) }
  const link = () => run(async () => { const a = await shareDocument(doc.id, pick); setLinked(a.items); setPick([]) })
  const unlink = (id: string) => run(async () => { await unlinkDocument(doc.id, id); setLinked(linked.filter((x) => x !== id)) })
  return (
    <div className="modal" onClick={onClose}>
      <div className="dlg" style={{ width: 'min(680px, 96%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="hd" style={{ marginBottom: 10 }}>
          <div><h2 style={{ wordBreak: 'break-word' }}>{doc.name}</h2><small>{doc.docType} · linked to {linked.length} item{linked.length === 1 ? '' : 's'}</small></div>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        {err && <div className="er" role="alert">{err}</div>}
        <label>Linked to</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '4px 0 14px' }}>
          {linked.map((id) => (
            <span key={id} className="chip" title={name(id)}>{id}{linked.length > 1 && <button type="button" aria-label={`Unlink ${id}`} disabled={busy} onClick={() => unlink(id)}>×</button>}</span>
          ))}
        </div>
        <label>Link to more items</label>
        <input className="s" placeholder="Search by item ID, name, project or serial number" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="pick">
          {hits.map((i) => (
            <label key={i.id} className="pk"><input type="checkbox" checked={pick.includes(i.id)} onChange={() => toggle(i.id)} /> <span><b style={{ display: 'inline' }}>{i.desc}</b> <small>{i.id} · {i.project || 'No project'}</small></span></label>
          ))}
          {!hits.length && <small>No more items match.</small>}
        </div>
        <div className="acts"><button className="btn p" disabled={!pick.length || busy} onClick={link}>Link {pick.length || ''} item{pick.length === 1 ? '' : 's'}</button></div>
      </div>
    </div>
  )
}
