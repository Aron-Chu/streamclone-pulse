import { SupporterAccountSection } from '../options/SupporterAccountSection.tsx'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { SettingsHostSection } from '../shared/messages.ts'
import { POLICY_LINKS } from '../shared/portalLinks.ts'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { backgroundErrorMessage } from '../shared/backgroundResponse.ts'
import {
  DEFAULT_KEEP_LOCAL_CACHE,
  clearSessionPulseCache,
  countSessionPulseEntries,
  getKeepLocalCache,
  getVodJumpChartPinEnabled,
  setKeepLocalCache,
  setVodJumpChartPinEnabled,
} from '../shared/storage.ts'
import {
  EXTENSION_DIAGNOSTICS_INGEST_ENABLED,
  isDiagnosticsConsentEnabled,
  setDiagnosticsConsentEnabled,
} from '../shared/diagnosticsConsent.ts'
import { isAnalyticsConsentGranted, setAnalyticsConsentGranted } from '../shared/analyticsConsent.ts'
import { EXTENSION_ANALYTICS_INGEST_ENABLED } from '../shared/extensionAnalytics.ts'
import { installedExtensionVersion } from '../shared/releaseManifest.ts'
import { compactViewerSamplingLabel, summarizeViewerSampling } from '../shared/viewerSamplingStatus.ts'
import { ChangelogCard } from './ChangelogCard.tsx'
import { ACCENT_THEME_OPTIONS } from './overlayTheme.ts'
import { ChoicePicker } from './ChoicePicker.tsx'
import { DENSITY_OPTIONS, PLACEMENT_OPTIONS } from './preferenceOptions.ts'
import { withDescriptions } from '../options/preferenceDescriptions.ts'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { usePulseHealth } from './usePulseHealth.ts'
import { usePulsePreferences } from './usePulsePreferences.ts'
import { PulseBannerControls } from './PulseBanner.tsx'

type UpdateCapability = 'loading' | 'supported' | 'browser' | 'development'


function useTransientStatus(): [string, (message?: string) => void] {
  const [status, setStatus] = useState('')
  const timerRef = useRef<number | null>(null)
  const show = useCallback((message = 'Saved') => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
    setStatus(message)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setStatus('')
    }, 1_500)
  }, [])
  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
  }, [])
  return [status, show]
}

