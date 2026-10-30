#!/usr/bin/env node
// Read-only preview smoke. The deployment evidence must come from an
// authenticated Pages control-plane lookup; this script cannot authenticate
// the provenance of JSON supplied on stdin.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Agent, request } from 'node:https'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'

const TARGET_PROJECT = 'streampulse-main'
const MAX_EVIDENCE_BYTES = 65536
const PREVIEW_ROUTES = ['/', '/analytics', '/account/settings']
const RELAY_PATH = '/v1/account/me'

function fail(code) {
  throw new Error(code)
}

function originOnly(value) {
  let url
  try { url = new URL(value) } catch { fail('invalid-deployment-url') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    fail('invalid-deployment-url')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname) || !hostname.includes('.')) fail('invalid-deployment-url')
  return url.origin
}

// An explicitly constructed HTTPS agent does not use the global agent's
// optional environment-proxy configuration. It does not follow redirects.
export function directFetch(url, { signal }, requestImpl = request) {
  return new Promise((resolveResponse, reject) => {
    const agent = new Agent({ keepAlive: false })
    const outgoing = requestImpl(url, { method: 'GET', agent, signal }, (incoming) => {
      try {
        const headers = new Headers()
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1])
        const status = incoming.statusCode ?? 0
        const body = [204, 205, 304].includes(status) ? null : Readable.toWeb(incoming)
        if (!body) incoming.resume()
        resolveResponse(new Response(body, { status, headers }))
      } catch (error) {
        incoming.destroy()
        reject(error)
      }
    })
    outgoing.on('error', reject)
    outgoing.end()
  })
}

/** The caller is responsible for obtaining evidence via an authenticated lookup. */
export function destinationOrigin(evidence, expected) {
  if (!evidence || !expected || typeof evidence !== 'object' || typeof expected !== 'object') fail('invalid-evidence')
  if (!/^[a-f0-9]{32}$/i.test(expected.accountId ?? '') || evidence.accountId !== expected.accountId) fail('account-mismatch')
  if (evidence.projectName !== TARGET_PROJECT || expected.projectName !== TARGET_PROJECT) fail('project-mismatch')
  if (evidence.project?.name !== TARGET_PROJECT || typeof evidence.project.subdomain !== 'string' || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.pages\.dev$/.test(evidence.project.subdomain) || evidence.project.subdomain !== expected.projectSubdomain) fail('project-mismatch')
  if (typeof evidence.project.id !== 'string' || evidence.project.id.length === 0 || evidence.deployment?.project_id !== evidence.project.id) fail('project-mismatch')
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(expected.deploymentId ?? '') || evidence.deployment?.id !== expected.deploymentId) fail('deployment-mismatch')
  if (evidence.deployment.project_name !== TARGET_PROJECT || !/^[a-z0-9]{8}$/.test(evidence.deployment.short_id ?? '')) fail('deployment-mismatch')
  if (evidence.deployment.environment !== 'production' || evidence.deployment.latest_stage?.name !== 'deploy' || evidence.deployment.latest_stage?.status !== 'success') fail('deployment-not-ready')
  const origin = originOnly(evidence.deployment.url)
  if (new URL(origin).hostname !== `${evidence.deployment.short_id}.${evidence.project.subdomain}`) fail('deployment-url-mismatch')
  if (origin !== originOnly(expected.deploymentUrl)) fail('deployment-url-mismatch')
  if (origin === originOnly(expected.canonicalOrigin)) fail('canonical-origin-is-not-preview')
  return origin
}

function noRedirect(response) {
  if (response.redirected || (response.status >= 300 && response.status < 400) || response.headers.has('location')) fail('unexpected-redirect')
}

/** Checks a preview deployment only; this cannot prove a working signed relay. */
export async function verifyDestinationPreview({ evidence, expected, fetchImpl = directFetch }) {
  const origin = destinationOrigin(evidence, expected)
  for (const path of PREVIEW_ROUTES) {
    let response
    try { response = await fetchImpl(new URL(path, origin), { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000) }) }
    catch { fail('preview-request-failed') }
    noRedirect(response)
    if (response.status !== 200 || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '')) fail('preview-document-invalid')
    let body
    try {
      const reader = response.body?.getReader()
      if (!reader) fail('preview-document-invalid')
      const chunks = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > 1048576) { await reader.cancel(); fail('preview-document-invalid') }
        chunks.push(value)
      }
      body = Buffer.concat(chunks).toString('utf8')
    } catch { fail('preview-document-invalid') }
    if (!/<html\b/i.test(body) || !/StreamPulse/i.test(body) || !/<div\s+id=["']root["']/i.test(body) || !/<script\b[^>]*\btype=["']module["']/i.test(body)) fail('preview-document-invalid')
  }
  let response
  try { response = await fetchImpl(new URL(RELAY_PATH, origin), { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000) }) }
  catch { fail('preview-relay-request-failed') }
  noRedirect(response)
  const correlation = response.headers.get('x-correlation-id') ?? ''
  if (response.status !== 403 || !/^[a-f0-9]{32}$/.test(correlation) || !/no-store/i.test(response.headers.get('cache-control') ?? '') || response.headers.has('set-cookie')) {
    fail('preview-relay-refusal-invalid')
  }
  await response.body?.cancel().catch(() => {})
  return { previewRoutes: PREVIEW_ROUTES.length, relayRefusedOnPreview: true, signedRelayVerified: false }
}

async function main() {
  if (process.env.PAGES_SMOKE_ALLOW_NETWORK !== 'yes') fail('network-not-enabled')
  let text = ''
  for await (const chunk of process.stdin) {
    text += chunk
    if (Buffer.byteLength(text) > MAX_EVIDENCE_BYTES) fail('evidence-too-large')
  }
  let evidence
  try { evidence = JSON.parse(text) } catch { fail('invalid-evidence') }
  const expected = {
    accountId: process.env.PAGES_SMOKE_EXPECTED_ACCOUNT_ID,
    projectName: TARGET_PROJECT,
    projectSubdomain: process.env.PAGES_SMOKE_EXPECTED_PROJECT_SUBDOMAIN,
    deploymentId: process.env.PAGES_SMOKE_EXPECTED_DEPLOYMENT_ID,
    deploymentUrl: process.env.PAGES_SMOKE_EXPECTED_DEPLOYMENT_URL,
    canonicalOrigin: process.env.PAGES_SMOKE_CANONICAL_ORIGIN,
  }
  const result = await verifyDestinationPreview({ evidence, expected })
  console.log(`preview smoke passed: ${result.previewRoutes} routes; relay refused preview origin; signed relay not verified`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main() } catch (error) {
    const known = new Set(['network-not-enabled', 'evidence-too-large', 'invalid-evidence', 'invalid-deployment-url', 'account-mismatch', 'project-mismatch', 'deployment-mismatch', 'deployment-not-ready', 'deployment-url-mismatch', 'canonical-origin-is-not-preview', 'unexpected-redirect', 'preview-request-failed', 'preview-document-invalid', 'preview-relay-request-failed', 'preview-relay-refusal-invalid'])
    console.error(`destination preview smoke failed: ${known.has(error?.message) ? error.message : 'unexpected-error'}`)
    process.exitCode = 1
  }
}
