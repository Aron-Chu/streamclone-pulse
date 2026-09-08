import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, ChartNoAxesCombined, Radio } from 'lucide-react'
import { usePublicHubRecentMoments } from '../../hooks/usePublicHubRecentMoments'
import { useNewsroomData } from '../../hooks/useNewsroomData'
import { useDiscoveryCatalogue } from '../../hooks/useDiscoveryCatalogue'
import { useMomentProfiles } from '../../hooks/useMomentProfiles'
import { useSavedMomentEvidence } from '../../hooks/useSavedMomentEvidence'
import { currentDiscoveryMonth } from '../../lib/discoveryCatalogue'
import { creatorHistoryHref } from '../../lib/creatorHistoryHref'
import { groupDiscoveryBroadcasts, readDiscoveryPresentation } from '../../lib/discoveryPresentation'
import { DiscoveryCalendar } from '../../ui/components/moments/DiscoveryCalendar'
import { mapHubPulseMoment } from '../../lib/figmaSessionAnalytics'
import { fromHubMoment, fromNewsroomUpdate, uniqueDiscoveryMoments, discoveryAnalyticsHref,
  checkMomentSource, type DiscoveryMoment, type CheckedMomentSource } from '../../lib/discoveryMoments'
import { configuredNewsroomWindows, type NewsroomWindow } from '../../lib/newsroom'
import { refreshSavedMoment, useSavedMoments } from '../../lib/savedDiscoveryMoments'
import { discoveryCatalogueEnabled } from '../../lib/discoveryCapability'
import { refreshedReplayforgeHandoffHref } from '../../lib/replayforgeHandoff'
import { watchMomentHref } from '../../lib/watchHandoff'
import { formatStreamOffset } from '../../lib/formatStreamOffset'
import { momentComparisonSummary } from '../../lib/momentComparison'
import { browseLoadedItems, browseRangeError, loadedMomentNeighbors, readMomentBrowse } from '../../lib/momentBrowse'
import { AnalyticsFigmaShell } from '../../ui/components/analytics/AnalyticsFigmaShell'
import { SaveMomentButton } from '../../ui/components/moments/SaveMomentButton'
import { MomentVodPreview } from '../../ui/components/moments/MomentVodPreview'
import { MomentCategoryBrowser, loadedCategories, CategoryArtwork, categoryPresentationArt } from '../../ui/components/moments/MomentCategoryBrowser'
import { useCategoryArtwork } from '../../lib/categoryArtwork'
import { MomentArchiveArtwork } from '../../ui/components/moments/MomentArchiveArtwork'
import { MomentReactionVisual } from '../../ui/components/moments/MomentReactionVisual'
import type { ArchiveArtwork } from '../../lib/archiveArtwork'
import { EmoteImg } from '../../ui/components/analytics/EmoteImg'
import { loadExactMomentRecap, mergeExactMomentRecap, momentNeedsExactRecap } from '../../lib/discoveryMomentRecap'
import { loadNewsroomProfiles, newsroomProfileUrl } from '../../lib/newsroomProfiles'
import { PulseSelect } from '../../ui/components/common/PulseSelect'
import '../../ui/components/analytics/figma-analytics.css'
import '../../ui/components/moments/moments-workspace.css'

const present = (value?: number) => value != null && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : 'Unavailable'
const valid = (moment: DiscoveryMoment | null): moment is DiscoveryMoment => moment !== null
const scrollPositions = new Map<string, number>()
const creatorReturnFocus = new Map<string, string>()
const reviewColumns = ['Creator', 'Category', 'Event time', 'Moment', 'Emotes', 'Source', 'Save'] as const
interface ReviewContinuation { loading: boolean; canLoad: boolean; limited: boolean; error: string | null; load: () => void }

function useCategoryTransition(category: string): number {
  const previousCategory = useRef(category)
  const [transitionCount, setTransitionCount] = useState(0)
  useLayoutEffect(() => {
    if (previousCategory.current === category) return
    previousCategory.current = category
    setTransitionCount(value => value + 1)
  }, [category])
  return transitionCount
}

export { mergeMomentTopEmotes } from '../../lib/discoveryMomentRecap'

function vodAlignmentSummary(moment: DiscoveryMoment, source: CheckedMomentSource | null): string | null {
  if (!source?.vodHref || source.vodOffsetSeconds == null) return null
  const difference = Math.round(source.vodOffsetSeconds - moment.offsetSeconds)
  if (!difference) return null
  return `Twitch archive timing maps the ${formatStreamOffset(moment.offsetSeconds)} detection to ${formatStreamOffset(source.vodOffsetSeconds)} playback (${Math.abs(difference)} ${Math.abs(difference) === 1 ? 'second' : 'seconds'} ${difference < 0 ? 'earlier' : 'later'}).`
}

function DetectionSummary({ moment, sourceState = 'Source unchecked', measurementShown = false }: { moment: DiscoveryMoment; sourceState?: string; measurementShown?: boolean }) {
  const comparison = momentComparisonSummary(moment.comparison, moment.reactionSignal)
  const hasChat = moment.chatPerMin != null && Number.isFinite(moment.chatPerMin)
  const hasEmotes = moment.emotesPerMin != null && Number.isFinite(moment.emotesPerMin)
  const hasEmoteCounts = Boolean(moment.topEmotes?.some(emote => emote.count != null && Number.isFinite(emote.count) && emote.count >= 0))
  return <div className="moments-result-evidence">
    {measurementShown ? null : !hasChat && !hasEmotes ? (
      <span className="moments-rates-unavailable">{hasEmoteCounts
        ? 'Exact emote counts shown above · aggregate minute rates not supplied'
        : 'Aggregate minute rates not supplied for this detection'}</span>
    ) : (
      <>
        {hasChat ? <span>{`${present(moment.chatPerMin)} chat/min`}</span> : null}
        {hasEmotes ? <span>{`${present(moment.emotesPerMin)} emotes/min`}</span> : null}
      </>
    )}
    {!measurementShown && comparison ? <span>{comparison}</span> : null}
    <span className="moments-source-tag">{sourceState === 'Source unchecked' ? 'Source not checked yet' : sourceState}</span>
  </div>
}

function MomentEmotes({ moment }: { moment: DiscoveryMoment }) {
  return moment.topEmotes?.length ? <div className="moments-row-emotes" aria-label="Measured emote reactions">
    {moment.topEmotes.slice(0, 4).map((emote, index) => <span key={`${emote.provider}:${emote.name}:${index}`} title={`${emote.name}${emote.count != null ? ` · ${present(emote.count)} uses` : ''}`}>
      <EmoteImg name={emote.name} src={emote.imageUrl} width={24} height={24} />
    </span>)}
  </div> : null
}