function useAdministrativeSettings() {
  const [keepCache, setKeepCacheState] = useState(DEFAULT_KEEP_LOCAL_CACHE)
  const [cacheEntryCount, setCacheEntryCount] = useState(0)
  const [cacheBusy, setCacheBusy] = useState(false)
  const [analyticsConsent, setAnalyticsConsentState] = useState(false)
  const [diagnosticsConsent, setDiagnosticsConsentState] = useState(false)
  const [updateCapability, setUpdateCapability] = useState<UpdateCapability>('loading')
  const [updateStatus, setUpdateStatus] = useState('')
  const [savedStatus, showSavedStatus] = useTransientStatus()
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    void Promise.all([
      getKeepLocalCache(),
      countSessionPulseEntries(),
      isAnalyticsConsentGranted(),
      isDiagnosticsConsentEnabled(),
    ]).then(([storedCache, cacheCount, storedAnalyticsConsent, storedDiagnosticsConsent]) => {
      if (!mounted) return
      setKeepCacheState(storedCache)
      setCacheEntryCount(cacheCount)
      setAnalyticsConsentState(storedAnalyticsConsent)
      setDiagnosticsConsentState(storedDiagnosticsConsent)
    }).catch(() => { if (mounted) showSavedStatus('Could not load privacy settings') })
    void sendBackgroundMessage({ type: 'GET_UPDATE_CHECK_CAPABILITY' })
      .catch(() => null)
      .then(capability => {
        if (!mounted) return
        if (capability && 'type' in capability && capability.type === 'UPDATE_CHECK_CAPABILITY') {
          setUpdateCapability(capability.supported ? 'supported' : capability.managedBy)
        } else {
          setUpdateCapability('browser')
        }
      })
    return () => { mounted = false }
  }, [showSavedStatus])

  async function persistSetting<T>(
    setter: (val: T) => void,
    previous: T,
    next: T,
    task: Promise<unknown>,
    errorMessage: string,
  ): Promise<void> {
    setter(next)
    setSaveError(null)
    try {
      await task
      showSavedStatus('Saved')
    } catch {
      setter(previous)
      setSaveError(errorMessage)
      showSavedStatus('Could not save')
    }
  }

  return {
    keepCache,
    cacheEntryCount,
    cacheBusy,
    analyticsConsent,
    diagnosticsConsent,
    savedStatus,
    saveError,
    clearSaveError() {
      setSaveError(null)
    },
    updateCapability,
    updateStatus,
    setCache(enabled: boolean) {
      void persistSetting(
        setKeepCacheState,
        keepCache,
        enabled,
        setKeepLocalCache(enabled),
        'Could not update cache preference. Changes were reverted.',
      )
    },
    setAnalytics(enabled: boolean) {
      void persistSetting(
        setAnalyticsConsentState,
        analyticsConsent,
        enabled,
        setAnalyticsConsentGranted(enabled),
        'Could not update analytics sharing. Changes were reverted.',
      )
    },
    setDiagnostics(enabled: boolean) {
      void persistSetting(
        setDiagnosticsConsentState,
        diagnosticsConsent,
        enabled,
        setDiagnosticsConsentEnabled(enabled),
        'Could not update crash diagnostics sharing. Changes were reverted.',
      )
    },
    async clearCache(): Promise<void> {
      setCacheBusy(true)
      try {
        await clearSessionPulseCache()
        setCacheEntryCount(await countSessionPulseEntries())
        showSavedStatus('Cache cleared')
      } catch {
        showSavedStatus('Could not clear cache')
      } finally {
        setCacheBusy(false)
      }
    },
    async checkForUpdate(): Promise<void> {
      setUpdateStatus('Checking for updates…')
      try {
        const response = await sendBackgroundMessage({ type: 'CHECK_FOR_UPDATE' })
        const failure = backgroundErrorMessage(response, 'Could not check for updates')
        if (failure) return setUpdateStatus(failure)
        if (!('type' in response) || response.type !== 'UPDATE_CHECK') return setUpdateStatus('Could not check for updates')
        if (response.status === 'current') setUpdateStatus('StreamPulse is up to date')
        else if (response.status === 'update_available') setUpdateStatus(response.version ? `Update ${response.version} is available` : 'An update is available')
        else if (response.status === 'throttled') setUpdateStatus('The browser is checking automatically')
        else if (response.status === 'unsupported') setUpdateStatus('Updates are managed by the browser')
        else setUpdateStatus('Could not check for updates')
      } catch {
        setUpdateStatus('Could not check for updates')
      }
    },
  }
}

export function SettingsWorkspace({
  activeSection = 'pulse',
  developerTools,
}: {
  activeSection?: SettingsHostSection
  developerTools?: ReactNode
}) {
  const preferences = usePulsePreferences()
  const administrative = useAdministrativeSettings()
  const health = usePulseHealth()
  const visibleSection = activeSection === 'developer' && !developerTools ? 'pulse' : activeSection

  return (
    <div
      className={`pulse-settings-panel pulse-density-${preferences.density}`}
      data-settings-workspace="true"
      data-settings-surface="internal-host"
      data-settings-active-section={visibleSection}
      data-pulse-density={preferences.density}
    >
      <main className="pulse-settings-sections" id="settings-content" tabIndex={-1}>
        {preferences.status || administrative.savedStatus ? (
          <span
            className={(preferences.status || administrative.savedStatus).includes('Could not')
              ? 'pulse-settings-status-fail'
              : 'pulse-settings-saved'}
            role="status"
          >
            {preferences.status || administrative.savedStatus}
          </span>
        ) : null}

        <div
          key={visibleSection}
          className="pulse-settings-section-stage"
          data-settings-section-stage={visibleSection}
        >
          {visibleSection === 'pulse' ? (
            <PulseExperienceSection preferences={preferences} health={health} />
          ) : null}
          {visibleSection === 'privacy' ? (
            <PrivacySection settings={administrative} />
          ) : null}
          {visibleSection === 'updates' ? (
            <UpdatesSection settings={administrative} />
          ) : null}
          {visibleSection === 'supporter' ? <SupporterAccountSection /> : null}
          {visibleSection === 'developer' ? developerTools : null}
        </div>
      </main>
    </div>
  )
}

type PulsePreferences = ReturnType<typeof usePulsePreferences>
type PulseHealth = ReturnType<typeof usePulseHealth>
type AdministrativeSettings = ReturnType<typeof useAdministrativeSettings>

