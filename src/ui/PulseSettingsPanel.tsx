import { PulseBannerBackdrop, PulseBannerLoadError, usePulseBanner } from './PulseBanner.tsx'
import { openCommunity } from './AnalyticsHubCta.tsx'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { getMomentPicturesEnabled, getVodJumpChartPinEnabled, setMomentPicturesEnabled, setVodJumpChartPinEnabled } from '../shared/storage.ts'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { readTwitchChannelAvatarUrl } from '../content/twitch.ts'
import { ACCENT_THEME_OPTIONS } from './overlayTheme.ts'
import { ChoicePicker } from './ChoicePicker.tsx'
import { DENSITY_OPTIONS, PLACEMENT_OPTIONS } from './preferenceOptions.ts'
import { AUTO_UPDATE_LABEL, DENSITY_LABEL, DOCK_LABEL, LIVE_SETTINGS_TITLE, PLACEMENT_LABEL, VOD_JUMP_PIN_LABEL } from './settingLabels.ts'
import { usePulseHealth } from './usePulseHealth.ts'
import { usePulsePreferences } from './usePulsePreferences.ts'
import { useSupporterAppearanceDetails, type SupporterAppearance } from './useSupporterAppearance.ts'
import { useSettingsHostOpener } from './OpenAllSettingsButton.tsx'
import { formatCount } from './mostReacted.ts'
import type { PulsePanelSurfaceState } from './pulsePanelLayout.ts'
import type { SupporterCardOptions } from '../supporter/cardContract.ts'
import { names as SUPPORTER_PERK_NAMES } from '../shared/supporter-perks.json'

/**
 * Quick settings, the panel's settings view. It ships in
 * content/quick-settings.js (src/content/quickSettings.ts), never in
 * content/twitch.js: the worker injects it when the panel is first hovered,
 * focused or asked for its settings, and the overlay switches views once it is
 * here (src/ui/quickSettings.ts). It shares React and every module that keeps
 * state with the content script (src/shared/quickSettingsContract.ts).
 */

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

const BACKDROP_OPTIONS = [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] as const
const PAINT_OPTIONS = [{ value: 'default', label: 'Default' }, { value: 'glass', label: 'Glass' }, { value: 'etched', label: 'Etched' }, { value: 'halo', label: 'Halo' }] as const
type Paint = typeof PAINT_OPTIONS[number]['value']

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
  const appearance = useSupporterAppearanceDetails()
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

      <SupporterHero appearance={appearance} disabled={opening} onOpen={() => void openHost('supporter')} />
      {openError ? <p className="pulse-settings-hint" role="alert">{openError}</p> : null}

      <div className="pulse-quick-community">
        <button type="button" className="pulse-quick-discord" data-community-link="discord" onClick={() => openCommunity('discord')}>Join the Discord ↗</button>
        <button type="button" data-community-link="feedback" onClick={() => openCommunity('feedback')}>Send feedback ↗</button>
      </div>

      <section className="pulse-settings-quick" aria-label="Extension preferences">
        <QuickLook appearance={appearance} disabled={opening} onOpen={() => void openHost('supporter')} />

        <QuickGroup title="Moments">
          <StoredToggleRow label="Moment pictures" hint="Kept on this device with your saves, never uploaded." read={getMomentPicturesEnabled} write={setMomentPicturesEnabled} />
          <StoredToggleRow label={VOD_JUMP_PIN_LABEL} read={getVodJumpChartPinEnabled} write={setVodJumpChartPinEnabled} />
          <div className="pulse-settings-toggle-row pulse-settings-control-block">
            <span className="pulse-settings-label">My Moments</span>
            <button type="button" className="pulse-link-btn" data-settings-host-cta="moments" disabled={opening} onClick={() => void openHost('moments')}>Open ↗</button>
          </div>
        </QuickGroup>

        <QuickGroup title={LIVE_SETTINGS_TITLE}>
          <ToggleRow
            id="pulse-auto-update"
            label={AUTO_UPDATE_LABEL}
            checked={preferences.autoUpdate}
            onChange={preferences.setAutoUpdate}
          />
        </QuickGroup>

        <QuickGroup title="Layout">
          <div className="pulse-settings-field pulse-settings-control-block">
            <span className="pulse-settings-label">{DENSITY_LABEL}</span>
            <ChoicePicker
              kind="density"
              variant="compact"
              groupLabel={DENSITY_LABEL}
              options={DENSITY_OPTIONS}
              value={preferences.density}
              onChange={next => void preferences.setDensity(next)}
            />
          </div>

          <div className="pulse-settings-field pulse-settings-control-block">
            <span className="pulse-settings-label">{PLACEMENT_LABEL}</span>
            <ChoicePicker
              kind="placement"
              variant="compact"
              groupLabel={PLACEMENT_LABEL}
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
            label={DOCK_LABEL}
            hint={isSidebar ? 'Show a mini Pulse dock when Twitch chat is hidden.' : 'Docking needs Sidebar placement.'}
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
        </QuickGroup>
      </section>

      {/* One line: this version's title, with every change in all settings. */}
      <section className="pulse-settings-release-preview" data-changelog-preview="true" aria-label="What's new">
        <span className="pulse-settings-release-version">v{RELEASE_PREVIEW.version}</span>
        <span><strong>What&rsquo;s new:</strong> {RELEASE_PREVIEW.title}</span>
        <button type="button" className="pulse-link-btn" data-settings-host-cta="updates" disabled={opening} onClick={() => void openHost('updates')}>All ↗</button>
      </section>

      <button
        type="button"
        className="pulse-link-btn pulse-settings-reset"
        onClick={() => void preferences.resetAppearanceAndLayout()}
      >
        <span aria-hidden="true">↺</span> Reset appearance and layout
      </button>
    </div>
  )
}

