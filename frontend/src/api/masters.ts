import { useSyncExternalStore } from 'react'
import { api, errorText } from './client'
import type { MasterKind, Masters } from '../types'

let masters: Masters = { projects: [], vendors: [], locations: [], departments: [] }
const subs = new Set<() => void>()
const set = (m: Masters) => {
  masters = m
  subs.forEach((f) => f())
}

export const useMasters = () => useSyncExternalStore((f: () => void) => (subs.add(f), () => subs.delete(f)), () => masters)
export const loadMasters = async () => set(await api<Masters>('/masters'))
export const clearMasters = () => set({ projects: [], vendors: [], locations: [], departments: [] })

export async function saveMaster(kind: MasterKind, data: Record<string, string>, editing: string | null): Promise<{ error?: string }> {
  try {
    if (editing) await api(`/masters/${kind}`, { method: 'PATCH', body: { name: editing, data } })
    else await api(`/masters/${kind}`, { method: 'POST', body: { name: data.name, data } })
    await loadMasters()
    return {}
  } catch (e) {
    return { error: errorText(e) }
  }
}

export async function setMasterActive(kind: MasterKind, name: string, active: boolean): Promise<void> {
  try {
    await api(`/masters/${kind}`, { method: 'PATCH', body: { name, active } })
  } finally {
    await loadMasters().catch(() => undefined)
  }
}
