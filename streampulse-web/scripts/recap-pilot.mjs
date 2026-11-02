/** Build-only, reviewed aggregate snapshots. No network, chat text or scoring engine. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const SITE_ORIGIN = 'https://streampulse.stream'
export const FALLBACK_PATH = '/analytics-fallback'
const LOGIN = /^[a-z0-9_]{1,25}$/
const ID = /^\d{1,30}$/
const RESERVED = new Set(['hub', 'emotes', 'streams', 'explore', 'moments', 'newsroom', 'settings'])
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const PAGE_KEYS = ['kind', 'login', 'streamId', 'displayName', 'game', 'title', 'description', 'summary', 'startedAt', 'durationSeconds', 'nonMissingRollupMinutes', 'coverage', 'moments', 'topEmotes', 'review', 'replay', 'peakChatThreshold']

function fail(message) { throw new Error(`Recap pilot: ${message}`) }
function record(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${label}: unsupported field ${key}`)
}
function text(value, label, maximum = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(`${label} must be nonempty bounded text`)
  return value.trim()
}
function number(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isFinite(value) || value < 0 || value > maximum) fail(`${label} must be finite and nonnegative`)
}
function date(value, label) {
  if (typeof value !== 'string' || !ISO.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) fail(`${label} must be a UTC timestamp`)
}

/** The canonical draft gate uses OR alternatives, not a new coverage percentage. */
export function validatePilot(input, { now = new Date() } = {}) {
  record(input, 'manifest', ['schemaVersion', 'pages'])
  if (input.schemaVersion !== 1 || !Array.isArray(input.pages) || input.pages.length > 20) fail('expected schemaVersion 1 and at most 20 pilot pages')
  const paths = new Set()
  const summaries = new Set()
  const titles = new Set()
  const descriptions = new Set()
  const pages = input.pages.map((page, index) => {
    const label = `pages[${index}]`
    record(page, label, PAGE_KEYS)
    if (!['channel', 'stream'].includes(page.kind) || (typeof page.login !== 'string' || !LOGIN.test(page.login)) || RESERVED.has(page.login)) fail(`${label}: invalid kind or login`)
    if (page.kind === 'stream' ? (typeof page.streamId !== 'string' || !ID.test(page.streamId)) : page.streamId !== undefined) fail(`${label}: invalid stream identity`)
    for (const key of ['displayName', 'title', 'description', 'summary']) text(page[key], `${label}.${key}`, key === 'summary' ? 4000 : 320)
    if (page.game !== undefined) text(page.game, `${label}.game`, 200)
    date(page.startedAt, `${label}.startedAt`)
    number(page.durationSeconds, `${label}.durationSeconds`)
    number(page.nonMissingRollupMinutes, `${label}.nonMissingRollupMinutes`)
    if (page.nonMissingRollupMinutes > Math.ceil(page.durationSeconds / 60)) fail(`${label}: measured minutes exceed stream duration`)
    if (page.durationSeconds < 3600 && page.nonMissingRollupMinutes < 30) fail(`${label}: insufficient measured duration`)
    record(page.coverage, `${label}.coverage`, ['state', 'description'])
    if (!['complete', 'partial'].includes(page.coverage.state)) fail(`${label}: unknown coverage cannot qualify`)
    text(page.coverage.description, `${label}.coverage.description`)
    if (!Array.isArray(page.moments) || !page.moments.length || page.moments.length > 20) fail(`${label}: requires 1-20 measured moments`)
    const offsets = new Set()
    for (const moment of page.moments) {
      record(moment, `${label}.moment`, ['offsetSeconds', 'score', 'chatCount', 'emoteCount'])
      number(moment.offsetSeconds, `${label}.moment.offsetSeconds`, page.durationSeconds)
      number(moment.score, `${label}.moment.score`, 100)
      if (offsets.has(moment.offsetSeconds)) fail(`${label}: duplicate moment offset`)
      offsets.add(moment.offsetSeconds)
      for (const key of ['chatCount', 'emoteCount']) if (moment[key] !== undefined) number(moment[key], `${label}.moment.${key}`)
    }
    let documentedPeak = false
    if (page.peakChatThreshold !== undefined) {
      record(page.peakChatThreshold, `${label}.peakChatThreshold`, ['minimum', 'observed', 'rationale'])
      number(page.peakChatThreshold.minimum, 'peak minimum')
      number(page.peakChatThreshold.observed, 'peak observed')
      text(page.peakChatThreshold.rationale, 'documented peak threshold rationale')
      documentedPeak = page.peakChatThreshold.minimum > 0 && page.peakChatThreshold.observed >= page.peakChatThreshold.minimum
    }
    if (page.moments.filter(moment => moment.score >= 70).length < 3 && !documentedPeak) fail(`${label}: needs three score-70 moments or a documented peak threshold`)
    if (!Array.isArray(page.topEmotes) || !page.topEmotes.length || page.topEmotes.length > 10) fail(`${label}: requires measured top emotes`)
    for (const emote of page.topEmotes) {
      record(emote, `${label}.emote`, ['code', 'count'])
      text(emote.code, 'emote code', 100)
      number(emote.count, 'emote count')
    }
    record(page.review, `${label}.review`, ['approved', 'reviewedAt', 'expiresAt', 'sourceUrl', 'notes'])
    if (page.review.approved !== true) fail(`${label}: manual review is required`)
    date(page.review.reviewedAt, 'reviewedAt')
    date(page.review.expiresAt, 'review expiresAt')
    if (Date.parse(page.review.reviewedAt) > now.getTime() || Date.parse(page.review.expiresAt) <= now.getTime() || Date.parse(page.review.expiresAt) <= Date.parse(page.review.reviewedAt)) fail(`${label}: review is future-dated or expired`)
    text(page.review.notes, 'review notes')
    const source = new URL(page.review.sourceUrl)
    const sourcePath = page.kind === 'stream' ? `/v1/portal/analytics/streams/${page.streamId}/recap` : `/v1/portal/analytics/channels/${page.login}/live`
    if (source.origin !== 'https://api.streampulse.stream' || source.pathname !== sourcePath || source.username || source.password || source.search || source.hash) fail(`${label}: source must match this sanitized portal analytics identity`)
    if (page.replay !== undefined) {
      record(page.replay, `${label}.replay`, ['state', 'vodId', 'alignmentOffsetSeconds', 'durationSeconds', 'checkedAt', 'expiresAt'])
      if (!['available', 'unavailable'].includes(page.replay.state)) fail(`${label}: invalid replay state`)
      if (page.replay.state === 'available') {
        if (typeof page.replay.vodId !== 'string' || !ID.test(page.replay.vodId) || !Number.isFinite(page.replay.alignmentOffsetSeconds)) fail(`${label}: replay needs exact VOD identity and alignment`)
        number(page.replay.durationSeconds, 'VOD duration')
        date(page.replay.checkedAt, 'replay checkedAt')
        date(page.replay.expiresAt, 'replay expiresAt')
        if (Date.parse(page.replay.checkedAt) > now.getTime() || Date.parse(page.replay.expiresAt) <= Date.parse(page.replay.checkedAt)) fail(`${label}: invalid replay verification window`)
      } else if (Object.keys(page.replay).some(key => key !== 'state')) fail(`${label}: unavailable replay must not carry a VOD capability`)
    }
    const path = `/analytics/${page.login}${page.kind === 'stream' ? `/${page.streamId}` : ''}`
    if (paths.has(path) || summaries.has(page.summary.trim()) || titles.has(page.title.trim()) || descriptions.has(page.description.trim())) fail(`${label}: duplicate path or explanatory summary`)
    paths.add(path); summaries.add(page.summary.trim()); titles.add(page.title.trim()); descriptions.add(page.description.trim())
    const replay = page.replay?.state === 'available' && Date.parse(page.replay.expiresAt) > now.getTime() ? page.replay : null
    return { ...page, path, replay }
  })
  return pages.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

export function readPilot(path, options) { return validatePilot(JSON.parse(readFileSync(path, 'utf8')), options) }
export function metadataForPage(page) {
  return { title: page.title, description: page.description, canonicalPath: page.path, robots: 'index,follow' }
}
export function writeRuntimeManifests(root, pages) {
  const dir = join(root, 'src', 'generated')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'recap-page-paths.json'), `${JSON.stringify(pages.map(page => ({ path: page.path, category: page.kind === 'channel' ? 'channel_summary' : 'stream_recap' })), null, 2)}\n`)
  writeFileSync(join(dir, 'recap-page-metadata.json'), `${JSON.stringify(Object.fromEntries(pages.map(page => [page.path, metadataForPage(page)])), null, 2)}\n`)
}

