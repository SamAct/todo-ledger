import { formatList, parseTodoCommand, parseTodosArgs } from '../src/commands.ts'
import { SCAN_SYSTEM, buildScanPrompt, parseScanReply, shouldScan } from '../src/scan.ts'
import { KINDS, cleanTitle, dedupeKey, isOpen, makeItem, parseItem, randomHex4 } from '../src/item.ts'
import type { Item, Kind, Origin, Source, Status } from '../src/item.ts'
import { fallbackArgv, startOptions, startPrompt, terminalArgv, terminalTask } from '../src/start.ts'
import type { StartChoice } from '../src/start.ts'
import { KIND_TAGS, TABS, age, bandLabel, itemsForTab, tabOf } from '../src/view.ts'
import type { Tab } from '../src/view.ts'

// Every function below that takes $ must stay top-level in this file: the validator
// rejects passing $ into functions imported from other files.

let cache: Item[] = []
const reportedBad = new Set<string>()
let parkedThisTurn = false
const STATUS_VALUES = ['open', 'in_progress', 'done', 'dropped']

const PANE = 'todo-ledger'
let paneOpen = false
let tab: Tab = 'agent'
let allProjects = false
let expandedId: string | null = null
let notingId: string | null = null
let startingId: string | null = null
let lastSeenAt: string | null = null
let cwd = ''
let lastLoadAt = 0
const REFRESH_MS = 5000
// TodoWrite entries (by dedupe key) already linked to a ledger item in this session.
const linked = new Map<string, string>()

async function ledgerDir($: any): Promise<string> {
  const home = await $.env.get('USERPROFILE')
  if (!home) throw new Error('USERPROFILE is not set, so the ledger folder cannot be found')
  return home + '\\.claude\\todo-ledger'
}

async function itemsDir($: any): Promise<string> {
  return (await ledgerDir($)) + '\\items'
}

async function loadAll($: any): Promise<Item[]> {
  const dir = await itemsDir($)
  lastLoadAt = await $.clock.now()
  if (!(await $.fs.exists(dir))) { cache = []; return cache }
  const entries = await $.fs.list(dir)
  const items: Item[] = []
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue
    // A read can reject (over 4 MiB, permission, removed since the list); treat it like bad JSON.
    let text: string | null
    try { text = await $.fs.read(dir + '\\' + entry.name) } catch { text = null }
    const item = text === null ? null : parseItem(text)
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
  const dir = await itemsDir($)
  // Ids are second-resolution plus 4 hex chars and `move /y` overwrites, so check before the first write.
  let item = makeItem({ ...f, title: cleanTitle(f.title), project, sessionId, nowMs: now, hex4: randomHex4() })
  for (let tries = 0; tries < 5 && (await $.fs.exists(dir + '\\' + item.id + '.json')); tries++) {
    item = makeItem({ ...f, title: cleanTitle(f.title), project, sessionId, nowMs: now, hex4: randomHex4() })
  }
  await saveItem($, item)
  return { item, isNew: true }
}

async function refreshIfStale($: any): Promise<void> {
  try {
    if ((await $.clock.now()) - lastLoadAt >= REFRESH_MS) await loadAll($)
  } catch { /* keep the old cache; the next command or tool reports the error */ }
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
    const sameKey = (i: Item) => dedupeKey(i.title, i.project) === key
    // Link to this session's earlier mirror, else to any open item with the same key and project
    // (parked, scanned or manual), so repeated TodoWrite calls never add "Captured again" notes.
    const linkedId = linked.get(key)
    const mine =
      (linkedId ? items.find((i) => i.id === linkedId) : undefined) ??
      items.find((i) => i.source === 'todowrite' && i.sessionId === sessionId && sameKey(i)) ??
      items.find((i) => isOpen(i) && sameKey(i))
    const status: Status = todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'in_progress' : 'open'
    if (mine) {
      linked.set(key, mine.id)
      if (mine.status !== status && isOpen(mine)) {
        await saveItem($, { ...mine, status, updatedAt: new Date(await $.clock.now()).toISOString() })
      }
      continue
    }
    if (status === 'done') continue
    const r = await capture($, { title: todo.content, kind: 'todo', origin: 'agent', source: 'todowrite' })
    linked.set(key, r.item.id)
    if (r.isNew && status !== 'open') await saveItem($, { ...r.item, status })
  }
}

