import { expect, test } from 'claude-code/testing'
import { THEMES, nextTheme, themeById, withAlpha } from '../src/theme.ts'
import { setup, start } from './fakes.ts'

const PANE = { plugin: 'todo-ledger', component: 'Pane', requestId: 'todo-ledger', viewport: { columns: 120, rows: 40 },
  props: { title: "ToDo's", isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as const

test('there are five themes with unique ids and valid hex colours', () => {
  expect(THEMES).toHaveLength(5)
  expect(new Set(THEMES.map((t) => t.id)).size).toBe(5)
  for (const t of THEMES) {
    for (const c of [t.tint, t.project, t.session, t.age]) expect(c).toMatch(/^#[0-9a-f]{6}$/i)
  }
})

test('nextTheme steps through all five and wraps; unknown ids fall back to the first', () => {
  let t = THEMES[0]
  const seen = [t.id]
  for (let k = 0; k < 5; k++) { t = nextTheme(t.id); seen.push(t.id) }
  expect(seen.slice(0, 5)).toEqual(THEMES.map((x) => x.id))
  expect(seen[5]).toBe(THEMES[0].id)
  expect(themeById('nope').id).toBe(THEMES[0].id)
})

test('withAlpha appends two hex digits', () => {
  expect(withAlpha('#14b8a6', 0.08)).toBe('#14b8a614')
  expect(withAlpha('#14b8a6', 1)).toBe('#14b8a6ff')
  expect(withAlpha('#14b8a6', 0)).toBe('#14b8a600')
})

test('the theme button steps through the themes and the label follows', async ($, on) => {
  setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'themed', kind: 'todo' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'theme' })).props.label).toBe('◐ Ledger')
  await ui.press({ key: 'theme' })
  expect((await ui.find({ key: 'theme' })).props.label).toBe('◐ Aurora')
  for (let k = 0; k < 4; k++) await ui.press({ key: 'theme' })
  expect((await ui.find({ key: 'theme' })).props.label).toBe('◐ Ledger')
})