function MomentAvatar({ moment }: { moment: Pick<DiscoveryMoment, 'profileImageUrl' | 'displayName' | 'login'> }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [moment.profileImageUrl])
  // Use existing profile allowlist. Never turn arbitrary candidate strings into image requests.
  const safe = newsroomProfileUrl(moment.profileImageUrl)
  return safe && !failed ? <img className="moments-avatar" src={safe} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
    : <span className="moments-avatar" aria-hidden="true">{(moment.displayName || moment.login).slice(0, 1).toUpperCase()}</span>
}

function MomentCreator({ moment }: { moment: DiscoveryMoment }) {
  const location = useLocation()
  const href = creatorHistoryHref(moment.login, moment.at)
  const content = <><MomentAvatar moment={moment} /><span><strong>{moment.displayName || moment.login}</strong><small>{moment.category || 'Category unavailable'}</small></span></>
  return href ? <Link className="moments-creator-link" data-creator-key={moment.key} to={href} aria-label={`Browse ${moment.displayName || moment.login} history`} onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    creatorReturnFocus.set(location.key, moment.key)
    if (creatorReturnFocus.size > 40) creatorReturnFocus.delete(creatorReturnFocus.keys().next().value!)
   }}>{content}</Link>
    : <div className="moments-creator-link">{content}</div>
}

