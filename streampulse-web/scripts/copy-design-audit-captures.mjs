import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(here, '../..')
const src = path.join(webRoot, 'test-results')
const dest = path.resolve(webRoot, '../docs/website-portal/audits/2026-08-12-portal-ui/baseline-captures')
fs.mkdirSync(dest, { recursive: true })

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, acc)
    else if (/\.(json|png|md)$/i.test(ent.name)) acc.push(p)
  }
  return acc
}

const files = walk(src).filter((f) => /landing-design-audit|analytics-design-audit/i.test(f))
let copied = 0
const honesty = []
for (const f of files) {
  const rel = path.relative(src, f).replace(/[<>:"|?*]/g, '_')
  const out = path.join(dest, rel)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.copyFileSync(f, out)
  copied += 1
  if (/honesty-probes\.json$|evidence\.json$|matrix-summary\.json$/i.test(f)) {
    try {
      honesty.push({ file: rel, data: JSON.parse(fs.readFileSync(f, 'utf8')) })
    } catch {
      /* ignore */
    }
  }
}
fs.writeFileSync(path.join(dest, 'INDEX.json'), `${JSON.stringify({ copied, honestyFiles: honesty.map((h) => h.file) }, null, 2)}\n`)
fs.writeFileSync(
  path.resolve(dest, '../capture-honesty-raw.json'),
  `${JSON.stringify(honesty, null, 2)}\n`,
)
console.log(JSON.stringify({ copied, dest, honestyFiles: honesty.length }, null, 2))
