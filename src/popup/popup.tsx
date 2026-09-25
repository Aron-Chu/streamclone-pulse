import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { getBackendUrl, getThemePreference, setOverlayMode, setSidebarTab } from '../shared/storage.ts'
import { extensionBackendSourceCaption } from '../shared/backendSource.ts'
import { installedExtensionVersion } from '../shared/releaseManifest.ts'
import { applyAccentTheme } from '../ui/overlayTheme.ts'
import { AnalyticsHubCta } from '../ui/AnalyticsHubCta.tsx'
import { injectStyles, theme } from '../ui/theme.ts'

const TWITCH_RESERVED_ROUTES = new Set([
  'directory',
  'downloads',
  'drops',
  'friends',
  'inventory',
  'jobs',
  'messages',
  'p',
  'payments',
  'popout',
  'prime',
  'search',
  'settings',
  'subscriptions',
  'turbo',
  'videos',
  'wallet',
])

function PopupApp() {
  const [backendUrl, setBackendUrl] = useState('')
  const [backendCaption, setBackendCaption] = useState('Hosted · api.streampulse.stream')
  const [healthOk, setHealthOk] = useState<boolean | null>(null)
  const [healthLabel, setHealthLabel] = useState('Checking connection…')
  const [checking, setChecking] = useState(false)
  const [activeChannel, setActiveChannel] = useState<string | null>(null)
  const [activeTabId, setActiveTabId] = useState<number | null>(null)

  useEffect(() => {
    void getThemePreference().then(applyAccentTheme).catch(() => null)
    void refresh()
    void detectActiveTwitchTab()

    const storageChanged = globalThis.chrome?.storage?.onChanged
    if (!storageChanged?.addListener) return
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.themePreference) {
        void getThemePreference().then(applyAccentTheme).catch(() => null)
      }
    }
    storageChanged.addListener(listener)
    return () => storageChanged.removeListener(listener)
  }, [])

  async function detectActiveTwitchTab(): Promise<void> {
    try {
      if (!chrome.tabs?.query) return
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.url) return
      if (typeof tab.id === 'number') setActiveTabId(tab.id)
      const parsed = new URL(tab.url)
      if (parsed.hostname === 'www.twitch.tv' || parsed.hostname === 'twitch.tv') {
        const seg = parsed.pathname.split('/').filter(Boolean)[0]
        if (seg && !TWITCH_RESERVED_ROUTES.has(seg.toLowerCase())) {
          setActiveChannel(seg)
        }
      }
    } catch {
      // Ignore tab query issues in restricted contexts
    }
  }

  async function refresh(): Promise<void> {
    setChecking(true)
    const url = await getBackendUrl()
    setBackendUrl(url)
    setBackendCaption(extensionBackendSourceCaption(url))
    try {
      const res = await sendBackgroundMessage({ type: 'HEALTH' })
      if ('type' in res && res.type === 'HEALTH' && res.ok) {
        setHealthOk(true)
        setHealthLabel(`Connected${res.version ? ` · ${res.version}` : ''}`)
      } else {
        setHealthOk(false)
        setHealthLabel('Can’t reach StreamPulse')
      }
    } catch {
      setHealthOk(false)
      setHealthLabel('Can’t reach StreamPulse')
    } finally {
      setChecking(false)
    }
  }

  async function handlePrimaryAction(): Promise<void> {
    if (activeChannel && activeTabId !== null) {
      try {
        await Promise.all([
          setSidebarTab('pulse').catch(() => null),
          setOverlayMode('expanded').catch(() => null),
        ])
        if (typeof chrome !== 'undefined' && chrome.tabs?.sendMessage) {
          try {
            await chrome.tabs.sendMessage(activeTabId, { type: 'OPEN_PULSE_SIDEBAR' })
          } catch {
            // Content script may not be injected or listening yet; storage was already updated
          }
        }
        await chrome.tabs.update(activeTabId, { active: true })
        window.close()
        return
      } catch {
        // Fall back to opening channel tab
      }
    }
    await openTwitch()
  }

  async function openTwitch(): Promise<void> {
    try {
      await chrome.tabs.create({ url: 'https://www.twitch.tv' })
    } catch {
      window.open('https://www.twitch.tv', '_blank', 'noopener,noreferrer')
    }
  }

  async function openSettings(section: 'moments' | 'pulse' = 'pulse'): Promise<void> {
    const request = section === 'moments'
      ? { type: 'OPEN_SETTINGS_HOST' as const, section: 'moments' as const }
      : { type: 'OPEN_SETTINGS_HOST' as const, section: 'pulse' as const }
    await sendBackgroundMessage(request).catch(() => null)
  }

  return (
    <main style={styles.page}>
      <div style={styles.atmosphere} aria-hidden="true" />

      <header style={styles.header}>
        <div style={styles.brandBlock}>
          <p style={styles.brand}>StreamPulse</p>
          <h1 style={styles.title}>Pulse</h1>
        </div>
        <span
          style={
            healthOk === true
              ? styles.statusOk
              : healthOk === false
                ? styles.statusBad
                : styles.statusPending
          }
          title={healthLabel}
          aria-label={healthLabel}
        />
      </header>

      <div style={styles.statusCard}>
        <p style={styles.health}>{healthLabel}</p>
        <p style={styles.caption}>{backendCaption}</p>
        <p style={styles.version}>Extension v{installedExtensionVersion()}</p>
        {healthOk === false ? (
          <button
            type="button"
            style={styles.retryButton}
            disabled={checking}
            onClick={() => void refresh()}
          >
            {checking ? 'Checking…' : 'Retry connection'}
          </button>
        ) : null}
      </div>

      <div style={styles.actions}>
        <button
          type="button"
          className="pulse-action-chip pulse-action-chip-primary pulse-popup-primary-action"
          style={styles.primaryButton}
          data-popup-action="open-pulse"
          onClick={() => void handlePrimaryAction()}
        >
          {activeChannel ? `Open Pulse on ${activeChannel}` : 'Open Twitch'}
        </button>
        {/* Analytics hub stays a shared CTA so popup and overlay use one route. */}
        <AnalyticsHubCta backendUrl={backendUrl} />
        <button
          type="button"
          className="pulse-action-chip pulse-popup-secondary-action"
          style={styles.secondaryButton}
          data-popup-action="open-moments"
          onClick={() => void openSettings('moments')}
        >
          My Moments
        </button>
        <button
          type="button"
          className="pulse-action-chip pulse-popup-settings-action"
          style={styles.settingsButton}
          data-popup-action="open-settings"
          onClick={() => void openSettings()}
        >
          <span>Open settings</span><span aria-hidden="true">↗</span>
        </button>
      </div>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    background: '#0e1016',
    boxSizing: 'border-box',
    color: theme.textPrimary,
    fontFamily: theme.font,
    margin: 0,
    minHeight: '100%',
    overflow: 'hidden',
    padding: '16px 16px 14px',
    position: 'relative',
    width: 300,
  },
  atmosphere: {
    background:
      'radial-gradient(120% 80% at 0% 0%, rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.15), transparent 55%), radial-gradient(90% 70% at 100% 10%, rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.08), transparent 50%)',
    inset: 0,
    pointerEvents: 'none',
    position: 'absolute',
  },
  header: {
    alignItems: 'flex-start',
    display: 'flex',
    justifyContent: 'space-between',
    position: 'relative',
  },
  brandBlock: { display: 'grid', gap: 2 },
  brand: {
    color: 'var(--pulse-accent, #8b5cf6)',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.14em',
    margin: 0,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 26,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    lineHeight: 1.05,
    margin: 0,
  },
  statusOk: {
    background: '#22c55e',
    borderRadius: 999,
    boxShadow: '0 0 0 4px rgba(34, 197, 94, 0.16)',
    flexShrink: 0,
    height: 10,
    marginTop: 8,
    width: 10,
  },
  statusBad: {
    background: '#f87171',
    borderRadius: 999,
    boxShadow: '0 0 0 4px rgba(248, 113, 113, 0.16)',
    flexShrink: 0,
    height: 10,
    marginTop: 8,
    width: 10,
  },
  statusPending: {
    background: '#64748b',
    borderRadius: 999,
    flexShrink: 0,
    height: 10,
    marginTop: 8,
    width: 10,
  },
  health: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: 700,
    margin: 0,
    position: 'relative',
  },
  caption: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: 600,
    margin: '2px 0 0',
    position: 'relative',
  },
  version: {
    color: '#64748b',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 10,
    fontWeight: 700,
    margin: '8px 0 0',
    position: 'relative',
  },
  statusCard: {
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid var(--pulse-accent-border, rgba(139, 92, 246, 0.25))',
    borderRadius: 12,
    margin: '14px 0',
    padding: '11px 12px',
    position: 'relative',
  },
  retryButton: {
    background: 'rgba(248, 113, 113, 0.12)',
    border: '1px solid rgba(248, 113, 113, 0.3)',
    borderRadius: 8,
    color: '#fca5a5',
    cursor: 'pointer',
    minHeight: 36,
    fontSize: 11,
    fontWeight: 700,
    marginTop: 8,
    padding: '7px 10px',
  },
  actions: { display: 'grid', gap: 8, position: 'relative' },
  primaryButton: {
    background: 'var(--pulse-accent-strong, #7c3aed)',
    border: '1px solid transparent',
    borderRadius: 10,
    color: 'var(--pulse-on-accent, #ffffff)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.2,
    minHeight: 44,
    padding: '11px 12px',
    width: '100%',
  },
  secondaryButton: {
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: 10,
    color: '#f8fafc',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1.2,
    minHeight: 42,
    padding: '10px 12px',
    width: '100%',
  },
  settingsButton: {
    alignItems: 'center',
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 8,
    color: '#94a3b8',
    cursor: 'pointer',
    display: 'flex',
    fontSize: 11,
    fontWeight: 700,
    justifyContent: 'space-between',
    lineHeight: 1.2,
    minHeight: 36,
    padding: '7px 8px',
    width: '100%',
  },
}

injectStyles()
createRoot(document.getElementById('root')!).render(<PopupApp />)