export function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}
function timestamp(seconds) {
  const total = Math.floor(seconds)
  return `${Math.floor(total / 3600)}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
export function replayUrl(page, moment) {
  const offset = page.replay && moment.offsetSeconds + page.replay.alignmentOffsetSeconds
  if (!page.replay || offset < 0 || offset >= page.replay.durationSeconds) return null
  return `https://www.twitch.tv/videos/${page.replay.vodId}?t=${Math.floor(offset)}s`
}

export function renderRecapSummary(page) {
  const moments = [...page.moments].sort((a, b) => b.score - a.score).map(moment => {
    const label = timestamp(moment.offsetSeconds)
    const url = replayUrl(page, moment)
    return `<li id="moment-${moment.offsetSeconds}">${url ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${label}: watch the reaction</a>` : `${label}: reaction recorded`} — score ${moment.score}${moment.chatCount === undefined ? '' : `; ${moment.chatCount} chat messages in this minute`}${moment.emoteCount === undefined ? '' : `; ${moment.emoteCount} emote uses`}</li>`
  }).join('')
  return `<article class="public-document panel" data-recap-summary><a href="/">StreamPulse</a><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.summary)}</p><p>Stream started ${escapeHtml(page.startedAt)}. Recorded duration: ${timestamp(page.durationSeconds)}.</p><p>Game/category: ${page.game === undefined ? 'not available in this reviewed snapshot' : escapeHtml(page.game)}.</p><h2>Coverage</h2><p>${escapeHtml(page.coverage.state)}: ${escapeHtml(page.coverage.description)}</p><p>Reviewed ${escapeHtml(page.review.reviewedAt)}. This is a reviewed snapshot; the interactive page shows current availability.</p><h2>Top chat reactions</h2><ol>${moments}</ol>${page.replay ? `<p>Replay availability was checked ${escapeHtml(page.replay.checkedAt)}. Twitch may remove or restrict it.</p>` : '<p>Archive summary: no verified replay is currently available. Reaction measurements remain below; replay links are disabled.</p>'}<h2>Most-used emotes in the measured data</h2><ul>${page.topEmotes.map(emote => `<li>${escapeHtml(emote.code)}: ${emote.count} uses</li>`).join('')}</ul><p><a href="/docs#extension">Get StreamPulse for tracked Twitch streams</a> · <a href="/analytics">Explore tracked channels</a></p></article>`
}

export function recapStructuredData(page) {
  return JSON.stringify({
    '@context': 'https://schema.org', '@type': 'WebPage',
    name: page.title, description: page.description, url: `${SITE_ORIGIN}${page.path}`,
    dateModified: page.review.reviewedAt,
    mainEntity: { '@type': 'ItemList', name: 'Measured chat reactions',
      itemListElement: [...page.moments].sort((a, b) => b.score - a.score).map((moment, index) => ({
        '@type': 'ListItem', position: index + 1, name: `Reaction at ${timestamp(moment.offsetSeconds)}; score ${moment.score}`,
        url: replayUrl(page, moment) ?? `${SITE_ORIGIN}${page.path}#moment-${moment.offsetSeconds}`,
      })),
    },
  }).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
}