async function runScan($: any, answer: string): Promise<void> {
  try {
    const project = (await $.session.cwd()).toLowerCase()
    const known = (await loadAll($)).filter((i) => isOpen(i) && i.project.toLowerCase() === project).map((i) => i.title)
    const r = await $.model.complete({
      model: 'haiku',
      system: SCAN_SYSTEM,
      prompt: buildScanPrompt(answer, known),
      maxTokens: 400,
      timeoutMs: 20000,
    })
    if (!r.isAnswered) { $.ui.log('scan skipped: ' + r.reason); return }
    const found = parseScanReply(r.text)
    if (!found) { $.ui.log('scan skipped: reply was not JSON'); return }
    for (const f of found) await capture($, { title: f.title, kind: f.kind, origin: 'agent', source: 'scan' })
  } catch (err: any) {
    $.ui.log('scan skipped: ' + err.message)
  }
}

async function togglePane($: any): Promise<void> {
  if (paneOpen) {
    paneOpen = false
    await $.ui.close({ id: PANE })
    return
  }
  try { await loadAll($) } catch (err: any) { $.ui.toast('Ledger not loaded: ' + err.message) }
  lastSeenAt = new Date(await $.clock.now()).toISOString()
  try { await $.store.set('lastSeenAt', lastSeenAt) } catch { /* only affects the "new" count */ }
  const r = await $.ui.open({ id: PANE, title: 'Todos', focus: true, closeOnEscape: true })
  // Only a placed pane counts as open; otherwise the next press must try to open it again.
  paneOpen = r?.isPlaced === true
  if (!paneOpen) $.ui.toast('Could not open the todo pane: ' + (r?.reason ?? 'unknown reason'))
  $.ui.invalidate('ui.render')
}

async function safeToggle($: any): Promise<void> {
  try { await togglePane($) } catch (err: any) { $.ui.toast('Todo pane failed: ' + err.message) }
}

async function markStatus($: any, id: string, status: Status): Promise<void> {
  try { await setStatus($, id, status) } catch (err: any) { $.ui.toast('Todo not saved: ' + err.message) }
}

async function addNote($: any, id: string, text: string): Promise<void> {
  const item = cache.find((i) => i.id === id)
  if (!item || !text.trim()) return
  const at = new Date(await $.clock.now()).toISOString()
  try {
    await saveItem($, { ...item, updatedAt: at, notes: [...item.notes, { by: 'human' as Origin, text: text.trim(), at }] })
  } catch (err: any) {
    $.ui.toast('Note not saved: ' + err.message)
  }
}

async function copyText($: any, text: string, okMessage: string, failPrefix: string): Promise<void> {
  const r = await $.ui.copy({ text })
  $.ui.toast(r?.isCopied ? okMessage : failPrefix + ' (' + (r?.reason ?? 'unknown') + ')')
}

async function doStart($: any, item: Item, choice: StartChoice): Promise<void> {
  const text = startPrompt(item, cwd || (await $.session.cwd()))
  try {
    if (choice === 'send') {
      await saveItem($, { ...item, status: 'in_progress', updatedAt: new Date(await $.clock.now()).toISOString() })
      let dropped: string | null = null
      try {
        const r = await $.prompt.submit({ text, asUser: true })
        if (r && typeof r.drop === 'string') dropped = r.drop
      } catch (err: any) { dropped = err.message }
      if (dropped !== null) {
        await saveItem($, { ...item, updatedAt: new Date(await $.clock.now()).toISOString() })
        $.ui.toast('Prompt not sent: ' + dropped)
      }
    } else if (choice === 'draft') {
      const r = await $.prompt.fill({ text })
      if (!r.isFilled) await copyText($, text, 'Could not fill the prompt; copied instead', 'Could not fill or copy the prompt')
    } else if (choice === 'copy') {
      await copyText($, text, 'Prompt copied', 'Prompt not copied')
    } else {
      // The full prompt goes in a file; the command line carries a one-line pointer to it.
      const file = (await ledgerDir($)) + '\\start\\' + item.id + '.md'
      await $.fs.write(file, text)
      const task = terminalTask(item.id, file)
      let ok = false
      try { ok = (await $.process.run(terminalArgv(item.project, task))).exitCode === 0 } catch { ok = false }
      if (!ok) {
        try { ok = (await $.process.run(fallbackArgv(item.project, task))).exitCode === 0 } catch { ok = false }
      }
      if (!ok) await copyText($, text, 'Could not open a terminal; prompt copied instead', 'Could not open a terminal or copy the prompt')
    }
  } catch (err: any) {
    $.ui.toast('Start failed: ' + err.message)
  }
}