function MomentDetail({ moment: suppliedMoment, onClose, saved, onSourceState, navigation, onNavigate, continuation }: { moment: DiscoveryMoment; onClose: () => void; saved: boolean; onSourceState: (key: string, state: string, artwork?: ArchiveArtwork) => void; navigation: ReturnType<typeof loadedMomentNeighbors<DiscoveryMoment>>; onNavigate: (moment: DiscoveryMoment) => void; continuation?: ReviewContinuation }) {
  const [recap, setRecap] = useState<Partial<DiscoveryMoment> | null>(null)
  const [profileImageUrl, setProfileImageUrl] = useState<string>()
  const [evidenceState, setEvidenceState] = useState('')
  const [evidenceAttempt, setEvidenceAttempt] = useState(0)
  const needsEvidence = momentNeedsExactRecap(suppliedMoment)
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
  const moment = {
    ...mergeExactMomentRecap(suppliedMoment, needsEvidence ? recap : null),
    profileImageUrl: newsroomProfileUrl(suppliedMoment.profileImageUrl) || profileImageUrl,
  }
  const [source, setSource] = useState<CheckedMomentSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    // Warm only the official player origin while a review is open. Source
    // verification still decides whether an iframe may be mounted.
    const selector = 'link[rel="preconnect"][href="https://player.twitch.tv"]'
    if (document.head.querySelector(selector)) return
    const link = document.createElement('link')
    link.rel = 'preconnect'
    link.href = 'https://player.twitch.tv'
    link.crossOrigin = 'anonymous'
    link.dataset.momentsPreviewPreconnect = 'true'
    document.head.append(link)
    return () => link.remove()
  }, [])
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    heading.current?.closest('section')?.scrollIntoView({ block: 'start' })
  }, [moment.key])
  useEffect(() => {
    const controller = new AbortController()
    let expiry: ReturnType<typeof setTimeout> | undefined
    setSource(null); setLoading(true); setError('')
    onSourceState(moment.key, 'Checking source')
    void checkMomentSource(moment, controller.signal, true).then(result => {
      if (controller.signal.aborted) return
      setSource(result)
      onSourceState(moment.key, result.vodHref ? 'VOD mapping checked · playback unchecked' : 'No replay mapping confirmed', result.vodHref ? result.archiveArtwork : undefined)
      // Confirmed presence is transient; a source check is never a permanent LIVE badge.
      if (result.liveExpiresAt) expiry = setTimeout(() => setSource(current => current ? { ...current, liveHref: null } : null), Math.max(0, result.liveExpiresAt - Date.now()))
    }).catch(() => { if (!controller.signal.aborted) { setError('Could not check this source. Retry or open its exact analytics session.'); onSourceState(moment.key, 'Source check failed') } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); if (expiry) clearTimeout(expiry) }
  }, [moment.key, attempt, onSourceState, saved])
  const handoff = refreshedReplayforgeHandoffHref(source)
  const watchHref = watchMomentHref(moment, source)
  const comparison = moment.comparison
  const hasExactEmoteCounts = Boolean(moment.topEmotes?.some(emote => emote.count != null && Number.isFinite(emote.count) && emote.count >= 0))
  const alignmentSummary = vodAlignmentSummary(moment, source)
  const sourceStatus = loading ? 'checking' : error ? 'failed' : source?.vodHref ? 'mapped' : 'unavailable'
  const sourceContent = <div className="moments-source-state" data-source-state={sourceStatus} aria-live="polite">
    <strong>{loading ? 'Checking source…' : error ? 'Source check failed' : source?.vodHref ? 'VOD mapping checked · playback unchecked' : 'No replay link confirmed'}</strong>
    <p>{error || source?.reason || 'Checking the selected stream, not another broadcast.'}</p>
    <div className="moments-actions moments-source-actions">
      {source?.liveHref ? <a href={source.liveHref} target="_blank" rel="noopener noreferrer">Watch live now ↗</a> : null}
      {watchHref ? <a href={watchHref} target="_blank" rel="noopener noreferrer">Review in Streamclone ↗</a> : null}
      {!loading ? <button type="button" onClick={() => setAttempt(value => value + 1)}>Recheck source</button> : null}
    </div>
    {source?.liveHref ? <small>Live playback does not replay this detection.</small> : null}
    {watchHref ? <small>Opens this archive and timestamp in the watch app. Clipping requires a separate permission check and confirmation there.</small> : null}
  </div>
  useEffect(() => {
    if (!saved) return
    refreshSavedMoment({ ...moment, at: moment.at ?? source?.occurrenceAt,
      displayName: moment.displayName ?? source?.displayName, category: moment.category ?? source?.category })
  }, [saved, moment.key, moment.at, moment.label, moment.chatPerMin, moment.emotesPerMin, moment.comparison,
    moment.reactionSignal, moment.topEmotes, moment.revision, moment.displayName, moment.category,
    source?.occurrenceAt, source?.displayName, source?.category])
  return <section className="moments-detail" aria-label="Selected moment" onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
    <div className="moments-review-topbar">
    <button type="button" className="moments-back" onClick={onClose}><ArrowLeft size={16} aria-hidden="true" /> Back to results</button>
    <nav className="moments-review-navigation" aria-label="Review loaded moments">
      <span>{navigation.position == null ? 'Selection outside loaded matches' : `${navigation.position} of ${navigation.total} loaded matches`}</span>
      <div><button type="button" aria-label="Previous moment" title="Previous moment" disabled={!navigation.previous} onClick={() => { if (navigation.previous) onNavigate(navigation.previous) }}><ChevronLeft size={18} aria-hidden="true" /></button>
      <button type="button" aria-label="Next moment" title="Next moment" disabled={!navigation.next} onClick={() => { if (navigation.next) onNavigate(navigation.next) }}><ChevronRight size={18} aria-hidden="true" /></button></div>
    </nav>
    </div>
    <header className="moments-review-heading">
      <h2 ref={heading} tabIndex={-1}>{moment.label}</h2>
    </header>
    {source?.vodHref ? <MomentVodPreview key={source.vodHref} href={source.vodHref} artwork={source.archiveArtwork} /> : null}
    <div className="moments-identity"><MomentAvatar moment={moment} /><div><strong>{moment.displayName || moment.login}</strong><div className="moments-muted">{moment.category || 'Selected broadcast'}</div><small className="moments-muted">{moment.at || source?.occurrenceAt ? new Date(moment.at ?? source!.occurrenceAt!).toLocaleString() : 'Occurrence time unavailable'}</small></div><span className="moments-detail-offset"><strong>{formatStreamOffset(moment.offsetSeconds)}</strong><small>into broadcast</small></span></div>
    {!source?.vodHref ? sourceContent : null}
    {alignmentSummary ? <p className="moments-source-alignment">{alignmentSummary}</p> : null}
    <section className="moments-measurement" aria-label="Moment measurement">
      <div className="moments-measurement-heading"><h3>What happened in chat</h3>{momentComparisonSummary(moment.comparison, moment.reactionSignal) ? <span>{momentComparisonSummary(moment.comparison, moment.reactionSignal)}</span> : null}</div>
      {moment.chatPerMin == null && moment.emotesPerMin == null ? (
        <p className="moments-muted">{hasExactEmoteCounts
          ? 'Aggregate chat and emote rates were not supplied for this archived detection. Exact per-emote counts are shown below.'
          : 'Aggregate chat and emote rates were not supplied for this archived detection.'}</p>
      ) : (
        <dl><div><dt>Chat / min</dt><dd>{present(moment.chatPerMin)}</dd></div><div><dt>Emotes / min</dt><dd>{present(moment.emotesPerMin)}</dd></div><div><dt>Detection window</dt><dd>1 minute</dd></div></dl>
      )}
    </section>
    {moment.topEmotes?.length ? <section className="moments-reactions" aria-label="Selected moment reactions"><h3>Reactions in this moment</h3>
      <ul>{moment.topEmotes.slice(0, 5).map((emote, index) => <li key={`${emote.provider || ''}:${emote.name}:${index}`}>
        <EmoteImg name={emote.name} src={emote.imageUrl} width={28} height={28} hideFallbackText />
        <span><span>{emote.name}</span><small>{emote.provider === 'seventv' ? '7TV' : emote.provider || 'Provider not supplied'}</small></span>
        <strong>{emote.count != null && Number.isFinite(emote.count) && emote.count >= 0 ? `${present(emote.count)} uses` : 'Count unavailable'}</strong>
      </li>)}</ul>
    </section> : null}
    <div className="moments-actions moments-primary-actions">
      <Link className="moments-analytics-action" to={discoveryAnalyticsHref(moment)}><ChartNoAxesCombined size={16} aria-hidden="true" /> Inspect {formatStreamOffset(moment.offsetSeconds)} in Analytics</Link>
      <SaveMomentButton moment={moment} longLabel />
      {handoff ? <a href={handoff} target="_blank" rel="noopener noreferrer">Prepare clip in ReplayForge ↗</a> : null}
    </div>
    {evidenceState ? <p className="moments-muted moments-evidence-status" role="status">{evidenceState}{!evidenceState.startsWith('Loading') ? <> <button type="button" onClick={() => setEvidenceAttempt(value => value + 1)}>Retry reaction details</button></> : null}</p> : null}
    {source?.vodHref ? <details className="moments-source"><summary>Source & playback details</summary>{sourceContent}</details> : null}
    {handoff ? <p className="moments-muted">ReplayForge requires sign-in and source permission. Opening it does not create a job.</p> : null}
    <details className="moments-evidence"><summary>Measured evidence</summary>
      {saved ? <p>Saved metadata is historical. Source links are checked again when opened here.</p> : null}
      <dl><dt>Chat</dt><dd>{moment.chatPerMin != null ? `${present(moment.chatPerMin)} /min` : 'Unavailable'}</dd><dt>Emotes</dt><dd>{moment.emotesPerMin != null ? `${present(moment.emotesPerMin)} /min` : 'Unavailable'}</dd>
        <dt>Baseline measured</dt><dd>{comparison ? `${comparison.evidence.baselineMeasuredMinutes}/${comparison.evidence.baselineExpectedMinutes} minutes` : 'Unavailable'}</dd>
        <dt>Source stream</dt><dd>{moment.streamId}</dd><dt>Public moment</dt><dd>{moment.publicMomentId || 'Not supplied'}</dd></dl>
      <p>Reaction measurements are not editorial quality ratings.</p>
    </details>
    {continuation ? <section className="moments-review-continuation" aria-label="Continue reviewing collection">
      <button type="button" disabled={continuation.loading || !continuation.canLoad || continuation.limited} onClick={continuation.load}>{continuation.loading ? 'Loading more moments…' : continuation.limited ? 'Page limit reached' : continuation.canLoad ? 'Load more moments into review' : 'All supplied moments loaded'}</button>
      <p className="moments-muted">{continuation.limited ? '1,000 results loaded. Return to results and choose a day or creator to narrow this collection.' : continuation.canLoad ? 'Adds results in your current sort order. Your selection stays; filters still apply.' : 'This is the supplied collection, not proof that every reaction was detected.'}</p>
      {continuation.error ? <p role="status">{continuation.error}</p> : null}
    </section> : null}
  </section>
}

