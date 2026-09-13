export { mergeMomentTopEmotes } from '../../lib/discoveryMomentRecap'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import LegacyMomentSession from './LegacyMomentSession'
import { BroadcastCard } from '../../ui/components/moments/BroadcastCard'
import { broadcastTimelineHref } from '../../lib/momentsNavigation'
import { usePublicHubData } from '../../hooks/usePublicHubData'
import { useDiscoveryCatalogue, useRankedDiscovery } from '../../hooks/useDiscoveryCatalogue'
import { useMomentProfiles } from '../../hooks/useMomentProfiles'
import { currentDiscoveryMonth, readRankedScope, type RankedScope } from '../../lib/discoveryCatalogue'
import { RankedExploreControls } from '../../ui/components/moments/RankedExploreControls'
import { readDiscoveryPresentation } from '../../lib/discoveryPresentation'
import { DiscoveryCalendar } from '../../ui/components/moments/DiscoveryCalendar'
import { resolveLivePulseMoments } from '../../lib/figmaSessionAnalytics'
import { fromHubMoment, uniqueDiscoveryMoments,
  checkMomentSource, type DiscoveryMoment, type CheckedMomentSource } from '../../lib/discoveryMoments'
import { useSavedMoments } from '../../lib/savedDiscoveryMoments'
import { refreshedReplayforgeHandoffHref } from '../../lib/replayforgeHandoff'
import { watchMomentHref } from '../../lib/watchHandoff'
import { formatStreamOffset } from '../../lib/formatStreamOffset'
import { momentComparisonSummary } from '../../lib/momentComparison'
import { browseLoadedItems, loadedMomentNeighbors, readMomentBrowse } from '../../lib/momentBrowse'
import { AnalyticsFigmaShell } from '../../ui/components/analytics/AnalyticsFigmaShell'
import { SaveMomentButton } from '../../ui/components/moments/SaveMomentButton'
import { MomentVodPreview } from '../../ui/components/moments/MomentVodPreview'
import { MomentLoadingSkeleton } from '../../ui/components/moments/MomentLoadingSkeleton'
import { useCollectionArrival } from '../../ui/motion/useCollectionArrival'
import { MomentRow } from '../../ui/components/moments/MomentRow'
import { groupMomentsByBroadcast } from '../../lib/broadcastGroups'
import { MomentSelect } from '../../ui/components/moments/MomentSelect'
import { MomentEvidenceBars } from '../../ui/components/moments/MomentEvidenceBars'
import { MomentNote } from '../../ui/components/moments/MomentNote'
import type { ArchiveArtwork } from '../../lib/archiveArtwork'
import { EmoteImg } from '../../ui/components/analytics/EmoteImg'
import { loadExactMomentRecap } from '../../lib/discoveryMomentRecap'
import { loadNewsroomProfiles, newsroomProfileUrl } from '../../lib/newsroomProfiles'
import '../../ui/components/analytics/figma-analytics.css'
import '../../ui/components/moments/moments-workspace.css'

const present = (value?: number) => value != null && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : 'Unavailable'
const valid = (moment: DiscoveryMoment | null): moment is DiscoveryMoment => moment !== null
const scrollPositions = new Map<string, number>()
interface ReviewContinuation { loading: boolean; canLoad: boolean; limited: boolean; error: string | null; load: () => void }

function MomentAvatar({ moment }: { moment: Pick<DiscoveryMoment, 'profileImageUrl' | 'displayName' | 'login'> }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [moment.profileImageUrl])
  // Use existing profile allowlist. Never turn arbitrary candidate strings into image requests.
  const safe = newsroomProfileUrl(moment.profileImageUrl)
  return safe && !failed ? <img className="moments-avatar" src={moment.profileImageUrl} alt="" onError={() => setFailed(true)} />
    : <span className="moments-avatar" aria-hidden="true">{(moment.displayName || moment.login).slice(0, 1).toUpperCase()}</span>
}

function MomentCreator({ moment }: { moment: DiscoveryMoment }) {
  const content = <><MomentAvatar moment={moment} /><span><strong>{moment.displayName || moment.login}</strong><small>{moment.category || 'Category unavailable'}</small></span></>
  return <div className="moments-creator-link">{content}</div>
}

