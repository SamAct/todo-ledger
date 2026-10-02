# Todo Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code mod that records agent- and human-initiated todos, deferred items, proposals and discussions in one global ledger, with a band button + pane in the CLI and desktop app and a Start action.

**Architecture:** One mod plugin at `D:\Projects\AGENTIC\TODO\todo-ledger\`. Pure logic (item model, tab filtering, scan prompt/parse, command parsing, start prompt) lives in `src/*.ts` and has no `$`. Every call to the mods API lives in top-level functions of `hooks/register.ts`, because the validator rejects passing `$` to a function imported from another file. Items are one JSON file each under `%USERPROFILE%\.claude\todo-ledger\items\`.

**Tech Stack:** TypeScript hooks module loaded directly by Claude Code (no build step), `claude-code/testing` test kit, `claude plugin validate` / `claude plugin test`, Windows (`cmd`, `wt`).

**Spec:** `docs/superpowers/specs/2026-10-03-todo-ledger-design.md`

## Global Constraints

- Claude Code **v2.1.287 or later** (mods minimum). Installed CLI was 2.1.285 on 2026-10-03.
- Plugin name `todo-ledger`; tools reach Claude as `mcp__todo-ledger__park_item`, `mcp__todo-ledger__list_items`, `mcp__todo-ledger__update_item`.
- Storage root: `%USERPROFILE%\.claude\todo-ledger\items\<id>.json`, one item per file.
- Item fields exactly: `id, title, body, kind, origin, status, project, sessionId, source, createdAt, updatedAt, notes[]`.
- `kind ∈ todo|deferred|proposal|discussion`; `origin ∈ agent|human`; `status ∈ open|in_progress|done|dropped`; `source ∈ tool|todowrite|scan|manual`.
- Scan model `haiku`, `maxTokens: 400`, `timeoutMs: 20000`, skip if reply < 400 chars or `park_item` ran this turn, reply truncated to last 6,000 chars.
- Writes go to `<id>.json.tmp` then `cmd /c move /y` over `<id>.json`.
- Pane id `todo-ledger`; tab lists capped at 100 (Done: 50).
- A hook never blocks or alters a TodoWrite call or a turn on failure.
- Validator rules: write every `$` call in full (`$.fs.read(...)`), event names as string literals, no destructuring `$`, imports only by relative path or `claude-code`.

## Review Focus

1. **Project paths with spaces** (`D:\My Projects\x`): New terminal session must still open in that folder → test in Task 9 asserts argv keeps the path as one element.
2. **Corrupt or half-written item file** in the items folder: list still loads every other item → test in Task 3.
3. **Multi-line or very long titles** from the scan or Claude: stored as one line, ≤ 200 chars → test in Task 2.
4. **Scan reply wrapped in a code fence or with prose around the JSON**: still parsed → test in Task 7.
5. **Empty ledger**: band draws nothing of its own and keeps other mods' band content → test in Task 8.

---

## File Structure

```
todo-ledger/
├── .claude-plugin/plugin.json       manifest
├── hooks/hooks.json                 { "modules": ["./register.ts"] }
├── hooks/register.ts                every $ call: store I/O, commands, tools, capture, UI
├── src/item.ts                      Item type, ids, title cleaning, dedupe key, parse/validate
├── src/commands.ts                  /todo argument parsing, /todos list formatting
├── src/scan.ts                      shouldScan, scan prompt, scan reply parsing
├── src/view.ts                      tab assignment, tab lists, band label, age text
├── src/start.ts                     start prompt text, start options per surface
├── tests/fakes.ts                   shared stubs: in-memory disk, session, registration
├── tests/*.test.ts                  one file per task
├── docs/api-notes.md                API shapes confirmed against this build's .d.ts (Task 1)
└── README.md                        install, use, turn off
```

---

### Task 1: Prerequisites, scaffold, and API confirmation

**Files:**
- Create: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts`, `tests/smoke.test.ts`, `docs/api-notes.md`, `.gitignore`

**Interfaces:**
- Produces: a loadable mod named `todo-ledger`; `docs/api-notes.md` recording the confirmed shape of every API used by later tasks.

- [ ] **Step 1: Update Claude Code and confirm the version**

```bash
claude update
```
```bash
claude --version
```
Expected: `2.1.287` or higher. If lower, stop and report.

- [ ] **Step 2: Write the manifest**

`.claude-plugin/plugin.json`:
```json
{
  "name": "todo-ledger",
  "version": "0.1.0",
  "description": "Global ledger of agent and human todos, deferred items, proposals and discussions",
  "author": { "name": "saran" }
}
```

`hooks/hooks.json`:
```json
{
  "description": "todo-ledger hooks module",
  "modules": ["./register.ts"]
}
```

`.gitignore`:
```
.claude-plugin/types/
tsconfig.json
```

- [ ] **Step 3: Write the failing smoke test**

`tests/smoke.test.ts`:
```typescript
import { expect, test } from 'claude-code/testing'

test('/todos is registered and answers', async ($, on) => {
  const registered: string[] = []
  on('command.register', ($, e) => { registered.push(e.name); return { value: undefined } })
  on('session.start', () => ({ cwd: 'C:\\work' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' })
  expect(registered).toContain('todos')
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `claude plugin test` (from `todo-ledger/`)
Expected: FAIL — hooks module `./register.ts` missing.

- [ ] **Step 5: Minimal register.ts**

`hooks/register.ts`:
```typescript
export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'todos', description: 'Toggle the todo ledger pane', immediate: true })
    return next(e)
  })
}
```

- [ ] **Step 6: Run test and validate**

Run: `claude plugin test` → Expected: `1 pass`.
Run: `claude plugin validate . --strict` → Expected: `✔ Validation passed`.

- [ ] **Step 7: Generate types and confirm API shapes**

Run once to make Claude Code write `.claude-plugin/types/`:
```bash
claude -p "/todos" --plugin-dir .
```
Open `.claude-plugin/types/claude-code/index.d.ts` and record in `docs/api-notes.md`, one line each, the exact signature or field for:

```
$.env.get(name)                -> return type (sync or Promise)
$.fs.exists / list / read / write -> arg names and return shapes (write: (path, text)?)
$.process.run(argv, init?)     -> { exitCode, stdout, stderr }
$.session.cwd() / id()         -> Promise<string>?
$.model.complete(opts)         -> { isAnswered, text, reason }
$.prompt.submit / fill         -> arg shape ({ text }?)
$.ui.copy                      -> arg shape (string or { text })
$.ui.open / close / log / toast -> arg shapes
turn.complete event            -> field holding the final reply text (expected: answer: string)
turn.start event               -> fields
tool.call event for TodoWrite  -> e.todos: { content, status, activeForm }[]
AbovePrompt ui.render          -> what next(e) resolves to when nothing is drawn
command.register               -> argumentHint, immediate supported
```

If any differs from the plan's code, note the difference in `api-notes.md` and apply it in the task that uses it. Also check the desktop app: open the Code tab, run `/status` or equivalent, record its Claude Code version; if < 2.1.287, note "desktop pane unavailable until app update".

- [ ] **Step 8: Commit**

```bash
git add .claude-plugin/plugin.json hooks tests docs/api-notes.md .gitignore
git commit -m "feat: scaffold todo-ledger mod"
```

---

### Task 2: Item model (pure)

**Files:**
- Create: `src/item.ts`
- Test: `tests/item.test.ts`

**Interfaces:**
- Produces:
  - `type Kind = 'todo'|'deferred'|'proposal'|'discussion'`, `type Origin = 'agent'|'human'`, `type Status = 'open'|'in_progress'|'done'|'dropped'`, `type Source = 'tool'|'todowrite'|'scan'|'manual'`
  - `interface Note { by: Origin; text: string; at: string }`
  - `interface Item { id; title; body; kind; origin; status; project; sessionId; source; createdAt; updatedAt; notes: Note[] }`
  - `KINDS: Kind[]`
  - `newId(nowMs: number, hex4: string): string`
  - `randomHex4(): string`
  - `cleanTitle(s: string): string`
  - `dedupeKey(title: string, project: string): string`
  - `isOpen(item: Item): boolean`
  - `makeItem(f: NewItemFields): Item` where `NewItemFields = { title: string; kind: Kind; origin: Origin; source: Source; project: string; sessionId: string; body?: string; nowMs: number; hex4: string }`
  - `parseItem(text: string): Item | null`

- [ ] **Step 1: Write the failing tests**

`tests/item.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test tests/item.test.ts`
Expected: FAIL — cannot resolve `../src/item.ts`.

- [ ] **Step 3: Implement**

`src/item.ts`:
```typescript
export type Kind = 'todo' | 'deferred' | 'proposal' | 'discussion'
export type Origin = 'agent' | 'human'
export type Status = 'open' | 'in_progress' | 'done' | 'dropped'
export type Source = 'tool' | 'todowrite' | 'scan' | 'manual'

export interface Note { by: Origin; text: string; at: string }

export interface Item {
  id: string
  title: string
  body: string
  kind: Kind
  origin: Origin
  status: Status
  project: string
  sessionId: string
  source: Source
  createdAt: string
  updatedAt: string
  notes: Note[]
}

export interface NewItemFields {
  title: string
  kind: Kind
  origin: Origin
  source: Source
  project: string
  sessionId: string
  body?: string
  nowMs: number
  hex4: string
}

export const KINDS: Kind[] = ['todo', 'deferred', 'proposal', 'discussion']
const STATUSES: Status[] = ['open', 'in_progress', 'done', 'dropped']

const pad = (n: number) => String(n).padStart(2, '0')

export function newId(nowMs: number, hex4: string): string {
  const d = new Date(nowMs)
  const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  return `${date}-${time}-${hex4}`
}

export function randomHex4(): string {
  const b = new Uint8Array(2)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export function cleanTitle(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > 200 ? one.slice(0, 197) + '...' : one
}

export function dedupeKey(title: string, project: string): string {
  return cleanTitle(title).toLowerCase() + '|' + project.toLowerCase()
}

export function isOpen(item: Item): boolean {
  return item.status === 'open' || item.status === 'in_progress'
}

export function makeItem(f: NewItemFields): Item {
  const at = new Date(f.nowMs).toISOString()
  return {
    id: newId(f.nowMs, f.hex4),
    title: cleanTitle(f.title),
    body: f.body ?? '',
    kind: f.kind,
    origin: f.origin,
    status: 'open',
    project: f.project,
    sessionId: f.sessionId,
    source: f.source,
    createdAt: at,
    updatedAt: at,
    notes: [],
  }
}

export function parseItem(text: string): Item | null {
  let v: any
  try { v = JSON.parse(text) } catch { return null }
  if (!v || typeof v !== 'object') return null
  const strings = ['id', 'title', 'project', 'sessionId', 'createdAt', 'updatedAt']
  if (!strings.every((k) => typeof v[k] === 'string')) return null
  if (!KINDS.includes(v.kind) || !STATUSES.includes(v.status)) return null
  if (v.origin !== 'agent' && v.origin !== 'human') return null
  return { ...v, body: typeof v.body === 'string' ? v.body : '', notes: Array.isArray(v.notes) ? v.notes : [] }
}
```

- [ ] **Step 4: Run tests**

Run: `claude plugin test tests/item.test.ts` → Expected: `5 pass`.

- [ ] **Step 5: Commit**

```bash
git add src/item.ts tests/item.test.ts
git commit -m "feat: item model"
```

---

### Task 3: Store I/O in the hooks module

**Files:**
- Modify: `hooks/register.ts`
- Create: `tests/fakes.ts`
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: `Item, makeItem, parseItem, dedupeKey, isOpen, randomHex4, cleanTitle, Kind, Origin, Source` from `src/item.ts`.
- Produces (top-level in `register.ts`, used by Tasks 4–9):
  - `itemsDir($): Promise<string>`
  - `loadAll($): Promise<Item[]>` — also refreshes module-level `cache`
  - `saveItem($, item: Item): Promise<void>`
  - `capture($, f: { title; kind; origin; source; body? }): Promise<{ item: Item; isNew: boolean }>`
  - `setStatus($, id: string, status: Status, note?: string): Promise<Item | null>`
  - module state `let cache: Item[]`
- Produces (tests): `tests/fakes.ts` exporting `setup(on, opts?)` returning `{ disk: Map<string,string>, calls: { argv: string[][] , submits: string[], fills: string[], copies: string[], logs: string[], toasts: string[], tools: string[], commands: string[] } }`.

- [ ] **Step 1: Write the shared fakes**

`tests/fakes.ts`:
```typescript
import { mock } from 'claude-code/testing'

export const HOME = 'C:\\Users\\t'
export const DIR = HOME + '\\.claude\\todo-ledger\\items'
export const CWD = 'D:\\Projects\\Demo'

export function setup(on: any, opts: { modelText?: string; modelAnswered?: boolean; files?: Record<string, string> } = {}) {
  const disk = new Map<string, string>(Object.entries(opts.files ?? {}))
  const calls = { argv: [] as string[][], submits: [] as string[], fills: [] as string[], copies: [] as string[], logs: [] as string[], toasts: [] as string[], tools: [] as string[], commands: [] as string[], models: 0 }
  const store = new Map<string, unknown>()

  mock.env(on, { USERPROFILE: HOME })
  on('session.start', () => ({ cwd: CWD }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('command.register', ($: any, e: any) => { calls.commands.push(e.name); return { value: undefined } })
  on('tool.register', ($: any, e: any) => { calls.tools.push(e.name); return { value: undefined } })
  on('store.get', ($: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: any) => { store.set(e.key, e.value); return { value: undefined } })
  on('fs.exists', ($: any, e: any) => ({ value: e.path === DIR || disk.has(e.path) }))
  on('fs.list', ($: any, e: any) => ({
    value: [...disk.keys()]
      .filter((p) => p.startsWith(e.path + '\\'))
      .map((p) => ({ name: p.slice(e.path.length + 1), kind: 'file', size: disk.get(p)!.length, isLink: false })),
  }))
  on('fs.read', ($: any, e: any) => ({ value: disk.get(e.path) ?? '' }))
  on('fs.write', ($: any, e: any) => { disk.set(e.path, e.text); return { value: undefined } })
  on('process.run', ($: any, e: any) => {
    calls.argv.push(e.argv)
    if (e.argv[2] === 'move') { disk.set(e.argv[5], disk.get(e.argv[4])!); disk.delete(e.argv[4]) }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('model.complete', () => {
    calls.models += 1
    return { value: { isAnswered: opts.modelAnswered ?? true, text: opts.modelText ?? '{"items":[]}', reason: 'stub', usage: null } }
  })
  on('prompt.submit', ($: any, e: any) => { calls.submits.push(e.text); return { text: e.text } })
  on('prompt.fill', ($: any, e: any) => { calls.fills.push(e.text); return { isFilled: true } })
  on('ui.copy', ($: any, e: any) => { calls.copies.push(typeof e === 'string' ? e : e.text); return { value: { isCopied: true } } })
  on('ui.log', ($: any, e: any) => { calls.logs.push(e.text); return { value: undefined } })
  on('ui.toast', ($: any, e: any) => { calls.toasts.push(e.text); return { value: undefined } })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  on('tool.call', () => ({ result: 'engine-ran' }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 3, 12, 0, 0) })
  return { disk, calls, store, clock }
}

export async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: CWD })
}
```

Field names used by these stubs (`e.path`, `e.text`, `e.argv`, `e.key`, `e.value`) must match `docs/api-notes.md`; fix the stub, not the mod, if the d.ts names differ.

- [ ] **Step 2: Write the failing store tests**

`tests/store.test.ts`:
```typescript
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
```

These tests drive the store through `/todo add` and `/todos list`, which Task 4 implements fully; this task adds the minimum command handling needed.

- [ ] **Step 3: Run to verify failure**

Run: `claude plugin test tests/store.test.ts`
Expected: FAIL — `/todo` not handled.

- [ ] **Step 4: Implement store functions and minimal commands**

Replace `hooks/register.ts` with:
```typescript
import { cleanTitle, dedupeKey, isOpen, makeItem, parseItem, randomHex4 } from '../src/item.ts'
import type { Item, Kind, Origin, Source, Status } from '../src/item.ts'

// Every function below that takes $ must stay top-level in this file: the validator
// rejects passing $ into functions imported from other files.

let cache: Item[] = []
const reportedBad = new Set<string>()

async function itemsDir($: any): Promise<string> {
  const home = await $.env.get('USERPROFILE')
  return home + '\\.claude\\todo-ledger\\items'
}

async function ensureDir($: any): Promise<string> {
  const dir = await itemsDir($)
  if (!(await $.fs.exists(dir))) await $.process.run(['cmd', '/c', 'mkdir', dir])
  return dir
}

async function loadAll($: any): Promise<Item[]> {
  const dir = await itemsDir($)
  if (!(await $.fs.exists(dir))) { cache = []; return cache }
  const entries = await $.fs.list(dir)
  const items: Item[] = []
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue
    const item = parseItem(await $.fs.read(dir + '\\' + entry.name))
    if (item) items.push(item)
    else if (!reportedBad.has(entry.name)) {
      reportedBad.add(entry.name)
      $.ui.log('skipped unreadable item file ' + entry.name)
    }
  }
  cache = items
  return items
}

async function saveItem($: any, item: Item): Promise<void> {
  const dir = await ensureDir($)
  const path = dir + '\\' + item.id + '.json'
  await $.fs.write(path + '.tmp', JSON.stringify(item, null, 2))
  const r = await $.process.run(['cmd', '/c', 'move', '/y', path + '.tmp', path])
  if (r.exitCode !== 0) throw new Error('could not save ' + item.id + ': ' + r.stderr.trim())
  cache = [...cache.filter((i) => i.id !== item.id), item]
  $.ui.invalidate('ui.render')
}

async function capture(
  $: any,
  f: { title: string; kind: Kind; origin: Origin; source: Source; body?: string },
): Promise<{ item: Item; isNew: boolean }> {
  const project = await $.session.cwd()
  const items = await loadAll($)
  const key = dedupeKey(f.title, project)
  const now = await $.clock.now()
  const at = new Date(now).toISOString()
  const existing = items.find((i) => isOpen(i) && dedupeKey(i.title, i.project) === key)
  if (existing) {
    const text = 'Captured again (' + f.source + ')' + (f.body ? ': ' + f.body : '')
    const updated = { ...existing, updatedAt: at, notes: [...existing.notes, { by: f.origin, text, at }] }
    await saveItem($, updated)
    return { item: updated, isNew: false }
  }
  const sessionId = await $.session.id()
  const item = makeItem({ ...f, title: cleanTitle(f.title), project, sessionId, nowMs: now, hex4: randomHex4() })
  await saveItem($, item)
  return { item, isNew: true }
}

async function setStatus($: any, id: string, status: Status, note?: string): Promise<Item | null> {
  const items = await loadAll($)
  const found = items.filter((i) => i.id.startsWith(id))
  if (found.length !== 1) return null
  const at = new Date(await $.clock.now()).toISOString()
  const notes = note ? [...found[0].notes, { by: 'agent' as Origin, text: note, at }] : found[0].notes
  const updated = { ...found[0], status, updatedAt: at, notes }
  await saveItem($, updated)
  return updated
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await loadAll($)
    await $.command.register({ name: 'todos', description: 'Toggle the todo ledger pane', argumentHint: '[list [all]]', immediate: true })
    await $.command.register({ name: 'todo', description: 'Add or close a ledger item', argumentHint: 'add [-d|-p|-n] <text> | done <id>' })
    return next(e)
  })

  on('command.run', { command: 'todo' }, async ($, e) => {
    const text = e.args.replace(/^add\s+/, '')
    const r = await capture($, { title: text, kind: 'todo', origin: 'human', source: 'manual' })
    return { text: (r.isNew ? 'Added ' : 'Already listed, noted: ') + r.item.title }
  })

  on('command.run', { command: 'todos' }, async ($, e) => {
    const items = await loadAll($)
    return { text: items.filter(isOpen).map((i) => '- ' + i.title).join('\n') }
  })
}
```

- [ ] **Step 5: Run tests**

Run: `claude plugin test` → Expected: all pass (smoke, item, store).
Run: `claude plugin validate . --strict` → Expected: passed.

- [ ] **Step 6: Commit**

```bash
git add hooks/register.ts tests/fakes.ts tests/store.test.ts
git commit -m "feat: file store with tmp+move writes and dedupe"
```

---

### Task 4: Human commands `/todo` and `/todos list`

**Files:**
- Create: `src/commands.ts`
- Modify: `hooks/register.ts` (the two `command.run` hooks)
- Test: `tests/commands.test.ts`

**Interfaces:**
- Consumes: `Item, Kind, isOpen` from `src/item.ts`; `capture`, `setStatus`, `loadAll` from Task 3.
- Produces:
  - `type TodoCommand = { action: 'add'; kind: Kind; text: string } | { action: 'done'; idPrefix: string } | { action: 'error'; message: string }`
  - `parseTodoCommand(args: string): TodoCommand`
  - `parseTodosArgs(args: string): { action: 'toggle' } | { action: 'list'; all: boolean }`
  - `formatList(items: Item[], project: string, all: boolean): string`
  - `togglePane($)` placeholder in register.ts that Task 8 replaces (here it returns `{}` and opens nothing)

- [ ] **Step 1: Write failing tests**

`tests/commands.test.ts`:
```typescript
import { expect, test } from 'claude-code/testing'
import { formatList, parseTodoCommand, parseTodosArgs } from '../src/commands.ts'
import { setup, start } from './fakes.ts'

test('parseTodoCommand handles flags', async () => {
  expect(parseTodoCommand('add fix it')).toEqual({ action: 'add', kind: 'todo', text: 'fix it' })
  expect(parseTodoCommand('add -d later thing')).toEqual({ action: 'add', kind: 'deferred', text: 'later thing' })
  expect(parseTodoCommand('add -p idea')).toEqual({ action: 'add', kind: 'proposal', text: 'idea' })
  expect(parseTodoCommand('add -n talk')).toEqual({ action: 'add', kind: 'discussion', text: 'talk' })
  expect(parseTodoCommand('done 2026')).toEqual({ action: 'done', idPrefix: '2026' })
  expect(parseTodoCommand('add').action).toBe('error')
  expect(parseTodoCommand('').action).toBe('error')
})

test('parseTodosArgs', async () => {
  expect(parseTodosArgs('')).toEqual({ action: 'toggle' })
  expect(parseTodosArgs('list')).toEqual({ action: 'list', all: false })
  expect(parseTodosArgs('list all')).toEqual({ action: 'list', all: true })
})

test('/todo add -d stores a human deferred item', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  const out = await $.command.run({ command: 'todo', args: 'add -d check CLM GGUF' })
  expect(out.text).toContain('check CLM GGUF')
  const item = JSON.parse([...disk.values()][0])
  expect(item).toMatchObject({ kind: 'deferred', origin: 'human', source: 'manual', project: 'D:\\Projects\\Demo' })
})

test('/todo done closes by id prefix', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.command.run({ command: 'todo', args: 'add x' })
  const id = JSON.parse([...disk.values()][0]).id
  const out = await $.command.run({ command: 'todo', args: 'done ' + id.slice(0, 15) })
  expect(out.text).toContain('Done')
  expect(JSON.parse([...disk.values()][0]).status).toBe('done')
})

test('/todos list filters to this project unless all', async ($, on) => {
  const other = JSON.stringify({ id: 'o', title: 'elsewhere', body: '', kind: 'todo', origin: 'human', status: 'open', project: 'D:\\Other', sessionId: 's', source: 'manual', createdAt: 'x', updatedAt: 'x', notes: [] })
  setup(on, { files: { 'C:\\Users\\t\\.claude\\todo-ledger\\items\\o.json': other } })
  await start($)
  await $.command.run({ command: 'todo', args: 'add here' })
  const mine = await $.command.run({ command: 'todos', args: 'list' })
  expect(mine.text).toContain('here')
  expect(mine.text).not.toContain('elsewhere')
  const all = await $.command.run({ command: 'todos', args: 'list all' })
  expect(all.text).toContain('elsewhere')
})

test('formatList on empty', async () => {
  expect(formatList([], 'p', false)).toBe('No open ledger items for this project.')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test tests/commands.test.ts` → Expected: FAIL — `../src/commands.ts` missing.

- [ ] **Step 3: Implement `src/commands.ts`**

```typescript
import { isOpen } from './item.ts'
import type { Item, Kind } from './item.ts'

export type TodoCommand =
  | { action: 'add'; kind: Kind; text: string }
  | { action: 'done'; idPrefix: string }
  | { action: 'error'; message: string }

const FLAGS: Record<string, Kind> = { '-d': 'deferred', '-p': 'proposal', '-n': 'discussion' }
const USAGE = 'Usage: /todo add [-d|-p|-n] <text>  or  /todo done <id>'

export function parseTodoCommand(args: string): TodoCommand {
  const parts = args.trim().split(/\s+/).filter(Boolean)
  if (parts[0] === 'done' && parts[1]) return { action: 'done', idPrefix: parts[1] }
  if (parts[0] !== 'add') return { action: 'error', message: USAGE }
  let kind: Kind = 'todo'
  let rest = parts.slice(1)
  if (rest[0] && FLAGS[rest[0]]) { kind = FLAGS[rest[0]]; rest = rest.slice(1) }
  if (rest.length === 0) return { action: 'error', message: USAGE }
  return { action: 'add', kind, text: rest.join(' ') }
}

export function parseTodosArgs(args: string): { action: 'toggle' } | { action: 'list'; all: boolean } {
  const parts = args.trim().split(/\s+/).filter(Boolean)
  if (parts[0] === 'list') return { action: 'list', all: parts[1] === 'all' }
  return { action: 'toggle' }
}

export function formatList(items: Item[], project: string, all: boolean): string {
  const shown = items
    .filter(isOpen)
    .filter((i) => all || i.project.toLowerCase() === project.toLowerCase())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (shown.length === 0) return all ? 'No open ledger items.' : 'No open ledger items for this project.'
  return shown
    .map((i) => `- [${i.id}] (${i.kind}, ${i.origin}) ${i.title}` + (all ? `  — ${i.project}` : ''))
    .join('\n')
}
```

- [ ] **Step 4: Replace the two command hooks in `register.ts`**

Add imports:
```typescript
import { formatList, parseTodoCommand, parseTodosArgs } from '../src/commands.ts'
```

Add top-level (Task 8 replaces its body):
```typescript
async function togglePane($: any): Promise<void> {
  // Replaced in Task 8.
}
```

Replace both `command.run` hooks with:
```typescript
  on('command.run', { command: 'todo' }, async ($, e) => {
    const cmd = parseTodoCommand(e.args)
    if (cmd.action === 'error') return { text: cmd.message }
    if (cmd.action === 'done') {
      const item = await setStatus($, cmd.idPrefix, 'done')
      return { text: item ? 'Done: ' + item.title : 'No single item matches id ' + cmd.idPrefix }
    }
    const r = await capture($, { title: cmd.text, kind: cmd.kind, origin: 'human', source: 'manual' })
    return { text: (r.isNew ? 'Added ' : 'Already listed, noted: ') + r.item.title }
  })

  on('command.run', { command: 'todos' }, async ($, e) => {
    const cmd = parseTodosArgs(e.args)
    if (cmd.action === 'list') return { text: formatList(await loadAll($), await $.session.cwd(), cmd.all) }
    await togglePane($)
    return {}
  })
```

- [ ] **Step 5: Run tests**

Run: `claude plugin test` → Expected: all pass. Update `tests/store.test.ts` first test: it calls `/todos list`, still valid.
Run: `claude plugin validate . --strict` → passed.

- [ ] **Step 6: Commit**

```bash
git add src/commands.ts hooks/register.ts tests/commands.test.ts
git commit -m "feat: /todo and /todos list commands"
```

---

### Task 5: Agent tools `park_item`, `list_items`, `update_item`

**Files:**
- Modify: `hooks/register.ts`
- Test: `tests/tools.test.ts`

**Interfaces:**
- Consumes: `capture`, `setStatus`, `loadAll` (Task 3), `formatList` (Task 4), `KINDS` (Task 2).
- Produces: module flag `let parkedThisTurn = false` (read by Task 7); tool names `park_item`, `list_items`, `update_item`.

- [ ] **Step 1: Write failing tests**

`tests/tools.test.ts`:
```typescript
import { expect, test } from 'claude-code/testing'
import { setup, start } from './fakes.ts'

test('tools are registered with instructions in the description', async ($, on) => {
  const descs: Record<string, string> = {}
  on('tool.register', ($: any, e: any) => { descs[e.name] = e.description; return { value: undefined } })
  setup(on)
  await start($)
  expect(Object.keys(descs)).toEqual(['park_item', 'list_items', 'update_item'])
  expect(descs.park_item).toMatch(/defer/i)
})

test('park_item stores an agent item', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  const out = await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'Test Plumb logprobs', kind: 'proposal', body: 'needs LM Studio' })
  expect(out.result).toContain('Parked')
  const item = JSON.parse([...disk.values()][0])
  expect(item).toMatchObject({ origin: 'agent', source: 'tool', kind: 'proposal', body: 'needs LM Studio' })
})

test('park_item rejects an unknown kind without saving', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  const out = await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'x', kind: 'wish' })
  expect(out.result).toContain('kind must be one of')
  expect(disk.size).toBe(0)
})

test('update_item closes with a note', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'y', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const out = await $.tool.call({ tool: 'mcp__todo-ledger__update_item', id, status: 'done', note: 'shipped' })
  expect(out.result).toContain('done')
  const item = JSON.parse([...disk.values()][0])
  expect(item.status).toBe('done')
  expect(item.notes[0].text).toBe('shipped')
})

test('list_items returns this project by default', async ($, on) => {
  setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'z', kind: 'deferred' })
  const out = await $.tool.call({ tool: 'mcp__todo-ledger__list_items' })
  expect(out.result).toContain('z')
})
```

The registration-order test asserts `['park_item','list_items','update_item']`; `setup`'s own `tool.register` stub is registered after the test's, so the test's stub answers first. If the kit runs stubs in the other order, assert with `toContain` per name instead.

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test tests/tools.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement**

Add to imports: `import { KINDS } from '../src/item.ts'` (merge with the existing import line).

Add module state near `cache`:
```typescript
let parkedThisTurn = false
const TOOL = 'mcp__todo-ledger__'
const STATUS_VALUES = ['open', 'in_progress', 'done', 'dropped']
```

In `session.start`, before the command registrations:
```typescript
    await $.tool.register({
      name: 'park_item',
      description:
        'Record an item in the user\'s global todo ledger. Call this, without asking first, whenever you ' +
        'defer, park, postpone or put something out of scope, or propose work the user has not asked for. ' +
        'kind: todo | deferred | proposal | discussion. Keep title to one line.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: ['todo', 'deferred', 'proposal', 'discussion'] },
          body: { type: 'string' },
        },
        required: ['title', 'kind'],
      },
    })
    await $.tool.register({
      name: 'list_items',
      description: 'List open items in the user\'s todo ledger. scope "project" (default) or "all".',
      inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['project', 'all'] } } },
    })
    await $.tool.register({
      name: 'update_item',
      description: 'Change a ledger item\'s status (open, in_progress, done, dropped) and/or add a note. id may be a unique prefix.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, status: { type: 'string', enum: STATUS_VALUES }, note: { type: 'string' } },
        required: ['id'],
      },
    })
```

Add hooks inside `register`:
```typescript
  on('turn.start', async ($, e, next) => {
    parkedThisTurn = false
    return next(e)
  })

  on('tool.call', { tool: 'mcp__todo-ledger__park_item' }, async ($, e) => {
    if (!KINDS.includes(e.kind)) return { result: 'Not saved: kind must be one of ' + KINDS.join(', ') }
    if (typeof e.title !== 'string' || !e.title.trim()) return { result: 'Not saved: title is required' }
    try {
      const r = await capture($, { title: e.title, kind: e.kind, origin: 'agent', source: 'tool', body: e.body })
      parkedThisTurn = true
      return { result: (r.isNew ? 'Parked ' : 'Already in ledger, added note to ') + r.item.id + ': ' + r.item.title }
    } catch (err) {
      $.ui.toast('Todo not saved: ' + err.message)
      return { result: 'Not saved: ' + err.message }
    }
  })

  on('tool.call', { tool: 'mcp__todo-ledger__list_items' }, async ($, e) => {
    return { result: formatList(await loadAll($), await $.session.cwd(), e.scope === 'all') }
  })

  on('tool.call', { tool: 'mcp__todo-ledger__update_item' }, async ($, e) => {
    const items = await loadAll($)
    const match = items.filter((i) => i.id.startsWith(e.id))
    if (match.length !== 1) return { result: 'No single item matches id ' + e.id }
    const status = STATUS_VALUES.includes(e.status) ? e.status : match[0].status
    const item = await setStatus($, match[0].id, status, e.note)
    return { result: 'Item ' + item!.id + ' is now ' + item!.status }
  })
```

- [ ] **Step 4: Run tests and validate**

Run: `claude plugin test` → all pass. `claude plugin validate . --strict` → passed.

- [ ] **Step 5: Commit**

```bash
git add hooks/register.ts tests/tools.test.ts
git commit -m "feat: park_item, list_items, update_item tools"
```

---

### Task 6: TodoWrite mirror

**Files:**
- Modify: `hooks/register.ts`
- Test: `tests/todowrite.test.ts`

**Interfaces:**
- Consumes: `capture`, `loadAll`, `saveItem`, `dedupeKey`, `isOpen`.
- Produces: `mirrorTodos($, todos: { content: string; status: string }[]): Promise<void>`.

- [ ] **Step 1: Write failing tests**

`tests/todowrite.test.ts`:
```typescript
import { expect, test } from 'claude-code/testing'
import { setup, start } from './fakes.ts'

const call = (todos: any[]) => ({ tool: 'TodoWrite', todos })

test('new TodoWrite items are mirrored as agent todos', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  const out = await $.tool.call(call([
    { content: 'Write tests', status: 'pending', activeForm: 'Writing tests' },
    { content: 'Ship it', status: 'in_progress', activeForm: 'Shipping' },
  ]))
  expect(out.result).toBe('engine-ran')
  const items = [...disk.values()].map((t) => JSON.parse(t))
  expect(items.length).toBe(2)
  expect(items.every((i) => i.origin === 'agent' && i.source === 'todowrite' && i.kind === 'todo')).toBe(true)
  expect(items.find((i) => i.title === 'Ship it').status).toBe('in_progress')
})

test('completed in TodoWrite closes the mirrored item; repeats add nothing', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call(call([{ content: 'Write tests', status: 'pending', activeForm: 'x' }]))
  await $.tool.call(call([{ content: 'Write tests', status: 'pending', activeForm: 'x' }]))
  expect(disk.size).toBe(1)
  expect(JSON.parse([...disk.values()][0]).notes.length).toBe(0)
  await $.tool.call(call([{ content: 'Write tests', status: 'completed', activeForm: 'x' }]))
  expect(JSON.parse([...disk.values()][0]).status).toBe('done')
})

test('a mirror failure never blocks TodoWrite', async ($, on) => {
  on('fs.write', () => ({ deny: 'disk full' }))
  const { calls } = setup(on)
  await start($)
  const out = await $.tool.call(call([{ content: 'a', status: 'pending', activeForm: 'a' }]))
  expect(out.result).toBe('engine-ran')
  expect(calls.logs.some((l) => l.includes('disk full'))).toBe(true)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test tests/todowrite.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement**

Top-level in `register.ts`:
```typescript
async function mirrorTodos($: any, todos: { content: string; status: string }[]): Promise<void> {
  const project = await $.session.cwd()
  const sessionId = await $.session.id()
  for (const todo of todos) {
    if (typeof todo?.content !== 'string' || !todo.content.trim()) continue
    const items = await loadAll($)
    const key = dedupeKey(todo.content, project)
    const mine = items.find((i) => i.source === 'todowrite' && i.sessionId === sessionId && dedupeKey(i.title, i.project) === key)
    const status = todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'in_progress' : 'open'
    if (mine) {
      if (mine.status !== status && isOpen(mine)) {
        await saveItem($, { ...mine, status, updatedAt: new Date(await $.clock.now()).toISOString() })
      }
      continue
    }
    if (status === 'done') continue
    const r = await capture($, { title: todo.content, kind: 'todo', origin: 'agent', source: 'todowrite' })
    if (r.isNew && status !== 'open') await saveItem($, { ...r.item, status })
  }
}
```

Hook inside `register`:
```typescript
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const result = await next(e)
    try {
      await mirrorTodos($, Array.isArray(e.todos) ? e.todos : [])
    } catch (err) {
      $.ui.log('TodoWrite mirror failed: ' + err.message)
    }
    return result
  })
```

- [ ] **Step 4: Run tests and validate**

Run: `claude plugin test` → all pass. `claude plugin validate . --strict` → passed.

- [ ] **Step 5: Commit**

```bash
git add hooks/register.ts tests/todowrite.test.ts
git commit -m "feat: mirror TodoWrite into ledger"
```

---

### Task 7: End-of-turn scan

**Files:**
- Create: `src/scan.ts`
- Modify: `hooks/register.ts`
- Test: `tests/scan.test.ts`

**Interfaces:**
- Consumes: `capture`, `loadAll`, `parkedThisTurn` (Task 5), `isOpen`.
- Produces:
  - `SCAN_SYSTEM: string`
  - `shouldScan(answer: unknown, parked: boolean): boolean`
  - `buildScanPrompt(answer: string, existingTitles: string[]): string`
  - `parseScanReply(text: string): { title: string; kind: 'todo'|'deferred'|'proposal' }[] | null`
  - `runScan($, answer: string): Promise<void>` (register.ts)

- [ ] **Step 1: Write failing tests**

`tests/scan.test.ts`:
```typescript
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

test('turn.complete with a long reply saves scanned items as agent/scan', async ($, on) => {
  const { disk, clock } = setup(on, { modelText: '{"items":[{"title":"Check CLM GGUF","kind":"deferred"}]}' })
  await start($)
  await $.turn.start({ turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: LONG, durationMs: 1, isAborted: false, usage: null })
  await clock.settle()
  const item = JSON.parse([...disk.values()][0])
  expect(item).toMatchObject({ title: 'Check CLM GGUF', kind: 'deferred', origin: 'agent', source: 'scan' })
})

test('no model call when park_item ran this turn', async ($, on) => {
  const { calls, clock } = setup(on)
  await start($)
  await $.turn.start({ turnId: 't1' })
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'x', kind: 'todo' })
  await $.turn.complete({ turnId: 't1', answer: LONG, durationMs: 1, isAborted: false, usage: null })
  await clock.settle()
  expect(calls.models).toBe(0)
})

test('unanswered or malformed scan saves nothing and logs', async ($, on) => {
  const { disk, calls, clock } = setup(on, { modelText: 'not json' })
  await start($)
  await $.turn.start({ turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: LONG, durationMs: 1, isAborted: false, usage: null })
  await clock.settle()
  expect(disk.size).toBe(0)
  expect(calls.logs.some((l) => l.startsWith('scan skipped'))).toBe(true)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test tests/scan.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement `src/scan.ts`**

```typescript
export type ScanKind = 'todo' | 'deferred' | 'proposal'
const SCAN_KINDS: ScanKind[] = ['todo', 'deferred', 'proposal']

export const SCAN_SYSTEM =
  'You extract follow-up items from an AI coding assistant\'s reply. List only things the assistant ' +
  'explicitly deferred, parked, left for later, put out of scope, or proposed without being asked. ' +
  'Do not list work that was completed in the reply. Do not repeat items in the KNOWN list. ' +
  'Reply with JSON only: {"items":[{"title":"one line","kind":"todo|deferred|proposal"}]}. ' +
  'Reply {"items":[]} when there are none.'

export function shouldScan(answer: unknown, parked: boolean): boolean {
  return typeof answer === 'string' && answer.length >= 400 && !parked
}

export function buildScanPrompt(answer: string, existingTitles: string[]): string {
  const known = existingTitles.length ? existingTitles.map((t) => '- ' + t).join('\n') : '(none)'
  return 'KNOWN:\n' + known + '\n\nREPLY:\n' + answer.slice(-6000)
}

export function parseScanReply(text: string): { title: string; kind: ScanKind }[] | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let v: any
  try { v = JSON.parse(text.slice(start, end + 1)) } catch { return null }
  if (!v || !Array.isArray(v.items)) return null
  return v.items
    .filter((i: any) => i && typeof i.title === 'string' && i.title.trim() && SCAN_KINDS.includes(i.kind))
    .map((i: any) => ({ title: i.title.trim(), kind: i.kind }))
}
```

- [ ] **Step 4: Wire into `register.ts`**

Import: `import { SCAN_SYSTEM, buildScanPrompt, parseScanReply, shouldScan } from '../src/scan.ts'`

Top-level:
```typescript
async function runScan($: any, answer: string): Promise<void> {
  try {
    const project = (await $.session.cwd()).toLowerCase()
    const known = (await loadAll($)).filter((i) => isOpen(i) && i.project.toLowerCase() === project).map((i) => i.title)
    const r = await $.model.complete({
      model: 'haiku',
      system: SCAN_SYSTEM,
      prompt: buildScanPrompt(answer, known),
      maxTokens: 400,
      timeoutMs: 20000,
    })
    if (!r.isAnswered) { $.ui.log('scan skipped: ' + r.reason); return }
    const found = parseScanReply(r.text)
    if (!found) { $.ui.log('scan skipped: reply was not JSON'); return }
    for (const f of found) await capture($, { title: f.title, kind: f.kind, origin: 'agent', source: 'scan' })
  } catch (err) {
    $.ui.log('scan skipped: ' + err.message)
  }
}
```

Hook:
```typescript
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (shouldScan(e.answer, parkedThisTurn)) {
      const answer = e.answer
      $.clock.after(0, () => runScan($, answer))
    }
    return result
  })
```

If `docs/api-notes.md` says the reply text is not on `e.answer`, read it instead with `const msgs = await $.session.messages()` and take the last entry whose `role === 'assistant'`, inside `runScan`.

- [ ] **Step 5: Run tests and validate**

Run: `claude plugin test` → all pass. `claude plugin validate . --strict` → passed.

- [ ] **Step 6: Commit**

```bash
git add src/scan.ts hooks/register.ts tests/scan.test.ts
git commit -m "feat: end-of-turn haiku scan for deferred items and proposals"
```

---

### Task 8: Band button and pane

**Files:**
- Create: `src/view.ts`
- Modify: `hooks/register.ts` (replace `togglePane`, add `ui.render` / `ui.close` hooks)
- Test: `tests/view.test.ts`, `tests/pane.test.ts`

**Interfaces:**
- Consumes: `Item, isOpen` (Task 2); `cache`, `loadAll`, `capture`, `setStatus` (Task 3).
- Produces:
  - `type Tab = 'agent'|'human'|'parked'|'proposals'|'done'`, `TABS: { id: Tab; label: string; hotkey: string }[]`
  - `tabOf(item: Item): Tab`
  - `itemsForTab(items: Item[], tab: Tab, project: string | null): Item[]`
  - `bandLabel(items: Item[], lastSeenAt: string | null): string | null`
  - `age(nowMs: number, iso: string): string`
  - register.ts state: `paneOpen`, `tab`, `allProjects`, `newKind`, `expandedId`, `notingId`, `startingId`, `lastSeenAt`
  - register.ts: `togglePane($)`; button keys `ledger-toggle`, `tab-<tab>`, `scope`, `new-item`, `new-kind`, `title-<id>`, `start-<id>`, `done-<id>`, `drop-<id>`, `note-<id>`, `note-input-<id>`, `start-choice-<id>` (Task 9 consumes `start-choice-<id>` and `startingId`).

- [ ] **Step 1: Write failing pure tests**

`tests/view.test.ts`:
```typescript
import { expect, test } from 'claude-code/testing'
import { makeItem } from '../src/item.ts'
import { age, bandLabel, itemsForTab, tabOf } from '../src/view.ts'

const mk = (over: any) => ({ ...makeItem({ title: 't', kind: 'todo', origin: 'agent', source: 'tool', project: 'P', sessionId: 's', nowMs: 0, hex4: '0000' }), ...over })

test('every open item lands in exactly one tab', async () => {
  expect(tabOf(mk({ origin: 'agent', kind: 'todo' }))).toBe('agent')
  expect(tabOf(mk({ origin: 'agent', kind: 'discussion' }))).toBe('agent')
  expect(tabOf(mk({ origin: 'human', kind: 'todo' }))).toBe('human')
  expect(tabOf(mk({ origin: 'human', kind: 'deferred' }))).toBe('parked')
  expect(tabOf(mk({ origin: 'agent', kind: 'proposal' }))).toBe('proposals')
  expect(tabOf(mk({ status: 'dropped' }))).toBe('done')
})

test('itemsForTab filters project, sorts newest first, caps', async () => {
  const items = Array.from({ length: 120 }, (_, n) => mk({ id: 'i' + n, createdAt: new Date(n * 1000).toISOString() }))
  const shown = itemsForTab([...items, mk({ id: 'other', project: 'Q' })], 'agent', 'p')
  expect(shown.length).toBe(100)
  expect(shown[0].id).toBe('i119')
  expect(itemsForTab(items, 'agent', null).length).toBe(100)
})

test('bandLabel counts open and new agent items; null when nothing', async () => {
  expect(bandLabel([], null)).toBe(null)
  const items = [mk({ createdAt: '2026-10-03T10:00:00.000Z' }), mk({ origin: 'human', createdAt: '2026-10-03T11:00:00.000Z' }), mk({ status: 'done' })]
  expect(bandLabel(items, '2026-10-03T09:00:00.000Z')).toBe('☰ Todos  2 open · 1 new')
  expect(bandLabel(items, '2026-10-03T12:00:00.000Z')).toBe('☰ Todos  2 open')
})

test('age', async () => {
  const now = Date.UTC(2026, 9, 3, 12)
  expect(age(now, new Date(now - 30_000).toISOString())).toBe('now')
  expect(age(now, new Date(now - 5 * 60_000).toISOString())).toBe('5m')
  expect(age(now, new Date(now - 3 * 3600_000).toISOString())).toBe('3h')
  expect(age(now, new Date(now - 2 * 86400_000).toISOString())).toBe('2d')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test tests/view.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/view.ts`**

```typescript
import { isOpen } from './item.ts'
import type { Item } from './item.ts'

export type Tab = 'agent' | 'human' | 'parked' | 'proposals' | 'done'

export const TABS: { id: Tab; label: string; hotkey: string }[] = [
  { id: 'agent', label: 'Agent', hotkey: '1' },
  { id: 'human', label: 'Human', hotkey: '2' },
  { id: 'parked', label: 'Parked', hotkey: '3' },
  { id: 'proposals', label: 'Proposals', hotkey: '4' },
  { id: 'done', label: 'Done', hotkey: '5' },
]

export function tabOf(item: Item): Tab {
  if (!isOpen(item)) return 'done'
  if (item.kind === 'deferred') return 'parked'
  if (item.kind === 'proposal') return 'proposals'
  return item.origin === 'agent' ? 'agent' : 'human'
}

export function itemsForTab(items: Item[], tab: Tab, project: string | null): Item[] {
  const p = project?.toLowerCase() ?? null
  const sortKey = (i: Item) => (tab === 'done' ? i.updatedAt : i.createdAt)
  return items
    .filter((i) => tabOf(i) === tab)
    .filter((i) => p === null || i.project.toLowerCase() === p)
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
    .slice(0, tab === 'done' ? 50 : 100)
}

export function bandLabel(items: Item[], lastSeenAt: string | null): string | null {
  const open = items.filter(isOpen)
  const fresh = open.filter((i) => i.origin === 'agent' && (lastSeenAt === null || i.createdAt > lastSeenAt))
  if (open.length === 0) return null
  return '☰ Todos  ' + open.length + ' open' + (fresh.length ? ' · ' + fresh.length + ' new' : '')
}

export function age(nowMs: number, iso: string): string {
  const s = Math.max(0, (nowMs - Date.parse(iso)) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  return Math.floor(s / 86400) + 'd'
}
```

- [ ] **Step 4: Run pure tests** → `claude plugin test tests/view.test.ts` → `4 pass`.

- [ ] **Step 5: Write failing pane tests**

`tests/pane.test.ts`:
```typescript
import { expect, test } from 'claude-code/testing'
import { setup, start } from './fakes.ts'

const BAND = { plugin: 'todo-ledger', component: 'AbovePrompt', requestId: 'band', viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 100, scroll: { offset: 0, bodyRows: 5 }, view: {} } } as const
const PANE = { plugin: 'todo-ledger', component: 'Pane', requestId: 'todo-ledger', viewport: { columns: 120, rows: 40 },
  props: { title: 'Todos', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const

test('empty ledger: band keeps engine content and adds no button', async ($, on) => {
  setup(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'ledger-toggle' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
})

test('band shows count and opens the pane', async ($, on) => {
  const opened: string[] = []
  on('ui.open', ($: any, e: any) => { opened.push(e.id); return { value: { isPlaced: true } } })
  setup(on)
  await start($)
  await $.command.run({ command: 'todo', args: 'add a' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'ledger-toggle' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'ledger-toggle' })
  expect(opened).toEqual(['todo-ledger'])
})

test('pane tabs filter, input adds a human item, Done closes it', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'agent thing', kind: 'todo' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /agent thing/ })).toBeDefined()
  await ui.press({ key: 'tab-human' })
  expect(await ui.find({ type: 'Text', text: /agent thing/ })).toBeUndefined()
  await ui.input({ key: 'new-item', text: 'human thing' })
  expect(await ui.find({ type: 'Text', text: /human thing/ })).toBeDefined()
  const human = [...disk.values()].map((t) => JSON.parse(t)).find((i) => i.title === 'human thing')
  expect(human.origin).toBe('human')
  await ui.press({ key: 'done-' + human.id })
  expect(await ui.find({ type: 'Text', text: /human thing/ })).toBeUndefined()
})

test('note input appends a human note', async ($, on) => {
  const { disk } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'discuss me', kind: 'discussion' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'note-' + id })
  await ui.input({ key: 'note-input-' + id, text: 'my view' })
  const item = JSON.parse([...disk.values()][0])
  expect(item.notes.at(-1)).toMatchObject({ by: 'human', text: 'my view' })
})
```

- [ ] **Step 6: Run to verify failure**

Run: `claude plugin test tests/pane.test.ts` → FAIL.

- [ ] **Step 7: Implement UI in `register.ts`**

Imports: `import { TABS, age, bandLabel, itemsForTab } from '../src/view.ts'` and `import type { Tab } from '../src/view.ts'`.

Module state:
```typescript
const PANE = 'todo-ledger'
let paneOpen = false
let tab: Tab = 'agent'
let allProjects = false
let newKind: Kind = 'todo'
let expandedId: string | null = null
let notingId: string | null = null
let startingId: string | null = null
let lastSeenAt: string | null = null
let cwd = ''
```

In `session.start`, after `loadAll`:
```typescript
    cwd = await $.session.cwd()
    const seen = await $.store.get('lastSeenAt')
    lastSeenAt = typeof seen === 'string' ? seen : null
```

Replace `togglePane`:
```typescript
async function togglePane($: any): Promise<void> {
  if (paneOpen) {
    paneOpen = false
    await $.ui.close({ id: PANE })
    return
  }
  await loadAll($)
  paneOpen = true
  lastSeenAt = new Date(await $.clock.now()).toISOString()
  await $.store.set('lastSeenAt', lastSeenAt)
  await $.ui.open({ id: PANE, title: 'Todos', focus: true, closeOnEscape: true })
  $.ui.invalidate('ui.render')
}

async function markStatus($: any, id: string, status: Status): Promise<void> {
  try { await setStatus($, id, status) } catch (err) { $.ui.toast('Todo not saved: ' + err.message) }
}

async function addNote($: any, id: string, text: string): Promise<void> {
  const item = cache.find((i) => i.id === id)
  if (!item || !text.trim()) return
  const at = new Date(await $.clock.now()).toISOString()
  try {
    await saveItem($, { ...item, updatedAt: at, notes: [...item.notes, { by: 'human', text: text.trim(), at }] })
  } catch (err) {
    $.ui.toast('Note not saved: ' + err.message)
  }
}

async function addFromPane($: any, text: string): Promise<void> {
  if (!text.trim()) return
  try { await capture($, { title: text, kind: newKind, origin: 'human', source: 'manual' }) }
  catch (err) { $.ui.toast('Todo not saved: ' + err.message) }
}
```

Hooks inside `register`:
```typescript
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) paneOpen = false
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const theirs = await next(e)
    const label = bandLabel(cache, lastSeenAt)
    if (!label) return theirs
    const { Box, Button } = $.ui.resolve(e)
    const mine = Button({ key: 'ledger-toggle', label, plain: true, onPress: () => togglePane($) })
    return Box({ flexDirection: 'column', children: theirs ? [mine, theirs] : [mine] })
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button, Input, Select } = $.ui.resolve(e)
    const redraw = () => $.ui.invalidate('ui.render')
    const now = await $.clock.now()
    const rows = itemsForTab(cache, tab, allProjects ? null : cwd)

    const tabRow = Box({
      flexDirection: 'row',
      columnGap: 2,
      children: [
        ...TABS.map((t) =>
          Button({ key: 'tab-' + t.id, label: t.label, hotkey: t.hotkey, plain: true, dimColor: tab !== t.id,
            onPress: () => { tab = t.id; startingId = null; notingId = null; redraw() } })),
        Select({ key: 'scope', label: 'Scope', value: allProjects ? 'all' : 'project',
          options: [{ value: 'project', label: 'This project' }, { value: 'all', label: 'All projects' }],
          onSelect: (v: string) => { allProjects = v === 'all'; redraw() } }),
      ],
    })

    const addRow = Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Input({ key: 'new-item', label: 'New', placeholder: 'type an item and press Enter', value: '', submitLabel: 'add',
          onSubmit: (v: string) => addFromPane($, v) }),
        Select({ key: 'new-kind', label: 'Kind', value: newKind,
          options: KINDS.map((k) => ({ value: k, label: k })),
          onSelect: (v: Kind) => { newKind = v; redraw() } }),
      ],
    })

    const itemRow = (i: Item) => {
      const badge = (tab === 'parked' || tab === 'proposals') ? (i.origin === 'agent' ? 'A ' : 'H ') : ''
      const meta = [i.kind, allProjects ? i.project.split('\\').pop() : null, age(now, i.createdAt)].filter(Boolean).join(' · ')
      const actions = startingId === i.id
        ? [startChooser($, e, i)]
        : notingId === i.id
          ? [Input({ key: 'note-input-' + i.id, label: 'Note', value: '', submitLabel: 'save', autoFocus: true,
              onSubmit: async (v: string) => { notingId = null; await addNote($, i.id, v); redraw() } })]
          : tab === 'done'
            ? [Button({ key: 'reopen-' + i.id, label: 'Reopen', onPress: () => markStatus($, i.id, 'open') })]
            : [
                Button({ key: 'start-' + i.id, label: 'Start', onPress: () => { startingId = i.id; redraw() } }),
                Button({ key: 'done-' + i.id, label: 'Done', onPress: () => markStatus($, i.id, 'done') }),
                Button({ key: 'drop-' + i.id, label: 'Drop', onPress: () => markStatus($, i.id, 'dropped') }),
                Button({ key: 'note-' + i.id, label: 'Note', onPress: () => { notingId = i.id; redraw() } }),
              ]
      const head = Box({
        flexDirection: 'row',
        columnGap: 1,
        children: [
          Button({ key: 'title-' + i.id, plain: true, label: badge + (i.kind === 'discussion' ? '💬 ' : '') + i.title,
            onPress: () => { expandedId = expandedId === i.id ? null : i.id; redraw() } }),
          Text({ dimColor: true, children: [meta] }),
          ...actions,
        ],
      })
      if (expandedId !== i.id) return head
      const detail = [i.body, ...i.notes.map((n) => n.by + ': ' + n.text)].filter(Boolean)
      return Box({ flexDirection: 'column', children: [head, ...detail.map((d) => Text({ dimColor: true, children: ['   ' + d] }))] })
    }

    return Box({
      flexDirection: 'column',
      children: [
        tabRow,
        addRow,
        ...(rows.length ? rows.map(itemRow) : [Text({ dimColor: true, children: ['Nothing here.'] })]),
      ],
    })
  })
```

`Button` here takes a `label`, so the Text-matching assertions in `tests/pane.test.ts` for titles must use `ui.find({ key: 'title-' + id })` if the kit doesn't match a Button label with `type: 'Text'`. Run the test; if the title assertions fail only for that reason, change them to `find({ key: 'title-' + id })` and assert `toBeDefined()` / `toBeUndefined()`.

Add a stub `startChooser` until Task 9:
```typescript
function startChooser($: any, e: any, item: Item) {
  const { Text } = $.ui.resolve(e)
  return Text({ children: ['…'] })
}
```

- [ ] **Step 8: Run tests and validate**

Run: `claude plugin test` → all pass. `claude plugin validate . --strict` → passed.

- [ ] **Step 9: Commit**

```bash
git add src/view.ts hooks/register.ts tests/view.test.ts tests/pane.test.ts
git commit -m "feat: band button and ledger pane"
```

---

### Task 9: Start chooser

**Files:**
- Create: `src/start.ts`
- Modify: `hooks/register.ts` (`startChooser`, `doStart`)
- Test: `tests/start.test.ts`

**Interfaces:**
- Consumes: `startingId`, `cache`, `saveItem`, `cwd`, button key `start-<id>` (Task 8).
- Produces:
  - `type StartChoice = 'send' | 'draft' | 'terminal' | 'copy'`
  - `startOptions(surface: 'terminal' | 'desktop'): { value: StartChoice; label: string }[]`
  - `startPrompt(item: Item, cwd: string): string`
  - `terminalArgv(project: string, prompt: string): string[]`
  - `doStart($, item: Item, choice: StartChoice): Promise<void>` (register.ts)

- [ ] **Step 1: Write failing tests**

`tests/start.test.ts`:
```typescript
import { expect, test } from 'claude-code/testing'
import { makeItem } from '../src/item.ts'
import { startOptions, startPrompt, terminalArgv } from '../src/start.ts'
import { setup, start } from './fakes.ts'

const PANE = { plugin: 'todo-ledger', component: 'Pane', requestId: 'todo-ledger', viewport: { columns: 120, rows: 40 },
  props: { title: 'Todos', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const

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

test('Send now submits as the user and marks in progress', async ($, on) => {
  const { disk, calls } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'go do', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'start-' + id })
  await ui.select({ key: 'start-choice-' + id, value: 'send' })
  expect(calls.submits[0]).toContain('go do')
  expect(JSON.parse([...disk.values()][0]).status).toBe('in_progress')
})

test('desktop offers Copy, not New terminal session', async ($, on) => {
  const { disk, calls } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'copy me', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'start-' + id })
  const sel = await ui.find({ key: 'start-choice-' + id })
  expect(sel.props.options.map((o: any) => o.value)).toEqual(['send', 'draft', 'copy'])
  await ui.select({ key: 'start-choice-' + id, value: 'copy' })
  expect(calls.copies[0]).toContain('copy me')
})

test('New terminal session runs wt in the item project', async ($, on) => {
  const { disk, calls } = setup(on)
  await start($)
  await $.tool.call({ tool: 'mcp__todo-ledger__park_item', title: 'term', kind: 'todo' })
  const id = JSON.parse([...disk.values()][0]).id
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'start-' + id })
  await ui.select({ key: 'start-choice-' + id, value: 'terminal' })
  expect(calls.argv.some((a) => a[0] === 'wt' && a[2] === 'D:\\Projects\\Demo')).toBe(true)
})
```

- [ ] **Step 2: Run to verify failure** → `claude plugin test tests/start.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/start.ts`**

```typescript
import type { Item } from './item.ts'

export type StartChoice = 'send' | 'draft' | 'terminal' | 'copy'

export function startOptions(surface: 'terminal' | 'desktop'): { value: StartChoice; label: string }[] {
  const common: { value: StartChoice; label: string }[] = [
    { value: 'send', label: 'Send now' },
    { value: 'draft', label: 'Draft into prompt' },
  ]
  return surface === 'terminal'
    ? [...common, { value: 'terminal', label: 'New terminal session' }]
    : [...common, { value: 'copy', label: 'Copy prompt' }]
}

export function startPrompt(item: Item, cwd: string): string {
  const lines = [
    `Work on this ledger item (id ${item.id}, ${item.kind}, from project ${item.project}):`,
    item.title,
  ]
  if (item.body) lines.push(item.body)
  if (item.notes.length) lines.push('Notes:', ...item.notes.map((n) => `- ${n.by}: ${n.text}`))
  if (item.project.toLowerCase() !== cwd.toLowerCase()) {
    lines.push(`Note: this item came from a different project (${item.project}); this session is in ${cwd}.`)
  }
  lines.push(`When finished, call update_item with id ${item.id} and status done.`)
  return lines.join('\n')
}

export function terminalArgv(project: string, prompt: string): string[] {
  return ['wt', '-d', project, 'claude', prompt]
}
```

- [ ] **Step 4: Replace `startChooser` and add `doStart` in `register.ts`**

Import: `import { startOptions, startPrompt, terminalArgv } from '../src/start.ts'` and `import type { StartChoice } from '../src/start.ts'`.

```typescript
async function doStart($: any, item: Item, choice: StartChoice): Promise<void> {
  const text = startPrompt(item, cwd)
  try {
    if (choice === 'send') {
      await saveItem($, { ...item, status: 'in_progress', updatedAt: new Date(await $.clock.now()).toISOString() })
      $.prompt.submit({ text, asUser: true })
    } else if (choice === 'draft') {
      await $.prompt.fill({ text })
    } else if (choice === 'copy') {
      await $.ui.copy(text)
      $.ui.toast('Prompt copied')
    } else {
      const r = await $.process.run(terminalArgv(item.project, text))
      if (r.exitCode !== 0) {
        const fb = await $.process.run(['cmd', '/c', 'start', 'cmd', '/k', 'cd', '/d', item.project, '&&', 'claude', text])
        if (fb.exitCode !== 0) { await $.ui.copy(text); $.ui.toast('Could not open a terminal; prompt copied instead') }
      }
    }
  } catch (err) {
    $.ui.toast('Start failed: ' + err.message)
  }
}

function startChooser($: any, e: any, item: Item) {
  const { Select } = $.ui.resolve(e)
  return Select({
    key: 'start-choice-' + item.id,
    label: 'Start',
    options: startOptions(e.surface === 'desktop' ? 'desktop' : 'terminal'),
    autoFocus: true,
    onSelect: async (v: StartChoice) => {
      startingId = null
      await doStart($, item, v)
      $.ui.invalidate('ui.render')
    },
  })
}
```

`startChooser` takes `$` and is top-level in `register.ts`, which the validator allows. If validation reports `$.ui.resolve` used outside a hook, inline the `Select` construction into the Pane hook's `itemRow` instead and keep `doStart` top-level.

If `$.process.run(['wt', …])` rejects (program not found) rather than returning non-zero, the `try` sends it to the toast; wrap the `wt` call in its own `try` and fall through to the `cmd` fallback on catch.

- [ ] **Step 5: Run tests and validate**

Run: `claude plugin test` → all pass. `claude plugin validate . --strict` → passed.

- [ ] **Step 6: Commit**

```bash
git add src/start.ts hooks/register.ts tests/start.test.ts
git commit -m "feat: Start chooser (send, draft, new terminal, copy)"
```

---

### Task 10: Global install, README, manual verification

**Files:**
- Create: `README.md`
- Modify: `C:\Users\saran\.claude\settings.json` (add `env.CLAUDE_CODE_PLUGIN_DIRS`)

**Interfaces:**
- Consumes: the finished mod.

- [ ] **Step 1: Write README.md**

```markdown
# todo-ledger

A Claude Code mod: one global ledger of agent- and human-initiated todos, deferred items, proposals and discussions, across every project.

Requires Claude Code v2.1.287+.

## Install (every session, every project)

Add to `%USERPROFILE%\.claude\settings.json`:

    "env": { "CLAUDE_CODE_PLUGIN_DIRS": "D:\\Projects\\AGENTIC\\TODO\\todo-ledger" }

Start a new session; `/plugin` shows `1 mod active · todo-ledger`.

## Use

- Button above the prompt: `☰ Todos  N open · M new` — press to toggle the pane.
- `/todos` toggle pane · `/todos list [all]` print open items
- `/todo add [-d|-p|-n] <text>` add (deferred / proposal / discussion) · `/todo done <id>`
- Claude records items itself with `park_item`; TodoWrite lists are mirrored; a Haiku scan after long replies catches deferrals it missed.
- Start: Send now · Draft into prompt · New terminal session (CLI) / Copy prompt (desktop).

## Data

`%USERPROFILE%\.claude\todo-ledger\items\<id>.json`, one file per item.

## Turn off

Remove the env entry, or start with `claude --safe-mode`.
```

- [ ] **Step 2: Add the env entry**

Read `C:\Users\saran\.claude\settings.json`; merge into its existing `env` object (create `env` if absent) without touching other keys:
```json
"CLAUDE_CODE_PLUGIN_DIRS": "D:\\Projects\\AGENTIC\\TODO\\todo-ledger"
```
If `CLAUDE_CODE_PLUGIN_DIRS` already has a value, append with `;`.

- [ ] **Step 3: CLI check**

In a new terminal in `D:\Projects\AGENTIC\TODO`:
```bash
claude
```
Expected: `/plugin` shows `todo-ledger` active. `/todo add -d try the ledger` → `Added try the ledger`; band shows `☰ Todos  1 open`; `/todos` opens the pane; tab 3 (Parked) lists it.

Ask Claude: "Plan a refactor of X but defer the tests to later." Expected: an item with `origin: agent` appears (via `park_item` or scan) — check tab 1/3.

- [ ] **Step 4: Two-session concurrency check**

Open a second terminal in a different folder (e.g. `D:\Projects\AGENTIC\Search`), run `claude`, and in both sessions run `/todo add from-A` / `/todo add from-B` at the same time. Then `/todos list all` in either: both items present; `items\` holds two files.

- [ ] **Step 5: Desktop check**

Restart the Claude desktop app, open a Code tab session. Expected: band button visible above the prompt; pane opens; Start → Copy prompt shows the toast; Start → Draft fills the prompt box. If the band doesn't appear, check the desktop's Claude Code version against 2.1.287 and record the result in README "Known limits".

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: README and install"
```

---

## Self-review notes

- Spec §5.1 named `prompt.section` for the standing instruction; the plan puts the instruction in the `park_item` tool description instead (no section name to target is documented). Spec §4 named `scan.log`; the plan uses `$.ui.log` only. Spec §3 listed `src/store.ts` / `src/capture.ts` / `src/ui.ts`; the validator forbids passing `$` to imported functions, so those live as top-level functions in `hooks/register.ts`. The spec is updated to match in the same commit as this plan.
- Spec coverage: data model (T2–3), capture tool/mirror/scan (T5–7), human items (T4, T8), band + pane + tabs + filter (T8), Start chooser (T9), commands (T4), error handling (T3, T5–9), tests (every task), install (T10).
