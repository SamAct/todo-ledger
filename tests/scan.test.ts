import { expect, test } from 'claude-code/testing'
import { buildScanPrompt, parseScanReply, shouldScan } from '../src/scan.ts'

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
