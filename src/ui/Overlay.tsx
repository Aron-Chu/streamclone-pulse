import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  formatHeatOffset,
  LIVE_HEAT_MIN_COMPLETED_ROLLUPS,
} from '@streamclone/pulse-core'
import {
  DEFAULT_BACKEND_URL,
  getAutoUpdateEnabled,
  getBackendUrl,
  getOverlayMode,
  getOverlayPlacement,
  getSidebarTab,
  setAutoUpdateEnabled,
  setOverlayMode,
  setSidebarTab,
  type OverlayMode,
  type OverlayPlacement,
  type SidebarTab,
} from '../shared/storage.ts'
import { resolvePulsePanelSections } from './pulsePanelLayout.ts'
import { theme } from './theme.ts'
import { sendBackgroundMessage } from '../content/bridge.ts'
import {
  isTwitchChattersOpen,
  readTwitchCollapseLabel,
  clickTwitchCollapseChat,
  toggleTwitchChatters,
} from '../content/twitchChatControls.ts'
import { getPrimaryVideo, seekPlaybackOffset, detectTwitchChannelLive, type TwitchPageContext } from '../content/twitch.ts'
import { effectivePulseIsLive, pulsePayloadForDisplay } from './effectivePulseLive.ts'

interface OverlayProps {
  login: string
  context: TwitchPageContext
  payload: PulsePayload | null
  error?: string
  pendingTrackPrompt?: boolean
  onTrackStarted?: () => void
  effectivePlacement?: OverlayPlacement
  sidebarSnapped?: boolean
  sidebarPart?: 'tabs' | 'body' | 'full'
  panelHostWidth?: number
  pageIsLive?: boolean
  onSidebarTabChange?: (tab: SidebarTab) => void
  onOverlayModeChange?: (mode: OverlayMode) => void
}

type NoticeKind = 'ok' | 'warn' | 'info'

