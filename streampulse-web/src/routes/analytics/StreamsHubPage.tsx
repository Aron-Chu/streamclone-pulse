import { Link } from 'react-router-dom'
import { useStreamsHubData } from '../../hooks/useStreamsHubData'
import {
  AnalyticsShell,
  HubState,
  LiveNowTable,
  StreamsHistoryTable,
} from '../../ui/components/analytics'

export default function StreamsHubPage() {
  const hub = useStreamsHubData()

  return (
    <AnalyticsShell
      title="Streams"
      description="Live and recent sessions across your watchlist — metadata history only, no full timelines."
      actions={
        <Link to="/analytics/watchlist" className="btn btn-secondary">
          Manage watchlist
        </Link>
      }
    >
      <HubState
        loading={hub.loading}
        error={hub.error}
        empty={hub.watchlistEmpty}
        emptyMessage="Add channels to your watchlist to browse recent streams."
        onRetry={hub.reload}
      >
        <LiveNowTable rows={hub.liveRows} />
        <StreamsHistoryTable rows={hub.streamRows} historyUnavailable={hub.historyUnavailable} />
      </HubState>
    </AnalyticsShell>
  )
}