function MomentDetail({ moment: suppliedMoment, onClose, saved, onSourceState, navigation, onNavigate, continuation }: { moment: DiscoveryMoment; onClose: () => void; saved: boolean; onSourceState: (key: string, state: string, artwork?: ArchiveArtwork) => void; navigation: ReturnType<typeof loadedMomentNeighbors<DiscoveryMoment>>; onNavigate: (moment: DiscoveryMoment) => void; continuation?: ReviewContinuation }) {
  const detailLocation = useLocation()
  const [recap, setRecap] = useState<Partial<DiscoveryMoment> | null>(null)
  const [profileImageUrl, setProfileImageUrl] = useState<string>()
  const [evidenceState, setEvidenceState] = useState('')
  const [evidenceAttempt, setEvidenceAttempt] = useState(0)
  const needsEvidence = !suppliedMoment.topEmotes?.length
  useEffect(() => {
    const controller = new AbortController()
    if (!needsEvidence) { setRecap(null); setEvidenceState('') }
    if (!newsroomProfileUrl(suppliedMoment.profileImageUrl)) void loadNewsroomProfiles([suppliedMoment.login], controller.signal, (_login, url) => setProfileImageUrl(url))
    if (needsEvidence) {
      setEvidenceState('Loading this exact detection…')
      void loadExactMomentRecap(suppliedMoment, controller.signal).then(result => {
        if (controller.signal.aborted) return
        setRecap(result)
        setEvidenceState(result ? '' : 'This exact detection is not in the available session recap. No nearby reaction was substituted.')
      }).catch(() => { if (!controller.signal.aborted) setEvidenceState('Reaction details could not be loaded. You can retry without losing this selection.') })
    }
    return () => controller.abort()
  }, [suppliedMoment.key, suppliedMoment.publicMomentId, needsEvidence, evidenceAttempt])
  const moment = { ...suppliedMoment, ...(needsEvidence ? recap : null), profileImageUrl: newsroomProfileUrl(suppliedMoment.profileImageUrl) || profileImageUrl }
  const [source, setSource] = useState<CheckedMomentSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [automaticChecks, setAutomaticChecks] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const detail = heading.current?.closest('section')
    if (detail) detail.scrollTop = 0
    heading.current?.focus({ preventScroll: true })
    detail?.scrollIntoView({ block: 'start' })
  }, [moment.key])
  useEffect(() => {
    const controller = new AbortController()
    let expiry: ReturnType<typeof setTimeout> | undefined
    // Rechecking the same selected source must not destroy a playing iframe.
    // The detail is keyed by exact moment identity; a new selection starts fresh.
    setLoading(true); setError('')
    onSourceState(moment.key, 'Checking source')
    void checkMomentSource(moment, controller.signal, true).then(result => {
      if (controller.signal.aborted) return
      if (result.lookupFailed) {
        setError('The source recheck failed. Any visible preview uses the last verified mapping; playback still depends on Twitch.')
        setSource(previous => previous?.vodHref ? { ...previous, handoffRef: undefined, liveHref: null } : result)
        onSourceState(moment.key, 'Source recheck failed')
        return
      }
      setSource(result)
      onSourceState(moment.key, result.vodHref ? 'VOD mapping checked · playback unchecked' : 'No replay mapping confirmed', result.vodHref ? result.archiveArtwork : undefined)
      // Confirmed presence is transient; a source check is never a permanent LIVE badge.
      if (result.liveExpiresAt) expiry = setTimeout(() => setSource(current => current ? { ...current, liveHref: null } : null), Math.max(0, result.liveExpiresAt - Date.now()))
    }).catch(() => { if (!controller.signal.aborted) {
      setError('Could not recheck this source. Any visible preview uses the last verified mapping. Retry to check again.')
      setSource(previous => previous ? { ...previous, handoffRef: undefined, liveHref: null } : null)
      onSourceState(moment.key, 'Source check failed')
    } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); if (expiry) clearTimeout(expiry) }
  }, [moment.key, attempt, onSourceState, saved])
  const autoRechecking = !loading && automaticChecks < 5 && Boolean(source?.retryable || error)
  useEffect(() => {
    if (!autoRechecking) return
    // Selected-only, bounded recovery. Hidden tabs do not issue archive reads.
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      setAutomaticChecks(value => value + 1)
      setAttempt(value => value + 1)
    }, 60_000)
    return () => clearInterval(timer)
  }, [autoRechecking, automaticChecks, attempt])
  const handoff = refreshedReplayforgeHandoffHref(source)
  const watchHref = watchMomentHref(moment, source)
  const comparison = moment.comparison
  const summary = momentComparisonSummary(comparison, moment.reactionSignal)
  return <section className="moments-detail" aria-label="Selected moment" tabIndex={0} onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
    <button type="button" className="moments-back" onClick={onClose}>← Back to results</button>
    {navigation.total <= 1 && navigation.position == null ? <p className="moments-muted">Selection outside loaded matches</p> : null}
    {navigation.total > 1 ? <nav className="moments-review-navigation" aria-label="Review loaded moments">
      <span>{navigation.position == null ? 'Selection outside loaded matches' : `${navigation.position} of ${navigation.total} loaded matches`}</span>
      <div><button type="button" disabled={!navigation.previous} onClick={() => { if (navigation.previous) onNavigate(navigation.previous) }}>Previous moment</button>
      <button type="button" disabled={!navigation.next} onClick={() => { if (navigation.next) onNavigate(navigation.next) }}>Next moment</button></div>
    </nav> : null}
    {continuation && (continuation.canLoad || continuation.loading || continuation.error || continuation.limited) ? <section className="moments-review-continuation" aria-label="Continue reviewing collection">
      <button type="button" disabled={continuation.loading || !continuation.canLoad || continuation.limited} onClick={continuation.load}>{continuation.loading ? 'Loading more moments…' : continuation.limited ? 'Page limit reached' : continuation.canLoad ? 'Load more moments into review' : 'All supplied moments loaded'}</button>
      <p className="moments-muted">{continuation.limited ? '1,000 results loaded. Return to results and choose a day or creator to narrow this collection.' : continuation.canLoad ? 'Adds results in your current sort order. Your selection stays; filters still apply.' : 'This is the supplied collection, not proof that every reaction was detected.'}</p>
      {continuation.error ? <p role="status">{continuation.error}</p> : null}
    </section> : null}
    <div className="moments-identity"><MomentAvatar moment={moment} /><div><strong>{moment.displayName || moment.login}</strong><div className="moments-muted">{moment.category || 'Selected broadcast'}</div></div><span className="moments-detail-offset"><strong>{formatStreamOffset(moment.offsetSeconds)}</strong><small>into broadcast</small></span></div>
    <h2 ref={heading} tabIndex={-1}>{moment.label}</h2>
    {/* The offset already sits beside the identity; this line carries wall-clock time only. */}
    <p className="moments-muted">{moment.at || source?.occurrenceAt ? new Date(moment.at ?? source!.occurrenceAt!).toLocaleString() : 'Occurrence time unavailable'}</p>
    {evidenceState ? <p className="moments-muted" role="status">{evidenceState}{!evidenceState.startsWith('Loading') ? <> <button type="button" onClick={() => setEvidenceAttempt(value => value + 1)}>Retry reaction details</button></> : null}</p> : null}
    {source?.vodHref ? <MomentVodPreview key={source.vodHref} href={source.vodHref} artwork={source.archiveArtwork} autoLoad /> : null}
    {!source?.vodHref ? <div className="moment-replay-pending" role="status"><span className="moment-replay-symbol" aria-hidden="true">▷</span>
      <div><strong>{loading ? 'Checking this moment’s replay' : error ? 'Replay lookup failed' : source?.pendingArchive ? 'Waiting for this broadcast’s archive' : 'Replay unavailable'}</strong>
        <p>{loading ? 'Looking for the archive at this exact timestamp.' : error || source?.reason || 'No verified replay mapping is available for this moment.'}</p>
        {autoRechecking ? <small>We’ll recheck automatically while this page is open.</small> : null}
        {!loading ? <button type="button" onClick={() => { setAutomaticChecks(0); setAttempt(value => value + 1) }}>Check replay now</button> : null}
      </div>
    </div> : null}
    {source?.vodHref && (loading || error) ? <p className="moments-muted" role="status">{loading ? 'Rechecking source without restarting the preview…' : error}</p> : null}
    <div className="moments-actions moments-primary-actions"><SaveMomentButton moment={moment} />
      {source?.vodHref ? <a href={source.vodHref} target="_blank" rel="noopener noreferrer">Open VOD at {formatStreamOffset(source.vodOffsetSeconds ?? moment.offsetSeconds)} ↗</a> : null}
      {handoff ? <a href={handoff} target="_blank" rel="noopener noreferrer">Prepare clip in ReplayForge ↗</a> : null}
      {handoff ? <small>ReplayForge requires sign-in and source permission. Opening it does not create a job.</small> : null}
    </div>
    <section className="moments-measurement" aria-label="Moment measurement">
      <div className="moments-measurement-heading"><h3>What happened in chat</h3>{summary ? <span>{summary}</span> : null}</div>
      <dl><div><dt>Chat / min</dt><dd>{present(moment.chatPerMin)}</dd></div><div><dt>Emotes / min</dt><dd>{present(moment.emotesPerMin)}</dd></div><div><dt>Detection window</dt><dd>1 minute</dd></div></dl>
      <MomentEvidenceBars moment={moment} />
    </section>
    {moment.topEmotes?.length ? <section className="moments-reactions" aria-label="Selected moment reactions"><h3>Reactions in this moment</h3>
      <ul>{moment.topEmotes.slice(0, 5).map((emote, index) => <li key={`${emote.provider || ''}:${emote.name}:${index}`}>
        <EmoteImg name={emote.name} src={emote.imageUrl} width={28} height={28} />
        <span className="moment-emote-label"><span>{emote.name}</span><small>{emote.provider === 'seventv' ? '7TV' : emote.provider || 'Provider not supplied'}</small>
          {emote.count != null && Number.isFinite(emote.count) && emote.count >= 0 ? <span className="moment-emote-track" aria-hidden="true"><i style={{ width: `${emote.count / Math.max(1, ...moment.topEmotes!.slice(0, 5).map(item => item.count != null && Number.isFinite(item.count) && item.count >= 0 ? item.count : 0)) * 100}%` }} /></span> : null}
        </span>
        <strong>{emote.count != null && Number.isFinite(emote.count) && emote.count >= 0 ? `${present(emote.count)} uses` : 'Count unavailable'}</strong>
      </li>)}</ul><p className="moments-muted">Supplied emote uses · bars relative to the leading emote shown</p>
    </section> : null}
    <MomentNote key={moment.key} momentKey={moment.key} />
    <details className="moments-source" open={!source?.vodHref}>
      <summary>{loading ? 'Checking source…' : source?.vodHref ? 'Source & playback details' : 'No replay link confirmed'}</summary>
      <div aria-live="polite">
      <strong>{loading ? 'Checking source…' : source?.vodHref ? 'VOD link available' : 'No replay link confirmed'}</strong>
      {source?.vodHref ? <p>{error || source.reason}</p> : null}
      {saved ? <p>Saved metadata is historical. Source links are checked again when opened here.</p> : null}
      <div className="moments-actions">
        {source?.liveHref ? <a href={source.liveHref} target="_blank" rel="noopener noreferrer">Watch live now ↗</a> : null}
        {watchHref ? <a href={watchHref} target="_blank" rel="noopener noreferrer">Review in Streamclone ↗</a> : null}
        {/* The row already links this moment's analytics; in review it belongs with the other source navigation. */}
        <Link to={broadcastTimelineHref(moment.login, moment.streamId, detailLocation.pathname + detailLocation.search, moment.offsetSeconds)}>View stream timeline</Link>
        {!loading ? <button type="button" onClick={() => { setAutomaticChecks(0); setAttempt(value => value + 1) }}>Recheck source</button> : null}
      </div>
      {source?.liveHref ? <small>Live playback does not replay this detection.</small> : null}
      {watchHref ? <small>Opens this archive and timestamp in the watch app. Clipping requires a separate permission check and confirmation there.</small> : null}
      </div>
    </details>
    <details className="moments-evidence"><summary>Measured evidence</summary>
      {moment.measurementScope === 'verified_minute' && <p>Counts and comparison use the same verified minute. Measurements can change between published snapshots.</p>}
      <p>{moment.provenance === 'session' ? `Session update${moment.revision != null ? ` · revision ${moment.revision}` : ''}` : moment.provenance === 'saved' ? 'Saved detection snapshot' : 'Detection feed snapshot'}{moment.evidenceAsOf && Number.isFinite(Date.parse(moment.evidenceAsOf)) ? ` · published ${new Date(moment.evidenceAsOf).toLocaleString()}` : ''}. Publication time is separate from the reaction timestamp. Rechecking playback does not refresh these measurements.</p>
      <dl><dt>Chat</dt><dd>{present(moment.chatPerMin)} /min</dd><dt>Emotes</dt><dd>{present(moment.emotesPerMin)} /min</dd>
        <dt>Baseline measured</dt><dd>{comparison ? `${comparison.evidence.baselineMeasuredMinutes}/${comparison.evidence.baselineExpectedMinutes} minutes` : 'Unavailable'}</dd>
        <dt>Source stream</dt><dd>{moment.streamId}</dd><dt>Public moment</dt><dd>{moment.publicMomentId || 'Not supplied'}</dd></dl>
      <p>Reaction measurements are not editorial quality ratings.</p>
    </details>
  </section>
}

