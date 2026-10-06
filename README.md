# todo-ledger

A Claude Code mod: one global ledger of agent- and human-initiated todos, deferred items, proposals and discussions, across every project.

Requires Claude Code v2.1.287+.

## Install (every session, every project)

Add to `%USERPROFILE%\.claude\settings.json`:

    "env": { "CLAUDE_CODE_PLUGIN_DIRS": "D:\\Projects\\AGENTIC\\TODO\\todo-ledger" }

Start a new session; `/plugin` shows `1 mod active · todo-ledger`.

## Use

- Footer button `☰ ToDo's N` (this project's open items) toggles the pane: scope row, tabs Agent / Human / Done, items grouped by what they need, a card per selected item.
- `/todos` toggle pane · `/todos list [all]` print open items
- `/todo add [-d|-p|-n] <text>` add (deferred / proposal / discussion) · `/todo done <id>`
- Claude records items itself with `park_item`; TodoWrite lists are mirrored; a Haiku scan after long replies catches deferrals it missed.
- Start, one button each: Send now · Draft in prompt · New terminal (CLI) / Copy prompt (desktop).

## Data

`%USERPROFILE%\.claude\todo-ledger\items\<id>.json`, one file per item.

## Turn off

Remove the env entry, or start with `claude --safe-mode`.
