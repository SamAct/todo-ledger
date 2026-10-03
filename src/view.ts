import { isOpen } from './item.ts'
import type { Item, Kind } from './item.ts'

export type Tab = 'agent' | 'human' | 'done'

export const TABS: { id: Tab; label: string; hotkey: string }[] = [
  { id: 'agent', label: 'Agent', hotkey: '1' },
  { id: 'human', label: 'Human', hotkey: '2' },
  { id: 'done', label: 'Done', hotkey: '3' },
]

// Tabs split by who started the item; the kind shows as a tag on the row instead.
export function tabOf(item: Item): Tab {
  if (!isOpen(item)) return 'done'
  return item.origin === 'agent' ? 'agent' : 'human'
}

// Pane tag per kind, drawn bold before the title; a plain todo has none.
export const KIND_TAGS: Record<Kind, { label: string; color?: string } | null> = {
  todo: null,
  deferred: { label: 'PARKED', color: 'warning' },
  proposal: { label: 'PROPOSAL', color: 'suggestion' },
  discussion: { label: '💬' },
}

export function kindTag(kind: Kind): string {
  if (kind === 'deferred') return '[parked] '
  if (kind === 'proposal') return '[proposal] '
  if (kind === 'discussion') return '💬 '
  return ''
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
  // Compact: it shares the footer row with the mode labels.
  return '☰ Todos ' + open.length + (fresh.length ? ' · ' + fresh.length + ' new' : '')
}

export function age(nowMs: number, iso: string): string {
  const s = Math.max(0, (nowMs - Date.parse(iso)) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  return Math.floor(s / 86400) + 'd'
}
