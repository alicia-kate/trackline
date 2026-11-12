import { api, apiUpload } from './client'
import type { Attachment } from '../types'

export const DOC_TYPES = ['Invoice', 'Warranty', 'Transmittal advice', 'Asset file', 'Other'] as const
export const ALLOWED_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'xlsx', 'docx']
export const MAX_MB = 10

export const listDocuments = (itemId: string) => api<Attachment[]>(`/items/${itemId}/attachments`)
export const uploadDocument = (itemId: string, docType: string, file: File) => {
  const f = new FormData()
  f.append('doc_type', docType)
  f.append('file', file)
  return apiUpload<{ attachment: Attachment; queued: boolean }>(`/items/${itemId}/attachments`, f)
}
export const stageDocument = (docType: string, file: File) => {
  const f = new FormData()
  f.append('doc_type', docType)
  f.append('file', file)
  return apiUpload<Attachment>('/uploads', f)
}
export const unstageDocument = (id: number) => api(`/uploads/${id}`, { method: 'DELETE' })
export const listDocumentsBy = (by: { project?: string; vendor?: string }) => api<Attachment[]>('/attachments?' + new URLSearchParams(by as Record<string, string>).toString())
export const shareDocument = (id: number, itemIds: string[]) => api<Attachment>(`/attachments/${id}/links`, { method: 'POST', body: { item_ids: itemIds } })
export const unlinkDocument = (id: number, itemId: string) => api(`/attachments/${id}/links/${itemId}`, { method: 'DELETE' })
export const deleteDocument = (id: number) => api(`/attachments/${id}`, { method: 'DELETE' })
export const fileUrl = (id: number, download = false) => `/api/attachments/${id}/file${download ? '?download=1' : ''}`
export const canPreview = (type: string) => type === 'application/pdf' || type.startsWith('image/')
export const sizeText = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
