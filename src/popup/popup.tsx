import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { getBackendUrl, getThemePreference, setOverlayMode, setSidebarTab } from '../shared/storage.ts'
import { extensionBackendSourceCaption, extensionBackendSourceLabel, resolveExtensionBackendSource } from '../shared/backendSource.ts'
import { installedExtensionVersion } from '../shared/releaseManifest.ts'
import { openHubAnalytics } from '../shared/analyticsLinks.ts'
import { applyAccentTheme } from '../ui/overlayTheme.ts'
import { replayUrl } from '../ui/library/model.ts'
import type { HubSnapshot } from '../shared/hubSnapshot.ts'
import type { MyMomentsRecent } from '../shared/myMoments.ts'
import { popupStyles } from './popupStyles.ts'
import {
  formatAgo,
  formatClock,
  formatCount,
  formatSince,
  emoteImage,
  popupShowsDeviceHistory,
  popupTabView,
  safeImageUrl,
  sparkGeometry,
  summarizeChannel,
  type PopupChannelSummary,
  type PopupTabView,
} from './popupModel.ts'

type Health = { state: 'checking' } | { state: 'ok'; version?: string } | { state: 'down' }
type ChannelLoad =
  | { status: 'loading' }
  | { status: 'ready'; summary: PopupChannelSummary }
  | { status: 'error' }
type HubLoad = { status: 'loading' } | { status: 'ready'; snapshot: HubSnapshot } | { status: 'error' }

const PULSE_TIMEOUT_MS = 8_000