function startChooser($: any, e: any, item: Item) {
  const { Box, Button, Select } = $.ui.resolve(e)
  return Box({
    flexDirection: 'row',
    columnGap: 1,
    children: [
      Select({
        key: 'start-choice-' + item.id,
        label: 'Start',
        options: startOptions(e.surface === 'desktop' ? 'desktop' : 'terminal'),
        autoFocus: true,
        onSelect: async (v: string) => {
          startingId = null
          await doStart($, item, v as StartChoice)
          $.ui.invalidate('ui.render')
        },
      }),
      Button({ key: 'start-cancel-' + item.id, label: 'Cancel', onPress: () => { startingId = null; $.ui.invalidate('ui.render') } }),
    ],
  })
}

async function runTodo($: any, args: string): Promise<{ text: string }> {
  const cmd = parseTodoCommand(args)
  if (cmd.action === 'error') return { text: cmd.message }
  try {
    if (cmd.action === 'done') {
      const item = await setStatus($, cmd.idPrefix, 'done')
      return { text: item ? 'Done: ' + item.title : 'No single item matches id ' + cmd.idPrefix }
    }
    const r = await capture($, { title: cmd.text, kind: cmd.kind, origin: 'human', source: 'manual' })
    return { text: (r.isNew ? 'Added ' : 'Already listed, noted: ') + r.item.title }
  } catch (err: any) {
    $.ui.toast('Todo not saved: ' + err.message)
    return { text: 'Not saved: ' + err.message }
  }
}

async function runTodos($: any, args: string): Promise<{ text?: string }> {
  const cmd = parseTodosArgs(args)
  if (cmd.action === 'list') {
    try { return { text: formatList(await loadAll($), await $.session.cwd(), cmd.all) } }
    catch (err: any) { return { text: 'Not loaded: ' + err.message } }
  }
  await safeToggle($)
  return {}
}

// Registers a command under its preferred name, or under the fallback name if that one is refused.
async function registerCommand($: any, spec: any, fallback: string): Promise<void> {
  try {
    await $.command.register(spec)
  } catch (err: any) {
    $.ui.log('/' + spec.name + ' not registered (' + err.message + '); using /' + fallback)
    try { await $.command.register({ ...spec, name: fallback }) }
    catch (err2: any) { $.ui.log('/' + fallback + ' not registered either: ' + err2.message) }
  }
}

