import { expect, test } from 'claude-code/testing'
import { similarTitle } from '../src/item.ts'
import { buildScanPrompt, parseScanUpdates } from '../src/scan.ts'
import { DIR, setup, start } from './fakes.ts'

// The real duplicate pairs found in the ledger cleanup on 2026-10-04.
const PAIRS: [string, string][] = [
  ['Add curved ↺ arrow from last stage back to first stage of loop, animated while round is running',
   'Implement curved loop arrow (↺) from last stage back to first stage, animated during round execution'],
  ["Add 'round N of M' counter, read from simple while (… n < M) conditions in script",
   "Extract and display 'round N of M' counter from simple while loop conditions in script"],
  ['Implement session notices for workflow runs started in other sessions',
   'Implement session toast notifications for workflow runs started in other sessions'],
  ['Add live tokens and time per agent to flow pane blocks and tooltips',
   'Add live tokens and time per agent from transcript files to flow pane cells and tooltips'],
]
const DIFFERENT: [string, string][] = [
  ['Implement Codex runs support in flow-ledger', 'Implement messages between sessions support in flow-ledger'],
  ['Add live tokens and time per agent to flow pane blocks', 'Add phase progress counts (done/total) beside section headings'],
  ['Fix login', 'Fix logout'],
]

test('reworded duplicates are similar; different items are not', async () => {
  for (const [a, b] of PAIRS) expect(similarTitle(a, b)).toBe(true)
  for (const [a, b] of DIFFERENT) expect(similarTitle(a, b)).toBe(false)
})

test('the scan prompt lists open items with ids and kinds, and the user message', async () => {
  const p = buildScanPrompt('reply text', [{ id: 'abc1', title: 'Loop arrow', kind: 'proposal' }], 'yes build all three')
  expect(p).toContain('[abc1] (proposal) Loop arrow')
  expect(p).toContain('USER:\nyes build all three')
  // Plain titles still work (older callers).
  expect(buildScanPrompt('r', ['Known one'])).toContain('- Known one')
})

test('parseScanUpdates keeps only known ids and valid actions', async () => {
  const text = '{"items":[],"updates":[' +
    '{"id":"abc1","action":"approve"},{"id":"abc2","action":"done"},{"id":"abc3","action":"reject"},' +
    '{"id":"abc4","action":"duplicate","of":"abc1"},{"id":"zzz9","action":"done"},{"id":"abc1","action":"explode"},' +
    '{"id":"abc5","action":"duplicate","of":"nope"}]}'
  expect(parseScanUpdates(text, ['abc1', 'abc2', 'abc3', 'abc4', 'abc5'])).toEqual([
    { id: 'abc1', action: 'approve' },
    { id: 'abc2', action: 'done' },
    { id: 'abc3', action: 'reject' },
    { id: 'abc4', action: 'duplicate', of: 'abc1' },
  ])
  expect(parseScanUpdates('no json', ['abc1'])).toEqual([])
  expect(parseScanUpdates('{"items":[]}', ['abc1'])).toEqual([])
})

test('a reworded duplicate from park_item becomes a note, not a new item', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: PAIRS[0][0], kind: 'proposal' })
  const out = await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: PAIRS[0][1], kind: 'proposal' })
  expect(disk.size).toBe(1)
  expect(out.result).toContain('Already in ledger')
  expect(JSON.parse([...disk.values()][0]).notes[0].text).toContain(PAIRS[0][1])
})

const LONG = 'Here is what I built. '.repeat(30)
const DONE = { durationMs: 1, isAborted: false, reason: 'answer' as const }

test('the end-of-turn scan applies approve, reject, done and duplicate to open items', async ($, on) => {
  const seed = (id: string, title: string, kind: string) => [DIR + '\\' + id + '.json', JSON.stringify({
    id, title, body: '', kind, origin: 'agent', status: 'open', project: 'D:\\Projects\\Demo', sessionId: 's', source: 'scan',
    createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', notes: [] })]
  const files = Object.fromEntries([
    seed('i1', 'Loop arrow', 'proposal'), seed('i2', 'Report on build', 'todo'),
    seed('i3', 'Permanent deletion', 'proposal'), seed('i4', 'Curved loop arrow', 'proposal'),
  ])
  const modelText = '{"items":[],"updates":[{"id":"i1","action":"approve"},{"id":"i2","action":"done"},' +
    '{"id":"i3","action":"reject"},{"id":"i4","action":"duplicate","of":"i1"}]}'
  const { disk, clock, calls } = setup(on, { files, modelText })
  await start($)
  await $.turn.start({ text: 'yes build the loop arrow; skip permanent deletion', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: LONG, ...DONE })
  await clock.settle()
  const get = (id: string) => JSON.parse(disk.get(DIR + '\\' + id + '.json')!)
  expect(get('i1')).toMatchObject({ kind: 'todo', status: 'open' })
  expect(get('i2').status).toBe('done')
  expect(get('i3').status).toBe('dropped')
  expect(get('i4').status).toBe('dropped')
  expect(get('i4').notes.at(-1).text).toContain('i1')
  expect(get('i1').notes.at(-1).text).toContain('approved')
  expect(calls.prompts.at(-1)).toContain('USER:\nyes build the loop arrow; skip permanent deletion')
})

test('the scan never touches items from another project or already closed', async ($, on) => {
  const other = [DIR + '\\o1.json', JSON.stringify({ id: 'o1', title: 'Elsewhere', body: '', kind: 'proposal', origin: 'agent', status: 'open',
    project: 'D:\\Other', sessionId: 's', source: 'scan', createdAt: 'x', updatedAt: 'x', notes: [] })]
  const { disk, clock } = setup(on, { files: Object.fromEntries([other]), modelText: '{"items":[],"updates":[{"id":"o1","action":"done"}]}' })
  await start($)
  await $.turn.start({ text: 'done', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: LONG, ...DONE })
  await clock.settle()
  expect(JSON.parse(disk.get(DIR + '\\o1.json')!).status).toBe('open')
})

test('tool descriptions tell agents to keep the ledger current', async ($, on) => {
  const { calls } = setup(on)
  await start($)
  expect(calls.toolDescs.update_item).toMatch(/approves/i)
  expect(calls.toolDescs.update_item).toMatch(/finished/i)
  expect(calls.toolDescs.park_item).toMatch(/list_items/)
})

test('park_item description sets the worth test and the close duty', async ($, on) => {
  const { calls } = setup(on)
  await start($)
  expect(calls.toolDescs.park_item).toMatch(/lose it/i)
  expect(calls.toolDescs.park_item).toMatch(/never duplicate/i)
  expect(calls.toolDescs.park_item).toMatch(/status done/i)
})

test('the ledger rules are added to the system prompt only where the ledger tools are offered', async ($, on) => {
  setup(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' }] }))
  await start($)
  const base = { model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: ['terminal'], outputStyle: null, traits: [] }
  const withTool = await $.prompt.compose({ ...base, tools: ['Read', 'mcp__todo-ledger__park_item'] })
  const section = withTool.sections.find((s: any) => s.id === 'todo-ledger:policy')!
  expect(section.scope).toBe('session')
  expect(section.text).toMatch(/Never duplicate/)
  expect(section.text).toMatch(/Always close/)
  expect(section.text).toMatch(/Do not park/)
  expect(withTool.sections.filter((s: any) => s.id === 'todo-ledger:policy').length).toBe(1)
  const without = await $.prompt.compose({ ...base, tools: ['Read'] })
  expect(without.sections.some((s: any) => s.id === 'todo-ledger:policy')).toBe(false)
})