function ChannelHeader({ channel, name }: { channel: QuickSettingsChannel; name: string }) {
  const [avatar, setAvatar] = useState(() => readTwitchChannelAvatarUrl(channel.login, channel.displayName))
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

/**
 * The Supporter entry, with the design lab's "Your Line" card: Anatomy for
 * someone who is not a Supporter (their would-be line, with its crest and
 * paint), and Tenure Climb for a
 * verified Supporter, whatever their finish, climbing to the crest the server
 * reports. No price, no purchase wording. The chat column is a preview drawn
 * in the extension (its corner chip says so); Twitch chat is unchanged.
 *
 * The card shows only its title row and the moving stage, which takes the
 * room a line of copy used to cover. The copy stays as the button's
 * description for screen readers and its tooltip: every perk, named in the
 * order of the one perk list (src/shared/supporter-perks.json).
 */
export function SupporterHero({ appearance, disabled, onOpen }: { appearance: SupporterAppearance | null; disabled?: boolean; onOpen: () => void }) {
  const finish = appearance?.finish ?? null
  const descriptionId = useId()
  const perks = `${appearance ? 'Your Supporter perks' : 'Supporter perks'}: ${SUPPORTER_PERK_NAMES.join(', ')}. Only you see them. The chat lines are a preview; Twitch chat doesn't change. Core tools stay free.`
  return (
    <button
      type="button"
      className="pulse-settings-supporter-cta"
      data-settings-host-cta="supporter"
      data-supporter-verified={appearance ? 'true' : undefined}
      data-finish={finish ?? undefined}
      disabled={disabled}
      aria-describedby={descriptionId}
      title={perks}
      onClick={onOpen}
    >
      <span className="pulse-supporter-cta-head">
        <strong>Pulse Supporter</strong>
        <span>{appearance ? 'Manage Supporter' : 'Explore Supporter'} <span aria-hidden="true">›</span></span>
      </span>
      <span id={descriptionId} hidden>{perks}</span>
      <SupporterCardStage mode={appearance ? 'tenure' : 'anatomy'} tenure={appearance?.tenure} finish={finish} paint={appearance?.paint} />
    </button>
  )
}

/**
 * The card's moving stage. Its drawing code is not part of this content
 * script: the worker injects content/supporter-card.js into this tab the first
 * time the card is shown, and the stage runs what it registers. Until then, or
 * if it cannot load, the stage is an empty strip of the same height.
 */
function SupporterCardStage(card: SupporterCardOptions) {
  const ref = useRef<HTMLSpanElement>(null)
  const key = JSON.stringify(card)
  useEffect(() => {
    let live = true
    let stop: (() => void) | undefined
    const start = () => {
      const mount = globalThis.__pulseSupporterCard
      if (live && mount && ref.current) stop = mount(ref.current, JSON.parse(key))
    }
    if (globalThis.__pulseSupporterCard) start()
    else sendBackgroundMessage({ type: 'SUPPORTER_CARD_SCRIPT' }).then(start, () => {})
    return () => { live = false; stop?.() }
  }, [key])
  return <span ref={ref} className="pulse-supporter-stage" aria-hidden="true" />
}

function QuickGroup({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="pulse-quick-group">
      <h2 className="pulse-quick-group-title">{title}</h2>
      <div className="pulse-quick-group-card">{children}</div>
    </div>
  )
}

/**
 * Backdrop and paint, tried on a strip of the panel header. It starts from
 * what the panel draws. A Supporter's backdrop saves at once, like the other
 * quick settings, still or drifting with their motion; anyone else only tries
 * it here, and closing the drawer undoes the try. Paint is only tried here: the
 * worker takes account changes from extension pages alone, so it is equipped in
 * all settings. A Supporter's crest shows under any paint.
 */
export function QuickLook({ appearance, disabled, onOpen }: { appearance: SupporterAppearance | null; disabled?: boolean; onOpen: () => void }) {
  const banner = usePulseBanner()
  const perks = appearance?.perks === true
  const [backdrop, setBackdrop] = useState<'off' | 'on'>()
  const [tried, setTried] = useState<Paint>()
  const worn = appearance?.finish ?? 'default'
  const paint = tried ?? worn
  const finish = paint === 'default' ? null : paint
  const on = perks ? banner.value.mode !== 'off' : backdrop === 'on'
  // A backdrop that is on keeps how it moves; one turned on moves with the motion.
  const moving = banner.value.mode !== 'off' ? banner.value.mode : appearance?.paint?.sheen === 'none' ? 'still' : 'rain'
  const mode = on ? moving : 'off'
  const title = banner.value.title || 'Stream Pulse'
  return (
    <QuickGroup title={<>Your look{perks ? null : <span className="pulse-quick-chip">Supporter · preview</span>}</>}>
      <div className="pulse-settings-control-block">
        <div className="pulse-quick-look" aria-hidden="true">
          <PulseBannerBackdrop value={{ ...banner.value, mode }} finish={finish} perks />
          {appearance || finish ? <i className="pulse-crest" data-tenure={appearance?.tenure ?? 'new'} /> : null}
          <strong className={finish ? 'pulse-paint' : undefined} data-finish={finish ?? undefined} data-wave={appearance?.paint?.wave} data-sheen={appearance?.paint?.sheen} data-text={title}>{title}</strong>
        </div>
      </div>
      <div className="pulse-settings-field pulse-settings-control-block" aria-busy={perks && (!banner.ready || banner.saving) || undefined}>
        <span className="pulse-settings-label">Backdrop</span>
        <ChoicePicker kind="look" variant="compact" groupLabel="Backdrop" options={BACKDROP_OPTIONS} value={on ? 'on' : 'off'}
          onChange={next => {
            if (!perks) setBackdrop(next)
            else if (banner.ready && !banner.saving) void banner.save({ ...banner.value, mode: next === 'on' ? moving : 'off' })
          }} />
        {banner.loadError ? <PulseBannerLoadError onRetry={() => void banner.reload()} /> : null}
        {banner.status && banner.status !== 'Saved' ? <span role="status">{banner.status}</span> : null}
      </div>
      <div className="pulse-settings-field pulse-settings-control-block">
        <span className="pulse-settings-label">Paint</span>
        <ChoicePicker kind="look" variant="compact" groupLabel="Paint" options={PAINT_OPTIONS} value={paint} onChange={setTried} />
      </div>
      <button type="button" className="pulse-link-btn pulse-settings-control-block" disabled={disabled} onClick={onOpen}>
        {perks && paint !== worn ? `Equip ${PAINT_OPTIONS.find(option => option.value === paint)?.label} in all settings ↗` : 'Motion and saved looks in all settings ↗'}
      </button>
    </QuickGroup>
  )
}

/** A synced on/off setting the drawer reads once and saves on each change. */
function StoredToggleRow({ label, hint, read, write }: { label: string; hint?: string; read: () => Promise<boolean>; write: (on: boolean) => Promise<void> }) {
  const id = useId()
  const [on, setOn] = useState<boolean>()
  useEffect(() => {
    let live = true
    read().then(value => { if (live) setOn(value) }, () => {})
    return () => { live = false }
  }, [read])
  return <ToggleRow id={id} label={label} hint={hint} checked={on === true} disabled={on === undefined}
    onChange={next => { setOn(next); write(next).catch(() => setOn(!next)) }} />
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
        <label className="pulse-settings-label" htmlFor={id}>{label}</label>
        {hint ? <span className="pulse-settings-hint">{hint}</span> : null}
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