export function Overlay({
  login,
  context,
  payload,
  error,
  pendingTrackPrompt = false,
  onTrackStarted,
  effectivePlacement,
  sidebarSnapped = false,
  sidebarPart = 'full',
  panelHostWidth,
  pageIsLive = false,
  onSidebarTabChange,
  onOverlayModeChange,
}: OverlayProps) {
  const [mode, setModeState] = useState<OverlayMode>('expanded')
  const [placement, setPlacementState] = useState<OverlayPlacement>('right')
  const [sidebarTab, setSidebarTabState] = useState<SidebarTab>('pulse')
  const [backendUrl, setBackendUrlState] = useState(DEFAULT_BACKEND_URL)
  const [notice, setNotice] = useState<{ kind: NoticeKind; text: string } | null>(null)
  const [trackBusy, setTrackBusy] = useState(false)
  const [awaitingTrack, setAwaitingTrack] = useState(pendingTrackPrompt)
  const [autoUpdate, setAutoUpdate] = useState(true)

  useEffect(() => {
    setAwaitingTrack(pendingTrackPrompt && !payload?.tracking)
  }, [pendingTrackPrompt, payload?.tracking])

  useEffect(() => {
    let mounted = true
    void (async () => {
      const [storedMode, storedPlacement, storedBackend, storedSidebarTab, storedAutoUpdate] = await Promise.all([
        getOverlayMode(),
        getOverlayPlacement(),
        getBackendUrl(),
        getSidebarTab(),
        getAutoUpdateEnabled(),
      ])
      if (!mounted) return
      setModeState(storedMode)
      setPlacementState(storedPlacement)
      setBackendUrlState(storedBackend)
      setSidebarTabState(storedSidebarTab)
      setAutoUpdate(storedAutoUpdate)
      onSidebarTabChange?.(storedSidebarTab)
    })()
    const storageHandler = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'sync') return
      void getOverlayMode().then(setModeState)
      void getOverlayPlacement().then(setPlacementState)
      void getSidebarTab().then(tab => {
        setSidebarTabState(tab)
        onSidebarTabChange?.(tab)
      })
      void getBackendUrl().then(setBackendUrlState)
      if (changes.autoUpdateEnabled) {
        void getAutoUpdateEnabled().then(setAutoUpdate)
      }
    }
    chrome.storage.onChanged.addListener(storageHandler)
    return () => {
      mounted = false
      chrome.storage.onChanged.removeListener(storageHandler)
    }
  }, [])

  const displayPayload = payload ? pulsePayloadForDisplay(payload, pageIsLive, context) : null
  const uiIsLive = effectivePulseIsLive(payload, pageIsLive, context)
  const warming = false
  const panelSections = null
  const coverageStart = 0
  const resolvedPlacement = effectivePlacement ?? placement
  const resolvedMode = mode
  const resolvedSidebarTab = sidebarTab
  const showSidebarTabs = sidebarSnapped && resolvedPlacement === 'sidebar' && sidebarPart !== 'body'
  const sidebarBodyOnly = sidebarPart === 'body'
  const sidebarTabsOnly = sidebarPart === 'tabs'
  const sidebarChatOnly = showSidebarTabs && resolvedSidebarTab === 'chat'
  const shellClass = [
    'pulse-shell',
    `placement-${resolvedPlacement}`,
    `mode-${resolvedMode}`,
    resolvedPlacement === 'hidden' ? 'pulse-hidden' : '',
    sidebarChatOnly ? 'sidebar-chat-only' : '',
    sidebarBodyOnly ? 'pulse-sidebar-panel' : '',
  ].filter(Boolean).join(' ')

  async function persistAutoUpdate(next: boolean): Promise<void> {
    setAutoUpdate(next)
    await setAutoUpdateEnabled(next)
    await sendBackgroundMessage({ type: 'SET_AUTO_UPDATE', enabled: next })
  }

  async function persistSidebarTab(next: SidebarTab): Promise<void> {
    if (next === 'pulse' && mode === 'collapsed') {
      await persistMode('expanded')
    }
    setSidebarTabState(next)
    await setSidebarTab(next)
    onSidebarTabChange?.(next)
  }

  async function persistMode(next: OverlayMode): Promise<void> {
    setModeState(next)
    await setOverlayMode(next)
    onOverlayModeChange?.(next)
  }

  async function hideOverlay(): Promise<void> {
    await persistMode('collapsed')
  }

  async function startTracking(): Promise<void> {
    setTrackBusy(true)
    setNotice(null)
    try {
      const response = await sendBackgroundMessage({ type: 'TRACK', login })
      if ('payload' in response) {
        setAwaitingTrack(false)
        onTrackStarted?.()
      }
      if ('error' in response && response.error) {
        setNotice({ kind: 'warn', text: String(response.error) })
      }
    } catch (err) {
      setNotice({ kind: 'warn', text: err instanceof Error ? err.message : 'Could not start tracking.' })
    } finally {
      setTrackBusy(false)
    }
  }

  async function refreshPulse(): Promise<PulsePayload | null> {
    setTrackBusy(true)
    try {
      const response = await sendBackgroundMessage({
        type: 'GET_PULSE',
        login,
        watch: false,
        window: 'recent',
      })
      if ('type' in response && response.type === 'PULSE_UPDATE') {
        return response.payload
      }
      return null
    } finally {
      setTrackBusy(false)
    }
  }

  function openSettings(): void {
    void sendBackgroundMessage({ type: 'OPEN_OPTIONS' })
  }

  function openAnalytics(offsetSeconds?: number): void {
      vodId: payload?.vodId ?? context.vodId ?? undefined,
      analyticsStreamId: payload?.streamId,
    })
    window.open(`${backendUrl}${path}`, '_blank', 'noopener,noreferrer')
  }

  function openStreamStartToLive(): void {
    setNotice(null)
    setFullTimeline(true)
    const vodId = payload?.vodId ?? context.vodId ?? undefined
    const offset = 0
    openAnalytics(offset)

    if (vodId) {
      if (context.kind === 'vod' && context.vodId === vodId) {
        const result = seekPlaybackOffset(getPrimaryVideo(), offset, { isLive: false })
        setNotice({
          kind: 'ok',
          text: result.ok
            ? 'Jumped to stream start in the VOD player.'
            : 'Scrub the VOD player to stream start.',
        })
        return
      }
      window.open(vodUrl, '_blank', 'noopener,noreferrer')
      setNotice({
        kind: 'ok',
        text: 'Opened Twitch VOD at stream start.',
      })
      return
    }

    if (uiIsLive && context.kind === 'channel') {
      const result = seekPlaybackOffset(getPrimaryVideo(), offset, {
        isLive: true,
        liveCurrentOffset: payload?.currentOffsetSeconds ?? 0,
      })
      if (result.ok) {
        setNotice({ kind: 'ok', text: 'Jumped to stream start in the live DVR buffer.' })
        return
      }
    }

    setNotice({
      kind: 'info',
      text:
        coverageStart > 60
          ? `Playback from start — chat data begins at ${formatHeatOffset(coverageStart)} unless you load missed moments.`
          : 'Watch from start once Twitch publishes the archive.',
    })
  }

    setNotice(null)
    const vodId = payload?.vodId ?? context.vodId ?? undefined

    if (vodId) {
      openAnalytics(point.offsetSeconds)
      if (context.kind === 'vod' && context.vodId === vodId) {
        const result = seekPlaybackOffset(getPrimaryVideo(), point.offsetSeconds, { isLive: false })
        setNotice({
          kind: result.ok ? 'ok' : 'warn',
          text: result.ok
            ? `Jumped to ${formatHeatOffset(point.offsetSeconds)} in the VOD player.`
            : `Opened Streamclone at ${formatHeatOffset(point.offsetSeconds)}. Scrub the VOD player to match.`,
        })
        return
      }
      setNotice({
        kind: 'ok',
        text: `Opened Twitch VOD at ${formatHeatOffset(point.offsetSeconds)} with matching Pulse chart.`,
      })
      return
    }

    if (!payload?.isLive || context.kind === 'vod') {
      openAnalytics(point.offsetSeconds)
      return
    }

    const result = seekPlaybackOffset(getPrimaryVideo(), point.offsetSeconds, {
      isLive: true,
      liveCurrentOffset: payload.currentOffsetSeconds,
    })
    if (result.ok) {
      setNotice({ kind: 'ok', text: `Jumped to ${formatHeatOffset(point.offsetSeconds)} inside the live DVR buffer.` })
      return
    }
    setNotice({
      kind: 'warn',
      text:
        result.reason === 'outside_buffer'
          ? `Replay after VOD: ${formatHeatOffset(point.offsetSeconds)} is outside the live DVR buffer.`
          : 'Open in Streamclone once VOD context is available.',
    })
  }

  if (resolvedPlacement === 'hidden') {
    return null
  }

  if (sidebarTabsOnly) {
    const tabsShellClass = ['pulse-shell', `placement-${resolvedPlacement}`, 'pulse-sidebar-header-tabs'].join(' ')
    return (
      <section
        className={tabsShellClass}
        style={styles.headerTabsShell}
        aria-label="Chat or Pulse"
      >
        <SidebarHeaderBar active={resolvedSidebarTab} onChange={tab => void persistSidebarTab(tab)} />
      </section>
    )
  }

  if (sidebarBodyOnly && resolvedSidebarTab === 'chat') {
    return null
  }

  return (
      <section className={shellClass} style={styles.miniHost} aria-label="Streamclone Pulse mini overlay">
          login={login}
          payload={payload}
          tracking={payload?.tracking ?? false}
          isLive={uiIsLive}
          trackBusy={trackBusy}
          sidebarFill={sidebarBodyOnly}
          onExpand={() => void persistMode('expanded')}
          onHide={() => void hideOverlay()}
          onTrack={() => void startTracking()}
        />
      </section>
    )
  }

  return (
    <section
      className={shellClass}
      style={{ ...styles.panel, height: sidebarBodyOnly ? '100%' : undefined, padding: showSidebarTabs || sidebarBodyOnly ? 0 : 20 }}
      aria-label="Streamclone Pulse overlay"
    >
      {showSidebarTabs ? (
        <div className="pulse-sidebar-tabs-wrap" style={styles.sidebarTabsWrap}>
          <SidebarTabStrip active={resolvedSidebarTab} onChange={tab => void persistSidebarTab(tab)} />
        </div>
      ) : null}

      <div className={`pulse-panel-body ${showSidebarTabs ? 'pulse-tab-fade' : ''}`} style={{ ...(sidebarChatOnly ? styles.panelHidden : undefined), padding: showSidebarTabs ? '0 10px 10px' : sidebarBodyOnly ? '10px' : 0, flex: 1, minWidth: 0, overflow: sidebarBodyOnly ? undefined : 'auto' }}>
      <StreamPulseHeader
        isLive={uiIsLive}
        tracking={payload?.tracking ?? false}
        trackBusy={trackBusy}
        autoUpdate={autoUpdate}
        sidebarFill={sidebarSnapped}
        onAutoUpdateChange={next => void persistAutoUpdate(next)}
        onTrack={() => void startTracking()}
        onSettings={openSettings}
        onMini={() => void persistMode('mini')}
        onHide={() => void hideOverlay()}
      />

      {awaitingTrack && !payload?.tracking ? (
        <section style={styles.trackPrompt}>
          <p style={styles.stateText}>Track <strong>{login}</strong> to collect live chat and 7TV rollups from your Streamclone stack.</p>
          <div style={styles.footerActions}>
            <button type="button" style={styles.primaryButton} disabled={trackBusy} onClick={() => void startTracking()}>
              {trackBusy ? 'Starting…' : 'Track this channel'}
            </button>
            <button type="button" style={styles.secondaryButton} onClick={openSettings}>Manage watchlist</button>
          </div>
        </section>
      ) : null}

      {error ? (
        <BackendError backendUrl={backendUrl} onRetry={() => void refreshPulse()} onSettings={openSettings} />
      ) : null}

      {!error && payload ? (
        <>
            <>
                  coverage={payload.coverage}
                  busy={missedBusy}
                  refreshed={missedRefreshed}
                  job={missedJob}
                  onLoad={() => void loadMissedMoments()}
                />
              ) : null}
              payload={displayPayload}
              backendUrl={backendUrl}
              sidebarFill={sidebarSnapped}
              compact={metricsCompact && !sidebarSnapped}
              coverageStartOffsetSeconds={coverageStart}
              currentOffsetSeconds={payload.currentOffsetSeconds}
              isLive={uiIsLive}
              fullTimeline={fullTimeline}
              onOpenStreamStart={openStreamStartToLive}
            />
            </>
          ) : null}

            login={login}
            backendUrl={backendUrl}
            liveStreamId={payload.streamId}
            isLive={uiIsLive}
            channelOffline={!uiIsLive}
          />

          {panelSections?.showMostReacted && displayPayload ? (
          ) : null}

        </>
      ) : null}

      {!error && !payload ? (
        <section style={styles.stateBlock}>
          <h2 style={styles.stateTitle}>Connecting to Streamclone</h2>
          <p style={styles.stateText}>Waiting for Pulse data from {backendUrl}. Make sure the stack is running, then retry.</p>
          <div style={styles.footerActions}>
            <button type="button" style={styles.secondaryButton} disabled={trackBusy} onClick={() => void refreshPulse()}>Retry</button>
            <button type="button" style={styles.primaryButton} disabled={trackBusy} onClick={() => void startTracking()}>Track channel</button>
          </div>
        </section>
      ) : null}
      </div>
    </section>
  )
}

