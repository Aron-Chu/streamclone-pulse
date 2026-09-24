import { isChannelRouteLogin } from './channelRoute'

export interface PageMetadata {
  title: string
  description: string
  canonicalPath: string
  robots: 'index,follow' | 'noindex,nofollow'
}

const DEFAULT_DESCRIPTION =
  'StreamPulse finds Twitch moments through coverage-honest chat, emote, viewer, and VOD analytics.'

function channelTitle(pathname: string): string | null {
  const match = pathname.match(/^\/analytics\/([^/]+)(?:\/(?:s\/)?[^/]+)?$/)
  if (!match) return null
  try {
    const rawLogin = decodeURIComponent(match[1])
    if (!isChannelRouteLogin(rawLogin)) return null
    const login = rawLogin.replace(/_/g, ' ').trim()
    return login ? `${login} Analytics — StreamPulse` : null
  } catch {
    return null
  }
}

function resolveBasePageMetadata(pathname: string): PageMetadata {
  if (pathname.startsWith('/account/')) return { title: 'Your account — StreamPulse', description: 'Manage your StreamPulse account and connected extension.', canonicalPath: pathname.split(/[?#]/)[0], robots: 'noindex,nofollow' }
  const normalizedPath = pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname

  switch (normalizedPath) {
    case '/':
      return {
        title: 'StreamPulse — Twitch reaction analytics',
        description: DEFAULT_DESCRIPTION,
        canonicalPath: '/',
        robots: 'index,follow',
      }
    case '/analytics':
    case '/analytics/hub':
    case '/analytics/emotes':
    case '/analytics/streams':
    case '/atlas':
      return {
        title: 'StreamPulse Analytics',
        description: 'Explore aggregate live Twitch activity, Pulse moments, emote signals, and tracked channels.',
        canonicalPath: '/analytics',
        robots: 'index,follow',
      }
    case '/docs':
    case '/docs/getting-started':
    case '/docs/coverage':
    case '/docs/api':
      return {
        title: 'Documentation — StreamPulse',
        description: 'Install StreamPulse, understand coverage states, and open public Twitch analytics.',
        canonicalPath: '/docs',
        robots: 'index,follow',
      }
    case '/status':
      return {
        title: 'Service Status — StreamPulse',
        description: 'Current StreamPulse portal, API, coverage, and corpus status.',
        canonicalPath: '/status',
        robots: 'index,follow',
      }
    case '/privacy':
      return {
        title: 'Privacy Policy — StreamPulse',
        description: 'How the StreamPulse Chrome extension and website observe, send, and store data.',
        canonicalPath: '/privacy',
        robots: 'index,follow',
      }
    case '/supporter':
      return { title: 'Pulse Supporter — StreamPulse', description: 'Optional monthly membership, cosmetics, pricing, and membership availability.', canonicalPath: normalizedPath, robots: 'index,follow' }
    case '/terms':
      return { title: 'Supporter Terms — StreamPulse', description: 'StreamPulse Supporter subscription terms and payment conditions.', canonicalPath: normalizedPath, robots: 'index,follow' }
    case '/refunds':
      return { title: 'Cancellation and Refunds — StreamPulse', description: 'Manage cancellation, paid access, and refund requests for Pulse Supporter.', canonicalPath: normalizedPath, robots: 'index,follow' }
    case '/support':
      return {
        title: 'Support — StreamPulse',
        description: 'Troubleshoot the StreamPulse Twitch extension and public analytics portal.',
        canonicalPath: '/support',
        robots: 'index,follow',
      }
    default: {
      if (normalizedPath === '/analytics/moments') {
        return { title: 'Moments — StreamPulse', description: 'Discover measured reactions, review exact sources, and save moments on this device.', canonicalPath: normalizedPath, robots: 'noindex,nofollow' }
      }
      if (normalizedPath === '/analytics/explore' || /^\/analytics\/explore\/[^/]+$/.test(normalizedPath)) {
        return {
          title: 'Pulse Explorer — StreamPulse',
          description: 'Browse verified reaction activity by broadcast and inspect measured moments.',
          canonicalPath: '/analytics/explore',
          robots: 'noindex,nofollow',
        }
      }
      if (normalizedPath === '/analytics/newsroom' || /^\/analytics\/newsroom\/[^/]+$/.test(normalizedPath)) {
        return {
          title: normalizedPath === '/analytics/newsroom' ? 'Moment updates — StreamPulse' : 'Moment update — StreamPulse',
          description: 'Explore grouped Twitch moment updates with source-relative evidence and timestamped stream context.',
          canonicalPath: normalizedPath,
          robots: normalizedPath === '/analytics/newsroom' ? 'index,follow' : 'noindex,nofollow',
        }
      }
      const channel = channelTitle(normalizedPath)
      if (channel) {
        return {
          title: channel,
          description: 'Review aggregate Twitch stream activity, moments, coverage, games, and emote reactions.',
          canonicalPath: normalizedPath.replace(/\/s\//, '/'),
          // Route syntax does not prove this channel/session exists. Indexable
          // dynamic metadata requires server-verified delivery, not a slug guess.
          robots: 'noindex,nofollow',
        }
      }
      return {
        title: 'Page not found — StreamPulse',
        description: DEFAULT_DESCRIPTION,
        canonicalPath: normalizedPath,
        robots: 'noindex,nofollow',
      }
    }
  }
}

export function resolvePageMetadata(pathname: string, search = ''): PageMetadata {
  const metadata = resolveBasePageMetadata(pathname)
  return new URLSearchParams(search).get('figma') === '1'
    ? { ...metadata, robots: 'noindex,nofollow' }
    : metadata
}
