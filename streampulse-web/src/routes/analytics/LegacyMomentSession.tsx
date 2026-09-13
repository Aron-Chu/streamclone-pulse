import { Navigate, Link, useSearchParams } from 'react-router-dom'
import { useNewsroomData } from '../../hooks/useNewsroomData'
import { broadcastTimelineHref } from '../../lib/momentsNavigation'
import { AnalyticsFigmaShell } from '../../ui/components/analytics/AnalyticsFigmaShell'

/** Resolve legacy story identity from its authority; never guess from its ID. */
export default function LegacyMomentSession() {
  const [params] = useSearchParams()
  const storyId = params.get('story') || undefined
  const detail = useNewsroomData({ enabled: Boolean(storyId), storyId, pollMs: 0 })
  if (!storyId) {
    const history = new URLSearchParams({ view: 'history' })
    if (params.get('category')) history.set('category', params.get('category')!)
    return <Navigate replace to={`/analytics/moments?${history}`} />
  }
  const story = detail.data?.story
  if (story && story.id === storyId && detail.data?.status !== 'unavailable') {
    const exact = params.get('login') === story.login && params.get('stream') === story.streamId
    const offset = exact && params.has('offset') ? Number(params.get('offset')) : undefined
    return <Navigate replace to={broadcastTimelineHref(story.login, story.streamId, '/analytics/moments?view=history', offset)} />
  }
  return <AnalyticsFigmaShell hideSidebar><main id="analytics-main" className="moments-workspace">
    <h1>Opening broadcast</h1>
    <p role="status">{detail.loading ? 'Finding this broadcast’s timeline…' : 'This broadcast link could not be resolved. Your original link has been kept so you can retry.'}</p>
    {!detail.loading ? <button onClick={detail.refresh}>Retry</button> : null}
    <Link className="moments-back" to="/analytics/moments?view=history">Browse history</Link>
  </main></AnalyticsFigmaShell>
}
