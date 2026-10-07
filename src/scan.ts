export type ScanKind = 'todo' | 'deferred' | 'proposal'
const SCAN_KINDS: ScanKind[] = ['todo', 'deferred', 'proposal']

export const SCAN_SYSTEM =
  'You keep a todo ledger current from one turn of a conversation between a USER and an AI coding assistant (the REPLY).\n' +
  '1. items: things the assistant explicitly deferred, parked, left for later, put out of scope, or proposed without being ' +
  'asked. Not work completed in the reply. Not anything already in KNOWN, even reworded.\n' +
  '2. updates: KNOWN items this turn changed. "approve": the USER agreed to a proposal. "reject": the USER declined it. ' +
  '"done": the REPLY shows its work was completed. "duplicate": it is the same thing as another KNOWN item (give "of": that id). ' +
  'Use only ids from KNOWN. Only when the USER message or the REPLY says so clearly; when unsure, leave it out.\n' +
  'Give each item a "detail": 2 to 4 short sentences in plain English, no jargon, saying what the task is and why it ' +
  'was deferred or proposed.\n' +
  'Reply with JSON only: {"items":[{"title":"one line","kind":"todo|deferred|proposal","detail":"..."}],' +
  '"updates":[{"id":"…","action":"approve|reject|done|duplicate","of":"…"}]}. Use empty arrays when there is nothing.'

export function shouldScan(answer: unknown, parked: boolean): boolean {
  return typeof answer === 'string' && answer.length >= 400 && !parked
}

export type KnownItem = { id: string; title: string; kind: string }

export function buildScanPrompt(answer: string, known: (string | KnownItem)[], userText?: string): string {
  const lines = known.length
    ? known.map((k) => (typeof k === 'string' ? '- ' + k : `- [${k.id}] (${k.kind}) ${k.title}`)).join('\n')
    : '(none)'
  const user = userText && userText.trim() ? 'USER:\n' + userText.trim().slice(-2000) + '\n\n' : ''
  return 'KNOWN:\n' + lines + '\n\n' + user + 'REPLY:\n' + answer.slice(-6000)
}

export type ScanUpdate = { id: string; action: 'approve' | 'reject' | 'done' } | { id: string; action: 'duplicate'; of: string }
const ACTIONS = ['approve', 'reject', 'done', 'duplicate']

// Updates the model proposed, kept only when they name ids the prompt listed.
export function parseScanUpdates(text: string, knownIds: string[]): ScanUpdate[] {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  let v: any
  try { v = JSON.parse(text.slice(start, end + 1)) } catch { return [] }
  if (!v || !Array.isArray(v.updates)) return []
  const known = new Set(knownIds)
  const out: ScanUpdate[] = []
  for (const u of v.updates) {
    if (!u || !known.has(u.id) || !ACTIONS.includes(u.action)) continue
    if (u.action === 'duplicate') {
      if (typeof u.of === 'string' && known.has(u.of) && u.of !== u.id) out.push({ id: u.id, action: 'duplicate', of: u.of })
    } else out.push({ id: u.id, action: u.action })
  }
  return out
}

export function parseScanReply(text: string): { title: string; kind: ScanKind; detail?: string }[] | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let v: any
  try { v = JSON.parse(text.slice(start, end + 1)) } catch { return null }
  if (!v || !Array.isArray(v.items)) return null
  return v.items
    .filter((i: any) => i && typeof i.title === 'string' && i.title.trim() && SCAN_KINDS.includes(i.kind))
    .map((i: any) => ({ title: i.title.trim(), kind: i.kind,
      ...(typeof i.detail === 'string' && i.detail.trim() ? { detail: i.detail.trim().slice(0, 600) } : {}) }))
}
