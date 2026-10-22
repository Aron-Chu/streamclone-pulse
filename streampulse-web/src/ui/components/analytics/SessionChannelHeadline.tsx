/**
 * The session page's channel headline (board session-who-r1, W1): a 52 px
 * avatar and the channel name lead the page, with "Live now · <category>"
 * (a link to the live session) when the channel is live and its broadcast
 * count underneath. The console supplies the channel's list; the picture and
 * a second opinion on "live" come from the channel lookup, which also serves
 * offline channels. Without a picture it is the hub's toned monogram.
 * Styles: sp-session-page.css (.ssp-who).
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { ConsoleChannelHeadline } from '@streampulse/analytics-console'
import { lookupChannelSuggestion } from '../../../lib/channelSearch'
import { hubAvatarTone, hubMonogram } from '../hub/v5/hubV5Model'

export function sessionBroadcastCount(count: number | null, capped: boolean): string | null {
  if (count === null) return null
  return `${count}${capped ? '+' : ''} broadcast${count === 1 && !capped ? '' : 's'}`
}

function ChannelAvatar({ login, name, src }: { login: string; name: string; src?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (src && failed !== src) {
    return <img className="ssp-who-av" src={src} alt="" width={52} height={52} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
  }
  return (
    <span className="ssp-who-av ssp-who-mono" style={{ background: hubAvatarTone(login) }} aria-hidden="true">
      {hubMonogram(name, login)}
    </span>
  )
}

export function SessionChannelHeadline({ headline }: { headline: ConsoleChannelHeadline }) {
  const lookup = useQuery({
    queryKey: ['channel-lookup', headline.login],
    queryFn: () => lookupChannelSuggestion(headline.login),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const meta = lookup.data
  const name = headline.displayName || meta?.displayName || headline.login
  // The list names the live session; the lookup (Twitch's own state) can veto a row left open.
  const live = headline.live && meta?.live !== false ? headline.live : null
  const liveText = live ? `Live now${live.category ? ` · ${live.category}` : ''}` : ''
  const count = sessionBroadcastCount(headline.broadcasts, headline.broadcastsCapped)

  return (
    <div className="ssp-who" data-session-channel>
      <ChannelAvatar login={headline.login} name={name} src={meta?.profileImageUrl} />
      <div className="ssp-who-tx">
        <p className="ssp-who-nm">{name}</p>
        <p className="ssp-who-sub">
          {live ? (
            headline.viewingLive
              ? <span className="ssp-who-live"><i aria-hidden="true" />{liveText}</span>
              : <Link className="ssp-who-live" to={live.href}><i aria-hidden="true" />{liveText}</Link>
          ) : null}
          {live && count ? <span className="ssp-who-sep" aria-hidden="true">·</span> : null}
          {count ? <span>{count}</span> : null}
        </p>
      </div>
    </div>
  )
}
