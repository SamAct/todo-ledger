import type { Item } from './item.ts'

export type StartChoice = 'send' | 'draft' | 'terminal' | 'copy'

export function startOptions(surface: 'terminal' | 'desktop'): { value: StartChoice; label: string }[] {
  const common: { value: StartChoice; label: string }[] = [
    { value: 'send', label: 'Send now' },
    { value: 'draft', label: 'Draft into prompt' },
  ]
  return surface === 'terminal'
    ? [...common, { value: 'terminal', label: 'New terminal session' }]
    : [...common, { value: 'copy', label: 'Copy prompt' }]
}

export function startPrompt(item: Item, cwd: string): string {
  const lines = [
    `Work on this ledger item (id ${item.id}, ${item.kind}, from project ${item.project}):`,
    item.title,
  ]
  if (item.body) lines.push(item.body)
  if (item.notes.length) lines.push('Notes:', ...item.notes.map((n) => `- ${n.by}: ${n.text}`))
  if (item.project.toLowerCase() !== cwd.toLowerCase()) {
    lines.push(`Note: this item came from a different project (${item.project}); this session is in ${cwd}.`)
  }
  lines.push(`When finished, call update_item with id ${item.id} and status done.`)
  return lines.join('\n')
}

export function terminalArgv(project: string, prompt: string): string[] {
  return ['wt', '-d', project, 'claude', prompt]
}
