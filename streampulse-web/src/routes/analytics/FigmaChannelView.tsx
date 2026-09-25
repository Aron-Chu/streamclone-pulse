import { useParams } from 'react-router-dom'
import { useChannelPageData } from '../../hooks/useChannelPageData'
import { ChannelHubStatusShell } from '../../ui/components/analytics/ChannelHubStatusShell'
import { FigmaChannelDashboard } from '../../ui/components/analytics/FigmaChannelDashboard'
import '../../ui/components/analytics/figma-analytics.css'

/** Retired, unrouted prototype. The supported channel route uses ConsoleChannelView. */
export default function FigmaChannelView() {
  const { login = '', streamId } = useParams<{ login: string; streamId?: string }>()
  const channelData = useChannelPageData(login, streamId)
  const displayChannel = login.trim() || 'channel'

  return (
    <ChannelHubStatusShell displayChannel={displayChannel}>
      <FigmaChannelDashboard data={channelData} />
    </ChannelHubStatusShell>
  )
}
