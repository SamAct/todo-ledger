# Todo Ledger — a Claude Code mod for cross-project todos, deferred items, proposals and discussions

Date: 2026-10-03
Status: Draft for review

## 1. Purpose

One global ledger, shared by every Claude Code session on this machine regardless of project, that
records:

- todos
- items parked or deferred for later
- proposals made by agents
- discussions attached to any of the above

Every item is tagged by who started it: **agent** or **human**. Agent items are captured
automatically. The ledger is visible and actionable from a small button in both the Claude Code CLI
and the Code tab of the Claude desktop app, and any item can be turned back into work ("Start").

### Success criteria

1. A deferral or proposal Claude makes in any project appears in the ledger without the user doing
   anything.
2. The user can add an item in one action (`/todo add …` or the pane's input).
3. A button above the prompt shows the open count and toggles the pane, in both CLI and desktop.
4. From the pane the user can Start an item (send / draft / new session or copy), mark it Done or
   Dropped, and add a note.
5. Two sessions running at once never lose each other's items.

### Non-goals

- Syncing across machines or to a cloud service.
- Sharing with other people.
- Working in VS Code chat panel, `claude -p`, WSL sessions or cloud sessions (hooks run there but
  nothing is drawn; capture still works wherever hooks run, per the "Where mods run" table in the
  mods overview).

## 2. Platform facts this design relies on

Verified against the docs on 2026-10-03:

| Fact | Source |
|---|---|
| Mods (JS/TS plugins) can draw a pane, a band above the prompt, buttons, inputs and selects, in the CLI and the desktop Code tab | code.claude.com/docs/en/plugins/mods/overview, /interface |
| Mods need Claude Code **v2.1.287+**. Installed CLI is **2.1.285** → must run `claude update` first | overview; `claude --version` |
| `$.tool.register` exposes a tool to Claude as `mcp__<plugin>__<name>` | /api |
| `$.prompt.submit({ text, asUser })`, `$.prompt.fill` (draft into prompt box), `$.ui.copy` exist | /reference |
| `$.model.complete({ model: 'haiku', … })` makes a side call on the user's plan | /api |
| `turn.complete`, `tool.call`, `prompt.section`, `session.start`, `classic.SessionStart` events exist | /reference |
| `$.fs.write` is not atomic; `$.store` is capped at 4 MiB and races across sessions | /reference |
| `CLAUDE_CODE_PLUGIN_DIRS` loads a plugin directory in every session (`;`-separated on Windows) | /reference |
| Hook execution limit 10 s (time inside `$` calls not counted); `$.process.run` 30 s default | /reference |

Not verified yet (checked during implementation, task 1):

- The Claude desktop app's bundled Claude Code version is ≥ 2.1.287.
- `e` fields available on `turn.complete` (whether the final reply text is on the event or must be
  read via `$.session.messages()`). Design assumes `$.session.messages()` as the fallback.
- Exact field names in the generated `claude-code.d.ts` for this build.

## 3. Architecture

One plugin directory, `D:\Projects\AGENTIC\TODO\todo-ledger\`, loaded globally via
`CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`.

```
todo-ledger/
├── .claude-plugin/plugin.json
├── hooks/
│   ├── hooks.json            { "modules": ["./register.ts"] }
│   └── register.ts           wires events → modules below
├── src/
│   ├── store.ts              read/write/list items on disk
│   ├── capture.ts            park_item tool, TodoWrite mirror, end-of-turn scan
│   ├── ui.ts                 band button, pane, Start chooser
│   ├── commands.ts           /todos, /todo
│   └── item.ts               Item type, id generation, dedupe key
├── types/index.d.ts          $.state declarations
└── tests/*.test.ts
```

Each unit has one job:

| Unit | Does | Depends on |
|---|---|---|
| `item.ts` | Item type, `newId()`, `dedupeKey(title, project)` | nothing |
| `store.ts` | `save(item)`, `get(id)`, `list(filter)`, `update(id, patch)` against the item files | `$.fs`, `$.process` |
| `capture.ts` | Turns tool calls, TodoWrite calls and turn ends into `store.save` calls | `store`, `$.model`, `$.session` |
| `ui.ts` | Draws band + pane from `store.list`, routes button presses | `store`, `$.ui`, `$.prompt`, `$.process` |
| `commands.ts` | `/todos`, `/todo add` | `store`, `ui` |

## 4. Data model

Storage root: `~/.claude/todo-ledger/`

```
~/.claude/todo-ledger/
├── items/<id>.json      one file per item
└── scan.log             one line per scan failure (rotated at 1 MiB)
```

One file per item means two sessions only collide if they edit the same item at the same moment.
Writes go to `<id>.json.tmp` and are then renamed over `<id>.json` (rename via `$.process.run`
`cmd /c move /y`, since `$.fs` has no rename), so a reader never sees a half-written file.

Item:

```json
{
  "id": "20261003-142233-a1b2",
  "title": "Add CLM 8B GGUF check",
  "body": "Optional longer text",
  "kind": "todo | deferred | proposal | discussion",
  "origin": "agent | human",
  "status": "open | in_progress | done | dropped",
  "project": "D:\\Projects\\AGENTIC\\TODO",
  "sessionId": "e4d4850b-…",
  "source": "tool | todowrite | scan | manual",
  "createdAt": "2026-10-03T14:22:33Z",
  "updatedAt": "2026-10-03T14:22:33Z",
  "notes": [{ "by": "agent | human", "text": "…", "at": "…" }]
}
```

`id` = timestamp + 4 random hex chars: sortable and unique without a counter file.

Dedupe key = lower-cased, whitespace-collapsed `title` + `project`. A capture whose key matches an
**open** item adds a note to it instead of creating a new one.

## 5. Capture

### 5.1 `park_item` tool (agent, explicit)

Registered in `session.start` as `park_item` → Claude sees `mcp__todo-ledger__park_item`.

Input schema: `title` (required), `kind` (required, enum), `body` (optional).
`origin` is always `agent`; `project` and `sessionId` come from `$.session.cwd()` / `$.session.id()`.

A `prompt.section` hook appends this instruction to the system prompt (one short paragraph):

> When you defer, park, postpone or put something out of scope, or propose work the user has not
> asked for, call `park_item` with a one-line title. Do not ask first.

Also registered: `list_items` (filter by project/kind/status) so Claude can reference the ledger,
and `update_item` (status, add note) so Claude can close an item it finished.

### 5.2 TodoWrite mirror (agent, implicit)

`tool.call` hook on `TodoWrite`: after `next(e)`, for each todo in the call:

- new title → `save` with `kind: todo`, `source: todowrite`
- existing (by dedupe key, same session) → update status: `completed` → `done`,
  `in_progress` → `in_progress`
- the hook never blocks or changes the TodoWrite call

### 5.3 End-of-turn scan (agent, inferred)

`turn.complete` hook, run without blocking the turn (work scheduled with `$.clock.after(0, …)`):

Skip when any of:
- the final reply is under 400 characters
- `park_item` was called in this turn

Otherwise call `$.model.complete` with `model: 'haiku'`, `maxTokens: 400`, `timeoutMs: 20000`, a
system prompt asking for JSON only:

```json
{ "items": [{ "title": "…", "kind": "deferred | proposal | todo" }] }
```

Input: the final assistant reply (last 6,000 chars) plus the titles already in the ledger for this
project, so the model does not repeat them. Each returned item goes through the dedupe key before
saving with `source: scan`.

On a parse failure, timeout or `isAnswered: false`: save nothing, append one line to `scan.log`,
show `$.ui.log('scan skipped: <reason>')`.

### 5.4 Human items

- `/todo add <text>` → `origin: human`, `kind: todo`. Prefix flags: `/todo add -d <text>` deferred,
  `-p` proposal, `-n` discussion.
- The pane's Input field, with a `Select` for kind.

## 6. Interface

### 6.1 Band above the prompt (the button)

A single plain `Button` in the `AbovePrompt` site:

```
☰ Todos  4 open · 2 new
```

- "new" = agent items created since the user last opened the pane (`lastSeenAt` in `$.store`).
- Press (or `/todos`) toggles the pane.
- Hidden when there are 0 open items and 0 new, so the band stays clear.
- Keeps other mods' band content by including `await next(e)`.

### 6.2 Pane

Opened with `$.ui.open({ id: 'todo-ledger', title: 'Todos', focus: true, closeOnEscape: true })`.

```
1:Agent  2:Human  3:Parked  4:Proposals  5:Done        [This project ▾]
New: [ type an item and press Enter ] [todo ▾]
────────────────────────────────────────────────────────────────
● Add CLM 8B GGUF check          deferred · TODO · 2h   [Start] [Done] [Drop] [Note]
● Test Plumb logprobs in LMS     proposal · TODO · 1d   [Start] [Done] [Drop] [Note]
```

Tabs:
| Tab | Shows |
|---|---|
| Agent | `origin=agent`, kind `todo` or `discussion`, status open/in_progress |
| Human | `origin=human`, kind `todo` or `discussion`, status open/in_progress |
| Parked | kind `deferred`, any origin, status open/in_progress |
| Proposals | kind `proposal`, any origin, status open/in_progress |
| Done | status done/dropped, any kind, newest 50 |

Every non-done item appears in exactly one of the first four tabs. Discussions carry a 💬 marker.
Rows show an `A` or `H` badge for origin in the Parked and Proposals tabs. Notes on any item show
when the row is expanded (press its title).

Filter `Select`: This project (default) / All projects. In All projects mode each row shows the
project folder name.

Long lists: newest 100 per tab; the pane scrolls.

### 6.3 Start chooser

Pressing **Start** replaces the row's buttons with a `Select`:

| Option | Action | Surface |
|---|---|---|
| Send now | `$.prompt.submit({ text: startPrompt(item), asUser: true })`; status → `in_progress` | both |
| Draft into prompt | `$.prompt.fill(startPrompt(item))` | both |
| New terminal session | `$.process.spawn(['wt', '-d', item.project, 'claude', startPrompt(item)])` | terminal only |
| Copy prompt | `$.ui.copy(startPrompt(item))` | both (shown instead of New terminal session on desktop) |

`startPrompt(item)` =

```
Work on this ledger item (id <id>, <kind>, from project <project>):
<title>
<body>
Notes:
- <notes…>
When finished, call update_item with status done.
```

If the item's project differs from the current session's cwd, the prompt says so, so Claude can
decide whether to work cross-project.

### 6.4 Commands

| Command | Does |
|---|---|
| `/todos` | Toggle the pane (`immediate: true`, works while Claude is busy) |
| `/todos list [all]` | Print open items for this project (or all) into the transcript |
| `/todo add [-d\|-p\|-n] <text>` | Add a human item |
| `/todo done <id-prefix>` | Mark done |

`/todos` and `/todo` must not collide with built-ins. If `$.command.register` throws, fall back to
`/ledger` and `/ledger-add` and log that.

## 7. Error handling

| Failure | Behaviour |
|---|---|
| Item file unreadable / bad JSON | Skip it, `$.ui.log` its filename once per session |
| Write/rename fails | Toast "Todo not saved: <reason>"; tool call returns that error text to Claude |
| Scan fails | Nothing saved, one line to `scan.log`, dim log line |
| `wt` not found | Fall back to `cmd /c start cmd /k claude …`; if that fails, toast and copy prompt |
| Desktop bundles Claude Code < 2.1.287 | Mod doesn't load there; documented in README with the CLI as fallback |
| Hook throws | `.catch` handler logs and lets the event continue unchanged — the mod never blocks a turn or a TodoWrite call |

## 8. Testing

Automated (`claude plugin test`, stubs for `$.fs`, `$.process`, `$.model`):

1. `park_item` writes a valid item file with `origin: agent`.
2. Dedupe: same title + project adds a note, not a new file.
3. TodoWrite mirror: new todos saved; `completed` closes the stored item.
4. Scan: valid JSON → items saved; malformed JSON → nothing saved + log line; short reply → no
   model call.
5. Pane: each tab filters correctly; Start → Send now calls `$.prompt.submit` with the expected
   text; on `surface: 'desktop'` the chooser shows Copy prompt and not New terminal session.
6. Band: hidden at 0 open / 0 new; count correct.

Manual, after `claude update`:

1. CLI: start a session in two different projects, defer something in each, confirm both appear in
   All projects.
2. Two sessions add items at the same time → both files exist.
3. Desktop Code tab: band button visible, pane opens, Send now / Draft / Copy work.

## 9. Install and rollout

1. `claude update` → confirm `claude --version` ≥ 2.1.287.
2. Add to `~/.claude/settings.json` → `env.CLAUDE_CODE_PLUGIN_DIRS = "D:\\Projects\\AGENTIC\\TODO\\todo-ledger"`.
3. `claude plugin validate D:\Projects\AGENTIC\TODO\todo-ledger --strict`.
4. Open a new session; `/plugin` should show `1 mod active · todo-ledger`.

To turn it off: remove the env entry, or `--safe-mode` for one session.

## 10. Open questions

None blocking. Decided during design:
- Desktop UI = mod band button + pane (not tray app or artifact).
- Capture = tool + TodoWrite mirror + Haiku end-of-turn scan.
- Start = chooser each time.
- Storage = one JSON file per item under `~/.claude/todo-ledger/items/`.
