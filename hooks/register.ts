import { formatList, parseTodoCommand, parseTodosArgs } from '../src/commands.ts'
import { KINDS, cleanTitle, dedupeKey, isOpen, makeItem, parseItem, randomHex4 } from '../src/item.ts'
import type { Item, Kind, Origin, Source, Status } from '../src/item.ts'

// Every function below that takes $ must stay top-level in this file: the validator
// rejects passing $ into functions imported from other files.

let cache: Item[] = []
const reportedBad = new Set<string>()
let parkedThisTurn = false
const STATUS_VALUES = ['open', 'in_progress', 'done', 'dropped']

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

async function mirrorTodos($: any, todos: { content: string; status: string }[]): Promise<void> {
  const project = await $.session.cwd()
  const sessionId = await $.session.id()
  for (const todo of todos) {
    if (typeof todo?.content !== 'string' || !todo.content.trim()) continue
    const items = await loadAll($)
    const key = dedupeKey(todo.content, project)
    const mine = items.find((i) => i.source === 'todowrite' && i.sessionId === sessionId && dedupeKey(i.title, i.project) === key)
    const status: Status = todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'in_progress' : 'open'
    if (mine) {
      if (mine.status !== status && isOpen(mine)) {
        await saveItem($, { ...mine, status, updatedAt: new Date(await $.clock.now()).toISOString() })
      }
      continue
    }
    if (status === 'done') continue
    const r = await capture($, { title: todo.content, kind: 'todo', origin: 'agent', source: 'todowrite' })
    if (r.isNew && status !== 'open') await saveItem($, { ...r.item, status })
  }
}

async function togglePane($: any): Promise<void> {
  // Replaced in Task 8.
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'park_item',
      description:
        'Record an item in the user\'s global todo ledger. Call this, without asking first, whenever you ' +
        'defer, park, postpone or put something out of scope, or propose work the user has not asked for. ' +
        'kind: todo | deferred | proposal | discussion. Keep title to one line.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: ['todo', 'deferred', 'proposal', 'discussion'] },
          body: { type: 'string' },
        },
        required: ['title', 'kind'],
      },
    })
    await $.tool.register({
      name: 'list_items',
      description: 'List open items in the user\'s todo ledger. scope "project" (default) or "all".',
      inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['project', 'all'] } } },
    })
    await $.tool.register({
      name: 'update_item',
      description: 'Change a ledger item\'s status (open, in_progress, done, dropped) and/or add a note. id may be a unique prefix.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, status: { type: 'string', enum: STATUS_VALUES }, note: { type: 'string' } },
        required: ['id'],
      },
    })
    await $.command.register({ name: 'todos', description: 'Toggle the todo ledger pane', argumentHint: '[list [all]]', immediate: true })
    await $.command.register({ name: 'todo', description: 'Add or close a ledger item', argumentHint: 'add [-d|-p|-n] <text> | done <id>' })
    // Warm the cache; a failure here must not block the session or command registration.
    // The next loadAll (any command, tool or render) retries.
    try { await loadAll($) } catch { cache = [] }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    parkedThisTurn = false
    return next(e)
  })

  on('tool.call', { tool: 'mcp__todo-ledger__park_item' }, async ($, e) => {
    if (!KINDS.includes(e.kind)) return { result: 'Not saved: kind must be one of ' + KINDS.join(', ') }
    if (typeof e.title !== 'string' || !e.title.trim()) return { result: 'Not saved: title is required' }
    try {
      const r = await capture($, { title: e.title, kind: e.kind, origin: 'agent', source: 'tool', body: e.body })
      parkedThisTurn = true
      return { result: (r.isNew ? 'Parked ' : 'Already in ledger, added note to ') + r.item.id + ': ' + r.item.title }
    } catch (err: any) {
      $.ui.toast('Todo not saved: ' + err.message)
      return { result: 'Not saved: ' + err.message }
    }
  })

  on('tool.call', { tool: 'mcp__todo-ledger__list_items' }, async ($, e) => {
    return { result: formatList(await loadAll($), await $.session.cwd(), e.scope === 'all') }
  })

  on('tool.call', { tool: 'mcp__todo-ledger__update_item' }, async ($, e) => {
    const items = await loadAll($)
    const match = items.filter((i) => i.id.startsWith(e.id))
    if (match.length !== 1) return { result: 'No single item matches id ' + e.id }
    const status = STATUS_VALUES.includes(e.status) ? e.status : match[0].status
    const item = await setStatus($, match[0].id, status, e.note)
    return { result: 'Item ' + item!.id + ' is now ' + item!.status }
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const result = await next(e)
    try {
      await mirrorTodos($, Array.isArray(e.todos) ? e.todos : [])
    } catch (err: any) {
      $.ui.log('TodoWrite mirror failed: ' + err.message)
    }
    return result
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
