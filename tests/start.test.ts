import { expect, test } from 'claude-code/testing'
import { makeItem } from '../src/item.ts'
import { fallbackArgv, startOptions, startPrompt, terminalArgv, terminalTask } from '../src/start.ts'
import { HOME, setup, start } from './fakes.ts'

const PANE = { plugin: 'todo-ledger', component: 'Pane', requestId: 'todo-ledger', viewport: { columns: 120, rows: 40 },
  props: { title: "ToDo's", isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const

test('options differ by surface and each has its own hotkey', async () => {
  expect(startOptions('terminal').map((o) => o.value)).toEqual(['send', 'draft', 'terminal'])
  expect(startOptions('desktop').map((o) => o.value)).toEqual(['send', 'draft', 'copy'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const keys = startOptions(surface).map((o) => o.hotkey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.every((k) => /^[a-z]$/.test(k))).toBe(true)
  }
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

test('terminalArgv escapes ; for wt and removes newlines', async () => {
  const argv = terminalArgv('D:\\a;b', 'one; two\nthree')
  expect(argv).toEqual(['wt', '-d', 'D:\\a\\;b', 'claude', 'one\\; two three'])
})

test('fallbackArgv has no && and passes one-line task to claude in the new window', async () => {
  const argv = fallbackArgv('D:\\My Projects\\x', 'a\r\nb')
  expect(argv).toEqual(['cmd', '/c', 'start', '', '/d', 'D:\\My Projects\\x', 'cmd', '/k', 'claude', 'a b'])
  expect(argv.includes('&&')).toBe(false)
})

test('terminalTask is one line and names the file', async () => {
  const t = terminalTask('id1', 'C:\\f.md')
  expect(t).toContain('C:\\f.md')
  expect(t).toContain('id1')
  expect(/[\n;]/.test(t)).toBe(false)
})

test('Send now submits as the user and marks in progress', async ($, on) => {
  const { disk, calls } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'go do', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'title-' + id })
  await ui.press({ key: 'start-' + id })
  await ui.press({ key: 'start-send-' + id })
  expect(calls.submits[0]).toContain('go do')
  expect(JSON.parse([...disk.values()][0]).status).toBe('in_progress')
})

test('desktop offers Copy, not New terminal session', async ($, on) => {
  const { disk, calls } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'copy me', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'title-' + id })
  await ui.press({ key: 'start-' + id })
  expect(await ui.find({ key: 'start-copy-' + id })).toBeDefined()
  expect(await ui.find({ key: 'start-terminal-' + id })).toBeUndefined()
  expect(await ui.find({ type: 'Select' })).toBeUndefined()
  await ui.press({ key: 'start-copy-' + id })
  expect(calls.copies[0]).toContain('copy me')
})

test('New terminal session runs wt in the item project', async ($, on) => {
  const { disk, calls } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'term', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'title-' + id })
  await ui.press({ key: 'start-' + id })
  await ui.press({ key: 'start-terminal-' + id })
  expect(calls.argv.some((a) => a[0] === 'wt' && a[2] === 'D:\\Projects\\Demo')).toBe(true)
})

test('New terminal session keeps ; and newlines off the command line and writes the prompt to a file', async ($, on) => {
  const { disk, calls } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'fix a; then b', kind: 'todo', body: 'line1\nline2; more' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'title-' + id })
  await ui.press({ key: 'start-' + id })
  await ui.press({ key: 'start-terminal-' + id })
  const wt = calls.argv.find((a) => a[0] === 'wt')!
  expect(wt.some((a) => a.includes('\n'))).toBe(false)
  expect(wt.some((a) => /(^|[^\\]);/.test(a))).toBe(false)
  const file = HOME + '\\.claude\\todo-ledger\\start\\' + id + '.md'
  expect(disk.get(file)).toContain('fix a; then b')
  expect(disk.get(file)).toContain('line2; more')
  expect(wt[4]).toContain(file)
})

test('New terminal session falls back to cmd start without && when wt fails', async ($, on) => {
  const { disk, calls } = setup(on, { failArgv0: 'wt' })
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'term2', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'title-' + id })
  await ui.press({ key: 'start-' + id })
  await ui.press({ key: 'start-terminal-' + id })
  const fb = calls.argv.find((a) => a[0] === 'cmd' && a[2] === 'start')!
  expect(fb.includes('&&')).toBe(false)
  expect(fb.slice(6, 9)).toEqual(['cmd', '/k', 'claude'])
})

test('Copy reports a failed copy', async ($, on) => {
  const { disk, calls } = setup(on, { copyFails: true })
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'copy fail', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'title-' + id })
  await ui.press({ key: 'start-' + id })
  await ui.press({ key: 'start-copy-' + id })
  expect(calls.toasts.some((t) => t.includes('no-clipboard'))).toBe(true)
  expect(calls.toasts.includes('Prompt copied')).toBe(false)
})

test('Start chooser is one button per way, Send now the primary, in place of the actions', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'ways', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'title-' + id })
  await ui.press({ key: 'start-' + id })
  expect((await ui.find({ key: 'start-send-' + id })).props.variant).toBe('primary')
  expect((await ui.find({ key: 'start-draft-' + id })).props.variant).toBeUndefined()
  expect(await ui.find({ key: 'done-' + id })).toBeUndefined()
  expect(await ui.find({ key: 'start-' + id })).toBeUndefined()
  await ui.press({ key: 'start-draft-' + id })
  expect(await ui.find({ key: 'start-' + id })).toBeDefined()
})

test('Start works on mobile too, now that it needs no Select', async ($, on) => {
  const { disk, calls } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'phone', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await ui.press({ key: 'title-' + id })
  await ui.press({ key: 'start-' + id })
  await ui.press({ key: 'start-send-' + id })
  expect(calls.submits[0]).toContain('phone')
})

test('Start chooser can be cancelled', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'cancel me', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'title-' + id })
  await ui.press({ key: 'start-' + id })
  await ui.press({ key: 'start-cancel-' + id })
  expect(await ui.find({ key: 'start-' + id })).toBeTruthy()
})
