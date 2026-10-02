import { formatList, parseTodoCommand, parseTodosArgs } from '../src/commands.ts'
import { cleanTitle, dedupeKey, isOpen, makeItem, parseItem, randomHex4 } from '../src/item.ts'
import type { Item, Kind, Origin, Source, Status } from '../src/item.ts'

// Every function below that takes $ must stay top-level in this file: the validator
// rejects passing $ into functions imported from other files.

let cache: Item[] = []
const reportedBad = new Set<string>()

async function itemsDir($: any): Promise<string> {
  const home = await $.env.get('USERPROFILE')
  return home + '\\.claude\\todo-ledger\\items'
}

async function loadAll($: any): Promise<Item[]> {
  const dir = await itemsDir($)
  if (!(await $.fs.exists(dir))) { cache = []; return cache }
  const entries = await $.fs.list(dir)
  const items: Item[] = []
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue
    const item = parseItem(await $.fs.read(dir + '\\' + entry.name))
    if (item) items.push(item)
    else if (!reportedBad.has(entry.name)) {
      reportedBad.add(entry.name)
      $.ui.log('skipped unreadable item file ' + entry.name)
    }
  }
  cache = items
  return items
}

async function saveItem($: any, item: Item): Promise<void> {
  // $.fs.write creates missing parent directories, so no separate mkdir step.
  const dir = await itemsDir($)
  const path = dir + '\\' + item.id + '.json'
  await $.fs.write(path + '.tmp', JSON.stringify(item, null, 2))
  const r = await $.process.run(['cmd', '/c', 'move', '/y', path + '.tmp', path])
  if (r.exitCode !== 0) throw new Error('could not save ' + item.id + ': ' + r.stderr.trim())
  cache = [...cache.filter((i) => i.id !== item.id), item]
  $.ui.invalidate('ui.render')
}

async function capture(
  $: any,
  f: { title: string; kind: Kind; origin: Origin; source: Source; body?: string },
): Promise<{ item: Item; isNew: boolean }> {
  const project = await $.session.cwd()
  const items = await loadAll($)
  const key = dedupeKey(f.title, project)
  const now = await $.clock.now()
  const at = new Date(now).toISOString()
  const existing = items.find((i) => isOpen(i) && dedupeKey(i.title, i.project) === key)
  if (existing) {
    const text = 'Captured again (' + f.source + ')' + (f.body ? ': ' + f.body : '')
    const updated = { ...existing, updatedAt: at, notes: [...existing.notes, { by: f.origin, text, at }] }
    await saveItem($, updated)
    return { item: updated, isNew: false }
  }
  const sessionId = await $.session.id()
  const item = makeItem({ ...f, title: cleanTitle(f.title), project, sessionId, nowMs: now, hex4: randomHex4() })
  await saveItem($, item)
  return { item, isNew: true }
}

async function setStatus($: any, id: string, status: Status, note?: string): Promise<Item | null> {
  const items = await loadAll($)
  const found = items.filter((i) => i.id.startsWith(id))
  if (found.length !== 1) return null
  const at = new Date(await $.clock.now()).toISOString()
  const notes = note ? [...found[0].notes, { by: 'agent' as Origin, text: note, at }] : found[0].notes
  const updated = { ...found[0], status, updatedAt: at, notes }
  await saveItem($, updated)
  return updated
}

async function togglePane($: any): Promise<void> {
  // Replaced in Task 8.
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'todos', description: 'Toggle the todo ledger pane', argumentHint: '[list [all]]', immediate: true })
    await $.command.register({ name: 'todo', description: 'Add or close a ledger item', argumentHint: 'add [-d|-p|-n] <text> | done <id>' })
    // Warm the cache; a failure here must not block the session or command registration.
    // The next loadAll (any command, tool or render) retries.
    try { await loadAll($) } catch { cache = [] }
    return next(e)
  })

  on('command.run', { command: 'todo' }, async ($, e) => {
    const cmd = parseTodoCommand(e.args)
    if (cmd.action === 'error') return { text: cmd.message }
    if (cmd.action === 'done') {
      const item = await setStatus($, cmd.idPrefix, 'done')
      return { text: item ? 'Done: ' + item.title : 'No single item matches id ' + cmd.idPrefix }
    }
    const r = await capture($, { title: cmd.text, kind: cmd.kind, origin: 'human', source: 'manual' })
    return { text: (r.isNew ? 'Added ' : 'Already listed, noted: ') + r.item.title }
  })

  on('command.run', { command: 'todos' }, async ($, e) => {
    const cmd = parseTodosArgs(e.args)
    if (cmd.action === 'list') return { text: formatList(await loadAll($), await $.session.cwd(), cmd.all) }
    await togglePane($)
    return {}
  })
}