function StreamPulseHeader({
  isLive,
  tracking,
  trackBusy,
  autoUpdate,
  sidebarFill = false,
  onAutoUpdateChange,
  onTrack,
  onSettings,
  onMini,
  onHide,
}: {
  isLive: boolean
  tracking: boolean
  trackBusy: boolean
  autoUpdate: boolean
  sidebarFill?: boolean
  onAutoUpdateChange: (next: boolean) => void
  onTrack: () => void
  onSettings: () => void
  onMini: () => void
  onHide: () => void
}) {
  const headerStyle = sidebarFill ? styles.streamPulseHeaderSidebar : styles.streamPulseHeader
  const actionsStyle = sidebarFill ? styles.streamPulseHeaderActionsSidebar : styles.streamPulseHeaderActions
  const trackButtonStyle = sidebarFill ? styles.trackingButtonFull : styles.trackingButton
  const trackStreamerStyle = sidebarFill ? styles.trackStreamerButtonFull : styles.trackStreamerButton
  const autoUpdateStyle = sidebarFill ? styles.autoUpdateLabelFull : styles.autoUpdateLabel
  const iconRowStyle = sidebarFill ? styles.headerIconRowFull : styles.headerIconRow

  return (
    <header style={headerStyle}>
      <div style={sidebarFill ? styles.streamPulseHeaderMainSidebar : styles.streamPulseHeaderMain}>
        <div style={styles.streamPulseTitleRow}>
          <h2 style={styles.streamPulseTitle}>Stream Pulse</h2>
          {isLive ? <span style={styles.liveBadge}>Live</span> : null}
        </div>
      </div>
      <div style={actionsStyle}>
        {tracking ? (
          <button type="button" style={trackButtonStyle} disabled aria-label="Tracking this streamer">
            Tracking
          </button>
        ) : (
          <button type="button" style={trackStreamerStyle} disabled={trackBusy} onClick={onTrack}>
            {trackBusy ? 'Starting…' : 'Track streamer'}
          </button>
        )}
        <label style={autoUpdateStyle}>
          <span>Auto-updating</span>
          <button
            type="button"
            role="switch"
            aria-checked={autoUpdate}
            style={{ ...styles.autoUpdateSwitch, background: autoUpdate ? theme.accentStrong : theme.border }}
            onClick={() => onAutoUpdateChange(!autoUpdate)}
          >
            <span style={{ ...styles.autoUpdateKnob, left: autoUpdate ? 18 : 2 }} />
          </button>
        </label>
        <div style={iconRowStyle}>
          <button type="button" style={sidebarFill ? styles.headerIconButtonFull : styles.headerIconButton} onClick={onSettings} title="Settings">Settings</button>
          <button type="button" style={sidebarFill ? styles.headerIconButtonFull : styles.headerIconButton} onClick={onMini} title="Mini mode">Mini</button>
          <button type="button" style={sidebarFill ? styles.headerIconButtonFull : styles.headerIconButton} onClick={onHide} title="Hide overlay">Hide</button>
        </div>
      </div>
    </header>
  )
}

  const duration = formatClipDuration(clip.durationSeconds)
  return (
    <section style={styles.clipSpikeSection}>
      <h3 style={styles.clipSpikeHeading}>Clip spike</h3>
      <a href={clip.url} target="_blank" rel="noreferrer" style={styles.clipSpikeCard}>
        <div style={styles.clipThumbWrap}>
          {clip.thumbnailUrl ? (
            <img src={clip.thumbnailUrl} alt={clip.title} style={styles.clipThumb} loading="lazy" />
          ) : (
            <div style={styles.clipThumbFallback} />
          )}
          {duration ? <span style={styles.clipDurationBadge}>{duration}</span> : null}
        </div>
        <div style={styles.clipBody}>
          <strong style={styles.clipTitle}>{clip.title}</strong>
          <span style={styles.clipViews}>{formatNumber(clip.viewCount ?? 0)} views</span>
        </div>
      </a>
    </section>
  )
}

