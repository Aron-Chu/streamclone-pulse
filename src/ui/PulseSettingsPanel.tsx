import { PeakMark } from './PeakMark.tsx'
import { PulseBannerQuickPreview } from './PulseBanner.tsx'
import { theme } from './theme.ts'
import { compactViewerSamplingLabel, summarizeViewerSampling } from '../shared/viewerSamplingStatus.ts'
import { useState } from 'react'
import { backgroundErrorMessage, EXTENSION_RECONNECT_MESSAGE } from '../shared/backgroundResponse.ts'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { ACCENT_THEME_OPTIONS } from './overlayTheme.ts'
import { ChoicePicker } from './ChoicePicker.tsx'
import { DENSITY_OPTIONS, PLACEMENT_OPTIONS } from './preferenceOptions.ts'
import { usePulseHealth } from './usePulseHealth.ts'
import { usePulsePreferences } from './usePulsePreferences.ts'
import type { SettingsHostSection } from '../shared/messages.ts'

const RELEASE_PREVIEW = __EXTENSION_RELEASE_PREVIEW__

export function PulseSettingsPanel({ onBack }: { onBack?: () => void }) {
  const preferences = usePulsePreferences()
  const { health, checking, refresh, error: connectionError } = usePulseHealth()
  const [openError, setOpenError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  async function openHost(section: SettingsHostSection = 'pulse'): Promise<void> {
    setOpening(true)
    setOpenError(null)
    try {
      const response = await sendBackgroundMessage({ type: 'OPEN_SETTINGS_HOST', section })
      const failure = backgroundErrorMessage(response, EXTENSION_RECONNECT_MESSAGE)
      if (failure || !response || !('type' in response) || response.type !== 'OPEN_SETTINGS_HOST') setOpenError(failure ?? EXTENSION_RECONNECT_MESSAGE)
    } catch {
      setOpenError(EXTENSION_RECONNECT_MESSAGE)
    } finally { setOpening(false) }
  }

  const reachable = health?.ok === true
  const apiStatus = checking ? 'checking' : reachable ? 'connected' : 'unreachable'
  const sampler = summarizeViewerSampling(reachable ? health?.viewerSampling : undefined)
  const samplerLabel = reachable ? compactViewerSamplingLabel(sampler) : 'Unknown'
  const isSidebar = preferences.placement === 'sidebar'

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
        <h1>Quick settings</h1>
        {!isSidebar && onBack ? (
          <button
            type="button"
            className="pulse-link-btn"
            style={{ fontSize: 11, marginLeft: 'auto' }}
            aria-label="Close settings"
            onClick={onBack}
          >
            ✕
          </button>
        ) : null}
      </div>

      <div className="pulse-settings-connection" data-settings-connection="true">
        <span className={`pulse-settings-status-dot pulse-settings-status-dot-${apiStatus}`} aria-hidden="true" />
        <span className="pulse-settings-connection-copy">
          <strong data-api-status={apiStatus}>
            {checking ? 'Checking connection' : reachable ? `Connected · v${RELEASE_PREVIEW.version}` : connectionError ? 'Extension disconnected' : 'API unreachable'}
          </strong>
          <small data-sampler-status={sampler.state}>Sampler · {samplerLabel}</small>
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
      {connectionError ? <p className="pulse-settings-hint" role="status">{connectionError}</p> : null}

      <button
        type="button"
        className="pulse-settings-open-all"
        data-settings-host-cta="pulse"
        disabled={opening}
        onClick={() => void openHost('pulse')}
      >
        <span>{opening ? 'Opening settings…' : 'Open all settings'}</span>
        <span aria-hidden="true">↗</span>
      </button>
      {openError ? <p className="pulse-settings-hint" role="alert">{openError}</p> : null}

      <section className="pulse-settings-quick" aria-label="Extension preferences">
        <div className="pulse-settings-section-heading">
          <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: theme.textSecondary }}>
            Quick controls
          </span>
          {preferences.status ? (
            <span
              className={preferences.status === 'Saved' ? 'pulse-settings-saved' : 'pulse-settings-status-fail'}
              role="status"
            >
              {preferences.status}
            </span>
          ) : null}
        </div>

        <h2 className="pulse-quick-group-title">Live data</h2>
        <ToggleRow
          id="pulse-auto-update"
          label="Refresh live data automatically"
          hint="Auto-update activity and viewer counts."
          checked={preferences.autoUpdate}
          onChange={preferences.setAutoUpdate}
        />

        <h2 className="pulse-quick-group-title">Layout</h2>
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

        <h2 className="pulse-quick-group-title">Appearance</h2>
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

        <div style={{ paddingTop: 6, paddingBottom: 2 }}>
          <button
            type="button"
            className="pulse-link-btn"
            style={{ fontSize: 10, color: theme.textMuted, cursor: 'pointer', padding: 0 }}
            onClick={() => void preferences.resetAppearanceAndLayout()}
          >
            Reset appearance and layout to defaults
          </button>
        </div>
      </section>

      <button
        type="button"
        className="pulse-settings-supporter-cta"
        data-settings-host-cta="supporter"
        disabled={opening}
        onClick={() => void openHost('supporter')}
      >
        <PeakMark size={20} stroke={theme.accentSoft} className="pulse-settings-supporter-mark" />
        <span className="pulse-settings-supporter-text">
          <strong>Pulse Supporter</strong>
          <small>Personal finishes. Core tools stay free.</small>
        </span>
        <span aria-hidden="true">›</span>
      </button>

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
