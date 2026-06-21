const RESERVED = new Set([
  'directory',
  'videos',
  'settings',
  'subscriptions',
  'inventory',
  'p',
  'u',
  'popout',
  'team',
  'friends',
  'bits',
  'prime',
])

export function parseChannelLogin(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean)
  if (!parts.length) return null
  const head = parts[0].toLowerCase()
  if (RESERVED.has(head)) return null
  if (head === 'videos' || parts[1] === 'videos') return null
  return head
}

export function isTwitchChannelPage(pathname: string): boolean {
  return parseChannelLogin(pathname) !== null
}
