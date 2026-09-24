import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, relative, isAbsolute } from 'node:path'

const root = realpathSync(process.argv[2])
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim()
const trackedStatus = git('status', '--porcelain', '--untracked-files=no')
const permittedDelta = ['streampulse-web/tests/e2e/discovery-ranked.spec.ts', 'streampulse-web/src/ui/components/moments/moments-workspace.css']
const changed = git('diff', 'HEAD', '--name-only').split('\n').filter(Boolean)
if (changed.some(path => !permittedDelta.includes(path))) throw new Error('Candidate has an unreviewed working delta')
const files = git('ls-files').split('\n').filter(Boolean)
const inputs = Object.fromEntries(files.map(path => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')]))
const localPackages = ['pulse-core', 'pulse-charts', 'analytics-console'].map(name => {
  const target = realpathSync(resolve(root, 'streampulse-web/node_modules/@streampulse', name))
  const path = relative(root, target)
  if (path.startsWith('..') || isAbsolute(path)) throw new Error(`External package dependency: ${name}`)
  return { name, target: path.replaceAll('\\', '/') }
})
console.log(JSON.stringify({
  revision: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'),
  workingDelta: trackedStatus, immutableWorkingDelta: false,
  featureBase: git('rev-parse', 'c883efb'), featurePaths: git('diff', '--name-only', 'c883efb', 'HEAD').split('\n'),
  closure: 'Conservative complete tracked tree; includes unchanged shared-package and extension-UI build inputs',
  localPackages, trackedFiles: files.length, inputs,
  node: process.version,
  rebuild: ['npm ci --no-audit --no-fund', 'npm ci --prefix streampulse-web --no-audit --no-fund', 'npm run build:packages', 'npm run typecheck --prefix streampulse-web', 'npm run build:ci --prefix streampulse-web'],
  publication: 'not_authorized',
}, null, 2))
