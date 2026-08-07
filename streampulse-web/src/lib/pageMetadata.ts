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
    const login = decodeURIComponent(match[1]).replace(/[_-]+/g, ' ').trim()
    return login ? `${login} Analytics — StreamPulse` : null
  } catch {
    return 'Channel Analytics — StreamPulse'
  }
}

export function resolvePageMetadata(pathname: string, search = ''): PageMetadata {
  const normalizedPath = pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname
  const isFigmaPreview = new URLSearchParams(search).get('figma') === '1'

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
    case '/support':
      return {
        title: 'Support — StreamPulse',
        description: 'Troubleshoot the StreamPulse Twitch extension and public analytics portal.',
        canonicalPath: '/support',
        robots: 'index,follow',
      }
    case '/changelog':
      return {
        title: 'Changelog — StreamPulse',
        description: 'Shipped StreamPulse extension and public analytics changes.',
        canonicalPath: '/changelog',
        robots: 'index,follow',
      }
    default: {
      if (normalizedPath.startsWith('/docs/')) {
        return {
          title: 'Documentation — StreamPulse',
          description: 'Install StreamPulse, understand coverage states, and open public Twitch analytics.',
          canonicalPath: '/docs',
          robots: 'index,follow',
        }
      }
      const channel = channelTitle(normalizedPath)
      if (channel) {
        return {
          title: channel,
          description: 'Review aggregate Twitch stream activity, moments, coverage, games, and emote reactions.',
          canonicalPath: normalizedPath.replace(/\/s\//, '/'),
          robots: isFigmaPreview ? 'noindex,nofollow' : 'index,follow',
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
