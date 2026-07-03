#!/usr/bin/env node
/**
 * Analytics deep-link helpers must stay stable for hub → console navigation.
 * Logic mirrored from src/lib/analyticsLinks.ts (no TS import — Node CI safe).
 */
function buildAnalyticsHref({ login, streamId }) {
  const safeLogin = encodeURIComponent(login.trim().toLowerCase())
  if (!streamId) return `/analytics/${safeLogin}`
  return `/analytics/${safeLogin}/s/${encodeURIComponent(streamId)}`
}

function analyticsActionLabel(context) {
  if (context === 'recent-session') return 'Open session'
  return 'Open analytics'
}

const cases = [
  { login: 'xqc', streamId: undefined, want: '/analytics/xqc' },
  { login: 'XQC', streamId: '12345', want: '/analytics/xqc/s/12345' },
]

for (const { login, streamId, want } of cases) {
  const got = buildAnalyticsHref({ login, streamId })
  if (got !== want) {
    console.error(`buildAnalyticsHref mismatch: got ${got}, want ${want}`)
    process.exit(1)
  }
}

if (analyticsActionLabel('recent-session') !== 'Open session') {
  console.error('analyticsActionLabel(recent-session) regression')
  process.exit(1)
}

console.log('check:analytics-links OK')
