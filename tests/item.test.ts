import { expect, test } from 'claude-code/testing'
import { cleanTitle, dedupeKey, isOpen, makeItem, newId, parseItem } from '../src/item.ts'

test('newId is sortable timestamp plus hex', async () => {
  expect(newId(Date.UTC(2026, 9, 3, 14, 22, 33), 'a1b2')).toBe('20261003-142233-a1b2')
})

test('cleanTitle collapses newlines and caps at 200 chars', async () => {
  expect(cleanTitle('  fix\n\nthe   thing ')).toBe('fix the thing')
  const long = cleanTitle('x'.repeat(300))
  expect(long.length).toBe(200)
  expect(long.endsWith('...')).toBe(true)
})

test('dedupeKey ignores case and spacing, includes project', async () => {
  expect(dedupeKey('Fix  The Thing', 'D:\\A')).toBe(dedupeKey('fix the thing', 'd:\\a'))
  expect(dedupeKey('fix', 'D:\\A')).not.toBe(dedupeKey('fix', 'D:\\B'))
})

test('makeItem fills defaults', async () => {
  const it = makeItem({ title: 'a', kind: 'deferred', origin: 'agent', source: 'tool', project: 'D:\\A', sessionId: 's', nowMs: 0, hex4: '0000' })
  expect(it).toMatchObject({ id: '19700101-000000-0000', status: 'open', body: '', notes: [], createdAt: '1970-01-01T00:00:00.000Z' })
  expect(isOpen(it)).toBe(true)
})

test('parseItem rejects bad JSON and missing fields', async () => {
  expect(parseItem('{not json')).toBe(null)
  expect(parseItem('{"id":"x"}')).toBe(null)
  const good = makeItem({ title: 'a', kind: 'todo', origin: 'human', source: 'manual', project: 'p', sessionId: 's', nowMs: 0, hex4: '0000' })
  expect(parseItem(JSON.stringify(good))).toEqual(good)
})