/** Reuse the real built analytics document (assets/CSP), replacing only its public snapshot. */
export function renderRecapDocument(shell, page) {
  let html = shell.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(page.title)}</title>`)
  const canonical = `${SITE_ORIGIN}${page.path}`
  const meta = (attribute, key, value) => {
    const tag = `<meta ${attribute}="${key}" content="${escapeHtml(value)}" />`
    const pattern = new RegExp(`<meta\\s+${attribute}="${key}"[^>]*>`, 'i')
    html = pattern.test(html) ? html.replace(pattern, () => tag) : html.replace('</head>', () => `${tag}</head>`)
  }
  for (const [attribute, key, value] of [
    ['name', 'description', page.description], ['name', 'robots', 'index,follow'],
    ['property', 'og:title', page.title], ['property', 'og:description', page.description], ['property', 'og:url', canonical],
    ['name', 'twitter:title', page.title], ['name', 'twitter:description', page.description],
  ]) meta(attribute, key, value)
  const canonicalTag = `<link rel="canonical" href="${canonical}" />`
  html = html.replace(/<link\s+rel="canonical"[^>]*>/i, () => canonicalTag)
  const boundary = /<!--public-root:start-->[\s\S]*?<!--public-root:end-->/
  if (!boundary.test(html)) fail('missing public root markers in the built document')
  const summary = renderRecapSummary(page)
  html = html.replace(boundary, () => `<!--public-root:start--><div id="root" data-prerendered>${summary}</div><!--public-root:end--><template id="reviewed-recap-summary" data-canonical-path="${page.path}">${summary}</template>`)
  return html.replace('</head>', () => `<script type="application/ld+json">${recapStructuredData(page)}</script></head>`)
}

/** Explicit static rules precede all dynamic matches: Pages redirects beat assets. */
export function recapRedirects(source, pages) {
  const marker = '# Reviewed recap pilot routes are inserted here at build time.'
  if (!source.includes(marker)) fail('missing reviewed route insertion marker')
  const rules = pages.flatMap(page => {
    const target = `/_recap-pages/${page.login}${page.kind === 'stream' ? `/${page.streamId}` : ''}/`
    const legacy = `/s/${page.login}${page.kind === 'stream' ? `/${page.streamId}` : ''}`
    const aliases = [page.path, `${page.path}/`, legacy, `${legacy}/`]
    if (page.kind === 'stream') aliases.push(`/analytics/${page.login}/s/${page.streamId}`, `/analytics/${page.login}/s/${page.streamId}/`)
    return aliases.map(path => `${path} ${target} 200`)
  })
  return source.replace(marker, `${marker}\n${rules.join('\n')}`)
}

export function sitemapWithRecaps(source, pages) {
  return source.replace('</urlset>', `${pages.map(page => `  <url><loc>${SITE_ORIGIN}${page.path}</loc><lastmod>${page.review.reviewedAt}</lastmod></url>`).join('\n')}\n</urlset>`)
}