export default function AnalyticsMomentsPage() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const historyEnabled = discoveryCatalogueEnabled()
  const view = ['sessions', 'saved'].includes(params.get('view') || '') ? params.get('view')! : 'recent'
  const historyMode = view === 'recent' && params.get('collection') === 'history'
  const recentFeed = view === 'recent' && !historyMode
  const browse = readMomentBrowse(params)
  if (view === 'sessions' && !params.get('story') && !['newest', 'oldest', 'category'].includes(browse.order)) browse.order = 'newest'
  const historyScope = { month: params.get('month') || currentDiscoveryMonth(), creator: params.get('creator') || '', day: params.get('day') || '', category: browse.category }
  const presentation = readDiscoveryPresentation(params, historyScope.month)
  const catalogue = useDiscoveryCatalogue(historyEnabled && historyMode && (presentation.mode === 'month' || Boolean(historyScope.day)), historyScope)
  const historyUnavailable = !historyEnabled || catalogue.unsupported
  const catalogueReady = Boolean(!historyUnavailable && catalogue.data && catalogue.data.state !== 'unavailable')
  const range: NewsroomWindow = params.get('window') === '24h' ? '24h' : params.get('window') === '7d' ? '7d' : 'live'
  const storyId = params.get('story') || undefined
  const { category } = browse
  const rangeError = browseRangeError(browse)
  const offset = params.has('offset') ? Number(params.get('offset')) : NaN
  const requested = params.has('offset') && params.has('stream') && params.has('login')
  const saved = useSavedMoments()
  const [sourceStates, setSourceStates] = useState<Record<string, string>>({})
  const [checkedArtwork, setCheckedArtwork] = useState<Record<string, ArchiveArtwork>>({})
  const onSourceState = useCallback((key: string, state: string, artwork?: ArchiveArtwork) => {
    setSourceStates(previous => Object.fromEntries([...Object.entries(previous).filter(([id]) => id !== key).slice(-199), [key, state]]))
    // Exact detection key, in-memory only. Rechecking clears any earlier artwork;
    // a thumbnail never grants playback permission or replaces source revalidation.
    setCheckedArtwork(previous => Object.fromEntries([...Object.entries(previous).filter(([id]) => id !== key).slice(-199), ...(artwork ? [[key, artwork] as const] : [])]))
  }, [])
  const recentHub = usePublicHubRecentMoments({ enabled: view === 'recent' && !historyMode })
  const index = useNewsroomData({ enabled: view === 'sessions' && !storyId && configuredNewsroomWindows().has(range), window: range, enrichProfiles: true })
  const detail = useNewsroomData({ enabled: view === 'sessions' && Boolean(storyId), storyId, pollMs: 0, enrichProfiles: true })
  const feed = useMemo(() => recentHub.data ? recentHub.data.moments.map(mapHubPulseMoment) : [], [recentHub.data])
  const recentArtwork = useMemo(() => new Map((recentHub.data?.moments ?? []).flatMap(moment => {
    const adapted = fromHubMoment(moment)
    return adapted?.archiveArtwork ? [[adapted.key, adapted.archiveArtwork] as const] : []
  })), [recentHub.data?.moments])
  const recent = useMemo(() => uniqueDiscoveryMoments(feed.map(fromHubMoment).filter(valid)), [feed])
  const [visibleRecent, setVisibleRecent] = useState<DiscoveryMoment[]>([])
  const [pendingRecent, setPendingRecent] = useState<DiscoveryMoment[]>([])
  // Cache hydration can supply a complete feed one render before the effect
  // commits it to the review-stable queue. Present that first snapshot directly
  // so the page never announces an empty collection it already has.
  const presentedRecent = visibleRecent.length || !recent.length ? visibleRecent : recent.slice(0, 200)
  const visibleRecentRef = useRef(visibleRecent)
  visibleRecentRef.current = visibleRecent
  useEffect(() => {
    if (view !== 'recent' || historyMode || !recentHub.data) return
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
  }, [historyMode, recentHub.data, recent, requested, view])
  const sessionMoments = useMemo(() => detail.data?.story
    ? uniqueDiscoveryMoments((detail.data.updates ?? [detail.data.story.leadUpdate])
      .map(update => fromNewsroomUpdate(detail.data!.story!, update)).filter(valid)) : [], [detail.data])
  const collection = view === 'saved' ? saved.items : view === 'sessions' ? sessionMoments : historyMode ? catalogue.data?.items ?? [] : presentedRecent
  const catalogueArtwork = useMemo(() => new Map((catalogue.data?.items ?? []).flatMap(moment =>
    moment.archiveArtwork ? [[moment.key, moment.archiveArtwork] as const] : [])), [catalogue.data?.items])
  const sessionIndex = view === 'sessions' && !storyId
  const stories = index.data?.stories ?? []
  const now = Date.now()
  const filtered = browseLoadedItems(collection, browse, moment => ({ key: moment.key, at: moment.at, category: moment.category,
    chatPerMin: moment.chatPerMin, emotesPerMin: moment.emotesPerMin,
    chatIncrease: moment.comparison?.chat.state === 'ready' ? moment.comparison.chat.absoluteDeltaPerMin : undefined,
    emoteIncrease: moment.comparison?.emotes.state === 'ready' ? moment.comparison.emotes.absoluteDeltaPerMin : undefined,
    text: `${moment.displayName || moment.login} ${moment.login} ${moment.category || ''} ${moment.label}` }), now)
  const categoryItems = browseLoadedItems(collection, { ...browse, category: '' }, moment => ({ key: moment.key, at: moment.at, category: moment.category,
    text: `${moment.displayName || moment.login} ${moment.login} ${moment.category || ''} ${moment.label}` }), now)
  const categoryGroups = loadedCategories(collection)
  const categoryResolutions = useCategoryArtwork(categoryGroups.filter(group => !group.rejected && !group.boxArtUrl)
    .map(({ categoryId, name }) => categoryId ? { categoryId } : { name }))
  // Index lead timestamps/categories describe the supplied summary only, not every update.
  const filteredStories = browseLoadedItems(stories, browse, story => ({ key: story.id, category: story.category,
    at: new Date(story.leadUpdate.momentRef.occurrenceAt).getTime(), text: `${story.displayName || story.login} ${story.login} ${story.category || ''} ${story.headline}` }), now)
  const categories = [...new Set((sessionIndex ? stories : collection).map(moment => moment.category).filter((value): value is string => Boolean(value)))].sort()
  const selected = collection.find(moment => moment.login === params.get('login') && moment.streamId === params.get('stream') && moment.offsetSeconds === offset
    && (!params.get('moment') || moment.publicMomentId === params.get('moment')))
  const selectionSeed = requested ? fromHubMoment({ login: params.get('login') || '', streamId: params.get('stream') || '',
    offsetSeconds: offset, publicMomentId: params.get('moment') || undefined, label: 'Selected reaction' }) : null
  const evidenceResults = useSavedMomentEvidence(filtered, view === 'saved')
  const savedEvidence = view === 'saved' && selected ? evidenceResults.find(moment =>
    moment.key === selected.key && moment.publicMomentId === selected.publicMomentId
    && moment.revision === selected.revision) : undefined
  const chosen = savedEvidence ?? selected ?? selectionSeed
  // Keep the list subscribed while review opens so both share in-flight
  // identity reads and the completed result can populate the profile cache.
  const profiledResults = useMomentProfiles(evidenceResults)
  const broadcastGroups = historyMode ? groupDiscoveryBroadcasts(profiledResults) : null
  const visibleQueue = broadcastGroups ? broadcastGroups.flatMap(group => group.items) : profiledResults
  const busy = historyMode ? catalogue.loading : view === 'recent' ? recentHub.loading : view === 'sessions' ? (storyId ? detail.loading : index.loading) : false
  const failure = historyMode ? historyUnavailable ? null : catalogue.error : view === 'recent' ? recentHub.error : view === 'sessions' ? (storyId ? detail.error : index.error) : null
  const unsupported = view === 'sessions' && !configuredNewsroomWindows().has(range)
  const resultsRef = useRef<HTMLHeadingElement>(null)
  const lastSelectedKey = useRef<string | null>(null)
  const categoryTransition = useCategoryTransition(category)
  useEffect(() => {
    // A review opened from Live Wire or a shared URL did not call select() here.
    // It still needs the same return-focus target once results have loaded.
    if (chosen) lastSelectedKey.current = chosen.key
  }, [chosen?.key])
  const previousNavigation = useRef({ requested, storyId })
  function update(values: Record<string, string | null>, replace = requested, state = location.state) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(values)) value == null ? next.delete(key) : next.set(key, value)
    const nextState = state && typeof state === 'object' ? { ...state } : {}
    if (!next.has('offset')) delete nextState.momentsReviewOrigin
    setParams(next, { replace, state: nextState })
  }
  function select(moment: DiscoveryMoment) {
    lastSelectedKey.current = moment.key
    update({ login: moment.login, stream: moment.streamId, offset: String(moment.offsetSeconds), moment: moment.publicMomentId ?? null }, requested,
      requested ? location.state : { ...location.state, momentsReviewOrigin: location.key })
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
    const key = creatorReturnFocus.get(location.key)
    if (!key || requested) return
    const frame = requestAnimationFrame(() => {
      const target = [...document.querySelectorAll<HTMLAnchorElement>('[data-creator-key]')].find(link => link.dataset.creatorKey === key)
      if (target) { target.focus({ preventScroll: true }); creatorReturnFocus.delete(location.key) }
    })
    return () => cancelAnimationFrame(frame)
  }, [location.key, requested, filtered.length])
  useEffect(() => {
    const previous = previousNavigation.current
    previousNavigation.current = { requested, storyId }
    if ((previous.requested && !requested) || (previous.storyId && !storyId)) {
      requestAnimationFrame(() => {
        const selector = previous.storyId && !storyId ? '[data-story-id]' : '[data-discovery-key]'
        const target = [...document.querySelectorAll<HTMLButtonElement>(selector)].find(button =>
          selector === '[data-story-id]' ? button.dataset.storyId === previous.storyId : button.dataset.discoveryKey === lastSelectedKey.current)
        if (target) target.focus({ preventScroll: true }); else resultsRef.current?.focus({ preventScroll: true })
      })
    }
  }, [requested, storyId])
  const resetSelection = { login: null, stream: null, offset: null, moment: null, story: null }
  function switchCollection(target: 'recent' | 'history' | 'sessions' | 'saved') {
    update({ ...resetSelection, view: target === 'history' ? 'recent' : target,
      collection: target === 'history' ? 'history' : null,
      month: null, creator: null, day: null, calendar: null, year: null, years: null, measure: null,
      category: null, q: null, occurred: null, from: null, to: null, sort: null }, false)
  }
  const hasBrowseFilters = Boolean(category || browse.query || browse.period !== 'all' || browse.order !== 'newest' || browse.from || browse.to)
  return <AnalyticsFigmaShell hideSidebar><main id="analytics-main" className={`moments-workspace moments-workspace--dense${chosen ? ' is-reviewing' : ''}${historyMode ? ' is-history' : ''}`} tabIndex={-1}>
    <header className="moments-heading"><h1>{chosen ? 'Review workspace' : 'Moments'}</h1><Link to="/analytics">← Analytics</Link></header>
    <div className="moments-browse-heading"><nav className="moments-tabs" data-view={historyMode ? 'history' : view} aria-label="Moment views">{!historyMode ? <span className="moments-tab-indicator" aria-hidden="true" /> : null}{(['recent', 'sessions', 'saved'] as const).map(tab => <button type="button" key={tab} aria-pressed={!historyMode && view === tab} onClick={() => switchCollection(tab)}>{tab === 'saved' ? `Saved (${saved.items.length})` : tab === 'recent' ? 'Recent' : 'Sessions'}</button>)}</nav>
    <button type="button" aria-pressed={historyMode} onClick={() => switchCollection('history')}>Stored history</button></div>
    <details className="moments-collection-scope"><summary>{view === 'saved' ? 'On this device · not synced' : view === 'sessions' ? 'Loaded broadcast detections' : historyMode ? 'Indexed history · UTC · partial coverage' : 'Loaded snapshot · not complete history'}</summary><p className="moments-muted">{view === 'saved' ? 'Bookmarks stay in this browser profile for this site. They do not preserve video or sync with the extension.' : view === 'sessions' ? 'Review related detections by exact broadcast. Session detail loads only when selected.' : historyMode ? 'Stored detections across indexed streams · browse by UTC day and creator' : 'Only detections returned by the recent feed. Filters do not load missing days; this snapshot cannot populate a year heatmap.'}</p></details>
    {!historyMode && view === 'recent' ? <p className="moments-history-entry"><button type="button" onClick={() => switchCollection('history')}>Creator heatmap</button>{!historyEnabled ? ' · unavailable in this portal' : ''}</p> : null}
    {saved.warning ? <p role="status" className="moments-notice">{saved.warning}</p> : null}
    {historyMode && historyUnavailable ? <section className="moments-capability-notice" aria-labelledby="stored-history-unavailable"><h2 id="stored-history-unavailable">Stored history is not available yet</h2>{historyScope.creator ? <h3>@{historyScope.creator} · {presentation.year} heatmap unavailable</h3> : null}<p>{historyEnabled ? 'The connected server does not expose the indexed day catalogue.' : 'Stored history is not enabled in this portal. No history data is requested.'}</p><p>The creator history heatmap requires indexed activity from the connected API. Unavailable history is not zero activity. Recent moments, saved items and exact stream analytics remain separate from stored history.</p><button type="button" onClick={() => switchCollection('recent')}>Return to recent moments</button></section> : null}
    {historyMode && chosen ? <nav className="moments-history-return" aria-label="Creator day return context"><button type="button" onClick={close}><ArrowLeft size={16} aria-hidden="true" /> Return to {historyScope.day || historyScope.month}</button><span>{historyScope.creator ? `@${historyScope.creator}` : 'Indexed creators'} · UTC</span></nav> : null}
    {historyMode && !historyUnavailable ? <div className="moments-calendar-context" hidden={Boolean(chosen)}><DiscoveryCalendar scope={historyScope} data={catalogue.data} loading={catalogue.loading} presentation={presentation}
      onPresentationChange={values => update({ ...('calendar' in values || 'year' in values ? resetSelection : {}), ...('year' in values ? { day: null } : {}), ...values })}
      onChange={values => update({ ...resetSelection, ...values, occurred: null, q: null, sort: null })}
      onRecent={() => switchCollection('recent')} /></div> : null}
    <div className="moments-toolbar" hidden={historyMode && !catalogueReady}>
      {view === 'sessions' ? <label>Range
        <PulseSelect
          ariaLabel="Range"
          triggerAriaLabel="Review range"
          value={range}
          onChange={val => update({ ...resetSelection, window: val })}
          options={([
            { value: 'live', label: 'Recent sessions', disabled: !configuredNewsroomWindows().has('live') },
            { value: '24h', label: '24h', disabled: !configuredNewsroomWindows().has('24h') },
            { value: '7d', label: '7d', disabled: !configuredNewsroomWindows().has('7d') },
          ] as const)}
        />
      </label> : null}
      <label>Find <input type="search" aria-label="Find loaded moments" placeholder="Creator, category, reaction" maxLength={200} value={browse.query} onChange={event => update({ q: event.target.value || null }, true)} /></label>
      {sessionIndex ? <label>Category
        <PulseSelect
          ariaLabel="Category"
          triggerAriaLabel="Filter category"
          value={category || ''}
          onChange={val => update({ category: val || null })}
          options={[
            { value: '', label: 'All loaded categories' },
            ...(category && !categories.includes(category) ? [{ value: category, label: category }] : []),
            ...categories.map(value => ({ value, label: value })),
          ]}
        />
      </label> : null}
      <label>Occurred
        <PulseSelect
          ariaLabel="Occurrence window"
          triggerAriaLabel="Occurrence time window"
          value={browse.period}
          onChange={val => update({ occurred: val === 'all' ? null : val })}
          options={[
            { value: 'all', label: 'Any loaded time' },
            { value: '30m', label: 'Last 30 minutes' },
            { value: '24h', label: 'Last 24 hours' },
            { value: '7d', label: 'Last 7 days' },
            { value: 'custom', label: 'Custom dates (UTC)' },
          ]}
        />
      </label>
      <label>Sort
        <PulseSelect
          ariaLabel="Sort loaded results"
          triggerAriaLabel="Result sort order"
          value={browse.order}
          onChange={val => update({ sort: val === 'newest' ? null : val })}
          options={[
            { value: 'newest', label: 'Newest first' },
            { value: 'oldest', label: 'Oldest first' },
            { value: 'category', label: 'Category A–Z' },
            ...(!sessionIndex ? [
              { value: 'emotesPerMin', label: 'Highest emotes/min' },
              { value: 'chatPerMin', label: 'Highest chat/min' },
              { value: 'emoteIncrease', label: 'Largest emote increase/min' },
              { value: 'chatIncrease', label: 'Largest chat increase/min' },
            ] : []),
          ]}
        />
      </label>
      {hasBrowseFilters ? <button type="button" onClick={() => update({ category: null, q: null, occurred: null, sort: null, from: null, to: null })}>Clear filters</button> : null}
      {view === 'recent' && !historyMode && pendingRecent.length ? <button type="button" onClick={() => { setVisibleRecent(uniqueDiscoveryMoments([...presentedRecent, ...pendingRecent, ...recent]).slice(0, 200)); setPendingRecent([]) }}>Show {pendingRecent.length} new {pendingRecent.length === 1 ? 'moment' : 'moments'}</button> : null}
    </div>
    {browse.period === 'custom' ? <div className="moments-date-range"><label>From (UTC) <input type="date" aria-label="From date UTC" value={browse.from} onChange={event => update({ from: event.target.value || null }, true)} /></label><label>Through (UTC) <input type="date" aria-label="Through date UTC" value={browse.to} onChange={event => update({ to: event.target.value || null }, true)} /></label></div> : null}
    {rangeError ? <p role="status" className="moments-notice">{rangeError}</p> : null}
    {view === 'recent' && !historyMode && browse.period === '7d' ? <p className="moments-notice" role="status">
      Last 7 days filters the recent snapshot; it does not load seven days of detections.
      {configuredNewsroomWindows().has('7d') ? <> <button type="button" onClick={() => update({ ...resetSelection, view: 'sessions', window: '7d', occurred: null, category: null, q: null, sort: null, from: null, to: null }, false)}>Browse 7-day sessions</button></>
        : ' Seven-day session history is not enabled in this portal.'}
    </p> : null}
    {!sessionIndex && (!historyMode || catalogueReady) ? <MomentCategoryBrowser items={categoryItems} resolutions={categoryResolutions} selected={category} onSelect={value => update({ category: value || null })} /> : null}
    {!sessionIndex && (browse.order === 'emoteIncrease' || browse.order === 'chatIncrease') ? <p className="moments-muted">Absolute increase over this stream's measured average before the event, not a watchability score. Long quiet periods can inflate the increase. Incomplete comparisons sort last.</p> : null}
    {(view !== 'recent' || historyMode) && (!historyMode || catalogueReady) ? <details className="moments-muted moments-filter-note"><summary>{sessionIndex ? 'Filters use summary-detection timestamps/categories' : 'Loaded-result filter scope'}</summary><p>Filters apply to loaded results{sessionIndex ? ', not every moment in a session' : ''}. {historyMode ? 'Month, day, creator and category fetch matching stored results. Calendar totals remain month-and-creator scoped; search, occurrence and sort only narrow loaded results.' : 'Selecting an occurrence window does not fetch missing history.'}</p></details> : null}
    {unsupported ? <p role="status">{range} session history is not enabled in this deployment. <button type="button" onClick={() => update({ window: 'live', ...resetSelection })}>Show recent sessions</button></p> : null}
    {failure ? <p className="moments-notice" role="status">{failure} {collection.length ? 'Previously loaded results may be stale.' : ''} <button type="button" onClick={historyMode ? catalogue.refresh : view === 'recent' ? recentHub.refresh : storyId ? detail.refresh : index.refresh}>Retry</button></p> : null}
    {view === 'recent' && !historyMode && recentHub.data && recentHub.data.status !== 'ready' && !recentHub.data.moments.length
      ? <p role="status">No measured recent detections are available from the loaded feed. This is not proof that tracked streams were inactive.</p> : null}
    {view === 'sessions' && (detail.data?.status === 'stale' || index.data?.status === 'stale') ? <p role="status">Session data is stale. Last supplied data through {detail.data?.dataThrough || index.data?.dataThrough}.</p> : null}
    <div className={`moments-layout${chosen ? ' has-selection' : ''}`} hidden={historyMode && !catalogueReady && !chosen}>
      <section className="moments-results" aria-label="Moment results">
        <div className="moments-results-heading">
          <h2 ref={resultsRef} tabIndex={-1}>{sessionIndex ? 'Sessions' : historyMode && historyScope.day ? `${historyScope.day} · UTC` : view === 'recent' && !historyMode ? 'Recent detections' : 'Detections'} <small>{sessionIndex ? filteredStories.length : filtered.length} {sessionIndex ? 'shown' : 'loaded'}</small></h2>
          {view === 'recent' && !historyMode ? <button type="button" className="moments-refresh" disabled={recentHub.loading || recentHub.refreshing} onClick={recentHub.refresh}>{recentHub.refreshing ? 'Refreshing…' : 'Refresh feed'}</button> : null}
        </div>
        {view === 'recent' && !historyMode && recentHub.data ? <details className="moments-feed-scope"><summary>
          {filtered.length === collection.length ? `${collection.length} recent ${collection.length === 1 ? 'detection' : 'detections'} loaded` : `${filtered.length} of ${collection.length} loaded detections match these filters`}
          {' · '}{{newest: 'newest first', oldest: 'oldest first', category: 'category A–Z', chatPerMin: 'highest chat/min', emotesPerMin: 'highest emotes/min', chatIncrease: 'largest chat increase/min', emoteIncrease: 'largest emote increase/min'}[browse.order]}
          {recentHub.data.hasMore ? ' · more outside snapshot' : ''}</summary><p>bounded to {recentHub.data.limit} at a time. Sorting and filters apply only to this loaded snapshot, not missing history.</p>
        </details> : null}
        {busy ? <p role="status">Loading measured moments…</p> : null}
{view === 'sessions' && !unsupported ? <div className="moments-session-index">{storyId ? <button type="button" className="moments-session-back" onClick={() => update(resetSelection)}><ArrowLeft size={16} aria-hidden="true" /> All sessions</button> : filteredStories.map(story => <button className="moments-session" type="button" key={story.id} data-story-id={story.id} onClick={() => update({ ...resetSelection, story: story.id })}><span className="moments-identity"><MomentAvatar moment={story} /><span><strong>{story.displayName || story.login}</strong><small>{story.category || 'Category unavailable'}</small></span></span><span className="moments-session-broadcast"><Radio size={16} aria-hidden="true" /><span>Broadcast <strong>{story.streamId}</strong></span></span><span><small>Summary detection</small><time>{new Date(story.leadUpdate.momentRef.occurrenceAt).toLocaleString()}</time></span><span className="moments-session-open">Open session detections <ArrowRight size={16} aria-hidden="true" /></span></button>)}
          {!storyId && index.data?.nextCursor ? <button type="button" disabled={index.loadingMore} onClick={index.loadMore}>{index.loadingMore ? 'Loading…' : 'Load more sessions'}</button> : null}
        </div> : null}
        {!busy && !failure && !unsupported && (!historyMode || catalogueReady) && !filtered.length && (view !== 'sessions' || storyId) ? <p>{historyMode ? 'No indexed detections match this selection. Missing measurements are not proof of a quiet stream.' : `No ${category ? 'matching loaded' : 'available'} moments.`}{view === 'saved' ? ' Save a moment from Recent or Sessions to start your shortlist.' : ''}</p> : null}
        {!busy && sessionIndex && !unsupported && !filteredStories.length ? <p>{stories.length ? 'No session summaries match these loaded-result filters.' : 'No session summaries available.'}</p> : null}
        {broadcastGroups ? <details className="moments-broadcast-scope"><summary>{broadcastGroups.length} loaded broadcasts · matching detections only</summary><p>Groups follow the first match in the selected sort; detections within each broadcast use the same sort. Reaction sorts order broadcasts by their highest matching loaded detection, not an aggregate broadcast score. Counts include loaded matches only.</p></details> : null}
        <div
          key={`${category || 'all'}:${categoryTransition}`}
          className={`${broadcastGroups ? 'moments-broadcast-list' : recentFeed ? 'moments-recent-feed' : 'moments-result-list'}${categoryTransition ? ' is-category-transitioning' : ''}`}
          data-category-transition={categoryTransition ? 'true' : undefined}
        >{broadcastGroups ? broadcastGroups.map(group => <section className="moments-broadcast-group" key={group.key} data-broadcast-key={group.key} aria-label={`Broadcast ${group.streamId} by @${group.login}`}>
          <header className="moments-broadcast-heading"><h3><span>{group.items[0].displayName || `@${group.login}`}</span> <small className="moments-broadcast-id">Broadcast {group.streamId}</small></h3><p className="moments-broadcast-count">{group.items.length} loaded matching {group.items.length === 1 ? 'detection' : 'detections'}</p></header>
          <div className={`moments-result-list${categoryTransition ? ' is-category-transitioning' : ''}`}>{renderResults(group.items)}</div>
        </section>) : renderResults(visibleQueue)}</div>
        {view === 'sessions' && storyId && detail.data?.nextCursor ? <button type="button" disabled={detail.loadingMore} onClick={detail.loadMore}>{detail.loadingMore ? 'Loading…' : 'Load earlier detections'}</button> : null}
        {historyMode && catalogue.data?.nextCursor && !catalogue.limited ? <button type="button" disabled={catalogue.loading} onClick={catalogue.loadMore}>{catalogue.loading ? 'Loading…' : 'Load more indexed moments'}</button> : null}
        {historyMode && catalogue.limited ? <p role="status">1,000 results loaded. Choose a day or creator to continue without growing this page indefinitely.</p> : null}
      </section>
      {chosen ? <MomentDetail key={`${chosen.key}:${chosen.publicMomentId || ''}`} moment={chosen} onSourceState={onSourceState} onClose={close} saved={view === 'saved' && Boolean(selected)} navigation={loadedMomentNeighbors(visibleQueue, chosen.key)} onNavigate={select}
        continuation={historyMode && catalogue.data && catalogue.data.state !== 'unavailable' ? {loading:catalogue.loading,canLoad:Boolean(catalogue.data.nextCursor),limited:catalogue.limited,error:catalogue.error,load:catalogue.loadMore}
          : view === 'sessions' && storyId && detail.data?.story && detail.data.status !== 'unavailable' ? {loading:detail.loadingMore,canLoad:Boolean(detail.data.nextCursor),limited:false,error:detail.error,load:detail.loadMore} : undefined} /> : null}
    </div>
  </main></AnalyticsFigmaShell>

  function renderResults(moments: DiscoveryMoment[]) {
    if (!recentFeed && !chosen && !historyMode && !(view === 'sessions' && storyId)) return moments.map(renderResult)
    return <table className="moments-review-table" aria-label="Loaded detection review"><thead><tr>{reviewColumns.map(column => <th scope="col" key={column} data-column={column}>{column}</th>)}</tr></thead><tbody>{moments.map(renderResult)}</tbody></table>
  }
  function renderResult(moment: DiscoveryMoment) {
           const compact = Boolean(recentFeed || chosen || historyMode || (view === 'sessions' && storyId))
          const artwork = checkedArtwork[moment.key] ?? (!sourceStates[moment.key]
            ? (historyMode ? catalogueArtwork.get(moment.key) : view === 'recent' ? recentArtwork.get(moment.key) : undefined)
            : undefined)
          const comparison = momentComparisonSummary(moment.comparison, moment.reactionSignal)
          const reactionVisualShown = !compact && !artwork && (moment.chatPerMin != null || moment.emotesPerMin != null || Boolean(moment.topEmotes?.length) || Boolean(comparison))
           const reactionVisualShowsEmotes = reactionVisualShown && Boolean(moment.topEmotes?.length)
           if (compact) {
             const group = categoryGroups.find(candidate => candidate.name === moment.category)
             const cells = {
               Creator: <MomentCreator moment={moment} />,
               Category: <span className="moments-review-category">{group ? <CategoryArtwork name={group.name} boxArtUrl={categoryPresentationArt(group, categoryResolutions)} /> : null}<span>{moment.category || 'Category unavailable'}</span></span>,
               'Event time': <><time dateTime={moment.at ? new Date(moment.at).toISOString() : undefined}>{moment.at ? new Date(moment.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Time unavailable'}</time><small>{formatStreamOffset(moment.offsetSeconds)} into broadcast</small></>,
               Moment: <><button type="button" data-discovery-key={moment.key} aria-label={`${moment.label} — Open moment for ${moment.displayName || moment.login} at ${formatStreamOffset(moment.offsetSeconds)}`} aria-current={selected?.key === moment.key ? 'true' : undefined} onClick={() => select(moment)}>{moment.label}</button>{comparison ? <small>{comparison}</small> : null}</>,
                Emotes: <>
                  {recentFeed ? <div className="moments-recent-rates">
                    {moment.chatPerMin != null && Number.isFinite(moment.chatPerMin) ? <span>{present(moment.chatPerMin)} chat/min</span> : null}{' '}
                    {moment.emotesPerMin != null && Number.isFinite(moment.emotesPerMin) ? <span>{present(moment.emotesPerMin)} emotes/min</span> : null}
                    {moment.chatPerMin == null && moment.emotesPerMin == null ? <span>Minute rates not supplied</span> : null}
                  </div> : null}
                  {moment.topEmotes?.length ? <MomentEmotes moment={moment} /> : <span>Not supplied</span>}
                  {recentFeed && artwork && !chosen ? <details className="moments-recent-artwork"><summary>Broadcast thumbnail</summary><MomentArchiveArtwork artwork={artwork} fallback={<span>Thumbnail unavailable</span>} /></details> : null}
                </>,
               Source: <><span>{sourceStates[moment.key] || 'Source unchecked'}</span><Link to={discoveryAnalyticsHref(moment)} title="Stream analytics"><ChartNoAxesCombined size={16} aria-hidden="true" /><span>Stream analytics</span></Link></>,
               Save: <SaveMomentButton moment={moment} />,
             }
             return <tr className={`moments-result moments-result--compact${selected?.key === moment.key ? ' is-selected' : ''}`} key={moment.key} aria-label={`${moment.displayName || moment.login} ${moment.label} at ${formatStreamOffset(moment.offsetSeconds)}`}>
               {reviewColumns.map(column => <td key={column} data-column={column}>{cells[column]}</td>)}
             </tr>
           }
          return <article className={`moments-result${compact ? ' moments-result--compact' : ' moments-result--gallery'}${selected?.key === moment.key ? ' is-selected' : ''}`} key={moment.key} aria-label={`${moment.displayName || moment.login} ${moment.label} at ${formatStreamOffset(moment.offsetSeconds)}`} onClick={event => {
          // Emote/title layers stay hoverable above the stretched primary target;
          // non-interactive card content still opens review through this fallback.
          if (event.target instanceof Element && event.target.closest('a, button, input, select, textarea, summary')) return
          select(moment)
        }}>
          {!compact ? <div className="moments-gallery-media">{artwork ? <MomentArchiveArtwork artwork={artwork} fallback={<MomentReactionVisual moment={moment} />} /> : <MomentReactionVisual moment={moment} />}<span className="moments-media-offset">At {formatStreamOffset(moment.offsetSeconds)} in broadcast</span></div> : null}
          <div className="moments-result-header"><MomentCreator moment={moment} /><time title={moment.at ? new Date(moment.at).toLocaleString() : undefined}>{moment.at ? new Date(moment.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Time unavailable'}</time></div>
          <div className="moments-result-body"><p className="moments-result-title"><button type="button" className="moments-card-primary" data-discovery-key={moment.key} aria-label={`${moment.label} — Open moment for ${moment.displayName || moment.login} at ${formatStreamOffset(moment.offsetSeconds)}`} aria-current={selected?.key === moment.key ? 'true' : undefined} onClick={() => select(moment)}><span>{moment.label}</span><small aria-hidden="true">Review moment →</small></button><span>{formatStreamOffset(moment.offsetSeconds)}</span></p><DetectionSummary moment={moment} sourceState={sourceStates[moment.key]} measurementShown={reactionVisualShown} />{reactionVisualShowsEmotes ? null : <MomentEmotes moment={moment} />}</div>
          <div className="moments-actions">{!chosen ? <button type="button" className="moments-review-action" onClick={() => select(moment)}>Review moment <ArrowRight size={14} aria-hidden="true" /></button> : null}<Link to={discoveryAnalyticsHref(moment)} title="Stream analytics"><ChartNoAxesCombined size={16} aria-hidden="true" /><span>Stream analytics</span></Link><SaveMomentButton moment={moment} /></div>
        </article>
  }
}
