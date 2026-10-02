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

// The full prompt never goes on a command line: Windows Terminal splits its own command line on ';'
// (even inside one argument) and a newline ends a cmd command line. The new session gets a short
// one-line task that points at a file holding the full prompt.
export function terminalTask(id: string, file: string): string {
  return `Work on todo-ledger item ${id}. Read the file ${file} and follow the instructions in it.`
}

function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, ' ')
}

// wt documents '\;' as the escape for a literal ';' in its arguments.
function wtEscape(s: string): string {
  return oneLine(s).replace(/;/g, '\\;')
}

export function terminalArgv(project: string, task: string): string[] {
  return ['wt', '-d', wtEscape(project), 'claude', wtEscape(task)]
}

// Fallback without Windows Terminal: `start` opens a new console in the project directory, where
// `cmd /k` runs claude. No '&&' element: the outer `cmd /c` would run what follows it itself.
export function fallbackArgv(project: string, task: string): string[] {
  return ['cmd', '/c', 'start', '', '/d', oneLine(project), 'cmd', '/k', 'claude', oneLine(task)]
}
