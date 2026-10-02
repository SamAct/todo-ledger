import { expect, test } from 'claude-code/testing'
import { DIR, setup, start } from './fakes.ts'

const good = (id: string, title: string) => JSON.stringify({
  id, title, body: '', kind: 'todo', origin: 'human', status: 'open', project: 'D:\\Projects\\Demo',
  sessionId: 's', source: 'manual', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', notes: [],
})

test('a corrupt file is skipped and the rest load', async ($, on) => {
  const { calls } = setup(on, { files: {
    [DIR + '\\a.json']: good('a', 'first'),
    [DIR + '\\b.json']: '{"id":"b", "title": "half writ',
    [DIR + '\\c.json']: good('c', 'third'),
  } })
  await start($)
  const out = await $.command.run({ command: 'todos', args: 'list' })
  expect(out.text).toContain('first')
  expect(out.text).toContain('third')
  expect(calls.logs.some((l) => l.includes('b.json'))).toBe(true)
})

test('saving writes tmp then moves it into place', async ($, on) => {
  const { disk, calls } = setup(on)
  await start($)
  await $.command.run({ command: 'todo', args: 'add buy milk' })
  const files = [...disk.keys()]
  expect(files.length).toBe(1)
  expect(files[0].endsWith('.json')).toBe(true)
  expect(calls.argv.some((a) => a[2] === 'move' && a[4].endsWith('.json.tmp'))).toBe(true)
})

test('same title in same project adds a note instead of a new file', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.command.run({ command: 'todo', args: 'add Buy  Milk' })
  await $.command.run({ command: 'todo', args: 'add buy milk' })
  expect(disk.size).toBe(1)
  const item = JSON.parse([...disk.values()][0])
  expect(item.notes.length).toBe(1)
})
