/** Build a nonempty synthetic pilot through the actual build in an isolated repository copy. */
import { cpSync, mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fixture } from './fixtures/recap-pilot.mjs'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(webRoot, '..')
const cache = join(tmpdir(), 'streampulse-recap-proof')
mkdirSync(cache, { recursive: true })
const proof = mkdtempSync(join(cache, 'recap-full-build-proof-'))
const workspace = join(proof, 'workspace')
cpSync(repoRoot, workspace, { recursive: true, filter: (path) => {
  const segments = relative(repoRoot, path).split(sep)
  return !segments.some(segment => ['.git', 'node_modules', '.wrangler', '.vite', 'test-results', 'playwright-report'].includes(segment)) &&
    !(segments.length === 1 && segments[0] === 'dist') && !(segments[0] === 'streampulse-web' && segments[1] === 'dist')
} })
const localWeb = join(workspace, 'streampulse-web')
symlinkSync(join(repoRoot, 'node_modules'), join(workspace, 'node_modules'), 'junction')
symlinkSync(join(webRoot, 'node_modules'), join(localWeb, 'node_modules'), 'junction')
const now = new Date()
const reviewedAt = new Date(now.getTime() - 60000).toISOString()
const expiresAt = new Date(now.getTime() + 86400000).toISOString()
const stream = fixture()
stream.review = { ...stream.review, reviewedAt, expiresAt }
stream.replay = { ...stream.replay, checkedAt: reviewedAt, expiresAt }
const channel = { ...structuredClone(stream), kind: 'channel', streamId: undefined,
  title: 'Fixture Channel measured reactions — StreamPulse',
  description: 'Synthetic channel coverage and measured reactions for the local build proof.',
  summary: 'Synthetic channel fixture: measured LUL use and three chat reactions describe this recorded broadcast, with explicit partial coverage.',
  review: { ...stream.review, sourceUrl: 'https://api.streampulse.stream/v1/portal/analytics/channels/fixturechan/live' },
}
writeFileSync(join(localWeb, 'content', 'recap-pilot.json'), `${JSON.stringify({ schemaVersion: 1, pages: [stream, channel] }, null, 2)}\n`)
writeFileSync(join(proof, 'SYNTHETIC-TEST-ARTIFACT.txt'), 'Synthetic local build and browser proof only. Never upload this workspace or dist.\n')
const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:ci'], {
  cwd: localWeb, shell: process.platform === 'win32', encoding: 'utf8',
  env: { ...process.env, SENTRY_AUTH_TOKEN: '', SENTRY_UPLOAD: 'false' },
})
writeFileSync(join(proof, 'build.log'), `${build.stdout ?? ''}\n${build.stderr ?? ''}`)
if (build.status !== 0) { console.error(build.stdout, build.stderr); throw new Error(`Isolated recap build failed: ${build.status}`) }
console.log(join(localWeb, 'dist'))
console.log(`Build log: ${join(proof, 'build.log')}`)
console.log('Synthetic build only. Production source manifest and generated maps were not changed.')
