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

// Groups inside an open tab, ordered by what the item needs from the person:
// a decision first, then work, then talk, then what was put off.
export const GROUPS: { kind: Kind; label: string; mark: string; color?: string }[] = [
  { kind: 'proposal', label: 'Needs decision', mark: '◆', color: 'suggestion' },
  { kind: 'todo', label: 'To do', mark: '•' },
  { kind: 'discussion', label: 'Discussion', mark: '◇' },
  { kind: 'deferred', label: 'Parked', mark: '◇', color: 'warning' },
]

export function groupItems(items: Item[]): { kind: Kind; label: string; mark: string; color?: string; items: Item[] }[] {
  return GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.kind === g.kind) })).filter((g) => g.items.length > 0)
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

const inProject = (i: Item, project: string | null) => project === null || i.project.toLowerCase() === project.toLowerCase()

// The footer button. It counts what the pane first shows (this project's open
// items) and is always drawn, so the pane (Done tab included) stays reachable.
export function bandLabel(items: Item[], lastSeenAt: string | null, project: string | null = null): string {
  const open = items.filter((i) => isOpen(i) && inProject(i, project))
  const fresh = open.filter((i) => isNew(i, lastSeenAt))
  // Compact: it shares the footer row with the mode labels.
  return '☰ Todos' + (open.length ? ' ' + open.length : '') + (fresh.length ? ' · ' + fresh.length + ' new' : '')
}

// An agent item added since the person last opened the pane.
export function isNew(item: Item, lastSeenAt: string | null): boolean {
  return isOpen(item) && item.origin === 'agent' && (lastSeenAt === null || item.createdAt > lastSeenAt)
}

// Where the pane opens: this project unless it has nothing open while others do,
// and the open tab with items (Agent first) rather than an empty one.
export function firstView(items: Item[], project: string, tab: Tab, allProjects: boolean): { tab: Tab; allProjects: boolean } {
  const open = items.filter(isOpen)
  const all = allProjects || (!open.some((i) => inProject(i, project)) && open.length > 0)
  const scoped = open.filter((i) => all || inProject(i, project))
  const has = (t: Tab) => scoped.some((i) => tabOf(i) === t)
  if (tab !== 'done' && has(tab)) return { tab, allProjects: all }
  return { tab: has('agent') ? 'agent' : has('human') ? 'human' : tab, allProjects: all }
}

// The list in the order the pane draws it: groups in GROUPS order inside an open tab.
export function displayOrder(rows: Item[], tab: Tab): Item[] {
  return tab === 'done' ? rows : groupItems(rows).flatMap((g) => g.items)
}

export function age(nowMs: number, iso: string): string {
  const s = Math.max(0, (nowMs - Date.parse(iso)) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  return Math.floor(s / 86400) + 'd'
}
