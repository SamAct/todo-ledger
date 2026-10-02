import { expect, test } from 'claude-code/testing'
import { setup, start } from './fakes.ts'

const BAND = { plugin: 'todo-ledger', component: 'AbovePrompt', requestId: 'band', viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 100, scroll: { offset: 0, bodyRows: 5 }, view: {} } } as const

test('update_item save failure returns Not saved and toasts', async ($, on) => {
  const opts: { denyWrite?: string } = {}
  const { disk, calls } = setup(on, opts)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'x', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  opts.denyWrite = 'disk full'
  const out = await $.tool.call({ tool: 'mcp__todo-ledger__update_item', id, status: 'done' })
  expect(String(out.result)).toContain('Not saved')
  expect(calls.toasts.some((t) => t.includes('disk full'))).toBe(true)
})

test('/todo add save failure returns Not saved instead of throwing', async ($, on) => {
  setup(on, { denyWrite: 'disk full' })
  await start($)
  const out = await $.command.run({ command: 'todo', args: 'add buy milk' })
  expect(out.text).toContain('Not saved')
})

test('list_items and /todos list report a load failure instead of throwing', async ($, on) => {
  setup(on, { noHome: true })
  await start($)
  const a = await $.tool.call({ tool: 'mcp__todo-ledger__list_items' })
  expect(String(a.result)).toContain('Not loaded')
  const b = await $.command.run({ command: 'todos', args: 'list' })
  expect(b.text).toContain('Not loaded')
})

test('command register failure falls back to /ledger and /ledger-add', async ($, on) => {
  const { calls } = setup(on, { failRegister: ['todos', 'todo'] })
  await start($)
  expect(calls.commands).toEqual(['ledger', 'ledger-add'])
  const out = await $.command.run({ command: 'ledger-add', args: 'add via fallback' })
  expect(out.text).toContain('via fallback')
  const list = await $.command.run({ command: 'ledger', args: 'list' })
  expect(list.text).toContain('via fallback')
})

test('a pane that was not placed is opened again on the next press', async ($, on) => {
  const { calls } = setup(on, { openPlaced: false })
  await start($)
  await $.command.run({ command: 'todo', args: 'add a' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'ledger-toggle' })
  await ui.press({ key: 'ledger-toggle' })
  expect(calls.opens).toEqual(['todo-ledger', 'todo-ledger'])
  expect(calls.toasts.some((t) => t.includes('no room'))).toBe(true)
})
