import { expect, test } from 'claude-code/testing'
import { setup, start } from './fakes.ts'

test('tools are registered with instructions in the description', async ($, on) => {
  // The kit rejects a second on('tool.register'), so setup's stub records the descriptions.
  const { calls } = setup(on)
  await start($)
  expect(Object.keys(calls.toolDescs)).toEqual(['park_item', 'list_items', 'update_item'])
  expect(calls.toolDescs.park_item).toMatch(/defer/i)
})

test('park_item stores an agent item', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  const out = await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'Test Plumb logprobs', kind: 'proposal', body: 'needs LM Studio' })
  expect(out.result).toContain('Parked')
  const item = JSON.parse([...disk.values()][0])
  expect(item).toMatchObject({ origin: 'agent', source: 'tool', kind: 'proposal', body: 'needs LM Studio' })
})

test('park_item rejects an unknown kind without saving', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  const out = await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'x', kind: 'wish' })
  expect(out.result).toContain('kind must be one of')
  expect(disk.size).toBe(0)
})

test('update_item closes with a note', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'y', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const out = await $.tool.call({ tool: 'mcp__todo-ledger__update_item', id, status: 'done', note: 'shipped' })
  expect(out.result).toContain('done')
  const item = JSON.parse([...disk.values()][0])
  expect(item.status).toBe('done')
  expect(item.notes[0].text).toBe('shipped')
})

test('list_items returns this project by default', async ($, on) => {
  setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'z', kind: 'deferred' })
  const out = await $.tool.call({ tool: 'mcp__todo-ledger__list_items' })
  expect(out.result).toContain('z')
})