function SidebarHeaderBar({
  active,
  onChange,
}: {
  active: SidebarTab
  onChange: (tab: SidebarTab) => void
}) {
  const [collapseLabel, setCollapseLabel] = useState('Hide chat panel')
  const [chattersOpen, setChattersOpen] = useState(false)

  useEffect(() => {
    const sync = () => {
      setCollapseLabel(readTwitchCollapseLabel())
      setChattersOpen(isTwitchChattersOpen())
    }
    sync()
    const id = window.setInterval(sync, 600)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="pulse-sidebar-header-row">
      <button
        type="button"
        className="pulse-sidebar-header-edge pulse-sidebar-header-edge-wide"
        aria-label={collapseLabel}
        title={collapseLabel}
        onClick={() => {
          clickTwitchCollapseChat()
          window.setTimeout(() => setCollapseLabel(readTwitchCollapseLabel()), 120)
        }}
      >
        <PanelCollapseIcon />
      </button>
      <SidebarTabStrip active={active} onChange={onChange} compact />
      <button
        type="button"
        className={`pulse-sidebar-header-edge${chattersOpen ? ' pulse-sidebar-header-edge-active' : ''}`}
        aria-label={chattersOpen ? 'Close chatters list' : 'Open chatters list'}
        aria-pressed={chattersOpen}
        title={chattersOpen ? 'Close chatters list' : 'Open chatters list'}
        onClick={() => {
          toggleTwitchChatters()
          window.setTimeout(() => setChattersOpen(isTwitchChattersOpen()), 120)
        }}
      >
        <ChattersIcon />
      </button>
    </div>
  )
}

function PanelCollapseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2.5" y="4" width="7.5" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12.5 9H15.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M14.5 7 16.5 9 14.5 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChattersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5.5 7a2.25 2.25 0 1 0 0-4.5A2.25 2.25 0 0 0 5.5 7Zm5 0a2.25 2.25 0 1 0 0-4.5A2.25 2.25 0 0 0 10.5 7ZM2 12.25c0-1.933 1.567-3.5 3.5-3.5s3.5 1.567 3.5 3.5H2Zm5 0c0-1.567 1.015-2.896 2.422-3.364A3.49 3.49 0 0 0 10.5 8c.96 0 1.83.388 2.458 1.014A3.49 3.49 0 0 0 10.5 12.25H7Z" />
    </svg>
  )
}

function SidebarTabStrip({
  active,
  onChange,
  compact = false,
}: {
  active: SidebarTab
  onChange: (tab: SidebarTab) => void
  compact?: boolean
}) {
  return (
    <div
      className={`pulse-sidebar-tabs${compact ? ' pulse-sidebar-tabs-compact' : ''}`}
      role="tablist"
      aria-label="Chat or Pulse"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === 'chat'}
        className={`pulse-sidebar-tab${active === 'chat' ? ' active' : ''}`}
        onClick={() => onChange('chat')}
      >
        Chat
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'pulse'}
        className={`pulse-sidebar-tab${active === 'pulse' ? ' active' : ''}`}
        onClick={() => onChange('pulse')}
      >
        Pulse
      </button>
    </div>
  )
}

function useCountUp(value: number, duration = 420): number {
  const [display, setDisplay] = useState(value)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value)
      return
    }
    const start = display
    const diff = value - start
    if (diff === 0) return
    const startTime = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration)
      const eased = 1 - (1 - t) ** 3
      setDisplay(Math.round(start + diff * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animate from prior display
  }, [value])
  return display
}

