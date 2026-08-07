import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import {
  clearSessionPulseCache,
  countSessionPulseEntries,
  getAutoTrackPolicy,
  getAutoUpdateEnabled,
  getBackendUrl,
  getColorSchemePreference,
  getDefaultChartWindow,
  getKeepLocalCache,
  getOverlayPlacement,
  getChatClosedPulseDockEnabled,
  getThemePreference,
  isLocalStackBackendUrl,
  setAutoTrackPolicy,
  setAutoUpdateEnabled,
  setChatClosedPulseDockEnabled,
  setColorSchemePreference,
  setDefaultChartWindow,
  setKeepLocalCache,
  setOverlayPlacement,
  setThemePreference,
  type AutoTrackPolicy,
  type ColorSchemePreference,
  type DefaultChartWindow,
  type OverlayPlacement,
  type ThemePreference,
} from '../shared/storage.ts'
import { getWatchlist, removeFromWatchlist } from '../shared/watchlist.ts'
import { applyAccentTheme } from './overlayTheme.ts'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { PulseThemedSelect } from './PulseThemedSelect.tsx'
import { theme } from './theme.ts'
import releaseManifest from '../../streampulse-web/src/lib/release-notes.json'

const HOSTED_API_HOST = 'api.streampulse.stream'
const CHANGELOG_URL = 'https://streampulse.stream/changelog'
const CURRENT_RELEASE = releaseManifest.releases.find(release => release.version === releaseManifest.currentVersion) ?? releaseManifest.releases[0]

function installedExtensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version || releaseManifest.currentVersion
  } catch {
    return releaseManifest.currentVersion
  }
}

type ConnectionKind = 'hosted' | 'local' | 'custom'

function resolveConnectionKind(url: string): ConnectionKind {
  if (isLocalStackBackendUrl(url)) return 'local'
  const normalized = url.trim().replace(/\/+$/, '').toLowerCase()
  if (normalized.includes(HOSTED_API_HOST)) return 'hosted'
  return 'custom'
}

function connectionPillLabel(kind: ConnectionKind): string {
  if (kind === 'local') return 'Local dev API'
  if (kind === 'custom') return 'Custom API'
  return 'Hosted API'
}

function connectionTitle(kind: ConnectionKind): string {
  if (kind === 'local') return 'Local StreamPulse backend'
  if (kind === 'custom') return 'Custom backend'
  return 'StreamPulse cloud'
}

function connectionHint(kind: ConnectionKind): string {
  if (kind === 'local') {
    return 'Local stack only — Track and auto-track apply here. IRC pool differs from production hosted coverage.'
  }
  if (kind === 'custom') {
    return 'Using a custom API host — charts may differ from hosted StreamPulse.'
  }
  return 'Live IRC coverage is managed by StreamPulse. Auto-track does not apply on hosted.'
}

function cacheStatusLabel(entryCount: number, enabled: boolean): string {
  if (!enabled) {
    return 'Caching is off — channels are not remembered when you switch tabs in this browser session.'
  }
  if (entryCount === 0) {
    return 'No channels cached yet this session. Snapshots expire after about 45 seconds.'
  }
  if (entryCount === 1) {
    return '1 channel cached this session. Snapshots expire after about 45 seconds.'
  }
  return `${entryCount} channels cached this session. Snapshots expire after about 45 seconds.`
}

const ACCENT_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'aurora', label: 'Aurora' },
  { value: 'volt', label: 'Volt' },
  { value: 'azure', label: 'Azure' },
]

const COLOR_SCHEME_OPTIONS: ReadonlyArray<{ value: ColorSchemePreference; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const CHART_WINDOW_OPTIONS: ReadonlyArray<{ value: DefaultChartWindow; label: string }> = [
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '60m', label: '1h' },
  { value: '2h', label: '2h' },
  { value: '4h', label: '4h' },
  { value: 'full', label: 'All' },
]

