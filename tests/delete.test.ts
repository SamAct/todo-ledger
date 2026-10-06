import { expect, test } from 'claude-code/testing'
import { parseTodoCommand } from '../src/commands.ts'
import { DIR, setup, start } from './fakes.ts'

const PANE = { plugin: 'todo-ledger', component: 'Pane', requestId: 'todo-ledger', viewport: { columns: 120, rows: 40 },
  props: { title: "ToDo's", isFocused: true, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as const

const item = (id: string, status: string) => [DIR + '\\' + id + '.json', JSON.stringify({
  id, title: 'item ' + id, body: '', kind: 'todo', origin: 'human', status, project: 'D:\\Projects\\Demo', sessionId: 's',
  source: 'manual', createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', notes: [] })]

test('parseTodoCommand understands delete', async () => {
  expect(parseTodoCommand('delete 2026')).toEqual({ action: 'delete', idPrefix: '2026' })
  expect(parseTodoCommand('delete').action).toBe('error')
})

test('a dropped item can be deleted from the Done tab after confirming', async ($, on) => {
  const { disk } = setup(on, { files: Object.fromEntries([item('d1', 'dropped')]) })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-done' })
  await ui.press({ key: 'title-d1' })
  expect(await ui.find({ key: 'delete-confirm-d1' })).toBeUndefined()
  await ui.press({ key: 'delete-d1' })
  // First press only arms it.
  expect(disk.has(DIR + '\\d1.json')).toBe(true)
  await ui.press({ key: 'delete-confirm-d1' })
  expect(disk.has(DIR + '\\d1.json')).toBe(false)
  expect(await ui.find({ key: 'title-d1' })).toBeUndefined()
})

test('Cancel keeps the item', async ($, on) => {
  const { disk } = setup(on, { files: Object.fromEntries([item('d2', 'dropped')]) })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-done' })
  await ui.press({ key: 'title-d2' })
  await ui.press({ key: 'delete-d2' })
  await ui.press({ key: 'delete-cancel-d2' })
  expect(disk.has(DIR + '\\d2.json')).toBe(true)
  expect(await ui.find({ key: 'delete-d2' })).toBeDefined()
})

test('only dropped items offer deletion; a done item does not', async ($, on) => {
  setup(on, { files: Object.fromEntries([item('k1', 'done')]) })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-done' })
  await ui.press({ key: 'title-k1' })
  expect(await ui.find({ key: 'reopen-k1' })).toBeDefined()
  expect(await ui.find({ key: 'delete-k1' })).toBeUndefined()
})

test('/todo delete removes a dropped item and refuses an open one', async ($, on) => {
  const { disk } = setup(on, { files: Object.fromEntries([item('d3', 'dropped'), item('o3', 'open')]) })
  await start($)
  const ok = await $.command.run({ command: 'todo', args: 'delete d3' })
  expect(ok.text).toBe('Deleted forever: item d3')
  expect(disk.has(DIR + '\\d3.json')).toBe(false)
  const no = await $.command.run({ command: 'todo', args: 'delete o3' })
  expect(no.text).toBe('Only dropped items can be deleted. Drop it first: item o3')
  expect(disk.has(DIR + '\\o3.json')).toBe(true)
  expect((await $.command.run({ command: 'todo', args: 'delete zz' })).text).toBe('No single item matches id zz')
})

test("agents' update_item cannot delete", async ($, on) => {
  const { calls } = setup(on)
  await start($)
  expect(calls.toolDescs.update_item).not.toMatch(/delete forever|permanent/i)
})