function SectionIntro({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return (
    <header className="pulse-settings-page-intro">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      <p>{copy}</p>
    </header>
  )
}

function PulseExperienceSection({ preferences, health }: { preferences: PulsePreferences; health: PulseHealth }) {
  const reachable = health.health?.ok === true
  const apiStatus = health.checking ? 'checking' : reachable ? 'connected' : 'unreachable'
  const sampler = summarizeViewerSampling(reachable ? health.health?.viewerSampling : undefined)
  return (
    <section data-settings-section="pulse" className="pulse-settings-page-section">
      <SectionIntro eyebrow="Extension experience" title="Pulse on Twitch" copy="Control how Pulse looks, refreshes, and docks alongside Twitch chat." />

      <PulseSectionCard title="Connection" headingLevel={3}>
        <div className="pulse-settings-host-connection">
          <span className={`pulse-settings-status-dot pulse-settings-status-dot-${apiStatus}`} aria-hidden="true" />
          <span>
            <strong data-api-status={apiStatus}>{reachable ? 'Hosted API connected' : health.checking ? 'Checking connection' : health.error ? 'Extension disconnected' : 'API unreachable'}</strong>
            <small data-sampler-status={sampler.state}>Viewer sampler · {reachable ? compactViewerSamplingLabel(sampler) : 'Unknown'}</small>
          </span>
          <button type="button" className="pulse-secondary-btn" disabled={health.checking} onClick={() => void health.refresh(true)}>
            {health.checking ? 'Testing…' : 'Test connection'}
          </button>
        </div>
        {health.error ? <p className="pulse-settings-hint" role="status">{health.error}</p> : null}
      </PulseSectionCard>

      <PulseSectionCard title="Live behavior" headingLevel={3}>
        <ToggleRow
          id="settings-auto-update"
          label="Refresh live data automatically"
          hint="Auto-update live activity and viewer metrics continuously on open channels."
          checked={preferences.autoUpdate}
          onChange={preferences.setAutoUpdate}
        />
        <ToggleRow
          id="settings-chat-dock"
          label="Dock when chat is closed"
          hint={preferences.placement === 'sidebar' ? 'Show a mini Pulse dock when Twitch chat is hidden.' : 'Docking is only available when placement is set to Sidebar.'}
          checked={preferences.dock}
          disabled={preferences.placement !== 'sidebar'}
          onChange={preferences.setDock}
        />
        <VodJumpChartPinToggle />
      </PulseSectionCard>

      <PulseSectionCard title="Appearance & placement" headingLevel={3}>
        <PulseBannerControls />
        <div className="pulse-settings-field">
          <span className="pulse-settings-label">Accent</span>
          <ChoicePicker
            kind="accent"
            variant="detailed"
            groupLabel="Accent theme"
            options={withDescriptions('accent', ACCENT_THEME_OPTIONS)}
            value={preferences.accent}
            onChange={next => void preferences.setAccent(next)}
          />
        </div>
        <div className="pulse-settings-field">
          <span className="pulse-settings-label">Density</span>
          <ChoicePicker
            kind="density"
            variant="detailed"
            groupLabel="Density"
            options={withDescriptions('density', DENSITY_OPTIONS)}
            value={preferences.density}
            onChange={next => void preferences.setDensity(next)}
          />
        </div>
        <div className="pulse-settings-field">
          <span className="pulse-settings-label">Overlay placement</span>
          <ChoicePicker
            kind="placement"
            variant="detailed"
            groupLabel="Overlay placement"
            options={withDescriptions('placement', PLACEMENT_OPTIONS).map(option => ({
              ...option,
              icon: <span className="pulse-placement-icon" data-placement={option.value} aria-hidden="true" />,
            }))}
            value={preferences.placement}
            onChange={next => void preferences.setPlacement(next)}
          />
        </div>
      </PulseSectionCard>
    </section>
  )
}

function VodJumpChartPinToggle() {
  const [enabled, setEnabled] = useState(true)
  const [status, setStatus] = useState('')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let mounted = true
    void getVodJumpChartPinEnabled().then(value => {
      if (!mounted) return
      setEnabled(value)
      setLoaded(true)
    }).catch(() => {
      if (mounted) setStatus('Could not load this setting')
    })
    return () => { mounted = false }
  }, [])
  async function update(next: boolean): Promise<void> {
    const previous = enabled
    setEnabled(next)
    setStatus('')
    try {
      await setVodJumpChartPinEnabled(next)
      setStatus('Saved')
    } catch {
      setEnabled(previous)
      setStatus('Could not save; changes were reverted.')
    }
  }
  return (
    <>
      <ToggleRow
        id="settings-vod-jump-chart-pin"
        label="Show VOD jumps on the chart"
        hint="Keep playback seeking enabled while optionally pinning the jumped-to offset in the activity chart."
        checked={enabled}
        disabled={!loaded}
        onChange={update}
      />
      {status ? <span className="pulse-settings-hint" role="status">{status}</span> : null}
    </>
  )
}

