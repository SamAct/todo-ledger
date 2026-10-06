import { expect, test } from 'claude-code/testing'
import { makeItem } from '../src/item.ts'
import { TABS, age, bandLabel, firstView, groupItems, itemsForTab, kindTag, tabOf } from '../src/view.ts'

const mk = (over: any) => ({ ...makeItem({ title: 't', kind: 'todo', origin: 'agent', source: 'tool', project: 'P', sessionId: 's', nowMs: 0, hex4: '0000' }), ...over })

test('tabs are Agent, Human, Done', async () => {
  expect(TABS.map((t) => t.id)).toEqual(['agent', 'human', 'done'])
})

test('open items go to a tab by origin, whatever their kind', async () => {
  expect(tabOf(mk({ origin: 'agent', kind: 'todo' }))).toBe('agent')
  expect(tabOf(mk({ origin: 'agent', kind: 'proposal' }))).toBe('agent')
  expect(tabOf(mk({ origin: 'agent', kind: 'deferred' }))).toBe('agent')
  expect(tabOf(mk({ origin: 'human', kind: 'deferred' }))).toBe('human')
  expect(tabOf(mk({ origin: 'human', kind: 'discussion' }))).toBe('human')
  expect(tabOf(mk({ status: 'dropped' }))).toBe('done')
  expect(tabOf(mk({ status: 'done', origin: 'human' }))).toBe('done')
})

test('groupItems orders by what the item needs and drops empty groups', async () => {
  const items = [mk({ id: 'a', kind: 'deferred' }), mk({ id: 'b', kind: 'todo' }), mk({ id: 'c', kind: 'proposal' }), mk({ id: 'd', kind: 'proposal' })]
  const groups = groupItems(items)
  expect(groups.map((g) => g.label)).toEqual(['Needs decision', 'To do', 'Parked'])
  expect(groups[0].items.map((i) => i.id)).toEqual(['c', 'd'])
  expect(groupItems([])).toEqual([])
})

test('kindTag marks every kind except plain todo', async () => {
  expect(kindTag('todo')).toBe('')
  expect(kindTag('deferred')).toBe('[parked] ')
  expect(kindTag('proposal')).toBe('[proposal] ')
  expect(kindTag('discussion')).toBe('💬 ')
})

test('itemsForTab filters project, sorts newest first, caps', async () => {
  const items = Array.from({ length: 120 }, (_, n) => mk({ id: 'i' + n, createdAt: new Date(n * 1000).toISOString() }))
  const shown = itemsForTab([...items, mk({ id: 'other', project: 'Q' })], 'agent', 'p')
  expect(shown.length).toBe(100)
  expect(shown[0].id).toBe('i119')
  expect(itemsForTab(items, 'agent', null).length).toBe(100)
})

test('bandLabel counts open and new agent items; always drawn', async () => {
  expect(bandLabel([], null)).toBe("☰ ToDo's")
  const items = [mk({ createdAt: '2026-10-03T10:00:00.000Z' }), mk({ origin: 'human', createdAt: '2026-10-03T11:00:00.000Z' }), mk({ status: 'done' })]
  expect(bandLabel(items, '2026-10-03T09:00:00.000Z')).toBe("☰ ToDo's 2 · 1 new")
  expect(bandLabel(items, '2026-10-03T12:00:00.000Z')).toBe("☰ ToDo's 2")
  // Scoped to the project the pane opens on.
  expect(bandLabel(items, null, 'D:/elsewhere')).toBe("☰ ToDo's")
})

test('firstView opens a tab with items and falls back to all projects', async () => {
  const agent = mk({ origin: 'agent' })
  const human = mk({ origin: 'human' })
  expect(firstView([human], human.project, 'agent', false)).toEqual({ tab: 'human', allProjects: false })
  expect(firstView([agent, human], agent.project, 'human', false)).toEqual({ tab: 'human', allProjects: false })
  expect(firstView([agent], 'D:/elsewhere', 'agent', false)).toEqual({ tab: 'agent', allProjects: true })
  expect(firstView([], 'D:/x', 'done', false)).toEqual({ tab: 'done', allProjects: false })
})

test('age', async () => {
  const now = Date.UTC(2026, 9, 3, 12)
  expect(age(now, new Date(now - 30_000).toISOString())).toBe('now')
  expect(age(now, new Date(now - 5 * 60_000).toISOString())).toBe('5m')
  expect(age(now, new Date(now - 3 * 3600_000).toISOString())).toBe('3h')
  expect(age(now, new Date(now - 2 * 86400_000).toISOString())).toBe('2d')
})
