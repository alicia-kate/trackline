import { useSyncExternalStore } from 'react'
import { api, errorText } from './client'
import { loadItems } from './items'
import type { ActionKey, Category, ChangeRequest, Item } from '../types'

type Result = { error?: string; id?: string; queued?: boolean }

let reqs: ChangeRequest[] = []
const subs = new Set<() => void>()
const set = (n: ChangeRequest[]) => {
  reqs = n
  subs.forEach((f) => f())
}

export const useRequests = () => useSyncExternalStore((f: () => void) => (subs.add(f), () => subs.delete(f)), () => reqs)
export const loadRequests = async () => set(await api<ChangeRequest[]>('/requests'))
export const clearRequests = () => set([])

const refresh = () => Promise.all([loadItems(), loadRequests()]).catch(() => undefined)

// The server decides what happens: admins' changes apply at once; changes from inventory managers (when approval is on) and OIC/Users wait in Approvals.
async function write(path: string, method: string, body: unknown): Promise<Result> {
  try {
    const r = await api<{ id: string | null; queued: boolean }>(path, { method, body })
    await refresh()
    return { id: r.id ?? undefined, queued: r.queued }
  } catch (e) {
    return { error: errorText(e) }
  }
}

export const submitCreate = (c: Category, o: Partial<Item>, attachmentIds: number[] = []) => write('/items', 'POST', { category: c, fields: o, attachment_ids: attachmentIds })
export const submitUpdate = (id: string, o: Partial<Item>) => write(`/items/${id}`, 'PATCH', { fields: o })
export const submitAction = (id: string, a: ActionKey, d: Record<string, string>) => write(`/items/${id}/actions`, 'POST', { action: a, data: d })

export async function requestAccess(project: string, note: string): Promise<{ error?: string }> {
  try {
    await api('/requests/access', { method: 'POST', body: { project, note } })
    await loadRequests()
    return {}
  } catch (e) {
    return { error: errorText(e) }
  }
}

export async function decide(id: number, approve: boolean, note: string): Promise<{ error?: string }> {
  try {
    await api(`/requests/${id}/decide`, { method: 'POST', body: { approve, note } })
    await refresh()
    return {}
  } catch (e) {
    await refresh()
    return { error: errorText(e) }
  }
}
