import { formatItem, formatList, parseTodoCommand, parseTodosArgs } from '../src/commands.ts'
import { SCAN_SYSTEM, buildScanPrompt, parseScanReply, parseScanUpdates, shouldScan } from '../src/scan.ts'
import type { ScanUpdate } from '../src/scan.ts'
import { KINDS, cleanTitle, clip, dedupeKey, wrapLines, isOpen, lastSessionTitle, makeItem, parseItem, randomHex4, sessionLabel, similarTitle } from '../src/item.ts'
import type { Item, Kind, Origin, Source, Status } from '../src/item.ts'
import { POLICY_ID, POLICY_TEXT } from '../src/policy.ts'
import { batchPrompt,fallbackArgv, startOptions, startPrompt, terminalArgv, terminalTask } from '../src/start.ts'
import type { StartChoice } from '../src/start.ts'
import { TABS, age, bandLabel, displayOrder, firstView, groupItems, itemsForTab, tabOf } from '../src/view.ts'
import type { Tab } from '../src/view.ts'
import { THEMES, nextTheme, themeById, withAlpha } from '../src/theme.ts'
import type { Theme } from '../src/theme.ts'

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
// What the card shows under an item's title, asked of every agent that adds one.
const DETAIL_HINT = 'Optional but recommended: 2 to 4 short sentences in plain English, no jargon: what this task is ' +
  'and why it is proposed or parked. Shown to the user in the item\'s card.'

const PANE = 'todo-ledger'
// The dock width asked for on open; a width the person dragged wins (the engine has no minimum).
const PANE_COLUMNS = 72
let paneOpen = false
let tab: Tab = 'agent'
let allProjects = false
let expandedId: string | null = null
let notingId: string | null = null
let startingId: string | null = null
let allNotesId: string | null = null
// What is typed in the note field, mirrored so a wrapped preview can show it (the field
// itself is one line). It belongs to draftFor and resets when another item is being noted.
let noteDraft = ''
let draftFor: string | null = null
// One pending preview redraw at a time; it lands this long after the first key of a burst.
let previewTimer = false
const PREVIEW_MS = 300
// Items picked with Queue, in the order they were picked. In memory only: a stale
// queue must never send by surprise after a restart.
const queue = new Set<string>()
// The list draws its first LIST_LIMIT rows (in display order) until the person asks for all:
// fewer elements per draw keeps presses responsive on a long ledger.
const LIST_LIMIT = 40
let showAllRows = false
let cwd = ''
// One accent colour for what needs attention (the open card, the decision mark,
// started items); everything else is hierarchy by weight, dimming and spacing.
// A theme key, so light and dark themes both fit.
// These follow the chosen theme (src/theme.ts); applyTheme sets them all at once.
let theme: Theme = THEMES[0]
let ACCENT = theme.accent
// Faint tints for a row's project, session and age.
let META = { project: theme.project, session: theme.session, age: theme.age }
// The same hues at low alpha, as pill backgrounds on the desktop. A coloured area
// behind a plain Button keeps it pressable (a Button's own text takes no colour).
let META_BG = { project: withAlpha(theme.project, 0.18), session: withAlpha(theme.session, 0.18), age: withAlpha(theme.age, 0.18) }
// Behind the rows captured in the session being used, on the desktop (about 8% alpha).
let THIS_SESSION_BG = withAlpha(theme.tint, 0.08)
// A very light wash over the whole pane on the desktop; the default theme has none.
let PANE_WASH: string | undefined
function applyTheme(t: Theme) {
  theme = t
  ACCENT = t.accent
  META = { project: t.project, session: t.session, age: t.age }
  META_BG = { project: withAlpha(t.project, 0.18), session: withAlpha(t.session, 0.18), age: withAlpha(t.age, 0.18) }
  THIS_SESSION_BG = withAlpha(t.tint, 0.08)
  PANE_WASH = t.id === 'ledger' ? undefined : withAlpha(t.tint, 0.05)
}
const CLOSED_MEMORY_MS = 30 * 86_400_000
let lastLoadAt = 0
const REFRESH_MS = 5000
const SYNC_MS = 10_000
let folderSig = ''
// TodoWrite entries (by dedupe key) already linked to a ledger item in this session.
const linked = new Map<string, string>()

