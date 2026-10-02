import { expect, test } from 'claude-code/testing'
import { makeItem } from '../src/item.ts'
import { startOptions, startPrompt, terminalArgv } from '../src/start.ts'

test('options differ by surface', async () => {
  expect(startOptions('terminal').map((o) => o.value)).toEqual(['send', 'draft', 'terminal'])
  expect(startOptions('desktop').map((o) => o.value)).toEqual(['send', 'draft', 'copy'])
})

test('startPrompt includes id, notes, cross-project warning and close instruction', async () => {
  const item = { ...makeItem({ title: 'Do X', kind: 'deferred', origin: 'agent', source: 'tool', project: 'D:\\A', sessionId: 's', body: 'why', nowMs: 0, hex4: '0000' }),
    notes: [{ by: 'human', text: 'careful', at: 'x' }] } as any
  const p = startPrompt(item, 'D:\\B')
  expect(p).toContain('19700101-000000-0000')
  expect(p).toContain('Do X')
  expect(p).toContain('- human: careful')
  expect(p).toContain('different project')
  expect(p).toContain('update_item')
  expect(startPrompt(item, 'd:\\a')).not.toContain('different project')
})

test('terminalArgv keeps a path with spaces as one argument', async () => {
  const argv = terminalArgv('D:\\My Projects\\x', 'go')
  expect(argv).toEqual(['wt', '-d', 'D:\\My Projects\\x', 'claude', 'go'])
})
