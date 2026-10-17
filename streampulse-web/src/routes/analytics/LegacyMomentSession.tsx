import { Navigate, Link, useSearchParams } from 'react-router-dom'
import { useNewsroomData } from '../../hooks/useNewsroomData'
import { broadcastTimelineHref } from '../../lib/momentsNavigation'
import { AnalyticsFigmaShell } from '../../ui/components/analytics/AnalyticsFigmaShell'

const MOMENTS = '/analytics/moments'

/** Resolve legacy story identity from its authority; never guess from its ID. */
export default function LegacyMomentSession() {
  const [params] = useSearchParams()
  const storyId = params.get('story') || undefined
  const detail = useNewsroomData({ enabled: Boolean(storyId), storyId, pollMs: 0 })
  if (!storyId) {
    return <Navigate replace to={MOMENTS} />
  }
  const story = detail.data?.story
  if (story && story.id === storyId && detail.data?.status !== 'unavailable') {
    const exact = params.get('login') === story.login && params.get('stream') === story.streamId
    const rawOffset = exact ? params.get('offset') : null
    const offset = rawOffset != null && rawOffset.trim() !== '' ? Number(rawOffset) : undefined
    return <Navigate replace to={broadcastTimelineHref(story.login, story.streamId, MOMENTS, offset)} />
  }
  return <AnalyticsFigmaShell hideSidebar><main id="analytics-main" className="moments-workspace">
    <h1>Opening broadcast</h1>
    <p role="status">{detail.loading ? 'Finding this broadcast’s timeline…' : 'This broadcast link could not be resolved. Your original link has been kept so you can retry.'}</p>
    {!detail.loading ? <button onClick={detail.refresh}>Retry</button> : null}
    <Link className="moments-back" to={MOMENTS}>Browse moments</Link>
  </main></AnalyticsFigmaShell>
}
