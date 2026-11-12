import { useSyncExternalStore } from 'react'
import { api } from './client'
import type { Item } from '../types'

// A copy of the server's items, kept here so pages can read them instantly. The server is the source of truth.
let items: Item[] = []
const subs = new Set<() => void>()
const set = (n: Item[]) => {
  items = n
  subs.forEach((f) => f())
}

export const useItems = () => useSyncExternalStore((f: () => void) => (subs.add(f), () => subs.delete(f)), () => items)
export const getItem = (id: string) => items.find((x) => x.id === id)
export const loadItems = async () => set(await api<Item[]>('/items'))
export const clearItems = () => set([])
