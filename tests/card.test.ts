import { expect, test } from 'claude-code/testing'
import { setup, start } from './fakes.ts'

const PANE = { plugin: 'todo-ledger', component: 'Pane', requestId: 'todo-ledger', viewport: { columns: 120, rows: 40 },
  props: { title: "ToDo's", isFocused: true, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as const

const LONG = 'Write Claude Pop lyric-video design doc from the code because no recorded doc exists anywhere'

test('a captured item records the session name from the transcript', async ($, on) => {
  const { disk } = setup(on, { sessionTitle: 'GeneralQues' })
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'named', kind: 'todo' })
  expect(JSON.parse([...disk.values()][0]).sessionName).toBe('GeneralQues')
})

test('an unnamed session stores no name and shows the short id', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'unnamed', kind: 'todo' })
  const item = JSON.parse([...disk.values()][0])
  expect('sessionName' in item).toBe(false)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', text: 'sess' })).toBeDefined()
})

test('list rows wrap long titles to two lines and show project, session and age', async ($, on) => {
  const { disk } = setup(on, { sessionTitle: 'GeneralQues' })
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: LONG, kind: 'proposal' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const first = (await ui.find({ key: 'title-' + id })).props.label
  const second = (await ui.find({ key: 'title2-' + id })).props.label
  expect(first.length <= 36 && second.length <= 36).toBe(true)
  expect(LONG.startsWith(first)).toBe(true)
  expect(second.endsWith('…')).toBe(true)
  expect(await ui.find({ type: 'Text', text: 'GeneralQues' })).toBeDefined()
  // Each title line opens the card.
  await ui.press({ key: 'title2-' + id })
  expect(await ui.find({ type: 'Text', text: LONG })).toBeDefined()
})

test('the open card shows the full title, one meta line, details and a notes thread', async ($, on) => {
  const { disk } = setup(on, { sessionTitle: 'GeneralQues' })
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: LONG, kind: 'proposal', body: 'some details' })
  const id = JSON.parse([...disk.values()][0]).id
  await $.tool.call({ tool: 'mcp__todo-ledger__update_item', id, note: 'agent thought' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'title-' + id })
  expect(await ui.find({ type: 'Text', text: LONG })).toBeDefined()
  // One meta line, the same as a row's: session and age; no kind word, no raw session id.
  expect(await ui.find({ type: 'Text', text: 'GeneralQues' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Session / })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /proposal/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'some details' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Notes' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Claude · now' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'agent thought' })).toBeDefined()
})

test('Note opens a composer; the Note button becomes Cancel until it closes', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'noteworthy', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'title-' + id })
  await ui.press({ key: 'note-' + id })
  expect(await ui.find({ key: 'note-' + id })).toBeUndefined()
  expect(await ui.find({ key: 'note-cancel-' + id })).toBeDefined()
  // No "Notes" heading over an empty thread: the field alone is enough.
  expect(await ui.find({ type: 'Text', text: 'Notes' })).toBeUndefined()
  await ui.press({ key: 'note-cancel-' + id })
  expect(await ui.find({ key: 'note-input-' + id })).toBeUndefined()
  expect(await ui.find({ key: 'note-' + id })).toBeDefined()
  await ui.press({ key: 'note-' + id })
  await ui.input({ key: 'note-input-' + id, text: 'my view' })
  expect(JSON.parse([...disk.values()][0]).notes.at(-1)).toMatchObject({ by: 'human', text: 'my view' })
  expect(await ui.find({ type: 'Text', text: 'You · now' })).toBeDefined()
})

test('a long note shows in full, wrapped, under the one-line field while typing', async ($, on) => {
  const { disk, clock } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'wordy', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'title-' + id })
  await ui.press({ key: 'note-' + id })
  const LONGNOTE = 'Keep the public API unchanged and add the retry only behind a flag, because two other services call this endpoint.'
  await ui.input({ key: 'note-input-' + id, text: 'short', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: 'short' })).toBeUndefined()
  await ui.input({ key: 'note-input-' + id, text: LONGNOTE, kind: 'change' })
  // The preview catches up after typing pauses, not on every key.
  expect(await ui.find({ type: 'Text', text: LONGNOTE })).toBeUndefined()
  await clock.advance(400)
  expect(await ui.find({ type: 'Text', text: LONGNOTE })).toBeDefined()
  await ui.input({ key: 'note-input-' + id, text: LONGNOTE })
  expect(JSON.parse([...disk.values()][0]).notes.at(-1)).toMatchObject({ by: 'human', text: LONGNOTE })
  // Reopening the composer starts empty: the draft was cleared by the submit.
  await ui.press({ key: 'note-' + id })
  expect((await ui.find({ key: 'note-input-' + id })).props.value ?? '').toBe('')
  // The field is never given a value to draw, so a redraw cannot overwrite typing.
  expect((await ui.find({ key: 'note-input-' + id })).props.value).toBeUndefined()
})

test('agents can read an item in full with get_item', async ($, on) => {
  const { disk } = setup(on, { sessionTitle: 'GeneralQues' })
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'look me up', kind: 'deferred', body: 'context' })
  const id = JSON.parse([...disk.values()][0]).id
  const out = await $.tool.call({ tool: 'mcp__todo-ledger__get_item', id: id.slice(0, 18) })
  expect(out.result).toContain('look me up')
  expect(out.result).toContain('session: GeneralQues (sess-1)')
  expect(out.result).toContain('context')
  expect((await $.tool.call({ tool: 'mcp__todo-ledger__get_item', id: '' })).result).toContain('No single item')
})

