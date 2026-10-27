// The rules every agent follows when it touches the ledger. Sent as a system-prompt section, so a
// subagent or a fresh session gets them without reading the tool descriptions first.
export const POLICY_ID = 'todo-ledger:policy'

export const POLICY_TEXT = [
  "# The user's ToDo ledger",
  'The ledger is the user\'s global list of work that would otherwise be lost. Keep it short and true.',
  '',
  'Park an item (park_item) only when ALL of these hold:',
  '- Real work or a real decision remains, and it was not done in this turn.',
  '- You deferred it, it is out of scope, it needs the user\'s decision, or you propose work with a clear payoff.',
  '- The user would be worse off if nobody remembered it.',
  'Do not park: steps of the task you are doing now, anything you can finish now, your own progress notes,',
  'speculation, style nits, facts already in memory or CLAUDE.md, or an item you just completed.',
  'When unsure whether it is worth a line, do not park it.',
  '',
  'Never duplicate. Before parking, call list_items (scope "all" when the work could belong to another',
  'project). If an open item covers the same work, even in other words, call update_item on it with a note',
  'instead. If park_item answers "Already in ledger", do not park it again under another title.',
  '',
  'Always close. When you finish the work behind an item, call update_item with status "done" in the same',
  'turn, before your final reply. If it stops being relevant or the user rejects it, set "dropped" with a',
  'note saying why. If you could only part of it, add a note saying what is left and leave it open.',
  'This holds for items you started from the ledger and for items you notice you completed on the way.',
  '',
  'Subagents do not write to the ledger. They report what they deferred or finished to the agent that',
  'started them, and that agent records it.',
].join('\n')