function StreamRecap({
  recap,
  onJump,
}: {
  recap: NonNullable<PulsePayload['recap']>
  onJump: (offsetSeconds: number) => void
}) {
  return (
    <section style={styles.section}>
      <SectionHeading label="Stream Recap" meta={`${formatNumber(recap.totalMessages)} messages`} />
      <div style={styles.recapGrid}>
        <StatCard label="PEAK CHAT" value={recap.peakChatPerMin} accent={theme.live} detail="/ min" />
        <StatCard label="TOP MOMENTS" value={recap.topMoments.length} accent="#facc15" detail="ranked" />
      </div>
      {recap.topEmotes.length > 0 ? (
        <div style={styles.emoteChips}>
          {recap.topEmotes.slice(0, 5).map(emote => (
            <span key={emote.code} style={styles.emoteChip}>{emote.code} · {formatNumber(emote.count)}</span>
          ))}
        </div>
      ) : null}
      <div style={styles.momentList}>
        {recap.topMoments.slice(0, 5).map((moment, index) => (
          <article key={`${moment.offsetSeconds}-${moment.score}`} className="pulse-row-rise" style={{ ...styles.momentRow, animationDelay: `${index * 45}ms` }}>
            <span style={styles.rank}>{moment.score}</span>
            <div style={styles.momentMain}>
              <strong>{formatHeatOffset(moment.offsetSeconds)}</strong>
              <span>{reasonLabel(moment.reasons[0])}</span>
              <div style={styles.rowActions}>
                <button type="button" style={styles.textButton} onClick={() => onJump(moment.offsetSeconds)}>Open in Streamclone</button>
              </div>
            </div>
            <div style={styles.score}><strong>{moment.score}</strong><span>score</span></div>
          </article>
        ))}
      </div>
    </section>
  )
}

function BrandMark() {
  return <span style={styles.brandMark}><span style={styles.brandDot} /></span>
}

function StatusPill({ tracking, isLive, compact = false }: { tracking: boolean; isLive: boolean; compact?: boolean }) {
  return (
    <span style={tracking ? (compact ? styles.statusLiveCompact : styles.statusLive) : (compact ? styles.statusIdleCompact : styles.statusIdle)}>
      <span className={tracking && isLive ? 'pulse-live-dot' : undefined} style={tracking ? styles.dotGreen : styles.dotMuted} />
      {tracking ? (isLive ? 'Live' : 'Tracking') : 'Not tracking'}
    </span>
  )
}

function StatCard({ label, value, accent, detail }: { label: string; value: number; accent: string; detail: string }) {
  const animated = useCountUp(value)
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{formatNumber(animated)}</div>
      <div style={{ ...styles.statDetail, color: accent }}>{detail}</div>
    </div>
  )
}

function SectionHeading({ label, meta }: { label: string; meta?: string }) {
  return (
    <div style={styles.sectionHeading}>
      <span>{label}</span>
      {meta ? <span style={styles.muted}>{meta}</span> : null}
    </div>
  )
}

function HeatStrip({ values, compact = false }: { values: number[]; compact?: boolean }) {
  const display = values.slice(-30)
  if (display.length === 0 || display.every(value => value <= 0)) {
    return (
      <div style={compact ? styles.heatStripEmptyCompact : styles.heatStripEmpty} aria-hidden="true">
        {compact ? 'No heat yet' : 'Heatmap fills in after the first completed minutes'}
      </div>
    )
  }
  const max = Math.max(...display, 1)
  return (
    <div style={compact ? styles.heatStripCompact : styles.heatStrip}>
      {display.map((value, index) => {
        const hot = value >= max * 0.88 && max > 0
        return (
          <span
            key={`${index}-${value}`}
            className="pulse-bar-grow"
            style={{
              ...styles.heatBar,
              height: `${Math.max(12, Math.round((value / max) * (compact ? 34 : 92)))}%`,
              background: hot
                ? `linear-gradient(180deg, ${theme.rank1}, #fb7185)`
                : `linear-gradient(180deg, ${theme.accent}, ${theme.accentStrong})`,
              animationDelay: `${index * 18}ms`,
            }}
          />
        )
      })}
    </div>
  )
}

function WarmingState({ count, coverageStart = 0 }: { count: number; coverageStart?: number }) {
  const progress = Math.min(1, count / LIVE_HEAT_MIN_COMPLETED_ROLLUPS)
  const lateTracking = coverageStart > 60
  return (
    <section style={styles.stateBlock}>
      <h2 style={styles.stateTitle}>Warming up</h2>
      <p style={styles.stateText}>
        {lateTracking
          ? `Streamclone is tracking this broadcast (${formatHeatOffset(coverageStart)} in). Top Moments unlock after ${LIVE_HEAT_MIN_COMPLETED_ROLLUPS} completed minutes of chat rollups.`
          : `Collecting chat and 7TV activity. Top Moments unlock after ${LIVE_HEAT_MIN_COMPLETED_ROLLUPS} completed minutes, never shown as final early.`}
      </p>
      <div className="pulse-shimmer" style={styles.progressTrack}><span style={{ ...styles.progressFill, width: `${progress * 100}%` }} /></div>
      <p style={styles.muted}>{count} / {LIVE_HEAT_MIN_COMPLETED_ROLLUPS} minutes collected · updates automatically</p>
    </section>
  )
}

function BackendError({ backendUrl, onRetry, onSettings }: { backendUrl: string; onRetry: () => void; onSettings: () => void }) {
  return (
    <section style={styles.errorBlock}>
      <h2 style={styles.errorTitle}>Can&apos;t reach Streamclone</h2>
      <p style={styles.stateText}>No response from {backendUrl}. Is the Streamclone stack running? Showing this instead of empty charts.</p>
      <div style={styles.footerActions}>
        <button type="button" style={styles.secondaryButton} onClick={onRetry}>Retry</button>
        <button type="button" style={styles.textButtonLarge} onClick={onSettings}>Open settings</button>
      </div>
    </section>
  )
}

