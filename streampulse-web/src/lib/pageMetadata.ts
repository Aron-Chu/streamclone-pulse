import { isChannelRouteLogin } from './channelRoute'
import { GROWTH_PAGES } from './growthPages'
import reviewedRecapMetadata from '../generated/recap-page-metadata.json'

export interface PageMetadata {
  title: string
  description: string
  canonicalPath: string
  robots: 'index,follow' | 'noindex,nofollow'
}

const DEFAULT_DESCRIPTION =
  'StreamPulse adds free chat and emote stats beside Twitch chat, with Top Moments, pictures, and Stream Recap.'

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
  if (pathname.replace(/\/+$/, '') === '/account/restore') return { title: 'Restore Supporter — StreamPulse', description: 'Confirm a requested Supporter restore for your extension.', canonicalPath: '/account/restore', robots: 'noindex,nofollow' }
  // The Account page itself (/account) exists only with My Moments on (VITE_ACCOUNT_MOMENTS=1).
  if (pathname.startsWith('/account/') || (import.meta.env.VITE_ACCOUNT_MOMENTS === '1' && pathname.replace(/\/+$/, '') === '/account')) return { title: 'Your account — StreamPulse', description: 'Manage your StreamPulse account and connected extension.', canonicalPath: pathname.split(/[?#]/)[0], robots: 'noindex,nofollow' }
  const normalizedPath = pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname

  const growthPage = GROWTH_PAGES.find(page => page.canonicalPath === normalizedPath)
  if (growthPage) {
    const { path: _path, ...metadata } = growthPage
    return metadata
  }

  const reviewedPath = normalizedPath
    .replace(/^\/s\/([^/]+)(\/[^/]+)?$/, '/analytics/$1$2')
    .replace(/^\/analytics\/([^/]+)\/s\/([^/]+)$/, '/analytics/$1/$2')
  const reviewed = Object.prototype.hasOwnProperty.call(reviewedRecapMetadata, reviewedPath)
    ? (reviewedRecapMetadata as Record<string, PageMetadata>)[reviewedPath] : undefined
  if (reviewed) return reviewed

  switch (normalizedPath) {
    case '/':
      return {
        title: 'StreamPulse: Twitch Chat Stats & Top Moments',
        description: 'Explore Twitch chat stats, top emotes and reaction moments for tracked streams. Add the free Chrome, Edge or Firefox extension beside Twitch chat.',
        canonicalPath: '/',
        robots: 'index,follow',
      }
    case '/analytics':
    case '/analytics/hub':
    case '/analytics/emotes':
    case '/analytics/streams':
    case '/atlas':
      return {
        title: 'Live Twitch Chat Stats & Top Emotes — StreamPulse',
        description: 'Live Twitch chat stats for the channels StreamPulse tracks: chat per minute, top Twitch and 7TV emotes, and the reaction moments when chat jumps.',
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
        description: 'How the StreamPulse browser extension and website observe, send, and store data.',
        canonicalPath: '/privacy',
        robots: 'index,follow',
      }
    case '/supporter':
      return { title: 'Pulse Supporter — StreamPulse', description: 'Optional monthly membership, cosmetics, pricing, and membership availability.', canonicalPath: normalizedPath, robots: 'index,follow' }
    case '/supporter/thanks':
        return { title: 'Return to your extension — StreamPulse', description: 'Return to StreamPulse to check your membership after Checkout.', canonicalPath: normalizedPath, robots: 'noindex,nofollow' }
    case '/terms':
      return { title: 'Terms of Use — StreamPulse', description: 'Terms of use for the StreamPulse website, the StreamPulse browser extension and the optional Pulse Supporter subscription.', canonicalPath: normalizedPath, robots: 'index,follow' }
    case '/refunds':
      return { title: 'Cancellation and Refunds — StreamPulse', description: 'Manage cancellation, paid access, and refund requests for Pulse Supporter.', canonicalPath: normalizedPath, robots: 'index,follow' }
    case '/support':
      return {
        title: 'Support — StreamPulse',
        description: 'Troubleshoot the StreamPulse Twitch extension and public analytics portal.',
        canonicalPath: '/support',
        robots: 'index,follow',
      }
    case '/feedback':
      return { title: 'Send Feedback — StreamPulse', description: 'Send private feedback to the StreamPulse team. No account needed.', canonicalPath: '/feedback', robots: 'index,follow' }
    case '/discord':
      return { title: 'Discord — StreamPulse', description: 'Join the public StreamPulse community on Discord.', canonicalPath: normalizedPath, robots: 'noindex,nofollow' }
    case '/changelog':
      return { title: 'Release Notes — StreamPulse', description: 'What changed in each version of the StreamPulse extension.', canonicalPath: normalizedPath, robots: 'noindex,nofollow' }
    default: {
      // The retired Explorer only redirects, so it names the page it sends people to.
      if (normalizedPath === '/analytics/moments' || normalizedPath === '/analytics/explore' || /^\/analytics\/explore\/[^/]+$/.test(normalizedPath)) {
        return { title: 'Moments — StreamPulse', description: 'Discover measured reactions, review exact sources, and save moments on this device.', canonicalPath: '/analytics/moments', robots: 'noindex,nofollow' }
      }
      // A clip's own page, only in a build that has it; the page names the clip once it has read it.
      // Without the page every clip address is not found, never a channel named "clips".
      const clips = import.meta.env.VITE_PUBLIC_NATIVE_CLIPS
      const clipsOn = clips === 'on' || clips === '1'
      if (clipsOn && /^\/analytics\/clips\/[^/]+$/.test(normalizedPath)) {
        return { title: 'Clip — StreamPulse', description: 'A Twitch clip StreamPulse made when chat reacted strongly, with why it was clipped.', canonicalPath: normalizedPath, robots: 'noindex,nofollow' }
      }
      if (!clipsOn && /^\/analytics\/clips(?:\/|$)/.test(normalizedPath)) {
        return { title: 'Page not found — StreamPulse', description: DEFAULT_DESCRIPTION, canonicalPath: normalizedPath, robots: 'noindex,nofollow' }
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
