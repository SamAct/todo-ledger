export type Kind = 'todo' | 'deferred' | 'proposal' | 'discussion'
export type Origin = 'agent' | 'human'
export type Status = 'open' | 'in_progress' | 'done' | 'dropped'
export type Source = 'tool' | 'todowrite' | 'scan' | 'manual'

export interface Note { by: Origin; text: string; at: string }

export interface Item {
  id: string
  title: string
  body: string
  kind: Kind
  origin: Origin
  status: Status
  project: string
  sessionId: string
  source: Source
  createdAt: string
  updatedAt: string
  notes: Note[]
}

export interface NewItemFields {
  title: string
  kind: Kind
  origin: Origin
  source: Source
  project: string
  sessionId: string
  body?: string
  nowMs: number
  hex4: string
}

export const KINDS: Kind[] = ['todo', 'deferred', 'proposal', 'discussion']
const STATUSES: Status[] = ['open', 'in_progress', 'done', 'dropped']

const pad = (n: number) => String(n).padStart(2, '0')

export function newId(nowMs: number, hex4: string): string {
  const d = new Date(nowMs)
  const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  return `${date}-${time}-${hex4}`
}

export function randomHex4(): string {
  const b = new Uint8Array(2)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export function cleanTitle(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > 200 ? one.slice(0, 197) + '...' : one
}

export function dedupeKey(title: string, project: string): string {
  return cleanTitle(title).toLowerCase() + '|' + project.toLowerCase()
}

export function isOpen(item: Item): boolean {
  return item.status === 'open' || item.status === 'in_progress'
}

export function makeItem(f: NewItemFields): Item {
  const at = new Date(f.nowMs).toISOString()
  return {
    id: newId(f.nowMs, f.hex4),
    title: cleanTitle(f.title),
    body: f.body ?? '',
    kind: f.kind,
    origin: f.origin,
    status: 'open',
    project: f.project,
    sessionId: f.sessionId,
    source: f.source,
    createdAt: at,
    updatedAt: at,
    notes: [],
  }
}

export function parseItem(text: string): Item | null {
  let v: any
  try { v = JSON.parse(text) } catch { return null }
  if (!v || typeof v !== 'object') return null
  const strings = ['id', 'title', 'project', 'sessionId', 'createdAt', 'updatedAt']
  if (!strings.every((k) => typeof v[k] === 'string')) return null
  if (!KINDS.includes(v.kind) || !STATUSES.includes(v.status)) return null
  if (v.origin !== 'agent' && v.origin !== 'human') return null
  return { ...v, body: typeof v.body === 'string' ? v.body : '', notes: Array.isArray(v.notes) ? v.notes : [] }
}
