import { expect, test } from 'claude-code/testing'
import { setup, start } from './fakes.ts'

const PANE = { plugin: 'todo-ledger', component: 'Pane', requestId: 'todo-ledger', viewport: { columns: 120, rows: 40 },
  props: { title: 'Todos', isFocused: true, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as const

const LONG = 'Write Claude Pop lyric-video design doc from the code because no recorded doc exists anywhere'

test('a captured item records the session name from the transcript', async ($, on) => {
  const { disk } = setup(on, { sessionTitle: 'GeneralQues' })
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'named', kind: 'todo' })
  expect(JSON.parse([...disk.values()][0]).sessionName).toBe('GeneralQues')
})

test('an unnamed session stores no name and shows the short id', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'unnamed', kind: 'todo' })
  const item = JSON.parse([...disk.values()][0])
  expect('sessionName' in item).toBe(false)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /· sess · / })).toBeDefined()
})

test('list rows clip long titles to one line and show project, session and age', async ($, on) => {
  const { disk } = setup(on, { sessionTitle: 'GeneralQues' })
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: LONG, kind: 'proposal' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const label = (await ui.find({ key: 'title-' + id })).props.label
  expect(label.length <= 36).toBe(true)
  expect(label.endsWith('…')).toBe(true)
  expect(await ui.find({ type: 'Text', text: 'Demo · GeneralQues · now' })).toBeDefined()
})

test('the open card shows the full title, session line, details and a notes thread', async ($, on) => {
  const { disk } = setup(on, { sessionTitle: 'GeneralQues' })
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: LONG, kind: 'proposal', body: 'some details' })
  const id = JSON.parse([...disk.values()][0]).id
  await $.tool.call({ tool: 'mcp__todo-ledger__update_item', id, note: 'agent thought' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'title-' + id })
  expect(await ui.find({ type: 'Text', text: LONG })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Session GeneralQues · sess' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'some details' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Notes · 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Claude · now' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'agent thought' })).toBeDefined()
})

test('Add note opens a composer that can be cancelled or submitted', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'noteworthy', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'title-' + id })
  await ui.press({ key: 'note-' + id })
  expect(await ui.find({ key: 'note-' + id })).toBeUndefined()
  await ui.press({ key: 'note-cancel-' + id })
  expect(await ui.find({ key: 'note-input-' + id })).toBeUndefined()
  await ui.press({ key: 'note-' + id })
  await ui.input({ key: 'note-input-' + id, text: 'my view' })
  expect(JSON.parse([...disk.values()][0]).notes.at(-1)).toMatchObject({ by: 'human', text: 'my view' })
  expect(await ui.find({ type: 'Text', text: 'You · now' })).toBeDefined()
})

test('agents can read an item in full with get_item', async ($, on) => {
  const { disk } = setup(on, { sessionTitle: 'GeneralQues' })
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'look me up', kind: 'deferred', body: 'context' })
  const id = JSON.parse([...disk.values()][0]).id
  const out = await $.tool.call({ tool: 'mcp__todo-ledger__get_item', id: id.slice(0, 18) })
  expect(out.result).toContain('look me up')
  expect(out.result).toContain('session: GeneralQues (sess-1)')
  expect(out.result).toContain('context')
  expect((await $.tool.call({ tool: 'mcp__todo-ledger__get_item', id: '' })).result).toContain('No single item')
})

test('agents can edit title, kind and details, and remove by dropping', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'draft', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const out = await $.tool.call({ tool: 'mcp__todo-ledger__update_item', id, title: 'final title', kind: 'deferred', body: 'why' })
  expect(out.result).toContain('title')
  expect(JSON.parse([...disk.values()][0])).toMatchObject({ title: 'final title', kind: 'deferred', body: 'why', status: 'open' })
  await $.tool.call({ tool: 'mcp__todo-ledger__update_item', id, status: 'dropped' })
  expect(JSON.parse([...disk.values()][0]).status).toBe('dropped')
  const bad = await $.tool.call({ tool: 'mcp__todo-ledger__update_item', id, kind: 'wish' })
  expect(bad.result).toContain('kind must be one of')
})

test('list_items lines carry status and session for the agent', async ($, on) => {
  setup(on, { sessionTitle: 'GeneralQues' })
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'listed', kind: 'todo' })
  const out = await $.tool.call({ tool: 'mcp__todo-ledger__list_items' })
  expect(out.result).toContain('(todo, agent, open) listed  · session GeneralQues')
})
