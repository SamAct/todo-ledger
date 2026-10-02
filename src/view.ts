import { isOpen } from './item.ts'
import type { Item } from './item.ts'

export type Tab = 'agent' | 'human' | 'parked' | 'proposals' | 'done'

export const TABS: { id: Tab; label: string; hotkey: string }[] = [
  { id: 'agent', label: 'Agent', hotkey: '1' },
  { id: 'human', label: 'Human', hotkey: '2' },
  { id: 'parked', label: 'Parked', hotkey: '3' },
  { id: 'proposals', label: 'Proposals', hotkey: '4' },
  { id: 'done', label: 'Done', hotkey: '5' },
]

export function tabOf(item: Item): Tab {
  if (!isOpen(item)) return 'done'
  if (item.kind === 'deferred') return 'parked'
  if (item.kind === 'proposal') return 'proposals'
  return item.origin === 'agent' ? 'agent' : 'human'
}

export function itemsForTab(items: Item[], tab: Tab, project: string | null): Item[] {
  const p = project?.toLowerCase() ?? null
  const sortKey = (i: Item) => (tab === 'done' ? i.updatedAt : i.createdAt)
  return items
    .filter((i) => tabOf(i) === tab)
    .filter((i) => p === null || i.project.toLowerCase() === p)
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
    .slice(0, tab === 'done' ? 50 : 100)
}

export function bandLabel(items: Item[], lastSeenAt: string | null): string | null {
  const open = items.filter(isOpen)
  const fresh = open.filter((i) => i.origin === 'agent' && (lastSeenAt === null || i.createdAt > lastSeenAt))
  if (open.length === 0) return null
  return '☰ Todos  ' + open.length + ' open' + (fresh.length ? ' · ' + fresh.length + ' new' : '')
}

export function age(nowMs: number, iso: string): string {
  const s = Math.max(0, (nowMs - Date.parse(iso)) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  return Math.floor(s / 86400) + 'd'
}
