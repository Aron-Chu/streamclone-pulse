import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, SyntheticEvent } from 'react'
import { X } from 'lucide-react'
import { Link, useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom'
import LegacyMomentSession from './LegacyMomentSession'
import { broadcastTimelineHref } from '../../lib/momentsNavigation'
import { usePublicHubData } from '../../hooks/usePublicHubData'
import { useRankedDiscovery, useRankedRetention } from '../../hooks/useDiscoveryCatalogue'
import { useRankedFeatureAvailability } from '../../hooks/useRankedFeatureAvailability'
import { useMomentProfiles } from '../../hooks/useMomentProfiles'
import { readRankedScope, readHistoryRankedScope, rankedEmptyMessage, type RankedScope } from '../../lib/discoveryCatalogue'
import { HistoryExplorerControls } from '../../ui/components/moments/HistoryExplorerControls'
import { RankedExploreControls } from '../../ui/components/moments/RankedExploreControls'
import { resolveLivePulseMoments } from '../../lib/figmaSessionAnalytics'
import { fromHubMoment, uniqueDiscoveryMoments,
  checkMomentSource, type DiscoveryMoment, type CheckedMomentSource } from '../../lib/discoveryMoments'
import { useSavedMoments } from '../../lib/savedDiscoveryMoments'
import { refreshedReplayforgeHandoffHref } from '../../lib/replayforgeHandoff'
import { watchMomentHref } from '../../lib/watchHandoff'
import { formatStreamOffset } from '../../lib/formatStreamOffset'
import { twitchProfileImageRendition } from '../../lib/twitchProfileImage'
import { ResilientImage } from '../../ui/components/ResilientImage'
import { formatMomentDateTime } from '../../lib/liveWire'
import { momentComparisonSummary } from '../../lib/momentComparison'
import { browseLoadedItems, loadedMomentNeighbors, readMomentBrowse } from '../../lib/momentBrowse'
import { AnalyticsFigmaShell } from '../../ui/components/analytics/AnalyticsFigmaShell'
import { SaveMomentButton } from '../../ui/components/moments/SaveMomentButton'
import { MomentVodPreview } from '../../ui/components/moments/MomentVodPreview'
import { MomentLoadingSkeleton } from '../../ui/components/moments/MomentLoadingSkeleton'
import { useCollectionArrival } from '../../ui/motion/useCollectionArrival'
import { MomentRow } from '../../ui/components/moments/MomentRow'
import { MomentSelect } from '../../ui/components/moments/MomentSelect'
import { MomentEvidenceBars } from '../../ui/components/moments/MomentEvidenceBars'
import { MomentNote } from '../../ui/components/moments/MomentNote'
import { MomentMinuteChart } from '../../ui/components/moments/MomentMinuteChart'
import { MomentInlineReveal } from '../../ui/components/moments/MomentInlineReveal'
import { alignTop, keepInPlace } from '../../ui/motion/keepInPlace'
import type { ArchiveArtwork } from '../../lib/archiveArtwork'
import { EmoteImg } from '../../ui/components/analytics/EmoteImg'
import { emoteImageUrlFromIdentity } from '../../lib/emoteAssetUrl'
import { loadExactMomentRecap } from '../../lib/discoveryMomentRecap'
import { loadNewsroomProfiles, newsroomProfileUrl } from '../../lib/newsroomProfiles'
import { creatorHistoryHref } from '../../lib/creatorHistoryHref'
import type { PublicHubLoadSource } from '../../lib/publicHub'
import '../../ui/components/analytics/figma-analytics.css'
import '../../ui/components/moments/moments-workspace.css'

const present = (value?: number) => value != null && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : 'Unavailable'
const valid = (moment: DiscoveryMoment | null): moment is DiscoveryMoment => moment !== null
/** A moment as assistive technology hears it: the reaction, the creator, and when in the broadcast. */
const spokenMoment = (moment: Pick<DiscoveryMoment, 'label' | 'displayName' | 'login' | 'offsetSeconds'>) =>
  `${moment.label}, ${moment.displayName || moment.login}, ${formatStreamOffset(moment.offsetSeconds)} into broadcast`
const scrollPositions = new Map<string, number>()
// A session page's return link pushes a new history entry, so its router key never
// matches. Positions for those returns (and Back into a review) are kept per URL.
const returnScrollPositions = new Map<string, number>()
const RETURN_RESTORE_FRAMES = 120
const RETURN_RESTORE_STOP_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
/** One moment is open at a time, so its slot has one id for the row's `aria-controls`. */
const DETAIL_ID = 'moments-selected-detail'
const SELECTION_RESET = { login: null, stream: null, offset: null, moment: null } as const
interface ReviewContinuation { loading: boolean; canLoad: boolean; limited: boolean; error: string | null; load: () => void }
const isSelectionParams = (params: URLSearchParams) => params.has('offset') && params.has('stream') && params.has('login')

/**
 * Where the open selection's detail renders. It is fixed when the detail first shows
 * and kept until the selection closes or changes, so the detail does not move between
 * the standalone card and a row's slot (a move also remounts it) when its row joins or
 * leaves the list on its own: a Save or un-save, a reload, a late feed. The one move
 * left is honest: a settled live collection that no longer has the row (a cached
 * snapshot the network replaced) makes it a selection outside the loaded matches.
 */
interface DetailPlacement {
  /** The selection it belongs to: exact key plus the URL's public moment id. */
  id: string
  mode: 'inline' | 'standalone'
  /** The moment as last shown, for when neither the list nor history state still has it. */
  moment: DiscoveryMoment
  /** In line: the row as last listed, kept on screen while the list no longer has it. */
  row?: DiscoveryMoment
  /** In line: the key listed just before that row, and its index, to keep its place. */
  previousKey?: string | null
  index?: number
  /** Standalone after it had opened in line: shown again where it now is. */
  moved?: boolean
}

/** The list with a held row put back where it was: after the row that preceded it. */
function withHeldRow<T extends { key: string }>(rows: T[], held: T, previousKey: string | null, index: number): T[] {
  const after = previousKey == null ? -1 : rows.findIndex(row => row.key === previousKey)
  const at = previousKey == null ? 0 : after >= 0 ? after + 1 : Math.min(index, rows.length)
  return [...rows.slice(0, at), held, ...rows.slice(at)]
}

/**
 * The row to hold still while a click away collapses the open slot. Only a slot the
 * reader has scrolled into or past moves what they see: the rows below it would rise
 * by its height. A slot whose top is on screen collapses below the reader's view, and
 * the browser's own scroll anchoring is left to handle anything else.
 */
function rowBelowClosingSlot(): HTMLElement | null {
  const slot = document.getElementById(DETAIL_ID)
  if (!slot || slot.getBoundingClientRect().top >= 0) return null
  for (const row of document.querySelectorAll<HTMLElement>('.moments-result')) {
    if (!(slot.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)) continue
    const { top } = row.getBoundingClientRect()
    if (top >= window.innerHeight) return null
    if (top >= 0) return row
  }
  return null
}
export function resolveMomentAvatarUrl(value: unknown): string | undefined {
  return newsroomProfileUrl(value)
}

export function isMomentsFeedUnavailable(
  view: string,
  loadSource: PublicHubLoadSource | null,
  hubEndpointOk: boolean,
): boolean {
  return view === 'recent' && loadSource === 'stats-fallback' && !hubEndpointOk
}

function MomentAvatar({ moment }: { moment: Pick<DiscoveryMoment, 'profileImageUrl' | 'displayName' | 'login'> }) {
  // Use existing profile allowlist. Never turn arbitrary candidate strings into image requests.
  const safe = resolveMomentAvatarUrl(moment.profileImageUrl)
  const initial = <span className="moments-avatar" aria-hidden="true">{(moment.displayName || moment.login).slice(0, 1).toUpperCase()}</span>
  // The 70px rendition covers the 26px avatar at 2x; the original stays as the fallback.
  return <ResilientImage className="moments-avatar" src={twitchProfileImageRendition(safe, 70)} fallbackSrc={safe} alt="" fallback={initial} />
}

function formatShortDuration(totalSeconds: number): string {
  const seconds = Math.round(Math.abs(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', rest || (!hours && !minutes) ? `${rest}s` : ''].filter(Boolean).join(' ')
}

/** Two nearby times that disagree look like an error unless the difference is named. */
export function VodOffsetNote({ broadcastSeconds, vodSeconds }: { broadcastSeconds: number; vodSeconds: number }) {
  const difference = vodSeconds - broadcastSeconds
  if (!Number.isFinite(difference) || Math.abs(difference) < 5) return null
  return <small className="moments-vod-offset-note">{`Twitch's recording started ${formatShortDuration(difference)} ${difference > 0 ? 'before' : 'after'} our tracked start, so this moment is at ${formatStreamOffset(vodSeconds)} in the VOD.`}</small>
}

function MomentCreator({ moment, historyAvailable, onNavigate }: { moment: DiscoveryMoment; historyAvailable: boolean; onNavigate?: () => void }) {
  const content = <><MomentAvatar moment={moment} /><span><strong>{moment.displayName || moment.login}</strong><small>{moment.category || 'Category unavailable'}</small></span></>
  const name = moment.displayName || moment.login
  // While History is hidden, a creator's broadcasts are the same fallback the stream console uses.
  const href = historyAvailable ? creatorHistoryHref(moment.login)
    : /^[a-z0-9_]{1,25}$/.test(moment.login) ? `/analytics/${encodeURIComponent(moment.login)}` : null
  return href
    ? <Link className="moments-creator-link" data-discovery-creator-key={moment.key} aria-label={historyAvailable ? `Browse ${name} history` : `All ${name} broadcasts`} to={href}
      onClick={event => {
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onNavigate?.()
      }}>{content}</Link>
    : <div className="moments-creator-link">{content}</div>
}

/**
 * One selected moment's evidence, replay and actions.
 *
 * `inline` opens under the moment's own row, which already names the creator,
 * reaction and time, so it carries no identity header. `standalone` is a
 * selection with no row in the loaded list (a deep link, or one filtered out),
 * and keeps its own identity, title and occurrence time.
 */
function MomentDetail({ moment: suppliedMoment, variant, onClose, saved, onSourceState, navigation, onNavigate, continuation }: { moment: DiscoveryMoment; variant: 'inline' | 'standalone'; onClose: () => void; saved: boolean; onSourceState: (key: string, state: string, artwork?: ArchiveArtwork) => void; navigation: ReturnType<typeof loadedMomentNeighbors<DiscoveryMoment>>; onNavigate: (moment: DiscoveryMoment, control: 'previous' | 'next') => void; continuation?: ReviewContinuation }) {
  const detailLocation = useLocation()
  const [recap, setRecap] = useState<Partial<DiscoveryMoment> | null>(null)
  const [profileImageUrl, setProfileImageUrl] = useState<string>()
  const [evidenceState, setEvidenceState] = useState('')
  const [evidenceAttempt, setEvidenceAttempt] = useState(0)
  const needsEvidence = !suppliedMoment.topEmotes?.length
  useEffect(() => {
    const controller = new AbortController()
    if (!needsEvidence) { setRecap(null); setEvidenceState('') }
    // Only the standalone card draws an avatar; in line, the row above already has one.
    if (variant === 'standalone' && !newsroomProfileUrl(suppliedMoment.profileImageUrl)) void loadNewsroomProfiles([suppliedMoment.login], controller.signal, (_login, url) => setProfileImageUrl(url))
    if (needsEvidence) {
      setEvidenceState('Loading this exact detection…')
      void loadExactMomentRecap(suppliedMoment, controller.signal).then(result => {
        if (controller.signal.aborted) return
        setRecap(result)
        setEvidenceState(result ? '' : 'This exact detection is not in the available session recap. No nearby reaction was substituted.')
      }).catch(() => { if (!controller.signal.aborted) setEvidenceState('Reaction details could not be loaded. You can retry without losing this selection.') })
    }
    return () => controller.abort()
  }, [suppliedMoment.key, suppliedMoment.publicMomentId, needsEvidence, evidenceAttempt, variant])
  const moment = { ...suppliedMoment, ...(needsEvidence ? recap : null),
    // Exact recap reactions may enrich an older save, but its title is part of
    // the historical snapshot the user chose to keep.
    ...(suppliedMoment.provenance === 'saved' ? { label: suppliedMoment.label } : {}),
    profileImageUrl: newsroomProfileUrl(suppliedMoment.profileImageUrl) || profileImageUrl }
  const [source, setSource] = useState<CheckedMomentSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [automaticChecks, setAutomaticChecks] = useState(0)
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
  const occurrenceDateTime = formatMomentDateTime(moment.at) ?? formatMomentDateTime(source?.occurrenceAt)
  const occurrenceLabel = occurrenceDateTime ? new Date(occurrenceDateTime).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'UTC', timeZoneName: 'short',
  }) : null
  const reviewing = navigation.position != null
  const measurement = <section className="moments-measurement" aria-label="Moment measurement">
    <div className="moments-measurement-heading"><h3>What happened in chat</h3>{summary ? <span>{summary}</span> : null}</div>
    <dl><div><dt>Chat / min</dt><dd>{present(moment.chatPerMin)}</dd></div><div><dt>Emotes / min</dt><dd>{present(moment.emotesPerMin)}</dd></div><div><dt>Detection window</dt><dd>1 minute</dd></div></dl>
    <MomentEvidenceBars moment={moment} />
  </section>
  const reactions = moment.topEmotes?.length ? <section className="moments-reactions" aria-label="Selected moment reactions"><h3>Reactions in this moment</h3>
    <ul>{moment.topEmotes.slice(0, 5).map((emote, index) => {
      // Saved records keep no media URL: rebuild one from a provider ID, else let the name stand alone.
      const src = emote.imageUrl ?? emoteImageUrlFromIdentity(emote.provider, emote.id)
      return <li key={`${emote.provider || ''}:${emote.name}:${index}`} className={src ? undefined : 'moments-reaction--no-image'}>
      {src ? <EmoteImg name={emote.name} src={src} width={28} height={28} /> : null}
      <span className="moment-emote-label"><span>{emote.name}</span><small>{emote.provider === 'seventv' ? '7TV' : emote.provider || 'Provider not supplied'}</small>
        {emote.count != null && Number.isFinite(emote.count) && emote.count >= 0 ? <span className="moment-emote-track" aria-hidden="true"><i style={{ width: `${emote.count / Math.max(1, ...moment.topEmotes!.slice(0, 5).map(item => item.count != null && Number.isFinite(item.count) && item.count >= 0 ? item.count : 0)) * 100}%` }} /></span> : null}
      </span>
      <strong>{emote.count != null && Number.isFinite(emote.count) && emote.count >= 0 ? `${present(emote.count)} uses` : 'Count unavailable'}</strong>
    </li>
    })}</ul><p className="moments-muted">Supplied emote uses · bars relative to the leading emote shown</p>
  </section> : null
  // Named for its moment: in line it has no heading of its own, and Previous/Next swap it in place.
  return <section className="moments-detail" data-variant={variant} aria-label={`Selected moment: ${spokenMoment(moment)}`} tabIndex={-1}>
    <div className="moments-detail-head">
      <span>{reviewing ? `${navigation.position} of ${navigation.total} loaded moments` : 'Selection outside loaded matches'}</span>
      <div>
        {reviewing && navigation.total > 1 ? <nav aria-label="Review loaded moments">
          <button type="button" data-review="previous" aria-label="Previous moment" disabled={!navigation.previous} onClick={() => { if (navigation.previous) onNavigate(navigation.previous, 'previous') }}>Previous</button>
          <button type="button" data-review="next" aria-label="Next moment" disabled={!navigation.next} onClick={() => { if (navigation.next) onNavigate(navigation.next, 'next') }}>Next</button>
        </nav> : null}
        <button type="button" className="moments-detail-close" data-review="close" onClick={onClose}>Close<X size={14} aria-hidden="true" /></button>
      </div>
    </div>
    {continuation && (continuation.canLoad || continuation.loading || continuation.error || continuation.limited) ? <section className="moments-review-continuation" aria-label="Continue reviewing collection">
      <button type="button" disabled={continuation.loading || !continuation.canLoad || continuation.limited} onClick={continuation.load}>{continuation.loading ? 'Loading more moments…' : continuation.limited ? 'Page limit reached' : continuation.canLoad ? 'Load more moments into review' : 'All supplied moments loaded'}</button>
      <p className="moments-muted">{continuation.limited ? '1,000 results loaded. Close this moment and choose a day or creator to narrow this collection.' : continuation.canLoad ? 'Adds results in your current sort order. Your selection stays; filters still apply.' : 'This is the supplied collection, not proof that every reaction was detected.'}</p>
      {continuation.error ? <p role="status">{continuation.error}</p> : null}
    </section> : null}
    {variant === 'standalone' ? <>
      <div className="moments-identity"><MomentAvatar moment={moment} /><div><strong>{moment.displayName || moment.login}</strong><div className="moments-muted">{moment.category || 'Selected broadcast'}</div></div><span className="moments-detail-offset"><strong>{formatStreamOffset(moment.offsetSeconds)}</strong><small>into broadcast</small></span></div>
      <h2 tabIndex={-1}>{moment.label}</h2>
      {/* The offset already sits beside the identity; this line carries wall-clock time only. */}
      <p className="moments-muted">{occurrenceDateTime
        ? <time dateTime={occurrenceDateTime}>{occurrenceLabel}</time>
        : 'Occurrence time unavailable'}</p>
    </> : null}
    {evidenceState ? <p className="moments-muted" role="status">{evidenceState}{!evidenceState.startsWith('Loading') ? <> <button type="button" onClick={() => setEvidenceAttempt(value => value + 1)}>Retry reaction details</button></> : null}</p> : null}
    <MomentMinuteChart moment={moment} />
    <div className="moments-detail-grid">
      {/* What happened (why it was selected) on the left; watching and actions on the right. */}
      <div className="moments-detail-main">{measurement}{reactions}</div>
      <div className="moments-detail-side">
        {source?.vodHref ? <MomentVodPreview key={source.vodHref} href={source.vodHref} artwork={source.archiveArtwork} /> : null}
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
          {source?.vodHref && source.vodOffsetSeconds != null ? <VodOffsetNote broadcastSeconds={moment.offsetSeconds} vodSeconds={source.vodOffsetSeconds} /> : null}
          {handoff ? <a href={handoff} target="_blank" rel="noopener noreferrer">Prepare clip in ReplayForge ↗</a> : null}
          {handoff ? <small>ReplayForge requires sign-in and source permission. Opening it does not create a job.</small> : null}
        </div>
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
            <Link to={broadcastTimelineHref(moment.login, moment.streamId, detailLocation.pathname + detailLocation.search + detailLocation.hash, moment.offsetSeconds)}>View stream timeline</Link>
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
      </div>
    </div>
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
  // The history state written with latestParams, for the same reason.
  const latestState = useRef<unknown>(location.state)
  useLayoutEffect(() => { latestState.current = location.state }, [location])
  const locationRef = useRef(location)
  locationRef.current = location
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const workspaceRef = useRef<HTMLElement>(null)
  // Ranked discovery is opt-in until its hosted route and calibration are ready.
  const view = params.get('view') === 'saved' ? 'saved' : params.get('view') === 'history' || params.get('collection') === 'history' ? 'history' : params.get('view') === 'explore' ? 'explore' : 'recent'
  const explore = view === 'explore'
  const historyMode = view === 'history'
  const rankedMode = explore || historyMode
  // Freeze relative filters for this browse session. A stale server snapshot's
  // asOf describes its data; it must not silently move the requested dates.
  const [rankedClock, setRankedClock] = useState(() => new Date())
  const retentionLogin = historyMode && (params.get('scope') === 'creator' || (!params.has('scope') && params.get('collection') === 'history'))
    ? (params.get('creator') || '').trim().toLowerCase() : ''
  const retention = useRankedRetention(rankedMode, retentionLogin)
  const certifiedClock = retention.asOf ? new Date(retention.asOf) : rankedClock
  let rankedScope: RankedScope | null = null, rankedValidation = ''
  if (retention.from && retention.throughExclusive) {
    try { rankedScope = historyMode ? readHistoryRankedScope(params, certifiedClock, retention.from, retention.throughExclusive) : readRankedScope(params, certifiedClock, retention.from, retention.throughExclusive) }
    catch (error) { rankedValidation = error instanceof Error ? error.message : 'Choose valid filters.' }
  }
  // While History checks a new creator's dates right after a range History showed, the ranking
  // History was showing stays (marked as retained, with its own range and scope) so the results
  // below the filters keep their place. Only a range shown in History counts: coming back from
  // Explore to a History creator shows no rows until that creator's dates are checked.
  const rangeShown = useRef(false)
  const keepRanking = historyMode && retention.loading && rangeShown.current
  rangeShown.current = historyMode && (Boolean(retention.from) || keepRanking)
  const ranked = useRankedDiscovery(rankedMode && (Boolean(retention.from && retention.throughExclusive && rankedScope) || keepRanking), rankedScope, retention.from, retention.manualVersion, retention.throughExclusive, retention.certificateGeneration)
  const browse = { ...readMomentBrowse(params), period: 'all' as const, from: '', to: '' }
  useEffect(() => {
    if (!historyMode) return
    const next = new URLSearchParams(params)
    if (next.get('collection') === 'history') {
      next.set('view', 'history')
      next.delete('collection')
      next.delete('calendar')
      if (next.has('creator') && !next.has('scope')) next.set('scope', 'creator')
    }
    if (next.has('creator') && next.get('scope') !== 'creator') next.delete('creator')
    if (next.toString() !== params.toString()) setParams(next, { replace: true, state: location.state })
  }, [historyMode, params, setParams])
  const { category } = browse
  const offset = params.has('offset') ? Number(params.get('offset')) : NaN
  const requested = isSelectionParams(params)
  /** Whether a selection is open in the URL as last written, which can be ahead of this render. */
  const reviewingNow = () => isSelectionParams(latestParams.current)
  const saved = useSavedMoments()
  const [sourceStates, setSourceStates] = useState<Record<string, string>>({})
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  // Keep each view's own URL filters while switching tabs. Latest and Saved
  // share loaded-result browse semantics; ranked views keep separate scopes.
  const viewParams = useRef(new Map<typeof view, URLSearchParams>())
  const [checkedArtwork, setCheckedArtwork] = useState<Record<string, ArchiveArtwork>>({})
  const onSourceState = useCallback((key: string, state: string, artwork?: ArchiveArtwork) => {
    setSourceStates(previous => Object.fromEntries([...Object.entries(previous).filter(([id]) => id !== key).slice(-199), [key, state]]))
    // Exact detection key, in-memory only. Rechecking clears any earlier artwork;
    // a thumbnail never grants playback permission or replaces source revalidation.
    setCheckedArtwork(previous => Object.fromEntries([...Object.entries(previous).filter(([id]) => id !== key).slice(-199), ...(artwork ? [[key, artwork] as const] : [])]))
  }, [])
  const hub = usePublicHubData({ enabled: view === 'recent' && !historyMode, activityWindow: '30m', projection: 'moments' })
  // Explore and History stay hidden until the ranked backend answers (owner request).
  // Ranked views reuse their own retention read; Latest and Saved start one deferred
  // read per session, after Latest's first screen has settled.
  const rankedFeature = useRankedFeatureAvailability({
    start: !rankedMode && !(view === 'recent' && hub.loading),
    observed: !rankedMode ? undefined : retention.notDeployed ? 'not_deployed' : retention.from ? 'ready' : retention.error ? 'unavailable' : undefined,
  })
  const rankedTabsShown = rankedFeature === 'ready' || rankedFeature === 'unavailable'
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
  const visibleFromCacheRef = useRef(false)
  useEffect(() => {
    if (view !== 'recent' || historyMode || !hub.data) return
    const previous = visibleRecentRef.current
    const next = recent.slice(0, 200)
    const fromCache = hub.loadSource === 'cache'
    // Only hold ordering while an exact review is open. A healthy refresh must
    // replace a cache snapshot during ordinary browsing, including with an
    // honestly empty result, rather than preserving stale identities forever.
    const replacingCache = visibleFromCacheRef.current && !fromCache
    visibleFromCacheRef.current = fromCache
    const byKey = new Map(recent.map(moment => [moment.key, moment]))
    // Mid-review, the first network result drops cached rows it no longer has
    // (they were never a live collection) but keeps the reader's order for the rest.
    const retained = replacingCache ? previous.filter(moment => byKey.has(moment.key)) : previous
    if (!previous.length || !requested || !retained.length) {
      setVisibleRecent(next)
      setPendingRecent([])
      return
    }
    const known = new Set(retained.map(moment => moment.key))
    setPendingRecent(pending => uniqueDiscoveryMoments([...(replacingCache ? [] : pending), ...recent].filter(moment => !known.has(moment.key))).slice(0, 200))
    setVisibleRecent(retained.map(moment => byKey.get(moment.key) ?? moment).slice(0, 200))
  }, [historyMode, hub.data, hub.loadSource, recent, requested, view])
  const collection = rankedMode ? ranked.data?.items ?? [] : view === 'saved' ? saved.items : presentedRecent
  const now = Date.now()
  const filtered = rankedMode ? collection : browseLoadedItems(collection, browse, moment => ({ key: moment.key, at: moment.at, category: moment.category,
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
  const selectionId = selectionSeed ? `${selectionSeed.key}|${params.get('moment') || ''}` : null
  const placement = useRef<DetailPlacement | null>(null)
  if (placement.current?.id !== selectionId) placement.current = null
  // Once shown, the detail keeps the moment it showed if its row leaves the list (an
  // un-save, a refresh), rather than falling back to history state or the bare URL.
  const chosen = selected ?? placement.current?.moment ?? matchingOpenedMoment ?? selectionSeed
  useEffect(() => {
    if (!rankedMode || chosen) return
    const advanceAtUtcDayChange = () => {
      if (document.visibilityState === 'visible' && new Date().toISOString().slice(0, 10) !== rankedClock.toISOString().slice(0, 10)) setRankedClock(new Date())
    }
    advanceAtUtcDayChange()
    const interval = setInterval(advanceAtUtcDayChange, 60_000)
    document.addEventListener('visibilitychange', advanceAtUtcDayChange)
    window.addEventListener('focus', advanceAtUtcDayChange)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', advanceAtUtcDayChange); window.removeEventListener('focus', advanceAtUtcDayChange) }
  }, [rankedMode, Boolean(chosen), rankedClock])
  const busy = rankedMode ? retention.loading || ranked.loading : view === 'recent' ? hub.loading : false
  // The open moment's detail sits under its own row when that row is in the list;
  // otherwise (a deep link outside the loaded results) it stands alone at the top,
  // once the list has settled so it does not jump into a row a moment later. Either
  // way it then stays where it opened until the reader closes it (DetailPlacement).
  const naturalIndex = selected ? filtered.findIndex(moment => moment.key === selected.key) : -1
  // A row missing from the list stays on screen in Saved, where the reader un-saved it,
  // and while a collection reloads or is unavailable. A settled live collection
  // without it has dropped it, so the selection is outside the loaded matches.
  const listSettled = view === 'saved' ? false : rankedMode ? Boolean(ranked.data) && !busy : Boolean(hub.data) && !busy
  if (chosen && selectionId) {
    const current = placement.current
    const listed = naturalIndex >= 0 ? { row: filtered[naturalIndex]!, previousKey: filtered[naturalIndex - 1]?.key ?? null, index: naturalIndex } : null
    if (current) {
      current.moment = chosen
      if (current.mode === 'inline' && listed) Object.assign(current, listed)
      else if (current.mode === 'inline' && listSettled && !filtered.some(moment => moment.key === current.row?.key)) {
        placement.current = { id: selectionId, mode: 'standalone', moment: chosen, moved: true }
      }
    } else if (listed) placement.current = { id: selectionId, mode: 'inline', moment: chosen, ...listed }
    // With no data yet, each poll of a failing feed reports loading again; the card shows once.
    else if (!(busy && !filtered.length)) placement.current = { id: selectionId, mode: 'standalone', moment: chosen }
  } else placement.current = null
  const place = placement.current
  const heldRow = place?.mode === 'inline' && naturalIndex < 0 && place.row && !filtered.some(moment => moment.key === place.row!.key) ? place.row : null
  const displayed = heldRow ? withHeldRow(filtered, heldRow, place!.previousKey ?? null, place!.index ?? 0) : filtered
  const inlineKey = place?.mode === 'inline' ? chosen!.key : null
  const standaloneShown = place?.mode === 'standalone'
  // The row that stands for the open selection: its slot holds the detail, or (for a
  // standalone card whose row has since been listed) it is marked as the open one.
  const openRowKey = inlineKey ?? (standaloneShown && selected && filtered.some(moment => moment.key === selected.key) ? selected.key : null)
  const openRowKeyRef = useRef(openRowKey)
  openRowKeyRef.current = openRowKey
  const profiledResults = useMomentProfiles(displayed)
  // One artwork policy for every list: a verified thumbnail from the selected-source
  // check wins, and a supplied catalogue/feed thumbnail is used only while this row
  // has no source state of its own.
  const artworkPolicy = useCallback((moment: DiscoveryMoment) => checkedArtwork[moment.key] ?? (!sourceStates[moment.key]
      ? (view === 'recent' ? recentArtwork.get(moment.key) : undefined)
      : undefined),
    [checkedArtwork, recentArtwork, sourceStates, view])
  // The open row keeps the artwork it had when it opened: its own source check
  // would otherwise swap the thumbnail mid-review and reflow the row.
  const heldArtwork = useRef<{ key: string; artwork?: ArchiveArtwork } | null>(null)
  if (!inlineKey) heldArtwork.current = null
  else if (heldArtwork.current?.key !== inlineKey) {
    const row = displayed.find(moment => moment.key === inlineKey)
    heldArtwork.current = { key: inlineKey, artwork: row ? artworkPolicy(row) : undefined }
  }
  const resolveArtwork = (moment: DiscoveryMoment) => heldArtwork.current?.key === moment.key ? heldArtwork.current.artwork : artworkPolicy(moment)
  const failure = view === 'recent' ? hub.error : null
  // `/stats` and `/status` can keep the shell alive when `/hub` is down, but
  // they never contain moments. Do not present that degraded response as a
  // legitimate empty feed.
  const momentsUnavailable = isMomentsFeedUnavailable(view, hub.loadSource, hub.hubEndpointOk)
  const refreshInFlight = view === 'recent' && hub.refreshing
  const resultsRef = useRef<HTMLHeadingElement>(null)
  const lastSelectedKey = useRef<string | null>(null)
  useEffect(() => {
    // A review opened from Live Wire or a shared URL did not call select() here.
    // It still needs the same return-focus target once results have loaded.
    if (chosen) lastSelectedKey.current = chosen.key
  }, [chosen?.key])
  const previousNavigation = useRef({ requested })
  const creatorReturnFocus = useRef<{ locationKey: string; momentKey: string } | null>(null)
  // Where focus goes when a selection closes: the row (Esc, Close, browser Back) or
  // nowhere, when the reader closed it by clicking something else.
  const returnFocus = useRef<'row' | 'none'>('row')
  // An in-page close leaves the page where the reader is; only Back restores scroll.
  const skipScrollRestore = useRef(false)
  const openedInPage = useRef(false)
  const swapAnchor = useRef<{ top: number; focus: 'previous' | 'next' } | null>(null)
  // Previous/Next keep focus on the control just used, so the moment they open is
  // announced from here, a live region that outlives the detail it replaced.
  const [reviewAnnouncement, setReviewAnnouncement] = useState<{ key: string; text: string } | null>(null)
  const openedKey = useRef<string | null>(null)
  const openGeneration = useRef(0)
  const insidePress = useRef<{ pointer: Event | null; click: Event | null }>({ pointer: null, click: null })
  // Closing a pushed selection steps history back, which lands a task later.
  // URL changes made meanwhile wait for it, or they would edit the closing entry.
  const pendingPop = useRef<{ actions: Array<() => void>; timer: ReturnType<typeof setTimeout> } | null>(null)
  function flushPendingPop() {
    const pending = pendingPop.current
    if (!pending) return
    pendingPop.current = null
    clearTimeout(pending.timer)
    pending.actions.forEach(action => action())
  }
  function whenSettled(action: () => void): boolean {
    if (!pendingPop.current) return false
    pendingPop.current.actions.push(action)
    return true
  }
  useLayoutEffect(() => { if (!requested) flushPendingPop() }, [location.key, requested])
  useEffect(() => () => { if (pendingPop.current) clearTimeout(pendingPop.current.timer) }, [])
  function update(values: Record<string, string | null>, replace?: boolean, state?: unknown) {
    if (whenSettled(() => update(values, replace, state))) return
    const reviewing = reviewingNow()
    const next = new URLSearchParams(latestParams.current)
    for (const [key, value] of Object.entries(values)) value == null ? next.delete(key) : next.set(key, value)
    latestParams.current = next
    const current = state === undefined ? latestState.current : state
    const nextState = current && typeof current === 'object' ? { ...current } as Record<string, unknown> : {}
    if (!next.has('offset')) delete nextState.momentsReviewOrigin
    // The timeline's back link marks its own arrival; an edit made here is not one,
    // or it would restore the scroll of that arrival over the reader's own.
    delete nextState.momentsReturn
    latestState.current = nextState
    setParams(next, { replace: replace ?? reviewing, state: nextState })
  }
  /** A control that closes the open moment as a side effect leaves focus where the reader is. */
  function leaveSelection() {
    if (reviewingNow()) returnFocus.current = 'none'
  }
  /** Browse filters apply to the list, so changing one closes an open moment. */
  function updateFilters(values: Record<string, string | null>, replace?: boolean) {
    const reviewing = reviewingNow()
    leaveSelection()
    update({ ...values, ...(reviewing ? SELECTION_RESET : {}) }, replace)
  }
  /** A creator typed into a ranked filter is applied in place; keep the reader's place. */
  function keepPlaceFor(options?: { replace?: boolean }) {
    if (options?.replace) skipScrollRestore.current = true
  }
  function select(moment: DiscoveryMoment) {
    if (whenSettled(() => select(moment))) return
    // A row press is announced by the row's own button; only Previous/Next set one (review).
    setReviewAnnouncement(null)
    lastSelectedKey.current = moment.key
    openedInPage.current = true
    // Read from the URL as last written: a second press can land before the router
    // commits the first, and must replace that entry rather than push another.
    const reviewing = reviewingNow()
    const current = locationRef.current
    const state = latestState.current && typeof latestState.current === 'object' ? latestState.current : {}
    update({ login: moment.login, stream: moment.streamId, offset: String(moment.offsetSeconds), moment: moment.publicMomentId ?? null }, reviewing,
      { ...state, ...(!reviewing ? { momentsReviewOrigin: current.key } : {}), hubMoment: moment })
  }
  function close(focus: 'row' | 'none') {
    if (!reviewingNow() || pendingPop.current) return
    returnFocus.current = focus
    skipScrollRestore.current = true
    if (typeof (latestState.current as { momentsReviewOrigin?: unknown } | null)?.momentsReviewOrigin === 'string') {
      // Opened from this list: step back, so browser Back never reopens it.
      pendingPop.current = { actions: [], timer: setTimeout(flushPendingPop, 1000) }
      navigate(-1)
    } else update(SELECTION_RESET, true)
  }
  const closeRef = useRef(close)
  closeRef.current = close
  /** A row press: the open row closes, any other row opens in its place. */
  function toggle(moment: DiscoveryMoment, row: HTMLElement | null) {
    // Hold the pressed row only while a moment is open: closing it (or the one above)
    // moves the row, and stepping back in history restores an older scroll. Opening the
    // first one moves nothing above the row, and a hold would only fight the reader's
    // next scroll (a scrollbar drag, a scroll into view) for no gain.
    if (reviewingNow()) keepInPlace(row)
    if (moment.key === openRowKeyRef.current) close('none')
    else select(moment)
  }
  /** Previous/Next swap in place: the detail's top stays where it was on screen. */
  function review(moment: DiscoveryMoment, control: 'previous' | 'next') {
    const open = document.getElementById(DETAIL_ID)
    swapAnchor.current = open ? { top: open.getBoundingClientRect().top, focus: control } : null
    select(moment)
    const { position, total } = loadedMomentNeighbors(displayed, moment.key)
    setReviewAnnouncement({ key: moment.key, text: `${position != null ? `Moment ${position} of ${total}: ` : ''}${spokenMoment(moment)}` })
  }
  const swapping = swapAnchor.current != null
  useLayoutEffect(() => {
    const anchor = swapAnchor.current
    if (!anchor || !inlineKey) return
    swapAnchor.current = null
    const slot = document.getElementById(DETAIL_ID)
    alignTop(slot, anchor.top)
    // Keep focus on the control just used; at either end, on the one that still moves.
    const other = anchor.focus === 'next' ? 'previous' : 'next'
    const target = slot?.querySelector<HTMLButtonElement>(`[data-review="${anchor.focus}"]:not(:disabled)`)
      ?? slot?.querySelector<HTMLButtonElement>(`[data-review="${other}"]:not(:disabled)`)
      ?? slot?.querySelector<HTMLButtonElement>('[data-review="close"]')
    target?.focus({ preventScroll: true })
  }, [inlineKey])
  const markInsidePress = useCallback((event: SyntheticEvent) => {
    if (event.type === 'click') insidePress.current.click = event.nativeEvent
    else insidePress.current.pointer = event.nativeEvent
  }, [])
  // Click away to close: anywhere outside the open row and its detail, including
  // the page margins, header and filters. A click that navigated or changed the
  // URL (links, tabs, filters, another row) already did its own work; a row's own
  // links and Save, and controls that serve the review itself (new moments, retry,
  // load more: `data-keeps-selection`), keep it open. Esc closes too, unless a
  // field or menu has a use for it. Only a detail on screen can be clicked away from:
  // a deep link still waiting for its list shows nothing yet, and keeps its selection.
  const detailShown = Boolean(inlineKey || standaloneShown)
  useEffect(() => {
    if (!detailShown) return
    let hrefAtClick = ''
    let paramsAtClick: URLSearchParams | null = null
    let pressedInside = false
    const onPointerStart = () => { insidePress.current.pointer = null }
    const onPointerDown = (event: PointerEvent) => { pressedInside = insidePress.current.pointer === event }
    const onClickStart = () => { hrefAtClick = window.location.href; paramsAtClick = latestParams.current }
    const onClick = (event: MouseEvent) => {
      const startedInside = pressedInside
      pressedInside = false
      if (insidePress.current.click === event || startedInside) return
      // Every URL edit here replaces latestParams, so identity shows this click made one.
      if (event.button !== 0 || window.location.href !== hrefAtClick || latestParams.current !== paramsAtClick) return
      // A drag that selected text is not a click away.
      if (window.getSelection()?.toString()) return
      const target = event.target instanceof Element ? event.target : null
      if (!target?.isConnected || target.closest('a[href], [data-keeps-selection]')) return
      const row = target.closest<HTMLElement>('.moments-result')
      if (row) {
        // A row's own controls keep working; a press elsewhere on a row is the row's own toggle.
        const control = target.closest('a, button, input, select, textarea, [role="button"]')
        if (control && row.contains(control) && !control.classList.contains('moments-card-primary')) return
        if (row.querySelector<HTMLElement>('[data-discovery-key]')?.dataset.discoveryKey === openRowKeyRef.current) return
      }
      keepInPlace(rowBelowClosingSlot())
      closeRef.current('none')
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="menu"], [role="dialog"]')) return
      closeRef.current('row')
    }
    document.addEventListener('pointerdown', onPointerStart, true)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('click', onClickStart, true)
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerStart, true)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('click', onClickStart, true)
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [detailShown])
  useEffect(() => {
    const key = location.key
    const keepPosition = skipScrollRestore.current
    skipScrollRestore.current = false
    if (!requested) requestAnimationFrame(() => {
      if (!keepPosition) window.scrollTo(0, scrollPositions.get(key) ?? 0)
      const pending = creatorReturnFocus.current
      if (pending?.locationKey === key && view === 'recent') {
        const target = [...document.querySelectorAll<HTMLElement>('[data-discovery-creator-key]')]
          .find(link => link.dataset.discoveryCreatorKey === pending.momentKey)
        target?.focus({ preventScroll: true })
        creatorReturnFocus.current = null
      }
    })
  }, [location.key, requested, view])
  // Remember the reader's place as this entry is left. A layout cleanup runs in
  // the commit's mutation phase, before RouteScrollManager's layout effect opens
  // a pushed page at the top; a passive cleanup would run after that reset and
  // record 0, so Back would return the reader to the top of the list.
  useLayoutEffect(() => {
    const key = location.key
    return () => {
      scrollPositions.delete(key)
      scrollPositions.set(key, window.scrollY)
      if (scrollPositions.size > 40) scrollPositions.delete(scrollPositions.keys().next().value!)
    }
  }, [location.key, requested, view])
  const locationUrl = location.pathname + location.search
  useEffect(() => {
    const remember = () => {
      // Navigation commits before this listener is removed; ignore the next page's scroll.
      if (!workspaceRef.current?.isConnected) return
      returnScrollPositions.delete(locationUrl)
      returnScrollPositions.set(locationUrl, window.scrollY)
      if (returnScrollPositions.size > 40) returnScrollPositions.delete(returnScrollPositions.keys().next().value!)
    }
    window.addEventListener('scroll', remember, { passive: true })
    return () => window.removeEventListener('scroll', remember)
  }, [locationUrl])
  useEffect(() => {
    const returned = location.state?.momentsReturn === true
    if (!returned && !(navigationType === 'POP' && requested)) return
    const target = returnScrollPositions.get(locationUrl)
    if (target == null || target <= 0) return
    // A review scrolls itself into view on mount and grows as its evidence loads,
    // so keep the reader's position briefly, until they scroll or interact.
    let frame = 0
    let frames = 0
    const stop = () => {
      cancelAnimationFrame(frame)
      for (const type of RETURN_RESTORE_STOP_EVENTS) window.removeEventListener(type, stop)
    }
    for (const type of RETURN_RESTORE_STOP_EVENTS) window.addEventListener(type, stop, { passive: true })
    const step = () => {
      if (Math.abs(window.scrollY - target) > 2) window.scrollTo(0, target)
      if (++frames < RETURN_RESTORE_FRAMES) frame = requestAnimationFrame(step)
      else stop()
    }
    frame = requestAnimationFrame(step)
    return stop
    // Restore once per arrival; later URL edits within the page are the reader's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])
  useEffect(() => {
    const previous = previousNavigation.current
    previousNavigation.current = { requested }
    if (!previous.requested || requested) return
    const intent = returnFocus.current
    returnFocus.current = 'row'
    if (intent === 'none') return
    requestAnimationFrame(() => {
      const target = [...document.querySelectorAll<HTMLButtonElement>('[data-discovery-key]')].find(button => button.dataset.discoveryKey === lastSelectedKey.current)
      if (!target) { resultsRef.current?.focus({ preventScroll: true }); return }
      target.focus({ preventScroll: true })
      // Esc from deep inside a long detail: bring its row back on screen.
      const bounds = target.getBoundingClientRect()
      if (bounds.bottom < 0 || bounds.top > window.innerHeight) target.closest('.moments-result')?.scrollIntoView({ block: 'nearest' })
    })
  }, [requested])
  // A deep link (or Back/Forward to a selection) opens in line and scrolls its row
  // into view once; a moment opened from the list leaves the page where it is.
  const revealed = useRef<string | null>(null)
  useEffect(() => {
    if (!chosen) { revealed.current = null; return }
    const moved = Boolean(placement.current?.moved)
    const id = `${location.key}|${chosen.key}${moved ? '|moved' : ''}`
    if (revealed.current === id) return
    if (openedInPage.current) { openedInPage.current = false; revealed.current = id; return }
    const slot = inlineKey || standaloneShown ? document.getElementById(DETAIL_ID) : null
    if (!slot) return
    revealed.current = id
    const row = inlineKey ? slot.previousElementSibling as HTMLElement | null : null
    const restoring = (location.state?.momentsReturn === true || navigationType === 'POP') && (returnScrollPositions.get(location.pathname + location.search) ?? 0) > 0
    if (moved) {
      // Its row left a settled list, so the detail started again at the top of the
      // results: bring it into view, and return focus to it if the move dropped focus.
      if (!restoring) slot.scrollIntoView({ block: 'start' })
      if (!document.activeElement || document.activeElement === document.body) slot.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
      return
    }
    if (!restoring) (row ?? slot).scrollIntoView({ block: 'start' })
    const focusTarget = row ? row.querySelector<HTMLElement>('.moments-card-primary') : slot.querySelector<HTMLElement>('h2')
    focusTarget?.focus({ preventScroll: true })
    // Reveal once per arrival and selection; later list renders are the reader's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen?.key, inlineKey, standaloneShown, location.key])
  const resetSelection = { login: null, stream: null, offset: null, moment: null, story: null }
  const arrivalRoot = useRef<HTMLElement>(null)
  useCollectionArrival(arrivalRoot, JSON.stringify(profiledResults.map(item => item.key)))
  const hasBrowseFilters = Boolean(category || browse.query || browse.order !== 'newest')
  function changeView(next: typeof view) {
    if (next === view) return
    if (whenSettled(() => changeView(next))) return
    // Focus stays on the tab, so arrow keys keep moving through the tablist.
    leaveSelection()
    const current = new URLSearchParams(latestParams.current)
    viewParams.current.set(view, current)
    const remembered = viewParams.current.get(next)
    const nextParams = remembered ? new URLSearchParams(remembered) : new URLSearchParams({ view: next })
    if (!remembered && (view === 'recent' || view === 'saved') && (next === 'recent' || next === 'saved')) {
      for (const key of ['q', 'category', 'sort']) if (current.has(key)) nextParams.set(key, current.get(key)!)
    }
    for (const key of ['login', 'stream', 'offset', 'moment', 'story']) nextParams.delete(key)
    nextParams.set('view', next)
    if (next === 'history' || next === 'explore') setRankedClock(new Date())
    latestParams.current = nextParams
    latestState.current = null
    setParams(nextParams)
  }
  // Every opening is a new selection, even of the row whose collapse is still
  // running: it starts its own source check rather than reviving the closing one.
  if ((chosen?.key ?? null) !== openedKey.current) {
    openedKey.current = chosen?.key ?? null
    if (chosen) openGeneration.current += 1
  }
  const detail = chosen ? <MomentDetail key={`${chosen.key}:${chosen.publicMomentId || ''}:${openGeneration.current}`} variant={inlineKey ? 'inline' : 'standalone'} moment={chosen} onSourceState={onSourceState} onClose={() => close('row')} saved={view === 'saved' && Boolean(selected)} navigation={loadedMomentNeighbors(displayed, chosen.key)} onNavigate={review}
    continuation={rankedMode && ranked.data ? { loading: ranked.loading, canLoad: ranked.canLoad, limited: ranked.limited, error: ranked.error, load: ranked.loadMore } : undefined} /> : null
  // A bookmarked ranked view keeps its own tab and honest unavailable panel.
  const viewTabs = (['explore', 'recent', 'history', 'saved'] as const).filter(tab => rankedTabsShown || tab === view || tab === 'recent' || tab === 'saved')
  const historyAvailable = viewTabs.includes('history')
  function onViewTabsKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const current = viewTabs.findIndex(tab => event.target === document.getElementById(`moments-view-tab-${tab}`))
    if (current < 0) return
    event.preventDefault()
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? viewTabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + viewTabs.length) % viewTabs.length
    const next = viewTabs[nextIndex]
    changeView(next)
    document.getElementById(`moments-view-tab-${next}`)?.focus()
  }
  return <AnalyticsFigmaShell hideSidebar><main ref={workspaceRef} id="analytics-main" className="moments-workspace" data-filters-expanded={filtersExpanded} tabIndex={-1}>
    <header className="moments-heading"><div><h1>{historyMode ? 'Moment history' : view === 'saved' ? 'Saved moments' : 'Moments'}</h1><p>{historyMode ? 'Browse recent indexed detections by UTC day and creator.' : view === 'saved' ? 'Your shortlist of reactions to return to.' : 'Catch a reaction. Open its timeline. Keep what matters.'}</p></div><Link to="/analytics">Live activity →</Link></header>
    <nav aria-label="Moment views"><div className={`moments-tabs${viewTabs.length === 4 ? ' moments-tabs-four' : viewTabs.length === 2 ? ' moments-tabs-two' : ''}`} data-view={view} role="tablist" aria-label="Moment views" onKeyDown={onViewTabsKeyDown}><span className="moments-tab-indicator" aria-hidden="true" />{viewTabs.map(tab => <button type="button" role="tab" id={`moments-view-tab-${tab}`} aria-controls="moments-view-panel" aria-selected={view === tab} tabIndex={view === tab ? 0 : -1} key={tab} onClick={() => changeView(tab)}>{tab === 'saved' ? `Saved (${saved.items.length})` : tab === 'recent' ? 'Latest' : tab === 'explore' ? 'Explore' : 'History'}</button>)}</div></nav>
    <div id="moments-view-panel" role="tabpanel" aria-labelledby={`moments-view-tab-${view}`} tabIndex={0}>
    <p className="moments-muted">{explore ? 'Detector-selected moments from indexed completed broadcasts, ordered by observed IRC chat/min. Coverage is partial; this is not a list of all busy Twitch minutes.' : view === 'saved' ? 'Saved in this browser · not synced to the extension or your account.' : historyMode ? 'Recent indexed completed broadcasts with measured IRC activity. Coverage is partial; older days are not a durable archive.' : <>Latest shows up to 10 high-scoring detections from currently live streams, ordered by occurrence time. A detection may be older than the chart range.{historyAvailable ? <> For earlier broadcasts, open <Link to="/analytics/moments?view=history">History</Link>.</> : null}</>}</p>
    {explore ? <RankedExploreControls params={params} now={certifiedClock} indexedRetentionStart={retention.from} certifiedThroughExclusive={retention.throughExclusive} retentionCheckedAt={retention.checkedAt} data={ranked.data} loading={retention.loading || ranked.loading} retained={ranked.retained || Boolean(rankedValidation)} error={retention.error || rankedValidation || ranked.error} invalid={Boolean(rankedValidation)} notDeployed={retention.notDeployed}
      onChange={(values, options) => { leaveSelection(); keepPlaceFor(options); update({ ...resetSelection, ...values, view: 'explore', sort: 'volume', q: null }, options?.replace ?? false) }}
      onReset={() => { leaveSelection(); setRankedClock(new Date()); setParams({ view: 'explore', period: 'latest', sort: 'volume' }) }}
      onRefresh={() => { if (!chosen) setRankedClock(new Date()); retention.refresh() }} /> : null}
    {saved.warning ? <p role="status" className="moments-notice">{saved.warning}</p> : null}
    {historyMode ? <HistoryExplorerControls params={params} now={certifiedClock} indexedRetentionStart={retention.from} certifiedThroughExclusive={retention.throughExclusive} retentionCheckedAt={retention.checkedAt} days={ranked.error ? undefined : retention.days} data={ranked.data} loading={retention.loading || ranked.loading} retained={ranked.retained || Boolean(rankedValidation)} error={retention.error || rankedValidation || ranked.error} invalid={Boolean(rankedValidation)}
      onChange={(values, options) => { leaveSelection(); keepPlaceFor(options); update({ ...resetSelection, ...values, calendar: null, month: null, q: null }, options?.replace ?? false) }}
      onRefresh={() => { if (!chosen) setRankedClock(new Date()); retention.refresh() }} /> : null}
    {!rankedMode && (collection.length > 0 || displayed.length > 0) ? <>
      <button type="button" className="moments-filter-toggle" aria-expanded={filtersExpanded} aria-controls="moments-filters" onClick={() => setFiltersExpanded(value => !value)}>{filtersExpanded ? 'Hide filters' : hasBrowseFilters ? 'Filters · active' : 'Filters'}</button>
      <div id="moments-filters" className="moments-toolbar">
        <label>Find in results<input type="search" aria-label="Find loaded moments" placeholder="Creator or reaction" maxLength={200} value={browse.query} onChange={event => updateFilters({ q: event.target.value || null }, true)} /></label>
        {categories.length > 1 || category ? <div className="moments-filter-field"><span>Category</span><MomentSelect aria-label="Category" value={category} onValueChange={value => updateFilters({ category: value || null })}><option value="">All categories</option>{category && !categories.includes(category) ? <option>{category}</option> : null}{categories.map(value => <option key={value}>{value}</option>)}</MomentSelect></div> : null}
        {!historyMode ? <div className="moments-filter-field"><span>Order</span><MomentSelect aria-label="Sort loaded results" value={browse.order} onValueChange={value => updateFilters({ sort: value === 'newest' ? null : value })}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="category">Category A–Z</option></MomentSelect></div> : null}
        {hasBrowseFilters ? <button type="button" onClick={() => updateFilters({ category: null, q: null, sort: null })}>Clear filters</button> : null}
      </div>
    </> : null}
    {view === 'recent' && pendingRecent.length ? <button type="button" data-keeps-selection onClick={() => { setVisibleRecent(uniqueDiscoveryMoments([...presentedRecent, ...pendingRecent, ...recent]).slice(0, 200)); setPendingRecent([]) }}>Show {pendingRecent.length} new moment{pendingRecent.length === 1 ? '' : 's'}</button> : null}
    {failure || momentsUnavailable ? <section className="moments-notice" role="status"><h2>{momentsUnavailable ? 'Live moments temporarily unavailable' : 'Moments could not be refreshed'}</h2><p>{failure ?? 'The live moments endpoint is unavailable. Aggregate health is still available on Live activity.'}</p><button data-keeps-selection disabled={busy || refreshInFlight} onClick={hub.refresh}>{busy || refreshInFlight ? 'Retrying…' : 'Retry'}</button><Link className="moments-back" to="/analytics">Open live activity →</Link></section> : null}
    {feed?.banner && view === 'recent' ? <p role="status">{feed.banner}</p> : null}
    {/* Outside the results, whose aria-busy can hold back announcements while a page loads. */}
    <span className="sr-only" aria-live="polite" aria-atomic="true" data-review-announcement="">{reviewAnnouncement && reviewAnnouncement.key === chosen?.key ? reviewAnnouncement.text : ''}</span>
    {(!rankedMode || retention.from || keepRanking || chosen) ? <div className="moments-layout">
      <section ref={arrivalRoot} className="moments-results" aria-label="Moment results" aria-busy={busy}><h2 ref={resultsRef} tabIndex={-1}>{rankedMode ? 'Most active detected moments' : 'Moments'} <small>{busy && !displayed.length ? 'Loading…' : rankedMode && !ranked.data ? '' : `${displayed.length} ${rankedMode ? 'loaded' : 'shown'}`}</small></h2>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{busy && !displayed.length ? 'Loading moments.' : rankedMode && !ranked.data ? '' : `${displayed.length} ${displayed.length === 1 ? 'moment' : 'moments'} ${rankedMode ? 'loaded' : 'shown'}.`}</span>
        {/* A selection with no row in the list leads the results, above any loading or
            empty state, so a retrying feed never moves it. */}
        <MomentInlineReveal open={standaloneShown} standalone animate={!swapping} id={DETAIL_ID} onInsidePress={markInsidePress}>{standaloneShown ? detail : null}</MomentInlineReveal>
        {busy ? <p role="status">Loading measured activity…</p> : null}
        {busy && !displayed.length ? <MomentLoadingSkeleton /> : null}
        {rankedMode ? !busy && !ranked.error && !rankedValidation && ranked.data && !displayed.length ? <p role="status">{rankedEmptyMessage(ranked.data)}</p> : null : view === 'saved' && saved.items.length === 0 && !displayed.length ? <div className="moments-empty-saved"><h3>Keep reactions worth returning to</h3><p>Save a moment to build your shortlist here.</p><button type="button" onClick={() => changeView('recent')}>Find moments to save</button></div> : !busy && !failure && !momentsUnavailable && !displayed.length ? <p role="status">{hasBrowseFilters ? 'No moments match these filters.' : 'No available moments.'}</p> : null}
        <div className="moments-result-list">
          {profiledResults.map(moment => {
            const rank = rankedMode ? ranked.data?.items.find(item => item.key === moment.key) : undefined
            const open = inlineKey === moment.key
            return <Fragment key={moment.key}>
              <MomentRow moment={moment} rank={rank?.rank} ranking={rank} selected={openRowKey === moment.key} detailId={DETAIL_ID} artwork={resolveArtwork(moment)} onSelect={toggle}
                creator={<MomentCreator moment={moment} historyAvailable={historyAvailable} onNavigate={() => { creatorReturnFocus.current = { locationKey: location.key, momentKey: moment.key } }} />} />
              <MomentInlineReveal open={open} animate={!swapping} id={DETAIL_ID} onInsidePress={markInsidePress}>{open ? detail : null}</MomentInlineReveal>
            </Fragment>
          })}</div>
        {rankedMode && ranked.canLoad ? <button type="button" data-keeps-selection disabled={ranked.loading} onClick={ranked.loadMore}>Load more moments (50)</button> : null}
        {rankedMode && ranked.limited ? <p className="moments-muted" role="status">1,000 results loaded. Choose a narrower date range, creator, or category to see more of this collection.</p> : null}
      </section>
    </div> : null}
    </div>
  </main></AnalyticsFigmaShell>
}
