import { formatItem, formatList, parseTodoCommand, parseTodosArgs } from '../src/commands.ts'
import { SCAN_SYSTEM, buildScanPrompt, parseScanReply, parseScanUpdates, shouldScan } from '../src/scan.ts'
import type { ScanUpdate } from '../src/scan.ts'
import { KINDS, cleanTitle, clip, dedupeKey, wrapLines, isOpen, lastSessionTitle, makeItem, parseItem, randomHex4, sessionLabel, similarTitle } from '../src/item.ts'
import type { Item, Kind, Origin, Source, Status } from '../src/item.ts'
import { fallbackArgv, startOptions, startPrompt, terminalArgv, terminalTask } from '../src/start.ts'
import type { StartChoice } from '../src/start.ts'
import { TABS, age, bandLabel, displayOrder, firstView, groupItems, isNew, itemsForTab, tabOf } from '../src/view.ts'
import type { Tab } from '../src/view.ts'

// Every function below that takes $ must stay top-level in this file: the validator
// rejects passing $ into functions imported from other files.

let cache: Item[] = []
const reportedBad = new Set<string>()
let parkedThisTurn = false
// True while the main loop is answering; a prompt sent then waits for the reply to end.
let replying = false
let lastUserText = ''
let deletingId: string | null = null
const STATUS_VALUES = ['open', 'in_progress', 'done', 'dropped']

const PANE = 'todo-ledger'
// The dock width asked for on open; a width the person dragged wins (the engine has no minimum).
const PANE_COLUMNS = 50
let paneOpen = false
let tab: Tab = 'agent'
let allProjects = false
let expandedId: string | null = null
let notingId: string | null = null
let startingId: string | null = null
let lastSeenAt: string | null = null
// The visit before this one: rows newer than it carry a "new" mark while the pane is open.
let prevSeenAt: string | null = null
let allNotesId: string | null = null
let cwd = ''
// One accent colour for what needs attention (the open card, marks, "new",
// started items); everything else is hierarchy by weight, dimming and spacing.
// A theme key, so light and dark themes both fit.
const ACCENT = 'suggestion'
// Faint tints for a row's project, session and age.
const META = { project: '#5b8fd9', session: '#a57fd6', age: '#4fa88a' }
const CLOSED_MEMORY_MS = 30 * 86_400_000
let lastLoadAt = 0
const REFRESH_MS = 5000
const SYNC_MS = 10_000
let folderSig = ''
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
  folderSig = signatureOf(entries)
  return items
}

// What the items folder looks like on disk: changes when any session adds,
// edits (size or mtime) or removes an item file.
function signatureOf(entries: { name: string; size?: number; mtimeMs?: number }[]): string {
  return entries
    .filter((x) => x.name.endsWith('.json'))
    .map((x) => x.name + ':' + (x.size ?? 0) + ':' + (x.mtimeMs ?? 0))
    .sort()
    .join('|')
}

// Background check: one directory listing; reload and redraw only when another
// session (CLI or desktop) changed the folder since our last load.
async function syncIfChanged($: any): Promise<void> {
  try {
    const dir = await itemsDir($)
    const entries = (await $.fs.exists(dir)) ? await $.fs.list(dir) : []
    if (signatureOf(entries) === folderSig) return
    await loadAll($)
    $.ui.invalidate('ui.render')
  } catch { /* a failed check waits for the next tick */ }
}

