/**
 * The search window's content (R5-14): the hub's own channel search, loaded
 * with the hub's styles the first time the window opens. On the hub it lists
 * the live channels the page already has; elsewhere it reads the small
 * 30-minute hub once (browser cache first), without polling.
 */
import type { RefObject } from 'react'
import { usePublicHubData } from '../../../hooks/usePublicHubData'
import type { HubLiveChannel } from '../../../lib/publicHub'
import { HubV5SearchBox } from '../hub/v5/HubV5Search'
import '../hub/d3/hub-d3-tokens.css'
import '../hub/v5/hub-v5.css'

const NO_LIVE: readonly HubLiveChannel[] = []

export default function AnalyticsFindWindow({ heroLive, inputRef, onNavigate }: {
  heroLive?: readonly HubLiveChannel[]
  inputRef: RefObject<HTMLInputElement>
  onNavigate: () => void
}) {
  const hub = usePublicHubData({ enabled: !heroLive, pollMs: 0, activityWindow: '30m' })
  return <HubV5SearchBox live={heroLive ?? hub.data?.liveChannels ?? NO_LIVE} inputRef={inputRef} autoFocus onNavigate={onNavigate} />
}
