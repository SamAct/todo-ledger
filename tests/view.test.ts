import { expect, test } from 'claude-code/testing'
import { makeItem } from '../src/item.ts'
import { age, bandLabel, itemsForTab, tabOf } from '../src/view.ts'

const mk = (over: any) => ({ ...makeItem({ title: 't', kind: 'todo', origin: 'agent', source: 'tool', project: 'P', sessionId: 's', nowMs: 0, hex4: '0000' }), ...over })

test('every open item lands in exactly one tab', async () => {
  expect(tabOf(mk({ origin: 'agent', kind: 'todo' }))).toBe('agent')
  expect(tabOf(mk({ origin: 'agent', kind: 'discussion' }))).toBe('agent')
  expect(tabOf(mk({ origin: 'human', kind: 'todo' }))).toBe('human')
  expect(tabOf(mk({ origin: 'human', kind: 'deferred' }))).toBe('parked')
  expect(tabOf(mk({ origin: 'agent', kind: 'proposal' }))).toBe('proposals')
  expect(tabOf(mk({ status: 'dropped' }))).toBe('done')
})

test('itemsForTab filters project, sorts newest first, caps', async () => {
  const items = Array.from({ length: 120 }, (_, n) => mk({ id: 'i' + n, createdAt: new Date(n * 1000).toISOString() }))
  const shown = itemsForTab([...items, mk({ id: 'other', project: 'Q' })], 'agent', 'p')
  expect(shown.length).toBe(100)
  expect(shown[0].id).toBe('i119')
  expect(itemsForTab(items, 'agent', null).length).toBe(100)
})

test('bandLabel counts open and new agent items; null when nothing', async () => {
  expect(bandLabel([], null)).toBe(null)
  const items = [mk({ createdAt: '2026-10-03T10:00:00.000Z' }), mk({ origin: 'human', createdAt: '2026-10-03T11:00:00.000Z' }), mk({ status: 'done' })]
  expect(bandLabel(items, '2026-10-03T09:00:00.000Z')).toBe('☰ Todos  2 open · 1 new')
  expect(bandLabel(items, '2026-10-03T12:00:00.000Z')).toBe('☰ Todos  2 open')
})

test('age', async () => {
  const now = Date.UTC(2026, 9, 3, 12)
  expect(age(now, new Date(now - 30_000).toISOString())).toBe('now')
  expect(age(now, new Date(now - 5 * 60_000).toISOString())).toBe('5m')
  expect(age(now, new Date(now - 3 * 3600_000).toISOString())).toBe('3h')
  expect(age(now, new Date(now - 2 * 86400_000).toISOString())).toBe('2d')
})
