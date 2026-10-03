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
  // The session's name as its tab shows it (/rename), when it had one at capture.
  sessionName?: string
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
  sessionName?: string
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
    ...(f.sessionName ? { sessionName: f.sessionName } : {}),
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

// Cut text to at most `max` characters, ending in an ellipsis when cut.
export function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)) + '…'
}

// How the pane names the session an item came from: its name, else the id's first block.
export function sessionLabel(item: Item): string {
  return item.sessionName?.trim() || item.sessionId.split('-')[0]
}

// The newest session name in transcript lines (`{"type":"custom-title","customTitle":...}`).
export function lastSessionTitle(lines: string): string | null {
  let found: string | null = null
  for (const line of lines.split(/\r?\n/)) {
    if (!line.includes('"custom-title"')) continue
    try {
      const v = JSON.parse(line)
      if (v?.type === 'custom-title' && typeof v.customTitle === 'string' && v.customTitle.trim()) found = v.customTitle.trim()
    } catch { /* a partial line; skip it */ }
  }
  return found
}
// Words that carry no meaning for "is this the same item": articles, joiners and
// the verbs titles start with ("add", "implement", "build"...).
const STOP = new Set(['the', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'from', 'with', 'by', 'at', 'as', 'is', 'are',
  'be', 'it', 'its', 'this', 'that', 'into', 'per', 'via', 'then', 'add', 'implement', 'build', 'make', 'create', 'support',
  'handle', 'extract', 'display', 'show', 'use'])

function titleWords(s: string): Set<string> {
  const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
  return new Set(words)
}

// Two titles name the same item when at least 70% of the shorter one's meaningful
// words appear in the other. Titles under 3 meaningful words never match this way
// ("Fix login" / "Fix logout"); exact duplicates are caught by dedupeKey instead.
export function similarTitle(a: string, b: string): boolean {
  const A = titleWords(a)
  const B = titleWords(b)
  const small = Math.min(A.size, B.size)
  if (small < 3) return false
  let shared = 0
  for (const w of A) if (B.has(w)) shared++
  return shared / small >= 0.7
}
