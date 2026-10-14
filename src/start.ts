import type { Item } from './item.ts'

export type StartChoice = 'send' | 'draft' | 'terminal' | 'copy'

export interface StartOption { value: StartChoice; label: string; hotkey: string }

// The ways to start an item, drawn as one button each (one press, no picker).
// The first is the main one. Terminals can open a new window; the desktop copies instead.
export function startOptions(surface: 'terminal' | 'desktop'): StartOption[] {
  const common: StartOption[] = [
    { value: 'send', label: 'Send', hotkey: 's' },
    { value: 'draft', label: 'Draft', hotkey: 'd' },
  ]
  return surface === 'terminal'
    ? [...common, { value: 'terminal', label: 'Terminal', hotkey: 't' }]
    : [...common, { value: 'copy', label: 'Copy', hotkey: 'c' }]
}

// One prompt for several queued items. It hands the agent every detail and leaves the
// method (order, one by one or in parallel with subagents) to the agent.
export function batchPrompt(items: Item[], cwd: string): string {
  const lines = [
    `Work on these ${items.length} ledger items. Read them all first, then decide the best way to do them:`,
    'the order, and whether to work them one after another or in parallel with subagents (parallel only',
    'when they touch different files). Say your plan in a few lines, then carry it out. Ask me only when',
    'something is truly ambiguous or needs my decision; otherwise proceed.',
  ]
  items.forEach((item, k) => {
    lines.push('', `Item ${k + 1} of ${items.length} (id ${item.id}, ${item.kind}, project ${item.project}):`, item.title)
    if (item.body) lines.push(item.body)
    if (item.notes.length) lines.push('Notes:', ...item.notes.map((n) => `- ${n.by}: ${n.text}`))
    if (item.project.toLowerCase() !== cwd.toLowerCase()) {
      lines.push(`Note: this item came from a different project (${item.project}); this session is in ${cwd}.`)
    }
  })
  lines.push('', 'When you finish an item, call update_item with its id and status done. If you cannot finish one,',
    'call update_item with its id and a note saying what is left.')
  return lines.join('\n')
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
