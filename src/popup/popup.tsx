import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { getBackendUrl, getOverlayPlacement, getPollIntervalMs } from '../shared/storage.ts'

function PopupApp() {
  const [backendUrl, setBackendUrl] = useState('')
  const [pollMs, setPollMs] = useState(30_000)
  const [placement, setPlacement] = useState('')
  const [health, setHealth] = useState('Checking...')

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh(): Promise<void> {
    const [url, interval, dock] = await Promise.all([
      getBackendUrl(),
      getPollIntervalMs(),
      getOverlayPlacement(),
    ])
    setBackendUrl(url)
    setPollMs(interval)
    setPlacement(dock)
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

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>Pulse</h1>
        <span style={health.startsWith('Backend OK') ? styles.okDot : styles.warnDot} />
      </header>
      <p style={styles.health}>{health}</p>
      <dl style={styles.meta}>
        <div><dt>Backend</dt><dd>{backendUrl}</dd></div>
        <div><dt>Polling</dt><dd>{pollMs / 1000}s</dd></div>
        <div><dt>Placement</dt><dd>{placement}</dd></div>
      </dl>
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
  meta: { display: 'grid', gap: 8, margin: '12px 0' },
  primaryButton: { background: '#8b5cf6', border: 0, borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 900, padding: '10px 12px', width: '100%' },
}

createRoot(document.getElementById('root')!).render(<PopupApp />)
