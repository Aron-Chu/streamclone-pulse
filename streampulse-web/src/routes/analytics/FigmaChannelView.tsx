import { useParams } from 'react-router-dom'
import { useChannelPageData } from '../../hooks/useChannelPageData'
import { ChannelHubStatusShell } from '../../ui/components/analytics/ChannelHubStatusShell'
import { FigmaChannelDashboard } from '../../ui/components/analytics/FigmaChannelDashboard'
import '../../ui/components/analytics/figma-analytics.css'

/** Default public channel session dashboard (stats strip + portal session panels). */
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