// The pane's Refresh button and `/todos refresh`.
async function forceRefresh($: any): Promise<number> {
  await loadAll($)
  $.ui.invalidate('ui.render')
  return cache.length
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

// The session's name (its tab title). The mods API has no call for it, so it is
// read from the transcript's `custom-title` lines; null for an unnamed session.
let sessionName: string | null = null
let transcriptPath: string | null = null

async function lookupSessionName($: any): Promise<string | null> {
  try {
    if (!transcriptPath) {
      const id = await $.session.id()
      const home = await $.env.get('USERPROFILE')
      if (!home) return sessionName
      const found = await $.process.run(['cmd', '/c', 'dir', '/s', '/b', home + '\\.claude\\projects\\' + id + '.jsonl'])
      const first = found.exitCode === 0 ? found.stdout.split(/\r?\n/).find((l: string) => l.trim()) : undefined
      if (!first) return sessionName
      transcriptPath = first.trim()
    }
    // findstr prints only lines that begin with a title record, so a large
    // transcript is never read whole (`.` matches the quotes in the regex).
    const r = await $.process.run(['findstr', '/r', '/b', '/c:{.type.:.custom-title.', transcriptPath])
    sessionName = lastSessionTitle(r.stdout) ?? sessionName
  } catch { /* keep the last known name */ }
  return sessionName
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
  // Same item when the title matches exactly, or is a rewording of an open item in this project.
  const existing = items.find((i) => isOpen(i) && dedupeKey(i.title, i.project) === key) ??
    items.find((i) => isOpen(i) && i.project.toLowerCase() === project.toLowerCase() && similarTitle(i.title, f.title))
  if (existing) {
    // The scan re-reading a known item says nothing new; a note per turn was only noise.
    if (f.source === 'scan' || f.source === 'todowrite') return { item: existing, isNew: false }
    const reworded = dedupeKey(existing.title, existing.project) !== key ? ' as "' + cleanTitle(f.title) + '"' : ''
    const text = 'Captured again (' + f.source + ')' + reworded + (f.body ? ': ' + f.body : '')
    if (existing.notes.at(-1)?.text === text) return { item: existing, isNew: false }
    const updated = { ...existing, updatedAt: at, notes: [...existing.notes, { by: f.origin, text, at }] }
    await saveItem($, updated)
    return { item: updated, isNew: false }
  }
  // The scan must not bring back what was just finished or turned down when a
  // later reply mentions it again; a person or an agent asking on purpose still can.
  if (f.source === 'scan') {
    const closed = items.find((i) => !isOpen(i) && i.project.toLowerCase() === project.toLowerCase() &&
      now - Date.parse(i.updatedAt) < CLOSED_MEMORY_MS && (dedupeKey(i.title, i.project) === key || similarTitle(i.title, f.title)))
    if (closed) return { item: closed, isNew: false }
  }
  const sessionId = await $.session.id()
  const name = sessionName ?? (await lookupSessionName($))
  const dir = await itemsDir($)
  // Ids are second-resolution plus 4 hex chars and `move /y` overwrites, so check before the first write.
  let item = makeItem({ ...f, title: cleanTitle(f.title), project, sessionId, sessionName: name ?? undefined, nowMs: now, hex4: randomHex4() })
  for (let tries = 0; tries < 5 && (await $.fs.exists(dir + '\\' + item.id + '.json')); tries++) {
    item = makeItem({ ...f, title: cleanTitle(f.title), project, sessionId, sessionName: name ?? undefined, nowMs: now, hex4: randomHex4() })
  }
  await saveItem($, item)
  return { item, isNew: true }
}

// Called while drawing: one folder listing at most every few seconds, and a full
// reload only when the folder changed (reading every item file per draw was slow).
async function refreshIfStale($: any): Promise<void> {
  try {
    const now = await $.clock.now()
    if (now - lastLoadAt < REFRESH_MS) return
    lastLoadAt = now
    await syncIfChanged($)
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
  // TodoWrite sends the whole list each time: an entry it no longer carries was
  // removed from the session's plan, so its mirror is dropped rather than left open forever.
  const keep = new Set(todos.filter((t) => typeof t?.content === 'string').map((t) => dedupeKey(t.content, project)))
  const at = new Date(await $.clock.now()).toISOString()
  for (const i of await loadAll($)) {
    if (i.source !== 'todowrite' || i.sessionId !== sessionId || !isOpen(i) || keep.has(dedupeKey(i.title, i.project))) continue
    await saveItem($, { ...i, status: 'dropped', updatedAt: at, notes: [...i.notes, { by: 'agent' as Origin, text: 'removed from the session\'s task list', at }] })
  }
}

// What the scan concluded about an open item, applied with a note saying why.
async function applyUpdate($: any, item: Item, u: ScanUpdate): Promise<void> {
  const at = new Date(await $.clock.now()).toISOString()
  const note = (text: string) => [...item.notes, { by: 'agent' as Origin, text, at }]
  if (u.action === 'approve') {
    await saveItem($, { ...item, kind: item.kind === 'proposal' ? 'todo' : item.kind, updatedAt: at, notes: note('approved by the user (seen by the end-of-turn scan)') })
  } else if (u.action === 'reject') {
    await saveItem($, { ...item, status: 'dropped', updatedAt: at, notes: note('rejected by the user (seen by the end-of-turn scan)') })
  } else if (u.action === 'done') {
    await saveItem($, { ...item, status: 'done', updatedAt: at, notes: note('done (seen by the end-of-turn scan)') })
  } else {
    await saveItem($, { ...item, status: 'dropped', updatedAt: at, notes: note('duplicate of ' + u.of + ' (seen by the end-of-turn scan)') })
  }
}

async function runScan($: any, answer: string, userText: string): Promise<void> {
  try {
    const project = (await $.session.cwd()).toLowerCase()
    const open = (await loadAll($)).filter((i) => isOpen(i) && i.project.toLowerCase() === project)
    const r = await $.model.complete({
      model: 'haiku',
      system: SCAN_SYSTEM,
      prompt: buildScanPrompt(answer, open.map((i) => ({ id: i.id, title: i.title, kind: i.kind })), userText),
      maxTokens: 700,
      timeoutMs: 20000,
    })
    if (!r.isAnswered) { $.ui.log('scan skipped: ' + r.reason); return }
    const found = parseScanReply(r.text)
    if (!found) { $.ui.log('scan skipped: reply was not JSON'); return }
    // Updates first, against the items the prompt listed, so new captures cannot be touched.
    for (const u of parseScanUpdates(r.text, open.map((i) => i.id))) {
      const item = open.find((i) => i.id === u.id)
      if (item) await applyUpdate($, item, u)
    }
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
  // Open on something to look at: a tab with items, and every project when this one has none.
  let here = cwd
  try { here = await $.session.cwd() } catch { /* keep the session.start value */ }
  const view = firstView(cache, here, tab, allProjects)
  tab = view.tab
  allProjects = view.allProjects
  prevSeenAt = lastSeenAt
  lastSeenAt = new Date(await $.clock.now()).toISOString()
  try { await $.store.set('lastSeenAt', lastSeenAt) } catch { /* only affects the "new" count */ }
  const r = await $.ui.open({ id: PANE, title: "ToDo's", focus: true, closeOnEscape: true, columns: PANE_COLUMNS })
  // Only a placed pane counts as open; otherwise the next press must try to open it again.
  paneOpen = r?.isPlaced === true
  if (!paneOpen) $.ui.toast("Could not open the ToDo's pane: " + (r?.reason ?? 'unknown reason'))
  $.ui.invalidate('ui.render')
}

async function safeToggle($: any): Promise<void> {
  try { await togglePane($) } catch (err: any) { $.ui.toast("ToDo's pane failed: " + err.message) }
}

async function markStatus($: any, id: string, status: Status): Promise<void> {
  try { await setStatus($, id, status) } catch (err: any) { $.ui.toast('ToDo not saved: ' + err.message) }
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
      // A plugin's prompt waits until Claude is idle, so say so at once instead of
      // looking like nothing happened while a reply is still running.
      $.ui.toast(replying ? 'Queued: starts when the current reply finishes' : 'Sending: ' + clip(item.title, 40))
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

// Permanent deletion: only for items already dropped, only by the person (pane or
// /todo delete). Agents' tools can drop but never delete.
async function deleteItem($: any, idPrefix: string): Promise<{ ok: true; title: string } | { ok: false; message: string }> {
  const items = await loadAll($)
  const found = items.filter((i) => i.id.startsWith(idPrefix))
  if (found.length !== 1) return { ok: false, message: 'No single item matches id ' + idPrefix }
  const item = found[0]
  if (item.status !== 'dropped') return { ok: false, message: 'Only dropped items can be deleted. Drop it first: ' + item.title }
  if (!/^[A-Za-z0-9_-]+$/.test(item.id)) return { ok: false, message: 'Refused: unexpected characters in id ' + item.id }
  const path = (await itemsDir($)) + '\\' + item.id + '.json'
  const r = await $.process.run(['cmd', '/c', 'del', '/q', path])
  if (r.exitCode !== 0 || (await $.fs.exists(path))) return { ok: false, message: 'Could not delete ' + item.title + ': ' + (r.stderr.trim() || 'file still there') }
  cache = cache.filter((i) => i.id !== item.id)
  $.ui.invalidate('ui.render')
  return { ok: true, title: item.title }
}

async function runTodo($: any, args: string): Promise<{ text: string }> {
  const cmd = parseTodoCommand(args)
  if (cmd.action === 'error') return { text: cmd.message }
  try {
    if (cmd.action === 'done') {
      const item = await setStatus($, cmd.idPrefix, 'done')
      return { text: item ? 'Done: ' + item.title : 'No single item matches id ' + cmd.idPrefix }
    }
    if (cmd.action === 'delete') {
      const r = await deleteItem($, cmd.idPrefix)
      return { text: r.ok ? 'Deleted forever: ' + r.title : r.message }
    }
    const r = await capture($, { title: cmd.text, kind: cmd.kind, origin: 'human', source: 'manual' })
    return { text: (r.isNew ? 'Added ' : 'Already listed, noted: ') + r.item.title }
  } catch (err: any) {
    $.ui.toast('ToDo not saved: ' + err.message)
    return { text: 'Not saved: ' + err.message }
  }
}

async function runTodos($: any, args: string): Promise<{ text?: string }> {
  const cmd = parseTodosArgs(args)
  if (cmd.action === 'list') {
    try { return { text: formatList(await loadAll($), await $.session.cwd(), cmd.all) } }
    catch (err: any) { return { text: 'Not loaded: ' + err.message } }
  }
  if (cmd.action === 'refresh') {
    try {
      await forceRefresh($)
      return { text: 'Ledger refreshed: ' + cache.filter(isOpen).length + ' open.' }
    } catch (err: any) { return { text: 'Not loaded: ' + err.message } }
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
    // Picks up items other sessions write; the timer stops when the module reloads.
    $.clock.every(SYNC_MS, () => syncIfChanged($))
    $.clock.after(0, () => lookupSessionName($))
    await registerTool($, {
      name: 'park_item',
      description:
        'Record an item in the user\'s global todo ledger. Call this, without asking first, whenever you ' +
        'defer, park, postpone or put something out of scope, or propose work the user has not asked for. ' +
        'If it may already be recorded, call list_items first and update that item instead of adding a second one. ' +
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
      description:
        'List open items in the user\'s todo ledger (their todos, parked work, proposals and discussions across ' +
        'all projects and sessions). Use it whenever the user mentions todos, the ledger, parked or deferred work, ' +
        'or asks what is pending. scope "project" (default) or "all". Each line gives the id to use with get_item and update_item.',
      inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['project', 'all'] } } },
    })
    await registerTool($, {
      name: 'get_item',
      description: 'Read one ledger item in full: title, details, project, session, status and its notes thread. id may be a unique prefix.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    })
    await registerTool($, {
      name: 'update_item',
      description:
        'Update a ledger item: status (open, in_progress, done, dropped), title, kind, details, and/or add a note. ' +
        'Keep the ledger current without being asked: as soon as the user approves a proposal set kind "todo"; when ' +
        'they reject or drop it set status "dropped"; when an item\'s work is finished set status "done"; when two ' +
        'items are the same, drop one with a note naming the other. ' +
        'To remove an item, set status "dropped" (it moves to Done and can be reopened). id may be a unique prefix.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: STATUS_VALUES },
          title: { type: 'string' },
          kind: { type: 'string', enum: ['todo', 'deferred', 'proposal', 'discussion'] },
          body: { type: 'string', description: 'Replaces the item\'s details' },
          note: { type: 'string', description: 'Appended to the notes thread' },
        },
        required: ['id'],
      },
    })
    await registerCommand($, { name: 'todos', description: "Toggle the ToDo's pane", argumentHint: '[list [all] | refresh]', immediate: true }, 'ledger')
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
    let here = cwd
    try { here = await $.session.cwd() } catch { /* keep the session.start value */ }
    const label = bandLabel(cache, lastSeenAt, here)
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
    const ordered = displayOrder(rows, tab)

    const scoped = cache.filter((i) => allProjects || i.project.toLowerCase() === here.toLowerCase())
    const count = (t: Tab) => scoped.filter((i) => tabOf(i) === t).length
    const openCount = scoped.filter((i) => tabOf(i) !== 'done').length
    const select = (id: string | null) => { expandedId = id; startingId = null; notingId = null; deletingId = null; redraw() }

    // Closing an item from its card opens the next one, so a run of items is
    // triaged with one press each instead of select, act, select again.
    const closeItem = async (i: Item, status: Status, kindChange?: Kind) => {
      const at = ordered.findIndex((x) => x.id === i.id)
      const following = ordered.slice(at + 1).concat(ordered.slice(0, Math.max(0, at))).find((x) => x.id !== i.id)
      try {
        if (kindChange) {
          const stamp = new Date(await $.clock.now()).toISOString()
          await saveItem($, { ...i, kind: kindChange, updatedAt: stamp, notes: [...i.notes, { by: 'human' as Origin, text: 'approved', at: stamp }] })
        } else await setStatus($, i.id, status)
      } catch (err: any) { $.ui.toast('ToDo not saved: ' + err.message); return }
      if (kindChange) { redraw(); return }
      // Closed items are kept: say where they went.
      $.ui.toast((status === 'dropped' ? 'Dropped, moved to Done: ' : 'Done: ') + clip(i.title, 40))
      select(expandedId === i.id ? (following?.id ?? null) : expandedId)
    }

    // Row 1: where the list comes from, kept apart from the tabs.
    const scopeRow = Box({
      flexDirection: 'row',
      justifyContent: 'space-between',
      children: [
        Button({ key: 'scope', plain: true, hotkey: 'p',
          label: (allProjects ? 'All projects' : 'This project') + ' ▾',
          onPress: () => { allProjects = !allProjects; select(null) } }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Text({ dimColor: true, children: [openCount + ' open'] }),
            Button({ key: 'refresh', plain: true, dimColor: true, hotkey: 'r', label: '↻',
              onPress: async () => {
                try { await forceRefresh($) } catch (err: any) { $.ui.toast('Refresh failed: ' + err.message) }
              } }),
          ],
        }),
      ],
    })

    // Row 2: who started it; the chosen tab at full strength, the others dim.
    const tabRow = Box({
      flexDirection: 'row',
      columnGap: 3,
      marginY: 1,
      children: TABS.map((t) =>
        Button({ key: 'tab-' + t.id, plain: true, hotkey: t.hotkey, dimColor: tab !== t.id,
          label: t.label + ' ' + count(t.id),
          onPress: () => { tab = t.id; select(null) } })),
    })

    // The card's actions in one fixed order, the first the primary. Proposals are
    // decided (Approve / Reject) rather than worked, so they lead with that.
    const actionsFor = (i: Item) => {
      if (startingId === i.id) return [startChooser($, e, i)]
      // Letter keys act on the open card, except while a note is being typed.
      const hk = (k: string) => (notingId === null ? { hotkey: k } : {})
      if (tab === 'done') {
        const reopen = Button({ key: 'reopen-' + i.id, label: 'Reopen', ...hk('o'), onPress: () => markStatus($, i.id, 'open') })
        if (i.status !== 'dropped') return [reopen]
        // Two-step: the first press arms it; only Confirm deletes the file.
        if (deletingId === i.id) {
          return [
            Button({ key: 'delete-confirm-' + i.id, label: 'Confirm delete', onPress: async () => {
              deletingId = null
              const r = await deleteItem($, i.id)
              if (!r.ok) $.ui.toast(r.message)
              else { expandedId = null; $.ui.toast('Deleted forever: ' + r.title) }
              redraw()
            } }),
            Button({ key: 'delete-cancel-' + i.id, label: 'Cancel', onPress: () => { deletingId = null; redraw() } }),
          ]
        }
        return [reopen, Button({ key: 'delete-' + i.id, label: 'Delete forever', onPress: () => { deletingId = i.id; redraw() } })]
      }
      const start = Button({ key: 'start-' + i.id, label: 'Start', ...hk('s'),
        ...(i.kind === 'proposal' ? {} : { variant: 'primary' as const }),
        onPress: () => { startingId = i.id; notingId = null; redraw() } })
      const note = canInput && notingId !== i.id
        ? [Button({ key: 'note-' + i.id, label: 'Note', ...hk('n'), onPress: () => { notingId = i.id; startingId = null; redraw() } })]
        : []
      if (i.kind === 'proposal') {
        return [
          Button({ key: 'approve-' + i.id, label: 'Approve', variant: 'primary', ...hk('a'), onPress: () => closeItem(i, i.status, 'todo') }),
          Button({ key: 'drop-' + i.id, label: 'Reject', ...hk('x'), onPress: () => closeItem(i, 'dropped') }),
          start,
          ...note,
        ]
      }
      return [
        start,
        Button({ key: 'done-' + i.id, label: 'Done', ...hk('d'), onPress: () => closeItem(i, 'done') }),
        Button({ key: 'drop-' + i.id, label: 'Drop', ...hk('x'), onPress: () => closeItem(i, 'dropped') }),
        ...note,
      ]
    }

    const projectOf = (i: Item) => i.project.split('\\').filter(Boolean).pop() ?? i.project
    // Project, session and age each in its own faint tint (a mid-tone drawn dim,
    // readable on light and dark). Buttons take no colour, so this line is text:
    // the title lines open the card.
    const metaLine = (i: Item) => {
      const room = Math.max(12, titleCols - 8)
      const tint = (text: string, color: string) => Text({ color, dimColor: true, wrap: 'truncate-end', children: [text] })
      const dot = Text({ dimColor: true, children: ['·'] })
      return Box({ key: 'meta-' + i.id, flexDirection: 'row', columnGap: 1, children: [
        tint(clip(projectOf(i), Math.ceil(room / 2)), META.project), dot,
        tint(clip(sessionLabel(i), Math.floor(room / 2)), META.session), dot,
        tint(age(now, i.createdAt), META.age),
      ] })
    }
    // List titles stay on one line; the open card shows them whole.
    const cols = Math.max(12, (e.props.bodyColumns ?? 40) - 1)
    // Row chrome: border and padding (4), mark and gap (2), a spare column.
    const titleCols = Math.max(16, cols - 7)
    const fresh = (i: Item) => tab !== 'done' && isNew(i, prevSeenAt)
    // A started item shows ▶ in place of its group mark.
    const markOf = (i: Item, mark: string, color?: string) =>
      i.status === 'in_progress' ? Text({ color: ACCENT, children: ['▶'] }) : Text({ color, dimColor: !color, children: [mark] })

    // Scanning: each item in its own lightly outlined box, so the list reads as
    // separate entries. The title gets up to two lines, and every line of the
    // row is pressable, so a press anywhere on it opens the card.
    const compactRow = (i: Item, mark: string, color?: string) => {
      const open = () => select(i.id)
      const lines = wrapLines(i.title, titleCols - (fresh(i) ? 4 : 0), 2)
      return Box({
        key: 'row-' + i.id,
        flexDirection: 'row',
        columnGap: 1,
        borderStyle: 'round',
        borderDimColor: true,
        paddingX: 1,
        children: [
          markOf(i, mark, color),
          Box({
            flexDirection: 'column',
            flexGrow: 1,
            flexShrink: 1,
            children: [
              Box({ flexDirection: 'row', columnGap: 1, children: [
                Button({ key: 'title-' + i.id, plain: true, label: lines[0] ?? '', onPress: open }),
                ...(fresh(i) ? [Text({ color: ACCENT, children: ['new'] })] : []),
              ] }),
              ...(lines[1] ? [Button({ key: 'title2-' + i.id, plain: true, label: lines[1], onPress: open })] : []),
              metaLine(i),
            ],
          }),
        ],
      })
    }

    // One note: who and when on a dim line, the text under it.
    const noteView = (n: { by: string; text: string; at: string }, k: number, id: string) =>
      Box({
        key: 'note-' + k + '-' + id,
        flexDirection: 'column',
        marginTop: 1,
        children: [
          Text({ dimColor: true, children: [(n.by === 'human' ? 'You' : 'Claude') + ' · ' + age(now, n.at)] }),
          Text({ wrap: 'wrap', children: [n.text] }),
        ],
      })

    // Acting: the picked item opens into a card outlined in the accent: title, where it came
    // from, details, the latest notes, then the actions.
    const selectedCard = (i: Item, mark: string, color?: string) => {
      const noting = notingId === i.id && canInput
      const kindWord = i.kind === 'deferred' ? 'parked' : i.kind
      const metaLine = [kindWord, ...(i.status === 'in_progress' ? ['in progress'] : []), projectOf(i), age(now, i.createdAt)].join(' · ')
      const sessionLine = 'Session ' + sessionLabel(i) + (i.sessionName ? ' · ' + i.sessionId.split('-')[0] : '')
      // Long threads show their latest three; the rest is one press away.
      const showAll = allNotesId === i.id
      const hidden = showAll ? 0 : Math.max(0, i.notes.length - 3)
      return Box({
        key: 'row-' + i.id,
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor: ACCENT,
        paddingX: 1,
        marginBottom: 1,
        children: [
          Box({
            flexDirection: 'row',
            columnGap: 1,
            children: [
              markOf(i, mark, color),
              Box({
                flexDirection: 'column',
                flexGrow: 1,
                flexShrink: 1,
                children: [
                  Text({ bold: true, wrap: 'wrap', children: [i.title] }),
                  Text({ dimColor: true, wrap: 'wrap', children: [metaLine] }),
                  Text({ dimColor: true, wrap: 'wrap', children: [sessionLine] }),
                ],
              }),
              Button({ key: 'title-' + i.id, plain: true, dimColor: true, label: '✕', onPress: () => select(null) }),
            ],
          }),
          ...(i.body ? [Box({ marginTop: 1, children: [Text({ wrap: 'wrap', children: [i.body] })] })] : []),
          ...(i.notes.length || noting
            ? [Box({
                flexDirection: 'column',
                marginTop: 1,
                children: [
                  Text({ dimColor: true, children: ['Notes' + (i.notes.length ? ' · ' + i.notes.length : '')] }),
                  ...(hidden
                    ? [Button({ key: 'notes-more-' + i.id, plain: true, dimColor: true, label: 'Show ' + hidden + ' earlier',
                        onPress: () => { allNotesId = i.id; redraw() } })]
                    : []),
                  ...i.notes.slice(hidden).map((n, k) => noteView(n, k + hidden, i.id)),
                  ...(noting
                    ? [Box({
                        flexDirection: 'column',
                        marginTop: 1,
                        children: [
                          Input({ key: 'note-input-' + i.id, value: '', placeholder: 'Write a note, then press Enter', submitLabel: 'add', autoFocus: true,
                            onSubmit: async (v: string) => { notingId = null; await addNote($, i.id, v); redraw() } }),
                          Button({ key: 'note-cancel-' + i.id, plain: true, dimColor: true, label: 'Cancel', onPress: () => { notingId = null; redraw() } }),
                        ],
                      })]
                    : []),
                ],
              })]
            : []),
          Box({ flexDirection: 'row', columnGap: 1, flexWrap: 'wrap', marginTop: 1, children: actionsFor(i) }),
        ],
      })
    }

    const itemView = (i: Item, mark: string, color?: string) =>
      expandedId === i.id ? selectedCard(i, mark, color) : compactRow(i, mark, color)

    const body = rows.length === 0
      ? [Text({ dimColor: true, wrap: 'wrap', children: [
          tab === 'done'
            ? 'Closed items show here.'
            : 'Claude adds work it defers or proposes here. Add your own with /todo add <text>.',
        ] })]
      : tab === 'done'
        ? rows.map((i) => itemView(i, i.status === 'dropped' ? '✕' : '✓'))
        : groupItems(rows).flatMap((g) => [
            Box({
              flexDirection: 'row',
              columnGap: 1,
              marginBottom: 1,
              children: [Text({ bold: true, children: [g.label] }), Text({ dimColor: true, children: [String(g.items.length)] })],
            }),
            ...g.items.map((i) => itemView(i, g.mark, g.color)),
          ])

    const hint = tab === 'done' ? 'Select an item to reopen or delete it'
      : 'Select an item for its card · keys there: s start · d done · x drop · n note'
    return Box({
      flexDirection: 'column',
      children: [
        scopeRow,
        tabRow,
        ...body,
        ...(expandedId === null && rows.length ? [Text({ dimColor: true, wrap: 'wrap', children: [hint] })] : []),
      ],
    })
  })

  on('turn.start', async ($, e, next) => {
    parkedThisTurn = false
    if (e.agentId === undefined) replying = true
    // The scan reads what the user said this turn to see which items they decided.
    if (e.agentId === undefined && typeof e.text === 'string') lastUserText = e.text
    // Picks up a /rename since the last turn, without holding the turn.
    $.clock.after(0, () => lookupSessionName($))
    // Other sessions may have written items; the next render reloads.
    lastLoadAt = 0
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) replying = false
    // Subagent turns and non-answer turns are not scanned.
    if (e.agentId === undefined && e.reason === 'answer' && shouldScan(e.answer, parkedThisTurn)) {
      const answer = e.answer
      const userText = lastUserText
      $.clock.after(0, () => runScan($, answer, userText))
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
      $.ui.toast('ToDo not saved: ' + err.message)
      return { result: 'Not saved: ' + err.message }
    }
  })

  on('tool.call', { tool: 'mcp__todo-ledger__list_items' }, async ($, e) => {
    try { return { result: formatList(await loadAll($), await $.session.cwd(), e.scope === 'all') } }
    catch (err: any) { return { result: 'Not loaded: ' + err.message } }
  })

  on('tool.call', { tool: 'mcp__todo-ledger__get_item' }, async ($, e) => {
    try {
      const match = (await loadAll($)).filter((i) => typeof e.id === 'string' && e.id && i.id.startsWith(e.id))
      return { result: match.length === 1 ? formatItem(match[0]) : 'No single item matches id ' + e.id }
    } catch (err: any) { return { result: 'Not loaded: ' + err.message } }
  })

  on('tool.call', { tool: 'mcp__todo-ledger__update_item' }, async ($, e) => {
    try {
      const items = await loadAll($)
      const match = items.filter((i) => typeof e.id === 'string' && i.id.startsWith(e.id))
      if (match.length !== 1) return { result: 'No single item matches id ' + e.id }
      if (e.kind !== undefined && !KINDS.includes(e.kind)) return { result: 'Not saved: kind must be one of ' + KINDS.join(', ') }
      if (e.title !== undefined && (typeof e.title !== 'string' || !e.title.trim())) return { result: 'Not saved: title cannot be empty' }
      // A wrong status used to be ignored while the reply still said "updated".
      if (e.status !== undefined && !STATUS_VALUES.includes(e.status)) return { result: 'Not saved: status must be one of ' + STATUS_VALUES.join(', ') }
      const item = match[0]
      const at = new Date(await $.clock.now()).toISOString()
      const edits = {
        ...(e.title !== undefined ? { title: cleanTitle(e.title) } : {}),
        ...(e.kind !== undefined ? { kind: e.kind as Kind } : {}),
        ...(typeof e.body === 'string' ? { body: e.body } : {}),
      }
      const note = typeof e.note === 'string' && e.note.trim() ? e.note.trim() : ''
      // One write for every change, so another session never sees half an update.
      const final: Item = {
        ...item, ...edits, status: (e.status as Status | undefined) ?? item.status, updatedAt: at,
        notes: note ? [...item.notes, { by: 'agent' as Origin, text: note, at }] : item.notes,
      }
      await saveItem($, final)
      const changed = ['status ' + final.status, ...Object.keys(edits), ...(note ? ['note added'] : [])]
      return { result: 'Item ' + final.id + ' updated: ' + changed.join(', ') }
    } catch (err: any) {
      $.ui.toast('ToDo not saved: ' + err.message)
      return { result: 'Not saved: ' + err.message }
    }
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const result = await next(e)
    // Subagents' and workflow agents' working lists are theirs, not the person's ledger.
    if (e.agentId !== undefined) return result
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

