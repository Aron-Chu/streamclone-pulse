import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { DEFAULT_BACKEND_URL, getBackendUrl } from '../shared/storage.ts'

function PopupApp() {
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL)
  const [health, setHealth] = useState<string>('Checking…')

  useEffect(() => {
    void (async () => {
      setBackendUrl(await getBackendUrl())
      try {
        const res = await sendBackgroundMessage({ type: 'HEALTH' })
        if ('ok' in res && res.ok) {
          setHealth(`Backend OK (${'version' in res ? res.version : 'unknown'})`)
        } else {
          setHealth('Backend unreachable')
        }
      } catch {
        setHealth('Backend unreachable')
      }
    })()
  }, [])

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 12, width: 280 }}>
      <h1 style={{ fontSize: 16, margin: '0 0 8px' }}>Streamclone Pulse</h1>
      <p style={{ fontSize: 13, margin: '0 0 8px', opacity: 0.85 }}>{health}</p>
      <p style={{ fontSize: 12, margin: 0, opacity: 0.7 }}>Backend: {backendUrl}</p>
      <p style={{ fontSize: 12, marginTop: 10 }}>
        Open a Twitch channel page to see the overlay. Configure the backend URL in extension options.
      </p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<PopupApp />)
