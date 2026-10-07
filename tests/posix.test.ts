import { expect, test } from 'claude-code/testing'
import { POSIX_HOME, setup, start } from './fakes.ts'

// macOS and Linux: HOME, '/' paths, mv and rm instead of cmd.
const DIR = POSIX_HOME + '/.claude/todo-ledger/items'

test('on macOS/Linux items save under HOME with / paths and mv', async ($, on) => {
  const { disk, calls } = setup(on, { posix: true })
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'posix item', kind: 'todo' })
  const keys = [...disk.keys()]
  expect(keys.length).toBe(1)
  expect(keys[0].startsWith(DIR + '/')).toBe(true)
  expect(calls.argv.some((a) => a[0] === 'mv' && a[1] === '-f')).toBe(true)
  expect(calls.argv.some((a) => a[0] === 'cmd')).toBe(false)
})

test('on macOS/Linux a dropped item is deleted with rm', async ($, on) => {
  const { disk, calls } = setup(on, { posix: true })
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'gone soon', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  await $.tool.call({ tool: 'mcp__todo-ledger__update_item', id, status: 'dropped' })
  const out = await $.command.run({ command: 'todo', args: 'delete ' + id })
  expect(out.text).toContain('Deleted forever')
  expect(disk.size).toBe(0)
  expect(calls.argv.some((a) => a[0] === 'rm')).toBe(true)
})

test('on macOS/Linux the session name lookup uses find and grep', async ($, on) => {
  const { calls, clock } = setup(on, { posix: true })
  await start($)
  await clock.settle()
  expect(calls.argv.some((a) => a[0] === 'find')).toBe(true)
})
