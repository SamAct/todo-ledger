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

test('pane tabs filter, input adds a human item, Done closes it', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'agent thing', kind: 'todo' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', text: /agent thing/ })).toBeDefined()
  await ui.press({ key: 'tab-human' })
  expect(await ui.find({ type: 'Button', text: /agent thing/ })).toBeUndefined()
  await ui.input({ key: 'new-item', text: 'human thing' })
  expect(await ui.find({ type: 'Button', text: /human thing/ })).toBeDefined()
  const human = [...disk.values()].map((t) => JSON.parse(t)).find((i) => i.title === 'human thing')
  expect(human.origin).toBe('human')
  await ui.press({ key: 'done-' + human.id })
  expect(await ui.find({ type: 'Button', text: /human thing/ })).toBeUndefined()
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
  expect(await ui.find({ type: 'Button', text: /agent thing/ })).toBeDefined()
  expect(await ui.find({ key: 'new-item' })).toBeUndefined()
})
