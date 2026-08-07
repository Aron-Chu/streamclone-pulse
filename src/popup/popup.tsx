import { createRoot } from 'react-dom/client'
import { useEffect, useState, type CSSProperties } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { openHubAnalytics } from '../shared/analyticsLinks.ts'
import {
  getBackendUrl,
  getChatClosedPulseDockEnabled,
  getThemePreference,
  setChatClosedPulseDockEnabled,
} from '../shared/storage.ts'
import { extensionBackendSourceCaption } from '../shared/backendSource.ts'
import { applyAccentTheme } from '../ui/overlayTheme.ts'
import { injectStyles, theme } from '../ui/theme.ts'

function PopupApp() {
  const [backendUrl, setBackendUrl] = useState('')
  const [backendCaption, setBackendCaption] = useState('Hosted · api.streampulse.stream')
  const [chatClosedDockEnabled, setChatClosedDockEnabledState] = useState(false)
  const [healthOk, setHealthOk] = useState<boolean | null>(null)
  const [healthLabel, setHealthLabel] = useState('Checking connection…')

  useEffect(() => {
    injectStyles()
    void getThemePreference().then(pref => applyAccentTheme(pref))
    void refresh()
  }, [])

  async function refresh(): Promise<void> {
    const [url, dockEnabled] = await Promise.all([
      getBackendUrl(),
      getChatClosedPulseDockEnabled(),
    ])
    setBackendUrl(url)
    setBackendCaption(extensionBackendSourceCaption(url))
    setChatClosedDockEnabledState(dockEnabled)
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
    }
  }

  function openHub(): void {
    openHubAnalytics(backendUrl)
  }

  async function openTwitch(): Promise<void> {
    try {
      await chrome.tabs.create({ url: 'https://www.twitch.tv' })
    } catch {
      window.open('https://www.twitch.tv', '_blank', 'noopener,noreferrer')
    }
  }

  async function toggleChatClosedDock(enabled: boolean): Promise<void> {
    await setChatClosedPulseDockEnabled(enabled)
    setChatClosedDockEnabledState(enabled)
  }

  return (
    <main style={styles.page}>
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

      <p style={styles.health}>{healthLabel}</p>
      <p style={styles.caption}>{backendCaption}</p>

      <label className="pulse-settings-toggle-row" style={styles.toggleCard}>
        <span style={styles.toggleCopy}>
          <span style={styles.toggleLabel}>Dock when chat is closed</span>
          <span style={styles.toggleHint}>
            CHAT / PULSE tabs still appear when chat is open. This only adds a corner dock if the chat
            column is hidden.
          </span>
        </span>
        <input
          type="checkbox"
          className="pulse-settings-toggle"
          checked={chatClosedDockEnabled}
          onChange={event => void toggleChatClosedDock(event.target.checked)}
          aria-label="Dock when chat is closed"
        />
      </label>

      <div style={styles.actions}>
        <button type="button" className="pulse-primary-btn" style={styles.fullButton} onClick={() => void openTwitch()}>
          Open Twitch
        </button>
        <button type="button" className="pulse-secondary-btn" style={styles.fullButton} onClick={openHub}>
          Analytics hub
        </button>
      </div>

      <p style={styles.footer}>Settings live in the Pulse sidebar gear on Twitch.</p>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    background: theme.bgCanvas,
    boxSizing: 'border-box',
    color: theme.textPrimary,
    fontFamily: theme.font,
    margin: 0,
    minHeight: '100%',
    overflow: 'hidden',
    padding: '16px 16px 14px',
    width: 300,
  },
  header: {
    alignItems: 'flex-start',
    display: 'flex',
    justifyContent: 'space-between',
  },
  brandBlock: { display: 'grid', gap: 2 },
  brand: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.14em',
    margin: 0,
    textTransform: 'uppercase',
  },
  title: {
    color: theme.textPrimary,
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    lineHeight: 1.05,
    margin: 0,
  },
  statusOk: {
    background: theme.live,
    borderRadius: 999,
    boxShadow: '0 0 0 4px rgba(34, 197, 94, 0.16)',
    flexShrink: 0,
    height: 10,
    marginTop: 8,
    width: 10,
  },
  statusBad: {
    background: theme.rank1,
    borderRadius: 999,
    boxShadow: '0 0 0 4px rgba(249, 115, 22, 0.16)',
    flexShrink: 0,
    height: 10,
    marginTop: 8,
    width: 10,
  },
  statusPending: {
    background: theme.textMuted,
    borderRadius: 999,
    flexShrink: 0,
    height: 10,
    marginTop: 8,
    width: 10,
  },
  health: {
    color: theme.textPrimary,
    fontSize: 13,
    fontWeight: 700,
    margin: '12px 0 2px',
  },
  caption: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: 600,
    margin: '0 0 14px',
  },
  toggleCard: {
    alignItems: 'flex-start',
    background: 'rgba(9, 9, 11, 0.6)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    cursor: 'pointer',
    display: 'flex',
    gap: 12,
    marginBottom: 14,
    padding: '11px 12px',
  },
  toggleCopy: { display: 'grid', flex: 1, gap: 4, minWidth: 0 },
  toggleLabel: { color: theme.textPrimary, fontSize: 13, fontWeight: 700, lineHeight: 1.25 },
  toggleHint: { color: theme.textMuted, fontSize: 11, fontWeight: 500, lineHeight: 1.4 },
  actions: { display: 'grid', gap: 8 },
  fullButton: {
    fontSize: 13,
    fontWeight: 800,
    padding: '11px 12px',
    width: '100%',
  },
  footer: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1.4,
    margin: '12px 0 0',
    textAlign: 'center',
  },
}

createRoot(document.getElementById('root')!).render(<PopupApp />)
