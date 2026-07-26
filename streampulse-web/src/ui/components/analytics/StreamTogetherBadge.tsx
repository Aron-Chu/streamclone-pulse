import { displayName } from './hubFormat'

export function channelCategoryLabel(category?: string): string {
  const trimmed = category?.trim()
  return trimmed || '—'
}

export function StreamTogetherBadge({
  channel,
}: {
  channel: { login: string; displayName?: string; togetherWith?: string[]; hostLogin?: string }
}) {
  if (!channel.togetherWith?.length && !channel.hostLogin) return null
  const partners = channel.togetherWith?.length
    ? channel.togetherWith
    : channel.hostLogin
      ? [channel.hostLogin]
      : []
  const label = partners.map((login) => displayName(login, login)).join(', ')
  return (
    <span
      className="stream-together-badge"
      title={`Streaming together with ${label}`}
    >
      Together
    </span>
  )
}
