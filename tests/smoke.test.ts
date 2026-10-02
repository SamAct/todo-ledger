import { expect, test } from 'claude-code/testing'

test('/todos is registered and answers', async ($, on) => {
  const registered: string[] = []
  on('command.register', ($, e) => { registered.push(e.name); return { value: undefined } })
  on('tool.register', ($, e) => ({ value: { tool: e.name } }))
  on('session.start', () => ({ cwd: 'C:\\work' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' })
  expect(registered).toContain('todos')
})
