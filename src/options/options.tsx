import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import {
  DEFAULT_BACKEND_URL,
  DEFAULT_POLL_INTERVAL_MS,
  getBackendUrl,
  getPollIntervalMs,
  setBackendUrl,
  setPollIntervalMs,
} from '../shared/storage.ts'

function OptionsApp() {
  const [backendUrl, setBackendUrlState] = useState(DEFAULT_BACKEND_URL)
  const [pollMs, setPollMsState] = useState(String(DEFAULT_POLL_INTERVAL_MS))
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void (async () => {
      setBackendUrlState(await getBackendUrl())
      setPollMsState(String(await getPollIntervalMs()))
    })()
  }, [])

  async function save(): Promise<void> {
    await setBackendUrl(backendUrl)
    await setPollIntervalMs(Number(pollMs))
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 16, maxWidth: 520 }}>
      <h1 style={{ fontSize: 18 }}>Streamclone Pulse settings</h1>
      <label style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
        <span>Backend URL</span>
        <input
          value={backendUrl}
          onChange={e => setBackendUrlState(e.target.value)}
          placeholder={DEFAULT_BACKEND_URL}
          style={{ padding: 8, fontSize: 14 }}
        />
      </label>
      <label style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
        <span>Poll interval (ms)</span>
        <input
          value={pollMs}
          onChange={e => setPollMsState(e.target.value)}
          type="number"
          min={15000}
          step={1000}
          style={{ padding: 8, fontSize: 14 }}
        />
      </label>
      <button type="button" onClick={() => void save()} style={{ padding: '8px 14px' }}>
        Save
      </button>
      {saved ? <p style={{ color: '#16a34a' }}>Saved.</p> : null}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<OptionsApp />)
