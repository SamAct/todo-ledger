import { expect, test } from 'claude-code/testing'
import { parseTodosArgs } from '../src/commands.ts'
import { DIR, setup, start } from './fakes.ts'

const PANE = { plugin: 'todo-ledger', component: 'Pane', requestId: 'todo-ledger', viewport: { columns: 120, rows: 40 },
  props: { title: "ToDo's", isFocused: true, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const

// An item another session (CLI or desktop) wrote straight to disk.
const external = (id: string, title: string) => JSON.stringify({
  id, title, body: '', kind: 'todo', origin: 'agent', status: 'open', project: 'D:\\Projects\\Demo',
  sessionId: 'other-session', source: 'tool', createdAt: '2026-10-03T11:00:00.000Z', updatedAt: '2026-10-03T11:00:00.000Z', notes: [],
})

test('parseTodosArgs understands refresh', async () => {
  expect(parseTodosArgs('refresh')).toEqual({ action: 'refresh' })
})

test('the Refresh button picks up an item another session wrote', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'refresh' })).toBeDefined()
  disk.set(DIR + '\\x1.json', external('x1', 'written by the CLI'))
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Button', text: 'written by the CLI' })).toBeDefined()
})

test('/todos refresh reloads and reports the open count', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  disk.set(DIR + '\\x2.json', external('x2', 'from desktop'))
  const out = await $.command.run({ command: 'todos', args: 'refresh' })
  expect(out.text).toBe('Ledger refreshed: 1 open.')
})

test('the background check reloads when the folder changes, and only then', async ($, on) => {
  const { disk, clock, calls } = setup(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  disk.set(DIR + '\\x3.json', external('x3', 'arrived quietly'))
  await clock.advance(10_000)
  expect(await ui.find({ type: 'Button', text: 'arrived quietly' })).toBeDefined()
  // Nothing changed since: the next ticks list the folder but don't re-read files.
  const reads = calls.reads
  await clock.advance(20_000)
  expect(calls.reads).toBe(reads)
})
