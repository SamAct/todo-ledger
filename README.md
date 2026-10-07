# todo-ledger

A Claude Code mod that keeps one global ledger of the work you and Claude leave behind: todos, parked or deferred items, proposals and discussions, from every project and session. It lives in a **ToDo's** sidebar in the desktop app and the terminal.

- Claude adds items itself when it defers, parks or proposes something, with a short plain-English note on what and why.
- After long replies, a quick Haiku scan catches deferrals Claude didn't record, and closes items the conversation settled (approved, rejected, done, duplicate).
- You add your own with `/todo add`.
- Pick an item and **Send** it to Claude, **Draft** it into the prompt, or copy it for another session.

Works on Windows, macOS and Linux. Requires Claude Code **v2.1.287 or later** (mods support).

## Install

In Claude Code:

```
/plugin marketplace add SamAct/todo-ledger
/plugin install todo-ledger@todo-ledger
```

Then start a new session (or run `/reload-plugins`). A `☰ ToDo's` button appears in the prompt footer.

## Use

- **Footer button** `☰ ToDo's N`: opens the sidebar. N is this project's open items.
- **Sidebar**: `This project ▾` switches to all projects; tabs **Agent / Human / Done**; items grouped by what they need (Needs decision, To do, Discussion, Parked). Click an item to open its card.
- **Card actions**: Start (Send · Draft · Copy/Terminal), Done, Drop, Note. Proposals get Approve and Reject. Keys in an open card: `s` start, `d` done, `x` drop, `n` note, `a` approve.
- **Done tab**: Reopen, or Delete forever (dropped items only, two steps).

Commands:

| Command | Does |
| --- | --- |
| `/todos` | Toggle the sidebar |
| `/todos list [all]` | Print open items (this project, or all) |
| `/todos refresh` | Reload items written by other sessions |
| `/todo add [-d\|-p\|-n] <text>` | Add a todo (`-d` deferred, `-p` proposal, `-n` discussion) |
| `/todo done <id>` | Mark an item done |
| `/todo delete <id>` | Delete a dropped item forever |

Claude gets four tools: `park_item`, `list_items`, `get_item` and `update_item`. It keeps the ledger current by itself, and agents can only drop items, never delete them.

## Data

One JSON file per item in `~/.claude/todo-ledger/items/` (`%USERPROFILE%\.claude\todo-ledger\items\` on Windows). Every Claude Code session on the machine shares it; open panes pick up changes within about 10 seconds. Nothing leaves your machine except the end-of-turn scan, which sends the last reply to Claude Haiku through your own Claude Code session.

## Develop

```
claude plugin validate . --strict
claude plugin test .
claude --plugin-dir .
```

## License

MIT
