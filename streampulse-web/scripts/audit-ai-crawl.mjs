#!/usr/bin/env node
import { pathToFileURL } from 'node:url'

export const trainingAgents = ['Amazonbot', 'Applebot-Extended', 'Bytespider', 'CCBot', 'ClaudeBot', 'GPTBot', 'meta-externalagent']
export const retrievalAgents = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Perplexity-User', 'Claude-SearchBot', 'Claude-User']
export const signal = 'search=yes, ai-input=yes'
const privatePrefixes = ['/account', '/dashboard', '/supporter/thanks']

// This checks our explicit policy groups, not arbitrary robots matching semantics.
export function policyResults(robots, responseSignal) {
  const groups = new Map()
  let names = []
  let rulesStarted = false
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim()
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (key === 'user-agent') {
      if (rulesStarted) { names = []; rulesStarted = false }
      names.push(value.toLowerCase())
      for (const name of names) if (!groups.has(name)) groups.set(name, [])
    } else if (key === 'allow' || key === 'disallow' || key === 'content-signal') {
      rulesStarted = true
      for (const name of names) groups.get(name).push([key, value])
    }
  }
  const has = (agent, key, path) => groups.get(agent.toLowerCase())?.some(([k, p]) => k === key && p === path) ?? false
  const only = (agent, allowed) => (groups.get(agent.toLowerCase()) ?? []).every(([key, value]) => allowed.some(([k, v]) => key === k && value === v))
  const training = trainingAgents.map(agent => ({ agent, ready: has(agent, 'disallow', '/') && only(agent, [['disallow', '/']]) }))
  const retrieval = [...retrievalAgents, 'Google-Extended', '*'].map(agent => ({ agent, ready: has(agent, 'allow', '/') && privatePrefixes.every(path => has(agent, 'disallow', path)) && only(agent, [['allow', '/'], ...privatePrefixes.map(path => ['disallow', path]), ...(agent === '*' ? [['content-signal', `${signal}, ai-train=no`]] : agent === 'Google-Extended' ? [['content-signal', `${signal}, ai-train=yes`]] : [])]) }))
  const signalsReady = has('*', 'content-signal', `${signal}, ai-train=no`) && has('Google-Extended', 'content-signal', `${signal}, ai-train=yes`)
  return { training, retrieval, ready: signalsReady && responseSignal === signal && training.every(r => r.ready) && retrieval.every(r => r.ready) }
}

async function run() {
  const origin = new URL(process.argv[2] ?? 'https://streampulse.stream')
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Expected an HTTP(S) origin without credentials')
  const request = (path, userAgent) => fetch(new URL(path, origin), { headers: { 'user-agent': userAgent }, redirect: 'manual' })
  const robotsResponse = await request('/robots.txt', 'StreamPulse-AI-Crawl-Audit/2.0')
  const robots = await robotsResponse.text()
  const response = await request('/', 'StreamPulse-AI-Crawl-Audit/2.0')
  const responseSignal = response.headers.get('content-signal')
  await response.body?.cancel()
  const policy = policyResults(robots, responseSignal)
  console.log(`Origin: ${origin.origin}; robots: ${robotsResponse.status}; Content-Signal: ${responseSignal ?? 'missing'}`)
  console.table([...policy.training.map(r => ({ ...r, purpose: 'restricted training' })), ...policy.retrieval.map(r => ({ ...r, purpose: r.agent === 'Google-Extended' ? 'Gemini grounding AND training; robots product token only' : 'public retrieval; private routes excluded' }))])
  const indicators = []
  for (const agent of [...trainingAgents, ...retrievalAgents]) {
    const result = await request('/', agent)
    indicators.push({ agent, purpose: trainingAgents.includes(agent) ? 'restricted' : 'retrieval', status: result.status, blocked: [401, 403, 429].includes(result.status) })
    await result.body?.cancel()
  }
  console.log('Spoofed user agents are diagnostic indicators only. Verify actual crawler identity and edge actions through the approved ops path.')
  console.table(indicators)
  const trainingBlocked = indicators.filter(r => r.purpose === 'restricted').every(r => r.blocked)
  if (robotsResponse.status !== 200 || !policy.ready || (process.argv.includes('--require-edge-block') && !trainingBlocked)) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
