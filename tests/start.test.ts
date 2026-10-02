import { expect, test } from 'claude-code/testing'
import { makeItem } from '../src/item.ts'
import { startOptions, startPrompt, terminalArgv } from '../src/start.ts'
import { setup, start } from './fakes.ts'

const PANE = { plugin: 'todo-ledger', component: 'Pane', requestId: 'todo-ledger', viewport: { columns: 120, rows: 40 },
  props: { title: 'Todos', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const

test('options differ by surface', async () => {
  expect(startOptions('terminal').map((o) => o.value)).toEqual(['send', 'draft', 'terminal'])
  expect(startOptions('desktop').map((o) => o.value)).toEqual(['send', 'draft', 'copy'])
})

test('startPrompt includes id, notes, cross-project warning and close instruction', async () => {
  const item = { ...makeItem({ title: 'Do X', kind: 'deferred', origin: 'agent', source: 'tool', project: 'D:\\A', sessionId: 's', body: 'why', nowMs: 0, hex4: '0000' }),
    notes: [{ by: 'human', text: 'careful', at: 'x' }] } as any
  const p = startPrompt(item, 'D:\\B')
  expect(p).toContain('19700101-000000-0000')
  expect(p).toContain('Do X')
  expect(p).toContain('- human: careful')
  expect(p).toContain('different project')
  expect(p).toContain('update_item')
  expect(startPrompt(item, 'd:\\a')).not.toContain('different project')
})

test('terminalArgv keeps a path with spaces as one argument', async () => {
  const argv = terminalArgv('D:\\My Projects\\x', 'go')
  expect(argv).toEqual(['wt', '-d', 'D:\\My Projects\\x', 'claude', 'go'])
})

test('Send now submits as the user and marks in progress', async ($, on) => {
  const { disk, calls } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'go do', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'start-' + id })
  await ui.select({ key: 'start-choice-' + id, value: 'send' })
  expect(calls.submits[0]).toContain('go do')
  expect(JSON.parse([...disk.values()][0]).status).toBe('in_progress')
})

test('desktop offers Copy, not New terminal session', async ($, on) => {
  const { disk, calls } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'copy me', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'start-' + id })
  const sel = await ui.find({ key: 'start-choice-' + id })
  expect(sel.props.options.map((o: any) => o.value)).toEqual(['send', 'draft', 'copy'])
  await ui.select({ key: 'start-choice-' + id, value: 'copy' })
  expect(calls.copies[0]).toContain('copy me')
})

test('New terminal session runs wt in the item project', async ($, on) => {
  const { disk, calls } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'term', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'start-' + id })
  await ui.select({ key: 'start-choice-' + id, value: 'terminal' })
  expect(calls.argv.some((a) => a[0] === 'wt' && a[2] === 'D:\\Projects\\Demo')).toBe(true)
})