function PrivacySection({ settings }: { settings: AdministrativeSettings }) {
  return (
    <section data-settings-section="privacy" className="pulse-settings-page-section">
      <SectionIntro eyebrow="Your browser" title="Privacy & Data" copy="Choose what stays in this browser and clear temporary Pulse data at any time." />
      {settings.saveError ? (
        <div
          className="pulse-settings-error-banner"
          role="alert"
        >
          <span>{settings.saveError}</span>
          <button
            type="button"
            className="pulse-settings-error-banner-dismiss pulse-link-btn"
            onClick={settings.clearSaveError}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <PulseSectionCard title="Local data" headingLevel={3}>
        <ToggleRow
          label="Cache recently viewed channel data"
          hint="Keep temporary Pulse snapshots in browser session storage for the current browser session."
          checked={settings.keepCache}
          onChange={settings.setCache}
        />
        <div className="pulse-settings-cache-meta">
          <span>{settings.cacheEntryCount} cached channel{settings.cacheEntryCount === 1 ? '' : 's'}</span>
          <button type="button" className="pulse-link-btn" disabled={settings.cacheBusy || settings.cacheEntryCount === 0} onClick={() => void settings.clearCache()}>
            {settings.cacheBusy ? 'Clearing…' : 'Clear'}
          </button>
        </div>
      </PulseSectionCard>
      {(EXTENSION_ANALYTICS_INGEST_ENABLED || EXTENSION_DIAGNOSTICS_INGEST_ENABLED) ? (
        <PulseSectionCard title="Optional sharing" headingLevel={3}>
          {EXTENSION_ANALYTICS_INGEST_ENABLED ? <ToggleRow label="Share anonymous product usage" checked={settings.analyticsConsent} onChange={settings.setAnalytics} /> : null}
          {EXTENSION_DIAGNOSTICS_INGEST_ENABLED ? <ToggleRow label="Share crash diagnostics" checked={settings.diagnosticsConsent} onChange={settings.setDiagnostics} /> : null}
        </PulseSectionCard>
      ) : null}
      <div className="pulse-settings-policy-links">
        <a className="pulse-settings-policy-link" href={POLICY_LINKS.privacy} target="_blank" rel="noreferrer">Read the privacy policy ↗</a>
        <a className="pulse-settings-policy-link" href={POLICY_LINKS.terms} target="_blank" rel="noreferrer">Terms of use ↗</a>
      </div>
    </section>
  )
}

function UpdatesSection({ settings }: { settings: AdministrativeSettings }) {
  return (
    <section data-settings-section="updates" className="pulse-settings-page-section">
      <SectionIntro eyebrow="Release history" title="Updates & Changelog" copy="Review the installed build, check update handling, and inspect every published release note." />
      <div className="pulse-settings-version-card">
        <span><small>Installed version</small><strong>v{installedExtensionVersion()}</strong></span>
        <span className="pulse-settings-update-copy">
          {settings.updateCapability === 'loading' ? 'Checking browser update support…' : null}
          {settings.updateCapability === 'supported' ? 'Automatic browser updates are enabled.' : null}
          {settings.updateCapability === 'browser' ? 'Updates are managed by this browser.' : null}
          {settings.updateCapability === 'development' ? 'Development builds update when rebuilt and reloaded.' : null}
        </span>
        {settings.updateCapability === 'supported' ? (
          <button type="button" className="pulse-secondary-btn" onClick={() => void settings.checkForUpdate()}>Check now</button>
        ) : null}
      </div>
      {settings.updateStatus ? <span className="pulse-settings-hint" role="status">{settings.updateStatus}</span> : null}
      <ChangelogCard variant="history" />
      <a className="pulse-settings-policy-link" href={POLICY_LINKS.support} target="_blank" rel="noreferrer">Open StreamPulse support ↗</a>
    </section>
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
  id?: string
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void | Promise<void>
}) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const hintId = `${inputId}-hint`
  return (
    <div className="pulse-settings-toggle-row">
      <div>
        <label className="pulse-settings-label" htmlFor={inputId}>{label}</label>
        {hint ? <span className="pulse-settings-hint" id={hintId}>{hint}</span> : null}
      </div>
      <input
        id={inputId}
        type="checkbox"
        className="pulse-settings-toggle"
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={event => void onChange(event.target.checked)}
      />
    </div>
  )
}