function reasonLabel(reason: string | undefined): string {
  if (!reason) return 'Moment'
  return reason.replace(/_/g, ' ').replace(/^seventv/, '7TV')
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

function formatClipDuration(durationSeconds?: number): string | null {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
  const total = Math.round(durationSeconds)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`
}

const styles: Record<string, CSSProperties> = {
  panel: { background: theme.bgCanvas, display: 'flex', flexDirection: 'column' },
  panelHidden: { display: 'none' },
  sidebarTabsWrap: { flexShrink: 0, padding: 8 },
  headerTabsShell: { alignItems: 'center', display: 'flex', height: '100%', justifyContent: 'center', width: '100%' },
  miniHost: { display: 'flex', height: '100%', width: '100%' },
  collapsedHost: { display: 'flex', height: '100%', width: '100%' },
  header: { alignItems: 'flex-start', display: 'flex', gap: 12, justifyContent: 'space-between' },
  titleRow: { alignItems: 'center', display: 'flex', gap: 12 },
  headerActions: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
  title: { fontSize: 22, fontWeight: 800, lineHeight: 1.15 },
  titleLogin: { color: theme.textSecondary, fontWeight: 700, marginLeft: 6 },
  subtitle: { color: theme.textSecondary, fontSize: 12, marginTop: 3 },
  brandMark: { alignItems: 'center', background: theme.accent, borderRadius: 10, display: 'inline-flex', height: 34, justifyContent: 'center', minWidth: 34 },
  brandDot: { background: theme.textPrimary, borderRadius: 999, display: 'block', height: 12, width: 12 },
  statusLive: { alignItems: 'center', background: 'rgba(34,197,94,0.18)', border: '1px solid rgba(34,197,94,0.55)', borderRadius: theme.radiusPill, color: theme.liveSoft, display: 'inline-flex', fontSize: 12, fontWeight: 800, gap: 8, padding: '7px 12px' },
  statusIdle: { alignItems: 'center', background: theme.panelElevated, border: `1px solid ${theme.border}`, borderRadius: theme.radiusPill, color: theme.textSecondary, display: 'inline-flex', fontSize: 12, fontWeight: 800, gap: 8, padding: '7px 12px' },
  statusLiveCompact: { alignItems: 'center', background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: theme.radiusPill, color: theme.liveSoft, display: 'inline-flex', fontSize: 10, fontWeight: 800, gap: 6, padding: '4px 8px', width: 'fit-content' },
  statusIdleCompact: { alignItems: 'center', background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: theme.radiusPill, color: theme.textSecondary, display: 'inline-flex', fontSize: 10, fontWeight: 800, gap: 6, padding: '4px 8px', width: 'fit-content' },
  dotGreen: { background: theme.live, borderRadius: 999, display: 'inline-block', height: 9, width: 9 },
  dotMuted: { background: '#6b7280', borderRadius: 999, display: 'inline-block', height: 9, width: 9 },
  trackingText: { alignItems: 'center', color: '#4ade80', display: 'inline-flex', fontWeight: 800, gap: 6 },
  muted: { color: '#8b8ba0' },
  smallButton: { background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: theme.radiusButton, color: theme.textPrimary, cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '7px 10px' },
  primaryButtonSmall: { background: theme.accent, border: 0, borderRadius: theme.radiusButton, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 800, padding: '7px 12px' },
  heatStripEmpty: { alignItems: 'center', background: '#101014', border: '1px dashed #3f3f50', borderRadius: 12, color: '#8b8ba0', display: 'flex', fontSize: 12, height: 112, justifyContent: 'center', padding: 16, textAlign: 'center' },
  heatStripEmptyCompact: { alignItems: 'center', color: '#8b8ba0', display: 'flex', fontSize: 11, height: 44, justifyContent: 'center', minWidth: 96 },
  trackPrompt: { background: '#1f1f27', border: '1px solid rgba(139, 92, 246, 0.35)', borderRadius: 12, marginBottom: 14, padding: 14 },
  statsGrid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 18 },
  recapGrid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginBottom: 12 },
  statCard: { background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 12, minWidth: 0, padding: 12 },
  statLabel: { color: '#a1a1b2', fontSize: 10, fontWeight: 800 },
  statValue: { fontSize: 26, fontWeight: 800, lineHeight: 1.15, marginTop: 6 },
  statDetail: { fontSize: 12, fontWeight: 800, marginTop: 6 },
  section: { borderTop: '1px solid rgba(63,63,80,0.75)', marginTop: 16, paddingTop: 16 },
  sectionHeading: { alignItems: 'center', color: '#a1a1b2', display: 'flex', fontSize: 12, fontWeight: 800, justifyContent: 'space-between', marginBottom: 10, textTransform: 'uppercase' },
  heatStrip: { alignItems: 'end', background: '#101014', borderRadius: 12, display: 'flex', gap: 5, height: 112, padding: '16px 14px 12px' },
  heatStripCompact: { alignItems: 'end', display: 'flex', flex: 1, gap: 5, height: 44, justifyContent: 'flex-end', minWidth: 140 },
  heatBar: { borderRadius: 4, display: 'block', flex: '1 1 7px', minWidth: 4 },
  axis: { color: '#8b8ba0', display: 'flex', fontSize: 11, justifyContent: 'space-between', marginTop: 8 },
  lanes: { display: 'grid', gap: 12 },
  lane: { alignItems: 'center', display: 'grid', gap: 14, gridTemplateColumns: '74px 1fr' },
  laneLabel: { color: '#8b8ba0', display: 'grid', fontSize: 11, gap: 2 },
  laneBars: { alignItems: 'end', display: 'flex', gap: 6, height: 34 },
  laneBar: { borderRadius: 4, display: 'block', flex: 1, minWidth: 6 },
  momentList: { display: 'grid', gap: 8 },
  momentRow: { alignItems: 'center', background: '#22222b', borderRadius: 10, display: 'grid', gap: 10, gridTemplateColumns: '34px 1fr auto', padding: '10px 12px', transition: 'transform 0.15s ease, box-shadow 0.15s ease' },
  rank: { alignItems: 'center', background: '#7c3aed', borderRadius: 9, display: 'inline-flex', fontWeight: 800, height: 34, justifyContent: 'center', width: 34 },
  momentMain: { display: 'grid', gap: 3, minWidth: 0 },
  rowActions: { display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  textButton: { background: 'transparent', border: 0, color: '#c4b5fd', cursor: 'pointer', fontSize: 11, fontWeight: 800, padding: 0 },
  textButtonLarge: { background: 'transparent', border: 0, color: '#c4b5fd', cursor: 'pointer', fontSize: 14, fontWeight: 800, padding: '8px 0' },
  score: { color: '#fb7185', display: 'grid', fontSize: 11, justifyItems: 'end' },
  footerActions: { display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr', marginTop: 14 },
  emoteChips: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  emoteChip: { alignItems: 'center', background: '#22222b', border: '1px solid #3f3f50', borderRadius: 999, color: '#fafafc', display: 'inline-flex', fontSize: 11, fontWeight: 800, gap: 6, padding: '6px 9px' },
  emoteChipImg: { display: 'block', objectFit: 'contain' },
  saveTools: { display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 12 },
  offsetInput: { background: '#101014', border: '1px solid #3f3f50', borderRadius: 10, color: '#fafafc', font: 'inherit', minWidth: 0, padding: '10px 12px' },
  savedList: { display: 'grid', gap: 8 },
  savedRow: { alignItems: 'center', background: '#22222b', borderRadius: 10, display: 'grid', gap: 10, gridTemplateColumns: '1fr auto', padding: '9px 12px' },
  savedMain: { background: 'transparent', border: 0, color: '#fafafc', cursor: 'pointer', display: 'grid', gap: 3, minWidth: 0, padding: 0, textAlign: 'left' },
  primaryButton: { background: '#8b5cf6', border: 0, borderRadius: 10, color: '#fff', cursor: 'pointer', fontWeight: 800, padding: '12px 14px' },
  secondaryButton: { background: '#2b2b32', border: '1px solid #3f3f50', borderRadius: 10, color: '#fafafc', cursor: 'pointer', fontWeight: 800, padding: '12px 14px' },
  stateBlock: { background: '#1f1f27', borderRadius: 12, marginTop: 16, padding: 16 },
  stateTitle: { fontSize: 18, margin: '0 0 10px' },
  stateText: { color: '#b7b7c6', fontSize: 13, lineHeight: 1.35, margin: '0 0 14px' },
  progressTrack: { background: '#33333d', borderRadius: 999, height: 8, marginBottom: 10, overflow: 'hidden' },
  progressFill: { background: '#a78bfa', borderRadius: 999, display: 'block', height: '100%' },
  errorBlock: { background: '#1f1f27', borderRadius: 12, padding: 16 },
  errorTitle: { color: '#f87171', fontSize: 18, margin: '0 0 10px' },
  notice: { background: '#2a2440', border: '1px solid #3f3f50', borderRadius: 10, color: '#c4b5fd', fontSize: 12, fontWeight: 700, margin: '14px 0 0', padding: '10px 12px' },
  noticeWarn: { background: 'rgba(249,115,22,0.12)', borderColor: 'rgba(249,115,22,0.35)', color: '#fdba74' },
  noticeOk: { background: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.35)', color: '#86efac' },
  streamPulseHeader: { alignItems: 'flex-start', border: '1px solid rgba(255,255,255,0.1)', borderRadius: theme.radiusButton, display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', marginBottom: 14, padding: '12px 14px', width: '100%' },
  streamPulseHeaderSidebar: { alignItems: 'stretch', border: '1px solid rgba(255,255,255,0.1)', borderRadius: theme.radiusButton, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10, padding: '10px 12px', width: '100%' },
  streamPulseHeaderMain: { flex: '1 1 180px', minWidth: 0, width: '100%' },
  streamPulseHeaderMainSidebar: { flex: '0 0 auto', minWidth: 0, width: '100%' },
  streamPulseTitleRow: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 },
  streamPulseTitle: { fontSize: 13, fontWeight: 900, letterSpacing: '0.06em', margin: 0, textTransform: 'uppercase' },
  liveBadge: { background: '#dc2626', borderRadius: 4, color: '#fff', fontSize: 10, fontWeight: 900, padding: '2px 6px', textTransform: 'uppercase' },
  streamPulseLead: { color: theme.textSecondary, fontSize: 11, fontWeight: 600, lineHeight: 1.4, margin: '6px 0 0' },
  streamPulseHeaderActions: { alignItems: 'flex-end', display: 'flex', flexDirection: 'column', flexShrink: 0, gap: 8 },
  streamPulseHeaderActionsSidebar: { alignItems: 'stretch', display: 'flex', flexDirection: 'column', gap: 10, width: '100%' },
  trackStreamerButton: { background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(167, 139, 250, 0.3)', borderRadius: theme.radiusButton, color: '#ddd6fe', cursor: 'pointer', fontSize: 11, fontWeight: 900, padding: '8px 12px', textTransform: 'uppercase' },
  trackStreamerButtonFull: { background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(167, 139, 250, 0.3)', borderRadius: theme.radiusButton, color: '#ddd6fe', cursor: 'pointer', fontSize: 11, fontWeight: 900, padding: '10px 12px', textAlign: 'center', textTransform: 'uppercase', width: '100%' },
  trackingButton: { background: '#7c3aed', border: 0, borderRadius: theme.radiusButton, color: '#fff', cursor: 'default', fontSize: 11, fontWeight: 900, padding: '8px 12px', textTransform: 'uppercase' },
  trackingButtonFull: { background: '#7c3aed', border: 0, borderRadius: theme.radiusButton, color: '#fff', cursor: 'default', fontSize: 11, fontWeight: 900, padding: '10px 12px', textAlign: 'center', textTransform: 'uppercase', width: '100%' },
  headerIconButton: { background: 'transparent', border: 0, color: theme.textMuted, cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: '2px 4px' },
  headerIconButtonFull: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: theme.textMuted, cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: '8px 6px', textAlign: 'center', width: '100%' },
  autoUpdateLabel: { alignItems: 'center', color: theme.textSecondary, display: 'flex', fontSize: 11, fontWeight: 600, gap: 8 },
  autoUpdateLabelFull: { alignItems: 'center', color: theme.textSecondary, display: 'flex', fontSize: 11, fontWeight: 600, gap: 8, justifyContent: 'space-between', width: '100%' },
  autoUpdateSwitch: { border: 0, borderRadius: 999, cursor: 'pointer', flexShrink: 0, height: 22, position: 'relative', width: 36 },
  autoUpdateKnob: { background: '#fff', borderRadius: 999, height: 18, position: 'absolute', top: 2, width: 18 },
  headerIconRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  headerIconRowFull: { display: 'grid', gap: 6, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', width: '100%' },
  coverageNotice: { color: theme.textSecondary, fontSize: 11, fontWeight: 600, lineHeight: 1.4, margin: '0 0 12px' },
  liveNowBand: { background: 'rgba(0,0,0,0.25)', border: `1px solid ${theme.border}`, borderRadius: theme.radiusButton, marginBottom: 14, padding: 12 },
  liveNowHeader: { alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 10 },
  liveNowTitle: { fontSize: 11, fontWeight: 900, letterSpacing: '0.05em', textTransform: 'uppercase' },
  syncedBadge: { background: 'rgba(34,211,238,0.15)', border: '1px solid rgba(34,211,238,0.35)', borderRadius: 999, color: theme.accent2, fontSize: 10, fontWeight: 800, padding: '3px 8px' },
  liveNowMetrics: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 10, width: '100%' },
  liveNowMetricsSidebar: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  liveNowMetricsCompact: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  liveNowMetric: { display: 'grid', gap: 2, minWidth: 0 },
  liveNowMetricLabel: { color: theme.textMuted, fontSize: 9, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' },
  liveNowMetricValue: { fontSize: 22, fontWeight: 900, lineHeight: 1.1 },
  liveNowMetricMeta: { color: theme.textSecondary, fontSize: 10, fontWeight: 600 },
  emoteProviderRate: { marginRight: 8 },
  sparklineBlock: { display: 'grid', gap: 6, marginTop: 10 },
  sparklineHeader: { alignItems: 'center', display: 'flex', justifyContent: 'space-between', gap: 8 },
  sparklineLabel: { color: theme.textMuted, fontSize: 9, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' },
  chartWindowToggle: { alignItems: 'center', display: 'inline-flex', gap: 4 },
  chartWindowButton: { background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textSecondary, cursor: 'pointer', fontSize: 10, fontWeight: 800, padding: '3px 8px', textTransform: 'uppercase' },
  chartWindowButtonActive: { background: 'rgba(139, 92, 246, 0.2)', borderColor: 'rgba(167, 139, 250, 0.45)', color: '#ddd6fe' },
  topEmotesRow: { alignItems: 'center', display: 'flex', gap: 8, marginTop: 10 },
  topEmotesLabel: { color: theme.textMuted, fontSize: 9, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' },
  topEmoteChips: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 },
  topEmoteChip: { alignItems: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid transparent', borderRadius: 6, display: 'inline-flex', gap: 6, padding: '4px 6px' },
  topEmoteChipButton: { background: 'rgba(255,255,255,0.05)', color: 'inherit', cursor: 'pointer', font: 'inherit' },
  topEmoteChipActive: { background: 'rgba(74, 222, 128, 0.12)', borderColor: 'rgba(74, 222, 128, 0.45)' },
  topEmoteImg: { display: 'block', height: 24, objectFit: 'contain', width: 24 },
  topEmoteName: { color: theme.textSecondary, fontSize: 11, fontWeight: 700 },
  topEmoteCount: { color: theme.textMuted, fontSize: 10, fontWeight: 800 },
  clipSpikeSection: { display: 'grid', gap: 10, marginBottom: 14, marginTop: 14 },
  clipSpikeHeading: { color: theme.textMuted, fontSize: 11, fontWeight: 900, letterSpacing: '0.04em', margin: 0, textTransform: 'uppercase' },
  analyticsFooter: { marginTop: 14, paddingBottom: 8, textAlign: 'center' },
  analyticsFooterLink: { background: 'transparent', border: 0, color: '#c4b5fd', cursor: 'pointer', fontSize: 11, fontWeight: 900, letterSpacing: '0.04em', padding: '4px 0', textTransform: 'uppercase' },
  clipSpikeCard: { background: 'rgba(255,255,255,0.035)', border: `1px solid ${theme.border}`, borderRadius: theme.radiusButton, color: theme.textPrimary, display: 'block', overflow: 'hidden', textDecoration: 'none' },
  clipThumbWrap: { aspectRatio: '16 / 9', background: '#101014', position: 'relative' },
  clipThumb: { display: 'block', height: '100%', objectFit: 'cover', width: '100%' },
  clipThumbFallback: { background: 'linear-gradient(135deg, #1f1f27, #101014)', height: '100%', width: '100%' },
  clipDurationBadge: { background: 'rgba(0,0,0,0.75)', borderRadius: 4, bottom: 8, color: '#fafafc', fontSize: 11, fontWeight: 800, padding: '2px 8px', position: 'absolute', right: 8 },
  clipBody: { display: 'grid', gap: 6, padding: 12 },
  clipTitle: { display: '-webkit-box', fontSize: 13, fontWeight: 800, lineHeight: 1.35, overflow: 'hidden', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 },
  clipViews: { color: theme.textMuted, fontSize: 11, fontWeight: 700 },
  collectingBadge: { background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.35)', borderRadius: 999, color: '#fde68a', display: 'inline-block', fontSize: 10, fontWeight: 800, padding: '2px 8px', width: 'fit-content' },
  footerActionsSingle: { display: 'grid', gap: 8, marginTop: 12 },
}