function PopupApp() {
  const [backendUrl, setBackendUrl] = useState('')
  const [health, setHealth] = useState<Health>({ state: 'checking' })
  const [view, setView] = useState<PopupTabView | null>(null)
  const [tabId, setTabId] = useState<number | null>(null)
  const [channel, setChannel] = useState<ChannelLoad>({ status: 'loading' })
  const [avatar, setAvatar] = useState<string | null>(null)
  const [hub, setHub] = useState<HubLoad>({ status: 'loading' })
  const [recent, setRecent] = useState<MyMomentsRecent | null>(null)

  const checkHealth = useCallback(async () => {
    setHealth({ state: 'checking' })
    try {
      const res = await sendBackgroundMessage({ type: 'HEALTH' })
      setHealth('type' in res && res.type === 'HEALTH' && res.ok ? { state: 'ok', version: res.version } : { state: 'down' })
    } catch {
      setHealth({ state: 'down' })
    }
  }, [])

  const loadChannel = useCallback(async (login: string) => {
    setChannel({ status: 'loading' })
    try {
      const res = await Promise.race([
        sendBackgroundMessage({ type: 'GET_PULSE', login, window: 'recent' }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), PULSE_TIMEOUT_MS)),
      ])
      if (!('type' in res) || res.type !== 'PULSE_UPDATE' || (!res.payload && res.error)) {
        setChannel({ status: 'error' })
        return
      }
      setChannel({ status: 'ready', summary: summarizeChannel(login, res.payload, res.coverageTier) })
    } catch {
      setChannel({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    void getThemePreference().then(applyAccentTheme).catch(() => null)
    void getBackendUrl().then(setBackendUrl).catch(() => null)
    void checkHealth()
    void (async () => {
      let tab: chrome.tabs.Tab | undefined
      try {
        ;[tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      } catch {
        // Restricted contexts cannot read the active tab.
      }
      const next = popupTabView(tab?.url)
      setView(next)
      if (typeof tab?.id === 'number') setTabId(tab.id)
      if (next.kind === 'elsewhere' || next.kind === 'browsing') {
        void sendBackgroundMessage({ type: 'HUB_SNAPSHOT' })
          .then(res => setHub('type' in res && res.type === 'HUB_SNAPSHOT' && res.snapshot ? { status: 'ready', snapshot: res.snapshot } : { status: 'error' }))
          .catch(() => setHub({ status: 'error' }))
        // A private window never reads this profile's history or saves.
        if (popupShowsDeviceHistory(next, await popupWindowIncognito(tab))) {
          void sendBackgroundMessage({ type: 'MY_MOMENTS', action: 'recent' })
            .then(res => { if ('type' in res && res.type === 'MY_MOMENTS_RECENT') setRecent(res.recent) })
            .catch(() => null)
        }
      }
      if (next.kind !== 'channel') return
      void loadChannel(next.login)
      if (typeof tab?.id === 'number') void readChannelAvatar(tab.id, next.login).then(setAvatar)
    })()

    const storageChanged = globalThis.chrome?.storage?.onChanged
    if (!storageChanged?.addListener) return
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.themePreference) void getThemePreference().then(applyAccentTheme).catch(() => null)
      if (changes.backendUrl) void getBackendUrl().then(setBackendUrl).catch(() => null)
    }
    storageChanged.addListener(listener)
    return () => storageChanged.removeListener(listener)
  }, [checkHealth, loadChannel])

  async function openPulsePanel(): Promise<void> {
    if (tabId === null) return
    await Promise.all([
      setSidebarTab('pulse').catch(() => null),
      setOverlayMode('expanded').catch(() => null),
    ])
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'OPEN_PULSE_SIDEBAR' })
    } catch {
      // The content script may still be loading; the stored mode opens Pulse when it mounts.
    }
    await chrome.tabs.update(tabId, { active: true }).catch(() => null)
    window.close()
  }

  async function openUrl(url: string): Promise<void> {
    try {
      await chrome.tabs.create({ url })
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  /** Opens a live channel with the Pulse panel already showing. */
  async function openStream(login: string): Promise<void> {
    await Promise.all([
      setSidebarTab('pulse').catch(() => null),
      setOverlayMode('expanded').catch(() => null),
    ])
    await openUrl(`https://www.twitch.tv/${login}`)
    window.close()
  }

  async function openSettings(section: 'moments' | 'pulse' = 'pulse'): Promise<void> {
    const request = section === 'moments'
      ? { type: 'OPEN_SETTINGS_HOST' as const, section: 'moments' as const }
      : { type: 'OPEN_SETTINGS_HOST' as const, section: 'pulse' as const }
    await sendBackgroundMessage(request).catch(() => null)
  }

  const source = backendUrl ? resolveExtensionBackendSource(backendUrl) : 'hosted'

  return (
    <main className="pp">
      <header className="pp-top">
        <img className="pp-mark" src="../icons/icon48.png" alt="" />
        <p className="pp-word">StreamPulse</p>
        <button
          type="button"
          className="pp-icon"
          data-popup-action="open-settings"
          aria-label="Open settings"
          title="Settings"
          onClick={() => void openSettings()}
        >
          <GearIcon />
        </button>
      </header>

      {view?.kind === 'channel' ? (
        <ChannelCard login={view.login} load={channel} avatar={avatar} onOpen={() => void openPulsePanel()} onRetry={() => void loadChannel(view.login)} />
      ) : view?.kind === 'vod' ? (
        <section className="pp-card pp-hero" aria-labelledby="pp-hero-title">
          <h1 id="pp-hero-title">Watching a replay</h1>
          <p>Pulse charts this VOD’s chat beside the video, with its biggest moments ready to jump to.</p>
          <button type="button" className="pp-primary" data-popup-action="open-pulse" onClick={() => void openPulsePanel()}>
            Open Pulse panel <ArrowIcon />
          </button>
        </section>
      ) : view ? (
        <>
          {recent ? <JumpBackIn recent={recent} onReplay={url => void openUrl(url)} onOpenMoments={() => void openSettings('moments')} /> : null}
          {hub.status === 'error' ? (
            <section className="pp-card pp-hero" aria-labelledby="pp-hero-title">
              <h1 id="pp-hero-title">{view.kind === 'browsing' ? 'Pick a stream' : 'Pulse lives beside Twitch chat'}</h1>
              <p>{view.kind === 'browsing'
                ? 'Pulse appears beside chat on every channel page.'
                : 'Open any stream to see its chat activity, biggest moments and top clips.'}</p>
              {view.kind === 'elsewhere' ? (
                <button type="button" className="pp-primary" data-popup-action="open-pulse" onClick={() => void openUrl('https://www.twitch.tv')}>
                  Open Twitch
                </button>
              ) : null}
            </section>
          ) : (
            <LiveNow
              title={view.kind === 'browsing' ? 'Pick a stream' : 'Live on Pulse now'}
              hub={hub}
              onOpenStream={login => void openStream(login)}
              onOpenTwitch={view.kind === 'elsewhere' ? () => void openUrl('https://www.twitch.tv') : undefined}
            />
          )}
        </>
      ) : (
        <section className="pp-card" aria-busy="true" aria-label="Loading">
          <SkeletonChannel />
        </section>
      )}

      <nav className="pp-links" aria-label="StreamPulse">
        <LinkTile
          label="My Moments"
          description="Saves & history"
          icon={<BookmarkIcon />}
          action="open-moments"
          onClick={() => void openSettings('moments')}
        />
        {/* Analytics hub opens through the shared hub link, like the overlay CTA. */}
        <LinkTile
          label="Analytics Hub"
          accessibleName="Open analytics hub"
          description="Stream history"
          icon={<ChartIcon />}
          external
          action="open-hub"
          onClick={() => openHubAnalytics(backendUrl)}
        />
      </nav>

      <footer className="pp-foot">
        <span className="pp-dot" data-tone={health.state === 'ok' ? 'ok' : health.state === 'down' ? 'bad' : undefined} aria-hidden="true" />
        <span role="status" title={backendUrl ? extensionBackendSourceCaption(backendUrl) + (health.state === 'ok' && health.version ? ` · API ${health.version}` : '') : undefined}>
          {health.state === 'ok' ? 'Connected' : health.state === 'down' ? 'Can’t reach StreamPulse' : 'Checking connection…'}
        </span>
        {health.state === 'down' ? (
          <button type="button" className="pp-inline" onClick={() => void checkHealth()}>Retry</button>
        ) : null}
        {source !== 'hosted' ? <span className="pp-source">{extensionBackendSourceLabel(source)}</span> : null}
        <span className="pp-version">v{installedExtensionVersion()}</span>
      </footer>
    </main>
  )
}

function ChannelCard({ login, load, avatar, onOpen, onRetry }: {
  login: string
  load: ChannelLoad
  avatar: string | null
  onOpen: () => void
  onRetry: () => void
}) {
  if (load.status === 'loading') {
    return (
      <section className="pp-card" aria-busy="true" aria-label={`Loading ${login}`}>
        <SkeletonChannel />
      </section>
    )
  }
  const summary = load.status === 'ready' ? load.summary : null
  const name = summary?.displayName ?? login
  const isLive = summary?.isLive ?? false
  const meta = summary
    ? isLive
      ? [summary.category, summary.uptime].filter(Boolean).join(' · ')
      : [summary.endedAt ? `Last live ${formatSince(summary.endedAt)}` : null, summary.category].filter(Boolean).join(' · ')
    : null

  return (
    <section className="pp-card" aria-labelledby="pp-channel-name">
      <div className="pp-chan">
        {avatar ? (
          <img className="pp-avatar" src={avatar} alt="" data-live={isLive ? '' : undefined} />
        ) : (
          <span className="pp-avatar" aria-hidden="true" data-live={isLive ? '' : undefined}>{name.charAt(0).toUpperCase()}</span>
        )}
        <div style={{ minWidth: 0 }}>
          <p className="pp-eyebrow">{isLive ? 'Watching' : 'Channel'}</p>
          <h1 className="pp-name" id="pp-channel-name">{name}</h1>
          {meta ? <p className="pp-meta">{meta}</p> : null}
        </div>
        {summary ? <span className="pp-badge" data-tone={isLive ? undefined : 'offline'}>{isLive ? 'Live' : 'Offline'}</span> : null}
      </div>

      {load.status === 'error' ? (
        <p className="pp-note">
          <strong>Couldn’t load chat activity</strong>
          The Pulse panel may still have it. <button type="button" className="pp-inline" onClick={onRetry}>Try again</button>
        </p>
      ) : summary && !summary.tracked ? (
        <p className="pp-note">
          <strong>Pulse isn’t charting this channel yet</strong>
          Open the panel to see what’s available here.
        </p>
      ) : summary ? (
        <ChannelPulse summary={summary} />
      ) : null}

      <button type="button" className="pp-primary" data-popup-action="open-pulse" onClick={onOpen}>
        Open Pulse panel <ArrowIcon />
      </button>
    </section>
  )
}

function ChannelPulse({ summary }: { summary: PopupChannelSummary }) {
  const gradientId = 'pp-spark-fill'
  // Matches the card's content box so the stroke is not stretched.
  const width = 270
  const height = 44
  const geometry = sparkGeometry(summary.spark, width, height)
  const hasSpark = geometry.line !== ''
  const label = summary.isLive ? 'Chat activity · last 30 min' : 'Last stream · chat activity'
  const description = summary.isLive && summary.chatPerMinute !== null
    ? `${label}. Latest minute: ${formatCount(summary.chatPerMinute)} messages.`
    : label

  return (
    <>
      <div className="pp-activity">
        <div className="pp-row">
          <p className="pp-label">{label}</p>
          {summary.isLive && summary.chatPerMinute !== null ? (
            <span className="pp-rate">{formatCount(summary.chatPerMinute)} <small>msgs/min</small></span>
          ) : null}
        </div>
        {hasSpark ? (
          <>
            <svg className="pp-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={description}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" className="pp-spark-fill-top" />
                  <stop offset="1" className="pp-spark-fill-bottom" />
                </linearGradient>
              </defs>
              <path className="pp-spark-area" d={geometry.area} />
              <path className="pp-spark-line" d={geometry.line} pathLength={1} />
              {summary.isLive && geometry.last ? (
                <>
                  <circle className="pp-spark-halo" cx={geometry.last.x} cy={geometry.last.y} r={3} />
                  <circle className="pp-spark-dot" cx={geometry.last.x} cy={geometry.last.y} r={3} />
                </>
              ) : null}
            </svg>
            <div className="pp-axis" aria-hidden="true">
              <span>{summary.isLive ? `${Math.min(summary.spark.length, 30)} min ago` : 'Start'}</span>
              <span>{summary.isLive ? 'Now' : 'End'}</span>
            </div>
          </>
        ) : (
          <p className="pp-note">{summary.isLive ? 'Waiting for the first minute of chat.' : 'No chat activity recorded for the last stream.'}</p>
        )}
      </div>

      {summary.viewers !== null || summary.topEmote ? (
        <dl className="pp-stats">
          {summary.viewers !== null ? (
            <div className="pp-stat">
              <dt>Watching now</dt>
              <dd><span>{formatCount(summary.viewers)}</span></dd>
            </div>
          ) : null}
          {summary.topEmote ? (
            <div className="pp-stat">
              <dt>Top emote</dt>
              <dd>
                {summary.topEmote.imageUrl ? <img className="pp-emote" src={summary.topEmote.imageUrl} alt="" /> : null}
                <span>{summary.topEmote.name}</span>
                <small>×{formatCount(summary.topEmote.count)}</small>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {summary.biggest ? (
        <p className="pp-moment">
          <BoltIcon />
          <span><b>Biggest moment</b> · {summary.biggest.label}</span>
          <time>{summary.biggest.agoSeconds !== null ? formatAgo(summary.biggest.agoSeconds) : `at ${formatClock(summary.biggest.offsetSeconds)}`}</time>
        </p>
      ) : null}
    </>
  )
}

function LinkTile({ label, accessibleName, description, icon, external = false, action, onClick }: {
  label: string
  accessibleName?: string
  description: string
  icon: ReactNode
  external?: boolean
  action: string
  onClick: () => void
}) {
  const id = useId()
  return (
    <button
      type="button"
      className="pp-link"
      data-popup-action={action}
      aria-label={accessibleName}
      aria-labelledby={accessibleName ? undefined : `${id}-label`}
      aria-describedby={`${id}-desc`}
      onClick={onClick}
    >
      <span className="pp-link-icon" aria-hidden="true">{icon}</span>
      <span className="pp-link-label" id={`${id}-label`}>{label}{external ? <ExternalIcon /> : null}</span>
      <span className="pp-link-desc" id={`${id}-desc`}>{description}{external ? <span className="pp-sr"> (opens in a new tab)</span> : null}</span>
    </button>
  )
}

/** The last moments jumped to on this device, and its saves; only shown when there are some. */
function JumpBackIn({ recent, onReplay, onOpenMoments }: {
  recent: MyMomentsRecent
  onReplay: (url: string) => void
  onOpenMoments: () => void
}) {
  // One row keeps the popup short: the latest replayable moment, else the saves.
  const watched = recent.watched.flatMap(moment => {
    const url = replayUrl(moment)
    return url ? [{ moment, url }] : []
  }).slice(0, 1)
  if (watched.length === 0 && recent.deviceSaves === 0) return null
  return (
    <section className="pp-card" aria-labelledby="pp-jump-title">
      <p className="pp-label" id="pp-jump-title">Jump back in</p>
      <ul className="pp-jump-list">
        {watched.map(({ moment, url }) => (
          <li key={moment.id}>
            <button type="button" className="pp-jump" data-popup-action="replay" onClick={() => onReplay(url)}>
              <span className="pp-jump-icon" aria-hidden="true"><BoltIcon /></span>
              <span className="pp-jump-text">
                <b>{moment.channel} · {moment.title}</b>
                <small>Watched {formatSince(moment.jumpedAt)} · replay at {formatClock(moment.offsetSeconds ?? 0)}</small>
              </span>
              <span className="pp-jump-go" aria-hidden="true">Watch ›</span>
            </button>
          </li>
        ))}
        {watched.length === 0 && recent.deviceSaves > 0 ? (
          <li>
            <button type="button" className="pp-jump" data-popup-action="open-saves" onClick={onOpenMoments}>
              <span className="pp-jump-icon" aria-hidden="true"><BookmarkIcon /></span>
              <span className="pp-jump-text">
                <b>{recent.deviceSaves === 1 ? '1 save' : `${formatCount(recent.deviceSaves)} saves`} on this device</b>
                {recent.latestSave ? <small>Latest: {recent.latestSave.channel} · {recent.latestSave.title}</small> : null}
              </span>
              <span className="pp-jump-go" aria-hidden="true">Open ›</span>
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  )
}

/** The busiest chats Pulse is reading right now, each one click from its stream. */
function LiveNow({ title, hub, onOpenStream, onOpenTwitch }: {
  title: string
  hub: Exclude<HubLoad, { status: 'error' }>
  onOpenStream: (login: string) => void
  onOpenTwitch?: () => void
}) {
  const snapshot = hub.status === 'ready' ? hub.snapshot : null
  const busiest = snapshot ? Math.max(...snapshot.channels.map(channel => channel.chatPerMin), 1) : 1
  return (
    <section className="pp-card pp-live" aria-labelledby="pp-live-title" aria-busy={snapshot ? undefined : true}>
      {snapshot && snapshot.topEmotes.length > 0 ? <EmoteTicker emotes={snapshot.topEmotes} /> : null}
      <div className="pp-row">
        <h1 className="pp-live-title" id="pp-live-title">{title}</h1>
        {snapshot ? <span className="pp-live-count">{formatCount(snapshot.liveChannels)} live</span> : null}
      </div>
      {snapshot && (snapshot.viewers !== null || snapshot.emotesPerMin !== null) ? (
        <p className="pp-live-stats">
          {snapshot.viewers !== null ? <><b>{formatCount(snapshot.viewers)}</b> watching</> : null}
          {snapshot.viewers !== null && snapshot.emotesPerMin !== null ? ' · ' : null}
          {snapshot.emotesPerMin !== null ? <><b>{formatCount(snapshot.emotesPerMin)}</b> emotes/min</> : null}
        </p>
      ) : null}
      <ul className="pp-chan-list">
        {snapshot ? snapshot.channels.map(channel => {
          const avatar = safeImageUrl(channel.avatarUrl)
          const rate = Math.round(channel.chatPerMin)
          return (
            <li key={channel.login}>
              <button
                type="button"
                className="pp-chan-row"
                data-popup-action="open-stream"
                aria-label={`Watch ${channel.displayName} with Pulse. ${formatCount(channel.viewers)} watching, ${formatCount(rate)} chat messages a minute.`}
                onClick={() => onOpenStream(channel.login)}
              >
                {avatar
                  ? <img className="pp-chan-avatar" src={avatar} alt="" />
                  : <span className="pp-chan-avatar" aria-hidden="true">{channel.displayName.charAt(0).toUpperCase()}</span>}
                <span className="pp-chan-text">
                  <b>{channel.displayName}</b>
                  <small>{formatCount(channel.viewers)} watching{channel.category ? ` · ${channel.category}` : ''}</small>
                </span>
                <span className="pp-chan-rate" aria-hidden="true">
                  <b>{formatCount(rate)}<small>/min</small></b>
                  <span className="pp-chan-bar"><span style={{ width: `${Math.max(6, Math.round(channel.chatPerMin / busiest * 100))}%` }} /></span>
                </span>
              </button>
            </li>
          )
        }) : [0, 1, 2].map(index => (
          <li key={index} className="pp-chan-row" aria-hidden="true">
            <span className="pp-chan-avatar pp-skel" />
            <span className="pp-chan-text"><span className="pp-skel" style={{ height: 11, width: 96 }} /><span className="pp-skel" style={{ height: 9, width: 140 }} /></span>
          </li>
        ))}
      </ul>
      {snapshot && snapshot.channels.length === 0 ? <p className="pp-note">No chats are busy enough to show right now.</p> : null}
      {/* The rows already open Twitch; the plain button is only for an empty list. */}
      {onOpenTwitch && snapshot && snapshot.channels.length === 0 ? (
        <button type="button" className="pp-quiet" data-popup-action="open-pulse" onClick={onOpenTwitch}>Open Twitch</button>
      ) : null}
    </section>
  )
}

/** The most-used emotes across those chats, drifting by like a ticker. */
function EmoteTicker({ emotes }: { emotes: HubSnapshot['topEmotes'] }) {
  const items = emotes.map((emote, index) => {
    const image = emoteImage(emote.imageUrl)
    return (
      <span className="pp-tick" key={`${emote.name}-${index}`}>
        {image ? (
          <picture>
            {image.still ? <source media="(prefers-reduced-motion: reduce)" srcSet={image.still} /> : null}
            <img className="pp-tick-emote" src={image.src} alt="" />
          </picture>
        ) : null}
        {emote.name}<small>×{formatCount(emote.count)}</small>
      </span>
    )
  })
  return (
    <div className="pp-ticker">
      <p className="pp-sr">Top emotes in the last 30 minutes: {emotes.map(emote => `${emote.name}, ${formatCount(emote.count)} uses`).join('; ')}.</p>
      {/* Two copies make the loop seamless; the second is decoration only. */}
      <div className="pp-ticker-track" aria-hidden="true">{items}{items}</div>
    </div>
  )
}

function SkeletonChannel() {
  return (
    <>
      <div className="pp-chan">
        <span className="pp-avatar pp-skel" />
        <div style={{ display: 'grid', gap: 6 }}>
          <span className="pp-skel" style={{ height: 10, width: 56 }} />
          <span className="pp-skel" style={{ height: 14, width: 120 }} />
        </div>
      </div>
      <span className="pp-skel" style={{ display: 'block', height: 56, marginTop: 14 }} />
      <span className="pp-skel" style={{ display: 'block', height: 40, marginTop: 12, borderRadius: 8 }} />
    </>
  )
}

/**
 * Whether the popup is showing in a private window: the active tab says so,
 * else the popup's own window. Undefined when neither can be read.
 */
async function popupWindowIncognito(tab: chrome.tabs.Tab | undefined): Promise<boolean | undefined> {
  if (typeof tab?.incognito === 'boolean') return tab.incognito
  try {
    const current = await chrome.windows.getCurrent()
    return typeof current?.incognito === 'boolean' ? current.incognito : undefined
  } catch {
    return undefined
  }
}

/** Reads the channel avatar Twitch already shows, so the popup sends no request of its own. */
async function readChannelAvatar(tabId: number, login: string): Promise<string | null> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [login],
      func: (channel: string) => {
        for (const image of document.querySelectorAll<HTMLImageElement>('.channel-info-content img.tw-image-avatar')) {
          if (image.alt.trim().toLowerCase() === channel) return image.currentSrc || image.src
        }
        return null
      },
    })
    return safeImageUrl(typeof result?.result === 'string' ? result.result : null)
  } catch {
    return null
  }
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  )
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 4h12v16l-6-4-6 4V4Z" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  )
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  )
}

const styleElement = document.createElement('style')
styleElement.id = 'streampulse-popup-styles'
styleElement.textContent = popupStyles
document.head.append(styleElement)
createRoot(document.getElementById('root')!).render(<PopupApp />)
