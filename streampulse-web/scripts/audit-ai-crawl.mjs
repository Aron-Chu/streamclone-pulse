#!/usr/bin/env node

const origin = new URL(process.argv[2] ?? 'https://streampulse.stream')
const requireEdgeBlock = process.argv.includes('--require-edge-block')
const agents = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'ChatGPT-User', 'CCBot']

async function request(path, userAgent, headers = {}) {
  return fetch(new URL(path, origin), {
    headers: {
      accept: 'text/html',
      'user-agent': userAgent,
      ...headers,
    },
    redirect: 'manual',
  })
}

const robotsResponse = await request('/robots.txt', 'StreamPulse-AI-Crawl-Audit/1.0', {
  accept: 'text/plain',
})
const robots = await robotsResponse.text()
const expectedSignal = 'Content-signal: search=yes, ai-input=no, ai-train=no, use=reference'
const signalHeader = (await request('/', 'StreamPulse-AI-Crawl-Audit/1.0')).headers.get('content-signal')

const policyResults = agents.map(agent => ({
  agent,
  disallowed: new RegExp(`User-agent: ${agent}\\s+Disallow: /`, 'i').test(robots),
}))

console.log(`Origin: ${origin.origin}`)
console.log(`robots.txt: ${robotsResponse.status}`)
console.log(`robots content signal: ${robots.includes(expectedSignal) ? 'present' : 'missing'}`)
console.log(`response Content-Signal: ${signalHeader ?? 'missing'}`)
console.table(policyResults)

const edgeResults = []
for (const agent of agents) {
  const response = await request('/', agent)
  edgeResults.push({
    agent,
    status: response.status,
    blocked: response.status === 401 || response.status === 403 || response.status === 429,
  })
  await response.body?.cancel()
}

console.log('Edge behavior (user-agent spoofing is only an indicator, not proof of bot identity):')
console.table(edgeResults)

const policyReady = robots.includes(expectedSignal) &&
  signalHeader === 'search=yes, ai-input=no, ai-train=no, use=reference' &&
  policyResults.every(result => result.disallowed)
const edgeReady = edgeResults.every(result => result.blocked)

if (!policyReady || (requireEdgeBlock && !edgeReady)) {
  process.exitCode = 1
}
