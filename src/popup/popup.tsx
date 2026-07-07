import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { openHubAnalytics } from '../shared/analyticsLinks.ts'
import {
  getBackendUrl,
  getChatClosedPulseDockEnabled,
  getOverlayPlacement,
  getPollIntervalMs,
  setChatClosedPulseDockEnabled,
} from '../shared/storage.ts'
import {
  extensionBackendSourceCaption,
} from '../shared/backendSource.ts'

function PopupApp() {
  const [backendUrl, setBackendUrl] = useState('')
  const [backendCaption, setBackendCaption] = useState('Hosted corpus · api.streampulse.stream')
  const [pollMs, setPollMs] = useState(30_000)
  const [placement, setPlacement] = useState('')
  const [chatClosedDockEnabled, setChatClosedDockEnabledState] = useState(false)
  const [health, setHealth] = useState('Checking...')

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh(): Promise<void> {
    const [url, interval, placementValue, dockEnabled] = await Promise.all([
      getBackendUrl(),
      getPollIntervalMs(),
      getOverlayPlacement(),
      getChatClosedPulseDockEnabled(),
    ])
    setBackendUrl(url)
    setBackendCaption(extensionBackendSourceCaption(url))
    setPollMs(interval)
    setPlacement(placementValue)
    setChatClosedDockEnabledState(dockEnabled)
    try {
      const res = await sendBackgroundMessage({ type: 'HEALTH' })
      setHealth('type' in res && res.type === 'HEALTH' && res.ok ? `Backend OK (${res.version ?? 'dev'})` : 'Backend unreachable')
    } catch {
      setHealth('Backend unreachable')
    }
  }

  function openOptions(): void {
    void sendBackgroundMessage({ type: 'OPEN_OPTIONS' })
  }

  function openHub(): void {
    openHubAnalytics(backendUrl)
  }

  async function toggleChatClosedDock(enabled: boolean): Promise<void> {
    await setChatClosedPulseDockEnabled(enabled)
    setChatClosedDockEnabledState(enabled)
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>Pulse</h1>
        <span style={health.startsWith('Backend OK') ? styles.okDot : styles.warnDot} />
      </header>
      <p style={styles.health}>{health}</p>
      <label style={styles.toggleRow}>
        <input
          type="checkbox"
          checked={chatClosedDockEnabled}
          onChange={event => void toggleChatClosedDock(event.target.checked)}
        />
        <span>Show Pulse dock when chat is closed</span>
      </label>
      <p style={styles.hint}>
        CHAT/PULSE tabs always show when Twitch chat is open. This option adds a bottom-right Pulse panel only when the chat column is hidden.
      </p>
      <dl style={styles.meta}>
        <div><dt>Backend</dt><dd>{backendCaption}</dd></div>
        <div><dt>Polling</dt><dd>{pollMs / 1000}s</dd></div>
        <div><dt>Placement</dt><dd>{placement}</dd></div>
      </dl>
      <button type="button" style={styles.hubButton} onClick={openHub}>Analytics hub →</button>
      <button type="button" style={styles.primaryButton} onClick={openOptions}>Settings</button>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: { background: '#111118', color: '#fafafc', fontFamily: 'Inter, system-ui, sans-serif', padding: 14, width: 292 },
  header: { alignItems: 'center', display: 'flex', justifyContent: 'space-between' },
  title: { fontSize: 18, margin: 0 },
  okDot: { background: '#22c55e', borderRadius: 999, height: 10, width: 10 },
  warnDot: { background: '#f97316', borderRadius: 999, height: 10, width: 10 },
  health: { color: '#c7c7d4', fontSize: 13, fontWeight: 800, margin: '10px 0' },
  hint: { color: '#8b8ba0', fontSize: 12, lineHeight: 1.4, margin: '0 0 10px' },
  toggleRow: { alignItems: 'center', display: 'flex', fontSize: 13, fontWeight: 700, gap: 8, marginBottom: 8 },
  meta: { display: 'grid', gap: 8, margin: '12px 0' },
  hubButton: { background: '#2b2b32', border: '1px solid #3f3f50', borderRadius: 8, color: '#fafafc', cursor: 'pointer', fontWeight: 900, marginBottom: 8, padding: '10px 12px', width: '100%' },
  primaryButton: { background: '#8b5cf6', border: 0, borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 900, padding: '10px 12px', width: '100%' },
}

createRoot(document.getElementById('root')!).render(<PopupApp />)
