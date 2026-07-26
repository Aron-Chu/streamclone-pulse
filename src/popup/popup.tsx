import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { openHubAnalytics } from '../shared/analyticsLinks.ts'
import {
  getBackendUrl,
  getChatClosedPulseDockEnabled,
  setChatClosedPulseDockEnabled,
} from '../shared/storage.ts'
import { extensionBackendSourceCaption } from '../shared/backendSource.ts'

function PopupApp() {
  const [backendUrl, setBackendUrl] = useState('')
  const [backendCaption, setBackendCaption] = useState('Hosted · api.streampulse.stream')
  const [chatClosedDockEnabled, setChatClosedDockEnabledState] = useState(false)
  const [healthOk, setHealthOk] = useState<boolean | null>(null)
  const [healthLabel, setHealthLabel] = useState('Checking connection…')

  useEffect(() => {
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

      <p style={styles.health}>{healthLabel}</p>
      <p style={styles.caption}>{backendCaption}</p>

      <label style={styles.toggleCard}>
        <span style={styles.toggleCopy}>
          <span style={styles.toggleLabel}>Dock when chat is closed</span>
          <span style={styles.toggleHint}>
            CHAT / PULSE tabs still appear when chat is open. This only adds a corner dock if the chat column is hidden.
          </span>
        </span>
        <input
          type="checkbox"
          checked={chatClosedDockEnabled}
          onChange={event => void toggleChatClosedDock(event.target.checked)}
          style={styles.checkbox}
        />
      </label>

      <div style={styles.actions}>
        <button type="button" style={styles.primaryButton} onClick={() => void openTwitch()}>
          Open Twitch
        </button>
        <button type="button" style={styles.secondaryButton} onClick={openHub}>
          Analytics hub
        </button>
      </div>

      <p style={styles.footer}>Settings live in the Pulse sidebar gear on Twitch.</p>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    background: '#0e1016',
    boxSizing: 'border-box',
    color: '#f4f5f8',
    fontFamily: '"Segoe UI", ui-sans-serif, system-ui, sans-serif',
    margin: 0,
    minHeight: '100%',
    overflow: 'hidden',
    padding: '16px 16px 14px',
    position: 'relative',
    width: 300,
  },
  atmosphere: {
    background:
      'radial-gradient(120% 80% at 0% 0%, rgba(34, 211, 238, 0.14), transparent 55%), radial-gradient(90% 70% at 100% 10%, rgba(45, 212, 191, 0.08), transparent 50%)',
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
    color: '#67e8f9',
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
    background: '#f97316',
    borderRadius: 999,
    boxShadow: '0 0 0 4px rgba(249, 115, 22, 0.16)',
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
    margin: '12px 0 2px',
    position: 'relative',
  },
  caption: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: 600,
    margin: '0 0 14px',
    position: 'relative',
  },
  toggleCard: {
    alignItems: 'flex-start',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(103, 232, 249, 0.12)',
    borderRadius: 12,
    cursor: 'pointer',
    display: 'flex',
    gap: 12,
    marginBottom: 14,
    padding: '11px 12px',
    position: 'relative',
  },
  toggleCopy: { display: 'grid', flex: 1, gap: 4, minWidth: 0 },
  toggleLabel: { color: '#f8fafc', fontSize: 13, fontWeight: 700, lineHeight: 1.25 },
  toggleHint: { color: '#94a3b8', fontSize: 11, fontWeight: 500, lineHeight: 1.4 },
  checkbox: { accentColor: '#22d3ee', flexShrink: 0, height: 16, marginTop: 2, width: 16 },
  actions: { display: 'grid', gap: 8, position: 'relative' },
  primaryButton: {
    background: 'linear-gradient(180deg, #2dd4bf 0%, #0891b2 100%)',
    border: 0,
    borderRadius: 10,
    color: '#041016',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 800,
    padding: '11px 12px',
    width: '100%',
  },
  secondaryButton: {
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(103, 232, 249, 0.16)',
    borderRadius: 10,
    color: '#f8fafc',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 700,
    padding: '10px 12px',
    width: '100%',
  },
  footer: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1.4,
    margin: '12px 0 0',
    position: 'relative',
    textAlign: 'center',
  },
}

createRoot(document.getElementById('root')!).render(<PopupApp />)