const PLACEMENT_OPTIONS: ReadonlyArray<{ value: OverlayPlacement; label: string }> = [
  { value: 'sidebar', label: 'Sidebar tab' },
  { value: 'right', label: 'Right rail' },
  { value: 'bottom', label: 'Bottom dock' },
]

const AUTO_TRACK_OPTIONS: ReadonlyArray<{ value: AutoTrackPolicy; label: string; title?: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'followed', label: 'On page open', title: 'On page open (local stack)' },
  { value: 'ask', label: 'Ask first', title: 'Ask first (local stack)' },
]

function connectionStatusLabel(url: string): string {
  return connectionTitle(resolveConnectionKind(url))
}

function segmentClass(active: boolean): string {
  return active ? 'pulse-segment-btn pulse-segment-btn-active' : 'pulse-segment-btn'
}

export function PulseSettingsPanel(props: {
  onBack?: () => void
  /** @deprecated Operator options are no longer linked from product UI. */
  onOpenFullSettings?: () => void
  onAutoUpdateChange?: (enabled: boolean) => void
}) {
  const { onBack, onAutoUpdateChange } = props
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [keepCache, setKeepCache] = useState(true)
  const [backendUrl, setBackendUrlState] = useState('')
  const [healthStatus, setHealthStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle')
  const [healthDetail, setHealthDetail] = useState('')
  const [accentTheme, setAccentTheme] = useState<ThemePreference>('aurora')
  const [colorScheme, setColorScheme] = useState<ColorSchemePreference>('auto')
  const [defaultChartWindow, setDefaultChartWindowState] = useState<DefaultChartWindow>('full')
  const [overlayPlacement, setOverlayPlacementState] = useState<OverlayPlacement>('sidebar')
  const [chatClosedDockEnabled, setChatClosedDockEnabledState] = useState(false)
  const [autoTrackPolicy, setAutoTrackPolicyState] = useState<AutoTrackPolicy>('off')
  const [watchlist, setWatchlist] = useState<string[]>([])
  const [cacheEntryCount, setCacheEntryCount] = useState(0)
  const [clearStatus, setClearStatus] = useState<'idle' | 'clearing' | 'done'>('idle')

  const connectionKind = resolveConnectionKind(backendUrl)
  const isHosted = connectionKind !== 'local'
  const showEndpoint = connectionKind === 'local'

  const reload = useCallback(async () => {
    const [au, cache, url, accent, scheme, chartWindow, placement, dockEnabled, trackPolicy, wl] = await Promise.all([
      getAutoUpdateEnabled(),
      getKeepLocalCache(),
      getBackendUrl(),
      getThemePreference(),
      getColorSchemePreference(),
      getDefaultChartWindow(),
      getOverlayPlacement(),
      getChatClosedPulseDockEnabled(),
      getAutoTrackPolicy(),
      getWatchlist(),
    ])
    setAutoUpdate(au)
    setKeepCache(cache)
    setBackendUrlState(url)
    setAccentTheme(accent)
    applyAccentTheme(accent)
    setColorScheme(scheme)
    setDefaultChartWindowState(chartWindow)
    setOverlayPlacementState(placement)
    setChatClosedDockEnabledState(dockEnabled)
    setAutoTrackPolicyState(trackPolicy)
    setWatchlist(wl)
    setCacheEntryCount(await countSessionPulseEntries())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const testConnection = async () => {
    setHealthStatus('checking')
    setHealthDetail('')
    try {
      const res = await sendBackgroundMessage({ type: 'HEALTH' })
      if ('type' in res && res.type === 'HEALTH' && res.ok) {
        setHealthStatus('ok')
        setHealthDetail(res.version ? `v${res.version}` : 'Connected')
      } else if ('type' in res && res.type === 'HEALTH') {
        setHealthStatus('fail')
        setHealthDetail(res.error ?? 'Unreachable')
      } else {
        setHealthStatus('fail')
        setHealthDetail('Unreachable')
      }
    } catch (err) {
      setHealthStatus('fail')
      setHealthDetail(err instanceof Error ? err.message : 'Unreachable')
    }
  }

  const clearCache = async () => {
    setClearStatus('clearing')
    await clearSessionPulseCache()
    setCacheEntryCount(await countSessionPulseEntries())
    setClearStatus('done')
    window.setTimeout(() => setClearStatus('idle'), 1500)
  }

  const removeWatchlistEntry = async (login: string) => {
    await removeFromWatchlist(login)
    setWatchlist(prev => prev.filter(entry => entry !== login))
  }

  const pickAccent = (value: ThemePreference) => {
    setAccentTheme(value)
    applyAccentTheme(value)
    void setThemePreference(value)
  }

  const pickColorScheme = (value: ColorSchemePreference) => {
    setColorScheme(value)
    void setColorSchemePreference(value)
  }

  return (
    <div className="pulse-settings-panel">
      {onBack ? (
        <div className="pulse-settings-nav">
          <button type="button" className="pulse-settings-back" onClick={onBack} aria-label="Back to Pulse">
            <span className="pulse-settings-back-arrow" aria-hidden="true">
              ←
            </span>
            <span className="pulse-settings-back-label">Back</span>
          </button>
        </div>
      ) : null}

      <PulseSectionCard title="Connection" titleTone="muted">
        <div className="pulse-settings-connection-head">
          <span style={connectionKind === 'local' ? apiPillLocalStyle : connectionKind === 'custom' ? apiPillCustomStyle : apiPillHostedStyle}>
            {connectionPillLabel(connectionKind)}
          </span>
          <button type="button" className="pulse-secondary-btn" onClick={() => void testConnection()}>
            {healthStatus === 'checking' ? 'Testing…' : 'Test'}
          </button>
        </div>
        <div className="pulse-settings-connection-copy">
          <div className="pulse-settings-connection-title">{connectionStatusLabel(backendUrl)}</div>
          {showEndpoint ? (
            <div className="pulse-settings-endpoint" title={backendUrl}>
              {backendUrl || '—'}
            </div>
          ) : null}
          <div className="pulse-settings-hint">{connectionHint(connectionKind)}</div>
        </div>
        {healthStatus === 'ok' ? (
          <div className="pulse-settings-status-ok">Connected{healthDetail ? ` · ${healthDetail}` : ''}</div>
        ) : null}
        {healthStatus === 'fail' ? (
          <div className="pulse-settings-status-fail">{healthDetail || 'Connection failed'}</div>
        ) : null}
      </PulseSectionCard>

      <PulseSectionCard title="Appearance" titleTone="muted">
        <div className="pulse-settings-field">
          <label className="pulse-settings-label">Color scheme</label>
          <div className="pulse-segment-row" role="group" aria-label="Color scheme">
            {COLOR_SCHEME_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                className={segmentClass(colorScheme === option.value)}
                aria-pressed={colorScheme === option.value}
                onClick={() => pickColorScheme(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="pulse-settings-hint">
            Auto follows Twitch light or dark. Light and Dark stay fixed.
          </div>
        </div>
        <div className="pulse-settings-field">
          <label className="pulse-settings-label">Accent theme</label>
          <div className="pulse-segment-row" role="group" aria-label="Accent theme">
            {ACCENT_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                className={segmentClass(accentTheme === option.value)}
                aria-pressed={accentTheme === option.value}
                onClick={() => pickAccent(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </PulseSectionCard>

      <PulseSectionCard title="Live data" titleTone="muted">
        <div className="pulse-settings-field">
          <ToggleRow
            label="Auto-update while open"
            hint="Poll for fresh Pulse data on a timer."
            checked={autoUpdate}
            onChange={checked => {
              setAutoUpdate(checked)
              void setAutoUpdateEnabled(checked)
              onAutoUpdateChange?.(checked)
            }}
          />
          <PulseThemedSelect
            label="Default chart range"
            value={defaultChartWindow}
            options={CHART_WINDOW_OPTIONS}
            ariaLabel="Default chart range"
            fullWidth
            onChange={value => {
              setDefaultChartWindowState(value)
              void setDefaultChartWindow(value)
            }}
          />
          <div className="pulse-settings-hint">
            Applied when you open a live chart. Default is All (full session so far).
          </div>
        </div>
      </PulseSectionCard>

      <PulseSectionCard title="Tracking" titleTone="muted">
        <div className="pulse-settings-field">
          <ToggleRow
            label="Show Pulse dock when chat is closed"
            hint="Off: no floating panel when the Twitch chat column is hidden. On: a Pulse panel appears in the bottom-right when chat is closed. CHAT/PULSE tabs always show when chat is open."
            checked={chatClosedDockEnabled}
            onChange={checked => {
              setChatClosedDockEnabledState(checked)
              void setChatClosedPulseDockEnabled(checked)
            }}
          />
        </div>
        <div className="pulse-settings-field">
          <label className="pulse-settings-label">Overlay placement</label>
          <div className="pulse-segment-row">
            {PLACEMENT_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                className={segmentClass(overlayPlacement === option.value)}
                onClick={() => {
                  setOverlayPlacementState(option.value)
                  void setOverlayPlacement(option.value)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="pulse-settings-hint">
            Where the Pulse dock appears when chat is closed. Requires “Show Pulse dock when chat is closed”.
            While chat is open, Pulse always stays in the sidebar tab.
          </div>
        </div>
        <div className="pulse-settings-field">
          <label className="pulse-settings-label">Auto-track channels</label>
          <div className="pulse-segment-row">
            {AUTO_TRACK_OPTIONS.map(option => {
              const disabled = isHosted
              return (
                <button
                  key={option.value}
                  type="button"
                  className={segmentClass(autoTrackPolicy === option.value)}
                  title={option.title}
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return
                    setAutoTrackPolicyState(option.value)
                    void setAutoTrackPolicy(option.value)
                  }}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          <div className="pulse-settings-hint">
            {isHosted
              ? 'Off on hosted — live Pulse in the extension is limited to the active IRC pool. Browse tracked channels on the Analytics hub.'
              : 'Local stack only — starts IRC when you open a channel (policy above).'}
          </div>
        </div>
        <div className="pulse-settings-field">
          <label className="pulse-settings-label">{isHosted ? 'Saved channels (Protect)' : 'Watchlist'}</label>
          {watchlist.length === 0 ? (
            <div className="pulse-settings-hint">
              {isHosted
                ? 'No saved channels. Adding one does not enable live Pulse in the extension until IRC capacity expands — use the Analytics hub to browse tracked channels.'
                : 'No channels saved yet. Use Track in the overlay on a local stack, or browse the Analytics hub.'}
            </div>
          ) : (
            <div style={watchlistStyle}>
              {isHosted ? (
                <p className="pulse-settings-hint">
                  Saved for backend Protect when we scale — does not enable live Pulse or backfill in the extension today.
                </p>
              ) : null}
              {watchlist.map(login => (
                <div key={login} style={watchlistRowStyle}>
                  <span>{login}</span>
                  <button type="button" className="pulse-link-btn" onClick={() => void removeWatchlistEntry(login)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </PulseSectionCard>

      <PulseSectionCard title="Storage" titleTone="muted">
        <ToggleRow
          label="Remember recently opened channels"
          hint="Store a short-lived Pulse snapshot per channel in this browser session only."
          checked={keepCache}
          onChange={checked => {
            setKeepCache(checked)
            void setKeepLocalCache(checked)
          }}
        />
        <div className="pulse-settings-cache-meta">{cacheStatusLabel(cacheEntryCount, keepCache)}</div>
        <button type="button" className="pulse-secondary-btn" style={fullWidthBtn} onClick={() => void clearCache()}>
          {clearStatus === 'clearing' ? 'Clearing…' : clearStatus === 'done' ? 'Cleared' : 'Clear session cache'}
        </button>
      </PulseSectionCard>

      <PulseSectionCard title="About & updates" titleTone="muted">
        <div className="pulse-settings-connection-copy">
          <div style={aboutReleaseHeaderStyle}>
            <div className="pulse-settings-connection-title">StreamPulse extension v{installedExtensionVersion()}</div>
            {CURRENT_RELEASE ? (
              <span style={CURRENT_RELEASE.status === 'released' ? releasePillStyle : previewPillStyle}>
                {CURRENT_RELEASE.status === 'released' ? 'Released' : 'Preview'}
              </span>
            ) : null}
          </div>
          <div className="pulse-settings-hint">
            {CURRENT_RELEASE?.summary ?? 'Latest release notes'}
          </div>
        </div>
        <a
          className="pulse-link-btn"
          href={CHANGELOG_URL}
          target="_blank"
          rel="noreferrer"
          title="Open the public StreamPulse changelog"
          style={{ display: 'inline-block', marginTop: 8 }}
        >
          Read release notes →
        </a>
      </PulseSectionCard>
    </div>
  )
}

function ToggleRow(props: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="pulse-settings-toggle-row">
      <div>
        <div className="pulse-settings-label">{props.label}</div>
        {props.hint ? <div className="pulse-settings-hint">{props.hint}</div> : null}
      </div>
      <input
        type="checkbox"
        className="pulse-settings-toggle"
        checked={props.checked}
        onChange={event => props.onChange(event.target.checked)}
      />
    </label>
  )
}

const fullWidthBtn: CSSProperties = { width: '100%' }

const aboutReleaseHeaderStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  justifyContent: 'space-between',
}

const releasePillStyle: CSSProperties = {
  background: 'var(--pulse-surface-status-ok-bg, rgba(34, 197, 94, 0.14))',
  border: '1px solid var(--pulse-surface-status-ok-border, rgba(34, 197, 94, 0.4))',
  borderRadius: 999,
  color: 'var(--pulse-surface-status-ok-text, #86efac)',
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: '0.06em',
  padding: '3px 8px',
  textTransform: 'uppercase',
}

const previewPillStyle: CSSProperties = {
  ...releasePillStyle,
  background: 'var(--pulse-surface-status-warn-bg, rgba(245, 158, 11, 0.14))',
  borderColor: 'var(--pulse-surface-status-warn-border, rgba(245, 158, 11, 0.4))',
  color: 'var(--pulse-surface-status-warn-text, #fcd34d)',
}

const apiPillHostedStyle: CSSProperties = {
  background: 'var(--pulse-surface-status-ok-bg, rgba(34, 197, 94, 0.14))',
  border: '1px solid var(--pulse-surface-status-ok-border, rgba(34, 197, 94, 0.4))',
  borderRadius: 999,
  color: 'var(--pulse-surface-status-ok-text, #86efac)',
  display: 'inline-block',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.04em',
  padding: '3px 10px',
  textTransform: 'uppercase',
}

const apiPillCustomStyle: CSSProperties = {
  background: 'var(--pulse-accent-surface, rgba(139, 92, 246, 0.14))',
  border: '1px solid var(--pulse-accent-border, rgba(139, 92, 246, 0.35))',
  borderRadius: 999,
  color: 'var(--pulse-accent-text, var(--pulse-accent-ink, #ddd6fe))',
  display: 'inline-block',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.04em',
  padding: '3px 10px',
  textTransform: 'uppercase',
}

const apiPillLocalStyle: CSSProperties = {
  background: 'var(--pulse-surface-status-warn-bg, rgba(245, 158, 11, 0.14))',
  border: '1px solid var(--pulse-surface-status-warn-border, rgba(245, 158, 11, 0.4))',
  borderRadius: 999,
  color: 'var(--pulse-surface-status-warn-text, #fcd34d)',
  display: 'inline-block',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.04em',
  padding: '3px 10px',
  textTransform: 'uppercase',
}

const watchlistStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
}

const watchlistRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 12,
  color: theme.textPrimary,
}