async function registerTool($: any, spec: any): Promise<void> {
  try { await $.tool.register(spec) } catch (err: any) { $.ui.log('tool ' + spec.name + ' not registered: ' + err.message) }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    try {
      cwd = await $.session.cwd()
      const seen = await $.store.get('lastSeenAt')
      lastSeenAt = typeof seen === 'string' ? seen : null
    } catch { lastSeenAt = null }
    await registerTool($, {
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
    await registerTool($, {
      name: 'list_items',
      description: 'List open items in the user\'s todo ledger. scope "project" (default) or "all".',
      inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['project', 'all'] } } },
    })
    await registerTool($, {
      name: 'update_item',
      description: 'Change a ledger item\'s status (open, in_progress, done, dropped) and/or add a note. id may be a unique prefix.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, status: { type: 'string', enum: STATUS_VALUES }, note: { type: 'string' } },
        required: ['id'],
      },
    })
    await registerCommand($, { name: 'todos', description: 'Toggle the todo ledger pane', argumentHint: '[list [all]]', immediate: true }, 'ledger')
    await registerCommand($, { name: 'todo', description: 'Add or close a ledger item', argumentHint: 'add [-d|-p|-n] <text> | done <id>' }, 'ledger-add')
    // Warm the cache; a failure here must not block the session.
    // The next loadAll (any command, tool or render) retries.
    try { await loadAll($) } catch { cache = [] }
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) paneOpen = false
    return next(e)
  })

  // The button lives in the prompt footer (the row with the permission-mode label),
  // on the same line as the engine's own mode labels.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const theirs = await next(e)
    await refreshIfStale($)
    const label = bandLabel(cache, lastSeenAt)
    if (!label) return theirs
    const { Box, Button } = $.ui.resolve(e)
    const mine = Button({ key: 'ledger-toggle', label, plain: true, onPress: () => safeToggle($) })
    return Box({ key: 'ledger-footer', flexDirection: 'row', columnGap: 2, alignItems: 'center',
      children: theirs ? [mine, theirs] : [mine] })
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    // Mobile's element table has no Input or Select.
    const canInput = e.surface !== 'mobile'
    const redraw = () => $.ui.invalidate('ui.render')
    const now = await $.clock.now()
    await refreshIfStale($)
    // Read the cwd per render so the filter follows /cd and matches what capture stores.
    let here = cwd
    try { here = await $.session.cwd() } catch { /* keep the session.start value */ }
    const rows = itemsForTab(cache, tab, allProjects ? null : here)

    const scoped = cache.filter((i) => allProjects || i.project.toLowerCase() === here.toLowerCase())
    const count = (t: Tab) => scoped.filter((i) => tabOf(i) === t).length
    const isDesktop = e.surface === 'desktop'
    const ruleWidth = Math.max(10, Math.min(e.props.bodyColumns ?? 40, 60))
    const rule = () => Text({ dimColor: true, children: ['─'.repeat(ruleWidth)] })

    // Header: tabs with open counts on the left, the scope toggle on the right.
    const header = Box({
      flexDirection: 'row',
      justifyContent: 'space-between',
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 3,
          children: TABS.map((t) =>
            Button({ key: 'tab-' + t.id, plain: true, hotkey: t.hotkey, dimColor: tab !== t.id,
              label: t.id === 'done' ? t.label : t.label + ' ' + count(t.id),
              onPress: () => { tab = t.id; startingId = null; notingId = null; redraw() } })),
        }),
        Button({ key: 'scope', plain: true, hotkey: 'p', dimColor: true,
          label: (allProjects ? 'All projects' : 'This project') + ' ⇄',
          onPress: () => { allProjects = !allProjects; redraw() } }),
      ],
    })

    const actionsFor = (i: Item) => {
      if (startingId === i.id) return [startChooser($, e, i)]
      if (notingId === i.id && canInput) {
        return [Input({ key: 'note-input-' + i.id, label: 'Note', value: '', submitLabel: 'save', autoFocus: true,
          onSubmit: async (v: string) => { notingId = null; await addNote($, i.id, v); redraw() } })]
      }
      if (tab === 'done') return [Button({ key: 'reopen-' + i.id, label: 'Reopen', onPress: () => markStatus($, i.id, 'open') })]
      return [
        Button({ key: 'start-' + i.id, label: 'Start', variant: 'primary', onPress: () => { startingId = i.id; redraw() } }),
        Button({ key: 'done-' + i.id, label: 'Done', onPress: () => markStatus($, i.id, 'done') }),
        Button({ key: 'drop-' + i.id, label: 'Drop', onPress: () => markStatus($, i.id, 'dropped') }),
        ...(canInput ? [Button({ key: 'note-' + i.id, label: 'Note', onPress: () => { notingId = i.id; redraw() } })] : []),
      ]
    }

    // One card per item: tag + title, then a dim meta line with the actions.
    // Desktop reveals the actions on hover; the terminal has no pointer, so it
    // shows them for the selected row (press the title, or Tab to it + Enter).
    const itemCard = (i: Item) => {
      const selected = expandedId === i.id
      const busy = startingId === i.id || notingId === i.id
      const tag = KIND_TAGS[i.kind]
      const meta = [i.project.split('\\').filter(Boolean).pop(), age(now, i.createdAt)].filter(Boolean).join(' · ')
      const actionsBox = isDesktop && !selected && !busy
        // No key here: a keyed Box would start its own hover scope, and a hidden
        // one can never be hovered. Unkeyed, it lights with the keyed row above it.
        ? Box({ flexDirection: 'row', columnGap: 1, display: 'none', hover: { display: 'flex' }, children: actionsFor(i) })
        : selected || busy || isDesktop
          ? Box({ flexDirection: 'row', columnGap: 1, children: actionsFor(i) })
          : null
      const detail = selected ? [i.body, ...i.notes.map((n) => (n.by === 'human' ? 'You' : 'Claude') + ': ' + n.text)].filter(Boolean) : []
      return Box({
        key: 'row-' + i.id,
        flexDirection: 'column',
        marginBottom: 1,
        children: [
          Box({
            flexDirection: 'row',
            columnGap: 1,
            children: [
              ...(tag ? [Text({ bold: true, color: tag.color, children: [tag.label] })] : []),
              Button({ key: 'title-' + i.id, plain: true, label: i.title,
                onPress: () => { expandedId = selected ? null : i.id; startingId = null; notingId = null; redraw() } }),
            ],
          }),
          Box({
            flexDirection: 'row',
            columnGap: 2,
            paddingLeft: 2,
            children: [Text({ dimColor: true, children: [meta] }), ...(actionsBox ? [actionsBox] : [])],
          }),
          ...detail.map((d) => Text({ dimColor: true, wrap: 'wrap', children: ['    ' + d] })),
        ],
      })
    }

    const empty = Text({ dimColor: true, wrap: 'wrap', children: [
      tab === 'done' ? 'Nothing closed yet.' : 'Nothing open. Claude adds deferred work and proposals here; add your own with /todo add <text>.',
    ] })

    return Box({
      flexDirection: 'column',
      children: [
        header,
        rule(),
        ...(rows.length ? rows.map(itemCard) : [empty]),
        rule(),
        Text({ dimColor: true, children: [(isDesktop ? 'Hover or click a row for actions' : 'Select a title for actions') + ' · /todo add <text> to add'] }),
      ],
    })
  })

  on('turn.start', async ($, e, next) => {
    parkedThisTurn = false
    // Other sessions may have written items; the next render reloads.
    lastLoadAt = 0
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Subagent turns and non-answer turns are not scanned.
    if (e.agentId === undefined && e.reason === 'answer' && shouldScan(e.answer, parkedThisTurn)) {
      const answer = e.answer
      $.clock.after(0, () => runScan($, answer))
    }
    return result
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
    try { return { result: formatList(await loadAll($), await $.session.cwd(), e.scope === 'all') } }
    catch (err: any) { return { result: 'Not loaded: ' + err.message } }
  })

  on('tool.call', { tool: 'mcp__todo-ledger__update_item' }, async ($, e) => {
    try {
      const items = await loadAll($)
      const match = items.filter((i) => typeof e.id === 'string' && i.id.startsWith(e.id))
      if (match.length !== 1) return { result: 'No single item matches id ' + e.id }
      const status = STATUS_VALUES.includes(e.status) ? e.status : match[0].status
      const item = await setStatus($, match[0].id, status, e.note)
      if (!item) return { result: 'No single item matches id ' + e.id }
      return { result: 'Item ' + item.id + ' is now ' + item.status }
    } catch (err: any) {
      $.ui.toast('Todo not saved: ' + err.message)
      return { result: 'Not saved: ' + err.message }
    }
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

  on('command.run', { command: 'todo' }, async ($, e) => runTodo($, e.args))
  on('command.run', { command: 'todos' }, async ($, e) => runTodos($, e.args))
  // Fallback names, used only when /todo or /todos could not be registered.
  on('command.run', { command: 'ledger-add' }, async ($, e) => runTodo($, e.args))
  on('command.run', { command: 'ledger' }, async ($, e) => runTodos($, e.args))
}

