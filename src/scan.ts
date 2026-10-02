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
