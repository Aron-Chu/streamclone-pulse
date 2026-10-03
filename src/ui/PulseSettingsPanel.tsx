import { PulseBannerQuickPreview } from './PulseBanner.tsx'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { backgroundErrorMessage, EXTENSION_RECONNECT_MESSAGE } from '../shared/backgroundResponse.ts'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { readTwitchChannelAvatarUrl } from '../content/twitch.ts'
import { ACCENT_THEME_OPTIONS } from './overlayTheme.ts'
import { ChoicePicker } from './ChoicePicker.tsx'
import { DENSITY_OPTIONS, PLACEMENT_OPTIONS } from './preferenceOptions.ts'
import { usePulseHealth } from './usePulseHealth.ts'
import { usePulsePreferences } from './usePulsePreferences.ts'
import { useSupporterAppearance } from './useSupporterAppearance.ts'
import { SUPPORTER_FINISH_OPTIONS, type SupporterFinishId } from './supporterFinish.ts'
import { SettingsGearIcon } from './SettingsGearIcon.tsx'
import { formatCount } from './mostReacted.ts'
import type { PulsePanelSurfaceState } from './pulsePanelLayout.ts'
import type { SettingsHostSection } from '../shared/messages.ts'

const RELEASE_PREVIEW = __EXTENSION_RELEASE_PREVIEW__

/** The Twitch channel the panel is open on, from data the overlay already holds. */
export interface QuickSettingsChannel {
  login: string
  displayName?: string | null
  isLive: boolean
  category?: string | null
  /** A current count only; leave it out rather than show a stale one. */
  viewerCount?: number | null
  startedAt?: string | null
  surface: PulsePanelSurfaceState
}

function useSettingsHostOpener() {
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  async function open(section: SettingsHostSection): Promise<void> {
    setOpening(true)
    setError(null)
    try {
      const response = await sendBackgroundMessage({ type: 'OPEN_SETTINGS_HOST', section })
      const failure = backgroundErrorMessage(response, EXTENSION_RECONNECT_MESSAGE)
      if (failure || !response || !('type' in response) || response.type !== 'OPEN_SETTINGS_HOST') setError(failure ?? EXTENSION_RECONNECT_MESSAGE)
    } catch {
      setError(EXTENSION_RECONNECT_MESSAGE)
    } finally { setOpening(false) }
  }
  return { error, opening, open }
}

/**
 * Pinned where the Pulse view keeps its Settings bar, so the way out to the
 * full settings page sits in the same place on both views.
 */
export function OpenAllSettingsButton({ style }: { style?: CSSProperties }) {
  const { error, opening, open } = useSettingsHostOpener()
  return (
    <>
      {error ? <p className="pulse-settings-hint pulse-settings-footer-error" role="alert">{error}</p> : null}
      <button
        type="button"
        className="pulse-settings-bottom-bar"
        data-settings-host-cta="pulse"
        style={style}
        title="Open all settings in a new tab"
        disabled={opening}
        onClick={() => void open('pulse')}
      >
        <SettingsGearIcon size={16} />
        <span>{opening ? 'Opening settings…' : 'Open all settings'}</span>
        <span aria-hidden="true">↗</span>
      </button>
    </>
  )
}

const SURFACE_STATUS: Record<PulsePanelSurfaceState, { tone: 'ok' | 'wait' | 'idle' | 'bad'; copy: (name: string) => string }> = {
  live_tracked: { tone: 'ok', copy: () => 'Pulse is charting this stream live.' },
  live_late: { tone: 'ok', copy: () => 'Pulse joined partway through. Charting from here on.' },
  live_untracked: { tone: 'wait', copy: () => 'Pulse isn’t charting this stream right now.' },
  offline_recap: { tone: 'ok', copy: () => 'Stream ended. The replay recap is ready.' },
  offline_empty: { tone: 'idle', copy: name => `${name} is offline. Nothing to chart right now.` },
  unsupported: { tone: 'wait', copy: name => `${name} is outside the channels Pulse covers.` },
  identity_mismatch: { tone: 'wait', copy: () => 'The stream just changed. Pulse is catching up.' },
  loading: { tone: 'wait', copy: () => 'Getting Pulse ready…' },
  error: { tone: 'bad', copy: () => 'Pulse data isn’t loading right now.' },
}

