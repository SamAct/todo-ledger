import { expect, test } from 'claude-code/testing'
import { formatList, parseTodoCommand, parseTodosArgs } from '../src/commands.ts'
import { setup, start } from './fakes.ts'

test('parseTodoCommand handles flags', async () => {
  expect(parseTodoCommand('add fix it')).toEqual({ action: 'add', kind: 'todo', text: 'fix it' })
  expect(parseTodoCommand('add -d later thing')).toEqual({ action: 'add', kind: 'deferred', text: 'later thing' })
  expect(parseTodoCommand('add -p idea')).toEqual({ action: 'add', kind: 'proposal', text: 'idea' })
  expect(parseTodoCommand('add -n talk')).toEqual({ action: 'add', kind: 'discussion', text: 'talk' })
  expect(parseTodoCommand('done 2026')).toEqual({ action: 'done', idPrefix: '2026' })
  expect(parseTodoCommand('add').action).toBe('error')
  expect(parseTodoCommand('').action).toBe('error')
})

test('parseTodosArgs', async () => {
  expect(parseTodosArgs('')).toEqual({ action: 'toggle' })
  expect(parseTodosArgs('list')).toEqual({ action: 'list', all: false })
  expect(parseTodosArgs('list all')).toEqual({ action: 'list', all: true })
})

test('formatList on empty', async () => {
  expect(formatList([], 'p', false)).toBe('No open ledger items for this project.')
})

test('/todo add -d stores a human deferred item', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  const out = await $.command.run({ command: 'todo', args: 'add -d check CLM GGUF' })
  expect(out.text).toContain('check CLM GGUF')
  const item = JSON.parse([...disk.values()][0])
  expect(item).toMatchObject({ kind: 'deferred', origin: 'human', source: 'manual', project: 'D:\\Projects\\Demo' })
})

test('/todo done closes by id prefix', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.command.run({ command: 'todo', args: 'add x' })
  const id = JSON.parse([...disk.values()][0]).id
  const out = await $.command.run({ command: 'todo', args: 'done ' + id.slice(0, 15) })
  expect(out.text).toContain('Done')
  expect(JSON.parse([...disk.values()][0]).status).toBe('done')
})

test('/todos list filters to this project unless all', async ($, on) => {
  const other = JSON.stringify({ id: 'o', title: 'elsewhere', body: '', kind: 'todo', origin: 'human', status: 'open', project: 'D:\\Other', sessionId: 's', source: 'manual', createdAt: 'x', updatedAt: 'x', notes: [] })
  setup(on, { files: { 'C:\\Users\\t\\.claude\\todo-ledger\\items\\o.json': other } })
  await start($)
  await $.command.run({ command: 'todo', args: 'add here' })
  const mine = await $.command.run({ command: 'todos', args: 'list' })
  expect(mine.text).toContain('here')
  expect(mine.text).not.toContain('elsewhere')
  const all = await $.command.run({ command: 'todos', args: 'list all' })
  expect(all.text).toContain('elsewhere')
})