test('agents can edit title, kind and details, and remove by dropping', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'draft', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const out = await $.tool.call({ tool: 'mcp__todo-ledger__update_item', id, title: 'final title', kind: 'deferred', body: 'why' })
  expect(out.result).toContain('title')
  expect(JSON.parse([...disk.values()][0])).toMatchObject({ title: 'final title', kind: 'deferred', body: 'why', status: 'open' })
  await $.tool.call({ tool: 'mcp__todo-ledger__update_item', id, status: 'dropped' })
  expect(JSON.parse([...disk.values()][0]).status).toBe('dropped')
  const bad = await $.tool.call({ tool: 'mcp__todo-ledger__update_item', id, kind: 'wish' })
  expect(bad.result).toContain('kind must be one of')
})

test('list_items lines carry status and session for the agent', async ($, on) => {
  setup(on, { sessionTitle: 'GeneralQues' })
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'listed', kind: 'todo' })
  const out = await $.tool.call({ tool: 'mcp__todo-ledger__list_items' })
  expect(out.result).toContain('(todo, agent, open) listed  · session GeneralQues')
})

test('a long notes thread shows its latest three behind a "Show N earlier" link, no count heading', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'chatty', kind: 'discussion' })
  const id = JSON.parse([...disk.values()][0]).id
  for (const n of ['one', 'two', 'three', 'four', 'five']) await $.tool.call({ tool: 'mcp__todo-ledger__update_item', id, note: n })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'title-' + id })
  expect((await ui.find({ key: 'notes-more-' + id })).props.label).toBe('Show 2 earlier')
  expect(await ui.find({ type: 'Text', text: 'Notes' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'one' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'five' })).toBeDefined()
  await ui.press({ key: 'notes-more-' + id })
  expect(await ui.find({ type: 'Text', text: 'one' })).toBeDefined()
  expect(await ui.find({ key: 'notes-more-' + id })).toBeUndefined()
})

test('desktop rows from the current session carry a faint tint; other sessions and the terminal do not', async ($, on) => {
  const { disk } = setup(on, { files: { 'C:\\Users\\t\\.claude\\todo-ledger\\items\\o.json': JSON.stringify({ id: 'o', title: 'elsewhere', body: '', kind: 'todo', origin: 'agent', status: 'open', project: 'D:\\Projects\\Demo', sessionId: 'abc-1', source: 'tool', createdAt: '2026-10-03T11:00:00.000Z', updatedAt: '2026-10-03T11:00:00.000Z', notes: [] }) } })
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'mine', kind: 'todo' })
  const mine = JSON.parse([...disk.values()].find((v) => v.includes('"mine"'))!).id
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await desk.find({ key: 'row-' + mine })).props.backgroundColor).toBe('#8b9cf714')
  expect((await desk.find({ key: 'row-o' })).props.backgroundColor).toBeUndefined()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ key: 'row-' + mine })).props.backgroundColor).toBeUndefined()
  // The terminal marks this session's rows with a dot instead; the desktop does not.
  expect(await term.findAll({ type: 'Text', text: '● this session' })).toHaveLength(1)
  expect(await desk.find({ type: 'Text', text: '● this session' })).toBeUndefined()
})

test('Queue picks cards; Send all sends one combined prompt and marks them started', async ($, on) => {
  const { disk, calls } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'first task', kind: 'todo', body: 'first details' })
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'second task', kind: 'deferred' })
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'left alone', kind: 'todo' })
  const all = [...disk.values()].map((v) => JSON.parse(v))
  const idOf = (t: string) => all.find((i) => i.title === t).id
  const [a, b, c] = [idOf('first task'), idOf('second task'), idOf('left alone')]
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'queue-tray' })).toBeUndefined()
  await ui.press({ key: 'title-' + a })
  await ui.press({ key: 'queue-' + a })
  expect((await ui.find({ key: 'queue-' + a })).props.label).toBe('Queued ✓')
  await ui.press({ key: 'title-' + b })
  await ui.press({ key: 'queue-' + b })
  expect(await ui.find({ type: 'Text', text: '2 queued' })).toBeDefined()
  await ui.press({ key: 'queue-send' })
  expect(calls.submits).toHaveLength(1)
  const text = calls.submits[0]
  expect(text).toContain('Work on these 2 ledger items')
  expect(text).toContain('first task')
  expect(text).toContain('first details')
  expect(text).toContain('second task')
  expect(text).not.toContain('left alone')
  const after = [...disk.values()].map((v) => JSON.parse(v))
  expect(after.find((i) => i.id === a).status).toBe('in_progress')
  expect(after.find((i) => i.id === b).status).toBe('in_progress')
  expect(after.find((i) => i.id === c).status).toBe('open')
  expect(await ui.find({ key: 'queue-tray' })).toBeUndefined()
})

test('Clear empties the queue without sending', async ($, on) => {
  const { disk, calls } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'maybe later', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'title-' + id })
  await ui.press({ key: 'queue-' + id })
  expect(await ui.find({ key: 'queue-tray' })).toBeDefined()
  await ui.press({ key: 'queue-clear' })
  expect(await ui.find({ key: 'queue-tray' })).toBeUndefined()
  expect(calls.submits).toHaveLength(0)
})

test('row meta names the project only when the list spans projects', async ($, on) => {
  setup(on, { files: { 'C:\\Users\\t\\.claude\\todo-ledger\\items\\h.json': JSON.stringify({ id: 'h', title: 'here', body: '', kind: 'todo', origin: 'agent', status: 'open', project: 'D:\\Projects\\Demo', sessionId: 'abc-1', source: 'tool', createdAt: '2026-10-03T11:00:00.000Z', updatedAt: '2026-10-03T11:00:00.000Z', notes: [] }) } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Demo' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'abc' })).toBeDefined()
  await ui.press({ key: 'scope' })
  expect(await ui.find({ type: 'Text', text: 'Demo' })).toBeDefined()
})