export default function AnalyticsMomentsPage() {
  const [params] = useSearchParams()
  return params.get('view') === 'sessions' ? <LegacyMomentSession /> : <MomentsWorkspace />
}

function MomentsWorkspace() {
  const [params, setParams] = useSearchParams()
  // Rapid filter changes can precede the router's next render. Compose them
  // against the pending query so typing cannot drop a just-selected filter.
  const latestParams = useRef(params)
  useLayoutEffect(() => { latestParams.current = params }, [params])
  const location = useLocation()
  const navigate = useNavigate()
  // Ranked discovery is opt-in until its hosted route and calibration are ready.
  const view = params.get('view') === 'saved' ? 'saved' : params.get('view') === 'history' || params.get('collection') === 'history' ? 'history' : params.get('view') === 'explore' ? 'explore' : 'recent'
  const explore = view === 'explore'
  const [rankedClock, setRankedClock] = useState<Date>()
  let rankedScope: RankedScope | null = null, rankedValidation = ''
  try { rankedScope = readRankedScope(params, rankedClock) } catch (error) { rankedValidation = error instanceof Error ? error.message : 'Choose valid Explore filters.' }
  const ranked = useRankedDiscovery(explore, rankedScope)
  useEffect(() => {
    if (ranked.data && !ranked.retained) setRankedClock(new Date(ranked.data.asOf))
  }, [ranked.data?.asOf, ranked.retained])
  const historyMode = view === 'history'
  const browse = { ...readMomentBrowse(params), period: 'all' as const, from: '', to: '' }
  const historyScope = { month: params.get('month') || currentDiscoveryMonth(), creator: params.get('creator') || '', day: params.get('day') || '', category: browse.category }
  const presentation = readDiscoveryPresentation(params, historyScope.month)
  const catalogue = useDiscoveryCatalogue(historyMode && presentation.mode === 'month', historyScope)
  const catalogueReady = Boolean(catalogue.data && catalogue.data.state !== 'unavailable')
  const { category } = browse
  const offset = params.has('offset') ? Number(params.get('offset')) : NaN
  const requested = params.has('offset') && params.has('stream') && params.has('login')
  const saved = useSavedMoments()
  const [sourceStates, setSourceStates] = useState<Record<string, string>>({})
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const [checkedArtwork, setCheckedArtwork] = useState<Record<string, ArchiveArtwork>>({})
  const onSourceState = useCallback((key: string, state: string, artwork?: ArchiveArtwork) => {
    setSourceStates(previous => Object.fromEntries([...Object.entries(previous).filter(([id]) => id !== key).slice(-199), [key, state]]))
    // Exact detection key, in-memory only. Rechecking clears any earlier artwork;
    // a thumbnail never grants playback permission or replaces source revalidation.
    setCheckedArtwork(previous => Object.fromEntries([...Object.entries(previous).filter(([id]) => id !== key).slice(-199), ...(artwork ? [[key, artwork] as const] : [])]))
  }, [])
  const hub = usePublicHubData({ enabled: view === 'recent' && !historyMode, activityWindow: '30m' })
  const feed = useMemo(() => hub.data ? resolveLivePulseMoments(hub.data) : null, [hub.data])
  const recentArtwork = useMemo(() => new Map((hub.data?.livePulseMoments ?? []).flatMap(moment => {
    const adapted = fromHubMoment(moment)
    return adapted?.archiveArtwork ? [[adapted.key, adapted.archiveArtwork] as const] : []
  })), [hub.data?.livePulseMoments])
  const recent = useMemo(() => uniqueDiscoveryMoments((feed?.moments ?? []).map((row): DiscoveryMoment | null => {
    const moment = fromHubMoment(row)
    return moment ? { ...moment, evidenceAsOf: hub.data?.generatedAt } : null
  }).filter(valid)), [feed, hub.data?.generatedAt])
  const [visibleRecent, setVisibleRecent] = useState<DiscoveryMoment[]>([])
  const [pendingRecent, setPendingRecent] = useState<DiscoveryMoment[]>([])
  // Cache hydration can supply a complete feed one render before the effect
  // commits it to the review-stable queue. Present that first snapshot directly
  // so the page never announces an empty collection it already has.
  const presentedRecent = visibleRecent.length || !recent.length ? visibleRecent : recent.slice(0, 200)
  const visibleRecentRef = useRef(visibleRecent)
  visibleRecentRef.current = visibleRecent
  useEffect(() => {
    if (view !== 'recent' || historyMode || !hub.data) return
    const previous = visibleRecentRef.current
    const next = recent.slice(0, 200)
    // Only hold ordering while an exact review is open. A healthy refresh must
    // replace a cache snapshot during ordinary browsing, including with an
    // honestly empty result, rather than preserving stale identities forever.
    if (!previous.length || !requested) {
      setVisibleRecent(next)
      setPendingRecent([])
      return
    }
    const known = new Set(previous.map(moment => moment.key))
    setPendingRecent(pending => uniqueDiscoveryMoments([...pending, ...recent].filter(moment => !known.has(moment.key))).slice(0, 200))
    const byKey = new Map(recent.map(moment => [moment.key, moment]))
    setVisibleRecent(previous.map(moment => byKey.get(moment.key) ?? moment).slice(0, 200))
  }, [historyMode, hub.data, recent, requested, view])
  const collection = explore ? ranked.data?.items ?? [] : view === 'saved' ? saved.items : historyMode ? catalogue.data?.items ?? [] : presentedRecent
  const catalogueArtwork = useMemo(() => new Map((catalogue.data?.items ?? []).flatMap(moment =>
    moment.archiveArtwork ? [[moment.key, moment.archiveArtwork] as const] : [])), [catalogue.data?.items])
  const now = Date.now()
  const filtered = explore ? collection : browseLoadedItems(collection, browse, moment => ({ key: moment.key, at: moment.at, category: moment.category,
    text: `${moment.displayName || moment.login} ${moment.login} ${moment.category || ''} ${moment.label}` }), now)
  const categories = [...new Set(collection.map(moment => moment.category).filter((value): value is string => Boolean(value)))].sort()
  const selected = collection.find(moment => moment.login === params.get('login') && moment.streamId === params.get('stream') && moment.offsetSeconds === offset
    && (!params.get('moment') || moment.publicMomentId === params.get('moment')))
  const selectionSeed = requested ? fromHubMoment({ login: params.get('login') || '', streamId: params.get('stream') || '',
    offsetSeconds: offset, publicMomentId: params.get('moment') || undefined, label: 'Selected reaction' }) : null
  // Preserve the measured row that was actually opened, even when another hub
  // window returns a different recent collection. History state survives reload;
  // it supplies display metadata only, never authority for playback.
  const openedRow = location.state?.hubMoment
  const openedMoment = openedRow && typeof openedRow.login === 'string' ? fromHubMoment(openedRow) : null
  const matchingOpenedMoment = selectionSeed && openedMoment?.key === selectionSeed.key
    && (!selectionSeed.publicMomentId || openedMoment.publicMomentId === selectionSeed.publicMomentId)
    ? openedMoment : null
  const chosen = selected ?? matchingOpenedMoment ?? selectionSeed
  const profiledResults = useMomentProfiles(filtered)
  const broadcasts = useMemo(() => historyMode ? groupMomentsByBroadcast(profiledResults).reverse() : [], [historyMode, profiledResults])
  // One artwork policy for every list: a verified thumbnail from the selected-source
  // check wins, a supplied catalogue/feed thumbnail is used only while this row has
  // no source state of its own, and review hides thumbnails to keep the list narrow.
  const reviewing = Boolean(chosen)
  const resolveArtwork = useCallback((moment: DiscoveryMoment) => reviewing ? undefined
    : checkedArtwork[moment.key] ?? (!sourceStates[moment.key]
      ? (historyMode ? catalogueArtwork.get(moment.key) : view === 'recent' ? recentArtwork.get(moment.key) : undefined)
      : undefined),
    [catalogueArtwork, checkedArtwork, historyMode, recentArtwork, reviewing, sourceStates, view])
  const busy = explore ? ranked.loading : historyMode ? catalogue.loading : view === 'recent' ? hub.loading : false
  const failure = historyMode ? catalogue.error || (catalogue.data?.state === 'unavailable' ? 'Stored history is temporarily unavailable.' : null) : view === 'recent' ? hub.error : null
  const resultsRef = useRef<HTMLHeadingElement>(null)
  const lastSelectedKey = useRef<string | null>(null)
  useEffect(() => {
    // A review opened from Live Wire or a shared URL did not call select() here.
    // It still needs the same return-focus target once results have loaded.
    if (chosen) lastSelectedKey.current = chosen.key
  }, [chosen?.key])
  const previousNavigation = useRef({ requested })
  function update(values: Record<string, string | null>, replace = requested, state = location.state) {
    const next = new URLSearchParams(latestParams.current)
    for (const [key, value] of Object.entries(values)) value == null ? next.delete(key) : next.set(key, value)
    latestParams.current = next
    const nextState = state && typeof state === 'object' ? { ...state } : {}
    if (!next.has('offset')) delete nextState.momentsReviewOrigin
    setParams(next, { replace, state: nextState })
  }
  function select(moment: DiscoveryMoment) {
    lastSelectedKey.current = moment.key
    update({ login: moment.login, stream: moment.streamId, offset: String(moment.offsetSeconds), moment: moment.publicMomentId ?? null }, requested,
      requested ? location.state : { ...location.state, momentsReviewOrigin: location.key, hubMoment: moment })
  }
  function close() {
    if (typeof location.state?.momentsReviewOrigin === 'string') {
      navigate(-1)
    } else update({ login: null, stream: null, offset: null, moment: null }, true)
    requestAnimationFrame(() => {
      const target = [...document.querySelectorAll<HTMLButtonElement>('[data-discovery-key]')].find(button => button.dataset.discoveryKey === lastSelectedKey.current)
      if (target) target.focus(); else resultsRef.current?.focus()
    })
  }
  useEffect(() => {
    const key = location.key
    if (!requested) requestAnimationFrame(() => window.scrollTo(0, scrollPositions.get(key) ?? 0))
    return () => { scrollPositions.set(key, window.scrollY); if (scrollPositions.size > 40) scrollPositions.delete(scrollPositions.keys().next().value!) }
  }, [location.key, requested])
  useEffect(() => {
    const previous = previousNavigation.current
    previousNavigation.current = { requested }
    if (previous.requested && !requested) requestAnimationFrame(() => {
      const target = [...document.querySelectorAll<HTMLButtonElement>('[data-discovery-key]')].find(button => button.dataset.discoveryKey === lastSelectedKey.current)
      if (target) target.focus({ preventScroll: true }); else resultsRef.current?.focus({ preventScroll: true })
    })
  }, [requested])
  const resetSelection = { login: null, stream: null, offset: null, moment: null, story: null }
  const arrivalRoot = useRef<HTMLElement>(null)
  useCollectionArrival(arrivalRoot, JSON.stringify(profiledResults.map(item => item.key)))
  const hasBrowseFilters = Boolean(category || browse.query || browse.order !== 'newest')
  function changeView(next: string) {
    setParams({ view: next })
  }
  return <AnalyticsFigmaShell hideSidebar><main id="analytics-main" className={`moments-workspace${chosen ? ' is-reviewing' : ''}`} data-filters-expanded={filtersExpanded} tabIndex={-1}>
    <header className="moments-heading"><div><h1>{historyMode ? 'Broadcast history' : view === 'saved' ? 'Saved moments' : 'Moments'}</h1><p>{historyMode ? 'Find a broadcast, then explore its timeline and moments.' : view === 'saved' ? 'Your shortlist of reactions to return to.' : 'Catch a reaction. Open its timeline. Keep what matters.'}</p></div><Link to="/analytics">Live activity →</Link></header>
    <nav className="moments-tabs moments-tabs-four" data-view={view} aria-label="Moment views"><span className="moments-tab-indicator" aria-hidden="true" />{(['explore', 'recent', 'history', 'saved'] as const).map(tab => <button type="button" key={tab} aria-pressed={view === tab} onClick={() => changeView(tab)}>{tab === 'saved' ? `Saved (${saved.items.length})` : tab === 'recent' ? 'Latest' : tab === 'explore' ? 'Explore' : 'History'}</button>)}</nav>
    <p className="moments-muted">{explore ? 'Ranked measured detections from indexed public IRC streams, not all Twitch broadcasts.' : view === 'saved' ? 'Saved in this browser · not synced to the extension or your account.' : historyMode ? 'Indexed broadcasts with measured activity. Coverage may be partial.' : <>This live preview shows up to 10 detections, not your full history. <Link to="/analytics/moments?view=history">Browse recorded broadcasts and moments →</Link></>}</p>
    {explore ? <RankedExploreControls params={params} data={ranked.data} loading={ranked.loading} retained={ranked.retained || Boolean(rankedValidation)} error={rankedValidation || ranked.error} invalid={Boolean(rankedValidation)}
      onChange={values => update({ ...resetSelection, ...values, view: 'explore', sort: 'top', q: null }, false)}
      onReset={() => { setRankedClock(undefined); setParams({ view: 'explore', period: 'today', sort: 'top' }) }}
      onRefresh={() => { if (!chosen) setRankedClock(undefined); ranked.refresh() }} /> : null}
    {saved.warning ? <p role="status" className="moments-notice">{saved.warning}</p> : null}
    {historyMode ? <DiscoveryCalendar scope={historyScope} data={catalogue.data} loading={catalogue.loading} presentation={presentation}
      onPresentationChange={values => update({ ...('calendar' in values ? resetSelection : {}), ...values })}
      onChange={values => update({ ...resetSelection, ...values, occurred: null, q: null, sort: null })}
      onRecent={() => changeView('recent')} /> : null}
    {!explore && !chosen && collection.length > 0 ? <>
      <button type="button" className="moments-filter-toggle" aria-expanded={filtersExpanded} aria-controls="moments-filters" onClick={() => setFiltersExpanded(value => !value)}>{filtersExpanded ? 'Hide filters' : hasBrowseFilters ? 'Filters · active' : 'Filters'}</button>
      <div id="moments-filters" className="moments-toolbar">
        <label>Find in results<input type="search" aria-label="Find loaded moments" placeholder="Creator or reaction" maxLength={200} value={browse.query} onChange={event => update({ q: event.target.value || null }, true)} /></label>
        {categories.length > 1 || category ? <div className="moments-filter-field"><span>Category</span><MomentSelect aria-label="Category" value={category} onValueChange={value => update({ category: value || null })}><option value="">All categories</option>{category && !categories.includes(category) ? <option>{category}</option> : null}{categories.map(value => <option key={value}>{value}</option>)}</MomentSelect></div> : null}
        {!historyMode ? <div className="moments-filter-field"><span>Order</span><MomentSelect aria-label="Sort loaded results" value={browse.order} onValueChange={value => update({ sort: value === 'newest' ? null : value })}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="category">Category A–Z</option></MomentSelect></div> : null}
        {hasBrowseFilters ? <button type="button" onClick={() => update({ category: null, q: null, sort: null })}>Clear filters</button> : null}
      </div>
    </> : null}
    {view === 'recent' && pendingRecent.length ? <button type="button" onClick={() => { setVisibleRecent(uniqueDiscoveryMoments([...presentedRecent, ...pendingRecent, ...recent]).slice(0, 200)); setPendingRecent([]) }}>Show {pendingRecent.length} new moments</button> : null}
    {historyMode && catalogueReady ? <details className="moments-storage-note"><summary>About these results</summary><p>The calendar counts activity across the selected month and creator. Search narrows loaded results; category fetches matching detections. Open a broadcast for its measured timeline and recap.</p></details> : null}
    {failure ? <section className="moments-notice" role="status"><h2>{historyMode ? 'History is temporarily unavailable' : 'Moments could not be refreshed'}</h2><p>{historyMode ? 'The activity calendar could not be loaded. This does not mean there are no broadcasts.' : failure}</p><button disabled={busy} onClick={historyMode ? catalogue.refresh : hub.refresh}>{busy ? 'Retrying…' : 'Retry'}</button>{historyMode && /^[a-z0-9_]{1,25}$/.test(historyScope.creator) ? <Link className="moments-back" to={`/analytics/${historyScope.creator}?${new URLSearchParams({ returnTo: location.pathname + location.search })}`}>View {historyScope.creator} broadcasts →</Link> : <Link className="moments-back" to="/analytics">Open live activity →</Link>}</section> : null}
    {feed?.banner && view === 'recent' ? <p role="status">{feed.banner}</p> : null}
    {historyMode && failure ? <Link className="moments-back" to="/analytics/moments?view=latest">Browse Latest moments</Link> : null}
    {historyMode && busy && !catalogueReady ? <p role="status">Loading broadcast history…</p> : null}
    <div className={`moments-layout${chosen ? ' has-selection' : ''}`} hidden={historyMode && !catalogueReady && !chosen}>
      <section ref={arrivalRoot} className="moments-results" aria-label="Moment results" aria-busy={busy}><h2 ref={resultsRef} tabIndex={-1}>{historyMode ? 'Broadcasts' : explore ? 'Top measured moments' : 'Moments'} <small>{busy && !filtered.length ? 'Loading…' : explore && !ranked.data ? '' : `${historyMode ? broadcasts.length : filtered.length} ${explore ? 'loaded' : 'shown'}`}</small></h2>
        {busy ? <p role="status">Loading measured activity…</p> : null}
        {busy && !filtered.length ? <MomentLoadingSkeleton /> : null}
        {explore ? !busy && !ranked.error && !rankedValidation && ranked.data && !filtered.length ? <p role="status">No ranked moments in this indexed selection. Change the period or category, or reset Explore.</p> : null : view === 'saved' && saved.items.length === 0 ? <div className="moments-empty-saved"><h3>Keep reactions worth returning to</h3><p>Save a moment to build your shortlist here.</p><button type="button" onClick={() => changeView('recent')}>Find moments to save</button></div> : !busy && !failure && !filtered.length ? <p>{historyMode ? 'No indexed broadcasts match this selection. Try another day or creator.' : 'No moments match these filters.'}</p> : null}
        {historyMode && !chosen ? <div className="moments-broadcast-grid">{broadcasts.map(group => <BroadcastCard key={`${group.login}:${group.streamId}`} group={group} />)}</div>
          : <div className="moments-result-list">{profiledResults.map(moment => {
            const rank = explore ? ranked.data?.items.find(item => item.key === moment.key) : undefined
            return <MomentRow key={moment.key} moment={moment} rank={rank?.rank} ranking={rank} selected={selected?.key === moment.key} artwork={resolveArtwork(moment)} onSelect={select} creator={<MomentCreator moment={moment} />}
              time={explore && moment.at ? <time className="moments-result-time" dateTime={new Date(moment.at).toISOString()}>{new Date(moment.at).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}</time> : undefined} />
          })}</div>}
        {explore && ranked.canLoad ? <button type="button" disabled={ranked.loading} onClick={ranked.loadMore}>Load more moments (50)</button> : null}
        {historyMode && catalogue.data?.nextCursor && !catalogue.limited ? <button type="button" disabled={catalogue.loading} onClick={catalogue.loadMore}>{catalogue.loading ? 'Loading…' : 'Load more history'}</button> : null}
        {historyMode && catalogue.limited ? <p role="status">Choose a day or creator to narrow these results.</p> : null}
      </section>
      {chosen ? <MomentDetail key={`${chosen.key}:${chosen.publicMomentId || ''}`} moment={chosen} onSourceState={onSourceState} onClose={close} saved={view === 'saved' && Boolean(selected)} navigation={loadedMomentNeighbors(filtered, chosen.key)} onNavigate={select}
        continuation={explore && ranked.data ? { loading: ranked.loading, canLoad: ranked.canLoad, limited: false, error: ranked.error, load: ranked.loadMore } : historyMode && catalogue.data && catalogue.data.state !== 'unavailable' ? { loading: catalogue.loading, canLoad: Boolean(catalogue.data.nextCursor), limited: catalogue.limited, error: catalogue.error, load: catalogue.loadMore } : undefined} /> : null}
    </div>
  </main></AnalyticsFigmaShell>
}