// The machine the session runs on: Windows uses USERPROFILE, '\' and cmd; macOS and
// Linux use HOME, '/' and POSIX tools. Read once, from the environment.
let host: { win: boolean; sep: string; home: string } | null = null

async function hostOf($: any): Promise<{ win: boolean; sep: string; home: string }> {
  if (host) return host
  const win = (await $.env.get('OS')) === 'Windows_NT'
  const home = (win ? await $.env.get('USERPROFILE') : undefined) || (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  if (!home) throw new Error('Neither HOME nor USERPROFILE is set, so the ledger folder cannot be found')
  host = { win, sep: win ? '\\' : '/', home }
  return host
}

// Moves a file over another, replacing it (how a save lands in one step).
async function moveFile($: any, from: string, to: string): Promise<{ exitCode: number; stderr: string }> {
  const h = await hostOf($)
  return $.process.run(h.win ? ['cmd', '/c', 'move', '/y', from, to] : ['mv', '-f', from, to])
}

async function removeFile($: any, path: string): Promise<{ exitCode: number; stderr: string }> {
  const h = await hostOf($)
  return $.process.run(h.win ? ['cmd', '/c', 'del', '/q', path] : ['rm', '-f', path])
}

async function ledgerDir($: any): Promise<string> {
  const h = await hostOf($)
  return [h.home, '.claude', 'todo-ledger'].join(h.sep)
}

async function sep($: any): Promise<string> {
  return (await hostOf($)).sep
}

async function itemsDir($: any): Promise<string> {
  return (await ledgerDir($)) + (await sep($)) + 'items'
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
    try { text = await $.fs.read(dir + (await sep($)) + entry.name) } catch { text = null }
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
  const path = dir + (await sep($)) + item.id + '.json'
  await $.fs.write(path + '.tmp', JSON.stringify(item, null, 2))
  const r = await moveFile($, path + '.tmp', path)
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
      const h = await hostOf($)
      const projects = [h.home, '.claude', 'projects'].join(h.sep)
      const found = await $.process.run(h.win
        ? ['cmd', '/c', 'dir', '/s', '/b', projects + h.sep + id + '.jsonl']
        : ['find', projects, '-name', id + '.jsonl'])
      const first = found.exitCode === 0 ? found.stdout.split(/\r?\n/).find((l: string) => l.trim()) : undefined
      if (!first) return sessionName
      transcriptPath = first.trim()
    }
    // findstr / grep print only lines that begin with a title record, so a large
    // transcript is never read whole (`.` matches the quotes in the regex).
    const r = await $.process.run((await hostOf($)).win
      ? ['findstr', '/r', '/b', '/c:{.type.:.custom-title.', transcriptPath]
      : ['grep', '^{.type.:.custom-title.', transcriptPath])
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
  for (let tries = 0; tries < 5 && (await $.fs.exists(dir + (await sep($)) + item.id + '.json')); tries++) {
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
      maxTokens: 1200,
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
    for (const f of found) await capture($, { title: f.title, kind: f.kind, origin: 'agent', source: 'scan', body: f.detail })
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
      const s = await sep($)
      const file = (await ledgerDir($)) + s + 'start' + s + item.id + '.md'
      await $.fs.write(file, text)
      const task = terminalTask(item.id, file)
      let ok = false
      // Opening a new terminal window is wired for Windows (wt, else cmd start); elsewhere the prompt is copied.
      if (!(await hostOf($)).win) {
        await copyText($, text, 'Prompt copied: start claude in a new terminal and paste it', 'Prompt not copied')
        return
      }
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

// Sends every queued item as one prompt; the agent decides how to run them.
async function sendQueued($: any, items: Item[]): Promise<void> {
  if (!items.length) return
  const text = batchPrompt(items, cwd || (await $.session.cwd()))
  try {
    const stamp = new Date(await $.clock.now()).toISOString()
    for (const item of items) await saveItem($, { ...item, status: 'in_progress', updatedAt: stamp })
    $.ui.toast(replying ? 'Queued: starts when the current reply finishes' : 'Sending ' + items.length + ' items')
    let dropped: string | null = null
    try {
      const r = await $.prompt.submit({ text, asUser: true })
      if (r && typeof r.drop === 'string') dropped = r.drop
    } catch (err: any) { dropped = err.message }
    if (dropped !== null) {
      const back = new Date(await $.clock.now()).toISOString()
      for (const item of items) await saveItem($, { ...item, updatedAt: back })
      $.ui.toast('Prompt not sent: ' + dropped)
      return
    }
    queue.clear()
  } catch (err: any) {
    $.ui.toast('Send failed: ' + err.message)
  }
}

// The Start step: one button per way to start, in place of the card's actions, so
// a choice is a single press (a picker needed focus, arrows and Enter). The first
// is the main one; Cancel is plain and dim so it never competes.
function startChooser($: any, e: any, item: Item) {
  const { Button } = $.ui.resolve(e)
  const redraw = () => $.ui.invalidate('ui.render')
  return [
    ...startOptions(e.surface === 'desktop' ? 'desktop' : 'terminal').map((o, k) =>
      Button({ key: 'start-' + o.value + '-' + item.id, label: o.label, hotkey: o.hotkey,
        ...(k === 0 ? { variant: 'primary' as const, autoFocus: true as const } : { plain: true as const }),
        onPress: async () => { startingId = null; await doStart($, item, o.value as StartChoice); redraw() } })),
    Button({ key: 'start-cancel-' + item.id, label: 'Cancel', plain: true, dimColor: true, onPress: () => { startingId = null; redraw() } }),
  ]
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
  const path = (await itemsDir($)) + (await sep($)) + item.id + '.json'
  const r = await removeFile($, path)
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
    try { cwd = await $.session.cwd() } catch { /* keep '' until a render reads it */ }
    // The theme the person last chose, kept across sessions.
    try { applyTheme(themeById(await $.store.get('theme'))) } catch { /* the default theme */ }
    // Picks up items other sessions write; the timer stops when the module reloads.
    $.clock.every(SYNC_MS, () => syncIfChanged($))
    $.clock.after(0, () => lookupSessionName($))
    await registerTool($, {
      name: 'park_item',
      description:
        'Record an item in the user\'s global todo ledger, without asking first, when you defer, park or put ' +
        'something out of scope, or propose work with a clear payoff, and the user would lose it if nobody wrote it down. ' +
        'Skip anything you can finish now, steps of the current task, progress notes and speculation. ' +
        'Never duplicate: call list_items first, and update that item with a note instead of adding a second one ' +
        'when an open item covers the same work in any wording. Close the item with update_item (status done) ' +
        'as soon as the work is finished. kind: todo | deferred | proposal | discussion. Keep title to one line.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: ['todo', 'deferred', 'proposal', 'discussion'] },
          body: { type: 'string', description: DETAIL_HINT },
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
          body: { type: 'string', description: 'Replaces the item\'s details. ' + DETAIL_HINT },
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

  // After a press redraws the pane, the desktop loses the pane's focus ring, and the
  // next click is spent taking it back (traced 2026-10-07: one press logged per two
  // clicks). Putting the ring on the element the next press will want keeps every
  // click live: the open card's Close, or the row title once the card closes.
  on('ui.press', async ($, e, next) => {
    const r = await next(e)
    if (e.plugin !== 'todo-ledger' || e.requestId !== PANE) return r
    const target = expandedId ? 'close-' + expandedId : e.element.replace(/^close-/, 'title-')
    try { await $.ui.focus({ requestId: PANE, key: target }) } catch { /* a denied move leaves focus as it was */ }
    return r
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) paneOpen = false
    return next(e)
  })

  // The button lives in a slim row directly above the prompt box, at the right. The
  // footer slot it used before is the engine's dim mode-label line, which Claude Code
  // now wraps onto its own cramped row. A survey owns this band while it is up.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Whatever sits beneath (another mod's button) stays in the row, to the left of ours.
    const inner = await next(e)
    if (e.props?.hasSurvey) return inner
    await refreshIfStale($)
    let here = cwd
    try { here = await $.session.cwd() } catch { /* keep the session.start value */ }
    const label = bandLabel(cache, here)
    const { Box, Button } = $.ui.resolve(e)
    return Box({ key: 'ledger-band', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center',
      children: [...(inner ? [inner] : []), Button({ key: 'ledger-toggle', label, plain: true, onPress: () => safeToggle($) })] })
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    try {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    // Mobile's element table has no Input, so the note composer is skipped there.
    const canInput = e.surface !== 'mobile'
    const redraw = () => $.ui.invalidate('ui.render')
    const now = await $.clock.now()
    await refreshIfStale($)
    // Read the cwd per render so the filter follows /cd and matches what capture stores.
    let here = cwd
    try { here = await $.session.cwd() } catch { /* keep the session.start value */ }
    let thisSession = ''
    try { thisSession = await $.session.id() } catch { /* no highlight without an id */ }
    const rows = itemsForTab(cache, tab, allProjects ? null : here)
    const ordered = displayOrder(rows, tab)
    const head = ordered.slice(0, LIST_LIMIT)
    const picked = ordered.find((x) => x.id === expandedId)
    const shown = showAllRows ? ordered : picked && !head.includes(picked) ? [...head, picked] : head

    const scoped = cache.filter((i) => allProjects || i.project.toLowerCase() === here.toLowerCase())
    const count = (t: Tab) => scoped.filter((i) => tabOf(i) === t).length
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

    // Row 1: where the list comes from, with a dim refresh at the far end. The open
    // count is not repeated here: the tabs carry it.
    const scopeRow = Box({
      flexDirection: 'row',
      justifyContent: 'space-between',
      children: [
        Button({ key: 'scope', plain: true, hotkey: 'p',
          label: (allProjects ? 'All projects' : 'This project') + ' ▾',
          onPress: () => { allProjects = !allProjects; showAllRows = false; select(null) } }),
        Box({ flexDirection: 'row', columnGap: 2, children: [
          // One button steps through the five themes and remembers the choice.
          Button({ key: 'theme', plain: true, dimColor: true, label: '◐ ' + theme.label,
            onPress: async () => {
              applyTheme(nextTheme(theme.id))
              try { await $.store.set('theme', theme.id) } catch { /* kept for this session only */ }
              redraw()
            } }),
          Button({ key: 'refresh', plain: true, dimColor: true, label: '↻',
            onPress: async () => {
              try { await forceRefresh($) } catch (err: any) { $.ui.toast('Refresh failed: ' + err.message) }
            } }),
        ] }),
      ],
    })

    // Queued items that are still open (a closed one drops out), in pick order.
    const queued = [...queue].map((id) => cache.find((i) => i.id === id)).filter((i): i is Item => !!i && isOpen(i))
    for (const id of [...queue]) if (!queued.some((i) => i.id === id)) queue.delete(id)
    // Shown only with something queued, as one bar under the tabs: the count at the left,
    // a dim Clear and the one primary Send all at the right. On the desktop the bar is
    // washed in the accent so it reads as part of the list it acts on.
    const tray = queued.length === 0 ? [] : [Box({
      key: 'queue-tray',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 1,
      ...(e.surface === 'desktop' ? { paddingX: 2, backgroundColor: withAlpha(theme.tint, 0.1) } : {}),
      children: [
        Text({ color: ACCENT, children: [queued.length + ' queued'] }),
        Box({ flexDirection: 'row', alignItems: 'center', columnGap: 2, children: [
          Button({ key: 'queue-clear', label: 'Clear', plain: true, dimColor: true, onPress: () => { queue.clear(); redraw() } }),
          Button({ key: 'queue-send', label: 'Send all', variant: 'primary', onPress: async () => { await sendQueued($, queued); redraw() } }),
        ] }),
      ],
    })]

    // Row 2: who started it; the chosen tab at full strength, the others dim.
    const tabRow = Box({
      flexDirection: 'row',
      columnGap: 3,
      marginBottom: 1,
      children: TABS.map((t) =>
        Button({ key: 'tab-' + t.id, plain: true, hotkey: t.hotkey, dimColor: tab !== t.id,
          label: t.label + ' ' + count(t.id),
          onPress: () => { tab = t.id; showAllRows = false; select(null) } })),
    })

    // The card's actions in one fixed order, the first the primary. Proposals are
    // decided (Approve / Reject) rather than worked, so they lead with that. While a
    // note is being typed the Note button turns into Cancel and letter keys rest.
    const actionsFor = (i: Item) => {
      if (startingId === i.id) return startChooser($, e, i)
      const noting = notingId === i.id
      const hk = (k: string) => (notingId === null ? { hotkey: k } : {})
      if (tab === 'done') {
        const reopen = Button({ key: 'reopen-' + i.id, label: 'Reopen', variant: 'primary', ...hk('o'), onPress: () => markStatus($, i.id, 'open') })
        if (i.status !== 'dropped') return [reopen]
        // Two-step: the first press arms it; only Confirm deletes the file. Neither is
        // primary: nothing should invite an irreversible press.
        if (deletingId === i.id) {
          return [
            Button({ key: 'delete-confirm-' + i.id, label: 'Confirm delete', onPress: async () => {
              deletingId = null
              const r = await deleteItem($, i.id)
              if (!r.ok) $.ui.toast(r.message)
              else { expandedId = null; $.ui.toast('Deleted forever: ' + r.title) }
              redraw()
            } }),
            Button({ key: 'delete-cancel-' + i.id, label: 'Cancel', plain: true, dimColor: true, onPress: () => { deletingId = null; redraw() } }),
          ]
        }
        return [reopen, Button({ key: 'delete-' + i.id, label: 'Delete forever', dimColor: true, onPress: () => { deletingId = i.id; redraw() } })]
      }
      const start = Button({ key: 'start-' + i.id, label: 'Start', ...hk('s'),
        ...(i.kind === 'proposal' ? {} : { variant: 'primary' as const }),
        onPress: () => { startingId = i.id; notingId = null; redraw() } })
      const picked = queue.has(i.id)
      const queueBtn = Button({ key: 'queue-' + i.id, label: picked ? 'Queued ✓' : 'Queue', ...hk('q'),
        onPress: () => { if (picked) queue.delete(i.id); else queue.add(i.id); redraw() } })
      const note = !canInput ? []
        : noting
          ? [Button({ key: 'note-cancel-' + i.id, label: 'Cancel', plain: true, dimColor: true, onPress: () => { notingId = null; redraw() } })]
          : [Button({ key: 'note-' + i.id, label: 'Note', ...hk('n'), onPress: () => { notingId = i.id; startingId = null; redraw() } })]
      if (i.kind === 'proposal') {
        return [
          Button({ key: 'approve-' + i.id, label: 'Approve', variant: 'primary', ...hk('a'), onPress: () => closeItem(i, i.status, 'todo') }),
          Button({ key: 'drop-' + i.id, label: 'Reject', ...hk('x'), onPress: () => closeItem(i, 'dropped') }),
          start,
          queueBtn,
          ...note,
        ]
      }
      return [
        start,
        queueBtn,
        Button({ key: 'done-' + i.id, label: 'Done', ...hk('d'), onPress: () => closeItem(i, 'done') }),
        Button({ key: 'drop-' + i.id, label: 'Drop', ...hk('x'), onPress: () => closeItem(i, 'dropped') }),
        ...note,
      ]
    }

    // Row width in title characters. The desktop draws a proportional font, about
    // 1.4 characters per cell, so text wraps later there to use the pane's real width.
    const cols = Math.max(12, (e.props.bodyColumns ?? 40) - 1)
    const wide = e.surface === 'desktop' ? 1.2 : 1
    // Row chrome: mark and gap (2), a spare column; on the desktop also the row's side
    // padding (2), so a title never runs past its row or the open card.
    const chrome = e.surface === 'desktop' ? 6 : 3
    const titleCols = Math.max(16, Math.floor((cols - chrome) * wide))

    const projectOf = (i: Item) => i.project.split(/[\\/]/).filter(Boolean).pop() ?? i.project
    // Where and when, each part in its own faint tint (a mid-tone drawn dim, readable
    // on light and dark). The project is named only when the list spans projects:
    // inside one project it would be the same word on every row. Closed items show
    // how long ago they closed, which is also the Done tab's order.
    // On the desktop each part is a pill tinted at low alpha; given `open`, the
    // pills are buttons, so the whole row opens the card. The terminal cannot draw
    // alpha, so there the parts stay faintly tinted text.
    const pills = e.surface === 'desktop'
    const metaLine = (i: Item, open?: () => void) => {
      const room = Math.max(12, titleCols - 8)
      const part = (k: 'project' | 'session' | 'age', text: string) => {
        if (!pills) return Text({ color: META[k], dimColor: true, wrap: 'truncate-end', children: [text] })
        const inner = open
          ? Button({ key: 'meta-' + k + '-' + i.id, plain: true, label: text, onPress: open })
          : Text({ children: [text] })
        return Box({ backgroundColor: META_BG[k], paddingX: 1, children: [inner] })
      }
      const dot = Text({ dimColor: true, children: ['·'] })
      const when = part('age', age(now, tab === 'done' ? i.updatedAt : i.createdAt))
      const session = part('session', clip(sessionLabel(i), allProjects ? Math.floor(room / 2) : room))
      const parts = allProjects ? [part('project', clip(projectOf(i), Math.ceil(room / 2))), session, when] : [session, when]
      // Pills sit apart on their own; text parts need the dot between them.
      const children = pills ? parts : parts.flatMap((x, k) => (k ? [dot, x] : [x]))
      return Box({ key: 'meta-' + i.id, flexDirection: 'row', columnGap: 1, children })
    }
    // A started item shows ▶ in place of its group mark.
    const markOf = (i: Item, mark: string, color?: string) =>
      i.status === 'in_progress' ? Text({ color: ACCENT, children: ['▶'] }) : Text({ color, dimColor: !color, children: [mark] })

    // Scanning: a mark, the title on up to two lines (both open the card), the meta
    // line. Rows are set apart by one blank line, none after a group's last; no
    // borders, no rules.
    const compactRow = (i: Item, mark: string, color: string | undefined, last: boolean) => {
      const open = () => select(i.id)
      const lines = wrapLines(i.title, titleCols, 2)
      // After the meta line: a dot on the terminal for a row from this session (the
      // desktop tints it instead), and "queued" for a picked one.
      const extras = [
        ...(!pills && thisSession && i.sessionId === thisSession ? [Text({ color: ACCENT, children: ['● this session'] })] : []),
        ...(queue.has(i.id) ? [Text({ color: ACCENT, children: ['queued'] })] : []),
      ]
      return Box({
        key: 'row-' + i.id,
        flexDirection: 'row',
        columnGap: 1,
        alignItems: 'flex-start',
        // Desktop rows are padded blocks (the padding is also the gap between them, so
        // a tint has room around the text); the terminal separates rows by one blank line.
        // Flat rows, no outline (only the open card is outlined). Desktop rows get a little
        // side padding so the this-session tint has room; the gap between rows is the same
        // blank line as on the terminal.
        ...(pills ? { paddingX: 1, marginBottom: 1 } : last ? {} : { marginBottom: 1 }),
        ...(pills && thisSession && i.sessionId === thisSession ? { backgroundColor: THIS_SESSION_BG } : {}),
        children: [
          markOf(i, mark, color),
          Box({
            flexDirection: 'column',
            flexGrow: 1,
            flexShrink: 1,
            children: [
              Button({ key: 'title-' + i.id, plain: true, label: lines[0] ?? '', onPress: open }),
              ...(lines[1] ? [Button({ key: 'title2-' + i.id, plain: true, label: lines[1], onPress: open })] : []),
              extras.length
                ? Box({ flexDirection: 'row', columnGap: 1, children: [metaLine(i, open), ...extras] })
                : metaLine(i, open),
            ],
          }),
        ],
      })
    }

    // One note: who and when on a dim line, the text under it; no blank between notes.
    const noteView = (n: { by: string; text: string; at: string }, k: number, id: string) =>
      Box({
        key: 'note-' + k + '-' + id,
        flexDirection: 'column',
        children: [
          Text({ dimColor: true, children: [(n.by === 'human' ? 'You' : 'Claude') + ' · ' + age(now, n.at)] }),
          Text({ wrap: 'wrap', children: [n.text] }),
        ],
      })

    // Acting: the picked item opens into a card outlined in the accent. Inside, by
    // weight: the title bold, the same meta line as a row, details, the latest notes
    // (older ones one press away), the composer when open, then the actions. The kind
    // is not repeated: the card sits under its group heading.
    const selectedCard = (i: Item, mark: string, color?: string) => {
      const noting = notingId === i.id && canInput
      if (draftFor !== (noting ? i.id : null) && (noting || draftFor === i.id)) { noteDraft = ''; draftFor = noting ? i.id : null }
      const showAll = allNotesId === i.id
      const hidden = showAll ? 0 : Math.max(0, i.notes.length - 3)
      return Box({
        key: 'row-' + i.id,
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor: ACCENT,
        paddingX: pills ? 2 : 1,
        ...(pills ? { paddingY: 1 } : {}),
        marginBottom: 1,
        children: [
          Box({
            flexDirection: 'row',
            columnGap: 1,
            alignItems: 'flex-start',
            children: [
              markOf(i, mark, color),
              Box({
                flexDirection: 'column',
                flexGrow: 1,
                flexShrink: 1,
                children: [
                  Text({ bold: true, wrap: 'wrap', children: [i.title] }),
                  metaLine(i),
                ],
              }),
              Button({ key: 'close-' + i.id, plain: true, dimColor: true, label: 'Close', onPress: () => select(null) }),
            ],
          }),
          ...(i.body ? [Box({ marginTop: 1, children: [Text({ wrap: 'wrap', children: [i.body] })] })] : []),
          ...(i.notes.length
            ? [Box({
                flexDirection: 'column',
                marginTop: 1,
                children: [
                  hidden
                    ? Button({ key: 'notes-more-' + i.id, plain: true, dimColor: true, label: 'Show ' + hidden + ' earlier',
                        onPress: () => { allNotesId = i.id; redraw() } })
                    : Text({ dimColor: true, children: ['Notes'] }),
                  ...i.notes.slice(hidden).map((n, k) => noteView(n, k + hidden, i.id)),
                ],
              })]
            : []),
          ...(noting
            // A roomy field: full width (a column, so the Input stretches), taller than one
            // line, and outlined in the accent so it reads as the place to type. The Input
            // itself is one line, so Enter adds the note.
            ? [Box({ marginTop: 1, flexDirection: 'column', width: '100%', children: [
                Text({ dimColor: true, children: ['Add a note'] }),
                Box({ width: '100%', minHeight: 5, borderStyle: 'round', borderColor: ACCENT, paddingX: 2, paddingY: 1, flexDirection: 'column', children: [
                  // No `value`: a drawn value replaces what the person typed, which moves the
                  // cursor when the preview redraws. The field keeps its own text instead.
                  Input({ key: 'note-input-' + i.id, placeholder: 'What should the agent know? Context, constraints, a decision.', submitLabel: 'add note', autoFocus: true,
                    // Redrawing on every key can move the cursor, so the preview catches up
                    // a moment after typing pauses, and only while it is (or is about to be) shown.
                    onInput: (v: string) => {
                      const was = noteDraft.length > 40
                      noteDraft = v; draftFor = i.id
                      if (!was && v.length <= 40) return
                      if (previewTimer) return
                      previewTimer = true
                      $.clock.after(PREVIEW_MS, () => { previewTimer = false; redraw() })
                    },
                    onSubmit: async (v: string) => { notingId = null; noteDraft = ''; draftFor = null; await addNote($, i.id, v); redraw() } }),
                  // The field scrolls sideways; this shows the whole note, wrapped, as it grows.
                  ...(noteDraft.length > 40 ? [Box({ marginTop: 1, children: [Text({ dimColor: true, wrap: 'wrap', children: [noteDraft] })] })] : []),
                ] }),
              ] })]
            : []),
          Box({ flexDirection: 'row', columnGap: 1, flexWrap: 'wrap', marginTop: 1, children: actionsFor(i) }),
        ],
      })
    }

    const itemView = (i: Item, mark: string, color: string | undefined, last: boolean) =>
      expandedId === i.id ? selectedCard(i, mark, color) : compactRow(i, mark, color, last)

    // Group headings are secondary: dim, no count (the rows under them are the count).
    const body = rows.length === 0
      ? [Text({ dimColor: true, wrap: 'wrap', children: [
          tab === 'done'
            ? 'Nothing closed yet.'
            : 'Nothing open. Claude adds what it parks or proposes; add your own with /todo add <text>.',
        ] })]
      : tab === 'done'
        ? shown.map((i, k) => itemView(i, i.status === 'dropped' ? '✕' : '✓', undefined, k === shown.length - 1))
        : groupItems(shown).flatMap((g, gi) => [
            Box({ ...(gi === 0 ? {} : { marginTop: 1 }), children: [Text({ dimColor: true, children: [g.label] })] }),
            ...g.items.map((i, k) => itemView(i, g.mark, g.color === 'suggestion' ? ACCENT : g.color, k === g.items.length - 1)),
          ])
    const more = ordered.length - shown.length
    if (more > 0) {
      body.push(Box({ marginTop: 1, children: [Button({ key: 'show-all-rows', plain: true, dimColor: true,
        label: 'Show ' + more + ' more', onPress: () => { showAllRows = true; redraw() } })] }))
    }

    return Box({
      flexDirection: 'column',
      ...(pills && PANE_WASH ? { backgroundColor: PANE_WASH } : {}),
      children: [scopeRow, tabRow, ...tray, ...body],
    })
    } catch (err: any) {
      // A failed draw shows its reason instead of a blank pane.
      $.ui.log('pane draw failed: ' + (err?.stack ?? err?.message ?? String(err)))
      const { Text } = $.ui.resolve(e)
      return Text({ wrap: 'wrap', children: ["ToDo's could not draw: " + (err?.message ?? String(err))] })
    }
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

  // The ledger rules ride in the system prompt of every agent that is offered the ledger tools.
  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    if (!e.tools.includes('mcp__todo-ledger__park_item')) return out
    return { sections: [...out.sections.filter((s) => s.id !== POLICY_ID), { id: POLICY_ID, text: POLICY_TEXT, scope: 'session' as const }] }
  })

  on('tool.call', { tool: 'mcp__todo-ledger__park_item' }, async ($, e) => {
    if (!KINDS.includes(e.kind)) return { result: 'Not saved: kind must be one of ' + KINDS.join(', ') }
    if (typeof e.title !== 'string' || !e.title.trim()) return { result: 'Not saved: title is required' }
    try {
      const r = await capture($, { title: e.title, kind: e.kind, origin: 'agent', source: 'tool', body: e.body })
      parkedThisTurn = true
      return { result: r.isNew
        ? 'Parked ' + r.item.id + ': ' + r.item.title + '. Close it with update_item (status done) when the work is finished.'
        : 'Already in ledger as ' + r.item.id + ': ' + r.item.title + '. Nothing new was added; ' +
          'update that item with a note if you have more to say.' }
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

