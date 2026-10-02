import { expect, test } from 'claude-code/testing'
import { setup, start } from './fakes.ts'

const call = (todos: any[]) => ({ tool: 'TodoWrite', todos })

test('new TodoWrite items are mirrored as agent todos', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  const out = await $.tool.call(call([
    { content: 'Write tests', status: 'pending', activeForm: 'Writing tests' },
    { content: 'Ship it', status: 'in_progress', activeForm: 'Shipping' },
  ]))
  expect(out.result).toBe('engine-ran')
  const items = [...disk.values()].map((t) => JSON.parse(t))
  expect(items.length).toBe(2)
  expect(items.every((i) => i.origin === 'agent' && i.source === 'todowrite' && i.kind === 'todo')).toBe(true)
  expect(items.find((i) => i.title === 'Ship it').status).toBe('in_progress')
})

test('completed in TodoWrite closes the mirrored item; repeats add nothing', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call(call([{ content: 'Write tests', status: 'pending', activeForm: 'x' }]))
  await $.tool.call(call([{ content: 'Write tests', status: 'pending', activeForm: 'x' }]))
  expect(disk.size).toBe(1)
  expect(JSON.parse([...disk.values()][0]).notes.length).toBe(0)
  await $.tool.call(call([{ content: 'Write tests', status: 'completed', activeForm: 'x' }]))
  expect(JSON.parse([...disk.values()][0]).status).toBe('done')
})

test('a TodoWrite entry matching a parked item links to it without note spam, and completed closes it', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'Write tests', kind: 'todo' })
  await $.tool.call(call([{ content: 'Write tests', status: 'pending', activeForm: 'x' }]))
  await $.tool.call(call([{ content: 'Write tests', status: 'in_progress', activeForm: 'x' }]))
  await $.tool.call(call([{ content: 'Write tests', status: 'in_progress', activeForm: 'x' }]))
  expect(disk.size).toBe(1)
  expect(JSON.parse([...disk.values()][0]).notes.length).toBe(0)
  await $.tool.call(call([{ content: 'Write tests', status: 'completed', activeForm: 'x' }]))
  expect(JSON.parse([...disk.values()][0]).status).toBe('done')
})

test('a mirror failure never blocks TodoWrite', async ($, on) => {
  const { calls } = setup(on, { denyWrite: 'disk full' })
  await start($)
  const out = await $.tool.call(call([{ content: 'a', status: 'pending', activeForm: 'a' }]))
  expect(out.result).toBe('engine-ran')
  expect(calls.logs.some((l) => l.includes('disk full'))).toBe(true)
})
