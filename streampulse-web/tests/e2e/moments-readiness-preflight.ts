import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'

export type Reconciliation = {
  dataClass: 'approved_real_stored_irc'
  approvalReference: string
  databaseSnapshotReference: string
  rankingVersion: string
  explorePath: string
  rankedIDs: string[]
}

export type FrozenExploreScope = {
  from: string
  to: string
  login: string
  category: string
  categoryMissing: boolean
}

const backendOrigins = new Set(['http://127.0.0.1:8081', 'http://localhost:8081'])

export function isLocalReadinessBackendOrigin(origin: string): boolean {
  return backendOrigins.has(origin)
}

/** The no-mock run may read data only from its local StreamPulse BFF. */
export function isAllowedReadinessDataRequest(url: URL, method: string, resourceType: string): boolean {
  const dataRequest = url.pathname.startsWith('/v1/') || resourceType === 'fetch' || resourceType === 'xhr'
  return !dataRequest || (method === 'GET' && isLocalReadinessBackendOrigin(url.origin))
}

const utcDay = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString().slice(0, 10) === value)

/** Freeze the approved request to completed UTC dates, independent of today's availability. */
export function frozenExploreScope(explorePath: string, now = new Date()): FrozenExploreScope {
  const url = new URL(explorePath, 'http://localhost')
  const query = url.searchParams
  const keys = [...query.keys()]
  const allowed = new Set(['view', 'period', 'from', 'to', 'sort', 'creator', 'category', 'categoryMissing'])
  const from = query.get('from'), through = query.get('to')
  const login = query.get('creator') || ''
  const category = query.get('category') || ''
  const categoryMissing = query.get('categoryMissing') === 'true'
  if (url.origin !== 'http://localhost' || url.pathname !== '/analytics/moments' || url.hash
    || keys.some(key => !allowed.has(key)) || new Set(keys).size !== keys.length
    || query.get('view') !== 'explore' || query.get('period') !== 'custom' || query.get('sort') !== 'volume'
    || !utcDay(from) || !utcDay(through) || from > through
    || through >= now.toISOString().slice(0, 10)
    || (Date.parse(through) - Date.parse(from)) / 86_400_000 >= 30
    || (login && !/^[a-z0-9_]{1,25}$/.test(login))
    || (category && (new TextEncoder().encode(category).length > 150 || /[\u0000-\u001f]/.test(category)))
    || (categoryMissing && category)
    || (query.has('categoryMissing') && !categoryMissing)) {
    throw new Error('BLOCKED: reconciliation manifest requires a fixed 1–30 day volume Explore path')
  }
  return { from, to: new Date(Date.parse(through) + 86_400_000).toISOString().slice(0, 10),
    login, category, categoryMissing }
}

export function loadReconciliation(): Reconciliation {
  const path = process.env.MOMENTS_READINESS_MANIFEST
  const digest = process.env.MOMENTS_READINESS_MANIFEST_SHA256
  if (!path || !digest) throw new Error('BLOCKED: approved real-data database reconciliation manifest and SHA-256 required')
  if (!/^[a-f0-9]{64}$/i.test(digest)) throw new Error('BLOCKED: MOMENTS_READINESS_MANIFEST_SHA256 must be a SHA-256 hex digest')

  let bytes: Buffer
  try {
    if (statSync(path).size >= 1_000_000) throw new Error('reconciliation manifest exceeds the 1 MB limit')
    bytes = readFileSync(path)
  } catch (error) {
    throw new Error(`BLOCKED: cannot read reconciliation manifest: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (createHash('sha256').update(bytes).digest('hex') !== digest.toLowerCase()) {
    throw new Error('BLOCKED: reconciliation manifest does not match its independently recorded SHA-256')
  }
  let input: Reconciliation
  try {
    input = JSON.parse(bytes.toString('utf8')) as Reconciliation
  } catch {
    throw new Error('BLOCKED: reconciliation manifest is not valid JSON')
  }
  if (input?.dataClass !== 'approved_real_stored_irc'
    || typeof input.approvalReference !== 'string' || !input.approvalReference.trim()
    || typeof input.databaseSnapshotReference !== 'string' || !input.databaseSnapshotReference.trim()
    || typeof input.rankingVersion !== 'string' || !input.rankingVersion.trim()
    || typeof input.explorePath !== 'string' || !input.explorePath.startsWith('/') || input.explorePath.startsWith('//')
    || !Array.isArray(input.rankedIDs)
    || input.rankedIDs.length <= 100
    || input.rankedIDs.some(id => typeof id !== 'string' || !id.trim())
    || new Set(input.rankedIDs).size !== input.rankedIDs.length) {
    throw new Error('BLOCKED: reconciliation manifest has missing or invalid real-data evidence fields')
  }
  frozenExploreScope(input.explorePath)
  return input
}

async function checkURL(label: string, url: string, contentType: 'json' | 'html' | 'ready'): Promise<Record<string, unknown> | undefined> {
  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(3_000) })
  } catch (error) {
    throw new Error(`BLOCKED: ${label} is unavailable at ${url}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok || (contentType === 'ready' && response.status !== 200)) {
    throw new Error(`BLOCKED: ${label} returned HTTP ${response.status} at ${url}`)
  }
  if (contentType === 'json') {
    try {
      const body: unknown = await response.json()
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('expected a JSON object')
      return body as Record<string, unknown>
    } catch {
      throw new Error(`BLOCKED: ${label} did not return a JSON health object at ${url}`)
    }
  } else if (contentType === 'html' && !(response.headers.get('content-type') || '').includes('text/html')) {
    throw new Error(`BLOCKED: ${label} did not return HTML at ${url}`)
  }
}

export async function checkLocalReadinessBFF(origin: string): Promise<void> {
  if (!isLocalReadinessBackendOrigin(origin)) throw new Error(`BLOCKED: backend origin must be local :8081, got ${origin}`)
  const extension = await checkURL('local StreamPulse BFF extension health', `${origin}/v1/extension/health`, 'json')
  const routes = extension?.routes
  if (extension?.ok !== true
    || typeof extension.version !== 'string' || !extension.version.trim()
    || typeof extension.time !== 'number' || !Number.isFinite(extension.time) || extension.time <= 0
    || !routes || typeof routes !== 'object' || Array.isArray(routes)
    || (routes as Record<string, unknown>).pulseChannel !== true
    || (routes as Record<string, unknown>).pulseCoverage !== true) {
    throw new Error('BLOCKED: local :8081 did not return the StreamPulse extension health contract')
  }
  // Extension health can be 200 even with no connected Store. The candidate
  // analytics server's /readyz includes Store.Ping in cmd/analytics/main.go.
  await checkURL('local StreamPulse BFF database readiness', `${origin}/readyz`, 'ready')
}

export async function preflightMomentsReadiness(portalURL: string): Promise<void> {
  const expected = loadReconciliation()
  const portal = new URL(expected.explorePath, portalURL)
  const failures: string[] = []
  let bffReady = false
  for (const origin of backendOrigins) {
    try {
      await checkLocalReadinessBFF(origin)
      bffReady = true
      break
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (!bffReady) throw new Error(failures.join('\n'))
  await checkURL('local portal', portal.href, 'html')
  // References and HTTP health do not certify the corpus. The browser check
  // must still reconcile ranked IDs and reject every nonlocal API request.
}
