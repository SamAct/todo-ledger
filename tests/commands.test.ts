import { expect, test } from 'claude-code/testing'
import { formatList, parseTodoCommand, parseTodosArgs } from '../src/commands.ts'

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
