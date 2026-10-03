import { isOpen, sessionLabel } from './item.ts'
import type { Item, Kind } from './item.ts'

export type TodoCommand =
  | { action: 'add'; kind: Kind; text: string }
  | { action: 'done'; idPrefix: string }
  | { action: 'error'; message: string }

const FLAGS: Record<string, Kind> = { '-d': 'deferred', '-p': 'proposal', '-n': 'discussion' }
const USAGE = 'Usage: /todo add [-d|-p|-n] <text>  or  /todo done <id>'

export function parseTodoCommand(args: string): TodoCommand {
  const parts = args.trim().split(/\s+/).filter(Boolean)
  if (parts[0] === 'done' && parts[1]) return { action: 'done', idPrefix: parts[1] }
  if (parts[0] !== 'add') return { action: 'error', message: USAGE }
  let kind: Kind = 'todo'
  let rest = parts.slice(1)
  if (rest[0] && FLAGS[rest[0]]) { kind = FLAGS[rest[0]]; rest = rest.slice(1) }
  if (rest.length === 0) return { action: 'error', message: USAGE }
  return { action: 'add', kind, text: rest.join(' ') }
}

export function parseTodosArgs(args: string): { action: 'toggle' } | { action: 'refresh' } | { action: 'list'; all: boolean } {
  const parts = args.trim().split(/\s+/).filter(Boolean)
  if (parts[0] === 'list') return { action: 'list', all: parts[1] === 'all' }
  if (parts[0] === 'refresh') return { action: 'refresh' }
  return { action: 'toggle' }
}

export function formatList(items: Item[], project: string, all: boolean): string {
  const shown = items
    .filter(isOpen)
    .filter((i) => all || i.project.toLowerCase() === project.toLowerCase())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (shown.length === 0) return all ? 'No open ledger items.' : 'No open ledger items for this project.'
  return shown
    .map((i) => `- [${i.id}] (${i.kind}, ${i.origin}, ${i.status}) ${i.title}  · session ${sessionLabel(i)}` + (all ? `  · ${i.project}` : ''))
    .join('\n')
}

// One item in full, for the get_item tool: everything an agent needs to act on it.
export function formatItem(i: Item): string {
  const lines = [
    `[${i.id}] ${i.title}`,
    `kind: ${i.kind} · status: ${i.status} · started by: ${i.origin} (${i.source})`,
    `project: ${i.project}`,
    `session: ${sessionLabel(i)} (${i.sessionId})`,
    `created: ${i.createdAt} · updated: ${i.updatedAt}`,
  ]
  if (i.body) lines.push('', i.body)
  if (i.notes.length) lines.push('', 'Notes:', ...i.notes.map((n) => `- ${n.by === 'human' ? 'user' : 'agent'} (${n.at}): ${n.text}`))
  return lines.join('\n')
}
