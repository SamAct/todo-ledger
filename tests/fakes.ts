import { mock } from 'claude-code/testing'

export const HOME = 'C:\\Users\\t'
export const DIR = HOME + '\\.claude\\todo-ledger\\items'
export const CWD = 'D:\\Projects\\Demo'

const ZERO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

export function setup(on: any, opts: { modelText?: string; modelAnswered?: boolean; denyWrite?: string; files?: Record<string, string> } = {}) {
  const disk = new Map<string, string>(Object.entries(opts.files ?? {}))
  const calls = { argv: [] as string[][], submits: [] as string[], fills: [] as string[], copies: [] as string[], logs: [] as string[], toasts: [] as string[], tools: [] as string[], toolDescs: {} as Record<string, string>, commands: [] as string[], opens: [] as string[], models: 0 }
  const store = new Map<string, unknown>()

  mock.env(on, { USERPROFILE: HOME })
  on('session.start', () => ({ cwd: CWD }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('command.register', ($: any, e: any) => { calls.commands.push(e.name); return { value: { command: e.name } } })
  on('tool.register', ($: any, e: any) => { calls.tools.push(e.name); calls.toolDescs[e.name] = e.description; return { value: { tool: 'mcp__todo-ledger__' + e.name } } })
  on('store.get', ($: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: any) => { store.set(e.key, e.value); return { value: undefined } })
  on('fs.exists', ($: any, e: any) => ({ value: e.path === DIR || disk.has(e.path) }))
  on('fs.list', ($: any, e: any) => ({
    value: [...disk.keys()]
      .filter((p) => p.startsWith(e.path + '\\'))
      .map((p) => ({ name: p.slice(e.path.length + 1), kind: 'file', size: disk.get(p)!.length, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', ($: any, e: any) => ({ value: disk.get(e.path) ?? '' }))
  on('fs.write', ($: any, e: any) => { if (opts.denyWrite) return { deny: opts.denyWrite }; disk.set(e.path, e.text); return { value: undefined } })
  on('process.run', ($: any, e: any) => {
    calls.argv.push(e.argv)
    if (e.argv[2] === 'move') { disk.set(e.argv[5], disk.get(e.argv[4])!); disk.delete(e.argv[4]) }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('model.complete', () => {
    calls.models += 1
    if (opts.modelAnswered ?? true) {
      return { value: { isAnswered: true, text: opts.modelText ?? '{"items":[]}', usage: ZERO_USAGE } }
    }
    return { value: { isAnswered: false, reason: 'empty-reply', usage: ZERO_USAGE } }
  })
  on('prompt.submit', ($: any, e: any) => { calls.submits.push(e.text); return { text: e.text } })
  on('prompt.fill', ($: any, e: any) => { calls.fills.push(e.text); return { isFilled: true } })
  on('ui.copy', ($: any, e: any) => { calls.copies.push(typeof e === 'string' ? e : e.text); return { value: { isCopied: true } } })
  on('ui.log', ($: any, e: any) => { calls.logs.push(e.text); return { value: undefined } })
  on('ui.toast', ($: any, e: any) => { calls.toasts.push(e.text); return { value: undefined } })
  on('ui.open', ($: any, e: any) => { calls.opens.push(e.id); return { value: { isPlaced: true } } })
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
