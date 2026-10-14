// Sets the version everywhere it is written by hand: the plugin manifest, the
// marketplace entry, and the website (badge and JSON-LD). Run it for each release:
//
//   node scripts/bump-version.mjs 1.1.0
//
// With no argument it prints the versions found and exits non-zero if they disagree.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const at = (p) => join(root, p)
const read = (p) => readFileSync(at(p), 'utf8')

const PLUGIN = '.claude-plugin/plugin.json'
const MARKET = '.claude-plugin/marketplace.json'
const PAGE = 'docs/index.html'

const BADGE = /(<a class="badge"[^>]*>v)(\d+\.\d+\.\d+)(<\/a>)/
const LD = /("softwareVersion":")(\d+\.\d+\.\d+)(")/

function found() {
  const plugin = JSON.parse(read(PLUGIN)).version
  const market = JSON.parse(read(MARKET)).plugins?.[0]?.version
  const page = read(PAGE)
  return { [PLUGIN]: plugin, [MARKET]: market, [PAGE + ' badge']: page.match(BADGE)?.[2], [PAGE + ' json-ld']: page.match(LD)?.[2] }
}

const next = process.argv[2]
if (!next) {
  const v = found()
  for (const [k, x] of Object.entries(v)) console.log(String(x ?? 'MISSING').padEnd(9), k)
  process.exit(new Set(Object.values(v)).size === 1 && !Object.values(v).includes(undefined) ? 0 : 1)
}
if (!/^\d+\.\d+\.\d+$/.test(next)) { console.error('Give a version like 1.2.3'); process.exit(2) }

// JSON files: replace the version text only, so formatting and key order stay as written.
for (const p of [PLUGIN, MARKET]) {
  const text = read(p)
  const out = text.replace(/("version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${next}$2`)
  if (out === text && !text.includes(`"${next}"`)) { console.error('No version found in ' + p); process.exit(1) }
  writeFileSync(at(p), out)
}
let page = read(PAGE)
if (!BADGE.test(page) || !LD.test(page)) { console.error('Badge or JSON-LD version not found in ' + PAGE); process.exit(1) }
page = page.replace(BADGE, `$1${next}$3`).replace(LD, `$1${next}$3`)
writeFileSync(at(PAGE), page)

const v = found()
console.log(Object.entries(v).map(([k, x]) => x + '  ' + k).join('\n'))