function uptimeLabel(startedAt: string | null | undefined, now = Date.now()): string | null {
  const started = startedAt ? Date.parse(startedAt) : NaN
  // Twitch ends a broadcast at 48 h, so anything longer is a stale start time.
  if (!Number.isFinite(started) || started > now || now - started > 48 * 3_600_000) return null
  const minutes = Math.floor((now - started) / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

export function PulseSettingsPanel({ onBack, channel }: { onBack?: () => void; channel?: QuickSettingsChannel }) {
  const preferences = usePulsePreferences()
  // The header owns this poll on the Pulse tab and is unmounted while settings
  // are open, so reading it here does not double the worker round trips.
  const finish = useSupporterAppearance()
  const { health, checking, refresh, error: connectionError } = usePulseHealth()
  const { error: openError, opening, open: openHost } = useSettingsHostOpener()

  const reachable = health?.ok === true
  const apiStatus = checking ? 'checking' : reachable ? 'connected' : 'unreachable'
  const isSidebar = preferences.placement === 'sidebar'
  const name = channel?.displayName?.trim() || channel?.login || ''
  const surface = channel ? SURFACE_STATUS[channel.surface] : null
  const status = checking
    ? { tone: 'wait', copy: 'Checking StreamPulse…' }
    : connectionError
      ? { tone: 'bad', copy: 'Extension disconnected' }
      : !reachable
        ? { tone: 'bad', copy: 'Can’t reach StreamPulse. Try again.' }
        : surface
          ? { tone: surface.tone, copy: surface.copy(name) }
          : { tone: 'ok', copy: 'Connected to StreamPulse' }

  return (
    <div
      className={`pulse-settings-panel pulse-settings-overlay-workspace pulse-density-${preferences.density}`}
      data-overlay-settings-panel="true"
      data-settings-surface="overlay"
      data-pulse-density={preferences.density}
    >
      <div className="pulse-settings-nav">
        {onBack ? (
          <button type="button" className="pulse-link-btn" onClick={onBack}>← Back to Pulse</button>
        ) : <span />}
        {preferences.status ? (
          <span
            className={preferences.status === 'Saved' ? 'pulse-settings-saved' : 'pulse-settings-status-fail'}
            role="status"
          >
            {preferences.status === 'Saved' ? '✓ Saved' : preferences.status}
          </span>
        ) : null}
        <h1>Quick settings</h1>
        {!isSidebar && onBack ? (
          <button
            type="button"
            className="pulse-link-btn"
            style={{ fontSize: 11 }}
            aria-label="Close settings"
            onClick={onBack}
          >
            ✕
          </button>
        ) : null}
      </div>

      <div className="pulse-settings-status-card">
        {channel ? <ChannelHeader key={channel.login} channel={channel} name={name} /> : null}
        <div className="pulse-settings-connection" data-settings-connection="true">
          <span className="pulse-settings-status-dot" data-tone={status.tone} aria-hidden="true" />
          <span className="pulse-settings-connection-copy">
            <strong data-api-status={apiStatus}>{status.copy}</strong>
          </span>
          <button
            type="button"
            className="pulse-settings-retest"
            aria-label="Test connection"
            title="Test connection"
            disabled={checking}
            onClick={() => void refresh(true)}
          >
            {checking ? '…' : '↻'}
          </button>
        </div>
      </div>
      {connectionError ? <p className="pulse-settings-hint" role="status">{connectionError}</p> : null}

      <SupporterHero finish={finish} disabled={opening} onOpen={() => void openHost('supporter')} />
      {openError ? <p className="pulse-settings-hint" role="alert">{openError}</p> : null}

      <section className="pulse-settings-quick" aria-label="Extension preferences">
        <QuickGroup title="Live data">
          <ToggleRow
            id="pulse-auto-update"
            label="Refresh live data automatically"
            hint="Auto-update activity and viewer counts."
            checked={preferences.autoUpdate}
            onChange={preferences.setAutoUpdate}
          />
        </QuickGroup>

        <QuickGroup title="Layout">
          <div className="pulse-settings-field pulse-settings-control-block">
            <span className="pulse-settings-label">Density</span>
            <ChoicePicker
              kind="density"
              variant="compact"
              groupLabel="Density"
              options={DENSITY_OPTIONS}
              value={preferences.density}
              onChange={next => void preferences.setDensity(next)}
            />
          </div>

          <div className="pulse-settings-field pulse-settings-control-block">
            <span className="pulse-settings-label">Placement</span>
            <ChoicePicker
              kind="placement"
              variant="compact"
              groupLabel="Placement"
              options={PLACEMENT_OPTIONS.map(option => ({
                ...option,
                icon: <span className="pulse-placement-icon" data-placement={option.value} aria-hidden="true" />,
              }))}
              value={preferences.placement}
              onChange={next => void preferences.setPlacement(next)}
            />
          </div>

          <ToggleRow
            id="pulse-chat-dock"
            label="Dock when chat is closed"
            hint={isSidebar ? 'Show a mini Pulse dock when Twitch chat is hidden.' : 'Docking is only available when placement is set to Sidebar.'}
            checked={preferences.dock}
            disabled={!isSidebar}
            onChange={preferences.setDock}
          />
        </QuickGroup>

        <QuickGroup title="Appearance">
          <div className="pulse-settings-field pulse-settings-control-block">
            <span className="pulse-settings-label">Accent</span>
            <ChoicePicker
              kind="accent"
              variant="compact"
              groupLabel="Accent"
              options={ACCENT_THEME_OPTIONS}
              value={preferences.accent}
              onChange={next => void preferences.setAccent(next)}
            />
          </div>
          <div className="pulse-settings-field pulse-settings-control-block">
            <span className="pulse-settings-label">Background &amp; motion</span>
            <PulseBannerQuickPreview />
            <button type="button" className="pulse-link-btn" data-banner-editor-cta="true" disabled={opening} onClick={() => void openHost('pulse')}>
              Edit background in all settings ↗
            </button>
          </div>
        </QuickGroup>
      </section>

      <details className="pulse-settings-release-preview" data-changelog-preview="true">
        <summary>
          <span className="pulse-settings-release-version">v{RELEASE_PREVIEW.version}</span>
          <span className="pulse-settings-release-title">
            <strong>What&rsquo;s new</strong>
            <small>{RELEASE_PREVIEW.title}</small>
          </span>
          <span className="pulse-settings-release-chevron" aria-hidden="true">›</span>
        </summary>
        <div className="pulse-settings-release-body pulse-tab-fade">
          <ul>
            {RELEASE_PREVIEW.bullets.slice(0, 3).map(item => <li key={item}>{item}</li>)}
          </ul>
          <button
            type="button"
            className="pulse-link-btn"
            data-settings-host-cta="updates"
            disabled={opening}
            onClick={() => void openHost('updates')}
          >
            View full changelog ↗
          </button>
        </div>
      </details>

      <button
        type="button"
        className="pulse-link-btn pulse-settings-reset"
        onClick={() => void preferences.resetAppearanceAndLayout()}
      >
        <span aria-hidden="true">↺</span> Reset appearance and layout to defaults
      </button>
    </div>
  )
}

function ChannelHeader({ channel, name }: { channel: QuickSettingsChannel; name: string }) {
  const [avatar, setAvatar] = useState(() => readTwitchChannelAvatarUrl(channel.login, channel.displayName))
  const replay = channel.surface === 'offline_recap'
  const uptime = channel.isLive ? uptimeLabel(channel.startedAt) : null
  const facts = [channel.category, uptime ? `live ${uptime}` : null].filter(Boolean).join(' · ')
  return (
    <div className="pulse-settings-channel" data-live={channel.isLive ? 'true' : undefined}>
      <span className="pulse-settings-channel-avatar" aria-hidden="true">
        {avatar
          ? <img src={avatar} alt="" referrerPolicy="no-referrer" onError={() => setAvatar(undefined)} />
          : name.charAt(0).toUpperCase()}
      </span>
      <span className="pulse-settings-channel-copy">
        <small>{channel.isLive ? 'Watching' : replay ? 'Replay' : 'Visiting'}</small>
        <strong>{name}</strong>
        {facts ? <span>{facts}</span> : null}
      </span>
      {channel.isLive ? (
        <span className="pulse-settings-channel-live">
          <b>LIVE</b>
          {channel.viewerCount != null ? <span title={`${channel.viewerCount.toLocaleString('en-US')} viewers`}>{formatCount(channel.viewerCount)}</span> : null}
        </span>
      ) : null}
    </div>
  )
}

/** The Pulse Peak as a neon tube: the shape of the brand mark, scaled to run across the card. */
const SUPPORTER_TUBE = 'M-8 41H54l7-15.75 5.25 8.75 7-29.75 7 29.75 5.25-8.75 7 15.75H1000'
const SUPPORTER_TUBE_LAYERS = ['glass', 'bloom', 'neon', 'beam', 'spark']
/** wideSpeedNod and wideReacting on 7TV; `x` is each one's resting spot on the tube. */
const SUPPORTER_EMOTES = [
  { id: '01K6YP3JPX47KY68B19S6MY6DY', x: 104 },
  { id: '01HMM8VG3R0007GXBD883VP2YY', x: 186 },
]

/**
 * The Supporter entry, drawn as a neon sign. Hover or focus switches the tube
 * on, runs a laser pulse along it and lets two 7TV emotes rush in; the emote
 * images load only once someone shows interest. The overlay cannot read the
 * full entitlement, but a non-null finish is one the worker verified, so only
 * then does the card say so, and only then is the sign lit at rest in that
 * finish's colour. Without one it stays neutral: no price, no purchase wording.
 */
export function SupporterHero({ finish, disabled, onOpen }: { finish: SupporterFinishId | null; disabled?: boolean; onOpen: () => void }) {
  const [armed, setArmed] = useState(false)
  const finishLabel = finish ? SUPPORTER_FINISH_OPTIONS.find(option => option.id === finish)?.label : undefined
  const arm = () => { if (!armed) setArmed(true) }
  return (
    <button
      type="button"
      className="pulse-settings-supporter-cta"
      data-settings-host-cta="supporter"
      data-supporter-verified={finish ? 'true' : undefined}
      data-finish={finish ?? undefined}
      disabled={disabled}
      onClick={onOpen}
      onPointerEnter={arm}
      onFocus={arm}
    >
      <span className="pulse-settings-supporter-head">
        <strong>Pulse Supporter</strong>
        <span className="pulse-settings-supporter-action">{finish ? 'Manage Supporter' : 'Explore Supporter'} <span aria-hidden="true">›</span></span>
      </span>
      <small>{finishLabel ? `${finishLabel} finish equipped. Thanks for backing Pulse.` : 'Light up your panel with a personal finish. Core tools stay free.'}</small>
      <span className="pulse-settings-supporter-sign" aria-hidden="true">
        <svg width="1000" height="48" viewBox="0 0 1000 48" focusable="false">
          {SUPPORTER_TUBE_LAYERS.map(layer => <path key={layer} className={`pulse-sign-${layer}`} d={SUPPORTER_TUBE} />)}
          <circle className="pulse-sign-flare" cx="73.25" cy="4.25" r="6" />
        </svg>
        {armed ? SUPPORTER_EMOTES.map((emote, index) => (
          <picture key={emote.id}>
            <source media="(prefers-reduced-motion: reduce)" srcSet={`https://cdn.7tv.app/emote/${emote.id}/2x_static.webp`} />
            <source type="image/avif" srcSet={`https://cdn.7tv.app/emote/${emote.id}/1x.avif`} />
            <img
              alt=""
              draggable={false}
              decoding="async"
              referrerPolicy="no-referrer"
              src={`https://cdn.7tv.app/emote/${emote.id}/1x.webp`}
              style={{ '--i': index, left: emote.x } as CSSProperties}
              onLoad={event => { event.currentTarget.dataset.ready = '' }}
              onError={event => { event.currentTarget.style.visibility = 'hidden' }}
            />
          </picture>
        )) : null}
      </span>
    </button>
  )
}

function QuickGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pulse-quick-group">
      <h2 className="pulse-quick-group-title">{title}</h2>
      <div className="pulse-quick-group-card">{children}</div>
    </div>
  )
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void | Promise<void>
}) {
  return (
    <div className={`pulse-settings-toggle-row pulse-settings-control-block${disabled ? ' pulse-settings-control-disabled' : ''}`}>
      <div>
        <label className="pulse-settings-label" htmlFor={id} style={disabled ? { opacity: 0.6 } : undefined}>{label}</label>
        {hint ? <span className="pulse-settings-hint" style={disabled ? { opacity: 0.6 } : undefined}>{hint}</span> : null}
      </div>
      <input
        id={id}
        type="checkbox"
        className="pulse-settings-toggle"
        checked={checked}
        disabled={disabled}
        onChange={event => void onChange(event.target.checked)}
      />
    </div>
  )
}
