import { expect, test } from 'claude-code/testing'
import { setup, start } from './fakes.ts'

const BAND = { plugin: 'todo-ledger', component: 'AbovePrompt', requestId: 'band', viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 100, scroll: { offset: 0, bodyRows: 5 }, view: {} } } as const
const PANE = { plugin: 'todo-ledger', component: 'Pane', requestId: 'todo-ledger', viewport: { columns: 120, rows: 40 },
  props: { title: 'Todos', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const

// Item titles are drawn as Button labels, so title lookups use type 'Button' (api-notes item 15).

test('empty ledger: band keeps engine content and adds no button', async ($, on) => {
  setup(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'ledger-toggle' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
})

test('band shows count and opens the pane', async ($, on) => {
  // The kit rejects a second on('ui.open'), so setup's stub records the opened ids.
  const { calls } = setup(on)
  await start($)
  await $.command.run({ command: 'todo', args: 'add a' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'ledger-toggle' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'ledger-toggle' })
  expect(calls.opens).toEqual(['todo-ledger'])
})

test('band yields to a survey', async ($, on) => {
  setup(on)
  await start($)
  await $.command.run({ command: 'todo', args: 'add a' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ key: 'ledger-toggle' })).toBeUndefined()
})

test('pane has no add box; tabs show counts and filter; Done closes an item', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'agent thing', kind: 'todo' })
  await $.command.run({ command: 'todo', args: 'add human thing' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'new-item' })).toBeUndefined()
  expect(await ui.find({ key: 'new-kind' })).toBeUndefined()
  expect((await ui.find({ key: 'tab-agent' })).props.label).toBe('Agent 1')
  expect((await ui.find({ key: 'tab-human' })).props.label).toBe('Human 1')
  expect(await ui.find({ type: 'Button', text: 'agent thing' })).toBeDefined()
  await ui.press({ key: 'tab-human' })
  expect(await ui.find({ type: 'Button', text: 'agent thing' })).toBeUndefined()
  const human = [...disk.values()].map((t) => JSON.parse(t)).find((i) => i.title === 'human thing')
  await ui.press({ key: 'title-' + human.id })
  await ui.press({ key: 'done-' + human.id })
  expect(await ui.find({ type: 'Button', text: 'human thing' })).toBeUndefined()
})

test('terminal shows a row\'s actions only once the row is selected', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'pick me', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'start-' + id })).toBeUndefined()
  await ui.press({ key: 'title-' + id })
  expect(await ui.find({ key: 'start-' + id })).toBeDefined()
})

test('desktop draws actions in a hover-revealed row', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'hover me', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // The row is the keyed hover scope; its meta line's second child holds the actions.
  const row = await ui.find({ key: 'row-' + id })
  const actions = row.children[1].children[1]
  // Hidden at rest (revealed by hover in the app; the kit strips hover props).
  expect(actions.props.display).toBe('none')
  expect(actions.props.key).toBeUndefined()
  // Clicking the title shows them without relying on hover.
  await ui.press({ key: 'title-' + id })
  const shown = (await ui.find({ key: 'row-' + id })).children[1].children[1]
  expect(shown.props.display).toBeUndefined()
  expect(await ui.find({ key: 'start-' + id })).toBeDefined()
})

test('kind shows as a tag beside the title, not in the tabs', async ($, on) => {
  setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'later work', kind: 'deferred' })
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'an idea', kind: 'proposal' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'PARKED' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'PROPOSAL' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'later work' })).toBeDefined()
  expect(await ui.find({ key: 'tab-parked' })).toBeUndefined()
})

test('scope toggle switches between this project and all projects', async ($, on) => {
  setup(on, { files: { 'C:\\Users\\t\\.claude\\todo-ledger\\items\\o.json': JSON.stringify({ id: 'o', title: 'elsewhere', body: '', kind: 'todo', origin: 'agent', status: 'open', project: 'D:\\Other', sessionId: 's', source: 'tool', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', notes: [] }) } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', text: 'elsewhere' })).toBeUndefined()
  await ui.press({ key: 'scope' })
  expect(await ui.find({ type: 'Button', text: 'elsewhere' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Other/ })).toBeDefined()
})

test('empty tab explains how items arrive', async ($, on) => {
  setup(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /\/todo add/ })).toBeDefined()
})

test('note input appends a human note', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'discuss me', kind: 'discussion' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'note-' + id })
  await ui.input({ key: 'note-input-' + id, text: 'my view' })
  const item = JSON.parse([...disk.values()][0])
  expect(item.notes.at(-1)).toMatchObject({ by: 'human', text: 'my view' })
})

test('pane on mobile draws items without Input or Select', async ($, on) => {
  setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'agent thing', kind: 'todo' })
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ type: 'Button', text: 'agent thing' })).toBeDefined()
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
})
