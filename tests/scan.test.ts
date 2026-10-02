import { expect, test } from 'claude-code/testing'
import { buildScanPrompt, parseScanReply, shouldScan } from '../src/scan.ts'
import { setup, start } from './fakes.ts'

const LONG = 'We fixed the bug. '.repeat(30) + 'I deferred the GGUF check for CLM to later.'

test('shouldScan', async () => {
  expect(shouldScan('short', false)).toBe(false)
  expect(shouldScan(LONG, true)).toBe(false)
  expect(shouldScan(LONG, false)).toBe(true)
  expect(shouldScan(undefined, false)).toBe(false)
})

test('buildScanPrompt keeps the last 6000 chars and lists known titles', async () => {
  const p = buildScanPrompt('a'.repeat(7000) + 'END', ['Known one'])
  expect(p).toContain('END')
  expect(p).toContain('- Known one')
  expect(p.length < 6400).toBe(true)
})

test('parseScanReply accepts plain, fenced and wrapped JSON', async () => {
  const plain = '{"items":[{"title":"Check CLM GGUF","kind":"deferred"}]}'
  expect(parseScanReply(plain)).toEqual([{ title: 'Check CLM GGUF', kind: 'deferred' }])
  expect(parseScanReply('```json\n' + plain + '\n```')).toEqual([{ title: 'Check CLM GGUF', kind: 'deferred' }])
  expect(parseScanReply('Here you go: ' + plain + ' Thanks')).toEqual([{ title: 'Check CLM GGUF', kind: 'deferred' }])
})

test('parseScanReply drops bad entries and rejects garbage', async () => {
  expect(parseScanReply('{"items":[{"title":"","kind":"todo"},{"title":"ok","kind":"wish"},{"title":"keep","kind":"todo"}]}'))
    .toEqual([{ title: 'keep', kind: 'todo' }])
  expect(parseScanReply('no json here')).toBe(null)
  expect(parseScanReply('{"items": 3}')).toBe(null)
})

const DONE = { durationMs: 1, isAborted: false, reason: 'answer' as const }

test('turn.complete with a long reply saves scanned items as agent/scan', async ($, on) => {
  const { disk, clock } = setup(on, { modelText: '{"items":[{"title":"Check CLM GGUF","kind":"deferred"}]}' })
  await start($)
  await $.turn.start({ text: '', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: LONG, ...DONE })
  await clock.settle()
  const item = JSON.parse([...disk.values()][0])
  expect(item).toMatchObject({ title: 'Check CLM GGUF', kind: 'deferred', origin: 'agent', source: 'scan' })
})

test('no model call when park_item ran this turn', async ($, on) => {
  const { calls, clock } = setup(on)
  await start($)
  await $.turn.start({ text: '', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'x', kind: 'todo' })
  await $.turn.complete({ turnId: 't1', answer: LONG, ...DONE })
  await clock.settle()
  expect(calls.models).toBe(0)
})

test('no model call for a subagent turn or a non-answer turn', async ($, on) => {
  const { calls, clock } = setup(on)
  await start($)
  await $.turn.start({ text: '', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: LONG, ...DONE, agentId: 'sub-1' })
  await $.turn.complete({ turnId: 't1', answer: LONG, ...DONE, reason: 'aborted' })
  await clock.settle()
  expect(calls.models).toBe(0)
})

test('unanswered model call saves nothing and logs', async ($, on) => {
  const { disk, calls, clock } = setup(on, { modelAnswered: false })
  await start($)
  await $.turn.start({ text: '', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: LONG, ...DONE })
  await clock.settle()
  expect(disk.size).toBe(0)
  expect(calls.logs.some((l) => l.startsWith('scan skipped'))).toBe(true)
})

test('malformed scan reply saves nothing and logs', async ($, on) => {
  const { disk, calls, clock } = setup(on, { modelText: 'not json' })
  await start($)
  await $.turn.start({ text: '', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: LONG, ...DONE })
  await clock.settle()
  expect(disk.size).toBe(0)
  expect(calls.logs.some((l) => l.startsWith('scan skipped'))).toBe(true)
})
