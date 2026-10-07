import { expect, test } from 'claude-code/testing'
import { setup, start } from './fakes.ts'

// Fixes from the 2026-10-07 audit: scan noise, update_item, TodoWrite upkeep, card triage.

const LONG = 'We fixed the bug. '.repeat(30) + 'I deferred the GGUF check for CLM to later.'
const DONE = { durationMs: 1, isAborted: false, reason: 'answer' as const }
const PANE = { plugin: 'todo-ledger', component: 'Pane', requestId: 'todo-ledger', viewport: { columns: 120, rows: 40 },
  props: { title: "ToDo's", isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const
const items = (disk: Map<string, string>) => [...disk.values()].map((t) => JSON.parse(t))

async function scanTurn($: any, clock: any, id: string) {
  await $.turn.start({ text: '', turnId: id })
  await $.turn.complete({ turnId: id, answer: LONG, ...DONE })
  await clock.settle()
}

test('the scan does not bring back an item that was just dropped', async ($, on) => {
  const { disk, clock } = setup(on, { modelText: '{"items":[{"title":"Check CLM GGUF model","kind":"deferred"}]}' })
  await start($)
  await scanTurn($, clock, 't1')
  const id = items(disk)[0].id
  await $.tool.call({ tool: 'mcp__todo-ledger__update_item', id, status: 'dropped' })
  await scanTurn($, clock, 't2')
  expect(items(disk).length).toBe(1)
  expect(items(disk)[0].status).toBe('dropped')
})

test('the scan seeing a known open item again adds no note', async ($, on) => {
  const { disk, clock } = setup(on, { modelText: '{"items":[{"title":"Check CLM GGUF model","kind":"deferred"}]}' })
  await start($)
  await scanTurn($, clock, 't1')
  await scanTurn($, clock, 't2')
  expect(items(disk).length).toBe(1)
  expect(items(disk)[0].notes.length).toBe(0)
})

test('update_item refuses an unknown status and writes every change at once', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'thing', kind: 'proposal' })
  const id = items(disk)[0].id
  const bad = await $.tool.call({ tool: 'mcp__todo-ledger__update_item', id, status: 'completed' })
  expect(bad.result).toContain('Not saved: status must be one of')
  expect(items(disk)[0].status).toBe('open')
  await $.tool.call({ tool: 'mcp__todo-ledger__update_item', id, status: 'in_progress', kind: 'todo', note: 'approved' })
  expect(items(disk)[0]).toMatchObject({ status: 'in_progress', kind: 'todo' })
  expect(items(disk)[0].notes.map((n: any) => n.text)).toEqual(['approved'])
})

test("a subagent's TodoWrite list is not mirrored", async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'TodoWrite', agentId: 'sub-1', todos: [{ content: 'inner step', status: 'pending', activeForm: 'x' }] })
  expect(disk.size).toBe(0)
})

test('an entry removed from the TodoWrite list drops its mirror', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'keep me', status: 'pending', activeForm: 'x' }, { content: 'remove me', status: 'pending', activeForm: 'x' }] })
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'keep me', status: 'pending', activeForm: 'x' }] })
  const byTitle = Object.fromEntries(items(disk).map((i) => [i.title, i]))
  expect(byTitle['keep me'].status).toBe('open')
  expect(byTitle['remove me'].status).toBe('dropped')
})

test('a proposal card offers Approve and Reject; Approve makes it a todo', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'idea', kind: 'proposal' })
  const id = items(disk)[0].id
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'title-' + id })
  expect((await ui.find({ key: 'drop-' + id })).props.label).toBe('Reject')
  await ui.press({ key: 'approve-' + id })
  expect(items(disk)[0]).toMatchObject({ kind: 'todo', status: 'open' })
})

test('Done in a card opens the next item, so triage is one press each', async ($, on) => {
  const { disk, clock } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'first', kind: 'todo' })
  await clock.advance(2000)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'second', kind: 'todo' })
  const [older, newer] = items(disk).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'title-' + newer.id })
  await ui.press({ key: 'done-' + newer.id })
  expect(await ui.find({ key: 'done-' + older.id })).toBeDefined()
})

test('the pane opens on the Human tab when Agent is empty, and marks started items', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.command.run({ command: 'todo', args: 'add mine' })
  const id = items(disk)[0].id
  await $.tool.call({ tool: 'mcp__todo-ledger__update_item', id, status: 'in_progress' })
  await $.command.run({ command: 'todos', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', text: 'mine' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '▶' })).toBeDefined()
})

test('rows carry no "new" mark and the pane keeps no last-visit time', async ($, on) => {
  const { store } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'fresh one', kind: 'todo' })
  await $.command.run({ command: 'todos', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'new' })).toBeUndefined()
  expect(store.has('lastSeenAt')).toBe(false)
})

test('Drop keeps the item: it says so and it shows in Done marked ✕', async ($, on) => {
  const { disk, calls } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'unwanted', kind: 'todo' })
  const id = items(disk)[0].id
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'title-' + id })
  await ui.press({ key: 'drop-' + id })
  expect(items(disk)[0].status).toBe('dropped')
  expect(calls.toasts.some((t) => t.startsWith('Dropped, moved to Done'))).toBe(true)
  await ui.press({ key: 'tab-done' })
  expect((await ui.find({ key: 'tab-done' })).props.label).toBe('Done 1')
  expect(await ui.find({ type: 'Text', text: '✕' })).toBeDefined()
})

test('Send now says it is sending, or queued while a reply runs', async ($, on) => {
  const { disk, calls } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'go', kind: 'todo' })
  const id = items(disk)[0].id
  await $.turn.start({ text: 'hi', turnId: 't9' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'title-' + id })
  await ui.press({ key: 'start-' + id })
  await ui.press({ key: 'start-send-' + id })
  expect(calls.toasts).toContain('Queued: starts when the current reply finishes')
  expect(calls.submits.length).toBe(1)
})

test('desktop meta parts are tinted pills that open the card; the terminal keeps tinted text', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'pill me', kind: 'todo' })
  const id = items(disk)[0].id
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const pill = await desk.find({ key: 'meta-session-' + id })
  expect(pill.props.label).toBe('sess')
  await desk.press({ key: 'meta-age-' + id })
  expect(await desk.find({ key: 'done-' + id })).toBeDefined()
  await desk.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ key: 'meta-session-' + id })).toBeUndefined()
  expect(await term.find({ type: 'Text', text: 'sess' })).toBeDefined()
})

test('scanned items keep a plain-English detail, shown in the card', async ($, on) => {
  const { disk, clock } = setup(on, { modelText: '{"items":[{"title":"Check CLM GGUF model","kind":"deferred","detail":"The model file may not load. We parked it to finish the fix first."}]}' })
  await start($)
  await scanTurn($, clock, 't1')
  const item = items(disk)[0]
  expect(item.body).toBe('The model file may not load. We parked it to finish the fix first.')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'title-' + item.id })
  expect(await ui.find({ type: 'Text', text: /parked it to finish/ })).toBeDefined()
  await ui.press({ key: 'close-' + item.id })
  expect(await ui.find({ key: 'done-' + item.id })).toBeUndefined()
})

test('the Start choices are short and only Send carries weight', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'go', kind: 'todo' })
  const id = items(disk)[0].id
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'title-' + id })
  await ui.press({ key: 'start-' + id })
  expect((await ui.find({ key: 'start-send-' + id })).props.label).toBe('Send')
  expect((await ui.find({ key: 'start-draft-' + id })).props.plain).toBe(true)
  expect((await ui.find({ key: 'start-copy-' + id })).props.label).toBe('Copy')
})
